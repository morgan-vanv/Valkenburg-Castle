// Command dispatch and the legal-actions query (V2).

import type { ActionOption } from './api';
import { applyWounds, gainFocus, isAdjacent, maxFocus, planAttack, resolveAttack } from './combat';
import { buy, refund, launch, endTurn, afterPlayerAction, checkEnd } from './run';
import { die } from './dice';
import { SPELLS, STATS, V2_SPELLS } from './data';
import { blastableWall, doorAction, doorEdgesAround, doorMethods } from './doors';
import { cellAt, edgeKey, edgeKindAt, label, sameSquare, squareKey, step, DIRS } from './geometry';
import { drop, give, pickUp } from './loot';
import { adjacentSquares, adjacentToEnemy, reachable, walk } from './movement';
import { playerVisible } from './sight';
import { boltTargets, cast } from './spells';
import { RuleError, type Ctx } from './ctx';
import type { Command, Coord, Unit } from './types';

function playerUnit(ctx: Ctx, id: string): Unit {
  if (ctx.exp.phase !== 'player') throw new RuleError('Wait for your turn.');
  const u = ctx.unit(id);
  if (u.side !== 'player') throw new RuleError('That is not yours to command.');
  return u;
}

function needAction(u: Unit): void {
  if (u.actionsLeft < 1) throw new RuleError(`${u.name} has no actions left this turn.`);
}

/** Where a unit on the shaft's rim lands below. */
export function shaftLandings(ctx: Ctx, u: Unit): Coord[] {
  if (!ctx.ix.balcony.has(squareKey(u.pos))) return [];
  const out: Coord[] = [];
  for (const d of DIRS) {
    const n = step(u.pos, d);
    if (cellAt(ctx.map, n) !== 'pit') continue;
    for (const sh of ctx.map.shafts ?? []) {
      const i = sh.top.findIndex((c) => sameSquare(c, n));
      const below = i >= 0 ? sh.bottom[i] : undefined;
      if (below && cellAt(ctx.map, below) === 'floor' && !ctx.hasEnemyAt(below, 'player') && !out.some((c) => sameSquare(c, below))) out.push(below);
    }
  }
  return out;
}

/** Rim squares a unit at the bottom of the shaft can climb up to. */
export function climbUpTargets(ctx: Ctx, u: Unit): Coord[] {
  const out: Coord[] = [];
  for (const sh of ctx.map.shafts ?? []) {
    const i = sh.bottom.findIndex((c) => sameSquare(c, u.pos));
    if (i < 0) continue;
    const top = sh.top[i]!;
    for (const d of DIRS) {
      const n = step(top, d);
      if (ctx.ix.balcony.has(squareKey(n)) && !ctx.hasEnemyAt(n, 'player')) out.push(n);
    }
  }
  return out;
}

function canRope(ctx: Ctx): boolean {
  return ctx.exp.rope || ctx.exp.pack.rope > 0;
}

function anchorRope(ctx: Ctx, u: Unit): void {
  if (ctx.exp.rope) return;
  ctx.exp.pack.rope -= 1;
  ctx.exp.rope = true;
  ctx.emit({ type: 'itemUsed', unitId: u.id, item: 'rope', target: u.pos });
  ctx.log(`${u.name} anchors the rope at the shaft.`);
}

function friendsInReach(ctx: Ctx, u: Unit): Unit[] {
  return ctx.fighters('player').filter((f) => sameSquare(f.pos, u.pos) || isAdjacent(ctx, u, f));
}

