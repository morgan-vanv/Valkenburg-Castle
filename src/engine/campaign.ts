// The campaign: weeks, wages, hiring, muster, expeditions starting and
// ending, debrief, castle regrowth, win and loss (spec 1, 2.1).

import { makeEnemy, castlePhase } from './ai';
import { addNoise, checkSpotting } from './alarm';
import { detonateCharges, closeDoors } from './doors';
import { pick, shuffle } from './dice';
import { CAMPAIGN, MONSTER_NAMES, MONSTER_POOL, STATS } from './data';
import { at, cellAt, edgeKindAt, label, sameSquare, squareKey, DIRS } from './geometry';
import { areaAt, type MapIndex } from './mapIndex';
import { adjacentSquares } from './movement';
import { freePrisoners } from './loot';
import { playerVisible } from './sight';
import { Ctx, RuleError } from './ctx';
import type { Coord, DoorState, Expedition, GameState, Hero, MusterPlan, Unit } from './types';

export const HEROES: Hero[] = [
  { id: 'hobart', cls: 'hobart', name: 'Lord Hobart', alive: true, enchanted: true },
  { id: 'rogier', cls: 'leader', name: 'Rogier', alive: true, enchanted: false },
  { id: 'thorvold', cls: 'dwarf', name: 'Thorvold', alive: true, enchanted: true },
  { id: 'pim', cls: 'burglar', name: 'Pim', alive: true, enchanted: false },
  { id: 'aldous', cls: 'magicUser', name: 'Aldous', alive: true, enchanted: false },
];

const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '6th'];

export function newCampaign(ix: MapIndex, seed: number): GameState {
  const state: GameState = {
    version: 1,
    seed,
    rng: seed >>> 0,
    week: 1,
    maxWeeks: CAMPAIGN.weeks,
    goalGold: CAMPAIGN.goal,
    gold: CAMPAIGN.startGold,
    barracks: CAMPAIGN.startMen,
    heroes: HEROES.map((h) => ({ ...h })),
    stage: 'week',
    castle: { enemies: [], destroyedDoors: [], floorLoot: {}, prisoners: [], dragonAlive: true, hoardTaken: false },
    nextId: 1,
    lastWages: 0,
    hiredThisWeek: 0,
  };
  const ctx = new Ctx(state, ix);
  deploy(ctx);
  payWages(ctx);
  return state;
}

function guardroomSquares(ix: MapIndex, level: number): Coord[][] {
  const lv = ix.map.levels.find((l) => l.id === level);
  if (!lv) return [];
  const out: Coord[][] = [];
  for (const g of lv.guardrooms) {
    const area = areaAt(ix, g);
    if (area) out.push(area.squares);
  }
  return out;
}

/** The 1980 set-up (9.1), scaled for the demo (spec 3.4). */
function deploy(ctx: Ctx): void {
  const ix = ctx.ix;
  const enemies: Unit[] = [];
  const place = (squares: Coord[], i: number) => squares[i % squares.length]!;
  const l1 = guardroomSquares(ix, 1);
  const h5 = at(1, 'H-5');
  const hq = Math.max(0, l1.findIndex((sq) => sq.some((c) => sameSquare(c, h5))));
  l1.forEach((sq, i) => {
    enemies.push(makeEnemy(ctx, 'orcSquad', `Orc band ${enemies.length + 1}`, place(sq, 0), 4));
    if (i === hq) {
      enemies.push(makeEnemy(ctx, 'evilLeader', 'Orc captain', place(sq, 1), 1));
      enemies.push(makeEnemy(ctx, 'evilMagicUser', 'Gorlath the Witch', place(sq, 2), 1));
    }
  });
  for (const sq of guardroomSquares(ix, 2)) {
    enemies.push(makeEnemy(ctx, 'orcSquad', `Orc band ${enemies.length + 1}`, place(sq, 0), 6));
    enemies.push(makeEnemy(ctx, 'evilLeader', 'Gaoler', place(sq, 1), 1));
  }
  for (const sq of guardroomSquares(ix, 3)) enemies.push(makeEnemy(ctx, 'orcSquad', `Orc band ${enemies.length + 1}`, place(sq, 0), 6));

  const rooms = shuffle(
    ctx.state,
    ix.areas.filter((a) => a.isRoom && a.level <= 3),
  );
  const pool = shuffle(ctx.state, [...MONSTER_POOL]);
  for (let i = 0; i < 5 && i < rooms.length; i++) {
    const room = rooms[i]!;
    const cls = pool[i % pool.length]!;
    const m = makeEnemy(ctx, cls, MONSTER_NAMES[cls] ?? cls, pick(ctx.state, room.squares), 1);
    m.homeArea = room.id;
    enemies.push(m);
  }
  const lair = ix.map.levels.find((l) => l.lair)?.lair;
  if (lair) {
    const d = makeEnemy(ctx, 'dragon', 'The Dragon', lair, 1);
    d.homeArea = areaAt(ix, lair)?.id;
    d.breathCooldown = 0;
    enemies.push(d);
  }
  const cells = ix.map.levels.flatMap((l) => l.prisonCells);
  ctx.state.castle.prisoners = cells.map((_, i) => Math.floor(6 / cells.length) + (i < 6 % cells.length ? 1 : 0));
  ctx.state.castle.enemies = enemies;
}

