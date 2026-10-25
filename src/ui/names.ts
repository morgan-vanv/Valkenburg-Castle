// Player-facing names, glyphs and short texts.

import type { ActionKind, Brightness, HeroClass, Item, MonsterKind } from '../game/types';

/** Every class the UI knows (V3.1 'mage' kept so old data still renders). */
export type AnyClass = HeroClass | 'mage' | 'sellsword' | 'burglar' | 'ranger' | 'sapper' | 'pyromancer' | 'shadowmancer' | 'hedgewitch';

export const CLASS_NAME: Record<AnyClass, string> = {
  hobart: 'Lord',
  sellsword: 'Sellsword',
  burglar: 'Burglar',
  mage: 'Hedge Mage',
  ranger: 'Ranger',
  sapper: 'Sapper',
  pyromancer: 'Pyromancer',
  shadowmancer: 'Shadowmancer',
  hedgewitch: 'Hedgewitch',
};

/** Counter-style badge glyph, 1980 style. */
export const CLASS_GLYPH: Record<AnyClass, string> = {
  hobart: 'L',
  sellsword: 'S',
  burglar: 'B',
  mage: 'M',
  ranger: 'R',
  sapper: 'X',
  pyromancer: 'P',
  shadowmancer: 'D',
  hedgewitch: 'W',
};

/** One-line role, shown big on recruit cards. */
export const CLASS_ROLE: Record<AnyClass, string> = {
  hobart: 'The heir: rallies the squad. If he dies, it is over.',
  sellsword: 'Front line: hits hard, guards allies, shoves harder.',
  burglar: 'Quiet: picks locks, sneaks fast, backstabs.',
  mage: 'Spells: firebolt, kindle, mend. Fragile.',
  ranger: 'Ranged: longbow, overwatch, knockback shots into pits.',
  sapper: 'Breacher: throws charges, digs through rubble and cracked walls.',
  pyromancer: 'Fire: firebolt, fireball (burns allies too), kindle the lantern.',
  shadowmancer: 'Shadow: veil allies, put monsters to sleep, blink across gaps.',
  hedgewitch: 'Support: mend wounds, ward allies, gust enemies off ledges.',
};

/** Longer text: kit and abilities (from docs/v3-spec.md 15.3). */
export const CLASS_BLURB: Record<AnyClass, string> = {
  hobart: 'The heir. Rally: +1 Focus to allies nearby. If he dies, it is over.',
  sellsword: 'Hits hard, takes hits. Guard: soak blows aimed at an ally.',
  burglar: 'Picks locks, sneaks fast, backstabs the unwary.',
  mage: 'Firebolt, Kindle the lantern, Mend wounds. Fragile.',
  ranger: 'Longbow at range 6.',
  sapper: 'Hammer and a pack of charges.',
  pyromancer: 'Staff, mana 3.',
  shadowmancer: 'Staff, mana 3.',
  hedgewitch: 'Staff, mana 3.',
};

/** Weapon and armor line per class (spec 15.3), for recruit cards. */
export const CLASS_GEAR: Record<AnyClass, string> = {
  hobart: 'Sword (Might, 3 slots) · Armor 2',
  sellsword: 'Sword (Might, 3 slots, 2 dmg) · Armor 1',
  burglar: 'Dagger (Finesse, 2 slots, 2 dmg) · Armor 0',
  mage: 'Staff (Might, 2 slots, 1 dmg) · Armor 0',
  ranger: 'Longbow (Finesse, 3 slots, 2 dmg, range 6) · Armor 0',
  sapper: 'Hammer (Might, 3 slots, 2 dmg) · Armor 1',
  pyromancer: 'Staff (Might, 2 slots, 1 dmg) · Armor 0 · Mana 3',
  shadowmancer: 'Staff (Might, 2 slots, 1 dmg) · Armor 0 · Mana 3',
  hedgewitch: 'Staff (Might, 2 slots, 1 dmg) · Armor 0 · Mana 3',
};

