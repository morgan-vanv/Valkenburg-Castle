// V3.8 (spec 22): exploration mode. The castle runs on ticks of half a second of game time while
// the party explores: walk orders stepped hex by hex with every per-hex rule, patrols and
// investigators at a quarter of walking pace, noticing after every tick, an exploring round every
// 8 ticks, the lantern burning by distance walked. What starts combat (enemies first on being
// noticed, the party first on a hostile act or a toll, the Gloam, a fuse) and what ends it.
// Replaces V3.7's calm walk (calm.ts). Pure rules: all dice through the seeded RNG.

import { distance, posKey, range, samePos, type Pos } from './hex';
import type { ActionKind, ActionTarget, DealKind, HeroInDelve, JobKind } from './types';
import type { MoveRisks, Reach } from './api';
import { EXPLORE_PATH_MAX, HEAVY_TICKS, LANTERN_HEXES, NOTICE, PATROL_TICKS, ROUND_TICKS, SNEAK_TICKS, TORCH_HEXES, WALK_TICKS } from './data';
import { say, type Ctx, type HeroX, type MonsterX } from './state';
import { activeHeroes, checkHolds, hd, heroName, levelHeal, loseQuarry, makeNoise, nameOf, occupant, onMap, rivalsOnMap, goHunting } from './common';
import { canEnter, dijkstra, doorAt, freeNear, kindAt, litSet, pathTo, steps } from './world';
import { approach, sees, targets, walk, overwatchCheck } from './ai';
import { moveRisks, noticeHero, perceivable, provokeSwings, stepNoise, wakeRolls, watchers, wouldNotice } from './stealth';
import { ventCheck } from './falls';
import { afterHeroMove, blocksHero, checkDelveEnd, doAct, glimpse, refreshSight, setLight, spec, springTrap, unlitOnL3, visNow } from './delve';
import { computeIntents, exploreRound, searchTick, spawnGloam, worldPhase } from './world-phase';
import { crewNotice, rivalOverwatchFire, rivalsExplore } from './rivals';
import { rivalCaltropsStep } from './crewai';
import { doDeal } from './parley';

// ---------------------------------------------------------------- modes

export function isExplore(c: Ctx): boolean {
  return c.d.mode === 'explore';
}

/** The stance noticing uses while exploring: the walk order's, else the hero's own (spec 22.6). */
export function stanceOf(h: HeroInDelve): boolean {
  return h.walk ? h.walk.sneak : !!h.sneaking;
}

/** Keep the V3.7 noticing flag (`sneaked`) in step with the explore stance. */
function syncStance(c: Ctx): void {
  for (const h of c.d.heroes) if (h.status === 'active') (h as HeroX).sneaked = stanceOf(h);
}

function withArticle(name: string): string {
  if (/^the /i.test(name)) return name;
  const a = /^[aeiou]/i.test(name) ? 'An' : 'A';
  return `${a} ${name.toLowerCase()}`;
}

function theName(name: string): string {
  return /^the /i.test(name) ? name : `The ${name.toLowerCase()}`;
}

/** An alert monster still searching (not done, not walking home): it keeps a fight going (spec 22.5). */
function searching(m: MonsterX): boolean {
  return m.awareness === 'alert' && !m.returning && (m.searchRounds ?? 0) > 0;
}

/**
 * Why combat goes on (spec 22.5), or undefined when it can end: a monster hunting or searching on
 * a level with an active hero, the Gloam about, a hostile or demanding crew, a lit fuse, a hero
 * downed, held or webbed, a hero being dragged off.
 */
