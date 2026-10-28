// V5.0 (G): decorative dressing, by room, built from primitives (docs/v5-graphics-plan.md, "Dressing that
// never lies about the rules").
//
// Dressing is decoration only: it hangs on brick faces or sits on the wall plinths (the notches of the
// brick walls) and never on a walkable hex. Rules props (PropKind) keep their own look in level.ts. Each
// placement names a wall hex in offset coordinates (col, row, as the castle data writes them), the
// direction toward the room it faces (DIRS index) and, for hung pieces, a height. The table is keyed by
// room id; W0 dresses the Great Hall, W4 the rest.

import * as THREE from 'three';
import { DIRS, hexKey, hexToWorld, type Hex } from '../../game/hex';
import { fogMaterial, type FogMaterial } from '../fog';
import { COLORS, HEX, WALL_HEIGHT, hash2 } from '../world';
import { WALL_LOOK } from './walls';

export type DressingKind = 'banner' | 'crest' | 'barrels' | 'crates' | 'candelabra' | 'bones' | 'rubble' | 'rack' | 'sacks' | 'shelf' | 'cobweb' | 'chains' | 'mushrooms' | 'roots' | 'skulls' | 'anvil' | 'pews' | 'scrolls' | 'moss';

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

/**
 * W4: a recipe per room id (or per material for rooms without one): kinds drawn in order around the room's
 * wall faces, with a target count. The hall keeps its hand table; a recipe can add to a hand table.
 */
export interface Recipe {
  kinds: DressingKind[];
  /** About one piece per this many wall faces (lower = denser). */
  per: number;
  min?: number;
  max?: number;
}

export const RECIPES: Record<string, Recipe> = {
  // Level 1
  gate: { kinds: ['banner', 'chains', 'crates', 'rack', 'cobweb', 'rubble'], per: 4, max: 10 },
  'gate-pass': { kinds: ['chains', 'cobweb', 'rubble'], per: 5, max: 4 },
  court: { kinds: ['rubble', 'moss', 'crates', 'sacks', 'roots'], per: 5, max: 10 },
  kitchen: { kinds: ['barrels', 'sacks', 'shelf', 'crates', 'candelabra', 'cobweb'], per: 3, max: 12 },
  servants: { kinds: ['sacks', 'cobweb', 'crates', 'chains'], per: 5, max: 6 },
  library: { kinds: ['shelf', 'scrolls', 'candelabra', 'shelf', 'cobweb', 'scrolls'], per: 3, max: 14 },
  tower: { kinds: ['rack', 'crates', 'chains', 'cobweb', 'banner'], per: 4, max: 8 },
  armory: { kinds: ['rack', 'rack', 'crates', 'anvil', 'chains', 'banner'], per: 3, max: 10 },
  chapel: { kinds: ['candelabra', 'pews', 'banner', 'candelabra', 'skulls', 'cobweb'], per: 3, max: 12 },
  breach: { kinds: ['rubble', 'roots', 'moss', 'mushrooms'], per: 4, max: 8 },
  sally: { kinds: ['chains', 'cobweb', 'rubble', 'crates'], per: 5, max: 5 },
  // Level 2
  crossing: { kinds: ['chains', 'moss', 'cobweb', 'rubble', 'skulls'], per: 5, max: 8 },
  bridges: { kinds: ['moss', 'chains'], per: 6, max: 4 },
  arcade: { kinds: ['banner', 'chains', 'cobweb', 'rack', 'skulls'], per: 4, max: 10 },
  'ledge-e': { kinds: ['rubble', 'moss', 'mushrooms', 'roots'], per: 5, max: 6 },
  rim: { kinds: ['rubble', 'moss', 'skulls'], per: 6, max: 5 },
  guard: { kinds: ['rack', 'crates', 'chains', 'banner', 'barrels'], per: 4, max: 8 },
  barracks: { kinds: ['rack', 'crates', 'sacks', 'chains', 'cobweb', 'barrels'], per: 4, max: 10 },
  officers: { kinds: ['banner', 'shelf', 'candelabra', 'crest', 'scrolls'], per: 3, max: 10 },
  archive: { kinds: ['scrolls', 'shelf', 'scrolls', 'candelabra', 'cobweb', 'shelf'], per: 3, max: 14 },
  cells: { kinds: ['chains', 'skulls', 'chains', 'cobweb', 'moss', 'bones'], per: 3, max: 12 },
  winch: { kinds: ['chains', 'crates', 'barrels', 'sacks', 'rack'], per: 4, max: 8 },
  forge: { kinds: ['anvil', 'rack', 'chains', 'barrels', 'crates', 'anvil'], per: 3, max: 10 },
  // Level 3
  bones: { kinds: ['skulls', 'bones', 'skulls', 'cobweb', 'moss'], per: 3, max: 14 },
  lair: { kinds: ['skulls', 'rubble', 'bones', 'moss'], per: 4, max: 10 },
  sealed: { kinds: ['chains', 'candelabra', 'skulls', 'cobweb'], per: 4, max: 6 },
  grove: { kinds: ['mushrooms', 'roots', 'moss', 'mushrooms', 'roots'], per: 3, max: 14 },
  nest: { kinds: ['cobweb', 'bones', 'cobweb', 'skulls', 'cobweb'], per: 3, max: 12 },
  tunnels: { kinds: ['roots', 'mushrooms', 'rubble', 'moss'], per: 5, max: 10 },
  lift: { kinds: ['chains', 'crates', 'roots', 'rubble'], per: 5, max: 6 },
  drain: { kinds: ['moss', 'chains', 'moss', 'mushrooms'], per: 4, max: 8 },
};

