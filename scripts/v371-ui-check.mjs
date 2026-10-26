// V3.7.1 camp and pack check (spec 21), headless, by DOM text and state, no screenshots:
// a new campaign opens on the notice post (V4.0: step 1, Job) with 90 gold and no hire gate,
// Set out warns when Keven goes alone and Delve is enabled; the night-eye draught is on the
// wagon only once Wim is home, and buying it packs it;
// a Burglar's pack shows the improvised pick (no slot), and the locked-door hover changes once
// it is spent. Real engine only.
//   node scripts/v371-ui-check.mjs <baseUrl>
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';

const [base = 'http://localhost:5191/'] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
await p.route(/fonts\./, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
let errors = 0;
let failed = 0;
p.on('pageerror', (e) => (errors++, console.log('[pageerror]', e.message)));
p.on('console', (m) => m.type() === 'error' && (errors++, console.log('[console]', m.text())));
const check = (name, ok, extra = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`);
};
const text = () => p.evaluate(() => document.body.innerText);
const idle = () => p.waitForFunction(() => window.vc && !window.vc.busy(), null, { timeout: 60000 });
const edit = (fn, arg) => p.evaluate(([f, a]) => { const s = structuredClone(window.vc.state()); new Function('s', 'a', f)(s, a); window.vc.load(s); }, [fn, arg]);
const step = async (id) => { await p.click(`.lg-step[data-step="${id}"]`); await p.waitForTimeout(120); };

await p.goto(base);
await p.evaluate(() => { localStorage.clear(); localStorage.setItem('vc.settings', JSON.stringify({ speed: 0, reduceShake: true, noEndTurnAsk: true })); });
await p.reload();
await p.waitForFunction(() => !!window.vc);
await p.evaluate(() => { const E = window.vcEngine; window.vc.load(E.apply(E.newGame(42), { type: 'newCampaign', seed: 42 }).state); });
await p.waitForTimeout(150);

// 21.1 / 21.2 (V4.0: Lowgate's four steps)
check('new campaign: 90 gold', (await p.evaluate(() => window.vc.state().campaign.gold)) === 90);
check('lands on the notice post (step 1, Job)', (await p.evaluate(() => document.querySelector('.lowgate')?.dataset.page)) === 'job');
check('no hire gate: a job is chosen with Keven alone', !!(await p.$('.lg-card[aria-pressed="true"]')));
await step('party');
check('Party: "Keven can go alone, but if he falls, it\'s over."', /Keven can go alone, but if he falls, it's over\./.test(await text()));
check('Party: the first empty slot points at the campfire ("Hire someone below.")', /Hire someone below\./.test(await text()));
await step('setout');
const prep = await text();
check('Set out: "Keven goes in alone. If he falls, it\'s over."', /Keven goes in alone\. If he falls, it's over\./.test(prep));
check('Set out: the Delve button is enabled', await p.$eval('.lg-delve', (e) => e.getAttribute('aria-disabled') !== 'true'));

// 21.3: the night-eye draught is Wim's (V4.0: locked stays quiet, so it isn't on the wagon until he is home)
await step('outfit');
check('wagon: no night-eye draught while Wim is away', !(await p.$('[data-ware="nightsight"]')));
await edit('s.campaign.village.innkeeper = true;');
const fl = await p.$('[data-ware="nightsight"]');
check('wagon: the night-eye draught once Wim is home (taps dry or not)', !!fl);
if (fl) {
  await p.click('[data-ware="nightsight"]');
  await p.waitForTimeout(150);
  const s = await p.evaluate(() => window.vc.state().campaign);
  check('bought for 30, packed for Keven', s.gold === 60 && s.stash.some((i) => i.kind === 'nightsight') && !!(await p.$('.lg-hero[data-hero="keven"] [data-kind="nightsight"]')), `gold ${s.gold}`);
}

// 21.4: a Burglar in the delve
await p.evaluate(async () => {
  const s = window.vc.state();
  const r = s.campaign.recruits.find((x) => x.hero.cls === 'burglar');
  if (r) {
    s.campaign.gold = Math.max(s.campaign.gold, r.price);
    window.vc.load(s);
    await window.vc.send({ type: 'hire', heroId: r.hero.id });
  } else {
    // No Burglar for hire this seed: hire anyone and make them one (the engine reads the class off the roster).
    s.campaign.gold = 200;
    window.vc.load(s);
    await window.vc.send({ type: 'hire', heroId: s.campaign.recruits[0].hero.id });
    const t = structuredClone(window.vc.state());
    t.campaign.roster[1].cls = 'burglar';
    window.vc.load(t);
  }
  const t = window.vc.state();
  const k = t.campaign.board.find((x) => x.level === 1 && !x.story) ?? t.campaign.board[0];
  await window.vc.send({ type: 'startDelve', contractId: k.id, heroIds: t.campaign.roster.map((h) => h.id), entrance: 0, packs: {} });
});
await idle();
await p.waitForTimeout(300);
const burg = await p.evaluate(() => { const s = window.vc.state(); const id = s.campaign.roster.find((h) => h.cls === 'burglar')?.id; return s.delve?.heroes.find((h) => h.heroId === id); });
check('the Burglar starts with one improvised pick, no slot', !!burg && burg.pack.filter((i) => i.kind === 'improvised' && i.slots === 0).length === 1);
if (burg) {
  const sock = await p.$eval(`.hcard[data-hero="${burg.heroId}"] .pk-sock.pk-improvised`, (e) => ({ title: e.title, span: e.dataset.span, inKit: !!e.closest('.pk-kit'), inSlots: !!e.closest('.pk-socks') })).catch(() => null);
  check('pack shows the improvised pick in its own socket with help', !!sock && sock.span === '0' && /Improvised pick · one Pick at 2 Finesse slots, used up/.test(sock.title), sock?.title.slice(0, 80));
  // V4.0 (26.5): it sits in the kit mark after the slots, not in the slot boxes, and says whose it is.
  check('...in the kit mark after the 4 slots, not inside them', !!sock && sock.inKit && !sock.inSlots);
  check('...hover: "<name>\'s own: improvised pick. Doesn\'t take a slot; can\'t be given away."', !!sock && /^\S.*'s own: improvised pick\. Doesn't take a slot; can't be given away\./.test(sock.title), sock?.title.split('\n')[0]);
  const slotBoxes = await p.$$eval(`.hcard[data-hero="${burg.heroId}"] .pk-socks .pk-sock`, (els) => els.length).catch(() => 0);
  check('...the 4 slot boxes are all still there', slotBoxes === 4, `${slotBoxes}`);
  const free = await p.$eval(`.hcard[data-hero="${burg.heroId}"] .pk-free`, (e) => e.textContent).catch(() => '');
  check('it takes no slot: 4 free', /4 free/.test(free), free);
  // Locked-door hover: Pick while the pick lasts, the spent line after.
  const lockedDoor = await p.evaluate(() => {
    const s = window.vc.state();
    const k = Object.entries(s.delve.doors).find(([, d]) => d.locked && !d.open)?.[0];
    if (!k) return null;
    const [lv, rest] = k.split(':');
    const [q, r] = rest.split(',').map(Number);
    return { level: Number(lv), q, r, key: k };
  });
  if (lockedDoor) {
    await edit('s.delve.explored.push(a);', lockedDoor.key);
    const tip = async () => {
      await p.evaluate((id) => window.vc.hud.select(id), burg.heroId);
      await p.waitForTimeout(80);
      return p.evaluate((a) => { window.vc.hud.onHover(a, null); const t = document.querySelector('.hud-tip')?.textContent ?? ''; window.vc.hud.onHover(null, null); return t; }, lockedDoor);
    };
    const t1 = await tip();
    check('locked door hover with the improvised pick: Pick, Smash', /Locked door/.test(t1) && /Pick, Smash/.test(t1), t1.slice(0, 100));
    await edit(`const h = s.delve.heroes.find((x) => x.heroId === a); h.pack = h.pack.filter((i) => i.kind !== 'improvised');`, burg.heroId);
    const t2 = await tip();
    check('...spent: names Gerda\'s lockpicks', /improvised pick is spent/.test(t2) && /lockpicks/.test(t2), t2.slice(0, 120));
  } else console.log('skip: no locked door in this state');
}
console.log(`\n${failed} failed, ${errors} console errors`);
await b.close();
process.exit(failed || errors ? 1 : 0);
