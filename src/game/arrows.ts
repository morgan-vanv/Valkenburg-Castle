// V4.1 (WS6, spec 31.8): arrows. The Ranger's quiver (class kit: 5 arrows a level each delve, slotless, their own),
// bought bundles (plain arrows after the quiver; specialty arrows the player picks), what each arrow does where it
// lands, glow arrows' light, and crews by the same rules (pillar 17): crew Rangers carry quivers by crew level and
// loose the specialty bundle in their pack when it makes sense.
//
// Item amounts are arrows left. The quiver stays in the pack at 0 (so an old save's reload can tell it was spent);
// a bundle at 0 is gone.

import { distance, posKey, type Pos } from './hex';
import type { ActionTarget, GameState, HeroInDelve, Intent, Item, ItemKind } from './types';
import {
  ARROW_KINDS, BARB_ROUNDS, BLAST_ARROW_DMG, BOW_RANGE, BURN_ROUNDS, CLASSES, CREW_ARROWS, GLOW_ARROW_ROUNDS, KNIFE,
  ROPE_ARROW_RANGE, WHISTLE_NOISE, quiverPerDelve, type Weapon,
} from './data';
import { say, type Ctx, type DelveX, type GameStateX, type RivalX } from './state';
import { arrowName, makeItem, makeNoise, nameOf, rootFigure } from './common';
import { fallInfo } from './falls';
import { isFloorish, kindAt, litSet, los, pitsNextTo, standable, within } from './world';
import { blast, blastableWall } from './charges';
import { poison, poisonTakes } from './poison';
import { exitOpen, type Target } from './ai';

// ---------------------------------------------------------------- the items

/** Arrows a specialty kind is: shot at a creature with Attack (a roll), or at a hex with Shoot (no roll). */
export const ATTACK_ARROWS: ItemKind[] = ['whistlearrows', 'glowarrows', 'firearrows', 'poisonarrows', 'barbarrows'];
export const HEX_ARROWS: ItemKind[] = ['whistlearrows', 'glowarrows', 'blastarrows', 'ropearrow'];

const WORD: Partial<Record<ItemKind, string>> = {
  whistlearrows: 'whistling', glowarrows: 'glow', firearrows: 'fire', poisonarrows: 'poison', barbarrows: 'barbed', ropearrow: 'rope', blastarrows: 'blast',
};

export function isArrow(i: Item): boolean {
  return ARROW_KINDS.includes(i.kind);
}

export { arrowName };

/** The arrow's kind in a word, for log lines and the roll panel ("plain", "glow", "barbed"). */
export function arrowWord(kind: ItemKind): string {
  return WORD[kind] ?? 'plain';
}

/** The quiver a Ranger (or crew Ranger) of this level brings: one slotless item, 5 arrows a level. Null for other classes. */
export function classQuiver(c: { s: Ctx['s'] }, cls: string, level: number | undefined): Item | null {
  if (!CLASSES[cls as keyof typeof CLASSES]?.weapon.range) return null;
  const n = quiverPerDelve(level);
  return { ...makeItem(c, 'quiver', n, arrowName('quiver', n)), slots: 0 };
}

export function quiverOf(pack: Item[]): Item | undefined {
  return pack.find((i) => i.kind === 'quiver');
}

/** Plain arrows left: the quiver, then bought plain bundles. */
export function plainArrows(pack: Item[]): number {
  return pack.reduce((n, i) => n + (i.kind === 'quiver' || i.kind === 'arrows' ? Math.max(0, i.amount) : 0), 0);
}

/** Every arrow left, any kind. */
export function arrowCount(pack: Item[]): number {
  return pack.reduce((n, i) => n + (isArrow(i) ? Math.max(0, i.amount) : 0), 0);
}

/** Specialty bundles an Attack can loose (one entry per bundle). */
export function attackArrows(pack: Item[]): Item[] {
  return pack.filter((i) => ATTACK_ARROWS.includes(i.kind) && i.amount > 0);
}

/** Can the bow shoot at a creature now: a plain arrow, or a specialty arrow an Attack can loose. */
export function bowReady(pack: Item[]): boolean {
  return plainArrows(pack) > 0 || attackArrows(pack).length > 0;
}

/** A bow class (the Ranger). */
export function bowClass(cls: string): boolean {
  return !!CLASSES[cls as keyof typeof CLASSES]?.weapon.range;
}

/** What a hero of this class fights with now: the class weapon, or out of arrows the Ranger's knife. */
export function weaponNow(cls: string, pack: Item[]): Weapon {
  const w = CLASSES[cls as keyof typeof CLASSES].weapon;
  return w.range && !bowReady(pack) ? KNIFE : w;
}

