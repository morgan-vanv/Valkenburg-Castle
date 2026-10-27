// Shared delve helpers: lookups, occupancy, rolls, damage, noise, loot.

import { DARK_PENALTY } from './data'; // V4.1 (WS2)
import { ARROW_BUNDLE } from './data'; // V4.1 (WS6)
import { distance, posKey, posNeighbors, samePos, type Pos } from './hex';
import type { Brightness, Hero, HeroInDelve, Item, ItemKind, SlotRoll } from './types';
import {
  BLEED_START, BRACE_CHANCE, BRACE_DMG, CLASSES, CUTTHROAT_HEAR, FIRESIDE_HEAL, FOCUS_MAX, RESERVE_FOCUS, DRAGON_WAKE_NOISE, GEMS, JEWELRY, MONSTERS, PACK_SLOTS, SEARCH_ROUNDS,
  SHIELD_BRACED_DMG, SHIELD_DMG, SLAY_XP, TIERS, TOLL_MIN, WAKE_END_SNEAK,
} from './data';
import { chance, int, pick, random } from './rng';
import { newItemId, say, type Ctx, type MonsterX, type RivalX } from './state';
import { lightTierAt, litSet, nightEyedHero, noiseField, standable, within, type World } from './world';
import { faceToward, forgetHeroes, noticeFigure } from './stealth';
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

/**
 * Who stands at p: a hero (active/downed), monster, rival on the map (V4.1: up or downed), or the prisoner. V4.1 (spec
 * 31.4): a carried body shares its carrier's hex and isn't counted (the carrier is).
 */
export function occupant(c: Ctx, p: Pos): { kind: 'hero' | 'monster' | 'rival' | 'prisoner'; id: string } | null {
  for (const m of c.d.monsters) if (!m.buried && samePos(m.at, p)) return { kind: 'monster', id: m.id };
  for (const r of rivalsOnMap(c)) if (samePos(r.at, p)) return { kind: 'rival', id: r.id };
  for (const r of downedCrew(c)) if (samePos(r.at, p) && !isCarried(c, r.id)) return { kind: 'rival', id: r.id };
  for (const h of c.d.heroes) {
    if ((h.status === 'active' || h.status === 'downed') && samePos(h.at, p) && !isCarried(c, h.heroId)) return { kind: 'hero', id: h.heroId };
  }
  const pr = c.d.prisoner;
  if (pr && !pr.out && !pr.dead && samePos(pr.at, p) && !isCarried(c, pr.id)) return { kind: 'prisoner', id: pr.id };
  return null;
}

// ---------------------------------------------------------------- V4.1 (WS3, spec 31.4): carried bodies and downed crew

/**
 * V4.1 (spec 31.4): every figure on hex `p`, carried bodies included (a carrier and its load share a hex): monsters, crew
 * members up or down, heroes up or down, the prisoner. For area effects: everyone on the hex is hit.
 */
export function bodiesOn(c: Ctx, p: Pos): string[] {
  const out: string[] = [];
  for (const m of c.d.monsters) if (!m.buried && samePos(m.at, p)) out.push(m.id);
  for (const r of [...rivalsOnMap(c), ...downedCrew(c)]) if (samePos(r.at, p)) out.push(r.id);
  for (const h of c.d.heroes) if ((h.status === 'active' || h.status === 'downed') && samePos(h.at, p)) out.push(h.heroId);
  const pr = c.d.prisoner;
  if (pr && !pr.out && !pr.dead && samePos(pr.at, p)) out.push(pr.id);
  return out;
}

/** V4.1 (spec 31.4): crew members down on the map (0 HP, bleeding out). Not in `rivalsOnMap` (which is those still up). */
export function downedCrew(c: Ctx): RivalX[] {
  const cr = c.d.rivals;
  if (!cr || !cr.entered) return [];
  return cr.members.filter((r) => !r.goneOut && !!r.downed);
}

/** V4.1 (spec 31.4): who carries body `id` (a hero, a crew member, or nobody): a hero's `carrying`, a member's `carrying` or `dragging`. */
export function carrierOf(c: Ctx, id: string): { hero?: HeroInDelve; rival?: RivalX } | null {
  const h = c.d.heroes.find((x) => x.carrying === id && x.status === 'active');
  if (h) return { hero: h };
  const r = rivalsOnMap(c).find((x) => x.carrying === id || x.dragging === id);
  return r ? { rival: r } : null;
}

export function isCarried(c: Ctx, id: string): boolean {
  return !!carrierOf(c, id);
}

