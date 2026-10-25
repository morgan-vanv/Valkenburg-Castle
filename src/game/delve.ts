// Hero commands during a delve: move, actions (with their targets, roll
// specs and effects), leave/abandon, the end of the delve.

import { DIRS, distance, hexToWorld, posKey, posNeighbors, range, samePos, type Pos } from './hex';
import type { ActionKind, ActionTarget, HeroClass, HeroInDelve, Item, Stat } from './types';
import type { ActionOption } from './api';
import {
  BLINK_RANGE, BURN_ROUNDS, CLASSES, DIG_NOISE, FIREBALL_NOISE, FIREBALL_RANGE, FIRECRACKER_NOISE, FOCUS_MAX, GLUE_ROUNDS,
  GUST_NOISE, GUST_RANGE, KNOCKBACK_RANGE, LIGHT_MAX, MONSTERS, OIL_LIGHT, PACK_SLOTS, SLEEP_RANGE, SMOKE_ROUNDS, SPELL_RANGE,
  THROW_CHARGE_RANGE, THROW_RANGE, TORCH_ROUNDS, VEIL_BREAK_NOISE, VEIL_ROUNDS, WARD_ROUNDS, WINCH_NOISE,
} from './data';
import { say, type Ctx, type MonsterX } from './state';
import {
  activeHeroes, addToPack, armorOf, brightnessAt, chestLoot, cleanGround, hd, heroDef, heroName, hurtAny, hurtHero, killHero,
  LIGHT_PENALTY, makeHostile, makeNoise, noteOnce, occupant, packUsed, passLanternIfNeeded, putOnGround,
  rivalsOnMap, roll, valueOf, wakeAdjacent,
} from './common';
import {
  adjacent, brightnessOf, canEnter, clampLight, dijkstra, doorAt, fallColumn, glimpseSet, isFloorish, kindAt, litSet, los, pathTo,
  pitsNextTo, standable, steps, visibleSet, within,
} from './world';
import { buildSummary } from './camp';
import { fall, fallInfo, push, pushOutcome, pushText, setAfterLanding, ventCheck } from './falls';
import { lairCheck } from './dragon';

// ---------------------------------------------------------------- sight bookkeeping

/** Mark everything in line of sight from `at` as explored (layout only). */
export function glimpse(c: Ctx, at: Pos, ex: Set<string> = new Set(c.d.explored)): void {
  for (const p of glimpseSet(c.w, c.d, at)) {
    const k = posKey(p);
    if (!ex.has(k)) {
      ex.add(k);
      c.d.explored.push(k);
    }
  }
}

/** After anything changes: explored grows, rivals get spotted, the Gloam fades in light. */
/** The heroes' current visible set, memoized on the context (targets ask for it many times). */
export function visNow(c: Ctx): Set<string> {
  return (c.visCache ??= visibleSet(c.w, c.d));
}

export function refreshSight(c: Ctx): void {
  c.visCache = undefined;
  const lit = litSet(c.w, c.d);
  const vis = visibleSet(c.w, c.d, lit);
  const ex = new Set(c.d.explored);
  for (const k of vis) if (!ex.has(k)) c.d.explored.push(k);
  for (const h of c.d.heroes) if (h.status === 'active') glimpse(c, h.at, ex);

  const cr = c.d.rivals;
  if (cr && !cr.spotted && rivalsOnMap(c).some((r) => vis.has(posKey(r.at)))) {
    cr.spotted = true;
    say(c, `The Lantern Sisters. They want ${cr.goal === 'leave' ? 'out' : 'the loot'}.`);
  }
}

export function setLight(c: Ctx, value: number): void {
  c.visCache = undefined;
  const before = c.d.light;
  c.d.light = clampLight(value);
  if (c.d.light !== before) c.ev.push({ type: 'light', light: c.d.light, brightness: brightnessOf(c.d.light) });
  if (c.d.light > 0) {
    const g = c.d.monsters.find((m) => m.kind === 'gloam');
    if (g) {
      c.d.monsters = c.d.monsters.filter((m) => m !== g);
      c.ev.push({ type: 'monsterDied', id: g.id });
      say(c, 'The dark draws back.');
    }
  }
}

// ---------------------------------------------------------------- movement

export function moveBudget(c: Ctx, h: HeroInDelve, sneak: boolean): number {
  const cls = heroDef(c, h.heroId)?.cls;
  let b = sneak ? (cls === 'burglar' ? 4 : 2) : 4;
  if (h.escorting) b = Math.min(b, 3);
  return b;
}

function blocksHero(c: Ctx, p: Pos): boolean {
  const o = occupant(c, p);
  return !!o && (o.kind === 'monster' || o.kind === 'rival');
}

function trapPenalty(c: Ctx, p: Pos): number {
  return c.d.traps[posKey(p)]?.spotted ? 10 : 0;
}

/** Can this hero move now? 'walk' = first move; 'dash' = second move that spends the action (spec 15.2). */
export function moveKind(h: HeroInDelve): 'walk' | 'dash' | null {
  if (h.status !== 'active' || h.webbed) return null;
  if (!h.moved) return 'walk';
  if (!h.acted && !h.dashed) return 'dash';
  return null;
}

export function reachable(c: Ctx, heroId: string, sneak: boolean) {
  const h = hd(c, heroId);
  if (!h || c.d.phase !== 'player') return [];
  const mk = moveKind(h);
  if (!mk) return [];
  const nodes = dijkstra(c.w, c.d, h.at, {
    enter: (p) => !blocksHero(c, p),
    penalty: (p) => trapPenalty(c, p),
    stairs: true,
    budget: moveBudget(c, h, sneak),
  });
  const out = [];
  for (const n of nodes.values()) {
    if (samePos(n.p, h.at)) continue;
    const o = occupant(c, n.p);
    if (o) continue; // can't end on another hero or the prisoner
    out.push({ to: n.p, cost: n.cost, path: pathTo(nodes, n.p), ...(mk === 'dash' ? { dash: true } : {}) });
  }
  return out;
}

export function moveNoise(sneak: boolean): number {
  return sneak ? 0 : 1;
}

export function doMove(c: Ctx, heroId: string, path: Pos[], sneak: boolean): string | undefined {
  const h = hd(c, heroId);
  if (!h) return 'No such hero.';
  if (h.status !== 'active') return `${heroName(c, heroId)} can't move.`;
  if (h.webbed) return `${heroName(c, heroId)} is stuck in a web.`;
  const mk = moveKind(h);
  if (!mk) return h.dashed ? `${heroName(c, heroId)} has already dashed.` : `${heroName(c, heroId)} has already moved.`;
  if (!path.length) return 'Pick a destination.';
  c.visCache = undefined;
  // Validate.
  let cost = 0;
  let prev = h.at;
  for (const p of path) {
    const st = steps(c.w, c.d, prev, { stairs: true }).find(([n]) => samePos(n, p));
    if (!st) return "Can't go that way.";
    if (blocksHero(c, p)) return 'Something is in the way.';
    cost += st[1];
    prev = p;
  }
  if (cost > moveBudget(c, h, sneak)) return 'Too far.';
  if (occupant(c, path[path.length - 1]!)) return 'Someone is already there.';
  // Walk (or dash: the action goes on the second move).
  h.moved = true;
  if (mk === 'dash') {
    h.dashed = true;
    h.acted = true;
  }
  const walked: Pos[] = [];
  let from = h.at;
  for (const p of path) {
    if (kindAt(c.w, c.d, p) === 'door') {
      const door = doorAt(c.d, p);
      if (door && !door.open) {
        door.open = true;
        c.ev.push({ type: 'doorChanged', at: p, open: true, locked: door.locked });
      }
    }
    walked.push(p);
    if (p.level !== from.level) {
      c.ev.push({ type: 'moved', id: heroId, path: [...walked] });
      walked.length = 0;
      c.ev.push({ type: 'levelChanged', id: heroId, from: from.level, to: p.level });
    }
    h.at = { ...p };
    from = p;
    glimpse(c, p);
    const trap = c.d.traps[posKey(p)];
    if (trap) {
      c.ev.push({ type: 'moved', id: heroId, path: [...walked] });
      walked.length = 0;
      springTrap(c, h, p);
      if (h.status !== 'active') break;
    }
  }
  if (walked.length) c.ev.push({ type: 'moved', id: heroId, path: [...walked] });
  ventCheck(c, h);
  afterHeroMove(c, h, sneak);
  makeNoise(c, h.at, h.status === 'active' ? moveNoise(sneak) : 0);
  refreshSight(c);
  checkDelveEnd(c);
  return undefined;
}

function springTrap(c: Ctx, h: HeroInDelve, at: Pos): void {
  delete c.d.traps[posKey(at)];
  c.ev.push({ type: 'trap', at, id: h.heroId, damage: 3 });
  say(c, `A trap bites ${heroName(c, h.heroId)}.`);
  hurtHero(c, h, 3, 'trap');
  makeNoise(c, at, 2);
}

