// Section 10 and 16.5: the Lantern Sisters. Neutral looters who turn on the
// party when attacked or blocked; each sister has a class and uses the heroes'
// own tricks (overwatch and knockback shots, veil and smoke, sleep darts), shown
// as intents the round before like monsters.

import { distance, posKey, posNeighbors, samePos, type Pos } from './hex';
import type { Intent, Item } from './types';
import { BOW_RANGE, KNOCKBACK_RANGE, SISTER, SISTER_DART_CHANCE, SISTERS_LEAVE_LIGHT, THROW_RANGE, VEIL_ROUNDS } from './data';
import { say, type Ctx, type HeroX, type RivalX } from './state';
import { chestLoot, hd, heroName, noteOnce, occupant, rivalsOnMap, roll, valueOf } from './common';
import { canEnter, distField, kindAt, los, within } from './world';
import { approach, attackSpots, blocked, exitsBy, hitRange, overwatchCheck, strike, targets, walk, type Target } from './ai';
import { push, pushOutcome } from './falls';
import { pusherFor, smokeOut } from './delve';

// ---------------------------------------------------------------- entering

function rivalEnter(c: Ctx): void {
  const cr = c.d.rivals;
  if (!cr || cr.entered || c.d.round < cr.entersRound) return;
  const at = cr.members[0]!.at;
  const spots: Pos[] = [];
  const seen = new Set([posKey(at)]);
  const q = [at];
  for (let i = 0; i < q.length && spots.length < cr.members.length; i++) {
    const p = q[i]!;
    if (canEnter(c.w, c.d, p) && kindAt(c.w, c.d, p) !== 'door' && !occupant(c, p)) spots.push(p);
    for (const n of posNeighbors(p)) {
      if (seen.has(posKey(n)) || !canEnter(c.w, c.d, n)) continue;
      seen.add(posKey(n));
      q.push(n);
    }
  }
  if (spots.length < cr.members.length) return; // blocked: try next round
  cr.entered = true;
  cr.members.forEach((r, i) => (r.at = spots[i]!));
  c.ev.push({ type: 'rivalsEnter', at });
  say(c, 'Lanterns at the door. Someone else is here.');
}

// ---------------------------------------------------------------- looting

interface LootGoal {
  at: Pos;
  chestId?: string;
  objective: boolean;
}

/**
 * What a sister goes for: unopened chests (anyone), and ground piles nobody stands on. Piles the
 * heroes left at chests they opened are the Burglar sister's business (spec 16.5).
 */
function lootGoals(c: Ctx, r: RivalX): LootGoal[] {
  const out: LootGoal[] = [];
  for (const ch of c.d.chests) if (!ch.opened && !ch.jammed) out.push({ at: ch.at, chestId: ch.id, objective: false });
  for (const g of c.d.ground) {
    if (!g.items.length) continue;
    if (c.d.heroes.some((h) => (h.status === 'active' || h.status === 'downed') && samePos(h.at, g.at))) continue;
    const atChest = c.d.chests.some((ch) => ch.opened && samePos(ch.at, g.at));
    const objective = g.items.some((i) => i.kind === 'heirloom');
    if (atChest && r.cls !== 'burglar' && !objective) continue;
    out.push({ at: g.at, objective });
  }
  return out;
}

// ---------------------------------------------------------------- the kit (spec 16.5)

/** Heroes a sister can see: same level, in line of sight (the sisters carry their own lanterns). */
function heroesInSight(c: Ctx, r: RivalX, range: number): Target[] {
  return targets(c)
    .filter((t) => t.hero && within(t.at, r.at, range) && los(c.w, c.d, r.at, t.at))
    .sort((a, b) => distance(a.at, r.at) - distance(b.at, r.at) || (a.id < b.id ? -1 : 1));
}

