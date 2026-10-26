// V3.7 (spec 20): pure helpers for what the player sees of stealth, facing and charges.
// No DOM, no three.js: the diorama and the HUD both use them.

import { DIRS, add, hexKey, hexToWorld, posKey, range, samePos, type Hex, type Pos } from '../game/hex';
import type { CastleDef, Delve, GameState, LevelDef, Monster, Rival, TileDef } from '../game/types';

/**
 * Which way a monster or crew member faces (hex.ts DIRS index). `undefined` means it watches all
 * round (crew members at their post, hand-placed monsters): no wedge, no blind arc.
 */
export function facingOf(u: { facing?: number }): number | undefined {
  if (u.facing === undefined || u.facing === null) return undefined;
  return ((Math.round(u.facing) % 6) + 6) % 6;
}

/** The world-space angle (around +y, as THREE's rotation.y) a figure should turn to for a DIRS index. */
export function facingAngle(dir: number): number {
  const d = DIRS[((dir % 6) + 6) % 6]!;
  const w = hexToWorld(d, 1);
  return Math.atan2(w.x, w.z);
}

/** The back direction and its two neighbours: the blind arc's directions. */
export function backDirs(facing: number): number[] {
  const back = (facing + 3) % 6;
  return [(back + 5) % 6, back, (back + 1) % 6];
}

/** The DIRS index a hex offset lies in: the largest dot product, ties to the lower index (as the engine's dirIndex). */
export function dirIndexOf(dq: number, dr: number): number {
  const w = hexToWorld({ q: dq, r: dr }, 1);
  const len = Math.hypot(w.x, w.z) || 1;
  let best = 0;
  let bestDot = -Infinity;
  for (let i = 0; i < 6; i++) {
    const v = hexToWorld(DIRS[i]!, 1);
    const vl = Math.hypot(v.x, v.z) || 1;
    const dot = (w.x * v.x + w.z * v.z) / (len * vl);
    if (dot > bestDot + 1e-9) {
      bestDot = dot;
      best = i;
    }
  }
  return best;
}

/** Floor-like tiles a hero could stand on. */
const STANDABLE = new Set(['floor', 'rubble', 'door', 'stairs', 'exit', 'lift']);

/**
 * The blind arc of a figure at `at` facing `facing`: every standable hex within `maxDist` whose
 * direction from it is one of the three back directions (hexes on a sector border count only when
 * both sides are blind, so the arc never promises more than the rule gives). Walls stop it: a hex
 * behind a wall on the straight line is left out (the engine's line of sight hides you there anyway).
 */
export function blindArc(level: LevelDef | undefined, at: Pos, facing: number, maxDist = 4): { hexes: Pos[]; behind: Pos | null } {
  if (!level) return { hexes: [], behind: null };
  const blind = new Set(backDirs(facing));
  const out: Pos[] = [];
  for (const h of range(at, maxDist)) {
    if (h.q === at.q && h.r === at.r) continue;
    const t = level.tiles[hexKey(h)];
    if (!t || !STANDABLE.has(t.kind)) continue;
    if (!blind.has(dirIndexOf(h.q - at.q, h.r - at.r))) continue;
    if (!clearLine(level, at, h)) continue;
    out.push({ level: at.level, q: h.q, r: h.r });
  }
  const b = add(at, DIRS[(facing + 3) % 6]!);
  const bt = level.tiles[hexKey(b)];
  const behind = bt && STANDABLE.has(bt.kind) ? { level: at.level, q: b.q, r: b.r } : null;
  return { hexes: out, behind };
}

/** Cheap line test on hex centres: no wall/pillar/sealed/tallprop between (endpoints excluded). */
function clearLine(level: LevelDef, a: Hex, b: Hex): boolean {
  const n = Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.q + a.r - b.q - b.r));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const q = a.q + (b.q - a.q) * t;
    const r = a.r + (b.r - a.r) * t;
    const h = roundHex(q, r);
    const tile = level.tiles[hexKey(h)];
    if (!tile || tile.kind === 'wall' || tile.kind === 'pillar' || tile.kind === 'sealed' || tile.kind === 'cracked' || tile.kind === 'tallprop') return false;
  }
  return true;
}