/** Prisoner follows, traps get spotted, sleepers next to the hero wake. */
export function afterHeroMove(c: Ctx, h: HeroInDelve, sneak = false): void {
  const pr = c.d.prisoner;
  if (pr && h.escorting === pr.id && !pr.dead && !pr.out && !adjacent(pr.at, h.at)) {
    const spot = posNeighbors(h.at)
      .filter((p) => canEnter(c.w, c.d, p) && !occupant(c, p) && !c.d.traps[posKey(p)] && kindAt(c.w, c.d, p) !== 'door')
      .sort((a, b) => (a.level === pr.at.level ? distance(a, pr.at) : 99) - (b.level === pr.at.level ? distance(b, pr.at) : 99))[0];
    if (spot) {
      pr.at = spot;
      c.ev.push({ type: 'moved', id: pr.id, path: [spot] });
    }
  }
  if (h.status !== 'active') return;
  for (const [k, t] of Object.entries(c.d.traps)) {
    if (t.spotted) continue;
    const [lv, rest] = k.split(':');
    const [q, r] = (rest ?? '0,0').split(',').map(Number) as [number, number];
    const at = { level: Number(lv), q, r };
    if (!within(at, h.at, 1)) continue;
    const def = heroDef(c, h.heroId)!;
    const p = def.stats.wits + LIGHT_PENALTY[brightnessAt(c.w, c, h.at)];
    const r1 = roll(c, h.heroId, 'Spot trap', 1, p);
    if (r1.hits) {
      t.spotted = true;
      c.ev.push({ type: 'trapSpotted', at });
      say(c, `${heroName(c, h.heroId)} spots a trap.`);
    }
  }
  wakeAdjacent(c, h.at);
  lairCheck(c, h, sneak);
}

setAfterLanding((c, h) => {
  if (h && h.status === 'active') afterHeroMove(c, h);
});

// ---------------------------------------------------------------- targets

const FREE: ActionKind[] = ['open', 'take', 'drop', 'give', 'leave'];

function lockedThingAt(c: Ctx, p: Pos): { door?: boolean; chest?: boolean; jammed: boolean } | null {
  const door = kindAt(c.w, c.d, p) === 'door' ? doorAt(c.d, p) : undefined;
  if (door && door.locked && !door.open) return { door: true, jammed: door.jammed };
  const ch = c.d.chests.find((x) => samePos(x.at, p) && !x.opened && x.locked);
  if (ch) return { chest: true, jammed: ch.jammed };
  return null;
}

function aroundAndSelf(p: Pos): Pos[] {
  return [p, ...posNeighbors(p)];
}

function enemiesAdjacent(c: Ctx, h: HeroInDelve, shove = false): ActionTarget[] {
  const out: ActionTarget[] = [];
  for (const m of c.d.monsters) if (m.kind !== 'gloam' && !(shove && m.kind === 'dragon') && adjacent(m.at, h.at)) out.push({ id: m.id, at: m.at });
  for (const r of rivalsOnMap(c)) if (adjacent(r.at, h.at)) out.push({ id: r.id, at: r.at });
  return out;
}

/** Enemies within `n` hexes that the heroes can see and the hero has a line to (monsters, rivals; no Gloam). */
function enemiesInSight(c: Ctx, h: HeroInDelve, n: number, opts: { noDragon?: boolean; monstersOnly?: boolean } = {}): ActionTarget[] {
  const vis = visNow(c);
  const out: ActionTarget[] = [];
  const cands = [...c.d.monsters.filter((m) => m.kind !== 'gloam' && !(opts.noDragon && m.kind === 'dragon')), ...(opts.monstersOnly ? [] : rivalsOnMap(c))];
  for (const m of cands) {
    if (within(m.at, h.at, n) && vis.has(posKey(m.at)) && los(c.w, c.d, h.at, m.at)) out.push({ id: m.id, at: m.at });
  }
  return out;
}

/** Hexes within `n` of the hero that the heroes can see now (same level). */
function hexesInSight(c: Ctx, h: HeroInDelve, n: number, filter: (p: Pos) => boolean = () => true): ActionTarget[] {
  const vis = visNow(c);
  const out: ActionTarget[] = [];
  for (const x of range(h.at, n)) {
    const p = { level: h.at.level, ...x };
    if (!c.w.tile(p) || !vis.has(posKey(p)) || !filter(p)) continue;
    out.push({ at: p });
  }
  return out;
}

/** Allies (self included) within `n`, active. */
function alliesWithin(c: Ctx, h: HeroInDelve, n: number): ActionTarget[] {
  return c.d.heroes.filter((o) => o.status === 'active' && within(o.at, h.at, n)).map((o) => ({ id: o.heroId }));
}

/** The hex one step from `at` straight away from `from` (for ranged pushes: the direction rounded to a hex side). */
export function awayFrom(from: Pos, at: Pos): Pos {
  if (distance(from, at) <= 1) return { level: at.level, q: 2 * at.q - from.q, r: 2 * at.r - from.r };
  const A = hexToWorld(from);
  const B = hexToWorld(at);
  const vx = B.x - A.x;
  const vz = B.z - A.z;
  let best = DIRS[0]!;
  let bestDot = -Infinity;
  for (const d of DIRS) {
    const D = hexToWorld(d);
    const dot = D.x * vx + D.z * vz;
    if (dot > bestDot) {
      bestDot = dot;
      best = d;
    }
  }
  return { level: at.level, q: at.q + best.q, r: at.r + best.r };
}

/** A virtual pusher position so that push()/pushOutcome() send the figure at `at` one hex away from `from`. */
function pusherFor(from: Pos, at: Pos): Pos {
  const dest = awayFrom(from, at);
  return { level: at.level, q: 2 * at.q - dest.q, r: 2 * at.r - dest.r };
}

/** Where a grappling hook from `at` (a pit landing or pit floor) climbs to: a free edge hex on the level above, or null. */
export function grappleTop(c: Ctx, at: Pos, self: string): { pit: Pos; to: Pos } | { pit: Pos; to: null } | null {
  const up = at.level - 1;
  if (!c.w.levels.has(up)) return null;
  const col = { level: up, q: at.q, r: at.r };
  // The column above, or the nearest pit hex within 2 (landings can be offset from the column).
  const pits = range(col, 2)
    .map((x) => ({ level: up, ...x }))
    .filter((p) => kindAt(c.w, c.d, p) === 'pit' && fallColumn(c.w, c.d, p)?.to.level === at.level)
    .sort((a, b) => distance(a, col) - distance(b, col));
  const pit = pits[0];
  if (!pit) return null;
  const edges = posNeighbors(pit)
    .filter((p) => standable(c.w, c.d, p) && !c.w.vents.has(posKey(p)))
    .sort((a, b) => distance(a, col) - distance(b, col));
  const free = edges.find((p) => { const o = occupant(c, p); return !o || o.id === self; });
  return { pit, to: free ?? null };
}

/** What `take` at pile `at` would pick up for hero `h`, in order: the contract item first. */
export function takePlan(c: Ctx, h: HeroInDelve, at: Pos): { items: Item[]; blocked?: string } {
  const g = c.d.ground.find((x) => samePos(x.at, at));
  if (!g || !g.items.length) return { items: [] };
  const ordered = [...g.items].sort((a, b) => Number(!!b.contractId) - Number(!!a.contractId) || Number(b.kind === 'heirloom' || b.kind === 'hoard') - Number(a.kind === 'heirloom' || a.kind === 'hoard'));
  const contract = ordered.find((i) => i.contractId);
  const room = PACK_SLOTS - packUsed(h.pack);
  if (contract && contract.slots > room) return { items: [], blocked: `${contract.name} needs ${contract.slots} pack slots. Drop something first.` };
  const items: Item[] = [];
  let used = packUsed(h.pack);
  const goldRoom = h.pack.some((p) => p.kind === 'gold' && p.amount < 100);
  for (const i of ordered) {
    if (i.slots <= PACK_SLOTS - used) {
      items.push(i);
      used += i.kind === 'gold' && goldRoom ? 0 : i.slots;
    } else if (i.kind === 'gold' && goldRoom) items.push(i);
  }
  if (!items.length) return { items: [], blocked: 'Pack is full. Drop something first.' };
  return { items };
}

function itemOf(h: HeroInDelve, kind: Item['kind']): Item | undefined {
  return h.pack.find((i) => i.kind === kind);
}

function parsePos(k: string): Pos {
  const [lv, rest] = k.split(':');
  const [q, r] = (rest ?? '').split(',').map(Number) as [number, number];
  return { level: Number(lv), q, r };
}

/** Pit hexes next to `at` that something could fall down. */
function droppablePits(c: Ctx, at: Pos, self: string): Pos[] {
  return pitsNextTo(c.w, c.d, at).filter((p) => !!fallInfo(c, p, self));
}

/** Rope anchors a hero at `at` can climb up to (they stand on or next to the rope's foot). */
function ropesUpFrom(c: Ctx, at: Pos): Pos[] {
  const out: Pos[] = [];
  for (const k of c.d.ropes) {
    const top = parsePos(k);
    if (occupant(c, top)) continue;
    const foot = pitsNextTo(c.w, c.d, top).map((p) => fallColumn(c.w, c.d, p)?.to).filter((x): x is Pos => !!x);
    if (foot.some((f) => within(f, at, 1))) out.push(top);
  }
  return out;
}

function nextToWinch(c: Ctx, at: Pos): Pos | undefined {
  return c.w.winches.find((wp) => adjacent(wp, at));
}

function partyGold(c: Ctx): number {
  return c.d.heroes.filter((h) => h.status === 'active' || h.status === 'downed').reduce((n, h) => n + h.pack.filter((i) => i.kind === 'gold').reduce((a, i) => a + i.amount, 0), 0);
}

