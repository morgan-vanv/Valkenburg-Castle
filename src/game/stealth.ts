// V3.7 (spec 20.1, 20.2): stealth and free swings. Facing and the blind arc, who notices
// whom, the wake rolls a passing hero provokes, attacks of opportunity both ways, and the
// move preview's risks. Pure rules: no DOM, all dice through the seeded RNG.

import { emitsLight } from './world'; // V4.1 (WS2)
import { DIRS, distance, hexToWorld, posKey, posNeighbors, range, samePos, type Pos } from './hex';
import type { Awareness, HeroInDelve } from './types';
import type { MoveRisks } from './api';
import {
  BELLOW_NOISE, BLINDSIDE_SLOTS, BURGLAR_SIDE_QUIET, CLASSES, CUTTHROAT_SIGHT, NOTICE, NOTICE_QUIET, RUBBLE_STEP_NOISE, SIDE_NOTICE_ADJACENT, SIDE_NOTICE_WALK, STEP_NOISE, SWING_BOW_SLOTS, SWING_SLOT_PENALTY, WAKE_END_SNEAK,
  WAKE_END_SNEAK_QUIET, WAKE_RANGE, WAKE_SNEAK, WAKE_SNEAK_QUIET, WAKE_WALK,
} from './data';
import { chance } from './rng';
import { say, type Ctx, type DelveX, type HeroX, type MonsterX, type RivalX } from './state';
import { activeHeroes, armorOf, goAlert, hd, heroDef, heroName, hurtAny, lightPenaltyFor, monsterArmor, monsterStats, occupant, rivalsOnMap, roll, turnOnHit } from './common';
import { blindCone, dijkstra, dirIndex, inFrontHalf, isFloorish, kindAt, litSet, los, noiseField, pathTo, smoky, type World } from './world';
import { blocked, hitRange, strikeDetailed, wardOf, type Target } from './ai';
import { partySees } from './hearing';
import { figure } from './falls';
import { rivalStats } from './rivals';
import { arrowLands, attackArrow, figureAt, spendArrow, spendCrewArrow, weaponNow } from './arrows'; // V4.1 (WS6)
import { FIRE_ARROW_DMG } from './data'; // V4.1 (WS6)

// ---------------------------------------------------------------- facing

/**
 * Anything on the map that looks somewhere: monsters and crew members. `facing` undefined means it
 * watches all round (a crew at its post, a monster from an older save): no blind arc until it moves,
 * hears or strikes. Spawned monsters start with the map's facing (default 0, east).
 */
export interface Facer {
  at: Pos;
  facing?: number;
  /** V3.9.2 (spec 24.7): blind only in the cone straight behind (heroes, crew members). */
  cone?: boolean;
}

export { dirIndex };

/** Turn toward `p` (no change when p is its own hex or another level). */
export function faceToward(f: Facer, p: Pos): void {
  if (p.level !== f.at.level || samePos(p, f.at)) return;
  f.facing = dirIndex(f.at, p);
}

/** The hex directly behind: one step the opposite way from its facing. */
export function behindHex(f: Facer): Pos {
  const b = DIRS[((f.facing ?? 0) + 3) % 6]!;
  return { level: f.at.level, q: f.at.q + b.q, r: f.at.r + b.r };
}

export { inFrontHalf };

/**
 * Outside the figure's front. Heroes and crew members: their blind cone straight behind (spec 24.7). Monsters:
 * their sides and straight behind (spec 27: where a Burglar backstabs from; what a monster sees there depends on
 * its mood, see `wouldNotice`). Never with no facing.
 */
export function inRearHalf(f: Facer, p: Pos): boolean {
  if (f.facing === undefined || p.level !== f.at.level || samePos(p, f.at)) return false;
  return !inFrontHalf(f, p);
}

/** V3.7 name for the rear half (spec 24.1 made the blind arc the whole rear half). */
export const inBlindArc = inRearHalf;

/**
 * V4.0 (spec 27): where `p` lies as seen from `f`, by the six hex directions relative to its facing: `front`
 * (the facing and its two neighbours), `side` (the two rear-side directions), `back` (straight behind). No
 * facing, or the figure's own hex or another level: front.
 */
export type Bearing = 'front' | 'side' | 'back';
export function bearingOf(f: Facer, p: Pos): Bearing {
  if (f.facing === undefined || p.level !== f.at.level || samePos(p, f.at)) return 'front';
  const off = (dirIndex(f.at, p) - f.facing + 6) % 6;
  return off === 3 ? 'back' : off === 2 || off === 4 ? 'side' : 'front';
}

/**
 * V4.0 (spec 27): a monster's mood, the mark over its head. `asleep`; `unaware`: at its post (alert with no
 * search running, also walking back to it) or on patrol; `searching` (?): alert with search rounds left after it
 * heard something; `hunting` (!): it has seen someone. Saves from before spec 27 read the same way.
 */
