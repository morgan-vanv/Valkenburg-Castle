import { describe, it, expect } from 'vitest';
import { createEngine } from './engine';
import { at, testCastle } from './test/testCastle';
import { posKey, samePos, type Pos } from './hex';
import type { ActionKind, ActionTarget, Command, GameEvent, GameState, HeroClass, ItemKind, Monster, MonsterKind, SlotRoll } from './types';
import { MONSTERS } from './data';
import { brightnessOf, glimpseSet, noiseField, World } from './world';
import type { DelveX, GameStateX } from './state';
import { makeNoise } from './common';
import { makeHero } from './camp';

const e = createEngine(testCastle);
const w = new World(testCastle);
const ALL = ['hobart', 'brann', 'pim', 'aldous'];

/** The classic party (V3.2 starts with Hobart alone): a sellsword, a burglar and a pyromancer join for free. */
function party(s: GameState, extra: [string, string, HeroClass][] = []): GameState {
  s.campaign.roster.push(
    makeHero('brann', 'Brann', 'sellsword'),
    makeHero('pim', 'Pim', 'burglar'),
    makeHero('aldous', 'Aldous', 'pyromancer'),
    ...extra.map(([id, name, cls]) => makeHero(id, name, cls)),
  );
  return s;
}

/** A delve on the test castle with no monsters or rivals; heroes placed by hand. */
function delve(opts: { heroes?: string[]; kind?: 'rescue' | 'recover'; seed?: number; extra?: [string, string, HeroClass][] } = {}): GameState {
  let s = party(e.newGame(opts.seed ?? 1), opts.extra);
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
  it('new game: 160 gold, Hobart alone, 4 recruits of 3+ classes (spec 15.3)', () => {
    const s = e.newGame(7);
    expect(s.campaign.gold).toBe(160);
    expect(s.campaign.roster.map((h) => h.id)).toEqual(['hobart']);
    expect(s.campaign.board).toHaveLength(2); // the test castle has only 2 sites
    expect(s.campaign.recruits).toHaveLength(4);
    for (let seed = 1; seed < 30; seed++) {
      const t = e.newGame(seed);
      expect(new Set(t.campaign.recruits.map((r) => r.hero.cls)).size).toBeGreaterThanOrEqual(3);
      expect(t.campaign.recruits.every((r) => r.price === 40 + 20 * (r.hero.level - 1))).toBe(true);
      expect(t.campaign.recruits.every((r) => r.hero.cls !== 'hobart')).toBe(true);
    }
    expect(s.campaign.board.every((k) => k.level === 1)).toBe(true);
  });

  it('the first delve needs a hero; Hobart alone may go', () => {
    let s = e.newGame(7);
    expect(e.partyProblem(s, [])).toBe('Pick at least one hero.');
    const k = s.campaign.board[0]!.id;
    expect(e.apply(s, { type: 'startDelve', contractId: k, heroIds: [], entrance: 0, packs: {} }).error).toBeTruthy();
    s = ok(s, { type: 'hire', heroId: s.campaign.recruits[0]!.hero.id }).state;
    expect(s.campaign.roster).toHaveLength(2);
    expect(e.partyProblem(s, ['hobart'])).toBeNull();
    expect(ok(s, { type: 'startDelve', contractId: k, heroIds: ['hobart'], entrance: 0, packs: {} }).state.stage).toBe('delve');
    // The tavern refreshes after a delve.
    const empty = { ...s, campaign: { ...s.campaign, roster: [] } };
    expect(e.partyProblem(empty, [])).toBe('Hire at least one hero at the tavern.');
  });

  it('buys, hires, refuses when poor', () => {
    let s = e.newGame(7);
    s = ok(s, { type: 'buy', kind: 'potion' }).state;
    expect(s.campaign.gold).toBe(140);
    expect(s.campaign.stash.map((i) => i.kind)).toEqual(['potion']);
    s.campaign.gold = 5;
    const r = e.apply(s, { type: 'buy', kind: 'charge' });
    expect(r.error).toBeTruthy();
    expect(r.state).toBe(s);
  });

  it('refuses wounded heroes', () => {
    const s = party(e.newGame(7));
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
    // A second move is a dash (spec 15.2): it spends the action; a third move is refused.
    expect(e.reachable(step, 'brann', false).every((r) => r.dash)).toBe(true);
    const dashed = ok(step, { type: 'move', heroId: 'brann', path: [at(1, 6, 7)], sneak: false }).state;
    expect(hero(dashed, 'brann').acted).toBe(true);
    expect(hero(dashed, 'brann').dashed).toBe(true);
    expect(e.apply(dashed, { type: 'move', heroId: 'brann', path: [at(1, 7, 7)], sneak: false }).error).toBeTruthy();
    expect(e.reachable(dashed, 'brann', false)).toEqual([]);
    expect(e.actions(dashed, 'brann').some((a) => a.action === 'attack')).toBe(false);
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
    let s = party(e.newGame(seed));
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
    expect(p.slots).toBe(3); // Sellsword: shove gets +1 slot (spec 15.3)
    const r = until(s, { type: 'act', heroId: 'brann', action: 'shove', target: { id: m.id }, focus: 0 }, (ev) => rolls(ev)[0]!.perfect);
    const mm = r.state.delve!.monsters.find((x) => x.id === m.id)!;
    expect(mm.at).toEqual(at(2, 10, 3));
    expect(mm.hp).toBe(20 - 4 - 1); // perfect (3 of 3) adds 1
    expect(r.events.map((x) => x.type)).toEqual(expect.arrayContaining(['shoved', 'fell']));
    // A kill by falling.
    const k = shoveSetup(at(1, 10, 3), at(1, 11, 3), 'rats');
    k.m.hp = 3;
    const r2 = act(k.s, 'brann', 'shove', { id: k.m.id }, 3);
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
    const r = act(s, 'brann', 'shove', { id: m.id }, 3);
    const mm = r.state.delve!.monsters[0]!;
    expect(mm.at).toEqual(at(1, 9, 3));
    expect(mm.hp).toBe(20 - 1 - 1);
  });

  it('into a wall: 1; into a figure: both take 1; onto a vent: 3', () => {
    // Wall: gate room west wall at (0,7).
    const w1 = shoveSetup(at(1, 0, 7), at(1, 1, 7));
    const r1 = act(w1.s, 'brann', 'shove', { id: w1.m.id }, 3);
    expect(r1.state.delve!.monsters[0]!.hp).toBe(20 - 2);
    // Figure.
    const f = shoveSetup(at(1, 3, 7), at(1, 4, 7));
    const other = monster(f.s, 'orc', at(1, 3, 7), 'hunting', 'm7');
    other.hp = 20;
    const r2 = act(f.s, 'brann', 'shove', { id: f.m.id }, 3);
    expect(r2.state.delve!.monsters.find((x) => x.id === f.m.id)!.hp).toBe(20 - 1 - 1);
    expect(r2.state.delve!.monsters.find((x) => x.id === 'm7')!.hp).toBe(19);
    // Vent at L3 (15,2).
    const vent = at(3, 15, 2);
    const v = shoveSetup(vent, at(3, 15, 3));
    const r3 = act(v.s, 'brann', 'shove', { id: v.m.id }, 3);
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
    let s = party(e.newGame(3));
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
    let s = party(e.newGame(3));
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
    let s = party(e.newGame(5));
    expect(s.campaign.board.some((k) => k.kind === 'slay')).toBe(false);
    s.campaign.reputation = 3;
    s = ok(s, { type: 'buy', kind: 'torch' }).state; // any camp command keeps the board; force a refresh:
    s = party(e.newGame(5));
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
    // Sight range 2, plus the walls next to seen floor (spec 15.1) one hex further out.
    for (const p of glimpseSet(w, s.delve as DelveX, hero(s, 'brann').at)) {
      expect(Math.max(Math.abs(p.q - hero(s, 'brann').at.q), Math.abs(p.r - hero(s, 'brann').at.r))).toBeLessThanOrEqual(3);
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

// ---------------------------------------------------------------- V3.2 (spec section 15)

import { los as losOf } from './world';

function v32(opts: { heroes?: string[]; extra?: [string, string, HeroClass][]; kind?: 'rescue' | 'recover' } = {}) {
  return delve({ heroes: opts.heroes, extra: opts.extra, kind: opts.kind });
}

function give(s: GameState, id: string, kind: ItemKind, name?: string): string {
  const h = hero(s, id);
  const it = { id: `t-${kind}-${h.pack.length}`, kind, name: name ?? kind, amount: 1, slots: kind === 'heirloom' || kind === 'hoard' ? 2 : 1 };
  h.pack.push(it);
  return it.id;
}

function option(s: GameState, id: string, action: ActionKind) {
  return e.actions(s, id).find((a) => a.action === action);
}

describe('15.1 line of sight', () => {
  it('reveals the pantry without holes: floor next to the pillar and the walls around (patchy reveal)', () => {
    // Old LOS from (5,1) missed floor (2,3) beside the pillar (3,3), floor (1,4) and the north wall.
    const s = v32({ heroes: ['brann'] });
    put(s, 'brann', at(1, 5, 1));
    s.delve!.light = 40;
    const vis = e.visibility(s).visible;
    for (const [c, r] of [[2, 3], [1, 4], [4, 2], [2, 2], [6, 4]] as [number, number][]) expect(vis.has(posKey(at(1, c, r))), `floor ${c},${r}`).toBe(true);
    // Every wall bordering a seen pantry floor hex is seen too.
    for (const [c, r] of [[1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [7, 0], [0, 1], [0, 2], [0, 3], [0, 4], [7, 1], [7, 3], [7, 4], [1, 5], [4, 5], [5, 5], [6, 5]] as [number, number][]) {
      expect(vis.has(posKey(at(1, c, r))), `wall ${c},${r}`).toBe(true);
    }
    // The shelf (tallprop) and the pillar are seen; the door (3,5) and (7,2) too.
    expect(vis.has(posKey(at(1, 3, 4)))).toBe(true);
    expect(vis.has(posKey(at(1, 3, 3)))).toBe(true);
    expect(vis.has(posKey(at(1, 3, 5)))).toBe(true);
    // From (1,4) the far corner (5,1) and (4,2) are seen past the pillar.
    put(s, 'brann', at(1, 1, 4));
    const v2 = e.visibility(s).visible;
    expect(v2.has(posKey(at(1, 5, 1)))).toBe(true);
    expect(v2.has(posKey(at(1, 4, 2)))).toBe(true);
    // Nothing beyond the closed door (7,2): the pit hall stays dark.
    expect(v2.has(posKey(at(1, 9, 2)))).toBe(false);
  });

  it('closed doors and tall props block; pits do not; the glimpse gets the walls too', () => {
    const s = v32({ heroes: ['brann'] });
    const d = s.delve as DelveX;
    expect(losOf(w, d, at(1, 6, 2), at(1, 8, 2))).toBe(false);
    d.doors[posKey(at(1, 7, 2))]!.open = true;
    expect(losOf(w, d, at(1, 6, 2), at(1, 8, 2))).toBe(true);
    // Across the pit (9..11,4) on L1 from (8,4) to (12,4).
    expect(losOf(w, d, at(1, 8, 4), at(1, 12, 4))).toBe(true);
    // The shelf K at (3,4) blocks (2,4) -> (4,4); the table T (prop) at (3,2) doesn't block (2,2) -> (4,2).
    expect(losOf(w, d, at(1, 2, 4), at(1, 4, 4))).toBe(false);
    expect(losOf(w, d, at(1, 2, 2), at(1, 4, 2))).toBe(true);
    const g = new Set(glimpseSet(w, d, at(1, 5, 1)).map(posKey));
    expect(g.has(posKey(at(1, 5, 0)))).toBe(true);
    expect(g.has(posKey(at(1, 0, 4)))).toBe(true);
  });

  it('monsters use the same sight: a hero beside the pillar is seen', () => {
    const s = v32({ heroes: ['brann'] });
    put(s, 'brann', at(1, 2, 3));
    s.delve!.light = 40;
    const m = monster(s, 'orc', at(1, 5, 1), 'alert');
    const r = ok(s, { type: 'endTurn' });
    expect(r.state.delve!.monsters.find((x) => x.id === m.id)!.awareness).toBe('hunting');
  });
});

describe('15.2 dash', () => {
  it('reachable marks the second move as a dash, sneaking too; acting first leaves a plain move', () => {
    const s = v32({ heroes: ['pim'] });
    put(s, 'pim', GATE);
    expect(e.reachable(s, 'pim', false).some((r) => r.dash)).toBe(false);
    const moved = ok(s, { type: 'move', heroId: 'pim', path: [at(1, 5, 7)], sneak: false }).state;
    const dashes = e.reachable(moved, 'pim', true);
    expect(dashes.length).toBeGreaterThan(0);
    expect(dashes.every((r) => r.dash)).toBe(true);
    expect(Math.max(...dashes.map((r) => r.cost))).toBe(4); // burglar sneaks 4
  });

  it('act then move: one move only; a dash spends the action', () => {
    const s = v32({ heroes: ['pim'] });
    put(s, 'pim', GATE);
    give(s, 'pim', 'torch');
    const acted = act(s, 'pim', 'torch', {}).state;
    expect(e.reachable(acted, 'pim', false).every((r) => !r.dash)).toBe(true);
    const moved = ok(acted, { type: 'move', heroId: 'pim', path: [at(1, 5, 7)], sneak: false }).state;
    expect(e.reachable(moved, 'pim', false)).toEqual([]);
    expect(hero(moved, 'pim').dashed).toBe(false);
  });
});

describe('15.3 classes', () => {
  it('ranger: shoots at range 6 with noise 1, loses a slot adjacent, can\'t shoot what the party can\'t see', () => {
    const s = v32({ heroes: ['hobart'], extra: [['rae', 'Rae', 'ranger']] });
    const t = delve({ heroes: ['rae'], extra: [['rae', 'Rae', 'ranger']] });
    void s;
    put(t, 'rae', at(3, 1, 8));
    t.delve!.light = 40;
    const m = monster(t, 'orc', at(3, 7, 8), 'alert');
    const p = e.preview(t, 'rae', 'attack', { id: m.id });
    expect(p.ok).toBe(true);
    expect(p.slots).toBe(3);
    expect(p.stat).toBe('finesse');
    expect(p.noise).toBe(1);
    // Out of range at 7.
    m.at = at(3, 8, 8);
    expect(option(t, 'rae', 'attack')).toBeUndefined();
    // Adjacent: 2 slots.
    m.at = at(3, 2, 8);
    expect(e.preview(t, 'rae', 'attack', { id: m.id }).slots).toBe(2);
    // Behind a wall: no.
    m.at = at(3, 14, 8);
    expect(option(t, 'rae', 'attack')).toBeUndefined();
  });

  it('ranger: overwatch shoots the first enemy that moves in sight within 6, once', () => {
    const s = delve({ heroes: ['rae'], extra: [['rae', 'Rae', 'ranger']] });
    put(s, 'rae', at(3, 1, 8));
    s.delve!.light = 40;
    const m = monster(s, 'orc', at(3, 5, 5), 'alert');
    m.hp = 20;
    m.focusAt = at(3, 3, 7);
    const o = option(s, 'rae', 'overwatch')!;
    expect(o.pick).toBe('self');
    const ow = act(s, 'rae', 'overwatch', {}).state;
    expect(hero(ow, 'rae').overwatch).toBe(true);
    expect(option(ow, 'rae', 'overwatch')).toBeUndefined();
    const r = until(ow, { type: 'endTurn' }, (ev) => ev.some((x) => x.type === 'cast' && x.spell === 'overwatch') && ev.some((x) => x.type === 'hit' && x.attacker === 'rae'));
    expect(r.state.delve!.monsters.find((x) => x.id === m.id)!.hp).toBeLessThan(20);
    expect(hero(r.state, 'rae').overwatch).toBe(false);
    expect(rolls(r.events).filter((x) => x.slots === 3).length).toBeGreaterThanOrEqual(1);
  });

  it('ranger: knockback shot pushes a monster away from the ranger along the line (into the pit)', () => {
    const s = delve({ heroes: ['rae'], extra: [['rae', 'Rae', 'ranger']] });
    // Rae at (1,8,2)? Use the pit hall: pit (9..11,4) on L1; orc at (9,3) is railed... orc at (8,4) with rae at (8,2)?
    // (8,4) -> away from (8,2) is (8,6)? Use the L2 pit instead: orc at (8,4)=railing. Use (12,4) on L2 railed too.
    // L2 (9..11,5) are pit; orc at (9,6) with rae at (9,8): away = (9,4)? No: (9,6) away from (9,8) heads up a column.
    put(s, 'rae', at(2, 10, 8));
    s.delve!.light = 40;
    const m = monster(s, 'orc', at(2, 10, 6), 'hunting');
    m.hp = 20;
    const p = e.preview(s, 'rae', 'knockback', { id: m.id });
    expect(p.ok).toBe(true);
    expect(p.slots).toBe(2);
    expect(p.outcomes[2]).toMatch(/Over the edge/);
    expect(p.warning).toMatch(/fall/);
    const r = act(s, 'rae', 'knockback', { id: m.id }, 2);
    const mm = r.state.delve!.monsters.find((x) => x.id === m.id)!;
    expect(mm.at.level).toBe(3);
    expect(r.events.some((x) => x.type === 'fell')).toBe(true);
    // Not against the Dragon; and a miss (1 hit) does nothing.
    const t = delve({ heroes: ['rae'], extra: [['rae', 'Rae', 'ranger']] });
    put(t, 'rae', at(2, 10, 8));
    t.delve!.light = 40;
    const o = monster(t, 'orc', at(2, 10, 6), 'hunting');
    const r2 = until(t, { type: 'act', heroId: 'rae', action: 'knockback', target: { id: o.id }, focus: 0 }, (ev) => rolls(ev)[0]!.hits === 1);
    expect(r2.state.delve!.monsters[0]!.at).toEqual(at(2, 10, 6));
  });

  it('sapper: two free charges, throws a charge up to 3, digs rubble and cracked walls (noise 4)', () => {
    const s = delve({ heroes: ['sam'], extra: [['sam', 'Sam', 'sapper']] });
    expect(hero(s, 'sam').pack.filter((i) => i.kind === 'charge')).toHaveLength(2);
    put(s, 'sam', at(2, 12, 3));
    s.delve!.light = 40;
    const o = option(s, 'sam', 'throwCharge')!;
    expect(o.pick).toBe('hex');
    expect(o.area).toBe(2);
    expect(o.targets.some((t) => samePos(t.at!, at(2, 15, 3)))).toBe(true);
    expect(o.targets.some((t) => samePos(t.at!, at(2, 16, 3)))).toBe(false);
    const m = monster(s, 'orc', at(2, 15, 3), 'alert');
    const pv = e.preview(s, 'sam', 'throwCharge', { at: at(2, 15, 3) });
    expect(pv.affects).toContain(m.id);
    const r = act(s, 'sam', 'throwCharge', { at: at(2, 15, 3) });
    expect(r.events.some((x) => x.type === 'thrown' && x.kind === 'charge')).toBe(true);
    expect(hero(r.state, 'sam').pack.filter((i) => i.kind === 'charge')).toHaveLength(1);
    const r2 = ok(r.state, { type: 'endTurn' });
    expect(r2.events.some((x) => x.type === 'blast')).toBe(true);
    expect(r2.state.delve!.monsters.find((x) => x.id === m.id)!.hp).toBe(MONSTERS.orc.hp - 4);
    // Dig the rubble at L2 (14,3).
    const d = delve({ heroes: ['sam'], extra: [['sam', 'Sam', 'sapper']] });
    put(d, 'sam', at(2, 13, 3));
    expect(option(d, 'sam', 'dig')!.targets.some((t) => samePos(t.at!, at(2, 14, 3)))).toBe(true);
    expect(e.preview(d, 'sam', 'dig', { at: at(2, 14, 3) }).noise).toBe(4);
    const dug = act(d, 'sam', 'dig', { at: at(2, 14, 3) });
    expect(dug.events.some((x) => x.type === 'dug')).toBe(true);
    expect(dug.state.delve!.blown).toContain(posKey(at(2, 14, 3)));
    const reach = e.reachable(dug.state, 'sam', false).find((x) => samePos(x.to, at(2, 14, 3)))!;
    expect(reach.cost).toBe(1);
    // Cracked wall L2 (3,5).
    const c = delve({ heroes: ['sam'], extra: [['sam', 'Sam', 'sapper']] });
    put(c, 'sam', at(2, 3, 4));
    const dug2 = act(c, 'sam', 'dig', { at: at(2, 3, 5) }).state;
    expect(e.reachable(dug2, 'sam', false).some((x) => samePos(x.to, at(2, 3, 6)))).toBe(true);
    // Only sappers dig.
    expect(option(v32({ heroes: ['brann'] }), 'brann', 'dig')).toBeUndefined();
  });

  it('burglar: opens chests without spending the action', () => {
    const s = v32({ heroes: ['pim', 'brann'] });
    put(s, 'pim', at(1, 2, 2));
    put(s, 'brann', at(1, 3, 1));
    const r = act(s, 'pim', 'open', { id: 'c1' });
    expect(hero(r.state, 'pim').acted).toBe(false);
    expect(option(r.state, 'pim', 'take')).toBeDefined();
    const t = v32({ heroes: ['pim', 'brann'] });
    put(t, 'brann', at(1, 2, 2));
    expect(hero(act(t, 'brann', 'open', { id: 'c1' }).state, 'brann').acted).toBe(true);
  });

  it('pyromancer: firebolt and kindle; fireball burns everyone in radius 1 and sets the hexes alight', () => {
    const s = v32({ heroes: ['aldous', 'brann'] });
    put(s, 'aldous', at(3, 2, 8));
    put(s, 'brann', at(3, 6, 8));
    s.delve!.light = 40;
    expect(option(s, 'aldous', 'firebolt')).toBeUndefined();
    const m = monster(s, 'orc', at(3, 6, 7), 'hunting');
    m.hp = 20;
    const m2 = monster(s, 'rats', at(3, 7, 8), 'hunting');
    expect(option(s, 'aldous', 'firebolt')!.mana).toBe(1);
    const fb = option(s, 'aldous', 'fireball')!;
    expect(fb.mana).toBe(2);
    expect(fb.area).toBe(1);
    expect(fb.pick).toBe('hex');
    const pv = e.preview(s, 'aldous', 'fireball', { at: at(3, 6, 8) });
    expect(pv.slots).toBe(3);
    expect(pv.noise).toBe(6);
    expect(pv.hexes).toHaveLength(7);
    expect(pv.affects).toEqual(expect.arrayContaining([m.id, m2.id, 'brann']));
    expect(pv.warning).toMatch(/Brann/);
    const r = act(s, 'aldous', 'fireball', { at: at(3, 6, 8) }, 3);
    expect(hero(r.state, 'aldous').mana).toBe(1);
    expect(r.state.delve!.monsters.find((x) => x.id === m.id)!.hp).toBe(20 - 7);
    expect(r.state.delve!.monsters.find((x) => x.id === m2.id)).toBeUndefined();
    expect(hero(r.state, 'brann').hp).toBe(10 - (3 * 1 + 1)); // armor 1: 1 per hit, +1 perfect
    expect(Object.keys(r.state.delve!.burning)).toHaveLength(5); // the two wall hexes south don't burn
    expect(e.visibility(r.state).lit.has(posKey(at(3, 6, 8)))).toBe(true);
    // Standing in the fire burns 1 at the world phase; the fire goes out after 2 rounds.
    r.state.delve!.monsters = [];
    const w1 = ok(r.state, { type: 'endTurn' }).state;
    expect(hero(w1, 'brann').hp).toBe(5);
    expect(w1.delve!.burning[posKey(at(3, 6, 8))]).toBe(1);
    const w2 = ok(w1, { type: 'endTurn' }).state;
    expect(hero(w2, 'brann').hp).toBe(4);
    expect(Object.keys(w2.delve!.burning)).toHaveLength(0);
    // Out of mana: no fireball with 1 left.
    expect(option(r.state, 'aldous', 'fireball')).toBeUndefined();
    expect(option(r.state, 'aldous', 'kindle')).toBeUndefined(); // light is full
  });

  it('shadowmancer: veil hides an ally from monsters until they attack; sleep puts a monster to sleep; blink teleports', () => {
    const s = v32({ heroes: ['brann'], extra: [['sha', 'Sha', 'shadowmancer']] });
    const t = delve({ heroes: ['sha', 'brann'], extra: [['sha', 'Sha', 'shadowmancer']] });
    void s;
    put(t, 'sha', at(3, 2, 8));
    put(t, 'brann', at(3, 3, 8));
    t.delve!.light = 40;
    const m = monster(t, 'orc', at(3, 4, 8), 'hunting');
    m.hp = 20;
    // Veil Brann: the orc loses him and goes alert; Brann is not in its targets.
    const veiled = act(t, 'sha', 'veil', { id: 'brann' }).state;
    expect(hero(veiled, 'sha').mana).toBe(2);
    expect(hero(veiled, 'brann').veil).toBe(2);
    expect(veiled.delve!.monsters[0]!.awareness).toBe('hunting'); // it still sees Sha
    // Sha veils herself too, then the world phase: nobody gets attacked (both veiled).
    hero(veiled, 'sha').acted = false;
    const both = act(veiled, 'sha', 'veil', { id: 'sha' }).state;
    const wp = ok(both, { type: 'endTurn' });
    expect(wp.events.some((x) => x.type === 'hit' && (x.target === 'brann' || x.target === 'sha'))).toBe(false);
    expect(wp.state.delve!.monsters[0]!.awareness).toBe('alert'); // lost them both
    expect(hero(wp.state, 'brann').veil).toBe(1);
    // Attacking breaks the veil.
    const broke = act(wp.state, 'brann', 'attack', { id: m.id }).state;
    expect(hero(broke, 'brann').veil).toBe(0);
    // Sleep: 2 Wits slots at range 5; a hit puts it to sleep; not the Dragon.
    const u = delve({ heroes: ['sha'], extra: [['sha', 'Sha', 'shadowmancer']] });
    put(u, 'sha', at(3, 2, 8));
    u.delve!.light = 40;
    const o = monster(u, 'orc', at(3, 6, 8), 'hunting');
    const dr = monster(u, 'dragon', at(3, 4, 8), 'hunting');
    const sl = option(u, 'sha', 'sleep')!;
    expect(sl.targets.map((x) => x.id)).toEqual([o.id]);
    void dr;
    const r = act(u, 'sha', 'sleep', { id: o.id }, 1);
    expect(r.state.delve!.monsters.find((x) => x.id === o.id)!.awareness).toBe('asleep');
    expect(r.events.some((x) => x.type === 'awake' && x.awareness === 'asleep')).toBe(true);
    // Blink: up to 4 hexes to a free hex in sight, over the pit; silent.
    const b = delve({ heroes: ['sha'], extra: [['sha', 'Sha', 'shadowmancer']] });
    put(b, 'sha', at(2, 8, 5));
    b.delve!.light = 40;
    const bl = option(b, 'sha', 'blink')!;
    expect(bl.targets.some((x) => samePos(x.at!, at(2, 12, 5)))).toBe(true); // across the pit
    expect(bl.targets.some((x) => samePos(x.at!, at(2, 10, 5)))).toBe(false); // the pit itself
    const br = act(b, 'sha', 'blink', { at: at(2, 12, 5) });
    expect(hero(br.state, 'sha').at).toEqual(at(2, 12, 5));
    expect(br.events.some((x) => x.type === 'blinked')).toBe(true);
    expect(br.events.some((x) => x.type === 'noise')).toBe(false);
  });

  it('hedgewitch: mend, ward (1 less per hit, min 0) and gust (everyone within 1 pushed away)', () => {
    const s = delve({ heroes: ['hed', 'brann'], extra: [['hed', 'Hed', 'hedgewitch']] });
    put(s, 'hed', at(3, 2, 8));
    put(s, 'brann', at(3, 3, 8));
    s.delve!.light = 40;
    hero(s, 'brann').hp = 4;
    const mended = act(s, 'hed', 'mend', { id: 'brann' }).state;
    expect(hero(mended, 'brann').hp).toBe(8);
    hero(mended, 'hed').acted = false;
    const warded = act(mended, 'hed', 'ward', { id: 'brann' }).state;
    expect(hero(warded, 'brann').ward).toBe(2);
    expect(hero(warded, 'hed').mana).toBe(1);
    // An orc (2 dmg) vs armor 1 + ward 1: 0 per hit (+1 on a perfect).
    const m = monster(warded, 'orc', at(3, 4, 8), 'hunting');
    const r = until(warded, { type: 'endTurn' }, (ev) => rolls(ev).some((x) => x.hits === 1));
    expect(hero(r.state, 'brann').hp).toBe(8);
    expect(hero(r.state, 'brann').ward).toBe(1);
    void m;
    // Gust at (2,10,7) on L2: an orc at (2,10,6) goes north into the pit (9..11,5); Brann at (2,9,7) is pushed west.
    const g = delve({ heroes: ['hed', 'brann'], extra: [['hed', 'Hed', 'hedgewitch']] });
    put(g, 'hed', at(2, 10, 8));
    put(g, 'brann', at(2, 9, 7));
    g.delve!.light = 40;
    const o = monster(g, 'orc', at(2, 10, 6), 'hunting');
    o.hp = 20;
    const pv = e.preview(g, 'hed', 'gust', { at: at(2, 10, 7) });
    expect(pv.affects).toEqual(expect.arrayContaining([o.id, 'brann']));
    expect(pv.warning).toMatch(/Orc/);
    expect(pv.noise).toBe(2);
    const gr = act(g, 'hed', 'gust', { at: at(2, 10, 7) });
    expect(gr.state.delve!.monsters.find((x) => x.id === o.id)!.at.level).toBe(3);
    expect(hero(gr.state, 'brann').at).toEqual(at(2, 8, 7));
  });
});

describe('15.4 quartermaster', () => {
  it('sells twelve items; buying puts them in the stash', () => {
    const shop = e.shop();
    expect(shop.map((o) => o.kind)).toEqual(['torch', 'potion', 'rope', 'charge', 'smoke', 'glue', 'dart', 'caltrops', 'hook', 'key', 'oil', 'firecracker']);
    expect(shop.find((o) => o.kind === 'hook')!.price).toBe(40);
    let s = e.newGame(2);
    s = ok(s, { type: 'buy', kind: 'firecracker' }).state;
    expect(s.campaign.gold).toBe(150);
    expect(s.campaign.stash[0]!.kind).toBe('firecracker');
  });

  it('smoke bomb: blocks sight both ways for 2 rounds; monsters inside lose track', () => {
    const s = v32({ heroes: ['brann'] });
    put(s, 'brann', at(3, 2, 8));
    s.delve!.light = 40;
    const id = give(s, 'brann', 'smoke');
    const m = monster(s, 'orc', at(3, 6, 8), 'hunting');
    const o = option(s, 'brann', 'smoke')!;
    expect(o.pick).toBe('hex');
    expect(o.targets.some((t) => samePos(t.at!, at(3, 6, 8)) && t.itemId === id)).toBe(true);
    expect(o.targets.some((t) => samePos(t.at!, at(3, 7, 8)))).toBe(false); // range 4
    const r = act(s, 'brann', 'smoke', { at: at(3, 6, 8), itemId: id });
    expect(r.events.some((x) => x.type === 'thrown' && x.kind === 'smoke')).toBe(true);
    expect(Object.keys(r.state.delve!.smoke).length).toBeGreaterThanOrEqual(5);
    expect(r.state.delve!.monsters[0]!.awareness).toBe('alert');
    expect(e.visibility(r.state).visible.has(posKey(at(3, 6, 8)))).toBe(false);
    expect(e.visibility(r.state).visible.has(posKey(at(3, 9, 8)))).toBe(false); // behind the cloud
    expect(e.visibility(r.state).visible.has(posKey(at(3, 4, 8)))).toBe(true);
    const w1 = ok(r.state, { type: 'endTurn' }).state;
    expect(w1.delve!.monsters.find((x) => x.id === m.id)!.awareness).not.toBe('hunting');
    const w2 = ok(w1, { type: 'endTurn' }).state;
    expect(Object.keys(w2.delve!.smoke)).toHaveLength(0);
  });

  it('glue bomb: monsters within 1 are stuck for 2 rounds (they still bite if adjacent)', () => {
    const s = v32({ heroes: ['brann'] });
    put(s, 'brann', at(3, 2, 8));
    s.delve!.light = 40;
    const id = give(s, 'brann', 'glue');
    const m = monster(s, 'orc', at(3, 6, 8), 'hunting');
    const r = act(s, 'brann', 'glue', { at: at(3, 6, 8), itemId: id });
    expect(r.state.delve!.monsters[0]!.stuck).toBe(2);
    expect(Object.keys(r.state.delve!.glue).length).toBeGreaterThanOrEqual(5);
    const w1 = ok(r.state, { type: 'endTurn' }).state;
    expect(w1.delve!.monsters.find((x) => x.id === m.id)!.at).toEqual(at(3, 6, 8));
    expect(w1.delve!.monsters[0]!.stuck).toBe(1);
    const w2 = ok(w1, { type: 'endTurn' }).state;
    expect(w2.delve!.monsters[0]!.at).toEqual(at(3, 6, 8));
    expect(w2.delve!.monsters[0]!.stuck).toBe(0);
    const w3 = ok(w2, { type: 'endTurn' }).state;
    expect(w3.delve!.monsters[0]!.at).not.toEqual(at(3, 6, 8));
  });

  it('sleep dart: anyone, 1 Finesse slot, silent; a hit sleeps the monster', () => {
    const s = v32({ heroes: ['brann'] });
    put(s, 'brann', at(3, 2, 8));
    s.delve!.light = 40;
    const id = give(s, 'brann', 'dart');
    const m = monster(s, 'orc', at(3, 7, 8), 'hunting');
    const pv = e.preview(s, 'brann', 'dart', { id: m.id, itemId: id });
    expect(pv.slots).toBe(1);
    expect(pv.stat).toBe('finesse');
    expect(pv.noise).toBe(0);
    const r = act(s, 'brann', 'dart', { id: m.id, itemId: id }, 1);
    expect(r.state.delve!.monsters[0]!.awareness).toBe('asleep');
    expect(hero(r.state, 'brann').pack).toHaveLength(0);
    expect(r.events.some((x) => x.type === 'noise')).toBe(false);
  });

  it('caltrops: the first monster to step on them takes 2 and stops', () => {
    const s = v32({ heroes: ['brann'] });
    put(s, 'brann', at(3, 2, 8));
    s.delve!.light = 40;
    const id = give(s, 'brann', 'caltrops');
    const r = act(s, 'brann', 'caltrops', { at: at(3, 3, 8), itemId: id });
    expect(r.state.delve!.caltrops).toEqual([posKey(at(3, 3, 8))]);
    r.state.delve!.caltrops = [posKey(at(3, 4, 8))]; // further out, so the stop is short of a bite
    const m = monster(r.state, 'orc', at(3, 6, 8), 'hunting');
    const w1 = ok(r.state, { type: 'endTurn' });
    const mm = w1.state.delve!.monsters.find((x) => x.id === m.id)!;
    expect(mm.at).toEqual(at(3, 4, 8));
    expect(mm.hp).toBe(MONSTERS.orc.hp - 2);
    expect(w1.events.some((x) => x.type === 'caltrops')).toBe(true);
    expect(w1.events.some((x) => x.type === 'hit' && x.target === 'brann')).toBe(false); // stopped short of biting
    expect(w1.state.delve!.caltrops).toEqual([]);
  });

  it('grappling hook: climbs back up from a pit landing, reusable; blocked when the top is taken', () => {
    const s = v32({ heroes: ['brann', 'pim'] });
    put(s, 'brann', at(2, 10, 3)); // L2 bridge, under L1's pit mouth (10,3)
    put(s, 'pim', at(1, 5, 7));
    give(s, 'brann', 'hook');
    const o = option(s, 'brann', 'grapple')!;
    expect(o.blocked).toBeUndefined();
    expect(o.targets[0]!.at!.level).toBe(1);
    const r = act(s, 'brann', 'grapple', {});
    const h = hero(r.state, 'brann');
    expect(h.at.level).toBe(1);
    expect(h.moved && h.acted).toBe(true);
    expect(h.pack.some((i) => i.kind === 'hook')).toBe(true);
    // Not from an ordinary hex.
    expect(option(r.state, 'brann', 'grapple')).toBeUndefined();
    // Top edge hexes all taken: offered but blocked.
    const t = v32({ heroes: ['brann', 'pim', 'hobart', 'aldous'] });
    put(t, 'brann', at(2, 10, 3));
    give(t, 'brann', 'hook');
    put(t, 'pim', at(1, 9, 3));
    put(t, 'hobart', at(1, 11, 3));
    put(t, 'aldous', at(1, 10, 2));
    monster(t, 'orc', at(1, 9, 2), 'asleep');
    monster(t, 'orc', at(1, 11, 2), 'asleep');
    const b = option(t, 'brann', 'grapple')!;
    expect(b.blocked).toMatch(/No room/);
    expect(e.apply(t, { type: 'act', heroId: 'brann', action: 'grapple', target: {}, focus: 0 }).error).toMatch(/No room/);
  });

  it('skeleton key: opens a locked door or chest silently for anyone, one use', () => {
    const s = v32({ heroes: ['brann'] });
    put(s, 'brann', at(1, 12, 3));
    const id = give(s, 'brann', 'key');
    const o = option(s, 'brann', 'key')!;
    expect(o.targets.some((t) => samePos(t.at!, at(1, 13, 3)))).toBe(true);
    const r = act(s, 'brann', 'key', { at: at(1, 13, 3), itemId: id });
    expect(r.state.delve!.doors[posKey(at(1, 13, 3))]!.open).toBe(true);
    expect(r.events.some((x) => x.type === 'noise')).toBe(false);
    expect(hero(r.state, 'brann').pack).toHaveLength(0);
    const c = v32({ heroes: ['brann'] });
    put(c, 'brann', at(1, 16, 1));
    const cid = give(c, 'brann', 'key');
    const rc = act(c, 'brann', 'key', { at: at(1, 17, 1), itemId: cid });
    expect(rc.state.delve!.chests.find((x) => x.id === 'c2')!.opened).toBe(true);
  });

  it('oil flask: +10 light; firecracker: noise 6 at the hex, draws alert monsters there', () => {
    const s = v32({ heroes: ['brann'] });
    put(s, 'brann', at(3, 2, 8));
    s.delve!.light = 20;
    const oil = give(s, 'brann', 'oil');
    const r = act(s, 'brann', 'oil', { itemId: oil });
    expect(r.state.delve!.light).toBe(30);
    const fc = give(r.state, 'brann', 'firecracker');
    hero(r.state, 'brann').acted = false;
    const m = monster(r.state, 'orc', at(3, 4, 2), 'asleep');
    const o = option(r.state, 'brann', 'firecracker')!;
    expect(o.targets.some((t) => samePos(t.at!, at(3, 8, 8)))).toBe(true); // range 6
    const r2 = act(r.state, 'brann', 'firecracker', { at: at(3, 6, 4), itemId: fc });
    expect(r2.events.some((x) => x.type === 'noise' && x.radius === 6)).toBe(true);
    const mm = r2.state.delve!.monsters.find((x) => x.id === m.id)!;
    expect(mm.awareness).toBe('alert');
    expect(mm.focusAt).toEqual(at(3, 6, 4));
  });
});

describe('15.7 take never fails silently', () => {
  it('a heirloom that does not fit blocks take with a reason; gold beside it is not taken first', () => {
    const s = v32({ heroes: ['pim'], kind: 'recover' });
    const site = at(1, 5, 3);
    put(s, 'pim', site);
    for (let i = 0; i < 4; i++) give(s, 'pim', 'torch');
    s.delve!.ground.find((g) => samePos(g.at, site))!.items.push({ id: 'g1', kind: 'gold', name: '30 gold', amount: 30, slots: 1 });
    const o = option(s, 'pim', 'take')!;
    expect(o.blocked).toMatch(/needs 2 pack slots/);
    expect(e.preview(s, 'pim', 'take', { at: site }).ok).toBe(false);
    expect(e.apply(s, { type: 'act', heroId: 'pim', action: 'take', target: { at: site }, focus: 0 }).error).toMatch(/needs 2 pack slots/);
    // Drop one torch: still blocked (needs 2). Drop two: the heirloom comes first, then the gold.
    const d1 = act(s, 'pim', 'drop', { itemId: hero(s, 'pim').pack[0]!.id }).state;
    expect(option(d1, 'pim', 'take')!.blocked).toMatch(/needs 2/);
    const d2 = act(d1, 'pim', 'drop', { itemId: hero(d1, 'pim').pack[0]!.id }).state;
    const ready = option(d2, 'pim', 'take')!;
    expect(ready.blocked).toBeUndefined();
    // With exactly 2 slots free the preview says only the heirloom goes; the gold stays on the ground.
    const pv = e.preview(d2, 'pim', 'take', { at: site });
    expect(pv.ok).toBe(true);
    expect(pv.outcomes[0]).toBe('Takes The Valkenburg Signet');
    const r = act(d2, 'pim', 'take', { at: site });
    expect(hero(r.state, 'pim').pack.some((i) => i.kind === 'heirloom')).toBe(true);
    const left = r.state.delve!.ground.find((g) => samePos(g.at, site))!.items.map((i) => i.kind);
    expect(left).toContain('gold');
    expect(left).not.toContain('heirloom');
    // With room for both, both go, the heirloom first.
    const d3 = act(d2, 'pim', 'drop', { itemId: hero(d2, 'pim').pack[0]!.id }).state;
    expect(e.preview(d3, 'pim', 'take', { at: site }).outcomes[0]).toBe('Takes The Valkenburg Signet, 30 gold');
  });

  it('a full pack blocks take with a reason', () => {
    const s = v32({ heroes: ['pim'] });
    put(s, 'pim', at(1, 5, 7)); // coin pile
    for (let i = 0; i < 4; i++) give(s, 'pim', 'torch');
    expect(option(s, 'pim', 'take')!.blocked).toMatch(/Pack is full/);
  });
});
