// V5.1.2 "One for the road" check (spec 34), headless, real engine. The drinks moved from Wim's Outfit tab to the
// Party step's Flagon (tabs Hire / The taps), poured by drag, click-then-click or keyboard onto a hero card's mug,
// a Round for everyone without one, tip it back (the gift can't be), Wim's special (struck base price, charged at the
// special price), dry taps with Wim's chalk; no scrolling with four heroes; Wim gone from Outfit; the toast on Delve
// (skippable, swallows E, none without drinkers, none at Instant), the Black Cask reveal; the HUD's tankard badge.
// Screenshots to SHOTS (default the session scratchpad v512-shots): taps-*.png, pour.png, toast*.png, hud-badge.png.
//   node scripts/v512-drinks-check.mjs <baseUrl> [shotsDir]
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';

const [base = 'http://localhost:5197/', shots = '/tmp/claude-0/-home-claude/26fe1399-920e-5ce0-9301-8b5617a58c1b/scratchpad/v512-shots'] = process.argv.slice(2);
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
  await p.waitForTimeout(150);
};
const wait = (ms = 150) => p.waitForTimeout(ms);
const hero = async (id) => (await st()).campaign.roster.find((x) => x.id === id);
const gold = async () => (await st()).campaign.gold;
const calm = async () => { await p.mouse.move(5, 5); await p.evaluate(() => document.activeElement?.blur?.()); await wait(120); };

await p.goto(base);
await p.evaluate(() => { localStorage.clear(); localStorage.setItem('vc.settings', JSON.stringify({ speed: 1, reduceShake: true, noEndTurnAsk: true, quality: 'low' })); });
await p.reload();
await p.waitForFunction(() => !!window.vc);
await p.click('text=New campaign');
await p.waitForSelector('.lowgate');
if (await p.$('.lg-welcome [data-welcome]')) await p.click('.lg-welcome [data-welcome]');
await p.click('.lg-step[data-step="party"]');
await wait();

// The board's situation: Keven (Wim's gift, Hobart's Reserve), Petra and Jutta going in; Brann on the bench with a
// Mole's Brown waiting (paid); four slots; Wim and the copper home (4 on tap), the cask book and Ilse away (6 dry).
const mk = `(id, name, cls, hp, maxHp, level = 1) => ({ id, name, cls, level, xp: 0, maxHp, hp, stats: { might: 50, finesse: 50, wits: 50, nerve: 50 }, weaponTier: 0, armorTier: 0, wounded: 0, kills: 0, delves: 1 })`;
await edit(`const mk = ${mk};
  const c = s.campaign;
  c.gold = 325; c.squadSlots = 4; c.delveCount = 4;
  Object.assign(c.village, { innkeeper: true, copper: true, muster: true, caskbook: false, alchemist: false });
  c.roster.push(mk('petra', 'Petra', 'shadowmancer', 9, 9), mk('jutta', 'Jutta', 'hedgewitch', 7, 7), mk('brann', 'Brann', 'sapper', 9, 9));
  c.roster[0].ale = 'reserve'; delete c.roster[0].alePaid; c.roster[0].aleGift = true;
  c.roster[3].ale = 'mole'; c.roster[3].alePaid = 20;
  c.recruits = [
    { hero: mk('r-dagny', 'Dagny', 'sellsword', 10, 10), price: 60 },
    { hero: mk('r-osk', 'Osk', 'ranger', 8, 8, 2), price: 100 },
  ];`);
await p.click('[data-bench="petra"]');
await wait();
await p.click('[data-bench="jutta"]');
await wait();
await p.waitForFunction(() => [...document.querySelectorAll('.pt .bust')].every((b) => b.classList.contains('img')), null, { timeout: 60000 });

const ales = await p.evaluate(() => {
  const s = window.vc.state();
  return window.vcEngine.ales(s);
});
const special = ales.find((a) => a.special);
check('the engine names one special among the unlocked ales, never the Black Cask', !!special && !special.locked && special.kind !== 'blackcask' && special.basePrice - special.price === 5, JSON.stringify(special));

