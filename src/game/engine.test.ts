import { describe, it, expect } from 'vitest';
import { createEngine } from './engine';
import { at, testCastle } from './test/testCastle';
import { posKey, samePos, type Pos } from './hex';
import type { ActionKind, ActionTarget, Command, GameEvent, GameState, Monster, MonsterKind, SlotRoll } from './types';
import { MONSTERS } from './data';
import { brightnessOf, glimpseSet, noiseField, World } from './world';
import type { DelveX, GameStateX } from './state';
import { makeNoise } from './common';

const e = createEngine(testCastle);
const w = new World(testCastle);
const ALL = ['hobart', 'brann', 'pim', 'aldous'];

/** A delve on the test castle with no monsters or rivals; heroes placed by hand. */
function delve(opts: { heroes?: string[]; kind?: 'rescue' | 'recover'; seed?: number } = {}): GameState {
  let s = e.newGame(opts.seed ?? 1);
  const k = s.campaign.board.find((x) => !opts.kind || x.kind === opts.kind)!;
  const r = e.apply(s, { type: 'startDelve', contractId: k.id, heroIds: opts.heroes ?? ALL, entrance: 0, packs: {} });
  expect(r.error).toBeUndefined();
  s = r.state;
  s.delve!.monsters = [];
  s.delve!.rivals = null;
  s.delve!.traps = {};
  return s;
}

function put(s: GameState, id: string, p: Pos): void {
  s.delve!.heroes.find((h) => h.heroId === id)!.at = { ...p };
}

function hero(s: GameState, id: string) {
  return s.delve!.heroes.find((h) => h.heroId === id)!;
}

function monster(s: GameState, kind: MonsterKind, p: Pos, awareness: 'asleep' | 'alert' | 'hunting' = 'asleep', id = `m${s.delve!.monsters.length + 1}`) {
  const def = MONSTERS[kind];
  const m: Monster = { id, kind, name: def.name, at: { ...p }, hp: def.hp, maxHp: def.hp, awareness, spawnedAt: { ...p } };
  s.delve!.monsters.push(m);
  return m;
}

function ok(s: GameState, cmd: Command) {
  const r = e.apply(s, cmd);
  expect(r.error).toBeUndefined();
  return r;
}

function act(s: GameState, heroId: string, action: ActionKind, target: ActionTarget, focus = 0) {
  return ok(s, { type: 'act', heroId, action, target, focus });
}

function rolls(ev: GameEvent[]): SlotRoll[] {
  return ev.flatMap((x) => (x.type === 'roll' ? [x.roll] : []));
}

/** Try rng states until the command's events satisfy `want`. */
function until(s: GameState, cmd: Command, want: (ev: GameEvent[], st: GameState) => boolean) {
  for (let i = 1; i < 5000; i++) {
    const t = structuredClone(s);
    t.rng = i * 2654435761 >>> 0;
    const r = e.apply(t, cmd);
    if (!r.error && want(r.events, r.state)) return r;
  }
  throw new Error('no rng state gave the wanted outcome');
}

function ctx(s: GameState) {
  return { w, s: s as GameStateX, d: s.delve as DelveX, ev: [] as GameEvent[] };
}

// Landmarks in the test castle (offset col,row).
const GATE = at(1, 4, 7);
const PITHALL = at(1, 10, 7);

describe('camp', () => {
  it('new game: 100 gold, 4 heroes, 3 contracts, 2 recruits', () => {
    const s = e.newGame(7);
    expect(s.campaign.gold).toBe(100);
    expect(s.campaign.roster.map((h) => h.id)).toEqual(ALL);
    expect(s.campaign.board).toHaveLength(2); // the test castle has only 2 sites
    expect(s.campaign.recruits).toHaveLength(2);
    expect(s.campaign.board.every((k) => k.level === 1)).toBe(true);
  });

  it('buys, hires, refuses when poor', () => {
    let s = e.newGame(7);
    s = ok(s, { type: 'buy', kind: 'potion' }).state;
    expect(s.campaign.gold).toBe(80);
    expect(s.campaign.stash.map((i) => i.kind)).toEqual(['potion']);
    s.campaign.gold = 5;
    const r = e.apply(s, { type: 'buy', kind: 'charge' });
    expect(r.error).toBeTruthy();
    expect(r.state).toBe(s);
  });

  it('refuses wounded heroes', () => {
    const s = e.newGame(7);
    s.campaign.roster[1]!.wounded = 2;
    const r = e.apply(s, { type: 'startDelve', contractId: s.campaign.board[0]!.id, heroIds: ['brann'], entrance: 0, packs: {} });
    expect(r.error).toMatch(/wounded/);
  });
});

describe('slot rolls and Focus', () => {
  it('Focus locks slots as hits and is spent', () => {
    const s = delve();
    put(s, 'brann', GATE);
    const m = monster(s, 'orc', at(1, 5, 7), 'hunting');
    m.hp = 99;
    const r = act(s, 'brann', 'attack', { id: m.id }, 3);
    const [roll] = rolls(r.events);
    expect(roll!.focus).toBe(3);
    expect(roll!.results).toEqual([true, true, true]);
    expect(roll!.perfect).toBe(true);
    expect(hero(r.state, 'brann').focus).toBe(0);
    // 3 hits × 2 dmg + 1 perfect
    expect(r.state.delve!.monsters[0]!.hp).toBe(99 - 7);
  });

  it('refuses more Focus than the hero has', () => {
    const s = delve();
    put(s, 'brann', GATE);
    const m = monster(s, 'orc', at(1, 5, 7), 'hunting');
    hero(s, 'brann').focus = 1;
    const r = e.apply(s, { type: 'act', heroId: 'brann', action: 'attack', target: { id: m.id }, focus: 2 });
    expect(r.error).toBeTruthy();
  });

  it('preview shows chance, modifiers and outcomes', () => {
    const s = delve();
    put(s, 'brann', GATE);
    const m = monster(s, 'orc', at(1, 5, 7), 'asleep');
    const p = e.preview(s, 'brann', 'attack', { id: m.id });
    expect(p.ok).toBe(true);
    expect(p.slots).toBe(3);
    expect(p.chance).toBe(90); // 70 + 20 asleep
    expect(p.modifiers).toContain('Asleep +20%');
    expect(p.outcomes).toEqual(['Miss', '2 dmg', '4 dmg', '7 dmg']);
    expect(p.maxFocus).toBe(3);
  });

  it('chance is clamped to 5..95', () => {
    const s = delve();
    put(s, 'brann', GATE);
    const m = monster(s, 'orc', at(1, 5, 7), 'asleep');
    s.campaign.roster.find((h) => h.id === 'brann')!.weaponTier = 2;
    expect(e.preview(s, 'brann', 'attack', { id: m.id }).chance).toBe(95);
  });

  it('flanking adds a slot', () => {
    const s = delve();
    put(s, 'brann', at(1, 3, 7));
    put(s, 'hobart', at(1, 5, 7));
    const m = monster(s, 'orc', at(1, 4, 7), 'hunting');
    const p = e.preview(s, 'brann', 'attack', { id: m.id });
    expect(p.slots).toBe(4);
    expect(p.modifiers).toContain('Flanked +1 slot');
  });
});

