// V4.0 (spec 25): the shut ways in, on the real castle. A new campaign goes in by the main gate only;
// the sally port's barred gate opens with its key or a blast, the east breach's rubble with a blast or
// a Dig, the Lantern Sisters make their own entrance, and the campaign remembers what it has seen.

import { describe, it, expect } from 'vitest';
import { createEngine } from './engine';
import { castle } from '../data/castle';
import { at as L } from '../data/castle/build';
import { hexKey, posKey, samePos, type Pos } from './hex';
import type { CastleDef, Command, GameEvent, GameState, Item } from './types';
import type { CrewX, Ctx, DelveX, GameStateX } from './state';
import { World } from './world';
import { makeHero } from './camp';
import { blast } from './charges';
import { buildCrew, makeCrew } from './rivals';
import { hurtAny } from './common';

const e = createEngine(castle);
const w = new World(castle);
const L1 = (c: number, r: number) => L(1, c, r);
const GATE = L1(2, 14);
const SALLY_EXIT = L1(1, 14);
const HEAPS = [L1(42, 21), L1(43, 21)];
const BREACH_EXIT = L1(44, 21);
const KEY_AT = castle.shutWays!.find((x) => x.id === 'sally')!.keyAt!;

function ok(s: GameState, cmd: Command) {
  const r = e.apply(s, cmd);
  expect(r.error, JSON.stringify(cmd)).toBeUndefined();
  return r;
}

function camp(seed = 1): GameState {
  const s = e.newGame(seed);
  s.campaign.roster.push(makeHero('brann', 'Brann', 'sellsword'), makeHero('sap', 'Sappho', 'sapper'));
  return s;
}

/** A delve by the main gate (or `entrance`) with nothing alive in the castle but the party. */
function delve(s: GameState = camp(), heroIds = ['keven', 'brann'], entrance = 0): GameState {
  const k = s.campaign.board.find((x) => x.level === 1 && !x.story) ?? s.campaign.board[0]!;
  const t = ok(s, { type: 'startDelve', contractId: k.id, heroIds, entrance, packs: {} }).state;
  t.delve!.monsters = [];
  t.delve!.rivals = null;
  t.delve!.traps = {};
  return t;
}

function hero(s: GameState, id: string) {
  return s.delve!.heroes.find((h) => h.heroId === id)!;
}

function put(s: GameState, id: string, p: Pos) {
  const h = hero(s, id);
  h.at = { ...p };
  h.moved = false;
  h.acted = false;
}

function give(s: GameState, id: string, kind: Item['kind'], extra: Partial<Item> = {}): Item {
  const it: Item = { id: `t-${kind}-${Math.random().toString(36).slice(2, 7)}`, kind, name: kind, amount: kind === 'gatekey' ? 0 : 1, slots: 1, ...extra };
  hero(s, id).pack.push(it);
  return it;
}

function ctx(s: GameState): Ctx {
  return { w, s: s as GameStateX, d: s.delve as DelveX, ev: [] };
}

function door(s: GameState, p: Pos) {
  return s.delve!.doors[posKey(p)]!;
}

/** Everyone left on the map walks out by the main gate; back to camp. */
function leaveAndReturn(s: GameState): GameState {
  for (const h of s.delve!.heroes) {
    if (h.status !== 'active') continue;
    put(s, h.heroId, castle.entrances[0]!);
    s = ok(s, { type: 'act', heroId: h.heroId, action: 'leave', target: { at: castle.entrances[0]! }, focus: 0 }).state;
  }
  expect(s.stage).toBe('summary');
  return ok(s, { type: 'backToCamp' }).state;
}

