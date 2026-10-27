// V4.1 (WS6, spec 31.8): arrows. The Ranger's quiver (class kit), plain and specialty bundles, the knife, Ilse's gift,
// crews' quivers and specialty shots, old saves.

import { describe, it, expect } from 'vitest';
import { createEngine } from './engine';
import { at, testCastle } from './test/testCastle';
import { oldLantern } from './test/light';
import { distance, posKey, samePos, type Pos } from './hex';
import type { ActionKind, ActionTarget, Command, GameEvent, GameState, HeroClass, ItemKind, Monster, MonsterKind } from './types';
import { ARROWS_PER_LEVEL, BARB_ROUNDS, BLAST_ARROW_DMG, CREWS, GLOW_ARROW_ROUNDS, KNIFE, MONSTERS, WHISTLE_NOISE, quiverPerDelve } from './data';
import { World, lightSources, litSet } from './world';
import type { Ctx, DelveX, GameStateX, MonsterX } from './state';
import { makeHero } from './camp';
import { isKit, makeItem, killHero } from './common';
import { buildCrew, hitMonster, rivalStats } from './rivals';
import { kitIntent, useKit } from './crewai';
import { arrowCount, plainArrows, quiverOf, spendCrewArrow } from './arrows';
import { heroSwings } from './stealth';

const e = createEngine(testCastle);
const w = new World(testCastle);

/** Rae the Ranger (level `lv`) and Brann in the pit hall of the test keep, lit by the old lantern, nothing else about. */
function delve(lv = 1, extra: [string, string, HeroClass, number][] = []): GameState {
  const s = e.newGame(1);
  s.campaign.roster.push(makeHero('rae', 'Rae', 'ranger', lv), makeHero('brann', 'Brann', 'sellsword'));
  for (const [id, name, cls, l] of extra) s.campaign.roster.push(makeHero(id, name, cls, l));
  const k = s.campaign.board[0]!;
  const r = e.apply(s, { type: 'startDelve', contractId: k.id, heroIds: ['rae', 'brann', ...extra.map((x) => x[0])], entrance: 0, packs: {} });
  expect(r.error).toBeUndefined();
  const t = r.state;
  t.delve!.monsters = [];
  t.delve!.rivals = null;
  t.delve!.traps = {};
  t.delve!.prisoner = null;
  hero(t, 'rae').at = at(1, 9, 7);
  hero(t, 'brann').at = at(1, 12, 8);
  for (const h of t.delve!.heroes) h.facing = undefined;
  oldLantern(t, 'rae');
  return t;
}

const hero = (s: GameState, id: string) => s.delve!.heroes.find((h) => h.heroId === id)!;
const quiver = (s: GameState, id = 'rae') => quiverOf(hero(s, id).pack);

function give(s: GameState, id: string, kind: ItemKind) {
  const it = makeItem({ s: s as GameStateX }, kind);
  hero(s, id).pack.push(it);
  return it;
}

function monster(s: GameState, kind: MonsterKind, p: Pos, awareness: Monster['awareness'] = 'hunting'): MonsterX {
  const def = MONSTERS[kind];
  const m: MonsterX = { id: `m${s.delve!.monsters.length + 1}`, kind, name: def.name, at: { ...p }, hp: def.hp, maxHp: def.hp, awareness, spawnedAt: { ...p } };
  if (awareness === 'hunting') m.noticedIds = s.delve!.heroes.map((h) => h.heroId);
  s.delve!.monsters.push(m);
  return m;
}

const ctx = (s: GameState): Ctx => ({ w, s: s as GameStateX, d: s.delve as DelveX, ev: [] as GameEvent[] });