export function combatReason(c: Ctx): string | undefined {
  const d = c.d;
  const active = activeHeroes(c);
  const levels = new Set(active.map((h) => h.at.level));
  for (const m of onMap(c)) {
    if (m.kind === 'gloam') return 'The Gloam is near.';
    if (!levels.has(m.at.level)) continue;
    if (m.awareness === 'hunting') {
      const named = m.intent?.targetId ? hd(c, m.intent.targetId) : undefined;
      const quarry = named?.status === 'active' ? named : active.filter((h) => h.at.level === m.at.level).sort((a, b) => distance(a.at, m.at) - distance(b.at, m.at))[0];
      const who = quarry ? heroName(c, quarry.heroId) : 'the party';
      return m.kind === 'rats' ? `Rats hunt ${who}.` : `${withArticle(m.name)} hunts ${who}.`;
    }
    if (searching(m)) return m.kind === 'rats' ? 'Rats are searching.' : `${withArticle(m.name)} is searching.`;
  }
  const cr = d.rivals;
  if (cr && rivalsOnMap(c).length) {
    if (cr.stance === 'hostile') return `${cr.name} are hostile.`;
    if (cr.stance === 'demanding') return `${cr.name} want their toll.`;
  }
  if ((d.fuses ?? []).length) return 'A fuse is lit.';
  for (const h of d.heroes) {
    const name = heroName(c, h.heroId);
    if (h.status === 'downed') {
      if (cr?.members.some((r) => r.dragging === h.heroId && r.hp > 0 && !r.goneOut)) return `${name} is being dragged off.`;
      return `${name} is down.`;
    }
    if (h.status !== 'active') continue;
    if (h.grabbedBy) return `${name} is held.`;
    if (h.webbed) return `${name} is stuck.`;
  }
  return undefined;
}

/** Clear every walk order (combat starts), nudging anyone left sharing a hex onto a free one. */
function haltWalks(c: Ctx): void {
  for (const h of c.d.heroes as HeroX[]) {
    h.walk = undefined;
    h.walkWait = 0;
    h.pause = 0;
  }
  for (const h of c.d.heroes) {
    if (h.status !== 'active') continue;
    const o = occupant(c, h.at);
    if (!o || o.id === h.heroId) continue;
    const spot = freeNear(c.w, c.d, h.at, (p) => !!occupant(c, p));
    if (spot) {
      h.at = { ...spot };
      c.ev.push({ type: 'moved', id: h.heroId, path: [{ ...spot }] });
    }
  }
}

export interface CombatStart {
  first: 'party' | 'enemies';
  why: string;
  by?: string;
}

/**
 * Exploring ends (spec 22.4). Enemies first: a world phase at once, then a fresh player phase.
 * The party first: the actor keeps their spent action, the others are fresh; monsters and crew
 * members in `ambush` (caught unaware by the act) do nothing in the first world phase.
 */
export function startCombat(c: Ctx, st: CombatStart, opts: { actor?: string; ambush?: string[] } = {}): void {
  const d = c.d;
  if (c.s.stage !== 'delve' || d.mode === 'combat') return;
  d.mode = 'combat';
  haltWalks(c);
  for (const h of d.heroes) {
    if (h.heroId === opts.actor) continue;
    h.moved = false;
    h.acted = false;
    h.dashed = false;
  }
  c.ev.push({ type: 'mode', mode: 'combat', why: st.why, first: st.first, ...(st.by ? { by: st.by } : {}) });
  say(c, st.first === 'enemies' ? `Combat! ${st.why}` : `Ambush! ${st.why}`);
  if (st.first === 'enemies') {
    // Intents nobody was shown don't go off: the noticer shouts, closes in or shoots.
    for (const m of d.monsters) m.intent = undefined;
    worldPhase(c);
    checkCombatEnd(c);
    return;
  }
  if (opts.ambush?.length && opts.actor) d.ambush = { ids: opts.ambush, by: opts.actor };
  computeIntents(c);
  const caught = new Set(d.ambush?.ids ?? []);
  for (const m of d.monsters) if (caught.has(m.id)) m.intent = { kind: 'wait' };
  for (const r of d.rivals?.members ?? []) if (caught.has(r.id)) r.intent = { kind: 'wait' };
}

/** Back to exploring with a clean clock (spec 22.5). */
export function enterExplore(c: Ctx): void {
  const d = c.d;
  d.mode = 'explore';
  d.ticks = 0;
  d.ambush = undefined;
  for (const h of d.heroes as HeroX[]) {
    h.moved = false;
    h.acted = false;
    h.dashed = false;
    h.walk = undefined;
    h.walkWait = 0;
  }
  for (const m of d.monsters) m.intent = undefined;
  c.ev.push({ type: 'mode', mode: 'explore', why: 'The castle quiets.' });
  say(c, 'The castle quiets.');
}

