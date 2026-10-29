// V5.3 (spec 36): the title's castle is a baked image (public/title, scripts/v53-bake-title.mjs). Every bake's
// manifest matches the render's sources, so a change to the castle (or the look modules it uses) without a rebake
// fails here; its images exist; it sits on the stage and its lights fall inside it.
import { describe, expect, it } from 'vitest';

const REBAKE = 'Run `node scripts/v53-bake-title.mjs` (and DRAGON=asleep / peek for the Dragon variants) and commit public/title and src/ui/camp/title-bake.';
const INPUTS = ['src/ui/camp/title-scene.ts', 'src/view/look/floors.ts', 'src/view/look/walls.ts', 'src/view/look/dragon.ts', 'src/view/look/rig.ts'];

const sources: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>(['/src/ui/camp/title-scene.ts', '/src/view/look/floors.ts', '/src/view/look/walls.ts', '/src/view/look/dragon.ts', '/src/view/look/rig.ts'], {
      query: '?raw',
      import: 'default',
      eager: true,
    }),
  ).map(([k, v]) => [k.slice(1), v]),
);
const images = new Set(Object.keys(import.meta.glob('/public/title/*.webp', { query: '?url', eager: true })).map((k) => k.replace(/^.*\//, '')));
interface Manifest { file: string; file2x: string; x: number; y: number; w: number; h: number; glows: { x: number; y: number; r: number; kind: string }[]; inputs: string[]; hash: string }
const bakes = import.meta.glob<Manifest>('./title-bake/*.json', { eager: true, import: 'default' });

async function inputHash(inputs: string[]): Promise<string> {
  const text = inputs.map((f) => `${f}\n${(sources[f] ?? '').replace(/\r\n/g, '\n')}`).join('');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('the baked title castle', () => {
  it('has the plain castle', () => {
    expect(bakes['./title-bake/castle.json'], REBAKE).toBeTruthy();
  });
  for (const [path, m] of Object.entries(bakes)) {
    describe(path, () => {
      it('lists the same inputs as the bake script', () => {
        expect(m.inputs).toEqual(INPUTS);
        for (const f of INPUTS) expect(sources[f], `missing ${f}`).toBeTruthy();
      });
      it('matches its sources (else rebake)', async () => {
        expect(m.hash, REBAKE).toBe(await inputHash(m.inputs));
      });
      it('has its images', () => {
        expect(images.has(m.file), `${m.file}: ${REBAKE}`).toBe(true);
        expect(images.has(m.file2x), `${m.file2x}: ${REBAKE}`).toBe(true);
      });
      it('sits on the stage, right of the lockup, with its lights inside it', () => {
        expect(m.x).toBeGreaterThanOrEqual(700);
        expect(m.x + m.w).toBeLessThanOrEqual(1920.5);
        expect(m.y + m.h).toBeLessThanOrEqual(1080.5);
        expect(m.glows.length).toBeGreaterThan(0);
        for (const g of m.glows) {
          expect(g.x).toBeGreaterThanOrEqual(m.x);
          expect(g.x).toBeLessThanOrEqual(m.x + m.w);
          expect(g.y).toBeGreaterThanOrEqual(m.y);
          expect(g.y).toBeLessThanOrEqual(m.y + m.h);
        }
      });
    });
  }
});
