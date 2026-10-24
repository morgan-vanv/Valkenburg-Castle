// Doors (V2): plain doors open by walking. Locked doors: the Burglar picks
// one silently, anyone forces one loudly, a blasting charge destroys it.
// No smash tables, chop counters or jammed locks.

import { addNoise, wakeLevel } from './alarm';
import { applyWounds, kill } from './combat';
import { die } from './dice';
import { NOISE } from './data';
import { cellAt, edgeKey, edgeKindAt, edgeSquares, label, sameSquare, step, DIRS, type Dir } from './geometry';
import { RuleError, type Ctx } from './ctx';
import type { Coord, DoorMethod, DoorState, Unit } from './types';

/** Door edges on the sides of a square. */
export function doorEdgesAround(ctx: Ctx, c: Coord): { key: string; dir: Dir; door: DoorState }[] {
  const out: { key: string; dir: Dir; door: DoorState }[] = [];
  for (const d of DIRS) {
    if (cellAt(ctx.map, step(c, d)) !== 'floor') continue;
    const kind = edgeKindAt(ctx.map, c, d);
    if (kind !== 'door' && kind !== 'locked') continue;
    const key = edgeKey(c, d);
    const door = ctx.exp.doors[key];
    if (door) out.push({ key, dir: d, door });
  }
  return out;
}

/** The square on the other side of an edge from `c`. */
export function across(edge: string, c: Coord): Coord {
  const [a, b] = edgeSquares(edge);
  return sameSquare(a, c) ? b : a;
}

/** Locked with an enemy holding the far side: it can't be picked, only forced or blasted. */
export function isSecured(ctx: Ctx, edge: string, from: Coord, side: 'player' | 'castle'): boolean {
  const door = ctx.exp.doors[edge];
  if (!door || !door.locked || door.destroyed) return false;
  return ctx.hasEnemyAt(across(edge, from), side);
}

/** Which methods this unit can use on this locked door right now. */
export function doorMethods(ctx: Ctx, u: Unit, edge: string): DoorMethod[] {
  const door = ctx.exp.doors[edge];
  if (!door || door.destroyed || !door.locked || door.open) return [];
  const out: DoorMethod[] = [];
  if (u.cls === 'burglar' && !isSecured(ctx, edge, u.pos, 'player')) out.push('pick');
  out.push('force');
  if (ctx.exp.pack.charge > 0) out.push('blast');
  return out;
}

export function doorAction(ctx: Ctx, u: Unit, edge: string, method: DoorMethod): void {
  const door = ctx.exp.doors[edge];
  const [a, b] = edgeSquares(edge);
  if (!sameSquare(u.pos, a) && !sameSquare(u.pos, b)) throw new RuleError('Not next to that.');
  if (u.actionsLeft < 1) throw new RuleError('No actions left.');
  const where = label(u.pos);
  if (method === 'blast') {
    if (ctx.exp.pack.charge < 1) throw new RuleError('No blasting charges left.');
    if (door?.destroyed) throw new RuleError('Nothing left to blast.');
    if (!door && !blastableWall(ctx, edge)) throw new RuleError('The outer walls are too thick to blast.');
    ctx.exp.pack.charge -= 1;
    ctx.exp.charges.push({ edge, pos: { ...u.pos } });
    u.actionsLeft -= 1;
    ctx.log(`${u.name} sets a charge at ${where}. It blows at the end of your turn: clear the square!`);
    ctx.emit({ type: 'doorAttempt', unitId: u.id, edge, method, success: true, detail: 'Charge set' });
    return;
  }
  if (!door || door.destroyed || !door.locked) throw new RuleError('That door is not locked.');
  if (method === 'pick') {
    if (u.cls !== 'burglar') throw new RuleError('Only the Burglar can pick locks.');
    if (isSecured(ctx, edge, u.pos, 'player')) throw new RuleError('Someone is holding it from the other side: force it or blast it.');
    door.locked = false;
    door.open = true;
    u.actionsLeft -= 1;
    ctx.log(`${u.name} picks the lock at ${where} without a sound.`);
  } else {
    door.locked = false;
    door.open = true;
    u.actionsLeft -= 1;
    addNoise(ctx, u.pos, NOISE.force);
    ctx.log(`${u.name} forces the door at ${where}. That was loud.`);
  }
  ctx.emit({ type: 'doorAttempt', unitId: u.id, edge, method, success: true, detail: method });
  ctx.emit({ type: 'doorOpened', edge });
}

/** Detonate charges set this player phase. */
export function detonateCharges(ctx: Ctx): void {
  const exp = ctx.exp;
  for (const ch of exp.charges) {
    const [a, b] = edgeSquares(ch.edge);
    const far = sameSquare(a, ch.pos) ? b : a;
    const door = exp.doors[ch.edge] ?? (exp.doors[ch.edge] = { open: false, locked: false, destroyed: false, jammed: false, unsmashable: false, chop: 0 });
    door.destroyed = true;
    door.open = true;
    door.locked = false;
    ctx.emit({ type: 'explosion', at: ch.pos });
    ctx.emit({ type: 'doorDestroyed', edge: ch.edge });
    ctx.log(`The charge at ${label(ch.pos)} goes off!`);
    for (const u of ctx.unitsAt(ch.pos)) if (u.cls !== 'dummy') kill(ctx, u);
    // The blast hits whoever stands just beyond: d6 − 2 wounds.
    for (const u of ctx.unitsAt(far)) {
      if (u.cls === 'dummy') continue;
      const w = die(ctx.state) - 2;
      if (w > 0) applyWounds(ctx, u, w);
    }
    addNoise(ctx, ch.pos, NOISE.blast);
    wakeLevel(ctx, ch.pos.level);
  }
  exp.charges = [];
}

/** Can a charge be set against this wall? Only walls between two floor squares. */
export function blastableWall(ctx: Ctx, key: string): boolean {
  const [a, b] = edgeSquares(key);
  return cellAt(ctx.map, a) === 'floor' && cellAt(ctx.map, b) === 'floor';
}

/** Doors swing shut at the end of the castle phase unless someone stands in the doorway. */
export function closeDoors(ctx: Ctx): void {
  for (const [key, door] of Object.entries(ctx.exp.doors)) {
    if (!door.open || door.destroyed) continue;
    const [a, b] = edgeSquares(key);
    if (ctx.unitsAt(a).some((u) => u.cls !== 'dummy') || ctx.unitsAt(b).some((u) => u.cls !== 'dummy')) continue;
    door.open = false;
    ctx.emit({ type: 'doorClosed', edge: key });
  }
}
