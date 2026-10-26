// V3.5 presentation check (spec 18.7), headless, by DOM text and state, no screenshots:
// title intro, Lowgate (V4.0: the four steps) and its locks, pinned story contracts, drinking a
// potion in the party slot, the Flagon and ales, the won-back moment, the parley card (deals, toll, Fight, a deal made), hired crew
// tags, ale chips on delve cards, the game-over line; no console errors.
//   node scripts/v35-ui-check.mjs <baseUrl>   (use ?fixture=1 until the engine lands)
//   Optional 2nd arg: a directory to save the camp and parley screenshots in.
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';

const [base = 'http://localhost:5182/?fixture=1', shots = ''] = process.argv.slice(2);
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
const step = async (id) => {
  await p.click(`.lg-step[data-step="${id}"]`);
  await p.waitForTimeout(120);
};
/** Record every line the HUD logs during playback (the state's own log replaces them after). */
const spyLog = () => p.evaluate(() => { window.__lines = []; const hud = window.vc.hud; if (!hud.__spied) { const orig = hud.log.bind(hud); hud.log = (t, c) => (window.__lines.push(t), orig(t, c)); hud.__spied = true; } });
const lines = () => p.evaluate(() => window.__lines.join('\n'));
const edit = (fn, arg) => p.evaluate(([f, a]) => { const s = structuredClone(window.vc.state()); new Function('s', 'a', f)(s, a); window.vc.load(s); }, [fn, arg]);

await p.goto(base);
await p.evaluate(() => { localStorage.clear(); localStorage.setItem('vc.settings', JSON.stringify({ speed: 0, reduceShake: true })); });
await p.reload();
await p.waitForFunction(() => !!window.vc);

