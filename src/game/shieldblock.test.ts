// V5.0 (P, spec 32.10, owner): the shield block. A hero with the forge shield who is hit for more than 1 may take it on
// the shield for 1 Focus (the hit does 1), or take the hit. A reaction: the castle's turn asks. Crew Sellswords carry a
// shield and block hard hits by policy.

import { describe, expect, it } from 'vitest';
import { createEngine } from './engine';
import { at, testCastle } from './test/testCastle';
import { oldLantern } from './test/light';
import type { Command, GameEvent, GameState, Monster, MonsterKind, RivalCrew } from './types';
import { MONSTERS, SHIELD_BLOCK_CAP } from './data';
import { World } from './world';
import type { Ctx, DelveX, GameStateX, MonsterX, RivalX } from './state';
import { makeHero } from './camp';
import { buildCrew } from './rivals';
import { strike } from './ai';

const e = createEngine(testCastle);
const w = new World(testCastle);

function delve(): GameState {
  const s = e.newGame(1);
  s.campaign.roster.push(makeHero('brann', 'Brann', 'sellsword'));
  s.campaign.roster.find((h) => h.id === 'brann')!.shield = true;
  const r = e.apply(s, { type: 'startDelve', contractId: s.campaign.board[0]!.id, heroIds: ['keven', 'brann'], entrance: 0, packs: {} });
  expect(r.error).toBeUndefined();
  const t = r.state;
  t.delve!.monsters = [];
  t.delve!.rivals = null;
  t.delve!.traps = {};
  t.delve!.prisoner = null;
  hero(t, 'keven').at = at(1, 2, 2);
  hero(t, 'brann').at = at(1, 9, 7);
  hero(t, 'brann').hp = 10;
  hero(t, 'brann').focus = 2;
  for (const h of t.delve!.heroes) h.facing = undefined;
  oldLantern(t, 'brann');
  return t;
}
const hero = (s: GameState, id: string) => s.delve!.heroes.find((h) => h.heroId === id)!;
function monster(s: GameState, kind: MonsterKind, p: { level: number; q: number; r: number }, awareness: Monster['awareness'] = 'hunting'): MonsterX {
  const def = MONSTERS[kind];
  const m: MonsterX = { id: `m${s.delve!.monsters.length + 1}`, kind, name: def.name, at: { ...p }, hp: 99, maxHp: 99, awareness, spawnedAt: { ...p }, noticedIds: s.delve!.heroes.map((h) => h.heroId) };
  s.delve!.monsters.push(m);
  return m;
}
function ok(s: GameState, cmd: Command) {
  const r = e.apply(s, cmd);
  expect(r.error).toBeUndefined();
  return r;
}
const question = (s: GameState) => s.delve!.pending?.question;

/** A berserker next to Brann (4 tries at 3 damage: its hits land for more than 1 through his armor); the castle's turn strikes. */
function scene(): GameState {
  const s = delve();
  const m = monster(s, 'berserker', at(1, 10, 7));
  m.focusAt = hero(s, 'brann').at;
  return s;
}

/** End the turn, answering every other question "no", until the shield block is asked or the turn ends. */
function untilBlockAsked(s: GameState, tries = 12): { state: GameState; asked: boolean } {
  let r = e.apply(s, { type: 'endTurn' });
  for (let i = 0; i < tries; i++) {
    expect(r.error).toBeUndefined();
    const q = question(r.state);
    if (!q) return { state: r.state, asked: false };
    if (q.kind === 'shieldBlock') return { state: r.state, asked: true };
    r = e.apply(r.state, { type: 'react', choice: 'no' });
  }
  return { state: r.state, asked: false };
}

describe('V5.0 (spec 32.10): the shield block', () => {
  it('a hit over the cap on a hero with a shield and Focus asks: block (1 Focus, the hit does 1) or take it', () => {
    // The dice differ by seed; look for a turn where the ogre's hit lands for more than the cap.
    let found = false;
    for (let seed = 1; seed <= 12 && !found; seed++) {
      const s = scene();
      s.rng = (seed * 2654435761) >>> 0;
      const { state, asked } = untilBlockAsked(s);
      if (!asked) continue;
      found = true;
      const q = question(state)!;
      expect(q).toMatchObject({ kind: 'shieldBlock', heroId: 'brann', enemyId: 'm1' });
      expect(q.damage!).toBeGreaterThan(SHIELD_BLOCK_CAP);
      expect(q.text).toMatch(/lands on Brann for \d+\. Take it on the shield, or take the hit\?/);
      expect(q.yes.label).toBe('Block');
      const yes = ok(state, { type: 'react', choice: 'yes' });
      const b = hero(yes.state, 'brann');
      expect(b.focus).toBe(1);
      expect(yes.events.some((x) => x.type === 'blocked' && x.id === 'brann' && x.to === SHIELD_BLOCK_CAP)).toBe(true);
      const blockedHit = yes.events.find((x) => x.type === 'hit' && x.target === 'brann' && x.attacker === 'm1');
      expect(blockedHit && blockedHit.type === 'hit' ? blockedHit.damage : -1).toBe(SHIELD_BLOCK_CAP);
      const no = ok(state, { type: 'react', choice: 'no' });
      expect(hero(no.state, 'brann').focus).toBe(2);
      const takenHit = no.events.find((x) => x.type === 'hit' && x.target === 'brann' && x.attacker === 'm1');
      expect(takenHit && takenHit.type === 'hit' ? takenHit.damage : -1).toBe(q.damage);
    }
    expect(found).toBe(true);
  });

  it('no shield, or no Focus: never asked', () => {
    for (const strip of ['shield', 'focus'] as const) {
      let asked = false;
      for (let seed = 1; seed <= 8 && !asked; seed++) {
        const s = scene();
        s.rng = (seed * 2654435761) >>> 0;
        if (strip === 'shield') s.campaign.roster.find((h) => h.id === 'brann')!.shield = false;
        else hero(s, 'brann').focus = 0;
        asked = untilBlockAsked(s).asked;
      }
      expect(asked).toBe(false);
    }
  });

  it('a crew Sellsword with Focus blocks a hard hit by policy: the hit does 1 and costs it 1 Focus', () => {
    const s = delve();
    const cr = buildCrew(s as GameStateX, 'ferrymen', [at(2, 10, 5), at(2, 11, 5), at(2, 12, 5)]);
    cr.stance = 'hostile' as RivalCrew['stance'];
    cr.spotted = true;
    cr.entered = true;
    s.delve!.rivals = cr;
    const joost = (cr.members as RivalX[]).find((r) => r.cls === 'sellsword')!;
    joost.focus = 2;
    joost.hp = 20;
    const c: Ctx = { w, s: s as GameStateX, d: s.delve as DelveX, ev: [] as GameEvent[] };
    // A sure, heavy hit: 3 slots at 95%, 6 damage each.
    let blocked = false;
    for (let i = 0; i < 6 && !blocked; i++) {
      const r = strike(c, 'keven', joost.id, 3, 95, 6, 'Attack');
      blocked = c.ev.some((x) => x.type === 'blocked' && x.id === joost.id);
      if (r) break;
    }
    expect(blocked).toBe(true);
    expect(joost.focus).toBe(1);
    const ev = c.ev.find((x) => x.type === 'blocked' && x.id === joost.id);
    expect(ev && ev.type === 'blocked' ? ev.to : -1).toBe(SHIELD_BLOCK_CAP);
  });
});
