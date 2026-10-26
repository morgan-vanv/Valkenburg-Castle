// Shared delve helpers: lookups, occupancy, rolls, damage, noise, loot.

import { distance, posKey, samePos, type Pos } from './hex';
import type { Brightness, Hero, HeroInDelve, Item, ItemKind, SlotRoll } from './types';
import {
  BLEED_START, BRACE_CHANCE, BRACE_DMG, CLASSES, CUTTHROAT_HEAR, FIRESIDE_HEAL, FOCUS_MAX, RESERVE_FOCUS, DRAGON_WAKE_NOISE, GEMS, JEWELRY, MONSTERS, PACK_SLOTS, SEARCH_ROUNDS,
  SHIELD_BRACED_DMG, SHIELD_DMG, SLAY_XP, TIERS, TOLL_MIN, WAKE_END_SNEAK,
} from './data';
import { chance, int, pick, random } from './rng';
import { newItemId, say, type Ctx, type MonsterX, type RivalX } from './state';
import { brightnessOf, litSet, noiseField, within, type World } from './world';
import { faceToward, forgetHeroes, noticeHero } from './stealth';
import { CLASH_HEAR, hearLoud, type LoudWhat } from './hearing';

// ---------------------------------------------------------------- lookups

export function heroDef(c: Ctx, id: string): Hero | undefined {
  return c.s.campaign.roster.find((h) => h.id === id);
}

export function hd(c: Ctx, id: string): HeroInDelve | undefined {
  return c.d.heroes.find((h) => h.heroId === id);
}

export function heroName(c: Ctx, id: string): string {
  return heroDef(c, id)?.name ?? id;
}

export function nameOf(c: Ctx, id: string): string {
  const m = c.d.monsters.find((x) => x.id === id);
  if (m) return m.name;
  const r = c.d.rivals?.members.find((x) => x.id === id);
  if (r) return r.name;
  if (c.d.prisoner?.id === id) return c.d.prisoner.name;
  return heroName(c, id);
}

export function armorOf(h: Hero): number {
  return CLASSES[h.cls].armor + h.armorTier;
}

/** Spec 18.4: Hobart's Reserve raises the Focus max to 4. */
export function focusMax(h: HeroInDelve): number {
  return h.ale === 'reserve' ? RESERVE_FOCUS : FOCUS_MAX;
}

/** Spec 18.4: Fireside Porter heals 3 each time the drinker changes level (call after any fall damage). */
export function levelHeal(c: Ctx, h: HeroInDelve): void {
  if (h.ale !== 'fireside' || h.status !== 'active') return;
  const max = heroDef(c, h.heroId)?.maxHp ?? h.hp;
  if (h.hp >= max) return;
  const before = h.hp;
  h.hp = Math.min(max, h.hp + FIRESIDE_HEAL);
  say(c, `${heroName(c, h.heroId)} feels the Fireside Porter: +${h.hp - before} HP.`);
}

export function activeHeroes(c: Ctx): HeroInDelve[] {
  return c.d.heroes.filter((h) => h.status === 'active');
}

/** Monsters on the map: buried ghouls (spec 16.4) are not there until they rise. */
export function onMap(c: Ctx): MonsterX[] {
  return c.d.monsters.filter((m) => !m.buried);
}

/** A monster's fighting numbers with its spawn tier (spec 16.3). */
export function monsterStats(m: MonsterX): { slots: number; chance: number; dmg: number; move: number; armor: number } {
  const def = MONSTERS[m.kind];
  const t = TIERS[m.tier ?? 1] ?? TIERS[1]!;
  return { slots: def.slots, chance: def.chance + t.chance, dmg: def.dmg + t.dmg, move: def.move, armor: def.armor ?? 0 };
}

/** Armor against a hero's hit: the kind's armor plus the captain's shield wall (orcs and archers next to a captain, 16.4). */
export function monsterArmor(c: Ctx, m: MonsterX): number {
  let a = MONSTERS[m.kind].armor ?? 0;
  if (shieldWalled(c, m)) a += 1;
  return a;
}

