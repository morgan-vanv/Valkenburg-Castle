// V5.0 (G): bevelled hex floor tiles with gaps (the Scale Lab's floor).
//
// Each walkable hex is a six-sided prism, 0.935 at the top and 0.975 at the foot, 0.26 deep, its top at
// FLOOR_TOP (figures stand on it as before) with a tiny sink and tilt per hex, and a colour jitter of
// about ±15%. A dark under-tile of the full hex shows through the gaps. The tiles keep the floor shader's
// material patterns (rug weave, planks, water) but not its engraved hex lines: the gap is the joint.

import * as THREE from 'three';
import type { Hex } from '../../game/hex';
import { hash2 } from '../world';

export const FLOOR_LOOK = {
  topR: 0.935,
  bottomR: 0.975,
  depth: 0.26,
  /** How far a tile may sink (never rise: feet stay on the floor). */
  sink: 0.02,
  /** Tilt jitter in radians. */
  tilt: 0.022,
  colorJitter: 0.15,
  /** Darkening applied to the level data's floor tints under the look's brighter fill. */
  shade: 0.78,
  under: 0x1a1418,
};

/** Vertex-shaded prism: top at y = 0, the sides darker so the gaps read as depth. */
export function bevelGeometry(topR = FLOOR_LOOK.topR, bottomR = FLOOR_LOOK.bottomR, depth = FLOOR_LOOK.depth, sideShade = 0.62): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(topR, bottomR, depth, 6, 1).toNonIndexed();
  g.translate(0, -depth / 2, 0);
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const up = nor.getY(i) > 0.9;
    const k = up ? 1 : sideShade;
    col[i * 3] = k;
    col[i * 3 + 1] = k;
    col[i * 3 + 2] = k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  return g;
}

/** The dark hex under every tile, showing through the gaps. */
export function underGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(1.0, 1.0, 0.12, 6, 1).toNonIndexed();
  g.translate(0, -0.06, 0);
  g.deleteAttribute('uv');
  return g;
}

export interface TileJitter {
  dy: number;
  tiltX: number;
  tiltZ: number;
  /** Colour multiplier. */
  shade: number;
}

export function tileJitter(h: Hex, level: number): TileJitter {
  const a = hash2(h.q, h.r, level + 41);
  const b = hash2(h.q, h.r, level + 42);
  const c = hash2(h.q, h.r, level + 43);
  const d = hash2(h.q, h.r, level + 44);
  return { dy: -a * FLOOR_LOOK.sink, tiltX: (b - 0.5) * 2 * FLOOR_LOOK.tilt, tiltZ: (c - 0.5) * 2 * FLOOR_LOOK.tilt, shade: FLOOR_LOOK.shade * (1 - FLOOR_LOOK.colorJitter / 2 + d * FLOOR_LOOK.colorJitter) };
}
