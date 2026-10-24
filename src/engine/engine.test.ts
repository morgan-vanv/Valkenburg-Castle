import { describe, expect, it } from 'vitest';
import { createEngine } from './engine';
import { v2Castle } from '../data/maps/v2';
import { Ctx } from './ctx';
import { indexMap } from './mapIndex';
import { frontage, expectedWounds, rollSlots } from './combat';
import { at, squareKey } from './geometry';
import { makeEnemy } from './ai';
import { RUN } from './data';
import type { Command, GameState, Unit } from './types';

const map = v2Castle;
const engine = createEngine(map);
const WEST = at(1, 'B-7');

function ok(state: GameState, cmd: Command): GameState {
  const r = engine.apply(state, cmd);
  if (r.error) throw new Error(`${cmd.type}: ${r.error}`);
  return r.state;
}

function started(seed = 7, buys: Command[] = []): GameState {
  let s = engine.newRun(seed);
  for (const b of buys) s = ok(s, b);
  return ok(s, { type: 'launch', plan: { entrances: {} } });
}

function unit(s: GameState, name: string): Unit {
  return s.expedition!.units.find((u) => u.name === name)!;
}

/** Remove every enemy so a test can focus on one rule. */
function emptyCastle(s: GameState): GameState {
  s.expedition!.units = s.expedition!.units.filter((u) => u.side === 'player');
  return s;
}

describe('the run', () => {
  it('starts in the shop with a full purse', () => {
    const s = engine.newRun(1);
    expect(s.stage).toBe('shop');
    expect(s.purse).toBe(RUN.purse);
  });

  it('buys and refunds within limits', () => {
    let s = engine.newRun(1);
    s = ok(s, { type: 'buy', item: 'rope' });
    expect(s.purse).toBe(RUN.purse - 30);
    expect(engine.apply(s, { type: 'buy', item: 'rope' }).error).toMatch(/at most 1/);
    s = ok(s, { type: 'refund', item: 'rope' });
    expect(s.purse).toBe(RUN.purse);
  });

  it('launches the default company with loot and enemies on the map', () => {
    const s = started(3, [{ type: 'buy', item: 'sellswords' }, { type: 'buy', item: 'banner' }]);
    const mine = s.expedition!.units.filter((u) => u.side === 'player');
    expect(mine.map((u) => u.name).sort()).toEqual(['1st Squad', '2nd Squad', 'Aldous', 'Lord Hobart', 'Pim', 'Sellswords', 'Thorvold']);
    expect(mine.filter((u) => u.heroId).every((u) => u.focus === 3)).toBe(true);
    expect(Object.values(s.expedition!.floorLoot).flat()).toHaveLength(map.loot!.length);
    expect(s.expedition!.units.filter((u) => u.side === 'castle')).toHaveLength(map.spawns!.length);
  });

  it('is deterministic for a seed', () => {
    expect(JSON.stringify(started(42))).toBe(JSON.stringify(started(42)));
  });
});

describe('doors', () => {
  it('Pim picks a lock silently; forcing one is loud', () => {
    let s = emptyCastle(started());
    const pim = unit(s, 'Pim');
    s = ok(s, { type: 'move', unitId: pim.id, to: at(1, 'D-6') });
    const door = engine.actions(s, pim.id).find((o) => o.kind === 'door');
    expect(door && door.kind === 'door' && door.methods).toEqual(['pick', 'force']);
    const edge = (door as { edge: string }).edge;
    const picked = ok(s, { type: 'door', unitId: pim.id, edge, method: 'pick' });
    expect(picked.expedition!.alarm).toBe(s.expedition!.alarm);
    expect(picked.expedition!.doors[edge]!.locked).toBe(false);
    const forced = ok(s, { type: 'door', unitId: pim.id, edge, method: 'force' });
    expect(forced.expedition!.alarm).toBeGreaterThan(s.expedition!.alarm);
  });

  it('a blasting charge opens a cracked wall at the end of the turn', () => {
    let s = emptyCastle(started(5, [{ type: 'buy', item: 'charge' }]));
    const hob = unit(s, 'Lord Hobart');
    // Teleport for the test: stand in the Library's nook by the cracked wall.
    hob.pos = at(1, 'G-3');
    const blast = engine.actions(s, hob.id).find((o) => o.kind === 'door' && o.methods.includes('blast'));
    expect(blast).toBeTruthy();
    s = ok(s, { type: 'door', unitId: hob.id, edge: (blast as { edge: string }).edge, method: 'blast' });
    expect(s.expedition!.pack.charge).toBe(0);
    // Hobart must step clear before it blows.
    s = ok(s, { type: 'move', unitId: hob.id, to: at(1, 'H-3') });
    s = ok(s, { type: 'endTurn' });
    const reach = engine.reachable(s, unit(s, 'Lord Hobart').id);
    expect(s.stage).toBe('expedition');
    expect(reach.some((r) => squareKey(r.to) === squareKey(at(1, 'F-3')) || r.path.some((c) => squareKey(c) === squareKey(at(1, 'F-3'))))).toBe(true);
  });
});