export type Mood = 'asleep' | 'unaware' | 'searching' | 'hunting';
export function moodOf(m: { awareness: Awareness; searchRounds?: number }): Mood {
  if (m.awareness === 'asleep') return 'asleep';
  if (m.awareness === 'hunting') return 'hunting';
  if (m.awareness === 'alert' && m.searchRounds !== undefined) return 'searching';
  return 'unaware';
}

/** V4.0 (spec 27): alert and looking for what it heard (search rounds running), not standing at its post. */
export function isSearching(m: { awareness: Awareness; searchRounds?: number }): boolean {
  return moodOf(m) === 'searching';
}

export function directlyBehind(f: Facer, p: Pos): boolean {
  return f.facing !== undefined && samePos(behindHex(f), p);
}

/**
 * V3.9 (spec 24.2): the way a hero faces at delve start: into the castle, toward the middle of the
 * floor within 6 hexes of where they stand on that level.
 */
export function facingInto(w: World, d: DelveX, at: Pos): number {
  let x = 0;
  let z = 0;
  let n = 0;
  for (const hh of range(at, 6)) {
    const p = { level: at.level, ...hh };
    if (samePos(p, at) || !w.tile(p) || !isFloorish(w, d, p)) continue;
    const P = hexToWorld(p);
    x += P.x;
    z += P.z;
    n++;
  }
  if (!n) return 0;
  const A = hexToWorld(at);
  const vx = x / n - A.x;
  const vz = z / n - A.z;
  let best = 0;
  let bestDot = -Infinity;
  DIRS.forEach((dd, i) => {
    const D = hexToWorld(dd);
    const dot = D.x * vx + D.z * vz;
    if (dot > bestDot + 1e-9) {
      bestDot = dot;
      best = i;
    }
  });
  return best;
}

/** Is this hero a Burglar (quiet feet, backstab: spec 24.3)? */
export function quietFeet(c: Ctx, heroId: string): boolean {
  return heroDef(c, heroId)?.cls === 'burglar';
}

// ---------------------------------------------------------------- noticing

/**
 * A figure's move mode for noticing: its last move was a sneak (one that never moved counts as walking). Heroes
 * today (`HeroX.sneaked`); spec 27 hook: any figure with a `sneaked` flag (a crew member, once crews sneak) plugs in.
 */
export function isSneaking(h: HeroInDelve | { sneaked?: boolean }): boolean {
  return (h as { sneaked?: boolean }).sneaked === true;
}

/**
 * Would an awake watcher at `f` notice a hero standing at `heroAt` (spec 20.1, 21.5, 24.3, 27)? By where the hero
 * stands relative to its facing (`bearingOf`) and, for a monster, its mood (`mood`, else read from `f`, else unaware):
 * - FRONT (any mood), and the SIDES of a searching or hunting monster: line of sight (smoke hides beyond 1), then
 *   the range by light and move mode: lit 8/4, unlit 5/1, in the Hollow 8/3 whatever the light; a sneaking
 *   Burglar (`quiet`) lit 2, unlit 1, Hollow 2.
 * - SIDES of an unaware monster: a walking hero within SIDE_NOTICE_WALK (2), anyone adjacent (SIDE_NOTICE_ADJACENT)
 *   but a sneaking Burglar (BURGLAR_SIDE_QUIET).
 * - BEHIND: a walking hero adjacent; a sneaking one never.
 * Heroes and crew members (`blindCone`) see their sides as their front (blind only straight behind, spec 24.7).
 */
export function wouldNotice(c: Ctx, f: Facer & { awareness?: Awareness; searchRounds?: number }, heroAt: Pos, sneaking: boolean, lit: Set<string>, quiet = false, mood?: Mood): boolean {
  if (f.at.level !== heroAt.level || samePos(f.at, heroAt)) return false;
  const md = mood ?? (f.awareness ? moodOf({ awareness: f.awareness, searchRounds: f.searchRounds }) : 'unaware');
  if (md === 'asleep') return false;
  const dist = distance(f.at, heroAt);
  let b = bearingOf(f, heroAt);
  if (b === 'side' && blindCone(f)) b = 'front';
  if (b === 'back') return !sneaking && dist === 1;
  if (b === 'side' && md === 'unaware') {
    // The corner of its eye: a walker within 2, anyone right beside it (a sneaking Burglar's feet are quieter still).
    if (dist === 1 && SIDE_NOTICE_ADJACENT && !(sneaking && quiet && BURGLAR_SIDE_QUIET)) return true;
    if (sneaking || dist > SIDE_NOTICE_WALK) return false;
  }
  const hollow = heroAt.level === 3;
  const isLit = lit.has(posKey(heroAt));
  const sneakRange = quiet ? (hollow ? NOTICE_QUIET.hollowSneak : isLit ? NOTICE_QUIET.litSneak : NOTICE_QUIET.unlitSneak) : hollow ? NOTICE.hollowSneak : isLit ? NOTICE.litSneak : NOTICE.unlitSneak;
  const range: number = sneaking ? sneakRange : hollow ? NOTICE.hollowWalk : isLit ? NOTICE.litWalk : NOTICE.unlitWalk;
  if (dist > range) return false;
  if (dist > 1 && (smoky(c.d, heroAt) || smoky(c.d, f.at))) return false;
  return los(c.w, c.d, f.at, heroAt);
}