/** In combat, after every world phase and hero action: nothing left to fight, back to exploring. */
export function checkCombatEnd(c: Ctx): boolean {
  if (c.s.stage !== 'delve' || c.d.mode !== 'combat' || c.d.phase !== 'player') return false;
  if (combatReason(c) !== undefined) return false;
  enterExplore(c);
  return true;
}

// ---------------------------------------------------------------- noticing and triggers

/**
 * Tick step 3 (spec 22.2): every awake monster looks at every active hero with the 21.5 ranges,
 * facing and blind arc (heroes it already knows by plain sight). Noticers hunt; a hunter that
 * sees nobody goes back to searching (exploring, nothing hunts unseen). A waiting cutthroat crew
 * looks too. Returns the first noticer, for the combat banner.
 */
function noticing(c: Ctx): { by: string; hero: string } | null {
  syncStance(c);
  const lit = litSet(c.w, c.d);
  const ts = targets(c).filter((t) => t.hero);
  let first: { by: string; hero: string } | null = null;
  const order = [...onMap(c)].sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
  for (const m of order) {
    if (m.kind === 'gloam' || m.awareness === 'asleep') continue;
    const here = ts.filter((t) => t.at.level === m.at.level);
    if (m.kind === 'dragon') {
      // Awake, it hunts (spec 16): that's a fight.
      if (m.awareness === 'hunting' && here.length && !first) first = { by: m.id, hero: here.sort((a, b) => distance(a.at, m.at) - distance(b.at, m.at))[0]!.id };
      continue;
    }
    const seen = here.filter((t) => perceivable(c, m, t, lit, (a, b, L) => sees(c, a, b, L))).sort((a, b) => distance(a.at, m.at) - distance(b.at, m.at));
    if (seen.length) {
      for (const t of seen) noticeHero(c, m, t.id);
      goHunting(c, m, seen[0]!.at);
      first ??= { by: m.id, hero: seen[0]!.id };
    } else if (m.awareness === 'hunting') loseQuarry(c, m);
  }
  crewNotice(c);
  return first;
}

/** What, besides a hostile act, takes the party from exploring into combat right now (spec 22.4). */
function trigger(c: Ctx): CombatStart | null {
  if (c.s.stage !== 'delve' || !isExplore(c)) return null;
  const n = noticing(c);
  if (n) return { first: 'enemies', why: `${theName(nameOf(c, n.by))} ${nameOf(c, n.by).toLowerCase() === 'rats' ? 'see' : 'sees'} ${heroName(c, n.hero)}.`, by: n.by };
  const cr = c.d.rivals;
  if (cr && rivalsOnMap(c).length) {
    if (cr.stance === 'hostile') return { first: 'enemies', why: `${cr.name} draw steel.`, by: rivalsOnMap(c)[0]!.id };
    if (cr.stance === 'demanding') return { first: 'party', why: `${cr.name} want their toll.`, by: rivalsOnMap(c)[0]!.id };
  }
  if ((c.d.fuses ?? []).length) return { first: 'party', why: 'A fuse is lit.' };
  // The Gloam: the lantern out, or a hero in the dark of the Hollow (spec 16.2). It rises now.
  const lit = litSet(c.w, c.d);
  if (onMap(c).some((m) => m.kind === 'gloam')) return { first: 'party', why: 'The Gloam is near.' };
  if ((c.d.light <= 0 && activeHeroes(c).length) || unlitOnL3(c, lit).length) {
    const g = spawnGloam(c, lit);
    if (g) return { first: 'party', why: 'The Gloam rises.', by: g.id };
  }
  return null;
}

/** Check the triggers and start combat if one fires. */
function checkTriggers(c: Ctx): boolean {
  const t = trigger(c);
  if (!t) return false;
  startCombat(c, t);
  return true;
}

// ---------------------------------------------------------------- hostile acts (spec 22.4)

const HOSTILE: ActionKind[] = ['attack', 'firebolt', 'fireball', 'nightthorn', 'briar', 'sleep', 'dread', 'dart', 'knockback', 'hamstring', 'shove', 'gust'];
const THROWN: ActionKind[] = ['glue', 'smoke', 'firecracker'];
const CHARGES: ActionKind[] = ['setCharge', 'throwCharge', 'charge'];

