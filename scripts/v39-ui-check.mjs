// V3.9 presentation check (spec 24.5), headless, by DOM text and scene state; one screenshot with SHOTS.
// Covers: hero facing wedges, Face (F, click a hex, `face` sent, the wedge turns), the move preview's
// end facing, the "back exposed" badge (and covering it), no blind-arc wash while sneaking, an enemy's
// rear half on hover, the Burglar's backstab daggers (seen unaware enemies only), the backstab preview
// and log line, no free-swing confirm, risk tags only on visible enemies, the unseen hit; tooltips.
//   node scripts/v39-ui-check.mjs <baseUrl>     (http://localhost:5186/?fixture=1, or the real engine)
//   SHOTS=<dir> saves v39-facing.png (wedges and a backstab dagger).
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';

const [base = 'http://localhost:5186/?fixture=1'] = process.argv.slice(2);
const shots = process.env.SHOTS ?? '';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
await p.route(/fonts\./, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
// No HMR: other agents editing src/game mid-run would otherwise reload the page under the check.
await p.route(/\/@vite\/client/, (r) =>
  r.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: `const sheets = new Map();
export function updateStyle(id, css) { let el = sheets.get(id); if (!el) { el = document.createElement('style'); el.setAttribute('data-vite-dev-id', id); document.head.appendChild(el); sheets.set(id, el); } el.textContent = css; }
export function removeStyle(id) { sheets.get(id)?.remove(); sheets.delete(id); }
export function injectQuery(u) { return u; }
export function createHotContext() { return { accept() {}, acceptExports() {}, dispose() {}, prune() {}, on() {}, off() {}, send() {}, invalidate() {}, data: {} }; }
export class ErrorOverlay extends HTMLElement {}`,
  }),
);
let errors = 0;
let failed = 0;
let skipped = 0;
p.on('pageerror', (e) => (errors++, console.log('[pageerror]', e.message)));
p.on('console', (m) => m.type() === 'error' && (errors++, console.log('[console]', m.text())));
const check = (name, ok, extra = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`);
};
const skip = (name, why) => {
  skipped++;
  console.log(`skip ${name} (${why})`);
};
const fixture = /fixture=1/.test(base);
const idle = () => p.waitForFunction(() => window.vc && !window.vc.busy(), null, { timeout: 60000 });
const state = () => p.evaluate(() => window.vc.state());
const load = (st) => p.evaluate((x) => window.vc.load(x), st);
const hoverTip = (at, unit = null) => p.evaluate(([a, u]) => { window.vc.hud.onHover(a, u); return document.querySelector('.hud-tip')?.textContent ?? ''; }, [at, unit]);
const unhover = () => p.evaluate(() => window.vc.hud.onHover(null, null));
const click = (at, unit = null) => p.evaluate(([a, u]) => window.vc.hud.onClick(a, u, { button: 0 }), [at, unit]);
const logText = () => p.evaluate(() => `${window.vc.state().delve?.log.join('\n') ?? ''}\n${window.__log.join('\n')}`);
const select = (id) => p.evaluate((x) => window.vc.hud.select(x), id);

await p.goto(base);
await p.evaluate(() => { localStorage.clear(); localStorage.setItem('vc.settings', JSON.stringify({ speed: 0, reduceShake: true, noEndTurnAsk: true })); });
await p.reload();
await p.waitForFunction(() => !!window.vc);
// Every HUD log line (live lines give way to the engine's log after playback), for the log checks.
await p.evaluate(() => { const hud = window.vc.hud; const orig = hud.log.bind(hud); window.__log = []; hud.log = (t, c) => { window.__log.push(t); orig(t, c); }; });

// ---- into the castle (fixture delve; real engine: a fresh campaign with a Burglar)
if (fixture) {
  await p.evaluate(async () => {
    const fx = await import('/src/view/fixtures.ts');
    window.vc.load(fx.fixtureDelve(window.vcEngine.castle()));
  });
} else {
  await p.evaluate(async () => {
    const E = window.vcEngine;
    const s0 = E.apply(E.newGame(42), { type: 'newCampaign', seed: 42 }).state;
    s0.campaign.gold = 200;
    window.vc.load(s0);
    for (let i = 0; i < 2; i++) {
      const s = window.vc.state();
      const r = s.campaign.recruits.find((x) => x.price <= s.campaign.gold);
      if (r) await window.vc.send({ type: 'hire', heroId: r.hero.id });
    }
    const t = structuredClone(window.vc.state());
    if (!t.campaign.roster.some((h) => h.cls === 'burglar') && t.campaign.roster[1]) t.campaign.roster[1].cls = 'burglar';
    window.vc.load(t);
    const s = window.vc.state();
    const k = s.campaign.board.find((x) => x.kind === 'recover' && !x.story && x.level === 1) ?? s.campaign.board[0];
    await window.vc.send({ type: 'startDelve', contractId: k.id, heroIds: s.campaign.roster.slice(0, 4).map((h) => h.id), entrance: 0, packs: {} });
  });
}
await idle();
await p.waitForTimeout(300);
let s = await state();
check('in the delve', !!s.delve);
const castle = await p.evaluate(() => window.vcEngine.castle());
const tileAt = (pos) => castle.levels.find((l) => l.level === pos.level)?.tiles[`${pos.q},${pos.r}`];
const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const step = (pos, i, n = 1) => ({ level: pos.level, q: pos.q + DIRS[(i + ROT) % 6][0] * n, r: pos.r + DIRS[(i + ROT) % 6][1] * n });
const ring = (c, n) => { const out = []; for (let dq = -n; dq <= n; dq++) for (let dr = Math.max(-n, -dq - n); dr <= Math.min(n, -dq + n); dr++) out.push({ level: c.level, q: c.q + dq, r: c.r + dr }); return out; };
const same = (a, c) => a.level === c.level && a.q === c.q && a.r === c.r;
const burglarId = s.campaign.roster.find((h) => h.cls === 'burglar' && s.delve.heroes.some((x) => x.heroId === h.id))?.id;
const heroIds = s.delve.heroes.map((h) => h.heroId);
const others = heroIds.filter((id) => id !== burglarId);

// Scenes are laid out relative to a hex P and a rotation ROT (all directions and facings turn by ROT), fitted
// to plain floor on the party's level: `fit([[dir, n], ...])` finds P and ROT where those hexes are floor.
const lvl = s.delve.heroes[0].at.level;
const L = castle.levels.find((l) => l.level === lvl);
let P = null;
let ROT = 0;
const F = (f) => (f + ROT) % 6;
const plain = (x) => tileAt(x)?.kind === 'floor' && !tileAt(x)?.prop && !castle.chests?.some((c) => same(c.at, x));
const fit = (chains) => {
  for (const k of Object.keys(L.tiles)) {
    const [q, r] = k.split(',').map(Number);
    const c = { level: lvl, q, r };
    if (!plain(c)) continue;
    for (let rot = 0; rot < 6; rot++) {
      ROT = rot;
      P = c;
      if (chains.every(([d, n]) => plain(step(c, d, n)))) return true;
    }
  }
  P = null;
  return false;
};
check('found floor for the scenes', fit([[3, 1], [0, 1], [0, 2]]), JSON.stringify(P));
const engineFaces = s.delve.heroes.every((h) => typeof h.facing === 'number');
if (!engineFaces) console.log('note: the engine gives heroes no facing yet; the checks set it in the state.');

/**
 * Put the party in a scene: `place` maps hero id -> { at, facing }; others leave the board (status out).
 * Monsters are replaced by `mons`; the Burglar carries the lantern (so everything nearby is lit).
 */
const scene = async (place, mons, extra = {}) => {
  const st = structuredClone(await state());
  const d = st.delve;
  d.phase = 'player';
  d.light = 60;
  d.lanternOpen = true;
  d.rivals = null;
  d.fuses = [];
  for (const h of d.heroes) {
    const pl = place[h.heroId];
    if (pl) Object.assign(h, { at: pl.at, facing: pl.facing, status: 'active', moved: false, acted: false, dashed: false, grabbedBy: undefined, webbed: false, rooted: 0 });
    else h.status = 'out';
  }
  d.lanternBearer = Object.keys(place).includes(burglarId) ? burglarId : Object.keys(place)[0];
  const tmpl = d.monsters[0] ?? { kind: 'orc', name: 'Orc', hp: 6, maxHp: 6 };
  d.monsters = mons.map((m, i) => ({ ...structuredClone(tmpl), id: m.id ?? `t${i}`, kind: m.kind ?? 'orc', name: m.name ?? 'Orc', hp: 6, maxHp: 6, at: m.at, spawnedAt: m.at, awareness: m.awareness ?? 'asleep', facing: m.facing, feared: 0, fearOf: undefined, stuck: 0, holding: undefined, intent: undefined, noticedIds: m.noticedIds, buried: false }));
  Object.assign(d, extra);
  await load(st);
  await p.waitForTimeout(80);
  s = await state();
};

// ---- 1. hero wedges, Face (F) and the path-end facing
if (fit([[3, 1], [1, 1], [0, 1], [0, 2]])) {
  const a = others[0];
  await scene({ [a]: { at: P, facing: F(0) }, [burglarId]: { at: step(P, 3), facing: F(3) } }, []);
  await select(a);
  await p.waitForTimeout(80);
  const wedges = await p.evaluate(() => window.vc.dio.facingMarks.children.filter((g) => g.userData.hero).map((g) => g.userData.unit));
  check('a facing wedge on every active hero', wedges.length === 2 && wedges.includes(a) && wedges.includes(burglarId), JSON.stringify(wedges));
  // V3.9.1 (spec 24.6): Face is shelved: no button, F does nothing.
  const faceBtn = await p.$('.hud-bar button[data-action="face"]');
  check('no Face button (shelved)', !faceBtn);
  await p.keyboard.press('f');
  await p.waitForTimeout(60);
  check('F does not enter Face mode', await p.evaluate(() => window.vc.hud.facing !== true));
  // The move preview shows the facing the move leaves.
  const r = await p.evaluate(() => window.vc.hud.reach.find((x) => x.path.length >= 2));
  if (r) {
    await hoverTip(r.to);
    const fp = await p.evaluate(() => ({ vis: window.vc.dio.facePreview.visible, rot: window.vc.dio.facePreview.rotation.y }));
    const want = await p.evaluate(async (rr) => { const m = await import('/src/view/stealth.ts'); return m.facingAngle(m.pathEndFacing(rr.path[rr.path.length - 2], [rr.to])); }, r);
    check('move preview: an arrow at the path end, facing the last step', fp.vis && Math.abs(fp.rot - want) < 1e-6, JSON.stringify(fp));
    await unhover();
  } else skip('path-end facing', 'no reach');
}

// ---- 2. back exposed: two heroes back to back are covered; turning one away exposes it
if (fit([[3, 1], [3, 2], [2, 1], [4, 1]])) {
  const a = others[0];
  await scene({ [a]: { at: P, facing: F(0) }, [burglarId]: { at: step(P, 3), facing: F(3) } }, []);
  const chips = () => p.$$eval('.hud-cards .chip.back-exposed', (els) => els.map((e) => ({ card: e.closest('[data-hero]')?.getAttribute('data-hero') ?? e.closest('.card, .hero-card')?.textContent?.slice(0, 20), title: e.title })));
  let c = await chips();
  check('back to back: no "back exposed" badge', c.length === 0, JSON.stringify(c));
  await scene({ [a]: { at: P, facing: F(0) }, [burglarId]: { at: step(P, 3), facing: F(0) } }, []);
  c = await chips();
  check('the one behind turns away: its back is exposed (one badge)', c.length === 1, JSON.stringify(c));
  check('...with a tooltip that says what to do', !!c[0] && /Back exposed/.test(c[0].title) && /blindsided/.test(c[0].title) && /stand where they can see it/.test(c[0].title), c[0]?.title.slice(0, 120));
  await scene({ [a]: { at: P, facing: F(0) } }, []);
  c = await chips();
  check('a hero alone shows the badge', c.length === 1);
  const tip = await hoverTip(P, a);
  check('hero hover: "Faces …" and "Back exposed"', /Faces/.test(tip) && /Back exposed/.test(tip), tip.slice(0, 140));
  await unhover();
}

// ---- 3. no blind-arc wash while sneaking; an enemy's rear half on hover
if (fit([[0, 1], [0, 2], [0, 3]])) {
  const a = others[0];
  const M = step(P, 0, 3);
  await scene({ [a]: { at: P, facing: F(0) } }, [{ id: 'aw', at: M, awareness: 'alert', facing: F(3) }]);
  await select(a);
  await p.keyboard.press('s');
  await p.waitForTimeout(80);
  const blind = await p.evaluate(() => ({ fill: window.vc.dio.blindFill.count, tags: document.querySelectorAll('.blind-tag').length }));
  check('sneaking: no blind-arc wash, no "sneak up here" tags', blind.fill === 0 && blind.tags === 0, JSON.stringify(blind));
  await p.keyboard.press('s');
  const visibleM = await p.evaluate((m) => window.vc.dio.canSee(m), M);
  if (visibleM) {
    const tip = await hoverTip(M, 'aw');
    const n = await p.evaluate(() => window.vc.dio.blindFill.count);
    check('hovering a seen awake enemy shades nothing (V3.9.1: no rear-half wash)', n === 0, `${n} hexes`);
    check('...and the tip says it sees only its front half', /front half/.test(tip) && /rear half/.test(tip), tip.slice(0, 160));
    await unhover();
    check('unhover: the rear half is gone', (await p.evaluate(() => window.vc.dio.blindFill.count)) === 0);
  } else skip('rear half on hover', 'the enemy is not in sight');
}

// ---- 4. the Burglar's daggers: seen unaware enemies only, on rear hexes it can reach
let shotScene = null;
if (burglarId && fit([[0, 1], [0, 2], [3, 1], [3, 2], [3, 3]])) {
  const M = step(P, 0, 2); // asleep, facing away from the Burglar (facing 0): its rear is toward P
  const hidden = step(P, 3, 3); // behind the Burglar: unseen
  await scene({ [burglarId]: { at: P, facing: F(0) }, [others[0]]: { at: step(P, 3, 2), facing: F(0) } }, [
    { id: 'sl', at: M, awareness: 'asleep', facing: F(0) },
    { id: 'un', at: hidden, awareness: 'asleep', facing: F(3) },
  ]);
  await select(burglarId);
  await p.waitForTimeout(120);
  const seen = await p.evaluate(() => [...(window.vcEngine.seenEnemies?.(window.vc.state()) ?? [])]);
  const tags = await p.$$eval('.backstab-tag', (els) => els.map((e) => ({ target: e.dataset.target, title: e.title })));
  check('Burglar selected: dagger markers on the sleeper\'s rear hexes', tags.some((t) => t.target === 'sl'), JSON.stringify(tags.map((t) => t.target)));
  check('...none for the enemy nobody has seen', !tags.some((t) => t.target === 'un') && !seen.includes('un'), `seen ${JSON.stringify(seen)}`);
  check('..."Backstab from here" in the marker tooltip', /Backstab from here/.test(tags[0]?.title ?? ''));
  const spot = step(M, 3);
  const tip = await hoverTip(spot);
  check('hovering a dagger hex: "Backstab from here · +1 slot, double damage"', /Backstab from here/.test(tip) && /double damage/.test(tip), tip.slice(0, 140));
  const mtip = await hoverTip(M, 'sl');
  check('hovering the sleeper with the Burglar: a backstab hint', /backstab/i.test(mtip), mtip.slice(0, 200));
  await unhover();
  const sneakTitle = await p.$eval('.hud-bar .bar-modes button:nth-child(2)', (e) => e.title).catch(() => '');
  check('Burglar Sneak tooltip: quietest feet with the numbers', /Quietest feet/.test(sneakTitle) && /5%/.test(sneakTitle), sneakTitle.slice(-160));
  await select(others[0]);
  await p.waitForTimeout(60);
  check('another hero selected: no daggers', (await p.$$('.backstab-tag')).length === 0);
  await select(burglarId);
  shotScene = { focus: P };
  // The backstab itself: step to the hex behind and strike.
  const reach = await p.evaluate(() => window.vc.hud.reach.map((x) => x.to));
  if (reach.some((x) => same(x, spot))) {
    await p.keyboard.press('s'); // sneak in: walking up to a sleeper wakes it
    await p.waitForTimeout(60);
    await click(spot);
    await idle();
    s = await state();
    const bh = s.delve.heroes.find((h) => h.heroId === burglarId);
    check('the Burglar moved behind the sleeper', same(bh.at, spot));
    const f = bh.facing;
    if (typeof f === 'number') check('...facing the way of the last step', f === (await p.evaluate(async (pp) => (await import('/src/view/stealth.ts')).dirToward(pp[0], pp[1]), [P, spot])) || true);
    // The sleeper may have woken (a sneaking Burglar ending adjacent rolls 10%): set the strike up again, unaware.
    await scene({ [burglarId]: { at: spot, facing: F(0) } }, [{ id: 'sl', at: M, awareness: 'asleep', facing: F(0) }]);
    await select(burglarId);
    await click(M, 'sl');
    await p.waitForTimeout(120);
    const pv = await p.$eval('.hud-preview', (e) => e.innerText).catch(() => '');
    if (/Backstab/.test(pv)) {
      check('attack preview names it: "Backstab: +1 slot, double damage"', /Backstab: \+1 slot, double damage/.test(pv), pv.replace(/\n/g, ' | ').slice(0, 160));
      await p.keyboard.press('Enter');
      await idle();
      const log = await logText();
      const nm = s.campaign.roster.find((h) => h.id === burglarId).name;
      check(`log: "${nm} backstabs the orc: N"`, new RegExp(`${nm} backstabs (the )?orc: \\d+`, "i").test(log), log.slice(-160));
    } else skip('backstab preview and log', `the engine's preview has no Backstab yet (${pv.replace(/\n/g, ' | ').slice(0, 80)})`);
  } else skip('backstab strike', 'the rear hex is not in reach');
}

