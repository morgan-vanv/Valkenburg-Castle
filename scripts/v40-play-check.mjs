// V4.0 play-test fixes check (spec 26), headless, by DOM and state, no screenshots (real engine only):
// Walk/Sneak is per hero (a Burglar starts on Sneak, everyone else on Walk; the toggle and S change only
// the selected hero; selecting another hero shows theirs; a Sneak badge on the card of a hero set to
// sneak), and noticing happens during the move: the notice (state and log line) is there right after a
// move command, before End turn. No page errors.
//   node scripts/v40-play-check.mjs <baseUrl>
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';

const [base = 'http://localhost:4177/'] = process.argv.slice(2);
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

await p.goto(base);
await p.evaluate(() => { localStorage.clear(); localStorage.setItem('vc.settings', JSON.stringify({ speed: 0, reduceShake: true, noEndTurnAsk: true })); });
await p.reload();
await p.waitForFunction(() => !!window.vc);

// A delve with Keven and a hired Burglar (the first seed whose campfire offers one).
const burglar = await p.evaluate(() => {
  const E = window.vcEngine;
  for (let seed = 1; seed < 200; seed++) {
    let s = E.newGame(seed);
    const r = s.campaign.recruits.find((x) => x.hero.cls === 'burglar' && x.price <= s.campaign.gold);
    if (!r) continue;
    s = E.apply(s, { type: 'hire', heroId: r.hero.id }).state;
    const k = s.campaign.board.find((x) => x.level === 1) ?? s.campaign.board[0];
    const res = E.apply(s, { type: 'startDelve', contractId: k.id, heroIds: ['keven', r.hero.id], entrance: 0, packs: {} });
    if (res.error) continue;
    window.vc.load(res.state);
    return r.hero.id;
  }
  return null;
});
check('a delve with Keven and a Burglar', !!burglar, burglar ?? 'no seed offered a Burglar');
if (!burglar) process.exit(1);
await p.waitForSelector('.bar-modes');

const mode = (id) => p.evaluate((x) => window.vc.state().delve.heroes.find((h) => h.heroId === x).moveMode, id);
const buttons = () => p.$$eval('.bar-modes button', (els) => els.map((e) => `${e.textContent.trim().split(' ')[0]}:${e.classList.contains('on') ? 'on' : 'off'}`).join(' '));
const select = async (id) => { await p.evaluate((x) => window.vc.hud.select(x), id); await p.waitForTimeout(80); };
const badge = (id) => p.$(`.hcard[data-hero="${id}"] .chip.sneak`);

// ---- 26.1 Walk/Sneak per hero
check('the Burglar starts on Sneak, Keven on Walk (engine state)', (await mode(burglar)) === 'sneak' && (await mode('keven')) === 'walk');
await select('keven');
check('Keven selected: Walk is on', /Walk:on/.test(await buttons()) && /Sneak:off/.test(await buttons()), await buttons());
check('the Burglar\'s card shows the Sneak badge, Keven\'s none', !!(await badge(burglar)) && !(await badge('keven')));
const tip = await p.$eval(`.hcard[data-hero="${burglar}"] .chip.sneak`, (e) => e.title).catch(() => '');
check('the badge explains itself on hover', /set to Sneak/.test(tip) && /own Walk\/Sneak/.test(tip), tip.split('\n')[0]);
await p.keyboard.press('s');
await p.waitForTimeout(120);
check('S sets Keven to Sneak', (await mode('keven')) === 'sneak' && /Sneak:on/.test(await buttons()), await buttons());
check('...and only Keven: the Burglar is unchanged', (await mode(burglar)) === 'sneak');
check('Keven\'s card shows the badge now', !!(await badge('keven')));
check('the move preview follows Keven\'s setting (reach 2)', await p.evaluate(() => Math.max(...window.vcEngine.reachable(window.vc.state(), 'keven').map((r) => r.cost)) === 2));
await select(burglar);
await p.click('.bar-modes button:first-child'); // Walk
await p.waitForTimeout(120);
check('the Walk button sets the selected Burglar to Walk', (await mode(burglar)) === 'walk' && /Walk:on/.test(await buttons()), await buttons());
await select('keven');
check('selecting Keven again shows his own Sneak', /Sneak:on/.test(await buttons()) && (await mode('keven')) === 'sneak', await buttons());
await p.keyboard.press('s');
await p.waitForTimeout(120);
check('S again: Keven back on Walk', (await mode('keven')) === 'walk');
check('the setting survives a save (it is engine state)', await p.evaluate((x) => {
  const E = window.vcEngine;
  const back = E.deserialize(E.serialize(window.vc.state()));
  return back.delve.heroes.find((h) => h.heroId === x).moveMode === 'walk';
}, burglar));

