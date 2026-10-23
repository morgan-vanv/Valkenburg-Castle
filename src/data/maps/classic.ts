// The classic 1980 castle, levels 1 to 3, transcribed from the original map
// sheets. See ./README.md for the grid format and transcription notes.
// Columns use the 1980 letters on every level, so level 3 starts at F.

import { at } from '../../engine/geometry';
import type { CastleMap, LevelLink } from '../../engine/types';
import { parseLevel, type LevelSpec } from './parse';

// Grid key: '-' '|' wall, ' ' open (dotted), 'd' door, 'L' locked door.
// Cells: '.' floor, '#' rock, 'p' pit, G guardroom, S stairs, X ladder,
// E entrance, C prison cell, B balcony, D dragon lair, H hoard.

export const LEVEL_1: LevelSpec = {
  id: 1,
  name: 'First Level',
  x0: 0,
  width: 16,
  height: 12,
  //   A B C D E F G H I J K L M N O P
  grid: [
    '+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+',
    '|. .d. .L. .|.|E|. .L. .|. .d. .|',
    '+ + +-+ +-+-+L+ +-+-+d+ + + + + +',
    '|G .|.|. . . . . . . .|.d. .|. .|',
    '+ + + +-+-+-+-+-+ +-+d+-+-+-+-+d+',
    '|. .|.d. . .L. .|.|. B B B .|. .|',
    '+d+-+-+ +-+-+ + + + + + + + + + +',
    '|.|. .d. . S|. .|.dB p p p B|. .|',
    '+ + + + +-+-+-+-+d+ + + + + + + +',
    '|.|. .|.|. .|. G .|B p p p B|. .|',
    '+ + + + + + + + + + + + + + +-+d+',
    '|.|. .|.d. .|. . .|B p p p B|X|.|',
    '+ +-+d+ +-+-+-+-+d+ + + + + +L+ +',
    '|E .|.|.d. .|. .|.|B p p p BL. .|',
    '+-+ + +L+ + + + + + + + + + +-+d+',
    '|.|.|. .|. .|. .|.|. B B B .|. .|',
    '+d+d+-+ + + + + + +-+-+d+-+-+ + +',
    '|. . .d.|. .|. .|. . . . . .d. .|',
    '+ + + + +-+-+-+d+d+-+-+d+-+-+ + +',
    '|. . G|. .|. . .|. .L.|.|. .|. .|',
    '+L+d+-+-+ + + + + + +-+ + + +d+-+',
    '|.|. . .|.d. . .|. .|.|.|. .|. .|',
    '+ +-+-+ +-+-+-+-+-+-+L+ + + + + +',
    '|. . S|. . E . . . . . .|. .L. .|',
    '+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+',
  ],
  entrances: ['H-1', 'A-7', 'F-12'],
  guardrooms: ['A-2', 'H-5', 'C-10'],
  // The ledge squares next to the Pit (4.9). The corners J-3, N-3, J-8 and
  // N-8 are part of the Pit room but only touch the Pit diagonally.
  balcony: [
    'K-3', 'L-3', 'M-3',
    'J-4', 'N-4', 'J-5', 'N-5', 'J-6', 'N-6', 'J-7', 'N-7',
    'K-8', 'L-8', 'M-8',
  ],
};

export const LEVEL_2: LevelSpec = {
  id: 2,
  name: 'Second Level',
  x0: 0,
  width: 16,
  height: 12,
  //   A B C D E F G H I J K L M N O P
  grid: [
    '+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+',
    '|. . . S|. . . .|. S|. .|. .L. X|',
    '+ +-+-+-+ + + + + +-+ + + + +-+-+',
    '|.|.L. .|. . . .|.|.d. .d. .d. .|',
    '+ +L+ + + + + + + + + + + + + + +',
    '|.|.|. .|. . . .|.|.|. .|. .|. .|',
    '+ +-+-+d+d+-+-+-+ + +-+-+-+-+-+L+',
    '|. . . . .|S . .d.|.|p p p|. .d.|',
    '+d+-+-+ +d+-+-+-+ + + + + + + + +',
    '|. . .|.|. . . .|.|.|p p p|. .|.|',
    '+ + + + + + + + + + + + + +L+-+ +',
    '|. . .|.|. . . .|.|.|p p p|.|X|.|',
    '+d+-+-+ + + + + + +d+ + + +-+L+ +',
    '|.d. . .|. . . .|. .|p p p|. .|.|',
    '+d+-+-+ +-+-+-+-+-+ +-+-+-+ + + +',
    '|. . .|.|C|C|C|C .|. . . .d. .|.|',
    '+ + + + +L+L+L+L+-+-+-+d+ +-+-+ +',
    '|. . .|.|. . . .L.|. . .|. . . .|',
    '+-+-+d+ +L+-+L+L+ + +-+-+ +-+d+-+',
    '|. . .|.|. .|C|C|.|.d. .|.|. .|.|',
    '+ + + + + + +-+-+-+-+ + + + +d+L+',
    '|. . .d.|G .|S|. .|.L. .|.|.|. .|',
    '+L+-+-+ + + + +-+d+-+-+-+ +L+ + +',
    '|. .|S .d. .d. . . . . . .|.|. .|',
    '+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+',
  ],
  guardrooms: ['E-11'],
  prisonCells: ['E-8', 'F-8', 'G-8', 'H-8', 'G-10', 'H-10'],
  reinforcementPoints: ['D-1'],
};