describe('movement', () => {
  it('walks 4, sneaks 2, burglar sneaks 4', () => {
    const s = delve();
    put(s, 'brann', GATE);
    put(s, 'pim', at(1, 4, 6));
    const walk = e.reachable(s, 'brann', false);
    const sneak = e.reachable(s, 'brann', true);
    expect(Math.max(...walk.map((r) => r.cost))).toBe(4);
    expect(Math.max(...sneak.map((r) => r.cost))).toBe(2);
    expect(Math.max(...e.reachable(s, 'pim', true).map((r) => r.cost))).toBe(4);
    expect(e.moveNoise(s, 'brann', true)).toBe(0);
    expect(e.moveNoise(s, 'brann', false)).toBe(1);
  });

  it('rubble costs 2', () => {
    const s = delve();
    const rub = at(2, 14, 3);
    expect(w.tile(rub)?.kind).toBe('rubble');
    put(s, 'brann', at(2, 13, 3));
    const r = e.reachable(s, 'brann', false).find((x) => samePos(x.to, rub))!;
    expect(r.cost).toBe(2);
  });

  it('monsters block, heroes can be passed but not ended on', () => {
    const s = delve();
    // A corridor: put brann in the gate room next to the door.
    put(s, 'brann', at(1, 6, 7));
    put(s, 'hobart', at(1, 8, 7));
    const reach = e.reachable(s, 'brann', false);
    expect(reach.some((r) => samePos(r.to, at(1, 9, 7)))).toBe(true); // through hobart
    expect(reach.some((r) => samePos(r.to, at(1, 8, 7)))).toBe(false);
    monster(s, 'orc', at(1, 7, 7), 'asleep'); // in the doorway
    expect(e.reachable(s, 'brann', false).some((r) => samePos(r.to, at(1, 9, 7)))).toBe(false);
  });

  it('opens unlocked doors on the way, not locked ones', () => {
    const s = delve();
    put(s, 'brann', at(1, 6, 7));
    const to = e.reachable(s, 'brann', false).find((r) => samePos(r.to, at(1, 8, 7)))!;
    const r = ok(s, { type: 'move', heroId: 'brann', path: to.path, sneak: false });
    expect(r.state.delve!.doors[posKey(at(1, 7, 7))]!.open).toBe(true);
    expect(r.events.some((x) => x.type === 'doorChanged')).toBe(true);
    put(s, 'pim', at(1, 12, 3));
    expect(e.reachable(s, 'pim', false).some((x) => x.to.q === at(1, 14, 3).q && x.to.r === at(1, 14, 3).r)).toBe(false);
  });

  it('moves once per turn and refuses bad paths', () => {
    const s = delve();
    put(s, 'brann', GATE);
    const r1 = e.apply(s, { type: 'move', heroId: 'brann', path: [at(1, 9, 7)], sneak: false });
    expect(r1.error).toBeTruthy();
    const step = ok(s, { type: 'move', heroId: 'brann', path: [at(1, 5, 7)], sneak: false }).state;
    expect(e.apply(step, { type: 'move', heroId: 'brann', path: [at(1, 6, 7)], sneak: false }).error).toBeTruthy();
    expect(e.reachable(step, 'brann', false)).toEqual([]);
  });

  it('stairs cost 1 and change level', () => {
    const s = delve();
    put(s, 'brann', at(1, 2, 7));
    const down = e.reachable(s, 'brann', false).find((r) => r.to.level === 2 && samePos(r.to, at(2, 2, 4)))!;
    expect(down.cost).toBe(1);
    const r = ok(s, { type: 'move', heroId: 'brann', path: down.path, sneak: false });
    expect(hero(r.state, 'brann').at.level).toBe(2);
    expect(r.events.some((x) => x.type === 'levelChanged')).toBe(true);
  });

  it('webbed heroes cannot move', () => {
    const s = delve();
    hero(s, 'brann').webbed = true;
    expect(e.reachable(s, 'brann', false)).toEqual([]);
  });
});

describe('exploring by line of sight', () => {
  it('every step of a walk reveals what that hex can see, lit or not', () => {
    let s = delve({ heroes: ['hobart', 'pim'] });
    s.delve!.light = 1; // dark: the lantern lights almost nothing
    const reach = e.reachable(s, 'pim', false).sort((a, b) => b.path.length - a.path.length)[0]!;
    expect(reach.path.length).toBeGreaterThan(2);
    s = e.apply(s, { type: 'move', heroId: 'pim', path: reach.path, sneak: false }).state;
    const ex = e.visibility(s).explored;
    for (const step of reach.path) {
      for (const p of glimpseSet(w, s.delve as DelveX, step)) expect(ex.has(posKey(p))).toBe(true);
    }
  });

  it('walls stop the glimpse', () => {
    const s = delve();
    for (const p of glimpseSet(w, s.delve as DelveX, hero(s, 'hobart').at)) {
      expect(p.level).toBe(hero(s, 'hobart').at.level);
    }
    const all = glimpseSet(w, s.delve as DelveX, hero(s, 'hobart').at).length;
    const tiles = Object.keys(testCastle.levels[0]!.tiles).length;
    expect(all).toBeLessThan(tiles);
  });
});

describe('light', () => {
  it('stages by oil', () => {
    expect(brightnessOf(40)).toBe('bright');
    expect(brightnessOf(27)).toBe('bright');
    expect(brightnessOf(26)).toBe('dim');
    expect(brightnessOf(13)).toBe('dim');
    expect(brightnessOf(12)).toBe('dark');
    expect(brightnessOf(1)).toBe('dark');
    expect(brightnessOf(0)).toBe('pitch');
  });

  it('burns 1 per round and lights radius by stage', () => {
    let s = delve();
    put(s, 'hobart', PITHALL);
    s = ok(s, { type: 'endTurn' }).state;
    expect(s.delve!.light).toBe(39);
    const lit = e.visibility(s).lit;
    expect(lit.has(posKey(at(1, 10, 3)))).toBe(true); // 4 rows up
    s.delve!.light = 15; // dim: radius 3
    expect(e.visibility(s).lit.has(posKey(at(1, 10, 3)))).toBe(false);
    expect(e.inLight(s, PITHALL)).toBe(true);
  });

  it('heroes outside the light fight at dark', () => {
    const s = delve();
    put(s, 'hobart', PITHALL);
    put(s, 'brann', at(1, 2, 2));
    const m = monster(s, 'orc', at(1, 3, 2), 'hunting');
    const p = e.preview(s, 'brann', 'attack', { id: m.id });
    expect(p.modifiers).toContain('Dark −20%');
    expect(p.chance).toBe(50);
  });

  it('kindle adds 12, braziers add 6 and stay lit', () => {
    let s = delve();
    s.delve!.light = 20;
    s = act(s, 'aldous', 'kindle', {}).state;
    expect(s.delve!.light).toBe(32);
    expect(hero(s, 'aldous').mana).toBe(2);
    put(s, 'brann', at(1, 16, 3));
    const b = at(1, 16, 2);
    s = act(s, 'brann', 'light', { at: b }).state;
    expect(s.delve!.light).toBe(38);
    expect(s.delve!.lit).toContain(posKey(b));
  });

  it('the Gloam comes at 0 and fades when light returns', () => {
    let s = delve();
    put(s, 'hobart', PITHALL);
    s.delve!.light = 1;
    const r = ok(s, { type: 'endTurn' });
    s = r.state;
    expect(s.delve!.light).toBe(0);
    const g = s.delve!.monsters.find((m) => m.kind === 'gloam')!;
    expect(g).toBeTruthy();
    expect(r.events.some((x) => x.type === 'gloam')).toBe(true);
    s = act(s, 'aldous', 'kindle', {}).state;
    expect(s.delve!.monsters.some((m) => m.kind === 'gloam')).toBe(false);
  });
});

