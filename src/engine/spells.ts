// Magic (spec 7; 1980 rules 6.0–6.38).

import { addNoise, wakeLevel } from './alarm';
import { applyWounds, moraleCheck } from './combat';
import { die } from './dice';
import { SPELLS, STATS } from './data';
import { cellAt, edgeKindAt, label, sameSquare, squareKey, step, type Dir } from './geometry';
import { adjacentSquares } from './movement';
import { openLock, isSecured } from './doors';
import { RuleError, type Ctx } from './ctx';
import type { Coord, SpellId, Unit } from './types';

export const ESP_RANGE = 4;
export const BOLT_RANGE = 4;

/** Straight line of up to 4 squares through dotted boundaries only (6.32). */
export function boltLine(ctx: Ctx, from: Coord, to: Coord): boolean {
  if (from.level !== to.level) return false;
  if (from.x !== to.x && from.y !== to.y) return false;
  const dist = Math.abs(from.x - to.x) + Math.abs(from.y - to.y);
  if (dist < 1 || dist > BOLT_RANGE) return false;
  const d: Dir = to.x > from.x ? 'e' : to.x < from.x ? 'w' : to.y > from.y ? 's' : 'n';
  let c = from;
  for (let i = 0; i < dist; i++) {
    if (edgeKindAt(ctx.map, c, d) !== 'open') return false;
    c = step(c, d);
    if (cellAt(ctx.map, c) !== 'floor') return false;
    if (i < dist - 1 && ctx.unitsAt(c).some((u) => u.cls !== 'dummy')) return false;
  }
  return true;
}

/** Squares a bolt spell can target from `from`: enemies at the end of a clear line. */
export function boltTargets(ctx: Ctx, caster: Unit): Coord[] {
  const out: Coord[] = [];
  for (const e of ctx.fighters(caster.side === 'player' ? 'castle' : 'player')) {
    if (boltLine(ctx, caster.pos, e.pos) && !out.some((c) => sameSquare(c, e.pos))) out.push(e.pos);
  }
  return out;
}

export function canCast(u: Unit, spell: SpellId): boolean {
  const casters = ['magicUser', 'evilMagicUser'];
  return casters.includes(u.cls) && u.spellPoints >= SPELLS[spell].cost;
}

export function cast(ctx: Ctx, u: Unit, spell: SpellId, target?: Coord, targetId?: string, edge?: string): void {
  if (!canCast(u, spell)) throw new RuleError(`Not enough spell points for ${SPELLS[spell].name}.`);
  if (u.actionsLeft < 1) throw new RuleError('No actions left.');
  const exp = ctx.exp;
  switch (spell) {
    case 'esp': {
      for (const e of ctx.live(u.side === 'player' ? 'castle' : 'player')) {
        if (e.pos.level !== u.pos.level) continue;
        if (Math.max(Math.abs(e.pos.x - u.pos.x), Math.abs(e.pos.y - u.pos.y)) > ESP_RANGE) continue;
        if (e.cls === 'dummy') {
          exp.units = exp.units.filter((x) => x.id !== e.id);
          ctx.emit({ type: 'died', unitId: e.id });
          ctx.log(`ESP: the noise at ${label(e.pos)} was nothing at all.`);
        } else {
          exp.revealed[e.id] = exp.turn + 1;
          ctx.log(`ESP: ${e.name} at ${label(e.pos)}.`);
        }
      }
      break;
    }
    case 'fireball':
    case 'pyrotechnics': {
      if (!target || !boltLine(ctx, u.pos, target)) throw new RuleError('Needs a straight, clear line of up to 4 squares.');
      const victims = ctx.unitsAt(target).filter((x) => x.side !== u.side && x.cls !== 'dummy');
      if (!victims.length) throw new RuleError('No enemy there.');
      if (spell === 'fireball') {
        const victim = victims.find((v) => v.id === targetId) ?? victims[0]!;
        const w = die(ctx.state) + 2;
        ctx.emit({ type: 'spell', unitId: u.id, spell, target });
        ctx.log(`${u.name} hurls a fireball at ${victim.name}: ${w} wounds!`);
        applyWounds(ctx, victim, w);
        addNoise(ctx, target, 10);
        wakeLevel(ctx, target.level);
      } else {
        ctx.emit({ type: 'spell', unitId: u.id, spell, target });
        ctx.log(`${u.name} sets off a blaze of light and noise at ${label(target)}.`);
        for (const v of victims) if (STATS[v.cls].isSquad) moraleCheck(ctx, v, 'was dazzled');
      }
      break;
    }
    case 'smokescreen': {
      if (!target || !adjacentSquares(ctx, u.pos).some((c) => sameSquare(c, target))) throw new RuleError('Smoke must fill an adjacent square.');
      exp.smoke[squareKey(target)] = 1;
      ctx.emit({ type: 'spell', unitId: u.id, spell, target });
      ctx.log(`${u.name} fills ${label(target)} with smoke.`);
      break;
    }
    case 'unlock': {
      if (!edge) throw new RuleError('Choose a door.');
      const door = exp.doors[edge];
      if (!door || !door.locked || door.destroyed) throw new RuleError('That door is not locked.');
      if (isSecured(ctx, edge, u.pos, u.side)) throw new RuleError('Someone is holding it from the other side.');
      openLock(ctx, u, door, 'unlock', `the door at ${label(u.pos)}`);
      u.actionsLeft = 0;
      return;
    }
    case 'combat': {
      const friend = targetId ? ctx.findUnit(targetId) : u;
      if (!friend || friend.side !== u.side) throw new RuleError('Choose a friend.');
      if (!sameSquare(friend.pos, u.pos) && !adjacentSquares(ctx, u.pos).some((c) => sameSquare(c, friend.pos))) throw new RuleError('Too far away.');
      exp.combatBlessing[friend.id] = true;
      ctx.emit({ type: 'spell', unitId: u.id, spell, target: friend.pos });
      ctx.log(`${u.name} blesses ${friend.name}'s next blow.`);
      break;
    }
  }
  u.spellPoints -= SPELLS[spell].cost;
  u.actionsLeft = 0;
}
