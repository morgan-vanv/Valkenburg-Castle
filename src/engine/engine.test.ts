import { describe, expect, it } from 'vitest';
import { createEngine } from './engine';
import { miniCastle } from './test/miniCastle';
import { Ctx } from './ctx';
import { indexMap } from './mapIndex';
import { frontage, expectedWounds, rollSlots } from './combat';
import { at, squareKey } from './geometry';
import { makeEnemy } from './ai';
import { CAMPAIGN } from './data';
import type { Command, GameState, MusterPlan, Unit } from './types';

const map = miniCastle();
const engine = createEngine(map);
const A1 = at(1, 'A-1');

function plan(over: Partial<MusterPlan> = {}): MusterPlan {
  return {
    heroes: [
      { heroId: 'hobart', entrance: A1 },
      { heroId: 'pim', entrance: A1 },
    ],
    squads: [{ squad: { id: 's1', name: '1st Squad', men: 8, armor: 'normal' }, entrance: A1 }],
    ...over,
  };
}

function ok(state: GameState, cmd: Command): GameState {
  const r = engine.apply(state, cmd);
  if (r.error) throw new Error(`${cmd.type}: ${r.error}`);
  return r.state;
}

function started(seed = 7): GameState {
  let s = engine.newCampaign(seed);
  s = ok(s, { type: 'beginMuster' });
  return ok(s, { type: 'launch', plan: plan() });
}

function unitNamed(s: GameState, name: string): Unit {
  return s.expedition!.units.find((u) => u.name === name)!;
}

describe('campaign', () => {
  it('starts in week 1 with wages paid', () => {
    const s = engine.newCampaign(1);
    expect(s.stage).toBe('week');
    expect(s.week).toBe(1);
    expect(s.lastWages).toBe(36 + 4 * 2 + 3);
    expect(s.gold).toBe(800 - s.lastWages);
    expect(s.castle.enemies.some((e) => e.cls === 'orcSquad')).toBe(true);
  });

  it('is deterministic for a seed', () => {
    expect(JSON.stringify(engine.newCampaign(42))).toBe(JSON.stringify(engine.newCampaign(42)));
  });

  it('hires within the weekly limit', () => {
    let s = engine.newCampaign(1);
    s = ok(s, { type: 'hire', men: 10 });
    expect(s.barracks).toBe(46);
    expect(engine.apply(s, { type: 'hire', men: 11 }).error).toMatch(/20/);
  });

  it('launches an expedition and validates the muster', () => {
    let s = engine.newCampaign(3);
    s = ok(s, { type: 'beginMuster' });
    const tooBig = plan({ squads: [{ squad: { id: 'x', name: 'Too big', men: 11, armor: 'normal' }, entrance: A1 }] });
    expect(engine.apply(s, { type: 'launch', plan: tooBig }).error).toBeTruthy();
    const goldBefore = s.gold;
    s = ok(s, { type: 'launch', plan: plan() });
    expect(s.stage).toBe('expedition');
    expect(s.gold).toBe(goldBefore - CAMPAIGN.outfitCost);
    expect(s.barracks).toBe(28);
    expect(s.expedition!.units.filter((u) => u.side === 'player')).toHaveLength(3);
  });

  it('skipping weeks to the end without enough gold loses', () => {
    let s = engine.newCampaign(5);
    for (let i = 0; i < 4; i++) s = ok(s, { type: 'skipWeek' });
    expect(s.stage).toBe('lost');
    expect(s.endReason).toMatch(/short/);
  });
});

