// Low-poly furniture for prop / tallprop tiles, one merged vertex-coloured
// geometry per PropKind (plus a self-lit "glow" part for fires and fungus).
// Units: one hex is 1 from center to corner (about 1.73 across flats); y = 0
// is the floor top. Built facing +z (the "front"), long side along x.

import * as THREE from 'three';
import type { PropKind } from '../game/types';
import { Kit, type FigureModel } from './figures';

const WOOD = 0x7a5232;
const WOOD_DARK = 0x4e321e;
const WOOD_LIGHT = 0x9a7048;
const IRON = 0x45464c;
const IRON_DARK = 0x2a2a2e;
const STONE = 0xb8ae9e;
const STONE_DARK = 0x7c7264;
const BONE = 0xe2dac6;
const ROCK = 0x6e665c;

const cache = new Map<string, FigureModel>();

export function furnitureModel(kind: PropKind): FigureModel {
  const hit = cache.get(kind);
  if (hit) return hit;
  const m = build(kind);
  cache.set(kind, m);
  return m;
}

function legs(k: Kit, w: number, d: number, h: number, color: number, t = 0.07): void {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(t, h, t, color, [sx * (w / 2 - t), h / 2, sz * (d / 2 - t)]);
}

function build(kind: PropKind): FigureModel {
  const k = new Kit();
  switch (kind) {
    case 'table':
      legs(k, 1.35, 0.72, 0.6, WOOD_DARK, 0.09);
      k.box(1.45, 0.09, 0.8, WOOD_LIGHT, [0, 0.64, 0]);
      // A jug and a plate, so it reads as a table from above.
      k.cyl(0.07, 0.09, 0.2, 6, 0x8a5a3a, [0.35, 0.78, 0.1]);
      k.cyl(0.14, 0.14, 0.02, 8, 0xc8bca4, [-0.3, 0.7, -0.08]);
      return k.build(0.8, 0.75);
    case 'bench':
      legs(k, 1.25, 0.3, 0.32, WOOD_DARK, 0.07);
      k.box(1.35, 0.07, 0.36, WOOD, [0, 0.36, 0]);
      return k.build(0.4, 0.7);
    case 'bunk':
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(0.08, 1.15, 0.08, WOOD_DARK, [sx * 0.66, 0.575, sz * 0.32]);
      for (const y of [0.3, 0.88]) {
        k.box(1.4, 0.1, 0.72, WOOD, [0, y, 0]);
        k.box(1.1, 0.1, 0.62, 0x5d6b4c, [0.1, y + 0.1, 0]);
        k.box(0.26, 0.1, 0.5, 0xd8d0bc, [-0.5, y + 0.12, 0]);
      }
      return k.build(1.2, 0.75);
    case 'barrel':
      for (const [x, z, s] of [
        [-0.22, 0.05, 1],
        [0.28, -0.12, 0.85],
      ] as const) {
        k.cyl(0.27 * s, 0.24 * s, 0.66 * s, 9, WOOD, [x, 0.33 * s, z]);
        k.cyl(0.275 * s, 0.275 * s, 0.05, 9, IRON_DARK, [x, 0.12 * s, z]);
        k.cyl(0.275 * s, 0.275 * s, 0.05, 9, IRON_DARK, [x, 0.54 * s, z]);
        k.cyl(0.24 * s, 0.24 * s, 0.02, 9, WOOD_LIGHT, [x, 0.66 * s + 0.005, z]);
      }
      return k.build(0.7, 0.55);
    case 'crate':
      k.box(0.62, 0.55, 0.62, WOOD, [-0.12, 0.275, 0.05]);
      k.box(0.66, 0.06, 0.66, WOOD_DARK, [-0.12, 0.3, 0.05]);
      k.box(0.44, 0.4, 0.44, WOOD_LIGHT, [-0.1, 0.75, 0.02], [0, 0.4, 0]);
      k.box(0.42, 0.36, 0.42, WOOD, [0.42, 0.18, -0.25], [0, -0.3, 0]);
      return k.build(0.95, 0.6);
    case 'anvil':
      k.box(0.34, 0.12, 0.34, IRON_DARK, [0, 0.06, 0]);
      k.box(0.2, 0.32, 0.2, IRON, [0, 0.28, 0]);
      k.box(0.62, 0.16, 0.28, IRON, [0, 0.5, 0]);
      k.cone(0.12, 0.3, 4, IRON, [0.45, 0.5, 0], [0, 0, -Math.PI / 2]);
      // A stump under it.
      k.cyl(0.3, 0.32, 0.12, 8, WOOD_DARK, [0, 0.02, 0]);
      return k.build(0.6, 0.45);
    case 'cage': {
      const w = 1.2;
      const h = 1.4;
      k.box(w, 0.08, w * 0.8, IRON_DARK, [0, 0.04, 0]);
      k.box(w, 0.08, w * 0.8, IRON_DARK, [0, h, 0]);
      for (let i = 0; i <= 6; i++) {
        const x = -w / 2 + (i / 6) * w;
        k.box(0.04, h, 0.04, IRON, [x, h / 2, w * 0.4]);
        k.box(0.04, h, 0.04, IRON, [x, h / 2, -w * 0.4]);
      }
      for (let i = 1; i < 4; i++) {
        const z = -w * 0.4 + (i / 4) * w * 0.8;
        k.box(0.04, h, 0.04, IRON, [w / 2, h / 2, z]);
        k.box(0.04, h, 0.04, IRON, [-w / 2, h / 2, z]);
      }
      // Straw and a bucket inside.
      k.box(0.6, 0.05, 0.4, 0x9a8a50, [-0.2, 0.1, 0]);
      k.cyl(0.1, 0.08, 0.16, 6, WOOD, [0.3, 0.16, 0.1]);
      return k.build(h, 0.7);
    }
    case 'bones':
      k.ball(0.13, BONE, [0.1, 0.11, 0.05], [1, 0.9, 1.15]);
      k.box(0.05, 0.04, 0.05, 0x1a1612, [0.06, 0.13, 0.17]);
      k.box(0.05, 0.04, 0.05, 0x1a1612, [0.14, 0.13, 0.17]);
      for (let i = 0; i < 7; i++) {
        const a = i * 1.7;
        const r = 0.25 + (i % 3) * 0.12;
        k.cyl(0.03, 0.03, 0.42 - (i % 2) * 0.1, 5, BONE, [Math.sin(a) * r, 0.04, Math.cos(a) * r], [Math.PI / 2, a, 0]);
      }
      k.box(0.36, 0.05, 0.16, 0xcfc6b0, [-0.25, 0.04, -0.2], [0, 0.6, 0]);
      return k.build(0.3, 0.5);
    case 'rock':
      k.add(new THREE.DodecahedronGeometry(0.42, 0), ROCK, [0, 0.3, 0], [0.3, 0.5, 0.1], [1.2, 0.85, 1]);
      k.add(new THREE.DodecahedronGeometry(0.26, 0), 0x5a544c, [0.42, 0.18, 0.2], [1, 0.2, 0.4]);
      k.add(new THREE.DodecahedronGeometry(0.18, 0), 0x7a7268, [-0.35, 0.12, 0.3]);
      return k.build(0.6, 0.6);
    case 'shelf': {
      const w = 1.5;
      const h = 1.85;
      const d = 0.46;
      k.box(0.07, h, d, WOOD_DARK, [-w / 2, h / 2, 0]);
      k.box(0.07, h, d, WOOD_DARK, [w / 2, h / 2, 0]);
      k.box(w, 0.07, d, WOOD_DARK, [0, h, 0]);
      k.box(w, 0.6, 0.04, WOOD_DARK, [0, h / 2, 0]);
      const books = [0x7a2e2e, 0x2e4a6a, 0x6a5a2e, 0x3a5a3a, 0x5a3a5a, 0x8a6a3a];
      for (let s = 0; s < 4; s++) {
        const y = 0.12 + s * 0.44;
        k.box(w, 0.04, d, WOOD, [0, y, 0]);
        let x = -w / 2 + 0.08;
        let i = s * 3;
        while (x < w / 2 - 0.12) {
          const bw = 0.08 + ((i * 7) % 5) * 0.025;
          const bh = 0.26 + ((i * 3) % 4) * 0.03;
          const col = books[i % books.length]!;
          k.box(bw - 0.01, bh, d - 0.06, col, [x + bw / 2, y + 0.02 + bh / 2, 0]);
          x += bw;
          i++;
        }
      }
      return k.build(h, 0.8);
    }
    case 'forge':
      k.box(1.35, 0.95, 1.1, STONE_DARK, [0, 0.475, -0.05]);
      k.box(1.45, 0.08, 1.2, 0x5e564c, [0, 0.95, -0.05]);
      k.box(0.8, 1.2, 0.7, 0x5a524a, [0, 1.6, -0.25]);
      k.box(0.55, 0.7, 0.5, 0x4a443e, [0, 2.5, -0.3]);
      // Mouth and coals (glow).
      k.box(0.7, 0.36, 0.06, 0x1a0e08, [0, 0.42, 0.51]);
      k.box(0.6, 0.26, 0.04, 0xffa040, [0, 0.42, 0.53], undefined, true);
      k.box(0.9, 0.05, 0.6, 0xff7a20, [0, 1.0, 0.15], undefined, true);
      // Bellows.
      k.box(0.4, 0.22, 0.5, 0x6a4a2e, [-0.85, 0.5, 0.2], [0, 0.3, 0.2]);
      return k.build(2.8, 0.8);
    case 'winch':
      // Static frame only; the drum is a separate moving part (see winchDrum).
      for (const sx of [-1, 1]) {
        k.box(0.12, 1.5, 0.12, WOOD_DARK, [sx * 0.7, 0.75, 0.25], [0.18, 0, 0]);
        k.box(0.12, 1.5, 0.12, WOOD_DARK, [sx * 0.7, 0.75, -0.25], [-0.18, 0, 0]);
        k.box(0.14, 0.14, 0.7, WOOD, [sx * 0.7, 0.14, 0]);
      }
      k.box(1.55, 0.12, 0.12, WOOD, [0, 1.42, 0]);
      // Coiled rope beside it.
      k.add(new THREE.TorusGeometry(0.22, 0.06, 4, 10), 0xb08a50, [0.2, 0.06, 0.6], [Math.PI / 2, 0, 0]);
      return k.build(1.6, 0.8);
    case 'statue':
      k.box(1.05, 0.45, 1.05, STONE_DARK, [0, 0.225, 0]);
      k.box(0.85, 0.12, 0.85, STONE, [0, 0.5, 0]);
      k.cyl(0.24, 0.42, 1.3, 7, STONE, [0, 1.2, 0]);
      k.box(0.7, 0.2, 0.32, STONE, [0, 1.8, 0]);
      k.ball(0.2, STONE, [0, 2.08, 0.02]);
      // Raised sword.
      k.box(0.1, 0.5, 0.1, STONE, [0.32, 1.95, 0.06], [0, 0, -0.3]);
      k.box(0.06, 0.8, 0.02, 0xd8d0c0, [0.42, 2.5, 0.06]);
      k.box(0.24, 0.04, 0.05, STONE, [0.42, 2.1, 0.06]);
      return k.build(2.9, 0.6);
    case 'rack':
      k.box(1.3, 0.08, 0.34, WOOD_DARK, [0, 0.04, 0]);
      for (const sx of [-1, 1]) k.box(0.08, 1.2, 0.08, WOOD_DARK, [sx * 0.6, 0.6, 0]);
      k.box(1.3, 0.07, 0.1, WOOD, [0, 1.12, 0]);
      k.box(1.3, 0.07, 0.1, WOOD, [0, 0.55, 0]);
      for (let i = 0; i < 5; i++) {
        const x = -0.45 + i * 0.22;
        if (i % 2) {
          k.box(0.04, 1.3, 0.04, WOOD_DARK, [x, 0.7, 0.08]);
          k.cone(0.05, 0.16, 4, 0xa8acb2, [x, 1.42, 0.08]);
        } else {
          k.box(0.06, 0.8, 0.02, 0xa8acb2, [x, 0.62, 0.1]);
          k.box(0.2, 0.04, 0.05, 0x3a2a1a, [x, 1.0, 0.1]);
        }
      }
      return k.build(1.4, 0.7);
    case 'stalagmite':
      k.cone(0.42, 1.7, 6, 0x6a6058, [0, 0.85, 0], [0.04, 0, 0.05]);
      k.cone(0.26, 1.0, 5, 0x5c544c, [0.42, 0.5, 0.18], [0, 0, -0.12]);
      k.cone(0.18, 0.6, 5, 0x7a7066, [-0.35, 0.3, -0.25]);
      return k.build(1.7, 0.6);
  }
  return k.box(0.5, 0.5, 0.5, WOOD, [0, 0.25, 0]).build(0.5, 0.5);
}

