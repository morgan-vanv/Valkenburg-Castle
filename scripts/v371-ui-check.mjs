// V3.7.1 camp and pack check (spec 21), headless, by DOM text and state, no screenshots:
// a new campaign opens on the notice post with 90 gold and no hire gate (jobs can be taken),
// the prepare screen warns when Keven goes alone and the delve starts; the peddler shows the
// night-eye draught locked ("Brewed at the Gilded Flagon"), the Flagon sells it into the stash;
// a Burglar's pack shows the improvised pick (no slot), and the locked-door hover changes once
// it is spent. Real engine only.
//   node scripts/v371-ui-check.mjs <baseUrl>
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import { inTurns } from './v38-ui-turns.mjs'; // V3.8: delves start exploring; these checks test turns

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
const station = async (id) => { await p.click(`.station[data-station="${id}"]`); await p.waitForTimeout(120); };

await p.goto(base);
await p.evaluate(() => { localStorage.clear(); localStorage.setItem('vc.settings', JSON.stringify({ speed: 0, reduceShake: true, noEndTurnAsk: true })); });
await p.reload();
await p.waitForFunction(() => !!window.vc);
await inTurns(p);
await p.evaluate(() => { const E = window.vcEngine; window.vc.load(E.apply(E.newGame(42), { type: 'newCampaign', seed: 42 }).state); });
await p.waitForTimeout(150);

// 21.1 / 21.2
check('new campaign: 90 gold', (await p.evaluate(() => window.vc.state().campaign.gold)) === 90);
await station('board');
check('no hire gate on the notice post', !(await p.$('.hire-first')));
check('a hint instead: "Keven stands alone"', /Keven stands alone/.test(await text()));
check('the campfire glows as a suggestion', !!(await p.$('.station[data-station="tavern"].call')));
check('"Take the job" is enabled with Keven alone', await p.$eval('.contract .btn-primary', (e) => !e.disabled));
await p.click('.contract .btn-primary');
await p.waitForTimeout(150);
const prep = await text();
check('prepare: "Keven goes in alone. If he falls, it\'s over."', /Keven goes in alone\. If he falls, it's over\./.test(prep));
check('prepare: the delve button is enabled', await p.$eval('.btn-delve', (e) => !e.disabled));

// 21.3
await station('quartermaster');
const night = await p.$eval('.shop-row[data-kind="nightsight"]', (e) => ({ t: e.innerText, locked: e.classList.contains('locked') })).catch(() => null);
check('peddler: night-eye locked, "Brewed at the Gilded Flagon: rescue Old Wim"', !!night && night.locked && /Brewed at the Gilded Flagon: rescue Old Wim/.test(night.t), night?.t.slice(0, 100));
await edit('s.campaign.village.innkeeper = true;');
await station('quartermaster');
check('peddler: no night-eye once Wim is home (it is at the Flagon)', !(await p.$('.shop-row[data-kind="nightsight"]')));
await station('tavern');
const fl = await p.$('.draughts .shop-row[data-kind="nightsight"]:not(.locked)');
check('the Flagon lists the night-eye draught (taps dry or not)', !!fl);
if (fl) {
  await p.click('.draughts .shop-row[data-kind="nightsight"] .btn');
  await p.waitForTimeout(150);
  const s = await p.evaluate(() => window.vc.state().campaign);
  check('bought into the stash for 30', s.gold === 60 && s.stash.some((i) => i.kind === 'nightsight'), `gold ${s.gold}`);
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
  const sock = await p.$eval(`.hcard[data-hero="${burg.heroId}"] .pk-sock.pk-improvised`, (e) => ({ title: e.title, span: e.dataset.span })).catch(() => null);
  check('pack shows the improvised pick in its own socket with help', !!sock && sock.span === '0' && /Improvised pick · one Pick at 2 Finesse slots, used up/.test(sock.title), sock?.title.slice(0, 80));
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