describe('noise', () => {
  it('closed doors count double', () => {
    const s = delve();
    const src = at(1, 9, 2); // pit hall, two steps from the pantry door at (7,2)
    const behind = at(1, 6, 2);
    expect(noiseField(w, s.delve as DelveX, src, 3).has(posKey(behind))).toBe(false); // 9→8 1, door 3, 6 = 4
    s.delve!.doors[posKey(at(1, 7, 2))]!.open = true;
    expect(noiseField(w, s.delve as DelveX, src, 3).has(posKey(behind))).toBe(true);
  });

  it('wakes sleepers in range, not beyond', () => {
    const s = delve();
    const near = monster(s, 'orc', at(1, 6, 2), 'asleep');
    const far = monster(s, 'rats', at(1, 1, 1), 'asleep');
    const c = ctx(s);
    makeNoise(c, at(1, 9, 2), 4);
    expect(near.awareness).toBe('alert');
    expect(near.focusAt).toEqual(at(1, 9, 2));
    expect(far.awareness).toBe('asleep');
  });

  it('smashing a door wakes the room behind it', () => {
    const s = delve();
    put(s, 'brann', at(1, 12, 3));
    const orc = monster(s, 'orc', at(1, 15, 3), 'asleep');
    const r = act(s, 'brann', 'smash', { at: at(1, 13, 3) });
    expect(r.events.some((x) => x.type === 'noise' && x.radius === 4)).toBe(true);
    expect(r.state.delve!.monsters.find((m) => m.id === orc.id)!.awareness).not.toBe('asleep');
  });
});

describe('locks', () => {
  const door = at(1, 13, 3);
  function setup() {
    const s = delve();
    put(s, 'pim', at(1, 12, 3));
    return s;
  }
  it('pick, 3 hits: opens silently', () => {
    const r = act(setup(), 'pim', 'pick', { at: door }, 3);
    expect(r.state.delve!.doors[posKey(door)]).toMatchObject({ open: true, locked: false });
    expect(r.events.some((x) => x.type === 'noise')).toBe(false);
  });
  it('pick, 2 hits: opens with noise 2', () => {
    const r = until(setup(), { type: 'act', heroId: 'pim', action: 'pick', target: { at: door }, focus: 0 }, (ev) => rolls(ev)[0]!.hits === 2);
    expect(r.state.delve!.doors[posKey(door)]!.open).toBe(true);
    expect(r.events.some((x) => x.type === 'noise' && x.radius === 2)).toBe(true);
  });
  it('pick, 1 hit: fails; 0 hits: jams', () => {
    const s = setup();
    const cmd: Command = { type: 'act', heroId: 'pim', action: 'pick', target: { at: door }, focus: 0 };
    const one = until(s, cmd, (ev) => rolls(ev)[0]!.hits === 1);
    expect(one.state.delve!.doors[posKey(door)]).toMatchObject({ open: false, locked: true, jammed: false });
    const zero = until(s, cmd, (ev) => rolls(ev)[0]!.hits === 0);
    expect(zero.state.delve!.doors[posKey(door)]!.jammed).toBe(true);
    const fresh = structuredClone(zero.state);
    hero(fresh, 'pim').acted = false;
    expect(e.actions(fresh, 'pim').some((a) => a.action === 'pick')).toBe(false);
    expect(e.actions(fresh, 'pim').some((a) => a.action === 'smash')).toBe(true);
  });
  it('only the burglar picks', () => {
    const s = setup();
    put(s, 'brann', at(1, 12, 4));
    expect(e.actions(s, 'brann').some((a) => a.action === 'pick')).toBe(false);
  });
  it('smash: 2 hits opens a door, 1 does not', () => {
    const s = setup();
    put(s, 'pim', at(1, 0, 0));
    put(s, 'brann', at(1, 12, 3));
    const cmd: Command = { type: 'act', heroId: 'brann', action: 'smash', target: { at: door }, focus: 0 };
    expect(until(s, cmd, (ev) => rolls(ev)[0]!.hits === 1).state.delve!.doors[posKey(door)]!.open).toBe(false);
    expect(until(s, cmd, (ev) => rolls(ev)[0]!.hits === 2).state.delve!.doors[posKey(door)]!.open).toBe(true);
  });
  it('chests: open drops loot on the ground, take picks it up', () => {
    let s = delve();
    put(s, 'brann', at(1, 3, 1));
    const r = act(s, 'brann', 'open', { id: 'c1', at: at(1, 2, 1) });
    const opened = r.events.find((x) => x.type === 'chestOpened');
    expect(opened).toBeTruthy();
    s = r.state;
    expect(s.delve!.ground.some((g) => samePos(g.at, at(1, 2, 1)))).toBe(true);
    s = act(s, 'brann', 'take', { at: at(1, 2, 1) }).state;
    expect(hero(s, 'brann').pack.length).toBeGreaterThan(0);
  });
});

describe('combat', () => {
  it('monster damage is reduced by armor, min 1 per hit', () => {
    const s = delve();
    put(s, 'brann', GATE); // armor 1
    const orc = monster(s, 'orc', at(1, 5, 7), 'hunting');
    orc.intent = { kind: 'attack', targetId: 'brann' };
    const r = until(s, { type: 'endTurn' }, (ev) => rolls(ev).some((x) => x.hits === 1));
    expect(hero(r.state, 'brann').hp).toBe(10 - 1); // 2 dmg − 1 armor
    const r2 = until(s, { type: 'endTurn' }, (ev) => rolls(ev).some((x) => x.hits === 2));
    expect(hero(r2.state, 'brann').hp).toBe(10 - 3); // 2×1 + 1 perfect
  });

  it('downed heroes bleed out in 2 world phases', () => {
    let s = delve();
    put(s, 'brann', GATE);
    hero(s, 'brann').hp = 1;
    const orc = monster(s, 'orc', at(1, 5, 7), 'hunting');
    orc.intent = { kind: 'attack', targetId: 'brann' };
    const r = until(s, { type: 'endTurn' }, (ev) => ev.some((x) => x.type === 'downed'));
    s = r.state;
    expect(hero(s, 'brann')).toMatchObject({ status: 'downed', bleed: 2, hp: 0 });
    s.delve!.monsters = [];
    s = ok(s, { type: 'endTurn' }).state;
    expect(hero(s, 'brann').bleed).toBe(1);
    s = ok(s, { type: 'endTurn' }).state;
    expect(hero(s, 'brann').status).toBe('dead');
  });

  it('revive brings a downed hero back at 3 HP, wounded after', () => {
    let s = delve();
    put(s, 'brann', GATE);
    put(s, 'hobart', at(1, 5, 7));
    Object.assign(hero(s, 'brann'), { status: 'downed', hp: 0, bleed: 2 });
    s = act(s, 'hobart', 'revive', { id: 'brann' }).state;
    expect(hero(s, 'brann')).toMatchObject({ status: 'active', hp: 3, revived: true });
  });

  it('monsters ignore downed heroes', () => {
    const s = delve(['brann', 'hobart'].length ? {} : {});
    put(s, 'brann', GATE);
    Object.assign(hero(s, 'brann'), { status: 'downed', hp: 0, bleed: 2 });
    for (const id of ['hobart', 'pim', 'aldous']) put(s, id, at(2, 16, 7 + (id === 'pim' ? 1 : 0)));
    put(s, 'aldous', at(2, 14, 8));
    const orc = monster(s, 'orc', at(1, 5, 7), 'hunting');
    const r = ok(s, { type: 'endTurn' });
    expect(rolls(r.events).length).toBe(0);
    expect(r.state.delve!.monsters.find((m) => m.id === orc.id)!.intent?.targetId).not.toBe('brann');
  });

  it('killing a monster gives XP and a kill', () => {
    const s = delve();
    put(s, 'brann', GATE);
    const m = monster(s, 'rats', at(1, 5, 7), 'hunting');
    const r = act(s, 'brann', 'attack', { id: m.id }, 3);
    expect(r.state.delve!.monsters).toHaveLength(0);
    expect(r.state.delve!.kills.brann).toBe(1);
    expect(r.events.some((x) => x.type === 'monsterDied')).toBe(true);
  });

  it('guard redirects the hit to the sellsword', () => {
    let s = delve();
    put(s, 'pim', GATE);
    put(s, 'brann', at(1, 3, 7));
    const orc = monster(s, 'orc', at(1, 5, 7), 'hunting');
    orc.intent = { kind: 'attack', targetId: 'pim' };
    s = act(s, 'brann', 'guard', { id: 'pim' }).state;
    const r = until(s, { type: 'endTurn' }, (ev) => rolls(ev).some((x) => x.hits > 0));
    expect(hero(r.state, 'pim').hp).toBe(7);
    expect(hero(r.state, 'brann').hp).toBeLessThan(10);
  });

});

