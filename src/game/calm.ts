// V3.7 (spec 20.5): free movement while the party is calm. The calm test with its
// reason, the long-walk executor (one hex at a time with every per-hex rule, the
// castle taking a turn every CALM_STEPS steps, followers in single file) and the
// reach query the UI uses to offer any explored hex. Pure rules: all dice through
// the seeded RNG via the per-hex hooks in stealth.ts.

import { distance, posKey, samePos, type Pos } from './hex';
import type { GameEvent, HeroInDelve } from './types';
import type { Reach } from './api';
import { CALM_STEPS, FREE_MOVE } from './data';
import { say, type Ctx, type HeroX } from './state';
import { activeHeroes, hd, heroName, levelHeal, makeNoise, nameOf, occupant, onMap, rivalsOnMap, wakeAdjacent } from './common';
import { bringCarried } from './common'; // V4.1 (spec 31.4)
import { lightSig, dijkstra, dirIndex, doorAt, kindAt, litSet, pathTo, seesHex, steps } from './world';
import { moveRisks, provokeSwings, stepNoise, wakeRolls } from './stealth';
import { ventCheck } from './falls';
import { afterHeroMove, blocksHero, checkDelveEnd, glimpse, refreshSight, seenSet, springTrap, visNow } from './delve';
import { noticeOnMove, worldPhase } from './world-phase';
import { rivalCaltropsStep } from './crewai';

// ---------------------------------------------------------------- the calm test

function withArticle(name: string): string {
  if (/^the /i.test(name)) return name;
  const a = /^[aeiou]/i.test(name) ? 'An' : 'A';
  return `${a} ${name.toLowerCase()}`;
}

/**
 * Why the party is not calm (spec 20.5), or undefined when it is: a monster hunting on a level
 * with an active hero, a hostile or demanding crew, the Gloam about, a lit fuse, or a hero down,
 * held, webbed or rooted.
 */
export function calmReason(c: Ctx): string | undefined {
  if (!FREE_MOVE.enabled) return 'Free movement is off (spec 23.1).';
  const d = c.d;
  const active = activeHeroes(c);
  const levels = new Set(active.map((h) => h.at.level));
  for (const m of onMap(c)) {
    if (m.kind === 'gloam') return 'The Gloam is near.';
    if (m.awareness !== 'hunting' || !levels.has(m.at.level)) continue;
    const named = m.intent?.targetId ? hd(c, m.intent.targetId) : undefined;
    const quarry = named?.status === 'active' ? named : active.filter((h) => h.at.level === m.at.level).sort((a, b) => distance(a.at, m.at) - distance(b.at, m.at))[0];
    const who = quarry ? heroName(c, quarry.heroId) : 'the party';
    return m.kind === 'rats' ? `Rats hunt ${who}.` : `${withArticle(m.name)} hunts ${who}.`;
  }
  const cr = d.rivals;
  if (cr && rivalsOnMap(c).length) {
    if (cr.stance === 'hostile') return `${cr.name} are hostile.`;
    if (cr.stance === 'demanding') return `${cr.name} want their toll.`;
  }
  if ((d.fuses ?? []).length) return 'A fuse is lit.';
  for (const h of d.heroes) {
    const name = heroName(c, h.heroId);
    if (h.status === 'downed') return `${name} is down.`;
    if (h.status !== 'active') continue;
    if (h.grabbedBy) return `${name} is held.`;
    if (h.webbed) return `${name} is stuck.`;
    if ((h.rooted ?? 0) > 0) return `${name} is rooted.`;
  }
  return undefined;
}

export function isCalm(c: Ctx): boolean {
  return calmReason(c) === undefined;
}

/** Sync `Delve.calm` with the rules; a `calm` event when it changes (spec 20.5). */
export function updateCalm(c: Ctx): void {
  if (c.s.stage !== 'delve') return;
  // Spec 23.1: free movement is off; stay silently "not calm" (no Combat! banners).
  if (!FREE_MOVE.enabled) {
    c.d.calm = false;
    return;
  }
  const why = calmReason(c);
  const now = why === undefined;
  if (c.d.calm === now) return;
  c.d.calm = now;
  if (now) {
    c.d.calmSteps ??= 0;
    c.ev.push({ type: 'calm', calm: true });
  } else c.ev.push({ type: 'calm', calm: false, why });
}

// ---------------------------------------------------------------- the reach query

