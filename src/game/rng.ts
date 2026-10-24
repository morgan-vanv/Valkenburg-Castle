// Seeded dice over GameState.rng (mulberry32 state, same algorithm as src/rng.ts).

export interface RngHolder {
  rng: number;
}

/** 0 <= x < 1, advances the holder's state. */
export function random(s: RngHolder): number {
  s.rng = (s.rng + 0x6d2b79f5) >>> 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Integer in [lo, hi], both included. */
export function int(s: RngHolder, lo: number, hi: number): number {
  return lo + Math.floor(random(s) * (hi - lo + 1));
}

export function die(s: RngHolder, sides = 6): number {
  return int(s, 1, sides);
}

export function chance(s: RngHolder, percent: number): boolean {
  return random(s) * 100 < percent;
}

export function pick<T>(s: RngHolder, items: readonly T[]): T {
  return items[Math.floor(random(s) * items.length)]!;
}

export function shuffle<T>(s: RngHolder, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random(s) * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}
