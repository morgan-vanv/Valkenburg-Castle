// V2 castle: two levels built for play, not copied from 1980.
// Big rooms, two-square halls, few doors, a shaft into the Deep, and the
// Dragon's hoard at the bottom. Columns A–U, rows 1–15.

import { at } from '../../engine/geometry';
import type { CastleMap, LootSpot, Spawn } from '../../engine/types';
import { parseGrid } from './grid';

//            ABCDEFGHIJKLMNOPQRSTU
const HALLS = [
  '#####################', //  1
  '#.....#......#......#', //  2  Treasury | Library | Barracks
  '#.....X......#..G...#', //  3  cracked wall G-3 (Library side)
  '#.....#......#......#', //  4
  '#.....#......#......#', //  5
  '###=####...#####+####', //  6  locked treasury, open library, barracks door
  '#E..................#', //  7  the Long Hall (west gate at B-7)
  '#...................#', //  8
  '##..#####...#####+###', //  9  gatehouse, shaft hall, chapel door
  '#.....#.......#.....#', // 10  Gatehouse | Shaft Hall | Chapel
  '#.....#..OOO..#.....#', // 11
  '#.....#..OOO..#.....#', // 12
  '#.....#..OOO..#.....#', // 13
  '#.E...#.......#....S#', // 14  south gate C-14, stairs down T-14
  '#####################', // 15
];

//            ABCDEFGHIJKLMNOPQRSTU
const DEEP = [
  '#####################', //  1
  '#R....#............H#', //  2  Warren | the Dragon's cavern
  '#.....#.......D....H#', //  3
  '#..G..#.............#', //  4
  '#.....#.............#', //  5
  '#.....######...######', //  6  cavern mouth
  '#...................#', //  7  the Undertunnel
  '#...................#', //  8
  '##=######...#####+###', //  9  locked bone vault, the Drop, crypt door
  '#.....#.......#.....#', // 10  Bone Vault | the Drop | Crypt
  '#.....#.......#.....#', // 11
  '#.....X.......X.....#', // 12  cracked walls G-12 and O-12 (blast from the Drop)
  '#.....#.......#.....#', // 13
  '#.....#.......#....S#', // 14  stairs up T-14
  '#####################', // 15
];

const L1 = (s: string) => at(1, s);
const L2 = (s: string) => at(2, s);

const loot: LootSpot[] = [
  { at: L1('E-12'), name: 'Gatehouse strongbox', value: 40, sacks: 1 },
  { at: L1('K-3'), name: 'Gilded books', value: 120, sacks: 1 },
  { at: L1('B-2'), name: 'Silver plate', value: 150, sacks: 1 },
  { at: L1('E-4'), name: 'Coin chest', value: 150, sacks: 1 },
  { at: L1('S-4'), name: 'Pay chest', value: 80, sacks: 1 },
  { at: L1('Q-12'), name: 'Reliquary', value: 100, sacks: 1 },
  { at: L1('M-14'), name: 'Fallen knight\'s purse', value: 30, sacks: 1 },
  { at: L2('C-5'), name: 'Orc tribute', value: 80, sacks: 1 },
  { at: L2('B-12'), name: 'Bone vault gold', value: 250, sacks: 1 },
  { at: L2('E-14'), name: 'Jewelled skull', value: 150, sacks: 1 },
  { at: L2('H-13'), name: 'Lost expedition\'s pack', value: 100, sacks: 1 },
  { at: L2('Q-11'), name: 'Crypt crown', value: 200, sacks: 1 },
  { at: L2('T-2'), name: 'Dragon hoard', value: 500, sacks: 2 },
  { at: L2('T-3'), name: 'Dragon hoard', value: 500, sacks: 2 },
];

const spawns: Spawn[] = [
  { at: L1('R-3'), cls: 'orcSquad', name: 'Barracks band', men: 5 },
  { at: L1('Q-4'), cls: 'evilLeader', name: 'Orc captain' },
  { at: L1('O-7'), cls: 'orcSquad', name: 'Hall patrol', men: 4, awake: true },
  { at: L1('J-3'), cls: 'troll', name: 'Troll' },
  { at: L1('R-11'), cls: 'banshee', name: 'Banshee' },
  { at: L2('C-4'), cls: 'orcSquad', name: 'Warren band', men: 6 },
  { at: L2('D-3'), cls: 'evilMagicUser', name: 'Gorlath the Witch' },
  { at: L2('E-7'), cls: 'orcSquad', name: 'Tunnel watch', men: 4 },
  { at: L2('C-12'), cls: 'mantis', name: 'Mantis' },
  { at: L2('K-12'), cls: 'spider', name: 'Giant Spider' },
  { at: L2('R-12'), cls: 'ogre', name: 'Ogre' },
  { at: L2('O-3'), cls: 'dragon', name: 'The Dragon' },
];

export const v2Castle: CastleMap = {
  name: 'Valkenburg Castle',
  levels: [parseGrid({ id: 1, name: 'The Halls', rows: HALLS }), parseGrid({ id: 2, name: 'The Deep', rows: DEEP })],
  links: [{ kind: 'stairs', a: L1('T-14'), b: L2('T-14') }],
  loot,
  spawns,
  shafts: [{ top: ['J-11', 'K-11', 'L-11', 'J-12', 'K-12', 'L-12', 'J-13', 'K-13', 'L-13'].map(L1), bottom: ['J-11', 'K-11', 'L-11', 'J-12', 'K-12', 'L-12', 'J-13', 'K-13', 'L-13'].map(L2) }],
};
