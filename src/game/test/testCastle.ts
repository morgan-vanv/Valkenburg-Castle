// A small hand-made two-level castle for engine tests and for the view to use
// until the real castle (src/data/castle) exists. Rows are "odd-r" offset
// layout, one character per hex:
//   . floor   ^ raised floor   % rubble   o pillar   # wall   (space) void
//   + door    L locked door    x cracked wall   O pit   S stairs   E exit   B brazier

import { offsetToAxial, posNeighbors, hexKey, type Pos } from '../hex';
import type { CastleDef, LevelDef, RoomDef, TileDef, TileKind } from '../types';

const LEGEND: Record<string, TileDef | null> = {
  '.': { kind: 'floor' },
  '^': { kind: 'floor', raised: true },
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
};

const ROOMY: TileKind[] = ['floor', 'rubble', 'stairs', 'exit'];

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

/** Floor-like hexes on `level` adjacent to any pit tile. */
function pitEdge(def: LevelDef): Pos[] {
  const out: Pos[] = [];
  for (const [k, t] of Object.entries(def.tiles)) {
    if (t.kind !== 'floor') continue;
    const [q, r] = k.split(',').map(Number) as [number, number];
    const p = { level: def.level, q, r };
    if (posNeighbors(p).some((n) => def.tiles[hexKey(n)]?.kind === 'pit')) out.push(p);
  }
  return out;
}

//                  1111111111
//        01234567890123456789
const L1 = [
  '####################', // 0
  '#......#.....#.....#', // 1
  '#......+.....#..B..#', // 2
  '#..o...#..O..L.....#', // 3
  '#......#.OO..#.....#', // 4
  '###+####.....###+###', // 5
  '#......#..^^.#.....#', // 6
  '#.S....+.....+....E#', // 7
  '#......#.....#.....#', // 8
  '##E#################', // 9
];

const L2 = [
  '####################', // 0
  '#.....#............#', // 1
  '#..B..#............#', // 2
  '#.....+....%.......#', // 3
  '#.S...#............#', // 4
  '###x####...........#', // 5
  '#.....#.....###+####', // 6
  '#.....+.....#......#', // 7
  '#.....#.....#......#', // 8
  '####################', // 9
];

const level1 = asciiLevel(1, 'The Test Keep', L1, [
  { id: 'pantry', name: 'Pantry', col: 3, row: 2 },
  { id: 'gate', name: 'Gate room', col: 3, row: 7 },
  { id: 'pithall', name: 'Pit hall', col: 10, row: 7 },
  { id: 'armory', name: 'Armory', col: 16, row: 3 },
  { id: 'easthall', name: 'East hall', col: 16, row: 7 },
]);

const level2 = asciiLevel(2, 'The Test Cells', L2, [
  { id: 'shrine', name: 'Shrine', col: 3, row: 3 },
  { id: 'landing', name: 'Landing', col: 10, row: 3 },
  { id: 'store', name: 'Storeroom', col: 3, row: 7 },
  { id: 'cells', name: 'Cells', col: 16, row: 7 },
]);

export const testCastle: CastleDef = {
  name: 'Test Castle',
  levels: [level1, level2],
  links: [
    { kind: 'stairs', a: at(1, 2, 7), b: at(2, 2, 4) },
    { kind: 'pit', edge: pitEdge(level1), landing: [at(2, 10, 3), at(2, 9, 4), at(2, 10, 4)] },
  ],
  entrances: [at(1, 2, 9), at(1, 18, 7)],
  spawns: [
    { at: at(1, 4, 2), kind: 'rats' },
    { at: at(1, 16, 4), kind: 'orc' },
    { at: at(2, 16, 2), kind: 'spider' },
    { at: at(2, 9, 7), kind: 'orc', name: 'Grub the Jailer' },
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
  ],
  rivalEntrances: [at(1, 18, 7)],
};
