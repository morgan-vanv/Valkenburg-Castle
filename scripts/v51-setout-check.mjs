// V5.1 (W4) Set out and Graves check, headless: loads each screen on the camp stage at 1920x1080 and 2560x1440 with
// real engine data (a new campaign; a partly remembered Level 1 with shut ways; the whole level with every way open;
// the graves empty, with two, and with many names), asserts nothing in the camp scrolls or overflows the stage, picks a
// way in by its map pin and by its card, and saves screenshots (SHOTS=<dir>, default the scratchpad's v51-shots).
//   node scripts/v51-setout-check.mjs <baseUrl>
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import fs from 'fs';

const [base = 'http://localhost:5194/'] = process.argv.slice(2);
const SHOTS = process.env.SHOTS ?? '/tmp/claude-0/-home-claude/26fe1399-920e-5ce0-9301-8b5617a58c1b/scratchpad/v51-shots';
fs.mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
await p.route(/fonts\./, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
let errors = 0;
let failed = 0;
p.on('pageerror', (e) => (errors++, console.log('[pageerror]', e.message)));
p.on('console', (m) => m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource/.test(m.text()) && (errors++, console.log('[console]', m.text())));
const check = (name, ok, extra = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`);
};
const edit = (fn) => p.evaluate((f) => { const s = structuredClone(window.vc.state()); new Function('s', f)(s); window.vc.load(s); }, fn);
// Shell controls (steps, ribbon, cart) are clicked by script: the header and footer are W1's and may be mid-change.
const tap = async (sel) => { await p.$eval(sel, (e) => e.click()); await p.waitForTimeout(100); };
const step = async (id) => { await tap(`.lg-step[data-step="${id}"]`); await p.waitForTimeout(20); };
const page = () => p.evaluate(() => document.querySelector('.lowgate')?.dataset.page);
/** Nothing scrolls: the document, and no element in the camp with overflow auto/scroll that has more than it shows. */
const noScroll = () =>
  p.evaluate(() => {
    const bad = [];
    const se = document.scrollingElement;
    if (se.scrollHeight > innerHeight + 1 || se.scrollWidth > innerWidth + 1) bad.push(`document ${se.scrollWidth}x${se.scrollHeight}`);
    const camp = document.querySelector('.camp') ?? document.body;
    for (const el of camp.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      if (/(auto|scroll)/.test(cs.overflowY + cs.overflowX) && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1)) bad.push(el.className || el.tagName);
    }
    // the screen stays inside <main> (1920x900 stage px)
    const scr = document.querySelector('.so, .gv');
    const main = document.querySelector('.lowgate main');
    if (scr && main) {
      const a = scr.getBoundingClientRect();
      const m = main.getBoundingClientRect();
      if (a.right > m.right + 1 || a.bottom > m.bottom + 1) bad.push('screen outgrows main');
      for (const el of scr.querySelectorAll('.so-ent, .so-muster, .so-board, .gv-stone, .gv-post, .gv-note')) {
        const r = el.getBoundingClientRect();
        if (r.bottom > m.bottom + 1 || r.right > m.right + 1 || r.left < m.left - 1) bad.push(`${el.className} outside main`);
      }
    }
    return bad;
  });
const shoot = async (name) => {
  for (const [w, hh] of [[1920, 1080], [2560, 1440]]) {
    await p.setViewportSize({ width: w, height: hh });
    await p.waitForTimeout(250);
    const bad = await noScroll();
    check(`${name} @${w}: no scroll, nothing outside`, bad.length === 0, bad.join(', '));
    await p.mouse.move(2, 2);
    await p.screenshot({ path: `${SHOTS}/${name}-${w}.png` });
  }
  await p.setViewportSize({ width: 1920, height: 1080 });
  await p.waitForTimeout(150);
};

await p.goto(base);
await p.evaluate(() => { localStorage.clear(); localStorage.setItem('vc.settings', JSON.stringify({ speed: 0, reduceShake: true, noEndTurnAsk: true, quality: 'low' })); });
await p.reload();
await p.waitForFunction(() => !!window.vc);
await p.click('text=New campaign');
await p.waitForSelector('.lowgate');
await tap('.lg-welcome [data-welcome]').catch(() => {});

// ---- a new campaign: no map, only the main gate
await step('setout');
check('new campaign: the board says you have never been inside', !!(await p.$('.so-board[data-sketch="none"]')) && !(await p.$('[data-sketch] svg')));
check('new campaign: one way in, the main gate, "Going in"', (await p.$$('.so-ent')).length === 1 && /Main gate[\s\S]*Going in/i.test(await p.$eval('.so-ent', (e) => e.innerText)));
check('Keven alone: the heir warning and "No light source packed."', /Keven goes in alone/.test(await p.$eval('.so-muster', (e) => e.innerText)) && (await p.$eval('[data-warn="nolight"]', (e) => e.innerText)).trim() === 'No light source packed.');
await shoot('setout-new');

// ---- a party with packs: a hire, a rope and a potion
await edit(`const mk = (id, name, cls) => ({ id, name, cls, level: 1, xp: 0, maxHp: 10, hp: 10, stats: { might: 50, finesse: 50, wits: 50, nerve: 50 }, weaponTier: 0, armorTier: 0, wounded: 0, kills: 0, delves: 0 });
  s.campaign.roster.push(mk('w4-petra', 'Petra', 'shadowmancer'), mk('w4-jutta', 'Jutta', 'hedgewitch'));
  s.campaign.stash.push({ id: 'w4-rope', kind: 'rope', name: 'Rope', amount: 1, slots: 1 }, { id: 'w4-pot', kind: 'potion', name: 'Potion', amount: 1, slots: 1 });`);
await step('party');
await tap('[data-bench="w4-petra"]').catch(() => {});
await p.waitForTimeout(80);
await tap('[data-bench="w4-jutta"]').catch(() => {});
await p.waitForTimeout(80);
await step('outfit');
for (const k of ['rope', 'potion']) {
  await tap(`[data-cartbox] [data-cart="${k}"]`).catch(() => {});
  await p.waitForTimeout(80);
}

// ---- part of Level 1 remembered (around the main gate), the shut ways seen but not open
const partial = await p.evaluate(() => {
  const E = window.vcEngine;
  const c = E.castle();
  const lv = c.levels.find((l) => l.level === 1);
  const g = c.entrances[0];
  const d = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
  return Object.keys(lv.tiles).filter((k) => { const [q, r] = k.split(',').map(Number); return d({ q, r }, g) <= 11 || c.entrances.slice(1).some((e) => e.level === 1 && d({ q, r }, e) <= 3); });
});
await edit(`s.campaign.explored = { 1: ${JSON.stringify(partial)} }; s.campaign.opened = {};`);
await step('setout');
const m1 = await p.evaluate(() => ({ pins: [...document.querySelectorAll('.so-pin[data-entrance-pin]')].map((e) => e.className), rooms: document.querySelectorAll('text.lg-sk-room').length, heroes: document.querySelectorAll('.so-mh').length, slots: document.querySelectorAll('.so-mh .ms:not(.e)').length }));
check('partial map: the sketch draws, with room names', !!(await p.$('[data-sketch="level1"] svg path')) && m1.rooms >= 1, JSON.stringify(m1));
check('partial map: shut ways show dim, the chosen one lit', m1.pins.some((c) => /\bon\b/.test(c)) && m1.pins.some((c) => /\boff\b/.test(c)), m1.pins.join(' | '));
check('muster: three heroes, packed items in hex slots', m1.heroes === 3 && m1.slots >= 1, `${m1.heroes} heroes, ${m1.slots} filled slots`);
await shoot('setout-partial');

// ---- the whole of Level 1, every way open; pick ways in by pin and by card
await edit(`const lv = window.vcEngine.castle().levels.find((l) => l.level === 1); s.campaign.explored = { 1: Object.keys(lv.tiles) }; delete s.campaign.opened;`);
await step('setout');
const m2 = await p.evaluate(() => ({ closestAt: [...document.querySelectorAll('.so-ent')].findIndex((e) => /closest/i.test(e.innerText)), pins: document.querySelectorAll('.so-pin[data-entrance-pin]').length, stairs: document.querySelectorAll('.so-pin.stairs').length, seal: !!document.querySelector('.so-pin.seal'), lamp: !!document.querySelector('.so-lamp'), legend: document.querySelector('.so-legend')?.innerText ?? '', closest: [...document.querySelectorAll('.so-ent')].filter((e) => /closest/i.test(e.innerText)).length }));
check('full map: three way-in pins, a stairs marker, the job seal, the lamp glow', m2.pins === 3 && m2.stairs >= 1 && m2.seal && m2.lamp, JSON.stringify(m2));
check('full map: the legend (job, stairs down, ways in)', /The job/.test(m2.legend) && /Stairs down/.test(m2.legend) && /Ways in you know/.test(m2.legend), m2.legend);
check('"Closest to the job" on exactly one card (the job is on the map, three ways open)', m2.closest === 1, `${m2.closest}`);
await shoot('setout-full');
await p.click('.so-pin[data-entrance-pin="1"]');
await p.waitForTimeout(120);
check('clicking a pin picks that way in', (await p.$eval('.so-ent[data-entrance="1"]', (e) => e.getAttribute('aria-checked'))) === 'true' && !!(await p.$('.so-pin.on[data-entrance-pin="1"]')));
await p.click('.so-ent[data-entrance="2"]');
await p.waitForTimeout(120);
check('clicking a card picks that way in', (await p.$eval('.so-ent[data-entrance="2"]', (e) => e.getAttribute('aria-checked'))) === 'true' && !!(await p.$('.so-pin.on[data-entrance-pin="2"]')));
await p.click('.so-ent[data-entrance="0"]');
await p.waitForTimeout(120);
check('...and back to the main gate', page && (await p.$eval('.so-ent[data-entrance="0"]', (e) => e.getAttribute('aria-checked'))) === 'true');

// ---- the graves
await tap('[data-ribbon="graves"]');
await p.waitForTimeout(120);
check('graves: empty yard, "No names yet."', (await page()) === 'graves' && /No names yet\. Keep it that way\./.test(await p.$eval('.gv', (e) => e.innerText)) && (await p.$$('.gv-stone')).length === 0);
await shoot('graves-empty');
await edit(`s.campaign.fallen.push({ name: 'Osk', cls: 'ranger', level: 1, where: 'Level 1, the great hall', delve: 2 }, { name: 'Hild', cls: 'burglar', level: 2, where: "Level 1, Servants' passage", delve: 5 });`);
await p.waitForTimeout(120);
const g2 = await p.evaluate(() => ({ stones: [...document.querySelectorAll('.gv-stone')].map((e) => e.dataset.fallen), newest: document.querySelector('.gv-stone.newest')?.dataset.fallen, post: document.querySelector('.gv-names .new')?.innerText ?? '', ep: [...document.querySelectorAll('.gv-stone .ep')].map((e) => e.textContent), candles: document.querySelectorAll('.gv-candle:not(.short)').length }));
check('graves: two headstones, newest first and lit, a candle each, an epitaph each', g2.stones.join() === 'Hild,Osk' && g2.newest === 'Hild' && /Hild/.test(g2.post) && g2.candles === 2 && g2.ep.every((x) => x && x.length > 3), JSON.stringify(g2));
const again = await p.evaluate(() => [...document.querySelectorAll('.gv-stone .ep')].map((e) => e.textContent));
await step('job').catch(() => {});
await tap('[data-ribbon="graves"]');
await p.waitForTimeout(120);
check('graves: the epitaphs do not change between visits', JSON.stringify(again) === JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('.gv-stone .ep')].map((e) => e.textContent))));
await shoot('graves-two');
await edit(`const C = ['sellsword', 'burglar', 'ranger', 'sapper', 'pyromancer', 'shadowmancer', 'hedgewitch']; for (let i = 0; i < 23; i++) s.campaign.fallen.push({ name: 'Fallen ' + (i + 1), cls: C[i % 7], level: 1 + (i % 3), where: 'Level 1, the kitchens', delve: 6 + i });`);
await p.waitForTimeout(150);
const g3 = await p.evaluate(() => ({ stones: document.querySelectorAll('.gv-stone').length, names: document.querySelectorAll('.gv-names > div:not(.gap)').length, more: document.querySelector('.gv-names .more')?.textContent ?? '' }));
check('graves: many names: four headstones, the post full with "and N more"', g3.stones === 4 && g3.names >= 10 && /and \d+ more/.test(g3.more), JSON.stringify(g3));
await shoot('graves-many');

console.log(`\n${failed ? `${failed} FAILED` : 'all passed'}, ${errors} page errors`);
await b.close();
process.exit(failed || errors ? 1 : 0);
