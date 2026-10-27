// V4.1 (WS3, spec 31.4, owner-approved): poison, carrying and the shackled captive. Replaces V4.0's venom and paralysis
// (spec 29). A dose poisons a hero, monster (not the Dragon or the Gloam) or crew member: at step 2 of every world phase it
// takes POISON_DMG, never below POISON_FLOOR (poison never downs anyone and doesn't tick on the downed), until cured: an
// antipoison (an action, yourself or an adjacent ally, up or downed), Mend, or leaving the castle. Spider-milk Stout's
// drinker can't be poisoned. Carry: an action next to a downed hero or the shackled captive; the body shares the carrier's
// hex and moves with them; the carrier moves CARRY_MOVE at most and takes free actions only; leaving takes the body out.
// Unshackle: lockpicks, an improvised pick or the skeleton key (spec 31.11: no Smash); the unshackled captive follows its freer.
// Design pillar 17: crews are poisoned, go down and are carried by the same rules.

import { posNeighbors, samePos, type Pos } from './hex';
import type { HeroInDelve, Item } from './types';
import { CARRIED_OUT_HP, POISON_DMG, POISON_FLOOR, TRAP_DMG, VENOM_TRAP_DMG } from './data';
import { say, type Ctx, type MonsterX, type RivalX } from './state';
import { bringCarried, carrierOf, hd, heroName, onMap, rivalsOnMap, setDownNear } from './common';
import { partySees } from './hearing';
import { adjacent } from './world';

type Poisonable = { poisoned?: boolean; hp: number };

/** Poisoned now. */
export function isPoisoned(f: { poisoned?: boolean } | undefined | null): boolean {
  return !!f?.poisoned;
}

/** What a figure is, for poison: a hero in the castle (up or downed), a monster (not the Dragon or the Gloam), a crew member up. */
function poisonTarget(c: Ctx, id: string): { name: string; f: Poisonable; at: Pos; hero?: HeroInDelve; monster?: MonsterX; rival?: RivalX } | null {
  const h = hd(c, id);
  if (h) return h.status === 'active' || h.status === 'downed' ? { name: heroName(c, id), f: h, at: h.at, hero: h } : null;
  const m = c.d.monsters.find((x) => x.id === id);
  if (m) return m.buried || m.kind === 'dragon' || m.kind === 'gloam' ? null : { name: m.name, f: m, at: m.at, monster: m };
  const r = rivalsOnMap(c).find((x) => x.id === id);
  if (r) return { name: r.name, f: r, at: r.at, rival: r };
  return null;
}

/** Can poison take hold of this figure (not the Dragon, the Gloam or the prisoner; not a Spider-milk Stout drinker; not poisoned already)? */
export function poisonTakes(c: Ctx, id: string): boolean {
  const t = poisonTarget(c, id);
  if (!t || t.f.poisoned) return false;
  return !(t.hero && t.hero.ale === 'spidermilk');
}

/**
 * A dose of poison (spec 31.4): the figure is poisoned until cured; a second dose changes nothing. Returns true when it
 * took. No dice: the roll (a bite that hit, a dart that hit, a trap stepped on) is the caller's.
 */
export function poison(c: Ctx, id: string, by: string): boolean {
  const t = poisonTarget(c, id);
  if (!t || t.f.poisoned) return false;
  if (t.hero && t.hero.ale === 'spidermilk') {
    say(c, `The poison can't take hold of ${t.name}. Spider-milk Stout.`);
    return false;
  }
  t.f.poisoned = true;
  c.ev.push({ type: 'poisoned', id, by });
  if (t.hero || partySees(c, t.at)) say(c, `${t.name} is poisoned.`);
  return true;
}

/** Poison drawn out (an antipoison, Mend, leaving the castle). Returns true if there was any. */
export function curePoison(c: Ctx, id: string, how: 'antidote' | 'mend' | 'out', by?: string): boolean {
  const f: Poisonable | undefined = hd(c, id) ?? c.d.monsters.find((x) => x.id === id) ?? c.d.rivals?.members.find((x) => x.id === id);
  if (!f?.poisoned) return false;
  f.poisoned = undefined;
  c.ev.push({ type: 'cured', id, how, ...(by ? { by } : {}) });
  return true;
}

/**
 * The world phase's poison step (spec 31.4), after the bleeding: every poisoned figure that is up takes POISON_DMG, never
 * below POISON_FLOOR. Heroes in the castle (not downed), monsters on the map (not the Dragon or the Gloam), crew members up.
 * No dice, no noise, no turning: it is a slow hurt, not an attack.
 */
export function poisonTick(c: Ctx): void {
  const hurt = (id: string, f: Poisonable) => {
    if (!f.poisoned || f.hp <= POISON_FLOOR) return;
    const dmg = Math.min(POISON_DMG, f.hp - POISON_FLOOR);
    f.hp -= dmg;
    c.ev.push({ type: 'hit', attacker: 'poison', target: id, damage: dmg, crit: false });
  };
  for (const h of c.d.heroes) if (h.status === 'active') hurt(h.heroId, h);
  for (const m of onMap(c)) if (m.kind !== 'dragon' && m.kind !== 'gloam') hurt(m.id, m);
  for (const r of rivalsOnMap(c)) hurt(r.id, r);
}

