// V4.0 (spec 28, design pillar 17): rivals play by the party's rules. Crew members move like heroes of their
// class (walk 4, Burglar 5; sneak 2, Burglar 4; dash), walk loud or sneak silent, wake sleepers with the heroes'
// wake rolls, are looked at by every monster at every step, spring and spot traps (their Burglar disarms the ones
// in her way), pick or smash locks with the heroes' pick rules, and a crew Sapper digs and blasts a shorter way.
// What they do is named in the log when the party can see it, and heard when it makes a sound it can't.
// Pure rules: no DOM; all dice through the seeded RNG.

import { distance, posKey, posNeighbors, samePos, type Pos } from './hex';
import {
  BLAST_INNER_DMG, BLAST_OUTER_DMG, BURGLAR_WALK, CLASSES, CREW_CAUTION, CREW_LOOKOUT, CREW_PARTY_CAUTION, CREW_STALK_RANGE, DIG_NOISE,
  RIVAL_MOVE, SAPPER_SHORTCUT, SMASH_NOISE, SMUGGLER_SNEAK, SWING_SLOT_PENALTY, WALK_MOVE,
} from './data';
import { chance } from './rng';
import { say, type Ctx, type RivalX } from './state';
import type { Intent, Item } from './types';
import { activeHeroes, chestLoot, goAlert, hd, hurtAny, isSatchel, makeNoise, monsterStats, onMap, putOnGround, rivalsOnMap, roll } from './common';
import { canEnter, dijkstra, dirIndex, distField, doorAt, kindAt, litSet, los, seesHex, within } from './world';
import { approach, blocked, strikeDetailed } from './ai';
import { hearStep, partySees } from './hearing';
import { faceToward, heroSwings, isSneaking, monsterCanSwing, moodOf, sleepersNear, stepNoise, wakeChance } from './stealth';
import { lookAll } from './world-phase';
import { blastArea, blastableWall, fuseAt, fuses, satchelName, setFuse, spendPick } from './charges';
import { digOut } from './delve';
import { checkWays } from './ways';
import { envenom, trapDamage } from './venom';
import { springTripwires, tripwireNear } from './village'; // V4.1 (spec 31.3): the tripwire

// ---------------------------------------------------------------- telling the party (pillar 17: visible and named)

/** Does the party see the member (or the hex it works on)? */
export function crewSeen(c: Ctx, r: RivalX, at?: Pos): boolean {
  return partySees(c, r.at) || (!!at && partySees(c, at));
}

/** A log line about a crew member's deed, only when the party can see it (what it can't see stays unknown). */
export function tell(c: Ctx, r: RivalX, text: string, at?: Pos): void {
  if (crewSeen(c, r, at)) say(c, text);
}
const tellParty = tell;

/** A crew member's stat as a hero of its class at its level: +5 a level when it is the class's main stat. */
export function crewStat(r: RivalX, stat: 'might' | 'finesse' | 'wits'): number {
  const def = CLASSES[r.cls];
  return def.stats[stat] + (r.level !== undefined && def.main === stat ? 5 * (r.level - 1) : 0);
}

// ---------------------------------------------------------------- moving like a hero (spec 28.1)

/** Walk 4 (Burglar 5), sneak 2 (Burglar 4), as a hero of the class; a dash goes as far again. Legacy members walk 4. */
export function crewBudget(r: RivalX, sneak: boolean): number {
  if (sneak) return r.cls === 'burglar' ? SMUGGLER_SNEAK : 2;
  if (r.level === undefined) return RIVAL_MOVE;
  return r.cls === 'burglar' ? BURGLAR_WALK : WALK_MOVE;
}

/** Does this hero see the member now (their own eyes: facing, light; a veiled member is unseen)? */
function heroSees(c: Ctx, heroId: string, r: RivalX, lit: Set<string>): boolean {
  const h = hd(c, heroId);
  if (!h || h.status !== 'active' || (r.veil ?? 0) > 0) return false;
  return seesHex(c.w, c.d, h.at, r.at, lit, h.facing);
}

