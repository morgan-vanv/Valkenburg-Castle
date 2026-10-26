// Numbers from docs/v3-spec.md.

import type { AleEffect, AleOffer, CrewId, DealKind, HeroClass, ItemKind, MonsterKind, RivalClass, ShopOffer, Stat, Stats, StoryId } from './types';
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
  heir: { role: 'The heir: steady, rallies the squad.', abilities: ['Rally: allies within 3 gain 1 Focus. Cooldown 3.', 'Brace: until your next turn, hits do 1 less and enemies roll −15% against you.'] },
  sellsword: { role: 'Tough: holds the line, shoves hard.', abilities: ['Guard: take the hits meant for an adjacent ally.', 'Shove: +1 slot.', 'Brace: until your next turn, hits do 1 less and enemies roll −15% against you.'] },
  burglar: {
    role: 'Quiet: picks locks, sneaks fast.',
    abilities: ['Pick locks.', 'Sneaks at full pace, with the quietest feet.', "Backstab: from behind an enemy that hasn't noticed you, +1 slot and double damage.", 'Opens chests without using the action.'],
  },
  ranger: {
    role: 'Eyes: shoots from range, holds a lane.',
    abilities: [
      'Longbow: range 6, noise 1. Adjacent shots lose 1 slot.',
      'Overwatch: shoot the first enemy that moves or acts in sight within 6 next world phase.',
      'Knockback shot: 2 Finesse slots at range 5; 2 hits push the target 1 hex back (pits!).',
      'Hamstring: 1 Finesse slot at −20% at range 5; a hit roots the target for 2 rounds (no moving, can still act). Noise 1.',
    ],
  },
  sapper: {
    role: 'Breacher: blows walls, digs through.',
    abilities: [
      'Satchel: 3 charges each delve; bought charges add to them.',
      'Set a charge (fuse 1 or 2) on an adjacent hex, door, chest or wall; throw one up to 3 hexes (fuse 1).',
      'Blast: 4 dmg within 1 and thrown back, 2 within 2; opens locks and breaks walls on Levels 1 and 2. Noise 8. The Sapper takes 0, friends half.',
      'Dig: clear adjacent rubble or a cracked wall. Noise 4.',
      'Brace: until your next turn, hits do 1 less and enemies roll −15% against you.',
    ],
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
      'Dread (1 mana): 2 Wits slots at range 5; a hit sends a monster or crew member fleeing from you for 2 rounds, taking free swings as it goes.',
      'Night thorn (1 mana): 2 Wits slots at range 5, 1 dmg per hit ignoring armor. Silent.',
    ],
  },
  hedgewitch: {
    role: 'Warden: heals, shields, blows foes back.',
    abilities: [
      'Mend (1 mana): heal 4 within 3.',
      'Ward (1 mana): an ally within 3 takes 1 less per hit for 2 rounds.',
      'Gust (1 mana): everyone within 1 of a hex at range 4 is pushed 1 hex away from it. Noise 2.',
      'Briar (1 mana): 2 Wits slots at range 4, 1 dmg per hit; any hit roots the target 1 round, a perfect roll 2. Noise 1.',
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
export const MONSTER_SIGHT = 8;
export const MONSTER_DARK_SIGHT = 5;
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
// ---------------------------------------------------------------- V3.7 stealth and swings (spec 20.1, 20.2)

/** Walking noise per hex passed (2 on rubble); sneaking is silent. */
export const STEP_NOISE = 1;
export const RUBBLE_STEP_NOISE = 2;
/** A hero passing within this many hexes of a sleeper rolls to wake it. */
export const WAKE_RANGE = 2;
export const WAKE_WALK = 50;
export const WAKE_SNEAK = 10;
/** Ending the move adjacent to a sleeper: walking wakes it for sure, sneaking this often. */
export const WAKE_END_SNEAK = 25;
/** Noticing ranges by light and move mode; in the Hollow light doesn't matter. The blind arc halves the walking range. */
/** V3.7.1 (spec 21.5): walking ranges +2 (lit 8, unlit 5, Hollow 8); sneaking unchanged. */
export const NOTICE = { litWalk: 8, litSneak: 4, unlitWalk: 5, unlitSneak: 1, hollowWalk: 8, hollowSneak: 3 } as const;
/** V3.9 (spec 24.3): the Burglar's quiet feet: a sneaking Burglar is noticed within 2 lit, adjacent unlit, 2 in the Hollow. */
export const NOTICE_QUIET = { litSneak: 2, unlitSneak: 1, hollowSneak: 2 } as const;
/** V3.9 (spec 24.3): a sneaking Burglar's sound rolls on sleepers: 5% per hex (others 10), ending adjacent 10% (others 25). */
export const WAKE_SNEAK_QUIET = 5;
export const WAKE_END_SNEAK_QUIET = 10;
/** V3.9 (spec 24.2): an attack on a hero from their rear half. */
export const BLINDSIDE_SLOTS = 1;
/** V3.9 (spec 24.3): backstab: +1 slot and this many times the weapon damage per hit (before armor). */
export const BACKSTAB_SLOTS = 1;
export const BACKSTAB_DMG_MULT = 2;
/** Sneak attack: +1 slot on a monster that hasn't noticed the attacker. */
export const SNEAK_ATTACK_SLOTS = 1;
/** Free swings: the usual attack with one slot fewer (min 1); a bow swings with 1 slot. */
export const SWING_SLOT_PENALTY = 1;
export const SWING_BOW_SLOTS = 1;
/** Dread (Shadowmancer): 1 mana, 2 Wits slots at range 5; 1+ hits = feared for 2 world phases. */
export const DREAD_MANA = 1;
export const DREAD_SLOTS = 2;
export const DREAD_RANGE = 5;
export const DREAD_ROUNDS = 2;

// ---------------------------------------------------------------- V3.7 kit and free movement (spec 20.5)

/** Free movement while calm: the castle takes a turn (a full world phase) every this many steps. */
export const CALM_STEPS = 4;
/**
 * V3.7.2 (spec 23.1): free movement while calm (spec 20.5) is switched off; the game is entirely
 * turn-based. The code stays for a later return (see docs/shelved/exploration-mode.md).
 */
export const FREE_MOVE = { enabled: false };
/**
 * V3.9.1 (spec 24.6): the free `face` command is shelved (off). V3.9.2 (spec 24.7): acting turns a hero
 * toward the action's target again (`turnOnAction`).
 */
export const FACING = { faceCommand: false, turnOnAction: true };
/** V3.9.3 (spec 24.8): heroes hear unseen enemies (footsteps, loud sounds). Off only in tests that prove monsters don't care. */
export const HEARING = { enabled: true };
/** Brace (heir, sellsword, sapper): hits do 1 less, enemies roll this much lower, until the next player phase. */
export const BRACE_DMG = 1;
export const BRACE_CHANCE = -15;
/** The forge shield: ranged hits do 1 less, 2 less while braced. 50 gold, needs the smith. */
export const SHIELD_DMG = 1;
export const SHIELD_BRACED_DMG = 2;
export const SHIELD_PRICE = 50;
/** Hamstring (anyone with a bow): 1 Finesse slot at −20, range 5 in sight; a hit roots 2 rounds. Noise 1. */
export const HAMSTRING_SLOTS = 1;
export const HAMSTRING_PENALTY = -20;
export const HAMSTRING_RANGE = 5;
export const HAMSTRING_ROUNDS = 2;
export const HAMSTRING_NOISE = 1;
/** Night thorn (Shadowmancer, 1 mana): 2 Wits slots, 1 dmg per hit ignoring armor, range 5, silent. */
export const NIGHTTHORN_MANA = 1;
export const NIGHTTHORN_SLOTS = 2;
export const NIGHTTHORN_RANGE = 5;
export const NIGHTTHORN_DMG = 1;
/** Briar (Hedgewitch, 1 mana): 2 Wits slots at range 4, 1 dmg per hit; a hit roots 1 round, a perfect roll 2. Noise 1. */
export const BRIAR_MANA = 1;
export const BRIAR_SLOTS = 2;
export const BRIAR_RANGE = 4;
export const BRIAR_DMG = 1;
export const BRIAR_ROOT = 1;
export const BRIAR_ROOT_PERFECT = 2;
export const BRIAR_NOISE = 1;
/** Smashing a crate or barrel: noise 4; 60% gold 3–12, 20% a small item, 20% nothing. */
export const SMASH_NOISE = 4;
export const SMASH_GOLD_CHANCE = 60;
export const SMASH_ITEM_CHANCE = 20;
export const SMASH_GOLD: [number, number] = [3, 12];
export const SMASH_ITEMS: ItemKind[] = ['torch', 'potion', 'firecracker', 'caltrops'];

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
  { kind: 'charge', name: 'Blasting charge', price: 30, text: 'Set it with a fuse: opens locks, breaks walls on Levels 1 and 2. Very loud.' },
  { kind: 'smoke', name: 'Smoke bomb', price: 20, text: 'Throw 4: smoke blocks sight there for 2 rounds.' },
  { kind: 'glue', name: 'Glue bomb', price: 25, text: 'Throw 4: monsters within 1 are stuck for 2 rounds.' },
  { kind: 'dart', name: 'Sleep dart', price: 25, text: 'Throw 5: a Finesse hit puts a monster to sleep. Silent.' },
  { kind: 'caltrops', name: 'Caltrops', price: 15, text: 'Scatter next to you: the first monster across takes 2 and stops.', needs: 'smith' },
  { kind: 'hook', name: 'Grappling hook', price: 40, text: 'Climb from a pit landing back up a level. Reusable.', needs: 'smith' },
  { kind: 'key', name: 'Skeleton key', price: 30, text: 'Opens one locked door or chest, silently. One use.', needs: 'smith' },
  { kind: 'oil', name: 'Oil flask', price: 15, text: '+8 lantern light.' },
  { kind: 'firecracker', name: 'Firecracker', price: 10, text: 'Throw 6: noise 6 there. Lures monsters away.' },
  // V3.6 (spec 19.2, 19.3).
  { kind: 'lockpicks', name: 'Lockpicks', price: 25, text: 'Proper picks, never used up. A Burglar picks at 3 Finesse slots, anyone else at 2.', needs: 'smith' },
  // V3.7.1 (spec 21.3): Wim brews it; sold once he is home.
  { kind: 'nightsight', name: 'Night-eye draught', price: 30, text: 'Drink (an action): 8 rounds of full sight and no dark penalty to rolls. The dark still hunts.', needs: 'innkeeper' },
];

// V3.6 (spec 19.2, 19.3).
/** Lockpicks (or the improvised pick): Finesse slots for a non-Burglar, or any hero on the improvised pick (spec 21.4). */
export const LOCKPICK_SLOTS = 2;
/** V3.7.1 (spec 21.4): a Burglar with the smith's proper lockpicks picks at this many slots. */
export const BURGLAR_PICK_SLOTS = 3;
/** Night-eye draught: rounds without dark penalties to sight and rolls. */
export const NIGHTSIGHT_ROUNDS = 8;

// Section 15 numbers.
/** V3.7.1 (spec 21.2): one level-1 hire (60) and an item or two. */
export const START_GOLD = 90;
/** Spec 17.1: a recruit costs RECRUIT_PRICE + RECRUIT_PRICE_PER_LEVEL × (level − 1). */
export const RECRUIT_PRICE = 60;
export const RECRUIT_PRICE_PER_LEVEL = 40;
export const TAVERN_SIZE = 4;
/** V3.7 (spec 20.3): the satchel. */
export const SAPPER_CHARGES = 3;
export const BLAST_INNER_DMG = 4;
export const BLAST_OUTER_DMG = 2;
export const BLAST_NOISE = 8;
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

// ---------------------------------------------------------------- V3.5 (spec 18)

/** Spec 18.2: the campfire hires 3 drifters (all level 1); the Gilded Flagon 4. */
export const CAMPFIRE_SIZE = 3;
export const FLAGON_SIZE = TAVERN_SIZE;
/** Level odds at the Flagon: without the cask book 35% level 2; with it 25% level 2 and 10% level 3. */
export const FLAGON_L2 = 0.35;
export const CASKBOOK_L2 = 0.25;
export const CASKBOOK_L3 = 0.1;
/** Spec 18.2: a camp potion (`drink`) heals this much, up to max. */
export const DRINK_HEAL = 5;

export interface StoryDef {
  id: StoryId;
  kind: 'rescue' | 'recover';
  siteId: string;
  /** The villager or thing. */
  subject: string;
  /** Short name for refusals ("Gerda the smith"). */
  who: string;
  /** Contract card brief. */
  brief: string;
  /** What it unlocks, for the card warnings. */
  unlocks: string;
  /** The line on return to camp. */
  line: string;
  /** Recover items: slots and heavy. */
  slots?: number;
  heavy?: boolean;
}

export const STORIES: StoryDef[] = [
  {
    id: 'surgeon', kind: 'rescue', siteId: 'l1-story-chapel', subject: 'Brother Aldric', who: 'Brother Aldric',
    brief: 'Brother Aldric slipped back in for herbs from the physic garden and was taken; the orcs keep him in the chapel to patch up their wounded.', unlocks: 'Unlocks the infirmary',
    line: 'Brother Aldric sets up in the old chapel. The infirmary is open.',
  },
  {
    id: 'innkeeper', kind: 'rescue', siteId: 'l1-story-kitchens', subject: 'Old Wim', who: 'Old Wim',
    brief: 'Old Wim never got out: the orcs keep him at the spit in the kitchens, cooking for the warband.', unlocks: 'Unlocks the Gilded Flagon',
    line: 'Old Wim lights the hearth of the Gilded Flagon. Better blades drink there now.',
  },
  {
    id: 'smith', kind: 'rescue', siteId: 'l2-story-forge', subject: 'Gerda the smith', who: 'Gerda the smith',
    brief: 'Gerda barred the forge the night the castle fell and has held it since, trading mended blades for food.', unlocks: 'Unlocks the forge and metalwork',
    line: 'Gerda rekindles the forge. Steel and metalwork are for sale again.',
  },
  {
    id: 'copper', kind: 'recover', siteId: 'l2-story-barracks', subject: 'the brewing copper', who: 'the brewing copper',
    brief: 'The orcs dragged Wim\'s brewing copper to the barracks to brew their own swill; it sits among the sleeping squad. It is heavy: its carrier moves 3.', unlocks: 'Wim brews the first ales',
    line: 'The brewing copper is back at the Flagon. Wim starts brewing.', slots: 2, heavy: true,
  },
  {
    id: 'caskbook', kind: 'recover', siteId: 'l3-recover-drain', subject: 'Wim\'s cask book', who: 'Wim\'s cask book',
    brief: 'Wim\'s cask book was lost in the Drain when the cellars flooded.', unlocks: 'The strong ales and seasoned recruits',
    line: 'Wim pores over his cask book by the fire. The strong ales are back.', slots: 1,
  },
];

export const ALES: AleOffer[] = [
  { kind: 'glowworm', name: 'Glowworm Pale', price: 15, needs: 'copper', text: 'The drinker glows: their own light, radius 1. The Gloam never finds them unlit.' },
  { kind: 'featherfoot', name: 'Featherfoot', price: 15, needs: 'copper', text: 'The drinker\'s first fall deals no damage.' },
  { kind: 'mole', name: 'Mole\'s Brown', price: 20, needs: 'copper', text: 'The drinker can Dig like a Sapper: rubble or a cracked wall next to them, noise 4.' },
  { kind: 'reserve', name: 'Hobart\'s Reserve', price: 20, needs: 'copper', text: 'The drinker\'s Focus starts at 4, and its max is 4.' },
  { kind: 'smuggler', name: 'Smuggler\'s Mead', price: 20, needs: 'caskbook', text: 'Sneak moves 4, silently.' },
  { kind: 'fireside', name: 'Fireside Porter', price: 25, needs: 'caskbook', text: 'Heal 3 each time the drinker changes level (after any fall damage).' },
  { kind: 'blackcask', name: 'Black Cask', price: 10, needs: 'caskbook', text: '70%: one of the six ales above at random. 30%: hiccups (noise 1 every world phase) or a heavy head (Focus starts at 1).' },
];
/** The six real ales the Black Cask can turn into. */
export const CASK_GOOD: AleEffect[] = ['glowworm', 'featherfoot', 'mole', 'reserve', 'smuggler', 'fireside'];
export const CASK_BAD: AleEffect[] = ['hiccups', 'heavyhead'];
export const CASK_GOOD_CHANCE = 0.7;
export const RESERVE_FOCUS = 4;
export const HEAVYHEAD_FOCUS = 1;
export const SMUGGLER_SNEAK = 4;
export const FIRESIDE_HEAL = 3;
export const HICCUP_NOISE = 1;
export const HEAVY_MOVE = 3;

// ---------------------------------------------------------------- V3.5 crews (spec 18.5), reworked in V3.7 (spec 20.4)

export interface RivalStats {
  hp: number;
  slots: number;
  chance: number;
  dmg: number;
  move: number;
  armor: number;
  /** Ranged reach (the Ranger's bow); melee = 1. */
  range: number;
}

/**
 * Legacy numbers per rival class (V3.5 saves without `level`). V3.7 crews are built like heroes
 * from CLASSES (see rivals.ts `rivalStats`); this table only backs members from older saves.
 */
export const RIVAL_CLASSES: Record<RivalClass, RivalStats> = {
  ranger: { ...SISTER, armor: 0, range: BOW_RANGE },
  shadowmancer: { ...SISTER, armor: 0, range: 1 },
  burglar: { ...SISTER, armor: 0, range: 1 },
  sellsword: { hp: 10, slots: 3, chance: 60, dmg: 2, move: 4, armor: 1, range: 1 },
  sapper: { hp: 9, slots: 3, chance: 55, dmg: 2, move: 4, armor: 0, range: 1 },
  pyromancer: { hp: 6, slots: 2, chance: 50, dmg: 1, move: 4, armor: 0, range: 1 },
  hedgewitch: { hp: 7, slots: 2, chance: 50, dmg: 1, move: 4, armor: 0, range: 1 },
};
/** Level 2 tier for cutthroats (16.3): +2 HP, +5 hit (legacy saves only). */
export const CUTTHROAT_TIER = { hp: 2, chance: 5 };
/** Spec 20.4: the purse a killed member drops, by crew level (30 at level 2 and 3, 50 at level 4). */
export const CREW_PURSE: Record<number, number> = { 1: 30, 2: 30, 3: 30, 4: 50 };
export const CUTTHROAT_PURSE = 30;
export const CUTTHROAT_CHANCE = 0.6;
export const PROSPECTOR_CHANCE = 0.5;
/** Spec 23.2: prospectors come in between these rounds, never by the party's way in, and wait while a hero is this close to theirs. */
export const PROSPECTOR_ENTERS: [number, number] = [6, 9];
export const PROSPECTOR_KEEP_OFF = 6;
/** Spec 20.4: the Wake on Level 3 contracts. */
export const WAKE_CHANCE = 0.6;
/** Crew members walk 4 (like heroes). */
export const RIVAL_MOVE = 4;
/** Spec 20.4: members at or below half HP back off a hex and drink a potion (heals 5, like a hero's). */
export const RIVAL_POTION_HEAL = 5;
/** Spec 20.4: a dragged hero moves 3 a round toward the crew's exit. */
export const DRAG_MOVE = 3;
/** Waiting cutthroats notice a hero this close in line of sight, or noise this loud. */
export const CUTTHROAT_SIGHT = 6;
export const CUTTHROAT_HEAR = 4;
export const TOLL_MIN = 50;
export const SAPPER_CHARGE_RANGE = 3;
export const SAPPER_CHARGE_DMG = 3;
export const SAPPER_CHARGE_NOISE = 8;
export const PYRO_BOLTS = 3;
export const PYRO_BOLT_RANGE = 5;
export const PYRO_BOLT_SLOTS = 3;
export const PYRO_BOLT_CHANCE = 60;
export const PYRO_BOLT_DMG = 2;
export const PYRO_BOLT_NOISE = 3;
export const SELLSWORD_SHOVE_CHANCE = 60;

export interface CrewMemberDef {
  name: string;
  cls: RivalClass;
  /** Spec 20.4: the 4-slot pack by class (item kinds; 'charge' ×n = n charges). */
  pack: ItemKind[];
}

export interface CrewDef {
  id: CrewId;
  name: string;
  temperament: 'prospector' | 'cutthroat';
  /** Spec 20.4: members are built as heroes of their class at this level (+2 HP, +5 main stat per level above 1). */
  level: number;
  weaponTier: 0 | 1 | 2;
  armorTier: 0 | 1 | 2;
  /** Which contract levels draw this crew (makeCrew), and the level its posts are on (cutthroats). */
  contracts: number[];
  members: CrewMemberDef[];
  /** Spec 20.4: the crew's hideout, where captives are held ("Bring back" contracts); a ContractSiteDef with `hideout` = this crew. */
  hideout: { siteId: string; where: string };
}

export const CREWS: Record<CrewId, CrewDef> = {
  'lantern-sisters': {
    id: 'lantern-sisters', name: 'The Lantern Sisters', temperament: 'prospector', level: 2, weaponTier: 1, armorTier: 1, contracts: [1],
    members: [
      { name: SISTER_NAMES[0]!, cls: 'ranger', pack: ['caltrops', 'caltrops', 'potion'] },
      { name: SISTER_NAMES[1]!, cls: 'shadowmancer', pack: ['smoke', 'firecracker'] },
      { name: SISTER_NAMES[2]!, cls: 'burglar', pack: ['dart', 'dart', 'smoke', 'lockpicks'] },
    ],
    hideout: { siteId: 'lantern-sisters-hideout', where: "the officers' quarters" },
  },
  ferrymen: {
    id: 'ferrymen', name: 'The Ferrymen', temperament: 'cutthroat', level: 3, weaponTier: 1, armorTier: 1, contracts: [2],
    members: [
      { name: 'Ferryman Joost', cls: 'sellsword', pack: ['potion', 'glue'] },
      { name: 'Ferryman Sil', cls: 'ranger', pack: ['caltrops', 'caltrops', 'potion'] },
      { name: 'Ferryman Brecht', cls: 'sapper', pack: ['charge', 'charge', 'glue'] },
    ],
    hideout: { siteId: 'ferrymen-hideout', where: 'the Drain' },
  },
  'gallows-choir': {
    id: 'gallows-choir', name: 'The Gallows Choir', temperament: 'cutthroat', level: 3, weaponTier: 1, armorTier: 1, contracts: [2],
    members: [
      { name: 'Deacon Harl', cls: 'sellsword', pack: ['potion', 'glue'] },
      { name: 'Little Mags', cls: 'burglar', pack: ['dart', 'dart', 'smoke', 'lockpicks'] },
      { name: 'Cantor Vey', cls: 'pyromancer', pack: ['potion', 'oil'] },
    ],
    hideout: { siteId: 'gallows-choir-hideout', where: 'the Tunnels' },
  },
  'the-wake': {
    id: 'the-wake', name: 'The Wake', temperament: 'cutthroat', level: 4, weaponTier: 2, armorTier: 1, contracts: [3],
    members: [
      { name: 'Mother Grave', cls: 'sellsword', pack: ['potion', 'potion'] },
      { name: 'Sexton', cls: 'hedgewitch', pack: ['potion', 'potion'] },
      { name: 'Candle', cls: 'shadowmancer', pack: ['smoke', 'firecracker'] },
      { name: 'Spade', cls: 'sapper', pack: ['charge', 'charge', 'charge'] },
    ],
    hideout: { siteId: 'the-wake-hideout', where: 'the Bone Pile' },
  },
};
/** Spec 18.5: the Level 2 pool. */
export const CUTTHROAT_POOL: CrewId[] = ['ferrymen', 'gallows-choir'];

// ---------------------------------------------------------------- V3.5 parley (spec 18.6)

export const DEAL_RANGE = 4;
/** Base prices; ×1.5 on Level 2 and deeper (rounded to 5). Truce while demanding is the toll; 50 if hostile. */
export const DEAL_PRICE: Record<Exclude<DealKind, 'fight'>, number> = { leave: 40, truce: 25, job: 30, hire: 60 };
export const TRUCE_HOSTILE = 50;
export const DEEP_PRICE = 1.5;
export const HIRE_ROUNDS = 5;
export const HIRE_KEEP = 2;
export const BETRAY_LOOT = 150;
export const BETRAY_CHANCE = 25;
export const SCOUT_RANGE = 8;
