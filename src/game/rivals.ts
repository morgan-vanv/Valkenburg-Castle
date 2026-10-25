// Section 10, 16.5 and 18.5: rival crews. The Lantern Sisters (prospectors) race the
// party for loot on Level 1 and turn hostile when attacked or blocked; cutthroat crews
// (the Ferrymen, the Gallows Choir) wait at a choke point on Level 2 and demand a toll.
// Each member has a class and kit shown as intents the round before, like monsters.
// Paid crews (spec 18.6) leave, keep a truce, do a job, or fight beside the party.

import { distance, posKey, posNeighbors, range, samePos, type Pos } from './hex';
import type { Intent, Item, RivalClass } from './types';
import {
  BETRAY_CHANCE, BETRAY_LOOT, BOW_RANGE, CREWS, CUTTHROAT_CHANCE, CUTTHROAT_POOL, CUTTHROAT_PURSE, CUTTHROAT_SIGHT, CUTTHROAT_TIER,
  HIRE_KEEP, KNOCKBACK_RANGE, PROSPECTOR_CHANCE, PYRO_BOLT_CHANCE, PYRO_BOLT_DMG, PYRO_BOLT_NOISE, PYRO_BOLT_RANGE, PYRO_BOLT_SLOTS,
  PYRO_BOLTS, RIVAL_CLASSES, SAPPER_CHARGE_DMG, SAPPER_CHARGE_NOISE, SAPPER_CHARGE_RANGE, SELLSWORD_SHOVE_CHANCE, SISTER_DART_CHANCE,
  SISTER_DARTS, SISTER_SMOKE, SISTERS_LEAVE_LIGHT, THROW_RANGE, VEIL_ROUNDS, WINCH_NOISE, type RivalStats,
} from './data';
import { chance, int, pick, random } from './rng';
import { say, type Ctx, type CrewX, type DelveX, type GameStateX, type HeroX, type RivalX } from './state';
import {
  chestLoot, crewDemand, hd, heroName, hurtAny, makeItem, makeNoise, monsterArmor, noteOnce, occupant, onMap, partyValue, putOnGround,
  rivalsOnMap, roll, valueOf,
} from './common';
import { canEnter, distField, doorAt, kindAt, los, within, type World } from './world';
import { approach, attackSpots, blocked, exitsBy, hitRange, overwatchCheck, strike, targets, walk, type Target } from './ai';
import { push, pushOutcome } from './falls';
import { pusherFor, smokeOut } from './delve';

// ---------------------------------------------------------------- making a crew

/** A member's fighting numbers: its class, plus the Level 2 tier for cutthroats (spec 18.5). */
export function rivalStats(r: RivalX): RivalStats {
  const base = RIVAL_CLASSES[r.cls];
  return (r.tier ?? 1) > 1 ? { ...base, chance: base.chance + CUTTHROAT_TIER.chance } : base;
}

function member(id: string, crew: CrewX['crew'], name: string, cls: RivalClass, at: Pos, tier: number): RivalX {
  const hp = RIVAL_CLASSES[cls].hp + (tier > 1 ? CUTTHROAT_TIER.hp : 0);
  return {
    id, crew, name, at: { ...at }, hp, maxHp: hp, loot: [], goneOut: false, cls,
    ...(tier > 1 ? { tier } : {}),
    ...(cls === 'burglar' ? { darts: SISTER_DARTS } : {}),
    ...(cls === 'shadowmancer' ? { smoke: SISTER_SMOKE, veil: 0 } : {}),
    ...(cls === 'ranger' ? { overwatch: false } : {}),
    ...(cls === 'sapper' ? { charges: 1 } : {}),
    ...(cls === 'pyromancer' ? { charges: PYRO_BOLTS } : {}),
  };
}

/** Free standable hexes around `from` (from first), n of them, avoiding anyone already there. */
function spotsAround(w: World, d: DelveX, from: Pos, n: number, taken: (p: Pos) => boolean): Pos[] {
  const out: Pos[] = [];
  const seen = new Set([posKey(from)]);
  const q = [from];
  for (let i = 0; i < q.length && out.length < n; i++) {
    const p = q[i]!;
    if (canEnter(w, d, p) && kindAt(w, d, p) !== 'door' && kindAt(w, d, p) !== 'lift' && !taken(p)) out.push(p);
    for (const nb of posNeighbors(p)) {
      if (seen.has(posKey(nb)) || !canEnter(w, d, nb)) continue;
      seen.add(posKey(nb));
      q.push(nb);
    }
  }
  return out;
}

/**
 * Spec 18.5: which crew this delve draws. A Level 1 contract: the Lantern Sisters, 50%, entering
 * from a rival entrance on round 3..6. Level 2 or 3: a cutthroat crew from the pool, 60%,
 * waiting from round 1 at a post on Level 2. Never both.
 */