function isEnemy(c: Ctx, id: string | undefined): boolean {
  if (!id) return false;
  if (c.d.monsters.some((m) => m.id === id && m.kind !== 'gloam' && !m.buried)) return true;
  return rivalsOnMap(c).some((r) => r.id === id);
}

function enemyAt(c: Ctx, p: Pos | undefined): boolean {
  if (!p) return false;
  const o = occupant(c, p);
  return !!o && (o.kind === 'monster' || o.kind === 'rival') && isEnemy(c, o.id);
}

/** Would this act start a fight (spec 22.4)? Judged before it resolves (the target may not survive it). */
export function isHostileAct(c: Ctx, heroId: string, action: ActionKind, target: ActionTarget): boolean {
  if (CHARGES.includes(action)) return true;
  if (THROWN.includes(action)) return enemyAt(c, target.at);
  if (!HOSTILE.includes(action)) return false;
  if (isEnemy(c, target.id) || enemyAt(c, target.at)) return true;
  const sp = spec(c, heroId, action, target);
  return !!sp.affects?.some((id) => isEnemy(c, id));
}

/** Monsters and crew members that have noticed some hero (crews: hostile or demanding). */
function aware(c: Ctx): Set<string> {
  const out = new Set<string>();
  for (const m of c.d.monsters) if ((m.noticedIds ?? []).length) out.add(m.id);
  const cr = c.d.rivals;
  if (cr && (cr.stance === 'hostile' || cr.stance === 'demanding')) for (const r of cr.members) out.add(r.id);
  return out;
}

function allFigures(c: Ctx): string[] {
  return [...c.d.monsters.map((m) => m.id), ...(c.d.rivals?.members ?? []).map((r) => r.id)];
}

/**
 * An action while exploring (spec 22.6): no move or act limits, one at a time; the actor's walk
 * holds for a tick. A hostile act resolves, then combat with the party first (the actor has acted;
 * whoever hadn't noticed anyone is caught unaware) unless the act left nothing to fight (a silent
 * kill). Any other act may still get someone noticed (enemies first) or light a fuse.
 */
export function exploreAct(c: Ctx, heroId: string, action: ActionKind, target: ActionTarget, focus: number): string | undefined {
  syncStance(c);
  const hostile = isHostileAct(c, heroId, action, target);
  const before = aware(c);
  const err = doAct(c, heroId, action, target, focus);
  if (err) return err;
  if (c.s.stage !== 'delve') return undefined;
  const h = hd(c, heroId) as HeroX | undefined;
  if (h) h.pause = 1;
  if (hostile) {
    rivalOverwatchFire(c, heroId);
    const why = combatReason(c);
    if (why !== undefined) {
      const ambush = allFigures(c).filter((id) => !before.has(id));
      startCombat(c, { first: 'party', why: `${heroName(c, heroId)} strikes first.`, by: heroId }, { actor: heroId, ambush });
      return undefined;
    }
  }
  if (h) {
    h.moved = false;
    h.acted = false;
    h.dashed = false;
  }
  checkTriggers(c);
  return undefined;
}

/** A parley deal while exploring: Fight starts combat with the party first; anything else may still get them noticed. */
export function exploreDeal(c: Ctx, heroId: string, deal: DealKind, job?: JobKind): string | undefined {
  const was = c.d.rivals?.stance;
  const err = doDeal(c, heroId, deal, job);
  if (err) return err;
  refreshSight(c);
  if (checkDelveEnd(c)) return undefined;
  const cr = c.d.rivals;
  if (cr && cr.stance === 'hostile' && was !== 'hostile') {
    startCombat(c, { first: 'party', why: `${heroName(c, heroId)} calls the fight.`, by: heroId });
    return undefined;
  }
  checkTriggers(c);
  return undefined;
}

// ---------------------------------------------------------------- walk orders (spec 22.2)

/**
 * Hexes a walk order may use: the explored ones, plus the far end of any stairs or lift whose near
 * end is explored (you know where a stair goes; you see the next level when you get there).
 */