export function shieldWalled(c: Ctx, m: MonsterX): boolean {
  if (m.kind !== 'orc' && m.kind !== 'archer') return false;
  return onMap(c).some((x) => x.kind === 'captain' && x !== m && x.at.level === m.at.level && distance(x.at, m.at) === 1);
}

// ---------------------------------------------------------------- occupancy

/** Who stands at p: a hero (active/downed), monster, rival on the map, or the prisoner. */
export function occupant(c: Ctx, p: Pos): { kind: 'hero' | 'monster' | 'rival' | 'prisoner'; id: string } | null {
  for (const m of c.d.monsters) if (!m.buried && samePos(m.at, p)) return { kind: 'monster', id: m.id };
  for (const r of rivalsOnMap(c)) if (samePos(r.at, p)) return { kind: 'rival', id: r.id };
  for (const h of c.d.heroes) {
    if ((h.status === 'active' || h.status === 'downed') && samePos(h.at, p)) return { kind: 'hero', id: h.heroId };
  }
  const pr = c.d.prisoner;
  if (pr && !pr.out && !pr.dead && samePos(pr.at, p)) return { kind: 'prisoner', id: pr.id };
  return null;
}

export function rivalsOnMap(c: Ctx) {
  const cr = c.d.rivals;
  if (!cr || !cr.entered) return [];
  return cr.members.filter((r) => !r.goneOut && r.hp > 0);
}

export function monsterAt(c: Ctx, p: Pos): MonsterX | undefined {
  return c.d.monsters.find((m) => !m.buried && samePos(m.at, p));
}

// ---------------------------------------------------------------- light

/** Brightness a hero acts at: the lantern's level, at least Dark when outside all light. */
export function brightnessAt(w: World, c: Ctx, at: Pos, lit?: Set<string>): Brightness {
  const g = brightnessOf(c.d.light);
  const L = lit ?? litSet(w, c.d);
  if (L.has(posKey(at))) return g === 'pitch' ? 'dark' : g;
  return g === 'pitch' ? 'pitch' : 'dark';
}

export const LIGHT_PENALTY: Record<Brightness, number> = { bright: 0, dim: -10, dark: -20, pitch: -30 };

/** V3.6 (spec 19.3): the hero has the night-eye draught in them: no dark penalties to sight or rolls. */
export function nightEyed(h: HeroInDelve): boolean {
  return (h.nightEyes ?? 0) > 0 && h.status === 'active';
}

/** The brightness penalty to this hero's rolls: by the light they stand in, 0 with night-eye. */
export function lightPenaltyFor(w: World, c: Ctx, h: HeroInDelve, lit?: Set<string>): number {
  if (nightEyed(h)) return 0;
  return LIGHT_PENALTY[brightnessAt(w, c, h.at, lit)];
}

// ---------------------------------------------------------------- rolls

export function clampChance(p: number): number {
  return Math.max(5, Math.min(95, Math.round(p)));
}

/** Roll `slots` at `p`%, `focus` slots locked as hits first. Emits a roll event. */
export function roll(c: Ctx, who: string, what: string, slots: number, p: number, focus = 0): SlotRoll {
  const ch = clampChance(p);
  const f = Math.max(0, Math.min(focus, slots));
  const results: boolean[] = [];
  for (let i = 0; i < slots; i++) results.push(i < f ? true : chance(c.s, ch));
  const hits = results.filter(Boolean).length;
  const r: SlotRoll = { slots, chance: ch, focus: f, results, hits, perfect: slots > 0 && hits === slots };
  c.ev.push({ type: 'roll', who, what, roll: r });
  return r;
}

// ---------------------------------------------------------------- items

