// V5.2 (spec 35) check: the title screen on the camp stage, headless (real engine).
// First visit: the new-campaign card (Keven alone, 70 gold), the seed field in the card, Begin starts a campaign with
// that seed. A save in camp: the campaign card with Continue focused, the busts, the coin stack, villagers and
// graves; New campaign asks in place, Esc keeps it; Continue resumes. A save inside the castle: "Continue the delve"
// and where it stands. An ended campaign: no Continue, the last run on the card, remembered under vc.runs.v52 (and
// "runs before" once a new campaign is going). Settings and keys open from the corner; a setting sticks. At
// 1280x720, 1366x768, 1440x900, 1920x1080 and 2560x1440: no scrollbars, nothing overlaps the card column.
// Screenshots go to SHOTS as title-<state>.png.
//   node scripts/v52-title-check.mjs <baseUrl>
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';

const [base = 'http://localhost:4185/'] = process.argv.slice(2);
const SHOTS = process.env.SHOTS ?? '/tmp/v52-shots';
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
const wait = (ms = 150) => p.waitForTimeout(ms);
const shot = (name) => p.screenshot({ path: `${SHOTS}/title-${name}.png` });
/** Change the save on disk (the title reads it on load). */
const editSave = (fn) => p.evaluate((f) => {
  const E = window.vcEngine;
  const s = E.deserialize(localStorage.getItem('vc.save.v39'));
  new Function('s', f)(s);
  localStorage.setItem('vc.save.v39', E.serialize(s));
}, fn);
const reloadTitle = async () => {
  await p.reload();
  await p.waitForFunction(() => !!window.vc && !!document.querySelector('.title-screen .t-card'));
  await p.keyboard.press('Shift'); // settle the arrival
  await wait(250);
};
/** No scrollbars; the column's boxes don't overlap each other or the fine print; all inside the stage. */
const layout = () =>
  p.evaluate(() => {
    const se = document.scrollingElement;
    const scroll = se.scrollHeight > innerHeight + 1 || se.scrollWidth > innerWidth + 1;
    const stage = document.querySelector('.title-screen').getBoundingClientRect();
    const parts = [...document.querySelectorAll('.t-lock, .t-col > *:not(.hidden), .t-fine')].map((e) => e.getBoundingClientRect());
    let overlap = false;
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i], c = parts[j];
      if (a.left < c.right && c.left < a.right && a.top < c.bottom - 1 && c.top < a.bottom - 1) overlap = true;
    }
    const inside = parts.every((r) => r.bottom <= stage.bottom + 1 && r.top >= stage.top - 1);
    const seed = document.querySelector('.t-seedfield');
    const sr = seed?.getBoundingClientRect();
    const card = document.querySelector('.t-card')?.getBoundingClientRect();
    const seedIn = !sr || (sr.right <= card.right + 1 && sr.bottom <= card.bottom + 1) || !!seed.closest('.t-newrow');
    return { scroll, overlap, inside, seedIn };
  });

await p.goto(base);
await p.evaluate(() => { localStorage.clear(); localStorage.setItem('vc.settings', JSON.stringify({ speed: 0, reduceShake: true, noEndTurnAsk: true, quality: 'low' })); });
await reloadTitle();

// ---- first visit
let t = await p.evaluate(() => ({
  kick: document.querySelector('.t-card .kick')?.textContent,
  begin: document.querySelector('[data-new-campaign]')?.textContent,
  cont: !!document.querySelector('[data-continue]'),
  seed: !!document.querySelector('.t-card input.seed'),
  gold: document.querySelector('.t-card .gold-n')?.textContent,
  last: !!document.querySelector('[data-last-run]'),
  focus: document.activeElement?.hasAttribute('data-new-campaign'),
}));
check('first visit: a new-campaign card, Begin, no Continue, no last run', t.kick === 'A new campaign' && /^Begin/.test(t.begin) && !t.cont && !t.last, JSON.stringify(t));
check('...Keven alone and 70 gold; the seed field sits in the card; Begin has the focus', t.gold === '70' && t.seed && t.focus, JSON.stringify(t));
await shot('first');
for (const [w, hh] of [[1280, 720], [1366, 768], [1440, 900], [1920, 1080], [2560, 1440]]) {
  await p.setViewportSize({ width: w, height: hh });
  await wait(200);
  const l = await layout();
  check(`first visit at ${w}x${hh}: no scrolling, no overlaps, the seed box inside the card`, !l.scroll && !l.overlap && l.inside && l.seedIn, JSON.stringify(l));
}
await p.setViewportSize({ width: 1920, height: 1080 });
await p.fill('input.seed', '7');
await p.click('[data-new-campaign]');
await p.waitForFunction(() => window.vc.state()?.stage === 'camp');
check('Begin with seed 7 starts a campaign on seed 7', await p.evaluate(() => window.vc.state().seed === 7));

