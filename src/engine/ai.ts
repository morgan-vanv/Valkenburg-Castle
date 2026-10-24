// The castle's turn: enemy AI, monsters, the Dragon, dummies and
// reinforcement waves (spec 4, 5; 1980 rules 8.1, 8.6, 9.11).

import { applyTierWakes, checkSpotting, tierIndex, tierOf } from './alarm';
import { applyWounds, isAdjacent, moraleCheck, planAttack, resolveAttack } from './combat';
import { chance, die, pick } from './dice';
import { STATS } from './data';
import { cellAt, label, sameSquare, squareKey } from './geometry';
import { adjacentSquares, adjacentToEnemy, moveAllowance, pathTo, stepsFrom, walk, withinLeash } from './movement';
import { canSee } from './sight';
import { boltTargets, cast, canCast } from './spells';
import type { Ctx } from './ctx';
import type { Coord, Unit } from './types';

function targetScore(u: Unit): number {
  // Prefer heroes, then the weakest squad.
  if (!STATS[u.cls].isSquad) return 100 - (u.maxWounds - u.wounds);
  return 50 - u.men;
}

function adjacentPlayers(ctx: Ctx, u: Unit): Unit[] {
  const squares = adjacentSquares(ctx, u.pos);
  return ctx.fighters('player').filter((p) => squares.some((c) => sameSquare(c, p.pos)) && p.climbingTurns >= 0);
}

/** Overwatch: player units fire at a castle unit that steps into view. Returns false if the mover should stop. */
function overwatchHook(ctx: Ctx, mover: Unit): (c: Coord) => boolean {
  return () => {
    for (const w of ctx.fighters('player')) {
      if (!w.overwatch || !ctx.findUnit(mover.id)) continue;
      const plan = planAttack(ctx, w, mover, 'missile');
      if (!plan.ok) continue;
      ctx.log(`${w.name} looses arrows from overwatch!`);
      w.overwatch = false;
      const roll = resolveAttack(ctx, w, mover, 'missile', 0, true);
      if (roll.wounds > 0 && ctx.findUnit(mover.id)) moraleCheck(ctx, mover, 'was struck from overwatch');
    }
    if (!ctx.findUnit(mover.id) || mover.panicked) return false;
    if (mover.cls === 'drog') return true;
    return !adjacentToEnemy(ctx, mover.pos, 'castle');
  };
}

/** Trim a path to what one move action allows. */
function trimPath(ctx: Ctx, u: Unit, path: Coord[]): Coord[] {
  const allowance = moveAllowance(ctx, u);
  let spent = 0;
  let at = u.pos;
  const out: Coord[] = [];
  for (const c of path) {
    const s = stepsFrom(ctx.ix, ctx.exp, at, 'castle', STATS[u.cls].isSquad).find((x) => sameSquare(x.to, c));
    if (!s) break;
    spent += Math.min(s.cost, 2);
    if (spent > allowance) break;
    out.push(c);
    at = c;
  }
  return out;
}

function nearestPlayerPath(ctx: Ctx, u: Unit): Coord[] | undefined {
  const players = ctx.fighters('player');
  if (!players.length) return undefined;
  const goals = new Set<string>();
  for (const p of players) for (const c of adjacentSquares(ctx, p.pos)) goals.add(squareKey(c));
  return pathTo(ctx, u, (c) => goals.has(squareKey(c)), 80);
}

function meleeBest(ctx: Ctx, u: Unit): boolean {
  const targets = adjacentPlayers(ctx, u).filter((t) => planAttack(ctx, u, t, 'melee').ok);
  if (!targets.length) return false;
  targets.sort((a, b) => targetScore(b) - targetScore(a));
  resolveAttack(ctx, u, targets[0]!, 'melee', 0);
  return true;
}

function missileBest(ctx: Ctx, u: Unit): boolean {
  if (!STATS[u.cls].bows) return false;
  const targets = ctx.fighters('player').filter((t) => canSee(ctx, u, t.pos, 8) && planAttack(ctx, u, t, 'missile').ok);
  if (!targets.length) return false;
  targets.sort((a, b) => planAttack(ctx, u, b, 'missile').chance - planAttack(ctx, u, a, 'missile').chance || targetScore(b) - targetScore(a));
  resolveAttack(ctx, u, targets[0]!, 'missile', 0);
  return true;
}