const SINGLE: Record<ItemKind, string> = {
  gold: 'Gold', gem: 'Gem', jewelry: 'Jewelry', torch: 'Torch', potion: 'Potion', rope: 'Rope',
  charge: 'Blasting charge', heirloom: 'Heirloom', hoard: 'Hoard',
  smoke: 'Smoke bomb', glue: 'Glue bomb', dart: 'Sleep dart', caltrops: 'Caltrops', hook: 'Grappling hook',
  key: 'Skeleton key', oil: 'Oil flask', firecracker: 'Firecracker',
  lockpicks: 'Lockpicks', improvised: 'Improvised pick', nightsight: 'Night-eye draught',
  gatekey: 'Sally port key',
};

export function makeItem(c: { s: Ctx['s'] }, kind: ItemKind, amount = 1, name?: string): Item {
  return {
    id: newItemId(c.s),
    kind,
    name: name ?? (kind === 'gold' ? `${amount} gold` : SINGLE[kind]),
    amount: kind === 'gatekey' ? 0 : amount, // V4.0 (spec 25.2): the sally key is worth nothing
    slots: kind === 'heirloom' || kind === 'hoard' ? 2 : 1,
  };
}

export function packUsed(pack: Item[]): number {
  return pack.reduce((n, i) => n + i.slots, 0);
}

/** Put item into pack if it fits (gold merges into stacks up to 100). Returns leftover or null. */
export function addToPack(c: Ctx, pack: Item[], item: Item): Item | null {
  if (item.kind === 'gold') {
    let left = item.amount;
    for (const g of pack) {
      if (g.kind !== 'gold' || g.amount >= 100) continue;
      const n = Math.min(100 - g.amount, left);
      g.amount += n;
      g.name = `${g.amount} gold`;
      left -= n;
      if (!left) return null;
    }
    while (left > 0 && packUsed(pack) < PACK_SLOTS) {
      const n = Math.min(100, left);
      pack.push(n === item.amount ? item : makeItem(c, 'gold', n));
      if (n === item.amount) {
        item.name = `${n} gold`;
      }
      left -= n;
    }
    if (left <= 0) return null;
    return { ...item, amount: left, name: `${left} gold` };
  }
  if (packUsed(pack) + item.slots > PACK_SLOTS) return item;
  pack.push(item);
  return null;
}

export function putOnGround(c: Ctx, at: Pos, items: Item[]): void {
  if (!items.length) return;
  const g = c.d.ground.find((x) => samePos(x.at, at));
  if (g) g.items.push(...items);
  else c.d.ground.push({ at, items: [...items] });
}

export function cleanGround(c: Ctx): void {
  c.d.ground = c.d.ground.filter((g) => g.items.length > 0);
}

/** Chest loot roll: d6 + tier. */
export function chestLoot(c: Ctx, tier: number): Item[] {
  const r = int(c.s, 1, 6) + tier;
  const T = tier;
  if (r <= 3) return [makeItem(c, 'gold', int(c.s, 15 * T, 30 * T))];
  if (r <= 5) {
    const extra = random(c.s) < 0.5 ? makeItem(c, 'torch') : makeItem(c, 'potion');
    return [makeItem(c, 'gold', int(c.s, 25 * T, 50 * T)), extra];
  }
  if (r <= 7) return [makeItem(c, 'gem', int(c.s, 40 * T, 80 * T), pick(c.s, GEMS))];
  return [makeItem(c, 'jewelry', int(c.s, 80 * T, 140 * T), pick(c.s, JEWELRY))];
}

export function valueOf(items: { kind: string; amount: number }[]): number {
  let v = 0;
  for (const i of items) if (i.kind === 'gold' || i.kind === 'gem' || i.kind === 'jewelry' || i.kind === 'heirloom' || i.kind === 'hoard') v += i.amount;
  return v;
}

// ---------------------------------------------------------------- damage

export function passLanternIfNeeded(c: Ctx): void {
  const b = hd(c, c.d.lanternBearer);
  if (b && b.status === 'active') return;
  const from = b?.at;
  const cands = activeHeroes(c);
  if (!cands.length) return;
  const far = (p: Pos) => (from && p.level === from.level ? distance(p, from) : 99);
  cands.sort((x, y) => far(x.at) - far(y.at));
  c.d.lanternBearer = cands[0]!.heroId;
  say(c, `${heroName(c, cands[0]!.heroId)} takes the lantern.`);
}

