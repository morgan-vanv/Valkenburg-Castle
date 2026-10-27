// V4.1 (WS7, spec 31.9): crews as an equal power (owner, 2026-10-26; design pillar 17). The second crew-parity pass,
// where it moves the balance: members spend Focus on key rolls (a likely kill, a finishing blow, a lone hero's dart),
// flank (+1 slot with a crewmate across the target, and they walk to flank), a crew Sellsword braces when two heroes
// are at its blade, members cure poison with an antipoison, crew mages cast the spells they lacked (Shadowmancer:
// Sleep on monsters, Dread and Night thorn on heroes; Hedgewitch: Briar; Pyromancer: Kindle for the hirer), a crew
// Ranger on a raised perch shoots at +10, a crew at peace keeps its distance from a stronger party, and a hostile crew that is losing badly calls the fight
// off. Every verb is named in the log when the party can see it. Pure rules: no DOM; dice through the seeded RNG.

import { distance, posNeighbors, samePos, type Pos } from './hex';
import type { HeroInDelve, Intent } from './types';
import {
  BRACE_CHANCE, BRACE_DMG, BRIAR_DMG, BRIAR_NOISE, BRIAR_RANGE, BRIAR_ROOT, BRIAR_ROOT_PERFECT, BRIAR_SLOTS, CLASSES, CREW_BRACE_HEROES, CREW_FOCUS, CREW_LOOKOUT,
  CREW_LOSING_SHARE, CREW_RAISED_BONUS, CREW_WARY_GAP, CREW_WARY_RATIO, DREAD_RANGE, DREAD_SLOTS, KINDLE_LIGHT, KINDLE_RANGE, NIGHTTHORN_DMG,
  NIGHTTHORN_RANGE, NIGHTTHORN_SLOTS, SLEEP_RANGE, STRENGTH_PER_LEVEL, STRENGTH_PER_POTION, CREW_HOLD_ROUNDS as HOLD_ROUNDS,
} from './data';
import { say, type Ctx, type HeroX, type RivalX } from './state';
import { occupant, activeHeroes, armorOf, clampChance, guardMods, hd, heroDef, heroName, hurtHero, makeNoise, noteOnce, onMap, rivalsOnMap, roll, rootFigure } from './common';
import { adjacentTo, blocked, wardOf, type Target } from './ai';
import { dijkstra, kindAt, los, pathTo, within, burning, isLightItem, roundsMax, roundsOf } from './world';
import { faceToward, fleePlan } from './stealth';
import { curePoison, isPoisoned } from './poison';
import { putToSleep } from './delve';
import { rivalStats } from './rivals';
import { belowHalf, manaOf, spellChance } from './crewai';
import { crewBudget, tell } from './crewmove';

/** The new crew verbs, shown as intents the round before (crewai.ts KIT lists the older ones). */
export const POWER_KIT: Intent['kind'][] = ['brace', 'sleep', 'dread', 'nightthorn', 'briar', 'antidote', 'kindle'];

// ---------------------------------------------------------------- Focus (key rolls)

/** Focus left: CREW_FOCUS for the delve, as a hero's FOCUS_MAX. Legacy members (no level) have none. */
export function crewFocus(r: RivalX): number {
  return r.level === undefined ? 0 : (r.focus ?? CREW_FOCUS);
}

/**
 * How much Focus a member spends on a roll of `slots` at `chance` against a target with `hp`, `perHit` damage a hit:
 * enough locked hits to down it outright when its Focus covers that (a sure kill), or all it has when that leaves one
 * hit to roll at 60%+. Otherwise none: the Focus waits for a key roll.
 */
export function keyFocus(r: RivalX, slots: number, chance: number, perHit: number, hp: number): number {
  const f = Math.min(crewFocus(r), slots);
  if (f <= 0 || perHit <= 0 || hp <= 0) return 0;
  const need = Math.ceil(hp / perHit);
  if (need > slots) return 0;
  if (need <= f) return need;
  if (need === f + 1 && chance >= 60) return f;
  return 0;
}

function spendFocus(r: RivalX, n: number): void {
  r.focus = Math.max(0, crewFocus(r) - n);
}

// ---------------------------------------------------------------- flanking and perches

/** The hex across `at` from `from` (where a flanker stands). */
function across(from: Pos, at: Pos): Pos {
  return { level: at.level, q: 2 * at.q - from.q, r: 2 * at.r - from.r };
}