function actSoldier(ctx: Ctx, u: Unit): void {
  if (u.cls === 'evilMagicUser' && u.spellPoints > 0) {
    const squads = boltTargets(ctx, u).filter((c) => ctx.unitsAt(c).some((p) => p.side === 'player' && STATS[p.cls].isSquad));
    if (squads.length && canCast(u, 'pyrotechnics')) {
      cast(ctx, u, 'pyrotechnics', squads[0]);
      return;
    }
  }
  let guard = 4;
  while (u.actionsLeft > 0 && guard-- > 0 && ctx.findUnit(u.id) && !u.panicked) {
    if (meleeBest(ctx, u)) return;
    if (missileBest(ctx, u)) return;
    const path = nearestPlayerPath(ctx, u);
    if (!path || !path.length) return;
    const leg = trimPath(ctx, u, path);
    if (!leg.length) return;
    u.actionsLeft -= 1;
    walk(ctx, u, leg, overwatchHook(ctx, u));
    checkSpotting(ctx);
  }
}

function actMonster(ctx: Ctx, u: Unit): void {
  if (u.cls === 'dragon' && dragonBreath(ctx, u)) return;
  const inRoom = ctx.fighters('player').filter((p) => withinLeash(u, p.pos) || isAdjacent(ctx, u, p));
  if (!inRoom.length) return;
  if (u.cls === 'banshee') {
    const squads = inRoom.filter((p) => STATS[p.cls].isSquad);
    if (squads.length && chance(ctx.state, 50)) {
      ctx.log('The Banshee wails!');
      ctx.emit({ type: 'log', text: 'A terrible wail fills the room.' });
      for (const s of squads) moraleCheck(ctx, s, 'heard the Banshee wail');
      u.actionsLeft = 0;
      return;
    }
  }
  if (meleeBest(ctx, u)) return;
  const goals = new Set<string>();
  for (const p of inRoom) for (const c of adjacentSquares(ctx, p.pos)) goals.add(squareKey(c));
  const path = pathTo(ctx, u, (c) => goals.has(squareKey(c)), 30);
  if (path?.length) {
    const leg = trimPath(ctx, u, path);
    u.actionsLeft -= 1;
    walk(ctx, u, leg, overwatchHook(ctx, u));
  }
  if (u.actionsLeft > 0 && ctx.findUnit(u.id)) meleeBest(ctx, u);
}

/** The Dragon breathes fire every other turn (8.61). Returns true if it did. */
function dragonBreath(ctx: Ctx, u: Unit): boolean {
  u.breathCooldown = Math.max(0, (u.breathCooldown ?? 0) - 1);
  if (u.breathCooldown) return false;
  const inCave = ctx.fighters('player').filter((p) => withinLeash(u, p.pos));
  const targets = inCave.filter((p) => canSee(ctx, u, p.pos, 6)).sort((a, b) => targetScore(b) - targetScore(a));
  if (!targets.length) return false;
  const t = targets[0]!;
  const w = die(ctx.state) + 2;
  ctx.emit({ type: 'spell', unitId: u.id, spell: 'fireball', target: t.pos });
  ctx.log(`The Dragon breathes fire on ${t.name}: ${w} wounds!`);
  applyWounds(ctx, t, w);
  u.breathCooldown = 2;
  u.actionsLeft = 0;
  return true;
}

function wanderDummy(ctx: Ctx, u: Unit, visible: Set<string>): void {
  for (let i = 0; i < 2; i++) {
    const options = stepsFrom(ctx.ix, ctx.exp, u.pos, 'castle', false).filter((s) => !s.link && !ctx.hasEnemyAt(s.to, 'castle'));
    if (!options.length) break;
    u.pos = pick(ctx.state, options).to;
  }
  if (visible.has(squareKey(u.pos))) {
    ctx.exp.units = ctx.exp.units.filter((x) => x.id !== u.id);
  }
}

