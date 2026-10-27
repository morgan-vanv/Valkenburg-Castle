// Numbers from docs/v3-spec.md.

import type { AleEffect, AleKind, AleOffer, CrewId, DealKind, HeroClass, ItemKind, MonsterKind, RivalClass, ShopKind, ShopOffer, Stat, Stats, StoryId, Vendor, Village } from './types';
import type { ClassInfo } from './api';

/** Spec 16.2: the lantern holds 20; stages bright > 12, dim 7..12, dark 1..6, pitch 0. */
export const LIGHT_MAX = 20;
export const LIGHT_BRIGHT = 12; // above this = bright
export const LIGHT_DIM = 7; // this..LIGHT_BRIGHT = dim
export const PACK_SLOTS = 4;
export const FOCUS_MAX = 3;
export const MANA_MAX = 3;
export const TORCH_ROUNDS = 15; // V4.1 (WS2): was 12
export const BLEED_START = 3; // V4.1 (spec 31.4): was 2

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
  // V4.0 (spec 30.1, owner): a little squishier than the Sellsword (was HP 10, Might 65, armor 1, Brace).
  sapper: {
    name: 'Sapper',
    hp: 9,
    stats: { might: 60, finesse: 50, wits: 45, nerve: 60 },
    weapon: { name: 'Hammer', slots: 3, stat: 'might', dmg: 2 },
    armor: 0,
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
    abilities: ['Pick locks.', 'Walks 5 and sneaks 4, with the quietest feet.', "Backstab: from behind an enemy that hasn't noticed you, +1 slot and double damage.", 'Opens chests without using the action.'],
  },
  ranger: {
    role: 'Eyes: shoots from range, holds a lane.',
    abilities: [
      'Longbow: range 6, noise 1. Adjacent shots lose 1 slot.',
      'Overwatch: shoot the first enemy that moves or acts in sight within 6 next world phase.',
      'Knockback shot: 2 Finesse slots at range 5; 2 hits push the target 1 hex back (pits!).',
      'Hamstring: 1 Finesse slot at −20% at range 5; a hit roots the target for 2 rounds (no moving, can still act). Noise 1.',
      'Quiver: 5 arrows a level each delve, their own; every shot uses one, bought arrows after. Out of arrows: a knife (2 Finesse slots, 1 damage).',
    ],
  },
  sapper: {
    role: 'Breacher: blows walls, digs through.',
    abilities: [
      'Improvised explosives: 1 a level each delve; bought charges add to them.',
      'Set a charge (fuse 1 or 2) on an adjacent hex, door, chest or wall; throw one up to 3 hexes (fuse 1).',
      'Blast: 4 dmg within 1 and thrown back, 2 within 2; opens locks and breaks walls on Levels 1 and 2. Noise 8. The Sapper takes 0, friends half.',
      'Dig: clear adjacent rubble or a cracked wall. Noise 4.',
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
// ---------------------------------------------------------------- V4.1 (WS2): light, torches are the clock

/**
 * V4.1 (WS2): the free party lantern of V3.3–V4.0 is retired: a delve starts with no party light. Switched on, every
 * delve hands the first hero (Keven if he goes) a slotless lantern (the old free lantern as an item; spec 31.5).
 */
export const FREE_LANTERN = { enabled: false };
/** A lit torch lights this far round whoever holds it (or the hex it lies on). Rounds: TORCH_ROUNDS. */
export const TORCH_RADIUS = 3;
/** The lantern (Gerda's): holds this many rounds, refilled free in camp; radius 4 at LANTERN_LOW_AT and above, 3 below. */
export const LANTERN_MAX = 20;
export const LANTERN_LOW_AT = 7;
export const LANTERN_RADIUS_FULL = 4;
export const LANTERN_RADIUS_LOW = 3;
/** Kindle (Pyromancer): lights or relights a torch or lantern held by a hero within this, or adds KINDLE_LIGHT rounds to one. */
export const KINDLE_RANGE = 3;
/** Every crew member carries a light of its own: this radius round it (part of the lit set for everyone). */
export const CREW_LIGHT_RADIUS = 2;
/** Neutral Lantern Sisters head out at this round at the latest (was: the party's lantern at 9 or less). */
export const SISTERS_LEAVE_ROUND = 18;
/** The ale effect that is Night-eye Stout (the ALES entry is the village's): sees as if lit, stays unlit to others. */
export const NIGHTEYE_ALE = 'nighteye';
/** Darkness by the hero's own hex: party light (a torch, a lantern, Glowworm) or daylight, a castle light only, unlit. */
export const DARK_PENALTY = { party: 0, castle: -10, unlit: -20 } as const;
/** An old save's night-eye draughts in the stash are bought back for this each on load (the draught is retired). */
export const NIGHTSIGHT_REFUND = 15;

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
/**
 * V4.0 (spec 27): monster sight by mood. An unaware monster (at its post or on patrol) catches heroes at its
 * SIDES (the two rear-side directions) out of the corner of its eye only: a walking hero within SIDE_NOTICE_WALK,
 * and anyone adjacent when SIDE_NOTICE_ADJACENT, except a sneaking Burglar when BURGLAR_SIDE_QUIET (quietest
 * feet: the Burglar can still backstab from the sides). Searching and hunting monsters see their sides fully.
 */
export const SIDE_NOTICE_WALK = 2;
export const SIDE_NOTICE_ADJACENT = true;
export const BURGLAR_SIDE_QUIET = true;
/** The orc's first-sight bellow (spec 16.4): noise 5 at the orc, once a delve. */
export const BELLOW_NOISE = 5;
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
/** Brace (heir, sellsword; V4.0 spec 30.1: not the sapper): hits do 1 less, enemies roll this much lower, until the next player phase. */
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

export const SISTER = { hp: 7, slots: 3, chance: 55, dmg: 2, move: 4 };
export const SISTER_NAMES = ['Sister Wenna', 'Sister Odile', 'Sister Brisk'];

/** Total XP needed for each level (index = level). */
export const LEVEL_XP = [0, 0, 5, 12, 20, 30, 45];
export const MAX_LEVEL = 6;

/** V4.1 (spec 31.2): regular bounties about 40% up (were rescue 80/150/220, recover 100/180/260, slay 500). */
export const BOUNTY = { rescue: [0, 110, 200, 280], recover: [0, 140, 250, 340], slay: [0, 600, 600, 600] } as const;
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
  { kind: 'torch', name: 'Torch', price: 10, text: 'Light it (an action): radius 3 for 15 rounds. Snuff it free and it keeps what is left.' },
  { kind: 'potion', name: 'Potion', price: 20, text: 'Heals 5. Gets a downed hero up.' },
  { kind: 'rope', name: 'Rope', price: 15, text: 'Anchor at the pit edge to climb down and back.' },
  // V4.1 (spec 31.3): Mott's charge costs 45 (was 30); Gerda sells it for 30 once Ilse is home too (PAIR_PRICES).
  { kind: 'charge', name: 'Blasting charge', price: 45, text: 'Set it with a fuse: opens locks, breaks walls on Levels 1 and 2. Very loud.' },
  // V4.1 (spec 31.3): smoke, glue, the darts and oil are Ilse's now (`needs: 'alchemist'`).
  { kind: 'smoke', name: 'Smoke bomb', price: 20, text: 'Throw 4: smoke blocks sight there for 2 rounds.', needs: 'alchemist' },
  { kind: 'glue', name: 'Glue bomb', price: 25, text: 'Throw 4: monsters within 1 are stuck for 2 rounds.', needs: 'alchemist' },
  { kind: 'dart', name: 'Sleep dart', price: 25, text: 'Throw 5: a Finesse hit puts a monster to sleep. Silent.', needs: 'alchemist' },
  // V4.0 (spec 29.3): Mott sold venom darts from the start; V4.1: Ilse does.
  // V4.1 (spec 31.4): the poison dart (internal kind `venomdart` kept).
  { kind: 'venomdart', name: 'Poison dart', price: 30, text: 'Throw 5: a Finesse hit poisons a monster or crew member: 1 damage a turn, never below 1. Silent.', needs: 'alchemist' },
  { kind: 'caltrops', name: 'Caltrops', price: 15, text: 'Scatter next to you: the first monster across takes 2 and stops.', needs: 'smith' },
  { kind: 'hook', name: 'Grappling hook', price: 40, text: 'Climb from a pit landing back up a level. Reusable.', needs: 'smith' },
  { kind: 'key', name: 'Skeleton key', price: 30, text: 'Opens one locked door or chest, silently. One use.', needs: 'smith' },
  { kind: 'oil', name: 'Oil flask', price: 15, text: '+10 to a lantern (an action, or Kindle\'s cousin).', needs: 'alchemist' },
  // V4.0 (spec 29.6): an essential: always sold.
  // V4.1 (spec 31.4): the antipoison (internal kind `antidote` kept).
  { kind: 'antidote', name: 'Antipoison', price: 20, text: 'Drink, or give to a hero next to you, up or down (an action): cures poison.' },
  { kind: 'firecracker', name: 'Firecracker', price: 10, text: 'Throw 6: noise 6 there. Lures monsters away.' },
  // V3.6 (spec 19.2, 19.3).
  { kind: 'lockpicks', name: 'Lockpicks', price: 25, text: 'Proper picks, never used up. A Burglar picks at 3 Finesse slots, anyone else at 2.', needs: 'smith' },
  // V3.7.1 (spec 21.3) the night-eye draught was sold here once Wim was home; V4.1 (spec 31.3): gone (Night-eye Stout, an ale).
  // V4.1 (spec 31.3): Aldric and Ilse together.
  { kind: 'greaterpotion', name: 'Greater potion', price: 35, text: 'Heals 8. Gets a downed hero up.', needs: ['surgeon', 'alchemist'] },
  // V4.1 (spec 31.5, WS2): Gerda's lantern: reusable, refilled free in camp.
  { kind: 'lantern', name: 'Lantern', price: 120, text: 'Holds 20 rounds of light, refilled free in camp: radius 4 (3 when low). The shutter is free. Oil tops it up.', needs: 'smith', vendor: 'gerda' },
  // V4.1 (WS6, spec 31.8): arrows, 1-slot bundles. A Ranger shoots the quiver first, then plain arrows; specialty arrows when picked.
  { kind: 'arrows', name: 'Plain arrows', price: 10, text: 'A bundle of 6 for the bow, shot after the quiver runs dry.', vendor: 'mott' },
  { kind: 'whistlearrows', name: 'Whistling arrows', price: 15, text: 'A bundle of 3: noise 6 where it lands. Shoot one at a foe or at a hex in sight (range 6).', vendor: 'mott' },
  { kind: 'glowarrows', name: 'Glow arrows', price: 20, text: 'A bundle of 3: lights radius 2 for 8 rounds where it lands, or on what it hits. The Gloam shies from it.', needs: 'alchemist' },
  { kind: 'firearrows', name: 'Fire arrows', price: 25, text: 'A bundle of 3: +1 damage on a hit, and the hex burns 2 rounds.', needs: 'alchemist' },
  { kind: 'poisonarrows', name: 'Poison arrows', price: 30, text: 'A bundle of 3: a hit poisons (1 damage a turn, never below 1).', needs: 'alchemist' },
  { kind: 'barbarrows', name: 'Barbed arrows', price: 25, text: 'A bundle of 3: a hit roots the target 2 rounds.', needs: 'smith' },
  { kind: 'ropearrow', name: 'Rope arrow', price: 30, text: 'One arrow with a line: shot at a pit edge within 5 in sight, it anchors a rope there.', needs: 'smith' },
  { kind: 'blastarrows', name: 'Blast arrows', price: 40, text: 'A bundle of 2: a blast where it lands: 3 damage within 1, noise 8; opens locks and breaks walls like a charge.', needs: ['smith', 'alchemist'], vendor: 'gerda' },
];

// V3.6 (spec 19.2, 19.3).
/** Lockpicks (or the improvised pick): Finesse slots for a non-Burglar, or any hero on the improvised pick (spec 21.4). */
export const LOCKPICK_SLOTS = 2;
/** V3.7.1 (spec 21.4): a Burglar with the smith's proper lockpicks picks at this many slots. */
export const BURGLAR_PICK_SLOTS = 3;
/** Night-eye draught: rounds without dark penalties to sight and rolls. */
export const NIGHTSIGHT_ROUNDS = 8;

// Section 15 numbers.
/** V3.7.1 (spec 21.2): one level-1 hire (60) and an item or two. V4.1 (spec 31.2): 120 (was 90): a hire and 60 to try the shop. */
export const START_GOLD = 120;
/** Spec 17.1: a recruit costs RECRUIT_PRICE + RECRUIT_PRICE_PER_LEVEL × (level − 1). */
export const RECRUIT_PRICE = 60;
export const RECRUIT_PRICE_PER_LEVEL = 40;
export const TAVERN_SIZE = 4;
/**
 * Class kit per delve (V4.0, spec 30.2, owner): the Sapper's improvised explosives and the Burglar's improvised picks,
 * this many a hero (or crew member) level: level 1 brings 1, level 6 brings 6. Was a flat 3 explosives and 1 pick.
 */
export const KIT_PER_LEVEL = 1;
/** Class kit uses a hero or crew member of this level brings each delve (spec 30.2). */
export function kitPerDelve(level: number | undefined): number {
  return Math.max(1, Math.floor(level ?? 1)) * KIT_PER_LEVEL;
}
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
export const THROW_RANGE: Record<'smoke' | 'glue' | 'dart' | 'firecracker' | 'venomdart', number> = { smoke: 4, glue: 4, dart: 5, firecracker: 6, venomdart: 5 };

// V4.0 (spec 29): venom and paralysis. V4.1 (spec 31.4): poison replaces both (VENOM_ROUNDS, PARALYSIS_ROUNDS gone).
/** A trap's bite (spec 13.4) and a poison trap's (1 and a dose instead; internal name kept). */
export const TRAP_DMG = 3;
export const VENOM_TRAP_DMG = 1;
/** V4.1 (spec 31.4): a hero (or crew member) carrying a body moves this far at most (dash too), like HEAVY_MOVE. */
export const CARRY_MOVE = 3;

// V4.1 (WS3, spec 31.4): poison, downed, carry and unshackle.
/** Poison: damage at step 2 of every world phase, and the HP it never takes a figure below. */
export const POISON_DMG = 1;
export const POISON_FLOOR = 1;
/** Mend on a downed hero (or crew member) within 3 gets them up at this HP. */
export const MEND_UP_HP = 2;
/** A downed hero carried out of the castle comes out at this HP. */
export const CARRIED_OUT_HP = 1;
/** Splints (Gerda and Aldric home): a downed hero crawls this many hexes a turn. */
export const CRAWL_MOVE = 1;
/** Unshackle by Smash: Might slots, hits needed, noise either way (as smashing a chest). */
export const UNSHACKLE_SMASH_SLOTS = 2;
export const UNSHACKLE_SMASH_HITS = 1;
export const UNSHACKLE_SMASH_NOISE = 4;
/** Unshackle with an improvised pick: sure, but not silent. */
export const UNSHACKLE_IMPROVISED_NOISE = 2;
export const SMOKE_ROUNDS = 2;
export const GLUE_ROUNDS = 2;
export const CALTROPS_DMG = 2;
export const OIL_LIGHT = 10; // V4.1 (WS2): +10 to a lantern (was +8 to the party lantern)
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
  // V4.1 (spec 31.3): Ilse the alchemist, among the archive's shelves next to the spider she milks.
  {
    id: 'alchemist', kind: 'rescue', siteId: 'l2-story-archive', subject: 'Ilse the alchemist', who: 'Ilse the alchemist',
    brief: 'Ilse brewed for Lord Hobart. When the castle fell she barricaded herself among the archive\'s shelves, and lives on the venom she milks from its spider and sells to the orcs. Brother Aldric asks you to fetch her.',
    unlocks: 'Unlocks Ilse\'s bench',
    line: 'Ilse unpacks her alembics in the old dye-house. Ilse\'s bench is open: darts, smoke, glue and oil.',
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
  // V4.1 (spec 31.3): Wim and Ilse's brews (`needs: 'alchemist'`: both home; the copper isn't needed).
  // Night-eye's effect is the light rules' (WS2), Spider-milk's the poison rules' (WS3); Dragonfire's is in common.ts `fireWard`.
  { kind: 'nighteye', name: 'Night-eye Stout', price: 25, needs: 'alchemist', text: 'All delve, the drinker sees as if lit by party light: no dark penalty. Still unlit to monsters and the dark; lights nothing for anyone else.' },
  { kind: 'spidermilk', name: 'Spider-milk Stout', price: 20, needs: 'alchemist', text: 'Poison can\'t take hold of the drinker this delve.' },
  { kind: 'dragonfire', name: 'Dragonfire Porter', price: 25, needs: 'alchemist', text: 'Fire, burning, the Dragon\'s breath and blasts do 2 less to the drinker (to 0 at least).' },
];
/** The six real ales the Black Cask can turn into. */
export const CASK_GOOD: AleEffect[] = ['glowworm', 'featherfoot', 'mole', 'reserve', 'smuggler', 'fireside'];
export const CASK_BAD: AleEffect[] = ['hiccups', 'heavyhead'];
export const CASK_GOOD_CHANCE = 0.7;
export const RESERVE_FOCUS = 4;
export const HEAVYHEAD_FOCUS = 1;
export const SMUGGLER_SNEAK = 4;
/** V4.0 (spec 26.4): heroes walk 4; the Burglar walks 5 (one further than they sneak). Dash the same. */
export const WALK_MOVE = 4;
export const BURGLAR_WALK = 5;
export const FIRESIDE_HEAL = 3;
export const HICCUP_NOISE = 1;
export const HEAVY_MOVE = 3;

// ---------------------------------------------------------------- V4.1 (WS1/WS5): gold, gifts, Ilse and the village pairs (spec 31.2, 31.3)

/** Spec 31.2 (pillar 18): a contract that wins something back pays this: every story contract and every "Bring back". */
export const STORY_PAY = 0;
export const CAPTIVE_PAY = 0;

/** Spec 31.2: what a villager gives the first time they come home (instead of gold). `line` is said on return. */
export interface Gift {
  /** Items to Keven's cart. */
  items?: [ItemKind, number][];
  /** An ale for every hero on the roster, drunk on their next delve (a hero with one waiting keeps theirs). */
  ale?: AleKind;
  /** Free shields at the forge (`campaign.credits.shield`). */
  shields?: number;
  /** Short, for the contract card ("2 potions"). */
  short: string;
  line: string;
}
export const GIFTS: Partial<Record<StoryId, Gift>> = {
  surgeon: { items: [['potion', 2]], short: '2 potions', line: 'Brother Aldric presses two potions on you for the road. They\'re on Keven\'s cart.' },
  innkeeper: { ale: 'reserve', short: 'A round of Hobart\'s Reserve', line: 'Old Wim broaches his last cask of Hobart\'s Reserve: a round for everyone on the roster, drunk as they next go in.' },
  smith: { shields: 1, short: 'A shield', line: 'Gerda owes you a shield. The next one at the forge is free.' },
  // V4.1 (WS6, spec 31.8): and a bundle of 3 glow arrows.
  alchemist: { items: [['antidote', 2], ['glowarrows', 1]], short: '2 antidotes, 3 glow arrows', line: 'Ilse gives you two antidotes and three glow arrows from her own stock. They\'re on Keven\'s cart.' },
};

/** Spec 31.3: a pair of villagers is home (both flags set). For pair rules anywhere in the engine; old saves lack `alchemist`. */
export function pairHome(v: Partial<Village> | undefined | null, a: StoryId, b: StoryId): boolean {
  return !!v?.[a] && !!v?.[b];
}

/** Spec 31.3: cheaper prices when a pair is home: Gerda's blasting charge, Aldric's antidote. The cheapest that applies wins. */
export const PAIR_PRICES: { kind: ShopKind; needs: [StoryId, StoryId]; price: number; vendor: Vendor }[] = [
  { kind: 'charge', needs: ['smith', 'alchemist'], price: 30, vendor: 'gerda' },
  { kind: 'antidote', needs: ['surgeon', 'alchemist'], price: 12, vendor: 'aldric' },
];

/** Spec 31.3: what a potion heals in the castle (and the HP a downed hero gets up at). */
export const POTION_HEAL: Record<'potion' | 'greaterpotion', number> = { potion: 5, greaterpotion: 8 };

/** Spec 31.3: Dragonfire Porter: fire, burning, breath and blast damage to the drinker this much less (to 0 at least). */
export const DRAGONFIRE_WARD = 2;

/** Spec 31.3: Aldric and Wim's hot supper: every hero who gets out heals this much on return. */
export const SUPPER_HEAL = 2;

/** Spec 31.3: the Sapper's tripwire (Gerda and Ilse home): the fuse it's set with; it also goes off when an enemy steps within 1. */
export const TRIPWIRE_FUSE = 2;

// ---------------------------------------------------------------- V4.1 (WS6, spec 31.8): arrows

/** The Ranger's quiver (class kit, slotless, the hero's own): this many arrows a hero (or crew) level, fresh each delve. */
export const ARROWS_PER_LEVEL = 5;
/** Arrows in a Ranger's quiver at the start of a delve: 5 a level (level 1 brings 5, level 2 brings 10). */
export function quiverPerDelve(level: number | undefined): number {
  return Math.max(1, Math.floor(level ?? 1)) * ARROWS_PER_LEVEL;
}
/** Out of arrows, a Ranger fights with a knife: melee, 2 Finesse slots, 1 damage. */
export const KNIFE: Weapon = { name: 'Knife', slots: 2, stat: 'finesse', dmg: 1, noise: 2 };
/** Arrows in a bought bundle (1 slot each bundle). */
export const ARROW_BUNDLE: Partial<Record<ItemKind, number>> = {
  arrows: 6, whistlearrows: 3, glowarrows: 3, firearrows: 3, poisonarrows: 3, barbarrows: 3, ropearrow: 1, blastarrows: 2,
};
/** A whistling arrow: noise this loud where it lands (a firecracker's). */
export const WHISTLE_NOISE = 6;
/** A glow arrow: lights this radius where it lands (or on what it hits) for this many rounds. */
export const GLOW_ARROW_RADIUS = 2;
export const GLOW_ARROW_ROUNDS = 8;
/** A fire arrow: this much more damage on a hit, and the target's hex burns (BURN_ROUNDS, the fireball's rules). */
export const FIRE_ARROW_DMG = 1;
/** A barbed arrow: a hit roots this many rounds (hamstring's root, without its −20). */
export const BARB_ROUNDS = 2;
/** A rope arrow: an edge hex beside a pit within this range, in sight of the party. */
export const ROPE_ARROW_RANGE = 5;
/** A blast arrow: a blast where it lands: this much to everything within 1 (no outer ring), noise BLAST_NOISE. */
export const BLAST_ARROW_DMG = 3;
/** Every arrow kind a bow can loose (the quiver, then the bundles). */
export const ARROW_KINDS: ItemKind[] = ['quiver', 'arrows', 'whistlearrows', 'glowarrows', 'firearrows', 'poisonarrows', 'barbarrows', 'ropearrow', 'blastarrows'];
/**
 * Pillar 17: a crew's Ranger brings one bundle of a fitting specialty arrow, on top of its pack (kept out of CREWS so the
 * crews' own tuning stays apart): the Lantern Sisters' Ranger glow arrows (Level 1 teaches light), the Ferrymen's barbed.
 */
export const CREW_ARROWS: Partial<Record<CrewId, ItemKind>> = { 'lantern-sisters': 'glowarrows', ferrymen: 'barbarrows' };

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
/**
 * Legacy members (V3.5 saves without `level`) move 4. V4.0 (spec 28, pillar 17): level-built members move like heroes of
 * their class: walk WALK_MOVE (Burglar BURGLAR_WALK), sneak 2 (Burglar SMUGGLER_SNEAK), dash the same (crewmove.ts `crewBudget`).
 */
export const RIVAL_MOVE = 4;
/** V4.0 (spec 28.1): crew members at peace sneak when a monster they can see asleep or unaware lies within this of their path. */
export const CREW_CAUTION = 3;
/** V4.0 (spec 28.1): ... or an active hero within this of their path (looting near the party). */
export const CREW_PARTY_CAUTION = 5;
/** V4.0 (spec 28.1): a hostile member out of the party's sight stalks (sneaks) its target when it is within this. */
export const CREW_STALK_RANGE = 6;
/** V4.0 (spec 28.1): a member sees a monster (for caution) within this in line of sight (crews carry their own light). */
export const CREW_LOOKOUT = 8;
/** V4.0 (spec 28.6): a crew Sapper digs or blasts a way when it saves at least this many hexes of walking (as the sim bot). */
export const SAPPER_SHORTCUT = 6;
/** Spec 20.4: members at or below half HP back off a hex and drink a potion (heals 5, like a hero's). */
export const RIVAL_POTION_HEAL = 5;
/** Spec 20.4: a dragged hero moves 3 a round toward the crew's exit. */
export const DRAG_MOVE = 3;
/**
 * V4.0 (spec 28.8, owner): a crew takes only a hero left helpless (downed, or dozing from a sleep dart) and alone: no other
 * hero who is up (active, awake, not in a crew's hands) within this many hexes, straight-line, same level. Otherwise a downed
 * hero in reach is finished.
 */
export const CAPTURE_ALONE = 4;
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
      // V4.0 (spec 29.3): Little Mags trades a sleep dart for a venom dart.
      { name: 'Little Mags', cls: 'burglar', pack: ['dart', 'venomdart', 'smoke', 'lockpicks'] },
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