describe('monsters', () => {
  it('intents are computed at delve start for awake monsters and honored', () => {
    const s = delve();
    put(s, 'brann', GATE);
    for (const id of ['hobart', 'pim', 'aldous']) put(s, id, at(2, 2 + ALL.indexOf(id), 1));
    s.delve!.lanternBearer = 'brann';
    const orc = monster(s, 'orc', at(1, 2, 6), 'hunting');
    // Any successful command gives an awake monster without one an intent.
    let st = ok(s, { type: 'move', heroId: 'pim', path: e.reachable(s, 'pim', true)[0]!.path, sneak: true }).state;
    const intent = e.intents(st)[orc.id]!;
    expect(intent.kind).toBe('attack');
    expect(intent.targetId).toBe('brann');
    const r = ok(st, { type: 'endTurn' });
    expect(r.events.some((x) => x.type === 'roll' && x.who === orc.id)).toBe(true);
    st = r.state;
  });

  it('a hero ending a move next to a sleeper wakes it', () => {
    const s = delve();
    put(s, 'brann', at(1, 3, 7));
    const m = monster(s, 'orc', at(1, 6, 7), 'asleep');
    const r = ok(s, { type: 'move', heroId: 'brann', path: [at(1, 4, 7), at(1, 5, 7)], sneak: true });
    expect(r.state.delve!.monsters.find((x) => x.id === m.id)!.awareness).not.toBe('asleep');
  });

  it('orcs shout when they first see a hero', () => {
    const s = delve();
    put(s, 'brann', GATE);
    put(s, 'hobart', at(1, 3, 7));
    monster(s, 'orc', at(1, 1, 8), 'alert');
    const r = ok(s, { type: 'endTurn' });
    expect(r.events.some((x) => x.type === 'noise' && x.radius === 5)).toBe(true);
  });

  it('spiders web from range', () => {
    const s = delve();
    put(s, 'hobart', GATE);
    put(s, 'brann', at(1, 4, 8));
    put(s, 'pim', at(2, 2, 1));
    put(s, 'aldous', at(2, 3, 1));
    const sp = monster(s, 'spider', at(1, 1, 7), 'hunting');
    const st = ok(s, { type: 'move', heroId: 'pim', path: [at(2, 2, 2)], sneak: false }).state;
    expect(e.intents(st)[sp.id]?.kind).toBe('web');
    const r = ok(st, { type: 'endTurn' });
    expect(r.state.delve!.heroes.some((h) => h.webbed)).toBe(true);
    // Still webbed during the next player phase, and can't web again right away.
    const webbed = r.state.delve!.heroes.find((h) => h.webbed)!;
    expect(e.reachable(r.state, webbed.heroId, false)).toEqual([]);
    expect(e.intents(r.state)[sp.id]?.kind).not.toBe('web');
  });

  it('cutpurse steals an item and flees; drops it when killed', () => {
    let s = delve();
    put(s, 'brann', GATE);
    hero(s, 'brann').pack.push({ id: 'ix', kind: 'potion', name: 'Potion', amount: 1, slots: 1 });
    const cp = monster(s, 'cutpurse', at(1, 5, 7), 'hunting');
    cp.intent = { kind: 'steal', targetId: 'brann' };
    const r = until(s, { type: 'endTurn' }, (ev) => ev.some((x) => x.type === 'stolen'));
    s = r.state;
    expect(hero(s, 'brann').pack).toHaveLength(0);
    const thief = s.delve!.monsters.find((m) => m.kind === 'cutpurse')!;
    expect(thief.stolen?.id).toBe('ix');
    expect(thief.intent?.kind).toBe('flee');
    // Kill it where it stands.
    put(s, 'hobart', s.delve!.heroes[0]!.at);
    const adj = [...e.reachable(s, 'hobart', false)].find((x) => x.to.level === thief.at.level && Math.abs(x.to.q - thief.at.q) + Math.abs(x.to.r - thief.at.r) + Math.abs(x.to.q + x.to.r - thief.at.q - thief.at.r) === 2);
    if (adj) {
      s = ok(s, { type: 'move', heroId: 'hobart', path: adj.path, sneak: false }).state;
      s = act(s, 'hobart', 'attack', { id: thief.id }, 3).state;
      expect(s.delve!.ground.some((g) => g.items.some((i) => i.id === 'ix'))).toBe(true);
    }
  });
});

