import { describe, expect, it } from 'vitest';
import { fitMap, hexCorner, loopsPath, traceLoops } from './setout-map';

describe('Set out map: boundary tracing', () => {
  it('one hex is one loop of its 6 corners', () => {
    const loops = traceLoops(['0,0']);
    expect(loops).toHaveLength(1);
    expect(loops[0]).toHaveLength(6);
    for (let i = 0; i < 6; i++) {
      const c = hexCorner(0, 0, i);
      expect(loops[0]!.some((p) => Math.abs(p.x - c.x) < 1e-6 && Math.abs(p.y - c.y) < 1e-6)).toBe(true);
    }
  });

  it('two neighbours share an edge: one loop of 10 corners', () => {
    const loops = traceLoops(['0,0', '1,0']);
    expect(loops).toHaveLength(1);
    expect(loops[0]).toHaveLength(10);
  });

  it('a ring of six is an outer loop (18 corners) and a hole (6 corners)', () => {
    const ring = ['1,0', '1,-1', '0,-1', '-1,0', '-1,1', '0,1'];
    const loops = traceLoops(ring).map((l) => l.length).sort((a, b) => a - b);
    expect(loops).toEqual([6, 18]);
  });

  it('two hexes apart are two loops; the filled ring is one', () => {
    expect(traceLoops(['0,0', '5,0'])).toHaveLength(2);
    expect(traceLoops(['0,0', '1,0', '1,-1', '0,-1', '-1,0', '-1,1', '0,1'])).toHaveLength(1);
  });

  it('paths and fits: one M per loop, the map inside the board', () => {
    const fit = fitMap([{ q: 0, r: 0 }, { q: 10, r: 6 }], 1202, 660);
    const d = loopsPath(traceLoops(['0,0', '5,0']), fit.px);
    expect(d.match(/M/g)).toHaveLength(2);
    for (const [q, r] of [[0, 0], [10, 6]] as const) {
      const p = fit.at(q, r);
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(1202);
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(660);
    }
  });
});
