// Headless balance check for V3: a plain bot plays N delves through the public
// engine API on the real castle (or the test castle with CASTLE=test).
// Run: npx tsx scripts/v3-engine-sim.ts [delves=20]   (SEED=n, VERBOSE=1)
//
// The bot is simple: the party walks toward the objective together, hits
// what's adjacent, takes what's near, grabs the objective, then heads for the
// nearest exit. It shows what a careless player banks, not what a good one can.

import { createEngine } from '../src/game/engine';
import { testCastle } from '../src/game/test/testCastle';
import { castle as realCastle } from '../src/data/castle';
import { posKey, samePos, type Pos } from '../src/game/hex';
import type { ActionKind, ActionTarget, Command, GameState, HeroInDelve } from '../src/game/types';
import { World, distField } from '../src/game/world';
import type { DelveX } from '../src/game/state';

const N = Number(process.argv[2] ?? 20);
const SEED = Number(process.env.SEED ?? 1);
const VERBOSE = process.env.VERBOSE === '1';
const castle = process.env.CASTLE === 'test' ? testCastle : realCastle;
const e = createEngine(castle);
const w = new World(castle);
const ROUND_CAP = 80;
const TRACE = Number(process.env.TRACE ?? 0);

let errors = 0;
const evCount: Record<string, number> = {};
function run(s: GameState, cmd: Command): GameState {
  const r = e.apply(s, cmd);
  for (const ev of r.events) {
    const key = ev.type === 'hit' ? (ev.target.startsWith('m') || ev.target.startsWith('r') ? 'hit:monster' : 'hit:hero') : ev.type === 'awake' ? `awake:${ev.awareness}` : ev.type;
    evCount[key] = (evCount[key] ?? 0) + 1;
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
  return e.actions(s, heroId).find((o) => o.action === a);
}

function objectiveDone(s: GameState): boolean {
  const d = s.delve!;
  if (d.contract.kind === 'rescue') return !!d.prisoner?.freed && !!d.prisoner.escortedBy;
  return d.heroes.some((h) => h.pack.some((i) => i.kind === 'heirloom'));
}

function objectiveFailed(s: GameState): boolean {
  const d = s.delve!;
  if (d.contract.kind === 'rescue') return !!d.prisoner?.dead;
  const onGround = d.ground.some((g) => g.items.some((i) => i.kind === 'heirloom'));
  return !onGround && !objectiveDone(s) && !d.monsters.some((m) => m.stolen?.kind === 'heirloom');
}

function goalFor(s: GameState): Pos[] {
  const d = s.delve!;
  const leaving = objectiveDone(s) || objectiveFailed(s) || d.light < 12 || d.round > 50;
  if (leaving) return w.exits;
  if (d.contract.kind === 'rescue') return [d.prisoner!.at];
  const g = d.ground.find((x) => x.items.some((i) => i.kind === 'heirloom'));
  return g ? [g.at] : w.exits;
}

function heroTurn(s: GameState, h: HeroInDelve): GameState {
  const id = h.heroId;
  const hero = () => s.delve?.heroes.find((x) => x.heroId === id);
  const alive = () => s.stage === 'delve' && hero()?.status === 'active';
  const tryAct = (): boolean => {
    if (!alive() || hero()!.acted) return false;
    const me = hero()!;
    const def = e.heroById(s, id)!;
    const order: ActionKind[] = ['revive', 'free', 'take', 'attack', 'firebolt', 'mend', 'kindle', 'open', 'pick', 'light', 'leave'];
    for (const a of order) {
      const o = option(s, id, a);
      if (!o) continue;
      if (a === 'leave' && !(objectiveDone(s) || objectiveFailed(s) || s.delve!.light < 12 || s.delve!.round > 50)) continue;
      if (a === 'mend' && !o.targets.some((t) => { const x = s.delve!.heroes.find((y) => y.heroId === t.id); return x && x.hp <= 3; })) continue;
      if (a === 'kindle' && s.delve!.light > 30) continue;
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
    // Stay put next to an awake enemy we can hit.
    const enemyNear = option(s, id, 'attack');
    if (!(enemyNear && !me.acted)) {
      const goals = goalFor(s);
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
  tryAct();
  // Locked door in the way and nothing else to do: smash it.
  if (alive() && !hero()!.acted) {
    const sm = option(s, id, 'smash');
    if (sm) s = act(s, id, 'smash', sm.targets[0]!, 0);
  }
  return s;
}

interface Row {
  contract: string;
  done: boolean;
  rounds: number;
  light: number;
  loot: number;
  bounty: number;
  deaths: number;
  rivals: boolean;
}

const rows: Row[] = [];
let s = e.newGame(SEED);
for (let i = 0; i < N; i++) {
  if (s.stage === 'over') s = e.newGame(SEED + i * 7919);
  // Heal everyone so a full party goes in, buy a potion and a torch when rich.
  for (const h of s.campaign.roster) if (h.wounded) s = run(s, { type: 'heal', heroId: h.id });
  if (s.campaign.gold > 60) s = run(s, { type: 'buy', kind: 'potion' });
  const fit = s.campaign.roster.filter((h) => !h.wounded).slice(0, 4).map((h) => h.id);
  if (!fit.length) break;
  const k = s.campaign.board[i % s.campaign.board.length]!;
  const packs: Record<string, string[]> = {};
  s.campaign.stash.filter((it) => it.kind === 'potion' || it.kind === 'torch').slice(0, 2).forEach((it, j) => {
    (packs[fit[j % fit.length]!] ??= []).push(it.id);
  });
  s = run(s, { type: 'startDelve', contractId: k.id, heroIds: fit, entrance: i % castle.entrances.length, packs });
  if (s.stage !== 'delve') {
    console.log('could not start delve');
    break;
  }
  const rivals = !!s.delve!.rivals;
  while (s.stage === 'delve') {
    for (const h of s.delve!.heroes.filter((x) => x.status === 'active')) {
      if (s.stage !== 'delve') break;
      s = heroTurn(s, h);
    }
    if (s.stage !== 'delve') break;
    if (TRACE === i + 1) {
      const d = s.delve!;
      console.log(`r${d.round} light ${d.light}`, d.heroes.map((h) => `${h.heroId}:${h.status}@${posKey(h.at)} hp${h.hp}`).join(' '), d.prisoner ? `pris@${posKey(d.prisoner.at)} esc=${d.prisoner.escortedBy}` : '');
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
    contract: `${k.kind} L${k.level}`,
    done: sum.contractDone,
    rounds: d.round,
    light: d.light,
    loot: sum.lootValue,
    bounty: sum.bounty,
    deaths: sum.dead.length,
    rivals,
  });
  if (VERBOSE) for (const n of sum.notes) console.log('   ', n);
  s = run(s, { type: 'backToCamp' });
}

console.log('delve  contract     done  rounds light  loot bounty deaths rivals');
rows.forEach((r, i) => {
  console.log(
    `${String(i + 1).padStart(5)}  ${r.contract.padEnd(11)} ${(r.done ? 'yes' : 'no').padEnd(5)} ${String(r.rounds).padStart(6)} ${String(r.light).padStart(5)} ${String(r.loot).padStart(5)} ${String(r.bounty).padStart(6)} ${String(r.deaths).padStart(6)} ${r.rivals ? 'yes' : ''}`,
  );
});
const avg = (f: (r: Row) => number) => (rows.reduce((a, r) => a + f(r), 0) / Math.max(1, rows.length)).toFixed(1);
console.log(`\n${rows.length} delves: done ${rows.filter((r) => r.done).length}, avg rounds ${avg((r) => r.rounds)}, avg light ${avg((r) => r.light)}, avg loot ${avg((r) => r.loot)}, avg bounty ${avg((r) => r.bounty)}, deaths ${rows.reduce((a, r) => a + r.deaths, 0)}`);
console.log(`campaign: stage ${s.stage}, gold ${s.campaign.gold}, rep ${s.campaign.reputation}, roster ${s.campaign.roster.length}, fallen ${s.campaign.fallen.length}; refused commands ${errors}`);
if (process.env.EVENTS === '1') console.log(evCount);
void samePos;