function payWages(ctx: Ctx): void {
  const s = ctx.state;
  const heroes = s.heroes.filter((h) => h.alive);
  const wages = s.barracks * CAMPAIGN.wagePerMan + heroes.reduce((n, h) => n + (h.cls === 'hobart' ? CAMPAIGN.wageHobart : CAMPAIGN.wagePerHero), 0);
  s.lastWages = wages;
  if (s.gold < wages) {
    s.gold -= wages;
    lose(ctx, `The treasury could not pay ${wages} gold in wages. The company deserts.`);
    return;
  }
  s.gold -= wages;
}

function lose(ctx: Ctx, reason: string): void {
  ctx.state.stage = 'lost';
  ctx.state.endReason = reason;
  ctx.emit({ type: 'campaignOver', won: false, reason });
}

export function hire(ctx: Ctx, men: number): void {
  const s = ctx.state;
  if (s.stage !== 'week') throw new RuleError('Hire between expeditions.');
  if (!Number.isInteger(men) || men < 1) throw new RuleError('Hire at least one man.');
  if (s.hiredThisWeek + men > CAMPAIGN.hirePerWeek) throw new RuleError(`At most ${CAMPAIGN.hirePerWeek} recruits a week.`);
  const cost = men * CAMPAIGN.hireCost;
  if (cost > s.gold) throw new RuleError('Not enough gold.');
  s.gold -= cost;
  s.barracks += men;
  s.hiredThisWeek += men;
}

/** Orcs regrow and fill their squads (9.65 step 4). */
function regroup(ctx: Ctx): void {
  const castle = ctx.state.castle;
  let orcs = CAMPAIGN.orcRegrowth;
  for (const e of castle.enemies) {
    if (e.cls !== 'orcSquad' || orcs <= 0) continue;
    const add = Math.min(orcs, Math.max(0, 8 - e.men));
    e.men += add;
    orcs -= add;
  }
  if (orcs > 0) {
    const rooms = ctx.ix.areas.filter((a) => a.isGuardroom);
    if (rooms.length) {
      const room = pick(ctx.state, rooms);
      castle.enemies.push(makeEnemy(ctx, 'orcSquad', 'Fresh orc band', room.squares[0]!, orcs));
    }
  }
}

function advanceWeek(ctx: Ctx): void {
  const s = ctx.state;
  regroup(ctx);
  if (s.week >= s.maxWeeks) {
    const hobart = s.heroes.find((h) => h.cls === 'hobart');
    if (hobart?.alive && s.gold >= s.goalGold) {
      s.stage = 'won';
      s.endReason = `After ${s.maxWeeks} weeks the treasury holds ${s.gold.toLocaleString('en-US')} gold. Valkenburg's lord has a war chest at last.`;
      ctx.emit({ type: 'campaignOver', won: true, reason: s.endReason });
    } else {
      lose(ctx, `After ${s.maxWeeks} weeks the treasury holds ${s.gold.toLocaleString('en-US')} gold, short of the ${s.goalGold.toLocaleString('en-US')} needed. The King calls in his loan.`);
    }
    return;
  }
  s.week += 1;
  s.stage = 'week';
  s.hiredThisWeek = 0;
  payWages(ctx);
}

export function skipWeek(ctx: Ctx): void {
  if (ctx.state.stage !== 'week') throw new RuleError('Not now.');
  advanceWeek(ctx);
}

export function continueAfterDebrief(ctx: Ctx): void {
  if (ctx.state.stage !== 'debrief') throw new RuleError('Not now.');
  advanceWeek(ctx);
}

// ------------------------------------------------------------ expeditions

