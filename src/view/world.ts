// World-space conventions for the V3 hex diorama.
// One hex has center-to-corner HEX world units (pointy-top, axial q/r from
// src/game/hex.ts). Level 1 sits at y = 0; deeper levels stack downward.

import * as THREE from 'three';
import { hexToWorld, type Hex, type Pos } from '../game/hex';

export const HEX = 1;
export const LEVEL_GAP = 9;
/** Height of the walkable top of a plain floor tile. */
export const FLOOR_TOP = 0.18;
export const RAISED_TOP = 0.62;
/** 15.8: walls stand about a hero's height (heroes are ~2.6), so thin panels still read as walls. */
export const WALL_HEIGHT = 2.2;
/** Thickness of a thin wall panel (15.8). */
export const WALL_THICK = 0.24;

export function levelY(level: number): number {
  return -(level - 1) * LEVEL_GAP;
}

export function hexCenter(h: Hex, level: number, lift = FLOOR_TOP, out = new THREE.Vector3()): THREE.Vector3 {
  const w = hexToWorld(h, HEX);
  return out.set(w.x, levelY(level) + lift, w.z);
}

export function posCenter(p: Pos, lift = FLOOR_TOP, out = new THREE.Vector3()): THREE.Vector3 {
  return hexCenter(p, p.level, lift, out);
}

/** Small deterministic hash for visual jitter (not game randomness). */
export function hash2(x: number, y: number, s = 0): number {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export const COLORS = {
  void: 0x050404,
  stone: 0x6e645a,
  /** Pale wall caps: clearly lighter than any floor. */
  wallCap: 0xd8cfbe,
  stoneLight: 0x7a6f62,
  stoneDark: 0x2c2722,
  floor: 0x6a5e50,
  raised: 0x7d6f5c,
  rock: 0x1b1816,
  wood: 0x6b4426,
  woodDark: 0x3d2615,
  iron: 0x3b3a3d,
  ember: 0xe8a33d,
  emberHot: 0xffb35c,
  fire: 0xff7a1f,
  parchment: 0xefe4cf,
  danger: 0xff1f2d,
  cold: 0x6f8fc8,
  orc: 0x3f5a2c,
  steel: 0x8d9095,
  steelDark: 0x55585e,
  gold: 0xd9a93a,
  gem: 0x4fd0c8,
  pitGlow: 0x5a2a8a,
  moss: 0x3f4a2c,
};

/** Banner colour per hero class (heroes share class colours; Hobart is gold). */
export const CLASS_COLORS: Record<string, number> = {
  hobart: 0xd9a93a,
  sellsword: 0xb03a2e,
  burglar: 0x3b9a4a,
  mage: 0x8a4cc9,
  ranger: 0x8fbf3a,
  sapper: 0xe08a2a,
  pyromancer: 0xff5a1a,
  shadowmancer: 0x7a4cff,
  hedgewitch: 0x5ad08a,
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