// ---- 26.2 noticing during the move
// One awake monster, put where a move of Keven's (walking) would be noticed: the preview lists it.
const plan = await p.evaluate(() => {
  const E = window.vcEngine;
  const s0 = window.vc.state();
  const keven = s0.delve.heroes.find((h) => h.heroId === 'keven');
  const lv = E.castle().levels.find((l) => l.level === keven.at.level);
  const dist = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
  const vis = E.visibility(s0).visible;
  const taken = new Set([...s0.delve.heroes.map((h) => `${h.at.level}:${h.at.q},${h.at.r}`)]);
  const m0 = s0.delve.monsters.find((m) => m.kind !== 'dragon' && m.kind !== 'gloam');
  if (!m0) return null;
  for (const key of vis) {
    const [l, qr] = key.split(':');
    const [q, r] = qr.split(',').map(Number);
    const at = { level: Number(l), q, r };
    if (at.level !== keven.at.level || taken.has(key) || lv.tiles[`${q},${r}`]?.kind !== 'floor') continue;
    const d = dist(at, keven.at);
    if (d < 5 || d > 7) continue;
    const s = structuredClone(s0);
    const m = { ...structuredClone(m0), at, awareness: 'alert', facing: undefined, noticedIds: [], intent: { kind: 'wait' }, focusAt: undefined, route: undefined, buried: false };
    s.delve.monsters = [m];
    s.delve.rivals = null;
    s.delve.traps = {};
    const reach = E.reachable(s, 'keven').find((x) => x.risks?.notice.some((n) => n.id === m.id) && !x.dash);
    if (reach) return { s, path: reach.path, id: m.id, name: m.name, at: reach.risks.notice[0].at };
  }
  return null;
});
check('found a spot where a walk of Keven\'s gets noticed (the preview says so)', !!plan);
if (plan) {
  await p.evaluate((x) => window.vc.load(x.s), plan);
  await select('keven');
  const round = await p.evaluate(() => window.vc.state().delve.round);
  // The HUD's live log lines show while the command plays back (the next render keeps only the engine's log): record them.
  await p.evaluate(() => {
    window.__lines = [];
    new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => window.__lines.push(n.textContent)))).observe(document.querySelector('.hud-log'), { childList: true });
  });
  await p.evaluate((x) => window.vc.send({ type: 'move', heroId: 'keven', path: x.path }), plan);
  await p.waitForFunction(() => !window.vc.busy());
  const after = await p.evaluate((id) => {
    const d = window.vc.state().delve;
    const m = d.monsters.find((x) => x.id === id);
    return { phase: d.phase, round: d.round, awareness: m?.awareness, noticed: m?.noticedIds ?? [], intent: m?.intent };
  }, plan.id);
  check('right after the move, still the player phase of the same round', after.phase === 'player' && after.round === round, `${after.phase} ${after.round}`);
  check('the monster has noticed Keven and hunts him', after.noticed.includes('keven') && after.awareness === 'hunting', `${after.awareness} [${after.noticed}]`);
  check('its intent for the coming castle turn is re-planned at Keven', after.intent?.targetId === 'keven', JSON.stringify(after.intent));
  const lines = await p.evaluate(() => window.__lines);
  check('the log line "… notices Keven!" plays with the move, before End turn', lines.some((l) => /notices Keven!/.test(l)), lines.filter((l) => /notices/.test(l)).join(' | '));
  check('Keven finished the move', await p.evaluate((x) => { const h = window.vc.state().delve.heroes.find((y) => y.heroId === 'keven'); const e = x.path[x.path.length - 1]; return h.at.q === e.q && h.at.r === e.r && h.at.level === e.level; }, plan));
}

console.log(`\n${failed ? `${failed} FAILED` : 'all passed'}, ${errors} page errors`);
await b.close();
process.exit(failed || errors ? 1 : 0);
