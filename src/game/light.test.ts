// V4.1 (WS2, spec 31.5): light. Torches are the clock: no free lantern, torches and Gerda's lantern are pack items
// that burn down, darkness by the hero's own hex, the Gloam on Level 3 only, crews carry light, the Unlit chip.

import { describe, expect, it } from 'vitest';
import { createEngine } from './engine';
import { at, testCastle } from './test/testCastle';
import { posKey, type Pos } from './hex';
import type { ActionKind, ActionTarget, Command, GameState, Item } from './types';
import { makeHero } from './camp';
import { buildCrew } from './rivals';
import { crewTarget } from './crewai';
import { killHero } from './common';
import type { DelveX, GameStateX } from './state';
import { World, litSet } from './world';
import { LANTERN_MAX, SISTERS_LEAVE_ROUND, TORCH_RADIUS, TORCH_ROUNDS } from './data';

const e = createEngine(testCastle);
const w = new World(testCastle);

function ok(s: GameState, cmd: Command) {
  const r = e.apply(s, cmd);
  expect(r.error).toBeUndefined();
  return r;
}
const act = (s: GameState, heroId: string, action: ActionKind, target: ActionTarget) => ok(s, { type: 'act', heroId, action, target, focus: 0 });
const hero = (s: GameState, id: string) => s.delve!.heroes.find((h) => h.heroId === id)!;
const put = (s: GameState, id: string, p: Pos) => void (hero(s, id).at = { ...p });
const option = (s: GameState, id: string, a: ActionKind) => e.actions(s, id).find((o) => o.action === a);
const item = (id: string, kind: Item['kind'], extra: Partial<Item> = {}): Item => ({ id, kind, name: kind === 'lantern' ? 'Lantern' : 'Torch', amount: 1, slots: 1, ...extra });
const ctx = (s: GameState) => ({ w, s: s as GameStateX, d: s.delve as DelveX, ev: [] });

/** A camp with Keven, Brann (sellsword) and Aldous (pyromancer); `stash` items to pack. */
function camp(stash: Item[] = []): GameState {
  const s = e.newGame(1);
  s.campaign.roster.push(makeHero('brann', 'Brann', 'sellsword'), makeHero('aldous', 'Aldous', 'pyromancer'));
  s.campaign.stash.push(...stash);
  return s;
}

/** A delve on the test castle, nothing about but the party; packs from `packs` (hero id to stash item ids). */
function delve(stash: Item[] = [], packs: Record<string, string[]> = {}, heroes = ['keven', 'brann', 'aldous']): GameState {
  const s = camp(stash);
  const k = s.campaign.board[0]!;
  const t = ok(s, { type: 'startDelve', contractId: k.id, heroIds: heroes, entrance: 0, packs }).state;
  t.delve!.monsters = [];
  t.delve!.rivals = null;
  t.delve!.traps = {};
  (t.delve as DelveX).fuses = [{ at: at(3, 5, 5), rounds: 99, by: 'x' }]; // never calm
  return t;
}

/** Everyone parked far apart on Level 2 (unlit there), Keven at `p`. */
function onL2(s: GameState, p: Pos = at(2, 10, 7)): GameState {
  put(s, 'keven', p);
  put(s, 'brann', at(2, 16, 8));
  put(s, 'aldous', at(2, 3, 8));
  return s;
}

const torchOf = (s: GameState, id: string) => hero(s, id).pack.find((i) => i.kind === 'torch');
const lit = (s: GameState, p: Pos) => e.visibility(s).lit.has(posKey(p));

