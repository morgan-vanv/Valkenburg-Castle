// V3.6 presentation check (spec 19), headless, by DOM text and state, no screenshots unless asked:
// exit markers once explored (the entrance says you came in here), "Leave the castle" in the bar
// with hotkey Q when a hero stands on a way out, the goal box switching to "Get out: nearest way
// out is ..." once the heirloom is held, exit tags going gold, the hint naming the way out, the
// night-eye badge and action, lockpicks text in the pack and on the peddler's wagon, the 19.2 locked
// hover text, story briefs on the cards; no console errors. (V4.0: the Lowgate who-is-where panel is gone.)
//   node scripts/v36-ui-check.mjs <baseUrl>          (http://localhost:5183/?fixture=1 until the engine lands)
//   SHOTS=<dir> saves two shots: a hero on an exit before and after the heirloom is picked up.
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';

const [base = 'http://localhost:5183/?fixture=1'] = process.argv.slice(2);
const shots = process.env.SHOTS ?? '';
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
const hoverTip = (at) => p.evaluate((a) => { window.vc.hud.onHover(a, null); const t = document.querySelector('.hud-tip')?.textContent ?? ''; window.vc.hud.onHover(null, null); return t; }, at);
const visibleTags = (sel) => p.$$eval(sel, (els) => els.filter((e) => e.style.display !== 'none' && !e.classList.contains('hidden')).map((e) => ({ text: e.textContent, cls: e.className })));
const fixture = /fixture=1/.test(base);

await p.goto(base);
await p.evaluate(() => { localStorage.clear(); localStorage.setItem('vc.settings', JSON.stringify({ speed: 0, reduceShake: true, noEndTurnAsk: true })); });
await p.reload();
await p.waitForFunction(() => !!window.vc);

// ---- camp: a new campaign, then the peddler and the notice post
await p.evaluate(() => { const E = window.vcEngine; window.vc.load(E.apply(E.newGame(42), { type: 'newCampaign', seed: 42 }).state); });
await p.waitForTimeout(150);
// V4.0: the who-is-where panel is gone (owner); the story card keeps the brief, the wagon the rule text on hover.
const card = await p.$eval('.lg-card.story[data-story="surgeon"]', (e) => e.innerText).catch(() => '');
check('story card shows the one-line reason from the contract brief', /physic garden|chapel/i.test(card), card.slice(0, 80));
await p.click('.lg-step[data-step="outfit"]');
await p.waitForTimeout(120);
check('the wagon hides lockpicks behind the metalwork tile until the smith is home', !(await p.$('[data-ware="lockpicks"]')) && !!(await p.$('[data-ware="metalwork"]')));
check('the night-eye draught is not sold until Wim is home (locked stays quiet)', !(await p.$('[data-ware="nightsight"]')));
await edit("Object.assign(s.campaign.village, { smith: true, innkeeper: true });");
const picks = await p.$eval('[data-ware="lockpicks"]', (e) => e.dataset.tip).catch(() => '');
check('with the smith home: lockpicks on the wagon, the 21.4 rule on hover', /Proper picks, never used up\. A Burglar picks at 3 Finesse slots, anyone else at 2\./.test(picks), picks.slice(0, 80));
const night = await p.$eval('[data-ware="nightsight"]', (e) => e.dataset.tip).catch(() => '');
check('with Wim home: the night-eye draught on the wagon, its rule on hover', /Drink: 8 rounds without dark penalties/.test(night), night.slice(0, 80));
await edit("Object.assign(s.campaign.village, { smith: false, innkeeper: false });");