/** Set the position of body `id` (a hero, the prisoner or a crew member) without events. */
function placeBody(c: Ctx, id: string, at: Pos): Pos | undefined {
  const h = hd(c, id);
  const f = h ?? (c.d.prisoner?.id === id ? c.d.prisoner : undefined) ?? c.d.rivals?.members.find((x) => x.id === id);
  if (!f) return undefined;
  const from = f.at;
  f.at = { ...at };
  return from;
}

/** V4.1 (spec 31.4): every carried body onto its carrier's hex (after any move, push, fall or blink of the carrier). */
export function syncCarried(c: Ctx): void {
  for (const h of c.d.heroes) if (h.carrying && h.status === 'active') placeBody(c, h.carrying, h.at);
  for (const r of rivalsOnMap(c)) {
    if (r.carrying) placeBody(c, r.carrying, r.at);
    if (r.dragging) placeBody(c, r.dragging, r.at);
  }
}

/** V4.1 (spec 31.4): the body carried by the figure at `carrierId`, moved onto its hex now (one carrier). */
export function bringCarried(c: Ctx, carrierId: string): string | undefined {
  const h = hd(c, carrierId);
  const r = h ? undefined : c.d.rivals?.members.find((x) => x.id === carrierId);
  const id = h?.carrying ?? r?.carrying ?? r?.dragging;
  const at = (h ?? r)?.at;
  if (id && at) placeBody(c, id, at);
  return id;
}

/**
 * V4.1 (spec 31.4): a body put down off a carrier still standing at `at`: onto a free hex next to it (nearest first,
 * not onto traps, vents or fire), else it stays on the carrier's hex.
 */
