// V5.0 (P, spec 32.1): item use in odd states. The play-test bug that started it: a hero who jumped into the Hollow
// couldn't light their torch (the jump took the whole turn, so the action was gone until the next round, and the
// Gloam was already awake). A jump is now the hero's move (no dash after it), and the action stays. The rest is an
// audit: what a hero can do with their items after a fall, while carrying, on a raised floor, in the dark, with a
// full pack, and the turn after a reaction, so a change to any of these shows up here.

import { describe, expect, it } from 'vitest';
import { createEngine } from './engine';
import { at, testCastle } from './test/testCastle';
import { posKey, posNeighbors, type Pos } from './hex';
import type { ActionKind, ActionTarget, Command, GameState, HeroClass, Item, Monster, MonsterKind } from './types';
import { makeHero } from './camp';
import { MONSTERS, PACK_SLOTS } from './data';
import { World } from './world';
import { fall } from './falls';
import type { Ctx, DelveX, GameStateX, MonsterX } from './state';

const e = createEngine(testCastle);
const w = new World(testCastle);

function ok(s: GameState, cmd: Command) {
  const r = e.apply(s, cmd);
  expect(r.error).toBeUndefined();
  return r;
}
const act = (s: GameState, heroId: string, action: ActionKind, target: ActionTarget) => ok(s, { type: 'act', heroId, action, target, focus: 0 });
const hero = (s: GameState, id: string) => s.delve!.heroes.find((h) => h.heroId === id)!;
const actionsOf = (s: GameState, id: string) => e.actions(s, id).filter((o) => !o.blocked).map((o) => o.action);
const item = (id: string, kind: Item['kind'], slots = 1): Item => ({ id, kind, name: kind, amount: 1, slots });
const ctx = (s: GameState): Ctx => ({ w, s: s as GameStateX, d: s.delve as DelveX, ev: [] });

/** Brann the Sellsword and Keven in the test keep, nothing else about; Brann carries a torch, a potion and an antipoison. */
function delve(extra: [string, string, HeroClass][] = []): GameState {
  const s = e.newGame(1);
  s.campaign.roster.push(makeHero('brann', 'Brann', 'sellsword'));
  for (const [id, name, cls] of extra) s.campaign.roster.push(makeHero(id, name, cls));
  s.campaign.stash.push(item('t1', 'torch'), item('p1', 'potion'), item('a1', 'antidote'));
  const k = s.campaign.board[0]!;
  const t = ok(s, { type: 'startDelve', contractId: k.id, heroIds: ['keven', 'brann', ...extra.map((x) => x[0])], entrance: 0, packs: { brann: ['t1', 'p1', 'a1'] } }).state;
  t.delve!.monsters = [];
  t.delve!.rivals = null;
  t.delve!.traps = {};
  t.delve!.prisoner = null;
  (t.delve as DelveX).fuses = [{ at: at(3, 5, 5), rounds: 99, by: 'x' }]; // never calm
  hero(t, 'keven').at = at(1, 2, 2);
  hero(t, 'brann').at = at(1, 11, 3); // beside the pit mouth
  hero(t, 'brann').hp = 10; // a Sellsword's most: a two-level fall (7) leaves him up
  return t;
}

function monster(s: GameState, kind: MonsterKind, p: Pos, awareness: Monster['awareness'] = 'hunting'): MonsterX {
  const def = MONSTERS[kind];
  const m: MonsterX = { id: `m${s.delve!.monsters.length + 1}`, kind, name: def.name, at: { ...p }, hp: 99, maxHp: 99, awareness, spawnedAt: { ...p } };
  if (awareness === 'hunting') m.noticedIds = s.delve!.heroes.map((h) => h.heroId);
  s.delve!.monsters.push(m);
  return m;
}

