// Hero commands during a delve: move, actions (with their targets, roll
// specs and effects), leave/abandon, the end of the delve.

import { DIRS, distance, hexToWorld, posKey, posNeighbors, range, samePos, type Pos } from './hex';
import type { ActionKind, ActionTarget, HeroClass, HeroInDelve, Item, Stat } from './types';
import type { ActionOption } from './api';
import {
  HEAVY_MOVE, SMUGGLER_SNEAK, BURGLAR_WALK, WALK_MOVE, BLINK_RANGE, BRAZIER_LIGHT, BURN_ROUNDS, CLASSES, DIG_NOISE, FIREBALL_NOISE, FIREBALL_RANGE, FIRECRACKER_NOISE, GHOUL_RISE_RANGE,
  BURGLAR_PICK_SLOTS, GLUE_ROUNDS, GUST_NOISE, GUST_RANGE, KINDLE_LIGHT, KNOCKBACK_RANGE, LIGHT_MAX, LOCKPICK_SLOTS, NIGHTSIGHT_ROUNDS, OIL_LIGHT, PACK_SLOTS, SLEEP_RANGE, SMOKE_ROUNDS, SPELL_RANGE,
  THROW_CHARGE_RANGE, THROW_RANGE, TORCH_ROUNDS, VEIL_BREAK_NOISE, VEIL_ROUNDS, WARD_ROUNDS, WINCH_NOISE, BLAST_INNER_DMG, BLAST_OUTER_DMG, BLAST_NOISE,
} from './data';
import { say, type Ctx, type HeroX, type MonsterX, type RivalX } from './state';
import {
  activeHeroes, addToPack, focusMax, levelHeal, armorOf, brightnessAt, checkHolds, chestLoot, cleanGround, goHunting, hd, heroDef, heroName, hurtAny, hurtHero, killHero,
  LIGHT_PENALTY, lightPenaltyFor, makeHostile, makeNoise, monsterArmor, monsterStats, nightEyed, noteOnce, occupant, onMap, packUsed, passLanternIfNeeded, putOnGround,
  releaseHold, rivalsOnMap, roll, shieldWalled, turnOnHit, valueOf, wakeAdjacent, dropCaptive,
} from './common';
import {
  adjacent, brightnessOf, canEnter, clampLight, dijkstra, doorAt, fallColumn, freeNear, glimpseSet, isFloorish, kindAt, litSet, los, monsterSees, pathTo,
  pitsNextTo, standable, steps, visibleSet, within,
} from './world';
import { buildSummary } from './camp';
import { fall, fallInfo, push, pushOutcome, pushText, setAfterLanding, ventCheck } from './falls';
import { blastPreview, blastableWall, chargeCount, collapseDrop, fuseAt, isKit, setFuse, spendCharge } from './charges';
import { lairCheck } from './dragon';
import { crewAim, crewNotice, rivalOverwatchFire, rivalStats } from './rivals';
import { capture, rivalCaltropsStep, striker } from './crewai';
import { parleyTargets } from './parley';
import { dirIndex, faceToward, fleePlan, forgetHeroes, hasNoticed, inRearHalf, moveRisks, noticeHero, provokeSwings, stepNoise, swingersFor, wakeRolls } from './stealth';
import { hitRange } from './ai';
import { BACKSTAB_DMG_MULT, BACKSTAB_SLOTS, DREAD_MANA, DREAD_RANGE, DREAD_ROUNDS, DREAD_SLOTS, SNEAK_ATTACK_SLOTS, FACING } from './data';
import { SEARCH_ROUNDS } from './data'; // V4.0 (spec 27)
import {
  BRIAR_DMG, BRIAR_MANA, BRIAR_NOISE, BRIAR_RANGE, BRIAR_ROOT, BRIAR_ROOT_PERFECT, BRIAR_SLOTS, HAMSTRING_NOISE, HAMSTRING_PENALTY, HAMSTRING_RANGE, HAMSTRING_ROUNDS,
  HAMSTRING_SLOTS, NIGHTTHORN_DMG, NIGHTTHORN_MANA, NIGHTTHORN_RANGE, NIGHTTHORN_SLOTS, SHIELD_BRACED_DMG, SMASH_GOLD, SMASH_GOLD_CHANCE, SMASH_ITEM_CHANCE,
  SMASH_ITEMS, SMASH_NOISE,
} from './data';
import { int, pick } from './rng';
import { makeItem, rootFigure } from './common';
import { calmWalk, isCalm } from './calm';
import { noticeOnMove } from './world-phase';
import { checkWays, isGateKey, wayAtEntrance, wayOpen } from './ways';

// ---------------------------------------------------------------- sight bookkeeping

/**
 * Mark everything in line of sight from `at` as explored (layout only). V3.9 (spec 24.2): through the
 * front half of the active hero standing there (no hero there: all round).
 */
export function glimpse(c: Ctx, at: Pos, ex: Set<string> = new Set(c.d.explored), lit?: Set<string>): void {
  const eye = c.d.heroes.find((h) => h.status === 'active' && samePos(h.at, at));
  for (const p of glimpseSet(c.w, c.d, at, lit, eye?.facing)) {
    const k = posKey(p);
    if (!ex.has(k)) {
      ex.add(k);
      c.d.explored.push(k);
    }
  }
}

/** After anything changes: explored grows, rivals get spotted, the Gloam fades in light. */
/** The heroes' current visible set, memoized on the context (targets ask for it many times). */
export function visNow(c: Ctx): Set<string> {
  return (c.visCache ??= visibleSet(c.w, c.d));
}

export function refreshSight(c: Ctx): void {
  c.visCache = undefined;
  const lit = litSet(c.w, c.d);
  const vis = visibleSet(c.w, c.d, lit);
  const ex = new Set(c.d.explored);
  for (const k of vis) if (!ex.has(k)) c.d.explored.push(k);
  for (const h of c.d.heroes) if (h.status === 'active') glimpse(c, h.at, ex, lit);
  noteSeen(c, vis);

  const cr = c.d.rivals;
  if (cr && !cr.spotted && rivalsOnMap(c).some((r) => (r.veil ?? 0) <= 0 && vis.has(posKey(r.at)))) {
    cr.spotted = true;
    if (cr.temperament === 'cutthroat') say(c, `${cr.name} hold the way ahead. Cutthroats.`);
    else say(c, `${cr.name}. They want ${cr.goal === 'leave' ? 'out' : 'the loot'}.`);
    // The Shadowmancer sister slips into shadow the moment she's seen (spec 16.5): shown as an intent first.
    // V3.7 (spec 20.4): she veils the crew's striker (the melee member within 3), or herself. (A hostile
    // crew plans its own kit in crewai.ts; this is the prospectors' and the waiting crews' first reflex.)
    for (const r of rivalsOnMap(c)) {
      if (r.cls !== 'shadowmancer' || r.veiled || cr.stance === 'hired' || cr.stance === 'hostile') continue;
      const s = striker(c);
      r.intent = { kind: 'veil', targetId: s && s !== r && within(s.at, r.at, SPELL_RANGE) ? s.id : r.id };
    }
    crewAim(c);
  }
  // Spec 18.5: a waiting cutthroat crew sees a hero within 6 and demands the toll.
  if (cr?.stance === 'waiting') {
    crewNotice(c);
    if (cr.stance !== 'waiting') crewAim(c);
  }
}

/** V3.9 (spec 24.4): every monster and crew member standing in the party's sight joins `seen` (veiled crew don't). */
export function noteSeen(c: Ctx, vis: Set<string>): void {
  const seen = (c.d.seen ??= []);
  const add = (id: string) => {
    if (!seen.includes(id)) seen.push(id);
  };
  for (const m of c.d.monsters) if (!m.buried && vis.has(posKey(m.at))) add(m.id);
  for (const r of rivalsOnMap(c)) if ((r.veil ?? 0) <= 0 && vis.has(posKey(r.at))) add(r.id);
}

/** V3.9 (spec 24.4): ids of the enemies the party has seen this delve that are still about (with whoever is in sight now). */
export function seenSet(c: Ctx, vis: Set<string> = visNow(c)): Set<string> {
  const out = new Set<string>();
  const was = new Set(c.d.seen ?? []);
  for (const m of c.d.monsters) if (!m.buried && (was.has(m.id) || vis.has(posKey(m.at)))) out.add(m.id);
  for (const r of rivalsOnMap(c)) if (was.has(r.id) || ((r.veil ?? 0) <= 0 && vis.has(posKey(r.at)))) out.add(r.id);
  return out;
}

/** V3.9 (spec 24.2): turn a hero to `facing`, with a `faced` event when it changed. */
export function setFacing(c: Ctx, h: HeroInDelve, facing: number): void {
  if (h.facing === facing) return;
  h.facing = facing;
  c.visCache = undefined;
  c.ev.push({ type: 'faced', id: h.heroId, facing });
}

/** The `face` command (spec 24.2): free and unlimited in the player phase. */
export function doFace(c: Ctx, heroId: string, facing: number): string | undefined {
  const h = hd(c, heroId);
  if (!h) return 'No such hero.';
  if (!FACING.faceCommand) return 'Heroes face the way they last moved.';
  if (!Number.isInteger(facing) || facing < 0 || facing > 5) return 'Face one of the six sides.';
  if (h.status !== 'active') return `${heroName(c, heroId)} can't turn.`;
  if ((h as HeroX).dozing) return `${heroName(c, heroId)} is out cold this turn.`;
  setFacing(c, h, facing);
  refreshSight(c);
  return undefined;
}

/** Active heroes on Level 3 standing in the dark (spec 16.2: the Gloam's quarry). */
export function unlitOnL3(c: Ctx, lit: Set<string> = litSet(c.w, c.d)): HeroInDelve[] {
  return c.d.heroes.filter((h) => h.status === 'active' && h.at.level === 3 && !lit.has(posKey(h.at)));
}

export function setLight(c: Ctx, value: number): void {
  c.visCache = undefined;
  const before = c.d.light;
  c.d.light = clampLight(value);
  if (c.d.light !== before) c.ev.push({ type: 'light', light: c.d.light, brightness: brightnessOf(c.d.light) });
  if (c.d.light > 0 && before === 0) {
    const g = c.d.monsters.find((m) => m.kind === 'gloam');
    if (g && !unlitOnL3(c).length) {
      c.d.monsters = c.d.monsters.filter((m) => m !== g);
      c.d.gloamCalm = 0;
      c.ev.push({ type: 'monsterDied', id: g.id });
      say(c, 'The dark draws back.');
    }
  }
}

// ---------------------------------------------------------------- movement

export function moveBudget(c: Ctx, h: HeroInDelve, sneak: boolean): number {
  const cls = heroDef(c, h.heroId)?.cls;
  // V4.0 (spec 26.4): the Burglar walks 5 (dash 5) and sneaks 4; everyone else walks 4.
  let b = sneak ? (cls === 'burglar' || h.ale === 'smuggler' ? SMUGGLER_SNEAK : 2) : cls === 'burglar' ? BURGLAR_WALK : WALK_MOVE;
  if (h.escorting) b = Math.min(b, 3); // the prisoner's pace caps a Burglar too
  // Spec 18.3: the brewing copper is heavy: its carrier moves 3 at most (dash too).
  if (h.pack.some((i) => i.heavy)) b = Math.min(b, HEAVY_MOVE);
  return b;
}

/** V4.0 (spec 26.1): the hero's own Walk/Sneak setting (absent = walk). */
export function sneakSetting(c: Ctx, heroId: string): boolean {
  return hd(c, heroId)?.moveMode === 'sneak';
}

/** V4.0 (spec 26.1): the `setMoveMode` command: free, any active hero, player phase. Changes nothing else. */
export function doSetMoveMode(c: Ctx, heroId: string, sneak: boolean): string | undefined {
  const h = hd(c, heroId);
  if (!h) return 'No such hero.';
  if (h.status !== 'active') return `${heroName(c, heroId)} isn't moving anywhere.`;
  h.moveMode = sneak ? 'sneak' : 'walk';
  return undefined;
}

/**
 * Who a hero can't walk through (spec 19.4): monsters and rivals, except the members of a crew
 * the party has hired. Heroes, the prisoner and hired crew are passed through (never ended on).
 */
export function blocksHero(c: Ctx, p: Pos): boolean {
  const o = occupant(c, p);
  if (!o) return false;
  if (o.kind === 'monster') return true;
  if (o.kind === 'rival') return c.d.rivals?.stance !== 'hired';
  return false;
}

function trapPenalty(c: Ctx, p: Pos): number {
  return c.d.traps[posKey(p)]?.spotted ? 10 : 0;
}

/** Can this hero move now? 'walk' = first move; 'dash' = second move that spends the action (spec 15.2). */
export function moveKind(h: HeroInDelve): 'walk' | 'dash' | null {
  if (h.status !== 'active' || h.webbed || h.grabbedBy || (h as HeroX).dozing || (h.rooted ?? 0) > 0) return null;
  if (!h.moved) return 'walk';
  if (!h.acted && !h.dashed) return 'dash';
  return null;
}

export function reachable(c: Ctx, heroId: string, sneak: boolean) {
  const h = hd(c, heroId);
  if (!h || c.d.phase !== 'player') return [];
  const mk = moveKind(h);
  if (!mk) return [];
  const nodes = dijkstra(c.w, c.d, h.at, {
    enter: (p) => !blocksHero(c, p),
    penalty: (p) => trapPenalty(c, p),
    stairs: true,
    budget: moveBudget(c, h, sneak),
  });
  const out = [];
  // V3.7 (spec 20.1, 20.2): what each path risks, for the preview (one lit set for the whole query).
  const lit = litSet(c.w, c.d);
  // V3.9 (spec 24.4): risks only from enemies the party has seen.
  const vis = visNow(c);
  const seen = seenSet(c, vis);
  for (const n of nodes.values()) {
    if (samePos(n.p, h.at)) continue;
    const o = occupant(c, n.p);
    if (o) continue; // can't end on another hero or the prisoner
    const path = pathTo(nodes, n.p);
    out.push({ to: n.p, cost: n.cost, path, risks: moveRisks(c, h, path, sneak, lit, seen, vis), ...(mk === 'dash' ? { dash: true } : {}) });
  }
  return out;
}

