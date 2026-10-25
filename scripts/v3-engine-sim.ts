// Headless balance check for V3: a plain bot plays N delves through the public
// engine API on the real castle (or the test castle with CASTLE=test).
// Run: npx tsx scripts/v3-engine-sim.ts [delves=20]   (SEED=n, VERBOSE=1, CASTLE=test, EVENTS=1, TRACE=<delve#>)
// DRAGON=1: every delve takes the slay contract with a full, healed party (reputation forced to 3),
// to see whether a Dragon run stretches the lantern.
//
// Getting down: the bot walks (stairs, and the lift once worked). If the goal is
// out of walking reach it goes to the winch and works it, or failing that jumps
// down a pit column that lands closer.
//
// V3.2: a campaign starts with Keven alone (V3.4: 120 gold, hires 60 + 40 a level); the bot hires 2 to 3 recruits at the
// tavern (a front-liner first, then a quiet one, then a mage), re-hiring when the roster thins.
// Heroes dash (second move) toward the goal when nothing is in reach to hit.
//
// V3.3: the lantern holds 20 and can be shuttered. The bot shutters on Level 1 whenever the
// bearer stands in fixed light (daylight, sconces), opens it otherwise and on Levels 2 and 3,
// buys an oil flask for Level 3 contracts and drinks it when the lantern runs low, and breaks
// free when a ghoul holds a hero. Per level it prints contracts done, deaths, world phases with a
// hero in the dark on Level 3, and Gloam strikes.
//
// V3.5 (spec 18): Keven camps in Lowgate. The bot takes the surgeon story contract first and other
// story contracts when they come up (every other delve), drinks stash potions when hurt while there
// is no surgeon, heals at the infirmary once Brother Aldric is home, buys an ale for Keven once the
// copper is home, pays a cutthroat toll when it can afford it and otherwise fights. Per delve it
// prints the crew and how it ended, and the village at the end.
//
// V3.7 (spec 20.3): a Sapper in the party sets a charge (fuse 1) on a locked door or a breakable
// wall next to them when blowing it saves 6+ hexes of walking to the goal; heroes keep out of
// lit fuses' blast areas. SAPPER=1 hires a Sapper first. The report prints fuses lit, blasts,
// walls broken and locks blown.
//
// The bot is simple: the party walks toward the objective together, hits
// what's adjacent, takes what's near, grabs the objective, then heads for the
// nearest exit. It shows what a careless player banks, not what a good one can.

import { createEngine } from '../src/game/engine';
import { testCastle } from '../src/game/test/testCastle';
import { castle as realCastle } from '../src/data/castle';
import { posKey, samePos, type Pos } from '../src/game/hex';
import type { ActionKind, ActionTarget, Command, GameState, HeroInDelve } from '../src/game/types';
import { World, distField, fallColumn, fixedLit, kindAt, litSet } from '../src/game/world';
import { posNeighbors } from '../src/game/hex';
import type { DelveX } from '../src/game/state';
import { makeHero } from '../src/game/camp';
import { breakableWall } from '../src/game/charges';

const N = Number(process.argv[2] ?? 20);
const SEED = Number(process.env.SEED ?? 1);
const VERBOSE = process.env.VERBOSE === '1';
const castle = process.env.CASTLE === 'test' ? testCastle : realCastle;
const e = createEngine(castle);
const w = new World(castle);
const ROUND_CAP = 80;
/** The bot heads out when the lantern gets this low (it holds 20 since V3.3). */
const LOW_LIGHT = 5;
/** Heroes keep within this many hexes of the lantern bearer (a careless player still stays in the light). */
const COHESION = 3;
const TRACE = Number(process.env.TRACE ?? 0);
const DRAGON = process.env.DRAGON === '1';
const SAPPER = process.env.SAPPER === '1';
const sap = { fuses: 0, blasts: 0, walls: 0, locks: 0, selfHits: 0, friendHits: 0, kills: 0 };
const sapLog: string[] = [];
const pits: Pos[] = [];
for (const l of castle.levels) for (const k of Object.keys(l.tiles)) {
  const [q, r] = k.split(',').map(Number) as [number, number];
  if (l.tiles[k]!.kind === 'pit') pits.push({ level: l.level, q, r });
}

