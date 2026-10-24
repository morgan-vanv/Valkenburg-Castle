// The world phase: light burns, monsters act on their intents, rivals act,
// the Gloam hunts, then new intents. Also blasting charges at the end of
// the player phase.

import { distance, posKey, posNeighbors, range, samePos, type Pos } from './hex';
import type { HeroInDelve, Intent, Item } from './types';
import { MONSTERS, SISTER } from './data';
import { pick } from './rng';
import { say, type Ctx, type MonsterX } from './state';
import {
  armorOf, chestLoot, hd, heroDef, heroName, hurtAny, hurtHero, hurtPrisoner, killHero, makeNoise, nameOf, noteOnce, occupant,
  putOnGround, rivalsOnMap, roll, valueOf,
} from './common';
import {
  canEnter, dijkstra, distField, doorAt, isFloorish, kindAt, lanternPos, litSet, los, pathTo, visibleSet, within,
} from './world';
import { checkDelveEnd, refreshSight, setLight } from './delve';

// ---------------------------------------------------------------- perception

interface Target {
  id: string;
  at: Pos;
  armor: number;
  hero?: HeroInDelve;
}

function targets(c: Ctx): Target[] {
  const out: Target[] = [];
  for (const h of c.d.heroes) {
    if (h.status !== 'active') continue;
    out.push({ id: h.heroId, at: h.at, armor: armorOf(heroDef(c, h.heroId)!), hero: h });
  }
  const pr = c.d.prisoner;
  if (pr && pr.freed && !pr.dead && !pr.out) out.push({ id: pr.id, at: pr.at, armor: 0 });
  return out;
}

function sees(c: Ctx, from: Pos, t: Pos, lit: Set<string>): boolean {
  if (from.level !== t.level) return false;
  const d = distance(from, t);
  if (d > 6) return false;
  if (d > 2 && !lit.has(posKey(t))) return false;
  return los(c.w, c.d, from, t);
}

function byDist(from: Pos) {
  return (a: Target, b: Target) => {
    const da = a.at.level === from.level ? distance(a.at, from) : 99;
    const db = b.at.level === from.level ? distance(b.at, from) : 99;
    return da - db || (a.id < b.id ? -1 : 1);
  };
}

// ---------------------------------------------------------------- planning

interface Plan {
  intent: Intent;
  path: Pos[];
}

const WAIT: Plan = { intent: { kind: 'wait' }, path: [] };

function blocked(c: Ctx, p: Pos, self: string): boolean {
  const o = occupant(c, p);
  return !!o && o.id !== self;
}

/** Best path of at most `budget` toward the nearest of `goals` (stops on a free hex). */
function approach(c: Ctx, self: string, from: Pos, goals: Pos[], budget: number, stairs: boolean, allowLocked = false): Pos[] | null {
  if (!goals.length) return null;
  const field = distField(c.w, c.d, goals, { stairs, allowLocked });
  if (!field.has(posKey(from))) return null;
  const nodes = dijkstra(c.w, c.d, from, { enter: (p) => !blocked(c, p, self), stairs, allowLocked, budget });
  let best = from;
  let bestScore = field.get(posKey(from))! * 100;
  for (const n of nodes.values()) {
    const f = field.get(posKey(n.p));
    if (f === undefined) continue;
    if (!samePos(n.p, from) && occupant(c, n.p)) continue;
    const score = f * 100 + n.cost;
    if (score < bestScore) {
      bestScore = score;
      best = n.p;
    }
  }
  return samePos(best, from) ? [] : pathTo(nodes, best);
}

/** Free hexes a monster could stand on to hit `t`. */
function attackSpots(c: Ctx, t: Pos, self: string, allowLocked = false): Pos[] {
  return posNeighbors(t).filter((p) => canEnter(c.w, c.d, p, allowLocked) && !blocked(c, p, self));
}

function hitRange(slots: number, dmg: number, armor: number): [number, number] {
  return [0, slots * Math.max(1, dmg - armor) + 1];
}

function canSteal(t: Target): boolean {
  return !!t.hero && t.hero.pack.some((i) => i.kind !== 'heirloom');
}