/** Every valid target for an action right now (ignores move/act flags). */
export function targetsFor(c: Ctx, h: HeroInDelve, action: ActionKind): ActionTarget[] {
  const def = heroDef(c, h.heroId)!;
  const cls = def.cls;
  const others = c.d.heroes.filter((x) => x !== h);
  const mage = (school: HeroClass, mana: number) => cls === school && h.mana >= mana;
  switch (action) {
    case 'attack':
      if (cls === 'ranger') return enemiesInSight(c, h, CLASSES.ranger.weapon.range ?? 6);
      return enemiesAdjacent(c, h);
    case 'shove':
      return enemiesAdjacent(c, h, true);
    // ---- V3.2 class abilities
    case 'overwatch':
      return cls === 'ranger' && !h.overwatch ? [{ id: h.heroId }] : [];
    case 'knockback':
      if (cls !== 'ranger') return [];
      return enemiesInSight(c, h, KNOCKBACK_RANGE).filter((t) => c.d.monsters.find((m) => m.id === t.id)?.kind !== 'dragon');
    case 'throwCharge': {
      if (cls !== 'sapper') return [];
      const ch = itemOf(h, 'charge');
      if (!ch) return [];
      const pending = c.d.charges ?? [];
      return hexesInSight(c, h, THROW_CHARGE_RANGE, (p) => !samePos(p, h.at) && (isFloorish(c.w, c.d, p) || kindAt(c.w, c.d, p) === 'cracked' || kindAt(c.w, c.d, p) === 'pit') && !pending.some((x) => samePos(x.at, p)))
        .map((t) => ({ ...t, itemId: ch.id }));
    }
    case 'dig':
      if (cls !== 'sapper') return [];
      return posNeighbors(h.at).filter((p) => { const k = kindAt(c.w, c.d, p); return k === 'rubble' || k === 'cracked'; }).map((at) => ({ at }));
    case 'fireball':
      if (!mage('pyromancer', 2)) return [];
      return hexesInSight(c, h, FIREBALL_RANGE, (p) => isFloorish(c.w, c.d, p) || kindAt(c.w, c.d, p) === 'pit');
    case 'veil':
      if (!mage('shadowmancer', 1)) return [];
      return alliesWithin(c, h, SPELL_RANGE).filter((t) => (hd(c, t.id!)?.veil ?? 0) === 0);
    case 'sleep':
      if (!mage('shadowmancer', 1)) return [];
      return enemiesInSight(c, h, SLEEP_RANGE, { noDragon: true, monstersOnly: true }).filter((t) => c.d.monsters.find((m) => m.id === t.id)?.awareness !== 'asleep');
    case 'blink':
      if (!mage('shadowmancer', 1)) return [];
      return hexesInSight(c, h, BLINK_RANGE, (p) => !samePos(p, h.at) && standable(c.w, c.d, p) && !occupant(c, p));
    case 'ward':
      if (!mage('hedgewitch', 1)) return [];
      return alliesWithin(c, h, SPELL_RANGE).filter((t) => (hd(c, t.id!)?.ward ?? 0) === 0);
    case 'gust':
      if (!mage('hedgewitch', 1)) return [];
      return hexesInSight(c, h, GUST_RANGE, (p) => isFloorish(c.w, c.d, p) || kindAt(c.w, c.d, p) === 'pit');
    // ---- V3.2 items
    case 'smoke':
    case 'glue':
    case 'firecracker': {
      const it = itemOf(h, action);
      if (!it) return [];
      return hexesInSight(c, h, THROW_RANGE[action], (p) => isFloorish(c.w, c.d, p) || kindAt(c.w, c.d, p) === 'pit').map((t) => ({ ...t, itemId: it.id }));
    }
    case 'dart': {
      const it = itemOf(h, 'dart');
      if (!it) return [];
      return enemiesInSight(c, h, THROW_RANGE.dart, { noDragon: true, monstersOnly: true })
        .filter((t) => c.d.monsters.find((m) => m.id === t.id)?.awareness !== 'asleep')
        .map((t) => ({ ...t, itemId: it.id }));
    }
    case 'caltrops': {
      const it = itemOf(h, 'caltrops');
      if (!it) return [];
      return posNeighbors(h.at)
        .filter((p) => standable(c.w, c.d, p) && !occupant(c, p) && !c.d.caltrops.includes(posKey(p)) && !c.d.traps[posKey(p)])
        .map((at) => ({ at, itemId: it.id }));
    }
    case 'key': {
      const it = itemOf(h, 'key');
      if (!it) return [];
      return aroundAndSelf(h.at).filter((p) => { const l = lockedThingAt(c, p); return l && !l.jammed; }).map((at) => ({ at, itemId: it.id }));
    }
    case 'oil': {
      const it = itemOf(h, 'oil');
      return it && c.d.light < LIGHT_MAX ? [{ id: h.heroId, itemId: it.id }] : [];
    }
    case 'grapple': {
      const it = itemOf(h, 'hook');
      if (!it) return [];
      const g = grappleTop(c, h.at, h.heroId);
      if (!g) return [];
      return [{ at: g.to ?? g.pit, itemId: it.id }];
    }
    case 'winch':
      if (c.d.liftWorking) return [];
      { const wp = nextToWinch(c, h.at); return wp ? [{ at: wp }] : []; }
    case 'firebolt':
      if (!mage('pyromancer', 1)) return [];
      return enemiesInSight(c, h, 5);
    case 'pick':
      if (cls !== 'burglar') return [];
      return aroundAndSelf(h.at).filter((p) => { const l = lockedThingAt(c, p); return l && !l.jammed; }).map((at) => ({ at }));
    case 'smash':
      return aroundAndSelf(h.at).filter((p) => lockedThingAt(c, p)).map((at) => ({ at }));
    case 'open': {
      const out: ActionTarget[] = [];
      for (const p of posNeighbors(h.at)) {
        if (kindAt(c.w, c.d, p) !== 'door') continue;
        const door = doorAt(c.d, p);
        if (!door || door.locked || c.d.blown.includes(posKey(p))) continue;
        if (door.open && occupant(c, p)) continue;
        out.push({ at: p });
      }
      if (!h.acted || cls === 'burglar') {
        for (const ch of c.d.chests) if (!ch.opened && !ch.locked && within(ch.at, h.at, 1)) out.push({ at: ch.at, id: ch.id });
      }
      return out;
    }
    case 'take':
      // Every pile in reach; a pile nothing can be taken from is a blocked target (spec 15.7).
      return c.d.ground.filter((g) => within(g.at, h.at, 1) && g.items.length).map((g) => ({ at: g.at }));
    case 'drop':
      return h.pack.map((i) => ({ itemId: i.id }));
    case 'give': {
      const out: ActionTarget[] = [];
      for (const o of others) {
        if (o.status !== 'active' || !adjacent(o.at, h.at)) continue;
        const room = PACK_SLOTS - packUsed(o.pack);
        for (const i of h.pack) if (i.slots <= room || i.kind === 'gold') out.push({ id: o.heroId, itemId: i.id });
      }
      return out;
    }
    case 'disarm':
      return aroundAndSelf(h.at).filter((p) => c.d.traps[posKey(p)]?.spotted).map((at) => ({ at }));
    case 'light':
      return posNeighbors(h.at).filter((p) => kindAt(c.w, c.d, p) === 'brazier' && !c.d.lit.includes(posKey(p))).map((at) => ({ at }));
    case 'torch': {
      const t = h.pack.find((i) => i.kind === 'torch');
      return t ? [{ itemId: t.id }] : [];
    }
    case 'potion': {
      const pot = h.pack.find((i) => i.kind === 'potion');
      if (!pot) return [];
      const out: ActionTarget[] = [];
      if (h.hp < def.maxHp) out.push({ id: h.heroId, itemId: pot.id });
      for (const o of others) {
        if (!adjacent(o.at, h.at)) continue;
        const od = heroDef(c, o.heroId)!;
        if (o.status === 'downed' || (o.status === 'active' && o.hp < od.maxHp)) out.push({ id: o.heroId, itemId: pot.id });
      }
      return out;
    }
    case 'revive':
      return others.filter((o) => o.status === 'downed' && adjacent(o.at, h.at)).map((o) => ({ id: o.heroId, at: o.at }));
    case 'charge': {
      const ch = h.pack.find((i) => i.kind === 'charge');
      if (!ch) return [];
      const pending = c.d.charges ?? [];
      return posNeighbors(h.at)
        .filter((p) => (lockedThingAt(c, p) || (kindAt(c.w, c.d, p) === 'cracked')) && !pending.some((x) => samePos(x.at, p)))
        .map((at) => ({ at, itemId: ch.id }));
    }
    case 'rope': {
      const r = h.pack.find((i) => i.kind === 'rope');
      if (!r || !droppablePits(c, h.at, h.heroId).length || c.d.ropes.includes(posKey(h.at))) return [];
      return [{ at: h.at, itemId: r.id }];
    }
    case 'climb': {
      const out: ActionTarget[] = [];
      const seen = new Set<string>();
      if (c.d.ropes.includes(posKey(h.at))) {
        for (const p of droppablePits(c, h.at, h.heroId)) {
          const f = fallInfo(c, p, h.heroId)!;
          if (seen.has(posKey(f.to))) continue;
          seen.add(posKey(f.to));
          out.push({ at: f.to });
        }
      }
      for (const top of ropesUpFrom(c, h.at)) out.push({ at: top });
      return out;
    }
    case 'jump':
      return droppablePits(c, h.at, h.heroId).map((at) => ({ at }));
    case 'free': {
      const pr = c.d.prisoner;
      if (!pr || pr.dead || pr.out || !adjacent(pr.at, h.at)) return [];
      if (pr.freed && pr.escortedBy === h.heroId) return [];
      return [{ id: pr.id, at: pr.at }];
    }
    case 'bribe': {
      const cr = c.d.rivals;
      if (!cr || cr.stance === 'bribed' || partyGold(c) < 40) return [];
      return rivalsOnMap(c).filter((r) => within(r.at, h.at, 2)).map((r) => ({ id: r.id, at: r.at }));
    }
    case 'rally':
      return cls === 'hobart' && h.rallyCooldown === 0 ? [{ id: h.heroId }] : [];
    case 'guard':
      if (cls !== 'sellsword') return [];
      return others.filter((o) => o.status === 'active' && adjacent(o.at, h.at)).map((o) => ({ id: o.heroId }));
    case 'kindle':
      return mage('pyromancer', 1) && c.d.light < LIGHT_MAX ? [{ id: h.heroId }] : [];
    case 'mend': {
      if (!mage('hedgewitch', 1)) return [];
      return c.d.heroes
        .filter((o) => o.status === 'active' && within(o.at, h.at, 3) && o.hp < heroDef(c, o.heroId)!.maxHp)
        .map((o) => ({ id: o.heroId }));
    }
    case 'passLantern':
      if (c.d.lanternBearer !== h.heroId) return [];
      return others.filter((o) => o.status === 'active' && adjacent(o.at, h.at)).map((o) => ({ id: o.heroId }));
    case 'leave':
      return kindAt(c.w, c.d, h.at) === 'exit' ? [{ at: h.at }] : [];
  }
  return [];
}

