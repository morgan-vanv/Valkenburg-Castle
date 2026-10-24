// V2 map format: one character per square, drawn by eye.
//
//   #  solid wall (rock)          .  floor
//   +  door      =  locked door   (a floor square sitting in a wall line; the
//                                  door is on its north or west edge, facing
//                                  the way the wall runs)
//   O  open shaft (no floor on this level)
//   E  entrance    S  stairs      R  reinforcement point (stairs to the depths)
//   D  dragon lair H  hoard       G  guard post (floor)
//   X  cracked wall: a nook in a wall line, open on one side, with a
//      blastable wall on its north or west edge (a shortcut for charges)
//
// Walls between rooms are whole squares of rock, so rooms and halls read as
// big open spaces. Every edge between two floor squares is open unless a
// door square sits on it.

import type { CellKind, Coord, EdgeKind, LevelId, LevelMap } from '../../engine/types';

export interface GridLevel {
  id: LevelId;
  name: string;
  /** Global column index of the first column (0 = A). */
  x0?: number;
  rows: string[];
}

const FLOORISH = new Set(['.', '+', '=', 'E', 'S', 'R', 'D', 'H', 'G', 'X']);

export function parseGrid(spec: GridLevel): LevelMap {
  const x0 = spec.x0 ?? 0;
  const height = spec.rows.length;
  const width = spec.rows[0]?.length ?? 0;
  spec.rows.forEach((r, y) => {
    if (r.length !== width) throw new Error(`${spec.name}: row ${y + 1} is ${r.length} wide, expected ${width}`);
  });
  const ch = (x: number, y: number): string => (y >= 0 && y < height && x >= 0 && x < width ? spec.rows[y]![x]! : '#');
  const floor = (x: number, y: number) => FLOORISH.has(ch(x, y));
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const c = ch(x, y);
      if (!FLOORISH.has(c) && c !== '#' && c !== 'O') throw new Error(`${spec.name}: unknown character "${c}" at row ${y + 1}, column ${x + 1}`);
      if ((x === 0 || y === 0 || x === width - 1 || y === height - 1) && c !== '#') {
        throw new Error(`${spec.name}: the border must be solid wall (row ${y + 1}, column ${x + 1})`);
      }
    }

  const cells: CellKind[] = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const c = ch(x, y);
      cells.push(c === '#' ? 'rock' : c === 'O' ? 'pit' : 'floor');
    }
  const open = (a: string, b: string): EdgeKind => {
    const solid = (c: string) => c === '#';
    return solid(a) || solid(b) ? 'wall' : 'open';
  };
  const hEdges: EdgeKind[] = [];
  for (let y = 0; y <= height; y++) for (let x = 0; x < width; x++) hEdges.push(open(ch(x, y - 1), ch(x, y)));
  const vEdges: EdgeKind[] = [];
  for (let y = 0; y < height; y++) for (let x = 0; x <= width; x++) vEdges.push(open(ch(x - 1, y), ch(x, y)));

  // Doors: on the north edge if the wall runs east-west (floor above and below),
  // else on the west edge (floor left and right).
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const c = ch(x, y);
      if (c !== '+' && c !== '=' && c !== 'X') continue;
      const kind: EdgeKind = c === '=' ? 'locked' : c === 'X' ? 'wall' : 'door';
      if (floor(x, y - 1) && floor(x, y + 1)) hEdges[y * width + x] = kind;
      else if (floor(x - 1, y) && floor(x + 1, y)) vEdges[y * (width + 1) + x] = kind;
      else throw new Error(`${spec.name}: door at row ${y + 1}, column ${x + 1} needs floor on two opposite sides`);
    }

  const find = (chars: string): Coord[] => {
    const out: Coord[] = [];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (chars.includes(ch(x, y))) out.push({ level: spec.id, x: x + x0, y });
    return out;
  };
  const balcony: Coord[] = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (!floor(x, y)) continue;
      if ([ch(x + 1, y), ch(x - 1, y), ch(x, y + 1), ch(x, y - 1)].includes('O')) balcony.push({ level: spec.id, x: x + x0, y });
    }

  return {
    id: spec.id,
    name: spec.name,
    x0,
    width,
    height,
    cells,
    hEdges,
    vEdges,
    entrances: find('E'),
    guardrooms: find('G'),
    prisonCells: [],
    balcony,
    reinforcementPoints: find('R'),
    lair: find('D')[0],
    hoard: find('H'),
  };
}
