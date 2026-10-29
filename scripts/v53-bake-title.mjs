// V5.3: bake the title's castle. Renders src/ui/camp/title-scene.ts in headless Chromium from the vite dev server
// (so nothing extra ships) at 1x and 2x, and saves public/title/castle.webp and castle@2x.webp, and src/ui/camp/title-bake/castle.json: where
// the image sits on the 1920x1080 title stage, its lights (the title draws their glow), and a hash of the render's
// inputs. src/ui/camp/title-bake.test.ts fails when the hash no longer matches: after changing title-scene.ts (or
// the look modules it uses), run this again and commit the images.
//   node scripts/v53-bake-title.mjs [devServerUrl]
// DRAGON=asleep|peek bakes a Dragon variant instead, to public/title/castle-dragon-<v>.webp (+ title-bake/castle-dragon-<v>.json);
// PREVIEW=<dir> also drops the result into the live title and saves <dir>/title-<variant>.png.
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'title');
/** The files whose contents decide how the castle looks. Keep in step with src/ui/camp/title-bake.test.ts. */
export const TITLE_INPUTS = ['src/ui/camp/title-scene.ts', 'src/view/look/floors.ts', 'src/view/look/walls.ts', 'src/view/look/dragon.ts', 'src/view/look/rig.ts'];
export function titleInputHash(dir = root) {
  const h = createHash('sha256');
  for (const f of TITLE_INPUTS) h.update(`${f}\n`).update(readFileSync(join(dir, f), 'utf8').replace(/\r\n/g, '\n'));
  return h.digest('hex');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dragon = process.env.DRAGON ?? 'none';
  const preview = process.env.PREVIEW;
  let base = process.argv[2];
  let server = null;
  if (!base) {
    const { createServer } = await import('vite');
    server = await createServer({ root, server: { port: 5197, strictPort: false }, logLevel: 'warn' });
    await server.listen();
    base = server.resolvedUrls.local[0];
  }
  console.log(`baking from ${base}${dragon !== 'none' ? ` (dragon: ${dragon})` : ''}`);
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await p.route(/fonts\./, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  p.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await p.goto(base);
  const out = await p.evaluate(async (d) => {
    const { renderTitleCastle } = await import('/src/ui/camp/title-scene.ts');
    return { one: renderTitleCastle(1, d), two: renderTitleCastle(2, d) };
  }, dragon);
  if (!out.one || !out.two) {
    console.log('FAIL: no render');
    process.exit(1);
  }
  mkdirSync(outDir, { recursive: true });
  mkdirSync(join(root, 'src', 'ui', 'camp', 'title-bake'), { recursive: true });
  const stem = dragon === 'none' ? 'castle' : `castle-dragon-${dragon}`;
  const save = (name, url) => {
    const buf = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
    writeFileSync(join(outDir, name), buf);
    console.log(`ok   ${name} ${(buf.length / 1024).toFixed(1)} KB`);
  };
  save(`${stem}.webp`, out.one.url);
  save(`${stem}@2x.webp`, out.two.url);
  const r1 = (v) => Math.round(v * 10) / 10;
  const manifest = {
    file: `${stem}.webp`,
    file2x: `${stem}@2x.webp`,
    x: r1(out.one.x), y: r1(out.one.y), w: r1(out.one.w), h: r1(out.one.h),
    glows: out.one.glows,
    inputs: TITLE_INPUTS,
    hash: titleInputHash(),
  };
  writeFileSync(join(root, 'src', 'ui', 'camp', 'title-bake', `${stem}.json`), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`placed at ${manifest.x},${manifest.y} ${manifest.w}x${manifest.h}; ${manifest.glows.length} lights; hash ${manifest.hash.slice(0, 12)}`);

  if (preview) {
    // The real title, with this bake in place of the one it ships (needs the title to read the manifest).
    await p.evaluate(() => localStorage.clear());
    await p.goto(`${base}?titleCastle=${stem}`);
    await p.waitForFunction(() => !!document.querySelector('.title-screen .t-castle-img'));
    await p.evaluate(() => document.querySelector('.title-screen')?.classList.add('settled'));
    await p.waitForTimeout(1200);
    mkdirSync(preview, { recursive: true });
    await p.screenshot({ path: join(preview, `title-${dragon}.png`) });
    console.log(`preview ${join(preview, `title-${dragon}.png`)}`);
  }
  await b.close();
  if (server) await server.close();
}
