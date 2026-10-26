// The world phase: light burns, monsters act on their intents, rivals act,
// the Gloam hunts, then new intents. Also blasting charges at the end of
// the player phase. Monster behaviour: spec 7, 14.3, 14.4, 16.1, 16.3, 16.4.

import { clearHeard } from './hearing';
import { distance, posKey, posNeighbors, range, samePos, type Pos } from './hex';
import type { HeroInDelve, Intent, Item } from './types';
import {
  ARCHER_KEEP, ARCHER_RANGE, BURN_DMG, CAPTAIN_SHOUT_COOLDOWN, CAPTAIN_SHOUT_RANGE, GLOAM_CALM_FADE, GLOAM_DMG, GLOAM_MOVE, GLOAM_RISE_MAX,
  GLOAM_RISE_MIN, HICCUP_NOISE, ORC_SHOVE_CHANCE, SHOUT_NOISE,
} from './data';
import { chance, pick } from './rng';
import { say, type Ctx, type MonsterX } from './state';
import {
  activeHeroes, goHunting, hd, heroName, hurtAny, hurtHero, hurtPrisoner, isKit, killHero, loseQuarry, makeNoise, monsterStats, nameOf, noteOnce, occupant,
  onMap, releaseHold, rivalsOnMap, roll,
} from './common';
import { canEnter, dijkstra, isFloorish, kindAt, lanternPos, litSet, los, pathTo, visibleSet, within } from './world';
import { awayFrom, checkDelveEnd, pusherFor, refreshSight, setLight, unlitOnL3, visNow } from './delve';
import { push, pushOutcome } from './falls';
import { dragonSpecial, planDragon } from './dragon';
import {
  adjacentTo, approach, attackSpots, blocked, byDist, exitsBy, hamstringIntent, hamstringShot, hitRange, overwatchCheck, sees, strike, targets, walk, wardOf, type Target,
} from './ai';
import { HAMSTRING_RANGE } from './data';
import { computeRivalIntents, crewNotice, rivalsAct } from './rivals';
import { relockGate } from './ways';
import { tickFuses } from './charges';
import { faceToward, fleePlan, hasNoticed, isSneaking, noticeHero, perceivable, quietFeet, wouldNotice } from './stealth';

// ---------------------------------------------------------------- planning

interface Plan {
  intent: Intent;
  path: Pos[];
}

const WAIT: Plan = { intent: { kind: 'wait' }, path: [] };

/** Abilities that must be shown as an intent the round before they go off (spec 16.4). */
const SHOWN_FIRST: Intent['kind'][] = ['shout', 'grab', 'drag', 'shove', 'hamstring'];

/** What a cutpurse can lift: never the heirloom, the sally key (V4.0) or class kit (spec 26.5). */
function stealable(i: Item): boolean {
  return i.kind !== 'heirloom' && i.kind !== 'gatekey' && !isKit(i);
}

function canSteal(t: Target): boolean {
  return !!t.hero && t.hero.pack.some(stealable);
}

function chooseTarget(c: Ctx, m: MonsterX, lit: Set<string>, prefer?: string): Target | null {
  if (m.awareness === 'asleep') return null;
  const all = targets(c);
  // A ghoul keeps at the hero it holds.
  if (m.holding) {
    const held = all.find((t) => t.id === m.holding);
    if (held && adjacentTo(held.at, m.at)) return held;
  }
  // V3.7 (spec 20.1): heroes it has noticed are seen by plain sight; others by the noticing rule (light, sneaking, facing).
  const seen = all.filter((t) => perceivable(c, m, t, lit, (a, b, L) => sees(c, a, b, L)));
  if (prefer) {
    const p = all.find((t) => t.id === prefer);
    if (p && (seen.includes(p) || (m.awareness === 'hunting' && p.at.level === m.at.level && distance(p.at, m.at) <= 2))) return p;
  }
  if (seen.length) return seen.sort(byDist(m.at))[0]!;
  if (m.kind === 'berserker' && m.awareness === 'hunting') {
    const near = all.filter((t) => t.at.level === m.at.level && distance(t.at, m.at) <= 10).sort(byDist(m.at));
    return near[0] ?? null;
  }
  return null;
}

/** Orc (adjacent) or archer (ranged, spec 16.4): shove instead of attack when the hero's back is to an unrailed pit. */
function edgeShove(c: Ctx, m: MonsterX, from: Pos, t: Target, path: Pos[]): Plan | null {
  if ((m.kind !== 'orc' && m.kind !== 'archer') || !t.hero) return null;
  const o = pushOutcome(c, pusherFor(from, t.at), t.at, t.id);
  if (o.kind !== 'fall' || !o.fall) return null;
  return { intent: { kind: 'shove', targetId: t.id, to: o.dest, damage: [0, o.fall.damage] }, path };
}

/**
 * Patrol (spec 16.1): walk the move allowance along the route toward the next waypoint, on
 * through it when there's movement left. `routeAfter` is the waypoint to head for afterwards.
 */
