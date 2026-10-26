// V3.7 (spec 20.4): a hostile crew fights like a squad. Members are built like heroes (rivals.ts
// `member`/`rivalStats`) and use their packs with the heroes' own item rules, showing each use as
// an intent the round before. The crew picks one target a round (focus fire), paths to hexes with
// a line to it and out of the other heroes' sight. V4.0 (spec 28.8, owner): it carries off only a hero left helpless
// (downed, dozing from a sleep dart, or V4.0 spec 29 paralyzed) and alone; a downed hero with friends near is finished instead.

import { distance, posKey, posNeighbors, range, samePos, type Pos } from './hex';
import type { Intent, Item, ItemKind, RivalClass } from './types';
import {
  BACKSTAB_DMG_MULT, BLAST_INNER_DMG, CAPTURE_ALONE, BLAST_OUTER_DMG, BOW_RANGE, SNEAK_ATTACK_SLOTS, CALTROPS_DMG, CLASSES, DRAG_MOVE, FIREBALL_NOISE, FIREBALL_RANGE, FIRECRACKER_NOISE, GLUE_ROUNDS, GUST_NOISE, GUST_RANGE,
  KNOCKBACK_RANGE, PYRO_BOLT_CHANCE, PYRO_BOLT_DMG, PYRO_BOLT_NOISE, PYRO_BOLT_RANGE, PYRO_BOLT_SLOTS, RIVAL_CLASSES, RIVAL_POTION_HEAL, SAPPER_CHARGE_RANGE,
  SELLSWORD_SHOVE_CHANCE, SISTER_DART_CHANCE, SPELL_RANGE, THROW_RANGE, VEIL_ROUNDS, WARD_ROUNDS, BLINK_RANGE,
} from './data';
import { chance } from './rng';
import { say, type Ctx, type HeroX, type RivalX } from './state';
import { activeHeroes, hd, heroName, hurtAny, hurtHero, makeNoise, monsterArmor, occupant, onMap, rivalsOnMap, roll } from './common';
import { canEnter, dijkstra, distField, isFloorish, kindAt, los, pathTo, standable, within } from './world';
import { adjacentTo, approach, attackSpots, blocked, exitsBy, hamstringIntent, hamstringShot, hitRange, overwatchCheck, strike, targets, type Target } from './ai';
import { push, pushOutcome } from './falls';
import { blastArea, fuseAt, setFuse } from './charges';
import { pusherFor, smokeOut } from './delve';
import { faceToward, inRearHalf } from './stealth';
import { heroesInSight, nearestHero, rivalStats, shootingSpots } from './rivals';
import { cureVenom, envenom, isParalyzed, venomTakes } from './venom';
import { crewApproach, crewBudget, crewCharges, crewGo, crewWalk, heroNoticed, routeIntent, sapperWay, spendCrewCharge, tell, wantSneak, type CrewWay } from './crewmove';

// ---------------------------------------------------------------- the pack

/** Does the member carry one (the pack; legacy saves keep counters for darts, smoke and charges)? */
export function hasKit(r: RivalX, kind: ItemKind): boolean {
  if (kind === 'charge') return crewCharges(r) > 0; // V4.0 (spec 28.6): improvised explosives count
  if (r.pack) return r.pack.some((i) => i.kind === kind);
  if (kind === 'dart') return (r.darts ?? 0) > 0;
  if (kind === 'smoke') return (r.smoke ?? 0) > 0;
  return false;
}

/** Use one up. */
export function spendKit(r: RivalX, kind: ItemKind): Item | undefined {
  if (kind === 'charge') {
    spendCrewCharge(r); // V4.0 (spec 28.6): improvised explosives first, as a hero Sapper
    return undefined;
  }
  if (r.pack) {
    const i = r.pack.findIndex((x) => x.kind === kind);
    if (i < 0) return undefined;
    return r.pack.splice(i, 1)[0];
  }
  if (kind === 'dart') r.darts = Math.max(0, (r.darts ?? 1) - 1);
  else if (kind === 'smoke') r.smoke = Math.max(0, (r.smoke ?? 1) - 1);
  return undefined;
}

const MAGES: RivalClass[] = ['pyromancer', 'shadowmancer', 'hedgewitch'];

/** Mana left (mages; `charges` holds it, "firebolts left" for the Pyromancer). */
export function manaOf(r: RivalX): number {
  return MAGES.includes(r.cls) ? (r.charges ?? 0) : 0;
}

function spendMana(r: RivalX, n: number): void {
  r.charges = Math.max(0, (r.charges ?? 0) - n);
}

/** A spell's chance: Wits (+5 per level above 1 for the level-built); legacy pyromancers use the 18.5 number. */
export function spellChance(r: RivalX): number {
  if (r.level !== undefined) return CLASSES[r.cls].stats.wits + 5 * (r.level - 1);
  return PYRO_BOLT_CHANCE + (rivalStats(r).chance - RIVAL_CLASSES[r.cls].chance);
}

/** A thrown dart's chance: Finesse for the level-built, the Sisters' 65 otherwise. */
function dartChance(r: RivalX): number {
  if (r.level !== undefined) return CLASSES[r.cls].stats.finesse + (CLASSES[r.cls].main === 'finesse' ? 5 * (r.level - 1) : 0);
  return SISTER_DART_CHANCE;
}

export function belowHalf(r: RivalX): boolean {
  return r.hp * 2 < r.maxHp;
}

/** The crew's striker: its melee front-liner (Sellsword, then Sapper, Burglar). */
export function striker(c: Ctx): RivalX | undefined {
  const order: RivalClass[] = ['sellsword', 'sapper', 'burglar', 'ranger'];
  const ms = rivalsOnMap(c);
  for (const cls of order) {
    const r = ms.find((m) => m.cls === cls);
    if (r) return r;
  }
  return undefined;
}

/** The crew's caster, whom the Sellsword guards. */
export function caster(c: Ctx): RivalX | undefined {
  const order: RivalClass[] = ['pyromancer', 'hedgewitch', 'shadowmancer'];
  const ms = rivalsOnMap(c);
  for (const cls of order) {
    const r = ms.find((m) => m.cls === cls);
    if (r) return r;
  }
  return undefined;
}

// ---------------------------------------------------------------- focus fire and positioning

/** Hero targets only (not the freed prisoner); spec 28.8: not a hero a member is carrying off (they want them alive). */
function heroTargets(c: Ctx): Target[] {
  return targets(c).filter((t) => t.hero && !draggedBy(c, t.id));
}

/** Could this member attack `t` this round (walk plus reach, same level)? */
function inReach(r: RivalX, t: Target): boolean {
  const st = rivalStats(r);
  return t.at.level === r.at.level && distance(t.at, r.at) <= st.move + st.range;
}

/**
 * Spec 20.4: one target a round for the whole crew: the lantern bearer when a member can reach them,
 * else the lowest-HP hero a member can reach, else the hero nearest the crew on foot.
 */
export function crewTarget(c: Ctx): Target | null {
  const ts = heroTargets(c);
  const ms = rivalsOnMap(c);
  if (!ts.length || !ms.length) return null;
  const reach = (t: Target) => ms.some((r) => inReach(r, t));
  const bearer = ts.find((t) => t.id === c.d.lanternBearer);
  if (bearer && reach(bearer)) return bearer;
  const near = ts.filter(reach).sort((a, b) => a.hero!.hp - b.hero!.hp || (a.id < b.id ? -1 : 1));
  if (near.length) return near[0]!;
  const field = distField(c.w, c.d, [ms[0]!.at], { stairs: true });
  return [...ts].sort((a, b) => (field.get(posKey(a.at)) ?? 999) - (field.get(posKey(b.at)) ?? 999) || (a.id < b.id ? -1 : 1))[0] ?? null;
}