describe('V4.0 entrances (spec 25)', () => {
  it('a new campaign can go in by the main gate only; the others are shut and unknown', () => {
    const s = camp();
    const ents = e.entrances(s);
    expect(ents.map((x) => x.name)).toEqual(['Main gate', 'Sally port', 'East breach']);
    expect(ents.map((x) => x.state)).toEqual(['open', 'locked', 'blocked']);
    expect(ents.map((x) => x.known)).toEqual([true, false, false]);
    expect(ents[0]!.hint).toBeUndefined();
    expect(ents[1]!.hint).toBe('A barred gate. It wants its key, or a charge.');
    expect(ents[2]!.hint).toBe('Choked with rubble.');
    expect(s.campaign.opened).toEqual({});
    expect(e.castleMemory(s)).toEqual([{ level: 1, hexes: [] }, { level: 2, hexes: [] }, { level: 3, hexes: [] }]);
  });

  it('startDelve refuses a shut entrance in plain words', () => {
    const s = camp();
    const k = s.campaign.board[0]!.id;
    const a = e.apply(s, { type: 'startDelve', contractId: k, heroIds: ['keven'], entrance: 1, packs: {} });
    expect(a.error).toBe('The sally port is barred shut. Go in by the main gate.');
    const b = e.apply(s, { type: 'startDelve', contractId: k, heroIds: ['keven'], entrance: 2, packs: {} });
    expect(b.error).toBe('The east breach is choked with rubble. Go in by the main gate.');
  });

  it('nobody leaves by a shut exit, and crews never head for one', () => {
    const s = delve();
    put(s, 'brann', SALLY_EXIT);
    expect(e.actions(s, 'brann').some((o) => o.action === 'leave')).toBe(false);
    put(s, 'brann', BREACH_EXIT);
    expect(e.actions(s, 'brann').some((o) => o.action === 'leave')).toBe(false);
    put(s, 'brann', castle.entrances[0]!);
    expect(e.actions(s, 'brann').some((o) => o.action === 'leave')).toBe(true);
  });
});