describe('V5.0 (spec 32.1): the torch after a jump', () => {
  it('a hero who jumps two levels into the Hollow with an unlit torch can light it where they land', () => {
    let s = delve();
    const r = act(s, 'brann', 'jump', { at: at(1, 11, 4) });
    s = r.state;
    const b = hero(s, 'brann');
    expect(b.at.level).toBe(3);
    expect(b.status).toBe('active');
    expect(e.heroLit(s, 'brann')).toBe(false);
    // The bug: Light was not offered (the jump had spent the action). Now it is.
    expect(actionsOf(s, 'brann')).toContain('torch');
    s = act(s, 'brann', 'torch', { itemId: 't1' }).state;
    expect(hero(s, 'brann').pack.find((i) => i.id === 't1')).toMatchObject({ lit: true, rounds: 15 });
    expect(e.heroLit(s, 'brann')).toBe(true);
  });

  it('a jump is the move, not the action: no dash after it; attacking, drinking and giving still work', () => {
    let s = delve();
    s = act(s, 'brann', 'jump', { at: at(1, 10, 3) }).state; // one level, onto the L2 bridge row
    const b = hero(s, 'brann');
    expect([b.moved, b.acted, b.dashed]).toEqual([true, false, true]);
    expect(e.reachable(s, 'brann', false)).toEqual([]); // no second move
    const a = actionsOf(s, 'brann');
    expect(a).toContain('torch');
    expect(a).toContain('potion'); // hurt by the fall
    expect(a).not.toContain('jump');
    expect(e.preview(s, 'brann', 'jump', { at: at(2, 10, 4) }).reason).toMatch(/already moved/);
  });

  it('a hero who has moved cannot jump; one who has acted still can; climb and grapple still take the whole turn', () => {
    let s = delve();
    hero(s, 'brann').moved = true;
    expect(actionsOf(s, 'brann')).not.toContain('jump');
    s = delve();
    hero(s, 'brann').acted = true;
    expect(actionsOf(s, 'brann')).toContain('jump');
    // A rope at the edge: climb needs both.
    hero(s, 'brann').pack.push(item('rp', 'rope'));
    s.delve!.ropes.push(posKey(at(1, 11, 3)));
    expect(actionsOf(s, 'brann')).not.toContain('climb');
    hero(s, 'brann').acted = false;
    expect(e.actions(s, 'brann').some((o) => o.action === 'climb')).toBe(true);
  });
});

describe('V5.0 (spec 32.1): item use in odd states (audit)', () => {
  /** Each row: a state, and whether Brann can Light his torch, use his potion (on himself when hurt, or a friend beside him) and Give. */
  type Row = { name: string; make: () => GameState; light: boolean; potion: boolean; give: boolean; note?: string };
  const rows: Row[] = [
    {
      name: 'fresh, lit room, full health',
      make: () => delve(),
      light: true, potion: false, give: false, note: 'no one next to him; the potion has nobody to heal',
    },
    {
      name: 'after a fall caused by a shove (not a jump)',
      make: () => {
        const s = delve();
        const c = ctx(s);
        fall(c, 'brann', at(1, 10, 3), null);
        return s;
      },
      light: true, potion: true, give: false, note: 'a fall spends nothing',
    },
    {
      name: 'after jumping into the dark',
      make: () => act(delve(), 'brann', 'jump', { at: at(1, 11, 4) }).state,
      light: true, potion: true, give: false,
    },
    {
      name: 'carrying a downed friend',
      make: () => {
        let s = delve();
        const k = hero(s, 'keven');
        k.at = posNeighbors(at(1, 11, 3)).find((p) => w.tile(p)?.kind === 'floor')!;
        k.status = 'downed';
        k.hp = 0;
        k.bleed = 3;
        s = act(s, 'brann', 'carry', { id: 'keven' }).state;
        expect(hero(s, 'brann').carrying).toBe('keven');
        return s;
      },
      light: false, potion: false, give: false, note: 'spec 31.4: a carrier takes free actions only (Set down first); the body is downed, so Give has no taker',
    },
    {
      name: 'on a raised floor',
      make: () => { const s = delve(); hero(s, 'brann').at = at(1, 10, 6); expect(w.tile(at(1, 10, 6))?.raised).toBe(true); return s; },
      light: true, potion: false, give: false,
    },
    {
      name: 'in the dark on Level 2',
      make: () => { const s = delve(); hero(s, 'brann').at = at(2, 10, 7); hero(s, 'brann').hp = 5; expect(e.heroLit(s, 'brann')).toBe(false); return s; },
      light: true, potion: true, give: false,
    },
    {
      name: 'with a full pack, a friend beside him',
      make: () => {
        const s = delve();
        const b = hero(s, 'brann');
        b.hp = 5;
        while (b.pack.reduce((n, i) => n + i.slots, 0) < PACK_SLOTS) b.pack.push(item(`x${b.pack.length}`, 'rope'));
        hero(s, 'keven').at = posNeighbors(b.at).find((p) => w.tile(p)?.kind === 'floor')!;
        return s;
      },
      light: true, potion: true, give: true, note: 'lighting needs no slot; Give offers Keven, who has room',
    },
    {
      name: 'the turn after answering a reaction (the hidden swing)',
      make: () => {
        let s = delve();
        const b = hero(s, 'brann');
        b.at = at(1, 4, 6);
        b.veil = 3;
        const a = posNeighbors(b.at).filter((p) => w.tile(p)?.kind === 'floor').sort((x, y) => y.q - x.q)[0]!;
        const m = monster(s, 'orc', a, 'alert');
        m.focusAt = at(1, 9, 6);
        const r = ok(s, { type: 'endTurn' });
        expect(r.state.delve!.pending?.question.kind).toBe('hiddenSwing');
        s = ok(r.state, { type: 'react', choice: 'yes' }).state;
        expect(s.delve!.pending).toBeUndefined();
        expect(s.delve!.phase).toBe('player');
        return s;
      },
      light: true, potion: false, give: false, note: 'the answer is spent with the castle\'s turn; the new round starts clean',
    },
  ];
  for (const row of rows) {
    it(row.name, () => {
      const s = row.make();
      expect(hero(s, 'brann').status).toBe('active');
      const a = actionsOf(s, 'brann');
      expect(a.includes('torch'), `Light: ${row.note ?? ''}`).toBe(row.light);
      expect(a.includes('potion'), `Potion: ${row.note ?? ''}`).toBe(row.potion);
      expect(a.includes('give'), `Give: ${row.note ?? ''}`).toBe(row.give);
    });
  }

  it('items on friends next to you: a potion or antipoison on a hurt, poisoned or downed neighbour, and Give hands anything over', () => {
    let s = delve();
    const b = hero(s, 'brann');
    const k = hero(s, 'keven');
    k.at = posNeighbors(b.at).find((p) => w.tile(p)?.kind === 'floor')!;
    k.hp = 1;
    k.poisoned = true;
    const pot = e.actions(s, 'brann').find((o) => o.action === 'potion')!;
    expect(pot.targets).toEqual([{ id: 'keven', itemId: 'p1' }]);
    const anti = e.actions(s, 'brann').find((o) => o.action === 'antidote')!;
    expect(anti.targets).toEqual([{ id: 'keven', itemId: 'a1' }]);
    const give = e.actions(s, 'brann').find((o) => o.action === 'give')!;
    expect(give.targets.map((t) => t.itemId).sort()).toEqual(['a1', 'p1', 't1']);
    s = act(s, 'brann', 'potion', { id: 'keven', itemId: 'p1' }).state;
    expect(hero(s, 'keven').hp).toBe(6);
    // A downed friend: the potion gets them up.
    hero(s, 'keven').status = 'downed';
    hero(s, 'keven').hp = 0;
    hero(s, 'brann').acted = false;
    hero(s, 'brann').pack.push(item('p2', 'potion'));
    s = act(s, 'brann', 'potion', { id: 'keven', itemId: 'p2' }).state;
    expect(hero(s, 'keven').status).toBe('active');
  });
});

