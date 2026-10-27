// V4.1 WS1 and WS5 (spec 31.2, 31.3): gold and the first delve (bounties, unlocks pay no gold, gifts, starting gold,
// the dozing chapel guard), and Ilse and the village pairs (her story, her bench, Mott's restock, the pairs' wares,
// Dragonfire Porter, the greater potion, the hot supper, the Sapper's tripwire).

import { describe, it, expect } from 'vitest';
import { createEngine } from './engine';
import { at, testCastle } from './test/testCastle';
import { posKey, posNeighbors, samePos, type Pos } from './hex';
import type { CastleDef, Command, GameEvent, GameState, HeroClass, ItemKind, MonsterKind } from './types';
import { ALES, BOUNTY, MONSTERS, POTION_HEAL, SHIELD_PRICE, START_GOLD, STORIES, SUPPER_HEAL, TRIPWIRE_FUSE, pairHome } from './data';
import type { Ctx, DelveX, GameStateX, MonsterX } from './state';
import { World } from './world';
import { captiveBoard, makeHero, refreshCamp, storyAvailable } from './camp';
import { castle } from '../data/castle/index';
import { walk } from './ai';
import { crewWalk } from './crewmove';
import { buildCrew } from './rivals';
import { dragonSpecial } from './dragon';
import { blast } from './charges';
import { ventCheck } from './falls';
import { fireWard } from './village';

// The test castle with every story site (as engine.test's storyCastle), Ilse's included.
const storyCastle: CastleDef = {
  ...testCastle,
  spawns: testCastle.spawns.map((sp) => (sp.kind === 'orc' && !sp.name && !sp.patrol ? { ...sp, firstDelveAsleep: true } : sp)),
  contractSites: [
    ...testCastle.contractSites,
    { id: 'l1-story-chapel', kind: 'rescue', at: at(1, 16, 8), where: 'the chapel', story: 'surgeon' },
    { id: 'l1-story-kitchens', kind: 'rescue', at: at(1, 16, 9), where: 'the kitchens', story: 'innkeeper' },
    { id: 'l2-story-forge', kind: 'rescue', at: at(2, 16, 8), where: 'the forge', story: 'smith' },
    { id: 'l2-story-barracks', kind: 'recover', at: at(2, 16, 3), where: 'the barracks', story: 'copper' },
    { id: 'l3-recover-drain', kind: 'recover', at: at(3, 5, 5), where: 'the Drain' },
    { id: 'l2-story-archive', kind: 'rescue', at: at(2, 15, 8), where: 'the archive', story: 'alchemist' },
  ],
};
const e = createEngine(storyCastle);
const w = new World(storyCastle);

function ok(s: GameState, cmd: Command) {
  const r = e.apply(s, cmd);
  expect(r.error).toBeUndefined();
  return r;
}

function withParty(s: GameState, heroes: [string, HeroClass][] = [['brann', 'sellsword'], ['pim', 'burglar']]): GameState {
  for (const [id, cls] of heroes) s.campaign.roster.push(makeHero(id, id[0]!.toUpperCase() + id.slice(1), cls));
  return s;
}

/** Start the contract `k` with these heroes (monsters, crew and traps cleared). */
function go(s: GameState, contractId: string, heroIds: string[], packs: Record<string, string[]> = {}): GameState {
  const t = ok(s, { type: 'startDelve', contractId, heroIds, entrance: 1, packs }).state;
  t.delve!.monsters = [];
  t.delve!.rivals = null;
  t.delve!.traps = {};
  return t;
}

/** Finish the story contract `id` with `heroIds` (the first carries or escorts), back to camp. */
function finishStory(s: GameState, id: string, heroIds = ['keven']) {
  const k = s.campaign.board.find((x) => x.story === id)!;
  expect(k, `story ${id} on the board`).toBeTruthy();
  let t = go(s, k.id, heroIds);
  const lead = t.delve!.heroes[0]!;
  t.delve!.heroes.forEach((h) => (h.at = at(1, 18, 7)));
  if (k.kind === 'rescue') {
    const pr = t.delve!.prisoner!;
    Object.assign(pr, { freed: true, escortedBy: lead.heroId, at: at(1, 17, 7) });
    lead.escorting = pr.id;
  } else {
    const g = t.delve!.ground.find((x) => x.items.some((i) => i.contractId === k.id))!;
    lead.pack.push(...g.items.filter((i) => i.contractId === k.id));
    g.items = g.items.filter((i) => i.contractId !== k.id);
  }
  for (const h of [...t.delve!.heroes]) if (t.stage === 'delve') t = ok(t, { type: 'act', heroId: h.heroId, action: 'leave', target: {}, focus: 0 }).state;
  expect(t.summary!.contractDone).toBe(true);
  return ok(t, { type: 'backToCamp' });
}

