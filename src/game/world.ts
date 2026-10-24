// Static castle indexes plus geometry that depends on the delve's runtime
// state: tiles, doors, line of sight, light, sight and path finding.

import { distance, hexKey, posKey, posNeighbors, line, range, samePos, type Hex, type Pos } from './hex';
import type { Brightness, CastleDef, LevelDef, LightDef, TileDef, TileKind } from './types';
import type { DelveX } from './state';
import { LIGHT_MAX } from './data';

export class World {
  readonly levels = new Map<number, LevelDef>();
  readonly stairs = new Map<string, Pos>();
  /** Lift ends, by posKey, to the other end. Usable once the winch is worked. */
  readonly lifts = new Map<string, Pos>();
  /** Winch hexes (tallprops), by posKey. */
  readonly winches: Pos[] = [];
  readonly exits: Pos[] = [];
  readonly floors = new Map<number, Pos[]>();
  /** Fire vents: walkable hexes with a radius-1 'fire' light. */
  readonly vents = new Set<string>();
  /** Solid hexes that burn (the forge): a 'fire' light on a non-walkable hex. */
  readonly fires = new Set<string>();
  /** Fixed lit hexes, cached by door/blown state. */
  fixedCache: { key: string; lit: Set<string> } | null = null;

  constructor(readonly castle: CastleDef) {
    for (const l of castle.levels) {
      this.levels.set(l.level, l);
      const fl: Pos[] = [];
      for (const [k, t] of Object.entries(l.tiles)) {
        const [q, r] = k.split(',').map(Number) as [number, number];
        const p = { level: l.level, q, r };
        if (t.kind === 'exit') this.exits.push(p);
        if (t.kind === 'floor') fl.push(p);
      }
      this.floors.set(l.level, fl);
    }
    for (const link of castle.links) {
      if (link.kind === 'stairs') {
        this.stairs.set(posKey(link.a), link.b);
        this.stairs.set(posKey(link.b), link.a);
      } else if (link.kind === 'lift') {
        this.lifts.set(posKey(link.a), link.b);
        this.lifts.set(posKey(link.b), link.a);
        this.winches.push(link.winch);
      }
    }
    for (const L of castle.lights ?? []) {
      const k = this.tile(L.at)?.kind;
      if (L.kind !== 'fire') continue;
      if (k && FLOORISH.includes(k)) {
        if (L.radius === 1) this.vents.add(posKey(L.at));
      } else this.fires.add(posKey(L.at));
    }
    for (const t of castle.levels.flatMap((l) => Object.entries(l.tiles).map(([k, d]) => [l.level, k, d] as const))) {
      const [lv, k, d] = t;
      if (d.kind === 'tallprop' && d.prop === 'forge') this.fires.add(`${lv}:${k}`);
    }
  }

  levelName(level: number): string {
    const n = this.levels.get(level)?.name ?? `Level ${level}`;
    return n.replace(/^The /, 'the ');
  }

  /** Room id of a hex, if any. */
  roomOf(p: Pos): string | undefined {
    return this.tile(p)?.room;
  }

  tile(p: Pos): TileDef | undefined {
    return this.levels.get(p.level)?.tiles[hexKey(p)];
  }

  roomName(p: Pos): string {
    const l = this.levels.get(p.level);
    const t = this.tile(p);
    const room = l?.rooms.find((r) => r.id === t?.room);
    return room ? room.name : (l?.name ?? `Level ${p.level}`);
  }
}

/** Tile kind at p with runtime changes (blown cracked walls are floor). */
export function kindAt(w: World, d: DelveX | null, p: Pos): TileKind | undefined {
  const t = w.tile(p);
  if (!t) return undefined;
  if (t.kind === 'cracked' && d?.blown.includes(posKey(p))) return 'floor';
  return t.kind;
}

const FLOORISH: TileKind[] = ['floor', 'rubble', 'stairs', 'exit', 'door', 'lift'];

/** Can feet stand here at all (ignoring doors' state and occupants)? */
export function isFloorish(w: World, d: DelveX | null, p: Pos): boolean {
  const k = kindAt(w, d, p);
  return k !== undefined && FLOORISH.includes(k);
}

export function doorAt(d: DelveX, p: Pos) {
  return d.doors[posKey(p)];
}