// ---- the tabs: Hire by default (recruits waiting), The taps with its counts and the special's badge
check('the Flagon has two tabs, Hire on by default', !!(await p.$('[data-ftab="hire"].on')) && !!(await p.$('[data-ftab="taps"]:not(.on)')));
const tapsTab = await p.$eval('[data-ftab="taps"]', (e) => e.innerText.replace(/\s+/g, ' '));
check('The taps tab counts 4 on tap + 6 dry and badges "Special tonight" inline', /4 \+ 6/.test(tapsTab) && /Special tonight/.test(tapsTab), tapsTab);
{
  // the badge sits after the count and never covers the label, at 1280 and at 1920
  for (const [w, hh] of [[1280, 720], [1920, 1080]]) {
    await p.setViewportSize({ width: w, height: hh });
    await wait(200);
    const o = await p.evaluate(() => {
      const tab = document.querySelector('[data-ftab="taps"]');
      const badge = tab.querySelector('.pt-spbadge').getBoundingClientRect();
      const n = tab.querySelector('.n').getBoundingClientRect();
      const r = document.createRange();
      r.selectNodeContents(tab);
      const label = [...tab.childNodes].find((x) => x.nodeType === 3 && /The taps/.test(x.textContent));
      const lr = document.createRange();
      lr.selectNodeContents(label);
      const l = lr.getBoundingClientRect();
      const tr = tab.getBoundingClientRect();
      return { overLabel: badge.left < l.right && badge.right > l.left && badge.top < l.bottom && badge.bottom > l.top, afterCount: badge.left >= n.right - 1, inside: badge.top >= tr.top - 1 && badge.bottom <= tr.bottom + 1 };
    });
    check(`${w}: the special badge follows the count, inside the tab, off the label`, !o.overLabel && o.afterCount && o.inside, JSON.stringify(o));
  }
  await p.setViewportSize({ width: 1920, height: 1080 });
  await wait(200);
}
check('the footer points at the taps (drinks are discoverable)', /on tap/.test(await p.$eval('.foot .mid', (e) => e.innerText)), await p.$eval('.foot .mid', (e) => e.innerText));
await p.click('[data-ftab="taps"]');
await wait();
check('The taps tab opens the bar', !!(await p.$('[data-ftab="taps"].on')) && !!(await p.$('.pt-bar .pt-taps')));
await calm();
await p.screenshot({ path: `${shots}/taps-1920.png` });
await p.click('.lg-step[data-step="outfit"]');
await wait();
await p.click('.lg-step[data-step="party"]');
await wait();
check('the chosen tab is remembered on this visit', !!(await p.$('[data-ftab="taps"].on')));

