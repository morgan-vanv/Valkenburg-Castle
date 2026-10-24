// Hero commands during a delve: move, actions (with their targets, roll
// specs and effects), leave/abandon, the end of the delve.

import { distance, posKey, posNeighbors, samePos, type Pos } from './hex';
import type { ActionKind, ActionTarget, HeroInDelve, Item, Stat } from './types';
import type { ActionOption } from './api';
import { CLASSES, FOCUS_MAX, LIGHT_MAX, PACK_SLOTS, TORCH_ROUNDS } from './data';
import { say, type Ctx } from './state';
import {
  activeHeroes, addToPack, brightnessAt, chestLoot, cleanGround, hd, heroDef, heroName, hurtAny, hurtHero, killHero,
  killMonster, LIGHT_PENALTY, makeHostile, makeNoise, noteOnce, occupant, packUsed, passLanternIfNeeded, putOnGround,
  rivalsOnMap, roll, valueOf, wakeAdjacent,
} from './common';
import {
  adjacent, brightnessOf, canEnter, clampLight, dijkstra, doorAt, kindAt, litSet, los, pathTo, steps,
  visibleSet, within,
} from './world';
import { buildSummary } from './camp';

// ---------------------------------------------------------------- sight bookkeeping

/** After anything changes: explored grows, rivals get spotted, the Gloam fades in light. */
export function refreshSight(c: Ctx): void {
  const lit = litSet(c.w, c.d);
  const vis = visibleSet(c.w, c.d, lit);
  const ex = new Set(c.d.explored);
  for (const k of vis) if (!ex.has(k)) c.d.explored.push(k);
  const cr = c.d.rivals;
  if (cr && !cr.spotted && rivalsOnMap(c).some((r) => vis.has(posKey(r.at)))) {
    cr.spotted = true;
    say(c, `The Lantern Sisters. They want ${cr.goal === 'leave' ? 'out' : 'the loot'}.`);
  }
}