/**
 * V4.0 (spec 27): a figure as a watching monster sees it: where it stands, its last move mode, quiet feet (a Burglar).
 * Not hero-specific: crew parity (pillar 17) can add crew members to the list `sightedHeroes` builds.
 */
export interface Sighted {
  id: string;
  at: Pos;
  sneaking: boolean;
  quiet: boolean;
}

/** V4.0 (spec 27): what a monster's eyes depend on (the monster itself, or the move preview's copy of it). */
export interface Look {
  at: Pos;
  facing?: number;
  mood: Mood;
  noticed: string[];
}

/**
 * The figures monsters look for, as they stand now (spec 27): active, unveiled heroes, then (V4.0, spec 28.2, pillar 17)
 * the crew members on the map, unveiled, hired or not: their last move mode, a crew Burglar's quiet feet.
 */
export function sightedHeroes(c: Ctx): Sighted[] {
  const out: Sighted[] = c.d.heroes.filter((h) => h.status === 'active' && h.veil <= 0).map((h) => ({ id: h.heroId, at: h.at, sneaking: isSneaking(h), quiet: quietFeet(c, h.heroId) }));
  for (const r of rivalsOnMap(c)) if ((r.veil ?? 0) <= 0) out.push({ id: r.id, at: r.at, sneaking: isSneaking(r), quiet: r.cls === 'burglar' });
  return out;
}

/**
 * V4.0 (spec 27): a monster looks round. Every hero it hasn't noticed whom the noticing rule lets it see (its mood
 * and facing, the hero's light and move mode) is noticed at once. If it wasn't hunting it turns to the first of
 * them (`first` when among them, else the nearest, ties in party order) and hunts; then it looks again with its
 * new facing and hunting sight, and again, until nobody new: one careless hero blows the cover of friends near them.
 * Updates `look`; returns who it noticed in order (the one it turned to first) and whom it turned to.
 * Deterministic: no rolls.
 */
export function lookRound(c: Ctx, look: Look, heroes: Sighted[], lit: Set<string>, first?: string): { ids: string[]; turnedTo?: string } {
  const ids: string[] = [];
  let turnedTo: string | undefined;
  for (;;) {
    const eye = { at: look.at, facing: look.facing };
    const now = heroes.filter((x) => !look.noticed.includes(x.id) && wouldNotice(c, eye, x.at, x.sneaking, lit, x.quiet, look.mood));
    if (!now.length) break;
    now.sort((a, b) => Number(b.id === first) - Number(a.id === first) || distance(a.at, look.at) - distance(b.at, look.at) || heroes.indexOf(a) - heroes.indexOf(b));
    if (look.mood !== 'hunting') {
      const q = now[0]!;
      turnedTo = q.id;
      if (!samePos(q.at, look.at) && q.at.level === look.at.level) look.facing = dirIndex(look.at, q.at);
      look.mood = 'hunting';
    }
    for (const x of now) {
      look.noticed.push(x.id);
      ids.push(x.id);
    }
  }
  return { ids, turnedTo };
}

/** Who a monster can make out now: heroes it has noticed by plain sight (16.1), others by the noticing rule (20.1); the prisoner by sight. */
export function perceivable(c: Ctx, m: MonsterX, t: Target, lit: Set<string>, sees: (from: Pos, to: Pos, lit: Set<string>) => boolean): boolean {
  // V4.0 (spec 28.2): a crew member as a hero: tracked by plain sight once noticed, else the noticing rule (its move mode, a Burglar's feet).
  if (t.rival) {
    if ((m.noticedIds ?? []).includes(t.id)) return sees(m.at, t.at, lit);
    return wouldNotice(c, m, t.at, isSneaking(t.rival), lit, t.rival.cls === 'burglar');
  }
  if (!t.hero) return sees(m.at, t.at, lit);
  if ((m.noticedIds ?? []).includes(t.id)) return sees(m.at, t.at, lit);
  return wouldNotice(c, m, t.at, isSneaking(t.hero), lit, quietFeet(c, t.id));
}

/**
 * A monster or crew member takes note of a hero: remembered for sneak attacks and swings, one `noticed`
 * event (with the hero's hex). V4.0 (spec 26.3): an unaware watcher turns to face them; a hunting monster
 * notices without turning (it turns on its own turn, toward what it strikes or steps to, and when hit).
 * `turn` overrides that (spec 27: a monster noticing several heroes at once turns to one of them only).
 */
export function noticeHero(c: Ctx, m: MonsterX | RivalX, heroId: string, turn = (m as MonsterX).awareness !== 'hunting'): void {
  const h = hd(c, heroId);
  if (!h) return;
  const ids = ((m as MonsterX).noticedIds ??= []);
  if (turn) faceToward(m, h.at);
  if (ids.includes(heroId)) return;
  ids.push(heroId);
  c.ev.push({ type: 'noticed', by: m.id, hero: heroId, at: { ...h.at }, faced: turn });
}

