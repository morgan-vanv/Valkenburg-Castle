// V4.0 play-test fixes 2 (spec 30.1, 30.2): the Sapper toned down (no Brace, HP 9, Might 60, armor 0) and class kit
// by level (one improvised explosive or pick a level each delve), for heroes and crew members, and old saves.

import { describe, it, expect } from 'vitest';
import { createEngine } from './engine';
import { at, testCastle } from './test/testCastle';
import { posKey } from './hex';
import type { Command, GameState, HeroClass, Item } from './types';
import { CLASSES, kitPerDelve } from './data';
import type { Ctx, DelveX, GameStateX } from './state';
import { World } from './world';
import { fitClass, makeHero } from './camp';
import { chargeCount } from './charges';
import { armorOf } from './common';
import { buildCrew } from './rivals';
import { crewWorkLock } from './crewmove';

const e = createEngine(testCastle);
const w = new World(testCastle);
const DOOR = at(1, 13, 3); // locked
const NEXT_TO_DOOR = at(1, 12, 3);

/** A delve with the given extra heroes (id, class, level); monsters, rivals and traps cleared. */
function delve(heroes: [string, HeroClass, number][], seed = 1): GameState {
  const s = e.newGame(seed);
  for (const [id, cls, lv] of heroes) s.campaign.roster.push(makeHero(id, id, cls, lv));
  const k = s.campaign.board[0]!;
  const r = e.apply(s, { type: 'startDelve', contractId: k.id, heroIds: heroes.map((x) => x[0]), entrance: 0, packs: {} });
  expect(r.error).toBeUndefined();
  const t = r.state;
  t.delve!.monsters = [];
  t.delve!.rivals = null;
  t.delve!.traps = {};
  t.delve!.light = 20;
  return t;
}

const hero = (s: GameState, id: string) => s.delve!.heroes.find((h) => h.heroId === id)!;
const kit = (s: GameState, id: string) => hero(s, id).pack.filter((i) => i.kind === 'improvised' || i.kind === 'improvised-charge');
const pickCmd: Command = { type: 'act', heroId: 'pim', action: 'pick', target: { at: DOOR }, focus: 0 };

