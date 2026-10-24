// The one-shot run (V2): shop → one expedition → results.

import { makeEnemy, castlePhase } from './ai';
import { addNoise, checkSpotting } from './alarm';
import { detonateCharges, closeDoors } from './doors';
import { medalFor, RUN, SHOP, STATS } from './data';
import { cellAt, edgeKey, edgeKindAt, label, squareKey, DIRS } from './geometry';
import type { MapIndex } from './mapIndex';
import { adjacentSquares } from './movement';
import { playerVisible } from './sight';
import { Ctx, RuleError } from './ctx';
import type { Coord, DoorState, Expedition, GameState, Hero, ItemId, LaunchPlan, Unit } from './types';

export const HEROES: Hero[] = [
  { id: 'hobart', cls: 'hobart', name: 'Lord Hobart', alive: true, enchanted: true },
  { id: 'thorvold', cls: 'dwarf', name: 'Thorvold', alive: true, enchanted: true },
  { id: 'pim', cls: 'burglar', name: 'Pim', alive: true, enchanted: false },
  { id: 'aldous', cls: 'magicUser', name: 'Aldous', alive: true, enchanted: false },
];

const EMPTY_PACK: Record<ItemId, number> = { charge: 0, rope: 0, draught: 0, smoke: 0, sellswords: 0, banner: 0 };

/** Keys the launch plan uses for each member of the company. */
export function companyKeys(state: GameState): string[] {
  return [...state.heroes.map((h) => h.id), 'squad1', 'squad2', ...(state.pack.sellswords ? ['sellswords'] : [])];
}

export function newRun(_ix: MapIndex, seed: number): GameState {
  return {
    version: 2,
    seed,
    rng: seed >>> 0,
    stage: 'shop',
    purse: RUN.purse,
    pack: { ...EMPTY_PACK },
    heroes: HEROES.map((h) => ({ ...h })),
    nextId: 1,
  };
}

export function buy(ctx: Ctx, item: ItemId): void {
  const s = ctx.state;
  if (s.stage !== 'shop') throw new RuleError('The shop is closed once you are inside.');
  const it = SHOP.find((x) => x.id === item);
  if (!it) throw new RuleError('No such item.');
  if (s.pack[item] >= it.max) throw new RuleError(`You can carry at most ${it.max}.`);
  if (s.purse < it.cost) throw new RuleError('Not enough gold.');
  s.purse -= it.cost;
  s.pack[item] += 1;
}

export function refund(ctx: Ctx, item: ItemId): void {
  const s = ctx.state;
  if (s.stage !== 'shop') throw new RuleError('Too late for refunds.');
  const it = SHOP.find((x) => x.id === item);
  if (!it || s.pack[item] < 1) throw new RuleError('Nothing to return.');
  s.purse += it.cost;
  s.pack[item] -= 1;
}

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

/** A square at or near `start` with room for `men` more friendly men. */
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

function newDoor(locked: boolean): DoorState {
  return { open: false, locked, destroyed: false, jammed: false, unsmashable: false, chop: 0 };
}

