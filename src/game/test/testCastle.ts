// A small hand-made three-level castle for engine tests and for the view to use
// until the real castle (src/data/castle) exists. Rows are "odd-r" offset
// layout, one character per hex. The same (col, row) on every level is the
// same (q, r), so pit columns line up straight down.
//   . floor   ^ raised floor   % rubble   o pillar   # wall   (space) void
//   + door    L locked door    x cracked wall   O pit   S stairs   E exit   B brazier
//   = floor with a railing (next to a pit)   l lift   Z sealed door
//   T table (prop)   r stalagmite (prop)   K shelf (tallprop)   W winch (tallprop)   F forge (tallprop)
//
// The pit column: Level 1's pit mouth (10,3) lies over Level 2's bridge row, so a
// jump there lands on Level 2 (1 level, 4 damage). Level 1's (9..11, 4) fall
// through Level 2's pit to the Hollow (2 levels, 7 damage).

import { offsetToAxial, posNeighbors, hexKey, type Pos } from '../hex';
import type { CastleDef, LevelDef, RoomDef, TileDef, TileKind } from '../types';

const LEGEND: Record<string, TileDef | null> = {
  '.': { kind: 'floor' },
  '^': { kind: 'floor', raised: true },
  '=': { kind: 'floor', railing: true },
  '%': { kind: 'rubble' },
  o: { kind: 'pillar' },
  '#': { kind: 'wall' },
  ' ': null,
  '~': null,
  '+': { kind: 'door' },
  L: { kind: 'door', locked: true },
  x: { kind: 'cracked' },
  O: { kind: 'pit' },
  S: { kind: 'stairs' },
  E: { kind: 'exit' },
  B: { kind: 'brazier' },
  l: { kind: 'lift' },
  Z: { kind: 'sealed' },
  T: { kind: 'prop', prop: 'table' },
  r: { kind: 'prop', prop: 'stalagmite' },
  K: { kind: 'tallprop', prop: 'shelf' },
  W: { kind: 'tallprop', prop: 'winch' },
  F: { kind: 'tallprop', prop: 'forge' },
};

const ROOMY: TileKind[] = ['floor', 'rubble', 'stairs', 'exit', 'lift', 'prop', 'tallprop'];

/** Position from offset (col, row) on a level. */
export function at(level: number, col: number, row: number): Pos {
  return { level, ...offsetToAxial(col, row) };
}

/** Build a LevelDef from ASCII rows. Rooms are flood-filled from their label hex, stopping at doors and solids. */
export function asciiLevel(
  level: number,
  name: string,
  rows: string[],
  rooms: { id: string; name: string; col: number; row: number }[],
): LevelDef {
  const tiles: Record<string, TileDef> = {};
  rows.forEach((line, row) => {
    [...line].forEach((ch, col) => {
      const def = LEGEND[ch];
      if (def === undefined) throw new Error(`testCastle: unknown tile '${ch}' at ${col},${row}`);
      if (def) tiles[hexKey(offsetToAxial(col, row))] = { ...def };
    });
  });
  const roomDefs: RoomDef[] = [];
  for (const rm of rooms) {
    const start = offsetToAxial(rm.col, rm.row);
    roomDefs.push({ id: rm.id, name: rm.name, labelAt: start });
    const queue = [start];
    while (queue.length) {
      const h = queue.pop()!;
      const t = tiles[hexKey(h)];
      if (!t || !ROOMY.includes(t.kind) || t.room) continue;
      t.room = rm.id;
      for (const n of posNeighbors({ level, ...h })) queue.push({ q: n.q, r: n.r });
    }
  }
  return { level, name, tiles, rooms: roomDefs };
}

//                  1111111111
//        01234567890123456789
const L1 = [
  '####################', // 0
  '#......#.....#.....#', // 1
  '#..T...+.....#..B..#', // 2
  '#..o...#.=O..L.....#', // 3  pit mouth (10,3) over the L2 bridge; railing at (9,3)
  '#..K...#.OOO.#.....#', // 4  (9..11,4) fall two levels
  '###+####.....###+###', // 5
  '#......#..^^.#.....#', // 6
  '#.S....+.....+....E#', // 7
  '#......#.....#.....#', // 8
  '##E#################', // 9
];

