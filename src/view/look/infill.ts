// V5.4: what fills the hexes the castle data leaves empty (docs/decisions.md, 2026-11-06).
//
// A level's tiles are only the rooms, corridors and the walls around them. Everything else used to be the
// scene's black, so two walls a hex apart had a void between them and the outer walls stood on nothing.
// Every empty hex within `INFILL.band` of a tile is now one of three things:
//   - a pocket: empty hexes the outside can't reach without crossing a tile (between two rooms' walls).
//     Solid masonry to the wall's height, so a double wall reads as one thick wall.
//   - outside, on Level 1: the ground the castle stands on, at floor level, darkening away from the walls.
//   - outside, underground (Level 2 and down): bedrock to the wall's height, rough, darkening outward.
//   - a chasm: a pocket that touches a pit (the gaps where the Hollow meets its walls). Left open, so the
//     drop reads as one hole and the level below shows through it like through the pits.
// Each fill hex is fogged by the nearest tiles, so it shows when the walls beside it do and never maps
// anything the party hasn't seen. The view only: the rules never see these hexes.

import * as THREE from 'three';
import { DIRS, add, hexKey, type Hex } from '../../game/hex';
import type { TileDef } from '../../game/types';
import { hash2 } from '../world';

export const INFILL = {
  /** How far past the outermost tiles the fill reaches. */
  band: 5,
  /** Pocket masonry and bare wall mass. */
  mass: 0x4a4449,
  /** Level 1's ground outside the walls: dark packed earth. */
  ground: 0x4a4339,
  /** Underground bedrock outside the level. */
  bedrock: 0x3e3940,
  /** The ground sits this far under the floor tiles' top, so it never reads as floor. */
  groundDrop: 0.14,
};

export type InfillKind = 'pocket' | 'ground' | 'bedrock' | 'chasm';

export interface InfillHex {
  h: Hex;
  kind: InfillKind;
  /** Hexes from the nearest tile (1 = touching one). */
  d: number;
  /** The nearest tiles: the fill shows when any of them (or their neighbours) is seen. */
  near: Hex[];
}

export interface Infill {
  hexes: InfillHex[];
  /** hexKeys of fill hexes that stand to the wall's height (pockets and bedrock). */
  massKeys: Set<string>;
  /** hexKeys of the chasm hexes (open, drawn as part of the pits beside them). */
  chasm: Set<string>;
}

/**
 * Classify the empty hexes around one level. `underground` levels get bedrock outside, the rest ground.
 * Pockets are found by flooding the empty hexes inward from the band's outer edge: whatever the flood
 * never reaches is enclosed.
 */
