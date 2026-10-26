// V4.0 (spec 27): monster sight by mood. Unaware monsters see ahead, catch the corner of their eye at their
// sides and nothing straight behind; searching and hunting monsters see their sides fully; every awake monster
// looks at every hero whenever anything moves (or the light changes); one that notices turns, hunts and looks
// again (blowing friends' cover); the move preview plays the same through the monsters' eyes.

import { describe, it, expect } from 'vitest';
import { createEngine } from './engine';
import { at, testCastle } from './test/testCastle';
import { distance, posKey, samePos, type Pos } from './hex';
import type { Command, GameEvent, GameState, Monster, MonsterKind } from './types';
import { MONSTERS, SEARCH_ROUNDS } from './data';
import { litSet, World } from './world';
import type { DelveX, GameStateX, HeroX, MonsterX } from './state';
import { bearingOf, moodOf, moveRisks, wouldNotice } from './stealth';
import { makeHero } from './camp';
import { makeNoise } from './common';

const e = createEngine(testCastle);
const w = new World(testCastle);
const L2 = (col: number, row: number) => at(2, col, row);

/** Keven, Brann (sellsword) and Pim (burglar) on Level 2, the lantern full; no monsters, crews or traps; never calm. */
function scene(heroes = ['keven', 'brann', 'pim']): GameState {
  let s = e.newGame(1);
  s.campaign.roster.push(makeHero('brann', 'Brann', 'sellsword'), makeHero('pim', 'Pim', 'burglar'));
  const k = s.campaign.board[0]!;
  const r = e.apply(s, { type: 'startDelve', contractId: k.id, heroIds: heroes, entrance: 0, packs: {} });
  expect(r.error).toBeUndefined();
  s = r.state;
  const d = s.delve as DelveX;
  d.monsters = [];
  d.rivals = null;
  d.traps = {};
  d.light = 20;
  d.lanternOpen = true;
  d.fuses = [{ at: at(3, 5, 5), rounds: 99, by: 'x' }]; // a far fuse: the budgeted move rules, not a calm walk
  // Everyone parked out of the way on Level 1 until placed.
  heroes.forEach((id, i) => put(s, id, at(1, 2 + i, 7)));
  return s;
}

function put(s: GameState, id: string, p: Pos, opts: { sneaking?: boolean } = {}): void {
  const h = s.delve!.heroes.find((x) => x.heroId === id)!;
  h.at = { ...p };
  if (opts.sneaking !== undefined) (h as HeroX).sneaked = opts.sneaking;
}

const hero = (s: GameState, id: string) => s.delve!.heroes.find((h) => h.heroId === id)!;
const mon = (s: GameState, id: string) => s.delve!.monsters.find((m) => m.id === id) as MonsterX;

type Mood = 'unaware' | 'searching' | 'hunting';
/** A hand-placed awake monster: unaware = alert at its post (no search running), searching = alert with search rounds. */
function monster(s: GameState, kind: MonsterKind, p: Pos, mood: Mood, facing: number, id = `m${s.delve!.monsters.length + 1}`): MonsterX {
  const def = MONSTERS[kind];
  const m: Monster = { id, kind, name: def.name, at: { ...p }, hp: def.hp, maxHp: def.hp, awareness: mood === 'hunting' ? 'hunting' : 'alert', spawnedAt: { ...p }, facing };
  if (mood === 'searching') m.searchRounds = SEARCH_ROUNDS;
  if (mood !== 'unaware') m.focusAt = { ...p };
  s.delve!.monsters.push(m);
  return m as MonsterX;
}

function ok(s: GameState, cmd: Command) {
  const r = e.apply(s, cmd);
  expect(r.error).toBeUndefined();
  return r;
}

function ctx(s: GameState) {
  return { w, s: s as GameStateX, d: s.delve as DelveX, ev: [] as GameEvent[] };
}

const noticed = (ev: GameEvent[]) => ev.flatMap((x) => (x.type === 'noticed' ? [{ by: x.by, hero: x.hero }] : []));

