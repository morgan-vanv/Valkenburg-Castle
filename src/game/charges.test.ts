// V3.7 (spec 20.3): the Sapper. Fused charges, the blast, breakable walls, the
// satchel and the blast shield, on the test castle. Kept apart from
// engine.test.ts so the stealth and sapper workstreams don't edit one file.

import { describe, it, expect } from 'vitest';
import { createEngine } from './engine';
import { at, testCastle } from './test/testCastle';
import { hexKey, posKey, samePos, type Pos } from './hex';
import type { ActionKind, ActionTarget, CastleDef, Command, GameEvent, GameState, Monster, MonsterKind } from './types';
import { MONSTERS } from './data';
import { kindAt, World } from './world';
import type { DelveX, GameStateX } from './state';
import { makeHero } from './camp';
import { blastPreview, breakableWall, chargeCount } from './charges';
import { FACING } from './data';
// V3.9.1: tests written for the shelved facing mechanic run with it on; 'V3.9.1 facing shelved' tests it off.
FACING.faceCommand = true;
FACING.turnOnAction = true;


const e = createEngine(testCastle);
const w = new World(testCastle);

/** A delve with Sam the sapper (and Brann), no monsters, rivals or traps. */
function delve(opts: { heroes?: string[]; castle?: CastleDef } = {}): GameState {
  const eng = opts.castle ? createEngine(opts.castle) : e;
  let s = eng.newGame(1);
  s.campaign.roster.push(makeHero('brann', 'Brann', 'sellsword'), makeHero('sam', 'Sam', 'sapper'), makeHero('pim', 'Pim', 'burglar'));
  const k = s.campaign.board[0]!;
  const r = eng.apply(s, { type: 'startDelve', contractId: k.id, heroIds: opts.heroes ?? ['sam', 'brann'], entrance: 0, packs: {} });
  expect(r.error).toBeUndefined();
  s = r.state;
  s.delve!.monsters = [];
  s.delve!.rivals = null;
  s.delve!.traps = {};
  s.delve!.light = 20;
  return s;
}

function put(s: GameState, id: string, p: Pos): void {
  s.delve!.heroes.find((h) => h.heroId === id)!.at = { ...p };
}

function hero(s: GameState, id: string) {
  return s.delve!.heroes.find((h) => h.heroId === id)!;
}

function monster(s: GameState, kind: MonsterKind, p: Pos, awareness: 'asleep' | 'alert' | 'hunting' = 'asleep', id = `m${s.delve!.monsters.length + 1}`) {
  const def = MONSTERS[kind];
  const m: Monster = { id, kind, name: def.name, at: { ...p }, hp: def.hp, maxHp: def.hp, awareness, spawnedAt: { ...p } };
  s.delve!.monsters.push(m);
  return m;
}

function ok(s: GameState, cmd: Command, eng = e) {
  const r = eng.apply(s, cmd);
  expect(r.error).toBeUndefined();
  return r;
}

function act(s: GameState, heroId: string, action: ActionKind, target: ActionTarget, eng = e) {
  return ok(s, { type: 'act', heroId, action, target, focus: 0 }, eng);
}

function option(s: GameState, id: string, action: ActionKind, eng = e) {
  return eng.actions(s, id).find((a) => a.action === action);
}

function dx(s: GameState): DelveX {
  return s.delve as DelveX;
}

/** The V3.7 blast event (the contract still lists the old `{ type: 'blast', at }` shape too). */
function blastOf(ev: GameEvent[]) {
  return ev.find((x): x is { type: 'blast'; at: Pos; by: string; broke: Pos[]; collapsed: Pos[]; rubbled: Pos[] } => x.type === 'blast' && 'by' in x);
}

function give(s: GameState, id: string, kind: 'charge'): string {
  const h = hero(s, id);
  const it = { id: `t-${kind}-${h.pack.length}`, kind, name: 'Blasting charge', amount: 1, slots: 1 };
  h.pack.push(it);
  return it.id;
}

// Landmarks (offset col,row). L1 east hall is open floor around (16,7); the pit mouth is (10,3).
const HALL = at(1, 16, 7);

