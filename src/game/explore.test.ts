// V3.8 (spec 22): exploration mode. Ticks, walk orders, patrols and investigators, noticing,
// exploring rounds, the lantern by distance, what starts combat and what ends it.

import { describe, it, expect } from 'vitest';
import { createEngine } from './engine';
import { at, testCastle } from './test/testCastle';
import { distance, posKey, samePos, type Pos } from './hex';
import type { Command, GameEvent, GameState, HeroClass, Monster, MonsterKind } from './types';
import { MONSTERS, LANTERN_HEXES, ROUND_TICKS, PATROL_TICKS } from './data';
import { World } from './world';
import type { DelveX, GameStateX, HeroX, MonsterX } from './state';
import { makeHero } from './camp';
import { buildCrew } from './rivals';
import { makeNoise } from './common';
import { isHostileAct } from './explore';

const e = createEngine(testCastle);
const w = new World(testCastle);

/** An exploring delve on the test castle: nothing on the map but the heroes; every level explored. */
function explore(heroes: string[] = ['brann'], extra: [string, string, HeroClass][] = []): GameState {
  let s = e.newGame(1);
  s.campaign.roster.push(
    makeHero('brann', 'Brann', 'sellsword'),
    makeHero('pim', 'Pim', 'burglar'),
    makeHero('aldous', 'Aldous', 'pyromancer'),
    makeHero('rae', 'Rae', 'ranger'),
    ...extra.map(([id, name, cls]) => makeHero(id, name, cls)),
  );
  const r = e.apply(s, { type: 'startDelve', contractId: s.campaign.board[0]!.id, heroIds: heroes, entrance: 0, packs: {} });
  expect(r.error).toBeUndefined();
  s = r.state;
  const d = s.delve as DelveX;
  d.monsters = [];
  d.rivals = null;
  d.traps = {};
  d.light = 20;
  d.lanternBearer = heroes[0]!;
  const ex = new Set(d.explored);
  for (const lv of testCastle.levels) for (const k of Object.keys(lv.tiles)) if (!ex.has(`${lv.level}:${k}`)) d.explored.push(`${lv.level}:${k}`);
  return s;
}

/** Heroes in Level 1's gate room: the first at (3,7), the others along row 8. No Gloam up here. */
function gate(heroes: string[] = ['brann']): GameState {
  const s = explore(heroes);
  heroes.forEach((id, i) => put(s, id, i === 0 ? at(1, 3, 7) : at(1, i, 8)));
  return s;
}

/** Heroes in the open Hollow on row 4 from column 1 (the first carries the lantern). */
function hollow(heroes: string[] = ['brann'], extra: [string, string, HeroClass][] = []): GameState {
  const s = explore(heroes, extra);
  heroes.forEach((id, i) => put(s, id, at(3, 1 + i, 4)));
  return s;
}

function put(s: GameState, id: string, p: Pos): void {
  s.delve!.heroes.find((h) => h.heroId === id)!.at = { ...p };
}

function hero(s: GameState, id: string) {
  return s.delve!.heroes.find((h) => h.heroId === id)! as HeroX;
}

function monster(s: GameState, kind: MonsterKind, p: Pos, awareness: Monster['awareness'] = 'asleep', facing?: number): MonsterX {
  const def = MONSTERS[kind];
  const m: MonsterX = { id: `m${s.delve!.monsters.length + 1}`, kind, name: def.name, at: { ...p }, hp: def.hp, maxHp: def.hp, awareness, spawnedAt: { ...p } };
  if (facing !== undefined) m.facing = facing;
  s.delve!.monsters.push(m);
  return m;
}

function ok(s: GameState, cmd: Command) {
  const r = e.apply(s, cmd);
  expect(r.error).toBeUndefined();
  return r;
}

/** `n` ticks; all events. Stops early when the mode leaves explore. */
function ticks(s: GameState, n: number): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  for (let i = 0; i < n && s.stage === 'delve' && s.delve!.mode === 'explore'; i++) {
    const r = ok(s, { type: 'tick' });
    events.push(...r.events);
    s = r.state;
  }
  return { state: s, events };
}

/** Try rng states until `n` ticks give what `want` asks for. */
function untilTicks(s: GameState, n: number, want: (r: { state: GameState; events: GameEvent[] }) => boolean) {
  for (let i = 1; i < 5000; i++) {
    const t = structuredClone(s);
    t.rng = (i * 2654435761) >>> 0;
    const r = ticks(t, n);
    if (want(r)) return r;
  }
  throw new Error('no rng state gave the wanted outcome');
}