describe('loot', () => {
  it('heroes carry one sack; carrying costs a move; the hoard needs a squad', () => {
    let s = emptyCastle(started());
    const hob = unit(s, 'Lord Hobart');
    hob.pos = at(1, 'E-4');
    const pile = engine.actions(s, hob.id).find((o) => o.kind === 'pickUp');
    s = ok(s, { type: 'pickUp', unitId: hob.id, itemId: (pile as { itemIds: string[] }).itemIds[0]! });
    const after = unit(s, 'Lord Hobart');
    expect(after.loot).toHaveLength(1);
    expect(engine.moveAllowance(s, after)).toBe(3);
    // The hoard is two sacks.
    after.pos = at(2, 'T-2');
    after.loot = [];
    const hoard = engine.actions(s, after.id).find((o) => o.kind === 'pickUp') as { itemIds: string[] };
    expect(engine.apply(s, { type: 'pickUp', unitId: after.id, itemId: hoard.itemIds[0]! }).error).toMatch(/2 free sacks/);
    const squad = unit(s, '1st Squad');
    squad.pos = at(2, 'T-2');
    expect(engine.apply(s, { type: 'pickUp', unitId: squad.id, itemId: hoard.itemIds[0]! }).error).toBeUndefined();
  });

  it('scores loot carried out plus the unspent purse, with a medal', () => {
    let s = emptyCastle(started(8, [{ type: 'buy', item: 'rope' }]));
    unit(s, 'Lord Hobart').loot.push({ id: 'x', name: 'Test gold', value: 700, weight: 1 });
    for (const id of s.expedition!.units.filter((x) => x.side === 'player').map((x) => x.id)) {
      s.expedition!.units.find((x) => x.id === id)!.pos = { ...WEST };
      s = ok(s, { type: 'exit', unitId: id });
      if (s.stage !== 'expedition') break;
    }
    expect(s.stage).toBe('results');
    expect(s.result!.survived).toBe(true);
    expect(s.result!.score).toBe(700 + RUN.purse - 30);
    expect(s.result!.medal).toBe('bronze');
  });

  it('loses the run when Hobart is left behind', () => {
    let s = emptyCastle(started());
    for (const id of s.expedition!.units.filter((x) => x.side === 'player' && x.cls !== 'hobart').map((x) => x.id)) {
      s.expedition!.units.find((x) => x.id === id)!.pos = { ...WEST };
      s = ok(s, { type: 'exit', unitId: id });
    }
    expect(s.stage).toBe('expedition');
    const hob = unit(s, 'Lord Hobart');
    s.expedition!.units = s.expedition!.units.filter((u) => u.id !== hob.id);
    s.expedition!.fallen.push(hob);
    s = ok(s, { type: 'endTurn' });
    expect(s.stage).toBe('results');
    expect(s.result!.survived).toBe(false);
    expect(s.result!.score).toBe(0);
  });
});

describe('the shaft', () => {
  it('climbing needs a rope; jumping hurts', () => {
    let s = emptyCastle(started());
    const sq = unit(s, '1st Squad');
    sq.pos = at(1, 'I-12');
    expect(engine.actions(s, sq.id).some((o) => o.kind === 'climb')).toBe(false);
    const jump = engine.actions(s, sq.id).find((o) => o.kind === 'jump') as { targets: { level: number }[] };
    expect(jump.targets[0]!.level).toBe(2);
    s = ok(s, { type: 'jump', unitId: sq.id, to: jump.targets[0] as never });
    expect(unit(s, '1st Squad').pos.level).toBe(2);
  });

  it('with a rope, climbing down and back up is safe', () => {
    let s = emptyCastle(started(2, [{ type: 'buy', item: 'rope' }]));
    const sq = unit(s, '1st Squad');
    sq.pos = at(1, 'I-12');
    const down = engine.actions(s, sq.id).find((o) => o.kind === 'climb') as unknown as { targets: never[] };
    s = ok(s, { type: 'climb', unitId: sq.id, to: down.targets[0]! });
    expect(unit(s, '1st Squad').men).toBe(RUN.squadMen);
    expect(s.expedition!.rope).toBe(true);
    const up = engine.actions(s, sq.id).find((o) => o.kind === 'climb') as { targets: { level: number }[] };
    expect(up.targets[0]!.level).toBe(1);
  });
});

