// V3.7 (spec 20.3): the Sapper. Fused charges, the blast (damage rings, push,
// noise, locks, broken walls), the blast shield, the satchel and breakable walls.
//
// A charge is a `Fuse` in `Delve.fuses`: it counts down at the end of each world
// phase and goes off when `rounds` reaches 0 (fuse 1 = the end of the coming
// world phase). Walls it breaks go into `Delve.blown`; kindAt shows them as
// rubble until dug (`DelveX.dug`).

import { distance, posKey, posNeighbors, range, samePos, type Pos } from './hex';
import type { Fuse, HeroInDelve, Item } from './types';
import { BLAST_INNER_DMG, BLAST_NOISE, BLAST_OUTER_DMG } from './data';
import { say, type Ctx, type DelveX } from './state';
import { chestLoot, hd, hurtAny, makeNoise, nameOf, occupant, onMap, putOnGround, rivalsOnMap } from './common';
import { doorAt, fallColumn, fallDamage, kindAt, pitsNextTo, type World } from './world';
import { fall, figure, push } from './falls';

/** Engine-private: when a fuse was lit, so one set during a world phase isn't counted down in that same phase. */
export interface FuseX extends Fuse {
  armedInWorld?: boolean;
}

// ---------------------------------------------------------------- the satchel

/** The Sapper's satchel: one pack item, no slots, `amount` charges left. */
export function isSatchel(i: Item): boolean {
  return i.kind === 'charge' && i.slots === 0;
}

export function satchelName(n: number): string {
  return `Satchel: ${n} charge${n === 1 ? '' : 's'}`;
}

/** Charges a hero can spend: the satchel's plus bought ones in the pack. */
export function chargeCount(h: HeroInDelve): number {
  return h.pack.reduce((n, i) => n + (i.kind === 'charge' ? (isSatchel(i) ? i.amount : 1) : 0), 0);
}

/** Spend one charge: the satchel first, then a bought one. Returns the item spent from (null if none). */
export function spendCharge(h: HeroInDelve): Item | null {
  const sat = h.pack.find(isSatchel);
  if (sat && sat.amount > 0) {
    sat.amount -= 1;
    sat.name = satchelName(sat.amount);
    if (sat.amount === 0) h.pack.splice(h.pack.indexOf(sat), 1);
    return sat;
  }
  const i = h.pack.findIndex((x) => x.kind === 'charge');
  if (i < 0) return null;
  return h.pack.splice(i, 1)[0]!;
}

// ---------------------------------------------------------------- breakable walls

const STATIC_FLOORISH = ['floor', 'rubble', 'stairs', 'exit', 'door', 'lift'];

/** Floor-like by the map alone (doors count: a wall next to a doorway still separates). */
function floorishTile(w: World, p: Pos): boolean {
  const k = w.tile(p)?.kind;
  return !!k && STATIC_FLOORISH.includes(k);
}

function rockRoom(w: World, p: Pos): boolean {
  const t = w.tile(p);
  const room = w.levels.get(p.level)?.rooms.find((r) => r.id === t?.room);
  return room?.material === 'rock' || room?.material === 'earth';
}

/**
 * Can a blast break this wall (spec 20.3)? A built wall on Level 1 or 2 that stands
 * between two floor hexes (two floor-like neighbours that aren't next to each other),
 * not marked `unbreakable`, not cave rock (every floor beside it is rock or earth),
 * not a pillar, and not broken already.
 */
export function breakableWall(w: World, d: DelveX | null, p: Pos): boolean {
  const t = w.tile(p);
  if (!t || t.kind !== 'wall' || t.unbreakable) return false;
  if (p.level !== 1 && p.level !== 2) return false;
  if (d?.blown.includes(posKey(p))) return false;
  const fl = posNeighbors(p).filter((n) => floorishTile(w, n));
  if (fl.length < 2 || fl.every((n) => rockRoom(w, n))) return false;
  for (let i = 0; i < fl.length; i++) for (let j = i + 1; j < fl.length; j++) if (distance(fl[i]!, fl[j]!) > 1) return true;
  return false;
}

/** A hex a charge can be set on or break into: cracked or breakable wall. */
export function blastableWall(w: World, d: DelveX | null, p: Pos): boolean {
  return kindAt(w, d, p) === 'cracked' || breakableWall(w, d, p);
}

// ---------------------------------------------------------------- fuses

export function fuses(d: DelveX): FuseX[] {
  return (d.fuses ??= []) as FuseX[];
}

export function fuseAt(d: DelveX, p: Pos): FuseX | undefined {
  return fuses(d).find((f) => samePos(f.at, p));
}

