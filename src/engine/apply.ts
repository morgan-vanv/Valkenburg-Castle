// Command dispatch and the legal-actions query.

import type { ActionOption } from './api';
import { applyWounds, frontage, gainFocus, isAdjacent, maxFocus, planAttack, resolveAttack } from './combat';
import { beginMuster, cancelMuster, continueAfterDebrief, endTurn, hire, launch, skipWeek, afterPlayerAction, checkEnd } from './campaign';
import { die } from './dice';
import { SPELLS, STATS } from './data';
import { blastableWall, doorAction, doorEdgesAround, doorMethods, isSecured } from './doors';
import { cellAt, edgeKey, edgeKindAt, label, sameSquare, squareKey, step, DIRS } from './geometry';
import { drop, give, openChest, pickUp, search, searchStatus } from './loot';
import { adjacentSquares, adjacentToEnemy, reachable, walk } from './movement';
import { playerVisible } from './sight';
import { boltTargets, cast } from './spells';
import { RuleError, type Ctx } from './ctx';
import type { Command, Coord, SpellId, Unit } from './types';

function playerUnit(ctx: Ctx, id: string): Unit {
  if (ctx.exp.phase !== 'player') throw new RuleError('Wait for your turn.');
  const u = ctx.unit(id);
  if (u.side !== 'player') throw new RuleError('That is not yours to command.');
  if (u.climbingTurns > 0) throw new RuleError(`${u.name} is still climbing.`);
  return u;
}

function needAction(u: Unit): void {
  if (u.actionsLeft < 1) throw new RuleError(`${u.name} has no actions left this turn.`);
}

/** Pit squares next to a level 1 balcony square, as landing squares on level 3. */
export function pitLandings(ctx: Ctx, u: Unit): Coord[] {
  if (u.pos.level !== 1 || !ctx.ix.balcony.has(squareKey(u.pos))) return [];
  const out: Coord[] = [];
  for (const d of DIRS) {
    const n = step(u.pos, d);
    if (cellAt(ctx.map, n) !== 'pit') continue;
    const below = { level: 3 as const, x: n.x, y: n.y };
    if (cellAt(ctx.map, below) === 'floor' && !ctx.hasEnemyAt(below, 'player')) out.push(below);
  }
  return out;
}

/** Balcony squares a unit on the level 3 pit floor can climb up to. */
export function climbUpTargets(ctx: Ctx, u: Unit): Coord[] {
  if (u.pos.level !== 3) return [];
  const above = { level: 1 as const, x: u.pos.x, y: u.pos.y };
  if (cellAt(ctx.map, above) !== 'pit') return [];
  const out: Coord[] = [];
  for (const d of DIRS) {
    const n = step(above, d);
    if (ctx.ix.balcony.has(squareKey(n)) && !ctx.hasEnemyAt(n, 'player')) out.push(n);
  }
  return out;
}

