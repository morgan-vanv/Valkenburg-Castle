// Coordinates, keys and edge lookups. Pure functions over CastleMap.

import { COLUMN_LETTERS, type CastleMap, type CellKind, type Coord, type EdgeKind, type LevelId, type LevelMap } from './types';

export type Dir = 'n' | 's' | 'e' | 'w';
export const DIRS: Dir[] = ['n', 'e', 's', 'w'];
const DELTA: Record<Dir, [number, number]> = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };

export function squareKey(c: Coord): string {
  return `${c.level}:${c.x},${c.y}`;
}

export function parseSquareKey(k: string): Coord {
  const [lvl, rest] = k.split(':');
  const [x, y] = rest!.split(',').map(Number);
  return { level: Number(lvl) as LevelId, x: x!, y: y! };
}

export function sameSquare(a: Coord, b: Coord): boolean {
  return a.level === b.level && a.x === b.x && a.y === b.y;
}

/** "C-12" style label, as on the 1980 map. */
export function label(c: Coord): string {
  return `${COLUMN_LETTERS[c.x] ?? '?'}-${c.y + 1}`;
}

/** Parse "C-12" (and a level) into a Coord. */
export function at(level: LevelId, lbl: string): Coord {
  const m = /^([A-U])-?(\d{1,2})$/.exec(lbl.trim().toUpperCase());
  if (!m) throw new Error(`Bad square label "${lbl}"`);
  return { level, x: COLUMN_LETTERS.indexOf(m[1]!), y: Number(m[2]) - 1 };
}

export function step(c: Coord, d: Dir): Coord {
  const [dx, dy] = DELTA[d];
  return { level: c.level, x: c.x + dx, y: c.y + dy };
}

export function dirBetween(a: Coord, b: Coord): Dir | undefined {
  if (a.level !== b.level) return undefined;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === -1) return 'n';
  if (dx === 0 && dy === 1) return 's';
  if (dx === 1 && dy === 0) return 'e';
  if (dx === -1 && dy === 0) return 'w';
  return undefined;
}

export function manhattan(a: Coord, b: Coord): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function levelOf(map: CastleMap, id: LevelId): LevelMap | undefined {
  return map.levels.find((l) => l.id === id);
}

export function inBounds(lv: LevelMap, x: number, y: number): boolean {
  return x >= lv.x0 && x < lv.x0 + lv.width && y >= 0 && y < lv.height;
}

export function cellAt(map: CastleMap, c: Coord): CellKind {
  const lv = levelOf(map, c.level);
  if (!lv || !inBounds(lv, c.x, c.y)) return 'rock';
  return lv.cells[c.y * lv.width + (c.x - lv.x0)]!;
}

/**
 * Key for the edge on side `d` of square `c`. Both squares sharing an edge
 * produce the same key.
 *  h: edge above (x, y)  -> "L:h:x,y"
 *  v: edge left of (x, y) -> "L:v:x,y"
 */
export function edgeKey(c: Coord, d: Dir): string {
  switch (d) {
    case 'n':
      return `${c.level}:h:${c.x},${c.y}`;
    case 's':
      return `${c.level}:h:${c.x},${c.y + 1}`;
    case 'w':
      return `${c.level}:v:${c.x},${c.y}`;
    case 'e':
      return `${c.level}:v:${c.x + 1},${c.y}`;
  }
}

export function edgeBetween(a: Coord, b: Coord): string | undefined {
  const d = dirBetween(a, b);
  return d ? edgeKey(a, d) : undefined;
}

/** The two squares an edge key separates (either may be out of bounds). */
export function edgeSquares(key: string): [Coord, Coord] {
  const [lvl, kind, xy] = key.split(':');
  const [x, y] = xy!.split(',').map(Number);
  const level = Number(lvl) as LevelId;
  if (kind === 'h') return [{ level, x: x!, y: y! - 1 }, { level, x: x!, y: y! }];
  return [{ level, x: x! - 1, y: y! }, { level, x: x!, y: y! }];
}

/** The map's static edge kind on side `d` of `c`. Out of bounds is wall. */
export function edgeKindAt(map: CastleMap, c: Coord, d: Dir): EdgeKind {
  const lv = levelOf(map, c.level);
  if (!lv) return 'wall';
  if (d === 'n' || d === 's') {
    const y = d === 'n' ? c.y : c.y + 1;
    if (c.x < lv.x0 || c.x >= lv.x0 + lv.width || y < 0 || y > lv.height) return 'wall';
    return lv.hEdges[y * lv.width + (c.x - lv.x0)]!;
  }
  const x = d === 'w' ? c.x : c.x + 1;
  if (c.y < 0 || c.y >= lv.height || x < lv.x0 || x > lv.x0 + lv.width) return 'wall';
  return lv.vEdges[c.y * (lv.width + 1) + (x - lv.x0)]!;
}

/** Orthogonal neighbours on the same level, with the static edge between. */
export function neighbours(map: CastleMap, c: Coord): { to: Coord; dir: Dir; edge: EdgeKind; key: string }[] {
  const out: { to: Coord; dir: Dir; edge: EdgeKind; key: string }[] = [];
  for (const d of DIRS) {
    const to = step(c, d);
    if (cellAt(map, to) === 'rock') continue;
    out.push({ to, dir: d, edge: edgeKindAt(map, c, d), key: edgeKey(c, d) });
  }
  return out;
}