const L2 = [
  '####################', // 0
  '#.....#............#', // 1
  '#..B..#..........F.#', // 2  forge (17,2)
  '#.....+..=.=..%....#', // 3  the bridge row; railed at (9,3) and (11,3), gap at (10,3); rubble (14,3)
  '#.S...#.=OOO=......#', // 4  pit (9..11,4)
  '###x####.OOO.......#', // 5  pit (9..11,5)
  '#l....#......###+###', // 6  lift (1,6)
  '#W....+......#.....#', // 7  winch (1,7)
  '#.....#......#.....#', // 8
  '####################', // 9
];

const L3 = [
  '####################', // 0
  '#.....r......#.....#', // 1
  '#............#.....#', // 2  vent (15,2)
  '#............+.....#', // 3  lair door (13,3)
  '#............#.....#', // 4  Dragon (16,4)
  '#............#.....#', // 5
  '#l...........#.....#', // 6  lift base (1,6); vent (15,6)
  '#............Z.....#', // 7  the sealed stair
  '#E...........#.....#', // 8  cave mouth (1,8)
  '####################', // 9
];

const level1 = asciiLevel(1, 'The Test Keep', L1, [
  { id: 'pantry', name: 'Pantry', col: 3, row: 2 },
  { id: 'gate', name: 'Gate room', col: 3, row: 7 },
  { id: 'pithall', name: 'Pit hall', col: 10, row: 7 },
  { id: 'armory', name: 'Armory', col: 16, row: 3 },
  { id: 'easthall', name: 'East hall', col: 16, row: 7 },
]);

const level2 = asciiLevel(2, 'The Test Crossing', L2, [
  { id: 'shrine', name: 'Shrine', col: 3, row: 3 },
  { id: 'landing', name: 'Crossing', col: 14, row: 3 },
  { id: 'winchroom', name: 'Winch room', col: 3, row: 7 },
  { id: 'cells', name: 'Cells', col: 16, row: 7 },
]);

const level3 = asciiLevel(3, 'The Test Hollow', L3, [
  { id: 'hollow', name: 'Hollow', col: 5, row: 4 },
  { id: 'lair', name: 'Lair', col: 16, row: 3 },
]);
level3.rooms[0]!.material = 'rock';
level3.rooms[1]!.material = 'bone';

export const testCastle: CastleDef = {
  name: 'Test Castle',
  levels: [level1, level2, level3],
  links: [
    { kind: 'stairs', a: at(1, 2, 7), b: at(2, 2, 4) },
    { kind: 'lift', a: at(2, 1, 6), b: at(3, 1, 6), winch: at(2, 1, 7) },
  ],
  entrances: [at(1, 2, 9), at(1, 18, 7)],
  spawns: [
    { at: at(1, 4, 2), kind: 'rats' },
    { at: at(1, 16, 4), kind: 'orc' },
    { at: at(2, 16, 2), kind: 'spider' },
    { at: at(2, 9, 7), kind: 'orc', name: 'Grub the Jailer' },
    { at: at(3, 5, 3), kind: 'rats' },
    { at: at(3, 16, 4), kind: 'dragon', name: 'Valkenburg Wyrm' },
  ],
  chests: [
    { id: 'c1', at: at(1, 2, 1), tier: 1 },
    { id: 'c2', at: at(1, 17, 1), tier: 2, locked: true },
    { id: 'c3', at: at(2, 17, 4), tier: 2 },
  ],
  coins: [
    { at: at(1, 5, 7), gold: 12 },
    { at: at(2, 10, 2), gold: 20 },
  ],
  traps: [{ at: at(1, 11, 7) }],
  braziers: [at(1, 16, 2), at(2, 3, 2)],
  contractSites: [
    { id: 'rec1', kind: 'recover', at: at(1, 5, 3), where: 'the pantry' },
    { id: 'res1', kind: 'rescue', at: at(2, 16, 8), where: 'the cells' },
    { id: 'res2', kind: 'rescue', at: at(1, 16, 8), where: 'the east hall' },
    { id: 'slay', kind: 'slay', at: at(3, 16, 4), where: 'the Lair' },
  ],
  rivalEntrances: [at(1, 18, 7)],
  lights: [
    { at: at(1, 4, 6), radius: 2, kind: 'sconce' },
    { at: at(1, 2, 8), radius: 3, kind: 'daylight' },
    { at: at(2, 17, 2), radius: 3, kind: 'fire' }, // the forge
    { at: at(3, 3, 2), radius: 2, kind: 'fungus' },
    { at: at(3, 17, 8), radius: 2, kind: 'glow' },
    { at: at(3, 15, 2), radius: 1, kind: 'fire' }, // vent
    { at: at(3, 15, 6), radius: 1, kind: 'fire' }, // vent
  ],
};
