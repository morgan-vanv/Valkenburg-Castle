// V5.0 (G): fixed camera shots of a named room in the new look, for the owner's review.
// Starts a first delve on the real engine, moves the party into the room, marks it explored, lights
// Keven's torch, hides the HUD and saves default / close / zoomed-out / rotated shots at High and Low.
// SwiftShader is slow: every wait and screenshot gets about three minutes.
//   node scripts/v50-look-shots.mjs <baseUrl> <outDir> [room[,room...]=hall] [width height]   (QUALITY=high to skip Low)
//   (serve first: npx vite preview --port 4185 --strictPort → http://localhost:4185/)
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';

const [base = 'http://localhost:4185/', out = '.', roomArg = 'hall', W = '1440', H = '900'] = process.argv.slice(2);
const ROOM_LIST = roomArg.split(',');
mkdirSync(out, { recursive: true });
const SLOW = 180000;
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

/** Where the party stands in a room (axial), and the shots' look-at. Rooms not listed here are found by id in
 * the castle data: the party stands on the walkable hexes nearest the room's label, the camera looks at the label. */
const ROOMS = {
  // The party near the dais, so the north wall, the high table and the flanking pillars are in the shot.
  hall: { level: 1, at: [{ q: 18, r: 11 }, { q: 17, r: 11 }, { q: 19, r: 10 }, { q: 17, r: 12 }], look: { q: 18, r: 10 } },
  // The W3 lineup: rows of figures in the hall (see `lineup` in the setup); shots face them.
  lineup: { level: 1, at: [{ q: 18, r: 11 }], look: { q: 15, r: 14 }, shots: [{ name: 'heroes', distance: 12, yaw: Math.PI, look: { q: 17, r: 11 } }, { name: 'monsters', distance: 12, yaw: Math.PI, look: { q: 12, r: 14 } }, { name: 'crews', distance: 12, yaw: Math.PI, look: { q: 11, r: 17 } }, { name: 'crews2', distance: 11, yaw: Math.PI, look: { q: 23, r: 17 } }, { name: 'all', distance: 22, yaw: Math.PI }] },
};
const WALKABLE = new Set(['floor', 'rubble', 'door', 'stairs', 'exit', 'lift']);

