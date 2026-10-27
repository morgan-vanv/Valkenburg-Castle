// V4.1 (WS3, spec 31.4): poison, downed, carry and unshackle. Replaces venom.test.ts (V4.0 venom and paralysis).

import { describe, it, expect } from 'vitest';
import { createEngine, migratePoison } from './engine';
import { at, testCastle } from './test/testCastle';
import { posKey, samePos, type Pos } from './hex';
import type { ActionKind, ActionTarget, Command, GameEvent, GameState, HeroClass, ItemKind, Monster, MonsterKind } from './types';
import { BLEED_START, CARRY_MOVE, MEND_UP_HP, MONSTERS, POTION_HEAL } from './data';
import { World } from './world';
import type { Ctx, DelveX, GameStateX, MonsterX, RivalX } from './state';
import { makeHero } from './camp';
import { hurtAny, makeItem, occupant } from './common';
import { buildCrew, planRival } from './rivals';
import { poison } from './poison';
import { fall } from './falls';

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
  // Hand-placed in the gate room of the test keep (the exit at (2, 9) is its south wall).
  const spots = [at(1, 3, 7), at(1, 4, 7), at(1, 5, 7), at(1, 4, 6)];
  t.delve!.heroes.forEach((h, i) => {
    h.at = { ...spots[i]! };
    h.facing = undefined;
  });
  return t;
}

const hero = (s: GameState, id: string) => s.delve!.heroes.find((h) => h.heroId === id)!;