export function dispatch(ctx: Ctx, cmd: Command): void {
  switch (cmd.type) {
    case 'buy':
      return buy(ctx, cmd.item);
    case 'refund':
      return refund(ctx, cmd.item);
    case 'launch':
      return launch(ctx, cmd.plan);
    case 'endTurn':
      if (ctx.state.stage !== 'expedition') throw new RuleError('Not inside the castle.');
      return endTurn(ctx);
  }
  if (ctx.state.stage !== 'expedition') throw new RuleError('Not inside the castle.');
  const u = playerUnit(ctx, cmd.unitId);
  switch (cmd.type) {
    case 'move': {
      needAction(u);
      const r = reachable(ctx, u).find((x) => sameSquare(x.to, cmd.to));
      if (!r) throw new RuleError(`${u.name} can't reach ${label(cmd.to)} this move.`);
      u.actionsLeft -= 1;
      u.overwatch = false;
      walk(ctx, u, r.path);
      break;
    }
    case 'melee':
    case 'missile':
      resolveAttack(ctx, u, ctx.unit(cmd.targetId), cmd.type, cmd.focus);
      break;
    case 'door':
      doorAction(ctx, u, cmd.edge, cmd.method);
      break;
    case 'pickUp':
      pickUp(ctx, u, cmd.itemId);
      break;
    case 'drop':
      drop(ctx, u, cmd.itemId);
      break;
    case 'give':
      give(ctx, u, ctx.unit(cmd.toId), cmd.itemId, (a, b) => isAdjacent(ctx, a, b));
      break;
    case 'giveFocus': {
      needAction(u);
      if (STATS[u.cls].leaderBonus <= 0) throw new RuleError('Only leaders inspire.');
      if (u.focus < 1) throw new RuleError('No Focus to give.');
      const to = ctx.unit(cmd.toId);
      if (to.side !== 'player' || to.id === u.id) throw new RuleError('Give Focus to a friend.');
      if (!sameSquare(u.pos, to.pos) && !isAdjacent(ctx, u, to)) throw new RuleError('Too far away.');
      if (to.focus >= maxFocus(to)) throw new RuleError(`${to.name} is already focused.`);
      u.focus -= 1;
      u.actionsLeft -= 1;
      gainFocus(ctx, to, `inspired by ${u.name}`);
      break;
    }
    case 'overwatch':
      needAction(u);
      if (!STATS[u.cls].bows) throw new RuleError('Needs bows.');
      if (adjacentToEnemy(ctx, u.pos, 'player')) throw new RuleError('Too close to the enemy.');
      u.overwatch = true;
      u.actionsLeft = 0;
      ctx.log(`${u.name} nocks arrows and watches.`);
      break;
    case 'cast':
      if (!V2_SPELLS.includes(cmd.spell)) throw new RuleError('That spell is not known.');
      cast(ctx, u, cmd.spell, cmd.target, cmd.targetId, cmd.edge);
      break;
    case 'useItem': {
      needAction(u);
      const pack = ctx.exp.pack;
      if ((pack[cmd.item] ?? 0) < 1) throw new RuleError('None left in the pack.');
      if (cmd.item === 'draught') {
        const to = cmd.targetId ? ctx.unit(cmd.targetId) : u;
        if (!friendsInReach(ctx, u).some((f) => f.id === to.id)) throw new RuleError('Too far away.');
        if (STATS[to.cls].isSquad) {
          const cap = to.startMen ?? to.men;
          if (to.men >= cap) throw new RuleError(`${to.name} is at full strength.`);
          to.men = Math.min(cap, to.men + 3);
        } else {
          if (to.wounds <= 0) throw new RuleError(`${to.name} is unhurt.`);
          to.wounds = Math.max(0, to.wounds - 2);
        }
        ctx.log(`${u.name} gives ${to.name} a healing draught.`);
      } else if (cmd.item === 'smoke') {
        const at = cmd.target ?? u.pos;
        if (!sameSquare(at, u.pos) && !adjacentSquares(ctx, u.pos).some((c) => sameSquare(c, at))) throw new RuleError('Throw it next to you.');
        for (const c of [at, ...DIRS.map((d) => step(at, d))]) if (cellAt(ctx.map, c) === 'floor') ctx.exp.smoke[squareKey(c)] = 1;
        ctx.log(`${u.name} hurls a smoke bomb at ${label(at)}.`);
      } else {
        throw new RuleError('Use that another way.');
      }
      pack[cmd.item] -= 1;
      u.actionsLeft -= 1;
      ctx.emit({ type: 'itemUsed', unitId: u.id, item: cmd.item, target: cmd.target });
      break;
    }
    case 'jump': {
      needAction(u);
      const to = shaftLandings(ctx, u).find((c) => sameSquare(c, cmd.to));
      if (!to) throw new RuleError('Jump from the rim of the shaft.');
      u.actionsLeft -= 1;
      u.pos = { ...to };
      ctx.emit({ type: 'moved', unitId: u.id, path: [to] });
      // A long drop: each man (or the hero) is hurt on a 1–2.
      const rolls = STATS[u.cls].isSquad ? u.men : 1;
      let w = 0;
      for (let i = 0; i < rolls; i++) if (die(ctx.state) <= 2) w++;
      ctx.log(`${u.name} drops into the Deep${w ? ` and takes ${w} wound${w > 1 ? 's' : ''}` : ' and lands well'}.`);
      if (w) applyWounds(ctx, u, w);
      break;
    }
    case 'climb': {
      needAction(u);
      if (!canRope(ctx)) throw new RuleError('You need a rope.');
      const down = shaftLandings(ctx, u).find((c) => sameSquare(c, cmd.to));
      const up = climbUpTargets(ctx, u).find((c) => sameSquare(c, cmd.to));
      const to = down ?? up;
      if (!to) throw new RuleError('Nowhere to climb there.');
      anchorRope(ctx, u);
      u.actionsLeft -= 1;
      u.pos = { ...to };
      ctx.emit({ type: 'moved', unitId: u.id, path: [to] });
      ctx.log(`${u.name} climbs ${down ? 'down into the Deep' : 'back up to the Halls'}.`);
      break;
    }
    case 'exit':
      needAction(u);
      if (!ctx.ix.entrances.has(squareKey(u.pos))) throw new RuleError('Leave by an entrance.');
      u.exited = true;
      u.actionsLeft = 0;
      ctx.emit({ type: 'exited', unitId: u.id });
      ctx.log(`${u.name} gets out${u.loot.length ? ` with ${u.loot.reduce((n, i) => n + i.value, 0)} gold` : ''}.`);
      break;
  }
  if (ctx.state.expedition) afterPlayerAction(ctx);
  else checkEnd(ctx);
}