function exitsBy(c: Ctx, from: Pos): Pos[] {
  const field = distField(c.w, c.d, [from], { stairs: true });
  return [...c.w.exits].filter((e) => field.has(posKey(e))).sort((a, b) => field.get(posKey(a))! - field.get(posKey(b))!);
}

function chooseTarget(c: Ctx, m: MonsterX, lit: Set<string>, prefer?: string): Target | null {
  const all = targets(c);
  const seen = all.filter((t) => sees(c, m.at, t.at, lit));
  if (m.awareness === 'asleep') return null;
  if (prefer) {
    const p = all.find((t) => t.id === prefer);
    if (p && (seen.includes(p) || (m.awareness === 'hunting' && p.at.level === m.at.level && distance(p.at, m.at) <= 2))) return p;
  }
  if (seen.length) return seen.sort(byDist(m.at))[0]!;
  if (m.kind === 'berserker' && m.awareness === 'hunting') {
    const near = all.filter((t) => t.at.level === m.at.level && distance(t.at, m.at) <= 10).sort(byDist(m.at));
    return near[0] ?? null;
  }
  return null;
}

export function planMonster(c: Ctx, m: MonsterX, lit: Set<string>): Plan {
  if (m.kind === 'gloam') return planGloam(c, m);
  const def = MONSTERS[m.kind];
  if (m.awareness === 'asleep') return WAIT;
  // Cutpurse with loot: run for the farthest exit.
  if (m.kind === 'cutpurse' && m.stolen) {
    const ex = exitsBy(c, m.at);
    const goal = ex[ex.length - 1];
    if (!goal) return WAIT;
    const path = approach(c, m.id, m.at, [goal], def.move, true) ?? [];
    return { intent: { kind: 'flee', to: path[path.length - 1] ?? m.at }, path };
  }
  // Wounded rats run.
  if (m.kind === 'rats' && m.hp <= 1) {
    const ts = targets(c).filter((t) => t.at.level === m.at.level);
    const nodes = dijkstra(c.w, c.d, m.at, { enter: (p) => !blocked(c, p, m.id), stairs: false, budget: def.move });
    let best = m.at;
    let bestD = -1;
    for (const n of nodes.values()) {
      if (!samePos(n.p, m.at) && occupant(c, n.p)) continue;
      const dd = Math.min(99, ...ts.map((t) => distance(t.at, n.p)));
      if (dd > bestD) {
        bestD = dd;
        best = n.p;
      }
    }
    return { intent: { kind: 'flee', to: best }, path: pathTo(nodes, best) };
  }
  const t = chooseTarget(c, m, lit, m.intent?.targetId);
  if (t) {
    const near = samePos(t.at, m.at) ? false : t.at.level === m.at.level && distance(t.at, m.at) === 1;
    const steal = m.kind === 'cutpurse' && canSteal(t);
    const strike = (to: Pos, path: Pos[]): Plan => ({
      intent: steal
        ? { kind: 'steal', targetId: t.id, to }
        : { kind: 'attack', targetId: t.id, to, damage: hitRange(def.slots, def.dmg, t.armor) },
      path,
    });
    if (m.kind === 'spider' && !near && t.hero && within(m.at, t.at, 3) && sees(c, m.at, t.at, lit) && (m.lastWeb === undefined || c.d.round - m.lastWeb >= 2)) {
      return { intent: { kind: 'web', targetId: t.id }, path: [] };
    }
    if (near) return strike(m.at, []);
    const spots = attackSpots(c, t.at, m.id);
    const path = approach(c, m.id, m.at, spots, def.move, m.awareness === 'hunting');
    if (path) {
      const end = path[path.length - 1] ?? m.at;
      if (end.level === t.at.level && distance(end, t.at) === 1) return strike(end, path);
      if (path.length) return { intent: { kind: 'move', to: end, targetId: t.id }, path };
    }
  }
  if (m.focusAt && !samePos(m.focusAt, m.at)) {
    const path = approach(c, m.id, m.at, [m.focusAt], def.move, m.awareness === 'hunting') ?? [];
    if (path.length) return { intent: { kind: 'move', to: path[path.length - 1]! }, path };
  }
  return WAIT;
}

