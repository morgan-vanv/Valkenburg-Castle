// Shared AI helpers for monsters and rivals: who they can see, how they walk,
// how they strike, and the Ranger's overwatch that fires at them.

import { CLASH_HEAR, DOWNED_HEAR, FORCED_DOOR_HEAR, hearLoud, hearStep, isEnemy, partySees } from './hearing';
import { distance, posKey, posNeighbors, samePos, type Pos } from './hex';
import type { HeroInDelve, Intent } from './types';
import { BLINDSIDE_SLOTS, CALTROPS_DMG, CLASSES, HAMSTRING_NOISE, HAMSTRING_PENALTY, HAMSTRING_RANGE, HAMSTRING_ROUNDS, HAMSTRING_SLOTS, OVERWATCH_RANGE } from './data';
import { say, type Ctx, type MonsterX, type RivalX } from './state';
import {
  armorOf, guardMods, hd, heroDef, heroName, hurtAny, hurtHero, hurtPrisoner, lightPenaltyFor, makeNoise, monsterArmor, nameOf, occupant,
  rangedLabel, rivalsOnMap, roll, rootFigure, turnOnHit,
} from './common';
import { canEnter, dijkstra, distField, doorAt, kindAt, litSet, los, monsterSees, pathTo, seesHex, visibleSet, within } from './world';
import { figure } from './falls';
import { wayAtEntrance, wayOpen } from './ways';
import { dirIndex, faceToward, heroSwings, inRearHalf } from './stealth';
import { rivalStats } from './rivals';
import { poison } from './poison';
import { bowClass, spendArrow } from './arrows'; // V4.1 (WS6)
import { springTripwires, tripwireNear } from './village'; // V4.1 (spec 31.3): the tripwire
import { crewBraceMods, crewEdge } from './crewpower'; // V4.1 (WS7)

// ---------------------------------------------------------------- perception

export interface Target {
  id: string;
  at: Pos;
  armor: number;
  hero?: HeroInDelve;
  /** V4.0 (spec 28.2): a crew member (monsters go for them as for heroes). */
  rival?: RivalX;
}

/** Heroes (active, unveiled) and the freed prisoner: what monsters and hostile rivals go for. */
export function targets(c: Ctx): Target[] {
  const out: Target[] = [];
  for (const h of c.d.heroes) {
    if (h.status !== 'active' || h.veil > 0) continue; // veiled heroes are unseen (spec 15.3)
    out.push({ id: h.heroId, at: h.at, armor: armorOf(heroDef(c, h.heroId)!), hero: h });
  }
  const pr = c.d.prisoner;
  // V4.1 (spec 31.4): the unshackled captive, or a shackled one being carried (a strike on the hex may pick them).
  if (pr && !pr.dead && !pr.out && (pr.freed || c.d.heroes.some((h) => h.carrying === pr.id && h.status === 'active'))) out.push({ id: pr.id, at: pr.at, armor: 0 });
  return out;
}

/** V4.0 (spec 28.2, pillar 17): crew members on the map (hired or not, unveiled), as monsters see them. */
export function crewTargets(c: Ctx): Target[] {
  return rivalsOnMap(c).filter((r) => (r.veil ?? 0) <= 0).map((r) => ({ id: r.id, at: r.at, armor: rivalStats(r).armor, rival: r }));
}

/** V4.0 (spec 28.2): what a monster goes for: the heroes and the freed prisoner (`targets`), and crew members. */
export function foes(c: Ctx): Target[] {
  return [...targets(c), ...crewTargets(c)];
}

/** Monster sight (spec 16.1). */
export function sees(c: Ctx, from: Pos, t: Pos, lit: Set<string>): boolean {
  return monsterSees(c.w, c.d, from, t, lit);
}

export function byDist(from: Pos) {
  return (a: Target, b: Target) => {
    const da = a.at.level === from.level ? distance(a.at, from) : 99;
    const db = b.at.level === from.level ? distance(b.at, from) : 99;
    return da - db || (a.id < b.id ? -1 : 1);
  };
}

/** Ward: 1 less per hit, to a minimum of 0 (spec 15.3). */
export function wardOf(h: HeroInDelve | undefined): number {
  return h && h.ward > 0 ? 1 : 0;
}

export function adjacentTo(a: Pos, b: Pos): boolean {
  return a.level === b.level && distance(a, b) === 1;
}

// ---------------------------------------------------------------- movement

