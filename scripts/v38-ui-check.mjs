// V3.8 exploration-mode UI check (spec 22.8), headless, by DOM text and state, no screenshots:
// the mode label ("Exploring" / "Combat · round N"), the clock ticking and Space pausing it (overlay),
// multi-select (1, Shift+2) and a walk that moves both heroes, figures sliding between ticks, Esc
// stopping a walk, S toggling the selection's stance (crouched figure), vision cones drawn near the
// selection, the explore bar (no Move group, no End turn), a forced notice giving the "Combat!"
// banner and the combat bar, then "The castle quiets" back to exploring. No V3.7 free-move UI.
//   node scripts/v38-ui-check.mjs <baseUrl>        e.g. http://localhost:5185/?fixture=1
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';

const [base0 = 'http://localhost:5185/'] = process.argv.slice(2);
const base = base0 + (base0.includes('?') ? '&' : '?') + 'reveal=1';
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
const idle = () => p.waitForFunction(() => window.vc && !window.vc.busy(), null, { timeout: 60000 });
const st = () => p.evaluate(() => window.vc.state());
const modeText = () => p.$eval('.hud-mode', (e) => e.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
const edit = (fn, arg) => p.evaluate(([f, a]) => { const s = structuredClone(window.vc.state()); new Function('s', 'a', 'E', f)(s, a, window.vcEngine); window.vc.load(s); }, [fn, arg]);

await p.goto(base);
await p.evaluate(() => { localStorage.clear(); localStorage.setItem('vc.settings', JSON.stringify({ speed: 2, reduceShake: true, noEndTurnAsk: true })); });
await p.reload();
await p.waitForFunction(() => !!window.vc);
// A campaign with two heroes, then a delve.
await p.evaluate(async () => {
  const E = window.vcEngine;
  const s = E.apply(E.newGame(42), { type: 'newCampaign', seed: 42 }).state;
  s.campaign.gold = 500;
  window.vc.load(s);
  const r = s.campaign.recruits[0];
  if (r && s.campaign.roster.length < 2) await window.vc.send({ type: 'hire', heroId: r.hero.id });
  const t = window.vc.state();
  await window.vc.send({ type: 'startDelve', contractId: t.campaign.board[0].id, heroIds: t.campaign.roster.slice(0, 4).map((h) => h.id), entrance: 0, packs: {} });
});
await idle();
await p.waitForTimeout(300);
let s = await st();
check('the delve starts exploring', s.stage === 'delve' && s.delve.mode === 'explore', `mode ${s.delve?.mode}`);
check('mode label: "Exploring"', /Exploring/.test(await modeText()), await modeText());
check('explore bar: no End turn', !(await p.$('.hud-bar .bar-end')));
check('explore bar: no Move group (Walk/Sneak buttons)', !(await p.$('.hud-bar .bar-modes')));
check('explore bar: a stance toggle', !!(await p.$('.hud-bar .stance-btn')));
check('no V3.7 free-move UI (Follow, steps counter)', !(await p.$('.act-follow')) && !(await p.$('.bar-calm')) && !/Free move|castle turns in/.test(await p.evaluate(() => document.body.innerText)));

// The clock.
const t0 = s.delve.ticks ?? 0;
await p.waitForTimeout(1300);
s = await st();
check('the clock ticks (~300 ms at fast)', (s.delve.ticks ?? 0) >= t0 + 2, `ticks ${t0} → ${s.delve.ticks}`);
await p.keyboard.press('Space');
await p.waitForTimeout(100);
const tp = (await st()).delve.ticks;
check('Space pauses: the label says Paused', /Paused/i.test(await modeText()), await modeText());
check('...and the paused overlay shows', await p.$eval('.hud-paused', (e) => !e.classList.contains('hidden')));
await p.waitForTimeout(900);
check('...and no ticks while paused', (await st()).delve.ticks === tp, `${tp} → ${(await st()).delve.ticks}`);
await p.keyboard.press('Space');
await p.waitForTimeout(800);
check('Space again resumes', (await st()).delve.ticks > tp && !/Paused/i.test(await modeText()));
// Ticks don't rebuild the HUD while nothing changes (buttons stay clickable).
await p.evaluate(() => { window.__swaps = 0; for (const el of document.querySelectorAll('.hud-top, .hud-bar, .hud-cards')) new MutationObserver((ms) => { if (ms.some((m) => m.type === 'childList' && m.target === el)) window.__swaps++; }).observe(el, { childList: true }); });
const tq = (await st()).delve.ticks;
await p.waitForTimeout(1500);
check('idle ticks leave the bar, cards and top bar in place', (await p.evaluate(() => window.__swaps)) <= 1, `${await p.evaluate(() => window.__swaps)} rebuilds over ${(await st()).delve.ticks - tq} ticks`);
// A modal stops the clock.
await p.evaluate(() => document.querySelector('.hud-sys button:last-child').click());
await p.waitForTimeout(80);
const tm = (await st()).delve.ticks;
await p.waitForTimeout(800);
check('nothing ticks while the menu is open', (await st()).delve.ticks === tm);
await p.keyboard.press('Escape');

// Each figure slides over its own step interval: walking heroes 1 tick, patrols 4 (no walk-pause-walk).
const paces = await p.evaluate(async () => {
  const ms = window.vc.tickMs?.() ?? 300;
  for (let i = 0; i < 200; i++) {
    const g = [...window.vc.dio.glides.entries()].map(([id, x]) => ({ side: window.vc.dio.units.get(id)?.side, ticks: Math.round((x.dur * 1000) / ms) }));
    const mon = g.find((x) => x.side === 'monster');
    if (mon) return { mon: mon.ticks, all: g };
    await new Promise((r) => setTimeout(r, 25));
  }
  return null;
});
check('a patrol slides over its whole 4-tick step', paces?.mon === 4 || paces?.mon === 8, JSON.stringify(paces));
// Calm the scene for the walk: every monster asleep, far from the party.
await edit(`for (const m of s.delve.monsters) { m.awareness = 'asleep'; } for (const h of s.delve.heroes) { delete h.walk; h.sneaking = false; }`);
await p.waitForTimeout(100);
// Multi-select: 1, then Shift+2.
await p.keyboard.press('1');
await p.keyboard.down('Shift');
await p.keyboard.press('2');
await p.keyboard.up('Shift');
await p.waitForTimeout(100);
const sel = await p.evaluate(() => window.vc.hud.selection);
check('1 then Shift+2 selects two heroes', sel.length === 2, sel.join(','));
check('both cards marked selected', (await p.$$('.hcard.sel')).length === 2);
// A hex ~4 away the leader can walk to.
const target = await p.evaluate(() => {
  const s = window.vc.state();
  const E = window.vcEngine;
  const lead = s.delve.heroes.find((h) => h.heroId === window.vc.hud.selection[0]);
  const lv = E.castle().levels.find((l) => l.level === lead.at.level);
  let best = null;
  for (const k of Object.keys(lv.tiles)) {
    const [q, r] = k.split(',').map(Number);
    const at = { level: lead.at.level, q, r };
    const d = (Math.abs(q - lead.at.q) + Math.abs(r - lead.at.r) + Math.abs(q + r - lead.at.q - lead.at.r)) / 2;
    if (d < 3 || d > 6) continue;
    const reach = E.explorePath(s, lead.heroId, at, false);
    if (reach && reach.path.length >= 3 && reach.path.length <= 8 && (!best || reach.path.length > best.n)) best = { at, n: reach.path.length };
  }
  return best;
});
check('a walkable explored hex to aim at', !!target, JSON.stringify(target));
if (target) {
  await p.evaluate((at) => window.vc.hud.onHover(at, null), target.at);
  const tip = await p.$eval('.hud-tip', (e) => e.innerText).catch(() => '');
  check('hover shows the walk path ("Walk N hexes ... 1 more follows")', /Walk \d+ hex/.test(tip) && /follow/.test(tip), tip.replace(/\n/g, ' | ').slice(0, 120));
  check('...and the path is drawn', (await p.evaluate(() => window.vc.dio.pathDots.count)) > 0);
  const before = (await st()).delve.heroes.filter((h) => sel.includes(h.heroId)).map((h) => `${h.at.q},${h.at.r}`);
  await p.evaluate((at) => window.vc.hud.onClick(at, null, { button: 0, shiftKey: false }), target.at);
  await p.waitForTimeout(120);
  s = await st();
  const orders = s.delve.heroes.filter((h) => sel.includes(h.heroId) && h.walk?.path.length).length;
  check('a click gives both heroes walk orders', orders === 2, `orders ${orders}`);
  // Smooth motion: sample the leader's figure; sampled between frames.
  const samples = await p.evaluate(async (id) => {
    const out = [];
    for (let i = 0; i < 14; i++) {
      const v = window.vc.dio.units.get(id);
      // Headless WebGL draws ~1 frame a second here: step the slide the way a frame would.
      window.vc.dio.updateGlides(performance.now() / 1000);
      out.push({ x: v.root.position.x, z: v.root.position.z, gliding: window.vc.dio.isGliding(id), bar: document.querySelector('.hud-bar')?.innerText ?? '' });
      await new Promise((r) => setTimeout(r, 70));
    }
    return out;
  }, sel[0]);
  // Hex centres (size 1, pointy): x = √3(q + r/2), z = 1.5 r. A sample off every centre is mid-slide.
  const off = samples.filter((q) => {
    const r = q.z / 1.5;
    const qq = q.x / Math.sqrt(3) - r / 2;
    return Math.abs(r - Math.round(r)) > 0.05 || Math.abs(qq - Math.round(qq)) > 0.05;
  }).length;
  check('figures slide between ticks (caught mid-hex, gliding)', off >= 1 && samples.some((q) => q.gliding), `${off} of ${samples.length} samples mid-hex; ${samples.map((q) => `${q.x.toFixed(2)}${q.gliding ? "g" : ""}`).join(" ")}`);
  check('the bar shows the walk order', samples.some((q) => /walking · \d+ hex/i.test(q.bar)), samples[1]?.bar.replace(/\n/g, ' | ').slice(0, 120));
  await p.waitForTimeout(900);
  const mid = (await st()).delve.heroes.filter((h) => sel.includes(h.heroId)).map((h) => `${h.at.q},${h.at.r}`);
  check('both heroes have moved', mid.every((m, i) => m !== before[i]), `${before.join(' ')} → ${mid.join(' ')}`);
  // Esc stops the walk.
  await p.keyboard.press('Escape');
  await p.waitForTimeout(150);
  check('Esc stops the selection', (await st()).delve.heroes.filter((h) => sel.includes(h.heroId) && h.walk).length === 0);
}
// S: the selection sneaks; figures crouch.
await p.keyboard.press('s');
await p.waitForTimeout(150);
s = await st();
check('S: both selected heroes sneak', s.delve.heroes.filter((h) => sel.includes(h.heroId)).every((h) => h.sneaking));
check('...and crouch', await p.evaluate((ids) => ids.every((id) => window.vc.dio.units.get(id).isCrouched), sel));
check('...and the bar says Sneaking', /Sneaking/.test(await p.$eval('.hud-bar', (e) => e.innerText)));
await p.keyboard.press('s');
await p.waitForTimeout(150);
check('S again: walking', (await st()).delve.heroes.filter((h) => sel.includes(h.heroId)).every((h) => !h.sneaking));

// Cones: wake a monster 5 hexes in front of the leader, pause, look.
await p.keyboard.press('Space');
const placed = await p.evaluate(() => {
  const s = structuredClone(window.vc.state());
  const E = window.vcEngine;
  const lead = s.delve.heroes.find((h) => h.heroId === window.vc.hud.selectedId);
  const m = s.delve.monsters.find((x) => x.at.level === lead.at.level && x.kind !== 'dragon') ?? s.delve.monsters[0];
  // Somewhere 3–5 hexes off with a facing that sees the leader walking but not sneaking past: try them all.
  const lv = E.castle().levels.find((l) => l.level === lead.at.level);
  const key = (p) => `${p.level}:${p.q},${p.r}`;
  for (const k of [4, 5, 3]) {
    for (const [dq, dr] of [[k, 0], [-k, 0], [0, k], [0, -k], [k, -k], [-k, k], [k - 1, 1 - k + 1], [1, k - 1]]) {
      const at = { level: lead.at.level, q: lead.at.q + dq, r: lead.at.r + dr };
      const t = lv.tiles[`${at.q},${at.r}`];
      if (!t || !['floor', 'rubble'].includes(t.kind) || s.delve.heroes.some((h) => key(h.at) === key(at))) continue;
      for (let f = 0; f < 6; f++) {
        m.at = at;
        m.awareness = 'patrol';
        m.facing = f;
        delete m.route;
        delete m.routeIndex;
        const v = E.vision(s).find((x) => x.id === m.id);
        if (v && v.walk.some((p) => key(p) === key(lead.at)) && v.sneak.length) {
          window.vc.load(s);
          return { id: m.id, at, f };
        }
      }
    }
  }
  return null;
});
await p.waitForTimeout(200);
const cones = await p.evaluate(() => ({ walk: window.vc.dio.visionWalk.count, sneak: window.vc.dio.visionSneak.count, vision: window.vcEngine.vision(window.vc.state()).length }));
check('vision cones drawn near the selection (walk red, sneak darker)', !!placed && cones.walk > 0 && cones.sneak > 0, JSON.stringify({ placed, ...cones }));
check('the patrol shows → over it', await p.evaluate((id) => !!document.querySelector(`.unit-tag[data-id="${id}"] .tag-patrol`), placed?.id));
const glow = await p.evaluate(() => document.querySelector('.hud-vignette').classList.contains('in-cone'));
check('red edge glow: a walking selected hero stands in a cone', glow);

// A forced notice: unpause; the next tick, the monster notices the walking hero: "Combat!" banner.
let banner = '';
const watch = p.evaluate(async () => {
  for (let i = 0; i < 200; i++) {
    const b = document.querySelector('.hud-banner.mode-banner:not(.hidden)');
    if (b) return b.innerText.replace(/\s+/g, ' ');
    await new Promise((r) => setTimeout(r, 25));
  }
  return '';
});
await p.keyboard.press('Space');
banner = await watch;
await idle();
s = await st();
check('a notice starts combat with the "Combat!" banner', /Combat!/.test(banner) && s.delve.mode === 'combat', `${banner} · mode ${s.delve.mode}`);
check('mode label: "Combat · round N"', /Combat · round \d+/.test(await modeText()), await modeText());
check('combat bar: End turn and the Move group are back', !!(await p.$('.hud-bar .bar-end')) && !!(await p.$('.hud-bar .bar-modes')));
check('the hunter shows !', await p.evaluate((id) => !!document.querySelector(`.unit-tag[data-id="${id}"] .tag-hunt`), placed?.id));
const tc = (await st()).delve.ticks;
await p.waitForTimeout(700);
check('no ticks in combat', (await st()).delve.ticks === tc);

// Back to exploring: the hunter loses interest; end the turn.
await edit(`for (const m of s.delve.monsters) m.awareness = 'asleep';`);
const watch2 = p.evaluate(async () => {
  for (let i = 0; i < 1600; i++) {
    const b = document.querySelector('.hud-banner.mode-banner:not(.hidden)');
    if (b && /quiets/.test(b.innerText)) return b.innerText.replace(/\s+/g, ' ');
    await new Promise((r) => setTimeout(r, 25));
  }
  return '';
});
await p.evaluate(() => window.vc.send({ type: 'endTurn' }));
const b2 = await watch2;
await idle();
s = await st();
check('"The castle quiets": back to exploring', /quiets/.test(b2) && s.delve.mode === 'explore', `${b2} · mode ${s.delve.mode}`);
check('mode label: "Exploring" again', /Exploring/.test(await modeText()));

console.log(`[errors] ${errors} · [failed] ${failed}`);
await b.close();
process.exit(failed || errors ? 1 : 0);