function planGloam(c: Ctx, g: MonsterX): Plan {
  const ts = targets(c).filter((t) => t.hero);
  if (!ts.length) return WAIT;
  const field = distField(c.w, c.d, [g.at], { stairs: true, allowLocked: true });
  ts.sort((a, b) => (field.get(posKey(a.at)) ?? 999) - (field.get(posKey(b.at)) ?? 999));
  const t = ts[0]!;
  if (t.at.level === g.at.level && distance(t.at, g.at) === 1) return { intent: { kind: 'attack', targetId: t.id, to: g.at, damage: [4, 4] }, path: [] };
  const spots = posNeighbors(t.at).filter((p) => canEnter(c.w, c.d, p, true) && !blocked(c, p, g.id));
  const path = approach(c, g.id, g.at, spots, 3, true, true) ?? [];
  const end = path[path.length - 1] ?? g.at;
  if (end.level === t.at.level && distance(end, t.at) === 1) return { intent: { kind: 'attack', targetId: t.id, to: end, damage: [4, 4] }, path };
  return { intent: { kind: 'move', to: end, targetId: t.id }, path };
}

/** Intents for every awake monster (pure apart from writing m.intent). */
export function computeIntents(c: Ctx): void {
  const lit = litSet(c.w, c.d);
  for (const m of c.d.monsters) {
    if (m.awareness === 'asleep') {
      m.intent = undefined;
      continue;
    }
    m.intent = planMonster(c, m, lit).intent;
  }
}

// ---------------------------------------------------------------- acting

function walk(c: Ctx, id: string, at: { at: Pos }, path: Pos[]): void {
  if (!path.length) return;
  const seg: Pos[] = [];
  let from = at.at;
  for (const p of path) {
    if (kindAt(c.w, c.d, p) === 'door') {
      const door = doorAt(c.d, p);
      if (door && !door.open) {
        door.open = true;
        door.locked = false;
        c.ev.push({ type: 'doorChanged', at: p, open: true, locked: false });
      }
    }
    seg.push(p);
    if (p.level !== from.level) {
      c.ev.push({ type: 'moved', id, path: [...seg] });
      seg.length = 0;
      c.ev.push({ type: 'levelChanged', id, from: from.level, to: p.level });
    }
    from = p;
  }
  if (seg.length) c.ev.push({ type: 'moved', id, path: [...seg] });
  at.at = { ...path[path.length - 1]! };
}

/** Sellsword guarding the target takes the hit instead. */
function guardFor(c: Ctx, targetId: string): HeroInDelve | undefined {
  return c.d.heroes.find((h) => h.status === 'active' && h.guarding === targetId);
}

function strike(c: Ctx, attacker: string, targetId: string, slots: number, p: number, dmg: number, what: string): void {
  let tid = targetId;
  const g = guardFor(c, tid);
  if (g) {
    tid = g.heroId;
    say(c, `${heroName(c, g.heroId)} steps in front of ${nameOf(c, targetId)}.`);
  }
  const r = roll(c, attacker, what, slots, p);
  if (!r.hits) {
    c.ev.push({ type: 'miss', attacker, target: tid });
    return;
  }
  const h = hd(c, tid);
  const armor = h ? armorOf(heroDef(c, tid)!) : 0;
  const total = r.hits * Math.max(1, dmg - armor) + (r.perfect ? 1 : 0);
  if (h) hurtHero(c, h, total, attacker, r.perfect);
  else hurtPrisoner(c, total, attacker);
}

function perceive(c: Ctx, m: MonsterX, lit: Set<string>): void {
  if (m.kind === 'gloam' || m.awareness === 'asleep') return;
  const seen = targets(c).filter((t) => sees(c, m.at, t.at, lit)).sort(byDist(m.at));
  const t = seen[0];
  if (t) {
    if (m.awareness !== 'hunting') {
      m.awareness = 'hunting';
      c.ev.push({ type: 'awake', id: m.id, awareness: 'hunting' });
    }
    m.focusAt = { ...t.at };
    if (m.kind === 'orc' && !m.shouted) {
      m.shouted = true;
      say(c, `${m.name} bellows.`);
      makeNoise(c, m.at, 5);
    }
  } else if (m.awareness === 'hunting' && m.kind !== 'berserker') {
    // Lost sight: go alert and search the last hex it saw a hero on (focusAt).
    m.awareness = 'alert';
    c.ev.push({ type: 'awake', id: m.id, awareness: 'alert' });
  }
}

