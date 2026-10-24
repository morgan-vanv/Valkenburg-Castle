// Headless balance check for V2: a simple bot plays one-shot runs.
// Run: npx tsx scripts/sim.ts [runs=20]   (VERBOSE=1 for a per-run line)
//
// The bot is plain: buy a rope and a charge, send everyone toward the nearest
// treasure, fight what's adjacent, grab what it stands on, and head for the
// nearest exit when full or when the Alarm is high. It shows what a careless
// player banks, not what a good one can.

import { engine } from '../src/engine/index';
import { cellAt, neighbours, squareKey } from '../src/engine/geometry';
import type { Command, Coord, GameState, Unit } from '../src/engine/types';

const runs = Number(process.argv[2] ?? 20);
const VERBOSE = process.env.VERBOSE === '1';
const map = engine.map();
const entrances = map.levels.flatMap((l) => l.entrances);

function ok(s: GameState, cmd: Command): GameState {
  const r = engine.apply(s, cmd);
  return r.error ? s : r.state;
}

/** Walking distance from every square to the nearest goal (doors passable, links and the shaft too). */
function field(goals: Coord[]): Map<string, number> {
  const d = new Map<string, number>();
  const q: Coord[] = [];
  for (const g of goals) {
    d.set(squareKey(g), 0);
    q.push(g);
  }
  while (q.length) {
    const c = q.shift()!;
    const k = d.get(squareKey(c))!;
    const next: Coord[] = [];
    for (const n of neighbours(map, c)) if (n.edge !== 'wall' && cellAt(map, n.to) === 'floor') next.push(n.to);
    for (const l of map.links) {
      if (squareKey(l.a) === squareKey(c)) next.push(l.b);
      if (squareKey(l.b) === squareKey(c)) next.push(l.a);
    }
    for (const n of next) {
      if (d.has(squareKey(n))) continue;
      d.set(squareKey(n), k + 1);
      q.push(n);
    }
  }
  return d;
}
const exitField = field(entrances);

function stepToward(s: GameState, u: Unit, f: Map<string, number>): GameState {
  const reach = engine.reachable(s, u.id);
  if (!reach.length) return s;
  const score = (c: Coord) => f.get(squareKey(c)) ?? 999;
  reach.sort((a, b) => score(a.to) - score(b.to));
  if (score(reach[0]!.to) >= score(u.pos)) return s;
  return ok(s, { type: 'move', unitId: u.id, to: reach[0]!.to });
}

function play(seed: number) {
  let s = engine.newRun(seed);
  s = ok(s, { type: 'buy', item: 'rope' });
  s = ok(s, { type: 'buy', item: 'charge' });
  s = ok(s, { type: 'buy', item: 'draught' });
  s = ok(s, { type: 'launch', plan: { entrances: {} } });
  let guard = 0;
  while (s.stage === 'expedition' && guard++ < 80) {
    const exp = s.expedition!;
    const lootSquares = Object.entries(exp.floorLoot)
      .filter(([, items]) => items.length)
      .map(([k]) => {
        const [lvl, rest] = k.split(':');
        const [x, y] = rest!.split(',').map(Number);
        return { level: Number(lvl), x: x!, y: y! } as Coord;
      });
    const lootField = field(lootSquares);
    const leaving = exp.alarm >= 70 || exp.turn > 30;
    for (const id of exp.units.filter((u) => u.side === 'player' && !u.exited).map((u) => u.id)) {
      for (let k = 0; k < 3; k++) {
        if (s.stage !== 'expedition') break;
        const u = s.expedition!.units.find((x) => x.id === id && !x.exited);
        if (!u || u.actionsLeft < 1) break;
        const acts = engine.actions(s, u.id);
        const carry = engine.carry(u);
        const full = carry.weight >= carry.limit;
        const goHome = leaving || full || (u.cls === 'hobart' && u.wounds >= 2);
        const melee = acts.find((a) => a.kind === 'melee');
        if (melee && melee.kind === 'melee') {
          s = ok(s, { type: 'melee', unitId: u.id, targetId: melee.targetIds[0]!, focus: u.focus });
          break;
        }
        if (acts.some((a) => a.kind === 'exit') && (goHome || (u.cls === 'hobart' && leaving))) {
          s = ok(s, { type: 'exit', unitId: u.id });
          break;
        }
        const pile = acts.find((a) => a.kind === 'pickUp');
        if (pile && pile.kind === 'pickUp' && !full) {
          const before = s;
          s = ok(s, { type: 'pickUp', unitId: u.id, itemId: pile.itemIds[0]! });
          if (s !== before) continue;
        }
        const door = acts.find((a) => a.kind === 'door' && a.locked);
        if (door && door.kind === 'door' && !goHome) {
          s = ok(s, { type: 'door', unitId: u.id, edge: door.edge, method: door.methods.includes('pick') ? 'pick' : 'force' });
          continue;
        }
        const missile = acts.find((a) => a.kind === 'missile');
        if (missile && missile.kind === 'missile' && !goHome) {
          s = ok(s, { type: 'missile', unitId: u.id, targetId: missile.targetIds[0]!, focus: 0 });
          break;
        }
        const before = s;
        s = stepToward(s, u, goHome ? exitField : lootField);
        if (s === before) break;
      }
    }
    if (s.stage === 'expedition') s = ok(s, { type: 'endTurn' });
  }
  // Out of time: walk everyone home for the record (the bot never leaves Hobart deliberately).
  return s.result ?? { survived: false, score: 0, lootGold: 0, medal: 'none', reason: 'timed out', turns: guard };
}

const results = [];
for (let i = 1; i <= runs; i++) {
  const r = play(i * 101);
  results.push(r);
  if (VERBOSE) console.log(`seed ${i * 101}: ${r.survived ? 'out' : 'LOST'} score ${r.score} loot ${r.lootGold} medal ${r.medal} turns ${r.turns}`);
}
const scores = results.map((r) => r.score).sort((a, b) => a - b);
const medals = results.reduce<Record<string, number>>((m, r) => ((m[r.medal] = (m[r.medal] ?? 0) + 1), m), {});
console.log(`runs ${runs}, Hobart out alive ${results.filter((r) => r.survived).length}`);
console.log(`score: min ${scores[0]}, median ${scores[Math.floor(scores.length / 2)]}, max ${scores.at(-1)}`);
console.log('medals:', JSON.stringify(medals));