export function killHero(c: Ctx, h: HeroInDelve): void {
  h.status = 'dead';
  h.hp = 0;
  (c.d.diedAt ??= {})[h.heroId] = { ...h.at };
  c.ev.push({ type: 'died', id: h.heroId });
  say(c, `${heroName(c, h.heroId)} is dead.`);
  const drop = h.pack;
  (c.d.lostIds ??= []).push(...drop.filter((i) => i.kind !== 'heirloom').map((i) => i.id));
  putOnGround(c, h.at, drop);
  h.pack = [];
  if (h.escorting && c.d.prisoner) c.d.prisoner.escortedBy = undefined;
  h.escorting = undefined;
  // V3.7 (spec 20.4): a member dragging them lets go.
  for (const r of c.d.rivals?.members ?? []) if (r.dragging === h.heroId) r.dragging = undefined;
  // The lantern drops with them; the nearest active hero picks it up.
  if (c.d.lanternBearer === h.heroId) passLanternIfNeeded(c);
}

/** Damage a hero (already reduced by armor). Active → downed at 0; downed → dead. */
export function hurtHero(c: Ctx, h: HeroInDelve, dmg: number, by: string, crit = false): void {
  if (h.status === 'active') {
    h.hp -= dmg;
    c.ev.push({ type: 'hit', attacker: by, target: h.heroId, damage: dmg, crit });
    if (h.hp <= 0) {
      h.hp = 0;
      h.status = 'downed';
      h.bleed = BLEED_START;
      c.ev.push({ type: 'downed', id: h.heroId });
      say(c, `${heroName(c, h.heroId)} goes down.`);
      if (h.escorting && c.d.prisoner) c.d.prisoner.escortedBy = undefined;
      h.escorting = undefined;
      if (h.guarding) h.guarding = undefined;
      if (c.d.lanternBearer === h.heroId) passLanternIfNeeded(c);
    }
  } else if (h.status === 'downed') {
    c.ev.push({ type: 'hit', attacker: by, target: h.heroId, damage: dmg, crit });
    killHero(c, h);
  }
}

export function hurtPrisoner(c: Ctx, dmg: number, by: string): void {
  const p = c.d.prisoner;
  if (!p || p.dead || p.out) return;
  p.hp -= dmg;
  c.ev.push({ type: 'hit', attacker: by, target: p.id, damage: dmg, crit: false });
  if (p.hp <= 0) {
    p.hp = 0;
    p.dead = true;
    if (p.escortedBy) {
      const e = hd(c, p.escortedBy);
      if (e) e.escorting = undefined;
    }
    p.escortedBy = undefined;
    c.ev.push({ type: 'died', id: p.id });
    say(c, `${p.name} is dead. So is the contract.`);
    noteOnce(c, `${p.name} died in the castle.`);
  }
}

export function noteOnce(c: Ctx, text: string): void {
  const n = (c.d.notes ??= []);
  if (!n.includes(text)) n.push(text);
}

export function killMonster(c: Ctx, m: MonsterX, by: string | null): void {
  c.d.monsters = c.d.monsters.filter((x) => x !== m);
  c.ev.push({ type: 'monsterDied', id: m.id });
  if (m.holding) releaseHold(c, m);
  if (m.stolen) {
    putOnGround(c, m.at, [m.stolen]);
    say(c, `${m.name} drops the ${m.stolen.name.toLowerCase()}.`);
  }
  if (by && hd(c, by)) {
    c.d.kills[by] = (c.d.kills[by] ?? 0) + 1;
    (c.d.xp ??= {})[by] = (c.d.xp[by] ?? 0) + (m.kind === 'gloam' ? 0 : MONSTERS[m.kind].xp);
  }
  if (m.kind === 'dragon') {
    c.d.dragonSlain = true;
    say(c, `${m.name} is dead. The Hollow goes quiet.`);
    noteOnce(c, `${m.name} was slain.`);
    // Kill XP split among every hero in the delve; the remainder to the killer.
    const xs = (c.d.xp ??= {});
    const n = c.d.heroes.length;
    const each = Math.floor(SLAY_XP / n);
    for (const h of c.d.heroes) xs[h.heroId] = (xs[h.heroId] ?? 0) + each;
    const rest = SLAY_XP - each * n;
    const who = by && hd(c, by) ? by : c.d.heroes[0]!.heroId;
    xs[who] = (xs[who] ?? 0) + rest;
  }
}

