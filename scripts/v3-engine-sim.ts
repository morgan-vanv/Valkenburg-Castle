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
// V3.2: a campaign starts with Hobart alone and 160 gold; the bot hires 2 to 3 recruits at the
// tavern (a front-liner first, then a quiet one, then a mage), re-hiring when the roster thins.
// Heroes dash (second move) toward the goal when nothing is in reach to hit.
//
// V3.3: the lantern holds 20 and can be shuttered. The bot shutters on Level 1 whenever the
// bearer stands in fixed light (daylight, sconces), opens it otherwise and on Levels 2 and 3,
// buys an oil flask for Level 3 contracts and drinks it when the lantern runs low, and breaks
// free when a ghoul holds a hero. Per level it prints contracts done, deaths, world phases with a
// hero in the dark on Level 3, and Gloam strikes.
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

const N = Number(process.argv[2] ?? 20);
const SEED = Number(process.env.SEED ?? 1);
const VERBOSE = process.env.VERBOSE === '1';
const castle = process.env.CASTLE === 'test' ? testCastle : realCastle;
const e = createEngine(castle);
const w = new World(castle);
const ROUND_CAP = 80;
/** The bot heads out when the lantern gets this low (it holds 20 since V3.3). */
const LOW_LIGHT = 5;
const TRACE = Number(process.env.TRACE ?? 0);
const DRAGON = process.env.DRAGON === '1';
const pits: Pos[] = [];
for (const l of castle.levels) for (const k of Object.keys(l.tiles)) {
  const [q, r] = k.split(',').map(Number) as [number, number];
  if (l.tiles[k]!.kind === 'pit') pits.push({ level: l.level, q, r });
}

let errors = 0;
const evCount: Record<string, number> = {};
let gloamStrikes = 0;
function run(s: GameState, cmd: Command): GameState {
  const r = e.apply(s, cmd);
  const gloamId = s.delve?.monsters.find((m) => m.kind === 'gloam')?.id;
  for (const ev of r.events) {
    const key = ev.type === 'hit' ? (ev.target.startsWith('m') || ev.target.startsWith('r') ? 'hit:monster' : 'hit:hero') : ev.type === 'awake' ? `awake:${ev.awareness}` : ev.type;
    evCount[key] = (evCount[key] ?? 0) + 1;
    if (ev.type === 'hit' && (ev.attacker === gloamId || r.state.delve?.monsters.find((m) => m.id === ev.attacker)?.kind === 'gloam')) gloamStrikes++;
  }
  if (r.error) {
    errors++;
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

const FRONT = ['sellsword', 'sapper'];
const QUIET = ['burglar', 'ranger'];
const MAGES = ['pyromancer', 'hedgewitch', 'shadowmancer'];
const hired: Record<string, number> = {};

/** Hire up to `want` recruits the stash can pay for, one of each role first. */
function recruit(s: GameState, want: number): GameState {
  const roles = [FRONT, QUIET, MAGES, FRONT, QUIET, MAGES];
  while (s.campaign.roster.length < want) {
    const have = s.campaign.roster.map((h) => h.cls as string);
    const role = roles.find((r) => !have.some((c) => r.includes(c))) ?? [...FRONT, ...QUIET, ...MAGES];
    const pool = s.campaign.recruits.filter((r) => r.price <= s.campaign.gold);
    const pick = pool.find((r) => role.includes(r.hero.cls)) ?? pool.sort((a, b) => a.price - b.price)[0];
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

function heroTurn(s: GameState, h: HeroInDelve): GameState {
  const id = h.heroId;
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
      const reach = e.reachable(s, id, false);
      let best: (typeof reach)[0] | undefined;
      let bestD = here;
      for (const r of reach) {
        const dd = field.get(posKey(r.to)) ?? 999;
        if (dd < bestD || (dd === bestD && best && r.cost < best.cost)) {
          bestD = dd;
          best = r;
        }
      }
      if (best) s = run(s, { type: 'move', heroId: id, path: best.path, sneak: false });
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
    for (const r of e.reachable(s, id, false)) {
      if (!r.dash) continue;
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
  dragonDead: boolean;
  reachedL3: boolean;
}

const rows: Row[] = [];
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
  // Squad building (spec 15.3): 3 heroes to start (Hobart + 2), 4 once the gold is there.
  s = recruit(s, i === 0 ? 3 : 4);
  for (const h of s.campaign.roster) if (h.wounded) s = run(s, { type: 'heal', heroId: h.id });
  if (s.campaign.gold > 60) s = run(s, { type: 'buy', kind: 'potion' });
  if (DRAGON && s.campaign.gold > 60) s = run(s, { type: 'buy', kind: 'potion' });
  const fit = s.campaign.roster.filter((h) => !h.wounded).slice(0, 4).map((h) => h.id);
  if (!fit.length) break;
  const k = (DRAGON ? s.campaign.board.find((x) => x.kind === 'slay') : undefined) ?? s.campaign.board[i % s.campaign.board.length]!;
  // Oil for the Hollow (spec 16.2): one flask per Level 3 contract when the gold is there.
  if (k.level >= 3 && !s.campaign.stash.some((it) => it.kind === 'oil') && s.campaign.gold >= 15) s = run(s, { type: 'buy', kind: 'oil' });
  const packs: Record<string, string[]> = {};
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
    dragonDead: !d.monsters.some((m) => m.kind === 'dragon') && castle.spawns.some((sp) => sp.kind === 'dragon'),
    reachedL3: d.explored.some((k) => k.startsWith('3:')),
  });
  if (VERBOSE) for (const n of sum.notes) console.log('   ', n);
  s = run(s, { type: 'backToCamp' });
}

console.log('delve  contract     done  rounds light  loot bounty deaths rivals  dark gloam  squad');
rows.forEach((r, i) => {
  console.log(
    `${String(i + 1).padStart(5)}  ${r.contract.padEnd(11)} ${(r.done ? 'yes' : 'no').padEnd(5)} ${String(r.rounds).padStart(6)} ${String(r.light).padStart(5)} ${String(r.loot).padStart(5)} ${String(r.bounty).padStart(6)} ${String(r.deaths).padStart(6)} ${(r.rivals ? 'yes' : '').padEnd(6)} ${String(r.darkRounds).padStart(5)} ${String(r.gloamStrikes).padStart(5)}  ${r.squad}`,
  );
});
console.log('\nper level (spec 16: L1 easy, L2 real resistance, L3 deadly without light):');
console.log('  level   n  done  deaths  dark rounds (L3)  Gloam strikes');
for (const lv of [1, 2, 3]) {
  const rs = rows.filter((r) => r.level === lv);
  if (!rs.length) continue;
  console.log(`  L${lv}    ${String(rs.length).padStart(3)}  ${String(rs.filter((r) => r.done).length).padStart(4)}  ${String(rs.reduce((a, r) => a + r.deaths, 0)).padStart(6)}  ${String(rs.reduce((a, r) => a + r.darkRounds, 0)).padStart(16)}  ${String(rs.reduce((a, r) => a + r.gloamStrikes, 0)).padStart(13)}`);
}
console.log(`hired: ${Object.entries(hired).map(([k, v]) => `${k} ${v}`).join(', ')}`);
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
console.log(`campaign: stage ${s.stage}, gold ${s.campaign.gold}, rep ${s.campaign.reputation}, roster ${s.campaign.roster.length}, fallen ${s.campaign.fallen.length}; refused commands ${errors}`);
if (process.env.EVENTS === '1') console.log(evCount);
void samePos;
