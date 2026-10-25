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

/** The tile under a pos, for callers without a LevelView. */
export function tileAt(castle: CastleDef, p: Pos): TileDef | undefined {
  return castle.levels.find((l) => l.level === p.level)?.tiles[hexKey(p)];
}

/** posKeys of blown entries that were built walls (they show as rubble, spec 20.3). */
export function blownWalls(castle: CastleDef, blown: string[]): Set<string> {
  const out = new Set<string>();
  for (const k of blown) {
    const [l, rest] = k.split(':');
    const [q, r] = (rest ?? '').split(',').map(Number);
    const p = { level: Number(l), q: q ?? 0, r: r ?? 0 };
    if (tileAt(castle, p)?.kind === 'wall') out.add(posKey(p));
  }
  return out;
}
