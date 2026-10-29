// V5.1.1: the camp's busts are baked images (public/busts, scripts/v511-bake-busts.mjs). Every class the camp can
// show has one, and the manifest's hash matches the render's sources, so a rig change without a rebake fails here.
// (Files are read through vite's import.meta.glob, so the test needs no Node types.)
import { describe, expect, it } from 'vitest';
import { RECRUIT_CLASSES } from '../../game/data';
import { BAKED_BUSTS, bakedBustUrl } from './bust';
import manifest from '../../../public/busts/manifest.json';

const REBAKE = 'Run `node scripts/v511-bake-busts.mjs` (it starts its own dev server) and commit public/busts.';

/** The render's sources, keyed by repo path. Must list the same files as BUST_INPUTS in the bake script. */
const sources: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>(['/src/view/look/cast.ts', '/src/view/look/keven.ts', '/src/view/look/rig.ts', '/src/ui/camp/bust-render.ts'], {
      query: '?raw',
      import: 'default',
      eager: true,
    }),
  ).map(([k, v]) => [k.slice(1), v]),
);
/** The baked images as data URLs, keyed by class. */
const images: Record<string, string> = Object.fromEntries(
  Object.entries(import.meta.glob<string>('/public/busts/*.webp', { query: '?inline', import: 'default', eager: true })).map(([k, v]) => [
    k.replace(/^.*\/(\w+)\.webp$/, '$1'),
    v,
  ]),
);

/** Same as bustInputHash() in scripts/v511-bake-busts.mjs: sha256 over "<path>\n<contents>" for each input in order. */
async function inputHash(inputs: string[]): Promise<string> {
  const text = inputs.map((f) => `${f}\n${(sources[f] ?? '').replace(/\r\n/g, '\n')}`).join('');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('baked hero busts', () => {
  const campClasses = ['heir', ...RECRUIT_CLASSES];

  it('covers every class the camp shows', () => {
    for (const cls of campClasses) expect(BAKED_BUSTS as readonly string[], `no baked bust listed for ${cls}`).toContain(cls);
    expect(bakedBustUrl('mage')).toMatch(/busts\/pyromancer\.webp$/);
  });

  it('has a WebP file for every baked class', () => {
    for (const cls of BAKED_BUSTS) {
      const url = images[cls];
      expect(url, `public/busts/${cls}.webp is missing. ${REBAKE}`).toBeTruthy();
      const bytes = atob(url!.slice(url!.indexOf(',') + 1));
      expect(bytes.slice(0, 4) + bytes.slice(8, 12), `${cls}.webp is not a WebP`).toBe('RIFFWEBP');
      expect(bytes.length).toBeGreaterThan(500);
    }
  });

  it('was baked from the current rig sources', async () => {
    expect([...manifest.inputs].sort(), 'the bake script and this test hash different files').toEqual(Object.keys(sources).sort());
    expect(Object.keys(manifest.files).sort()).toEqual([...BAKED_BUSTS].sort());
    expect(manifest.hash, `The bust render's sources changed since the busts were baked. ${REBAKE}`).toBe(await inputHash(manifest.inputs));
  });
});