describe('V4.1 (WS2) no free lantern', () => {
  it('a delve starts with no party light; a packed torch goes in unlit; Level 2 is dark', () => {
    const s = onL2(delve([item('t1', 'torch')], { keven: ['t1'] }));
    expect((s.delve as DelveX).light).toBeUndefined();
    expect(s.delve!.heroes.every((h) => !h.pack.some((i) => i.kind === 'lantern'))).toBe(true);
    expect(torchOf(s, 'keven')).toMatchObject({ id: 't1' });
    expect(torchOf(s, 'keven')!.lit).toBeFalsy();
    expect(e.heroLit(s, 'keven')).toBe(false);
    expect(e.sightRange(s, 'keven')).toBe(2);
    expect(e.lights!(s).filter((L) => L.party)).toEqual([]);
  });
});

describe('V4.1 (WS2) the torch', () => {
  it('Light (an action): radius 3 for 15 rounds; Snuff (free) keeps the rounds; Relight (an action)', () => {
    let s = onL2(delve([item('t1', 'torch')], { keven: ['t1'] }));
    const o = option(s, 'keven', 'torch')!;
    expect(o.targets).toEqual([{ itemId: 't1' }]);
    s = act(s, 'keven', 'torch', { itemId: 't1' }).state;
    expect(hero(s, 'keven').acted).toBe(true);
    expect(torchOf(s, 'keven')).toMatchObject({ lit: true, rounds: TORCH_ROUNDS });
    expect(e.heroLit(s, 'keven')).toBe(true);
    expect(e.sightRange(s, 'keven')).toBe(7); // party light on Level 2
    expect(lit(s, at(2, 10, 4))).toBe(true); // 3 rows up
    expect(lit(s, at(2, 10, 3))).toBe(false); // 4 rows up: beyond radius 3
    expect(e.lights!(s)).toContainEqual({ at: at(2, 10, 7), radius: TORCH_RADIUS, party: true, kind: 'torch', holder: 'keven', rounds: 15, max: 15 });
    // Burns 1 a world phase while lit.
    s = ok(s, { type: 'endTurn' }).state;
    s = ok(s, { type: 'endTurn' }).state;
    expect(torchOf(s, 'keven')!.rounds).toBe(13);
    // Snuff: free, dark, keeps 13 and stops burning.
    s = act(s, 'keven', 'snuff', { itemId: 't1' }).state;
    expect(hero(s, 'keven').acted).toBe(false);
    expect(torchOf(s, 'keven')).toMatchObject({ lit: false, rounds: 13 });
    expect(e.heroLit(s, 'keven')).toBe(false);
    s = ok(s, { type: 'endTurn' }).state;
    expect(torchOf(s, 'keven')!.rounds).toBe(13);
    // Relight: an action, the rounds it had.
    const r = act(s, 'keven', 'torch', { itemId: 't1' });
    expect(r.events.some((x) => x.type === 'say' && /relights the torch \(13 rounds left\)/.test(x.text))).toBe(true);
    expect(hero(r.state, 'keven').acted).toBe(true);
    expect(e.heroLit(r.state, 'keven')).toBe(true);
  });

  it('burns out at 0 and is gone', () => {
    let s = onL2(delve([item('t1', 'torch', { rounds: 1 })], { keven: ['t1'] }));
    s = act(s, 'keven', 'torch', { itemId: 't1' }).state;
    const r = ok(s, { type: 'endTurn' });
    expect(torchOf(r.state, 'keven')).toBeUndefined();
    expect(r.events.some((x) => x.type === 'say' && /torch gutters out/.test(x.text))).toBe(true);
    expect(e.heroLit(r.state, 'keven')).toBe(false);
  });

  it('Drop it lit (free): it lights its hex and burns on; it can be picked up again', () => {
    let s = onL2(delve([item('t1', 'torch')], { keven: ['t1'] }));
    s = act(s, 'keven', 'torch', { itemId: 't1' }).state;
    hero(s, 'keven').acted = false;
    expect(option(s, 'keven', 'dropTorch')!.targets).toEqual([{ itemId: 't1' }]);
    s = act(s, 'keven', 'dropTorch', { itemId: 't1' }).state;
    expect(hero(s, 'keven').acted).toBe(false); // free
    expect(torchOf(s, 'keven')).toBeUndefined();
    const spot = at(2, 10, 7);
    expect(s.delve!.ground.find((g) => g.at.q === spot.q && g.at.r === spot.r && g.at.level === 2)!.items[0]).toMatchObject({ id: 't1', lit: true });
    // Keven walks off; the hex stays lit, and Keven out of its reach is dark.
    put(s, 'keven', at(2, 4, 1));
    expect(lit(s, spot)).toBe(true);
    expect(e.lights!(s).find((L) => L.kind === 'torch')).toMatchObject({ at: spot, party: true, rounds: 15 });
    expect(e.lights!(s).find((L) => L.kind === 'torch')!.holder).toBeUndefined();
    expect(e.heroLit(s, 'keven')).toBe(false);
    // It burns where it lies.
    s = ok(s, { type: 'endTurn' }).state;
    expect(e.lights!(s).find((L) => L.kind === 'torch')!.rounds).toBe(14);
    // Picked up again, it is still burning.
    put(s, 'keven', at(2, 11, 7));
    s = act(s, 'keven', 'take', { at: spot }).state;
    expect(torchOf(s, 'keven')).toMatchObject({ lit: true, rounds: 14 });
    expect(e.heroLit(s, 'keven')).toBe(true);
  });

  it('several heroes may carry lit torches; one lit torch a hero at a time', () => {
    let s = onL2(delve([item('t1', 'torch'), item('t2', 'torch'), item('t3', 'torch')], { keven: ['t1', 't3'], brann: ['t2'] }));
    s = act(s, 'keven', 'torch', { itemId: 't1' }).state;
    s = act(s, 'brann', 'torch', { itemId: 't2' }).state;
    expect(e.heroLit(s, 'keven')).toBe(true);
    expect(e.heroLit(s, 'brann')).toBe(true);
    expect(e.lights!(s).filter((L) => L.kind === 'torch').map((L) => L.holder).sort()).toEqual(['brann', 'keven']);
    hero(s, 'keven').acted = false;
    expect(option(s, 'keven', 'torch')).toBeUndefined(); // his second torch waits
  });

  it('a delve ends: a snuffed or burning torch carried out goes to the cart put out, with its rounds', () => {
    let s = delve([item('t1', 'torch')], { keven: ['t1'] }, ['keven']);
    s = act(s, 'keven', 'torch', { itemId: 't1' }).state;
    s = ok(s, { type: 'endTurn' }).state;
    put(s, 'keven', testCastle.entrances[0]!);
    s = act(s, 'keven', 'leave', { at: testCastle.entrances[0]! }).state;
    s = ok(s, { type: 'backToCamp' }).state;
    expect(s.campaign.stash.find((i) => i.id === 't1')).toMatchObject({ lit: false, rounds: 14 });
  });
});