/**
 * Spend one arrow. With `itemId`, that bundle (any arrow kind); else plain: the quiver first, then bought plain arrows.
 * The quiver stays at 0; a bundle at 0 goes. Returns the kind spent, or null when there's none.
 */
export function spendArrow(pack: Item[], itemId?: string): ItemKind | null {
  let it: Item | undefined;
  if (itemId) it = pack.find((i) => i.id === itemId && isArrow(i) && i.amount > 0);
  else it = pack.find((i) => i.kind === 'quiver' && i.amount > 0) ?? pack.find((i) => i.kind === 'arrows' && i.amount > 0);
  if (!it) return null;
  it.amount -= 1;
  it.name = arrowName(it.kind, it.amount);
  if (it.amount <= 0 && it.kind !== 'quiver') pack.splice(pack.indexOf(it), 1);
  return it.kind;
}

/** The arrow an Attack would loose: `arrowId` if it names a specialty bundle an Attack can use, else plain (quiver first). */
export function attackArrow(pack: Item[], arrowId?: string): Item | undefined {
  if (arrowId) {
    const it = pack.find((i) => i.id === arrowId && ATTACK_ARROWS.includes(i.kind) && i.amount > 0);
    if (it) return it;
  }
  return pack.find((i) => i.kind === 'quiver' && i.amount > 0) ?? pack.find((i) => i.kind === 'arrows' && i.amount > 0) ?? attackArrows(pack)[0];
}

// ---------------------------------------------------------------- what an arrow does where it lands

/** One glow arrow's light: radius GLOW_ARROW_RADIUS where it lands, or on the figure it struck. */
export function addGlow(c: Ctx, at: Pos, on?: string): void {
  (c.d.glows ??= []).push({ at: { ...at }, ...(on ? { on } : {}), rounds: GLOW_ARROW_ROUNDS });
  c.visCache = undefined;
}

/**
 * Glow arrows in a figure follow it (`at` kept to where it stands); one in a figure that died stays where it was last
 * synced (run at the end of every world phase and every hero command, so that's where it fell); one in a crew member
 * who left goes with them.
 */
export function syncGlows(c: Ctx): void {
  for (const g of c.d.glows ?? []) {
    if (!g.on) continue;
    const p = figureAt(c.d, g.on);
    if (p) g.at = { ...p };
    else if (c.d.rivals?.members.some((r) => r.id === g.on && r.goneOut)) g.rounds = 0; // gone out with them
    else g.on = undefined;
  }
  if (c.d.glows?.some((g) => g.rounds <= 0)) c.d.glows = c.d.glows.filter((g) => g.rounds > 0);
}

/** World phase step 1: glow arrows burn down 1. */
export function tickGlows(c: Ctx): void {
  const list = c.d.glows;
  if (!list?.length) return;
  syncGlows(c);
  for (const g of c.d.glows ?? []) g.rounds -= 1;
  c.d.glows = (c.d.glows ?? []).filter((g) => g.rounds > 0);
  c.visCache = undefined;
}

/** Where a figure stands now (monsters, crew members up or down, heroes on the map), or undefined. */
export function figureAt(d: DelveX, id: string): Pos | undefined {
  const m = d.monsters.find((x) => x.id === id && !x.buried);
  if (m) return m.at;
  const r = d.rivals?.members.find((x) => x.id === id && !x.goneOut && (x.hp > 0 || x.downed));
  if (r) return r.at;
  const h = d.heroes.find((x) => x.heroId === id && (x.status === 'active' || x.status === 'downed'));
  return h?.at;
}

/**
 * A loosed arrow's own effect (the shot's damage is the caller's): `at` is where it lands (the target's hex, hit or
 * miss), `targetId` the creature shot at, `hit` whether it struck. Whistling: noise 6 there. Glow: light on the creature
 * it hits, else where it lands. Fire: the hex burns (the +1 damage is in the shot). Poison: a hit poisons. Barbed: a hit
 * roots. Blast: the small blast there. Rope: a rope anchored there.
 */
