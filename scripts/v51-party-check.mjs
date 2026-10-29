// V5.1 (W2) Party step check, headless, real engine: the Party board on the 1920x1080 camp stage at 1920x1080 and
// 2560x1440 (also 1280x720, 1366x768, 1440x900 for the no-scroll rule). Seeds the mockup's situation (Keven and a
// wounded Petra going in, the third slot open, the fourth locked, two on the bench, four at the Flagon), then:
// nothing in the camp scrolls or spills out of <main> (1920x900); busts, role icons and one hex tile per ability;
// no hex+letter badge, no "This party can", no "Best at"; Heal shows with the surgeon; a recruit dragged (pointer)
// onto the open slot is hired into it (the slot shows "Drop to hire" and the price while held); a bench hero goes
// in by click-then-click and by keyboard (Enter, Enter); a big roster pages instead of wrapping; empty states.
// Screenshots: SHOTS dir (default the session scratchpad v51-shots) party-<w>.png, party-drag.png, party-many.png.
//   node scripts/v51-party-check.mjs <baseUrl> [shotsDir]
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';

const [base = 'http://localhost:5192/', shots = '/tmp/claude-0/-home-claude/26fe1399-920e-5ce0-9301-8b5617a58c1b/scratchpad/v51-shots'] = process.argv.slice(2);
mkdirSync(shots, { recursive: true });
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
const st = () => p.evaluate(() => window.vc.state());
const edit = async (fn) => {
  await p.evaluate((f) => { const s = structuredClone(window.vc.state()); new Function('s', f)(s); window.vc.load(s); }, fn);
  await p.waitForTimeout(120);
};
const wait = (ms = 120) => p.waitForTimeout(ms);

await p.goto(base);
await p.evaluate(() => { localStorage.clear(); localStorage.setItem('vc.settings', JSON.stringify({ speed: 0, reduceShake: true, noEndTurnAsk: true, quality: 'low' })); });
await p.reload();
await p.waitForFunction(() => !!window.vc);
await p.click('[data-new-campaign]');
await p.waitForSelector('.lowgate');
if (await p.$('.lg-welcome [data-welcome]')) await p.click('.lg-welcome [data-welcome]');
await p.click('.lg-step[data-step="party"]');
await wait();

// The mockup's situation.
const mk = `(id, name, cls, hp, maxHp, level = 1) => ({ id, name, cls, level, xp: 0, maxHp, hp, stats: { might: 50, finesse: 50, wits: 50, nerve: 50 }, weaponTier: 0, armorTier: 0, wounded: 0, kills: 0, delves: 1 })`;
await edit(`const mk = ${mk};
  const c = s.campaign;
  c.gold = 340; c.squadSlots = 3; c.village.innkeeper = true; c.village.surgeon = true;
  c.roster.push(mk('petra', 'Petra', 'shadowmancer', 6, 9), mk('jutta', 'Jutta', 'hedgewitch', 7, 7), mk('brann', 'Brann', 'sapper', 5, 9));
  c.recruits = [
    { hero: mk('r-dagny', 'Dagny', 'sellsword', 10, 10), price: 60 },
    { hero: mk('r-osk', 'Osk', 'ranger', 8, 8, 2), price: 100 },
    { hero: mk('r-hild', 'Hild', 'burglar', 7, 7, 3), price: 140 },
    { hero: mk('r-pyr', 'Ember', 'pyromancer', 7, 7), price: 60 },
  ];`);
await p.click('[data-bench="petra"]');
await wait();
// Busts are baked images (bust.ts) that fade in once loaded: wait until every bust shows its image.
await p.waitForFunction(() => [...document.querySelectorAll('.pt .bust')].every((b) => b.classList.contains('img')), null, { timeout: 60000 });

/** Nothing scrolls; nothing inside <main> pokes out of the 1920x900 box. */
const layout = () =>
  p.evaluate(() => {
    const se = document.scrollingElement;
    const pageScroll = se.scrollHeight > innerHeight + 1 || se.scrollWidth > innerWidth + 1;
    const camp = document.querySelector('.camp');
    const scrollers = [...camp.querySelectorAll('*')].filter((e) => {
      const cs = getComputedStyle(e);
      return (/(auto|scroll)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 1) || (/(auto|scroll)/.test(cs.overflowX) && e.scrollWidth > e.clientWidth + 1);
    }).map((e) => e.className);
    const main = camp.querySelector('main');
    const scale = camp.getBoundingClientRect().width / camp.offsetWidth;
    const mr = main.getBoundingClientRect();
    const box = { w: Math.round(mr.width / scale), h: Math.round(mr.height / scale) };
    const out = [...main.querySelectorAll('.pt *')].filter((e) => {
      if (e.closest('.drag-ghost')) return false;
      const r = e.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      return r.left < mr.left - 1 || r.right > mr.right + 1 || r.top < mr.top - 1 || r.bottom > mr.bottom + 1;
    }).map((e) => e.className);
    const pt = main.querySelector('.pt');
    const content = Math.max(...[...pt.children].map((e) => e.getBoundingClientRect().bottom)) - mr.top;
    return { pageScroll, scrollers, box, out, contentBottom: Math.round(content / scale) };
  });

