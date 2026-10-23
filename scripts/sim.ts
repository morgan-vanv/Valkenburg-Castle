// Headless balance check: a simple bot plays whole campaigns.
// Run: npx tsx scripts/sim.ts [campaigns=20] [map=classic|mini]
//
// The bot is deliberately plain: fight what's adjacent, search rooms, head
// for the exit when the Alarm is high or packs are heavy. It shows whether
// the gold goal is in reach, not what a good player can do.

import { createEngine } from '../src/engine/engine';
import { miniCastle } from '../src/engine/test/miniCastle';
import { squareKey } from '../src/engine/geometry';
import type { Command, GameState, Unit } from '../src/engine/types';
import type { CastleMap } from '../src/engine/types';

const runs = Number(process.argv[2] ?? 20);
const which = process.argv[3] ?? 'classic';

async function loadMap(): Promise<CastleMap> {
  if (which === 'mini') return miniCastle();
  const mod = await import('../src/data/maps/classic');
  return mod.classicCastle as CastleMap;
}

const map = await loadMap();
const engine = createEngine(map);
const entrances = map.levels.flatMap((l) => l.entrances);

function ok(s: GameState, cmd: Command): GameState {
  const r = engine.apply(s, cmd);
  return r.error ? s : r.state;
}

function dist(a: { x: number; y: number; level: number }, b: { x: number; y: number; level: number }): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + (a.level !== b.level ? 12 : 0);
}

function stepToward(s: GameState, u: Unit, goal: (c: { x: number; y: number; level: number }) => number): GameState {
  const reach = engine.reachable(s, u.id);
  if (!reach.length) return s;
  reach.sort((a, b) => goal(a.to) - goal(b.to));
  if (goal(reach[0]!.to) >= goal(u.pos)) return s;
  return ok(s, { type: 'move', unitId: u.id, to: reach[0]!.to });
}

function playExpedition(s: GameState): GameState {
  let guard = 0;
  while (s.stage === 'expedition' && guard++ < 400) {
    const exp = s.expedition!;
    const vis = engine.visibility(s);
    const leaving = exp.alarm >= 55 || exp.turn > 25;
    for (const u0 of exp.units.filter((u) => u.side === 'player' && !u.exited)) {
      for (let k = 0; k < 3; k++) {
        if (s.stage !== 'expedition') return s;
        const u = s.expedition!.units.find((x) => x.id === u0.id && !x.exited);
        if (!u || u.actionsLeft < 1) break;
        const acts = engine.actions(s, u.id);
        const melee = acts.find((a) => a.kind === 'melee');
        if (melee && melee.kind === 'melee') {
          s = ok(s, { type: 'melee', unitId: u.id, targetId: melee.targetIds[0]!, focus: u.focus });
          break;
        }
        const carry = engine.carry(u);
        const goHome = leaving || carry.weight > carry.limit * 0.8 || (u.cls === 'hobart' && u.wounds >= 2);
        if (acts.some((a) => a.kind === 'exit') && goHome) {
          s = ok(s, { type: 'exit', unitId: u.id });
          break;
        }
        const missile = acts.find((a) => a.kind === 'missile');
        if (missile && missile.kind === 'missile' && !goHome) {
          s = ok(s, { type: 'missile', unitId: u.id, targetId: missile.targetIds[0]!, focus: 0 });
          break;
        }
        const pile = acts.find((a) => a.kind === 'pickUp');
        if (pile && pile.kind === 'pickUp' && !carry.overloaded) {
          s = ok(s, { type: 'pickUp', unitId: u.id, itemId: pile.itemIds[0]! });
          continue;
        }
        const chest = acts.find((a) => a.kind === 'chest');
        if (chest && chest.kind === 'chest') {
          s = ok(s, { type: 'chest', unitId: u.id, chestId: chest.chestId, method: chest.methods[0]! });
          continue;
        }
        if (acts.some((a) => a.kind === 'search') && !goHome) {
          s = ok(s, { type: 'search', unitId: u.id });
          continue;
        }
        const door = acts.find((a) => a.kind === 'door' && a.locked);
        if (door && door.kind === 'door' && !goHome && door.methods.length) {
          const m = door.methods.includes('pick') ? 'pick' : door.methods.includes('unlock') ? 'unlock' : door.methods.includes('smash') ? 'smash' : 'chop';
          s = ok(s, { type: 'door', unitId: u.id, edge: door.edge, method: m });
          continue;
        }
        const before = s;
        if (goHome) {
          s = stepToward(s, u, (c) => Math.min(...entrances.map((e) => dist(c, e))));
        } else {
          // Head for the nearest explored-or-not square in an unsearched room.
          s = stepToward(s, u, (c) => {
            const a = engine.area(c as never);
            const searched = a ? (s.expedition!.searchProgress[a.id] ?? 0) < 0 : true;
            const isTarget = a?.isRoom && !searched;
            const nearestEnemy = vis.enemies.length ? Math.min(...vis.enemies.map((e) => dist(c, e.pos))) : 30;
            return (isTarget ? 0 : 6) + dist(c, u.pos) * 0.2 - Math.min(nearestEnemy, 6) * 0.1;
          });
          if (s === before) s = stepToward(s, u, (c) => -Object.keys(s.expedition?.explored ?? {}).length + dist(c, { x: 8, y: 6, level: c.level }) * 0.01 - (s.expedition?.explored[squareKey(c as never)] ? 0 : 5));
        }
        if (s === before) break;
      }
    }
    if (s.stage === 'expedition') s = ok(s, { type: 'endTurn' });
  }
  return s;
}