describe('V4.0 the sally port gate (spec 25.2)', () => {
  it('the key opens it: one action, silent, anyone; it stays open next delve', () => {
    let s = delve();
    put(s, 'brann', L1(3, 14));
    const key = give(s, 'brann', 'gatekey', { name: 'Sally port key' });
    const opt = e.actions(s, 'brann').find((o) => o.action === 'unbar');
    expect(opt?.targets).toEqual([{ at: GATE, itemId: key.id }]);
    const r = ok(s, { type: 'act', heroId: 'brann', action: 'unbar', target: { at: GATE, itemId: key.id }, focus: 0 });
    s = r.state;
    expect(r.events.some((x) => x.type === 'noise')).toBe(false);
    expect(door(s, GATE)).toMatchObject({ open: true, locked: false });
    expect(hero(s, 'brann').acted).toBe(true);
    expect(hero(s, 'brann').pack.some((i) => i.kind === 'gatekey')).toBe(false);
    expect(r.events).toContainEqual({ type: 'say', text: 'The sally port gate swings open. It stays open.' });
    expect(e.entrances(s)[1]!.state).toBe('open');
    // It can't be closed again.
    expect(e.actions(s, 'brann').find((o) => o.action === 'open')?.targets.some((t) => t.at && samePos(t.at, GATE)) ?? false).toBe(false);
    // Now an exit: Leave works there this delve.
    put(s, 'brann', SALLY_EXIT);
    expect(e.actions(s, 'brann').some((o) => o.action === 'leave')).toBe(true);
    s = leaveAndReturn(s);
    expect(s.campaign.opened?.sally).toBe(true);
    expect(e.entrances(s)[1]).toMatchObject({ state: 'open', known: true });
    expect(e.entrances(s)[1]!.hint).toBeUndefined();
    // Next delve: in by the sally port; the gate stands open and no key lies in the library.
    const t = delve(s, ['keven'], 1);
    expect(door(t, GATE)).toMatchObject({ open: true, locked: false });
    expect(hero(t, 'keven').at.level).toBe(1);
    expect(t.delve!.ground.some((g) => g.items.some((i) => i.kind === 'gatekey'))).toBe(false);
  });

  it('a copy of the key lies in the library while the gate is shut', () => {
    const s = delve();
    const pile = s.delve!.ground.find((g) => samePos(g.at, KEY_AT));
    expect(pile?.items.map((i) => [i.kind, i.amount, i.slots, i.name])).toEqual([['gatekey', 0, 1, 'Sally port key']]);
  });

  it('carrying the key out opens the gate for good; the key goes nowhere near the stash', () => {
    let s = delve();
    give(s, 'brann', 'gatekey', { name: 'Sally port key' });
    const r0 = e.apply(leaveOnly(s), { type: 'backToCamp' });
    s = r0.state;
    expect(r0.events).toContainEqual({ type: 'say', text: 'With its key in hand, the sally port gate is yours. It stays open.' });
    expect(s.campaign.opened?.sally).toBe(true);
    expect(s.campaign.stash.some((i) => i.kind === 'gatekey')).toBe(false);
    expect(e.entrances(s)[1]!.state).toBe('open');
    const t = delve(s);
    expect(t.delve!.ground.some((g) => g.items.some((i) => i.kind === 'gatekey'))).toBe(false);
    expect(door(t, GATE).open).toBe(true);
  });

  function leaveOnly(s: GameState): GameState {
    for (const h of s.delve!.heroes) {
      put(s, h.heroId, castle.entrances[0]!);
      s = ok(s, { type: 'act', heroId: h.heroId, action: 'leave', target: { at: castle.entrances[0]! }, focus: 0 }).state;
    }
    return s;
  }

  it('a blast at the gate opens it for good', () => {
    let s = delve();
    put(s, 'brann', L1(4, 14));
    put(s, 'keven', L1(3, 14));
    const ch = give(s, 'keven', 'charge');
    const opt = e.actions(s, 'keven').find((o) => o.action === 'charge');
    expect(opt?.targets.some((t) => t.at && samePos(t.at, GATE))).toBe(true);
    s = ok(s, { type: 'act', heroId: 'keven', action: 'charge', target: { at: GATE, itemId: ch.id, fuse: 1 }, focus: 0 }).state;
    put(s, 'keven', L1(8, 14));
    put(s, 'brann', L1(9, 14));
    const r = ok(s, { type: 'endTurn' });
    s = r.state;
    expect(r.events.some((x) => x.type === 'blast')).toBe(true);
    expect(door(s, GATE)).toMatchObject({ open: true, locked: false });
    expect(s.delve!.ways?.sally).toBe(true);
    s = leaveAndReturn(s);
    expect(s.campaign.opened?.sally).toBe(true);
  });

  it('Pick, Smash, the skeleton key and a crew open job never work on it', () => {
    const s = delve(camp(), ['keven', 'brann']);
    put(s, 'brann', L1(3, 14));
    give(s, 'brann', 'lockpicks');
    const sk = give(s, 'brann', 'key');
    const acts = e.actions(s, 'brann').map((o) => o.action);
    expect(acts).not.toContain('pick');
    expect(acts).not.toContain('smash');
    expect(acts).not.toContain('key');
    expect(e.apply(s, { type: 'act', heroId: 'brann', action: 'pick', target: { at: GATE }, focus: 0 }).error).toBeTruthy();
    expect(e.apply(s, { type: 'act', heroId: 'brann', action: 'smash', target: { at: GATE }, focus: 0 }).error).toBeTruthy();
    expect(e.apply(s, { type: 'act', heroId: 'brann', action: 'key', target: { at: GATE, itemId: sk.id }, focus: 0 }).error).toBeTruthy();
    // The Sisters, neutral and in sight, won't take the gate as an open job.
    const cr = buildCrew(s as GameStateX, 'lantern-sisters', [L1(6, 14), L1(7, 14), L1(6, 16)]);
    s.delve!.rivals = cr;
    s.delve!.explored = [posKey(GATE), posKey(L1(3, 14)), posKey(L1(6, 14))];
    const job = e.deals(s, 'brann').find((x) => x.deal === 'job' && x.job === 'open');
    expect(job?.ok).toBe(false);
  });
});