/** Walking noise per hex (spec 20.1): 1, 2 on rubble; sneaking is silent. */
export function moveNoise(sneak: boolean): number {
  return sneak ? 0 : 1;
}

export function doMove(c: Ctx, heroId: string, path: Pos[], sneak: boolean, follow = false): string | undefined {
  const h = hd(c, heroId);
  if (!h) return 'No such hero.';
  if (h.status !== 'active') return `${heroName(c, heroId)} can't move.`;
  if (h.webbed) return `${heroName(c, heroId)} is stuck in a web.`;
  if (h.grabbedBy) return `${heroName(c, heroId)} is held fast. Break free first.`;
  if ((h as HeroX).dozing) return `${heroName(c, heroId)} is out cold this turn.`;
  if ((h.rooted ?? 0) > 0) return `${heroName(c, heroId)} is rooted to the spot for ${h.rooted} more ${h.rooted === 1 ? 'round' : 'rounds'}.`;
  const mk = moveKind(h);
  if (!mk) return h.dashed ? `${heroName(c, heroId)} has already dashed.` : `${heroName(c, heroId)} has already moved.`;
  if (!path.length) return 'Pick a destination.';
  c.visCache = undefined;
  // Validate.
  const calm = isCalm(c);
  let cost = 0;
  let prev = h.at;
  for (const p of path) {
    const st = steps(c.w, c.d, prev, { stairs: true }).find(([n]) => samePos(n, p));
    if (!st) return "Can't go that way.";
    if (blocksHero(c, p)) return 'Something is in the way.';
    cost += st[1];
    prev = p;
  }
  if (!calm && cost > moveBudget(c, h, sneak)) return 'Too far.';
  if (occupant(c, path[path.length - 1]!)) return 'Someone is already there.';
  // V3.7 (spec 20.5): calm: a walk of any length, hex by hex, the castle turning every CALM_STEPS steps; `moved` stays clear.
  if (calm) {
    calmWalk(c, h, path, sneak, follow);
    checkHolds(c);
    if (c.s.stage === 'delve') rivalOverwatchFire(c, heroId);
    return undefined;
  }
  // Walk (or dash: the action goes on the second move).
  h.moved = true;
  if (mk === 'dash') {
    h.dashed = true;
    h.acted = true;
  }
  (h as HeroX).sneaked = sneak;
  const walked: Pos[] = [];
  let from = h.at;
  const lit = litSet(c.w, c.d);
  const swung = new Set<string>();
  let lastNoise = 0;
  const faceBefore = h.facing;
  for (const [i, p] of path.entries()) {
    if (kindAt(c.w, c.d, p) === 'door') {
      const door = doorAt(c.d, p);
      if (door && !door.open) {
        door.open = true;
        c.ev.push({ type: 'doorChanged', at: p, open: true, locked: door.locked });
      }
    }
    // V3.7 (spec 20.2): stepping out of an enemy's reach gives it a free swing (once per enemy per move).
    provokeSwings(c, h, from, p, swung);
    if (h.status !== 'active') break;
    walked.push(p);
    if (p.level !== from.level) {
      c.ev.push({ type: 'moved', id: heroId, path: [...walked] });
      walked.length = 0;
      c.ev.push({ type: 'levelChanged', id: heroId, from: from.level, to: p.level });
      h.at = { ...p };
      levelHeal(c, h);
    }
    // V3.9 (spec 24.2): a walking hero faces the way of each step (stairs keep the facing).
    if (p.level === from.level) h.facing = dirIndex(from, p);
    h.at = { ...p };
    from = p;
    c.visCache = undefined;
    glimpse(c, p);
    // V4.0 (spec 26.2): enemies already awake notice the hero on this hex, now (before this step's noise and wake
    // rolls: a sleeper this step wakes notices from the next one); the walk goes on.
    noticeOnMove(c, h, () => {
      if (!walked.length) return;
      c.ev.push({ type: 'moved', id: heroId, path: [...walked] });
      walked.length = 0;
    });
    // V3.7 (spec 20.1): noise at every hex (1, 2 on rubble; sneaking silent), and sleepers within 2 roll to wake.
    lastNoise = stepNoise(c, p, sneak);
    if (lastNoise) makeNoise(c, p, lastNoise, { quiet: true });
    wakeRolls(c, h, p, i === path.length - 1, sneak, lit);
    // V3.7 (spec 20.4): a crew's caltrops catch heroes too: 2 damage and the walk ends here.
    if (rivalCaltropsStep(c, h, p)) {
      c.ev.push({ type: 'moved', id: heroId, path: [...walked] });
      walked.length = 0;
      break;
    }
    const trap = c.d.traps[posKey(p)];
    if (trap) {
      c.ev.push({ type: 'moved', id: heroId, path: [...walked] });
      walked.length = 0;
      springTrap(c, h, p);
      if (h.status !== 'active') break;
    }
  }
  if (walked.length) c.ev.push({ type: 'moved', id: heroId, path: [...walked] });
  if (h.facing !== undefined && h.facing !== faceBefore) c.ev.push({ type: 'faced', id: heroId, facing: h.facing });
  if (lastNoise && h.status === 'active') c.ev.push({ type: 'noise', at: { ...h.at }, radius: lastNoise });
  ventCheck(c, h);
  afterHeroMove(c, h, sneak, true);
  checkHolds(c);
  rivalOverwatchFire(c, heroId);
  refreshSight(c);
  checkDelveEnd(c);
  return undefined;
}

export function springTrap(c: Ctx, h: HeroInDelve, at: Pos): void {
  delete c.d.traps[posKey(at)];
  c.ev.push({ type: 'trap', at, id: h.heroId, damage: 3 });
  say(c, `A trap bites ${heroName(c, h.heroId)}.`);
  hurtHero(c, h, 3, 'trap');
  makeNoise(c, at, 2);
}

/** Prisoner follows, traps get spotted, sleepers next to the hero wake (`walked`: doMove rolled the wakes per hex already). */
export function afterHeroMove(c: Ctx, h: HeroInDelve, sneak = false, walked = false): void {
  const pr = c.d.prisoner;
  if (pr && h.escorting === pr.id && !pr.dead && !pr.out && !adjacent(pr.at, h.at)) {
    const spot = posNeighbors(h.at)
      // Not onto doors (V4.0: except the open sally port gate, the only way to its exit).
      .filter((p) => canEnter(c.w, c.d, p) && !occupant(c, p) && !c.d.traps[posKey(p)] && (kindAt(c.w, c.d, p) !== 'door' || !!c.w.tile(p)?.barred))
      .sort((a, b) => (a.level === pr.at.level ? distance(a, pr.at) : 99) - (b.level === pr.at.level ? distance(b, pr.at) : 99))[0];
    if (spot) {
      pr.at = spot;
      c.ev.push({ type: 'moved', id: pr.id, path: [spot] });
    }
  }
  if (h.status !== 'active') return;
  for (const [k, t] of Object.entries(c.d.traps)) {
    if (t.spotted) continue;
    const [lv, rest] = k.split(':');
    const [q, r] = (rest ?? '0,0').split(',').map(Number) as [number, number];
    const at = { level: Number(lv), q, r };
    if (!within(at, h.at, 1)) continue;
    const def = heroDef(c, h.heroId)!;
    const p = def.stats.wits + lightPenaltyFor(c.w, c, h);
    const r1 = roll(c, h.heroId, 'Spot trap', 1, p);
    if (r1.hits) {
      t.spotted = true;
      c.ev.push({ type: 'trapSpotted', at });
      say(c, `${heroName(c, h.heroId)} spots a trap.`);
    }
  }
  // V4.0 (spec 26.2): where a blink, fall, climb or grapple lands, enemies already awake notice the hero now
  // (a walk has checked every hex already); sleepers woken by the landing notice from the hero's next move.
  if (!walked) {
    noticeOnMove(c, h);
    wakeAdjacent(c, h.at, sneak, h.heroId);
  }
  riseGhouls(c, h);
  lairCheck(c, h, sneak);
}

/** Buried ghouls within GHOUL_RISE_RANGE of a hero who just ended a move claw their way out, hunting (spec 16.4). */
export function riseGhouls(c: Ctx, h: HeroInDelve): void {
  for (const m of c.d.monsters) {
    if (!m.buried || !within(m.at, h.at, GHOUL_RISE_RANGE)) continue;
    m.buried = false;
    if (occupant(c, m.at)) {
      const free = freeNear(c.w, c.d, m.at, (p) => !!occupant(c, p));
      if (free) m.at = { ...free };
    }
    m.awareness = 'hunting';
    m.focusAt = { ...h.at };
    m.intent = undefined;
    faceToward(m, h.at); // it rises facing its quarry (V4.0: noticeHero no longer turns a hunter)
    noticeHero(c, m, h.heroId);
    c.ev.push({ type: 'spawned', id: m.id, at: { ...m.at } });
    c.ev.push({ type: 'awake', id: m.id, awareness: 'hunting' });
    say(c, `${m.name} claws its way out of the bones.`);
  }
}

setAfterLanding((c, h) => {
  if (h && h.status === 'active') afterHeroMove(c, h);
});

// ---------------------------------------------------------------- targets

const FREE: ActionKind[] = ['open', 'take', 'drop', 'give', 'leave', 'shutter', 'parley'];

function lockedThingAt(c: Ctx, p: Pos): { door?: boolean; chest?: boolean; jammed: boolean; barred?: boolean } | null {
  const door = kindAt(c.w, c.d, p) === 'door' ? doorAt(c.d, p) : undefined;
  // V4.0 (spec 25.2): a barred gate is locked, but only its key or a blast opens it.
  if (door && door.locked && !door.open) return { door: true, jammed: door.jammed, ...(c.w.tile(p)?.barred ? { barred: true } : {}) };
  const ch = c.d.chests.find((x) => samePos(x.at, p) && !x.opened && x.locked);
  if (ch) return { chest: true, jammed: ch.jammed };
  return null;
}

/** V3.7 (spec 20.3): a hex a charge can sit on: floor-like (doors too), a cracked or breakable wall; no fuse there yet. */
function chargeSpot(c: Ctx, p: Pos): boolean {
  if (fuseAt(c.d, p)) return false;
  return isFloorish(c.w, c.d, p) || blastableWall(c.w, c.d, p);
}

function aroundAndSelf(p: Pos): Pos[] {
  return [p, ...posNeighbors(p)];
}

/** Adjacent enemies the party can see (V3.9, spec 24.2: one in a rear hex nobody covers is turned to first). */
function enemiesAdjacent(c: Ctx, h: HeroInDelve, shove = false): ActionTarget[] {
  const vis = visNow(c);
  const out: ActionTarget[] = [];
  for (const m of onMap(c)) if (m.kind !== 'gloam' && !(shove && m.kind === 'dragon') && adjacent(m.at, h.at) && vis.has(posKey(m.at))) out.push({ id: m.id, at: m.at });
  for (const r of rivalsOnMap(c)) if ((r.veil ?? 0) <= 0 && adjacent(r.at, h.at) && vis.has(posKey(r.at))) out.push({ id: r.id, at: r.at });
  return out;
}

/** Enemies within `n` hexes that the heroes can see and the hero has a line to (monsters, rivals; no Gloam). */
function enemiesInSight(c: Ctx, h: HeroInDelve, n: number, opts: { noDragon?: boolean; monstersOnly?: boolean } = {}): ActionTarget[] {
  const vis = visNow(c);
  const out: ActionTarget[] = [];
  const cands = [...onMap(c).filter((m) => m.kind !== 'gloam' && !(opts.noDragon && m.kind === 'dragon')), ...(opts.monstersOnly ? [] : rivalsOnMap(c).filter((r) => (r.veil ?? 0) <= 0))];
  for (const m of cands) {
    if (within(m.at, h.at, n) && vis.has(posKey(m.at)) && los(c.w, c.d, h.at, m.at)) out.push({ id: m.id, at: m.at });
  }
  return out;
}

/** Hexes within `n` of the hero that the heroes can see now (same level). */
function hexesInSight(c: Ctx, h: HeroInDelve, n: number, filter: (p: Pos) => boolean = () => true): ActionTarget[] {
  const vis = visNow(c);
  const out: ActionTarget[] = [];
  for (const x of range(h.at, n)) {
    const p = { level: h.at.level, ...x };
    if (!c.w.tile(p) || !vis.has(posKey(p)) || !filter(p)) continue;
    out.push({ at: p });
  }
  return out;
}

/** Allies (self included) within `n`, active. */
function alliesWithin(c: Ctx, h: HeroInDelve, n: number): ActionTarget[] {
  return c.d.heroes.filter((o) => o.status === 'active' && within(o.at, h.at, n)).map((o) => ({ id: o.heroId }));
}

/** The hex one step from `at` straight away from `from` (for ranged pushes: the direction rounded to a hex side). */
export function awayFrom(from: Pos, at: Pos): Pos {
  if (distance(from, at) <= 1) return { level: at.level, q: 2 * at.q - from.q, r: 2 * at.r - from.r };
  const A = hexToWorld(from);
  const B = hexToWorld(at);
  const vx = B.x - A.x;
  const vz = B.z - A.z;
  let best = DIRS[0]!;
  let bestDot = -Infinity;
  for (const d of DIRS) {
    const D = hexToWorld(d);
    const dot = D.x * vx + D.z * vz;
    if (dot > bestDot) {
      bestDot = dot;
      best = d;
    }
  }
  return { level: at.level, q: at.q + best.q, r: at.r + best.r };
}

/** A virtual pusher position so that push()/pushOutcome() send the figure at `at` one hex away from `from`. */
export function pusherFor(from: Pos, at: Pos): Pos {
  const dest = awayFrom(from, at);
  return { level: at.level, q: 2 * at.q - dest.q, r: 2 * at.r - dest.r };
}