function ctx(s: GameState): Ctx {
  return { w, s: s as GameStateX, d: s.delve as DelveX, ev: [] as GameEvent[] };
}

function give(s: GameState, id: string, kind: ItemKind): string {
  const h = s.delve!.heroes.find((x) => x.heroId === id)!;
  const it = { id: `t-${kind}-${h.pack.length}`, kind, name: kind, amount: 1, slots: 1 };
  h.pack.push(it);
  return it.id;
}

const hero = (s: GameState, id: string) => s.delve!.heroes.find((h) => h.heroId === id)!;

function monster(s: GameState, kind: MonsterKind, p: Pos, awareness: MonsterX['awareness'] = 'hunting'): MonsterX {
  const def = MONSTERS[kind];
  const m: MonsterX = { id: `x${s.delve!.monsters.length + 1}`, kind, name: def.name, at: { ...p }, hp: def.hp, maxHp: def.hp, awareness, spawnedAt: { ...p } };
  s.delve!.monsters.push(m);
  return m;
}

/** A delve on a regular contract with these heroes, for in-castle rules. */
function delveWith(heroes: [string, HeroClass][], village: Partial<GameState['campaign']['village']> = {}, seed = 3): GameState {
  const s = withParty(e.newGame(seed), heroes);
  Object.assign(s.campaign.village, village);
  const k = s.campaign.board.find((x) => !x.story)!;
  return go(s, k.id, heroes.map((x) => x[0]));
}

// ---------------------------------------------------------------- 31.2 gold and the first delve

