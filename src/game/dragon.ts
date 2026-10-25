// Section 14.4: the Dragon. Sleeps on its hoard in the Lair; wakes when a hero
// walks into the Lair room (sneaking doesn't count), ends next to it (unless a
// sneaking Burglar), lands there from a fall, or noise of 4+ reaches it.
// Awake: breath every other round, tail sweep when 2+ heroes crowd it,
// otherwise bite or close in. Never leaves the Lair room.

import { distance, hexToWorld, line, posKey, posNeighbors, samePos, worldToHex, type Pos } from './hex';
import type { HeroInDelve, Intent } from './types';
import { BREATH_DMG, BREATH_LEN, BREATH_NOISE, HOARD_NAMES, HOARD_PIECES, HOARD_VALUE, MONSTERS } from './data';
import { pick } from './rng';
import { say, type Ctx, type DelveX, type GameStateX, type MonsterX } from './state';
import { armorOf, hd, heroDef, heroName, hurtHero, hurtPrisoner, makeItem, makeNoise, occupant } from './common';
import { blocksSight, canEnter, dijkstra, kindAt, los, pathTo, standable, type World } from './world';
import { push } from './falls';

export type DragonX = MonsterX;

/** The Dragon's room id (the room of its spawn hex). */
export function lairOf(w: World, m: MonsterX): string | undefined {
  return w.tile(m.spawnedAt)?.room;
}

export function inLair(w: World, m: MonsterX, p: Pos): boolean {
  const room = lairOf(w, m);
  return !!room && p.level === m.spawnedAt.level && w.tile(p)?.room === room;
}

export function wakeDragon(c: Ctx, m: DragonX, why: string): void {
  if (m.awareness !== 'asleep') return;
  m.awareness = 'hunting';
  m.breathNext = true;
  c.ev.push({ type: 'awake', id: m.id, awareness: 'hunting' });
  say(c, why);
}

/**
 * Wake sleeping Dragons for a hero who just moved or landed: they walked (not
 * sneaked) into the Lair room, or ended next to the Dragon (a sneaking Burglar
 * doesn't count, so the hoard can be stolen).
 */
export function lairCheck(c: Ctx, h: HeroInDelve, sneak = false): void {
  if (h.status !== 'active') return;
  const burglar = heroDef(c, h.heroId)?.cls === 'burglar';
  for (const m of c.d.monsters) {
    if (m.kind !== 'dragon' || m.awareness !== 'asleep') continue;
    const adj = h.at.level === m.at.level && distance(h.at, m.at) <= 1;
    if (adj && !(sneak && burglar)) wakeDragon(c, m, `${m.name} opens one burning eye.`);
    else if (!sneak && inLair(c.w, m, h.at)) wakeDragon(c, m, `${m.name} wakes. The Lair fills with heat.`);
  }
}

// ---------------------------------------------------------------- planning

interface Plan {
  intent: Intent;
  path: Pos[];
}

/** Heroes the Dragon can see: same level, within 10, line of sight. */
function dragonTargets(c: Ctx, m: MonsterX) {
  return c.d.heroes
    .filter((h) => h.status === 'active' && h.veil <= 0 && h.at.level === m.at.level && distance(h.at, m.at) <= 10 && los(c.w, c.d, m.at, h.at))
    .sort((a, b) => distance(a.at, m.at) - distance(b.at, m.at) || (a.heroId < b.heroId ? -1 : 1));
}

/** A straight line of BREATH_LEN hexes from `from` toward `to` (from excluded), stopping at walls. */
export function breathLine(c: Ctx, from: Pos, to: Pos): Pos[] {
  const n = distance(from, to) || 1;
  const k = BREATH_LEN / n;
  const a = hexToWorld(from);
  const b = hexToWorld(to);
  const far = worldToHex(a.x + (b.x - a.x) * k, a.z + (b.z - a.z) * k);
  const out: Pos[] = [];
  for (const h of line(from, far).slice(1, BREATH_LEN + 1)) {
    const p = { level: from.level, ...h };
    if (!c.w.tile(p) || blocksSight(c.w, c.d, p)) break;
    out.push(p);
  }
  return out;
}

