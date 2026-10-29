import { describe, expect, it } from 'vitest';
import { ALES } from '../../game/data';
import type { AleOffer } from '../../game/types';
import { ALE_LOOK, CLASS_TOAST, chalkFor, chalkGroups, pourCheck, roundOf, tapOrder, tipBackOf, toastLine, toastPlan } from './ales';

const offer = (kind: AleOffer['kind'], over: Partial<AleOffer> = {}): AleOffer => ({ ...ALES.find((a) => a.kind === kind)!, ...over });

describe('V5.1.2 ales (the taps, the toast)', () => {
  it('every ale and every Black Cask outcome has a look', () => {
    for (const a of ALES) expect(ALE_LOOK[a.kind]?.colour).toMatch(/^#/);
    expect(ALE_LOOK.hiccups.bad).toBe(true);
    expect(ALE_LOOK.heavyhead.bad).toBe(true);
  });

  it('pourCheck: dry tap, one a delve, gold short; else true', () => {
    expect(pourCheck({ name: 'Petra' }, offer('glowworm', { locked: 'No copper.' }), 99)).toMatch(/dry tap/);
    expect(pourCheck({ name: 'Petra', ale: 'mole' }, offer('glowworm'), 99)).toMatch(/already has one/);
    expect(pourCheck({ name: 'Petra' }, offer('glowworm'), 5)).toMatch(/You have 5 gold/);
    expect(pourCheck({ name: 'Petra' }, offer('glowworm'), 15)).toBe(true);
  });

  it('roundOf: everyone without an ale, the total, and why not', () => {
    const party = [{ id: 'k', name: 'Keven', ale: 'reserve' as const }, { id: 'p', name: 'Petra' }, { id: 'j', name: 'Jutta' }];
    expect(roundOf(party, offer('glowworm'), 100)).toMatchObject({ ids: ['p', 'j'], total: 30, ok: true });
    expect(roundOf(party, offer('glowworm'), 20)).toMatchObject({ ok: false, reason: 'A round is 30 gold. You have 20.' });
    expect(roundOf([party[0]!], offer('glowworm'), 100)).toMatchObject({ ids: [], ok: false });
    expect(roundOf(party, offer('glowworm', { price: 10 }), 20)).toMatchObject({ total: 20, ok: true });
  });

  it('chalk: Wim away, the copper, the cask book, Ilse; neighbours with the same line share it; live taps first', () => {
    const v = { innkeeper: true, copper: true };
    expect(chalkFor(offer('glowworm'), {})).toMatch(/castle kitchens/);
    expect(chalkFor(offer('glowworm'), { innkeeper: true })).toMatch(/copper/);
    expect(chalkFor(offer('smuggler'), v)).toMatch(/cask book/);
    expect(chalkFor(offer('nighteye'), v)).toMatch(/Ilse/);
    const list = ALES.map((a) => ({ ...a, locked: a.needs === 'copper' ? undefined : 'locked' }));
    const ordered = tapOrder(list);
    expect(ordered.slice(0, 4).every((o) => !o.locked)).toBe(true);
    const groups = chalkGroups(ordered, v);
    expect(groups.filter((g) => g.chalk === null)).toHaveLength(4);
    expect(groups.filter((g) => g.chalk).map((g) => g.taps.length)).toEqual([3, 3]);
  });

  it('toast lines: Keven toasts Valkenburg; a hero says the same line every time', () => {
    expect(toastLine('heir', 'keven')).toBe('To Valkenburg!');
    expect(toastLine('shadowmancer', 'petra')).toBe(toastLine('shadowmancer', 'petra'));
    expect(CLASS_TOAST.shadowmancer).toContain(toastLine('shadowmancer', 'petra'));
  });

  it('toastPlan: read from the states either side of startDelve; empty when nobody drank; the Black Cask flagged', () => {
    const before = { campaign: { roster: [{ id: 'keven', ale: 'reserve' as const }, { id: 'jutta', ale: 'blackcask' as const }, { id: 'petra' }] } };
    const roster = [{ id: 'keven', name: 'Keven', cls: 'heir' as const }, { id: 'jutta', name: 'Jutta', cls: 'hedgewitch' as const }, { id: 'petra', name: 'Petra', cls: 'shadowmancer' as const }];
    const after = { stage: 'delve', campaign: { roster }, delve: { heroes: [{ heroId: 'keven', ale: 'reserve' as const }, { heroId: 'jutta', ale: 'hiccups' as const }, { heroId: 'petra' }] } };
    const plan = toastPlan(before, after);
    expect(plan.map((d) => [d.heroId, d.ale, d.cask])).toEqual([['keven', 'reserve', false], ['jutta', 'hiccups', true], ['petra', undefined, false]]);
    expect(plan[0]!.line).toBe('To Valkenburg!');
    expect(toastPlan({ campaign: { roster: [] } }, { ...after, delve: { heroes: [{ heroId: 'petra' }] } })).toEqual([]);
    expect(toastPlan(before, { ...after, stage: 'camp', delve: null })).toEqual([]);
  });

  it('tipBackOf: paid refunds; Wim\'s gift and an unrecorded old ale stay, each said truthfully', () => {
    expect(tipBackOf({ ale: 'mole', alePaid: 20 })).toMatchObject({ can: true, kind: 'paid' });
    expect(tipBackOf({ ale: 'reserve', aleGift: true })).toMatchObject({ can: false, kind: 'gift', line: "A gift from Wim. He'd be hurt." });
    expect(tipBackOf({ ale: 'reserve' })).toMatchObject({ can: false, kind: 'untabbed', line: 'Poured before Wim kept a tab. It stays poured.' });
  });

  it('every short line fits a narrow tap (18 characters or fewer)', () => {
    for (const a of ALES) expect(ALE_LOOK[a.kind].short.length, a.kind).toBeLessThanOrEqual(18);
  });
});