// ---- title
let t = await text();
check('title: intro names Keven, Lowgate and the late Lord Hobart', /Keven/.test(t) && /Lowgate/.test(t) && /Lord Hobart/.test(t));
check('title: "The Heir\'s Return"', /The Heir's Return/i.test(t));

// ---- new campaign → camp (V4.0: Lowgate's four steps; locked services stay quiet)
await p.evaluate(() => { const E = window.vcEngine; window.vc.load(E.apply(E.newGame(42), { type: 'newCampaign', seed: 42 }).state); });
await p.waitForTimeout(200);
t = await text();
check('camp header is Lowgate', (await p.textContent('.lg-title')) === 'Lowgate');
check('no "Hobart\'s camp" anywhere', !/Hobart's camp/.test(t));
const houses0 = await p.$$eval('.lg-house', (els) => els.map((e) => e.dataset.state));
check('ribbon: three houses, none home', houses0.length === 3 && !houses0.includes('home'), houses0.join(','));
const stories = await p.$$eval('.lg-card.story', (els) => els.map((e) => e.dataset.story));
check('surgeon story contract pinned with its own look', stories.includes('surgeon'), stories.join(','));
t = await p.textContent('.lg-card.story');
check('story card says what it wins back', /Wins back/i.test(t) && /infirmary/i.test(t));
check('welcome card on the first camp', !!(await p.$('.lg-welcome')));
if (shots) await p.screenshot({ path: `${shots}/v35-ui-camp-after.png` });

// forge (V4.0: the gear row on each loadout card, hidden while the forge is cold)
await step('outfit');
check('no forge row while the forge is cold', !(await p.$('.lg-gear-row')));
// peddler: metalwork as one dashed tile
check('peddler: metalwork collapsed into one tile that needs a smith', !!(await p.$('[data-ware="metalwork"]')) && !(await p.$('[data-ware="hook"]')) && /need a smith/.test(await p.textContent('[data-ware="metalwork"]')));
// campfire
await step('party');
t = await text();
check('the campfire, not the Flagon', /At the campfire/.test(t) && !/Gilded Flagon/.test(t));
check('no ales before the Flagon', !(await p.$('.lg-alepick')) && !(await p.$('[data-ale]')));

// healing in the party slot: drink a potion (the real engine starts with an empty stash: buy one first)
await p.evaluate(async () => {
  if (!window.vc.state().campaign.stash.some((i) => i.kind === 'potion')) await window.vc.send({ type: 'buy', kind: 'potion' });
});
await edit("s.campaign.roster[0].hp = s.campaign.roster[0].maxHp - 6;");
const hp0 = await p.evaluate(() => window.vc.state().campaign.roster[0].hp);
const pots0 = await p.evaluate(() => window.vc.state().campaign.stash.filter((i) => i.kind === 'potion').length);
await p.click('[data-drink="keven"]');
await p.waitForTimeout(150);
const hp1 = await p.evaluate(() => window.vc.state().campaign.roster[0].hp);
const pots1 = await p.evaluate(() => window.vc.state().campaign.stash.filter((i) => i.kind === 'potion').length);
check('drink: +5 HP and a potion used', hp1 === hp0 + 5 && pots1 === pots0 - 1, `${hp0}→${hp1}, potions ${pots0}→${pots1}`);
check('no heal-for-gold button without the surgeon', !(await p.$('[data-heal]')));


// ---- won-back moment: take the surgeon contract, come back
const idle = () => p.waitForFunction(() => !window.vc.busy(), null, { timeout: 30000 });
await p.evaluate(async () => {
  const s = window.vc.state();
  const k = s.campaign.board.find((x) => x.story === 'surgeon');
  const fixture = location.search.includes('fixture');
  await window.vc.send({ type: 'startDelve', contractId: k.id, heroIds: fixture ? ['keven', 'brann'] : ['keven'], entrance: 0, packs: {} });
});
await idle();
await p.evaluate(async () => {
  if (!location.search.includes('fixture')) {
    // Real engine: Keven stands on the entrance (an exit); walk Aldric out with him and leave.
    const d = structuredClone(window.vc.state());
    const at = window.vcEngine.castle().entrances[0];
    d.delve.heroes[0].at = { ...at };
    Object.assign(d.delve.prisoner, { freed: true, out: true });
    window.vc.load(d);
    await window.vc.send({ type: 'abandon' });
  }
});
await idle();
await p.evaluate(() => window.vc.send({ type: 'backToCamp' }));
await p.waitForTimeout(300);
t = await text();
check('won back: banner, "Brother Aldric is home."', !!(await p.$('.lg-wonback')) && /Brother Aldric is home\./.test(t));
check('won back: the chapel lit on the ribbon', !!(await p.$('.lg-house[data-house="chapel"].won')));
check('ribbon: Aldric home', (await p.$$('.lg-house[data-state="home"]')).length === 1);
await p.click('[data-wonback="later"]');
await p.waitForTimeout(100);
check('won-back banner dismisses ("Later")', !(await p.$('.lg-wonback')));
await edit("s.campaign.roster[0].hp = s.campaign.roster[0].maxHp - 2; s.campaign.gold = Math.max(s.campaign.gold, 20);");
await step('party');
check('healing for gold now in the party slot', /3 gold per HP/.test((await p.getAttribute('[data-heal="keven"]', 'data-tip')) ?? ''));

// ---- the Flagon and ales
await edit("Object.assign(s.campaign.village, { innkeeper: true, copper: true, smith: true }); s.campaign.gold = 300;");
check('campfire became the Gilded Flagon', /At the Gilded Flagon/.test(await text()));
await step('outfit');
await p.click('[data-ale="keven"]');
await p.waitForTimeout(80);
const ales = await p.$$eval('[data-pour]', (els) => els.map((e) => e.dataset.pour));
check('the copper ales on tap (4), the cask-book ales not shown until brewed', ales.length === 4 && !ales.includes('blackcask'), ales.join(','));
await p.click('[data-pour="reserve"]');
await p.waitForTimeout(150);
check('bought Hobart\'s Reserve for Keven', (await p.evaluate(() => window.vc.state().campaign.roster.find((h) => h.id === 'keven').ale)) === 'reserve');
check('Keven\'s loadout card shows the ale by name', /Hobart's Reserve/.test(await p.textContent('.lg-hero[data-hero="keven"] .lg-gear.have.ale')));
check('no second ale for Keven (no "Pour one")', !(await p.$('[data-ale="keven"]')));
check('forge open with Gerda home: blade, mail, shield', !!(await p.$('.lg-hero[data-hero="keven"] [data-upgrade="weapon"]')) && !!(await p.$('.lg-hero[data-hero="keven"] .lg-gear-row')));
if (shots) await p.screenshot({ path: `${shots}/v35-ui-camp-after-flagon.png` });

// the party slot shows the ale
await step('party');
check('party slot: Keven shows his ale', /Hobart's Reserve/.test(await p.textContent('.lg-slot.hero[data-hero="keven"]')));
await p.evaluate(async () => {
  const s = window.vc.state();
  if (s.campaign.roster.length < 2 && s.campaign.recruits[0]) {
    s.campaign.gold = Math.max(s.campaign.gold, 200);
    window.vc.load(s);
    await window.vc.send({ type: 'hire', heroId: s.campaign.recruits[0].hero.id });
  }
});


// A crew next to the party: the fixture's, or on the real engine a real delve with the same crew
// injected on floor hexes Keven can reach (so line of sight and range are real).
async function crewScene(stance) {
  await p.evaluate(async (stance) => {
    if (location.search.includes('fixture')) {
      const fx = await import('/src/view/fixtures.ts');
      window.vc.load(fx.fixtureCrew(fx.fixtureDelve(window.vcEngine.castle()), stance));
      return;
    }
    let s = window.vc.state();
    if (!s.delve) {
      const ids = s.campaign.roster.slice(0, 2).map((h) => h.id);
      await window.vc.send({ type: 'startDelve', contractId: s.campaign.board.find((k) => !k.story && k.level === 1).id, heroIds: ids, entrance: 0, packs: {} });
      s = window.vc.state();
    }
    const d = s.delve;
    const E = window.vcEngine;
    const k = d.heroes[0];
    for (const h of d.heroes) Object.assign(h, { moved: false, acted: false, dashed: false });
    d.phase = 'player';
    d.rivals = null;
    const spots = E.reachable(s, k.heroId, false).filter((r) => r.to.level === k.at.level && r.path.length >= 2 && r.path.length <= 3).map((r) => r.to);
    const taken = new Set(d.heroes.map((h) => `${h.at.q},${h.at.r}`));
    const free = spots.filter((p) => !taken.has(`${p.q},${p.r}`)).slice(0, 3);
    const gold = (n) => ({ id: `cg${n}`, kind: 'gold', name: 'Gold', amount: 30, slots: 1 });
    const second = d.heroes[1] ?? k;
    second.pack = [{ id: 'pg1', kind: 'gold', name: 'Gold', amount: 35, slots: 1 }, { id: 'pr1', kind: 'gem', name: 'Ruby', amount: 60, slots: 1 }];
    d.rivals = {
      crew: 'ferrymen', name: 'The Ferrymen', temperament: 'cutthroat', stance, goal: 'loot',
      aim: { at: free[0], what: 'the chest by the bridge', rounds: 3, value: 60 },
      toll: 75, hiredRounds: stance === 'hired' ? 4 : undefined, spotted: true, entersRound: 1, entered: true,
      members: [
        { id: 'r1', crew: 'ferrymen', name: 'Brune', cls: 'sellsword', at: free[0], hp: 12, maxHp: 12, loot: [gold(1)], goneOut: false, intent: stance === 'demanding' ? { kind: 'toll' } : undefined },
        { id: 'r2', crew: 'ferrymen', name: 'Osk', cls: 'ranger', at: free[1], hp: 9, maxHp: 9, loot: [gold(2)], goneOut: false },
        { id: 'r3', crew: 'ferrymen', name: 'Hackett', cls: 'sapper', at: free[2], hp: 11, maxHp: 11, loot: [gold(3)], goneOut: false, charges: 1 },
      ],
    };
    window.vc.load(s);
  }, stance);
}

// ---- delve: ale chip, crew, parley
await crewScene('demanding');
await p.waitForTimeout(400);
check('delve card: ale chip on Keven', /Hobart's Reserve/.test(await p.textContent('.hcard[data-hero="keven"]')));
check('rival panel: crew name and Demanding', /The Ferrymen/.test(await p.textContent('.hud-rivals')) && /Demanding/.test(await p.textContent('.hud-rivals')));
check('rival panel: toll with the fuse', /Pay 75/.test(await p.textContent('.hud-rivals')) && /next turn/.test(await p.textContent('.hud-rivals')));
const tollTag = await p.$('.intent-toll');
check('toll intent drawn with a fuse', !!tollTag && !!(await p.$('.intent-toll .intent-fuse')));
check('parley on the action bar', !!(await p.$('button.act[data-action="parley"]')));
await p.click('button.act[data-action="parley"]');
await p.waitForTimeout(150);
const card = await p.textContent('.hud-parley');
check('card: crew, temperament, stance', /The Ferrymen/.test(card) && /Cutthroats/.test(card) && /Demanding/.test(card));
check('card: members listed', (await p.$$('.pl-mem')).length === 3);
check('card: aim (what, rounds, value)', /the chest by the bridge/.test(card) && /3 rounds away/.test(card) && /~60 gold/.test(card));
check('card: the toll reads as a demand', /Your gold or your blood/.test(card) && /Pay 75 or they attack next turn/.test(card));
check('card: deals with prices', (await p.$$('.pl-deal')).length >= 4 && /Pay the toll/.test(card));
check('card: pays text', /They take: .*gold/.test(card));
check('card: hire shows risk', /⚠/.test(await p.textContent('.pl-deal[data-deal="hire"]')));
check('card: blocked reason shown (jobs while demanding)', /Pay the toll first/.test(card));
check('card: Fight is a button', !!(await p.$('.pl-fight:not([disabled])')));
if (shots) await p.screenshot({ path: `${shots}/v35-ui-parley.png` });
await spyLog();
await p.click('.pl-deal[data-deal="truce"] .btn');
await p.waitForTimeout(400);
check('deal made: truce, card closed', (await p.evaluate(() => window.vc.state().delve.rivals.stance)) === 'truce' && (await p.$eval('.hud-parley', (e) => e.classList.contains('hidden'))));
check('deal log line', /A truce/.test(await lines()), await lines());

// too poor: blocked
await edit("s.delve.heroes.forEach((h) => (h.pack = h.pack.filter((i) => i.kind !== 'gold' && i.kind !== 'gem'))); s.delve.rivals.stance = 'neutral'; delete s.delve.rivals.dealRound;");
await p.keyboard.press('b');
await p.waitForTimeout(150);
check('blocked: "You carry 0; they want 40."', /You carry 0; they want 40\./.test(await p.textContent('.hud-parley')));
await p.keyboard.press('Escape');
await p.waitForTimeout(80);
check('Esc closes the card', await p.$eval('.hud-parley', (e) => e.classList.contains('hidden')));

// hired: allies
await edit("s.delve.rivals.stance = 'hired'; s.delve.rivals.hiredRounds = 4;");
await p.waitForTimeout(150);
check('hired crew tagged as allies', (await p.$$('.unit-tag.tag-st-hired')).length >= 1 && /hired/.test(await p.evaluate(() => [...document.querySelectorAll('.unit-tag.tag-st-hired')].map((e) => e.textContent).join(' '))));
check('rival panel: fighting beside you', /Fighting beside you/.test(await p.textContent('.hud-rivals')));

// hostile sapper: charge intent
await edit("s.delve.rivals.stance = 'hostile'; s.delve.rivals.members[2].intent = { kind: 'charge', to: s.delve.heroes[0].at };");
await p.waitForTimeout(150);
check('charge intent drawn', !!(await p.$('.intent-charge')));

// events: deal, betrayed, stance
await crewScene('neutral');
await spyLog();
await p.evaluate(() => window.vc.send({ type: 'deal', heroId: 'keven', deal: 'hire' }));
await p.waitForTimeout(300);
check('hire deal: one log line', /fight beside you/.test(await lines()) && (await lines()).split('\n').length === 1, (await lines()).replace(/\n/g, ' / '));

// ---- game over
await edit("s.stage = 'over'; s.delve = null;");
await p.waitForTimeout(150);
check('game over: "The heir has fallen. Valkenburg stays dark."', /The heir has fallen\. Valkenburg stays dark\./.test(await text()));

console.log(`\n${failed} failed, ${errors} console errors`);
await b.close();
process.exit(failed || errors ? 1 : 0);