const LABELS: Record<ActionKind, string> = {
  attack: 'Attack', pick: 'Pick lock', smash: 'Smash', open: 'Open', take: 'Take', drop: 'Drop', give: 'Give',
  disarm: 'Disarm', light: 'Light brazier', torch: 'Light torch', potion: 'Potion', revive: 'Revive',
  charge: 'Place charge', rope: 'Anchor rope', climb: 'Climb', jump: 'Jump down', shove: 'Shove', free: 'Free',
  bribe: 'Bribe (40 gold)', rally: 'Rally', guard: 'Guard', firebolt: 'Firebolt', kindle: 'Kindle', mend: 'Mend',
  passLantern: 'Pass lantern', winch: 'Work the winch', leave: 'Leave castle',
  overwatch: 'Overwatch', knockback: 'Knockback shot', throwCharge: 'Throw charge', dig: 'Dig', fireball: 'Fireball',
  veil: 'Veil', sleep: 'Sleep', blink: 'Blink', ward: 'Ward', gust: 'Gust',
  smoke: 'Smoke bomb', glue: 'Glue bomb', dart: 'Sleep dart', caltrops: 'Caltrops', firecracker: 'Firecracker',
  key: 'Skeleton key', oil: 'Oil flask', grapple: 'Grapple up',
};

const ROLLS: ActionKind[] = ['attack', 'pick', 'smash', 'disarm', 'shove', 'firebolt', 'knockback', 'fireball', 'sleep', 'dart'];
const ORDER: ActionKind[] = [
  'attack', 'knockback', 'overwatch', 'firebolt', 'fireball', 'sleep', 'gust', 'shove', 'pick', 'smash', 'key', 'open', 'take', 'free', 'revive', 'potion', 'mend',
  'ward', 'veil', 'blink', 'kindle', 'oil', 'rally', 'guard', 'light', 'torch', 'disarm', 'charge', 'throwCharge', 'dig', 'smoke', 'glue', 'dart',
  'caltrops', 'firecracker', 'winch', 'rope', 'climb', 'grapple', 'jump', 'bribe', 'passLantern', 'give', 'drop', 'leave',
];

/** How the UI targets each action (ActionOption.pick). */
const PICK: Record<ActionKind, ActionOption['pick']> = {
  attack: 'enemy', pick: 'other', smash: 'other', open: 'other', take: 'hex', drop: 'item', give: 'other', disarm: 'hex',
  light: 'hex', torch: 'self', potion: 'ally', revive: 'ally', charge: 'hex', rope: 'self', climb: 'hex', jump: 'hex',
  shove: 'enemy', free: 'other', bribe: 'enemy', rally: 'self', guard: 'ally', firebolt: 'enemy', kindle: 'self', mend: 'ally',
  passLantern: 'ally', winch: 'self', leave: 'self',
  overwatch: 'self', knockback: 'enemy', throwCharge: 'hex', dig: 'hex', fireball: 'hex', veil: 'ally', sleep: 'enemy',
  blink: 'hex', ward: 'ally', gust: 'hex', smoke: 'hex', glue: 'hex', dart: 'enemy', caltrops: 'hex', firecracker: 'hex',
  key: 'hex', oil: 'self', grapple: 'self',
};
const AREA: Partial<Record<ActionKind, number>> = { fireball: 1, gust: 1, smoke: 1, glue: 1, charge: 2, throwCharge: 2 };
const MANA_COST: Partial<Record<ActionKind, number>> = { firebolt: 1, kindle: 1, mend: 1, fireball: 2, veil: 1, sleep: 1, blink: 1, ward: 1, gust: 1 };
/** Attacks break a Veil (spec 15.3). */
const VEIL_BREAKERS: ActionKind[] = ['attack', 'knockback', 'firebolt', 'fireball', 'shove', 'gust', 'smash'];
/** Whole-turn actions: need both move and action. */
const WHOLE_TURN: ActionKind[] = ['climb', 'jump', 'grapple'];

function canDo(h: HeroInDelve, action: ActionKind): boolean {
  if (WHOLE_TURN.includes(action)) return !h.moved && !h.acted;
  if (FREE.includes(action)) return true;
  return !h.acted;
}

export function actions(c: Ctx, heroId: string): ActionOption[] {
  const h = hd(c, heroId);
  if (!h || h.status !== 'active' || c.d.phase !== 'player' || c.s.stage !== 'delve') return [];
  const out: ActionOption[] = [];
  for (const a of ORDER) {
    if (!canDo(h, a)) continue;
    const t = targetsFor(c, h, a);
    if (!t.length) continue;
    const opt: ActionOption = { action: a, label: LABELS[a], targets: t, rolls: ROLLS.includes(a), pick: PICK[a] };
    if (AREA[a]) opt.area = AREA[a];
    if (MANA_COST[a]) opt.mana = MANA_COST[a];
    // Blocked options (spec 15.7): listed, with the reason, when none of the targets can be done now.
    if (a === 'take') {
      const plans = t.map((x) => takePlan(c, h, x.at!));
      if (plans.every((p) => p.blocked)) opt.blocked = plans[0]!.blocked;
    } else if (a === 'grapple') {
      const g = grappleTop(c, h.at, h.heroId);
      if (g && !g.to) opt.blocked = 'No room at the top of the pit.';
    }
    out.push(opt);
  }
  return out;
}

function sameTarget(a: ActionTarget, b: ActionTarget): boolean {
  if (a.id !== undefined && b.id !== undefined && a.id !== b.id) return false;
  if (a.itemId !== undefined && b.itemId !== undefined && a.itemId !== b.itemId) return false;
  if (a.at && b.at && !samePos(a.at, b.at)) return false;
  return a.id !== undefined || a.itemId !== undefined || !!a.at || (b.id === undefined && b.itemId === undefined && !b.at);
}

export function findTarget(c: Ctx, h: HeroInDelve, action: ActionKind, t: ActionTarget): ActionTarget | undefined {
  const list = targetsFor(c, h, action);
  // Untargeted self actions accept an empty target.
  if (!t.id && !t.at && !t.itemId && list.length === 1) return list[0];
  return list.find((x) => sameTarget(t, x));
}

// ---------------------------------------------------------------- roll specs

export interface Spec {
  ok: boolean;
  reason?: string;
  stat?: Stat;
  slots: number;
  chance: number;
  modifiers: string[];
  outcomes: string[];
  noise: number;
  light: number;
  /** Damage per hit (attacks). */
  dmg?: number;
  warning?: string;
  confirm?: boolean;
  hexes?: Pos[];
  affects?: string[];
}

/** Figures (ids) standing on any of `hexes`. */
function figuresOn(c: Ctx, hexes: Pos[]): string[] {
  const out: string[] = [];
  for (const p of hexes) {
    const o = occupant(c, p);
    if (o) out.push(o.id);
  }
  return out;
}

function areaOf(c: Ctx, at: Pos, radius: number): Pos[] {
  return range(at, radius).map((x) => ({ level: at.level, ...x })).filter((p) => !!c.w.tile(p));
}

function foe(c: Ctx, id?: string) {
  if (!id) return undefined;
  const m = c.d.monsters.find((x) => x.id === id);
  if (m) return { at: m.at, asleep: m.awareness === 'asleep', hunting: m.awareness === 'hunting', monster: m };
  const r = rivalsOnMap(c).find((x) => x.id === id);
  if (r) return { at: r.at, asleep: false, hunting: c.d.rivals?.stance === 'hostile', monster: undefined };
  return undefined;
}

