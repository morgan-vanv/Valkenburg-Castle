// V4.1 squads (spec 31.12, owner 2026-10-27): starting gold 70, three party slots with the fourth won by bringing the
// muster roll home, contract XP as a pot of 8 shared by the survivors, and crews as big as the party that set out.

import { describe, it, expect } from 'vitest';
import { createEngine } from './engine';
import { at, testCastle } from './test/testCastle';
import type { CastleDef, Command, GameState, HeroClass } from './types';
import {
  CONTRACT_XP_POT, CREWS, GIFTS, MUSTER_REP, SQUAD_SLOTS_MAX, SQUAD_SLOTS_START, START_GOLD, STORIES, contractXpEach, crewLineup, crewSize, squadSlots,
} from './data';
import type { DelveX, GameStateX } from './state';
import { World } from './world';
import { makeHero, refreshCamp, storyAvailable } from './camp';
import { buildCrew, makeCrew } from './rivals';
import type { CrewId } from './types';

// The test castle with the muster roll's site (the real castle's is the officers' quarters, L2 (10, 1)).
const storyCastle: CastleDef = {
  ...testCastle,
  contractSites: [...testCastle.contractSites, { id: 'l2-story-officers', kind: 'recover', at: at(2, 17, 8), where: "the officers' quarters", story: 'muster' }],
};
const e = createEngine(storyCastle);
const w = new World(storyCastle);
const MUSTER = STORIES.find((s) => s.id === 'muster')!;

function ok(s: GameState, cmd: Command) {
  const r = e.apply(s, cmd);
  expect(r.error).toBeUndefined();
  return r;
}

function withParty(s: GameState, heroes: [string, HeroClass][] = [['brann', 'sellsword'], ['pim', 'burglar'], ['aldous', 'pyromancer']]): GameState {
  for (const [id, cls] of heroes) s.campaign.roster.push(makeHero(id, id[0]!.toUpperCase() + id.slice(1), cls));
  return s;
}

/** Carry the contract's item (or the captive) out with `heroIds`; back to camp. */
function finish(s: GameState, contractId: string, heroIds: string[]) {
  let t = ok(s, { type: 'startDelve', contractId, heroIds, entrance: 1, packs: {} }).state;
  t.delve!.monsters = [];
  t.delve!.rivals = null;
  t.delve!.traps = {};
  const k = t.delve!.contract;
  heroIds.forEach((id, i) => (t.delve!.heroes.find((h) => h.heroId === id)!.at = i === 0 ? at(1, 18, 7) : at(1, 18 - i, 7)));
  const first = t.delve!.heroes.find((h) => h.heroId === heroIds[0])!;
  if (k.kind === 'recover') {
    const g = t.delve!.ground.find((x) => x.items.some((i) => i.contractId === k.id))!;
    first.pack.push(...g.items.filter((i) => i.contractId === k.id));
    g.items = g.items.filter((i) => i.contractId !== k.id);
  } else {
    const pr = t.delve!.prisoner!;
    pr.freed = true;
    pr.escortedBy = heroIds[0];
    pr.at = at(1, 17, 6);
    first.escorting = pr.id;
  }
  for (const id of heroIds) {
    const h = t.delve!.heroes.find((x) => x.heroId === id)!;
    h.at = at(1, 18, 7);
    t = ok(t, { type: 'act', heroId: id, action: 'leave', target: {}, focus: 0 }).state;
    if (t.stage !== 'delve') break;
  }
  expect(t.stage).toBe('summary');
  return t;
}

describe('V4.1 squads (spec 31.12): starting gold', () => {
  it('starts with 70: one level-1 hire (60) and a torch, or items for Keven alone', () => {
    expect(START_GOLD).toBe(70);
    const s = e.newGame(3);
    expect(s.campaign.gold).toBe(70);
    const hired = ok(s, { type: 'hire', heroId: s.campaign.recruits[0]!.hero.id }).state;
    expect(ok(hired, { type: 'buy', kind: 'torch' }).state.campaign.gold).toBe(0);
    expect(e.apply(hired, { type: 'hire', heroId: hired.campaign.recruits[0]!.hero.id }).error).toBe('Not enough gold.');
  });
});

