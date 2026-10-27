// V4.0 (spec 28, design pillar 17): rivals play by the party's rules. One block per item of the first crew-parity pass:
// moving like heroes (walk, sneak, dash; noise, wake rolls, footsteps), monsters treating crew members like heroes,
// locks the honest way, traps, the Burglar's sneak attack and backstab, the Sapper reshaping the way; and determinism.

import { describe, it, expect } from 'vitest';
import { createEngine } from './engine';
import { at, testCastle } from './test/testCastle';
import { DIRS, distance, posKey, samePos, type Pos } from './hex';
import type { CrewId, GameEvent, GameState, Monster, MonsterKind, RivalCrew } from './types';
import { CREWS, MONSTERS } from './data';
import { World, kindAt } from './world';
import type { Ctx, DelveX, GameStateX, MonsterX, RivalX } from './state';
import { buildCrew, planRival } from './rivals';
import { dirIndex, perceivable } from './stealth';
import { foes, sees } from './ai';
import { planMonster, lookAll } from './world-phase';
import { litSet } from './world';
import { crewApproach, crewBudget, crewDoWay, crewWalk, crewWorkLock, sapperWay, wantSneak } from './crewmove';
import { hostileAct } from './crewai';

const e = createEngine(testCastle);
const w = new World(testCastle);

/** A delve on the test castle (Brann the Sellsword alone), monsters and traps cleared, the crew placed by hand. */
function delve(seed = 1, heroes = ['keven']): GameState {
  const s = e.newGame(seed);
  const k = s.campaign.board[0]!;
  const r = e.apply(s, { type: 'startDelve', contractId: k.id, heroIds: heroes, entrance: 0, packs: {} });
  expect(r.error).toBeUndefined();
  const t = r.state;
  t.delve!.monsters = [];
  t.delve!.rivals = null;
  t.delve!.traps = {};
  return t;
}

function crew(s: GameState, id: CrewId, spots: Pos[], stance?: RivalCrew['stance']): RivalX[] {
  const cr = buildCrew(s as GameStateX, id, spots);
  if (stance) cr.stance = stance;
  cr.spotted = true;
  s.delve!.rivals = cr;
  return cr.members as RivalX[];
}

function monster(s: GameState, kind: MonsterKind, p: Pos, awareness: Monster['awareness'] = 'asleep', facing?: number): MonsterX {
  const def = MONSTERS[kind];
  const m: MonsterX = { id: `m${s.delve!.monsters.length + 1}`, kind, name: def.name, at: { ...p }, hp: def.hp, maxHp: def.hp, awareness, spawnedAt: { ...p }, ...(facing !== undefined ? { facing } : {}) };
  s.delve!.monsters.push(m);
  return m;
}

function ctx(s: GameState, phase: 'player' | 'world' = 'world'): Ctx {
  s.delve!.phase = phase;
  return { w, s: s as GameStateX, d: s.delve as DelveX, ev: [] as GameEvent[] };
}

function keven(s: GameState) {
  return s.delve!.heroes[0]!;
}

function step(p: Pos, dir: number, n = 1): Pos {
  return { level: p.level, q: p.q + DIRS[dir]!.q * n, r: p.r + DIRS[dir]!.r * n };
}

function seeded(s: GameState, i: number): GameState {
  const t = structuredClone(s);
  t.rng = (i * 2654435761) >>> 0;
  return t;
}

const rolls = (ev: GameEvent[], who?: string) => ev.flatMap((x) => (x.type === 'roll' && (!who || x.who === who) ? [x] : []));