const ON_FACE = new Set<DressingKind>(['banner', 'crest', 'rack', 'cobweb', 'chains', 'roots', 'moss']);

export interface DressingPiece {
  obj: THREE.Object3D;
  mats: THREE.Material[];
  /** The wall hex and the open hex it faces (axial), for fog. */
  hexes: Hex[];
  /** Flames to flicker (candles). */
  flames: THREE.Object3D[];
  /** Hung on the brick face (goes with the wall when it is cut away), not standing on the plinth. */
  onFace: boolean;
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
  web: FogMaterial;
  fungus: FogMaterial;
  root: FogMaterial;
  eye: FogMaterial;
  moss: FogMaterial;
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
    web: (() => { const m = std(0xd8d4cc, 1, 0, 0.3); m.transparent = true; m.opacity = 0.55; m.side = THREE.DoubleSide; return m; })(),
    fungus: std(0x9ad0a8, 0.6, 0, 0.5),
    root: std(0x4a3a28, 0.95),
    eye: std(0x0a0806, 1, 0, 0),
    moss: std(0x3f5a2c, 1, 0, 0.1),
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
  const onPlinth = !ON_FACE.has(p.kind);
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
    case 'shelf': {
      // A low bookcase standing in the notch: planks, with books in three colours.
      const bh = 1.1;
      g.add(mesh(new THREE.BoxGeometry(1.0, bh, 0.3), use(M.woodDark), 0, shelf + bh / 2, notch));
      for (let row = 0; row < 3; row++) {
        const y = shelf + 0.08 + row * 0.34;
        g.add(mesh(new THREE.BoxGeometry(0.94, 0.03, 0.26), use(M.wood), 0, y, notch + 0.01));
        for (let i = 0; i < 5; i++) {
          const w = 0.09 + j(i + row * 7) * 0.06;
          const h = 0.16 + j(i + row * 9) * 0.1;
          g.add(mesh(new THREE.BoxGeometry(w, h, 0.2), use(M.cloth([0x7a1414, 0x2f4f6a, 0x8a6a2a, 0x3b5a3a][Math.floor(j(i + row * 3) * 4)]!)), -0.36 + i * 0.18, y + h / 2 + 0.015, notch + 0.03));
        }
      }
      break;
    }
    case 'cobweb': {
      // A pale web in the top corner of the face.
      const web = mesh(new THREE.CircleGeometry(0.42, 8, 0, Math.PI / 2), use(M.web), -0.45, H - 0.05, face + 0.03);
      web.rotation.z = -Math.PI / 2;
      g.add(web);
      for (let i = 0; i < 4; i++) g.add(mesh(new THREE.BoxGeometry(0.006, 0.45, 0.004), use(M.web), -0.45 + Math.sin((i / 3) * Math.PI * 0.5) * 0.22, H - 0.28, face + 0.035, 0).rotateZ(-(i / 3) * Math.PI * 0.5));
      break;
    }
    case 'chains': {
      // Iron rings on the face with a hanging chain and a pair of shackles.
      for (const x of [-0.3, 0.3]) {
        g.add(mesh(new THREE.TorusGeometry(0.07, 0.018, 4, 8), use(M.iron), x, H * 0.72, face + 0.03));
        const n = 6;
        for (let i = 0; i < n; i++) g.add(mesh(new THREE.TorusGeometry(0.035, 0.012, 4, 6), use(M.iron), x + (i % 2) * 0.01, H * 0.72 - 0.08 - i * 0.065, face + 0.05).rotateY((i % 2) * Math.PI / 2));
        g.add(mesh(new THREE.TorusGeometry(0.06, 0.016, 4, 8), use(M.iron), x, H * 0.72 - 0.08 - n * 0.065, face + 0.05).rotateX(Math.PI / 2));
      }
      break;
    }
    case 'mushrooms': {
      // Pale fungus in the notch, caps glowing faintly.
      for (let i = 0; i < 5; i++) {
        const sz = 0.05 + j(i) * 0.08;
        const x = (j(i + 5) - 0.5) * 0.9;
        const z = notch + (j(i + 10) - 0.5) * 0.4;
        g.add(mesh(new THREE.CylinderGeometry(sz * 0.3, sz * 0.4, sz * 1.6, 5), use(M.wax), x, shelf + sz * 0.8, z));
        const cap = mesh(new THREE.ConeGeometry(sz, sz * 0.7, 6), use(M.fungus), x, shelf + sz * 1.8, z);
        g.add(cap);
      }
      break;
    }
    case 'roots': {
      // Roots breaking through the face, hanging down.
      for (let i = 0; i < 4; i++) {
        const x = (j(i) - 0.5) * 0.9;
        const r = mesh(new THREE.CylinderGeometry(0.02, 0.05, H * 0.5, 5), use(M.root), x, H * 0.62, face + 0.06);
        r.rotation.z = (j(i + 4) - 0.5) * 0.5;
        r.rotation.x = -0.15;
        g.add(r);
        g.add(mesh(new THREE.CylinderGeometry(0.012, 0.03, H * 0.3, 4), use(M.root), x + (j(i + 8) - 0.5) * 0.3, H * 0.3, face + 0.1).rotateZ((j(i + 2) - 0.5) * 0.8));
      }
      break;
    }
    case 'skulls': {
      // A heap of skulls on the plinth.
      for (let i = 0; i < 6; i++) {
        const r = 0.09 + j(i) * 0.04;
        const x = (j(i + 3) - 0.5) * 0.8;
        const z = notch + (j(i + 6) - 0.5) * 0.4;
        const sk = mesh(new THREE.IcosahedronGeometry(r, 1), use(M.bone), x, shelf + r + (i < 2 ? 0.14 : 0), z, j(i + 9) * 6);
        sk.scale.set(1, 0.9, 1.1);
        g.add(sk);
        for (const e of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(r * 0.35, r * 0.35, 0.02), use(M.eye), x + e * r * 0.35, shelf + r * 1.1 + (i < 2 ? 0.14 : 0), z + r * 0.95));
      }
      break;
    }
    case 'anvil': {
      g.add(mesh(new THREE.BoxGeometry(0.5, 0.3, 0.3), use(M.woodDark), 0, shelf + 0.15, notch));
      g.add(mesh(new THREE.BoxGeometry(0.62, 0.16, 0.26), use(M.iron), 0, shelf + 0.38, notch));
      g.add(mesh(new THREE.ConeGeometry(0.1, 0.3, 6), use(M.iron), -0.42, shelf + 0.38, notch).rotateZ(Math.PI / 2));
      g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 5), use(M.wood), 0.3, shelf + 0.6, notch + 0.2).rotateZ(0.6));
      g.add(mesh(new THREE.BoxGeometry(0.18, 0.12, 0.12), use(M.iron), 0.5, shelf + 0.74, notch + 0.2));
      break;
    }
    case 'pews': {
      // A short pew against the face.
      g.add(mesh(new THREE.BoxGeometry(1.1, 0.06, 0.36), use(M.wood), 0, shelf + 0.4, notch));
      g.add(mesh(new THREE.BoxGeometry(1.1, 0.42, 0.06), use(M.wood), 0, shelf + 0.64, notch - 0.16));
      for (const x of [-0.48, 0.48]) g.add(mesh(new THREE.BoxGeometry(0.06, 0.4, 0.34), use(M.woodDark), x, shelf + 0.2, notch));
      break;
    }
    case 'scrolls': {
      // A chest of pigeonholes in the notch with rolled scrolls.
      g.add(mesh(new THREE.BoxGeometry(0.9, 0.7, 0.3), use(M.woodDark), 0, shelf + 0.35, notch));
      for (let r = 0; r < 2; r++) for (let i = 0; i < 4; i++) g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 6), use(M.wax), -0.32 + i * 0.21, shelf + 0.2 + r * 0.3, notch + 0.02).rotateX(Math.PI / 2));
      break;
    }
    case 'moss': {
      // Moss and damp streaks low on the face.
      for (let i = 0; i < 4; i++) {
        const w = 0.2 + j(i) * 0.3;
        g.add(mesh(new THREE.BoxGeometry(w, 0.12 + j(i + 4) * 0.2, 0.03), use(M.moss), (j(i + 8) - 0.5) * 0.9, shelf + 0.1 + j(i + 2) * 0.5, face + 0.015));
      }
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
  /** W4: every (wall hex, direction) face in a room, in a stable order around it; the open neighbour is a plain floor of that room. */
  faces(room: string): { h: Hex; dir: number }[];
}