export function makeCrew(w: World, s: GameStateX, d: DelveX, level: number): CrewX | null {
  const c: Ctx = { w, s, d, ev: [] };
  if (level <= 1) {
    if (!w.castle.rivalEntrances.length || random(s) >= PROSPECTOR_CHANCE) return null;
    const at = pick(s, w.castle.rivalEntrances);
    const def = CREWS['lantern-sisters'];
    return {
      crew: def.id, name: def.name, temperament: 'prospector', stance: 'neutral', goal: 'loot', spotted: false,
      entersRound: int(s, 3, 6),
      members: def.members.map((m, i) => member(`r${i + 1}`, def.id, m.name, m.cls, at, 1)),
      pickups: 0, entered: false,
    };
  }
  const posts = w.castle.rivalPosts ?? [];
  if (!posts.length || random(s) >= CUTTHROAT_CHANCE) return null;
  const def = CREWS[pick(s, CUTTHROAT_POOL)];
  const post = pick(s, posts);
  const spots = spotsAround(w, d, post, def.members.length, (p) => !!occupant(c, p));
  if (spots.length < def.members.length) return null;
  const crew: CrewX = {
    crew: def.id, name: def.name, temperament: 'cutthroat', stance: 'waiting', goal: 'loot', spotted: false, entersRound: 1,
    members: def.members.map((m, i) => {
      const r = member(`r${i + 1}`, def.id, m.name, m.cls, spots[i]!, 2);
      r.post = { ...spots[i]! };
      return r;
    }),
    pickups: 0, entered: true,
  };
  // Each cutthroat carries a purse (dropped when killed).
  for (const r of crew.members) r.loot.push(makeItem({ s }, 'gold', CUTTHROAT_PURSE));
  return crew;
}

/** A crew of `id` standing on `spots` (for tests and fixtures): cutthroats waiting with posts and purses. */
export function buildCrew(s: GameStateX, id: CrewX['crew'], spots: Pos[]): CrewX {
  const def = CREWS[id];
  const cut = def.temperament === 'cutthroat';
  const crew: CrewX = {
    crew: def.id, name: def.name, temperament: def.temperament, stance: cut ? 'waiting' : 'neutral', goal: 'loot', spotted: false, entersRound: 1,
    members: def.members.map((m, i) => {
      const r = member(`r${i + 1}`, def.id, m.name, m.cls, spots[i]!, cut ? 2 : 1);
      if (cut) r.post = { ...spots[i]! };
      return r;
    }),
    pickups: 0, entered: true,
  };
  if (cut) for (const r of crew.members) r.loot.push(makeItem({ s }, 'gold', CUTTHROAT_PURSE));
  return crew;
}

// ---------------------------------------------------------------- entering (prospectors)

function rivalEnter(c: Ctx): void {
  const cr = c.d.rivals;
  if (!cr || cr.entered || c.d.round < cr.entersRound) return;
  const at = cr.members[0]!.at;
  const spots = spotsAround(c.w, c.d, at, cr.members.length, (p) => !!occupant(c, p));
  if (spots.length < cr.members.length) return; // blocked: try next round
  cr.entered = true;
  cr.members.forEach((r, i) => (r.at = spots[i]!));
  c.ev.push({ type: 'rivalsEnter', at });
  say(c, 'Lanterns at the door. Someone else is here.');
}

// ---------------------------------------------------------------- looting

interface LootGoal {
  at: Pos;
  chestId?: string;
  objective: boolean;
}

/**
 * What a prospector goes for: unopened chests (anyone), and ground piles nobody stands on. Piles the
 * heroes left at chests they opened are the Burglar sister's business (spec 16.5); a chest the crew
 * opened on a paid job is left to the party.
 */
function lootGoals(c: Ctx, r: RivalX): LootGoal[] {
  const cr = c.d.rivals!;
  const out: LootGoal[] = [];
  for (const ch of c.d.chests) if (!ch.opened && !ch.jammed) out.push({ at: ch.at, chestId: ch.id, objective: false });
  for (const g of c.d.ground) {
    if (!g.items.length) continue;
    if (c.d.heroes.some((h) => (h.status === 'active' || h.status === 'downed') && samePos(h.at, g.at))) continue;
    const chest = c.d.chests.find((ch) => ch.opened && samePos(ch.at, g.at));
    if (chest && cr.spare?.includes(chest.id)) continue;
    const objective = g.items.some((i) => i.kind === 'heirloom');
    if (chest && r.cls !== 'burglar' && !objective) continue;
    out.push({ at: g.at, objective });
  }
  return out;
}

function bestLoot(c: Ctx, r: RivalX): (LootGoal & { reach: number }) | null {
  const goals = lootGoals(c, r);
  if (!goals.length) return null;
  const field = distField(c.w, c.d, [r.at], { stairs: true });
  const reach = (g: LootGoal) => Math.min(999, ...[g.at, ...posNeighbors(g.at)].map((p) => field.get(posKey(p)) ?? 999));
  goals.sort((a, b) => reach(a) - reach(b));
  const g = goals[0]!;
  const n = reach(g);
  return n >= 999 ? null : { ...g, reach: n };
}

// ---------------------------------------------------------------- perception

/** Heroes a member can see: same level, in line of sight (crews carry their own lanterns). */
function heroesInSight(c: Ctx, r: RivalX, n: number): Target[] {
  return targets(c)
    .filter((t) => t.hero && within(t.at, r.at, n) && los(c.w, c.d, r.at, t.at))
    .sort((a, b) => distance(a.at, r.at) - distance(b.at, r.at) || (a.id < b.id ? -1 : 1));
}

function nearestHero(c: Ctx, r: RivalX): Target | undefined {
  const ts = targets(c).filter((t) => t.hero);
  const field = distField(c.w, c.d, [r.at], { stairs: true });
  ts.sort((a, b) => (field.get(posKey(a.at)) ?? 999) - (field.get(posKey(b.at)) ?? 999) || (a.id < b.id ? -1 : 1));
  return ts[0];
}

