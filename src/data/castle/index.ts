// The V3 castle: the Van Valkenburg seat, Levels 1 and 2.
// Tile grids live in level1.ts / level2.ts; everything placed on them lives
// here, by offset (col, row) through `at`. Format: see parse.ts.

import type { CastleDef } from '../../game/types';
import { level1 } from './level1';
import { level2 } from './level2';
import { at, pitEdge, pitFootprint } from './parse';

const L1 = (c: number, r: number) => at(1, c, r);
const L2 = (c: number, r: number) => at(2, c, r);

export const castle: CastleDef = {
  name: 'Castle Valkenburg',
  levels: [level1, level2],
  links: [
    // Tower stair down to the undercroft.
    { kind: 'stairs', a: L1(28, 14), b: L2(28, 14) },
    // The great pit: the balcony rim drops onto the landing right below it.
    { kind: 'pit', edge: pitEdge(level1), landing: pitFootprint(level1, 2) },
  ],
  // Index order matters to `startDelve.entrance`: gate, sally port, breach.
  entrances: [L1(16, 25), L1(0, 13), L1(33, 14)],
  rivalEntrances: [L1(33, 13), L1(0, 14)],
  spawns: [
    // Level 1
    { at: L1(3, 6), kind: 'rats' },
    { at: L1(6, 15), kind: 'rats' },
    { at: L1(6, 23), kind: 'cutpurse' },
    { at: L1(30, 6), kind: 'spider' },
    { at: L1(25, 14), kind: 'orc' },
    { at: L1(27, 23), kind: 'orc' },
    { at: L1(30, 22), kind: 'orc', name: 'Snaga the Quartermaster' },
    // Level 2
    { at: L2(13, 12), kind: 'orc' },
    { at: L2(18, 12), kind: 'orc' },
    { at: L2(20, 15), kind: 'orc' },
    { at: L2(26, 2), kind: 'orc' },
    { at: L2(29, 3), kind: 'orc' },
    { at: L2(27, 6), kind: 'orc' },
    { at: L2(3, 12), kind: 'orc', name: 'Grub the Jailer' },
    { at: L2(20, 21), kind: 'berserker', name: 'Ugluk Red-Hand' },
    { at: L2(2, 24), kind: 'spider' },
    { at: L2(30, 24), kind: 'rats' },
    { at: L2(15, 7), kind: 'rats' },
  ],
  chests: [
    // Level 1: tiers 1 and 2; the armory's two are the prize behind the locked door.
    { id: 'l1-library-chest', at: L1(7, 2), tier: 1 },
    { id: 'l1-chapel-chest', at: L1(25, 1), tier: 1 },
    { id: 'l1-kitchen-chest', at: L1(1, 16), tier: 1 },
    { id: 'l1-courtyard-chest', at: L1(9, 20), tier: 1 },
    { id: 'l1-armory-chest', at: L1(31, 24), tier: 2 },
    { id: 'l1-armory-rack', at: L1(26, 21), tier: 2, locked: true },
    // Level 2: tiers 2 and 3; the storeroom strongbox is locked tier 3.
    { id: 'l2-barracks-chest', at: L2(31, 1), tier: 2 },
    { id: 'l2-guard-chest', at: L2(1, 16), tier: 2 },
    { id: 'l2-shrine-chest', at: L2(8, 20), tier: 2 },
    { id: 'l2-undercroft-chest', at: L2(29, 15), tier: 2 },
    { id: 'l2-cell-hoard', at: L2(11, 8), tier: 3 },
    { id: 'l2-strongbox', at: L2(31, 20), tier: 3, locked: true },
  ],
  coins: [
    { at: L1(12, 11), gold: 15 },
    { at: L1(13, 7), gold: 10 },
    { at: L1(19, 24), gold: 12 },
    { at: L1(27, 16), gold: 20 },
    { at: L2(21, 17), gold: 15 },
    { at: L2(17, 2), gold: 25 },
    { at: L2(13, 24), gold: 20 },
  ],
  traps: [
    { at: L1(16, 19) },
    { at: L1(10, 4) },
    { at: L2(6, 5) },
    { at: L2(17, 18) },
    { at: L2(23, 22) },
  ],
  braziers: [L1(28, 2), L1(16, 14), L1(16, 22), L2(16, 14), L2(4, 22)],
  contractSites: [
    { id: 'l1-rescue-library', kind: 'rescue', at: L1(7, 7), where: 'the old library' },
    { id: 'l1-recover-chapel', kind: 'recover', at: L1(28, 4), where: 'the chapel altar' },
    { id: 'l1-recover-courtyard', kind: 'recover', at: L1(2, 21), where: 'the courtyard well' },
    { id: 'l2-rescue-north-cells', kind: 'rescue', at: L2(2, 1), where: 'the north cells' },
    { id: 'l2-rescue-south-cells', kind: 'rescue', at: L2(8, 8), where: 'the south cells' },
    { id: 'l2-recover-shrine', kind: 'recover', at: L2(2, 21), where: 'the old shrine' },
    { id: 'l2-recover-storeroom', kind: 'recover', at: L2(28, 23), where: 'the orc storeroom' },
  ],
};
