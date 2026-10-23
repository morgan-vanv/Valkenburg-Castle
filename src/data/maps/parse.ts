// Parser for the ASCII level format described in ./README.md.
// Pure data code: no DOM, no randomness.

import { at } from '../../engine/geometry';
import { COLUMN_LETTERS, type CellKind, type Coord, type EdgeKind, type LevelId, type LevelMap } from '../../engine/types';

/** A level as written in the data files. Square labels use 1980 letters, e.g. "H-1". */
export interface LevelSpec {
  id: LevelId;
  name: string;
  /** Global column index of the first column (A = 0, F = 5). */
  x0: number;
  width: number;
  height: number;
  /** (2 * height + 1) lines of (2 * width + 1) characters. A single string is split on newlines. */
  grid: string | readonly string[];
  entrances?: readonly string[];
  guardrooms?: readonly string[];
  prisonCells?: readonly string[];
  balcony?: readonly string[];
  reinforcementPoints?: readonly string[];
  lair?: string;
  hoard?: readonly string[];
}

const EDGE_CHARS: Record<string, EdgeKind> = { ' ': 'open', d: 'door', L: 'locked' };

/** Cell characters. Feature markers all mean floor. */
const CELL_CHARS: Record<string, CellKind> = {
  '.': 'floor',
  '#': 'rock',
  p: 'pit',
  G: 'floor',
  S: 'floor',
  X: 'floor',
  E: 'floor',
  C: 'floor',
  B: 'floor',
  D: 'floor',
  H: 'floor',
};

/** Marker character -> the feature list it must agree with. */
const MARKER_LISTS = {
  E: 'entrances',
  G: 'guardrooms',
  C: 'prisonCells',
  B: 'balcony',
  D: 'lair',
  H: 'hoard',
} as const;

export class MapParseError extends Error {
  constructor(level: string, message: string, line?: number, column?: number) {
    const where = line === undefined ? '' : ` at line ${line + 1}${column === undefined ? '' : `, column ${column + 1}`}`;
    super(`Level "${level}"${where}: ${message}`);
    this.name = 'MapParseError';
  }
}