describe('V4.1 WS1 (spec 31.2): gold and the first delve', () => {
  it('regular bounties are about 40% up: rescue 110/200/280, recover 140/250/340, slay 600', () => {
    expect(BOUNTY.rescue).toEqual([0, 110, 200, 280]);
    expect(BOUNTY.recover).toEqual([0, 140, 250, 340]);
    expect(BOUNTY.slay.slice(1)).toEqual([600, 600, 600]);
    const s = e.newGame(5);
    for (const k of s.campaign.board.filter((x) => !x.story)) expect(k.bounty).toBe(BOUNTY[k.kind][k.level]);
  });

  it('starts with 120 gold', () => {
    expect(START_GOLD).toBe(120);
    expect(e.newGame(9).campaign.gold).toBe(120);
  });

  it('story contracts pay 0 gold (still +1 reputation and XP); "Bring back" contracts pay 0', () => {
    let s = withParty(e.newGame(5));
    s.campaign.reputation = 2;
    Object.assign(s.campaign.village, { innkeeper: true, copper: true });
    refreshCamp(w, s as GameStateX);
    const gold = s.campaign.gold;
    const stories = s.campaign.board.filter((k) => k.story);
    expect(stories.length).toBeGreaterThan(1);
    expect(stories.every((k) => k.bounty === 0)).toBe(true);
    const r = finishStory(s, 'surgeon');
    expect(r.state.campaign.gold).toBe(gold);
    expect(r.state.campaign.reputation).toBe(3);
    // A captive's "Bring back".
    const t = r.state as GameStateX;
    t.campaign.captives.push({ hero: makeHero('h99', 'Corin', 'ranger'), crew: 'ferrymen', siteId: 'ferrymen-hideout', delve: 1 });
    const job = captiveBoard(w, t)[0]!;
    expect(job).toMatchObject({ title: 'Bring back Corin', bounty: 0 });
  });

  it('Aldric\'s gift: 2 potions on the cart, the first time he comes home', () => {
    const s = withParty(e.newGame(5));
    const r = finishStory(s, 'surgeon');
    expect(r.state.campaign.stash.filter((i) => i.kind === 'potion')).toHaveLength(2);
    expect(r.events.some((x) => x.type === 'say' && /two potions/.test(x.text))).toBe(true);
  });

  it('Wim\'s gift: every hero on the roster gets a free Hobart\'s Reserve for their next delve; one with an ale waiting keeps theirs', () => {
    let s = withParty(e.newGame(5));
    s.campaign.reputation = 1;
    s = finishStory(s, 'surgeon').state;
    s.campaign.roster.find((h) => h.id === 'pim')!.ale = 'featherfoot';
    const r = finishStory(s, 'innkeeper');
    expect(r.state.campaign.village.copper).toBe(false); // works before the copper is home: his last cask
    const ales = Object.fromEntries(r.state.campaign.roster.map((h) => [h.id, h.ale]));
    expect(ales).toMatchObject({ keven: 'reserve', brann: 'reserve', pim: 'featherfoot' });
    // Drunk on the next delve: Focus starts at 4.
    const t = ok(r.state, { type: 'startDelve', contractId: r.state.campaign.board.find((k) => !k.story)!.id, heroIds: ['keven', 'brann'], entrance: 1, packs: {} }).state;
    expect(hero(t, 'brann')).toMatchObject({ ale: 'reserve', focus: 4 });
    expect(t.campaign.roster.find((h) => h.id === 'brann')!.ale).toBeUndefined();
  });

  it('Gerda\'s gift: the next shield at the forge costs 0 (campaign.credits.shield), then shields cost 50 again', () => {
    let s = withParty(e.newGame(5));
    s.campaign.reputation = 1;
    refreshCamp(w, s as GameStateX);
    s = finishStory(s, 'smith').state;
    expect(s.campaign.credits?.shield).toBe(1);
    s.campaign.gold = 0;
    s = ok(s, { type: 'buyShield', heroId: 'brann' }).state;
    expect(s.campaign.roster.find((h) => h.id === 'brann')!.shield).toBe(true);
    expect(s.campaign.gold).toBe(0);
    expect(s.campaign.credits?.shield).toBe(0);
    expect(e.apply(s, { type: 'buyShield', heroId: 'pim' }).error).toBe('Not enough gold.');
    s.campaign.gold = 60;
    s = ok(s, { type: 'buyShield', heroId: 'pim' }).state;
    expect(s.campaign.gold).toBe(60 - SHIELD_PRICE);
  });

  it('Ilse\'s gift: 2 antidotes and 3 glow arrows (V4.1 WS6) on the cart; no gift a second time', () => {
    const fresh = withParty(e.newGame(5));
    fresh.campaign.reputation = 1;
    let t = finishStory(fresh, 'surgeon').state; // Aldric home, reputation 2: Ilse goes up
    const before = t.campaign.stash.length;
    const r = finishStory(t, 'alchemist');
    expect(r.state.campaign.stash.filter((i) => i.kind === 'antidote')).toHaveLength(2);
    expect(r.state.campaign.stash.length).toBe(before + 3);
    // V4.1 (WS6, spec 31.8): one bundle of 3 glow arrows.
    expect(r.state.campaign.stash.filter((i) => i.kind === 'glowarrows')).toMatchObject([{ amount: 3, slots: 1, name: 'Glow arrows (3)' }]);
    expect(r.events.some((x) => x.type === 'say' && /two antidotes and three glow arrows/.test(x.text))).toBe(true);
    // Done again (a stale board copy): no village change, no second gift.
    t = structuredClone(r.state);
    t.campaign.board.push({ id: 'story-alchemist', kind: 'rescue', title: 'Rescue Ilse the alchemist', brief: '', siteId: 'l2-story-archive', level: 2, bounty: 0, warnings: [], story: 'alchemist' });
    const again = finishStory(t, 'alchemist');
    expect(again.state.campaign.stash.filter((i) => i.kind === 'antidote')).toHaveLength(2);
    expect(again.state.campaign.stash.filter((i) => i.kind === 'glowarrows')).toHaveLength(1);
  });

  it('the copper and the cask book bring no gift', () => {
    let s = withParty(e.newGame(5));
    s.campaign.reputation = 2;
    Object.assign(s.campaign.village, { surgeon: true, innkeeper: true, smith: true, alchemist: true });
    refreshCamp(w, s as GameStateX); // the board with the copper on it
    s = finishStory(s, 'copper').state;
    expect(s.campaign.village.copper).toBe(true);
    expect(s.campaign.stash).toEqual([]);
    const r = finishStory(s, 'caskbook');
    expect(r.state.campaign.village.caskbook).toBe(true);
    expect(r.state.campaign.stash).toEqual([]);
    expect(r.state.campaign.roster.every((h) => !h.ale)).toBe(true);
  });

  it('B1: on the first delve the chapel guard (firstDelveAsleep) dozes; on later delves it is up as placed', () => {
    const s = withParty(e.newGame(5));
    const marked = storyCastle.spawns.map((sp, i) => [sp, i] as const).filter(([sp]) => sp.firstDelveAsleep);
    expect(marked.length).toBeGreaterThan(0);
    const first = ok(s, { type: 'startDelve', contractId: s.campaign.board[0]!.id, heroIds: ['keven'], entrance: 1, packs: {} }).state;
    for (const [, i] of marked) expect(first.delve!.monsters.find((m) => m.id === `m${i + 1}`)!.awareness).toBe('asleep');
    // Others as placed (the patrol still walks).
    expect(first.delve!.monsters.some((m) => m.awareness === 'patrol')).toBe(true);
    const later = structuredClone(s);
    later.campaign.delveCount = 1;
    const second = ok(later, { type: 'startDelve', contractId: later.campaign.board[0]!.id, heroIds: ['keven'], entrance: 1, packs: {} }).state;
    for (const [, i] of marked) expect(second.delve!.monsters.find((m) => m.id === `m${i + 1}`)!.awareness).not.toBe('asleep');
  });

  it('B1 in the real castle: only the chapel orc by Aldric is marked', () => {
    const marked = castle.spawns.filter((sp) => sp.firstDelveAsleep);
    expect(marked).toHaveLength(1);
    expect(marked[0]).toMatchObject({ kind: 'orc', at: { level: 1 } });
    const aldric = castle.contractSites.find((x) => x.story === 'surgeon')!;
    const rw = new World(castle);
    expect(rw.roomName(marked[0]!.at)).toBe(rw.roomName(aldric.at));
  });
});

