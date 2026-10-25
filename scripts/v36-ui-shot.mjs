// One scene for the V3.6 before/after pair: Keven stands on the main gate with the heirloom in his
// pack, selected, camera on him. Works on older builds too (it only uses window.vc/vcEngine).
//   node scripts/v36-ui-shot.mjs <baseUrl> <out.png>
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';

const [base, out] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
await p.route(/fonts\./, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
const idle = () => p.waitForFunction(() => window.vc && !window.vc.busy(), null, { timeout: 60000 });
await p.goto(base);
await p.evaluate(() => { localStorage.clear(); localStorage.setItem('vc.settings', JSON.stringify({ speed: 0, reduceShake: true, noEndTurnAsk: true })); });
await p.reload();
await p.waitForFunction(() => !!window.vc);
await p.evaluate(async () => {
  const E = window.vcEngine;
  window.vc.load(E.apply(E.newGame(42), { type: 'newCampaign', seed: 42 }).state);
  for (let i = 0; i < 3; i++) {
    const s = window.vc.state();
    const ids = s.campaign.roster.slice(0, 4).map((h) => h.id);
    if (!E.partyProblem(s, ids) && s.campaign.roster.length >= 2) break;
    const r = s.campaign.recruits.find((x) => x.price <= s.campaign.gold);
    if (!r) break;
    await window.vc.send({ type: 'hire', heroId: r.hero.id });
  }
  const s = window.vc.state();
  const k = s.campaign.board.find((x) => x.kind === 'recover' && !x.story) ?? s.campaign.board[0];
  await window.vc.send({ type: 'startDelve', contractId: k.id, heroIds: s.campaign.roster.slice(0, 4).map((h) => h.id), entrance: 0, packs: {} });
});
await idle();
await p.evaluate(() => {
  const s = structuredClone(window.vc.state());
  const e = window.vcEngine.castle().entrances[0];
  const h = s.delve.heroes[0];
  for (const o of s.delve.heroes) if (o !== h && o.at.q === e.q && o.at.r === e.r) o.at = { ...e, q: e.q + 1 };
  h.at = e;
  h.moved = false;
  h.acted = false;
  const g = s.delve.ground.find((x) => x.items.some((i) => i.kind === 'heirloom'));
  if (g) {
    h.pack.push(...g.items.filter((i) => i.kind === 'heirloom'));
    g.items = g.items.filter((i) => i.kind !== 'heirloom');
  } else h.pack.push({ id: 'hx', kind: 'heirloom', name: 'the heirloom', amount: 60, slots: 2, contractId: s.delve.contract.id });
  window.vc.load(s);
  window.vc.hud.select(h.heroId);
  window.vc.dio.lookAt(h.at, true);
  window.vc.dio.rig.distance = 16;
  window.vc.hud.onHover(e, null);
});
await p.waitForTimeout(700);
await p.evaluate(() => window.vc.dio.renderNow());
await p.screenshot({ path: out });
console.log('wrote', out);
await b.close();
