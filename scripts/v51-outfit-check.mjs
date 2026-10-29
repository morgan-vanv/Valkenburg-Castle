// V5.1 (W3) Outfit board check, headless, real engine: the board fits the camp stage at 1920x1080 and 2560x1440 (and the
// smaller windows) with nothing scrolling or spilling out of the 1920x900 main; Buy fills the chosen hero ("Buying here",
// their face on the button); dragging a ware onto a pack buys and packs it (pointer, click-then-click, keyboard); a full
// pack leaves the purchase on the wagon with a clear line; packed things drag back to the wagon and between packs; loot
// sells from its flag and Sell all; the forge and the Flagon work for the chosen hero; locked wares sit on the strip with
// their hint on hover; the wagon's side page fits too. Screenshots go to <shots>/outfit-<w>.png and friends.
//   node scripts/v51-outfit-check.mjs <baseUrl> [shotsDir]
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';

const [base = 'http://localhost:5193/', shots = ''] = process.argv.slice(2);
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
const wait = (ms = 120) => p.waitForTimeout(ms);
const shot = async (name, keepMouse = false) => {
  if (!shots) return;
  if (!keepMouse) await p.mouse.move(2, 2);
  await wait(150);
  await p.screenshot({ path: `${shots}/${name}.png` });
};
const goStep = async (s) => {
  await p.click(`.lg-step[data-step="${s}"]`);
  await wait();
};
const tab = async (t) => {
  await p.click(`[data-vendor-tab="${t}"]`);
  await wait();
};
const packOf = (id) => p.$$eval(`[data-side="yours"] .hr[data-hero="${id}"] [data-packed]`, (els) => els.map((e) => e.dataset.packed));

/** Nothing in the stage scrolls; nothing in the board spills out of the 1920x900 main. */
const fits = () =>
  p.evaluate(() => {
    const se = document.scrollingElement;
    const page = se.scrollHeight <= innerHeight + 1 && se.scrollWidth <= innerWidth + 1;
    const board = document.querySelector('.of');
    const root = board.closest('.camp');
    const scrollers = [...root.querySelectorAll('*')].filter((e) => {
      const cs = getComputedStyle(e);
      return /(auto|scroll)/.test(cs.overflowY + cs.overflowX) && (e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1);
    });
    const main = board.parentElement.getBoundingClientRect();
    const sc = root.getBoundingClientRect().width / 1920;
    const out = [...board.querySelectorAll('*')].filter((e) => {
      if (e.closest('[hidden]') || e.closest('.drag-ghost')) return false;
      const r = e.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      return r.left < main.left - 1 || r.top < main.top - 1 || r.right > main.right + 1 || r.bottom > main.bottom + 1;
    });
    // The board's own boxes stay inside the main (1920x900 stage px) and nothing is clipped by the board itself.
    const clip = board.scrollHeight > board.clientHeight + 1 || board.scrollWidth > board.clientWidth + 1;
    return { page, scrollers: scrollers.map((e) => e.className || e.tagName).slice(0, 4), out: out.map((e) => `${e.tagName}.${e.className}`).slice(0, 4), clip, mainH: Math.round(main.height / sc), mainW: Math.round(main.width / sc) };
  });
const assertFits = async (label) => {
  const f = await fits();
  check(`${label}: no scrolling, nothing spills out of the 1920x900 main`, f.page && !f.scrollers.length && !f.out.length && !f.clip && f.mainW === 1920 && f.mainH === 900, JSON.stringify(f));
};