/** A crewmate who is up (not feared) on the hex across the target from `from`: the flank (heroes' rule, spec 8.2). */
export function flankMate(c: Ctx, r: RivalX, target: Pos, from: Pos = r.at): RivalX | undefined {
  if (!adjacentTo(from, target)) return undefined;
  const x = across(from, target);
  return rivalsOnMap(c).find((m) => m !== r && samePos(m.at, x) && !((m.feared ?? 0) > 0));
}

/**
 * The walk's preference among attack spots (lower is better; added to crewai's exposure score): a melee member prefers a
 * hex with a crewmate across the target (it moves to flank); a Ranger prefers a raised perch (spec 31.7).
 */
export function powerPrefer(c: Ctx, r: RivalX, t: { at: Pos }, base?: (p: Pos) => number): (p: Pos) => number {
  const ranged = rivalStats(r).range > 1;
  return (p) => (base?.(p) ?? 0) + (!ranged && flankMate(c, r, t.at, p) ? -4 : 0) + (ranged && c.w.tile(p)?.raised ? -3 : 0) + spotCost(c, r, p);
}

const FOCUS_LABELS = /^(attack|shot|sneak attack|backstab|finishing blow|firebolt)/i;

/**
 * V4.1 (WS7): what a crew member's strike on a hero gets by the heroes' rules before it rolls (ai.ts strikeDetailed):
 * +1 slot flanked (melee, a crewmate across), +10 from a raised perch (bow), and Focus on a key roll. Free swings and
 * overwatch get none of it (as a hero's). Null when the attacker isn't a level-built crew member.
 */
export function crewEdge(c: Ctx, attacker: string, h: HeroInDelve, slots: number, p: number, dmg: number, what: string): { slots: number; p: number; focus: number } | null {
  const r = rivalsOnMap(c).find((x) => x.id === attacker);
  if (!r || r.level === undefined || /free swing/i.test(what)) return null;
  const st = rivalStats(r);
  let s = slots;
  let q = p;
  const name = heroName(c, h.heroId);
  if (st.range === 1 && /^(attack|sneak attack|backstab|finishing blow)/i.test(what)) {
    const mate = flankMate(c, r, h.at);
    if (mate) {
      s += 1;
      tell(c, r, `${r.name} and ${mate.name} flank ${name}.`, h.at);
    }
  }
  if (st.range > 1 && /shot|overwatch/i.test(what) && c.w.tile(r.at)?.raised) q += CREW_RAISED_BONUS;
  let focus = 0;
  if (FOCUS_LABELS.test(what)) {
    const def = heroDef(c, h.heroId);
    const gm = guardMods(c, h, false);
    const perHit = def ? Math.max(0, Math.max(1, dmg - armorOf(def)) - wardOf(h) - gm.dmg) : 0;
    focus = keyFocus(r, s, clampChance(q + gm.chance), perHit, h.status === 'downed' ? 1 : h.hp);
    if (focus) {
      spendFocus(r, focus);
      tell(c, r, `${r.name} steadies for the kill on ${name} (Focus ${focus}).`, h.at);
    }
  }
  return { slots: s, p: q, focus };
}

// ---------------------------------------------------------------- reading the fight: a likely kill, fire, spacing

/** What a member could expect to deal a hero in one attack (slots × chance × damage after armor), for target choice. */
function expectedOn(r: RivalX, armor: number): number {
  const st = rivalStats(r);
  return st.slots * (clampChance(st.chance) / 100) * Math.max(1, st.dmg - armor);
}

/**
 * V4.1 (WS7): a hero the crew can likely down this round: the members who can reach them (walk + reach) would deal at
 * least their HP on average. The weakest such hero, or undefined.
 */
export function likelyKill(c: Ctx, ts: Target[], inReach: (r: RivalX, t: Target) => boolean): Target | undefined {
  const ms = rivalsOnMap(c).filter((m) => !((m.feared ?? 0) > 0));
  const kills = ts.filter((t) => t.hero && ms.filter((m) => inReach(m, t)).reduce((n, m) => n + expectedOn(m, t.armor), 0) >= t.hero.hp);
  return kills.sort((a, b) => a.hero!.hp - b.hero!.hp || (a.id < b.id ? -1 : 1))[0];
}

/** Rounds the members who can reach `t` would take to down them on average. */
export function roundsToDown(c: Ctx, t: Target, inReach: (r: RivalX, t: Target) => boolean): number {
  const per = rivalsOnMap(c).filter((m) => !((m.feared ?? 0) > 0) && inReach(m, t)).reduce((n, m) => n + expectedOn(m, t.armor), 0);
  return per > 0 ? (t.hero?.hp ?? 99) / per : 99;
}