describe('V4.1 (WS2) the lantern (Gerda)', () => {
  it('Gerda sells it once she is home: 120 gold, 1 slot', () => {
    const s = camp();
    s.campaign.gold = 500;
    expect(e.shop(s).find((o) => o.kind === 'lantern')).toMatchObject({ price: 120, needs: 'smith', vendor: 'gerda', locked: expect.any(String) });
    expect(e.apply(s, { type: 'buy', kind: 'lantern' }).error).toBeTruthy();
    s.campaign.village.smith = true;
    const t = ok(s, { type: 'buy', kind: 'lantern' }).state;
    expect(t.campaign.gold).toBe(380);
    expect(t.campaign.stash.find((i) => i.kind === 'lantern')).toMatchObject({ slots: 1 });
  });

  it('shutter is free; open it lights 4 at 7+, 3 below; burns 1 a phase only while open', () => {
    let s = onL2(delve([item('l1', 'lantern')], { keven: ['l1'] }));
    const lan = () => hero(s, 'keven').pack.find((i) => i.kind === 'lantern')!;
    expect(lan().lit).toBeFalsy(); // goes in shuttered
    expect(e.heroLit(s, 'keven')).toBe(false);
    const o = option(s, 'keven', 'shutter')!;
    expect(o.label).toBe('Open lantern');
    s = act(s, 'keven', 'shutter', { itemId: 'l1' }).state;
    expect(hero(s, 'keven').acted).toBe(false);
    expect(lan().lit).toBe(true);
    expect(lit(s, at(2, 10, 3))).toBe(true); // 4 rows up: radius 4
    s = ok(s, { type: 'endTurn' }).state;
    expect(lan().rounds).toBe(LANTERN_MAX - 1);
    lan().rounds = 6;
    expect(lit(s, at(2, 10, 3))).toBe(false); // below 7: radius 3
    expect(lit(s, at(2, 10, 4))).toBe(true);
    s = act(s, 'keven', 'shutter', { itemId: 'l1' }).state;
    expect(e.heroLit(s, 'keven')).toBe(false);
    s = ok(s, { type: 'endTurn' }).state;
    expect(lan().rounds).toBe(6);
    // Empty, it goes dark (and stays in the pack).
    s = act(s, 'keven', 'shutter', { itemId: 'l1' }).state;
    lan().rounds = 1;
    s = ok(s, { type: 'endTurn' }).state;
    expect(lan()).toMatchObject({ rounds: 0, lit: false });
    expect(option(s, 'keven', 'shutter')).toBeUndefined();
  });

  it('oil adds 10 (to 20 at most); refilled free in camp; carried out it goes back on the cart', () => {
    let s = delve([item('l1', 'lantern', { rounds: 5 }), item('o1', 'oil'), item('o2', 'oil')], { keven: ['l1', 'o1', 'o2'] }, ['keven']);
    s = act(s, 'keven', 'oil', { id: 'keven', itemId: 'o1' }).state;
    expect(hero(s, 'keven').pack.find((i) => i.kind === 'lantern')!.rounds).toBe(15);
    hero(s, 'keven').acted = false;
    s = act(s, 'keven', 'oil', { id: 'keven', itemId: 'o2' }).state;
    expect(hero(s, 'keven').pack.find((i) => i.kind === 'lantern')!.rounds).toBe(LANTERN_MAX);
    put(s, 'keven', testCastle.entrances[0]!);
    s = act(s, 'keven', 'leave', { at: testCastle.entrances[0]! }).state;
    s = ok(s, { type: 'backToCamp' }).state;
    const back = s.campaign.stash.find((i) => i.id === 'l1')!;
    expect(back.lit).toBeFalsy();
    expect(back.rounds).toBeUndefined(); // full again
  });

  it('lost with a fallen bearer: it drops with the pack and lies there as lost gear', () => {
    let s = delve([item('l1', 'lantern')], { brann: ['l1'] }, ['keven', 'brann']);
    s = act(s, 'brann', 'shutter', { itemId: 'l1' }).state;
    put(s, 'brann', at(1, 16, 7));
    killHero(ctx(s), hero(s, 'brann'));
    const pile = s.delve!.ground.find((g) => g.items.some((i) => i.id === 'l1'))!;
    expect(pile.at).toEqual(at(1, 16, 7));
    expect(lit(s, at(1, 16, 5))).toBe(true); // still burning where it fell
    put(s, 'keven', testCastle.entrances[0]!);
    s = act(s, 'keven', 'leave', { at: testCastle.entrances[0]! }).state;
    s = ok(s, { type: 'backToCamp' }).state;
    expect(s.campaign.stash.some((i) => i.id === 'l1')).toBe(false);
    expect(s.campaign.lostGear.flatMap((g) => g.items).find((i) => i.id === 'l1')).toBeTruthy();
  });
});

