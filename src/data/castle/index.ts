// The V3.1 castle: three levels from the approved sketch (mockup/sketch.py).
// Tiles come from region shapes (shapes.ts, regions.ts) plus hand edits in
// level1-3.ts; everything placed on them lives here, by offset (col, row).

import type { CastleDef } from '../../game/types';
import { at } from './build';
import { buildLevel1 } from './level1';
import { buildLevel2 } from './level2';
import { buildLevel3 } from './level3';

const b1 = buildLevel1();
const b2 = buildLevel2();
const b3 = buildLevel3();

const L1 = (c: number, r: number) => at(1, c, r);
const L2 = (c: number, r: number) => at(2, c, r);
const L3 = (c: number, r: number) => at(3, c, r);

export const castle: CastleDef = {
  name: 'Castle Valkenburg',
  levels: [b1.finish(), b2.finish(), b3.finish()],
  links: [
    // Tower stair (L1) down to the guard post (L2).
    { kind: 'stairs', a: L1(37, 3), b: L2(37, 3) },
    // The lift: winch room (L2) down to the lift base (L3); the winch stands beside it.
    { kind: 'lift', a: L2(24, 27), b: L3(24, 27), winch: L2(25, 27) },
  ],
  // Index order matters to `startDelve.entrance`: main gate, sally port, east breach.
  entrances: [L1(24, 31), L1(1, 14), L1(44, 21)],
  rivalEntrances: [L1(44, 21), L1(1, 14)],
  spawns: [
    // Level 1
    { at: L1(8, 12), kind: 'rats' },
    { at: L1(5, 16), kind: 'rats' },
    { at: L1(8, 24), kind: 'cutpurse', asleep: false },
    { at: L1(7, 3), kind: 'spider' },
    { at: L1(21, 13), kind: 'orc', asleep: false },
    { at: L1(31, 17), kind: 'orc' },
    { at: L1(36, 4), kind: 'orc' },
    // Level 2
    { at: L2(19, 3), kind: 'orc' },
    { at: L2(21, 2), kind: 'orc' },
    { at: L2(26, 3), kind: 'orc' },
    { at: L2(29, 2), kind: 'orc' },
    { at: L2(11, 23), kind: 'orc', name: 'Grub the Jailer', asleep: false },
    { at: L2(7, 12), kind: 'spider' },
    { at: L2(34, 27), kind: 'berserker', name: 'Ugluk Red-Hand' },
    { at: L2(28, 21), kind: 'rats' },
    { at: L2(20, 7), kind: 'orc', asleep: false },
    { at: L2(24, 6), kind: 'orc', asleep: false },
    { at: L2(35, 19), kind: 'orc' },
    // Level 3
    { at: L3(22, 14), kind: 'rats' },
    { at: L3(14, 3), kind: 'spider' },
    { at: L3(15, 5), kind: 'spider' },
    { at: L3(23, 25), kind: 'orc' },
    { at: L3(25, 25), kind: 'orc' },
    { at: L3(7, 22), kind: 'berserker' },
    { at: L3(39, 11), kind: 'dragon' },
  ],
  chests: [
    // Level 1: tiers 1 and 2; the armory's is locked.
    { id: 'l1-library-chest', at: L1(11, 4), tier: 1 },
    { id: 'l1-kitchen-chest', at: L1(4, 12), tier: 1 },
    { id: 'l1-chapel-chest', at: L1(38, 24), tier: 1 },
    { id: 'l1-tower-chest', at: L1(39, 2), tier: 2 },
    { id: 'l1-armory-chest', at: L1(40, 12), tier: 2, locked: true },
    // Level 2: tier 2; the officers' strongbox (locked) and the archive's are tier 3.
    { id: 'l2-barracks-chest', at: L2(30, 1), tier: 2 },
    { id: 'l2-guard-chest', at: L2(38, 4), tier: 2 },
    { id: 'l2-forge-chest', at: L2(31, 26), tier: 2 },
    { id: 'l2-officers-strongbox', at: L2(8, 3), tier: 3, locked: true },
    { id: 'l2-archive-chest', at: L2(4, 15), tier: 3 },
    // Level 3: tier 3.
    { id: 'l3-nest-chest', at: L3(12, 3), tier: 3 },
    { id: 'l3-drain-chest', at: L3(5, 26), tier: 3 },
  ],
  coins: [
    { at: L1(13, 25), gold: 10 },
    { at: L1(26, 20), gold: 15 },
    { at: L1(41, 12), gold: 20 },
    { at: L2(24, 2), gold: 25 },
    { at: L2(12, 22), gold: 30 },
    { at: L2(34, 9), gold: 30 },
    { at: L2(22, 27), gold: 25 },
    { at: L3(26, 15), gold: 40 },
    { at: L3(30, 24), gold: 35 },
    { at: L3(17, 4), gold: 50 },
    { at: L3(12, 10), gold: 40 },
  ],
  traps: [
    { at: L1(6, 8) }, // servants' passage
    { at: L1(24, 22) }, // gate passage
    { at: L2(14, 3) }, // officers' corridor, by the locked door
    { at: L2(5, 19) }, // archive to cellblock, by the door
    { at: L3(19, 8) }, // nest tunnel
    { at: L3(16, 25) }, // drain tunnel
  ],
  braziers: [L1(37, 21), L2(39, 6), L2(10, 15), L3(11, 12)],
  contractSites: [
    { id: 'l1-rescue-library', kind: 'rescue', at: L1(12, 1), where: 'the library' },
    { id: 'l1-recover-armory', kind: 'recover', at: L1(41, 14), where: 'the armory' },
    { id: 'l1-recover-chapel', kind: 'recover', at: L1(36, 20), where: 'the chapel altar' },
    { id: 'l2-rescue-cell-west', kind: 'rescue', at: L2(8, 21), where: 'the cellblock' },
    { id: 'l2-rescue-cell-east', kind: 'rescue', at: L2(12, 24), where: 'the cellblock' },
    { id: 'l2-recover-archive', kind: 'recover', at: L2(11, 11), where: 'the archive' },
    { id: 'l2-recover-forge', kind: 'recover', at: L2(34, 28), where: 'the forge' },
    { id: 'l3-rescue-nest', kind: 'rescue', at: L3(15, 2), where: 'the Spider Nest' },
    { id: 'l3-recover-grove', kind: 'recover', at: L3(11, 14), where: 'the Fungus Grove' },
    { id: 'l3-recover-drain', kind: 'recover', at: L3(3, 27), where: 'the Drain' },
    { id: 'l3-slay-dragon', kind: 'slay', at: L3(39, 11), where: 'the Lair' },
  ],
  lights: [...b1.lights, ...b2.lights, ...b3.lights],
};