/** The shown intent, if it can still be carried out as shown. */
function honored(c: Ctx, m: MonsterX, move: number): Plan | null {
  const it = m.intent;
  if (!it || it.kind === 'wait' || it.kind === 'flee') return null;
  const t = it.targetId ? targets(c).find((x) => x.id === it.targetId) : undefined;
  if (it.kind !== 'move' && !t) return null;
  if (it.kind === 'web') return t?.hero && !adjacentTo(m.at, t.at) ? { intent: it, path: [] } : null;
  const to = it.to ?? m.at;
  let path: Pos[] = [];
  if (!samePos(to, m.at)) {
    if (occupant(c, to)) return null;
    const nodes = dijkstra(c.w, c.d, m.at, { enter: (p) => !blocked(c, p, m.id), stairs: m.awareness === 'hunting' || m.kind === 'gloam', allowLocked: m.kind === 'gloam', budget: move });
    if (!nodes.has(posKey(to))) return null;
    path = pathTo(nodes, to);
  }
  if ((it.kind === 'attack' || it.kind === 'steal') && !adjacentTo(to, t!.at)) return null;
  return { intent: it, path };
}

function adjacentTo(a: Pos, b: Pos): boolean {
  return a.level === b.level && distance(a, b) === 1;
}

function monsterAct(c: Ctx, m: MonsterX): void {
  const lit = litSet(c.w, c.d);
  perceive(c, m, lit);
  if (!c.d.monsters.includes(m) || m.awareness === 'asleep') return;
  const def = MONSTERS[m.kind];
  const plan = honored(c, m, def.move) ?? planMonster(c, m, lit);
  m.intent = plan.intent;
  walk(c, m.id, m, plan.path);
  const it = plan.intent;
  if (m.focusAt && samePos(m.focusAt, m.at)) m.focusAt = undefined;
  switch (it.kind) {
    case 'attack': {
      if (!it.targetId) break;
      const t = targets(c).find((x) => x.id === it.targetId);
      if (!t || t.at.level !== m.at.level || distance(t.at, m.at) !== 1) break;
      if (m.kind === 'gloam') {
        const h = hd(c, t.id);
        say(c, 'The Gloam touches ' + nameOf(c, t.id) + '.');
        if (h) hurtHero(c, h, 4, m.id);
        else hurtPrisoner(c, 4, m.id);
        break;
      }
      strike(c, m.id, t.id, def.slots, def.chance, def.dmg, 'Attack');
      break;
    }
    case 'steal': {
      const t = targets(c).find((x) => x.id === it.targetId);
      if (!t || !t.hero || distance(t.at, m.at) !== 1 || t.at.level !== m.at.level) break;
      const r = roll(c, m.id, 'Steal', def.slots, def.chance);
      if (!r.hits) {
        c.ev.push({ type: 'miss', attacker: m.id, target: t.id });
        break;
      }
      const pool = t.hero.pack.filter((i) => i.kind !== 'heirloom');
      if (!pool.length) {
        hurtHero(c, t.hero, Math.max(1, def.dmg - t.armor), m.id);
        break;
      }
      const item = pick(c.s, pool);
      t.hero.pack = t.hero.pack.filter((i) => i !== item);
      m.stolen = item;
      c.ev.push({ type: 'stolen', by: m.id, from: t.id, item });
      say(c, `${m.name} lifts ${heroName(c, t.id)}'s ${item.name.toLowerCase()} and runs.`);
      break;
    }
    case 'web': {
      const t = targets(c).find((x) => x.id === it.targetId);
      if (!t?.hero) break;
      t.hero.webbed = true;
      m.lastWeb = c.d.round;
      c.ev.push({ type: 'hit', attacker: m.id, target: t.id, damage: 0, crit: false });
      say(c, `${heroName(c, t.id)} is caught in a web.`);
      break;
    }
    case 'flee':
      if (m.kind === 'cutpurse' && m.stolen && kindAt(c.w, c.d, m.at) === 'exit') {
        c.d.monsters = c.d.monsters.filter((x) => x !== m);
        c.ev.push({ type: 'out', id: m.id });
        say(c, `${m.name} is gone, and so is the ${m.stolen.name.toLowerCase()}.`);
        noteOnce(c, `A cutpurse got away with a ${m.stolen.name.toLowerCase()}.`);
      }
      break;
  }
}

