import { describe, expect, it } from 'vitest';
import { at, cellAt, edgeKindAt, label, neighbours, sameSquare, squareKey } from '../../engine/geometry';
import type { CastleMap, Coord, LevelId } from '../../engine/types';
import { CLASSIC_LEVEL_SPECS, classicCastle } from './classic';
import { formatLevel, markerAt, parseLevel, type LevelSpec } from './parse';

const tiny: LevelSpec = {
  id: 1,
  name: 'Tiny',
  x0: 2,
  width: 3,
  height: 2,
  grid: [
    '+-+-+-+', //
    '|E .d.|',
    '+ +L+-+',
    '|. .|#|',
    '+-+-+-+',
  ],
  entrances: ['C-1'],
};

describe('parseLevel', () => {
  it('parses a tiny level', () => {
    const lv = parseLevel(tiny);
    expect(lv.cells).toEqual(['floor', 'floor', 'floor', 'floor', 'floor', 'rock']);
    expect(lv.entrances).toEqual([{ level: 1, x: 2, y: 0 }]);
    const map: CastleMap = { name: 't', levels: [lv], links: [] };
    expect(edgeKindAt(map, at(1, 'C-1'), 'e')).toBe('open');
    expect(edgeKindAt(map, at(1, 'D-1'), 'e')).toBe('door');
    expect(edgeKindAt(map, at(1, 'D-1'), 's')).toBe('locked');
    expect(edgeKindAt(map, at(1, 'C-1'), 's')).toBe('open');
    expect(edgeKindAt(map, at(1, 'D-2'), 'e')).toBe('wall');
  });

  it('round-trips through formatLevel', () => {
    const lv = parseLevel(tiny);
    const again = parseLevel({ ...tiny, grid: formatLevel(lv).map((l, i) => (i === 1 ? l.replace('|.', '|E') : l)) });
    expect(again).toEqual(lv);
    for (const spec of CLASSIC_LEVEL_SPECS) {
      const parsed = parseLevel(spec);
      const lines = formatLevel(parsed);
      const original = typeof spec.grid === 'string' ? spec.grid.trim().split('\n') : spec.grid;
      // Same edges and cell kinds; only feature markers differ.
      expect(lines.map((l) => l.replace(/[GSXECBDH]/g, '.'))).toEqual(original.map((l) => l.replace(/[GSXECBDH]/g, '.')));
    }
  });

  it('accepts the grid as one string', () => {
    const lv = parseLevel({ ...tiny, grid: `\n${(tiny.grid as string[]).join('\n')}\n` });
    expect(lv.width).toBe(3);
  });

  const bad = (patch: Partial<LevelSpec>, msg: RegExp) => expect(() => parseLevel({ ...tiny, ...patch })).toThrow(msg);
  const g = tiny.grid as string[];

  it('rejects a wrong line count', () => bad({ grid: g.slice(0, 4) }, /expected 5 lines, found 4/));
  it('rejects a wrong line length', () => bad({ grid: [g[0]!, g[1]! + ' ', g[2]!, g[3]!, g[4]!] }, /line 2: expected 7 characters, found 8/));
  it('rejects an open outer border', () => bad({ grid: [g[0]!, ' E .d.|', g[2]!, g[3]!, g[4]!] }, /line 2, column 1: outer border left of C-1/));
  it('rejects an open edge next to rock', () => bad({ grid: [g[0]!, g[1]!, g[2]!, '|. . #|', g[4]!] }, /line 4, column 5: edge left of E-2 touches rock/));
  it('rejects unknown characters', () => bad({ grid: [g[0]!, g[1]!, g[2]!, '|. .|?|', g[4]!] }, /unknown cell character "\?" for square E-2/));
  it('rejects a marker missing from its list', () => bad({ entrances: [] }, /marker "E" on C-1 is missing from entrances/));
  it('rejects a listed square without its marker', () => bad({ guardrooms: ['D-1'] }, /guardrooms lists D-1 but the grid has "\." there, not "G"/));
  it('rejects a feature on rock', () => bad({ guardrooms: ['E-2'] }, /guardrooms: square E-2 is not floor/));
  it('rejects a feature outside the level', () => bad({ entrances: ['C-1', 'A-1'] }, /entrances: square A-1 is outside the level/));
});