/** Light a fuse at `at`. During a world phase it's armed for the next one, so the player sees the marker first. */
export function setFuse(c: Ctx, at: Pos, rounds: number, by: string): FuseX {
  const f: FuseX = { at: { ...at }, rounds, by };
  if (c.d.phase === 'world') f.armedInWorld = true;
  fuses(c.d).push(f);
  c.ev.push({ type: 'fuseSet', at: { ...at }, rounds, by });
  return f;
}

/** The hexes a blast at `at` touches (within 2, same level, on the map). */
export function blastArea(w: World, at: Pos, radius = 2): Pos[] {
  return range(at, radius).map((x) => ({ level: at.level, ...x })).filter((p) => !!w.tile(p));
}

/** Walls a blast at `at` would break now. */
export function wallsBrokenBy(w: World, d: DelveX | null, at: Pos): Pos[] {
  return blastArea(w, at, 1).filter((p) => blastableWall(w, d, p));
}

// ---------------------------------------------------------------- the floor (spec 20.3a)

/**
 * Floor within 1 of a blast that can give way: floor or raised floor (by kindAt, so a dug hole
 * counts and rubble doesn't), not `unbreakable`, no chest and no hoard on it. Stairs, lift, exits,
 * doors, braziers, tall props and the sealed stair aren't floor and never go.
 */
function softFloor(c: Ctx, p: Pos): boolean {
  const t = c.w.tile(p);
  if (!t || t.unbreakable || kindAt(c.w, c.d, p) !== 'floor') return false;
  if (c.d.chests.some((x) => samePos(x.at, p))) return false;
  if (c.d.ground.some((g) => samePos(g.at, p) && g.items.some((i) => i.kind === 'hoard'))) return false;
  return true;
}

/** Where floor at `p` would land if it collapsed now (the first non-pit level below), for previews. */
export function collapseDrop(w: World, d: DelveX | null, p: Pos): { level: number; levels: number; damage: number } | null {
  for (let lv = p.level + 1; w.levels.has(lv); lv++) {
    if (kindAt(w, d, { level: lv, q: p.q, r: p.r }) === 'pit') continue;
    return { level: lv, levels: lv - p.level, damage: fallDamage(lv - p.level) };
  }
  return null;
}

export interface BlastPlan {
  /** Walls that break (cracked and breakable built walls within 1). */
  broke: Pos[];
  /** Floor that drops into the pit column (next to a pit, with a level below). */
  collapsed: Pos[];
  /** Floor that turns to rubble. */
  rubbled: Pos[];
  /** Figures (ids) within 2: everything the blast damages. */
  hit: string[];
}

/** What a blast at `at` would do to the map and who it hits, by the state as it is now (for the preview and the blast). */
export function blastPreview(c: Ctx, at: Pos): BlastPlan {
  const near = blastArea(c.w, at, 1);
  const broke = near.filter((p) => blastableWall(c.w, c.d, p));
  const collapsed: Pos[] = [];
  const rubbled: Pos[] = [];
  const below = c.w.levels.has(at.level + 1);
  for (const p of near) {
    if (!softFloor(c, p)) continue;
    // Next to a pit (an original one or one already collapsed), with somewhere to fall: it goes.
    if (below && pitsNextTo(c.w, c.d, p).length) collapsed.push(p);
    else rubbled.push(p);
  }
  const hit: string[] = [];
  for (const p of blastArea(c.w, at, 2)) {
    const o = occupant(c, p);
    if (o) hit.push(o.id);
  }
  return { broke, collapsed, rubbled, hit };
}

/** Count every fuse down at the end of a world phase; those at 0 go off, in the order they were lit. */
export function tickFuses(c: Ctx): void {
  const list = fuses(c.d);
  if (!list.length) return;
  const due: FuseX[] = [];
  for (const f of list) {
    if (f.armedInWorld) {
      f.armedInWorld = undefined;
      continue;
    }
    f.rounds -= 1;
    if (f.rounds <= 0) due.push(f);
  }
  c.d.fuses = list.filter((f) => !due.includes(f));
  for (const f of due) blast(c, f.at, f.by);
}

// ---------------------------------------------------------------- the blast

function sameCrew(c: Ctx, a: string, b: string): boolean {
  const members = c.d.rivals?.members ?? [];
  return members.some((r) => r.id === a) && members.some((r) => r.id === b);
}

/** Blast damage to `id` after the shield (spec 20.3): the setter 0, the setter's own side half. */
export function shielded(c: Ctx, by: string, id: string, dmg: number): number {
  if (id === by) return 0;
  const byHero = !!hd(c, by);
  if (byHero && hd(c, id)) return Math.floor(dmg / 2);
  if (!byHero && sameCrew(c, by, id)) return Math.floor(dmg / 2);
  return dmg;
}