function patrolPlan(c: Ctx, m: MonsterX, move: number): Plan {
  const route = m.route;
  if (!route || route.length < 2) return WAIT;
  let idx = (m.routeIndex ?? 0) % route.length;
  let cur = m.at;
  let budget = move;
  const path: Pos[] = [];
  for (let guard = 0; budget > 0 && guard < route.length + 2; guard++) {
    const wp = route[idx]!;
    if (samePos(cur, wp)) {
      idx = (idx + 1) % route.length;
      continue;
    }
    const nodes = dijkstra(c.w, c.d, cur, { enter: (p) => !blocked(c, p, m.id), stairs: false, budget });
    const n = nodes.get(posKey(wp));
    const taken = occupant(c, wp);
    if (n && (!taken || taken.id === m.id)) {
      path.push(...pathTo(nodes, wp));
      budget -= n.cost;
      cur = wp;
      idx = (idx + 1) % route.length;
      continue;
    }
    // Can't reach the waypoint this round: get as close as the budget allows.
    const seg = approach(c, m.id, cur, [wp], budget, false) ?? [];
    path.push(...seg);
    break;
  }
  if (!path.length) return WAIT;
  m.routeAfter = idx;
  return { intent: { kind: 'move', to: path[path.length - 1]! }, path };
}

/** Hexes an archer wants to shoot `t` from: ARCHER_KEEP..ARCHER_RANGE away with a line to the target. */
function archerSpots(c: Ctx, m: MonsterX, t: Pos): Pos[] {
  const out: Pos[] = [];
  for (const h of range(t, ARCHER_RANGE)) {
    const p = { level: t.level, ...h };
    const d = distance(p, t);
    if (d < ARCHER_KEEP || !canEnter(c.w, c.d, p) || blocked(c, p, m.id) || !los(c.w, c.d, p, t)) continue;
    out.push(p);
  }
  return out;
}

function archerPlan(c: Ctx, m: MonsterX, t: Target, move: number, lit: Set<string>, noAbility: boolean): Plan {
  const st = monsterStats(m);
  const shot = (to: Pos, path: Pos[]): Plan => {
    const sh = noAbility ? null : edgeShove(c, m, to, t, path);
    if (sh) {
      m.shoveFrom = { ...to };
      return sh;
    }
    // V3.7 (spec 20.5): a hero closing in and not yet rooted gets an arrow in the leg first.
    const ham = noAbility ? null : hamstringIntent(c, to, t);
    if (ham) return { intent: ham, path };
    return { intent: { kind: 'attack', targetId: t.id, to, damage: hitRange(st.slots, st.dmg, t.armor) }, path };
  };
  const d = m.at.level === t.at.level ? distance(m.at, t.at) : 99;
  if (d > 1 && d <= ARCHER_RANGE && los(c.w, c.d, m.at, t.at) && sees(c, m.at, t.at, lit)) return shot(m.at, []);
  // Too close or too far: find a shooting spot within reach (backing off when adjacent).
  const spots = archerSpots(c, m, t.at);
  const nodes = dijkstra(c.w, c.d, m.at, { enter: (p) => !blocked(c, p, m.id), stairs: m.awareness === 'hunting', budget: move });
  let best: Pos | null = null;
  let bestScore = Infinity;
  for (const n of nodes.values()) {
    if (!spots.some((s) => samePos(s, n.p))) continue;
    if (!samePos(n.p, m.at) && occupant(c, n.p)) continue;
    const dd = distance(n.p, t.at);
    // Prefer 3 away (middle of the band), then a short walk.
    const score = Math.abs(dd - 3) * 100 + n.cost;
    if (score < bestScore) {
      bestScore = score;
      best = n.p;
    }
  }
  if (best) {
    const path = samePos(best, m.at) ? [] : pathTo(nodes, best);
    return shot(best, path);
  }
  if (d <= 1) {
    // Nowhere good to back off to: shoot point-blank.
    return shot(m.at, []);
  }
  const path = approach(c, m.id, m.at, spots.length ? spots : attackSpots(c, t.at, m.id), move, m.awareness === 'hunting') ?? [];
  if (path.length) return { intent: { kind: 'move', to: path[path.length - 1]!, targetId: t.id }, path };
  return WAIT;
}