/**
 * V4.0 (spec 28.2, pillar 17): a monster takes note of a hero or a crew member (`noticeHero` for a hero). A crew
 * member is remembered the same way (`noticedIds`); its `noticed` event goes out only when the party sees the
 * monster or the member (what the party can't see stays unknown).
 */
export function noticeFigure(c: Ctx, m: MonsterX, id: string, turn = m.awareness !== 'hunting'): void {
  if (hd(c, id)) return noticeHero(c, m, id, turn);
  const r = rivalsOnMap(c).find((x) => x.id === id);
  if (!r) return;
  const ids = (m.noticedIds ??= []);
  if (turn) faceToward(m, r.at);
  if (ids.includes(id)) return;
  ids.push(id);
  if (partySees(c, m.at) || partySees(c, r.at)) c.ev.push({ type: 'noticed', by: m.id, hero: id, at: { ...r.at }, faced: turn });
}

export function forgetHeroes(m: MonsterX): void {
  m.noticedIds = undefined;
}

export function hasNoticed(m: MonsterX, heroId: string): boolean {
  return (m.noticedIds ?? []).includes(heroId);
}

// ---------------------------------------------------------------- wake rolls

/** Sleepers a passing hero rolls against: asleep, on the map, not the Dragon (its own rule) or the Gloam. */
export function sleepersNear(c: Ctx, p: Pos): MonsterX[] {
  return c.d.monsters.filter((m) => m.awareness === 'asleep' && !m.buried && m.kind !== 'dragon' && m.kind !== 'gloam' && m.at.level === p.level && distance(m.at, p) <= WAKE_RANGE);
}

/** Walking noise at a hex: 1, 2 on rubble; sneaking is silent. */
export function stepNoise(c: Ctx, p: Pos, sneak: boolean): number {
  if (sneak) return 0;
  return kindAt(c.w, c.d, p) === 'rubble' ? RUBBLE_STEP_NOISE : STEP_NOISE;
}

/**
 * The chance (0..100) that sleeper `m` wakes as a hero stands on `p` of their path (spec 20.1):
 * walking 50, sneaking 10, halved on an unlit hex; at the end of the move next to it: walking
 * sure, sneaking 25 (a Burglar: 5 and 10, spec 24.3). Walking noise that reaches it wakes it for sure.
 * V3.9 (spec 24.1): these are sound rolls; sleepers never notice anyone by sight.
 */
export function wakeChance(m: MonsterX, p: Pos, last: boolean, sneak: boolean, lit: Set<string>, heard?: Map<string, number>, quiet = false): number {
  const adj = distance(m.at, p) === 1;
  if (!sneak && heard?.has(posKey(m.at))) return 100;
  // V3.9 (spec 24.3): a sneaking Burglar's quiet feet: 5% per hex, 10% ending adjacent.
  if (last && adj) return sneak ? (quiet ? WAKE_END_SNEAK_QUIET : WAKE_END_SNEAK) : 100;
  const base = sneak ? (quiet ? WAKE_SNEAK_QUIET : WAKE_SNEAK) : WAKE_WALK;
  return lit.has(posKey(p)) ? base : base / 2;
}

/** Roll the wake checks for a hero standing on `p` (one hex of their move). Woken sleepers go alert at the hero's hex. */
export function wakeRolls(c: Ctx, h: HeroInDelve, p: Pos, last: boolean, sneak: boolean, lit: Set<string>): void {
  const quiet = quietFeet(c, h.heroId);
  for (const m of sleepersNear(c, p)) {
    const pct = wakeChance(m, p, last, sneak, lit, undefined, quiet);
    if (pct <= 0 || !chance(c.s, pct)) continue;
    goAlert(c, m, p);
    c.ev.push({ type: 'woke', id: m.id, by: h.heroId });
    say(c, `${m.name} ${m.kind === 'rats' ? 'stir' : 'stirs'} as ${heroName(c, h.heroId)} passes.`);
  }
}

// ---------------------------------------------------------------- free swings (spec 20.2)

/** Could this monster take a free swing at a hero right now? Hunting and aware of them, free to move, not the Dragon or the Gloam. */
export function monsterCanSwing(m: MonsterX, heroId: string): boolean {
  if (m.buried || m.awareness !== 'hunting') return false;
  if (m.kind === 'dragon' || m.kind === 'gloam') return false;
  if ((m.stuck ?? 0) > 0 || m.holding || (m.feared ?? 0) > 0) return false;
  return hasNoticed(m, heroId);
}

export function rivalCanSwing(c: Ctx, r: RivalX): boolean {
  if (c.d.rivals?.stance !== 'hostile') return false;
  if (r.goneOut || r.hp <= 0 || (r.feared ?? 0) > 0) return false;
  return true;
}

export interface Swinger {
  id: string;
  at: Pos;
  slots: number;
  chance: number;
  dmg: number;
  name: string;
}