export function buildInfill(tiles: Readonly<Record<string, TileDef>>, underground: boolean): Infill {
  const band = INFILL.band;
  // Distance from the tiles, by breadth-first rings, and the nearest tiles of each empty hex.
  const dist = new Map<string, number>();
  const near = new Map<string, Hex[]>();
  const empty: Hex[] = [];
  let ring: { h: Hex; near: Hex[] }[] = [];
  for (const k of Object.keys(tiles)) {
    dist.set(k, 0);
    const [q, r] = k.split(',').map(Number) as [number, number];
    ring.push({ h: { q, r }, near: [{ q, r }] });
  }
  for (let d = 1; d <= band + 1; d++) {
    const next = new Map<string, { h: Hex; near: Hex[] }>();
    for (const { h, near: n0 } of ring) {
      for (const dir of DIRS) {
        const nb = add(h, dir);
        const k = hexKey(nb);
        const seen = dist.get(k);
        if (seen !== undefined && seen < d) continue;
        const cur = next.get(k);
        if (cur) {
          for (const t of n0) if (cur.near.length < 4 && !cur.near.some((x) => x.q === t.q && x.r === t.r)) cur.near.push(t);
        } else {
          dist.set(k, d);
          next.set(k, { h: nb, near: n0.slice(0, 4) });
        }
      }
    }
    ring = [...next.values()];
    for (const { h, near: n } of ring) {
      near.set(hexKey(h), n);
      if (d <= band) empty.push(h);
    }
  }
  // Flood the outside from the ring just past the band (d = band + 1), through empty hexes only.
  const outside = new Set<string>();
  const stack: Hex[] = ring.map((x) => x.h);
  for (const h of stack) outside.add(hexKey(h));
  while (stack.length) {
    const h = stack.pop()!;
    for (const dir of DIRS) {
      const nb = add(h, dir);
      const k = hexKey(nb);
      if (outside.has(k) || tiles[k] || !dist.has(k)) continue;
      outside.add(k);
      stack.push(nb);
    }
  }
  // Pockets that touch a pit, through empty hexes, are part of the drop.
  const isPocket = (k: string) => !outside.has(k) && !tiles[k] && dist.has(k);
  const chasm = new Set<string>();
  for (const h of empty) {
    const k0 = hexKey(h);
    if (!isPocket(k0) || chasm.has(k0) || !DIRS.some((d) => tiles[hexKey(add(h, d))]?.kind === 'pit')) continue;
    const st = [h];
    chasm.add(k0);
    while (st.length) {
      const x = st.pop()!;
      for (const d of DIRS) {
        const nb = add(x, d);
        const k = hexKey(nb);
        if (chasm.has(k) || !isPocket(k)) continue;
        chasm.add(k);
        st.push(nb);
      }
    }
  }
  // A pocket shows as one block: every hex of it takes the nearest tiles of the whole pocket, so it fogs evenly.
  const pocketNear = new Map<string, Hex[]>();
  for (const h of empty) {
    const k0 = hexKey(h);
    if (!isPocket(k0) || chasm.has(k0) || pocketNear.has(k0)) continue;
    const members: string[] = [k0];
    const all = new Map<string, Hex>();
    const st = [h];
    pocketNear.set(k0, []);
    while (st.length) {
      const x = st.pop()!;
      for (const t of near.get(hexKey(x)) ?? []) all.set(hexKey(t), t);
      for (const d of DIRS) {
        const nb = add(x, d);
        const k = hexKey(nb);
        if (pocketNear.has(k) || !isPocket(k) || chasm.has(k)) continue;
        pocketNear.set(k, []);
        members.push(k);
        st.push(nb);
      }
    }
    const list = [...all.values()];
    for (const k of members) pocketNear.set(k, list);
  }
  const out: Infill = { hexes: [], massKeys: new Set(), chasm };
  for (const h of empty) {
    const k = hexKey(h);
    const kind: InfillKind = chasm.has(k) ? 'chasm' : !outside.has(k) ? 'pocket' : underground ? 'bedrock' : 'ground';
    out.hexes.push({ h, kind, d: dist.get(k)!, near: (kind === 'pocket' ? pocketNear.get(k) : near.get(k)) ?? [] });
    if (kind === 'pocket' || kind === 'bedrock') out.massKeys.add(k);
  }
  return out;
}

/** How dark a fill hex is drawn: pockets keep full tone; the outside fades toward black away from the walls. */
export function infillFade(x: InfillHex): number {
  if (x.kind === 'pocket') return 1;
  const t = (x.d - 1) / INFILL.band;
  return Math.max(0.08, Math.pow(1 - t, 1.6));
}

/** A fill hex's colour, with a little per-hex variation. */
export function infillColor(x: InfillHex): THREE.Color {
  const base = x.kind === 'pocket' ? INFILL.mass : x.kind === 'ground' ? INFILL.ground : INFILL.bedrock;
  const j = hash2(x.h.q, x.h.r, 71);
  // Pockets barely vary, so a block of them reads as one mass; the rough outside varies more.
  const v = x.kind === 'pocket' ? 0.06 : 0.24;
  return new THREE.Color(base).multiplyScalar((1 - v / 2 + j * v) * infillFade(x));
}
