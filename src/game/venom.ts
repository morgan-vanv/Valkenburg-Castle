// V4.0 (spec 29, owner-approved): venom and paralysis. Spider bites, venom darts and venom traps envenom a hero,
// monster (not the Dragon or the Gloam) or crew member: a countdown of VENOM_ROUNDS world phases, then paralysis for
// PARALYSIS_ROUNDS. Paralyzed: can't move or act, doesn't bleed, isn't downed; hits hurt as usual and monsters still
// go for them. An antidote, the Hedgewitch's Mend or leaving the castle draws the venom out. An active hero can
// Shoulder a paralyzed ally and carry them (the carried one follows every move, the carrier moves 3 at most); a
// carrier who leaves takes them out too. Design pillar 17: crews are envenomed and paralyzed by the same rules.

import { distance, posKey, posNeighbors, samePos, type Pos } from './hex';
import type { HeroInDelve, Item } from './types';
import { PARALYSIS_ROUNDS, TRAP_DMG, VENOM_ROUNDS, VENOM_TRAP_DMG } from './data';
import { say, type Ctx, type MonsterX, type RivalX } from './state';
import { dropCaptive, hd, heroName, onMap, occupant, passLanternIfNeeded, releaseHold, rivalsOnMap } from './common';
import { partySees } from './hearing';
import { adjacent, canEnter, kindAt } from './world';

type Venomous = { venom?: number; paralyzed?: number };

/** Paralyzed now (world phases left > 0). */
export function isParalyzed(f: Venomous | undefined | null): boolean {
  return !!f && (f.paralyzed ?? 0) > 0;
}

/** Envenomed now: the countdown runs (paralyzed figures are not counted as envenomed). */
export function isEnvenomed(f: Venomous | undefined | null): boolean {
  return !!f && (f.venom ?? 0) > 0 && !isParalyzed(f);
}

/** A hero who can move and act: active and not paralyzed. */
export function canStir(h: HeroInDelve | undefined): boolean {
  return !!h && h.status === 'active' && !isParalyzed(h);
}

function turns(n: number): string {
  return n === 1 ? '1 turn' : `${n} turns`;
}

/** What a figure is, for venom: a hero in the castle, a monster (not the Dragon or the Gloam) on the map, a crew member on the map. */
function venomTarget(c: Ctx, id: string): { name: string; f: Venomous; at: Pos; hero?: HeroInDelve; monster?: MonsterX; rival?: RivalX } | null {
  const h = hd(c, id);
  if (h) return h.status === 'active' || h.status === 'downed' ? { name: heroName(c, id), f: h, at: h.at, hero: h } : null;
  const m = c.d.monsters.find((x) => x.id === id);
  if (m) return m.buried || m.kind === 'dragon' || m.kind === 'gloam' ? null : { name: m.name, f: m, at: m.at, monster: m };
  const r = rivalsOnMap(c).find((x) => x.id === id);
  if (r) return { name: r.name, f: r, at: r.at, rival: r };
  return null;
}

/** Can venom take hold of this figure at all (not the Dragon, the Gloam, the prisoner; not someone already paralyzed)? */
export function venomTakes(c: Ctx, id: string): boolean {
  const t = venomTarget(c, id);
  return !!t && !isParalyzed(t.f);
}

/**
 * A dose of venom (spec 29.1): the countdown starts at VENOM_ROUNDS; a second dose while envenomed takes 1 off it
 * (to 1 at least); a paralyzed figure takes no more. Returns true when it took. No dice: the roll (a bite that hit, a
 * dart that hit, a trap stepped on) is the caller's.
 */