function nearestHero(c: Ctx, r: RivalX): Target | undefined {
  const ts = targets(c).filter((t) => t.hero);
  const field = distField(c.w, c.d, [r.at], { stairs: true });
  ts.sort((a, b) => (field.get(posKey(a.at)) ?? 999) - (field.get(posKey(b.at)) ?? 999));
  return ts[0];
}

/** The kit intent a sister would use now, if any. */
function kitIntent(c: Ctx, r: RivalX): Intent | null {
  const cr = c.d.rivals!;
  if (r.intent?.kind === 'veil' && !r.veiled) return r.intent;
  if (cr.stance !== 'hostile') return null;
  switch (r.cls) {
    case 'ranger': {
      const kb = heroesInSight(c, r, KNOCKBACK_RANGE).find((t) => {
        const o = pushOutcome(c, pusherFor(r.at, t.at), t.at, t.id);
        return o.kind === 'fall' && !!o.fall;
      });
      if (kb) {
        const o = pushOutcome(c, pusherFor(r.at, kb.at), kb.at, kb.id);
        return { kind: 'shove', targetId: kb.id, to: o.dest, damage: [0, o.fall?.damage ?? 0] };
      }
      if (heroesInSight(c, r, BOW_RANGE).length) return null; // a shot
      // No hero in reach this round (not even after walking): wait with an arrow nocked.
      const t = nearestHero(c, r);
      if (t) {
        const path = approach(c, r.id, r.at, shootingSpots(c, r, t), SISTER.move, true) ?? [];
        const end = path[path.length - 1];
        if (end && within(end, t.at, BOW_RANGE) && los(c.w, c.d, end, t.at)) return null;
      }
      return { kind: 'overwatch', targetId: r.id };
    }
    case 'shadowmancer': {
      if ((r.smoke ?? 0) > 0 && cr.members.some((m) => m.hp > 0 && !m.goneOut && m.hp * 2 < m.maxHp)) {
        const t = heroesInSight(c, r, THROW_RANGE.smoke)[0];
        if (t) return { kind: 'smoke', targetId: t.id, to: { ...t.at } };
      }
      return null;
    }
    case 'burglar': {
      if ((r.darts ?? 0) > 0) {
        const t = heroesInSight(c, r, THROW_RANGE.dart)[0];
        if (t) return { kind: 'dart', targetId: t.id };
      }
      return null;
    }
  }
}