/** Hero/monster can step in (doors: open, or closed and unlocked = opens on the way). */
export function canEnter(w: World, d: DelveX, p: Pos, allowLocked = false): boolean {
  const k = kindAt(w, d, p);
  if (!k || !FLOORISH.includes(k)) return false;
  if (k === 'door') {
    const door = doorAt(d, p);
    if (door && !door.open && door.locked && !allowLocked) return false;
  }
  return true;
}

export function blocksSight(w: World, d: DelveX, p: Pos): boolean {
  const k = kindAt(w, d, p);
  if (k === undefined) return true;
  if (k === 'wall' || k === 'pillar' || k === 'cracked' || k === 'tallprop' || k === 'sealed') return true;
  if (k === 'door') return !doorAt(d, p)?.open;
  return false;
}

function clearLine(w: World, d: DelveX, a: Pos, b: Pos): boolean {
  const hs = line(a, b);
  for (let i = 1; i < hs.length - 1; i++) {
    if (blocksSight(w, d, { level: a.level, ...hs[i]! })) return false;
  }
  return true;
}

/** Line of sight between two hexes on the same level (ends excluded from blocking). */
export function los(w: World, d: DelveX, a: Pos, b: Pos): boolean {
  if (a.level !== b.level) return false;
  return clearLine(w, d, a, b) || clearLine(w, d, b, a);
}

export function brightnessOf(light: number): Brightness {
  if (light > 26) return 'bright';
  if (light >= 13) return 'dim';
  if (light >= 1) return 'dark';
  return 'pitch';
}

export const LANTERN_RADIUS: Record<Brightness, number> = { bright: 4, dim: 3, dark: 2, pitch: 0 };

export function lanternPos(d: DelveX): Pos | null {
  const b = d.heroes.find((h) => h.heroId === d.lanternBearer);
  if (!b || (b.status !== 'active' && b.status !== 'downed')) return null;
  return b.at;
}

/** Every lit hex, by posKey. */
export function litSet(w: World, d: DelveX): Set<string> {
  const out = new Set<string>();
  const shine = (src: Pos, r: number) => {
    if (r <= 0) return;
    for (const h of range(src, r)) {
      const p = { level: src.level, ...h };
      if (!w.tile(p)) continue;
      if (los(w, d, src, p)) out.add(posKey(p));
    }
  };
  const lp = lanternPos(d);
  if (lp) shine(lp, LANTERN_RADIUS[brightnessOf(d.light)]);
  for (const h of d.heroes) {
    if (h.torch > 0 && (h.status === 'active' || h.status === 'downed')) shine(h.at, 2);
  }
  for (const k of d.lit) {
    const [lv, rest] = k.split(':');
    const [q, r] = (rest ?? '0,0').split(',').map(Number) as [number, number];
    shine({ level: Number(lv), q, r }, 3);
  }
  for (const k of fixedLit(w, d)) out.add(k);
  return out;
}

/** Hexes lit for good by the castle's fixed lights (sconces, daylight, fires, fungus, glow). */
export function fixedLit(w: World, d: DelveX): Set<string> {
  const lights: LightDef[] = w.castle.lights ?? [];
  if (!lights.length) return new Set();
  const key = Object.entries(d.doors).filter(([, v]) => v.open).map(([k]) => k).sort().join('|') + '#' + [...d.blown].sort().join('|');
  if (w.fixedCache && w.fixedCache.key === key) return w.fixedCache.lit;
  const out = new Set<string>();
  for (const L of lights) {
    for (const h of range(L.at, L.radius)) {
      const p = { level: L.at.level, ...h };
      if (!w.tile(p)) continue;
      if (los(w, d, L.at, p)) out.add(posKey(p));
    }
  }
  w.fixedCache = { key, lit: out };
  return out;
}

/** Sight range by lantern stage and depth (spec 14.5): bright 8, dim 6, dark 4, pitch 2; −1 per level below 1; never below 2. */
export const SIGHT_BY_STAGE: Record<Brightness, number> = { bright: 8, dim: 6, dark: 4, pitch: 2 };
export function sightRangeOf(light: number, level: number): number {
  return Math.max(2, SIGHT_BY_STAGE[brightnessOf(light)] - Math.max(0, level - 1));
}
/** Lit hexes in line of sight are visible from this far, whatever the sight range. */
export const LIT_SIGHT = 14;

/**
 * Hexes whose layout a hero at `from` can make out: every tile in line of
 * sight within the sight range, lit or not.
 */
