// V3.8 screenshot: vision cones and a patrol mid-walk, on the real castle (spec 22.8).
// The party stands sneaking a few hexes from a patrol that can be seen (its cone in view, no notice),
// the clock runs, and the shot is taken while the patrol slides between hexes.
//   node scripts/v38-ui-shot.mjs <baseUrl> <out.png>
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';

const [base = 'http://localhost:5185/', out = 'docs/agents/v38-shots/v38-cones-patrol.png'] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
await p.route(/fonts\./, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.goto(base);
await p.evaluate(() => { localStorage.clear(); localStorage.setItem('vc.settings', JSON.stringify({ speed: 1, reduceShake: true, noEndTurnAsk: true })); });
await p.reload();
await p.waitForFunction(() => !!window.vc);
await p.evaluate(async () => {
  const E = window.vcEngine;
  const s = E.apply(E.newGame(7), { type: 'newCampaign', seed: 7 }).state;
  s.campaign.gold = 400;
  window.vc.load(s);
  for (let i = 0; i < 2; i++) {
    const t = window.vc.state();
    const r = t.campaign.recruits.find((x) => x.price <= t.campaign.gold);
    if (r) await window.vc.send({ type: 'hire', heroId: r.hero.id });
  }
  const t = window.vc.state();
  await window.vc.send({ type: 'startDelve', contractId: t.campaign.board[0].id, heroIds: t.campaign.roster.slice(0, 4).map((h) => h.id), entrance: 0, packs: {} });
});
await p.waitForFunction(() => window.vc && !window.vc.busy());
// Stage it: a patrol on Level 1, the party sneaking 5–7 hexes off, where the patrol is in view and doesn't see them.
const staged = await p.evaluate(() => {
  window.vc.hud.togglePause(true);
  const E = window.vcEngine;
  const s0 = structuredClone(window.vc.state());
  const d = s0.delve;
  const castle = E.castle();
  const key = (q) => `${q.level}:${q.q},${q.r}`;
  const dist = (a, c) => Math.max(Math.abs(a.q - c.q), Math.abs(a.r - c.r), Math.abs(a.q + a.r - c.q - c.r));
  const pats = d.monsters.filter((m) => m.awareness === 'patrol' && m.route?.length && m.hp > 0);
  for (const m of pats) {
    const lv = castle.levels.find((l) => l.level === m.at.level);
    const spots = Object.keys(lv.tiles).map((k) => { const [q, r] = k.split(',').map(Number); return { level: m.at.level, q, r }; }).filter((q) => lv.tiles[`${q.q},${q.r}`].kind === 'floor' && dist(q, m.at) >= 5 && dist(q, m.at) <= 7);
    for (const lead of spots) {
      const ring = [[0, 0], [1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]].map(([a, c]) => ({ level: lead.level, q: lead.q + a, r: lead.r + c })).filter((q) => lv.tiles[`${q.q},${q.r}`]?.kind === 'floor' && !d.monsters.some((x) => key(x.at) === key(q)));
      if (ring.length < d.heroes.length) continue;
      const s = structuredClone(s0);
      s.delve.heroes.forEach((h, i) => { h.at = ring[i]; h.sneaking = true; delete h.walk; });
      for (const k of Object.keys(lv.tiles)) { const [q, r] = k.split(',').map(Number); if (dist({ q, r }, lead) <= 9) s.delve.explored.push(`${lead.level}:${k}`); }
      const vis = E.visibility(s);
      if (!vis.visible.has(key(m.at))) continue;
      const v = E.vision(s).find((x) => x.id === m.id);
      if (!v || !v.walk.length) continue;
      // Safe now and after a few patrol steps (sneak hexes clear of every hero, with a margin).
      const near = (q) => s.delve.heroes.some((h) => dist(h.at, q) <= 1);
      if (v.sneak.some(near)) continue;
      window.vc.load(s);
      window.vc.hud.select(s.delve.heroes[0].heroId);
      window.vc.dio.lookAt(m.at, true);
      return { id: m.id, at: m.at, lead };
    }
  }
  return null;
});
console.log('staged', JSON.stringify(staged));
if (!staged) process.exit(1);
// Frame the patrol and the party, then run the clock until the patrol is sliding.
await p.evaluate(({ at, lead }) => {
  const mid = { level: at.level, q: Math.round((at.q + lead.q) / 2), r: Math.round((at.r + lead.r) / 2) };
  window.vc.dio.lookAt(mid, true);
  window.vc.dio.rig.distance = 17;
  window.vc.hud.togglePause(false);
}, staged);
const caught = await p.evaluate(async (id) => {
  for (let i = 0; i < 400; i++) {
    if (window.vc.state().delve.mode !== 'explore') return 'combat';
    if (window.vc.dio.isGliding(id)) {
      // Halfway through the slide.
      await new Promise((r) => setTimeout(r, 450));
      window.vc.hud.togglePause(true);
      window.vc.dio.updateGlides(performance.now() / 1000);
      window.vc.dio.glides.clear(); // hold the figures where they are, mid-slide
      return 'gliding';
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  return 'timeout';
}, staged.id);
console.log('caught', caught);
// Hide the paused overlay for the picture (the clock stays stopped).
await p.evaluate(() => {
  const hud = window.vc.hud;
  hud.paused = false;
  hud.renderMode();
  hud.paused = true;
  document.querySelector('.hud-paused')?.classList.add('hidden');
  window.vc.dio.renderNow();
});
await p.screenshot({ path: out, timeout: 180000 });
console.log('shot', out);
await b.close();
