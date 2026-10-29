// V5.1 (W4): the Set out map's geometry, pure (no DOM), so it can be unit-tested. Ported from the mockup's generator:
// pointy-top hexes in world units (hexToWorld: x = √3(q + r/2), z = 1.5r, a hex is 1 from centre to corner), and the
// outline of a set of hexes traced into closed loops, so a whole region (all floor, all wall, all pit) is one SVG path
// that a hex pattern can fill, instead of hundreds of polygons.

import { hexToWorld, parseHexKey } from '../../game/hex';

export interface Pt {
  x: number;
  y: number;
}

/** Neighbour offsets, and for each the two corners (index i at angle 60i - 30°) of the shared edge, in loop order. */
const DIRS: readonly [number, number][] = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const EDGE: readonly [number, number][] = [[0, 1], [5, 0], [4, 5], [3, 4], [2, 3], [1, 2]];

/** Corner i of hex (q, r) in world units (x, z as y), radius `k` (1 = the true corner). */
export function hexCorner(q: number, r: number, i: number, k = 1): Pt {
  const c = hexToWorld({ q, r });
  const a = (Math.PI / 180) * (60 * i - 30);
  return { x: c.x + k * Math.cos(a), y: c.z + k * Math.sin(a) };
}

/** A corner's key: rounded to 1/1000, with -0 folded into 0 (else "-0.000" and "0.000" would not meet). */
const r3 = (v: number) => Math.round(v * 1000) / 1000 || 0;
const key = (p: Pt) => `${r3(p.x)},${r3(p.y)}`;

/**
 * The boundary of a set of hexes ("q,r" keys) as closed loops of world points (no repeated first point).
 * One hex is one 6-corner loop; a ring is an outer loop and an inner (hole) loop. Outer loops and holes wind
 * opposite ways, so either fill rule draws holes as holes.
 */
export function traceLoops(keys: Iterable<string>): Pt[][] {
  const set = new Set(keys);
  const edges = new Map<string, { to: string }[]>();
  const pts = new Map<string, Pt>();
  for (const k of set) {
    const { q, r } = parseHexKey(k);
    DIRS.forEach(([dq, dr], i) => {
      if (set.has(`${q + dq},${r + dr}`)) return;
      const [ia, ib] = EDGE[i]!;
      const a = hexCorner(q, r, ia);
      const b = hexCorner(q, r, ib);
      const ka = key(a);
      const kb = key(b);
      pts.set(ka, a);
      pts.set(kb, b);
      const list = edges.get(ka) ?? [];
      list.push({ to: kb });
      edges.set(ka, list);
    });
  }
  const out: Pt[][] = [];
  while (edges.size) {
    const start = edges.keys().next().value as string;
    let cur = start;
    const loop: Pt[] = [pts.get(start)!];
    for (;;) {
      const list = edges.get(cur);
      if (!list?.length) break;
      const n = list.pop()!;
      if (!list.length) edges.delete(cur);
      cur = n.to;
      if (cur === start) break;
      loop.push(pts.get(cur)!);
    }
    // Hex outlines always turn at a corner, but drop straight runs anyway (cheap, and safe for odd inputs).
    const q = loop.filter((b, i) => {
      const a = loop[(i + loop.length - 1) % loop.length]!;
      const c = loop[(i + 1) % loop.length]!;
      return Math.abs((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)) > 1e-6;
    });
    if (q.length >= 3) out.push(q);
  }
  return out;
}

/** Loops as one SVG path `d`, mapped through `px` (world → board px), rounded to 0.1 px. */
export function loopsPath(loops: Pt[][], px: (p: Pt) => Pt): string {
  return loops
    .map((l) => `M${l.map((p) => { const v = px(p); return `${v.x.toFixed(1)} ${v.y.toFixed(1)}`; }).join('L')}Z`)
    .join('');
}

export interface MapFit {
  /** Board px per world unit (= the hex radius in px). */
  s: number;
  /** World point → board px. */
  px(p: Pt): Pt;
  /** Hex centre → board px. */
  at(q: number, r: number): Pt;
}

/**
 * Fit hexes (and extra points, e.g. ways in just outside what is known) into a board of w × h px, keeping `pad`
 * around and `foot` px free along the bottom (the legend). Centred both ways; small maps stop growing at `maxS`.
 */
export function fitMap(hexes: { q: number; r: number }[], w: number, h: number, opts: { padX?: number; padY?: number; foot?: number; maxS?: number } = {}): MapFit {
  const padX = opts.padX ?? 40;
  const padY = opts.padY ?? 34;
  const foot = opts.foot ?? 30;
  const maxS = opts.maxS ?? 30;
  const ws = hexes.map((x) => hexToWorld(x));
  const S3 = Math.sqrt(3);
  const minX = Math.min(...ws.map((p) => p.x)) - S3 / 2;
  const maxX = Math.max(...ws.map((p) => p.x)) + S3 / 2;
  const minZ = Math.min(...ws.map((p) => p.z)) - 1;
  const maxZ = Math.max(...ws.map((p) => p.z)) + 1;
  const availW = w - 2 * padX;
  const availH = h - 2 * padY - foot;
  const s = Math.min(maxS, availW / Math.max(0.01, maxX - minX), availH / Math.max(0.01, maxZ - minZ));
  const ox = (w - (maxX - minX) * s) / 2 - minX * s;
  const oy = padY + (availH - (maxZ - minZ) * s) / 2 - minZ * s;
  const px = (p: Pt): Pt => ({ x: p.x * s + ox, y: p.y * s + oy });
  return { s, px, at: (q, r) => { const c = hexToWorld({ q, r }); return px({ x: c.x, y: c.z }); } };
}

/** Pointy-top hex polygon points (board px) for hex (q, r) at radius k (in hexes). */
export function hexPoints(fit: MapFit, q: number, r: number, k = 0.9): string {
  return [0, 1, 2, 3, 4, 5].map((i) => { const p = fit.px(hexCorner(q, r, i, k)); return `${p.x.toFixed(1)},${p.y.toFixed(1)}`; }).join(' ');
}
