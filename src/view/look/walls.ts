// V5.0 (G): flat brick walls on hex walls (docs/v5-graphics-plan.md, "Flat walls on hex walls").
//
// In the rules a wall is a whole hex. Here the wall hexes that face a room (any open neighbour in one of
// the `rooms`) are grouped into straight runs along five families of line: the three hex axes and the two
// vertical zigzags (offset columns, "odd-r" and "even-r"). Each run is drawn as one straight slab through
// its hex centres: a dark mortar core with running-bond bricks on both long faces. The slab is kept thin
// enough never to cover a walkable hex (face at 0.45 from an axis centreline, 0.433 from a vertical one),
// so the parts of each wall hex outside the slab, the notches, are filled with a low stone plinth of the
// whole hex. Pillars stand at run ends and corners; a lone wall hex is a pillar on its plinth. Wall hexes
// away from any floor keep the old solid blocks (level.ts), so the castle keeps its mass.
//
// Everything here is data for LevelView.batchItems (instanced, fogged by the wall hex and its neighbours).

import * as THREE from 'three';
import { DIRS, add, hexKey, hexToWorld, type Hex } from '../../game/hex';
import type { TileDef } from '../../game/types';
import { HEX, WALL_HEIGHT, hash2 } from '../world';

/** Rooms whose walls get the brick look. W0: the Great Hall and its dais; W2: empty, so every room. */
export const LOOK_WALL_ROOMS: ReadonlySet<string> = new Set();

/** W2: lower the brick walls between the camera and the focus to their plinth (the camera sits lower than V4). */
export const LOOK_CUTAWAY = true;

export const WALL_LOOK = {
  brickL: 0.82,
  brickH: 0.34,
  brickD: 0.24,
  /** Slab half-thickness per family: the hex axes, and the vertical zigzags. */
  halfAxis: 0.45,
  halfVertical: 0.433,
  plinthH: 0.55,
  plinthR: 0.96,
  pillarR: 0.4,
  bricks: [0x7a6e74, 0x6e636c, 0x857a86, 0x6a5f66],
  mortar: 0x2a2128,
  plinth: 0x5a5056,
  pillar: 0x8a7e86,
  cap: 0x9a8e96,
  rock: 0x4e4850,
};

export interface WallItem {
  h: Hex;
  rot: number;
  dx: number;
  dz: number;
  dy?: number;
  sx?: number;
  sy?: number;
  sz?: number;
  color: THREE.Color;
}

export interface LookWalls {
  /** hexKeys drawn here (level.ts leaves these out of the old wall batches). */
  hexes: Set<string>;
  bricks: WallItem[];
  cores: WallItem[];
  plinths: WallItem[];
  pillars: WallItem[];
  caps: WallItem[];
  /** Cave walls (every open neighbour in a rock, earth or bone room): jittered dark rock blocks, not brick. */
  rocks: WallItem[];
  /** Where a sconce on this wall hex should hang: offset from the hex centre to the brick face toward the given direction index. */
  sconceAt(h: Hex, dir: number): { x: number; z: number } | null;
  /**
   * The brick face of this wall hex on the side of direction `dir`: the outward unit normal `n`, how far the
   * face is from the hex centre along it (`face`), and how deep the notch is between the face and the hex's
   * own edge (`notch`, 0 where the face is flush with the hex). Null for a hex not drawn as a run.
   */
  frame(h: Hex, dir: number): { n: THREE.Vector2; face: number; notch: number } | null;
}

export interface WallContext {
  level: number;
  tile(h: Hex): TileDef | undefined;
  /** Does a wall hex face a room across this tile? (level.ts wallOpen) */
  open(t: TileDef | undefined): boolean;
  /** Room ids whose walls get the look (W0: the Great Hall). Empty = every room. */
  rooms: ReadonlySet<string>;
  /** Is this a floor-like tile of a cave room (rock, earth, bone)? Walls facing only caves are rock mass. */
  cave(t: TileDef | undefined): boolean;
}

type Family = { kind: 'axis'; i: number } | { kind: 'v'; parity: 0 | 1 };
const FAMILIES: Family[] = [
  { kind: 'axis', i: 0 },
  { kind: 'axis', i: 1 },
  { kind: 'axis', i: 2 },
  { kind: 'v', parity: 0 },
  { kind: 'v', parity: 1 },
];

