// Frontage, attack modifiers, slots and Focus, wounds, death and morale
// (spec 2.3–2.6; 1980 rules 5.0–5.4).

import type { AttackPreview } from './api';
import { addNoise, wake } from './alarm';
import { chance } from './dice';
import { STATS } from './data';
import { cellAt, dirBetween, edgeKindAt, sameSquare, squareKey, step, type Dir } from './geometry';
import { linkedSquares } from './mapIndex';
import { adjacentSquares, carryInfo, carryLimit, reachable, walk } from './movement';
import { sightLine } from './sight';
import { RuleError, type Ctx } from './ctx';
import type { Coord, Frontage, Modifier, RollResult, Unit } from './types';

const OPPOSITE: Record<Dir, Dir> = { n: 's', s: 'n', e: 'w', w: 'e' };
const PERP: Record<Dir, Dir[]> = { n: ['e', 'w'], s: ['e', 'w'], e: ['n', 's'], w: ['n', 's'] };

export const MISSILE_RANGE = 8;

export function maxFocus(u: Unit): number {
  if (u.side !== 'player') return 0;
  return STATS[u.cls].isSquad ? 1 : 3;
}

export function gainFocus(ctx: Ctx, u: Unit, reason: string): void {
  const cap = maxFocus(u);
  if (u.focus >= cap) return;
  u.focus += 1;
  ctx.emit({ type: 'focus', unitId: u.id, amount: 1, reason });
}

export function isAdjacent(ctx: Ctx, a: Unit, b: Unit): boolean {
  return adjacentSquares(ctx, a.pos).some((c) => sameSquare(c, b.pos));
}

function viaLink(ctx: Ctx, a: Coord, b: Coord): boolean {
  return linkedSquares(ctx.ix, a).some((l) => sameSquare(l.to, b));
}

function squareOpen(ctx: Ctx, c: Coord): boolean {
  return cellAt(ctx.map, c) === 'floor' && ctx.unitsAt(c).filter((u) => u.cls !== 'dummy').length === 0;
}

/** Frontal aspect across the edge between two adjacent squares (5.12). */
export function frontage(ctx: Ctx, from: Coord, to: Coord): Frontage {
  if (from.level !== to.level || viaLink(ctx, from, to)) return 'narrow';
  const d = dirBetween(from, to);
  if (!d) return 'narrow';
  if (edgeKindAt(ctx.map, from, d) !== 'open') return 'narrow';
  for (const side of PERP[d]) {
    const fa = step(from, side);
    const fb = step(to, side);
    if (!squareOpen(ctx, fa) || !squareOpen(ctx, fb)) continue;
    if (edgeKindAt(ctx.map, from, side) !== 'open') continue;
    if (edgeKindAt(ctx.map, to, side) !== 'open') continue;
    if (edgeKindAt(ctx.map, fa, d) !== 'open') continue;
    return 'open';
  }
  return 'wide';
}

function chebyshev(a: Coord, b: Coord): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function isLeader(u: Unit): boolean {
  return STATS[u.cls].leaderBonus > 0;
}

/** Best leader bonus from friends in or next to `u`'s square (5.242). */
function leaderBonusFor(ctx: Ctx, u: Unit): { value: number; name: string } | undefined {
  const squares = [u.pos, ...adjacentSquares(ctx, u.pos)];
  let best: { value: number; name: string } | undefined;
  for (const c of squares) {
    for (const f of ctx.unitsAt(c)) {
      if (f.side !== u.side || f.id === u.id || !isLeader(f)) continue;
      const v = STATS[f.cls].leaderBonus;
      if (!best || v > best.value) best = { value: v, name: f.name };
    }
  }
  return best;
}

function carriesEnchanted(u: Unit): boolean {
  return u.enchanted || u.loot.some((i) => i.enchanted);
}

export interface AttackPlan {
  ok: boolean;
  reason?: string;
  frontage: Frontage;
  slots: number;
  chance: number;
  modifiers: Modifier[];
  doubled: boolean;
}