/**
 * Every explored hex a calm hero could walk to (any distance, stairs and the lift allowed),
 * with the path and its risks, like `reachable` without the budget. Spotted traps and fire
 * vents are avoided when there's another way. Empty when the party is not calm.
 */
export function calmReach(c: Ctx, heroId: string, sneak: boolean): Reach[] {
  const h = hd(c, heroId);
  if (!h || h.status !== 'active' || c.d.phase !== 'player' || !isCalm(c)) return [];
  if (h.webbed || h.grabbedBy || (h as HeroX).dozing || (h.rooted ?? 0) > 0) return [];
  const explored = new Set(c.d.explored);
  const nodes = dijkstra(c.w, c.d, h.at, {
    enter: (p) => explored.has(posKey(p)) && !blocksHero(c, p),
    penalty: (p) => (c.d.traps[posKey(p)]?.spotted || c.w.vents.has(posKey(p)) ? 10 : 0),
    stairs: true,
    budget: 400,
  });
  const lit = litSet(c.w, c.d);
  const vis = visNow(c);
  const seen = seenSet(c, vis);
  const out: Reach[] = [];
  for (const n of nodes.values()) {
    if (samePos(n.p, h.at) || occupant(c, n.p)) continue;
    const path = pathTo(nodes, n.p);
    out.push({ to: n.p, cost: n.cost, path, risks: moveRisks(c, h, path, sneak, lit, seen, vis) });
  }
  return out;
}

// ---------------------------------------------------------------- the long walk

/** Heroes that come along: active, on the mover's level, within 3, free to walk, nearest first (spec 20.5). */
export function followersOf(c: Ctx, h: HeroInDelve): HeroInDelve[] {
  return activeHeroes(c)
    .filter((o) => o !== h && o.at.level === h.at.level && distance(o.at, h.at) <= 3 && !o.webbed && !o.grabbedBy && !(o as HeroX).dozing && !((o.rooted ?? 0) > 0))
    .sort((a, b) => distance(a.at, h.at) - distance(b.at, h.at) || (a.heroId < b.heroId ? -1 : 1));
}

interface Walker {
  h: HeroInDelve;
  /** Hexes walked since the last `moved` event. */
  seg: Pos[];
}

/** Monsters and crew members (not a hired crew's) some active hero can see right now. Per figure, not the whole visible set: this runs every step. */
function figuresInSight(c: Ctx, lit: Set<string>): Set<string> {
  const out = new Set<string>();
  const eyes = activeHeroes(c);
  const figs: { id: string; at: Pos }[] = [...onMap(c)];
  if (c.d.rivals?.stance !== 'hired') for (const r of rivalsOnMap(c)) if ((r.veil ?? 0) <= 0) figs.push(r);
  for (const f of figs) if (eyes.some((h) => seesHex(c.w, c.d, h.at, f.at, lit, h.facing))) out.add(f.id);
  return out;
}

function flush(c: Ctx, wk: Walker): void {
  if (!wk.seg.length) return;
  c.ev.push({ type: 'moved', id: wk.h.heroId, path: wk.seg.map((p) => ({ ...p })) });
  wk.seg = [];
}

/** One hero steps onto `p` with the per-hex rules (doors, noise, wake rolls, traps, sight, the prisoner, ghouls). */
function stepTo(c: Ctx, wk: Walker, p: Pos, sneak: boolean, last: boolean, lit: Set<string>): { trap: boolean } {
  const h = wk.h;
  const from = h.at;
  if (kindAt(c.w, c.d, p) === 'door') {
    const door = doorAt(c.d, p);
    if (door && !door.open) {
      door.open = true;
      c.ev.push({ type: 'doorChanged', at: p, open: true, locked: door.locked });
    }
  }
  provokeSwings(c, h, from, p, new Set());
  if (h.status !== 'active') return { trap: false };
  wk.seg.push(p);
  if (p.level !== from.level) {
    flush(c, wk);
    c.ev.push({ type: 'levelChanged', id: h.heroId, from: from.level, to: p.level });
    h.at = { ...p };
    levelHeal(c, h);
  }
  if (p.level === from.level) h.facing = dirIndex(from, p); // V3.9 (spec 24.2)
  h.at = { ...p };
  bringCarried(c, h.heroId); // V4.1 (spec 31.4)
  c.visCache = undefined;
  glimpse(c, p);
  noticeOnMove(c, h, () => flush(c, wk)); // V4.0 (spec 26.2): before the step's noise and wake rolls, as doMove
  const noise = stepNoise(c, p, sneak);
  if (noise) makeNoise(c, p, noise, { quiet: true });
  wakeRolls(c, h, p, last, sneak, lit);
  let trap = false;
  if (rivalCaltropsStep(c, h as HeroX, p)) {
    flush(c, wk);
    trap = true;
  } else if (c.d.traps[posKey(p)]) {
    flush(c, wk);
    springTrap(c, h, p);
    trap = true;
  }
  if (h.status === 'active') afterHeroMove(c, h, sneak, true);
  return { trap };
}