/** V4.0 (spec 28.5): every hero who sees the member now has noticed her (`seenBy`). */
export function noteSeenBy(c: Ctx, r: RivalX, lit: Set<string> = litSet(c.w, c.d)): void {
  for (const h of activeHeroes(c)) {
    if (!heroSees(c, h.heroId, r, lit)) continue;
    const ids = (r.seenBy ??= []);
    if (!ids.includes(h.heroId)) ids.push(h.heroId);
  }
}

/**
 * V4.0 (spec 28.5): at the start of the crew's turn, once no hero sees a member any more the party has lost her: every
 * hero forgets her (as a monster that loses its quarry forgets who it saw). While any hero keeps her in sight, those
 * who noticed her keep knowing she's there.
 */
export function forgetSeenBy(c: Ctx): void {
  const lit = litSet(c.w, c.d);
  for (const r of rivalsOnMap(c)) {
    if (!r.seenBy?.length) continue;
    if (!activeHeroes(c).some((h) => heroSees(c, h.heroId, r, lit))) r.seenBy = [];
  }
}

/** Has this hero noticed the member? (Not: she gets the sneak attack, and from behind the Burglar's backstab.) */
export function heroNoticed(r: RivalX, heroId: string): boolean {
  return !!r.seenBy?.includes(heroId);
}

/** A monster the member can make out (crews carry their own light): same level, within CREW_LOOKOUT, in line of sight. */
function memberSees(c: Ctx, r: RivalX, p: Pos): boolean {
  return p.level === r.at.level && distance(p, r.at) <= CREW_LOOKOUT && los(c.w, c.d, r.at, p);
}

/**
 * V4.0 (spec 28.1): walk or sneak? A feared or dragging member walks. A hostile member sneaks while it stalks: out of
 * the party's sight, its target within CREW_STALK_RANGE and not having noticed it. A hired member moves as the hero
 * who hired it last moved. A member at peace (prospectors, a truce, a bribed crew, a job) sneaks when a monster it can
 * see that isn't hunting (asleep, unaware or searching) lies within CREW_CAUTION of its path, or an active hero within
 * CREW_PARTY_CAUTION (looting near the party).
 */
export function wantSneak(c: Ctx, r: RivalX, path: Pos[], targetId?: string): boolean {
  const cr = c.d.rivals;
  if (!cr || (r.feared ?? 0) > 0 || r.dragging) return false;
  if (cr.stance === 'hostile') {
    const t = targetId ? hd(c, targetId) : undefined;
    return !!t && t.status === 'active' && !partySees(c, r.at) && !heroNoticed(r, t.heroId) && t.at.level === r.at.level && distance(t.at, r.at) <= CREW_STALK_RANGE;
  }
  if (cr.stance === 'hired') {
    const h = cr.hiredBy ? hd(c, cr.hiredBy) : undefined;
    return !!h && isSneaking(h);
  }
  const hexes = [r.at, ...path];
  const near = (p: Pos, n: number) => hexes.some((x) => x.level === p.level && distance(x, p) <= n);
  for (const m of onMap(c)) {
    if (m.kind === 'gloam' || moodOf(m) === 'hunting') continue;
    if (near(m.at, CREW_CAUTION) && memberSees(c, r, m.at)) return true;
  }
  return activeHeroes(c).some((h) => near(h.at, CREW_PARTY_CAUTION));
}

/** A planned special action on the way: a Sapper's dig or blast, the Burglar's disarm. */
export interface CrewWay {
  kind: 'dig' | 'blast' | 'disarm';
  at: Pos;
}

export interface CrewRoute {
  path: Pos[];
  sneak: boolean;
  /** The path goes further than one move: the member dashes (it acts no more this round). */
  dash: boolean;
  /** Done once the walk ends next to `at`. */
  way?: CrewWay;
}

/** A trap the crew knows of (spec 28.4): they walk round it. */
export function crewTrap(c: Ctx, p: Pos): boolean {
  return !!c.d.traps[posKey(p)]?.crewSpotted;
}

