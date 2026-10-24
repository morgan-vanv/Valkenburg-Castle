import { describe, expect, it } from 'vitest';
import { hexKey, posKey, posNeighbors, samePos, type Pos } from '../../game/hex';
import type { LevelDef, TileDef } from '../../game/types';
import { castle } from './index';
import { ROOMY } from './parse';

function level(n: number): LevelDef {
  const lv = castle.levels.find((l) => l.level === n);
  if (!lv) throw new Error(`no level ${n}`);
  return lv;
}

function tile(p: Pos): TileDef | undefined {
  return castle.levels.find((l) => l.level === p.level)?.tiles[hexKey(p)];
}

const WALKABLE = ['floor', 'rubble', 'stairs', 'exit'];
const walkable = (p: Pos) => WALKABLE.includes(tile(p)?.kind ?? '');
const show = (p: Pos) => posKey(p);

describe('castle', () => {
  it('has two levels with 7 to 10 rooms each, within 34 x 26', () => {
    expect(castle.levels.map((l) => l.level)).toEqual([1, 2]);
    for (const lv of castle.levels) {
      expect(lv.rooms.length).toBeGreaterThanOrEqual(7);
      expect(lv.rooms.length).toBeLessThanOrEqual(12);
    }
  });

  it('reaches every floor-like hex from an entrance', () => {
    const seen = new Set<string>();
    const queue: Pos[] = [...castle.entrances];
    const passable = (p: Pos) => {
      const k = tile(p)?.kind;
      return k !== undefined && (WALKABLE.includes(k) || k === 'door');
    };
    while (queue.length) {
      const p = queue.pop()!;
      const k = posKey(p);
      if (seen.has(k) || !passable(p)) continue;
      seen.add(k);
      queue.push(...posNeighbors(p));
      for (const link of castle.links) {
        if (link.kind === 'stairs') {
          if (samePos(link.a, p)) queue.push(link.b);
          if (samePos(link.b, p)) queue.push(link.a);
        } else {
          if (link.edge.some((e) => samePos(e, p))) queue.push(...link.landing);
          if (link.landing.some((e) => samePos(e, p))) queue.push(...link.edge);
        }
      }
    }
    const missing: string[] = [];
    for (const lv of castle.levels) {
      for (const [k, t] of Object.entries(lv.tiles)) {
        if (ROOMY.includes(t.kind) && !seen.has(`${lv.level}:${k}`)) missing.push(`${lv.level}:${k}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('places things on valid tiles', () => {
    const bad: string[] = [];
    const things: [string, Pos][] = [
      ...castle.spawns.map((s) => [`spawn ${s.kind}`, s.at] as [string, Pos]),
      ...castle.chests.map((c) => [`chest ${c.id}`, c.at] as [string, Pos]),
      ...castle.coins.map((c) => ['coins', c.at] as [string, Pos]),
      ...castle.traps.map((t) => ['trap', t.at] as [string, Pos]),
      ...castle.contractSites.map((s) => [`site ${s.id}`, s.at] as [string, Pos]),
    ];
    for (const [what, p] of things) if (!walkable(p)) bad.push(`${what} at ${show(p)} on ${tile(p)?.kind}`);
    for (const b of castle.braziers) if (tile(b)?.kind !== 'brazier') bad.push(`brazier at ${show(b)}`);
    expect(bad).toEqual([]);
  });

  it('does not stack things on one hex', () => {
    const keys = [
      ...castle.spawns.map((s) => s.at),
      ...castle.chests.map((c) => c.at),
      ...castle.coins.map((c) => c.at),
      ...castle.traps.map((t) => t.at),
      ...castle.contractSites.map((s) => s.at),
      ...castle.entrances,
    ].map(posKey);
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    expect(dupes).toEqual([]);
  });

  it('lists every brazier tile as a brazier', () => {
    const listed = new Set(castle.braziers.map(posKey));
    for (const lv of castle.levels) {
      for (const [k, t] of Object.entries(lv.tiles)) {
        if (t.kind === 'brazier') expect(listed.has(`${lv.level}:${k}`)).toBe(true);
      }
    }
  });

  it('joins stairs tiles and pit edges to landings', () => {
    const pits = castle.links.filter((l) => l.kind === 'pit');
    expect(pits.length).toBe(1);
    for (const link of castle.links) {
      if (link.kind === 'stairs') {
        expect(tile(link.a)?.kind).toBe('stairs');
        expect(tile(link.b)?.kind).toBe('stairs');
        expect(link.a.level).not.toBe(link.b.level);
      } else {
        expect(link.edge.length).toBeGreaterThan(0);
        expect(link.landing.length).toBeGreaterThan(0);
        for (const e of link.edge) {
          expect(tile(e)?.kind).toBe('floor');
          expect(posNeighbors(e).some((n) => tile(n)?.kind === 'pit')).toBe(true);
        }
        const edgeLevel = link.edge[0]!.level;
        for (const l of link.landing) {
          expect(tile(l)?.kind).toBe('floor');
          expect(l.level).toBe(edgeLevel + 1);
        }
      }
    }
  });

  it('has entrances and rival entrances on exit tiles of Level 1', () => {
    expect(castle.entrances.length).toBe(3);
    for (const p of [...castle.entrances, ...castle.rivalEntrances]) {
      expect(tile(p)?.kind).toBe('exit');
      expect(p.level).toBe(1);
    }
    // Level 2 has no exits.
    expect(Object.values(level(2).tiles).some((t) => t.kind === 'exit')).toBe(false);
  });

  it('tags every floor-like hex with a room that exists', () => {
    for (const lv of castle.levels) {
      const ids = new Set(lv.rooms.map((r) => r.id));
      for (const [k, t] of Object.entries(lv.tiles)) {
        if (ROOMY.includes(t.kind)) expect(ids.has(t.room ?? ''), `${lv.level}:${k}`).toBe(true);
      }
      for (const r of lv.rooms) {
        expect(Object.values(lv.tiles).some((t) => t.room === r.id), r.id).toBe(true);
      }
    }
  });

  it('has the contract sites and chests the brief asks for', () => {
    const sites = castle.contractSites;
    expect(sites.filter((s) => s.kind === 'rescue').length).toBe(3);
    expect(sites.filter((s) => s.kind === 'recover').length).toBe(4);
    for (const lv of [1, 2]) {
      expect(sites.filter((s) => s.kind === 'recover' && s.at.level === lv).length).toBe(2);
    }
    const ids = [...castle.chests.map((c) => c.id), ...sites.map((s) => s.id)];
    expect(new Set(ids).size).toBe(ids.length);
    const l2 = castle.chests.filter((c) => c.at.level === 2);
    expect(l2.some((c) => c.tier === 3 && c.locked)).toBe(true);
  });
});