/** Where a grappling hook from `at` (a pit landing or pit floor) climbs to: a free edge hex on the level above, or null. */
export function grappleTop(c: Ctx, at: Pos, self: string): { pit: Pos; to: Pos } | { pit: Pos; to: null } | null {
  const up = at.level - 1;
  if (!c.w.levels.has(up)) return null;
  const col = { level: up, q: at.q, r: at.r };
  // The column above, or the nearest pit hex within 2 (landings can be offset from the column).
  const pits = range(col, 2)
    .map((x) => ({ level: up, ...x }))
    .filter((p) => kindAt(c.w, c.d, p) === 'pit' && fallColumn(c.w, c.d, p)?.to.level === at.level)
    .sort((a, b) => distance(a, col) - distance(b, col));
  const pit = pits[0];
  if (!pit) return null;
  const edges = posNeighbors(pit)
    .filter((p) => standable(c.w, c.d, p) && !c.w.vents.has(posKey(p)))
    .sort((a, b) => distance(a, col) - distance(b, col));
  const free = edges.find((p) => { const o = occupant(c, p); return !o || o.id === self; });
  return { pit, to: free ?? null };
}

/** What `take` at pile `at` would pick up for hero `h`, in order: the contract item first. */
export function takePlan(c: Ctx, h: HeroInDelve, at: Pos): { items: Item[]; blocked?: string } {
  const g = c.d.ground.find((x) => samePos(x.at, at));
  if (!g || !g.items.length) return { items: [] };
  const ordered = [...g.items].sort((a, b) => Number(!!b.contractId) - Number(!!a.contractId) || Number(b.kind === 'heirloom' || b.kind === 'hoard') - Number(a.kind === 'heirloom' || a.kind === 'hoard'));
  const contract = ordered.find((i) => i.contractId);
  const room = PACK_SLOTS - packUsed(h.pack);
  if (contract && contract.slots > room) return { items: [], blocked: `${contract.name} needs ${contract.slots} pack slots. Drop something first.` };
  const items: Item[] = [];
  let used = packUsed(h.pack);
  const goldRoom = h.pack.some((p) => p.kind === 'gold' && p.amount < 100);
  for (const i of ordered) {
    if (i.slots <= PACK_SLOTS - used) {
      items.push(i);
      used += i.kind === 'gold' && goldRoom ? 0 : i.slots;
    } else if (i.kind === 'gold' && goldRoom) items.push(i);
  }
  if (!items.length) return { items: [], blocked: 'Pack is full. Drop something first.' };
  return { items };
}

function itemOf(h: HeroInDelve, kind: Item['kind']): Item | undefined {
  return h.pack.find((i) => i.kind === kind);
}

function parsePos(k: string): Pos {
  const [lv, rest] = k.split(':');
  const [q, r] = (rest ?? '').split(',').map(Number) as [number, number];
  return { level: Number(lv), q, r };
}

/** Pit hexes next to `at` that something could fall down. */
function droppablePits(c: Ctx, at: Pos, self: string): Pos[] {
  return pitsNextTo(c.w, c.d, at).filter((p) => !!fallInfo(c, p, self));
}

/** Rope anchors a hero at `at` can climb up to (they stand on or next to the rope's foot). */
function ropesUpFrom(c: Ctx, at: Pos): Pos[] {
  const out: Pos[] = [];
  for (const k of c.d.ropes) {
    const top = parsePos(k);
    if (occupant(c, top)) continue;
    const foot = pitsNextTo(c.w, c.d, top).map((p) => fallColumn(c.w, c.d, p)?.to).filter((x): x is Pos => !!x);
    if (foot.some((f) => within(f, at, 1))) out.push(top);
  }
  return out;
}

function nextToWinch(c: Ctx, at: Pos): Pos | undefined {
  return c.w.winches.find((wp) => adjacent(wp, at));
}


/** Locked doors and chests on or next to the hero that a pick could still work (not jammed). */
function pickableAround(c: Ctx, h: HeroInDelve): ActionTarget[] {
  return aroundAndSelf(h.at).filter((p) => { const l = lockedThingAt(c, p); return l && !l.jammed && !l.barred; }).map((at) => ({ at }));
}

/** V4.0 (spec 25.2): a barred gate still shut at `p`. */
function barredAt(c: Ctx, p: Pos): boolean {
  return !!lockedThingAt(c, p)?.barred;
}

/** Spec 21.4: the reason a hero with no pick at all can't Pick. */
export const NO_PICK = 'Locked · Smash it, or pick it with lockpicks';
/** Spec 21.4: a Burglar whose improvised pick is spent. */
export const PICK_SPENT = 'Your improvised pick is spent. Smash it, or buy lockpicks from Gerda.';

/**
 * Spec 21.4: what this hero picks with: the smith's lockpicks first (3 slots for a Burglar, 2 for
 * anyone else, never used up), else the improvised pick (2 slots, used up); null with neither.
 */
export function pickTool(c: Ctx, h: HeroInDelve): { item: Item; slots: number; proper: boolean } | null {
  const proper = itemOf(h, 'lockpicks');
  if (proper) return { item: proper, slots: heroDef(c, h.heroId)?.cls === 'burglar' ? BURGLAR_PICK_SLOTS : LOCKPICK_SLOTS, proper: true };
  const imp = itemOf(h, 'improvised');
  return imp ? { item: imp, slots: LOCKPICK_SLOTS, proper: false } : null;
}

/** Every valid target for an action right now (ignores move/act flags). */
export function targetsFor(c: Ctx, h: HeroInDelve, action: ActionKind): ActionTarget[] {
  const def = heroDef(c, h.heroId)!;
  const cls = def.cls;
  const others = c.d.heroes.filter((x) => x !== h);
  const mage = (school: HeroClass, mana: number) => cls === school && h.mana >= mana;
  switch (action) {
    case 'attack':
      if (cls === 'ranger') return enemiesInSight(c, h, CLASSES.ranger.weapon.range ?? 6);
      return enemiesAdjacent(c, h);
    case 'shove':
      return enemiesAdjacent(c, h, true);
    // ---- V3.2 class abilities
    case 'overwatch':
      return cls === 'ranger' && !h.overwatch ? [{ id: h.heroId }] : [];
    case 'knockback':
      if (cls !== 'ranger') return [];
      return enemiesInSight(c, h, KNOCKBACK_RANGE).filter((t) => c.d.monsters.find((m) => m.id === t.id)?.kind !== 'dragon');
    // ---- V3.7 (spec 20.3): fused charges
    case 'throwCharge': {
      if (cls !== 'sapper' || !chargeCount(h)) return [];
      return hexesInSight(c, h, THROW_CHARGE_RANGE, (p) => !samePos(p, h.at) && chargeSpot(c, p));
    }
    case 'setCharge': {
      if (cls !== 'sapper' || !chargeCount(h)) return [];
      const out: ActionTarget[] = [];
      for (const p of posNeighbors(h.at)) {
        if (!chargeSpot(c, p)) continue;
        for (const fuse of [1, 2] as const) out.push({ at: p, fuse });
      }
      return out;
    }
    case 'dig':
      if (cls !== 'sapper' && h.ale !== 'mole') return [];
      return posNeighbors(h.at).filter((p) => { const k = kindAt(c.w, c.d, p); return k === 'rubble' || k === 'cracked'; }).map((at) => ({ at }));
    case 'unbar': {
      // V4.0 (spec 25.2): the sally port key in the barred gate next to you.
      const it = h.pack.find(isGateKey);
      if (!it) return [];
      return posNeighbors(h.at).filter((p) => barredAt(c, p)).map((at) => ({ at, itemId: it.id }));
    }
    case 'fireball':
      if (!mage('pyromancer', 2)) return [];
      return hexesInSight(c, h, FIREBALL_RANGE, (p) => isFloorish(c.w, c.d, p) || kindAt(c.w, c.d, p) === 'pit');
    case 'veil':
      if (!mage('shadowmancer', 1)) return [];
      return alliesWithin(c, h, SPELL_RANGE).filter((t) => (hd(c, t.id!)?.veil ?? 0) === 0);
    case 'sleep':
      if (!mage('shadowmancer', 1)) return [];
      return enemiesInSight(c, h, SLEEP_RANGE, { noDragon: true, monstersOnly: true }).filter((t) => c.d.monsters.find((m) => m.id === t.id)?.awareness !== 'asleep');
    case 'dread':
      // V3.7 (spec 20.2): a monster or crew member in sight within 5; not the Dragon (nor the Gloam).
      if (!mage('shadowmancer', DREAD_MANA)) return [];
      return enemiesInSight(c, h, DREAD_RANGE, { noDragon: true });
    case 'blink':
      if (!mage('shadowmancer', 1)) return [];
      return hexesInSight(c, h, BLINK_RANGE, (p) => !samePos(p, h.at) && standable(c.w, c.d, p) && !occupant(c, p));
    case 'ward':
      if (!mage('hedgewitch', 1)) return [];
      return alliesWithin(c, h, SPELL_RANGE).filter((t) => (hd(c, t.id!)?.ward ?? 0) === 0);
    case 'gust':
      if (!mage('hedgewitch', 1)) return [];
      return hexesInSight(c, h, GUST_RANGE, (p) => isFloorish(c.w, c.d, p) || kindAt(c.w, c.d, p) === 'pit');
    // ---- V3.2 items
    case 'smoke':
    case 'glue':
    case 'firecracker': {
      const it = itemOf(h, action);
      if (!it) return [];
      return hexesInSight(c, h, THROW_RANGE[action], (p) => isFloorish(c.w, c.d, p) || kindAt(c.w, c.d, p) === 'pit').map((t) => ({ ...t, itemId: it.id }));
    }
    case 'dart': {
      const it = itemOf(h, 'dart');
      if (!it) return [];
      return enemiesInSight(c, h, THROW_RANGE.dart, { noDragon: true, monstersOnly: true })
        .filter((t) => c.d.monsters.find((m) => m.id === t.id)?.awareness !== 'asleep')
        .map((t) => ({ ...t, itemId: it.id }));
    }
    case 'caltrops': {
      const it = itemOf(h, 'caltrops');
      if (!it) return [];
      return posNeighbors(h.at)
        .filter((p) => standable(c.w, c.d, p) && !occupant(c, p) && !c.d.caltrops.includes(posKey(p)) && !c.d.traps[posKey(p)])
        .map((at) => ({ at, itemId: it.id }));
    }
    case 'key': {
      const it = itemOf(h, 'key');
      if (!it) return [];
      return aroundAndSelf(h.at).filter((p) => { const l = lockedThingAt(c, p); return l && !l.jammed && !l.barred; }).map((at) => ({ at, itemId: it.id }));
    }
    case 'oil': {
      const it = itemOf(h, 'oil');
      return it && c.d.light < LIGHT_MAX ? [{ id: h.heroId, itemId: it.id }] : [];
    }
    case 'grapple': {
      const it = itemOf(h, 'hook');
      if (!it) return [];
      const g = grappleTop(c, h.at, h.heroId);
      if (!g) return [];
      return [{ at: g.to ?? g.pit, itemId: it.id }];
    }
    case 'winch':
      if (c.d.liftWorking) return [];
      { const wp = nextToWinch(c, h.at); return wp ? [{ at: wp }] : []; }
    case 'firebolt':
      if (!mage('pyromancer', 1)) return [];
      return enemiesInSight(c, h, 5);
    case 'pick':
      // Spec 21.4: no pick, no Pick (the Burglar included).
      if (!pickTool(c, h)) return [];
      return pickableAround(c, h);
    case 'smash':
      return aroundAndSelf(h.at).filter((p) => { const l = lockedThingAt(c, p); return l && !l.barred; }).map((at) => ({ at }));
    case 'open': {
      const out: ActionTarget[] = [];
      for (const p of posNeighbors(h.at)) {
        if (kindAt(c.w, c.d, p) !== 'door') continue;
        const door = doorAt(c.d, p);
        if (!door || door.locked || c.d.blown.includes(posKey(p))) continue;
        // V4.0 (spec 25.2): the sally port gate, once open, stays open.
        if (c.w.tile(p)?.barred) continue;
        if (door.open && occupant(c, p)) continue;
        out.push({ at: p });
      }
      if (!h.acted || cls === 'burglar') {
        for (const ch of c.d.chests) if (!ch.opened && !ch.locked && within(ch.at, h.at, 1)) out.push({ at: ch.at, id: ch.id });
      }
      return out;
    }
    case 'take':
      // Every pile in reach; a pile nothing can be taken from is a blocked target (spec 15.7).
      return c.d.ground.filter((g) => within(g.at, h.at, 1) && g.items.length).map((g) => ({ at: g.at }));
    case 'drop':
      return h.pack.filter((i) => !isKit(i)).map((i) => ({ itemId: i.id }));
    case 'give': {
      const out: ActionTarget[] = [];
      for (const o of others) {
        if (o.status !== 'active' || !adjacent(o.at, h.at)) continue;
        const room = PACK_SLOTS - packUsed(o.pack);
        for (const i of h.pack) if (!isKit(i) && (i.slots <= room || i.kind === 'gold')) out.push({ id: o.heroId, itemId: i.id });
      }
      return out;
    }
    case 'disarm':
      return aroundAndSelf(h.at).filter((p) => c.d.traps[posKey(p)]?.spotted).map((at) => ({ at }));
    case 'light':
      return posNeighbors(h.at).filter((p) => kindAt(c.w, c.d, p) === 'brazier' && !c.d.lit.includes(posKey(p))).map((at) => ({ at }));
    case 'torch': {
      const t = h.pack.find((i) => i.kind === 'torch');
      return t ? [{ itemId: t.id }] : [];
    }
    case 'nightsight': {
      const it = itemOf(h, 'nightsight');
      return it ? [{ id: h.heroId, itemId: it.id }] : [];
    }
    case 'potion': {
      const pot = h.pack.find((i) => i.kind === 'potion');
      if (!pot) return [];
      const out: ActionTarget[] = [];
      if (h.hp < def.maxHp) out.push({ id: h.heroId, itemId: pot.id });
      for (const o of others) {
        if (!adjacent(o.at, h.at)) continue;
        const od = heroDef(c, o.heroId)!;
        if (o.status === 'downed' || (o.status === 'active' && o.hp < od.maxHp)) out.push({ id: o.heroId, itemId: pot.id });
      }
      return out;
    }
    case 'revive':
      return others.filter((o) => o.status === 'downed' && adjacent(o.at, h.at)).map((o) => ({ id: o.heroId, at: o.at }));
    case 'charge': {
      // V3.7 (spec 20.3): a bought charge, set with fuse 1 on an adjacent locked thing or wall. Sappers use setCharge.
      if (cls === 'sapper') return [];
      const ch = h.pack.find((i) => i.kind === 'charge');
      if (!ch) return [];
      return posNeighbors(h.at)
        .filter((p) => (lockedThingAt(c, p) || blastableWall(c.w, c.d, p)) && chargeSpot(c, p))
        .map((at) => ({ at, itemId: ch.id, fuse: 1 as const }));
    }
    case 'rope': {
      const r = h.pack.find((i) => i.kind === 'rope');
      if (!r || !droppablePits(c, h.at, h.heroId).length || c.d.ropes.includes(posKey(h.at))) return [];
      return [{ at: h.at, itemId: r.id }];
    }
    case 'climb': {
      const out: ActionTarget[] = [];
      const seen = new Set<string>();
      if (c.d.ropes.includes(posKey(h.at))) {
        for (const p of droppablePits(c, h.at, h.heroId)) {
          const f = fallInfo(c, p, h.heroId)!;
          if (seen.has(posKey(f.to))) continue;
          seen.add(posKey(f.to));
          out.push({ at: f.to });
        }
      }
      for (const top of ropesUpFrom(c, h.at)) out.push({ at: top });
      return out;
    }
    case 'jump':
      return droppablePits(c, h.at, h.heroId).map((at) => ({ at }));
    case 'free': {
      const pr = c.d.prisoner;
      if (!pr || pr.dead || pr.out || !adjacent(pr.at, h.at)) return [];
      if (pr.freed && pr.escortedBy === h.heroId) return [];
      return [{ id: pr.id, at: pr.at }];
    }
    case 'bribe':
      return []; // V3.5: replaced by the parley deals (spec 18.6)
    case 'parley':
      return parleyTargets(c, h.heroId);
    case 'rally':
      return cls === 'heir' && h.rallyCooldown === 0 ? [{ id: h.heroId }] : [];
    case 'guard':
      if (cls !== 'sellsword') return [];
      return others.filter((o) => o.status === 'active' && adjacent(o.at, h.at)).map((o) => ({ id: o.heroId }));
    case 'kindle':
      return mage('pyromancer', 1) && c.d.light < LIGHT_MAX ? [{ id: h.heroId }] : [];
    case 'mend': {
      if (!mage('hedgewitch', 1)) return [];
      return c.d.heroes
        .filter((o) => o.status === 'active' && within(o.at, h.at, 3) && o.hp < heroDef(c, o.heroId)!.maxHp)
        .map((o) => ({ id: o.heroId }));
    }
    case 'passLantern':
      if (c.d.lanternBearer !== h.heroId) return [];
      return others.filter((o) => o.status === 'active' && adjacent(o.at, h.at)).map((o) => ({ id: o.heroId }));
    case 'shutter':
      return c.d.lanternBearer === h.heroId ? [{ id: h.heroId }] : [];
    case 'escape':
      return h.grabbedBy && onMap(c).some((m) => m.id === h.grabbedBy) ? [{ id: h.grabbedBy }] : [];
    case 'leave':
      return canLeaveAt(c, h.at) ? [{ at: h.at }] : [];
    // ---- V3.7 (spec 20.5) kit
    case 'brace':
      return (cls === 'heir' || cls === 'sellsword' || cls === 'sapper') && !h.braced ? [{ id: h.heroId }] : [];
    case 'hamstring':
      if (!CLASSES[cls].weapon.range) return [];
      return enemiesInSight(c, h, HAMSTRING_RANGE, { noDragon: true }).filter((t) => c.d.monsters.find((m) => m.id === t.id)?.awareness !== 'asleep');
    case 'nightthorn':
      if (!mage('shadowmancer', NIGHTTHORN_MANA)) return [];
      return enemiesInSight(c, h, NIGHTTHORN_RANGE);
    case 'briar':
      if (!mage('hedgewitch', BRIAR_MANA)) return [];
      return enemiesInSight(c, h, BRIAR_RANGE, { noDragon: true });
    case 'smashProp':
      return posNeighbors(h.at).filter((p) => smashable(c, p)).map((at) => ({ at }));
  }
  return [];
}