/**
 * Spec 18.5: a waiting cutthroat crew notices the party when an active hero comes within 6 of a
 * member in line of sight (noise is heard in makeNoise). Then they demand the toll.
 */
export function crewNotice(c: Ctx): void {
  const cr = c.d.rivals;
  if (!cr || cr.temperament !== 'cutthroat' || cr.stance !== 'waiting') return;
  const seen = rivalsOnMap(c).some((r) => heroesInSight(c, r, CUTTHROAT_SIGHT).length > 0);
  if (seen) crewDemand(c);
}

/** Spec 18.6: what the crew is after, for the parley card (set while spotted). */
export function crewAim(c: Ctx): void {
  const cr = c.d.rivals;
  if (!cr) return;
  const ms = rivalsOnMap(c);
  if (!cr.spotted || !ms.length) {
    cr.aim = undefined;
    return;
  }
  const lead = ms[0]!;
  const move = rivalStats(lead).move;
  if (cr.temperament === 'cutthroat' && (cr.stance === 'waiting' || cr.stance === 'demanding' || cr.stance === 'hostile')) {
    const t = nearestHero(c, lead);
    cr.aim = t
      ? { at: { ...t.at }, what: cr.stance === 'hostile' ? 'your blood' : 'your purse', rounds: 0, value: cr.stance === 'demanding' ? (cr.toll ?? 0) : partyValue(c) }
      : undefined;
    return;
  }
  if (cr.goal === 'leave' || cr.stance === 'hired' || cr.temperament === 'cutthroat') {
    cr.aim = cr.goal === 'leave' && !cr.job ? exitAim(c, lead) : undefined;
    return;
  }
  let best: { at: Pos; what: string; rounds: number; value: number } | undefined;
  for (const r of ms) {
    const g = bestLoot(c, r);
    if (!g) continue;
    const rounds = Math.max(0, Math.ceil(g.reach / move));
    if (best && best.rounds <= rounds) continue;
    let what: string;
    let value: number;
    if (g.chestId) {
      const ch = c.d.chests.find((x) => x.id === g.chestId)!;
      what = `the ${c.w.roomName(ch.at).toLowerCase()} chest`;
      value = 50 * ch.tier;
    } else {
      const pile = c.d.ground.find((x) => samePos(x.at, g.at));
      const items = pile?.items ?? [];
      const hl = items.find((i) => i.kind === 'heirloom');
      what = hl ? hl.name : `loot in the ${c.w.roomName(g.at).toLowerCase()}`;
      value = valueOf(items);
    }
    best = { at: { ...g.at }, what, rounds, value };
  }
  cr.aim = best;
}

function exitAim(c: Ctx, r: RivalX): RivalCrewAim | undefined {
  const ex = exitsBy(c, r.at)[0];
  if (!ex) return undefined;
  const field = distField(c.w, c.d, [ex], { stairs: true });
  const n = field.get(posKey(r.at)) ?? 0;
  return { at: { ...ex }, what: 'the way out', rounds: Math.ceil(n / rivalStats(r).move), value: valueOf(c.d.rivals!.members.flatMap((m) => m.loot)) };
}
type RivalCrewAim = NonNullable<CrewX['aim']>;

// ---------------------------------------------------------------- the kit (spec 16.5, 18.5)

/** Where a melee member ends up to strike `t` this round: here if adjacent, else the end of its approach. */
function strikeFrom(c: Ctx, r: RivalX, t: Target): Pos | null {
  if (within(r.at, t.at, 1)) return r.at;
  const path = approach(c, r.id, r.at, attackSpots(c, t.at, r.id), rivalStats(r).move, true) ?? [];
  const end = path[path.length - 1];
  return end && within(end, t.at, 1) ? end : null;
}

function noCrewWithin(c: Ctx, p: Pos, n: number): boolean {
  return !rivalsOnMap(c).some((m) => within(m.at, p, n));
}

