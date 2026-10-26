// Section 10, 16.5, 18.5 and 20.4: rival crews. The Lantern Sisters (prospectors) race the
// party for loot on Level 1 and turn hostile when attacked or blocked; cutthroat crews (the
// Ferrymen, the Gallows Choir on Level 2; the Wake on Level 3) wait at a choke point and demand
// a toll. V3.7 (spec 20.4): members are built like heroes of their class at the crew's level,
// with tiers and a pack, and a hostile crew fights like a squad (crewai.ts). Paid crews (spec 18.6)
// leave, keep a truce, do a job, or fight beside the party.

import { distance, posKey, posNeighbors, range, samePos, type Pos } from './hex';
import type { Intent, Item } from './types';
import {
  BETRAY_CHANCE, BETRAY_LOOT, BOW_RANGE, CLASSES, CREW_PURSE, CREWS, CUTTHROAT_CHANCE, CUTTHROAT_POOL, CUTTHROAT_SIGHT, CUTTHROAT_TIER,
  HIRE_KEEP, PROSPECTOR_CHANCE, PROSPECTOR_ENTERS, PROSPECTOR_KEEP_OFF, PYRO_BOLT_DMG, PYRO_BOLT_NOISE, PYRO_BOLT_RANGE, PYRO_BOLT_SLOTS, RIVAL_CLASSES,
  SISTERS_LEAVE_LIGHT, WAKE_CHANCE, WINCH_NOISE, BACKSTAB_DMG_MULT, BACKSTAB_SLOTS, BURGLAR_WALK, SAPPER_CHARGES, SNEAK_ATTACK_SLOTS, WALK_MOVE, type CrewDef, type RivalStats,
} from './data';
import { chance, int, pick, random } from './rng';
import { say, type Ctx, type CrewX, type DelveX, type GameStateX, type MonsterX, type RivalX } from './state';
import {
  addToPack, crewDemand, hd, heroName, hurtAny, makeItem, makeNoise, monsterArmor, noteOnce, occupant, onMap, partyValue, putOnGround,
  rivalsOnMap, roll, turnOnHit, valueOf, activeHeroes,
} from './common';
import { canEnter, distField, doorAt, kindAt, los, within, type World } from './world';
import { adjacentTo, attackSpots, blocked, exitsBy, overwatchCheck, strike, targets, type Target } from './ai';
import { faceToward, fleePlan, inFrontHalf, inRearHalf, isSneaking, quietFeet, wouldNotice } from './stealth';
import {
  crewApproach, crewGo, crewOpenChest, crewPickSlots, crewPicker, crewWalk, crewWorkLock, forgetSeenBy, routeIntent, tell, type CrewRoute,
} from './crewmove';
import { satchelName } from './charges';
import { litSet } from './world';
import { KIT, hiredKit, hiredUse, hostileAct, hostilePlan, manaOf, spellChance, useKit } from './crewai';
import { blast } from './charges';
import { checkWays, wayAtEntrance, wayOpen } from './ways';

// ---------------------------------------------------------------- making a crew

/**
 * A member's fighting numbers. V3.7 (spec 20.4): built like a hero of its class at the crew's level:
 * the class weapon's slots and damage, its stat +5 per level above 1 (when it's the class's main
 * stat) +10 per weapon tier, armor plus the armor tier, move 4. Members from V3.5 saves (no `level`)
 * keep the old table with the Level 2 tier.
 */
export function rivalStats(r: RivalX): RivalStats {
  if (r.level !== undefined) {
    const def = CLASSES[r.cls];
    const w = def.weapon;
    const chance = def.stats[w.stat] + (w.stat === def.main ? 5 * (r.level - 1) : 0) + 10 * (r.weaponTier ?? 0);
    // V4.0 (spec 28.1): a member walks as a hero of its class (the Burglar 5); sneaking and dashing: crewmove.ts `crewBudget`.
    const move = r.cls === 'burglar' ? BURGLAR_WALK : WALK_MOVE;
    return { hp: def.hp + 2 * (r.level - 1), slots: w.slots, chance, dmg: w.dmg, move, armor: def.armor + (r.armorTier ?? 0), range: w.range ?? 1 };
  }
  const base = RIVAL_CLASSES[r.cls];
  return (r.tier ?? 1) > 1 ? { ...base, chance: base.chance + CUTTHROAT_TIER.chance } : base;
}