describe('V4.0 crews play by the party\'s rules (spec 28)', () => {
  describe('28.1 moving like heroes', () => {
    it('walk 4 (Burglar 5), sneak 2 (Burglar 4); a member at peace with nothing about walks and dashes as far again', () => {
      const s = delve();
      const [ranger, , burglar] = crew(s, 'lantern-sisters', [at(3, 2, 2), at(3, 2, 3), at(3, 2, 4)]);
      expect([crewBudget(ranger!, false), crewBudget(ranger!, true), crewBudget(burglar!, false), crewBudget(burglar!, true)]).toEqual([4, 2, 5, 4]);
      const c = ctx(s);
      const goal = at(3, 12, 4);
      const r = crewApproach(c, burglar!, [goal], { dash: true });
      expect(r.sneak).toBe(false);
      expect(r.dash).toBe(true);
      expect(r.path.length).toBe(10);
      const one = crewApproach(c, burglar!, [goal]);
      expect(one.path.length).toBe(5);
    });

    it('prospectors sneak when a monster they can see that isn\'t hunting lies near their path (and go half as far)', () => {
      const s = delve();
      const [, , burglar] = crew(s, 'lantern-sisters', [at(3, 2, 2), at(3, 2, 3), at(3, 2, 4)]);
      monster(s, 'rats', at(3, 6, 5), 'asleep');
      const c = ctx(s);
      const r = crewApproach(c, burglar!, [at(3, 12, 4)], { dash: true });
      expect(r.sneak).toBe(true);
      expect(r.path.length).toBe(8);
      // A hunting monster isn't snuck past (it knows already).
      s.delve!.monsters[0]!.awareness = 'hunting';
      expect(wantSneak(c, burglar!, r.path)).toBe(false);
    });

    it('a hostile member stalks (sneaks) a hero who hasn\'t noticed it while the party can\'t see it, and walks once it is seen', () => {
      const s = delve();
      const h = keven(s);
      h.at = at(3, 8, 4);
      h.facing = 0; // east: the crew comes from the west, straight behind
      const [sell] = crew(s, 'gallows-choir', [at(3, 4, 4), at(3, 2, 7), at(3, 2, 8)], 'hostile');
      const c = ctx(s);
      expect(wantSneak(c, sell!, [], 'keven')).toBe(true);
      sell!.seenBy = ['keven'];
      expect(wantSneak(c, sell!, [], 'keven')).toBe(false);
    });

    it('walking past a sleeper wakes it far more often than sneaking past; ending next to it walking wakes it for sure', () => {
      let walkedEnd = 0;
      let walkedBy = 0;
      let snuckBy = 0;
      for (let i = 1; i <= 40; i++) {
        const base = delve();
        crew(base, 'ferrymen', [at(3, 4, 4), at(3, 2, 7), at(3, 2, 8)]);
        monster(base, 'rats', at(3, 8, 6), 'asleep');
        // Ending next to it, walking.
        {
          const s = seeded(base, i);
          const c = ctx(s);
          const r = s.delve!.rivals!.members[0] as RivalX;
          crewWalk(c, r, [at(3, 5, 4), at(3, 5, 5), at(3, 6, 5), at(3, 7, 5)], false);
          if (s.delve!.monsters[0]!.awareness !== 'asleep') walkedEnd++; // the step's noise (1) or the roll
        }
        // Passing 2 away, walking or sneaking (not ending next to it).
        for (const sneak of [false, true]) {
          const s = seeded(base, i);
          const c = ctx(s);
          const r = s.delve!.rivals!.members[0] as RivalX;
          crewWalk(c, r, [at(3, 5, 4), at(3, 6, 4), at(3, 7, 4), at(3, 8, 4)], sneak);
          const woke = s.delve!.monsters[0]!.awareness !== 'asleep';
          if (woke && sneak) snuckBy++;
          if (woke && !sneak) walkedBy++;
        }
      }
      expect(walkedEnd).toBe(40);
      expect(walkedBy).toBeGreaterThan(snuckBy + 10);
      expect(snuckBy).toBeLessThan(10);
    });

    it('the party hears a walking crew member\'s footsteps beyond a door, not a sneaking one\'s; sneaking sets `sneaked`', () => {
      for (const sneak of [false, true]) {
        const s = delve();
        keven(s).at = at(1, 12, 3); // west of the armory's locked door
        const [sell] = crew(s, 'ferrymen', [at(1, 15, 2), at(1, 17, 3), at(1, 17, 4)]);
        const c = ctx(s);
        crewWalk(c, sell!, [at(1, 14, 2)], sneak);
        expect(sell!.sneaked).toBe(sneak);
        const steps = (s.delve!.heard ?? []).filter((x) => x.kind === 'steps');
        expect(steps.length).toBe(sneak ? 0 : 1);
      }
    });
  });

  describe('28.2 monsters treat crew members like heroes', () => {
    it('an unaware monster notices a walker ahead of it, not a sneaking Burglar at its side 3 away (nor once it hunts)', () => {
      const s = delve();
      const orc = monster(s, 'orc', at(3, 8, 4), 'alert', 3); // facing west
      const [sell, burglar] = crew(s, 'gallows-choir', [at(3, 2, 4), step(at(3, 8, 4), 1, 3), at(3, 2, 8)]);
      const c = ctx(s);
      const lit = litSet(w, s.delve as DelveX);
      const t = (id: string) => foes(c).find((x) => x.id === id)!;
      burglar!.sneaked = true;
      expect(perceivable(c, orc, t(burglar!.id), lit, (a, b, L) => sees(c, a, b, L))).toBe(false);
      crewWalk(c, sell!, [at(3, 3, 4), at(3, 4, 4)], false);
      expect(orc.noticedIds).toContain(sell!.id);
      expect(orc.noticedIds).not.toContain(burglar!.id);
      expect(orc.awareness).toBe('hunting');
    });

    it('a hunting monster goes for the nearest it makes out, crew member or hero, and strikes it', () => {
      const s = delve();
      keven(s).at = at(2, 14, 1);
      const orc = monster(s, 'orc', at(2, 15, 4), 'hunting');
      const [sell] = crew(s, 'ferrymen', [at(2, 16, 4), at(2, 18, 1), at(2, 18, 2)]);
      orc.noticedIds = ['keven', sell!.id];
      const c = ctx(s, 'player');
      expect(planMonster(c, orc, litSet(w, s.delve as DelveX)).intent).toMatchObject({ kind: 'attack', targetId: sell!.id });
      const r = e.apply(s, { type: 'endTurn' });
      expect(r.error).toBeUndefined();
      expect(r.events.some((x) => (x.type === 'hit' || x.type === 'miss') && x.attacker === orc.id && x.target === sell!.id)).toBe(true);
    });

    it('a crew member a monster attacks fights back; prospectors stay neutral to the party', () => {
      const s = delve();
      keven(s).at = at(1, 4, 7);
      const orc = monster(s, 'orc', at(1, 16, 3), 'hunting');
      const [ranger] = crew(s, 'lantern-sisters', [at(1, 16, 2), at(1, 17, 3), at(1, 15, 2)]);
      orc.noticedIds = [ranger!.id];
      s.delve!.phase = 'player';
      expect(planRival({ w, s: s as GameStateX, d: s.delve as DelveX, ev: [] }, ranger!)).toMatchObject({ kind: 'attack', targetId: orc.id });
      const r = e.apply(s, { type: 'endTurn' });
      expect(r.events.some((x) => (x.type === 'hit' || x.type === 'miss') && x.attacker === ranger!.id && x.target === orc.id)).toBe(true);
      expect(r.state.delve!.rivals!.stance).toBe('neutral');
    });

    it('a monster\'s `noticed` event names a crew member only when the party can see one of them', () => {
      const s = delve();
      keven(s).at = at(1, 4, 7);
      const orc = monster(s, 'orc', at(3, 8, 4), 'alert', 3);
      const [sell] = crew(s, 'ferrymen', [at(3, 2, 4), at(3, 2, 7), at(3, 2, 8)]);
      const c = ctx(s);
      crewWalk(c, sell!, [at(3, 3, 4)], false);
      expect(orc.noticedIds).toContain(sell!.id);
      expect(c.ev.some((x) => x.type === 'noticed')).toBe(false); // the party is on Level 1
      lookAll(c, undefined, undefined, true); // nothing new: no double notice
      expect(c.ev.filter((x) => x.type === 'noticed').length).toBe(0);
    });
  });

  describe('28.3 locks the honest way', () => {
    const CHEST = at(1, 17, 1); // locked, tier 2

    it('picking: every slot silent, one short a clunk (noise 2), 1 of 3 holds, none jams; no picks: smash (noise 4)', () => {
      const seen = new Set<string>();
      for (let i = 1; i < 400 && seen.size < 4; i++) {
        const s = seeded(delve(), i);
        const [, , burglar] = crew(s, 'lantern-sisters', [at(1, 18, 2), at(1, 18, 3), at(1, 16, 1)]);
        burglar!.level = 2; // V4.1 (WS7): the Sisters are level 4 now; a level 2 picker shows every outcome
        const c = ctx(s);
        const res = crewWorkLock(c, burglar!, CHEST);
        const ch = s.delve!.chests.find((x) => samePos(x.at, CHEST))!;
        const noise = c.ev.filter((x) => x.type === 'noise').map((x) => (x as { radius: number }).radius);
        expect(rolls(c.ev, burglar!.id)[0]!.roll.slots).toBe(3);
        if (res === 'silent') expect([ch.locked, noise]).toEqual([false, []]);
        if (res === 'clunk') expect([ch.locked, noise]).toEqual([false, [2]]);
        if (res === 'holds') expect([ch.locked, ch.jammed ?? false]).toEqual([true, false]);
        if (res === 'jammed') expect([ch.locked, ch.jammed]).toEqual([true, true]);
        seen.add(res);
      }
      expect([...seen].sort()).toEqual(['clunk', 'holds', 'jammed', 'silent']);
      const s = delve();
      const [ranger] = crew(s, 'lantern-sisters', [at(1, 16, 1), at(1, 18, 3), at(1, 18, 4)]);
      const c = ctx(s);
      const res = crewWorkLock(c, ranger!, CHEST);
      expect(['smashed', 'stuck']).toContain(res);
      expect(c.ev).toContainEqual({ type: 'noise', at: CHEST, radius: 4 });
    });

    it('prospectors no longer open a locked chest for free: the Burglar sister picks it, the others leave it to her', () => {
      const s = delve();
      keven(s).at = at(1, 4, 7);
      const [ranger, , burglar] = crew(s, 'lantern-sisters', [at(1, 16, 1), at(1, 15, 8), at(1, 18, 1)]);
      s.delve!.phase = 'player';
      const c: Ctx = { w, s: s as GameStateX, d: s.delve as DelveX, ev: [] };
      expect(planRival(c, burglar!)).toMatchObject({ kind: 'pick', to: CHEST });
      expect(planRival(c, ranger!).kind).not.toBe('steal');
      const r = e.apply(s, { type: 'endTurn' });
      expect(rolls(r.events, burglar!.id).some((x) => x.what === 'Pick')).toBe(true);
    });

    it('the paid "open" job: the lockpicker\'s best attempt; a jammed lock ends the job and they keep the price (spec 28.8)', () => {
      let done = false;
      for (let i = 1; i < 400 && !done; i++) {
        const s = seeded(delve(), i);
        keven(s).at = at(1, 4, 7);
        crew(s, 'lantern-sisters', [at(1, 18, 2), at(1, 18, 3), at(1, 16, 1)]);
        for (const m of s.delve!.rivals!.members) m.level = 2; // V4.1 (WS7): a level 2 picker jams now and then
        s.delve!.rivals!.job = { kind: 'open', at: CHEST, price: 30, by: 'keven' };
        const before = keven(s).pack.filter((x) => x.kind === 'gold').reduce((n, x) => n + x.amount, 0);
        const r = e.apply(s, { type: 'endTurn' });
        const ch = r.state.delve!.chests.find((x) => samePos(x.at, CHEST))!;
        if (!ch.jammed) continue;
        done = true;
        const after = r.state.delve!.heroes[0]!.pack.filter((x) => x.kind === 'gold').reduce((n, x) => n + x.amount, 0);
        expect(after).toBe(before); // no refund: the gold stays spent
        expect(r.events.some((x) => x.type === 'say' && /jams the lock\. The job's done; they keep the 30\./.test(x.text))).toBe(true);
        expect(r.state.delve!.rivals!.job).toBeUndefined();
      }
      expect(done).toBe(true);
    }, 30000); // seeds until a jam: slow under load
  });

  describe('28.4 traps', () => {
    it('a crew member stepping on a trap springs it: 3 damage, gone, noise 2', () => {
      const s = delve();
      const [sell] = crew(s, 'ferrymen', [at(3, 4, 4), at(3, 2, 7), at(3, 2, 8)]);
      s.delve!.traps[posKey(at(3, 5, 4))] = { spotted: false };
      const c = ctx(s);
      const hp = sell!.hp;
      crewWalk(c, sell!, [at(3, 5, 4), at(3, 6, 4)], false);
      expect(sell!.hp).toBe(hp - 3);
      expect(s.delve!.traps[posKey(at(3, 5, 4))]).toBeUndefined();
      expect(c.ev).toContainEqual({ type: 'noise', at: at(3, 5, 4), radius: 2 });
    });

    it('ending a move next to a trap, a member may spot it (1 Wits slot); then the crew walks round it', () => {
      const trap = at(3, 6, 4);
      let spotted: GameState | null = null;
      for (let i = 1; i < 50 && !spotted; i++) {
        const s = seeded(delve(), i);
        const [sell] = crew(s, 'ferrymen', [at(3, 4, 4), at(3, 2, 7), at(3, 2, 8)]);
        s.delve!.traps[posKey(trap)] = { spotted: false };
        const c = ctx(s);
        crewWalk(c, sell!, [at(3, 5, 4)], false);
        if (s.delve!.traps[posKey(trap)]!.crewSpotted) spotted = s;
      }
      expect(spotted).not.toBeNull();
      const s = spotted!;
      const c = ctx(s);
      const r = crewApproach(c, s.delve!.rivals!.members[0] as RivalX, [at(3, 7, 4)], { sneak: false });
      expect(r.path.some((p) => samePos(p, trap))).toBe(false);
      expect(samePos(r.path[r.path.length - 1]!, at(3, 7, 4))).toBe(true);
    });

    it('a crew Burglar disarms a known trap on her way rather than go the long way round (2 Finesse slots)', () => {
      const s = delve();
      const door = at(2, 6, 3); // the shrine's only door onto the bridge
      const [, burglar] = crew(s, 'gallows-choir', [at(2, 2, 1), at(2, 5, 3), at(2, 2, 2)]);
      s.delve!.traps[posKey(door)] = { spotted: false, crewSpotted: true };
      const c = ctx(s);
      const r = crewApproach(c, burglar!, [at(2, 8, 3)], { sneak: false });
      expect(r.way).toEqual({ kind: 'disarm', at: door });
      expect(crewDoWay(c, burglar!, r.way!)).toBe(true);
      expect(rolls(c.ev, burglar!.id)[0]).toMatchObject({ what: 'Disarm', roll: { slots: 2 } });
      expect(s.delve!.traps[posKey(door)]).toBeUndefined();
    });
  });

  describe('28.5 the Burglar sister: sneak attack and backstab', () => {
    function setup(noticed: boolean) {
      const s = delve();
      const h = keven(s);
      h.at = at(3, 8, 4);
      h.facing = 0; // east
      const behind = step(h.at, 3); // straight behind (west)
      const [, burglar] = crew(s, 'gallows-choir', [at(3, 2, 7), behind, at(3, 2, 8)], 'hostile');
      burglar!.facing = dirIndex(behind, h.at);
      if (noticed) burglar!.seenBy = ['keven'];
      (s.delve!.rivals as DelveX['rivals'] & { target?: string }).target = 'keven';
      return { s, burglar: burglar! };
    }

    it('unnoticed, from straight behind: +1 slot sneak attack, +1 from behind, double damage before armor', () => {
      const { s, burglar } = setup(false);
      const c = ctx(s);
      hostileAct(c, burglar);
      const r = rolls(c.ev, burglar.id)[0]!;
      expect(r.what).toBe('Backstab from behind');
      expect(r.roll.slots).toBe(2 + 1 + 1);
      const hit = c.ev.find((x) => x.type === 'hit' && x.attacker === burglar.id) as { damage: number } | undefined;
      // Dagger 2, doubled to 4, less Keven's armor 1: 3 a hit (Perfect +1).
      if (hit) expect(hit.damage).toBe(r.roll.hits * 3 + (r.roll.perfect ? 1 : 0));
    });

    it('noticed: a plain strike (only the blindside slot from behind)', () => {
      const { s, burglar } = setup(true);
      const c = ctx(s);
      hostileAct(c, burglar);
      const r = rolls(c.ev, burglar.id)[0]!;
      expect(r.what).toBe('Attack from behind');
      expect(r.roll.slots).toBe(2 + 1);
    });
  });

  describe('28.6 the Sapper reshapes the way', () => {
    it('digs through a cracked wall that saves 6+ hexes (noise 4); carries improvised explosives', () => {
      const s = delve();
      const [, , sapper] = crew(s, 'ferrymen', [at(2, 1, 1), at(2, 2, 1), at(2, 3, 4)], 'bribed');
      expect(sapper!.pack!.find((i) => i.kind === 'improvised-charge')).toMatchObject({ amount: CREWS.ferrymen.level, slots: 0 }); // one a crew level
      const c = ctx(s);
      const way = sapperWay(c, sapper!, [at(2, 3, 7)]);
      expect(way).toEqual({ kind: 'dig', at: at(2, 3, 5) });
      expect(crewDoWay(c, sapper!, way!)).toBe(true);
      expect(kindAt(w, s.delve as DelveX, at(2, 3, 5))).not.toBe('cracked');
      expect(c.ev).toContainEqual({ type: 'noise', at: at(2, 3, 5), radius: 4 });
    });

    it('blasts a locked door that is the short way: a charge (improvised first), fuse 1', () => {
      const s = delve();
      const [, , sapper] = crew(s, 'ferrymen', [at(1, 9, 1), at(1, 9, 2), at(1, 12, 3)], 'bribed');
      const c = ctx(s);
      const route = crewApproach(c, sapper!, [at(1, 15, 3)]);
      expect(route.way).toEqual({ kind: 'blast', at: at(1, 13, 3) });
      expect(crewDoWay(c, sapper!, route.way!)).toBe(true);
      expect(c.ev).toContainEqual({ type: 'fuseSet', at: at(1, 13, 3), rounds: 1, by: sapper!.id });
      expect(sapper!.pack!.find((i) => i.kind === 'improvised-charge')!.amount).toBe(CREWS.ferrymen.level - 1);
      // It waits for its own fuse; the next blast opens the door.
      expect(crewApproach(c, sapper!, [at(1, 15, 3)]).path).toEqual([]);
    });
  });

  describe('determinism', () => {
    it('the same seed and commands give the same crews, monsters and events', () => {
      const run = () => {
        const s0 = e.newGame(7);
        const r0 = e.apply(s0, { type: 'startDelve', contractId: s0.campaign.board[0]!.id, heroIds: ['keven'], entrance: 0, packs: {} });
        let s = r0.state;
        crew(s, 'lantern-sisters', [at(1, 17, 7), at(1, 16, 8), at(1, 17, 8)]);
        s.delve!.traps[posKey(at(1, 15, 7))] = { spotted: false };
        const evs: GameEvent[] = [];
        for (let i = 0; i < 8 && s.stage === 'delve'; i++) {
          const r = e.apply(s, { type: 'endTurn' });
          evs.push(...r.events);
          s = r.state;
        }
        return JSON.stringify({ s, evs });
      };
      const a = run();
      expect(run()).toBe(a);
      expect(a.length).toBeGreaterThan(1000);
    });
  });

  it('crew members keep away from where a hero ends: never on a hero, never through a monster', () => {
    const s = delve();
    keven(s).at = at(3, 6, 4);
    monster(s, 'orc', at(3, 7, 4), 'asleep');
    const [sell] = crew(s, 'ferrymen', [at(3, 4, 4), at(3, 2, 7), at(3, 2, 8)], 'bribed');
    const c = ctx(s);
    const r = crewApproach(c, sell!, [at(3, 10, 4)], { dash: true });
    expect(r.path.every((p) => !samePos(p, at(3, 6, 4)) && !samePos(p, at(3, 7, 4)))).toBe(true);
    expect(distance(r.path[r.path.length - 1]!, sell!.at)).toBeGreaterThan(0);
  });
});