/** The kit intent a member would use now, if any (hostile only, but for the veil). */
function kitIntent(c: Ctx, r: RivalX): Intent | null {
  const cr = c.d.rivals!;
  if (r.intent?.kind === 'veil' && !r.veiled) return r.intent;
  if (cr.stance !== 'hostile') return null;
  switch (r.cls) {
    case 'ranger': {
      const kb = heroesInSight(c, r, KNOCKBACK_RANGE).find((t) => {
        const o = pushOutcome(c, pusherFor(r.at, t.at), t.at, t.id);
        return o.kind === 'fall' && !!o.fall;
      });
      if (kb) {
        const o = pushOutcome(c, pusherFor(r.at, kb.at), kb.at, kb.id);
        return { kind: 'shove', targetId: kb.id, to: o.dest, damage: [0, o.fall?.damage ?? 0] };
      }
      if (heroesInSight(c, r, BOW_RANGE).length) return null; // a shot
      // No hero in reach this round (not even after walking): wait with an arrow nocked.
      const t = nearestHero(c, r);
      if (t) {
        const path = approach(c, r.id, r.at, shootingSpots(c, r, t), rivalStats(r).move, true) ?? [];
        const end = path[path.length - 1];
        if (end && within(end, t.at, BOW_RANGE) && los(c.w, c.d, end, t.at)) return null;
      }
      return { kind: 'overwatch', targetId: r.id };
    }
    case 'shadowmancer': {
      if ((r.smoke ?? 0) > 0 && cr.members.some((m) => m.hp > 0 && !m.goneOut && m.hp * 2 < m.maxHp)) {
        const t = heroesInSight(c, r, THROW_RANGE.smoke)[0];
        if (t) return { kind: 'smoke', targetId: t.id, to: { ...t.at } };
      }
      return null;
    }
    case 'burglar': {
      if ((r.darts ?? 0) > 0) {
        const t = heroesInSight(c, r, THROW_RANGE.dart)[0];
        if (t) return { kind: 'dart', targetId: t.id };
      }
      return null;
    }
    case 'sellsword': {
      // Like the orc: shove a hero standing at an unrailed edge over it.
      const t = nearestHero(c, r);
      if (!t) return null;
      const from = strikeFrom(c, r, t);
      if (!from) return null;
      const o = pushOutcome(c, from, t.at, t.id);
      if (o.kind !== 'fall' || !o.fall) return null;
      r.shoveFrom = { ...from };
      return { kind: 'shove', targetId: t.id, to: o.dest, damage: [0, o.fall.damage] };
    }
    case 'sapper': {
      if ((r.charges ?? 0) <= 0) return null;
      if (targets(c).some((t) => t.hero && within(t.at, r.at, 1))) return null; // in their face: the hammer
      const t = heroesInSight(c, r, SAPPER_CHARGE_RANGE).find((x) => distance(x.at, r.at) >= 2 && noCrewWithin(c, x.at, 1));
      if (!t) return null;
      const hexes = range(t.at, 1).map((h) => ({ level: t.at.level, ...h })).filter((p) => !!c.w.tile(p));
      return { kind: 'charge', targetId: t.id, to: { ...t.at }, hexes, damage: [SAPPER_CHARGE_DMG, SAPPER_CHARGE_DMG] };
    }
    case 'pyromancer': {
      if ((r.charges ?? 0) <= 0) return null;
      const t = heroesInSight(c, r, PYRO_BOLT_RANGE)[0];
      if (!t) return null;
      return { kind: 'firebolt', targetId: t.id, damage: hitRange(PYRO_BOLT_SLOTS, PYRO_BOLT_DMG, t.armor) };
    }
  }
  return null;
}

/** Carry out a kit intent. Returns true if it used the member's turn. */
function useKit(c: Ctx, r: RivalX, it: Intent): boolean {
  const cr = c.d.rivals!;
  const st = rivalStats(r);
  if (it.kind === 'veil') {
    r.veil = VEIL_ROUNDS;
    r.veiled = true;
    c.ev.push({ type: 'cast', by: r.id, spell: 'veil', targetId: r.id });
    say(c, `${r.name} melts into the shadows.`);
    return true;
  }
  if (cr.stance !== 'hostile') return false;
  const t = targets(c).find((x) => x.id === it.targetId);
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
          walk(c, r.id, r, path);
        }
        if (!within(r.at, t.at, 1) || pushOutcome(c, r.at, t.at, t.id).kind !== 'fall') return false;
        say(c, `${r.name} lunges to shove ${heroName(c, t.id)} over the edge.`);
        if (chance(c.s, SELLSWORD_SHOVE_CHANCE)) push(c, t.id, r.at, r.id);
        else {
          c.ev.push({ type: 'miss', attacker: r.id, target: t.id });
          say(c, `${heroName(c, t.id)} keeps their footing.`);
        }
        return true;
      }
      if (!within(t.at, r.at, KNOCKBACK_RANGE) || !los(c.w, c.d, r.at, t.at)) return false;
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
      if ((r.smoke ?? 0) <= 0 || !t?.hero || !within(t.at, r.at, THROW_RANGE.smoke)) return false;
      r.smoke = (r.smoke ?? 1) - 1;
      c.ev.push({ type: 'thrown', by: r.id, kind: 'smoke', from: { ...r.at }, to: { ...t.at } });
      const hexes = smokeOut(c, t.at);
      c.ev.push({ type: 'cast', by: r.id, spell: 'smoke', at: { ...t.at }, hexes });
      say(c, `${r.name} drops a smoke bomb at ${heroName(c, t.id)}'s feet.`);
      return true;
    }
    case 'dart': {
      if ((r.darts ?? 0) <= 0 || !t?.hero || !within(t.at, r.at, THROW_RANGE.dart) || !los(c.w, c.d, r.at, t.at)) return false;
      r.darts = (r.darts ?? 1) - 1;
      c.ev.push({ type: 'thrown', by: r.id, kind: 'dart', from: { ...r.at }, to: { ...t.at } });
      const rr = roll(c, r.id, 'Sleep dart', 1, SISTER_DART_CHANCE);
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
      return true;
    }
    case 'charge': {
      // The sapper's charge goes off on the hex it showed, whoever stands there now.
      if ((r.charges ?? 0) <= 0 || !it.to) return false;
      r.charges = (r.charges ?? 1) - 1;
      const at = it.to;
      c.ev.push({ type: 'thrown', by: r.id, kind: 'charge', from: { ...r.at }, to: { ...at } });
      c.ev.push({ type: 'blast', at: { ...at } });
      say(c, `${r.name}'s charge goes off. BOOM.`);
      const hit: string[] = [];
      for (const m of onMap(c)) if (m.kind !== 'gloam' && within(m.at, at, 1)) hit.push(m.id);
      for (const x of rivalsOnMap(c)) if (within(x.at, at, 1)) hit.push(x.id);
      for (const h of c.d.heroes) if ((h.status === 'active' || h.status === 'downed') && within(h.at, at, 1)) hit.push(h.heroId);
      const pr = c.d.prisoner;
      if (pr && !pr.dead && !pr.out && within(pr.at, at, 1)) hit.push(pr.id);
      for (const id of hit) hurtAny(c, id, SAPPER_CHARGE_DMG, r.id, { noise: false });
      makeNoise(c, at, SAPPER_CHARGE_NOISE, { otherLevels: true });
      return true;
    }
    case 'firebolt': {
      if ((r.charges ?? 0) <= 0 || !t?.hero || !within(t.at, r.at, PYRO_BOLT_RANGE) || !los(c.w, c.d, r.at, t.at)) return false;
      r.charges = (r.charges ?? 1) - 1;
      c.ev.push({ type: 'cast', by: r.id, spell: 'firebolt', targetId: t.id, at: { ...t.at } });
      say(c, `${r.name} hurls a firebolt at ${heroName(c, t.id)}.`);
      strike(c, r.id, t.id, PYRO_BOLT_SLOTS, PYRO_BOLT_CHANCE + (st.chance - RIVAL_CLASSES[r.cls].chance), PYRO_BOLT_DMG, 'Firebolt');
      makeNoise(c, r.at, PYRO_BOLT_NOISE);
      return true;
    }
  }
  return false;
}