const taps = await p.$$eval('.pt-tap', (els) => els.map((e) => ({ k: e.dataset.tap, dry: !!e.dataset.dry, sp: e.classList.contains('special'), text: e.innerText.replace(/\s+/g, ' '), tip: e.dataset.tip ?? '' })));
check('ten taps: four live, six dry', taps.length === 10 && taps.filter((t) => !t.dry).length === 4 && taps.filter((t) => t.dry).length === 6, taps.map((t) => t.k).join(','));
check('every live tap: a tankard in its colour, name, one-line effect, a price', (await p.$$eval('.pt-tap:not(.off)', (els) => els.every((e) => e.querySelector('.tank')?.style.getPropertyValue('--ale') && e.querySelector('h5') && e.querySelector('.fx .ic') && e.querySelector('.price')))));
const spTap = taps.find((t) => t.sp);
check('the special tap: dashed outline, struck base price and the special price', !!spTap && spTap.k === special.kind && new RegExp(`${special.basePrice}.*${special.price}`).test(spTap.text), spTap?.text);
const boardTxt = await p.$eval('.pt-board', (e) => e.innerText.replace(/\s+/g, ' '));
check('Wim\'s chalkboard names the special, the struck price and the new one', boardTxt.includes(special.name) && boardTxt.includes(`${special.basePrice}`) && boardTxt.includes(`${special.price}`), boardTxt);
const chalk = await p.$$eval('.pt-drygrp .chalk', (els) => els.map((e) => e.innerText));
check('dry taps: Wim\'s hints in voice (the cask book, Ilse), the rule on hover', chalk.some((c) => /cask book/.test(c)) && chalk.some((c) => /Ilse/.test(c)) && taps.filter((t) => t.dry).every((t) => /dry tap/.test(t.tip)), chalk.join(' | '));
check('the mugs: Keven full (a gift), Petra and Jutta thirsty', !!(await p.$('.pt-hero[data-hero="keven"] .pt-mug.full.gift')) && !!(await p.$('.pt-hero[data-hero="petra"] .pt-mug.empty')) && /Thirsty/.test(await p.textContent('.pt-hero[data-hero="jutta"] .pt-alename')));
check('the bench: Brann shows a tiny tankard (his Mole\'s Brown waits)', !!(await p.$('.pt-bh .pt-bh-ale[data-ale="mole"] .tank')));
{
  // a benched hero's ale tips back from the bench (same refund and gift rules), with a tip saying so
  const g = (await st()).campaign.gold;
  check('...its tip says it tips back for 20', /Click to tip it back: 20 gold back/.test((await p.getAttribute('[data-bench-ale="brann"]', 'data-tip')) ?? ''));
  await p.click('[data-bench-ale="brann"]');
  await wait(250);
  check('...clicking it tips it back: 20 back, the tankard gone, the bench hero not picked up', !(await hero('brann')).ale && (await gold()) === g + 20 && !(await p.$('[data-bench-ale="brann"]')) && !(await p.$('.lifted')));
  await edit(`const b = s.campaign.roster.find((x) => x.id === 'brann'); b.ale = 'reserve'; b.aleGift = true;`);
  await p.click('[data-bench-ale="brann"]');
  await wait(200);
  check('...a gifted one on the bench stays: "A gift from Wim."', (await hero('brann')).ale === 'reserve' && (await gold()) === g + 20 && /A gift from Wim/.test((await p.getAttribute('[data-bench-ale="brann"]', 'data-tip')) ?? ''));
  // an ale from before V5.1.2: no record, no gift mark: the truthful line, on the mug and on click
  await edit(`const b = s.campaign.roster.find((x) => x.id === 'brann'); b.ale = 'mole'; delete b.aleGift; delete b.alePaid;`);
  check('...an old unrecorded ale says "Poured before Wim kept a tab. It stays poured."', /Poured before Wim kept a tab\. It stays poured\./.test((await p.getAttribute('[data-bench-ale="brann"]', 'data-tip')) ?? '') && !/gift/i.test((await p.getAttribute('[data-bench-ale="brann"]', 'data-tip')) ?? ''));
  await p.click('[data-bench-ale="brann"]');
  await wait(200);
  check('...and clicking it refuses with that line, nothing refunded', (await hero('brann')).ale === 'mole' && (await gold()) === g + 20 && /Poured before Wim kept a tab/.test(await p.$$eval('.screen-toast', (els) => els.map((e) => e.innerText).join(' '))));
  await edit(`const b = s.campaign.roster.find((x) => x.id === 'brann'); b.alePaid = 20; s.campaign.gold = ${g};`);
}
check('the Party step says how many ales', /1 ale/.test(await p.$eval('.lg-step[data-step="party"]', (e) => e.innerText)));