// ---------------------------------------------------------------- rivals

function rivalEnter(c: Ctx): void {
  const cr = c.d.rivals;
  if (!cr || cr.entered || c.d.round < cr.entersRound) return;
  const at = cr.members[0]!.at;
  const spots: Pos[] = [];
  const seen = new Set([posKey(at)]);
  const q = [at];
  for (let i = 0; i < q.length && spots.length < cr.members.length; i++) {
    const p = q[i]!;
    if (canEnter(c.w, c.d, p) && kindAt(c.w, c.d, p) !== 'door' && !occupant(c, p)) spots.push(p);
    for (const n of posNeighbors(p)) {
      if (seen.has(posKey(n)) || !canEnter(c.w, c.d, n)) continue;
      seen.add(posKey(n));
      q.push(n);
    }
  }
  if (spots.length < cr.members.length) return; // blocked: try next round
  cr.entered = true;
  cr.members.forEach((r, i) => (r.at = spots[i]!));
  c.ev.push({ type: 'rivalsEnter', at });
  say(c, 'Lanterns at the door. Someone else is here.');
}

interface LootGoal {
  at: Pos;
  chestId?: string;
  objective: boolean;
}

function lootGoals(c: Ctx): LootGoal[] {
  const out: LootGoal[] = [];
  for (const ch of c.d.chests) if (!ch.opened && !ch.jammed) out.push({ at: ch.at, chestId: ch.id, objective: false });
  for (const g of c.d.ground) {
    if (!g.items.length) continue;
    if (c.d.heroes.some((h) => (h.status === 'active' || h.status === 'downed') && samePos(h.at, g.at))) continue;
    out.push({ at: g.at, objective: g.items.some((i) => i.kind === 'heirloom') });
  }
  return out;
}