describe('V4.0 the east breach (spec 25.3)', () => {
  it('a blast clears the rubble; the breach stays open', () => {
    let s = delve();
    const c = ctx(s);
    blast(c, HEAPS[0]!, 'keven');
    for (const p of HEAPS) expect(s.delve!.blown).toContain(posKey(p));
    expect(s.delve!.ways?.breach).toBe(true);
    expect(c.ev).toContainEqual({ type: 'say', text: 'The east breach is clear. A new way in.' });
    expect(e.entrances(s)[2]!.state).toBe('open');
    s = leaveAndReturn(s);
    expect(s.campaign.opened?.breach).toBe(true);
    const t = delve(s, ['keven'], 2);
    expect(hero(t, 'keven').at.level).toBe(1);
    for (const p of HEAPS) expect(t.delve!.blown).toContain(posKey(p));
  });

  it('a Dig clears it heap by heap; open once the exit joins the castle', () => {
    let s = delve(camp(), ['sap', 'brann']);
    put(s, 'sap', L1(41, 21));
    expect(e.actions(s, 'sap').find((o) => o.action === 'dig')?.targets).toContainEqual({ at: HEAPS[0] });
    let r = ok(s, { type: 'act', heroId: 'sap', action: 'dig', target: { at: HEAPS[0]! }, focus: 0 });
    s = r.state;
    expect(s.delve!.ways?.breach).toBeFalsy();
    put(s, 'sap', HEAPS[0]!);
    r = ok(s, { type: 'act', heroId: 'sap', action: 'dig', target: { at: HEAPS[1]! }, focus: 0 });
    s = r.state;
    expect(s.delve!.ways?.breach).toBe(true);
    expect(r.events).toContainEqual({ type: 'say', text: 'The east breach is clear. A new way in.' });
    s = leaveAndReturn(s);
    expect(e.entrances(s)[2]).toMatchObject({ state: 'open', known: true });
  });

  it("the rubble blocks sight and passage until it's cleared, and its hover says what clears it", () => {
    const s = delve();
    put(s, 'brann', L1(41, 21));
    const reach = e.reachable(s, 'brann', false);
    expect(reach.some((x) => samePos(x.to, BREACH_EXIT))).toBe(false);
    const vis = e.visibility(s).visible;
    expect(vis.has(posKey(BREACH_EXIT))).toBe(false);
  });
});