let errors = 0;
const refusals: Record<string, number> = {};
const evCount: Record<string, number> = {};
let gloamStrikes = 0;
function run(s: GameState, cmd: Command): GameState {
  const r = e.apply(s, cmd);
  const gloamId = s.delve?.monsters.find((m) => m.kind === 'gloam')?.id;
  for (const ev of r.events) {
    const key = ev.type === 'hit' ? (ev.target.startsWith('m') || ev.target.startsWith('r') ? 'hit:monster' : 'hit:hero') : ev.type === 'awake' ? `awake:${ev.awareness}` : ev.type;
    evCount[key] = (evCount[key] ?? 0) + 1;
    if (ev.type === 'hit' && (ev.attacker === gloamId || r.state.delve?.monsters.find((m) => m.id === ev.attacker)?.kind === 'gloam')) gloamStrikes++;
    // V3.7 (spec 20.3): the Sapper's work.
    if (ev.type === 'fuseSet' && s.delve?.heroes.some((h) => h.heroId === ev.by)) sap.fuses++;
    if (ev.type === 'blast' && 'by' in ev && s.delve?.heroes.some((h) => h.heroId === ev.by)) {
      sap.blasts++;
      sap.walls += ev.broke.length;
      const doorsOpened = r.events.filter((x) => x.type === 'doorChanged' && x.open && s.delve!.doors[posKey(x.at)]?.locked).length;
      const chestsOpened = r.events.filter((x) => x.type === 'chestOpened' && s.delve!.chests.find((c) => c.id === x.id)?.locked).length;
      sap.locks += doorsOpened + chestsOpened;
      const hits = r.events.filter((x) => x.type === 'hit' && x.attacker === 'blast');
      sap.friendHits += hits.filter((x) => x.type === 'hit' && s.delve!.heroes.some((h) => h.heroId === x.target)).length;
      sap.kills += r.events.filter((x) => x.type === 'monsterDied').length;
      sapLog.push(`L${ev.at.level} ${w.roomName(ev.at)}: ${ev.broke.length} wall(s)${doorsOpened + chestsOpened ? `, ${doorsOpened + chestsOpened} lock(s)` : ''}`);
      if (VERBOSE) console.log(`  BOOM at L${ev.at.level} ${w.roomName(ev.at)}: broke ${ev.broke.length} wall(s), opened ${doorsOpened + chestsOpened} lock(s)`);
    }
  }
  if (r.error) {
    errors++;
    refusals[`${cmd.type}: ${r.error}`] = (refusals[`${cmd.type}: ${r.error}`] ?? 0) + 1;
    if (VERBOSE) console.log('  refused:', cmd.type, r.error);
    return s;
  }
  return r.state;
}

function act(s: GameState, heroId: string, action: ActionKind, target: ActionTarget, focus = 0): GameState {
  return run(s, { type: 'act', heroId, action, target, focus });
}

function option(s: GameState, heroId: string, a: ActionKind) {
  const o = e.actions(s, heroId).find((o) => o.action === a);
  return o && !o.blocked ? o : undefined;
}

const FRONT = SAPPER ? ['sapper', 'sellsword'] : ['sellsword', 'sapper'];
const QUIET = ['burglar', 'ranger'];
const MAGES = ['pyromancer', 'hedgewitch', 'shadowmancer'];
const hired: Record<string, number> = {};

/** Hire up to `want` recruits the stash can pay for, one of each role first. */
function recruit(s: GameState, want: number): GameState {
  const roles = [FRONT, QUIET, MAGES, FRONT, QUIET, MAGES];
  while (s.campaign.roster.length < want) {
    const have = s.campaign.roster.map((h) => h.cls as string);
    const role = roles.find((r) => !have.some((c) => r.includes(c))) ?? [...FRONT, ...QUIET, ...MAGES];
    // SAPPER=1: make sure the tavern has a Sapper on offer while the roster has none.
    if (SAPPER && !have.includes('sapper') && !s.campaign.recruits.some((r) => r.hero.cls === 'sapper')) {
      s.campaign.recruits.push({ hero: makeHero(`sap${s.campaign.delveCount}`, 'Sam Sapper', 'sapper'), price: 60 });
    }
    const pool = s.campaign.recruits.filter((r) => r.price <= s.campaign.gold);
    const pick = role.map((cls) => pool.find((r) => r.hero.cls === cls)).find(Boolean) ?? pool.sort((a, b) => a.price - b.price)[0];
    if (!pick) break;
    const before = s;
    s = run(s, { type: 'hire', heroId: pick.hero.id });
    if (s === before) break;
    hired[pick.hero.cls] = (hired[pick.hero.cls] ?? 0) + 1;
    if (VERBOSE) console.log(`  hired ${pick.hero.name} the ${pick.hero.cls} for ${pick.price}`);
  }
  return s;
}

function objectiveDone(s: GameState): boolean {
  const d = s.delve!;
  if (d.contract.kind === 'slay') return !d.monsters.some((m) => m.kind === 'dragon');
  if (d.contract.kind === 'rescue') return !!d.prisoner?.freed && !!d.prisoner.escortedBy;
  return d.heroes.some((h) => h.pack.some((i) => i.kind === 'heirloom'));
}

function objectiveFailed(s: GameState): boolean {
  const d = s.delve!;
  if (d.contract.kind === 'slay') return false;
  if (d.contract.kind === 'rescue') return !!d.prisoner?.dead;
  const onGround = d.ground.some((g) => g.items.some((i) => i.kind === 'heirloom'));
  return !onGround && !objectiveDone(s) && !d.monsters.some((m) => m.stolen?.kind === 'heirloom');
}

function goalFor(s: GameState): Pos[] {
  const d = s.delve!;
  const leaving = objectiveDone(s) || objectiveFailed(s) || d.light < LOW_LIGHT || d.round > 50;
  if (leaving) return w.exits;
  if (d.contract.kind === 'slay') {
    const dr = d.monsters.find((m) => m.kind === 'dragon');
    return dr ? posNeighbors(dr.at) : w.exits;
  }
  if (d.contract.kind === 'rescue') return [d.prisoner!.at];
  const g = d.ground.find((x) => x.items.some((i) => i.kind === 'heirloom'));
  return g ? [g.at] : w.exits;
}

/**
 * Goals for one hero: the contract goals if walkable from here; else the winch
 * (lift not yet working); else pit edges whose fall lands within walking reach of the goals.
 * `jump` lists pits worth jumping into.
 */
