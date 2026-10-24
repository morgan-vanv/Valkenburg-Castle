// V3.1 look check: overview and close shots of every level, everything revealed,
// in headless Chromium with WebGL (SwiftShader).
//
//   node scripts/v31-shot-levels.mjs <baseUrl> <outDir> [fixture|real] [pitch] [yaw]
//
// fixture: the stand-in engine on src/game/test/testCastle.ts (?fixture=1).
// test:    the real engine on the test castle (?castle=test).
// real:    the real engine and castle.
// Writes level<N>.png (whole level) and level<N>-close.png (zoomed on the pit
// or the level's middle).

import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';

const [base, dir, mode = 'real', pitch = '0.98', yaw = '0.55'] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
let errors = 0;
p.on('console', (m) => {
  if (m.type() === 'error') errors++;
  if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.type(), m.text());
});
p.on('pageerror', (e) => {
  errors++;
  console.log('[pageerror]', e.message);
});

const q = mode === 'fixture' ? '?fixture=1&reveal=1' : mode === 'test' ? '?castle=test&reveal=1' : '?reveal=1';
await p.goto(`${base}${q}`);
await p.evaluate(() => localStorage.clear());
await p.reload();
await p.waitForFunction(() => !!window.vc && !!window.vcEngine, null, { timeout: 30000 });
// Start a delve directly through the engine.
await p.evaluate(async () => {
  const E = window.vcEngine;
  let s = E.newGame(1980);
  s = E.apply(s, { type: 'newCampaign', seed: 1980 }).state;
  window.vc.load(s);
  const k = s.campaign.board[0];
  const ids = s.campaign.roster.filter((h) => !h.wounded).map((h) => h.id).slice(0, 4);
  await window.vc.send({ type: 'startDelve', contractId: k.id, heroIds: ids, entrance: 0, packs: {} });
});
await p.waitForFunction(() => window.vc.state()?.stage === 'delve' && !window.vc.busy(), null, { timeout: 60000 });
await p.waitForTimeout(500);

const levels = await p.evaluate(() => window.vcEngine.castle().levels.map((l) => l.level));
for (const level of levels) {
  for (const shot of ['', '-close']) {
    await p.evaluate(
      ({ level, pitch, yaw, close }) => {
        const { dio, hud } = window.vc;
        hud.root.style.display = 'none';
        dio.showLevel(level, true);
        dio.frameLevel();
        dio.rig.pitch = pitch;
        dio.rig.yaw = yaw;
        if (close) {
          // Zoom on the pit if there is one, else the middle.
          const lv = dio.levels.get(level);
          const pits = [...lv.pits].map((k) => k.split(',').map(Number));
          if (pits.length) {
            const cq = pits.reduce((a, x) => a + x[0], 0) / pits.length;
            const cr = pits.reduce((a, x) => a + x[1], 0) / pits.length;
            const x = Math.sqrt(3) * (cq + cr / 2);
            const z = 1.5 * cr;
            dio.focusXZ(x, z, true);
          }
          dio.rig.distance = 22;
          dio.rig.pitch = 0.82;
        } else dio.rig.distance *= 1.02;
      },
      { level, pitch: Number(pitch), yaw: Number(yaw), close: shot === '-close' },
    );
    await p.waitForTimeout(1800);
    const path = `${dir}/level${level}${shot}.png`;
    await p.screenshot({ path, timeout: 90000 });
    console.log('[shot]', path);
  }
}
console.log(`[done] errors: ${errors}`);
await b.close();