export function planAttack(ctx: Ctx, a: Unit, t: Unit, kind: 'melee' | 'missile'): AttackPlan {
  const fail = (reason: string): AttackPlan => ({ ok: false, reason, frontage: 'wide', slots: 0, chance: 0, modifiers: [], doubled: false });
  if (a.side === t.side) return fail('That is a friend.');
  if (t.cls === 'dummy') return fail('Nothing is there.');
  if (a.asleepTurns > 0) return fail('Asleep.');
  const sa = STATS[a.cls];
  const mods: Modifier[] = [];
  let front: Frontage = 'wide';
  let slots = 0;
  if (kind === 'melee') {
    if (!isAdjacent(ctx, a, t)) return fail('Not adjacent.');
    front = frontage(ctx, a.pos, t.pos);
    if (sa.isSquad) {
      if (a.men <= 1) slots = 1;
      else {
        const f = a.men <= 2 && front === 'open' ? 'wide' : front;
        slots = Math.min(a.men, f === 'narrow' ? 1 : f === 'wide' ? 2 : 3);
      }
    } else slots = sa.meleeSlots;
    if (a.movedThisTurn >= 2 || a.cls === 'berserker') mods.push({ label: 'Charging', value: 10 });
    const d = dirBetween(t.pos, a.pos);
    if (d) {
      const behind = step(t.pos, OPPOSITE[d]);
      if (ctx.unitsAt(behind).some((f) => f.side === a.side && f.cls !== 'dummy' && f.id !== a.id) && adjacentSquares(ctx, t.pos).some((c) => sameSquare(c, behind))) {
        mods.push({ label: 'Attacking from two sides', value: 10 });
      }
    }
  } else {
    if (!sa.bows) return fail('No bows.');
    if (sa.isSquad && a.men < 1) return fail('No one left to shoot.');
    if (adjacentSquares(ctx, a.pos).some((c) => ctx.hasEnemyAt(c, a.side))) return fail('Too close: engaged in melee.');
    if (a.pos.level !== t.pos.level) return fail('Different level.');
    const range = chebyshev(a.pos, t.pos);
    if (range > MISSILE_RANGE) return fail('Out of range.');
    const line = sightLine(ctx, a.pos, t.pos);
    if (!line.clear) return fail('No line of sight.');
    front = line.throughDoor ? 'narrow' : 'wide';
    slots = sa.isSquad ? (line.throughDoor ? 1 : Math.min(2, a.men)) : 1;
    if (range >= 5) mods.push({ label: `Long range (${range})`, value: -20 });
    else if (range >= 3) mods.push({ label: `Range ${range}`, value: -10 });
    if (line.throughDoor) mods.push({ label: 'Through a doorway', value: -10 });
    if (ctx.exp.smoke[squareKey(a.pos)] || ctx.exp.smoke[squareKey(t.pos)]) mods.push({ label: 'Smoke', value: -20 });
  }
  if (a.pos.level !== t.pos.level) {
    if (a.pos.level < t.pos.level) mods.push({ label: 'Attacking downstairs', value: 10 });
    else mods.push({ label: 'Attacking upstairs', value: -10 });
  }
  if (carriesEnchanted(a)) mods.push({ label: 'Enchanted weapon', value: 10 });
  const lead = leaderBonusFor(ctx, a);
  if (lead) mods.push({ label: `${lead.name} nearby`, value: lead.value });
  if (STATS[t.cls].isSquad) {
    if (t.armor === 'unarmored') mods.push({ label: 'Target unarmored', value: 10 });
    if (t.armor === 'heavy') mods.push({ label: 'Target in heavy armour', value: -10 });
  }
  if (ctx.exp.combatBlessing[a.id]) mods.push({ label: 'Combat spell', value: 10 });
  if (t.shieldwallFacing && sameSquare(t.shieldwallFacing, a.pos)) mods.push({ label: 'Target in shieldwall', value: -20 });
  if (a.shieldwallFacing) mods.push({ label: 'Attacking from shieldwall', value: -10 });
  if (t.climbingTurns > 0) mods.push({ label: 'Target climbing', value: 20 });
  if (a.ambushReady) mods.push({ label: 'Ambush', value: 20 });
  const doubled = t.asleepTurns > 0;
  if (doubled) mods.push({ label: 'Target asleep: wounds doubled', value: 0 });
  const total = mods.reduce((n, m) => n + m.value, sa.baseHit);
  return { ok: slots > 0, reason: slots > 0 ? undefined : 'Cannot attack.', frontage: front, slots, chance: Math.max(10, Math.min(90, total)), modifiers: mods, doubled };
}