/** Offset column of a hex for the two vertical families (floor and ceil of r/2). */
function col(h: Hex, parity: 0 | 1): number {
  return parity === 0 ? h.q + Math.floor(h.r / 2) : h.q + Math.ceil(h.r / 2);
}
function step(h: Hex, f: Family, dir: 1 | -1): Hex {
  if (f.kind === 'axis') return add(h, DIRS[dir > 0 ? f.i : f.i + 3]!);
  const r = h.r + dir;
  const c = col(h, f.parity);
  const q = f.parity === 0 ? c - Math.floor(r / 2) : c - Math.ceil(r / 2);
  return { q, r };
}

interface Run {
  f: Family;
  hexes: Hex[];
}

export function buildLookWalls(ctx: WallContext, walls: Hex[]): LookWalls {
  const H = WALL_HEIGHT;
  const roomOf = (t: TileDef | undefined) => t?.room ?? '';
  const faces = (h: Hex) => DIRS.map((d) => ctx.tile(add(h, d))).map((t) => ctx.open(t) && (ctx.rooms.size === 0 || ctx.rooms.has(roomOf(t))));
  const qual = new Map<string, Hex>();
  const rocks: Hex[] = [];
  for (const h of walls) {
    const f = faces(h);
    if (!f.some(Boolean)) continue;
    const opens = DIRS.map((d) => ctx.tile(add(h, d))).filter((_t, i) => f[i]);
    if (opens.every((t) => ctx.cave(t))) rocks.push(h);
    else qual.set(hexKey(h), h);
  }

  // Maximal runs per family, longest first; each hex joins one run.
  const runs: Run[] = [];
  const seen = new Set<string>();
  for (const f of FAMILIES) {
    seen.clear();
    for (const h of qual.values()) {
      if (seen.has(hexKey(h))) continue;
      let start = h;
      while (qual.has(hexKey(step(start, f, -1)))) start = step(start, f, -1);
      const list: Hex[] = [];
      let cur = start;
      while (qual.has(hexKey(cur))) {
        list.push(cur);
        seen.add(hexKey(cur));
        cur = step(cur, f, 1);
      }
      runs.push({ f, hexes: list });
    }
  }
  runs.sort((a, b) => b.hexes.length - a.hexes.length);
  const taken = new Set<string>();
  const chosen: Run[] = [];
  for (const r of runs) {
    let piece: Hex[] = [];
    const flush = () => {
      if (piece.length >= 2) {
        chosen.push({ f: r.f, hexes: piece });
        for (const h of piece) taken.add(hexKey(h));
      }
      piece = [];
    };
    for (const h of r.hexes) {
      if (taken.has(hexKey(h))) flush();
      else piece.push(h);
    }
    flush();
  }
  const lone = [...qual.values()].filter((h) => !taken.has(hexKey(h)));

  const out: LookWalls = { hexes: new Set([...qual.keys(), ...rocks.map(hexKey)]), bricks: [], cores: [], plinths: [], pillars: [], caps: [], rocks: [], sconceAt: () => null, frame: () => null };
  for (const h of rocks) {
    const j = (k: number) => hash2(h.q, h.r, 50 + k);
    out.rocks.push({ h, rot: j(0) * Math.PI * 2, dx: (j(1) - 0.5) * 0.2, dz: (j(2) - 0.5) * 0.2, dy: 0, sx: 0.96 + j(3) * 0.12, sy: 0.9 + j(4) * 0.2, sz: 0.96 + j(5) * 0.12, color: new THREE.Color(WALL_LOOK.rock).multiplyScalar(0.8 + j(6) * 0.4) });
  }
  /** Per run hex: the run's normal, the slab half-thickness, the hex centre's signed offset from the centreline and its extent along the normal. */
  const sconce = new Map<string, { n: THREE.Vector2; f: number; o: number; ext: number }>();
  const w2 = (h: Hex) => {
    const w = hexToWorld(h, HEX);
    return new THREE.Vector2(w.x, w.z);
  };
  const brickCol = (seed: number) => new THREE.Color(WALL_LOOK.bricks[Math.floor(hash2(seed, 7, 1) * WALL_LOOK.bricks.length)]!).multiplyScalar(0.82 + hash2(seed, 9, 2) * 0.3);

  // Pillars, deduped by world position; a run end next to a longer run's end gives way to it.
  const pillarAt = new Map<string, { h: Hex; len: number }>();
  const pillar = (h: Hex, len: number) => {
    const k = hexKey(h);
    const prev = pillarAt.get(k);
    if (!prev || prev.len < len) pillarAt.set(k, { h, len });
  };

  for (const run of chosen) {
    const a = w2(run.hexes[0]!);
    const b = w2(run.hexes[run.hexes.length - 1]!);
    // Centreline: for axis runs through the centres; for vertical runs the mean x, straight down z.
    let dir: THREE.Vector2;
    let c0: THREE.Vector2;
    let c1: THREE.Vector2;
    let half: number;
    if (run.f.kind === 'axis') {
      dir = b.clone().sub(a).normalize();
      c0 = a.clone().addScaledVector(dir, -0.5);
      c1 = b.clone().addScaledVector(dir, 0.5);
      half = WALL_LOOK.halfAxis;
    } else {
      const xm = run.hexes.reduce((s, h) => s + w2(h).x, 0) / run.hexes.length;
      dir = new THREE.Vector2(0, 1);
      c0 = new THREE.Vector2(xm, Math.min(a.y, b.y) - 0.75);
      c1 = new THREE.Vector2(xm, Math.max(a.y, b.y) + 0.75);
      half = WALL_LOOK.halfVertical;
    }
    const len = c0.distanceTo(c1);
    const mid = c0.clone().add(c1).multiplyScalar(0.5);
    const n = new THREE.Vector2(-dir.y, dir.x);
    const rot = Math.atan2(dir.x, dir.y); // angle so that local +z runs along `dir`
    const nearest = (p: THREE.Vector2): Hex => {
      let best = run.hexes[0]!;
      let bd = Infinity;
      for (const h of run.hexes) {
        const d = w2(h).distanceToSquared(p);
        if (d < bd) {
          bd = d;
          best = h;
        }
      }
      return best;
    };
    const place = (h: Hex, p: THREE.Vector2): { dx: number; dz: number } => {
      const w = w2(h);
      return { dx: p.x - w.x, dz: p.y - w.y };
    };
    // Mortar core: the slab, a little thinner than the brick faces.
    {
      const h = nearest(mid);
      out.cores.push({ h, rot, ...place(h, mid), dy: 0, sx: (half - WALL_LOOK.brickD * 0.6) * 2, sy: H, sz: len, color: new THREE.Color(WALL_LOOK.mortar) });
    }
    for (const h of run.hexes) {
      const o = w2(h).sub(mid).dot(n);
      sconce.set(hexKey(h), { n, f: half, o, ext: run.f.kind === 'axis' ? 1.0 : 0.866 });
    }
    // Bricks on both faces, running bond.
    const rows = Math.ceil(H / WALL_LOOK.brickH);
    for (const side of [-1, 1]) {
      for (let row = 0; row < rows; row++) {
        const off = row % 2 ? WALL_LOOK.brickL / 2 : 0;
        const bh = Math.min(WALL_LOOK.brickH, H - row * WALL_LOOK.brickH) - 0.03;
        for (let s = -off; s < len; s += WALL_LOOK.brickL) {
          const s0 = Math.max(0, s);
          const s1 = Math.min(len, s + WALL_LOOK.brickL);
          if (s1 - s0 < 0.14) continue;
          const seed = Math.round(s0 * 10) * 31 + row * 7 + side * 3 + mid.x * 13 + mid.y * 17;
          const j = hash2(seed, row, 3);
          const along = c0.clone().addScaledVector(dir, (s0 + s1) / 2);
          const p = along.addScaledVector(n, side * (half - WALL_LOOK.brickD / 2 + (j - 0.5) * 0.04));
          const h = nearest(p);
          out.bricks.push({ h, rot: rot + (j - 0.5) * 0.03, ...place(h, p), dy: row * WALL_LOOK.brickH + bh / 2 + 0.015, sx: WALL_LOOK.brickD, sy: bh, sz: s1 - s0 - 0.04, color: brickCol(seed) });
        }
      }
    }
    pillar(run.hexes[0]!, run.hexes.length);
    pillar(run.hexes[run.hexes.length - 1]!, run.hexes.length);
  }
  for (const h of lone) pillar(h, 1);
  // Drop a pillar that stands right beside a longer run's pillar (corners meet in one post).
  for (const [k, p] of [...pillarAt]) {
    for (const d of DIRS) {
      const o = pillarAt.get(hexKey(add(p.h, d)));
      if (o && (o.len > p.len || (o.len === p.len && hexKey(o.h) < k))) {
        pillarAt.delete(k);
        break;
      }
    }
  }
  for (const { h } of pillarAt.values()) {
    const seed = h.q * 31 + h.r * 17;
    const col = new THREE.Color(WALL_LOOK.pillar).multiplyScalar(0.92 + hash2(seed, 1, 5) * 0.16);
    out.pillars.push({ h, rot: 0, dx: 0, dz: 0, dy: 0, sx: 1, sy: 1, sz: 1, color: col });
    out.caps.push({ h, rot: 0, dx: 0, dz: 0, dy: 0, sx: 1, sy: 1, sz: 1, color: new THREE.Color(WALL_LOOK.cap) });
  }
  for (const h of qual.values()) {
    const seed = h.q * 13 + h.r * 29;
    out.plinths.push({ h, rot: 0, dx: 0, dz: 0, dy: 0, sx: 1, sy: 1, sz: 1, color: new THREE.Color(WALL_LOOK.plinth).multiplyScalar(0.9 + hash2(seed, 2, 6) * 0.2) });
  }
  out.frame = (h, dir) => {
    const s = sconce.get(hexKey(h));
    if (!s) return null;
    const d = hexToWorld(DIRS[dir]!, 1);
    const side = Math.sign(new THREE.Vector2(d.x, d.z).dot(s.n)) || 1;
    const n = s.n.clone().multiplyScalar(side);
    const o = s.o * side;
    // The face is at `f` from the centreline; from the hex centre that is f - o along n.
    const face = s.f - o;
    const notch = Math.max(0, s.ext - face);
    return { n, face, notch };
  };
  out.sconceAt = (h, dir) => {
    const s = sconce.get(hexKey(h));
    if (!s) return null;
    const d = hexToWorld(DIRS[dir]!, 1);
    const dv = new THREE.Vector2(d.x, d.z).normalize();
    const dot = dv.dot(s.n);
    const f = s.f / Math.max(0.35, Math.abs(dot));
    const t = Math.min(f, 0.9);
    return { x: dv.x * t, z: dv.y * t };
  };
  return out;
}

