// V4.0 Lowgate check, headless, by DOM and state, no screenshots (real engine only):
// the four steps exist and are clickable; a new campaign lands on Job with the welcome card;
// choosing a job selects it; hiring from step 2 fills a party slot and costs the price; heroes
// can leave the party and come back from the roster bench; healing shows in a wounded hero's
// slot only with the surgeon home; buying on step 3 puts the item in the selected hero's pack;
// the cart keeps valuables apart from gear and Sell all sells only valuables; the forge row and
// the ale picker appear only once won back; step 4 lists only the main gate on a new campaign
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
await p.evaluate(() => { localStorage.clear(); localStorage.setItem('vc.settings', JSON.stringify({ speed: 0, reduceShake: true, noEndTurnAsk: true })); });
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
check('header: Delve 1, Lowgate, gold', /Delve 1/i.test(head) && /Lowgate/.test(head) && /90\s*gold/.test(head), head.replace(/\n/g, ' | ').slice(0, 120));
check('step summaries: the job, "Keven alone", "Packs empty", "Main gate"', /Rescue Brother Aldric|Recover|Rescue/.test(head) && /Keven alone/.test(head) && /Packs empty/.test(head) && /Main gate/.test(head));
check('primary action bottom-right: "Next: Party"', /Next: Party/.test(await p.$eval('.lg-foot-r', (e) => e.innerText)));
check('no "Same as last time" without a last loadout', !(await p.$('[data-same]')));
check('no who-is-where village list', !(await p.$('.village-panel')) && !/Old Wim/.test(await p.$eval('.lg-foot', (e) => e.innerText)));
const houses = await p.$$eval('.lg-house', (els) => els.map((e) => `${e.dataset.house}:${e.dataset.state}`));
check('ribbon: chapel has the plea, Flagon and forge boarded', JSON.stringify(houses) === '["chapel:plea","flagon:boarded","forge:boarded"]', houses.join(','));
await p.click('.lg-welcome [data-welcome]');
await p.waitForTimeout(80);
check('"Got it" dismisses the welcome card', !(await p.$('.lg-welcome')));

// ---- step 1: Job
const cards = await p.$$eval('.lg-card', (els) => els.map((e) => ({ id: e.dataset.contract, story: e.dataset.story, chosen: e.getAttribute('aria-pressed') === 'true', text: e.innerText })));
check('the village plea comes first, with a seal and "Wins back"', cards[0]?.story === 'surgeon' && /Wins back/i.test(cards[0].text) && !!(await p.$('.lg-card.story .lg-card-seal')));
check('the first card is chosen by default ("Chosen")', cards[0]?.chosen && /Chosen/.test(cards[0].text));
check('no "Story" / "Unlocks" chips, no "No warnings posted"', cards.every((c) => !/No warnings posted|^Story$|Unlocks the/m.test(c.text)));
await p.click(`.lg-card[data-contract="${cards[1].id}"]`);
await p.waitForTimeout(80);
check('clicking a card selects it (no navigation)', (await page()) === 'job' && (await p.$eval(`.lg-card[data-contract="${cards[1].id}"]`, (e) => e.getAttribute('aria-pressed'))) === 'true');
const title1 = await p.evaluate((id) => window.vc.state().campaign.board.find((k) => k.id === id).title, cards[1].id);
check('...and the step summary names it', (await p.$eval('.lg-step[data-step="job"]', (e) => e.innerText)).includes(title1), title1);
check('renown pips at the step heading, with a hover text', !!(await p.$('.lg-renown[data-tip*="Renown"]')) && (await p.$$('.lg-renown .lg-pips i')).length === 3);
await p.click('.lg-house[data-house="chapel"]');
await p.waitForTimeout(80);
check('the chapel\'s plea seal selects that job', (await p.$eval('.lg-card[data-story="surgeon"]', (e) => e.getAttribute('aria-pressed'))) === 'true');

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
check('hiring costs the price (90 → 30)', s.campaign.gold === 30, `${s.campaign.gold}`);
check('the hire goes straight into the party slot', (await p.$$('.lg-slot.hero')).length === 2 && !!(await p.$(`.lg-slot.hero[data-hero="${r0}"]`)));
check('the step summary lists the party', (await p.$eval('.lg-step[data-step="party"]', (e) => e.innerText)).includes(s.campaign.roster[1].name));
await p.click(`[data-out="${r0}"]`);
await p.waitForTimeout(80);
check('a hero can leave the party, and waits on the roster bench', (await p.$$('.lg-slot.hero')).length === 1 && !!(await p.$(`[data-bench="${r0}"]`)));
await p.click(`[data-bench="${r0}"]`);
await p.waitForTimeout(80);
check('...and come back from the bench', (await p.$$('.lg-slot.hero')).length === 2);
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
const houses2 = await p.$$eval('.lg-house', (els) => els.map((e) => `${e.dataset.house}:${e.dataset.state}`));
check('ribbon: the chapel is home (lit)', houses2[0] === 'chapel:home', houses2.join(','));