async function session(quality, room) {
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
  let spot = ROOMS[room];
  if (!spot) {
    spot = await p.evaluate(({ room, WALKABLE }) => {
      for (const lv of window.vc.dio.castle.levels) {
        const r = lv.rooms.find((x) => x.id === room);
        if (!r) continue;
        const L = r.labelAt;
        const dist = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
        const hexes = Object.entries(lv.tiles)
          .filter(([, t]) => t.room === room && WALKABLE.includes(t.kind) && !t.raised)
          .map(([k]) => ({ q: Number(k.split(',')[0]), r: Number(k.split(',')[1]) }))
          .sort((a, b) => dist(a, L) - dist(b, L));
        return { level: lv.level, at: hexes.slice(0, 4), look: { q: L.q, r: L.r } };
      }
      return null;
    }, { room, WALKABLE: [...WALKABLE] });
    if (!spot) throw new Error(`unknown room ${room}`);
  }
  spot.rooms = room === 'hall' || room === 'lineup' ? ['hall', 'dais'] : [room];
  if (room === 'lineup') spot.lineup = true;
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
    const roomIds = new Set(spot.rooms);
    const inRoom = Object.entries(lv.tiles).filter(([, t]) => roomIds.has(t.room)).map(([k]) => k.split(',').map(Number));
    for (const [key] of Object.entries(lv.tiles)) {
      const [q, r] = key.split(',').map(Number);
      if (inRoom.some(([q2, r2]) => Math.max(Math.abs(q - q2), Math.abs(r - r2), Math.abs(q + r - q2 - r2)) <= 1)) keys.add(`${spot.level}:${key}`);
    }
    d.delve.explored = [...keys];
    if (spot.lineup) {
      // W3 lineup: every hero class, every monster, the Sisters, crew members and the prisoner, in rows facing the camera.
      const ax = (col, row) => ({ level: spot.level, q: col - Math.floor(row / 2), r: row });
      const c = d.campaign;
      const base = c.roster.find((r) => r.id === d.delve.heroes[0].heroId);
      const hb = d.delve.heroes[0];
      d.delve.heroes = [];
      ['heir', 'sellsword', 'burglar', 'mage', 'ranger', 'sapper', 'pyromancer', 'shadowmancer', 'hedgewitch'].forEach((cls, i) => {
        const id = `lineup-${cls}`;
        c.roster.push({ ...structuredClone(base), id, cls, name: cls });
        d.delve.heroes.push({ ...structuredClone(hb), heroId: id, at: ax(18 + i, 11), facing: 2, status: 'active', carrying: undefined, sneaked: false });
      });
      // Rows 11 (heroes), 14 (monsters) and 17 (crews), seen from the north so each row stands clear of the next.
      const monsters = ['rats', 'orc', 'spider', 'cutpurse', 'berserker', 'archer', 'captain', 'ghoul'];
      d.delve.monsters = monsters.map((kind, i) => ({ id: `lineup-m-${kind}`, kind, name: kind, at: ax(15 + i, 14), hp: 5, maxHp: 5, awareness: 'unaware', spawnedAt: ax(15 + i, 14), facing: 2 }));
      d.delve.monsters.push({ id: 'lineup-m-gloam', kind: 'gloam', name: 'the Gloam', at: ax(16, 15), hp: 5, maxHp: 5, awareness: 'unaware', spawnedAt: ax(16, 15), facing: 2 });
      const crew = [
        ['lantern-sisters', 'sellsword', 15], ['lantern-sisters', 'ranger', 16], ['lantern-sisters', 'shadowmancer', 17], ['lantern-sisters', 'burglar', 18],
        ['ferrymen', 'sellsword', 19], ['ferrymen', 'ranger', 20], ['ferrymen', 'pyromancer', 21], ['gallows-choir', 'shadowmancer', 22], ['gallows-choir', 'burglar', 30], ['the-wake', 'hedgewitch', 31], ['the-wake', 'sapper', 32],
      ];
      const members = crew.map(([cr, cls, col], i) => ({ id: `lineup-r-${i}`, crew: cr, name: `${cr} ${cls}`, at: ax(col, 17), hp: 5, maxHp: 5, loot: [], goneOut: false, cls, facing: 2 }));
      if (d.delve.rivals) { d.delve.rivals.members = members; d.delve.rivals.entersRound = 0; d.delve.rivals.entered = true; }
      else d.delve.rivals = { crew: 'lantern-sisters', name: 'Lineup', temperament: 'prospector', stance: 'neutral', goal: 'loot', members, entersRound: 0, entered: true };
      d.delve.prisoner = { id: 'lineup-prisoner', name: 'Prisoner', at: ax(33, 17), hp: 3, freed: true, out: false, dead: false };
    }
    // Everyone carries a lit torch, so a room without fixed light still shows lit.
    for (const h of d.delve.heroes) h.pack.push({ id: `shot-torch-${h.heroId}`, kind: 'torch', name: 'Torch', amount: 1, slots: 1, lit: true, rounds: 15 });
    window.vc.load(d);
    return 'ok';
  }, spot);
  console.log(`[${quality}] ${room} L${spot.level} setup: ${ok}`);
  await p.waitForFunction(() => window.vc && !window.vc.busy(), null, { timeout: SLOW });
  await p.waitForTimeout(600);
  // The look is the question: hide the HUD and the tags, leave the 3D view.
  await p.addStyleTag({ content: '.dl-hud, .dio-fx { visibility: hidden !important; }' });
  await p.evaluate(() => { const d = window.vc.dio; d.select(null); d.setFollow(null); d.clearHighlights(); d.showPath(null); d.showSight(null); d.setHover(null); });
  // The look is the question: markers and rings off unless OVERLAY=1.
  if (!process.env.OVERLAY) await p.evaluate(() => { window.vc.dio.overlayScene.visible = false; });
  p.spot = spot;
  return p;
}

const SHOTS = [
  { name: 'default', distance: 16, yaw: 0.35 },
  { name: 'close', distance: 9, yaw: 0.35 },
  { name: 'out', distance: 26, yaw: 0.35 },
  { name: 'rotated', distance: 16, yaw: 0.35 + (2 * Math.PI) / 3 },
];

const QUALITIES = (process.env.QUALITY ?? 'high,low').split(',');
for (const room of ROOM_LIST) for (const quality of QUALITIES) {
  const p = await session(quality, room);
  const spot = p.spot;
  for (const sh of spot.shots ?? SHOTS) {
    await p.evaluate(({ spot, sh }) => {
      const dio = window.vc.dio;
      dio.lookAt({ level: spot.level, ...(sh.look ?? spot.look) }, true);
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
