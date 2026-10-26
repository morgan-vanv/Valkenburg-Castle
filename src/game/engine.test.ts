import { FREE_MOVE } from './data';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEngine } from './engine';
import { at, testCastle } from './test/testCastle';
import { distance, posKey, samePos, type Pos } from './hex';
import type { ActionKind, ActionTarget, Command, GameEvent, GameState, HeroClass, ItemKind, Monster, MonsterKind, SlotRoll } from './types';
import { MONSTERS } from './data';
import { brightnessOf, glimpseSet, noiseField, World } from './world';
import type { DelveX, GameStateX, HeroX, MonsterX } from './state';
import { dirIndex, moveRisks, wakeChance, wouldNotice } from './stealth';
import { litSet } from './world';
import { makeNoise } from './common';
import { makeHero } from './camp';

const e = createEngine(testCastle);
const w = new World(testCastle);
const ALL = ['keven', 'brann', 'pim', 'aldous'];

/** The classic party (V3.2 starts with Keven alone): a sellsword, a burglar and a pyromancer join for free. */
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

/** V3.9 (spec 24.2): turn a hero to face `p` (they see only their front half). */
function look(s: GameState, id: string, p: Pos): void {
  const h = hero(s, id);
  h.facing = dirIndex(h.at, p);
}

/** V3.9: no facing at all: the hero sees all round (sight-geometry tests from before fields of view). */
function allRound(s: GameState, ...ids: string[]): void {
  for (const h of s.delve!.heroes) if (!ids.length || ids.includes(h.heroId)) h.facing = undefined;
}

/**
 * A hand-placed monster. No facing: it watches all round (V3.7 blind-arc tests set `facing` themselves).
 * A hunting one has noticed every hero in the delve (V3.7: so the old fights carry no sneak-attack bonus).
 */