const KIT: Intent['kind'][] = ['veil', 'overwatch', 'shove', 'smoke', 'dart', 'charge', 'firebolt'];

/**
 * A hero moved or acted (spec 16.5): a hostile Ranger on overwatch who sees them
 * within 6 shoots first. Called from the hero's move/act.
 */
export function rivalOverwatchFire(c: Ctx, heroId: string): void {
  const cr = c.d.rivals;
  if (!cr || cr.stance !== 'hostile') return;
  const h = hd(c, heroId);
  if (!h || h.status !== 'active' || h.veil > 0) return;
  for (const r of rivalsOnMap(c)) {
    if (!r.overwatch || !within(r.at, h.at, BOW_RANGE) || !los(c.w, c.d, r.at, h.at)) continue;
    r.overwatch = false;
    const st = rivalStats(r);
    say(c, `${r.name} looses an arrow at ${heroName(c, heroId)}.`);
    c.ev.push({ type: 'cast', by: r.id, spell: 'overwatch', targetId: heroId, at: { ...h.at } });
    strike(c, r.id, heroId, st.slots, st.chance, st.dmg, 'Overwatch');
    return;
  }
}

// ---------------------------------------------------------------- intents

/** Hexes within `reach` of `t` with a line to them (a Ranger shoots from there). */
function shootingSpots(c: Ctx, r: RivalX, t: { at: Pos }, reach = BOW_RANGE): Pos[] {
  const out: Pos[] = [];
  for (let q = -reach; q <= reach; q++) {
    for (let rr = -reach; rr <= reach; rr++) {
      const p = { level: t.at.level, q: t.at.q + q, r: t.at.r + rr };
      const d = distance(p, t.at);
      if (d < 2 || d > reach) continue;
      if (!canEnter(c.w, c.d, p) || blocked(c, p, r.id) || !los(c.w, c.d, p, t.at)) continue;
      out.push(p);
    }
  }
  return out;
}

/** Hired: awake monsters the member can hit from `from`. */
function monstersInReach(c: Ctx, r: RivalX, from: Pos) {
  const reach = rivalStats(r).range;
  return onMap(c)
    .filter((m) => m.kind !== 'gloam' && m.awareness !== 'asleep' && within(m.at, from, reach) && (reach === 1 || los(c.w, c.d, from, m.at)))
    .sort((a, b) => distance(a.at, from) - distance(b.at, from) || (a.id < b.id ? -1 : 1));
}

/** Hexes within HIRE_KEEP of the hero who hired them. */
function keepSpots(c: Ctx, r: RivalX): Pos[] {
  const cr = c.d.rivals!;
  const h = cr.hiredBy ? hd(c, cr.hiredBy) : undefined;
  if (!h || h.status !== 'active') return [];
  return range(h.at, HIRE_KEEP)
    .map((x) => ({ level: h.at.level, ...x }))
    .filter((p) => canEnter(c.w, c.d, p) && kindAt(c.w, c.d, p) !== 'door' && !blocked(c, p, r.id));
}