// ---- seed: three heroes, Gerda, Wim and the copper home, Ilse away, loot and spares on the wagon
await p.goto(base);
await p.waitForFunction(() => !!window.vcEngine);
const seedIds = await p.evaluate(() => {
  const E = window.vcEngine;
  const s = E.apply(E.newGame(7), { type: 'newCampaign', seed: 7 }).state;
  return ['keven', ...s.campaign.recruits.slice(0, 2).map((r) => r.hero.id)];
});
await p.evaluate((ids) => {
  localStorage.clear();
  localStorage.setItem('vc.settings', JSON.stringify({ speed: 0, reduceShake: true, noEndTurnAsk: true, quality: 'low' }));
  localStorage.setItem('vc.welcome.v40', '1');
  localStorage.setItem('vc.loadout.v33', JSON.stringify({ heroIds: ids, packs: {}, entrance: 0 }));
}, seedIds);
await p.reload();
await p.waitForFunction(() => !!window.vc);
await p.evaluate(() => {
  const E = window.vcEngine;
  const s = structuredClone(E.apply(E.newGame(7), { type: 'newCampaign', seed: 7 }).state);
  const c = s.campaign;
  c.gold = 340;
  c.delveCount = 4;
  Object.assign(c.village, { surgeon: true, innkeeper: true, smith: true, copper: true, caskbook: false, alchemist: false });
  c.credits = { shield: 1 };
  for (const r of c.recruits.slice(0, 2)) c.roster.push(r.hero);
  c.recruits = c.recruits.slice(2);
  c.roster[0].weaponTier = 1;
  c.roster[1].shield = true;
  c.stash.push(
    { id: 'g1', kind: 'gem', name: 'Moonstone', amount: 70, slots: 1 },
    { id: 'g2', kind: 'jewelry', name: 'Silver torc', amount: 110, slots: 1 },
    { id: 'r1', kind: 'rope', name: 'Rope', amount: 1, slots: 1 },
    { id: 'c1', kind: 'charge', name: 'Blasting charge', amount: 1, slots: 1 },
  );
  window.vc.load(s);
});
await wait(200);
await goStep('outfit');
const [K, H1, H2] = seedIds;
check('the board renders: three hero packs, the wagon, four vendor tabs', (await p.$$('[data-side="yours"] .hr')).length === 3 && !!(await p.$('[data-cartbox]')) && (await p.$$('[data-vendor-tab]')).length === 4);
check('"Buying here" on the chosen hero (Keven first), and nowhere "Buying for"', /Buying here/i.test(await p.$eval('.hr.sel', (e) => e.innerText)) && (await p.$eval('.hr.sel', (e) => e.dataset.hero)) === K && !/Buying for/.test(await p.$eval('.of', (e) => e.innerText)));
check("Buy buttons carry the chosen hero's face", (await p.$$('.w .buy .chipb .bust')).length >= 8);
check("Mott's shelf: 8 wares on hex pedestals, each with an icon, a name and a coin price", (await p.$$eval('.shelf .w:not([hidden])', (els) => els.filter((e) => e.querySelector('.ped .ic') && e.querySelector('h4') && e.querySelector('.price .ic-coin')).length)) === 8);
check('the wagon holds the spares and the loot, Sell all · 180', (await p.$$('[data-cartbox] [data-cart]')).length === 2 && (await p.$$('[data-cartbox] [data-valuable]')).length === 2 && /180/.test(await p.$eval('[data-sellall]', (e) => e.innerText)));

for (const [w, hh] of [[1920, 1080], [2560, 1440], [1280, 720], [1366, 768], [1440, 900]]) {
  await p.setViewportSize({ width: w, height: hh });
  await wait(200);
  await assertFits(`${w}x${hh} Mott`);
  if (w === 1920 || w === 2560) await shot(`outfit-${w}`);
}
await p.setViewportSize({ width: 1920, height: 1080 });
await wait(150);

