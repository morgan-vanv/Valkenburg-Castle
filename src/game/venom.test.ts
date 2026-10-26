// V4.0 (spec 29): venom and paralysis, the venom dart, venom traps, the antidote, Mend, carrying a paralyzed ally.

import { describe, it, expect } from 'vitest';
import { createEngine } from './engine';
import { at, testCastle } from './test/testCastle';
import { posKey, posNeighbors, samePos, type Pos } from './hex';
import type { ActionKind, ActionTarget, Command, GameEvent, GameState, HeroClass, ItemKind, Monster, MonsterKind } from './types';
import { MONSTERS, PARALYSIS_ROUNDS, VENOM_ROUNDS } from './data';
import { World } from './world';
import type { Ctx, DelveX, GameStateX, MonsterX, RivalX } from './state';
import { makeHero } from './camp';
import { makeItem } from './common';
import { buildCrew, planRival } from './rivals';
import { envenom } from './venom';

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
  // Hand-placed: Keven and the others in the gate room of the test keep.
  const spots = [at(1, 3, 7), at(1, 4, 7), at(1, 5, 7), at(1, 4, 6)];
  t.delve!.heroes.forEach((h, i) => {
    h.at = { ...spots[i]! };
    h.facing = undefined;
  });
  return t;
}

function hero(s: GameState, id: string) {
  return s.delve!.heroes.find((h) => h.heroId === id)!;
}

function give(s: GameState, id: string, kind: ItemKind) {
  const it = makeItem({ s: s as GameStateX }, kind);
  hero(s, id).pack.push(it);
  return it;
}

function monster(s: GameState, kind: MonsterKind, p: Pos, awareness: Monster['awareness'] = 'hunting'): MonsterX {
  const def = MONSTERS[kind];
  const m: MonsterX = { id: `m${s.delve!.monsters.length + 1}`, kind, name: def.name, at: { ...p }, hp: def.hp, maxHp: def.hp, awareness, spawnedAt: { ...p } };
  if (awareness === 'hunting') m.noticedIds = s.delve!.heroes.map((h) => h.heroId);
  s.delve!.monsters.push(m);
  return m;
}

function ctx(s: GameState): Ctx {
  return { w, s: s as GameStateX, d: s.delve as DelveX, ev: [] as GameEvent[] };
}

function ok(s: GameState, cmd: Command) {
  const r = e.apply(s, cmd);
  expect(r.error).toBeUndefined();
  return r;
}

function act(s: GameState, heroId: string, action: ActionKind, target: ActionTarget) {
  return ok(s, { type: 'act', heroId, action, target, focus: 0 });
}

const endTurn = (s: GameState) => ok(s, { type: 'endTurn' });

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

/** Dose a hero (or anything) directly, as a bite or a dart would. */
function dose(s: GameState, id: string, by = 'test') {
  envenom(ctx(s), id, by);
}

