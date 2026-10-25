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
    expect(castle.spawns.some((s) => s.name === 'Grub the Jailer' && !s.asleep)).toBe(true);
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