function give(s: GameState, id: string, kind: ItemKind, amount = 1) {
  const it = makeItem({ s: s as GameStateX }, kind, amount);
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

const ctx = (s: GameState): Ctx => ({ w, s: s as GameStateX, d: s.delve as DelveX, ev: [] as GameEvent[] });

function ok(s: GameState, cmd: Command) {
  const r = e.apply(s, cmd);
  expect(r.error).toBeUndefined();
  return r;
}
const act = (s: GameState, heroId: string, action: ActionKind, target: ActionTarget) => ok(s, { type: 'act', heroId, action, target, focus: 0 });
const endTurn = (s: GameState) => ok(s, { type: 'endTurn' });
const opt = (s: GameState, heroId: string, a: ActionKind) => e.actions(s, heroId).find((o) => o.action === a);

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

function down(s: GameState, id: string) {
  Object.assign(hero(s, id), { status: 'downed', hp: 0, bleed: BLEED_START });
}

/** A shackled captive in the gate room. */
function captive(s: GameState, p: Pos = at(1, 3, 8)) {
  s.delve!.prisoner = { id: 'p1', name: 'Wim', at: { ...p }, hp: 5, freed: false, out: false, dead: false };
  return s.delve!.prisoner;
}

describe('V4.1 poison (spec 31.4)', () => {
  it('a dose poisons: 1 damage each world phase, never below 1 HP, never downs; a second dose changes nothing', () => {
    let s = delve();
    hero(s, 'keven').hp = 3;
    poison(ctx(s), 'keven', 'test');
    expect(hero(s, 'keven').poisoned).toBe(true);
    expect(poison(ctx(s), 'keven', 'test')).toBe(false);
    s = endTurn(s).state;
    expect(hero(s, 'keven').hp).toBe(2);
    s = endTurn(s).state;
    expect(hero(s, 'keven').hp).toBe(1);
    s = endTurn(s).state;
    expect(hero(s, 'keven')).toMatchObject({ hp: 1, status: 'active', poisoned: true });
  });

  it("doesn't tick on a downed hero; monsters (not the Dragon) and crew members are poisoned the same way", () => {
    let s = delve();
    down(s, 'brann');
    hero(s, 'brann').poisoned = true;
    const m = monster(s, 'orc', at(1, 16, 2), 'asleep');
    poison(ctx(s), m.id, 'test');
    const dragon = monster(s, 'dragon', at(1, 16, 3), 'asleep');
    expect(poison(ctx(s), dragon.id, 'test')).toBe(false);
    const cr = buildCrew(s as GameStateX, 'lantern-sisters', [at(1, 16, 7), at(1, 17, 7), at(1, 15, 8)]);
    s.delve!.rivals = cr;
    (cr as { entered?: boolean }).entered = true;
    cr.entersRound = 0;
    poison(ctx(s), cr.members[0]!.id, 'test');
    const mhp = m.hp;
    const rhp = cr.members[0]!.hp;
    s = endTurn(s).state;
    expect(hero(s, 'brann').status).toBe('downed');
    expect(s.delve!.monsters.find((x) => x.id === m.id)!.hp).toBe(mhp - 1);
    expect(s.delve!.rivals!.members[0]!.hp).toBe(rhp - 1);
  });

  it('a spider bite that hits poisons; the poison dart poisons a monster (silent, 1 Finesse slot)', () => {
    const s = delve([]);
    monster(s, 'spider', at(1, 4, 7));
    const r = until(s, { type: 'endTurn' }, (ev) => ev.some((x) => x.type === 'hit' && x.target === 'keven' && x.damage > 0 && x.attacker !== 'poison'));
    if (hero(r.state, 'keven').status === 'active') expect(hero(r.state, 'keven').poisoned).toBe(true);
    let t = delve();
    const dart = give(t, 'keven', 'venomdart');
    const m = monster(t, 'orc', at(1, 6, 8), 'alert');
    const pv = e.preview(t, 'keven', 'venomdart', { id: m.id, itemId: dart.id });
    expect(pv).toMatchObject({ slots: 1, noise: 0 });
    expect(pv.outcomes[1]).toMatch(/Poisoned/);
    t = until(t, { type: 'act', heroId: 'keven', action: 'venomdart', target: { id: m.id, itemId: dart.id }, focus: 0 }, (ev) => ev.some((x) => x.type === 'poisoned')).state;
    expect(t.delve!.monsters[0]!.poisoned).toBe(true);
    expect(opt(t, 'keven', 'venomdart')).toBeUndefined();
  });

  it('a poison trap bites for 1 and poisons', () => {
    let s = delve();
    const p = at(1, 3, 6);
    s.delve!.traps[posKey(p)] = { spotted: false, venom: true };
    const hp = hero(s, 'keven').hp;
    s = ok(s, { type: 'move', heroId: 'keven', path: [p] }).state;
    expect(hero(s, 'keven')).toMatchObject({ hp: hp - 1, poisoned: true });
  });

  it("Spider-milk Stout's drinker can't be poisoned", () => {
    const s = delve();
    hero(s, 'keven').ale = 'spidermilk';
    expect(poison(ctx(s), 'keven', 'test')).toBe(false);
    expect(hero(s, 'keven').poisoned).toBeFalsy();
  });

  it('antipoison: an action on yourself or a poisoned ally next to you, up or downed', () => {
    let s = delve();
    const a = give(s, 'keven', 'antidote');
    give(s, 'keven', 'antidote');
    hero(s, 'keven').poisoned = true;
    hero(s, 'brann').poisoned = true;
    down(s, 'brann');
    const o = opt(s, 'keven', 'antidote')!;
    expect(o.targets.map((t) => t.id).sort()).toEqual(['brann', 'keven']);
    s = act(s, 'keven', 'antidote', { id: 'brann', itemId: a.id }).state;
    expect(hero(s, 'brann').poisoned).toBeFalsy();
    expect(hero(s, 'keven').acted).toBe(true);
    expect(hero(s, 'keven').poisoned).toBe(true);
  });

  it('Mend cures poison (a target at full HP); leaving cures it', () => {
    let s = delve([['wren', 'Wren', 'hedgewitch']]);
    hero(s, 'keven').poisoned = true;
    expect(opt(s, 'wren', 'mend')!.targets.some((t) => t.id === 'keven')).toBe(true);
    s = act(s, 'wren', 'mend', { id: 'keven' }).state;
    expect(hero(s, 'keven').poisoned).toBeFalsy();
    let t = delve();
    hero(t, 'keven').poisoned = true;
    hero(t, 'keven').at = at(1, 2, 9);
    const r = act(t, 'keven', 'leave', {});
    expect(r.events.some((x) => x.type === 'cured' && x.id === 'keven' && x.how === 'out')).toBe(true);
    t = r.state;
    expect(hero(t, 'keven').poisoned).toBeFalsy();
  });
});

describe('V4.1 downed (spec 31.4)', () => {
  it(`bleeds out in ${BLEED_START} world phases; any damage to a downed hero kills; no Revive`, () => {
    let s = delve();
    hero(s, 'brann').hp = 1;
    hurtAny(ctx(s), 'brann', 1, 'test');
    expect(hero(s, 'brann')).toMatchObject({ status: 'downed', bleed: 3 });
    expect(e.actions(s, 'keven').some((o) => (o.action as string) === 'revive')).toBe(false);
    s = endTurn(s).state;
    s = endTurn(s).state;
    expect(hero(s, 'brann')).toMatchObject({ status: 'downed', bleed: 1 });
    s = endTurn(s).state;
    expect(hero(s, 'brann').status).toBe('dead');
    const t = delve();
    down(t, 'brann');
    hurtAny(ctx(t), 'brann', 1, 'test');
    expect(hero(t, 'brann').status).toBe('dead');
  });

  it(`a potion on an adjacent downed hero gets them up at ${POTION_HEAL.potion} (a greater potion at ${POTION_HEAL.greaterpotion})`, () => {
    let s = delve();
    down(s, 'brann');
    const p = give(s, 'keven', 'potion');
    s = act(s, 'keven', 'potion', { id: 'brann', itemId: p.id }).state;
    expect(hero(s, 'brann')).toMatchObject({ status: 'active', hp: POTION_HEAL.potion });
    let t = delve();
    down(t, 'brann');
    const g = give(t, 'keven', 'greaterpotion');
    t = act(t, 'keven', 'potion', { id: 'brann', itemId: g.id }).state;
    expect(hero(t, 'brann').hp).toBe(POTION_HEAL.greaterpotion);
  });

  it(`Mend on a downed hero within 3 gets them up at ${MEND_UP_HP}`, () => {
    let s = delve([['brann', 'Brann', 'sellsword'], ['wren', 'Wren', 'hedgewitch']]);
    down(s, 'brann');
    hero(s, 'wren').at = at(1, 6, 7); // two hexes from Brann at (4, 7)
    expect(opt(s, 'wren', 'mend')!.targets.some((t) => t.id === 'brann')).toBe(true);
    s = act(s, 'wren', 'mend', { id: 'brann' }).state;
    expect(hero(s, 'brann')).toMatchObject({ status: 'active', hp: MEND_UP_HP });
  });

  it('splints (Gerda and Aldric home): a downed hero crawls 1 hex a turn, still bleeds, may Leave on an exit', () => {
    let s = delve();
    down(s, 'brann');
    expect(e.reachable(s, 'brann')).toEqual([]);
    s.campaign.village.smith = true;
    s.campaign.village.surgeon = true;
    const reach = e.reachable(s, 'brann');
    expect(reach.length).toBeGreaterThan(0);
    expect(reach.every((r) => r.cost <= 1)).toBe(true);
    expect(e.actions(s, 'brann')).toEqual([]);
    hero(s, 'brann').at = at(1, 3, 8);
    s = ok(s, { type: 'move', heroId: 'brann', path: [at(1, 2, 9)] }).state;
    expect(e.apply(s, { type: 'move', heroId: 'brann', path: [at(1, 3, 8)] }).error).toBeDefined();
    expect(e.actions(s, 'brann').map((o) => o.action)).toEqual(['leave']);
    const r = act(s, 'brann', 'leave', {});
    expect(hero(r.state, 'brann')).toMatchObject({ status: 'out', hp: 1 });
    let t = delve();
    down(t, 'brann');
    t.campaign.village.smith = true;
    t.campaign.village.surgeon = true;
    t = endTurn(t).state;
    expect(hero(t, 'brann').bleed).toBe(BLEED_START - 1);
  });
});

describe('V4.1 Carry (spec 31.4)', () => {
  it('an action next to a downed hero: the body shares the hex and moves with the carrier, 3 at most; free actions only', () => {
    let s = delve();
    down(s, 'brann');
    const o = opt(s, 'keven', 'carry')!;
    expect(o.targets.map((t) => t.id)).toEqual(['brann']);
    s = act(s, 'keven', 'carry', { id: 'brann' }).state;
    const k = hero(s, 'keven');
    expect(k.carrying).toBe('brann');
    expect(k.acted).toBe(true);
    expect(samePos(hero(s, 'brann').at, k.at)).toBe(true);
    // The occupancy exception: the carrier counts on the hex; the body doesn't block.
    expect(occupant(ctx(s), k.at)?.id).toBe('keven');
    expect(Math.max(...e.reachable(s, 'keven').map((r) => r.cost))).toBeLessThanOrEqual(CARRY_MOVE);
    const dest = at(1, 3, 6);
    s = ok(s, { type: 'move', heroId: 'keven', path: [dest] }).state;
    expect(samePos(hero(s, 'brann').at, dest)).toBe(true);
    // Next round: no attack, no potion; Set down is offered.
    s = endTurn(s).state;
    const m = monster(s, 'orc', at(1, 3, 5), 'asleep');
    give(s, 'keven', 'potion');
    const acts = e.actions(s, 'keven').map((x) => x.action);
    expect(acts).not.toContain('attack');
    expect(acts).not.toContain('potion');
    expect(acts).toContain('setDown');
    expect(e.apply(s, { type: 'act', heroId: 'keven', action: 'attack', target: { id: m.id }, focus: 0 }).error).toMatch(/carrying/);
    s = act(s, 'keven', 'setDown', {}).state;
    expect(hero(s, 'keven').carrying).toBeUndefined();
    expect(hero(s, 'keven').acted).toBe(false);
    expect(samePos(hero(s, 'brann').at, hero(s, 'keven').at)).toBe(false);
  });

  it("a carried downed hero doesn't bleed; leaving with them brings them out alive at 1 HP", () => {
    let s = delve();
    down(s, 'brann');
    hero(s, 'keven').at = at(1, 3, 8);
    hero(s, 'brann').at = at(1, 4, 8);
    s = act(s, 'keven', 'carry', { id: 'brann' }).state;
    s = endTurn(s).state;
    s = endTurn(s).state;
    expect(hero(s, 'brann').bleed).toBe(BLEED_START);
    s = ok(s, { type: 'move', heroId: 'keven', path: [at(1, 2, 9)] }).state;
    const r = act(s, 'keven', 'leave', {});
    expect(hero(r.state, 'brann')).toMatchObject({ status: 'out', hp: 1 });
    expect(r.state.summary!.dead).not.toContain('brann');
  });

  it('area damage on the shared hex hits both (and kills the downed body); a single strike picks one; a downed carrier drops the body', () => {
    const s = delve();
    down(s, 'brann');
    const s2 = act(s, 'keven', 'carry', { id: 'brann' }).state;
    s2.delve!.burning[posKey(hero(s2, 'keven').at)] = 2;
    const r = endTurn(s2);
    expect(hero(r.state, 'brann').status).toBe('dead');
    expect(r.events.some((x) => x.type === 'hit' && x.target === 'keven')).toBe(true);
    // A carrier downed: carrying ends, the body lies on that hex.
    const u = delve();
    down(u, 'brann');
    const u2 = act(u, 'keven', 'carry', { id: 'brann' }).state;
    hero(u2, 'keven').hp = 1;
    hurtAny(ctx(u2), 'keven', 1, 'test');
    expect(hero(u2, 'keven').status).toBe('downed');
    expect(hero(u2, 'keven').carrying).toBeUndefined();
    expect(hero(u2, 'brann').status).toBe('downed');
  });

  it('a monster next to the carrier strikes the carrier, not the downed body', () => {
    let s = delve();
    down(s, 'brann');
    s = act(s, 'keven', 'carry', { id: 'brann' }).state;
    monster(s, 'orc', at(1, 3, 6));
    const r = until(s, { type: 'endTurn' }, (ev) => ev.some((x) => x.type === 'hit' && x.attacker === 'm1'));
    expect(r.events.filter((x) => x.type === 'hit' && x.attacker === 'm1').every((x) => x.type === 'hit' && x.target === 'keven')).toBe(true);
  });

  it("can't jump, climb, grapple or blink while carrying", () => {
    const s = delve([['brann', 'Brann', 'sellsword'], ['sha', 'Sha', 'shadowmancer']]);
    down(s, 'brann');
    hero(s, 'sha').at = at(1, 3, 6);
    hero(s, 'brann').at = at(1, 4, 6);
    const s2 = act(s, 'sha', 'carry', { id: 'brann' }).state;
    hero(s2, 'sha').acted = false;
    const acts = e.actions(s2, 'sha').map((o) => o.action);
    for (const a of ['blink', 'jump', 'climb', 'grapple'] as ActionKind[]) expect(acts).not.toContain(a);
  });

  it('a falling carrier takes the body down too', () => {
    let s = delve();
    down(s, 'brann');
    hero(s, 'keven').at = at(1, 9, 2);
    hero(s, 'brann').at = at(1, 8, 2);
    s = act(s, 'keven', 'carry', { id: 'brann' }).state;
    // Keven goes down the pit mouth (10, 3): Level 2's bridge, a level down.
    fall(ctx(s), 'keven', at(1, 10, 3), null);
    expect(hero(s, 'keven').at.level).toBe(2);
    expect(hero(s, 'brann').status).toBe('dead');
  });
});

describe('V4.1 shackled captives and Unshackle (spec 31.4)', () => {
  it('a shackled captive can be carried out (rescued) and Carry needs no tools', () => {
    let s = delve([]);
    captive(s, at(1, 3, 8));
    hero(s, 'keven').at = at(1, 2, 8);
    expect(opt(s, 'keven', 'carry')!.targets.map((t) => t.id)).toEqual(['p1']);
    s = act(s, 'keven', 'carry', { id: 'p1' }).state;
    s = ok(s, { type: 'move', heroId: 'keven', path: [at(1, 2, 9)] }).state;
    expect(samePos(s.delve!.prisoner!.at, at(1, 2, 9))).toBe(true);
    const r = act(s, 'keven', 'leave', {});
    expect(r.state.delve?.prisoner?.out ?? r.state.summary).toBeTruthy();
    expect(r.events.some((x) => x.type === 'out' && x.id === 'p1')).toBe(true);
  });

  it('Unshackle with lockpicks (silent), the key (used up), an improvised pick (one used), or Smash (2 Might slots, noise 4)', () => {
    const tools: [ItemKind | null, (s: GameState) => void][] = [
      ['lockpicks', (s) => expect(hero(s, 'keven').pack.some((i) => i.kind === 'lockpicks')).toBe(true)],
      ['key', (s) => expect(hero(s, 'keven').pack.some((i) => i.kind === 'key')).toBe(false)],
      ['improvised', (s) => expect(hero(s, 'keven').pack.find((i) => i.kind === 'improvised')?.amount).toBe(1)],
    ];
    for (const [kind, check] of tools) {
      let s = delve([]);
      captive(s);
      const it = give(s, 'keven', kind!, kind === 'improvised' ? 2 : 1);
      const r = act(s, 'keven', 'unshackle', { id: 'p1', itemId: it.id });
      s = r.state;
      expect(s.delve!.prisoner!.freed).toBe(true);
      expect(r.events.some((x) => x.type === 'noise' && x.radius >= 4)).toBe(false);
      check(s);
    }
    const s = delve([]);
    captive(s);
    const pv = e.preview(s, 'keven', 'unshackle', { id: 'p1' });
    expect(pv).toMatchObject({ slots: 2, noise: 4, stat: 'might' });
    const r = until(s, { type: 'act', heroId: 'keven', action: 'unshackle', target: { id: 'p1' }, focus: 0 }, (ev) => ev.some((x) => x.type === 'freed'));
    expect(r.state.delve!.prisoner!.freed).toBe(true);
    const miss = until(s, { type: 'act', heroId: 'keven', action: 'unshackle', target: { id: 'p1' }, focus: 0 }, (ev) => !ev.some((x) => x.type === 'freed'));
    expect(miss.state.delve!.prisoner!.freed).toBe(false);
    expect(miss.events.some((x) => x.type === 'noise' && x.radius === 4)).toBe(true);
  });

  it('unshackled, the captive follows the freer at walk 4 without slowing them; leaving with them adjacent rescues them', () => {
    let s = delve([]);
    captive(s, at(1, 4, 7));
    hero(s, 'keven').at = at(1, 5, 7);
    const picks = give(s, 'keven', 'lockpicks');
    s = act(s, 'keven', 'unshackle', { id: 'p1', itemId: picks.id }).state;
    expect(hero(s, 'keven').escorting).toBe('p1');
    expect(Math.max(...e.reachable(s, 'keven').map((r) => r.cost))).toBe(4);
    const walk = e.reachable(s, 'keven').find((r) => samePos(r.to, at(1, 2, 8)))!;
    expect(walk.cost).toBeGreaterThanOrEqual(3);
    s = ok(s, { type: 'move', heroId: 'keven', path: walk.path }).state;
    const pr = s.delve!.prisoner!;
    expect(Math.abs(pr.at.q - hero(s, 'keven').at.q) + Math.abs(pr.at.r - hero(s, 'keven').at.r)).toBeLessThanOrEqual(2);
    s = endTurn(s).state;
    s = ok(s, { type: 'move', heroId: 'keven', path: [at(1, 2, 9)] }).state;
    const r = act(s, 'keven', 'leave', {});
    expect(r.events.some((x) => x.type === 'out' && x.id === 'p1')).toBe(true);
  });

  it('a shackled captive cannot be targeted by monsters until someone carries them', () => {
    let s = delve([]);
    captive(s, at(1, 3, 8));
    hero(s, 'keven').at = at(1, 6, 7);
    monster(s, 'orc', at(1, 4, 8));
    for (let i = 0; i < 3 && s.stage === 'delve'; i++) {
      const r = endTurn(s);
      expect(r.events.some((x) => x.type === 'hit' && x.target === 'p1')).toBe(false);
      s = r.state;
    }
  });
});

describe('V4.1 crews by the same rules (spec 31.4, pillar 17)', () => {
  function crewDelve() {
    const s = delve([]);
    hero(s, 'keven').at = at(1, 3, 7);
    const cr = buildCrew(s as GameStateX, 'lantern-sisters', [at(1, 16, 7), at(1, 17, 7), at(1, 15, 8)]);
    (cr as { entered?: boolean }).entered = true;
    cr.entersRound = 0;
    s.delve!.rivals = cr;
    return { s, cr };
  }

  it('a member at 0 HP goes down (bleeds out in 3), any damage kills it and drops its loot', () => {
    const { s, cr } = crewDelve();
    const r = cr.members[0] as RivalX;
    s.delve!.ground = [];
    r.loot.push(makeItem({ s: s as GameStateX }, 'gold', 30));
    hurtAny(ctx(s), r.id, r.hp, 'keven');
    expect(r).toMatchObject({ downed: true, hp: 0, bleed: BLEED_START });
    expect(r.goneOut).toBe(false);
    expect(s.delve!.ground.some((g) => g.items.some((i) => i.kind === 'gold'))).toBe(false);
    hurtAny(ctx(s), r.id, 1, 'keven');
    expect(r.downed).toBeFalsy();
    expect(s.delve!.ground.some((g) => g.items.some((i) => i.kind === 'gold' && i.amount === 30))).toBe(true);
  });

  it('a downed member bleeds out unless a crewmate potions it up', () => {
    let { s, cr } = crewDelve();
    for (const m of cr.members) m.pack = [];
    const a = cr.members[0] as RivalX;
    hurtAny(ctx(s), a.id, a.hp, null);
    cr.members.slice(1).forEach((m) => (m.goneOut = true));
    for (let i = 0; i < BLEED_START; i++) s = endTurn(s).state;
    expect(s.delve!.rivals!.members[0]!.downed).toBeFalsy();
    expect(s.delve!.rivals!.members[0]!.hp).toBe(0);
    ({ s, cr } = crewDelve());
    const b = cr.members[0] as RivalX;
    const mate = cr.members[1] as RivalX;
    mate.at = at(1, 16, 8);
    b.at = at(1, 16, 7);
    mate.pack = [makeItem({ s: s as GameStateX }, 'potion')];
    hurtAny(ctx(s), b.id, b.hp, null);
    const plan = planRival(ctx(s), mate);
    expect(plan).toMatchObject({ kind: 'potion', targetId: b.id });
    mate.intent = plan;
    s = endTurn(s).state;
    expect(s.delve!.rivals!.members[0]).toMatchObject({ hp: POTION_HEAL.potion });
    expect(s.delve!.rivals!.members[0]!.downed).toBeFalsy();
  });

  it('with no cure in the crew, a crewmate lifts the downed member (Carry: shared hex) and walks it out', () => {
    let { s, cr } = crewDelve();
    for (const m of cr.members) m.pack = [];
    const b = cr.members[0] as RivalX;
    const mate = cr.members[1] as RivalX;
    cr.members[2]!.goneOut = true;
    b.at = at(1, 17, 8);
    mate.at = at(1, 17, 7);
    hurtAny(ctx(s), b.id, b.hp, null);
    const plan = planRival(ctx(s), mate);
    expect(plan).toMatchObject({ kind: 'carry', targetId: b.id });
    mate.intent = plan;
    s = endTurn(s).state;
    const m2 = s.delve!.rivals!.members[1]!;
    const b2 = s.delve!.rivals!.members[0]!;
    if (!m2.goneOut) {
      expect(m2.carrying).toBe(b.id);
      expect(samePos(m2.at, b2.at)).toBe(true);
      expect(b2.bleed).toBe(BLEED_START);
    } else expect(b2.goneOut).toBe(true);
  });

  it('a crew Hedgewitch mends a downed member up at 2', () => {
    let s = delve([]);
    const cr = buildCrew(s as GameStateX, 'the-wake', [at(1, 16, 7), at(1, 17, 7), at(1, 15, 8), at(1, 16, 8)]);
    (cr as { entered?: boolean }).entered = true;
    cr.entersRound = 0;
    s.delve!.rivals = cr;
    const witch = cr.members.find((r) => r.cls === 'hedgewitch') as RivalX;
    const other = cr.members.find((r) => r !== witch) as RivalX;
    for (const m of cr.members) m.pack = [];
    other.at = at(1, 17, 3);
    witch.at = at(1, 16, 3);
    hurtAny(ctx(s), other.id, other.hp, null);
    const plan = planRival(ctx(s), witch);
    expect(plan).toMatchObject({ kind: 'mend', targetId: other.id });
    witch.intent = plan;
    s = endTurn(s).state;
    expect(s.delve!.rivals!.members.find((r) => r.id === other.id)).toMatchObject({ hp: MEND_UP_HP });
  });

  it('a crew carrying off a lone downed hero uses Carry (the hero on its hex); killing the carrier drops the hero', () => {
    let s = delve();
    const cr = buildCrew(s as GameStateX, 'ferrymen', [at(1, 5, 7), at(1, 17, 1), at(1, 17, 2)]);
    (cr as { entered?: boolean }).entered = true;
    cr.entersRound = 0;
    cr.stance = 'hostile';
    cr.spotted = true;
    s.delve!.rivals = cr;
    cr.members.slice(1).forEach((m) => (m.goneOut = true));
    hero(s, 'keven').at = at(1, 16, 2);
    hero(s, 'brann').at = at(1, 4, 7);
    down(s, 'brann');
    const r = cr.members[0] as RivalX;
    r.at = at(1, 5, 7);
    r.intent = planRival(ctx(s), r);
    expect(r.intent.kind).toBe('rob');
    s = endTurn(s).state;
    const r2 = s.delve!.rivals!.members[0]!;
    expect(r2.dragging).toBe('brann');
    expect(samePos(hero(s, 'brann').at, r2.at)).toBe(true);
    hurtAny(ctx(s), r2.id, 999, 'keven');
    expect(s.delve!.rivals!.members[0]!.dragging).toBeUndefined();
    expect(hero(s, 'brann').status).toBe('downed');
  });
});

describe('V4.1 old saves (spec 31.4)', () => {
  it('an envenomed or paralyzed figure loads as poisoned; a V4.0 shoulder carry of a paralyzed ally ends', () => {
    const s = delve();
    const k = hero(s, 'keven') as unknown as Record<string, unknown>;
    const b = hero(s, 'brann') as unknown as Record<string, unknown>;
    k.venom = 2;
    b.paralyzed = 4;
    k.carrying = 'brann';
    const loaded = e.deserialize(e.serialize(s))!;
    expect(hero(loaded, 'keven').poisoned).toBe(true);
    expect(hero(loaded, 'brann').poisoned).toBe(true);
    expect((hero(loaded, 'keven') as unknown as Record<string, unknown>).venom).toBeUndefined();
    expect(hero(loaded, 'keven').carrying).toBeUndefined();
    const m = { venom: 0, paralyzed: 3 } as unknown as MonsterX;
    const d = { heroes: [], monsters: [m], rivals: null, prisoner: null } as unknown as DelveX;
    migratePoison(d);
    expect(m.poisoned).toBe(true);
  });
});

it('is deterministic: the same seed and commands give the same game', () => {
  const run = () => {
    let s = delve();
    const it = give(s, 'keven', 'venomdart');
    monster(s, 'spider', at(1, 6, 8), 'hunting');
    s = act(s, 'keven', 'venomdart', { id: 'm1', itemId: it.id }).state;
    for (let i = 0; i < 5; i++) if (s.stage === 'delve') s = endTurn(s).state;
    return JSON.stringify(s);
  };
  expect(run()).toBe(run());
});