/**
 * V4.1 (spec 31.11, owner): a step provokes the enemy whose reach it starts in. Moving at all from a hex next to an
 * engaged enemy (out of its reach, round it, past it) gives it a free swing; stepping next to it from outside doesn't.
 */
export function stepProvokes(enemyAt: Pos, from: Pos): boolean {
  return enemyAt.level === from.level && distance(enemyAt, from) === 1;
}

/** Enemies that get a free swing at `heroId` stepping from `from` (to `to`): every engaged one next to `from` (spec 31.11). */
export function swingersFor(c: Ctx, heroId: string, from: Pos, _to: Pos): Swinger[] {
  const leaves = (at: Pos) => stepProvokes(at, from);
  const out: Swinger[] = [];
  for (const m of c.d.monsters) {
    if (!leaves(m.at) || !monsterCanSwing(m, heroId)) continue;
    const st = monsterStats(m);
    out.push({ id: m.id, at: m.at, slots: Math.max(1, st.slots - SWING_SLOT_PENALTY), chance: st.chance, dmg: st.dmg, name: m.name });
  }
  for (const r of rivalsOnMap(c)) {
    if (!leaves(r.at) || !rivalCanSwing(c, r)) continue;
    const st = rivalStats(r);
    out.push({ id: r.id, at: r.at, slots: Math.max(1, st.slots - SWING_SLOT_PENALTY), chance: st.chance, dmg: st.dmg, name: r.name });
  }
  return out;
}

/** The swing itself: the enemy's attack with one slot fewer, no Focus, armor as usual. */
export function enemySwing(c: Ctx, sw: Swinger, heroId: string): void {
  const m = c.d.monsters.find((x) => x.id === sw.id);
  if (m) faceToward(m, hd(c, heroId)?.at ?? m.at);
  say(c, `${sw.name} gets a free swing at ${heroName(c, heroId)}.`);
  // V4.1 (WS6, spec 31.8): a crew Ranger's bow swing looses an arrow too (plain first).
  const rv = m ? undefined : rivalsOnMap(c).find((x) => x.id === sw.id);
  if (rv && rivalStats(rv).range > 1) spendCrewArrow(rv);
  const r = strikeDetailed(c, sw.id, heroId, sw.slots, sw.chance, sw.dmg, 'Free swing');
  c.ev.push({ type: 'swing', by: sw.id, target: r.hit ?? heroId, hits: r.hits, damage: r.damage });
}

/** A hero steps from `from` to `to`: every engaged enemy next to `from` swings once (per enemy per move; `done` carries across the move's steps). */
export function provokeSwings(c: Ctx, h: HeroInDelve, from: Pos, to: Pos, done: Set<string>): void {
  for (const sw of swingersFor(c, h.heroId, from, to)) {
    if (done.has(sw.id) || h.status !== 'active') continue;
    done.add(sw.id);
    enemySwing(c, sw, h.heroId);
  }
}

/** Monsters (not the Gloam) and hostile crew members: what a hero swings at when it walks away. */
function heroSwingTarget(c: Ctx, id: string): { at: Pos; armor: number; name: string } | null {
  const m = c.d.monsters.find((x) => x.id === id);
  if (m) return m.kind === 'gloam' || m.buried ? null : { at: m.at, armor: monsterArmor(c, m), name: m.name };
  const r = rivalsOnMap(c).find((x) => x.id === id);
  if (r && c.d.rivals?.stance === 'hostile') return { at: r.at, armor: rivalStats(r).armor, name: r.name };
  return null;
}

/**
 * V4.1 (spec 31.13): is hero `h` hidden from enemy `id`: veiled, or not noticed by it (a monster's `noticedIds`; a crew
 * member's own `noticedIds`). A hidden hero's free swing is the player's call (`HeroInDelve.ambush`).
 */
export function hiddenFrom(c: Ctx, h: HeroInDelve, id: string): boolean {
  if ((h.veil ?? 0) > 0) return true;
  const m = c.d.monsters.find((x) => x.id === id);
  if (m) return m.awareness === 'asleep' || !hasNoticed(m as MonsterX, h.heroId);
  const r = c.d.rivals?.members.find((x) => x.id === id);
  if (r) return !(r.noticedIds ?? []).includes(h.heroId);
  return false;
}

/** Can this hero swing now: active, free to act, action still ready. */
export function heroCanSwing(h: HeroInDelve): boolean {
  return h.status === 'active' && !h.acted && !h.webbed && !h.grabbedBy && !(h as HeroX).dozing && !h.dreaded; // V4.1 (WS7): Dread
}

/**
 * An enemy `id` steps from `from` to `to` (spec 20.2): every active hero next to `from` (V4.1 spec 31.11: whether the
 * step leaves them or not) whose action is still ready swings with their weapon at one slot fewer (a bow at 1), once
 * per move (`done`: the heroes who already swung on this move). The action is not spent. Returns true when the enemy
 * died of it.
 */