/** An exit hex whose way is open (V4.0, spec 25: never one behind a shut gate or rubble). */
export function canLeaveAt(c: Ctx, at: Pos): boolean {
  if (kindAt(c.w, c.d, at) !== 'exit') return false;
  const way = wayAtEntrance(c.w.castle, at);
  return !way || wayOpen(c.s, way.id);
}

/** V3.7 (spec 20.5): a crate or barrel still standing at `p`. */
export function smashable(c: Ctx, p: Pos): boolean {
  const t = c.w.tile(p);
  return !!t && t.kind === 'prop' && (t.prop === 'crate' || t.prop === 'barrel') && kindAt(c.w, c.d, p) === 'prop';
}

const LABELS: Record<ActionKind, string> = {
  attack: 'Attack', pick: 'Pick lock', smash: 'Smash', open: 'Open', take: 'Take', drop: 'Drop', give: 'Give',
  disarm: 'Disarm', light: 'Light brazier', torch: 'Light torch', potion: 'Potion', revive: 'Revive',
  charge: 'Place charge', rope: 'Anchor rope', climb: 'Climb', jump: 'Jump down', shove: 'Shove', free: 'Free',
  bribe: 'Bribe', parley: 'Parley', rally: 'Rally', guard: 'Guard', firebolt: 'Firebolt', kindle: 'Kindle', mend: 'Mend',
  passLantern: 'Pass lantern', winch: 'Work the winch', leave: 'Leave castle', shutter: 'Shutter lantern', escape: 'Break free',
  overwatch: 'Overwatch', knockback: 'Knockback shot', throwCharge: 'Throw charge', setCharge: 'Set charge', dig: 'Dig', fireball: 'Fireball',
  veil: 'Veil', sleep: 'Sleep', blink: 'Blink', ward: 'Ward', gust: 'Gust', dread: 'Dread',
  smoke: 'Smoke bomb', glue: 'Glue bomb', dart: 'Sleep dart', caltrops: 'Caltrops', firecracker: 'Firecracker',
  key: 'Skeleton key', oil: 'Oil flask', grapple: 'Grapple up', nightsight: 'Night-eye draught', unbar: 'Unbar the gate',
  brace: 'Brace', hamstring: 'Hamstring', nightthorn: 'Night thorn', briar: 'Briar', smashProp: 'Smash',
};

const ROLLS: ActionKind[] = ['attack', 'pick', 'smash', 'disarm', 'shove', 'firebolt', 'knockback', 'fireball', 'sleep', 'dart', 'escape', 'dread', 'hamstring', 'nightthorn', 'briar'];
const ORDER: ActionKind[] = [
  'escape', 'shutter', 'attack', 'knockback', 'hamstring', 'overwatch', 'brace', 'firebolt', 'fireball', 'sleep', 'dread', 'nightthorn', 'briar', 'gust', 'shove', 'pick', 'smash', 'smashProp', 'key', 'unbar', 'open', 'take', 'free', 'revive', 'potion', 'mend',
  'ward', 'veil', 'blink', 'kindle', 'oil', 'rally', 'guard', 'light', 'torch', 'nightsight', 'disarm', 'charge', 'setCharge', 'throwCharge', 'dig', 'smoke', 'glue', 'dart',
  'caltrops', 'firecracker', 'winch', 'rope', 'climb', 'grapple', 'jump', 'parley', 'passLantern', 'give', 'drop', 'leave',
];

/** How the UI targets each action (ActionOption.pick). */
const PICK: Record<ActionKind, ActionOption['pick']> = {
  attack: 'enemy', pick: 'other', smash: 'other', open: 'other', take: 'hex', drop: 'item', give: 'other', disarm: 'hex',
  light: 'hex', torch: 'self', potion: 'ally', revive: 'ally', charge: 'hex', rope: 'self', climb: 'hex', jump: 'hex',
  shove: 'enemy', free: 'other', bribe: 'enemy', parley: 'enemy', rally: 'self', guard: 'ally', firebolt: 'enemy', kindle: 'self', mend: 'ally',
  passLantern: 'ally', winch: 'self', leave: 'self', shutter: 'self', escape: 'enemy',
  overwatch: 'self', knockback: 'enemy', throwCharge: 'hex', setCharge: 'hex', dig: 'hex', fireball: 'hex', veil: 'ally', sleep: 'enemy',
  blink: 'hex', ward: 'ally', gust: 'hex', dread: 'enemy', smoke: 'hex', glue: 'hex', dart: 'enemy', caltrops: 'hex', firecracker: 'hex',
  key: 'hex', unbar: 'hex', oil: 'self', grapple: 'self', nightsight: 'self',
  brace: 'self', hamstring: 'enemy', nightthorn: 'enemy', briar: 'enemy', smashProp: 'hex',
};
const AREA: Partial<Record<ActionKind, number>> = { fireball: 1, gust: 1, smoke: 1, glue: 1, charge: 2, throwCharge: 2, setCharge: 2 };
const MANA_COST: Partial<Record<ActionKind, number>> = { firebolt: 1, kindle: 1, mend: 1, fireball: 2, veil: 1, sleep: 1, blink: 1, ward: 1, gust: 1, dread: DREAD_MANA, nightthorn: NIGHTTHORN_MANA, briar: BRIAR_MANA };
/** Attacks break a Veil (spec 15.3). */
const VEIL_BREAKERS: ActionKind[] = ['attack', 'knockback', 'firebolt', 'fireball', 'shove', 'gust', 'smash', 'hamstring', 'nightthorn', 'briar', 'smashProp'];
/** Whole-turn actions: need both move and action. */
const WHOLE_TURN: ActionKind[] = ['climb', 'jump', 'grapple'];

function canDo(h: HeroInDelve, action: ActionKind): boolean {
  if ((h as HeroX).dozing) return false;
  if (WHOLE_TURN.includes(action)) return !h.moved && !h.acted && !((h.rooted ?? 0) > 0);
  if (FREE.includes(action)) return true;
  return !h.acted;
}

export function actions(c: Ctx, heroId: string): ActionOption[] {
  const h = hd(c, heroId);
  if (!h || h.status !== 'active' || c.d.phase !== 'player' || c.s.stage !== 'delve') return [];
  const out: ActionOption[] = [];
  const def = heroDef(c, heroId);
  for (const a of ORDER) {
    if (!canDo(h, a)) continue;
    const t = targetsFor(c, h, a);
    if (!t.length) {
      // Spec 21.4: a locked thing in reach, and no pick to work it: the option says what would.
      if (a === 'pick' && !pickTool(c, h)) {
        const locked = pickableAround(c, h);
        if (locked.length) out.push({ action: a, label: LABELS[a], targets: locked, rolls: true, pick: PICK[a], blocked: def?.cls === 'burglar' ? PICK_SPENT : NO_PICK });
      }
      continue;
    }
    const opt: ActionOption = { action: a, label: LABELS[a], targets: t, rolls: ROLLS.includes(a), pick: PICK[a] };
    if (a === 'shutter' && !c.d.lanternOpen) opt.label = 'Open lantern';
    if (AREA[a]) opt.area = AREA[a];
    if (MANA_COST[a]) opt.mana = MANA_COST[a];
    // Blocked options (spec 15.7): listed, with the reason, when none of the targets can be done now.
    if (a === 'take') {
      const plans = t.map((x) => takePlan(c, h, x.at!));
      if (plans.every((p) => p.blocked)) opt.blocked = plans[0]!.blocked;
    } else if (a === 'grapple') {
      const g = grappleTop(c, h.at, h.heroId);
      if (g && !g.to) opt.blocked = 'No room at the top of the pit.';
    }
    out.push(opt);
  }
  return out;
}

function sameTarget(a: ActionTarget, b: ActionTarget): boolean {
  if (a.id !== undefined && b.id !== undefined && a.id !== b.id) return false;
  if (a.fuse !== undefined && b.fuse !== undefined && a.fuse !== b.fuse) return false;
  if (a.itemId !== undefined && b.itemId !== undefined && a.itemId !== b.itemId) return false;
  if (a.at && b.at && !samePos(a.at, b.at)) return false;
  return a.id !== undefined || a.itemId !== undefined || !!a.at || (b.id === undefined && b.itemId === undefined && !b.at);
}

export function findTarget(c: Ctx, h: HeroInDelve, action: ActionKind, t: ActionTarget): ActionTarget | undefined {
  const list = targetsFor(c, h, action);
  // Untargeted self actions accept an empty target.
  if (!t.id && !t.at && !t.itemId && list.length === 1) return list[0];
  return list.find((x) => sameTarget(t, x));
}

// ---------------------------------------------------------------- roll specs

export interface Spec {
  ok: boolean;
  reason?: string;
  stat?: Stat;
  slots: number;
  chance: number;
  modifiers: string[];
  outcomes: string[];
  noise: number;
  light: number;
  /** Damage per hit (attacks). */
  dmg?: number;
  warning?: string;
  confirm?: boolean;
  hexes?: Pos[];
  affects?: string[];
}

/** Figures (ids) standing on any of `hexes`. */
function figuresOn(c: Ctx, hexes: Pos[]): string[] {
  const out: string[] = [];
  for (const p of hexes) {
    const o = occupant(c, p);
    if (o) out.push(o.id);
  }
  return out;
}

function areaOf(c: Ctx, at: Pos, radius: number): Pos[] {
  return range(at, radius).map((x) => ({ level: at.level, ...x })).filter((p) => !!c.w.tile(p));
}