export function dispatch(ctx: Ctx, cmd: Command): void {
  switch (cmd.type) {
    case 'hire':
      return hire(ctx, cmd.men);
    case 'beginMuster':
      return beginMuster(ctx);
    case 'cancelMuster':
      return cancelMuster(ctx);
    case 'skipWeek':
      return skipWeek(ctx);
    case 'launch':
      return launch(ctx, cmd.plan);
    case 'continueAfterDebrief':
      return continueAfterDebrief(ctx);
    case 'endTurn':
      if (ctx.state.stage !== 'expedition') throw new RuleError('No expedition under way.');
      return endTurn(ctx);
  }
  if (ctx.state.stage !== 'expedition') throw new RuleError('No expedition under way.');
  const u = playerUnit(ctx, cmd.unitId);
  switch (cmd.type) {
    case 'move': {
      needAction(u);
      const r = reachable(ctx, u).find((x) => sameSquare(x.to, cmd.to));
      if (!r) throw new RuleError(`${u.name} can't reach ${label(cmd.to)} this move.`);
      u.actionsLeft -= 1;
      u.shieldwallFacing = undefined;
      u.overwatch = false;
      walk(ctx, u, r.path);
      break;
    }
    case 'melee':
    case 'missile': {
      const t = ctx.unit(cmd.targetId);
      resolveAttack(ctx, u, t, cmd.type, cmd.focus);
      break;
    }
    case 'door':
      doorAction(ctx, u, cmd.edge, cmd.method, cmd.helpers);
      break;
    case 'chest':
      openChest(ctx, u, cmd.chestId, cmd.method);
      break;
    case 'search':
      search(ctx, u);
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
      if (STATS[u.cls].leaderBonus <= 0 || u.side !== 'player') throw new RuleError('Only leaders inspire.');
      if (u.focus < 1) throw new RuleError('No Focus to give.');
      const to = ctx.unit(cmd.toId);
      if (to.side !== 'player' || !STATS[to.cls].isSquad) throw new RuleError('Give Focus to a squad.');
      if (!sameSquare(u.pos, to.pos) && !isAdjacent(ctx, u, to)) throw new RuleError('Too far away.');
      if (to.focus >= maxFocus(to)) throw new RuleError(`${to.name} is already focused.`);
      u.focus -= 1;
      u.actionsLeft -= 1;
      gainFocus(ctx, to, `inspired by ${u.name}`);
      break;
    }
    case 'overwatch': {
      needAction(u);
      if (!STATS[u.cls].bows) throw new RuleError('Needs bows.');
      if (adjacentToEnemy(ctx, u.pos, 'player')) throw new RuleError('Too close to the enemy.');
      u.overwatch = true;
      u.actionsLeft = 0;
      ctx.log(`${u.name} nocks arrows and watches.`);
      break;
    }
    case 'shieldwall': {
      needAction(u);
      if (!STATS[u.cls].isSquad || u.men < 4) throw new RuleError('Needs a squad of 4 or more.');
      if (!adjacentSquares(ctx, u.pos).some((c) => sameSquare(c, cmd.facing))) throw new RuleError('Face an adjacent square.');
      if (frontage(ctx, u.pos, cmd.facing) === 'open') throw new RuleError('No room to lock shields in the open.');
      u.shieldwallFacing = { ...cmd.facing };
      u.actionsLeft = 0;
      ctx.log(`${u.name} locks shields.`);
      break;
    }
    case 'cast':
      cast(ctx, u, cmd.spell, cmd.target, cmd.targetId, cmd.edge);
      break;
    case 'jump': {
      needAction(u);
      const to = pitLandings(ctx, u).find((c) => sameSquare(c, cmd.to));
      if (!to) throw new RuleError('Jump from the balcony into the Pit.');
      u.actionsLeft -= 1;
      u.pos = { ...to };
      ctx.emit({ type: 'moved', unitId: u.id, path: [to] });
      const rolls = STATS[u.cls].isSquad ? u.men : 1;
      let w = 0;
      for (let i = 0; i < rolls; i++) if (die(ctx.state) <= 4) w++;
      ctx.log(`${u.name} leaps into the Pit${w ? ` and takes ${w} wound${w > 1 ? 's' : ''}` : ' and lands well'}.`);
      if (w) applyWounds(ctx, u, w);
      break;
    }
    case 'climb': {
      needAction(u);
      if (!ctx.exp.hasClimbingGear) throw new RuleError('No climbing gear.');
      const down = pitLandings(ctx, u).find((c) => sameSquare(c, cmd.to));
      if (down) {
        u.actionsLeft -= 1;
        u.pos = { ...down };
        ctx.emit({ type: 'moved', unitId: u.id, path: [down] });
        ctx.log(`${u.name} climbs down into the Pit.`);
        break;
      }
      const up = climbUpTargets(ctx, u).find((c) => sameSquare(c, cmd.to));
      if (!up) throw new RuleError('Nowhere to climb there.');
      if (u.actionsLeft < 2) throw new RuleError('Climbing out takes both actions.');
      u.actionsLeft = 0;
      u.climbingTurns = 1;
      u.climbTarget = { ...up };
      ctx.log(`${u.name} starts the long climb out of the Pit.`);
      break;
    }
    case 'exit': {
      needAction(u);
      if (!ctx.ix.entrances.has(squareKey(u.pos))) throw new RuleError('Exit from an entrance square.');
      u.exited = true;
      u.actionsLeft = 0;
      ctx.emit({ type: 'exited', unitId: u.id });
      ctx.log(`${u.name} leaves the castle${u.loot.length ? ', laden with loot' : ''}.`);
      break;
    }
  }
  if (ctx.state.expedition) afterPlayerAction(ctx);
  else checkEnd(ctx);
}