function roundHex(q: number, r: number): Hex {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq, r: rr };
}

/** Awake monsters and live crew members that have a facing worth drawing (not asleep, not the Dragon or the Gloam). */
export function facedUnits(d: Delve): { id: string; at: Pos; facing: number; crew: boolean; feared: boolean }[] {
  const out: { id: string; at: Pos; facing: number; crew: boolean; feared: boolean }[] = [];
  for (const m of d.monsters) {
    if (m.hp <= 0 || m.buried || m.awareness === 'asleep' || m.kind === 'dragon' || m.kind === 'gloam') continue;
    const f = facingOf(m);
    if (f === undefined) continue;
    out.push({ id: m.id, at: m.at, facing: f, crew: false, feared: (m.feared ?? 0) > 0 });
  }
  if (d.rivals && d.round >= d.rivals.entersRound)
    for (const r of d.rivals.members) {
      if (r.hp <= 0 || r.goneOut) continue;
      const f = facingOf(r);
      if (f === undefined) continue;
      out.push({ id: r.id, at: r.at, facing: f, crew: true, feared: (r.feared ?? 0) > 0 });
    }
  return out;
}

/** Is this figure feared (spec 20.2)? */
export function isFeared(u: Monster | Rival | undefined): boolean {
  return !!u && (u.feared ?? 0) > 0;
}

// ------------------------------------------------------------ charges (spec 20.3)

const CAVE = new Set(['rock', 'earth', 'bone']);

/**
 * A built wall a charge could break: on Levels 1 and 2, not `unbreakable`, not cave rock (any open
 * neighbour in a rock/earth/bone room), not a pillar, with floor on at least two sides.
 */
export function breakableWall(castle: CastleDef, p: Pos): boolean {
  if (p.level > 2) return false;
  const lv = castle.levels.find((l) => l.level === p.level);
  const t = lv?.tiles[hexKey(p)];
  if (!lv || !t || t.kind !== 'wall' || t.unbreakable) return false;
  let open = 0;
  for (const d of DIRS) {
    const n = lv.tiles[hexKey(add(p, d))];
    if (!n || !STANDABLE.has(n.kind)) continue;
    const room = lv.rooms.find((r) => r.id === n.room);
    if (room?.material && CAVE.has(room.material)) return false;
    open++;
  }
  return open >= 2;
}

/** Everything a blast at `at` reaches: the inner ring (within 1, pushed) and the outer ring (distance 2). */
export function blastRings(castle: CastleDef, at: Pos): { inner: Pos[]; outer: Pos[] } {
  const lv = castle.levels.find((l) => l.level === at.level);
  const inner: Pos[] = [];
  const outer: Pos[] = [];
  for (const h of range(at, 2)) {
    const t = lv?.tiles[hexKey(h)];
    if (!t) continue;
    const dist = Math.max(Math.abs(h.q - at.q), Math.abs(h.r - at.r), Math.abs(h.q + h.r - at.q - at.r));
    const p = { level: at.level, q: h.q, r: h.r };
    if (dist <= 1) inner.push(p);
    else if (t.kind !== 'wall' && t.kind !== 'pillar') outer.push(p);
  }
  return { inner, outer };
}

/** Walls within 1 of a blast hex that it would break (for the hover text and the breakable outline). */
export function wallsBlastWouldBreak(castle: CastleDef, at: Pos): Pos[] {
  return range(at, 1)
    .map((h) => ({ level: at.level, q: h.q, r: h.r }))
    .filter((p) => breakableWall(castle, p) || castle.levels.find((l) => l.level === p.level)?.tiles[hexKey(p)]?.kind === 'cracked');
}

/** The fuse set on a hex, if any. */
export function fuseAt(d: Delve, at: Pos) {
  return (d.fuses ?? []).find((f) => samePos(f.at, at));
}

