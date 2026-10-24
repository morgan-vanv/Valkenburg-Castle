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

/** Rounds of light left before the next stage, or before 0. */
export function roundsToNext(light: number): { stage: Brightness; rounds: number } {
  if (light > 36) return { stage: 'dim', rounds: light - 36 };
  if (light >= 19) return { stage: 'dark', rounds: light - 18 };
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
  charge: 'c',
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
