// A tiny two-level castle for engine tests, built in code.

import type { CastleMap, CellKind, Coord, EdgeKind, LevelId, LevelMap } from '../types';

class Builder {
  cells: CellKind[];
  hEdges: EdgeKind[];
  vEdges: EdgeKind[];
  constructor(
    readonly id: LevelId,
    readonly width: number,
    readonly height: number,
  ) {
    this.cells = Array(width * height).fill('rock');
    this.hEdges = Array((height + 1) * width).fill('wall');
    this.vEdges = Array(height * (width + 1)).fill('wall');
  }
  /** Floor a rectangle and open the edges inside it. */
  room(x0: number, y0: number, x1: number, y1: number): this {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        this.cells[y * this.width + x] = 'floor';
        if (x > x0) this.vEdges[y * (this.width + 1) + x] = 'open';
        if (y > y0) this.hEdges[y * this.width + x] = 'open';
      }
    return this;
  }
  /** A door on the east side of (x, y). */
  doorE(x: number, y: number, kind: EdgeKind = 'door'): this {
    this.vEdges[y * (this.width + 1) + x + 1] = kind;
    return this;
  }
  /** A door on the south side of (x, y). */
  doorS(x: number, y: number, kind: EdgeKind = 'door'): this {
    this.hEdges[(y + 1) * this.width + x] = kind;
    return this;
  }
  build(extra: Partial<LevelMap>): LevelMap {
    return {
      id: this.id,
      name: `Level ${this.id}`,
      x0: 0,
      width: this.width,
      height: this.height,
      cells: this.cells,
      hEdges: this.hEdges,
      vEdges: this.vEdges,
      entrances: [],
      guardrooms: [],
      prisonCells: [],
      balcony: [],
      reinforcementPoints: [],
      hoard: [],
      ...extra,
    };
  }
}

const c = (level: LevelId, x: number, y: number): Coord => ({ level, x, y });

/*
 Level 1 (A-H, rows 1-6)
   A: corridor A-1..A-6, entrance A-1, stairs A-6 to level 2
   R1 (B-1..E-3) door A-2|B-2
   guardroom (B-5..D-6), locked door A-5|B-5
   R3 (F-1..H-4), locked door E-2|F-2
 Level 2 (A-D, rows 1-6)
   corridor A-1..A-6, stairs A-6, reinforcement point A-1
   prison cell B-3, locked door A-3|B-3
   R4 (B-5..D-6), door A-5|B-5
*/
export function miniCastle(): CastleMap {
  const l1 = new Builder(1, 8, 6)
    .room(0, 0, 0, 5)
    .room(1, 0, 4, 2)
    .doorE(0, 1)
    .room(1, 4, 3, 5)
    .doorE(0, 4, 'locked')
    .room(5, 0, 7, 3)
    .doorE(4, 1, 'locked')
    .build({ entrances: [c(1, 0, 0)], guardrooms: [c(1, 1, 4)] });
  const l2 = new Builder(2, 4, 6)
    .room(0, 0, 0, 5)
    .room(1, 2, 1, 2)
    .doorE(0, 2, 'locked')
    .room(1, 4, 3, 5)
    .doorE(0, 4)
    .build({ prisonCells: [c(2, 1, 2)], reinforcementPoints: [c(2, 0, 0)] });
  return { name: 'Mini castle', levels: [l1, l2], links: [{ kind: 'stairs', a: c(1, 0, 5), b: c(2, 0, 5) }] };
}