function newUnit(ctx: Ctx, base: Partial<Unit> & Pick<Unit, 'cls' | 'name' | 'pos' | 'side'>): Unit {
  const s = STATS[base.cls];
  return {
    id: ctx.nextId('u'),
    men: 1,
    wounds: 0,
    maxWounds: s.maxWounds,
    armor: 'normal',
    focus: 0,
    actionsLeft: 2,
    movedThisTurn: 0,
    spellPoints: 0,
    enchanted: false,
    charges: 0,
    loot: [],
    dormant: false,
    panicked: false,
    panicTurns: 0,
    overwatch: false,
    asleepTurns: 0,
    webbed: false,
    climbingTurns: 0,
    exited: false,
    menAtPhaseStart: 1,
    ...base,
  };
}

/** Find a square at or near `start` with room for `men` more friendly men. */
function landingSquare(ctx: Ctx, start: Coord, men: number): Coord {
  const seen = new Set<string>([squareKey(start)]);
  const queue = [start];
  while (queue.length) {
    const c = queue.shift()!;
    if (cellAt(ctx.map, c) === 'floor' && !ctx.hasEnemyAt(c, 'player') && ctx.menIn(c, 'player') + men <= 12) return c;
    for (const n of adjacentSquares(ctx, c)) {
      const k = squareKey(n);
      if (!seen.has(k)) {
        seen.add(k);
        queue.push(n);
      }
    }
  }
  return start;
}

export function beginMuster(ctx: Ctx): void {
  if (ctx.state.stage !== 'week') throw new RuleError('Not now.');
  if (ctx.state.gold < CAMPAIGN.outfitCost) throw new RuleError(`Outfitting costs ${CAMPAIGN.outfitCost} gold.`);
  ctx.state.stage = 'muster';
}

export function cancelMuster(ctx: Ctx): void {
  if (ctx.state.stage !== 'muster') throw new RuleError('Not now.');
  ctx.state.stage = 'week';
}