export function arrowLands(c: Ctx, kind: ItemKind, by: string, at: Pos, targetId: string | undefined, hit: boolean): void {
  const who = nameOf(c, by);
  const tn = targetId ? nameOf(c, targetId) : '';
  switch (kind) {
    case 'whistlearrows':
      say(c, `${who}'s whistling arrow shrieks${targetId ? ` past ${tn}` : ''}.`);
      makeNoise(c, at, WHISTLE_NOISE, { what: 'scream' });
      return;
    case 'glowarrows':
      if (hit && targetId && figureAt(c.d, targetId)) {
        addGlow(c, at, targetId);
        say(c, `${who}'s glow arrow sticks in ${tn}. ${cap(tn)} glows.`);
      } else {
        addGlow(c, at);
        say(c, `${who}'s glow arrow lands and lights the dark round it.`);
      }
      return;
    case 'firearrows':
      if (!hit) return;
      if (isFloorish(c.w, c.d, at)) c.d.burning[posKey(at)] = Math.max(c.d.burning[posKey(at)] ?? 0, BURN_ROUNDS);
      say(c, `${who}'s fire arrow sets the ground alight.`);
      return;
    case 'poisonarrows':
      if (hit && targetId && poisonTakes(c, targetId)) poison(c, targetId, by);
      return;
    case 'barbarrows':
      if (hit && targetId && figureAt(c.d, targetId)) rootFigure(c, targetId, BARB_ROUNDS, by);
      return;
    case 'blastarrows':
      blast(c, at, by, { inner: BLAST_ARROW_DMG, outer: 0, floor: false, push: false, line: `${who}'s blast arrow bursts. BOOM.` });
      return;
    case 'ropearrow':
      if (!c.d.ropes.includes(posKey(at))) c.d.ropes.push(posKey(at));
      say(c, `${who}'s rope arrow bites into the edge. A line hangs down the pit.`);
      return;
  }
}