/** The hero in `ts` the crew would down soonest. */
export function quickestKill(c: Ctx, ts: Target[], inReach: (r: RivalX, t: Target) => boolean): { t: Target; rounds: number } | undefined {
  let best: { t: Target; rounds: number } | undefined;
  for (const t of ts) {
    if (!t.hero) continue;
    const n = roundsToDown(c, t, inReach);
    if (!best || n < best.rounds || (n === best.rounds && t.id < best.t.id)) best = { t, rounds: n };
  }
  return best;
}

/** A hero mage who could drop a fireball on the crew now (a Pyromancer with 2 mana, up): the crew keeps apart. */
function fireThreat(c: Ctx): boolean {
  return activeHeroes(c).some((h) => h.mana >= 2 && heroDef(c, h.heroId)?.cls === 'pyromancer');
}

/** A member that fights from range: a Ranger with its bow, a mage with mana. */
export function standsOff(r: RivalX): boolean {
  return rivalStats(r).range > 1 || manaOf(r) > 0;
}

/**
 * V4.1 (WS7): the cost of standing at `p` for a member: fire on the hex; crowding a crewmate while a fireball threatens;
 * for a member that fights from range, every hero who could walk up and strike it there next turn.
 */
export function spotCost(c: Ctx, r: RivalX, p: Pos): number {
  let n = (c.d.burning?.[`${p.level}:${p.q},${p.r}`] ?? 0) > 0 ? 20 : 0;
  if (fireThreat(c)) n += 3 * rivalsOnMap(c).filter((m) => m !== r && distance(m.at, p) <= 1 && m.at.level === p.level).length;
  if (standsOff(r)) n += 4 * heroThreat(c, p);
  return n;
}

/**
 * V4.1 (WS7, spec 31.9): move, then cast, as a hero mage does. A member with ranged kit (a mage with mana, a Burglar with
 * darts) and nothing to use from where it stands looks over the hexes its walk reaches: from the cheapest (spotCost: out
 * of the party's melee reach first) where `kit` finds a use, it shows that use, and walks there first (`r.castPath`).
 */
export function castPlan(c: Ctx, r: RivalX, kit: (from: Pos) => Intent | null): { intent: Intent; path: Pos[] } | null {
  if ((r.stuck ?? 0) > 0) return null;
  const ranged = manaOf(r) > 0 || (r.cls === 'burglar' && r.pack?.some((i) => i.kind === 'dart' || i.kind === 'venomdart'));
  if (!ranged) return null;
  const nodes = dijkstra(c.w, c.d, r.at, { enter: (p) => !blocked(c, p, r.id), stairs: false, budget: crewBudget(r, false) });
  const cands = [...nodes.values()]
    .filter((n) => !samePos(n.p, r.at) && !occupant(c, n.p) && kindAt(c.w, c.d, n.p) !== 'door')
    .map((n) => ({ n, score: spotCost(c, r, n.p) * 10 + n.cost }))
    .sort((a, b) => a.score - b.score || (a.n.p.q - b.n.p.q) || (a.n.p.r - b.n.p.r));
  for (const { n } of cands) {
    const it = kit(n.p);
    if (it) return { intent: it, path: pathTo(nodes, n.p) };
  }
  return null;
}

/** How far each new or older kit verb reaches a hero from (for stepping back before casting). */
const KIT_REACH: Partial<Record<Intent['kind'], number>> = {
  nightthorn: NIGHTTHORN_RANGE, dread: DREAD_RANGE, firebolt: 5, dart: 5, venomdart: 5, briar: BRIAR_RANGE, sleep: SLEEP_RANGE, mend: 3, ward: 3, veil: 3, smoke: 4, glue: 4,
};

/**
 * V4.1 (WS7, spec 31.9): a member that fights from range moves and acts as a hero does: before a spell or a dart at a hero,
 * it steps (a walk, not a dash) to a hex out of the party's melee reach that still has the target in range and sight.
 * Sets `r.kiteTo` (the path's end) and returns the path, or [] to act from where it stands.
 */