/** The winch drum (rotates about local x when the lift is worked). */
export function winchDrum(): FigureModel {
  const hit = cache.get('__drum');
  if (hit) return hit;
  const k = new Kit();
  k.cyl(0.36, 0.36, 1.25, 10, 0x6a4a2e, [0, 0, 0], [0, 0, Math.PI / 2]);
  for (const x of [-0.5, -0.2, 0.1, 0.4]) k.cyl(0.38, 0.38, 0.12, 10, 0xb08a50, [x, 0, 0], [0, 0, Math.PI / 2]);
  for (const sx of [-1, 1]) k.cyl(0.45, 0.45, 0.06, 10, WOOD_DARK, [sx * 0.64, 0, 0], [0, 0, Math.PI / 2]);
  // Crank spokes on one end.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    k.box(0.06, 0.9, 0.06, WOOD_DARK, [0.82, Math.sin(a) * 0.3, Math.cos(a) * 0.3], [a, 0, 0]);
  }
  const m = k.build(0.5, 0.5);
  cache.set('__drum', m);
  return m;
}

/** Gold heaps for the Dragon's hoard (ground items of kind 'hoard'). */
export function hoardModel(): FigureModel {
  const hit = cache.get('__hoard');
  if (hit) return hit;
  const k = new Kit();
  k.cone(0.55, 0.42, 8, 0xe0b040, [0, 0.21, 0]);
  k.cone(0.32, 0.3, 7, 0xf0c050, [0.38, 0.15, 0.22]);
  k.cone(0.28, 0.26, 7, 0xd8a830, [-0.36, 0.13, 0.25]);
  k.box(0.32, 0.22, 0.24, 0x6a3a2a, [-0.3, 0.11, -0.3], [0, 0.4, 0]);
  k.box(0.36, 0.04, 0.28, 0xe0b040, [-0.3, 0.24, -0.3], [0, 0.4, 0]);
  k.add(new THREE.OctahedronGeometry(0.08, 0), 0x4fd0c8, [0.1, 0.44, 0.05], undefined, undefined, true);
  k.add(new THREE.OctahedronGeometry(0.07, 0), 0xff4a6a, [0.4, 0.3, 0.2], undefined, undefined, true);
  // A crown on top.
  k.cyl(0.1, 0.09, 0.08, 6, 0xffd36a, [-0.05, 0.43, -0.05], [0.3, 0, 0.2]);
  const m = k.build(0.5, 0.6);
  cache.set('__hoard', m);
  return m;
}
