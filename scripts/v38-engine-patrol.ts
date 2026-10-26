// V3.8 (spec 22): walk a hero past a patrol in exploration mode and print the tick combat starts.
// Test castle: Keven enters by the gate (Level 1) and walks row 7 east, through the pit hall, toward the
// east hall where an orc walks its beat. Once walking, once sneaking, once sneaking with the lantern shut.
// Run: npx tsx scripts/v38-engine-patrol.ts   (VERBOSE=1 prints every tick)

import { createEngine } from '../src/game/engine';
import { at, testCastle } from '../src/game/test/testCastle';
import { posKey } from '../src/game/hex';
import type { GameState } from '../src/game/types';

const e = createEngine(testCastle);
const VERBOSE = process.env.VERBOSE === '1';

function start(): GameState {
  const s = e.newGame(3);
  const r = e.apply(s, { type: 'startDelve', contractId: s.campaign.board[0]!.id, heroIds: ['keven'], entrance: 0, packs: {} });
  if (r.error) throw new Error(r.error);
  const st = r.state;
  const d = st.delve!;
  // Keep only the east hall's patrol; the gate room explored up to the far door, the rest learned on the way.
  d.monsters = d.monsters.filter((m) => m.awareness === 'patrol');
  d.rivals = null;
  d.traps = {};
  d.heroes[0]!.at = at(1, 3, 7);
  for (const lv of testCastle.levels) for (const k of Object.keys(lv.tiles)) if (lv.level === 1 && !d.explored.includes(`1:${k}`)) d.explored.push(`1:${k}`);
  return st;
}

function run(label: string, sneak: boolean, shut: boolean): void {
  let s = start();
  if (shut) s = e.apply(s, { type: 'act', heroId: 'keven', action: 'shutter', target: {}, focus: 0 }).state;
  const goal = at(1, 16, 7);
  const reach = e.explorePath(s, 'keven', goal, sneak);
  if (!reach) throw new Error('no path');
  const risky = reach.risks?.notice.map((n) => n.id) ?? [];
  const r0 = e.apply(s, { type: 'walk', heroId: 'keven', path: reach.path, sneak });
  if (r0.error) throw new Error(r0.error);
  s = r0.state;
  const light0 = s.delve!.light;
  let started: string | null = null;
  let tick = 0;
  for (; tick < 120 && s.stage === 'delve'; tick++) {
    const r = e.apply(s, { type: 'tick' });
    s = r.state;
    const d = s.delve!;
    const k = d.heroes[0]!;
    const orc = d.monsters.find((m) => m.kind === 'orc');
    if (VERBOSE) console.log(`  t${d.ticks} keven ${posKey(k.at)} orc ${orc ? `${posKey(orc.at)} ${orc.awareness}` : '-'} light ${d.light}`);
    const mode = r.events.find((x) => x.type === 'mode');
    if (mode && mode.type === 'mode' && mode.mode === 'combat') {
      started = `tick ${tick + 1}: ${mode.first} first, "${mode.why}" (Keven at ${posKey(k.at)}, orc at ${orc ? posKey(orc.at) : '-'})`;
      break;
    }
    if (!k.walk && tick > reach.path.length * 2 + 2) break;
  }
  const d = s.delve!;
  console.log(`${label}: path ${reach.path.length} hexes, preview says noticed by ${risky.length ? risky.join(', ') : 'nobody'}`);
  console.log(`  ${started ? `combat at ${started}` : `no combat; Keven reached ${posKey(d.heroes[0]!.at)} after ${tick} ticks`}; light ${light0} -> ${d.light}; mode ${d.mode}, round ${d.round}`);
}

run('walking', false, false);
run('sneaking', true, false);
run('sneaking, lantern shut', true, true);
