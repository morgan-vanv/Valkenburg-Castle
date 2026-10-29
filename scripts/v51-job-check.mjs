// V5.1 (W1) check: the camp frame and the Job board on the 1920x1080 stage, headless (real engine).
// At 1280x720, 1366x768, 1440x900, 1920x1080 and 2560x1440: no page scrollbars, nothing in the camp scrolls, the
// header is 92 stage px, main 1920x900 under it, the footer 88 at the bottom; the welcome card is an overlay; the
// board holds at most 3 + 3 cards (a full board seeded: two pleas, a captive, four bounties); a card's hover tip sits
// next to the card in window space; choosing a card puts its brief in the footer line; the purse is a coin stack
// that keeps its element and grows with the gold; the wagon and the gravestone open their pages, with badges.
// Screenshots go to SHOTS (default: the session scratchpad's v51-shots) as job-<w>.png and frame-<page>.png.
//   node scripts/v51-job-check.mjs <baseUrl>
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';

const [base = 'http://localhost:5191/'] = process.argv.slice(2);
const SHOTS = process.env.SHOTS ?? '/tmp/claude-0/-home-claude/26fe1399-920e-5ce0-9301-8b5617a58c1b/scratchpad/v51-shots';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
let errors = 0;
let failed = 0;
p.on('pageerror', (e) => (errors++, console.log('[pageerror]', e.message)));
p.on('console', (m) => m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource|fonts/.test(m.text()) && (errors++, console.log('[console]', m.text())));
const check = (name, ok, extra = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`);
};
const edit = (fn) => p.evaluate((f) => { const s = structuredClone(window.vc.state()); new Function('s', f)(s); window.vc.load(s); }, fn);
const page = () => p.evaluate(() => document.querySelector('.lowgate')?.dataset.page);
const wait = (ms = 120) => p.waitForTimeout(ms);

await p.goto(base);
await p.evaluate(() => { localStorage.clear(); localStorage.setItem('vc.settings', JSON.stringify({ speed: 0, reduceShake: true, noEndTurnAsk: true, quality: 'low' })); });
await p.reload();
await p.waitForFunction(() => !!window.vc);
await p.click('text=New campaign');
await p.waitForSelector('.camp.lowgate');
await p.evaluate(() => document.fonts?.ready);

/** Geometry of the frame in stage px, and anything that scrolls. */
const frame = () =>
  p.evaluate(() => {
    const root = document.querySelector('.camp.lowgate');
    const s = Number(getComputedStyle(root).getPropertyValue('--stage-scale')) || 1;
    const rr = root.getBoundingClientRect();
    const box = (sel) => {
      const r = root.querySelector(sel)?.getBoundingClientRect();
      return r ? { x: Math.round((r.left - rr.left) / s), y: Math.round((r.top - rr.top) / s), w: Math.round(r.width / s), h: Math.round(r.height / s) } : null;
    };
    const se = document.scrollingElement;
    const scrollers = [...document.querySelectorAll('.camp *')].filter((e) => {
      const o = getComputedStyle(e);
      return /auto|scroll/.test(o.overflowY + o.overflowX) && (e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1);
    }).map((e) => e.className);
    return {
      scale: s,
      pageScroll: se.scrollHeight > innerHeight || se.scrollWidth > innerWidth,
      stage: { w: Math.round(rr.width), h: Math.round(rr.height), x: Math.round(rr.left), y: Math.round(rr.top) },
      head: box('header.top'),
      main: box('main.camp-main'),
      foot: box('footer.foot'),
      scrollers,
    };
  });

// ---- the welcome overlay at 1920
let f = await frame();
check('1920: stage 1920x1080 at scale 1', f.scale === 1 && f.stage.w === 1920 && f.stage.h === 1080, JSON.stringify(f.stage));
check('welcome card is an overlay inside main (no scroll)', !!(await p.$('main .job-veil .lg-welcome')) && !f.pageScroll && !f.scrollers.length);
await p.screenshot({ path: `${SHOTS}/job-welcome-1920.png` });
await p.click('[data-welcome="ok"]');
await wait();
check('"Got it" dismisses it', !(await p.$('.lg-welcome')));
check('no house ribbon, no old footer markup', !(await p.$('.lg-ribbon')) && !(await p.$('.lg-house')));

// ---- a full board: two pleas, a captive, four bounties
await edit(`
  const c = s.campaign;
  const plea = c.board.find((k) => k.story);
  const hire = c.board.filter((k) => !k.story);
  if (plea) c.board.push({ ...plea, id: 'test-copper', story: 'copper', kind: 'recover', title: 'Recover the brewing copper', brief: 'The Flagon\\'s brewing copper was dragged off to the kitchens.', warnings: [] });
  c.board.push({ id: 'test-cap', kind: 'rescue', title: 'Bring back Hild', brief: 'Hild is held by the Lantern Sisters in their hideout.', siteId: 'hideout-test', level: 2, bounty: 0, warnings: ['The Lantern Sisters', 'Level 2', 'Held at HP 1'] });
  c.captives = [...(c.captives ?? []), { hero: { id: 'hild', name: 'Hild', cls: 'burglar', level: 2, xp: 0, maxHp: 8, hp: 1, stats: { might: 30, finesse: 65, wits: 50, nerve: 40 }, weaponTier: 0, armorTier: 0, wounded: 0, kills: 0, delves: 2 }, crew: 'lantern-sisters', siteId: 'hideout-test', delve: 2 }];
  for (let i = 0; i < 2; i++) for (const k of hire.slice(0, 2)) c.board.push({ ...k, id: k.id + '-x' + i, bounty: k.bounty + 50 * (i + 1), warnings: i ? ['Heavy: its carrier moves 3', 'Nearby: a spider'] : k.warnings });
  c.reputation = 2;
`);
await wait(200);
const rows = await p.$$eval('.lg-board-row', (els) => els.map((e) => ({ id: e.dataset.row, n: e.querySelectorAll('.lg-card').length })));
check('a full board shows 3 + 3 cards', rows.length === 2 && rows.every((r) => r.n === 3), JSON.stringify(rows));
check('no "Pinned by the village" on each card, no "Bounties pay only" line', !/Pinned by the village/.test(await p.$$eval('.lg-card', (els) => els.map((e) => e.innerText).join(' '))) && !/Bounties pay only/.test(await p.$eval('.camp', (e) => e.innerText)));
check('no brief text on the cards', !(await p.$('.lg-card .lg-card-brief')));
check('gold pay shows as a coin stack, a plea as a gift', !!(await p.$('.lg-card .pay .coinstack i')) && !!(await p.$('.lg-card.story .pay.gift')));
check('risk marks are hexes with tips', (await p.$$('.lg-card .risk[data-tip]')).length > 0);
check('renown: three crowns, two lit', (await p.$$('.lg-renown .ic-crown')).length === 3 && (await p.$$('.lg-renown .ic-crown.on')).length === 2);
check('captive card: a bust and "Bring back"', !!(await p.$('.lg-card.captive .cap .bust')) && /Bring back/i.test(await p.$eval('.lg-card.captive .typ', (e) => e.innerText)));

for (const [w, hh] of [[1280, 720], [1366, 768], [1440, 900], [1920, 1080], [2560, 1440]]) {
  await p.setViewportSize({ width: w, height: hh });
  await wait(200);
  f = await frame();
  const want = Math.min(w / 1920, hh / 1080);
  check(`${w}x${hh}: scale ${want.toFixed(3)}, no page scrollbars, nothing scrolls`, Math.abs(f.scale - want) < 0.002 && !f.pageScroll && !f.scrollers.length, f.scrollers.join(','));
  check(`${w}x${hh}: header 0..92, main 92..992 (1920x900), footer 992..1080`, f.head?.y === 0 && f.head.h === 92 && f.main?.y === 92 && f.main.h === 900 && f.main.w === 1920 && f.foot?.y === 992 && f.foot.h === 88, JSON.stringify([f.head, f.main, f.foot]));
  const cards = await p.$$eval('.lg-card', (els) => els.map((e) => e.getBoundingClientRect()).map((r) => r.bottom));
  const mainB = await p.$eval('main.camp-main', (e) => e.getBoundingClientRect().bottom);
  check(`${w}x${hh}: every card inside main`, cards.every((y) => y <= mainB + 1));
  // a hover tip in window space, right by the card
  const card = await p.$('.lg-board-hire .lg-card >> nth=1');
  const cb = await card.boundingBox();
  await p.mouse.move(cb.x + cb.width / 2, cb.y + cb.height * 0.6);
  await wait(120);
  const tip = await p.evaluate(() => { const t = document.querySelector('#lg-tip'); const r = t.getBoundingClientRect(); return { shown: !t.classList.contains('hidden'), x: r.left, y: r.top, b: r.bottom, w: r.width, text: t.innerText }; });
  const near = tip.shown && Math.abs(tip.x - cb.x) < 12 && ((tip.y >= cb.y + cb.height && tip.y - (cb.y + cb.height) < 30 * want + 4) || (tip.b <= cb.y && cb.y - tip.b < 30 * want + 4)) && tip.b <= hh && tip.x + tip.w <= w;
  check(`${w}x${hh}: a card's tip shows its brief, right by the card, in the window`, near && tip.text.length > 30, JSON.stringify({ tip: [tip.x, tip.y, tip.b].map(Math.round), card: [cb.x, cb.y, cb.y + cb.height].map(Math.round) }));
  await p.screenshot({ path: `${SHOTS}/job-${w}.png` });
  await p.mouse.move(2, 2);
}
await p.setViewportSize({ width: 1920, height: 1080 });
await wait();

// ---- choosing a card: the brief goes in the footer
const pick = await p.$$eval('.lg-board-hire .lg-card', (els) => els[2].dataset.contract);
await p.click(`.lg-card[data-contract="${pick}"]`);
await wait();
const brief = await p.evaluate((id) => window.vc.state().campaign.board.find((k) => k.id === id).brief, pick);
check('choosing a card marks it chosen and puts its brief in the footer', (await p.$eval(`.lg-card[data-contract="${pick}"]`, (e) => e.getAttribute('aria-pressed'))) === 'true' && (await p.$eval('.foot .mid', (e) => e.innerText)) === brief, brief);
check('the Job medallion\'s line names the job', (await p.$eval('.lg-step[data-step="job"] .sb', (e) => e.innerText)) === (await p.evaluate((id) => window.vc.state().campaign.board.find((k) => k.id === id).title, pick)));

// ---- the purse: one coin stack, kept across renders, growing with the gold
await p.evaluate(() => (document.querySelector('.purse .coinstack').dataset.mark = 'kept'));
const cols0 = await p.$$eval('.purse .coinstack > i:not(.fly)', (els) => els.length);
await edit('s.campaign.gold += 2400;');
await wait(700);
const cols1 = await p.$$eval('.purse .coinstack > i:not(.fly)', (els) => els.length);
check('the purse keeps its coin stack across renders', (await p.$eval('.purse .coinstack', (e) => e.dataset.mark)) === 'kept');
check('more gold, more columns; the number counts up to it', cols1 > cols0 && (await p.$eval('.purse .gold-n', (e) => e.textContent.replace(/,/g, ''))) === String(await p.evaluate(() => window.vc.state().campaign.gold)), `${cols0} → ${cols1}`);

// ---- the camp props and the other pages' frames
await edit(`s.campaign.fallen.push({ name: 'Bram Ashby', cls: 'sellsword', level: 2, where: 'Level 1, great hall', delve: 2 });`);
await wait();
check('gravestone badge counts the graves', (await p.$eval('.prop[data-ribbon="graves"] .bd', (e) => e.innerText)) === '1');
for (const pg of ['party', 'outfit', 'setout']) {
  await p.click(`.lg-step[data-step="${pg}"]`);
  await wait(200);
  f = await frame();
  check(`${pg}: the frame holds (header 92, main 900, footer 88), no page scrollbars`, f.head?.h === 92 && f.main?.h === 900 && f.foot?.y === 992 && !f.pageScroll, f.scrollers.length ? `screen still scrolls: ${f.scrollers.join(',')}` : '');
  check(`${pg}: Back on the left, the forward button on the right`, !!(await p.$('.foot .foot-l [data-back]')) && !!(await p.$('.foot .foot-r .btn.primary')));
  await p.screenshot({ path: `${SHOTS}/frame-${pg}.png` });
}
check('set out: Delve is the forward button', !!(await p.$('.foot .foot-r .lg-delve[data-k="delve"]')));
await p.click('[data-ribbon="cart"]');
await wait();
check('the wagon opens the cart page; Back returns', (await page()) === 'cart' && !!(await p.$('.prop.here[data-ribbon="cart"]')));
await p.screenshot({ path: `${SHOTS}/frame-cart.png` });
await p.click('[data-ribbon="graves"]');
await wait();
check('the gravestone opens the graves', (await page()) === 'graves');
await p.screenshot({ path: `${SHOTS}/frame-graves.png` });
await p.click('[data-k="back-steps"]');
await wait();
check('"Back to …" returns to the last step', (await page()) === 'setout');

check('no page errors', errors === 0, `${errors}`);
await b.close();
console.log(failed ? `${failed} FAILED` : 'all ok');
process.exit(failed ? 1 : 0);