/** Build every placement for the rooms on this level. Pieces whose wall hex is off the map are skipped. */
export function buildDressing(ctx: DressingContext, roomIds: Iterable<string>): DressingPiece[] {
  const M = mats();
  const out: DressingPiece[] = [];
  let seed = ctx.level * 100;
  const used = new Set<string>();
  const place = (p: Placement, wall: Hex) => {
    seed++;
    const d = DIRS[p.dir]!;
    const open: Hex = { q: wall.q + d.q, r: wall.r + d.r };
    const w = hexToWorld(wall, HEX);
    const fr = ctx.frame(wall, p.dir);
    if (!fr) return false;
    const yaw = Math.atan2(fr.n.x, fr.n.y);
    const built = build(p, M, seed, fr.face, fr.notch);
    if (!built) return false;
    const { g, mats: ms, flames } = built;
    g.position.set(w.x, ctx.y0, w.z);
    g.rotation.y = yaw;
    if (p.along) g.position.add(new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar(p.along));
    out.push({ obj: g, mats: ms, hexes: [wall, open], flames, onFace: ON_FACE.has(p.kind) });
    used.add(hexKey(wall));
    return true;
  };
  for (const room of roomIds) {
    for (const p of DRESSING[room] ?? []) {
      const wall = offsetToAxial(p.col, p.row);
      if (ctx.has(wall)) place(p, wall);
    }
    const recipe = RECIPES[room];
    if (!recipe) continue;
    const faces = ctx.faces(room).filter((f) => !used.has(hexKey(f.h)));
    if (!faces.length) continue;
    const want = Math.min(recipe.max ?? 12, Math.max(recipe.min ?? 2, Math.round(faces.length / recipe.per)));
    // Spread the picks around the room: every (faces / want)th face, starting at a room-seeded offset.
    const step = faces.length / want;
    const start = hash2(room.length * 7, ctx.level, 77) * step;
    let k = 0;
    for (let i = 0; i < want && k < faces.length * 2; i++) {
      let placed = false;
      for (let tries = 0; tries < 3 && !placed; tries++, k++) {
        const f = faces[Math.floor(start + (i + tries * 0.37) * step) % faces.length]!;
        if (used.has(hexKey(f.h))) continue;
        const kind = recipe.kinds[i % recipe.kinds.length]!;
        placed = place({ kind, col: 0, row: 0, dir: f.dir, color: [0x7a1414, 0x2f4f6a, 0x3b5a3a][i % 3] }, f.h);
      }
    }
  }
  return out;
}