function sign(n: number): string {
  return n >= 0 ? `+${n}%` : `−${-n}%`;
}

export function spec(c: Ctx, heroId: string, action: ActionKind, target: ActionTarget): Spec {
  const no = (reason: string): Spec => ({ ok: false, reason, slots: 0, chance: 0, modifiers: [], outcomes: [], noise: 0, light: 0 });
  const h = hd(c, heroId);
  if (!h || c.s.stage !== 'delve') return no('Not in a delve.');
  if (h.status !== 'active') return no(`${heroName(c, heroId)} can't act.`);
  if (c.d.phase !== 'player') return no('Wait for your turn.');
  if (!canDo(h, action)) return no(action === 'climb' || action === 'jump' ? 'Needs both move and action.' : `${heroName(c, heroId)} has already acted.`);
  const t = findTarget(c, h, action, target);
  if (!t) return no('No valid target.');
  const def = heroDef(c, heroId)!;
  const cls = CLASSES[def.cls];
  const mods: string[] = [];
  const bright = brightnessAt(c.w, c, h.at);
  const lightMod = LIGHT_PENALTY[bright];
  const withLight = (p: number) => {
    if (lightMod) mods.push(`${bright[0]!.toUpperCase()}${bright.slice(1)} ${sign(lightMod)}`);
    return p + lightMod;
  };
  const base = (stat: Stat, slots: number, p: number, outcomes: string[], noise: number, dmg?: number): Spec => ({
    ok: true, stat, slots, chance: Math.max(5, Math.min(95, Math.round(p))), modifiers: mods, outcomes, noise, light: 0, dmg,
  });
  const simple = (text: string, noise = 0, light = 0): Spec => ({ ok: true, slots: 0, chance: 0, modifiers: [], outcomes: [text], noise, light });
  const withMana = (sp: Spec, n: number): Spec => { sp.modifiers.push(`${n} mana`); return sp; };

  switch (action) {
    case 'attack': {
      const f = foe(c, t.id)!;
      let slots = cls.weapon.slots;
      let p = withLight(def.stats[cls.weapon.stat]);
      if (def.weaponTier) { p += 10 * def.weaponTier; mods.push(`Weapon ${sign(10 * def.weaponTier)}`); }
      if (f.asleep) { p += 20; mods.push('Asleep +20%'); }
      if (def.cls === 'burglar' && f.monster && !f.hunting) { slots += 1; mods.push('Backstab +1 slot'); }
      const ranged = !!cls.weapon.range;
      if (ranged && c.w.tile(h.at)?.raised) { p += 10; mods.push('Raised +10%'); }
      if (ranged && adjacent(h.at, f.at)) { slots -= 1; mods.push('Adjacent −1 slot'); }
      const across = { level: f.at.level, q: 2 * f.at.q - h.at.q, r: 2 * f.at.r - h.at.r };
      if (adjacent(h.at, f.at) && c.d.heroes.some((o) => o !== h && o.status === 'active' && samePos(o.at, across))) { slots += 1; mods.push('Flanked +1 slot'); }
      const armor = f.monster ? (MONSTERS[f.monster.kind].armor ?? 0) : 0;
      if (armor) mods.push(`Armor −${armor} dmg per hit`);
      const dmg = Math.max(1, cls.weapon.dmg - armor);
      const outcomes = [];
      for (let i = 0; i <= slots; i++) outcomes.push(i === 0 ? 'Miss' : `${i * dmg + (i === slots ? 1 : 0)} dmg`);
      return base(cls.weapon.stat, slots, p, outcomes, cls.weapon.noise ?? 2, dmg);
    }
    case 'knockback': {
      const f = foe(c, t.id)!;
      let p = withLight(def.stats.finesse);
      if (def.weaponTier) { p += 10 * def.weaponTier; mods.push(`Weapon ${sign(10 * def.weaponTier)}`); }
      if (f.asleep) { p += 20; mods.push('Asleep +20%'); }
      const o = pushOutcome(c, pusherFor(h.at, f.at), f.at, t.id);
      const sp = base('finesse', 2, p, ['Miss', 'Miss', pushText(o, 0)], cls.weapon.noise ?? 1);
      sp.hexes = [o.dest];
      if (o.kind === 'fall' && o.fall) sp.warning = `${f.monster?.name ?? 'It'} would fall ${o.fall.levels === 1 ? '1 level' : `${o.fall.levels} levels`} into ${o.fall.levelName}.`;
      return sp;
    }
    case 'overwatch':
      return simple('Shoot the first enemy that moves or acts in sight within 6', cls.weapon.noise ?? 1);
    case 'throwCharge': {
      const sp = simple('Blows at end of turn: 4 dmg within 1, 2 within 2', 8);
      sp.hexes = areaOf(c, t.at!, 2);
      sp.affects = figuresOn(c, sp.hexes);
      return sp;
    }
    case 'dig':
      return simple(kindAt(c.w, c.d, t.at!) === 'rubble' ? 'Clears the rubble' : 'Breaks through the cracked wall', DIG_NOISE);
    case 'fireball': {
      let p = withLight(def.stats.wits);
      if (c.w.tile(h.at)?.raised) { p += 10; mods.push('Raised +10%'); }
      const outcomes = [];
      for (let i = 0; i <= 3; i++) outcomes.push(i === 0 ? 'Fizzles' : `${i * 2 + (i === 3 ? 1 : 0)} dmg to everyone there`);
      const sp = withMana(base('wits', 3, p, outcomes, FIREBALL_NOISE, 2), 2);
      sp.hexes = areaOf(c, t.at!, 1);
      sp.affects = figuresOn(c, sp.hexes);
      const allies = sp.affects.filter((id) => hd(c, id));
      if (allies.length) sp.warning = `Burns ${allies.map((id) => heroName(c, id)).join(' and ')} too.`;
      return sp;
    }
    case 'veil':
      return withMana(simple(`${heroName(c, t.id!)} is unseen by monsters for ${VEIL_ROUNDS} rounds`), 1);
    case 'sleep': {
      const p = withLight(def.stats.wits);
      return withMana(base('wits', 2, p, ['No effect', 'Asleep', 'Asleep'], 0), 1);
    }
    case 'blink':
      return withMana(simple(`Teleport to ${c.w.roomName(t.at!).toLowerCase()}. Silent`), 1);
    case 'ward':
      return withMana(simple(`${heroName(c, t.id!)} takes 1 less per hit for ${WARD_ROUNDS} rounds`), 1);
    case 'gust': {
      const sp = withMana(simple('Everyone within 1 is pushed 1 hex away', GUST_NOISE), 1);
      sp.hexes = areaOf(c, t.at!, 1);
      sp.affects = figuresOn(c, sp.hexes).filter((id) => !samePos(figurePos(c, id)!, t.at!));
      const falls = sp.affects.filter((id) => pushOutcome(c, t.at!, figurePos(c, id)!, id).kind === 'fall');
      if (falls.length) sp.warning = `${falls.map((id) => nameOfAny(c, id)).join(', ')} would go over the edge.`;
      return sp;
    }
    case 'smoke': {
      const sp = simple(`Smoke there for ${SMOKE_ROUNDS} rounds: blocks sight both ways`);
      sp.hexes = areaOf(c, t.at!, 1);
      return sp;
    }
    case 'glue': {
      const sp = simple(`Monsters within 1 are stuck for ${GLUE_ROUNDS} rounds`);
      sp.hexes = areaOf(c, t.at!, 1);
      sp.affects = figuresOn(c, sp.hexes).filter((id) => c.d.monsters.some((m) => m.id === id));
      return sp;
    }
    case 'dart': {
      const f = foe(c, t.id)!;
      let p = withLight(def.stats.finesse);
      if (f.asleep) { p += 20; mods.push('Asleep +20%'); }
      return base('finesse', 1, p, ['Miss', 'Asleep'], 0);
    }
    case 'caltrops':
      return simple('The first monster to step here takes 2 and stops');
    case 'firecracker':
      return simple(`Noise ${FIRECRACKER_NOISE} there`, FIRECRACKER_NOISE);
    case 'key':
      return simple(lockedThingAt(c, t.at!)?.chest ? 'Opens the chest, silently' : 'Opens the door, silently');
    case 'oil':
      return simple(`+${OIL_LIGHT} light`, 0, OIL_LIGHT);
    case 'grapple': {
      const g = grappleTop(c, h.at, heroId);
      if (!g || !g.to) return no('No room at the top of the pit.');
      return simple(`Climb up to ${c.w.levelName(g.to.level)}`);
    }
    case 'firebolt': {
      const f = foe(c, t.id)!;
      let p = withLight(def.stats.wits);
      if (c.w.tile(h.at)?.raised) { p += 10; mods.push('Raised +10%'); }
      if (f.asleep) { p += 20; mods.push('Asleep +20%'); }
      const armor = f.monster ? (MONSTERS[f.monster.kind].armor ?? 0) : 0;
      if (armor) mods.push(`Armor −${armor} dmg per hit`);
      const bd = Math.max(1, 2 - armor);
      const outcomes = [];
      for (let i = 0; i <= 3; i++) outcomes.push(i === 0 ? 'Miss' : `${i * bd + (i === 3 ? 1 : 0)} dmg`);
      const s = base('wits', 3, p, outcomes, 3, bd);
      s.modifiers.push('1 mana');
      return s;
    }
    case 'pick':
      return base('finesse', 3, withLight(def.stats.finesse), ['Lock jams', 'Fails', 'Opens, noise 2', 'Opens silently'], 2);
    case 'smash': {
      const l = lockedThingAt(c, t.at!)!;
      const outcomes = l.chest ? ['Holds, noise 4', 'Opens, noise 4', 'Opens, noise 4'] : ['Holds, noise 4', 'Holds, noise 4', 'Opens, noise 4'];
      return base('might', 2, withLight(def.stats.might), outcomes, 4);
    }
    case 'disarm':
      return base('finesse', 2, withLight(def.stats.finesse), ['Sets it off: 3 dmg', 'Disarmed', 'Disarmed'], 2);
    case 'shove': {
      const f = foe(c, t.id)!;
      const o = pushOutcome(c, h.at, f.at, t.id);
      const slots = def.cls === 'sellsword' ? 3 : 2;
      if (slots === 3) mods.push('Sellsword +1 slot');
      const outcomes: string[] = [];
      for (let i = 0; i <= slots; i++) outcomes.push(i < 2 ? 'Nothing' : pushText(o, i === slots ? 1 : 0));
      const sp = base('might', slots, withLight(def.stats.might), outcomes, 2);
      sp.hexes = [o.dest];
      if (o.kind === 'fall' && o.fall) sp.warning = `${f.monster?.name ?? 'It'} would fall ${o.fall.levels === 1 ? '1 level' : `${o.fall.levels} levels`} into ${o.fall.levelName}.`;
      return sp;
    }
    case 'open':
      if (t.id) return simple('Opens the chest');
      return simple(doorAt(c.d, t.at!)?.open ? 'Closes the door' : 'Opens the door');
    case 'take': {
      const plan = takePlan(c, h, t.at!);
      if (plan.blocked) return no(plan.blocked);
      return simple(`Takes ${plan.items.map((i) => i.name).join(', ')}`);
    }
    case 'drop': return simple('Drop it here');
    case 'give': return simple(`Hand to ${heroName(c, t.id!)}`);
    case 'light': return simple('+6 light, lit for good', 0, 6);
    case 'torch': return simple(`Torchlight for ${TORCH_ROUNDS} rounds`);
    case 'potion': {
      const o = hd(c, t.id!)!;
      return simple(o.status === 'downed' ? 'Back up with 5 HP' : 'Heal 5');
    }
    case 'revive': return simple('Back up with 3 HP, wounded after');
    case 'charge': return simple('Blows at end of turn: 4 dmg within 1, 2 within 2', 8);
    case 'rope': return simple('Rope anchored here');
    case 'climb': return simple(t.at!.level < h.at.level ? 'Climb up the rope' : 'Climb down the rope, no damage');
    case 'jump': {
      const f = fallInfo(c, t.at!, heroId)!;
      const lv = f.levels === 1 ? '1 level' : `${f.levels} levels`;
      const s = simple(`Falls ${lv}: ${f.damage} dmg`);
      let warn = `Falls ${lv} into ${f.levelName}: ${f.damage} damage.`;
      if (h.hp <= f.damage) warn += ` This will down ${def.name}.`;
      s.warning = warn;
      if (f.levels > 1) s.confirm = true;
      return s;
    }
    case 'winch': return simple(`The lift runs for the rest of the delve. Noise ${WINCH_NOISE}`, WINCH_NOISE);
    case 'free': return simple(c.d.prisoner?.freed ? 'Take over the escort' : 'Free the prisoner');
    case 'bribe': return simple('Pay 40 gold: they leave');
    case 'rally': return simple('+1 Focus to allies within 3');
    case 'guard': return simple(`Take hits meant for ${heroName(c, t.id!)}`);
    case 'kindle': return withMana(simple('+12 light', 0, 12), 1);
    case 'mend': return withMana(simple('Heal 4'), 1);
    case 'passLantern': return simple(`${heroName(c, t.id!)} carries the lantern`);
    case 'leave': return simple('Leave the castle');
  }
  return no('Unknown action.');
}

