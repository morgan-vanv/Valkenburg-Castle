// V4.1 (spec 31.13, owner): reactions. The castle's turn pauses for a hero's answer (the hidden free swing, the
// overwatch shot), resumes deterministically from the state before it, and never stops for a hero set to always / never.

import { describe, it, expect } from 'vitest';
import { createEngine } from './engine';
import { at, testCastle } from './test/testCastle';
import { oldLantern } from './test/light';
import { distance, posNeighbors, samePos, type Pos } from './hex';
import type { Command, GameEvent, GameState, HeroClass, Monster, MonsterKind, ReactionQuestion } from './types';
import { MONSTERS } from './data';
import { World } from './world';
import type { Ctx, DelveX, GameStateX, MonsterX } from './state';
import { makeHero } from './camp';
import { walk } from './ai';
import { ask, Pause } from './react';

const e = createEngine(testCastle);
const w = new World(testCastle);

/** Rae the Ranger and Brann the Sellsword in the test keep, lit by the old lantern, nothing else about. */
function delve(extra: [string, string, HeroClass][] = []): GameState {
  const s = e.newGame(1);
  s.campaign.roster.push(makeHero('rae', 'Rae', 'ranger'), makeHero('brann', 'Brann', 'sellsword'));
  for (const [id, name, cls] of extra) s.campaign.roster.push(makeHero(id, name, cls));
  const k = s.campaign.board[0]!;
  const r = e.apply(s, { type: 'startDelve', contractId: k.id, heroIds: ['rae', 'brann', ...extra.map((x) => x[0])], entrance: 0, packs: {} });
  expect(r.error).toBeUndefined();
  const t = r.state;
  t.delve!.monsters = [];
  t.delve!.rivals = null;
  t.delve!.traps = {};
  t.delve!.prisoner = null;
  hero(t, 'rae').at = at(1, 9, 7);
  hero(t, 'brann').at = at(1, 12, 8);
  for (const h of t.delve!.heroes) h.facing = undefined;
  oldLantern(t, 'rae');
  return t;
}

const hero = (s: GameState, id: string) => s.delve!.heroes.find((h) => h.heroId === id)!;

function monster(s: GameState, kind: MonsterKind, p: Pos, awareness: Monster['awareness'] = 'hunting'): MonsterX {
  const def = MONSTERS[kind];
  const m: MonsterX = { id: `m${s.delve!.monsters.length + 1}`, kind, name: def.name, at: { ...p }, hp: def.hp, maxHp: def.hp, awareness, spawnedAt: { ...p } };
  if (awareness === 'hunting') m.noticedIds = s.delve!.heroes.map((h) => h.heroId);
  s.delve!.monsters.push(m);
  return m;
}

const ctx = (s: GameState): Ctx => ({ w, s: s as GameStateX, d: s.delve as DelveX, ev: [] as GameEvent[] });

function ok(s: GameState, cmd: Command, eng = e) {
  const r = eng.apply(s, cmd);
  expect(r.error).toBeUndefined();
  return r;
}

const swingsBy = (ev: GameEvent[], id: string) => ev.filter((x) => x.type === 'swing' && x.by === id).length;
const shotsBy = (ev: GameEvent[], id: string) => ev.filter((x) => x.type === 'cast' && x.spell === 'overwatch' && x.by === id);
const question = (s: GameState) => s.delve!.pending?.question;

/** Rae on overwatch, an orc hunting the party within 6 of her: the castle's turn asks her. */
function overwatchScene(orcs = 1): GameState {
  let s = delve();
  for (let i = 0; i < orcs; i++) monster(s, 'orc', at(1, 10 + i, 1)).hp = 99;
  s = ok(s, { type: 'act', heroId: 'rae', action: 'overwatch', target: {}, focus: 0 }).state;
  return s;
}

const floor = (p: Pos) => w.tile(p)?.kind === 'floor';
/** Brann (veiled) at C; an orc next to him that walks off east past him: its first step is from his side. */
function hiddenScene(): { s: GameState; m: MonsterX } {
  const s = delve();
  const C = at(1, 4, 6);
  hero(s, 'brann').at = { ...C };
  hero(s, 'brann').veil = 3;
  const a = posNeighbors(C).filter(floor).sort((x, y) => y.q - x.q)[0]!;
  const m = monster(s, 'orc', a, 'alert');
  m.hp = 99;
  m.focusAt = at(1, 9, 6);
  return { s, m };
}