// ---- a save in camp
await editSave(`
  s.campaign.delveCount = 4;
  s.campaign.gold = 330;
  s.campaign.village.surgeon = true;
  s.campaign.village.innkeeper = true;
  s.campaign.village.smith = true;
  s.campaign.fallen.push({ name: 'Osk', cls: 'ranger', level: 1, where: 'Level 1, the Great Hall', delve: 2 });
`);
await reloadTitle();
t = await p.evaluate(() => ({
  where: document.querySelector('.t-where')?.textContent,
  cont: document.querySelector('[data-continue]')?.textContent,
  focus: document.activeElement?.hasAttribute('data-continue'),
  busts: document.querySelectorAll('.t-card .bust').length,
  coins: document.querySelectorAll('.t-card .coinstack i').length,
  gold: document.querySelector('.t-card .gold-n')?.textContent,
  facts: [...document.querySelectorAll('.t-fact')].map((e) => e.textContent),
  seed: !!document.querySelector('input.seed'),
}));
check('camp save: the campaign card, Continue focused', t.where === 'After 4 delves · resting in Lowgate' && /^Continue/.test(t.cont) && t.focus, JSON.stringify(t));
check('...busts, the coin stack and 330 gold; 3 villagers home, 1 in the graves; the seed hidden', t.busts >= 1 && t.coins > 0 && t.gold === '330' && t.facts.some((f) => f.includes('3 villagers home')) && t.facts.some((f) => f.includes('1 in the graves')) && !t.seed, JSON.stringify(t));
await shot('camp');
// V5.3 (spec 36): the baked castle, its lights, and a lit home per villager
await p.waitForFunction(() => document.querySelector('.t-castle-img')?.complete);
t = await p.evaluate(() => ({
  img: document.querySelector('.t-castle-img')?.naturalWidth ?? 0,
  flat: !document.querySelector('.t-castle')?.classList.contains('hidden'),
  glows: document.querySelectorAll('.t-glow').length,
  eyes: document.querySelectorAll('.t-glow.k-eye').length,
  homes: document.querySelectorAll('.t-home.on').length,
  smoke: document.querySelectorAll('.t-smoke').length,
}));
check('the baked castle shows (not the flat one), with its lights and one eye in the keep window', t.img > 0 && !t.flat && t.glows >= 5 && t.eyes === 1, JSON.stringify(t));
check('...one lit home and one chimney smoking per villager home (3)', t.homes === 3 && t.smoke === 3, JSON.stringify(t));
for (const [w, hh] of [[1280, 720], [1440, 900], [2560, 1440]]) {
  await p.setViewportSize({ width: w, height: hh });
  await wait(200);
  const l = await layout();
  check(`camp save at ${w}x${hh}: no scrolling, no overlaps`, !l.scroll && !l.overlap && l.inside, JSON.stringify(l));
}
await p.setViewportSize({ width: 1920, height: 1080 });

await p.click('.t-seedlink');
await wait();
check('"Choose a seed" opens the field in the row', await p.evaluate(() => !!document.querySelector('.t-newrow input.seed') && document.activeElement?.matches('input.seed')));
await p.keyboard.press('Escape');
await p.click('body', { position: { x: 1700, y: 300 } });
await p.keyboard.press('n');
await wait();
t = await p.evaluate(() => ({ confirm: document.querySelector('.t-confirm')?.textContent ?? '', dim: document.querySelector('.t-card')?.classList.contains('dimmed') }));
check('N asks in place: the card dims, the confirm names what goes', t.dim && /Start over/.test(t.confirm) && /330 gold/.test(t.confirm), JSON.stringify(t));
await shot('confirm');
const l2 = await layout();
check('...the confirm fits under the card', !l2.overlap && l2.inside, JSON.stringify(l2));
await p.keyboard.press('Escape');
await wait();
check('Esc keeps the campaign', await p.evaluate(() => !document.querySelector('.t-confirm') && !document.querySelector('.t-card.dimmed') && document.activeElement?.hasAttribute('data-continue')));
await p.keyboard.press('Enter');
await p.waitForFunction(() => document.querySelector('.lowgate'));
check('Enter continues into Lowgate', await p.evaluate(() => window.vc.state().stage === 'camp' && window.vc.state().campaign.gold === 330));