/** The main stat a member rolls with (for the parley card and tests). */
export function rivalLevelStat(r: RivalX): number {
  return rivalStats(r).chance;
}

/** Spec 20.4: a member built as a hero of its class at the crew's level, with the crew's tiers and its pack. */
function member(s: GameStateX, id: string, def: CrewDef, m: CrewDef['members'][number], at: Pos): RivalX {
  const cls = CLASSES[m.cls];
  const hp = cls.hp + 2 * (def.level - 1);
  const r: RivalX = {
    id, crew: def.id, name: m.name, at: { ...at }, hp, maxHp: hp, loot: [], goneOut: false, cls: m.cls,
    level: def.level, weaponTier: def.weaponTier, armorTier: def.armorTier,
    pack: m.pack.map((k) => makeItem({ s }, k)),
    ...(m.cls === 'ranger' ? { overwatch: false } : {}),
    ...(cls.mana ? { charges: cls.mana } : {}),
    ...(m.cls === 'shadowmancer' ? { veil: 0 } : {}),
  };
  // V4.0 (spec 28.6): a crew Sapper brings improvised explosives like a hero Sapper (3, slotless, its own kit).
  if (m.cls === 'sapper') r.pack!.unshift({ ...makeItem({ s }, 'improvised-charge', SAPPER_CHARGES, satchelName(SAPPER_CHARGES)), slots: 0 });
  return r;
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

/** The purse each member carries (spec 20.4: 30 gold at level 2-3, 50 at level 4), dropped when killed. */
function purse(s: GameStateX, def: CrewDef): Item {
  return makeItem({ s }, 'gold', CREW_PURSE[def.level] ?? CREW_PURSE[3]!);
}

/** A cutthroat crew from `def` at `post` (members on the free hexes around it), or null if there's no room. */
function postCrew(c: Ctx, def: CrewDef, post: Pos): CrewX | null {
  const spots = spotsAround(c.w, c.d, post, def.members.length, (p) => !!occupant(c, p));
  if (spots.length < def.members.length) return null;
  const crew: CrewX = {
    crew: def.id, name: def.name, temperament: 'cutthroat', stance: 'waiting', goal: 'loot', spotted: false, entersRound: 1,
    members: def.members.map((m, i) => {
      const r = member(c.s, `r${i + 1}`, def, m, spots[i]!);
      r.post = { ...spots[i]! };
      return r;
    }),
    pickups: 0, entered: true,
  };
  for (const r of crew.members) r.loot.push(purse(c.s, def));
  return crew;
}

/**
 * Spec 18.5 and 20.4: which crew this delve draws. A Level 1 contract: the Lantern Sisters, 50%,
 * entering from a rival entrance on round 3..6. Level 2: a cutthroat crew from the pool, 60%,
 * waiting from round 1 at a post on Level 2. Level 3: the Wake, 60%, at a post on Level 3 (the
 * pool on Level 2 when the castle has no Level 3 posts). Never two crews.
 */
export function makeCrew(w: World, s: GameStateX, d: DelveX, level: number, partyEntrance?: Pos): CrewX | null {
  const c: Ctx = { w, s, d, ev: [] };
  if (level <= 1) {
    // Spec 23.2: never within 6 of the party's own way in. V4.0 (spec 25.4): either rival way in, by the
    // dice (shut or not: the Sisters make their own entrance).
    const ways = w.castle.rivalEntrances.filter((p) => !partyEntrance || distance(p, partyEntrance) > PROSPECTOR_KEEP_OFF);
    if (!ways.length || random(s) >= PROSPECTOR_CHANCE) return null;
    const at = pick(s, ways);
    const def = CREWS['lantern-sisters'];
    const members = def.members.map((m, i) => member(s, `r${i + 1}`, def, m, at));
    // V4.0 (spec 25.4): coming by a barred gate, the Burglar sister carries its key.
    const way = wayAtEntrance(w.castle, at);
    if (way?.kind === 'gate' && !wayOpen(s, way.id)) {
      const b = members.find((r) => r.cls === 'burglar') ?? members[0]!;
      (b.pack ??= []).push(makeItem({ s }, 'gatekey'));
    }
    return {
      crew: def.id, name: def.name, temperament: 'prospector', stance: 'neutral', goal: 'loot', spotted: false,
      entersRound: int(s, PROSPECTOR_ENTERS[0], PROSPECTOR_ENTERS[1]),
      members,
      pickups: 0, entered: false,
    };
  }
  const posts = w.castle.rivalPosts ?? [];
  const l3 = posts.filter((p) => p.level === 3);
  if (level >= 3 && l3.length) {
    if (random(s) >= WAKE_CHANCE) return null;
    return postCrew(c, CREWS['the-wake'], pick(s, l3));
  }
  const l2 = posts.filter((p) => p.level === 2);
  if (!l2.length || random(s) >= CUTTHROAT_CHANCE) return null;
  return postCrew(c, CREWS[pick(s, CUTTHROAT_POOL)], pick(s, l2));
}

/** A crew of `id` standing on `spots` (for tests and fixtures): cutthroats waiting with posts and purses. */
export function buildCrew(s: GameStateX, id: CrewX['crew'], spots: Pos[]): CrewX {
  const def = CREWS[id];
  const cut = def.temperament === 'cutthroat';
  const crew: CrewX = {
    crew: def.id, name: def.name, temperament: def.temperament, stance: cut ? 'waiting' : 'neutral', goal: 'loot', spotted: false, entersRound: 1,
    members: def.members.map((m, i) => {
      const r = member(s, `r${i + 1}`, def, m, spots[i] ?? spots[0]!);
      if (cut) r.post = { ...r.at };
      return r;
    }),
    pickups: 0, entered: true,
  };
  if (cut) for (const r of crew.members) r.loot.push(purse(s, def));
  return crew;
}

// ---------------------------------------------------------------- entering (prospectors)

function rivalEnter(c: Ctx): void {
  const cr = c.d.rivals;
  if (!cr || cr.entered || c.d.round < cr.entersRound) return;
  const at = cr.members[0]!.at;
  // Spec 23.2: they don't walk in on top of the party; wait while a hero is near their way in.
  if (activeHeroes(c).some((h) => h.at.level === at.level && distance(h.at, at) <= PROSPECTOR_KEEP_OFF)) return;
  makeEntrance(c, cr, at);
  const spots = spotsAround(c.w, c.d, at, cr.members.length, (p) => !!occupant(c, p));
  if (spots.length < cr.members.length) return; // blocked: try next round
  cr.entered = true;
  cr.members.forEach((r, i) => (r.at = spots[i]!));
  c.ev.push({ type: 'rivalsEnter', at });
  say(c, 'Lanterns at the door. Someone else is here.');
}

/**
 * V4.0 (spec 25.4): a crew coming by a shut way makes its own entrance. By a barred gate the member
 * with its key unlocks it (silently; the key stays in her pack) and the crew bars it again behind
 * itself (relockGate): the gate stays shut for the party until a hero brings the key to it, carries it
 * out, or blasts it. By rubble they blast it open from outside (a real blast, noise 8): open for good.
 */
function makeEntrance(c: Ctx, cr: CrewX, at: Pos): void {
  const way = wayAtEntrance(c.w.castle, at);
  if (!way || wayOpen(c.s, way.id)) return;
  if (way.kind === 'gate') {
    const keyed = cr.members.find((r) => r.pack?.some((i) => i.kind === 'gatekey'));
    if (!keyed) return;
    for (const p of way.at) {
      const door = doorAt(c.d, p);
      if (!door) continue;
      door.open = true;
      door.locked = false;
      door.jammed = false;
      c.ev.push({ type: 'doorChanged', at: p, open: true, locked: false });
    }
    c.w.fixedCache = null;
    c.d.gateHeld = true;
    say(c, `A key turns in the sally port's bar. ${cr.name} let themselves in.`);
  } else {
    const by = (cr.members.find((r) => r.cls === 'burglar') ?? cr.members[0]!).id;
    say(c, `${cr.name} set a charge in the rubble of the east breach.`);
    // Blast the heap nearest the exit, then any still standing, until the way is clear.
    for (let i = 0; i < way.at.length && !c.d.ways?.[way.id]; i++) {
      const left = way.at.filter((p) => kindAt(c.w, c.d, p) === 'cracked').sort((a, b) => distance(a, at) - distance(b, at));
      if (!left.length) break;
      blast(c, left[0]!, by);
    }
  }
  checkWays(c);
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
  // V4.0 (spec 28.3): a locked chest is no longer free: it is left to the crew's lockpicker while one is about (others smash).
  const picker = crewPicker(c);
  for (const ch of c.d.chests) {
    if (ch.opened || ch.jammed) continue;
    if (ch.locked && picker && crewPickSlots(r) === null) continue;
    out.push({ at: ch.at, chestId: ch.id, objective: false });
  }
  for (const g of c.d.ground) {
    // V4.0 (spec 25.2): a pile holding only the sally port key is worth nothing to a prospector.
    if (!g.items.length || g.items.every((i) => i.kind === 'gatekey')) continue;
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
export function heroesInSight(c: Ctx, r: RivalX, n: number): Target[] {
  return targets(c)
    .filter((t) => t.hero && within(t.at, r.at, n) && los(c.w, c.d, r.at, t.at))
    .sort((a, b) => distance(a.at, r.at) - distance(b.at, r.at) || (a.id < b.id ? -1 : 1));
}

export function nearestHero(c: Ctx, r: RivalX): Target | undefined {
  const ts = targets(c).filter((t) => t.hero);
  const field = distField(c.w, c.d, [r.at], { stairs: true });
  ts.sort((a, b) => (field.get(posKey(a.at)) ?? 999) - (field.get(posKey(b.at)) ?? 999) || (a.id < b.id ? -1 : 1));
  return ts[0];
}

/**
 * Spec 18.5: a waiting cutthroat crew notices the party when an active hero comes within 6 of a
 * member in line of sight (noise is heard in makeNoise). Then they demand the toll.
 */
export function crewNotice(c: Ctx, onlyHero?: string, before?: () => void): void {
  const cr = c.d.rivals;
  if (!cr || cr.temperament !== 'cutthroat' || cr.stance !== 'waiting') return;
  // V3.7 (spec 20.1): a waiting crew notices like an awake monster: by light, sneaking and facing, never beyond 6.
  // V4.0 (spec 26.2): `onlyHero` checks one hero where they stand now (a step of their move); `before` runs once before the first event.
  const lit = litSet(c.w, c.d);
  const ts = targets(c).filter((t) => t.hero && (!onlyHero || t.id === onlyHero));
  let seen = false;
  for (const r of rivalsOnMap(c)) {
    const t = ts.find((x) => within(x.at, r.at, CUTTHROAT_SIGHT) && wouldNotice(c, r, x.at, isSneaking(x.hero!), lit, quietFeet(c, x.id)));
    if (!t) continue;
    if (!seen) before?.();
    seen = true;
    faceToward(r, t.at);
    c.ev.push({ type: 'noticed', by: r.id, hero: t.id, at: { ...t.at }, faced: true });
  }
  if (seen) {
    crewDemand(c);
    crewAim(c);
  }
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

// ---------------------------------------------------------------- the kit (spec 16.5, 18.5, 20.4: crewai.ts)

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
    if (!r.overwatch || !within(r.at, h.at, BOW_RANGE) || !inFrontHalf(r, h.at) || !los(c.w, c.d, r.at, h.at)) continue; // V3.9: front half only
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
export function shootingSpots(c: Ctx, r: RivalX, t: { at: Pos }, reach = BOW_RANGE): Pos[] {
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

/** A hired member's plan: hit a monster in reach, else close in on one near the hirer, else keep up (dashing if need be). */
function hiredPlan(c: Ctx, r: RivalX): { intent: Intent; route: CrewRoute } {
  const st = rivalStats(r);
  const stay: CrewRoute = { path: [], sneak: false, dash: false };
  // Spec 20.4: hired members use their packs for the party.
  const kit = hiredKit(c, r);
  if (kit) return { intent: kit, route: stay };
  const now = monstersInReach(c, r, r.at)[0];
  if (now) return { intent: { kind: 'attack', targetId: now.id, to: { ...r.at } }, route: stay };
  const cr = c.d.rivals!;
  const h = cr.hiredBy ? hd(c, cr.hiredBy) : undefined;
  const near = h ? onMap(c).filter((m) => m.kind !== 'gloam' && m.awareness !== 'asleep' && within(m.at, h.at, 3)) : [];
  if (near.length) {
    const spots = near.flatMap((m) => (st.range > 1 ? shootingSpots(c, r, m, st.range) : attackSpots(c, m.at, r.id)));
    const route = crewApproach(c, r, spots);
    const end = route.path[route.path.length - 1] ?? r.at;
    const m = monstersInReach(c, r, end)[0];
    if (m) return { intent: { kind: 'attack', targetId: m.id, to: end }, route };
  }
  const keep = keepSpots(c, r);
  if (keep.some((p) => samePos(p, r.at)) || !keep.length) return { intent: { kind: 'wait' }, route: stay };
  const route = crewApproach(c, r, keep, { dash: true });
  return { intent: routeIntent(c, route), route };
}

/** Where the paid job takes the crew: next to the winch, or to the locked thing. */
function jobSpots(c: Ctx, r: RivalX): Pos[] {
  const job = c.d.rivals?.job;
  if (!job?.at) return [];
  return posNeighbors(job.at).filter((p) => canEnter(c.w, c.d, p) && kindAt(c.w, c.d, p) !== 'door' && !blocked(c, p, r.id));
}

/** The member who does the job: for a lock, the crew's lockpicker (spec 28.3); else the one nearest to it. */
function jobber(c: Ctx): RivalX | undefined {
  const job = c.d.rivals?.job;
  if (!job?.at) return undefined;
  if (job.kind === 'open') {
    const p = crewPicker(c);
    if (p) return p;
  }
  const field = distField(c.w, c.d, posNeighbors(job.at), { stairs: true });
  return [...rivalsOnMap(c)].sort((a, b) => (field.get(posKey(a.at)) ?? 999) - (field.get(posKey(b.at)) ?? 999) || (a.id < b.id ? -1 : 1))[0];
}

/**
 * V4.0 (spec 28.2): the monster a member fights back against: the one that attacked it this world phase (any
 * stance), or, for a crew at peace (not hired: they fight monsters anyway), a hunting monster next to it that has
 * noticed it. Prospectors stay neutral to the party while they do.
 */
function defendTarget(c: Ctx, r: RivalX): MonsterX | undefined {
  const cr = c.d.rivals!;
  if (cr.stance === 'hired') return undefined;
  const by = r.attackedBy ? onMap(c).find((m) => m.id === r.attackedBy && m.kind !== 'gloam') : undefined;
  if (by && by.at.level === r.at.level) return by;
  if (cr.stance === 'hostile') return undefined;
  return onMap(c)
    .filter((m) => m.kind !== 'gloam' && m.kind !== 'dragon' && m.awareness === 'hunting' && adjacentTo(m.at, r.at) && (m.noticedIds ?? []).includes(r.id))
    .sort((a, b) => a.hp - b.hp || (a.id < b.id ? -1 : 1))[0];
}

/** Can the member hit `m` from `from` (its weapon's reach and a line for a bow)? */
function canHitMonster(c: Ctx, r: RivalX, m: MonsterX, from: Pos): boolean {
  const reach = rivalStats(r).range;
  return m.at.level === from.level && within(m.at, from, reach) && (reach === 1 || los(c.w, c.d, from, m.at));
}

/** V4.0 (spec 28.2): fight back: close in if need be (a walk, no dash) and strike. */
function defendAct(c: Ctx, r: RivalX, m: MonsterX): void {
  if (!canHitMonster(c, r, m, r.at)) {
    const st = rivalStats(r);
    const spots = st.range > 1 ? shootingSpots(c, r, m, st.range) : attackSpots(c, m.at, r.id);
    const route = crewApproach(c, r, spots, { sneak: false });
    crewWalk(c, r, route.path, false);
    if (r.hp <= 0 || r.goneOut) return;
  }
  if (c.d.monsters.includes(m) && canHitMonster(c, r, m, r.at)) {
    tell(c, r, `${r.name} turns on ${m.name}.`, m.at);
    hitMonster(c, r, m.id);
  }
}

/** The loot goal's lock: pick (with lockpicks) or smash, as the intent to show (spec 28.3). */
function lockIntent(c: Ctx, r: RivalX, chestId: string | undefined): Intent | null {
  const ch = chestId ? c.d.chests.find((x) => x.id === chestId) : undefined;
  if (!ch || ch.opened || !ch.locked) return null;
  return { kind: crewPickSlots(r) !== null && !ch.jammed ? 'pick' : 'smash', to: { ...ch.at } };
}

/** The intent a member shows for the coming world phase. */
export function planRival(c: Ctx, r: RivalX): Intent {
  const cr = c.d.rivals!;
  const st = rivalStats(r);
  if ((r.feared ?? 0) > 0) return { kind: 'flee', to: fleePlan(c, r, st.move).to };
  if (r.intent?.kind === 'veil' && !r.veiled && cr.stance !== 'hostile') return r.intent;
  const foe = defendTarget(c, r);
  if (foe) return { kind: 'attack', targetId: foe.id, to: { ...r.at } };
  if (cr.stance === 'hostile') return hostilePlan(c, r).intent;
  if (cr.stance === 'hired') return hiredPlan(c, r).intent;
  if (cr.stance === 'demanding') {
    if (r !== rivalsOnMap(c)[0]) return { kind: 'wait' };
    const t = nearestHero(c, r);
    return { kind: 'toll', ...(t ? { targetId: t.id } : {}), to: { ...r.at } };
  }
  if (cr.job && r === jobber(c)) {
    const spots = jobSpots(c, r);
    if (spots.some((p) => samePos(p, r.at)) || (cr.job.at && adjacentTo(cr.job.at, r.at))) {
      return cr.job.kind === 'open' && cr.job.at ? { kind: 'pick', to: { ...cr.job.at } } : { kind: 'wait' };
    }
    return routeIntent(c, crewApproach(c, r, spots, { dash: true }));
  }
  if (cr.stance === 'waiting') return { kind: 'wait' };
  if (cr.goal === 'leave') {
    const ex = exitsBy(c, r.at)[0];
    if (!ex) return { kind: 'wait' };
    const route = crewApproach(c, r, [ex], { dash: true });
    const it = routeIntent(c, route, { kind: 'flee', to: { ...r.at } });
    return it.kind === 'move' ? { ...it, kind: 'flee' } : it;
  }
  if (cr.temperament === 'cutthroat') {
    // Truce: back to the post and stand.
    if (!r.post || samePos(r.post, r.at)) return { kind: 'wait' };
    return routeIntent(c, crewApproach(c, r, [r.post], { dash: true }));
  }
  const g = bestLoot(c, r);
  if (!g) return { kind: 'wait' };
  if (within(r.at, g.at, 1)) return lockIntent(c, r, g.chestId) ?? { kind: 'steal', to: { ...r.at } };
  const spots = [g.at, ...posNeighbors(g.at)].filter((p) => canEnter(c.w, c.d, p) && !blocked(c, p, r.id));
  return routeIntent(c, crewApproach(c, r, spots, { dash: true }));
}

export function computeRivalIntents(c: Ctx): void {
  const cr = c.d.rivals;
  if (!cr || !cr.entered) return;
  cr.target = undefined; // spec 20.4: one target a round, picked fresh (crewai.currentTarget)
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
  crewGo(c, r, crewApproach(c, r, [ex], { dash: true }));
  if (r.hp > 0 && samePos(r.at, ex)) goOut(c, r);
}

/** V3.7 (spec 20.2): a feared member runs from the caster with its whole move and does nothing else. */
function fleeAct(c: Ctx, r: RivalX): void {
  const f = fleePlan(c, r, rivalStats(r).move);
  r.intent = { kind: 'flee', to: f.to };
  crewWalk(c, r, f.path, false);
}

/**
 * A crew member strikes a monster (hired, or fighting back): its own numbers against the monster's armor. V4.0 (spec
 * 28.5): the heroes' rules: +20 on a sleeper, +1 slot sneak attack on a monster that hasn't noticed it, and a Burglar's
 * backstab from outside its front (+1 slot, double damage before armor; not the Dragon).
 */
export function hitMonster(c: Ctx, r: RivalX, id: string): void {
  const m = c.d.monsters.find((x) => x.id === id);
  if (!m) return;
  const st = rivalStats(r);
  const bolt = r.cls === 'pyromancer' && manaOf(r) > 0 && distance(m.at, r.at) <= PYRO_BOLT_RANGE && los(c.w, c.d, r.at, m.at);
  let slots = bolt ? PYRO_BOLT_SLOTS : st.slots;
  let dmg = bolt ? PYRO_BOLT_DMG : st.dmg;
  let p = bolt ? spellChance(r) : st.chance;
  if (bolt) r.charges = (r.charges ?? 1) - 1;
  faceToward(r, m.at);
  const unnoticed = m.awareness === 'asleep' || !(m.noticedIds ?? []).includes(r.id);
  if (m.awareness === 'asleep') p += 20;
  if (!bolt && unnoticed) slots += SNEAK_ATTACK_SLOTS;
  const stab = !bolt && unnoticed && r.cls === 'burglar' && st.range === 1 && m.kind !== 'dragon' && adjacentTo(m.at, r.at) && inRearHalf(m, r.at);
  if (stab) {
    slots += BACKSTAB_SLOTS;
    dmg *= BACKSTAB_DMG_MULT;
  }
  const rr = roll(c, r.id, bolt ? 'Firebolt' : stab ? 'Backstab' : r.cls === 'ranger' ? 'Shot' : 'Attack', slots, p);
  makeNoise(c, r.at, bolt ? PYRO_BOLT_NOISE : 2, { what: 'clash' });
  if (!rr.hits) {
    c.ev.push({ type: 'miss', attacker: r.id, target: m.id });
    return;
  }
  const total = rr.hits * Math.max(1, dmg - monsterArmor(c, m)) + (rr.perfect ? 1 : 0);
  if (stab) tell(c, r, `${r.name} backstabs ${m.name}: ${total}.`, m.at);
  hurtAny(c, m.id, total, r.id, { crit: rr.perfect, backstab: stab });
  turnOnHit(c, m.id, r.id); // V4.0 (spec 26.3)
}

function hiredAct(c: Ctx, r: RivalX): void {
  if (overwatchCheck(c, r.id, r.at) || !rivalsOnMap(c).includes(r)) return;
  const plan = hiredPlan(c, r);
  if (plan.intent.kind === 'potion' || plan.intent.kind === 'mend') {
    if (hiredUse(c, r, plan.intent)) return;
  }
  crewWalk(c, r, plan.route.path, plan.route.sneak);
  if (r.hp <= 0 || r.goneOut) return;
  if (plan.intent.kind === 'attack') {
    const ms = monstersInReach(c, r, r.at);
    const m = ms.find((x) => x.id === plan.intent.targetId) ?? ms[0];
    if (m) hitMonster(c, r, m.id);
  }
}

/** V4.0 (spec 28.3): give the job's price back to the hero who paid (gold in their pack, else at their feet). */
function refundJob(c: Ctx): number {
  const job = c.d.rivals?.job;
  const h = job?.by ? hd(c, job.by) : undefined;
  const n = job?.price ?? 0;
  if (!n || !h) return 0;
  const left = addToPack(c, h.pack, makeItem(c, 'gold', n));
  if (left) putOnGround(c, h.at, [left]);
  return n;
}

/**
 * The paid job (spec 18.6): walk there, then work the winch or open the lock. V4.0 (spec 28.3): the lock is the
 * crew lockpicker's best attempt by the heroes' rules: every slot: silent, as promised; one short: open, but a clunk
 * (noise 2, said honestly); it holds: they try again next round; it jams: the job can't be done, and the price is
 * handed back. Returns true if this member did it.
 */
function jobAct(c: Ctx, r: RivalX): boolean {
  const cr = c.d.rivals!;
  const job = cr.job;
  if (!job?.at || r !== jobber(c)) return false;
  if (!within(r.at, job.at, 1)) {
    const route = crewApproach(c, r, jobSpots(c, r), { dash: true });
    crewGo(c, r, route);
    if (route.dash) return true;
  }
  if (!within(r.at, job.at, 1) || r.hp <= 0) return true;
  if (job.kind === 'winch') {
    if (!c.d.liftWorking) {
      c.d.liftWorking = true;
      c.ev.push({ type: 'liftWorking' });
      say(c, `${r.name} hauls on the winch. The lift groans awake.`);
      makeNoise(c, r.at, WINCH_NOISE, { what: 'crash' });
    }
  } else if (job.kind === 'open') {
    const at = job.at;
    const door = kindAt(c.w, c.d, at) === 'door';
    if (crewPickSlots(r) === null) {
      const back = refundJob(c);
      say(c, `${r.name} has no picks to do it quietly. ${cr.name} hand back your ${back} gold.`);
    } else {
      const res = crewWorkLock(c, r, at, false, false);
      if (res === 'holds' || res === 'stuck') {
        say(c, `The lock holds against ${r.name}'s picks. They'll try again.`);
        return true;
      }
      if (res === 'jammed') {
        const back = refundJob(c);
        say(c, `${r.name}'s pick snaps in the lock: it's jammed. ${cr.name} hand back your ${back} gold.`);
      } else {
        const ch = door ? undefined : c.d.chests.find((x) => samePos(x.at, at) && !x.opened);
        if (ch) {
          crewOpenChest(c, ch.id, true);
          (cr.spare ??= []).push(ch.id);
        }
        say(c, res === 'clunk' ? `${r.name} works the lock open. Clunk: not quite silent.` : `${r.name} works the lock open without a sound.`);
      }
    }
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
    const route = crewApproach(c, r, spots, { dash: true });
    crewGo(c, r, route);
    if (r.hp <= 0 || r.goneOut) return;
    if (samePos(before, r.at) && !within(r.at, g.at, 1)) {
      // Stuck: a hero in the way two rounds running makes them angry (not under a truce).
      cr.blocked = (cr.blocked ?? 0) + 1;
      if (cr.blocked >= 2 && cr.spotted && cr.stance === 'neutral') {
        cr.stance = 'hostile';
        c.ev.push({ type: 'rivalsStance', stance: 'hostile' });
        say(c, `"Move, or be moved." ${cr.name} draw steel.`);
      }
    } else cr.blocked = 0;
    if (route.dash) return; // a dash spends the action
  }
  if (within(r.at, g.at, 1)) {
    let items: Item[] = [];
    if (g.chestId) {
      const ch = c.d.chests.find((x) => x.id === g.chestId)!;
      // V4.0 (spec 28.3): a locked chest is picked (or smashed) first, by the heroes' rules.
      if (ch.locked) {
        const res = crewWorkLock(c, r, ch.at, crewPickSlots(r) === null);
        if (res !== 'silent' && res !== 'clunk' && res !== 'smashed') return;
      }
      items = crewOpenChest(c, ch.id, false);
      noteOnce(c, `${cr.name} took the ${c.w.roomName(ch.at).toLowerCase()} chest.`);
    } else {
      const pile = c.d.ground.find((x) => samePos(x.at, g.at));
      if (pile) {
        // V4.0 (spec 25.2): the sally port key is left lying (worth nothing to them).
        items = pile.items.filter((i) => i.kind !== 'gatekey');
        pile.items = pile.items.filter((i) => i.kind === 'gatekey');
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
  crewGo(c, r, crewApproach(c, r, [r.post], { dash: true }));
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
  forgetSeenBy(c); // V4.0 (spec 28.5): heroes who no longer see a member lose track of her
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
  // Veils and wards from earlier rounds fade (the one cast this phase lasts its full two rounds).
  for (const r of cr.members) {
    if ((r.veil ?? 0) > 0) r.veil! -= 1;
    if ((r.ward ?? 0) > 0) r.ward! -= 1;
  }
  let jobDone = false;
  for (const r of rivalsOnMap(c)) {
    if (!rivalsOnMap(c).includes(r)) continue;
    if ((r.feared ?? 0) > 0) {
      r.overwatch = false;
      fleeAct(c, r);
      continue;
    }
    // V4.0 (spec 28.2): a member a monster attacked (or, at peace, one a hunting monster stands over) fights it.
    const foe = defendTarget(c, r);
    if (foe) {
      r.overwatch = false;
      defendAct(c, r, foe);
      continue;
    }
    if (cr.stance === 'hostile') {
      hostileAct(c, r);
      continue;
    }
    r.overwatch = false; // an unfired overwatch lapses
    // The kit first, as shown (a prospector's veil, a potion).
    const kit = r.intent && KIT.includes(r.intent.kind) ? r.intent : null;
    if (kit && (kit.kind === 'veil' || kit.kind === 'potion') && useKit(c, r, kit)) {
      r.intent = undefined;
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
  for (const r of cr.members) r.attackedBy = undefined;
  // Gone?
  for (const r of cr.members) if (r.goneOut && r.loot.length) {
    noteOnce(c, `${cr.name} left with ${valueOf(r.loot)} gold in loot.`);
  }
}