export function heroSwings(c: Ctx, id: string, from: Pos, to: Pos, done: Set<string> = new Set()): boolean {
  const t = heroSwingTarget(c, id);
  if (!t) return false;
  for (const h of c.d.heroes) {
    if (!heroCanSwing(h) || done.has(h.heroId)) continue;
    if (!stepProvokes(h.at, from)) continue;
    // V4.1 (spec 31.13, owner): a hero hidden from this enemy holds unless set to strike from hiding.
    if (hiddenFrom(c, h, id) && !h.ambush) continue;
    done.add(h.heroId);
    const def = heroDef(c, h.heroId)!;
    // V4.1 (WS6, spec 31.8): a bow swing looses an arrow (plain first, else a specialty one, its effect too); out of arrows, the knife.
    const weapon = weaponNow(def.cls, h.pack);
    const loosed = weapon.range ? spendArrow(h.pack, attackArrow(h.pack)?.id) : null;
    const knife = weapon !== CLASSES[def.cls].weapon;
    // V3.7 (spec 20.5): a braced hero swings at full slots.
    const slots = weapon.range ? SWING_BOW_SLOTS : h.braced ? weapon.slots : Math.max(1, weapon.slots - SWING_SLOT_PENALTY);
    const p = def.stats[weapon.stat] + (knife ? 0 : 10 * def.weaponTier) + lightPenaltyFor(c.w, c, h);
    say(c, `${heroName(c, h.heroId)} ${loosed ? 'looses an arrow' : 'swings'} at ${t.name} as it goes.`);
    const r = roll(c, h.heroId, 'Free swing', slots, p);
    const dmg = r.hits ? r.hits * Math.max(1, weapon.dmg - t.armor) + (r.perfect ? 1 : 0) + (loosed === 'firearrows' ? FIRE_ARROW_DMG : 0) : 0;
    c.ev.push({ type: 'swing', by: h.heroId, target: id, hits: r.hits, damage: dmg });
    if (!r.hits) c.ev.push({ type: 'miss', attacker: h.heroId, target: id });
    else {
      hurtAny(c, id, dmg, h.heroId, { crit: r.perfect });
      turnOnHit(c, id, h.heroId); // V4.0 (spec 26.3)
    }
    if (loosed && loosed !== 'quiver' && loosed !== 'arrows') arrowLands(c, loosed, h.heroId, figureAt(c.d as DelveX, id) ?? to, id, r.hits > 0);
    if (!figure(c, id)) return true;
  }
  return false;
}

// ---------------------------------------------------------------- dread (spec 20.2)

/** What a feared figure runs from: its caster while they stand on its level, else the nearest active hero there. */
export function threatFor(c: Ctx, self: { at: Pos; fearOf?: string }): Pos | null {
  const caster = self.fearOf ? hd(c, self.fearOf) : undefined;
  if (caster && caster.status === 'active' && caster.at.level === self.at.level) return caster.at;
  const near = activeHeroes(c).filter((h) => h.at.level === self.at.level).sort((a, b) => distance(a.at, self.at) - distance(b.at, self.at))[0];
  return near ? near.at : null;
}

/** The flee plan: the reachable free hex farthest from the threat (shortest walk among equals); stays put when nothing is farther. */
export function fleePlan(c: Ctx, self: { id: string; at: Pos; fearOf?: string }, move: number): { to: Pos; path: Pos[] } {
  const threat = threatFor(c, self);
  if (!threat || move <= 0) return { to: self.at, path: [] };
  const nodes = dijkstra(c.w, c.d, self.at, { enter: (p) => !blocked(c, p, self.id), stairs: false, budget: move });
  let best = self.at;
  let bestD = distance(self.at, threat);
  let bestCost = 0;
  for (const n of nodes.values()) {
    if (!samePos(n.p, self.at) && occupant(c, n.p)) continue;
    const dd = distance(n.p, threat);
    if (dd > bestD || (dd === bestD && n.cost < bestCost)) {
      bestD = dd;
      bestCost = n.cost;
      best = n.p;
    }
  }
  return { to: best, path: samePos(best, self.at) ? [] : pathTo(nodes, best) };
}

// ---------------------------------------------------------------- the move preview

/** V4.0 (spec 27): the move preview's copy of a monster the party has seen: its eyes, mood and what noise does to it. */
interface Shadow extends Look {
  m: MonsterX;
  /** On patrol (noise sends a patroller searching, as a sleeper). */
  patrol: boolean;
  shouted: boolean;
}

/** What a noise at `at` does to a monster's eyes (as makeNoise): an unaware or searching one turns to it and searches (a woken berserker hunts). */
function shadowHears(sh: Shadow, at: Pos): void {
  if (sh.mood === 'hunting') return;
  if (!samePos(at, sh.at) && at.level === sh.at.level) sh.facing = dirIndex(sh.at, at);
  sh.mood = sh.m.kind === 'berserker' && (sh.mood === 'asleep' || sh.patrol) ? 'hunting' : 'searching';
  sh.patrol = false;
}