describe('V4.1 (WS2) Kindle', () => {
  it('lights an ally’s torch or lantern within 3, or adds 6 rounds to a burning one; not beyond 3', () => {
    let s = onL2(delve([item('t1', 'torch'), item('l1', 'lantern', { rounds: 0 })], { brann: ['t1'], keven: ['l1'] }));
    put(s, 'aldous', at(2, 10, 7));
    put(s, 'brann', at(2, 12, 7));
    put(s, 'keven', at(2, 16, 8)); // 6 away: out of reach
    const o = option(s, 'aldous', 'kindle')!;
    expect(o.targets).toEqual([{ id: 'brann', itemId: 't1' }]);
    s = act(s, 'aldous', 'kindle', { id: 'brann', itemId: 't1' }).state;
    expect(torchOf(s, 'brann')).toMatchObject({ lit: true, rounds: 15 });
    expect(hero(s, 'brann').acted).toBe(false); // Brann's action is his own
    expect(hero(s, 'aldous').mana).toBe(2);
    // +6 to a burning one, to its most.
    torchOf(s, 'brann')!.rounds = 5;
    hero(s, 'aldous').acted = false;
    s = act(s, 'aldous', 'kindle', { id: 'brann', itemId: 't1' }).state;
    expect(torchOf(s, 'brann')!.rounds).toBe(11);
    // An empty lantern within 3: lit with 6.
    put(s, 'keven', at(2, 11, 8));
    hero(s, 'aldous').acted = false;
    s = act(s, 'aldous', 'kindle', { id: 'keven', itemId: 'l1' }).state;
    expect(hero(s, 'keven').pack.find((i) => i.id === 'l1')).toMatchObject({ lit: true, rounds: 6 });
  });
});