/** Who set a fuse: 'hero' for a party member, 'rival' for a crew member, else 'other'. */
export function fuseSide(s: GameState, by: string): 'hero' | 'rival' | 'other' {
  if (s.campaign.roster.some((h) => h.id === by)) return 'hero';
  if (s.delve?.rivals?.members.some((r) => r.id === by)) return 'rival';
  return 'other';
}

/** "goes off at the end of this castle turn" / "in 2 castle turns". */
export function fuseWords(rounds: number): string {
  return rounds <= 1 ? 'goes off at the end of the coming castle turn' : `goes off in ${rounds} castle turns`;
}

const NO_FLOOR_BLAST = new Set(['stairs', 'lift', 'exit', 'door', 'brazier', 'tallprop', 'sealed', 'prop']);

/**
 * 20.3a: what a blast at `at` does to the ground within 1, by the view's reading of the rule (the
 * engine's `blastPreview` is the truth once it lands): walls that break, floor next to a pit that
 * collapses (Levels 1 and 2), other floor that turns to rubble. Already blown, collapsed or
 * unbreakable hexes and the untouchable kinds are left out.
 */
export function blastPreview(castle: CastleDef, d: { blown: string[]; collapsed?: string[] } | null, at: Pos): { breaks: Pos[]; collapses: Pos[]; rubbles: Pos[] } {
  const lv = castle.levels.find((l) => l.level === at.level);
  const out = { breaks: [] as Pos[], collapses: [] as Pos[], rubbles: [] as Pos[] };
  if (!lv) return out;
  const blown = new Set(d?.blown ?? []);
  const collapsed = new Set(d?.collapsed ?? []);
  const isPit = (p: Pos) => lv.tiles[hexKey(p)]?.kind === 'pit' || collapsed.has(posKey(p));
  for (const h of range(at, 1)) {
    const p = { level: at.level, q: h.q, r: h.r };
    const k = posKey(p);
    const t = lv.tiles[hexKey(p)];
    if (!t || blown.has(k) || collapsed.has(k) || t.unbreakable) continue;
    if (t.kind === 'wall' || t.kind === 'cracked') {
      if (t.kind === 'cracked' || breakableWall(castle, p)) out.breaks.push(p);
      continue;
    }
    if (t.kind !== 'floor' || NO_FLOOR_BLAST.has(t.kind)) continue;
    if (at.level <= 2 && DIRS.some((dd) => isPit(add(p, dd) as Pos))) out.collapses.push(p);
    else out.rubbles.push(p);
  }
  return out;
}

/** 20.3a: floor next to a pit on Levels 1 and 2: a charge here drops it (for the hover line). */
export function collapsible(castle: CastleDef, d: { collapsed?: string[] } | null, p: Pos): boolean {
  if (p.level > 2) return false;
  const lv = castle.levels.find((l) => l.level === p.level);
  const t = lv?.tiles[hexKey(p)];
  if (!lv || !t || t.kind !== 'floor' || t.unbreakable) return false;
  const collapsed = new Set(d?.collapsed ?? []);
  return DIRS.some((dd) => {
    const n = add(p, dd);
    return lv.tiles[hexKey(n)]?.kind === 'pit' || collapsed.has(posKey({ level: p.level, ...n }));
  });
}

/** The tile under a pos, for callers without a LevelView. */
export function tileAt(castle: CastleDef, p: Pos): TileDef | undefined {
  return castle.levels.find((l) => l.level === p.level)?.tiles[hexKey(p)];
}

/** posKeys of blown entries that were built walls or floor (they show as rubble, spec 20.3, 20.3a); cracked walls and dug rubble are not in it. */
export function blownWalls(castle: CastleDef, blown: string[]): Set<string> {
  const out = new Set<string>();
  for (const k of blown) {
    const [l, rest] = k.split(':');
    const [q, r] = (rest ?? '').split(',').map(Number);
    const p = { level: Number(l), q: q ?? 0, r: r ?? 0 };
    const kind = tileAt(castle, p)?.kind;
    if (kind === 'wall' || kind === 'floor') out.add(posKey(p));
  }
  return out;
}

