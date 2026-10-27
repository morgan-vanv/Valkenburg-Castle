// V4.1 (WS7, spec 31.9): crews as an equal power. One block per new crew verb: Focus on a key roll, flanking (and walking to
// flank), the Sellsword's brace, the antipoison, the missing spells (Sleep, Dread, Night thorn, Briar, Kindle), a mage
// walking to cast, a wary crew keeping its distance, and a beaten crew calling the fight off (and taking a free truce).

import { describe, it, expect } from 'vitest';
import { createEngine } from './engine';
import { at, testCastle } from './test/testCastle';
import { samePos, type Pos } from './hex';
import type { CrewId, GameEvent, GameState, Item, MonsterKind, RivalCrew } from './types';
import { MONSTERS, CREW_FOCUS } from './data';
import { World } from './world';
import type { Ctx, DelveX, GameStateX, MonsterX, RivalX } from './state';
import { buildCrew, planRival } from './rivals';
import { makeHero } from './camp';
import { strike } from './ai';
import { hostileAct, hostilePlan } from './crewai';
import { crewBeaten, crewEdge, crewRetreat, crewWary, heroThreat, keyFocus, powerAct } from './crewpower';
import { deals } from './parley';

const e = createEngine(testCastle);
const w = new World(testCastle);

function delve(heroes = ['keven', 'brann', 'aldous']): GameState {
  const s = e.newGame(1);
  s.campaign.roster.push(makeHero('brann', 'Brann', 'sellsword'), makeHero('aldous', 'Aldous', 'pyromancer'));
  const r = e.apply(s, { type: 'startDelve', contractId: s.campaign.board[0]!.id, heroIds: heroes, entrance: 0, packs: {} });
  expect(r.error).toBeUndefined();
  const t = r.state;
  t.delve!.monsters = [];
  t.delve!.rivals = null;
  t.delve!.traps = {};
  return t;
}

function crew(s: GameState, id: CrewId, spots: Pos[], stance: RivalCrew['stance'] = 'hostile'): RivalX[] {
  const cr = buildCrew(s as GameStateX, id, spots);
  cr.stance = stance;
  cr.spotted = true;
  s.delve!.rivals = cr;
  return cr.members as RivalX[];
}

function monster(s: GameState, kind: MonsterKind, p: Pos, awareness: MonsterX['awareness'] = 'hunting'): MonsterX {
  const def = MONSTERS[kind];
  const m: MonsterX = { id: `m${s.delve!.monsters.length + 1}`, kind, name: def.name, at: { ...p }, hp: def.hp, maxHp: def.hp, awareness, spawnedAt: { ...p } };
  s.delve!.monsters.push(m);
  return m;
}

function ctx(s: GameState, phase: 'player' | 'world' = 'world'): Ctx {
  s.delve!.phase = phase;
  return { w, s: s as GameStateX, d: s.delve as DelveX, ev: [] as GameEvent[] };
}

const hero = (s: GameState, id: string) => s.delve!.heroes.find((h) => h.heroId === id)!;
const put = (s: GameState, id: string, p: Pos) => void (hero(s, id).at = { ...p });
const says = (c: Ctx) => c.ev.flatMap((x) => (x.type === 'say' ? [x.text] : []));
const rolls = (c: Ctx, who: string) => c.ev.flatMap((x) => (x.type === 'roll' && x.who === who ? [x.roll] : []));
const item = (id: string, kind: Item['kind']): Item => ({ id, kind, name: kind, amount: 1, slots: 1 });

/** Brann and Aldous parked out of the way (Level 1), Keven at `p`. */
function park(s: GameState, p: Pos): void {
  put(s, 'keven', p);
  put(s, 'brann', at(1, 2, 8));
  put(s, 'aldous', at(1, 3, 8));
}