describe('V4.1 (WS2) darkness by the hero’s own hex', () => {
  const pen = (s: GameState, id: string) => {
    const m = { id: 'mx', kind: 'rats' as const, name: 'Rats', at: { ...hero(s, id).at, q: hero(s, id).at.q + 1 }, hp: 9, maxHp: 9, awareness: 'hunting' as const, spawnedAt: hero(s, id).at };
    s.delve!.monsters = [m];
    const pv = e.preview(s, id, 'attack', { id: 'mx' });
    s.delve!.monsters = [];
    return pv.chance - s.campaign.roster.find((h) => h.id === id)!.stats.might;
  };
  it('party light or daylight: no penalty, sight 8/7/6; a castle light only: −10, sight 4/3/2; unlit: −20, sight 4/2/1', () => {
    const s = delve([item('t1', 'torch', { lit: true, rounds: 10 })], {}, ['keven', 'brann']);
    hero(s, 'keven').pack.push(item('t9', 'torch', { lit: true, rounds: 10, slots: 0 }));
    put(s, 'brann', at(1, 16, 1));
    // Daylight (L1 2,8).
    put(s, 'keven', at(1, 3, 8));
    noKevenTorch(s);
    expect(pen(s, 'keven')).toBe(0);
    expect(e.sightRange(s, 'keven')).toBe(8);
    // The sconce only (L1 4,6 lights radius 2).
    put(s, 'keven', at(1, 5, 6));
    expect(pen(s, 'keven')).toBe(-10);
    expect(e.sightRange(s, 'keven')).toBe(4);
    // The forge only (L2): 3 on Level 2. The fungus only (L3): 2.
    put(s, 'keven', at(2, 16, 2));
    expect(e.sightRange(s, 'keven')).toBe(3);
    put(s, 'keven', at(3, 3, 3));
    expect(e.sightRange(s, 'keven')).toBe(2);
    expect(pen(s, 'keven')).toBe(-10);
    // Unlit: 4/2/1 and −20.
    put(s, 'keven', at(1, 16, 7));
    expect(e.sightRange(s, 'keven')).toBe(4);
    expect(pen(s, 'keven')).toBe(-20);
    put(s, 'keven', at(2, 10, 7));
    expect(e.sightRange(s, 'keven')).toBe(2);
    put(s, 'keven', at(3, 6, 4));
    expect(e.sightRange(s, 'keven')).toBe(1);
    // Party light (a torch) on the fungus hex: no penalty, 6 in the Hollow.
    put(s, 'keven', at(3, 3, 3));
    hero(s, 'keven').pack.push(item('t8', 'torch', { lit: true, rounds: 10, slots: 0 }));
    expect(pen(s, 'keven')).toBe(0);
    expect(e.sightRange(s, 'keven')).toBe(6);
  });

  function noKevenTorch(s: GameState): void {
    hero(s, 'keven').pack = hero(s, 'keven').pack.filter((i) => i.kind !== 'torch');
  }

  it('monsters notice by it: a hero in a friend’s torchlight is lit (walking 8), unlit 5', () => {
    const s = onL2(delve());
    put(s, 'keven', at(2, 10, 8));
    put(s, 'brann', at(2, 11, 8));
    const lt = litSet(w, s.delve as DelveX);
    expect(lt.has(posKey(at(2, 10, 8)))).toBe(false);
    hero(s, 'brann').pack.push(item('t9', 'torch', { lit: true, rounds: 10, slots: 0 }));
    expect(litSet(w, s.delve as DelveX).has(posKey(at(2, 10, 8)))).toBe(true);
  });
});