/** Carry out a kit intent. Returns true if it used the sister's turn. */
function useKit(c: Ctx, r: RivalX, it: Intent): boolean {
  const cr = c.d.rivals!;
  switch (it.kind) {
    case 'veil':
      r.veil = VEIL_ROUNDS;
      r.veiled = true;
      c.ev.push({ type: 'cast', by: r.id, spell: 'veil', targetId: r.id });
      say(c, `${r.name} melts into the shadows.`);
      return true;
    case 'overwatch':
      if (cr.stance !== 'hostile') return false;
      r.overwatch = true;
      c.ev.push({ type: 'cast', by: r.id, spell: 'overwatch' });
      say(c, `${r.name} nocks an arrow and waits.`);
      return true;
    case 'shove': {
      const t = targets(c).find((x) => x.id === it.targetId);
      if (cr.stance !== 'hostile' || !t?.hero || !within(t.at, r.at, KNOCKBACK_RANGE) || !los(c.w, c.d, r.at, t.at)) return false;
      say(c, `${r.name} aims to knock ${heroName(c, t.id)} off the edge.`);
      const roll2 = roll(c, r.id, 'Knockback shot', 2, SISTER.chance);
      if (roll2.hits < 2) {
        c.ev.push({ type: 'miss', attacker: r.id, target: t.id });
        return true;
      }
      c.ev.push({ type: 'cast', by: r.id, spell: 'knockback', targetId: t.id, at: { ...t.at } });
      push(c, t.id, pusherFor(r.at, t.at), null);
      return true;
    }
    case 'smoke': {
      const t = targets(c).find((x) => x.id === it.targetId);
      if (cr.stance !== 'hostile' || (r.smoke ?? 0) <= 0 || !t?.hero || !within(t.at, r.at, THROW_RANGE.smoke)) return false;
      r.smoke = (r.smoke ?? 1) - 1;
      c.ev.push({ type: 'thrown', by: r.id, kind: 'smoke', from: { ...r.at }, to: { ...t.at } });
      const hexes = smokeOut(c, t.at);
      c.ev.push({ type: 'cast', by: r.id, spell: 'smoke', at: { ...t.at }, hexes });
      say(c, `${r.name} drops a smoke bomb at ${heroName(c, t.id)}'s feet.`);
      return true;
    }
    case 'dart': {
      const t = targets(c).find((x) => x.id === it.targetId);
      if (cr.stance !== 'hostile' || (r.darts ?? 0) <= 0 || !t?.hero || !within(t.at, r.at, THROW_RANGE.dart) || !los(c.w, c.d, r.at, t.at)) return false;
      r.darts = (r.darts ?? 1) - 1;
      c.ev.push({ type: 'thrown', by: r.id, kind: 'dart', from: { ...r.at }, to: { ...t.at } });
      const rr = roll(c, r.id, 'Sleep dart', 1, SISTER_DART_CHANCE);
      c.ev.push({ type: 'cast', by: r.id, spell: 'dart', targetId: t.id, at: { ...t.at } });
      if (rr.hits) {
        const h = t.hero as HeroX;
        h.dozing = true;
        h.webbed = true;
        c.ev.push({ type: 'hit', attacker: r.id, target: t.id, damage: 0, crit: false });
        say(c, `${heroName(c, t.id)} slumps, drugged. Out for a turn.`);
      } else {
        c.ev.push({ type: 'miss', attacker: r.id, target: t.id });
      }
      return true;
    }
  }
  return false;
}

/**
 * A hero moved or acted (spec 16.5): a hostile Ranger sister on overwatch who sees them
 * within 6 shoots first. Called from the hero's move/act.
 */
export function rivalOverwatchFire(c: Ctx, heroId: string): void {
  const cr = c.d.rivals;
  if (!cr || cr.stance !== 'hostile') return;
  const h = hd(c, heroId);
  if (!h || h.status !== 'active' || h.veil > 0) return;
  for (const r of rivalsOnMap(c)) {
    if (!r.overwatch || !within(r.at, h.at, BOW_RANGE) || !los(c.w, c.d, r.at, h.at)) continue;
    r.overwatch = false;
    say(c, `${r.name} looses an arrow at ${heroName(c, heroId)}.`);
    c.ev.push({ type: 'cast', by: r.id, spell: 'overwatch', targetId: heroId, at: { ...h.at } });
    strike(c, r.id, heroId, SISTER.slots, SISTER.chance, SISTER.dmg, 'Overwatch');
    return;
  }
}

// ---------------------------------------------------------------- intents

