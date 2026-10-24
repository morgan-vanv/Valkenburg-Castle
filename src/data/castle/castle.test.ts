import { describe, expect, it } from 'vitest';
import { distance, hexKey, posKey, posNeighbors, samePos, type Pos } from '../../game/hex';
import type { LevelDef, TileDef } from '../../game/types';
import { castle } from './index';

function level(n: number): LevelDef {
  const lv = castle.levels.find((l) => l.level === n);
  if (!lv) throw new Error(`no level ${n}`);
  return lv;
}

function tile(p: Pos): TileDef | undefined {
  return castle.levels.find((l) => l.level === p.level)?.tiles[hexKey(p)];
}

/** Tiles a figure can stand on. */
const STAND = ['floor', 'rubble', 'stairs', 'exit', 'lift'];
const standable = (p: Pos) => STAND.includes(tile(p)?.kind ?? '');
/** Tiles a figure can move through (doors open). */
const passable = (p: Pos) => standable(p) || tile(p)?.kind === 'door';
const show = (p: Pos) => posKey(p);

function allTiles(): [Pos, TileDef][] {
  return castle.levels.flatMap((lv) =>
    Object.entries(lv.tiles).map(([k, t]) => {
      const [q = 0, r = 0] = k.split(',').map(Number);
      return [{ level: lv.level, q, r }, t] as [Pos, TileDef];
    }),
  );
}

/**
 * Where a fall into pit `p` lands, as the engine does it: straight down to the
 * first non-pit tile; if that is solid (the Crossing's statue), the nearest
 * standable hex within 3 on that level. `direct` refuses the fallback.
 */
function fallTarget(p: Pos, direct = false): Pos | null {
  for (let lv = p.level + 1; lv <= castle.levels.length; lv++) {
    const below = { level: lv, q: p.q, r: p.r };
    const k = tile(below)?.kind;
    if (k === 'pit') continue;
    if (standable(below)) return below;
    if (direct || !k) return null;
    for (let d = 1; d <= 3; d++) {
      const ring = allTiles().filter(([q]) => q.level === lv && distance(q, below) === d && standable(q));
      if (ring.length) return ring[0]![0];
    }
    return null;
  }
  return null;
}