export function setDownNear(c: Ctx, id: string, at: Pos): void {
  const w = c.w;
  const spot = posNeighbors(at).find((p) => standable(w, c.d, p) && !occupant(c, p) && !c.d.traps[posKey(p)] && !w.vents.has(posKey(p)) && !(c.d.burning?.[posKey(p)]));
  if (spot) {
    placeBody(c, id, spot);
    c.ev.push({ type: 'moved', id, path: [{ ...spot }] });
  }
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

/**
 * V4.1 (WS2): darkness by the hero's own hex, as a Brightness: lit by party light (a torch, a lantern, Glowworm) or
 * daylight `bright` (no penalty); lit only by a castle light (sconce, fire, brazier, fungus, glow, burning, a crew's
 * light) `dim` (−10); unlit `dark` (−20). The lantern stage no longer matters ('pitch' is never returned).
 */
export function brightnessAt(w: World, c: Ctx, at: Pos, lit?: Set<string>): Brightness {
  const t = lightTierAt(w, c.d, at, lit ?? litSet(w, c.d));
  return t === 'party' || t === 'day' ? 'bright' : t === 'castle' ? 'dim' : 'dark';
}

/** V4.1 (WS2): bright = party light or daylight, dim = a castle light only, dark = unlit (DARK_PENALTY); pitch is never used now. */
export const LIGHT_PENALTY: Record<Brightness, number> = { bright: DARK_PENALTY.party, dim: DARK_PENALTY.castle, dark: DARK_PENALTY.unlit, pitch: -30 };

/** V3.6 (spec 19.3): the hero has the night-eye draught in them: no dark penalties to sight or rolls. */
export function nightEyed(h: HeroInDelve): boolean {
  return nightEyedHero(h); // V4.1 (WS2): Night-eye Stout (ale `nighteye`), or an old save's draught rounds
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
  lockpicks: 'Lockpicks', improvised: 'Improvised pick', 'improvised-charge': 'Improvised explosive', nightsight: 'Night-eye draught',
  gatekey: 'Sally port key',
  antidote: 'Antipoison', venomdart: 'Poison dart', lantern: 'Lantern', // V4.1 (WS2); V4.1 (spec 31.4): player-facing names
  greaterpotion: 'Greater potion', // V4.1 (spec 31.3)
  // V4.1 (WS6, spec 31.8): arrows (a bundle's name carries its count: arrowName)
  quiver: 'Quiver', arrows: 'Plain arrows', whistlearrows: 'Whistling arrows', glowarrows: 'Glow arrows', firearrows: 'Fire arrows',
  poisonarrows: 'Poison arrows', barbarrows: 'Barbed arrows', ropearrow: 'Rope arrow', blastarrows: 'Blast arrows',
};

/** V4.1 (WS6, spec 31.8): an arrow bundle's (or the quiver's) name with its count: "Quiver (10)", "Glow arrows (3)", "Rope arrow". */
export function arrowName(kind: ItemKind, n: number): string {
  if (kind === 'quiver') return n > 0 ? `Quiver (${n})` : 'Quiver (empty)';
  const many = SINGLE[kind];
  const one = many.replace(/arrows$/, 'arrow');
  return n === 1 ? one : `${many.replace(/arrow$/, 'arrows')} (${n})`;
}

/**
 * The Sapper's improvised explosives (V4.0, spec 26.5; the V3.7 "satchel"): one slotless pack item,
 * `amount` left. A satchel from an older save (kind 'charge', 0 slots) counts too until it is migrated.
 */
export function isSatchel(i: Item): boolean {
  return i.kind === 'improvised-charge' || (i.kind === 'charge' && i.slots === 0);
}

/**
 * Class kit (spec 20.3, 21.4, 26.5): the Sapper's improvised explosives and the Burglar's improvised pick.
 * The hero's own: no pack slot; never dropped, given, stolen, robbed, paid over or banked; gone with the
 * hero if they die. A fresh set each delve.
 */
export function isKit(i: Item): boolean {
  return isSatchel(i) || i.kind === 'improvised' || i.kind === 'quiver'; // V4.1 (WS6): the Ranger's quiver
}

/** V4.1 (WS6): `amount` omitted: 1, or an arrow bundle's count (ARROW_BUNDLE), named with it. */
export function makeItem(c: { s: Ctx['s'] }, kind: ItemKind, amount?: number, name?: string): Item {
  const bundle = ARROW_BUNDLE[kind];
  amount ??= bundle ?? 1;
  return {
    id: newItemId(c.s),
    kind,
    name: name ?? (kind === 'gold' ? `${amount} gold` : bundle || kind === 'quiver' ? arrowName(kind, amount) : SINGLE[kind]),
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

/** V4.1 (WS2): kept as a no-op hook for callers: lanterns and torches are pack items now and go where the pack goes. */
export function passLanternIfNeeded(_c: Ctx): void {}

export function killHero(c: Ctx, h: HeroInDelve): void {
  h.status = 'dead';
  h.hp = 0;
  (c.d.diedAt ??= {})[h.heroId] = { ...h.at };
  c.ev.push({ type: 'died', id: h.heroId });
  say(c, `${heroName(c, h.heroId)} is dead.`);
  // V4.0 (spec 26.5): class kit is the hero's own and goes with them; it doesn't drop as loot.
  const drop = h.pack.filter((i) => !isKit(i));
  (c.d.lostIds ??= []).push(...drop.filter((i) => i.kind !== 'heirloom').map((i) => i.id));
  putOnGround(c, h.at, drop);
  h.pack = [];
  if (h.escorting && c.d.prisoner) c.d.prisoner.escortedBy = undefined;
  h.escorting = undefined;
  // V4.1 (spec 31.4): carrying ends; the body lies on this hex. Whoever carried this hero has nothing now.
  h.carrying = undefined;
  for (const o of c.d.heroes) if (o.carrying === h.heroId) o.carrying = undefined;
  // V3.7 (spec 20.4): a member dragging them lets go.
  for (const r of c.d.rivals?.members ?? []) if (r.dragging === h.heroId) r.dragging = undefined;
  // V4.1 (WS2): a lit torch or open lantern in the pack drops with it, still burning (lost gear as usual).
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
      // V4.1 (spec 31.4): a downed carrier drops what they carried: it lies on their hex.
      if (h.carrying) {
        c.ev.push({ type: 'setDown', by: h.heroId, id: h.carrying });
        h.carrying = undefined;
      }
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
    for (const h of c.d.heroes) if (h.carrying === p.id) h.carrying = undefined; // V4.1 (spec 31.4)
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
    // V4.0 (spec 28.8): a seized hero held by a crew member, awake: kept while the member still carries them off.
    const rv = c.d.rivals?.members.find((x) => x.id === h.grabbedBy);
    if (rv) {
      if (h.status === 'active' && rv.hp > 0 && !rv.goneOut && rv.dragging === h.heroId) continue;
      h.grabbedBy = undefined;
      if (h.status === 'active') c.ev.push({ type: 'released', id: h.heroId });
      continue;
    }
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
    // V4.0 (spec 28.2): a crew member's hit counts like a hero's: it hunts and knows the striker.
    const crewBy = by ? rivalsOnMap(c).find((x) => x.id === by) : undefined;
    if (m.awareness !== 'hunting') {
      const src = by ? hd(c, by) : undefined;
      goHunting(c, m, src?.at ?? crewBy?.at);
    }
    // V3.7 (spec 20.1): hit by a hero, it knows them now (no more sneak attacks from that one).
    if (by && (hd(c, by) || crewBy)) noticeFigure(c, m, by);
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
    // V4.1 (spec 31.4, pillar 17): any damage to a downed member kills it.
    const wasDown = !!r.downed;
    r.hp -= dmg;
    c.ev.push({ type: 'hit', attacker: by ?? 'blast', target: r.id, damage: dmg, crit: !!opts.crit, ...(opts.backstab ? { backstab: true } : {}) });
    if (opts.noise !== false) hearLoud(c, r.at, CLASH_HEAR, 'scream');
    if (by && hd(c, by)) makeHostile(c);
    if (r.hp <= 0 && !wasDown) {
      // V4.1 (spec 31.4): at 0 HP a member goes down (bleeds out in BLEED_START) instead of dying outright.
      downMember(c, r, by);
      if (opts.noise !== false) makeNoise(c, r.at, 2);
    } else if (wasDown) killMember(c, r);
    return;
  }
  if (c.d.prisoner?.id === id) return hurtPrisoner(c, dmg, by ?? 'blast');
  const h = hd(c, id);
  if (h) hurtHero(c, h, dmg, by ?? 'blast', !!opts.crit);
}

/**
 * V4.1 (spec 31.4, pillar 17): a crew member goes down at 0 HP: it bleeds out in BLEED_START world phases; a hero it held
 * or carried and a crewmate it carried are dropped where it lies. The kill (and its XP) is the hero's who downed it.
 */
export function downMember(c: Ctx, r: RivalX, by: string | null): void {
  r.hp = 0;
  r.downed = true;
  r.bleed = BLEED_START;
  r.intent = undefined;
  r.overwatch = false;
  r.guarding = undefined;
  r.feared = undefined;
  c.ev.push({ type: 'downed', id: r.id });
  say(c, `${r.name} goes down.`);
  dropCaptive(c, r, 'goes down');
  if (r.carrying) {
    c.ev.push({ type: 'setDown', by: r.id, id: r.carrying });
    r.carrying = undefined;
  }
  if (by && hd(c, by)) {
    c.d.kills[by] = (c.d.kills[by] ?? 0) + 1;
    (c.d.xp ??= {})[by] = (c.d.xp[by] ?? 0) + 1;
  }
}

/** V4.1 (spec 31.4): a downed crew member dies (finished, or bled out): spoils on its hex (spec 20.4), its carrier lets go. */
export function killMember(c: Ctx, r: RivalX): void {
  r.hp = 0;
  r.downed = undefined;
  r.bleed = undefined;
  for (const o of c.d.rivals?.members ?? []) if (o.carrying === r.id) o.carrying = undefined;
  c.ev.push({ type: 'monsterDied', id: r.id });
  say(c, `${r.name} is dead.`);
  // Spec 20.4: spoils: the purse and loot, and the pack. V4.0 (spec 28.6): class kit goes with the member, as with a hero.
  putOnGround(c, r.at, [...r.loot, ...(r.pack ?? []).filter((i) => !isKit(i))]);
  r.loot = [];
  r.pack = r.pack ? [] : r.pack;
  dropCaptive(c, r, 'dies');
  r.carrying = undefined;
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
  const id = releaseCrewHold(c, r);
  if (!id) return;
  const h = hd(c, id);
  if (h && h.status === 'downed') say(c, `${r.name} ${why}. ${heroName(c, id)} is dropped where they lie.`);
  else if (h && h.status === 'active') say(c, `${r.name} ${why}. ${heroName(c, id)} is free.`);
}

/** V4.0 (spec 28.8): the member lets go (no log line): `dragging` cleared, a held hero's `grabbedBy` too. Returns the hero's id. */
export function releaseCrewHold(c: Ctx, r: RivalX): string | undefined {
  const id = r.dragging;
  if (!id) return undefined;
  r.dragging = undefined;
  const h = hd(c, id);
  if (h && h.grabbedBy === r.id) {
    h.grabbedBy = undefined;
    c.ev.push({ type: 'released', id });
  }
  // V4.1 (spec 31.4): the hero shared the member's hex; awake, they stand up beside it (downed, they lie where it is).
  if (h && h.status === 'active' && samePos(h.at, r.at)) setDownNear(c, id, r.at);
  return id;
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
  // V4.1 (spec 31.10): only when a hero is within the noise's reach too. Since monsters notice crews (spec 28.2), an orc
  // bellowing at a crew member on another level would otherwise send the crew after a party that made no sound.
  if (radius >= CUTTHROAT_HEAR && c.d.phase === 'player' && c.d.rivals?.stance === 'waiting' && rivalsOnMap(c).some((r) => heard.has(posKey(r.at)))
    && c.d.heroes.some((h) => h.status === 'active' && heard.has(posKey(h.at)))) crewDemand(c);
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
