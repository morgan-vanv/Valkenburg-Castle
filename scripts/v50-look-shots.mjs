// V5.0 (G): fixed camera shots of a named room in the new look, for the owner's review.
// Starts a first delve on the real engine, moves the party into the room, marks it explored, lights
// Keven's torch, hides the HUD and saves default / close / zoomed-out / rotated shots at High and Low.
// SwiftShader is slow: every wait and screenshot gets about three minutes.
//   node scripts/v50-look-shots.mjs <baseUrl> <outDir> [room=hall] [width height]
//   (serve first: npx vite preview --port 4185 --strictPort → http://localhost:4185/)
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';

const [base = 'http://localhost:4185/', out = '.', room = 'hall', W = '1440', H = '900'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const SLOW = 180000;
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

/** Where the party stands in each room (axial), facing the camera; and the shots' look-at. */
const ROOMS = {
  // The party near the dais, so the north wall, the high table and the flanking pillars are in the shot.
  hall: { level: 1, at: [{ q: 18, r: 11 }, { q: 17, r: 11 }, { q: 19, r: 10 }, { q: 17, r: 12 }], look: { q: 18, r: 10 } },
};

async function session(quality) {
  const p = await b.newPage({ viewport: { width: Number(W), height: Number(H) } });
  p.setDefaultNavigationTimeout(SLOW);
  p.setDefaultTimeout(SLOW);
  p.on('pageerror', (e) => console.log('[pageerror]', e.message));
  p.on('console', (m) => m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource/.test(m.text()) && console.log('[console]', m.text()));
  await p.route(/fonts\./, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await p.goto(`${base}${base.includes('?') ? '&' : '?'}quality=${quality}`);
  await p.evaluate((q) => {
    localStorage.clear();
    localStorage.setItem('vc.welcome.v40', '1');
    localStorage.setItem('vc.settings', JSON.stringify({ speed: 0, reduceShake: true, noEndTurnAsk: true, quality: q }));
  }, quality);
  await p.reload();
  await p.waitForFunction(() => !!window.vc, null, { timeout: SLOW });
  const spot = ROOMS[room];
  if (!spot) throw new Error(`unknown room ${room}`);
  const ok = await p.evaluate(async (spot) => {
    const E = window.vcEngine;
    const s = E.newGame(11);
    s.campaign.gold = 1000;
    s.campaign.squadSlots = 4;
    window.vc.load(s);
    for (const r of window.vc.state().campaign.recruits) await window.vc.send({ type: 'hire', heroId: r.hero.id });
    for (const k of ['torch', 'potion']) await window.vc.send({ type: 'buy', kind: k });
    const st = window.vc.state();
    const ids = st.campaign.roster.slice(0, 4).map((h) => h.id);
    const stash = st.campaign.stash.map((i) => i.id);
    const k = st.campaign.board[0];
    await window.vc.send({ type: 'startDelve', contractId: k.id, heroIds: ids, entrance: 0, packs: { [ids[0]]: stash.slice(0, 2) } });
    const d = structuredClone(window.vc.state());
    if (!d.delve) return 'no delve';
    d.delve.heroes.forEach((h, i) => {
      const at = spot.at[i] ?? spot.at[0];
      h.at = { level: spot.level, ...at };
    });
    for (const i of d.delve.heroes[0].pack) if (i.kind === 'torch') i.lit = true;
    // Mark the room (and a ring around it) explored, so its walls and floor show.
    const lv = window.vc.dio.castle.levels.find((l) => l.level === spot.level);
    const keys = new Set(d.delve.explored);
    for (const [key, t] of Object.entries(lv.tiles)) {
      const [q, r] = key.split(',').map(Number);
      const near = Object.entries(lv.tiles).some(([k2, t2]) => (t2.room === 'hall' || t2.room === 'dais') && Math.max(Math.abs(q - Number(k2.split(',')[0])), Math.abs(r - Number(k2.split(',')[1]))) <= 1);
      if (t.room === 'hall' || t.room === 'dais' || near) keys.add(`${spot.level}:${key}`);
    }
    d.delve.explored = [...keys];
    window.vc.load(d);
    return 'ok';
  }, spot);
  console.log(`[${quality}] setup: ${ok}`);
  await p.waitForFunction(() => window.vc && !window.vc.busy(), null, { timeout: SLOW });
  await p.waitForTimeout(600);
  // The look is the question: hide the HUD and the tags, leave the 3D view.
  await p.addStyleTag({ content: '.dl-hud, .dio-fx { visibility: hidden !important; }' });
  await p.evaluate(() => { const d = window.vc.dio; d.select(null); d.setFollow(null); d.clearHighlights(); d.showPath(null); d.showSight(null); d.setHover(null); });
  return p;
}

const SHOTS = [
  { name: 'default', distance: 16, yaw: 0.35 },
  { name: 'close', distance: 9, yaw: 0.35 },
  { name: 'out', distance: 26, yaw: 0.35 },
  { name: 'rotated', distance: 16, yaw: 0.35 + (2 * Math.PI) / 3 },
];

for (const quality of ['high', 'low']) {
  const p = await session(quality);
  const spot = ROOMS[room];
  for (const sh of SHOTS) {
    await p.evaluate(({ spot, sh }) => {
      const dio = window.vc.dio;
      dio.lookAt({ level: spot.level, ...spot.look }, true);
      dio.rig.distance = sh.distance;
      dio.rig.yaw = sh.yaw;
      dio.rig.pitchBias = 0;
      for (let i = 0; i < 3; i++) dio.renderNow();
    }, { spot, sh });
    await p.waitForTimeout(300);
    await p.evaluate(() => window.vc.dio.renderNow());
    await p.screenshot({ path: `${out}/${room}-${sh.name}-${quality}.png`, timeout: SLOW });
    console.log(`[${quality}] ${sh.name}`);
  }
  await p.close();
}
await b.close();