describe('V3.7 sapper', () => {
  describe('the satchel', () => {
    it('holds 3 charges in one slotless pack item; bought charges add; it is spent first and never dropped, given or stashed', () => {
      const s = delve();
      const sam = hero(s, 'sam');
      expect(sam.pack.filter((i) => i.kind === 'charge')).toMatchObject([{ amount: 3, slots: 0, name: 'Satchel: 3 charges' }]);
      expect(chargeCount(sam)).toBe(3);
      give(s, 'sam', 'charge');
      expect(chargeCount(hero(s, 'sam'))).toBe(4);
      expect(option(s, 'sam', 'drop')!.targets.map((t) => t.itemId)).toEqual(['t-charge-1']);
      put(s, 'sam', HALL);
      put(s, 'brann', at(1, 17, 7));
      expect(option(s, 'sam', 'give')!.targets.map((t) => t.itemId)).toEqual(['t-charge-1']);
      // Three sets use the satchel; the bought charge stays.
      let st = s;
      for (const p of [at(1, 15, 7), at(1, 16, 6), at(1, 16, 8)]) {
        st = act(st, 'sam', 'setCharge', { at: p, fuse: 2 }).state;
        hero(st, 'sam').acted = false;
      }
      expect(hero(st, 'sam').pack.filter((i) => i.kind === 'charge')).toMatchObject([{ id: 't-charge-1', slots: 1 }]);
      expect(chargeCount(hero(st, 'sam'))).toBe(1);
      // A sapper has no plain `charge` item action (setCharge covers it); a sellsword with a bought charge does.
      expect(option(st, 'sam', 'charge')).toBeUndefined();
    });

    it('a sellsword sets a bought charge (fuse 1) only on a locked door, chest, cracked or breakable wall next to them', () => {
      const s = delve({ heroes: ['brann'] });
      put(s, 'brann', at(1, 12, 3)); // next to the locked door (13,3) and the wall (13,2)
      expect(option(s, 'brann', 'charge')).toBeUndefined();
      const id = give(s, 'brann', 'charge');
      const o = option(s, 'brann', 'charge')!;
      expect(o.pick).toBe('hex');
      expect(o.area).toBe(2);
      expect(o.targets).toContainEqual({ at: at(1, 13, 3), itemId: id, fuse: 1 });
      expect(o.targets).toContainEqual({ at: at(1, 13, 2), itemId: id, fuse: 1 });
      expect(o.targets.some((t) => samePos(t.at!, at(1, 11, 3)))).toBe(false); // plain floor: no
      const r = act(s, 'brann', 'charge', { at: at(1, 13, 3) });
      expect(r.events).toContainEqual({ type: 'fuseSet', at: at(1, 13, 3), rounds: 1, by: 'brann' });
      expect(hero(r.state, 'brann').pack.some((i) => i.kind === 'charge')).toBe(false);
      expect(r.state.delve!.fuses).toMatchObject([{ at: at(1, 13, 3), rounds: 1, by: 'brann' }]);
    });
  });

  describe('fuses', () => {
    it('setCharge: adjacent floor, door, cracked or breakable wall, fuse 1 or 2; not pits, not a hex with a fuse already', () => {
      const s = delve();
      put(s, 'sam', at(1, 12, 3)); // pit mouth west, wall (13,2), locked door (13,3)
      const o = option(s, 'sam', 'setCharge')!;
      expect(o.pick).toBe('hex');
      expect(o.area).toBe(2);
      expect(o.targets).toContainEqual({ at: at(1, 12, 2), fuse: 1 });
      expect(o.targets).toContainEqual({ at: at(1, 12, 2), fuse: 2 });
      expect(o.targets).toContainEqual({ at: at(1, 13, 3), fuse: 1 }); // the door
      expect(o.targets).toContainEqual({ at: at(1, 13, 2), fuse: 2 }); // the wall
      expect(o.targets.some((t) => samePos(t.at!, at(1, 11, 4)))).toBe(false); // pit
      expect(o.targets.some((t) => samePos(t.at!, at(1, 12, 3)))).toBe(false); // own hex
      const pv = e.preview(s, 'sam', 'setCharge', { at: at(1, 12, 2), fuse: 2 });
      expect(pv.ok).toBe(true);
      expect(pv.noise).toBe(8);
      expect(pv.hexes!.length).toBeGreaterThan(6);
      expect(pv.outcomes[0]).toMatch(/Fuse 2/);
      const r = act(s, 'sam', 'setCharge', { at: at(1, 12, 2), fuse: 2 });
      expect(r.events).toContainEqual({ type: 'fuseSet', at: at(1, 12, 2), rounds: 2, by: 'sam' });
      hero(r.state, 'sam').acted = false;
      expect(option(r.state, 'sam', 'setCharge')!.targets.some((t) => samePos(t.at!, at(1, 12, 2)))).toBe(false);
      // Only sappers.
      put(s, 'brann', at(1, 12, 2));
      expect(option(s, 'brann', 'setCharge')).toBeUndefined();
    });

    it('fuse 2 blows at the end of the second world phase, fuse 1 at the end of the first; the blast event names the setter', () => {
      const s = delve();
      put(s, 'sam', HALL);
      put(s, 'brann', at(1, 14, 8));
      let st = act(s, 'sam', 'setCharge', { at: at(1, 17, 7), fuse: 2 }).state;
      let r = ok(st, { type: 'endTurn' });
      expect(r.events.some((x) => x.type === 'blast')).toBe(false);
      expect(r.state.delve!.fuses).toMatchObject([{ at: at(1, 17, 7), rounds: 1 }]);
      r = ok(r.state, { type: 'endTurn' });
      expect(blastOf(r.events)).toMatchObject({ at: at(1, 17, 7), by: 'sam', broke: [] });
      expect(r.state.delve!.fuses).toEqual([]);
      // Fuse 1.
      st = act(s, 'sam', 'setCharge', { at: at(1, 17, 7), fuse: 1 }).state;
      r = ok(st, { type: 'endTurn' });
      expect(blastOf(r.events)?.by).toBe('sam');
    });

    it('throwCharge: range 3 in sight, fuse 1, from the satchel; not onto a lit fuse', () => {
      const s = delve();
      put(s, 'sam', at(1, 14, 7));
      const o = option(s, 'sam', 'throwCharge')!;
      expect(o.targets.some((t) => samePos(t.at!, at(1, 17, 7)))).toBe(true); // 3 away
      expect(o.targets.some((t) => samePos(t.at!, at(1, 18, 7)))).toBe(false); // 4 away (the exit)
      const r = act(s, 'sam', 'throwCharge', { at: at(1, 17, 7) });
      expect(r.events).toContainEqual({ type: 'fuseSet', at: at(1, 17, 7), rounds: 1, by: 'sam' });
      expect(chargeCount(hero(r.state, 'sam'))).toBe(2);
      hero(r.state, 'sam').acted = false;
      expect(option(r.state, 'sam', 'throwCharge')!.targets.some((t) => samePos(t.at!, at(1, 17, 7)))).toBe(false);
    });
  });

  describe('the blast', () => {
    it('4 within 1 and thrown back, 2 within 2, nothing at 3; kills count for the setter; noise 8 reaches the level below', () => {
      const s = delve({ heroes: ['sam'] });
      put(s, 'sam', at(1, 15, 7)); // next to the blast: thrown back to (14,7), 0 damage
      const near = monster(s, 'orc', at(1, 17, 7)); // 1 from the blast at (16,7): 4 dmg, pushed to (18,7)
      const far = monster(s, 'orc', at(1, 16, 5)); // 2 away: 2 dmg, stays
      const out = monster(s, 'rats', at(1, 16, 4)); // 3 away: nothing
      const below = monster(s, 'orc', at(2, 16, 7)); // the level below, same column: hears noise 8
      const st = act(s, 'sam', 'setCharge', { at: at(1, 16, 7), fuse: 1 }).state;
      const r = ok(st, { type: 'endTurn' });
      expect(blastOf(r.events)).toMatchObject({ at: at(1, 16, 7), by: 'sam', broke: [] });
      expect(r.events).toContainEqual({ type: 'noise', at: at(1, 16, 7), radius: 8 });
      const d = r.state.delve!;
      const m = (id: string) => d.monsters.find((x) => x.id === id);
      expect(m(near.id)!.hp).toBe(MONSTERS.orc.hp - 4);
      expect(m(near.id)!.at).toEqual(at(1, 18, 7));
      expect(r.events).toContainEqual({ type: 'shoved', id: near.id, from: at(1, 17, 7), to: at(1, 18, 7) });
      expect(m(far.id)!.hp).toBe(MONSTERS.orc.hp - 2);
      expect(m(far.id)!.at).toEqual(at(1, 16, 5));
      expect(m(out.id)!.hp).toBe(MONSTERS.rats.hp);
      expect(m(below.id)!.awareness).not.toBe('asleep');
      expect(hero(r.state, 'sam').at).toEqual(at(1, 14, 7));
      // Hurt enough to kill: the kill is Sam's.
      const k = delve({ heroes: ['sam'] });
      put(k, 'sam', at(1, 15, 7));
      monster(k, 'rats', at(1, 17, 7)).hp = 3;
      const kr = ok(act(k, 'sam', 'setCharge', { at: at(1, 16, 7), fuse: 1 }).state, { type: 'endTurn' });
      expect(kr.events.some((x) => x.type === 'monsterDied')).toBe(true);
      expect(kr.state.delve!.kills['sam']).toBe(1);
    });

    it('the inner ring is pushed with shove outcomes: an orc beside the pit mouth goes over, the fall is the setter\'s kill', () => {
      const s = delve({ heroes: ['sam'] });
      put(s, 'sam', at(1, 12, 2));
      const orc = monster(s, 'orc', at(1, 11, 3)); // the pit (10,3) is straight behind it from (12,3)
      const st = act(s, 'sam', 'setCharge', { at: at(1, 12, 3), fuse: 1 }).state;
      const r = ok(st, { type: 'endTurn' });
      expect(r.events.some((x) => x.type === 'fell' && x.id === orc.id)).toBe(true);
      expect(r.state.delve!.monsters.some((x) => x.id === orc.id)).toBe(false); // 4 + the 7 of two levels
      expect(r.state.delve!.kills['sam']).toBe(1);
    });

    it('blast shield: the setter takes 0, other heroes half (2 within 1, 1 within 2); a rival\'s charge hurts heroes in full', () => {
      const s = delve({ heroes: ['sam', 'brann', 'pim'] });
      put(s, 'sam', at(1, 15, 7));
      put(s, 'brann', at(1, 17, 7));
      put(s, 'pim', at(1, 16, 5));
      const hp = { sam: hero(s, 'sam').hp, brann: hero(s, 'brann').hp, pim: hero(s, 'pim').hp };
      const r = ok(act(s, 'sam', 'setCharge', { at: at(1, 16, 7), fuse: 1 }).state, { type: 'endTurn' });
      expect(hero(r.state, 'sam').hp).toBe(hp.sam);
      expect(hero(r.state, 'brann').hp).toBe(hp.brann - 2);
      expect(hero(r.state, 'pim').hp).toBe(hp.pim - 1);
      // Even the setter is thrown back.
      expect(hero(r.state, 'sam').at).toEqual(at(1, 14, 7));
      expect(hero(r.state, 'brann').at).toEqual(at(1, 18, 7));
      // Someone else's fuse: full damage.
      const f = delve({ heroes: ['brann'] });
      put(f, 'brann', at(1, 17, 7));
      dx(f).fuses = [{ at: at(1, 16, 7), rounds: 1, by: 'r9' }];
      const fr = ok(f, { type: 'endTurn' });
      expect(hero(fr.state, 'brann').hp).toBe(hp.brann - 4);
    });

    it('opens locked doors and chests within 1 (loot on the ground)', () => {
      const s = delve({ heroes: ['sam'] });
      put(s, 'sam', at(1, 11, 3));
      const st = act(s, 'sam', 'setCharge', { at: at(1, 12, 3), fuse: 1 }).state; // the locked door (13,3) is 1 away
      const r = ok(st, { type: 'endTurn' });
      expect(r.state.delve!.doors[posKey(at(1, 13, 3))]).toMatchObject({ open: true, locked: false });
      expect(r.events).toContainEqual({ type: 'doorChanged', at: at(1, 13, 3), open: true, locked: false });
      // The locked chest c2 at (17,1).
      const c = delve({ heroes: ['sam'] });
      put(c, 'sam', at(1, 15, 1));
      const cr = ok(act(c, 'sam', 'setCharge', { at: at(1, 16, 1), fuse: 1 }).state, { type: 'endTurn' });
      const chest = cr.state.delve!.chests.find((x) => x.id === 'c2')!;
      expect(chest.opened).toBe(true);
      expect(cr.events.some((x) => x.type === 'chestOpened' && x.id === 'c2')).toBe(true);
      expect(cr.state.delve!.ground.some((g) => samePos(g.at, at(1, 17, 1)) && g.items.length > 0)).toBe(true);
    });
  });

  describe('blasting the floor (20.3a)', () => {
    it('a charge on a bridge drops the floor next to the pit, and the hero on it, into the Hollow; the hole is a pit from then on', () => {
      const s = delve({ heroes: ['sam', 'brann'] });
      put(s, 'sam', at(2, 13, 3));
      put(s, 'brann', at(2, 11, 3)); // the railed bridge end, over the column
      const hp = hero(s, 'brann').hp;
      const pv = e.preview(s, 'sam', 'setCharge', { at: at(2, 12, 3), fuse: 1 });
      expect(pv.modifiers).toContain('Floor collapses into the pit: 2 hexes'); // (11,3) and the railed (12,4), both beside the column
      expect(pv.warning).toMatch(/floor under Brann collapses.*1 level.*Hollow/);
      expect(pv.confirm).toBe(true);
      const plan = blastPreview({ w, s: s as GameStateX, d: s.delve as DelveX, ev: [] }, at(2, 12, 3));
      expect(plan.collapsed).toEqual(expect.arrayContaining([at(2, 11, 3), at(2, 12, 4)]));
      expect(plan.collapsed).toHaveLength(2);
      expect(plan.rubbled).toContainEqual(at(2, 12, 3));
      expect(plan.hit).toEqual(expect.arrayContaining(['sam', 'brann']));
      const r = ok(act(s, 'sam', 'setCharge', { at: at(2, 12, 3), fuse: 1 }).state, { type: 'endTurn' });
      const bl = blastOf(r.events)!;
      expect(bl.collapsed).toHaveLength(2);
      expect(bl.rubbled).toContainEqual(at(2, 12, 3));
      expect(r.events.some((x) => x.type === 'fell' && x.id === 'brann' && x.levels === 1)).toBe(true);
      const b = hero(r.state, 'brann');
      expect(b.at.level).toBe(3);
      expect(b.hp).toBe(hp - 2 - 4); // half the blast, then the fall
      const d = r.state.delve as DelveX;
      expect(d.collapsed).toContain(posKey(at(2, 11, 3)));
      expect(kindAt(w, d, at(2, 12, 4))).toBe('pit'); // the railing went with it
      expect(kindAt(w, d, at(2, 11, 3))).toBe('pit');
      expect(kindAt(w, d, at(2, 12, 3))).toBe('rubble');
      // The new pit: a fall target, a jump target, an edge risk, not walkable, seen through; a later blast widens it.
      expect(e.fallInfo(r.state, at(2, 11, 3))?.to.level).toBe(3);
      put(r.state, 'sam', at(2, 12, 3));
      hero(r.state, 'sam').moved = false;
      hero(r.state, 'sam').acted = false;
      expect(option(r.state, 'sam', 'jump')!.targets).toContainEqual({ at: at(2, 11, 3) });
      expect(e.edgeRisk(r.state, 'sam')).not.toBeNull();
      expect(e.reachable(r.state, 'sam', false).some((x) => samePos(x.to, at(2, 11, 3)))).toBe(false);
      expect(e.visibility(r.state).visible.has(posKey(at(2, 10, 2)))).toBe(true);
      const again = blastPreview({ w, s: r.state as GameStateX, d, ev: [] }, at(2, 11, 2));
      expect(again.collapsed).toContainEqual(at(2, 11, 2)); // floor next to the new hole goes too
      // Falling from Level 1 through the new hole reaches the Hollow.
      expect(e.fallInfo(r.state, at(1, 11, 4))?.levels).toBe(2);
    });

    it('a charge in the middle of a room turns the ring to rubble (move 2) and nothing collapses; Dig clears it', () => {
      const s = delve({ heroes: ['sam'] });
      put(s, 'sam', at(1, 15, 7));
      const r = ok(act(s, 'sam', 'setCharge', { at: at(1, 16, 7), fuse: 1 }).state, { type: 'endTurn' });
      const bl = blastOf(r.events)!;
      expect(bl.collapsed).toEqual([]);
      expect(bl.rubbled).toHaveLength(7);
      const d = r.state.delve as DelveX;
      expect(kindAt(w, d, at(1, 16, 7))).toBe('rubble');
      put(r.state, 'sam', at(1, 15, 7));
      hero(r.state, 'sam').moved = false;
      hero(r.state, 'sam').acted = false;
      expect(e.reachable(r.state, 'sam', false).find((x) => samePos(x.to, at(1, 16, 7)))!.cost).toBe(2);
      const dug = act(r.state, 'sam', 'dig', { at: at(1, 16, 7) }).state;
      expect(kindAt(w, dug.delve as DelveX, at(1, 16, 7))).toBe('floor');
    });

    it('never touches stairs, exits, doors, lifts, chests or unbreakable floor; the Hollow only rubbles', () => {
      const s = delve({ heroes: ['sam'] });
      put(s, 'sam', at(1, 3, 6)); // next to the stairs (2,7) and the door (3,5)
      const r = ok(act(s, 'sam', 'setCharge', { at: at(1, 3, 7), fuse: 1 }).state, { type: 'endTurn' });
      const bl = blastOf(r.events)!;
      const d = r.state.delve as DelveX;
      expect(kindAt(w, d, at(1, 2, 7))).toBe('stairs');
      expect(bl.rubbled.some((p) => samePos(p, at(1, 2, 7)))).toBe(false);
      expect(bl.collapsed).toEqual([]);
      // A chest's hex and an unbreakable floor hex stay floor; the exit stays an exit.
      const c = delve({ heroes: ['sam'] });
      put(c, 'sam', at(1, 16, 1));
      (c.delve as DelveX).ground.push({ at: at(1, 16, 2), items: [] });
      const castle = structuredClone(testCastle);
      castle.levels[0]!.tiles[hexKey(at(1, 15, 1))]!.unbreakable = true;
      const eng = createEngine(castle);
      const c2 = delve({ heroes: ['sam'], castle });
      put(c2, 'sam', at(1, 16, 1));
      const cr = ok(act(c2, 'sam', 'setCharge', { at: at(1, 17, 2), fuse: 1 }, eng).state, { type: 'endTurn' }, eng);
      const cb = blastOf(cr.events)!;
      expect(cb.rubbled.some((p) => samePos(p, at(1, 17, 1)))).toBe(false); // chest c2
      expect(cb.rubbled.some((p) => samePos(p, at(1, 18, 2)))).toBe(true);
      const u = delve({ heroes: ['sam'], castle });
      put(u, 'sam', at(1, 14, 2));
      const ur = ok(act(u, 'sam', 'setCharge', { at: at(1, 15, 2), fuse: 1 }, eng).state, { type: 'endTurn' }, eng);
      expect(blastOf(ur.events)!.rubbled.some((p) => samePos(p, at(1, 15, 1)))).toBe(false);
      // Level 2's lift tile and the exit on Level 1 are never rubble.
      const l = delve({ heroes: ['sam'] });
      put(l, 'sam', at(2, 2, 6));
      const lr = ok(act(l, 'sam', 'setCharge', { at: at(2, 1, 6), fuse: 1 }).state, { type: 'endTurn' });
      expect(kindAt(w, lr.state.delve as DelveX, at(2, 1, 6))).toBe('lift');
      // The Hollow: rubble, never a collapse (nothing below).
      const h = delve({ heroes: ['sam'] });
      put(h, 'sam', at(3, 5, 5));
      const hr = ok(act(h, 'sam', 'setCharge', { at: at(3, 6, 5), fuse: 1 }).state, { type: 'endTurn' });
      const hb = blastOf(hr.events)!;
      expect(hb.collapsed).toEqual([]);
      expect(hb.rubbled.length).toBeGreaterThan(3);
    });
  });

  describe('breakable walls', () => {
    it('a built wall between two floor hexes on L1/L2 breaks; outer walls, pillars, cracked-by-dig, L3 and unbreakable walls do not', () => {
      const d = null;
      expect(breakableWall(w, d, at(1, 13, 2))).toBe(true); // pit hall | armory
      expect(breakableWall(w, d, at(1, 7, 3))).toBe(true); // pantry | pit hall
      expect(breakableWall(w, d, at(1, 0, 2))).toBe(false); // outer wall
      expect(breakableWall(w, d, at(1, 3, 3))).toBe(false); // pillar
      expect(breakableWall(w, d, at(1, 10, 0))).toBe(false); // top wall, void behind
      expect(breakableWall(w, d, at(3, 13, 2))).toBe(false); // the Hollow: never
      expect(breakableWall(w, d, at(2, 3, 5))).toBe(false); // cracked, not built (a charge still opens it)
      // Marked unbreakable: no.
      const castle = structuredClone(testCastle);
      castle.levels[0]!.tiles[hexKey(at(1, 13, 2))]!.unbreakable = true;
      expect(breakableWall(new World(castle), d, at(1, 13, 2))).toBe(false);
    });

    it('a charge on the wall breaks it to rubble (move 2, sight through); `broke` lists it; Dig clears the rubble to floor', () => {
      const s = delve({ heroes: ['sam'] });
      put(s, 'sam', at(1, 12, 2));
      const wall = at(1, 13, 2);
      expect(e.reachable(s, 'sam', false).some((x) => x.to.level === 1 && samePos(x.to, at(1, 14, 2)))).toBe(false);
      const st = act(s, 'sam', 'setCharge', { at: wall, fuse: 1 }).state;
      const r = ok(st, { type: 'endTurn' });
      const blast = blastOf(r.events)!;
      expect(blast).toMatchObject({ at: wall, by: 'sam' });
      expect(blast.broke).toContainEqual(wall);
      expect(r.state.delve!.blown).toContain(posKey(wall));
      expect(hero(r.state, 'sam').at).toEqual(at(1, 11, 2)); // thrown back by his own blast
      // Through the hole: rubble costs 2.
      put(r.state, 'sam', at(1, 12, 2));
      const reach = e.reachable(r.state, 'sam', false);
      expect(reach.find((x) => samePos(x.to, wall))!.cost).toBe(2);
      expect(reach.some((x) => samePos(x.to, at(1, 14, 2)))).toBe(true);
      expect(e.visibility(r.state).visible.has(posKey(at(1, 14, 2)))).toBe(true);
      // No second charge on the same hole; Dig clears it to floor.
      expect(option(r.state, 'sam', 'dig')!.targets).toContainEqual({ at: wall });
      const dug = act(r.state, 'sam', 'dig', { at: wall });
      expect(dug.events).toContainEqual({ type: 'dug', at: wall });
      expect(e.reachable(dug.state, 'sam', false).find((x) => samePos(x.to, wall))!.cost).toBe(1);
      expect(dx(dug.state).dug).toContain(posKey(wall));
    });

    it('a charge next to walls breaks every breakable one within 1 but not an unbreakable one; the preview says so', () => {
      const castle = structuredClone(testCastle);
      castle.levels[0]!.tiles[hexKey(at(1, 13, 3))] = { kind: 'wall', unbreakable: true }; // the locked door becomes an unbreakable wall
      const eng = createEngine(castle);
      const s = delve({ heroes: ['sam'], castle });
      put(s, 'sam', at(1, 11, 2));
      const pv = eng.preview(s, 'sam', 'setCharge', { at: at(1, 12, 2), fuse: 1 });
      expect(pv.modifiers).toContain('Breaks the wall');
      const r = ok(act(s, 'sam', 'setCharge', { at: at(1, 12, 2), fuse: 1 }, eng).state, { type: 'endTurn' }, eng);
      expect(blastOf(r.events)!.broke).toEqual([at(1, 13, 2)]);
      expect(r.state.delve!.blown).not.toContain(posKey(at(1, 13, 3)));
    });
  });
});
