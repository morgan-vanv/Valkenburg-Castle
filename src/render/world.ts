// World-space conventions for the diorama. One square = TILE world units
// (V2 doubled the tile size so rooms read as open space). Level geometry is
// built at 1 unit per square and its group is scaled by TILE on the ground plane;
// everything else is placed through squareCenter().
// Level 1 sits at y = 0; deeper levels stack downward.

import * as THREE from 'three';
import type { Coord, LevelId } from '../engine/types';

export const TILE = 2;
export const LEVEL_GAP = 8;
export const FLOOR_TOP = 0.06;
export const WALL_HEIGHT = 1.4;
export const WALL_THICK = 0.2;

export function levelY(level: LevelId | number): number {
  return -(level - 1) * LEVEL_GAP;
}

export function squareCenter(c: Coord, lift = FLOOR_TOP, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set((c.x + 0.5) * TILE, levelY(c.level) + lift, (c.y + 0.5) * TILE);
}

/** Small deterministic hash for visual jitter (not game randomness). */
export function hash2(x: number, y: number, s = 0): number {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export const COLORS = {
  void: 0x060505,
  stone: 0x5b5249,
  stoneDark: 0x2c2722,
  floor: 0x6d6153,
  rock: 0x1b1816,
  wood: 0x6b4426,
  woodDark: 0x3d2615,
  iron: 0x3b3a3d,
  ember: 0xe8a33d,
  emberHot: 0xffb35c,
  parchment: 0xefe4cf,
  danger: 0xff1f2d,
  cold: 0x6f8fc8,
  orc: 0x2f4a24,
  orcDark: 0x1e2f17,
  steel: 0x8d9095,
  steelDark: 0x55585e,
  tabard: 0x7d1f1a,
  gold: 0xd9a93a,
};

export const HERO_COLORS: Record<string, number> = {
  hobart: 0xd9a93a,
  rogier: 0x3561c9,
  thorvold: 0xb0702f,
  pim: 0x3b9a4a,
  aldous: 0x8a4cc9,
};

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