describe('V5.0 (spec 32.7, owner): items between people', () => {
  it('Take from a downed friend\'s pack next to you (never their kit), and from a downed crew member\'s', () => {
    let s = delve();
    const b = hero(s, 'brann');
    const k = hero(s, 'keven');
    k.at = posNeighbors(b.at).find((p) => w.tile(p)?.kind === 'floor')!;
    k.status = 'downed';
    k.hp = 0;
    k.pack.push(item('kp', 'potion'), { ...item('kq', 'quiver'), kit: true } as Item);
    const take = e.actions(s, 'brann').find((o) => o.action === 'take')!;
    expect(take.targets.some((t) => t.id === 'keven')).toBe(true);
    expect(e.preview(s, 'brann', 'take', { id: 'keven', at: k.at }).outcomes.join()).toMatch(/from Keven's pack/);
    s = act(s, 'brann', 'take', { id: 'keven', at: k.at }).state;
    expect(hero(s, 'brann').pack.some((i) => i.id === 'kp')).toBe(true);
    expect(hero(s, 'keven').pack.map((i) => i.id)).toEqual(['kq']);
    expect(e.actions(s, 'brann').find((o) => o.action === 'take')?.targets.some((t) => t.id === 'keven') ?? false).toBe(false);
  });

  it('a potion on the captive you are rescuing, hurt and next to you', () => {
    let s = delve();
    const b = hero(s, 'brann');
    const at = posNeighbors(b.at).find((p) => w.tile(p)?.kind === 'floor')!;
    s.delve!.prisoner = { id: 'cap', name: 'Wim', at: { ...at }, hp: 1, freed: false, out: false, dead: false };
    const pot = e.actions(s, 'brann').find((o) => o.action === 'potion')!;
    expect(pot.targets.some((t) => t.id === 'cap')).toBe(true);
    s = act(s, 'brann', 'potion', { id: 'cap', itemId: 'p1' }).state;
    expect(s.delve!.prisoner!.hp).toBe(5);
    expect(e.actions(s, 'brann').find((o) => o.action === 'potion')?.targets.some((t) => t.id === 'cap') ?? false).toBe(false);
  });
});