// ---- into the castle (the real engine starts Keven alone: hire until the party is big enough)
await p.evaluate(async () => {
  const E = window.vcEngine;
  for (let i = 0; i < 3; i++) {
    const s = window.vc.state();
    const ids = s.campaign.roster.slice(0, 4).map((h) => h.id);
    if (!E.partyProblem(s, ids) && s.campaign.roster.length >= 2) break;
    const r = s.campaign.recruits.find((x) => x.price <= s.campaign.gold);
    if (!r) break;
    await window.vc.send({ type: 'hire', heroId: r.hero.id });
  }
});
await p.evaluate(() => {
  const s = window.vc.state();
  const k = s.campaign.board.find((x) => x.kind === 'recover' && !x.story) ?? s.campaign.board[0];
  const heroIds = s.campaign.roster.slice(0, 4).map((h) => h.id);
  return window.vc.send({ type: 'startDelve', contractId: k.id, heroIds, entrance: 0, packs: {} });
});
await idle();
await p.waitForTimeout(300);
const castle = await p.evaluate(() => window.vcEngine.castle());
const entrance = castle.entrances[0];
const d0 = await p.evaluate(() => window.vc.state().delve);
check('in the delve', !!d0);
const hero = d0.heroes[0];
await p.evaluate((id) => window.vc.hud.select(id), hero.heroId);
await p.waitForTimeout(150);

// exit markers
let tags = await visibleTags('.exit-tag');
check('a "Way out" marker shows over the explored entrance', tags.some((t) => /Way out/.test(t.text)), JSON.stringify(tags));
check('the entrance marker says you came in here', tags.some((t) => /you came in here/.test(t.text) && /entrance/.test(t.cls)));
check('no exit marker is gold before the prize is in hand', !tags.some((t) => /\bgo\b/.test(t.cls)));

// hover the entrance
let tip = await hoverTip(entrance);
check('exit hover: "Way out · stand here, then Leave the castle"', /Way out/.test(tip) && /stand here, then Leave the castle/.test(tip), tip.slice(0, 90));

// stand the hero on the entrance
await edit(`const h = s.delve.heroes.find((x) => x.heroId === a.id); h.at = a.at; h.moved = false; h.acted = false; s.delve.heroes.forEach((o) => { if (o !== h && o.at.q === a.at.q && o.at.r === a.at.r && o.at.level === a.at.level) o.at = { ...a.at, q: a.at.q + 1 }; });`, { id: hero.heroId, at: entrance });
await p.evaluate((id) => window.vc.hud.select(id), hero.heroId);
await p.waitForTimeout(200);
let leave = await p.$('.hud-bar .act.act-leave');
check('"Leave the castle" button in the bar when standing on a way out', !!leave);
check('...with hotkey Q, in the Move group', !!leave && (await leave.evaluate((e) => e.querySelector('kbd')?.textContent === 'Q' && e.dataset.key === 'q' && !!e.closest('.bar-group'))));
check('...and no second plain Leave button', (await p.$$('.hud-bar [data-action="leave"]')).length === 1);
check('the exit hex pulses (showExitPulse visible)', await p.evaluate(() => window.vc.dio.exitPulse?.visible === true));
tip = await hoverTip(entrance);
check('hover on your own exit hex says Click: Leave the castle', /Click: Leave the castle/.test(tip), tip.slice(0, 120));
const goal0 = await p.$eval('.hud-goal', (e) => e.innerText);
check('goal box still names the objective before the prize is held', !/Get out/.test(goal0), goal0.replace(/\n/g, ' | '));
let hint = await p.$eval('.hud-hint', (e) => e.innerText).catch(() => '');
check('hint names the way out here', /Way out/.test(hint) && /here/.test(hint), hint);
if (shots) await p.screenshot({ path: `${shots}/v36-exit-before.png` });

// the heirloom goes into the pack
await edit(`const h = s.delve.heroes.find((x) => x.heroId === a); const g = s.delve.ground.find((x) => x.items.some((i) => i.kind === 'heirloom')); if (g) { h.pack.push(...g.items.filter((i) => i.kind === 'heirloom')); g.items = g.items.filter((i) => i.kind !== 'heirloom'); } else h.pack.push({ id: 'hx', kind: 'heirloom', name: 'the Valkenburg Signet', amount: 60, slots: 2, contractId: s.delve.contract.id });`, hero.heroId);
await p.evaluate((id) => window.vc.hud.select(id), hero.heroId);
await p.waitForTimeout(200);
const goal1 = await p.$eval('.hud-goal', (e) => e.innerText);
check('goal box switches to "Get out: nearest way out is the main gate, here"', /Get out: nearest way out is the main gate, here/.test(goal1), goal1.replace(/\n/g, ' | '));
check('the goal line is a click-to-pan button naming the exit hex', await p.$eval('.goal-where.goal-out', (e) => e.tagName === 'BUTTON' && !!e.dataset.exit));
tags = await visibleTags('.exit-tag');
check('known exit markers go gold (.go) once the prize is in hand', tags.length > 0 && tags.every((t) => /\bgo\b/.test(t.cls)), JSON.stringify(tags));
check('soft rings on known exits', await p.evaluate(() => window.vc.dio.exitRings?.children.length > 0));
if (shots) await p.screenshot({ path: `${shots}/v36-exit-after.png` });