export function expectedWounds(slots: number, locked: number, chancePct: number, doubled: boolean): number {
  const p = chancePct / 100;
  const r = slots - locked;
  let e = locked + r * p;
  if (slots >= 2) e += Math.pow(p, r);
  return doubled ? e * 2 : e;
}

export function previewAttack(ctx: Ctx, a: Unit, t: Unit, kind: 'melee' | 'missile', focus: number): AttackPreview {
  const plan = planAttack(ctx, a, t, kind);
  const maxF = Math.min(a.focus, plan.slots);
  const f = Math.max(0, Math.min(focus, maxF));
  let ok = plan.ok;
  let reason = plan.reason;
  if (ok && a.actionsLeft < 1) {
    ok = false;
    reason = 'No actions left.';
  }
  return {
    ok,
    reason,
    frontage: plan.frontage,
    slots: plan.slots,
    chance: plan.chance,
    modifiers: plan.modifiers,
    maxFocus: maxF,
    expectedWounds: plan.ok ? expectedWounds(plan.slots, f, plan.chance, plan.doubled) : 0,
  };
}

export function rollSlots(ctx: Ctx, slots: number, locked: number, chancePct: number, doubled: boolean): RollResult {
  const hits: boolean[] = [];
  for (let i = 0; i < slots; i++) hits.push(i < locked ? true : chance(ctx.state, chancePct));
  const n = hits.filter(Boolean).length;
  const perfect = slots >= 2 && n === slots;
  let wounds = n + (perfect ? 1 : 0);
  if (doubled) wounds *= 2;
  return { slots, chance: chancePct, hits, locked, perfect, wounds };
}

/**
 * Resolve an attack. `free` skips the action cost (overwatch, reaction).
 * Returns the roll.
 */
export function resolveAttack(ctx: Ctx, a: Unit, t: Unit, kind: 'melee' | 'missile', focus: number, free = false): RollResult {
  const plan = planAttack(ctx, a, t, kind);
  if (!plan.ok) throw new RuleError(plan.reason ?? 'Cannot attack.');
  if (!free && a.actionsLeft < 1) throw new RuleError('No actions left.');
  const locked = Math.max(0, Math.min(focus, a.focus, plan.slots));
  a.focus -= locked;
  const roll = rollSlots(ctx, plan.slots, locked, plan.chance, plan.doubled);
  ctx.emit({ type: 'attack', attackerId: a.id, targetId: t.id, kind, frontage: plan.frontage, modifiers: plan.modifiers, roll });
  if (!free) {
    a.actionsLeft = 0;
    a.overwatch = false;
  }
  delete ctx.exp.combatBlessing[a.id];
  a.ambushReady = false;
  addNoise(ctx, t.pos, 3);
  wake(ctx, t);
  wake(ctx, a);
  if (kind === 'melee' && a.side === 'player' && a.movedThisTurn >= 2 && !free) gainFocus(ctx, a, 'charge');
  if (roll.perfect && a.side === 'player') gainFocus(ctx, a, 'Perfect');
  if (roll.wounds > 0) {
    const died = applyWounds(ctx, t, roll.wounds);
    if (died && a.side === 'player') gainFocus(ctx, a, 'kill');
    if (!died) {
      if (a.cls === 'spider' && roll.wounds > 0) {
        t.webbed = true;
        ctx.log(`${t.name} is caught in webs.`);
      }
      if (roll.perfect) moraleCheck(ctx, t, 'took a Perfect hit');
      else checkHalfLosses(ctx, t);
    }
  }
  return roll;
}