// ------------------------------------------------------------ V3.9 (spec 24): eyes front

/** The three directions centred on `facing`: the front half (what a figure sees). */
export function frontDirs(facing: number): number[] {
  const f = ((facing % 6) + 6) % 6;
  return [(f + 5) % 6, f, (f + 1) % 6];
}

/** Is `p` in the front half of a figure at `at` facing `facing`? (Its own hex is not.) */
export function inFrontHalf(at: Pos, facing: number, p: Pos): boolean {
  if (at.level !== p.level || samePos(at, p)) return false;
  return frontDirs(facing).includes(dirIndexOf(p.q - at.q, p.r - at.r));
}

/**
 * Is `p` outside the figure's front? Monsters: their sides and straight behind (the back direction and its
 * two neighbours: where a Burglar backstabs from, spec 27). V3.9.2 (spec 24.7) `cone`: heroes and crew
 * members, only straight behind.
 */
export function inRearHalf(at: Pos, facing: number, p: Pos, cone = false): boolean {
  if (at.level !== p.level || samePos(at, p)) return false;
  const i = dirIndexOf(p.q - at.q, p.r - at.r);
  return cone ? i === (facing + 3) % 6 : backDirs(facing).includes(i);
}

/** The neighbour hexes outside a figure's front: directly behind first, then its two sides (a monster's backstab hexes). */
export function rearNeighbours(at: Pos, facing: number, cone = false): Pos[] {
  const back = (facing + 3) % 6;
  return (cone ? [back] : [back, (back + 5) % 6, (back + 1) % 6]).map((i) => ({ level: at.level, ...add(at, DIRS[i]!) }));
}

/** The direction of a step (or of "toward"): hex.ts DIRS index, as the engine's dirIndex. */
export function dirToward(from: Pos, to: Pos): number {
  return dirIndexOf(to.q - from.q, to.r - from.r);
}

/** The facing a hero ends a path with: the direction of its last step (or `fallback` for no step). */
export function pathEndFacing(start: Pos, path: Pos[], fallback?: number): number | undefined {
  if (!path.length) return fallback;
  const last = path[path.length - 1]!;
  const prev = path.length > 1 ? path[path.length - 2]! : start;
  if (prev.level !== last.level || samePos(prev, last)) return fallback;
  return dirToward(prev, last);
}

/**
 * 24.5: "back exposed": the hero's back is not covered by anyone's front half. Read from the
 * engine's visibility: the hex directly behind the hero (or, when that is not floor, either back
 * flank) is standable and not visible. A hex another active hero stands on counts as covered.
 */
export function backExposed(castle: CastleDef, d: Delve, heroId: string, visible: Set<string>): boolean {
  const h = d.heroes.find((x) => x.heroId === heroId);
  if (!h || h.status !== 'active') return false;
  const f = facingOf(h);
  if (f === undefined) return false;
  const lv = castle.levels.find((l) => l.level === h.at.level);
  if (!lv) return false;
  const open = (p: Pos) => {
    const t = lv.tiles[hexKey(p)];
    return !!t && STANDABLE.has(t.kind);
  };
  const covered = (p: Pos) => visible.has(posKey(p)) || d.heroes.some((o) => o.status === 'active' && o.heroId !== heroId && samePos(o.at, p));
  const [behind, ...flanks] = rearNeighbours(h.at, f);
  if (open(behind!)) return !covered(behind!);
  return flanks.some((p) => open(p) && !covered(p));
}

/** A figure that may be backstabbed (spec 24.3): monsters and crew members, not the Dragon or the Gloam. */
type Stabbable = { id: string; at: Pos; facing?: number; awareness?: Monster['awareness']; kind?: string; hp: number; noticedIds?: string[] };