/** The crew's target for this round, kept on the crew (`target`) and re-picked when it is gone. */
export function currentTarget(c: Ctx): Target | null {
  const cr = c.d.rivals!;
  const ts = heroTargets(c);
  const kept = cr.target ? ts.find((t) => t.id === cr.target) : undefined;
  if (kept) return kept;
  const t = crewTarget(c);
  cr.target = t?.id;
  return t;
}

/** Heroes other than `except` with a line to `p` within bow range: what standing there costs. */
function exposure(c: Ctx, p: Pos, except: string): number {
  let n = 0;
  for (const h of activeHeroes(c)) {
    if (h.heroId === except || h.at.level !== p.level || !within(h.at, p, BOW_RANGE)) continue;
    if (los(c.w, c.d, h.at, p)) n++;
  }
  return n;
}

/**
 * The walk this round toward one of `spots`: a reachable spot with the least exposure to the other
 * heroes (doors and pillars), then the shortest; else the approach toward the nearest spot.
 */
export function pathToSpots(c: Ctx, r: RivalX, spots: Pos[], budget: number, targetId: string, prefer?: (p: Pos) => number): Pos[] {
  if (!spots.length) return [];
  const nodes = dijkstra(c.w, c.d, r.at, { enter: (p) => !blocked(c, p, r.id), stairs: true, budget });
  let best: Pos | null = null;
  let bestScore = Infinity;
  for (const sp of spots) {
    const n = nodes.get(posKey(sp));
    if (!n) continue;
    if (!samePos(sp, r.at) && occupant(c, sp)) continue;
    const score = exposure(c, sp, targetId) * 10 + (prefer?.(sp) ?? 0) + n.cost;
    if (score < bestScore) {
      bestScore = score;
      best = sp;
    }
  }
  if (best) return samePos(best, r.at) ? [] : pathTo(nodes, best);
  return approach(c, r.id, r.at, spots, budget, true) ?? [];
}

/** The Sellsword keeps beside the caster: spots next to it cost nothing, the rest a little. */
function guardPrefer(c: Ctx, r: RivalX): ((p: Pos) => number) | undefined {
  if (r.cls !== 'sellsword') return undefined;
  const cs = caster(c);
  if (!cs || cs === r) return undefined;
  return (p) => (adjacentTo(p, cs.at) ? 0 : 3);
}

export interface Plan {
  intent: Intent;
  path: Pos[];
  /** V4.0 (spec 28.1): the walk is a sneak (stalking). */
  sneak?: boolean;
  /** V4.0 (spec 28.6): a Sapper's dig or blast at the walk's end. */
  way?: CrewWay;
  /** V4.0 (spec 28.1): the walk is a dash (as far again; it spends the action). */
  dash?: boolean;
}

/**
 * Attack the crew's target: from here when in reach, else from the best spot the walk allows. V4.0 (spec 28.1): walking,
 * or sneaking while it stalks a target that hasn't noticed it (`wantSneak`); a member that can't strike this round
 * dashes (a second move, as far again); a crew Sapper digs or blasts a much shorter way (spec 28.6).
 */
export function attackPlan(c: Ctx, r: RivalX, t: Target): Plan {
  const st = rivalStats(r);
  const reach = st.range;
  const canHit = (from: Pos) => t.at.level === from.level && within(t.at, from, reach) && (reach === 1 || los(c.w, c.d, from, t.at));
  const dmg = hitRange(st.slots, st.dmg, t.armor);
  if (canHit(r.at)) return { intent: { kind: 'attack', targetId: t.id, to: { ...r.at }, damage: dmg }, path: [] };
  const spots = reach > 1 ? shootingSpots(c, r, t) : attackSpots(c, t.at, r.id);
  if (r.cls === 'sapper' && sapperWay(c, r, spots)) {
    const route = crewApproach(c, r, spots, { sneak: false });
    if (route.way) return { intent: routeIntent(c, route), path: route.path, way: route.way };
  }
  const sneak = wantSneak(c, r, [], t.id);
  const budget = crewBudget(r, sneak);
  const path = pathToSpots(c, r, spots, budget, t.id, guardPrefer(c, r));
  const end = path[path.length - 1];
  if (end && canHit(end)) return { intent: { kind: 'attack', targetId: t.id, to: end, damage: dmg }, path, sneak };
  // The dash stops short of the party's reach: a member that can't strike this round doesn't walk up to hand the heroes the first blow.
  let far = pathToSpots(c, r, spots, 2 * budget, t.id, guardPrefer(c, r));
  while (far.length > path.length && activeHeroes(c).some((h) => adjacentTo(h.at, far[far.length - 1]!))) far = far.slice(0, -1);
  while (far.length > path.length && occupant(c, far[far.length - 1]!)) far = far.slice(0, -1);
  const dash = far.length > path.length;
  const go = dash ? far : path;
  const stop = go[go.length - 1];
  return stop ? { intent: { kind: 'move', to: stop, targetId: t.id, ...(sneak ? { sneak: true } : {}) }, path: go, sneak, dash } : { intent: { kind: 'wait' }, path: [] };
}

// ---------------------------------------------------------------- the kit (spec 20.4 per class)

function freeStep(c: Ctx, r: RivalX, awayFromAt: Pos | undefined): Pos | undefined {
  const spots = posNeighbors(r.at).filter((p) => canEnter(c.w, c.d, p) && kindAt(c.w, c.d, p) !== 'door' && !occupant(c, p) && !(c.d.burning?.[posKey(p)]));
  if (!spots.length) return undefined;
  if (!awayFromAt) return spots[0];
  return spots.sort((a, b) => distance(b, awayFromAt) - distance(a, awayFromAt) || posKey(a).localeCompare(posKey(b)))[0];
}

/** Below half with a potion: back off one hex (away from the nearest hero) and drink. */
function potionIntent(c: Ctx, r: RivalX): Intent | null {
  if (!belowHalf(r) || !hasKit(r, 'potion')) return null;
  const t = nearestHero(c, r);
  const step = freeStep(c, r, t?.at) ?? r.at;
  const to = t && adjacentTo(t.at, r.at) && !samePos(step, r.at) ? step : r.at;
  return { kind: 'potion', item: 'potion', targetId: r.id, to: { ...to } };
}

/** Two or more heroes with a line of fire on `m` within bow range. */
function underFire(c: Ctx, m: RivalX): boolean {
  return exposure(c, m.at, '') >= 2;
}

/** Smoke for a member below half that two heroes can shoot at (Burglar, Shadowmancer). */
function smokeIntent(c: Ctx, r: RivalX): Intent | null {
  if (!hasKit(r, 'smoke')) return null;
  const m = rivalsOnMap(c).find((x) => belowHalf(x) && within(x.at, r.at, THROW_RANGE.smoke) && los(c.w, c.d, r.at, x.at) && underFire(c, x));
  if (!m) return null;
  return { kind: 'smoke', item: 'smoke', targetId: m.id, to: { ...m.at } };
}

/** Sleep dart: a hero alone first (spec 28.8: one the crew could carry off), else the lantern bearer, else the nearest hero in range 5 and sight. */
function dartIntent(c: Ctx, r: RivalX): Intent | null {
  if (!hasKit(r, 'dart')) return null;
  const seen = heroesInSight(c, r, THROW_RANGE.dart).filter((t) => !(t.hero as HeroX | undefined)?.dozing && !isParalyzed(t.hero));
  const t = seen.find((x) => alone(c, x.hero as HeroX)) ?? seen.find((x) => x.id === c.d.lanternBearer) ?? seen[0];
  return t ? { kind: 'dart', item: 'dart', targetId: t.id } : null;
}

/**
 * V4.0 (spec 29.3, pillar 17): a venom dart at a hero in range 5 and sight the venom can take (not paralyzed already,
 * not envenomed: one dose is enough to count down): a hero alone first (spec 28.8's `alone`: nobody up within 4 to carry
 * them out, and paralyzed and alone the crew can carry them off), else the crew's target, else the nearest.
 */