function toLines(grid: string | readonly string[]): string[] {
  if (typeof grid !== 'string') return [...grid];
  const lines = grid.split('\n');
  // Allow a leading and a trailing newline in template literals.
  if (lines.length > 0 && lines[0]!.trim() === '') lines.shift();
  if (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
  return lines;
}

export function parseLevel(spec: LevelSpec): LevelMap {
  const { id, name, x0, width, height } = spec;
  const fail = (msg: string, line?: number, col?: number): never => {
    throw new MapParseError(name, msg, line, col);
  };
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) fail(`bad size ${width}x${height}`);
  if (!Number.isInteger(x0) || x0 < 0 || x0 + width > COLUMN_LETTERS.length) fail(`columns ${x0}..${x0 + width - 1} fall outside A-U`);

  const lines = toLines(spec.grid);
  const lineLen = 2 * width + 1;
  if (lines.length !== 2 * height + 1) fail(`expected ${2 * height + 1} lines, found ${lines.length}`);
  lines.forEach((ln, i) => {
    if (ln.length !== lineLen) fail(`expected ${lineLen} characters, found ${ln.length}`, i);
  });

  const lbl = (x: number, y: number) => `${COLUMN_LETTERS[x0 + x]}-${y + 1}`;
  const cells: CellKind[] = new Array(width * height);
  const markerSquares: { ch: string; x: number; y: number }[] = [];
  const hEdges: EdgeKind[] = new Array((height + 1) * width);
  const vEdges: EdgeKind[] = new Array(height * (width + 1));

  for (let y = 0; y < height; y++) {
    const li = 2 * y + 1;
    const ln = lines[li]!;
    for (let x = 0; x < width; x++) {
      const ch = ln[2 * x + 1]!;
      const kind = CELL_CHARS[ch];
      if (!kind) fail(`unknown cell character "${ch}" for square ${lbl(x, y)}`, li, 2 * x + 1);
      cells[y * width + x] = kind!;
      if (ch !== '.' && ch !== '#' && ch !== 'p') markerSquares.push({ ch, x, y });
    }
    for (let x = 0; x <= width; x++) {
      const ch = ln[2 * x]!;
      const kind = ch === '|' ? 'wall' : EDGE_CHARS[ch];
      if (!kind) fail(`unknown vertical edge character "${ch}"`, li, 2 * x);
      vEdges[y * (width + 1) + x] = kind!;
    }
  }
  for (let y = 0; y <= height; y++) {
    const li = 2 * y;
    const ln = lines[li]!;
    for (let x = 0; x < width; x++) {
      const ch = ln[2 * x + 1]!;
      const kind = ch === '-' ? 'wall' : EDGE_CHARS[ch];
      if (!kind) fail(`unknown horizontal edge character "${ch}"`, li, 2 * x + 1);
      hEdges[y * width + x] = kind!;
    }
  }

  // Outer border must be walls.
  for (let x = 0; x < width; x++) {
    if (hEdges[x] !== 'wall') fail(`outer border above ${lbl(x, 0)} must be a wall`, 0, 2 * x + 1);
    if (hEdges[height * width + x] !== 'wall') fail(`outer border below ${lbl(x, height - 1)} must be a wall`, 2 * height, 2 * x + 1);
  }
  for (let y = 0; y < height; y++) {
    if (vEdges[y * (width + 1)] !== 'wall') fail(`outer border left of ${lbl(0, y)} must be a wall`, 2 * y + 1, 0);
    if (vEdges[y * (width + 1) + width] !== 'wall') fail(`outer border right of ${lbl(width - 1, y)} must be a wall`, 2 * y + 1, 2 * width);
  }

  // Every edge touching rock must be a wall.
  const cell = (x: number, y: number) => cells[y * width + x]!;
  for (let y = 0; y <= height; y++) {
    for (let x = 0; x < width; x++) {
      const touches = (y > 0 && cell(x, y - 1) === 'rock') || (y < height && cell(x, y) === 'rock');
      if (touches && hEdges[y * width + x] !== 'wall') fail(`edge above ${lbl(x, y)} touches rock and must be a wall`, 2 * y, 2 * x + 1);
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x <= width; x++) {
      const touches = (x > 0 && cell(x - 1, y) === 'rock') || (x < width && cell(x, y) === 'rock');
      if (touches && vEdges[y * (width + 1) + x] !== 'wall') fail(`edge left of ${lbl(x, y)} touches rock and must be a wall`, 2 * y + 1, 2 * x);
    }
  }

  // Feature lists -> coords, each must be a floor square inside the level.
  const toCoords = (key: string, labels: readonly string[] | undefined): Coord[] =>
    (labels ?? []).map((s) => {
      let c: Coord;
      try {
        c = at(id, s);
      } catch {
        return fail(`${key}: bad square label "${s}"`);
      }
      const lx = c.x - x0;
      if (lx < 0 || lx >= width || c.y < 0 || c.y >= height) fail(`${key}: square ${s} is outside the level`);
      if (cell(lx, c.y) !== 'floor') fail(`${key}: square ${s} is not floor`);
      return c;
    });
  const lists = {
    entrances: toCoords('entrances', spec.entrances),
    guardrooms: toCoords('guardrooms', spec.guardrooms),
    prisonCells: toCoords('prisonCells', spec.prisonCells),
    balcony: toCoords('balcony', spec.balcony),
    reinforcementPoints: toCoords('reinforcementPoints', spec.reinforcementPoints),
    lair: toCoords('lair', spec.lair === undefined ? undefined : [spec.lair]),
    hoard: toCoords('hoard', spec.hoard),
  };

  // Markers and lists must agree both ways.
  const key = (x: number, y: number) => `${x},${y}`;
  for (const [ch, listName] of Object.entries(MARKER_LISTS)) {
    const listed = new Set(lists[listName].map((c) => key(c.x - x0, c.y)));
    const marked = markerSquares.filter((m) => m.ch === ch);
    for (const m of marked) {
      if (!listed.has(key(m.x, m.y))) fail(`marker "${ch}" on ${lbl(m.x, m.y)} is missing from ${listName}`, 2 * m.y + 1, 2 * m.x + 1);
    }
    const markedSet = new Set(marked.map((m) => key(m.x, m.y)));
    for (const c of lists[listName]) {
      const lx = c.x - x0;
      if (!markedSet.has(key(lx, c.y))) fail(`${listName} lists ${lbl(lx, c.y)} but the grid has "${lines[2 * c.y + 1]![2 * lx + 1]}" there, not "${ch}"`, 2 * c.y + 1, 2 * lx + 1);
    }
  }
  for (const c of lists.reinforcementPoints) {
    const lx = c.x - x0;
    if (lines[2 * c.y + 1]![2 * lx + 1] !== 'S') fail(`reinforcement point ${lbl(lx, c.y)} must be marked "S"`, 2 * c.y + 1, 2 * lx + 1);
  }

  return {
    id,
    name,
    x0,
    width,
    height,
    cells,
    hEdges,
    vEdges,
    entrances: lists.entrances,
    guardrooms: lists.guardrooms,
    prisonCells: lists.prisonCells,
    balcony: lists.balcony,
    reinforcementPoints: lists.reinforcementPoints,
    lair: lists.lair[0],
    hoard: lists.hoard,
  };
}

/** The grid character at a square, for checking stairs ('S') and ladder ('X') markers. */
export function markerAt(spec: LevelSpec, lbl: string): string {
  const c = at(spec.id, lbl);
  const lines = toLines(spec.grid);
  return lines[2 * c.y + 1]?.[2 * (c.x - spec.x0) + 1] ?? '';
}

/** Turn a LevelMap back into the ASCII grid (markers are not kept: floor is '.'). */
export function formatLevel(lv: LevelMap): string[] {
  const e = (k: EdgeKind, wall: string) => (k === 'wall' ? wall : k === 'open' ? ' ' : k === 'door' ? 'd' : 'L');
  const out: string[] = [];
  for (let y = 0; y <= lv.height; y++) {
    let s = '+';
    for (let x = 0; x < lv.width; x++) s += e(lv.hEdges[y * lv.width + x]!, '-') + '+';
    out.push(s);
    if (y === lv.height) break;
    s = '';
    for (let x = 0; x <= lv.width; x++) {
      s += e(lv.vEdges[y * (lv.width + 1) + x]!, '|');
      if (x < lv.width) {
        const k = lv.cells[y * lv.width + x]!;
        s += k === 'floor' ? '.' : k === 'rock' ? '#' : 'p';
      }
    }
    out.push(s);
  }
  return out;
}
