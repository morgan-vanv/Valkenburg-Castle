// Builds a LevelDef from region shapes the way mockup/sketch.py draws a level:
// every hex belongs to the first region containing it; pit hexes stay pit
// unless a region is allowed over the pit (bridges); walls ring every
// non-pit hex. Then hand edits (doors, props, stairs...) go on top.
// Everything here works in "odd-r" offset (col, row); the LevelDef comes out
// in axial keys through offsetToAxial.

import { axialToOffset, hexKey, offsetToAxial, type Hex, type Pos } from '../../game/hex';
import type { LevelDef, LightDef, Material, PropKind, RoomDef, TileDef } from '../../game/types';
import type { Shape } from './shapes';

/** Sketch grid bounds (sketch.py COLS, ROWS). */
export const COLS = 46;
export const ROWS = 32;

/** Position from offset (col, row) on a level. */
export function at(level: number, col: number, row: number): Pos {
  return { level, ...offsetToAxial(col, row) };
}

export interface RegionSpec {
  /** Sketch region name. */
  name: string;
  /** Room id the region's hexes get. */
  room: string;
  shape: Shape;
  /** May cover pit hexes (bridges). */
  overPit?: boolean;
}

export interface RoomSpec {
  name: string;
  material?: Material;
  tint: string;
  /** Offset (col, row) of the label; default: the hex nearest the room's centroid. */
  label?: [number, number];
}

type Off = [number, number];
const ok = (c: number, r: number) => `${c},${r}`;

/** Offset neighbours of (c, r) on the odd-r grid (same set as hex.ts DIRS). */
export function offNeighbors(c: number, r: number): Off[] {
  const ax = offsetToAxial(c, r);
  return [
    [1, 0],
    [1, -1],
    [0, -1],
    [-1, 0],
    [-1, 1],
    [0, 1],
  ].map(([dq, dr]) => {
    const o = axialToOffset({ q: ax.q + dq!, r: ax.r + dr! });
    return [o.col, o.row] as Off;
  });
}

const SOLID = new Set(['wall', 'cracked', 'pillar', 'brazier', 'prop', 'tallprop', 'sealed', 'pit']);
export const isWalkableKind = (k: string | undefined) => !!k && !SOLID.has(k);

export class LevelBuilder {
  /** Tiles by offset key "c,r" (walls added in finish). */
  readonly tiles = new Map<string, TileDef>();
  private readonly regionOf = new Map<string, string>();