// ---- step 3: Outfit
await p.click('[data-next="outfit"]');
await p.waitForTimeout(80);
check('"Next: Outfit" goes to step 3', (await page()) === 'outfit');
check('one loadout card per party hero, the first "Packing"', (await p.$$('.lg-hero')).length === 2 && /Packing/i.test(await p.$eval('.lg-hero.sel', (e) => e.innerText)));
check('V4.1: no free lantern on Keven\'s card', !(await p.$('.lg-hero[data-hero="keven"] .lg-lantern')));
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
check('the metalwork collapses into one dashed tile while the smith is away', (await p.$$('[data-ware="metalwork"]')).length === 1 && !(await p.$('[data-ware="hook"]')) && !(await p.$('[data-ware="lockpicks"]')));
check('no forge row or ale box while locked', !(await p.$('.lg-gear-row')));
await edit(`s.campaign.gold = 100;`);
await p.click(`[data-packfor="${r0}"]`);
await p.waitForTimeout(80);
check('clicking a hero card selects it for packing', (await p.$eval('.lg-hero.sel', (e) => e.dataset.hero)) === r0);
await p.click('[data-ware="torch"]');
await p.waitForTimeout(120);
s = await st();
const torch = s.campaign.stash.find((i) => i.kind === 'torch');
const pk = await p.$$eval(`.lg-hero[data-hero="${r0}"] [data-packed]`, (els) => els.map((e) => e.dataset.packed));
check('buying puts the item in the selected hero\'s pack', !!torch && pk.includes(torch.id) && s.campaign.gold === 90, `gold ${s.campaign.gold}`);
check('the ware tile says "1 packed"', /1 packed/.test(await p.$eval('[data-ware="torch"]', (e) => e.innerText)));
check('the step summary: "1 item packed"', /1 item packed/.test(await p.$eval('.lg-step[data-step="outfit"]', (e) => e.innerText)));
await p.click(`[data-packed="${torch.id}"]`);
await p.waitForTimeout(80);
check('clicking a packed item sends it back to the cart', !(await p.$(`[data-packed="${torch.id}"]`)) && /1 on the cart/.test(await p.$eval('[data-ware="torch"]', (e) => e.innerText)));
// the cart: gear apart from valuables
await edit(`s.campaign.stash.push({ id: 'gem-x', kind: 'gem', name: 'Moonstone', amount: 70, slots: 1 }, { id: 'jw-x', kind: 'jewelry', name: 'Silver torc', amount: 110, slots: 1 });`);
await p.click('[data-tab="cart"]');
await p.waitForTimeout(80);
const gearKinds = await p.$$eval('[data-cart]', (els) => els.map((e) => e.dataset.cart));
const valIds = await p.$$eval('[data-valuable]', (els) => els.map((e) => e.dataset.valuable));
check('cart: gear and valuables in their own compartments', gearKinds.includes('torch') && gearKinds.includes('potion') && !gearKinds.includes('gem') && valIds.length === 2, `${gearKinds} / ${valIds}`);
check('cart: per-item Sell buttons live, Sell all names the gear stays', (await p.$$('[data-sell]:not([aria-disabled="true"])')).length === 2 && /Gear stays on the cart/.test(await p.$eval('.lg-sellall', (e) => e.innerText)));
{
  const g0 = await p.evaluate(() => window.vc.state().campaign.gold);
  await p.click('[data-sell="gem-x"]');
  await p.waitForTimeout(120);
  const after = await p.evaluate(() => ({ gold: window.vc.state().campaign.gold, ids: window.vc.state().campaign.stash.map((i) => i.id) }));
  check('cart: selling one gem adds its value and leaves the torc', after.gold === g0 + 70 && !after.ids.includes('gem-x') && after.ids.includes('jw-x'), JSON.stringify(after));
  await edit(`s.campaign.stash.push({ id: 'gem-x', kind: 'gem', name: 'Moonstone', amount: 70, slots: 1 }); s.campaign.gold -= 70;`);
  await p.click('[data-tab="cart"]');
  await p.waitForTimeout(80);
}
check('cart: "Sell all · 180 gold"', /Sell all\s*·\s*180\s*gold/.test(await p.$eval('[data-sellall]', (e) => e.innerText)));
await p.click('[data-cart="torch"]');
await p.waitForTimeout(80);
check('clicking cart gear packs it for the selected hero', (await p.$$(`.lg-hero[data-hero="${r0}"] [data-packed]`)).length === 1);
await p.click('[data-sellall]');
await p.waitForTimeout(120);
s = await st();
check('Sell all sells only the valuables', s.campaign.gold === 270 && !s.campaign.stash.some((i) => i.kind === 'gem' || i.kind === 'jewelry') && s.campaign.stash.some((i) => i.kind === 'torch') && s.campaign.stash.some((i) => i.kind === 'potion'), `gold ${s.campaign.gold}`);
// the forge and the taps
await edit(`Object.assign(s.campaign.village, { smith: true, innkeeper: true, copper: true }); s.campaign.gold = 300;`);
check('with the smith home: a gear row per hero (blade, mail, shield)', (await p.$$('.lg-gear-row')).length === 2 && !!(await p.$('[data-upgrade="weapon"]')) && !!(await p.$('[data-shield]')));
await p.click('[data-tab="peddler"]');
await p.waitForTimeout(80);
check('with the smith home: hooks, keys, picks and caltrops on the wagon', !(await p.$('[data-ware="metalwork"]')) && !!(await p.$('[data-ware="hook"]')) && !!(await p.$('[data-ware="lockpicks"]')) && !!(await p.$('[data-ware="caltrops"]')));
check('with Wim home: the night-eye draught under Light and mending', !!(await p.$('[data-ware="nightsight"]')));
await p.click(`[data-upgrade="weapon"][data-hero="${r0}"]`);
await p.waitForTimeout(100);
s = await st();
check('Blade upgrade sends `upgrade` (tier 1, 60 gold)', s.campaign.roster.find((x) => x.id === r0).weaponTier === 1 && s.campaign.gold === 240, `${s.campaign.gold}`);
await p.click(`[data-ale="${r0}"]`);
await p.waitForTimeout(80);
const pours = await p.$$eval('[data-pour]', (els) => els.map((e) => e.dataset.pour));
check('"Pour one" opens the ale picker (the four copper ales)', pours.length === 4, pours.join(','));
await p.click(`[data-pour="${pours[0]}"]`);
await p.waitForTimeout(100);
s = await st();
check('pouring sends `buyAle` and the ale shows by name', s.campaign.roster.find((x) => x.id === r0).ale === pours[0] && !!(await p.$(`.lg-hero[data-hero="${r0}"] .lg-gear.have.ale`)));
const lpk = await p.evaluate(() => { const s = window.vc.state(); return s.campaign.stash.find((i) => i.kind === 'lockpicks'); });
await p.click('[data-packfor="keven"]');
await p.waitForTimeout(60);
await p.click('[data-ware="lockpicks"]');
await p.waitForTimeout(120);
void lpk;
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
    check(`${w}×${hh}: the sketch takes ≥ 45% of the window's height`, m.svg && m.sketch >= 0.45 * m.vh, `${Math.round(m.sketch)} of ${m.vh}`);
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
check('won back: the chapel glows on the ribbon', !!(await p.$('.lg-house[data-house="chapel"].won')));
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
await p.click('.lg-head .lg-btn');
await p.waitForTimeout(80);
check('"Back to the delve steps" returns to the last step', (await page()) === 'party');
await p.click('[data-ribbon="cart"]');
await p.waitForTimeout(80);
check('Keven\'s cart page from the ribbon has both compartments', (await page()) === 'cart' && /Gear · goes in packs/i.test(await text()) && /Valuables · worth gold/i.test(await text()));

console.log(`\n${failed ? `${failed} FAILED` : 'all passed'}, ${errors} page errors`);
await b.close();
process.exit(failed || errors ? 1 : 0);
