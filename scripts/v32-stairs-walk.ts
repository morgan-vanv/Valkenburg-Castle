// Spec 15.7 check, headless: Hobart walks from the main gate to the tower stair and
// takes it with the same logic the action bar uses (src/ui/links.ts: the `reachable`
// entry whose destination is on another level and whose path is one step). Passes
// when he stands on Level 2. No browser, no screenshots.
//
// Run: npx tsx scripts/v32-stairs-walk.ts [seed=1980]

import { createEngine } from '../src/game/engine';
import { castle } from '../src/data/castle';
import { posKey, samePos } from '../src/game/hex';
import type { ActionKind, Command, GameState } from '../src/game/types';
import { World, distField } from '../src/game/world';
import type { DelveX } from '../src/game/state';
import { linkAt, linkButton, linkReach } from '../src/view/links';

const SEED = Number(process.argv[2] ?? 1980);
const e = createEngine(castle);
const w = new World(castle);
const stairs = castle.links.find((l) => l.kind === 'stairs')!;
const goal = stairs.a.level === 1 ? stairs.a : stairs.b;

let s: GameState = e.newGame(SEED);
const run = (c: Command) => {
  const r = e.apply(s, c);
  if (r.error) console.log('  refused:', c.type, r.error);
  s = r.state;
};

// Hire until the party is allowed (V3.2 starts with Hobart alone).
for (const r of s.campaign.recruits) {
  if (!e.partyProblem(s, [s.campaign.roster[0]!.id])) break;
  run({ type: 'hire', heroId: r.hero.id });
}
const hobart = s.campaign.roster.find((h) => h.cls === 'hobart')!;
const party = s.campaign.roster.slice(0, 2).map((h) => h.id);
run({ type: 'startDelve', contractId: s.campaign.board[0]!.id, heroIds: party, entrance: 0, packs: {} });
if (s.stage !== 'delve') {
  console.log('FAIL: could not start a delve');
  process.exit(1);
}

const me = () => s.delve!.heroes.find((h) => h.heroId === hobart.id)!;
const option = (a: ActionKind) => e.actions(s, hobart.id).find((o) => o.action === a && !o.blocked);

let took = false;
for (let round = 1; round <= 60 && s.stage === 'delve' && !took; round++) {
  const h = me();
  if (h.status !== 'active') break;
  // On the stairs: the UI offers "Take stairs ↓ Level 2" from `reachable`. Take them.
  const reach = e.reachable(s, hobart.id, false);
  const link = linkReach(reach, h.at);
  if (link) {
    const info = linkAt(castle, h.at)!;
    const label = linkButton(info);
    console.log(`round ${round}: on the stairs at ${posKey(h.at)}, button "${label}"`);
    if (label !== 'Take stairs ↓ Level 2') {
      console.log(`FAIL: expected "Take stairs ↓ Level 2"`);
      process.exit(1);
    }
    run({ type: 'move', heroId: hobart.id, path: link.path, sneak: false });
    took = true;
    break;
  }
  // Else walk toward them (open doors on the way), move twice if the action is free.
  for (let leg = 0; leg < 2; leg++) {
    const cur = me();
    if (cur.status !== 'active' || (cur.moved && cur.acted)) break;
    const open = option('open');
    if (open && !cur.acted && leg === 0) run({ type: 'act', heroId: hobart.id, action: 'open', target: open.targets[0]!, focus: 0 });
    const field = distField(w, s.delve as DelveX, [goal], { stairs: true, allowLocked: true });
    const here = field.get(posKey(cur.at)) ?? 999;
    let best: ReturnType<typeof e.reachable>[0] | undefined;
    let bestD = here;
    for (const r of e.reachable(s, hobart.id, false)) {
      if (r.to.level !== cur.at.level) continue;
      const dd = field.get(posKey(r.to)) ?? 999;
      if (dd < bestD || (dd === bestD && best && r.cost < best.cost)) {
        bestD = dd;
        best = r;
      }
    }
    if (!best) break;
    run({ type: 'move', heroId: hobart.id, path: best.path, sneak: false });
    if (samePos(me().at, goal)) {
      // Standing on the stairs now; the button appears next refresh (after this turn if the move is spent).
      const r2 = linkReach(e.reachable(s, hobart.id, false), me().at);
      if (r2) {
        console.log(`round ${round}: reached the stairs, button "${linkButton(linkAt(castle, me().at)!)}"`);
        run({ type: 'move', heroId: hobart.id, path: r2.path, sneak: false });
        took = true;
      }
      break;
    }
  }
  if (!took) run({ type: 'endTurn' });
}

const h = me();
console.log(`Hobart: ${h.status} at ${posKey(h.at)} (round ${s.delve?.round ?? '-'})`);
if (h.at.level === 2 && took) {
  console.log('PASS: Hobart took the tower stair and stands on Level 2.');
  process.exit(0);
}
console.log('FAIL: Hobart did not reach Level 2.');
process.exit(1);
