// Numbers from docs/demo-spec.md, with 1980 rule references.

import type { ItemId, LootItem, Medal, SpellId, UnitClass } from './types';

export interface UnitStats {
  baseHit: number;
  meleeSlots: number;
  /** 0 for squads (they lose men instead). */
  maxWounds: number;
  /** Leader bonus given to friends in or next to its square. */
  leaderBonus: number;
  bows: boolean;
  isSquad: boolean;
  isMonster: boolean;
  isHero: boolean;
  /** Carry limit per man (squads) or total (individuals), in coins. */
  carry: number;
}

const base = { leaderBonus: 0, bows: false, isSquad: false, isMonster: false, isHero: false, carry: 100 };

export const STATS: Record<UnitClass, UnitStats> = {
  hobart: { ...base, baseHit: 65, meleeSlots: 2, maxWounds: 4, leaderBonus: 20, bows: true, isHero: true },
  leader: { ...base, baseHit: 60, meleeSlots: 2, maxWounds: 3, leaderBonus: 10, bows: true, isHero: true },
  dwarf: { ...base, baseHit: 60, meleeSlots: 2, maxWounds: 3, isHero: true, carry: 150 },
  burglar: { ...base, baseHit: 40, meleeSlots: 1, maxWounds: 2, isHero: true },
  magicUser: { ...base, baseHit: 40, meleeSlots: 1, maxWounds: 3, isHero: true },
  squad: { ...base, baseHit: 50, meleeSlots: 0, maxWounds: 0, bows: true, isSquad: true, carry: 250 },
  orcSquad: { ...base, baseHit: 45, meleeSlots: 0, maxWounds: 0, bows: true, isSquad: true, carry: 250 },
  evilLeader: { ...base, baseHit: 55, meleeSlots: 2, maxWounds: 3, leaderBonus: 10, bows: true },
  evilMagicUser: { ...base, baseHit: 40, meleeSlots: 1, maxWounds: 3 },
  troll: { ...base, baseHit: 60, meleeSlots: 2, maxWounds: 4, isMonster: true },
  ogre: { ...base, baseHit: 60, meleeSlots: 2, maxWounds: 3, isMonster: true },
  berserker: { ...base, baseHit: 60, meleeSlots: 2, maxWounds: 3, isMonster: true },
  mantis: { ...base, baseHit: 55, meleeSlots: 2, maxWounds: 2, isMonster: true },
  spider: { ...base, baseHit: 60, meleeSlots: 1, maxWounds: 2, isMonster: true },
  drog: { ...base, baseHit: 55, meleeSlots: 1, maxWounds: 2, isMonster: true },
  banshee: { ...base, baseHit: 50, meleeSlots: 1, maxWounds: 2, isMonster: true },
  dragon: { ...base, baseHit: 70, meleeSlots: 3, maxWounds: 30, isMonster: true },
  dummy: { ...base, baseHit: 0, meleeSlots: 0, maxWounds: 1 },
};

export const MONSTER_POOL: UnitClass[] = ['troll', 'ogre', 'spider', 'drog', 'banshee', 'mantis', 'berserker'];

export const MONSTER_NAMES: Partial<Record<UnitClass, string>> = {
  troll: 'Troll',
  ogre: 'Ogre',
  berserker: 'Berserker',
  mantis: 'Mantis',
  spider: 'Giant Spider',
  drog: 'Drog',
  banshee: 'Banshee',
  dragon: 'The Dragon',
};

export const MOVE_BY_ARMOR = { unarmored: 5, normal: 4, heavy: 3 } as const;

export const SPELLS: Record<SpellId, { cost: number; name: string }> = {
  esp: { cost: 1, name: 'ESP' },
  fireball: { cost: 3, name: 'Fireball' },
  smokescreen: { cost: 1, name: 'Smokescreen' },
  pyrotechnics: { cost: 1, name: 'Pyrotechnics' },
  unlock: { cost: 2, name: 'Unlock Door' },
  combat: { cost: 1, name: 'Bless' },
};

/** Spells offered in V2. */
export const V2_SPELLS: SpellId[] = ['fireball', 'smokescreen', 'combat'];

/** One-shot run numbers (V2). */
export const RUN = {
  purse: 150,
  spellPoints: 6,
  squadMen: 8,
  sellswordMen: 6,
  monsterLeash: 5,
  dragonLeash: 7,
  medals: { gold: 2000, silver: 1200, bronze: 600 } as Record<Exclude<Medal, 'none'>, number>,
} as const;

export interface ShopItem {
  id: ItemId;
  name: string;
  cost: number;
  /** Most you can carry in. */
  max: number;
  text: string;
}

export const SHOP: ShopItem[] = [
  { id: 'charge', name: 'Blasting charge', cost: 40, max: 3, text: 'Blow open a door or an inner wall. Loud.' },
  { id: 'rope', name: 'Rope', cost: 30, max: 1, text: 'Anchor at the shaft: climb down to the Deep or back up safely, 1 action.' },
  { id: 'draught', name: 'Healing draught', cost: 25, max: 4, text: 'Heal a hero 2 wounds, or return 3 men to a squad.' },
  { id: 'smoke', name: 'Smoke bomb', cost: 20, max: 4, text: 'Smoke a square and its neighbours for a turn: blocks sight.' },
  { id: 'sellswords', name: 'Sellsword band', cost: 60, max: 1, text: 'A third squad of 6 men joins the company.' },
  { id: 'banner', name: 'War banner', cost: 50, max: 1, text: 'Every hero starts with full Focus.' },
];