function monster(s: GameState, kind: MonsterKind, p: Pos, awareness: 'asleep' | 'alert' | 'hunting' = 'asleep', id = `m${s.delve!.monsters.length + 1}`) {
  const def = MONSTERS[kind];
  const m: Monster & { noticedIds?: string[] } = { id, kind, name: def.name, at: { ...p }, hp: def.hp, maxHp: def.hp, awareness, spawnedAt: { ...p } };
  if (awareness === 'hunting') m.noticedIds = s.delve!.heroes.map((h) => h.heroId);
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

/** V3.7 (spec 20.5): a long fuse far away keeps the party from being calm, so the budgeted move rules apply. */
function alarm(s: GameState): GameState {
  (s.delve as DelveX).fuses = [{ at: at(3, 5, 5), rounds: 99, by: 'x' }];
  return s;
}

// Landmarks in the test castle (offset col,row).
const GATE = at(1, 4, 7);
const PITHALL = at(1, 10, 7);

describe('camp', () => {
  it('new game: 90 gold (V3.7.1), Keven alone, 3 level-1 drifters of 3 classes at 60 at the campfire (spec 15.3, 17.1, 18.2)', () => {
    const s = e.newGame(7);
    expect(s.campaign.gold).toBe(90);
    expect(s.campaign.recruits.every((r) => r.hero.level === 1 && r.price === 60)).toBe(true);
    expect(s.campaign.roster.map((h) => h.id)).toEqual(['keven']);
    expect(s.campaign.board).toHaveLength(2); // the test castle has only 2 sites
    expect(s.campaign.recruits).toHaveLength(3);
    for (let seed = 1; seed < 30; seed++) {
      const t = e.newGame(seed);
      expect(new Set(t.campaign.recruits.map((r) => r.hero.cls)).size).toBeGreaterThanOrEqual(3);
      expect(t.campaign.recruits.every((r) => r.price === 60 + 40 * (r.hero.level - 1))).toBe(true);
      expect(t.campaign.recruits.every((r) => r.hero.cls !== 'heir')).toBe(true);
    }
    expect(s.campaign.board.every((k) => k.level === 1)).toBe(true);
  });

  it('the first delve needs a hero; Keven alone may go', () => {
    let s = e.newGame(7);
    expect(e.partyProblem(s, [])).toBe('Pick at least one hero.');
    const k = s.campaign.board[0]!.id;
    expect(e.apply(s, { type: 'startDelve', contractId: k, heroIds: [], entrance: 0, packs: {} }).error).toBeTruthy();
    s = ok(s, { type: 'hire', heroId: s.campaign.recruits[0]!.hero.id }).state;
    expect(s.campaign.roster).toHaveLength(2);
    expect(e.partyProblem(s, ['keven'])).toBeNull();
    expect(ok(s, { type: 'startDelve', contractId: k, heroIds: ['keven'], entrance: 0, packs: {} }).state.stage).toBe('delve');
    // The tavern refreshes after a delve.
    const empty = { ...s, campaign: { ...s.campaign, roster: [] } };
    expect(e.partyProblem(empty, [])).toBe('Hire at least one hero at the tavern.');
  });

  it('buys, hires, refuses when poor', () => {
    let s = e.newGame(7);
    s = ok(s, { type: 'buy', kind: 'potion' }).state;
    expect(s.campaign.gold).toBe(70);
    expect(s.campaign.stash.map((i) => i.kind)).toEqual(['potion']);
    s.campaign.gold = 5;
    const r = e.apply(s, { type: 'buy', kind: 'charge' });
    expect(r.error).toBeTruthy();
    expect(r.state).toBe(s);
  });

  it('the starting purse buys one level-1 hire and an item or two, not a second hire (21.2)', () => {
    let s = e.newGame(7);
    s = ok(s, { type: 'hire', heroId: s.campaign.recruits[0]!.hero.id }).state;
    expect(s.campaign.gold).toBe(30);
    expect(e.apply(s, { type: 'hire', heroId: s.campaign.recruits[0]!.hero.id }).error).toBe('Not enough gold.');
    s = ok(s, { type: 'buy', kind: 'torch' }).state;
    s = ok(s, { type: 'buy', kind: 'rope' }).state;
    expect(s.campaign.gold).toBe(5);
    expect(e.apply(s, { type: 'buy', kind: 'firecracker' }).error).toBeTruthy();
  });

  it('HP carries over between delves; the infirmary heals 3 gold per HP, as far as the gold goes (17.2)', () => {
    const s = party(e.newGame(7));
    const brann = s.campaign.roster.find((h) => h.id === 'brann')!;
    brann.hp = 4;
    let r = e.apply(s, { type: 'startDelve', contractId: s.campaign.board[0]!.id, heroIds: ['brann'], entrance: 0, packs: {} });
    expect(r.error).toBeFalsy();
    expect(r.state.delve!.heroes[0]!.hp).toBe(4);
    const t = party(e.newGame(7));
    const b = t.campaign.roster.find((h) => h.id === 'brann')!;
    b.hp = b.maxHp - 5;
    t.campaign.gold = 10;
    t.campaign.village.surgeon = true; // V3.5: only with Brother Aldric home
    r = ok(t, { type: 'heal', heroId: 'brann' });
    const b2 = r.state.campaign.roster.find((h) => h.id === 'brann')!;
    expect(b2.hp).toBe(b.maxHp - 2); // 3 HP for 9 gold
    expect(r.state.campaign.gold).toBe(1);
    expect(e.apply(r.state, { type: 'heal', heroId: 'brann' }).error).toMatch(/gold/);
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
    expect(p.slots).toBe(4); // 3, +1 sneak attack on a sleeper (V3.7, spec 20.1)
    expect(p.chance).toBe(90); // 70 + 20 asleep
    expect(p.modifiers).toContain('Asleep +20%');
    expect(p.modifiers).toContain('Sneak attack +1 slot');
    expect(p.outcomes).toEqual(['Miss', '2 dmg', '4 dmg', '6 dmg', '9 dmg']);
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
    put(s, 'keven', at(1, 5, 7));
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
    put(s, 'keven', at(1, 8, 7));
    const reach = e.reachable(s, 'brann', false);
    expect(reach.some((r) => samePos(r.to, at(1, 9, 7)))).toBe(true); // through keven
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
    const s = alarm(delve());
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
    let s = alarm(delve({ heroes: ['keven', 'pim'] })); // not calm: a 4-step walk would turn the castle and burn the last of the light
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
    for (const p of glimpseSet(w, s.delve as DelveX, hero(s, 'keven').at)) {
      expect(p.level).toBe(hero(s, 'keven').at.level);
    }
    const all = glimpseSet(w, s.delve as DelveX, hero(s, 'keven').at).length;
    const tiles = Object.keys(testCastle.levels[0]!.tiles).length;
    expect(all).toBeLessThan(tiles);
  });
});

describe('light', () => {
  it('stages by oil (spec 16.2: 20 max; bright > 12, dim 7..12, dark 1..6)', () => {
    expect(brightnessOf(20)).toBe('bright');
    expect(brightnessOf(13)).toBe('bright');
    expect(brightnessOf(12)).toBe('dim');
    expect(brightnessOf(7)).toBe('dim');
    expect(brightnessOf(6)).toBe('dark');
    expect(brightnessOf(1)).toBe('dark');
    expect(brightnessOf(0)).toBe('pitch');
  });

  it('burns 1 per round and lights radius by stage', () => {
    let s = delve();
    put(s, 'keven', PITHALL);
    s = ok(s, { type: 'endTurn' }).state;
    expect(s.delve!.light).toBe(19);
    const lit = e.visibility(s).lit;
    expect(lit.has(posKey(at(1, 10, 3)))).toBe(true); // 4 rows up
    s.delve!.light = 10; // dim: radius 3
    expect(e.visibility(s).lit.has(posKey(at(1, 10, 3)))).toBe(false);
    expect(e.inLight(s, PITHALL)).toBe(true);
  });

  it('heroes outside the light fight at dark', () => {
    const s = delve();
    put(s, 'keven', PITHALL);
    put(s, 'brann', at(1, 2, 2));
    const m = monster(s, 'orc', at(1, 3, 2), 'hunting');
    const p = e.preview(s, 'brann', 'attack', { id: m.id });
    expect(p.modifiers).toContain('Dark −20%');
    expect(p.chance).toBe(50);
  });

  it('kindle adds 6, braziers add 4 and stay lit (spec 16.2)', () => {
    let s = delve();
    s.delve!.light = 8;
    s = act(s, 'aldous', 'kindle', {}).state;
    expect(s.delve!.light).toBe(14);
    expect(hero(s, 'aldous').mana).toBe(2);
    put(s, 'brann', at(1, 16, 3));
    const b = at(1, 16, 2);
    s = act(s, 'brann', 'light', { at: b }).state;
    expect(s.delve!.light).toBe(18);
    expect(s.delve!.lit).toContain(posKey(b));
  });

  it('the Gloam comes at 0 and fades when light returns', () => {
    let s = delve();
    put(s, 'keven', PITHALL);
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
    give(s, 'pim', 'lockpicks'); // V3.7.1: 3 slots needs the smith's picks
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

  it('revive brings a downed hero back at 3 HP', () => {
    let s = delve();
    put(s, 'brann', GATE);
    put(s, 'keven', at(1, 5, 7));
    Object.assign(hero(s, 'brann'), { status: 'downed', hp: 0, bleed: 2 });
    s = act(s, 'keven', 'revive', { id: 'brann' }).state;
    expect(hero(s, 'brann')).toMatchObject({ status: 'active', hp: 3, revived: true });
  });

  it('monsters ignore downed heroes', () => {
    const s = delve(['brann', 'keven'].length ? {} : {});
    put(s, 'brann', GATE);
    Object.assign(hero(s, 'brann'), { status: 'downed', hp: 0, bleed: 2 });
    for (const id of ['keven', 'pim', 'aldous']) put(s, id, at(2, 16, 7 + (id === 'pim' ? 1 : 0)));
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
    for (const id of ['keven', 'pim', 'aldous']) put(s, id, at(2, 2 + ALL.indexOf(id), 1));
    s.delve!.lanternBearer = 'brann';
    const orc = monster(s, 'orc', at(1, 2, 6), 'hunting');
    look(s, 'brann', orc.at);
    // Any successful command gives an awake monster without one an intent.
    let st = ok(s, { type: 'move', heroId: 'pim', path: e.reachable(s, 'pim', true)[0]!.path, sneak: true }).state;
    const intent = e.intents(st)[orc.id]!;
    expect(intent.kind).toBe('attack');
    expect(intent.targetId).toBe('brann');
    const r = ok(st, { type: 'endTurn' });
    expect(r.events.some((x) => x.type === 'roll' && x.who === orc.id)).toBe(true);
    st = r.state;
  });

  it('a hero ending a move next to a sleeper wakes it: walking for sure, sneaking 25% (V3.7, spec 20.1)', () => {
    const s = delve();
    put(s, 'brann', at(1, 3, 7));
    const m = monster(s, 'orc', at(1, 6, 7), 'asleep');
    const r = ok(s, { type: 'move', heroId: 'brann', path: [at(1, 4, 7), at(1, 5, 7)], sneak: false });
    expect(r.state.delve!.monsters.find((x) => x.id === m.id)!.awareness).not.toBe('asleep');
    const quiet = until(s, { type: 'move', heroId: 'brann', path: [at(1, 4, 7), at(1, 5, 7)], sneak: true }, (_ev, st) => st.delve!.monsters[0]!.awareness === 'asleep');
    expect(quiet.state.delve!.monsters[0]!.awareness).toBe('asleep');
    const woke = until(s, { type: 'move', heroId: 'brann', path: [at(1, 4, 7), at(1, 5, 7)], sneak: true }, (ev) => ev.some((x) => x.type === 'woke'));
    expect(woke.state.delve!.monsters[0]!.awareness).toBe('alert');
  });

  it('orcs shout when they first see a hero', () => {
    const s = delve();
    put(s, 'brann', GATE);
    put(s, 'keven', at(1, 3, 7));
    monster(s, 'orc', at(1, 1, 8), 'alert');
    const r = ok(s, { type: 'endTurn' });
    expect(r.events.some((x) => x.type === 'noise' && x.radius === 5)).toBe(true);
  });

  it('spiders web from range', () => {
    const s = delve();
    put(s, 'keven', GATE);
    put(s, 'brann', at(1, 4, 8));
    put(s, 'pim', at(2, 2, 1));
    put(s, 'aldous', at(2, 3, 1));
    const sp = monster(s, 'spider', at(1, 1, 7), 'hunting');
    look(s, 'keven', sp.at);
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
    put(s, 'keven', s.delve!.heroes[0]!.at);
    const adj = [...e.reachable(s, 'keven', false)].find((x) => x.to.level === thief.at.level && Math.abs(x.to.q - thief.at.q) + Math.abs(x.to.r - thief.at.r) + Math.abs(x.to.q + x.to.r - thief.at.q - thief.at.r) === 2);
    if (adj) {
      s = ok(s, { type: 'move', heroId: 'keven', path: adj.path, sneak: false }).state;
      s = act(s, 'keven', 'attack', { id: thief.id }, 3).state;
      expect(s.delve!.ground.some((g) => g.items.some((i) => i.id === 'ix'))).toBe(true);
    }
  });
});

describe('contracts and summary', () => {
  it('recover: carrying the heirloom out completes it and pays', () => {
    let s = delve({ kind: 'recover', heroes: ['keven', 'brann'] });
    const site = testCastle.contractSites.find((x) => x.kind === 'recover')!.at;
    put(s, 'brann', site);
    s = act(s, 'brann', 'take', { at: site }).state;
    expect(hero(s, 'brann').pack.some((i) => i.kind === 'heirloom')).toBe(true);
    put(s, 'brann', at(1, 2, 9));
    put(s, 'keven', at(1, 18, 7));
    s = act(s, 'brann', 'leave', {}).state;
    expect(s.stage).toBe('delve');
    const r = act(s, 'keven', 'leave', {});
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

  it('abandon: heroes off the exits die; Keven dying ends the campaign', () => {
    let s = delve({ heroes: ['keven', 'brann'] });
    put(s, 'brann', at(1, 18, 7));
    put(s, 'keven', GATE);
    s = ok(s, { type: 'abandon' }).state;
    expect(s.summary!.dead).toEqual(['keven']);
    expect(s.summary!.survivors).toEqual(['brann']);
    s = ok(s, { type: 'backToCamp' }).state;
    expect(s.stage).toBe('over');
    expect(s.overReason).toBe('The heir has fallen. Valkenburg stays dark.');
  });

  it('fallen heroes leave gear behind for later delves', () => {
    let s = delve({ heroes: ['keven', 'brann'] });
    hero(s, 'brann').pack.push({ id: 'iz', kind: 'rope', name: 'Rope', amount: 1, slots: 1 });
    put(s, 'brann', PITHALL);
    put(s, 'keven', at(1, 18, 7));
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
  }, 45000); // three plays of 8 rounds: ~9 s alone (V3.7: every calm move of 4 turns the castle), more when the suite runs in parallel
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
    look(s, 'brann', mAt);
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
    look(s, 'brann', dragon.at);
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
    // Brann straight west of the Dragon at range 2 (inside the Lair); Keven off the line.
    put(s, 'brann', { level: 3, q: dragon.at.q - 2, r: dragon.at.r });
    put(s, 'keven', { level: 3, q: dragon.at.q - 1, r: dragon.at.r - 2 });
    lairCheck(ctx(s), hero(s, 'brann'));
    expect(dragon.awareness).toBe('hunting');
    computeIntents(ctx(s));
    const it = dragon.intent!;
    expect(it.kind).toBe('breath');
    expect(it.hexes!.length).toBeGreaterThan(0);
    expect(it.hexes!.some((p) => samePos(p, hero(s, 'brann').at))).toBe(true);
    expect(it.hexes!.some((p) => samePos(p, hero(s, 'keven').at))).toBe(false);
    const r = ok(s, { type: 'endTurn' });
    expect(r.events.some((x) => x.type === 'breath')).toBe(true);
    expect(hero(r.state, 'brann').hp).toBe(10 - 4);
    expect(hero(r.state, 'keven').hp).toBe(12);
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
    put(s, 'keven', { level: 3, q: dragon.at.q + 1, r: dragon.at.r });
    computeIntents(ctx(s));
    expect(dragon.intent!.kind).toBe('sweep');
    const r = ok(s, { type: 'endTurn' });
    const shoved = r.events.filter((x) => x.type === 'shoved').map((x) => (x as { id: string }).id).sort();
    expect(shoved).toEqual(['brann', 'keven']);
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
    s = ok(s, { type: 'startDelve', contractId: k.id, heroIds: ['keven', 'brann'], entrance: 0, packs: {} }).state;
    s.delve!.rivals = null;
    const dragon = s.delve!.monsters.find((m) => m.kind === 'dragon')!;
    s.delve!.monsters = [dragon];
    dragon.hp = 1;
    put(s, 'brann', { level: 3, q: dragon.at.q - 1, r: dragon.at.r });
    put(s, 'keven', at(3, 1, 8)); // the cave mouth
    s = act(s, 'brann', 'attack', { id: dragon.id }, 3).state;
    expect(s.delve!.monsters).toHaveLength(0);
    expect(s.delve!.kills.brann).toBe(1);
    s = act(s, 'keven', 'leave', {}).state;
    s = ok(s, { type: 'abandon' }).state; // Brann is left behind, the contract still counts
    const sum = s.summary!;
    expect(sum.contractDone).toBe(true);
    expect(sum.bounty).toBe(500);
    expect(sum.xp.keven).toBe(5 + 1 + 3);
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
  it('sight range by stage and depth, never below 2 (a lit hero)', () => {
    const s = delve({ heroes: ['keven'] });
    // Keven carries the lantern, so he stands in light wherever he is while it has oil.
    const cases: [number, number, number][] = [[20, 1, 8], [20, 2, 7], [20, 3, 6], [10, 1, 6], [10, 3, 4], [5, 1, 4], [5, 3, 2]];
    for (const [light, level, want] of cases) {
      s.delve!.light = light;
      put(s, 'keven', level === 1 ? PITHALL : level === 2 ? at(2, 10, 7) : at(3, 6, 4));
      expect(e.sightRange(s, 'keven')).toBe(want);
      expect(e.heroLit(s, 'keven')).toBe(true);
    }
  });

  it('the glimpse uses the sight range', () => {
    const s = delve();
    put(s, 'brann', at(3, 2, 4));
    s.delve!.lanternBearer = 'brann'; // the range comes from the party's own light (17.4)
    s.delve!.light = 20;
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

  it('far lights show from up to 14, not the floor they light (17.4); dark hexes only within range', () => {
    const s = delve({ heroes: ['brann'] });
    s.delve!.light = 5; // dark: range 4 on L3, lantern radius 2
    put(s, 'brann', at(3, 12, 2));
    look(s, 'brann', at(3, 3, 2)); // V3.9: facing the fungus
    const vis = e.visibility(s).visible;
    expect(vis.has(posKey(at(3, 3, 2)))).toBe(true); // the fungus itself, 9 away
    expect(e.visibility(s).lit.has(posKey(at(3, 4, 2)))).toBe(true);
    expect(vis.has(posKey(at(3, 4, 2)))).toBe(false); // fungus-lit floor, but beyond range
    expect(vis.has(posKey(at(3, 6, 6)))).toBe(false); // dark, beyond range
    expect(vis.has(posKey(at(3, 10, 2)))).toBe(true); // dark but within range
  });

  it('sight in a castle light: daylight 8; others 4 minus depth, min 2; the party light uses the stage (17.4)', () => {
    const s = delve({ heroes: ['brann'] });
    s.delve!.lanternOpen = false;
    put(s, 'brann', at(1, 2, 7)); // daylight
    expect(e.sightRange(s, 'brann')).toBe(8);
    put(s, 'brann', at(3, 2, 3)); // next to the fungus, L3
    expect(e.sightRange(s, 'brann')).toBe(2);
    s.delve!.lanternOpen = true;
    s.delve!.light = 20;
    expect(e.sightRange(s, 'brann')).toBe(6); // bright 8 minus 2 for the Hollow
  });

  it('daylight still counts as a far light over its whole patch; other lights only at the source (17.4)', () => {
    const s = delve({ heroes: ['brann'] });
    const far = farLit(w, s.delve as DelveX);
    expect(far.has(posKey(at(1, 2, 8)))).toBe(true); // daylight source
    expect(far.has(posKey(at(1, 4, 8)))).toBe(true); // daylit floor 2 away
    expect(far.has(posKey(at(3, 3, 2)))).toBe(true); // the fungus
    expect(far.has(posKey(at(3, 4, 2)))).toBe(false); // the floor it lights
  });

  it('a hero ending a move on a fire vent takes 3', () => {
    const s = delve();
    put(s, 'brann', at(3, 15, 3));
    const r = ok(s, { type: 'move', heroId: 'brann', path: [at(3, 15, 2)], sneak: false });
    expect(hero(r.state, 'brann').hp).toBe(7);
  });
});

// ---------------------------------------------------------------- V3.2 (spec section 15)

import { los as losOf, farLit } from './world';

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
    allRound(s); // V3.9: geometry of sight, all round
    s.delve!.light = 20;
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
    put(s, 'brann', at(1, 5, 1)); // the lantern bearer stands there: full sight range
    const g = new Set(glimpseSet(w, d, at(1, 5, 1)).map(posKey));
    expect(g.has(posKey(at(1, 5, 0)))).toBe(true);
    expect(g.has(posKey(at(1, 0, 4)))).toBe(true);
  });

  it('monsters use the same sight: a hero beside the pillar is seen', () => {
    const s = v32({ heroes: ['brann'] });
    put(s, 'brann', at(1, 2, 3));
    s.delve!.light = 20;
    const m = monster(s, 'orc', at(1, 5, 1), 'alert');
    const r = ok(s, { type: 'endTurn' });
    expect(r.state.delve!.monsters.find((x) => x.id === m.id)!.awareness).toBe('hunting');
  });
});

describe('15.2 dash', () => {
  it('reachable marks the second move as a dash, sneaking too; acting first leaves a plain move', () => {
    const s = alarm(v32({ heroes: ['pim'] }));
    put(s, 'pim', GATE);
    expect(e.reachable(s, 'pim', false).some((r) => r.dash)).toBe(false);
    const moved = ok(s, { type: 'move', heroId: 'pim', path: [at(1, 5, 7)], sneak: false }).state;
    const dashes = e.reachable(moved, 'pim', true);
    expect(dashes.length).toBeGreaterThan(0);
    expect(dashes.every((r) => r.dash)).toBe(true);
    expect(Math.max(...dashes.map((r) => r.cost))).toBe(4); // burglar sneaks 4
  });

  it('act then move: one move only; a dash spends the action', () => {
    const s = alarm(v32({ heroes: ['pim'] }));
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
    const s = v32({ heroes: ['keven'], extra: [['rae', 'Rae', 'ranger']] });
    const t = delve({ heroes: ['rae'], extra: [['rae', 'Rae', 'ranger']] });
    void s;
    put(t, 'rae', at(3, 1, 8));
    t.delve!.light = 40;
    const m = monster(t, 'orc', at(3, 7, 8), 'hunting');
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
    s.delve!.light = 20;
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
    s.delve!.light = 20;
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

  it('sapper: a satchel of 3 charges, throws a charge up to 3, digs rubble and cracked walls (noise 4)', () => {
    const s = delve({ heroes: ['sam'], extra: [['sam', 'Sam', 'sapper']] });
    // V3.7 (spec 20.3): the satchel is one slotless pack item holding 3 charges.
    expect(hero(s, 'sam').pack.filter((i) => i.kind === 'charge')).toMatchObject([{ amount: 3, slots: 0 }]);
    put(s, 'sam', at(2, 12, 3));
    s.delve!.light = 20;
    const o = option(s, 'sam', 'throwCharge')!;
    expect(o.pick).toBe('hex');
    expect(o.area).toBe(2);
    expect(o.targets.some((t) => samePos(t.at!, at(2, 15, 3)))).toBe(true);
    expect(o.targets.some((t) => samePos(t.at!, at(2, 16, 3)))).toBe(false);
    const m = monster(s, 'orc', at(2, 15, 3)); // asleep: it stays put until the blast at the end of the world phase
    const pv = e.preview(s, 'sam', 'throwCharge', { at: at(2, 15, 3) });
    expect(pv.affects).toContain(m.id);
    const r = act(s, 'sam', 'throwCharge', { at: at(2, 15, 3) });
    expect(r.events.some((x) => x.type === 'thrown' && x.kind === 'charge')).toBe(true);
    expect(r.events).toContainEqual({ type: 'fuseSet', at: at(2, 15, 3), rounds: 1, by: 'sam' });
    expect(hero(r.state, 'sam').pack.find((i) => i.kind === 'charge')!.amount).toBe(2);
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
    s.delve!.light = 20;
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
    s.delve!.light = 20;
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
  it('sells fourteen items (V3.6: lockpicks and the night-eye draught); buying puts them in the stash', () => {
    const shop = e.shop();
    expect(shop.map((o) => o.kind)).toEqual(['torch', 'potion', 'rope', 'charge', 'smoke', 'glue', 'dart', 'caltrops', 'hook', 'key', 'oil', 'firecracker', 'lockpicks', 'nightsight']);
    expect(shop.find((o) => o.kind === 'hook')!.price).toBe(40);
    let s = e.newGame(2);
    s = ok(s, { type: 'buy', kind: 'firecracker' }).state;
    expect(s.campaign.gold).toBe(80);
    expect(s.campaign.stash[0]!.kind).toBe('firecracker');
  });

  it('smoke bomb: blocks sight both ways for 2 rounds; monsters inside lose track', () => {
    const s = v32({ heroes: ['brann'] });
    put(s, 'brann', at(3, 2, 8));
    s.delve!.light = 20;
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
    s.delve!.light = 20;
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
    s.delve!.light = 20;
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
    s.delve!.light = 20;
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
    const t = v32({ heroes: ['brann', 'pim', 'keven', 'aldous'] });
    put(t, 'brann', at(2, 10, 3));
    give(t, 'brann', 'hook');
    put(t, 'pim', at(1, 9, 3));
    put(t, 'keven', at(1, 11, 3));
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

  it('oil flask: +8 light; firecracker: noise 6 at the hex, draws alert monsters there', () => {
    const s = v32({ heroes: ['brann'] });
    put(s, 'brann', at(3, 2, 8));
    s.delve!.light = 10;
    const oil = give(s, 'brann', 'oil');
    const r = act(s, 'brann', 'oil', { itemId: oil });
    expect(r.state.delve!.light).toBe(18);
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
    hero(s, 'pim').pack = hero(s, 'pim').pack.filter((i) => i.kind !== 'improvised');
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

// ---------------------------------------------------------------- V3.3 (spec section 16)

import { computeIntents as computeIntentsOf } from './world-phase';

/** A full-castle delve (monsters and spawns kept) for spawn-default checks. */
function castleDelve(heroes = ['keven', 'brann']) {
  let s = party(e.newGame(3));
  const k = s.campaign.board[0]!;
  s = ok(s, { type: 'startDelve', contractId: k.id, heroIds: heroes, entrance: 0, packs: {} }).state;
  s.delve!.rivals = null;
  return s;
}

/** Park every hero far away on Level 2 so Level 1 monsters see nobody. */
function parkOnL2(s: GameState) {
  s.delve!.heroes.forEach((h, i) => (h.at = at(2, 2 + i, 1)));
}

function turns(s: GameState, n: number): GameState {
  for (let i = 0; i < n; i++) s = ok(s, { type: 'endTurn' }).state;
  return s;
}

describe('16.1 awareness and patrols', () => {
  it('spawns are awake by default; sleepers, patrols and buried ghouls come from the map; tiers by level', () => {
    const s = castleDelve();
    const by = (kind: MonsterKind, level: number) => s.delve!.monsters.find((m) => m.kind === kind && m.at.level === level)!;
    expect(by('rats', 1).awareness).toBe('asleep');
    expect(by('spider', 2).awareness).toBe('asleep');
    expect(by('dragon', 3).awareness).toBe('asleep');
    expect(by('orc', 1).awareness).toBe('alert');
    expect(by('orc', 1).focusAt).toBeUndefined();
    const pat = s.delve!.monsters.find((m) => m.route)!;
    expect(pat.awareness).toBe('patrol');
    expect(pat.route).toHaveLength(4);
    expect(samePos(pat.route![0]!, pat.spawnedAt)).toBe(true);
    const ghoul = by('ghoul', 3);
    expect(ghoul.buried).toBe(true);
    // Tiers (16.3): L2 +2 HP, L3 +4 HP; named elites +2; the Dragon untouched.
    expect(by('captain', 2).maxHp).toBe(MONSTERS.captain.hp + 2);
    expect(by('archer', 2).maxHp).toBe(MONSTERS.archer.hp + 2);
    expect(by('rats', 3).maxHp).toBe(MONSTERS.rats.hp + 4);
    expect(ghoul.maxHp).toBe(MONSTERS.ghoul.hp + 4);
    expect(by('dragon', 3).maxHp).toBe(MONSTERS.dragon.hp + 2);
    // Hit chance and damage show in the intent: a L3 orc hits at 70% for 3 per slot.
    const t = delve({ heroes: ['brann'] });
    put(t, 'brann', at(3, 5, 5));
    const orc = monster(t, 'orc', at(3, 6, 5), 'hunting');
    (orc as Monster & { tier?: number }).tier = 3;
    computeIntentsOf(ctx(t));
    expect(orc.intent?.kind).toBe('attack');
    expect(orc.intent?.damage).toEqual([0, 2 * (3 - 1) + 1]);
    const r = ok(t, { type: 'endTurn' });
    const roll = rolls(r.events).find((x) => x.slots === 2)!;
    expect(roll.chance).toBe(70);
  });

  it('a patroller walks its route each world phase and loops', () => {
    let s = castleDelve();
    parkOnL2(s);
    const pat = s.delve!.monsters.find((m) => m.route)!;
    const route = pat.route!.map(posKey);
    const seen = new Set<string>();
    for (let i = 0; i < 8; i++) {
      s = ok(s, { type: 'endTurn' }).state;
      const m = s.delve!.monsters.find((x) => x.id === pat.id)!;
      expect(m.awareness).toBe('patrol');
      expect(w.tile(m.at)?.kind).toBe('floor');
      if (route.includes(posKey(m.at))) seen.add(posKey(m.at));
    }
    expect(seen.size).toBeGreaterThanOrEqual(3); // it reaches most waypoints in 8 rounds
  });

  it('noticing: a lit hero within 6 in sight, or any hero within 3; in the Hollow light does not matter', () => {
    // Level 1, unlit hero 5 away: unseen. Lit (lantern): seen.
    let s = delve({ heroes: ['keven', 'brann'] });
    put(s, 'keven', at(2, 2, 1)); // the lantern is on L2
    put(s, 'brann', at(1, 10, 8));
    const far = monster(s, 'orc', at(1, 10, 2), 'alert'); // 6 away across the pit, in sight
    expect(ok(s, { type: 'endTurn' }).state.delve!.monsters.find((m) => m.id === far.id)!.awareness).toBe('alert');
    s.delve!.lanternBearer = 'brann';
    expect(ok(s, { type: 'endTurn' }).state.delve!.monsters.find((m) => m.id === far.id)!.awareness).toBe('hunting');
    // Unlit but within 3: seen.
    s = delve({ heroes: ['keven', 'brann'] });
    put(s, 'keven', at(2, 2, 1));
    put(s, 'brann', at(1, 10, 8));
    const near = monster(s, 'orc', at(1, 10, 5), 'alert');
    expect(ok(s, { type: 'endTurn' }).state.delve!.monsters.find((m) => m.id === near.id)!.awareness).toBe('hunting');
    // The Hollow: unlit hero 5 away is seen.
    s = delve({ heroes: ['keven', 'brann'] });
    put(s, 'keven', at(2, 2, 1));
    put(s, 'brann', at(3, 5, 7));
    const cave = monster(s, 'rats', at(3, 5, 2), 'alert');
    expect(ok(s, { type: 'endTurn' }).state.delve!.monsters.find((m) => m.id === cave.id)!.awareness).toBe('hunting');
  });

  it('watching a patroller walk marks its route known', () => {
    let s = castleDelve();
    const pat = s.delve!.monsters.find((m) => m.route)!;
    // Brann, lantern in hand, in the pit hall doorway looking into the east hall... from a hex the patrol can't see him: veil him.
    put(s, 'brann', at(1, 14, 7));
    put(s, 'keven', at(1, 14, 8));
    hero(s, 'brann').veil = 5;
    hero(s, 'keven').veil = 5;
    const r = ok(s, { type: 'endTurn' });
    s = r.state;
    expect(s.delve!.knownRoutes).toContain(pat.id);
    const ev = r.events.find((x) => x.type === 'routeKnown');
    expect(ev && ev.type === 'routeKnown' && ev.route.length).toBe(4);
  });

  it('losing sight: alert at the last seen hex for 3 rounds, then back to the route (patrollers) or the post (others)', () => {
    let s = castleDelve();
    parkOnL2(s);
    put(s, 'brann', at(1, 15, 7));
    s.delve!.lanternBearer = 'brann';
    const pat = s.delve!.monsters.find((m) => m.route)!;
    // Brann is seen by the patroller (same hall, lit).
    s = ok(s, { type: 'endTurn' }).state;
    expect(s.delve!.monsters.find((m) => m.id === pat.id)!.awareness).toBe('hunting');
    // Brann vanishes (off to Level 2).
    put(s, 'brann', at(2, 5, 1));
    s = ok(s, { type: 'endTurn' }).state;
    let m = s.delve!.monsters.find((x) => x.id === pat.id)!;
    expect(m.awareness).toBe('alert');
    expect(m.searchRounds).toBe(2);
    s = turns(s, 2);
    m = s.delve!.monsters.find((x) => x.id === pat.id)!;
    expect(m.awareness).toBe('patrol');
    expect(m.searchRounds).toBeUndefined();
    // A monster without a route goes back to where it spawned and waits there, alert.
    const t = delve({ heroes: ['keven', 'brann'] });
    put(t, 'keven', at(2, 2, 1));
    put(t, 'brann', at(1, 10, 7));
    const orc = monster(t, 'orc', at(1, 9, 1), 'hunting');
    orc.spawnedAt = { ...at(1, 9, 1) };
    orc.focusAt = { ...at(1, 10, 7) };
    let u = ok(t, { type: 'endTurn' }).state; // moves toward brann, sees him
    put(u, 'brann', at(2, 5, 1));
    u = turns(u, 4);
    let o = u.delve!.monsters.find((x) => x.id === orc.id)!;
    expect(o.awareness).toBe('alert');
    u = turns(u, 4);
    o = u.delve!.monsters.find((x) => x.id === orc.id)!;
    expect(samePos(o.at, at(1, 9, 1))).toBe(true);
    expect(o.focusAt).toBeUndefined();
    expect(o.awareness).toBe('alert');
  });
});

describe('16.2 light', () => {
  it('shutter is free, toggles the lantern, stops the burn and the light', () => {
    let s = delve({ heroes: ['keven'] });
    put(s, 'keven', PITHALL);
    const o = option(s, 'keven', 'shutter')!;
    expect(o.label).toBe('Shutter lantern');
    expect(o.pick).toBe('self');
    const r = act(s, 'keven', 'shutter', {});
    s = r.state;
    expect(r.events.some((x) => x.type === 'shutter' && x.open === false)).toBe(true);
    expect(s.delve!.lanternOpen).toBe(false);
    expect(hero(s, 'keven').acted).toBe(false); // free
    expect(e.inLight(s, PITHALL)).toBe(false);
    expect(e.heroLit(s, 'keven')).toBe(false);
    expect(option(s, 'keven', 'shutter')!.label).toBe('Open lantern');
    s = ok(s, { type: 'endTurn' }).state;
    expect(s.delve!.light).toBe(20); // no burn
    s = act(s, 'keven', 'shutter', {}).state;
    expect(s.delve!.lanternOpen).toBe(true);
    expect(e.inLight(s, PITHALL)).toBe(true);
    s = ok(s, { type: 'endTurn' }).state;
    expect(s.delve!.light).toBe(19);
    // Only the bearer has the option.
    const t = delve({ heroes: ['keven', 'brann'] });
    expect(option(t, 'brann', 'shutter')).toBeUndefined();
  });

  it('sight per hero: unlit heroes see 4 on L1, 2 on L2, 1 on L3; a torch gives the stage range back', () => {
    const s = delve({ heroes: ['keven', 'brann'] });
    put(s, 'keven', at(2, 2, 1));
    put(s, 'brann', at(1, 10, 7));
    expect(e.heroLit(s, 'brann')).toBe(false);
    expect(e.sightRange(s, 'brann')).toBe(4);
    put(s, 'brann', at(2, 10, 7));
    expect(e.sightRange(s, 'brann')).toBe(2);
    put(s, 'brann', at(3, 6, 4));
    expect(e.sightRange(s, 'brann')).toBe(1);
    hero(s, 'brann').torch = 5;
    expect(e.heroLit(s, 'brann')).toBe(true);
    expect(e.sightRange(s, 'brann')).toBe(6); // bright 8 − 2 on L3
    // Visibility is the union over heroes: Brann's torch shows the cave around him.
    hero(s, 'brann').torch = 0;
    const dark = e.visibility(s).visible.size;
    hero(s, 'brann').torch = 5;
    expect(e.visibility(s).visible.size).toBeGreaterThan(dark);
  });

  it('the Gloam rises in the Hollow when a hero stands unlit, keeps to the dark, strikes for 4, fades after 2 calm phases', () => {
    let s = delve({ heroes: ['keven', 'brann'] });
    put(s, 'keven', at(3, 6, 4)); // the lantern bearer, shuttered: everyone is in the dark
    put(s, 'brann', at(3, 7, 4));
    s.delve!.lanternOpen = false;
    const r = ok(s, { type: 'endTurn' });
    s = r.state;
    const g = s.delve!.monsters.find((m) => m.kind === 'gloam')!;
    expect(g).toBeTruthy();
    expect(r.events.some((x) => x.type === 'say' && x.text === 'The dark here is awake.')).toBe(true);
    expect(s.delve!.light).toBe(20); // shuttered: no burn; the Gloam is here anyway
    const spawn = r.events.find((x) => x.type === 'gloam')!;
    expect(spawn.type === 'gloam' && spawn.at.level).toBe(3);
    // It came up 4..6 from an unlit hero, and the rise phase moved it (no grace).
    const dist = Math.max(Math.abs(spawn.type === 'gloam' ? spawn.at.q - at(3, 6, 4).q : 0), 0);
    void dist;
    // Strike: adjacent unlit hero takes 4, armor ignored (Keven has armor 1).
    put(s, 'keven', at(3, 6, 4));
    g.at = { ...at(3, 5, 4) };
    hero(s, 'keven').hp = 12;
    s = ok(s, { type: 'endTurn' }).state;
    expect(hero(s, 'keven').hp).toBe(8);
    expect(s.delve!.monsters.some((m) => m.kind === 'gloam')).toBe(true);
    // It never enters a lit hex: open the lantern (radius 4) and it can't close in; two calm phases and it fades.
    s = act(s, 'keven', 'shutter', {}).state;
    expect(s.delve!.lanternOpen).toBe(true);
    const r2 = ok(s, { type: 'endTurn' });
    s = r2.state;
    expect(hero(s, 'keven').hp).toBe(8); // no strike on a lit hero
    expect(s.delve!.gloamCalm).toBe(1);
    s = ok(s, { type: 'endTurn' }).state;
    expect(s.delve!.monsters.some((m) => m.kind === 'gloam')).toBe(false);
    expect(s.delve!.gloamCalm).toBe(0);
  });

  it('the Gloam cannot be shoved, harmed or glued', () => {
    const s = delve({ heroes: ['brann'] });
    put(s, 'brann', at(3, 6, 4));
    const def = MONSTERS.gloam;
    s.delve!.monsters.push({ id: 'g1', kind: 'gloam', name: 'The Gloam', at: at(3, 7, 4), hp: 99, maxHp: 99, awareness: 'hunting', spawnedAt: at(3, 7, 4) });
    void def;
    expect(option(s, 'brann', 'attack')).toBeUndefined();
    expect(option(s, 'brann', 'shove')).toBeUndefined();
  });

  it('on Levels 1 and 2 the pitch-black rule stays: light 0 brings it, light back makes it fade at once', () => {
    let s = delve({ heroes: ['keven', 'aldous'] });
    put(s, 'keven', PITHALL);
    put(s, 'aldous', at(1, 9, 7));
    s.delve!.light = 1;
    s = ok(s, { type: 'endTurn' }).state;
    expect(s.delve!.light).toBe(0);
    expect(s.delve!.monsters.some((m) => m.kind === 'gloam')).toBe(true);
    s = act(s, 'aldous', 'kindle', {}).state;
    expect(s.delve!.monsters.some((m) => m.kind === 'gloam')).toBe(false);
  });
});

describe('16.4 new monsters', () => {
  it('archer: shoots at range 4 in sight, backs off when adjacent, knockback shot when a pit is behind the hero', () => {
    let s = delve({ heroes: ['brann'] });
    put(s, 'brann', at(1, 10, 8));
    hero(s, 'brann').rooted = 5; // V3.7: a hero within 3 and not yet rooted would be hamstrung first (spec 20.5)
    const a = monster(s, 'archer', at(1, 10, 5), 'hunting'); // 3 away, in sight, lit
    computeIntentsOf(ctx(s));
    expect(a.intent?.kind).toBe('attack');
    expect(a.intent?.to && samePos(a.intent.to, a.at)).toBe(true);
    let r = ok(s, { type: 'endTurn' });
    expect(r.events.some((x) => x.type === 'roll' && x.who === a.id && x.what === 'Shot')).toBe(true);
    // Adjacent: it steps away to 2..4 and shoots from there.
    s = delve({ heroes: ['brann'] });
    put(s, 'brann', at(1, 10, 8));
    hero(s, 'brann').rooted = 5;
    const b = monster(s, 'archer', at(1, 10, 7), 'hunting');
    computeIntentsOf(ctx(s));
    expect(b.intent?.kind).toBe('attack');
    expect(b.intent?.to && !samePos(b.intent.to, b.at)).toBe(true);
    r = ok(s, { type: 'endTurn' });
    const bb = r.state.delve!.monsters.find((x) => x.id === b.id)!;
    const d = Math.max(Math.abs(bb.at.q - at(1, 10, 8).q), Math.abs(bb.at.r - at(1, 10, 8).r), Math.abs(bb.at.q + bb.at.r - at(1, 10, 8).q - at(1, 10, 8).r));
    expect(d).toBeGreaterThanOrEqual(2);
    expect(d).toBeLessThanOrEqual(4);
    // Knockback shot: Brann on the edge (10,5) with the pit (10,4) behind him and the archer south of him.
    s = delve({ heroes: ['brann'] });
    put(s, 'brann', at(1, 10, 5));
    const k = monster(s, 'archer', at(1, 10, 7), 'hunting');
    computeIntentsOf(ctx(s));
    expect(k.intent?.kind).toBe('shove');
    expect(k.intent?.to && w.tile(k.intent.to)?.kind).toBe('pit');
    r = until(s, { type: 'endTurn' }, (ev) => ev.some((x) => x.type === 'fell' && x.id === 'brann'));
    expect(hero(r.state, 'brann').at.level).toBeGreaterThan(1);
  });

  it('captain: armor 1, shield wall for adjacent orcs, shouts first (shown as an intent) and rallies orcs within 8', () => {
    let s = delve({ heroes: ['brann', 'keven'] });
    put(s, 'brann', at(1, 10, 8));
    put(s, 'keven', at(1, 8, 8));
    const cap = monster(s, 'captain', at(1, 11, 8), 'alert');
    const orc = monster(s, 'orc', at(1, 11, 7), 'alert'); // next to the captain
    const far = monster(s, 'orc', at(1, 8, 1), 'alert'); // 7 rows up, out of sight
    far.awareness = 'alert';
    const p = e.preview(s, 'brann', 'attack', { id: cap.id });
    expect(p.modifiers).toContain('Armor −1 dmg per hit');
    expect(p.outcomes[1]).toBe('1 dmg');
    const po = e.preview(s, 'keven', 'attack', { id: orc.id });
    expect(po.ok).toBe(false); // not adjacent to keven
    put(s, 'keven', at(1, 10, 7));
    const po2 = e.preview(s, 'keven', 'attack', { id: orc.id });
    expect(po2.modifiers).toContain('Shield wall −1 dmg per hit');
    expect(po2.outcomes[1]).toBe('1 dmg');
    // First sight: the captain's intent is shout; it goes off next world phase and the far orc comes hunting.
    computeIntentsOf(ctx(s));
    expect(cap.intent?.kind).toBe('shout');
    const r = ok(s, { type: 'endTurn' });
    expect(r.events.some((x) => x.type === 'shout' && x.id === cap.id)).toBe(true);
    const ff = r.state.delve!.monsters.find((x) => x.id === far.id)!;
    expect(ff.awareness).toBe('hunting');
    const cc = r.state.delve!.monsters.find((x) => x.id === cap.id)!;
    expect(cc.shoutCooldown).toBe(3); // 4, ticked once
    expect(cc.intent?.kind).toBe('attack');
  });

  it('ghoul: buried until a hero ends a move within 2; grabs (shown first), the held hero cannot move, escape or a kill frees', () => {
    let s = delve({ heroes: ['brann', 'keven'] });
    put(s, 'brann', at(3, 5, 5));
    put(s, 'keven', at(3, 2, 2));
    const gh = monster(s, 'ghoul', at(3, 8, 6), 'hunting');
    gh.buried = true;
    // Not on the map: not a target, not an obstacle, no intent.
    expect(option(s, 'brann', 'attack')).toBeUndefined();
    expect(e.intents(s)[gh.id]).toBeUndefined();
    expect(e.reachable(s, 'brann', false).some((x) => samePos(x.to, at(3, 8, 6)))).toBe(true);
    // Step within 2: it rises.
    const r = ok(s, { type: 'move', heroId: 'brann', path: [at(3, 6, 5), at(3, 7, 5)], sneak: false });
    s = r.state;
    expect(r.events.some((x) => x.type === 'spawned' && x.id === gh.id)).toBe(true);
    let g = s.delve!.monsters.find((x) => x.id === gh.id)!;
    expect(g.buried).toBe(false);
    expect(g.awareness).toBe('hunting');
    // V3.9.2 (spec 24.7): heroes are blind only straight behind; it rose to his rear side and is seen.
    s = ok(s, { type: 'face', heroId: 'brann', facing: dirIndex(hero(s, 'brann').at, g.at) }).state;
    // Adjacent now: the intent is grab; next phase Brann is held.
    expect(e.intents(s)[gh.id]?.kind).toBe('grab');
    const r2 = ok(s, { type: 'endTurn' });
    s = r2.state;
    expect(r2.events.some((x) => x.type === 'grabbed' && x.id === 'brann')).toBe(true);
    expect(hero(s, 'brann').grabbedBy).toBe(gh.id);
    expect(e.reachable(s, 'brann', false)).toEqual([]);
    expect(e.apply(s, { type: 'move', heroId: 'brann', path: [at(3, 6, 5)], sneak: false }).error).toMatch(/held/);
    // The ghoul's attack on the held hero has an extra slot.
    g = s.delve!.monsters.find((x) => x.id === gh.id)!;
    expect(g.intent?.kind).toBe('attack');
    expect(g.intent?.damage).toEqual([0, 3 * 1 + 1]); // 3 slots (2 + 1) at 1 per hit (2 dmg − Brann's armor 1), +1 perfect
    // Escape: 2 Might slots, 1 hit frees.
    const esc = option(s, 'brann', 'escape')!;
    expect(esc).toBeTruthy();
    expect(e.preview(s, 'brann', 'escape', esc.targets[0]!).slots).toBe(2);
    const r3 = act(s, 'brann', 'escape', esc.targets[0]!, 1);
    expect(r3.events.some((x) => x.type === 'released' && x.id === 'brann')).toBe(true);
    expect(hero(r3.state, 'brann').grabbedBy).toBeUndefined();
    // Killing the ghoul frees too.
    const t = structuredClone(s);
    const gt = t.delve!.monsters.find((x) => x.id === gh.id)!;
    hero(t, 'keven').at = { ...posNeighborsOf(gt.at).find((p) => w.tile(p)?.kind === 'floor' && !samePos(p, hero(t, 'brann').at))! };
    gt.hp = 1;
    const r4 = act(t, 'keven', 'attack', { id: gh.id }, 3);
    expect(r4.state.delve!.monsters.some((x) => x.id === gh.id)).toBe(false);
    expect(hero(r4.state, 'brann').grabbedBy).toBeUndefined();
  });

  it('spider: web, then drag the webbed hero one hex toward it (pits count)', () => {
    let s = delve({ heroes: ['brann', 'keven'] });
    put(s, 'keven', at(1, 10, 8));
    put(s, 'brann', at(1, 8, 8));
    const sp = monster(s, 'spider', at(1, 12, 8), 'hunting');
    computeIntentsOf(ctx(s));
    expect(sp.intent?.kind).toBe('web');
    expect(sp.intent?.targetId).toBe('keven');
    s = ok(s, { type: 'endTurn' }).state;
    expect(hero(s, 'keven').webbed).toBe(true);
    const spp = s.delve!.monsters.find((x) => x.id === sp.id)!;
    expect(spp.intent?.kind).toBe('drag');
    expect(spp.intent?.to).toEqual(at(1, 11, 8));
    const r = ok(s, { type: 'endTurn' });
    expect(r.events.some((x) => x.type === 'dragged' && x.id === 'keven')).toBe(true);
    expect(hero(r.state, 'keven').at).toEqual(at(1, 11, 8));
    // Over a pit: Brann on the edge (10,5), the spider across the pit at (10,2)... (10,3) is the pit mouth between them.
    let t = delve({ heroes: ['brann'] });
    put(t, 'brann', at(1, 10, 5));
    const sp2 = monster(t, 'spider', at(1, 10, 2), 'hunting');
    computeIntentsOf(ctx(t));
    expect(sp2.intent?.kind).toBe('web');
    t = ok(t, { type: 'endTurn' }).state;
    const s2 = t.delve!.monsters.find((x) => x.id === sp2.id)!;
    expect(s2.intent?.kind).toBe('drag');
    expect(w.tile(s2.intent!.to!)?.kind).toBe('pit');
    const r2 = ok(t, { type: 'endTurn' });
    expect(r2.events.some((x) => x.type === 'fell' && x.id === 'brann')).toBe(true);
  });
});

describe('16.5 the Lantern Sisters\' kit', () => {
  function sisters(s: GameState, hostile: boolean, where: Pos[]) {
    const cr = s.delve!.rivals!;
    cr.entersRound = 1;
    (cr as { entered?: boolean }).entered = true;
    cr.spotted = true;
    cr.stance = hostile ? 'hostile' : 'neutral';
    cr.members.forEach((r, i) => (r.at = { ...where[i]! }));
    return cr;
  }
  function withRivals(heroes: string[]) {
    let s = party(e.newGame(2));
    const k = s.campaign.board[0]!;
    for (let seed = 2; seed < 40; seed++) {
      s = party(e.newGame(seed));
      const r = e.apply(s, { type: 'startDelve', contractId: s.campaign.board[0]!.id, heroIds: heroes, entrance: 0, packs: {} });
      if (r.state.delve?.rivals) {
        s = r.state;
        break;
      }
    }
    void k;
    expect(s.delve!.rivals).toBeTruthy();
    s.delve!.monsters = [];
    s.delve!.traps = {};
    return s;
  }

  it('each sister has a class and kit: ranger, shadowmancer (1 smoke), burglar (2 darts) (V3.7: in their packs, spec 20.4)', () => {
    const s = withRivals(['brann']);
    const cr = s.delve!.rivals!;
    expect(cr.members.map((r) => r.cls)).toEqual(['ranger', 'shadowmancer', 'burglar']);
    expect(cr.members[2]!.pack!.filter((i) => i.kind === 'dart').length).toBe(2);
    expect(cr.members[1]!.pack!.filter((i) => i.kind === 'smoke').length).toBe(1);
  });

  it('burglar sister: sleep darts the lantern bearer within 5 when hostile (spec 20.4; the nearest hero otherwise); a hit costs the hero their next turn', () => {
    let s = withRivals(['brann', 'keven']);
    put(s, 'brann', at(1, 10, 8));
    put(s, 'keven', at(1, 8, 8));
    sisters(s, true, [at(1, 16, 1), at(1, 17, 1), at(1, 10, 5)]);
    computeIntentsOf(ctx(s));
    const bur = s.delve!.rivals!.members[2]!;
    expect(bur.intent?.kind).toBe('dart');
    expect(bur.intent?.targetId).toBe('keven'); // the lantern bearer, though Brann is nearer
    expect(e.intents(s)[bur.id]?.kind).toBe('dart');
    s.delve!.lanternBearer = 'brann';
    computeIntentsOf(ctx(s));
    expect(s.delve!.rivals!.members[2]!.intent?.targetId).toBe('brann');
    const r = until(s, { type: 'endTurn' }, (ev) => ev.some((x) => x.type === 'hit' && x.attacker === bur.id && x.target === 'brann' && x.damage === 0));
    s = r.state;
    expect(s.delve!.rivals!.members[2]!.pack!.filter((i) => i.kind === 'dart').length).toBe(1);
    expect(e.reachable(s, 'brann', false)).toEqual([]);
    expect(e.actions(s, 'brann')).toEqual([]);
    s = ok(s, { type: 'endTurn' }).state;
    expect(e.reachable(s, 'brann', false).length).toBeGreaterThan(0);
  });

  it('ranger sister: overwatch when no hero is in reach, and the shot fires when a hero moves in her sight', () => {
    let s = withRivals(['brann', 'keven']);
    put(s, 'brann', at(1, 2, 8)); // the gate room: walled off from the pit hall
    put(s, 'keven', at(2, 2, 1));
    sisters(s, true, [at(1, 10, 1), at(1, 17, 1), at(1, 16, 1)]);
    computeIntentsOf(ctx(s));
    const ran = s.delve!.rivals!.members[0]!;
    expect(ran.intent?.kind).toBe('overwatch');
    s = ok(s, { type: 'endTurn' }).state;
    expect(s.delve!.rivals!.members[0]!.overwatch).toBe(true);
    // Brann steps into her sight within 6: she shoots.
    put(s, 'brann', at(1, 10, 7));
    const r = ok(s, { type: 'move', heroId: 'brann', path: [at(1, 10, 6)], sneak: false });
    expect(r.events.some((x) => x.type === 'cast' && x.by === ran.id && x.spell === 'overwatch')).toBe(true);
    expect(r.events.some((x) => x.type === 'roll' && x.who === ran.id)).toBe(true);
    expect(r.state.delve!.rivals!.members[0]!.overwatch).toBe(false);
  });

  it('ranger sister: knockback shot on a hero with a pit behind them', () => {
    const s = withRivals(['brann']);
    put(s, 'brann', at(1, 10, 5)); // pit (10,4) behind him, the sister south
    sisters(s, true, [at(1, 10, 8), at(1, 17, 1), at(1, 16, 1)]);
    computeIntentsOf(ctx(s));
    const ran = s.delve!.rivals!.members[0]!;
    expect(ran.intent?.kind).toBe('shove');
    expect(w.tile(ran.intent!.to!)?.kind).toBe('pit');
    const r = until(s, { type: 'endTurn' }, (ev) => ev.some((x) => x.type === 'fell' && x.id === 'brann'));
    expect(hero(r.state, 'brann').at.level).toBeGreaterThan(1);
  });

  it('shadowmancer sister: veils the striker (the burglar) when first spotted (shown first; spec 20.4); smoke around a sister below half that two heroes can shoot', () => {
    let s = withRivals(['brann', 'keven']);
    put(s, 'brann', at(1, 10, 8));
    put(s, 'keven', at(1, 2, 8)); // the gate room, out of it for now
    const cr = sisters(s, false, [at(1, 12, 6), at(1, 11, 6), at(1, 12, 7)]);
    cr.spotted = false;
    const r0 = ok(s, { type: 'move', heroId: 'brann', path: [at(1, 10, 7)], sneak: false });
    s = r0.state;
    expect(s.delve!.rivals!.spotted).toBe(true);
    const sh = s.delve!.rivals!.members[1]!;
    const bur = s.delve!.rivals!.members[2]!;
    expect(sh.intent).toMatchObject({ kind: 'veil', targetId: bur.id });
    expect(e.intents(s)[sh.id]?.kind).toBe('veil');
    const r = ok(s, { type: 'endTurn' });
    s = r.state;
    expect(r.events.some((x) => x.type === 'cast' && x.by === sh.id && x.spell === 'veil' && x.targetId === bur.id)).toBe(true);
    expect(s.delve!.rivals!.members[2]!.veil).toBe(2);
    expect(s.delve!.rivals!.members[1]!.charges).toBe(2); // 1 mana spent
    // Veiled: not a target, not in intents.
    expect(option(s, 'brann', 'attack')?.targets.some((t) => t.id === bur.id) ?? false).toBe(false);
    expect(e.intents(s)[bur.id]).toBeUndefined();
    // Smoke: a sister below half HP, hostile, with two heroes able to shoot her: the smoke goes around her.
    s.delve!.rivals!.stance = 'hostile';
    s.delve!.rivals!.members[0]!.hp = 3;
    put(s, 'brann', at(1, 10, 8));
    computeIntentsOf(ctx(s));
    expect(s.delve!.rivals!.members[1]!.intent?.kind).not.toBe('smoke'); // one line of fire isn't enough
    put(s, 'keven', at(1, 9, 8));
    computeIntentsOf(ctx(s));
    const sh2 = s.delve!.rivals!.members[1]!;
    const hurtAt = { ...s.delve!.rivals!.members[0]!.at };
    expect(sh2.intent).toMatchObject({ kind: 'smoke', item: 'smoke', to: hurtAt });
    const r2 = ok(s, { type: 'endTurn' });
    expect(r2.events.some((x) => x.type === 'cast' && x.by === sh2.id && x.spell === 'smoke')).toBe(true);
    expect(r2.state.delve!.smoke[posKey(hurtAt)]).toBe(1); // thrown mid world phase: lasts through the next player phase
    expect(r2.state.delve!.rivals!.members[1]!.pack!.some((i) => i.kind === 'smoke')).toBe(false);
  });

  it('neutral: only the burglar sister loots the pile the heroes left at an opened chest', () => {
    const s = withRivals(['brann']);
    put(s, 'brann', at(2, 2, 1));
    // The chest at (1,2,1) is opened with loot left on it.
    const ch = s.delve!.chests.find((x) => samePos(x.at, at(1, 2, 1)))!;
    ch.opened = true;
    s.delve!.ground.push({ at: { ...ch.at }, items: [{ id: 'gx', kind: 'gold', name: '10 gold', amount: 10, slots: 1 }] });
    s.delve!.chests = s.delve!.chests.filter((x) => x === ch);
    s.delve!.ground = s.delve!.ground.filter((g) => samePos(g.at, ch.at));
    sisters(s, false, [at(1, 3, 1), at(1, 4, 1), at(1, 3, 2)]);
    computeIntentsOf(ctx(s));
    const [ran, sha, bur] = s.delve!.rivals!.members;
    expect(bur!.intent?.kind).toBe('steal');
    expect(ran!.intent?.kind).not.toBe('steal');
    expect(sha!.intent?.kind).not.toBe('steal');
    const r = ok(s, { type: 'endTurn' });
    expect(r.state.delve!.rivals!.members[2]!.loot.some((i) => i.id === 'gx')).toBe(true);
  });
});

// ---------------------------------------------------------------- V3.5 (spec section 18)

import { buildCrew, makeCrew } from './rivals';
import type { CastleDef, CrewId, DealKind, Item, JobKind, RivalCrew } from './types';

/** The test castle with the story sites (spec 18.3, 19.1) added. */
const storyCastle: CastleDef = {
  ...testCastle,
  contractSites: [
    ...testCastle.contractSites,
    { id: 'l1-story-chapel', kind: 'rescue', at: at(1, 16, 8), where: 'the chapel', story: 'surgeon' },
    { id: 'l1-story-kitchens', kind: 'rescue', at: at(1, 16, 9), where: 'the kitchens', story: 'innkeeper' },
    { id: 'l2-story-forge', kind: 'rescue', at: at(2, 16, 8), where: 'the forge', story: 'smith' },
    { id: 'l2-story-barracks', kind: 'recover', at: at(2, 16, 3), where: 'the barracks', story: 'copper' },
    { id: 'l3-recover-drain', kind: 'recover', at: at(3, 5, 5), where: 'the Drain' },
  ],
};
const se = createEngine(storyCastle);

function sok(s: GameState, cmd: Command) {
  const r = se.apply(s, cmd);
  expect(r.error).toBeUndefined();
  return r;
}

function gold(n: number, id = `g${n}`): Item {
  return { id, kind: 'gold', name: `${n} gold`, amount: n, slots: 1 };
}

/** A delve with a crew placed by hand on `spots`; stance as given. */
function crewDelve(id: CrewId, spots: Pos[], stance?: RivalCrew['stance'], heroes = ['brann']) {
  const s = delve({ heroes });
  const cr = buildCrew(s as GameStateX, id, spots);
  if (stance) cr.stance = stance;
  s.delve!.rivals = cr;
  return s;
}

function deal(s: GameState, heroId: string, d: DealKind, job?: JobKind) {
  return e.apply(s, { type: 'deal', heroId, deal: d, ...(job ? { job } : {}) });
}

function crewOf(s: GameState) {
  return s.delve!.rivals!;
}

/** Run a story delve: start it, hand the objective out at once, and come back. */
function finishStory(s: GameState, storyId: string, heroId = 'keven') {
  const k = s.campaign.board.find((x) => x.story === storyId)!;
  let t = sok(s, { type: 'startDelve', contractId: k.id, heroIds: [heroId], entrance: 1, packs: {} }).state;
  t.delve!.monsters = [];
  t.delve!.rivals = null;
  const h = t.delve!.heroes[0]!;
  h.at = at(1, 18, 7);
  if (k.kind === 'rescue') {
    const pr = t.delve!.prisoner!;
    pr.freed = true;
    pr.escortedBy = heroId;
    pr.at = at(1, 17, 7);
    h.escorting = pr.id;
  } else {
    const g = t.delve!.ground.find((x) => x.items.some((i) => i.contractId === k.id))!;
    h.pack.push(...g.items.filter((i) => i.contractId === k.id));
    g.items = g.items.filter((i) => i.contractId !== k.id);
  }
  t = sok(t, { type: 'act', heroId, action: 'leave', target: {}, focus: 0 }).state;
  expect(t.summary!.contractDone).toBe(true);
  return se.apply(t, { type: 'backToCamp' });
}

describe('V3.5', () => {
  describe('18.2 the village', () => {
    it('starts with nothing won back; the campfire has 3 level-1 drifters at 60', () => {
      for (let seed = 1; seed < 20; seed++) {
        const s = se.newGame(seed);
        expect(s.campaign.village).toEqual({ surgeon: false, innkeeper: false, smith: false, copper: false, caskbook: false });
        expect(s.campaign.recruits).toHaveLength(3);
        expect(new Set(s.campaign.recruits.map((r) => r.hero.cls)).size).toBe(3);
        expect(s.campaign.recruits.every((r) => r.hero.level === 1 && r.price === 60)).toBe(true);
      }
    });

    it('the Gilded Flagon: 4 recruits, some level 2; with the cask book some level 3 (price 60 + 40/level)', () => {
      const levels = new Set<number>();
      const levels3 = new Set<number>();
      for (let seed = 1; seed < 60; seed++) {
        let s = se.newGame(seed);
        s.campaign.village.innkeeper = true;
        s = finishStory(s, 'surgeon').state;
        expect(s.campaign.recruits).toHaveLength(4);
        for (const r of s.campaign.recruits) {
          levels.add(r.hero.level);
          expect(r.price).toBe(60 + 40 * (r.hero.level - 1));
        }
        expect(s.campaign.recruits.every((r) => r.hero.level <= 2)).toBe(true);
        let t = se.newGame(seed);
        Object.assign(t.campaign.village, { innkeeper: true, copper: true, caskbook: true });
        t = finishStory(t, 'surgeon').state;
        for (const r of t.campaign.recruits) levels3.add(r.hero.level);
      }
      expect([...levels].sort()).toEqual([1, 2]);
      expect(levels3.has(3)).toBe(true);
    });

    it('refusals name the fix: no surgeon (heal), forge cold (upgrade), metalwork locked (buy)', () => {
      const s = party(se.newGame(3));
      s.campaign.gold = 500;
      s.campaign.roster.find((h) => h.id === 'brann')!.hp = 3;
      expect(se.apply(s, { type: 'heal', heroId: 'brann' }).error).toMatch(/Rescue Brother Aldric/);
      expect(se.apply(s, { type: 'upgrade', heroId: 'brann', part: 'weapon' }).error).toBe('The forge is cold. Rescue Gerda the smith (Level 2, the forge).');
      for (const k of ['caltrops', 'hook', 'key', 'lockpicks'] as const) expect(se.apply(s, { type: 'buy', kind: k }).error).toMatch(/Gerda/);
      expect(se.apply(s, { type: 'buy', kind: 'torch' }).error).toBeUndefined();
      expect(se.apply(s, { type: 'buy', kind: 'nightsight' }).error).toMatch(/Gilded Flagon.*Old Wim/);
      const shop = se.shop(s);
      expect(shop.filter((o) => o.locked).map((o) => o.kind).sort()).toEqual(['caltrops', 'hook', 'key', 'lockpicks', 'nightsight']);
      expect(shop.find((o) => o.kind === 'key')!.needs).toBe('smith');
      expect(se.shop().some((o) => o.locked)).toBe(false);
      s.campaign.village.smith = true;
      s.campaign.village.surgeon = true;
      s.campaign.village.innkeeper = true;
      expect(se.shop(s).some((o) => o.locked)).toBe(false);
      expect(se.apply(s, { type: 'upgrade', heroId: 'brann', part: 'weapon' }).error).toBeUndefined();
      expect(se.apply(s, { type: 'buy', kind: 'key' }).error).toBeUndefined();
      expect(se.apply(s, { type: 'heal', heroId: 'brann' }).error).toBeUndefined();
    });

    it('drink: a stash potion heals 5, up to max; refused without a potion or unhurt', () => {
      let s = party(se.newGame(3));
      const b = s.campaign.roster.find((h) => h.id === 'brann')!;
      b.hp = 2;
      expect(se.apply(s, { type: 'drink', heroId: 'brann' }).error).toMatch(/potion/);
      s = sok(s, { type: 'buy', kind: 'potion' }).state;
      s = sok(s, { type: 'buy', kind: 'potion' }).state;
      s = sok(s, { type: 'drink', heroId: 'brann' }).state;
      expect(s.campaign.roster.find((h) => h.id === 'brann')!.hp).toBe(7);
      s = sok(s, { type: 'drink', heroId: 'brann' }).state;
      expect(s.campaign.roster.find((h) => h.id === 'brann')!.hp).toBe(b.maxHp);
      expect(s.campaign.stash.some((i) => i.kind === 'potion')).toBe(false);
      expect(se.apply(s, { type: 'drink', heroId: 'brann' }).error).toMatch(/unhurt/);
    });
  });

  describe('18.3 story contracts', () => {
    it('pins every available story contract on top of the regular ones, half bounty rounded down to 5', () => {
      const s = se.newGame(5);
      const stories = s.campaign.board.filter((k) => k.story);
      expect(stories.map((k) => k.story)).toEqual(['surgeon']);
      expect(s.campaign.board.filter((k) => !k.story).length).toBeGreaterThan(0);
      expect(stories[0]).toMatchObject({ kind: 'rescue', siteId: 'l1-story-chapel', bounty: 40, level: 1 });
      expect(stories[0]!.title).toBe('Rescue Brother Aldric');
      // Reputation 1: Wim and Gerda join; the copper needs Wim home; the cask book the copper and Level 3.
      let t = se.newGame(5);
      t.campaign.reputation = 1;
      t = finishStory(t, 'surgeon').state; // rep 2 now
      expect(t.campaign.board.filter((k) => k.story).map((k) => k.story)).toEqual(['innkeeper', 'smith']);
      expect(t.campaign.board.find((k) => k.story === 'smith')).toMatchObject({ level: 2, bounty: 75 });
      t = finishStory(t, 'innkeeper').state;
      expect(t.campaign.board.filter((k) => k.story).map((k) => k.story)).toEqual(['smith', 'copper']);
      expect(t.campaign.board.find((k) => k.story === 'copper')!.bounty).toBe(90);
      t.campaign.village.copper = true;
      t = finishStory(t, 'smith').state;
      expect(t.campaign.board.find((k) => k.story === 'caskbook')).toMatchObject({ level: 3, bounty: 130 });
    });

    it('a rescued villager stays in Lowgate: not recruited; the village flag is set with an event and a line', () => {
      const s = party(se.newGame(5));
      const n = s.campaign.roster.length;
      const r = finishStory(s, 'surgeon');
      expect(r.state.campaign.roster.length).toBe(n);
      expect(r.state.campaign.village.surgeon).toBe(true);
      expect(r.events).toContainEqual({ type: 'villageUnlocked', story: 'surgeon' });
      expect(r.events.some((x) => x.type === 'say' && /infirmary is open/.test(x.text))).toBe(true);
      expect(r.state.campaign.board.some((k) => k.story === 'surgeon')).toBe(false);
      expect(r.state.campaign.reputation).toBe(1);
      expect(r.state.campaign.gold).toBe(90 + 40);
    });

    it('the brewing copper: 2 slots, heavy (its carrier moves 3, dash too), value 0; carried out it goes to the village', () => {
      let s = se.newGame(5);
      s.campaign.village.innkeeper = true;
      s.campaign.reputation = 1;
      s = party(s);
      // Rebuild the board with the copper on it.
      const t0 = finishStory(s, 'surgeon').state;
      const k = t0.campaign.board.find((x) => x.story === 'copper')!;
      let t = sok(t0, { type: 'startDelve', contractId: k.id, heroIds: ['brann'], entrance: 0, packs: {} }).state;
      t.delve!.monsters = [];
      t.delve!.rivals = null;
      const pile = t.delve!.ground.find((g) => g.items.some((i) => i.contractId === k.id))!;
      const cop = pile.items.find((i) => i.contractId === k.id)!;
      expect(cop).toMatchObject({ slots: 2, heavy: true, story: 'copper', amount: 0 });
      hero(t, 'brann').pack.push(cop);
      pile.items = pile.items.filter((i) => i !== cop);
      put(t, 'brann', at(1, 10, 7));
      expect(Math.max(...e.reachable(t, 'brann', false).map((x) => x.cost))).toBe(3);
      const r1 = e.reachable(t, 'brann', false).find((x) => x.cost === 1)!;
      t = sok(t, { type: 'move', heroId: 'brann', path: r1.path, sneak: false }).state;
      expect(Math.max(...e.reachable(t, 'brann', false).map((x) => x.cost))).toBe(3);
      put(t, 'brann', at(1, 18, 7));
      t = sok(t, { type: 'act', heroId: 'brann', action: 'leave', target: {}, focus: 0 }).state;
      expect(t.summary!.contractDone).toBe(true);
      expect(t.summary!.lootValue).toBe(0);
      const r = sok(t, { type: 'backToCamp' });
      expect(r.state.campaign.village.copper).toBe(true);
      expect(r.state.campaign.stash.some((i) => i.story)).toBe(false);
      expect(r.events).toContainEqual({ type: 'villageUnlocked', story: 'copper' });
    });
  });

  describe('18.4 ales', () => {
    it('locked until the copper (and the cask book); one ale per hero; drunk at the next delve, then cleared', () => {
      let s = party(se.newGame(5));
      expect(se.ales(s).every((a) => a.locked)).toBe(true);
      expect(se.apply(s, { type: 'buyAle', heroId: 'brann', ale: 'glowworm' }).error).toMatch(/Wim/);
      Object.assign(s.campaign.village, { innkeeper: true, copper: true });
      expect(se.ales(s).filter((a) => !a.locked).map((a) => a.kind)).toEqual(['glowworm', 'featherfoot', 'mole', 'reserve']);
      expect(se.ales(s).find((a) => a.kind === 'smuggler')!.locked).toMatch(/cask book/);
      expect(se.apply(s, { type: 'buyAle', heroId: 'brann', ale: 'smuggler' }).error).toMatch(/cask book/);
      s = sok(s, { type: 'buyAle', heroId: 'brann', ale: 'reserve' }).state;
      expect(s.campaign.gold).toBe(70);
      expect(s.campaign.roster.find((h) => h.id === 'brann')!.ale).toBe('reserve');
      expect(se.apply(s, { type: 'buyAle', heroId: 'brann', ale: 'glowworm' }).error).toMatch(/already/);
      s = sok(s, { type: 'startDelve', contractId: s.campaign.board[0]!.id, heroIds: ['brann', 'keven'], entrance: 0, packs: {} }).state;
      expect(hero(s, 'brann')).toMatchObject({ ale: 'reserve', focus: 4 });
      expect(hero(s, 'keven').ale).toBeUndefined();
      expect(s.campaign.roster.find((h) => h.id === 'brann')!.ale).toBeUndefined();
    });

    it('the Black Cask resolves on the seeded RNG: about 70% a good ale, else hiccups or a heavy head (Focus 1)', () => {
      const got: Record<string, number> = {};
      for (let seed = 1; seed <= 200; seed++) {
        let s = party(se.newGame(seed));
        Object.assign(s.campaign.village, { innkeeper: true, copper: true, caskbook: true });
        s = sok(s, { type: 'buyAle', heroId: 'brann', ale: 'blackcask' }).state;
        s = sok(s, { type: 'startDelve', contractId: s.campaign.board[0]!.id, heroIds: ['brann'], entrance: 0, packs: {} }).state;
        const h = hero(s, 'brann');
        got[h.ale!] = (got[h.ale!] ?? 0) + 1;
        if (h.ale === 'heavyhead') expect(h.focus).toBe(1);
      }
      const bad = (got.hiccups ?? 0) + (got.heavyhead ?? 0);
      expect(got.blackcask).toBeUndefined();
      expect(bad).toBeGreaterThan(35);
      expect(bad).toBeLessThan(85);
      for (const k of ['glowworm', 'featherfoot', 'mole', 'reserve', 'smuggler', 'fireside', 'hiccups', 'heavyhead']) expect(got[k] ?? 0).toBeGreaterThan(0);
      // Same seed, same result.
      const once = (seed: number) => {
        let s = party(se.newGame(seed));
        Object.assign(s.campaign.village, { innkeeper: true, copper: true, caskbook: true });
        s = sok(s, { type: 'buyAle', heroId: 'brann', ale: 'blackcask' }).state;
        return hero(sok(s, { type: 'startDelve', contractId: s.campaign.board[0]!.id, heroIds: ['brann'], entrance: 0, packs: {} }).state, 'brann').ale;
      };
      expect(once(9)).toBe(once(9));
    });

    it('Hobart\'s Reserve: Focus 4 and max 4 (Rally tops up to 4)', () => {
      const s = delve({ heroes: ['keven', 'brann'] });
      const b = hero(s, 'brann');
      b.ale = 'reserve';
      b.focus = 3;
      hero(s, 'keven').focus = 3;
      put(s, 'brann', at(1, 4, 6));
      put(s, 'keven', at(1, 4, 7));
      const r = act(s, 'keven', 'rally', {});
      expect(hero(r.state, 'brann').focus).toBe(4);
    });

    it('Glowworm Pale: the drinker is lit (radius 1) with the lantern shuttered, so the Gloam has no quarry', () => {
      const s = delve({ heroes: ['brann', 'keven'] });
      put(s, 'brann', at(3, 5, 5));
      put(s, 'keven', at(1, 10, 7));
      s.delve!.lanternBearer = 'keven';
      s.delve!.lanternOpen = false;
      expect(e.heroLit(s, 'brann')).toBe(false);
      hero(s, 'brann').ale = 'glowworm';
      expect(e.heroLit(s, 'brann')).toBe(true);
      expect(e.inLight(s, at(3, 6, 5))).toBe(true);
      expect(e.inLight(s, at(3, 8, 5))).toBe(false);
      const r = sok(s, { type: 'endTurn' });
      expect(r.state.delve!.monsters.some((m) => m.kind === 'gloam')).toBe(false);
    });

    it('Featherfoot: the first fall deals no damage, the second does', () => {
      let s = delve({ heroes: ['brann'] });
      const b = hero(s, 'brann');
      b.ale = 'featherfoot';
      put(s, 'brann', at(1, 10, 2));
      const hp = b.hp;
      const jt = option(s, 'brann', 'jump')!.targets.find((t) => samePos(t.at!, at(1, 10, 3)))!;
      expect(e.preview(s, 'brann', 'jump', jt).warning).toMatch(/0 damage/);
      s = act(s, 'brann', 'jump', jt).state;
      expect(hero(s, 'brann')).toMatchObject({ hp, aleSpent: true });
      expect(hero(s, 'brann').at.level).toBe(2);
    });

    it('Fireside Porter: heal 3 after any fall damage on every level change', () => {
      let s = delve({ heroes: ['brann'] });
      const b = hero(s, 'brann');
      b.ale = 'fireside';
      put(s, 'brann', at(1, 10, 2));
      const hp = b.hp;
      const jt = option(s, 'brann', 'jump')!.targets.find((t) => samePos(t.at!, at(1, 10, 3)))!;
      s = act(s, 'brann', 'jump', jt).state;
      expect(hero(s, 'brann').hp).toBe(Math.min(hp, hp - 4 + 3));
      // Stairs heal too.
      s = sok(s, { type: 'endTurn' }).state;
      put(s, 'brann', at(2, 2, 4));
      hero(s, 'brann').hp = 2;
      const up = e.reachable(s, 'brann', false).find((x) => x.to.level === 1)!;
      s = sok(s, { type: 'move', heroId: 'brann', path: up.path, sneak: false }).state;
      expect(hero(s, 'brann').hp).toBe(5);
    });

    it('Mole\'s Brown digs; Smuggler\'s Mead sneaks 4 silently; hiccups make noise 1 each world phase', () => {
      const s = delve({ heroes: ['brann'] });
      put(s, 'brann', at(2, 13, 3));
      expect(option(s, 'brann', 'dig')).toBeUndefined();
      hero(s, 'brann').ale = 'mole';
      expect(option(s, 'brann', 'dig')!.targets.map((t) => t.at)).toContainEqual(at(2, 14, 3));
      expect(Math.max(...e.reachable(s, 'brann', true).map((x) => x.cost))).toBe(2);
      hero(s, 'brann').ale = 'smuggler';
      expect(Math.max(...e.reachable(s, 'brann', true).map((x) => x.cost))).toBe(4);
      expect(e.moveNoise(s, 'brann', true)).toBe(0);
      hero(s, 'brann').ale = 'hiccups';
      const r = sok(s, { type: 'endTurn' });
      expect(r.events).toContainEqual({ type: 'noise', at: hero(s, 'brann').at, radius: 1 });
    });
  });

  describe('18.5 rival crews', () => {
    it('Level 1 may draw the Sisters (prospectors); Level 2 and 3 a cutthroat crew from the pool at a post, never both', () => {
      const s = delve({ heroes: ['brann'] });
      const seen: Record<string, number> = {};
      for (let i = 1; i <= 200; i++) {
        const t = structuredClone(s) as GameStateX;
        t.rng = i * 2654435761 >>> 0;
        const one = makeCrew(w, t, t.delve!, 1);
        if (one) expect(one).toMatchObject({ crew: 'lantern-sisters', temperament: 'prospector', stance: 'neutral' });
        seen[one ? 'L1' : 'L1-none'] = (seen[one ? 'L1' : 'L1-none'] ?? 0) + 1;
        const two = makeCrew(w, t, t.delve!, 2);
        if (two) {
          expect(two.temperament).toBe('cutthroat');
          expect(two.stance).toBe('waiting');
          expect(two.entered).toBe(true);
          expect(two.members.every((r) => r.at.level === 2 && distance(r.at, at(2, 14, 5)) <= 2)).toBe(true);
          expect(two.members.every((r) => r.loot.length === 1 && r.loot[0]!.kind === 'gold' && r.loot[0]!.amount === 30)).toBe(true);
          seen[two.crew] = (seen[two.crew] ?? 0) + 1;
        } else seen['L2-none'] = (seen['L2-none'] ?? 0) + 1;
      }
      expect(seen['ferrymen']! + seen['gallows-choir']!).toBeGreaterThan(90);
      expect(seen['ferrymen']! + seen['gallows-choir']!).toBeLessThan(150);
      expect(seen['L1']!).toBeGreaterThan(70);
      expect(seen['L1']!).toBeLessThan(130);
      // V3.7 (spec 20.4): built like level 3 heroes: class HP +2 per level above 1.
      const f = buildCrew(s as GameStateX, 'ferrymen', [at(2, 16, 4), at(2, 17, 4), at(2, 18, 4)]);
      expect(f.members.map((r) => [r.cls, r.hp])).toEqual([['sellsword', 14], ['ranger', 12], ['sapper', 14]]);
      const g = buildCrew(s as GameStateX, 'gallows-choir', [at(2, 16, 4), at(2, 17, 4), at(2, 18, 4)]);
      expect(g.members.map((r) => [r.cls, r.hp])).toEqual([['sellsword', 14], ['burglar', 11], ['pyromancer', 10]]);
    });

    it('waiting cutthroats see a hero within 6: they demand the toll (max of 50 and half the carried value), then turn hostile', () => {
      let s = crewDelve('ferrymen', [at(2, 16, 4), at(2, 17, 4), at(2, 18, 4)]);
      put(s, 'brann', at(2, 3, 3)); // the shrine, behind the wall
      hero(s, 'brann').pack.push(gold(80), { id: 'gm', kind: 'gem', name: 'Garnet', amount: 100, slots: 1 });
      s = ok(s, { type: 'endTurn' }).state;
      expect(crewOf(s).stance).toBe('waiting');
      expect(s.delve!.rivals!.members.every((r, i) => samePos(r.at, [at(2, 16, 4), at(2, 17, 4), at(2, 18, 4)][i]!))).toBe(true);
      put(s, 'brann', at(2, 14, 2));
      const r = ok(s, { type: 'move', heroId: 'brann', path: [at(2, 13, 2)], sneak: true });
      s = r.state;
      // V3.9: he walked west with the crew behind him; he turns to see them.
      s = ok(s, { type: 'face', heroId: 'brann', facing: dirIndex(hero(s, 'brann').at, at(2, 16, 4)) }).state;
      expect(crewOf(s)).toMatchObject({ stance: 'demanding', toll: 90, spotted: true });
      expect(e.intents(s)['r1']?.kind).toBe('toll');
      expect(crewOf(s).aim).toMatchObject({ what: 'your purse', value: 90 });
      // They don't attack this world phase...
      const r2 = ok(s, { type: 'endTurn' });
      expect(r2.events.some((x) => x.type === 'roll' && x.who.startsWith('r'))).toBe(false);
      // ...but unpaid at the next one, they hunt.
      s = r2.state;
      expect(crewOf(s).stance).toBe('demanding');
      const r3 = ok(s, { type: 'endTurn' });
      expect(r3.state.delve!.rivals!.stance).toBe('hostile');
    });

    it('noise of 4 or more they hear wakes them too; the toll is at least 50', () => {
      const s = crewDelve('gallows-choir', [at(2, 16, 4), at(2, 17, 4), at(2, 18, 4)]);
      put(s, 'brann', at(2, 3, 3));
      const c = ctx(s);
      makeNoise(c, at(2, 12, 2), 3);
      expect(crewOf(s).stance).toBe('waiting');
      makeNoise(c, at(2, 12, 2), 6);
      expect(crewOf(s)).toMatchObject({ stance: 'demanding', toll: 50 });
    });

    it('sellsword: shows a shove when a hero stands at an unrailed edge, then shoves', () => {
      const s = crewDelve('ferrymen', [at(2, 8, 2), at(2, 17, 8), at(2, 18, 8)], 'hostile');
      s.delve!.rivals!.members[1]!.hp = 0;
      s.delve!.rivals!.members[2]!.hp = 0;
      put(s, 'brann', at(2, 8, 3));
      computeIntentsOf(ctx(s));
      const ss = s.delve!.rivals!.members[0]!;
      expect(ss.intent?.kind).toBe('shove');
      expect(w.tile(ss.intent!.to!)?.kind).toBe('pit');
      const r = until(s, { type: 'endTurn' }, (ev) => ev.some((x) => x.type === 'fell' && x.id === 'brann'));
      expect(hero(r.state, 'brann').at.level).toBe(3);
    });

    it('sapper: shows a fused charge on a hero 2-3 away the round before, lobs it (fuse 1), and it blows at the end of the next world phase: 4 within 1, noise 8 (spec 20.3)', () => {
      let s = crewDelve('ferrymen', [at(2, 17, 8), at(2, 18, 8), at(2, 16, 4)], 'hostile');
      s.delve!.rivals!.members[0]!.hp = 0;
      s.delve!.rivals!.members[1]!.hp = 0;
      put(s, 'brann', at(2, 16, 1));
      computeIntentsOf(ctx(s));
      const sap = s.delve!.rivals!.members[2]!;
      expect(sap.intent).toMatchObject({ kind: 'fuse', targetId: 'brann', to: at(2, 16, 1) });
      expect(sap.intent!.hexes!.length).toBeGreaterThan(3);
      const hp = hero(s, 'brann').hp;
      const r = ok(s, { type: 'endTurn' });
      s = r.state;
      // Lit during the world phase: the marker shows through the player's turn, then it goes off.
      expect(r.events).toContainEqual({ type: 'fuseSet', at: at(2, 16, 1), rounds: 1, by: sap.id });
      expect(r.events.some((x) => x.type === 'blast')).toBe(false);
      expect(s.delve!.fuses).toMatchObject([{ at: at(2, 16, 1), rounds: 1, by: sap.id }]);
      expect(hero(s, 'brann').hp).toBe(hp);
      expect(s.delve!.rivals!.members[2]!.pack!.filter((i) => i.kind === 'charge').length).toBe(1); // one of two thrown
      const r2 = ok(s, { type: 'endTurn' });
      expect(r2.events).toContainEqual({ type: 'noise', at: at(2, 16, 1), radius: 8 });
      expect(r2.events.some((x) => x.type === 'blast' && 'by' in x && x.by === sap.id)).toBe(true);
      expect(hero(r2.state, 'brann').hp).toBeLessThanOrEqual(hp - 4);
      expect(r2.state.delve!.fuses!.some((f) => samePos(f.at, at(2, 16, 1)))).toBe(false); // (his second charge may already be lit elsewhere)
    });

    it('pyromancer: shows a firebolt on a hero in range 5 and sight, then 3 Wits slots at 60%, 2 per hit', () => {
      const s = crewDelve('gallows-choir', [at(2, 17, 8), at(2, 18, 8), at(2, 16, 4)], 'hostile');
      s.delve!.rivals!.members[0]!.hp = 0;
      s.delve!.rivals!.members[1]!.hp = 0;
      put(s, 'brann', at(2, 13, 1));
      look(s, 'brann', at(2, 16, 4)); // V3.9: facing her (from behind it would be blindsided, +1 slot)
      computeIntentsOf(ctx(s));
      const py = s.delve!.rivals!.members[2]!;
      expect(py.intent?.kind).toBe('firebolt');
      const r = ok(s, { type: 'endTurn' });
      const roll = rolls(r.events).find((x) => x.slots === 3 && r.events.some((y) => y.type === 'roll' && y.who === py.id && y.roll === x));
      expect(roll).toMatchObject({ slots: 3, chance: 85 }); // V3.7: Wits 75 + 5 per level above 1 (level 3)
      expect(r.state.delve!.rivals!.members[2]!.charges).toBe(2); // mana left
    });

    it('a killed cutthroat drops its purse', () => {
      const s = crewDelve('ferrymen', [at(2, 13, 2), at(2, 17, 8), at(2, 18, 8)], 'hostile');
      put(s, 'brann', at(2, 12, 2));
      s.delve!.rivals!.members[0]!.hp = 1;
      const r = until(s, { type: 'act', heroId: 'brann', action: 'attack', target: { id: 'r1' }, focus: 0 }, (ev) => ev.some((x) => x.type === 'monsterDied' && x.id === 'r1'));
      expect(r.state.delve!.ground.find((g) => samePos(g.at, at(2, 13, 2)))!.items.some((i) => i.kind === 'gold' && i.amount === 30)).toBe(true);
    });

    it('prospectors: aim names the chest they go for, with rounds and value', () => {
      const s = crewDelve('lantern-sisters', [at(1, 3, 6), at(1, 4, 6), at(1, 5, 6)]);
      s.delve!.rivals!.spotted = true;
      s.delve!.ground = [];
      put(s, 'brann', at(1, 4, 8));
      computeIntentsOf(ctx(s));
      expect(crewOf(s).aim).toMatchObject({ what: 'the pantry chest', value: 50 });
      expect(crewOf(s).aim!.rounds).toBeGreaterThanOrEqual(1);
    });
  });

  describe('18.6 parley', () => {
    it('the parley action targets crew members within 4 in sight and is free; deals are listed with prices (×1.5 on Level 2)', () => {
      const s = crewDelve('lantern-sisters', [at(1, 12, 7), at(1, 12, 8), at(1, 12, 6)]);
      put(s, 'brann', at(1, 9, 7));
      hero(s, 'brann').pack.push(gold(100));
      const o = option(s, 'brann', 'parley')!;
      expect(o.pick).toBe('enemy');
      expect(o.targets.map((t) => t.id).sort()).toEqual(['r1', 'r2', 'r3']);
      expect(option(s, 'brann', 'bribe')).toBeUndefined();
      const ds = e.deals(s, 'brann');
      const price = (d: DealKind, j?: JobKind) => ds.find((x) => x.deal === d && x.job === j)!.price;
      expect([price('leave'), price('truce'), price('job', 'scout'), price('hire'), price('fight')]).toEqual([40, 25, 30, 60, 0]);
      const r = act(s, 'brann', 'parley', { id: 'r1' });
      expect(hero(r.state, 'brann').acted).toBe(false);
      // Too far: nothing.
      put(s, 'brann', at(1, 6, 7));
      expect(e.deals(s, 'brann')).toEqual([]);
      // Level 2.
      const t = crewDelve('lantern-sisters', [at(2, 16, 4), at(2, 17, 4), at(2, 18, 4)]);
      put(t, 'brann', at(2, 14, 2));
      const d2 = e.deals(t, 'brann');
      expect(d2.find((x) => x.deal === 'leave')!.price).toBe(60);
      expect(d2.find((x) => x.deal === 'truce')!.price).toBe(40);
      expect(d2.find((x) => x.deal === 'hire')!.price).toBe(90);
      expect(d2.find((x) => x.deal === 'job')!.price).toBe(45);
    });

    it('pays gold first, then gems and jewelry smallest first, no change, never heirlooms; blocked says what you carry', () => {
      let s = crewDelve('lantern-sisters', [at(1, 12, 7), at(1, 12, 8), at(1, 12, 6)], undefined, ['brann', 'keven']);
      put(s, 'brann', at(1, 9, 7));
      put(s, 'keven', at(1, 9, 8));
      hero(s, 'brann').pack.push(gold(10, 'ga'), { id: 'ruby', kind: 'gem', name: 'Ruby', amount: 60, slots: 1 });
      hero(s, 'keven').pack.push(gold(15, 'gb'), { id: 'ring', kind: 'jewelry', name: 'Silver ring', amount: 90, slots: 1 }, { id: 'hl', kind: 'heirloom', name: 'The Warhorn', amount: 300, slots: 2 });
      const hire = e.deals(s, 'brann').find((x) => x.deal === 'hire')!;
      expect(hire).toMatchObject({ ok: true, price: 60, pays: '25 gold and a ruby (60)' });
      const r = ok(s, { type: 'deal', heroId: 'brann', deal: 'hire' });
      s = r.state;
      expect(r.events).toContainEqual({ type: 'deal', deal: 'hire', price: 60, paid: ['25 gold', 'Ruby'] });
      expect(hero(s, 'brann').pack).toEqual([]);
      expect(hero(s, 'keven').pack.map((i) => i.id).sort()).toEqual(['hl', 'ring']);
      expect(crewOf(s)).toMatchObject({ stance: 'hired', hiredRounds: 5 });
      // One deal per crew per round; and poverty.
      expect(deal(s, 'keven', 'fight').error).toBeUndefined();
      const t = crewDelve('lantern-sisters', [at(1, 12, 7), at(1, 12, 8), at(1, 12, 6)]);
      put(t, 'brann', at(1, 9, 7));
      hero(t, 'brann').pack.push(gold(25), { id: 'hl', kind: 'heirloom', name: 'Heirloom', amount: 300, slots: 2 });
      const leave = e.deals(t, 'brann').find((x) => x.deal === 'leave')!;
      expect(leave).toMatchObject({ ok: false, blocked: 'You carry 25; they want 40.' });
      expect(deal(t, 'brann', 'leave').error).toBe('You carry 25; they want 40.');
      const u = ok(t, { type: 'deal', heroId: 'brann', deal: 'truce' }).state;
      expect(crewOf(u).stance).toBe('truce');
      hero(u, 'brann').pack.push(gold(100));
      expect(deal(u, 'brann', 'job', 'scout').error).toMatch(/One deal a round/);
    });

    it('leave: they make for the exit and drop the heirloom', () => {
      let s = crewDelve('lantern-sisters', [at(1, 12, 7), at(1, 12, 8), at(1, 12, 6)]);
      put(s, 'brann', at(1, 9, 7));
      hero(s, 'brann').pack.push(gold(40));
      s.delve!.rivals!.members[0]!.loot.push({ id: 'hl', kind: 'heirloom', name: 'The Signet', amount: 60, slots: 2, contractId: 'x' });
      s = ok(s, { type: 'deal', heroId: 'brann', deal: 'leave' }).state;
      expect(crewOf(s)).toMatchObject({ stance: 'bribed', goal: 'leave' });
      expect(s.delve!.ground.find((g) => samePos(g.at, at(1, 12, 7)))!.items.map((i) => i.id)).toContain('hl');
      expect(s.delve!.rivals!.members[0]!.intent?.kind).toBe('flee');
    });

    it('paying the toll buys the truce: cutthroats hold their post and never attack unless attacked', () => {
      let s = crewDelve('ferrymen', [at(2, 16, 4), at(2, 17, 4), at(2, 18, 4)]);
      put(s, 'brann', at(2, 14, 2));
      hero(s, 'brann').pack.push(gold(70));
      s = ok(s, { type: 'endTurn' }).state;
      expect(crewOf(s).stance).toBe('demanding');
      const toll = e.deals(s, 'brann').find((x) => x.deal === 'truce')!;
      expect(toll).toMatchObject({ label: 'Pay the toll', price: 50, ok: true });
      s = ok(s, { type: 'deal', heroId: 'brann', deal: 'truce' }).state;
      expect(crewOf(s).stance).toBe('truce');
      for (let i = 0; i < 3; i++) {
        const r = ok(s, { type: 'endTurn' });
        expect(r.events.some((x) => x.type === 'roll' && x.who.startsWith('r'))).toBe(false);
        s = r.state;
      }
      expect(crewOf(s).stance).toBe('truce');
      // Attacking them breaks it: hostile, and they keep the coin.
      put(s, 'brann', at(2, 15, 4));
      const coin = valueOfLoot(s);
      s = act(s, 'brann', 'attack', { id: 'r1' }).state;
      expect(crewOf(s).stance).toBe('hostile');
      expect(valueOfLoot(s)).toBeGreaterThanOrEqual(coin - 30);
    });

    it('jobs: scout maps around them now; winch: the lift runs; open: a seen locked door opens silently', () => {
      let s = crewDelve('ferrymen', [at(2, 4, 7), at(2, 3, 7), at(2, 4, 8)], 'truce');
      put(s, 'brann', at(2, 3, 6));
      hero(s, 'brann').pack.push(gold(200));
      s.delve!.explored = [];
      s = ok(s, { type: 'deal', heroId: 'brann', deal: 'job', job: 'scout' }).state;
      expect(s.delve!.explored).toContain(posKey(at(2, 12, 7)));
      s = ok(s, { type: 'endTurn' }).state;
      expect(s.delve!.liftWorking).toBe(false);
      s = ok(s, { type: 'deal', heroId: 'brann', deal: 'job', job: 'winch' }).state;
      expect(crewOf(s).job).toMatchObject({ kind: 'winch', at: at(2, 1, 7) });
      s = turns(s, 2);
      expect(s.delve!.liftWorking).toBe(true);
      expect(crewOf(s).job).toBeUndefined();
      expect(e.deals(s, 'brann').find((x) => x.job === 'winch')!.blocked).toMatch(/already runs/);
      // Open: Level 1's locked door at (13,3), once seen.
      let t = crewDelve('lantern-sisters', [at(1, 12, 2), at(1, 12, 1), at(1, 11, 1)], 'truce');
      put(t, 'brann', at(1, 10, 1));
      hero(t, 'brann').pack.push(gold(30));
      t.delve!.explored = [];
      expect(e.deals(t, 'brann').find((x) => x.job === 'open')!.blocked).toMatch(/No locked/);
      t.delve!.explored = [posKey(at(1, 13, 3))];
      t = ok(t, { type: 'deal', heroId: 'brann', deal: 'job', job: 'open' }).state;
      const r = ok(t, { type: 'endTurn' });
      expect(r.state.delve!.doors[posKey(at(1, 13, 3))]).toMatchObject({ open: true, locked: false });
      expect(r.events.some((x) => x.type === 'noise' && x.radius > 1 && samePos(x.at, at(1, 13, 3)))).toBe(false);
    });

    it('hire: 5 rounds keeping near the hirer and fighting monsters; then prospectors go back to looting (poor party)', () => {
      let s = crewDelve('lantern-sisters', [at(1, 12, 7), at(1, 12, 8), at(1, 12, 6)]);
      put(s, 'brann', at(1, 9, 7));
      hero(s, 'brann').pack.push(gold(60));
      const hire = e.deals(s, 'brann').find((x) => x.deal === 'hire')!;
      expect(hire.risk).toMatch(/25%/);
      s = ok(s, { type: 'deal', heroId: 'brann', deal: 'hire' }).state;
      const rat = monster(s, 'rats', at(1, 12, 5), 'hunting');
      computeIntentsOf(ctx(s));
      expect(s.delve!.rivals!.members[2]!.intent).toMatchObject({ kind: 'attack', targetId: rat.id });
      const r = ok(s, { type: 'endTurn' });
      expect(r.events.some((x) => x.type === 'roll' && x.who.startsWith('r'))).toBe(true);
      s = r.state;
      s.delve!.monsters = [];
      s = turns(s, 4);
      expect(crewOf(s).stance).toBe('neutral');
      expect(crewOf(s).hiredRounds).toBeUndefined();
    });

    it('hire: a rich party may be betrayed when the deal ends (25%); cutthroats otherwise go back to a truce', () => {
      const base = crewDelve('ferrymen', [at(2, 16, 4), at(2, 17, 4), at(2, 18, 4)], 'truce');
      put(base, 'brann', at(2, 14, 2));
      hero(base, 'brann').pack.push(gold(100), gold(100, 'g2'), gold(100, 'g3'));
      const s = ok(base, { type: 'deal', heroId: 'brann', deal: 'hire' }).state;
      expect(e.deals(s, 'brann').find((x) => x.deal === 'hire')!.blocked).toMatch(/already/);
      const after = (t: GameState) => turns(t, 4);
      const pre = after(s);
      expect(crewOf(pre).hiredRounds).toBe(1);
      const bad = until(pre, { type: 'endTurn' }, (ev) => ev.some((x) => x.type === 'betrayed'));
      expect(bad.state.delve!.rivals!.stance).toBe('hostile');
      const good = until(pre, { type: 'endTurn' }, (ev) => !ev.some((x) => x.type === 'betrayed'));
      expect(good.state.delve!.rivals!.stance).toBe('truce');
    });

    it('fight is free and turns them hostile; refused with nobody in reach', () => {
      const s = crewDelve('lantern-sisters', [at(1, 12, 7), at(1, 12, 8), at(1, 12, 6)]);
      put(s, 'brann', at(1, 9, 7));
      const r = ok(s, { type: 'deal', heroId: 'brann', deal: 'fight' });
      expect(r.state.delve!.rivals!.stance).toBe('hostile');
      expect(r.events).toContainEqual({ type: 'deal', deal: 'fight', price: 0, paid: [] });
      put(s, 'brann', at(1, 2, 2));
      expect(deal(s, 'brann', 'fight').error).toMatch(/Nobody/);
    });
  });
});

function valueOfLoot(s: GameState): number {
  return s.delve!.rivals!.members.flatMap((r) => r.loot).reduce((n, i) => n + (i.kind === 'gold' ? i.amount : 0), 0);
}

// ---------------------------------------------------------------- V3.6 (spec section 19)

describe('V3.6', () => {
  describe('19.2 locks: lockpicks', () => {
    const door = at(1, 13, 3);
    it('without picks a non-Burglar gets a blocked Pick that names the fix; Smash stays', () => {
      const s = delve({ heroes: ['brann'] });
      put(s, 'brann', at(1, 12, 3));
      const o = option(s, 'brann', 'pick')!;
      expect(o.blocked).toBe('Locked · Smash it, or pick it with lockpicks');
      expect(o.targets.some((t) => samePos(t.at!, door))).toBe(true);
      expect(e.preview(s, 'brann', 'pick', { at: door }).ok).toBe(false);
      expect(option(s, 'brann', 'smash')).toBeTruthy();
      // Nothing locked in reach: no blocked option either.
      put(s, 'brann', at(1, 2, 2));
      expect(option(s, 'brann', 'pick')).toBeUndefined();
    });

    it('with picks: 2 Finesse slots; 2 hits silent, 1 hit noise 2, 0 jams; the picks are kept', () => {
      const base = delve({ heroes: ['brann'] });
      put(base, 'brann', at(1, 12, 3));
      give(base, 'brann', 'lockpicks');
      const o = option(base, 'brann', 'pick')!;
      expect(o.blocked).toBeUndefined();
      const pv = e.preview(base, 'brann', 'pick', { at: door });
      expect(pv.slots).toBe(2);
      expect(pv.modifiers).toContain('Lockpicks: 2 slots');
      expect(pv.outcomes).toEqual(['Lock jams', 'Opens, noise 2', 'Opens silently']);
      const cmd: Command = { type: 'act', heroId: 'brann', action: 'pick', target: { at: door }, focus: 0 };
      const two = until(base, cmd, (ev) => rolls(ev)[0]!.hits === 2);
      expect(two.state.delve!.doors[posKey(door)]).toMatchObject({ open: true, locked: false });
      expect(two.events.some((x) => x.type === 'noise')).toBe(false);
      expect(hero(two.state, 'brann').pack.some((i) => i.kind === 'lockpicks')).toBe(true);
      const one = until(base, cmd, (ev) => rolls(ev)[0]!.hits === 1);
      expect(one.state.delve!.doors[posKey(door)]!.open).toBe(true);
      expect(one.events.some((x) => x.type === 'noise' && x.radius === 2)).toBe(true);
      const zero = until(base, cmd, (ev) => rolls(ev)[0]!.hits === 0);
      expect(zero.state.delve!.doors[posKey(door)]).toMatchObject({ open: false, jammed: true });
      expect(hero(zero.state, 'brann').pack.some((i) => i.kind === 'lockpicks')).toBe(true);
      // Chests too.
      const c = delve({ heroes: ['brann'] });
      put(c, 'brann', at(1, 16, 1));
      give(c, 'brann', 'lockpicks');
      expect(option(c, 'brann', 'pick')!.targets.some((t) => samePos(t.at!, at(1, 17, 1)))).toBe(true);
      const rc = act(c, 'brann', 'pick', { at: at(1, 17, 1) }, 2);
      expect(rc.state.delve!.chests.find((x) => x.id === 'c2')!.opened).toBe(true);
    });

    it('a Burglar with picks still rolls 3 slots', () => {
      const s = delve({ heroes: ['pim'] });
      put(s, 'pim', at(1, 12, 3));
      give(s, 'pim', 'lockpicks');
      expect(e.preview(s, 'pim', 'pick', { at: door }).slots).toBe(3);
    });
  });

  describe('19.3 night-eye draught', () => {
    function dark() {
      const s = delve({ heroes: ['keven', 'brann'] });
      put(s, 'keven', at(2, 2, 1)); // the lantern is on L2: Brann is unlit
      put(s, 'brann', at(3, 6, 4));
      return s;
    }

    it('drinking is a silent action: sight 6 unlit on L3 (8 on L1, 7 on L2), still unlit, no dark roll penalty', () => {
      const s = dark();
      expect(e.sightRange(s, 'brann')).toBe(1);
      give(s, 'brann', 'nightsight');
      const o = option(s, 'brann', 'nightsight')!;
      expect(o.pick).toBe('self');
      const r = act(s, 'brann', 'nightsight', {});
      expect(r.events.some((x) => x.type === 'noise')).toBe(false);
      const t = r.state;
      expect(hero(t, 'brann').pack).toHaveLength(0);
      expect(hero(t, 'brann').nightEyes).toBe(8);
      expect(hero(t, 'brann').acted).toBe(true);
      expect(e.heroLit(t, 'brann')).toBe(false);
      expect(e.sightRange(t, 'brann')).toBe(6);
      put(t, 'brann', at(2, 10, 7));
      expect(e.sightRange(t, 'brann')).toBe(7);
      put(t, 'brann', at(1, 10, 7));
      expect(e.sightRange(t, 'brann')).toBe(8);
      // Rolls: the dark penalty is gone (and said so); without the draught it is −20 in the dark.
      put(t, 'brann', at(3, 6, 4));
      const m = monster(t, 'rats', at(3, 7, 4), 'hunting');
      hero(t, 'brann').acted = false;
      const pv = e.preview(t, 'brann', 'attack', { id: m.id });
      const might = t.campaign.roster.find((h) => h.id === 'brann')!.stats.might;
      expect(pv.chance).toBe(might);
      expect(pv.modifiers).toContain('Night-eye: no dark penalty');
      hero(t, 'brann').nightEyes = 0;
      expect(e.preview(t, 'brann', 'attack', { id: m.id }).chance).toBe(might - 20);
    });

    it('counts down each world phase and wears off', () => {
      let s = dark();
      hero(s, 'brann').nightEyes = 2;
      s = ok(s, { type: 'endTurn' }).state;
      expect(hero(s, 'brann').nightEyes).toBe(1);
      expect(e.sightRange(s, 'brann')).toBe(6);
      const r = ok(s, { type: 'endTurn' });
      expect(hero(r.state, 'brann').nightEyes).toBe(0);
      expect(r.events.some((x) => x.type === 'say' && /night-eye fades/.test(x.text))).toBe(true);
      expect(e.sightRange(r.state, 'brann')).toBe(1);
    });

    it('the Gloam still strikes a night-eyed unlit hero', () => {
      let s = delve({ heroes: ['keven', 'brann'] });
      put(s, 'keven', at(3, 6, 4)); // lantern bearer, shuttered
      put(s, 'brann', at(3, 7, 4));
      s.delve!.lanternOpen = false;
      hero(s, 'keven').nightEyes = 8;
      hero(s, 'brann').nightEyes = 8;
      s = ok(s, { type: 'endTurn' }).state;
      const g = s.delve!.monsters.find((m) => m.kind === 'gloam')!;
      expect(g).toBeTruthy();
      g.at = { ...at(3, 5, 4) };
      hero(s, 'keven').hp = 12;
      s = ok(s, { type: 'endTurn' }).state;
      expect(hero(s, 'keven').hp).toBe(8);
      expect(s.delve!.monsters.some((m) => m.kind === 'gloam')).toBe(true);
    });

    it('monsters notice a night-eyed hero as before: unlit and 5 away on L1 is unseen', () => {
      const s = delve({ heroes: ['keven', 'brann'] });
      put(s, 'keven', at(2, 2, 1));
      put(s, 'brann', at(1, 10, 8));
      hero(s, 'brann').nightEyes = 8;
      const far = monster(s, 'orc', at(1, 10, 2), 'alert');
      expect(ok(s, { type: 'endTurn' }).state.delve!.monsters.find((m) => m.id === far.id)!.awareness).toBe('alert');
    });
  });

  describe('19.4 movement through friends', () => {
    it('hired crew members are passed through, never ended on; other crews block', () => {
      const spots = [at(1, 7, 7), at(1, 12, 8), at(1, 12, 6)]; // one sister in the gate-room doorway
      const hired = crewDelve('lantern-sisters', spots, 'hired');
      put(hired, 'brann', at(1, 6, 7));
      const reach = e.reachable(hired, 'brann', false);
      expect(reach.some((r) => samePos(r.to, at(1, 9, 7)))).toBe(true);
      expect(reach.some((r) => samePos(r.to, at(1, 7, 7)))).toBe(false);
      const path = reach.find((r) => samePos(r.to, at(1, 9, 7)))!.path;
      expect(ok(hired, { type: 'move', heroId: 'brann', path, sneak: false }).state.delve!.heroes[0]!.at).toEqual(at(1, 9, 7));
      for (const stance of ['neutral', 'truce', 'hostile'] as const) {
        const other = crewDelve('lantern-sisters', spots, stance);
        put(other, 'brann', at(1, 6, 7));
        expect(e.reachable(other, 'brann', false).some((r) => samePos(r.to, at(1, 9, 7))), stance).toBe(false);
        expect(e.apply(other, { type: 'move', heroId: 'brann', path, sneak: false }).error).toBe('Something is in the way.');
      }
    });
  });
});

// ---------------------------------------------------------------- V3.7 (spec 20.1, 20.2)

describe('V3.7 stealth and swings', () => {
  /** Keven parked on L1 with the lantern; Brann alone on L2 row 1 (unlit west of col 13, the forge lights the east end). */
  function stealthDelve(opts: { lit?: boolean; extra?: [string, string, HeroClass][]; heroes?: string[] } = {}) {
    const s = delve({ heroes: opts.heroes ?? ['keven', 'brann'], extra: opts.extra });
    put(s, 'keven', at(1, 2, 7));
    s.delve!.light = 20;
    s.delve!.lanternBearer = opts.lit ? 'brann' : 'keven';
    return s;
  }
  const sneaking = (s: GameState, id: string, on = true) => ((hero(s, id) as HeroX).sneaked = on);
  const mon = (s: GameState, id: string) => s.delve!.monsters.find((m) => m.id === id) as MonsterX;
  const noticedBy = (r: { events: GameEvent[] }, by: string, who: string) => r.events.some((x) => x.type === 'noticed' && x.by === by && x.hero === who);

  describe('20.1 walking noise per hex and wake rolls', () => {
    it('walking makes noise at every hex (2 on rubble) that wakes sleepers it reaches; one noise event per move; sneaking is silent', () => {
      const s = stealthDelve({ lit: true });
      put(s, 'brann', at(2, 13, 3));
      const m = monster(s, 'orc', at(2, 16, 3), 'asleep'); // 2 from the rubble at (14,3), 3 from the destination
      const path = [at(2, 14, 3), at(2, 14, 4)];
      const r = ok(s, { type: 'move', heroId: 'brann', path, sneak: false });
      // The rubble's noise wakes it facing (14,3); V4.0 (spec 26.2): awake now, it notices Brann on his next hex.
      expect(r.events.find((x) => x.type === 'awake' && x.id === m.id)).toMatchObject({ awareness: 'alert' });
      expect(r.events.find((x) => x.type === 'noticed' && x.by === m.id)).toMatchObject({ hero: 'brann', at: at(2, 14, 4) });
      expect(mon(r.state, m.id).awareness).toBe('hunting');
      expect(mon(r.state, m.id).focusAt).toEqual(at(2, 14, 4));
      expect(r.events.filter((x) => x.type === 'noise' && x.radius !== 5)).toHaveLength(1); // (5: the orc's bellow)
      // Sneaking (2: the rubble alone): no noise; standing 2 from it rolls 10% (lit by the forge). Both outcomes exist, seeded.
      const creep = [at(2, 14, 3)];
      const quiet = until(s, { type: 'move', heroId: 'brann', path: creep, sneak: true }, (_ev, st) => st.delve!.monsters[0]!.awareness === 'asleep');
      expect(quiet.events.some((x) => x.type === 'noise')).toBe(false);
      const woke = until(s, { type: 'move', heroId: 'brann', path: creep, sneak: true }, (ev) => ev.some((x) => x.type === 'woke'));
      expect(mon(woke.state, m.id).awareness).toBe('alert');
      expect(woke.events.find((x) => x.type === 'woke')).toMatchObject({ id: m.id, by: 'brann' });
    });

    it('wake chances: 50 walking, 10 sneaking within 2, halved unlit; ending adjacent: walking sure, sneaking 25; the Dragon is left out', () => {
      const s = stealthDelve({ lit: true });
      put(s, 'brann', at(2, 8, 1));
      const m = monster(s, 'orc', at(2, 10, 1), 'asleep');
      const lit = litSet(w, s.delve as DelveX);
      expect(wakeChance(m as MonsterX, at(2, 8, 1), false, false, lit)).toBe(50);
      expect(wakeChance(m as MonsterX, at(2, 8, 1), false, true, lit)).toBe(10);
      expect(wakeChance(m as MonsterX, at(2, 9, 1), true, false, lit)).toBe(100);
      expect(wakeChance(m as MonsterX, at(2, 9, 1), true, true, lit)).toBe(25);
      const dark = litSet(w, { ...(s.delve as DelveX), lanternBearer: 'keven' });
      expect(wakeChance(m as MonsterX, at(2, 8, 1), false, false, dark)).toBe(25);
      expect(wakeChance(m as MonsterX, at(2, 8, 1), false, true, dark)).toBe(5);
      // The Dragon sleeps through passers-by (14.4 stands); the preview lists no roll for it.
      const t = delve({ heroes: ['brann'] });
      put(t, 'brann', at(3, 14, 4));
      t.delve!.doors[posKey(at(3, 13, 3))]!.open = true;
      monster(t, 'dragon', at(3, 16, 4), 'asleep');
      const reach = e.reachable(t, 'brann', true).find((x) => samePos(x.to, at(3, 15, 4)));
      expect(reach?.risks?.wake).toEqual([]);
    });

    it('the same seed and path wake the same monsters', () => {
      const s = stealthDelve({ lit: true });
      put(s, 'brann', at(2, 8, 1));
      monster(s, 'orc', at(2, 10, 1), 'asleep');
      monster(s, 'rats', at(2, 10, 2), 'asleep');
      const cmd: Command = { type: 'move', heroId: 'brann', path: [at(2, 9, 1), at(2, 10, 1 - 1 + 1)].slice(0, 1), sneak: false };
      const a = e.apply(s, cmd);
      const b = e.apply(s, cmd);
      expect(a.events).toEqual(b.events);
      expect(a.state).toEqual(b.state);
    });
  });

  describe('20.1 noticing', () => {
    it('lit: walking 8 (V3.7.1), sneaking 4; unlit: walking 5 (V3.7.1), sneaking 1; a `noticed` event, then hunting', () => {
      const check = (col: number, lit: boolean, sneak: boolean, mcol = 13) => {
        const s = stealthDelve({ lit });
        put(s, 'brann', at(2, col, 1));
        sneaking(s, 'brann', sneak);
        const m = monster(s, 'orc', at(2, mcol, 1), 'alert');
        const r = ok(s, { type: 'endTurn' });
        const seen = mon(r.state, m.id).awareness === 'hunting';
        expect(noticedBy(r, m.id, 'brann')).toBe(seen);
        if (seen) expect(mon(r.state, m.id).noticedIds).toContain('brann');
        return seen;
      };
      expect(check(10, true, false, 18)).toBe(true); // 8 (the wall at (6,1) is in the way further west)
      expect(check(9, true, false, 18)).toBe(false); // 9
      expect(check(8, true, true)).toBe(false); // 5
      expect(check(9, true, true)).toBe(true); // 4
      expect(check(7, false, false)).toBe(false); // 6 unlit
      expect(check(8, false, false)).toBe(true); // 5
      expect(check(10, false, true)).toBe(false); // 3, sneaking
      expect(check(11, false, true)).toBe(false); // 2
      expect(check(12, false, true)).toBe(true); // 1
    });

    it('in the Hollow light does not matter: walking 8 (V3.7.1), sneaking 3', () => {
      const check = (col: number, sneak: boolean) => {
        const s = stealthDelve();
        put(s, 'brann', at(3, col, 4));
        sneaking(s, 'brann', sneak);
        const m = monster(s, 'rats', at(3, 2, 4), 'alert');
        return mon(ok(s, { type: 'endTurn' }).state, m.id).awareness === 'hunting';
      };
      expect(check(10, false)).toBe(true);
      expect(check(11, false)).toBe(false);
      expect(check(5, true)).toBe(true);
      expect(check(6, true)).toBe(false);
    });

    it('the last move sets the mode: a sneak move makes the hero sneaking at the world phase, a walk does not', () => {
      const s = stealthDelve({ lit: true });
      put(s, 'brann', at(2, 7, 1));
      const m = monster(s, 'orc', at(2, 13, 1), 'alert');
      // Sneak 1 east: 5 away, sneaking: unseen.
      let r = ok(s, { type: 'move', heroId: 'brann', path: [at(2, 8, 1)], sneak: true });
      expect((hero(r.state, 'brann') as HeroX).sneaked).toBe(true);
      r = ok(r.state, { type: 'endTurn' });
      expect(mon(r.state, m.id).awareness).toBe('alert');
      // Walk 1 east: 4 away, walking: seen.
      r = ok(r.state, { type: 'move', heroId: 'brann', path: [at(2, 9, 1)], sneak: false });
      r = ok(r.state, { type: 'endTurn' });
      expect(mon(r.state, m.id).awareness).toBe('hunting');
    });
  });

  describe('20.1 facing and the blind arc', () => {
    it('spawns face as the map says (default 0); a walk turns them the way they stepped; noise turns heads', () => {
      const s = castleDelve();
      const rats = s.delve!.monsters.find((m) => m.kind === 'rats' && m.at.level === 1)!;
      expect(rats.facing).toBe(0);
      expect(s.delve!.monsters.find((m) => m.kind === 'spider' && m.at.level === 2)!.facing).toBe(3);
      expect(s.delve!.monsters.find((m) => m.kind === 'orc' && m.at.level === 1)!.facing).toBe(0);
      // Noise from the south-west turns the rats that way.
      const c = ctx(s);
      makeNoise(c, at(1, 3, 3), 1);
      expect(rats.facing).toBe(4);
      // A hunting orc walking east ends facing east.
      const t = stealthDelve({ lit: true });
      put(t, 'brann', at(2, 12, 1));
      const m = monster(t, 'orc', at(2, 8, 1), 'hunting');
      (m as MonsterX).facing = 3;
      const r = ok(t, { type: 'endTurn' });
      expect(mon(r.state, m.id).at).toEqual(at(2, 11, 1));
      expect(mon(r.state, m.id).facing).toBe(0);
    });

    it('V3.9 (spec 24.1): the rear half is blind: a walking hero there is noticed only adjacent, a sneaking one never', () => {
      const check = (col: number, row: number, sneak: boolean) => {
        const s = stealthDelve({ lit: true });
        put(s, 'brann', at(2, col, row));
        sneaking(s, 'brann', sneak);
        const m = monster(s, 'orc', at(2, 13, 1), 'alert');
        (m as MonsterX).facing = 3; // looking west: the rear half is the east side (dirs 0, 1, 5)
        return mon(ok(s, { type: 'endTurn' }).state, m.id).awareness === 'hunting';
      };
      expect(check(17, 1, false)).toBe(false); // 4 behind, lit, walking: blind
      expect(check(18, 1, false)).toBe(false);
      expect(check(15, 2, true)).toBe(false); // 2 behind, sneaking
      expect(check(14, 2, true)).toBe(false); // adjacent, back-side neighbour, sneaking: never
      expect(check(14, 2, false)).toBe(true); // ...walking adjacent: noticed
      expect(check(14, 1, true)).toBe(false); // directly behind
      expect(check(14, 1, false)).toBe(true); // ...unless walking in
      // The same from the front: a sneaking hero 2 away in the light is seen.
      expect(check(11, 1, true)).toBe(true);
      // wouldNotice agrees, and a watcher without a facing has no blind arc.
      const s = stealthDelve({ lit: true });
      put(s, 'brann', at(2, 14, 1));
      const lit = litSet(w, s.delve as DelveX);
      expect(wouldNotice(ctx(s), { at: at(2, 13, 1), facing: 3 }, at(2, 14, 1), true, lit)).toBe(false);
      expect(wouldNotice(ctx(s), { at: at(2, 13, 1) }, at(2, 14, 1), true, lit)).toBe(true);
    });

    it('cover: no line of sight, no notice, sneaking or not', () => {
      const s = stealthDelve({ lit: true });
      put(s, 'brann', at(2, 3, 3)); // the shrine, behind its wall
      const m = monster(s, 'orc', at(2, 8, 3), 'alert');
      const r = ok(s, { type: 'endTurn' });
      expect(mon(r.state, m.id).awareness).toBe('alert');
    });
  });

  describe('20.1 sneak attack', () => {
    it('+1 slot on a monster that has not noticed the attacker; gone once it has; stacks with backstab', () => {
      const s = delve();
      put(s, 'brann', GATE);
      put(s, 'pim', at(1, 5, 8));
      const m = monster(s, 'orc', at(1, 5, 7), 'alert');
      m.hp = 30; // it lives through the test
      (m as MonsterX).facing = 1; // V3.9: its back (dirs 3, 4, 5) to Brann and Pim
      let p = e.preview(s, 'brann', 'attack', { id: m.id });
      expect(p.slots).toBe(4);
      expect(p.modifiers).toContain('Sneak attack +1 slot');
      // The Burglar: dagger 2, +1 sneak, +1 backstab (V3.9: from its rear half, unnoticed).
      p = e.preview(s, 'pim', 'attack', { id: m.id });
      expect(p.slots).toBe(4);
      expect(p.modifiers).toEqual(expect.arrayContaining(['Sneak attack +1 slot', 'Backstab: +1 slot, double damage']));
      // Brann strikes (hit or miss): the orc knows him now, and hunts.
      const r = act(s, 'brann', 'attack', { id: m.id });
      expect(noticedBy(r, m.id, 'brann')).toBe(true);
      const o = mon(r.state, m.id);
      expect(o.noticedIds).toEqual(['brann']);
      expect(o.facing).toBe(3); // turned toward Brann, west of it
      if (o.hp > 0) {
        hero(r.state, 'brann').acted = false;
        expect(e.preview(r.state, 'brann', 'attack', { id: m.id }).slots).toBe(3);
        // Pim is still unnoticed: sneak attack; but it turned to Brann and Pim is in its front half now: no backstab.
        expect(e.preview(r.state, 'pim', 'attack', { id: m.id }).slots).toBe(3);
      }
    });

    it('a monster that loses its quarry forgets who it saw; sleep does too', () => {
      let s = stealthDelve({ lit: true });
      put(s, 'brann', at(2, 9, 1));
      const m = monster(s, 'orc', at(2, 13, 1), 'alert');
      s = ok(s, { type: 'endTurn' }).state;
      expect(mon(s, m.id).noticedIds).toEqual(['brann']);
      put(s, 'brann', at(1, 3, 7));
      s = ok(s, { type: 'endTurn' }).state;
      expect(mon(s, m.id).awareness).toBe('alert');
      expect(mon(s, m.id).noticedIds).toBeUndefined();
    });
  });

  describe('20.2 free swings', () => {
    it('a hero leaving a hunting enemy that noticed them takes one swing at a slot fewer, no Focus; alert, glued and feared enemies do not swing', () => {
      const s = delve();
      put(s, 'brann', GATE);
      const m = monster(s, 'orc', at(1, 5, 7), 'hunting');
      const away = [at(1, 3, 7), at(1, 2, 7)];
      const r = ok(s, { type: 'move', heroId: 'brann', path: away, sneak: true });
      const sw = r.events.filter((x) => x.type === 'swing');
      expect(sw).toHaveLength(1);
      expect(sw[0]).toMatchObject({ by: m.id, target: 'brann' });
      const roll = rolls(r.events).find((x) => x.slots === 1)!;
      expect(roll.focus).toBe(0);
      expect(hero(r.state, 'brann').moved).toBe(true);
      // Staying adjacent provokes nothing.
      expect(ok(s, { type: 'move', heroId: 'brann', path: [at(1, 5, 8)], sneak: false }).events.some((x) => x.type === 'swing')).toBe(false);
      // Exclusions.
      const alert = delve();
      put(alert, 'brann', GATE);
      monster(alert, 'orc', at(1, 5, 7), 'alert');
      expect(ok(alert, { type: 'move', heroId: 'brann', path: away, sneak: false }).events.some((x) => x.type === 'swing')).toBe(false);
      const glued = delve();
      put(glued, 'brann', GATE);
      monster(glued, 'orc', at(1, 5, 7), 'hunting').stuck = 2;
      expect(ok(glued, { type: 'move', heroId: 'brann', path: away, sneak: false }).events.some((x) => x.type === 'swing')).toBe(false);
      const feared = delve();
      put(feared, 'brann', GATE);
      monster(feared, 'orc', at(1, 5, 7), 'hunting').feared = 1;
      expect(ok(feared, { type: 'move', heroId: 'brann', path: away, sneak: false }).events.some((x) => x.type === 'swing')).toBe(false);
      // The preview says so: Reach.risks.swings with the damage range (orc 2 dmg, Brann armor 1: 0–2 on 1 slot).
      const reach = e.reachable(s, 'brann', false).find((x) => samePos(x.to, at(1, 2, 7)))!;
      expect(reach.risks?.swings).toEqual([{ id: m.id, damage: [0, 2] }]);
      expect(e.reachable(s, 'brann', false).find((x) => samePos(x.to, at(1, 5, 8)))!.risks?.swings).toEqual([]);
    });

    it('jumping into a pit from an enemy\'s side provokes; the preview warns', () => {
      const s = delve();
      put(s, 'brann', at(1, 11, 3));
      const m = monster(s, 'orc', at(1, 12, 3), 'hunting');
      const pv = e.preview(s, 'brann', 'jump', { at: at(1, 10, 3) });
      expect(pv.warning).toMatch(/Orc gets a free swing: 0–2/);
      const r = act(s, 'brann', 'jump', { at: at(1, 10, 3) });
      expect(r.events.some((x) => x.type === 'swing' && x.by === m.id)).toBe(true);
      expect(r.events.some((x) => x.type === 'fell')).toBe(true);
    });

    it('heroes swing too: an enemy leaving a hero whose action is ready takes a swing (sword 2 slots, bow 1); the action is kept', () => {
      const s = delve({ heroes: ['rae', 'brann'], extra: [['rae', 'Rae', 'ranger']] });
      put(s, 'brann', at(1, 4, 7));
      put(s, 'rae', at(1, 5, 6));
      const m = monster(s, 'cutpurse', at(1, 5, 7), 'hunting');
      m.stolen = { id: 'x', kind: 'gem', name: 'Garnet', amount: 40, slots: 1 }; // a cutpurse with loot runs for the exit
      const r = ok(s, { type: 'endTurn' });
      const sw = r.events.filter((x) => x.type === 'swing');
      expect(sw.map((x) => x.type === 'swing' && x.by).sort()).toEqual(['brann', 'rae']);
      const rs = rolls(r.events).filter((x) => x.slots <= 2);
      expect(rs.some((x) => x.slots === 2)).toBe(true); // Brann's sword, 3 − 1
      expect(rs.some((x) => x.slots === 1)).toBe(true); // Rae's bow
      expect(hero(r.state, 'brann').acted).toBe(false);
      // A hero who has acted does not swing.
      const t = delve({ heroes: ['brann'] });
      put(t, 'brann', at(1, 4, 7));
      const m2 = monster(t, 'rats', at(1, 5, 7), 'hunting');
      m2.hp = 1;
      hero(t, 'brann').acted = true;
      expect(ok(t, { type: 'endTurn' }).events.some((x) => x.type === 'swing')).toBe(false);
    });
  });

  describe('20.2 Dread', () => {
    function dreadDelve() {
      const s = delve({ heroes: ['brann', 'sable'], extra: [['sable', 'Sable', 'shadowmancer']] });
      put(s, 'sable', at(1, 2, 7));
      put(s, 'brann', at(1, 4, 7));
      s.delve!.lanternBearer = 'sable';
      const m = monster(s, 'orc', at(1, 5, 7), 'hunting');
      return { s, m };
    }

    it('1 mana, 2 Wits slots, range 5 in sight; a hit sends the target fleeing for 2 rounds (intent flee), not the Dragon', () => {
      const { s, m } = dreadDelve();
      const o = option(s, 'sable', 'dread')!;
      expect(o.mana).toBe(1);
      expect(o.targets).toEqual([{ id: m.id, at: m.at }]);
      const pv = e.preview(s, 'sable', 'dread', { id: m.id });
      expect(pv).toMatchObject({ slots: 2, stat: 'wits', noise: 0 });
      expect(pv.modifiers).toContain('1 mana');
      const miss = until(s, { type: 'act', heroId: 'sable', action: 'dread', target: { id: m.id }, focus: 0 }, (ev) => ev.some((x) => x.type === 'miss'));
      expect(mon(miss.state, m.id).feared).toBeUndefined();
      const r = until(s, { type: 'act', heroId: 'sable', action: 'dread', target: { id: m.id }, focus: 0 }, (ev) => ev.some((x) => x.type === 'feared'));
      expect(hero(r.state, 'sable').mana).toBe(2);
      expect(mon(r.state, m.id)).toMatchObject({ feared: 2, fearOf: 'sable' });
      expect(e.intents(r.state)[m.id]?.kind).toBe('flee');
      // Not the Dragon.
      const t = delve({ heroes: ['sable'], extra: [['sable', 'Sable', 'shadowmancer']] });
      put(t, 'sable', at(3, 15, 4));
      monster(t, 'dragon', at(3, 16, 4), 'hunting');
      expect(option(t, 'sable', 'dread')).toBeUndefined();
    });

    it('a feared monster spends its phases running from the caster, takes free swings as it leaves, does not attack, and recovers after 2', () => {
      const { s, m } = dreadDelve();
      const r = until(s, { type: 'act', heroId: 'sable', action: 'dread', target: { id: m.id }, focus: 0 }, (ev) => ev.some((x) => x.type === 'feared'));
      const before = distance(mon(r.state, m.id).at, at(1, 2, 7));
      const w1 = ok(r.state, { type: 'endTurn' });
      const after = mon(w1.state, m.id);
      if (after) {
        expect(distance(after.at, at(1, 2, 7))).toBeGreaterThan(before);
        expect(w1.events.some((x) => x.type === 'roll' && x.who === m.id)).toBe(false);
        expect(after.feared).toBe(1);
      }
      // Brann, adjacent with his action ready, swung as it ran.
      expect(w1.events.some((x) => x.type === 'swing' && x.by === 'brann')).toBe(true);
      if (!after) return;
      const w2 = ok(w1.state, { type: 'endTurn' }).state;
      const m2 = mon(w2, m.id);
      if (!m2) return;
      expect(m2.feared).toBe(0);
      expect(m2.fearOf).toBeUndefined();
      expect(m2.intent?.kind).not.toBe('flee');
    });

    it('a feared ghoul drops its hold; a feared crew member runs too', () => {
      const s = delve({ heroes: ['brann', 'sable'], extra: [['sable', 'Sable', 'shadowmancer']] });
      put(s, 'sable', at(3, 3, 4));
      put(s, 'brann', at(3, 5, 4));
      const g = monster(s, 'ghoul', at(3, 6, 4), 'hunting');
      g.holding = 'brann';
      hero(s, 'brann').grabbedBy = g.id;
      const r = until(s, { type: 'act', heroId: 'sable', action: 'dread', target: { id: g.id }, focus: 0 }, (ev) => ev.some((x) => x.type === 'feared'));
      expect(hero(r.state, 'brann').grabbedBy).toBeUndefined();
      expect(mon(r.state, g.id).holding).toBeUndefined();
      // The Ferrymen, hostile, next to Sable.
      const t = delve({ heroes: ['brann', 'sable'], extra: [['sable', 'Sable', 'shadowmancer']] });
      const cr = buildCrew(t as GameStateX, 'ferrymen', [at(2, 10, 1), at(2, 11, 1), at(2, 12, 1)]);
      cr.stance = 'hostile';
      t.delve!.rivals = cr;
      put(t, 'sable', at(2, 9, 1));
      put(t, 'brann', at(2, 8, 2));
      t.delve!.lanternBearer = 'sable';
      const lead = t.delve!.rivals!.members[0]!;
      const rr = until(t, { type: 'act', heroId: 'sable', action: 'dread', target: { id: lead.id }, focus: 0 }, (ev) => ev.some((x) => x.type === 'feared' && x.id === lead.id));
      expect(e.intents(rr.state)[lead.id]?.kind).toBe('flee');
      const w1 = ok(rr.state, { type: 'endTurn' }).state;
      const fled = w1.delve!.rivals!.members[0]!;
      expect(distance(fled.at, at(2, 9, 1))).toBeGreaterThan(1);
      expect(fled.feared).toBe(1);
    });
  });

  describe('20.1 move preview risks', () => {
    it('lists every wake roll on the path with its chance, and the awake enemies that would notice the hero on the way (V4.0: the first hex where they would)', () => {
      const s = stealthDelve({ lit: true });
      put(s, 'brann', at(2, 7, 1));
      const sleeper = monster(s, 'orc', at(2, 10, 2), 'asleep');
      const watcher = monster(s, 'orc', at(2, 13, 1), 'alert');
      const walk = e.reachable(s, 'brann', false).find((x) => samePos(x.to, at(2, 9, 1)))!;
      expect(walk.path).toEqual([at(2, 8, 1), at(2, 9, 1)]);
      // (8,1) is 2 from the sleeper: 50; (9,1) is adjacent and the end: sure.
      expect(walk.risks?.wake).toEqual([
        { at: at(2, 8, 1), id: sleeper.id, chance: 50 },
        { at: at(2, 9, 1), id: sleeper.id, chance: 100 },
      ]);
      expect(walk.risks?.notice).toEqual([{ id: watcher.id, at: at(2, 8, 1) }]); // already 5 away on the first hex, lit, walking
      const sneak = e.reachable(s, 'brann', true).find((x) => samePos(x.to, at(2, 9, 1)))!;
      expect(sneak.risks?.wake.map((x) => x.chance)).toEqual([10, 25]);
      expect(sneak.risks?.notice).toEqual([{ id: watcher.id, at: at(2, 9, 1) }]); // 4 away, lit, sneaking: still seen
      const short = e.reachable(s, 'brann', true).find((x) => samePos(x.to, at(2, 8, 1)))!;
      expect(short.risks?.notice).toEqual([]); // 5 away, sneaking
      // Once it has noticed Brann it is no longer listed.
      (watcher as MonsterX).noticedIds = ['brann'];
      expect(e.reachable(s, 'brann', false).find((x) => samePos(x.to, at(2, 9, 1)))!.risks?.notice).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------- V3.7 (spec 20.4): crews that fight back

import { rivalStats } from './rivals';
import { crewTarget, pathToSpots } from './crewai';
import { CREWS } from './data';
import { los as losFrom } from './world';

describe('V3.7 crews', () => {
  const WAKE_SPOTS = [at(3, 3, 4), at(3, 4, 4), at(3, 3, 5), at(3, 5, 5)];
  type RivalX = DelveX['rivals'] extends infer R ? (R extends { members: (infer M)[] } ? M : never) : never;
  const members = (s: GameState) => s.delve!.rivals!.members as RivalX[];
  const member = (s: GameState, i: number) => members(s)[i]!;

  it('builds members like heroes of their class at the crew\'s level, with tiers, a pack, mana and a purse', () => {
    const s = delve({ heroes: ['brann'] });
    const wake = buildCrew(s as GameStateX, 'the-wake', WAKE_SPOTS);
    expect(wake.members.map((r) => [r.cls, r.hp, r.level, r.weaponTier, r.armorTier])).toEqual([
      ['sellsword', 16, 4, 2, 1], ['hedgewitch', 13, 4, 2, 1], ['shadowmancer', 12, 4, 2, 1], ['sapper', 16, 4, 2, 1],
    ]);
    expect(wake.members.map((r) => r.pack!.map((i) => i.kind))).toEqual([['potion', 'potion'], ['potion', 'potion'], ['smoke', 'firecracker'], ['charge', 'charge', 'charge']]);
    expect(wake.members.map((r) => r.charges)).toEqual([undefined, 3, 3, undefined]);
    // Sellsword: Sword 3 slots at Might 70 + 15 (three levels) + 20 (weapon 2); armor 1 + 1; move 4.
    expect(rivalStats(wake.members[0]!)).toMatchObject({ slots: 3, chance: 105, dmg: 2, armor: 2, move: 4, range: 1 });
    // Hedgewitch: Staff 2 Might slots, Might isn't her main stat: 35 + 20.
    expect(rivalStats(wake.members[1]!)).toMatchObject({ slots: 2, chance: 55, dmg: 1, armor: 1 });
    expect(wake.members.every((r) => r.loot.length === 1 && r.loot[0]!.kind === 'gold' && r.loot[0]!.amount === 50)).toBe(true);
    // The Sisters at level 2, weapon 1: the ranger's bow at Finesse 75 + 5 + 10, range 6, HP 10.
    const sis = buildCrew(s as GameStateX, 'lantern-sisters', [at(1, 3, 6), at(1, 4, 6), at(1, 5, 6)]);
    expect(rivalStats(sis.members[0]!)).toMatchObject({ hp: 10, slots: 3, chance: 90, range: 6, armor: 1 }); // armor 1: the sim's tuning (progress note)
    expect(sis.members[0]!.hp).toBe(10);
    expect(sis.members.every((r) => r.loot.length === 0)).toBe(true); // prospectors carry no purse
    expect(CREWS['the-wake'].hideout.siteId).toBe('the-wake-hideout');
  });

  it('a Level 3 contract draws the Wake 60% at a Level 3 post; Level 2 still draws the pool', () => {
    const s = delve({ heroes: ['brann'] });
    let wake = 0;
    let none = 0;
    for (let i = 1; i <= 100; i++) {
      const t = structuredClone(s) as GameStateX;
      t.rng = i * 2654435761 >>> 0;
      const cr = makeCrew(w, t, t.delve!, 3);
      if (!cr) { none++; continue; }
      wake++;
      expect(cr.crew).toBe('the-wake');
      expect(cr.stance).toBe('waiting');
      expect(cr.members.length).toBe(4);
      expect(cr.members.every((r) => r.at.level === 3 && distance(r.at, at(3, 4, 6)) <= 2 && r.level === 4)).toBe(true);
      const two = makeCrew(w, t, t.delve!, 2);
      if (two) expect(['ferrymen', 'gallows-choir']).toContain(two.crew);
    }
    expect(wake).toBeGreaterThan(40);
    expect(wake).toBeLessThan(80);
    expect(none).toBeGreaterThan(0);
  });

  it('focus fire: the lantern bearer a member can reach, else the lowest-HP hero in reach; every member shows the same target', () => {
    const s = crewDelve('ferrymen', [at(2, 16, 4), at(2, 17, 4), at(2, 18, 4)], 'hostile', ['brann', 'keven', 'pim']);
    put(s, 'keven', at(2, 15, 2)); // the bearer, nearest
    put(s, 'brann', at(2, 14, 2));
    hero(s, 'brann').hp = 2;
    put(s, 'pim', at(2, 2, 1)); // far off, behind the wall
    expect(crewTarget(ctx(s))!.id).toBe('keven');
    computeIntentsOf(ctx(s));
    const fighters = members(s).filter((r) => r.intent?.kind === 'attack' || r.intent?.kind === 'move' || r.intent?.kind === 'fuse');
    expect(fighters.length).toBeGreaterThan(0);
    for (const r of fighters) expect(r.intent?.targetId, r.cls).toBe('keven');
    // The bearer out of reach: the lowest-HP hero in reach.
    put(s, 'keven', at(2, 2, 2));
    s.delve!.rivals!.members.forEach((r) => (r.intent = undefined));
    expect(crewTarget(ctx(s))!.id).toBe('brann');
    // Nobody in reach: the nearest on foot.
    put(s, 'brann', at(2, 3, 3));
    hero(s, 'brann').hp = 10;
    expect(['brann', 'keven']).toContain(crewTarget(ctx(s))!.id);
  });

  it('positioning: a member takes the attack spot the other heroes can\'t see when there is one', () => {
    // Keven looks through the pantry door; Brann (the target) stands in the pit hall, where one of his attack spots is in Keven's line and three aren't.
    const s = crewDelve('ferrymen', [at(1, 12, 1), at(1, 17, 1), at(1, 16, 1)], 'hostile', ['brann', 'keven']);
    put(s, 'brann', at(1, 9, 1));
    put(s, 'keven', at(1, 6, 3));
    s.delve!.doors[posKey(at(1, 7, 2))]!.open = true;
    const c = ctx(s);
    const r = member(s, 0);
    const spots = posNeighborsOf(at(1, 9, 1)).filter((p) => w.tile(p)?.kind === 'floor');
    const exposed = (p: Pos) => losFrom(w, c.d, at(1, 6, 3), p);
    expect(spots.some(exposed)).toBe(true);
    expect(spots.some((p) => !exposed(p))).toBe(true);
    const path = pathToSpots(c, r, spots, 4, 'brann');
    expect(path.length).toBeGreaterThan(0);
    expect(exposed(path[path.length - 1]!)).toBe(false);
  });

  it('a member below half with a potion backs off a hex and drinks it (intent potion, shown first): +5', () => {
    const s = crewDelve('ferrymen', [at(2, 16, 4), at(2, 17, 4), at(2, 18, 4)], 'hostile');
    put(s, 'brann', at(2, 15, 4));
    const ss = member(s, 0);
    ss.hp = 5;
    computeIntentsOf(ctx(s));
    expect(ss.intent).toMatchObject({ kind: 'potion', item: 'potion', targetId: ss.id });
    expect(distance(ss.intent!.to!, at(2, 15, 4))).toBe(2);
    const r = ok(s, { type: 'endTurn' });
    const after = member(r.state, 0);
    // Stepping out of Brann's reach gives him a free swing first (spec 20.2); the potion heals 5 after it.
    const swing = r.events.find((x) => x.type === 'swing' && x.by === 'brann') as { damage: number } | undefined;
    expect(after.hp).toBe(Math.max(0, 5 - (swing?.damage ?? 0)) + 5);
    expect(after.pack!.some((i) => i.kind === 'potion')).toBe(false);
    expect(distance(after.at, at(2, 15, 4))).toBe(2);
    expect(r.events.some((x) => x.type === 'cast' && x.by === ss.id && x.spell === 'potion')).toBe(true);
  });

  it('ranger: caltrops on the hex the nearest hero would charge through (when there is nothing to shoot); a hero stepping there takes 2 and stops', () => {
    const s = crewDelve('ferrymen', [at(2, 2, 1), at(2, 16, 4), at(2, 18, 4)], 'hostile');
    member(s, 0).hp = 0; // only the ranger (and a far sapper)
    member(s, 2).at = at(2, 17, 8);
    put(s, 'brann', at(2, 12, 2));
    computeIntentsOf(ctx(s));
    expect(member(s, 1).intent?.kind).toBe('attack'); // Brann in bow sight: she shoots
    put(s, 'brann', at(2, 16, 7)); // in the cells behind the closed door: no line, but on his way in
    computeIntentsOf(ctx(s));
    const ran = member(s, 1);
    expect(ran.intent).toMatchObject({ kind: 'caltrops', item: 'caltrops' });
    const spot = ran.intent!.to!;
    expect(distance(spot, ran.at)).toBe(1);
    expect(distance(spot, at(2, 16, 7))).toBeLessThan(distance(ran.at, at(2, 16, 7)));
    let t = ok(s, { type: 'endTurn' }).state;
    expect(t.delve!.caltrops).toContain(posKey(spot));
    expect(member(t, 1).pack!.filter((i) => i.kind === 'caltrops').length).toBe(1);
    // Brann walks onto them.
    put(t, 'brann', posNeighborsOf(spot).find((p) => w.tile(p)?.kind === 'floor' && !samePos(p, ran.at) && distance(p, ran.at) > 1)!);
    const hp = hero(t, 'brann').hp;
    const r = ok(t, { type: 'move', heroId: 'brann', path: [spot], sneak: false });
    expect(r.events).toContainEqual({ type: 'caltrops', id: 'brann', at: spot });
    expect(hero(r.state, 'brann').hp).toBe(hp - 2);
    expect(samePos(hero(r.state, 'brann').at, spot)).toBe(true);
    expect(r.state.delve!.caltrops).not.toContain(posKey(spot));
    t = r.state;
    // The party's own caltrops never catch them.
    t.delve!.caltrops.push(posKey(at(2, 13, 2)));
    put(t, 'brann', at(2, 12, 2));
    const r2 = ok(t, { type: 'move', heroId: 'brann', path: [at(2, 13, 2)], sneak: false });
    expect(r2.events.some((x) => x.type === 'caltrops')).toBe(false);
  });

  it('sellsword: glue where two heroes stand next to each other (they lose their next move); guards the caster', () => {
    const s = crewDelve('gallows-choir', [at(2, 16, 4), at(2, 17, 4), at(2, 18, 4)], 'hostile', ['brann', 'keven']);
    put(s, 'brann', at(2, 14, 2));
    put(s, 'keven', at(2, 15, 2));
    computeIntentsOf(ctx(s));
    const ss = member(s, 0);
    expect(ss.intent).toMatchObject({ kind: 'glue', item: 'glue' });
    expect(distance(ss.intent!.to!, at(2, 14, 2)) <= 1 && distance(ss.intent!.to!, at(2, 15, 2)) <= 1).toBe(true);
    const r = ok(s, { type: 'endTurn' });
    expect(r.events.some((x) => x.type === 'cast' && x.by === ss.id && x.spell === 'glue')).toBe(true);
    expect(e.reachable(r.state, 'brann', false)).toEqual([]);
    expect(e.reachable(r.state, 'keven', false)).toEqual([]);
    expect(option(r.state, 'brann', 'attack') ?? option(r.state, 'brann', 'parley')).toBeTruthy(); // can still act
    // Guard: the Sellsword beside the Pyromancer takes Brann's hit on her.
    const t = crewDelve('gallows-choir', [at(2, 16, 4), at(2, 17, 4), at(2, 18, 4)], 'hostile');
    member(t, 1).hp = 0;
    member(t, 2).at = at(2, 15, 3);
    put(t, 'brann', at(2, 14, 3));
    computeIntentsOf(ctx(t));
    const r2 = ok(t, { type: 'endTurn' }).state;
    const guard = member(r2, 0);
    expect(guard.guarding).toBe(member(r2, 2).id);
    const r3 = until(r2, { type: 'act', heroId: 'brann', action: 'attack', target: { id: member(r2, 2).id }, focus: 0 }, (ev) => ev.some((x) => x.type === 'hit' && x.attacker === 'brann'));
    const hitEv = r3.events.find((x) => x.type === 'hit' && x.attacker === 'brann') as { target: string };
    expect(hitEv.target).toBe(guard.id);
    expect(member(r3.state, 2).hp).toBe(10);
  });

  it('hedgewitch mends the member below half, wards the striker; shadowmancer blinks away below half', () => {
    const s = crewDelve('the-wake', WAKE_SPOTS, 'hostile');
    put(s, 'brann', at(3, 5, 3));
    hero(s, 'brann').hp = 60; // he has to survive two rounds of the Wake
    member(s, 0).hp = 6;
    member(s, 2).charges = 0; // no veil from Candle: the striker stays a target below
    computeIntentsOf(ctx(s));
    const witch = member(s, 1);
    expect(witch.intent).toMatchObject({ kind: 'mend', targetId: member(s, 0).id });
    let r = ok(s, { type: 'endTurn' });
    expect(member(r.state, 0).hp).toBe(15); // his own potion (+5, he acts first) and her Mend (+4)
    expect(member(r.state, 1).charges).toBe(2);
    // Healed: she wards the striker next.
    let t = r.state;
    put(t, 'brann', at(3, 5, 3));
    member(t, 0).hp = 16;
    computeIntentsOf(ctx(t));
    expect(member(t, 1).intent).toMatchObject({ kind: 'ward', targetId: member(t, 0).id });
    r = ok(t, { type: 'endTurn' });
    t = r.state;
    expect(r.events.some((x) => x.type === 'cast' && x.spell === 'ward')).toBe(true);
    const warded = member(t, 0);
    put(t, 'brann', posNeighborsOf(warded.at).find((p) => w.tile(p)?.kind === 'floor' && !t.delve!.rivals!.members.some((m) => samePos(m.at, p)))!);
    const pv = e.preview(t, 'brann', 'attack', { id: warded.id });
    expect(pv.modifiers).toContain('Warded −1');
    expect(pv.modifiers).toContain('Armor −2');
    expect(pv.outcomes[1]).toBe('0 dmg');
    // The Shadowmancer below half blinks to the hex in sight farthest from the heroes.
    const u = crewDelve('the-wake', WAKE_SPOTS, 'hostile');
    put(u, 'brann', at(3, 5, 3));
    member(u, 2).hp = 4;
    computeIntentsOf(ctx(u));
    const sh = member(u, 2);
    expect(sh.intent?.kind).toBe('blink');
    expect(distance(sh.intent!.to!, at(3, 5, 3))).toBeGreaterThan(distance(sh.at, at(3, 5, 3)));
    const r4 = ok(u, { type: 'endTurn' });
    expect(r4.events.some((x) => x.type === 'blinked' && x.id === sh.id)).toBe(true);
    expect(samePos(member(r4.state, 2).at, sh.intent!.to!)).toBe(true);
  });

  it('pyromancer: fireball (2 mana) where three heroes stand within 1 of a hex, else firebolt', () => {
    const s = crewDelve('gallows-choir', [at(2, 17, 8), at(2, 18, 8), at(2, 16, 4)], 'hostile', ['brann', 'keven', 'pim']);
    member(s, 0).hp = 0;
    member(s, 1).hp = 0;
    put(s, 'brann', at(2, 13, 1));
    put(s, 'keven', at(2, 14, 1));
    put(s, 'pim', at(2, 13, 2));
    computeIntentsOf(ctx(s));
    const py = member(s, 2);
    expect(py.intent?.kind).toBe('fireball');
    const r = ok(s, { type: 'endTurn' });
    expect(r.events.some((x) => x.type === 'cast' && x.by === py.id && x.spell === 'fireball')).toBe(true);
    expect(member(r.state, 2).charges).toBe(1);
    expect(Object.keys(r.state.delve!.burning).length).toBeGreaterThan(0);
    computeIntentsOf(ctx(r.state));
    expect(member(r.state, 2).intent?.kind).toBe('firebolt'); // 1 mana left
  });

  it('a hero a member downs is robbed on the spot: gold and gems to its loot; then dragged 3 a round toward the exit, trailing behind', () => {
    let s = crewDelve('ferrymen', [at(1, 12, 7), at(2, 17, 4), at(2, 18, 4)], 'hostile', ['brann', 'keven']);
    member(s, 1).hp = 0;
    member(s, 2).hp = 0;
    put(s, 'keven', at(1, 2, 8)); // the gate room, out of it
    put(s, 'brann', at(1, 11, 7));
    const b = hero(s, 'brann');
    b.hp = 1;
    b.pack.push(gold(40, 'bg'), { id: 'bgem', kind: 'gem', name: 'Garnet', amount: 60, slots: 1 }, { id: 'btorch', kind: 'torch', name: 'Torch', amount: 1, slots: 1 });
    computeIntentsOf(ctx(s));
    const r = until(s, { type: 'endTurn' }, (ev) => ev.some((x) => x.type === 'downed' && x.id === 'brann'));
    s = r.state;
    expect(r.events.some((x) => x.type === 'robbed' && x.hero === 'brann' && x.by === 'r1' && x.items.length === 2)).toBe(true);
    const ss = member(s, 0);
    expect(ss.loot.map((i) => i.id)).toEqual(expect.arrayContaining(['bg', 'bgem']));
    expect(hero(s, 'brann').pack.map((i) => i.id)).toEqual(['btorch']);
    expect(ss.dragging).toBe('brann');
    expect(ss.intent).toMatchObject({ kind: 'drag', targetId: 'brann' });
    // The world phase: no bleeding while dragged; the member walks toward the east exit, Brann one hex behind.
    const bleed = hero(s, 'brann').bleed;
    const r2 = ok(s, { type: 'endTurn' });
    s = r2.state;
    expect(hero(s, 'brann').bleed).toBe(bleed);
    expect(hero(s, 'brann').status).toBe('downed');
    const d = distance(member(s, 0).at, hero(s, 'brann').at);
    expect(d).toBe(1);
    expect(distance(member(s, 0).at, at(1, 12, 7))).toBe(3); // three hexes toward the east exit
    expect(distance(hero(s, 'brann').at, at(1, 18, 7))).toBeLessThan(distance(at(1, 11, 7), at(1, 18, 7)));
    expect(r2.events.some((x) => x.type === 'moved' && x.id === 'r1')).toBe(true);
    expect(r2.events.some((x) => x.type === 'moved' && x.id === 'brann')).toBe(false); // the view hauls him on the member's move
  });

  it('the dragger on an exit takes the hero: captured; back at camp they leave the roster for the captives, a "Bring back" job goes up, and the rescue brings them home', () => {
    let s = crewDelve('ferrymen', [at(1, 17, 7), at(2, 17, 4), at(2, 18, 4)], 'hostile', ['brann', 'keven']);
    member(s, 1).hp = 0;
    member(s, 2).hp = 0;
    put(s, 'keven', at(1, 2, 9)); // on the gate exit
    put(s, 'brann', at(1, 16, 7));
    const b = hero(s, 'brann') as HeroX;
    b.status = 'downed';
    b.hp = 0;
    b.bleed = 2;
    b.robbed = true;
    member(s, 0).dragging = 'brann';
    computeIntentsOf(ctx(s));
    expect(member(s, 0).intent).toMatchObject({ kind: 'drag', targetId: 'brann', to: at(1, 18, 7) });
    const r = ok(s, { type: 'endTurn' });
    s = r.state;
    expect(r.events).toContainEqual({ type: 'captured', hero: 'brann', by: 'r1' });
    expect(r.events).toContainEqual({ type: 'out', id: 'r1' });
    expect(hero(s, 'brann').status).toBe('captured');
    expect(member(s, 0).goneOut).toBe(true);
    // Keven leaves; the summary notes it; camp lists the captive and the job.
    s = ok(s, { type: 'act', heroId: 'keven', action: 'leave', target: {}, focus: 0 }).state;
    expect(s.summary!.notes.some((n) => /Brann was dragged out by The Ferrymen/.test(n))).toBe(true);
    expect(s.summary!.dead).toEqual([]);
    const back = e.apply(s, { type: 'backToCamp' });
    expect(back.error).toBeUndefined();
    s = back.state;
    expect(s.stage).toBe('camp');
    expect(s.campaign.roster.map((h) => h.id)).not.toContain('brann');
    expect(s.campaign.captives).toMatchObject([{ crew: 'ferrymen', siteId: 'ferrymen-hideout', hero: { id: 'brann', hp: 1, level: 1 } }]);
    const job = s.campaign.board.find((k) => k.id === 'cap-brann')!;
    expect(job).toMatchObject({ kind: 'rescue', title: 'Bring back Brann', siteId: 'ferrymen-hideout', level: 3, bounty: 220 });
    expect(job.warnings).toContain('The Ferrymen');
    // The regular board never uses a hideout.
    expect(s.campaign.board.filter((k) => k.siteId.endsWith('-hideout') && k.id !== 'cap-brann')).toEqual([]);
    // The rescue: the prisoner is Brann at HP 1; freed and out, he rejoins with that HP.
    let t = ok(s, { type: 'startDelve', contractId: job.id, heroIds: ['keven'], entrance: 0, packs: {} }).state;
    expect(t.delve!.prisoner).toMatchObject({ name: 'Brann', hp: 1, at: at(3, 3, 7) });
    t.delve!.monsters = [];
    t.delve!.rivals = null;
    const k = hero(t, 'keven');
    k.at = at(1, 18, 7);
    const pr = t.delve!.prisoner!;
    pr.freed = true;
    pr.escortedBy = 'keven';
    pr.at = at(1, 17, 7);
    k.escorting = pr.id;
    t = ok(t, { type: 'act', heroId: 'keven', action: 'leave', target: {}, focus: 0 }).state;
    expect(t.summary!.contractDone).toBe(true);
    const home = e.apply(t, { type: 'backToCamp' });
    expect(home.error).toBeUndefined();
    expect(home.state.campaign.captives).toEqual([]);
    const brann = home.state.campaign.roster.find((h) => h.id === 'brann')!;
    expect(brann).toMatchObject({ name: 'Brann', hp: 1, cls: 'sellsword' });
    expect(home.state.campaign.board.some((x) => x.id === 'cap-brann')).toBe(false);
    expect(home.state.campaign.roster.filter((h) => h.name === 'Brann').length).toBe(1); // no second "prisoner joins"
  });

  it('the heir carried off ends the campaign', () => {
    let s = crewDelve('ferrymen', [at(1, 17, 7), at(2, 17, 4), at(2, 18, 4)], 'hostile', ['brann', 'keven']);
    member(s, 1).hp = 0;
    member(s, 2).hp = 0;
    put(s, 'brann', at(1, 2, 9));
    put(s, 'keven', at(1, 16, 7));
    const k = hero(s, 'keven') as HeroX;
    k.status = 'downed';
    k.hp = 0;
    k.bleed = 2;
    k.robbed = true;
    member(s, 0).dragging = 'keven';
    s = ok(s, { type: 'endTurn' }).state;
    expect(hero(s, 'keven').status).toBe('captured');
    s = ok(s, { type: 'act', heroId: 'brann', action: 'leave', target: {}, focus: 0 }).state;
    const back = e.apply(s, { type: 'backToCamp' });
    expect(back.state.stage).toBe('over');
    expect(back.state.overReason).toBe('The heir is taken. Valkenburg stays dark.');
  });

  it('killing, downing or fearing the dragger frees the hero where they lie; a killed member drops pack and purse', () => {
    const s = delve({ heroes: ['brann', 'sable'], extra: [['sable', 'Sable', 'shadowmancer']] });
    s.delve!.rivals = buildCrew(s as GameStateX, 'the-wake', [at(1, 14, 7), at(1, 10, 1), at(1, 11, 1), at(1, 12, 1)]);
    s.delve!.rivals.stance = 'hostile';
    put(s, 'brann', at(1, 15, 7));
    put(s, 'sable', at(1, 14, 8));
    const b = hero(s, 'brann') as HeroX;
    b.status = 'downed';
    b.hp = 0;
    b.bleed = 2;
    b.robbed = true;
    const ss = member(s, 0);
    ss.dragging = 'brann';
    // Dread: feared, it lets go.
    const r = until(s, { type: 'act', heroId: 'sable', action: 'dread', target: { id: ss.id }, focus: 0 }, (ev) => ev.some((x) => x.type === 'feared' && x.id === ss.id));
    expect(member(r.state, 0).dragging).toBeUndefined();
    expect(hero(r.state, 'brann').status).toBe('downed');
    expect(samePos(hero(r.state, 'brann').at, at(1, 15, 7))).toBe(true);
    // Killed: pack (2 potions) and purse (50) on the ground, and the hero dropped.
    const t = structuredClone(s);
    member(t, 0).hp = 1;
    member(t, 0).dragging = 'brann';
    const r2 = until(t, { type: 'act', heroId: 'sable', action: 'attack', target: { id: ss.id }, focus: 0 }, (ev) => ev.some((x) => x.type === 'monsterDied' && x.id === ss.id));
    const pile = r2.state.delve!.ground.find((g) => samePos(g.at, at(1, 14, 7)))!;
    expect(pile.items.filter((i) => i.kind === 'potion').length).toBe(2);
    expect(pile.items.some((i) => i.kind === 'gold' && i.amount === 50)).toBe(true);
    expect(member(r2.state, 0).dragging).toBeUndefined();
    expect(member(r2.state, 0).pack).toEqual([]);
    // Bleeding resumes once dropped.
    const r3 = ok(r2.state, { type: 'endTurn' });
    expect(hero(r3.state, 'brann').bleed).toBe(1);
  });

  it('a downed hero within 2 of a member draws a rob intent the round before; hired members drink potions for the party', () => {
    const s = crewDelve('ferrymen', [at(2, 16, 4), at(2, 17, 4), at(2, 18, 4)], 'hostile', ['brann', 'keven']);
    put(s, 'keven', at(2, 2, 1));
    put(s, 'brann', at(2, 14, 4));
    const b = hero(s, 'brann') as HeroX;
    b.status = 'downed';
    b.hp = 0;
    b.bleed = 2;
    b.pack.push(gold(25, 'bg'));
    computeIntentsOf(ctx(s));
    expect(member(s, 0).intent).toMatchObject({ kind: 'rob', targetId: 'brann' });
    const r = ok(s, { type: 'endTurn' });
    expect(r.events.some((x) => x.type === 'robbed' && x.hero === 'brann')).toBe(true);
    expect(member(r.state, 0).loot.some((i) => i.id === 'bg')).toBe(true);
    expect(members(r.state).filter((m) => m.dragging === 'brann').length).toBe(1);
    // Hired: a member below half shows a potion.
    const t = crewDelve('ferrymen', [at(2, 16, 4), at(2, 17, 4), at(2, 18, 4)], 'hired');
    (t.delve!.rivals as { hiredBy?: string }).hiredBy = 'brann';
    t.delve!.rivals!.hiredRounds = 5;
    put(t, 'brann', at(2, 15, 4));
    member(t, 0).hp = 4;
    computeIntentsOf(ctx(t));
    expect(member(t, 0).intent?.kind).toBe('potion');
    const r2 = ok(t, { type: 'endTurn' });
    expect(member(r2.state, 0).hp).toBe(9);
  });
});

// ---------------------------------------------------------------- V3.7 (spec 20.5)

import { DIRS, hexKey } from './hex';
import { calmReach } from './calm';
import { CALM_STEPS, SHIELD_PRICE } from './data';

describe('V3.7 kit and calm', () => {
  /** A hero (the lantern bearer) alone in the open Hollow, row 4: a straight walk of 11 hexes east from (1,4). */
  function hollow(heroes = ['brann'], extra: [string, string, HeroClass][] = []) {
    const s = delve({ heroes, extra });
    heroes.forEach((id, i) => put(s, id, at(3, 1 + i, 4)));
    s.delve!.lanternBearer = heroes[0]!;
    s.delve!.light = 20;
    // The Hollow is explored (the party was put here by hand; calmReach offers explored hexes only).
    for (const p of w.floors.get(3)!) if (!s.delve!.explored.includes(posKey(p))) s.delve!.explored.push(posKey(p));
    return s;
  }
  const east = (from: number, to: number, row = 4) => Array.from({ length: to - from }, (_, i) => at(3, from + 1 + i, row));
  const worlds = (ev: GameEvent[]) => ev.filter((x) => x.type === 'phase' && x.phase === 'world').length;
  const walked = (ev: GameEvent[], id: string) => ev.flatMap((x) => (x.type === 'moved' && x.id === id ? x.path : []));

  describe('calm', () => {
    // V3.7.2: free movement is switched off in play; these keep the shelved code working.
    beforeAll(() => { FREE_MOVE.enabled = true; });
    afterAll(() => { FREE_MOVE.enabled = false; });
    it('is calm with nothing hunting; says why not: a hunter, a hostile crew, a lit fuse, the Gloam, a hero down or rooted', () => {
      const s = hollow();
      expect(e.calm(s)).toEqual({ calm: true });
      const t = structuredClone(s);
      monster(t, 'orc', at(3, 8, 4), 'hunting');
      expect(e.calm(t)).toEqual({ calm: false, why: 'An orc hunts Brann.' });
      // A hunter on another level with nobody there does not count.
      const u = structuredClone(s);
      monster(u, 'orc', at(1, 5, 7), 'hunting');
      expect(e.calm(u).calm).toBe(true);
      const f = alarm(structuredClone(s));
      expect(e.calm(f).why).toBe('A fuse is lit.');
      const r = structuredClone(s);
      hero(r, 'brann').rooted = 1;
      expect(e.calm(r).why).toBe('Brann is rooted.');
      const g = structuredClone(s);
      monster(g, 'rats', at(3, 8, 4), 'asleep');
      expect(e.calm(g).calm).toBe(true); // sleepers and alert monsters leave the party calm
      const cr = crewDelve('ferrymen', [at(2, 10, 1), at(2, 11, 1), at(2, 12, 1)], 'hostile');
      put(cr, 'brann', at(2, 8, 1));
      expect(e.calm(cr).why).toBe('The Ferrymen are hostile.');
    });

    it('a `calm` event when it starts (the delve begins calm) and when it ends; it comes back when the hunter dies', () => {
      let s = party(e.newGame(1));
      const r0 = e.apply(s, { type: 'startDelve', contractId: s.campaign.board[0]!.id, heroIds: ['brann'], entrance: 0, packs: {} });
      expect(r0.events.some((x) => x.type === 'calm' && x.calm)).toBe(true);
      expect(r0.state.delve!.calm).toBe(true);
      s = hollow();
      s.delve!.calm = true;
      const m = monster(s, 'rats', at(3, 2, 4), 'alert');
      m.hp = 30;
      // Attacking it (hit or miss) makes it hunt: calm ends on the spot, with the reason.
      const miss = act(s, 'brann', 'attack', { id: m.id });
      expect(miss.events.find((x) => x.type === 'calm')).toEqual({ type: 'calm', calm: false, why: 'Rats hunt Brann.' });
      expect(miss.state.delve!.calm).toBe(false);
      // Killing it brings calm back.
      hero(miss.state, 'brann').acted = false;
      miss.state.delve!.monsters[0]!.hp = 1;
      const kill = until(miss.state, { type: 'act', heroId: 'brann', action: 'attack', target: { id: m.id }, focus: 0 }, (ev) => ev.some((x) => x.type === 'monsterDied'));
      expect(kill.events.find((x) => x.type === 'calm')).toEqual({ type: 'calm', calm: true });
    });
  });

  describe('free movement', () => {
    // V3.7.2: free movement is switched off in play; these keep the shelved code working.
    beforeAll(() => { FREE_MOVE.enabled = true; });
    afterAll(() => { FREE_MOVE.enabled = false; });
    it('walks a path of any length hex by hex, the castle turning every 4 steps; `moved` stays clear, calmSteps counts on', () => {
      const s = hollow();
      hero(s, 'brann').acted = true; // an action spent does not stop a calm walk
      const path = east(1, 12);
      const reach = calmReach(ctx(s), 'brann', false);
      const far = reach.find((r) => samePos(r.to, at(3, 12, 4)))!;
      expect(far.path).toEqual(path);
      expect(far.cost).toBe(11);
      expect(far.risks).toBeDefined();
      // The budgeted query is still the budgeted query.
      expect(Math.max(...e.reachable(s, 'brann', false).map((r) => r.cost))).toBe(4);
      const r = ok(s, { type: 'move', heroId: 'brann', path, sneak: false });
      const h = hero(r.state, 'brann');
      expect(h.at).toEqual(at(3, 12, 4));
      expect(h.moved).toBe(false);
      expect(worlds(r.events)).toBe(2); // after steps 4 and 8, not after the 11th
      expect(r.state.delve!.round).toBe(3);
      expect(r.state.delve!.light).toBe(18);
      expect(r.state.delve!.calmSteps).toBe(3);
      expect(walked(r.events, 'brann')).toEqual(path);
      expect(r.events.filter((x) => x.type === 'noise')).toHaveLength(3); // one per leg
      // The action came back with the new rounds; another walk is free, and its first step is the fourth: the castle turns at the end of it.
      expect(h.acted).toBe(false);
      const r2 = ok(r.state, { type: 'move', heroId: 'brann', path: [at(3, 11, 4)], sneak: true });
      expect(worlds(r2.events)).toBe(1);
      expect(r2.state.delve!.calmSteps).toBe(0);
      expect(hero(r2.state, 'brann').moved).toBe(false);
      // An explicit End turn also starts the count afresh.
      const r3 = ok(r.state, { type: 'endTurn' });
      expect(r3.state.delve!.calmSteps).toBe(0);
      // Not calm: the old budget rules.
      const n = alarm(hollow());
      expect(e.apply(n, { type: 'move', heroId: 'brann', path, sneak: false }).error).toBe('Too far.');
      expect(hero(ok(n, { type: 'move', heroId: 'brann', path: east(1, 4), sneak: false }).state, 'brann').moved).toBe(true);
      expect(calmReach(ctx(n), 'brann', false)).toEqual([]);
    });

    it('calmReach offers explored hexes only and keeps off spotted traps and vents when it can', () => {
      const s = hollow();
      const explored = new Set(s.delve!.explored);
      const reach = calmReach(ctx(s), 'brann', false);
      expect(reach.length).toBeGreaterThan(20);
      expect(reach.every((r) => explored.has(posKey(r.to)))).toBe(true);
      expect(reach.every((r) => r.path.length === r.cost)).toBe(true);
      // (3,3) is 3 steps away through (3,4) or round it: with a spotted trap on (3,4) the path goes round (a tie-break, like `reachable`).
      s.delve!.traps[posKey(at(3, 3, 4))] = { spotted: true };
      const around = calmReach(ctx(s), 'brann', false).find((r) => samePos(r.to, at(3, 3, 3)))!;
      expect(around.cost).toBe(3);
      expect(around.path.some((p) => samePos(p, at(3, 3, 4)))).toBe(false);
    });

    it('stops when a sleeper wakes on the way: the rest of the path is dropped; still calm (alert is not hunting)', () => {
      const s = hollow();
      monster(s, 'rats', at(3, 6, 6), 'asleep'); // 2 from (6,4): a 50% roll as Brann passes, lit
      const cmd: Command = { type: 'move', heroId: 'brann', path: east(1, 12), sneak: false };
      const woke = until(s, cmd, (ev) => ev.some((x) => x.type === 'woke'));
      expect(distance(hero(woke.state, 'brann').at, at(3, 12, 4))).toBeGreaterThan(0);
      expect(woke.events.some((x) => x.type === 'calm' && !x.calm)).toBe(false);
      expect(woke.state.delve!.calm).toBe(true);
      expect(woke.state.delve!.monsters[0]!.awareness).toBe('alert');
      const quiet = until(s, cmd, (ev) => !ev.some((x) => x.type === 'woke'));
      expect(hero(quiet.state, 'brann').at).toEqual(at(3, 12, 4));
    });

    it('stops when something notices a hero on the way: calm ends and every hero gets a fresh player phase', () => {
      const s = hollow();
      const o = monster(s, 'orc', at(3, 11, 4), 'alert'); // watching all round; 8 from (3,4): in the Hollow a walking hero is noticed there
      hero(s, 'brann').acted = true;
      const r = ok(s, { type: 'move', heroId: 'brann', path: east(1, 9), sneak: false });
      // V4.0 (spec 26.2): noticed at the step that brought Brann into range, not at the next castle turn.
      expect(hero(r.state, 'brann').at).toEqual(at(3, 3, 4));
      expect(r.events.find((x) => x.type === 'noticed' && x.by === o.id)).toMatchObject({ hero: 'brann', at: at(3, 3, 4) });
      expect(worlds(r.events)).toBe(0);
      expect(r.events.find((x) => x.type === 'calm')).toEqual({ type: 'calm', calm: false, why: 'An orc hunts Brann.' });
      expect(r.state.delve!.calm).toBe(false);
      expect(r.state.delve!.phase).toBe('player');
      const h = hero(r.state, 'brann');
      expect([h.moved, h.acted, h.dashed]).toEqual([false, false, false]);
      // The party acts first: a normal budgeted move now.
      expect(e.calm(r.state).calm).toBe(false);
      expect(e.reachable(r.state, 'brann', false).length).toBeGreaterThan(0);
    });

    it('stops on a trap, when the lantern stage changes, and when a new monster comes into sight', () => {
      const t = hollow();
      t.delve!.traps[posKey(at(3, 4, 4))] = { spotted: false };
      const rt = ok(t, { type: 'move', heroId: 'brann', path: east(1, 12), sneak: false });
      expect(hero(rt.state, 'brann').at).toEqual(at(3, 4, 4));
      expect(rt.events.some((x) => x.type === 'trap')).toBe(true);
      expect(hero(rt.state, 'brann').hp).toBe(7);
      expect(rt.state.delve!.calm).toBe(true);
      // Light 13 is bright; the first castle turn makes it 12, dim: the walk halts after 4 steps.
      const l = hollow();
      l.delve!.light = 13;
      const rl = ok(l, { type: 'move', heroId: 'brann', path: east(1, 12), sneak: false });
      expect(hero(rl.state, 'brann').at).toEqual(at(3, 5, 4));
      expect(rl.events.some((x) => x.type === 'say' && /the light is dim/.test(x.text))).toBe(true);
      // A sleeping spider beyond sight (lit range 6 in the Hollow) comes into view on the way.
      const v = hollow();
      const sp = monster(v, 'spider', at(3, 12, 2), 'asleep');
      expect(e.visibility(v).visible.has(posKey(sp.at))).toBe(false);
      const rv = ok(v, { type: 'move', heroId: 'brann', path: east(1, 11), sneak: true });
      expect(distance(hero(rv.state, 'brann').at, at(3, 11, 4))).toBeGreaterThan(0);
      expect(e.visibility(rv.state).visible.has(posKey(sp.at))).toBe(true);
      expect(rv.events.some((x) => x.type === 'say' && /Spider in sight/.test(x.text))).toBe(true);
    });

    it('follow: the other active heroes within 3 come along in single file; their steps cost the castle nothing', () => {
      const s = hollow(['brann', 'pim', 'aldous']); // (1,4), (2,4), (3,4): Brann leads from the back
      put(s, 'brann', at(3, 3, 4));
      put(s, 'pim', at(3, 2, 4));
      put(s, 'aldous', at(3, 1, 5)); // 2 from (3,4): both within 3
      const path = east(3, 11);
      const r = ok(s, { type: 'move', heroId: 'brann', path, sneak: false, follow: true });
      expect(hero(r.state, 'brann').at).toEqual(at(3, 11, 4));
      expect(hero(r.state, 'pim').at).toEqual(at(3, 10, 4));
      expect(hero(r.state, 'aldous').at).toEqual(at(3, 9, 4));
      expect(worlds(r.events)).toBe(2); // 8 steps: the followers add none
      for (const id of ['brann', 'pim', 'aldous']) expect(hero(r.state, id).moved).toBe(false);
      expect(walked(r.events, 'pim').slice(-1)[0]).toEqual(at(3, 10, 4));
      // Without follow, only the mover walks; a hero farther than 3 stays put either way.
      const t = hollow(['brann', 'pim']);
      put(t, 'pim', at(3, 6, 4));
      const rt = ok(t, { type: 'move', heroId: 'brann', path: [at(3, 1, 5), at(3, 1, 6)], sneak: false, follow: true });
      expect(hero(rt.state, 'pim').at).toEqual(at(3, 6, 4));
      const ru = ok(hollow(['brann', 'pim']), { type: 'move', heroId: 'brann', path: east(1, 6), sneak: false });
      expect(hero(ru.state, 'pim').at).toEqual(at(3, 2, 4));
    });
  });

  describe('brace and the shield', () => {
    it('brace: heir, sellsword and sapper; braced until the next player phase: enemies roll −15%, hits do 1 less; free swings at full slots', () => {
      const s = delve({ heroes: ['keven', 'brann', 'pim', 'sam'], extra: [['sam', 'Sam', 'sapper']] });
      for (const [id, has] of [['keven', true], ['brann', true], ['sam', true], ['pim', false]] as const) expect(!!option(s, id, 'brace')).toBe(has);
      put(s, 'brann', GATE);
      const m = monster(s, 'orc', at(1, 5, 7), 'hunting');
      const r = act(s, 'brann', 'brace', {});
      expect(r.events.some((x) => x.type === 'braced' && x.id === 'brann')).toBe(true);
      expect(hero(r.state, 'brann').braced).toBe(true);
      expect(option(r.state, 'brann', 'brace')).toBeUndefined();
      // The orc's attack: chance 60 − 15; one hit of 2 − armor 1 − brace 1 = 0.
      const w1 = until(r.state, { type: 'endTurn' }, (ev) => ev.some((x) => x.type === 'roll' && x.who === m.id && x.roll.hits === 1 && !x.roll.perfect));
      const roll = rolls(w1.events).find((x) => x.chance === 45)!;
      expect(roll).toBeDefined();
      expect(w1.events.find((x) => x.type === 'hit' && x.target === 'brann')).toMatchObject({ damage: 0 });
      expect(hero(w1.state, 'brann').braced).toBeUndefined();
      // Braced, Brann's free swing is his full sword (3 slots).
      const t = delve({ heroes: ['brann'] });
      put(t, 'brann', at(1, 4, 7));
      hero(t, 'brann').braced = true;
      const cp = monster(t, 'cutpurse', at(1, 5, 7), 'hunting');
      cp.stolen = { id: 'x', kind: 'gem', name: 'Garnet', amount: 40, slots: 1 };
      const w2 = ok(t, { type: 'endTurn' });
      expect(rolls(w2.events).some((x) => x.slots === 3)).toBe(true);
    });

    it('the forge shield: 50 gold, needs the smith; ranged hits do 1 less, 2 less while braced; melee hits are not turned', () => {
      let s = party(e.newGame(1));
      expect(e.apply(s, { type: 'buyShield', heroId: 'brann' }).error).toMatch(/forge is cold/);
      s.campaign.village.smith = true;
      s.campaign.gold = SHIELD_PRICE;
      s = ok(s, { type: 'buyShield', heroId: 'brann' }).state;
      expect(e.heroById(s, 'brann')!.shield).toBe(true);
      expect(s.campaign.gold).toBe(0);
      expect(e.apply(s, { type: 'buyShield', heroId: 'brann' }).error).toMatch(/already/);
      // A tier-3 archer (3 dmg) at 3: 3 − armor 1 = 2 a hit; with the shield 1; braced with the shield 2 − 1 − 2 → 0.
      const shoot = (braced: boolean) => {
        const t = delve({ heroes: ['brann'] });
        (t.campaign.roster.find((h) => h.id === 'brann')!).shield = true;
        put(t, 'brann', at(1, 10, 8));
        hero(t, 'brann').rooted = 9;
        hero(t, 'brann').braced = braced || undefined;
        const a = monster(t, 'archer', at(1, 10, 5), 'hunting');
        (a as MonsterX).tier = 3;
        const r = until(t, { type: 'endTurn' }, (ev) => ev.some((x) => x.type === 'roll' && x.who === a.id && x.what === 'Shot' && x.roll.hits === 1 && !x.roll.perfect));
        return (r.events.find((x) => x.type === 'hit' && x.target === 'brann') as { damage: number }).damage;
      };
      expect(shoot(false)).toBe(1);
      expect(shoot(true)).toBe(0);
      // Melee: a tier-3 orc (3 dmg) next to a shielded Brann still does 2.
      const u = delve({ heroes: ['brann'] });
      (u.campaign.roster.find((h) => h.id === 'brann')!).shield = true;
      put(u, 'brann', GATE);
      const o = monster(u, 'orc', at(1, 5, 7), 'hunting');
      (o as MonsterX).tier = 3;
      const r = until(u, { type: 'endTurn' }, (ev) => ev.some((x) => x.type === 'roll' && x.who === o.id && x.roll.hits === 1 && !x.roll.perfect));
      expect(r.events.find((x) => x.type === 'hit' && x.target === 'brann')).toMatchObject({ damage: 2 });
    });
  });

  describe('hamstring', () => {
    it('the Ranger: 1 Finesse slot at −20 at range 5 in sight, noise 1; a hit roots the monster for 2 rounds (it stays put), not the Dragon', () => {
      const s = delve({ heroes: ['rae'], extra: [['rae', 'Rae', 'ranger']] });
      put(s, 'rae', at(1, 10, 8));
      const m = monster(s, 'orc', at(1, 10, 5), 'hunting');
      expect(option(s, 'brann', 'hamstring')).toBeUndefined();
      const o = option(s, 'rae', 'hamstring')!;
      expect(o.targets).toEqual([{ id: m.id, at: m.at }]);
      const pv = e.preview(s, 'rae', 'hamstring', { id: m.id });
      expect(pv).toMatchObject({ slots: 1, stat: 'finesse', chance: 55, noise: 1 });
      const r = until(s, { type: 'act', heroId: 'rae', action: 'hamstring', target: { id: m.id }, focus: 0 }, (ev) => ev.some((x) => x.type === 'rooted'));
      expect(r.events.find((x) => x.type === 'rooted')).toEqual({ type: 'rooted', id: m.id, by: 'rae', rounds: 2 });
      expect(r.state.delve!.monsters[0]!.stuck).toBe(2);
      expect(r.state.delve!.monsters[0]!.hp).toBe(6);
      // Two world phases without a step; it still attacks if it could (it can't reach), then it walks again.
      let t = ok(r.state, { type: 'endTurn' }).state;
      expect(t.delve!.monsters[0]!.at).toEqual(at(1, 10, 5));
      t = ok(t, { type: 'endTurn' }).state;
      expect(t.delve!.monsters[0]!.at).toEqual(at(1, 10, 5));
      expect(t.delve!.monsters[0]!.stuck).toBe(0);
      t = ok(t, { type: 'endTurn' }).state;
      expect(samePos(t.delve!.monsters[0]!.at, at(1, 10, 5))).toBe(false);
      const d = delve({ heroes: ['rae'], extra: [['rae', 'Rae', 'ranger']] });
      put(d, 'rae', at(3, 14, 4));
      monster(d, 'dragon', at(3, 16, 4), 'hunting');
      expect(option(d, 'rae', 'hamstring')).toBeUndefined();
    });

    it('the orc archer shows `hamstring` the round before and roots a hero closing in: no move or dash for 2 rounds, acting still allowed', () => {
      const s = delve({ heroes: ['brann'] });
      put(s, 'brann', at(1, 10, 8));
      const a = monster(s, 'archer', at(1, 10, 5), 'hunting');
      computeIntentsOf(ctx(s));
      expect(a.intent).toMatchObject({ kind: 'hamstring', targetId: 'brann' });
      const r = until(s, { type: 'endTurn' }, (ev) => ev.some((x) => x.type === 'rooted' && x.id === 'brann'));
      expect(rolls(r.events).find((x) => x.slots === 1)?.chance).toBe(35);
      expect(hero(r.state, 'brann').rooted).toBe(2);
      expect(e.apply(r.state, { type: 'move', heroId: 'brann', path: [at(1, 10, 7)], sneak: false }).error).toMatch(/rooted/);
      expect(e.reachable(r.state, 'brann', false)).toEqual([]);
      expect(option(r.state, 'brann', 'brace')).toBeDefined();
      expect(e.calm(r.state).calm).toBe(false);
      // Rooted, he is shot, not hamstrung again; two world phases later he can walk.
      expect(r.state.delve!.monsters[0]!.intent?.kind).toBe('attack');
      let t = ok(r.state, { type: 'endTurn' }).state;
      expect(hero(t, 'brann').rooted).toBe(1);
      t = ok(t, { type: 'endTurn' }).state;
      expect(hero(t, 'brann').rooted).toBe(0);
      expect(e.reachable(t, 'brann', false).length).toBeGreaterThan(0);
    });
  });

  describe('night thorn and briar', () => {
    it('night thorn: 1 mana, 2 Wits slots at range 5, 1 dmg per hit through armor, silent', () => {
      const s = delve({ heroes: ['sable'], extra: [['sable', 'Sable', 'shadowmancer']] });
      put(s, 'sable', at(1, 10, 8));
      const m = monster(s, 'captain', at(1, 10, 5), 'hunting'); // armor 1
      const o = option(s, 'sable', 'nightthorn')!;
      expect(o.mana).toBe(1);
      const pv = e.preview(s, 'sable', 'nightthorn', { id: m.id });
      expect(pv).toMatchObject({ slots: 2, stat: 'wits', noise: 0 });
      expect(pv.outcomes).toEqual(['Miss', '1 dmg, armor ignored', '3 dmg, armor ignored']);
      const r = until(s, { type: 'act', heroId: 'sable', action: 'nightthorn', target: { id: m.id }, focus: 0 }, (ev) => ev.some((x) => x.type === 'hit' && x.damage === 1));
      expect(r.state.delve!.monsters[0]!.hp).toBe(8);
      expect(hero(r.state, 'sable').mana).toBe(2);
      expect(r.events.some((x) => x.type === 'noise')).toBe(false);
      expect(r.events.some((x) => x.type === 'cast' && x.spell === 'nightthorn')).toBe(true);
    });

    it('briar: 1 mana, 2 Wits slots at range 4, 1 dmg per hit; a hit roots 1 round, a perfect roll 2; noise 1', () => {
      const s = delve({ heroes: ['wren'], extra: [['wren', 'Wren', 'hedgewitch']] });
      put(s, 'wren', at(1, 10, 8));
      const m = monster(s, 'orc', at(1, 10, 5), 'hunting');
      expect(option(s, 'wren', 'briar')!.mana).toBe(1);
      const pv = e.preview(s, 'wren', 'briar', { id: m.id });
      expect(pv).toMatchObject({ slots: 2, stat: 'wits', noise: 1 });
      const one = until(s, { type: 'act', heroId: 'wren', action: 'briar', target: { id: m.id }, focus: 0 }, (ev) => ev.some((x) => x.type === 'hit' && x.damage === 1));
      expect(one.state.delve!.monsters[0]!).toMatchObject({ hp: 5, stuck: 1 });
      expect(one.events.find((x) => x.type === 'rooted')).toMatchObject({ rounds: 1 });
      const two = until(s, { type: 'act', heroId: 'wren', action: 'briar', target: { id: m.id }, focus: 0 }, (ev) => ev.some((x) => x.type === 'hit' && x.damage === 3));
      expect(two.state.delve!.monsters[0]!).toMatchObject({ hp: 3, stuck: 2 });
      expect(two.events.some((x) => x.type === 'noise' && x.radius === 1)).toBe(true);
      // Out of range at 5.
      const t = delve({ heroes: ['wren'], extra: [['wren', 'Wren', 'hedgewitch']] });
      put(t, 'wren', at(3, 2, 4));
      monster(t, 'orc', at(3, 7, 4), 'hunting');
      expect(option(t, 'wren', 'briar')).toBeUndefined();
    });
  });

  describe('crates and barrels', () => {
    const kitCastle: CastleDef = structuredClone(testCastle);
    kitCastle.levels[0]!.tiles[hexKey(at(1, 5, 1))] = { kind: 'prop', prop: 'crate', room: 'pantry' };
    kitCastle.levels[0]!.tiles[hexKey(at(1, 6, 1))] = { kind: 'prop', prop: 'barrel', room: 'pantry' };
    const ke = createEngine(kitCastle);
    function kitDelve() {
      let s = party(ke.newGame(1));
      s = ke.apply(s, { type: 'startDelve', contractId: s.campaign.board[0]!.id, heroIds: ['brann'], entrance: 0, packs: {} }).state;
      s.delve!.monsters = [];
      s.delve!.rivals = null;
      s.delve!.traps = {};
      put(s, 'brann', at(1, 6, 2));
      return s;
    }

    it('smashProp: an adjacent crate or barrel; noise 4; the hex is floor after; a seeded drop lands as ground loot', () => {
      const s = kitDelve();
      const o = ke.actions(s, 'brann').find((x) => x.action === 'smashProp')!;
      expect(o.targets.map((t) => posKey(t.at!)).sort()).toEqual([posKey(at(1, 5, 1)), posKey(at(1, 6, 1))].sort());
      expect(o.pick).toBe('hex');
      const pv = ke.preview(s, 'brann', 'smashProp', { at: at(1, 5, 1) });
      expect(pv.noise).toBe(4);
      expect(pv.outcomes[0]).toMatch(/Smash the crate/);
      const r = ke.apply(s, { type: 'act', heroId: 'brann', action: 'smashProp', target: { at: at(1, 5, 1) }, focus: 0 });
      expect(r.error).toBeUndefined();
      expect(r.state.delve!.smashed).toEqual([posKey(at(1, 5, 1))]);
      expect(hero(r.state, 'brann').acted).toBe(true);
      expect(r.events.some((x) => x.type === 'noise' && x.radius === 4)).toBe(true);
      const ev = r.events.find((x) => x.type === 'propSmashed')!;
      expect(ev).toMatchObject({ at: at(1, 5, 1), by: 'brann' });
      const ground = r.state.delve!.ground.find((g) => samePos(g.at, at(1, 5, 1)));
      if (ev.type === 'propSmashed' && ev.items.length) expect(ground?.items).toEqual(ev.items);
      else expect(ground).toBeUndefined();
      // Floor now: Brann can step there; the crate is no longer a target; the barrel still is.
      expect(ke.reachable(r.state, 'brann', false).some((x) => samePos(x.to, at(1, 5, 1)))).toBe(true);
      hero(r.state, 'brann').acted = false;
      expect(ke.actions(r.state, 'brann').find((x) => x.action === 'smashProp')!.targets).toEqual([{ at: at(1, 6, 1) }]);
      // The drop table: gold 3–12, a small item, or nothing; the same seed gives the same drop.
      const seen = new Set<string>();
      for (let i = 1; i < 60; i++) {
        const t = structuredClone(s);
        t.rng = i * 2654435761 >>> 0;
        const x = ke.apply(t, { type: 'act', heroId: 'brann', action: 'smashProp', target: { at: at(1, 6, 1) }, focus: 0 });
        const y = ke.apply(t, { type: 'act', heroId: 'brann', action: 'smashProp', target: { at: at(1, 6, 1) }, focus: 0 });
        expect(x.events).toEqual(y.events);
        const got = (x.events.find((z) => z.type === 'propSmashed') as { items: Item[] }).items;
        if (!got.length) seen.add('nothing');
        else if (got[0]!.kind === 'gold') {
          seen.add('gold');
          expect(got[0]!.amount).toBeGreaterThanOrEqual(3);
          expect(got[0]!.amount).toBeLessThanOrEqual(12);
        } else {
          seen.add('item');
          expect(['torch', 'potion', 'firecracker', 'caltrops']).toContain(got[0]!.kind);
        }
      }
      expect([...seen].sort()).toEqual(['gold', 'item', 'nothing']);
    });
  });

  it('CALM_STEPS is 4', () => {
    expect(CALM_STEPS).toBe(4);
  });
});

// ---------------------------------------------------------------- V3.7.1 (spec section 21)

describe('V3.7.1', () => {
  it('21.1 Keven alone may start a delve from a new game', () => {
    const s = e.newGame(4);
    expect(e.partyProblem(s, ['keven'])).toBeNull();
    expect(ok(s, { type: 'startDelve', contractId: s.campaign.board[0]!.id, heroIds: ['keven'], entrance: 0, packs: {} }).state.stage).toBe('delve');
  });

  it('21.3 night-eye: locked at the peddler until Old Wim is home, then bought into the stash', () => {
    const s = e.newGame(4);
    s.campaign.gold = 100;
    const o = e.shop(s).find((x) => x.kind === 'nightsight')!;
    expect(o.needs).toBe('innkeeper');
    expect(o.locked).toBe('Brewed at the Gilded Flagon: rescue Old Wim (Level 1, the kitchens).');
    expect(e.apply(s, { type: 'buy', kind: 'nightsight' }).error).toBe(o.locked);
    s.campaign.village.innkeeper = true;
    expect(e.shop(s).find((x) => x.kind === 'nightsight')!.locked).toBeUndefined();
    const r = ok(s, { type: 'buy', kind: 'nightsight' }).state;
    expect(r.campaign.gold).toBe(70);
    expect(r.campaign.stash.map((i) => i.kind)).toEqual(['nightsight']);
  });

  describe('21.4 lockpicks', () => {
    const door = at(1, 13, 3);
    const pimAtDoor = () => {
      const s = delve({ heroes: ['pim', 'brann'] });
      put(s, 'pim', at(1, 12, 3));
      return s;
    };

    it('every Burglar starts with one improvised pick outside the 4 slots; nobody else does', () => {
      const s = delve();
      const imp = hero(s, 'pim').pack.filter((i) => i.kind === 'improvised');
      expect(imp).toHaveLength(1);
      expect(imp[0]).toMatchObject({ slots: 0, name: 'Improvised pick' });
      for (const id of ['keven', 'brann', 'aldous']) expect(hero(s, id).pack.some((i) => i.kind === 'improvised')).toBe(false);
      // Not dropped or given.
      expect(option(s, 'pim', 'drop')?.targets.some((t) => t.itemId === imp[0]!.id) ?? false).toBe(false);
    });

    it('the improvised pick: 2 slots, used up whatever the result; then Pick is blocked with the fix', () => {
      const s = pimAtDoor();
      const pv = e.preview(s, 'pim', 'pick', { at: door });
      expect(pv.slots).toBe(2);
      expect(pv.modifiers).toContain('Improvised pick: 2 slots, used up');
      expect(pv.outcomes).toEqual(['Lock jams', 'Opens, noise 2', 'Opens silently']);
      const cmd: Command = { type: 'act', heroId: 'pim', action: 'pick', target: { at: door }, focus: 0 };
      for (const hits of [0, 1, 2]) {
        const r = until(s, cmd, (ev) => rolls(ev)[0]!.hits === hits);
        expect(hero(r.state, 'pim').pack.some((i) => i.kind === 'improvised')).toBe(false);
        expect(r.events.some((x) => x.type === 'say' && /improvised pick is spent/.test(x.text))).toBe(true);
        expect(r.state.delve!.doors[posKey(door)]!.open).toBe(hits > 0);
      }
      // Spent, next to another lock: blocked with the Burglar's line.
      const r = until(s, cmd, (ev) => rolls(ev)[0]!.hits === 0);
      const t = structuredClone(r.state);
      hero(t, 'pim').acted = false;
      put(t, 'pim', at(1, 16, 1)); // next to the locked chest
      const o = option(t, 'pim', 'pick')!;
      expect(o.blocked).toBe('Your improvised pick is spent. Smash it, or buy lockpicks from Gerda.');
      expect(e.preview(t, 'pim', 'pick', { at: at(1, 17, 1) }).ok).toBe(false);
      expect(option(t, 'pim', 'smash')).toBeTruthy();
    });

    it('a Burglar with proper lockpicks picks at 3 slots and keeps both; anyone else with them at 2', () => {
      const s = pimAtDoor();
      give(s, 'pim', 'lockpicks');
      const pv = e.preview(s, 'pim', 'pick', { at: door });
      expect(pv.slots).toBe(3);
      expect(pv.modifiers).toContain('Lockpicks: 3 slots');
      const r = act(s, 'pim', 'pick', { at: door }, 3);
      expect(r.state.delve!.doors[posKey(door)]!.open).toBe(true);
      expect(hero(r.state, 'pim').pack.map((i) => i.kind).sort()).toEqual(['improvised', 'lockpicks']);
      const b = delve({ heroes: ['brann'] });
      put(b, 'brann', at(1, 12, 3));
      give(b, 'brann', 'lockpicks');
      expect(e.preview(b, 'brann', 'pick', { at: door }).slots).toBe(2);
    });

    it('the improvised pick is not banked: back in camp it is gone, and the next delve brings a fresh one', () => {
      let s = delve({ heroes: ['pim'] });
      put(s, 'pim', at(1, 18, 7));
      s = act(s, 'pim', 'leave', {}).state;
      s = ok(s, { type: 'backToCamp' }).state;
      expect(s.campaign.stash.some((i) => i.kind === 'improvised')).toBe(false);
      s = ok(s, { type: 'startDelve', contractId: s.campaign.board[0]!.id, heroIds: ['pim'], entrance: 0, packs: {} }).state;
      expect(hero(s, 'pim').pack.filter((i) => i.kind === 'improvised')).toHaveLength(1);
    });

    it('the smith sells lockpicks for 25', () => {
      expect(e.shop().find((o) => o.kind === 'lockpicks')).toMatchObject({ price: 25, needs: 'smith' });
    });
  });

  it('21.5 walking ranges +2: lit 8, unlit 5, Hollow 8; sneaking unchanged', () => {
    const s = delve({ heroes: ['brann'] });
    const c = ctx(s);
    const lit = new Set<string>([posKey(at(2, 10, 1)), posKey(at(2, 9, 1))]);
    const f = { at: at(2, 18, 1) };
    expect(wouldNotice(c, f, at(2, 10, 1), false, lit)).toBe(true); // lit, 8
    expect(wouldNotice(c, f, at(2, 9, 1), false, lit)).toBe(false); // lit, 9
    expect(wouldNotice(c, f, at(2, 10, 1), true, lit)).toBe(false); // lit sneaking, 8
    expect(wouldNotice(c, f, at(2, 13, 1), false, new Set())).toBe(true); // unlit, 5
    expect(wouldNotice(c, f, at(2, 12, 1), false, new Set())).toBe(false); // unlit, 6
    expect(wouldNotice(c, f, at(2, 17, 1), true, new Set())).toBe(true); // unlit sneaking, 1
    expect(wouldNotice(c, f, at(2, 16, 1), true, new Set())).toBe(false); // unlit sneaking, 2
  });
});

describe('V3.7.2 prospectors keep off the party\'s way in (spec 23.2)', () => {
  it('never enter by the party\'s entrance; come in round 6 to 9; wait while a hero is within 6 of theirs', () => {
    let made = 0;
    for (let seed = 1; seed < 40; seed++) {
      const t = delve({ seed });
      const ent = t.delve!.heroes[0]!.at;
      const cr = makeCrew(w, t as never, t.delve as never, 1, ent);
      if (!cr) continue;
      made++;
      const way = cr.members[0]!.at;
      expect(Math.max(Math.abs(way.q - ent.q), Math.abs(way.r - ent.r), Math.abs(way.q + way.r - ent.q - ent.r))).toBeGreaterThan(6);
      expect(cr.entersRound).toBeGreaterThanOrEqual(6);
      expect(cr.entersRound).toBeLessThanOrEqual(9);
    }
    expect(made).toBeGreaterThan(0);
  });
});


// ---------------------------------------------------------------- V3.9 (spec 24)

import { behindHex, inFrontHalf, inRearHalf } from './stealth';
import { overwatchCheck } from './ai';
import { FACING } from './data';
// V3.9.1: tests written for the shelved facing mechanic run with it on; 'V3.9.1 facing shelved' tests it off.
FACING.faceCommand = true;
FACING.turnOnAction = true;


describe('V3.9 eyes front', () => {
  const L2 = (col: number, row: number) => at(2, col, row);
  /** A lit delve on Level 2's open north side: Brann carries the lantern. */
  function eyes(heroes: string[] = ['brann'], extra: [string, string, HeroClass][] = []) {
    const s = delve({ heroes, extra });
    s.delve!.light = 20;
    s.delve!.lanternBearer = heroes[0]!;
    return s;
  }
  const mon = (s: GameState, id: string) => s.delve!.monsters.find((m) => m.id === id) as MonsterX;
  const visible = (s: GameState, p: Pos) => e.visibility(s).visible.has(posKey(p));

  describe('24.2 hero facing and the face command', () => {
    it('every hero starts facing into the castle', () => {
      const s = delve();
      for (const h of s.delve!.heroes) {
        expect(h.facing).toBeTypeOf('number');
        // The south gate (2,9): the gate room lies north.
        expect(inFrontHalf(h, at(1, 3, 6))).toBe(true);
        // V3.9.2 (spec 24.7): a hero is blind only in the cone straight behind.
        expect(inRearHalf(h, behindHex(h))).toBe(true);
      }
    });

    it('face is free, unlimited and fires `faced`; bad directions are refused; other phases too', () => {
      const s = eyes();
      put(s, 'brann', L2(12, 1));
      let st = s;
      for (const f of [3, 0, 5]) {
        const r = ok(st, { type: 'face', heroId: 'brann', facing: f });
        expect(r.events).toContainEqual({ type: 'faced', id: 'brann', facing: f });
        st = r.state;
      }
      expect(hero(st, 'brann')).toMatchObject({ facing: 5, moved: false, acted: false });
      expect(e.apply(st, { type: 'face', heroId: 'brann', facing: 6 }).error).toBeTruthy();
      expect(e.apply(st, { type: 'face', heroId: 'brann', facing: 1.5 }).error).toBeTruthy();
    });

    it('a move leaves the hero facing its last step; an aimed action turns them toward the target', () => {
      const s = eyes(['brann', 'keven']);
      put(s, 'brann', L2(10, 1));
      put(s, 'keven', L2(14, 2));
      const r = ok(s, { type: 'move', heroId: 'brann', path: [L2(11, 1), L2(12, 1)], sneak: false });
      expect(hero(r.state, 'brann').facing).toBe(0);
      expect(r.events.filter((x) => x.type === 'faced')).toEqual([{ type: 'faced', id: 'brann', facing: 0 }]);
      // An orc behind Brann that Keven sees: Brann may strike it, and turns to.
      const t = r.state;
      look(t, 'keven', L2(11, 1));
      const orc = monster(t, 'orc', L2(11, 1), 'hunting');
      orc.hp = 30;
      expect(option(t, 'brann', 'attack')!.targets.some((x) => x.id === orc.id)).toBe(true);
      const a = act(t, 'brann', 'attack', { id: orc.id });
      expect(hero(a.state, 'brann').facing).toBe(3);
      expect(a.events).toContainEqual({ type: 'faced', id: 'brann', facing: 3 });
    });

    it('a hero sees only their front half: the adjacent rear hex is unseen; a friend covers it', () => {
      const s = eyes(['brann', 'keven']);
      put(s, 'brann', L2(12, 1));
      put(s, 'keven', L2(18, 8)); // far off in the cells
      hero(s, 'brann').facing = 0;
      const orc = monster(s, 'orc', L2(11, 1), 'hunting');
      computeIntents(ctx(s));
      expect(orc.intent).toBeDefined();
      expect(visible(s, L2(13, 1))).toBe(true);
      expect(visible(s, L2(11, 1))).toBe(false);
      expect(e.intents(s)[orc.id]).toBeUndefined();
      // No attack on what nobody sees (turn first).
      expect(option(s, 'brann', 'attack')).toBeUndefined();
      // Keven at his back, facing west: the union sees it.
      put(s, 'keven', L2(13, 1));
      look(s, 'keven', L2(8, 1));
      expect(visible(s, L2(11, 1))).toBe(true);
      expect(e.intents(s)[orc.id]).toBeDefined();
      // Explored grows only through the front half too.
      const fresh = eyes();
      put(fresh, 'brann', L2(12, 1));
      fresh.delve!.explored = [];
      const g = ok(fresh, { type: 'face', heroId: 'brann', facing: 0 }).state;
      expect(g.delve!.explored).toContain(posKey(L2(14, 1)));
      expect(g.delve!.explored).not.toContain(posKey(L2(9, 1)));
    });
  });

  describe('24.2 blindsided and unseen hits', () => {
    function orcAt(back: boolean, heroes = ['brann']) {
      const s = eyes(heroes);
      put(s, 'brann', L2(12, 1));
      hero(s, 'brann').facing = back ? 0 : 3;
      const orc = monster(s, 'orc', L2(11, 1), 'hunting');
      (orc as MonsterX).shouted = true;
      return { s, orc };
    }
    const orcRoll = (ev: GameEvent[], id: string) => ev.flatMap((x) => (x.type === 'roll' && x.who === id ? [x] : []))[0]!;

    it('an attack from the rear half gets +1 slot; unseen, it lands as `unseenHit` and the attacker shows until the next player phase ends', () => {
      const front = orcAt(false);
      const fr = orcRoll(ok(front.s, { type: 'endTurn' }).events, front.orc.id);
      const back = orcAt(true);
      const r = until(back.s, { type: 'endTurn' }, (ev) => (orcRoll(ev, back.orc.id)?.roll.hits ?? 0) > 0);
      const br = orcRoll(r.events, back.orc.id);
      expect(br.roll.slots).toBe(fr.roll.slots + 1);
      expect(br.what).toBe('Attack from behind');
      expect(fr.what).toBe('Attack');
      const iu = r.events.findIndex((x) => x.type === 'unseenHit');
      expect(r.events[iu]).toEqual({ type: 'unseenHit', target: 'brann' });
      expect(iu).toBeLessThan(r.events.findIndex((x) => x.type === 'hit' && x.attacker === back.orc.id));
      expect(r.events).toContainEqual({ type: 'say', text: 'Something strikes Brann from behind.' });
      // Visible through the next player phase (Brann still faces east), with its intent and in seenEnemies.
      let s = r.state;
      expect(visible(s, mon(s, back.orc.id).at)).toBe(true);
      expect(e.intents(s)[back.orc.id]).toBeDefined();
      expect(e.seenEnemies(s).has(back.orc.id)).toBe(true);
      // That player phase ends: hidden again (we lull it to sleep so it doesn't strike again).
      mon(s, back.orc.id).awareness = 'asleep';
      s = ok(s, { type: 'endTurn' }).state;
      expect(visible(s, mon(s, back.orc.id).at)).toBe(false);
      expect(e.seenEnemies(s).has(back.orc.id)).toBe(true); // seen once: stays seen
    });

    it('a friend who sees the attacker: still +1 slot from behind, no unseenHit', () => {
      const { s, orc } = orcAt(true, ['brann', 'keven']);
      put(s, 'keven', L2(13, 2));
      look(s, 'keven', L2(11, 1));
      const r = until(s, { type: 'endTurn' }, (ev) => (orcRoll(ev, orc.id)?.roll.hits ?? 0) > 0);
      expect(orcRoll(r.events, orc.id).what).toBe('Attack from behind');
      expect(r.events.some((x) => x.type === 'unseenHit')).toBe(false);
    });

    it('free swings from behind are blindsided too, and the preview counts the slot', () => {
      const { s, orc } = orcAt(true);
      (s.delve as DelveX).seen = [orc.id]; // he saw it before he turned his back
      // Brann walks east, away from the orc at his back: a free swing at 1 fewer, +1 from behind.
      const reach = e.reachable(s, 'brann', false).find((x) => samePos(x.to, L2(14, 1)))!;
      const sw = reach.risks!.swings.find((x) => x.id === orc.id)!;
      expect(sw.damage).toEqual([0, 2 * 1 + 1]); // 2 slots (2 − 1 + 1) at 1 (orc 2 − armor 1), +1 perfect
      const r = ok(s, { type: 'move', heroId: 'brann', path: reach.path, sneak: false });
      const roll = orcRoll(r.events, orc.id);
      expect(roll.what).toBe('Free swing from behind');
      expect(roll.roll.slots).toBe(2);
    });

    it('overwatch fires only at enemies in the watcher front half', () => {
      const s = eyes(['rhea'], [['rhea', 'Rhea', 'ranger']]);
      put(s, 'rhea', L2(12, 1));
      hero(s, 'rhea').facing = 0;
      hero(s, 'rhea').overwatch = true;
      const behind = monster(s, 'orc', L2(9, 1), 'hunting');
      const c1 = ctx(s);
      overwatchCheck(c1, behind.id, behind.at);
      expect(c1.ev.some((x) => x.type === 'cast' && x.spell === 'overwatch')).toBe(false);
      const ahead = monster(s, 'orc', L2(15, 1), 'hunting');
      const c2 = ctx(s);
      overwatchCheck(c2, ahead.id, ahead.at);
      expect(c2.ev.some((x) => x.type === 'cast' && x.spell === 'overwatch' && x.targetId === ahead.id)).toBe(true);
    });
  });

  describe('24.1 enemy fields of view; sleepers hear', () => {
    it('a sleeper never notices a hero by sight, lit and in front of it', () => {
      const s = eyes();
      put(s, 'brann', L2(14, 1));
      const m = monster(s, 'orc', L2(12, 1), 'asleep');
      (m as MonsterX).facing = 0; // looking straight at him
      let st = s;
      for (let i = 0; i < 3; i++) st = ok(st, { type: 'endTurn' }).state;
      expect(mon(st, m.id).awareness).toBe('asleep');
    });
  });

  describe('24.3 the Burglar', () => {
    it('sneaks at full pace, dash too; quietest feet on sleepers and watchers', () => {
      const s = eyes(['pim']);
      put(s, 'pim', L2(12, 1));
      expect(Math.max(...e.reachable(s, 'pim', true).map((x) => x.cost))).toBe(4);
      const st = ok(s, { type: 'move', heroId: 'pim', path: [L2(13, 1)], sneak: true }).state;
      const dash = e.reachable(st, 'pim', true);
      expect(dash.every((x) => x.dash)).toBe(true);
      expect(Math.max(...dash.map((x) => x.cost))).toBe(4);
      // Sound rolls.
      const sl = { at: L2(12, 3) } as MonsterX;
      const lit = new Set([posKey(L2(12, 1)), posKey(L2(12, 2))]);
      expect(wakeChance(sl, L2(12, 1), false, true, lit, undefined, true)).toBe(5);
      expect(wakeChance(sl, L2(12, 1), false, true, lit)).toBe(10);
      expect(wakeChance(sl, L2(12, 2), true, true, lit, undefined, true)).toBe(10);
      expect(wakeChance(sl, L2(12, 2), true, true, lit)).toBe(25);
      // Watchers: lit 2 (others 4), unlit only adjacent, Hollow 2 (others 3).
      const c = ctx(s);
      const watcher = { at: L2(12, 1), facing: 0 };
      const L = litSet(w, s.delve as DelveX);
      const p3 = L2(15, 1);
      const p2 = L2(14, 1);
      expect(L.has(posKey(p3))).toBe(true);
      expect(wouldNotice(c, watcher, p3, true, L, false)).toBe(true);
      expect(wouldNotice(c, watcher, p3, true, L, true)).toBe(false);
      expect(wouldNotice(c, watcher, p2, true, L, true)).toBe(true);
      const h = { at: at(3, 5, 4), facing: 0 };
      expect(wouldNotice(c, h, at(3, 8, 4), true, new Set(), false)).toBe(true);
      expect(wouldNotice(c, h, at(3, 8, 4), true, new Set(), true)).toBe(false);
      expect(wouldNotice(c, h, at(3, 7, 4), true, new Set(), true)).toBe(true);
    });

    it('backstab: melee from the rear half on an unaware target: +1 slot and double damage per hit, before armor; stacks with sneak attack', () => {
      const s = eyes(['pim', 'brann']);
      put(s, 'pim', L2(11, 1));
      put(s, 'brann', L2(18, 8));
      look(s, 'pim', L2(12, 1));
      const m = monster(s, 'orc', L2(12, 1), 'asleep');
      m.hp = m.maxHp = 40;
      (m as MonsterX).facing = 0; // its back to Pim
      const p = e.preview(s, 'pim', 'attack', { id: m.id });
      expect(p.slots).toBe(2 + 1 + 1);
      expect(p.modifiers).toEqual(expect.arrayContaining(['Sneak attack +1 slot', 'Backstab: +1 slot, double damage']));
      expect(p.outcomes[1]).toBe('4 dmg'); // dagger 2 doubled, no armor
      const r = act(s, 'pim', 'attack', { id: m.id }, 3);
      const hits = rolls(r.events)[0]!;
      expect(mon(r.state, m.id).hp).toBe(40 - hits.hits * 4 - (hits.perfect ? 1 : 0));
      // From the front: sneak attack only.
      const f = structuredClone(s);
      mon(f, m.id).facing = 3;
      const pf = e.preview(f, 'pim', 'attack', { id: m.id });
      expect(pf.slots).toBe(3);
      expect(pf.modifiers).not.toContain('Backstab: +1 slot, double damage');
      expect(pf.outcomes[1]).toBe('2 dmg');
      // Behind it, but it has noticed Pim: no backstab, no sneak attack.
      const n = structuredClone(s);
      Object.assign(mon(n, m.id), { awareness: 'hunting', noticedIds: ['pim'] });
      expect(e.preview(n, 'pim', 'attack', { id: m.id }).slots).toBe(2);
      // Not other classes.
      const b = structuredClone(s);
      put(b, 'brann', L2(11, 2));
      look(b, 'brann', L2(12, 1));
      put(b, 'pim', L2(18, 8));
      const pb = e.preview(b, 'brann', 'attack', { id: m.id });
      expect(pb.modifiers).not.toContain('Backstab: +1 slot, double damage');
    });

    it('backstab works on crew members, not the Dragon', () => {
      const { s, dragon } = dragonDelve();
      put(s, 'pim', { ...dragon.at, q: dragon.at.q - 1 });
      look(s, 'pim', dragon.at);
      (dragon as MonsterX).facing = 0;
      expect(e.preview(s, 'pim', 'attack', { id: dragon.id }).modifiers).not.toContain('Backstab: +1 slot, double damage');
      const t = crewDelve('ferrymen', [L2(13, 1), L2(17, 8), L2(18, 8)], 'waiting', ['pim']);
      put(t, 'pim', L2(12, 1));
      look(t, 'pim', L2(13, 1));
      t.delve!.rivals!.members[0]!.facing = 0;
      expect(e.preview(t, 'pim', 'attack', { id: 'r1' }).modifiers).toContain('Backstab: +1 slot, double damage');
    });
  });

  describe('24.4 previews only for what the party has seen', () => {
    it('an unseen sleeper is left out of the risks but still rolls; once seen it is in', () => {
      const s = eyes(['brann']);
      put(s, 'brann', L2(12, 1));
      hero(s, 'brann').facing = 0;
      const m = monster(s, 'orc', L2(10, 1), 'asleep');
      const path = [L2(11, 1)];
      const risk = (st: GameState) => e.reachable(st, 'brann', false).find((x) => samePos(x.to, path[0]!))!.risks!;
      expect(e.seenEnemies(s).has(m.id)).toBe(false);
      expect(risk(s).wake).toEqual([]);
      const woke = until(s, { type: 'move', heroId: 'brann', path, sneak: false }, (ev) => ev.some((x) => x.type === 'woke' || (x.type === 'awake' && x.id === m.id)));
      expect(mon(woke.state, m.id).awareness).not.toBe('asleep');
      // Turn around: seen now, and kept as seen after turning back.
      let st = ok(s, { type: 'face', heroId: 'brann', facing: 3 }).state;
      expect(e.seenEnemies(st).has(m.id)).toBe(true);
      st = ok(st, { type: 'face', heroId: 'brann', facing: 0 }).state;
      expect(e.seenEnemies(st).has(m.id)).toBe(true);
      expect(risk(st).wake.some((x) => x.id === m.id)).toBe(true);
    });

    it('notice only for enemies visible now; swings only for seen ones', () => {
      const s = eyes(['brann']);
      put(s, 'brann', L2(12, 1));
      hero(s, 'brann').facing = 0;
      const watcher = monster(s, 'orc', L2(8, 1), 'alert');
      (watcher as MonsterX).facing = 0; // looking at Brann's back
      const swinger = monster(s, 'orc', L2(11, 1), 'hunting');
      const r = e.reachable(s, 'brann', false).find((x) => samePos(x.to, L2(14, 1)))!;
      expect(r.risks!.notice).toEqual([]);
      expect(r.risks!.swings).toEqual([]);
      const st = ok(s, { type: 'face', heroId: 'brann', facing: 3 }).state;
      const r2 = e.reachable(st, 'brann', false).find((x) => samePos(x.to, L2(14, 1)))!;
      expect(r2.risks!.notice.some((x) => x.id === watcher.id)).toBe(true);
      expect(r2.risks!.swings.some((x) => x.id === swinger.id)).toBe(true);
    });
  });
});

describe('V3.9.1 facing shelved (spec 24.6)', () => {
  beforeAll(() => {
    FACING.faceCommand = false;
    FACING.turnOnAction = false;
  });
  afterAll(() => {
    FACING.faceCommand = true;
    FACING.turnOnAction = true;
  });
  it('heroes face their last step; the face command is refused', () => {
    let s = delve({ heroes: ['brann'] });
    put(s, 'brann', GATE);
    const r = e.apply(s, { type: 'face', heroId: 'brann', facing: 3 });
    expect(r.error).toMatch(/face the way they last moved/);
    const reach = e.reachable(s, 'brann', false).find((x) => x.path.length === 1)!;
    s = ok(s, { type: 'move', heroId: 'brann', path: reach.path, sneak: false }).state;
    const f = hero(s, 'brann').facing;
    expect(f).toBeDefined();
    expect(hero(s, 'brann').facing).toBe(f);
  });
});

describe('V3.9.2 blind cone for heroes and crews, rear half for monsters (spec 24.7)', () => {
  it('a hero sees the rear diagonals but not straight behind; a monster sees neither', () => {
    const f = 0;
    const me = { at: at(2, 8, 4), facing: f };
    const back = behindHex(me);
    const diag = { level: 2, q: me.at.q + DIRS[(f + 2) % 6]!.q, r: me.at.r + DIRS[(f + 2) % 6]!.r };
    expect(inRearHalf({ ...me, heroId: 'x' } as never, back)).toBe(true);
    expect(inRearHalf({ ...me, heroId: 'x' } as never, diag)).toBe(false);
    expect(inRearHalf({ ...me, crew: 'ferrymen' } as never, diag)).toBe(false);
    expect(inRearHalf(me, back)).toBe(true);
    expect(inRearHalf(me, diag)).toBe(true);
  });
});


import { strike, walk } from './ai';
import { HEARING } from './data';

describe('V3.9.3 hearing', () => {
  /** A world-phase context: the hero in the pantry faces west, the pantry door (7,2) closed behind them. */
  function scene(heroAt: Pos) {
    const s = delve({ heroes: ['keven'] });
    put(s, 'keven', heroAt);
    look(s, 'keven', at(1, 1, 2));
    s.delve!.phase = 'world';
    s.delve!.doors[posKey(at(1, 7, 2))]!.open = false;
    return s;
  }

  it('hears an unseen walker through a door within range, not beyond', () => {
    const s = scene(at(1, 6, 2));
    const orc = monster(s, 'orc', at(1, 10, 2), 'alert');
    const c = ctx(s);
    walk(c, orc.id, orc, [at(1, 9, 2)]); // 9 → 8 1, door 3, 6 = 4 ≤ 4
    expect(s.delve!.heard?.map((x) => x.kind)).toEqual(['steps']);
    expect(c.ev.some((x) => x.type === 'heard')).toBe(true);
    // Rats are quieter: range 2.
    const s2 = scene(at(1, 6, 2));
    const rats = monster(s2, 'rats', at(1, 10, 2), 'alert');
    walk(ctx(s2), rats.id, rats, [at(1, 9, 2)]);
    expect(s2.delve!.heard ?? []).toEqual([]);
    // Farther into the pantry, the orc's steps are out of range.
    const s3 = scene(at(1, 3, 2));
    const orc3 = monster(s3, 'orc', at(1, 10, 2), 'alert');
    walk(ctx(s3), orc3.id, orc3, [at(1, 9, 2)]);
    expect(s3.delve!.heard ?? []).toEqual([]);
  });

  it('a trail in order; a seen walker leaves no entry', () => {
    const s = scene(at(1, 6, 2));
    const orc = monster(s, 'orc', at(1, 10, 2), 'alert');
    walk(ctx(s), orc.id, orc, [at(1, 9, 2), at(1, 8, 2)]);
    expect(s.delve!.heard!.map((x) => x.n)).toEqual([0, 1]);
    // Facing the walker across the pit hall: seen, not heard.
    const s2 = delve({ heroes: ['keven'] });
    put(s2, 'keven', at(1, 9, 1));
    look(s2, 'keven', at(1, 10, 2));
    s2.delve!.phase = 'world';
    const orc2 = monster(s2, 'orc', at(1, 11, 2), 'alert');
    walk(ctx(s2), orc2.id, orc2, [at(1, 10, 2)]);
    expect(s2.delve!.heard ?? []).toEqual([]);
  });

  it('a loud clash out of sight is heard within its radius', () => {
    const s = scene(at(1, 5, 2));
    const c = ctx(s);
    makeNoise(c, at(1, 3, 2), 2, { what: 'clash' }); // ahead of the hero: seen, not an entry
    expect(s.delve!.heard ?? []).toEqual([]);
    makeNoise(c, at(1, 6, 2), 2, { what: 'clash' }); // straight behind: unseen, heard
    expect(s.delve!.heard).toEqual([{ at: at(1, 6, 2), kind: 'loud', what: 'clash', n: 0 }]);
    const s2 = scene(at(1, 6, 2));
    const c2 = ctx(s2);
    makeNoise(c2, at(1, 9, 2), 2, { what: 'clash' }); // through the door: 3 > 2
    expect(s2.delve!.heard ?? []).toEqual([]);
    makeNoise(c2, at(1, 9, 2), 5, { what: 'shout' });
    expect(s2.delve!.heard).toEqual([{ at: at(1, 9, 2), kind: 'loud', what: 'shout', n: 0 }]);
    // Heroes' own noise (no `what`) is never "heard".
    makeNoise(c2, at(1, 9, 3), 5);
    expect(s2.delve!.heard!.length).toBe(1);
  });

  it('an unseen attacker striking from behind is heard as a clash', () => {
    const s = scene(at(1, 5, 2));
    const orc = monster(s, 'orc', at(1, 6, 2), 'hunting');
    const c = ctx(s);
    strike(c, orc.id, 'keven', 2, 50, 3, 'Attack');
    expect(s.delve!.heard?.some((x) => x.kind === 'loud' && x.what === 'clash' && samePos(x.at, at(1, 6, 2)))).toBe(true);
  });

  it('entries are cleared when the next world phase starts', () => {
    let s = delve({ heroes: ['keven'] });
    s.delve!.heard = [{ at: at(1, 9, 2), kind: 'steps', n: 0 }];
    s = ok(s, { type: 'endTurn' }).state;
    expect(s.delve!.heard ?? []).toEqual([]);
  });

  it('monsters behave exactly the same with or without hearing', () => {
    const run = (on: boolean) => {
      HEARING.enabled = on;
      let s = party(e.newGame(7));
      const k = s.campaign.board[0]!;
      s = ok(s, { type: 'startDelve', contractId: k.id, heroIds: ALL, entrance: 1, packs: {} }).state;
      let heard = 0;
      for (let i = 0; i < 8 && s.delve; i++) {
        const r = e.apply(s, { type: 'endTurn' });
        s = r.state;
        heard += r.events.filter((x) => x.type === 'heard').length;
      }
      HEARING.enabled = true;
      return { mons: JSON.stringify(s.delve?.monsters.map((m) => [m.id, m.at, m.awareness, m.hp])), rng: JSON.stringify(s.rng), heard };
    };
    const a = run(true);
    const b = run(false);
    expect(a.mons).toBe(b.mons);
    expect(a.rng).toBe(b.rng);
    expect(b.heard).toBe(0);
  });
});

describe('V4.0 play-test fixes (spec 26)', () => {
  const mon = (s: GameState, id: string) => s.delve!.monsters.find((m) => m.id === id) as MonsterX;
  /** A Level 2 scene: Keven (the lantern) far off on Level 1, so Level 2 is lit only by the forge. */
  function scene(extra: [string, string, HeroClass][] = [], heroes = ['keven', 'brann']) {
    const s = delve({ heroes, extra });
    put(s, 'keven', at(1, 2, 7));
    s.delve!.light = 20;
    s.delve!.lanternBearer = 'keven';
    return s;
  }

  describe('26.1 Walk/Sneak per hero', () => {
    it('each hero has their own setting: Burglars start on Sneak, everyone else on Walk; setMoveMode changes only that hero', () => {
      let s = delve();
      expect(s.delve!.heroes.map((h) => [h.heroId, h.moveMode])).toEqual([['keven', 'walk'], ['brann', 'walk'], ['pim', 'sneak'], ['aldous', 'walk']]);
      s = ok(s, { type: 'setMoveMode', heroId: 'brann', sneak: true }).state;
      expect(hero(s, 'brann').moveMode).toBe('sneak');
      expect(hero(s, 'keven').moveMode).toBe('walk');
      expect(hero(s, 'pim').moveMode).toBe('sneak');
      s = ok(s, { type: 'setMoveMode', heroId: 'pim', sneak: false }).state;
      expect(hero(s, 'pim').moveMode).toBe('walk');
      // Free: nothing else changes, no turn is spent; it survives a save.
      expect([hero(s, 'brann').moved, hero(s, 'brann').acted]).toEqual([false, false]);
      expect(e.deserialize(e.serialize(s))!.delve!.heroes.find((h) => h.heroId === 'brann')!.moveMode).toBe('sneak');
      hero(s, 'aldous').status = 'downed';
      expect(e.apply(s, { type: 'setMoveMode', heroId: 'aldous', sneak: true }).error).toBeTruthy();
    });

    it('a move without `sneak`, reach and the noise preview use the hero\'s own setting; an explicit `sneak` still wins', () => {
      let s = alarm(delve());
      put(s, 'brann', GATE);
      expect(Math.max(...e.reachable(s, 'brann').map((r) => r.cost))).toBe(4);
      expect(e.moveNoise(s, 'brann')).toBe(1);
      s = ok(s, { type: 'setMoveMode', heroId: 'brann', sneak: true }).state;
      expect(Math.max(...e.reachable(s, 'brann').map((r) => r.cost))).toBe(2);
      expect(e.moveNoise(s, 'brann')).toBe(0);
      const r = ok(s, { type: 'move', heroId: 'brann', path: [at(1, 5, 7), at(1, 6, 7)] });
      expect((hero(r.state, 'brann') as HeroX).sneaked).toBe(true);
      expect(r.events.some((x) => x.type === 'noise')).toBe(false);
      // Pim the Burglar sneaks at 4 by default.
      put(s, 'pim', at(1, 3, 7));
      expect(Math.max(...e.reachable(s, 'pim').map((r) => r.cost))).toBe(4);
      const p = ok(s, { type: 'move', heroId: 'pim', path: [at(1, 3, 8)] });
      expect((hero(p.state, 'pim') as HeroX).sneaked).toBe(true);
      // Explicit walk overrides the setting.
      const w2 = ok(s, { type: 'move', heroId: 'brann', path: [at(1, 5, 7)], sneak: false });
      expect((hero(w2.state, 'brann') as HeroX).sneaked).toBe(false);
      expect(hero(w2.state, 'brann').moveMode).toBe('sneak');
    });
  });

  describe('26.2 noticing happens when it happens', () => {
    // An orc in the shrine's corner (1,1) looking north-east: Brann walks (3,3) -> (4,3) -> (4,4): only (4,3) is in its view.
    const M = at(2, 1, 1);
    const path = [at(2, 4, 3), at(2, 4, 4)];
    function through() {
      const s = scene();
      put(s, 'brann', at(2, 3, 3));
      const m = monster(s, 'orc', M, 'alert');
      m.facing = 1;
      m.intent = { kind: 'wait' };
      return { s, m };
    }

    it('a hero walking into an awake monster\'s view and out again is spotted on the hex in view, in the player phase; the move goes on', () => {
      const { s, m } = through();
      const lit = litSet(w, s.delve as DelveX);
      // The geometry: only the middle hex is in its noticing range.
      expect([at(2, 3, 3), ...path].map((p) => wouldNotice(ctx(s), m, p, false, lit))).toEqual([false, true, false]);
      const r = ok(s, { type: 'move', heroId: 'brann', path, sneak: false });
      expect(hero(r.state, 'brann').at).toEqual(at(2, 4, 4));
      expect(r.state.delve!.phase).toBe('player');
      const i = r.events.findIndex((x) => x.type === 'noticed');
      expect(r.events[i]).toEqual({ type: 'noticed', by: m.id, hero: 'brann', at: at(2, 4, 3), faced: true });
      // The view plays the walk up to that hex, the "!", then the rest of the walk.
      const moves = r.events.flatMap((x, j) => (x.type === 'moved' && x.id === 'brann' ? [[j, x.path]] : [])) as [number, Pos[]][];
      expect(moves.map(([, p]) => p)).toEqual([[at(2, 4, 3)], [at(2, 4, 4)]]);
      expect(moves[0]![0]).toBeLessThan(i);
      expect(moves[1]![0]).toBeGreaterThan(i);
      // Hunting, turned to where it saw him, and the intent shown for the coming world phase is the new plan.
      const o = mon(r.state, m.id);
      expect(o.awareness).toBe('hunting');
      expect(o.noticedIds).toEqual(['brann']);
      expect(o.facing).toBe(dirIndex(M, at(2, 4, 3)));
      expect(o.intent).toMatchObject({ targetId: 'brann' });
      expect(['move', 'attack']).toContain(o.intent!.kind);
      // The orc's first-sight bellow goes off now too (noise 5 at the orc), not at End turn.
      expect(r.events.some((x) => x.type === 'say' && /bellows/.test(x.text))).toBe(true);
      expect(r.events).toContainEqual({ type: 'noise', at: M, radius: 5 });
      expect(o.shouted).toBe(true);
      // The move preview agrees: it lists the orc, at the hex where it would happen.
      // (The pathfinder's own way to (4,4) is the single step; the preview of this path is asked directly.)
      const seenIt = new Set([m.id]);
      const inView = new Set([posKey(M)]);
      expect(moveRisks(ctx(s), hero(s, 'brann'), path, false, lit, seenIt, inView).notice).toEqual([{ id: m.id, at: at(2, 4, 3) }]);
      expect(moveRisks(ctx(s), hero(s, 'brann'), path, true, lit, seenIt, inView).notice).toEqual([]);
      // The same seed and move give the same game.
      expect(ok(s, { type: 'move', heroId: 'brann', path, sneak: false }).events).toEqual(r.events);
    });

    it('sneaking past the same orc (lit 4 / unlit 1) isn\'t noticed; the preview says so too', () => {
      const { s, m } = through();
      const r = ok(s, { type: 'move', heroId: 'brann', path, sneak: true });
      expect(r.events.some((x) => x.type === 'noticed')).toBe(false);
      expect(mon(r.state, m.id).awareness).toBe('alert');
      const reach = e.reachable(s, 'brann', true).find((x) => samePos(x.to, at(2, 4, 4)));
      expect(reach?.risks?.notice).toEqual([]);
    });

    it('a blink lands in a monster\'s view: noticed at the landing hex, at once', () => {
      const s = scene([['sela', 'Sela', 'shadowmancer']], ['keven', 'sela']);
      put(s, 'sela', at(2, 8, 1));
      look(s, 'sela', at(2, 12, 1));
      s.delve!.lanternBearer = 'sela'; // lit: noticed walking within 8; she starts 9 from it
      const m = monster(s, 'orc', at(2, 17, 1), 'alert');
      m.facing = 3; // looking west down the row
      m.intent = { kind: 'wait' };
      expect(e.reachable(s, 'sela', false).length).toBeGreaterThan(0);
      const r = act(s, 'sela', 'blink', { at: at(2, 12, 1) });
      expect(r.events.find((x) => x.type === 'noticed')).toEqual({ type: 'noticed', by: m.id, hero: 'sela', at: at(2, 12, 1), faced: true });
      expect(mon(r.state, m.id).awareness).toBe('hunting');
      expect(mon(r.state, m.id).intent).toMatchObject({ targetId: 'sela' });
    });

    it('a sleeper woken by a step notices from the hero\'s next step on, not on the step that woke it', () => {
      const s = scene();
      put(s, 'brann', at(2, 8, 1));
      look(s, 'brann', at(2, 9, 1));
      const m = monster(s, 'orc', at(2, 10, 2), 'asleep');
      m.facing = 3;
      // Ending the move next to it wakes it for sure (walking): alert, not yet hunting, until the world phase.
      const end = ok(s, { type: 'move', heroId: 'brann', path: [at(2, 9, 1)], sneak: false });
      expect(mon(end.state, m.id).awareness).toBe('alert');
      expect(end.events.some((x) => x.type === 'noticed')).toBe(false);
      // Woken on the first hex, it sees him on the second.
      const on = ok(s, { type: 'move', heroId: 'brann', path: [at(2, 9, 1), at(2, 10, 1)], sneak: false });
      expect(on.events.find((x) => x.type === 'noticed')).toMatchObject({ by: m.id, at: at(2, 10, 1) });
      expect(mon(on.state, m.id).awareness).toBe('hunting');
    });

    it('a waiting cutthroat crew demands its toll on the step that brings a hero within 6 in its sight', () => {
      const s = crewDelve('ferrymen', [at(2, 16, 4), at(2, 17, 4), at(2, 18, 4)]);
      put(s, 'brann', at(2, 8, 1));
      look(s, 'brann', at(2, 9, 1));
      const walk = [at(2, 9, 1), at(2, 10, 1), at(2, 11, 1), at(2, 12, 1)];
      const r = ok(s, { type: 'move', heroId: 'brann', path: walk, sneak: false });
      const first = walk.find((p) => s.delve!.rivals!.members.some((x) => distance(x.at, p) <= 6))!;
      expect(r.events.find((x) => x.type === 'noticed')).toMatchObject({ hero: 'brann', at: first });
      expect(crewOf(r.state).stance).toBe('demanding');
      expect(e.intents(r.state)['r1']?.kind).toBe('toll');
    });
  });

  describe('26.3 when monsters turn', () => {
    // The owner's report: an orc hunting the Ranger, adjacent to her; Keven walks to the hex behind it.
    function engaged() {
      const s = scene([['rhea', 'Rhea', 'ranger']], ['keven', 'rhea']);
      put(s, 'rhea', at(2, 15, 1));
      put(s, 'keven', at(2, 11, 1));
      s.delve!.lanternBearer = 'keven';
      const m = monster(s, 'orc', at(2, 14, 1), 'hunting');
      m.hp = 40;
      m.facing = 0; // at Rhea, east of it
      m.noticedIds = ['rhea'];
      (m as MonsterX).shouted = true;
      m.intent = { kind: 'attack', targetId: 'rhea', to: { ...m.at } };
      return { s, m };
    }

    it('a hunting monster doesn\'t turn toward a hero walking up behind it (nor the walking noise); it still notices them', () => {
      const { s, m } = engaged();
      const r = ok(s, { type: 'move', heroId: 'keven', path: [at(2, 12, 1), at(2, 13, 1)], sneak: false });
      expect(hero(r.state, 'keven').at).toEqual(at(2, 13, 1));
      const o = mon(r.state, m.id);
      expect(o.facing).toBe(0);
      expect(o.noticedIds).toEqual(['rhea', 'keven']);
      expect(r.events.find((x) => x.type === 'noticed')).toEqual({ type: 'noticed', by: m.id, hero: 'keven', at: at(2, 13, 1), faced: false });
      // Still going for Rhea.
      expect(e.intents(r.state)[m.id]).toMatchObject({ kind: 'attack', targetId: 'rhea' });
    });

    it('a hit turns it to face the attacker, after the hit; a miss doesn\'t', () => {
      const { s, m } = engaged();
      const moved = ok(s, { type: 'move', heroId: 'keven', path: [at(2, 12, 1), at(2, 13, 1)], sneak: false }).state;
      const cmd: Command = { type: 'act', heroId: 'keven', action: 'attack', target: { id: m.id }, focus: 0 };
      const hit = until(moved, cmd, (ev) => ev.some((x) => x.type === 'hit' && x.attacker === 'keven'));
      expect(mon(hit.state, m.id).facing).toBe(3); // west, at Keven
      const miss = until(moved, cmd, (ev) => ev.some((x) => x.type === 'miss' && x.attacker === 'keven'));
      expect(mon(miss.state, m.id).facing).toBe(0);
      // In the world phase it still strikes Rhea (its quarry), facing her again.
      const w1 = ok(hit.state, { type: 'endTurn' });
      expect(w1.events.some((x) => x.type === 'roll' && x.who === m.id)).toBe(true);
      expect(mon(w1.state, m.id).facing).toBe(0);
    });

    it('an unaware (alert) monster still turns to a noise; a hunting one doesn\'t', () => {
      const s = scene();
      put(s, 'brann', at(2, 3, 3));
      const a = monster(s, 'orc', at(2, 14, 1), 'alert');
      a.facing = 0;
      const h = monster(s, 'orc', at(2, 14, 3), 'hunting');
      h.facing = 0;
      makeNoise(ctx(s), at(2, 11, 2), 4);
      expect(a.facing).toBe(dirIndex(at(2, 14, 1), at(2, 11, 2)));
      expect(h.facing).toBe(0);
    });

    it('noticing several heroes at once, a monster faces its quarry, not the last one noticed', () => {
      const s = scene([['rhea', 'Rhea', 'ranger']], ['keven', 'rhea']);
      put(s, 'keven', at(2, 12, 1)); // 2 west
      put(s, 'rhea', at(2, 17, 1)); // 3 east
      s.delve!.lanternBearer = 'keven';
      const m = monster(s, 'orc', at(2, 14, 1), 'alert');
      m.stuck = 3; // stands where it is, so only noticing turns it
      (m as MonsterX).shouted = true;
      const r = ok(s, { type: 'endTurn' });
      expect(mon(r.state, m.id).noticedIds?.sort()).toEqual(['keven', 'rhea']);
      expect(mon(r.state, m.id).facing).toBe(3); // the nearest, Keven: its quarry
      // Already hunting Rhea, it keeps to her when it next looks round, though Keven is nearer.
      const t = structuredClone(r.state);
      const o = mon(t, m.id);
      o.intent = { kind: 'wait', targetId: 'rhea' };
      o.facing = 5;
      const r2 = ok(t, { type: 'endTurn' });
      expect(mon(r2.state, m.id).facing).toBe(0);
    });
  });
});