/** A hired member's plan: hit a monster in reach, else close in on one near the hirer, else keep up. */
function hiredPlan(c: Ctx, r: RivalX): { intent: Intent; path: Pos[] } {
  const st = rivalStats(r);
  const now = monstersInReach(c, r, r.at)[0];
  if (now) return { intent: { kind: 'attack', targetId: now.id, to: { ...r.at } }, path: [] };
  const cr = c.d.rivals!;
  const h = cr.hiredBy ? hd(c, cr.hiredBy) : undefined;
  const near = h ? onMap(c).filter((m) => m.kind !== 'gloam' && m.awareness !== 'asleep' && within(m.at, h.at, 3)) : [];
  if (near.length) {
    const spots = near.flatMap((m) => (st.range > 1 ? shootingSpots(c, r, m, st.range) : attackSpots(c, m.at, r.id)));
    const path = approach(c, r.id, r.at, spots, st.move, true) ?? [];
    const end = path[path.length - 1] ?? r.at;
    const m = monstersInReach(c, r, end)[0];
    if (m) return { intent: { kind: 'attack', targetId: m.id, to: end }, path };
  }
  const keep = keepSpots(c, r);
  if (keep.some((p) => samePos(p, r.at)) || !keep.length) return { intent: { kind: 'wait' }, path: [] };
  const path = approach(c, r.id, r.at, keep, st.move, true) ?? [];
  const end = path[path.length - 1];
  return end ? { intent: { kind: 'move', to: end }, path } : { intent: { kind: 'wait' }, path: [] };
}

/** Where the paid job takes the crew: next to the winch, or to the locked thing. */
function jobSpots(c: Ctx, r: RivalX): Pos[] {
  const job = c.d.rivals?.job;
  if (!job?.at) return [];
  return posNeighbors(job.at).filter((p) => canEnter(c.w, c.d, p) && kindAt(c.w, c.d, p) !== 'door' && !blocked(c, p, r.id));
}

/** The member who walks to the job: the one nearest to it. */
function jobber(c: Ctx): RivalX | undefined {
  const job = c.d.rivals?.job;
  if (!job?.at) return undefined;
  const field = distField(c.w, c.d, posNeighbors(job.at), { stairs: true });
  return [...rivalsOnMap(c)].sort((a, b) => (field.get(posKey(a.at)) ?? 999) - (field.get(posKey(b.at)) ?? 999) || (a.id < b.id ? -1 : 1))[0];
}

/** The intent a member shows for the coming world phase. */
export function planRival(c: Ctx, r: RivalX): Intent {
  const cr = c.d.rivals!;
  const st = rivalStats(r);
  const kit = kitIntent(c, r);
  if (kit) return kit;
  if (cr.stance === 'hostile') {
    const t = nearestHero(c, r);
    if (!t) return { kind: 'wait' };
    const reach = st.range;
    if (within(t.at, r.at, reach) && (reach === 1 || los(c.w, c.d, r.at, t.at))) {
      return { kind: 'attack', targetId: t.id, to: { ...r.at }, damage: hitRange(st.slots, st.dmg, t.armor) };
    }
    const spots = reach > 1 ? shootingSpots(c, r, t) : attackSpots(c, t.at, r.id);
    const path = approach(c, r.id, r.at, spots, st.move, true) ?? [];
    const end = path[path.length - 1];
    if (end && within(end, t.at, reach)) return { kind: 'attack', targetId: t.id, to: end, damage: hitRange(st.slots, st.dmg, t.armor) };
    return end ? { kind: 'move', to: end, targetId: t.id } : { kind: 'wait' };
  }
  if (cr.stance === 'hired') return hiredPlan(c, r).intent;
  if (cr.stance === 'demanding') {
    if (r !== rivalsOnMap(c)[0]) return { kind: 'wait' };
    const t = nearestHero(c, r);
    return { kind: 'toll', ...(t ? { targetId: t.id } : {}), to: { ...r.at } };
  }
  if (cr.job && r === jobber(c)) {
    const spots = jobSpots(c, r);
    if (spots.some((p) => samePos(p, r.at))) return { kind: 'wait' };
    const path = approach(c, r.id, r.at, spots, st.move, true) ?? [];
    const end = path[path.length - 1];
    return end ? { kind: 'move', to: end } : { kind: 'wait' };
  }
  if (cr.stance === 'waiting') return { kind: 'wait' };
  if (cr.goal === 'leave') {
    const ex = exitsBy(c, r.at)[0];
    if (!ex) return { kind: 'wait' };
    const path = approach(c, r.id, r.at, [ex], st.move, true) ?? [];
    return { kind: 'flee', to: path[path.length - 1] ?? r.at };
  }
  if (cr.temperament === 'cutthroat') {
    // Truce: back to the post and stand.
    if (!r.post || samePos(r.post, r.at)) return { kind: 'wait' };
    const path = approach(c, r.id, r.at, [r.post], st.move, true) ?? [];
    const end = path[path.length - 1];
    return end ? { kind: 'move', to: end } : { kind: 'wait' };
  }
  const g = bestLoot(c, r);
  if (!g) return { kind: 'wait' };
  if (within(r.at, g.at, 1)) return { kind: 'steal', to: { ...r.at } };
  const spots = [g.at, ...posNeighbors(g.at)].filter((p) => canEnter(c.w, c.d, p) && !blocked(c, p, r.id));
  const path = approach(c, r.id, r.at, spots, st.move, true) ?? [];
  const end = path[path.length - 1];
  return end ? { kind: 'move', to: end } : { kind: 'wait' };
}

export function computeRivalIntents(c: Ctx): void {
  const cr = c.d.rivals;
  if (!cr || !cr.entered) return;
  for (const r of rivalsOnMap(c)) r.intent = planRival(c, r);
  crewAim(c);
}

// ---------------------------------------------------------------- the phase

function goOut(c: Ctx, r: RivalX): void {
  r.goneOut = true;
  c.ev.push({ type: 'out', id: r.id });
}

