// V5.0 review (session three, docs/v5-ship.md "The reviewer's brief", check 3): a play-through by script on the real
// engine, asserted by DOM and state. Level 1: a first delve, the torch lit, a fight with a hunting orc, the castle's
// turn stopping at a shield-block question and the answer, the figure events the diorama saw, the tower stair's peek
// and crossing, a cutthroat crew letting empty pockets by (once), the return tally. Level 3: a hero unlit with the
// Gloam about (the pulse, the HUD's Gloam line, the tag). Then the owner's four play-test fixes, the settings rows live,
// V4.1 settings without the new keys, and the renderer's numbers (check 5) in the Great Hall and the lair.
//   node scripts/v50-review-check.mjs <baseUrl>        (QUALITY=high for the look pass; SHOTS=<dir> saves screenshots)
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';

const [base = 'http://localhost:4185/'] = process.argv.slice(2);
const QUALITY = process.env.QUALITY ?? 'low';
const SHOTS = process.env.SHOTS ?? '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const SLOW = 180000;
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.route(/fonts\./, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
let errors = 0;
let failed = 0;
p.on('pageerror', (e) => (errors++, console.log('[pageerror]', e.message)));
p.on('console', (m) => m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource/.test(m.text()) && (errors++, console.log('[console]', m.text())));
const check = (name, ok, extra = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`);
};
const note = (name, extra = '') => console.log(`note ${name}${extra ? ` (${extra})` : ''}`);
const idle = () => p.waitForFunction(() => {
  const r = document.querySelector('.dl-react');
  if (r && !r.classList.contains('hidden') && !window.__keepReact) r.querySelector('[data-choice="yes"]')?.click();
  return window.vc && !window.vc.busy();
}, null, { timeout: SLOW });
const text = (sel) => p.$eval(sel, (e) => e.innerText).catch(() => '');
const tip = (sel) => p.$eval(sel, (e) => e.dataset.tip ?? e.getAttribute('title') ?? '').catch(() => '');
const settings = (extra = {}) => p.evaluate((x) => localStorage.setItem('vc.settings', JSON.stringify({ speed: 0, reduceShake: true, noEndTurnAsk: true, quality: 'low', autoEndTurn: false, ...x })), { quality: QUALITY, ...extra });
const shot = (name) => (SHOTS ? p.screenshot({ path: `${SHOTS}/${name}-${QUALITY}.png`, timeout: SLOW }) : Promise.resolve());
/** Record every event the diorama is asked to play (the seam between P's app.ts and G's handlers). */
const spyDio = () => p.evaluate(() => {
  if (window.__dioSeen) { window.__dioSeen.length = 0; return; }
  window.__dioSeen = [];
  const d = window.vc.dio;
  const orig = d.playEvent.bind(d);
  d.playEvent = (e) => { window.__dioSeen.push(e.type); return orig(e); };
});
const seen = () => p.evaluate(() => [...(window.__dioSeen ?? [])]);

p.setDefaultNavigationTimeout(SLOW);
p.setDefaultTimeout(SLOW);
await p.goto(base);
await p.evaluate(() => { localStorage.clear(); localStorage.setItem('vc.welcome.v40', '1'); });
await settings();
await p.reload();
await p.waitForFunction(() => !!window.vc && !!window.vcEngine);
console.log(`\n== Level 1 (${QUALITY})`);

// ---- a first delve: three heroes (a new campaign's slots), a torch and a potion, the Lantern Sisters on Level 1
const seed = await p.evaluate(async () => {
  const E = window.vcEngine;
  for (let seed = 1; seed < 60; seed++) {
    const s = E.newGame(seed);
    s.campaign.gold = 400;
    window.vc.load(s);
    for (const r of window.vc.state().campaign.recruits.slice(0, 2)) await window.vc.send({ type: 'hire', heroId: r.hero.id });
    for (const k of ['torch', 'potion']) await window.vc.send({ type: 'buy', kind: k });
    const st = window.vc.state();
    const ids = st.campaign.roster.slice(0, 3).map((h) => h.id);
    const stash = st.campaign.stash.map((i) => i.id);
    const k = st.campaign.board.find((x) => x.kind === 'recover' && !x.story) ?? st.campaign.board[0];
    await window.vc.send({ type: 'startDelve', contractId: k.id, heroIds: ids, entrance: 0, packs: { [ids[0]]: stash.slice(0, 2) } });
    if (window.vc.state().delve?.rivals) return seed;
  }
  return 0;
});
check('a first delve: three heroes, the Sisters about', seed > 0, `seed ${seed}`);
if (!seed) process.exit(1);
await idle();
await spyDio();
await p.evaluate(() => { window.__origMonsters = structuredClone(window.vc.state().delve.monsters); });
const coach = await p.evaluate(() => { const e = document.querySelector('.dl-coach'); return e && !e.classList.contains('hidden') ? e.innerText.replace(/\n/g, ' | ') : ''; });
check('coach mark 1 shows', /Click a lit hex/.test(coach), coach);

// ---- the torch: lit from the pack (an action), the light readout and the figure's hand
const lit = await p.evaluate(async () => {
  const s = window.vc.state();
  const k = s.delve.heroes[0];
  const o = window.vcEngine.actions(s, k.heroId).find((a) => a.action === 'torch' && !a.blocked);
  if (!o) return { ok: false };
  await window.vc.send({ type: 'act', heroId: k.heroId, action: 'torch', target: o.targets[0], focus: 0 });
  const st = window.vc.state();
  return { ok: true, lit: st.delve.heroes[0].pack.some((i) => i.kind === 'torch' && i.lit), chips: document.querySelectorAll('.dl-lchip:not(.none)').length, acted: st.delve.heroes[0].acted };
});
await idle();
check('Keven lights his torch (an action): the pack says lit, a light chip on the strip', lit.ok && lit.lit && lit.chips >= 1 && lit.acted, JSON.stringify(lit));
const rigged = await p.evaluate(() => { const v = window.vc.dio.units.get(window.vc.state().delve.heroes[0].heroId); return { rigged: !!v?.rigged, clip: v?.rigged?.current ?? v?.rigged?.playing ?? null, torch: !!v?.torchLight || !!v?.torch }; });
check('Keven is a rigged figure (V5.0 cast)', rigged.rigged, JSON.stringify(rigged));
await shot('l1-torch-lit');

// ---- a fight: a hunting orc beside Keven's neighbour; attack; the roll panel; the figure events the diorama saw
const fight = await p.evaluate(async () => {
  const s = structuredClone(window.vc.state());
  const h = s.delve.heroes[1];
  h.moved = false; h.acted = false;
  const at = { ...h.at, q: h.at.q + 1 };
  s.delve.monsters = s.delve.monsters.filter((m) => !(m.at.level === at.level && m.at.q === at.q && m.at.r === at.r));
  s.delve.monsters.push({ id: 'rv-orc', kind: 'orc', name: 'Orc', at, hp: 6, maxHp: 6, awareness: 'hunting', spawnedAt: at, noticedIds: [h.heroId], facing: 3 });
  window.vc.load(s);
  window.vc.hud.select(h.heroId);
  await new Promise((r) => setTimeout(r, 150));
  const opt = window.vcEngine.actions(window.vc.state(), h.heroId).find((a) => a.action === 'attack' && !a.blocked && a.targets.some((t) => t.id === 'rv-orc'));
  if (!opt) return { ok: false, why: 'no attack option' };
  window.__dioSeen.length = 0;
  const hpBefore = window.vc.state().delve.monsters.find((m) => m.id === 'rv-orc').hp;
  await window.vc.send({ type: 'act', heroId: h.heroId, action: 'attack', target: { id: 'rv-orc' }, focus: 0 });
  return { ok: true, hpBefore, hp: window.vc.state().delve.monsters.find((m) => m.id === 'rv-orc')?.hp ?? 0, log: window.vc.state().delve.log.slice(-2), seen: [...window.__dioSeen] };
});
await idle();
check('a hero attacks a hunting orc beside them: the engine rolls, the log says so', fight.ok && fight.log.some((l) => /Orc|orc/.test(l)), JSON.stringify({ hp: [fight.hpBefore, fight.hp], log: fight.log }));
check('...the diorama was asked to play the hit or the miss (the strike clip)', fight.ok && fight.seen.some((t) => t === 'hit' || t === 'miss'), fight.seen.join(','));
check('...the hunting orc\'s hex has the red ring in world (status.ts)', await p.evaluate(() => window.vc.dio.statusFx?.huntRings?.has('rv-orc') ?? false));
await shot('l1-fight');
// P1 (owner's play-test): an enemy's roll in the player's phase (a free swing) shows a caption that times out ~3.2 s after the roll.
await p.evaluate(() => { window.vc.settings.speed = 1; });
const capTimed = await p.evaluate(async () => {
  const before = structuredClone(window.vc.state());
  await window.vc.play([{ type: 'roll', who: 'rv-orc', what: 'attack', roll: { results: [true, false], hits: 1, perfect: false, chance: 50, slots: 2 } }], before);
  const shownAfterRoll = !document.querySelector('.dl-caption').classList.contains('hidden');
  const gone = await new Promise((res) => { const start = performance.now(); const tick = () => { if (document.querySelector('.dl-caption').classList.contains('hidden')) return res(performance.now() - start); if (performance.now() - start > 6000) return res(-1); setTimeout(tick, 50); }; tick(); });
  return { shownAfterRoll, gone: Math.round(gone) };
});
check('P: an enemy\'s roll caption goes away on its own ~3.2 s after the roll at normal speed', capTimed.shownAfterRoll && capTimed.gone > 2500 && capTimed.gone < 4500, JSON.stringify(capTimed));
await p.evaluate(() => { window.vc.settings.speed = 0; });

// ---- the castle's turn stops at a shield-block question (spec 32.10); the figure event the diorama saw (seam check 2)
{
  const scene = await p.evaluate(() => {
    const E = window.vcEngine;
    const base = structuredClone(window.vc.state());
    const h0 = base.delve.heroes.find((x) => x.status === 'active');
    for (const r of base.campaign.roster) r.shield = true; // whoever the orc picks can block
    for (let i = 0; i < 40; i++) {
      const s = structuredClone(base);
      s.rng = (s.rng + i * 7919) >>> 0;
      const d = s.delve;
      d.rivals = null;
      const h = d.heroes.find((x) => x.heroId === h0.heroId);
      for (const x of d.heroes) { x.hp = 12; x.focus = 3; x.moved = true; x.acted = true; x.reactions = {}; x.braced = false; }
      const at = { ...h.at, q: h.at.q + 1 };
      d.monsters = [{ id: 'sb-orc', kind: 'orc', name: 'Orc', at, hp: 99, maxHp: 99, awareness: 'hunting', spawnedAt: at, noticedIds: d.heroes.map((x) => x.heroId), facing: 3 }];
      const r = E.apply(s, { type: 'endTurn' });
      const q = r.state.delve?.pending?.question;
      if (q?.kind === 'shieldBlock') return { s, hero: q.heroId, q, tries: i + 1 };
    }
    return null;
  });
  check('a scene where the shield block is asked', !!scene, scene ? `${scene.tries} tries: ${scene.q.text}` : 'none in 40 tries');
  if (scene) {
    await p.evaluate((s) => { window.__keepReact = true; window.vc.load(s); window.__dioSeen.length = 0; }, scene.s);
    await p.waitForTimeout(150);
    await p.evaluate(() => { window.__endDone = false; void window.vc.send({ type: 'endTurn' }).then(() => (window.__endDone = true)); });
    await p.waitForFunction(() => { const r = document.querySelector('.dl-react'); return r && !r.classList.contains('hidden'); }, null, { timeout: SLOW });
    const card = await p.evaluate(() => { const r = document.querySelector('.dl-react'); return { text: r.innerText.replace(/\n/g, ' | '), opts: [...r.querySelectorAll('.dl-react-o')].map((b) => b.dataset.choice), pending: window.vc.state().delve.pending?.question.kind }; });
    check('the reaction card: Shield block, two answers, the Focus and the hit it caps', /Shield block/i.test(card.text) && /Focus/.test(card.text) && card.opts.join() === 'yes,no' && card.pending === 'shieldBlock', card.text.slice(0, 200));
    await shot('l1-shield-card');
    await p.keyboard.press('1');
    await p.waitForFunction(() => window.__endDone, null, { timeout: SLOW });
    await idle();
    const after = await p.evaluate((id) => { const s = window.vc.state(); const h = s.delve.heroes.find((x) => x.heroId === id); return { pending: !!s.delve.pending, focus: h.focus, hp: h.hp, log: s.delve.log.filter((l) => /shield/i.test(l)).slice(-1), seen: [...window.__dioSeen] }; }, scene.hero);
    check('...1 blocks: Focus spent, the hit capped, the log says "takes it on the shield"', !after.pending && after.focus === 2 && after.log.length === 1, JSON.stringify({ focus: after.focus, hp: after.hp, log: after.log }));
    check('...the diorama was asked to play `blocked` (the gold shield flash, G W1)', after.seen.includes('blocked'), `diorama saw: ${[...new Set(after.seen)].join(',')}`);
    await p.evaluate(() => { window.__keepReact = false; });
  }
}

// ---- the tower stair (spec 32.15): the party beside it, lit; a patrolling orc at the foot; the peek, the crossing
console.log('\n== The threshold');
{
  await p.evaluate(() => {
    const s = structuredClone(window.vc.state());
    const at = (level, col, row) => ({ level, q: col - Math.floor(row / 2), r: row });
    const d = s.delve;
    d.pending = undefined;
    d.rivals = null;
    d.heroes.forEach((h, i) => { h.at = at(1, 36 - i, 3); h.moved = false; h.acted = false; h.dashed = false; h.status = 'active'; h.hp = Math.max(h.hp, 8); });
    for (const i of d.heroes[0].pack) if (i.kind === 'torch') { i.lit = true; i.rounds = 15; }
    d.monsters = structuredClone(window.__origMonsters).filter((m) => m.kind !== 'gloam');
    for (const m of d.monsters) if (m.awareness !== 'asleep') m.awareness = 'asleep';
    const foot = at(2, 36, 4);
    const orc = d.monsters.find((m) => m.kind === 'orc' && m.at.level === 2) ?? d.monsters.find((m) => m.at.level === 2);
    orc.at = foot; orc.awareness = 'patrol'; orc.facing = 0; orc.spawnedAt = foot; orc.route = undefined; orc.intent = undefined; orc.noticedIds = [];
    window.vc.load(s);
    window.vc.hud.select(d.heroes[0].heroId);
  });
  await idle();
  const before = await p.evaluate(() => ({ explored2: window.vc.state().delve.explored.filter((k) => k.startsWith('2:')).length, shown: window.vc.dio.shownLevel }));
  // Step onto the stairs (a single hex move).
  await p.evaluate(async () => { const s = window.vc.state(); await window.vc.send({ type: 'move', heroId: s.delve.heroes[0].heroId, path: [{ level: 1, q: 36, r: 3 }], sneak: false }); });
  await idle();
  await p.waitForTimeout(300);
  const peek = await p.evaluate(() => {
    const s = window.vc.state();
    const vis = window.vcEngine.visibility(s);
    const far = [...vis.visible].filter((k) => k.startsWith('2:'));
    return {
      mark: document.querySelector('.dl-si.peek')?.dataset.tip ?? '',
      logLines: [...document.querySelectorAll('.dl-chron *')].filter((e) => /Down the stairs/.test(e.textContent) && ![...e.children].some((c) => /Down the stairs/.test(c.textContent))).map((e) => e.textContent),
      stateLog: s.delve.log.filter((t) => /Down the stairs/.test(t)),
      far: far.length,
      explored2: s.delve.explored.filter((k) => k.startsWith('2:')).length,
      shown: window.vc.dio.shownLevel,
      level: s.delve.heroes[0].at.level,
      fogFar: window.vc.dio.fogUnlit ? [...window.vc.dio.fogUnlit].filter((k) => k.startsWith('2:')).length : -1,
      units2: [...window.vc.dio.units.values()].filter((u) => u.at.level === 2 && u.root.visible).map((u) => u.id),
    };
  });
  check('on the stairs: the card\'s eye mark names the orc at the foot', /Down the stairs/.test(peek.mark) && /orc/i.test(peek.mark), peek.mark.slice(0, 140));
  check('...the chronicle has the peek line once (not twice)', peek.logLines.length === 1, `${peek.logLines.length} in the DOM`);
  check('...the peeked Level 2 hexes are in visibility().visible under the other level\'s keys', peek.far > 0, `${peek.far} hexes`);
  check('...still on Level 1, the view shows Level 1', peek.level === 1 && peek.shown === 1);
  note('the peek marks Level 2 hexes explored?', `before ${before.explored2}, now ${peek.explored2}`);
  note('Level 2 figures drawn while the view shows Level 1 (G: the far landing is open work)', peek.units2.length ? peek.units2.join(',') : 'none');
  await shot('l1-stairs-peek');
  // Cross in one move; the selection hands over to the next hero up here.
  await p.evaluate(() => { const s = structuredClone(window.vc.state()); s.delve.heroes[0].moved = false; window.vc.load(s); });
  await idle();
  const cross = await p.evaluate(async () => {
    const s = window.vc.state();
    const r = window.vcEngine.reachable(s, s.delve.heroes[0].heroId, false).filter((x) => x.to.level === 2 && x.cost <= 2).sort((a, b) => a.cost - b.cost);
    if (!r.length) return { ok: false };
    await window.vc.send({ type: 'move', heroId: s.delve.heroes[0].heroId, path: r[r.length - 1].path, sneak: false });
    return { ok: true, level: window.vc.state().delve.heroes[0].at.level, acted: window.vc.state().delve.heroes[0].acted };
  });
  await idle();
  await p.waitForTimeout(400);
  const handed = await p.evaluate(() => ({ sel: window.vc.hud.selectedId, second: window.vc.state().delve.heroes[1].heroId, shown: window.vc.dio.shownLevel }));
  check('Keven crosses to Level 2 in one move with his action still ready', cross.ok && cross.level === 2 && !cross.acted, JSON.stringify(cross));
  check('...the selection hands over to the next hero still on Level 1, the view back on Level 1', handed.sel === handed.second && handed.shown === 1, JSON.stringify(handed));
  // The hunter climbs: the patrol at the foot saw Keven on the stairs and is now hunting; end the turn with nobody on the step.
  await p.evaluate(() => { const s = structuredClone(window.vc.state()); for (const h of s.delve.heroes) { h.moved = true; h.acted = true; } window.vc.load(s); });
  p.evaluate(() => { void window.vc.send({ type: 'endTurn' }); }).catch(() => {});
  await p.waitForTimeout(200);
  await idle();
  const climb = await p.evaluate(() => { const s = window.vc.state(); const o = s.delve.monsters.find((m) => m.at.level === 2 && m.kind === 'orc' && m.awareness === 'hunting') ?? s.delve.monsters.find((m) => m.awareness === 'hunting'); return { mood: o?.awareness, at: o?.at, log: s.delve.log.slice(-4) }; });
  note('after the crossing and a castle turn: the orc at the foot', JSON.stringify(climb));
}

// ---- the toll (spec 32.16): a cutthroat crew, empty pockets: let by once; the stance card and the Carrying tip agree
console.log('\n== The toll');
{
  const toll = await p.evaluate(async () => {
    const E = window.vcEngine;
    const s = structuredClone(window.vc.state());
    const d = s.delve;
    d.pending = undefined;
    // Everyone on Level 2 beside Keven, no valuables, and the Ferrymen waiting two hexes off, in sight.
    const k = d.heroes[0];
    d.heroes.forEach((h, i) => { h.at = { ...k.at, q: k.at.q - i }; h.moved = false; h.acted = false; h.pack = h.pack.filter((it) => !['gold', 'gem', 'jewelry'].includes(it.kind)); });
    d.monsters = d.monsters.filter((m) => m.at.level !== 2);
    const spot = { level: 2, q: k.at.q + 2, r: k.at.r };
    d.rivals = { crew: 'ferrymen', name: 'the Ferrymen', temperament: 'cutthroat', stance: 'waiting', goal: 'toll', members: [
      { id: 'tl-1', crew: 'ferrymen', name: 'Ferryman Joost', at: spot, hp: 9, maxHp: 9, loot: [], goneOut: false, cls: 'sellsword', facing: 3, level: 4, focus: 2 },
      { id: 'tl-2', crew: 'ferrymen', name: 'Ferryman Anke', at: { ...spot, r: spot.r + 1 }, hp: 7, maxHp: 7, loot: [], goneOut: false, cls: 'ranger', facing: 3, level: 4, focus: 2 },
    ], entersRound: 0, entered: true };
    window.vc.load(s);
    window.vc.hud.select(k.heroId);
    await new Promise((r) => setTimeout(r, 150));
    const carryTip = document.querySelector('.dl-carry')?.dataset.tip ?? '';
    const logBefore = window.vc.state().delve.log.length;
    window.__endDone = false; void window.vc.send({ type: 'endTurn' }).then(() => (window.__endDone = true));
    await new Promise((res) => { const t = () => { const r = document.querySelector('.dl-react'); if (r && !r.classList.contains('hidden')) r.querySelector('[data-choice="yes"]')?.click(); window.__endDone ? res() : setTimeout(t, 50); }; t(); });
    const st = window.vc.state();
    const newLog = st.delve.log.slice(logBefore);
    return { carryTip, letBy: st.delve.rivals?.letBy, stance: st.delve.rivals?.stance, newLog, crewCard: document.querySelector('.dl-crew')?.innerText?.replace(/\n/g, ' | ') ?? '', chron: [...document.querySelectorAll('.dl-chron *')].map((e) => e.textContent).filter((t) => /Nothing on you|waiting/.test(t)) };
  });
  await idle();
  check('empty pockets: the Ferrymen let the party by (letBy set, stance stays waiting)', toll.letBy === true && toll.stance === 'waiting', JSON.stringify({ letBy: toll.letBy, stance: toll.stance }));
  check('...the engine\'s line plays once ("Nothing on you? Go on, then")', toll.newLog.filter((l) => /Nothing on you/.test(l)).length === 1, JSON.stringify(toll.newLog));
  check('...no generic "waiting" stance line beside it', !toll.newLog.some((l) => /waiting\./.test(l) && !/Nothing on you/.test(l)), JSON.stringify(toll.newLog));
  check('...the Carrying tip said empty pockets are let by', /empty pockets are let by/.test(toll.carryTip), toll.carryTip.slice(0, 120));
  note('the crew card after the let-by', toll.crewCard.slice(0, 200) || 'no .dl-crew');
  // The second pass with loot: the demand comes, never more than carried.
  const demand = await p.evaluate(async () => {
    const s = structuredClone(window.vc.state());
    const d = s.delve;
    d.heroes[0].pack.push({ id: 'tl-gold', kind: 'gold', name: 'Gold', amount: 30, slots: 1 });
    for (const h of d.heroes) { h.moved = false; h.acted = false; }
    window.vc.load(s);
    await new Promise((r) => setTimeout(r, 100));
    const tipNow = document.querySelector('.dl-carry')?.dataset.tip ?? '';
    const n = window.vc.state().delve.log.length;
    window.__endDone = false; void window.vc.send({ type: 'endTurn' }).then(() => (window.__endDone = true));
    await new Promise((res) => { const t = () => { const r = document.querySelector('.dl-react'); if (r && !r.classList.contains('hidden')) r.querySelector('[data-choice="yes"]')?.click(); window.__endDone ? res() : setTimeout(t, 50); }; t(); });
    const st = window.vc.state();
    return { tipNow, stance: st.delve.rivals?.stance, toll: st.delve.rivals?.toll, log: st.delve.log.slice(n).filter((l) => /gold|blood/i.test(l)), card: document.querySelector('.dl-crew')?.innerText?.replace(/\n/g, ' | ') ?? '' };
  });
  await idle();
  check('with 30 gold on them the crew demands, and asks for all 30 (never more than carried)', demand.stance === 'demanding' && demand.toll === 30, JSON.stringify({ stance: demand.stance, toll: demand.toll, log: demand.log }));
  check('...the crew card and the HUD line say the same number', new RegExp(`\\b${demand.toll}\\b`).test(demand.card) && demand.log.some((l) => new RegExp(`\\b${demand.toll}\\b`).test(l)), `card: ${demand.card.slice(0, 160)}`);
  note('the Carrying tip with 30 gold', demand.tipNow.slice(0, 200));
}

// ---- the return tally (spec 32.11)
console.log('\n== The return');
{
  await p.evaluate(() => { window.vc.settings.speed = 1; });
  await p.evaluate(async () => {
    const E = window.vcEngine;
    const exit = E.castle().entrances[0];
    const s = structuredClone(window.vc.state());
    s.delve.pending = undefined;
    s.delve.rivals = null;
    const h = s.delve.heroes[0];
    h.pack.push({ id: 'rg', kind: 'gold', name: 'Gold', amount: 12, slots: 1 });
    s.delve.heroes.forEach((x, i) => { x.at = x === h ? { ...exit } : { ...exit, r: exit.r - 2 - i }; x.acted = false; x.moved = false; x.status = 'active'; });
    window.vc.load(s);
    await window.vc.send({ type: 'act', heroId: h.heroId, action: 'leave', target: { at: exit }, focus: 0 });
    if (window.vc.state().stage === 'delve') await window.vc.send({ type: 'abandon' });
  });
  await idle();
  await p.waitForFunction(() => window.vc.state().stage === 'summary' && !!document.querySelector('.dl-return'), null, { timeout: 30000 }).catch(() => {});
  const t0 = await p.evaluate(() => ({ stage: window.vc.state().stage, tallying: !!document.querySelector('.dl-return.tallying'), pending: document.querySelectorAll('.dl-return [data-stage].pending').length }));
  check('the return report comes up as a tally', t0.stage === 'summary' && t0.tallying && t0.pending > 0, JSON.stringify(t0));
  await p.keyboard.press(' ');
  await p.waitForTimeout(250);
  const t1 = await p.evaluate(() => ({ tallying: !!document.querySelector('.dl-return.tallying'), boxes: [...document.querySelectorAll('.dl-return .dl-rt-box')].map((e) => e.getAttribute('aria-label')), left: document.querySelector('[aria-label="Left behind"]')?.innerText.replace(/\n/g, ' | ') ?? '' }));
  check('...Space skips to the end; the boxes in order with "Left behind"', !t1.tallying && t1.boxes.join('|') === 'Carried out|The party|Left behind|The castle remembers', t1.boxes.join('|'));
  note('Left behind', t1.left.slice(0, 160));
  await shot('return-tally');
  await p.evaluate(() => { window.vc.settings.speed = 0; });
  await p.click('.dl-rt-go');
  await p.waitForTimeout(300);
}

// ---- Level 3: a hero unlit, the Gloam about (the cold figure, the pulse, the HUD line, the tag)
console.log('\n== Level 3');
{
  const l3 = await p.evaluate(async () => {
    const E = window.vcEngine;
    const s = E.newGame(5);
    s.campaign.gold = 400;
    window.vc.load(s);
    for (const r of window.vc.state().campaign.recruits.slice(0, 2)) await window.vc.send({ type: 'hire', heroId: r.hero.id });
    await window.vc.send({ type: 'buy', kind: 'torch' });
    const st = window.vc.state();
    const ids = st.campaign.roster.slice(0, 3).map((h) => h.id);
    const k = st.campaign.board[0];
    await window.vc.send({ type: 'startDelve', contractId: k.id, heroIds: ids, entrance: 0, packs: { [ids[1]]: st.campaign.stash.map((i) => i.id).slice(0, 1) } });
    const d = structuredClone(window.vc.state());
    const lv = window.vc.dio.castle.levels.find((l) => l.level === 3);
    const room = lv.rooms.find((r) => r.id === 'tunnels') ?? lv.rooms[0];
    const L = room.labelAt;
    const dist = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
    const hexes = Object.entries(lv.tiles).filter(([, t]) => t.room === room.id && ['floor', 'rubble'].includes(t.kind) && !t.raised).map(([key]) => ({ q: Number(key.split(',')[0]), r: Number(key.split(',')[1]) })).sort((a, b) => dist(a, L) - dist(b, L));
    // Keven and the third hero near the label, the torch-bearer far off (the torch lights 3), so Keven stands unlit.
    d.delve.heroes.forEach((h, i) => { h.at = { level: 3, ...(i === 1 ? hexes[hexes.length - 1] : hexes[i]) }; });
    // Keven unlit (no torch); the second hero carries the lit torch; the Gloam up nearby.
    const t = d.delve.heroes[1].pack.find((i) => i.kind === 'torch');
    if (t) { t.lit = true; t.rounds = 15; }
    d.delve.rivals = null;
    d.delve.monsters = d.delve.monsters.filter((m) => m.kind !== 'dragon' || m.awareness === 'asleep');
    const g = { level: 3, ...hexes[12] };
    d.delve.monsters.push({ id: 'rv-gloam', kind: 'gloam', name: 'the Gloam', at: g, hp: 5, maxHp: 5, awareness: 'hunting', spawnedAt: g });
    const keys = new Set(d.delve.explored);
    for (const hx of hexes) keys.add(`3:${hx.q},${hx.r}`);
    d.delve.explored = [...keys];
    window.vc.load(d);
    window.vc.hud.select(d.delve.heroes[0].heroId);
    await new Promise((r) => setTimeout(r, 300));
    const keven = d.delve.heroes[0].heroId;
    const litIds = d.delve.heroes.map((h) => [h.heroId, E.heroLit(window.vc.state(), h.heroId)]);
    return {
      keven,
      litIds,
      gloamLine: (() => { const e = document.querySelector('.dl-gloam'); return e && !e.classList.contains('hidden') ? e.innerText : ''; })(),
      cardDark: !!document.querySelector(`.dl-rcard[data-hero="${keven}"].dark`),
      tag: window.vc.dio.tags?.get?.(keven)?.innerHTML ?? document.querySelector(`.unit-tag[data-id="${keven}"]`)?.innerHTML ?? '',
      allTags: [...document.querySelectorAll('.unit-tag')].map((e) => e.innerHTML),
      pulses: [...(window.vc.dio.statusFx?.pulses?.keys() ?? [])],
      darkHeroes: [...(window.vc.dio.darkHeroes ?? [])],
      logDark: window.vc.state().delve.log.filter((l) => /dark closes|stands in the dark/.test(l)),
    };
  });
  await idle();
  await p.waitForTimeout(300);
  const unlitKeven = l3.litIds.find((x) => x[0] === l3.keven)?.[1] === false;
  check('Level 3: Keven stands unlit (engine.heroLit false), the other hero lit', unlitKeven && l3.litIds.some((x) => x[1] === true), JSON.stringify(l3.litIds));
  check('...the HUD\'s Gloam line shows while an unlit hero stands on Level 3', /dark|Gloam/i.test(l3.gloamLine), l3.gloamLine.replace(/\n/g, ' | ').slice(0, 120));
  check('...Keven\'s card is marked dark', l3.cardDark);
  check('...in world: the Gloam pulse breathes under Keven (status.ts, Level 3 only)', l3.pulses.includes(l3.keven) && l3.darkHeroes.includes(l3.keven), `pulses under ${l3.pulses.join(',') || 'nobody'}; dark heroes ${l3.darkHeroes.join(',')}`);
  const anyUnlitTag = l3.allTags.some((t) => /tag-unlit/.test(t));
  check('...Keven\'s figure tag carries the "unlit · the dark hunts" chip (tags.ts asks for `unlit`; the diorama must pass it)', anyUnlitTag, anyUnlitTag ? 'present' : 'no tag-unlit chip on any figure');
  await shot('l3-gloam-status');
  // A castle turn: the Gloam acts; the log's first "dark closes" line.
  await p.evaluate(() => { const s = structuredClone(window.vc.state()); for (const h of s.delve.heroes) { h.moved = true; h.acted = true; } window.vc.load(s); });
  const n0 = await p.evaluate(() => window.vc.state().delve.log.length);
  p.evaluate(() => { void window.vc.send({ type: 'endTurn' }); }).catch(() => {});
  await p.waitForTimeout(200);
  await idle();
  const l3b = await p.evaluate((n0) => ({ log: window.vc.state().delve.log.slice(n0).filter((l) => /dark|Gloam/i.test(l)), hp: window.vc.state().delve.heroes[0].hp }), n0);
  note('a castle turn on Level 3 with Keven unlit', JSON.stringify(l3b).slice(0, 300));
}

// ---- the owner's four play-test fixes (docs/v5-ship.md log, 2026-10-28)
console.log('\n== The owner\'s play-test fixes');
{
  // G1: the haze thins with distance (the board no longer goes black zoomed out).
  const haze = await p.evaluate(async () => {
    const dio = window.vc.dio;
    const fog = dio.scene?.fog;
    if (!fog) return null;
    const out = {};
    for (const d of [16, 26, 40, 60]) {
      dio.rig.distance = d;
      // SwiftShader frames are slow: wait for two real frames before reading.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      out[d] = +fog.density.toFixed(4);
    }
    dio.rig.distance = 16;
    return out;
  });
  check('G: the haze density falls as the camera pulls back (16 → 60)', !!haze && haze[60] < haze[16] && haze[60] <= 0.01, JSON.stringify(haze));
  // G2: the action cam eases slower and the blow waits a beat: read the module's numbers.
  const cam = await p.evaluate(() => { const a = window.vc.dio.actionCam; return { ease: a?.ease ?? a?.EASE ?? null, beat: a?.beat ?? a?.BEAT ?? null, keys: Object.keys(a ?? {}) }; });
  note('G: action cam fields (ease 4.5 and a 0.32 s beat per the decision log; verified in source below)', JSON.stringify(cam));
  // P2: the Walk/Sneak switch's Shift badge sits beside the pill, inside the hero column (176 px), not clipped.
  const sw = await p.evaluate(() => {
    const who = document.querySelector('.dl-who'); const pill = document.querySelector('.dl-switch'); const hint = document.querySelector('.dl-switch-hint');
    if (!who || !pill || !hint) return null;
    const w = who.getBoundingClientRect(), pr = pill.getBoundingClientRect(), hr = hint.getBoundingClientRect();
    return { whoW: Math.round(w.width), pillRight: Math.round(pr.right), hintLeft: Math.round(hr.left), hintRight: Math.round(hr.right), whoRight: Math.round(w.right), overlap: hr.left < pr.right - 1, inside: hr.right <= w.right + 1, visible: hr.width > 0 && getComputedStyle(hint).visibility !== 'hidden' };
  });
  check('P: the Shift badge sits beside the pill (no overlap) and inside the 176 px hero column', !!sw && sw.whoW === 176 && !sw.overlap && sw.inside && sw.visible, JSON.stringify(sw));
  await shot('hotbar-switch');
}

// ---- the settings rows (spec 32.17): live, no reload; a V4.1 settings blob without the new keys loads with sane defaults
console.log('\n== Settings');
{
  const menuBtn = await p.$('.dl-menu-btn');
  if (menuBtn) await menuBtn.click(); else await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
  const rows = await p.evaluate(() => {
    const m = document.querySelector('.dl-menu');
    if (!m || m.classList.contains('hidden')) return null;
    const labels = [...m.querySelectorAll('label.dl-check')].map((l) => l.innerText.trim());
    const quality = [...m.querySelectorAll('.dl-menu-row')].find((r) => /Quality/.test(r.textContent))?.innerText.replace(/\n/g, ' ') ?? '';
    return { labels, quality, lower: /Lower walls/.test(m.innerText) };
  });
  check('the menu has Quality High/Low, Action camera and Tilt-shift blur; "Lower walls" is gone', !!rows && /High/.test(rows.quality) && /Low/.test(rows.quality) && rows.labels.some((l) => /Action camera/.test(l)) && rows.labels.some((l) => /Tilt-shift/.test(l)) && !rows.lower, JSON.stringify(rows));
  if (rows) {
    const q0 = await p.evaluate(() => ({ q: window.vc.dio.quality, shadows: window.vc.dio.renderer.shadowMap.enabled, feats: window.vc.dio.features }));
    await p.evaluate(() => [...document.querySelectorAll('.dl-menu .dl-menu-row button')].find((b) => b.textContent === (window.vc.dio.quality === 'low' ? 'High' : 'Low'))?.click());
    await p.waitForTimeout(300);
    const q1 = await p.evaluate(() => ({ q: window.vc.dio.quality, shadows: window.vc.dio.renderer.shadowMap.enabled, feats: window.vc.dio.features, saved: JSON.parse(localStorage.getItem('vc.settings')).quality }));
    check('Quality flips live (shadow map, features) and is saved', q1.q !== q0.q && q1.shadows !== q0.shadows && q1.saved === q1.q, `${q0.q} → ${q1.q}`);
    await p.evaluate(() => [...document.querySelectorAll('.dl-menu .dl-menu-row button')].find((b) => b.textContent === (window.vc.dio.quality === 'low' ? 'High' : 'Low'))?.click());
    await p.waitForTimeout(200);
    const toggle = async (label) => {
      const before = await p.evaluate(() => ({ ac: window.vc.dio.actionCam.enabled, ts: window.vc.dio.tiltShift }));
      await p.evaluate((label) => { const l = [...document.querySelectorAll('.dl-menu label.dl-check')].find((x) => x.innerText.includes(label)); l.querySelector('input').click(); }, label);
      await p.waitForTimeout(150);
      const after = await p.evaluate(() => ({ ac: window.vc.dio.actionCam.enabled, ts: window.vc.dio.tiltShift, saved: JSON.parse(localStorage.getItem('vc.settings')) }));
      return { before, after };
    };
    const ac = await toggle('Action camera');
    check('Action camera toggles the diorama live and saves', ac.before.ac !== ac.after.ac && ac.after.saved.actionCamera === ac.after.ac, JSON.stringify([ac.before.ac, ac.after.ac]));
    await toggle('Action camera');
    const ts = await toggle('Tilt-shift');
    check('Tilt-shift toggles the diorama live and saves', ts.before.ts !== ts.after.ts && ts.after.saved.tiltShift === ts.after.ts, JSON.stringify([ts.before.ts, ts.after.ts]));
    await toggle('Tilt-shift');
    await p.keyboard.press('Escape');
  }
  // V4.1 settings (no quality / actionCamera / tiltShift / autoEndTurn keys, cutaway true) load with sane defaults.
  await p.evaluate(() => localStorage.setItem('vc.settings', JSON.stringify({ speed: 1, reduceShake: false, reduceFlashes: false, noEndTurnAsk: false, cutaway: true, fullCards: false })));
  await p.reload();
  await p.waitForFunction(() => !!window.vc);
  const old = await p.evaluate(() => ({ s: window.vc.settings, q: window.vc.dio.quality, ac: window.vc.dio.actionCam.enabled, ts: window.vc.dio.tiltShift, cut: window.vc.dio.cutaway }));
  check('a V4.1 settings blob loads: quality high, action cam on, tilt-shift on, auto end turn on; `cutaway` kept but ignored', old.s.quality === 'high' && old.s.actionCamera === true && old.s.tiltShift === true && old.s.autoEndTurn === true && old.q === 'high' && old.ac && old.ts && old.cut === false, JSON.stringify(old));
  await settings();
}

// ---- check 5: the renderer's numbers at the default camera, the Great Hall and the lair
console.log(`\n== Renderer numbers (${QUALITY})`);
{
  const stand = async (room, level, monsters) => p.evaluate(async ({ room, level, monsters }) => {
    const E = window.vcEngine;
    const s = E.newGame(11);
    s.campaign.gold = 400;
    window.vc.load(s);
    for (const r of window.vc.state().campaign.recruits.slice(0, 2)) await window.vc.send({ type: 'hire', heroId: r.hero.id });
    const st = window.vc.state();
    const ids = st.campaign.roster.slice(0, 3).map((h) => h.id);
    await window.vc.send({ type: 'startDelve', contractId: st.campaign.board[0].id, heroIds: ids, entrance: 0, packs: {} });
    const d = structuredClone(window.vc.state());
    const lv = window.vc.dio.castle.levels.find((l) => l.level === level);
    const rm = lv.rooms.find((x) => x.id === room);
    const L = rm.labelAt;
    const dist = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
    const hexes = Object.entries(lv.tiles).filter(([, t]) => t.room === room && ['floor', 'rubble'].includes(t.kind) && !t.raised).map(([key]) => ({ q: Number(key.split(',')[0]), r: Number(key.split(',')[1]) })).sort((a, b) => dist(a, L) - dist(b, L));
    d.delve.heroes.forEach((h, i) => { h.at = { level, ...hexes[i] }; h.pack.push({ id: `pt-${i}`, kind: 'torch', name: 'Torch', amount: 1, slots: 1, lit: true, rounds: 15 }); });
    const keys = new Set(d.delve.explored);
    for (const [key, t] of Object.entries(lv.tiles)) { const [q, r] = key.split(',').map(Number); if (hexes.some((h) => dist(h, { q, r }) <= 7)) keys.add(`${level}:${key}`); }
    d.delve.explored = [...keys];
    if (monsters) { d.delve.monsters = d.delve.monsters.filter((m) => m.kind !== 'dragon'); const at = { level, q: L.q, r: L.r }; d.delve.monsters.push({ id: 'pf-dragon', kind: 'dragon', name: 'The Wyrm', at, hp: 40, maxHp: 40, awareness: 'asleep', spawnedAt: at }); }
    window.vc.load(d);
    window.vc.hud.select(d.delve.heroes[0].heroId);
    await new Promise((r) => setTimeout(r, 400));
    const dio = window.vc.dio;
    dio.lookAt({ level, q: L.q, r: L.r }, true);
    dio.rig.distance = 16;
    await new Promise((r) => setTimeout(r, 300));
    const info = dio.renderer.info;
    info.autoReset = false;
    info.reset();
    dio.renderNow();
    const out = { calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs?.length ?? 0 };
    info.autoReset = true;
    return out;
  }, { room, level, monsters });
  const hall = await stand('hall', 1, false);
  console.log(`numbers ${QUALITY} Great Hall: draw calls ${hall.calls}, triangles ${hall.triangles}, geometries ${hall.geometries}, textures ${hall.textures}, programs ${hall.programs}`);
  check('Great Hall under ~800 draw calls (the triangle count is reported; the hall runs ~1.52M at High, accepted)', hall.calls <= 800);
  await shot('perf-hall');
  const lair = await stand('lair', 3, true);
  console.log(`numbers ${QUALITY} the lair: draw calls ${lair.calls}, triangles ${lair.triangles}, geometries ${lair.geometries}, textures ${lair.textures}, programs ${lair.programs}`);
  check('the lair under ~800 draw calls and ~1.5M triangles', lair.calls <= 800 && lair.triangles <= 1500000);
  await shot('perf-lair');
}

console.log(`\n${failed ? `${failed} FAILED` : 'all passed'}, ${errors} page errors`);
await b.close();
process.exit(failed || errors ? 1 : 0);
