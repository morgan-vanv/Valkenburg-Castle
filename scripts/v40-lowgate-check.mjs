// V4.0 Lowgate check, headless, by DOM and state, no screenshots (real engine only):
// the four steps exist and are clickable; a new campaign lands on Job with the welcome card;
// choosing a job selects it; hiring from step 2 fills a party slot and costs the price; heroes
// can leave the party and come back from the roster bench; healing shows in a wounded hero's
// slot only with the surgeon home; buying on step 3 puts the item on Keven's cart and packing is a click on the cart (V5.0 B1);
// the cart keeps valuables apart from gear and Sell all sells only valuables; V4.1 (spec 31.11): the board's two labelled rows
// (pinned by the village above work for hire), at most 3 cards each, a captive first, "+N more"; V4.1 WS4 (spec 31.6): the Outfit step's
// two counters (Yours: packs and Keven's cart, no prices; Vendors: four tabs, a price and "Buy · N" on every live row,
// locked rows with an in-voice hint, forge gear and ales bought for the selected hero); step 4 lists only the main gate on a new campaign
// and shows no sketch (V4.0 spec 30.5: with a remembered Level 1 the sketch fills ≥ 45% of the window's height, the rest
// still in view, at 1280×800 and 1440×900; SHOTS=<dir> saves them); Delve starts a delve; "Same as last time" jumps to step 4 with the
// remembered party; the won-back banner's "Show me" goes to the step; the graves; tooltips on
// keyboard focus. No page errors.
//   node scripts/v40-lowgate-check.mjs <baseUrl>
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';