describe('V4.1 crews as an equal power (spec 31.9)', () => {
  describe('Focus on key rolls', () => {
    it('keyFocus: enough locked hits for a sure kill; all of it when one more hit at 60%+ would do; else none', () => {
      const r = { level: 3, focus: CREW_FOCUS } as RivalX;
      expect(keyFocus(r, 3, 70, 2, 4)).toBe(2); // two hits kill: lock both
      expect(keyFocus(r, 3, 70, 1, 4)).toBe(0); // four hits needed on three slots: no
      expect(keyFocus({ ...r, focus: 1 } as RivalX, 3, 70, 2, 4)).toBe(1); // one locked, one to roll at 70
      expect(keyFocus({ ...r, focus: 1 } as RivalX, 3, 50, 2, 4)).toBe(0); // not at 50
      expect(keyFocus({ level: undefined } as RivalX, 3, 90, 2, 2)).toBe(0); // legacy members have none
    });

    it('a member spends Focus on a hero it can down, says so, and has less left', () => {
      const s = delve();
      park(s, at(3, 6, 4));
      hero(s, 'keven').hp = 3;
      const [sell] = crew(s, 'ferrymen', [at(3, 7, 4), at(3, 12, 2), at(3, 12, 3)]);
      const c = ctx(s);
      strike(c, sell!.id, 'keven', 3, 80, 2, 'Attack');
      const r = rolls(c, sell!.id)[0]!;
      expect(r.focus).toBeGreaterThan(0);
      expect(sell!.focus).toBe(CREW_FOCUS - r.focus);
      expect(says(c).some((t) => /steadies for the kill on Keven/.test(t))).toBe(true);
    });

    it('no Focus on a free swing, nor on a roll that can\'t kill', () => {
      const s = delve();
      park(s, at(3, 6, 4));
      const [sell] = crew(s, 'ferrymen', [at(3, 7, 4), at(3, 12, 2), at(3, 12, 3)]);
      const c = ctx(s);
      expect(crewEdge(c, sell!.id, hero(s, 'keven'), 2, 80, 2, 'Free swing')).toBeNull();
      strike(c, sell!.id, 'keven', 3, 80, 2, 'Attack'); // Keven at 12 HP: no kill in reach
      expect(rolls(c, sell!.id)[0]!.focus).toBe(0);
      expect(sell!.focus).toBe(CREW_FOCUS);
    });
  });

  describe('flanking', () => {
    it('+1 slot with a crewmate on the hex across the hero (melee), named in the log', () => {
      const s = delve();
      park(s, at(3, 6, 4));
      const [sell, , sapper] = crew(s, 'ferrymen', [at(3, 7, 4), at(3, 12, 2), at(3, 5, 4)]);
      const c = ctx(s);
      strike(c, sell!.id, 'keven', 3, 80, 2, 'Attack');
      expect(rolls(c, sell!.id)[0]!.slots).toBe(4);
      expect(says(c).some((t) => t.includes(`${sell!.name} and ${sapper!.name} flank Keven`))).toBe(true);
      // No crewmate across: no flank.
      const s2 = delve();
      park(s2, at(3, 6, 4));
      const [sell2] = crew(s2, 'ferrymen', [at(3, 7, 4), at(3, 12, 2), at(3, 6, 5)]);
      const c2 = ctx(s2);
      strike(c2, sell2!.id, 'keven', 3, 80, 2, 'Attack');
      expect(rolls(c2, sell2!.id)[0]!.slots).toBe(3);
    });

    it('a member walking in picks the hex across from a crewmate already on the hero', () => {
      const s = delve();
      park(s, at(3, 6, 4));
      hero(s, 'keven').facing = 0;
      const [sell, , sapper] = crew(s, 'ferrymen', [at(3, 9, 4), at(3, 12, 1), at(3, 5, 4)]);
      sapper!.focus = 0;
      const c = ctx(s);
      const plan = hostilePlan(c, sell!);
      const end = plan.path[plan.path.length - 1];
      expect(end && samePos(end, at(3, 7, 4))).toBe(true); // across from the Sapper at (5,4)
    });
  });

  describe('brace', () => {
    it('a crew Sellsword with two heroes at its blade, hurt, braces; hits on it roll −15% and do 1 less', () => {
      const s = delve();
      park(s, at(3, 6, 4));
      put(s, 'brann', at(3, 7, 5));
      const [sell] = crew(s, 'ferrymen', [at(3, 7, 4), at(3, 12, 1), at(3, 12, 2)]);
      const c = ctx(s);
      expect(hostilePlan(c, sell!).intent.kind).not.toBe('brace'); // unhurt: he fights
      sell!.hp = 8;
      expect(hostilePlan(c, sell!).intent.kind).toBe('brace');
      expect(powerAct(c, sell!, { kind: 'brace', targetId: sell!.id })).toBe(true);
      expect(sell!.braced).toBe(true);
      expect(says(c)).toContain(`${sell!.name} sets their feet and braces.`);
      // The hero's attack preview shows the brace.
      const pv = e.preview(s, 'keven', 'attack', { id: sell!.id, at: sell!.at });
      s.delve!.phase = 'player';
      const pv2 = e.preview(s, 'keven', 'attack', { id: sell!.id, at: sell!.at });
      expect(pv2.modifiers.some((m) => m.startsWith('Braced'))).toBe(true);
      void pv;
    });
  });

  describe('antipoison', () => {
    it('a poisoned member below half drinks its antipoison; one beside a poisoned crewmate gives it', () => {
      const s = delve();
      park(s, at(3, 2, 2));
      const [sell, ranger] = crew(s, 'ferrymen', [at(3, 12, 4), at(3, 13, 4), at(3, 16, 1)]);
      sell!.pack!.push(item('a1', 'antidote'));
      ranger!.poisoned = true;
      const c = ctx(s);
      const it = hostilePlan(c, sell!).intent;
      expect(it).toMatchObject({ kind: 'antidote', targetId: ranger!.id });
      expect(powerAct(c, sell!, it)).toBe(true);
      expect(ranger!.poisoned).toBeFalsy();
      expect(sell!.pack!.some((i) => i.kind === 'antidote')).toBe(false);
      expect(c.ev.some((x) => x.type === 'cured' && x.id === ranger!.id && x.how === 'antidote')).toBe(true);
    });
  });

  describe('the missing spells', () => {
    it('Sleep: a Shadowmancer puts a monster hunting the crew to sleep; at peace, a monster near the crew (to pass it)', () => {
      const s = delve();
      park(s, at(3, 2, 8));
      const [, shadow] = crew(s, 'lantern-sisters', [at(3, 8, 2), at(3, 9, 2), at(3, 10, 2)], 'neutral');
      const orc = monster(s, 'orc', at(3, 10, 4), 'alert');
      const c = ctx(s);
      const it = planRival(c, shadow!);
      expect(it).toMatchObject({ kind: 'sleep', targetId: orc.id });
      let slept = 0;
      for (let i = 1; i <= 20; i++) {
        const t = structuredClone(s);
        t.rng = (i * 2654435761) >>> 0;
        const cc = ctx(t);
        const sh = t.delve!.rivals!.members[1] as RivalX;
        powerAct(cc, sh, it);
        if (t.delve!.monsters[0]!.awareness === 'asleep') slept++;
        expect(sh.charges).toBe(2);
      }
      expect(slept).toBeGreaterThan(14);
    });

    it('Dread: a hero standing over a hurt crewmate loses their next action (moving is fine)', () => {
      const s = delve();
      park(s, at(3, 6, 4));
      const [ranger, shadow] = crew(s, 'lantern-sisters', [at(3, 7, 4), at(3, 10, 4), at(3, 12, 1)]);
      ranger!.hp = 3;
      const c = ctx(s);
      const it = hostilePlan(c, shadow!).intent;
      expect(it).toMatchObject({ kind: 'dread', targetId: 'keven' });
      let gripped = false;
      for (let i = 1; i <= 10 && !gripped; i++) {
        const t = structuredClone(s);
        t.rng = (i * 2654435761) >>> 0;
        const cc = ctx(t);
        powerAct(cc, t.delve!.rivals!.members[1] as RivalX, it);
        if (hero(t, 'keven').dreaded) {
          gripped = true;
          t.delve!.round = hero(t, 'keven').dreaded!;
          t.delve!.phase = 'player';
          expect(e.actions(t, 'keven').some((o) => o.action === 'attack')).toBe(false);
          expect(e.apply(t, { type: 'act', heroId: 'keven', action: 'attack', target: { id: ranger!.id, at: ranger!.at }, focus: 0 }).error).toMatch(/dread/);
          expect(e.reachable(t, 'keven', false).length).toBeGreaterThan(0);
        }
      }
      expect(gripped).toBe(true);
    });

    it('Night thorn: 2 Wits slots at a hero, 1 a hit, armor ignored', () => {
      const s = delve();
      park(s, at(3, 6, 4));
      const [, shadow] = crew(s, 'lantern-sisters', [at(3, 12, 1), at(3, 10, 4), at(3, 12, 2)]);
      const c = ctx(s);
      const hp = hero(s, 'keven').hp;
      expect(powerAct(c, shadow!, { kind: 'nightthorn', targetId: 'keven' })).toBe(true);
      const r = rolls(c, shadow!.id)[0]!;
      expect(r.slots).toBe(2);
      expect(hp - hero(s, 'keven').hp).toBe(r.hits + (r.perfect ? 1 : 0)); // Keven's armor 1 doesn't count
      expect(says(c)).toContain(`${shadow!.name} looses a night thorn at Keven.`);
    });

    it('Briar: a Hedgewitch roots a melee hero charging in (1 a hit)', () => {
      const s = delve();
      park(s, at(3, 6, 4));
      const [, witch] = crew(s, 'the-wake', [at(3, 12, 1), at(3, 9, 4), at(3, 12, 2), at(3, 12, 3)]);
      const c = ctx(s);
      const it = hostilePlan(c, witch!).intent;
      expect(it).toMatchObject({ kind: 'briar', targetId: 'keven' });
      let rooted = 0;
      for (let i = 1; i <= 10; i++) {
        const t = structuredClone(s);
        t.rng = (i * 2654435761) >>> 0;
        powerAct(ctx(t), t.delve!.rivals!.members[1] as RivalX, it);
        if ((hero(t, 'keven').rooted ?? 0) > 0) rooted++;
      }
      expect(rooted).toBeGreaterThan(6);
    });

    it('Kindle: a hired Pyromancer lights the hirer\'s unlit torch', () => {
      const s = delve();
      park(s, at(3, 6, 4));
      hero(s, 'keven').pack.push({ ...item('t1', 'torch'), rounds: 10, lit: false });
      const [, , pyro] = crew(s, 'gallows-choir', [at(3, 12, 1), at(3, 12, 2), at(3, 7, 5)], 'hired');
      (s.delve!.rivals as { hiredBy?: string }).hiredBy = 'keven';
      const c = ctx(s);
      const it = planRival(c, pyro!);
      expect(it).toMatchObject({ kind: 'kindle', targetId: 'keven' });
      expect(powerAct(c, pyro!, it)).toBe(true);
      expect(hero(s, 'keven').pack.find((i) => i.id === 't1')!.lit).toBe(true);
    });

    it('a mage out of reach walks to where its spell reaches, then casts, in the same turn', () => {
      const s = delve();
      park(s, at(3, 4, 4));
      const [, shadow] = crew(s, 'lantern-sisters', [at(3, 12, 1), at(3, 12, 4), at(3, 12, 2)]);
      const c = ctx(s);
      const plan = hostilePlan(c, shadow!);
      shadow!.intent = plan.intent;
      expect(['nightthorn', 'dread']).toContain(plan.intent.kind);
      expect(plan.path.length).toBeGreaterThan(0);
      hostileAct(c, shadow!);
      expect(samePos(shadow!.at, at(3, 12, 4))).toBe(false);
      expect(c.ev.some((x) => x.type === 'cast' && x.by === shadow!.id)).toBe(true);
    });
  });

  describe('not piecemeal', () => {
    it('a member that can\'t strike this round stops short of where two heroes could close on it (for CREW_HOLD_ROUNDS rounds)', () => {
      const s = delve();
      park(s, at(3, 4, 4));
      put(s, 'brann', at(3, 4, 5));
      const [sell] = crew(s, 'ferrymen', [at(3, 16, 4), at(3, 17, 1), at(3, 17, 2)]);
      const c = ctx(s);
      const stop = hostilePlan(c, sell!).path.at(-1)!;
      expect(heroThreat(c, stop)).toBeLessThan(2);
      // Held twice already: it goes in.
      s.delve!.rivals!.held = 2;
      const go = hostilePlan(c, sell!).path.at(-1)!;
      expect(heroThreat(c, go)).toBeGreaterThanOrEqual(2);
    });
  });

  describe('retreat and wariness', () => {
    it('a hostile crew with half its members down, facing a stronger party, calls the fight off (once, logged)', () => {
      const s = delve();
      park(s, at(3, 6, 4));
      const [sell, ranger, sapper] = crew(s, 'ferrymen', [at(3, 9, 4), at(3, 12, 1), at(3, 12, 2)]);
      for (const m of [ranger!, sapper!]) Object.assign(m, { hp: 0, downed: true, bleed: 3 });
      sell!.hp = 3;
      const c = ctx(s);
      expect(crewBeaten(c)).toBe(true);
      expect(crewRetreat(c)).toBe(true);
      const cr = s.delve!.rivals!;
      expect(cr.stance).toBe('truce');
      expect(cr.goal).toBe('leave');
      expect(says(c).some((t) => /call the fight off/.test(t))).toBe(true);
      expect(crewRetreat(c)).toBe(false);
    });

    it('a beaten hostile crew takes a truce or a leave for nothing (parley)', () => {
      const s = delve();
      park(s, at(3, 6, 4));
      const [sell, ranger, sapper] = crew(s, 'ferrymen', [at(3, 8, 4), at(3, 12, 1), at(3, 7, 2)]);
      for (const m of [ranger!, sapper!]) Object.assign(m, { hp: 0, downed: true, bleed: 3 });
      void sell;
      const c = ctx(s, 'player');
      const ds = deals(c, 'keven');
      const truce = ds.find((d) => d.deal === 'truce');
      expect(truce?.price).toBe(0);
      expect(truce?.label).toBe('Offer a truce');
      expect(ds.find((d) => d.deal === 'leave')?.price).toBe(0);
    });

    it('prospectors who see a much stronger party keep their distance (and say so once)', () => {
      const s = delve();
      park(s, at(3, 6, 4));
      put(s, 'brann', at(3, 6, 5));
      put(s, 'aldous', at(3, 5, 4));
      const [ranger] = crew(s, 'lantern-sisters', [at(3, 8, 4), at(3, 12, 1), at(3, 12, 2)], 'neutral');
      const c = ctx(s);
      expect(crewWary(c)).toBe(false); // the Sisters at full strength aren't afraid of three level 1 heroes
      for (const m of s.delve!.rivals!.members) Object.assign(m, { hp: 1, level: 1, pack: [] });
      expect(crewWary(c)).toBe(true);
      const it = planRival(c, ranger!);
      expect(it.kind).toBe('flee');
    });
  });
});
