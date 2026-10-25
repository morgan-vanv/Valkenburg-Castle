// V3.7 (spec 20.1, 20.2): stealth and free swings. Facing and the blind arc, who notices
// whom, the wake rolls a passing hero provokes, attacks of opportunity both ways, and the
// move preview's risks. Pure rules: no DOM, all dice through the seeded RNG.

import { DIRS, distance, hexToWorld, posKey, posNeighbors, samePos, type Hex, type Pos } from './hex';
import type { HeroInDelve } from './types';
import type { MoveRisks } from './api';
import {
  CLASSES, NOTICE, RUBBLE_STEP_NOISE, STEP_NOISE, SWING_BOW_SLOTS, SWING_SLOT_PENALTY, WAKE_END_SNEAK, WAKE_RANGE, WAKE_SNEAK, WAKE_WALK,
} from './data';
import { chance } from './rng';
import { say, type Ctx, type HeroX, type MonsterX, type RivalX } from './state';
import { activeHeroes, armorOf, goAlert, hd, heroDef, heroName, hurtAny, lightPenaltyFor, monsterArmor, monsterStats, occupant, rivalsOnMap, roll } from './common';
import { dijkstra, kindAt, los, noiseField, pathTo, smoky } from './world';
import { blocked, hitRange, strikeDetailed, wardOf, type Target } from './ai';
import { figure } from './falls';
import { rivalStats } from './rivals';

// ---------------------------------------------------------------- facing

/**
 * Anything on the map that looks somewhere: monsters and crew members. `facing` undefined means it
 * watches all round (a crew at its post, a monster from an older save): no blind arc until it moves,
 * hears or strikes. Spawned monsters start with the map's facing (default 0, east).
 */
export interface Facer {
  at: Pos;
  facing?: number;
}

/** The DIRS index nearest to the direction from `from` to `to` (exact for neighbours; ties go to the lower index). */
export function dirIndex(from: Hex, to: Hex): number {
  const A = hexToWorld(from);
  const B = hexToWorld(to);
  const vx = B.x - A.x;
  const vz = B.z - A.z;
  let best = 0;
  let bestDot = -Infinity;
  DIRS.forEach((d, i) => {
    const D = hexToWorld(d);
    const dot = D.x * vx + D.z * vz;
    if (dot > bestDot + 1e-9) {
      bestDot = dot;
      best = i;
    }
  });
  return best;
}

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

/** The three directions behind it: the back direction and its two neighbours, at any distance (spec 20.1). */
export function inBlindArc(f: Facer, p: Pos): boolean {
  if (f.facing === undefined || p.level !== f.at.level || samePos(p, f.at)) return false;
  const back = (f.facing + 3) % 6;
  const i = dirIndex(f.at, p);
  return i === back || i === (back + 1) % 6 || i === (back + 5) % 6;
}

export function directlyBehind(f: Facer, p: Pos): boolean {
  return f.facing !== undefined && samePos(behindHex(f), p);
}

// ---------------------------------------------------------------- noticing

/** The hero's move mode for noticing: the last move was a sneak (a hero who never moved counts as walking). */
export function isSneaking(h: HeroInDelve): boolean {
  return (h as HeroX).sneaked === true;
}

/**
 * Would an awake watcher at `f` notice a hero standing at `heroAt` (spec 20.1)? Line of sight
 * (smoke hides beyond 1), then the range by light and move mode: lit 6/4, unlit 3/1, in the
 * Hollow 6/3 whatever the light. In the blind arc a walking hero is noticed at half range;
 * a sneaking hero only when adjacent, and never from the hex directly behind.
 */