// ---- drag: Glowworm Pale onto Petra
let g0 = await gold();
{
  const glow = ales.find((a) => a.kind === 'glowworm');
  const tb = await (await p.$('.pt-tap[data-tap="glowworm"]')).boundingBox();
  const hb = await (await p.$('.pt-hero[data-hero="petra"]')).boundingBox();
  await p.mouse.move(tb.x + tb.width / 2, tb.y + 90);
  await p.mouse.down();
  await p.mouse.move(tb.x + 60, tb.y - 40, { steps: 4 });
  await p.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2, { steps: 8 });
  await wait(120);
  const held = await p.$eval('.pt-hero[data-hero="petra"]', (e) => ({ ok: e.classList.contains('drop-ok'), over: e.classList.contains('drop-over'), when: e.querySelector('.pt-alename .when')?.innerText ?? '' }));
  const hint = await p.$eval('.drop-hint', (e) => e.innerText).catch(() => '');
  const keven = await p.$eval('.pt-hero[data-hero="keven"]', (e) => ({ no: e.classList.contains('drop-no'), tip: e.dataset.tip ?? '' }));
  check('while a tankard is held: Petra\'s card lights, "Drop to pour", the hint "Pour for Petra · price"', held.ok && held.over && /Drop to pour/.test(held.when) && hint === `Pour for Petra · ${glow.price}`, JSON.stringify(held) + ' ' + hint);
  check('...Keven (one waiting) dims and says why', keven.no && /already has one waiting/.test(keven.tip), keven.tip);
  check('...a big tilted tankard follows the pointer', !!(await p.$('.drag-ghost.pt-flying .tank')));
  check('...open slots and recruits take no notice (neither lit nor dimmed)', !(await p.$('.pt-empty.drop-no, .pt-empty.drop-ok')));
  await p.screenshot({ path: `${shots}/pour.png` });
  await p.mouse.up();
  await wait(300);
  check('dropping pours: Petra has Glowworm Pale, the gold paid and recorded', (await hero('petra')).ale === 'glowworm' && (await gold()) === g0 - glow.price && (await hero('petra')).alePaid === glow.price);
  check('...her mug is full in the ale\'s colour, name and effect beside it', !!(await p.$('.pt-hero[data-hero="petra"] .pt-mug.full .tank')) && /Glowworm Pale/.test(await p.textContent('.pt-hero[data-hero="petra"] .pt-alename')));
}

// ---- an invalid drop does nothing
{
  g0 = await gold();
  const tb = await (await p.$('.pt-tap[data-tap="mole"]')).boundingBox();
  const hb = await (await p.$('.pt-hero[data-hero="keven"]')).boundingBox();
  await p.mouse.move(tb.x + tb.width / 2, tb.y + 90);
  await p.mouse.down();
  await p.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2, { steps: 8 });
  await wait(80);
  check('dragging onto Keven: "Can\'t pour" shows on his card', /Can't pour/.test(await p.$eval('.pt-hero[data-hero="keven"] .pt-alename', (e) => e.innerText)));
  await p.mouse.up();
  await wait(200);
  check('...and the drop does nothing', (await hero('keven')).ale === 'reserve' && (await gold()) === g0);
}

// ---- click then click: Featherfoot for Jutta; then tip it back
{
  g0 = await gold();
  const ff = ales.find((a) => a.kind === 'featherfoot');
  await p.click('.pt-tap[data-tap="featherfoot"] h5');
  await wait(60);
  check('clicking a tap picks it up (Jutta lights)', !!(await p.$('.pt-hero[data-hero="jutta"].drop-ok')));
  await p.click('.pt-hero[data-hero="jutta"] h3');
  await wait(250);
  check('...clicking Jutta pours it', (await hero('jutta')).ale === 'featherfoot' && (await gold()) === g0 - ff.price);
  await p.click('.pt-hero[data-hero="jutta"] .pt-mug.full');
  await wait(250);
  check('tip it back: clicking the full mug refunds and empties it', !(await hero('jutta')).ale && (await gold()) === g0 && !!(await p.$('.pt-hero[data-hero="jutta"] .pt-mug.empty')));
  check('...the purse\'s coin stack plays the gold coming back', !!(await p.$('.purse .coinstack.earn, .purse .coinstack .fly.in')));
}

// ---- keyboard: Enter on a tap, Enter on the (only) hero that takes it
{
  g0 = await gold();
  await p.focus('.pt-tap[data-tap="mole"]');
  await p.keyboard.press('Enter');
  await wait(80);
  await p.keyboard.press('Enter');
  await wait(250);
  const mole = ales.find((a) => a.kind === 'mole');
  check('keyboard: Enter lifts a tankard, Enter pours it for Jutta', (await hero('jutta')).ale === 'mole' && (await gold()) === g0 - mole.price);
  await p.click('.pt-hero[data-hero="jutta"] .pt-mug.full');
  await wait(200);
}

