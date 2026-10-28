// V5.0 (G): decorative dressing, by room, built from primitives (docs/v5-graphics-plan.md, "Dressing that
// never lies about the rules").
//
// Dressing is decoration only: it hangs on brick faces or sits on the wall plinths (the notches of the
// brick walls) and never on a walkable hex. Rules props (PropKind) keep their own look in level.ts. Each
// placement names a wall hex in offset coordinates (col, row, as the castle data writes them), the
// direction toward the room it faces (DIRS index) and, for hung pieces, a height. The table is keyed by
// room id; W0 dresses the Great Hall, W4 the rest.

import * as THREE from 'three';
import { DIRS, hexToWorld, type Hex } from '../../game/hex';
import { fogMaterial, type FogMaterial } from '../fog';
import { COLORS, HEX, WALL_HEIGHT, hash2 } from '../world';
import { WALL_LOOK } from './walls';

export type DressingKind = 'banner' | 'crest' | 'barrels' | 'crates' | 'candelabra' | 'bones' | 'rubble' | 'rack' | 'sacks';

export interface Placement {
  kind: DressingKind;
  /** Offset column and row of the wall hex it hangs on or whose plinth it stands on. */
  col: number;
  row: number;
  /** DIRS index toward the open hex it faces. */
  dir: number;
  /** Colour variant where it applies (banners). */
  color?: number;
  /** Shift along the wall, world units (to sit between two wall hexes). */
  along?: number;
}

/** The dressing table. W0: the Great Hall (Level 1). */
export const DRESSING: Record<string, Placement[]> = {
  hall: [
    // The north wall behind the high table: Hobart's banners either side of the family crest.
    { kind: 'banner', col: 20, row: 6, dir: 5, color: 0x7a1414 },
    { kind: 'crest', col: 24, row: 6, dir: 5 },
    { kind: 'banner', col: 28, row: 6, dir: 5, color: 0x7a1414 },
    { kind: 'banner', col: 18, row: 6, dir: 5, color: 0x2f4f6a },
    { kind: 'banner', col: 30, row: 6, dir: 5, color: 0x2f4f6a },
    // The west wall (toward the kitchens): stores and a candelabra.
    { kind: 'barrels', col: 14, row: 17, dir: 0 },
    { kind: 'crates', col: 14, row: 13, dir: 0 },
    { kind: 'candelabra', col: 14, row: 19, dir: 0 },
    // The east wall: a candelabra, an old weapon rack, bones in the corner.
    { kind: 'candelabra', col: 34, row: 17, dir: 3 },
    { kind: 'rack', col: 34, row: 11, dir: 3 },
    { kind: 'bones', col: 32, row: 19, dir: 3 },
    // The south wall (toward the gate): fallen stone and grain sacks by the passage.
    { kind: 'rubble', col: 29, row: 21, dir: 2 },
    { kind: 'sacks', col: 18, row: 21, dir: 2 },
    { kind: 'banner', col: 26, row: 21, dir: 2, color: 0x7a1414 },
  ],
};

export interface DressingPiece {
  obj: THREE.Object3D;
  mats: THREE.Material[];
  /** The wall hex and the open hex it faces (axial), for fog. */
  hexes: Hex[];
  /** Flames to flicker (candles). */
  flames: THREE.Object3D[];
}

const offsetToAxial = (col: number, row: number): Hex => ({ q: col - Math.floor(row / 2), r: row });

interface Mats {
  wood: FogMaterial;
  woodDark: FogMaterial;
  iron: FogMaterial;
  gold: FogMaterial;
  bone: FogMaterial;
  stone: FogMaterial;
  cloth: (color: number) => FogMaterial;
  sack: FogMaterial;
  wax: FogMaterial;
}

function mats(): Mats {
  const std = (color: number, roughness = 0.85, metalness = 0, litFloor = 0.18) => fogMaterial({ color, standard: true, roughness, metalness, litFloor });
  const cache = new Map<number, FogMaterial>();
  return {
    wood: std(COLORS.wood),
    woodDark: std(COLORS.woodDark),
    iron: std(0x3b3a3d, 0.5, 0.5),
    gold: std(COLORS.gold, 0.3, 0.6),
    bone: std(0xe8dcc0, 0.8),
    stone: std(0x6e6170, 0.9),
    sack: std(0x9a8a6a, 0.95),
    wax: std(0xefe4cf, 0.7),
    cloth: (c) => {
      let m = cache.get(c);
      if (!m) {
        m = std(c, 0.9, 0, 0.22);
        m.side = THREE.DoubleSide;
        cache.set(c, m);
      }
      return m;
    },
  };
}

const flameMat = () => new THREE.MeshBasicMaterial({ color: 0xffb35c, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
const coreMat = () => new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });

function mesh(g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, ry = 0): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.rotation.y = ry;
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
}