/** A ghoul lets go of the hero it holds (spec 16.4). */
export function releaseHold(c: Ctx, m: MonsterX): void {
  const id = m.holding;
  m.holding = undefined;
  if (!id) return;
  const h = hd(c, id);
  if (h && h.grabbedBy === m.id) {
    h.grabbedBy = undefined;
    c.ev.push({ type: 'released', id });
    say(c, `${heroName(c, id)} is free of ${m.name}'s grip.`);
  }
}

/** Holds that no longer make sense (the ghoul is gone, moved away, or the hero is down) are released. */
export function checkHolds(c: Ctx): void {
  for (const m of c.d.monsters) {
    if (!m.holding) continue;
    const h = hd(c, m.holding);
    if (!h || h.status !== 'active' || h.at.level !== m.at.level || distance(h.at, m.at) !== 1) releaseHold(c, m);
  }
  for (const h of c.d.heroes) {
    if (!h.grabbedBy) continue;
    const m = c.d.monsters.find((x) => x.id === h.grabbedBy);
    if (!m || m.holding !== h.heroId) {
      h.grabbedBy = undefined;
      c.ev.push({ type: 'released', id: h.heroId });
    }
  }
}

/** Damage to any creature by id (monster, rival, prisoner, hero). Hero damage here ignores armor. */
export function hurtAny(c: Ctx, id: string, dmg: number, by: string | null, opts: { crit?: boolean; noise?: boolean; backstab?: boolean } = {}): void {
  const m = c.d.monsters.find((x) => x.id === id);
  if (m) {
    if (m.kind === 'gloam') return;
    m.hp -= dmg;
    c.ev.push({ type: 'hit', attacker: by ?? 'blast', target: m.id, damage: dmg, crit: !!opts.crit, ...(opts.backstab ? { backstab: true } : {}) });
    if (m.awareness !== 'hunting') {
      const src = by ? hd(c, by) : undefined;
      goHunting(c, m, src?.at);
    }
    // V3.7 (spec 20.1): hit by a hero, it knows them now (no more sneak attacks from that one).
    if (by && hd(c, by)) noticeHero(c, m, by);
    if (opts.noise !== false) hearLoud(c, m.at, CLASH_HEAR, 'scream');
    if (m.hp <= 0) {
      killMonster(c, m, by);
      if (opts.noise !== false) makeNoise(c, m.at, 2);
    }
    return;
  }
  let r = c.d.rivals?.members.find((x) => x.id === id);
  if (r) {
    // V3.7 (spec 20.4): the Sellsword guarding this member, standing beside it, takes the hit instead.
    const g = rivalGuard(c, r);
    if (g) {
      say(c, `${g.name} steps in front of ${r.name}.`);
      r = g;
    }
    r.hp -= dmg;
    c.ev.push({ type: 'hit', attacker: by ?? 'blast', target: r.id, damage: dmg, crit: !!opts.crit, ...(opts.backstab ? { backstab: true } : {}) });
    if (opts.noise !== false) hearLoud(c, r.at, CLASH_HEAR, 'scream');
    if (by && hd(c, by)) makeHostile(c);
    if (r.hp <= 0) {
      r.hp = 0;
      c.ev.push({ type: 'monsterDied', id: r.id });
      say(c, `${r.name} falls.`);
      // Spec 20.4: spoils: the purse and loot, and the pack. A dragged hero is dropped where they lie.
      putOnGround(c, r.at, [...r.loot, ...(r.pack ?? [])]);
      r.loot = [];
      r.pack = r.pack ? [] : r.pack;
      dropCaptive(c, r, 'falls');
      if (by && hd(c, by)) {
        c.d.kills[by] = (c.d.kills[by] ?? 0) + 1;
        (c.d.xp ??= {})[by] = (c.d.xp[by] ?? 0) + 1;
      }
      if (opts.noise !== false) makeNoise(c, r.at, 2);
    }
    return;
  }
  if (c.d.prisoner?.id === id) return hurtPrisoner(c, dmg, by ?? 'blast');
  const h = hd(c, id);
  if (h) hurtHero(c, h, dmg, by ?? 'blast', !!opts.crit);
}

