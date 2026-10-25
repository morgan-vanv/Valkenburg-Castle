// V3.7 presentation helpers (pure): facing, blind arcs, breakable walls, blast rings.
import { describe, expect, it } from 'vitest';
import { DIRS, hexKey } from '../game/hex';
import type { LevelDef } from '../game/types';
import { testCastle } from '../game/test/testCastle';
import { backDirs, blastRings, blindArc, blownWalls, breakableWall, dirIndexOf, facingOf } from './stealth';

/** A 9x9 open floor, so geometry can be checked without walls in the way. */
function openLevel(): LevelDef {
  const tiles: LevelDef['tiles'] = {};
  for (let q = -4; q <= 4; q++) for (let r = -4; r <= 4; r++) tiles[hexKey({ q, r })] = { kind: 'floor', room: 'a' };
  return { level: 1, name: 'open', tiles, rooms: [{ id: 'a', name: 'A', labelAt: { q: 0, r: 0 } }] };
}

describe('V3.7 presentation: stealth helpers', () => {
  it('dirIndexOf matches each DIRS step and keeps ties on the lower index', () => {
    DIRS.forEach((d, i) => expect(dirIndexOf(d.q, d.r)).toBe(i));
    DIRS.forEach((d, i) => expect(dirIndexOf(d.q * 3, d.r * 3)).toBe(i));
    // (1, 1) lies exactly between DIRS[0] (1,0) and DIRS[5] (0,1): the lower index wins.
    expect(dirIndexOf(1, 1)).toBe(0);
  });

  it('facingOf: undefined means watching all round; numbers wrap to 0..5', () => {
    expect(facingOf({})).toBeUndefined();
    expect(facingOf({ facing: 7 })).toBe(1);
    expect(facingOf({ facing: -1 })).toBe(5);
    expect(backDirs(0)).toEqual([2, 3, 4]);
  });

  it('blindArc: the three back directions, with the hex directly behind', () => {
    const lv = openLevel();
    const at = { level: 1, q: 0, r: 0 };
    const arc = blindArc(lv, at, 0, 3);
    const keys = new Set(arc.hexes.map((p) => hexKey(p)));
    // Directly behind (DIRS[3] = (-1,0)) and its neighbours are blind; the front is not.
    expect(arc.behind).toEqual({ level: 1, q: -1, r: 0 });
    expect(keys.has('-1,0')).toBe(true);
    expect(keys.has('-2,0')).toBe(true);
    expect(keys.has('0,-1')).toBe(true); // DIRS[2]
    expect(keys.has('-1,1')).toBe(true); // DIRS[4]
    expect(keys.has('1,0')).toBe(false);
    expect(keys.has('1,-1')).toBe(false);
    expect(keys.has('0,1')).toBe(false);
    expect(arc.hexes.every((p) => Math.max(Math.abs(p.q), Math.abs(p.r), Math.abs(p.q + p.r)) <= 3)).toBe(true);
  });

  it('blindArc stops at a wall on the straight line', () => {
    const lv = openLevel();
    lv.tiles['-1,0'] = { kind: 'wall' };
    const arc = blindArc(lv, { level: 1, q: 0, r: 0 }, 0, 3);
    expect(arc.behind).toBeNull();
    expect(arc.hexes.some((p) => p.q === -2 && p.r === 0)).toBe(false);
  });

  it('breakableWall: built walls between floors on L1/L2 only, not unbreakable or cave or Level 3', () => {
    const lv1 = testCastle.levels.find((l) => l.level === 1)!;
    const walls = Object.entries(lv1.tiles).filter(([, t]) => t.kind === 'wall').map(([k]) => ({ level: 1, ...parse(k) }));
    const breakable = walls.filter((w) => breakableWall(testCastle, w));
    expect(breakable.length).toBeGreaterThan(0);
    for (const w of breakable) {
      const open = DIRS.filter((d) => ['floor', 'rubble', 'door', 'stairs', 'exit', 'lift'].includes(lv1.tiles[hexKey({ q: w.q + d.q, r: w.r + d.r })]?.kind ?? '')).length;
      expect(open).toBeGreaterThanOrEqual(2);
    }
    const w0 = breakable[0]!;
    expect(breakableWall(testCastle, { ...w0, level: 3 })).toBe(false);
    const marked = { ...testCastle, levels: testCastle.levels.map((l) => (l.level === 1 ? { ...l, tiles: { ...l.tiles, [hexKey(w0)]: { ...l.tiles[hexKey(w0)]!, unbreakable: true } } } : l)) };
    expect(breakableWall(marked, w0)).toBe(false);
    const cave = { ...testCastle, levels: testCastle.levels.map((l) => (l.level === 1 ? { ...l, rooms: l.rooms.map((r) => ({ ...r, material: 'rock' as const })) } : l)) };
    expect(breakableWall(cave, w0)).toBe(false);
  });

  it('blastRings: within 1 (walls included), distance 2 without walls', () => {
    const lv = openLevel();
    lv.tiles['2,0'] = { kind: 'wall' };
    lv.tiles['1,0'] = { kind: 'wall' };
    const castle = { ...testCastle, levels: [lv] };
    const rings = blastRings(castle, { level: 1, q: 0, r: 0 });
    expect(rings.inner).toHaveLength(7);
    expect(rings.inner.some((p) => p.q === 1 && p.r === 0)).toBe(true);
    expect(rings.outer).toHaveLength(11);
    expect(rings.outer.some((p) => p.q === 2 && p.r === 0)).toBe(false);
  });

  it('blownWalls picks the built walls out of blown', () => {
    const lv1 = testCastle.levels.find((l) => l.level === 1)!;
    const wall = Object.entries(lv1.tiles).find(([, t]) => t.kind === 'wall')![0];
    const cracked = Object.entries(lv1.tiles).find(([, t]) => t.kind === 'cracked')?.[0];
    const blown = [`1:${wall}`, ...(cracked ? [`1:${cracked}`] : [])];
    const set = blownWalls(testCastle, blown);
    expect(set.has(`1:${wall}`)).toBe(true);
    if (cracked) expect(set.has(`1:${cracked}`)).toBe(false);
  });
});

function parse(k: string): { q: number; r: number } {
  const [q, r] = k.split(',').map(Number);
  return { q: q ?? 0, r: r ?? 0 };
}