function cap(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

// ---------------------------------------------------------------- Shoot (a specialty arrow at a hex, no roll)

/** Edge hexes beside a pit something could drop down (where a rope can hang). */
export function ropeEdge(c: Ctx, p: Pos): boolean {
  if (!standable(c.w, c.d, p) || c.d.ropes.includes(posKey(p))) return false;
  return pitsNextTo(c.w, c.d, p).some((pit) => !!fallInfo(c, pit, ''));
}

/**
 * Shoot targets for a Ranger: every hex arrow bundle in the pack, at every hex the party sees in bow range (rope arrows:
 * an edge hex beside a pit within 5). `vis` is the party's sight; the hero's own hex is never one.
 */
export function shootTargets(c: Ctx, h: HeroInDelve, vis: Set<string>, hexesInSight: (n: number, f: (p: Pos) => boolean) => ActionTarget[]): ActionTarget[] {
  void vis;
  const out: ActionTarget[] = [];
  const seen = new Set<ItemKind>();
  for (const it of h.pack) {
    if (!HEX_ARROWS.includes(it.kind) || it.amount <= 0 || seen.has(it.kind)) continue;
    seen.add(it.kind);
    const n = it.kind === 'ropearrow' ? ROPE_ARROW_RANGE : BOW_RANGE;
    const ok =
      it.kind === 'ropearrow'
        ? (p: Pos) => distance(p, h.at) >= 1 && ropeEdge(c, p)
        : it.kind === 'blastarrows'
          ? (p: Pos) => distance(p, h.at) >= 2 && (isFloorish(c.w, c.d, p) || kindAt(c.w, c.d, p) === 'pit' || blastableWall(c.w, c.d, p))
          : (p: Pos) => distance(p, h.at) >= 1 && (isFloorish(c.w, c.d, p) || kindAt(c.w, c.d, p) === 'pit');
    for (const t of hexesInSight(n, (p) => ok(p) && los(c.w, c.d, h.at, p))) out.push({ ...t, itemId: it.id });
  }
  return out;
}

// ---------------------------------------------------------------- crews (pillar 17)

/** A crew member with a bow that keeps arrow count (a level-built member with a pack). */
export function crewCounts(r: RivalX): boolean {
  return bowClass(r.cls) && !!r.pack;
}

/** Can a crew bow shoot (a plain arrow, or any specialty bundle)? Legacy members without a pack always can. */
export function crewBowReady(r: RivalX): boolean {
  return !crewCounts(r) || arrowCount(r.pack!) > 0;
}

/** Can a crew Ranger use a plain shot (knockback, hamstring, overwatch)? */
export function crewPlainReady(r: RivalX): boolean {
  return !crewCounts(r) || plainArrows(r.pack!) > 0;
}

/**
 * A crew Ranger's shot spends an arrow: plain first (the quiver, then bought), then a specialty bundle (its effect
 * then lands with the shot). `kind` asks for that specialty. Returns the kind spent; null for a legacy member (no
 * count) or when it has none.
 */
export function spendCrewArrow(r: RivalX, kind?: ItemKind | 'plain'): ItemKind | null {
  if (!crewCounts(r)) return null;
  const pack = r.pack!;
  if (kind && kind !== 'plain') {
    const b = pack.find((i) => i.kind === kind && i.amount > 0);
    return b ? spendArrow(pack, b.id) : null;
  }
  const plain = spendArrow(pack);
  if (plain || kind === 'plain') return plain;
  const any = pack.find((i) => isArrow(i) && i.kind !== 'quiver' && i.amount > 0);
  return any ? spendArrow(pack, any.id) : null;
}

/** A specialty kind (its effect lands with the shot), not a plain arrow. */
export function specialty(kind: ItemKind | null | undefined): kind is ItemKind {
  return !!kind && kind !== 'quiver' && kind !== 'arrows';
}

/**
 * V4.1 (WS6): a crew Ranger looses an arrow at `targetId` (on `at`) for a shot already rolled: plain first, else a
 * specialty (its effect lands); `hit` the shot struck. Legacy members (no pack) shoot without counting. Returns the kind.
 */
export function crewLoosed(c: Ctx, r: RivalX, kind: ItemKind | null, targetId: string, at: Pos | undefined, hit: boolean): void {
  if (specialty(kind) && at) arrowLands(c, kind, r.id, figureAt(c.d, targetId) ?? at, targetId, hit);
  if (crewCounts(r) && !arrowCount(r.pack!)) say(c, `${r.name} has no arrows left and draws a knife.`);
}

/** The specialty bundle a crew brings for its Ranger (CREW_ARROWS), as a pack item, or null. */
export function crewBundle(s: GameStateX, crew: RivalX['crew'], cls: RivalX['cls']): Item | null {
  const k = bowClass(cls) ? CREW_ARROWS[crew] : undefined;
  return k ? makeItem({ s }, k) : null;
}

/**
 * The crew Ranger's specialty shot (intent `arrow`, shown first): glow arrows at a hero in the dark in bow reach (its
 * first shot there lights them up for the crew), barbed arrows at a runner (a hero carrying a body, the job or leading
 * the captive, or one keeping 4+ away from every member) who isn't rooted. The crew's target first.
 */
export function arrowIntent(c: Ctx, r: RivalX, t: Target | null, inSight: (n: number) => Target[]): Intent | null {
  if (!crewCounts(r)) return null;
  const pack = r.pack!;
  const has = (k: ItemKind) => pack.some((i) => i.kind === k && i.amount > 0);
  const seen = inSight(BOW_RANGE).filter((x) => x.hero && x.hero.status === 'active');
  const order = t ? [...seen.filter((x) => x.id === t.id), ...seen.filter((x) => x.id !== t.id)] : seen;
  if (has('glowarrows')) {
    const lit = litSet(c.w, c.d);
    const dark = order.find((x) => !lit.has(posKey(x.at)) && !(c.d.glows ?? []).some((g) => g.on === x.id));
    if (dark) return { kind: 'arrow', item: 'glowarrows', targetId: dark.id, to: { ...dark.at } };
  }
  if (has('barbarrows')) {
    // A runner: a hero making off with something (a body, the captive, the job's item), or one near an open way out.
    const exits = [...c.w.exits].filter((e) => exitOpen(c, e));
    const runner = order.find((x) => {
      const h = x.hero!;
      if ((h.rooted ?? 0) > 0) return false;
      if (h.carrying || h.escorting || h.pack.some((i) => !!i.contractId)) return true;
      return exits.some((e) => e.level === x.at.level && distance(e, x.at) <= 3);
    });
    if (runner) return { kind: 'arrow', item: 'barbarrows', targetId: runner.id, to: { ...runner.at } };
  }
  return null;
}

/** Is a crew shot at `t` from `r` possible now (bow reach, a line)? */
export function crewCanShoot(c: Ctx, r: RivalX, at: Pos): boolean {
  return at.level === r.at.level && within(at, r.at, BOW_RANGE) && los(c.w, c.d, r.at, at);
}

// ---------------------------------------------------------------- old saves

/**
 * Saves from before arrows (a delve in progress): a Ranger in the castle without a quiver gets a fresh one (their level's
 * count); so does a level-built crew Ranger with a pack. Idempotent (a spent quiver stays at 0 in the pack).
 */
export function migrateArrows(s: GameState): void {
  const d = s.delve as DelveX | null;
  if (!d) return;
  const sx = s as GameStateX;
  for (const h of d.heroes) {
    const def = s.campaign.roster.find((x) => x.id === h.heroId);
    if (!def || !bowClass(def.cls) || quiverOf(h.pack)) continue;
    const q = classQuiver({ s: sx }, def.cls, def.level);
    if (q) h.pack.push(q);
  }
  for (const r of d.rivals?.members ?? []) {
    if (!r.pack || !bowClass(r.cls) || r.level === undefined || quiverOf(r.pack)) continue;
    const q = classQuiver({ s: sx }, r.cls, r.level);
    if (q) r.pack.push(q);
  }
}

/** A plain-arrow count for a pack, and whether its owner is a bow class (for previews and the HUD). */
export function arrowsLine(pack: Item[]): string {
  const q = quiverOf(pack)?.amount ?? 0;
  const bought = pack.filter((i) => i.kind === 'arrows').reduce((n, i) => n + i.amount, 0);
  return `${q} in the quiver${bought ? `, ${bought} bought` : ''}`;
}

