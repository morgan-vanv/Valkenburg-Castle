// V5.0 (P, spec 32.15, 32.16): the threshold in the browser. A hero steps onto the tower stair with an orc at the
// foot: the card gets the eye mark, the log says what's there, the view stays on Level 1 while others still have to
// cross, and the crossing is free (on, across, off in one walk). Then the toll: empty pockets are let by.
//
//   node scripts/v50-threshold-check.mjs <baseUrl>      (npx vite preview --port 4185 --strictPort → http://localhost:4185/)

import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';

const base = process.argv[2] ?? 'http://localhost:4185/';
let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); if (!ok) fails++; };

const browser = await chromium.launch();
const p = await browser.newPage({ viewport: { width: 1400, height: 900 } });
p.on('pageerror', (e) => check(`page error: ${e.message}`, false));
await p.goto(base);
await p.evaluate(() => { localStorage.clear(); localStorage.setItem('vc.welcome.v40', '1'); localStorage.setItem('vc.settings', JSON.stringify({ speed: 0, reduceShake: true, noEndTurnAsk: true, quality: 'low', autoEndTurn: false })); });
await p.reload();
await p.waitForFunction(() => !!window.vc && !!window.vcEngine);
const idle = () => p.waitForFunction(() => window.vc && !window.vc.busy());

// A delve with two heroes; Keven beside the tower stair on Level 1 with a lit torch, Brann two hexes behind; an orc at the foot on Level 2.
await p.evaluate(async () => {
  const E = window.vcEngine;
  const s = E.newGame(3);
  s.campaign.gold = 500;
  window.vc.load(s);
  for (const r of window.vc.state().campaign.recruits.slice(0, 1)) await window.vc.send({ type: 'hire', heroId: r.hero.id });
  await window.vc.send({ type: 'buy', kind: 'torch' });
  const st = window.vc.state();
  const ids = st.campaign.roster.slice(0, 2).map((h) => h.id);
  const k = st.campaign.board.find((x) => x.kind === 'recover' && !x.story) ?? st.campaign.board[0];
  await window.vc.send({ type: 'startDelve', contractId: k.id, heroIds: ids, entrance: 0, packs: { [ids[0]]: st.campaign.stash.map((i) => i.id).slice(0, 1) } });
  const d = structuredClone(window.vc.state());
  const at = (level, col, row) => ({ level, q: col - Math.floor(row / 2), r: row });
  d.delve.monsters = d.delve.monsters.filter((m) => m.kind !== 'gloam');
  d.delve.rivals = null;
  d.delve.heroes[0].at = at(1, 36, 3);
  d.delve.heroes[1].at = at(1, 34, 3);
  d.delve.heroes[0].pack.forEach((i) => { if (i.kind === 'torch') { i.lit = true; i.rounds = 15; } });
  for (const m of d.delve.monsters) m.awareness = m.kind === 'orc' ? 'asleep' : m.awareness;
  // One orc awake at the foot of the stairs on Level 2, facing the stairs.
  const foot = at(2, 36, 4);
  const orc = d.delve.monsters.find((m) => m.kind === 'orc' && m.at.level === 2);
  orc.at = foot; orc.awareness = 'patrol'; orc.facing = 0; orc.spawnedAt = foot; orc.route = undefined; orc.intent = undefined;
  window.vc.load(d);
});
await idle();
await p.evaluate(() => window.vc.select?.(window.vc.state().delve.heroes[0].heroId));
await p.waitForTimeout(200);

const at = (level, col, row) => ({ level, q: col - Math.floor(row / 2), r: row });
// The crossing is free: from beside the stairs, Level 2 hexes beyond the far step are within a walk, at cost 2 or 3.
const reach = await p.evaluate(() => { const s = window.vc.state(); return window.vcEngine.reachable(s, s.delve.heroes[0].heroId, false).filter((r) => r.to.level === 2).map((r) => ({ to: r.to, cost: r.cost })); });
check('the crossing is free: Level 2 hexes beyond the stair hex are reachable at cost 2', reach.some((r) => r.cost === 2 && !(r.to.q === at(2, 37, 3).q && r.to.r === 3)), JSON.stringify(reach.slice(0, 4)));

