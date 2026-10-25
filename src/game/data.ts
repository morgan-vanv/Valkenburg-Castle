// Numbers from docs/v3-spec.md.

import type { HeroClass, MonsterKind, ShopOffer, Stat, Stats } from './types';
import type { ClassInfo } from './api';

/** Spec 16.2: the lantern holds 20; stages bright > 12, dim 7..12, dark 1..6, pitch 0. */
export const LIGHT_MAX = 20;
export const LIGHT_BRIGHT = 12; // above this = bright
export const LIGHT_DIM = 7; // this..LIGHT_BRIGHT = dim
export const PACK_SLOTS = 4;
export const FOCUS_MAX = 3;
export const MANA_MAX = 3;
export const TORCH_ROUNDS = 12;
export const BLEED_START = 2;

export interface Weapon {
  name: string;
  slots: number;
  stat: Stat;
  dmg: number;
  /** Ranged weapons (the Ranger's longbow): reach in hexes, needs sight. */
  range?: number;
  /** Noise of an attack (default 2). */
  noise?: number;
}

export interface ClassDef {
  name: string;
  hp: number;
  stats: Stats;
  weapon: Weapon;
  armor: number;
  main: Stat;
  /** Mana per delve (the three mage schools). */
  mana: number;
}

export const CLASSES: Record<HeroClass, ClassDef> = {
  heir: {
    name: 'Lord',
    hp: 12,
    stats: { might: 65, finesse: 50, wits: 55, nerve: 80 },
    weapon: { name: 'Longsword', slots: 3, stat: 'might', dmg: 2 },
    armor: 1,
    main: 'might',
    mana: 0,
  },
  sellsword: {
    name: 'Sellsword',
    hp: 10,
    stats: { might: 70, finesse: 45, wits: 40, nerve: 60 },
    weapon: { name: 'Sword', slots: 3, stat: 'might', dmg: 2 },
    armor: 1,
    main: 'might',
    mana: 0,
  },
  burglar: {
    name: 'Burglar',
    hp: 7,
    stats: { might: 40, finesse: 75, wits: 60, nerve: 50 },
    weapon: { name: 'Dagger', slots: 2, stat: 'finesse', dmg: 2 },
    armor: 0,
    main: 'finesse',
    mana: 0,
  },
  ranger: {
    name: 'Ranger',
    hp: 8,
    stats: { might: 45, finesse: 75, wits: 60, nerve: 55 },
    weapon: { name: 'Longbow', slots: 3, stat: 'finesse', dmg: 2, range: 6, noise: 1 },
    armor: 0,
    main: 'finesse',
    mana: 0,
  },
  sapper: {
    name: 'Sapper',
    hp: 10,
    stats: { might: 65, finesse: 50, wits: 45, nerve: 60 },
    weapon: { name: 'Hammer', slots: 3, stat: 'might', dmg: 2 },
    armor: 1,
    main: 'might',
    mana: 0,
  },
  pyromancer: {
    name: 'Pyromancer',
    hp: 6,
    stats: { might: 30, finesse: 50, wits: 75, nerve: 55 },
    weapon: { name: 'Staff', slots: 2, stat: 'might', dmg: 1 },
    armor: 0,
    main: 'wits',
    mana: 3,
  },
  shadowmancer: {
    name: 'Shadowmancer',
    hp: 6,
    stats: { might: 30, finesse: 55, wits: 75, nerve: 50 },
    weapon: { name: 'Staff', slots: 2, stat: 'might', dmg: 1 },
    armor: 0,
    main: 'wits',
    mana: 3,
  },
  hedgewitch: {
    name: 'Hedgewitch',
    hp: 7,
    stats: { might: 35, finesse: 50, wits: 70, nerve: 65 },
    weapon: { name: 'Staff', slots: 2, stat: 'might', dmg: 1 },
    armor: 0,
    main: 'wits',
    mana: 3,
  },
};

/** Classes the tavern hires (spec 15.3). */
export const RECRUIT_CLASSES: HeroClass[] = ['sellsword', 'burglar', 'ranger', 'sapper', 'pyromancer', 'shadowmancer', 'hedgewitch'];