export function planMonster(c: Ctx, m: MonsterX, lit: Set<string>, opts: { noAbility?: boolean } = {}): Plan {
  if (m.kind === 'gloam') return planGloam(c, m, lit);
  if (m.kind === 'dragon') return planDragon(c, m);
  if (m.awareness === 'asleep' || m.buried) return WAIT;
  const st = monsterStats(m);
  const move = (m.stuck ?? 0) > 0 ? 0 : st.move;
  const noAbility = !!opts.noAbility;
  // V3.7 (spec 20.2): feared: it runs from the caster with its whole move and does nothing else.
  if ((m.feared ?? 0) > 0) {
    const f = fleePlan(c, m, move);
    return { intent: { kind: 'flee', to: f.to }, path: f.path };
  }
  // Cutpurse with loot: run for the farthest exit.
  if (m.kind === 'cutpurse' && m.stolen) {
    const ex = exitsBy(c, m.at);
    const goal = ex[ex.length - 1];
    if (!goal) return WAIT;
    const path = approach(c, m.id, m.at, [goal], move, true) ?? [];
    return { intent: { kind: 'flee', to: path[path.length - 1] ?? m.at }, path };
  }
  // Wounded rats run.
  if (m.kind === 'rats' && m.hp <= 1) {
    const ts = targets(c).filter((t) => t.at.level === m.at.level);
    const nodes = dijkstra(c.w, c.d, m.at, { enter: (p) => !blocked(c, p, m.id), stairs: false, budget: move });
    let best = m.at;
    let bestD = -1;
    for (const n of nodes.values()) {
      if (!samePos(n.p, m.at) && occupant(c, n.p)) continue;
      const dd = Math.min(99, ...ts.map((t) => distance(t.at, n.p)));
      if (dd > bestD) {
        bestD = dd;
        best = n.p;
      }
    }
    return { intent: { kind: 'flee', to: best }, path: pathTo(nodes, best) };
  }
  const t = chooseTarget(c, m, lit, m.intent?.targetId);
  if (t) {
    // The captain rallies the orcs the first time it has a quarry, and every few rounds after (spec 16.4).
    if (m.kind === 'captain' && !noAbility && (m.shoutCooldown ?? 0) <= 0) {
      return { intent: { kind: 'shout', targetId: t.id, to: m.at }, path: [] };
    }
    if (m.kind === 'archer') return archerPlan(c, m, t, move, lit, noAbility);
    const near = samePos(t.at, m.at) ? false : adjacentTo(t.at, m.at);
    const steal = m.kind === 'cutpurse' && canSteal(t);
    const strikePlan = (to: Pos, path: Pos[]): Plan => {
      const sh = noAbility ? null : edgeShove(c, m, to, t, path);
      if (sh) {
        m.shoveFrom = { ...to };
        return sh;
      }
      // A ghoul grabs first, then tears at what it holds with an extra slot (spec 16.4).
      if (m.kind === 'ghoul' && t.hero) {
        if (m.holding === t.id) return { intent: { kind: 'attack', targetId: t.id, to, damage: hitRange(st.slots + 1, st.dmg, t.armor) }, path };
        if (!noAbility && !m.holding && !t.hero.grabbedBy) return { intent: { kind: 'grab', targetId: t.id, to }, path };
      }
      return {
        intent: steal
          ? { kind: 'steal', targetId: t.id, to }
          : { kind: 'attack', targetId: t.id, to, damage: hitRange(st.slots, st.dmg, t.armor) },
        path,
      };
    };
    if (m.kind === 'spider' && t.hero && !near) {
      // Webbed last round: drag them in (spec 16.4). Else web them when in reach.
      if (t.hero.webbed && !noAbility && within(m.at, t.at, 3)) {
        const to = { level: t.at.level, q: 2 * t.at.q - awayFrom(m.at, t.at).q, r: 2 * t.at.r - awayFrom(m.at, t.at).r };
        return { intent: { kind: 'drag', targetId: t.id, to }, path: [] };
      }
      if (within(m.at, t.at, 3) && sees(c, m.at, t.at, lit) && (m.lastWeb === undefined || c.d.round - m.lastWeb >= 2)) {
        return { intent: { kind: 'web', targetId: t.id }, path: [] };
      }
    }
    if (near) return strikePlan(m.at, []);
    const spots = attackSpots(c, t.at, m.id);
    const path = approach(c, m.id, m.at, spots, move, m.awareness === 'hunting');
    if (path) {
      const end = path[path.length - 1] ?? m.at;
      if (adjacentTo(end, t.at)) return strikePlan(end, path);
      if (path.length) return { intent: { kind: 'move', to: end, targetId: t.id }, path };
    }
  }
  if (m.awareness === 'patrol') return patrolPlan(c, m, move);
  if (m.focusAt && !samePos(m.focusAt, m.at)) {
    const path = approach(c, m.id, m.at, [m.focusAt], move, m.awareness === 'hunting') ?? [];
    if (path.length) return { intent: { kind: 'move', to: path[path.length - 1]! }, path };
  }
  return WAIT;
}

/** The Gloam (spec 5, 16.2): hunts heroes standing in the dark, keeps to dark hexes, strikes for 4. */
function planGloam(c: Ctx, g: MonsterX, lit: Set<string>): Plan {
  const avoid = (p: Pos) => lit.has(posKey(p));
  if (avoid(g.at)) {
    // Light has reached it: it recoils to the nearest dark hex.
    const nodes = dijkstra(c.w, c.d, g.at, { enter: (p) => !blocked(c, p, g.id), stairs: true, allowLocked: true, budget: GLOAM_MOVE });
    let best: Pos | null = null;
    let bestCost = Infinity;
    for (const n of nodes.values()) {
      if (samePos(n.p, g.at) || avoid(n.p) || occupant(c, n.p) || !isFloorish(c.w, c.d, n.p)) continue;
      if (n.cost < bestCost) {
        bestCost = n.cost;
        best = n.p;
      }
    }
    return best ? { intent: { kind: 'flee', to: best }, path: pathTo(nodes, best) } : WAIT;
  }
  const ts = targets(c).filter((t) => t.hero && !lit.has(posKey(t.at)));
  if (!ts.length) return WAIT;
  const o = { stairs: true, allowLocked: true, avoid };
  const field = new Map<string, number>();
  {
    // Walking distance through the dark from the Gloam to each candidate.
    const nodes = dijkstra(c.w, c.d, g.at, { enter: (p) => !avoid(p) && !blocked(c, p, g.id), stairs: true, allowLocked: true, budget: 60 });
    for (const t of ts) {
      let best = 999;
      for (const n of posNeighbors(t.at)) {
        const node = nodes.get(posKey(n));
        if (node && node.cost < best) best = node.cost;
      }
      field.set(t.id, best);
    }
  }
  ts.sort((a, b) => (field.get(a.id) ?? 999) - (field.get(b.id) ?? 999) || byDist(g.at)(a, b));
  const t = ts[0]!;
  if (adjacentTo(t.at, g.at)) return { intent: { kind: 'attack', targetId: t.id, to: g.at, damage: [GLOAM_DMG, GLOAM_DMG] }, path: [] };
  const spots = posNeighbors(t.at).filter((p) => canEnter(c.w, c.d, p, true) && !blocked(c, p, g.id) && !avoid(p));
  const path = approach(c, g.id, g.at, spots, GLOAM_MOVE, o) ?? [];
  const end = path[path.length - 1] ?? g.at;
  if (adjacentTo(end, t.at)) return { intent: { kind: 'attack', targetId: t.id, to: end, damage: [GLOAM_DMG, GLOAM_DMG] }, path };
  if (!path.length) return { intent: { kind: 'wait' }, path: [] };
  return { intent: { kind: 'move', to: end, targetId: t.id }, path };
}