export function walkableSet(c: Ctx): Set<string> {
  const out = new Set(c.d.explored);
  for (const l of c.w.castle.links) {
    const a = posKey(l.a);
    const b = posKey(l.b);
    if (out.has(a)) out.add(b);
    else if (c.d.explored.includes(b)) out.add(a);
  }
  return out;
}

function canWalk(h: HeroInDelve): boolean {
  return h.status === 'active' && !h.webbed && !h.grabbedBy && !(h as HeroX).dozing && !((h.rooted ?? 0) > 0);
}

/** `walk`: a path of any length over explored hexes (through heroes, not through monsters or unhired crews), not ending on a figure. */
export function doWalk(c: Ctx, heroId: string, path: Pos[], sneak?: boolean): string | undefined {
  const h = hd(c, heroId) as HeroX | undefined;
  if (!h) return 'No such hero.';
  if (h.status !== 'active') return `${heroName(c, heroId)} can't move.`;
  if (h.webbed) return `${heroName(c, heroId)} is stuck in a web.`;
  if (h.grabbedBy) return `${heroName(c, heroId)} is held fast.`;
  if ((h.rooted ?? 0) > 0) return `${heroName(c, heroId)} is rooted to the spot.`;
  if (!path.length) return 'Pick a destination.';
  const explored = walkableSet(c);
  let prev = h.at;
  for (const p of path) {
    if (!steps(c.w, c.d, prev, { stairs: true }).some(([n]) => samePos(n, p))) return "Can't go that way.";
    if (!explored.has(posKey(p))) return "You haven't seen that way yet.";
    if (blocksHero(c, p)) return 'Something is in the way.';
    prev = p;
  }
  const end = path[path.length - 1]!;
  const o = occupant(c, end);
  if (o && o.id !== heroId) return 'Someone is already there.';
  // An order that names a stance takes the hero into it (the stance is the hero's, spec 22.6).
  if (sneak !== undefined) h.sneaking = sneak;
  h.walk = { path: path.map((p) => ({ ...p })), sneak: !!h.sneaking };
  h.walkWait = 0;
  (h as HeroX).sneaked = h.walk.sneak;
  return undefined;
}

export function doStopWalk(c: Ctx, heroId: string): string | undefined {
  const h = hd(c, heroId) as HeroX | undefined;
  if (!h) return 'No such hero.';
  h.walk = undefined;
  h.walkWait = 0;
  return undefined;
}

/** `sneak`: the hero's stance (free); a walk under way takes it up too. */
export function doSneak(c: Ctx, heroId: string, on: boolean): string | undefined {
  const h = hd(c, heroId);
  if (!h) return 'No such hero.';
  h.sneaking = on;
  if (h.walk) h.walk.sneak = on;
  if (isExplore(c)) (h as HeroX).sneaked = stanceOf(h);
  return undefined;
}

function stopWalk(c: Ctx, h: HeroX, why: string): void {
  h.walk = undefined;
  h.walkWait = 0;
  c.ev.push({ type: 'walkStopped', heroId: h.heroId, at: { ...h.at }, why });
}

/** The lantern and torches burn by distance walked (spec 22.2). */
function burnByDistance(c: Ctx, h: HeroX): void {
  const d = c.d;
  if (d.lanternBearer === h.heroId && d.lanternOpen !== false && d.light > 0) {
    d.lanternSteps = (d.lanternSteps ?? 0) + 1;
    if (d.lanternSteps >= LANTERN_HEXES) {
      d.lanternSteps = 0;
      setLight(c, d.light - 1);
    }
  }
  if (h.torch > 0) {
    h.torchSteps = (h.torchSteps ?? 0) + 1;
    if (h.torchSteps >= TORCH_HEXES) {
      h.torchSteps = 0;
      h.torch -= 1;
    }
  }
}

/**
 * One hero steps onto `p` with every per-hex rule (doors open, noise, wake rolls, crew caltrops,
 * traps, vents, level changes, the prisoner following, traps spotted, ghouls rising, the Dragon's
 * lair, the lantern and torch burn). Returns why the walk must stop, if it must.
 */