export function glimpseSet(w: World, d: DelveX, from: Pos): Pos[] {
  const out: Pos[] = [];
  for (const h of range(from, sightRangeOf(d.light, from.level))) {
    const p = { level: from.level, ...h };
    if (w.tile(p) && los(w, d, from, p)) out.push(p);
  }
  return out;
}

/**
 * Hexes the active heroes see now (units there are seen): every hex within 1,
 * every hex in line of sight within the sight range (lit or not), and lit
 * hexes in line of sight up to LIT_SIGHT.
 */
export function visibleSet(w: World, d: DelveX, lit?: Set<string>): Set<string> {
  const L = lit ?? litSet(w, d);
  const out = new Set<string>();
  const eyes = d.heroes.filter((h) => h.status === 'active');
  for (const h of eyes) {
    const sr = sightRangeOf(d.light, h.at.level);
    for (const n of range(h.at, LIT_SIGHT)) {
      const p = { level: h.at.level, ...n };
      if (!w.tile(p)) continue;
      const k = posKey(p);
      if (out.has(k)) continue;
      const dist = distance(h.at, p);
      if (dist <= 1) {
        out.add(k);
        continue;
      }
      if (dist > sr && !L.has(k)) continue;
      if (los(w, d, h.at, p)) out.add(k);
    }
  }
  return out;
}

export function clampLight(n: number): number {
  return Math.max(0, Math.min(LIGHT_MAX, n));
}

// ---------------------------------------------------------------- paths

export interface PathOpts {
  /** Can this hex be entered (beyond terrain)? */
  enter: (p: Pos) => boolean;
  /** Extra tie-break penalty for entering p (e.g. spotted traps). */
  penalty?: (p: Pos) => number;
  /** Allow stairs links. */
  stairs: boolean;
  /** Allow locked doors (the Gloam). */
  allowLocked?: boolean;
  /** Max cost. */
  budget: number;
}

export interface Node {
  p: Pos;
  cost: number;
  pen: number;
  prev?: string;
}

/** Steps from p: hex neighbours plus a stairs link. Returns [pos, cost]. */
export function steps(w: World, d: DelveX, p: Pos, opts: { stairs: boolean; allowLocked?: boolean }): [Pos, number][] {
  const out: [Pos, number][] = [];
  for (const n of posNeighbors(p)) {
    if (!canEnter(w, d, n, opts.allowLocked)) continue;
    out.push([n, kindAt(w, d, n) === 'rubble' ? 2 : 1]);
  }
  if (opts.stairs && kindAt(w, d, p) === 'stairs') {
    const o = w.stairs.get(posKey(p));
    if (o) out.push([o, 1]);
  }
  if (opts.stairs && d.liftWorking && kindAt(w, d, p) === 'lift') {
    const o = w.lifts.get(posKey(p));
    if (o) out.push([o, 1]);
  }
  return out;
}

/** Dijkstra from `from`. Returns nodes by posKey (start included, cost 0). */
export function dijkstra(w: World, d: DelveX, from: Pos, o: PathOpts): Map<string, Node> {
  const best = new Map<string, Node>();
  best.set(posKey(from), { p: from, cost: 0, pen: 0 });
  const open: Node[] = [best.get(posKey(from))!];
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) {
      const a = open[i]!;
      const b = open[bi]!;
      if (a.cost < b.cost || (a.cost === b.cost && a.pen < b.pen)) bi = i;
    }
    const cur = open.splice(bi, 1)[0]!;
    const ck = posKey(cur.p);
    if (best.get(ck) !== cur) continue;
    for (const [n, c] of steps(w, d, cur.p, o)) {
      const cost = cur.cost + c;
      if (cost > o.budget) continue;
      if (!o.enter(n)) continue;
      const pen = cur.pen + (o.penalty?.(n) ?? 0);
      const k = posKey(n);
      const old = best.get(k);
      if (old && (old.cost < cost || (old.cost === cost && old.pen <= pen))) continue;
      const node = { p: n, cost, pen, prev: ck };
      best.set(k, node);
      open.push(node);
    }
  }
  return best;
}

export function pathTo(nodes: Map<string, Node>, to: Pos): Pos[] {
  const out: Pos[] = [];
  let k: string | undefined = posKey(to);
  while (k) {
    const n = nodes.get(k);
    if (!n || !n.prev) break;
    out.push(n.p);
    k = n.prev;
  }
  return out.reverse();
}