const ROLES: Record<HeroClass, { role: string; abilities: string[] }> = {
  heir: { role: 'The heir: steady, rallies the squad.', abilities: ['Rally: allies within 3 gain 1 Focus. Cooldown 3.'] },
  sellsword: { role: 'Tough: holds the line, shoves hard.', abilities: ['Guard: take the hits meant for an adjacent ally.', 'Shove: +1 slot.'] },
  burglar: {
    role: 'Quiet: picks locks, sneaks fast.',
    abilities: ['Pick locks.', 'Sneak 4.', 'Backstab: +1 slot on monsters not hunting.', 'Opens chests silently and takes loot without using the action.'],
  },
  ranger: {
    role: 'Eyes: shoots from range, holds a lane.',
    abilities: [
      'Longbow: range 6, noise 1. Adjacent shots lose 1 slot.',
      'Overwatch: shoot the first enemy that moves or acts in sight within 6 next world phase.',
      'Knockback shot: 2 Finesse slots at range 5; 2 hits push the target 1 hex back (pits!).',
    ],
  },
  sapper: {
    role: 'Breacher: blows walls, digs through.',
    abilities: ['Starts each delve with 2 free charges.', 'Throw a charge up to 3 hexes.', 'Dig: clear adjacent rubble or a cracked wall. Noise 4.'],
  },
  pyromancer: {
    role: 'Fire: burns crowds, lights the way.',
    abilities: [
      'Firebolt (1 mana): 3 Wits slots at range 5, 2 dmg per hit.',
      'Fireball (2 mana): radius 1 at range 5, 3 Wits slots, 2 dmg per hit to everyone there, allies too. Burns 2 rounds. Noise 6.',
      'Kindle (1 mana): +6 light.',
    ],
  },
  shadowmancer: {
    role: 'Shadow: hides allies, sleeps foes, blinks.',
    abilities: [
      'Veil (1 mana): an ally within 3 is unseen by monsters for 2 rounds, until they attack or make noise 4+.',
      'Sleep (1 mana): 2 Wits slots at range 5; a hit puts a monster to sleep.',
      'Blink (1 mana): teleport up to 4 to a free hex in sight, over pits. Silent.',
    ],
  },
  hedgewitch: {
    role: 'Warden: heals, shields, blows foes back.',
    abilities: [
      'Mend (1 mana): heal 4 within 3.',
      'Ward (1 mana): an ally within 3 takes 1 less per hit for 2 rounds.',
      'Gust (1 mana): everyone within 1 of a hex at range 4 is pushed 1 hex away from it. Noise 2.',
    ],
  },
};

export function classInfo(cls: HeroClass): ClassInfo {
  const c = CLASSES[cls];
  const w = c.weapon;
  return {
    name: c.name,
    role: ROLES[cls].role,
    weapon: `${w.name}: ${w.slots} ${w.stat[0]!.toUpperCase()}${w.stat.slice(1)} slots, ${w.dmg} dmg${w.range ? `, range ${w.range}` : ''}`,
    armor: c.armor,
    mana: c.mana,
    abilities: [...ROLES[cls].abilities],
  };
}

export interface MonsterDef {
  name: string;
  hp: number;
  slots: number;
  chance: number;
  dmg: number;
  move: number;
  xp: number;
  /** Armor: reduces each hit's damage, to a minimum of 1. */
  armor?: number;
}

export const MONSTERS: Record<MonsterKind | 'gloam', MonsterDef> = {
  rats: { name: 'Rats', hp: 3, slots: 2, chance: 50, dmg: 1, move: 4, xp: 1 },
  orc: { name: 'Orc', hp: 6, slots: 2, chance: 60, dmg: 2, move: 3, xp: 1 },
  spider: { name: 'Spider', hp: 5, slots: 2, chance: 65, dmg: 2, move: 3, xp: 1 },
  cutpurse: { name: 'Cutpurse', hp: 4, slots: 1, chance: 65, dmg: 1, move: 5, xp: 1 },
  berserker: { name: 'Berserker', hp: 10, slots: 4, chance: 60, dmg: 3, move: 4, xp: 3 },
  dragon: { name: 'The Dragon', hp: 30, slots: 4, chance: 65, dmg: 3, move: 3, xp: 0, armor: 1 },
  gloam: { name: 'The Gloam', hp: 99, slots: 0, chance: 100, dmg: 4, move: 3, xp: 0 },
  // V3.3 (spec 16.4)
  archer: { name: 'Orc archer', hp: 5, slots: 2, chance: 55, dmg: 2, move: 3, xp: 1 },
  captain: { name: 'Orc captain', hp: 9, slots: 3, chance: 60, dmg: 2, move: 3, xp: 2, armor: 1 },
  ghoul: { name: 'Ghoul', hp: 7, slots: 2, chance: 60, dmg: 2, move: 4, xp: 2 },
};

