// V5.2 (spec 35): the title screen's campaign card and the memory of ended runs.
import { describe, expect, it } from 'vitest';
import { createEngine } from '../../game/engine';
import { testCastle } from '../../game/test/testCastle';
import type { GameState } from '../../game/types';
import { MAX_RUNS, addRun, campaignCard, runLine, runRecord, villagersHome } from './runs';

const fresh = (): GameState => {
  const e = createEngine(testCastle);
  const s = e.newGame(7);
  const r = e.apply(s, { type: 'newCampaign', seed: 7 });
  return r.error ? s : r.state;
};

describe('campaign card', () => {
  it('a fresh campaign: Keven in Lowgate, nobody home, no graves', () => {
    const c = campaignCard(fresh());
    expect(c.kind).toBe('camp');
    expect(c.where).toBe('Fresh in Lowgate');
    expect(c.party[0]?.cls).toBe('heir');
    expect(c.villagers).toBe(0);
    expect(c.graves).toBe(0);
  });
  it('counts delves, villagers and graves in camp', () => {
    const s = fresh();
    s.campaign.delveCount = 4;
    s.campaign.village = { ...s.campaign.village, surgeon: true, smith: true, copper: true };
    s.campaign.fallen = [{ name: 'Osk', cls: 'ranger', level: 1, where: 'Level 1, the Great Hall', delve: 2 }];
    const c = campaignCard(s);
    expect(c.where).toBe('After 4 delves · resting in Lowgate');
    expect(villagersHome(s)).toBe(2); // the copper is a thing, not a villager
    expect(c.graves).toBe(1);
  });
  it('an ended campaign says how Keven fell', () => {
    const s = fresh();
    s.stage = 'over';
    s.campaign.fallen = [{ name: 'Keven', cls: 'heir', level: 3, where: 'Level 2, the cellblock', delve: 6 }];
    expect(campaignCard(s).kind).toBe('over');
    expect(campaignCard(s).where).toBe('Keven fell · Level 2, the cellblock');
  });
});

describe('ended runs', () => {
  it('records how it ended and keeps one entry per run, newest first, at most MAX_RUNS', () => {
    const s = fresh();
    s.stage = 'over';
    s.campaign.delveCount = 7;
    s.campaign.fallen = [{ name: 'Keven', cls: 'heir', level: 3, where: 'Level 2, the cellblock', delve: 7 }];
    const r = runRecord(s, 1000);
    expect(r.id).toBe(`${s.seed}:7`);
    expect(runLine(r)).toBe('Keven fell on delve 7, Level 2, the cellblock');
    s.overReason = 'The heir is taken. Valkenburg stays dark.';
    expect(runLine(runRecord(s))).toMatch(/^Keven was taken on delve 7/);
    let list = addRun([], r);
    list = addRun(list, { ...r, at: 2000 });
    expect(list).toHaveLength(1);
    for (let i = 0; i < MAX_RUNS + 3; i++) list = addRun(list, { ...r, id: `x${i}` });
    expect(list).toHaveLength(MAX_RUNS);
    expect(list[0]!.id).toBe(`x${MAX_RUNS + 2}`);
  });
});
