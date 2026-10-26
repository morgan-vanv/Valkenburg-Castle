import { describe, expect, it } from 'vitest';
import { distance, hexKey, posKey, posNeighbors, samePos, type Pos } from '../../game/hex';
import type { LevelDef, TileDef } from '../../game/types';
import { castle } from './index';
import { STORIES } from '../../game/data';
import { World } from '../../game/world';
import { breakableWall } from '../../game/charges';

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

  it('puts the cutthroat posts on Level 2 floor (the Wake\'s on Level 3), off spawns, reachable on foot from an entrance (spec 18.5, 20.4)', () => {
    const posts = (castle.rivalPosts ?? []).filter((p) => p.level === 2);
    const posts3 = (castle.rivalPosts ?? []).filter((p) => p.level === 3);
    expect(posts.length).toBeGreaterThanOrEqual(3);
    expect(posts3.length).toBeGreaterThanOrEqual(2);
    const seen = new Set<string>();
    const queue: Pos[] = [...castle.entrances];
    while (queue.length) {
      const p = queue.pop()!;
      const k = posKey(p);
      if (seen.has(k) || !passable(p)) continue;
      seen.add(k);
      queue.push(...posNeighbors(p));
      for (const link of castle.links) {
        if (link.kind !== 'stairs') continue;
        if (samePos(link.a, p)) queue.push(link.b);
        if (samePos(link.b, p)) queue.push(link.a);
      }
    }
    for (const p of posts) {
      expect(p.level, show(p)).toBe(2);
      expect(tile(p)?.kind, show(p)).toBe('floor');
      expect(seen.has(posKey(p)), `reachable ${show(p)}`).toBe(true);
      expect(castle.spawns.some((s) => samePos(s.at, p)), `spawn on ${show(p)}`).toBe(false);
    }
    // Choke points: each post touches a bridge or is in the winch room.
    for (const p of posts) {
      const rooms = new Set([p, ...posNeighbors(p)].map((n) => tile(n)?.room));
      expect(rooms.has('bridges') || rooms.has('winch'), show(p)).toBe(true);
    }
    // V3.7 (spec 20.4): the Wake's posts: floor on Level 3 by the lift base and on the Lair approach, four free hexes around, no spawn within 2.
    for (const p of posts3) {
      expect(tile(p)?.kind, show(p)).toBe('floor');
      expect(['lift', 'bones', 'lair'].includes(tile(p)?.room ?? ''), show(p)).toBe(true);
      expect(posNeighbors(p).filter((n) => tile(n)?.kind === 'floor').length, show(p)).toBeGreaterThanOrEqual(3);
      for (const sp of castle.spawns) expect(sp.at.level === 3 && distance(sp.at, p) <= 2, `spawn ${sp.kind} by ${show(p)}`).toBe(false);
    }
    expect(posts3.some((p) => tile(p)?.room === 'lift')).toBe(true);
  });

  it('has one hideout site per crew (spec 20.4): floor, off everything else, never on the regular board', () => {
    const hide = castle.contractSites.filter((s) => s.hideout);
    expect(hide.map((s) => s.hideout).sort()).toEqual(['ferrymen', 'gallows-choir', 'lantern-sisters', 'the-wake']);
    const taken = new Set([
      ...castle.spawns.map((s) => s.at),
      ...castle.chests.map((c) => c.at),
      ...castle.coins.map((c) => c.at),
      ...castle.traps.map((t) => t.at),
      ...castle.contractSites.filter((s) => !s.hideout).map((s) => s.at),
      ...(castle.rivalPosts ?? []),
    ].map(posKey));
    for (const s of hide) {
      expect(s.kind).toBe('rescue');
      expect(s.id).toBe(`${s.hideout}-hideout`);
      expect(tile(s.at)?.kind, s.id).toBe('floor');
      expect(taken.has(posKey(s.at)), `${s.id} shares a hex`).toBe(false);
      for (const sp of castle.spawns) expect(sp.at.level === s.at.level && distance(sp.at, s.at) <= 1, `${s.id} next to a ${sp.kind}`).toBe(false);
    }
    // One level below the crew's own (capped at 3): the Sisters' on Level 2, the rest on Level 3.
    expect(hide.find((s) => s.hideout === 'lantern-sisters')!.at.level).toBe(2);
    for (const s of hide) if (s.hideout !== 'lantern-sisters') expect(s.at.level, s.id).toBe(3);
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
    expect(castle.spawns.some((s) => s.name === 'Grub the Jailer' && !s.asleep)).toBe(true);
    expect(castle.spawns.some((s) => s.name === 'Ugluk Red-Hand' && s.kind === 'berserker')).toBe(true);
    for (const lv of [1, 2, 3]) {
      expect(castle.traps.filter(on(lv)).filter((t) => !t.venom).length).toBe(2);
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
    const count = (kind: string, lv: number) => sites.filter((s) => s.kind === kind && !s.story && !s.hideout && s.at.level === lv).length;
    expect([count('rescue', 1), count('rescue', 2), count('rescue', 3)]).toEqual([1, 2, 1]);
    expect([count('recover', 1), count('recover', 2), count('recover', 3)]).toEqual([2, 2, 2]);
    const ids = [...castle.chests.map((c) => c.id), ...sites.map((s) => s.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ---------------------------------------------------------------- V3.6 (spec 19.1): story sites

describe('story sites (19.1)', () => {
  const story = castle.contractSites.filter((s) => s.story);

  it('V4.0 (spec 29.5): lays one or two venom traps on Level 2 only, in corridors, clear of contract sites', () => {
    const venom = castle.traps.filter((t) => t.venom);
    expect(venom.length).toBeGreaterThanOrEqual(1);
    expect(venom.length).toBeLessThanOrEqual(2);
    for (const t of venom) {
      expect(t.at.level).toBe(2);
      const walkable = posNeighbors(t.at).filter((p) => ['floor', 'door', 'rubble'].includes(tile(p)?.kind ?? '')).length;
      expect(walkable).toBeLessThanOrEqual(2); // a corridor: no stepping round it
      for (const s of castle.contractSites) if (s.at.level === 2) expect(distance(s.at, t.at)).toBeGreaterThan(2);
    }
  });

  it('has one site per story villager in the named room, on floor, clear of spawns, chests, coins, traps and other sites', () => {
    const want: Record<string, [number, string, string]> = {
      surgeon: [1, 'chapel', 'l1-story-chapel'],
      innkeeper: [1, 'kitchen', 'l1-story-kitchens'],
      smith: [2, 'forge', 'l2-story-forge'],
      copper: [2, 'barracks', 'l2-story-barracks'],
    };
    expect(story.map((s) => s.story).sort()).toEqual(Object.keys(want).sort());
    const taken = new Set([
      ...castle.spawns.map((s) => s.at),
      ...castle.chests.map((c) => c.at),
      ...castle.coins.map((c) => c.at),
      ...castle.traps.map((t) => t.at),
      ...castle.contractSites.filter((s) => !s.story).map((s) => s.at),
    ].map(posKey));
    for (const s of story) {
      const [lv, room, id] = want[s.story!]!;
      expect(s.id).toBe(id);
      expect(s.at.level, s.id).toBe(lv);
      expect(tile(s.at)?.kind, s.id).toBe('floor');
      expect(tile(s.at)?.room, s.id).toBe(room);
      expect(taken.has(posKey(s.at)), `${s.id} shares a hex`).toBe(false);
      // Not next to a sleeping spawn either: the hero should get a step in before the room wakes.
      // (The copper sits among the squad by design; it is a thing, not a villager to wake them.)
      if (s.kind === 'rescue') {
        for (const sp of castle.spawns) expect(samePos(sp.at, s.at), `${s.id} on a spawn`).toBe(false);
      }
    }
    // Away from the room's regular site (the chapel altar, the forge's recover site).
    for (const s of story) {
      for (const o of castle.contractSites) {
        if (o.story || o.at.level !== s.at.level || tile(o.at)?.room !== tile(s.at)?.room) continue;
        expect(distance(o.at, s.at), `${s.id} next to ${o.id}`).toBeGreaterThanOrEqual(3);
      }
    }
    // The cask book keeps the Drain's regular site (18.3): not a story-only site.
    expect(castle.contractSites.find((s) => s.id === 'l3-recover-drain')?.story).toBeUndefined();
    // Every story points at a site that exists, and a story site at its own story.
    for (const st of STORIES) {
      const site = castle.contractSites.find((s) => s.id === st.siteId);
      expect(site, st.id).toBeTruthy();
      if (site?.story) expect(site.story).toBe(st.id);
    }
  });

  it('is reachable on foot from an entrance, Gerda without passing the locked doors', () => {
    const walk = (allowLocked: boolean) => {
      const seen = new Set<string>();
      const queue: Pos[] = [...castle.entrances];
      while (queue.length) {
        const p = queue.pop()!;
        const k = posKey(p);
        if (seen.has(k) || !passable(p)) continue;
        if (!allowLocked && tile(p)?.kind === 'door' && tile(p)?.locked) continue;
        seen.add(k);
        queue.push(...posNeighbors(p));
        for (const link of castle.links) {
          if (link.kind !== 'stairs') continue;
          if (samePos(link.a, p)) queue.push(link.b);
          if (samePos(link.b, p)) queue.push(link.a);
        }
      }
      return seen;
    };
    const open = walk(false);
    for (const s of story) expect(open.has(posKey(s.at)), `${s.id} reachable past unlocked doors only`).toBe(true);
  });
});

// ---------------------------------------------------------------- V3.3 (spec 16): awareness, patrols, light

/** Walking path exists between a and b on one level; `doors` lets it pass doors. */
function connected(a: Pos, b: Pos, doors: boolean): boolean {
  if (a.level !== b.level) return false;
  const ok = doors ? passable : standable;
  if (!ok(a) || !ok(b)) return false;
  const seen = new Set<string>([posKey(a)]);
  const queue = [a];
  while (queue.length) {
    const p = queue.shift()!;
    if (samePos(p, b)) return true;
    for (const n of posNeighbors(p)) {
      const k = posKey(n);
      if (seen.has(k) || !ok(n)) continue;
      seen.add(k);
      queue.push(n);
    }
  }
  return false;
}

describe('castle V3.3: awareness', () => {
  const on = (lv: number) => castle.spawns.filter((s) => s.at.level === lv);
  const room = (p: Pos) => tile(p)?.room;

  it('marks exactly the brief’s sleepers: L1 rats and spider, L2 the barracks squad, L3 the Dragon', () => {
    for (const s of castle.spawns) {
      const shouldSleep =
        (s.at.level === 1 && (s.kind === 'rats' || s.kind === 'spider')) ||
        (s.at.level === 2 && room(s.at) === 'barracks') ||
        s.kind === 'dragon';
      expect(s.asleep === true, `${s.kind} at ${show(s.at)} asleep=${s.asleep}`).toBe(shouldSleep);
      // Awake is the default now; nothing says asleep: false.
      expect(s.asleep, `${s.kind} at ${show(s.at)}`).not.toBe(false);
      // Sleepers don't walk.
      if (s.asleep) expect(s.patrol, `${s.kind} at ${show(s.at)}`).toBeUndefined();
    }
    expect(on(1).filter((s) => s.asleep).map((s) => s.kind).sort()).toEqual(['rats', 'rats', 'spider']);
    const squad = on(2).filter((s) => s.asleep);
    expect(squad.length).toBeGreaterThanOrEqual(4);
    expect(squad.filter((s) => s.kind === 'captain').length).toBe(1);
    expect(squad.every((s) => s.kind === 'orc' || s.kind === 'captain')).toBe(true);
    expect(on(3).filter((s) => s.asleep).map((s) => s.kind)).toEqual(['dragon']);
  });

  it('has the V3.3 roster per level', () => {
    // L1: the orcs are up, one patrols the great hall.
    const l1orcs = on(1).filter((s) => s.kind === 'orc');
    expect(l1orcs.length).toBeGreaterThanOrEqual(5);
    expect(l1orcs.every((s) => !s.asleep)).toBe(true);
    const hallPatrols = on(1).filter((s) => s.patrol);
    expect(hallPatrols.length).toBe(1);
    expect(hallPatrols[0]!.patrol!.every((p) => room(p) === 'hall')).toBe(true);
    expect(on(1).some((s) => s.kind === 'cutpurse' && !s.asleep)).toBe(true);
    // L2: two orcs share the arcade loop, one walks guard post <-> barracks, one walks the ledge;
    // two archers on the arcade and the ledges; a captain with the squad.
    const l2patrols = on(2).filter((s) => s.patrol);
    expect(l2patrols.length).toBe(4);
    const loopKey = (s: (typeof l2patrols)[number]) => s.patrol!.slice(1).map(posKey).join('|');
    const arcade = l2patrols.filter((s) => s.patrol!.every((p) => room(p) === 'arcade'));
    expect(arcade.length).toBe(2);
    expect(loopKey(arcade[0]!)).toBe(loopKey(arcade[1]!));
    expect(distance(arcade[0]!.at, arcade[1]!.at)).toBe(1);
    const guard = l2patrols.find((s) => room(s.at) === 'guard')!;
    expect(guard).toBeDefined();
    expect(guard.patrol!.some((p) => room(p) === 'barracks')).toBe(true);
    const ledge = l2patrols.find((s) => room(s.at) === 'ledge-e')!;
    expect(ledge).toBeDefined();
    expect(ledge.patrol!.every((p) => room(p) === 'ledge-e')).toBe(true);
    const archers = on(2).filter((s) => s.kind === 'archer');
    expect(archers.length).toBe(2);
    for (const a of archers) expect(['arcade', 'ledge-e'].includes(room(a.at) ?? ''), show(a.at)).toBe(true);
    expect(archers.every((a) => !a.asleep)).toBe(true);
    expect(on(2).filter((s) => s.kind === 'captain').length).toBe(1);
    expect(on(2).length).toBeGreaterThanOrEqual(11 + 2); // V3.1 roster plus the brief's two of my choice
    // L3: three ghouls under the Bone Pile, two cave spiders, nothing else of the kind elsewhere.
    expect(on(3).filter((s) => s.kind === 'ghoul').length).toBe(3);
    expect(on(3).filter((s) => s.kind === 'spider').length).toBe(2);
    expect(castle.spawns.filter((s) => s.kind === 'ghoul').every((s) => s.at.level === 3)).toBe(true);
    expect(castle.spawns.filter((s) => s.kind === 'captain' || s.kind === 'archer').every((s) => s.at.level === 2)).toBe(true);
  });

  it('buries every ghoul under the Bone Pile floor', () => {
    for (const g of castle.spawns.filter((s) => s.kind === 'ghoul')) {
      expect(g.buried, show(g.at)).toBe(true);
      expect(tile(g.at)?.kind, show(g.at)).toBe('floor');
      expect(room(g.at), show(g.at)).toBe('bones');
      expect(g.patrol).toBeUndefined();
    }
    // Spread out: no two within 4 of each other.
    const gs = castle.spawns.filter((s) => s.kind === 'ghoul');
    for (const a of gs) for (const b of gs) if (a !== b) expect(distance(a.at, b.at)).toBeGreaterThan(4);
    expect(castle.spawns.filter((s) => s.buried && s.kind !== 'ghoul')).toEqual([]);
  });

  it('runs every patrol route over standable hexes, same level, joined by walkable paths', () => {
    for (const s of castle.spawns.filter((x) => x.patrol)) {
      const route = s.patrol!;
      const who = `${s.kind} at ${show(s.at)}`;
      expect(route.length, who).toBeGreaterThanOrEqual(2);
      expect(samePos(route[0]!, s.at), `${who}: first waypoint is the spawn hex`).toBe(true);
      // Level 1's hall patrol never opens a door; elsewhere unlocked doors are allowed.
      const doors = s.at.level !== 1;
      for (let i = 0; i < route.length; i++) {
        const a = route[i]!;
        const b = route[(i + 1) % route.length]!;
        expect(a.level, who).toBe(s.at.level);
        expect(standable(a), `${who}: waypoint ${show(a)} on ${tile(a)?.kind}`).toBe(true);
        expect(tile(a)?.kind, `${who}: waypoint ${show(a)} is a door`).not.toBe('door');
        expect(samePos(a, b), `${who}: repeated waypoint ${show(a)}`).toBe(false);
        expect(connected(a, b, doors), `${who}: ${show(a)} -> ${show(b)} not walkable${doors ? '' : ' without doors'}`).toBe(true);
      }
      // No waypoint on another spawn's hex.
      for (const o of castle.spawns) if (o !== s) expect(route.some((p) => samePos(p, o.at)), `${who} vs ${o.kind} at ${show(o.at)}`).toBe(false);
    }
    const hall = castle.spawns.find((s) => s.patrol && s.at.level === 1)!.patrol!;
    expect(hall.length).toBeGreaterThanOrEqual(4);
    expect(hall.length).toBeLessThanOrEqual(6);
    // No waypoint sits on a locked door (patrollers can open the others).
    const locked = (p: Pos) => tile(p)?.kind === 'door' && tile(p)?.locked;
    for (const s of castle.spawns.filter((x) => x.patrol)) for (const p of s.patrol!) expect(locked(p)).toBeFalsy();
  });
});

describe('castle V3.3: light by depth', () => {
  const lights = (lv: number) => castle.lights.filter((L) => L.at.level === lv);
  const kinds = (lv: number) => lights(lv).reduce<Record<string, number>>((n, L) => ((n[L.kind] = (n[L.kind] ?? 0) + 1), n), {});

  it('floods Level 1 with daylight', () => {
    const k = kinds(1);
    expect(k.daylight ?? 0).toBeGreaterThanOrEqual(15);
    expect(lights(1).length).toBeGreaterThanOrEqual(25);
    // The great hall's collapsed roof: several daylights on hall floor round the pit.
    const hallDay = lights(1).filter((L) => L.kind === 'daylight' && tile(L.at)?.room === 'hall');
    expect(hallDay.length).toBeGreaterThanOrEqual(5);
    // Most of the level is within reach of a fixed light (distance only; walls ignored).
    const floor = allTiles().filter(([p, t]) => p.level === 1 && STAND.includes(t.kind));
    const lit = floor.filter(([p]) => lights(1).some((L) => distance(L.at, p) <= L.radius));
    expect(lit.length / floor.length).toBeGreaterThan(0.75);
    // The courtyard and gatehouse stay as they were.
    for (const r of ['court', 'gate']) expect(lights(1).some((L) => L.kind === 'daylight' && tile(L.at)?.room === r), r).toBe(true);
  });

  it('keeps Level 2 sparse: a few sconces, the forge, the pit glow', () => {
    const k = kinds(2);
    expect(k.sconce ?? 0).toBeGreaterThanOrEqual(3);
    expect(k.sconce ?? 0).toBeLessThanOrEqual(4);
    expect(k.fire).toBe(1);
    expect(k.glow ?? 0).toBeGreaterThanOrEqual(1);
    expect(k.daylight ?? 0).toBe(0);
    expect(k.fungus ?? 0).toBe(0);
    expect(lights(2).length).toBeLessThanOrEqual(8);
    // The glow is the pit's: on the Crossing or the bridges.
    for (const L of lights(2).filter((x) => x.kind === 'glow')) expect(['crossing', 'bridges'].includes(tile(L.at)?.room ?? ''), show(L.at)).toBe(true);
    // The arcade and the bridges are dark: no sconce faces them.
    for (const L of lights(2).filter((x) => x.kind === 'sconce')) {
      const faces = posNeighbors(L.at).map((n) => tile(n)?.room).filter(Boolean);
      expect(faces.includes('bridges'), show(L.at)).toBe(false);
    }
  });

  it('lights Level 3 only by the Lair’s fires and vents, the fungus grove and the pit glow', () => {
    const k = kinds(3);
    expect(k.sconce ?? 0).toBe(0);
    expect(k.daylight ?? 0).toBe(0);
    expect(k.fungus ?? 0).toBeGreaterThan(0);
    expect(k.glow ?? 0).toBeGreaterThan(0);
    expect(k.fire ?? 0).toBeGreaterThan(0);
    for (const L of lights(3)) {
      const r = tile(L.at)?.room;
      if (L.kind === 'fire') expect(r, show(L.at)).toBe('lair');
      if (L.kind === 'fungus') expect(r, show(L.at)).toBe('grove');
      if (L.kind === 'glow') expect(r, show(L.at)).toBe('bones');
    }
  });

  it('gets darker with depth', () => {
    expect(lights(1).length).toBeGreaterThan(lights(2).length);
    expect(lights(2).length).toBeLessThanOrEqual(lights(3).length + 2);
  });
});

// ---------------------------------------------------------------- V3.7 (spec 20.3): breakable walls

describe('castle V3.7: breakable walls (20.3)', () => {
  const w = new World(castle);
  const walls = allTiles().filter(([, t]) => t.kind === 'wall');
  const breakable = walls.filter(([p]) => breakableWall(w, null, p)).map(([p]) => p);
  const roomsBeside = (p: Pos) => new Set(posNeighbors(p).map((n) => tile(n)?.room).filter((r): r is string => !!r));

  it('marks unbreakable on walls (the outer curtain, the tower stair shaft, the guard post landing, the lift shaft) and on the hexes beside stairs and lifts', () => {
    const landings = allTiles().filter(([, t]) => t.kind === 'stairs' || t.kind === 'lift').map(([p]) => p);
    const byLanding = (p: Pos) => landings.some((l) => samePos(l, p) || posNeighbors(l).some((n) => samePos(n, p)));
    for (const [p, t] of allTiles()) {
      if (t.unbreakable) expect(t.kind === 'wall' || byLanding(p), show(p)).toBe(true);
      // Spec 20.3a: the floor on either side of the tower stair and the lift never collapses or rubbles.
      if (byLanding(p) && t.kind !== 'pit') expect(t.unbreakable, show(p)).toBe(true);
    }
    for (const [p, t] of walls) {
      const rooms = roomsBeside(p);
      // Outer: nothing behind it and one room before it (a wall between two rooms that touches void is interior).
      const outer = posNeighbors(p).some((n) => !tile(n)) && rooms.size <= 1;
      const shaft = rooms.has('tower') || (p.level === 2 && (rooms.has('guard') || rooms.has('winch')));
      if (outer || shaft) expect(t.unbreakable, show(p)).toBe(true);
    }
    expect(breakable.some((p) => roomsBeside(p).has('tower'))).toBe(false);
    expect(breakable.some((p) => p.level === 2 && (roomsBeside(p).has('guard') || roomsBeside(p).has('winch')))).toBe(false);
  });

  it('leaves plenty of walls between rooms to blow on Levels 1 and 2, none on Level 3', () => {
    expect(breakable.filter((p) => p.level === 1).length).toBeGreaterThanOrEqual(20);
    expect(breakable.filter((p) => p.level === 2).length).toBeGreaterThanOrEqual(20);
    expect(breakable.filter((p) => p.level === 3).length).toBe(0);
    // Each one stands between two floor hexes that aren't next to each other.
    for (const p of breakable) {
      const fl = posNeighbors(p).filter(passable);
      expect(fl.some((a) => fl.some((b) => distance(a, b) > 1)), show(p)).toBe(true);
    }
    // A sapper can breach the armory beside its locked door (L1) and the cells (L2).
    expect(breakable.some((p) => p.level === 1 && roomsBeside(p).has('armory'))).toBe(true);
    expect(breakable.some((p) => p.level === 2 && roomsBeside(p).has('cells'))).toBe(true);
  });

  /** Shortest walking cost from `from` (doors open, stairs and the lift as links, rubble 2); `broken` walls count as rubble. */
  function walkCost(from: Pos, broken: Set<string>): Map<string, number> {
    const best = new Map<string, number>([[posKey(from), 0]]);
    const open: [number, Pos][] = [[0, from]];
    while (open.length) {
      open.sort((a, b) => a[0] - b[0]);
      const [d, p] = open.shift()!;
      if (best.get(posKey(p))! < d) continue;
      const nexts: [Pos, number][] = [];
      for (const n of posNeighbors(p)) {
        const t = tile(n);
        if (!t) continue;
        if (passable(n)) nexts.push([n, t.kind === 'rubble' ? 2 : 1]);
        else if (broken.has(posKey(n))) nexts.push([n, 2]);
      }
      for (const l of castle.links) {
        if (samePos(l.a, p)) nexts.push([l.b, 1]);
        if (samePos(l.b, p)) nexts.push([l.a, 1]);
      }
      for (const [n, c] of nexts) {
        const k = posKey(n);
        if ((best.get(k) ?? Infinity) > d + c) {
          best.set(k, d + c);
          open.push([d + c, n]);
        }
      }
    }
    return best;
  }

  it('with every breakable wall broken, the shortest path from each entrance to each site is at least 60% of the normal one', () => {
    const cracked = allTiles().filter(([, t]) => t.kind === 'cracked').map(([p]) => p);
    const broken = new Set([...breakable, ...cracked].map(posKey));
    // V4.0 (spec 25): "normal" is with the shut ways opened (the east breach's rubble cleared).
    const ways = new Set((castle.shutWays ?? []).filter((x) => x.kind === 'rubble').flatMap((x) => x.at).map(posKey));
    for (const en of castle.entrances) {
      const normal = walkCost(en, ways);
      const blown = walkCost(en, broken);
      for (const site of castle.contractSites) {
        const a = normal.get(posKey(site.at));
        const b = blown.get(posKey(site.at));
        expect(a, `${show(en)} -> ${site.id}`).toBeDefined();
        expect(b, `${show(en)} -> ${site.id}`).toBeDefined();
        expect(b! / a!, `${show(en)} -> ${site.id}: ${b} of ${a}`).toBeGreaterThanOrEqual(0.6);
      }
    }
  });
});

// ---------------------------------------------------------------- V4.0 (spec 25): shut ways in

describe('castle V4.0: the shut ways in (spec 25)', () => {
  const ways = castle.shutWays ?? [];
  const sally = ways.find((x) => x.id === 'sally')!;
  const breach = ways.find((x) => x.id === 'breach')!;

  it('names the three entrances and shuts the sally port with a barred gate and the east breach with rubble', () => {
    expect(castle.entranceNames).toEqual(['Main gate', 'Sally port', 'East breach']);
    expect(sally.entrance).toBe(1);
    expect(breach.entrance).toBe(2);
    expect(sally.kind).toBe('gate');
    expect(sally.at.length).toBe(1);
    const gate = tile(sally.at[0]!);
    expect(gate?.kind).toBe('door');
    expect(gate?.locked && gate?.barred).toBe(true);
    expect(breach.kind).toBe('rubble');
    for (const p of breach.at) expect(tile(p)?.kind === 'cracked' && tile(p)?.heap, show(p)).toBe(true);
    // The rival entrances are exactly the two shut ways.
    expect(castle.rivalEntrances.map(posKey).sort()).toEqual([sally, breach].map((x) => posKey(castle.entrances[x.entrance]!)).sort());
  });

  /** Walk from the main gate: doors pass (locked ones too), but not the barred gate or the rubble. */
  function fromMainGate(): Set<string> {
    const shut = new Set(ways.flatMap((x) => x.at).map(posKey));
    const seen = new Set<string>();
    const queue: Pos[] = [castle.entrances[0]!];
    while (queue.length) {
      const p = queue.pop()!;
      const k = posKey(p);
      if (seen.has(k) || !passable(p) || shut.has(k)) continue;
      seen.add(k);
      queue.push(...posNeighbors(p));
      for (const link of castle.links) {
        if (samePos(link.a, p)) queue.push(link.b);
        if (samePos(link.b, p)) queue.push(link.a);
      }
    }
    return seen;
  }

  it('keeps every contract site, the key and the far side of each shut way reachable from the main gate', () => {
    const seen = fromMainGate();
    for (const s of castle.contractSites) expect(seen.has(posKey(s.at)), s.id).toBe(true);
    expect(seen.has(posKey(sally.keyAt!)), 'the key').toBe(true);
    for (const way of ways) {
      // The exit is cut off, but the gate or rubble can be reached from inside.
      expect(seen.has(posKey(castle.entrances[way.entrance]!)), `${way.id} exit`).toBe(false);
      expect(way.at.some((p) => posNeighbors(p).some((n) => seen.has(posKey(n)))), `${way.id} from inside`).toBe(true);
    }
  });

  it('lays the key on library floor away from spawns, chests, coins, traps and contract sites', () => {
    const k = sally.keyAt!;
    expect(tile(k)?.kind).toBe('floor');
    expect(tile(k)?.room).toBe('library');
    const others = [
      ...castle.spawns.map((s) => s.at),
      ...castle.chests.map((c) => c.at),
      ...castle.coins.map((c) => c.at),
      ...castle.traps.map((t) => t.at),
      ...castle.contractSites.map((s) => s.at),
    ];
    for (const p of others) if (p.level === k.level) expect(distance(p, k), show(p)).toBeGreaterThanOrEqual(3);
  });

  it('cuts each shut exit off by its obstacle alone (cleared, the exit joins the castle)', () => {
    for (const way of ways) {
      const seen = new Set<string>();
      const queue: Pos[] = [castle.entrances[way.entrance]!];
      const other = new Set(ways.filter((x) => x !== way).flatMap((x) => x.at).map(posKey));
      while (queue.length) {
        const p = queue.pop()!;
        const k = posKey(p);
        if (seen.has(k) || other.has(k) || !(passable(p) || way.at.some((a) => samePos(a, p)))) continue;
        seen.add(k);
        queue.push(...posNeighbors(p));
      }
      expect(seen.has(posKey(castle.entrances[0]!)), way.id).toBe(true);
    }
  });
});