// walk away: the count changes and the hint leads with the way out
const far = await p.evaluate((e) => {
  const c = window.vcEngine.castle();
  const lv = c.levels.find((l) => l.level === e.level);
  const dist = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
  const floors = Object.entries(lv.tiles).filter(([, t]) => t.kind === 'floor').map(([k]) => { const [q, r] = k.split(',').map(Number); return { level: e.level, q, r }; });
  return floors.filter((p) => dist(p, e) >= 5 && dist(p, e) <= 7).sort((a, b) => dist(a, e) - dist(b, e))[0];
}, entrance);
await edit(`const h = s.delve.heroes.find((x) => x.heroId === a.id); h.at = a.at;`, { id: hero.heroId, at: far });
await p.evaluate((id) => window.vc.hud.select(id), hero.heroId);
await p.waitForTimeout(200);
const goal2 = await p.$eval('.hud-goal', (e) => e.innerText);
check('away from the exit the goal counts hexes', /Get out: nearest way out is the main gate, [5-7] hexes/.test(goal2), goal2.replace(/\n/g, ' | '));
hint = await p.$eval('.hud-hint', (e) => e.innerText).catch(() => '');
check('the hint leads with the way out', /^(In the dark[^·]*·\s*)?Way out/.test(hint.trim()), hint);
check('no "Leave the castle" button off the exit', !(await p.$('.hud-bar .act.act-leave')));
await p.click('.goal-where.goal-out');
await p.waitForTimeout(100);

// Give the party the new things when the state has none (the real engine's packs start as bought).
await edit(`const hs = s.delve.heroes.filter((x) => x.status === 'active');
  const defs = s.campaign.roster;
  const cls = (h) => defs.find((d) => d.id === h.heroId)?.cls;
  if (!hs.some((h) => h.pack.some((i) => i.kind === 'lockpicks'))) { const h = hs.find((x) => cls(x) !== 'burglar' && x.heroId !== a); if (h) h.pack.push({ id: 'lp1', kind: 'lockpicks', name: 'Lockpicks', amount: 1, slots: 1 }); }
  if (!hs.some((h) => h.pack.some((i) => i.kind === 'nightsight'))) { const h = hs.find((x) => x.heroId === a) ?? hs[0]; if (h) h.pack.push({ id: 'ns1', kind: 'nightsight', name: 'Night-eye draught', amount: 1, slots: 1 }); }
  if (!hs.some((h) => h.nightEyes > 0)) { const h = hs.find((x) => x.heroId !== a) ?? hs[0]; if (h) h.nightEyes = 5; }`, hero.heroId);
const d1 = await p.evaluate(() => window.vc.state().delve);