// ---- the gift can't be tipped back
{
  g0 = await gold();
  const tip = await p.getAttribute('.pt-hero[data-hero="keven"] .pt-mug', 'data-tip');
  await p.click('.pt-hero[data-hero="keven"] .pt-mug');
  await wait(200);
  check('Keven\'s gift: "A gift from Wim. He\'d be hurt." on hover and on click; nothing changes', /A gift from Wim\. He'd be hurt\./.test(tip ?? '') && /A gift from Wim/.test(await p.$eval('.screen-toast', (e) => e.innerText).catch(() => '')) && (await hero('keven')).ale === 'reserve' && (await gold()) === g0);
}

// ---- a round of the special: for Petra (tipped back first) and Jutta, charged at the special price
{
  await p.click('.pt-hero[data-hero="petra"] .pt-mug.full');
  await wait(200);
  g0 = await gold();
  const r = await p.$eval(`.pt-tap[data-tap="${special.kind}"] .pt-round`, (e) => e.innerText.replace(/\s+/g, ' '));
  const rtip = await p.getAttribute(`.pt-tap[data-tap="${special.kind}"] .pt-round`, 'data-tip');
  check('the special\'s Round always says "Round" and the total at the special price; the count is in its tip', new RegExp(`^Round · ${special.price * 2}$`).test(r.trim()) && new RegExp(`2 × ${special.price}`).test(rtip ?? ''), `${r} | ${rtip}`);
  await p.setViewportSize({ width: 1280, height: 720 });
  await wait(200);
  const r1280 = await p.$$eval('.pt-round', (els) => els.map((e) => e.innerText.trim()));
  check('...at 1280 too, every Round button says "Round"', r1280.length >= 4 && r1280.every((x) => /^Round · \d+$/.test(x)), r1280.join(' | '));
  await p.screenshot({ path: `${shots}/taps-1280.png` });
  await p.setViewportSize({ width: 1920, height: 1080 });
  await wait(200);
  await p.click(`.pt-tap[data-tap="${special.kind}"] .pt-round`);
  await wait(400);
  const pe = await hero('petra');
  const ju = await hero('jutta');
  check('the round pours one each, charged and recorded at the special price', pe.ale === special.kind && ju.ale === special.kind && (await gold()) === g0 - 2 * special.price && pe.alePaid === special.price, `${await gold()} vs ${g0}`);
  check('nobody thirsty: the Round buttons are gone', !(await p.$('.pt-round')));
  check('...and focus moved to the first tap (keyboard users keep their place)', await p.evaluate(() => document.activeElement?.matches('.pt-tap[data-drag]') ?? false));
  await p.click('.pt-hero[data-hero="petra"] .pt-mug.full');
  await wait(200);
  check('the special tips back for what was paid', (await gold()) === g0 - special.price);
  await edit('s.campaign.gold = 10;');
  const off = await p.$eval('.pt-tap[data-tap="reserve"] .pt-round', (e) => ({ off: e.classList.contains('is-off') || e.getAttribute('aria-disabled') === 'true', tip: e.dataset.tip ?? '' }));
  check('a round you can\'t afford is disabled with the reason', off.off && /You have 10/.test(off.tip), JSON.stringify(off));
  await edit('s.campaign.gold = 325;');
}

// ---- four heroes: no scrolling anywhere
await p.click('[data-bench="brann"]');
await wait();
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
    const mr = main.getBoundingClientRect();
    const out = [...main.querySelectorAll('.pt *')].filter((e) => {
      if (e.closest('.drag-ghost')) return false;
      const r = e.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      return r.left < mr.left - 1 || r.right > mr.right + 1 || r.top < mr.top - 1 || r.bottom > mr.bottom + 1;
    }).map((e) => e.className);
    return { pageScroll, scrollers, out };
  });
check('four heroes in the party', (await p.$$('.pt-hero')).length === 4);
for (const [w, hh] of [[1280, 720], [1920, 1080], [2560, 1440]]) {
  await p.setViewportSize({ width: w, height: hh });
  await calm();
  for (const t of ['taps', 'hire']) {
    await p.click(`[data-ftab="${t}"]`);
    await calm();
    const lay = await layout();
    check(`${w}x${hh}, ${t}: no scrolling, nothing spills out of main`, !lay.pageScroll && !lay.scrollers.length && !lay.out.length, JSON.stringify(lay).slice(0, 300));
  }
  await p.click('[data-ftab="taps"]');
  await calm();
  await p.screenshot({ path: `${shots}/taps-four-${w}.png` });
}
await p.setViewportSize({ width: 1920, height: 1080 });
await wait(200);