function routeFor(s: GameState, at: Pos): { goals: Pos[]; jump: Pos[]; winch: boolean } {
  const d = s.delve as DelveX;
  const goals = goalFor(s);
  const field = distField(w, d, goals, { stairs: true, allowLocked: true });
  if (field.has(posKey(at))) return { goals, jump: [], winch: false };
  if (!d.liftWorking && w.winches.length) {
    const wg = w.winches.flatMap((p) => posNeighbors(p));
    const wf = distField(w, d, wg, { stairs: true, allowLocked: true });
    if (wf.has(posKey(at))) return { goals: wg, jump: [], winch: true };
  }
  const good = pits.filter((p) => {
    const col = fallColumn(w, d, p);
    return col && field.has(posKey(col.to));
  });
  const edges = good.flatMap((p) => posNeighbors(p).filter((n) => kindAt(w, d, n) === 'floor'));
  return { goals: edges, jump: good, winch: false };
}

/**
 * Lantern discipline (spec 16.2): on Level 1 shutter while the bearer stands in fixed light
 * (daylight and sconces light most of the level), open otherwise; always open on Levels 2 and 3.
 */
function lanternCheck(s: GameState, id: string): GameState {
  const d = s.delve as DelveX;
  if (d.lanternBearer !== id) return s;
  const me = d.heroes.find((x) => x.heroId === id)!;
  const fixed = fixedLit(w, d);
  const wantOpen = me.at.level !== 1 || !fixed.has(posKey(me.at));
  if (wantOpen !== d.lanternOpen) {
    const o = option(s, id, 'shutter');
    if (o) s = act(s, id, 'shutter', o.targets[0]!);
  }
  return s;
}

/** Spec 18.6: pay a cutthroat toll when the party can afford it; fight when it can't. */
let crewLog: string[] = [];
function parleyCheck(s: GameState, id: string): GameState {
  const cr = s.delve?.rivals;
  if (!cr || cr.stance !== 'demanding') return s;
  let ds = e.deals(s, id);
  if (!ds.length) {
    // Out of parley range (4) of the crew that demanded from 6: step closer if the purse covers the toll.
    const me = s.delve!.heroes.find((h) => h.heroId === id)!;
    const carried = s.delve!.heroes.filter((h) => h.status === 'active').flatMap((h) => h.pack)
      .filter((i) => !i.story && (i.kind === 'gold' || i.kind === 'gem' || i.kind === 'jewelry')).reduce((n, i) => n + i.amount, 0);
    const lead = cr.members.find((r) => !r.goneOut && r.hp > 0);
    if (!lead || lead.at.level !== me.at.level || carried < (cr.toll ?? 0) || me.moved) return s;
    const hexDist = (a: Pos, b: Pos) => Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.q + a.r - b.q - b.r));
    const best = e.reachable(s, id, false).filter((r) => r.to.level === lead.at.level).sort((a, b) => hexDist(a.to, lead.at) - hexDist(b.to, lead.at))[0];
    if (!best || hexDist(best.to, lead.at) >= hexDist(me.at, lead.at)) return s;
    s = run(s, { type: 'move', heroId: id, path: best.path, sneak: false });
    if (s.stage !== 'delve') return s;
    ds = e.deals(s, id);
    if (!ds.length) return s;
  }
  const toll = ds.find((d) => d.deal === 'truce');
  if (toll?.ok) {
    crewLog.push(`paid toll ${toll.price}`);
    return run(s, { type: 'deal', heroId: id, deal: 'truce' });
  }
  const fight = ds.find((d) => d.deal === 'fight');
  if (fight?.ok) {
    crewLog.push(`refused toll ${toll?.price ?? '?'}`);
    return run(s, { type: 'deal', heroId: id, deal: 'fight' });
  }
  return s;
}

/** Hex distance. */
function hexDistance(a: Pos, b: Pos): number {
  return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.q + a.r - b.q - b.r));
}

/** Inside a lit fuse's blast area (same level, within 2)? */
function inBlast(d: DelveX, p: Pos): boolean {
  return (d.fuses ?? []).some((f) => f.at.level === p.level && hexDistance(f.at, p) <= 2);
}

/**
 * V3.7 (spec 20.3): a Sapper (or anyone carrying a bought charge) looks for a breakable wall or a
 * locked door within a few hexes whose breaching would save SAPPER_SAVE hexes or more on the walk
 * to the goal: walks up to it and sets a charge with fuse 1. Two distance fields do the sums:
 * F (hex -> goal, locks closed) and H (hex -> hero); a breach W between floor hexes a and b
 * costs H(a) + 2 + F(b).
 */