/** Abilities and spells per class: [name, cost or kind, effect]. */
export const CLASS_KIT: Record<AnyClass, [string, string, string][]> = {
  hobart: [['Rally', 'ability', '+1 Focus to allies within 3; ready every 3 rounds.']],
  sellsword: [
    ['Guard', 'ability', 'Soak blows aimed at an adjacent ally until your next turn.'],
    ['Shove', 'ability', '+1 slot: push an enemy 1 hex (into a pit, it falls).'],
  ],
  burglar: [
    ['Pick', 'ability', 'Pick locks on doors and chests.'],
    ['Sneak 4', 'passive', 'Sneaks further than anyone.'],
    ['Backstab', 'passive', 'Extra damage on unaware monsters.'],
    ['Light fingers', 'passive', 'Opens and takes from chests silently.'],
  ],
  mage: [
    ['Firebolt', '1 mana', 'Fire at range.'],
    ['Kindle', '1 mana', '+6 lantern oil.'],
    ['Mend', '1 mana', 'Heal 4 within 3.'],
  ],
  ranger: [
    ['Overwatch', 'action', 'Shoot the first enemy that moves or acts in sight within 6 next world phase.'],
    ['Knockback shot', 'ability', '2 Finesse slots, range ≤ 5: 2 hits push the target 1 hex (pits!).'],
    ['Close quarters', 'passive', 'Adjacent bow shots lose 1 slot.'],
  ],
  sapper: [
    ['2 free charges', 'passive', 'Starts every delve with 2 blasting charges.'],
    ['Throw charge', 'ability', 'Throw a charge up to 3 hexes (in sight).'],
    ['Dig', 'action', 'Clear adjacent rubble or a cracked wall, no charge. Noise 4.'],
  ],
  pyromancer: [
    ['Firebolt', '1 mana', 'Fire at range.'],
    ['Fireball', '2 mana', 'Radius 1 at range ≤ 5, 3 Wits slots, 2 dmg per hit to everything there (allies too). Burns 2 rounds. Noise 6.'],
    ['Kindle', '1 mana', '+6 lantern oil.'],
  ],
  shadowmancer: [
    ['Veil', '1 mana', 'An ally within 3 is unseen by monsters for 2 rounds (until they attack or make noise ≥ 4).'],
    ['Sleep', '1 mana', '2 Wits slots, range ≤ 5: 1+ hits puts a monster to sleep (not the Dragon or the Gloam).'],
    ['Blink', '1 mana', 'Teleport up to 4 hexes in sight, across pits and gaps. Silent.'],
  ],
  hedgewitch: [
    ['Mend', '1 mana', 'Heal 4 on an ally within 3.'],
    ['Ward', '1 mana', 'An ally within 3 takes 1 less per hit for 2 rounds.'],
    ['Gust', '1 mana', 'Push every figure within 1 of a hex (range ≤ 4) 1 hex outward. Noise 2.'],
  ],
};

export function className(cls: string): string {
  return CLASS_NAME[cls as AnyClass] ?? cls;
}
export function classGlyph(cls: string): string {
  return CLASS_GLYPH[cls as AnyClass] ?? '?';
}

export const MONSTER_NAME: Record<MonsterKind | 'gloam', string> = {
  rats: 'Rats',
  orc: 'Orc',
  spider: 'Spider',
  cutpurse: 'Cutpurse',
  berserker: 'Berserker',
  dragon: 'The Dragon',
  gloam: 'The Gloam',
  archer: 'Orc archer',
  captain: 'Orc captain',
  ghoul: 'Ghoul',
};

/** V3.3 (spec 16.4): one line per new monster, for tooltips. */
export const MONSTER_NOTE: Partial<Record<MonsterKind | 'gloam', string>> = {
  archer: 'Shoots at range 4, keeps its distance. Knockback shot if a pit is behind you.',
  captain: 'Armor 1. Orcs beside it take 1 less per hit. Shouts: every orc within 8 wakes and hunts.',
  ghoul: 'Rises from the ground when you come within 2. Grabs: you can’t move until you Escape or kill it.',
  spider: 'Webs you, then drags you one hex toward it (pits count).',
  gloam: 'Cannot be harmed. Only hunts heroes standing in the dark. Get into the light.',
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
  winch: '⚙',
  leave: '⇱',
  overwatch: '👁',
  knockback: '➹',
  throwCharge: '✹',
  dig: '⛏',
  fireball: '☀',
  veil: '◐',
  sleep: '☾',
  blink: '⟿',
  ward: '⛉',
  gust: '≋',
  smoke: '☁',
  glue: '◍',
  dart: '➶',
  caltrops: '⁂',
  firecracker: '✺',
  key: '⚷',
  oil: '♁',
  grapple: '⚓',
  shutter: '◑',
  escape: '⛓',
};