/** Within a live charge's blast (2): crews keep out, as the party does. */
function inBlast(c: Ctx, p: Pos): boolean {
  return fuses(c.d).some((f) => f.at.level === p.level && distance(f.at, p) <= 2);
}

/** The walk toward `goals` keeping out of known traps and live charges' blasts; when that gets nowhere, the plain walk. */
function pathOf(c: Ctx, r: RivalX, goals: Pos[], budget: number, stairs: boolean): { path: Pos[]; wary: Pos[]; plain: Pos[] } {
  const keepOut = (p: Pos) => crewTrap(c, p) || inBlast(c, p);
  const wary = approach(c, r.id, r.at, goals, budget, { stairs, avoid: keepOut }) ?? [];
  const plain = approach(c, r.id, r.at, goals, budget, stairs) ?? [];
  return { path: wary.length ? wary : plain, wary, plain };
}

/**
 * V4.0 (spec 28): the way a member walks toward `goals` this round, by the heroes' rules. A crew Sapper first looks
 * for a dig or a blast that saves SAPPER_SHORTCUT hexes or opens a locked way (spec 28.6). Then the walk (around
 * traps the crew knows and live charges), walk or sneak (`wantSneak`, or `o.sneak`), and a dash (`o.dash`) when one
 * move doesn't reach a goal. A Burglar whose way round a known trap is longer disarms it instead (spec 28.4).
 * Pure: used for intents and for the act alike.
 */
export function crewApproach(c: Ctx, r: RivalX, goals: Pos[], o: { dash?: boolean; sneak?: boolean; targetId?: string; stairs?: boolean } = {}): CrewRoute {
  const stairs = o.stairs ?? true;
  const none: CrewRoute = { path: [], sneak: false, dash: false };
  if (!goals.length) return none;
  if ((r.stuck ?? 0) > 0) return none;
  if (r.cls === 'sapper' && !(r.feared ?? 0)) {
    const way = sapperWay(c, r, goals);
    if (way) {
      if (adjacentHex(r.at, way.at)) return { ...none, way };
      const path = approach(c, r.id, r.at, standSpots(c, r, way.at), crewBudget(r, false), stairs) ?? [];
      const end = path[path.length - 1];
      return end && adjacentHex(end, way.at) ? { path, sneak: false, dash: false, way } : { path, sneak: false, dash: false };
    }
    // A Sapper waits for its own lit fuse (it already stands clear: the setter takes nothing).
    if (fuses(c.d).some((f) => f.by === r.id)) return none;
  }
  const atGoal = (p: Pos | undefined) => !!p && goals.some((g) => samePos(g, p));
  if (atGoal(r.at)) return none;
  let sneak = o.sneak ?? false;
  let ways = pathOf(c, r, goals, crewBudget(r, sneak), stairs);
  if (o.sneak === undefined && wantSneak(c, r, ways.path, o.targetId)) {
    sneak = true;
    ways = pathOf(c, r, goals, crewBudget(r, true), stairs);
  }
  const path = ways.path;
  // The Burglar disarms a known trap on her way rather than walk the long way round it (or not at all).
  if (r.cls === 'burglar') {
    const k = ways.plain.findIndex((p) => crewTrap(c, p));
    if (k >= 0) {
      const field = distField(c.w, c.d, goals, { stairs });
      const far = (p: Pos | undefined) => (p ? (field.get(posKey(p)) ?? 999) : (field.get(posKey(r.at)) ?? 999));
      if (!ways.wary.length || far(ways.wary[ways.wary.length - 1]) > far(ways.plain[ways.plain.length - 1]) + 1) {
        return { path: ways.plain.slice(0, k), sneak, dash: false, way: { kind: 'disarm', at: ways.plain[k]! } };
      }
    }
  }
  if (o.dash && !atGoal(path[path.length - 1])) {
    const far = pathOf(c, r, goals, 2 * crewBudget(r, sneak), stairs).path;
    if (far.length > path.length) return { path: far, sneak, dash: true };
  }
  return { path, sneak, dash: false };
}

function adjacentHex(a: Pos, b: Pos): boolean {
  return a.level === b.level && distance(a, b) === 1;
}

