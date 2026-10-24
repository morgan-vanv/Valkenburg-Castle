// The Alarm meter, noise, waking and spotting (spec 4, 1980 rule 9.11).

import { ALARM_TIERS, NOISE } from './data';
import { squareKey } from './geometry';
import { areaAt } from './mapIndex';
import { pathTo } from './movement';
import { canSee } from './sight';
import type { Ctx } from './ctx';
import type { AlarmTier, Coord, Unit } from './types';

export function tierOf(alarm: number): AlarmTier {
  let t: AlarmTier = 'Quiet';
  for (const row of ALARM_TIERS) if (alarm >= row.min) t = row.tier;
  return t;
}

export function tierIndex(t: AlarmTier): number {
  return ALARM_TIERS.findIndex((r) => r.tier === t);
}

export function addNoise(ctx: Ctx, at: Coord | undefined, amount: number): void {
  const exp = ctx.exp;
  if (at) exp.noiseThisTurn.push(at);
  if (amount <= 0) return;
  const from = exp.alarm;
  const to = Math.min(100, from + amount);
  if (to === from) return;
  exp.alarm = to;
  const tier = tierOf(to);
  const tierChanged = tier !== tierOf(from);
  ctx.emit({ type: 'alarm', from, to, tier, tierChanged });
}

export function wake(ctx: Ctx, u: Unit): void {
  if (!u.dormant || u.side !== 'castle') return;
  u.dormant = false;
  ctx.emit({ type: 'woke', unitId: u.id });
}

export function wakeLevel(ctx: Ctx, level: number): void {
  for (const u of ctx.fighters('castle')) if (u.pos.level === level) wake(ctx, u);
}

function isGuardroomUnit(ctx: Ctx, u: Unit): boolean {
  if (!u.post) return false;
  return areaAt(ctx.ix, u.post)?.isGuardroom === true;
}

/** Tier wake rules, applied at the start of each castle phase. */
export function applyTierWakes(ctx: Ctx): void {
  const exp = ctx.exp;
  const t = tierIndex(tierOf(exp.alarm));
  const guards = ctx.fighters('castle').filter((u) => u.dormant && isGuardroomUnit(ctx, u));
  if (t >= 1 && exp.noiseThisTurn.length) {
    const noise = new Set(exp.noiseThisTurn.map(squareKey));
    for (const g of guards) {
      const p = pathTo(ctx, g, (c) => noise.has(squareKey(c)), 8);
      if (p || noise.has(squareKey(g.pos))) wake(ctx, g);
    }
  }
  if (t >= 2) {
    const levels = new Set(ctx.fighters('player').map((u) => u.pos.level));
    for (const g of guards) if (levels.has(g.pos.level)) wake(ctx, g);
  }
  if (t >= 4) for (const u of ctx.fighters('castle')) if (!u.homeArea) wake(ctx, u);
}

/**
 * Enemies that can see player units wake up; the first sighting of each
 * player unit raises the Alarm (+5). Monsters wake when someone enters
 * their room; the dragon when someone comes within 3 squares.
 */
export function checkSpotting(ctx: Ctx): void {
  const exp = ctx.exp;
  const players = ctx.fighters('player');
  for (const e of ctx.fighters('castle')) {
    if (e.homeArea !== undefined) {
      const intruder = players.some((p) => ctx.ix.areaBySquare.get(squareKey(p.pos)) === e.homeArea);
      const near = e.cls === 'dragon' && players.some((p) => p.pos.level === e.pos.level && Math.max(Math.abs(p.pos.x - e.pos.x), Math.abs(p.pos.y - e.pos.y)) <= 3);
      if (e.dormant && (e.cls === 'dragon' ? near : intruder)) {
        wake(ctx, e);
        ctx.log(`${e.name} stirs.`);
      }
      continue;
    }
    if (e.asleepTurns > 0) continue;
    for (const p of players) {
      if (!canSee(ctx, e, p.pos)) continue;
      if (e.dormant) wake(ctx, e);
      if (!exp.spotted[p.id]) {
        exp.spotted[p.id] = true;
        ctx.emit({ type: 'spotted', unitId: p.id });
        ctx.log(`${p.name} has been spotted.`);
        addNoise(ctx, e.pos, NOISE.spotted);
      }
    }
  }
}