export const LEVEL_3: LevelSpec = {
  id: 3,
  name: 'Third Level',
  x0: 5,
  width: 16,
  height: 12,
  //   F G H I J K L M N O P Q R S T U
  grid: [
    '+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+',
    '|. .L.|.|S|. .|. .|#|X . . .|#|H|',
    '+ + +-+L+d+ + + + +-+ + + + +-+ +',
    '|. .|. .|.|. .|. .|#|. . . . . H|',
    '+ + + + + +-+L+L+-+-+-+ + + +-+-+',
    '|. .d. .d. . . . .|#|#|. . . .|#|',
    '+-+-+ + + +-+-+-+ +-+-+ +-+ + +-+',
    '|. S|. .|.|. . .|. .|#|.|#|. .|#|',
    '+ +-+-+-+ + + + +-+ +-+ +-+ + +-+',
    '|.|. . .d.|. . .|#|.|#|.|#|. . E|',
    '+ + + + + + + + +-+ +-+ +-+ + + +',
    '|.|. . .|.|. . .|#|.L. . . . . E|',
    '+ +-+d+-+ + + + +-+-+-+ + + + + +',
    '|.|. .|S .|. . .|#|#|#|. . D . E|',
    '+ + + +-+d+-+d+-+-+-+-+ + + + + +',
    '|.|. .|. .|.L. .|#|#|#|. . . . E|',
    '+ +L+-+ + +-+ + +-+-+-+ + + + +-+',
    '|.|.|.L. .|.L. .d. .|#|. . . .|#|',
    '+ +-+-+-+d+-+L+-+d+ +-+ + +-+ +-+',
    '|. . . . .|. .|G .|.L. . .|#|.|#|',
    '+L+ +-+d+ + + + + +d+-+ + +-+ +-+',
    '|.|S|. .|.|. .|. .|.|#|. . . . .|',
    '+ +-+ + + +-+-+-+-+ +-+-+-+-+ + +',
    '|.|.L. .|. . . . . .|#|#|#|#|. .|',
    '+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+',
  ],
  entrances: ['U-5', 'U-6', 'U-7', 'U-8'],
  guardrooms: ['M-10'],
  reinforcementPoints: ['G-4', 'I-7'],
  lair: 'S-7',
  hoard: ['U-1', 'U-2'],
};

const stairs = (from: 1 | 2, to: 2 | 3, lbl: string): LevelLink => ({ kind: 'stairs', a: at(from, lbl), b: at(to, lbl) });
const ladder = (from: 1 | 2, to: 2 | 3, lbl: string): LevelLink => ({ kind: 'ladder', a: at(from, lbl), b: at(to, lbl) });

/** Every stairway and ladder between playable levels. Both ends share a letter and row. */
export const CLASSIC_LINKS: LevelLink[] = [
  stairs(1, 2, 'F-4'),
  stairs(1, 2, 'C-12'),
  ladder(1, 2, 'O-6'),
  stairs(2, 3, 'J-1'),
  stairs(2, 3, 'G-11'),
  ladder(2, 3, 'P-1'),
];

export const CLASSIC_LEVEL_SPECS: LevelSpec[] = [LEVEL_1, LEVEL_2, LEVEL_3];

export const classicCastle: CastleMap = {
  name: 'Valkenburg Castle (1980)',
  levels: CLASSIC_LEVEL_SPECS.map(parseLevel),
  links: CLASSIC_LINKS,
};
