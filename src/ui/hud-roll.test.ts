// V4.0 HUD: the roll read in words (target card, roll panel): kill chance against the target's HP,
// Focus making tries sure, the outcome segments, and non-damage rolls by their outcome words.

import { describe, expect, it } from 'vitest';
import type { RollPreview } from '../game/api';
import { bonusSlots, hitOdds, lightWords, oddsWords, oftenWords, readRoll } from './hud-roll';

const attack = (slots: number, chance: number, dmg: number, mods: string[] = []): RollPreview => ({
  ok: true,
  stat: 'might',
  slots,
  chance,
  modifiers: mods,
  maxFocus: 3,
  outcomes: Array.from({ length: slots + 1 }, (_, i) => (i === 0 ? 'Miss' : `${i * dmg + (i === slots ? 1 : 0)} dmg`)),
  noise: 2,
  light: 0,
});

describe('V4.0 HUD: reading a roll', () => {
  it('odds add up and Focus locks tries', () => {
    const o = hitOdds(3, 65, 0);
    expect(o.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    const f = hitOdds(3, 65, 1);
    expect(f[0]).toBe(0);
    expect(f.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });

  it('a damage roll against the target: kill, hurt, miss, and Focus raising the kill chance', () => {
    const pr = attack(3, 65, 2); // 2, 4, 7 damage
    const r = readRoll(pr, 0, 6);
    expect(r.kind).toBe('damage');
    expect(r.kill).toBeCloseTo(0.65 ** 3, 6); // only all three hits (7) kill a 6 HP orc
    expect(r.segments.map((s) => s.cls)).toEqual(['miss', 'hurt', 'kill']);
    expect(r.headline).toMatch(/^Kills it /);
    const f = readRoll(pr, 1, 6);
    expect(f.kill).toBeGreaterThan(r.kill);
    expect(f.miss).toBe(0);
    expect(readRoll(pr, 3, 6).headline).toBe('Kills it');
    // A target it can't kill: the likely damage.
    expect(readRoll(pr, 0, 20).headline).toMatch(/^Likely \d+ damage$/);
  });

  it('other rolls read by their outcome words', () => {
    const pick: RollPreview = { ok: true, stat: 'finesse', slots: 3, chance: 50, modifiers: [], maxFocus: 0, outcomes: ['Lock jams', 'Fails', 'Opens, noise 2', 'Opens silently'], noise: 2, light: 0 };
    const r = readRoll(pick, 0, null);
    expect(r.kind).toBe('other');
    expect(r.works).toBeCloseTo(0.5, 6);
    expect(r.headline).toBe('Works about half the time');
    expect(r.segments.map((s) => s.cls)).toEqual(['fail', 'fail', 'ok', 'best']);
  });

  it('words for chances, bonus tries and light', () => {
    expect(oftenWords(0.5)).toBe('about half the time');
    expect(oftenWords(1)).toBe('every time');
    expect(oddsWords(50)).toBe('1 in 2');
    expect(oddsWords(10)).toBe('1 in 10');
    expect(bonusSlots(['Sneak attack +1 slot', 'Flanked +1 slot', 'Dim −10%'])).toEqual(['sneak', 'flanked']);
    expect(lightWords(['Dim −10%'])).toBe('dim light, −10%');
    expect(lightWords([])).toBe('good light, no penalty');
  });
});