const SAPPER_SAVE = 6;
const SAPPER_LOOK = 7;
function sapperCheck(s: GameState, id: string): GameState {
  const d = s.delve as DelveX;
  const me = d.heroes.find((x) => x.heroId === id);
  if (!me || me.acted || me.webbed) return s;
  const def = e.heroById(s, id);
  const action: ActionKind = def?.cls === 'sapper' ? 'setCharge' : 'charge';
  if (!option(s, id, action) && !(action === 'setCharge' && me.pack.some((i) => i.kind === 'charge'))) return s;
  if (action === 'charge' && !me.pack.some((i) => i.kind === 'charge')) return s;
  const goals = routeFor(s, me.at).goals;
  const F = distField(w, d, goals, { stairs: true, allowLocked: false });
  const H = distField(w, d, [me.at], { stairs: true, allowLocked: false });
  const here = F.get(posKey(me.at)) ?? 999;
  let best: { at: Pos; from: Pos; save: number } | undefined;
  const lv = w.levels.get(me.at.level)!;
  for (const k of Object.keys(lv.tiles)) {
    const [q, r] = k.split(',').map(Number) as [number, number];
    const W = { level: me.at.level, q, r };
    if (hexDistance(W, me.at) > SAPPER_LOOK) continue;
    const kind = kindAt(w, d, W);
    const wall = kind === 'cracked' || breakableWall(w, d, W);
    const locked = kind === 'door' && !!d.doors[posKey(W)]?.locked && !d.doors[posKey(W)]?.open;
    if (!wall && !locked) continue;
    if ((d.fuses ?? []).some((f) => samePos(f.at, W))) continue;
    const around = posNeighbors(W).filter((p) => H.has(posKey(p)) || F.has(posKey(p)));
    for (const a of around) {
      const ha = H.get(posKey(a));
      if (ha === undefined) continue;
      for (const b of around) {
        const fb = F.get(posKey(b));
        if (fb === undefined || samePos(a, b)) continue;
        const save = here - (ha + (wall ? 2 : 1) + fb);
        if (save >= SAPPER_SAVE && (!best || save > best.save)) best = { at: W, from: a, save };
      }
    }
  }
  if (!best) return s;
  // Walk up to it if not there yet.
  if (!posNeighbors(best.at).some((p) => samePos(p, me.at))) {
    if (me.moved) return s;
    const tf = distField(w, d, posNeighbors(best.at).filter((p) => H.has(posKey(p))), { stairs: true, allowLocked: false });
    let pick: ReturnType<typeof e.reachable>[0] | undefined;
    let pd = tf.get(posKey(me.at)) ?? 999;
    for (const r of e.reachable(s, id, false)) {
      const dd = tf.get(posKey(r.to)) ?? 999;
      if (dd < pd) { pd = dd; pick = r; }
    }
    if (!pick) return s;
    s = run(s, { type: 'move', heroId: id, path: pick.path, sneak: false });
  }
  const o = option(s, id, action);
  const t = o?.targets.find((x) => x.at && samePos(x.at, best!.at) && (x.fuse ?? 1) === 1);
  if (!t) return s;
  const before = s;
  s = act(s, id, action, t);
  if (s !== before && VERBOSE) console.log(`  ${def?.name} sets a charge on the ${kindAt(w, d, best.at)} at L${best.at.level} ${w.roomName(best.at)} (saves ${best.save} hexes)`);
  return s;
}

/** V3.7 (spec 20.1): the bot sneaks when a sleeper lies within 4 of the hero on its level, otherwise walks. */
function nearSleeper(s: GameState, at: Pos): boolean {
  return s.delve!.monsters.some((m) => m.awareness === 'asleep' && !m.buried && m.kind !== 'dragon' && m.at.level === at.level
    && Math.max(Math.abs(m.at.q - at.q), Math.abs(m.at.r - at.r), Math.abs(m.at.q + m.at.r - at.q - at.r)) <= 4);
}
let sneakMoves = 0;
let walkMoves = 0;