describe('V4.1 squads (spec 31.12): squad slots', () => {
  it('a new campaign takes three; the engine refuses a fourth with a reason that names the fix', () => {
    const s = withParty(e.newGame(4));
    expect(s.campaign.squadSlots).toBe(SQUAD_SLOTS_START);
    expect(squadSlots(s.campaign)).toBe(3);
    const four = ['keven', 'brann', 'pim', 'aldous'];
    const why = e.partyProblem(s, four);
    expect(why).toMatch(/^Three heroes at most for now\./);
    expect(why).toMatch(/muster roll/);
    const r = e.apply(s, { type: 'startDelve', contractId: s.campaign.board[0]!.id, heroIds: four, entrance: 1, packs: {} });
    expect(r.error).toBe(why);
    expect(e.partyProblem(s, ['keven', 'brann', 'pim'])).toBeNull();
    s.campaign.squadSlots = 4;
    expect(e.partyProblem(s, four)).toBeNull();
    expect(e.partyProblem(s, [...four, 'keven'])).toBeNull(); // duplicates count once
  });

  it('old saves (no squadSlots) load with four, so no existing party breaks; the muster roll is not offered to them', () => {
    const s = withParty(e.newGame(5));
    s.campaign.reputation = MUSTER_REP;
    const old = JSON.parse(e.serialize(s)) as GameState;
    delete (old.campaign as { squadSlots?: number }).squadSlots;
    delete (old.campaign.village as { muster?: boolean }).muster;
    expect(squadSlots(old.campaign)).toBe(SQUAD_SLOTS_MAX);
    const back = e.deserialize(JSON.stringify(old))!;
    expect(back.campaign.squadSlots).toBe(4);
    expect(back.campaign.village.muster).toBe(false);
    expect(e.partyProblem(back, ['keven', 'brann', 'pim', 'aldous'])).toBeNull();
    expect(storyAvailable(back, MUSTER)).toBe(false);
  });
});

describe('V4.1 squads (spec 31.12): the muster roll', () => {
  it('is a Level 2 recover story in the officers\' quarters: worth 0, 1 slot, no pay and no gift', () => {
    expect(MUSTER).toMatchObject({ kind: 'recover', siteId: 'l2-story-officers', slots: 1 });
    expect(MUSTER.heavy).toBeUndefined();
    expect(GIFTS.muster).toBeUndefined();
  });

  it('goes up at reputation 2, before or after Gerda, while the party still has a slot to win', () => {
    const s = e.newGame(6);
    for (const rep of [0, 1]) {
      s.campaign.reputation = rep;
      expect(storyAvailable(s, MUSTER), `rep ${rep}`).toBe(false);
    }
    s.campaign.reputation = 2;
    expect(storyAvailable(s, MUSTER)).toBe(true);
    s.campaign.village.smith = true;
    expect(storyAvailable(s, MUSTER)).toBe(true);
    s.campaign.squadSlots = 4;
    expect(storyAvailable(s, MUSTER)).toBe(false);
  });

  it('brought home: a fourth slot and a line at the Flagon; no gold, no gift; never sold', () => {
    let back = withParty(e.newGame(7));
    back.campaign.reputation = 2;
    refreshCamp(w, back as GameStateX); // the board as camp rebuilds it after a delve
    const k = back.campaign.board.find((x) => x.story === 'muster')!;
    expect(k).toMatchObject({ kind: 'recover', level: 2, bounty: 0, subject: 'the muster roll' });
    // The roll itself: a story item worth 0, one slot.
    const t1 = ok(back, { type: 'startDelve', contractId: k.id, heroIds: ['keven'], entrance: 1, packs: {} }).state;
    const roll = t1.delve!.ground.flatMap((g) => g.items).find((i) => i.contractId === k.id)!;
    expect(roll).toMatchObject({ story: 'muster', amount: 0, slots: 1 });
    expect(roll.heavy).toBeUndefined();
    const gold = back.campaign.gold;
    const stash = back.campaign.stash.length;
    const done = finish(back, k.id, ['keven', 'brann']);
    const r = ok(done, { type: 'backToCamp' });
    back = r.state;
    expect(back.campaign.squadSlots).toBe(4);
    expect(back.campaign.village.muster).toBe(true);
    expect(r.events).toContainEqual({ type: 'villageUnlocked', story: 'muster' });
    expect(r.events).toContainEqual({ type: 'say', text: "Wim pins the muster roll by the Flagon's door. A fourth can go in with you now." });
    expect(back.campaign.gold).toBe(gold);
    expect(back.campaign.stash.length).toBe(stash); // to the village, not the cart; no gift
    expect(back.campaign.board.some((x) => x.story === 'muster')).toBe(false);
    expect(e.partyProblem(back, ['keven', 'brann', 'pim', 'aldous'])).toBeNull();
    expect(e.partyProblem(back, ['keven', 'brann', 'pim', 'aldous', 'x'])).toBeTruthy();
  });
});