/** Everything the selected unit can do right now. */
export function legalActions(ctx: Ctx, u: Unit): ActionOption[] {
  const exp = ctx.state.expedition;
  if (!exp || exp.phase !== 'player' || u.side !== 'player' || u.exited || u.actionsLeft < 1 || u.climbingTurns > 0) return [];
  const out: ActionOption[] = [];
  if (reachable(ctx, u).length) out.push({ kind: 'move', cost: 1 });
  const enemies = ctx.fighters('castle');
  const melee = enemies.filter((e) => planAttack(ctx, u, e, 'melee').ok).map((e) => e.id);
  if (melee.length) out.push({ kind: 'melee', targetIds: melee });
  const visible = playerVisible(ctx, false);
  const missile = enemies.filter((e) => visible.has(squareKey(e.pos)) && planAttack(ctx, u, e, 'missile').ok).map((e) => e.id);
  if (missile.length) out.push({ kind: 'missile', targetIds: missile });
  for (const d of doorEdgesAround(ctx, u.pos)) {
    const methods = doorMethods(ctx, u, d.key);
    if (methods.length) out.push({ kind: 'door', edge: d.key, methods, locked: d.door.locked, secured: isSecured(ctx, d.key, u.pos, 'player') });
  }
  if (u.cls === 'dwarf' && u.charges > 0) {
    for (const d of DIRS) {
      if (edgeKindAt(ctx.map, u.pos, d) !== 'wall') continue;
      const key = edgeKey(u.pos, d);
      if (exp.doors[key]?.destroyed || !blastableWall(ctx, key)) continue;
      out.push({ kind: 'door', edge: key, methods: ['blast'], locked: false, secured: false });
    }
  }
  for (const c of exp.chests) {
    if (sameSquare(c.pos, u.pos)) {
      const methods = (['pick', 'unlock', 'smash', 'chop'] as const).filter((m) => (m === 'pick' ? u.cls === 'burglar' && !c.door.jammed : m === 'unlock' ? u.cls === 'magicUser' && u.spellPoints >= 2 : m === 'smash' ? !c.door.unsmashable : true));
      out.push({ kind: 'chest', chestId: c.id, methods });
    }
  }
  const st = searchStatus(ctx, u);
  if (st.ok) out.push({ kind: 'search', progress: st.progress, needed: st.needed });
  const pile = exp.floorLoot[squareKey(u.pos)];
  if (pile?.length) out.push({ kind: 'pickUp', itemIds: pile.map((i) => i.id) });
  if (u.loot.length) {
    out.push({ kind: 'drop', itemIds: u.loot.map((i) => i.id) });
    const friends = ctx.fighters('player').filter((f) => f.id !== u.id && (sameSquare(f.pos, u.pos) || isAdjacent(ctx, u, f)));
    if (friends.length) out.push({ kind: 'give', toIds: friends.map((f) => f.id) });
  }
  if (STATS[u.cls].leaderBonus > 0 && u.focus > 0) {
    const squads = ctx.fighters('player').filter((f) => STATS[f.cls].isSquad && f.focus < maxFocus(f) && (sameSquare(f.pos, u.pos) || isAdjacent(ctx, u, f)));
    if (squads.length) out.push({ kind: 'giveFocus', toIds: squads.map((f) => f.id) });
  }
  if (STATS[u.cls].bows && !adjacentToEnemy(ctx, u.pos, 'player')) out.push({ kind: 'overwatch' });
  if (STATS[u.cls].isSquad && u.men >= 4) {
    const facings = adjacentSquares(ctx, u.pos).filter((c) => c.level === u.pos.level && frontage(ctx, u.pos, c) !== 'open');
    if (facings.length) out.push({ kind: 'shieldwall', facings });
  }
  if (u.cls === 'magicUser') {
    const friends = [u, ...ctx.fighters('player').filter((f) => f.id !== u.id && (sameSquare(f.pos, u.pos) || isAdjacent(ctx, u, f)))];
    for (const spell of Object.keys(SPELLS) as SpellId[]) {
      const cost = SPELLS[spell].cost;
      if (u.spellPoints < cost) continue;
      const opt = { kind: 'cast' as const, spell, cost, targets: [] as Coord[], targetIds: [] as string[], edges: [] as string[] };
      if (spell === 'fireball' || spell === 'pyrotechnics') {
        opt.targets = boltTargets(ctx, u);
        if (!opt.targets.length) continue;
      } else if (spell === 'smokescreen') {
        opt.targets = adjacentSquares(ctx, u.pos).filter((c) => c.level === u.pos.level);
      } else if (spell === 'unlock') {
        opt.edges = doorEdgesAround(ctx, u.pos)
          .filter((d) => d.door.locked && !d.door.destroyed && !isSecured(ctx, d.key, u.pos, 'player'))
          .map((d) => d.key);
        if (!opt.edges.length) continue;
      } else if (spell === 'combat') {
        opt.targetIds = friends.map((f) => f.id);
      }
      out.push(opt);
    }
  }
  const jumps = pitLandings(ctx, u);
  if (jumps.length) out.push({ kind: 'jump', targets: jumps });
  if (exp.hasClimbingGear) {
    const climbs = [...jumps, ...(u.actionsLeft >= 2 ? climbUpTargets(ctx, u) : [])];
    if (climbs.length) out.push({ kind: 'climb', targets: climbs });
  }
  if (ctx.ix.entrances.has(squareKey(u.pos))) out.push({ kind: 'exit' });
  return out;
}