/**
 * V3.9 (spec 24.3, 27): can this hero backstab `id` now? A Burglar with a melee weapon, adjacent, outside the
 * target's front (a monster's sides or straight behind it; straight behind a crew member), the target unaware
 * of them; monsters and crew members, not the Dragon or the Gloam.
 */
export function canBackstab(c: Ctx, h: HeroInDelve, id: string, unnoticed = unnoticedBy(c, id, h.heroId)): boolean {
  const def = heroDef(c, h.heroId);
  if (!def || def.cls !== 'burglar' || CLASSES[def.cls].weapon.range || !unnoticed) return false;
  const m = c.d.monsters.find((x) => x.id === id);
  const f = m ?? rivalsOnMap(c).find((x) => x.id === id);
  if (!f || (m && (m.kind === 'dragon' || m.kind === 'gloam'))) return false;
  return adjacent(h.at, f.at) && inRearHalf(f, h.at);
}

function foe(c: Ctx, id?: string) {
  if (!id) return undefined;
  const m = c.d.monsters.find((x) => x.id === id);
  if (m) return { at: m.at, asleep: m.awareness === 'asleep', hunting: m.awareness === 'hunting', monster: m };
  const r = rivalsOnMap(c).find((x) => x.id === id);
  if (r) return { at: r.at, asleep: false, hunting: c.d.rivals?.stance === 'hostile', monster: undefined, rival: r };
  return undefined;
}

/**
 * V3.7 (spec 20.1): has this enemy noticed the hero? A monster by its `noticedIds` (asleep never has);
 * a crew member when the crew is hostile or demanding (they're all watching the party by then).
 */
export function unnoticedBy(c: Ctx, id: string, heroId: string): boolean {
  const m = c.d.monsters.find((x) => x.id === id);
  if (m) return m.awareness === 'asleep' || !hasNoticed(m, heroId);
  const st = c.d.rivals?.stance;
  return st !== 'hostile' && st !== 'demanding';
}

function sign(n: number): string {
  return n >= 0 ? `+${n}%` : `−${-n}%`;
}

/** A monster's armor against this hit, with the plain-words modifiers (armor, the captain's shield wall). */
/** V3.7 (spec 20.4): a crew member's armor (class plus tier) and the Hedgewitch's ward, as modifiers. */
function rivalArmorMods(r: RivalX, mods: string[]): { armor: number; ward: number } {
  const armor = rivalStats(r).armor;
  if (armor) mods.push(`Armor −${armor}`);
  const ward = (r.ward ?? 0) > 0 ? 1 : 0;
  if (ward) mods.push('Warded −1');
  return { armor, ward };
}

function armorMods(c: Ctx, m: MonsterX, mods: string[]): number {
  const base = monsterArmor(c, m) - (shieldWalled(c, m) ? 1 : 0);
  if (base) mods.push(`Armor −${base} dmg per hit`);
  if (shieldWalled(c, m)) mods.push('Shield wall −1 dmg per hit');
  return monsterArmor(c, m);
}

/** V3.7 (spec 20.3): what a charge at `at` with this fuse will do, for the preview. */
function blastSpec(c: Ctx, h: HeroInDelve, at: Pos, fuse: number): Spec {
  const when = fuse === 1 ? 'at the end of this world phase' : `in ${fuse} world phases`;
  const text = `Fuse ${fuse}: blows ${when}. ${BLAST_INNER_DMG} dmg within 1 and thrown back, ${BLAST_OUTER_DMG} within 2. ${heroName(c, h.heroId)} takes 0, friends half`;
  const sp: Spec = { ok: true, slots: 0, chance: 0, modifiers: [], outcomes: [text], noise: BLAST_NOISE, light: 0 };
  sp.hexes = areaOf(c, at, 2);
  sp.affects = figuresOn(c, sp.hexes);
  const plan = blastPreview(c, at);
  const { broke, collapsed, rubbled } = plan;
  if (broke.length) sp.modifiers.push(broke.length === 1 ? 'Breaks the wall' : `Breaks ${broke.length} walls`);
  // Spec 20.3a: the floor next to the pit goes; the rest turns to rubble.
  if (collapsed.length) sp.modifiers.push(`Floor collapses into the pit: ${collapsed.length} hex${collapsed.length === 1 ? '' : 'es'}`);
  if (rubbled.length) sp.modifiers.push(`Rubble: ${rubbled.length} hex${rubbled.length === 1 ? '' : 'es'}`);
  const friends = c.d.heroes.filter((o) => o.heroId !== h.heroId && (o.status === 'active' || o.status === 'downed') && sp.affects!.includes(o.heroId));
  const dropped = c.d.heroes.filter((o) => (o.status === 'active' || o.status === 'downed') && collapsed.some((p) => samePos(p, o.at)));
  if (dropped.length) {
    const names = dropped.map((o) => heroName(c, o.heroId)).join(' and ');
    const drop = collapseDrop(c.w, c.d, dropped[0]!.at);
    sp.warning = `The floor under ${names} collapses: ${drop ? `falls ${drop.levels === 1 ? '1 level' : `${drop.levels} levels`} into ${c.w.levelName(drop.level)}, ${drop.damage} damage` : 'a long fall'} on top of the blast.`;
    sp.confirm = true;
  } else if (friends.length) sp.warning = `${friends.map((o) => heroName(c, o.heroId)).join(' and ')} ${friends.length === 1 ? 'stands' : 'stand'} in the blast.`;
  return sp;
}

