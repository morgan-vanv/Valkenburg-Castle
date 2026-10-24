// Castle level format for V3.
//
// Each level is two grids of ASCII rows in "odd-r" offset layout (row r,
// column c; odd rows are shifted half a hex right). Both grids have the same
// size; column numbers are written above each grid as comments.
//
// Tile grid, one character per hex:
//   .  floor              ^  raised floor (balcony, dais)
//   %  rubble (costs 2)   o  pillar
//   #  wall               x  cracked wall (a blasting charge opens it)
//   +  door               L  locked door
//   O  pit                S  stairs
//   E  exit               B  brazier
//   (space) or ~  void: solid rock, not listed in tiles
//
// Room grid: one letter per hex naming the room that hex belongs to. Every
// floor-like hex (floor, raised floor, rubble, stairs, exit) must carry a
// letter; other hexes must be blank. The letters map to RoomDefs in the
// level file. Halls can be rooms too.
//
// Everything else (spawns, chests, sites...) lives in TypeScript next to the
// rows and refers to hexes by offset (col, row) through `at`.

import { hexKey, offsetToAxial, posNeighbors, type Pos } from '../../game/hex';
import type { LevelDef, RoomDef, TileDef, TileKind } from '../../game/types';

export const LEGEND: Record<string, TileDef | null> = {
  '.': { kind: 'floor' },
  '^': { kind: 'floor', raised: true },
  '%': { kind: 'rubble' },
  o: { kind: 'pillar' },
  '#': { kind: 'wall' },
  x: { kind: 'cracked' },
  '+': { kind: 'door' },
  L: { kind: 'door', locked: true },
  O: { kind: 'pit' },
  S: { kind: 'stairs' },
  E: { kind: 'exit' },
  B: { kind: 'brazier' },
  ' ': null,
  '~': null,
};

/** Tile kinds that belong to a room. */
export const ROOMY: readonly TileKind[] = ['floor', 'rubble', 'stairs', 'exit'];

/** Position from offset (col, row) on a level. */
export function at(level: number, col: number, row: number): Pos {
  return { level, ...offsetToAxial(col, row) };
}

export interface RoomSpec {
  id: string;
  name: string;
  /** Offset (col, row) of the label. */
  label: [number, number];
}

/** Build a LevelDef from a tile grid, a room grid and the room letters. */
export function parseLevel(
  level: number,
  name: string,
  tileRows: string[],
  roomRows: string[],
  rooms: Record<string, RoomSpec>,
): LevelDef {
  if (tileRows.length !== roomRows.length) {
    throw new Error(`castle L${level}: ${tileRows.length} tile rows but ${roomRows.length} room rows`);
  }
  const tiles: Record<string, TileDef> = {};
  tileRows.forEach((line, row) => {
    const roomLine = roomRows[row] ?? '';
    [...line].forEach((ch, col) => {
      const def = LEGEND[ch];
      if (def === undefined) throw new Error(`castle L${level}: unknown tile '${ch}' at ${col},${row}`);
      const letter = roomLine[col] ?? ' ';
      if (!def) {
        if (letter !== ' ') throw new Error(`castle L${level}: room '${letter}' on void at ${col},${row}`);
        return;
      }
      const tile: TileDef = { ...def };
      if (ROOMY.includes(def.kind)) {
        const spec = rooms[letter];
        if (!spec) throw new Error(`castle L${level}: floor without a known room ('${letter}') at ${col},${row}`);
        tile.room = spec.id;
      } else if (letter !== ' ') {
        throw new Error(`castle L${level}: room '${letter}' on ${def.kind} at ${col},${row}`);
      }
      tiles[hexKey(offsetToAxial(col, row))] = tile;
    });
  });
  const roomDefs: RoomDef[] = Object.values(rooms).map((r) => ({
    id: r.id,
    name: r.name,
    labelAt: offsetToAxial(r.label[0], r.label[1]),
  }));
  return { level, name, tiles, rooms: roomDefs };
}

/** Floor hexes (raised included) on a level adjacent to any pit tile. */
export function pitEdge(def: LevelDef): Pos[] {
  const out: Pos[] = [];
  for (const [k, t] of Object.entries(def.tiles)) {
    if (t.kind !== 'floor') continue;
    const [q = 0, r = 0] = k.split(',').map(Number);
    const p = { level: def.level, q, r };
    if (posNeighbors(p).some((n) => def.tiles[hexKey(n)]?.kind === 'pit')) out.push(p);
  }
  return out;
}

/** Pit hexes on a level, as positions on another level (the hexes right under them). */
export function pitFootprint(def: LevelDef, onLevel: number): Pos[] {
  const out: Pos[] = [];
  for (const [k, t] of Object.entries(def.tiles)) {
    if (t.kind !== 'pit') continue;
    const [q = 0, r = 0] = k.split(',').map(Number);
    out.push({ level: onLevel, q, r });
  }
  return out;
}