export function planDragon(c: Ctx, m: DragonX, noBreath = false): Plan {
  if (m.awareness === 'asleep') return { intent: { kind: 'wait' }, path: [] };
  const def = MONSTERS.dragon;
  const seen = dragonTargets(c, m);
  const t = seen[0];
  if (t && m.breathNext !== false && !noBreath) {
    const hexes = breathLine(c, m.at, t.at);
    if (hexes.length) return { intent: { kind: 'breath', targetId: t.heroId, hexes, damage: [BREATH_DMG, BREATH_DMG], to: m.at }, path: [] };
  }
  const adj = seen.filter((h) => distance(h.at, m.at) === 1);
  if (adj.length >= 2) return { intent: { kind: 'sweep', to: m.at }, path: [] };
  const bite = (to: Pos, path: Pos[], id: string): Plan => {
    const armor = armorOf(heroDef(c, id)!);
    return { intent: { kind: 'attack', targetId: id, to, damage: [0, def.slots * Math.max(1, def.dmg - armor) + 1] }, path };
  };
  if (adj[0]) return bite(m.at, [], adj[0].heroId);
  if (!t) return { intent: { kind: 'wait' }, path: [] };
  // Close in, never leaving the Lair.
  const nodes = dijkstra(c.w, c.d, m.at, {
    enter: (p) => inLair(c.w, m, p) && kindAt(c.w, c.d, p) !== 'door' && (!occupant(c, p) || occupant(c, p)!.id === m.id),
    stairs: false,
    budget: def.move,
  });
  let best: Pos | null = null;
  let bestScore = Infinity;
  for (const n of nodes.values()) {
    const occ = occupant(c, n.p);
    if (occ && occ.id !== m.id) continue;
    for (const h of seen) {
      const score = distance(n.p, h.at) * 100 + n.cost;
      if (score < bestScore) {
        bestScore = score;
        best = n.p;
      }
    }
  }
  if (!best || samePos(best, m.at)) return { intent: { kind: 'wait' }, path: [] };
  const path = pathTo(nodes, best);
  const near = seen.find((h) => distance(h.at, best!) === 1);
  if (near) return bite(best, path, near.heroId);
  return { intent: { kind: 'move', to: best, targetId: t.heroId }, path };
}

// ---------------------------------------------------------------- acting

/** Carry out the Dragon's breath or sweep. Returns true if handled (bites go through the normal strike). */
export function dragonSpecial(c: Ctx, m: DragonX, it: Intent): boolean {
  if (it.kind === 'breath') {
    const hexes = it.hexes ?? [];
    c.ev.push({ type: 'breath', by: m.id, hexes });
    say(c, `${m.name} breathes fire.`);
    const keys = new Set(hexes.map(posKey));
    for (const h of c.d.heroes) {
      if ((h.status === 'active' || h.status === 'downed') && keys.has(posKey(h.at))) hurtHero(c, h, BREATH_DMG, m.id);
    }
    const pr = c.d.prisoner;
    if (pr && !pr.dead && !pr.out && keys.has(posKey(pr.at))) hurtPrisoner(c, BREATH_DMG, m.id);
    makeNoise(c, m.at, BREATH_NOISE);
    m.breathNext = false;
    return true;
  }
  m.breathNext = true;
  if (it.kind === 'sweep') {
    say(c, `${m.name}'s tail sweeps round.`);
    const adj = c.d.heroes.filter((h) => h.status === 'active' && h.at.level === m.at.level && distance(h.at, m.at) === 1);
    for (const h of adj) push(c, h.heroId, m.at, m.id);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- the hoard

/** Place the hoard pieces around each Dragon's spawn (start of a delve). */
export function placeHoard(w: World, s: GameStateX, d: DelveX, pieces = HOARD_PIECES): void {
  for (const m of d.monsters) {
    if (m.kind !== 'dragon') continue;
    const spots: Pos[] = [];
    const ring = [...posNeighbors(m.at), ...posNeighbors(m.at).flatMap((p) => posNeighbors(p))];
    for (const p of ring) {
      if (spots.length >= pieces) break;
      if (samePos(p, m.at) || spots.some((x) => samePos(x, p))) continue;
      if (!standable(w, d, p) || !canEnter(w, d, p) || !inLair(w, m, p)) continue;
      if (w.vents.has(posKey(p))) continue;
      if (d.ground.some((g) => samePos(g.at, p))) continue;
      spots.push(p);
    }
    const names = [...HOARD_NAMES];
    for (const p of spots) {
      const name = pick(s, names);
      names.splice(names.indexOf(name), 1);
      const it = makeItem({ s }, 'hoard', HOARD_VALUE, name);
      d.ground.push({ at: { ...p }, items: [it] });
    }
  }
}

export { hd, heroName };