export function spec(c: Ctx, heroId: string, action: ActionKind, target: ActionTarget): Spec {
  const no = (reason: string): Spec => ({ ok: false, reason, slots: 0, chance: 0, modifiers: [], outcomes: [], noise: 0, light: 0 });
  const h = hd(c, heroId);
  if (!h || c.s.stage !== 'delve') return no('Not in a delve.');
  if (h.status !== 'active') return no(`${heroName(c, heroId)} can't act.`);
  if (c.d.phase !== 'player') return no('Wait for your turn.');
  if ((h as HeroX).dozing) return no(`${heroName(c, heroId)} is out cold this turn.`);
  if (!canDo(h, action)) return no(action === 'climb' || action === 'jump' ? 'Needs both move and action.' : `${heroName(c, heroId)} has already acted.`);
  const t = findTarget(c, h, action, target);
  if (!t) return no('No valid target.');
  const def = heroDef(c, heroId)!;
  const cls = CLASSES[def.cls];
  const mods: string[] = [];
  const bright = brightnessAt(c.w, c, h.at);
  const night = nightEyed(h);
  const lightMod = night ? 0 : LIGHT_PENALTY[bright];
  const withLight = (p: number) => {
    if (lightMod) mods.push(`${bright[0]!.toUpperCase()}${bright.slice(1)} ${sign(lightMod)}`);
    else if (night && LIGHT_PENALTY[bright]) mods.push('Night-eye: no dark penalty');
    return p + lightMod;
  };
  const base = (stat: Stat, slots: number, p: number, outcomes: string[], noise: number, dmg?: number): Spec => ({
    ok: true, stat, slots, chance: Math.max(5, Math.min(95, Math.round(p))), modifiers: mods, outcomes, noise, light: 0, dmg,
  });
  const simple = (text: string, noise = 0, light = 0): Spec => ({ ok: true, slots: 0, chance: 0, modifiers: [], outcomes: [text], noise, light });
  const withMana = (sp: Spec, n: number): Spec => { sp.modifiers.push(`${n} mana`); return sp; };

  switch (action) {
    case 'attack': {
      const f = foe(c, t.id)!;
      let slots = cls.weapon.slots;
      let p = withLight(def.stats[cls.weapon.stat]);
      if (def.weaponTier) { p += 10 * def.weaponTier; mods.push(`Weapon ${sign(10 * def.weaponTier)}`); }
      if (f.asleep) { p += 20; mods.push('Asleep +20%'); }
      // V3.7 (spec 20.1): the first blow on an enemy that hasn't noticed you; the Burglar's backstab stacks.
      const unnoticed = unnoticedBy(c, t.id!, heroId);
      if (unnoticed) { slots += SNEAK_ATTACK_SLOTS; mods.push('Sneak attack +1 slot'); }
      // V3.9 (spec 24.3): the Burglar's backstab: melee from the target's rear half, unnoticed: +1 slot, double damage before armor.
      const stab = canBackstab(c, h, t.id!, unnoticed);
      if (stab) { slots += BACKSTAB_SLOTS; mods.push('Backstab: +1 slot, double damage'); }
      const ranged = !!cls.weapon.range;
      if (ranged && c.w.tile(h.at)?.raised) { p += 10; mods.push('Raised +10%'); }
      if (ranged && adjacent(h.at, f.at)) { slots -= 1; mods.push('Adjacent −1 slot'); }
      const across = { level: f.at.level, q: 2 * f.at.q - h.at.q, r: 2 * f.at.r - h.at.r };
      if (adjacent(h.at, f.at) && c.d.heroes.some((o) => o !== h && o.status === 'active' && samePos(o.at, across))) { slots += 1; mods.push('Flanked +1 slot'); }
      const rd = f.rival ? rivalArmorMods(f.rival, mods) : undefined;
      const armor = f.monster ? armorMods(c, f.monster, mods) : (rd?.armor ?? 0);
      const dmg = Math.max(0, Math.max(1, cls.weapon.dmg * (stab ? BACKSTAB_DMG_MULT : 1) - armor) - (rd?.ward ?? 0));
      const outcomes = [];
      for (let i = 0; i <= slots; i++) outcomes.push(i === 0 ? 'Miss' : `${i * dmg + (i === slots ? 1 : 0)} dmg`);
      return base(cls.weapon.stat, slots, p, outcomes, cls.weapon.noise ?? 2, dmg);
    }
    case 'knockback': {
      const f = foe(c, t.id)!;
      let p = withLight(def.stats.finesse);
      if (def.weaponTier) { p += 10 * def.weaponTier; mods.push(`Weapon ${sign(10 * def.weaponTier)}`); }
      if (f.asleep) { p += 20; mods.push('Asleep +20%'); }
      const o = pushOutcome(c, pusherFor(h.at, f.at), f.at, t.id);
      const sp = base('finesse', 2, p, ['Miss', 'Miss', pushText(o, 0)], cls.weapon.noise ?? 1);
      sp.hexes = [o.dest];
      if (o.kind === 'fall' && o.fall) sp.warning = `${f.monster?.name ?? 'It'} would fall ${o.fall.levels === 1 ? '1 level' : `${o.fall.levels} levels`} into ${o.fall.levelName}.`;
      return sp;
    }
    case 'overwatch':
      return simple('Shoot the first enemy that moves or acts in sight within 6', cls.weapon.noise ?? 1);
    case 'throwCharge':
      return blastSpec(c, h, t.at!, 1);
    case 'setCharge':
      return blastSpec(c, h, t.at!, t.fuse ?? 1);
    case 'dig':
      return simple(kindAt(c.w, c.d, t.at!) === 'rubble' || c.w.tile(t.at!)?.heap ? 'Clears the rubble' : 'Breaks through the cracked wall', DIG_NOISE);
    case 'fireball': {
      let p = withLight(def.stats.wits);
      if (c.w.tile(h.at)?.raised) { p += 10; mods.push('Raised +10%'); }
      const outcomes = [];
      for (let i = 0; i <= 3; i++) outcomes.push(i === 0 ? 'Fizzles' : `${i * 2 + (i === 3 ? 1 : 0)} dmg to everyone there`);
      const sp = withMana(base('wits', 3, p, outcomes, FIREBALL_NOISE, 2), 2);
      sp.hexes = areaOf(c, t.at!, 1);
      sp.affects = figuresOn(c, sp.hexes);
      const allies = sp.affects.filter((id) => hd(c, id));
      if (allies.length) sp.warning = `Burns ${allies.map((id) => heroName(c, id)).join(' and ')} too.`;
      return sp;
    }
    case 'veil':
      return withMana(simple(`${heroName(c, t.id!)} is unseen by monsters for ${VEIL_ROUNDS} rounds`), 1);
    case 'sleep': {
      const p = withLight(def.stats.wits);
      return withMana(base('wits', 2, p, ['No effect', 'Asleep', 'Asleep'], 0), 1);
    }
    case 'dread': {
      const f = foe(c, t.id)!;
      const p = withLight(def.stats.wits);
      const who = f.monster?.name ?? f.rival?.name ?? 'It';
      return withMana(base('wits', DREAD_SLOTS, p, ['No effect', `${who} flees for ${DREAD_ROUNDS} rounds`, `${who} flees for ${DREAD_ROUNDS} rounds`], 0), DREAD_MANA);
    }
    case 'blink':
      return withMana(simple(`Teleport to ${c.w.roomName(t.at!).toLowerCase()}. Silent`), 1);
    case 'ward':
      return withMana(simple(`${heroName(c, t.id!)} takes 1 less per hit for ${WARD_ROUNDS} rounds`), 1);
    case 'gust': {
      const sp = withMana(simple('Everyone within 1 is pushed 1 hex away', GUST_NOISE), 1);
      sp.hexes = areaOf(c, t.at!, 1);
      sp.affects = figuresOn(c, sp.hexes).filter((id) => !samePos(figurePos(c, id)!, t.at!));
      const falls = sp.affects.filter((id) => pushOutcome(c, t.at!, figurePos(c, id)!, id).kind === 'fall');
      if (falls.length) sp.warning = `${falls.map((id) => nameOfAny(c, id)).join(', ')} would go over the edge.`;
      return sp;
    }
    case 'smoke': {
      const sp = simple(`Smoke there for ${SMOKE_ROUNDS} rounds: blocks sight both ways`);
      sp.hexes = areaOf(c, t.at!, 1);
      return sp;
    }
    case 'glue': {
      const sp = simple(`Monsters within 1 are stuck for ${GLUE_ROUNDS} rounds`);
      sp.hexes = areaOf(c, t.at!, 1);
      sp.affects = figuresOn(c, sp.hexes).filter((id) => c.d.monsters.some((m) => m.id === id));
      return sp;
    }
    case 'dart': {
      const f = foe(c, t.id)!;
      let p = withLight(def.stats.finesse);
      if (f.asleep) { p += 20; mods.push('Asleep +20%'); }
      return base('finesse', 1, p, ['Miss', 'Asleep'], 0);
    }
    case 'caltrops':
      return simple('The first monster to step here takes 2 and stops');
    case 'firecracker':
      return simple(`Noise ${FIRECRACKER_NOISE} there`, FIRECRACKER_NOISE);
    case 'key':
      return simple(lockedThingAt(c, t.at!)?.chest ? 'Opens the chest, silently' : 'Opens the door, silently');
    case 'unbar':
      return simple('Opens the gate, silently. It stays open');
    case 'oil':
      return simple(`+${OIL_LIGHT} light`, 0, OIL_LIGHT);
    case 'grapple': {
      const g = grappleTop(c, h.at, heroId);
      if (!g || !g.to) return no('No room at the top of the pit.');
      return simple(`Climb up to ${c.w.levelName(g.to.level)}`);
    }
    case 'firebolt': {
      const f = foe(c, t.id)!;
      let p = withLight(def.stats.wits);
      if (c.w.tile(h.at)?.raised) { p += 10; mods.push('Raised +10%'); }
      if (f.asleep) { p += 20; mods.push('Asleep +20%'); }
      const rd = f.rival ? rivalArmorMods(f.rival, mods) : undefined;
      const armor = f.monster ? armorMods(c, f.monster, mods) : (rd?.armor ?? 0);
      const bd = Math.max(0, Math.max(1, 2 - armor) - (rd?.ward ?? 0));
      const outcomes = [];
      for (let i = 0; i <= 3; i++) outcomes.push(i === 0 ? 'Miss' : `${i * bd + (i === 3 ? 1 : 0)} dmg`);
      const s = base('wits', 3, p, outcomes, 3, bd);
      s.modifiers.push('1 mana');
      return s;
    }
    case 'pick': {
      // Spec 21.4: proper lockpicks (Burglar 3 slots, others 2) or the improvised pick (2, used up).
      const tool = pickTool(c, h);
      const slots = tool?.slots ?? LOCKPICK_SLOTS;
      mods.push(tool && !tool.proper ? `Improvised pick: ${slots} slots, used up` : `Lockpicks: ${slots} slots`);
      const outcomes = slots >= 3 ? ['Lock jams', 'Fails', 'Opens, noise 2', 'Opens silently'] : ['Lock jams', 'Opens, noise 2', 'Opens silently'];
      return base('finesse', slots, withLight(def.stats.finesse), outcomes, 2);
    }
    case 'smash': {
      const l = lockedThingAt(c, t.at!)!;
      const outcomes = l.chest ? ['Holds, noise 4', 'Opens, noise 4', 'Opens, noise 4'] : ['Holds, noise 4', 'Holds, noise 4', 'Opens, noise 4'];
      return base('might', 2, withLight(def.stats.might), outcomes, 4);
    }
    case 'disarm':
      return base('finesse', 2, withLight(def.stats.finesse), ['Sets it off: 3 dmg', 'Disarmed', 'Disarmed'], 2);
    case 'shove': {
      const f = foe(c, t.id)!;
      const o = pushOutcome(c, h.at, f.at, t.id);
      const slots = def.cls === 'sellsword' ? 3 : 2;
      if (slots === 3) mods.push('Sellsword +1 slot');
      const outcomes: string[] = [];
      for (let i = 0; i <= slots; i++) outcomes.push(i < 2 ? 'Nothing' : pushText(o, i === slots ? 1 : 0));
      const sp = base('might', slots, withLight(def.stats.might), outcomes, 2);
      sp.hexes = [o.dest];
      if (o.kind === 'fall' && o.fall) sp.warning = `${f.monster?.name ?? 'It'} would fall ${o.fall.levels === 1 ? '1 level' : `${o.fall.levels} levels`} into ${o.fall.levelName}.`;
      return sp;
    }
    case 'open':
      if (t.id) return simple('Opens the chest');
      return simple(doorAt(c.d, t.at!)?.open ? 'Closes the door' : 'Opens the door');
    case 'take': {
      const plan = takePlan(c, h, t.at!);
      if (plan.blocked) return no(plan.blocked);
      return simple(`Takes ${plan.items.map((i) => i.name).join(', ')}`);
    }
    case 'drop': return simple('Drop it here');
    case 'give': return simple(`Hand to ${heroName(c, t.id!)}`);
    case 'light': return simple(`+${BRAZIER_LIGHT} light, lit for good`, 0, BRAZIER_LIGHT);
    case 'torch': return simple(`Torchlight for ${TORCH_ROUNDS} rounds`);
    case 'nightsight': return simple(`Night-eye for ${NIGHTSIGHT_ROUNDS} rounds: full sight, no dark penalty. Silent. The dark still hunts`);
    case 'potion': {
      const o = hd(c, t.id!)!;
      return simple(o.status === 'downed' ? 'Back up with 5 HP' : 'Heal 5');
    }
    case 'revive': return simple('Back up with 3 HP');
    case 'charge': return blastSpec(c, h, t.at!, 1);
    case 'rope': return simple('Rope anchored here');
    case 'climb': return simple(t.at!.level < h.at.level ? 'Climb up the rope' : 'Climb down the rope, no damage');
    case 'jump': {
      const f = fallInfo(c, t.at!, heroId)!;
      const lv = f.levels === 1 ? '1 level' : `${f.levels} levels`;
      const soft = h.ale === 'featherfoot' && !h.aleSpent;
      const dmg = soft ? 0 : f.damage;
      const s = simple(`Falls ${lv}: ${dmg} dmg${soft ? ' (Featherfoot)' : ''}`);
      let warn = `Falls ${lv} into ${f.levelName}: ${dmg} damage${soft ? ' (Featherfoot: the first fall is free)' : ''}.`;
      if (h.hp <= dmg) warn += ` This will down ${def.name}.`;
      // V3.7 (spec 20.2): jumping away from an enemy's side provokes.
      const sw = swingersFor(c, heroId, h.at, t.at!);
      if (sw.length) warn += ` ${sw.map((x) => `${x.name} gets a free swing: ${hitRange(x.slots, x.dmg, armorOf(def)).join('–')}`).join('. ')}.`;
      s.warning = warn;
      if (f.levels > 1) s.confirm = true;
      return s;
    }
    case 'winch': return simple(`The lift runs for the rest of the delve. Noise ${WINCH_NOISE}`, WINCH_NOISE);
    case 'free': return simple(c.d.prisoner?.freed ? 'Take over the escort' : 'Free the prisoner');
    case 'bribe': return no('Parley instead.');
    case 'parley': return simple('Talk terms: pick a deal. Free.');
    case 'rally': return simple('+1 Focus to allies within 3');
    case 'guard': return simple(`Take hits meant for ${heroName(c, t.id!)}`);
    case 'kindle': return withMana(simple(`+${KINDLE_LIGHT} light`, 0, KINDLE_LIGHT), 1);
    case 'shutter': return simple(c.d.lanternOpen ? 'Shutter the lantern: no light, no burn. Free.' : 'Open the lantern: light again. Free.');
    case 'escape': {
      const m = c.d.monsters.find((x) => x.id === t.id)!;
      return base('might', 2, withLight(def.stats.might), ['Still held', `Free of ${m.name}`, `Free of ${m.name}`], 1);
    }
    case 'mend': return withMana(simple('Heal 4'), 1);
    case 'passLantern': return simple(`${heroName(c, t.id!)} carries the lantern`);
    case 'leave': return simple('Leave the castle');
    // ---- V3.7 (spec 20.5) kit
    case 'brace': {
      const sh = def.shield ? ` Shield: ranged hits ${SHIELD_BRACED_DMG} less.` : '';
      return simple(`Braced until your next turn: hits do 1 less, enemies roll −15% against you. Free swings at full slots.${sh}`);
    }
    case 'hamstring': {
      const f = foe(c, t.id)!;
      let p = withLight(def.stats.finesse) + HAMSTRING_PENALTY;
      mods.push(`Aimed low ${sign(HAMSTRING_PENALTY)}`);
      if (def.weaponTier) { p += 10 * def.weaponTier; mods.push(`Weapon ${sign(10 * def.weaponTier)}`); }
      const who = f.monster?.name ?? f.rival?.name ?? 'It';
      return base('finesse', HAMSTRING_SLOTS, p, ['Miss', `${who} rooted for ${HAMSTRING_ROUNDS} rounds`], HAMSTRING_NOISE);
    }
    case 'nightthorn': {
      const p = withLight(def.stats.wits);
      const outcomes = [];
      for (let i = 0; i <= NIGHTTHORN_SLOTS; i++) outcomes.push(i === 0 ? 'Miss' : `${i * NIGHTTHORN_DMG + (i === NIGHTTHORN_SLOTS ? 1 : 0)} dmg, armor ignored`);
      return withMana(base('wits', NIGHTTHORN_SLOTS, p, outcomes, 0, NIGHTTHORN_DMG), NIGHTTHORN_MANA);
    }
    case 'briar': {
      const f = foe(c, t.id)!;
      const p = withLight(def.stats.wits);
      const who = f.monster?.name ?? f.rival?.name ?? 'It';
      const outcomes = ['Miss', `${BRIAR_DMG} dmg, ${who} rooted ${BRIAR_ROOT} round`, `${2 * BRIAR_DMG + 1} dmg, ${who} rooted ${BRIAR_ROOT_PERFECT} rounds`];
      return withMana(base('wits', BRIAR_SLOTS, p, outcomes, BRIAR_NOISE, BRIAR_DMG), BRIAR_MANA);
    }
    case 'smashProp':
      return simple(`Smash the ${c.w.tile(t.at!)?.prop ?? 'crate'}: loud, may hold something`, SMASH_NOISE);
  }
  return no('Unknown action.');
}

// ---------------------------------------------------------------- doing it

function useItem(h: HeroInDelve, id?: string, kind?: Item['kind']): Item | undefined {
  const i = h.pack.findIndex((x) => (id ? x.id === id : x.kind === kind));
  if (i < 0) return undefined;
  return h.pack.splice(i, 1)[0];
}

function figurePos(c: Ctx, id: string): Pos | undefined {
  const m = c.d.monsters.find((x) => x.id === id);
  if (m) return m.at;
  const r = rivalsOnMap(c).find((x) => x.id === id);
  if (r) return r.at;
  if (c.d.prisoner?.id === id) return c.d.prisoner.at;
  return hd(c, id)?.at;
}

function nameOfAny(c: Ctx, id: string): string {
  return c.d.monsters.find((x) => x.id === id)?.name ?? rivalsOnMap(c).find((x) => x.id === id)?.name ?? (c.d.prisoner?.id === id ? c.d.prisoner.name : heroName(c, id));
}

/** A monster falls asleep (Sleep spell, sleep dart). */
export function putToSleep(c: Ctx, m: MonsterX): void {
  m.awareness = 'asleep';
  m.intent = undefined;
  m.focusAt = undefined;
  m.shoveFrom = undefined;
  forgetHeroes(m);
  c.ev.push({ type: 'awake', id: m.id, awareness: 'asleep' });
  say(c, `${m.name} slumps, asleep.`);
}

/** Set hexes burning (fireball). */
function ignite(c: Ctx, hexes: Pos[]): void {
  for (const p of hexes) if (isFloorish(c.w, c.d, p)) c.d.burning[posKey(p)] = BURN_ROUNDS;
}

/** Smoke in and around `at`: sight blocked, monsters inside lose track. */
export function smokeOut(c: Ctx, at: Pos): Pos[] {
  const hexes = areaOf(c, at, 1).filter((p) => isFloorish(c.w, c.d, p) || kindAt(c.w, c.d, p) === 'pit');
  for (const p of hexes) c.d.smoke[posKey(p)] = SMOKE_ROUNDS;
  for (const m of onMap(c)) {
    if (m.kind === 'gloam' || m.kind === 'dragon' || m.awareness !== 'hunting') continue;
    if (hexes.some((p) => samePos(p, m.at))) {
      m.awareness = 'alert';
      m.searchRounds = SEARCH_ROUNDS; // V4.0 (spec 27): it lost them: searching (?), not back at its post
      forgetHeroes(m);
      c.ev.push({ type: 'awake', id: m.id, awareness: 'alert' });
    }
  }
  return hexes;
}

function openDoor(c: Ctx, at: Pos): void {
  const door = doorAt(c.d, at)!;
  door.open = true;
  door.locked = false;
  door.jammed = false;
  c.ev.push({ type: 'doorChanged', at, open: true, locked: false });
}

function openChest(c: Ctx, chestId: string, by: string): void {
  const ch = c.d.chests.find((x) => x.id === chestId)!;
  ch.opened = true;
  ch.locked = false;
  const items = chestLoot(c, ch.tier);
  putOnGround(c, ch.at, items);
  c.ev.push({ type: 'chestOpened', id: ch.id, items });
  void by;
}

function unlockAt(c: Ctx, at: Pos, by: string): void {
  if (kindAt(c.w, c.d, at) === 'door') return openDoor(c, at);
  const ch = c.d.chests.find((x) => samePos(x.at, at) && !x.opened);
  if (ch) openChest(c, ch.id, by);
}