// ------------------------------------------------------------------ classic map

const lvl = (id: LevelId) => classicCastle.levels.find((l) => l.id === id)!;
const labels = (cs: Coord[]) => cs.map(label).sort();

describe('classicCastle', () => {
  it('has levels 1-3 with the 1980 sizes and columns', () => {
    expect(classicCastle.levels.map((l) => [l.id, l.x0, l.width, l.height])).toEqual([
      [1, 0, 16, 12],
      [2, 0, 16, 12],
      [3, 5, 16, 12],
    ]);
  });

  it('puts every link end on floor, at the same letter and row, marked on the grid', () => {
    expect(classicCastle.links.length).toBe(6);
    for (const l of classicCastle.links) {
      expect(cellAt(classicCastle, l.a)).toBe('floor');
      expect(cellAt(classicCastle, l.b)).toBe('floor');
      expect([l.a.x, l.a.y]).toEqual([l.b.x, l.b.y]);
      expect(Math.abs(l.a.level - l.b.level)).toBe(1);
      const ch = l.kind === 'stairs' ? 'S' : 'X';
      for (const c of [l.a, l.b]) expect(markerAt(CLASSIC_LEVEL_SPECS[c.level - 1]!, label(c))).toBe(ch);
    }
  });

  it('marks every stairs and ladder square on the grid with a link or a reinforcement point', () => {
    for (const spec of CLASSIC_LEVEL_SPECS) {
      const lv = lvl(spec.id);
      for (let y = 0; y < lv.height; y++) {
        for (let x = lv.x0; x < lv.x0 + lv.width; x++) {
          const c: Coord = { level: lv.id, x, y };
          const ch = markerAt(spec, label(c));
          if (ch !== 'S' && ch !== 'X') continue;
          const linked = classicCastle.links.some((l) => sameSquare(l.a, c) || sameSquare(l.b, c));
          const reinf = lv.reinforcementPoints.some((r) => sameSquare(r, c));
          expect(linked || reinf, `${label(c)} on level ${lv.id}`).toBe(true);
        }
      }
    }
  });

  it('matches the facts in the 1980 rules', () => {
    // 4.6: entrances
    expect(labels(lvl(1).entrances)).toEqual(['A-7', 'F-12', 'H-1']);
    expect(labels(lvl(3).entrances)).toEqual(['U-5', 'U-6', 'U-7', 'U-8']);
    // 5.11 and 4.52: stairs C-12 and F-4 between levels 1 and 2
    const has = (kind: string, a: Coord, b: Coord) =>
      classicCastle.links.some((l) => l.kind === kind && ((sameSquare(l.a, a) && sameSquare(l.b, b)) || (sameSquare(l.a, b) && sameSquare(l.b, a))));
    expect(has('stairs', at(1, 'C-12'), at(2, 'C-12'))).toBe(true);
    expect(has('stairs', at(1, 'F-4'), at(2, 'F-4'))).toBe(true);
    // 5.11: C-12 is next to B-12 on level 1 and D-12 on level 2, through no wall
    expect(edgeKindAt(classicCastle, at(1, 'C-12'), 'w')).toBe('open');
    expect(edgeKindAt(classicCastle, at(1, 'C-12'), 'e')).toBe('wall');
    expect(edgeKindAt(classicCastle, at(2, 'C-12'), 'e')).toBe('open');
    expect(edgeKindAt(classicCastle, at(2, 'C-12'), 'w')).toBe('wall');
    // 4.52: G-4 -> F-4 on level 2; D-4 -> E-4 -> F-4 on level 1
    expect(edgeKindAt(classicCastle, at(2, 'G-4'), 'w')).toBe('open');
    expect(edgeKindAt(classicCastle, at(1, 'E-4'), 'w')).toBe('open');
    expect(edgeKindAt(classicCastle, at(1, 'E-4'), 'e')).toBe('open');
    // 5.11: A-3 and B-3 adjacent on level 1; A-4 only through a door to A-3; B-4 walled off
    expect(edgeKindAt(classicCastle, at(1, 'A-3'), 'e')).toBe('open');
    expect(edgeKindAt(classicCastle, at(1, 'A-3'), 's')).toBe('door');
    expect(edgeKindAt(classicCastle, at(1, 'B-4'), 'n')).toBe('wall');
    expect(edgeKindAt(classicCastle, at(1, 'B-4'), 'w')).toBe('wall');
    // 5.121: J-12/J-11 and O-12/O-11 on level 3 are open squares
    expect(edgeKindAt(classicCastle, at(3, 'J-12'), 'n')).toBe('open');
    expect(edgeKindAt(classicCastle, at(3, 'O-12'), 'n')).toBe('open');
    // 4.9: balcony J-5 and K-3; 12 pit squares on levels 1 and 2, L-5 among them
    const bal = labels(lvl(1).balcony);
    expect(bal).toContain('J-5');
    expect(bal).toContain('K-3');
    for (const id of [1, 2] as const) {
      expect(lvl(id).cells.filter((k) => k === 'pit').length).toBe(12);
      expect(cellAt(classicCastle, at(id, 'L-5'))).toBe('pit');
    }
    // Every pit square on level 1 has floor on level 3 below it.
    for (const id of [1] as const) {
      const lv = lvl(id);
      lv.cells.forEach((k, i) => {
        if (k !== 'pit') return;
        const below: Coord = { level: 3, x: (i % lv.width) + lv.x0, y: Math.floor(i / lv.width) };
        expect(cellAt(classicCastle, below)).toBe('floor');
      });
    }
    // Every balcony square touches the pit.
    for (const b of lvl(1).balcony) {
      expect(neighbours(classicCastle, b).some((n) => cellAt(classicCastle, n.to) === 'pit')).toBe(true);
    }
    // 8.6: lair, hoard, narrow openings
    expect(label(lvl(3).lair!)).toBe('S-7');
    expect(labels(lvl(3).hoard)).toEqual(['U-1', 'U-2']);
    for (const s of ['P-6', 'T-2', 'P-10']) expect(cellAt(classicCastle, at(3, s))).toBe('floor');
    // 9.1 and 3.4: guardrooms
    expect(labels(lvl(1).guardrooms)).toEqual(['A-2', 'C-10', 'H-5']);
    expect(lvl(2).guardrooms.length).toBe(1);
    expect(lvl(3).guardrooms.length).toBe(1);
    // Stairs down to level 4 become reinforcement points.
    expect(labels(lvl(2).reinforcementPoints)).toEqual(['D-1']);
    expect(labels(lvl(3).reinforcementPoints)).toEqual(['G-4', 'I-7']);
    expect(lvl(2).prisonCells.length).toBe(6);
  });

  it('lets you walk to every floor square from an entrance', () => {
    const seen = new Set<string>();
    const queue: Coord[] = [];
    const visit = (c: Coord) => {
      const k = squareKey(c);
      if (seen.has(k)) return;
      seen.add(k);
      queue.push(c);
    };
    for (const lv of classicCastle.levels) lv.entrances.forEach(visit);
    while (queue.length > 0) {
      const c = queue.shift()!;
      for (const n of neighbours(classicCastle, c)) {
        if (n.edge !== 'wall' && cellAt(classicCastle, n.to) === 'floor') visit(n.to);
      }
      for (const l of classicCastle.links) {
        if (sameSquare(l.a, c)) visit(l.b);
        if (sameSquare(l.b, c)) visit(l.a);
      }
    }
    const unreachable: string[] = [];
    for (const lv of classicCastle.levels) {
      for (let y = 0; y < lv.height; y++) {
        for (let x = lv.x0; x < lv.x0 + lv.width; x++) {
          const c: Coord = { level: lv.id, x, y };
          if (cellAt(classicCastle, c) === 'floor' && !seen.has(squareKey(c))) unreachable.push(`${lv.id}:${label(c)}`);
        }
      }
    }
    expect(unreachable).toEqual([]);
  });
});