describe('V4.1 (WS2) the Gloam: Level 3, unlit heroes only', () => {
  it('rises for an unlit hero on Level 3; never on Levels 1 or 2, lantern or no lantern', () => {
    let s = onL2(delve());
    s = ok(s, { type: 'endTurn' }).state;
    expect(s.delve!.monsters.some((m) => m.kind === 'gloam')).toBe(false);
    put(s, 'keven', at(3, 6, 4));
    const r = ok(s, { type: 'endTurn' });
    expect(r.state.delve!.monsters.some((m) => m.kind === 'gloam')).toBe(true);
    expect(r.events.some((x) => x.type === 'say' && x.text === 'The dark here is awake.')).toBe(true);
  });

  it('a lit hero (a torch) on Level 3 calls nothing; a hero standing in a crew member’s light is lit too', () => {
    let s = onL2(delve());
    put(s, 'keven', at(3, 6, 4));
    hero(s, 'keven').pack.push(item('t9', 'torch', { lit: true, rounds: 10, slots: 0 }));
    s = ok(s, { type: 'endTurn' }).state;
    expect(s.delve!.monsters.some((m) => m.kind === 'gloam')).toBe(false);
    // No torch, but a crew member stands beside Keven: their light covers him.
    let t = onL2(delve());
    put(t, 'keven', at(3, 6, 4));
    t.delve!.rivals = buildCrew(t as GameStateX, 'the-wake', [at(3, 7, 4), at(3, 8, 6), at(3, 4, 7), at(3, 5, 2)]);
    expect(e.heroLit(t, 'keven')).toBe(true);
    t = ok(t, { type: 'endTurn' }).state;
    expect(t.delve!.monsters.some((m) => m.kind === 'gloam')).toBe(false);
  });
});

describe('V4.1 (WS2) crews carry light', () => {
  it('every crew member lights radius 2 round itself, for everyone; the party sees it from afar as a light', () => {
    const s = onL2(delve());
    const cr = buildCrew(s as GameStateX, 'ferrymen', [at(2, 16, 2), at(2, 16, 1), at(2, 17, 1)]);
    s.delve!.rivals = cr;
    const L = litSet(w, s.delve as DelveX);
    expect(L.has(posKey(at(2, 14, 2)))).toBe(true); // 2 from the first member
    expect(e.lights!(s).filter((x) => x.kind === 'crew')).toHaveLength(3);
    expect(e.lights!(s).find((x) => x.kind === 'crew')).toMatchObject({ radius: 2, party: false });
  });

  it('a hostile crew goes for the hero carrying the most light (was the lantern bearer)', () => {
    const s = onL2(delve());
    put(s, 'keven', at(2, 15, 7));
    put(s, 'brann', at(2, 16, 7));
    hero(s, 'brann').pack.push(item('l9', 'lantern', { lit: true, rounds: 20, slots: 0 }));
    hero(s, 'keven').pack.push(item('t9', 'torch', { lit: true, rounds: 10, slots: 0 }));
    const cr = buildCrew(s as GameStateX, 'ferrymen', [at(2, 16, 8), at(2, 17, 8), at(2, 18, 8)]);
    cr.stance = 'hostile';
    s.delve!.rivals = cr;
    expect(crewTarget(ctx(s) as never)?.id).toBe('brann');
  });
});