export function doAct(c: Ctx, heroId: string, action: ActionKind, target: ActionTarget, focus: number): string | undefined {
  const sp = spec(c, heroId, action, target);
  if (!sp.ok) return sp.reason;
  const h = hd(c, heroId)!;
  const t = findTarget(c, h, action, target)!;
  const def = heroDef(c, heroId)!;
  const name = def.name;
  if (focus < 0 || focus > Math.min(h.focus, sp.slots)) return 'Not that much Focus.';
  // V3.9 (spec 24.2): an action aimed at a hex or a figure turns the hero that way.
  const aim = t.at ?? (t.id ? figurePos(c, t.id) : undefined);
  if (FACING.turnOnAction && aim && aim.level === h.at.level && !samePos(aim, h.at)) {
    setFacing(c, h, dirIndex(h.at, aim));
    if (!c.visCache) refreshSight(c);
  }
  if (!FREE.includes(action)) h.acted = true;
  if (action === 'open' && t.id && def.cls !== 'burglar') h.acted = true;
  if (WHOLE_TURN.includes(action)) h.moved = true;
  if (MANA_COST[action]) h.mana -= MANA_COST[action]!;
  // Attacking or making a loud noise breaks a Veil (spec 15.3).
  if (h.veil > 0 && (VEIL_BREAKERS.includes(action) || sp.noise >= VEIL_BREAK_NOISE)) {
    h.veil = 0;
    say(c, `${name} steps out of the shadows.`);
  }
  const doRoll = () => {
    h.focus -= focus;
    return roll(c, heroId, LABELS[action], sp.slots, sp.chance, focus);
  };
  const throwEv = (kind: Item['kind'], to: Pos) => c.ev.push({ type: 'thrown', by: heroId, kind, from: { ...h.at }, to: { ...to } });

  switch (action) {
    case 'knockback': {
      const r = doRoll();
      const tid = t.id!;
      makeNoise(c, h.at, sp.noise);
      if (c.d.rivals?.members.some((x) => x.id === tid)) makeHostile(c);
      wakeTarget(c, tid, h.at, heroId);
      if (r.hits < 2) {
        c.ev.push({ type: 'miss', attacker: heroId, target: tid });
        break;
      }
      c.ev.push({ type: 'cast', by: heroId, spell: 'knockback', targetId: tid, at: figurePos(c, tid) });
      const from = pusherFor(h.at, figurePos(c, tid)!);
      push(c, tid, from, heroId);
      turnOnHit(c, tid, heroId); // V4.0 (spec 26.3)
      break;
    }
    case 'overwatch':
      h.overwatch = true;
      c.ev.push({ type: 'cast', by: heroId, spell: 'overwatch' });
      say(c, `${name} nocks an arrow and waits.`);
      break;
    case 'throwCharge':
      spendCharge(h);
      throwEv('charge', t.at!);
      setFuse(c, t.at!, 1, heroId);
      say(c, `${name} lobs a charge. Fuse 1. Stand clear.`);
      break;
    case 'setCharge': {
      spendCharge(h);
      const fuse = t.fuse ?? 1;
      setFuse(c, t.at!, fuse, heroId);
      say(c, `${name} sets a charge. Fuse ${fuse}. Stand clear.`);
      break;
    }
    case 'dig': {
      const k = kindAt(c.w, c.d, t.at!);
      const key = posKey(t.at!);
      // V3.7 (spec 20.3): blast rubble (a broken wall or blasted floor already in `blown`) is dug to floor.
      if (k === 'rubble' && c.w.tile(t.at!)?.kind !== 'rubble') (c.d.dug ??= []).push(key);
      else c.d.blown.push(key);
      c.ev.push({ type: 'dug', at: t.at! });
      say(c, k === 'rubble' || c.w.tile(t.at!)?.heap ? `${name} clears the rubble.` : `${name} breaks through the wall.`);
      makeNoise(c, t.at!, DIG_NOISE);
      checkWays(c); // V4.0 (spec 25.3): the east breach's rubble
      break;
    }
    case 'unbar': {
      // V4.0 (spec 25.2): the key stays in the lock; the gate is open for good.
      useItem(h, t.itemId);
      say(c, `${name} turns the sally port key and lifts the bar.`);
      openDoor(c, t.at!);
      c.w.fixedCache = null;
      checkWays(c);
      break;
    }
    case 'fireball': {
      const r = doRoll();
      const hexes = areaOf(c, t.at!, 1);
      c.ev.push({ type: 'cast', by: heroId, spell: 'fireball', at: t.at!, hexes });
      makeNoise(c, t.at!, FIREBALL_NOISE);
      ignite(c, hexes);
      say(c, `${name} hurls a fireball.`);
      if (!r.hits) break;
      for (const id of figuresOn(c, hexes)) {
        const m = c.d.monsters.find((x) => x.id === id);
        const armor = m ? monsterArmor(c, m) : hd(c, id) ? armorOf(heroDef(c, id)!) : 0;
        const dmg = r.hits * Math.max(1, 2 - armor) + (r.perfect ? 1 : 0);
        if (hd(c, id)) hurtHero(c, hd(c, id)!, dmg, heroId, r.perfect);
        else hurtAny(c, id, dmg, heroId, { crit: r.perfect });
      }
      break;
    }
    case 'veil': {
      const o = hd(c, t.id!)!;
      o.veil = VEIL_ROUNDS;
      c.ev.push({ type: 'cast', by: heroId, spell: 'veil', targetId: o.heroId });
      // Hunting monsters with no unveiled hero left in sight lose the trail.
      const lit = litSet(c.w, c.d);
      for (const m of onMap(c)) {
        if (m.awareness !== 'hunting' || m.kind === 'gloam' || m.kind === 'dragon') continue;
        const seesSomeone = c.d.heroes.some((x) => x.status === 'active' && x.veil <= 0 && monsterSees(c.w, c.d, m.at, x.at, lit));
        if (seesSomeone) continue;
        m.awareness = 'alert';
        m.searchRounds = SEARCH_ROUNDS; // V4.0 (spec 27): it lost the trail: searching (?)
        m.focusAt = { ...o.at };
        m.intent = undefined;
        forgetHeroes(m);
        c.ev.push({ type: 'awake', id: m.id, awareness: 'alert' });
      }
      break;
    }
    case 'sleep': {
      const r = doRoll();
      const m = c.d.monsters.find((x) => x.id === t.id)!;
      c.ev.push({ type: 'cast', by: heroId, spell: 'sleep', targetId: m.id, at: m.at });
      if (r.hits) putToSleep(c, m);
      else c.ev.push({ type: 'miss', attacker: heroId, target: m.id });
      break;
    }
    case 'dread': {
      const r = doRoll();
      const tid = t.id!;
      c.ev.push({ type: 'cast', by: heroId, spell: 'dread', targetId: tid, at: figurePos(c, tid) });
      if (!r.hits) {
        c.ev.push({ type: 'miss', attacker: heroId, target: tid });
        say(c, `${nameOfAny(c, tid)} shrugs off the dread.`);
        break;
      }
      const m = c.d.monsters.find((x) => x.id === tid);
      const rv = rivalsOnMap(c).find((x) => x.id === tid);
      const who = m ?? rv;
      if (!who) break;
      who.feared = DREAD_ROUNDS;
      who.fearOf = heroId;
      if (m) {
        if (m.holding) releaseHold(c, m);
        if (m.awareness !== 'hunting') goHunting(c, m, h.at);
        noticeHero(c, m, heroId);
        const f = fleePlan(c, m, (m.stuck ?? 0) > 0 ? 0 : monsterStats(m).move);
        m.intent = { kind: 'flee', to: f.to };
      } else if (rv) {
        if (c.d.rivals) makeHostile(c);
        dropCaptive(c, rv, 'is seized by dread'); // spec 20.4: fear frees the dragged hero
        rv.intent = { kind: 'flee', to: fleePlan(c, rv, rivalStats(rv).move).to };
      }
      c.ev.push({ type: 'feared', id: tid, by: heroId });
      say(c, `${nameOfAny(c, tid)} is seized by dread and turns to run.`);
      break;
    }
    case 'blink': {
      const from = { ...h.at };
      h.at = { ...t.at! };
      c.ev.push({ type: 'blinked', id: heroId, from, to: { ...h.at } });
      if (h.escorting && c.d.prisoner) c.d.prisoner.escortedBy = undefined;
      h.escorting = undefined;
      glimpse(c, h.at);
      ventCheck(c, h);
      afterHeroMove(c, h, true);
      break;
    }
    case 'ward': {
      const o = hd(c, t.id!)!;
      o.ward = WARD_ROUNDS;
      c.ev.push({ type: 'cast', by: heroId, spell: 'ward', targetId: o.heroId });
      break;
    }
    case 'gust': {
      const at = t.at!;
      const hexes = areaOf(c, at, 1);
      c.ev.push({ type: 'cast', by: heroId, spell: 'gust', at, hexes });
      makeNoise(c, at, GUST_NOISE);
      say(c, `${name} calls up a gust.`);
      const ids = figuresOn(c, hexes).filter((id) => !samePos(figurePos(c, id)!, at));
      for (const id of ids) {
        if (!figurePos(c, id)) continue;
        const isHero = !!hd(c, id);
        if (c.d.rivals?.members.some((x) => x.id === id)) makeHostile(c);
        if (!isHero) wakeTarget(c, id, h.at, heroId);
        push(c, id, at, isHero ? null : heroId);
      }
      break;
    }
    case 'smoke': {
      useItem(h, t.itemId);
      throwEv('smoke', t.at!);
      const hexes = smokeOut(c, t.at!);
      c.ev.push({ type: 'cast', by: heroId, spell: 'smoke', at: t.at!, hexes });
      say(c, 'Smoke billows up.');
      break;
    }
    case 'glue': {
      useItem(h, t.itemId);
      throwEv('glue', t.at!);
      const hexes = areaOf(c, t.at!, 1).filter((p) => isFloorish(c.w, c.d, p));
      for (const p of hexes) c.d.glue[posKey(p)] = GLUE_ROUNDS;
      c.ev.push({ type: 'cast', by: heroId, spell: 'glue', at: t.at!, hexes });
      for (const m of onMap(c)) {
        if (m.kind === 'gloam' || m.kind === 'dragon') continue;
        if (hexes.some((p) => samePos(p, m.at))) {
          m.stuck = GLUE_ROUNDS;
          say(c, `${m.name} is stuck fast.`);
        }
      }
      break;
    }
    case 'dart': {
      useItem(h, t.itemId);
      const r = doRoll();
      const m = c.d.monsters.find((x) => x.id === t.id)!;
      throwEv('dart', m.at);
      if (r.hits) putToSleep(c, m);
      else c.ev.push({ type: 'miss', attacker: heroId, target: m.id });
      break;
    }
    case 'caltrops':
      useItem(h, t.itemId);
      throwEv('caltrops', t.at!);
      c.d.caltrops.push(posKey(t.at!));
      break;
    case 'firecracker':
      useItem(h, t.itemId);
      throwEv('firecracker', t.at!);
      say(c, 'Crack! The sound echoes down the halls.');
      makeNoise(c, t.at!, FIRECRACKER_NOISE);
      break;
    case 'key':
      useItem(h, t.itemId);
      unlockAt(c, t.at!, heroId);
      say(c, `${name} turns the skeleton key. Click.`);
      break;
    case 'oil':
      useItem(h, t.itemId);
      setLight(c, c.d.light + OIL_LIGHT);
      say(c, `${name} tops up the lantern.`);
      break;
    case 'grapple': {
      const g = grappleTop(c, h.at, heroId)!;
      const from = h.at;
      h.at = { ...g.to! };
      c.ev.push({ type: 'moved', id: heroId, path: [h.at] });
      c.ev.push({ type: 'levelChanged', id: heroId, from: from.level, to: h.at.level });
      say(c, `${name} throws the hook and hauls up to ${c.w.levelName(h.at.level)}.`);
      levelHeal(c, h);
      if (h.escorting && c.d.prisoner) c.d.prisoner.escortedBy = undefined;
      h.escorting = undefined;
      glimpse(c, h.at);
      afterHeroMove(c, h);
      break;
    }
    case 'attack':
    case 'firebolt': {
      const r = doRoll();
      const tid = t.id!;
      makeNoise(c, h.at, sp.noise);
      if (c.d.rivals?.members.some((x) => x.id === tid)) makeHostile(c);
      if (r.hits === 0) {
        c.ev.push({ type: 'miss', attacker: heroId, target: tid });
        wakeTarget(c, tid, h.at, heroId);
      } else {
        const dmg = r.hits * (sp.dmg ?? 1) + (r.perfect ? 1 : 0);
        // V3.9 (spec 24.3): name the backstab in the log (the view reads the hit's `backstab` flag too).
        const stab = action === 'attack' && sp.modifiers.some((m) => m.startsWith('Backstab'));
        if (stab) say(c, `${heroName(c, heroId)} backstabs ${c.d.monsters.find((m) => m.id === tid)?.name ?? c.d.rivals?.members.find((m) => m.id === tid)?.name ?? 'it'}: ${dmg}.`);
        hurtAny(c, tid, dmg, heroId, { crit: r.perfect, backstab: stab });
        turnOnHit(c, tid, heroId); // V4.0 (spec 26.3): after the hit (a backstab lands from behind first)
      }
      break;
    }
    case 'shove': {
      const r = doRoll();
      const tid = t.id!;
      makeNoise(c, h.at, sp.noise);
      if (c.d.rivals?.members.some((x) => x.id === tid)) makeHostile(c);
      if (r.hits < 2) {
        c.ev.push({ type: 'miss', attacker: heroId, target: tid });
        wakeTarget(c, tid, h.at, heroId);
        break;
      }
      wakeTarget(c, tid, h.at, heroId);
      push(c, tid, h.at, heroId);
      // Perfect: 1 more damage on top of whatever the push did.
      if (r.perfect && (c.d.monsters.some((x) => x.id === tid) || rivalsOnMap(c).some((x) => x.id === tid))) hurtAny(c, tid, 1, heroId);
      turnOnHit(c, tid, heroId); // V4.0 (spec 26.3)
      break;
    }
    case 'pick': {
      const tool = pickTool(c, h);
      const r = doRoll();
      const at = t.at!;
      const l = lockedThingAt(c, at)!;
      // Spec 21.4: the improvised pick is used up whatever the result.
      if (tool && !tool.proper) h.pack.splice(h.pack.indexOf(tool.item), 1);
      // All slots: silent; one short: open with noise 2; one hit on 3 slots: holds; none: jams (spec 19.2 on 2 slots).
      if (r.hits >= sp.slots - 1) {
        unlockAt(c, at, heroId);
        if (r.hits < sp.slots) makeNoise(c, at, 2);
        say(c, r.hits === sp.slots ? `${name} slips the lock.` : `${name} forces the lock. Clunk.`);
      } else if (r.hits === 1) {
        say(c, `The lock holds.`);
      } else {
        if (l.door) doorAt(c.d, at)!.jammed = true;
        else c.d.chests.find((x) => samePos(x.at, at) && !x.opened)!.jammed = true;
        say(c, `The pick snaps in the lock. It's jammed.`);
      }
      if (tool && !tool.proper) say(c, `${name}'s improvised pick is spent.`);
      break;
    }
    case 'smash': {
      const r = doRoll();
      const at = t.at!;
      const l = lockedThingAt(c, at)!;
      makeNoise(c, at, 4);
      if (r.hits >= (l.chest ? 1 : 2)) {
        unlockAt(c, at, heroId);
        say(c, `${name} smashes it open.`);
      } else say(c, 'It holds. Everyone heard that.');
      break;
    }
    case 'disarm': {
      const r = doRoll();
      const at = t.at!;
      if (r.hits > 0) {
        delete c.d.traps[posKey(at)];
        say(c, `${name} disarms the trap.`);
      } else {
        delete c.d.traps[posKey(at)];
        c.ev.push({ type: 'trap', at, id: heroId, damage: 3 });
        say(c, `The trap goes off in ${name}'s hands.`);
        hurtHero(c, h, 3, 'trap');
        makeNoise(c, at, 2);
      }
      break;
    }
    case 'open': {
      if (t.id) {
        openChest(c, t.id, heroId);
        break;
      }
      const door = doorAt(c.d, t.at!)!;
      door.open = !door.open;
      c.ev.push({ type: 'doorChanged', at: t.at!, open: door.open, locked: door.locked });
      break;
    }
    case 'take': {
      const g = c.d.ground.find((x) => samePos(x.at, t.at!))!;
      const got: Item[] = [];
      const left: Item[] = [];
      const plan = takePlan(c, h, t.at!);
      const rest0 = g.items.filter((i) => !plan.items.includes(i));
      for (const it of [...plan.items, ...rest0]) {
        const before = it.amount;
        const rest = addToPack(c, h.pack, it);
        if (!rest) got.push(it);
        else {
          if (rest.amount !== before) got.push({ ...it, amount: before - rest.amount, name: `${before - rest.amount} gold` });
          left.push(rest);
        }
      }
      g.items = left;
      cleanGround(c);
      if (got.length) c.ev.push({ type: 'looted', id: heroId, items: got });
      if (got.some((i) => i.kind === 'heirloom')) say(c, `${name} has the heirloom. Now get out.`);
      break;
    }
    case 'drop': {
      const it = useItem(h, t.itemId);
      if (it) putOnGround(c, h.at, [it]);
      break;
    }
    case 'give': {
      const o = hd(c, t.id!)!;
      const it = useItem(h, t.itemId)!;
      const rest = addToPack(c, o.pack, it);
      if (rest) h.pack.push(rest);
      break;
    }
    case 'light': {
      c.d.lit.push(posKey(t.at!));
      c.ev.push({ type: 'brazierLit', at: t.at! });
      setLight(c, c.d.light + BRAZIER_LIGHT);
      say(c, `${name} lights the brazier.`);
      break;
    }
    case 'shutter': {
      c.d.lanternOpen = !c.d.lanternOpen;
      c.visCache = undefined;
      c.ev.push({ type: 'shutter', open: c.d.lanternOpen });
      c.ev.push({ type: 'light', light: c.d.light, brightness: brightnessOf(c.d.light) });
      say(c, c.d.lanternOpen ? `${name} opens the lantern.` : `${name} shutters the lantern.`);
      break;
    }
    case 'escape': {
      const r = doRoll();
      const m = c.d.monsters.find((x) => x.id === t.id)!;
      makeNoise(c, h.at, 1);
      if (r.hits) {
        say(c, `${name} wrenches free.`);
        releaseHold(c, m);
      } else say(c, `${m.name} holds on.`);
      break;
    }
    case 'torch':
      useItem(h, t.itemId);
      h.torch = TORCH_ROUNDS;
      say(c, `${name} lights a torch.`);
      break;
    case 'nightsight':
      useItem(h, t.itemId);
      h.nightEyes = NIGHTSIGHT_ROUNDS;
      c.visCache = undefined;
      say(c, `${name} drinks the night-eye draught. The dark thins.`);
      break;
    case 'potion': {
      useItem(h, t.itemId);
      const o = hd(c, t.id!)!;
      const od = heroDef(c, o.heroId)!;
      if (o.status === 'downed') {
        o.status = 'active';
        o.hp = 5;
        o.bleed = 0;
        c.ev.push({ type: 'revived', id: o.heroId });
      } else o.hp = Math.min(od.maxHp, o.hp + 5);
      break;
    }
    case 'revive': {
      const o = hd(c, t.id!)!;
      o.status = 'active';
      o.hp = 3;
      o.bleed = 0;
      o.revived = true;
      o.moved = true;
      o.acted = true;
      c.ev.push({ type: 'revived', id: o.heroId });
      say(c, `${heroName(c, o.heroId)} is back on their feet. Barely.`);
      break;
    }
    case 'charge':
      useItem(h, t.itemId);
      setFuse(c, t.at!, 1, heroId);
      say(c, `${name} sets a charge. Fuse 1. Stand clear.`);
      break;
    case 'rope':
      useItem(h, t.itemId);
      c.d.ropes.push(posKey(h.at));
      break;
    case 'climb': {
      const from = h.at;
      h.at = { ...t.at! };
      c.ev.push({ type: 'moved', id: heroId, path: [h.at] });
      if (from.level !== h.at.level) {
        c.ev.push({ type: 'levelChanged', id: heroId, from: from.level, to: h.at.level });
        levelHeal(c, h);
      }
      if (h.escorting && c.d.prisoner) c.d.prisoner.escortedBy = undefined;
      h.escorting = undefined;
      ventCheck(c, h);
      afterHeroMove(c, h);
      break;
    }
    case 'jump': {
      // V3.7 (spec 20.2): leaving an enemy's side by jumping provokes its free swing first.
      provokeSwings(c, h, h.at, t.at!, new Set());
      if (h.status !== 'active') break;
      say(c, `${name} jumps.`);
      c.ev.push({ type: 'moved', id: heroId, path: [{ ...t.at! }] });
      fall(c, heroId, t.at!, null);
      break;
    }
    case 'winch': {
      c.d.liftWorking = true;
      c.ev.push({ type: 'liftWorking' });
      say(c, `${name} hauls on the winch. Chains rattle; the lift groans awake.`);
      makeNoise(c, h.at, WINCH_NOISE);
      break;
    }
    case 'free': {
      const pr = c.d.prisoner!;
      if (pr.escortedBy) {
        const old = hd(c, pr.escortedBy);
        if (old) old.escorting = undefined;
      }
      if (!pr.freed) {
        pr.freed = true;
        c.ev.push({ type: 'freed', prisonerId: pr.id });
        say(c, `${pr.name} is free. Stay close.`);
      }
      pr.escortedBy = heroId;
      h.escorting = pr.id;
      break;
    }
    case 'bribe':
    case 'parley':
      // The deal itself is a 'deal' command (spec 18.6); opening the card does nothing.
      break;
    case 'rally': {
      h.rallyCooldown = 3;
      for (const o of activeHeroes(c)) if (o !== h && within(o.at, h.at, 3)) o.focus = Math.min(focusMax(o), o.focus + 1);
      say(c, `${name}: "Steady!"`);
      break;
    }
    case 'guard':
      h.guarding = t.id;
      break;
    case 'kindle':
      setLight(c, c.d.light + KINDLE_LIGHT);
      break;
    case 'mend': {
      const o = hd(c, t.id!)!;
      o.hp = Math.min(heroDef(c, o.heroId)!.maxHp, o.hp + 4);
      break;
    }
    case 'passLantern':
      c.d.lanternBearer = t.id!;
      break;
    case 'leave':
      leaveCastle(c, h);
      break;
    // ---- V3.7 (spec 20.5) kit
    case 'brace':
      h.braced = true;
      c.ev.push({ type: 'braced', id: heroId });
      say(c, `${name} sets their feet and braces.`);
      break;
    case 'hamstring': {
      const r = doRoll();
      const tid = t.id!;
      makeNoise(c, h.at, sp.noise);
      if (c.d.rivals?.members.some((x) => x.id === tid)) makeHostile(c);
      wakeTarget(c, tid, h.at, heroId);
      if (!r.hits) {
        c.ev.push({ type: 'miss', attacker: heroId, target: tid });
        break;
      }
      c.ev.push({ type: 'hit', attacker: heroId, target: tid, damage: 0, crit: r.perfect });
      rootFigure(c, tid, HAMSTRING_ROUNDS, heroId);
      turnOnHit(c, tid, heroId); // V4.0 (spec 26.3)
      break;
    }
    case 'nightthorn': {
      const r = doRoll();
      const tid = t.id!;
      c.ev.push({ type: 'cast', by: heroId, spell: 'nightthorn', targetId: tid, at: figurePos(c, tid) });
      if (c.d.rivals?.members.some((x) => x.id === tid)) makeHostile(c);
      if (!r.hits) {
        c.ev.push({ type: 'miss', attacker: heroId, target: tid });
        wakeTarget(c, tid, h.at, heroId);
        break;
      }
      hurtAny(c, tid, r.hits * NIGHTTHORN_DMG + (r.perfect ? 1 : 0), heroId, { crit: r.perfect });
      turnOnHit(c, tid, heroId); // V4.0 (spec 26.3)
      break;
    }
    case 'briar': {
      const r = doRoll();
      const tid = t.id!;
      c.ev.push({ type: 'cast', by: heroId, spell: 'briar', targetId: tid, at: figurePos(c, tid) });
      makeNoise(c, h.at, sp.noise);
      if (c.d.rivals?.members.some((x) => x.id === tid)) makeHostile(c);
      if (!r.hits) {
        c.ev.push({ type: 'miss', attacker: heroId, target: tid });
        wakeTarget(c, tid, h.at, heroId);
        break;
      }
      hurtAny(c, tid, r.hits * BRIAR_DMG + (r.perfect ? 1 : 0), heroId, { crit: r.perfect });
      if (figurePos(c, tid)) rootFigure(c, tid, r.perfect ? BRIAR_ROOT_PERFECT : BRIAR_ROOT, heroId);
      turnOnHit(c, tid, heroId); // V4.0 (spec 26.3)
      break;
    }
    case 'smashProp': {
      const at = t.at!;
      const what = c.w.tile(at)?.prop ?? 'crate';
      (c.d.smashed ??= []).push(posKey(at));
      const items: Item[] = [];
      const roll100 = int(c.s, 1, 100);
      if (roll100 <= SMASH_GOLD_CHANCE) items.push(makeItem(c, 'gold', int(c.s, SMASH_GOLD[0], SMASH_GOLD[1])));
      else if (roll100 <= SMASH_GOLD_CHANCE + SMASH_ITEM_CHANCE) items.push(makeItem(c, pick(c.s, SMASH_ITEMS)));
      putOnGround(c, at, items);
      c.ev.push({ type: 'propSmashed', at: { ...at }, by: heroId, items });
      say(c, items.length ? `${name} smashes the ${what}. ${items.map((i) => i.name).join(', ')} spills out.` : `${name} smashes the ${what}. Nothing but splinters.`);
      makeNoise(c, at, SMASH_NOISE);
      break;
    }
  }
  checkHolds(c);
  if (action !== 'shutter' && action !== 'leave' && action !== 'parley') rivalOverwatchFire(c, heroId);
  refreshSight(c);
  checkDelveEnd(c);
  return undefined;
}