// ---------------------------------------------------------------- 31.3 Ilse and the pairs

describe('V4.1 WS5 (spec 31.3): Ilse and the village pairs', () => {
  const ilse = STORIES.find((x) => x.id === 'alchemist')!;

  it('Ilse: a Level 2 rescue in the archive, on the board once Aldric is home and reputation is 1; unlocks village.alchemist', () => {
    expect(ilse).toMatchObject({ kind: 'rescue', siteId: 'l2-story-archive', subject: 'Ilse the alchemist' });
    const site = castle.contractSites.find((x) => x.id === 'l2-story-archive')!;
    expect(site).toMatchObject({ kind: 'rescue', story: 'alchemist', at: { level: 2 } });
    const spider = castle.spawns.find((sp) => sp.kind === 'spider' && sp.at.level === 2)!;
    expect(posNeighbors(spider.at).some((p) => samePos(p, site.at))).toBe(true); // next to the spider
    const s = e.newGame(5);
    expect(storyAvailable(s, ilse)).toBe(false);
    s.campaign.reputation = 1;
    expect(storyAvailable(s, ilse)).toBe(false); // Aldric not home
    s.campaign.village.surgeon = true;
    s.campaign.reputation = 0;
    expect(storyAvailable(s, ilse)).toBe(false); // reputation 0
    s.campaign.reputation = 1;
    expect(storyAvailable(s, ilse)).toBe(true);
    let t = withParty(e.newGame(5));
    t.campaign.reputation = 1;
    t = finishStory(t, 'surgeon').state;
    const k = t.campaign.board.find((x) => x.story === 'alchemist')!;
    expect(k).toMatchObject({ kind: 'rescue', level: 2, bounty: 0, title: 'Rescue Ilse the alchemist' });
    const r = finishStory(t, 'alchemist');
    expect(r.state.campaign.village.alchemist).toBe(true);
    expect(r.events).toContainEqual({ type: 'villageUnlocked', story: 'alchemist' });
    expect(r.state.campaign.board.some((x) => x.story === 'alchemist')).toBe(false);
    expect(r.state.campaign.roster.some((h) => h.name.startsWith('Ilse'))).toBe(false);
  });

  it('old saves without the alchemist flag load as not home', () => {
    const s = e.newGame(5);
    delete (s.campaign.village as Partial<typeof s.campaign.village>).alchemist;
    const t = e.deserialize(e.serialize(s))!;
    expect(t.campaign.village.alchemist).toBe(false);
  });

  it('Mott: blasting charge 45; no night-eye draught; sleep dart, venom dart, smoke, glue and oil need Ilse', () => {
    const s = e.newGame(5);
    s.campaign.gold = 500;
    const shop = e.shop(s);
    expect(shop.find((o) => o.kind === 'charge')).toMatchObject({ price: 45, vendor: 'mott' });
    expect(shop.some((o) => o.kind === 'nightsight')).toBe(false);
    for (const k of ['dart', 'venomdart', 'smoke', 'glue', 'oil'] as const) {
      const o = shop.find((x) => x.kind === k)!;
      expect(o.locked, k).toMatch(/Ilse the alchemist/);
      expect(e.apply(s, { type: 'buy', kind: k }).error).toBe(o.locked);
    }
    for (const k of ['torch', 'potion', 'antidote', 'rope', 'firecracker', 'charge'] as const) expect(shop.find((x) => x.kind === k)!.locked, k).toBeUndefined();
    s.campaign.village.alchemist = true;
    const after = e.shop(s);
    for (const k of ['dart', 'venomdart', 'smoke', 'glue', 'oil'] as const) expect(after.find((x) => x.kind === k), k).toMatchObject({ vendor: 'ilse' });
    expect(after.filter((o) => ['dart', 'venomdart', 'smoke', 'glue', 'oil'].includes(o.kind)).every((o) => !o.locked)).toBe(true);
    const r = ok(s, { type: 'buy', kind: 'smoke' }).state;
    expect(r.campaign.stash.map((i) => i.kind)).toEqual(['smoke']);
  });

  it('pairHome: both flags, and tolerant of old villages', () => {
    expect(pairHome({ surgeon: true, alchemist: true }, 'surgeon', 'alchemist')).toBe(true);
    expect(pairHome({ surgeon: true }, 'surgeon', 'alchemist')).toBe(false);
    expect(pairHome(undefined, 'smith', 'surgeon')).toBe(false);
  });

  it('Wim + Ilse: Night-eye Stout 25, Spider-milk Stout 20, Dragonfire Porter 25, poured once both are home (no copper needed)', () => {
    const want = { nighteye: 25, spidermilk: 20, dragonfire: 25 };
    for (const [k, p] of Object.entries(want)) expect(ALES.find((a) => a.kind === k)).toMatchObject({ price: p, needs: 'alchemist' });
    let s = withParty(e.newGame(5));
    const locked = (st: GameState) => Object.fromEntries(e.ales(st).filter((a) => a.kind in want).map((a) => [a.kind, !!a.locked]));
    expect(Object.values(locked(s)).every(Boolean)).toBe(true);
    s.campaign.village.innkeeper = true;
    expect(Object.values(locked(s)).every(Boolean)).toBe(true);
    expect(e.apply(s, { type: 'buyAle', heroId: 'brann', ale: 'dragonfire' }).error).toMatch(/Ilse/);
    s.campaign.village.alchemist = true;
    expect(Object.values(locked(s)).every((x) => !x)).toBe(true);
    expect(e.ales(s).find((a) => a.kind === 'glowworm')!.locked).toMatch(/copper/); // the copper's ales still need it
    s = ok(s, { type: 'buyAle', heroId: 'brann', ale: 'dragonfire' }).state;
    expect(s.campaign.gold).toBe(120 - 25);
    const t = ok(s, { type: 'startDelve', contractId: s.campaign.board[0]!.id, heroIds: ['brann'], entrance: 1, packs: {} }).state;
    expect(hero(t, 'brann').ale).toBe('dragonfire');
    // Night-eye and Spider-milk: the ale is drunk and carried as its effect name (their rules are WS2's and WS3's).
    s.campaign.roster.find((h) => h.id === 'pim')!.ale = undefined;
    const u = ok(s, { type: 'buyAle', heroId: 'pim', ale: 'nighteye' }).state;
    const v = ok(u, { type: 'startDelve', contractId: u.campaign.board[0]!.id, heroIds: ['pim'], entrance: 1, packs: {} }).state;
    expect(hero(v, 'pim').ale).toBe('nighteye');
  });

  it('Gerda + Ilse: the blasting charge at Gerda for 30', () => {
    const s = e.newGame(5);
    s.campaign.village.smith = true;
    expect(e.shop(s).find((o) => o.kind === 'charge')).toMatchObject({ price: 45, vendor: 'mott' });
    s.campaign.village.alchemist = true;
    expect(e.shop(s).find((o) => o.kind === 'charge')).toMatchObject({ price: 30, vendor: 'gerda' });
    const r = ok(s, { type: 'buy', kind: 'charge' }).state;
    expect(r.campaign.gold).toBe(120 - 30);
  });

  it('Aldric + Ilse: the greater potion (35) and the antidote at 12', () => {
    const s = e.newGame(5);
    expect(e.shop(s).find((o) => o.kind === 'greaterpotion')!.locked).toMatch(/Brother Aldric and Ilse/);
    expect(e.shop(s).find((o) => o.kind === 'antidote')).toMatchObject({ price: 20, vendor: 'mott' });
    s.campaign.village.surgeon = true;
    expect(e.shop(s).find((o) => o.kind === 'greaterpotion')!.locked).toMatch(/Still away: Ilse/);
    s.campaign.village.alchemist = true;
    expect(e.shop(s).find((o) => o.kind === 'greaterpotion')).toMatchObject({ price: 35 });
    expect(e.shop(s).find((o) => o.kind === 'greaterpotion')!.locked).toBeUndefined();
    expect(e.shop(s).find((o) => o.kind === 'antidote')).toMatchObject({ price: 12, vendor: 'aldric' });
    let t = ok(s, { type: 'buy', kind: 'greaterpotion' }).state;
    t = ok(t, { type: 'buy', kind: 'antidote' }).state;
    expect(t.campaign.gold).toBe(120 - 35 - 12);
    expect(t.campaign.stash.map((i) => i.kind)).toEqual(['greaterpotion', 'antidote']);
  });

  it('greater potion: through Potion it heals an active hero 8 (a plain one 5), self or adjacent; a downed hero gets up at 8', () => {
    expect(POTION_HEAL).toEqual({ potion: 5, greaterpotion: 8 });
    const s = delveWith([['brann', 'sellsword'], ['pim', 'burglar']]);
    hero(s, 'brann').at = at(1, 4, 7);
    hero(s, 'pim').at = at(1, 5, 7);
    hero(s, 'brann').hp = 1;
    const gp = give(s, 'pim', 'greaterpotion');
    const plain = give(s, 'pim', 'potion');
    const o = e.actions(s, 'pim').find((a) => a.action === 'potion')!;
    expect(o.targets.filter((t) => t.id === 'brann').map((t) => t.itemId).sort()).toEqual([gp, plain].sort());
    expect(e.preview(s, 'pim', 'potion', { id: 'brann', itemId: gp }).outcomes[0]).toBe('Heal 8');
    expect(e.preview(s, 'pim', 'potion', { id: 'brann', itemId: plain }).outcomes[0]).toBe('Heal 5');
    const r = ok(s, { type: 'act', heroId: 'pim', action: 'potion', target: { id: 'brann', itemId: gp }, focus: 0 }).state;
    expect(hero(r, 'brann').hp).toBe(9);
    expect(hero(r, 'pim').pack.filter((i) => i.slots > 0).map((i) => i.kind)).toEqual(['potion']);
    // Capped at max HP.
    const s2 = delveWith([['brann', 'sellsword']]);
    hero(s2, 'brann').hp = 6;
    const g2 = give(s2, 'brann', 'greaterpotion');
    expect(hero(ok(s2, { type: 'act', heroId: 'brann', action: 'potion', target: { id: 'brann', itemId: g2 }, focus: 0 }).state, 'brann').hp).toBe(10);
    // Downed: up at 8 (minimal change to the old revive-by-potion path; WS3 rewrites downed).
    const s3 = delveWith([['brann', 'sellsword'], ['pim', 'burglar']]);
    hero(s3, 'brann').at = at(1, 4, 7);
    hero(s3, 'pim').at = at(1, 5, 7);
    Object.assign(hero(s3, 'brann'), { status: 'downed', hp: 0, bleed: 2 });
    const g3 = give(s3, 'pim', 'greaterpotion');
    const r3 = ok(s3, { type: 'act', heroId: 'pim', action: 'potion', target: { id: 'brann', itemId: g3 }, focus: 0 }).state;
    expect(hero(r3, 'brann')).toMatchObject({ status: 'active', hp: 8 });
  });

  it('greater potion in camp: drink heals 8 when there is no plain potion', () => {
    const s = withParty(e.newGame(5));
    s.campaign.stash.push({ id: 'gp', kind: 'greaterpotion', name: 'Greater potion', amount: 1, slots: 1 });
    s.campaign.roster.find((h) => h.id === 'brann')!.hp = 1;
    const r = ok(s, { type: 'drink', heroId: 'brann' }).state;
    expect(r.campaign.roster.find((h) => h.id === 'brann')!.hp).toBe(9);
  });

  it('Aldric + Wim: the hot supper: heroes who get out heal 2 on return (not those left in, not above max)', () => {
    const run = (village: Partial<GameState['campaign']['village']>) => {
      const s = withParty(e.newGame(5));
      Object.assign(s.campaign.village, village);
      for (const h of s.campaign.roster) h.hp = Math.max(1, h.maxHp - 3);
      s.campaign.roster.find((h) => h.id === 'pim')!.hp = s.campaign.roster.find((h) => h.id === 'pim')!.maxHp - 1;
      let t = go(s, s.campaign.board.find((k) => !k.story)!.id, ['keven', 'brann', 'pim']);
      for (const id of ['keven', 'brann', 'pim']) hero(t, id).at = at(1, 18, 7);
      t = ok(t, { type: 'act', heroId: 'keven', action: 'leave', target: {}, focus: 0 }).state;
      t = ok(t, { type: 'act', heroId: 'brann', action: 'leave', target: {}, focus: 0 }).state;
      t = ok(t, { type: 'act', heroId: 'pim', action: 'leave', target: {}, focus: 0 }).state;
      const r = ok(t, { type: 'backToCamp' });
      return { hp: Object.fromEntries(r.state.campaign.roster.map((h) => [h.id, [h.hp, h.maxHp]])), events: r.events };
    };
    const without = run({ surgeon: true });
    const withSupper = run({ surgeon: true, innkeeper: true });
    expect(withSupper.hp.brann![0]).toBe(without.hp.brann![0]! + SUPPER_HEAL);
    expect(withSupper.hp.keven![0]).toBe(without.hp.keven![0]! + SUPPER_HEAL);
    expect(withSupper.hp.pim![0]).toBe(withSupper.hp.pim![1]); // capped at max
    expect(withSupper.events.some((x) => x.type === 'say' && /hot supper/.test(x.text))).toBe(true);
    expect(without.events.some((x) => x.type === 'say' && /hot supper/.test(x.text))).toBe(false);
  });

  it('Dragonfire Porter: fire, burning, breath and blasts do 2 less to the drinker (to 0); others take it in full', () => {
    const s = delveWith([['brann', 'sellsword'], ['pim', 'burglar']]);
    hero(s, 'brann').ale = 'dragonfire';
    const c = ctx(s);
    expect(fireWard(c, 'brann', 4)).toBe(2);
    expect(fireWard(c, 'brann', 1)).toBe(0);
    expect(fireWard(c, 'pim', 4)).toBe(4);
    // Burning hexes: 1 a world phase, nothing for the drinker.
    const b = hero(s, 'brann');
    const p = hero(s, 'pim');
    b.at = at(1, 4, 6);
    p.at = at(1, 6, 6);
    const hpB = b.hp;
    const hpP = p.hp;
    s.delve!.burning = { [posKey(b.at)]: 2, [posKey(p.at)]: 2 };
    const r = ok(s, { type: 'endTurn' }).state;
    expect(hero(r, 'brann').hp).toBe(hpB);
    expect(hero(r, 'pim').hp).toBe(hpP - 1);
  });

  it('Dragonfire Porter: a blast within 1 (4) does 2; the Dragon\'s breath (4) does 2; a vent (3) does 1', () => {
    const s = delveWith([['brann', 'sellsword'], ['pim', 'burglar']]);
    hero(s, 'brann').ale = 'dragonfire';
    const c = ctx(s);
    const b = hero(s, 'brann');
    const p = hero(s, 'pim');
    b.at = at(1, 3, 7);
    p.at = at(1, 5, 7);
    blast(c, at(1, 4, 7), 'outsider');
    expect(b.hp).toBe(10 - 2);
    expect(p.hp).toBe(7 - 4 < 0 ? 0 : 7 - 4);
    // Breath.
    const s2 = delveWith([['brann', 'sellsword'], ['pim', 'burglar']]);
    hero(s2, 'brann').ale = 'dragonfire';
    const c2 = ctx(s2);
    const dragon = monster(s2, 'dragon', at(3, 16, 4));
    const hexes = [at(1, 4, 7), at(1, 6, 7)];
    hero(s2, 'brann').at = hexes[0]!;
    hero(s2, 'pim').at = hexes[1]!;
    dragonSpecial(c2, dragon, { kind: 'breath', hexes, targetId: 'brann', to: dragon.at });
    expect(hero(s2, 'brann').hp).toBe(10 - 2);
    expect(hero(s2, 'pim').hp).toBe(7 - 4);
    // A vent on Level 3 of the test castle (15, 2).
    const s3 = delveWith([['brann', 'sellsword']]);
    hero(s3, 'brann').ale = 'dragonfire';
    hero(s3, 'brann').at = at(3, 15, 2);
    ventCheck(ctx(s3), hero(s3, 'brann'));
    expect(hero(s3, 'brann').hp).toBe(10 - 1);
  });

  describe('Gerda + Ilse: the Sapper\'s tripwire', () => {
    const sapperDelve = (village = { smith: true, alchemist: true }) => {
      const s = delveWith([['sam', 'sapper'], ['brann', 'sellsword']], village);
      hero(s, 'sam').at = at(1, 3, 7);
      hero(s, 'brann').at = at(1, 2, 8);
      return s;
    };

    it('offered to a Sapper with charges once Gerda and Ilse are home, on a free floor hex next to them', () => {
      expect(e.actions(sapperDelve({ smith: true, alchemist: false } as never), 'sam').some((a) => a.action === 'setTripwire')).toBe(false);
      const s = sapperDelve();
      const o = e.actions(s, 'sam').find((a) => a.action === 'setTripwire')!;
      expect(o).toBeTruthy();
      expect(o.targets.length).toBeGreaterThan(0);
      expect(e.actions(s, 'brann').some((a) => a.action === 'setTripwire')).toBe(false);
      hero(s, 'sam').pack = []; // no charges
      expect(e.actions(s, 'sam').some((a) => a.action === 'setTripwire')).toBe(false);
    });

    it('sets a fuse marked tripwire (uses a charge); it goes off with its fuse like any charge', () => {
      let s = sapperDelve();
      const spot = at(1, 4, 6);
      s = ok(s, { type: 'act', heroId: 'sam', action: 'setTripwire', target: { at: spot }, focus: 0 }).state;
      expect(s.delve!.fuses).toMatchObject([{ at: spot, rounds: TRIPWIRE_FUSE, by: 'sam', tripwire: true }]);
      expect(hero(s, 'sam').pack.some((i) => i.kind === 'improvised-charge')).toBe(false); // level 1: its one explosive
      for (let i = 0; i < TRIPWIRE_FUSE; i++) {
        hero(s, 'sam').at = at(1, 16, 1);
        hero(s, 'brann').at = at(1, 17, 1);
        s = ok(s, { type: 'endTurn' }).state;
      }
      expect(s.delve!.fuses ?? []).toEqual([]);
    });

    it('a monster stepping next to it sets it off at once: the walk stops there and the blast hits it', () => {
      const s = sapperDelve();
      const c = ctx(s);
      const spot = at(1, 4, 3);
      s.delve!.fuses = [{ at: spot, rounds: 3, by: 'sam', tripwire: true }];
      const orc = monster(s, 'orc', at(1, 6, 1));
      const path = [at(1, 5, 1), at(1, 5, 2), at(1, 4, 2), at(1, 3, 2)];
      const stopped = walk(c, orc.id, orc, path);
      expect(stopped).toBe(true);
      // It got as far as the first step within 1 of the charge (then the blast threw it back a hex).
      const moved = c.ev.filter((x): x is Extract<GameEvent, { type: 'moved' }> => x.type === 'moved' && x.id === orc.id);
      expect(moved.at(-1)!.path.at(-1)).toEqual(at(1, 5, 2));
      expect(s.delve!.fuses).toEqual([]);
      expect(c.ev.some((x) => x.type === 'blast')).toBe(true);
      expect(orc.hp).toBeLessThan(orc.maxHp);
    });

    it('a crew member stepping next to it sets it off too; heroes and the Gloam don\'t', () => {
      const s = sapperDelve();
      const c = ctx(s);
      const spot = at(1, 4, 3);
      s.delve!.fuses = [{ at: spot, rounds: 3, by: 'sam', tripwire: true }];
      s.delve!.rivals = buildCrew(s as GameStateX, 'lantern-sisters', [at(1, 9, 1), at(1, 10, 1), at(1, 11, 1)]);
      // A hero walking past: nothing.
      hero(s, 'brann').at = at(1, 6, 3);
      const t = ok(s, { type: 'move', heroId: 'brann', path: [at(1, 5, 3)], sneak: false }).state;
      expect(t.delve!.fuses).toHaveLength(1);
      // The Gloam drifting past: nothing.
      const gloam = monster(s, 'orc', at(1, 6, 2));
      gloam.kind = 'gloam' as MonsterKind;
      walk(c, gloam.id, gloam, [at(1, 5, 2)]);
      expect(s.delve!.fuses).toHaveLength(1);
      // A crew member: boom.
      const r = s.delve!.rivals!.members[0]!;
      r.at = at(1, 6, 3);
      crewWalk(c, r, [at(1, 5, 3)]);
      expect(s.delve!.fuses).toEqual([]);
      expect(c.ev.some((x) => x.type === 'blast')).toBe(true);
    });
  });
});