// ---------------------------------------------------------------- doing it

function useItem(h: HeroInDelve, id?: string, kind?: Item['kind']): Item | undefined {
  const i = h.pack.findIndex((x) => (id ? x.id === id : x.kind === kind));
  if (i < 0) return undefined;
  return h.pack.splice(i, 1)[0];
}

function figurePos(c: Ctx, id: string): Pos | undefined {
  const m = c.d.monsters.find((x) => x.id === id);
  if (m) return m.at;
  const r = rivalsOnMap(c).find((x) => x.id === id);
  if (r) return r.at;
  if (c.d.prisoner?.id === id) return c.d.prisoner.at;
  return hd(c, id)?.at;
}

function nameOfAny(c: Ctx, id: string): string {
  return c.d.monsters.find((x) => x.id === id)?.name ?? rivalsOnMap(c).find((x) => x.id === id)?.name ?? (c.d.prisoner?.id === id ? c.d.prisoner.name : heroName(c, id));
}

/** A monster falls asleep (Sleep spell, sleep dart). */
export function putToSleep(c: Ctx, m: MonsterX): void {
  m.awareness = 'asleep';
  m.intent = undefined;
  m.focusAt = undefined;
  m.shoveFrom = undefined;
  c.ev.push({ type: 'awake', id: m.id, awareness: 'asleep' });
  say(c, `${m.name} slumps, asleep.`);
}

/** Set hexes burning (fireball). */
function ignite(c: Ctx, hexes: Pos[]): void {
  for (const p of hexes) if (isFloorish(c.w, c.d, p)) c.d.burning[posKey(p)] = BURN_ROUNDS;
}

/** Smoke in and around `at`: sight blocked, monsters inside lose track. */
function smokeOut(c: Ctx, at: Pos): Pos[] {
  const hexes = areaOf(c, at, 1).filter((p) => isFloorish(c.w, c.d, p) || kindAt(c.w, c.d, p) === 'pit');
  for (const p of hexes) c.d.smoke[posKey(p)] = SMOKE_ROUNDS;
  for (const m of c.d.monsters) {
    if (m.kind === 'gloam' || m.kind === 'dragon' || m.awareness !== 'hunting') continue;
    if (hexes.some((p) => samePos(p, m.at))) {
      m.awareness = 'alert';
      c.ev.push({ type: 'awake', id: m.id, awareness: 'alert' });
    }
  }
  return hexes;
}

function openDoor(c: Ctx, at: Pos): void {
  const door = doorAt(c.d, at)!;
  door.open = true;
  door.locked = false;
  door.jammed = false;
  c.ev.push({ type: 'doorChanged', at, open: true, locked: false });
}

function openChest(c: Ctx, chestId: string, by: string): void {
  const ch = c.d.chests.find((x) => x.id === chestId)!;
  ch.opened = true;
  ch.locked = false;
  const items = chestLoot(c, ch.tier);
  putOnGround(c, ch.at, items);
  c.ev.push({ type: 'chestOpened', id: ch.id, items });
  void by;
}

function unlockAt(c: Ctx, at: Pos, by: string): void {
  if (kindAt(c.w, c.d, at) === 'door') return openDoor(c, at);
  const ch = c.d.chests.find((x) => samePos(x.at, at) && !x.opened);
  if (ch) openChest(c, ch.id, by);
}