function venomIntent(c: Ctx, r: RivalX, t: Target | null): Intent | null {
  if (!hasKit(r, 'venomdart')) return null;
  const seen = heroesInSight(c, r, THROW_RANGE.venomdart).filter((x) => x.hero && !(x.hero.venom ?? 0) && venomTakes(c, x.id));
  if (!seen.length) return null;
  // Spec 28.8's "alone" (no other hero who is up within CAPTURE_ALONE): paralyzed and alone, the crew can carry them off.
  const lone = seen.find((x) => alone(c, x.hero as HeroX));
  const pick = lone ?? (t && seen.find((x) => x.id === t.id)) ?? seen[0]!;
  return { kind: 'venomdart', item: 'venomdart', targetId: pick.id };
}

/**
 * Caltrops on the hex the nearest hero would charge through: the member's neighbour on that hero's
 * shortest way in. Only while the bow has nothing to shoot at (a Ranger with a target shoots).
 */
function caltropsIntent(c: Ctx, r: RivalX): Intent | null {
  if (!hasKit(r, 'caltrops')) return null;
  const t = nearestHero(c, r);
  if (!t || t.at.level !== r.at.level || distance(t.at, r.at) <= 1 || distance(t.at, r.at) > 6) return null;
  if (r.cls === 'ranger' && heroesInSight(c, r, BOW_RANGE).length) return null;
  const nodes = dijkstra(c.w, c.d, t.at, { enter: (p) => !blocked(c, p, t.id), stairs: false, budget: 8 });
  let best: Pos | null = null;
  let bestCost = Infinity;
  for (const p of posNeighbors(r.at)) {
    if (!standable(c.w, c.d, p) || occupant(c, p) || c.d.caltrops.includes(posKey(p)) || c.d.traps[posKey(p)]) continue;
    const n = nodes.get(posKey(p));
    if (n && n.cost < bestCost) {
      bestCost = n.cost;
      best = p;
    }
  }
  return best ? { kind: 'caltrops', item: 'caltrops', to: { ...best } } : null;
}

/** Glue on the hero front line: a hex within 4 in sight with two heroes next to each other within 1 of it. */
function glueIntent(c: Ctx, r: RivalX): Intent | null {
  if (!hasKit(r, 'glue')) return null;
  const hs = activeHeroes(c).filter((h) => h.at.level === r.at.level && within(h.at, r.at, THROW_RANGE.glue + 1));
  const pairs = hs.filter((h) => hs.some((o) => o !== h && adjacentTo(o.at, h.at)));
  if (pairs.length < 2) return null;
  let best: Pos | null = null;
  let bestN = 1;
  for (const x of range(r.at, THROW_RANGE.glue)) {
    const p = { level: r.at.level, ...x };
    if (!isFloorish(c.w, c.d, p) || !los(c.w, c.d, r.at, p)) continue;
    if (rivalsOnMap(c).some((m) => within(m.at, p, 1))) continue;
    const n = pairs.filter((h) => within(h.at, p, 1)).length;
    if (n > bestN) {
      bestN = n;
      best = p;
    }
  }
  return best ? { kind: 'glue', item: 'glue', to: { ...best } } : null;
}

/** A Sellsword's edge shove (like the orc's), from here or from the end of its walk. */
function shoveIntent(c: Ctx, r: RivalX): Intent | null {
  const t = nearestHero(c, r);
  if (!t) return null;
  let from: Pos | null = within(r.at, t.at, 1) ? r.at : null;
  if (!from) {
    const path = approach(c, r.id, r.at, attackSpots(c, t.at, r.id), rivalStats(r).move, true) ?? [];
    const end = path[path.length - 1];
    from = end && within(end, t.at, 1) ? end : null;
  }
  if (!from) return null;
  const o = pushOutcome(c, from, t.at, t.id);
  if (o.kind !== 'fall' || !o.fall) return null;
  r.shoveFrom = { ...from };
  return { kind: 'shove', targetId: t.id, to: o.dest, damage: [0, o.fall.damage] };
}

/** The Ranger's knockback shot on a hero at an unrailed edge within 5. */
function knockbackIntent(c: Ctx, r: RivalX): Intent | null {
  const kb = heroesInSight(c, r, KNOCKBACK_RANGE).find((t) => {
    const o = pushOutcome(c, pusherFor(r.at, t.at), t.at, t.id);
    return o.kind === 'fall' && !!o.fall;
  });
  if (!kb) return null;
  const o = pushOutcome(c, pusherFor(r.at, kb.at), kb.at, kb.id);
  return { kind: 'shove', targetId: kb.id, to: o.dest, damage: [0, o.fall?.damage ?? 0] };
}

/** Spec 20.5: a rival Ranger hamstrings a hero closing in (the kit agent's `hamstringIntent`): the crew's target first. */
function rangerHamstring(c: Ctx, r: RivalX, t: Target | null): Intent | null {
  const seen = heroesInSight(c, r, 3);
  const x = (t && seen.find((s) => s.id === t.id)) ?? seen[0];
  return x ? hamstringIntent(c, r.at, x) : null;
}

/** Overwatch when no hero is in bow reach, even after walking. */
function overwatchIntent(c: Ctx, r: RivalX): Intent | null {
  if (heroesInSight(c, r, BOW_RANGE).length) return null;
  const t = nearestHero(c, r);
  if (t) {
    const path = approach(c, r.id, r.at, shootingSpots(c, r, t), rivalStats(r).move, true) ?? [];
    const end = path[path.length - 1];
    if (end && within(end, t.at, BOW_RANGE) && los(c.w, c.d, end, t.at)) return null;
  }
  return { kind: 'overwatch', targetId: r.id };
}

function noCrewWithin(c: Ctx, p: Pos, n: number, except?: RivalX): boolean {
  return !rivalsOnMap(c).some((m) => m !== except && within(m.at, p, n));
}

/**
 * The Sapper's charge (fuse 1, the heroes' blast rules): thrown onto the hex behind a hero standing at
 * a pit edge (the blast throws them in), else thrown at a hero 2-3 away, else set on the member's own
 * neighbour toward a hero 3-5 away (the party's path).
 */
function fuseIntent(c: Ctx, r: RivalX): Intent | null {
  if (!hasKit(r, 'charge')) return null;
  if (targets(c).some((t) => t.hero && within(t.at, r.at, 1))) return null; // in their face: the hammer
  const seen = heroesInSight(c, r, SAPPER_CHARGE_RANGE + 1).filter((t) => distance(t.at, r.at) >= 2);
  const make = (to: Pos, targetId?: string): Intent => ({ kind: 'fuse', ...(targetId ? { targetId } : {}), to: { ...to }, hexes: blastArea(c.w, to), damage: [BLAST_OUTER_DMG, BLAST_INNER_DMG] });
  // A hero at an edge: the charge lands on their far side so the blast throws them over.
  for (const t of seen) {
    for (const b of posNeighbors(t.at)) {
      if (!isFloorish(c.w, c.d, b) || !within(b, r.at, SAPPER_CHARGE_RANGE) || distance(b, r.at) < 2 || !los(c.w, c.d, r.at, b) || fuseAt(c.d, b)) continue;
      if (!noCrewWithin(c, b, 1)) continue;
      const o = pushOutcome(c, b, t.at, t.id);
      if (o.kind === 'fall' && o.fall) return make(b, t.id);
    }
  }
  const t = seen.find((x) => distance(x.at, r.at) <= SAPPER_CHARGE_RANGE && noCrewWithin(c, x.at, 1) && !fuseAt(c.d, x.at));
  if (t) return make(t.at, t.id);
  // Set it on the way in: the neighbour toward the nearest hero 3-5 off, with no member but the Sapper within 1.
  const n = nearestHero(c, r);
  if (n && n.at.level === r.at.level && distance(n.at, r.at) >= 3 && distance(n.at, r.at) <= 5) {
    const spot = posNeighbors(r.at)
      .filter((p) => isFloorish(c.w, c.d, p) && !occupant(c, p) && !fuseAt(c.d, p) && noCrewWithin(c, p, 1, r))
      .sort((a, b) => distance(a, n.at) - distance(b, n.at) || posKey(a).localeCompare(posKey(b)))[0];
    if (spot && distance(spot, n.at) < distance(r.at, n.at)) {
      r.kitFrom = { ...r.at };
      return make(spot, n.id);
    }
  }
  return null;
}

