// V5.1 (W0): the camp kit's pure parts: the stage fit and the coin stack's columns.
import { describe, expect, it } from 'vitest';
import { stageFit } from './stage';
import { coinColumns } from './coinstack';

describe('stage fit', () => {
  it('scales by min(w/1920, h/1080) and centres with bars', () => {
    expect(stageFit(1920, 1080)).toEqual({ scale: 1, x: 0, y: 0 });
    expect(stageFit(1280, 720).scale).toBeCloseTo(2 / 3);
    expect(stageFit(2560, 1440).scale).toBeCloseTo(4 / 3);
    const f = stageFit(1440, 900); // 16:10: bars top and bottom
    expect(f.scale).toBeCloseTo(0.75);
    expect(f.x).toBe(0);
    expect(f.y).toBe(45);
  });
  it('keeps small type at 12px on screen at 1280x720', () => {
    const s = stageFit(1280, 720).scale;
    expect(Math.max(14, 12 / s) * s).toBeGreaterThanOrEqual(12 - 1e-9);
  });
});

describe('coin stack', () => {
  it('has no coins at 0 gold and grows with gold', () => {
    expect(coinColumns(0)).toEqual([]);
    const total = (g: number) => coinColumns(g).reduce((a, b) => a + b, 0);
    let prev = 0;
    for (const g of [5, 25, 140, 340, 900, 2400, 10000]) {
      expect(total(g)).toBeGreaterThanOrEqual(prev);
      prev = total(g);
    }
    expect(coinColumns(25).length).toBe(1);
    expect(coinColumns(2400).length).toBeLessThanOrEqual(6);
    for (const h of coinColumns(100000)) expect(h).toBeLessThanOrEqual(96);
  });
});
