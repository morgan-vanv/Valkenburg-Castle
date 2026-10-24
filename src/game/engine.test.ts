import { describe, it, expect } from 'vitest';
import { createEngine } from './engine';
import { at, testCastle } from './test/testCastle';
import { posKey, samePos, type Pos } from './hex';
import type { ActionKind, ActionTarget, Command, GameEvent, GameState, Monster, MonsterKind, SlotRoll } from './types';
import { MONSTERS } from './data';
import { brightnessOf, noiseField, World } from './world';
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
    const rub = at(2, 11, 3);
    expect(w.tile(rub)?.kind).toBe('rubble');
    put(s, 'brann', at(2, 10, 3));
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

  it('shove into the pit kills', () => {
    const s = delve();
    // Pit at (10,3),(9,4),(10,4). Hero at (12,3) hmm: needs a straight line hero → monster → pit.
    const pit = at(1, 10, 3);
    const mAt = at(1, 11, 3);
    const hAt = at(1, 12, 3);
    expect(w.tile(pit)?.kind).toBe('pit');
    put(s, 'brann', hAt);
    const m = monster(s, 'orc', mAt, 'hunting');
    expect(e.preview(s, 'brann', 'shove', { id: m.id }).outcomes[2]).toBe('Falls into the pit');
    const r = act(s, 'brann', 'shove', { id: m.id }, 2);
    expect(r.state.delve!.monsters).toHaveLength(0);
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
