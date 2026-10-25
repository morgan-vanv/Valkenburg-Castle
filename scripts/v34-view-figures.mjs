// V3.4 view: a lineup of every humanoid model (heroes, sisters, orcs, ghoul) close up, built by
// src/view/figures.ts and drawn in a small scene of its own (imported through the Vite dev server),
// so the torso shape can be compared before/after. One reduced shot.
//
//   node scripts/v34-view-figures.mjs <baseUrl> <out.png>

import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';

const [base, out] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1400, height: 560 } });
await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
let errors = 0;
p.on('console', (m) => m.type() === 'error' && (errors++, console.log('[console]', m.text().slice(0, 300))));
p.on('pageerror', (e) => (errors++, console.log('[pageerror]', e.message)));
await p.goto(base);
await p.waitForFunction(() => !!window.vc, null, { timeout: 30000 });
await p.evaluate(async () => (await import('/scripts/v34-view-lineup.ts')).lineup());
await p.waitForTimeout(300);
await p.screenshot({ path: out });
console.log('[shot]', out, 'errors', errors);
await b.close();
