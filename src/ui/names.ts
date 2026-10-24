// Player-facing names, glyphs and short texts.

import type { ActionKind, Brightness, HeroClass, Item, MonsterKind } from '../game/types';

export const CLASS_NAME: Record<HeroClass, string> = {
  hobart: 'Lord',
  sellsword: 'Sellsword',
  burglar: 'Burglar',
  mage: 'Hedge Mage',
};

/** Counter-style badge glyph, 1980 style. */
export const CLASS_GLYPH: Record<HeroClass, string> = {
  hobart: 'L',
  sellsword: 'S',
  burglar: 'B',
  mage: 'M',
};

export const CLASS_BLURB: Record<HeroClass, string> = {
  hobart: 'The heir. Rally: +1 Focus to allies nearby. If he dies, it is over.',
  sellsword: 'Hits hard, takes hits. Guard: soak blows aimed at an ally.',
  burglar: 'Picks locks, sneaks fast, backstabs the unwary.',
  mage: 'Firebolt, Kindle the lantern, Mend wounds. Fragile.',
};

export const MONSTER_NAME: Record<MonsterKind | 'gloam', string> = {
  rats: 'Rats',
  orc: 'Orc',
  spider: 'Spider',
  cutpurse: 'Cutpurse',
  berserker: 'Berserker',
  gloam: 'The Gloam',
};

export const BRIGHTNESS_NAME: Record<Brightness, string> = {
  bright: 'Bright',
  dim: 'Dim',
  dark: 'Dark',
  pitch: 'Pitch black',
};

/** Light thresholds learned from the engine (balance changes them). */
export interface LightScale {
  max: number;
  /** Lowest light value of each stage. */
  min: Record<Brightness, number>;
}

/** Probe engine.brightness on light values 0..200 to find the stage edges and the max. */
export function lightScale(brightness: (light: number) => Brightness, maxGuess: number): LightScale {
  const min: Record<Brightness, number> = { bright: Infinity, dim: Infinity, dark: Infinity, pitch: 0 };
  for (let l = 200; l >= 0; l--) {
    const b = brightness(l);
    if (l < min[b]) min[b] = l;
  }
  return { max: maxGuess, min };
}

/** Rounds of light left before the next stage, or before 0. */
export function roundsToNext(light: number, sc: LightScale): { stage: Brightness; rounds: number } {
  if (light >= sc.min.bright) return { stage: 'dim', rounds: light - sc.min.bright + 1 };
  if (light >= sc.min.dim) return { stage: 'dark', rounds: light - sc.min.dim + 1 };
  if (light >= 1) return { stage: 'pitch', rounds: light };
  return { stage: 'pitch', rounds: 0 };
}

export const ACTION_GLYPH: Partial<Record<ActionKind, string>> = {
  attack: '⚔',
  pick: '⚷',
  smash: '✊',
  open: '◫',
  take: '⇡',
  drop: '⇣',
  give: '⇄',
  disarm: '✂',
  light: '♨',
  torch: '🜂',
  potion: '⚱',
  revive: '✚',
  charge: '✹',
  rope: '⌇',
  climb: '⇅',
  jump: '⤓',
  shove: '⇥',
  free: '⛓',
  bribe: '¤',
  rally: '⚑',
  guard: '⛨',
  firebolt: '☄',
  kindle: '✦',
  mend: '✚',
  passLantern: '◆',
  leave: '⇱',
};

/** Hotkey per action (letters not used by the global keys). */
export const ACTION_KEY: Partial<Record<ActionKind, string>> = {
  attack: 'a',
  firebolt: 'f',
  pick: 'p',
  smash: 'x',
  open: 'o',
  take: 'g',
  torch: 't',
  potion: 'h',
  revive: 'v',
  light: 'l',
  rally: 'r',
  guard: 'r',
  kindle: 'k',
  mend: 'm',
  free: 'g',
  leave: 'q',
  disarm: 'd',
  shove: 'z',
  bribe: 'b',
  charge: 'w',
  passLantern: 'n',
  rope: 'y',
  climb: 'y',
  jump: 'j',
  give: 'i',
  drop: 'u',
};

export const ITEM_GLYPH: Record<Item['kind'], string> = {
  gold: '¤',
  gem: '◆',
  jewelry: '◎',
  torch: '🜂',
  potion: '⚱',
  rope: '⌇',
  charge: '✹',
  heirloom: '♛',
};

export function itemLabel(i: Item): string {
  if (i.kind === 'gold') return `${i.amount} gold`;
  if (i.kind === 'gem' || i.kind === 'jewelry') return `${i.name} (${i.amount})`;
  return i.name;
}
