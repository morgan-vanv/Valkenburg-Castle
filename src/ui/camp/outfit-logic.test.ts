import { describe, expect, it } from 'vitest';
import type { Item } from '../../game/types';
import { ICONS } from './icons';
import { fitsPack, itemIcon, newItemIds, packAfterBuy, packInto, pages, unpack, wagonOf } from './outfit-logic';

const it1 = (id: string, kind: string, slots = 1): Item => ({ id, kind, name: kind, amount: 1, slots }) as Item;

describe('outfit logic (V5.1 W3)', () => {
  it('maps every item kind to a kit icon, unknown to the sack', () => {
    for (const k of ['torch', 'potion', 'antidote', 'rope', 'charge', 'firecracker', 'arrows', 'lantern', 'hook', 'key', 'lockpicks', 'gem', 'jewelry', 'heirloom', 'weapon', 'armor', 'shield']) {
      expect(ICONS).toContain(itemIcon(k));
      expect(itemIcon(k)).not.toBe('sack');
    }
    expect(itemIcon('mystery')).toBe('sack');
  });

  it('finds the id a purchase added to the stash', () => {
    const before = ['a', 'b'];
    expect(newItemIds(before, [it1('a', 'torch'), it1('b', 'rope'), it1('c', 'torch')])).toEqual(['c']);
    expect(newItemIds(before, [it1('a', 'torch'), it1('b', 'rope')])).toEqual([]);
  });

  it('buy then pack: into the hero when it fits, else it stays on the wagon', () => {
    const l = { heroIds: ['k', 'p'], packs: { k: ['a', 'b', 'c'], p: [] as string[] } };
    const stash = [it1('a', 'rope'), it1('b', 'rope'), it1('c', 'rope'), it1('n', 'torch')];
    const ok = packAfterBuy(l, 'p', ['a', 'b', 'c'], stash, 4);
    expect(ok.packed).toBe(true);
    expect(ok.itemId).toBe('n');
    expect(ok.loadout.packs.p).toEqual(['n']);
    expect(l.packs.p).toEqual([]); // pure
    const k = packAfterBuy(l, 'k', ['a', 'b', 'c'], stash, 4);
    expect(k.packed).toBe(true);
    const full = { heroIds: ['k'], packs: { k: ['a', 'b', 'c', 'd'] } };
    const s2 = [...stash, it1('d', 'rope')];
    const no = packAfterBuy(full, 'k', ['a', 'b', 'c', 'd'], s2, 4);
    expect(no.packed).toBe(false);
    expect(no.itemId).toBe('n');
    expect(no.loadout).toBe(full);
    expect(packAfterBuy(l, null, ['a', 'b', 'c'], stash, 4).packed).toBe(false);
    expect(packAfterBuy(l, 'p', ['a', 'b', 'c', 'n'], stash, 4)).toEqual({ loadout: l, packed: false });
  });

  it('moves between packs and back to the wagon, minding two-slot things', () => {
    const stash = [it1('h', 'heirloom', 2), it1('a', 'rope'), it1('b', 'rope'), it1('c', 'rope')];
    const l = { heroIds: ['k', 'p'], packs: { k: ['h'], p: ['a', 'b', 'c'] } };
    expect(fitsPack(l, 'p', stash, 2, 4)).toBe(false);
    expect(packInto(l, 'p', 'h', stash, 4)).toBeNull();
    const moved = packInto(l, 'k', 'a', stash, 4)!;
    expect(moved.packs).toEqual({ k: ['h', 'a'], p: ['b', 'c'] });
    expect(unpack(moved, 'a').packs).toEqual({ k: ['h'], p: ['b', 'c'] });
  });

  it('the wagon: spares grouped by kind, loot one by one, packed and story things left out', () => {
    const stash = [it1('t1', 'torch'), it1('g', 'gem'), it1('t2', 'torch'), it1('r', 'rope'), { ...it1('s', 'heirloom', 2), story: 'smith' } as Item, it1('j', 'jewelry')];
    const w = wagonOf(stash, { heroIds: ['k'], packs: { k: ['r'] } });
    expect(w.spares.map((x) => `${x.kind}:${x.items.length}`)).toEqual(['torch:2']);
    expect(w.loot.map((x) => x.id)).toEqual(['g', 'j']);
  });

  it('pages', () => {
    expect(pages([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
    expect(pages([], 8)).toEqual([[]]);
  });
});