// ---------------------------------------------------------------- traps (spec 29.5, 31.4)

/** A trap's bite: 3 damage, or 1 and a dose for a poison trap (`venom`, internal name kept). */
export function trapDamage(t: { venom?: boolean } | undefined): number {
  return t?.venom ? VENOM_TRAP_DMG : TRAP_DMG;
}

// ---------------------------------------------------------------- carrying (spec 31.4)

/** Can this hero pick up a body: active, awake, not held, carrying nothing? */
function canLift(h: HeroInDelve): boolean {
  return h.status === 'active' && !h.carrying && !h.grabbedBy && !(h as { dozing?: boolean }).dozing;
}

/** Bodies next to `h` that `h` could Carry: a downed hero or the shackled captive that nobody carries. */
export function carryable(c: Ctx, h: HeroInDelve): { id: string; at: Pos }[] {
  if (!canLift(h)) return [];
  const out: { id: string; at: Pos }[] = [];
  for (const o of c.d.heroes) {
    if (o === h || o.status !== 'downed' || !adjacent(o.at, h.at) || carrierOf(c, o.heroId)) continue;
    out.push({ id: o.heroId, at: o.at });
  }
  const pr = c.d.prisoner;
  if (pr && !pr.freed && !pr.dead && !pr.out && adjacent(pr.at, h.at) && !carrierOf(c, pr.id)) out.push({ id: pr.id, at: pr.at });
  return out;
}

/** The name of a carried body (a hero or the captive). */
export function bodyName(c: Ctx, id: string): string {
  return c.d.prisoner?.id === id ? c.d.prisoner.name : heroName(c, id);
}

/** Lift the body: it shares the carrier's hex from now on. */
export function startCarry(c: Ctx, h: HeroInDelve, id: string): void {
  h.carrying = id;
  bringCarried(c, h.heroId);
  c.ev.push({ type: 'carried', by: h.heroId, id });
  c.ev.push({ type: 'moved', id, path: [{ ...h.at }] });
}

/** Put the load down: onto a free hex next to the carrier (none free: on the carrier's hex). */
export function endCarry(c: Ctx, h: HeroInDelve, why?: string): void {
  const id = h.carrying;
  if (!id) return;
  h.carrying = undefined;
  c.ev.push({ type: 'setDown', by: h.heroId, id });
  if (h.status === 'active') setDownNear(c, id, h.at);
  if (why) say(c, why);
}

/** Carrying ends when the carried one is no longer a body to carry (got up, unshackled, dead, out) or the carrier can't. */
export function checkCarries(c: Ctx): void {
  for (const h of c.d.heroes) {
    if (!h.carrying) continue;
    const id = h.carrying;
    const x = hd(c, id);
    const pr = c.d.prisoner?.id === id ? c.d.prisoner : undefined;
    const gone = x ? x.status !== 'downed' : pr ? pr.freed || pr.dead || pr.out : true;
    if (h.status !== 'active') {
      h.carrying = undefined;
      continue;
    }
    if (gone) endCarry(c, h, x && x.status === 'active' ? `${heroName(c, id)} gets down from ${heroName(c, h.heroId)}'s shoulders.` : undefined);
  }
}

/** The body this hero carries, if any (hero or prisoner), for leaving and the view. */
export function carriedBody(c: Ctx, h: HeroInDelve): { hero?: HeroInDelve; prisoner?: boolean } | null {
  if (!h.carrying) return null;
  const x = hd(c, h.carrying);
  if (x) return { hero: x };
  return c.d.prisoner?.id === h.carrying ? { prisoner: true } : null;
}

/**
 * The carrier leaves the castle (spec 31.4): a carried downed hero comes out alive at CARRIED_OUT_HP; a carried captive is
 * rescued. Returns the line for the log, if anything came out.
 */
export function carryOut(c: Ctx, h: HeroInDelve): void {
  const id = h.carrying;
  if (!id) return;
  h.carrying = undefined;
  const x = hd(c, id);
  if (x && x.status === 'downed') {
    x.status = 'out';
    x.hp = CARRIED_OUT_HP;
    x.bleed = 0;
    c.ev.push({ type: 'out', id });
    say(c, `${heroName(c, h.heroId)} carries ${heroName(c, id)} out, alive.`);
    curePoison(c, id, 'out');
    return;
  }
  const pr = c.d.prisoner;
  if (pr && pr.id === id && !pr.dead) {
    pr.out = true;
    c.ev.push({ type: 'out', id: pr.id });
    say(c, `${heroName(c, h.heroId)} carries ${pr.name} out.`);
  }
}

/** A position on or next to `a` (the captive's "adjacent or on the hex"). */
export function closeTo(a: Pos, b: Pos): boolean {
  return samePos(a, b) || adjacent(a, b);
}

/** Neighbours of `p` (re-exported for the crew's carry walk). */
export const around = posNeighbors;

/** Items that are poison's business, for the bot and the UI. */
export function isAntidote(i: Item): boolean {
  return i.kind === 'antidote';
}