function rivalsAct(c: Ctx): void {
  const cr = c.d.rivals;
  if (!cr) return;
  rivalEnter(c);
  if (!cr.entered) return;
  if (cr.stance !== 'hostile' && cr.goal !== 'leave' && ((cr.pickups ?? 0) >= 3 || c.d.light <= 18)) cr.goal = 'leave';
  for (const r of rivalsOnMap(c)) {
    if (cr.stance === 'hostile') {
      const ts = targets(c).filter((t) => t.hero);
      const field = distField(c.w, c.d, [r.at], { stairs: true });
      ts.sort((a, b) => (field.get(posKey(a.at)) ?? 999) - (field.get(posKey(b.at)) ?? 999));
      const t = ts[0];
      if (!t) continue;
      if (!(t.at.level === r.at.level && distance(t.at, r.at) === 1)) {
        const path = approach(c, r.id, r.at, attackSpots(c, t.at, r.id), SISTER.move, true) ?? [];
        walk(c, r.id, r, path);
      }
      if (t.at.level === r.at.level && distance(t.at, r.at) === 1 && t.hero?.status === 'active') {
        strike(c, r.id, t.id, SISTER.slots, SISTER.chance, SISTER.dmg, 'Attack');
      }
      continue;
    }
    if (cr.goal === 'leave') {
      const ex = exitsBy(c, r.at)[0];
      if (!ex) continue;
      if (samePos(ex, r.at)) {
        r.goneOut = true;
        c.ev.push({ type: 'out', id: r.id });
        continue;
      }
      const path = approach(c, r.id, r.at, [ex], SISTER.move, true) ?? [];
      walk(c, r.id, r, path);
      if (samePos(r.at, ex)) {
        r.goneOut = true;
        c.ev.push({ type: 'out', id: r.id });
      }
      continue;
    }
    // Loot.
    const goals = lootGoals(c);
    if (!goals.length) {
      cr.goal = 'leave';
      continue;
    }
    const field = distField(c.w, c.d, [r.at], { stairs: true });
    const reach = (g: LootGoal) => Math.min(999, ...[g.at, ...posNeighbors(g.at)].map((p) => field.get(posKey(p)) ?? 999));
    goals.sort((a, b) => reach(a) - reach(b));
    const g = goals[0]!;
    if (reach(g) >= 999) continue;
    cr.goal = g.objective ? 'objective' : 'loot';
    if (!within(r.at, g.at, 1)) {
      const spots = [g.at, ...posNeighbors(g.at)].filter((p) => canEnter(c.w, c.d, p) && !blocked(c, p, r.id));
      const before = r.at;
      const path = approach(c, r.id, r.at, spots, SISTER.move, true);
      walk(c, r.id, r, path ?? []);
      if (samePos(before, r.at) && !within(r.at, g.at, 1)) {
        // Stuck: a hero in the way two rounds running makes them angry.
        cr.blocked = (cr.blocked ?? 0) + 1;
        if (cr.blocked >= 2 && cr.spotted) {
          cr.stance = 'hostile';
          c.ev.push({ type: 'rivalsStance', stance: 'hostile' });
          say(c, '"Move, or be moved." The sisters draw steel.');
        }
      } else cr.blocked = 0;
    }
    if (within(r.at, g.at, 1)) {
      let items: Item[] = [];
      if (g.chestId) {
        const ch = c.d.chests.find((x) => x.id === g.chestId)!;
        ch.opened = true;
        ch.locked = false;
        items = chestLoot(c, ch.tier);
        c.ev.push({ type: 'chestOpened', id: ch.id, items: [] });
        noteOnce(c, `The Lantern Sisters took the ${c.w.roomName(ch.at).toLowerCase()} chest.`);
      } else {
        const pile = c.d.ground.find((x) => samePos(x.at, g.at));
        if (pile) {
          items = pile.items;
          pile.items = [];
          c.d.ground = c.d.ground.filter((x) => x.items.length);
        }
        if (items.some((i) => i.kind === 'heirloom')) {
          say(c, 'A sister pockets the heirloom.');
          noteOnce(c, 'The Lantern Sisters took the heirloom.');
        }
      }
      r.loot.push(...items);
      cr.pickups = (cr.pickups ?? 0) + 1;
      c.ev.push({ type: 'looted', id: r.id, items });
    }
  }
  // Gone?
  for (const r of cr.members) if (r.goneOut && r.loot.length) {
    noteOnce(c, `The Lantern Sisters left with ${valueOf(r.loot)} gold in loot.`);
  }
}


// ---------------------------------------------------------------- the Gloam

function gloamPhase(c: Ctx): void {
  let g = c.d.monsters.find((m) => m.kind === 'gloam');
  if (c.d.light > 0) return;
  if (!g) {
    const lp = lanternPos(c.d) ?? c.d.heroes.find((h) => h.status === 'active')?.at;
    if (!lp) return;
    const vis = visibleSet(c.w, c.d);
    const ring = range(lp, 10)
      .map((h) => ({ level: lp.level, ...h }))
      .filter((p) => distance(p, lp) >= 8 && kindAt(c.w, c.d, p) === 'floor' && !occupant(c, p));
    const hidden = ring.filter((p) => !vis.has(posKey(p)));
    const pool = hidden.length ? hidden : ring;
    const near = pool.length ? pool : (c.w.floors.get(lp.level) ?? []).filter((p) => !occupant(c, p) && isFloorish(c.w, c.d, p));
    if (!near.length) return;
    const at = pick(c.s, near);
    g = {
      id: `m${c.d.nextMonster ?? 99}`,
      kind: 'gloam',
      name: 'The Gloam',
      at,
      hp: 99,
      maxHp: 99,
      awareness: 'hunting',
      spawnedAt: at,
    };
    c.d.nextMonster = (c.d.nextMonster ?? 99) + 1;
    c.d.monsters.push(g);
    c.ev.push({ type: 'gloam', at });
    c.ev.push({ type: 'spawned', id: g.id, at });
    say(c, 'Something moves in the dark.');
    return; // it hunts from next round
  }
  monsterAct(c, g);
}