describe('contracts and summary', () => {
  it('recover: carrying the heirloom out completes it and pays', () => {
    let s = delve({ kind: 'recover', heroes: ['hobart', 'brann'] });
    const site = testCastle.contractSites.find((x) => x.kind === 'recover')!.at;
    put(s, 'brann', site);
    s = act(s, 'brann', 'take', { at: site }).state;
    expect(hero(s, 'brann').pack.some((i) => i.kind === 'heirloom')).toBe(true);
    put(s, 'brann', at(1, 2, 9));
    put(s, 'hobart', at(1, 18, 7));
    s = act(s, 'brann', 'leave', {}).state;
    expect(s.stage).toBe('delve');
    const r = act(s, 'hobart', 'leave', {});
    s = r.state;
    expect(s.stage).toBe('summary');
    expect(s.summary).toMatchObject({ contractDone: true, bounty: 100, lootValue: 60 });
    expect(r.events.some((x) => x.type === 'delveOver')).toBe(true);
    const gold = s.campaign.gold;
    const brannXp = s.campaign.roster.find((h) => h.id === 'brann')!.xp;
    s = ok(s, { type: 'backToCamp' }).state;
    expect(s.stage).toBe('camp');
    expect(s.campaign.gold).toBe(gold + 100);
    expect(s.campaign.stash.some((i) => i.kind === 'heirloom')).toBe(true);
    expect(s.campaign.reputation).toBe(1);
    expect(s.campaign.roster.find((h) => h.id === 'brann')!.xp).toBe(brannXp + 4);
    expect(s.campaign.delveCount).toBe(1);
  });

  it('rescue: free, escort, leave with the prisoner adjacent', () => {
    let s = delve({ kind: 'rescue', heroes: ['brann'] });
    const pr = s.delve!.prisoner!;
    expect(pr.at).toEqual(at(1, 16, 8));
    put(s, 'brann', at(1, 15, 8));
    s = act(s, 'brann', 'free', { id: pr.id }).state;
    expect(s.delve!.prisoner).toMatchObject({ freed: true, escortedBy: 'brann' });
    expect(Math.max(...e.reachable(s, 'brann', false).map((r) => r.cost))).toBe(3);
    // Teleport both to the exit for the test.
    put(s, 'brann', at(1, 18, 7));
    s.delve!.prisoner!.at = at(1, 17, 7);
    s = act(s, 'brann', 'leave', {}).state;
    expect(s.summary!.contractDone).toBe(true);
    expect(s.summary!.bounty).toBe(80);
    const n = s.campaign.roster.length;
    s = ok(s, { type: 'backToCamp' }).state;
    expect(s.campaign.roster.length).toBe(n + 1);
  });

  it('abandon: heroes off the exits die; Hobart dying ends the campaign', () => {
    let s = delve({ heroes: ['hobart', 'brann'] });
    put(s, 'brann', at(1, 18, 7));
    put(s, 'hobart', GATE);
    s = ok(s, { type: 'abandon' }).state;
    expect(s.summary!.dead).toEqual(['hobart']);
    expect(s.summary!.survivors).toEqual(['brann']);
    s = ok(s, { type: 'backToCamp' }).state;
    expect(s.stage).toBe('over');
    expect(s.overReason).toBe('The heir has fallen.');
  });

  it('fallen heroes leave gear behind for later delves', () => {
    let s = delve({ heroes: ['hobart', 'brann'] });
    hero(s, 'brann').pack.push({ id: 'iz', kind: 'rope', name: 'Rope', amount: 1, slots: 1 });
    put(s, 'brann', PITHALL);
    put(s, 'hobart', at(1, 18, 7));
    s = ok(s, { type: 'abandon' }).state;
    s = ok(s, { type: 'backToCamp' }).state;
    expect(s.campaign.fallen.map((f) => f.name)).toEqual(['Brann']);
    expect(s.campaign.lostGear[0]!.items[0]!.id).toBe('iz');
    expect(s.campaign.lostGear[0]!.at).toEqual(PITHALL);
  });
});

describe('determinism and saves', () => {
  function play(seed: number): GameState {
    let s = e.newGame(seed);
    s = e.apply(s, { type: 'startDelve', contractId: s.campaign.board[0]!.id, heroIds: ALL, entrance: 0, packs: {} }).state;
    for (let i = 0; i < 8 && s.stage === 'delve'; i++) {
      for (const id of ALL) {
        const reach = e.reachable(s, id, false);
        if (reach.length) s = e.apply(s, { type: 'move', heroId: id, path: reach[(i * 7) % reach.length]!.path, sneak: false }).state;
        const a = e.actions(s, id).find((o) => o.rolls);
        if (a) s = e.apply(s, { type: 'act', heroId: id, action: a.action, target: a.targets[0]!, focus: 0 }).state;
      }
      s = e.apply(s, { type: 'endTurn' }).state;
    }
    return s;
  }
  it('same seed and commands give the same state', () => {
    expect(JSON.stringify(play(42))).toBe(JSON.stringify(play(42)));
    expect(JSON.stringify(play(42))).not.toBe(JSON.stringify(play(43)));
  });
  it('apply does not mutate its input', () => {
    const s = delve();
    const before = JSON.stringify(s);
    e.apply(s, { type: 'endTurn' });
    expect(JSON.stringify(s)).toBe(before);
  });
  it('serialize round-trips', () => {
    const s = play(9);
    const back = e.deserialize(e.serialize(s))!;
    expect(back).toEqual(s);
    expect(e.deserialize('nope')).toBeNull();
    expect(e.deserialize('{"version":2}')).toBeNull();
  });
});

// ---------------------------------------------------------------- V3.1 (spec section 14)

import { computeIntents } from './world-phase';
import { lairCheck } from './dragon';
import { posNeighbors as posNeighborsOf } from './hex';

/** Hexes a, b, c in a straight line: b = a + dir, c = a + 2 dir. */
function inLine(b: Pos, c: Pos): Pos {
  return { level: b.level, q: 2 * b.q - c.q, r: 2 * b.r - c.r };
}

function dragonDelve(): { s: GameState; dragon: Monster } {
  const s = delve();
  const sp = testCastle.spawns.find((x) => x.kind === 'dragon')!;
  const def = MONSTERS.dragon;
  const dragon: Monster = { id: 'm9', kind: 'dragon', name: 'The Wyrm', at: { ...sp.at }, hp: def.hp, maxHp: def.hp, awareness: 'asleep', spawnedAt: { ...sp.at } };
  s.delve!.monsters.push(dragon);
  for (const id of ALL) put(s, id, at(3, 2 + ALL.indexOf(id), 2));
  return { s, dragon };
}

describe('falls (14.2)', () => {
  it('L1 over a bridge lands on L2 for 4; elsewhere falls to L3 for 7', () => {
    const s = delve();
    const a = e.fallInfo(s, at(1, 10, 3))!;
    expect(a.to).toEqual(at(2, 10, 3));
    expect([a.levels, a.damage]).toEqual([1, 4]);
    const b = e.fallInfo(s, at(1, 10, 4))!;
    expect(b.to).toEqual(at(3, 10, 4));
    expect([b.levels, b.damage]).toEqual([2, 7]);
    expect(b.levelName).toBe('the Test Hollow');
    const c = e.fallInfo(s, at(2, 10, 5))!;
    expect([c.to.level, c.damage]).toEqual([3, 4]);
    expect(e.fallInfo(s, at(1, 4, 7))).toBeNull();
  });

  it('lands on the nearest free hex when the spot is taken', () => {
    const s = delve();
    put(s, 'brann', at(2, 10, 3));
    const f = e.fallInfo(s, at(1, 10, 3))!;
    expect(f.to.level).toBe(2);
    expect(samePos(f.to, at(2, 10, 3))).toBe(false);
  });

  it('jump offers each adjacent pit hex; previews warn and confirm on 2-level drops', () => {
    const s = delve();
    put(s, 'pim', at(1, 11, 3));
    const j = e.actions(s, 'pim').find((o) => o.action === 'jump')!;
    expect(j.targets.map((t) => posKey(t.at!)).sort()).toEqual([posKey(at(1, 10, 3)), posKey(at(1, 11, 4))].sort());
    const one = e.preview(s, 'pim', 'jump', { at: at(1, 10, 3) });
    expect(one.warning).toMatch(/1 level.*4 damage/);
    expect(one.confirm).toBeFalsy();
    const two = e.preview(s, 'pim', 'jump', { at: at(1, 11, 4) });
    expect(two.warning).toBe('Falls 2 levels into the Test Hollow: 7 damage. This will down Pim.');
    expect(two.confirm).toBe(true);
  });

  it('jumping lands per the column with damage and a fell event', () => {
    const s = delve();
    put(s, 'brann', at(1, 11, 3));
    const r = act(s, 'brann', 'jump', { at: at(1, 11, 4) });
    const b = hero(r.state, 'brann');
    expect(b.at).toEqual(at(3, 11, 4));
    expect(b.hp).toBe(3);
    const fell = r.events.find((x) => x.type === 'fell');
    expect(fell).toMatchObject({ type: 'fell', id: 'brann', levels: 2, damage: 7 });
    expect(b.moved && b.acted).toBe(true);
  });

  it('rope and climb: down to where a fall would land, no damage, and back up', () => {
    let s = delve();
    put(s, 'brann', at(1, 11, 3));
    hero(s, 'brann').pack.push({ id: 'rp', kind: 'rope', name: 'Rope', amount: 1, slots: 1 });
    s = act(s, 'brann', 'rope', { itemId: 'rp' }).state;
    expect(s.delve!.ropes).toEqual([posKey(at(1, 11, 3))]);
    s = ok(s, { type: 'endTurn' }).state;
    const cl = e.actions(s, 'brann').find((o) => o.action === 'climb')!;
    expect(cl.targets.some((t) => samePos(t.at!, at(2, 10, 3)))).toBe(true);
    s = act(s, 'brann', 'climb', { at: at(3, 11, 4) }).state;
    expect(hero(s, 'brann').at).toEqual(at(3, 11, 4));
    expect(hero(s, 'brann').hp).toBe(10);
    s = ok(s, { type: 'endTurn' }).state;
    s = act(s, 'brann', 'climb', { at: at(1, 11, 3) }).state;
    expect(hero(s, 'brann').at).toEqual(at(1, 11, 3));
  });

  it('edgeRisk: worst unrailed fall; null on a railing or away from pits', () => {
    const s = delve();
    put(s, 'pim', at(1, 11, 3));
    expect(e.edgeRisk(s, 'pim')!.levels).toBe(2);
    put(s, 'pim', at(1, 9, 3));
    expect(e.edgeRisk(s, 'pim')).toBeNull();
    put(s, 'pim', GATE);
    expect(e.edgeRisk(s, 'pim')).toBeNull();
  });
});