function heroTurn(s: GameState, h: HeroInDelve): GameState {
  const id = h.heroId;
  s = parleyCheck(s, id);
  if (s.stage !== 'delve') return s;
  const hero = () => s.delve?.heroes.find((x) => x.heroId === id);
  const alive = () => s.stage === 'delve' && hero()?.status === 'active';
  const tryAct = (): boolean => {
    if (!alive() || hero()!.acted) return false;
    const me = hero()!;
    const def = e.heroById(s, id)!;
    // Kill what's in reach before picking anyone up: a hero revived under fire just goes down again.
    const order: ActionKind[] = ['escape', 'attack', 'firebolt', 'free', 'take', 'revive', 'mend', 'oil', 'kindle', 'open', 'pick', 'light', 'leave'];
    for (const a of order) {
      const o = option(s, id, a);
      if (!o) continue;
      if (a === 'leave' && !(objectiveDone(s) || objectiveFailed(s) || s.delve!.light < LOW_LIGHT || s.delve!.round > 50)) continue;
      if (a === 'mend' && !o.targets.some((t) => { const x = s.delve!.heroes.find((y) => y.heroId === t.id); return x && x.hp <= 3; })) continue;
      if (a === 'kindle' && (s.delve!.light > 14 || !s.delve!.lanternOpen)) continue;
      if (a === 'oil' && (s.delve!.light > 12 || !s.delve!.lanternOpen)) continue;
      if (a === 'free' && s.delve!.prisoner?.escortedBy) continue;
      if (a === 'open' && !o.targets.some((t) => t.id)) continue;
      if (a === 'take' && me.pack.length >= 4) continue;
      const target = a === 'open' ? o.targets.find((t) => t.id)! : a === 'mend' ? o.targets.sort((x, y) => (s.delve!.heroes.find((z) => z.heroId === x.id)!.hp) - (s.delve!.heroes.find((z) => z.heroId === y.id)!.hp))[0]! : o.targets[0]!;
      const p = e.preview(s, id, a, target);
      const focus = a === 'attack' || a === 'firebolt' ? Math.min(p.maxFocus, 1) : 0;
      const before = s;
      s = act(s, id, a, target, focus);
      if (s !== before) return true;
    }
    void def;
    return false;
  };
  tryAct();
  if (alive()) s = sapperCheck(s, id);
  if (!alive()) return s;
  const me = hero()!;
  if (!me.moved && !me.webbed) {
    // Stay put next to an awake enemy we can hit; close in on a hunter in sight within 4 (archers plink from range).
    const enemyNear = option(s, id, 'attack');
    if (!(enemyNear && !me.acted)) {
      const d = s.delve as DelveX;
      const vis = e.visibility(s).visible;
      const hunters = d.monsters.filter((m) => !m.buried && m.kind !== 'gloam' && m.kind !== 'dragon' && m.awareness === 'hunting' && m.at.level === me.at.level
        && vis.has(posKey(m.at)) && Math.max(Math.abs(m.at.q - me.at.q), Math.abs(m.at.r - me.at.r), Math.abs(m.at.q + m.at.r - me.at.q - me.at.r)) <= 4);
      const goals = hunters.length && !me.acted ? hunters.flatMap((m) => posNeighbors(m.at).filter((p) => kindAt(w, d, p) === 'floor')) : routeFor(s, me.at).goals;
      const field = distField(w, s.delve as DelveX, goals, { stairs: true, allowLocked: true });
      const here = field.get(posKey(me.at)) ?? 999;
      const sneak = nearSleeper(s, me.at);
      const reach = e.reachable(s, id, sneak);
      // Squad cohesion: stay within COHESION of the lantern bearer; the bearer waits for stragglers on its level.
      const bearer = d.heroes.find((h) => h.heroId === d.lanternBearer && h.status === 'active');
      const hexDist = (a: Pos, b: Pos) => Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.q + a.r - b.q - b.r));
      const isBearer = !bearer || bearer.heroId === id;
      const stragglers = isBearer
        ? d.heroes.filter((h) => h.status === 'active' && h.heroId !== id && h.at.level === me.at.level && !h.webbed && !h.grabbedBy && hexDist(h.at, me.at) > COHESION + 1)
        : [];
      let best: (typeof reach)[0] | undefined;
      let bestD = here;
      // A lit fuse nearby: anywhere out of its blast area beats the goal this turn.
      const ducking = inBlast(d, me.at) && reach.some((r) => !inBlast(d, r.to));
      if (!(isBearer && stragglers.length && !hunters.length) || ducking) {
        for (const r of reach) {
          if (inBlast(d, r.to) && !(inBlast(d, me.at) && !ducking)) continue;
          if (ducking) {
            const dd = field.get(posKey(r.to)) ?? 999;
            if (!best || dd < bestD) { bestD = dd; best = r; }
            continue;
          }
          if (!isBearer && bearer && r.to.level === bearer.at.level && hexDist(r.to, bearer.at) > COHESION && hexDist(me.at, bearer.at) <= COHESION) continue;
          const dd = field.get(posKey(r.to)) ?? 999;
          if (dd < bestD || (dd === bestD && best && r.cost < best.cost)) {
            bestD = dd;
            best = r;
          }
        }
      }
      // Fallen behind: catch up with the bearer instead.
      if (!best && !isBearer && bearer && bearer.at.level === me.at.level && hexDist(me.at, bearer.at) > COHESION) {
        const bf = distField(w, d, [bearer.at], { stairs: true, allowLocked: true });
        let bd = bf.get(posKey(me.at)) ?? 999;
        for (const r of reach) {
          const dd = bf.get(posKey(r.to)) ?? 999;
          if (dd < bd) { bd = dd; best = r; }
        }
      }
      if (best) {
        if (sneak) sneakMoves++;
        else walkMoves++;
        s = run(s, { type: 'move', heroId: id, path: best.path, sneak });
      }
    }
  }
  if (alive()) s = lanternCheck(s, id);
  tryAct();
  // Dash (spec 15.2): nothing to do with the action, so move again toward the goal.
  if (alive() && !hero()!.acted && hero()!.moved && !option(s, id, 'attack')) {
    const me2 = hero()!;
    const goals = routeFor(s, me2.at).goals;
    const field = distField(w, s.delve as DelveX, goals, { stairs: true, allowLocked: true });
    const here = field.get(posKey(me2.at)) ?? 999;
    let best: ReturnType<typeof e.reachable>[0] | undefined;
    let bestD = here;
    const d2 = s.delve as DelveX;
    const bearer2 = d2.heroes.find((h) => h.heroId === d2.lanternBearer && h.status === 'active');
    for (const r of e.reachable(s, id, false)) {
      if (!r.dash || inBlast(d2, r.to)) continue;
      if (bearer2 && bearer2.heroId !== id && r.to.level === bearer2.at.level && Math.max(Math.abs(r.to.q - bearer2.at.q), Math.abs(r.to.r - bearer2.at.r), Math.abs(r.to.q + r.to.r - bearer2.at.q - bearer2.at.r)) > COHESION) continue;
      const dd = field.get(posKey(r.to)) ?? 999;
      if (dd < bestD) { bestD = dd; best = r; }
    }
    if (best && bestD < here - 1) s = run(s, { type: 'move', heroId: id, path: best.path, sneak: false });
  }
  // Getting down: work the winch, or jump.
  if (alive() && !hero()!.acted) {
    const rt = routeFor(s, hero()!.at);
    const wo = option(s, id, 'winch');
    if (rt.winch && wo) s = act(s, id, 'winch', wo.targets[0]!);
    const jo = option(s, id, 'jump');
    if (!rt.winch && jo && !hero()!.moved) {
      const t = jo.targets.find((x) => rt.jump.some((p) => samePos(p, x.at!)));
      if (t) {
        const pv = e.preview(s, id, 'jump', t);
        if (pv.ok && !/down/.test(pv.warning ?? '')) s = act(s, id, 'jump', t);
      }
    }
  }
  // Locked door in the way and nothing else to do: smash it.
  if (alive() && !hero()!.acted) {
    const sm = option(s, id, 'smash');
    if (sm) s = act(s, id, 'smash', sm.targets[0]!, 0);
  }
  return s;
}

