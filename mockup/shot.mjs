// node mockup/shot.mjs <url> <out.png> [width height]   (viewport defaults to 1600x1000)
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
const [url, out, w = '1600', h = '1000'] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: Number(w), height: Number(h) } });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
p.on('console', (m) => m.type() === 'error' && console.log('[console]', m.text()));
await p.goto(url);
await p.waitForFunction(() => window.mockupReady, null, { timeout: 120000 });
await p.waitForTimeout(500);
await p.screenshot({ path: out, timeout: 120000 });
await b.close();
console.log('[shot]', out);
