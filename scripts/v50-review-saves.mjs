// V5.0 review (session three, docs/v5-ship.md check 4): saves made by the live V4.1 game (main, served separately) load on
// v5.0 and play a turn: a camp save, a mid-delve save with a crew present, a save paused at a reaction question
// (delve.pending). The saves are written by the app itself (window.vc.send saves after every command) under the real key.
//   node scripts/v50-review-saves.mjs <v41 url> <v50 url>     (defaults http://localhost:4186/ and http://localhost:4185/)
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';

const [OLD = 'http://localhost:4186/', NEW = 'http://localhost:4185/'] = process.argv.slice(2);
const KEY = 'vc.save.v39';
const SLOW = 180000;
let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`); };
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

async function page(url, tag) {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  p.setDefaultTimeout(SLOW);
  p.errors = 0;
  p.on('pageerror', (e) => (p.errors++, console.log(`[${tag} pageerror]`, e.message)));
  p.on('console', (m) => m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource/.test(m.text()) && (p.errors++, console.log(`[${tag} console]`, m.text())));
  await p.route(/fonts\./, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await p.goto(url);
  await p.evaluate(() => { localStorage.clear(); localStorage.setItem('vc.welcome.v40', '1'); localStorage.setItem('vc.settings', JSON.stringify({ speed: 0, reduceShake: true, noEndTurnAsk: true, quality: 'low', autoEndTurn: false })); });
  await p.reload();
  await p.waitForFunction(() => !!window.vc && !!window.vcEngine);
  return p;
}
const idle = (p) => p.waitForFunction(() => window.vc && !window.vc.busy(), null, { timeout: SLOW });

// ---- on V4.1 (main): three saves
console.log(`== V4.1 at ${OLD}`);
const old = await page(OLD, 'v41');
const saves = {};
// 1. a camp save: a new campaign, a hire, a torch and a potion bought.
saves.camp = await old.evaluate(async (KEY) => {
  const E = window.vcEngine;
  const s = E.newGame(7);
  window.vc.load(s);
  await window.vc.send({ type: 'hire', heroId: window.vc.state().campaign.recruits[0].hero.id });
  await window.vc.send({ type: 'buy', kind: 'torch' });
  return { raw: localStorage.getItem(KEY), gold: window.vc.state().campaign.gold, roster: window.vc.state().campaign.roster.length };
}, KEY);
check('V4.1 wrote a camp save under vc.save.v39', !!saves.camp.raw, `gold ${saves.camp.gold}, roster ${saves.camp.roster}`);
// 2. mid-delve, the Lantern Sisters present, after one move (the crew has entered).
saves.delve = await old.evaluate(async (KEY) => {
  const E = window.vcEngine;
  for (let seed = 1; seed < 60; seed++) {
    const s = E.newGame(seed);
    s.campaign.gold = 400;
    window.vc.load(s);
    for (const r of window.vc.state().campaign.recruits.slice(0, 2)) await window.vc.send({ type: 'hire', heroId: r.hero.id });
    await window.vc.send({ type: 'buy', kind: 'torch' });
    const st = window.vc.state();
    const ids = st.campaign.roster.slice(0, 3).map((h) => h.id);
    const k = st.campaign.board.find((x) => x.kind === 'recover' && !x.story) ?? st.campaign.board[0];
    await window.vc.send({ type: 'startDelve', contractId: k.id, heroIds: ids, entrance: 0, packs: { [ids[0]]: st.campaign.stash.map((i) => i.id).slice(0, 1) } });
    const d = window.vc.state().delve;
    if (!d?.rivals) continue;
    // Make the crew present on the map now (entered), then take one real move so the save is mid-turn.
    const s2 = structuredClone(window.vc.state());
    s2.delve.rivals.entersRound = 0;
    s2.delve.rivals.entered = true;
    window.vc.load(s2);
    const h = s2.delve.heroes[0];
    const r = window.vcEngine.reachable(window.vc.state(), h.heroId, false).filter((x) => x.cost <= 2);
    if (r.length) await window.vc.send({ type: 'move', heroId: h.heroId, path: r[0].path, sneak: false });
    await window.vc.send({ type: 'endTurn' });
    const st2 = window.vc.state();
    return { seed, raw: localStorage.getItem(KEY), round: st2.delve.round, crew: st2.delve.rivals?.name, members: st2.delve.rivals?.members.length, stance: st2.delve.rivals?.stance };
  }
  return null;
}, KEY);
check('V4.1 wrote a mid-delve save with a crew on the map', !!saves.delve?.raw && saves.delve.members > 0, JSON.stringify({ seed: saves.delve?.seed, round: saves.delve?.round, crew: saves.delve?.crew, members: saves.delve?.members, stance: saves.delve?.stance }));
// 3. paused at an overwatch question (delve.pending): a hero on overwatch, a hunting orc a few hexes off; End turn.
saves.pending = await old.evaluate(async (KEY) => {
  const E = window.vcEngine;
  const base = structuredClone(window.vc.state());
  const d0 = base.delve;
  const h0 = d0.heroes.find((x) => x.status === 'active');
  const vis = E.visibility(base).visible;
  const orc = d0.monsters.find((m) => m.kind === 'orc' && m.hp > 0);
  const dist = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
  const spots = [...vis].map((k) => { const [lv, q, r] = k.split(/[:,]/).map(Number); return { level: lv, q, r }; }).filter((x) => x.level === h0.at.level && dist(x, h0.at) >= 2 && dist(x, h0.at) <= 4);
  for (const at of spots) {
    const s = structuredClone(base);
    const d = s.delve;
    d.monsters = d.monsters.filter((m) => m.id === orc.id);
    const h = d.heroes.find((x) => x.heroId === h0.heroId);
    h.overwatch = true; h.acted = true; h.moved = true; h.facing = undefined; h.reactions = {};
    for (const x of d.heroes) if (x !== h) { x.moved = true; x.acted = true; }
    const m = d.monsters[0];
    m.at = { ...at }; m.awareness = 'hunting'; m.noticedIds = d.heroes.map((x) => x.heroId); m.hp = 99;
    if (d.heroes.some((x) => x.at.level === at.level && x.at.q === at.q && x.at.r === at.r)) continue;
    const r = E.apply(s, { type: 'endTurn' });
    if (r.state.delve?.pending?.question.kind === 'overwatch') {
      window.vc.load(s);
      window.__endDone = false;
      void window.vc.send({ type: 'endTurn' }).then(() => (window.__endDone = true));
      await new Promise((res) => { const t = () => { const r2 = document.querySelector('.dl-react'); if (r2 && !r2.classList.contains('hidden')) return res(); setTimeout(t, 50); }; t(); });
      const raw = localStorage.getItem(KEY);
      return { raw, pending: !!JSON.parse(raw).delve?.pending, kind: JSON.parse(raw).delve?.pending?.question?.kind, text: JSON.parse(raw).delve?.pending?.question?.text };
    }
  }
  return null;
}, KEY);
check('V4.1 wrote a save paused at an overwatch question (delve.pending)', !!saves.pending?.raw && saves.pending.pending && saves.pending.kind === 'overwatch', saves.pending?.text ?? 'no scene');
check('V4.1 page: 0 page errors', old.errors === 0);
await old.close();

// ---- on v5.0: each save loads from localStorage through the app's own boot, and plays
console.log(`\n== v5.0 at ${NEW}`);
async function loadOn(raw) {
  const p = await page(NEW, 'v50');
  await p.evaluate((x) => localStorage.setItem('vc.save.v39', x.raw), { raw });
  await p.reload();
  await p.waitForFunction(() => !!window.vc && !!window.vcEngine);
  // The title screen offers Continue when a save exists: the real path a play-tester takes.
  const btn = await p.$('button[data-continue]'); // V5.2: the title's campaign card
  const label = btn ? await btn.innerText() : '';
  check('the title screen offers Continue for the save', /^Continue/.test(label), label || 'no primary button');
  if (btn) await btn.click();
  await p.waitForTimeout(600);
  return p;
}
{
  const p = await loadOn(saves.camp.raw);
  const st = await p.evaluate(() => { const s = window.vc.state(); return s ? { stage: s.stage, gold: s.campaign.gold, roster: s.campaign.roster.length, slots: s.campaign.squadSlots, title: document.body.innerText.includes('Lowgate') || !!document.querySelector('.lg-page, .dl-camp, .camp') } : null; });
  check('the camp save loads on v5.0: stage camp, same gold and roster; the camp screen shows', !!st && st.stage === 'camp' && st.gold === saves.camp.gold && st.roster === saves.camp.roster, JSON.stringify(st));
  // Play: start a delve from it and take a move.
  const played = await p.evaluate(async () => {
    const st = window.vc.state();
    const ids = st.campaign.roster.map((h) => h.id);
    const k = st.campaign.board[0];
    await window.vc.send({ type: 'startDelve', contractId: k.id, heroIds: ids, entrance: 0, packs: {} });
    const s = window.vc.state();
    if (s.stage !== 'delve') return { stage: s.stage };
    const h = s.delve.heroes[0];
    const r = window.vcEngine.reachable(s, h.heroId, false).filter((x) => x.cost <= 2);
    await window.vc.send({ type: 'move', heroId: h.heroId, path: r[0].path, sneak: false });
    return { stage: window.vc.state().stage, moved: window.vc.state().delve.heroes[0].moved, round: window.vc.state().delve.round };
  });
  await idle(p);
  check('...a delve starts from it and a hero moves', played.stage === 'delve' && played.moved === true, JSON.stringify(played));
  check('...0 page errors', p.errors === 0);
  await p.close();
}
if (saves.delve?.raw) {
  const p = await loadOn(saves.delve.raw);
  const st = await p.evaluate(() => { const s = window.vc.state(); return s ? { stage: s.stage, round: s.delve?.round, crew: s.delve?.rivals?.name, members: s.delve?.rivals?.members.length, stance: s.delve?.rivals?.stance, letBy: s.delve?.rivals?.letBy, hud: !document.querySelector('.dl-hud')?.classList.contains('hidden'), cards: document.querySelectorAll('.dl-rcard').length, crewFigures: [...(window.vc.dio.units?.values?.() ?? [])].filter((u) => u.side === 'rival').length } : null; });
  check('the mid-delve save (crew present) loads on v5.0: the delve, the crew and its members, the HUD up', !!st && st.stage === 'delve' && st.round === saves.delve.round && st.crew === saves.delve.crew && st.members === saves.delve.members && st.hud && st.cards === 3, JSON.stringify(st));
  const played = await p.evaluate(async () => {
    const s = window.vc.state();
    const h = s.delve.heroes.find((x) => x.status === 'active' && !x.moved);
    const r = window.vcEngine.reachable(s, h.heroId, false).filter((x) => x.cost <= 2);
    await window.vc.send({ type: 'move', heroId: h.heroId, path: r[0].path, sneak: false });
    window.__endDone = false;
    void window.vc.send({ type: 'endTurn' }).then(() => (window.__endDone = true));
    await new Promise((res) => { const t = () => { const r2 = document.querySelector('.dl-react'); if (r2 && !r2.classList.contains('hidden')) r2.querySelector('[data-choice="yes"]')?.click(); window.__endDone ? res() : setTimeout(t, 50); }; t(); });
    const s2 = window.vc.state();
    return { round: s2.delve?.round, phase: s2.delve?.phase, stage: s2.stage, crew: s2.delve?.rivals?.stance };
  });
  await idle(p);
  check('...a move and a full castle turn play on v5.0 with the crew about', played.stage === 'delve' && played.round === saves.delve.round + 1 && played.phase === 'player', JSON.stringify(played));
  check('...0 page errors', p.errors === 0);
  await p.close();
}
if (saves.pending?.raw) {
  const p = await page(NEW, 'v50');
  await p.evaluate((x) => { localStorage.setItem('vc.save.v39', x.raw); }, { raw: saves.pending.raw });
  await p.reload();
  await p.waitForFunction(() => !!window.vc && !!window.vcEngine);
  await p.evaluate(() => { window.__keepReact = true; });
  const btn = await p.$('button[data-continue]');
  if (btn) await btn.click();
  const up = await p.waitForFunction(() => { const r = document.querySelector('.dl-react'); return r && !r.classList.contains('hidden'); }, null, { timeout: 60000 }).then(() => true).catch(() => false);
  const card = await p.evaluate(() => ({ text: document.querySelector('.dl-react')?.innerText.replace(/\n/g, ' | ') ?? '', pending: window.vc.state()?.delve?.pending?.question?.kind, busy: window.vc.busy() }));
  check('the V4.1 save paused at a question loads on v5.0: the castle\'s turn plays up to it and asks again', up && card.pending === 'overwatch' && card.text.includes(saves.pending.text), card.text.slice(0, 160) || JSON.stringify(card));
  await p.keyboard.press('1');
  await idle(p);
  const after = await p.evaluate(() => { const s = window.vc.state(); return { pending: !!s.delve?.pending, phase: s.delve?.phase, round: s.delve?.round }; });
  check('...answering plays the turn on to the next round', !after.pending && after.phase === 'player', JSON.stringify(after));
  check('...0 page errors', p.errors === 0);
  await p.close();
}

console.log(`\n${failed ? `${failed} FAILED` : 'all passed'}`);
await b.close();
process.exit(failed ? 1 : 0);