describe('V4.0 play-test fixes 2 (spec 30)', () => {
  describe('30.1 the Sapper: no Brace, a little squishier than the Sellsword', () => {
    it('HP 9, Might 60, armor 0; the Sellsword keeps HP 10, Might 70, armor 1', () => {
      expect(CLASSES.sapper).toMatchObject({ hp: 9, armor: 0, stats: { might: 60 } });
      expect(CLASSES.sellsword).toMatchObject({ hp: 10, armor: 1, stats: { might: 70 } });
      expect(CLASSES.sapper.weapon).toMatchObject({ slots: 3, stat: 'might', dmg: 2 }); // the hammer stays
      const sam = makeHero('sam', 'Sam', 'sapper', 3);
      expect([sam.maxHp, sam.stats.might]).toEqual([13, 70]);
      expect(e.classInfo('sapper').abilities.some((a) => /Brace/.test(a))).toBe(false);
    });

    it('a Sapper has no Brace; armor 0 in the delve', () => {
      const s = delve([['sam', 'sapper', 1], ['brann', 'sellsword', 1]]);
      expect(e.actions(s, 'sam').some((a) => a.action === 'brace')).toBe(false);
      expect(e.actions(s, 'brann').some((a) => a.action === 'brace')).toBe(true);
      expect(armorOf(s.campaign.roster.find((h) => h.id === 'sam')!)).toBe(0);
      expect(e.apply(s, { type: 'act', heroId: 'sam', action: 'brace', target: {}, focus: 0 }).error).toBeDefined();
    });

    it('crew Sappers follow the class: the Ferrymen\'s Brecht (level 3) HP 13, armor 0 + 1', () => {
      const s = delve([['brann', 'sellsword', 1]]);
      const f = buildCrew(s as GameStateX, 'ferrymen', [at(2, 16, 4), at(2, 17, 4), at(2, 18, 4)]);
      const brecht = f.members.find((r) => r.cls === 'sapper')!;
      expect([brecht.hp, brecht.maxHp]).toEqual([13, 13]);
    });

    it('old saves: Sappers come down to the table (HP and Might, wounds kept), once; a Sapper mid-delve is capped', () => {
      const old = makeHero('sam', 'Sam', 'sapper', 3);
      Object.assign(old, { maxHp: 14, hp: 8, stats: { ...old.stats, might: 75 } }); // made under the old table
      expect(fitClass(old)).toBe(true);
      expect([old.maxHp, old.hp, old.stats.might, old.stats.nerve]).toEqual([13, 7, 70, 60]);
      expect(fitClass(old)).toBe(false); // idempotent
      const other = makeHero('brann', 'Brann', 'sellsword', 2);
      expect(fitClass(other)).toBe(false);
      // A whole save with a full-health level 1 Sapper in the castle.
      const s = delve([['sam', 'sapper', 1]]);
      const def = s.campaign.roster.find((h) => h.id === 'sam')!;
      Object.assign(def, { maxHp: 10, hp: 10, stats: { ...def.stats, might: 65 } });
      hero(s, 'sam').hp = 10;
      s.campaign.recruits.push({ hero: Object.assign(makeHero('r1', 'Rook', 'sapper'), { maxHp: 10, hp: 10 }), price: 60 });
      const back = e.deserialize(e.serialize(s))!;
      const sam = back.campaign.roster.find((h) => h.id === 'sam')!;
      expect([sam.maxHp, sam.hp, sam.stats.might]).toEqual([9, 9, 60]);
      expect(hero(back, 'sam').hp).toBe(9);
      expect(back.campaign.recruits.at(-1)!.hero.maxHp).toBe(9);
    });
  });

  describe('30.2 class kit by level', () => {
    it('one a level each delve: a level 1 Sapper brings 1, level 3 brings 3, level 6 brings 6; bought charges add', () => {
      expect([1, 2, 3, 6].map(kitPerDelve)).toEqual([1, 2, 3, 6]);
      for (const lv of [1, 3, 6]) {
        const s = delve([['sam', 'sapper', lv]]);
        expect(kit(s, 'sam')).toMatchObject([{ kind: 'improvised-charge', amount: lv, slots: 0, name: lv === 1 ? 'Improvised explosive' : 'Improvised explosives' }]);
        expect(chargeCount(hero(s, 'sam'))).toBe(lv);
      }
      // A bought blasting charge in the pack adds to them.
      let s = e.newGame(1);
      s.campaign.roster.push(makeHero('sam', 'Sam', 'sapper', 2));
      s.campaign.stash.push({ id: 'bc', kind: 'charge', name: 'Blasting charge', amount: 1, slots: 1 });
      const k = s.campaign.board[0]!;
      const r = e.apply(s, { type: 'startDelve', contractId: k.id, heroIds: ['sam'], entrance: 0, packs: { sam: ['bc'] } });
      expect(r.error).toBeUndefined();
      s = r.state;
      expect(chargeCount(hero(s, 'sam'))).toBe(3);
    });

    it('a Burglar brings one improvised pick a level: one slotless item, "Improvised picks (2)" at level 2', () => {
      const one = delve([['pim', 'burglar', 1]]);
      expect(kit(one, 'pim')).toMatchObject([{ kind: 'improvised', amount: 1, slots: 0, name: 'Improvised pick' }]);
      const two = delve([['pim', 'burglar', 2]]);
      expect(kit(two, 'pim')).toMatchObject([{ kind: 'improvised', amount: 2, slots: 0, name: 'Improvised picks (2)' }]);
    });

    it('each Pick attempt uses one up, whatever happens; same 2 slots; the last one goes and Pick is blocked', () => {
      const s = delve([['pim', 'burglar', 2]]);
      hero(s, 'pim').at = { ...NEXT_TO_DOOR };
      const pv = e.preview(s, 'pim', 'pick', { at: DOOR });
      expect(pv.slots).toBe(2);
      expect(pv.modifiers).toContain('Improvised pick: 2 slots, uses 1 of 2');
      // On 2 slots a pick opens or jams; either way one is used up. Then the locked chest at (17,1).
      const r1 = e.apply(s, pickCmd);
      expect(r1.error).toBeUndefined();
      expect(kit(r1.state, 'pim')).toMatchObject([{ amount: 1, name: 'Improvised pick' }]);
      expect(r1.events.some((x) => x.type === 'say' && /pim has 1 improvised pick left/.test(x.text))).toBe(true);
      const t = structuredClone(r1.state);
      hero(t, 'pim').acted = false;
      hero(t, 'pim').at = at(1, 16, 1);
      const r2 = e.apply(t, { ...pickCmd, target: { at: at(1, 17, 1) } } as Command);
      expect(r2.error).toBeUndefined();
      expect(kit(r2.state, 'pim')).toEqual([]);
      expect(r2.events.some((x) => x.type === 'say' && /last improvised pick is spent/.test(x.text))).toBe(true);
      const u = structuredClone(r2.state);
      hero(u, 'pim').acted = false;
      hero(u, 'pim').at = { ...NEXT_TO_DOOR };
      u.delve!.doors[posKey(DOOR)] = { ...u.delve!.doors[posKey(DOOR)]!, open: false, locked: true, jammed: false };
      expect(e.actions(u, 'pim').find((a) => a.action === 'pick')?.blocked).toMatch(/improvised picks are spent/);
    });

    it('crews by the same rule: the Ferrymen\'s Brecht 3 + 2 bought, the Wake\'s Spade 4 + 3, the Burglar sister 2 picks', () => {
      const s = delve([['brann', 'sellsword', 1]]);
      const own = (items: Item[] | undefined, kind: string) => items?.find((i) => i.kind === kind);
      const f = buildCrew(s as GameStateX, 'ferrymen', [at(2, 16, 4), at(2, 17, 4), at(2, 18, 4)]);
      const brecht = f.members.find((r) => r.cls === 'sapper')!;
      expect(own(brecht.pack, 'improvised-charge')).toMatchObject({ amount: 3, slots: 0 });
      expect(brecht.pack!.filter((i) => i.kind === 'charge')).toHaveLength(2);
      const wake = buildCrew(s as GameStateX, 'the-wake', [at(3, 3, 4), at(3, 4, 4), at(3, 3, 5), at(3, 5, 5)]);
      expect(own(wake.members.find((r) => r.cls === 'sapper')!.pack, 'improvised-charge')).toMatchObject({ amount: 4 });
      const sis = buildCrew(s as GameStateX, 'lantern-sisters', [at(1, 3, 6), at(1, 4, 6), at(1, 5, 6)]);
      const brisk = sis.members.find((r) => r.cls === 'burglar')!;
      expect(own(brisk.pack, 'improvised')).toMatchObject({ amount: 2, slots: 0, name: 'Improvised picks (2)' });
      expect(own(brisk.pack, 'lockpicks')).toBeDefined(); // her proper picks come first
    });

    it('a crew Burglar without lockpicks works her improvised picks, one used up a try', () => {
      const s = delve([['brann', 'sellsword', 1]]);
      const sis = buildCrew(s as GameStateX, 'lantern-sisters', [at(1, 18, 2), at(1, 18, 3), at(1, 16, 1)]);
      s.delve!.rivals = sis;
      const brisk = sis.members.find((r) => r.cls === 'burglar')!;
      brisk.pack = brisk.pack!.filter((i) => i.kind !== 'lockpicks');
      const c: Ctx = { w, s: s as GameStateX, d: s.delve as DelveX, ev: [] };
      crewWorkLock(c, brisk, at(1, 17, 1));
      expect(c.ev.some((x) => x.type === 'roll' && x.roll.slots === 2)).toBe(true);
      expect(brisk.pack!.find((i) => i.kind === 'improvised')).toMatchObject({ amount: 1, name: 'Improvised pick' });
    });

    it('old saves: a Burglar mid-delve with the old single pick, and a level 1 Sapper with 3 explosives, load and work', () => {
      const s = delve([['pim', 'burglar', 3], ['sam', 'sapper', 1]]);
      // The V3.7.1 to V4.0 shapes: one pick (amount 1) and 3 explosives whatever the level.
      hero(s, 'pim').pack = [{ id: 'old-pick', kind: 'improvised', name: 'Improvised pick', amount: 1, slots: 0 }];
      hero(s, 'sam').pack = [{ id: 'old-sat', kind: 'improvised-charge', name: 'Improvised explosives', amount: 3, slots: 0 }];
      const back = e.deserialize(e.serialize(s))!;
      expect(chargeCount(hero(back, 'sam'))).toBe(3); // kept to the end of this delve
      hero(back, 'pim').at = { ...NEXT_TO_DOOR };
      const r = e.apply(back, pickCmd);
      expect(r.error).toBeUndefined();
      expect(kit(r.state, 'pim')).toEqual([]);
      hero(back, 'sam').at = at(1, 16, 7);
      const t = e.actions(back, 'sam').find((a) => a.action === 'setCharge')!.targets[0]!;
      const r2 = e.apply(back, { type: 'act', heroId: 'sam', action: 'setCharge', target: t, focus: 0 });
      expect(r2.error).toBeUndefined();
      expect(kit(r2.state, 'sam')).toMatchObject([{ amount: 2, name: 'Improvised explosives' }]);
    });
  });
});