/** Free hexes next to `at` a member can stand on to work it. */
function standSpots(c: Ctx, r: RivalX, at: Pos): Pos[] {
  return posNeighbors(at).filter((p) => canEnter(c.w, c.d, p) && kindAt(c.w, c.d, p) !== 'door' && !blocked(c, p, r.id));
}

/** The intent a route shows (a planned special action, or the move itself). */
export function routeIntent(c: Ctx, route: CrewRoute, fallback: Intent = { kind: 'wait' }): Intent {
  const w = route.way;
  if (w?.kind === 'dig') return { kind: 'dig', to: { ...w.at } };
  if (w?.kind === 'disarm') return { kind: 'disarm', to: { ...w.at } };
  if (w?.kind === 'blast') return { kind: 'fuse', to: { ...w.at }, hexes: blastArea(c.w, w.at), damage: [BLAST_OUTER_DMG, BLAST_INNER_DMG] };
  const end = route.path[route.path.length - 1];
  if (!end) return fallback;
  return { kind: 'move', to: { ...end }, ...(route.sneak ? { sneak: true } : {}), ...(fallback.targetId ? { targetId: fallback.targetId } : {}) };
}

/**
 * V4.0 (spec 28.1, 28.2, 28.4): a crew member walks `path`, walking or sneaking, by the heroes' rules, step by step:
 * it faces each step; heroes it leaves swing at a hostile one, hunting monsters that noticed it swing at it; doors
 * open; walking, its footsteps are heard by the party (sneaking: silent), every awake monster looks (`lookAll`: it
 * may be noticed, and the cover of others blown), heroes who see it notice it, walking makes step noise (1, rubble 2)
 * and sleepers roll to wake (the heroes' chances, a Burglar's quiet feet); a trap on the hex springs. At the end it
 * looks for traps. Returns true when it was stopped short (rooted, killed, a trap downing it).
 */
export function crewWalk(c: Ctx, r: RivalX, path: Pos[], sneak = false): boolean {
  if (!path.length) return false;
  if ((r.stuck ?? 0) > 0) return true;
  r.sneaked = sneak;
  const lit = litSet(c.w, c.d);
  const seg: Pos[] = [];
  const flush = () => {
    if (!seg.length) return;
    c.ev.push({ type: 'moved', id: r.id, path: [...seg] });
    seg.length = 0;
  };
  const alive = () => r.hp > 0 && !r.goneOut;
  const swung = new Set<string>();
  let passed = false;
  let from = r.at;
  for (const [i, p] of path.entries()) {
    if (p.level === from.level && !samePos(p, from)) r.facing = dirIndex(from, p);
    if (heroSwings(c, r.id, from, p)) {
      flush();
      return true;
    }
    monsterSwings(c, r, from, p, swung);
    if (!alive()) {
      flush();
      return true;
    }
    if (kindAt(c.w, c.d, p) === 'door') {
      const door = doorAt(c.d, p);
      if (door && !door.open && !door.locked) {
        door.open = true;
        c.ev.push({ type: 'doorChanged', at: p, open: true, locked: false });
      }
    }
    seg.push(p);
    r.at = { ...p };
    if (!sneak) hearStep(c, r.id, p);
    if (p.level !== from.level) {
      flush();
      c.ev.push({ type: 'levelChanged', id: r.id, from: from.level, to: p.level });
    }
    from = p;
    c.visCache = undefined;
    // Monsters look whenever anything moves (spec 27.3): a crew member's step too.
    lookAll(c, r.id, flush, true);
    noteSeenBy(c, r, lit);
    const noise = stepNoise(c, p, sneak);
    if (noise) makeNoise(c, p, noise, { quiet: true });
    crewWakeRolls(c, r, p, i === path.length - 1, sneak, lit);
    if (sneak && !passed) {
      const m = onMap(c).find((x) => x.kind !== 'gloam' && x.at.level === p.level && distance(x.at, p) <= 2 && (x.awareness === 'asleep' || moodOf(x) === 'unaware'));
      if (m && crewSeen(c, r)) {
        passed = true;
        say(c, `${r.name} sneaks past the ${m.awareness === 'asleep' ? 'sleeping ' : ''}${m.name.toLowerCase()}.`);
      }
    }
    if (c.d.traps[posKey(p)]) {
      flush();
      springCrewTrap(c, r, p);
      if (!alive()) return true;
    }
    // V4.1 (spec 31.3): a hero Sapper's tripwire next to the step goes off; the walk ends here.
    if (tripwireNear(c, p)) {
      flush();
      springTripwires(c, r.id, p);
      return true;
    }
  }
  flush();
  crewSpotTraps(c, r);
  return false;
}