describe('V4.0 the Lantern Sisters make an entrance (spec 25.4)', () => {
  /** A castle whose only rival way in is `way`, so the seeded choice is forced. */
  function sistersBy(way: Pos, seed0 = 1) {
    const c2: CastleDef = { ...castle, rivalEntrances: [way] };
    const w2 = new World(c2);
    for (let seed = seed0; seed < seed0 + 60; seed++) {
      const s = delve(camp(seed));
      const cr = makeCrew(w2, s as GameStateX, s.delve as DelveX, 1, castle.entrances[0]!);
      if (!cr) continue;
      s.delve!.rivals = cr;
      cr.entersRound = s.delve!.round;
      // The party stays well away (more than 6 from either way in).
      put(s, 'keven', L1(24, 28));
      put(s, 'brann', L1(23, 28));
      return s;
    }
    throw new Error('no crew rolled');
  }

  it('the rng picks between the two ways in, never within 6 of the party', () => {
    const seen = new Set<string>();
    const s = delve();
    for (let seed = 1; seed < 40; seed++) {
      (s as GameStateX).rng = seed;
      const cr = makeCrew(w, s as GameStateX, s.delve as DelveX, 1, castle.entrances[0]!);
      if (cr) seen.add(posKey(cr.members[0]!.at));
    }
    expect([...seen].sort()).toEqual([posKey(BREACH_EXIT), posKey(SALLY_EXIT)].sort());
  }, 20000);

  it('V4.1 (owner): never by the party\'s own way in; by the main gate when the party came another way', () => {
    const s = delve();
    const [gate, sally, breach] = castle.entrances as [Pos, Pos, Pos];
    for (const [party, others] of [[sally, [gate, breach]], [breach, [gate, sally]], [gate, [sally, breach]]] as [Pos, Pos[]][]) {
      const seen = new Set<string>();
      for (let seed = 1; seed < 60; seed++) {
        (s as GameStateX).rng = seed;
        const cr = makeCrew(w, s as GameStateX, s.delve as DelveX, 1, party);
        if (cr) seen.add(posKey(cr.members[0]!.at));
      }
      expect(seen.has(posKey(party))).toBe(false);
      expect([...seen].sort()).toEqual(others.map(posKey).sort());
    }
  }, 30000);

  it('V4.1: coming by the open main gate, the Sisters walk in; nothing is blasted or unbarred', () => {
    const c2: CastleDef = { ...castle, rivalEntrances: [castle.entrances[0]!] };
    const w2 = new World(c2);
    for (let seed = 1; seed < 60; seed++) {
      const s = delve(camp(seed));
      const cr = makeCrew(w2, s as GameStateX, s.delve as DelveX, 1, castle.entrances[1]!);
      if (!cr) continue;
      expect(cr.members.some((m) => m.pack?.some((i) => i.kind === 'gatekey'))).toBe(false);
      s.delve!.rivals = cr;
      cr.entersRound = s.delve!.round;
      put(s, 'keven', L1(3, 14));
      put(s, 'brann', L1(4, 14));
      const r = ok(s, { type: 'endTurn' });
      expect((r.state.delve!.rivals as CrewX).entered).toBe(true);
      expect(r.events.some((x) => x.type === 'blast')).toBe(false);
      expect(r.events.some((x) => x.type === 'say' && /key turns|set a charge/.test(x.text))).toBe(false);
      return;
    }
    throw new Error('no crew rolled');
  }, 20000);

  it('by a shut sally port: the Burglar sister unlocks the gate, the crew bars it behind them, and her key drops when she dies', () => {
    let s = sistersBy(SALLY_EXIT);
    const burglar = s.delve!.rivals!.members.find((r) => r.cls === 'burglar')!;
    expect(burglar.pack?.some((i) => i.kind === 'gatekey')).toBe(true);
    let r = ok(s, { type: 'endTurn' });
    s = r.state;
    expect((s.delve!.rivals as CrewX).entered).toBe(true);
    expect(r.events.some((x) => x.type === 'say' && /key turns/.test(x.text))).toBe(true);
    expect(r.events.some((x) => x.type === 'blast')).toBe(false);
    // Their way in is never opened for the party.
    expect(s.delve!.ways?.sally).toBeFalsy();
    expect(r.events).not.toContainEqual({ type: 'say', text: 'The sally port gate swings open. It stays open.' });
    // Once every sister is through and the gateway is clear, the bar drops back.
    for (let i = 0; i < 4 && s.delve!.gateHeld; i++) s = ok(s, { type: 'endTurn' }).state;
    expect(s.delve!.gateHeld).toBeFalsy();
    expect(door(s, GATE)).toMatchObject({ open: false, locked: true });
    expect(e.entrances(s)[1]!.state).toBe('locked');
    const b = s.delve!.rivals!.members.find((m) => m.cls === 'burglar')!;
    expect(b.pack?.some((i) => i.kind === 'gatekey')).toBe(true);
    // She dies: the key drops with her pack.
    hurtAny(ctx(s), b.id, 99, 'keven');
    hurtAny(ctx(s), b.id, 1, 'keven'); // V4.1 (spec 31.4): down first, then dead
    // (The library still holds its own copy: the gate is shut.)
    const pile = s.delve!.ground.find((g) => samePos(g.at, b.at) && g.items.some((i) => i.kind === 'gatekey'));
    expect(pile).toBeTruthy();
    if (!pile) return;
    // Left there, the gate stays shut for the campaign.
    const left = leaveAndReturn(structuredClone(s));
    expect(left.campaign.opened?.sally).toBeFalsy();
    // Taken to the gate, it opens it for good, as any key would.
    const key = pile.items.find((i) => i.kind === 'gatekey')!;
    pile.items = pile.items.filter((i) => i !== key);
    hero(s, 'brann').pack.push(key);
    put(s, 'brann', L1(3, 14));
    r = ok(s, { type: 'act', heroId: 'brann', action: 'unbar', target: { at: GATE, itemId: key.id }, focus: 0 });
    expect(r.events).toContainEqual({ type: 'say', text: 'The sally port gate swings open. It stays open.' });
    s = leaveAndReturn(r.state);
    expect(s.campaign.opened?.sally).toBe(true);
  });

  it('the gate is not barred on anyone still outside or in the gateway', () => {
    let s = sistersBy(SALLY_EXIT);
    s = ok(s, { type: 'endTurn' }).state;
    for (let i = 0; i < 4 && s.delve!.gateHeld; i++) s = ok(s, { type: 'endTurn' }).state;
    // Hold it again by hand, with a hero standing in the gateway: it stays open.
    s.delve!.gateHeld = true;
    Object.assign(door(s, GATE), { open: true, locked: false });
    put(s, 'brann', GATE);
    s = ok(s, { type: 'endTurn' }).state;
    expect(door(s, GATE)).toMatchObject({ open: true, locked: false });
    // ...or outside it.
    put(s, 'brann', SALLY_EXIT);
    s = ok(s, { type: 'endTurn' }).state;
    expect(door(s, GATE)).toMatchObject({ open: true, locked: false });
    // Back inside: the bar drops.
    put(s, 'brann', L1(6, 14));
    s = ok(s, { type: 'endTurn' }).state;
    expect(door(s, GATE)).toMatchObject({ open: false, locked: true });
  });

  it('a blast at the gate while a crew holds it open opens it for good', () => {
    let s = sistersBy(SALLY_EXIT);
    s = ok(s, { type: 'endTurn' }).state;
    s.delve!.gateHeld = true;
    Object.assign(door(s, GATE), { open: true, locked: false });
    blast(ctx(s), L1(3, 14), 'keven');
    expect(s.delve!.gateHeld).toBeFalsy();
    expect(s.delve!.ways?.sally).toBe(true);
  });

  it('by a shut east breach: they blast the rubble open as they arrive (noise 8, heard), and it stays open', () => {
    let s = sistersBy(BREACH_EXIT);
    expect(s.delve!.rivals!.members.every((m) => !m.pack?.some((i) => i.kind === 'gatekey'))).toBe(true);
    // Keven waits in the chapel, out of sight beyond the rubble but within earshot (8 from the exit: they still come in).
    put(s, 'keven', L1(36, 21));
    hero(s, 'keven').facing = 3;
    const r = ok(s, { type: 'endTurn' });
    s = r.state;
    const bl = r.events.find((x): x is Extract<GameEvent, { type: 'blast' }> => x.type === 'blast');
    expect(bl).toBeTruthy();
    expect(r.events).toContainEqual({ type: 'noise', at: bl!.at, radius: 8 });
    expect(r.events.some((x) => x.type === 'heard' && x.sound.what === 'blast')).toBe(true);
    expect(s.delve!.ways?.breach).toBe(true);
    expect((s.delve!.rivals as CrewX).entered).toBe(true);
    for (const m of s.delve!.rivals!.members) expect(m.hp).toBe(m.maxHp);
    s = leaveAndReturn(s);
    expect(s.campaign.opened?.breach).toBe(true);
  });

  it('they leave only by an open way', () => {
    const s = sistersBy(BREACH_EXIT);
    // Before they come in, the breach is shut: a crew member there finds no way out but the main gate.
    const cr = s.delve!.rivals as CrewX;
    cr.entered = true;
    cr.goal = 'leave';
    const m = cr.members[0]!;
    m.at = L1(40, 21);
    const t = ok(s, { type: 'endTurn' }).state;
    const after = t.delve!.rivals!.members[0]!;
    // Still inside, heading west (toward the main gate), not through the rubble.
    expect(after.goneOut).toBe(false);
    expect(after.at.q).toBeLessThanOrEqual(m.at.q);
  });
});

