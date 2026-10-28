// V5.0 (P, spec 32.15): the threshold. The step across the stairs is free; a hero on a stair hex peeks at the other
// level's landing (PEEK_RANGE round the link), and the monsters there see them up the stairs and climb.

import { describe, expect, it } from 'vitest';
import { createEngine } from './engine';
import { at, testCastle } from './test/testCastle';
import { posKey } from './hex';
import type { GameState } from './types';
import type { DelveX, MonsterX } from './state';
import { dirIndex } from './world';
import { PEEK_RANGE } from './data';

const e = createEngine(testCastle);
const hero = (s: GameState, id: string) => s.delve!.heroes.find((h) => h.heroId === id)!;

function delve(): GameState {
  const s = e.newGame(1);
  const k = s.campaign.board[0]!;
  const r = e.apply(s, { type: 'startDelve', contractId: k.id, heroIds: ['keven'], entrance: 0, packs: {} });
  expect(r.error).toBeUndefined();
  const t = r.state;
  t.delve!.monsters = [];
  t.delve!.rivals = null;
  t.delve!.traps = {};
  return t;
}
function orc(s: GameState, p: { level: number; q: number; r: number }, awareness: MonsterX['awareness'] = 'alert'): MonsterX {
  const m = { id: 'mpeek', kind: 'orc', name: 'Orc', at: { ...p }, hp: 6, maxHp: 6, awareness, spawnedAt: { ...p }, facing: dirIndex(p, at(2, 2, 4)) } as unknown as MonsterX;
  s.delve!.monsters.push(m);
  return m;
}

describe('V5.0 (spec 32.15): the threshold', () => {
  it('a hero on the stair hex sees the landing within PEEK_RANGE of the link; off the stairs, nothing of the other level', () => {
    const s = delve();
    hero(s, 'keven').at = at(1, 2, 6);
    const off = e.visibility(s).visible;
    expect([...off].some((k) => k.startsWith('2:'))).toBe(false);
    hero(s, 'keven').at = at(1, 2, 7); // the stairs, linked to L2 (2, 4)
    const on = e.visibility(s).visible;
    expect(on.has(posKey(at(2, 2, 4)))).toBe(true);
    expect(on.has(posKey(at(2, 2, 2)))).toBe(true); // the brazier's light, 2 away
    const far = [...on].filter((k) => k.startsWith('2:'));
    expect(far.length).toBeGreaterThan(3);
    // Nothing farther than PEEK_RANGE from the link.
    const link = at(2, 2, 4);
    for (const k of far) {
      const [q, r] = k.slice(2).split(',').map(Number) as [number, number];
      const dist = Math.max(Math.abs(q - link.q), Math.abs(r - link.r), Math.abs(q + r - link.q - link.r));
      expect(dist, k).toBeLessThanOrEqual(PEEK_RANGE + 1); // +1: the walls round seen floor
    }
  });

  it('an awake orc within PEEK_RANGE of the link notices the hero up the stairs and climbs to them; one farther off does not', () => {
    const s = delve();
    hero(s, 'keven').at = at(1, 2, 6);
    const m = orc(s, at(2, 3, 3));
    // Step onto the stairs: the orc looks up them (noticing happens on the step).
    let r = e.apply(s, { type: 'move', heroId: 'keven', path: [at(1, 2, 7)], sneak: false });
    expect(r.error).toBeUndefined();
    expect(r.events.some((x) => x.type === 'noticed' && x.by === m.id && x.hero === 'keven')).toBe(true);
    const o = r.state.delve!.monsters[0]!;
    expect(o.awareness).toBe('hunting');
    // The castle's turn: it comes for the stairs. Keven holds the stair hex, so it can't climb past him: it stands at
    // the foot of the stairs (the link hex or beside it).
    r = e.apply(r.state, { type: 'endTurn' });
    while (r.state.delve?.pending) r = e.apply(r.state, { type: 'react', choice: 'no' });
    const foot = r.state.delve!.monsters[0]!;
    expect(foot.at.level).toBe(2);
    const link = at(2, 2, 4);
    expect(Math.max(Math.abs(foot.at.q - link.q), Math.abs(foot.at.r - link.r), Math.abs(foot.at.q + foot.at.r - link.q - link.r))).toBeLessThanOrEqual(1);
    // Keven steps off the stairs: the way is open and the orc climbs (the crossing is free for it too).
    r = e.apply(r.state, { type: 'move', heroId: 'keven', path: [at(1, 2, 6)], sneak: false });
    expect(r.error).toBeUndefined();
    r = e.apply(r.state, { type: 'endTurn' });
    while (r.state.delve?.pending) r = e.apply(r.state, { type: 'react', choice: 'no' });
    expect(r.state.delve!.monsters[0]!.at.level).toBe(1);
    // Too far from the link: unseen, and the hero sees it only if it's within the peek.
    const t = delve();
    hero(t, 'keven').at = at(1, 2, 6);
    orc(t, at(2, 4, 1)); // 3+ from the link, behind the brazier's room corner
    const r2 = e.apply(t, { type: 'move', heroId: 'keven', path: [at(1, 2, 7)], sneak: false });
    expect(r2.events.some((x) => x.type === 'noticed')).toBe(false);
  });

  it('what the peek shows is listed for the HUD: engine.peek', () => {
    const s = delve();
    hero(s, 'keven').at = at(1, 2, 7);
    orc(s, at(2, 3, 3), 'patrol');
    const p = e.peek!(s, 'keven');
    expect(p).toMatchObject({ level: 2, down: true });
    expect(p!.figures.map((f) => f.name)).toEqual(['Orc']);
    expect(p!.figures[0]!.dist).toBeLessThanOrEqual(2);
    expect(p!.lit).toBe(true);
    hero(s, 'keven').at = at(1, 2, 6);
    expect(e.peek!(s, 'keven')).toBeNull();
    (s.delve as DelveX).liftWorking = true;
    hero(s, 'keven').at = at(2, 1, 6); // the lift, down to Level 3
    expect(e.peek!(s, 'keven')).toMatchObject({ level: 3, down: true });
  });
});