/** Hunting monsters that noticed the member swing as it steps out of their reach (spec 20.2, as at a hero). */
function monsterSwings(c: Ctx, r: RivalX, from: Pos, to: Pos, done: Set<string>): void {
  for (const m of c.d.monsters) {
    if (done.has(m.id) || r.hp <= 0) continue;
    if (!(m.at.level === from.level && distance(m.at, from) === 1) || (m.at.level === to.level && distance(m.at, to) <= 1)) continue;
    if (!monsterCanSwing(m, r.id)) continue;
    done.add(m.id);
    const st = monsterStats(m);
    faceToward(m, from);
    tell(c, r, `${m.name} gets a free swing at ${r.name}.`, m.at);
    const res = strikeDetailed(c, m.id, r.id, Math.max(1, st.slots - SWING_SLOT_PENALTY), st.chance, st.dmg, 'Free swing');
    if (crewSeen(c, r, m.at)) c.ev.push({ type: 'swing', by: m.id, target: r.id, hits: res.hits, damage: res.damage });
  }
}

/** The heroes' wake rolls for a crew member on `p` (spec 5.3): walking 50%, sneaking 10% (Burglar 5%), ending adjacent 100/25/10. */
function crewWakeRolls(c: Ctx, r: RivalX, p: Pos, last: boolean, sneak: boolean, lit: Set<string>): void {
  const quiet = r.cls === 'burglar';
  for (const m of sleepersNear(c, p)) {
    const pct = wakeChance(m, p, last, sneak, lit, undefined, quiet);
    if (pct <= 0 || !chance(c.s, pct)) continue;
    goAlert(c, m, p);
    c.ev.push({ type: 'woke', id: m.id, by: r.id });
    tell(c, r, `${m.name} ${m.kind === 'rats' ? 'stir' : 'stirs'} as ${r.name} passes.`, m.at);
  }
}

// ---------------------------------------------------------------- traps (spec 28.4)

/** A crew member steps on a trap: 3 damage (no armor), the trap is gone, noise 2; the party sees it, or hears a crash. */
export function springCrewTrap(c: Ctx, r: RivalX, at: Pos): void {
  const tr = c.d.traps[posKey(at)];
  delete c.d.traps[posKey(at)];
  // V4.0 (spec 29.5): a venom trap: 1 damage and venom, as on a hero.
  const dmg = trapDamage(tr);
  if (crewSeen(c, r, at)) {
    c.ev.push({ type: 'trap', at: { ...at }, id: r.id, damage: dmg, ...(tr?.venom ? { venom: true } : {}) });
    say(c, tr?.venom ? `A venom needle bites ${r.name}.` : `A trap bites ${r.name}.`);
  }
  hurtAny(c, r.id, dmg, null, { noise: false });
  if (tr?.venom) envenom(c, r.id, 'trap');
  makeNoise(c, at, 2, { what: 'crash' });
}

/**
 * Ending a move, a member rolls 1 Wits slot for each trap within 1 the crew doesn't know (the heroes' rule; crews carry
 * their own light, so no darkness penalty): a hit and the crew walks round it from now on. If the party sees her mark
 * it, they know it too.
 */