interface Row {
  squad: string;
  contract: string;
  level: number;
  darkRounds: number;
  gloamStrikes: number;
  done: boolean;
  rounds: number;
  light: number;
  loot: number;
  bounty: number;
  deaths: number;
  rivals: boolean;
  crew: string;
  story: string;
  dragonDead: boolean;
  reachedL3: boolean;
}

const rows: Row[] = [];
const unlocked: string[] = [];
let s = e.newGame(SEED);
for (let i = 0; i < N; i++) {
  if (s.stage === 'over') s = e.newGame(SEED + i * 7919);
  // Heal everyone so a full party goes in, buy a potion and a torch when rich.
  if (DRAGON) {
    s.campaign.reputation = Math.max(3, s.campaign.reputation);
    s.campaign.gold = Math.max(s.campaign.gold, 200);
    if (!s.campaign.board.some((k) => k.kind === 'slay')) {
      // Re-roll the board: a throwaway newGame with the same roster isn't possible, so poke the board directly.
      const site = castle.contractSites.find((x) => x.kind === 'slay');
      if (site) s.campaign.board[0] = { id: `slay-${i}`, kind: 'slay', title: 'Slay the Dragon', brief: '', siteId: site.id, level: site.at.level, bounty: 500, warnings: [] };
    }
  }
  // Squad building (spec 15.3): 3 heroes to start (Keven + 2), 4 once the gold is there.
  s = recruit(s, i === 0 ? 3 : 4);
  // V3.4 (spec 17.2): HP carries over. V3.5: heal at the infirmary once Brother Aldric is home;
  // before that, drink stash potions (buying one when a hero is badly hurt and the gold is there).
  const v = s.campaign.village;
  for (const h of s.campaign.roster) {
    if (h.hp >= h.maxHp) continue;
    if (v.surgeon) {
      if (s.campaign.gold >= 3) s = run(s, { type: 'heal', heroId: h.id });
      continue;
    }
    while (true) {
      const me = s.campaign.roster.find((x) => x.id === h.id)!;
      if (me.hp >= me.maxHp) break;
      if (!s.campaign.stash.some((it) => it.kind === 'potion')) {
        if (me.maxHp - me.hp < 4 || s.campaign.gold < 20) break;
        s = run(s, { type: 'buy', kind: 'potion' });
      }
      const before = s;
      s = run(s, { type: 'drink', heroId: h.id });
      if (s === before) break;
    }
  }
  if (s.campaign.gold > 60) s = run(s, { type: 'buy', kind: 'potion' });
  // An ale for Keven once Wim can brew (spec 18.4).
  const keven = s.campaign.roster.find((h) => h.id === 'keven');
  if (keven && !keven.ale && s.campaign.gold > 120) {
    const ale = e.ales(s).filter((a) => !a.locked).find((a) => a.kind === 'fireside' || a.kind === 'featherfoot');
    if (ale) s = run(s, { type: 'buyAle', heroId: 'keven', ale: ale.kind });
  }
  if (DRAGON && s.campaign.gold > 60) s = run(s, { type: 'buy', kind: 'potion' });
  const fit = s.campaign.roster.slice(0, 4).map((h) => h.id);
  if (!fit.length) break;
  // Spec 18.3: the surgeon first; other story contracts every other delve; else the regular ones in turn.
  const stories = s.campaign.board.filter((x) => x.story);
  const regular = s.campaign.board.filter((x) => !x.story);
  const story = stories.find((x) => x.story === 'surgeon') ?? (i % 2 === 1 ? stories[0] : undefined);
  const k = (DRAGON ? s.campaign.board.find((x) => x.kind === 'slay') : undefined) ?? story ?? regular[i % Math.max(1, regular.length)] ?? s.campaign.board[0]!;
  crewLog = [];
  // Oil for the Hollow (spec 16.2): one flask per Level 3 contract when the gold is there.
  if (k.level >= 3 && !s.campaign.stash.some((it) => it.kind === 'oil') && s.campaign.gold >= 15) s = run(s, { type: 'buy', kind: 'oil' });
  // Lockpicks (spec 19.2): once the smith is home, one reusable pair for the party, carried by a non-Burglar.
  if (s.campaign.village.smith && !s.campaign.stash.some((it) => it.kind === 'lockpicks') && s.campaign.gold >= 60) s = run(s, { type: 'buy', kind: 'lockpicks' });
  const packs: Record<string, string[]> = {};
  const picks = s.campaign.stash.find((it) => it.kind === 'lockpicks');
  const picker = fit.find((id) => e.heroById(s, id)?.cls !== 'burglar');
  if (picks && picker) (packs[picker] ??= []).push(picks.id);
  const carry = [
    ...(k.level >= 3 ? s.campaign.stash.filter((it) => it.kind === 'oil').slice(0, 1) : []),
    ...s.campaign.stash.filter((it) => it.kind === 'potion' || it.kind === 'torch').slice(0, DRAGON ? 4 : 2),
  ];
  carry.forEach((it, j) => {
    (packs[fit[j % fit.length]!] ??= []).push(it.id);
  });
  s = run(s, { type: 'startDelve', contractId: k.id, heroIds: fit, entrance: i % castle.entrances.length, packs });
  if (s.stage !== 'delve') {
    console.log('could not start delve');
    break;
  }
  const rivals = !!s.delve!.rivals;
  const crewName = s.delve!.rivals?.crew ?? '';
  let darkRounds = 0;
  const strikesBefore = gloamStrikes;
  while (s.stage === 'delve') {
    for (const h of s.delve!.heroes.filter((x) => x.status === 'active')) {
      if (s.stage !== 'delve') break;
      s = heroTurn(s, h);
    }
    if (s.stage !== 'delve') break;
    {
      const d = s.delve as DelveX;
      const lit = litSet(w, d);
      if (d.heroes.some((h) => h.status === 'active' && h.at.level === 3 && !lit.has(posKey(h.at)))) darkRounds++;
    }
    if (TRACE === i + 1) {
      const d = s.delve!;
      console.log(`r${d.round} light ${d.light}${d.lanternOpen ? '' : ' (shut)'}`, d.heroes.map((h) => `${h.heroId}:${h.status}@${posKey(h.at)} hp${h.hp}${h.grabbedBy ? ' held' : ''}${h.webbed ? ' web' : ''}`).join(' '), d.prisoner ? `pris@${posKey(d.prisoner.at)} esc=${d.prisoner.escortedBy}` : '');
      const near = d.monsters.filter((m) => !m.buried && d.heroes.some((h) => h.status === 'active' && h.at.level === m.at.level && Math.max(Math.abs(h.at.q - m.at.q), Math.abs(h.at.r - m.at.r), Math.abs(h.at.q + h.at.r - m.at.q - m.at.r)) <= 6));
      if (near.length) console.log('   near:', near.map((m) => `${m.id}:${m.kind}@${posKey(m.at)} hp${m.hp} ${m.awareness} ${m.intent?.kind ?? '-'}${m.intent?.targetId ? '>' + m.intent.targetId : ''}`).join(' '));
      if (d.rivals && (d.rivals as { entered?: boolean }).entered) console.log('   sisters:', d.rivals.stance, d.rivals.members.filter((r) => !r.goneOut && r.hp > 0).map((r) => `${r.cls}@${posKey(r.at)} hp${r.hp} ${r.intent?.kind ?? '-'}`).join(' '));
      for (const t of d.log.slice(-6)) console.log('   |', t);
    }
    if (s.delve!.round >= ROUND_CAP) {
      s = run(s, { type: 'abandon' });
      break;
    }
    s = run(s, { type: 'endTurn' });
  }
  const sum = s.summary!;
  const d = s.delve!;
  rows.push({
    squad: d.heroes.map((h) => e.heroById(s, h.heroId)?.cls.slice(0, 4) ?? '?').join('/'),
    contract: `${k.kind} L${k.level}`,
    level: k.level,
    darkRounds,
    gloamStrikes: gloamStrikes - strikesBefore,
    done: sum.contractDone,
    rounds: d.round,
    light: d.light,
    loot: sum.lootValue,
    bounty: sum.bounty,
    deaths: sum.dead.length,
    rivals,
    crew: crewName ? `${crewName.replace('lantern-sisters', 'sisters').replace('gallows-choir', 'choir')}:${d.rivals!.stance}${d.rivals!.members.every((r) => r.hp <= 0) ? '/dead' : ''}${crewLog.length ? ` (${crewLog.join(', ')})` : ''}` : '',
    story: k.story ?? '',
    dragonDead: !d.monsters.some((m) => m.kind === 'dragon') && castle.spawns.some((sp) => sp.kind === 'dragon'),
    reachedL3: d.explored.some((k) => k.startsWith('3:')),
  });
  if (VERBOSE) for (const n of sum.notes) console.log('   ', n);
  const back = e.apply(s, { type: 'backToCamp' });
  if (back.error) {
    errors++;
    refusals[`backToCamp: ${back.error}`] = (refusals[`backToCamp: ${back.error}`] ?? 0) + 1;
  } else {
    for (const ev of back.events) if (ev.type === 'villageUnlocked') unlocked.push(`delve ${i + 1}: ${ev.story}`);
    s = back.state;
  }
}