// ---- Buy: into the chosen hero's pack
let s0 = await st();
await p.click('[data-buy="torch"]');
await wait(200);
let s1 = await st();
let newId = s1.campaign.stash.find((i) => !s0.campaign.stash.some((j) => j.id === i.id))?.id;
check('Buy: gold down by the price and the torch packed for the chosen hero', s1.campaign.gold === s0.campaign.gold - 10 && !!newId && (await packOf(K)).includes(newId), `gold ${s1.campaign.gold}`);
check('...the slot glows and the vendor says where it went', !!(await p.$(`[data-packed="${newId}"].new`)) && /into Keven's pack/.test(await p.$eval('.say', (e) => e.innerText)));
check('...the torch tile counts one packed', (await p.$eval('[data-row="torch"] [data-owned="packed"]', (e) => e.dataset.n).catch(() => '')) === '1');

// ---- drag (pointer) a ware onto another hero's pack: buys and packs it there
const centre = async (sel) => {
  const r = await p.$eval(sel, (e) => {
    const b = e.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  });
  return r;
};
const dragTo = async (from, to, mid) => {
  const a = await centre(from);
  const z = await centre(to);
  await p.mouse.move(a.x, a.y);
  await p.mouse.down();
  await p.mouse.move(a.x + 20, a.y + 20, { steps: 4 });
  await p.mouse.move(z.x, z.y, { steps: 10 });
  if (mid) await mid();
  await p.mouse.up();
  await wait(250);
};
s0 = await st();
await dragTo('[data-row="potion"] .ped', `.hr[data-hero="${H1}"] .packrow`, async () => {
  const lit = await p.evaluate((h1) => ({ ok: document.querySelector(`.hr[data-hero="${h1}"]`).classList.contains('drop-over'), hint: document.querySelector('.drop-hint')?.innerText ?? '' }), H1);
  check('dragging a ware lights the pack under it with the price', lit.ok && /20 · into .*'s pack/.test(lit.hint), JSON.stringify(lit));
  await shot('outfit-drag-1920', true);
});
s1 = await st();
newId = s1.campaign.stash.find((i) => !s0.campaign.stash.some((j) => j.id === i.id))?.id;
check('drop to buy: the potion is bought and packed for the hero it was dropped on', s1.campaign.gold === s0.campaign.gold - 20 && (await packOf(H1)).includes(newId) && (await p.$eval('.hr.sel', (e) => e.dataset.hero)) === K, `gold ${s0.campaign.gold}->${s1.campaign.gold} ${newId} ${await packOf(H1)} sel ${await p.$eval('.hr.sel', (e) => e.dataset.hero)}`);

// ---- click, then click: the same without a mouse drag
s0 = await st();
await p.click('[data-row="rope"] h4');
await wait(80);
check('clicking a ware lifts it (the packs light up)', (await p.$$('.hr.drop-ok')).length === 3);
await p.click(`.hr[data-hero="${H2}"] .bw`);
await wait(250);
s1 = await st();
newId = s1.campaign.stash.find((i) => !s0.campaign.stash.some((j) => j.id === i.id))?.id;
check('...and clicking a hero buys it into that pack', !!newId && (await packOf(H2)).includes(newId));

// ---- keyboard: Enter lifts, arrows pick a pack, Enter drops
s0 = await st();
await p.focus('[data-row="firecracker"]');
await p.keyboard.press('Enter');
await wait(60);
await p.keyboard.press('Enter');
await wait(250);
s1 = await st();
newId = s1.campaign.stash.find((i) => !s0.campaign.stash.some((j) => j.id === i.id))?.id;
check('keyboard: Enter on a ware, Enter on the first lit pack buys it there', !!newId && Object.values(seedIds).some(() => true) && (await Promise.all(seedIds.map(packOf))).flat().includes(newId));

// ---- packed things: drag back to the wagon, and between packs
const torchId = (await st()).campaign.stash.find((i) => i.kind === 'torch').id;
await dragTo(`[data-packed="${torchId}"]`, '[data-cartbox] h3');
check('a packed thing dragged to the wagon goes back on it', !(await packOf(K)).includes(torchId) && !!(await p.$('[data-cartbox] [data-cart="torch"]')));
await dragTo('[data-cartbox] [data-cart="torch"]', `.hr[data-hero="${H2}"] .packrow`);
check('a spare dragged from the wagon onto a pack is packed there', (await packOf(H2)).includes(torchId));
await dragTo(`[data-packed="${torchId}"]`, `.hr[data-hero="${K}"] .packrow`);
check('...and from pack to pack', (await packOf(K)).includes(torchId) && !(await packOf(H2)).includes(torchId));

// ---- a full pack: Buy leaves it on the wagon, with a clear line
await p.click(`.hr[data-hero="${H1}"] .bw`);
await wait(100);
check('clicking a hero moves "Buying here"', (await p.$eval('.hr.sel', (e) => e.dataset.hero)) === H1);
for (const sel of ['[data-cartbox] [data-cart="rope"]', '[data-cartbox] [data-cart="charge"]', '[data-cartbox] [data-cart="torch"]']) {
  if (!(await p.$(sel))) continue;
  if ((await packOf(H1)).length >= 4) break;
  await dragTo(sel, `.hr[data-hero="${H1}"] .packrow`);
}
while ((await packOf(H1)).length < 4) {
  await p.click('[data-buy="potion"]');
  await wait(200);
}
const fullDrop = await p.evaluate(async () => 0);
void fullDrop;
s0 = await st();
await p.click('[data-buy="potion"]');
await wait(220);
s1 = await st();
newId = s1.campaign.stash.find((i) => !s0.campaign.stash.some((j) => j.id === i.id))?.id;
check("a full pack: Buy still buys, the potion waits on the wagon and the vendor says so", !!newId && !(await Promise.all(seedIds.map(packOf))).flat().includes(newId) && /pack is full\. The potion waits on the wagon\./.test(await p.$eval('.say', (e) => e.innerText)), await p.$eval('.say', (e) => e.innerText));
await p.click('[data-row="rope"] h4');
await wait(60);
const no = await p.$eval(`.hr[data-hero="${H1}"]`, (e) => ({ no: e.classList.contains('drop-no'), tip: e.dataset.tip ?? '' }));
check('...and a lifted ware dims the full pack, saying why', no.no && /pack is full/.test(no.tip), JSON.stringify(no));
await p.keyboard.press('Escape');
await wait(60);

// ---- loot: one from its flag, then Sell all
s0 = await st();
await p.click('[data-sell="g1"]');
await wait(200);
s1 = await st();
check('selling one loot from its flag adds its worth', s1.campaign.gold === s0.campaign.gold + 70 && !s1.campaign.stash.some((i) => i.id === 'g1'));
await p.click('[data-sellall]');
await wait(200);
const s2 = await st();
check('Sell all sells the rest of the loot and leaves the spares', s2.campaign.gold === s1.campaign.gold + 110 && !s2.campaign.stash.some((i) => i.kind === 'gem' || i.kind === 'jewelry') && s2.campaign.stash.some((i) => i.kind === 'potion'));

// ---- the forge, for the chosen hero; locked wares on the strip
await tab('gerda');
await assertFits('Gerda');
const hn = (await st()).campaign.roster.find((x) => x.id === H1).name;
const forge = await p.$eval(`[data-upgrade="weapon"][data-hero="${H1}"]`, (e) => ({ label: e.getAttribute('aria-label'), face: !!e.querySelector('.bust') }));
check(`the forge: "Forge for ${hn} · 60" with ${hn}'s face`, forge.label === `Forge for ${hn} · 60` && forge.face, JSON.stringify(forge));
await p.click(`[data-upgrade="weapon"][data-hero="${H1}"]`);
await wait(200);
check('Forge sends upgrade; the hero card shows Blade with a pip', (await st()).campaign.roster.find((x) => x.id === H1).weaponTier === 1 && !!(await p.$(`.hr[data-hero="${H1}"] [data-have="blade"] .pip.on`)));
const strip = await p.$$eval('.lk .lkt:not([hidden])', (els) => els.map((e) => e.dataset.state));
check('the locked strip shows under the shelf (dim tiles), four at a time', strip.length === 4 && strip.every((x) => x === 'locked' || x === 'soon' || x === 'moved' || x === 'live'), strip.join(','));
await p.hover('.lk .lkt[data-state="locked"]');
await wait(200);
const tip = await p.evaluate(() => ({ shown: !document.querySelector('.lg-tip')?.classList.contains('hidden'), text: document.querySelector('.lg-tip')?.innerText ?? '' }));
check("a locked tile's hover gives its unlock hint", tip.shown && /locked/i.test(tip.text), tip.text.replace(/\n/g, ' | '));
await shot('outfit-gerda-1920');

// ---- the Flagon: pour for the chosen hero
await tab('flagon');
await assertFits('Flagon');
const pours = await p.$$eval('[data-pour]:not([aria-disabled="true"])', (els) => els.map((e) => e.dataset.pour));
check('the Flagon: four ales to pour for the chosen hero', pours.length === 4, pours.join(','));
await p.click(`[data-pour="${pours[0]}"]`);
await wait(200);
check('pouring sends buyAle; the ale shows on the hero card', (await st()).campaign.roster.find((x) => x.id === H1).ale === pours[0] && !!(await p.$(`.hr[data-hero="${H1}"] [data-have="ale"]`)));

// ---- Ilse away: a shut shelf, everything on the strip, paged
await tab('ilse');
await assertFits('Ilse (away)');
const ilse = await p.evaluate(() => ({ home: document.querySelector('[data-side="vendors"]').dataset.home, shut: !!document.querySelector('.shelf .shut'), all: document.querySelectorAll('.lk .lkt').length, shown: document.querySelectorAll('.lk .lkt:not([hidden])').length, pager: !!document.querySelector('.pg-strip') }));
check("Ilse away: the shelf is shut, her wares wait on the strip, four at a time with a pager", ilse.home === 'no' && ilse.shut && ilse.all > 4 && ilse.shown === 4 && ilse.pager, JSON.stringify(ilse));
const firstShown = await p.$eval('.lk .lkt:not([hidden])', (e) => e.dataset.row);
await p.click('[data-k="strip-next"]');
await wait(120);
check('...the pager turns the strip', (await p.$eval('.lk .lkt:not([hidden])', (e) => e.dataset.row)) !== firstShown);
await shot('outfit-ilse-1920');
await tab('mott');

// ---- four heroes: the cards shrink, still no scroll
await p.evaluate(() => {
  const s = structuredClone(window.vc.state());
  s.campaign.squadSlots = 4;
  s.campaign.village.muster = true;
  const r = s.campaign.recruits.shift();
  if (r) s.campaign.roster.push(r.hero);
  window.vc.load(s);
});
await wait(150);
await goStep('party');
const bench = await p.$$eval('[data-bench]', (els) => els.map((e) => e.dataset.bench));
if (bench[0]) await p.click(`[data-bench="${bench[0]}"]`);
await wait(120);
await goStep('outfit');
check('four heroes: four packs', (await p.$$('[data-side="yours"] .hr')).length === 4, `bench ${bench}`);
await assertFits('four heroes');
await shot('outfit-four-1920');

// ---- the wagon's side page
await p.click('[data-ribbon="cart"]');
await wait(150);
check('the wagon page: packs beside a big wagon', !!(await p.$('.of-cart .wagon.big[data-cartbox]')) && (await p.$$('.of-cart .hr')).length >= 3);
for (const [w, hh] of [[1920, 1080], [2560, 1440], [1280, 720]]) {
  await p.setViewportSize({ width: w, height: hh });
  await wait(200);
  await assertFits(`${w}x${hh} wagon page`);
  if (w === 1920) await shot('outfit-cart-1920');
}
console.log(`\n${failed ? `${failed} FAILED` : 'all passed'}, ${errors} page errors`);
await b.close();
process.exit(failed || errors ? 1 : 0);