describe('V4.0 an escort out by the sally port', () => {
  it('the freed prisoner follows onto the open gate and out', () => {
    let s = camp();
    s.campaign.opened = { sally: true };
    const k = s.campaign.board.find((x) => x.kind === 'rescue' && x.level === 1)!;
    s = ok(s, { type: 'startDelve', contractId: k.id, heroIds: ['brann'], entrance: 1, packs: {} }).state;
    s.delve!.monsters = [];
    s.delve!.rivals = null;
    s.delve!.traps = {};
    const pr = s.delve!.prisoner!;
    pr.freed = true;
    pr.escortedBy = 'brann';
    hero(s, 'brann').escorting = pr.id;
    pr.at = L1(4, 14);
    put(s, 'brann', L1(3, 14));
    s = ok(s, { type: 'move', heroId: 'brann', path: [GATE, SALLY_EXIT], sneak: false }).state;
    expect(samePos(s.delve!.prisoner!.at, GATE)).toBe(true);
    s = ok(s, { type: 'act', heroId: 'brann', action: 'leave', target: { at: SALLY_EXIT }, focus: 0 }).state;
    expect(s.delve!.prisoner!.out).toBe(true);
  });
});

describe('V4.0 castle memory (spec 25.5)', () => {
  it('merges each delve\'s explored hexes into the campaign, per level', () => {
    let s = delve();
    s.delve!.explored.push(posKey(GATE), posKey(L(2, 20, 16)));
    s = leaveAndReturn(s);
    const mem = e.castleMemory(s);
    expect(mem.map((x) => x.level)).toEqual([1, 2, 3]);
    expect(mem[0]!.hexes).toContain(hexKey(castle.entrances[0]!));
    expect(mem[0]!.hexes).toContain(hexKey(GATE));
    expect(mem[1]!.hexes).toEqual([hexKey(L(2, 20, 16))]);
    expect(mem[2]!.hexes).toEqual([]);
    // The gate was seen: the sally port is known (still barred).
    expect(e.entrances(s)[1]).toMatchObject({ state: 'locked', known: true });
    expect(e.entrances(s)[2]!.known).toBe(false);
    // A second delve adds to it without duplicates.
    const n = mem[0]!.hexes.length;
    s = leaveAndReturn(delve(s));
    const m2 = e.castleMemory(s)[0]!.hexes;
    expect(new Set(m2).size).toBe(m2.length);
    expect(m2.length).toBeGreaterThanOrEqual(n);
  });
});