for (const [w, hh] of [[1920, 1080], [2560, 1440], [1280, 720], [1366, 768], [1440, 900]]) {
  await p.setViewportSize({ width: w, height: hh });
  await p.mouse.move(5, 5);
  await p.evaluate(() => document.activeElement?.blur?.());
  await wait(200);
  const lay = await layout();
  check(`${w}x${hh}: no scrolling, nothing spills out of main`, !lay.pageScroll && !lay.scrollers.length && !lay.out.length, JSON.stringify(lay).slice(0, 300));
  if (w === 1920 || w === 2560) await p.screenshot({ path: `${shots}/party-${w}.png` });
}
await p.setViewportSize({ width: 1920, height: 1080 });
await wait(200);
const lay = await layout();
check('main is the 1920x900 box and the content ends inside it', lay.box.w === 1920 && lay.box.h === 900 && lay.contentBottom <= 900, JSON.stringify(lay.box) + ` bottom ${lay.contentBottom}`);

// ---- what's on the board
const slots = await p.$$eval('.pt-slot', (els) => els.map((e) => (e.classList.contains('pt-hero') ? `hero:${e.dataset.hero}` : e.classList.contains('pt-locked') ? 'locked' : 'open')));
check('four slots: Keven, Petra, open, locked', slots.join(',') === 'hero:keven,hero:petra,open,locked', slots.join(','));
check('each party slot has a bust (rendered or the CSS figure)', (await p.$$('.pt-hero .bust')).length === 2);
check('busts are rig renders (WebGL in headless)', (await p.$$('.pt-hero .bust.img img')).length === 2);
check('class by colour and a role icon (hex emblem), no hex+letter badge', (await p.$$('.pt-hero .pt-cls .em .ic')).length === 2 && !(await p.$('.pt .cbadge, .pt .lg-hex')));
const tiles = await p.$$eval('.pt .abil', (els) => els.map((e) => ({ icon: !!e.querySelector('.ic'), tip: e.dataset.tip ?? '', text: e.innerText.trim() })));
check('every ability is a hex tile with an icon, the name and rules in its tip, no text on the tile', tiles.length >= 2 + 5 + 3 + 4 + 4 + 3 && tiles.every((t) => t.icon && /·/.test(t.tip) && !t.text), `${tiles.length} tiles`);
const txt = await p.$eval('.pt', (e) => e.innerText);
check('no "This party can", no "Best at", no role blurb', !/This party can|Best at|Front line/i.test(txt));
check('Keven wears the crown mark (its tip: "If he falls, it\'s over.")', /If he falls, it's over\./.test((await p.getAttribute('.pt-hero[data-hero="keven"] .crownmark', 'data-tip')) ?? ''));
check('Petra (6/9): an HP bar and Heal with its price', !!(await p.$('.pt-hero[data-hero="petra"] .lg-hpbar')) && /Heal\s*9/.test(await p.$eval('[data-heal="petra"]', (e) => e.innerText.replace(/\s+/g, ' '))));
check('the locked slot names the muster roll on hover', /muster roll/.test((await p.getAttribute('.pt-locked', 'data-tip')) ?? ''));
check('slot pips: two on, one open, a lock', (await p.$$('.pt-pips .pt-pip.on')).length === 2 && (await p.$$('.pt-pips .pt-pip.lock')).length === 1);
check('bench: Jutta and Brann as small busts with a + each', (await p.$$('.pt-bh .bust')).length === 2 && !!(await p.$('[data-bench="jutta"]')) && !!(await p.$('[data-bench="brann"]')));
check('Flagon: four recruits with a bust, a name and the price on Hire', (await p.$$('.pt-rc')).length === 4 && /Hire\s*60/.test(await p.$eval('.pt-rc [data-hire]', (e) => e.innerText.replace(/\s+/g, ' '))));

await edit("s.campaign.roster[0].ale = 'reserve';");
check('an ale shows on the slot by name', /Hobart's Reserve/.test(await p.textContent('.lg-slot.hero[data-hero="keven"]')));
await edit('delete s.campaign.roster[0].ale;');

// ---- pointer drag: a recruit into the open slot hires them
{
  const card = await p.$('.pt-rc[data-recruit="r-dagny"]');
  const cb = await card.boundingBox();
  const sb = await (await p.$('.pt-slot.pt-empty:not(.pt-locked)')).boundingBox();
  await p.mouse.move(cb.x + 60, cb.y + 40);
  await p.mouse.down();
  await p.mouse.move(cb.x + 120, cb.y - 40, { steps: 4 });
  await p.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2, { steps: 8 });
  await wait(100);
  const held = await p.$eval('.pt-slot.pt-empty:not(.pt-locked)', (e) => ({ ok: e.classList.contains('drop-ok'), text: e.innerText.replace(/\s+/g, ' ') }));
  check('while a recruit is held, the open slot lights and says "Drop to hire" with the price', held.ok && /Drop to hire/i.test(held.text) && /60/.test(held.text), held.text);
  check('...a ghost card follows the pointer', !!(await p.$('.drag-ghost')));
  await p.screenshot({ path: `${shots}/party-drag.png` });
  await p.mouse.up();
  await wait(250);
  const s = await st();
  check('dropping hires (340 → 280) and fills the slot', s.campaign.gold === 280 && !!(await p.$('.pt-hero[data-hero="r-dagny"]')), `${s.campaign.gold}`);
}

// ---- click then click: take Dagny out, then a bench hero in through the slot
await p.click('[data-out="r-dagny"]');
await wait();
await p.click('.pt-bh:has([data-bench="jutta"]) .pt-bh-n');
await wait(60);
check('clicking a bench hero picks them up (the open slot lights)', !!(await p.$('.pt-slot.pt-empty.drop-ok')));
await p.click('.pt-slot.pt-empty.drop-ok');
await wait();
check('...and clicking the slot puts them in', !!(await p.$('.pt-hero[data-hero="jutta"]')));

// ---- keyboard: Enter on a bench hero, Enter on the slot
await p.click('[data-out="jutta"]');
await wait();
await p.focus('.pt-bh:has([data-bench="brann"])');
await p.keyboard.press('Enter');
await wait(60);
await p.keyboard.press('Enter');
await wait();
check('keyboard: Enter lifts a bench hero, Enter drops them in the slot', !!(await p.$('.pt-hero[data-hero="brann"]')));
await p.click('[data-out="brann"]');
await wait();

// ---- a hero that can't be afforded: the slot refuses with the reason
await edit('s.campaign.gold = 50;');
await p.click('.pt-rc[data-recruit="r-hild"] h4');
await wait(60);
const no = await p.$eval('.pt-slot.pt-empty:not(.pt-locked)', (e) => ({ no: e.classList.contains('drop-no'), tip: e.dataset.tip ?? '' }));
check('a recruit you can\'t afford: the slot dims and says why', no.no && /You have 50 gold/.test(no.tip), JSON.stringify(no));
await p.keyboard.press('Escape');
await wait(60);

// ---- many on the roster: the bench pages, never wraps or scrolls; four slots open
await edit(`const mk = ${mk}; const c = s.campaign; c.gold = 2400; c.squadSlots = 4; c.village.muster = true;
  const cls = ['sellsword','burglar','ranger','sapper','pyromancer','shadowmancer','hedgewitch'];
  for (let i = 0; i < 12; i++) c.roster.push(mk('m' + i, ['Aldo','Bea','Cort','Dunja','Edda','Falk','Gisla','Hamo','Ivo','Jorun','Kalle','Liv'][i], cls[i % 7], 4 + (i % 4), 8));`);
await wait(200);
const bench = await p.$$eval('.pt-bh', (els) => els.length);
check('a big roster: the bench shows one page and a "+N" pager', bench >= 5 && bench <= 7 && !!(await p.$('[data-k="bench-more"]')), `${bench} chips`);
const lay2 = await layout();
check('a big roster: still no scrolling, nothing spills', !lay2.pageScroll && !lay2.scrollers.length && !lay2.out.length, JSON.stringify(lay2).slice(0, 200));
await p.click('[data-bench="m0"]');
await wait();
await p.click('[data-bench="petra"]').catch(() => {});
await wait();
await p.mouse.move(5, 5);
await p.evaluate(() => document.activeElement?.blur?.());
await wait(100);
await p.screenshot({ path: `${shots}/party-many.png` });
await p.click('[data-k="bench-more"]');
await wait();
check('the pager turns the page', !(await p.$('[data-bench="m1"]')) || !!(await p.$('[data-bench="m9"]')));

// ---- empty: no recruits
await edit('s.campaign.recruits = [];');
// V5.1.2: with nobody looking for work the Flagon opens on The taps (unless Hire was chosen this visit); Hire says so.
await p.click('[data-ftab="hire"]');
await wait();
check('no recruits: one quiet line', /Nobody looking for work/.test(await p.$eval('.pt', (e) => e.innerText)));
const lay3 = await layout();
check('no recruits: still no scrolling', !lay3.pageScroll && !lay3.scrollers.length && !lay3.out.length);

check('no page errors', errors === 0, `${errors}`);
await b.close();
console.log(failed ? `${failed} FAILED` : 'all ok');
process.exit(failed ? 1 : 0);
