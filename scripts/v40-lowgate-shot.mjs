// V4.0 Lowgate screenshots: each step on a fresh campaign and mid-campaign (forge, Flagon and
// copper home, valuables on the cart, a wounded hero, a fallen hero, explored map if the engine
// remembers it), plus the cart and the graves. Scratch output only.
//   node scripts/v40-lowgate-shot.mjs <baseUrl> <outDir> [width height]
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';

const [base = 'http://localhost:4174/', out = '.', W = '1440', H = '900'] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: Number(W), height: Number(H) } });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
p.on('console', (m) => m.type() === 'error' && console.log('[console]', m.text()));
await p.goto(base);
await p.evaluate(() => { localStorage.clear(); localStorage.setItem('vc.settings', JSON.stringify({ speed: 0, reduceShake: true, noEndTurnAsk: true })); });
await p.reload();
await p.waitForFunction(() => !!window.vc);
const tag = `${W}`;
const shot = async (name) => { await p.mouse.move(2, Number(H) / 2); await p.waitForTimeout(150); await p.screenshot({ path: `${out}/${tag}-${name}.png` }); };
const step = async (s) => { await p.click(`.lg-step[data-step="${s}"]`); await p.waitForTimeout(100); };

// fresh
await p.evaluate(() => { const E = window.vcEngine; window.vc.load(E.apply(E.newGame(42), { type: 'newCampaign', seed: 42 }).state); });
await p.waitForTimeout(200);
await shot('fresh-1-job');
await step('party');
await shot('fresh-2-party');
await p.hover('.lg-ab >> nth=2');
await p.waitForTimeout(150);
await p.screenshot({ path: `${out}/${tag}-fresh-2-party-hover.png` });
await p.click('.lg-hire >> nth=0');
await step('outfit');
await shot('fresh-3-outfit');
await p.click('[data-ware="torch"]');
await p.click('[data-ware="potion"]').catch(() => {});
await shot('fresh-3-outfit-bought');
await step('setout');
await shot('fresh-4-setout');

// mid-campaign
await p.evaluate(() => {
  const E = window.vcEngine;
  let s = E.apply(E.newGame(7), { type: 'newCampaign', seed: 7 }).state;
  s = structuredClone(s);
  const c = s.campaign;
  c.gold = 340;
  c.delveCount = 4;
  c.reputation = 2;
  c.village = { surgeon: true, innkeeper: true, smith: true, copper: true, caskbook: false };
  for (const r of c.recruits.slice(0, 2)) c.roster.push(r.hero);
  c.recruits = c.recruits.slice(2);
  c.roster[1].hp = Math.max(1, c.roster[1].maxHp - 4);
  c.roster[0].weaponTier = 1;
  c.roster[0].shield = true;
  c.roster[0].ale = 'reserve';
  c.stash.push(
    { id: 'g1', kind: 'gem', name: 'Moonstone', amount: 70, slots: 1 },
    { id: 'g2', kind: 'jewelry', name: 'Silver torc', amount: 110, slots: 1 },
    { id: 'g3', kind: 'heirloom', name: 'Hobart signet', amount: 60, slots: 2 },
    { id: 't1', kind: 'torch', name: 'Torch', amount: 1, slots: 1 },
    { id: 'r1', kind: 'rope', name: 'Rope', amount: 1, slots: 1 },
    { id: 'p1', kind: 'potion', name: 'Potion', amount: 1, slots: 1 },
  );
  c.fallen.push({ name: 'Bram Ashby', cls: 'sellsword', level: 2, where: 'Level 1, great hall', delve: 2 }, { name: 'Tilda Reeve', cls: 'pyromancer', level: 1, where: 'Level 2, the crossing', delve: 3 });
  window.vc.load(s);
});
await p.waitForTimeout(200);
await shot('mid-1-job');
await step('party');
await shot('mid-2-party');
await step('outfit');
await shot('mid-3-outfit');
await p.click('[data-tab="cart"]');
await shot('mid-3-outfit-cart');
const ale = await p.$('[data-ale]');
if (ale) { await ale.click(); await shot('mid-3-outfit-ale'); await p.keyboard.press('Escape'); }
await step('setout');
await shot('mid-4-setout');
await p.click('[data-ribbon="graves"]');
await shot('mid-graves');
await p.click('[data-ribbon="cart"]');
await shot('mid-cart');
// a remembered Level 1 (stubbed until the engine remembers it) and three known ways in
await p.evaluate(() => {
  const E = window.vcEngine;
  const lv = E.castle().levels.find((l) => l.level === 1);
  const keys = Object.keys(lv.tiles).filter((k) => { const [q, r] = k.split(',').map(Number); return r > 10 && q > 4 && q < 38; });
  E.castleMemory = () => [{ level: 1, hexes: keys }];
  E.entrances = () => [
    { index: 0, name: 'Main gate', state: 'open', known: true },
    { index: 1, name: 'Sally port', state: 'locked', known: true, hint: 'Locked. The gate needs its key.' },
    { index: 2, name: 'East breach', state: 'open', known: true },
  ];
  const s = structuredClone(window.vc.state());
  window.vc.load(s);
});
await step('setout');
await shot('mid-4-setout-memory');
await p.evaluate(() => { delete window.vcEngine.castleMemory; delete window.vcEngine.entrances; });
await b.close();