console.log('delve  contract     story      done  rounds light  loot bounty deaths  dark gloam  squad                 crew');
rows.forEach((r, i) => {
  console.log(
    `${String(i + 1).padStart(5)}  ${r.contract.padEnd(11)} ${r.story.padEnd(10)} ${(r.done ? 'yes' : 'no').padEnd(5)} ${String(r.rounds).padStart(6)} ${String(r.light).padStart(5)} ${String(r.loot).padStart(5)} ${String(r.bounty).padStart(6)} ${String(r.deaths).padStart(6)} ${String(r.darkRounds).padStart(5)} ${String(r.gloamStrikes).padStart(5)}  ${r.squad.padEnd(20)}  ${r.crew}`,
  );
});
console.log(`\nstory (spec 18.3): ${rows.filter((r) => r.story).length} story delves, ${rows.filter((r) => r.story && r.done).length} done; unlocked: ${unlocked.join(', ') || 'nothing'}`);
console.log(`village now: ${Object.entries(s.campaign.village).filter(([, v]) => v).map(([k]) => k).join(', ') || 'nothing'}`);
const crews = rows.filter((r) => r.crew);
const tally: Record<string, number> = {};
for (const r of crews) {
  const [name, rest] = r.crew.split(':');
  const stance = (rest ?? '').split(' ')[0]!;
  tally[`${name} ${stance}`] = (tally[`${name} ${stance}`] ?? 0) + 1;
}
console.log(`crews (spec 18.5): ${crews.length} delves with a crew; ${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(', ')}`);
console.log(`  tolls paid ${crews.filter((r) => r.crew.includes('paid toll')).length}, refused ${crews.filter((r) => r.crew.includes('refused toll')).length}; deaths in crew delves ${crews.reduce((a, r) => a + r.deaths, 0)}`);
console.log('\nper level (spec 16: L1 easy, L2 real resistance, L3 deadly without light):');
console.log('  level   n  done  deaths  dark rounds (L3)  Gloam strikes');
for (const lv of [1, 2, 3]) {
  const rs = rows.filter((r) => r.level === lv);
  if (!rs.length) continue;
  console.log(`  L${lv}    ${String(rs.length).padStart(3)}  ${String(rs.filter((r) => r.done).length).padStart(4)}  ${String(rs.reduce((a, r) => a + r.deaths, 0)).padStart(6)}  ${String(rs.reduce((a, r) => a + r.darkRounds, 0)).padStart(16)}  ${String(rs.reduce((a, r) => a + r.gloamStrikes, 0)).padStart(13)}`);
}
console.log(`hired: ${Object.entries(hired).map(([k, v]) => `${k} ${v}`).join(', ')}`);
console.log(`sapper (spec 20.3): fuses lit ${sap.fuses}, blasts ${sap.blasts}, walls broken ${sap.walls}, locks blown ${sap.locks}, kills ${sap.kills}, hero hits by own blasts ${sap.friendHits}`);
if (sapLog.length) console.log(`  blasts: ${sapLog.slice(0, 12).join('; ')}${sapLog.length > 12 ? '; ...' : ''}`);
const first = rows.filter((r) => r.contract.endsWith('L1')).slice(0, 5);
console.log(`first five L1 delves: done ${first.filter((r) => r.done).length}/${first.length}, deaths ${first.reduce((a, r) => a + r.deaths, 0)}`);
const avg = (f: (r: Row) => number) => (rows.reduce((a, r) => a + f(r), 0) / Math.max(1, rows.length)).toFixed(1);
console.log(`\n${rows.length} delves: done ${rows.filter((r) => r.done).length}, avg rounds ${avg((r) => r.rounds)}, avg light ${avg((r) => r.light)}, avg loot ${avg((r) => r.loot)}, avg bounty ${avg((r) => r.bounty)}, deaths ${rows.reduce((a, r) => a + r.deaths, 0)}`);
console.log('\nper contract type:  n  done%  rounds  light  deaths');
const kinds = [...new Set(rows.map((r) => r.contract))].sort();
for (const kd of kinds) {
  const rs = rows.filter((r) => r.contract === kd);
  const a = (f: (r: Row) => number) => (rs.reduce((x, r) => x + f(r), 0) / rs.length).toFixed(1);
  console.log(`  ${kd.padEnd(16)} ${String(rs.length).padStart(3)} ${String(Math.round((100 * rs.filter((r) => r.done).length) / rs.length)).padStart(5)} ${a((r) => r.rounds).padStart(7)} ${a((r) => r.light).padStart(6)} ${String(rs.reduce((x, r) => x + r.deaths, 0)).padStart(7)}`);
}
if (DRAGON) console.log(`dragon: slain ${rows.filter((r) => r.dragonDead).length}/${rows.length}, reached L3 ${rows.filter((r) => r.reachedL3).length}/${rows.length}`);
console.log(`stealth (spec 20.1, 20.2): moves ${walkMoves} walked / ${sneakMoves} sneaked; sleepers woken by passers-by ${evCount.woke ?? 0}; heroes noticed ${evCount.noticed ?? 0}; free swings ${evCount.swing ?? 0} (awake events: ${Object.entries(evCount).filter(([k]) => k.startsWith('awake:')).map(([k, v]) => `${k.slice(6)} ${v}`).join(', ') || 'none'})`);
console.log(`campaign: stage ${s.stage}, gold ${s.campaign.gold}, rep ${s.campaign.reputation}, roster ${s.campaign.roster.length}, fallen ${s.campaign.fallen.length}; refused commands ${errors}`);
if (errors) console.log('refusals:', refusals);
if (process.env.EVENTS === '1') console.log(evCount);
void samePos;