describe('V4.1 squads (spec 31.12): contract XP is a pot of 8 shared by the survivors', () => {
  it('rounded up: 1 → 8, 2 → 4, 3 → 3, 4 → 2', () => {
    expect(CONTRACT_XP_POT).toBe(8);
    expect([1, 2, 3, 4].map(contractXpEach)).toEqual([8, 4, 3, 2]);
    expect(contractXpEach(0)).toBe(0);
  });

  it('in the summary: survive +1 and the share, for each hero who got out; a failed contract only +1', () => {
    for (const ids of [['keven'], ['keven', 'brann'], ['keven', 'brann', 'pim']]) {
      const s = withParty(e.newGame(8));
      const k = s.campaign.board.find((x) => x.kind === 'recover' && !x.story)!;
      const sum = finish(s, k.id, ids).summary!;
      expect(sum.contractDone).toBe(true);
      for (const id of ids) expect(sum.xp[id], `${ids.length} out`).toBe(1 + contractXpEach(ids.length));
    }
    const s = withParty(e.newGame(8));
    let t = ok(s, { type: 'startDelve', contractId: s.campaign.board[0]!.id, heroIds: ['keven', 'brann'], entrance: 1, packs: {} }).state;
    t.delve!.monsters = [];
    t.delve!.rivals = null;
    for (const id of ['keven', 'brann']) {
      t.delve!.heroes.find((h) => h.heroId === id)!.at = at(1, 18, 7);
      t = ok(t, { type: 'act', heroId: id, action: 'leave', target: {}, focus: 0 }).state;
    }
    expect(t.summary!.contractDone).toBe(false);
    expect(t.summary!.xp).toEqual({ keven: 1, brann: 1 }); // out empty-handed: survive +1 only
  });
});