export function blocked(c: Ctx, p: Pos, self: string): boolean {
  const o = occupant(c, p);
  if ((c.d.burning?.[posKey(p)] ?? 0) > 0) return true; // nothing walks into fire
  return !!o && o.id !== self;
}

export interface ApproachOpts {
  stairs: boolean;
  allowLocked?: boolean;
  /** Extra hexes the walker won't enter (the Gloam keeps to the dark). */
  avoid?: (p: Pos) => boolean;
  /** V4.0 (spec 28.8): a figure the walker may pass through (a crew member hauling a seized hero who is awake). */
  through?: string;
}

/** Best path of at most `budget` toward the nearest of `goals` (stops on a free hex). */
export function approach(c: Ctx, self: string, from: Pos, goals: Pos[], budget: number, stairs: boolean | ApproachOpts, allowLocked = false): Pos[] | null {
  if (!goals.length) return null;
  const o: ApproachOpts = typeof stairs === 'boolean' ? { stairs, allowLocked } : stairs;
  const enter = (p: Pos) => (!blocked(c, p, self) || (!!o.through && occupant(c, p)?.id === o.through)) && !(o.avoid?.(p) ?? false);
  const field = distField(c.w, c.d, goals, { stairs: o.stairs, allowLocked: o.allowLocked });
  if (!field.has(posKey(from))) return null;
  const nodes = dijkstra(c.w, c.d, from, { enter, stairs: o.stairs, allowLocked: o.allowLocked, budget });
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

/** Free hexes a figure could stand on to hit `t` in melee. */
export function attackSpots(c: Ctx, t: Pos, self: string, allowLocked = false): Pos[] {
  return posNeighbors(t).filter((p) => canEnter(c.w, c.d, p, allowLocked) && !blocked(c, p, self));
}

export function hitRange(slots: number, dmg: number, armor: number): [number, number] {
  return [0, slots * Math.max(1, dmg - armor) + 1];
}

export function exitsBy(c: Ctx, from: Pos): Pos[] {
  const field = distField(c.w, c.d, [from], { stairs: true });
  // V4.0 (spec 25): only exits whose way is open (never one behind a shut gate or rubble).
  return [...c.w.exits].filter((e) => field.has(posKey(e)) && exitOpen(c, e)).sort((a, b) => field.get(posKey(a))! - field.get(posKey(b))!);
}

/** V4.0 (spec 25): is this exit's way open (exits that aren't shut ways always are)? */
export function exitOpen(c: Ctx, e: Pos): boolean {
  const way = wayAtEntrance(c.w.castle, e);
  return !way || wayOpen(c.s, way.id);
}

/**
 * Walk a figure along `path`. Returns true if it was stopped short: caltrops (monsters only), or a
 * hero's free swing killed it (spec 20.2, 31.11: stepping from a hero's side with their action ready). It faces
 * the way it last stepped (spec 20.1).
 */
export function walk(c: Ctx, id: string, at: { at: Pos; facing?: number }, path: Pos[]): boolean {
  if (!path.length) return false;
  // V3.7 (spec 20.5): a rooted crew member (hamstring, briar) stays where it is.
  if (((c.d.rivals?.members.find((r) => r.id === id)?.stuck) ?? 0) > 0) return true;
  const seg: Pos[] = [];
  let from = at.at;
  const isMonster = c.d.monsters.some((m) => m.id === id);
  const swung = new Set<string>(); // V4.1 (spec 31.11): each hero swings once per move
  for (const p of path) {
    if (p.level === from.level && !samePos(p, from)) at.facing = dirIndex(from, p);
    if (heroSwings(c, id, from, p, swung)) {
      if (seg.length) c.ev.push({ type: 'moved', id, path: [...seg] });
      at.at = { ...from };
      return true;
    }
    if (isMonster && c.d.caltrops.includes(posKey(p))) {
      // Caltrops: 2 damage, the walk ends here (spec 15.4).
      c.d.caltrops = c.d.caltrops.filter((k) => k !== posKey(p));
      seg.push(p);
      c.ev.push({ type: 'moved', id, path: [...seg] });
      seg.length = 0;
      at.at = { ...p };
      hearStep(c, id, p);
      c.ev.push({ type: 'caltrops', id, at: p });
      say(c, `${nameOf(c, id)} treads on caltrops.`);
      hurtAny(c, id, CALTROPS_DMG, null, { noise: false });
      return true;
    }
    if (kindAt(c.w, c.d, p) === 'door') {
      const door = doorAt(c.d, p);
      if (door && !door.open) {
        // V3.9.3 (spec 24.8): a locked door forced open out of sight is heard (hearing only).
        if (door.locked) hearLoud(c, p, FORCED_DOOR_HEAR, 'crash');
        door.open = true;
        door.locked = false;
        c.ev.push({ type: 'doorChanged', at: p, open: true, locked: false });
      }
    }
    seg.push(p);
    hearStep(c, id, p);
    // V4.1 (spec 31.3): a Sapper's tripwire next to the step goes off now; the walk ends here (or with the monster).
    if (isMonster && tripwireNear(c, p) && c.d.monsters.find((m) => m.id === id)?.kind !== 'gloam') {
      c.ev.push({ type: 'moved', id, path: [...seg] });
      at.at = { ...p };
      springTripwires(c, id, p);
      return true;
    }
    if (p.level !== from.level) {
      c.ev.push({ type: 'moved', id, path: [...seg] });
      seg.length = 0;
      c.ev.push({ type: 'levelChanged', id, from: from.level, to: p.level });
    }
    from = p;
  }
  if (seg.length) c.ev.push({ type: 'moved', id, path: [...seg] });
  at.at = { ...path[path.length - 1]! };
  return false;
}

// ---------------------------------------------------------------- striking

/** Sellsword guarding the target takes the hit instead. */
export function guardFor(c: Ctx, targetId: string): HeroInDelve | undefined {
  return c.d.heroes.find((h) => h.status === 'active' && h.guarding === targetId);
}

/** An attack on a hero or the prisoner. Returns the id that was hit (after guard), or null on a miss. */
export function strike(c: Ctx, attacker: string, targetId: string, slots: number, p: number, dmg: number, what: string): string | null {
  return strikeDetailed(c, attacker, targetId, slots, p, dmg, what).hit;
}

/** `strike` with the roll's hits and the damage dealt (free swings report them, spec 20.2). */
export function strikeDetailed(c: Ctx, attacker: string, targetId: string, slots: number, p: number, dmg: number, what: string): { hit: string | null; hits: number; damage: number } {
  // V3.9.2 (spec 24.7): whoever strikes turns to face the target (monsters and crew members alike).
  {
    const me = c.d.monsters.find((m) => m.id === attacker) ?? c.d.rivals?.members.find((r) => r.id === attacker);
    const to = figurePosOf(c, targetId);
    if (me && to) faceToward(me, to);
  }
  // V4.0 (spec 28.2): a crew member struck (by a monster, or a free swing): the heroes' rules, its own armor and ward.
  const rv = rivalsOnMap(c).find((x) => x.id === targetId);
  if (rv) return strikeCrew(c, attacker, rv, slots, p, dmg, what);
  let tid = targetId;
  const g = guardFor(c, tid);
  if (g) {
    tid = g.heroId;
    say(c, `${heroName(c, g.heroId)} steps in front of ${nameOf(c, targetId)}.`);
  }
  // V3.7 (spec 20.5): a braced hero is harder to hit; brace and the shield take damage off each hit.
  const h = hd(c, tid);
  const gm = h ? guardMods(c, h, rangedLabel(what)) : { dmg: 0, chance: 0 };
  // V3.9 (spec 24.2): from the hero's rear half, +1 slot; unseen, it stands out to the party.
  const bs = h ? blindside(c, attacker, h) : NOT_BLINDSIDED;
  // V4.1 (WS7, spec 31.9): a crew member's strike by the heroes' rules: flanked +1 slot, a perch +10, Focus on a key roll.
  const edge = h ? crewEdge(c, attacker, h, slots, p, dmg, what) : null;
  const r = roll(c, attacker, bs.extra ? `${what} from behind` : what, (edge?.slots ?? slots) + bs.extra, (edge?.p ?? p) + gm.chance, edge?.focus ?? 0);
  // V3.9.3 (spec 24.8): an unseen enemy's attack is heard as a clash (hearing only; seen before any reveal).
  const from = figurePosOf(c, attacker);
  const unseenAttacker = !!from && isEnemy(c, attacker) && !partySees(c, from);
  if (from && unseenAttacker) hearLoud(c, from, CLASH_HEAR, 'clash', { seen: false });
  if (bs.unseen) unseenStrike(c, attacker, tid, r.hits > 0);
  if (!r.hits) {
    c.ev.push({ type: 'miss', attacker, target: tid });
    return { hit: null, hits: 0, damage: 0 };
  }
  const armor = h ? armorOf(heroDef(c, tid)!) : 0;
  const total = r.hits * Math.max(0, Math.max(1, dmg - armor) - wardOf(h) - gm.dmg) + (r.perfect ? 1 : 0);
  const wasUp = h?.status === 'active';
  if (h) hurtHero(c, h, total, attacker, r.perfect);
  else hurtPrisoner(c, total, attacker);
  if (h && wasUp && h.status !== 'active' && unseenAttacker) hearLoud(c, h.at, DOWNED_HEAR, 'scream', { seen: false });
  if (h && h.status === 'active' && spiderBite(c, attacker)) poison(c, tid, attacker); // V4.1 (spec 31.4)
  return { hit: tid, hits: r.hits, damage: total };
}

/**
 * V4.0 (spec 28.2): an attack on a crew member: +1 slot from its blind cone (as on a hero), damage per hit
 * max(1, dmg − armor) less its ward, Perfect +1; a hit turns it to face the attacker. Heard when unseen. It
 * remembers who attacked it this world phase (it fights back). The Sellsword guarding it takes the hit (hurtAny).
 */
function strikeCrew(c: Ctx, attacker: string, r: RivalX, slots: number, p: number, dmg: number, what: string): { hit: string | null; hits: number; damage: number } {
  const from = figurePosOf(c, attacker);
  const extra = from && inRearHalf(r, from) ? BLINDSIDE_SLOTS : 0;
  const bm = crewBraceMods(r); // V4.1 (WS7): a braced crew Sellsword
  const rr = roll(c, attacker, extra ? `${what} from behind` : what, slots + extra, p + bm.chance);
  if (from && isEnemy(c, attacker) && !partySees(c, from) && !partySees(c, r.at)) hearLoud(c, from, CLASH_HEAR, 'clash', { seen: false });
  if (c.d.monsters.some((m) => m.id === attacker)) r.attackedBy = attacker;
  if (!rr.hits) {
    c.ev.push({ type: 'miss', attacker, target: r.id });
    return { hit: null, hits: 0, damage: 0 };
  }
  const st = rivalStats(r);
  const total = rr.hits * Math.max(0, Math.max(1, dmg - st.armor) - ((r.ward ?? 0) > 0 ? 1 : 0) - bm.dmg) + (rr.perfect ? 1 : 0);
  hurtAny(c, r.id, total, attacker, { crit: rr.perfect });
  turnOnHit(c, r.id, attacker);
  if (spiderBite(c, attacker)) poison(c, r.id, attacker); // V4.1 (spec 31.4): crew members too (pillar 17)
  return { hit: r.id, hits: rr.hits, damage: total };
}

/** V4.0 (spec 29.3), V4.1 (spec 31.4): a spider's bite that hits poisons (its attacks and free swings, every level). */
function spiderBite(c: Ctx, attacker: string): boolean {
  return c.d.monsters.some((m) => m.id === attacker && m.kind === 'spider');
}

// ---------------------------------------------------------------- blindsided (spec 24.2)

const NOT_BLINDSIDED = { extra: 0, unseen: false };

/**
 * An attack on hero `h` by `attacker`: from the hero's blind area (V3.9.2: the cone straight behind) it is blindsided (+1 slot); `unseen`
 * when no hero can see the attacker either. Monsters, crews, free swings and overwatch shots alike.
 */
export function blindside(c: Ctx, attacker: string, h: HeroInDelve): { extra: number; unseen: boolean } {
  const at = figurePosOf(c, attacker);
  if (!at || !inRearHalf(h, at)) return NOT_BLINDSIDED;
  const vis = (c.visCache ??= visibleSet(c.w, c.d));
  return { extra: BLINDSIDE_SLOTS, unseen: !vis.has(posKey(at)) };
}

/** Something the party can't see strikes from behind: the log line, `unseenHit` on a hit, and the attacker shows until the next player phase ends. */
export function unseenStrike(c: Ctx, attacker: string, heroId: string, hit: boolean): void {
  (c.d.revealed ??= {})[attacker] = c.d.round + 1;
  c.visCache = undefined;
  if (hit) c.ev.push({ type: 'unseenHit', target: heroId });
  say(c, hit ? `Something strikes ${heroName(c, heroId)} from behind.` : `Something lunges at ${heroName(c, heroId)} from behind and misses.`);
}

// ---------------------------------------------------------------- hamstring (spec 20.5: orc archers, rival Rangers)

/**
 * Should a bow-armed enemy at `from` hamstring target `t` instead of shooting it? A hero not yet
 * rooted, within HAMSTRING_RANGE in line of sight, and close enough to be a threat (within 3).
 * Shown as the intent `hamstring` the round before (world-phase SHOWN_FIRST; crews likewise).
 */
export function hamstringIntent(c: Ctx, from: Pos, t: Target): Intent | null {
  if (!t.hero || t.hero.status !== 'active' || (t.hero.rooted ?? 0) > 0) return null;
  if (t.at.level !== from.level || distance(from, t.at) > HAMSTRING_RANGE || distance(from, t.at) > 3) return null;
  if (!los(c.w, c.d, from, t.at)) return null;
  return { kind: 'hamstring', targetId: t.id, to: { ...from } };
}

/**
 * The hamstring shot itself (spec 20.5): HAMSTRING_SLOTS at `chance` − 20; a hit roots the hero for
 * HAMSTRING_ROUNDS (a rooted hero hit again is refreshed). Brace lowers the chance. Noise 1.
 * Returns true on a hit.
 */
export function hamstringShot(c: Ctx, attacker: string, t: Target, chance: number): boolean {
  if (!t.hero || t.hero.status !== 'active') return false;
  const gm = guardMods(c, t.hero, true);
  const bs = blindside(c, attacker, t.hero);
  say(c, `${nameOf(c, attacker)} aims low at ${heroName(c, t.id)}'s legs.`);
  const r = roll(c, attacker, bs.extra ? 'Hamstring from behind' : 'Hamstring', HAMSTRING_SLOTS + bs.extra, chance + HAMSTRING_PENALTY + gm.chance);
  if (bs.unseen) unseenStrike(c, attacker, t.id, r.hits > 0);
  const at = figurePosOf(c, attacker);
  if (at) makeNoise(c, at, HAMSTRING_NOISE, { what: 'clash' });
  if (!r.hits) {
    c.ev.push({ type: 'miss', attacker, target: t.id });
    return false;
  }
  c.ev.push({ type: 'hit', attacker, target: t.id, damage: 0, crit: false });
  rootFigure(c, t.id, HAMSTRING_ROUNDS, attacker);
  return true;
}

function figurePosOf(c: Ctx, id: string): Pos | undefined {
  return c.d.monsters.find((m) => m.id === id)?.at ?? c.d.rivals?.members.find((r) => r.id === id)?.at;
}

// ---------------------------------------------------------------- overwatch (Ranger, spec 15.3)

/**
 * An enemy `id` at `at` moves or acts: the first Ranger on overwatch who can see it within 6 shoots
 * (full bow roll). Returns true if the enemy died.
 */
export function overwatchCheck(c: Ctx, id: string, at: Pos): boolean {
  const lit = litSet(c.w, c.d);
  for (const h of c.d.heroes) {
    if (h.status !== 'active' || !h.overwatch) continue;
    const def = heroDef(c, h.heroId)!;
    // V3.9 (spec 24.2): only at enemies in the watcher's front half.
    if (!within(h.at, at, OVERWATCH_RANGE) || !seesHex(c.w, c.d, h.at, at, lit, h.facing)) continue;
    h.overwatch = false;
    // V4.1 (WS6, spec 31.8): the shot looses a plain arrow (the quiver first); none left (spent on free swings): it lapses.
    if (bowClass(def.cls) && !spendArrow(h.pack)) {
      say(c, `${heroName(c, h.heroId)} reaches for an arrow and finds none.`);
      continue;
    }
    const cls = CLASSES[def.cls];
    let slots = cls.weapon.slots;
    if (distance(h.at, at) <= 1) slots -= 1;
    let p = def.stats[cls.weapon.stat] + 10 * def.weaponTier + lightPenaltyFor(c.w, c, h, lit);
    const m = c.d.monsters.find((x) => x.id === id);
    if (m?.awareness === 'asleep') p += 20;
    say(c, `${heroName(c, h.heroId)} looses an arrow at ${nameOf(c, id)}.`);
    c.ev.push({ type: 'cast', by: h.heroId, spell: 'overwatch', targetId: id, at });
    const r = roll(c, h.heroId, 'Overwatch', slots, p);
    makeNoise(c, h.at, cls.weapon.noise ?? 1);
    if (!r.hits) {
      c.ev.push({ type: 'miss', attacker: h.heroId, target: id });
      return false;
    }
    const armor = m ? monsterArmor(c, m as MonsterX) : 0;
    hurtAny(c, id, r.hits * Math.max(1, cls.weapon.dmg - armor) + (r.perfect ? 1 : 0), h.heroId, { crit: r.perfect });
    turnOnHit(c, id, h.heroId); // V4.0 (spec 26.3)
    return !figure(c, id);
  }
  return false;
}