/**
 * What a move along `path` risks (spec 20.1, 20.2, 24.4, 26.2, 27): every wake roll on the way with its chance,
 * the awake enemies that would notice a hero on the way, and the free swings the move provokes (spec 31.11: any step
 * from a hex next to an engaged enemy, once per enemy), with their damage
 * range. V4.0 (spec 27): the preview plays the move through the eyes of every monster the party has seen
 * (`seen`): at each hex the mover steps on, every awake one looks at every active hero (the mover there, the
 * others where they stand, the light as it is then: a lantern carried along lights friends), noticing as the
 * move does, cascade included (one that notices turns, hunts and looks again). What can be known follows too:
 * doors opened on the way, a swing turning its swinger, the orc's bellow and walking noise turning heads and
 * sending monsters searching, sleepers woken for sure. Dice can't be previewed: a sleeper that may wake is
 * assumed asleep, a hero who may be downed by a swing walks on. `notice` lists, in order, each (watcher, hero)
 * for watchers visible now (`vis`), `at` the mover's hex when it happens. A waiting crew checks the mover
 * within CUTTHROAT_SIGHT as before. V3.9: wake rolls and swings only for seen enemies.
 */
export function moveRisks(c: Ctx, h: HeroInDelve, path: Pos[], sneak: boolean, lit: Set<string>, seen: Set<string>, vis: Set<string>): MoveRisks {
  const risks: MoveRisks = { wake: [], notice: [], swings: [] };
  if (!path.length) return risks;
  const armor = armorOf(heroDef(c, h.heroId)!) + wardOf(h);
  const quiet = quietFeet(c, h.heroId);
  const swung = new Set<string>();
  const crewNoticing = new Set<string>();
  const shadows: Shadow[] = [];
  for (const m of c.d.monsters) {
    if (m.buried || m.kind === 'gloam' || m.kind === 'dragon' || !seen.has(m.id)) continue;
    shadows.push({ m, at: m.at, facing: m.facing, mood: moodOf(m), noticed: [...(m.noticedIds ?? [])], patrol: m.awareness === 'patrol', shouted: !!m.shouted });
  }
  // The mover's own light moves with them; doors open as the path passes.
  const emits = emitsLight(h); // V4.1 (WS2): a lit torch, an open lantern, Glowworm
  let doors = c.d.doors;
  let cc: Ctx = c;
  const others = sightedHeroes(c).filter((x) => x.id !== h.heroId);
  let from = h.at;
  let facing = h.facing;
  path.forEach((p, i) => {
    const last = i === path.length - 1;
    // Free swings first, as the step starts in their reach (spec 31.11: out of it, round it or past it): a monster that has
    // noticed the mover (perhaps earlier on this path) and hunts.
    for (const sh of shadows) {
      const m = sh.m;
      if (swung.has(m.id) || sh.mood !== 'hunting' || !sh.noticed.includes(h.heroId)) continue;
      if ((m.stuck ?? 0) > 0 || m.holding || (m.feared ?? 0) > 0) continue;
      if (!stepProvokes(m.at, from)) continue;
      swung.add(m.id);
      const st = monsterStats(m);
      const slots = Math.max(1, st.slots - SWING_SLOT_PENALTY);
      // V3.9 (spec 24.2): a swing from the hero's blind cone (as they stand before the step) is blindsided.
      const extra = inRearHalf({ at: from, facing, cone: true }, m.at) ? BLINDSIDE_SLOTS : 0;
      risks.swings.push({ id: m.id, damage: hitRange(slots + extra, st.dmg, armor) });
      if (!samePos(from, sh.at) && from.level === sh.at.level) sh.facing = dirIndex(sh.at, from); // it turns to swing
    }
    for (const sw of swingersFor(c, h.heroId, from, p)) {
      if (swung.has(sw.id) || !seen.has(sw.id) || c.d.monsters.some((m) => m.id === sw.id)) continue;
      swung.add(sw.id);
      const extra = inRearHalf({ at: from, facing, cone: true }, sw.at) ? BLINDSIDE_SLOTS : 0;
      risks.swings.push({ id: sw.id, damage: hitRange(sw.slots + extra, sw.dmg, armor) });
    }
    if (p.level === from.level) facing = dirIndex(from, p);
    from = p;
    const door = kindAt(c.w, c.d, p) === 'door' ? doors[posKey(p)] : undefined;
    if (door && !door.open) {
      doors = { ...doors, [posKey(p)]: { ...door, open: true } };
      cc = { ...c, d: { ...c.d, doors } };
    }
    const litNow = emits || cc !== c ? litSet(c.w, { ...cc.d, heroes: c.d.heroes.map((x) => (x === h ? { ...x, at: p } : x)) }) : lit;
    // Every awake monster looks at every hero, all at once; then what they do about it (an orc's bellow).
    const heroes = h.veil > 0 ? others : [{ id: h.heroId, at: p, sneaking: sneak, quiet }, ...others];
    const bellows: Shadow[] = [];
    for (const sh of shadows) {
      if (sh.mood === 'asleep') continue;
      const hs = heroes.filter((x) => x.at.level === sh.at.level);
      if (!hs.length) continue;
      const r = lookRound(cc, sh, hs, litNow, h.heroId);
      if (!r.ids.length) continue;
      if (vis.has(posKey(sh.at))) for (const id of r.ids) risks.notice.push({ id: sh.m.id, at: { ...p }, hero: id });
      if (sh.m.kind === 'orc' && !sh.shouted) bellows.push(sh);
    }
    for (const sh of bellows) {
      sh.shouted = true;
      const heard = noiseField(c.w, cc.d, sh.at, BELLOW_NOISE);
      for (const o of shadows) if (o.at.level === sh.at.level && heard.has(posKey(o.at))) shadowHears(o, sh.at);
    }
    // A waiting crew checks the mover (spec 26.2), within CUTTHROAT_SIGHT.
    for (const wt of crewWatchers(c, p.level)) {
      if (crewNoticing.has(wt.id) || wt.noticed(h.heroId) || !vis.has(posKey(wt.f.at)) || h.veil > 0) continue;
      if (distance(wt.f.at, p) > CUTTHROAT_SIGHT) continue;
      if (!wouldNotice(cc, wt.f, p, sneak, litNow, quiet)) continue;
      crewNoticing.add(wt.id);
      risks.notice.push({ id: wt.id, at: { ...p }, hero: h.heroId });
    }
    // The step's noise, then the wake rolls (as the move: after the look). A sleeper the noise reaches wakes for sure (100).
    const noise = stepNoise(c, p, sneak);
    const heard = noise ? noiseField(c.w, cc.d, p, noise) : undefined;
    const woken: Shadow[] = [];
    for (const m of sleepersNear(c, p)) {
      const sh = shadows.find((x) => x.m === m);
      if (!sh || sh.mood !== 'asleep') continue;
      const pct = wakeChance(m, p, last, sneak, lit, heard, quiet);
      if (pct > 0) risks.wake.push({ at: { ...p }, id: m.id, chance: Math.round(pct) });
      if (pct >= 100) woken.push(sh);
    }
    if (heard) for (const sh of shadows) if (sh.at.level === p.level && heard.has(posKey(sh.at))) shadowHears(sh, p);
    for (const sh of woken) if (sh.mood === 'asleep') shadowHears(sh, p);
  });
  return risks;
}