describe('V4.1 (WS2) the Lantern Sisters leave at round 18', () => {
  it('a neutral crew with loot still to take heads out once the round reaches SISTERS_LEAVE_ROUND', () => {
    let s = onL2(delve());
    const cr = buildCrew(s as GameStateX, 'lantern-sisters', [at(1, 16, 1), at(1, 17, 1), at(1, 18, 1)]);
    s.delve!.rivals = cr;
    s.delve!.round = SISTERS_LEAVE_ROUND - 2;
    s = ok(s, { type: 'endTurn' }).state;
    expect(s.delve!.rivals!.goal).toBe('loot');
    s.delve!.round = SISTERS_LEAVE_ROUND;
    s = ok(s, { type: 'endTurn' }).state;
    expect(s.delve!.rivals!.goal).toBe('leave');
  });
});

describe('V4.1 (WS2) the board’s Unlit chip', () => {
  it('a site in castle memory with no fixed light reaching it; unknown or lit sites are not marked', () => {
    const s = camp();
    expect(e.siteUnlit!(s, 'res2')).toBe(false); // the east hall, not explored yet
    s.campaign.explored = { 1: ['16,8', '3,8'].map((k) => { const p = at(1, Number(k.split(',')[0]), Number(k.split(',')[1])); return `${p.q},${p.r}`; }) };
    expect(e.siteUnlit!(s, 'res2')).toBe(true);
    // The pantry site (1, 5, 3) remembered, near no light: unlit; one beside the daylight would not be.
    const p = at(1, 5, 3);
    s.campaign.explored[1]!.push(`${p.q},${p.r}`);
    expect(e.siteUnlit!(s, 'rec1')).toBe(true);
    expect(e.siteUnlit!(s, 'nope')).toBe(false);
  });
});

describe('V4.1 (WS2) old saves', () => {
  it('a delve saved with the free lantern loads with it as a loaner Lantern in the bearer’s pack; a lit torch as a torch item', () => {
    const s = delve([], {}, ['keven', 'brann']);
    const d = s.delve as DelveX;
    d.light = 9;
    d.lanternBearer = 'brann';
    d.lanternOpen = true;
    hero(s, 'keven').torch = 4;
    const back = e.deserialize(e.serialize(s))!;
    const bd = back.delve as DelveX;
    expect(bd.light).toBeUndefined();
    expect(bd.lanternBearer).toBeUndefined();
    expect(hero(back, 'brann').pack.find((i) => i.kind === 'lantern')).toMatchObject({ rounds: 9, lit: true, loaner: true, slots: 0 });
    expect(hero(back, 'keven').pack.find((i) => i.kind === 'torch')).toMatchObject({ rounds: 4, lit: true });
    expect(hero(back, 'keven').torch).toBe(0);
    expect(e.heroLit(back, 'brann')).toBe(true);
    // The loaner never reaches the cart.
    let t = back;
    put(t, 'brann', testCastle.entrances[0]!);
    t = act(t, 'brann', 'leave', { at: testCastle.entrances[0]! }).state;
    t = ok(t, { type: 'abandon' }).state;
    t = ok(t, { type: 'backToCamp' }).state;
    expect(t.campaign.stash.some((i) => i.kind === 'lantern')).toBe(false);
  });
});