function leaveAct(c: Ctx, r: RivalX): void {
  const ex = exitsBy(c, r.at)[0];
  if (!ex) return;
  if (samePos(ex, r.at)) return goOut(c, r);
  const path = approach(c, r.id, r.at, [ex], rivalStats(r).move, true) ?? [];
  walk(c, r.id, r, path);
  if (samePos(r.at, ex)) goOut(c, r);
}

function hostileAct(c: Ctx, r: RivalX): void {
  const st = rivalStats(r);
  const t = nearestHero(c, r);
  if (!t) return;
  if (overwatchCheck(c, r.id, r.at) || !rivalsOnMap(c).includes(r)) return;
  const reach = st.range;
  const inRange = () => within(t.at, r.at, reach) && (reach === 1 || los(c.w, c.d, r.at, t.at));
  if (!inRange()) {
    const spots = reach > 1 ? shootingSpots(c, r, t) : attackSpots(c, t.at, r.id);
    const path = approach(c, r.id, r.at, spots, st.move, true) ?? [];
    walk(c, r.id, r, path);
  }
  if (inRange() && t.hero?.status === 'active') {
    strike(c, r.id, t.id, st.slots, st.chance, st.dmg, r.cls === 'ranger' ? 'Shot' : 'Attack');
  }
}

/** A hired member strikes a monster: its own numbers against the monster's armor. */
function hitMonster(c: Ctx, r: RivalX, id: string): void {
  const m = c.d.monsters.find((x) => x.id === id);
  if (!m) return;
  const st = rivalStats(r);
  const bolt = r.cls === 'pyromancer' && (r.charges ?? 0) > 0 && distance(m.at, r.at) <= PYRO_BOLT_RANGE;
  const slots = bolt ? PYRO_BOLT_SLOTS : st.slots;
  const dmg = bolt ? PYRO_BOLT_DMG : st.dmg;
  if (bolt) r.charges = (r.charges ?? 1) - 1;
  const rr = roll(c, r.id, bolt ? 'Firebolt' : r.cls === 'ranger' ? 'Shot' : 'Attack', slots, bolt ? PYRO_BOLT_CHANCE : st.chance);
  makeNoise(c, r.at, bolt ? PYRO_BOLT_NOISE : 2);
  if (!rr.hits) {
    c.ev.push({ type: 'miss', attacker: r.id, target: m.id });
    return;
  }
  hurtAny(c, m.id, rr.hits * Math.max(1, dmg - monsterArmor(c, m)) + (rr.perfect ? 1 : 0), r.id, { crit: rr.perfect });
}

function hiredAct(c: Ctx, r: RivalX): void {
  if (overwatchCheck(c, r.id, r.at) || !rivalsOnMap(c).includes(r)) return;
  const plan = hiredPlan(c, r);
  walk(c, r.id, r, plan.path);
  if (plan.intent.kind === 'attack') {
    const ms = monstersInReach(c, r, r.at);
    const m = ms.find((x) => x.id === plan.intent.targetId) ?? ms[0];
    if (m) hitMonster(c, r, m.id);
  }
}

/** The paid job (spec 18.6): walk there, then work the winch or open the lock silently. Returns true if this member did it. */
function jobAct(c: Ctx, r: RivalX): boolean {
  const cr = c.d.rivals!;
  const job = cr.job;
  if (!job?.at || r !== jobber(c)) return false;
  if (!within(r.at, job.at, 1)) {
    const path = approach(c, r.id, r.at, jobSpots(c, r), rivalStats(r).move, true) ?? [];
    walk(c, r.id, r, path);
  }
  if (!within(r.at, job.at, 1)) return true;
  if (job.kind === 'winch') {
    if (!c.d.liftWorking) {
      c.d.liftWorking = true;
      c.ev.push({ type: 'liftWorking' });
      say(c, `${r.name} hauls on the winch. The lift groans awake.`);
      makeNoise(c, r.at, WINCH_NOISE);
    }
  } else if (job.kind === 'open') {
    const at = job.at;
    if (kindAt(c.w, c.d, at) === 'door') {
      const door = doorAt(c.d, at);
      if (door) {
        door.open = true;
        door.locked = false;
        door.jammed = false;
        c.ev.push({ type: 'doorChanged', at, open: true, locked: false });
      }
    } else {
      const ch = c.d.chests.find((x) => samePos(x.at, at) && !x.opened);
      if (ch) {
        ch.opened = true;
        ch.locked = false;
        const items = chestLoot(c, ch.tier);
        putOnGround(c, ch.at, items);
        (cr.spare ??= []).push(ch.id);
        c.ev.push({ type: 'chestOpened', id: ch.id, items });
      }
    }
    say(c, `${r.name} works the lock open without a sound.`);
  }
  cr.job = undefined;
  return true;
}

