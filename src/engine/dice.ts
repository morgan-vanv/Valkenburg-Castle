// Seeded dice. The RNG state lives in GameState.rng so a whole run
// replays exactly from its seed. Same algorithm as src/rng.ts (mulberry32).

export interface RngHolder {
  rng: number;
}

export function random(s: RngHolder): number {
  s.rng = (s.rng + 0x6d2b79f5) >>> 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** 1..sides */
export function die(s: RngHolder, sides = 6): number {
  return 1 + Math.floor(random(s) * sides);
}

/** True with `percent` chance (0..100). */
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