export function crewSpotTraps(c: Ctx, r: RivalX): void {
  if (r.hp <= 0 || r.goneOut) return;
  for (const [k, t] of Object.entries(c.d.traps)) {
    if (t.crewSpotted) continue;
    const [lv, rest] = k.split(':');
    const [q, rr] = (rest ?? '0,0').split(',').map(Number) as [number, number];
    const at = { level: Number(lv), q, r: rr };
    if (!within(at, r.at, 1)) continue;
    if (!roll(c, r.id, 'Spot trap', 1, crewStat(r, 'wits')).hits) continue;
    t.crewSpotted = true;
    if (crewSeen(c, r, at)) {
      say(c, `${r.name} spots a trap and marks it.`);
      if (!t.spotted) {
        t.spotted = true;
        c.ev.push({ type: 'trapSpotted', at, ...(t.venom ? { venom: true } : {}) });
      }
    }
  }
}

/** The Burglar disarms a trap next to her: 2 Finesse slots; any hit removes it, none sets it off on her. */
function crewDisarm(c: Ctx, r: RivalX, at: Pos): void {
  if (!c.d.traps[posKey(at)]) return;
  faceToward(r, at);
  const rr = roll(c, r.id, 'Disarm', 2, crewStat(r, 'finesse'));
  if (rr.hits) {
    delete c.d.traps[posKey(at)];
    tell(c, r, `${r.name} kneels and disarms a trap.`, at);
    return;
  }
  const tr = c.d.traps[posKey(at)];
  delete c.d.traps[posKey(at)];
  const dmg = trapDamage(tr);
  if (crewSeen(c, r, at)) {
    c.ev.push({ type: 'trap', at: { ...at }, id: r.id, damage: dmg, ...(tr?.venom ? { venom: true } : {}) });
    say(c, `The trap goes off in ${r.name}'s hands.`);
  }
  hurtAny(c, r.id, dmg, null, { noise: false });
  if (tr?.venom) envenom(c, r.id, 'trap');
  makeNoise(c, at, 2, { what: 'crash' });
}

// ---------------------------------------------------------------- locks (spec 28.3)

/** Lockpicks in the member's pack: a Burglar picks at 3 slots, anyone else at 2 (the heroes' table); improvised picks (spec 30.2): 2. No picks: null. */
export function crewPickSlots(r: RivalX): number | null {
  if (!r.pack?.some((i) => i.kind === 'lockpicks' || i.kind === 'improvised')) return null;
  return r.cls === 'burglar' && r.pack.some((i) => i.kind === 'lockpicks') ? 3 : 2;
}

/** The crew's lockpicker on the map (the Burglar first). */
export function crewPicker(c: Ctx): RivalX | undefined {
  return [...rivalsOnMap(c)].filter((r) => crewPickSlots(r) !== null).sort((a, b) => (crewPickSlots(b) ?? 0) - (crewPickSlots(a) ?? 0))[0];
}

export type LockResult = 'silent' | 'clunk' | 'holds' | 'jammed' | 'smashed' | 'stuck';

/** What's locked at `at`: a door or an unopened chest. */
function lockAt(c: Ctx, at: Pos): { door?: true; chest?: true; jammed: boolean } | null {
  if (kindAt(c.w, c.d, at) === 'door') {
    const d = doorAt(c.d, at);
    return d && !d.open && d.locked ? { door: true, jammed: !!d.jammed } : null;
  }
  const ch = c.d.chests.find((x) => samePos(x.at, at) && !x.opened && x.locked);
  return ch ? { chest: true, jammed: !!ch.jammed } : null;
}

function unlock(c: Ctx, at: Pos): void {
  if (kindAt(c.w, c.d, at) === 'door') {
    const d = doorAt(c.d, at);
    if (!d) return;
    d.open = true;
    d.locked = false;
    d.jammed = false;
    c.ev.push({ type: 'doorChanged', at: { ...at }, open: true, locked: false });
    return;
  }
  const ch = c.d.chests.find((x) => samePos(x.at, at) && !x.opened);
  if (ch) {
    ch.locked = false;
    ch.jammed = false;
  }
}

/**
 * V4.0 (spec 28.3): a member works the lock next to it by the heroes' rules. With lockpicks it picks (Burglar 3 Finesse
 * slots, others 2): every slot hits: open, silent; one short: open, noise 2 (heard as a lock forced); 1 hit of 3: holds;
 * none: jammed. Without picks, or on a jammed lock (`smash` true): Smash, 2 Might slots, a chest opens on 1 hit, a door
 * on 2; noise 4 either way. A chest so opened is unlocked, not yet opened (the caller takes the loot).
 */