describe('movement and doors', () => {
  it('reaches along the corridor and pays extra to open a door as a squad', () => {
    const s = started();
    const squad = unitNamed(s, '1st Squad');
    const reach = engine.reachable(s, squad.id);
    const a5 = reach.find((r) => squareKey(r.to) === squareKey(at(1, 'A-5')));
    expect(a5?.cost).toBe(4);
    const b2 = reach.find((r) => squareKey(r.to) === squareKey(at(1, 'B-2')));
    expect(b2?.cost).toBe(3); // A-2 (1) + door (2)
    const hobart = unitNamed(s, 'Lord Hobart');
    const hb2 = engine.reachable(s, hobart.id).find((r) => squareKey(r.to) === squareKey(at(1, 'B-2')));
    expect(hb2?.cost).toBe(2);
  });

  it('opens a door when walking through it', () => {
    const s = started();
    const hobart = unitNamed(s, 'Lord Hobart');
    const r = engine.apply(s, { type: 'move', unitId: hobart.id, to: at(1, 'B-2') });
    expect(r.error).toBeUndefined();
    expect(r.events.some((e) => e.type === 'doorOpened')).toBe(true);
    expect(unitNamed(r.state, 'Lord Hobart').actionsLeft).toBe(1);
  });

  it('cannot walk through a locked door but a burglar can try the lock', () => {
    let s = started();
    const pim = unitNamed(s, 'Pim');
    expect(engine.reachable(s, pim.id).some((r) => squareKey(r.to) === squareKey(at(1, 'B-5')))).toBe(false);
    s = ok(s, { type: 'move', unitId: pim.id, to: at(1, 'A-5') });
    // Orcs right behind the door secure it: it can only be forced.
    const secured = engine.actions(s, pim.id).find((o) => o.kind === 'door');
    expect(secured && secured.kind === 'door' && secured.secured).toBe(true);
    expect(secured && secured.kind === 'door' && secured.methods).not.toContain('pick');
    // With the guardroom empty, the burglar can pick it.
    s.expedition!.units = s.expedition!.units.filter((u) => u.side === 'player');
    const opts = engine.actions(s, pim.id);
    const door = opts.find((o) => o.kind === 'door');
    expect(door && door.kind === 'door' && door.methods).toContain('pick');
    const r = engine.apply(s, { type: 'door', unitId: pim.id, edge: (door as { edge: string }).edge, method: 'pick' });
    expect(r.error).toBeUndefined();
    expect(r.events.some((e) => e.type === 'doorAttempt')).toBe(true);
  });
});

describe('combat', () => {
  it('measures frontage', () => {
    const s = started();
    const ctx = new Ctx(s, indexMap(map));
    expect(frontage(ctx, at(1, 'A-2'), at(1, 'B-2'))).toBe('narrow'); // doorway
    expect(frontage(ctx, at(1, 'A-3'), at(1, 'A-4'))).toBe('wide'); // 1-wide corridor
    expect(frontage(ctx, at(1, 'C-2'), at(1, 'D-2'))).toBe('open'); // inside a room
  });

  it('computes expected wounds with focus and Perfect', () => {
    expect(expectedWounds(1, 1, 50, false)).toBe(1);
    expect(expectedWounds(2, 0, 50, false)).toBeCloseTo(1 + 0.25);
    expect(expectedWounds(2, 2, 50, false)).toBe(3);
  });

  it('locks focus slots as hits', () => {
    const s = started();
    const ctx = new Ctx(s, indexMap(map));
    const roll = rollSlots(ctx, 3, 3, 10, false);
    expect(roll.hits).toEqual([true, true, true]);
    expect(roll.perfect).toBe(true);
    expect(roll.wounds).toBe(4);
  });

  it('resolves a melee attack with a preview that matches', () => {
    const s = started();
    const ctx = new Ctx(s, indexMap(map));
    const orc = makeEnemy(ctx, 'orcSquad', 'Test orcs', at(1, 'A-2'), 4);
    orc.dormant = false;
    s.expedition!.units.push(orc);
    const squad = unitNamed(s, '1st Squad');
    const pv = engine.previewAttack(s, squad.id, orc.id, 'melee', 0);
    expect(pv.ok).toBe(true);
    expect(pv.frontage).toBe('wide');
    expect(pv.slots).toBe(2);
    const r = engine.apply(s, { type: 'melee', unitId: squad.id, targetId: orc.id, focus: 0 });
    expect(r.error).toBeUndefined();
    const atk = r.events.find((e) => e.type === 'attack');
    expect(atk && atk.type === 'attack' && atk.roll.slots).toBe(2);
    expect(unitNamed(r.state, '1st Squad').actionsLeft).toBe(0);
  });
});

