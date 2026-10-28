// V5.0 (P, spec 32.9, owner): the Ranger's power curve. A bow shot at a target that has noticed the shooter loses a slot
// ("it saw you draw"); unaware targets take the full draw and the sneak-attack slot. Crew Rangers by the same rule.

import { describe, expect, it } from 'vitest';
import { createEngine } from './engine';
import { at, testCastle } from './test/testCastle';
import type { CrewId, GameEvent, GameState, HeroClass, MonsterKind, RivalCrew } from './types';
import { MONSTERS } from './data';
import { World } from './world';
import type { Ctx, DelveX, GameStateX, MonsterX, RivalX } from './state';
import { buildCrew } from './rivals';
import { makeHero } from './camp';
import { hostileAct } from './crewai';
import { oldLantern } from './test/light';

const e = createEngine(testCastle);
const w = new World(testCastle);

function delve(extra: [string, string, HeroClass][] = [['rae', 'Rae', 'ranger']]): GameState {
  const s = e.newGame(1);
  for (const [id, name, cls] of extra) s.campaign.roster.push(makeHero(id, name, cls));
  const r = e.apply(s, { type: 'startDelve', contractId: s.campaign.board[0]!.id, heroIds: ['keven', ...extra.map((x) => x[0])], entrance: 0, packs: {} });
  expect(r.error).toBeUndefined();
  const t = r.state;
  t.delve!.monsters = [];
  t.delve!.rivals = null;
  t.delve!.traps = {};
  t.delve!.prisoner = null;
  if (t.delve!.heroes.some((h) => h.heroId === 'rae')) oldLantern(t, 'rae');
  return t;
}
const hero = (s: GameState, id: string) => s.delve!.heroes.find((h) => h.heroId === id)!;
function monster(s: GameState, kind: MonsterKind, p: { level: number; q: number; r: number }, awareness: MonsterX['awareness'], noticed: string[] = []): MonsterX {
  const def = MONSTERS[kind];
  const m: MonsterX = { id: `m${s.delve!.monsters.length + 1}`, kind, name: def.name, at: { ...p }, hp: 20, maxHp: 20, awareness, spawnedAt: { ...p }, noticedIds: noticed };
  s.delve!.monsters.push(m);
  return m;
}
const ctx = (s: GameState): Ctx => { s.delve!.phase = 'world'; return { w, s: s as GameStateX, d: s.delve as DelveX, ev: [] as GameEvent[] }; };
const rollsBy = (c: Ctx, who: string) => c.ev.flatMap((x) => (x.type === 'roll' && x.who === who ? [{ what: x.what, slots: x.roll.slots }] : []));

describe('V5.0 (spec 32.9): it saw you draw', () => {
  it('a hero Ranger: 3 slots (+1 sneak attack) on a target that has not noticed her, 2 on one that has, 1 adjacent', () => {
    const s = delve();
    hero(s, 'rae').at = at(3, 1, 8);
    hero(s, 'keven').at = at(1, 2, 2);
    const m = monster(s, 'orc', at(3, 5, 8), 'alert');
    let p = e.preview(s, 'rae', 'attack', { id: m.id });
    expect(p.slots).toBe(4); // 3 + the sneak-attack slot: unaware
    expect(p.modifiers).not.toContain('It saw you draw −1 slot');
    m.noticedIds = ['rae'];
    p = e.preview(s, 'rae', 'attack', { id: m.id });
    expect(p.slots).toBe(2);
    expect(p.modifiers).toContain('It saw you draw −1 slot');
    m.at = at(3, 2, 8);
    expect(e.preview(s, 'rae', 'attack', { id: m.id }).slots).toBe(1);
    // Asleep: unaware, full draw.
    m.at = at(3, 5, 8);
    m.awareness = 'asleep';
    expect(e.preview(s, 'rae', 'attack', { id: m.id }).slots).toBe(4);
  });

  it('Keven\'s sword is untouched; Knockback keeps its two slots (it needs both)', () => {
    const s = delve();
    hero(s, 'rae').at = at(3, 1, 8);
    hero(s, 'keven').at = at(3, 6, 8);
    const m = monster(s, 'orc', at(3, 5, 8), 'hunting', ['keven', 'rae']);
    expect(e.preview(s, 'keven', 'attack', { id: m.id }).slots).toBe(3);
    expect(e.preview(s, 'rae', 'knockback', { id: m.id }).slots).toBe(2);
  });

  it('a crew Ranger loses the slot on a hero who has noticed her, and keeps the sneak slot on one who has not', () => {
    const s = delve([]);
    const k = hero(s, 'keven');
    k.at = at(2, 10, 8);
    k.hp = 99;
    const cr = buildCrew(s as GameStateX, 'lantern-sisters' as CrewId, [at(2, 10, 5), at(2, 11, 5), at(2, 12, 5)]);
    cr.stance = 'hostile' as RivalCrew['stance'];
    cr.spotted = true;
    cr.entered = true;
    s.delve!.rivals = cr;
    const wenna = (cr.members as RivalX[]).find((r) => r.cls === 'ranger')!;
    const shotWith = (seenBy: string[]) => {
      const t = structuredClone(s);
      const r = (t.delve!.rivals!.members as RivalX[]).find((x) => x.id === wenna.id)!;
      r.seenBy = seenBy;
      const c = ctx(t);
      hostileAct(c, r);
      const shots = rollsBy(c, r.id).filter((x) => x.what === 'Shot' || x.what === 'Sneak attack');
      expect(shots.length, c.ev.filter((x) => x.type === 'say').map((x) => (x as { text: string }).text).join(' | ')).toBeGreaterThanOrEqual(1);
      return shots[0]!.slots;
    };
    expect(shotWith(['keven'])).toBe(2); // Keven has noticed her: 3 − 1
    expect(shotWith([])).toBe(4); // unnoticed: 3 + the sneak slot
  });
});
