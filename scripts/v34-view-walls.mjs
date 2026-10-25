// V3.4 view: a room at the default camera (pitch and distance as the game sets them), HUD hidden,
// everything revealed, to compare the wall cutaway on/off. One reduced shot.
//
//   node scripts/v34-view-walls.mjs <baseUrl> <out.png> [yaw]
//
// Starts a delve with a full party through the engine, then frames the party at its start.

import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';

const [base, out, yaw] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1100, height: 690 } });
await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
let errors = 0;
p.on('console', (m) => m.type() === 'error' && (errors++, console.log('[console]', m.text().slice(0, 300))));
p.on('pageerror', (e) => (errors++, console.log('[pageerror]', e.message)));
await p.goto(`${base}?reveal=1`);
await p.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('vc.settings', JSON.stringify({ speed: 0, reduceShake: true, noEndTurnAsk: true }));
});
await p.reload();
await p.waitForFunction(() => !!window.vc && !!window.vcEngine, null, { timeout: 30000 });
await p.evaluate(async () => {
  const E = window.vcEngine;
  let s = E.newGame(1980);
  s = E.apply(s, { type: 'newCampaign', seed: 1980 }).state;
  for (let i = 0; i < 4; i++) {
    const ids = s.campaign.roster.filter((h) => !h.wounded).map((h) => h.id).slice(0, 4);
    if (!E.partyProblem || !E.partyProblem(s, ids)) break;
    const r = s.campaign.recruits.find((x) => x.price <= s.campaign.gold);
    if (!r) break;
    s = E.apply(s, { type: 'hire', heroId: r.hero.id }).state;
  }
  window.vc.load(s);
  const k = s.campaign.board[0];
  const ids = s.campaign.roster.filter((h) => !h.wounded).map((h) => h.id).slice(0, 4);
  await window.vc.send({ type: 'startDelve', contractId: k.id, heroIds: ids, entrance: 0, packs: {} });
});
await p.waitForFunction(() => window.vc.state()?.stage === 'delve' && !window.vc.busy(), null, { timeout: 60000 });
p.on('console', (m) => m.type() === 'log' && console.log('[log]', m.text()));
await p.evaluate((yaw) => {
  const { dio, hud } = window.vc;
  hud.root.style.display = 'none';
  // Put two heroes on a floor hex just north of a wall run (the camera looks from +z by default),
  // nearest the start, so the wall stands between them and the camera.
  const s = structuredClone(window.vc.state());
  const h0 = s.delve.heroes[0];
  const lv = window.vcEngine.castle().levels.find((l) => l.level === h0.at.level);
  const T = (q, r) => lv.tiles[`${q},${r}`];
  const isWall = (t) => t && t.kind === 'wall';
  const isFloor = (t) => t && t.kind === 'floor';
  let best = null;
  let bestD = 1e9;
  for (const key of Object.keys(lv.tiles)) {
    const [q, r] = key.split(',').map(Number);
    if (!isFloor(T(q, r)) || !isFloor(T(q + 1, r))) continue;
    if (!(isWall(T(q, r + 1)) && isWall(T(q - 1, r + 1)))) continue;
    if (isFloor(T(q, r + 2)) || isFloor(T(q - 1, r + 2))) {
      const d = Math.abs(q - h0.at.q) + Math.abs(r - h0.at.r);
      if (d > 3 && d < bestD) (bestD = d), (best = { q, r });
    }
  }
  if (best) {
    s.delve.heroes[0].at = { level: h0.at.level, q: best.q, r: best.r };
    if (s.delve.heroes[1]) s.delve.heroes[1].at = { level: h0.at.level, q: best.q + 1, r: best.r };
    window.vc.load(s);
  }
  const h = window.vc.state().delve.heroes[0];
  dio.lookAt({ ...h.at, r: h.at.r + 1 }, true);
  if (yaw) dio.rig.yaw = Number(yaw);
  // Selection ring on the first hero, hover on the second: both behind the wall.
  dio.select(h.heroId);
  const h1 = window.vc.state().delve.heroes[1];
  if (h1) dio.setHover(h1.at);
  console.log('best', JSON.stringify(best), 'cutaway', dio.cutaway, 'pitch', dio.rig.pitch, 'dist', dio.rig.distance, 'yaw', dio.rig.yaw);
}, yaw);
await p.waitForTimeout(1800);
await p.screenshot({ path: out, timeout: 90000 });
console.log('[shot]', out, 'errors', errors);
await b.close();