// 19.2 locked hover text: a hero without Pick, then one with lockpicks
const lockedDoor = await p.evaluate(() => {
  const s = window.vc.state();
  const k = Object.entries(s.delve.doors).find(([, d]) => d.locked && !d.open)?.[0];
  if (!k) return null;
  const [lv, rest] = k.split(':');
  const [q, r] = rest.split(',').map(Number);
  return { level: Number(lv), q, r };
});
if (lockedDoor) {
  await edit(`s.delve.explored.push(a);`, `${lockedDoor.level}:${lockedDoor.q},${lockedDoor.r}`);
  const classes = await p.evaluate(() => Object.fromEntries(window.vc.state().campaign.roster.map((h) => [h.id, h.cls])));
  const noPicks = d1.heroes.find((x) => x.status === 'active' && !x.pack.some((i) => i.kind === 'lockpicks' || i.kind === 'improvised') && classes[x.heroId] !== 'burglar');
  if (noPicks) {
    await p.evaluate((id) => window.vc.hud.select(id), noPicks.heroId);
    await p.waitForTimeout(100);
    tip = await hoverTip(lockedDoor);
    check('locked door hover for a hero without picks: "Smash it ..., or pick it with lockpicks"', /Locked door/.test(tip) && /Smash it.*or pick it with lockpicks/.test(tip), tip.slice(0, 120));
  } else console.log('skip: everyone active is a Burglar or carries lockpicks');
  const withPicks = d1.heroes.find((x) => x.pack.some((i) => i.kind === 'lockpicks'));
  if (withPicks) {
    await p.evaluate((id) => window.vc.hud.select(id), withPicks.heroId);
    await p.waitForTimeout(100);
    tip = await hoverTip(lockedDoor);
    check('locked door hover for a hero carrying lockpicks offers Pick', /Locked door/.test(tip) && /Pick, Smash/.test(tip), tip.slice(0, 120));
  } else console.log('skip: nobody carries lockpicks in this state');
} else console.log('skip: no locked door in this state');

// 19.3 night-eye badge and action
const nightHero = d1.heroes.find((x) => x.nightEyes > 0);
if (nightHero) {
  const chip = await p.$eval(`.hcard[data-hero="${nightHero.heroId}"] .chip.night`, (e) => ({ text: e.textContent, title: e.title })).catch(() => null);
  check('hero card shows "Night-eye · n" with a tooltip', !!chip && new RegExp(`Night-eye · ${nightHero.nightEyes}`).test(chip.text) && /without dark penalties/.test(chip.title), chip?.text);
} else console.log('skip: nobody has night-eye running in this state');
const drinker = d1.heroes.find((x) => x.pack.some((i) => i.kind === 'nightsight'));
if (drinker) {
  const packTip = await p.$eval(`.hcard[data-hero="${drinker.heroId}"] .pk-item[title*="Night-eye"], .hcard[data-hero="${drinker.heroId}"] [title*="Night-eye"]`, (e) => e.title).catch(() => '');
  check('pack tooltip for the draught has the 19.3 text', /8 rounds without dark penalties/.test(packTip), packTip.slice(0, 80));
  await edit(`const h = s.delve.heroes.find((x) => x.heroId === a); h.acted = false; h.moved = false;`, drinker.heroId);
  await p.evaluate((id) => window.vc.hud.select(id), drinker.heroId);
  await p.waitForTimeout(150);
  const btn = await p.$('.hud-bar .bar-group-items .act[data-action="nightsight"]');
  check('Night-eye draught button in the Items group', !!btn, (await p.$$eval('.hud-bar .act', (els) => els.map((e) => e.dataset.action))).join(','));
  if (btn) {
    await btn.click();
    await idle();
    await p.waitForTimeout(200);
    const after = await p.evaluate((id) => window.vc.state().delve.heroes.find((x) => x.heroId === id), drinker.heroId);
    check('drinking sets night-eye to 8 and the badge shows it', after.nightEyes === 8 && !!(await p.$(`.hcard[data-hero="${drinker.heroId}"] .chip.night`)), `nightEyes=${after.nightEyes}`);
  }
} else console.log('skip: nobody carries a night-eye draught in this state');

// leave for real
await edit(`const h = s.delve.heroes.find((x) => x.heroId === a.id); h.at = a.at; h.moved = false; h.acted = false;`, { id: hero.heroId, at: entrance });
await p.evaluate((id) => window.vc.hud.select(id), hero.heroId);
await p.waitForTimeout(150);
await p.keyboard.press('q');
await idle();
await p.waitForTimeout(300);
const st = await p.evaluate(() => window.vc.state());
const outHero = st.delve?.heroes.find((x) => x.heroId === hero.heroId);
check('pressing Q leaves: the hero is out (or the delve ended)', !st.delve || outHero?.status === 'out', `stage=${st.stage} status=${outHero?.status}`);

console.log(`\n${failed ? `${failed} FAILED` : 'all passed'}, ${errors} console error(s)${fixture ? ' (fixture engine)' : ''}`);
await b.close();
process.exit(failed || errors ? 1 : 0);