/** Geometries for the batches (unit-sized where the item scales them). */
export function wallGeometries(): { rock: THREE.BufferGeometry; brick: THREE.BufferGeometry; core: THREE.BufferGeometry; plinth: THREE.BufferGeometry; pillar: THREE.BufferGeometry; cap: THREE.BufferGeometry } {
  const shade = (g0: THREE.BufferGeometry, top: number, side: number): THREE.BufferGeometry => {
    const g = g0.index ? g0.toNonIndexed() : g0;
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const k = nor.getY(i) > 0.9 ? top : nor.getY(i) < -0.9 ? side * 0.6 : side;
      col[i * 3] = k;
      col[i * 3 + 1] = k;
      col[i * 3 + 2] = k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.deleteAttribute('uv');
    return g;
  };
  const unitBox = () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const H = WALL_HEIGHT;
  return {
    rock: shade(new THREE.CylinderGeometry(1.02, 1.08, H, 6, 1).translate(0, H / 2, 0), 1.05, 0.75),
    brick: shade(unitBox(), 1.06, 1),
    core: shade(unitBox(), 1.15, 0.9),
    plinth: shade(new THREE.CylinderGeometry(WALL_LOOK.plinthR * 0.97, WALL_LOOK.plinthR, WALL_LOOK.plinthH, 6, 1).translate(0, WALL_LOOK.plinthH / 2, 0), 1.1, 0.8),
    pillar: shade(new THREE.CylinderGeometry(WALL_LOOK.pillarR, WALL_LOOK.pillarR * 1.1, H + 0.1, 8, 1).translate(0, (H + 0.1) / 2, 0), 1.1, 1),
    cap: shade(new THREE.CylinderGeometry(WALL_LOOK.pillarR * 1.3, WALL_LOOK.pillarR * 1.3, 0.18, 8, 1).translate(0, H + 0.17, 0), 1.15, 1),
  };
}