/** Try rng states until the command's events satisfy `want`. */
function until(s: GameState, cmd: Command, want: (ev: GameEvent[], st: GameState) => boolean) {
  for (let i = 1; i < 5000; i++) {
    const t = structuredClone(s);
    t.rng = (i * 2654435761) >>> 0;
    const r = e.apply(t, cmd);
    if (!r.error && want(r.events, r.state)) return r;
  }
  throw new Error('no rng state gave the wanted outcome');
}

const east = (from: number, to: number, row = 4, level = 3) => Array.from({ length: to - from }, (_, i) => at(level, from + 1 + i, row));
const modeEv = (ev: GameEvent[]) => ev.filter((x): x is Extract<GameEvent, { type: 'mode' }> => x.type === 'mode');

describe('V3.8 explore', () => {
  describe('modes (22.1)', () => {
    it('a delve starts exploring, with a mode event, a clean clock, no intents; Engine.mode says so', () => {
      const s = e.newGame(1);
      s.campaign.roster.push(makeHero('brann', 'Brann', 'sellsword'));
      const r = ok(s, { type: 'startDelve', contractId: s.campaign.board[0]!.id, heroIds: ['brann'], entrance: 0, packs: {} });
      expect(r.state.delve!.mode).toBe('explore');
      expect(r.state.delve!.ticks).toBe(0);
      expect(r.state.delve!.lanternSteps).toBe(0);
      expect(modeEv(r.events)).toEqual([{ type: 'mode', mode: 'explore' }]);
      expect(r.state.delve!.monsters.every((m) => !m.intent)).toBe(true);
      expect(e.mode(r.state)).toEqual({ mode: 'explore' });
    });

    it('a delve without a mode (an old save) is combat; Engine.mode gives the reason it goes on', () => {
      const s = hollow();
      delete s.delve!.mode;
      expect(e.mode(s).mode).toBe('combat');
      monster(s, 'orc', at(3, 8, 4), 'hunting');
      expect(e.mode(s)).toEqual({ mode: 'combat', why: 'An orc hunts Brann.' });
      // Ticks change nothing in combat; walking is refused, moving works.
      expect(e.apply(s, { type: 'tick' })).toEqual({ state: s, events: [] });
      expect(e.apply(s, { type: 'walk', heroId: 'brann', path: east(1, 3) }).error).toBeTruthy();
      expect(e.apply(s, { type: 'move', heroId: 'brann', path: east(1, 3), sneak: false }).error).toBeUndefined();
    });

    it('exploring: no move, no End turn, no budgeted reach; serialize keeps the mode, the clock and walk orders', () => {
      const s = hollow();
      expect(e.apply(s, { type: 'move', heroId: 'brann', path: east(1, 2), sneak: false }).error).toBe('Exploring: give a walk order.');
      expect(e.apply(s, { type: 'endTurn' }).error).toBe('Nothing to end while exploring.');
      expect(e.reachable(s, 'brann', false)).toEqual([]);
      const t = ok(s, { type: 'walk', heroId: 'brann', path: east(1, 9) }).state;
      const back = e.deserialize(e.serialize(ticks(t, 3).state))!;
      expect(back.delve!.mode).toBe('explore');
      expect(back.delve!.ticks).toBe(3);
      expect(hero(back, 'brann').walk?.path).toEqual(east(4, 9));
    });
  });

  describe('walk orders and the tick (22.2)', () => {
    it('walking: a hex a tick, a `moved` event per hex, noise 1 per hex; the order clears at the end', () => {
      let s = ok(hollow(), { type: 'walk', heroId: 'brann', path: east(1, 6) }).state;
      expect(hero(s, 'brann').walk).toEqual({ path: east(1, 6), sneak: false });
      const r = ticks(s, 5);
      s = r.state;
      expect(hero(s, 'brann').at).toEqual(at(3, 6, 4));
      expect(hero(s, 'brann').walk).toBeUndefined();
      expect(r.events.filter((x) => x.type === 'moved' && x.id === 'brann').map((x) => (x as { path: Pos[] }).path)).toEqual(east(1, 6).map((p) => [p]));
      expect(r.events.filter((x) => x.type === 'noise')).toHaveLength(5);
      expect(s.delve!.ticks).toBe(5);
      expect(hero(s, 'brann').moved).toBe(false);
    });

    it('sneaking: a hex every 2 ticks, silent; the stance from `sneak` unless the order says otherwise; sneak toggles a walk under way', () => {
      let s = ok(hollow(), { type: 'sneak', heroId: 'brann', on: true }).state;
      expect(hero(s, 'brann').sneaking).toBe(true);
      s = ok(s, { type: 'walk', heroId: 'brann', path: east(1, 5) }).state;
      expect(hero(s, 'brann').walk!.sneak).toBe(true);
      const r = ticks(s, 4);
      expect(hero(r.state, 'brann').at).toEqual(at(3, 3, 4));
      expect(r.events.some((x) => x.type === 'noise')).toBe(false);
      // Stand up mid-walk: walking pace from the next hex.
      const u = ok(r.state, { type: 'sneak', heroId: 'brann', on: false }).state;
      expect(hero(u, 'brann').walk!.sneak).toBe(false);
      expect(hero(ticks(u, 2).state, 'brann').at).toEqual(at(3, 5, 4));
      // An explicit stance on the order wins.
      const v = ok(hollow(), { type: 'walk', heroId: 'brann', path: east(1, 5), sneak: true }).state;
      expect(hero(ticks(v, 2).state, 'brann').at).toEqual(at(3, 2, 4));
    });

    it('the heavy copper: a hex every 2 ticks; rubble takes twice as long', () => {
      const s = hollow();
      hero(s, 'brann').pack.push({ id: 'cop', kind: 'copper', name: 'Brewing copper', amount: 0, slots: 2, heavy: true } as never);
      const r = ticks(ok(s, { type: 'walk', heroId: 'brann', path: east(1, 5) }).state, 4);
      expect(hero(r.state, 'brann').at).toEqual(at(3, 3, 4));
      const t = hollow();
      t.delve!.blown.push(posKey(at(3, 2, 4)));
      const rt = ticks(ok(t, { type: 'walk', heroId: 'brann', path: east(1, 4) }).state, 2);
      expect(hero(rt.state, 'brann').at).toEqual(at(3, 2, 4)); // 2 ticks onto the rubble
    });

    it('walk orders: over explored hexes only, through heroes, never through monsters; can\'t end on a figure; stopWalk drops it', () => {
      const s = hollow(['brann', 'pim']); // Pim at (2,4)
      s.delve!.explored = s.delve!.explored.filter((k) => k !== posKey(at(3, 6, 4)));
      expect(e.apply(s, { type: 'walk', heroId: 'brann', path: east(1, 7) }).error).toBe("You haven't seen that way yet.");
      expect(e.apply(s, { type: 'walk', heroId: 'brann', path: east(1, 2) }).error).toBe('Someone is already there.');
      expect(e.apply(s, { type: 'walk', heroId: 'brann', path: [at(3, 3, 4)] }).error).toBe("Can't go that way.");
      const t = ok(s, { type: 'walk', heroId: 'brann', path: east(1, 4) }).state; // through Pim
      expect(hero(ticks(t, 3).state, 'brann').at).toEqual(at(3, 4, 4));
      const m = structuredClone(s);
      monster(m, 'rats', at(3, 4, 4), 'asleep');
      expect(e.apply(m, { type: 'walk', heroId: 'pim', path: east(2, 5) }).error).toBe('Something is in the way.');
      const st = ok(ok(s, { type: 'walk', heroId: 'pim', path: east(2, 5) }).state, { type: 'stopWalk', heroId: 'pim' }).state;
      expect(hero(st, 'pim').walk).toBeUndefined();
      expect(hero(ticks(st, 2).state, 'pim').at).toEqual(at(3, 2, 4));
    });

    it('a walk stops on a trap (walkStopped) and when the way is blocked', () => {
      const s = hollow();
      s.delve!.traps[posKey(at(3, 3, 4))] = { spotted: false };
      const r = ticks(ok(s, { type: 'walk', heroId: 'brann', path: east(1, 8) }).state, 6);
      expect(hero(r.state, 'brann').at).toEqual(at(3, 3, 4));
      expect(r.events.find((x) => x.type === 'walkStopped')).toMatchObject({ heroId: 'brann', why: 'a trap' });
      expect(hero(r.state, 'brann').walk).toBeUndefined();
      // A sleeper lies across the path given before it was there (it stays asleep: Brann sneaks).
      const b = ok(hollow(), { type: 'walk', heroId: 'brann', path: east(1, 8), sneak: true }).state;
      monster(b, 'rats', at(3, 4, 4), 'asleep', 3);
      const rb = untilTicks(b, 6, (r) => r.state.delve!.monsters[0]!.awareness === 'asleep');
      expect(hero(rb.state, 'brann').at).toEqual(at(3, 3, 4));
      expect(rb.events.find((x) => x.type === 'walkStopped')).toMatchObject({ why: 'the way is blocked' });
    });

    it('lantern by distance: the open lantern burns 1 light per 4 hexes its bearer walks; standing, shuttered or walked by another, nothing', () => {
      expect(LANTERN_HEXES).toBe(4);
      // Level 1's long row 7: (3,7) east to (17,7), through two doors.
      const s = gate(['brann', 'pim']);
      const r = ticks(ok(s, { type: 'walk', heroId: 'brann', path: east(3, 12, 7, 1) }).state, 9);
      expect(hero(r.state, 'brann').at).toEqual(at(1, 12, 7));
      expect(r.state.delve!.light).toBe(18);
      expect(r.state.delve!.lanternSteps).toBe(1);
      expect(ticks(gate(), 40).state.delve!.light).toBe(20); // standing: 5 rounds, no burn
      const p = ok(gate(['brann', 'pim']), { type: 'walk', heroId: 'pim', path: east(1, 6, 8, 1) }).state;
      expect(ticks(p, 8).state.delve!.light).toBe(20);
      const shut = gate();
      shut.delve!.lanternOpen = false;
      expect(ticks(ok(shut, { type: 'walk', heroId: 'brann', path: east(3, 12, 7, 1) }).state, 9).state.delve!.light).toBe(20);
    });

    it('a lit torch burns a round per 4 hexes its carrier walks', () => {
      const s = gate(['brann', 'pim']);
      hero(s, 'pim').torch = 5;
      const r = ticks(ok(s, { type: 'walk', heroId: 'pim', path: east(1, 6, 8, 1) }).state, 8);
      expect(hero(r.state, 'pim').torch).toBe(4); // 5 hexes: one round
      const s2 = gate(['brann']);
      hero(s2, 'brann').torch = 5;
      expect(hero(ticks(ok(s2, { type: 'walk', heroId: 'brann', path: east(3, 12, 7, 1) }).state, 9).state, 'brann').torch).toBe(3);
      expect(hero(ticks(hollow(), 16).state, 'brann').torch).toBe(0);
      const t = hollow();
      hero(t, 'brann').torch = 5;
      expect(hero(ticks(t, 24).state, 'brann').torch).toBe(5); // standing still
    });

    it('an exploring round every 8 ticks: round +1, veil, ward, roots, night-eye count down; no world phase, no lantern burn', () => {
      expect(ROUND_TICKS).toBe(8);
      const s = hollow();
      const h = hero(s, 'brann');
      h.veil = 2;
      h.ward = 2;
      h.rooted = 2;
      h.nightEyes = 2;
      const r0 = s.delve!.round;
      const r = ticks(s, 8);
      expect(r.state.delve!.round).toBe(r0 + 1);
      const h1 = hero(r.state, 'brann');
      expect([h1.veil, h1.ward, h1.rooted, h1.nightEyes]).toEqual([1, 1, 1, 1]);
      expect(r.events.some((x) => x.type === 'phase')).toBe(false);
      expect(r.state.delve!.light).toBe(20);
      expect(ticks(s, 7).state.delve!.round).toBe(r0);
    });

    it('a rooted hero holds the walk until the root wears off', () => {
      const s = ok(hollow(), { type: 'walk', heroId: 'brann', path: east(1, 4) }).state;
      hero(s, 'brann').rooted = 1;
      const r = ticks(s, 8); // the round at tick 8 frees him
      expect(hero(r.state, 'brann').at).toEqual(at(3, 1, 4));
      expect(hero(ticks(r.state, 1).state, 'brann').at).toEqual(at(3, 2, 4));
    });
  });

  describe('patrols and investigators (22.2, 22.3)', () => {
    it('a patrol steps a hex every 4 ticks along its route', () => {
      expect(PATROL_TICKS).toBe(4);
      const s = hollow();
      put(s, 'brann', at(1, 2, 7)); // far away on Level 1
      const m = monster(s, 'rats', at(3, 3, 2), 'patrol');
      m.route = [at(3, 3, 2), at(3, 8, 2)];
      let t = ticks(s, 3).state;
      expect(t.delve!.monsters[0]!.at).toEqual(at(3, 3, 2));
      t = ticks(t, 1).state;
      expect(t.delve!.monsters[0]!.at).toEqual(at(3, 4, 2));
      t = ticks(t, 16).state;
      expect(t.delve!.monsters[0]!.at).toEqual(at(3, 8, 2));
      t = ticks(t, 4).state;
      expect(t.delve!.monsters[0]!.at).toEqual(at(3, 7, 2)); // and back
    });

    it('noise makes a monster investigate (no hunt, no combat): it walks to the noise at patrol pace, searches 3 rounds, walks home', () => {
      const s = hollow();
      put(s, 'brann', at(1, 2, 7));
      const m = monster(s, 'orc', at(3, 3, 2), 'asleep');
      const c = { w, s: s as GameStateX, d: s.delve as DelveX, ev: [] as GameEvent[] };
      makeNoise(c, at(3, 7, 2), 6);
      expect(m.awareness).toBe('alert');
      expect(c.ev.find((x) => x.type === 'investigate')).toEqual({ type: 'investigate', id: m.id, at: at(3, 7, 2) });
      let t = ticks(s, 16).state; // 4 steps: there
      expect(t.delve!.monsters[0]!.at).toEqual(at(3, 7, 2));
      expect(t.delve!.mode).toBe('explore');
      t = ticks(t, 24).state; // 3 rounds of searching
      const mm = t.delve!.monsters[0]!;
      expect(mm.searchRounds).toBeUndefined();
      t = ticks(t, 16).state;
      expect(t.delve!.monsters[0]!.at).toEqual(at(3, 3, 2)); // home
    });

    it('a berserker that hears something only investigates while exploring', () => {
      const s = hollow();
      put(s, 'brann', at(1, 2, 7));
      const m = monster(s, 'berserker', at(3, 3, 2), 'asleep');
      makeNoise({ w, s: s as GameStateX, d: s.delve as DelveX, ev: [] }, at(3, 7, 2), 6);
      expect(m.awareness).toBe('alert');
    });
  });

  describe('combat starts (22.4)', () => {
    it('noticed: enemies first. A world phase at once (the noticer acts), then a fresh player phase; walk orders cleared', () => {
      const s = hollow(['brann']);
      const o = monster(s, 'orc', at(3, 12, 4), 'alert', 3); // facing west, down row 4
      o.searchRounds = undefined;
      const t = ok(s, { type: 'walk', heroId: 'brann', path: east(1, 9) }).state;
      const r = ticks(t, 9);
      const st = r.state;
      expect(st.delve!.mode).toBe('combat');
      const me = modeEv(r.events);
      expect(me).toHaveLength(1);
      expect(me[0]).toMatchObject({ mode: 'combat', first: 'enemies', by: o.id });
      expect(me[0]!.why).toMatch(/orc sees Brann/);
      // Lit walking in the Hollow: noticed at 8.
      expect(distance(hero(st, 'brann').at, st.delve!.monsters[0]!.at)).toBeLessThanOrEqual(8);
      const after = r.events.slice(r.events.indexOf(me[0]!));
      expect(after.some((x) => x.type === 'phase' && x.phase === 'world')).toBe(true);
      expect(after.some((x) => x.type === 'phase' && x.phase === 'player')).toBe(true);
      expect(st.delve!.phase).toBe('player');
      const h = hero(st, 'brann');
      expect([h.moved, h.acted, h.dashed, h.walk]).toEqual([false, false, false, undefined]);
      expect(st.delve!.monsters[0]!.awareness).toBe('hunting');
      // Combat: ticks are no-ops; moves are budgeted.
      expect(e.apply(st, { type: 'tick' }).events).toEqual([]);
      expect(e.reachable(st, 'brann', false).length).toBeGreaterThan(0);
    });

    it('sneaking past the same orc at range 4+ stays exploring (Hollow sneaking: 3)', () => {
      const s = hollow(['brann']);
      monster(s, 'orc', at(3, 12, 1), 'alert', 3);
      const t = ok(s, { type: 'walk', heroId: 'brann', path: east(1, 8), sneak: true }).state;
      const r = ticks(t, 14);
      expect(r.state.delve!.mode).toBe('explore');
      expect(hero(r.state, 'brann').at).toEqual(at(3, 8, 4));
    });

    it('a hostile act: the party first. The act resolves, the actor has acted, the others are fresh; the unaware do nothing in the first world phase', () => {
      const s = hollow(['brann', 'pim']);
      const m = monster(s, 'orc', at(3, 2, 3), 'alert', 0); // next to both, facing east, has noticed nobody
      m.searchRounds = undefined;
      m.hp = 30;
      // Pim stabs; the orc turns to hunt.
      const r = ok(s, { type: 'act', heroId: 'pim', action: 'attack', target: { id: m.id }, focus: 0 });
      const st = r.state;
      expect(st.delve!.mode).toBe('combat');
      expect(modeEv(r.events)[0]).toMatchObject({ mode: 'combat', first: 'party', by: 'pim' });
      expect(hero(st, 'pim').acted).toBe(true);
      expect(hero(st, 'brann').acted).toBe(false);
      expect(r.events.some((x) => x.type === 'phase')).toBe(false); // no world phase yet
      expect((st.delve as DelveX).ambush?.ids).toContain(m.id);
      expect(st.delve!.monsters[0]!.intent).toEqual({ kind: 'wait' });
      // Sneak attack applied: the orc hadn't noticed Pim (2 + 1 + 2 backstab slots).
      expect(r.events.find((x) => x.type === 'roll')).toBeDefined();
      // The first world phase: the orc does nothing (no attack on anyone).
      const w1 = ok(st, { type: 'endTurn' });
      expect(w1.events.some((x) => (x.type === 'hit' || x.type === 'miss') && x.attacker === m.id)).toBe(false);
      expect(w1.state.delve!.monsters[0]!.awareness).toBe('hunting');
      expect((w1.state.delve as DelveX).ambush).toBeUndefined();
    });

    it('a silent kill leaves nothing to fight: still exploring, the actor free to act again', () => {
      const s = hollow(['pim']);
      const m = monster(s, 'rats', at(3, 1, 3), 'asleep');
      m.hp = 1;
      const r = until(s, { type: 'act', heroId: 'pim', action: 'attack', target: { id: m.id }, focus: 0 }, (ev) => ev.some((x) => x.type === 'monsterDied'));
      expect(r.state.delve!.mode).toBe('explore');
      expect(modeEv(r.events)).toEqual([]);
      expect(hero(r.state, 'pim').acted).toBe(false);
    });

    it('actions while exploring: no limits, one after another; the actor\'s walk holds one tick', () => {
      const s = hollow(['brann', 'pim']);
      hero(s, 'brann').pack.push({ id: 'p1', kind: 'potion', name: 'Potion', amount: 1, slots: 1 }, { id: 'p2', kind: 'potion', name: 'Potion', amount: 1, slots: 1 });
      hero(s, 'brann').hp = 2;
      put(s, 'pim', at(3, 1, 6));
      let t = ok(s, { type: 'walk', heroId: 'brann', path: east(1, 4) }).state;
      t = ticks(t, 1).state;
      const a1 = ok(t, { type: 'act', heroId: 'brann', action: 'potion', target: { id: 'brann', itemId: 'p1' }, focus: 0 }).state;
      expect(hero(a1, 'brann').acted).toBe(false);
      const a2 = ok(a1, { type: 'act', heroId: 'brann', action: 'potion', target: { id: 'brann', itemId: 'p2' }, focus: 0 }).state;
      expect(hero(a2, 'brann').pack.some((i) => i.kind === 'potion')).toBe(false);
      const at1 = hero(a2, 'brann').at;
      expect(hero(ticks(a2, 1).state, 'brann').at).toEqual(at1); // held a tick
      expect(hero(ticks(a2, 2).state, 'brann').at).not.toEqual(at1);
    });

    it('overwatch armed while exploring shoots the first enemy that steps into sight: combat, the party first', () => {
      // Rae, crouched with the lantern (radius 4); an orc patrols in from 6 away: lit at 4, shot before it can see her (sneaking: 3).
      let s = hollow(['rae']);
      put(s, 'rae', at(3, 2, 4));
      s = ok(s, { type: 'sneak', heroId: 'rae', on: true }).state;
      const m = monster(s, 'orc', at(3, 8, 4), 'patrol', 3);
      m.route = [at(3, 8, 4), at(3, 5, 4)];
      m.hp = 30;
      const armed = ok(s, { type: 'act', heroId: 'rae', action: 'overwatch', target: { id: 'rae' }, focus: 0 }).state;
      expect(armed.delve!.mode).toBe('explore');
      expect(hero(armed, 'rae').overwatch).toBe(true);
      const r = ticks(armed, 8);
      const cast = r.events.find((x) => x.type === 'cast' && x.spell === 'overwatch');
      expect(cast).toBeDefined();
      expect(r.state.delve!.mode).toBe('combat');
      expect(modeEv(r.events)[0]).toMatchObject({ first: 'party', by: 'rae' });
      expect(hero(r.state, 'rae').acted).toBe(true);
    });

    it('a lit fuse, the Gloam, a toll: the party first', () => {
      // The Gloam: a hero walks out of the lantern's light in the Hollow.
      const g = hollow(['brann', 'pim']);
      put(g, 'pim', at(3, 1, 5));
      const far = ok(g, { type: 'walk', heroId: 'pim', path: east(1, 12, 5) }).state;
      const rg = ticks(far, 12);
      expect(rg.state.delve!.mode).toBe('combat');
      expect(modeEv(rg.events)[0]).toMatchObject({ first: 'party', why: 'The Gloam rises.' });
      expect(rg.state.delve!.monsters.some((m) => m.kind === 'gloam')).toBe(true);
      // The lantern burns out on the way.
      const l = hollow();
      l.delve!.light = 1;
      const rl = ticks(ok(l, { type: 'walk', heroId: 'brann', path: east(1, 8) }).state, 6);
      expect(rl.state.delve!.light).toBe(0);
      expect(rl.state.delve!.mode).toBe('combat');
      // A fuse (set by a Sapper while exploring: a hostile act too).
      const f = hollow(['sam'], [['sam', 'Sam', 'sapper']]);
      const rf = ok(f, { type: 'act', heroId: 'sam', action: 'setCharge', target: { at: at(3, 2, 4), fuse: 2 }, focus: 0 });
      expect(rf.state.delve!.mode).toBe('combat');
      expect(modeEv(rf.events)[0]).toMatchObject({ first: 'party' });
      // A cutthroat crew sees the party and demands the toll.
      const t = explore(['brann']);
      put(t, 'brann', at(2, 8, 1));
      const cr = buildCrew(t as GameStateX, 'ferrymen', [at(2, 12, 1), at(2, 13, 1), at(2, 14, 1)]);
      cr.stance = 'waiting';
      t.delve!.rivals = cr;
      const rt = ok(t, { type: 'tick' });
      expect(rt.state.delve!.rivals!.stance).toBe('demanding');
      expect(rt.state.delve!.mode).toBe('combat');
      expect(modeEv(rt.events)[0]).toMatchObject({ first: 'party', why: 'The Ferrymen want their toll.' });
    });
  });

  describe('what counts as a hostile act (22.4)', () => {
    it('attacks and spells at an enemy, things thrown onto an enemy\'s hex, any charge; a firecracker on an empty hex is only noise', () => {
      const s = hollow(['brann', 'aldous']);
      const m = monster(s, 'orc', at(3, 6, 4), 'asleep');
      const c = { w, s: s as GameStateX, d: s.delve as DelveX, ev: [] as GameEvent[] };
      expect(isHostileAct(c, 'brann', 'attack', { id: m.id })).toBe(true);
      expect(isHostileAct(c, 'aldous', 'firebolt', { id: m.id })).toBe(true);
      expect(isHostileAct(c, 'brann', 'glue', { at: m.at, itemId: 'x' })).toBe(true);
      expect(isHostileAct(c, 'brann', 'firecracker', { at: at(3, 6, 6), itemId: 'x' })).toBe(false);
      expect(isHostileAct(c, 'brann', 'smoke', { at: at(3, 5, 4), itemId: 'x' })).toBe(false);
      expect(isHostileAct(c, 'brann', 'setCharge', { at: at(3, 2, 3), fuse: 2 })).toBe(true);
      expect(isHostileAct(c, 'brann', 'potion', { id: 'brann' })).toBe(false);
      expect(isHostileAct(c, 'brann', 'shove', { id: 'aldous' })).toBe(false);
    });

    it('Fight on the parley card while exploring: combat, the party first', () => {
      const s = explore(['brann']);
      put(s, 'brann', at(2, 8, 1));
      const cr = buildCrew(s as GameStateX, 'ferrymen', [at(2, 10, 1), at(2, 11, 1), at(2, 12, 1)]);
      cr.stance = 'neutral';
      (cr as { spotted?: boolean }).spotted = true;
      s.delve!.rivals = cr;
      const r = ok(s, { type: 'deal', heroId: 'brann', deal: 'fight' });
      expect(r.state.delve!.rivals!.stance).toBe('hostile');
      expect(r.state.delve!.mode).toBe('combat');
      expect(modeEv(r.events)[0]).toMatchObject({ first: 'party', by: 'brann' });
      expect(hero(r.state, 'brann').acted).toBe(false);
    });
  });

  describe('combat ends (22.5)', () => {
    it('the last hunter dies: back to exploring ("The castle quiets."), a clean clock, fresh heroes', () => {
      const s = hollow(['brann']);
      delete s.delve!.mode;
      s.delve!.mode = 'combat';
      s.delve!.ticks = 37;
      const m = monster(s, 'rats', at(3, 2, 4), 'hunting');
      m.noticedIds = ['brann'];
      m.hp = 1;
      const r = until(s, { type: 'act', heroId: 'brann', action: 'attack', target: { id: m.id }, focus: 0 }, (ev) => ev.some((x) => x.type === 'monsterDied'));
      expect(r.state.delve!.mode).toBe('explore');
      expect(modeEv(r.events)).toEqual([{ type: 'mode', mode: 'explore', why: 'The castle quiets.' }]);
      expect(r.state.delve!.ticks).toBe(0);
      expect(hero(r.state, 'brann').acted).toBe(false);
    });

    it('a searcher keeps the fight going; once its search is done the castle quiets after the world phase', () => {
      const s = hollow(['brann']);
      s.delve!.mode = 'combat';
      const m = monster(s, 'orc', at(1, 18, 1), 'alert'); // another level from Brann: doesn't count
      m.searchRounds = 3;
      expect(e.mode(s)).toEqual({ mode: 'combat' });
      put(s, 'brann', at(1, 2, 7));
      expect(e.mode(s).why).toBe('An orc is searching.');
      let t = s;
      for (let i = 0; i < 4 && t.delve!.mode === 'combat'; i++) t = ok(t, { type: 'endTurn' }).state;
      expect(t.delve!.mode).toBe('explore');
    });
  });

  describe('queries (22.7)', () => {
    it('explorePath: any length over explored hexes, through heroes, null for unexplored or occupied ends; risks along the way', () => {
      const s = hollow(['brann', 'pim']);
      const r = e.explorePath(s, 'brann', at(3, 12, 4), false)!;
      expect(r.path).toEqual(east(1, 12));
      expect(r.cost).toBe(11);
      expect(e.explorePath(s, 'brann', at(3, 2, 4), false)).toBeNull(); // Pim stands there
      const u = structuredClone(s);
      u.delve!.explored = u.delve!.explored.filter((k) => k !== posKey(at(3, 12, 4)));
      expect(e.explorePath(u, 'brann', at(3, 12, 4), false)).toBeNull();
      // An orc watching the middle of the path, not its end.
      const o = structuredClone(s);
      const m = monster(o, 'orc', at(3, 6, 1), 'alert', 4);
      const ro = e.explorePath(o, 'brann', at(3, 12, 8), false)!;
      expect(ro.risks!.notice.map((n) => n.id)).toContain(m.id);
    });

    it('vision: per awake enemy, walk and sneak hexes; the blind arc is clear; sleepers and the hired have none', () => {
      const s = hollow();
      put(s, 'brann', at(3, 1, 8)); // on the level (vision covers levels with a hero), out of the way
      const m = monster(s, 'orc', at(3, 8, 4), 'alert', 0); // facing east
      monster(s, 'rats', at(3, 3, 1), 'asleep');
      const v = e.vision(s);
      expect(v.map((x) => x.id)).toEqual([m.id]);
      const { walk, sneak } = v[0]!;
      const has = (ps: Pos[], p: Pos) => ps.some((x) => samePos(x, p));
      expect(has(walk, at(3, 12, 4))).toBe(true); // in front, 4
      expect(has(sneak, at(3, 11, 4))).toBe(true); // in front, 3
      expect(has(sneak, at(3, 12, 4))).toBe(false); // sneaking: 3 in the Hollow
      expect(has(walk, at(3, 4, 4))).toBe(true); // behind at 4: half of 8
      expect(has(walk, at(3, 3, 4))).toBe(false); // behind at 5
      expect(has(sneak, at(3, 7, 4))).toBe(false); // directly behind: never
      expect(sneak.every((p) => has(walk, p))).toBe(true);
      // Nobody on its level: no cones there.
      put(s, 'brann', at(1, 2, 7));
      expect(e.vision(s)).toEqual([]);
    });
  });

  describe('crews while exploring (22.2, 22.6)', () => {
    it('a hired crew follows the hirer at walking pace; the hire runs down by exploring rounds', () => {
      const s = explore(['brann']);
      put(s, 'brann', at(2, 8, 1));
      const cr = buildCrew(s as GameStateX, 'ferrymen', [at(2, 8, 2), at(2, 9, 2), at(2, 10, 2)]);
      cr.stance = 'hired';
      cr.hiredRounds = 5;
      (cr as { hiredBy?: string }).hiredBy = 'brann';
      s.delve!.rivals = cr;
      let t = ok(s, { type: 'walk', heroId: 'brann', path: east(8, 14, 1, 2) }).state;
      t = ticks(t, 8).state;
      expect(t.delve!.mode).toBe('explore');
      const b = hero(t, 'brann').at;
      for (const r of t.delve!.rivals!.members) expect(distance(r.at, b)).toBeLessThanOrEqual(3);
      expect(t.delve!.rivals!.hiredRounds).toBe(4);
    });
  });
});

void samePos;