describe('shoves (14.3)', () => {
  function shoveSetup(dest: Pos, mAt: Pos, kind: MonsterKind = 'orc') {
    const s = delve();
    put(s, 'brann', inLine(mAt, dest));
    const m = monster(s, kind, mAt, 'hunting');
    m.hp = m.maxHp = 20;
    return { s, m };
  }

  it('into a pit: it falls with fall damage; a fall kill counts', () => {
    const { s, m } = shoveSetup(at(1, 10, 3), at(1, 11, 3));
    const p = e.preview(s, 'brann', 'shove', { id: m.id });
    expect(p.outcomes[1]).toBe('Nothing');
    expect(p.outcomes[2]).toMatch(/Over the edge: falls 1 level/);
    const r = until(s, { type: 'act', heroId: 'brann', action: 'shove', target: { id: m.id }, focus: 0 }, (ev) => rolls(ev)[0]!.hits === 2 && !rolls(ev)[0]!.perfect || rolls(ev)[0]!.perfect);
    const mm = r.state.delve!.monsters.find((x) => x.id === m.id)!;
    expect(mm.at).toEqual(at(2, 10, 3));
    expect(mm.hp).toBe(20 - 4 - 1); // perfect (2 of 2) adds 1
    expect(r.events.map((x) => x.type)).toEqual(expect.arrayContaining(['shoved', 'fell']));
    // A kill by falling.
    const k = shoveSetup(at(1, 10, 3), at(1, 11, 3), 'rats');
    k.m.hp = 3;
    const r2 = act(k.s, 'brann', 'shove', { id: k.m.id }, 2);
    expect(r2.state.delve!.monsters).toHaveLength(0);
    expect(r2.state.delve!.kills.brann).toBe(1);
  });

  it('1 hit does nothing', () => {
    const { s, m } = shoveSetup(at(1, 10, 3), at(1, 11, 3));
    const r = until(s, { type: 'act', heroId: 'brann', action: 'shove', target: { id: m.id }, focus: 0 }, (ev) => rolls(ev)[0]!.hits === 1);
    expect(r.state.delve!.monsters[0]!.at).toEqual(at(1, 11, 3));
    expect(r.state.delve!.monsters[0]!.hp).toBe(20);
  });

  it('a railing blocks a shove off the edge: 1 damage instead', () => {
    const { s, m } = shoveSetup(at(1, 10, 3), at(1, 9, 3));
    expect(e.preview(s, 'brann', 'shove', { id: m.id }).outcomes[2]).toMatch(/railing/);
    const r = act(s, 'brann', 'shove', { id: m.id }, 2);
    const mm = r.state.delve!.monsters[0]!;
    expect(mm.at).toEqual(at(1, 9, 3));
    expect(mm.hp).toBe(20 - 1 - 1);
  });

  it('into a wall: 1; into a figure: both take 1; onto a vent: 3', () => {
    // Wall: gate room west wall at (0,7).
    const w1 = shoveSetup(at(1, 0, 7), at(1, 1, 7));
    const r1 = act(w1.s, 'brann', 'shove', { id: w1.m.id }, 2);
    expect(r1.state.delve!.monsters[0]!.hp).toBe(20 - 2);
    // Figure.
    const f = shoveSetup(at(1, 3, 7), at(1, 4, 7));
    const other = monster(f.s, 'orc', at(1, 3, 7), 'hunting', 'm7');
    other.hp = 20;
    const r2 = act(f.s, 'brann', 'shove', { id: f.m.id }, 2);
    expect(r2.state.delve!.monsters.find((x) => x.id === f.m.id)!.hp).toBe(20 - 1 - 1);
    expect(r2.state.delve!.monsters.find((x) => x.id === 'm7')!.hp).toBe(19);
    // Vent at L3 (15,2).
    const vent = at(3, 15, 2);
    const v = shoveSetup(vent, at(3, 15, 3));
    const r3 = act(v.s, 'brann', 'shove', { id: v.m.id }, 2);
    const mv = r3.state.delve!.monsters.find((x) => x.id === v.m.id)!;
    expect(mv.at).toEqual(vent);
    expect(mv.hp).toBe(20 - 3 - 1);
  });

  it('into the forge: 3', () => {
    const forge = at(2, 17, 2);
    const { s, m } = shoveSetup(forge, at(2, 16, 2));
    expect(e.preview(s, 'brann', 'shove', { id: m.id }).outcomes[2]).toMatch(/fire/);
    const r = act(s, 'brann', 'shove', { id: m.id }, 2);
    expect(r.state.delve!.monsters[0]!.hp).toBe(20 - 3 - 1);
  });

  it('orcs shove a hero standing on an unrailed edge (intent with to), 60% to land', () => {
    const s = delve();
    put(s, 'pim', at(1, 11, 3));
    const orc = monster(s, 'orc', at(1, 12, 3), 'hunting');
    (orc as { shouted?: boolean }).shouted = true;
    computeIntents(ctx(s));
    expect(orc.intent).toMatchObject({ kind: 'shove', targetId: 'pim', to: at(1, 10, 3) });
    const vis = e.intents(s)[orc.id]!;
    expect(vis.kind).toBe('shove');
    const r = until(s, { type: 'endTurn' }, (ev) => ev.some((x) => x.type === 'fell'));
    expect(hero(r.state, 'pim').at).toEqual(at(2, 10, 3));
    // On the railing: plain attack.
    const s2 = delve();
    put(s2, 'pim', at(1, 9, 3));
    const o2 = monster(s2, 'orc', at(1, 8, 3), 'hunting');
    computeIntents(ctx(s2));
    expect(o2.intent!.kind).toBe('attack');
  });

  it('berserker charge knocks the target back', () => {
    const s = delve();
    put(s, 'brann', at(3, 7, 5));
    const b = monster(s, 'berserker', at(3, 3, 5), 'hunting');
    computeIntents(ctx(s));
    expect(b.intent!.kind).toBe('attack');
    const r = until(s, { type: 'endTurn' }, (ev) => ev.some((x) => x.type === 'roll' && x.who === b.id && x.roll.hits > 0));
    const sh = r.events.find((x) => x.type === 'shoved');
    expect(sh).toMatchObject({ type: 'shoved', id: 'brann', from: at(3, 7, 5), to: at(3, 8, 5) });
  });

  it("can't shove the Dragon", () => {
    const { s, dragon } = dragonDelve();
    put(s, 'brann', inLine(dragon.at, { ...dragon.at, q: dragon.at.q - 1 }));
    const acts = e.actions(s, 'brann');
    expect(acts.find((o) => o.action === 'attack')!.targets.some((t) => t.id === dragon.id)).toBe(true);
    expect(acts.find((o) => o.action === 'shove')).toBeUndefined();
  });
});