// ---- settings and keys
await reloadTitle();
await p.click('[data-title-settings]');
await wait();
check('settings open from the corner', await p.evaluate(() => !!document.querySelector('.t-pop:not(.hidden) .t-seg')));
await shot('settings');
await p.click('.t-pop .t-seg-row:nth-of-type(2) button:nth-child(1)'); // Playback ½×
await wait();
check('...a setting sticks (playback ½×)', await p.evaluate(() => JSON.parse(localStorage.getItem('vc.settings')).speed === 0.5 && window.vc.settings.speed === 0.5));
await p.evaluate(() => { window.vc.settings.speed = 0; localStorage.setItem('vc.settings', JSON.stringify(window.vc.settings)); });
await p.keyboard.press('Escape');
await p.keyboard.press('?');
await wait();
check('? opens the keys', await p.evaluate(() => !!document.querySelector('.t-pop:not(.hidden) .t-legend kbd')));
await shot('keys');
await p.keyboard.press('Escape');

// ---- inside the castle
await p.click('[data-continue]');
await p.waitForFunction(() => window.vc.state()?.stage === 'camp');
await p.evaluate(async () => {
  const s = window.vc.state();
  const k = s.campaign.board[0];
  await window.vc.send({ type: 'startDelve', contractId: k.id, heroIds: ['keven'], entrance: 0, packs: {} });
});
await p.waitForFunction(() => window.vc.state()?.stage === 'delve');
await reloadTitle();
t = await p.evaluate(() => ({ where: document.querySelector('.t-where')?.textContent, cont: document.querySelector('[data-continue]')?.textContent, kind: document.querySelector('.t-card')?.dataset.card, facts: [...document.querySelectorAll('.t-fact')].map((e) => e.textContent) }));
check('delve save: "Continue the delve", where it stands, the light left', t.kind === 'delve' && /^Continue the delve/.test(t.cont) && /^Delve 5 · Level \d, round \d+$/.test(t.where) && t.facts.some((f) => /rounds of light/.test(f)), JSON.stringify(t));
await shot('delve');
await p.click('[data-continue]');
await p.waitForFunction(() => document.querySelector('[data-stage="delve"]'));
check('...Continue goes back into the castle', await p.evaluate(() => window.vc.state().stage === 'delve'));

// ---- an ended campaign
await editSave(`
  s.stage = 'over';
  s.delve = null;
  s.overReason = 'The heir has fallen. Valkenburg stays dark.';
  s.campaign.fallen.push({ name: 'Keven', cls: 'heir', level: 3, where: 'Level 2, the cellblock', delve: 5 });
`);
await reloadTitle();
t = await p.evaluate(() => ({ cont: !!document.querySelector('[data-continue]'), last: document.querySelector('[data-last-run]')?.textContent ?? '', begin: document.querySelector('[data-new-campaign]')?.textContent, runs: JSON.parse(localStorage.getItem('vc.runs.v52') ?? '[]').length }));
check('ended save: no Continue, the last run on the card, Begin again', !t.cont && /Keven fell on delve 5, Level 2, the cellblock/.test(t.last) && /^Begin again/.test(t.begin) && t.runs === 1, JSON.stringify(t));
await shot('ended');
const l3 = await layout();
check('...the card with the last run fits', !l3.scroll && !l3.overlap && l3.inside, JSON.stringify(l3));
await reloadTitle();
check('...a reload does not record the same run twice', await p.evaluate(() => JSON.parse(localStorage.getItem('vc.runs.v52')).length === 1));
await p.click('[data-new-campaign]');
await p.waitForFunction(() => window.vc.state()?.stage === 'camp');
await reloadTitle();
t = await p.evaluate(() => ({ kick: document.querySelector('.t-card .kick')?.textContent, runs: document.querySelector('.t-runs')?.textContent }));
check('the next campaign is run 2, with "1 run before this one"', t.kick === 'Your campaign · run 2' && t.runs === '1 run before this one', JSON.stringify(t));
await shot('run2');

check('0 page errors', errors === 0, `${errors}`);
console.log(`\n${failed ? `${failed} FAILED` : 'all passed'}`);
await b.close();
process.exit(failed ? 1 : 0);