// ---------------------------------------------------------------- charges

export function blowCharges(c: Ctx): void {
  const list = c.d.charges ?? [];
  c.d.charges = [];
  for (const ch of list) {
    const at = ch.at;
    c.ev.push({ type: 'blast', at });
    const k = kindAt(c.w, c.d, at);
    if (k === 'cracked') c.d.blown.push(posKey(at));
    if (k === 'door') {
      const door = doorAt(c.d, at)!;
      door.open = true;
      door.locked = false;
      door.jammed = false;
      c.d.blown.push(posKey(at));
      c.ev.push({ type: 'doorChanged', at, open: true, locked: false });
    }
    const chest = c.d.chests.find((x) => samePos(x.at, at) && !x.opened);
    if (chest) {
      chest.opened = true;
      chest.locked = false;
      const items = chestLoot(c, chest.tier);
      putOnGround(c, chest.at, items);
      c.ev.push({ type: 'chestOpened', id: chest.id, items });
    }
    say(c, 'BOOM.');
    // Damage.
    const hurt: [string, number][] = [];
    for (const m of c.d.monsters) if (m.at.level === at.level && distance(m.at, at) <= 2) hurt.push([m.id, distance(m.at, at) <= 1 ? 4 : 2]);
    for (const r of rivalsOnMap(c)) if (r.at.level === at.level && distance(r.at, at) <= 2) hurt.push([r.id, distance(r.at, at) <= 1 ? 4 : 2]);
    for (const h of c.d.heroes) {
      if ((h.status === 'active' || h.status === 'downed') && h.at.level === at.level && distance(h.at, at) <= 2) hurt.push([h.heroId, distance(h.at, at) <= 1 ? 4 : 2]);
    }
    const pr = c.d.prisoner;
    if (pr && !pr.dead && !pr.out && pr.at.level === at.level && distance(pr.at, at) <= 2) hurt.push([pr.id, distance(pr.at, at) <= 1 ? 4 : 2]);
    for (const [id, dmg] of hurt) hurtAny(c, id, dmg, c.d.heroes.some((h) => h.heroId === id) ? null : ch.by, { noise: false });
    makeNoise(c, at, 8, { otherLevels: true });
  }
}

// ---------------------------------------------------------------- the phase

export function worldPhase(c: Ctx): void {
  const d = c.d;
  blowCharges(c);
  refreshSight(c);
  if (checkDelveEnd(c)) return;
  d.phase = 'world';
  c.ev.push({ type: 'phase', phase: 'world', round: d.round });
  const webbedBefore = new Set(d.heroes.filter((h) => h.webbed).map((h) => h.heroId));
  // 1. Light, torches, bleeding.
  setLight(c, d.light - 1);
  for (const h of d.heroes) if (h.torch > 0 && (h.status === 'active' || h.status === 'downed')) h.torch -= 1;
  for (const h of d.heroes) {
    if (h.status !== 'downed') continue;
    h.bleed -= 1;
    if (h.bleed <= 0) killHero(c, h);
  }
  // 2. Monsters, in id order.
  const order = [...d.monsters].filter((m) => m.kind !== 'gloam').sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
  for (const m of order) {
    if (!d.monsters.includes(m)) continue;
    monsterAct(c, m);
  }
  // 3. Rivals. 4. The Gloam.
  rivalsAct(c);
  gloamPhase(c);
  // 5. New round.
  for (const h of d.heroes) {
    h.moved = false;
    h.acted = false;
    h.guarding = undefined;
    if (h.rallyCooldown > 0) h.rallyCooldown -= 1;
    if (webbedBefore.has(h.heroId)) h.webbed = false;
  }
  refreshSight(c);
  if (checkDelveEnd(c)) return;
  d.round += 1;
  d.phase = 'player';
  computeIntents(c);
  c.ev.push({ type: 'phase', phase: 'player', round: d.round });
}