// The watcher used below: an orc at (10,2) on Level 2 looking east (DIRS 0). Around it (bearing, distance):
// (9,1) side 1, (8,1) side 2, (8,4) side 3; (9,2) behind 1, (8,2) behind 2; (11,2) front 1, (13,2) front 3, (15,2) front 5.
const M = L2(10, 2);
const ALL_LIT = new Set<string>();
for (let col = 0; col < 20; col++) for (let row = 0; row < 10; row++) ALL_LIT.add(posKey(L2(col, row)));
const NONE_LIT = new Set<string>();

describe('V4.0 sight by mood (spec 27)', () => {
  it('the geometry: front, sides, behind', () => {
    const f = { at: M, facing: 0 };
    expect(bearingOf(f, L2(11, 2))).toBe('front');
    expect(bearingOf(f, L2(13, 2))).toBe('front');
    expect(bearingOf(f, L2(9, 1))).toBe('side');
    expect(bearingOf(f, L2(8, 1))).toBe('side');
    expect(bearingOf(f, L2(8, 4))).toBe('side');
    expect(bearingOf(f, L2(9, 2))).toBe('back');
    expect(bearingOf(f, L2(8, 2))).toBe('back');
    expect([distance(M, L2(9, 1)), distance(M, L2(8, 1)), distance(M, L2(8, 4)), distance(M, L2(8, 2)), distance(M, L2(13, 2))]).toEqual([1, 2, 3, 2, 3]);
    expect(bearingOf({ at: M }, L2(9, 2))).toBe('front'); // no facing: all round
  });

  describe('unaware (at its post or on patrol)', () => {
    const s = scene();
    const c = ctx(s);
    const m = monster(s, 'orc', M, 'unaware', 0);
    const sees = (p: Pos, sneaking: boolean, lit = ALL_LIT, quiet = false) => wouldNotice(c, m, p, sneaking, lit, quiet);

    it('front: today\'s ranges (lit 8/4, Burglar sneaking 2; unlit 5/1)', () => {
      expect(moodOf(m)).toBe('unaware');
      expect(sees(L2(13, 2), true)).toBe(true); // lit sneak 4
      expect(sees(L2(15, 2), true)).toBe(false);
      expect(sees(L2(13, 2), true, ALL_LIT, true)).toBe(false); // a sneaking Burglar: 2
      expect(sees(L2(12, 2), true, ALL_LIT, true)).toBe(true);
      expect(sees(L2(15, 2), false, NONE_LIT)).toBe(true); // unlit walk 5
      expect(sees(L2(12, 2), true, NONE_LIT)).toBe(false); // unlit sneak 1
      expect(sees(L2(11, 2), true, NONE_LIT)).toBe(true);
    });

    it('sides: a walker within 2 (not 3); anyone adjacent, sneaking or not, but a sneaking Burglar', () => {
      expect(sees(L2(8, 1), false)).toBe(true); // walking, side 2
      expect(sees(L2(8, 1), false, NONE_LIT)).toBe(true); // ... light or not
      expect(sees(L2(8, 4), false)).toBe(false); // walking, side 3, lit
      expect(sees(L2(9, 1), true)).toBe(true); // sneaking, side, adjacent
      expect(sees(L2(9, 1), true, NONE_LIT)).toBe(true);
      expect(sees(L2(8, 1), true)).toBe(false); // sneaking, side 2, lit
      expect(sees(L2(9, 1), true, ALL_LIT, true)).toBe(false); // a sneaking Burglar adjacent at its side: quietest feet
      expect(sees(L2(9, 1), false, ALL_LIT, true)).toBe(true); // ... walking, seen
    });

    it('behind: a walker adjacent is heard; a sneaking hero never', () => {
      expect(sees(L2(9, 2), false)).toBe(true);
      expect(sees(L2(8, 2), false)).toBe(false);
      expect(sees(L2(9, 2), true)).toBe(false);
    });
  });

  for (const mood of ['searching', 'hunting'] as const) {
    it(`${mood}: front and sides at the full ranges, behind as unaware (walking adjacent only); hunting = searching for heroes not yet noticed`, () => {
      const s = scene();
      const c = ctx(s);
      const m = monster(s, 'orc', M, mood, 0);
      expect(moodOf(m)).toBe(mood);
      const sees = (p: Pos, sneaking: boolean, lit = ALL_LIT, quiet = false) => wouldNotice(c, m, p, sneaking, lit, quiet);
      expect(sees(L2(8, 4), false)).toBe(true); // walking, side 3, lit
      expect(sees(L2(8, 4), true)).toBe(true); // sneaking, side 3, lit (4)
      expect(sees(L2(8, 1), true, NONE_LIT)).toBe(false); // sneaking, side 2, unlit (1)
      expect(sees(L2(9, 1), true, ALL_LIT, true)).toBe(true); // a sneaking Burglar adjacent at its side is seen now
      expect(sees(L2(8, 1), true, ALL_LIT, true)).toBe(true); // ... and within 2 lit
      expect(sees(L2(9, 2), false)).toBe(true);
      expect(sees(L2(9, 2), true)).toBe(false);
      expect(sees(L2(8, 2), false)).toBe(false);
    });
  }

  describe('at its post vs searching', () => {
    it('alert with no search running is unaware; a noise sends it searching; when the search runs out it is unaware again', () => {
      const s = scene();
      const m = monster(s, 'archer', M, 'unaware', 0);
      put(s, 'brann', L2(8, 4), { sneaking: true });
      expect(moodOf(m)).toBe('unaware');
      expect(wouldNotice(ctx(s), m, L2(8, 4), true, ALL_LIT)).toBe(false);
      // A noise: it turns to it and starts the search (?).
      const c = ctx(s);
      makeNoise(c, L2(12, 2), 3);
      expect(m.awareness).toBe('alert');
      expect(m.searchRounds).toBe(SEARCH_ROUNDS);
      expect(moodOf(m)).toBe('searching');
      expect(wouldNotice(c, m, L2(8, 4), true, ALL_LIT)).toBe(true); // searching: its sides at the full ranges (lit sneak 4)
      // Back to the post after SEARCH_ROUNDS world phases (nobody in view).
      put(s, 'brann', at(1, 3, 7));
      let st: GameState = s;
      for (let i = 0; i < SEARCH_ROUNDS; i++) st = ok(st, { type: 'endTurn' }).state;
      expect(mon(st, m.id).searchRounds).toBeUndefined();
      expect(moodOf(mon(st, m.id))).toBe('unaware');
    });

    it('a save from before spec 27 (alert without searchRounds) loads as unaware', () => {
      const s = scene();
      const m = monster(s, 'orc', M, 'unaware', 0);
      const back = e.deserialize(e.serialize(s))!;
      const bm = mon(back, m.id);
      expect(bm.searchRounds).toBeUndefined();
      expect(moodOf(bm)).toBe('unaware');
      expect(wouldNotice(ctx(back), bm, L2(8, 4), false, ALL_LIT)).toBe(false);
      expect(wouldNotice(ctx(back), bm, L2(8, 1), false, ALL_LIT)).toBe(true);
    });
  });

  describe('monsters look whenever anything moves', () => {
    it('the lantern carried past lights a sneaking friend: noticed at that step (the bearer behind it is not); the preview says so', () => {
      const s = scene(['keven', 'brann']);
      s.delve!.lanternBearer = 'brann';
      const m = monster(s, 'archer', M, 'unaware', 0);
      put(s, 'keven', L2(13, 2), { sneaking: true }); // front 3, unlit: unlit sneak 1
      put(s, 'brann', L2(7, 2), { sneaking: true }); // straight behind it, 3 away
      const path = [L2(8, 2), L2(9, 2)];
      expect(litSet(w, s.delve as DelveX).has(posKey(L2(13, 2)))).toBe(false);
      const pv = moveRisks(ctx(s), hero(s, 'brann'), path, true, litSet(w, s.delve as DelveX), new Set([m.id]), new Set([posKey(M)]));
      expect(pv.notice).toEqual([{ id: m.id, at: L2(9, 2), hero: 'keven' }]);
      const r = ok(s, { type: 'move', heroId: 'brann', path, sneak: true });
      expect(noticed(r.events)).toEqual([{ by: m.id, hero: 'keven' }]);
      expect(r.events.find((x) => x.type === 'noticed')).toMatchObject({ at: L2(13, 2), faced: true });
      // It noticed Keven as the lantern came within 4 of him: the walk was split there.
      const i = r.events.findIndex((x) => x.type === 'noticed');
      const moves = r.events.flatMap((x, j) => (x.type === 'moved' && x.id === 'brann' ? [[j, x.path]] : [])) as [number, Pos[]][];
      expect(moves.map(([, p]) => p)).toEqual([[L2(8, 2), L2(9, 2)]]);
      expect(moves[0]![0]).toBeLessThan(i);
      expect(mon(r.state, m.id).awareness).toBe('hunting');
      expect(mon(r.state, m.id).noticedIds).toEqual(['keven']); // Brann sneaked in straight behind it: never
    });

    it('opening the lantern next to a sneaking hero lets monsters look again at once', () => {
      const s = scene(['keven', 'brann']);
      s.delve!.lanternBearer = 'keven';
      s.delve!.lanternOpen = false;
      const m = monster(s, 'archer', M, 'unaware', 0);
      put(s, 'keven', L2(13, 2), { sneaking: true }); // front 3: unlit sneak 1, lit 4
      put(s, 'brann', at(1, 2, 7));
      const r = ok(s, { type: 'act', heroId: 'keven', action: 'shutter', target: { id: 'keven' }, focus: 0 });
      expect(r.state.delve!.lanternOpen).toBe(true);
      expect(noticed(r.events)).toEqual([{ by: m.id, hero: 'keven' }]);
      expect(mon(r.state, m.id).awareness).toBe('hunting');
      // Shuttering it again changes nothing for a monster already hunting him.
      expect(noticed(ok(r.state, { type: 'act', heroId: 'keven', action: 'shutter', target: { id: 'keven' }, focus: 0 }).events)).toEqual([]);
    });
  });

  describe('blowing cover', () => {
    // An archer at (8,2) looking north-west (DIRS 2): the row east of it is its side. Brann walks in along row 1
    // and down to (10,2) (side 2); Keven sneaks at (11,2) (side 3, then front 3 once it turns east).
    const W = L2(8, 2);
    const path = [L2(11, 1), L2(10, 1), L2(10, 2)];
    function setup(lit: boolean) {
      const s = scene(['keven', 'brann']);
      s.delve!.lanternBearer = 'brann';
      s.delve!.lanternOpen = lit;
      const m = monster(s, 'archer', W, 'unaware', 2);
      put(s, 'brann', L2(12, 1), { sneaking: false });
      put(s, 'keven', L2(11, 2), { sneaking: true });
      return { s, m };
    }

    it('a walker noticed from the side turns it; a sneaking friend 3 away in its new front, lit, is noticed in the same step', () => {
      const { s, m } = setup(true);
      expect(path.map((p) => bearingOf(m, p))).toEqual(['side', 'side', 'side']);
      expect(path.map((p) => distance(W, p))).toEqual([4, 3, 2]);
      expect(bearingOf(m, L2(11, 2))).toBe('side');
      expect(bearingOf({ at: W, facing: 0 }, L2(11, 2))).toBe('front');
      const pv = moveRisks(ctx(s), hero(s, 'brann'), path, false, litSet(w, s.delve as DelveX), new Set([m.id]), new Set([posKey(W)]));
      expect(pv.notice).toEqual([{ id: m.id, at: L2(10, 2), hero: 'brann' }, { id: m.id, at: L2(10, 2), hero: 'keven' }]);
      const r = ok(s, { type: 'move', heroId: 'brann', path, sneak: false });
      expect(noticed(r.events)).toEqual([{ by: m.id, hero: 'brann' }, { by: m.id, hero: 'keven' }]);
      const ev = r.events.filter((x) => x.type === 'noticed');
      expect(ev[0]).toMatchObject({ at: L2(10, 2), faced: true });
      expect(ev[1]).toMatchObject({ at: L2(11, 2), faced: false });
      const o = mon(r.state, m.id);
      expect(o.facing).toBe(0);
      expect(o.awareness).toBe('hunting');
      expect(o.noticedIds).toEqual(['brann', 'keven']);
    });

    it('the same with the friend unlit: unlit sneaking is seen only adjacent, so Keven stays hidden', () => {
      const { s, m } = setup(false);
      const pv = moveRisks(ctx(s), hero(s, 'brann'), path, false, litSet(w, s.delve as DelveX), new Set([m.id]), new Set([posKey(W)]));
      expect(pv.notice).toEqual([{ id: m.id, at: L2(10, 2), hero: 'brann' }]);
      const r = ok(s, { type: 'move', heroId: 'brann', path, sneak: false });
      expect(noticed(r.events)).toEqual([{ by: m.id, hero: 'brann' }]);
      expect(mon(r.state, m.id).noticedIds).toEqual(['brann']);
    });

    it('the HUD preview names the hero and the friend (risks.notice via reachable)', () => {
      const { s, m } = setup(true);
      const reach = e.reachable(s, 'brann', false).find((x) => samePos(x.to, L2(10, 2)));
      expect(reach).toBeDefined();
      // Whatever way the pathfinder takes, the last hex is (10,2): the archer sees Brann there at the latest, then Keven.
      const who = reach!.risks!.notice.filter((x) => x.id === m.id).map((x) => x.hero);
      expect(who.slice(-2)).toEqual(['brann', 'keven']);
    });
  });

  describe('the orc\'s bellow', () => {
    it('unchanged: the first orc to see a hero bellows (noise 5); another monster hears it, turns and searches, without noticing anyone', () => {
      const s = scene(['keven', 'brann']);
      const orc = monster(s, 'orc', M, 'unaware', 0);
      const other = monster(s, 'archer', L2(15, 2), 'unaware', 0); // 5 east of the orc, looking away from Brann
      put(s, 'brann', L2(13, 2), { sneaking: false }); // front 3, walking: seen
      put(s, 'keven', at(1, 2, 7));
      const r = ok(s, { type: 'move', heroId: 'brann', path: [L2(12, 1)], sneak: false });
      expect(noticed(r.events)).toEqual([{ by: orc.id, hero: 'brann' }]);
      expect(r.events).toContainEqual({ type: 'noise', at: M, radius: 5 });
      const o = mon(r.state, other.id);
      expect(o.awareness).toBe('alert');
      expect(o.searchRounds).toBe(SEARCH_ROUNDS);
      expect(o.noticedIds ?? []).toEqual([]);
    });
  });

  describe('backstab (spec 24.3, 27)', () => {
    const path = [L2(8, 1), L2(9, 1)];
    it('a sneaking Burglar slips in at an unaware monster\'s side unnoticed and backstabs from there', () => {
      const s = scene(['keven', 'pim']);
      const m = monster(s, 'orc', M, 'unaware', 0);
      put(s, 'pim', L2(7, 1), { sneaking: true });
      expect(bearingOf(m, L2(9, 1))).toBe('side');
      const pv = moveRisks(ctx(s), hero(s, 'pim'), path, true, litSet(w, s.delve as DelveX), new Set([m.id]), new Set([posKey(M)]));
      expect(pv.notice).toEqual([]);
      const r = ok(s, { type: 'move', heroId: 'pim', path, sneak: true });
      expect(noticed(r.events)).toEqual([]);
      expect(e.preview(r.state, 'pim', 'attack', { id: m.id }).modifiers).toContain('Backstab: +1 slot, double damage');
    });

    it('anyone else sneaking in beside it is caught by the corner of its eye', () => {
      const s = scene(['keven', 'brann']);
      const m = monster(s, 'orc', M, 'unaware', 0);
      put(s, 'brann', L2(7, 1), { sneaking: true });
      const r = ok(s, { type: 'move', heroId: 'brann', path, sneak: true });
      expect(noticed(r.events)).toEqual([{ by: m.id, hero: 'brann' }]);
    });

    it('a searching monster sees the sneaking Burglar at its side', () => {
      const s = scene(['keven', 'pim']);
      const m = monster(s, 'orc', M, 'searching', 0);
      put(s, 'pim', L2(7, 1), { sneaking: true });
      const r = ok(s, { type: 'move', heroId: 'pim', path, sneak: true });
      expect(noticed(r.events).map((x) => x.by)).toContain(m.id);
    });
  });

  describe('the preview matches the move', () => {
    // A seeded shuffle of scenes on Level 2's north side: three heroes, three awake monsters of any mood and facing,
    // any lantern state; one hero moves to a reachable hex. The preview's (watcher, hero) notices must equal the move's.
    const FLOOR: Pos[] = [];
    for (let row = 1; row <= 3; row++) for (let col = 7; col <= 16; col++) {
      const p = L2(col, row);
      if (w.tile(p)?.kind === 'floor') FLOOR.push(p);
    }
    let seed = 12345;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return (seed >>> 8) % n;
    };
    const KINDS: MonsterKind[] = ['orc', 'archer', 'ghoul'];
    const MOODS: Mood[] = ['unaware', 'unaware', 'searching', 'hunting'];

    it('for 40 seeded scenes', () => {
      let checked = 0;
      let withNotices = 0;
      let others = 0;
      for (let n = 0; n < 40; n++) {
        const s = scene();
        const spots = [...FLOOR];
        const take = () => spots.splice(rnd(spots.length), 1)[0]!;
        for (const id of ['keven', 'brann', 'pim']) put(s, id, take(), { sneaking: rnd(2) === 0 });
        s.delve!.lanternBearer = ['keven', 'brann', 'pim'][rnd(3)]!;
        s.delve!.lanternOpen = rnd(3) !== 0;
        for (let i = 0; i < 3; i++) monster(s, KINDS[rnd(3)]!, take(), MOODS[rnd(4)]!, rnd(6));
        const mover = ['keven', 'brann', 'pim'][rnd(3)]!;
        const sneak = rnd(2) === 0;
        const reach = e.reachable(s, mover, sneak).filter((x) => !x.dash && x.to.level === 2);
        if (!reach.length) continue;
        const pick = reach[rnd(reach.length)]!;
        const ids = new Set(s.delve!.monsters.map((m) => m.id));
        const vis = new Set(s.delve!.monsters.map((m) => posKey(m.at)));
        const pv = moveRisks(ctx(s), hero(s, mover), pick.path, sneak, litSet(w, s.delve as DelveX), ids, vis);
        const r = e.apply(s, { type: 'move', heroId: mover, path: pick.path, sneak });
        expect(r.error).toBeUndefined();
        if (r.events.some((x) => x.type === 'swing' || x.type === 'downed')) continue; // dice the preview can't know
        const real = noticed(r.events);
        expect(pv.notice.map((x) => ({ by: x.id, hero: x.hero }))).toEqual(real);
        // Same seed, same move: the same game.
        expect(e.apply(s, { type: 'move', heroId: mover, path: pick.path, sneak }).events).toEqual(r.events);
        checked++;
        if (real.length) withNotices++;
        if (real.some((x) => x.hero !== mover)) others++;
      }
      expect(checked).toBeGreaterThan(25);
      expect(withNotices).toBeGreaterThan(5);
      expect(others).toBeGreaterThan(0);
    });
  });
});

describe('V4.0 HUD: the sight wash on hover (engine.sightWash)', () => {
  const has = (list: Pos[], p: Pos) => list.some((q) => samePos(q, p));
  it('unaware: ahead full, the sides faint within 2, nothing behind; searching: the sides full; asleep: nothing', () => {
    const s = scene();
    const m = monster(s, 'orc', M, 'unaware', 0);
    s.delve!.light = 20;
    let w8 = e.sightWash!(s, m.id);
    expect(has(w8.front, L2(11, 2))).toBe(true);
    expect(has(w8.side, L2(8, 1))).toBe(true); // side 2, walking
    expect(has(w8.side, L2(8, 4)) || has(w8.front, L2(8, 4))).toBe(false); // side 3
    expect(has(w8.front, L2(9, 2)) || has(w8.side, L2(9, 2))).toBe(false); // straight behind: never shaded
    m.searchRounds = SEARCH_ROUNDS;
    w8 = e.sightWash!(s, m.id);
    expect(w8.side.length).toBe(0);
    expect(has(w8.front, L2(8, 1))).toBe(true);
    m.awareness = 'asleep';
    w8 = e.sightWash!(s, m.id);
    expect(w8.front.length + w8.side.length).toBe(0);
  });
});
