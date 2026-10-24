// Hex math for the V3 castle. Pointy-top hexes in axial coordinates (q, r).
// Pure functions, no DOM. See https://www.redblobgames.com/grids/hexagons/
// Authoring uses "odd-r" offset rows (col, row); convert with offsetToAxial.

export interface Hex {
  q: number;
  r: number;
}

/** A hex on a given castle level (1 = top). */
export interface Pos extends Hex {
  level: number;
}

export const DIRS: readonly Hex[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export function hexKey(h: Hex): string {
  return `${h.q},${h.r}`;
}

export function posKey(p: Pos): string {
  return `${p.level}:${p.q},${p.r}`;
}

export function parseHexKey(k: string): Hex {
  const [q = 0, r = 0] = k.split(',').map(Number);
  return { q, r };
}

export function parsePosKey(k: string): Pos {
  const [level = '0', rest = '0,0'] = k.split(':');
  return { level: Number(level), ...parseHexKey(rest) };
}

export function samePos(a: Pos, b: Pos): boolean {
  return a.level === b.level && a.q === b.q && a.r === b.r;
}

export function add(a: Hex, b: Hex): Hex {
  return { q: a.q + b.q, r: a.r + b.r };
}

export function neighbors(h: Hex): Hex[] {
  return DIRS.map((d) => add(h, d));
}

export function posNeighbors(p: Pos): Pos[] {
  return DIRS.map((d) => ({ level: p.level, q: p.q + d.q, r: p.r + d.r }));
}

/** Hex distance on one level. */
export function distance(a: Hex, b: Hex): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** Distance between positions; Infinity across levels. */
export function posDistance(a: Pos, b: Pos): number {
  return a.level === b.level ? distance(a, b) : Infinity;
}

/** All hexes within radius n of center (center included). */
export function range(center: Hex, n: number): Hex[] {
  const out: Hex[] = [];
  for (let dq = -n; dq <= n; dq++) {
    for (let dr = Math.max(-n, -dq - n); dr <= Math.min(n, -dq + n); dr++) {
      out.push({ q: center.q + dq, r: center.r + dr });
    }
  }
  return out;
}

function round(fq: number, fr: number): Hex {
  const fs = -fq - fr;
  let q = Math.round(fq);
  let r = Math.round(fr);
  const s = Math.round(fs);
  const dq = Math.abs(q - fq);
  const dr = Math.abs(r - fr);
  const ds = Math.abs(s - fs);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q, r };
}

/** Hexes on the straight line from a to b, both ends included. */
export function line(a: Hex, b: Hex): Hex[] {
  const n = distance(a, b);
  const out: Hex[] = [];
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0 : i / n;
    // Nudge to avoid ties on hex edges.
    out.push(round(a.q + (b.q - a.q) * t + 1e-6, a.r + (b.r - a.r) * t + 1e-6));
  }
  return out;
}

/** odd-r offset (col, row) to axial. */
export function offsetToAxial(col: number, row: number): Hex {
  return { q: col - (row - (row & 1)) / 2, r: row };
}

export function axialToOffset(h: Hex): { col: number; row: number } {
  return { col: h.q + (h.r - (h.r & 1)) / 2, row: h.r };
}

/** Center of a hex in world units (size = center-to-corner), x right, z down. */
export function hexToWorld(h: Hex, size = 1): { x: number; z: number } {
  return { x: size * Math.sqrt(3) * (h.q + h.r / 2), z: size * 1.5 * h.r };
}

export function worldToHex(x: number, z: number, size = 1): Hex {
  const q = ((Math.sqrt(3) / 3) * x - (1 / 3) * z) / size;
  const r = ((2 / 3) * z) / size;
  return round(q, r);
}