describe('combat', () => {
  it('measures frontage: doorways narrow, wide halls open', () => {
    const s = started();
    const ctx = new Ctx(s, indexMap(map));
    expect(frontage(ctx, at(1, 'Q-6'), at(1, 'Q-5'))).toBe('narrow');
    expect(frontage(ctx, at(1, 'J-7'), at(1, 'K-7'))).toBe('open');
  });

  it('computes expected wounds and locks Focus slots', () => {
    expect(expectedWounds(2, 2, 50, false)).toBe(3);
    const ctx = new Ctx(started(), indexMap(map));
    expect(rollSlots(ctx, 3, 3, 10, false).wounds).toBe(4);
  });

  it('heals with a draught', () => {
    let s = emptyCastle(started(4, [{ type: 'buy', item: 'draught' }]));
    const sq = unit(s, '1st Squad');
    sq.men = 3;
    s = ok(s, { type: 'useItem', unitId: sq.id, item: 'draught', targetId: sq.id });
    expect(unit(s, '1st Squad').men).toBe(6);
    expect(s.expedition!.pack.draught).toBe(0);
  });

  it('resolves a melee attack in the open', () => {
    const s = emptyCastle(started());
    const ctx = new Ctx(s, indexMap(map));
    const sq = unit(s, '1st Squad');
    sq.pos = at(1, 'J-7');
    const orc = makeEnemy(ctx, 'orcSquad', 'Test orcs', at(1, 'K-7'), 4);
    orc.dormant = false;
    s.expedition!.units.push(orc);
    const pv = engine.previewAttack(s, sq.id, orc.id, 'melee', 0);
    expect(pv.frontage).toBe('open');
    expect(pv.slots).toBe(3);
    expect(engine.apply(s, { type: 'melee', unitId: sq.id, targetId: orc.id, focus: 0 }).error).toBeUndefined();
  });
});

describe('robustness', () => {
  it('survives random legal play across seeds', () => {
    for (let seed = 1; seed <= 15; seed++) {
      let s = started(seed, [{ type: 'buy', item: 'charge' }, { type: 'buy', item: 'rope' }, { type: 'buy', item: 'smoke' }, { type: 'buy', item: 'draught' }]);
      let rng = seed * 9973;
      const rand = (n: number) => {
        rng = (rng * 1103515245 + 12345) % 2147483648;
        return rng % n;
      };
      for (let step = 0; step < 300 && s.stage === 'expedition'; step++) {
        const mine = s.expedition!.units.filter((u) => u.side === 'player' && !u.exited && u.actionsLeft > 0);
        if (!mine.length || rand(8) === 0) {
          s = ok(s, { type: 'endTurn' });
          continue;
        }
        const u = mine[rand(mine.length)]!;
        const opts = engine.actions(s, u.id);
        if (!opts.length) {
          s = ok(s, { type: 'endTurn' });
          continue;
        }
        const o = opts[rand(opts.length)]!;
        let cmd: Command | undefined;
        switch (o.kind) {
          case 'move': {
            const r = engine.reachable(s, u.id);
            if (r.length) cmd = { type: 'move', unitId: u.id, to: r[rand(r.length)]!.to };
            break;
          }
          case 'melee':
          case 'missile':
            cmd = { type: o.kind, unitId: u.id, targetId: o.targetIds[0]!, focus: rand(2) };
            break;
          case 'door':
            cmd = { type: 'door', unitId: u.id, edge: o.edge, method: o.methods[rand(o.methods.length)]! };
            break;
          case 'pickUp':
            cmd = { type: 'pickUp', unitId: u.id, itemId: o.itemIds[0]! };
            break;
          case 'item':
            cmd = { type: 'useItem', unitId: u.id, item: o.item, target: o.targets[0], targetId: o.targetIds[0] };
            break;
          case 'cast':
            cmd = { type: 'cast', unitId: u.id, spell: o.spell, target: o.targets[0], targetId: o.targetIds[0] };
            break;
          case 'jump':
          case 'climb':
            cmd = { type: o.kind, unitId: u.id, to: o.targets[0]! };
            break;
          case 'exit':
            cmd = { type: 'exit', unitId: u.id };
            break;
          case 'overwatch':
            cmd = { type: 'overwatch', unitId: u.id };
            break;
          default:
            cmd = undefined;
        }
        if (cmd) s = engine.apply(s, cmd).state;
      }
      expect(['expedition', 'results']).toContain(s.stage);
    }
  });
});
