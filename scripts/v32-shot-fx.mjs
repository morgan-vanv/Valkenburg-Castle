// V3.2 effects scene: smoke, glue, caltrops, burning, veil, ward, overwatch, sleeping monster, dash range.
//   node scripts/v32-shot-fx.mjs <baseUrl> <outDir>
// Uses the stand-in engine (?fixture=1) and window.vc.load to inject state.
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';

const [base, dir] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
let errors = 0;
p.on('console', (m) => { if (m.type() === 'error') { errors++; console.log('[console]', m.text()); } });
p.on('pageerror', (e) => { errors++; console.log('[pageerror]', e.message); });
await p.goto(`${base}?fixture=1`);
await p.evaluate(() => localStorage.clear());
await p.reload();
await p.waitForFunction(() => !!window.vc, null, { timeout: 30000 });
await p.fill('input.seed', '7');
await p.click('text=New campaign');
await p.click('.lg-step[data-step="setout"]'); // V4.0: Lowgate's step 4
await p.click('.lg-delve');
await p.waitForFunction(() => window.vc && !window.vc.busy(), null, { timeout: 60000 });
await p.waitForTimeout(400);
await p.evaluate(() => {
  const vc = window.vc;
  const s = structuredClone(vc.state());
  const d = s.delve;
  const h = d.heroes;
  const k = (q, r) => `1:${q},${r}`;
  const near = (p, dq, dr) => ({ level: 1, q: p.q + dq, r: p.r + dr });
  const a = h[0].at;
  d.smoke = { [k(a.q + 2, a.r)]: 2, [k(a.q + 3, a.r)]: 2, [k(a.q + 2, a.r + 1)]: 1 };
  d.glue = { [k(a.q - 1, a.r + 1)]: 2 };
  d.burning = { [k(a.q + 1, a.r - 2)]: 2, [k(a.q + 2, a.r - 2)]: 1 };
  d.caltrops = [k(a.q, a.r + 1)];
  h[1].veil = 2;
  h[2].ward = 2;
  h[0].overwatch = true;
  h[3].moved = true;
  h[3].acted = false;
  for (const m of d.monsters) if (m.awareness === 'asleep') { m.stuck = 1; break; }
  d.explored.push(...Object.keys(d.smoke), ...Object.keys(d.glue), ...Object.keys(d.burning), ...d.caltrops);
  void near;
  vc.load(s);
});
await p.waitForTimeout(600);
await p.screenshot({ path: `${dir}/fx-01-effects.png` });
console.log('[shot]', `${dir}/fx-01-effects.png`);
// Select the hero that has moved: dash range.
await p.keyboard.press('4');
await p.waitForTimeout(500);
await p.screenshot({ path: `${dir}/fx-02-dash.png` });
console.log('[shot]', `${dir}/fx-02-dash.png`);
console.log('[errors]', errors);
await b.close();