export function kiteFor(c: Ctx, r: RivalX, it: Intent): Pos[] {
  const n = KIT_REACH[it.kind];
  // The hex the use is aimed at: a hero, a crewmate, a monster, or the thrown item's hex.
  const aim = (it.targetId ? (hd(c, it.targetId)?.at ?? rivalsOnMap(c).find((m) => m.id === it.targetId)?.at ?? onMap(c).find((m) => m.id === it.targetId)?.at) : undefined) ?? it.to;
  const h = aim ? { at: aim } : undefined;
  if (!n || !h || (r.stuck ?? 0) > 0 || spotCost(c, r, r.at) <= 0 || (it.targetId === r.id)) return [];
  const here = spotCost(c, r, r.at);
  const nodes = dijkstra(c.w, c.d, r.at, { enter: (p) => !blocked(c, p, r.id), stairs: false, budget: crewBudget(r, false) });
  let best: { p: Pos; cost: number; score: number } | null = null;
  for (const nd of nodes.values()) {
    const p = nd.p;
    if (samePos(p, r.at) || occupant(c, p) || kindAt(c.w, c.d, p) === 'door') continue;
    if (!within(p, h.at, n) || !los(c.w, c.d, p, h.at)) continue;
    const score = spotCost(c, r, p);
    if (score >= here) continue;
    if (!best || score < best.score || (score === best.score && nd.cost < best.cost)) best = { p, cost: nd.cost, score };
  }
  return best ? pathTo(nodes, best.p) : [];
}

/** Heroes who are up that could strike `p` next turn: walk (Burglar 5) + 1 for melee, bow range + walk for a Ranger. */
export function heroThreat(c: Ctx, p: Pos): number {
  let n = 0;
  for (const h of activeHeroes(c)) {
    if (h.at.level !== p.level || (h as HeroX).dozing) continue;
    const def = heroDef(c, h.heroId);
    if (!def) continue;
    const w = CLASSES[def.cls].weapon;
    const walk = def.cls === 'burglar' ? 5 : 4;
    if (!w.range && distance(h.at, p) <= walk + 1) n++;
  }
  return n;
}

/**
 * V4.1 (WS7): don't go in piecemeal. A member that can't strike this round stops its walk before a hex two heroes or more
 * could close on next turn (it holds at the edge for its crewmates and lets the party come to it), for HOLD_ROUNDS rounds
 * of the fight; then it goes in. Already in that reach, or with nobody holding back, the walk stands.
 */
export function holdBack(c: Ctx, r: RivalX, path: Pos[]): Pos[] {
  const cr = c.d.rivals;
  if (!cr || cr.stance !== 'hostile' || (cr.held ?? 0) >= HOLD_ROUNDS || heroThreat(c, r.at) >= 2) return path;
  const cut = path.findIndex((p) => heroThreat(c, p) >= 2);
  if (cut < 0) return path;
  cr.holding = c.d.round;
  return path.slice(0, cut);
}

/** Count a round the crew held back (once a round). */
export function heldRound(c: Ctx): void {
  const cr = c.d.rivals;
  if (cr && cr.holding === c.d.round) cr.held = (cr.held ?? 0) + 1;
}

// ---------------------------------------------------------------- strength: wariness and retreat

function potions(pack: { kind: string }[] | undefined): number {
  return (pack ?? []).filter((i) => i.kind === 'potion' || i.kind === 'greaterpotion').length;
}

/** The party's strength: per hero who is up, HP + 4 a level + 3 a potion carried. */
export function partyStrength(c: Ctx): number {
  let n = 0;
  for (const h of activeHeroes(c)) {
    if ((h as HeroX).dozing) continue;
    n += h.hp + STRENGTH_PER_LEVEL * (heroDef(c, h.heroId)?.level ?? 1) + STRENGTH_PER_POTION * potions(h.pack);
  }
  return n;
}

/** The crew's strength by the same sum (members who are up). */
export function crewStrength(c: Ctx): number {
  return rivalsOnMap(c).reduce((n, r) => n + r.hp + STRENGTH_PER_LEVEL * (r.level ?? 1) + STRENGTH_PER_POTION * potions(r.pack), 0);
}

/** Members down, dead or gone, as a share of the crew. */
function lostShare(c: Ctx): number {
  const cr = c.d.rivals;
  if (!cr || !cr.members.length) return 0;
  const lost = cr.members.filter((m) => m.goneOut || m.hp <= 0 || m.downed).length;
  return lost / cr.members.length;
}

/** A hostile crew with half its members down, dead or gone: it takes a truce or a leave for nothing (parley.ts). */
export function crewBeaten(c: Ctx): boolean {
  return c.d.rivals?.stance === 'hostile' && lostShare(c) >= CREW_LOSING_SHARE;
}

