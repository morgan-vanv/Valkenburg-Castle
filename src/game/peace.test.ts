// V5.0 (spec 32.14): a swing at a crew member while the crew is at peace carries a warning in the preview, so the
// roll panel says what it costs (the bot had been paying a toll and shooting the burglar two rounds later).

import { describe, expect, it } from 'vitest';
import { createEngine } from './engine';
import { at, testCastle } from './test/testCastle';
import type { GameState } from './types';
import type { GameStateX } from './state';
import { buildCrew } from './rivals';

const e = createEngine(testCastle);

function withCrew(stance: 'truce' | 'waiting' | 'hostile'): GameState {
  const s = e.newGame(1);
  const k = s.campaign.board[0]!;
  const r = e.apply(s, { type: 'startDelve', contractId: k.id, heroIds: ['keven'], entrance: 0, packs: {} });
  expect(r.error).toBeUndefined();
  const t = r.state;
  t.delve!.monsters = [];
  t.delve!.traps = {};
  const keven = t.delve!.heroes[0]!;
  keven.at = at(1, 2, 2);
  t.delve!.rivals = buildCrew(t as GameStateX, 'ferrymen', [at(1, 3, 2), at(1, 6, 7), at(1, 7, 7), at(1, 8, 7)]);
  t.delve!.rivals.stance = stance;
  return t;
}

describe('V5.0 (spec 32.14): a crew at peace is not a casual target', () => {
  it('the attack preview warns under truce (they keep what you paid) and while waiting; not once hostile', () => {
    for (const [stance, text] of [['truce', 'keep what you paid'], ['waiting', 'not your enemy yet']] as const) {
      const s = withCrew(stance);
      const o = e.actions(s, 'keven').find((x) => x.action === 'attack');
      const t = o?.targets.find((x) => x.id === s.delve!.rivals!.members[0]!.id);
      expect(t, stance).toBeDefined();
      const pv = e.preview(s, 'keven', 'attack', t!);
      expect(pv.warning, stance).toContain(text);
      expect(!!pv.confirm, stance).toBe(stance === 'truce'); // a paid crew asks first; a waiting one only warns
    }
    const h = withCrew('hostile');
    const o = e.actions(h, 'keven').find((x) => x.action === 'attack')!;
    const t = o.targets.find((x) => x.id === h.delve!.rivals!.members[0]!.id)!;
    expect(e.preview(h, 'keven', 'attack', t).warning ?? '').not.toContain('not your enemy');
  });
});
