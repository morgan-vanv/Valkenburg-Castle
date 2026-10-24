// Numbers from docs/v3-spec.md.

import type { HeroClass, MonsterKind, ShopOffer, Stat, Stats } from './types';

export const LIGHT_MAX = 60;
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
}

export interface ClassDef {
  name: string;
  hp: number;
  stats: Stats;
  weapon: Weapon;
  armor: number;
  main: Stat;
}

export const CLASSES: Record<HeroClass, ClassDef> = {
  hobart: {
    name: 'Lord',
    hp: 12,
    stats: { might: 65, finesse: 50, wits: 55, nerve: 80 },
    weapon: { name: 'Longsword', slots: 3, stat: 'might', dmg: 2 },
    armor: 1,
    main: 'might',
  },
  sellsword: {
    name: 'Sellsword',
    hp: 10,
    stats: { might: 70, finesse: 45, wits: 40, nerve: 60 },
    weapon: { name: 'Sword', slots: 3, stat: 'might', dmg: 2 },
    armor: 1,
    main: 'might',
  },
  burglar: {
    name: 'Burglar',
    hp: 7,
    stats: { might: 40, finesse: 75, wits: 60, nerve: 50 },
    weapon: { name: 'Dagger', slots: 2, stat: 'finesse', dmg: 2 },
    armor: 0,
    main: 'finesse',
  },
  mage: {
    name: 'Mage',
    hp: 6,
    stats: { might: 30, finesse: 50, wits: 75, nerve: 55 },
    weapon: { name: 'Staff', slots: 2, stat: 'might', dmg: 1 },
    armor: 0,
    main: 'wits',
  },
};

export interface MonsterDef {
  name: string;
  hp: number;
  slots: number;
  chance: number;
  dmg: number;
  move: number;
  xp: number;
}

export const MONSTERS: Record<MonsterKind | 'gloam', MonsterDef> = {
  rats: { name: 'Rats', hp: 3, slots: 2, chance: 50, dmg: 1, move: 4, xp: 1 },
  orc: { name: 'Orc', hp: 6, slots: 2, chance: 55, dmg: 2, move: 3, xp: 1 },
  spider: { name: 'Spider', hp: 5, slots: 2, chance: 60, dmg: 2, move: 3, xp: 1 },
  cutpurse: { name: 'Cutpurse', hp: 4, slots: 1, chance: 65, dmg: 1, move: 5, xp: 1 },
  berserker: { name: 'Berserker', hp: 9, slots: 4, chance: 55, dmg: 2, move: 4, xp: 3 },
  gloam: { name: 'The Gloam', hp: 99, slots: 0, chance: 100, dmg: 4, move: 3, xp: 0 },
};

export const SISTER = { hp: 7, slots: 3, chance: 55, dmg: 2, move: 4 };
export const SISTER_NAMES = ['Sister Wenna', 'Sister Odile', 'Sister Brisk'];

/** Total XP needed for each level (index = level). */
export const LEVEL_XP = [0, 0, 5, 12, 20, 30, 45];
export const MAX_LEVEL = 6;

export const BOUNTY = { rescue: [0, 80, 150], recover: [0, 100, 180] } as const;
export const HEIRLOOM_VALUE = [0, 60, 120];

export const SHOP: ShopOffer[] = [
  { kind: 'torch', name: 'Torch', price: 10, text: '12 rounds of light around the bearer.' },
  { kind: 'potion', name: 'Potion', price: 20, text: 'Heals 5. Gets a downed hero up.' },
  { kind: 'rope', name: 'Rope', price: 15, text: 'Anchor at the pit edge to climb down and back.' },
  { kind: 'charge', name: 'Blasting charge', price: 30, text: 'Opens locks and cracked walls. Very loud.' },
];

export const HEAL_PRICE = 30;
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