function lootAct(c: Ctx, r: RivalX): void {
  const cr = c.d.rivals!;
  const g = bestLoot(c, r);
  if (!g) {
    // Nothing left for anyone: time to go. (A member with nothing to do waits for the others.)
    if (!rivalsOnMap(c).some((m) => lootGoals(c, m).length)) cr.goal = 'leave';
    return;
  }
  cr.goal = g.objective ? 'objective' : 'loot';
  if (!within(r.at, g.at, 1)) {
    const spots = [g.at, ...posNeighbors(g.at)].filter((p) => canEnter(c.w, c.d, p) && !blocked(c, p, r.id));
    const before = r.at;
    const path = approach(c, r.id, r.at, spots, rivalStats(r).move, true);
    walk(c, r.id, r, path ?? []);
    if (samePos(before, r.at) && !within(r.at, g.at, 1)) {
      // Stuck: a hero in the way two rounds running makes them angry (not under a truce).
      cr.blocked = (cr.blocked ?? 0) + 1;
      if (cr.blocked >= 2 && cr.spotted && cr.stance === 'neutral') {
        cr.stance = 'hostile';
        c.ev.push({ type: 'rivalsStance', stance: 'hostile' });
        say(c, `"Move, or be moved." ${cr.name} draw steel.`);
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
      noteOnce(c, `${cr.name} took the ${c.w.roomName(ch.at).toLowerCase()} chest.`);
    } else {
      const pile = c.d.ground.find((x) => samePos(x.at, g.at));
      if (pile) {
        items = pile.items;
        pile.items = [];
        c.d.ground = c.d.ground.filter((x) => x.items.length);
      }
      const hl = items.find((i) => i.kind === 'heirloom');
      if (hl) {
        say(c, `${r.name} pockets ${hl.name.replace(/^The /, 'the ')}.`);
        noteOnce(c, `${cr.name} took ${hl.name.replace(/^The /, 'the ')}.`);
      }
    }
    r.loot.push(...items);
    cr.pickups = (cr.pickups ?? 0) + 1;
    c.ev.push({ type: 'looted', id: r.id, items });
  }
}

function postAct(c: Ctx, r: RivalX): void {
  if (!r.post || samePos(r.post, r.at)) return;
  const path = approach(c, r.id, r.at, [r.post], rivalStats(r).move, true) ?? [];
  walk(c, r.id, r, path);
}

/** Spec 18.6: the hired rounds are up. Rich parties may be betrayed; otherwise back to their business. */
function hireEnds(c: Ctx): void {
  const cr = c.d.rivals!;
  cr.hiredRounds = undefined;
  cr.hiredBy = undefined;
  if (partyValue(c) >= BETRAY_LOOT && chance(c.s, BETRAY_CHANCE)) {
    cr.stance = 'hostile';
    c.ev.push({ type: 'betrayed' });
    c.ev.push({ type: 'rivalsStance', stance: 'hostile' });
    say(c, `${cr.name} eye your packs. "Contract's up." They turn their blades on you.`);
    noteOnce(c, `${cr.name} turned on the party when their hire ran out.`);
    return;
  }
  cr.stance = cr.temperament === 'cutthroat' ? 'truce' : 'neutral';
  c.ev.push({ type: 'rivalsStance', stance: cr.stance });
  say(c, `${cr.name}'s hire is up. They go back to their own business.`);
}

export function rivalsAct(c: Ctx): void {
  const cr = c.d.rivals;
  if (!cr) return;
  rivalEnter(c);
  if (!cr.entered) return;
  crewNotice(c);
  // Spec 18.5: a toll not paid by the next world phase is paid in blood.
  if (cr.stance === 'demanding' && (cr.demandRound ?? c.d.round) < c.d.round) {
    cr.stance = 'hostile';
    cr.toll = undefined;
    c.ev.push({ type: 'rivalsStance', stance: 'hostile' });
    say(c, `${cr.name}: "Blood, then."`);
    for (const r of rivalsOnMap(c)) r.intent = undefined;
  }
  if (cr.temperament === 'prospector' && (cr.stance === 'neutral' || cr.stance === 'truce') && cr.goal !== 'leave'
    && ((cr.pickups ?? 0) >= 3 || c.d.light <= SISTERS_LEAVE_LIGHT)) cr.goal = 'leave';
  // Veils from earlier rounds fade (the one cast this phase lasts its full two rounds).
  for (const r of cr.members) if ((r.veil ?? 0) > 0) r.veil! -= 1;
  let jobDone = false;
  for (const r of rivalsOnMap(c)) {
    r.overwatch = false; // an unfired overwatch lapses
    // The kit first, as shown.
    const kit = r.intent && KIT.includes(r.intent.kind) ? r.intent : null;
    if (kit) {
      if (cr.stance === 'hostile' && (overwatchCheck(c, r.id, r.at) || !rivalsOnMap(c).includes(r))) continue;
      if (useKit(c, r, kit)) {
        r.intent = undefined;
        continue;
      }
    }
    if (cr.stance === 'hostile') {
      hostileAct(c, r);
      continue;
    }
    if (cr.stance === 'hired') {
      hiredAct(c, r);
      continue;
    }
    if (cr.stance === 'demanding') continue; // they wait for their answer
    if (!jobDone && cr.job && jobAct(c, r)) {
      jobDone = true;
      continue;
    }
    if (cr.goal === 'leave') {
      leaveAct(c, r);
      continue;
    }
    if (cr.temperament === 'cutthroat') {
      postAct(c, r);
      continue;
    }
    lootAct(c, r);
  }
  if (cr.stance === 'hired' && cr.hiredRounds !== undefined) {
    cr.hiredRounds -= 1;
    if (cr.hiredRounds <= 0) hireEnds(c);
  }
  // Gone?
  for (const r of cr.members) if (r.goneOut && r.loot.length) {
    noteOnce(c, `${cr.name} left with ${valueOf(r.loot)} gold in loot.`);
  }
}
