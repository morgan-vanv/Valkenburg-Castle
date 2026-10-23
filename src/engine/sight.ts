// Line of sight, light and fog of war (spec 3.3, 5.35).

import type { Visibility } from './api';
import { cellAt, edgeKindAt, sameSquare, squareKey, type Dir } from './geometry';
import { linkedSquares } from './mapIndex';
import { edgeClear, stepsFrom } from './movement';
import type { Ctx } from './ctx';
import type { Coord, Unit } from './types';

export const SIGHT_RADIUS = 6;
export const CONTACT_RANGE = 8;

function blocksSight(ctx: Ctx, c: Coord): boolean {
  if (cellAt(ctx.map, c) === 'rock') return true;
  return Boolean(ctx.state.expedition?.smoke[squareKey(c)]);
}

/** Set while tracing a line, to report doorways crossed. */
let crossedDoor = false;

function crossOk(ctx: Ctx, c: Coord, d: Dir): boolean {
  const kind = edgeKindAt(ctx.map, c, d);
  const ok = edgeClear(ctx.map, ctx.state.expedition, c, d, kind);
  if (ok && kind !== 'open') crossedDoor = true;
  return ok;
}

/** Line of sight that also reports whether it passes through a doorway (5.36). */
export function sightLine(ctx: Ctx, a: Coord, b: Coord): { clear: boolean; throughDoor: boolean } {
  crossedDoor = false;
  const clear = lineOfSight(ctx, a, b);
  return { clear, throughDoor: crossedDoor };
}

/**
 * Line of sight between the centres of two squares on the same level.
 * Walls, closed doors, rock and smoke (in between) block it. A line that
 * passes exactly through a corner needs one of the two ways round clear.
 */
export function lineOfSight(ctx: Ctx, a: Coord, b: Coord): boolean {
  if (a.level !== b.level) return false;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const nx = Math.abs(dx);
  const ny = Math.abs(dy);
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  const xDir: Dir = sx > 0 ? 'e' : 'w';
  const yDir: Dir = sy > 0 ? 's' : 'n';
  let x = a.x;
  let y = a.y;
  let ix = 0;
  let iy = 0;
  const L = a.level;
  while (ix < nx || iy < ny) {
    const decision = (1 + 2 * ix) * ny - (1 + 2 * iy) * nx;
    if (decision === 0) {
      const here = { level: L, x, y };
      const viaX = { level: L, x: x + sx, y };
      const viaY = { level: L, x, y: y + sy };
      const okA = crossOk(ctx, here, xDir) && !blocksSight(ctx, viaX) && crossOk(ctx, viaX, yDir);
      const okB = crossOk(ctx, here, yDir) && !blocksSight(ctx, viaY) && crossOk(ctx, viaY, xDir);
      if (!okA && !okB) return false;
      x += sx;
      y += sy;
      ix++;
      iy++;
    } else if (decision < 0) {
      if (!crossOk(ctx, { level: L, x, y }, xDir)) return false;
      x += sx;
      ix++;
    } else {
      if (!crossOk(ctx, { level: L, x, y }, yDir)) return false;
      y += sy;
      iy++;
    }
    const c = { level: L, x, y };
    if (!sameSquare(c, b) && blocksSight(ctx, c)) return false;
    if (cellAt(ctx.map, c) === 'rock') return false;
  }
  return true;
}

/** Squares a unit at `from` can see. */
export function sightFrom(ctx: Ctx, from: Coord, radius = SIGHT_RADIUS): Coord[] {
  const out: Coord[] = [from];
  const lv = ctx.map.levels.find((l) => l.id === from.level);
  if (!lv) return out;
  for (let y = Math.max(0, from.y - radius); y <= Math.min(lv.height - 1, from.y + radius); y++) {
    for (let x = Math.max(lv.x0, from.x - radius); x <= Math.min(lv.x0 + lv.width - 1, from.x + radius); x++) {
      if (x === from.x && y === from.y) continue;
      const c = { level: from.level, x, y };
      if (cellAt(ctx.map, c) === 'rock') continue;
      if (lineOfSight(ctx, from, c)) out.push(c);
    }
  }
  for (const { to } of linkedSquares(ctx.ix, from)) out.push(to);
  return out;
}

export function canSee(ctx: Ctx, viewer: Unit, target: Coord, radius = SIGHT_RADIUS): boolean {
  if (viewer.pos.level !== target.level) return linkedSquares(ctx.ix, viewer.pos).some((l) => sameSquare(l.to, target));
  if (Math.max(Math.abs(viewer.pos.x - target.x), Math.abs(viewer.pos.y - target.y)) > radius) return false;
  return lineOfSight(ctx, viewer.pos, target);
}

/** Recompute what the player sees and update explored squares. */
export function playerVisible(ctx: Ctx, record = true): Set<string> {
  const visible = new Set<string>();
  for (const u of ctx.fighters('player')) {
    for (const c of sightFrom(ctx, u.pos)) visible.add(squareKey(c));
  }
  if (record && ctx.state.expedition) for (const k of visible) ctx.state.expedition.explored[k] = true;
  return visible;
}

/** Path distance (steps) from any player unit, castle passability, up to `max`. */
function distanceFromPlayers(ctx: Ctx, max: number): Map<string, number> {
  const dist = new Map<string, number>();
  const queue: Coord[] = [];
  for (const u of ctx.fighters('player')) {
    const k = squareKey(u.pos);
    if (!dist.has(k)) {
      dist.set(k, 0);
      queue.push(u.pos);
    }
  }
  while (queue.length) {
    const c = queue.shift()!;
    const d = dist.get(squareKey(c))!;
    if (d >= max) continue;
    for (const s of stepsFrom(ctx.ix, ctx.exp, c, 'castle', false)) {
      const k = squareKey(s.to);
      if (dist.has(k)) continue;
      dist.set(k, d + 1);
      queue.push(s.to);
    }
  }
  return dist;
}

export function visibility(ctx: Ctx): Visibility {
  const exp = ctx.exp;
  const visible = playerVisible(ctx, false);
  const explored = new Set([...Object.keys(exp.explored), ...visible]);
  const enemies: Unit[] = [];
  const contacts: { unitId: string; pos: Coord }[] = [];
  const near = distanceFromPlayers(ctx, CONTACT_RANGE);
  for (const u of ctx.live('castle')) {
    const k = squareKey(u.pos);
    const revealed = (exp.revealed[u.id] ?? -1) >= exp.turn;
    if (u.cls !== 'dummy' && (visible.has(k) || revealed)) enemies.push(u);
    else if ((!u.dormant || u.cls === 'dummy') && near.has(k)) contacts.push({ unitId: u.id, pos: u.pos });
  }
  return { visible, explored, enemies, contacts };
}
