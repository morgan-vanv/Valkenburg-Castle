// Doors and chests: pick, smash, chop, unlock, blast (spec 3.2; 4.4–4.47, 8.3, 8.5).

import { addNoise, wakeLevel } from './alarm';
import { applyWounds, kill } from './combat';
import { die } from './dice';
import { smashResult, STATS } from './data';
import { cellAt, edgeKey, edgeKindAt, edgeSquares, label, sameSquare, step, DIRS, type Dir } from './geometry';
import { RuleError, type Ctx } from './ctx';
import type { Coord, DoorMethod, DoorState, Unit } from './types';

/** Edge keys of door-like edges on the sides of a square. */
export function doorEdgesAround(ctx: Ctx, c: Coord): { key: string; dir: Dir; door: DoorState }[] {
  const out: { key: string; dir: Dir; door: DoorState }[] = [];
  for (const d of DIRS) {
    const n = step(c, d);
    if (cellAt(ctx.map, n) !== 'floor') continue;
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

/** Locked with an enemy holding the far side (4.43). */
export function isSecured(ctx: Ctx, edge: string, from: Coord, side: 'player' | 'castle'): boolean {
  const door = ctx.exp.doors[edge];
  if (!door || !door.locked || door.destroyed) return false;
  return ctx.hasEnemyAt(across(edge, from), side);
}

/** Which methods this unit could use on this door right now. */
export function doorMethods(ctx: Ctx, u: Unit, edge: string): DoorMethod[] {
  const door = ctx.exp.doors[edge];
  if (!door || door.destroyed || !door.locked || door.open) return [];
  const secured = isSecured(ctx, edge, u.pos, 'player');
  const out: DoorMethod[] = [];
  if (u.cls === 'burglar' && !door.jammed && !secured) out.push('pick');
  if (u.cls === 'magicUser' && u.spellPoints >= 2 && !secured) out.push('unlock');
  if (!door.unsmashable) out.push('smash');
  out.push('chop');
  if (u.cls === 'dwarf' && u.charges > 0) out.push('blast');
  return out;
}

/** Men a unit contributes to a smash attempt (the Dwarf counts as 2). */
function smashMen(u: Unit): number {
  if (u.cls === 'dwarf') return 2;
  return STATS[u.cls].isSquad ? Math.min(3, u.men) : 1;
}

export function openLock(ctx: Ctx, u: Unit, door: DoorState, method: Exclude<DoorMethod, 'blast'>, what: string, helpers: Unit[] = []): boolean {
  switch (method) {
    case 'pick': {
      if (u.cls !== 'burglar') throw new RuleError('Only a Burglar can pick locks.');
      if (door.jammed) throw new RuleError('This lock can never be picked.');
      const r = die(ctx.state);
      if (r <= 3) {
        door.locked = false;
        ctx.log(`${u.name} picks the lock of ${what}.`);
        return true;
      }
      if (r === 6) {
        door.jammed = true;
        ctx.log(`${u.name} finds a lock he can never pick.`);
      } else ctx.log(`${u.name} fails to pick the lock, for now.`);
      return false;
    }
    case 'unlock': {
      if (u.cls !== 'magicUser' || u.spellPoints < 2) throw new RuleError('Needs a Magic User with 2 spell points.');
      u.spellPoints -= 2;
      door.locked = false;
      ctx.emit({ type: 'spell', unitId: u.id, spell: 'unlock' });
      ctx.log(`${u.name} speaks a word and ${what} unlocks.`);
      return true;
    }
    case 'smash': {
      if (door.unsmashable) throw new RuleError('This will never break by smashing.');
      const men = Math.min(3, smashMen(u) + helpers.reduce((n, h) => n + smashMen(h), 0));
      const r = die(ctx.state);
      const res = smashResult(r, men);
      addNoise(ctx, u.pos, 6);
      if (res === 'S') {
        door.locked = false;
        door.open = true;
        ctx.log(`${men} men smash ${what} open.`);
        return true;
      }
      if (res === 'X') {
        door.unsmashable = true;
        ctx.log(`${what} will never give way to smashing.`);
      } else ctx.log(`${what} holds against the smashing.`);
      return false;
    }
    case 'chop': {
      const r = die(ctx.state);
      door.chop += r;
      addNoise(ctx, u.pos, 4);
      if (door.chop >= 10) {
        door.destroyed = true;
        door.locked = false;
        door.open = true;
        ctx.log(`${u.name} hacks ${what} to splinters.`);
        return true;
      }
      ctx.log(`${u.name} chops at ${what} (${door.chop}/10).`);
      return false;
    }
  }
}

export function doorAction(ctx: Ctx, u: Unit, edge: string, method: DoorMethod, helperIds: string[] = []): void {
  const door = ctx.exp.doors[edge];
  const [a, b] = edgeSquares(edge);
  if (!sameSquare(u.pos, a) && !sameSquare(u.pos, b)) throw new RuleError('Not next to that door.');
  if (u.actionsLeft < 1) throw new RuleError('No actions left.');
  if (method === 'blast') {
    if (door?.destroyed) throw new RuleError('Nothing left to blast.');
    if (!door && !blastableWall(ctx, edge)) throw new RuleError('The outer walls are too thick to blast.');
  } else {
    if (!door) throw new RuleError('There is no door there.');
    if (door.destroyed || !door.locked) throw new RuleError('That door is not locked.');
  }
  if ((method === 'pick' || method === 'unlock') && isSecured(ctx, edge, u.pos, 'player')) {
    throw new RuleError('Someone is holding it from the other side: it must be forced.');
  }
  const what = `the door at ${label(u.pos)}`;
  if (method === 'blast') {
    if (u.cls !== 'dwarf' || u.charges < 1) throw new RuleError('Only the Dwarf can set charges.');
    u.charges -= 1;
    ctx.exp.charges.push({ edge, pos: { ...u.pos } });
    u.actionsLeft -= 1;
    ctx.log(`${u.name} sets a charge against ${what}. Clear the square!`);
    ctx.emit({ type: 'doorAttempt', unitId: u.id, edge, method, success: true, detail: 'Charge set' });
    return;
  }
  const helpers = helperIds
    .map((id) => ctx.findUnit(id))
    .filter((h): h is Unit => !!h && h.side === 'player' && sameSquare(h.pos, u.pos) && h.id !== u.id);
  const ok = openLock(ctx, u, door!, method, what, method === 'smash' ? helpers : []);
  if (method === 'unlock') u.actionsLeft = 0;
  else u.actionsLeft -= 1;
  ctx.emit({ type: 'doorAttempt', unitId: u.id, edge, method, success: ok, detail: method });
  if (ok && door!.destroyed) ctx.emit({ type: 'doorDestroyed', edge });
  else if (ok && door!.open) ctx.emit({ type: 'doorOpened', edge });
}

/** Detonate charges set this player phase (8.52–8.54). */
export function detonateCharges(ctx: Ctx): void {
  const exp = ctx.exp;
  for (const ch of exp.charges) {
    const [a, b] = edgeSquares(ch.edge);
    const far = sameSquare(a, ch.pos) ? b : a;
    const door = exp.doors[ch.edge] ?? (exp.doors[ch.edge] = { open: false, locked: false, destroyed: false, jammed: false, unsmashable: false, chop: 0 });
    const wasDoor = edgeKindAtKey(ctx, ch.edge) !== 'wall';
    door.destroyed = true;
    door.open = true;
    door.locked = false;
    ctx.emit({ type: 'explosion', at: ch.pos });
    ctx.emit({ type: 'doorDestroyed', edge: ch.edge });
    ctx.log(`The charge at ${label(ch.pos)} goes off!`);
    for (const u of ctx.unitsAt(ch.pos)) if (u.cls !== 'dummy') kill(ctx, u);
    // Blast carries on through the far square and onward in a line.
    const dir = dirFrom(ch.pos, far);
    let c = far;
    let penalty = wasDoor ? 2 : 4;
    for (let i = 0; i < 3 && cellAt(ctx.map, c) === 'floor'; i++) {
      for (const u of ctx.unitsAt(c)) {
        if (u.cls === 'dummy') continue;
        const w = die(ctx.state) - penalty;
        if (w > 0) applyWounds(ctx, u, w);
      }
      penalty += 1;
      if (!dir) break;
      c = step(c, dir);
    }
    addNoise(ctx, ch.pos, 15);
    for (const lvl of [ch.pos.level - 1, ch.pos.level, ch.pos.level + 1]) wakeLevel(ctx, lvl);
  }
  exp.charges = [];
}

function dirFrom(a: Coord, b: Coord): Dir | undefined {
  if (b.x > a.x) return 'e';
  if (b.x < a.x) return 'w';
  if (b.y > a.y) return 's';
  if (b.y < a.y) return 'n';
  return undefined;
}

function edgeKindAtKey(ctx: Ctx, key: string) {
  const [a, b] = edgeSquares(key);
  const d = dirFrom(a, b)!;
  return edgeKindAt(ctx.map, a, d);
}

/** Can a charge be set against this wall? Outer walls are too thick (8.53). */
export function blastableWall(ctx: Ctx, key: string): boolean {
  const [a, b] = edgeSquares(key);
  return cellAt(ctx.map, a) === 'floor' && cellAt(ctx.map, b) === 'floor';
}

/** Doors swing shut at the end of the castle phase unless someone stands in the doorway (4.47). */
export function closeDoors(ctx: Ctx): void {
  for (const [key, door] of Object.entries(ctx.exp.doors)) {
    if (!door.open || door.destroyed) continue;
    const [a, b] = edgeSquares(key);
    if (ctx.unitsAt(a).some((u) => u.cls !== 'dummy') || ctx.unitsAt(b).some((u) => u.cls !== 'dummy')) continue;
    door.open = false;
    ctx.emit({ type: 'doorClosed', edge: key });
  }
}