// Section 16 numbers.
/** Difficulty tiers by spawn level (16.3), applied to every monster but the Dragon and the Gloam. */
export const TIERS: Record<number, { hp: number; chance: number; dmg: number }> = {
  1: { hp: 0, chance: 0, dmg: 0 },
  2: { hp: 2, chance: 5, dmg: 0 },
  3: { hp: 4, chance: 10, dmg: 1 },
};
/** Rounds a monster that lost its quarry searches before going back to its route or post (16.1). */
export const SEARCH_ROUNDS = 3;
/** Monsters see heroes this far (line of sight), lit or within MONSTER_DARK_SIGHT. */
export const MONSTER_SIGHT = 6;
export const MONSTER_DARK_SIGHT = 3;
/** Sight range of a hero standing in an unlit hex, by level (16.2). */
export const DARK_SIGHT: Record<number, number> = { 1: 4, 2: 2, 3: 1 };
/** Spec 17.4: standing in a castle light that isn't daylight (fire, brazier, sconce, fungus, glow), you see this far minus depth (min 2). */
export const FIXED_LIGHT_SIGHT = 4;
export const ARCHER_RANGE = 4;
export const ARCHER_KEEP = 2; // archers stay at least this far away
export const CAPTAIN_SHOUT_RANGE = 8;
export const CAPTAIN_SHOUT_COOLDOWN = 4;
export const SHOUT_NOISE = 5;
export const GHOUL_RISE_RANGE = 2;
export const GLOAM_DMG = 4;
export const GLOAM_MOVE = 3;
export const GLOAM_RISE_MIN = 4;
export const GLOAM_RISE_MAX = 6;
export const GLOAM_CALM_FADE = 2;
export const BRAZIER_LIGHT = 4;
export const KINDLE_LIGHT = 6;
/** The Lantern Sisters' kit (16.5). */
export const SISTER_CLASSES: ('ranger' | 'shadowmancer' | 'burglar')[] = ['ranger', 'shadowmancer', 'burglar'];
export const SISTER_DARTS = 2;
export const SISTER_DART_CHANCE = 65;
export const SISTER_SMOKE = 1;
/** Neutral sisters head out when the lantern gets this low (was 18 of 40). */
export const SISTERS_LEAVE_LIGHT = 9;

export const SISTER = { hp: 7, slots: 3, chance: 55, dmg: 2, move: 4 };
export const SISTER_NAMES = ['Sister Wenna', 'Sister Odile', 'Sister Brisk'];

/** Total XP needed for each level (index = level). */
export const LEVEL_XP = [0, 0, 5, 12, 20, 30, 45];
export const MAX_LEVEL = 6;

export const BOUNTY = { rescue: [0, 80, 150, 220], recover: [0, 100, 180, 260], slay: [0, 500, 500, 500] } as const;
export const HEIRLOOM_VALUE = [0, 60, 120, 180];

// Section 14 numbers.
/** Reputation that puts Level 2, Level 3 and the slay contract on the board. */
export const REP_FOR_LEVEL = [0, 0, 1, 2];
export const REP_FOR_SLAY = 3;
export const SLAY_XP = 10;
export const HOARD_PIECES = 3;
export const HOARD_VALUE = 300;
export const HOARD_NAMES = ['Dragon-gold chalice', 'Crown of the old kings', 'Jeweled hauberk', 'Golden reliquary', 'Emerald idol'];
export const VENT_DMG = 3;
export const BREATH_DMG = 4;
export const BREATH_LEN = 5;
export const BREATH_NOISE = 6;
export const WINCH_NOISE = 6;
export const ORC_SHOVE_CHANCE = 60;
/** Noise that wakes the Dragon. */
export const DRAGON_WAKE_NOISE = 4;

