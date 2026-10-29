// Real mouse input: click a reachable hex to move, press keys, open a preview with a click on an enemy.
//   node scripts/v3-shot-clicks.mjs <baseUrl> <outDir>
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';

const [base, dir] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.route(/fonts\./, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
let errors = 0;
p.on('console', (m) => m.type() === 'error' && (errors++, console.log('[console]', m.text())));
p.on('pageerror', (e) => (errors++, console.log('[pageerror]', e.message)));
const idle = () => p.waitForFunction(() => window.vc && !window.vc.busy(), null, { timeout: 60000 });
await p.goto(base);
await p.evaluate(() => localStorage.clear());
await p.reload();
await p.waitForFunction(() => !!window.vc);
await p.click('[data-new-campaign]');
await p.click('.lg-step[data-step="setout"]'); // V4.0: Lowgate's step 4
await p.click('.lg-delve');
await idle();
await p.waitForTimeout(1500);
// Screen position of a reachable hex.
const target = await p.evaluate(() => {
  const vc = window.vc;
  const s = vc.state();
  const sel = vc.hud.selectedId;
  const r = window.vcEngine.reachable(s, sel, false).sort((a, b) => b.cost - a.cost)[0];
  const dio = vc.dio;
  const w = { x: Math.sqrt(3) * (r.to.q + r.to.r / 2), z: 1.5 * r.to.r };
  const THREEv = dio.rig.camera.position.clone().set(w.x, -(r.to.level - 1) * 12 + 0.18, w.z);
  THREEv.project(dio.rig.camera);
  return { x: (THREEv.x * 0.5 + 0.5) * innerWidth, y: (-THREEv.y * 0.5 + 0.5) * innerHeight, to: r.to, sel };
});
console.log('[target]', JSON.stringify(target));
await p.mouse.move(target.x, target.y);
await p.waitForTimeout(400);
await p.screenshot({ path: `${dir}/40-hover.png` });
await p.mouse.click(target.x, target.y);
await idle();
const after = await p.evaluate((sel) => window.vc.state().delve.heroes.find((h) => h.heroId === sel).at, target.sel);
console.log('[moved to]', JSON.stringify(after), 'expected', JSON.stringify(target.to));
await p.waitForTimeout(600);
await p.screenshot({ path: `${dir}/41-after-click-move.png` });
// Keys: Tab, S, then 2.
await p.keyboard.press('Tab');
await p.keyboard.press('s');
await p.waitForTimeout(300);
await p.screenshot({ path: `${dir}/42-sneak.png` });
// Menu.
await p.click('text=Menu');
await p.waitForTimeout(300);
await p.screenshot({ path: `${dir}/43-menu.png` });
await p.keyboard.press('Escape');
// End turn with E.
await p.keyboard.press('e');
await idle();
await p.waitForTimeout(300);
const round = await p.evaluate(() => window.vc.state().delve?.round);
console.log('[round after E]', round);
// Reload: autosave resumes via Continue.
await p.reload();
await p.waitForFunction(() => !!window.vc);
const hasContinue = await p.isVisible('text=Continue');
console.log('[continue visible]', hasContinue);
await p.click('text=Continue');
await idle();
await p.waitForTimeout(800);
const resumed = await p.evaluate(() => ({ stage: window.vc.state()?.stage, round: window.vc.state()?.delve?.round }));
console.log('[resumed]', JSON.stringify(resumed));
await p.screenshot({ path: `${dir}/44-resumed.png` });
console.log('[errors]', errors);
await b.close();