export function heroStep(c: Ctx, h: HeroX, p: Pos, sneak: boolean, last: boolean, lit: Set<string>): string | undefined {
  const from = h.at;
  if (kindAt(c.w, c.d, p) === 'door') {
    const door = doorAt(c.d, p);
    if (door && !door.open) {
      door.open = true;
      c.ev.push({ type: 'doorChanged', at: p, open: true, locked: door.locked });
    }
  }
  provokeSwings(c, h, from, p, new Set());
  if (h.status !== 'active') return 'down';
  c.ev.push({ type: 'moved', id: h.heroId, path: [{ ...p }] });
  h.at = { ...p };
  if (p.level !== from.level) {
    c.ev.push({ type: 'levelChanged', id: h.heroId, from: from.level, to: p.level });
    levelHeal(c, h);
  }
  c.visCache = undefined;
  glimpse(c, p);
  burnByDistance(c, h);
  const noise = stepNoise(c, p, sneak);
  if (noise) {
    makeNoise(c, p, noise, { quiet: true });
    c.ev.push({ type: 'noise', at: { ...p }, radius: noise });
  }
  wakeRolls(c, h, p, last, sneak, lit);
  let why: string | undefined;
  if (rivalCaltropsStep(c, h, p)) why = 'caltrops';
  else if (c.d.traps[posKey(p)]) {
    springTrap(c, h, p);
    why = 'a trap';
  }
  if (h.status === 'active' && c.w.vents.has(posKey(p))) {
    ventCheck(c, h);
    why ??= 'a fire vent';
  }
  if (h.status === 'active') afterHeroMove(c, h, sneak, true);
  if (h.status !== 'active') return 'down';
  return why;
}

/** Tick step 1: every hero with a walk order steps when their pace allows. */
function walkStep(c: Ctx): void {
  for (const h of c.d.heroes as HeroX[]) {
    if (!h.walk) continue;
    if (c.s.stage !== 'delve' || !isExplore(c)) return;
    if (h.status !== 'active') {
      h.walk = undefined;
      continue;
    }
    if (!canWalk(h)) continue;
    if ((h.pause ?? 0) > 0) {
      h.pause! -= 1;
      continue;
    }
    const next = h.walk.path[0];
    if (!next) {
      h.walk = undefined;
      continue;
    }
    const st = steps(c.w, c.d, h.at, { stairs: true }).find(([n]) => samePos(n, next));
    if (!st) {
      stopWalk(c, h, 'off the path');
      continue;
    }
    const pace = h.walk.sneak ? SNEAK_TICKS : WALK_TICKS;
    const heavy = h.pack.some((i) => i.heavy) ? HEAVY_TICKS : 1;
    const need = Math.max(pace, heavy) * st[1];
    h.walkWait = (h.walkWait ?? 0) + 1;
    if (h.walkWait < need) continue;
    h.walkWait = 0;
    const last = h.walk.path.length === 1;
    if (blocksHero(c, next)) {
      stopWalk(c, h, 'the way is blocked');
      continue;
    }
    if (last) {
      const o = occupant(c, next);
      if (o && o.id !== h.heroId) {
        stopWalk(c, h, 'someone is there');
        continue;
      }
    }
    const sneak = h.walk.sneak;
    h.walk.path.shift();
    (h as HeroX).sneaked = sneak;
    const why = heroStep(c, h, next, sneak, last, litSet(c.w, c.d));
    if (h.status !== 'active') {
      h.walk = undefined;
      continue;
    }
    if (why) stopWalk(c, h, why);
    else if (!h.walk?.path.length) h.walk = undefined;
  }
  checkHolds(c);
}

// ---------------------------------------------------------------- the castle's walkers

/** Rangers on overwatch, by id: to see whether a step drew the shot. */
function overwatching(c: Ctx): string[] {
  return c.d.heroes.filter((h) => h.status === 'active' && h.overwatch).map((h) => h.heroId);
}

/** A monster takes one step along `path` (its first hex). Returns true when it moved. */
function stepMonster(c: Ctx, m: MonsterX, path: Pos[]): boolean {
  const p = path[0];
  if (!p) return false;
  walk(c, m.id, m, [p]);
  return true;
}