describe('V4.1 squads (spec 31.12): crews as big as the party', () => {
  const sizes = (id: CrewId) => [1, 2, 3, 4, 5].map((n) => crewSize(CREWS[id], n));
  it('the Sisters, the Ferrymen and the Gallows Choir field 2–4, the Wake 3–5', () => {
    expect(sizes('lantern-sisters')).toEqual([2, 2, 3, 4, 4]);
    expect(sizes('ferrymen')).toEqual([2, 2, 3, 4, 4]);
    expect(sizes('gallows-choir')).toEqual([2, 2, 3, 4, 4]);
    expect(sizes('the-wake')).toEqual([3, 3, 3, 4, 5]);
  });

  it('smaller crews leave their extra members out first, keeping each crew\'s signature members', () => {
    const names = (id: CrewId, n: number) => crewLineup(CREWS[id], n).map((m) => m.name);
    expect(names('lantern-sisters', 4)).toEqual(['Sister Wenna', 'Sister Odile', 'Sister Brisk', 'Sister Maud']);
    expect(names('lantern-sisters', 3)).toEqual(['Sister Wenna', 'Sister Odile', 'Sister Brisk']);
    expect(names('lantern-sisters', 2)).toEqual(['Sister Wenna', 'Sister Brisk']); // the Burglar sister (the key) and the Ranger stay
    expect(names('ferrymen', 4)).toEqual(['Ferryman Joost', 'Ferryman Sil', 'Ferryman Brecht', 'Ferryman Kees']);
    expect(names('ferrymen', 3)).toEqual(['Ferryman Joost', 'Ferryman Sil', 'Ferryman Brecht']);
    expect(names('ferrymen', 2)).toEqual(['Ferryman Joost', 'Ferryman Brecht']); // the Sapper stays
    expect(names('gallows-choir', 4)).toEqual(['Deacon Harl', 'Little Mags', 'Cantor Vey', 'Verger Crane']);
    expect(names('gallows-choir', 2)).toEqual(['Deacon Harl', 'Little Mags']); // Mags and her poison dart stay
    expect(names('the-wake', 5)).toEqual(['Mother Grave', 'Sexton', 'Candle', 'Spade', 'Pall']);
    expect(names('the-wake', 4)).toEqual(['Mother Grave', 'Sexton', 'Candle', 'Spade']);
    expect(names('the-wake', 3)).toEqual(['Mother Grave', 'Sexton', 'Spade']);
    expect(CREWS['lantern-sisters'].members.map((m) => m.cls)).toEqual(['ranger', 'shadowmancer', 'burglar', 'hedgewitch']);
    expect(CREWS.ferrymen.members.map((m) => m.cls)).toEqual(['sellsword', 'ranger', 'sapper', 'burglar']);
    expect(CREWS['gallows-choir'].members.map((m) => m.cls)).toEqual(['sellsword', 'burglar', 'pyromancer', 'shadowmancer']);
    expect(CREWS['the-wake'].members.map((m) => m.cls)).toEqual(['sellsword', 'hedgewitch', 'shadowmancer', 'sapper', 'ranger']);
  });

  it('new members are built like the rest: kit by crew level, a Ranger\'s quiver, a purse for cutthroats', () => {
    const s = e.newGame(9) as GameStateX;
    const wake = buildCrew(s, 'the-wake', [at(2, 16, 4)], 5);
    const pall = wake.members.find((r) => r.name === 'Pall')!;
    expect(pall.cls).toBe('ranger');
    expect(pall.pack!.find((i) => i.kind === 'quiver')!.amount).toBe(5 * CREWS['the-wake'].level);
    expect(pall.loot.find((i) => i.kind === 'gold')!.amount).toBe(CREWS['the-wake'].purse);
    const kees = buildCrew(s, 'ferrymen', [at(2, 16, 4)], 4).members.find((r) => r.name === 'Ferryman Kees')!;
    expect(kees.pack!.some((i) => i.kind === 'improvised')).toBe(true);
    expect(kees.pack!.some((i) => i.kind === 'lockpicks')).toBe(true);
    const maud = buildCrew(s, 'lantern-sisters', [at(2, 16, 4)], 4).members.find((r) => r.name === 'Sister Maud')!;
    expect(maud.cls).toBe('hedgewitch');
    expect(maud.loot).toEqual([]); // prospectors carry no purse
    expect(maud.charges).toBe(3);
  });

  it('startDelve sizes the crew by the heroes who set out', () => {
    for (const [n, want] of [[1, 2], [2, 2], [3, 3]] as const) {
      let seen = 0;
      for (let seed = 1; seed < 60 && seen < 3; seed++) {
        const s = withParty(e.newGame(seed));
        const ids = ['keven', 'brann', 'pim'].slice(0, n);
        const k = s.campaign.board.find((x) => x.level === 1)!;
        const t = ok(s, { type: 'startDelve', contractId: k.id, heroIds: ids, entrance: 0, packs: {} }).state;
        const cr = t.delve!.rivals;
        if (!cr) continue;
        seen++;
        expect(cr.crew).toBe('lantern-sisters');
        expect(cr.members.length, `party of ${n}`).toBe(want);
        expect(cr.members.map((r) => r.id)).toEqual(cr.members.map((_, i) => `r${i + 1}`));
      }
      expect(seen).toBeGreaterThan(0);
    }
  });

  it('makeCrew: cutthroats at a post match the party size (four against four)', () => {
    const s = withParty(e.newGame(10));
    s.campaign.squadSlots = 4;
    const t = ok(s, { type: 'startDelve', contractId: s.campaign.board[0]!.id, heroIds: ['keven', 'brann', 'pim', 'aldous'], entrance: 1, packs: {} }).state as GameStateX;
    let found = 0;
    for (let i = 1; i <= 40; i++) {
      const u = structuredClone(t);
      u.rng = (i * 2654435761) >>> 0;
      const two = makeCrew(w, u, u.delve as DelveX, 2, undefined, 4);
      if (two) {
        found++;
        expect(two.members.length).toBe(4);
        expect(two.members.every((r) => !!r.post)).toBe(true);
      }
      const small = makeCrew(w, structuredClone(u), u.delve as DelveX, 2, undefined, 1);
      if (small) expect(small.members.length).toBe(2);
      const wake = makeCrew(w, structuredClone(u), u.delve as DelveX, 3, undefined, 2);
      if (wake) expect(wake.members.length).toBe(3);
    }
    expect(found).toBeGreaterThan(0);
  });
});