/** Attacked (or told to fight): the crew turns hostile; a paid crew keeps what it was paid (spec 18.6). */
export function makeHostile(c: Ctx): void {
  const cr = c.d.rivals;
  if (!cr || cr.stance === 'hostile') return;
  const paid = cr.stance === 'bribed' || cr.stance === 'truce' || cr.stance === 'hired';
  cr.stance = 'hostile';
  cr.toll = undefined;
  cr.hiredRounds = undefined;
  cr.hiredBy = undefined;
  cr.job = undefined;
  for (const r of cr.members) if (r.intent?.kind === 'toll') r.intent = undefined;
  c.ev.push({ type: 'rivalsStance', stance: 'hostile' });
  say(c, paid ? `${cr.name} keep your coin and draw steel.` : `${cr.name} draw steel.`);
}

/** V3.7 (spec 20.4): the living Sellsword guarding `r` from an adjacent hex, if any. */
export function rivalGuard(c: Ctx, r: { id: string; at: Pos }): RivalX | undefined {
  return rivalsOnMap(c).find((g) => g.id !== r.id && g.guarding === r.id && g.at.level === r.at.level && distance(g.at, r.at) === 1);
}

/** V3.7 (spec 20.4): the member lets go of the hero it was dragging (killed, downed or feared); the hero stays downed where they lie. */
export function dropCaptive(c: Ctx, r: RivalX, why: string): void {
  const id = r.dragging;
  if (!id) return;
  r.dragging = undefined;
  const h = hd(c, id);
  if (h && h.status === 'downed') say(c, `${r.name} ${why}. ${heroName(c, id)} is dropped where they lie.`);
}

/** Gold value the party carries (every active or downed hero's pack): gold and valuables. */
export function partyValue(c: Ctx): number {
  return valueOf(c.d.heroes.filter((h) => h.status === 'active' || h.status === 'downed').flatMap((h) => h.pack.filter((i) => !i.story)));
}

/** Round to the nearest 5. */
export function round5(n: number): number {
  return Math.round(n / 5) * 5;
}

/**
 * Spec 18.5: a waiting cutthroat crew has noticed the party: they demand the toll (the larger of
 * 50 and half the gold value carried, rounded to 5) and won't attack this world phase; at the
 * next one, unpaid, they turn hostile.
 */
export function crewDemand(c: Ctx): void {
  const cr = c.d.rivals;
  if (!cr || cr.temperament !== 'cutthroat' || cr.stance !== 'waiting') return;
  cr.stance = 'demanding';
  cr.spotted = true;
  cr.toll = Math.max(TOLL_MIN, round5(partyValue(c) / 2));
  cr.demandRound = c.d.round;
  c.ev.push({ type: 'rivalsStance', stance: 'demanding' });
  const lead = rivalsOnMap(c)[0];
  if (lead) lead.intent = { kind: 'toll', to: { ...lead.at } };
  for (const r of rivalsOnMap(c)) if (r !== lead) r.intent = { kind: 'wait' };
  say(c, `${lead?.name ?? cr.name}: "Your gold or your blood." ${cr.name} want ${cr.toll} gold, or they attack.`);
}

// ---------------------------------------------------------------- noise

/**
 * A ripple of radius R at `at`. Wakes sleepers, draws alert monsters, turns heads (spec 20.1).
 * `quiet`: no `noise` event for the view (per-hex walking noise sends one event per move).
 */