/**
 * A hostile crew losing badly (half down, dead or gone, and the party now the stronger) calls the fight off, once: a truce,
 * the way out, carrying their own. Not while a member carries off a hero. Attack them after and they fight to the last.
 */
export function crewRetreat(c: Ctx): boolean {
  const cr = c.d.rivals;
  if (!cr || cr.stance !== 'hostile' || cr.retreat !== undefined || !crewBeaten(c)) return false;
  if (rivalsOnMap(c).some((r) => r.dragging)) return false; // carrying off a hero: they have what they came for
  if (!rivalsOnMap(c).length || crewStrength(c) >= partyStrength(c)) return false;
  cr.retreat = c.d.round;
  cr.stance = 'truce';
  cr.goal = 'leave';
  cr.toll = undefined;
  cr.target = undefined;
  for (const r of rivalsOnMap(c)) {
    r.overwatch = false;
    r.intent = undefined;
  }
  c.ev.push({ type: 'rivalsStance', stance: 'truce' });
  const lead = rivalsOnMap(c)[0]!;
  say(c, `"Enough!" ${lead.name} lowers their blade. ${cr.name} call the fight off and fall back toward the way out with their own. Strike them now and they fight to the last.`);
  noteOnce(c, `${cr.name} called the fight off when it turned against them.`);
  return true;
}

/** A crew at peace (prospectors, or under a truce) that sees a party clearly stronger than itself: it keeps its distance. */
export function crewWary(c: Ctx): boolean {
  const cr = c.d.rivals;
  if (!cr || cr.temperament !== 'prospector' || (cr.stance !== 'neutral' && cr.stance !== 'truce')) return false;
  if (partyStrength(c) <= crewStrength(c) * CREW_WARY_RATIO) return false;
  return rivalsOnMap(c).some((r) => activeHeroes(c).some((h) => h.at.level === r.at.level && within(h.at, r.at, CREW_LOOKOUT) && los(c.w, c.d, r.at, h.at)));
}

/** Too close to a hero for a wary crew. */
export function nearHero(c: Ctx, p: Pos): boolean {
  return activeHeroes(c).some((h) => h.at.level === p.level && distance(h.at, p) <= CREW_WARY_GAP);
}

/** A wary member with a hero within CREW_WARY_GAP steps away (the flee plan from the nearest hero), named once. */
export function waryStep(c: Ctx, r: RivalX): { to: Pos; path: Pos[] } | null {
  if (!crewWary(c) || !nearHero(c, r.at)) return null;
  const f = fleePlan(c, r, rivalStats(r).move);
  return f.path.length ? f : null;
}

export function noteWary(c: Ctx): void {
  const cr = c.d.rivals;
  if (!cr || cr.wary) return;
  cr.wary = true;
  say(c, `${cr.name} take your measure and keep their distance.`);
}

// ---------------------------------------------------------------- the new kit

function heroesSeen(c: Ctx, r: RivalX, n: number): HeroInDelve[] {
  return activeHeroes(c)
    .filter((h) => h.veil <= 0 && h.at.level === r.at.level && within(h.at, r.at, n) && los(c.w, c.d, r.at, h.at))
    .sort((a, b) => distance(a.at, r.at) - distance(b.at, r.at) || (a.heroId < b.heroId ? -1 : 1));
}

/** Antipoison: a poisoned member (itself, or a crewmate next to it) below half, or with no hero at its side. */
function antidoteIntent(c: Ctx, r: RivalX): Intent | null {
  if (!r.pack?.some((i) => i.kind === 'antidote')) return null;
  const pressed = activeHeroes(c).some((h) => adjacentTo(h.at, r.at));
  const sick = [r, ...rivalsOnMap(c).filter((m) => m !== r && adjacentTo(m.at, r.at))].find((m) => isPoisoned(m) && (belowHalf(m) || !pressed));
  return sick ? { kind: 'antidote', item: 'antidote', targetId: sick.id } : null;
}

/** A crew Sellsword with two heroes who are up at its blade braces (the heroes' Brace). */
function braceIntent(c: Ctx, r: RivalX): Intent | null {
  if (r.cls !== 'sellsword' || r.braced) return null;
  const n = activeHeroes(c).filter((h) => !(h as HeroX).dozing && adjacentTo(h.at, r.at)).length;
  return n >= CREW_BRACE_HEROES ? { kind: 'brace', targetId: r.id } : null;
}