/**
 * Build one placement. The group's origin is the wall hex centre at floor level; +z is the brick face's
 * outward normal. `faceAt` is the face's distance from the origin, `notchAt` the centre of the notch in
 * front of it (where plinth pieces stand). Returns null when the piece needs a notch and there is none.
 */
function build(p: Placement, M: Mats, seed: number, faceAt: number, notchDepth: number): { g: THREE.Group; mats: THREE.Material[]; flames: THREE.Object3D[] } | null {
  const g = new THREE.Group();
  const used: THREE.Material[] = [];
  const flames: THREE.Object3D[] = [];
  const use = (m: FogMaterial) => (used.includes(m) || used.push(m), m);
  const H = WALL_HEIGHT;
  const onPlinth = p.kind !== 'banner' && p.kind !== 'crest' && p.kind !== 'rack';
  if (onPlinth && notchDepth < 0.45) return null;
  const face = faceAt + 0.02;
  const shelf = WALL_LOOK.plinthH;
  const notch = faceAt + notchDepth * 0.5;
  const j = (k: number) => hash2(seed, k, 11);
  switch (p.kind) {
    case 'banner': {
      const c = p.color ?? 0x7a1414;
      g.add(mesh(new THREE.BoxGeometry(1.2, 0.07, 0.09), use(M.wood), 0, H * 0.9, face + 0.05));
      g.add(mesh(new THREE.BoxGeometry(0.96, H * 0.5, 0.03), use(M.cloth(c)), 0, H * 0.64, face + 0.07));
      const tip = mesh(new THREE.ConeGeometry(0.48, 0.34, 3), use(M.cloth(c)), 0, H * 0.39 - 0.17, face + 0.07);
      tip.rotation.x = Math.PI;
      tip.scale.z = 0.08;
      g.add(tip);
      // A gold device on the cloth.
      g.add(mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.02, 6), use(M.gold), 0, H * 0.66, face + 0.1).rotateX(Math.PI / 2));
      break;
    }
    case 'crest': {
      // Hobart's round shield between two crossed swords, hung high on the face.
      const y = H * 0.66;
      const shield = mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 8), use(M.cloth(0x7a1414)), 0, y, face + 0.05);
      shield.rotation.x = Math.PI / 2;
      g.add(shield);
      g.add(mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.03, 8), use(M.gold), 0, y, face + 0.02).rotateX(Math.PI / 2));
      g.add(mesh(new THREE.IcosahedronGeometry(0.12, 0), use(M.gold), 0, y, face + 0.1));
      for (const s of [-1, 1]) {
        const sw = mesh(new THREE.BoxGeometry(0.06, 1.3, 0.025), use(M.iron), 0, y, face + 0.03);
        sw.rotation.z = s * 0.6;
        g.add(sw);
        const guard = mesh(new THREE.BoxGeometry(0.26, 0.05, 0.06), use(M.wood), -s * 0.3, y - 0.42, face + 0.03);
        guard.rotation.z = s * 0.6;
        g.add(guard);
      }
      break;
    }
    case 'barrels': {
      const barrel = (x: number, z: number, s: number) => {
        g.add(mesh(new THREE.CylinderGeometry(0.26 * s, 0.26 * s, 0.56 * s, 10), use(M.wood), x, shelf + 0.28 * s, z));
        for (const y of [0.12, 0.44]) g.add(mesh(new THREE.CylinderGeometry(0.275 * s, 0.275 * s, 0.05, 10), use(M.iron), x, shelf + y * s, z));
      };
      barrel(-0.3, notch - 0.05, 1);
      barrel(0.32, notch - 0.1, 0.9);
      barrel(0.02, notch + 0.38, 0.85);
      break;
    }
    case 'crates': {
      g.add(mesh(new THREE.BoxGeometry(0.56, 0.56, 0.56), use(M.wood), -0.2, shelf + 0.28, notch, 0.25));
      g.add(mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), use(M.woodDark), -0.15, shelf + 0.56 + 0.21, notch, 0.7));
      g.add(mesh(new THREE.BoxGeometry(0.46, 0.4, 0.46), use(M.woodDark), 0.42, shelf + 0.2, notch + 0.1, -0.3));
      break;
    }
    case 'candelabra': {
      // A tall iron stand on the plinth with three candles; the flames bloom.
      const x = 0;
      const z = notch;
      g.add(mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.06, 6), use(M.iron), x, shelf + 0.03, z));
      g.add(mesh(new THREE.CylinderGeometry(0.03, 0.04, 1.2, 5), use(M.iron), x, shelf + 0.66, z));
      g.add(mesh(new THREE.BoxGeometry(0.62, 0.04, 0.04), use(M.iron), x, shelf + 1.24, z));
      for (const [dx, h] of [[-0.28, 0.22], [0, 0.3], [0.28, 0.18]] as [number, number][]) {
        g.add(mesh(new THREE.CylinderGeometry(0.045, 0.045, h, 6), use(M.wax), x + dx, shelf + 1.26 + h / 2, z));
        const f = new THREE.Group();
        f.add(mesh(new THREE.ConeGeometry(0.055, 0.17, 5), flameMat(), 0, 0.08, 0));
        f.add(mesh(new THREE.ConeGeometry(0.03, 0.1, 5), coreMat(), 0, 0.06, 0));
        f.position.set(x + dx, shelf + 1.26 + h, z);
        f.traverse((o) => ((o as THREE.Mesh).castShadow = false));
        g.add(f);
        flames.push(f);
      }
      break;
    }
    case 'bones': {
      g.add(mesh(new THREE.IcosahedronGeometry(0.13, 1), use(M.bone), -0.1, shelf + 0.12, notch));
      for (let k = 0; k < 4; k++) g.add(mesh(new THREE.BoxGeometry(0.34, 0.045, 0.045), use(M.bone), (j(k) - 0.5) * 0.7, shelf + 0.025, notch + (j(k + 4) - 0.5) * 0.4, j(k + 8) * 3));
      break;
    }
    case 'rubble': {
      for (let k = 0; k < 7; k++) {
        const r = 0.08 + j(k) * 0.12;
        g.add(mesh(new THREE.DodecahedronGeometry(r, 0), use(M.stone), (j(k + 3) - 0.5) * 1.0, shelf + r * 0.7, notch + (j(k + 6) - 0.5) * 0.5, j(k + 9) * 3));
      }
      break;
    }
    case 'rack': {
      // A wall rack: two brackets, a spear and a long-handled axe leaning in it.
      for (const x of [-0.3, 0.3]) g.add(mesh(new THREE.BoxGeometry(0.08, 0.08, 0.3), use(M.wood), x, H * 0.5, face + 0.15));
      g.add(mesh(new THREE.BoxGeometry(0.9, 0.08, 0.08), use(M.wood), 0, H * 0.5, face + 0.28));
      const spear = mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.0, 5), use(M.wood), -0.2, shelf + 1.0, face + 0.2);
      spear.rotation.z = 0.08;
      g.add(spear);
      g.add(mesh(new THREE.ConeGeometry(0.05, 0.22, 4), use(M.iron), -0.28, shelf + 2.08, face + 0.2));
      const axe = mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.5, 5), use(M.wood), 0.25, shelf + 0.75, face + 0.22);
      axe.rotation.z = -0.1;
      g.add(axe);
      g.add(mesh(new THREE.BoxGeometry(0.05, 0.3, 0.34), use(M.iron), 0.18, shelf + 1.38, face + 0.22));
      break;
    }
    case 'sacks': {
      const sack = (x: number, z: number, s: number) => {
        const m = mesh(new THREE.IcosahedronGeometry(0.26 * s, 1), use(M.sack), x, shelf + 0.2 * s, z);
        m.scale.set(1.15, 0.8, 1);
        g.add(m);
      };
      sack(-0.3, notch, 1);
      sack(0.3, notch + 0.05, 0.9);
      sack(0, notch + 0.4, 0.85);
      break;
    }
  }
  return { g, mats: used, flames };
}