/** Everything the selected unit can do right now. */
export function legalActions(ctx: Ctx, u: Unit): ActionOption[] {
  const exp = ctx.state.expedition;
  if (!exp || exp.phase !== 'player' || u.side !== 'player' || u.exited || u.actionsLeft < 1) return [];
  const out: ActionOption[] = [];
  if (reachable(ctx, u).length) out.push({ kind: 'move', cost: 1 });
  const enemies = ctx.fighters('castle');
  const melee = enemies.filter((e) => planAttack(ctx, u, e, 'melee').ok).map((e) => e.id);
  if (melee.length) out.push({ kind: 'melee', targetIds: melee });
  const visible = playerVisible(ctx, false);
  const missile = enemies.filter((e) => visible.has(squareKey(e.pos)) && planAttack(ctx, u, e, 'missile').ok).map((e) => e.id);
  if (missile.length) out.push({ kind: 'missile', targetIds: missile });
  const pile = exp.floorLoot[squareKey(u.pos)];
  if (pile?.length) out.push({ kind: 'pickUp', itemIds: pile.map((i) => i.id) });
  if (ctx.ix.entrances.has(squareKey(u.pos))) out.push({ kind: 'exit' });
  for (const d of doorEdgesAround(ctx, u.pos)) {
    const methods = doorMethods(ctx, u, d.key);
    if (methods.length) out.push({ kind: 'door', edge: d.key, methods, locked: d.door.locked, secured: !methods.includes('pick') && u.cls === 'burglar' });
  }
  if (exp.pack.charge > 0) {
    for (const d of DIRS) {
      if (edgeKindAt(ctx.map, u.pos, d) !== 'wall') continue;
      const key = edgeKey(u.pos, d);
      if (exp.doors[key]?.destroyed || !blastableWall(ctx, key)) continue;
      out.push({ kind: 'door', edge: key, methods: ['blast'], locked: false, secured: false });
    }
  }
  const landings = shaftLandings(ctx, u);
  if (canRope(ctx)) {
    const climbs = [...landings, ...climbUpTargets(ctx, u)];
    if (climbs.length) out.push({ kind: 'climb', targets: climbs });
  }
  if (landings.length) out.push({ kind: 'jump', targets: landings });
  if (u.cls === 'magicUser') {
    const friends = friendsInReach(ctx, u);
    for (const spell of V2_SPELLS) {
      const cost = SPELLS[spell].cost;
      if (u.spellPoints < cost) continue;
      const opt = { kind: 'cast' as const, spell, cost, targets: [] as Coord[], targetIds: [] as string[], edges: [] as string[] };
      if (spell === 'fireball') {
        opt.targets = boltTargets(ctx, u);
        if (!opt.targets.length) continue;
      } else if (spell === 'smokescreen') {
        opt.targets = adjacentSquares(ctx, u.pos).filter((c) => c.level === u.pos.level);
      } else opt.targetIds = friends.map((f) => f.id);
      out.push(opt);
    }
  }
  if (exp.pack.draught > 0) {
    const hurt = friendsInReach(ctx, u).filter((f) => (STATS[f.cls].isSquad ? f.men < (f.startMen ?? f.men) : f.wounds > 0));
    if (hurt.length) out.push({ kind: 'item', item: 'draught', targets: [], targetIds: hurt.map((f) => f.id) });
  }
  if (exp.pack.smoke > 0) out.push({ kind: 'item', item: 'smoke', targets: [u.pos, ...adjacentSquares(ctx, u.pos).filter((c) => c.level === u.pos.level)], targetIds: [] });
  if (STATS[u.cls].bows && !adjacentToEnemy(ctx, u.pos, 'player')) out.push({ kind: 'overwatch' });
  if (STATS[u.cls].leaderBonus > 0 && u.focus > 0) {
    const friends = friendsInReach(ctx, u).filter((f) => f.id !== u.id && f.focus < maxFocus(f));
    if (friends.length) out.push({ kind: 'giveFocus', toIds: friends.map((f) => f.id) });
  }
  if (u.loot.length) {
    out.push({ kind: 'drop', itemIds: u.loot.map((i) => i.id) });
    const friends = friendsInReach(ctx, u).filter((f) => f.id !== u.id);
    if (friends.length) out.push({ kind: 'give', toIds: friends.map((f) => f.id) });
  }
  return out;
}