  constructor(
    readonly level: number,
    readonly name: string,
    readonly rooms: Record<string, RoomSpec>,
    regions: RegionSpec[],
    pit?: Shape,
  ) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const isPit = !!pit && pit(c, r);
        if (isPit) this.tiles.set(ok(c, r), { kind: 'pit' });
        for (const g of regions) {
          if (isPit && !g.overPit) continue;
          if (g.shape(c, r)) {
            if (!rooms[g.room]) throw new Error(`L${level}: region ${g.name} has unknown room ${g.room}`);
            this.tiles.set(ok(c, r), { kind: 'floor', room: g.room });
            this.regionOf.set(ok(c, r), g.name);
            break;
          }
        }
      }
    }
  }

  /** Sketch region name of a hex (as built from the shapes). */
  regionAt(c: number, r: number): string | undefined {
    return this.regionOf.get(ok(c, r));
  }

  get(c: number, r: number): TileDef | undefined {
    return this.tiles.get(ok(c, r));
  }

  /** Room of the nearest floor-ish neighbour (for hexes added by hand). */
  private nearRoom(c: number, r: number): string | undefined {
    const own = this.get(c, r)?.room;
    if (own) return own;
    for (const [nc, nr] of offNeighbors(c, r)) {
      const t = this.get(nc, nr);
      if (t?.room && t.kind !== 'pit') return t.room;
    }
    return undefined;
  }

  /** Replace a hex's tile, keeping its room (or borrowing a neighbour's) unless given. */
  set(c: number, r: number, tile: TileDef): this {
    const room = tile.room ?? this.nearRoom(c, r);
    const t: TileDef = { ...tile };
    if (room && t.kind !== 'pit' && t.kind !== 'wall') t.room = room;
    else delete t.room;
    this.tiles.set(ok(c, r), t);
    return this;
  }

  /** Make a floor hex (optionally in a given room). */
  floor(c: number, r: number, room?: string): this {
    return this.set(c, r, { kind: 'floor', ...(room ? { room } : {}) });
  }

  /** Remove a hex: solid rock (or a wall if it ends up next to floor). */
  clear(c: number, r: number): this {
    this.tiles.delete(ok(c, r));
    return this;
  }

  prop(c: number, r: number, prop: PropKind, tall = false): this {
    const t = this.get(c, r);
    if (!t || t.kind !== 'floor') throw new Error(`L${this.level}: prop ${prop} at ${c},${r} not on floor (${t?.kind})`);
    return this.set(c, r, { kind: tall ? 'tallprop' : 'prop', prop });
  }

  /** Several props of one kind. */
  props(prop: PropKind, cells: Off[], tall = false): this {
    for (const [c, r] of cells) this.prop(c, r, prop, tall);
    return this;
  }

  railing(cells: Off[]): this {
    for (const [c, r] of cells) {
      const t = this.get(c, r);
      if (!t || t.kind !== 'floor') throw new Error(`L${this.level}: railing at ${c},${r} not on floor`);
      t.railing = true;
    }
    return this;
  }

  /** Offset cells of a room (current state). */
  cellsOf(room: string): Off[] {
    const out: Off[] = [];
    for (const [k, t] of this.tiles) if (t.room === room) out.push(k.split(',').map(Number) as Off);
    return out;
  }

  /** First wall-to-be neighbour of (c, r): a hex with no tile next to it (for sconces). */
  wallBeside(c: number, r: number): Off {
    for (const n of offNeighbors(c, r)) if (!this.tiles.has(ok(n[0], n[1]))) return n;
    throw new Error(`L${this.level}: no wall beside ${c},${r}`);
  }

  /** Fixed lights placed while building (offset coords resolved to Pos). */
  readonly lights: LightDef[] = [];

  /** V3.7 (spec 20.3): rooms whose every wall is `unbreakable` (stair shafts, the lift). */
  private readonly unbreakableRooms = new Set<string>();
  /** Hand-picked unbreakable wall cells (offset). */
  private readonly unbreakableCells: Off[] = [];

  /** No charge breaks the walls around these rooms (set in finish, once the walls exist). */
  unbreakableAround(...rooms: string[]): this {
    for (const r of rooms) {
      if (!this.rooms[r]) throw new Error(`L${this.level}: unbreakableAround: unknown room ${r}`);
      this.unbreakableRooms.add(r);
    }
    return this;
  }

  /** No charge breaks these wall cells. */
  unbreakable(cells: Off[]): this {
    this.unbreakableCells.push(...cells);
    return this;
  }

  /** V3.7 (spec 20.3a): no blast collapses or rubbles the hexes around (c, r) (the landing of a stair or lift) or the hex itself. */
  protectAround(c: number, r: number): this {
    for (const [nc, nr] of [[c, r] as Off, ...offNeighbors(c, r)]) {
      const t = this.get(nc, nr);
      if (t && t.kind !== 'pit') t.unbreakable = true;
    }
    return this;
  }

  /** A sconce on the wall next to floor hex (c, r). */
  sconce(c: number, r: number): this {
    const t = this.get(c, r);
    if (!t || t.kind === 'pit' || !t.room) throw new Error(`L${this.level}: sconce beside ${c},${r} not next to floor`);
    const [wc, wr] = this.wallBeside(c, r);
    this.lights.push({ at: at(this.level, wc, wr), radius: 2, kind: 'sconce' });
    return this;
  }

  light(kind: LightDef['kind'], cells: Off[], radius?: number): this {
    const R: Record<LightDef['kind'], number> = { sconce: 2, daylight: 3, fire: 3, fungus: 2, glow: 2 };
    for (const [c, r] of cells) this.lights.push({ at: at(this.level, c, r), radius: radius ?? R[kind], kind });
    return this;
  }

  finish(): LevelDef {
    // Walls: every empty hex next to a non-pit tile.
    const walls: Off[] = [];
    for (const [k, t] of this.tiles) {
      if (t.kind === 'pit' || t.kind === 'wall') continue;
      const [c, r] = k.split(',').map(Number) as Off;
      for (const [nc, nr] of offNeighbors(c, r)) if (!this.tiles.has(ok(nc, nr))) walls.push([nc, nr]);
    }
    for (const [c, r] of walls) this.tiles.set(ok(c, r), { kind: 'wall' });
    // V3.7 (spec 20.3): the outer curtain (a wall with nothing behind it that faces a single
    // room) and the walls of the shaft rooms can't be blown; walls between two rooms can.
    for (const [k, t] of this.tiles) {
      if (t.kind !== 'wall') continue;
      const [c, r] = k.split(',').map(Number) as Off;
      let shaft = false;
      let voidSide = false;
      const rooms = new Set<string>();
      for (const [nc, nr] of offNeighbors(c, r)) {
        const n = this.tiles.get(ok(nc, nr));
        if (!n) voidSide = true;
        else if (n.room && n.kind !== 'pit') {
          rooms.add(n.room);
          if (this.unbreakableRooms.has(n.room)) shaft = true;
        }
      }
      if (shaft || (voidSide && rooms.size <= 1)) t.unbreakable = true;
    }
    for (const [c, r] of this.unbreakableCells) {
      const t = this.tiles.get(ok(c, r));
      if (!t || t.kind !== 'wall') throw new Error(`L${this.level}: unbreakable at ${c},${r} is not a wall (${t?.kind})`);
      t.unbreakable = true;
    }

    const tiles: Record<string, TileDef> = {};
    for (const [k, t] of this.tiles) {
      const [c, r] = k.split(',').map(Number) as Off;
      tiles[hexKey(offsetToAxial(c, r))] = t;
    }
    const rooms: RoomDef[] = [];
    for (const [id, spec] of Object.entries(this.rooms)) {
      const cells = this.cellsOf(id);
      if (!cells.length) throw new Error(`L${this.level}: room ${id} has no hexes`);
      let label: Hex;
      if (spec.label) label = offsetToAxial(spec.label[0], spec.label[1]);
      else {
        // Nearest room hex to the centroid, in sketch pixel space.
        const px = ([c, r]: Off) => [Math.sqrt(3) * (c + 0.5 * (r & 1)), 1.5 * r] as const;
        let sx = 0;
        let sy = 0;
        for (const o of cells) {
          const [x, y] = px(o);
          sx += x;
          sy += y;
        }
        sx /= cells.length;
        sy /= cells.length;
        let best = cells[0]!;
        let bd = Infinity;
        for (const o of cells) {
          const [x, y] = px(o);
          const d = (x - sx) ** 2 + (y - sy) ** 2;
          if (d < bd) [bd, best] = [d, o];
        }
        label = offsetToAxial(best[0], best[1]);
      }
      rooms.push({ id, name: spec.name, labelAt: label, material: spec.material ?? 'flagstone', tint: spec.tint });
    }
    return { level: this.level, name: this.name, tiles, rooms };
  }
}
