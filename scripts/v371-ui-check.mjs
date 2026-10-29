// V3.7.1 camp and pack check (spec 21), headless, by DOM text and state, no screenshots:
// a new campaign opens on the notice post (V4.0: step 1, Job) with 90 gold and no hire gate,
// Set out warns when Keven goes alone and Delve is enabled; the night-eye draught is on the
// wagon only once Wim is home, and buying it packs it;
// a Burglar's pack shows the improvised pick (no slot), and the locked-door hover changes once
// it is spent. Real engine only. V4.0 HUD: the party card's "own" mark and the hover card in place of the old sockets and tooltip.
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
check('new campaign: 70 gold (V4.1)', (await p.evaluate(() => window.vc.state().campaign.gold)) === 70);
check('lands on the notice post (step 1, Job)', (await p.evaluate(() => document.querySelector('.lowgate')?.dataset.page)) === 'job');
check('no hire gate: a job is chosen with Keven alone', !!(await p.$('.lg-card[aria-pressed="true"]')));
await step('party');
// V5.1: the Party board carries no prose; the heir's warning is the crown mark's tip, the open slot takes a drop.
check('Party: Keven\'s crown mark warns "If he falls, it\'s over."', await p.evaluate(() => [...document.querySelectorAll('[data-tip]')].some((e) => /If he falls, it's over/.test(e.dataset.tip ?? ''))));
check('Party: the first empty slot is an open drop slot', !!(await p.$('.pt-slot.pt-empty.first:not(.pt-locked)')));
await step('setout');
const prep = await text();
check('Set out: "Keven goes in alone. If he falls, it\'s over."', /Keven goes in alone\. If he falls, it's over\./.test(prep));
check('Set out: the Delve button is enabled', await p.$eval('.lg-delve', (e) => e.getAttribute('aria-disabled') !== 'true'));

// 21.3: the night-eye draught was Wim's; V4.1 (WS2) retired it for Night-eye Stout, an ale (Wim and Ilse). V5.1.2: on the
// Party step's taps, dry until both are home; never on the wagon.
await step('outfit');
check('wagon: no night-eye draught (retired in V4.1)', !(await p.$('[data-ware="nightsight"]')));
await edit('s.campaign.village.innkeeper = true;');
await step('party');
await p.click('[data-ftab="taps"]');
await p.waitForTimeout(100);
check('the taps: Night-eye Stout dry while Ilse is away', !!(await p.$('.pt-tap.off[data-tap="nighteye"]')));
await edit('s.campaign.village.alchemist = true;');
check('the taps: Night-eye Stout on tap once Wim and Ilse are home', !!(await p.$('.pt-tap[data-drag][data-tap="nighteye"]')));

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
  // V4.0 HUD: the kit is the "own" mark after the 4 mini slots on the party card; its hover says whose it is and what it does.
  const sock = await p.$eval(`.dl-rcard[data-hero="${burg.heroId}"] .dl-own`, (e) => ({ title: e.dataset.tip ?? e.title, inSlots: !!e.closest('.dl-minis') })).catch(() => null);
  check('the card shows the improvised pick as its own mark, with help', !!sock && /Each Pick rolls 2 Finesse tries and uses one up/.test(sock.title), sock?.title.slice(0, 120));
  check('...after the 4 slots, not inside them', !!sock && !sock.inSlots);
  check('...hover: "<name>\'s own · 1 improvised pick left" (V4.0 spec 30.2: one a level), takes no slot, can\'t be given away', !!sock && /^\S.*'s own · \d improvised picks? left\nTakes no slot; can't be given away\./.test(sock.title), sock?.title.split('\n')[0]);
  const minis = await p.$$eval(`.dl-rcard[data-hero="${burg.heroId}"] .dl-minis .dl-mini`, (els) => els.map((e) => e.className)).catch(() => []);
  check('...the 4 slot boxes are all still there', minis.length === 4, `${minis.length}`);
  const free = await p.$eval(`.dl-rcard[data-hero="${burg.heroId}"] .dl-minis`, (e) => e.dataset.tip ?? e.title).catch(() => '');
  check('it takes no slot: 4 free', /4 free/.test(free), free.split('\n')[0]);
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
      return p.evaluate((a) => { window.vc.hud.onHover(a, null); const el = document.querySelector('.dl-card'); const t = el && !el.classList.contains('hidden') ? el.textContent : ''; window.vc.hud.onHover(null, null); return t; }, lockedDoor);
    };
    const t1 = await tip();
    check('locked door hover with the improvised pick: Pick, Smash', /Locked door/.test(t1) && /Pick, Smash/.test(t1), t1.slice(0, 100));
    await edit(`const h = s.delve.heroes.find((x) => x.heroId === a); h.pack = h.pack.filter((i) => i.kind !== 'improvised');`, burg.heroId);
    const t2 = await tip();
    check('...spent: names Gerda\'s lockpicks', /improvised picks are spent/.test(t2) && /lockpicks/.test(t2), t2.slice(0, 120));
  } else console.log('skip: no locked door in this state');
}
console.log(`\n${failed} failed, ${errors} console errors`);
await b.close();
process.exit(failed || errors ? 1 : 0);