/** Intents for every awake monster on the map and every sister (pure apart from writing .intent). */
export function computeIntents(c: Ctx): void {
  const lit = litSet(c.w, c.d);
  for (const m of c.d.monsters) {
    if (m.awareness === 'asleep' || m.buried) {
      m.intent = undefined;
      continue;
    }
    m.intent = planMonster(c, m, lit).intent;
  }
  computeRivalIntents(c);
}

// ---------------------------------------------------------------- acting

/** The orc's first-sight bellow (spec 16.4): once a delve, noise 5 at the orc. */
function firstSightBellow(c: Ctx, m: MonsterX): void {
  if (m.kind !== 'orc' || m.shouted) return;
  m.shouted = true;
  say(c, `${m.name} bellows.`);
  makeNoise(c, m.at, 5, { what: 'shout' });
}

function perceive(c: Ctx, m: MonsterX, lit: Set<string>): void {
  if (m.kind === 'gloam' || m.kind === 'dragon' || m.awareness === 'asleep' || m.buried) return;
  const seen = targets(c).filter((t) => perceivable(c, m, t, lit, (a, b, L) => sees(c, a, b, L))).sort(byDist(m.at));
  // V4.0 (spec 26.3): its quarry: the one it was going for, while it still makes them out; else the nearest.
  const t = seen.find((x) => x.id === m.intent?.targetId) ?? seen[0];
  if (t) {
    // V3.7 (spec 20.1): every hero it makes out is noticed (remembered, one event each); it hunts its quarry and faces it.
    for (const x of seen) if (x.hero) noticeHero(c, m, x.id);
    goHunting(c, m, t.at);
    firstSightBellow(c, m);
  } else if (m.awareness === 'hunting' && m.kind !== 'berserker') {
    // Lost sight: go alert and search the last hex it saw a hero on (focusAt) for a few rounds (spec 16.1); it forgets who it saw.
    loseQuarry(c, m);
  }
}

/**
 * V4.0 (spec 26.2): noticing happens when it happens. In the player phase, hero `h` stands on a hex of a move
 * (each step of a walk, or where a blink, fall, climb or grapple lands). Every awake monster on that level (not
 * the Gloam, not the Dragon, not buried) that hasn't noticed them and would by the noticing rule (wouldNotice,
 * the hero's last move mode) notices them now, with the world phase's effects: remembered, a `noticed` event at
 * the hex, hunting (an unaware one turns to the hero; a hunting one keeps its facing and its quarry), the orc's
 * first-sight bellow; it re-plans its intent when the command ends (`c.replan`). A waiting cutthroat crew is
 * checked the same way and demands its toll. The move itself goes on. `before` runs once before the first
 * event (a walk ends its `moved` segment there, so the view plays the "!" on the hex where it happened).
 */
export function noticeOnMove(c: Ctx, h: HeroInDelve, before?: () => void): void {
  if (c.d.phase !== 'player' || c.s.stage !== 'delve' || h.status !== 'active' || h.veil > 0) return;
  const lit = litSet(c.w, c.d);
  const sneaking = isSneaking(h);
  const quiet = quietFeet(c, h.heroId);
  const who = onMap(c).filter(
    (m) => m.kind !== 'gloam' && m.kind !== 'dragon' && m.awareness !== 'asleep' && m.at.level === h.at.level && !hasNoticed(m, h.heroId) && wouldNotice(c, m, h.at, sneaking, lit, quiet),
  );
  let flushed = false;
  const once = () => {
    if (flushed) return;
    flushed = true;
    before?.();
  };
  for (const m of who) {
    if (!c.d.monsters.includes(m)) continue;
    once();
    const hunting = m.awareness === 'hunting';
    noticeHero(c, m, h.heroId);
    if (!hunting) goHunting(c, m, h.at);
    (c.replan ??= new Set()).add(m.id);
    firstSightBellow(c, m);
  }
  crewNotice(c, h.heroId, once);
}