export function medalFor(score: number): Medal {
  if (score >= RUN.medals.gold) return 'gold';
  if (score >= RUN.medals.silver) return 'silver';
  if (score >= RUN.medals.bronze) return 'bronze';
  return 'none';
}

export const ALARM_TIERS = [
  { tier: 'Quiet', min: 0 },
  { tier: 'Wary', min: 20 },
  { tier: 'Alert', min: 40 },
  { tier: 'Roused', min: 60 },
  { tier: 'Swarming', min: 80 },
] as const;

export const NOISE = {
  turn: 2,
  attack: 3,
  kill: 2,
  spotted: 2,
  smash: 6,
  chop: 4,
  blast: 15,
  fireball: 10,
  force: 6,
} as const;

/** Campaign numbers (spec section 1). */
export const CAMPAIGN = {
  weeks: 4,
  goal: 2000,
  startGold: 800,
  startMen: 36,
  wagePerMan: 1,
  wagePerHero: 2,
  wageHobart: 3,
  hireCost: 5,
  hirePerWeek: 20,
  outfitCost: 100,
  deathPerMan: 5,
  deathPerHero: 10,
  orcRegrowth: 6,
  maxUnits: 6,
  maxMen: 30,
  squadMin: 3,
  squadMax: 10,
  charges: 2,
} as const;

// ------------------------------------------------------------ treasure

export type TreasureOutcome = { item?: Omit<LootItem, 'id'>; wounds?: number; special?: boolean; text: string };

/** 1980 Treasure Determination Chart (7.23), rows 1..16. */
export function treasureRow(n: number): TreasureOutcome {
  switch (Math.max(1, Math.min(16, n))) {
    case 1:
      return coins(5);
    case 2:
      return { item: { name: 'Brass candelabra', value: 0, weight: 10 }, text: 'a brass candelabra (worthless)' };
    case 3:
      return coins(25);
    case 4:
      return { wounds: 1, text: 'a venomous snake' };
    case 5:
      return coins(50);
    case 6:
      return coins(200);
    case 7:
      return { item: { name: 'Jewel', value: 100, weight: 1 }, text: 'a jewel worth 100' };
    case 8:
      return { item: { name: 'Iron table utensils', value: 0, weight: 10 }, text: 'iron table utensils (worthless)' };
    case 9:
    case 11:
    case 13:
      return { special: true, text: 'something special' };
    case 10:
      return { wounds: 1, text: 'a poisonous spider' };
    case 12:
      return coins(800);
    case 14:
      return { item: { name: 'Jewelry', value: 500, weight: 10 }, text: 'jewelry worth 500' };
    case 15:
      return { item: { name: 'Amulet of ten spells', value: 400, weight: 1, spellPoints: 10 }, text: 'a 10-spell-point amulet' };
    default:
      return { wounds: 2, text: 'vampire bats' };
  }
}

/** 1980 Special Treasure Chart (7.25), d6. */
export function specialRow(n: number): TreasureOutcome {
  switch (n) {
    case 1:
      return { item: { name: 'Scroll', value: 50, weight: 1, spellPoints: 2 }, text: 'a scroll worth 2 spell points' };
    case 2:
      return { item: { name: 'Ring', value: 150, weight: 1, spellPoints: 4 }, text: 'a ring worth 4 spell points' };
    case 3:
      return { item: { name: 'Amulet', value: 300, weight: 1, spellPoints: 8 }, text: 'an amulet worth 8 spell points' };
    case 4:
      return coins(5000);
    case 5:
      return { item: { name: '+1 Weapon', value: 100, weight: 5, enchanted: true }, text: 'a +1 weapon' };
    default:
      return { item: { name: 'Fine jewelry', value: 1500, weight: 15 }, text: 'jewelry worth 1,500' };
  }
}

function coins(n: number): TreasureOutcome {
  return { item: { name: `${n.toLocaleString('en-US')} gold coins`, value: n, weight: n }, text: `${n.toLocaleString('en-US')} gold coins` };
}

/** Trap chart (7.24), adjusted roll 1..9. */
export function trapRow(n: number): { wounds: number; sleep?: boolean; text: string } {
  if (n >= 7) return { wounds: 0, text: 'Trap detected, no harm done' };
  switch (n) {
    case 1:
    case 3:
    case 6:
      return { wounds: 1, text: 'A trap springs: 1 wound' };
    case 2:
      return { wounds: 2, text: 'A trap springs: 2 wounds' };
    case 4:
      return { wounds: 0, text: 'No trap after all' };
    default:
      return { wounds: 0, sleep: true, text: 'Sleep gas fills the room' };
  }
}

/** Smashing table (4.451). Returns 'S' success, 'N' not yet, 'X' never. */
export function smashResult(roll: number, men: number): 'S' | 'N' | 'X' {
  if (roll === 6) return 'X';
  const best = men >= 3 ? 4 : men === 2 ? 3 : 2;
  return roll <= best ? 'S' : 'N';
}
