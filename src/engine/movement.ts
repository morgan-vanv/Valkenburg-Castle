// Passability, reachability and moving units (4.0, 4.5, spec 2.2).

import type { Reach } from './api';
import { MOVE_BY_ARMOR, STATS } from './data';
import { cellAt, edgeKey, neighbours, parseSquareKey, sameSquare, squareKey, type Dir } from './geometry';
import { linkedSquares, type MapIndex } from './mapIndex';
import type { Ctx } from './ctx';
import type { CastleMap, Coord, DoorState, Expedition, LevelLink, Side, Unit } from './types';

export interface Step {
  to: Coord;
  cost: number;
  /** Door edge this step passes through while closed (it opens). */
  opens?: string;
  link?: LevelLink;
}

/** Door state for an edge, if it is a door. Blasted walls appear here too. */
export function doorAt(exp: Expedition, key: string): DoorState | undefined {
  return exp.doors[key];
}

/** Is the edge on side `d` of `c` open for sight and attacks right now? */
export function edgeClear(_map: CastleMap, exp: Expedition | undefined, c: Coord, d: Dir, kind: string): boolean {
  if (kind === 'open') return true;
  const door = exp ? doorAt(exp, edgeKey(c, d)) : undefined;
  if (kind === 'wall') return door?.destroyed === true;
  return door ? door.open || door.destroyed : false;
}

/**
 * Steps a unit of `side` may take from `c` this instant, ignoring units.
 * `squad` pays 1 extra to pass a closed door (4.42).
 */
export function stepsFrom(ix: MapIndex, exp: Expedition, c: Coord, side: Side, squad: boolean): Step[] {
  const out: Step[] = [];
  for (const n of neighbours(ix.map, c)) {
    if (cellAt(ix.map, n.to) !== 'floor') continue;
    const door = exp.doors[n.key];
    if (n.edge === 'wall') {
      if (door?.destroyed) out.push({ to: n.to, cost: 1 });
      continue;
    }
    if (n.edge === 'open') {
      out.push({ to: n.to, cost: 1 });
      continue;
    }
    // door or locked
    if (!door || door.destroyed || door.open) {
      out.push({ to: n.to, cost: 1 });
      continue;
    }
    if (door.locked && side === 'player') continue;
    out.push({ to: n.to, cost: squad ? 2 : 1, opens: n.key });
  }
  for (const { to, link } of linkedSquares(ix, c)) {
    if (cellAt(ix.map, to) !== 'floor') continue;
    if (link.kind === 'stairs') out.push({ to, cost: to.level < c.level ? 2 : 1, link });
    else out.push({ to, cost: 99, link }); // ladders take the whole move (4.52)
  }
  return out;
}

export function moveAllowance(ctx: Ctx, u: Unit): number {
  let base = STATS[u.cls].isSquad ? MOVE_BY_ARMOR[u.armor] : 4;
  const c = carryInfo(u);
  if (c.immobile) return 0;
  if (c.overloaded) base -= 1;
  if (u.cls === 'dragon') base = 3;
  void ctx;
  return Math.max(0, base);
}

export function carryLimit(u: Unit): number {
  const s = STATS[u.cls];
  return s.isSquad ? u.men * s.carry : s.carry;
}

export function carryInfo(u: Unit) {
  const weight = u.loot.reduce((n, i) => n + i.weight, 0);
  const value = u.loot.reduce((n, i) => n + i.value, 0);
  const limit = carryLimit(u);
  return { weight, value, limit, overloaded: weight > limit, immobile: weight > limit * 2 };
}

/** Is any enemy (not a dummy) in a square adjacent to `c` by an open path? */
export function adjacentToEnemy(ctx: Ctx, c: Coord, side: Side): boolean {
  return adjacentSquares(ctx, c).some((sq) => ctx.hasEnemyAt(sq, side));
}

/** Squares adjacent for combat: open edge or open door, plus stair partners (5.11). */
export function adjacentSquares(ctx: Ctx, c: Coord): Coord[] {
  const out: Coord[] = [];
  const exp = ctx.state.expedition;
  for (const n of neighbours(ctx.map, c)) {
    if (cellAt(ctx.map, n.to) !== 'floor') continue;
    if (edgeClear(ctx.map, exp, c, n.dir, n.edge)) out.push(n.to);
  }
  for (const { to } of linkedSquares(ctx.ix, c)) out.push(to);
  return out;
}

/**
 * Squares the unit can reach with one move action (spec 2.2).
 * Entering a square next to an enemy ends the move there (4.2).
 */
