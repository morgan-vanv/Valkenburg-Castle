// Spec 17.4 check, headless: a hero with the lantern shuttered jumps from Level 1 straight
// into the Hollow (two levels) and we count what Level 3 shows on landing. Owner's note:
// "They're falling into a dark pit. I want their vision to be limited... okay with the fire
// being revealed." Prints the explored Level 3 hexes by kind (near the hero vs far lights).
//
// Run: npx tsx scripts/v34-fall-reveal.ts [seed=1980]

import { createEngine } from '../src/game/engine';
import { castle } from '../src/data/castle';
import { distance, posKey } from '../src/game/hex';
import type { Command, GameState } from '../src/game/types';

const SEED = Number(process.argv[2] ?? 1980);
const e = createEngine(castle);
let s: GameState = e.newGame(SEED);
const run = (c: Command) => {
  const r = e.apply(s, c);
  if (r.error) console.log('  refused:', c.type, r.error);
  s = r.state;
};
run({ type: 'startDelve', contractId: s.campaign.board[0]!.id, heroIds: ['keven'], entrance: 0, packs: {} });
const d = s.delve!;
d.lanternOpen = false;
// Every Level 1 floor hex next to a pit whose jump drops two levels; take the first.
let jumped = false;
for (const [k, t] of Object.entries(castle.levels[0]!.tiles)) {
  if (jumped || t.kind !== 'floor') continue;
  const [q, r] = k.split(',').map(Number) as [number, number];
  d.heroes[0]!.at = { level: 1, q, r };
  d.heroes[0]!.moved = false;
  d.heroes[0]!.acted = false;
  const jump = e.actions(s, 'keven').find((a) => a.action === 'jump');
  for (const t of jump?.targets ?? []) {
    const pv = e.preview(s, 'keven', 'jump', t);
    if (!pv.warning?.includes('2 levels')) continue;
    run({ type: 'act', heroId: 'keven', action: 'jump', target: t });
    jumped = true;
    break;
  }
}
const h = s.delve!.heroes[0]!;
console.log(jumped ? `landed at ${posKey(h.at)} (hp ${h.hp})` : 'FAIL: no two-level jump found');
const vis = e.visibility(s);
const l3 = [...vis.explored].filter((k) => k.startsWith('3:'));
const near = l3.filter((k) => {
  const [q, r] = k.slice(2).split(',').map(Number) as [number, number];
  return distance(h.at, { level: 3, q, r }) <= 2;
});
console.log(`Level 3 explored: ${l3.length} (within 2 of the hero: ${near.length}, farther: ${l3.length - near.length})`);
console.log('farther:', l3.filter((k) => !near.includes(k)).join(' '));
console.log(`hero lit: ${vis.lit.has(posKey(h.at))}, sight ${e.sightRange(s, 'keven')}`);