function stabTarget(d: Delve, id: string): { u: Stabbable; crew: boolean } | null {
  const m = d.monsters.find((x) => x.id === id);
  if (m) return m.kind === 'dragon' || m.kind === 'gloam' || m.hp <= 0 || m.buried ? null : { u: m as Stabbable, crew: false };
  const r = d.rivals?.members.find((x) => x.id === id);
  return r && r.hp > 0 && !r.goneOut ? { u: r as Stabbable, crew: true } : null;
}

/**
 * Has this target not noticed the hero (24.3: asleep, or awake without that hero noticed)? The
 * engine keeps `noticedIds` on monsters; without it, a hunting monster counts as having noticed.
 * Crew members notice everyone once hostile.
 */
export function unawareOf(d: Delve, targetId: string, heroId: string): boolean {
  const t = stabTarget(d, targetId);
  if (!t) return false;
  if (t.crew) return d.rivals?.stance !== 'hostile';
  if (t.u.awareness === 'asleep') return true;
  if (Array.isArray(t.u.noticedIds)) return !t.u.noticedIds.includes(heroId);
  return t.u.awareness !== 'hunting';
}

/** Would a melee attack by `heroId` (a Burglar) from `from` on `targetId` be a backstab (24.3)? */
export function backstabFrom(s: GameState, heroId: string, targetId: string, from: Pos): boolean {
  const d = s.delve;
  if (!d) return false;
  const cls = s.campaign.roster.find((x) => x.id === heroId)?.cls;
  if (cls !== 'burglar') return false;
  const t = stabTarget(d, targetId);
  if (!t) return false;
  const f = facingOf(t.u);
  if (f === undefined) return false;
  if (!unawareOf(d, targetId, heroId)) return false;
  return inRearHalf(t.u.at, f, from, !!t.crew) && Math.max(Math.abs(from.q - t.u.at.q), Math.abs(from.r - t.u.at.r), Math.abs(from.q + from.r - t.u.at.q - t.u.at.r)) === 1;
}

/** Was this hit (in the state before it) a backstab? */
export function wasBackstab(before: GameState, attackerId: string, targetId: string): boolean {
  const h = before.delve?.heroes.find((x) => x.heroId === attackerId);
  return !!h && backstabFrom(before, attackerId, targetId, h.at);
}

/**
 * 24.5, 27: dagger markers while a Burglar is selected: for every seen, unaware enemy on the level, its
 * neighbour hexes at its sides and straight behind it the Burglar could strike from now (where it stands, or a hex it can
 * reach). Only enemies in `seen` and currently `visible` count (24.4: nothing about unseen enemies).
 */
export function backstabSpots(s: GameState, heroId: string, reach: Pos[], seen: Set<string>, visible: Set<string>): { at: Pos; target: string }[] {
  const d = s.delve;
  const h = d?.heroes.find((x) => x.heroId === heroId);
  if (!d || !h || h.status !== 'active') return [];
  if (s.campaign.roster.find((x) => x.id === heroId)?.cls !== 'burglar') return [];
  const can = new Set([posKey(h.at), ...reach.map((p) => posKey(p))]);
  const out: { at: Pos; target: string }[] = [];
  const done = new Set<string>();
  const ids = [...d.monsters.map((m) => m.id), ...(d.rivals && d.round >= d.rivals.entersRound ? d.rivals.members.map((r) => r.id) : [])];
  for (const id of ids) {
    if (!seen.has(id)) continue;
    const t = stabTarget(d, id);
    if (!t || t.u.at.level !== h.at.level || !visible.has(posKey(t.u.at))) continue;
    if (t.crew && d.rivals?.stance === 'hired') continue;
    const f = facingOf(t.u);
    if (f === undefined || !unawareOf(d, id, heroId)) continue;
    for (const p of rearNeighbours(t.u.at, f, !!t.crew)) {
      const k = posKey(p);
      if (!can.has(k) || done.has(k)) continue;
      done.add(k);
      out.push({ at: p, target: id });
    }
  }
  return out;
}