// Step onto the stairs: the peek.
await p.evaluate(async () => { const s = window.vc.state(); await window.vc.send({ type: 'move', heroId: s.delve.heroes[0].heroId, path: [{ level: 1, q: 37 - 1, r: 3 }], sneak: false }); });
await idle();
await p.waitForTimeout(300);
const peek = await p.evaluate(() => ({
  mark: document.querySelector('.dl-si.peek')?.dataset.tip ?? '',
  log: [...document.querySelectorAll('.dl-chron *')].map((e) => e.textContent).filter((t) => /stairs/.test(t)).slice(-2),
  shown: window.vc.dio?.shownLevel ?? document.querySelector('.dl-lvl.on')?.textContent,
  level: window.vc.state().delve.heroes[0].at.level,
  peek: window.vcEngine.peek(window.vc.state(), window.vc.state().delve.heroes[0].heroId),
}));
check('on the stairs: the eye mark says what is at the foot', /Down the stairs/.test(peek.mark) && /orc/i.test(peek.mark), peek.mark.slice(0, 120));
check('engine.peek lists the orc at the foot', !!peek.peek && peek.peek.figures.some((f) => f.kind === 'orc'), JSON.stringify(peek.peek?.figures?.map((f) => [f.name, f.dist, f.mood])));
check('the log says it too', peek.log.some((t) => /Down the stairs/.test(t)), JSON.stringify(peek.log));
check('still on Level 1 (the hero is on the stair hex)', peek.level === 1);

// Cross: Keven walks down and off the far step; Brann is still up here, so the view stays on Level 1.
await p.evaluate(async () => { const s = window.vc.state(); const h = s.delve.heroes[0]; h.moved = false; window.vc.load(s); });
await idle();
await p.evaluate(async () => { const s = window.vc.state(); const r = window.vcEngine.reachable(s, s.delve.heroes[0].heroId, false).filter((x) => x.to.level === 2 && x.cost <= 2).sort((a, b) => a.cost - b.cost); await window.vc.send({ type: 'move', heroId: s.delve.heroes[0].heroId, path: r[r.length - 1].path, sneak: false }); });
await idle();
await p.waitForTimeout(400);
const after = await p.evaluate(() => ({ level: window.vc.state().delve.heroes[0].at.level, shown: document.querySelector('.dl-lvl.on')?.textContent ?? '', brann: window.vc.state().delve.heroes[1].at.level }));
check('Keven crossed to Level 2 in one move', after.level === 2, `level ${after.level}`);
const handed = await p.evaluate(() => window.vc.hud.selectedId === window.vc.state().delve.heroes[1].heroId);
check('the selection hands over to Brann, still on Level 1, and the view comes back to him', handed && /Keep/.test(after.shown), `shown "${after.shown}", handed ${handed}`);

// The toll: a cutthroat crew meeting empty pockets lets the party by.
const toll = await p.evaluate(async () => {
  const s = structuredClone(window.vc.state());
  const E = window.vcEngine;
  const at = (level, col, row) => ({ level, q: col - Math.floor(row / 2), r: row });
  s.delve.heroes[0].pack = s.delve.heroes[0].pack.filter((i) => !['gold', 'gem', 'jewelry'].includes(i.kind));
  window.vc.load(s);
  return { carrying: document.querySelector('.dl-carry')?.dataset.tip ?? '' };
});
check('Carrying hover says empty pockets are let by', /empty pockets are let by/.test(toll.carrying), toll.carrying.slice(0, 160));

await browser.close();
console.log(fails ? `\n${fails} check(s) failed` : '\nall checks passed');
process.exit(fails ? 1 : 0);