export const SHOP: ShopOffer[] = [
  { kind: 'torch', name: 'Torch', price: 10, text: '12 rounds of light around the bearer.' },
  { kind: 'potion', name: 'Potion', price: 20, text: 'Heals 5. Gets a downed hero up.' },
  { kind: 'rope', name: 'Rope', price: 15, text: 'Anchor at the pit edge to climb down and back.' },
  { kind: 'charge', name: 'Blasting charge', price: 30, text: 'Opens locks and cracked walls. Very loud.' },
  { kind: 'smoke', name: 'Smoke bomb', price: 20, text: 'Throw 4: smoke blocks sight there for 2 rounds.' },
  { kind: 'glue', name: 'Glue bomb', price: 25, text: 'Throw 4: monsters within 1 are stuck for 2 rounds.' },
  { kind: 'dart', name: 'Sleep dart', price: 25, text: 'Throw 5: a Finesse hit puts a monster to sleep. Silent.' },
  { kind: 'caltrops', name: 'Caltrops', price: 15, text: 'Scatter next to you: the first monster across takes 2 and stops.' },
  { kind: 'hook', name: 'Grappling hook', price: 40, text: 'Climb from a pit landing back up a level. Reusable.' },
  { kind: 'key', name: 'Skeleton key', price: 30, text: 'Opens one locked door or chest, silently. One use.' },
  { kind: 'oil', name: 'Oil flask', price: 15, text: '+8 lantern light.' },
  { kind: 'firecracker', name: 'Firecracker', price: 10, text: 'Throw 6: noise 6 there. Lures monsters away.' },
];

// Section 15 numbers.
/** Spec 17.1: enough for two level-1 hires and nothing else, or one hire and a few cheap items. */
export const START_GOLD = 120;
/** Spec 17.1: a recruit costs RECRUIT_PRICE + RECRUIT_PRICE_PER_LEVEL × (level − 1). */
export const RECRUIT_PRICE = 60;
export const RECRUIT_PRICE_PER_LEVEL = 40;
export const TAVERN_SIZE = 4;
export const SAPPER_CHARGES = 2;
export const BOW_RANGE = 6;
export const OVERWATCH_RANGE = 6;
export const KNOCKBACK_RANGE = 5;
export const THROW_CHARGE_RANGE = 3;
export const DIG_NOISE = 4;
export const FIREBALL_RANGE = 5;
export const FIREBALL_NOISE = 6;
export const BURN_ROUNDS = 2;
export const BURN_DMG = 1;
export const SPELL_RANGE = 3; // veil, ward, mend
export const SLEEP_RANGE = 5;
export const BLINK_RANGE = 4;
export const GUST_RANGE = 4;
export const GUST_NOISE = 2;
export const VEIL_ROUNDS = 2;
export const WARD_ROUNDS = 2;
export const VEIL_BREAK_NOISE = 4;
export const THROW_RANGE: Record<'smoke' | 'glue' | 'dart' | 'firecracker', number> = { smoke: 4, glue: 4, dart: 5, firecracker: 6 };
export const SMOKE_ROUNDS = 2;
export const GLUE_ROUNDS = 2;
export const CALTROPS_DMG = 2;
export const OIL_LIGHT = 8;
export const FIRECRACKER_NOISE = 6;

/** Spec 17.2: the infirmary heals for this much gold per HP. Nothing heals for free between delves. */
export const HEAL_PER_HP = 3;
export const WEAPON_PRICE = [0, 60, 150];
export const ARMOR_PRICE = [0, 80, 200];

export const RECRUIT_NAMES = [
  'Ansel', 'Berta', 'Corin', 'Dagny', 'Eskil', 'Fenna', 'Gisli', 'Hilde', 'Ivo', 'Jutta',
  'Kort', 'Liesl', 'Marek', 'Nell', 'Osric', 'Petra', 'Quill', 'Roswitha', 'Sten', 'Tilde',
];

export const PRISONER_NAMES = [
  'Brother Edric', 'Maud the Miller', 'Old Tam', 'Sister Agathe', 'Young Wilm', 'Greta Vos',
];

export const HEIRLOOMS = [
  'the Valkenburg Signet', 'the Hobart Warhorn', 'Grandmother\'s Reliquary', 'the Silver Ewer',
  'the Burgrave\'s Seal', 'the Ivory Psalter',
];

export const GEMS = ['Garnet', 'Moonstone', 'Amethyst', 'Jet cameo', 'River pearl'];
export const JEWELRY = ['Silver ring', 'Gold torque', 'Signet ring', 'Pearl brooch', 'Jeweled pin'];
