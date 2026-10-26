// V4.0: Keven's cart sells valuables one at a time ('sell'), beside 'sellAll'.

import { describe, it, expect } from 'vitest';
import { createEngine } from './engine';
import { castle } from '../data/castle';
import type { GameState, Item } from './types';

const e = createEngine(castle);

function withCart(): GameState {
  const s = e.newGame(3);
  const mk = (id: string, kind: Item['kind'], name: string, amount: number, slots = 1): Item => ({ id, kind, name, amount, slots });
  s.campaign.stash.push(mk('t1', 'torch', 'Torch', 1), mk('g1', 'gem', 'Garnet', 55), mk('j1', 'jewelry', 'Silver torc', 110), mk('h1', 'heirloom', 'Hobart signet', 60, 2));
  return s;
}

describe('selling one valuable', () => {
  it('sells exactly that item for its value and keeps the rest', () => {
    const s = withCart();
    const gold = s.campaign.gold;
    const r = e.apply(s, { type: 'sell', itemId: 'j1' });
    expect(r.error).toBeUndefined();
    const c = r.state.campaign;
    expect(c.gold).toBe(gold + 110);
    expect(c.stash.map((i) => i.id).sort()).toEqual(['g1', 'h1', 't1']);
  });

  it('refuses gear, story items and unknown ids', () => {
    const s = withCart();
    expect(e.apply(s, { type: 'sell', itemId: 't1' }).error).toBeTruthy();
    expect(e.apply(s, { type: 'sell', itemId: 'nope' }).error).toBeTruthy();
    s.campaign.stash.push({ id: 's1', kind: 'heirloom', name: "Wim's cask book", amount: 0, slots: 1, story: 'caskbook' });
    expect(e.apply(s, { type: 'sell', itemId: 's1' }).error).toBeTruthy();
  });

  it('sellAll still sells every valuable and leaves gear', () => {
    const r = e.apply(withCart(), { type: 'sellAll' });
    expect(r.error).toBeUndefined();
    expect(r.state.campaign.stash.map((i) => i.id)).toEqual(['t1']);
  });
});