function playCampaign(seed: number): { won: boolean; gold: number; reason: string; weeks: number[] } {
  let s = engine.newCampaign(seed);
  const banked: number[] = [];
  while (s.stage === 'week') {
    if (s.gold > 300 && s.barracks < 30) s = ok(s, { type: 'hire', men: Math.min(20, 30 - s.barracks) });
    s = ok(s, { type: 'beginMuster' });
    const e = entrances[0]!;
    const heroes = s.heroes.filter((h) => h.alive && h.id !== 'hobart').map((h) => ({ heroId: h.id, entrance: e }));
    const men = Math.min(20, s.barracks);
    const squads = men >= 6 ? [{ squad: { id: 'a', name: '', men: Math.ceil(men / 2), armor: 'normal' as const }, entrance: e }, { squad: { id: 'b', name: '', men: Math.floor(men / 2), armor: 'normal' as const }, entrance: e }] : [];
    const r = engine.apply(s, { type: 'launch', plan: { heroes: heroes.slice(0, 6 - squads.length), squads } });
    if (r.error) {
      s = ok(ok(s, { type: 'cancelMuster' }), { type: 'skipWeek' });
      continue;
    }
    s = playExpedition(r.state);
    if (s.stage === 'debrief') {
      banked.push(s.lastDebrief!.goldBanked);
      s = ok(s, { type: 'continueAfterDebrief' });
    }
  }
  return { won: s.stage === 'won', gold: s.gold, reason: s.endReason ?? '', weeks: banked };
}

const results = [];
for (let i = 1; i <= runs; i++) results.push(playCampaign(i * 101));
const wins = results.filter((r) => r.won).length;
const golds = results.map((r) => r.gold).sort((a, b) => a - b);
const weekly = results.flatMap((r) => r.weeks);
console.log(`map: ${which}, campaigns: ${runs}, bot wins: ${wins}`);
console.log(`final gold: min ${golds[0]}, median ${golds[Math.floor(golds.length / 2)]}, max ${golds.at(-1)}`);
console.log(`gold banked per expedition: median ${weekly.sort((a, b) => a - b)[Math.floor(weekly.length / 2)] ?? 0}, max ${Math.max(0, ...weekly)}`);
console.log('end reasons:', [...new Set(results.map((r) => r.reason.split('.')[0]))].join(' | '));