/** Fireball (2 mana) where three heroes stand within 1 of a hex in range and sight; else firebolt (1 mana). */
function pyroIntent(c: Ctx, r: RivalX, t: Target | null): Intent | null {
  const mana = manaOf(r);
  if (mana >= 2) {
    const hs = activeHeroes(c).filter((h) => h.at.level === r.at.level && h.veil <= 0);
    let best: Pos | null = null;
    let bestN = 2;
    for (const x of range(r.at, FIREBALL_RANGE)) {
      const p = { level: r.at.level, ...x };
      if (!(isFloorish(c.w, c.d, p) || kindAt(c.w, c.d, p) === 'pit') || !los(c.w, c.d, r.at, p)) continue;
      if (!noCrewWithin(c, p, 1)) continue;
      const n = hs.filter((h) => within(h.at, p, 1)).length;
      if (n > bestN) {
        bestN = n;
        best = p;
      }
    }
    if (best) return { kind: 'fireball', to: { ...best }, hexes: [best, ...posNeighbors(best)], damage: [0, 7] };
  }
  if (mana >= 1) {
    const seen = heroesInSight(c, r, PYRO_BOLT_RANGE);
    const x = (t && seen.find((s) => s.id === t.id)) ?? seen[0];
    if (x) return { kind: 'firebolt', targetId: x.id, damage: hitRange(PYRO_BOLT_SLOTS, PYRO_BOLT_DMG, x.armor) };
  }
  return null;
}

/** Firecracker: when a group of monsters near the party isn't hunting yet, a bang at a hero's feet brings them. */
function firecrackerIntent(c: Ctx, r: RivalX): Intent | null {
  if (!hasKit(r, 'firecracker')) return null;
  for (const t of heroesInSight(c, r, THROW_RANGE.firecracker)) {
    const group = onMap(c).filter((m) => m.kind !== 'gloam' && m.kind !== 'dragon' && m.awareness !== 'hunting' && m.at.level === t.at.level && distance(m.at, t.at) <= FIRECRACKER_NOISE);
    if (group.length >= 2) return { kind: 'firecracker', item: 'firecracker', to: { ...t.at }, targetId: t.id };
  }
  return null;
}

/** Shadowmancer: Blink away below half, veil the striker on first contact, a firecracker for the monsters, smoke. */
function shadowIntent(c: Ctx, r: RivalX): Intent | null {
  const mana = manaOf(r);
  if (mana >= 1 && belowHalf(r)) {
    const hs = activeHeroes(c).filter((h) => h.at.level === r.at.level);
    let best: Pos | null = null;
    let bestD = Math.min(99, ...hs.map((h) => distance(h.at, r.at)));
    for (const x of range(r.at, BLINK_RANGE)) {
      const p = { level: r.at.level, ...x };
      if (samePos(p, r.at) || !standable(c.w, c.d, p) || occupant(c, p) || !los(c.w, c.d, r.at, p)) continue;
      const d = Math.min(99, ...hs.map((h) => distance(h.at, p)));
      if (d > bestD) {
        bestD = d;
        best = p;
      }
    }
    if (best) return { kind: 'blink', to: { ...best } };
  }
  if (mana >= 1) {
    const s = striker(c);
    if (s && s !== r && (s.veil ?? 0) <= 0 && !s.veiled && within(s.at, r.at, SPELL_RANGE) && heroesInSight(c, s, BOW_RANGE).length) {
      return { kind: 'veil', targetId: s.id };
    }
  }
  return firecrackerIntent(c, r) ?? smokeIntent(c, r);
}

/** Hedgewitch: Mend the member below half, Gust a hero at an edge, Ward the striker. */
function witchIntent(c: Ctx, r: RivalX): Intent | null {
  const mana = manaOf(r);
  if (mana < 1) return null;
  // V4.0 (spec 29.6): Mend draws out venom too: a paralyzed or envenomed member first.
  const sick = rivalsOnMap(c).filter((m) => ((m.venom ?? 0) > 0 || isParalyzed(m)) && within(m.at, r.at, SPELL_RANGE)).sort((a, b) => Number(isParalyzed(b)) - Number(isParalyzed(a)) || (a.id < b.id ? -1 : 1))[0];
  if (sick) return { kind: 'mend', targetId: sick.id };
  const hurt = rivalsOnMap(c).filter((m) => belowHalf(m) && within(m.at, r.at, SPELL_RANGE)).sort((a, b) => a.hp - b.hp || (a.id < b.id ? -1 : 1))[0];
  if (hurt) return { kind: 'mend', targetId: hurt.id };
  for (const t of heroesInSight(c, r, GUST_RANGE + 1)) {
    for (const g of posNeighbors(t.at)) {
      if (!within(g, r.at, GUST_RANGE) || !(isFloorish(c.w, c.d, g) || kindAt(c.w, c.d, g) === 'pit') || !los(c.w, c.d, r.at, g)) continue;
      if (rivalsOnMap(c).some((m) => within(m.at, g, 1))) continue;
      const o = pushOutcome(c, g, t.at, t.id);
      if (o.kind === 'fall' && o.fall) return { kind: 'gust', to: { ...g }, hexes: [g, ...posNeighbors(g)], targetId: t.id, damage: [0, o.fall.damage] };
    }
  }
  const s = striker(c);
  if (s && (s.ward ?? 0) <= 0 && within(s.at, r.at, SPELL_RANGE) && heroesInSight(c, s, BOW_RANGE).length) return { kind: 'ward', targetId: s.id };
  return null;
}

/** The kit intent a hostile member would use now, by class (spec 20.4), or null for a plain attack. */
export function kitIntent(c: Ctx, r: RivalX, t: Target | null): Intent | null {
  const potion = potionIntent(c, r);
  if (potion) return potion;
  switch (r.cls) {
    case 'burglar':
      return venomIntent(c, r, t) ?? dartIntent(c, r) ?? smokeIntent(c, r);
    case 'ranger':
      return knockbackIntent(c, r) ?? rangerHamstring(c, r, t) ?? caltropsIntent(c, r) ?? overwatchIntent(c, r);
    case 'sellsword':
      // Glue is for the charge, not for a brawl already joined: only when nobody is at his blade.
      return shoveIntent(c, r) ?? (targets(c).some((x) => x.hero && adjacentTo(x.at, r.at)) ? null : glueIntent(c, r));
    case 'sapper':
      return fuseIntent(c, r);
    case 'pyromancer':
      return pyroIntent(c, r, t);
    case 'shadowmancer':
      return shadowIntent(c, r);
    case 'hedgewitch':
      return witchIntent(c, r);
  }
  return null;
}

export const KIT: Intent['kind'][] = ['veil', 'overwatch', 'shove', 'smoke', 'dart', 'venomdart', 'fuse', 'firebolt', 'fireball', 'potion', 'glue', 'caltrops', 'firecracker', 'blink', 'mend', 'gust', 'ward', 'item', 'hamstring'];

/** A sleep dart on a hero: a hit costs them their next move and action (spec 16.5). */
function throwDart(c: Ctx, r: RivalX, t: Target): void {
  spendKit(r, 'dart');
  c.ev.push({ type: 'thrown', by: r.id, kind: 'dart', from: { ...r.at }, to: { ...t.at } });
  const rr = roll(c, r.id, 'Sleep dart', 1, dartChance(r));
  c.ev.push({ type: 'cast', by: r.id, spell: 'dart', targetId: t.id, at: { ...t.at } });
  if (rr.hits) {
    const h = t.hero as HeroX;
    h.dozing = true;
    h.webbed = true;
    c.ev.push({ type: 'hit', attacker: r.id, target: t.id, damage: 0, crit: false });
    say(c, `${heroName(c, t.id)} slumps, drugged. Out for a turn.`);
  } else {
    c.ev.push({ type: 'miss', attacker: r.id, target: t.id });
  }
}