export interface DressingContext {
  level: number;
  y0: number;
  /** Tile at an axial hex (undefined off the map). */
  has(h: Hex): boolean;
  /** The brick face of a wall hex toward a direction (look/walls.ts LookWalls.frame). */
  frame(h: Hex, dir: number): { n: THREE.Vector2; face: number; notch: number } | null;
}

/** Build every placement for the rooms on this level. Pieces whose wall hex is off the map are skipped. */
export function buildDressing(ctx: DressingContext, roomIds: Iterable<string>): DressingPiece[] {
  const M = mats();
  const out: DressingPiece[] = [];
  let seed = ctx.level * 100;
  for (const room of roomIds) {
    for (const p of DRESSING[room] ?? []) {
      seed++;
      const wall = offsetToAxial(p.col, p.row);
      if (!ctx.has(wall)) continue;
      const d = DIRS[p.dir]!;
      const open: Hex = { q: wall.q + d.q, r: wall.r + d.r };
      const w = hexToWorld(wall, HEX);
      const fr = ctx.frame(wall, p.dir);
      if (!fr) continue;
      const yaw = Math.atan2(fr.n.x, fr.n.y);
      const built = build(p, M, seed, fr.face, fr.notch);
      if (!built) continue;
      const { g, mats: used, flames } = built;
      g.position.set(w.x, ctx.y0, w.z);
      g.rotation.y = yaw;
      if (p.along) g.position.add(new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar(p.along));
      out.push({ obj: g, mats: used, hexes: [wall, open], flames });
    }
  }
  return out;
}