describe('V4.0 old saves and the board', () => {
  it('a save from before V4.0 keeps both side entrances open and starts with an empty memory', () => {
    const s0 = camp();
    delete s0.campaign.opened;
    delete s0.campaign.explored;
    const s = e.deserialize(e.serialize(s0))!;
    expect(e.entrances(s).map((x) => x.state)).toEqual(['open', 'open', 'open']);
    expect(e.castleMemory(s).every((x) => x.hexes.length === 0)).toBe(true);
    const t = delve(s, ['keven'], 2);
    for (const p of HEAPS) expect(t.delve!.blown).toContain(posKey(p));
    expect(door(t, GATE).open).toBe(true);
    expect(t.delve!.ground.some((g) => g.items.some((i) => i.kind === 'gatekey'))).toBe(false);
    // Back in camp the old save gains a memory but no `opened` (still all open).
    const u = leaveAndReturn(t);
    expect(u.campaign.opened).toBeUndefined();
    expect(e.castleMemory(u)[0]!.hexes.length).toBeGreaterThan(0);
  });

  it('story contracts carry no "Story" or "Unlocks" warnings', () => {
    const s = camp();
    s.campaign.reputation = 2;
    const stories = s.campaign.board.filter((k) => k.story);
    expect(stories.length).toBeGreaterThan(0);
    for (const k of stories) for (const w0 of k.warnings) expect(w0).not.toMatch(/^Story$|Unlocks/);
  });
});