export function makeNoise(c: Ctx, at: Pos, radius: number, opts: { otherLevels?: boolean; quiet?: boolean; what?: LoudWhat } = {}): void {
  if (radius <= 0) return;
  if (!opts.quiet) c.ev.push({ type: 'noise', at, radius });
  // V3.9.3 (spec 24.8): an unseen enemy's noise is heard by the heroes (`what` marks an enemy source).
  if (opts.what) hearLoud(c, at, radius, opts.what, { otherLevels: opts.otherLevels });
  const heard = noiseField(c.w, c.d, at, radius);
  // Spec 18.5: a waiting cutthroat crew hears noise of 4 or more.
  if (radius >= CUTTHROAT_HEAR && c.d.phase === 'player' && c.d.rivals?.stance === 'waiting' && rivalsOnMap(c).some((r) => heard.has(posKey(r.at)))) crewDemand(c);
  for (const m of c.d.monsters) {
    if (m.kind === 'gloam' || m.buried) continue;
    let hears = heard.has(posKey(m.at));
    if (!hears && opts.otherLevels && Math.abs(m.at.level - at.level) === 1) hears = distance(m.at, at) <= radius;
    if (!hears) continue;
    // V4.0 (spec 26.3): an unaware monster turns toward the noise; a hunting one keeps its facing.
    if (m.awareness !== 'hunting') faceToward(m, at);
    if (m.kind === 'dragon') {
      if (m.awareness === 'asleep' && radius >= DRAGON_WAKE_NOISE) {
        m.awareness = 'hunting';
        (m as MonsterX & { breathNext?: boolean }).breathNext = true;
        c.ev.push({ type: 'awake', id: m.id, awareness: 'hunting' });
        say(c, `${m.name} stirs at the noise.`);
      }
      continue;
    }
    if (m.awareness === 'asleep' || m.awareness === 'patrol') {
      goAlert(c, m, at);
    } else if (m.awareness === 'alert') {
      m.focusAt = { ...at };
      m.returning = undefined;
      m.searchRounds = SEARCH_ROUNDS;
    } else if (m.kind === 'berserker' && !m.focusAt) {
      m.focusAt = { ...at };
    }
  }
}

/**
 * V4.0 (spec 26.3): a hit turns a monster (not the Gloam) or crew member to face its attacker, after the hit
 * has resolved (a backstab lands from behind, then it faces the stabber). Called for single-target attacks
 * that hit: strikes, shots, free swings, overwatch, firebolt, night thorn, briar, hamstring, shove and
 * knockback. Not for misses, and not for area damage (fireball, gust, blasts, fire).
 */
export function turnOnHit(c: Ctx, targetId: string, attackerId: string): void {
  const from = hd(c, attackerId)?.at ?? rivalsOnMap(c).find((x) => x.id === attackerId)?.at ?? c.d.monsters.find((x) => x.id === attackerId)?.at;
  if (!from) return;
  const m = c.d.monsters.find((x) => x.id === targetId);
  if (m) {
    if (m.kind !== 'gloam' && !m.buried) faceToward(m, from);
    return;
  }
  const r = rivalsOnMap(c).find((x) => x.id === targetId);
  if (r) faceToward(r, from);
}

/** The monster has a quarry: hunting, no longer searching or walking back. */
export function goHunting(c: Ctx, m: MonsterX, at?: Pos): void {
  if (m.buried) return;
  const was = m.awareness;
  m.awareness = 'hunting';
  m.searchRounds = undefined;
  m.returning = undefined;
  if (at) {
    m.focusAt = { ...at };
    faceToward(m, at);
  }
  if (was !== 'hunting') c.ev.push({ type: 'awake', id: m.id, awareness: 'hunting' });
}