describe('the Dragon (14.4)', () => {
  it('sleeps; wakes when a hero walks into the Lair', () => {
    const { s, dragon } = dragonDelve();
    put(s, 'brann', at(3, 12, 3));
    computeIntents(ctx(s));
    expect(dragon.intent?.kind ?? 'wait').toBe('wait');
    const r = ok(s, { type: 'move', heroId: 'brann', path: [at(3, 13, 3), at(3, 14, 3)], sneak: false });
    expect(r.state.delve!.monsters.find((x) => x.kind === 'dragon')!.awareness).toBe('hunting');
  });

  it('a sneaking Burglar can lift the hoard without waking it', () => {
    let s = e.newGame(3);
    s = ok(s, { type: 'startDelve', contractId: s.campaign.board[0]!.id, heroIds: ['pim', 'brann'], entrance: 0, packs: {} }).state;
    s.delve!.rivals = null;
    s.delve!.monsters = s.delve!.monsters.filter((m) => m.kind === 'dragon');
    const dragon = s.delve!.monsters[0]!;
    const pile = s.delve!.ground.find((g) => g.items.some((i) => i.kind === 'hoard'))!;
    // Pim sneaks from just outside onto a hex next to the pile (not next to the Dragon).
    const spot = posNeighborsOf(pile.at).find((p) => w.tile(p)?.room === 'lair' && w.tile(p)?.kind === 'floor' && Math.max(Math.abs(p.q - dragon.at.q), Math.abs(p.r - dragon.at.r), Math.abs(p.q + p.r - dragon.at.q - dragon.at.r)) > 1 && !s.delve!.ground.some((g) => samePos(g.at, p)))!;
    put(s, 'pim', spot);
    lairCheck(ctx(s), hero(s, 'pim'), true);
    expect(dragon.awareness).toBe('asleep');
    s = act(s, 'pim', 'take', { at: pile.at }).state;
    expect(hero(s, 'pim').pack.some((i) => i.kind === 'hoard')).toBe(true);
    expect(s.delve!.monsters[0]!.awareness).toBe('asleep');
    // Brann moving elsewhere doesn't wake it either.
    put(s, 'brann', at(3, 3, 5));
    s = ok(s, { type: 'move', heroId: 'brann', path: [at(3, 4, 5)], sneak: false }).state;
    expect(s.delve!.monsters[0]!.awareness).toBe('asleep');
  });

  it('wakes on noise 4+, not on less', () => {
    const { s, dragon } = dragonDelve();
    const c = ctx(s);
    makeNoise(c, at(3, 15, 4), 3);
    expect(dragon.awareness).toBe('asleep');
    makeNoise(c, at(3, 15, 4), 4);
    expect(dragon.awareness).toBe('hunting');
  });

  it('breath hits only the marked hexes, ignores armor, and alternates with other intents', () => {
    const { s, dragon } = dragonDelve();
    // Brann straight west of the Dragon at range 2 (inside the Lair); Hobart off the line.
    put(s, 'brann', { level: 3, q: dragon.at.q - 2, r: dragon.at.r });
    put(s, 'hobart', { level: 3, q: dragon.at.q - 1, r: dragon.at.r - 2 });
    lairCheck(ctx(s), hero(s, 'brann'));
    expect(dragon.awareness).toBe('hunting');
    computeIntents(ctx(s));
    const it = dragon.intent!;
    expect(it.kind).toBe('breath');
    expect(it.hexes!.length).toBeGreaterThan(0);
    expect(it.hexes!.some((p) => samePos(p, hero(s, 'brann').at))).toBe(true);
    expect(it.hexes!.some((p) => samePos(p, hero(s, 'hobart').at))).toBe(false);
    const r = ok(s, { type: 'endTurn' });
    expect(r.events.some((x) => x.type === 'breath')).toBe(true);
    expect(hero(r.state, 'brann').hp).toBe(10 - 4);
    expect(hero(r.state, 'hobart').hp).toBe(12);
    const d2 = r.state.delve!.monsters.find((x) => x.kind === 'dragon')!;
    expect(d2.intent!.kind).not.toBe('breath');
    const r2 = ok(r.state, { type: 'endTurn' });
    const d3 = r2.state.delve!.monsters.find((x) => x.kind === 'dragon')!;
    expect(r2.events.some((x) => x.type === 'breath')).toBe(false);
    expect(d3.intent!.kind).toBe('breath');
  });

  it('sweeps when 2+ heroes are adjacent and it is not breathing', () => {
    const { s, dragon } = dragonDelve();
    dragon.awareness = 'hunting';
    (dragon as { breathNext?: boolean }).breathNext = false;
    put(s, 'brann', { level: 3, q: dragon.at.q - 1, r: dragon.at.r });
    put(s, 'hobart', { level: 3, q: dragon.at.q + 1, r: dragon.at.r });
    computeIntents(ctx(s));
    expect(dragon.intent!.kind).toBe('sweep');
    const r = ok(s, { type: 'endTurn' });
    const shoved = r.events.filter((x) => x.type === 'shoved').map((x) => (x as { id: string }).id).sort();
    expect(shoved).toEqual(['brann', 'hobart']);
  });

  it('bites a lone adjacent hero and never leaves the Lair', () => {
    const { s, dragon } = dragonDelve();
    dragon.awareness = 'hunting';
    (dragon as { breathNext?: boolean }).breathNext = false;
    put(s, 'brann', { level: 3, q: dragon.at.q - 1, r: dragon.at.r });
    computeIntents(ctx(s));
    expect(dragon.intent).toMatchObject({ kind: 'attack', targetId: 'brann' });
    // A hero outside the Lair: it doesn't follow out.
    const t = dragonDelve();
    t.dragon.awareness = 'hunting';
    (t.dragon as { breathNext?: boolean }).breathNext = false;
    put(t.s, 'brann', at(3, 10, 3));
    let st = t.s;
    for (let i = 0; i < 4; i++) {
      st = ok(st, { type: 'endTurn' }).state;
      const d = st.delve!.monsters.find((x) => x.kind === 'dragon')!;
      expect(w.tile(d.at)?.room).toBe('lair');
    }
  });

  it('the hoard: 3 pieces around the Dragon at delve start, 2 slots, 300 each', () => {
    let s = e.newGame(3);
    s = ok(s, { type: 'startDelve', contractId: s.campaign.board[0]!.id, heroIds: ALL, entrance: 0, packs: {} }).state;
    const hoard = s.delve!.ground.flatMap((g) => g.items.map((i) => ({ i, at: g.at }))).filter((x) => x.i.kind === 'hoard');
    expect(hoard).toHaveLength(3);
    const sp = testCastle.spawns.find((x) => x.kind === 'dragon')!.at;
    for (const h of hoard) {
      expect(h.i.slots).toBe(2);
      expect(h.i.amount).toBe(300);
      expect(h.at.level).toBe(3);
      expect(Math.abs(h.at.q - sp.q) + Math.abs(h.at.r - sp.r)).toBeLessThanOrEqual(4);
    }
  });
});

