// Full-castle overview shots from the real 3D view, everything revealed.
//
//   node scripts/v3-map-overview.mjs <baseUrl> <outDir> [pitch] [yaw]
//
// Uses the dev-only ?reveal=1 flag (src/ui/app.ts) and window.vc.

import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';

const [base, dir, pitch = '1.15', yaw = '0'] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
p.on('pageerror', (e) => console.log('[pageerror]', e.message));

await p.goto(`${base}?reveal=1`);
await p.evaluate(() => localStorage.clear());
await p.reload();
await p.waitForFunction(() => !!window.vc, null, { timeout: 30000 });
await p.click('[data-new-campaign]');
await p.waitForTimeout(300);
await p.click('.lg-step[data-step="setout"]'); // V4.0: Lowgate's step 4
await p.click('.lg-delve');
await p.waitForFunction(() => window.vc.state()?.stage === 'delve' && !window.vc.busy(), null, { timeout: 60000 });
await p.waitForTimeout(800);

for (const level of [1, 2]) {
  await p.evaluate(
    ({ level, pitch, yaw }) => {
      const { dio, hud } = window.vc;
      hud.root.style.display = 'none';
      dio.showLevel(level, true);
      dio.frameLevel();
      dio.rig.pitch = pitch;
      dio.rig.yaw = yaw;
      dio.rig.distance *= 1.05;
    },
    { level, pitch: Number(pitch), yaw: Number(yaw) },
  );
  await p.waitForTimeout(2500);
  const path = `${dir}/level${level}.png`;
  await p.screenshot({ path, timeout: 90000 });
  console.log('[shot]', path);
}
await b.close();