export function launch(ctx: Ctx, plan: LaunchPlan): void {
  const s = ctx.state;
  if (s.stage !== 'shop') throw new RuleError('Already inside.');
  const entrances = ctx.map.levels.flatMap((l) => l.entrances);
  if (!entrances.length) throw new RuleError('This castle has no way in.');
  const entryFor = (key: string): Coord => {
    const e = plan.entrances[key];
    if (!e) return entrances[0]!;
    if (!ctx.ix.entrances.has(squareKey(e))) throw new RuleError(`${label(e)} is not an entrance.`);
    return e;
  };

  const exp: Expedition = {
    turn: 1,
    phase: 'player',
    alarm: 0,
    units: [],
    doors: {},
    chests: [],
    floorLoot: {},
    searchProgress: {},
    explored: {},
    smoke: {},
    charges: [],
    waveTimer: 0,
    waveCount: 0,
    noiseThisTurn: [],
    spotted: {},
    fallen: [],
    hasClimbingGear: false,
    combatBlessing: {},
    revealed: {},
    prisoners: {},
    monsterRooms: {},
    musterMen: 0,
    pack: { ...s.pack },
    rope: false,
    log: [],
  };
  s.expedition = exp;

  for (const lv of ctx.map.levels) {
    for (let y = 0; y < lv.height; y++)
      for (let x = lv.x0; x < lv.x0 + lv.width; x++) {
        const c = { level: lv.id, x, y };
        for (const d of DIRS) {
          const kind = edgeKindAt(ctx.map, c, d);
          if (kind !== 'door' && kind !== 'locked') continue;
          const key = edgeKey(c, d);
          if (!exp.doors[key]) exp.doors[key] = newDoor(kind === 'locked');
        }
      }
  }

  for (const spot of ctx.map.loot ?? []) {
    (exp.floorLoot[squareKey(spot.at)] ??= []).push({ id: ctx.nextId('i'), name: spot.name, value: spot.value, weight: spot.sacks });
  }

  for (const sp of ctx.map.spawns ?? []) {
    const e = makeEnemy(ctx, sp.cls, sp.name, sp.at, sp.men ?? 1);
    if (STATS[sp.cls].isMonster) e.leash = sp.cls === 'dragon' ? RUN.dragonLeash : RUN.monsterLeash;
    if (sp.cls === 'dragon') e.breathCooldown = 0;
    if (sp.awake) e.dormant = false;
    exp.units.push(e);
  }

  // The company.
  const banner = s.pack.banner > 0;
  for (const hero of s.heroes) {
    const pos = landingSquare(ctx, entryFor(hero.id), 1);
    exp.units.push(
      newUnit(ctx, {
        side: 'player',
        cls: hero.cls,
        name: hero.name,
        pos,
        heroId: hero.id,
        enchanted: hero.enchanted,
        focus: banner ? 3 : 1,
        spellPoints: hero.cls === 'magicUser' ? RUN.spellPoints : 0,
      }),
    );
  }
  const squads: [string, string, number][] = [
    ['squad1', '1st Squad', RUN.squadMen],
    ['squad2', '2nd Squad', RUN.squadMen],
  ];
  if (s.pack.sellswords) squads.push(['sellswords', 'Sellswords', RUN.sellswordMen]);
  for (const [key, name, men] of squads) {
    const pos = landingSquare(ctx, entryFor(key), men);
    exp.units.push(newUnit(ctx, { side: 'player', cls: 'squad', name, pos, men, startMen: men, menAtPhaseStart: men }));
    exp.musterMen += men;
  }
  s.stage = 'expedition';
  ctx.emit({ type: 'phase', phase: 'player', turn: 1 });
  ctx.log('The company slips into Valkenburg Castle.');
  afterPlayerAction(ctx);
}

/** Housekeeping after anything a player unit does. */
export function afterPlayerAction(ctx: Ctx): void {
  if (!ctx.state.expedition) return;
  playerVisible(ctx);
  checkSpotting(ctx);
  checkEnd(ctx);
}

/** End the run if Hobart died or no one is left inside. */
export function checkEnd(ctx: Ctx): boolean {
  const exp = ctx.state.expedition;
  if (!exp) return true;
  const hobartDead = exp.fallen.some((u) => u.cls === 'hobart');
  if (hobartDead || ctx.fighters('player').length === 0) {
    endRun(ctx, hobartDead);
    return true;
  }
  return false;
}

function endRun(ctx: Ctx, hobartDead: boolean): void {
  const s = ctx.state;
  const exp = ctx.exp;
  const out = exp.units.filter((u) => u.side === 'player' && u.exited);
  let lootGold = 0;
  const lootNames: string[] = [];
  for (const u of out)
    for (const it of u.loot) {
      lootGold += it.value;
      lootNames.push(it.name);
    }
  const menOut = out.filter((u) => STATS[u.cls].isSquad).reduce((n, u) => n + u.men, 0);
  const heroesLost = exp.fallen.filter((u) => u.side === 'player' && u.heroId).map((u) => u.name);
  for (const f of exp.fallen) {
    const h = f.heroId ? s.heroes.find((x) => x.id === f.heroId) : undefined;
    if (h) h.alive = false;
  }
  const survived = !hobartDead && out.some((u) => u.cls === 'hobart');
  const score = survived ? lootGold + s.purse : 0;
  const medal = survived ? medalFor(score) : 'none';
  const reason = survived
    ? `Lord Hobart walks out with ${lootGold.toLocaleString('en-US')} gold in loot${s.purse ? ` and ${s.purse} unspent` : ''}.`
    : hobartDead
      ? 'Lord Hobart has fallen in the dark beneath his own castle. The Van Valkenburg claim dies with him.'
      : 'The company got out, but Lord Hobart was left behind.';
  s.result = { survived, score, lootGold, purseLeft: s.purse, medal, lootNames, menLost: Math.max(0, exp.musterMen - menOut), heroesLost, turns: exp.turn, reason };
  s.expedition = undefined;
  s.stage = 'results';
  ctx.emit({ type: 'expeditionOver' });
  ctx.emit({ type: 'runOver', survived, score, medal, reason });
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

  closeDoors(ctx);
  for (const k of Object.keys(exp.smoke)) {
    exp.smoke[k]! -= 1;
    if (exp.smoke[k]! <= 0) delete exp.smoke[k];
  }
  addNoise(ctx, undefined, 2);
  exp.noiseThisTurn = [];

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
  }
  ctx.emit({ type: 'phase', phase: 'player', turn: exp.turn });
  afterPlayerAction(ctx);
}