/** A patrol steps a hex along its route (spec 16.1), giving the route away when a hero watches. */
function patrolStep(c: Ctx, m: MonsterX, seen: () => Set<string>): boolean {
  const route = m.route;
  if (!route || route.length < 2) return false;
  let idx = (m.routeIndex ?? 0) % route.length;
  if (samePos(route[idx]!, m.at)) idx = (idx + 1) % route.length;
  m.routeIndex = idx;
  const wp = route[idx]!;
  const path = approach(c, m.id, m.at, [wp], 2, false) ?? [];
  const start = m.at;
  const known = (c.d.knownRoutes ??= []).includes(m.id);
  const vis = known ? null : seen();
  if (!stepMonster(c, m, path)) return false;
  if (samePos(m.at, wp)) m.routeIndex = (idx + 1) % route.length;
  if (vis && m.route && (vis.has(posKey(start)) || vis.has(posKey(m.at)))) {
    c.d.knownRoutes.push(m.id);
    c.ev.push({ type: 'routeKnown', id: m.id, route: m.route.map((q) => ({ ...q })) });
    say(c, `${m.name} walks a beat. You've marked its round.`);
  }
  return true;
}

/** An alert monster walks a hex toward the noise it heard, or home; it arrives (or can get no closer) and searches (spec 22.3). */
function investigateStep(c: Ctx, m: MonsterX): boolean {
  if (!m.focusAt) return false;
  if (samePos(m.focusAt, m.at)) {
    m.focusAt = undefined;
    m.returning = undefined;
    return false;
  }
  const path = approach(c, m.id, m.at, [m.focusAt], 2, false) ?? [];
  if (!path.length) {
    // No way closer: it searches (or stands its post) from here.
    m.focusAt = undefined;
    m.returning = undefined;
    return false;
  }
  stepMonster(c, m, path);
  if (m.focusAt && samePos(m.focusAt, m.at)) {
    m.focusAt = undefined;
    m.returning = undefined;
  }
  return true;
}

/**
 * Tick step 2 (every PATROL_TICKS): patrols, investigators and monsters walking back step a hex;
 * an armed overwatch shoots the first enemy that steps into sight. Returns the Ranger who shot.
 */
function castleStep(c: Ctx): string | null {
  const order = [...onMap(c)].sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
  let vis: Set<string> | null = null;
  const seen = (): Set<string> => (vis ??= visNow(c));
  for (const m of order) {
    if (!c.d.monsters.includes(m) || m.kind === 'gloam' || m.kind === 'dragon' || m.awareness === 'asleep' || m.awareness === 'hunting') continue;
    if ((m.stuck ?? 0) > 0 || (m.feared ?? 0) > 0) continue;
    const before = m.at;
    const moved = m.awareness === 'patrol' ? patrolStep(c, m, seen) : investigateStep(c, m);
    if (!moved || samePos(before, m.at) || !c.d.monsters.includes(m)) continue;
    const ow = overwatching(c);
    if (!ow.length) continue;
    const aw = aware(c);
    overwatchCheck(c, m.id, m.at);
    const shooter = ow.find((id) => !hd(c, id)?.overwatch);
    if (shooter) {
      const ambush = allFigures(c).filter((id) => !aw.has(id));
      if (combatReason(c) !== undefined) {
        startCombat(c, { first: 'party', why: `${heroName(c, shooter)} looses an arrow.`, by: shooter }, { actor: shooter, ambush });
        hd(c, shooter)!.acted = true;
        return shooter;
      }
    }
  }
  return null;
}

/** Exploring round: investigators that have arrived search a round; done, they go back to their beat or post. */
function searchRound(c: Ctx): void {
  for (const m of c.d.monsters) {
    if (m.awareness !== 'alert' || m.focusAt) continue;
    searchTick(c, m);
  }
}

// ---------------------------------------------------------------- the tick

/**
 * Half a second of game time while exploring (spec 22.2): (1) walk orders step, (2) every 4th
 * tick patrols, investigators and crews step, (3) noticing, (4) every 8th tick an exploring round.
 * Then the combat triggers.
 */