/** Carry out a kit intent (hostile crews; veil and potions for any stance). Returns true if it used the member's turn. */
export function useKit(c: Ctx, r: RivalX, it: Intent): boolean {
  const cr = c.d.rivals!;
  const st = rivalStats(r);
  const t = targets(c).find((x) => x.id === it.targetId);
  const member = rivalsOnMap(c).find((x) => x.id === it.targetId);
  // V3.9.2 (spec 24.7): using an item or a spell turns the user toward its target.
  {
    const to = it.to ?? t?.at ?? member?.at;
    if (to && member !== r) faceToward(r, to);
  }
  switch (it.kind) {
    case 'veil': {
      const who = member ?? r;
      if (r.level !== undefined) {
        if (manaOf(r) < 1) return false;
        spendMana(r, 1);
      }
      who.veil = VEIL_ROUNDS;
      who.veiled = true;
      if (who === r) r.veiled = true;
      c.ev.push({ type: 'cast', by: r.id, spell: 'veil', targetId: who.id });
      say(c, who === r ? `${r.name} melts into the shadows.` : `${r.name} wraps ${who.name} in shadow.`);
      return true;
    }
    case 'potion': {
      if (!hasKit(r, 'potion')) return false;
      if (it.to && !samePos(it.to, r.at)) {
        if (occupant(c, it.to) || !adjacentTo(it.to, r.at)) {
          const step = freeStep(c, r, nearestHero(c, r)?.at);
          if (step) crewWalk(c, r, [step]);
        } else crewWalk(c, r, [it.to]);
        if (!rivalsOnMap(c).includes(r)) return true;
      }
      spendKit(r, 'potion');
      const before = r.hp;
      r.hp = Math.min(r.maxHp, r.hp + RIVAL_POTION_HEAL);
      c.ev.push({ type: 'cast', by: r.id, spell: 'potion', targetId: r.id });
      say(c, `${r.name} backs off and drinks a potion (+${r.hp - before}).`);
      return true;
    }
  }
  if (cr.stance !== 'hostile') return false;
  switch (it.kind) {
    case 'overwatch':
      r.overwatch = true;
      c.ev.push({ type: 'cast', by: r.id, spell: 'overwatch' });
      say(c, `${r.name} nocks an arrow and waits.`);
      return true;
    case 'shove': {
      if (!t?.hero) return false;
      if (r.cls === 'sellsword') {
        const from = r.shoveFrom ?? r.at;
        r.shoveFrom = undefined;
        if (!samePos(from, r.at)) {
          if (occupant(c, from)) return false;
          const path = approach(c, r.id, r.at, [from], st.move, true) ?? [];
          crewWalk(c, r, path);
          if (!rivalsOnMap(c).includes(r)) return true;
        }
        if (!within(r.at, t.at, 1) || pushOutcome(c, r.at, t.at, t.id).kind !== 'fall') return false;
        faceToward(r, t.at);
        say(c, `${r.name} lunges to shove ${heroName(c, t.id)} over the edge.`);
        if (chance(c.s, SELLSWORD_SHOVE_CHANCE)) push(c, t.id, r.at, r.id);
        else {
          c.ev.push({ type: 'miss', attacker: r.id, target: t.id });
          say(c, `${heroName(c, t.id)} keeps their footing.`);
        }
        return true;
      }
      if (!within(t.at, r.at, KNOCKBACK_RANGE) || !los(c.w, c.d, r.at, t.at)) return false;
      faceToward(r, t.at);
      say(c, `${r.name} aims to knock ${heroName(c, t.id)} off the edge.`);
      const roll2 = roll(c, r.id, 'Knockback shot', 2, st.chance);
      if (roll2.hits < 2) {
        c.ev.push({ type: 'miss', attacker: r.id, target: t.id });
        return true;
      }
      c.ev.push({ type: 'cast', by: r.id, spell: 'knockback', targetId: t.id, at: { ...t.at } });
      push(c, t.id, pusherFor(r.at, t.at), null);
      return true;
    }
    case 'smoke': {
      const at = it.to ?? t?.at;
      if (!hasKit(r, 'smoke') || !at || !within(at, r.at, THROW_RANGE.smoke)) return false;
      spendKit(r, 'smoke');
      c.ev.push({ type: 'thrown', by: r.id, kind: 'smoke', from: { ...r.at }, to: { ...at } });
      const hexes = smokeOut(c, at);
      c.ev.push({ type: 'cast', by: r.id, spell: 'smoke', at: { ...at }, hexes });
      say(c, member ? `${r.name} drops a smoke bomb around ${member.name}.` : `${r.name} drops a smoke bomb at ${t ? heroName(c, t.id) : 'the party'}'s feet.`);
      return true;
    }
    case 'dart': {
      if (!hasKit(r, 'dart') || !t?.hero || !within(t.at, r.at, THROW_RANGE.dart) || !los(c.w, c.d, r.at, t.at)) return false;
      faceToward(r, t.at);
      throwDart(c, r, t);
      return true;
    }
    case 'venomdart': {
      // V4.0 (spec 29.3): the heroes' venom dart turned on them: 1 Finesse slot, a hit envenoms.
      if (!hasKit(r, 'venomdart') || !t?.hero || !within(t.at, r.at, THROW_RANGE.venomdart) || !los(c.w, c.d, r.at, t.at)) return false;
      faceToward(r, t.at);
      spendKit(r, 'venomdart');
      c.ev.push({ type: 'thrown', by: r.id, kind: 'venomdart', from: { ...r.at }, to: { ...t.at } });
      const rr = roll(c, r.id, 'Venom dart', 1, dartChance(r));
      c.ev.push({ type: 'cast', by: r.id, spell: 'venomdart', targetId: t.id, at: { ...t.at } });
      if (rr.hits) {
        c.ev.push({ type: 'hit', attacker: r.id, target: t.id, damage: 0, crit: false });
        envenom(c, t.id, r.id);
      } else c.ev.push({ type: 'miss', attacker: r.id, target: t.id });
      return true;
    }
    case 'fuse': {
      // The charge lands (or is set) where the intent showed and burns a fuse of 1: it goes off at the end of the next world phase.
      if (!hasKit(r, 'charge') || !it.to || fuseAt(c.d, it.to)) return false;
      const set = adjacentTo(it.to, r.at);
      if (!set && (!within(it.to, r.at, SAPPER_CHARGE_RANGE) || !los(c.w, c.d, r.at, it.to))) return false;
      spendKit(r, 'charge');
      r.kitFrom = undefined;
      if (!set) c.ev.push({ type: 'thrown', by: r.id, kind: 'charge', from: { ...r.at }, to: { ...it.to } });
      setFuse(c, it.to, 1, r.id);
      say(c, set ? `${r.name} sets a charge on the way in. The fuse is lit.` : `${r.name} lobs a charge. The fuse is lit.`);
      return true;
    }
    case 'hamstring': {
      if (!t?.hero || !hamstringIntent(c, r.at, t)) return false;
      faceToward(r, t.at);
      hamstringShot(c, r.id, t, st.chance);
      return true;
    }
    case 'firebolt': {
      if (manaOf(r) < 1 || !t?.hero || !within(t.at, r.at, PYRO_BOLT_RANGE) || !los(c.w, c.d, r.at, t.at)) return false;
      spendMana(r, 1);
      faceToward(r, t.at);
      c.ev.push({ type: 'cast', by: r.id, spell: 'firebolt', targetId: t.id, at: { ...t.at } });
      say(c, `${r.name} hurls a firebolt at ${heroName(c, t.id)}.`);
      strike(c, r.id, t.id, PYRO_BOLT_SLOTS, spellChance(r), PYRO_BOLT_DMG, 'Firebolt');
      makeNoise(c, r.at, PYRO_BOLT_NOISE, { what: 'clash' });
      return true;
    }
    case 'fireball': {
      if (manaOf(r) < 2 || !it.to || !within(it.to, r.at, FIREBALL_RANGE) || !los(c.w, c.d, r.at, it.to)) return false;
      spendMana(r, 2);
      const hexes = [it.to, ...posNeighbors(it.to)].filter((p) => isFloorish(c.w, c.d, p) || kindAt(c.w, c.d, p) === 'pit');
      const rr = roll(c, r.id, 'Fireball', 3, spellChance(r));
      c.ev.push({ type: 'cast', by: r.id, spell: 'fireball', at: { ...it.to }, hexes });
      makeNoise(c, it.to, FIREBALL_NOISE, { what: 'blast' });
      for (const p of hexes) if (isFloorish(c.w, c.d, p)) c.d.burning[posKey(p)] = 2;
      say(c, `${r.name} hurls a fireball.`);
      if (!rr.hits) return true;
      const ids: string[] = [];
      for (const h of c.d.heroes) if ((h.status === 'active' || h.status === 'downed') && hexes.some((p) => samePos(p, h.at))) ids.push(h.heroId);
      for (const m of onMap(c)) if (m.kind !== 'gloam' && hexes.some((p) => samePos(p, m.at))) ids.push(m.id);
      for (const m of rivalsOnMap(c)) if (hexes.some((p) => samePos(p, m.at))) ids.push(m.id);
      for (const id of ids) {
        const h = hd(c, id);
        if (h) {
          // The heroes' fireball rule (spec 15.3): 2 per hit less armor (min 1), less the ward.
          const def = c.s.campaign.roster.find((x) => x.id === id)!;
          const per = Math.max(0, Math.max(1, 2 - (CLASSES[def.cls].armor + def.armorTier)) - (h.ward > 0 ? 1 : 0));
          hurtHero(c, h, rr.hits * per + (rr.perfect ? 1 : 0), r.id, rr.perfect);
        } else {
          const m = c.d.monsters.find((x) => x.id === id);
          const armor = m ? monsterArmor(c, m) : 0;
          hurtAny(c, id, rr.hits * Math.max(1, 2 - armor) + (rr.perfect ? 1 : 0), null, { crit: rr.perfect });
        }
      }
      return true;
    }
    case 'glue': {
      if (!hasKit(r, 'glue') || !it.to || !within(it.to, r.at, THROW_RANGE.glue)) return false;
      spendKit(r, 'glue');
      c.ev.push({ type: 'thrown', by: r.id, kind: 'glue', from: { ...r.at }, to: { ...it.to } });
      const hexes = [it.to, ...posNeighbors(it.to)].filter((p) => isFloorish(c.w, c.d, p));
      for (const p of hexes) c.d.glue[posKey(p)] = GLUE_ROUNDS;
      c.ev.push({ type: 'cast', by: r.id, spell: 'glue', at: { ...it.to }, hexes });
      const stuck: string[] = [];
      for (const h of activeHeroes(c)) {
        if (!hexes.some((p) => samePos(p, h.at))) continue;
        h.webbed = true; // rooted: no move this coming turn (spec 15.4's glue, on heroes)
        stuck.push(heroName(c, h.heroId));
      }
      for (const m of onMap(c)) if (m.kind !== 'gloam' && m.kind !== 'dragon' && hexes.some((p) => samePos(p, m.at))) m.stuck = GLUE_ROUNDS;
      say(c, stuck.length ? `${r.name}'s glue bomb bursts. ${stuck.join(' and ')} ${stuck.length === 1 ? 'is' : 'are'} stuck fast.` : `${r.name}'s glue bomb bursts.`);
      return true;
    }
    case 'caltrops': {
      if (!hasKit(r, 'caltrops') || !it.to || !adjacentTo(it.to, r.at) || occupant(c, it.to) || c.d.caltrops.includes(posKey(it.to))) return false;
      spendKit(r, 'caltrops');
      c.ev.push({ type: 'thrown', by: r.id, kind: 'caltrops', from: { ...r.at }, to: { ...it.to } });
      c.d.caltrops.push(posKey(it.to));
      (c.d.rivalCaltrops ??= []).push(posKey(it.to));
      say(c, `${r.name} scatters caltrops.`);
      return true;
    }
    case 'firecracker': {
      if (!hasKit(r, 'firecracker') || !it.to || !within(it.to, r.at, THROW_RANGE.firecracker)) return false;
      spendKit(r, 'firecracker');
      c.ev.push({ type: 'thrown', by: r.id, kind: 'firecracker', from: { ...r.at }, to: { ...it.to } });
      say(c, `${r.name} tosses a firecracker at the party's feet. Crack! Everything nearby turns to look.`);
      makeNoise(c, it.to, FIRECRACKER_NOISE, { what: 'blast' });
      return true;
    }
    case 'blink': {
      if (manaOf(r) < 1 || !it.to || occupant(c, it.to) || !standable(c.w, c.d, it.to) || !within(it.to, r.at, BLINK_RANGE)) return false;
      spendMana(r, 1);
      const from = { ...r.at };
      r.at = { ...it.to };
      c.ev.push({ type: 'blinked', id: r.id, from, to: { ...r.at } });
      say(c, `${r.name} is gone in a blink of shadow.`);
      return true;
    }
    case 'mend': {
      if (manaOf(r) < 1 || !member || !within(member.at, r.at, SPELL_RANGE)) return false;
      spendMana(r, 1);
      const before = member.hp;
      member.hp = Math.min(member.maxHp, member.hp + 4);
      c.ev.push({ type: 'cast', by: r.id, spell: 'mend', targetId: member.id });
      const drawn = cureVenom(c, member.id, 'mend', r.id);
      say(c, `${r.name} mends ${member.name} (+${member.hp - before})${drawn ? ' and draws out the venom' : ''}.`);
      return true;
    }
    case 'ward': {
      if (manaOf(r) < 1 || !member || !within(member.at, r.at, SPELL_RANGE)) return false;
      spendMana(r, 1);
      member.ward = WARD_ROUNDS + 1; // ticks down at the end of this world phase too
      c.ev.push({ type: 'cast', by: r.id, spell: 'ward', targetId: member.id });
      say(c, `${r.name} wards ${member.name}.`);
      return true;
    }
    case 'gust': {
      if (manaOf(r) < 1 || !it.to || !within(it.to, r.at, GUST_RANGE) || !los(c.w, c.d, r.at, it.to)) return false;
      spendMana(r, 1);
      const hexes = [it.to, ...posNeighbors(it.to)];
      c.ev.push({ type: 'cast', by: r.id, spell: 'gust', at: { ...it.to }, hexes });
      makeNoise(c, it.to, GUST_NOISE, { what: 'crash' });
      say(c, `${r.name} calls up a gust.`);
      const ids: string[] = [];
      for (const h of c.d.heroes) if (h.status === 'active' && hexes.some((p) => samePos(p, h.at)) && !samePos(h.at, it.to)) ids.push(h.heroId);
      for (const m of onMap(c)) if (m.kind !== 'gloam' && m.kind !== 'dragon' && hexes.some((p) => samePos(p, m.at)) && !samePos(m.at, it.to)) ids.push(m.id);
      for (const id of ids) push(c, id, it.to, null);
      return true;
    }
  }
  return false;
}