// ---- Outfit: Wim's tab is gone
await p.click('.lg-step[data-step="outfit"]');
await wait();
const vt = await p.$$eval('[data-vendor-tab]', (els) => els.map((e) => e.dataset.vendorTab));
check('Outfit: three vendor tabs, no Wim (the taps are on the Party step)', vt.join(',') === 'mott,gerda,ilse', vt.join(','));
check('Outfit: no ale for sale anywhere', !(await p.$('[data-pour], [data-row^="ale-"]')));
check('Outfit: a quiet pointer where Wim\'s tab was', /Wim's taps/.test(await p.$eval('[data-taps-moved]', (e) => e.innerText).catch(() => '')) && /moved to the Flagon, on the Party step/.test((await p.getAttribute('[data-taps-moved]', 'data-tip')) ?? ''));
await p.click('[data-ftab]').catch(() => {});
await p.click('[data-taps-moved]');
await wait(200);
check('...clicking it opens the Party step on The taps', (await p.$eval('.lg-step.on', (e) => e.dataset.step).catch(() => '')) === 'party' && !!(await p.$('[data-ftab="taps"].on')));
await p.click('.lg-step[data-step="outfit"]');
await wait();

// ---- the toast: Delve with drinkers (one a Black Cask)
await edit(`Object.assign(s.campaign.village, { caskbook: true }); const j = s.campaign.roster.find((x) => x.id === 'jutta'); j.ale = 'blackcask'; j.alePaid = 10;`);
const campSave = await st();
await p.click('.lg-step[data-step="setout"]');
await wait();
const before = await st();
await p.evaluate(() => (window.vcToastHold = true)); // keep it up for the screenshot (skipped below)
await p.click('.lg-delve[data-k="delve"]');
await p.waitForSelector('.vc-toast', { timeout: 5000 }).catch(() => {});
await wait(1500);
const after = await st();
const drinkers = await p.$$eval('.vc-toast .ts-drinker', (els) => els.map((e) => ({ id: e.dataset.drinker, ale: e.dataset.ale, raised: !!e.querySelector('.ts-raise .tank'), say: e.querySelector('.ts-say')?.innerText ?? '' })));
check('Delve with drinkers: "One for the road" comes up', /One for the road/.test(await p.$eval('.vc-toast', (e) => e.innerText).catch(() => '')));
check('...every hero going in, busts and raised tankards for the three drinkers (Petra: water)', drinkers.length === 4 && drinkers.filter((d) => d.raised).length === 3 && /water/.test(drinkers.find((d) => d.id === 'petra')?.say ?? ''), JSON.stringify(drinkers));
check('...Keven says "To Valkenburg!"', /To Valkenburg!/.test(drinkers.find((d) => d.id === 'keven')?.say ?? ''));
const became = after.delve.heroes.find((x) => x.heroId === 'jutta').ale;
check('...the Black Cask card shows what it became, as the engine decided', (await p.$eval('.ts-card[data-cask="jutta"]', (e) => e.dataset.became).catch(() => '')) === became && became !== 'blackcask' && !!became, became);
check('...the drinkers\' effect chips', (await p.$$('.vc-toast .ts-fx')).length === 3);
check('the engine drank before the toast: the roster ales are cleared', after.campaign.roster.every((x) => !x.ale) && before.campaign.roster.find((x) => x.id === 'jutta').ale === 'blackcask');
await p.screenshot({ path: `${shots}/toast.png`, timeout: 180000 });
await p.evaluate(() => (window.vcToastHold = false));
const round0 = after.delve.round;
const phase0 = after.delve.phase;
await p.keyboard.press('e');
await wait(500);
const after2 = await st();
check('E skips the toast and does not end the turn', !(await p.$('.vc-toast')) && after2.delve.round === round0 && after2.delve.phase === phase0, `${round0}/${phase0} -> ${after2.delve.round}/${after2.delve.phase}`);

// ---- the HUD badge
await wait(300);
const badges = await p.$$eval('.dl-rcard .dl-ale', (els) => els.map((e) => ({ hero: e.closest('.dl-rcard')?.dataset.hero, ale: e.dataset.ale, tip: e.dataset.tip ?? '', colour: e.querySelector('.tank')?.style.getPropertyValue('--ale') })));
check('HUD: each drinker\'s card wears a tankard badge in the ale\'s colour, the effect on hover', badges.length === 3 && badges.every((x) => x.colour && x.tip.includes('·')), JSON.stringify(badges).slice(0, 300));
await edit(`const d = s.delve; d.heroes.find((x) => x.heroId === 'petra').ale = 'featherfoot'; d.heroes.find((x) => x.heroId === 'petra').aleSpent = true; d.heroes.find((x) => x.heroId === 'jutta').ale = 'hiccups'; d.heroes.find((x) => x.heroId === 'brann').ale = 'heavyhead';`);
check('HUD: a spent Featherfoot greys out ("used")', !!(await p.$('.dl-rcard[data-hero="petra"] .dl-ale.spent')) && /used/.test(await p.getAttribute('.dl-rcard[data-hero="petra"] .dl-ale', 'data-tip')));
check('HUD: hiccups and a heavy head get the bad look', !!(await p.$('.dl-rcard[data-hero="jutta"] .dl-ale.bad')) && !!(await p.$('.dl-rcard[data-hero="brann"] .dl-ale.bad')));
await p.screenshot({ path: `${shots}/hud-badge.png`, timeout: 180000 });
const rail = await p.$('.dl-rcard[data-hero="keven"]');
if (rail) {
  const rb = await rail.boundingBox();
  await p.screenshot({ path: `${shots}/hud-badge-zoom.png`, clip: { x: Math.max(0, rb.x - 10), y: Math.max(0, rb.y - 10), width: 280, height: Math.min(4 * (rb.height + 10) + 20, 500) }, timeout: 180000 });
}

// ---- the toast is clickable away; skipped at Instant; none without drinkers
await p.evaluate((s) => window.vc.load(s), campSave);
await wait(300);
await p.click('.lg-step[data-step="setout"]').catch(() => {});
await wait();
await p.click('.lg-delve[data-k="delve"]');
await p.waitForSelector('.vc-toast', { timeout: 3000 }).catch(() => {});
await wait(300);
check('the toast again: a click skips it', !!(await p.$('.vc-toast')));
await p.mouse.click(960, 540);
await wait(400);
check('...gone after the click', !(await p.$('.vc-toast')));

await p.evaluate((s) => window.vc.load(s), campSave);
await wait(300);
await p.evaluate(() => (window.vc.settings.speed = 0));
await p.click('.lg-step[data-step="setout"]').catch(() => {});
await wait();
await p.click('.lg-delve[data-k="delve"]');
await wait(500);
check('Instant speed: no toast', !(await p.$('.vc-toast')) && (await st()).stage === 'delve');
await p.evaluate(() => (window.vc.settings.speed = 1));

await p.evaluate((s) => { for (const h of s.campaign.roster) { delete h.ale; delete h.alePaid; } window.vc.load(s); }, campSave);
await wait(300);
await p.click('.lg-step[data-step="setout"]').catch(() => {});
await wait();
await p.click('.lg-delve[data-k="delve"]');
await wait(600);
check('nobody drinking: no toast, straight in', !(await p.$('.vc-toast')) && (await st()).stage === 'delve');

// ---- the Black Cask, reduced motion: the overlay still says what it became
await p.emulateMedia({ reducedMotion: 'reduce' });
await p.evaluate((s) => window.vc.load(s), campSave);
await wait(300);
await p.click('.lg-step[data-step="setout"]').catch(() => {});
await wait();
await p.click('.lg-delve[data-k="delve"]');
await p.waitForSelector('.vc-toast', { timeout: 3000 }).catch(() => {});
await wait(200);
check('reduced motion: a still toast (no animation), the reveal in place', !!(await p.$('.vc-toast.still .ts-card[data-became]')));
await p.keyboard.press('Space');
await wait(300);
check('...Space skips it', !(await p.$('.vc-toast')));

check('no page errors', errors === 0, `${errors}`);
await b.close();
console.log(failed ? `${failed} FAILED` : 'all ok');
process.exit(failed ? 1 : 0);