export function doAct(c: Ctx, heroId: string, action: ActionKind, target: ActionTarget, focus: number): string | undefined {
  const sp = spec(c, heroId, action, target);
  if (!sp.ok) return sp.reason;
  const h = hd(c, heroId)!;
  const t = findTarget(c, h, action, target)!;
  const def = heroDef(c, heroId)!;
  const name = def.name;
  if (focus < 0 || focus > Math.min(h.focus, sp.slots)) return 'Not that much Focus.';
  if (!FREE.includes(action)) h.acted = true;
  if (action === 'open' && t.id && def.cls !== 'burglar') h.acted = true;
  if (WHOLE_TURN.includes(action)) h.moved = true;
  if (MANA_COST[action]) h.mana -= MANA_COST[action]!;
  // Attacking or making a loud noise breaks a Veil (spec 15.3).
  if (h.veil > 0 && (VEIL_BREAKERS.includes(action) || sp.noise >= VEIL_BREAK_NOISE)) {
    h.veil = 0;
    say(c, `${name} steps out of the shadows.`);
  }
  const doRoll = () => {
    h.focus -= focus;
    return roll(c, heroId, LABELS[action], sp.slots, sp.chance, focus);
  };
  const throwEv = (kind: Item['kind'], to: Pos) => c.ev.push({ type: 'thrown', by: heroId, kind, from: { ...h.at }, to: { ...to } });

  switch (action) {
    case 'knockback': {
      const r = doRoll();
      const tid = t.id!;
      makeNoise(c, h.at, sp.noise);
      if (c.d.rivals?.members.some((x) => x.id === tid)) makeHostile(c);
      wakeTarget(c, tid, h.at);
      if (r.hits < 2) {
        c.ev.push({ type: 'miss', attacker: heroId, target: tid });
        break;
      }
      c.ev.push({ type: 'cast', by: heroId, spell: 'knockback', targetId: tid, at: figurePos(c, tid) });
      const from = pusherFor(h.at, figurePos(c, tid)!);
      push(c, tid, from, heroId);
      break;
    }
    case 'overwatch':
      h.overwatch = true;
      c.ev.push({ type: 'cast', by: heroId, spell: 'overwatch' });
      say(c, `${name} nocks an arrow and waits.`);
      break;
    case 'throwCharge':
      useItem(h, t.itemId);
      throwEv('charge', t.at!);
      (c.d.charges ??= []).push({ at: t.at!, by: heroId });
      say(c, `${name} lobs a charge. Stand clear.`);
      break;
    case 'dig': {
      const k = kindAt(c.w, c.d, t.at!);
      c.d.blown.push(posKey(t.at!));
      c.ev.push({ type: 'dug', at: t.at! });
      say(c, k === 'rubble' ? `${name} clears the rubble.` : `${name} breaks through the wall.`);
      makeNoise(c, t.at!, DIG_NOISE);
      break;
    }
    case 'fireball': {
      const r = doRoll();
      const hexes = areaOf(c, t.at!, 1);
      c.ev.push({ type: 'cast', by: heroId, spell: 'fireball', at: t.at!, hexes });
      makeNoise(c, t.at!, FIREBALL_NOISE);
      ignite(c, hexes);
      say(c, `${name} hurls a fireball.`);
      if (!r.hits) break;
      for (const id of figuresOn(c, hexes)) {
        const m = c.d.monsters.find((x) => x.id === id);
        const armor = m ? (MONSTERS[m.kind].armor ?? 0) : hd(c, id) ? armorOf(heroDef(c, id)!) : 0;
        const dmg = r.hits * Math.max(1, 2 - armor) + (r.perfect ? 1 : 0);
        if (hd(c, id)) hurtHero(c, hd(c, id)!, dmg, heroId, r.perfect);
        else hurtAny(c, id, dmg, heroId, { crit: r.perfect });
      }
      break;
    }
    case 'veil': {
      const o = hd(c, t.id!)!;
      o.veil = VEIL_ROUNDS;
      c.ev.push({ type: 'cast', by: heroId, spell: 'veil', targetId: o.heroId });
      // Hunting monsters with no unveiled hero left in sight lose the trail.
      const lit = litSet(c.w, c.d);
      for (const m of c.d.monsters) {
        if (m.awareness !== 'hunting' || m.kind === 'gloam' || m.kind === 'dragon') continue;
        const seesSomeone = c.d.heroes.some((x) => x.status === 'active' && x.veil <= 0 && within(x.at, m.at, 6)
          && (distance(x.at, m.at) <= 2 || lit.has(posKey(x.at))) && los(c.w, c.d, m.at, x.at));
        if (seesSomeone) continue;
        m.awareness = 'alert';
        m.focusAt = { ...o.at };
        m.intent = undefined;
        c.ev.push({ type: 'awake', id: m.id, awareness: 'alert' });
      }
      break;
    }
    case 'sleep': {
      const r = doRoll();
      const m = c.d.monsters.find((x) => x.id === t.id)!;
      c.ev.push({ type: 'cast', by: heroId, spell: 'sleep', targetId: m.id, at: m.at });
      if (r.hits) putToSleep(c, m);
      else c.ev.push({ type: 'miss', attacker: heroId, target: m.id });
      break;
    }
    case 'blink': {
      const from = { ...h.at };
      h.at = { ...t.at! };
      c.ev.push({ type: 'blinked', id: heroId, from, to: { ...h.at } });
      if (h.escorting && c.d.prisoner) c.d.prisoner.escortedBy = undefined;
      h.escorting = undefined;
      glimpse(c, h.at);
      ventCheck(c, h);
      afterHeroMove(c, h, true);
      break;
    }
    case 'ward': {
      const o = hd(c, t.id!)!;
      o.ward = WARD_ROUNDS;
      c.ev.push({ type: 'cast', by: heroId, spell: 'ward', targetId: o.heroId });
      break;
    }
    case 'gust': {
      const at = t.at!;
      const hexes = areaOf(c, at, 1);
      c.ev.push({ type: 'cast', by: heroId, spell: 'gust', at, hexes });
      makeNoise(c, at, GUST_NOISE);
      say(c, `${name} calls up a gust.`);
      const ids = figuresOn(c, hexes).filter((id) => !samePos(figurePos(c, id)!, at));
      for (const id of ids) {
        if (!figurePos(c, id)) continue;
        const isHero = !!hd(c, id);
        if (c.d.rivals?.members.some((x) => x.id === id)) makeHostile(c);
        if (!isHero) wakeTarget(c, id, h.at);
        push(c, id, at, isHero ? null : heroId);
      }
      break;
    }
    case 'smoke': {
      useItem(h, t.itemId);
      throwEv('smoke', t.at!);
      const hexes = smokeOut(c, t.at!);
      c.ev.push({ type: 'cast', by: heroId, spell: 'smoke', at: t.at!, hexes });
      say(c, 'Smoke billows up.');
      break;
    }
    case 'glue': {
      useItem(h, t.itemId);
      throwEv('glue', t.at!);
      const hexes = areaOf(c, t.at!, 1).filter((p) => isFloorish(c.w, c.d, p));
      for (const p of hexes) c.d.glue[posKey(p)] = GLUE_ROUNDS;
      c.ev.push({ type: 'cast', by: heroId, spell: 'glue', at: t.at!, hexes });
      for (const m of c.d.monsters) {
        if (m.kind === 'gloam' || m.kind === 'dragon') continue;
        if (hexes.some((p) => samePos(p, m.at))) {
          m.stuck = GLUE_ROUNDS;
          say(c, `${m.name} is stuck fast.`);
        }
      }
      break;
    }
    case 'dart': {
      useItem(h, t.itemId);
      const r = doRoll();
      const m = c.d.monsters.find((x) => x.id === t.id)!;
      throwEv('dart', m.at);
      if (r.hits) putToSleep(c, m);
      else c.ev.push({ type: 'miss', attacker: heroId, target: m.id });
      break;
    }
    case 'caltrops':
      useItem(h, t.itemId);
      throwEv('caltrops', t.at!);
      c.d.caltrops.push(posKey(t.at!));
      break;
    case 'firecracker':
      useItem(h, t.itemId);
      throwEv('firecracker', t.at!);
      say(c, 'Crack! The sound echoes down the halls.');
      makeNoise(c, t.at!, FIRECRACKER_NOISE);
      break;
    case 'key':
      useItem(h, t.itemId);
      unlockAt(c, t.at!, heroId);
      say(c, `${name} turns the skeleton key. Click.`);
      break;
    case 'oil':
      useItem(h, t.itemId);
      setLight(c, c.d.light + OIL_LIGHT);
      say(c, `${name} tops up the lantern.`);
      break;
    case 'grapple': {
      const g = grappleTop(c, h.at, heroId)!;
      const from = h.at;
      h.at = { ...g.to! };
      c.ev.push({ type: 'moved', id: heroId, path: [h.at] });
      c.ev.push({ type: 'levelChanged', id: heroId, from: from.level, to: h.at.level });
      say(c, `${name} throws the hook and hauls up to ${c.w.levelName(h.at.level)}.`);
      if (h.escorting && c.d.prisoner) c.d.prisoner.escortedBy = undefined;
      h.escorting = undefined;
      glimpse(c, h.at);
      afterHeroMove(c, h);
      break;
    }
    case 'attack':
    case 'firebolt': {
      const r = doRoll();
      const tid = t.id!;
      makeNoise(c, h.at, sp.noise);
      if (c.d.rivals?.members.some((x) => x.id === tid)) makeHostile(c);
      if (r.hits === 0) {
        c.ev.push({ type: 'miss', attacker: heroId, target: tid });
        wakeTarget(c, tid, h.at);
      } else {
        const dmg = r.hits * (sp.dmg ?? 1) + (r.perfect ? 1 : 0);
        hurtAny(c, tid, dmg, heroId, { crit: r.perfect });
      }
      break;
    }
    case 'shove': {
      const r = doRoll();
      const tid = t.id!;
      makeNoise(c, h.at, sp.noise);
      if (c.d.rivals?.members.some((x) => x.id === tid)) makeHostile(c);
      if (r.hits < 2) {
        c.ev.push({ type: 'miss', attacker: heroId, target: tid });
        wakeTarget(c, tid, h.at);
        break;
      }
      wakeTarget(c, tid, h.at);
      push(c, tid, h.at, heroId);
      // Perfect: 1 more damage on top of whatever the push did.
      if (r.perfect && (c.d.monsters.some((x) => x.id === tid) || rivalsOnMap(c).some((x) => x.id === tid))) hurtAny(c, tid, 1, heroId);
      break;
    }
    case 'pick': {
      const r = doRoll();
      const at = t.at!;
      const l = lockedThingAt(c, at)!;
      if (r.hits >= 2) {
        unlockAt(c, at, heroId);
        if (r.hits === 2) makeNoise(c, at, 2);
        say(c, r.hits === 3 ? `${name} slips the lock.` : `${name} forces the lock. Clunk.`);
      } else if (r.hits === 1) {
        say(c, `The lock holds.`);
      } else {
        if (l.door) doorAt(c.d, at)!.jammed = true;
        else c.d.chests.find((x) => samePos(x.at, at) && !x.opened)!.jammed = true;
        say(c, `The pick snaps in the lock. It's jammed.`);
      }
      break;
    }
    case 'smash': {
      const r = doRoll();
      const at = t.at!;
      const l = lockedThingAt(c, at)!;
      makeNoise(c, at, 4);
      if (r.hits >= (l.chest ? 1 : 2)) {
        unlockAt(c, at, heroId);
        say(c, `${name} smashes it open.`);
      } else say(c, 'It holds. Everyone heard that.');
      break;
    }
    case 'disarm': {
      const r = doRoll();
      const at = t.at!;
      if (r.hits > 0) {
        delete c.d.traps[posKey(at)];
        say(c, `${name} disarms the trap.`);
      } else {
        delete c.d.traps[posKey(at)];
        c.ev.push({ type: 'trap', at, id: heroId, damage: 3 });
        say(c, `The trap goes off in ${name}'s hands.`);
        hurtHero(c, h, 3, 'trap');
        makeNoise(c, at, 2);
      }
      break;
    }
    case 'open': {
      if (t.id) {
        openChest(c, t.id, heroId);
        break;
      }
      const door = doorAt(c.d, t.at!)!;
      door.open = !door.open;
      c.ev.push({ type: 'doorChanged', at: t.at!, open: door.open, locked: door.locked });
      break;
    }
    case 'take': {
      const g = c.d.ground.find((x) => samePos(x.at, t.at!))!;
      const got: Item[] = [];
      const left: Item[] = [];
      const plan = takePlan(c, h, t.at!);
      const rest0 = g.items.filter((i) => !plan.items.includes(i));
      for (const it of [...plan.items, ...rest0]) {
        const before = it.amount;
        const rest = addToPack(c, h.pack, it);
        if (!rest) got.push(it);
        else {
          if (rest.amount !== before) got.push({ ...it, amount: before - rest.amount, name: `${before - rest.amount} gold` });
          left.push(rest);
        }
      }
      g.items = left;
      cleanGround(c);
      if (got.length) c.ev.push({ type: 'looted', id: heroId, items: got });
      if (got.some((i) => i.kind === 'heirloom')) say(c, `${name} has the heirloom. Now get out.`);
      break;
    }
    case 'drop': {
      const it = useItem(h, t.itemId);
      if (it) putOnGround(c, h.at, [it]);
      break;
    }
    case 'give': {
      const o = hd(c, t.id!)!;
      const it = useItem(h, t.itemId)!;
      const rest = addToPack(c, o.pack, it);
      if (rest) h.pack.push(rest);
      break;
    }
    case 'light': {
      c.d.lit.push(posKey(t.at!));
      c.ev.push({ type: 'brazierLit', at: t.at! });
      setLight(c, c.d.light + 6);
      say(c, `${name} lights the brazier.`);
      break;
    }
    case 'torch':
      useItem(h, t.itemId);
      h.torch = TORCH_ROUNDS;
      say(c, `${name} lights a torch.`);
      break;
    case 'potion': {
      useItem(h, t.itemId);
      const o = hd(c, t.id!)!;
      const od = heroDef(c, o.heroId)!;
      if (o.status === 'downed') {
        o.status = 'active';
        o.hp = 5;
        o.bleed = 0;
        c.ev.push({ type: 'revived', id: o.heroId });
      } else o.hp = Math.min(od.maxHp, o.hp + 5);
      break;
    }
    case 'revive': {
      const o = hd(c, t.id!)!;
      o.status = 'active';
      o.hp = 3;
      o.bleed = 0;
      o.revived = true;
      o.moved = true;
      o.acted = true;
      c.ev.push({ type: 'revived', id: o.heroId });
      say(c, `${heroName(c, o.heroId)} is back on their feet. Barely.`);
      break;
    }
    case 'charge':
      useItem(h, t.itemId);
      (c.d.charges ??= []).push({ at: t.at!, by: heroId });
      say(c, `${name} sets a charge. Stand clear.`);
      break;
    case 'rope':
      useItem(h, t.itemId);
      c.d.ropes.push(posKey(h.at));
      break;
    case 'climb': {
      const from = h.at;
      h.at = { ...t.at! };
      c.ev.push({ type: 'moved', id: heroId, path: [h.at] });
      if (from.level !== h.at.level) c.ev.push({ type: 'levelChanged', id: heroId, from: from.level, to: h.at.level });
      if (h.escorting && c.d.prisoner) c.d.prisoner.escortedBy = undefined;
      h.escorting = undefined;
      ventCheck(c, h);
      afterHeroMove(c, h);
      break;
    }
    case 'jump': {
      say(c, `${name} jumps.`);
      c.ev.push({ type: 'moved', id: heroId, path: [{ ...t.at! }] });
      fall(c, heroId, t.at!, null);
      break;
    }
    case 'winch': {
      c.d.liftWorking = true;
      c.ev.push({ type: 'liftWorking' });
      say(c, `${name} hauls on the winch. Chains rattle; the lift groans awake.`);
      makeNoise(c, h.at, WINCH_NOISE);
      break;
    }
    case 'free': {
      const pr = c.d.prisoner!;
      if (pr.escortedBy) {
        const old = hd(c, pr.escortedBy);
        if (old) old.escorting = undefined;
      }
      if (!pr.freed) {
        pr.freed = true;
        c.ev.push({ type: 'freed', prisonerId: pr.id });
        say(c, `${pr.name} is free. Stay close.`);
      }
      pr.escortedBy = heroId;
      h.escorting = pr.id;
      break;
    }
    case 'bribe': {
      let owe = 40;
      for (const o of c.d.heroes) {
        for (const it of o.pack) {
          if (it.kind !== 'gold' || owe <= 0) continue;
          const n = Math.min(it.amount, owe);
          it.amount -= n;
          it.name = `${it.amount} gold`;
          owe -= n;
        }
        o.pack = o.pack.filter((i) => i.kind !== 'gold' || i.amount > 0);
      }
      const cr = c.d.rivals!;
      cr.stance = 'bribed';
      cr.goal = 'leave';
      c.ev.push({ type: 'rivalsStance', stance: 'bribed' });
      for (const r of cr.members) {
        const hl = r.loot.filter((i) => i.kind === 'heirloom');
        if (hl.length) {
          r.loot = r.loot.filter((i) => i.kind !== 'heirloom');
          putOnGround(c, r.at, hl);
          say(c, `${r.name} drops the heirloom at your feet.`);
        }
      }
      say(c, 'The sisters pocket the coin and make for the door.');
      break;
    }
    case 'rally': {
      h.rallyCooldown = 3;
      for (const o of activeHeroes(c)) if (o !== h && within(o.at, h.at, 3)) o.focus = Math.min(FOCUS_MAX, o.focus + 1);
      say(c, `${name}: "Steady!"`);
      break;
    }
    case 'guard':
      h.guarding = t.id;
      break;
    case 'kindle':
      setLight(c, c.d.light + 12);
      break;
    case 'mend': {
      const o = hd(c, t.id!)!;
      o.hp = Math.min(heroDef(c, o.heroId)!.maxHp, o.hp + 4);
      break;
    }
    case 'passLantern':
      c.d.lanternBearer = t.id!;
      break;
    case 'leave':
      leaveCastle(c, h);
      break;
  }
  refreshSight(c);
  checkDelveEnd(c);
  return undefined;
}