export function launch(ctx: Ctx, plan: MusterPlan): void {
  const s = ctx.state;
  if (s.stage !== 'muster') throw new RuleError('Muster first.');
  const units = plan.heroes.length + plan.squads.length;
  if (units < 1) throw new RuleError('Send someone.');
  if (units > CAMPAIGN.maxUnits) throw new RuleError(`At most ${CAMPAIGN.maxUnits} units.`);
  const men = plan.squads.reduce((n, q) => n + q.squad.men, 0);
  if (men > CAMPAIGN.maxMen) throw new RuleError(`At most ${CAMPAIGN.maxMen} men.`);
  if (men > s.barracks) throw new RuleError('Not that many men in the barracks.');
  for (const q of plan.squads) {
    if (q.squad.men < CAMPAIGN.squadMin || q.squad.men > CAMPAIGN.squadMax) throw new RuleError(`Squads are ${CAMPAIGN.squadMin} to ${CAMPAIGN.squadMax} men.`);
  }
  const entrances = ctx.ix.entrances;
  for (const e of [...plan.heroes.map((h) => h.entrance), ...plan.squads.map((q) => q.entrance)]) {
    if (!entrances.has(squareKey(e))) throw new RuleError(`${label(e)} is not an entrance.`);
  }
  const ids = new Set<string>();
  for (const h of plan.heroes) {
    const hero = s.heroes.find((x) => x.id === h.heroId);
    if (!hero || !hero.alive) throw new RuleError('That hero is not available.');
    if (ids.has(h.heroId)) throw new RuleError('A hero can only go once.');
    ids.add(h.heroId);
  }
  if (s.gold < CAMPAIGN.outfitCost) throw new RuleError('Not enough gold to outfit the expedition.');
  s.gold -= CAMPAIGN.outfitCost;
  s.barracks -= men;

  const exp: Expedition = {
    turn: 1,
    phase: 'player',
    alarm: 0,
    units: [],
    doors: {},
    chests: [],
    floorLoot: structuredClone(s.castle.floorLoot),
    searchProgress: {},
    explored: {},
    smoke: {},
    charges: [],
    waveTimer: 0,
    waveCount: 0,
    noiseThisTurn: [],
    spotted: {},
    fallen: [],
    hasClimbingGear: true,
    combatBlessing: {},
    revealed: {},
    prisoners: {},
    monsterRooms: {},
    musterMen: men,
    log: [],
  };
  s.expedition = exp;

  // Doors (spec 3.2). Blasted walls from earlier weeks too.
  const destroyed = new Set(s.castle.destroyedDoors);
  for (const lv of ctx.map.levels) {
    for (let y = 0; y < lv.height; y++) {
      for (let x = lv.x0; x < lv.x0 + lv.width; x++) {
        const c = { level: lv.id, x, y };
        for (const d of DIRS) {
          const kind = edgeKindAt(ctx.map, c, d);
          if (kind !== 'door' && kind !== 'locked') continue;
          const key = d === 'n' ? `${lv.id}:h:${x},${y}` : d === 's' ? `${lv.id}:h:${x},${y + 1}` : d === 'w' ? `${lv.id}:v:${x},${y}` : `${lv.id}:v:${x + 1},${y}`;
          if (exp.doors[key]) continue;
          exp.doors[key] = newDoor(kind === 'locked', destroyed.has(key));
        }
      }
    }
  }
  for (const key of destroyed) if (!exp.doors[key]) exp.doors[key] = newDoor(false, true);

  // The castle's garrison, back at its posts.
  for (const e of s.castle.enemies) {
    const u: Unit = structuredClone(e);
    u.pos = u.post ? { ...u.post } : u.pos;
    u.dormant = true;
    u.wounds = 0;
    u.actionsLeft = 0;
    u.panicked = false;
    u.panicTurns = 0;
    u.asleepTurns = 0;
    u.webbed = false;
    u.ambushReady = u.cls === 'mantis' ? true : undefined;
    exp.units.push(u);
    if (u.homeArea !== undefined && u.cls !== 'dragon') exp.monsterRooms[u.homeArea] = STATS[u.cls].maxWounds;
  }
  const cells = ctx.map.levels.flatMap((l) => l.prisonCells);
  cells.forEach((c, i) => {
    const area = areaAt(ctx.ix, c);
    if (area && (s.castle.prisoners[i] ?? 0) > 0) exp.prisoners[area.id] = s.castle.prisoners[i]!;
  });

  // Three dummy contacts (4.82), away from the entrances.
  const entranceSquares = ctx.map.levels.flatMap((l) => l.entrances);
  const floor = ctx.ix.floorSquares.filter((c) => c.level <= 3 && entranceSquares.every((e) => e.level !== c.level || Math.abs(e.x - c.x) + Math.abs(e.y - c.y) >= 6));
  for (let i = 0; i < 3 && floor.length; i++) {
    const d = makeEnemy(ctx, 'dummy', 'Contact', pick(ctx.state, floor), 1);
    d.dormant = false;
    exp.units.push(d);
  }

  // The company.
  let squadNo = 0;
  for (const h of plan.heroes) {
    const hero = s.heroes.find((x) => x.id === h.heroId)!;
    const pos = landingSquare(ctx, h.entrance, 1);
    const u = newUnit(ctx, {
      side: 'player',
      cls: hero.cls,
      name: hero.name,
      pos,
      heroId: hero.id,
      enchanted: hero.enchanted,
      focus: 1,
      spellPoints: hero.cls === 'magicUser' ? 10 : 0,
      charges: hero.cls === 'dwarf' ? CAMPAIGN.charges : 0,
    });
    exp.units.push(u);
  }
  for (const q of plan.squads) {
    const pos = landingSquare(ctx, q.entrance, q.squad.men);
    const name = q.squad.name || `${ORDINALS[squadNo] ?? `${squadNo + 1}th`} Squad`;
    squadNo++;
    exp.units.push(newUnit(ctx, { side: 'player', cls: 'squad', name, pos, men: q.squad.men, armor: q.squad.armor, menAtPhaseStart: q.squad.men }));
  }
  s.stage = 'expedition';
  ctx.emit({ type: 'phase', phase: 'player', turn: 1 });
  ctx.log(`Week ${s.week}: the company enters Valkenburg Castle.`);
  afterPlayerAction(ctx);
}

function newDoor(locked: boolean, destroyed: boolean): DoorState {
  return { open: destroyed, locked: locked && !destroyed, destroyed, jammed: false, unsmashable: false, chop: 0 };
}

/** Housekeeping after anything a player unit does. */
export function afterPlayerAction(ctx: Ctx): void {
  if (!ctx.state.expedition) return;
  const visible = playerVisible(ctx);
  // Dummies vanish when seen.
  for (const d of ctx.live('castle').filter((u) => u.cls === 'dummy')) {
    if (visible.has(squareKey(d.pos))) ctx.exp.units = ctx.exp.units.filter((x) => x.id !== d.id);
  }
  checkSpotting(ctx);
  freePrisoners(ctx);
  checkEnd(ctx);
}

/** End the expedition if Hobart died or no one is left inside. */
export function checkEnd(ctx: Ctx): boolean {
  const exp = ctx.state.expedition;
  if (!exp) return true;
  const hobartDead = exp.fallen.some((u) => u.cls === 'hobart');
  if (hobartDead || ctx.fighters('player').length === 0) {
    endExpedition(ctx);
    if (hobartDead) lose(ctx, 'Lord Hobart has fallen in the dark beneath his own castle. The Van Valkenburg claim dies with him.');
    return true;
  }
  return false;
}

