// Player-facing names for classes, methods, spells and frontage.

import type { Armor, DoorMethod, Frontage, SpellId, Unit, UnitClass } from '../engine/types';

export const CLASS_NAME: Record<UnitClass, string> = {
  hobart: 'Lord, +2 leader',
  leader: 'Leader, +1',
  dwarf: 'Dwarf',
  burglar: 'Burglar',
  magicUser: 'Magic User',
  squad: 'Squad',
  orcSquad: 'Orc squad',
  evilLeader: 'Orc leader',
  evilMagicUser: 'Evil magic user',
  troll: 'Troll',
  ogre: 'Ogre',
  berserker: 'Berserker',
  mantis: 'Mantis',
  spider: 'Giant spider',
  drog: 'Drog',
  banshee: 'Banshee',
  dragon: 'Dragon',
  dummy: 'Contact',
};

/** Short counter glyph for roster badges, 1980 style. */
export const CLASS_GLYPH: Partial<Record<UnitClass, string>> = {
  hobart: 'L2',
  leader: 'L1',
  dwarf: 'D',
  burglar: 'B',
  magicUser: 'M',
  squad: 'S',
};

export const ARMOR_NAME: Record<Armor, string> = { unarmored: 'Unarmored', normal: 'Normal', heavy: 'Heavy' };

export const METHOD_NAME: Record<DoorMethod, string> = { pick: 'Pick lock', unlock: 'Unlock spell', smash: 'Smash', chop: 'Chop', blast: 'Set charge' };

export const METHOD_NOTE: Record<DoorMethod, string> = {
  pick: 'd6: 1–3 opens, 6 jams. Silent.',
  unlock: '2 spell points. Always opens. Ends turn.',
  smash: '1–3 men try. Noise +6.',
  chop: '+d6 toward 10. Noise +4.',
  blast: 'Blows at end of phase. Noise +15.',
};

export const SPELL_NAME: Record<SpellId, string> = { esp: 'ESP', fireball: 'Fireball', smokescreen: 'Smokescreen', pyrotechnics: 'Pyrotechnics', unlock: 'Unlock Door', combat: 'Combat' };

export const SPELL_NOTE: Record<SpellId, string> = {
  esp: 'Reveal contacts within 4.',
  fireball: 'd6+2 wounds down a line. Wakes the level.',
  smokescreen: 'Smoke an adjacent square for a turn.',
  pyrotechnics: 'Squads in the target square check morale.',
  unlock: 'Open an adjacent locked door.',
  combat: '+10 on one attack this turn.',
};

export const FRONTAGE_NAME: Record<Frontage, string> = { narrow: 'Narrow', wide: 'Wide', open: 'Open' };

export function unitStrength(u: Unit): string {
  if (u.cls === 'squad' || u.cls === 'orcSquad') return `${u.men} men`;
  return `${u.maxWounds - u.wounds}/${u.maxWounds} wounds left`;
}

export function isSquad(u: Unit): boolean {
  return u.cls === 'squad' || u.cls === 'orcSquad';
}