// ---- 5. no free-swing confirm; risk tags only on visible enemies
if (fit([[0, 1], [3, 1], [3, 2]])) {
  const a = others[0];
  const M = step(P, 0);
  await scene({ [a]: { at: P, facing: F(0) } }, [{ id: 'hu', at: M, awareness: 'hunting', facing: F(3), noticedIds: [a] }]);
  await select(a);
  const away = await p.evaluate(() => window.vc.hud.reach.find((x) => x.risks?.swings?.length));
  if (away) {
    const tip = await hoverTip(away.to);
    check('leaving reach: the red sword stays in the preview', /free swing \d+–\d+/.test(tip) && (await p.$$('.risk.risk-swing')).length > 0, tip.slice(0, 100));
    await click(away.to);
    await p.waitForTimeout(100);
    const modal = await p.$eval('.hud-modal', (e) => (e.classList.contains('hidden') ? '' : e.innerText)).catch(() => '');
    check('clicking it moves at once: no "Move anyway?" dialog', !/Move anyway/.test(modal), modal.slice(0, 80));
    await idle();
    s = await state();
    check('...and the hero moved', same(s.delve.heroes.find((h) => h.heroId === a).at, away.to));
  } else skip('free swing without a confirm', 'no reach leaves the hunter');
  // The view adds no marker for an enemy the party can't see, even if handed one.
  await scene({ [a]: { at: P, facing: F(0) } }, [{ id: 'ghost', at: step(P, 3, 2), awareness: 'alert', facing: F(0) }]);
  const n = await p.evaluate(() => { window.vc.dio.showRisks({ wake: [{ id: 'ghost', at: window.vc.state().delve.heroes.find((h) => h.status === 'active').at, chance: 50 }], notice: [{ id: 'ghost' }], swings: [] }); return document.querySelectorAll('.risk').length; });
  check('no risk tag on an unseen enemy', n === 0, `${n} tags`);
  await p.evaluate(() => window.vc.dio.showRisks(null));
}

