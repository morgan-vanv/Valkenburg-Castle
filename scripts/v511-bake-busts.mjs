// V5.1.1: bake the camp's hero busts. Renders every class in BAKED_BUSTS (src/ui/camp/bust.ts) once with the live
// rig render (src/ui/camp/bust-render.ts, imported straight from the vite dev server, so nothing extra ships) in
// headless Chromium, and saves public/busts/<cls>.webp (256px, alpha, quality 0.9) plus public/busts/manifest.json
// with a hash of the render's inputs. src/ui/camp/busts.test.ts fails when that hash no longer matches the sources:
// after changing cast.ts, keven.ts, rig.ts or bust-render.ts, run this again and commit the images.
//   node scripts/v511-bake-busts.mjs [devServerUrl]
// With no URL it starts its own vite dev server (and stops it afterwards). A preview server will not do: the render
// module is only importable from the dev server.
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'busts');
/** The files whose contents decide how a bust looks. Keep in step with src/ui/camp/busts.test.ts. */
export const BUST_INPUTS = ['src/view/look/cast.ts', 'src/view/look/keven.ts', 'src/view/look/rig.ts', 'src/ui/camp/bust-render.ts'];
export function bustInputHash(dir = root) {
  const h = createHash('sha256');
  for (const f of BUST_INPUTS) h.update(`${f}\n`).update(readFileSync(join(dir, f), 'utf8').replace(/\r\n/g, '\n'));
  return h.digest('hex');
}

let base = process.argv[2];
let server = null;
if (!base) {
  const { createServer } = await import('vite');
  server = await createServer({ root, server: { port: 5199, strictPort: false }, logLevel: 'warn' });
  await server.listen();
  base = server.resolvedUrls.local[0];
}
console.log(`baking from ${base}`);

const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage();
await p.route(/fonts\./, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.goto(base);
const out = await p.evaluate(async () => {
  const { BAKED_BUSTS } = await import('/src/ui/camp/bust.ts');
  const { renderBust, BUST_PX } = await import('/src/ui/camp/bust-render.ts');
  const res = {};
  for (const cls of BAKED_BUSTS) res[cls] = renderBust(cls, 'image/webp', 0.9);
  return { res, px: BUST_PX };
});
await b.close();
if (server) await server.close();

mkdirSync(outDir, { recursive: true });
const files = {};
let bad = 0;
for (const [cls, url] of Object.entries(out.res)) {
  if (!url || !url.startsWith('data:image/webp;base64,')) {
    console.log(`FAIL ${cls}: no WebP render (${url ? url.slice(0, 30) : 'null'})`);
    bad++;
    continue;
  }
  const buf = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
  writeFileSync(join(outDir, `${cls}.webp`), buf);
  files[cls] = `${cls}.webp`;
  console.log(`ok   ${cls}.webp ${(buf.length / 1024).toFixed(1)} KB`);
}
if (bad) process.exit(1);
const manifest = { px: out.px, format: 'webp', quality: 0.9, inputs: BUST_INPUTS, hash: bustInputHash(), files };
writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${Object.keys(files).length} busts and manifest.json (hash ${manifest.hash.slice(0, 12)})`);