/** Waiting or hostile crews watching for a hero (a hostile crew has noticed everyone already). */
function crewWatchers(c: Ctx, level: number): { id: string; f: Facer; noticed: (heroId: string) => boolean }[] {
  const out: { id: string; f: Facer; noticed: (heroId: string) => boolean }[] = [];
  const cr = c.d.rivals;
  if (cr && (cr.stance === 'waiting' || cr.stance === 'hostile')) {
    for (const r of rivalsOnMap(c)) if (r.at.level === level) out.push({ id: r.id, f: r, noticed: () => cr.stance === 'hostile' });
  }
  return out;
}

/** Hexes in a watcher's blind arc within `radius` (for tests and tools). */
export function blindArcHexes(f: Facer, radius: number): Pos[] {
  const out: Pos[] = [];
  const seen = new Set<string>();
  const ring = [f.at];
  for (let r = 0; r < radius; r++) {
    for (const p of ring.splice(0)) {
      for (const n of posNeighbors(p)) {
        const k = posKey(n);
        if (seen.has(k) || samePos(n, f.at)) continue;
        seen.add(k);
        ring.push(n);
        if (inBlindArc(f, n)) out.push(n);
      }
    }
  }
  return out;
}

/**
 * V4.0 HUD (spec 27, read-only): the floor a watcher (monster or crew member) would see a hero on right now, for the
 * hover shading. Hexes within notice range on its level where a hero moving as given (`sneaking`, `quiet` for a
 * Burglar's feet) would be noticed: `front` where it looks properly (ahead; the sides too once searching or hunting,
 * or for a crew member), `side` the corner of an unaware monster's eye. Straight behind is never shaded.
 */
export function sightWash(c: Ctx, watcherId: string, sneaking = false, quiet = false): { front: Pos[]; side: Pos[] } {
  const front: Pos[] = [];
  const side: Pos[] = [];
  const m = c.d.monsters.find((x) => x.id === watcherId && x.hp > 0 && !x.buried);
  const r = m ? undefined : rivalsOnMap(c).find((x) => x.id === watcherId);
  const f = m ?? r;
  if (!f) return { front, side };
  const mood: Mood = m ? moodOf(m) : 'unaware';
  if (mood === 'asleep') return { front, side };
  const lit = litSet(c.w, c.d);
  for (const hh of range(f.at, NOTICE.litWalk)) {
    const p = { level: f.at.level, ...hh };
    if (samePos(p, f.at) || !c.w.tile(p) || !isFloorish(c.w, c.d, p)) continue;
    let b = bearingOf(f, p);
    if (b === 'side' && blindCone(f)) b = 'front';
    if (b === 'back') continue;
    if (!wouldNotice(c, f, p, sneaking, lit, quiet, mood)) continue;
    (b === 'side' && mood === 'unaware' ? side : front).push(p);
  }
  return { front, side };
}
