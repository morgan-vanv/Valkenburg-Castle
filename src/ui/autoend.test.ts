// V5.0 (P, B5, spec 32.5): auto end turn: the party is "done" only when nobody can move, act or use anything but
// housekeeping (drop, give, snuff, shutter, set down).

import { describe, expect, it } from 'vitest';
import { createEngine } from '../game/engine';
import { at, testCastle } from '../game/test/testCastle';
import { posNeighbors } from '../game/hex';
import type { GameState, Item } from '../game/types';
import { makeHero } from '../game/camp';
import type { DelveX } from '../game/state';
import { World } from '../game/world';
import { heroDone, partyDone } from './autoend';

const e = createEngine(testCastle);
const w = new World(testCastle);
const hero = (s: GameState, id: string) => s.delve!.heroes.find((h) => h.heroId === id)!;
const item = (id: string, kind: Item['kind']): Item => ({ id, kind, name: kind, amount: 1, slots: 1 });

function delve(): GameState {
  const s = e.newGame(1);
  s.campaign.roster.push(makeHero('brann', 'Brann', 'sellsword'));
  s.campaign.stash.push(item('t1', 'torch'));
  const k = s.campaign.board[0]!;
  const r = e.apply(s, { type: 'startDelve', contractId: k.id, heroIds: ['keven', 'brann'], entrance: 0, packs: { brann: ['t1'] } });
  expect(r.error).toBeUndefined();
  const t = r.state;
  t.delve!.monsters = [];
  t.delve!.rivals = null;
  t.delve!.traps = {};
  t.delve!.prisoner = null;
  t.delve!.ground = []; // nothing to Take until a test puts it there
  (t.delve as DelveX).fuses = [{ at: at(3, 5, 5), rounds: 99, by: 'x' }];
  hero(t, 'keven').at = at(1, 2, 2);
  hero(t, 'brann').at = at(1, 5, 7); // no door in reach (Open is free and keeps the turn open)
  return t;
}
const spend = (s: GameState, id: string) => {
  const h = hero(s, id);
  h.moved = true;
  h.acted = true;
  h.dashed = true;
};

describe('V5.0 (spec 32.5): when the party is done', () => {
  it('a fresh turn is not done; a hero who has moved and acted with only a torch to light or drop is', () => {
    const s = delve();
    expect(partyDone(e, s)).toBe(false);
    spend(s, 'keven');
    spend(s, 'brann');
    expect(heroDone(e, s, 'keven')).toBe(true);
    expect(heroDone(e, s, 'brann')).toBe(true); // Light needs the action; Drop is housekeeping
    expect(partyDone(e, s)).toBe(true);
  });

  it('a hero who acted but can still move, or moved but can still act, keeps the turn open', () => {
    const s = delve();
    spend(s, 'brann');
    const k = hero(s, 'keven');
    k.acted = true;
    expect(heroDone(e, s, 'keven')).toBe(false);
    k.acted = false;
    k.moved = true;
    k.dashed = true;
    expect(heroDone(e, s, 'keven')).toBe(false); // Brace is still there
    expect(partyDone(e, s)).toBe(false);
  });

  it('loot in reach (Take, free) keeps the turn open; Drop alone does not', () => {
    const s = delve();
    spend(s, 'keven');
    spend(s, 'brann');
    expect(partyDone(e, s)).toBe(true);
    const beside = posNeighbors(hero(s, 'brann').at).find((p) => w.tile(p)?.kind === 'floor')!;
    s.delve!.ground.push({ at: beside, items: [item('g1', 'potion')] });
    expect(heroDone(e, s, 'brann')).toBe(false);
    expect(partyDone(e, s)).toBe(false);
  });

  it('never in the castle\'s turn, with a reaction waiting, or with nobody up', () => {
    const s = delve();
    spend(s, 'keven');
    spend(s, 'brann');
    const d = s.delve!;
    d.phase = 'world';
    expect(partyDone(e, s)).toBe(false);
    d.phase = 'player';
    d.pending = { command: { type: 'endTurn' }, question: { kind: 'overwatch', heroId: 'keven', enemyId: 'x', at: at(1, 2, 2), text: '', yes: { label: '', line: '' }, no: { label: '', line: '' } }, answers: [], played: 0 };
    expect(partyDone(e, s)).toBe(false);
    d.pending = undefined;
    for (const h of d.heroes) h.status = 'downed';
    expect(partyDone(e, s)).toBe(false);
  });
});