/** The intent a sister shows for the coming world phase. */
export function planRival(c: Ctx, r: RivalX): Intent {
  const cr = c.d.rivals!;
  const kit = kitIntent(c, r);
  if (kit) return kit;
  if (cr.stance === 'hostile') {
    const t = nearestHero(c, r);
    if (!t) return { kind: 'wait' };
    const range = r.cls === 'ranger' ? BOW_RANGE : 1;
    if (within(t.at, r.at, range) && (range === 1 || los(c.w, c.d, r.at, t.at))) {
      return { kind: 'attack', targetId: t.id, to: { ...r.at }, damage: hitRange(SISTER.slots, SISTER.dmg, t.armor) };
    }
    const spots = r.cls === 'ranger' ? shootingSpots(c, r, t) : attackSpots(c, t.at, r.id);
    const path = approach(c, r.id, r.at, spots, SISTER.move, true) ?? [];
    const end = path[path.length - 1];
    if (end && within(end, t.at, range)) return { kind: 'attack', targetId: t.id, to: end, damage: hitRange(SISTER.slots, SISTER.dmg, t.armor) };
    return end ? { kind: 'move', to: end, targetId: t.id } : { kind: 'wait' };
  }
  if (cr.goal === 'leave') {
    const ex = exitsBy(c, r.at)[0];
    if (!ex) return { kind: 'wait' };
    const path = approach(c, r.id, r.at, [ex], SISTER.move, true) ?? [];
    return { kind: 'flee', to: path[path.length - 1] ?? r.at };
  }
  const g = bestLoot(c, r);
  if (!g) return { kind: 'wait' };
  if (within(r.at, g.at, 1)) return { kind: 'steal', to: { ...r.at } };
  const spots = [g.at, ...posNeighbors(g.at)].filter((p) => canEnter(c.w, c.d, p) && !blocked(c, p, r.id));
  const path = approach(c, r.id, r.at, spots, SISTER.move, true) ?? [];
  const end = path[path.length - 1];
  return end ? { kind: 'move', to: end } : { kind: 'wait' };
}

/** Hexes within bow range of `t` with a line to them (the Ranger sister shoots from there). */
function shootingSpots(c: Ctx, r: RivalX, t: Target): Pos[] {
  const out: Pos[] = [];
  for (let q = -BOW_RANGE; q <= BOW_RANGE; q++) {
    for (let rr = -BOW_RANGE; rr <= BOW_RANGE; rr++) {
      const p = { level: t.at.level, q: t.at.q + q, r: t.at.r + rr };
      const d = distance(p, t.at);
      if (d < 2 || d > BOW_RANGE) continue;
      if (!canEnter(c.w, c.d, p) || blocked(c, p, r.id) || !los(c.w, c.d, p, t.at)) continue;
      out.push(p);
    }
  }
  return out;
}

function bestLoot(c: Ctx, r: RivalX): LootGoal | null {
  const goals = lootGoals(c, r);
  if (!goals.length) return null;
  const field = distField(c.w, c.d, [r.at], { stairs: true });
  const reach = (g: LootGoal) => Math.min(999, ...[g.at, ...posNeighbors(g.at)].map((p) => field.get(posKey(p)) ?? 999));
  goals.sort((a, b) => reach(a) - reach(b));
  const g = goals[0]!;
  return reach(g) >= 999 ? null : g;
}

export function computeRivalIntents(c: Ctx): void {
  const cr = c.d.rivals;
  if (!cr || !cr.entered) return;
  for (const r of rivalsOnMap(c)) r.intent = planRival(c, r);
}

// ---------------------------------------------------------------- the phase

