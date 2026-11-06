// V5.4: the infill between and around the castle's walls (look/infill.ts).
import { describe, expect, it } from 'vitest';
import { castle } from '../../data/castle';
import { DIRS, add, hexKey } from '../../game/hex';
import { buildInfill } from './infill';

const ax = (col: number, row: number) => ({ q: col - Math.floor(row / 2), r: row });

describe('infill', () => {
  const levels = castle.levels.map((lv) => ({ lv, fill: buildInfill(lv.tiles, lv.level >= 2) }));

  it('fills only hexes the castle leaves empty, once each', () => {
    for (const { lv, fill } of levels) {
      const keys = fill.hexes.map((x) => hexKey(x.h));
      expect(new Set(keys).size).toBe(keys.length);
      for (const k of keys) expect(lv.tiles[k]).toBeUndefined();
    }
  });

  it('Level 1 stands on ground outside; the levels below sit in bedrock', () => {
    const kinds = (n: number) => new Set(levels[n]!.fill.hexes.map((x) => x.kind));
    expect(kinds(0).has('ground')).toBe(true);
    expect(kinds(0).has('bedrock')).toBe(false);
    for (const n of [1, 2]) {
      expect(kinds(n).has('bedrock')).toBe(true);
      expect(kinds(n).has('ground')).toBe(false);
    }
  });

  it('the gap between the gate passage wall and the courtyard wall is a solid pocket', () => {
    const { fill } = levels[0]!;
    const x = fill.hexes.find((f) => hexKey(f.h) === hexKey(ax(19, 22)));
    expect(x?.kind).toBe('pocket');
    expect(fill.massKeys.has(hexKey(ax(19, 22)))).toBe(true);
  });

  it('a pocket never touches the outside, and a chasm always reaches a pit', () => {
    for (const { lv, fill } of levels) {
      const kind = new Map(fill.hexes.map((x) => [hexKey(x.h), x.kind] as const));
      for (const x of fill.hexes) {
        if (x.kind !== 'pocket') continue;
        for (const d of DIRS) {
          const k = hexKey(add(x.h, d));
          const nk = kind.get(k);
          expect(nk === 'ground' || nk === 'bedrock').toBe(false);
          expect(lv.tiles[k]?.kind === 'pit').toBe(false);
        }
      }
    }
    // The Hollow's gaps on Level 2 stay open.
    expect(levels[1]!.fill.chasm.size).toBeGreaterThan(0);
    expect(levels[0]!.fill.chasm.size).toBe(0);
  });

  it('every fill hex knows the tiles it fogs by', () => {
    for (const { lv, fill } of levels) for (const x of fill.hexes) {
      expect(x.near.length).toBeGreaterThan(0);
      for (const t of x.near) expect(lv.tiles[hexKey(t)]).toBeDefined();
    }
  });
});