export function setLight(c: Ctx, value: number): void {
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

export function reachable(c: Ctx, heroId: string, sneak: boolean) {
  const h = hd(c, heroId);
  if (!h || h.status !== 'active' || h.moved || h.webbed || c.d.phase !== 'player') return [];
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
    out.push({ to: n.p, cost: n.cost, path: pathTo(nodes, n.p) });
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
  if (h.moved) return `${heroName(c, heroId)} has already moved.`;
  if (h.webbed) return `${heroName(c, heroId)} is stuck in a web.`;
  if (!path.length) return 'Pick a destination.';
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
  // Walk.
  h.moved = true;
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
    const trap = c.d.traps[posKey(p)];
    if (trap) {
      c.ev.push({ type: 'moved', id: heroId, path: [...walked] });
      walked.length = 0;
      springTrap(c, h, p);
      if (h.status !== 'active') break;
    }
  }
  if (walked.length) c.ev.push({ type: 'moved', id: heroId, path: [...walked] });
  afterHeroMove(c, h);
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
export function afterHeroMove(c: Ctx, h: HeroInDelve): void {
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
}

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

function enemiesAdjacent(c: Ctx, h: HeroInDelve): ActionTarget[] {
  const out: ActionTarget[] = [];
  for (const m of c.d.monsters) if (m.kind !== 'gloam' && adjacent(m.at, h.at)) out.push({ id: m.id, at: m.at });
  for (const r of rivalsOnMap(c)) if (adjacent(r.at, h.at)) out.push({ id: r.id, at: r.at });
  return out;
}

function freeLanding(c: Ctx, set: Pos[]): Pos[] {
  return set.filter((p) => canEnter(c.w, c.d, p) && !occupant(c, p));
}

function partyGold(c: Ctx): number {
  return c.d.heroes.filter((h) => h.status === 'active' || h.status === 'downed').reduce((n, h) => n + h.pack.filter((i) => i.kind === 'gold').reduce((a, i) => a + i.amount, 0), 0);
}

/** Every valid target for an action right now (ignores move/act flags). */
export function targetsFor(c: Ctx, h: HeroInDelve, action: ActionKind): ActionTarget[] {
  const def = heroDef(c, h.heroId)!;
  const cls = def.cls;
  const others = c.d.heroes.filter((x) => x !== h);
  switch (action) {
    case 'attack':
    case 'shove':
      return enemiesAdjacent(c, h);
    case 'firebolt': {
      if (cls !== 'mage' || h.mana < 1) return [];
      const vis = visibleSet(c.w, c.d);
      const out: ActionTarget[] = [];
      const cands = [...c.d.monsters.filter((m) => m.kind !== 'gloam'), ...rivalsOnMap(c)];
      for (const m of cands) {
        if (within(m.at, h.at, 5) && vis.has(posKey(m.at)) && los(c.w, c.d, h.at, m.at)) out.push({ id: m.id, at: m.at });
      }
      return out;
    }
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
      if (!h.acted) {
        for (const ch of c.d.chests) if (!ch.opened && !ch.locked && within(ch.at, h.at, 1)) out.push({ at: ch.at, id: ch.id });
      }
      return out;
    }
    case 'take': {
      const room = PACK_SLOTS - packUsed(h.pack);
      const out: ActionTarget[] = [];
      for (const g of c.d.ground) {
        if (!within(g.at, h.at, 1) || !g.items.length) continue;
        const fits = g.items.some((i) => i.slots <= room || (i.kind === 'gold' && h.pack.some((p) => p.kind === 'gold' && p.amount < 100)));
        if (fits) out.push({ at: g.at });
      }
      return out;
    }
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
      if (!r || !c.w.pitEdge.has(posKey(h.at)) || c.d.ropes.includes(posKey(h.at))) return [];
      return [{ at: h.at, itemId: r.id }];
    }
    case 'climb': {
      if (c.d.ropes.includes(posKey(h.at))) return freeLanding(c, c.w.landing).map((at) => ({ at }));
      if (c.w.landingSet.has(posKey(h.at))) {
        return freeLanding(c, c.d.ropes.map((k) => { const [lv, rest] = k.split(':'); const [q, r] = (rest ?? '').split(',').map(Number) as [number, number]; return { level: Number(lv), q, r }; })).map((at) => ({ at }));
      }
      return [];
    }
    case 'jump':
      if (!c.w.pitEdge.has(posKey(h.at))) return [];
      return freeLanding(c, c.w.landing).map((at) => ({ at }));
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
      return cls === 'mage' && h.mana >= 1 && c.d.light < LIGHT_MAX ? [{ id: h.heroId }] : [];
    case 'mend': {
      if (cls !== 'mage' || h.mana < 1) return [];
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
  passLantern: 'Pass lantern', leave: 'Leave castle',
};

const ROLLS: ActionKind[] = ['attack', 'pick', 'smash', 'disarm', 'shove', 'firebolt'];
const ORDER: ActionKind[] = [
  'attack', 'firebolt', 'shove', 'pick', 'smash', 'open', 'take', 'free', 'revive', 'potion', 'mend', 'kindle',
  'rally', 'guard', 'light', 'torch', 'disarm', 'charge', 'rope', 'climb', 'jump', 'bribe', 'passLantern', 'give',
  'drop', 'leave',
];

function canDo(h: HeroInDelve, action: ActionKind): boolean {
  if (action === 'climb' || action === 'jump') return !h.moved && !h.acted;
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
    if (t.length) out.push({ action: a, label: LABELS[a], targets: t, rolls: ROLLS.includes(a) });
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

  switch (action) {
    case 'attack': {
      const f = foe(c, t.id)!;
      let slots = cls.weapon.slots;
      let p = withLight(def.stats[cls.weapon.stat]);
      if (def.weaponTier) { p += 10 * def.weaponTier; mods.push(`Weapon ${sign(10 * def.weaponTier)}`); }
      if (f.asleep) { p += 20; mods.push('Asleep +20%'); }
      if (def.cls === 'burglar' && f.monster && !f.hunting) { slots += 1; mods.push('Backstab +1 slot'); }
      const across = { level: f.at.level, q: 2 * f.at.q - h.at.q, r: 2 * f.at.r - h.at.r };
      if (c.d.heroes.some((o) => o !== h && o.status === 'active' && samePos(o.at, across))) { slots += 1; mods.push('Flanked +1 slot'); }
      const dmg = cls.weapon.dmg;
      const outcomes = [];
      for (let i = 0; i <= slots; i++) outcomes.push(i === 0 ? 'Miss' : `${i * dmg + (i === slots ? 1 : 0)} dmg`);
      return base(cls.weapon.stat, slots, p, outcomes, 2, dmg);
    }
    case 'firebolt': {
      const f = foe(c, t.id)!;
      let p = withLight(def.stats.wits);
      if (c.w.tile(h.at)?.raised) { p += 10; mods.push('Raised +10%'); }
      if (f.asleep) { p += 20; mods.push('Asleep +20%'); }
      const outcomes = [];
      for (let i = 0; i <= 3; i++) outcomes.push(i === 0 ? 'Miss' : `${i * 2 + (i === 3 ? 1 : 0)} dmg`);
      const s = base('wits', 3, p, outcomes, 3, 2);
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
      const dest = { level: f.at.level, q: 2 * f.at.q - h.at.q, r: 2 * f.at.r - h.at.r };
      const k = kindAt(c.w, c.d, dest);
      const what = k === 'pit' ? 'Falls into the pit' : canEnter(c.w, c.d, dest) && !occupant(c, dest) ? 'Pushed back' : 'Slams the wall: 1 dmg';
      return base('might', 2, withLight(def.stats.might), ['Nothing', 'Nothing', what], 2);
    }
    case 'open':
      if (t.id) return simple('Opens the chest');
      return simple(doorAt(c.d, t.at!)?.open ? 'Closes the door' : 'Opens the door');
    case 'take': return simple('Pick up what fits');
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
    case 'climb': return simple('Climb the rope');
    case 'jump': return simple('Jump: 4 dmg');
    case 'free': return simple(c.d.prisoner?.freed ? 'Take over the escort' : 'Free the prisoner');
    case 'bribe': return simple('Pay 40 gold: they leave');
    case 'rally': return simple('+1 Focus to allies within 3');
    case 'guard': return simple(`Take hits meant for ${heroName(c, t.id!)}`);
    case 'kindle': return simple('+12 light (1 mana)', 0, 12);
    case 'mend': return simple('Heal 4 (1 mana)');
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
  if (action === 'open' && t.id) h.acted = true;
  if (action === 'climb' || action === 'jump') h.moved = true;
  const doRoll = () => {
    h.focus -= focus;
    return roll(c, heroId, LABELS[action], sp.slots, sp.chance, focus);
  };

  switch (action) {
    case 'attack':
    case 'firebolt': {
      if (action === 'firebolt') h.mana -= 1;
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
      const m = c.d.monsters.find((x) => x.id === tid);
      const rv = rivalsOnMap(c).find((x) => x.id === tid);
      const who = (m ?? rv)!;
      const dest = { level: who.at.level, q: 2 * who.at.q - h.at.q, r: 2 * who.at.r - h.at.r };
      if (kindAt(c.w, c.d, dest) === 'pit') {
        say(c, `${who.name} goes over the edge.`);
        c.ev.push({ type: 'moved', id: tid, path: [dest] });
        if (m) killMonster(c, m, heroId);
        else if (rv) {
          rv.hp = 0;
          c.ev.push({ type: 'monsterDied', id: rv.id });
        }
      } else if (canEnter(c.w, c.d, dest) && !occupant(c, dest)) {
        who.at = dest;
        c.ev.push({ type: 'moved', id: tid, path: [dest] });
        wakeTarget(c, tid, h.at);
      } else {
        hurtAny(c, tid, 1, heroId);
      }
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
      for (const it of g.items) {
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
    case 'climb':
    case 'jump': {
      const from = h.at;
      h.at = { ...t.at! };
      c.ev.push({ type: 'moved', id: heroId, path: [h.at] });
      if (from.level !== h.at.level) c.ev.push({ type: 'levelChanged', id: heroId, from: from.level, to: h.at.level });
      if (action === 'jump') {
        say(c, `${name} jumps.`);
        hurtHero(c, h, 4, 'fall');
      }
      afterHeroMove(c, h);
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
      h.mana -= 1;
      setLight(c, c.d.light + 12);
      break;
    case 'mend': {
      h.mana -= 1;
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