export function envenom(c: Ctx, id: string, by: string): boolean {
  const t = venomTarget(c, id);
  if (!t || isParalyzed(t.f)) return false;
  const again = (t.f.venom ?? 0) > 0;
  t.f.venom = again ? Math.max(1, t.f.venom! - 1) : VENOM_ROUNDS;
  c.ev.push({ type: 'envenomed', id, by, venom: t.f.venom, dose: again ? 2 : 1 });
  if (t.hero || partySees(c, t.at)) {
    say(c, again ? `More venom: ${t.name} is paralyzed in ${turns(t.f.venom)}.` : `${t.name} is envenomed: paralyzed in ${turns(t.f.venom)}.`);
  }
  return true;
}

/** Venom and paralysis drawn out (an antidote, Mend, leaving the castle). Returns true if there was any. */
export function cureVenom(c: Ctx, id: string, how: 'antidote' | 'mend' | 'out', by?: string): boolean {
  const h = hd(c, id);
  const f: Venomous | undefined = h ?? c.d.monsters.find((x) => x.id === id) ?? c.d.rivals?.members.find((x) => x.id === id);
  if (!f || (!(f.venom ?? 0) && !(f.paralyzed ?? 0))) return false;
  f.venom = undefined;
  f.paralyzed = undefined;
  c.ev.push({ type: 'cured', id, how, ...(by ? { by } : {}) });
  checkCarries(c);
  return true;
}

/** The figure's limbs lock: paralyzed for PARALYSIS_ROUNDS; whatever it was holding or doing stops. */
function paralyze(c: Ctx, id: string): void {
  const t = venomTarget(c, id);
  if (!t) return;
  t.f.venom = undefined;
  t.f.paralyzed = PARALYSIS_ROUNDS;
  c.ev.push({ type: 'paralyzed', id, rounds: PARALYSIS_ROUNDS });
  if (t.hero || partySees(c, t.at)) say(c, `${t.name}'s limbs lock. Paralyzed for ${turns(PARALYSIS_ROUNDS)}.`);
  if (t.hero) {
    const h = t.hero;
    h.overwatch = false;
    h.guarding = undefined;
    h.braced = undefined;
    if (h.escorting && c.d.prisoner) c.d.prisoner.escortedBy = undefined;
    h.escorting = undefined;
    if (c.d.lanternBearer === h.heroId) passLanternIfNeeded(c);
  } else if (t.monster) {
    const m = t.monster;
    m.intent = undefined;
    if (m.holding) releaseHold(c, m);
  } else if (t.rival) {
    const r = t.rival;
    r.intent = { kind: 'wait' };
    r.overwatch = false;
    (r as RivalX).guarding = undefined;
    dropCaptive(c, r, 'locks up, paralyzed');
  }
  checkCarries(c);
}

/** Paralysis wears off: back with their HP as it is. */
function wearOff(c: Ctx, id: string): void {
  const t = venomTarget(c, id);
  if (!t) return;
  t.f.paralyzed = undefined;
  t.f.venom = undefined;
  c.ev.push({ type: 'cured', id, how: 'worn' });
  if (t.hero || partySees(c, t.at)) say(c, `${t.name} can move again.`);
  checkCarries(c);
}

/**
 * The world phase's venom step (spec 29.1, 29.2), with the bleeding: every paralyzed figure's paralysis runs down (at 0
 * it wears off), then every envenomed figure's countdown (at 0 it is paralyzed). Heroes in the castle (up or downed),
 * monsters on the map, crew members on the map.
 */
export function venomTick(c: Ctx): void {
  const ids: string[] = [];
  for (const h of c.d.heroes) if (h.status === 'active' || h.status === 'downed') ids.push(h.heroId);
  for (const m of onMap(c)) if (m.kind !== 'dragon' && m.kind !== 'gloam') ids.push(m.id);
  for (const r of rivalsOnMap(c)) ids.push(r.id);
  for (const id of ids) {
    const t = venomTarget(c, id);
    if (!t) continue;
    if (isParalyzed(t.f)) {
      t.f.paralyzed! -= 1;
      if (t.f.paralyzed! <= 0) wearOff(c, id);
    } else if ((t.f.venom ?? 0) > 0) {
      t.f.venom! -= 1;
      if (t.f.venom! <= 0) paralyze(c, id);
    }
  }
}