/**
 * A hero steps on caltrops a crew laid (the heroes' own rule, spec 15.4, turned on them): 2 damage
 * and the walk ends here. The party's own caltrops never catch them. Returns true when it bit.
 */
export function rivalCaltropsStep(c: Ctx, h: HeroX, p: Pos): boolean {
  const k = posKey(p);
  if (!c.d.rivalCaltrops?.includes(k)) return false;
  c.d.rivalCaltrops = c.d.rivalCaltrops.filter((x) => x !== k);
  c.d.caltrops = c.d.caltrops.filter((x) => x !== k);
  c.ev.push({ type: 'caltrops', id: h.heroId, at: { ...p } });
  say(c, `${heroName(c, h.heroId)} treads on caltrops.`);
  hurtHero(c, h, CALTROPS_DMG, 'caltrops');
  return true;
}

// ---------------------------------------------------------------- captives (spec 20.4; spec 28.8: helpless and alone)

/** The member carrying this hero off, if any. */
export function draggedBy(c: Ctx, heroId: string): RivalX | undefined {
  return rivalsOnMap(c).find((m) => m.dragging === heroId);
}

/** Spec 28.8: heroes who are up: active, awake (not dozing), not paralyzed (spec 29) and not in a crew member's hands. */
function upHeroes(c: Ctx): HeroX[] {
  return (activeHeroes(c) as HeroX[]).filter((h) => !h.dozing && !isParalyzed(h) && !draggedBy(c, h.heroId));
}