function endExpedition(ctx: Ctx): void {
  const s = ctx.state;
  const exp = ctx.exp;
  const out = exp.units.filter((u) => u.side === 'player' && u.exited);
  let banked = 0;
  const lootNames: string[] = [];
  for (const u of out) {
    for (const it of u.loot) {
      banked += it.value;
      lootNames.push(it.name);
    }
  }
  const menOut = out.filter((u) => STATS[u.cls].isSquad && !u.freed).reduce((n, u) => n + u.men, 0);
  const rescued = out.filter((u) => u.freed).reduce((n, u) => n + u.men, 0);
  const menLost = Math.max(0, exp.musterMen - menOut);
  const heroesLost = exp.fallen.filter((u) => u.side === 'player' && u.heroId).map((u) => u.name);
  for (const f of exp.fallen) {
    if (f.heroId) {
      const h = s.heroes.find((x) => x.id === f.heroId);
      if (h) h.alive = false;
    }
  }
  const deathPayments = menLost * CAMPAIGN.deathPerMan + heroesLost.length * CAMPAIGN.deathPerHero;
  s.gold += banked - deathPayments;
  s.barracks += menOut + rescued;

  // What the castle keeps (spec 1, step 6).
  s.castle.enemies = exp.units.filter((u) => u.side === 'castle' && u.cls !== 'dummy').map((u) => ({ ...u, post: u.post ?? u.pos }));
  s.castle.destroyedDoors = Object.entries(exp.doors)
    .filter(([, d]) => d.destroyed)
    .map(([k]) => k);
  s.castle.floorLoot = exp.floorLoot;
  const cells = ctx.map.levels.flatMap((l) => l.prisonCells);
  s.castle.prisoners = cells.map((c) => {
    const area = areaAt(ctx.ix, c);
    return area ? exp.prisoners[area.id] ?? 0 : 0;
  });
  s.castle.dragonAlive = exp.units.some((u) => u.cls === 'dragon');

  s.lastDebrief = { week: s.week, goldBanked: banked, lootNames, menLost, heroesLost, deathPayments, prisonersRescued: rescued };
  s.expedition = undefined;
  s.stage = 'debrief';
  ctx.emit({ type: 'expeditionOver' });
}

/** The player ends the turn: charges blow, the castle acts, a new turn begins. */
export function endTurn(ctx: Ctx): void {
  const exp = ctx.exp;
  if (exp.phase !== 'player') throw new RuleError('Not your turn.');
  exp.combatBlessing = {};
  detonateCharges(ctx);
  if (checkEnd(ctx)) return;
  const visible = playerVisible(ctx);
  castlePhase(ctx, visible);
  if (checkEnd(ctx)) return;

  // End of the castle phase.
  closeDoors(ctx);
  for (const k of Object.keys(exp.smoke)) {
    exp.smoke[k]! -= 1;
    if (exp.smoke[k]! <= 0) delete exp.smoke[k];
  }
  addNoise(ctx, undefined, 2);
  exp.noiseThisTurn = [];

  // A new player turn.
  exp.turn += 1;
  exp.phase = 'player';
  for (const u of ctx.live('player')) {
    u.actionsLeft = 2;
    u.movedThisTurn = 0;
    u.menAtPhaseStart = u.men;
    u.overwatch = false;
    u.shieldwallFacing = undefined;
    if (u.panicTurns > 0) {
      u.actionsLeft = 0;
      u.panicTurns -= 1;
      u.panicked = false;
      ctx.log(`${u.name} is still rallying.`);
    }
    if (u.webbed) {
      u.actionsLeft = Math.max(0, u.actionsLeft - 1);
      u.webbed = false;
    }
    if (u.asleepTurns > 0) {
      u.actionsLeft = 0;
      u.asleepTurns -= 1;
    }
    if (u.climbingTurns > 0) {
      u.climbingTurns -= 1;
      if (u.climbingTurns === 0 && u.climbTarget) {
        u.pos = { ...u.climbTarget };
        u.climbTarget = undefined;
        u.actionsLeft = 0;
        ctx.emit({ type: 'moved', unitId: u.id, path: [u.pos] });
        ctx.log(`${u.name} hauls up over the balcony at ${label(u.pos)}.`);
      }
    }
  }
  ctx.emit({ type: 'phase', phase: 'player', turn: exp.turn });
  afterPlayerAction(ctx);
}