/** One-line help per V3.2 action, shown in the action button tooltip. */
export const ACTION_HELP: Partial<Record<ActionKind, string>> = {
  overwatch: 'Spend the action: next world phase, shoot the first enemy that moves or acts in sight within 6.',
  knockback: '2 Finesse slots at range ≤ 5. 2 hits push the target 1 hex away (into pits!).',
  throwCharge: 'Throw a blasting charge up to 3 hexes. Loud.',
  dig: 'Clear adjacent rubble or a cracked wall. Noise 4.',
  fireball: '2 mana. Radius 1 at range ≤ 5, 2 damage per hit to everyone there, allies too. Burns 2 rounds. Noise 6.',
  veil: '1 mana. An ally within 3 is unseen by monsters for 2 rounds (breaks on attacking or loud noise).',
  sleep: '1 mana. 2 Wits slots at range ≤ 5: 1+ hits and the monster sleeps.',
  blink: '1 mana. Teleport up to 4 hexes to a free hex in sight, across pits. Silent.',
  ward: '1 mana. An ally within 3 takes 1 less per hit for 2 rounds.',
  gust: '1 mana. Everything within 1 of the hex is pushed 1 hex outward (pits!). Noise 2.',
  smoke: 'Throw 4: smoke on the hex and around it for 2 rounds. Blocks sight.',
  glue: 'Throw 4: monsters within 1 are stuck for 2 rounds.',
  dart: 'Throw 5, 1 Finesse slot: a hit puts a monster to sleep. Silent.',
  caltrops: 'Scatter on an adjacent hex: the first monster on it takes 2 and stops.',
  firecracker: 'Throw 6: noise 6 at the hex. Lures monsters.',
  key: 'Open an adjacent locked door or chest, silently. One use.',
  oil: '+8 lantern oil.',
  grapple: 'Climb straight up to the level above. Uses move and action.',
  shutter: 'Free. Shuttered: the lantern burns no oil and gives no light. Open it again any time. Level 1 has daylight in most rooms.',
  escape: '2 Might slots: 1 hit frees you from the ghoul’s grip. Killing it frees you too.',
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
  winch: 'w',
  overwatch: 'o',
  knockback: 'k',
  throwCharge: 'w',
  dig: 'd',
  fireball: 'b',
  veil: 'v',
  sleep: 'z',
  blink: 'j',
  ward: 'r',
  gust: 'x',
  smoke: 'm',
  glue: 'u',
  dart: 'z',
  caltrops: 'y',
  firecracker: 'i',
  key: 'p',
  oil: 'l',
  grapple: 'y',
  shutter: 'l',
  escape: 'x',
};

export const ITEM_GLYPH: Record<string, string> = {
  gold: '¤',
  gem: '◆',
  jewelry: '◎',
  torch: '🜂',
  potion: '⚱',
  rope: '⌇',
  charge: '✹',
  heirloom: '♛',
  hoard: '♜',
  smoke: '☁',
  glue: '◍',
  dart: '➶',
  caltrops: '⁂',
  grapple: '⚓',
  key: '⚷',
  oil: '♁',
  firecracker: '✺',
};

/** Glyph for any item kind, tolerant of names the engine picks (smokeBomb, sleepDart, skeletonKey...). */
export function itemGlyph(kind: string): string {
  return ITEM_GLYPH[itemBase(kind)] ?? '•';
}

/** Normalise engine item kind names to the UI's short keys. */
export function itemBase(kind: string): string {
  const k = kind.toLowerCase();
  if (k.includes('smoke')) return 'smoke';
  if (k.includes('glue')) return 'glue';
  if (k.includes('dart')) return 'dart';
  if (k.includes('caltrop')) return 'caltrops';
  if (k.includes('grappl') || k === 'hook') return 'grapple';
  if (k.includes('key')) return 'key';
  if (k.includes('oil')) return 'oil';
  if (k.includes('firecracker') || k.includes('cracker')) return 'firecracker';
  return kind;
}

/** One-line effect per shop item (spec 15.4). Used when the engine's text is missing or long. */
export const ITEM_EFFECT: Record<string, string> = {
  torch: 'Light it for your own pool of light that lasts several rounds.',
  potion: 'Drink or give: heals 5.',
  rope: 'Anchor at a pit edge to climb between levels.',
  charge: 'Blast a door, chest or cracked wall open. Loud.',
  smoke: 'Throw 4: smoke on the hex and around it for 2 rounds. Blocks sight; monsters lose you.',
  glue: 'Throw 4: monsters within 1 are stuck for 2 rounds.',
  dart: 'Throw 5, 1 Finesse slot: a hit puts a monster to sleep. Silent.',
  caltrops: 'Scatter next to you: the first monster on it takes 2 and stops. Lasts the delve.',
  grapple: 'From a pit floor or landing, climb straight up a level. Reusable. Move and action.',
  key: 'Opens one locked door or chest, silently, for anyone. One use.',
  oil: '+8 lantern oil. Light burns 1 per round while the lantern is open.',
  firecracker: 'Throw 6: noise 6 at the target hex. Lure monsters away.',
};

export function itemLabel(i: Item): string {
  if (i.kind === 'gold') return `${i.amount} gold`;
  if (i.kind === 'gem' || i.kind === 'jewelry') return `${i.name} (${i.amount})`;
  return i.name;
}