export function wouldNotice(c: Ctx, f: Facer, heroAt: Pos, sneaking: boolean, lit: Set<string>): boolean {
  if (f.at.level !== heroAt.level || samePos(f.at, heroAt)) return false;
  const dist = distance(f.at, heroAt);
  const hollow = heroAt.level === 3;
  const isLit = lit.has(posKey(heroAt));
  let range: number = hollow ? (sneaking ? NOTICE.hollowSneak : NOTICE.hollowWalk) : isLit ? (sneaking ? NOTICE.litSneak : NOTICE.litWalk) : sneaking ? NOTICE.unlitSneak : NOTICE.unlitWalk;
  if (inBlindArc(f, heroAt)) {
    if (sneaking) {
      if (dist > 1 || directlyBehind(f, heroAt)) return false;
    } else range = Math.max(1, Math.floor(range / 2));
  }
  if (dist > range) return false;
  if (dist > 1 && (smoky(c.d, heroAt) || smoky(c.d, f.at))) return false;
  return los(c.w, c.d, f.at, heroAt);
}

/** Who a monster can make out now: heroes it has noticed by plain sight (16.1), others by the noticing rule (20.1); the prisoner by sight. */
export function perceivable(c: Ctx, m: MonsterX, t: Target, lit: Set<string>, sees: (from: Pos, to: Pos, lit: Set<string>) => boolean): boolean {
  if (!t.hero) return sees(m.at, t.at, lit);
  if ((m.noticedIds ?? []).includes(t.id)) return sees(m.at, t.at, lit);
  return wouldNotice(c, m, t.at, isSneaking(t.hero), lit);
}