export function crewWorkLock(c: Ctx, r: RivalX, at: Pos, smash = false, log = true): LockResult {
  const l = lockAt(c, at);
  const tell = (cc: Ctx, rr: RivalX, text: string, p?: Pos) => {
    if (log) tellParty(cc, rr, text, p);
  };
  if (!l) return 'silent';
  faceToward(r, at);
  const what = l.door ? 'door' : 'chest';
  const slots = crewPickSlots(r);
  if (slots !== null && !l.jammed && !smash) {
    const rr = roll(c, r.id, 'Pick', slots, crewStat(r, 'finesse'));
    // V4.0 (spec 30.2): without lockpicks she works an improvised pick, one used up per attempt, as a hero Burglar.
    const imp = r.pack?.some((i) => i.kind === 'lockpicks') ? undefined : r.pack?.find((i) => i.kind === 'improvised');
    if (imp && r.pack) spendPick(r.pack, imp);
    if (rr.hits >= slots - 1) {
      unlock(c, at);
      if (rr.hits < slots) {
        makeNoise(c, at, 2, { what: 'lock' });
        tell(c, r, `${r.name} forces the ${what}'s lock. Clunk.`, at);
        return 'clunk';
      }
      tell(c, r, `${r.name} picks the ${what}'s lock without a sound.`, at);
      return 'silent';
    }
    if (rr.hits === 1) {
      tell(c, r, `The ${what}'s lock holds against ${r.name}'s picks.`, at);
      return 'holds';
    }
    if (l.door) doorAt(c.d, at)!.jammed = true;
    else c.d.chests.find((x) => samePos(x.at, at) && !x.opened)!.jammed = true;
    tell(c, r, `${r.name}'s pick snaps in the ${what}'s lock. It's jammed.`, at);
    return 'jammed';
  }
  const rr = roll(c, r.id, 'Smash', 2, crewStat(r, 'might'));
  makeNoise(c, at, SMASH_NOISE, { what: 'crash' });
  if (rr.hits >= (l.chest ? 1 : 2)) {
    unlock(c, at);
    tell(c, r, `${r.name} smashes the ${what}'s lock open.`, at);
    return 'smashed';
  }
  tell(c, r, `${r.name} hammers at the ${what}'s lock. It holds.`, at);
  return 'stuck';
}

/** Open an unlocked chest next to the member: its loot rolled, onto the member (looting) or the floor (a job). */
export function crewOpenChest(c: Ctx, chestId: string, toGround: boolean): Item[] {
  const ch = c.d.chests.find((x) => x.id === chestId)!;
  ch.opened = true;
  ch.locked = false;
  const items = chestLoot(c, ch.tier);
  if (toGround) putOnGround(c, ch.at, items);
  c.ev.push({ type: 'chestOpened', id: ch.id, items: toGround ? items : [] });
  return items;
}

// ---------------------------------------------------------------- the Sapper (spec 28.6)

/** Charges the member can spend: improvised explosives (kit) and bought ones. */
export function crewCharges(r: RivalX): number {
  if (!r.pack) return r.cls === 'sapper' ? (r.charges ?? 0) : 0;
  return r.pack.reduce((n, i) => n + (isSatchel(i) ? i.amount : i.kind === 'charge' ? 1 : 0), 0);
}

/** Spend one: improvised explosives first, as a hero Sapper. */
export function spendCrewCharge(r: RivalX): void {
  if (!r.pack) {
    r.charges = Math.max(0, (r.charges ?? 1) - 1);
    return;
  }
  const sat = r.pack.find(isSatchel);
  if (sat && sat.amount > 0) {
    sat.amount -= 1;
    sat.name = satchelName(sat.amount);
    if (sat.amount === 0) r.pack.splice(r.pack.indexOf(sat), 1);
    return;
  }
  const i = r.pack.findIndex((x) => x.kind === 'charge');
  if (i >= 0) r.pack.splice(i, 1);
}