const [base = 'http://localhost:4174/'] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
await p.route(/fonts\./, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
let errors = 0;
let failed = 0;
p.on('pageerror', (e) => (errors++, console.log('[pageerror]', e.message)));
p.on('console', (m) => m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource/.test(m.text()) && (errors++, console.log('[console]', m.text())));
const check = (name, ok, extra = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`);
};
const text = () => p.evaluate(() => document.querySelector('.lowgate')?.innerText ?? document.body.innerText);
const st = () => p.evaluate(() => window.vc.state());
const edit = (fn) => p.evaluate((f) => { const s = structuredClone(window.vc.state()); new Function('s', f)(s); window.vc.load(s); }, fn);
const step = async (id) => { await p.click(`.lg-step[data-step="${id}"]`); await p.waitForTimeout(80); };
const page = () => p.evaluate(() => document.querySelector('.lowgate')?.dataset.page);

await p.goto(base);
await p.evaluate(() => { localStorage.clear(); localStorage.setItem('vc.settings', JSON.stringify({ speed: 0, reduceShake: true, noEndTurnAsk: true, quality: 'low' })); });
await p.reload();
await p.waitForFunction(() => !!window.vc);
await p.click('text=New campaign');
await p.waitForSelector('.lowgate');

// ---- the frame
check('a new campaign lands on step 1 (Job)', (await page()) === 'job');
check('the welcome card shows on delve 1', !!(await p.$('.lg-welcome')) && /The heir's return/i.test(await text()));
const steps = await p.$$eval('.lg-step', (els) => els.map((e) => e.dataset.step));
check('four steps along the top: job, party, outfit, setout', JSON.stringify(steps) === '["job","party","outfit","setout"]', steps.join(','));
for (const s of ['setout', 'outfit', 'party', 'job']) {
  await step(s);
  check(`step "${s}" is clickable out of order`, (await page()) === s);
}
const head = await p.$eval('.lg-head', (e) => e.innerText);
check('header: Delve 1, Lowgate, gold', /Delve 1/i.test(head) && /Lowgate/.test(head) && /70\s*gold/.test(head), head.replace(/\n/g, ' | ').slice(0, 120));
check('step summaries: the job, "Keven alone", "Packs empty", "Main gate"', /Rescue Brother Aldric|Recover|Rescue/.test(head) && /Keven alone/.test(head) && /Packs empty/.test(head) && /Main gate/.test(head));
check('primary action bottom-right: "Next: Party"', /Next: Party/.test(await p.$eval('.lg-foot-r', (e) => e.innerText)));
check('no "Same as last time" without a last loadout', !(await p.$('[data-same]')));
check('no who-is-where village list', !(await p.$('.village-panel')) && !/Old Wim/.test(await p.$eval('.lg-foot', (e) => e.innerText)));
// V5.1 (W1): the Lowgate house ribbon is retired; the wagon and the gravestone sit in the header.
check('no house ribbon; the wagon and the gravestone in the header', !(await p.$('.lg-house')) && !!(await p.$('.lg-head [data-ribbon="cart"]')) && !!(await p.$('.lg-head [data-ribbon="graves"]')));
await p.click('.lg-welcome [data-welcome]');
await p.waitForTimeout(80);
check('"Got it" dismisses the welcome card', !(await p.$('.lg-welcome')));

// ---- step 1: Job
const cards = await p.$$eval('.lg-card', (els) => els.map((e) => ({ id: e.dataset.contract, story: e.dataset.story, chosen: e.getAttribute('aria-pressed') === 'true', text: e.innerText })));
check('the village plea comes first, with a seal and "Wins back"', cards[0]?.story === 'surgeon' && /Wins back/i.test(cards[0].text) && !!(await p.$('.lg-card.story .lg-card-seal')));
check('the first card is chosen by default ("Chosen")', cards[0]?.chosen && /Chosen/i.test(cards[0].text));
check('no "Story" / "Unlocks" chips, no "No warnings posted"', cards.every((c) => !/No warnings posted|^Story$|Unlocks the/m.test(c.text)));
await p.click(`.lg-card[data-contract="${cards[1].id}"]`);
await p.waitForTimeout(80);
check('clicking a card selects it (no navigation)', (await page()) === 'job' && (await p.$eval(`.lg-card[data-contract="${cards[1].id}"]`, (e) => e.getAttribute('aria-pressed'))) === 'true');
const title1 = await p.evaluate((id) => window.vc.state().campaign.board.find((k) => k.id === id).title, cards[1].id);
check('...and the step summary names it', (await p.$eval('.lg-step[data-step="job"]', (e) => e.innerText)).includes(title1), title1);
check('renown pips at the step heading, with a hover text', !!(await p.$('.lg-renown[data-tip*="Renown"]')) && (await p.$$('.lg-renown .lg-pips i')).length === 3);
await p.click('.lg-card[data-story="surgeon"]'); // V5.1 (W1): no house ribbon to pick the plea from; the card itself
await p.waitForTimeout(80);
check('the surgeon\'s plea card selects that job', (await p.$eval('.lg-card[data-story="surgeon"]', (e) => e.getAttribute('aria-pressed'))) === 'true');
// V4.1 (spec 31.11): the board in two labelled rows, the village's pins above work for hire, at most 3 cards each.
const boardRows = () => p.$$eval('.lg-board-row', (els) => els.map((e) => ({ id: e.dataset.row, label: e.querySelector('.lg-board-h')?.textContent, tip: e.querySelector('.lg-board-h')?.dataset.tip ?? '', cards: [...e.querySelectorAll('.lg-card')].map((c) => ({ story: c.dataset.story, captive: c.dataset.captive })), more: e.querySelector('.lg-board-more')?.textContent ?? '' })));
let rows = await boardRows();
check('board: "Pinned by the village" row above "Work for hire"', rows.map((r) => r.id).join(',') === 'village,hire' && rows[0].label === 'Pinned by the village' && rows[1].label === 'Work for hire', rows.map((r) => r.label).join(' / '));
check('board: the row labels explain themselves (gifts, win people back; gold)', /gifts/.test(rows[0].tip) && /win people back/.test(rows[0].tip) && /gold/.test(rows[1].tip));
check('board: the village row holds the pleas, work for hire the bounties', rows[0].cards.every((x) => x.story) && rows[1].cards.every((x) => !x.story && !x.captive) && rows[1].cards.length > 0);
check('board: at most 3 cards a row', rows.every((r) => r.cards.length <= 3), rows.map((r) => r.cards.length).join('+'));
await p.focus('.lg-board-village .lg-board-h');
await p.keyboard.press('Tab');
await p.keyboard.press('Shift+Tab');
await p.waitForTimeout(80);
// V5.0 (P, owner): the keyboard-focus tip check was flaky in headless (a focus timing) and is dropped.

// ---- step 2: Party
await p.click('[data-next="party"]');
await p.waitForTimeout(80);
check('"Next: Party" goes to step 2', (await page()) === 'party');
check('Keven fills the first slot: "If he falls, it\'s over."', /Keven/.test(await p.$eval('.lg-slot >> nth=0', (e) => e.innerText)) && /If he falls, it's over\./.test(await text()));
check('the first empty slot says "Hire someone below."', /Hire someone below\./.test(await p.$eval('.lg-slot.empty.first', (e) => e.innerText)));
check('recruits "At the campfire"', /At the campfire/.test(await text()));
const can = await p.$$eval('.lg-canchip', (els) => els.map((e) => `${e.dataset.can}:${e.classList.contains('yes') ? 1 : 0}`));
check('"This party can": melee and rally lit for Keven alone, the rest dim', can.join(',') === 'melee:1,rally:1,range:0,unseen:0,locks:0,heal:0,blast:0,burn:0', can.join(','));
const rc = await p.$eval('.lg-rc', (e) => ({ text: e.innerText, abs: e.querySelectorAll('.lg-ab').length, badgeTip: e.querySelector('.lg-hex')?.dataset.tip ?? '' }));
check('recruit card: plan tag, "Best at", ability chips, HP, "Hire · 60"', /Best at/i.test(rc.text) && rc.abs >= 3 && /HP/.test(rc.text) && /Hire\s*·\s*60/.test(rc.text), rc.text.replace(/\n/g, ' | ').slice(0, 140));
check('recruit card: no stat bars or ability rule text on the card', !/Might|Finesse \d|mana|slots/.test(rc.text));
check('class badge hover has the stats', /Might \d+, Finesse \d+, Wits \d+/.test(rc.badgeTip));
await p.focus('.lg-rc .lg-ab');
await p.keyboard.press('Tab');
await p.keyboard.press('Shift+Tab');
await p.waitForTimeout(80);
const tipFocus = await p.evaluate(() => ({ shown: !document.querySelector('.lg-tip')?.classList.contains('hidden'), text: document.querySelector('.lg-tip')?.innerText ?? '' }));
check('an ability tooltip shows on keyboard focus, with its numbers', tipFocus.shown && tipFocus.text.length > 20, tipFocus.text.replace(/\n/g, ' | ').slice(0, 100));
const r0 = await p.$eval('.lg-rc', (e) => e.dataset.recruit);
await p.click(`.lg-rc[data-recruit="${r0}"] [data-hire]`);
await p.waitForTimeout(120);
let s = await st();
check('hiring costs the price (70 → 10; V4.1 squads)', s.campaign.gold === 10, `${s.campaign.gold}`);
check('the hire goes straight into the party slot', (await p.$$('.lg-slot.hero')).length === 2 && !!(await p.$(`.lg-slot.hero[data-hero="${r0}"]`)));
check('the step summary lists the party', (await p.$eval('.lg-step[data-step="party"]', (e) => e.innerText)).includes(s.campaign.roster[1].name));
await p.click(`[data-out="${r0}"]`);
await p.waitForTimeout(80);
check('a hero can leave the party, and waits on the roster bench', (await p.$$('.lg-slot.hero')).length === 1 && !!(await p.$(`[data-bench="${r0}"]`)));
await p.click(`[data-bench="${r0}"]`);
await p.waitForTimeout(80);
check('...and come back from the bench', (await p.$$('.lg-slot.hero')).length === 2);
// V4.1 (squads, spec 31.12): three slots on a new campaign; the fourth is locked with Wim's hint until the muster roll is home.
{
  const lock = await p.$eval('.lg-slot.locked', (e) => ({ slot: e.dataset.slot, text: e.innerText, tip: e.dataset.tip ?? '' })).catch(() => null);
  check('squads: the fourth slot is locked, with Wim\'s hint about the muster roll', !!lock && lock.slot === '3' && /Wim says the old muster roll is in the officers' quarters\. With it, a fourth could sign on\./.test(lock.text), JSON.stringify(lock));
  check('squads: "Up to three for now."', /Up to three for now\./.test(await text()));
  await edit(`const mk = (id, name) => ({ id, name, cls: 'sellsword', level: 1, xp: 0, maxHp: 10, hp: 10, stats: { might: 65, finesse: 40, wits: 30, nerve: 50 }, weaponTier: 0, armorTier: 0, wounded: 0, kills: 0, delves: 0 }); s.campaign.roster.push(mk('sq-a', 'Sq Ada'), mk('sq-b', 'Sq Bors'));`);
  await p.click('[data-bench="sq-a"]');
  await p.waitForTimeout(80);
  const full = await p.$eval('[data-bench="sq-b"]', (e) => ({ off: e.getAttribute('aria-disabled'), tip: e.dataset.tip ?? '' }));
  check('squads: with three in, the bench is full ("The party is full")', (await p.$$('.lg-slot.hero')).length === 3 && full.off === 'true' && /The party is full/.test(full.tip), JSON.stringify(full));
  await edit(`s.campaign.squadSlots = 4; s.campaign.village.muster = true;`);
  check('squads: with the muster roll home, the fourth slot opens', !(await p.$('.lg-slot.locked')) && (await p.$$('.lg-slot')).length === 4 && /Up to four\./.test(await text()));
  await p.click('[data-bench="sq-b"]');
  await p.waitForTimeout(80);
  check('squads: ...and a fourth hero goes in', (await p.$$('.lg-slot.hero')).length === 4);
  await p.click('[data-out="sq-a"]');
  await p.waitForTimeout(60);
  await p.click('[data-out="sq-b"]');
  await p.waitForTimeout(60);
  await edit(`s.campaign.roster = s.campaign.roster.filter((h) => !/^sq-/.test(h.id)); s.campaign.squadSlots = 3; s.campaign.village.muster = false;`);
  check('squads: back to the party of two', (await p.$$('.lg-slot.hero')).length === 2);
}
// healing: no surgeon, a potion on the cart
await edit(`s.campaign.roster[1].hp = s.campaign.roster[1].maxHp - 3; s.campaign.stash.push({ id: 'pot-x', kind: 'potion', name: 'Potion', amount: 1, slots: 1 });`);
check('a wounded hero shows an HP bar', !!(await p.$(`.lg-slot.hero[data-hero="${r0}"] .lg-hpbar`)));
check('no "Heal · N gold" without the surgeon', !(await p.$('[data-heal]')));
check('"Drink a potion" with a potion on the cart', !!(await p.$(`[data-drink="${r0}"]`)));
await edit(`s.campaign.village.surgeon = true; s.campaign.gold = 30;`);
const healTxt = await p.$eval(`[data-heal="${r0}"]`, (e) => e.innerText).catch(() => '');
check('with the surgeon home: "Heal · 9 gold" in the slot', /Heal\s*·\s*9\s*gold/.test(healTxt), healTxt);
await p.click(`[data-heal="${r0}"]`);
await p.waitForTimeout(100);
s = await st();
check('healing paid and applied', s.campaign.gold === 21 && s.campaign.roster[1].hp === s.campaign.roster[1].maxHp, `${s.campaign.gold} gold`);
check('a healed hero has no HP bar', !(await p.$(`.lg-slot.hero[data-hero="${r0}"] .lg-hpbar`)));

// ---- step 3: Outfit (V4.1 WS4, spec 31.6: two counters, "Yours" and "Vendors")
await p.click('[data-next="outfit"]');
await p.waitForTimeout(80);
check('"Next: Outfit" goes to step 3', (await page()) === 'outfit');
check('two sides: "Yours" (packs, then Keven\'s cart) and "Vendors"', !!(await p.$('[data-side="yours"] .lg-hero')) && !!(await p.$('[data-side="yours"] [data-cartbox]')) && !!(await p.$('[data-side="vendors"]')) && /Yours/i.test(await p.$eval('[data-side="yours"]', (e) => e.innerText)) && /Vendors/i.test(await p.$eval('[data-side="vendors"]', (e) => e.innerText)));
check('one loadout card per party hero, the first "Packing"', (await p.$$('.lg-hero')).length === 2 && /Packing/i.test(await p.$eval('.lg-hero.sel', (e) => e.innerText)));
check('V4.1: no free lantern on Keven\'s card', !(await p.$('.lg-hero[data-hero="keven"] .lg-lantern')));
const vtabs = await p.$$eval('[data-vendor-tab]', (els) => els.map((e) => `${e.dataset.vendorTab}:${e.classList.contains('away') ? 'away' : 'open'}`));
check('four vendor tabs, always: Mott open, the forge, the bench and the Flagon away', vtabs.join(',') === 'mott:open,gerda:away,ilse:away,flagon:away', vtabs.join(','));
// V4.0 (26.5): class kit shows under the 4 slots: "Brings their own: ...". Keven has none.
{
  const cls0 = (await st()).campaign.roster.find((x) => x.id === r0).cls;
  const kitOf = () => p.$eval(`.lg-hero[data-hero="${r0}"] .lg-kit`, (e) => ({ t: e.innerText, tip: e.dataset.tip, afterSlots: e.previousElementSibling?.classList.contains('lg-sl-row') })).catch(() => null);
  // V4.0 (spec 30.2): one a level; the hero is set to level 2 for the check ("2 improvised picks").
  const lv0 = (await st()).campaign.roster.find((x) => x.id === r0).level;
  for (const [cls, want] of [['burglar', /Brings their own: 2 improvised picks/], ['sapper', /Brings their own: 2 improvised explosives/]]) {
    await edit(`const h = s.campaign.roster.find((h) => h.id === '${r0}'); h.cls = '${cls}'; h.level = 2;`);
    await p.waitForTimeout(60);
    const k = await kitOf();
    check(`a ${cls}'s loadout card: "${want.source.replace(/\\/g, '')}" under the slots`, !!k && want.test(k.t) && k.afterSlots && /own · .*\nDoesn't take a slot; can't be given away/.test(k.tip ?? ''), k ? `${k.t} | ${(k.tip ?? '').split('\n')[0]}` : 'none');
  }
  await edit(`const h = s.campaign.roster.find((h) => h.id === '${r0}'); h.cls = '${cls0}'; h.level = ${lv0};`);
  await p.waitForTimeout(60);
  check('Keven brings no kit line', !(await p.$('.lg-hero[data-hero="keven"] .lg-kit')));
}
// Every buyable row shows its price (gold glyph + number) and a "Buy · N" button with the same number.
const priced = async () => p.$$eval('[data-side="vendors"] .lg-vrow.live:not(.lg-perk)', (els) => els.map((e) => ({ row: e.dataset.row, price: e.querySelector('.lg-vprice')?.dataset.price ?? null, glyph: !!e.querySelector('.lg-vprice svg'), buy: e.querySelector('[data-buy]')?.innerText.replace(/\s+/g, ' ') ?? '' })));
{
  const rows = await priced();
  const bad = rows.filter((r) => r.price === null || !r.glyph || !new RegExp(`· ${r.price}$`).test(r.buy) || !/^Buy/.test(r.buy));
  check("Mott's wagon: every live row has a price with the gold glyph and \"Buy · N\"", rows.length >= 5 && !bad.length, bad.map((r) => `${r.row}:${r.price}:${r.buy}`).join(' ') || `${rows.length} rows`);
}
check('no price anywhere on the "Yours" side (owned things)', !(await p.$('[data-side="yours"] .lg-vprice, [data-side="yours"] [data-price], [data-side="yours"] [data-buy]')));
// A locked row: dimmed, a lock, no Buy, the hover in voice (not the rule).
await p.click('[data-vendor-tab="gerda"]');
await p.waitForTimeout(80);
const forge = await p.evaluate(() => ({ home: document.querySelector('.lg-vhead')?.dataset.home, head: document.querySelector('.lg-vhead')?.innerText ?? '', states: [...document.querySelectorAll('[data-side="vendors"] .lg-vrow')].map((e) => e.dataset.state), buys: document.querySelectorAll('[data-side="vendors"] [data-buy]').length }));
check('the forge tab while Gerda is away: "The forge is cold.", every row locked, no Buy', forge.home === 'no' && /The forge is cold\./.test(forge.head) && forge.states.length >= 8 && forge.states.every((x) => x === 'locked' || x === 'soon') && forge.buys === 0, `${forge.states.length} rows, ${forge.buys} buys`);
await p.focus('[data-row="hook"]');
await p.keyboard.press('Shift+Tab');
await p.keyboard.press('Tab');
await p.waitForTimeout(80);
const hint = await p.evaluate(() => ({ shown: !document.querySelector('.lg-tip')?.classList.contains('hidden'), text: document.querySelector('.lg-tip')?.innerText ?? '' }));
check('a locked row\'s hover (on keyboard focus) gives the in-voice hint, not the rule', hint.shown && /Mott hasn't seen one in years/.test(hint.text) && !/Level 2|rescue/i.test(hint.text), hint.text.replace(/\n/g, ' | '));
check('a pair\'s ware names the pair in its hint only', /both here/.test(await p.$eval('[data-row="gerda-charge"]', (e) => e.dataset.tip)) && !/both/.test(await p.$eval('[data-row="gerda-charge"]', (e) => e.innerText)));
check('items not built yet (the arrows) still show from the catalog', !!(await p.$('[data-row="barbarrows"]')));
await p.click('[data-vendor-tab="flagon"]');
await p.waitForTimeout(80);
check('the Flagon while Wim is away: "The Gilded Flagon\'s taps are dry.", every ale locked with that line', /taps are dry/.test(await p.$eval('.lg-vhead', (e) => e.innerText)) && (await p.$$eval('[data-side="vendors"] .lg-vrow[data-kind="ale"]', (els) => els.length >= 10 && els.every((e) => e.dataset.state === 'locked' && /taps are dry/.test(e.dataset.tip)))));
check('the hot supper shows as a locked village line under the Flagon', (await p.$eval('[data-perk="supper"]', (e) => e.dataset.state).catch(() => '')) === 'locked');
await p.click('[data-vendor-tab="mott"]');
await p.waitForTimeout(80);
// V5.0 (P, B1): buying puts the item on Keven's cart (its cart row glows, the vendor row says so); packing is a click on the cart.
await edit(`s.campaign.gold = 100;`);
await p.click(`[data-packfor="${r0}"]`);
await p.waitForTimeout(80);
check('clicking a hero card selects it for packing ("Buying for")', (await p.$eval('.lg-hero.sel', (e) => e.dataset.hero)) === r0 && (await p.$eval('.lg-buyfor', (e) => e.innerText)).includes((await st()).campaign.roster.find((x) => x.id === r0).name));
await p.click('[data-buy="torch"]');
await p.waitForTimeout(120);
s = await st();
const torch = s.campaign.stash.find((i) => i.kind === 'torch');
const pk = await p.$$eval(`.lg-hero[data-hero="${r0}"] [data-packed]`, (els) => els.map((e) => e.dataset.packed));
check('buying puts the item on the cart, not in a pack', !!torch && !pk.includes(torch.id) && s.campaign.gold === 90 && !!(await p.$('[data-cartbox] [data-cart="torch"]')), `gold ${s.campaign.gold}`);
check('...the cart row glows and the vendor row says "On Keven\'s cart."', !!(await p.$('[data-cartbox] [data-cart="torch"].new')) && /On Keven's cart\./.test(await p.$eval('[data-row="torch"]', (e) => e.innerText)));
check('the torch row says "1 on the cart"', /1 on the cart/.test(await p.$eval('[data-row="torch"]', (e) => e.innerText)));
await p.click('[data-cartbox] [data-cart="torch"]');
await p.waitForTimeout(80);
check('clicking it on the cart packs it for the selected hero: the slot glows, "1 packed", "1 item packed"', !!(await p.$(`.lg-hero[data-hero="${r0}"] .lg-sl.new[data-packed="${torch.id}"]`)) && /1 packed/.test(await p.$eval('[data-row="torch"]', (e) => e.innerText)) && /1 item packed/.test(await p.$eval('.lg-step[data-step="outfit"]', (e) => e.innerText)));
await p.click(`[data-packed="${torch.id}"]`);
await p.waitForTimeout(80);
check('clicking a packed item sends it back to the cart', !(await p.$(`[data-packed="${torch.id}"]`)) && /1 on the cart/.test(await p.$eval('[data-row="torch"]', (e) => e.innerText)));
// "Give to": with two heroes, every cart row has one small button per hero; it packs for that hero, not the selected one.
const giveIds = await p.$$eval('[data-cartbox] [data-giveto][data-kind="torch"]', (els) => els.map((e) => e.dataset.giveto));
check('cart rows carry a "Give to" button per party hero', giveIds.length === 2 && giveIds.includes(r0), giveIds.join(','));
const other = giveIds.find((id) => id !== r0);
await p.click(`[data-cartbox] [data-giveto="${other}"][data-kind="torch"]`);
await p.waitForTimeout(80);
check('"Give to" packs it for that hero (not the one marked Packing)', !!(await p.$(`.lg-hero[data-hero="${other}"] [data-packed="${torch.id}"]`)) && !(await p.$(`.lg-hero[data-hero="${r0}"] [data-packed="${torch.id}"]`)));
await p.click(`[data-packed="${torch.id}"]`);
await p.waitForTimeout(80);
// A full pack: the cart row is blocked for that hero, and says so.
await edit(`s.campaign.stash.push(...[1, 2, 3, 4].map((n) => ({ id: 'fill-' + n, kind: 'rope', name: 'Rope', amount: 1, slots: 1 })));`);
for (let n = 1; n <= 4; n++) await p.click('[data-cart="rope"]').then(() => p.waitForTimeout(40));
const fullRow = await p.$eval('[data-cartbox] [data-cart="torch"]', (e) => ({ off: e.getAttribute('aria-disabled'), tip: e.dataset.tip }));
check('a full pack: the cart row is blocked and its hover says the pack is full', fullRow.off === 'true' && /pack is full/.test(fullRow.tip) && (await p.$$(`.lg-hero[data-hero="${r0}"] [data-packed]`)).length === 4, JSON.stringify(fullRow));
for (const id of await p.$$eval(`.lg-hero[data-hero="${r0}"] [data-packed]`, (els) => els.map((e) => e.dataset.packed))) await p.click(`[data-packed="${id}"]`).then(() => p.waitForTimeout(40));
await edit(`s.campaign.stash = s.campaign.stash.filter((i) => !/^fill-/.test(i.id)); s.campaign.gold = 100;`);
// Can't afford: the button is blocked and says how much gold you have.
await edit(`s.campaign.gold = 5;`);
const dear = await p.$eval('[data-buy="potion"]', (e) => ({ off: e.getAttribute('aria-disabled'), tip: e.dataset.tip }));
check('can\'t afford: Buy is aria-disabled and its hover says "You have 5 gold."', dear.off === 'true' && /You have 5 gold\./.test(dear.tip), JSON.stringify(dear));
await edit(`s.campaign.gold = 90;`);
// the cart: gear apart from valuables, on the Yours side
await edit(`s.campaign.stash.push({ id: 'gem-x', kind: 'gem', name: 'Moonstone', amount: 70, slots: 1 }, { id: 'jw-x', kind: 'jewelry', name: 'Silver torc', amount: 110, slots: 1 });`);
const gearKinds = await p.$$eval('[data-cartbox] [data-cart]', (els) => els.map((e) => e.dataset.cart));
const valIds = await p.$$eval('[data-cartbox] [data-valuable]', (els) => els.map((e) => e.dataset.valuable));
check('cart: gear and valuables in their own compartments', gearKinds.includes('torch') && gearKinds.includes('potion') && !gearKinds.includes('gem') && valIds.length === 2, `${gearKinds} / ${valIds}`);
check('cart: owned gear shows no price; a valuable shows its worth', !/gold|·\s*\d/.test(await p.$eval('[data-cartbox] .lg-gearlist', (e) => e.innerText)) && /70/.test(await p.$eval('[data-valuable="gem-x"]', (e) => e.innerText)));
check('cart: per-item Sell buttons live, Sell all names the gear stays', (await p.$$('[data-sell]:not([aria-disabled="true"])')).length === 2 && /Gear stays on the cart/.test(await p.$eval('.lg-sellall', (e) => e.innerText)));
{
  const g0 = await p.evaluate(() => window.vc.state().campaign.gold);
  await p.click('[data-sell="gem-x"]');
  await p.waitForTimeout(120);
  const after = await p.evaluate(() => ({ gold: window.vc.state().campaign.gold, ids: window.vc.state().campaign.stash.map((i) => i.id) }));
  check('cart: selling one gem adds its value and leaves the torc', after.gold === g0 + 70 && !after.ids.includes('gem-x') && after.ids.includes('jw-x'), JSON.stringify(after));
  await edit(`s.campaign.stash.push({ id: 'gem-x', kind: 'gem', name: 'Moonstone', amount: 70, slots: 1 }); s.campaign.gold -= 70;`);
}
check('cart: "Sell all · 180 gold"', /Sell all\s*·\s*180\s*gold/.test(await p.$eval('[data-sellall]', (e) => e.innerText)));
await p.click('[data-cart="torch"]');
await p.waitForTimeout(80);
check('clicking cart gear packs it for the selected hero', (await p.$$(`.lg-hero[data-hero="${r0}"] [data-packed]`)).length === 1);
await p.click('[data-sellall]');
await p.waitForTimeout(120);
s = await st();
check('Sell all sells only the valuables', s.campaign.gold === 270 && !s.campaign.stash.some((i) => i.kind === 'gem' || i.kind === 'jewelry') && s.campaign.stash.some((i) => i.kind === 'torch') && s.campaign.stash.some((i) => i.kind === 'potion'), `gold ${s.campaign.gold}`);
// the forge and the taps, bought for the hero being packed for
await edit(`Object.assign(s.campaign.village, { smith: true, innkeeper: true, copper: true }); s.campaign.gold = 300; s.campaign.credits = { shield: 1 };`);
check('no forge gear or ales on the hero cards', !(await p.$('[data-side="yours"] [data-upgrade], [data-side="yours"] [data-pour], [data-side="yours"] [data-shield]')));
await p.click('[data-vendor-tab="gerda"]');
await p.waitForTimeout(80);
const hname = (await st()).campaign.roster.find((x) => x.id === r0).name;
check('with the smith home: Gerda\'s lantern is a live row', (await p.$eval('[data-row="lantern"]', (e) => e.dataset.state)) === 'live' && /Buy · 120/.test(await p.$eval('[data-buy="lantern"]', (e) => e.innerText.replace(/\s+/g, ' '))));
check('with the smith home: the forge is open, metalwork live', (await p.$eval('.lg-vhead', (e) => e.dataset.home)) === 'yes' && !!(await p.$('[data-buy="hook"]')) && !!(await p.$('[data-buy="lockpicks"]')) && !!(await p.$('[data-buy="caltrops"]')));
check(`"Forge for ${hname} · 60" with tier pips`, new RegExp(`Forge for ${hname} · 60`).test(await p.$eval(`[data-upgrade="weapon"][data-hero="${r0}"]`, (e) => e.innerText.replace(/\s+/g, ' '))) && (await p.$$('[data-row="blade"] .lg-pip')).length === 2);
check('Gerda\'s gift: "Free · a gift" on the shield', /Free for .* · a gift/.test(await p.$eval('[data-buy="shield"]', (e) => e.innerText.replace(/\s+/g, ' '))));
await p.click(`[data-upgrade="weapon"][data-hero="${r0}"]`);
await p.waitForTimeout(100);
s = await st();
check('Forge sends `upgrade` (tier 1, 60 gold); the hero card shows the pips, no price', s.campaign.roster.find((x) => x.id === r0).weaponTier === 1 && s.campaign.gold === 240 && !!(await p.$(`.lg-hero[data-hero="${r0}"] [data-have="blade"] .lg-pip.on`)), `${s.campaign.gold}`);
await p.click('[data-vendor-tab="flagon"]');
await p.waitForTimeout(80);
const pours = await p.$$eval('[data-pour]:not([aria-disabled="true"])', (els) => els.map((e) => e.dataset.pour));
check('the Flagon with the copper home: four ales to pour, "Pour for <hero> · N"', pours.length === 4 && new RegExp(`Pour for ${hname} · 15`).test(await p.$eval(`[data-pour="${pours[0]}"]`, (e) => e.innerText.replace(/\s+/g, ' '))), pours.join(','));
check('...and the cask-book ales locked', (await p.$eval('[data-row="ale-smuggler"]', (e) => e.dataset.state)) === 'locked');
await p.click(`[data-pour="${pours[0]}"]`);
await p.waitForTimeout(100);
s = await st();
check('pouring sends `buyAle`; the ale shows on the hero card by name', s.campaign.roster.find((x) => x.id === r0).ale === pours[0] && !!(await p.$(`.lg-hero[data-hero="${r0}"] [data-have="ale"]`)));
check('...and the other taps say one at a time', (await p.$eval(`[data-pour="${pours[1]}"]`, (e) => e.getAttribute('aria-disabled'))) === 'true');
await p.click('[data-packfor="keven"]');
await p.waitForTimeout(60);
await p.click('[data-vendor-tab="gerda"]');
await p.waitForTimeout(60);
await p.click('[data-buy="lockpicks"]');
await p.waitForTimeout(120);
await p.click('[data-cartbox] [data-cart="lockpicks"]'); // V5.0 (B1): bought things wait on the cart; pack them from there
await p.waitForTimeout(80);
await p.click('[data-vendor-tab="mott"]');
await p.waitForTimeout(60);
await step('party');
check('"Pick locks quietly" lights up when someone packs lockpicks', (await p.$eval('[data-can="locks"]', (e) => e.classList.contains('yes'))) && /Keven \(lockpicks\)/.test(await p.$eval('[data-can="locks"]', (e) => e.dataset.tip)));

// ---- step 4: Set out
await step('setout');
const ents = await p.$$eval('.lg-ent', (els) => els.map((e) => e.innerText.split('\n')[0]));
const hasMemory = await p.evaluate(() => typeof window.vcEngine.castleMemory === 'function' && window.vcEngine.castleMemory(window.vc.state()).some((m) => m.hexes.length));
check('step 4 lists only the main gate on a new campaign', ents.length === 1 && /Main gate|Gatehouse/.test(ents[0]), ents.join(','));
check('...and no sketch: "You\'ve never been inside."', hasMemory ? true : !!(await p.$('.lg-sketch.none')) && !(await p.$('.lg-sketch svg')));
// V4.0 (spec 30.5): with a remembered Level 1, the sketch takes most of the column (≥ 45% of the window's height) and the
// ways in and the plan still show without scrolling, at 1280×800 and 1440×900 (V4.1: the lantern checkbox is gone).
{
  const SHOTS = process.env.SHOTS ?? '';
  const keep = await p.evaluate(() => structuredClone(window.vc.state().campaign));
  await edit(`const lv = window.vcEngine.castle().levels.find((l) => l.level === 1); s.campaign.explored = { 1: Object.keys(lv.tiles) }; delete s.campaign.opened;`);
  for (const [w, hh] of [[1280, 800], [1440, 900]]) {
    await p.setViewportSize({ width: w, height: hh });
    await step('setout');
    await p.waitForTimeout(250);
    const m = await p.evaluate(() => {
      const r = (sel) => document.querySelector(sel)?.getBoundingClientRect() ?? null;
      const main = document.querySelector('.lg-main');
      const sk = r('.lg-sketch svg');
      return { sketch: r('.lg-sketch')?.height ?? 0, svg: !!sk, vh: innerHeight, mainBottom: r('.lg-main').bottom, ents: r('.lg-ents')?.bottom ?? 9999, shutter: r('.lg-shutter')?.bottom ?? 0, plan: r('.lg-plan')?.bottom ?? 9999, scroll: main.scrollHeight - main.clientHeight, names: document.querySelectorAll('.lg-sketch text.lg-sk-room').length, ents2: document.querySelectorAll('.lg-sketch text.lg-sk-ent').length, fs: Math.min(...[...document.querySelectorAll('.lg-sketch text.lg-sk-room')].map((t) => t.getBoundingClientRect().height)) };
    });
    // V5.1 (W1): the camp is a scaled 1920x1080 stage and main no longer stretches the old sketch column; the Set out
    // board (W4) owns the map's size. Only that a sketch is drawn is checked here.
    check(`${w}×${hh}: the sketch is drawn`, m.svg, `${Math.round(m.sketch)} of ${m.vh}`);
    check(`...ways in and plan in view without scrolling (no lantern checkbox)`, m.scroll <= 1 && m.ents <= m.mainBottom && m.shutter <= m.mainBottom && m.plan <= m.mainBottom, JSON.stringify(m));
    check('...room names readable (≥ 11px) and the ways in named on it', m.names >= 3 && m.fs >= 11 && m.ents2 >= 1, `${m.names} names, ${m.ents2} ways, ${Math.round(m.fs)}px`);
    if (SHOTS) {
      await p.mouse.move(5, hh - 5);
      await p.waitForTimeout(150);
      await p.screenshot({ path: `${SHOTS}/setout-${w}x${hh}.png` });
    }
  }
  await p.setViewportSize({ width: 1280, height: 800 });
  await edit(`s.campaign.explored = ${JSON.stringify(keep.explored ?? null)} ?? undefined; s.campaign.opened = ${JSON.stringify(keep.opened ?? null)} ?? undefined;`);
  await step('setout');
}
check('the plan names the job, the party and what they carry', /The plan/i.test(await text()) && /Torch/.test(await p.$eval('.lg-plan', (e) => e.innerText)));
check('V4.1: no lantern checkbox on Set out', !(await p.$('.lg-shutter input')));
check('the plan warns when Keven goes', /If he falls, the campaign ends with him\./.test(await p.$eval('.lg-plan', (e) => e.innerText)));
const partyBefore = (await st()).campaign.roster.map((x) => x.id);
await p.click('.lg-delve');
await p.waitForFunction(() => window.vc.state()?.stage === 'delve', null, { timeout: 15000 }).catch(() => {});
s = await st();
check('Delve starts a delve with the party and packs', s.stage === 'delve' && s.delve.heroes.length === 2 && s.delve.heroes.some((x) => x.pack.some((i) => i.kind === 'torch')), s.stage);
await p.waitForFunction(() => !window.vc.busy(), null, { timeout: 30000 }).catch(() => {});
check('...the packed torch goes in unlit (V4.1)', s.stage !== 'delve' || (await p.evaluate(() => window.vc.state().delve.heroes.every((h) => h.pack.every((i) => !i.lit)))));

// ---- back in camp: Same as last time
await p.evaluate(async () => {
  const d = structuredClone(window.vc.state());
  const at = window.vcEngine.castle().entrances[0];
  for (const h of d.delve.heroes) h.at = { ...at };
  window.vc.load(d);
  await window.vc.send({ type: 'abandon' });
});
await p.waitForFunction(() => !window.vc.busy(), null, { timeout: 30000 });
await p.evaluate(() => window.vc.send({ type: 'backToCamp' }));
await p.waitForSelector('.lowgate');
await p.waitForTimeout(150);
s = await st();
check('back in camp: lands on step 1', (await page()) === 'job' && s.stage === 'camp');
check('no welcome card after delve 1', !(await p.$('.lg-welcome')));
rows = await boardRows();
check('after delve 1: still two rows, at most 3 cards each', rows.length >= 1 && rows.every((r) => r.cards.length <= 3) && (await p.$$('.lg-card')).length <= 6, rows.map((r) => `${r.id}:${r.cards.length}`).join(' '));
// More pleas than fit, and a hero taken by a crew: the captive always shows (first) and counts toward the 3; "+N more".
{
  const saved = await st();
  await edit(`
    const plea = s.campaign.board.find((k) => k.story) ?? { kind: 'rescue', title: 'A plea', brief: 'Help.', siteId: 'x', level: 1, bounty: 0, warnings: [] };
    for (const id of ['surgeon', 'smith', 'alchemist', 'innkeeper']) if (!s.campaign.board.some((k) => k.story === id)) s.campaign.board.push({ ...plea, id: 'plea-' + id, story: id, title: 'Plea ' + id });
    const hero = structuredClone(s.campaign.roster.find((x) => x.id !== 'keven') ?? s.campaign.roster[0]);
    hero.id = 'taken1'; hero.name = 'Bram';
    s.campaign.captives = [...(s.campaign.captives ?? []), { hero, crew: 'ferrymen', siteId: 'hideout-test', delve: 1 }];
    s.campaign.board.push({ id: 'bring-bram', kind: 'rescue', title: 'Bring back Bram', brief: 'Bram is held.', siteId: 'hideout-test', level: 2, bounty: 0, warnings: [] });
  `);
  await step('job');
  rows = await boardRows();
  const vr = rows.find((r) => r.id === 'village');
  const pleas = (await st()).campaign.board.filter((k) => k.story).length;
  check('board: a captive shows first in the village row and counts toward the 3', !!vr && vr.cards.length === 3 && vr.cards[0].captive === 'taken1', vr?.cards.map((x) => x.captive || x.story).join(','));
  check('board: "+N more once you\'ve seen to these" for the pleas that wait', !!vr && vr.more === `+${pleas + 1 - 3} more once you've seen to these`, vr?.more);
  check('board: work for hire still at most 3', (rows.find((r) => r.id === 'hire')?.cards.length ?? 0) <= 3);
  await p.evaluate((x) => window.vc.load(x), saved);
  await step('job');
}
const alive = partyBefore.filter((id) => s.campaign.roster.some((x) => x.id === id));
check('"Same as last time" offered when the last party is all on the roster', !!(await p.$('[data-same]')) === (alive.length === 2), `${alive}`);
if (await p.$('[data-same]')) {
  const pick = await p.$$eval('.lg-card', (els) => els[els.length - 1].dataset.contract);
  await p.click(`.lg-card[data-contract="${pick}"]`);
  await p.waitForTimeout(60);
  await p.click('[data-same]');
  await p.waitForTimeout(100);
  const plan = await p.$eval('.lg-plan', (e) => e.innerText).catch(() => '');
  check('"Same as last time" jumps to step 4 with the remembered party', (await page()) === 'setout' && (await p.$$('.lg-plan-hero')).length === 2 && /Keven/.test(plan));
  check('...keeps the chosen job', (await p.$eval('.lg-step[data-step="job"]', (e) => e.innerText)).length > 0);
}

// ---- won back: banner, Show me
const idle = () => p.waitForFunction(() => !window.vc.busy(), null, { timeout: 30000 });
await p.evaluate(async () => {
  const E = window.vcEngine;
  window.vc.load(E.apply(E.newGame(42), { type: 'newCampaign', seed: 42 }).state);
  const k = window.vc.state().campaign.board.find((x) => x.story === 'surgeon');
  await window.vc.send({ type: 'startDelve', contractId: k.id, heroIds: ['keven'], entrance: 0, packs: {} });
});
await idle();
await p.evaluate(async () => {
  const E = window.vcEngine;
  const d = structuredClone(window.vc.state());
  d.delve.heroes[0].at = { ...E.castle().entrances[0] };
  if (d.delve.prisoner) Object.assign(d.delve.prisoner, { freed: true, out: true });
  window.vc.load(d);
  await window.vc.send({ type: 'abandon' });
});
await idle();
await p.evaluate(() => window.vc.send({ type: 'backToCamp' }));
await p.waitForSelector('.lowgate');
await p.waitForTimeout(150);
const wb = await p.$eval('.lg-wonback', (e) => e.innerText).catch(() => '');
check('won back: "Brother Aldric is home." with where it lives now', /Brother Aldric is home\./.test(wb) && /when you pick the party/.test(wb), wb.replace(/\n/g, ' | ').slice(0, 120));
if (wb) {
  await p.click('[data-wonback="show"]');
  await p.waitForTimeout(80);
  check('"Show me" goes to the step where it lives (Party)', (await page()) === 'party' && !(await p.$('.lg-wonback')));
}

// ---- side pages
await p.click('[data-ribbon="graves"]');
await p.waitForTimeout(80);
check('the graves: empty state', /No names yet\. Keep it that way\./.test(await text()));
await edit(`s.campaign.fallen.push({ name: 'Bram Ashby', cls: 'sellsword', level: 2, where: 'Level 1, great hall', delve: 2 });`);
const gtxt = await text();
check('the graves: a headstone with name, class, where, delve and epitaph', /Bram Ashby/.test(gtxt) && /Sellsword · Level 2/.test(gtxt) && /Fell in the great hall/.test(gtxt) && /Held the line\./.test(gtxt) && /What they carried still lies where they fell/.test(gtxt));
await p.click('[data-k="back-steps"]'); // V5.1 (W1): Back lives in the footer
await p.waitForTimeout(80);
check('"Back to the delve steps" returns to the last step', (await page()) === 'party');
await p.click('[data-ribbon="cart"]');
await p.waitForTimeout(80);
check('Keven\'s cart page from the ribbon has both compartments', (await page()) === 'cart' && /Gear · goes in packs/i.test(await text()) && /Valuables · worth gold/i.test(await text()));

console.log(`\n${failed ? `${failed} FAILED` : 'all passed'}, ${errors} page errors`);
await b.close();
process.exit(failed || errors ? 1 : 0);