export function rivalsAct(c: Ctx): void {
  const cr = c.d.rivals;
  if (!cr) return;
  rivalEnter(c);
  if (!cr.entered) return;
  if (cr.stance !== 'hostile' && cr.goal !== 'leave' && ((cr.pickups ?? 0) >= 3 || c.d.light <= SISTERS_LEAVE_LIGHT)) cr.goal = 'leave';
  // Veils from earlier rounds fade (the one cast this phase lasts its full two rounds).
  for (const r of cr.members) if ((r.veil ?? 0) > 0) r.veil! -= 1;
  for (const r of rivalsOnMap(c)) {
    r.overwatch = false; // an unfired overwatch lapses
    // The kit first, as shown.
    const kit = r.intent && ['veil', 'overwatch', 'shove', 'smoke', 'dart'].includes(r.intent.kind) ? r.intent : null;
    if (kit) {
      if (cr.stance === 'hostile' && (overwatchCheck(c, r.id, r.at) || !rivalsOnMap(c).includes(r))) continue;
      if (useKit(c, r, kit)) {
        r.intent = undefined;
        continue;
      }
    }
    if (cr.stance === 'hostile') {
      const t = nearestHero(c, r);
      if (!t) continue;
      if (overwatchCheck(c, r.id, r.at) || !rivalsOnMap(c).includes(r)) continue;
      const range = r.cls === 'ranger' ? BOW_RANGE : 1;
      const inRange = () => within(t.at, r.at, range) && (range === 1 || los(c.w, c.d, r.at, t.at));
      if (!inRange()) {
        const spots = r.cls === 'ranger' ? shootingSpots(c, r, t) : attackSpots(c, t.at, r.id);
        const path = approach(c, r.id, r.at, spots, SISTER.move, true) ?? [];
        walk(c, r.id, r, path);
      }
      if (inRange() && t.hero?.status === 'active') {
        strike(c, r.id, t.id, SISTER.slots, SISTER.chance, SISTER.dmg, r.cls === 'ranger' ? 'Shot' : 'Attack');
      }
      continue;
    }
    if (cr.goal === 'leave') {
      const ex = exitsBy(c, r.at)[0];
      if (!ex) continue;
      if (samePos(ex, r.at)) {
        r.goneOut = true;
        c.ev.push({ type: 'out', id: r.id });
        continue;
      }
      const path = approach(c, r.id, r.at, [ex], SISTER.move, true) ?? [];
      walk(c, r.id, r, path);
      if (samePos(r.at, ex)) {
        r.goneOut = true;
        c.ev.push({ type: 'out', id: r.id });
      }
      continue;
    }
    // Loot.
    const g = bestLoot(c, r);
    if (!g) {
      // Nothing left for anyone: time to go. (A sister with nothing to do waits for the others.)
      if (!rivalsOnMap(c).some((m) => lootGoals(c, m).length)) cr.goal = 'leave';
      continue;
    }
    cr.goal = g.objective ? 'objective' : 'loot';
    if (!within(r.at, g.at, 1)) {
      const spots = [g.at, ...posNeighbors(g.at)].filter((p) => canEnter(c.w, c.d, p) && !blocked(c, p, r.id));
      const before = r.at;
      const path = approach(c, r.id, r.at, spots, SISTER.move, true);
      walk(c, r.id, r, path ?? []);
      if (samePos(before, r.at) && !within(r.at, g.at, 1)) {
        // Stuck: a hero in the way two rounds running makes them angry.
        cr.blocked = (cr.blocked ?? 0) + 1;
        if (cr.blocked >= 2 && cr.spotted) {
          cr.stance = 'hostile';
          c.ev.push({ type: 'rivalsStance', stance: 'hostile' });
          say(c, '"Move, or be moved." The sisters draw steel.');
        }
      } else cr.blocked = 0;
    }
    if (within(r.at, g.at, 1)) {
      let items: Item[] = [];
      if (g.chestId) {
        const ch = c.d.chests.find((x) => x.id === g.chestId)!;
        ch.opened = true;
        ch.locked = false;
        items = chestLoot(c, ch.tier);
        c.ev.push({ type: 'chestOpened', id: ch.id, items: [] });
        noteOnce(c, `The Lantern Sisters took the ${c.w.roomName(ch.at).toLowerCase()} chest.`);
      } else {
        const pile = c.d.ground.find((x) => samePos(x.at, g.at));
        if (pile) {
          items = pile.items;
          pile.items = [];
          c.d.ground = c.d.ground.filter((x) => x.items.length);
        }
        if (items.some((i) => i.kind === 'heirloom')) {
          say(c, 'A sister pockets the heirloom.');
          noteOnce(c, 'The Lantern Sisters took the heirloom.');
        }
      }
      r.loot.push(...items);
      cr.pickups = (cr.pickups ?? 0) + 1;
      c.ev.push({ type: 'looted', id: r.id, items });
    }
  }
  // Gone?
  for (const r of cr.members) if (r.goneOut && r.loot.length) {
    noteOnce(c, `The Lantern Sisters left with ${valueOf(r.loot)} gold in loot.`);
  }
}