/** Spec 28.8: downed, or dozing from a sleep dart; V4.0 (spec 29): or paralyzed. */
export function helpless(h: HeroX): boolean {
  return h.status === 'downed' || (h.status === 'active' && (!!h.dozing || isParalyzed(h)));
}

/** Spec 28.8: no other hero who is up within `CAPTURE_ALONE` hexes (straight-line, same level). */
export function alone(c: Ctx, h: HeroX): boolean {
  return !upHeroes(c).some((o) => o !== h && o.at.level === h.at.level && distance(o.at, h.at) <= CAPTURE_ALONE);
}

/**
 * Spec 28.8: a helpless hero alone, nobody's captive yet, that the member can stand next to this round (its walk).
 * Supersedes spec 20.4's "a downed hero within 2" (a hero dropped by a killed dragger may be taken again, if alone).
 */
function seizable(c: Ctx, r: RivalX): { h: HeroX; path: Pos[] } | undefined {
  const move = rivalStats(r).move;
  const cands = (c.d.heroes as HeroX[])
    .filter((h) => helpless(h) && h.at.level === r.at.level && distance(h.at, r.at) <= move + 1 && !draggedBy(c, h.heroId) && alone(c, h))
    .sort((a, b) => distance(a.at, r.at) - distance(b.at, r.at) || (a.heroId < b.heroId ? -1 : 1));
  for (const h of cands) {
    if (adjacentTo(h.at, r.at)) return { h, path: [] };
    const path = approach(c, r.id, r.at, attackSpots(c, h.at, r.id), move, true) ?? [];
    const end = path[path.length - 1];
    if (end && adjacentTo(h.at, end)) return { h, path };
  }
  return undefined;
}

/**
 * Spec 28.8: a downed hero next to the member, not being carried off, when no hero who is up stands next to the member:
 * it finishes them (an attack; any damage to a downed hero kills). With a hero at its blade it fights the living instead.
 */
function finishable(c: Ctx, r: RivalX): HeroX | undefined {
  if (upHeroes(c).some((h) => adjacentTo(h.at, r.at))) return undefined;
  return (c.d.heroes as HeroX[]).find((h) => h.status === 'downed' && adjacentTo(h.at, r.at) && !draggedBy(c, h.heroId));
}

/**
 * Seize a helpless lone hero (spec 28.8): gold, gems and jewelry out of their pack into the member's loot; the member takes
 * hold. A dozing hero is held (`grabbedBy` the member): they wake at their next turn in its grip and may Escape (2 Might
 * slots, 1 hit) or fight it; held, they can't move.
 */
export function rob(c: Ctx, r: RivalX, h: HeroX): void {
  const items = h.pack.filter((i) => !i.story && (i.kind === 'gold' || i.kind === 'gem' || i.kind === 'jewelry'));
  h.pack = h.pack.filter((i) => !items.includes(i));
  r.loot.push(...items);
  h.robbed = true;
  r.dragging = h.heroId;
  if (h.status === 'active') h.grabbedBy = r.id;
  faceToward(r, h.at);
  c.ev.push({ type: 'robbed', hero: h.heroId, by: r.id, items });
  const name = heroName(c, h.heroId);
  const how = h.status !== 'active' ? `finds ${name} down and alone` : isParalyzed(h) ? `finds ${name} paralyzed and alone` : `finds ${name} drugged and alone`;
  say(c, items.length ? `${r.name} ${how}, empties their purse and takes hold of them.` : `${r.name} ${how} and takes hold of them.`);
}

/** Spec 28.8: the finishing blow on a downed hero next to the member (a roll; any hit kills). */
function finish(c: Ctx, r: RivalX, h: HeroX): void {
  const st = rivalStats(r);
  faceToward(r, h.at);
  tell(c, r, `${r.name} stands over ${heroName(c, h.heroId)} and strikes.`, h.at);
  strike(c, r.id, h.heroId, st.slots, st.chance, st.dmg, 'Finishing blow');
}

/** Where the dragger is heading: the nearest exit on foot. */
function dragExit(c: Ctx, r: RivalX): Pos | undefined {
  return exitsBy(c, r.at)[0];
}

/** The dragger's plan: three hexes toward the exit, the hero behind. */
function dragPlan(c: Ctx, r: RivalX): Plan {
  const ex = dragExit(c, r);
  if (!ex) return { intent: { kind: 'wait' }, path: [] };
  // Spec 28.8: an awake captive stands in the way like anyone; the dragger may haul them past itself.
  const path = approach(c, r.id, r.at, [ex], DRAG_MOVE, { stairs: true, ...(r.dragging ? { through: r.dragging } : {}) }) ?? [];
  return { intent: { kind: 'drag', targetId: r.dragging, to: path[path.length - 1] ?? { ...r.at } }, path };
}

/** Haul the hero along: the member walks, the hero trails one hex behind; on an exit the hero is taken. */
export function dragAct(c: Ctx, r: RivalX): void {
  const h = r.dragging ? hd(c, r.dragging) : undefined;
  // Downed, or (spec 28.8) a seized hero awake in its grip; revived or free, the member lets go.
  if (!h || !(h.status === 'downed' || (h.status === 'active' && h.grabbedBy === r.id))) {
    r.dragging = undefined;
    if (h?.grabbedBy === r.id) h.grabbedBy = undefined;
    return;
  }
  const plan = dragPlan(c, r);
  if (plan.path.length) {
    const start = { ...r.at };
    const stopped = crewWalk(c, r, plan.path);
    if (!rivalsOnMap(c).includes(r)) return; // a free swing killed it: dropped
    const walked = plan.path.findIndex((p) => samePos(p, r.at));
    // The hero trails one hex behind (the view hauls the figure along on the member's `moved`).
    const trail = walked <= 0 ? start : plan.path[walked - 1]!;
    if (!samePos(trail, h.at)) h.at = { ...trail };
    if (!stopped) say(c, `${r.name} hauls ${heroName(c, h.heroId)} toward the way out.`);
  }
  if (kindAt(c.w, c.d, r.at) === 'exit') capture(c, r, h);
}

/** The dragger stands on an exit: the hero is carried off; the member leaves with them. */
export function capture(c: Ctx, r: RivalX, h: HeroX): void {
  const cr = c.d.rivals!;
  h.status = 'captured';
  h.bleed = 0;
  h.grabbedBy = undefined;
  h.dozing = undefined;
  h.webbed = false;
  r.dragging = undefined;
  r.goneOut = true;
  (cr as { captives?: string[] }).captives ??= [];
  (cr as { captives?: string[] }).captives!.push(h.heroId);
  c.ev.push({ type: 'captured', hero: h.heroId, by: r.id });
  c.ev.push({ type: 'out', id: r.id });
  const name = heroName(c, h.heroId);
  say(c, `${r.name} drags ${name} out of the castle. ${name} is taken.`);
  if (c.d.lanternBearer === h.heroId) {
    const cands = activeHeroes(c);
    if (cands.length) c.d.lanternBearer = cands[0]!.heroId;
  }
}

// ---------------------------------------------------------------- the hostile member's round