/** An alert searcher's clock runs down; at zero it goes back to its route or post (spec 16.1). */
function searchTick(c: Ctx, m: MonsterX): void {
  if (m.awareness !== 'alert' || m.returning) return;
  if (m.searchRounds === undefined) return;
  m.searchRounds -= 1;
  if (m.searchRounds > 0) return;
  m.searchRounds = undefined;
  if (m.route && m.route.length > 1) {
    // Back to the patrol: head for the nearest waypoint.
    let best = 0;
    let bestD = Infinity;
    m.route.forEach((wp, i) => {
      const d = wp.level === m.at.level ? distance(wp, m.at) : 99;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    m.routeIndex = best;
    m.awareness = 'patrol';
    m.focusAt = undefined;
    c.ev.push({ type: 'awake', id: m.id, awareness: 'patrol' });
  } else if (!samePos(m.at, m.spawnedAt)) {
    m.returning = true;
    m.focusAt = { ...m.spawnedAt };
  } else {
    m.focusAt = undefined;
  }
}

/** Where a monster at `from` would push the figure at `at` (adjacent: straight behind; at range: the rounded direction). */
function pushDest(from: Pos, at: Pos): Pos {
  return awayFrom(from, at);
}

/** The shown intent, if it can still be carried out as shown. */
function honored(c: Ctx, m: MonsterX, move: number): Plan | null {
  const it = m.intent;
  if (!it || it.kind === 'wait' || it.kind === 'flee') return null;
  if (m.kind === 'gloam') return null; // always re-plans: the light may have moved
  if (m.kind === 'dragon') {
    // Breath and sweep always go off as shown; bites/moves re-plan if stale.
    if (it.kind === 'breath' || it.kind === 'sweep') return { intent: it, path: [] };
    return null;
  }
  const stairs = m.awareness === 'hunting';
  const pathTo2 = (to: Pos): Pos[] | null => {
    if (samePos(to, m.at)) return [];
    if (occupant(c, to)) return null;
    const nodes = dijkstra(c.w, c.d, m.at, { enter: (p) => !blocked(c, p, m.id), stairs, budget: move });
    if (!nodes.has(posKey(to))) return null;
    return pathTo(nodes, to);
  };
  if (it.kind === 'shout') return targets(c).some((x) => x.id === it.targetId) ? { intent: it, path: [] } : null;
  if (it.kind === 'shove') {
    const t = targets(c).find((x) => x.id === it.targetId);
    const from = m.shoveFrom ?? m.at;
    if (!t || !it.to || !samePos(pushDest(from, t.at), it.to)) return null;
    if (m.kind === 'archer' ? !within(from, t.at, ARCHER_RANGE) || !los(c.w, c.d, from, t.at) : !adjacentTo(from, t.at)) return null;
    const path = pathTo2(from);
    return path ? { intent: it, path } : null;
  }
  const t = it.targetId ? targets(c).find((x) => x.id === it.targetId) : undefined;
  if (it.kind !== 'move' && !t) return null;
  if (it.kind === 'web') return t?.hero && !adjacentTo(m.at, t.at) ? { intent: it, path: [] } : null;
  if (it.kind === 'drag') return t?.hero?.webbed && !adjacentTo(m.at, t.at) && within(m.at, t.at, 3) ? { intent: it, path: [] } : null;
  const to = it.to ?? m.at;
  const path = pathTo2(to);
  if (!path) return null;
  if (it.kind === 'grab' && (!t?.hero || t.hero.grabbedBy || !adjacentTo(to, t.at))) return null;
  if (it.kind === 'attack' || it.kind === 'steal') {
    if (m.kind === 'archer') {
      if (!within(to, t!.at, ARCHER_RANGE) || !los(c.w, c.d, to, t!.at)) return null;
    } else if (!adjacentTo(to, t!.at)) return null;
  }
  // V3.7 (spec 20.5): the hamstring shot as shown, while the hero is still in range and not rooted yet.
  if (it.kind === 'hamstring' && (!t?.hero || (t.hero.rooted ?? 0) > 0 || !within(to, t.at, HAMSTRING_RANGE) || !los(c.w, c.d, to, t.at))) return null;
  return { intent: it, path };
}

function monsterAct(c: Ctx, m: MonsterX): void {
  const lit = litSet(c.w, c.d);
  const wasPatrol = m.awareness === 'patrol';
  perceive(c, m, lit);
  if (!c.d.monsters.includes(m) || m.awareness === 'asleep' || m.buried) return;
  const st = monsterStats(m);
  const move = (m.stuck ?? 0) > 0 ? 0 : st.move;
  let plan = honored(c, m, move) ?? planMonster(c, m, lit);
  // Abilities go off only after being shown as the intent (spec 16.4); the Dragon never breathes unannounced.
  if (m.kind === 'dragon' && plan.intent.kind === 'breath' && m.intent?.kind !== 'breath') plan = planDragon(c, m, true);
  if (m.kind !== 'dragon' && SHOWN_FIRST.includes(plan.intent.kind) && m.intent?.kind !== plan.intent.kind) plan = planMonster(c, m, lit, { noAbility: true });
  m.intent = plan.intent;
  const startAt = m.at;
  const patrolling = m.awareness === 'patrol';
  const visBefore = (patrolling || wasPatrol) && plan.path.length ? visNow(c) : null;
  // Overwatch: moving or acting in a Ranger's sight draws the shot first.
  if (m.kind !== 'gloam' && (plan.path.length || plan.intent.kind !== 'wait') && overwatchCheck(c, m.id, m.at)) return;
  if (!c.d.monsters.includes(m)) return;
  const stopped = walk(c, m.id, m, plan.path);
  if (!c.d.monsters.includes(m)) return;
  // A watched patrol gives its route away (spec 16.1).
  if (visBefore && m.route && !(c.d.knownRoutes ??= []).includes(m.id)) {
    if ([startAt, ...plan.path].some((p) => visBefore.has(posKey(p)))) {
      c.d.knownRoutes.push(m.id);
      c.ev.push({ type: 'routeKnown', id: m.id, route: m.route.map((p) => ({ ...p })) });
      say(c, `${m.name} walks a beat. You've marked its round.`);
    }
  }
  if (patrolling && plan.intent.kind === 'move' && plan.intent.to && samePos(m.at, plan.intent.to) && m.routeAfter !== undefined) {
    m.routeIndex = m.routeAfter;
    m.routeAfter = undefined;
  }
  const charged = !stopped && plan.path.length >= 2 && startAt.level === m.at.level;
  const it = plan.intent;
  if (m.focusAt && samePos(m.focusAt, m.at)) {
    m.focusAt = undefined;
    m.returning = undefined;
  }
  if (m.kind === 'dragon' && dragonSpecial(c, m, it)) return;
  // V3.9.2 (spec 24.7): acting on someone turns a monster toward them (web, steal, drag, grab, shove...).
  if (it.kind !== 'move' && it.kind !== 'flee' && it.kind !== 'wait') {
    const to = it.targetId ? targets(c).find((x) => x.id === it.targetId)?.at : it.to;
    if (to) faceToward(m, to);
  }
  switch (it.kind) {
    case 'shout': {
      const t = targets(c).find((x) => x.id === it.targetId);
      if (!t) break;
      m.shoutCooldown = CAPTAIN_SHOUT_COOLDOWN;
      c.ev.push({ type: 'shout', id: m.id });
      say(c, `${m.name} roars an order. Every orc in earshot turns on ${nameOf(c, t.id)}.`);
      for (const x of onMap(c)) {
        if (x === m || (x.kind !== 'orc' && x.kind !== 'archer' && x.kind !== 'captain')) continue;
        if (x.at.level !== m.at.level || distance(x.at, m.at) > CAPTAIN_SHOUT_RANGE) continue;
        goHunting(c, x, t.at);
        if (t.hero) noticeHero(c, x, t.id);
        x.intent = { kind: 'wait', targetId: t.id };
      }
      makeNoise(c, m.at, SHOUT_NOISE, { what: 'shout' });
      break;
    }
    case 'shove': {
      const t = targets(c).find((x) => x.id === it.targetId);
      if (!t?.hero || t.hero.status !== 'active') break;
      if (m.kind === 'archer' ? !within(m.at, t.at, ARCHER_RANGE) || !los(c.w, c.d, m.at, t.at) : !adjacentTo(m.at, t.at)) break;
      say(c, m.kind === 'archer' ? `${m.name} aims to knock ${heroName(c, t.id)} off the edge.` : `${m.name} lunges to shove ${heroName(c, t.id)} over the edge.`);
      if (chance(c.s, ORC_SHOVE_CHANCE)) push(c, t.id, pusherFor(m.at, t.at), m.id);
      else {
        c.ev.push({ type: 'miss', attacker: m.id, target: t.id });
        say(c, `${heroName(c, t.id)} keeps their footing.`);
      }
      break;
    }
    case 'grab': {
      const t = targets(c).find((x) => x.id === it.targetId);
      if (!t?.hero || t.hero.status !== 'active' || t.hero.grabbedBy || m.holding || !adjacentTo(m.at, t.at)) break;
      m.holding = t.id;
      t.hero.grabbedBy = m.id;
      c.ev.push({ type: 'grabbed', by: m.id, id: t.id });
      c.ev.push({ type: 'hit', attacker: m.id, target: t.id, damage: 0, crit: false });
      say(c, `${m.name} seizes ${heroName(c, t.id)}. Break free, or cut it down.`);
      break;
    }
    case 'drag': {
      const t = targets(c).find((x) => x.id === it.targetId);
      if (!t?.hero || !t.hero.webbed || adjacentTo(m.at, t.at)) break;
      say(c, `${m.name} hauls on the web. ${heroName(c, t.id)} is dragged in.`);
      push(c, t.id, awayFrom(m.at, t.at), m.id, 'dragged');
      break;
    }
    case 'attack': {
      if (!it.targetId) break;
      const t = targets(c).find((x) => x.id === it.targetId);
      if (!t || t.at.level !== m.at.level) break;
      if (m.kind === 'gloam') {
        if (distance(t.at, m.at) !== 1 || lit.has(posKey(t.at))) break;
        const h = hd(c, t.id);
        say(c, 'The Gloam touches ' + nameOf(c, t.id) + '.');
        if (h) hurtHero(c, h, GLOAM_DMG - wardOf(h), m.id);
        else hurtPrisoner(c, GLOAM_DMG, m.id);
        break;
      }
      if (m.kind === 'archer') {
        if (!within(m.at, t.at, ARCHER_RANGE) || !los(c.w, c.d, m.at, t.at)) break;
      } else if (distance(t.at, m.at) !== 1) break;
      faceToward(m, t.at);
      const slots = st.slots + (m.kind === 'ghoul' && m.holding === t.id ? 1 : 0);
      const landed = strike(c, m.id, t.id, slots, st.chance, st.dmg, m.kind === 'dragon' ? 'Bite' : m.kind === 'archer' ? 'Shot' : 'Attack');
      // Berserker charge: moved 2+ hexes then hit: knock the target back.
      if (m.kind === 'berserker' && charged && landed) {
        const h = hd(c, landed);
        if (h && h.status === 'active') {
          say(c, `${m.name}'s charge knocks ${heroName(c, landed)} back.`);
          push(c, landed, m.at, m.id);
        }
      }
      break;
    }
    case 'hamstring': {
      // V3.7 (spec 20.5): the orc archer roots a hero.
      const t = targets(c).find((x) => x.id === it.targetId);
      if (!t?.hero || t.at.level !== m.at.level || !within(m.at, t.at, HAMSTRING_RANGE) || !los(c.w, c.d, m.at, t.at)) break;
      faceToward(m, t.at);
      hamstringShot(c, m.id, t, st.chance);
      break;
    }
    case 'steal': {
      const t = targets(c).find((x) => x.id === it.targetId);
      if (!t || !t.hero || distance(t.at, m.at) !== 1 || t.at.level !== m.at.level) break;
      const r = roll(c, m.id, 'Steal', st.slots, st.chance);
      if (!r.hits) {
        c.ev.push({ type: 'miss', attacker: m.id, target: t.id });
        break;
      }
      const pool = t.hero.pack.filter(stealable);
      if (!pool.length) {
        hurtHero(c, t.hero, Math.max(1, st.dmg - t.armor), m.id);
        break;
      }
      const item = pick(c.s, pool);
      t.hero.pack = t.hero.pack.filter((i) => i !== item);
      m.stolen = item;
      c.ev.push({ type: 'stolen', by: m.id, from: t.id, item });
      say(c, `${m.name} lifts ${heroName(c, t.id)}'s ${item.name.toLowerCase()} and runs.`);
      break;
    }
    case 'web': {
      const t = targets(c).find((x) => x.id === it.targetId);
      if (!t?.hero) break;
      t.hero.webbed = true;
      m.lastWeb = c.d.round;
      c.ev.push({ type: 'hit', attacker: m.id, target: t.id, damage: 0, crit: false });
      say(c, `${heroName(c, t.id)} is caught in a web.`);
      break;
    }
    case 'flee':
      if (m.kind === 'cutpurse' && m.stolen && kindAt(c.w, c.d, m.at) === 'exit') {
        c.d.monsters = c.d.monsters.filter((x) => x !== m);
        c.ev.push({ type: 'out', id: m.id });
        say(c, `${m.name} is gone, and so is the ${m.stolen.name.toLowerCase()}.`);
        noteOnce(c, `A cutpurse got away with a ${m.stolen.name.toLowerCase()}.`);
      }
      break;
  }
  if (c.d.monsters.includes(m)) {
    // A hold only lasts while the ghoul stands next to its hero.
    if (m.holding) {
      const h = hd(c, m.holding);
      if (!h || h.status !== 'active' || !adjacentTo(h.at, m.at)) releaseHold(c, m);
    }
    searchTick(c, m);
  }
}

// ---------------------------------------------------------------- the Gloam

/**
 * Spec 5 and 16.2. The Gloam is present when the lantern is out (any level) or when an active
 * hero stands in the dark on Level 3. It rises near its quarry, out of sight if it can, and acts
 * at once. It fades after GLOAM_CALM_FADE world phases with nobody in the dark.
 */
function gloamPhase(c: Ctx): void {
  const lit = litSet(c.w, c.d);
  let g = c.d.monsters.find((m) => m.kind === 'gloam');
  const unlit3 = unlitOnL3(c, lit);
  const pitch = c.d.light <= 0 && activeHeroes(c).length > 0;
  if (!pitch && !unlit3.length) {
    if (g) {
      c.d.gloamCalm = (c.d.gloamCalm ?? 0) + 1;
      if (c.d.gloamCalm >= GLOAM_CALM_FADE) {
        c.d.monsters = c.d.monsters.filter((m) => m !== g);
        c.d.gloamCalm = 0;
        c.ev.push({ type: 'monsterDied', id: g.id });
        say(c, 'The dark settles. For now.');
      }
    } else c.d.gloamCalm = 0;
    return;
  }
  c.d.gloamCalm = 0;
  if (!g) {
    const hollow = unlit3.length > 0;
    const anchor = hollow ? unlit3[0]!.at : (lanternPos(c.d) ?? activeHeroes(c)[0]!.at);
    const [lo, hi] = hollow ? [GLOAM_RISE_MIN, GLOAM_RISE_MAX] : [8, 10];
    const vis = visibleSet(c.w, c.d, lit);
    const dark = (p: Pos) => kindAt(c.w, c.d, p) === 'floor' && !occupant(c, p) && !lit.has(posKey(p));
    const ring = range(anchor, hi).map((h) => ({ level: anchor.level, ...h })).filter((p) => distance(p, anchor) >= lo && dark(p));
    const hidden = ring.filter((p) => !vis.has(posKey(p)));
    let pool = hidden.length ? hidden : ring;
    if (!pool.length) pool = (c.w.floors.get(anchor.level) ?? []).filter((p) => dark(p) && isFloorish(c.w, c.d, p));
    if (!pool.length) return;
    const at = pick(c.s, pool);
    g = {
      id: `m${c.d.nextMonster ?? 99}`,
      kind: 'gloam',
      name: 'The Gloam',
      at,
      hp: 99,
      maxHp: 99,
      awareness: 'hunting',
      spawnedAt: at,
    };
    c.d.nextMonster = (c.d.nextMonster ?? 99) + 1;
    c.d.monsters.push(g);
    c.ev.push({ type: 'gloam', at });
    c.ev.push({ type: 'spawned', id: g.id, at });
    say(c, hollow ? 'The dark here is awake.' : 'Something moves in the dark.');
  }
  monsterAct(c, g);
}

// Charges: V3.7 (spec 20.3) fused charges live in charges.ts; tickFuses runs at the end of the world phase.

// ---------------------------------------------------------------- the phase

function tick(rec: Record<string, number> | undefined): void {
  if (!rec) return;
  for (const k of Object.keys(rec)) {
    rec[k]! -= 1;
    if (rec[k]! <= 0) delete rec[k];
  }
}

/** Everyone standing in fire takes BURN_DMG (armor doesn't help). */
function burnPhase(c: Ctx): void {
  const burning = Object.entries(c.d.burning ?? {}).filter(([, n]) => n > 0).map(([k]) => k);
  if (!burning.length) return;
  const keys = new Set(burning);
  const ids: string[] = [];
  for (const m of onMap(c)) if (m.kind !== 'gloam' && keys.has(posKey(m.at))) ids.push(m.id);
  for (const r of rivalsOnMap(c)) if (keys.has(posKey(r.at))) ids.push(r.id);
  for (const h of c.d.heroes) if ((h.status === 'active' || h.status === 'downed') && keys.has(posKey(h.at))) ids.push(h.heroId);
  const pr = c.d.prisoner;
  if (pr && !pr.dead && !pr.out && keys.has(posKey(pr.at))) ids.push(pr.id);
  for (const id of ids) {
    say(c, `${nameOf(c, id)} burns.`);
    hurtAny(c, id, BURN_DMG, null, { noise: false });
  }
}

export function worldPhase(c: Ctx): void {
  const d = c.d;
  refreshSight(c);
  if (checkDelveEnd(c)) return;
  d.phase = 'world';
  // V3.9.3 (spec 24.8): last world phase's sounds are forgotten.
  clearHeard(c);
  // V3.9 (spec 24.2): figures revealed by an unseen strike show until the end of the player phase just past.
  for (const [id, until] of Object.entries(d.revealed ?? {})) if (until <= d.round) delete d.revealed![id];
  c.visCache = undefined;
  c.ev.push({ type: 'phase', phase: 'world', round: d.round });
  const webbedBefore = new Set(d.heroes.filter((h) => h.webbed).map((h) => h.heroId));
  // 1. Light (an open lantern burns), torches, bleeding, fire.
  if (d.lanternOpen !== false) setLight(c, d.light - 1);
  burnPhase(c);
  // Spec 18.4: the Black Cask's hiccups: noise 1 at the drinker every world phase.
  for (const h of d.heroes) if (h.ale === 'hiccups' && h.status === 'active') makeNoise(c, h.at, HICCUP_NOISE);
  for (const h of d.heroes) if (h.torch > 0 && (h.status === 'active' || h.status === 'downed')) h.torch -= 1;
  // V3.7 (spec 20.5): roots (hamstring, briar) wear off at the start of the phase: a hero rooted by an archer sits out two of their turns.
  for (const h of d.heroes) if ((h.rooted ?? 0) > 0) h.rooted! -= 1;
  for (const h of d.heroes) {
    if (h.status !== 'downed') continue;
    // V3.7 (spec 20.4): a crew member dragging them keeps them breathing (they're worth more alive).
    if (d.rivals?.members.some((r) => r.dragging === h.heroId && r.hp > 0 && !r.goneOut)) continue;
    h.bleed -= 1;
    if (h.bleed <= 0) killHero(c, h);
  }
  // 2. Monsters, in id order.
  const order = [...d.monsters].filter((m) => m.kind !== 'gloam').sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
  for (const m of order) {
    if (!d.monsters.includes(m)) continue;
    c.visCache = undefined;
    monsterAct(c, m);
  }
  // 3. Rivals. 4. The Gloam.
  rivalsAct(c);
  relockGate(c); // V4.0 (spec 25.4): a crew that came in by the sally port bars it behind itself
  gloamPhase(c);
  // V3.7 (spec 20.3): fuses count down; charges at 0 go off now, at the end of the world phase.
  tickFuses(c);
  // 5. New round.
  // V3.7 (spec 20.5): the castle has turned: free movement counts its steps afresh; braces end at the next player phase.
  d.calmSteps = 0;
  for (const h of d.heroes) {
    h.moved = false;
    h.acted = false;
    h.dashed = false;
    h.overwatch = false;
    h.guarding = undefined;
    h.braced = undefined;
    if (h.rallyCooldown > 0) h.rallyCooldown -= 1;
    if (h.veil > 0) h.veil -= 1;
    if (h.ward > 0) h.ward -= 1;
    // V3.6 (spec 19.3): the night-eye draught wears off.
    if ((h.nightEyes ?? 0) > 0) {
      h.nightEyes! -= 1;
      if (h.nightEyes === 0) say(c, `${heroName(c, h.heroId)}'s night-eye fades.`);
    }
    if (webbedBefore.has(h.heroId)) {
      h.webbed = false;
      h.dozing = undefined;
    }
  }
  for (const m of d.monsters) {
    if ((m.stuck ?? 0) > 0) m.stuck! -= 1;
    if ((m.shoutCooldown ?? 0) > 0) m.shoutCooldown! -= 1;
    // V3.7 (spec 20.2): Dread wears off.
    if ((m.feared ?? 0) > 0) {
      m.feared! -= 1;
      if (m.feared === 0) m.fearOf = undefined;
    }
  }
  for (const r of d.rivals?.members ?? []) {
    if ((r.feared ?? 0) > 0) {
      r.feared! -= 1;
      if (r.feared === 0) r.fearOf = undefined;
    }
    // V3.7 (spec 20.5): a rooted crew member (hamstring, briar) comes loose.
    if ((r.stuck ?? 0) > 0) r.stuck! -= 1;
  }
  tick(d.smoke);
  tick(d.glue);
  tick(d.burning);
  refreshSight(c);
  if (checkDelveEnd(c)) return;
  d.round += 1;
  d.phase = 'player';
  computeIntents(c);
  c.ev.push({ type: 'phase', phase: 'player', round: d.round });
}