describe('castle', () => {
  it('has three levels with named rooms', () => {
    expect(castle.levels.map((l) => l.level)).toEqual([1, 2, 3]);
    for (const lv of castle.levels) {
      expect(lv.rooms.length).toBeGreaterThanOrEqual(7);
      for (const r of lv.rooms) {
        expect(r.name.length).toBeGreaterThan(0);
        expect(r.tint).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it('reaches every walkable hex from an entrance (stairs, lift and falls count)', () => {
    const seen = new Set<string>();
    const queue: Pos[] = [...castle.entrances];
    while (queue.length) {
      const p = queue.pop()!;
      const k = posKey(p);
      if (seen.has(k)) continue;
      if (!passable(p)) continue;
      seen.add(k);
      for (const n of posNeighbors(p)) {
        queue.push(n);
        // Jump into an adjacent pit: falls only go down.
        if (tile(n)?.kind === 'pit') {
          const to = fallTarget(n);
          if (to) queue.push(to);
        }
      }
      for (const link of castle.links) {
        if (samePos(link.a, p)) queue.push(link.b);
        if (samePos(link.b, p)) queue.push(link.a);
      }
    }
    const missing = allTiles()
      .filter(([p]) => passable(p) && !seen.has(posKey(p)))
      .map(([p]) => show(p));
    expect(missing).toEqual([]);
  });

  it('lets a hero get back out from every level without falling', () => {
    // Walking and links only (no falls): from every level an exit is reachable.
    const seen = new Set<string>();
    const queue: Pos[] = allTiles()
      .filter(([, t]) => t.kind === 'exit')
      .map(([p]) => p);
    while (queue.length) {
      const p = queue.pop()!;
      const k = posKey(p);
      if (seen.has(k) || !passable(p)) continue;
      seen.add(k);
      queue.push(...posNeighbors(p));
      for (const link of castle.links) {
        if (samePos(link.a, p)) queue.push(link.b);
        if (samePos(link.b, p)) queue.push(link.a);
      }
    }
    for (const lv of [1, 2, 3]) expect([...seen].some((k) => k.startsWith(`${lv}:`)), `level ${lv}`).toBe(true);
  });

  it('places things on valid tiles', () => {
    const bad: string[] = [];
    const things: [string, Pos][] = [
      ...castle.spawns.map((s) => [`spawn ${s.kind}`, s.at] as [string, Pos]),
      ...castle.chests.map((c) => [`chest ${c.id}`, c.at] as [string, Pos]),
      ...castle.coins.map((c) => ['coins', c.at] as [string, Pos]),
      ...castle.contractSites.map((s) => [`site ${s.id}`, s.at] as [string, Pos]),
    ];
    for (const [what, p] of things) if (tile(p)?.kind !== 'floor') bad.push(`${what} at ${show(p)} on ${tile(p)?.kind}`);
    for (const t of castle.traps) {
      const k = tile(t.at)?.kind;
      if (k !== 'floor') bad.push(`trap at ${show(t.at)} on ${k}`);
      if (tile(t.at)?.room === 'bridges' || tile(t.at)?.room === 'crossing') bad.push(`trap on a bridge at ${show(t.at)}`);
    }
    for (const b of castle.braziers) if (tile(b)?.kind !== 'brazier') bad.push(`brazier at ${show(b)}`);
    for (const p of [...castle.entrances, ...castle.rivalEntrances]) {
      if (tile(p)?.kind !== 'exit' || p.level !== 1) bad.push(`entrance at ${show(p)}`);
    }
    expect(bad).toEqual([]);
  });

  it('lists every brazier tile as a brazier', () => {
    const listed = new Set(castle.braziers.map(posKey));
    for (const [p, t] of allTiles()) if (t.kind === 'brazier') expect(listed.has(posKey(p)), show(p)).toBe(true);
  });

  it('does not stack two placements on one hex (the slay site sits on the Dragon)', () => {
    const dragon = castle.spawns.find((s) => s.kind === 'dragon')!;
    const keys = [
      ...castle.spawns.map((s) => s.at),
      ...castle.chests.map((c) => c.at),
      ...castle.coins.map((c) => c.at),
      ...castle.traps.map((t) => t.at),
      ...castle.contractSites.filter((s) => s.kind !== 'slay').map((s) => s.at),
      ...castle.entrances,
    ].map(posKey);
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    expect(dupes).toEqual([]);
    const slay = castle.contractSites.filter((s) => s.kind === 'slay');
    expect(slay.length).toBe(1);
    expect(samePos(slay[0]!.at, dragon.at)).toBe(true);
  });

  it('joins links at matching tiles on the same (q, r)', () => {
    const stairs = castle.links.filter((l) => l.kind === 'stairs');
    const lifts = castle.links.filter((l) => l.kind === 'lift');
    expect(stairs.length).toBe(1);
    expect(lifts.length).toBe(1);
    for (const link of castle.links) {
      expect(link.a.q).toBe(link.b.q);
      expect(link.a.r).toBe(link.b.r);
      expect(link.a.level).not.toBe(link.b.level);
      const kind = link.kind === 'stairs' ? 'stairs' : 'lift';
      expect(tile(link.a)?.kind).toBe(kind);
      expect(tile(link.b)?.kind).toBe(kind);
      if (link.kind === 'lift') {
        const w = tile(link.winch);
        expect(w?.kind).toBe('tallprop');
        expect(w?.prop).toBe('winch');
        expect(link.winch.level).toBe(Math.min(link.a.level, link.b.level));
        expect(distance(link.winch, link.a.level === link.winch.level ? link.a : link.b)).toBe(1);
      }
    }
    // Every stairs/lift tile is in a link.
    for (const [p, t] of allTiles()) {
      if (t.kind === 'stairs' || t.kind === 'lift') {
        expect(castle.links.some((l) => samePos(l.a, p) || samePos(l.b, p)), show(p)).toBe(true);
      }
    }
  });

  it('lands every pit column on L1 and L2 somewhere walkable below', () => {
    const bad: string[] = [];
    for (const [p, t] of allTiles()) {
      if (t.kind !== 'pit') continue;
      if (!fallTarget(p)) bad.push(show(p));
    }
    expect(bad).toEqual([]);
    // Only the Crossing's statue (under the L1 pit mouth) stops a fall short of a direct landing.
    const indirect = allTiles().filter(([p, t]) => t.kind === 'pit' && !fallTarget(p, true));
    for (const [p] of indirect) expect(tile({ ...p, level: 2 })?.prop, show(p)).toBe('statue');
    // L1's pit mouth lands partly on L2's bridges.
    const onBridge = allTiles().filter(([p, t]) => t.kind === 'pit' && p.level === 1 && fallTarget(p)?.level === 2);
    expect(onBridge.length).toBeGreaterThan(0);
    // The L2 collapsed floor drops into the Drain.
    const drops = allTiles().filter(([p, t]) => t.kind === 'pit' && p.level === 2 && tile(fallTarget(p)!)?.room === 'drain');
    expect(drops.length).toBe(1);
  });

  it('puts railings only on floor next to a pit, in the amounts the brief asks for', () => {
    const rails = allTiles().filter(([, t]) => t.railing);
    for (const [p, t] of rails) {
      expect(t.kind, show(p)).toBe('floor');
      expect(posNeighbors(p).some((n) => tile(n)?.kind === 'pit'), show(p)).toBe(true);
      expect(['bridges', 'crossing', 'ledge-e', 'rim'].includes(t.room ?? ''), show(p)).toBe(false);
    }
    const l1 = rails.filter(([p]) => p.level === 1).length;
    expect(l1).toBeGreaterThanOrEqual(3);
    expect(l1).toBeLessThanOrEqual(5);
    expect(rails.some(([p]) => p.level === 3)).toBe(false);
  });

  it('places lights on valid hexes', () => {
    const bad: string[] = [];
    for (const L of castle.lights) {
      const t = tile(L.at);
      if (!t) bad.push(`${L.kind} at ${show(L.at)} off the map`);
      else if (L.kind === 'sconce' && t.kind !== 'wall') bad.push(`sconce at ${show(L.at)} on ${t.kind}`);
      else if ((L.kind === 'daylight' || L.kind === 'fungus' || L.kind === 'glow') && !standable(L.at)) bad.push(`${L.kind} at ${show(L.at)} on ${t.kind}`);
      else if (L.kind === 'fire' && L.radius === 1 && t.kind !== 'floor') bad.push(`vent at ${show(L.at)} on ${t.kind}`);
      if (L.kind === 'sconce' && !posNeighbors(L.at).some(standable)) bad.push(`sconce at ${show(L.at)} faces no floor`);
    }
    expect(bad).toEqual([]);
    // The forge burns: a fire light on its tallprop.
    const forge = allTiles().find(([, t]) => t.prop === 'forge')![0];
    expect(castle.lights.some((L) => L.kind === 'fire' && samePos(L.at, forge))).toBe(true);
    // Fire vents only in the Lair.
    for (const L of castle.lights.filter((x) => x.kind === 'fire' && x.radius === 1)) expect(tile(L.at)?.room).toBe('lair');
  });

  it('tags every walkable hex with a room that exists, and every room has hexes', () => {
    for (const lv of castle.levels) {
      const ids = new Set(lv.rooms.map((r) => r.id));
      for (const [k, t] of Object.entries(lv.tiles)) {
        if (STAND.includes(t.kind) || t.kind === 'prop' || t.kind === 'tallprop') expect(ids.has(t.room ?? ''), `${lv.level}:${k}`).toBe(true);
      }
      for (const r of lv.rooms) {
        expect(Object.values(lv.tiles).some((t) => t.room === r.id), r.id).toBe(true);
        expect(lv.tiles[hexKey(r.labelAt)]?.room, `label of ${r.id}`).toBe(r.id);
      }
    }
  });

  it('has props with a kind on every prop tile', () => {
    for (const [p, t] of allTiles()) {
      if (t.kind === 'prop' || t.kind === 'tallprop') expect(t.prop, show(p)).toBeDefined();
    }
  });

  it('has the exits, doors and sealed door the layout needs', () => {
    const exits = (lv: number) => Object.values(level(lv).tiles).filter((t) => t.kind === 'exit').length;
    expect(exits(1)).toBe(3);
    expect(exits(2)).toBe(0);
    expect(exits(3)).toBe(1);
    expect(Object.values(level(3).tiles).filter((t) => t.kind === 'sealed').length).toBe(1);
    expect(Object.values(level(1).tiles).some((t) => t.kind === 'door' && t.locked)).toBe(true);
    expect(Object.values(level(2).tiles).some((t) => t.kind === 'door' && t.locked)).toBe(true);
  });

  it('has the spawns, loot, traps and sites the brief asks for', () => {
    const on = (lv: number) => (x: { at: Pos }) => x.at.level === lv;
    const dragon = castle.spawns.filter((s) => s.kind === 'dragon');
    expect(dragon.length).toBe(1);
    expect(dragon[0]!.asleep ?? true).toBe(true);
    expect(tile(dragon[0]!.at)?.room).toBe('lair');
    expect(castle.spawns.some((s) => s.name === 'Grub the Jailer' && s.asleep === false)).toBe(true);
    expect(castle.spawns.some((s) => s.name === 'Ugluk Red-Hand' && s.kind === 'berserker')).toBe(true);
    for (const lv of [1, 2, 3]) {
      expect(castle.traps.filter(on(lv)).length).toBe(2);
      expect(castle.coins.filter(on(lv)).length).toBeGreaterThan(0);
      expect(castle.chests.filter(on(lv)).length).toBeGreaterThan(0);
    }
    const coinAvg = (lv: number) => {
      const c = castle.coins.filter(on(lv));
      return c.reduce((n, x) => n + x.gold, 0) / c.length;
    };
    expect(coinAvg(2)).toBeGreaterThan(coinAvg(1));
    expect(coinAvg(3)).toBeGreaterThan(coinAvg(2));
    expect(castle.chests.filter(on(1)).every((c) => c.tier <= 2)).toBe(true);
    expect(castle.chests.filter(on(3)).every((c) => c.tier === 3)).toBe(true);
    const sites = castle.contractSites;
    const count = (kind: string, lv: number) => sites.filter((s) => s.kind === kind && s.at.level === lv).length;
    expect([count('rescue', 1), count('rescue', 2), count('rescue', 3)]).toEqual([1, 2, 1]);
    expect([count('recover', 1), count('recover', 2), count('recover', 3)]).toEqual([2, 2, 2]);
    const ids = [...castle.chests.map((c) => c.id), ...sites.map((s) => s.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });
});