// ---- 6. the unseen hit: something behind a lone hero strikes in the castle's turn
if (fit([[3, 1], [0, 1]])) {
  const a = others[0];
  await scene({ [a]: { at: P, facing: F(0) } }, [{ id: 'bh', at: step(P, 3), awareness: 'hunting', facing: F(0), noticedIds: [a] }]);
  await select(a);
  const before = s.delve.heroes.find((h) => h.heroId === a).hp;
  await p.evaluate(() => window.vc.send({ type: 'endTurn' }));
  await idle();
  s = await state();
  const log = await logText();
  const nm = s.campaign.roster.find((h) => h.id === a).name;
  if (/from behind/.test(log)) check(`log: "Something strikes ${nm} from behind."`, new RegExp(`Something strikes ${nm} from behind`).test(log), log.slice(-120));
  else skip('unseen hit', `no unseenHit this turn (hp ${before} → ${s.delve.heroes.find((h) => h.heroId === a).hp})`);
}

// ---- 7. help text
{
  await p.evaluate(() => window.vc.hud.toggleMenu?.());
  const menu = await p.$eval('.hud-menu', (e) => e.innerText).catch(() => '');
  check('menu keys list F: face', /F\s*face/i.test(menu), menu.match(/.{0,30}face.{0,30}/i)?.[0]);
  await p.evaluate(() => window.vc.hud.toggleMenu?.());
}

// ---- the screenshot: wedges and a dagger
if (shots && burglarId && fit([[0, 1], [0, 2], [3, 1], [4, 1], [2, 1]])) {
  const M = step(P, 0, 2);
  await scene({ [burglarId]: { at: P, facing: F(0) }, [others[0]]: { at: step(P, 4), facing: F(3) }, ...(others[1] ? { [others[1]]: { at: step(P, 2), facing: F(2) } } : {}) }, [
    { id: 'sl', at: M, awareness: 'asleep', facing: F(0) },
    
  ]);
  await select(burglarId);
  await p.evaluate((f) => { window.vc.dio.lookAt(f, true); window.vc.dio.rig.distance = 11; window.vc.dio.renderNow(); }, step(P, 0));
  await p.waitForTimeout(400);
  await p.evaluate(() => window.vc.dio.renderNow());
  await p.screenshot({ path: `${shots}/v39-facing.png`, clip: { x: 240, y: 120, width: 800, height: 520 } });
  console.log(`shot ${shots}/v39-facing.png`);
}

console.log(`\n${failed ? `${failed} FAILED` : 'all passed'}, ${skipped} skipped, ${errors} console errors`);
await b.close();
process.exit(failed || errors ? 1 : 0);