describe('V4.1 (spec 31.13): the castle\'s turn pauses for a reaction', () => {
  it('pauses at the overwatch question: the state from before the turn with `pending`, the events so far and the question last', () => {
    const s = overwatchScene();
    const r = ok(s, { type: 'endTurn' });
    const q = question(r.state)!;
    expect(q).toMatchObject({ kind: 'overwatch', heroId: 'rae', enemyId: 'm1' });
    expect(q.text).toContain("Rae's on overwatch");
    expect(q.yes.label).toBe('Shoot');
    expect(q.no.label).toBe('Hold');
    const last = r.events[r.events.length - 1]!;
    expect(last).toEqual({ type: 'react', question: q });
    expect(r.events[0]).toMatchObject({ type: 'phase', phase: 'world' });
    expect(r.state.delve!.pending!.played).toBe(r.events.length - 1);
    expect(r.state.delve!.pending!.command).toEqual({ type: 'endTurn' });
    // The state kept is the one from before the turn (plus the question); the view is the world at the question.
    const back = structuredClone(r.state);
    delete back.delve!.pending;
    expect(back).toEqual(s);
    expect(r.view?.delve?.phase).toBe('world');
    // Only an answer is taken while the question waits; queries still work.
    expect(e.apply(r.state, { type: 'endTurn' }).error).toMatch(/Answer first/);
    expect(e.apply(r.state, { type: 'move', heroId: 'brann', path: [at(1, 12, 7)] }).error).toMatch(/Answer first/);
    expect(e.apply(s, { type: 'react', choice: 'yes' }).error).toBe('Nothing to answer.');
    expect(e.reachable(r.state, 'brann').length).toBeGreaterThan(0);
  });

  it('answering resumes: the result repeats the paused events (`played`), then shoots (yes) or holds (no)', () => {
    const s = overwatchScene();
    const p = ok(s, { type: 'endTurn' });
    const yes = ok(p.state, { type: 'react', choice: 'yes' });
    expect(yes.played).toBe(p.events.length - 1);
    expect(yes.events.slice(0, yes.played)).toEqual(p.events.slice(0, -1));
    expect(shotsBy(yes.events.slice(yes.played), 'rae')).toHaveLength(1);
    expect(yes.state.delve!.pending).toBeUndefined();
    expect(yes.state.delve!.phase).toBe('player');
    expect(yes.state.delve!.round).toBe(s.delve!.round + 1);
    const no = ok(p.state, { type: 'react', choice: 'no' });
    expect(shotsBy(no.events, 'rae')).toHaveLength(0);
    expect(no.state.delve!.pending).toBeUndefined();
  });

  it('held, the overwatch stays armed: the next enemy to move in sight is a new question', () => {
    const s = overwatchScene(2);
    const p1 = ok(s, { type: 'endTurn' });
    expect(question(p1.state)).toMatchObject({ kind: 'overwatch', enemyId: 'm1' });
    const p2 = ok(p1.state, { type: 'react', choice: 'no' });
    expect(question(p2.state)).toMatchObject({ kind: 'overwatch', enemyId: 'm2' });
    expect(p2.state.delve!.pending!.answers).toEqual(['no']);
    expect(p2.played).toBe(p1.events.length - 1);
    const done = ok(p2.state, { type: 'react', choice: 'yes' });
    expect(done.played).toBe(p2.events.length - 1);
    const shots = shotsBy(done.events, 'rae');
    expect(shots).toHaveLength(1);
    expect(shots[0]).toMatchObject({ targetId: 'm2' });
    expect(done.state.delve!.pending).toBeUndefined();
  });

  it('is deterministic: the same state and answers give the same events and state, and match a bot policy\'s run', () => {
    const s = overwatchScene(2);
    const p = ok(s, { type: 'endTurn' });
    const a = ok(ok(p.state, { type: 'react', choice: 'no' }).state, { type: 'react', choice: 'yes' });
    const b = ok(ok(structuredClone(p.state), { type: 'react', choice: 'no' }).state, { type: 'react', choice: 'yes' });
    expect(b.events).toEqual(a.events);
    expect(b.state).toEqual(a.state);
    // A bot answering the same by policy, never pausing, plays the very same turn.
    const answers = ['no', 'yes'] as const;
    let n = 0;
    const bot = createEngine(testCastle, { react: () => answers[n++]! });
    const c = ok(s, { type: 'endTurn' }, bot);
    expect(n).toBe(2);
    expect(c.events).toEqual(a.events);
    expect(c.state).toEqual(a.state);
  });

  it('a setting of always or never answers without pausing', () => {
    for (const [setting, shots] of [['always', 1], ['never', 0]] as const) {
      const s = overwatchScene();
      const r0 = ok(s, { type: 'setReaction', heroId: 'rae', kind: 'overwatch', setting });
      expect(r0.events).toEqual([]);
      expect(hero(r0.state, 'rae').reactions).toEqual({ overwatch: setting });
      expect(hero(r0.state, 'rae').acted).toBe(true); // set after the overwatch: still free
      const r = ok(r0.state, { type: 'endTurn' });
      expect(r.state.delve!.pending, setting).toBeUndefined();
      expect(r.events.some((x) => x.type === 'react')).toBe(false);
      expect(shotsBy(r.events, 'rae'), setting).toHaveLength(shots);
    }
    // Back to ask: the question again.
    const s = overwatchScene();
    const r = ok(ok(s, { type: 'setReaction', heroId: 'rae', kind: 'overwatch', setting: 'ask' }).state, { type: 'endTurn' });
    expect(question(r.state)?.kind).toBe('overwatch');
    expect(e.apply(s, { type: 'setReaction', heroId: 'rae', kind: 'overwatch', setting: 'sometimes' as never }).error).toBeTruthy();
  });

  it('the hidden free swing: an enemy steps past a hidden hero: strike (and give themselves away) or let it pass', () => {
    const { s, m } = hiddenScene();
    const p = ok(s, { type: 'endTurn' });
    const q = question(p.state)!;
    expect(q).toMatchObject({ kind: 'hiddenSwing', heroId: 'brann', enemyId: m.id });
    expect(q.text).toBe("The orc steps past Brann, who's veiled. Strike it, or let it pass?");
    expect(q.yes.label).toBe('Strike');
    expect(q.no.label).toBe('Let it pass');
    expect(q.yes.line).toContain('gives themselves away');
    expect(q.roll?.slots).toBeGreaterThan(0);
    const strike = ok(p.state, { type: 'react', choice: 'yes' });
    expect(swingsBy(strike.events, 'brann')).toBe(1);
    expect(strike.events.some((x) => x.type === 'say' && x.text === 'Brann steps out of the shadows.')).toBe(true);
    expect(hero(strike.state, 'brann').veil).toBe(0);
    expect(strike.state.delve!.monsters[0]!.noticedIds).toContain('brann');
    const pass = ok(p.state, { type: 'react', choice: 'no' });
    expect(swingsBy(pass.events, 'brann')).toBe(0);
    expect(hero(pass.state, 'brann').veil).toBe(2); // 3, less the castle's turn
    expect(pass.state.delve!.monsters[0]!.noticedIds ?? []).not.toContain('brann');
  });

  it('a hero the passer has noticed always swings, without a question; setAmbush still works (on = always, off = never)', () => {
    const { s, m } = hiddenScene();
    hero(s, 'brann').veil = 0;
    m.awareness = 'hunting';
    m.noticedIds = ['brann'];
    const c = ctx(s);
    c.answers = [];
    walk(c, m.id, m, [posNeighbors(m.at).find((x) => floor(x) && distance(x, hero(s, 'brann').at) === 2)!]);
    expect(swingsBy(c.ev, 'brann')).toBe(1);
    for (const [on, want] of [[true, 1], [false, 0]] as const) {
      const t = hiddenScene().s;
      const r0 = ok(t, { type: 'setAmbush', heroId: 'brann', on });
      expect(hero(r0.state, 'brann').reactions).toEqual({ hiddenSwing: on ? 'always' : 'never' });
      const r = ok(r0.state, { type: 'endTurn' });
      expect(r.state.delve!.pending).toBeUndefined();
      expect(swingsBy(r.events, 'brann'), `ambush ${on}`).toBe(want);
    }
  });

  it('several heroes by the same step are asked one at a time, in party order; each (hero, enemy, kind) once a castle\'s turn', () => {
    const s = delve([['pim', 'Pim', 'burglar']]);
    const C = at(1, 4, 6);
    const ring = posNeighbors(C).filter(floor);
    const a = ring[0]!;
    const b = ring.find((p) => distance(p, a) === 1 && posNeighbors(p).some((x) => floor(x) && distance(x, C) === 2))!;
    hero(s, 'brann').at = { ...C };
    const third = posNeighbors(a).find((x) => floor(x) && !samePos(x, C) && !samePos(x, b) && distance(x, C) > 0)!;
    hero(s, 'pim').at = { ...third };
    const m = monster(s, 'orc', a, 'alert');
    m.hp = 99;
    const asked = (answers: ('yes' | 'no')[]): ReactionQuestion | null => {
      const t = structuredClone(s);
      const c = ctx(t);
      c.answers = answers;
      try {
        walk(c, m.id, t.delve!.monsters[0]!, [b]);
        return null;
      } catch (x) {
        if (x instanceof Pause) return x.question;
        throw x;
      }
    };
    // Party order: Rae (not next to it), Brann, then Pim.
    expect(asked([])).toMatchObject({ heroId: 'brann' });
    expect(asked(['no'])).toMatchObject({ heroId: 'pim' });
    expect(asked(['no', 'no'])).toBeNull();
    // The same question again in the same castle's turn keeps its answer (no second question).
    const c = ctx(structuredClone(s));
    c.answers = ['no'];
    const q: ReactionQuestion = { kind: 'hiddenSwing', heroId: 'brann', enemyId: m.id, at: a, text: '', yes: { label: '', line: '' }, no: { label: '', line: '' } };
    expect(ask(c, q)).toBe('no');
    expect(ask(c, q)).toBe('no');
    expect(c.asked).toBe(1);
    expect(() => ask(c, { ...q, enemyId: 'm9' })).toThrow(Pause);
    // Nobody to ask (a rules call outside apply): hidden heroes hold, overwatch shoots.
    const lone = ctx(structuredClone(s));
    expect(ask(lone, q)).toBe('no');
    expect(ask(lone, { ...q, kind: 'overwatch', enemyId: 'm3' })).toBe('yes');
  });

  it('a save made while a question waits loads with it: resume shows the same question, and the answer plays on', () => {
    const s = overwatchScene(2);
    const p1 = ok(s, { type: 'endTurn' });
    const p2 = ok(p1.state, { type: 'react', choice: 'no' });
    const text = e.serialize(p2.state);
    const loaded = e.deserialize(text)!;
    expect(loaded.delve!.pending).toEqual(p2.state.delve!.pending);
    const again = e.resume(loaded)!;
    expect(again.played).toBe(0);
    expect(again.events).toEqual(p2.events);
    expect(again.state).toEqual(p2.state);
    expect(again.view).toEqual(p2.view);
    expect(e.resume(s)).toBeNull();
    const fin = ok(loaded, { type: 'react', choice: 'yes' });
    expect(fin).toEqual(ok(p2.state, { type: 'react', choice: 'yes' }));
    // The WIP build's ambush flag loads as the hidden-swing reaction set to always.
    const old = structuredClone(s);
    (hero(old, 'brann') as { ambush?: boolean }).ambush = true;
    const l2 = e.deserialize(JSON.stringify(old))!;
    expect(hero(l2, 'brann').reactions).toEqual({ hiddenSwing: 'always' });
    expect('ambush' in hero(l2, 'brann')).toBe(false);
  });

  it('a bot\'s policy answers every question: its turns never pause', () => {
    const bot = createEngine(testCastle, { react: (q) => (q.kind === 'overwatch' ? 'yes' : 'no') });
    const ow = ok(overwatchScene(), { type: 'endTurn' }, bot);
    expect(ow.state.delve!.pending).toBeUndefined();
    expect(shotsBy(ow.events, 'rae')).toHaveLength(1);
    const hid = ok(hiddenScene().s, { type: 'endTurn' }, bot);
    expect(hid.state.delve!.pending).toBeUndefined();
    expect(swingsBy(hid.events, 'brann')).toBe(0);
  });
});