/**
 * Sleep (Shadowmancer, 1 mana, monsters only, as the heroes'): an awake monster in sight within 5 that hunts a member
 * within 3, or, at peace, one within 3 of the crew that isn't hunting yet (the sister putting the orc to sleep to pass).
 */
function sleepIntent(c: Ctx, r: RivalX): Intent | null {
  if (r.cls !== 'shadowmancer' || manaOf(r) < 1) return null;
  const peace = c.d.rivals?.stance !== 'hostile';
  const crew = rivalsOnMap(c);
  const m = onMap(c)
    .filter((x) => x.kind !== 'gloam' && x.kind !== 'dragon' && x.awareness !== 'asleep' && x.at.level === r.at.level && within(x.at, r.at, SLEEP_RANGE) && los(c.w, c.d, r.at, x.at))
    .filter((x) => crew.some((k) => within(k.at, x.at, 3)) && (x.awareness === 'hunting' ? crew.some((k) => (x.noticedIds ?? []).includes(k.id)) : peace))
    .sort((a, b) => distance(a.at, r.at) - distance(b.at, r.at) || (a.id < b.id ? -1 : 1))[0];
  return m ? { kind: 'sleep', targetId: m.id, to: { ...m.at } } : null;
}

/**
 * Dread (Shadowmancer, 1 mana, 2 Wits slots at range 5): a hero standing over a crewmate below half (or a downed one),
 * else a hero at the blades of two members. A hit grips them: no action in their next turn (moving is fine).
 */
function dreadIntent(c: Ctx, r: RivalX): Intent | null {
  if (r.cls !== 'shadowmancer' || manaOf(r) < 1) return null;
  const crew = c.d.rivals!.members.filter((m) => !m.goneOut && (m.hp > 0 || m.downed));
  const seen = heroesSeen(c, r, DREAD_RANGE).filter((h) => (h.dreaded ?? 0) <= c.d.round);
  const t = seen.find((h) => crew.some((m) => m !== r && adjacentTo(m.at, h.at) && (m.downed || belowHalf(m))))
    ?? seen.find((h) => crew.filter((m) => m.hp > 0 && adjacentTo(m.at, h.at)).length >= 2);
  return t ? { kind: 'dread', targetId: t.heroId } : null;
}

/** Night thorn (Shadowmancer, 1 mana, 2 Wits slots at range 5, 1 a hit, armor ignored): the crew's target in reach, else the weakest in sight. */
function thornIntent(c: Ctx, r: RivalX, t: Target | null): Intent | null {
  if (r.cls !== 'shadowmancer' || manaOf(r) < 1) return null;
  const seen = heroesSeen(c, r, NIGHTTHORN_RANGE);
  const x = (t && seen.find((h) => h.heroId === t.id)) ?? [...seen].sort((a, b) => a.hp - b.hp || (a.heroId < b.heroId ? -1 : 1))[0];
  return x ? { kind: 'nightthorn', targetId: x.heroId, damage: [0, NIGHTTHORN_SLOTS * NIGHTTHORN_DMG + 1] } : null;
}

/** Briar (Hedgewitch, 1 mana, 2 Wits slots at range 4): a melee hero closing in (not yet at a member's side, within 4 of one), not rooted. */
function briarIntent(c: Ctx, r: RivalX): Intent | null {
  if (r.cls !== 'hedgewitch' || manaOf(r) < 1) return null;
  const crew = rivalsOnMap(c);
  const x = heroesSeen(c, r, BRIAR_RANGE).find((h) => {
    const def = heroDef(c, h.heroId);
    if (!def || CLASSES[def.cls].weapon.range || (h.rooted ?? 0) > 0) return false;
    return !crew.some((m) => adjacentTo(m.at, h.at)) && crew.some((m) => distance(m.at, h.at) <= 4);
  });
  return x ? { kind: 'briar', targetId: x.heroId, damage: [0, 2 * BRIAR_DMG + 1] } : null;
}

/** Kindle (a hired Pyromancer, 1 mana): an unlit torch or lantern with rounds left, or one burning low (3 or less), held by a hero within 3. */
function kindleIntent(c: Ctx, r: RivalX): Intent | null {
  if (r.cls !== 'pyromancer' || manaOf(r) < 1 || c.d.rivals?.stance !== 'hired') return null;
  for (const h of activeHeroes(c)) {
    if (h.at.level !== r.at.level || distance(h.at, r.at) > KINDLE_RANGE) continue;
    if (h.pack.some((i) => isLightItem(i) && burning(i) && roundsOf(i) > 3)) continue;
    const it = h.pack.find((i) => isLightItem(i) && (burning(i) ? roundsOf(i) < roundsMax(i) : i.kind === 'lantern' || roundsOf(i) > 0));
    if (it) return { kind: 'kindle', targetId: h.heroId, item: it.kind };
  }
  return null;
}

