// V5.1.2 "One for the road" (spec 34): the one table for how the ales look and talk, used by the taps (party.ts),
// the toast (toast.ts) and the delve HUD's tankard badge (hud.ts). Colour of the brew, its ink (text on dark), its
// icon, a short effect line, the toast's chip line and Wim's chalkboard line for the special. Plus the CSS tankard
// (camp.css .tank) and the pure helpers the taps use (what a pour or a round costs, why not), unit-tested in
// ales.test.ts. No rules here: prices, locks and the special come from the engine's `ales` offers.

import type { AleEffect, AleKind, AleOffer, Hero, Village } from '../../game/types';
import type { CampIcon } from './icons';

export type AleLookKey = AleKind | AleEffect;

export interface AleLook {
  /** The brew's colour (the tankard's body). */
  colour: string;
  /** Its ink: text in the ale's colour that reads on the dark table. */
  ink: string;
  icon: CampIcon;
  /** One short line: the tap, the mug, the HUD badge. */
  short: string;
  /** The toast's chip. */
  toast: string;
  /** Wim's chalkboard line when it's the special. */
  wim?: string;
  /** A Black Cask gone wrong. */
  bad?: boolean;
}

export const ALE_LOOK: Record<AleLookKey, AleLook> = {
  glowworm: { colour: '#cfe86a', ink: '#d8f080', icon: 'star', short: 'You glow: light 1', toast: 'Glows: light 1', wim: '"Brewed by glowworm light. Mostly."' },
  featherfoot: { colour: '#e8d08a', ink: '#f0dca0', icon: 'feather', short: 'First fall is free', toast: 'The first fall is free', wim: '"Light as a feather. Lands like one."' },
  mole: { colour: '#5a3a1e', ink: '#c89a6a', icon: 'pick', short: 'Dig like a Sapper', toast: 'Digs like a Sapper', wim: '"Dug it out of the cellar myself."' },
  reserve: { colour: '#b8681f', ink: '#f0b060', icon: 'crown', short: 'Focus starts at 4', toast: 'Focus starts at 4', wim: '"The old lord\'s own. Don\'t tell him."' },
  smuggler: { colour: '#e0a840', ink: '#f0c060', icon: 'hood', short: 'Sneak 4, silently', toast: 'Sneaks 4, silently', wim: '"Never came through the gate, this one."' },
  fireside: { colour: '#7a2e18', ink: '#e88a5a', icon: 'heart', short: 'Heal 3 a level', toast: 'Heals 3 on every level', wim: '"Warms you on the stairs."' },
  blackcask: { colour: '#1e1814', ink: '#b8aa98', icon: 'drop', short: '7 in 10, a good one', toast: 'Nobody knows', wim: '"Don\'t ask what\'s in it."' },
  nighteye: { colour: '#2c3458', ink: '#a8b4f0', icon: 'eye', short: 'See in the dark', toast: 'Sees in the dark', wim: '"Ilse\'s recipe. Drink it with the lamps out."' },
  spidermilk: { colour: '#e8e2d2', ink: '#f2ecdc', icon: 'spider', short: "Poison won't take", toast: "Poison won't take", wim: '"Don\'t ask Ilse where the milk comes from."' },
  dragonfire: { colour: '#c8401a', ink: '#ff8a5a', icon: 'flame', short: 'Fire hurts 2 less', toast: 'Fire hurts 2 less', wim: '"Breathe out before you drink."' },
  hiccups: { colour: '#8a8a3a', ink: '#d6d27a', icon: 'warn', short: 'Hiccups: noise 1', toast: 'Hiccups! Noise 1 a turn', bad: true },
  heavyhead: { colour: '#4a4658', ink: '#b0aac8', icon: 'anvil', short: 'Heavy head: Focus 1', toast: 'Heavy head: Focus starts at 1', bad: true },
};

/** A toast for each class; one picked by the hero's id so a hero says the same thing every time. Keven's is fixed. */
export const CLASS_TOAST: Record<string, string[]> = {
  heir: ['To Valkenburg!'],
  sellsword: ['To getting paid.', 'To the next one.'],
  burglar: ['To open doors.', 'To light fingers.'],
  ranger: ['To a clear shot.', 'To the long way round.'],
  sapper: ['To loud endings!', 'To the walls coming down.'],
  pyromancer: ['To warm hands.', 'To a good blaze.'],
  shadowmancer: ['To the dark.', 'To what doesn\'t see us.'],
  hedgewitch: ['Mind the roots.', 'To green things.'],
  mage: ['To the old words.'],
};

/** The hero's toast line (stable per hero). */
export function toastLine(cls: string, heroId: string): string {
  const lines = CLASS_TOAST[cls] ?? ['To the road.'];
  let n = 0;
  for (const ch of heroId) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return lines[n % lines.length]!;
}

export const aleLook = (k: AleLookKey): AleLook => ALE_LOOK[k] ?? ALE_LOOK.blackcask;