function spawnWave(ctx: Ctx, withLeader: boolean): void {
  const exp = ctx.exp;
  const points = ctx.map.levels.flatMap((l) => l.reinforcementPoints);
  if (!points.length) return;
  const at = points[exp.waveCount % points.length]!;
  exp.waveCount += 1;
  const free = [at, ...adjacentSquares(ctx, at)].find((c) => cellAt(ctx.map, c) === 'floor' && !ctx.hasEnemyAt(c, 'castle'));
  if (!free) return;
  const ids: string[] = [];
  const squad = makeEnemy(ctx, 'orcSquad', `Reserve band ${exp.waveCount}`, free, 6);
  squad.dormant = false;
  exp.units.push(squad);
  ids.push(squad.id);
  if (withLeader) {
    const lead = makeEnemy(ctx, 'evilLeader', 'Orc captain', free, 1);
    lead.dormant = false;
    exp.units.push(lead);
    ids.push(lead.id);
  }
  ctx.emit({ type: 'reinforcements', at: free, unitIds: ids });
  ctx.log(`Reinforcements climb up from below at ${label(free)}!`);
}

export function makeEnemy(ctx: Ctx, cls: Unit['cls'], name: string, pos: Coord, men: number): Unit {
  const s = STATS[cls];
  return {
    id: ctx.nextId('e'),
    side: 'castle',
    cls,
    name,
    pos: { ...pos },
    men: s.isSquad ? men : 1,
    wounds: 0,
    maxWounds: s.maxWounds,
    armor: 'normal',
    focus: 0,
    actionsLeft: 0,
    movedThisTurn: 0,
    spellPoints: cls === 'evilMagicUser' ? 3 : 0,
    enchanted: false,
    charges: 0,
    loot: [],
    dormant: true,
    panicked: false,
    panicTurns: 0,
    overwatch: false,
    asleepTurns: 0,
    webbed: false,
    climbingTurns: 0,
    exited: false,
    menAtPhaseStart: s.isSquad ? men : 1,
    post: { ...pos },
    ambushReady: cls === 'mantis' ? true : undefined,
  };
}

/** Run the whole castle phase. */
export function castlePhase(ctx: Ctx, visible: Set<string>): void {
  const exp = ctx.exp;
  exp.phase = 'castle';
  ctx.emit({ type: 'phase', phase: 'castle', turn: exp.turn });
  for (const u of ctx.live('castle')) {
    u.actionsLeft = 2;
    u.movedThisTurn = 0;
    u.menAtPhaseStart = u.men;
    u.shieldwallFacing = undefined;
    if (u.cls === 'troll' && u.wounds > 0 && !u.dormant) {
      u.wounds -= 1;
      ctx.log('The Troll\'s wounds knit closed.');
    }
  }
  applyTierWakes(ctx);
  checkSpotting(ctx);

  const players = ctx.fighters('player');
  const order = ctx
    .fighters('castle')
    .filter((u) => !u.dormant)
    .sort((a, b) => nearestDist(a, players) - nearestDist(b, players));
  for (const u of order) {
    if (!ctx.findUnit(u.id) || !ctx.fighters('player').length) continue;
    if (u.asleepTurns > 0) continue;
    if (u.panicTurns > 0) {
      u.panicTurns -= 1;
      u.panicked = u.panicTurns > 0;
      continue;
    }
    if (u.webbed) {
      u.actionsLeft -= 1;
      u.webbed = false;
    }
    if (u.leash) actMonster(ctx, u);
    else actSoldier(ctx, u);
  }

  for (const d of ctx.live('castle').filter((u) => u.cls === 'dummy')) wanderDummy(ctx, d, visible);

  const tier = tierIndex(tierOf(exp.alarm));
  if (tier >= 3) {
    exp.waveTimer += 1;
    const every = tier >= 4 ? 1 : 3;
    if (exp.waveTimer >= every) {
      exp.waveTimer = 0;
      spawnWave(ctx, tier >= 4 && exp.waveCount % 2 === 1);
    }
  }
  for (const u of ctx.live('castle')) if (u.asleepTurns > 0) u.asleepTurns -= 1;
}

function nearestDist(u: Unit, players: Unit[]): number {
  let best = 999;
  for (const p of players) {
    const d = p.pos.level === u.pos.level ? Math.abs(p.pos.x - u.pos.x) + Math.abs(p.pos.y - u.pos.y) : 50;
    if (d < best) best = d;
  }
  return best;
}