function wakeTarget(c: Ctx, id: string, from: Pos): void {
  const m = c.d.monsters.find((x) => x.id === id);
  if (m && m.awareness !== 'hunting') {
    m.awareness = 'hunting';
    m.focusAt = { ...from };
    c.ev.push({ type: 'awake', id: m.id, awareness: 'hunting' });
  }
}

export function leaveCastle(c: Ctx, h: HeroInDelve): void {
  h.status = 'out';
  c.ev.push({ type: 'out', id: h.heroId });
  say(c, `${heroName(c, h.heroId)} is out.`);
  const pr = c.d.prisoner;
  if (pr && h.escorting === pr.id && !pr.dead && adjacent(pr.at, h.at)) {
    pr.out = true;
    c.ev.push({ type: 'out', id: pr.id });
  } else if (pr && h.escorting === pr.id) {
    pr.escortedBy = undefined;
  }
  h.escorting = undefined;
  passLanternIfNeeded(c);
}

export function abandon(c: Ctx): void {
  for (const h of c.d.heroes) {
    if (h.status === 'active' && kindAt(c.w, c.d, h.at) === 'exit') leaveCastle(c, h);
  }
  endDelve(c);
}

/** No active heroes left: the delve is over. */
export function checkDelveEnd(c: Ctx): boolean {
  if (c.s.stage !== 'delve') return true;
  if (c.d.heroes.some((h) => h.status === 'active')) return false;
  endDelve(c);
  return true;
}

export function endDelve(c: Ctx): void {
  for (const h of c.d.heroes) {
    if (h.status === 'active' || h.status === 'downed') {
      killHero(c, h);
      noteOnce(c, `${heroName(c, h.heroId)} was left behind.`);
    }
  }
  const pr = c.d.prisoner;
  if (pr && !pr.out && !pr.dead && pr.freed) noteOnce(c, `${pr.name} never made it out.`);
  const cr = c.d.rivals;
  if (cr && cr.entered) {
    const took = cr.members.flatMap((r) => r.loot);
    if (took.length) noteOnce(c, `The Lantern Sisters made off with ${valueOf(took)} gold in loot.`);
  }
  buildSummary(c);
}