/** The CSS tankard (camp.css .tank) in an ale's colour; `dry` for a dry tap, `empty` for an empty mug. */
export function tankard(k: AleLookKey | null, opts: { size?: number; dry?: boolean; glow?: boolean; class?: string } = {}): HTMLElement {
  const el = document.createElement('span');
  el.className = `tank${opts.dry ? ' dry' : ''}${opts.glow || k === 'glowworm' ? ' glow' : ''}${opts.class ? ` ${opts.class}` : ''}`;
  el.setAttribute('aria-hidden', 'true');
  if (k) el.style.setProperty('--ale', aleLook(k).colour);
  if (opts.size) el.style.setProperty('--tw', `${opts.size}px`);
  for (const part of ['gl', 'hd', 'fm']) {
    const i = document.createElement('i');
    i.className = part;
    el.append(i);
  }
  return el;
}

// ------------------------------------------------------------------------------------------------ pure helpers

/** Can this ale be poured for this hero now? True, or the reason (shown on the dimmed mug). */
export function pourCheck(hr: Pick<Hero, 'name' | 'ale'>, o: Pick<AleOffer, 'name' | 'price' | 'locked'>, gold: number): true | string {
  if (o.locked) return `${o.name} · dry tap\n${o.locked}`;
  if (hr.ale) return `${hr.name} already has one waiting · one a delve\nClick their mug to tip it back first.`;
  if (gold < o.price) return `${o.name} · ${o.price} gold\nYou have ${gold} gold.`;
  return true;
}

/** A round of one ale: every party hero without an ale. `ok` false with the reason when the gold won't cover it. */
export function roundOf(party: Pick<Hero, 'id' | 'name' | 'ale'>[], o: Pick<AleOffer, 'price' | 'locked'>, gold: number): { ids: string[]; names: string[]; total: number; ok: boolean; reason?: string } {
  const dry = party.filter((x) => !x.ale);
  const total = dry.length * o.price;
  const base = { ids: dry.map((x) => x.id), names: dry.map((x) => x.name), total };
  if (o.locked) return { ...base, ok: false, reason: 'Dry tap.' };
  if (!dry.length) return { ...base, ok: false, reason: 'Everyone going in has one waiting.' };
  if (gold < total) return { ...base, ok: false, reason: `A round is ${total} gold. You have ${gold}.` };
  return { ...base, ok: true };
}

/** Wim's chalk for a dry tap, in his voice (the engine's `locked` says the rule on hover). */
export function chalkFor(o: Pick<AleOffer, 'needs'>, v: Partial<Village>): string {
  if (!v.innkeeper) return 'Old Wim is still in the castle kitchens.';
  if (o.needs === 'alchemist') return '"Ilse knows the recipe. Find her."';
  if (!v.copper) return '"No copper, no brew. It\'s in the barracks."';
  return '"My cask book\'s down in the Drain."';
}

/** Dry taps grouped by their chalk line (neighbours with the same line share one), in tap order. */
export function chalkGroups<T extends Pick<AleOffer, 'needs' | 'locked'>>(offers: T[], v: Partial<Village>): { chalk: string | null; taps: T[] }[] {
  const out: { chalk: string | null; taps: T[] }[] = [];
  for (const o of offers) {
    const chalk = o.locked ? chalkFor(o, v) : null;
    const last = out[out.length - 1];
    if (last && chalk !== null && last.chalk === chalk) last.taps.push(o);
    else out.push({ chalk, taps: [o] });
  }
  return out;
}

/** The taps in the order they stand on the bar: live ones first (the special among them where it falls), then dry. */
export function tapOrder<T extends Pick<AleOffer, 'locked'>>(offers: T[]): T[] {
  return [...offers.filter((o) => !o.locked), ...offers.filter((o) => o.locked)];
}

// ------------------------------------------------------------------------------------------------ the toast's plan

export interface Drinker {
  heroId: string;
  name: string;
  cls: string;
  /** What they drank, as it works in the delve (a Black Cask already resolved by startDelve); undefined: nothing. */
  ale?: AleEffect;
  /** It came out of the Black Cask. */
  cask: boolean;
  /** Their toast. */
  line: string;
}

/**
 * V5.1.2: who raises what, read from the states either side of startDelve (the engine decided everything, including
 * the Black Cask on the seeded dice): every hero going in, in party order. Empty when nobody drank (no toast).
 */
export function toastPlan(
  before: { campaign: { roster: Pick<Hero, 'id' | 'ale'>[] } },
  after: { stage: string; campaign: { roster: Pick<Hero, 'id' | 'name' | 'cls'>[] }; delve: { heroes: { heroId: string; ale?: AleEffect }[] } | null },
): Drinker[] {
  if (after.stage !== 'delve' || !after.delve) return [];
  const out: Drinker[] = after.delve.heroes.map((hd) => {
    const hr = after.campaign.roster.find((x) => x.id === hd.heroId);
    const was = before.campaign.roster.find((x) => x.id === hd.heroId)?.ale;
    const cls = hr?.cls ?? 'heir';
    return { heroId: hd.heroId, name: hr?.name ?? hd.heroId, cls, ale: hd.ale, cask: was === 'blackcask' && !!hd.ale, line: toastLine(cls, hd.heroId) };
  });
  return out.some((d) => d.ale) ? out : [];
}