/**
 * A charge goes off at `at` (spec 20.3): 4 to everything within 1, 2 within 2; the inner ring
 * is pushed 1 hex away with all shove outcomes; locks within 1 open; cracked and breakable
 * walls within 1 break; noise 8 heard a level up and down. Kills count for `by`.
 */
export function blast(c: Ctx, at: Pos, by: string): void {
  const plan = blastPreview(c, at);
  const { broke, collapsed, rubbled } = plan;
  const near = blastArea(c.w, at, 1);
  // Walls, doors and chests within 1.
  for (const p of near) {
    const k = kindAt(c.w, c.d, p);
    if (k === 'cracked' || breakableWall(c.w, c.d, p)) {
      c.d.blown.push(posKey(p));
    } else if (k === 'door') {
      const door = doorAt(c.d, p);
      if (door && (!door.open || door.locked)) {
        door.open = true;
        door.locked = false;
        door.jammed = false;
        c.ev.push({ type: 'doorChanged', at: p, open: true, locked: false });
      }
    }
    const chest = c.d.chests.find((x) => samePos(x.at, p) && !x.opened);
    if (chest) {
      chest.opened = true;
      chest.locked = false;
      const items = chestLoot(c, chest.tier);
      putOnGround(c, chest.at, items);
      c.ev.push({ type: 'chestOpened', id: chest.id, items });
    }
  }
  c.w.fixedCache = null;
  c.ev.push({ type: 'blast', at: { ...at }, by, broke, collapsed, rubbled });
  const setter = hd(c, by) ? nameOf(c, by) : c.d.rivals?.members.find((r) => r.id === by)?.name;
  say(c, `${setter ? `${setter}'s charge` : 'A charge'} goes off. BOOM.${broke.length ? ' The wall comes down.' : ''}${collapsed.length ? ' The floor gives way.' : ''}`);
  // Damage: inner ring 4, outer ring 2; the shield for the setter's side.
  const hurt: [string, Pos][] = [];
  for (const m of onMap(c)) if (m.kind !== 'gloam' && m.at.level === at.level && distance(m.at, at) <= 2) hurt.push([m.id, m.at]);
  for (const r of rivalsOnMap(c)) if (r.at.level === at.level && distance(r.at, at) <= 2) hurt.push([r.id, r.at]);
  for (const h of c.d.heroes) if ((h.status === 'active' || h.status === 'downed') && h.at.level === at.level && distance(h.at, at) <= 2) hurt.push([h.heroId, h.at]);
  const pr = c.d.prisoner;
  if (pr && !pr.dead && !pr.out && pr.at.level === at.level && distance(pr.at, at) <= 2) hurt.push([pr.id, pr.at]);
  const credit = hd(c, by) ? by : null;
  for (const [id, p] of hurt) {
    const dmg = shielded(c, by, id, distance(p, at) <= 1 ? BLAST_INNER_DMG : BLAST_OUTER_DMG);
    if (dmg > 0) hurtAny(c, id, dmg, hd(c, id) ? null : (credit ?? by), { noise: false });
  }
  // Spec 20.3a: the floor. Rubble first, then the collapse: whoever stands on it falls down the column.
  for (const p of rubbled) c.d.blown.push(posKey(p));
  if (collapsed.length) {
    const col = (c.d.collapsed ??= []);
    for (const p of collapsed) {
      const key = posKey(p);
      col.push(key);
      c.d.ropes = c.d.ropes.filter((k) => k !== key);
      if (c.d.fuses) c.d.fuses = c.d.fuses.filter((f) => !samePos(f.at, p));
    }
    for (const p of collapsed) {
      // Loot on the hex goes down with it.
      const g = c.d.ground.find((x) => samePos(x.at, p));
      if (g) {
        const landing = fallColumn(c.w, c.d, p);
        c.d.ground = c.d.ground.filter((x) => x !== g);
        if (landing) putOnGround(c, landing.to, g.items);
      }
      const o = occupant(c, p);
      if (o) {
        say(c, `The floor drops out from under ${nameOf(c, o.id)}.`);
        fall(c, o.id, p, credit);
      }
    }
  }
  // The inner ring is thrown back (shove outcomes: pits, walls, fire, each other); not those who already fell.
  for (const [id, p] of hurt) {
    if (distance(p, at) !== 1) continue;
    const f = figure(c, id);
    if (!f) continue;
    const now = f.kind === 'hero' ? f.h.at : f.kind === 'monster' ? f.m.at : f.kind === 'rival' ? f.r.at : c.d.prisoner!.at;
    if (!samePos(now, p)) continue;
    push(c, id, at, credit);
  }
  makeNoise(c, at, BLAST_NOISE, { otherLevels: true });
}