function wakeTarget(c: Ctx, id: string, from: Pos, by?: string): void {
  const m = c.d.monsters.find((x) => x.id === id);
  if (!m) return;
  if (m.awareness !== 'hunting') goHunting(c, m, from);
  if (by) noticeHero(c, m, by);
}

export function leaveCastle(c: Ctx, h: HeroInDelve): void {
  h.status = 'out';
  c.ev.push({ type: 'out', id: h.heroId });
  say(c, `${heroName(c, h.heroId)} is out.`);
  const pr = c.d.prisoner;
  if (pr && h.escorting === pr.id && !pr.dead && adjacent(pr.at, h.at)) {
    pr.out = true;
    c.ev.push({ type: 'out', id: pr.id });
  } else if (pr && h.escorting === pr.id) {
    pr.escortedBy = undefined;
  }
  h.escorting = undefined;
  passLanternIfNeeded(c);
}

export function abandon(c: Ctx): void {
  for (const h of c.d.heroes) {
    if (h.status === 'active' && canLeaveAt(c, h.at)) leaveCastle(c, h);
  }
  endDelve(c);
}

/** No active heroes left: the delve is over. */
export function checkDelveEnd(c: Ctx): boolean {
  if (c.s.stage !== 'delve') return true;
  if (c.d.heroes.some((h) => h.status === 'active')) return false;
  endDelve(c);
  return true;
}

export function endDelve(c: Ctx): void {
  for (const h of c.d.heroes) {
    // V3.7 (spec 20.4): a downed hero in a crew member's hands is carried off, not left to die.
    const dragger = h.status === 'downed' ? rivalsOnMap(c).find((r) => r.dragging === h.heroId) : undefined;
    if (dragger) {
      capture(c, dragger, h as HeroX);
      continue;
    }
    if (h.status === 'active' || h.status === 'downed') {
      killHero(c, h);
      noteOnce(c, `${heroName(c, h.heroId)} was left behind.`);
    }
  }
  const pr = c.d.prisoner;
  if (pr && !pr.out && !pr.dead && pr.freed) noteOnce(c, `${pr.name} never made it out.`);
  const cr = c.d.rivals;
  if (cr && cr.entered) {
    const took = cr.members.flatMap((r) => r.loot);
    if (took.length) noteOnce(c, `${cr.name} made off with ${valueOf(took)} gold in loot.`);
  }
  buildSummary(c);
}