/** What a hostile member shows for the coming world phase. */
export function hostilePlan(c: Ctx, r: RivalX): Plan {
  if (r.dragging) return dragPlan(c, r);
  // Spec 28.8: a helpless hero alone is seized; a downed hero next to it is finished while no hero is at its blade.
  const victim = seizable(c, r);
  if (victim) return { intent: { kind: 'rob', targetId: victim.h.heroId, to: victim.path[victim.path.length - 1] ?? { ...r.at } }, path: victim.path };
  const fin = finishable(c, r);
  if (fin) return { intent: { kind: 'attack', targetId: fin.heroId, to: { ...r.at } }, path: [] };
  const t = currentTarget(c);
  const kit = kitIntent(c, r, t);
  if (kit) return { intent: kit, path: [] };
  if (!t) return { intent: { kind: 'wait' }, path: [] };
  return attackPlan(c, r, t);
}

/** The Sellsword marks the caster it stands by: hits meant for the caster land on it (common.ts hurtAny). */
function guardCheck(c: Ctx, r: RivalX): void {
  if (r.cls !== 'sellsword') return;
  const cs = caster(c);
  r.guarding = cs && cs !== r && adjacentTo(cs.at, r.at) ? cs.id : undefined;
}

/** A hostile member acts: the shown kit or rob/drag if still sound, else the attack on the crew's target. */
export function hostileAct(c: Ctx, r: RivalX): void {
  const cr = c.d.rivals!;
  r.overwatch = false; // an unfired overwatch lapses
  if (r.dragging) {
    if (overwatchCheck(c, r.id, r.at) || !rivalsOnMap(c).includes(r)) return;
    dragAct(c, r);
    return;
  }
  const it = r.intent;
  if (it && it.kind === 'rob') {
    const h = it.targetId ? (hd(c, it.targetId) as HeroX | undefined) : undefined;
    if (h && helpless(h) && !draggedBy(c, h.heroId) && alone(c, h)) {
      if (overwatchCheck(c, r.id, r.at) || !rivalsOnMap(c).includes(r)) return;
      if (!adjacentTo(h.at, r.at)) {
        const path = approach(c, r.id, r.at, attackSpots(c, h.at, r.id), rivalStats(r).move, true) ?? [];
        crewWalk(c, r, path);
        if (!rivalsOnMap(c).includes(r)) return;
      }
      if (adjacentTo(h.at, r.at)) {
        rob(c, r, h);
        guardCheck(c, r);
        return;
      }
    }
  }
  // Spec 28.8: the finishing blow shown the round before, if the downed hero is still next to it and nobody is at its blade.
  if (it && it.kind === 'attack' && it.targetId) {
    const h = hd(c, it.targetId) as HeroX | undefined;
    if (h && finishable(c, r) === h) {
      if (overwatchCheck(c, r.id, r.at) || !rivalsOnMap(c).includes(r)) return;
      finish(c, r, h);
      guardCheck(c, r);
      return;
    }
  }
  if (it && KIT.includes(it.kind)) {
    if (cr.stance === 'hostile' && (overwatchCheck(c, r.id, r.at) || !rivalsOnMap(c).includes(r))) return;
    if (useKit(c, r, it)) {
      r.intent = undefined;
      guardCheck(c, r);
      return;
    }
  }
  const t = currentTarget(c);
  if (!t) return;
  if (overwatchCheck(c, r.id, r.at) || !rivalsOnMap(c).includes(r)) return;
  const plan = attackPlan(c, r, t);
  if (plan.way) {
    crewGo(c, r, { path: plan.path, sneak: false, dash: false, way: plan.way });
    guardCheck(c, r);
    return;
  }
  crewWalk(c, r, plan.path, plan.sneak);
  if (!rivalsOnMap(c).includes(r)) return;
  const st = rivalStats(r);
  const canHit = t.at.level === r.at.level && within(t.at, r.at, st.range) && (st.range === 1 || los(c.w, c.d, r.at, t.at));
  // A dash spends the action.
  if (canHit && t.hero?.status === 'active' && !plan.dash) {
    faceToward(r, t.at);
    // V4.0 (spec 28.5): the heroes' rules turned on the party: +1 slot on a hero who hasn't noticed the member (sneak
    // attack, any weapon), and the Burglar's backstab from the hero's blind cone (double damage before armor; its
    // extra slot is the blindside slot `strike` adds from behind).
    const unnoticed = !heroNoticed(r, t.id);
    const stab = unnoticed && r.cls === 'burglar' && st.range === 1 && inRearHalf(t.hero, r.at);
    const slots = st.slots + (unnoticed ? SNEAK_ATTACK_SLOTS : 0);
    const dmgPer = stab ? st.dmg * BACKSTAB_DMG_MULT : st.dmg;
    if (stab) tell(c, r, `${r.name} slips behind ${heroName(c, t.id)} and backstabs.`, t.at);
    else if (unnoticed) tell(c, r, `${r.name} strikes before ${heroName(c, t.id)} sees it coming.`, t.at);
    const hit = strike(c, r.id, t.id, slots, st.chance, dmgPer, stab ? 'Backstab' : unnoticed ? 'Sneak attack' : r.cls === 'ranger' ? 'Shot' : 'Attack');
    // Spec 20.4: a hero this member downs is robbed on the spot and dragged from the next round; spec 28.8: only one left alone.
    const downed = hit ? (hd(c, hit) as HeroX | undefined) : undefined;
    if (downed && downed.status === 'downed' && adjacentTo(downed.at, r.at) && !draggedBy(c, downed.heroId) && alone(c, downed)) rob(c, r, downed);
  }
  guardCheck(c, r);
}

/** Hired members (spec 18.6, 20.4): a potion below half, or the Hedgewitch mends a hurt hero within 3. */
export function hiredKit(c: Ctx, r: RivalX): Intent | null {
  const potion = potionIntent(c, r);
  if (potion) return potion;
  if (r.cls === 'hedgewitch' && manaOf(r) >= 1) {
    // V4.0 (spec 29.6): a hero with venom in them first (paralyzed before envenomed), then the most hurt below half.
    const sick = activeHeroes(c)
      .filter((h) => h.at.level === r.at.level && within(h.at, r.at, SPELL_RANGE) && ((h.venom ?? 0) > 0 || isParalyzed(h)))
      .sort((a, b) => Number(isParalyzed(b)) - Number(isParalyzed(a)))[0];
    if (sick) return { kind: 'mend', targetId: sick.heroId };
    const hurt = activeHeroes(c)
      .filter((h) => h.at.level === r.at.level && within(h.at, r.at, SPELL_RANGE) && h.hp * 2 < (c.s.campaign.roster.find((x) => x.id === h.heroId)?.maxHp ?? 0))
      .sort((a, b) => a.hp - b.hp)[0];
    if (hurt) return { kind: 'mend', targetId: hurt.heroId };
  }
  return null;
}

/** A hired member's Mend on a hero. Returns true if it used the turn. */
export function hiredUse(c: Ctx, r: RivalX, it: Intent): boolean {
  if (it.kind === 'potion' || it.kind === 'veil') return useKit(c, r, it);
  if (it.kind === 'mend') {
    const h = it.targetId ? hd(c, it.targetId) : undefined;
    if (!h || h.status !== 'active' || manaOf(r) < 1 || !within(h.at, r.at, SPELL_RANGE)) return false;
    spendMana(r, 1);
    const max = c.s.campaign.roster.find((x) => x.id === h.heroId)?.maxHp ?? h.hp;
    const before = h.hp;
    h.hp = Math.min(max, h.hp + 4);
    c.ev.push({ type: 'cast', by: r.id, spell: 'mend', targetId: h.heroId });
    const drawn = cureVenom(c, h.heroId, 'mend', r.id);
    say(c, `${r.name} mends ${heroName(c, h.heroId)} (+${h.hp - before})${drawn ? ' and draws out the venom' : ''}.`);
    return true;
  }
  return false;
}

