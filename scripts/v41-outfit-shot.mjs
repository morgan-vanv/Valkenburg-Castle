// V4.1 WS4 Outfit screenshots (spec 31.6): the two counters on a fresh campaign (Mott's wagon, the forge cold) and
// mid-campaign (Gerda, Wim and the copper home, Ilse away; a torch just bought into a pack; valuables on the cart),
// one per vendor tab, plus a locked row's hover. Scratch output except the one committed as docs/shots/v41-outfit.png.
//   node scripts/v41-outfit-shot.mjs <baseUrl> <outDir> [width height]
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';

const [base = 'http://localhost:4174/', out = '.', W = '1440', H = '900'] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: Number(W), height: Number(H) } });
await p.route(/fonts\./, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
p.on('console', (m) => m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource/.test(m.text()) && console.log('[console]', m.text()));
await p.goto(base);
await p.evaluate(() => { localStorage.clear(); localStorage.setItem('vc.settings', JSON.stringify({ speed: 0, reduceShake: true, noEndTurnAsk: true })); localStorage.setItem('vc.welcome.v40', '1'); });
await p.reload();
await p.waitForFunction(() => !!window.vc);
const tag = `${W}`;
const shot = async (name) => { await p.evaluate(() => { const m = document.querySelector('.lg-main'); if (m) m.scrollTop = 0; }); await p.mouse.move(2, Number(H) / 2); await p.waitForTimeout(200); await p.screenshot({ path: `${out}/${tag}-${name}.png` }); };
const step = async (s) => { await p.click(`.lg-step[data-step="${s}"]`); await p.waitForTimeout(120); };
const tab = async (t) => { await p.click(`[data-vendor-tab="${t}"]`); await p.waitForTimeout(120); };

// fresh: Keven and one hire
await p.evaluate(() => { const E = window.vcEngine; window.vc.load(E.apply(E.newGame(42), { type: 'newCampaign', seed: 42 }).state); });
await p.waitForTimeout(200);
await step('party');
await p.click('.lg-hire >> nth=0');
await step('outfit');
await shot('fresh-outfit-mott');
await tab('gerda');
await shot('fresh-outfit-gerda');
await tab('mott');

// mid-campaign
await p.evaluate(() => {
  const E = window.vcEngine;
  const s = structuredClone(E.apply(E.newGame(7), { type: 'newCampaign', seed: 7 }).state);
  const c = s.campaign;
  c.gold = 340;
  c.delveCount = 4;
  c.reputation = 2;
  Object.assign(c.village, { surgeon: true, innkeeper: true, smith: true, copper: true, caskbook: false, alchemist: false });
  c.credits = { shield: 1 };
  for (const r of c.recruits.slice(0, 2)) c.roster.push(r.hero);
  c.recruits = c.recruits.slice(2);
  c.roster[0].weaponTier = 1;
  c.roster[0].ale = 'reserve';
  c.roster[1].shield = true;
  c.stash.push(
    { id: 'g1', kind: 'gem', name: 'Moonstone', amount: 70, slots: 1 },
    { id: 'g2', kind: 'jewelry', name: 'Silver torc', amount: 110, slots: 1 },
    { id: 'r1', kind: 'rope', name: 'Rope', amount: 1, slots: 1 },
    { id: 'p1', kind: 'potion', name: 'Potion', amount: 1, slots: 1 },
    { id: 'p2', kind: 'potion', name: 'Potion', amount: 1, slots: 1 },
  );
  window.vc.load(s);
});
await p.waitForTimeout(200);
await step('party');
for (const id of await p.$$eval('[data-bench]', (els) => els.map((e) => e.dataset.bench))) await p.click(`[data-bench="${id}"]`);
await step('outfit');
await p.click('[data-cart="potion"]'); // V5.1 (W3): lift it off the wagon, then click a pack
await p.click('[data-side="yours"] .hr .bw');
await p.waitForTimeout(100);
await p.click('[data-buy="torch"]');
await p.waitForTimeout(150);
await p.screenshot({ path: `${out}/${tag}-mid-outfit-mott.png` });
await tab('gerda');
await shot('mid-outfit-gerda');
await tab('ilse');
await shot('mid-outfit-ilse');
await p.hover('[data-row="dart"]:not([hidden])').catch(() => {}); // V5.1: a strip tile, maybe on a later page
await p.waitForTimeout(150);
await p.screenshot({ path: `${out}/${tag}-mid-outfit-ilse-hint.png` });
await tab('flagon');
await shot('mid-outfit-flagon');
await b.close();
