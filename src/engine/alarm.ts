// The Alarm meter, noise, waking and spotting (spec 4, 1980 rule 9.11).

import { ALARM_TIERS, NOISE } from './data';
import { squareKey } from './geometry';
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

/** Tier wake rules, applied at the start of each castle phase (V2: no guardrooms needed). */
export function applyTierWakes(ctx: Ctx): void {
  const exp = ctx.exp;
  const t = tierIndex(tierOf(exp.alarm));
  const sleepers = ctx.fighters('castle').filter((u) => u.dormant && !u.leash);
  if (t >= 1 && exp.noiseThisTurn.length) {
    const noise = new Set(exp.noiseThisTurn.map(squareKey));
    for (const g of sleepers) {
      const p = pathTo(ctx, g, (c) => noise.has(squareKey(c)), 10);
      if (p || noise.has(squareKey(g.pos))) wake(ctx, g);
    }
  }
  if (t >= 2) {
    const levels = new Set(ctx.fighters('player').map((u) => u.pos.level));
    for (const g of sleepers) if (levels.has(g.pos.level)) wake(ctx, g);
  }
  if (t >= 4) for (const u of sleepers) wake(ctx, u);
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
    if (e.leash) {
      // Monsters wake when someone comes within 4 squares of them and in sight.
      const near = players.some((p) => p.pos.level === e.pos.level && Math.abs(p.pos.x - e.pos.x) + Math.abs(p.pos.y - e.pos.y) <= 4 && canSee(ctx, e, p.pos));
      if (e.dormant && near) {
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
