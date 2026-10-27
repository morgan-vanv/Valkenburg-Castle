// V4.1 WS4 (spec 31.6): the vendor catalog merged with the engine's lists. Every ware and ale the engine sells has a
// catalog row (so nothing goes missing from the Vendors side), rows open with their gates, items the engine doesn't
// list yet show locked with their in-voice hint, and a pair's cheaper ware points from the old seller to the new one.

import { describe, expect, it } from 'vitest';
import { aleOffers, shopOffers } from '../game/camp';
import { createEngine } from '../game/engine';
import { testCastle } from '../game/test/testCastle';
import type { GameState, Village } from '../game/types';
import { CATALOG, PERKS, VENDOR_IDS, gateMet, perkStatus, rowStatus, tabOf, vendorGroups, vendorHome } from './vendors';

const engine = createEngine(testCastle);
const fresh = (): GameState => engine.apply(engine.newGame(1), { type: 'newCampaign', seed: 1 }).state;
const withVillage = (v: Partial<Village>): GameState => {
  const s = structuredClone(fresh());
  Object.assign(s.campaign.village, v);
  return s;
};
const ALL: Village = { surgeon: true, innkeeper: true, smith: true, copper: true, caskbook: true, alchemist: true };
const row = (id: string) => CATALOG.find((r) => r.id === id)!;
const status = (id: string, s: GameState) => rowStatus(row(id), s.campaign.village, shopOffers(s), aleOffers(s));

describe('V4.1 WS4: the vendor catalog', () => {
  it('has every ware and ale the engine sells, and unique row ids', () => {
    const keys = new Set(CATALOG.flatMap((r) => r.keys));
    for (const o of shopOffers()) expect(keys.has(o.kind), o.kind).toBe(true);
    for (const o of aleOffers(fresh())) expect(keys.has(o.kind), o.kind).toBe(true);
    expect(new Set(CATALOG.map((r) => r.id)).size).toBe(CATALOG.length);
  });

  it('every gated row and perk has an in-voice hint; every vendor has rows', () => {
    for (const r of CATALOG) if (r.gate.length) expect(r.hint.length, r.id).toBeGreaterThan(10);
    for (const p of PERKS) expect(p.hint.length).toBeGreaterThan(10);
    for (const id of VENDOR_IDS) expect(vendorGroups(id).length, id).toBeGreaterThan(0);
  });

  it('a new campaign: Mott is open, the rest locked with hints', () => {
    const s = fresh();
    const v = s.campaign.village;
    expect(vendorHome(v, 'mott')).toBe(true);
    for (const id of ['gerda', 'ilse', 'flagon'] as const) expect(vendorHome(v, id)).toBe(false);
    expect(status('torch', s).state).toBe('live');
    expect(status('charge', s)).toMatchObject({ state: 'live', price: 45 });
    const hook = status('hook', s);
    expect(hook.state).toBe('locked');
    expect(hook.hint).toMatch(/Mott hasn't seen one/);
    expect(status('blade', s).state).toBe('locked');
    expect(status('ale-glowworm', s).state).toBe('locked');
    expect(status('ale-nighteye', s).hint).toMatch(/Wim and an alchemist/);
  });

  it('rows open with their villagers; pairs need both', () => {
    const g = withVillage({ smith: true });
    expect(status('hook', g).state).toBe('live');
    expect(status('blade', g).state).toBe('live');
    expect(status('shield', g).state).toBe('live');
    expect(status('gerda-charge', g).state).toBe('locked');
    expect(status('gerda-charge', g).hint).toMatch(/both here/);
    expect(status('dart', g).state).toBe('locked');
    const gi = withVillage({ smith: true, alchemist: true });
    expect(status('dart', gi).state).toBe('live');
    expect(status('gerda-charge', gi)).toMatchObject({ state: 'live', price: 30 });
    // Mott's charge now points at the forge (the pair sells it cheaper there).
    expect(status('charge', gi)).toMatchObject({ state: 'moved', movedTo: 'gerda' });
  });

  it('the cheap antipoison sits at Ilse\'s bench once Aldric and Ilse are home', () => {
    const s = withVillage({ surgeon: true, alchemist: true });
    expect(tabOf(shopOffers(s).find((o) => o.kind === 'antidote')?.vendor)).toBe('ilse');
    expect(status('ilse-antidote', s)).toMatchObject({ state: 'live', price: 12 });
    expect(status('antidote', s)).toMatchObject({ state: 'moved', movedTo: 'ilse' });
  });

  it('the Flagon: copper ales need the copper, cask ales the book, the stouts Wim and Ilse', () => {
    expect(status('ale-glowworm', withVillage({ innkeeper: true })).state).toBe('locked');
    expect(status('ale-glowworm', withVillage({ innkeeper: true, copper: true })).state).toBe('live');
    expect(status('ale-smuggler', withVillage({ innkeeper: true, copper: true })).state).toBe('locked');
    expect(status('ale-spidermilk', withVillage({ innkeeper: true, alchemist: true })).state).toBe('live');
  });

  it('items not built on this branch show locked (or "not yet") from the catalog alone', () => {
    const s = withVillage(ALL);
    const shop = new Set(shopOffers(s).map((o) => o.kind as string));
    for (const r of CATALOG.filter((x) => x.kind === 'ware' && !x.keys.some((k) => shop.has(k)))) {
      const st = status(r.id, s);
      expect(['soon', 'locked'], r.id).toContain(st.state);
      expect(st.hint, r.id).toBeTruthy();
    }
    // With nobody home they read as locked, with the vendor's hint.
    const none = fresh();
    expect(status('glowarrows', none)).toMatchObject({ state: 'locked' });
    expect(status('glowarrows', none).hint).toMatch(/alchemist/);
  });

  it('V4.1 WS6: the arrow rows are live at their vendors: Mott from the start, Ilse, Gerda, the blast arrows with the pair', () => {
    const none = fresh();
    expect(status('arrows', none)).toMatchObject({ state: 'live', price: 10, key: 'arrows' });
    expect(status('whistlearrows', none)).toMatchObject({ state: 'live', price: 15 });
    for (const id of ['glowarrows', 'firearrows', 'poisonarrows', 'barbarrows', 'ropearrow', 'blastarrows']) expect(status(id, none).state, id).toBe('locked');
    const ilse = withVillage({ alchemist: true });
    expect(status('glowarrows', ilse)).toMatchObject({ state: 'live', price: 20 });
    expect(status('firearrows', ilse)).toMatchObject({ state: 'live', price: 25 });
    expect(status('poisonarrows', ilse)).toMatchObject({ state: 'live', price: 30 });
    expect(status('blastarrows', ilse).state).toBe('locked');
    const gerda = withVillage({ smith: true });
    expect(status('barbarrows', gerda)).toMatchObject({ state: 'live', price: 25 });
    expect(status('ropearrow', gerda)).toMatchObject({ state: 'live', price: 30 });
    expect(status('blastarrows', gerda).state).toBe('locked');
    expect(status('blastarrows', withVillage({ smith: true, alchemist: true }))).toMatchObject({ state: 'live', price: 40 });
    expect(CATALOG.filter((r) => r.group === 'Arrows').every((r) => !r.ws)).toBe(true);
  });

  it('perks: locked until the pair is home', () => {
    const sup = PERKS.find((p) => p.id === 'supper')!;
    expect(perkStatus(sup, fresh().campaign.village)).toBe('locked');
    expect(perkStatus(sup, ALL)).toBe('live');
    expect(gateMet(ALL, ['smith', 'surgeon'])).toBe(true);
  });
});