export function doTick(c: Ctx): void {
  const d = c.d;
  d.ticks = (d.ticks ?? 0) + 1;
  syncStance(c);
  // What the heroes see only changes when a hero or a crew member moves, a door opens or the light changes.
  const look = (): string =>
    JSON.stringify([d.heroes.map((h) => [h.at, h.status]), d.light, d.lanternOpen, d.lanternBearer, (d.rivals?.members ?? []).map((r) => r.at), Object.values(d.doors).map((x) => x.open)]);
  const before = look();
  walkStep(c);
  if (c.s.stage !== 'delve' || !isExplore(c)) return;
  rivalsExplore(c, 'tick');
  if (d.ticks % PATROL_TICKS === 0) {
    if (castleStep(c)) return;
    rivalsExplore(c, 'step');
  }
  c.visCache = undefined;
  if (look() !== before) refreshSight(c);
  if (checkDelveEnd(c) || !isExplore(c)) return;
  if (checkTriggers(c)) return;
  if (d.ticks % ROUND_TICKS === 0) {
    exploreRound(c);
    searchRound(c);
    rivalsExplore(c, 'round');
    refreshSight(c);
    if (checkDelveEnd(c)) return;
    checkTriggers(c);
  }
}

// ---------------------------------------------------------------- queries (spec 22.7)

/** Risks of an explore path: moveRisks, with noticing checked at every hex on the way, not only the end. */
function exploreRisks(c: Ctx, h: HeroInDelve, path: Pos[], sneak: boolean, lit: Set<string>): MoveRisks {
  const risks = moveRisks(c, h, path, sneak, lit);
  const seen = new Set(risks.notice.map((n) => n.id));
  const levels = new Set(path.map((p) => p.level));
  for (const lv of levels) {
    for (const wt of watchers(c, lv)) {
      if (seen.has(wt.id) || wt.noticed(h.heroId)) continue;
      if (path.some((p) => p.level === lv && wouldNotice(c, wt.f, p, sneak, lit))) {
        seen.add(wt.id);
        risks.notice.push({ id: wt.id });
      }
    }
  }
  return risks;
}

/** An explore path to `to` over explored hexes (any length, through heroes; spotted traps and vents avoided when there's another way), or null. */
export function explorePath(c: Ctx, heroId: string, to: Pos, sneak: boolean): Reach | null {
  const h = hd(c, heroId);
  if (!h || !canWalk(h) || samePos(h.at, to)) return null;
  const explored = walkableSet(c);
  if (!explored.has(posKey(to))) return null;
  const o = occupant(c, to);
  if (o && o.id !== heroId) return null;
  const nodes = dijkstra(c.w, c.d, h.at, {
    enter: (p) => explored.has(posKey(p)) && !blocksHero(c, p),
    penalty: (p) => (c.d.traps[posKey(p)]?.spotted || c.w.vents.has(posKey(p)) ? 10 : 0),
    stairs: true,
    budget: EXPLORE_PATH_MAX,
  });
  const n = nodes.get(posKey(to));
  if (!n) return null;
  const path = pathTo(nodes, to);
  return { to: { ...to }, cost: n.cost, path, risks: exploreRisks(c, h, path, sneak, litSet(c.w, c.d)) };
}

/** For each awake enemy on a level with an active hero: the hexes where it would notice a walking / a sneaking hero right now. */
export function vision(c: Ctx): { id: string; walk: Pos[]; sneak: Pos[] }[] {
  const lit = litSet(c.w, c.d);
  const out: { id: string; walk: Pos[]; sneak: Pos[] }[] = [];
  const reach = Math.max(NOTICE.litWalk, NOTICE.hollowWalk, NOTICE.unlitWalk);
  // Levels with an active hero (cones are only drawn near heroes; other levels would be wasted work).
  const levels = new Set<number>(activeHeroes(c).map((h) => h.at.level));
  for (const lv of levels) {
    for (const wt of watchers(c, lv)) {
      const walkHexes: Pos[] = [];
      const sneakHexes: Pos[] = [];
      for (const x of range(wt.f.at, reach)) {
        const p = { level: lv, ...x };
        if (samePos(p, wt.f.at) || !c.w.tile(p) || !canEnter(c.w, c.d, p)) continue;
        if (!wouldNotice(c, wt.f, p, false, lit)) continue;
        walkHexes.push(p);
        if (wouldNotice(c, wt.f, p, true, lit)) sneakHexes.push(p);
      }
      out.push({ id: wt.id, walk: walkHexes, sneak: sneakHexes });
    }
  }
  return out;
}

void distance;