/** Unbounded BFS distance (in steps) from goals over walkable terrain. */
export function distField(w: World, d: DelveX, goals: Pos[], opts: { stairs: boolean; allowLocked?: boolean }): Map<string, number> {
  const dist = new Map<string, number>();
  const q: Pos[] = [];
  for (const g of goals) {
    if (!dist.has(posKey(g))) {
      dist.set(posKey(g), 0);
      q.push(g);
    }
  }
  for (let i = 0; i < q.length; i++) {
    const p = q[i]!;
    const dp = dist.get(posKey(p))!;
    for (const [n] of steps(w, d, p, opts)) {
      const k = posKey(n);
      if (dist.has(k)) continue;
      dist.set(k, dp + 1);
      q.push(n);
    }
  }
  return dist;
}

/** Noise reach: walking distance from src where crossing a closed door counts 2. */
export function noiseField(w: World, d: DelveX, src: Pos, radius: number): Map<string, number> {
  const best = new Map<string, number>();
  best.set(posKey(src), 0);
  const open: [Pos, number][] = [[src, 0]];
  while (open.length) {
    open.sort((a, b) => a[1] - b[1]);
    const [p, c] = open.shift()!;
    if (best.get(posKey(p))! < c) continue;
    for (const n of posNeighbors(p)) {
      const nk = kindAt(w, d, n);
      if (!isFloorish(w, d, n) && nk !== 'prop' && nk !== 'pit') continue;
      const door = nk === 'door' && !doorAt(d, n)?.open;
      const nc = c + (door ? 2 : 1);
      if (nc > radius) continue;
      const k = posKey(n);
      if ((best.get(k) ?? Infinity) <= nc) continue;
      best.set(k, nc);
      open.push([n, nc]);
    }
  }
  return best;
}

export function adjacent(a: Pos, b: Pos): boolean {
  return a.level === b.level && distance(a, b) === 1;
}

export function within(a: Pos, b: Pos, n: number): boolean {
  return a.level === b.level && distance(a, b) <= n;
}

export { samePos, posKey };
export type { Hex };

// ---------------------------------------------------------------- falls

/** Floor-like hex a figure can stand on (doors excluded). */
export function standable(w: World, d: DelveX | null, p: Pos): boolean {
  const k = kindAt(w, d, p);
  return k !== undefined && k !== 'door' && FLOORISH.includes(k);
}

/**
 * Where a fall into the pit column at `pit` comes to rest, ignoring who stands there:
 * the first level below whose tile at the same (q, r) is walkable. A solid tile
 * under the column stops the fall on the nearest walkable hex of that level.
 */
export function fallColumn(w: World, d: DelveX | null, pit: Pos): { to: Pos; levels: number } | null {
  if (kindAt(w, d, pit) !== 'pit') return null;
  const levels = [...w.levels.keys()].filter((l) => l > pit.level).sort((a, b) => a - b);
  for (const lv of levels) {
    const p = { level: lv, q: pit.q, r: pit.r };
    const k = kindAt(w, d, p);
    if (k === 'pit') continue;
    if (k && standable(w, d, p)) return { to: p, levels: lv - pit.level };
    // Solid or void under the column: nearest walkable on this level.
    for (let r = 1; r <= 3; r++) {
      const ring = range(p, r).map((h) => ({ level: lv, ...h })).filter((x) => distance(x, p) === r && standable(w, d, x));
      if (ring.length) return { to: ring[0]!, levels: lv - pit.level };
    }
    return null;
  }
  return null;
}

/** Fall damage: 4 for one level, 7 for two or more. */
export function fallDamage(levels: number): number {
  return levels <= 1 ? 4 : 7;
}

/** Nearest free standable hex to `p` within 3 on its level (p itself first). */
export function freeNear(w: World, d: DelveX, p: Pos, taken: (q: Pos) => boolean): Pos | null {
  for (let r = 0; r <= 3; r++) {
    for (const h of range(p, r)) {
      const x = { level: p.level, ...h };
      if (distance(x, p) !== r) continue;
      if (standable(w, d, x) && !taken(x)) return x;
    }
  }
  return null;
}

/** Floor hex next to a pit (an edge). */
export function pitsNextTo(w: World, d: DelveX | null, p: Pos): Pos[] {
  return posNeighbors(p).filter((n) => kindAt(w, d, n) === 'pit');
}