describe('slay contract', () => {
  it('appears at reputation 3; done when the Dragon dies and a hero gets out', () => {
    let s = e.newGame(5);
    expect(s.campaign.board.some((k) => k.kind === 'slay')).toBe(false);
    s.campaign.reputation = 3;
    s = ok(s, { type: 'buy', kind: 'torch' }).state; // any camp command keeps the board; force a refresh:
    s = e.newGame(5);
    s.campaign.reputation = 3;
    // Refresh the board by finishing a trivial delve.
    s = ok(s, { type: 'startDelve', contractId: s.campaign.board[0]!.id, heroIds: ['brann'], entrance: 0, packs: {} }).state;
    put(s, 'brann', at(1, 2, 9));
    s = act(s, 'brann', 'leave', {}).state;
    s = ok(s, { type: 'backToCamp' }).state;
    const k = s.campaign.board.find((x) => x.kind === 'slay')!;
    expect(k).toBeTruthy();
    expect(k.bounty).toBe(500);
    expect(k.level).toBe(3);
    s = ok(s, { type: 'startDelve', contractId: k.id, heroIds: ['hobart', 'brann'], entrance: 0, packs: {} }).state;
    s.delve!.rivals = null;
    const dragon = s.delve!.monsters.find((m) => m.kind === 'dragon')!;
    s.delve!.monsters = [dragon];
    dragon.hp = 1;
    put(s, 'brann', { level: 3, q: dragon.at.q - 1, r: dragon.at.r });
    put(s, 'hobart', at(3, 1, 8)); // the cave mouth
    s = act(s, 'brann', 'attack', { id: dragon.id }, 3).state;
    expect(s.delve!.monsters).toHaveLength(0);
    expect(s.delve!.kills.brann).toBe(1);
    s = act(s, 'hobart', 'leave', {}).state;
    s = ok(s, { type: 'abandon' }).state; // Brann is left behind, the contract still counts
    const sum = s.summary!;
    expect(sum.contractDone).toBe(true);
    expect(sum.bounty).toBe(500);
    expect(sum.xp.hobart).toBe(5 + 1 + 3);
    expect(sum.dead).toEqual(['brann']);
  });
});

describe('lift and winch (14.6)', () => {
  it('the lift needs the winch; then it costs 1 like stairs', () => {
    let s = delve();
    put(s, 'brann', at(2, 1, 6));
    expect(e.reachable(s, 'brann', false).some((r) => r.to.level === 3)).toBe(false);
    const wo = e.actions(s, 'brann').find((o) => o.action === 'winch')!;
    expect(wo.targets[0]!.at).toEqual(at(2, 1, 7));
    expect(e.preview(s, 'brann', 'winch', wo.targets[0]!).noise).toBe(6);
    const r = act(s, 'brann', 'winch', wo.targets[0]!);
    expect(r.events.some((x) => x.type === 'liftWorking')).toBe(true);
    expect(r.events.some((x) => x.type === 'noise' && x.radius === 6)).toBe(true);
    s = r.state;
    expect(s.delve!.liftWorking).toBe(true);
    const down = e.reachable(s, 'brann', false).find((x) => samePos(x.to, at(3, 1, 6)))!;
    expect(down.cost).toBe(1);
    expect(e.actions(s, 'brann').some((o) => o.action === 'winch')).toBe(false);
  });

  it('props block movement but not sight; tallprops block both', () => {
    const s = delve();
    const d = s.delve as DelveX;
    put(s, 'brann', at(1, 2, 2));
    expect(e.reachable(s, 'brann', false).some((r) => samePos(r.to, at(1, 3, 2)))).toBe(false); // table
    expect(e.reachable(s, 'brann', false).some((r) => samePos(r.to, at(1, 3, 4)))).toBe(false); // shelf
    const g = glimpseSet(w, d, at(1, 2, 2)).map(posKey);
    expect(g).toContain(posKey(at(1, 4, 2))); // past the table
    const g2 = glimpseSet(w, d, at(1, 3, 3)).map(posKey);
    expect(g2).not.toContain(posKey(at(1, 3, 6))); // behind the shelf and the wall
  });
});

describe('sight and fixed light (14.5)', () => {
  it('sight range by stage and depth, never below 2', () => {
    const s = delve();
    const cases: [number, number, number][] = [[40, 1, 8], [40, 2, 7], [40, 3, 6], [20, 1, 6], [20, 3, 4], [5, 1, 4], [5, 3, 2], [0, 1, 2], [0, 3, 2]];
    for (const [light, level, want] of cases) {
      s.delve!.light = light;
      expect(e.sightRange(s, level)).toBe(want);
    }
  });

  it('the glimpse uses the sight range', () => {
    const s = delve();
    put(s, 'brann', at(3, 2, 4));
    s.delve!.light = 40;
    const far = glimpseSet(w, s.delve as DelveX, hero(s, 'brann').at).length;
    s.delve!.light = 0;
    const near = glimpseSet(w, s.delve as DelveX, hero(s, 'brann').at).length;
    expect(near).toBeLessThan(far);
    for (const p of glimpseSet(w, s.delve as DelveX, hero(s, 'brann').at)) {
      expect(Math.max(Math.abs(p.q - hero(s, 'brann').at.q), Math.abs(p.r - hero(s, 'brann').at.r))).toBeLessThanOrEqual(2);
    }
  });

  it('fixed lights light hexes for good and count for penalties', () => {
    const s = delve({ heroes: ['brann'] });
    put(s, 'brann', at(1, 10, 7)); // the lantern is with brann, far away
    expect(e.inLight(s, at(1, 4, 6))).toBe(true); // the sconce
    expect(e.inLight(s, at(1, 4, 8))).toBe(true);
    expect(e.inLight(s, at(1, 2, 2))).toBe(false);
    expect(e.visibility(s).lit.has(posKey(at(3, 3, 2)))).toBe(true); // fungus on L3
  });

  it('lit hexes in line of sight are visible from up to 14; dark ones only within range', () => {
    const s = delve({ heroes: ['brann'] });
    s.delve!.light = 5; // dark: range 4 on L3, lantern radius 2
    put(s, 'brann', at(3, 12, 2));
    const vis = e.visibility(s).visible;
    expect(vis.has(posKey(at(3, 3, 2)))).toBe(true); // fungus-lit, 9 away
    expect(vis.has(posKey(at(3, 6, 6)))).toBe(false); // dark, beyond range
    expect(vis.has(posKey(at(3, 10, 2)))).toBe(true); // dark but within range
  });

  it('a hero ending a move on a fire vent takes 3', () => {
    const s = delve();
    put(s, 'brann', at(3, 15, 3));
    const r = ok(s, { type: 'move', heroId: 'brann', path: [at(3, 15, 2)], sneak: false });
    expect(hero(r.state, 'brann').hp).toBe(7);
  });
});