function ok(s: GameState, cmd: Command) {
  const r = e.apply(s, cmd);
  expect(r.error).toBeUndefined();
  return r;
}
/** Focus = slots: every try a sure hit. */
const sure = (s: GameState, heroId: string, action: ActionKind, target: ActionTarget) => ok(s, { type: 'act', heroId, action, target, focus: e.preview(s, heroId, action, target).maxFocus });
const opt = (s: GameState, heroId: string, a: ActionKind) => e.actions(s, heroId).find((o) => o.action === a);

/** Try rng states until the command's events satisfy `want`. */
function until(s: GameState, cmd: Command, want: (ev: GameEvent[], st: GameState) => boolean) {
  for (let i = 1; i < 5000; i++) {
    const t = structuredClone(s);
    t.rng = (i * 2654435761) >>> 0;
    const r = e.apply(t, cmd);
    if (!r.error && want(r.events, r.state)) return r;
  }
  throw new Error('no rng state gave the wanted outcome');
}

const ORC_AT = at(1, 9, 3); // the pit hall, north of the pit, in Rae's bow reach

describe('V4.1 WS6 arrows (spec 31.8)', () => {
  describe('the quiver: the Ranger\'s own, 5 a level', () => {
    it('a fresh quiver each delve: 5 × level, slotless kit (never dropped or given)', () => {
      expect([1, 2, 3, 6].map(quiverPerDelve)).toEqual([5, 10, 15, 30]);
      expect(ARROWS_PER_LEVEL).toBe(5);
      for (const lv of [1, 2, 4]) {
        const s = delve(lv);
        expect(quiver(s)).toMatchObject({ kind: 'quiver', amount: 5 * lv, slots: 0, name: `Quiver (${5 * lv})` });
        expect(isKit(quiver(s)!)).toBe(true);
        expect(quiverOf(hero(s, 'brann').pack)).toBeUndefined(); // only bow classes
        expect(opt(s, 'rae', 'drop')?.targets.some((t) => t.itemId === quiver(s)!.id) ?? false).toBe(false);
        hero(s, 'brann').at = at(1, 10, 7);
        expect(opt(s, 'rae', 'give')?.targets.some((t) => t.itemId === quiver(s)!.id) ?? false).toBe(false);
      }
    });

    it('every attack uses one arrow: the quiver first, then bought plain arrows', () => {
      let s = delve(1);
      const m = monster(s, 'berserker', ORC_AT);
      m.hp = 99;
      const bought = give(s, 'rae', 'arrows');
      expect(bought).toMatchObject({ amount: 6, slots: 1, name: 'Plain arrows (6)' });
      for (let i = 0; i < 5; i++) {
        s = sure(s, 'rae', 'attack', { id: m.id }).state;
        hero(s, 'rae').acted = false;
      }
      expect(quiver(s)).toMatchObject({ amount: 0, name: 'Quiver (empty)' });
      expect(hero(s, 'rae').pack.find((i) => i.kind === 'arrows')!.amount).toBe(6);
      const r = sure(s, 'rae', 'attack', { id: m.id });
      expect(r.state.delve!.heroes.find((h) => h.heroId === 'rae')!.pack.find((i) => i.kind === 'arrows')!.amount).toBe(5);
      expect(r.state.delve!.log.join('\n')).not.toMatch(/out of arrows/);
    });

    it('knockback, hamstring and overwatch use one; a free swing with the bow uses one; overwatch spends when it fires', () => {
      let s = delve(2);
      const m = monster(s, 'berserker', ORC_AT);
      m.hp = 99;
      s = ok(s, { type: 'act', heroId: 'rae', action: 'hamstring', target: { id: m.id }, focus: 0 }).state;
      expect(quiver(s)!.amount).toBe(9);
      hero(s, 'rae').acted = false;
      s = ok(s, { type: 'act', heroId: 'rae', action: 'knockback', target: { id: m.id }, focus: 0 }).state;
      expect(quiver(s)!.amount).toBe(8);
      // Overwatch: nothing spent when set, one when it fires.
      let t = delve(2);
      const o = monster(t, 'orc', at(1, 10, 1));
      hero(t, 'rae').facing = undefined;
      t = ok(t, { type: 'act', heroId: 'rae', action: 'overwatch', target: {}, focus: 0 }).state;
      expect(quiver(t)!.amount).toBe(10);
      hero(t, 'rae').reactions = { overwatch: 'always' }; // V4.1 (spec 31.13): shoot without asking
      const r = ok(t, { type: 'endTurn' });
      expect(r.events.some((x) => x.type === 'cast' && x.spell === 'overwatch' && x.by === 'rae' && x.targetId === o.id)).toBe(true);
      expect(quiver(r.state)!.amount).toBe(9);
      // A free swing as an enemy steps out of reach.
      const u = delve(1);
      const g = monster(u, 'berserker', at(1, 10, 7));
      g.hp = 99;
      const c = ctx(u);
      expect(heroSwings(c, g.id, at(1, 10, 7), at(1, 11, 6))).toBe(false);
      expect(c.ev.some((x) => x.type === 'swing' && x.by === 'rae')).toBe(true);
      expect(quiverOf(hero(u, 'rae').pack)!.amount).toBe(4);
    });

    it('out of arrows: a knife (melee, 2 Finesse slots, 1 damage); bow-only shots are listed "Out of arrows"', () => {
      const s = delve(1);
      quiver(s)!.amount = 0;
      const far = monster(s, 'berserker', ORC_AT);
      expect(opt(s, 'rae', 'attack')).toBeUndefined(); // nothing in knife reach
      for (const a of ['knockback', 'hamstring', 'overwatch'] as const) expect(opt(s, 'rae', a)).toMatchObject({ blocked: 'Out of arrows' });
      expect(e.apply(s, { type: 'act', heroId: 'rae', action: 'hamstring', target: { id: far.id }, focus: 0 }).error).toBeDefined();
      const near = monster(s, 'berserker', at(1, 10, 7));
      near.hp = 99;
      expect(opt(s, 'rae', 'attack')!.targets.map((t) => t.id)).toEqual([near.id]);
      const pv = e.preview(s, 'rae', 'attack', { id: near.id });
      expect(pv).toMatchObject({ ok: true, slots: KNIFE.slots, stat: 'finesse' }); // it has noticed her: no sneak attack
      expect(pv.outcomes).toEqual(['Miss', '1 dmg', '3 dmg']);
      expect(pv.modifiers).toContain('Out of arrows: knife');
      const r = sure(s, 'rae', 'attack', { id: near.id });
      const hit = r.events.find((x) => x.type === 'hit' && x.attacker === 'rae');
      expect(hit).toBeDefined();
      // One bought specialty bundle: the bow is back (it shoots the specialty arrow), but plain shots still say why not.
      const t = delve(1);
      quiver(t)!.amount = 0;
      give(t, 'rae', 'barbarrows');
      monster(t, 'berserker', ORC_AT);
      expect(opt(t, 'rae', 'attack')!.targets.length).toBe(1);
      expect(opt(t, 'rae', 'hamstring')!.blocked).toMatch(/plain arrows/);
    });

    it('the quiver is bound to the hero: not dropped when they die, never on the cart', () => {
      const s = delve(1);
      const q = quiver(s)!;
      const c = ctx(s);
      killHero(c, hero(s, 'rae'));
      const lying = s.delve!.ground.flatMap((g) => g.items);
      expect(lying.some((i) => i.id === q.id)).toBe(false);
      // Carried out: the quiver doesn't reach the cart (a fresh one each delve).
      let t = delve(1);
      give(t, 'rae', 'arrows');
      for (const h of t.delve!.heroes) h.at = at(1, 2, 9);
      t = ok(t, { type: 'act', heroId: 'rae', action: 'leave', target: {}, focus: 0 }).state;
      t = ok(t, { type: 'act', heroId: 'brann', action: 'leave', target: {}, focus: 0 }).state;
      if (t.stage === 'delve') t = ok(t, { type: 'abandon' }).state;
      t = ok(t, { type: 'backToCamp' }).state;
      expect(t.campaign.stash.some((i) => i.kind === 'quiver')).toBe(false);
      expect(t.campaign.stash.filter((i) => i.kind === 'arrows')).toMatchObject([{ amount: 6 }]);
    });
  });

  describe('bought arrows', () => {
    it('Mott: plain arrows (10, a bundle of 6) and whistling (15, 3); Ilse, Gerda and the pair sell the rest', () => {
      const s = e.newGame(3);
      const shop = e.shop(s);
      const of = (k: string) => shop.find((o) => o.kind === k)!;
      expect(of('arrows')).toMatchObject({ price: 10, vendor: 'mott' });
      expect(of('arrows').locked).toBeUndefined();
      expect(of('whistlearrows')).toMatchObject({ price: 15, vendor: 'mott' });
      expect(of('glowarrows')).toMatchObject({ price: 20, vendor: 'ilse' });
      expect(of('glowarrows').locked).toMatch(/Ilse/);
      expect(of('firearrows')).toMatchObject({ price: 25, vendor: 'ilse' });
      expect(of('poisonarrows')).toMatchObject({ price: 30, vendor: 'ilse' });
      expect(of('barbarrows')).toMatchObject({ price: 25, vendor: 'gerda' });
      expect(of('ropearrow')).toMatchObject({ price: 30, vendor: 'gerda' });
      expect(of('blastarrows')).toMatchObject({ price: 40, vendor: 'gerda', needs: ['smith', 'alchemist'] });
      let t = ok(s, { type: 'buy', kind: 'arrows' }).state;
      t = ok(t, { type: 'buy', kind: 'whistlearrows' }).state;
      expect(t.campaign.stash.map((i) => [i.kind, i.amount, i.slots, i.name])).toEqual([['arrows', 6, 1, 'Plain arrows (6)'], ['whistlearrows', 3, 1, 'Whistling arrows (3)']]);
      expect(e.apply(t, { type: 'buy', kind: 'blastarrows' }).error).toMatch(/Gerda/);
      t.campaign.village.smith = true;
      t.campaign.village.alchemist = true;
      t.campaign.gold = 200;
      t = ok(t, { type: 'buy', kind: 'blastarrows' }).state;
      t = ok(t, { type: 'buy', kind: 'ropearrow' }).state;
      expect(t.campaign.stash.slice(-2).map((i) => [i.kind, i.amount, i.name])).toEqual([['blastarrows', 2, 'Blast arrows (2)'], ['ropearrow', 1, 'Rope arrow']]);
    });

    it('Ilse\'s gift adds a bundle of 3 glow arrows', () => {
      // (village.test.ts runs the story delve; here, the gift table.)
      const s = e.newGame(1);
      const c = { s: s as GameStateX };
      expect(makeItem(c, 'glowarrows')).toMatchObject({ amount: 3, name: 'Glow arrows (3)' });
    });
  });

  describe('specialty arrows', () => {
    it('the Attack picks the arrow (target.arrow): the roll panel names it; the bundle is spent, not the quiver', () => {
      const s = delve(1);
      const m = monster(s, 'berserker', ORC_AT);
      m.hp = 99;
      const fire = give(s, 'rae', 'firearrows');
      const plain = e.preview(s, 'rae', 'attack', { id: m.id });
      const pv = e.preview(s, 'rae', 'attack', { id: m.id, arrow: fire.id });
      expect(pv.modifiers).toContain('Fire arrow +1 dmg');
      expect(pv.outcomes[1]).toMatch(/the hex burns/);
      expect(Number(pv.outcomes[1]!.split(' ')[0])).toBe(Number(plain.outcomes[1]!.split(' ')[0]) + 1);
      expect(e.preview(s, 'rae', 'attack', { id: m.id, arrow: 'nope' }).ok).toBe(false);
      const r = sure(s, 'rae', 'attack', { id: m.id, arrow: fire.id });
      const rae = r.state.delve!.heroes.find((h) => h.heroId === 'rae')!;
      expect(rae.pack.find((i) => i.kind === 'firearrows')).toMatchObject({ amount: 2, name: 'Fire arrows (2)' });
      expect(quiverOf(rae.pack)!.amount).toBe(5);
      const hit = r.events.find((x) => x.type === 'hit' && x.attacker === 'rae') as Extract<GameEvent, { type: 'hit' }>;
      expect(hit.damage).toBe(Number(plain.outcomes[plain.slots]!.split(' ')[0]) + 1); // perfect + fire
      expect(r.state.delve!.burning[posKey(ORC_AT)]).toBe(2);
    });

    it('whistling: noise 6 where it lands, hit or miss; and Shoot at a hex in sight (range 6)', () => {
      const s = delve(1);
      const m = monster(s, 'berserker', ORC_AT);
      m.hp = 99;
      const wh = give(s, 'rae', 'whistlearrows');
      const r = until(s, { type: 'act', heroId: 'rae', action: 'attack', target: { id: m.id, arrow: wh.id }, focus: 0 }, (ev) => ev.some((x) => x.type === 'miss' && x.attacker === 'rae'));
      expect(r.events).toContainEqual({ type: 'noise', at: ORC_AT, radius: WHISTLE_NOISE });
      const t = delve(1);
      const w2 = give(t, 'rae', 'whistlearrows');
      const o = opt(t, 'rae', 'shoot')!;
      expect(o.pick).toBe('hex');
      const spot = o.targets.find((x) => x.itemId === w2.id && distance(x.at!, hero(t, 'rae').at) >= 4)!;
      expect(spot).toBeDefined();
      expect(o.targets.every((x) => distance(x.at!, hero(t, 'rae').at) <= 6)).toBe(true);
      const r2 = ok(t, { type: 'act', heroId: 'rae', action: 'shoot', target: { at: spot.at, itemId: w2.id }, focus: 0 });
      expect(r2.events).toContainEqual({ type: 'noise', at: spot.at, radius: WHISTLE_NOISE });
      expect(r2.state.delve!.heroes.find((h) => h.heroId === 'rae')!.pack.find((i) => i.kind === 'whistlearrows')!.amount).toBe(2);
      expect(quiverOf(r2.state.delve!.heroes.find((h) => h.heroId === 'rae')!.pack)!.amount).toBe(5);
    });

    it('glow: lights radius 2 on the creature it hits (moving with it), or where it lands; 8 rounds; the Gloam recoils', () => {
      const s = delve(1);
      const m = monster(s, 'berserker', ORC_AT);
      m.hp = 99;
      const g = give(s, 'rae', 'glowarrows');
      let t = sure(s, 'rae', 'attack', { id: m.id, arrow: g.id }).state;
      expect(t.delve!.glows).toMatchObject([{ on: m.id, rounds: GLOW_ARROW_ROUNDS }]);
      const d = t.delve as DelveX;
      expect(lightSources(d).find((L) => L.kind === 'arrow')).toMatchObject({ radius: 2, party: false, holder: m.id });
      d.monsters[0]!.at = at(1, 11, 1);
      expect(litSet(w, d).has(posKey(at(1, 12, 1)))).toBe(true);
      expect(e.lights!(t).some((L) => L.kind === 'arrow' && L.holder === m.id)).toBe(true);
      // Shot at a hex: lights it for 8 rounds, burning down a round a world phase.
      t = delve(1);
      const g2 = give(t, 'rae', 'glowarrows');
      const spot = opt(t, 'rae', 'shoot')!.targets.find((x) => x.itemId === g2.id && samePos(x.at!, at(1, 9, 2)))!;
      t = ok(t, { type: 'act', heroId: 'rae', action: 'shoot', target: spot, focus: 0 }).state;
      expect(t.delve!.glows).toMatchObject([{ at: at(1, 9, 2), rounds: GLOW_ARROW_ROUNDS }]);
      expect(t.delve!.glows![0]!.on).toBeUndefined();
      t = ok(t, { type: 'endTurn' }).state;
      expect(t.delve!.glows![0]!.rounds).toBe(GLOW_ARROW_ROUNDS - 1);
      for (let i = 0; i < GLOW_ARROW_ROUNDS - 1; i++) t = ok(t, { type: 'endTurn' }).state;
      expect(t.delve!.glows ?? []).toEqual([]);
    });

    it('poison: a hit poisons; barbed: a hit roots 2 rounds (no −20, unlike hamstring)', () => {
      const s = delve(1);
      const m = monster(s, 'berserker', ORC_AT);
      m.hp = 99;
      const p = give(s, 'rae', 'poisonarrows');
      const r = sure(s, 'rae', 'attack', { id: m.id, arrow: p.id });
      expect(r.state.delve!.monsters[0]!.poisoned).toBe(true);
      const t = delve(1);
      const m2 = monster(t, 'berserker', ORC_AT);
      m2.hp = 99;
      const b = give(t, 'rae', 'barbarrows');
      const plain = e.preview(t, 'rae', 'attack', { id: m2.id });
      const pv = e.preview(t, 'rae', 'attack', { id: m2.id, arrow: b.id });
      expect(pv.chance).toBe(plain.chance);
      expect(pv.outcomes[1]).toMatch(/rooted 2 rounds/);
      const r2 = sure(t, 'rae', 'attack', { id: m2.id, arrow: b.id });
      expect(r2.state.delve!.monsters[0]!.stuck).toBe(BARB_ROUNDS);
    });

    it('rope: shot at an edge beside the pit within 5 the party can see: a rope anchored there; climb down without walking over', () => {
      let s = delve(1);
      const ra = give(s, 'rae', 'ropearrow');
      hero(s, 'rae').at = at(1, 10, 7);
      const o = opt(s, 'rae', 'shoot')!;
      const edges = o.targets.filter((x) => x.itemId === ra.id);
      expect(edges.length).toBeGreaterThan(0);
      for (const x of edges) expect(distance(x.at!, hero(s, 'rae').at)).toBeLessThanOrEqual(5);
      const edge = edges.find((x) => distance(x.at!, at(1, 10, 3)) === 1)!;
      s = ok(s, { type: 'act', heroId: 'rae', action: 'shoot', target: edge, focus: 0 }).state;
      expect(s.delve!.ropes).toContain(posKey(edge.at!));
      expect(hero(s, 'rae').pack.some((i) => i.kind === 'ropearrow')).toBe(false); // one arrow, gone
      // Brann walks to that edge and climbs down: no rope of his own needed.
      hero(s, 'brann').at = { ...edge.at! };
      expect(opt(s, 'brann', 'climb')!.targets.length).toBeGreaterThan(0);
    });

    it('blast: 3 within 1 where it lands (no outer ring), noise 8, opens locks within 1 like a charge', () => {
      const s = delve(1);
      s.campaign.village.smith = true;
      s.campaign.village.alchemist = true;
      const b = give(s, 'rae', 'blastarrows');
      hero(s, 'rae').at = at(1, 9, 2);
      const spot = at(1, 12, 3); // next to the locked door (13, 3)
      const near = monster(s, 'berserker', at(1, 12, 2)); // within 1 of the spot
      const far = monster(s, 'berserker', at(1, 11, 1)); // 2 away: no outer ring
      near.hp = far.hp = 20;
      expect(distance(far.at, spot)).toBe(2);
      const door = at(1, 13, 3);
      const o = opt(s, 'rae', 'shoot')!;
      expect(o.targets.some((x) => x.itemId === b.id && samePos(x.at!, spot))).toBe(true);
      const pv = e.preview(s, 'rae', 'shoot', { at: spot, itemId: b.id });
      expect(pv.outcomes[0]).toMatch(/3 dmg within 1/);
      const r = ok(s, { type: 'act', heroId: 'rae', action: 'shoot', target: { at: spot, itemId: b.id }, focus: 0 });
      const d = r.state.delve!;
      expect(d.monsters.find((m) => m.id === near.id)!.hp).toBe(20 - BLAST_ARROW_DMG);
      expect(d.monsters.find((m) => m.id === far.id)!.hp).toBe(20);
      expect(d.doors[posKey(door)]).toMatchObject({ open: true, locked: false });
      expect(r.events.some((x) => x.type === 'noise' && x.radius === 8)).toBe(true);
      expect(r.events.some((x) => x.type === 'blast')).toBe(true);
      expect(d.blown.some((k) => k === posKey(spot))).toBe(false); // the floor stays whole
      expect(d.heroes.find((h) => h.heroId === 'rae')!.pack.find((i) => i.kind === 'blastarrows')).toMatchObject({ amount: 1, name: 'Blast arrow' });
    });
  });

  describe('crews (pillar 17)', () => {
    it('crew Rangers carry quivers by crew level and their crew\'s bundle: the Sisters glow, the Ferrymen barbed', () => {
      const s = delve(1);
      const sis = buildCrew(s as GameStateX, 'lantern-sisters', [at(1, 16, 2), at(1, 17, 2), at(1, 18, 2)]);
      const ran = sis.members.find((r) => r.cls === 'ranger')!;
      expect(quiverOf(ran.pack!)).toMatchObject({ amount: 5 * CREWS['lantern-sisters'].level, slots: 0 }); // V4.1 (WS7): by crew level
      expect(ran.pack!.find((i) => i.kind === 'glowarrows')).toMatchObject({ amount: 3 });
      expect(sis.members.filter((r) => r.cls !== 'ranger').every((r) => !quiverOf(r.pack!))).toBe(true);
      const fm = buildCrew(s as GameStateX, 'ferrymen', [at(2, 16, 4), at(2, 17, 4), at(2, 18, 4)]);
      const sil = fm.members.find((r) => r.cls === 'ranger')!;
      expect(quiverOf(sil.pack!)!.amount).toBe(5 * CREWS.ferrymen.level); // V4.1 (WS7): by crew level
      expect(sil.pack!.find((i) => i.kind === 'barbarrows')).toMatchObject({ amount: 3 });
      // Spent like a hero's: plain first, then the bundle; out of arrows, a knife.
      quiverOf(sil.pack!)!.amount = 1;
      expect(spendCrewArrow(sil)).toBe('quiver');
      expect(rivalStats(sil).range).toBeGreaterThan(1); // the barbed bundle still shoots
      expect(spendCrewArrow(sil)).toBe('barbarrows');
      sil.pack = sil.pack!.filter((i) => i.kind !== 'barbarrows');
      expect(arrowCount(sil.pack)).toBe(0);
      expect(rivalStats(sil)).toMatchObject({ range: 1, slots: KNIFE.slots, dmg: KNIFE.dmg });
    });

    it('a crew bow shot (at a monster too) uses an arrow', () => {
      const s = delve(1);
      const sis = buildCrew(s as GameStateX, 'lantern-sisters', [at(1, 9, 7), at(1, 1, 1), at(1, 1, 2)]);
      s.delve!.rivals = sis;
      const ran = sis.members[0]!;
      const m = monster(s, 'berserker', ORC_AT);
      m.hp = 99;
      hitMonster(ctx(s), ran, m.id);
      expect(plainArrows(ran.pack!)).toBe(5 * CREWS['lantern-sisters'].level - 1);
    });

    it('the Sisters\' Ranger looses a glow arrow at a hero in the dark, and it lights them (named in the log)', () => {
      const s = delve(1);
      // Rae stands in the dark across the pit hall; the lantern goes with Brann to the pantry.
      oldLantern(s, 'brann');
      hero(s, 'brann').at = at(1, 2, 2);
      hero(s, 'rae').at = at(1, 9, 2);
      const sis = buildCrew(s as GameStateX, 'lantern-sisters', [at(1, 11, 7), at(1, 4, 1), at(1, 5, 1)]);
      sis.stance = 'hostile';
      s.delve!.rivals = sis;
      const ran = sis.members[0]!;
      const c = ctx(s);
      const lit = litSet(w, c.d);
      // The Ranger's own light (radius 2) doesn't reach her: Rae stands unlit.
      expect(lit.has(posKey(at(1, 9, 2)))).toBe(false);
      const it = kitIntent(c, ran, null);
      expect(it).toMatchObject({ kind: 'arrow', item: 'glowarrows', targetId: 'rae' });
      expect(useKit(c, ran, it!)).toBe(true);
      expect(c.d.glows?.length).toBe(1);
      expect(ran.pack!.find((i) => i.kind === 'glowarrows')!.amount).toBe(2);
      expect(c.ev.some((x) => x.type === 'thrown' && x.by === ran.id && x.kind === 'glowarrows')).toBe(true);
      expect(c.d.log.join('\n')).toMatch(/looses a glow arrow at Rae/);
      expect(litSet(w, c.d).has(posKey(c.d.glows![0]!.at))).toBe(true);
      // Next round she's lit: no second glow arrow at her.
      expect(kitIntent(c, ran, null)?.kind).not.toBe('arrow');
    });

    it('the Ferrymen\'s Ranger shoots barbed arrows at a hero making off with the job\'s item', () => {
      const s = delve(1);
      const fm = buildCrew(s as GameStateX, 'ferrymen', [at(1, 9, 8), at(1, 1, 1), at(1, 1, 2)]);
      fm.stance = 'hostile';
      s.delve!.rivals = fm;
      const sil = fm.members.find((r) => r.cls === 'ranger')!;
      sil.at = at(1, 9, 8);
      hero(s, 'brann').at = at(1, 12, 3);
      hero(s, 'rae').at = at(1, 2, 2);
      hero(s, 'brann').pack.push({ id: 'hl', kind: 'heirloom', name: 'the Signet', amount: 60, slots: 2, contractId: 'k' });
      const c = ctx(s);
      const it = kitIntent(c, sil, null);
      expect(it).toMatchObject({ kind: 'arrow', item: 'barbarrows', targetId: 'brann' });
    });
  });

  describe('old saves', () => {
    it('a delve saved before arrows: the Ranger gets a fresh quiver on load (crew Rangers too); idempotent', () => {
      const s = delve(2);
      hero(s, 'rae').pack = hero(s, 'rae').pack.filter((i) => i.kind !== 'quiver');
      s.delve!.rivals = buildCrew(s as GameStateX, 'lantern-sisters', [at(1, 16, 2), at(1, 17, 2), at(1, 18, 2)]);
      s.delve!.rivals.members[0]!.pack = s.delve!.rivals.members[0]!.pack!.filter((i) => i.kind !== 'quiver');
      const back = e.deserialize(e.serialize(s))!;
      expect(quiverOf(back.delve!.heroes.find((h) => h.heroId === 'rae')!.pack)!.amount).toBe(10);
      expect(quiverOf(back.delve!.rivals!.members[0]!.pack!)!.amount).toBe(5 * CREWS['lantern-sisters'].level);
      quiverOf(back.delve!.heroes.find((h) => h.heroId === 'rae')!.pack)!.amount = 0;
      const again = e.deserialize(e.serialize(back))!;
      expect(quiverOf(again.delve!.heroes.find((h) => h.heroId === 'rae')!.pack)!.amount).toBe(0);
    });
  });
});