/** A sleeper or patroller hears something: alert at the source, searching for SEARCH_ROUNDS (berserkers hunt). */
export function goAlert(c: Ctx, m: MonsterX, at: Pos): void {
  m.awareness = m.kind === 'berserker' ? 'hunting' : 'alert';
  m.focusAt = { ...at };
  m.returning = undefined;
  faceToward(m, at);
  if (m.awareness === 'alert') m.searchRounds = SEARCH_ROUNDS;
  c.ev.push({ type: 'awake', id: m.id, awareness: m.awareness });
}

/**
 * A hero arrives at `at` without walking there (a fall, a climb, a blink): sleepers next to them
 * wake for sure when the hero came loudly, 25% when quietly (spec 20.1's end-adjacent rule).
 * Walks use the per-hex wake rolls in doMove instead.
 */
export function wakeAdjacent(c: Ctx, at: Pos, sneak = false, by?: string): void {
  for (const m of c.d.monsters) {
    if (m.awareness !== 'asleep' || m.kind === 'dragon' || m.buried || !within(m.at, at, 1)) continue;
    if (sneak && !chance(c.s, WAKE_END_SNEAK)) continue;
    goAlert(c, m, at);
    if (by) c.ev.push({ type: 'woke', id: m.id, by });
  }
}

/** A monster loses its quarry: back to alert, and it forgets who it had noticed (sneak attacks are on again). */
export function loseQuarry(c: Ctx, m: MonsterX, at?: Pos): void {
  m.awareness = 'alert';
  m.searchRounds = SEARCH_ROUNDS;
  m.returning = undefined;
  if (at) m.focusAt = { ...at };
  forgetHeroes(m);
  c.ev.push({ type: 'awake', id: m.id, awareness: 'alert' });
}

// ---------------------------------------------------------------- V3.7 kit (spec 20.5)

/**
 * Brace and the forge shield against a hit on this hero: damage taken off each hit (after armor,
 * min 0 is the caller's) and the attacker's chance modifier. `ranged`: arrows, knockback shots,
 * firebolts (not the Dragon's breath), the only hits a shield turns.
 */
export function guardMods(c: Ctx, h: HeroInDelve, ranged: boolean): { dmg: number; chance: number } {
  const braced = !!h.braced;
  const shield = !!heroDef(c, h.heroId)?.shield;
  let dmg = braced ? BRACE_DMG : 0;
  if (shield && ranged) dmg += braced ? SHIELD_BRACED_DMG : SHIELD_DMG;
  return { dmg, chance: braced ? BRACE_CHANCE : 0 };
}

/** Attack labels that count as ranged for the shield (spec 20.5). */
export function rangedLabel(what: string): boolean {
  return /shot|firebolt|overwatch|arrow|bolt|dart/i.test(what);
}

/**
 * Root a figure for `rounds` (hamstring, briar): a hero can't move or dash (`rooted`, refreshed by a
 * new hit); a monster or crew member stands where it is (`stuck`). The Dragon and the Gloam are not rooted.
 */
export function rootFigure(c: Ctx, id: string, rounds: number, by: string): boolean {
  const h = hd(c, id);
  if (h) {
    if (h.status !== 'active') return false;
    h.rooted = Math.max(h.rooted ?? 0, rounds);
    c.ev.push({ type: 'rooted', id, by, rounds: h.rooted });
    say(c, `${heroName(c, id)} is rooted to the spot.`);
    return true;
  }
  const m = c.d.monsters.find((x) => x.id === id);
  if (m) {
    if (m.kind === 'dragon' || m.kind === 'gloam') return false;
    m.stuck = Math.max(m.stuck ?? 0, rounds);
    c.ev.push({ type: 'rooted', id, by, rounds: m.stuck });
    say(c, `${m.name} ${m.kind === 'rats' ? 'are' : 'is'} rooted to the spot.`);
    return true;
  }
  const r = c.d.rivals?.members.find((x) => x.id === id);
  if (r) {
    r.stuck = Math.max(r.stuck ?? 0, rounds);
    c.ev.push({ type: 'rooted', id, by, rounds: r.stuck });
    say(c, `${r.name} is rooted to the spot.`);
    return true;
  }
  return false;
}

export { random };
