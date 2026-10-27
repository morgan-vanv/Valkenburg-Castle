// V4.1 (spec 31.11): the owner's play-test fixes. A killing blow from stealth is never "noticed"; free swings on any
// step from an engaged enemy's side, once per move (heroes, monsters and crews alike).
import { describe, it, expect } from 'vitest';
import { createEngine } from './engine';
import { at, testCastle } from './test/testCastle';
import { distance, posNeighbors, samePos, type Pos } from './hex';
import type { ActionKind, ActionTarget, Command, GameEvent, GameState, HeroClass, Monster, MonsterKind } from './types';
import { MONSTERS } from './data';
import { World } from './world';
import type { Ctx, DelveX, GameStateX, MonsterX, RivalX } from './state';
import { makeHero } from './camp';
import { hurtAny } from './common';
import { buildCrew } from './rivals';
import { walk } from './ai';
import { crewWalk } from './crewmove';

const e = createEngine(testCastle);
const w = new World(testCastle);

function delve(heroes: [string, string, HeroClass][] = [['brann', 'Brann', 'sellsword']], seed = 1): GameState {
  const s = e.newGame(seed);
  for (const [id, name, cls] of heroes) s.campaign.roster.push(makeHero(id, name, cls));
  const k = s.campaign.board[0]!;
  const r = e.apply(s, { type: 'startDelve', contractId: k.id, heroIds: ['keven', ...heroes.map((h) => h[0])], entrance: 0, packs: {} });
  expect(r.error).toBeUndefined();
  const t = r.state;
  t.delve!.monsters = [];
  t.delve!.rivals = null;
  t.delve!.traps = {};
  t.delve!.prisoner = null;
  // Keven out of the way in the pit hall; Brann in the gate room.
  const spots = [at(1, 10, 7), at(1, 2, 7)];
  t.delve!.heroes.forEach((h, i) => {
    h.at = { ...spots[i]! };
    h.facing = undefined;
  });
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

function ok(s: GameState, cmd: Command) {
  const r = e.apply(s, cmd);
  expect(r.error).toBeUndefined();
  return r;
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

const actCmd = (heroId: string, action: ActionKind, target: ActionTarget): Command => ({ type: 'act', heroId, action, target, focus: 0 });
const noticedBy = (ev: GameEvent[], id: string) => ev.some((x) => (x.type === 'noticed' && x.by === id) || (x.type === 'awake' && x.id === id));
const swingsBy = (ev: GameEvent[], id: string) => ev.filter((x) => x.type === 'swing' && x.by === id).length;
const dead = (ev: GameEvent[], id: string) => ev.some((x) => x.type === 'monsterDied' && x.id === id);

const floor = (p: Pos) => w.tile(p)?.kind === 'floor';
/** A walk that starts 2 from `c`, steps next to it, round it (next to it still), then away: [start, in, round, out]. */
function pastPath(c: Pos): Pos[] {
  for (const a of posNeighbors(c).filter(floor)) {
    for (const b of posNeighbors(c).filter((x) => floor(x) && distance(x, a) === 1)) {
      const out = posNeighbors(b).find((x) => floor(x) && distance(x, c) === 2 && distance(x, a) === 2);
      const start = posNeighbors(a).find((x) => floor(x) && distance(x, c) === 2 && !samePos(x, out ?? x) && distance(x, b) === 2);
      if (out && start) return [start, a, b, out];
    }
  }
  throw new Error('no path round the hex');
}

describe('V4.1 play-test fixes (spec 31.11)', () => {
  describe('a killing blow from stealth is not "noticed"', () => {
    it('a hero\'s hit that kills an unaware monster raises no awake or noticed for it; one that only wounds does', () => {
      const s = delve();
      put(s, 'brann', at(1, 3, 7));
      const m = monster(s, 'orc', at(1, 4, 7), 'alert');
      m.hp = 1;
      const kill = until(s, actCmd('brann', 'attack', { id: m.id }), (ev) => dead(ev, m.id));
      expect(noticedBy(kill.events, m.id)).toBe(false);
      m.hp = 99;
      const hurt = until(s, actCmd('brann', 'attack', { id: m.id }), (ev) => ev.some((x) => x.type === 'hit' && x.target === m.id));
      expect(noticedBy(hurt.events, m.id)).toBe(true);
      expect(hurt.state.delve!.monsters[0]!.awareness).toBe('hunting');
    });

    it('others still react to the kill: the death\'s noise sends a monster near it searching', () => {
      const s = delve();
      put(s, 'brann', at(1, 3, 7));
      const m = monster(s, 'orc', at(1, 4, 7), 'alert');
      m.hp = 1;
      const other = monster(s, 'orc', at(1, 6, 7), 'alert');
      other.facing = 0;
      const kill = until(s, actCmd('brann', 'attack', { id: m.id }), (ev) => dead(ev, m.id));
      expect(noticedBy(kill.events, m.id)).toBe(false);
      const o = kill.state.delve!.monsters.find((x) => x.id === other.id)!;
      expect(o.awareness === 'hunting' || (o.searchRounds ?? 0) > 0).toBe(true);
    });

    it('a shove that kills (into the pit) takes back the notice; one it survives keeps it', () => {
      const s = delve();
      put(s, 'brann', at(1, 12, 3));
      const m = monster(s, 'orc', at(1, 11, 3), 'alert');
      m.hp = 1;
      const fell = until(s, actCmd('brann', 'shove', { id: m.id }), (ev) => dead(ev, m.id));
      expect(noticedBy(fell.events, m.id)).toBe(false);
      m.hp = 99;
      const lived = until(s, actCmd('brann', 'shove', { id: m.id }), (ev) => ev.some((x) => x.type === 'fell' && x.id === m.id));
      expect(lived.events.some((x) => x.type === 'noticed' && x.by === m.id)).toBe(true);
    });

    it('crews by the same rule: a member\'s killing blow on a monster raises no notice', () => {
      const s = delve();
      const cr = buildCrew(s as GameStateX, 'lantern-sisters', [at(1, 5, 7), at(1, 17, 1), at(1, 17, 2)]);
      (cr as { entered?: boolean }).entered = true;
      cr.entersRound = 0;
      s.delve!.rivals = cr;
      const r = cr.members[0] as RivalX;
      const m = monster(s, 'orc', at(1, 4, 7), 'alert');
      const c = ctx(s);
      hurtAny(c, m.id, 99, r.id);
      expect(noticedBy(c.ev, m.id)).toBe(false);
      expect(dead(c.ev, m.id)).toBe(true);
      const m2 = monster(s, 'orc', at(1, 4, 8), 'alert');
      const c2 = ctx(s);
      hurtAny(c2, m2.id, 1, r.id);
      expect(m2.awareness).toBe('hunting');
      expect(m2.noticedIds).toContain(r.id);
    });
  });

  describe('free swings: any step from an engaged enemy\'s side, once per move', () => {
    const C = at(1, 4, 7);

    it('a hero stepping in next to a hunting monster is free; stepping round it and past it provokes once', () => {
      const path = pastPath(C);
      const s = delve();
      put(s, 'brann', path[0]!);
      const m = monster(s, 'orc', C, 'hunting');
      m.hp = 99;
      const inOnly = ok(s, { type: 'move', heroId: 'brann', path: [path[1]!], sneak: false });
      expect(swingsBy(inOnly.events, m.id)).toBe(0);
      const past = ok(s, { type: 'move', heroId: 'brann', path: path.slice(1), sneak: false });
      if (hero(past.state, 'brann').status === 'active') expect(swingsBy(past.events, m.id)).toBe(1);
      // The preview says the same: one swing on the way past, none stepping in.
      const reach = e.reachable(s, 'brann', false);
      expect(reach.find((x) => samePos(x.to, path[1]!))!.risks?.swings).toEqual([]);
      const s2 = structuredClone(s);
      put(s2, 'brann', path[1]!);
      const round = e.reachable(s2, 'brann', false).find((x) => samePos(x.to, path[2]!))!;
      expect(round.risks?.swings.map((x) => x.id)).toEqual([m.id]);
      const circle = ok(s2, { type: 'move', heroId: 'brann', path: [path[2]!], sneak: false });
      expect(swingsBy(circle.events, m.id)).toBe(1);
    });

    it('a monster walking round a hero gets the hero\'s swing once a move (the hero\'s action ready)', () => {
      const path = pastPath(C);
      const s = delve();
      put(s, 'brann', C);
      const m = monster(s, 'orc', path[1]!, 'hunting');
      m.hp = 99;
      const c = ctx(s);
      walk(c, m.id, m, [path[2]!]);
      expect(swingsBy(c.ev, 'brann')).toBe(1);
      // Round and away in one move: still once.
      const t = delve();
      put(t, 'brann', C);
      const m2 = monster(t, 'orc', path[1]!, 'hunting');
      m2.hp = 99;
      const c2 = ctx(t);
      walk(c2, m2.id, m2, [path[2]!, path[3]!]);
      expect(swingsBy(c2.ev, 'brann')).toBe(1);
      // Stepping in next to the hero is free.
      const u = delve();
      put(u, 'brann', C);
      const m3 = monster(u, 'orc', path[0]!, 'hunting');
      const c3 = ctx(u);
      walk(c3, m3.id, m3, [path[1]!]);
      expect(swingsBy(c3.ev, 'brann')).toBe(0);
    });

    it('a crew member stepping round a hunting monster that noticed it takes its swing once a move (pillar 17)', () => {
      const path = pastPath(C);
      const s = delve();
      const cr = buildCrew(s as GameStateX, 'lantern-sisters', [path[1]!, at(1, 17, 1), at(1, 17, 2)]);
      (cr as { entered?: boolean }).entered = true;
      cr.entersRound = 0;
      s.delve!.rivals = cr;
      const r = cr.members[0] as RivalX;
      r.hp = 99;
      const m = monster(s, 'orc', C, 'hunting');
      m.noticedIds = [r.id];
      const c = ctx(s);
      crewWalk(c, r, [path[2]!, path[3]!]);
      expect(c.ev.filter((x) => x.type === 'roll' && x.who === m.id && x.what === 'Free swing')).toHaveLength(1);
    });
  });
});

function put(s: GameState, id: string, p: Pos) {
  hero(s, id).at = { ...p };
}

describe('V4.1 (spec 31.13, owner): free swings from hiding are the player\'s call', () => {
  const C = at(1, 4, 6);
  const step = (s: GameState) => {
    const ring = posNeighbors(C).filter((p) => w.tile(p)?.kind === 'floor');
    const a = ring[0]!;
    const b = ring.find((p) => distance(p, a) === 1)!;
    return [a, b] as const;
  };
  it('a hero an enemy hasn\'t noticed holds by default; set to strike from hiding, they swing; noticed, they always swing', () => {
    for (const [ambush, noticed, want] of [[false, false, 0], [true, false, 1], [false, true, 1], [true, true, 1]] as const) {
      const s = delve();
      put(s, 'brann', C);
      const [a, b] = step(s);
      const m = monster(s, 'orc', a, 'alert');
      m.hp = 99;
      m.noticedIds = noticed ? ['brann'] : [];
      m.awareness = noticed ? 'hunting' : 'alert';
      if (ambush) hero(s, 'brann').ambush = true;
      const c = ctx(s);
      walk(c, m.id, m, [b]);
      expect(swingsBy(c.ev, 'brann'), `ambush ${ambush}, noticed ${noticed}`).toBe(want);
    }
  });
  it('a veiled hero holds unless set to strike from hiding', () => {
    const s = delve();
    put(s, 'brann', C);
    hero(s, 'brann').veil = 2;
    const [a, b] = step(s);
    const m = monster(s, 'orc', a, 'hunting');
    m.hp = 99;
    const c = ctx(s);
    walk(c, m.id, m, [b]);
    expect(swingsBy(c.ev, 'brann')).toBe(0);
  });
  it('setAmbush is free and kept on the hero', () => {
    const s = delve();
    const r = ok(s, { type: 'setAmbush', heroId: 'brann', on: true });
    expect(hero(r.state, 'brann').ambush).toBe(true);
    expect(hero(r.state, 'brann').acted).toBeFalsy();
    expect(hero(r.state, 'brann').moved).toBeFalsy();
  });
});