export function reachable(ctx: Ctx, u: Unit, opts: { ignoreStop?: boolean; allowance?: number } = {}): Reach[] {
  const exp = ctx.exp;
  const allowance = opts.allowance ?? moveAllowance(ctx, u);
  if (allowance <= 0) return [];
  const squad = STATS[u.cls].isSquad;
  const myMen = squad ? u.men : 1;
  const ignoreStop = opts.ignoreStop || u.cls === 'drog';
  const best = new Map<string, { cost: number; path: Coord[] }>();
  const startKey = squareKey(u.pos);
  best.set(startKey, { cost: 0, path: [] });
  const frontier: string[] = [startKey];
  while (frontier.length) {
    frontier.sort((a, b) => best.get(a)!.cost - best.get(b)!.cost);
    const k = frontier.shift()!;
    const cur = best.get(k)!;
    const c = parseSquareKey(k);
    if (k !== startKey && !ignoreStop && adjacentToEnemy(ctx, c, u.side)) continue;
    for (const s of stepsFrom(ctx.ix, exp, c, u.side, squad)) {
      let cost = s.cost;
      if (s.link?.kind === 'ladder') {
        if (k !== startKey) continue;
        cost = allowance;
      }
      if (exp.smoke[squareKey(s.to)]) cost += 1;
      const total = cur.cost + cost;
      if (total > allowance) continue;
      if (ctx.hasEnemyAt(s.to, u.side)) continue;
      if (u.homeArea !== undefined && ctx.ix.areaBySquare.get(squareKey(s.to)) !== u.homeArea) continue;
      if (u.cls === 'dragon' && forbiddenForDragon(s.to)) continue;
      const nk = squareKey(s.to);
      const prev = best.get(nk);
      if (prev && prev.cost <= total) continue;
      best.set(nk, { cost: total, path: [...cur.path, s.to] });
      if (s.link?.kind !== 'ladder') frontier.push(nk);
    }
  }
  const out: Reach[] = [];
  for (const [k, v] of best) {
    if (k === startKey) continue;
    const to = parseSquareKey(k);
    if (ctx.menIn(to, u.side) + myMen > 12) continue;
    out.push({ to, cost: v.cost, path: v.path });
  }
  return out;
}

/** The dragon can never enter the narrow cave openings (8.6). */
function forbiddenForDragon(c: Coord): boolean {
  return c.level === 3 && ((c.x === 15 && c.y === 5) || (c.x === 19 && c.y === 1) || (c.x === 15 && c.y === 9));
}

/**
 * Walk a unit along a path, opening doors it passes. `onStep` runs after each
 * step and returns false to stop the walk early (for overwatch).
 */
export function walk(ctx: Ctx, u: Unit, path: Coord[], onStep?: (c: Coord) => boolean): Coord[] {
  const walked: Coord[] = [];
  for (const next of path) {
    const steps = stepsFrom(ctx.ix, ctx.exp, u.pos, u.side, STATS[u.cls].isSquad);
    const step = steps.find((s) => sameSquare(s.to, next));
    if (!step) break;
    if (step.opens) {
      const door = ctx.exp.doors[step.opens]!;
      door.open = true;
      ctx.emit({ type: 'doorOpened', edge: step.opens });
    }
    u.pos = next;
    u.movedThisTurn += 1;
    walked.push(next);
    if (onStep && !onStep(next)) break;
    if (u.exited) break;
  }
  if (walked.length) ctx.emit({ type: 'moved', unitId: u.id, path: walked });
  return walked;
}

/** Shortest path for AI and fleeing, ignoring move allowance. */
export function pathTo(ctx: Ctx, u: Unit, goal: (c: Coord) => boolean, maxCost = 60): Coord[] | undefined {
  const squad = STATS[u.cls].isSquad;
  const startKey = squareKey(u.pos);
  const prev = new Map<string, string | null>([[startKey, null]]);
  const dist = new Map<string, number>([[startKey, 0]]);
  const frontier = [startKey];
  while (frontier.length) {
    frontier.sort((a, b) => dist.get(a)! - dist.get(b)!);
    const k = frontier.shift()!;
    const c = parseSquareKey(k);
    if (k !== startKey && goal(c)) {
      const path: Coord[] = [];
      let cur: string | null = k;
      while (cur && cur !== startKey) {
        path.unshift(parseSquareKey(cur));
        cur = prev.get(cur) ?? null;
      }
      return path;
    }
    for (const s of stepsFrom(ctx.ix, ctx.exp, c, u.side, squad)) {
      if (s.link?.kind === 'ladder') continue;
      const nk = squareKey(s.to);
      const d = dist.get(k)! + Math.min(s.cost, 2);
      if (d > maxCost) continue;
      if (ctx.hasEnemyAt(s.to, u.side)) continue;
      if (u.homeArea !== undefined && ctx.ix.areaBySquare.get(nk) !== u.homeArea) continue;
      if (dist.has(nk) && dist.get(nk)! <= d) continue;
      dist.set(nk, d);
      prev.set(nk, k);
      frontier.push(nk);
    }
  }
  return undefined;
}