describe('V4.0 venom (spec 29)', () => {
  describe('29.1 the countdown', () => {
    it(`starts at ${VENOM_ROUNDS}, ticks down each world phase; a second dose takes 1 off (min 1), never more`, () => {
      let s = delve();
      dose(s, 'keven');
      expect(hero(s, 'keven').venom).toBe(VENOM_ROUNDS);
      s = endTurn(s).state;
      expect(hero(s, 'keven').venom).toBe(VENOM_ROUNDS - 1);
      dose(s, 'keven');
      expect(hero(s, 'keven').venom).toBe(VENOM_ROUNDS - 2);
      dose(s, 'keven');
      dose(s, 'keven');
      expect(hero(s, 'keven').venom).toBe(1);
    });
  });

  describe('29.2 paralysis', () => {
    it('at 0 the hero is paralyzed: no move, no action (free ones too), no bleeding, not downed; it wears off after the rounds', () => {
      let s = delve();
      dose(s, 'keven');
      for (let i = 0; i < VENOM_ROUNDS; i++) s = endTurn(s).state;
      const k = hero(s, 'keven');
      expect(k.status).toBe('active');
      expect(k.paralyzed).toBe(PARALYSIS_ROUNDS);
      expect(k.venom ?? 0).toBe(0);
      expect(e.actions(s, 'keven')).toEqual([]);
      expect(e.reachable(s, 'keven')).toEqual([]);
      expect(e.apply(s, { type: 'move', heroId: 'keven', path: [at(1, 3, 6)] }).error).toMatch(/paralyzed/);
      expect(e.apply(s, { type: 'act', heroId: 'keven', action: 'drop', target: {}, focus: 0 }).error).toMatch(/paralyzed/);
      const hp = k.hp;
      for (let i = 0; i < PARALYSIS_ROUNDS - 1; i++) {
        s = endTurn(s).state;
        expect(hero(s, 'keven').status).toBe('active');
        expect(hero(s, 'keven').paralyzed).toBe(PARALYSIS_ROUNDS - 1 - i);
      }
      expect(hero(s, 'keven').hp).toBe(hp);
      const r = endTurn(s);
      s = r.state;
      expect(hero(s, 'keven').paralyzed ?? 0).toBe(0);
      expect(r.events.some((x) => x.type === 'cured' && x.id === 'keven' && x.how === 'worn')).toBe(true);
      expect(e.reachable(s, 'keven').length).toBeGreaterThan(0);
    });

    it('damage to a paralyzed hero hurts as usual (not instant death); at 0 HP they go down by the normal rules', () => {
      const s = delve();
      const k = hero(s, 'keven');
      k.paralyzed = 4;
      const hp0 = k.hp;
      hero(s, 'brann').at = at(1, 1, 1);
      monster(s, 'orc', at(1, 3, 6));
      const r = until(s, { type: 'endTurn' }, (ev) => ev.some((x) => x.type === 'hit' && x.target === 'keven' && x.damage > 0));
      const after = hero(r.state, 'keven');
      expect(after.hp).toBeLessThan(hp0);
      expect(after.hp).toBeGreaterThan(0);
      expect(after.status).toBe('active');
      // and down at 0 by the normal rules
      const t = structuredClone(r.state);
      hero(t, 'keven').hp = 1;
      const r2 = until(t, { type: 'endTurn' }, (ev) => ev.some((x) => x.type === 'downed' && x.id === 'keven'));
      expect(hero(r2.state, 'keven').status).toBe('downed');
    });

    it('monsters go for a paralyzed hero (unlike a downed one)', () => {
      const s = delve();
      hero(s, 'keven').paralyzed = 5;
      hero(s, 'brann').at = at(1, 1, 1); // far off in the pantry corner, out of the way
      const m = monster(s, 'orc', at(1, 3, 6));
      const r = ok(s, { type: 'endTurn' });
      expect(r.events.some((x) => x.type === 'roll' && x.who === m.id)).toBe(true);
      const it = r.state.delve!.monsters.find((x) => x.id === m.id)!.intent;
      expect(it?.targetId).toBe('keven');
    });

    it('a paralyzed monster neither moves nor acts, and shows no intent; a paralyzed crew member waits', () => {
      let s = delve();
      const m = monster(s, 'orc', at(1, 5, 6));
      m.paralyzed = 3;
      const r = ok(s, { type: 'endTurn' });
      s = r.state;
      const m2 = s.delve!.monsters.find((x) => x.id === m.id)!;
      expect(samePos(m2.at, at(1, 5, 6))).toBe(true);
      expect(r.events.some((x) => x.type === 'roll' && x.who === m.id)).toBe(false);
      expect(m2.intent).toBeUndefined();
      const cr = buildCrew(s as GameStateX, 'gallows-choir', [at(1, 10, 7), at(1, 11, 6), at(1, 9, 6)]);
      cr.stance = 'hostile';
      cr.spotted = true;
      s.delve!.rivals = cr;
      (cr.members[0] as RivalX).paralyzed = 2;
      expect(planRival(ctx(s), cr.members[0] as RivalX).kind).toBe('wait');
    });
  });

  describe('29.3 sources', () => {
    it('a spider bite that hits envenoms (heroes, every level)', () => {
      const s = delve();
      hero(s, 'brann').at = at(1, 1, 1);
      const sp = monster(s, 'spider', at(1, 3, 6));
      const r = until(s, { type: 'endTurn' }, (ev) => ev.some((x) => x.type === 'hit' && x.attacker === sp.id && x.target === 'keven'));
      expect(hero(r.state, 'keven').venom).toBe(VENOM_ROUNDS);
      expect(r.events.some((x) => x.type === 'envenomed' && x.id === 'keven' && x.by === sp.id)).toBe(true);
      // a miss doesn't
      const m = until(s, { type: 'endTurn' }, (ev) => ev.some((x) => x.type === 'miss' && x.attacker === sp.id));
      expect(hero(m.state, 'keven').venom ?? 0).toBe(0);
    });

    it('the venom dart: throw 5, 1 Finesse slot; a hit envenoms a monster, which is paralyzed in 3 world phases; not the Dragon', () => {
      let s = delve();
      const it = give(s, 'keven', 'venomdart');
      const m = monster(s, 'orc', at(1, 6, 8), 'alert');
      m.facing = 0;
      const opt = e.actions(s, 'keven').find((o) => o.action === 'venomdart');
      expect(opt?.targets.some((t) => t.id === m.id)).toBe(true);
      const pv = e.preview(s, 'keven', 'venomdart', { id: m.id, itemId: it.id });
      expect(pv.slots).toBe(1);
      expect(pv.noise).toBe(0);
      expect(pv.outcomes[1]).toMatch(/paralyzed in 3 turns/);
      const r = until(s, { type: 'act', heroId: 'keven', action: 'venomdart', target: { id: m.id, itemId: it.id }, focus: 0 }, (ev) => ev.some((x) => x.type === 'envenomed'));
      s = r.state;
      expect(hero(s, 'keven').pack.some((i) => i.kind === 'venomdart')).toBe(false);
      expect(s.delve!.monsters[0]!.venom).toBe(VENOM_ROUNDS);
      for (let i = 0; i < VENOM_ROUNDS; i++) s = endTurn(s).state;
      const mm = s.delve!.monsters[0]!;
      expect(mm.paralyzed).toBe(PARALYSIS_ROUNDS);
      const was = { ...mm.at };
      s = endTurn(s).state;
      expect(samePos(s.delve!.monsters[0]!.at, was)).toBe(true);
      // The Dragon is not a target.
      const t = delve();
      give(t, 'keven', 'venomdart');
      monster(t, 'dragon', at(1, 6, 8), 'hunting');
      expect(e.actions(t, 'keven').find((o) => o.action === 'venomdart')).toBeUndefined();
    });

    it('a crew Burglar (the Gallows Choir) carries a venom dart and throws it at a hero alone, by the heroes\' rule', () => {
      const s = delve([]);
      const k = hero(s, 'keven');
      k.at = at(1, 9, 7);
      k.facing = undefined;
      const cr = buildCrew(s as GameStateX, 'gallows-choir', [at(1, 3, 8), at(1, 12, 7), at(1, 1, 8)]);
      cr.stance = 'hostile';
      cr.spotted = true;
      s.delve!.rivals = cr;
      const mags = cr.members.find((r) => r.cls === 'burglar') as RivalX;
      expect(mags.pack!.some((i) => i.kind === 'venomdart')).toBe(true);
      const intent = planRival(ctx(s), mags);
      expect(intent.kind).toBe('venomdart');
      expect(intent.targetId).toBe('keven');
      mags.intent = intent;
      // the other two stay out of it
      cr.members.filter((r) => r !== mags).forEach((r) => (r.goneOut = true));
      const r = until(s, { type: 'endTurn' }, (ev) => ev.some((x) => x.type === 'envenomed' && x.id === 'keven'));
      expect(hero(r.state, 'keven').venom).toBe(VENOM_ROUNDS);
      expect((r.state.delve!.rivals!.members.find((x) => x.id === mags.id) as RivalX).pack!.some((i) => i.kind === 'venomdart')).toBe(false);
    });

    it('a hero\'s venom dart envenoms a crew member (and makes the crew hostile); paralyzed, she stops', () => {
      let s = delve();
      const it = give(s, 'keven', 'venomdart');
      const cr = buildCrew(s as GameStateX, 'lantern-sisters', [at(1, 6, 6), at(1, 6, 8), at(1, 1, 8)]);
      cr.spotted = true;
      s.delve!.rivals = cr;
      const sis = cr.members[0]!;
      const r = until(s, { type: 'act', heroId: 'keven', action: 'venomdart', target: { id: sis.id, itemId: it.id }, focus: 0 }, (ev) => ev.some((x) => x.type === 'envenomed'));
      s = r.state;
      expect(s.delve!.rivals!.stance).toBe('hostile');
      expect(s.delve!.rivals!.members[0]!.venom).toBe(VENOM_ROUNDS);
      // one world phase from paralysis: it locks her up before she acts, and she stays put
      s.delve!.rivals!.members[0]!.venom = 1;
      const was = { ...s.delve!.rivals!.members[0]!.at };
      const r2 = endTurn(s);
      const sis2 = r2.state.delve!.rivals!.members[0]!;
      expect(sis2.paralyzed).toBe(PARALYSIS_ROUNDS);
      expect(samePos(sis2.at, was)).toBe(true);
      expect(r2.events.some((x) => x.type === 'roll' && x.who === sis2.id)).toBe(false);
    });

    it('a venom trap bites for 1 and envenoms (instead of 3); spotted, the move preview path avoids it', () => {
      let s = delve();
      const trapAt = at(1, 3, 6);
      s.delve!.traps[posKey(trapAt)] = { spotted: false, venom: true };
      const hp = hero(s, 'keven').hp;
      const r = ok(s, { type: 'move', heroId: 'keven', path: [trapAt] });
      s = r.state;
      expect(hero(s, 'keven').hp).toBe(hp - 1);
      expect(hero(s, 'keven').venom).toBe(VENOM_ROUNDS);
      expect(r.events.some((x) => x.type === 'trap' && x.venom && x.damage === 1)).toBe(true);
      expect(s.delve!.traps[posKey(trapAt)]).toBeUndefined();
    });

    it('a delve on the real castle data arms its venom traps as venom traps', async () => {
      const { castle } = await import('../data/castle/index');
      const real = createEngine(castle);
      const s0 = real.newGame(3);
      const k = s0.campaign.board[0]!;
      const r = real.apply(s0, { type: 'startDelve', contractId: k.id, heroIds: ['keven'], entrance: 0, packs: {} });
      const venomKeys = castle.traps.filter((t) => t.venom).map((t) => posKey(t.at));
      expect(venomKeys.length).toBeGreaterThan(0);
      for (const key of venomKeys) expect(r.state.delve!.traps[key]).toEqual({ spotted: false, venom: true });
    });
  });

  describe('29.6 cures', () => {
    it('the antidote: on yourself while envenomed, or on a paralyzed hero next to you', () => {
      let s = delve();
      const a = give(s, 'keven', 'antidote');
      dose(s, 'keven');
      expect(e.actions(s, 'keven').find((o) => o.action === 'antidote')?.targets.map((t) => t.id)).toEqual(['keven']);
      s = act(s, 'keven', 'antidote', { id: 'keven', itemId: a.id }).state;
      expect(hero(s, 'keven').venom ?? 0).toBe(0);
      expect(hero(s, 'keven').pack.some((i) => i.kind === 'antidote')).toBe(false);
      // paralyzed Brann next to Keven
      const b = give(s, 'keven', 'antidote');
      hero(s, 'keven').acted = false;
      hero(s, 'brann').paralyzed = 4;
      const r = act(s, 'keven', 'antidote', { id: 'brann', itemId: b.id });
      expect(hero(r.state, 'brann').paralyzed ?? 0).toBe(0);
      expect(r.events.some((x) => x.type === 'cured' && x.id === 'brann' && x.how === 'antidote')).toBe(true);
      expect(e.reachable(r.state, 'brann').length).toBeGreaterThan(0);
    });

    it('the Hedgewitch\'s Mend draws venom out too (a target even at full HP)', () => {
      const s = delve([['wren', 'Wren', 'hedgewitch'], ['brann', 'Brann', 'sellsword']]);
      hero(s, 'brann').paralyzed = 3;
      const opt = e.actions(s, 'wren').find((o) => o.action === 'mend');
      expect(opt?.targets.some((t) => t.id === 'brann')).toBe(true);
      const r = act(s, 'wren', 'mend', { id: 'brann' });
      expect(hero(r.state, 'brann').paralyzed ?? 0).toBe(0);
      expect(r.events.some((x) => x.type === 'cured' && x.how === 'mend')).toBe(true);
    });

    it('leaving the castle clears venom', () => {
      const s = delve();
      const k = hero(s, 'keven');
      k.at = at(1, 2, 9); // the exit
      dose(s, 'keven');
      const r = act(s, 'keven', 'leave', {});
      expect(hero(r.state, 'keven').status).toBe('out');
      expect(hero(r.state, 'keven').venom ?? 0).toBe(0);
      expect(r.events.some((x) => x.type === 'cured' && x.id === 'keven' && x.how === 'out')).toBe(true);
    });
  });

  describe('29.4 carrying a paralyzed ally', () => {
    it('Shoulder (an action) next to a paralyzed ally; they follow every move; the carrier moves 3 at most; set down is free', () => {
      let s = delve();
      hero(s, 'brann').paralyzed = 5;
      expect(e.actions(s, 'keven').find((o) => o.action === 'shoulder')?.targets.map((t) => t.id)).toEqual(['brann']);
      const full = Math.max(...e.reachable(s, 'keven').map((r) => r.cost));
      expect(full).toBe(4);
      s = act(s, 'keven', 'shoulder', { id: 'brann' }).state;
      expect(hero(s, 'keven').carrying).toBe('brann');
      expect(hero(s, 'keven').acted).toBe(true);
      expect(Math.max(...e.reachable(s, 'keven').map((r) => r.cost))).toBe(3);
      const dest = e.reachable(s, 'keven').find((r) => r.cost === 3)!;
      s = ok(s, { type: 'move', heroId: 'keven', path: dest.path }).state;
      const k = hero(s, 'keven');
      const b = hero(s, 'brann');
      expect(posNeighbors(k.at).some((p) => samePos(p, b.at))).toBe(true);
      // set down: free (the action is already spent)
      const sd = e.actions(s, 'keven').find((o) => o.action === 'setDown');
      expect(sd).toBeDefined();
      s = act(s, 'keven', 'setDown', {}).state;
      expect(hero(s, 'keven').carrying).toBeUndefined();
    });

    it('a carrier who leaves takes the carried ally out too (venom drawn out); carrying ends if the carried one recovers', () => {
      let s = delve();
      const exit = at(1, 2, 9);
      const k = hero(s, 'keven');
      k.at = { ...exit };
      const b = hero(s, 'brann');
      b.at = posNeighbors(exit).find((p) => e.castle().levels[0]!.tiles[`${p.q},${p.r}`]?.kind === 'floor')!;
      b.paralyzed = 4;
      s = act(s, 'keven', 'shoulder', { id: 'brann' }).state;
      const r = act(s, 'keven', 'leave', {});
      expect(hero(r.state, 'brann').status).toBe('out');
      expect(hero(r.state, 'brann').paralyzed ?? 0).toBe(0);
      expect(r.state.stage).toBe('summary');
      expect(r.state.summary!.survivors).toEqual(expect.arrayContaining(['keven', 'brann']));
      // recovery ends the carry
      let t = delve();
      hero(t, 'brann').paralyzed = 1;
      t = act(t, 'keven', 'shoulder', { id: 'brann' }).state;
      t = endTurn(t).state;
      expect(hero(t, 'keven').carrying).toBeUndefined();
    });

    it('a paralyzed hero left inside when the delve ends is lost, like a downed one', () => {
      const s = delve();
      const k = hero(s, 'keven');
      k.at = at(1, 2, 9);
      hero(s, 'brann').paralyzed = 5;
      const r = act(s, 'keven', 'leave', {});
      expect(r.state.stage).toBe('summary');
      expect(hero(r.state, 'brann').status).toBe('dead');
      expect(r.state.summary!.dead).toContain('brann');
    });

    it('with every hero still inside paralyzed (or down), the delve ends', () => {
      let s = delve([]);
      dose(s, 'keven');
      for (let i = 0; i < VENOM_ROUNDS; i++) s = endTurn(s).state;
      expect(s.stage).not.toBe('delve');
    });
  });

  it('is deterministic: the same seed and commands give the same game', () => {
    const run = () => {
      let s = delve();
      const it = give(s, 'keven', 'venomdart');
      monster(s, 'spider', at(1, 6, 8), 'hunting');
      const m = s.delve!.monsters[0]!;
      s = act(s, 'keven', 'venomdart', { id: m.id, itemId: it.id }).state;
      for (let i = 0; i < 5; i++) if (s.stage === 'delve') s = endTurn(s).state;
      return JSON.stringify(s);
    };
    expect(run()).toBe(run());
  });
});
