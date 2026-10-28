// V5.0 (spec 32.12): the hero tag's status chips (docs/v5-status-visuals.md).

import { describe, expect, it } from 'vitest';
import type { HeroInDelve } from '../game/types';
import { heroTag, monsterTag } from './tags';

const hero = (extra: Partial<HeroInDelve> = {}): HeroInDelve => ({
  heroId: 'k', at: { level: 1, q: 0, r: 0 }, hp: 8, focus: 3, pack: [], status: 'active', bleed: 0, torch: 0, moved: false, acted: false, webbed: false, mana: 0,
  rallyCooldown: 0, revived: false, dashed: false, overwatch: false, veil: 0, ward: 0, ...extra,
} as HeroInDelve);

describe('V5.0 (spec 32.12): hero tag chips', () => {
  it('a plain hero shows health only', () => {
    const t = heroTag(hero(), 10);
    expect(t).toContain('hp-pips');
    expect(t).not.toMatch(/tag-(held|rooted|unlit|braced|overwatch|veiled|flame)/);
  });
  it('held, rooted and webbed: one movement chip, held first', () => {
    expect(heroTag(hero({ grabbedBy: 'm1', rooted: 2 }), 10)).toContain('tag-held');
    expect(heroTag(hero({ grabbedBy: 'm1', rooted: 2 }), 10)).not.toContain('rooted · 2');
    expect(heroTag(hero({ rooted: 2 }), 10)).toContain('rooted · 2');
    expect(heroTag(hero({ webbed: true }), 10)).toContain('webbed');
  });
  it('unlit reads red with "the dark hunts" on Level 3 only', () => {
    expect(heroTag(hero(), 10, false, true)).toMatch(/tag-unlit"[^>]*>unlit</);
    expect(heroTag(hero({ at: { level: 3, q: 0, r: 0 } }), 10, false, true)).toContain('the dark hunts');
  });
  it('stances: braced, guards, overwatch, veiled; the torch under 5 rounds', () => {
    const t = heroTag(hero({ braced: true, guarding: 'f', overwatch: true, veil: 2, pack: [{ id: 't', kind: 'torch', name: 'Torch', amount: 1, slots: 1, lit: true, rounds: 3 }] }), 10);
    for (const c of ['tag-braced', 'guards', 'tag-overwatch', 'tag-veiled', 'tag-flame']) expect(t).toContain(c);
    expect(heroTag(hero({ pack: [{ id: 't', kind: 'torch', name: 'Torch', amount: 1, slots: 1, lit: true, rounds: 9 }] }), 10)).not.toContain('tag-flame');
  });
  it('a downed hero shows the bleed count and nothing else', () => {
    const t = heroTag(hero({ status: 'downed', hp: 0, bleed: 2, braced: true }), 10);
    expect(t).toContain('✚ 2');
    expect(t).not.toContain('tag-braced');
  });
  it('monster tags are unchanged: the mood glyphs stay (owner)', () => {
    expect(monsterTag({ id: 'm', kind: 'orc', name: 'Orc', at: { level: 1, q: 0, r: 0 }, hp: 6, maxHp: 6, awareness: 'hunting', spawnedAt: { level: 1, q: 0, r: 0 } })).toContain('tag-hunt');
  });
});