// ---------------------------------------------------------------- traps (spec 29.5)

/** A trap's bite: 3 damage, or 1 and venom for a venom trap. */
export function trapDamage(t: { venom?: boolean } | undefined): number {
  return t?.venom ? VENOM_TRAP_DMG : TRAP_DMG;
}

// ---------------------------------------------------------------- carrying (spec 29.4)

/** The hero carrying `id` on their shoulders, if any. */
export function carrierOf(c: Ctx, id: string): HeroInDelve | undefined {
  return c.d.heroes.find((h) => h.carrying === id && h.status === 'active');
}

/** Paralyzed allies next to `h` that `h` could shoulder: active, paralyzed, nobody's load yet; `h` able and carrying no one. */
export function shoulderable(c: Ctx, h: HeroInDelve): HeroInDelve[] {
  if (!canStir(h) || h.carrying) return [];
  return c.d.heroes.filter((o) => o !== h && o.status === 'active' && isParalyzed(o) && adjacent(o.at, h.at) && !carrierOf(c, o.heroId));
}

/** Put the load down (set down, or carrying ends). */
export function endCarry(c: Ctx, h: HeroInDelve, why?: string): void {
  const id = h.carrying;
  if (!id) return;
  h.carrying = undefined;
  c.ev.push({ type: 'setDown', by: h.heroId, id });
  if (why) say(c, why);
}

/** Carrying ends when the carrier can't (downed, paralyzed, gone) or the carried one is no longer a paralyzed hero on the map. */
export function checkCarries(c: Ctx): void {
  for (const h of c.d.heroes) {
    if (!h.carrying) continue;
    const x = hd(c, h.carrying);
    const name = heroName(c, h.heroId);
    if (!x || x.status !== 'active') {
      endCarry(c, h, x && x.status === 'downed' ? `${heroName(c, x.heroId)} slips from ${name}'s shoulders.` : undefined);
    } else if (!isParalyzed(x)) {
      endCarry(c, h, `${heroName(c, x.heroId)} gets down from ${name}'s shoulders.`);
    } else if (!canStir(h)) {
      endCarry(c, h, h.status === 'active' || h.status === 'downed' ? `${name} drops ${heroName(c, x.heroId)}.` : undefined);
    }
  }
}

/**
 * After the carrier's move (spec 29.4): the carried ally is set on a free hex next to the carrier (as the escorted
 * prisoner: not onto doors but the open sally port gate, traps, vents or fire), nearest where they were.
 */
export function carryFollow(c: Ctx, h: HeroInDelve): void {
  checkCarries(c);
  const x = h.carrying ? hd(c, h.carrying) : undefined;
  if (!x || (adjacent(x.at, h.at))) return;
  const near = (p: Pos) => (p.level === x.at.level ? distance(p, x.at) : 99);
  const spot = posNeighbors(h.at)
    .filter((p) => canEnter(c.w, c.d, p) && !occupant(c, p) && !c.d.traps[posKey(p)] && !c.w.vents.has(posKey(p)) && !(c.d.burning?.[posKey(p)])
      && (kindAt(c.w, c.d, p) !== 'door' || !!c.w.tile(p)?.barred))
    .sort((a, b) => near(a) - near(b))[0];
  if (!spot) return;
  const from = x.at;
  x.at = { ...spot };
  if (from.level !== spot.level) c.ev.push({ type: 'levelChanged', id: x.heroId, from: from.level, to: spot.level });
  c.ev.push({ type: 'moved', id: x.heroId, path: [{ ...spot }] });
  if (!samePos(from, spot) && from.level === spot.level) x.facing = h.facing;
}

/** Items that are venom's business, for the bot and the UI. */
export function isAntidote(i: Item): boolean {
  return i.kind === 'antidote';
}