/**
 * A shorter way for a crew Sapper (spec 28.6): a cracked wall or rubble heap it can dig (no charge), or a locked
 * door (not the barred gate) or breakable wall it can blast (a charge), next to a hex it can reach with its walk,
 * when going through it saves SAPPER_SHORTCUT hexes of walking to `goals`, or opens a way where there was none.
 * Digging is preferred to blasting (the charge is kept for the party). Deterministic.
 */
export function sapperWay(c: Ctx, r: RivalX, goals: Pos[]): CrewWay | null {
  if (fuses(c.d).some((f) => f.by === r.id)) return null;
  const field = distField(c.w, c.d, goals, { stairs: true });
  const d0 = field.get(posKey(r.at)) ?? Infinity;
  const charge = crewCharges(r) > 0;
  const nodes = dijkstra(c.w, c.d, r.at, { enter: (p) => !blocked(c, p, r.id), stairs: true, budget: crewBudget(r, false) });
  let best: { way: CrewWay; total: number; dig: boolean } | null = null;
  for (const n of nodes.values()) {
    if (!samePos(n.p, r.at) && blocked(c, n.p, r.id)) continue;
    for (const x of posNeighbors(n.p)) {
      const k = kindAt(c.w, c.d, x);
      const dig = k === 'cracked';
      const door = k === 'door' ? doorAt(c.d, x) : undefined;
      const blastDoor = !!door && door.locked && !door.open && !c.w.tile(x)?.barred;
      const blastWall = !dig && k === 'wall' && blastableWall(c.w, c.d, x);
      if (!dig && !((blastDoor || blastWall) && charge)) continue;
      if (fuseAt(c.d, x)) continue;
      let after = Infinity;
      for (const y of posNeighbors(x)) {
        const f = field.get(posKey(y));
        if (f !== undefined && f < after) after = f;
      }
      if (after === Infinity) continue;
      const total = n.cost + (blastWall ? 2 : 1) + after;
      if (!(d0 === Infinity || d0 - total >= SAPPER_SHORTCUT)) continue;
      const better = !best || (dig && !best.dig) || (dig === best.dig && total < best.total);
      if (better) best = { way: { kind: dig ? 'dig' : 'blast', at: { ...x } }, total, dig };
    }
  }
  return best?.way ?? null;
}

/** Carry out a planned way next to the member: dig (noise 4), set a charge (fuse 1), or disarm. Returns true when done. */
export function crewDoWay(c: Ctx, r: RivalX, way: CrewWay): boolean {
  if (!adjacentHex(r.at, way.at)) return false;
  faceToward(r, way.at);
  if (way.kind === 'disarm') {
    crewDisarm(c, r, way.at);
    return true;
  }
  if (way.kind === 'dig') {
    if (kindAt(c.w, c.d, way.at) !== 'cracked' && kindAt(c.w, c.d, way.at) !== 'rubble') return false;
    const rubble = digOut(c, way.at);
    tell(c, r, rubble ? `${r.name} digs through the rubble.` : `${r.name} breaks through the cracked wall.`, way.at);
    makeNoise(c, way.at, DIG_NOISE, { what: 'dig' });
    checkWays(c);
    return true;
  }
  if (crewCharges(r) <= 0 || fuseAt(c.d, way.at)) return false;
  spendCrewCharge(r);
  setFuse(c, way.at, 1, r.id);
  const what = kindAt(c.w, c.d, way.at) === 'door' ? 'the locked door' : 'the wall';
  tell(c, r, `${r.name} sets a charge on ${what} and steps clear. The fuse is lit.`, way.at);
  return true;
}

/** Walk the route, then the way at its end (if still there). Returns true when the member acted (the way). */
export function crewGo(c: Ctx, r: RivalX, route: CrewRoute): boolean {
  const stopped = crewWalk(c, r, route.path, route.sneak);
  if (stopped || r.hp <= 0 || r.goneOut) return true;
  return route.way ? crewDoWay(c, r, route.way) : false;
}
