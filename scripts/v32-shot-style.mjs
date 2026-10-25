// V3.2 style check (spec 15.8): a close-up of the party at the gate, a close-up of the
// Dragon in its Lair, and one overview per level, everything revealed, in headless
// Chromium with WebGL (SwiftShader). Few shots, reduced size: screenshots are expensive.
//
//   node scripts/v32-shot-style.mjs <baseUrl> <outDir> [party,dragon,levels]
//
// Writes party.png, dragon.png and level<N>.png. Prints console errors.

import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';

const [base, dir, what = 'party,dragon,levels'] = process.argv.slice(2);
const want = new Set(what.split(','));
mkdirSync(dir, { recursive: true });
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1200, height: 750 } });
await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
let errors = 0;
p.on('console', (m) => {
  if (m.type() === 'error') errors++;
  if (m.type() === 'error') console.log('[console]', m.type(), m.text().slice(0, 300));
});
p.on('pageerror', (e) => {
  errors++;
  console.log('[pageerror]', e.message);
});

await p.goto(`${base}?reveal=1`);
await p.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('vc.settings', JSON.stringify({ speed: 0, reduceShake: true, noEndTurnAsk: true }));
});
await p.reload();
await p.waitForFunction(() => !!window.vc && !!window.vcEngine, null, { timeout: 30000 });
// Start a delve directly through the engine with a full party (hire until the party is allowed).
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
await p.waitForTimeout(400);

async function shot(name, setup, arg) {
  await p.evaluate(setup, arg);
  await p.waitForTimeout(1500);
  const path = `${dir}/${name}.png`;
  await p.screenshot({ path, timeout: 90000 });
  console.log('[shot]', path);
}

if (want.has('party')) {
  await shot('party', () => {
    const { dio, hud } = window.vc;
    const s = window.vc.state();
    hud.root.style.display = 'none';
    const h = s.delve.heroes[0];
    dio.showLevel(h.at.level, true);
    dio.lookAt(h.at, true);
    dio.rig.distance = 11;
    dio.rig.pitch = 0.78;
    dio.rig.yaw = 0.4;
  });
}
if (want.has('dragon')) {
  await shot('dragon', () => {
    const { dio, hud } = window.vc;
    const s = window.vc.state();
    hud.root.style.display = 'none';
    const m = s.delve.monsters.find((x) => x.kind === 'dragon');
    dio.showLevel(m.at.level, true);
    dio.lookAt(m.at, true);
    dio.rig.distance = 16;
    dio.rig.pitch = 0.8;
    dio.rig.yaw = 0.5;
  });
}
if (want.has('awake')) {
  // The Dragon awake, Hobart on a floor hex beside it for scale (state injected through vc.load).
  await shot('dragon-awake', () => {
    const { dio, hud } = window.vc;
    const s = structuredClone(window.vc.state());
    hud.root.style.display = 'none';
    const m = s.delve.monsters.find((x) => x.kind === 'dragon');
    m.awareness = 'hunting';
    const lv = window.vcEngine.castle().levels.find((l) => l.level === m.at.level);
    const dirs = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
    for (const [dq, dr] of dirs) {
      const t = lv.tiles[`${m.at.q + dq * 2},${m.at.r + dr * 2}`];
      if (t && t.kind === 'floor') {
        s.delve.heroes[0].at = { level: m.at.level, q: m.at.q + dq * 2, r: m.at.r + dr * 2 };
        break;
      }
    }
    window.vc.load(s);
    dio.showLevel(m.at.level, true);
    dio.lookAt(m.at, true);
    dio.rig.distance = 18;
    dio.rig.pitch = 0.75;
    dio.rig.yaw = 0.5;
  });
}
if (want.has('door')) {
  // A door on level 1 with a sconce nearby: how fittings sit on the thin walls.
  await shot('door', () => {
    const { dio, hud } = window.vc;
    hud.root.style.display = 'none';
    const castle = window.vcEngine.castle();
    const lv = castle.levels[0];
    const doors = Object.entries(lv.tiles).filter(([, t]) => t.kind === 'door').map(([k]) => k.split(',').map(Number));
    const sconces = (castle.lights ?? []).filter((l) => l.kind === 'sconce' && l.at.level === lv.level);
    const dist = (a, b) => (Math.abs(a[0] - b.q) + Math.abs(a[1] - b.r) + Math.abs(a[0] + a[1] - b.q - b.r)) / 2;
    let best = doors[0];
    let bestD = 99;
    for (const d of doors) for (const s of sconces) if (dist(d, s.at) < bestD) (bestD = dist(d, s.at)), (best = d);
    dio.showLevel(lv.level, true);
    dio.lookAt({ level: lv.level, q: best[0], r: best[1] }, true);
    dio.rig.distance = 13;
    dio.rig.pitch = 0.8;
    dio.rig.yaw = 0.3;
  });
}
if (want.has('hud')) {
  // The default in-game view at delve start, HUD on: do the overlays sit right on the taller figures?
  await shot('hud', () => {
    const { dio, hud } = window.vc;
    hud.root.style.display = '';
    const s = window.vc.state();
    const h = s.delve.heroes[0];
    dio.showLevel(h.at.level, true);
    dio.lookAt(h.at, true);
    dio.rig.distance = 22;
    dio.rig.pitch = 0.92;
    dio.rig.yaw = 0;
  });
}
if (want.has('bridge')) {
  // Railings and a brazier on level 2 (the bridges over the Hollow).
  await shot('bridge', () => {
    const { dio, hud } = window.vc;
    hud.root.style.display = 'none';
    const castle = window.vcEngine.castle();
    const lv = castle.levels.find((l) => l.level === 2);
    const rails = Object.entries(lv.tiles).filter(([, t]) => t.railing).map(([k]) => k.split(',').map(Number));
    const cq = rails.reduce((a, x) => a + x[0], 0) / rails.length;
    const cr = rails.reduce((a, x) => a + x[1], 0) / rails.length;
    dio.showLevel(2, true);
    dio.lookAt({ level: 2, q: Math.round(cq), r: Math.round(cr) }, true);
    dio.rig.distance = 14;
    dio.rig.pitch = 0.8;
    dio.rig.yaw = 0.5;
  });
}
if (want.has('levels')) {
  const levels = await p.evaluate(() => window.vcEngine.castle().levels.map((l) => l.level));
  for (const level of levels) {
    await shot(
      `level${level}`,
      (level) => {
        const { dio, hud } = window.vc;
        hud.root.style.display = 'none';
        dio.showLevel(level, true);
        dio.frameLevel();
        dio.rig.pitch = 0.98;
        dio.rig.yaw = 0.55;
        dio.rig.distance *= 1.02;
      },
      level,
    );
  }
}
console.log(`[done] errors: ${errors}`);
await b.close();