describe('turns', () => {
  it('ends a turn, runs the castle, and raises the alarm', () => {
    const s = started();
    const r = engine.apply(s, { type: 'endTurn' });
    expect(r.error).toBeUndefined();
    expect(r.state.expedition!.turn).toBe(2);
    expect(r.state.expedition!.alarm).toBeGreaterThanOrEqual(2);
    expect(r.events.filter((e) => e.type === 'phase').map((e) => (e as { phase: string }).phase)).toEqual(['castle', 'player']);
  });

  it('exits, ends the expedition and banks loot at the debrief', () => {
    let s = started();
    const hob = unitNamed(s, 'Lord Hobart');
    hob.loot.push({ id: 'gold', name: '200 gold coins', value: 200, weight: 200 });
    const goldBefore = s.gold;
    for (const u of s.expedition!.units.filter((x) => x.side === 'player')) s = ok(s, { type: 'exit', unitId: u.id });
    expect(s.stage).toBe('debrief');
    expect(s.gold).toBe(goldBefore + 200);
    expect(s.barracks).toBe(36);
    s = ok(s, { type: 'continueAfterDebrief' });
    expect(s.week).toBe(2);
  });
});

describe('robustness', () => {
  it('survives random legal play across seeds', () => {
    for (let seed = 1; seed <= 12; seed++) {
      let s = started(seed);
      let rng = seed * 9973;
      const rand = (n: number) => {
        rng = (rng * 1103515245 + 12345) % 2147483648;
        return rng % n;
      };
      for (let step = 0; step < 250 && s.stage === 'expedition'; step++) {
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
          case 'search':
            cmd = { type: 'search', unitId: u.id };
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
        if (!cmd) continue;
        const r = engine.apply(s, cmd);
        s = r.state;
      }
      expect(['expedition', 'debrief', 'lost', 'won']).toContain(s.stage);
    }
  });
});

describe('alarm, overwatch and spells', () => {
  it('sends reinforcement waves once the castle is roused', () => {
    const s = started();
    s.expedition!.units = s.expedition!.units.filter((u) => u.side === 'player');
    s.expedition!.alarm = 75;
    let st = s;
    for (let i = 0; i < 3; i++) st = ok(st, { type: 'endTurn' });
    expect(st.stage).toBe('expedition');
    const reserves = st.expedition!.units.filter((u) => u.name.startsWith('Reserve band'));
    expect(reserves.length).toBeGreaterThanOrEqual(1);
  });

  it('fires overwatch at an enemy that walks into view', () => {
    const s = started(11);
    const ctx = new Ctx(s, indexMap(map));
    // Clear the garrison and put one awake orc band down the corridor.
    s.expedition!.units = s.expedition!.units.filter((u) => u.side === 'player');
    // A berserker has no bows, so it must walk into the arrows.
    const orc = makeEnemy(ctx, 'berserker', 'Walker', at(1, 'A-6'), 1);
    orc.dormant = false;
    s.expedition!.units.push(orc);
    // Wall off sight until it moves: put the squad on watch at A-1.
    const squad = unitNamed(s, '1st Squad');
    let st = ok(s, { type: 'overwatch', unitId: squad.id });
    const r = engine.apply(st, { type: 'endTurn' });
    st = r.state;
    const shots = r.events.filter((e) => e.type === 'attack' && e.attackerId === squad.id);
    expect(shots.length).toBe(1);
  });

  it('casts ESP and exposes a dummy contact', () => {
    let s = engine.newCampaign(9);
    s = ok(s, { type: 'beginMuster' });
    s = ok(s, { type: 'launch', plan: plan({ heroes: [{ heroId: 'aldous', entrance: A1 }] }) });
    const ctx = new Ctx(s, indexMap(map));
    const dummy = makeEnemy(ctx, 'dummy', 'Contact', at(1, 'A-4'), 1);
    dummy.dormant = false;
    s.expedition!.units.push(dummy);
    const aldous = unitNamed(s, 'Aldous');
    const r = engine.apply(s, { type: 'cast', unitId: aldous.id, spell: 'esp' });
    expect(r.error).toBeUndefined();
    expect(r.state.expedition!.units.some((u) => u.id === dummy.id)).toBe(false);
    expect(unitNamed(r.state, 'Aldous').spellPoints).toBe(9);
  });

  it('refuses a fireball without a straight clear line', () => {
    let s = engine.newCampaign(9);
    s = ok(s, { type: 'beginMuster' });
    s = ok(s, { type: 'launch', plan: plan({ heroes: [{ heroId: 'aldous', entrance: A1 }] }) });
    const aldous = unitNamed(s, 'Aldous');
    const r = engine.apply(s, { type: 'cast', unitId: aldous.id, spell: 'fireball', target: at(1, 'C-2') });
    expect(r.error).toMatch(/straight/);
  });
});