/** Apply wounds. Returns true if the unit died. */
export function applyWounds(ctx: Ctx, u: Unit, n: number): boolean {
  if (n <= 0) return false;
  const s = STATS[u.cls];
  if (s.isSquad) {
    u.men = Math.max(0, u.men - n);
    ctx.emit({ type: 'wounded', unitId: u.id, amount: n, menLeft: u.men, woundsTaken: 0 });
    if (u.men <= 0) {
      kill(ctx, u);
      return true;
    }
    dropExcess(ctx, u);
    return false;
  }
  u.wounds = Math.min(u.maxWounds, u.wounds + n);
  ctx.emit({ type: 'wounded', unitId: u.id, amount: n, menLeft: 1, woundsTaken: u.wounds });
  if (u.wounds >= u.maxWounds) {
    kill(ctx, u);
    return true;
  }
  return false;
}

/** Drop whatever no longer fits after a squad loses men (7.4). */
export function dropExcess(ctx: Ctx, u: Unit): void {
  const limit = carryLimit(u);
  const items = [...u.loot].sort((a, b) => a.value / Math.max(1, a.weight) - b.value / Math.max(1, b.weight));
  while (carryInfo(u).weight > limit && items.length) {
    const it = items.shift()!;
    u.loot = u.loot.filter((x) => x.id !== it.id);
    const k = squareKey(u.pos);
    (ctx.exp.floorLoot[k] ??= []).push(it);
    ctx.log(`${u.name} drops ${it.name}.`);
  }
}

export function kill(ctx: Ctx, u: Unit): void {
  const exp = ctx.exp;
  ctx.emit({ type: 'died', unitId: u.id });
  if (u.loot.length) {
    (exp.floorLoot[squareKey(u.pos)] ??= []).push(...u.loot);
    u.loot = [];
  }
  exp.units = exp.units.filter((x) => x.id !== u.id);
  exp.fallen.push(u);
  ctx.log(`${u.name} ${STATS[u.cls].isSquad ? 'is wiped out' : 'is slain'}.`);
  addNoise(ctx, u.pos, 2);
  if (isLeader(u)) {
    for (const f of ctx.live(u.side)) {
      if (STATS[f.cls].isSquad && f.pos.level === u.pos.level && chebyshev(f.pos, u.pos) <= 3) moraleCheck(ctx, f, 'saw its leader fall');
    }
  }
}

/** Morale check for squads (spec 2.5). Heroes and monsters never panic. */
export function moraleCheck(ctx: Ctx, u: Unit, why: string): void {
  if (!STATS[u.cls].isSquad || u.exited || !ctx.findUnit(u.id)) return;
  let pct = u.side === 'player' ? 60 : 50;
  if (leaderBonusFor(ctx, u)) pct += 10;
  u.menAtPhaseStart = u.men;
  if (chance(ctx.state, pct)) {
    ctx.emit({ type: 'moraleHeld', unitId: u.id });
    return;
  }
  ctx.log(`${u.name} ${why} and panics!`);
  ctx.emit({ type: 'panicked', unitId: u.id });
  u.panicked = true;
  u.panicTurns = 1;
  u.overwatch = false;
  u.shieldwallFacing = undefined;
  flee(ctx, u);
}

export function checkHalfLosses(ctx: Ctx, u: Unit): void {
  if (!STATS[u.cls].isSquad) return;
  if (u.men > 0 && u.men * 2 <= u.menAtPhaseStart) moraleCheck(ctx, u, 'lost half its men');
}

/** Move a panicked unit up to 4 squares away from the nearest enemy (5.44). */
export function flee(ctx: Ctx, u: Unit): void {
  const enemies = ctx.fighters(u.side === 'player' ? 'castle' : 'player');
  if (!enemies.length) return;
  const danger = (c: { x: number; y: number; level: number }) =>
    Math.min(...enemies.map((e) => (e.pos.level === c.level ? Math.abs(e.pos.x - c.x) + Math.abs(e.pos.y - c.y) : 20)));
  const options = reachable(ctx, u, { ignoreStop: true, allowance: 4 });
  let best: { path: Coord[]; score: number } | undefined;
  const here = danger(u.pos);
  for (const r of options) {
    const s = danger(r.to);
    if (s > here && (!best || s > best.score)) best = { path: r.path, score: s };
  }
  if (best) walk(ctx, u, best.path);
}