/** A monster or crew member takes note of a hero: remembered for sneak attacks and swings, faces them, one `noticed` event. */
export function noticeHero(c: Ctx, m: MonsterX | RivalX, heroId: string): void {
  const h = hd(c, heroId);
  if (!h) return;
  const ids = ((m as MonsterX).noticedIds ??= []);
  faceToward(m, h.at);
  if (ids.includes(heroId)) return;
  ids.push(heroId);
  c.ev.push({ type: 'noticed', by: m.id, hero: heroId });
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
 * sure, sneaking 25. Walking noise that reaches it wakes it for sure.
 */
export function wakeChance(m: MonsterX, p: Pos, last: boolean, sneak: boolean, lit: Set<string>, heard?: Map<string, number>): number {
  const adj = distance(m.at, p) === 1;
  if (!sneak && heard?.has(posKey(m.at))) return 100;
  if (last && adj) return sneak ? WAKE_END_SNEAK : 100;
  const base = sneak ? WAKE_SNEAK : WAKE_WALK;
  return lit.has(posKey(p)) ? base : base / 2;
}

/** Roll the wake checks for a hero standing on `p` (one hex of their move). Woken sleepers go alert at the hero's hex. */
export function wakeRolls(c: Ctx, h: HeroInDelve, p: Pos, last: boolean, sneak: boolean, lit: Set<string>): void {
  for (const m of sleepersNear(c, p)) {
    const pct = wakeChance(m, p, last, sneak, lit);
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

/** Enemies that get a free swing at `heroId` stepping from `from` to `to`: adjacent to from, not to to. */
export function swingersFor(c: Ctx, heroId: string, from: Pos, to: Pos): Swinger[] {
  const leaves = (at: Pos) => at.level === from.level && distance(at, from) === 1 && !(at.level === to.level && distance(at, to) <= 1);
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
  const r = strikeDetailed(c, sw.id, heroId, sw.slots, sw.chance, sw.dmg, 'Free swing');
  c.ev.push({ type: 'swing', by: sw.id, target: r.hit ?? heroId, hits: r.hits, damage: r.damage });
}

/** A hero steps from `from` to `to`: every enemy left behind swings once (per enemy per move; `done` carries across the move's steps). */
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

/** Can this hero swing now: active, free to act, action still ready. */
export function heroCanSwing(h: HeroInDelve): boolean {
  return h.status === 'active' && !h.acted && !h.webbed && !h.grabbedBy && !(h as HeroX).dozing;
}

/**
 * An enemy `id` steps from `from` to `to` (spec 20.2): every active hero it leaves (adjacent before,
 * not after) whose action is still ready swings with their weapon at one slot fewer (a bow at 1).
 * The action is not spent. Returns true when the enemy died of it.
 */
export function heroSwings(c: Ctx, id: string, from: Pos, to: Pos): boolean {
  const t = heroSwingTarget(c, id);
  if (!t) return false;
  for (const h of c.d.heroes) {
    if (!heroCanSwing(h)) continue;
    if (!(h.at.level === from.level && distance(h.at, from) === 1)) continue;
    if (h.at.level === to.level && distance(h.at, to) <= 1) continue;
    const def = heroDef(c, h.heroId)!;
    const cls = CLASSES[def.cls];
    const slots = cls.weapon.range ? SWING_BOW_SLOTS : Math.max(1, cls.weapon.slots - SWING_SLOT_PENALTY);
    const p = def.stats[cls.weapon.stat] + 10 * def.weaponTier + lightPenaltyFor(c.w, c, h);
    say(c, `${heroName(c, h.heroId)} swings at ${t.name} as it goes.`);
    const r = roll(c, h.heroId, 'Free swing', slots, p);
    const dmg = r.hits ? r.hits * Math.max(1, cls.weapon.dmg - t.armor) + (r.perfect ? 1 : 0) : 0;
    c.ev.push({ type: 'swing', by: h.heroId, target: id, hits: r.hits, damage: dmg });
    if (!r.hits) c.ev.push({ type: 'miss', attacker: h.heroId, target: id });
    else hurtAny(c, id, dmg, h.heroId, { crit: r.perfect });
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

/** Awake watchers that could notice a hero: alert, hunting and patrolling monsters, and a waiting or hostile crew. */
function watchers(c: Ctx, level: number): { id: string; f: Facer; noticed: (heroId: string) => boolean }[] {
  const out: { id: string; f: Facer; noticed: (heroId: string) => boolean }[] = [];
  for (const m of c.d.monsters) {
    if (m.buried || m.awareness === 'asleep' || m.kind === 'gloam' || m.kind === 'dragon' || m.at.level !== level) continue;
    out.push({ id: m.id, f: m, noticed: (id) => hasNoticed(m, id) });
  }
  const cr = c.d.rivals;
  if (cr && (cr.stance === 'waiting' || cr.stance === 'hostile')) {
    for (const r of rivalsOnMap(c)) if (r.at.level === level) out.push({ id: r.id, f: r, noticed: () => cr.stance === 'hostile' });
  }
  return out;
}

/**
 * What a move along `path` risks (spec 20.1, 20.2): every wake roll on the way with its chance,
 * the awake enemies that would notice the hero at the destination (those that haven't yet),
 * and the free swings leaving provokes, with their damage range.
 */
export function moveRisks(c: Ctx, h: HeroInDelve, path: Pos[], sneak: boolean, lit: Set<string>): MoveRisks {
  const risks: MoveRisks = { wake: [], notice: [], swings: [] };
  if (!path.length) return risks;
  const armor = armorOf(heroDef(c, h.heroId)!) + wardOf(h);
  const swung = new Set<string>();
  let from = h.at;
  path.forEach((p, i) => {
    const last = i === path.length - 1;
    const noise = stepNoise(c, p, sneak);
    const heard = noise ? noiseField(c.w, c.d, p, noise) : undefined;
    for (const m of sleepersNear(c, p)) {
      const pct = wakeChance(m, p, last, sneak, lit, heard);
      if (pct > 0) risks.wake.push({ at: { ...p }, id: m.id, chance: Math.round(pct) });
    }
    for (const sw of swingersFor(c, h.heroId, from, p)) {
      if (swung.has(sw.id)) continue;
      swung.add(sw.id);
      risks.swings.push({ id: sw.id, damage: hitRange(sw.slots, sw.dmg, armor) });
    }
    from = p;
  });
  const dest = path[path.length - 1]!;
  for (const wt of watchers(c, dest.level)) {
    if (wt.noticed(h.heroId)) continue;
    if (wouldNotice(c, wt.f, dest, sneak, lit)) risks.notice.push({ id: wt.id });
  }
  return risks;
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