/** A sleeper stirred or a monster went on the alert among these events (the walk stops for it, spec 20.5). */
function stirred(ev: GameEvent[]): string | undefined {
  for (const x of ev) {
    if (x.type === 'woke') return x.id;
    if (x.type === 'awake' && (x.awareness === 'alert' || x.awareness === 'hunting')) return x.id;
  }
  return undefined;
}

export interface CalmWalk {
  /** Hexes the mover walked. */
  steps: number;
  /** World phases the castle took on the way. */
  turns: number;
  /** Why the walk stopped short, if it did. */
  stopped?: string;
}

/**
 * Walk `path` (any length) while the party is calm (spec 20.5). Every CALM_STEPS steps the
 * castle takes a turn (a full world phase and a new round). `follow` brings the other active
 * heroes within 3 along behind in single file. The walk stops when calm ends, a sleeper wakes,
 * a trap or vent goes off, a hero's HP drops, the lantern stage changes or a new monster comes
 * into sight; stopping for combat gives every active hero a fresh player phase. `moved` is never set.
 */
export function calmWalk(c: Ctx, h: HeroInDelve, path: Pos[], sneak: boolean, follow: boolean): CalmWalk {
  const d = c.d;
  const res: CalmWalk = { steps: 0, turns: 0 };
  (h as HeroX).sneaked = sneak;
  const lead: Walker = { h, seg: [] };
  const line: Walker[] = follow ? followersOf(c, h).map((o) => ({ h: o, seg: [] })) : [];
  for (const f of line) (f.h as HeroX).sneaked = sneak;
  const trail: Pos[] = [{ ...h.at }];
  const name = heroName(c, h.heroId);
  let seen = figuresInSight(c, litSet(c.w, d));
  let hp = new Map(d.heroes.map((x) => [x.heroId, x.hp]));
  let stage = lightSig(d, false); // V4.1 (WS2): the light changed (a torch burnt out, a lantern ran low)
  let lastNoise = 0;
  let reachedEnd = false;

  /** Anything besides calm itself that halts the walk? */
  const halt = (since: GameEvent[]): string | undefined => {
    if (c.s.stage !== 'delve') return 'the delve is over';
    if (h.status !== 'active') return `${name} is down`;
    for (const x of d.heroes) if (x.hp < (hp.get(x.heroId) ?? x.hp)) return `${heroName(c, x.heroId)} is hurt`;
    const woke = stirred(since);
    if (woke) return `${nameOf(c, woke)} stirs`;
    if (lightSig(d, false) !== stage) return 'the light changed';
    const now = figuresInSight(c, litSet(c.w, d));
    for (const id of now) if (!seen.has(id)) return `${nameOf(c, id)} in sight`;
    return undefined;
  };
  const fresh = (): void => {
    for (const x of activeHeroes(c)) {
      x.moved = false;
      x.acted = false;
      x.dashed = false;
    }
  };
  /** The walk ends here: the mover's noise event, vents, end-adjacent wakes, sight. */
  const settle = (): void => {
    if (lastNoise && h.status === 'active') c.ev.push({ type: 'noise', at: { ...h.at }, radius: lastNoise });
    if (h.status === 'active') ventCheck(c, h);
    if (!reachedEnd && h.status === 'active') wakeAdjacent(c, h.at, sneak, h.heroId);
    for (const f of line) {
      if (f.h.status !== 'active') continue;
      ventCheck(c, f.h);
      if (f.h.status === 'active') wakeAdjacent(c, f.h.at, sneak, f.h.heroId);
    }
    flush(c, lead);
    for (const f of line) flush(c, f);
    c.visCache = undefined;
    refreshSight(c);
  };
  const stop = (why: string, combat = true): CalmWalk => {
    settle();
    if (c.s.stage === 'delve') {
      const calmNow = isCalm(c);
      if (!calmNow) fresh();
      say(c, combat && !calmNow ? `${name} stops. ${calmReason(c)}` : `${name} stops: ${why}.`);
      if (calmNow) c.ev.push({ type: 'walkStopped', heroId: h.heroId, at: { ...h.at }, why });
      updateCalm(c);
      checkDelveEnd(c);
    }
    res.stopped = why;
    return res;
  };

  for (const [i, p] of path.entries()) {
    const mark = c.ev.length;
    const lit = litSet(c.w, d);
    const last = i === path.length - 1;
    if (blocksHero(c, p) || (last && occupant(c, p))) return stop('the way is blocked', false);
    const st = stepTo(c, lead, p, sneak, last, lit);
    lastNoise = stepNoise(c, p, sneak);
    res.steps += 1;
    d.calmSteps = (d.calmSteps ?? 0) + 1;
    trail.push({ ...p });
    if (last) reachedEnd = true;
    if (st.trap) return stop('a trap');
    // Followers step into the hex the one ahead just left (single file along the same path). The line
    // is re-ordered by distance to the mover each step, so a hero the mover walked through keeps its place.
    const rank = new Map(line.map((f, i) => [f, i]));
    line.sort((a, b) => distance(a.h.at, h.at) - distance(b.h.at, h.at) || rank.get(a)! - rank.get(b)!);
    for (let k = 0; k < line.length; k++) {
      const f = line[k]!;
      const idx = trail.length - 2 - k;
      if (idx < 0 || f.h.status !== 'active') continue;
      const to = trail[idx]!;
      if (samePos(f.h.at, to)) continue;
      let hop: Pos[] = [to];
      const adj = steps(c.w, d, f.h.at, { stairs: true }).some(([n]) => samePos(n, to));
      if (!adj) {
        const nodes = dijkstra(c.w, d, f.h.at, { enter: (q) => !blocksHero(c, q), stairs: true, budget: 6 });
        hop = nodes.has(posKey(to)) ? pathTo(nodes, to) : [];
      }
      if (!hop.length || occupant(c, to)) {
        say(c, `${heroName(c, f.h.heroId)} falls behind.`);
        flush(c, f);
        line.splice(k, 1);
        k -= 1;
        continue;
      }
      let tripped = false;
      for (const q of hop) {
        const r = stepTo(c, f, q, sneak, false, lit);
        if (r.trap || f.h.status !== 'active') {
          tripped = true;
          break;
        }
      }
      if (tripped) return stop('a trap');
    }
    // A crew not yet spotted, or waiting at its post, is looked for every step (refreshSight is the whole visible set: only then).
    c.visCache = undefined;
    if (d.rivals && (!d.rivals.spotted || d.rivals.stance === 'waiting')) refreshSight(c);
    if (c.s.stage !== 'delve') return stop('the delve is over', false);
    // The castle turns every CALM_STEPS steps (the last step of a path included): a full world phase and a
    // new round, then the walk goes on (deferred a step while the mover stands on a friend's hex, passing through).
    if ((d.calmSteps ?? 0) >= CALM_STEPS && !d.heroes.some((x) => x !== h && (x.status === 'active' || x.status === 'downed') && samePos(x.at, h.at))) {
      flush(c, lead);
      for (const f of line) flush(c, f);
      if (lastNoise) c.ev.push({ type: 'noise', at: { ...h.at }, radius: lastNoise });
      lastNoise = 0;
      say(c, 'The castle turns.');
      worldPhase(c);
      res.turns += 1;
      d.calmSteps = 0;
      if (c.s.stage !== 'delve') return stop('the delve is over', false);
      c.visCache = undefined;
      refreshSight(c);
    }
    if (last) break;
    // Stop conditions: calm ended, or something the player must see.
    const why = calmReason(c);
    if (why !== undefined) return stop(why);
    const halted = halt(c.ev.slice(mark));
    if (halted) return stop(halted, false);
    hp = new Map(d.heroes.map((x) => [x.heroId, x.hp]));
    stage = lightSig(d, false);
    seen = figuresInSight(c, litSet(c.w, d));
  }
  settle();
  if (c.s.stage === 'delve') {
    if (!isCalm(c)) fresh();
    updateCalm(c);
    checkDelveEnd(c);
  }
  return res;
}