/** A hostile member's new kit by class (crewai.ts kitIntent asks here after the potion). */
export function powerKit(c: Ctx, r: RivalX, t: Target | null, slot: 'first' | 'class'): Intent | null {
  if (slot === 'first') return antidoteIntent(c, r);
  switch (r.cls) {
    case 'sellsword':
      return braceIntent(c, r);
    case 'shadowmancer':
      return sleepIntent(c, r) ?? dreadIntent(c, r) ?? thornIntent(c, r, t);
    case 'hedgewitch':
      return briarIntent(c, r);
  }
  return null;
}

/** A member at peace or hired (rivals.ts planRival asks here first): an antipoison, a Sleep on a monster, a hired Pyromancer's Kindle. */
export function powerPlan(c: Ctx, r: RivalX): Intent | null {
  if (c.d.rivals?.stance === 'hostile') return null;
  return antidoteIntent(c, r) ?? sleepIntent(c, r) ?? kindleIntent(c, r);
}

/** Carry out one of the new verbs as shown. Returns true if it used the member's turn. */
export function powerAct(c: Ctx, r: RivalX, it: Intent): boolean {
  const h = it.targetId ? (hd(c, it.targetId) as HeroX | undefined) : undefined;
  switch (it.kind) {
    case 'antidote': {
      const m = rivalsOnMap(c).find((x) => x.id === it.targetId);
      const i = r.pack?.findIndex((x) => x.kind === 'antidote') ?? -1;
      if (!m || i < 0 || !isPoisoned(m) || (m !== r && !adjacentTo(m.at, r.at))) return false;
      r.pack!.splice(i, 1);
      curePoison(c, m.id, 'antidote', r.id);
      c.ev.push({ type: 'cast', by: r.id, spell: 'antidote', targetId: m.id });
      tell(c, r, m === r ? `${r.name} drinks an antipoison.` : `${r.name} gives ${m.name} an antipoison.`);
      return true;
    }
    case 'brace': {
      if (r.cls !== 'sellsword') return false;
      r.braced = true;
      c.ev.push({ type: 'braced', id: r.id });
      tell(c, r, `${r.name} sets their feet and braces.`);
      return true;
    }
    case 'sleep': {
      const m = c.d.monsters.find((x) => x.id === it.targetId);
      if (!m || manaOf(r) < 1 || m.awareness === 'asleep' || !within(m.at, r.at, SLEEP_RANGE) || !los(c.w, c.d, r.at, m.at)) return false;
      r.charges = manaOf(r) - 1;
      faceToward(r, m.at);
      c.ev.push({ type: 'cast', by: r.id, spell: 'sleep', targetId: m.id, at: { ...m.at } });
      tell(c, r, `${r.name} whispers ${m.name} to sleep.`, m.at);
      const rr = roll(c, r.id, 'Sleep', 2, spellChance(r));
      if (rr.hits) putToSleep(c, m);
      else c.ev.push({ type: 'miss', attacker: r.id, target: m.id });
      return true;
    }
    case 'dread': {
      if (!h || h.status !== 'active' || manaOf(r) < 1 || !within(h.at, r.at, DREAD_RANGE) || !los(c.w, c.d, r.at, h.at)) return false;
      r.charges = manaOf(r) - 1;
      faceToward(r, h.at);
      c.ev.push({ type: 'cast', by: r.id, spell: 'dread', targetId: h.heroId, at: { ...h.at } });
      const rr = roll(c, r.id, 'Dread', DREAD_SLOTS, spellChance(r) + guardMods(c, h, false).chance);
      if (!rr.hits) {
        c.ev.push({ type: 'miss', attacker: r.id, target: h.heroId });
        say(c, `${heroName(c, h.heroId)} shrugs off ${r.name}'s dread.`);
        return true;
      }
      h.dreaded = c.d.round + 1;
      c.ev.push({ type: 'feared', id: h.heroId, by: r.id });
      say(c, `${r.name} fills ${heroName(c, h.heroId)} with dread: no action next turn.`);
      return true;
    }
    case 'nightthorn': {
      if (!h || h.status !== 'active' || manaOf(r) < 1 || !within(h.at, r.at, NIGHTTHORN_RANGE) || !los(c.w, c.d, r.at, h.at)) return false;
      r.charges = manaOf(r) - 1;
      faceToward(r, h.at);
      c.ev.push({ type: 'cast', by: r.id, spell: 'nightthorn', targetId: h.heroId, at: { ...h.at } });
      say(c, `${r.name} looses a night thorn at ${heroName(c, h.heroId)}.`);
      const gm = guardMods(c, h, false);
      const per = Math.max(0, NIGHTTHORN_DMG - wardOf(h) - gm.dmg);
      const p = spellChance(r) + gm.chance;
      const f = keyFocus(r, NIGHTTHORN_SLOTS, clampChance(p), per, h.hp);
      if (f) {
        spendFocus(r, f);
        tell(c, r, `${r.name} steadies for the kill on ${heroName(c, h.heroId)} (Focus ${f}).`, h.at);
      }
      const rr = roll(c, r.id, 'Night thorn', NIGHTTHORN_SLOTS, p, f);
      if (!rr.hits) {
        c.ev.push({ type: 'miss', attacker: r.id, target: h.heroId });
        return true;
      }
      const dmg = rr.hits * per + (rr.perfect ? 1 : 0);
      if (dmg > 0) hurtHero(c, h, dmg, r.id, rr.perfect);
      return true;
    }
    case 'briar': {
      if (!h || h.status !== 'active' || manaOf(r) < 1 || !within(h.at, r.at, BRIAR_RANGE) || !los(c.w, c.d, r.at, h.at)) return false;
      r.charges = manaOf(r) - 1;
      faceToward(r, h.at);
      c.ev.push({ type: 'cast', by: r.id, spell: 'briar', targetId: h.heroId, at: { ...h.at } });
      makeNoise(c, r.at, BRIAR_NOISE, { what: 'clash' });
      say(c, `${r.name} calls up briars round ${heroName(c, h.heroId)}'s feet.`);
      const gm = guardMods(c, h, false);
      const rr = roll(c, r.id, 'Briar', BRIAR_SLOTS, spellChance(r) + gm.chance);
      if (!rr.hits) {
        c.ev.push({ type: 'miss', attacker: r.id, target: h.heroId });
        return true;
      }
      const dmg = rr.hits * Math.max(0, BRIAR_DMG - wardOf(h) - gm.dmg) + (rr.perfect ? 1 : 0);
      if (dmg > 0) hurtHero(c, h, dmg, r.id, rr.perfect);
      if (h.status === 'active') rootFigure(c, h.heroId, rr.perfect ? BRIAR_ROOT_PERFECT : BRIAR_ROOT, r.id);
      return true;
    }
    case 'kindle': {
      if (!h || manaOf(r) < 1 || distance(h.at, r.at) > KINDLE_RANGE) return false;
      const i = h.pack.find((x) => isLightItem(x) && x.kind === it.item && (burning(x) ? roundsOf(x) < roundsMax(x) : x.kind === 'lantern' || roundsOf(x) > 0));
      if (!i) return false;
      r.charges = manaOf(r) - 1;
      if (burning(i)) i.rounds = Math.min(roundsMax(i), roundsOf(i) + KINDLE_LIGHT);
      else {
        i.rounds = roundsOf(i) <= 0 ? KINDLE_LIGHT : roundsOf(i);
        i.lit = true;
      }
      c.visCache = undefined;
      c.ev.push({ type: 'cast', by: r.id, spell: 'kindle', targetId: h.heroId });
      say(c, `${r.name} kindles ${heroName(c, h.heroId)}'s ${i.kind}: ${i.rounds} rounds.`);
      return true;
    }
  }
  return false;
}

/** V4.1 (WS7): a hero a crew Shadowmancer's Dread holds this player phase: no action (moving is fine), no free swings. */
export function dreadedNow(c: Ctx, h: HeroInDelve): boolean {
  return (h.dreaded ?? 0) === c.d.round && c.d.phase === 'player';
}

/** V4.1 (WS7): a braced crew Sellsword: hits on it do 1 less and roll −15 (the heroes' Brace, BRACE_DMG / BRACE_CHANCE). */
export function crewBraceMods(r: { braced?: boolean } | undefined): { dmg: number; chance: number } {
  return r?.braced ? { dmg: BRACE_DMG, chance: BRACE_CHANCE } : { dmg: 0, chance: 0 };
}

void posNeighbors;
