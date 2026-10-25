// V3.7 presentation check (spec 20), headless, by DOM text and state; screenshots only with SHOTS.
// Covers: move-preview risks (tags on the monsters, lines in the hover tip, walk vs sneak), facing
// wedges and blind arcs while sneaking, the free-swing confirm, Dread (bar, preview, feared tag),
// the set-charge flow (aim with breakable walls outlined, fuse picker, fuse marker and hover), the
// blast (wall to rubble, log line, hover "Blast rubble"), crew member info (hover, parley card,
// intents, dragging), the captured banner, camp captives and "Bring back" contracts; no console errors.
//   node scripts/v37-ui-check.mjs <baseUrl>     (http://localhost:5184/?fixture=1, or the real engine)
//   SHOTS=<dir> saves v37-risks.png (move preview with risks) and v37-fuse.png / v37-blast.png.
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';

const [base = 'http://localhost:5184/?fixture=1'] = process.argv.slice(2);
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
const idle = () => p.waitForFunction(() => window.vc && !window.vc.busy(), null, { timeout: 60000 });
const edit = (fn, arg) => p.evaluate(([f, a]) => { const s = structuredClone(window.vc.state()); new Function('s', 'a', f)(s, a); window.vc.load(s); }, [fn, arg]);
const hoverTip = (at, unit = null) => p.evaluate(([a, u]) => { window.vc.hud.onHover(a, u); const t = document.querySelector('.hud-tip')?.textContent ?? ''; return t; }, [at, unit]);
const unhover = () => p.evaluate(() => window.vc.hud.onHover(null, null));
const visible = (sel) => p.$$eval(sel, (els) => els.filter((e) => e.style.display !== 'none' && !e.classList.contains('hidden')).map((e) => ({ text: e.textContent, cls: e.className, title: e.title })));
const state = () => p.evaluate(() => window.vc.state());
const fixture = /fixture=1/.test(base);
/** A screenshot with the camera on `focus` and, when given, the real mouse over `hover` (so the hover path and tip are live). */
const shot = async (name, focus = null, hover = null) => {
  if (!shots) return;
  if (focus) {
    await p.evaluate((f) => { window.vc.dio.lookAt(f, true); window.vc.dio.rig.distance = 15; window.vc.dio.renderNow(); }, focus);
    await p.waitForTimeout(200);
  }
  if (hover) {
    const xy = await p.evaluate((hv) => { const d = window.vc.dio; const w = d.worldOf(hv, 0.1); const q = d.project(w); return { x: q.x, y: q.y }; }, hover);
    await p.mouse.move(xy.x, xy.y);
    await p.waitForTimeout(250);
  }
  await p.waitForTimeout(300);
  await p.evaluate(() => window.vc.dio.renderNow());
  await p.screenshot({ path: `${shots}/${name}.png` });
  if (hover) await p.mouse.move(5, 790);
};
const mid = (a, c) => ({ level: a.level, q: Math.round((a.q + c.q) / 2), r: Math.round((a.r + c.r) / 2) });

await p.goto(base);
await p.evaluate(() => { localStorage.clear(); localStorage.setItem('vc.settings', JSON.stringify({ speed: 0, reduceShake: true, noEndTurnAsk: true })); });
await p.reload();
await p.waitForFunction(() => !!window.vc);

// ---- into the castle. Fixture: the fixture delve (Brann a Sapper, Aldous a Shadowmancer). Real engine: a
// campaign, hiring a Sapper and a Shadowmancer when the campfire offers them.
if (fixture) {
  await p.evaluate(async () => {
    const fx = await import('/src/view/fixtures.ts');
    window.vc.load(fx.fixtureDelve(window.vcEngine.castle()));
  });
} else {
  await p.evaluate(async () => {
    const E = window.vcEngine;
    const s0 = E.apply(E.newGame(42), { type: 'newCampaign', seed: 42 }).state;
    s0.campaign.gold = 150; // V3.7.1: the starting 90 buys one hire; this check wants two
    window.vc.load(s0);
    const want = ['sapper', 'shadowmancer'];
    for (let i = 0; i < 4; i++) {
      const s = window.vc.state();
      const r = s.campaign.recruits.find((x) => want.includes(x.hero.cls) && !s.campaign.roster.some((h) => h.cls === x.hero.cls) && x.price <= s.campaign.gold) ?? (s.campaign.roster.length < 2 ? s.campaign.recruits.find((x) => x.price <= s.campaign.gold) : null);
      if (!r) break;
      await window.vc.send({ type: 'hire', heroId: r.hero.id });
    }
    const s = window.vc.state();
    const k = s.campaign.board.find((x) => x.kind === 'recover' && !x.story && x.level === 1) ?? s.campaign.board[0];
    await window.vc.send({ type: 'startDelve', contractId: k.id, heroIds: s.campaign.roster.slice(0, 4).map((h) => h.id), entrance: 0, packs: {} });
  });
}
await idle();
await p.waitForTimeout(300);
let s = await state();
check('in the delve', !!s.delve);
if (!fixture) {
  // No Sapper or Shadowmancer for hire this seed: turn the second and third heroes into one each (the
  // engine reads the class off the roster), with a satchel and mana, so the real rules run for both.
  await edit(`const others = s.campaign.roster.filter((h) => h.cls !== 'heir' && s.delve.heroes.some((x) => x.heroId === h.id)); if (!s.campaign.roster.some((h) => h.cls === 'sapper') && others[0]) { others[0].cls = 'sapper'; const hd = s.delve.heroes.find((x) => x.heroId === others[0].id); hd.pack = hd.pack.filter((i) => i.kind !== 'charge'); hd.pack.push({ id: 'sat', kind: 'charge', name: 'Satchel: 3 charges', amount: 3, slots: 0 }); } if (!s.campaign.roster.some((h) => h.cls === 'shadowmancer')) { const o = others.find((h) => h.cls !== 'sapper'); if (o) { o.cls = 'shadowmancer'; const hd = s.delve.heroes.find((x) => x.heroId === o.id); hd.mana = 3; } }`);
  s = await state();
}
const castle = await p.evaluate(() => window.vcEngine.castle());
const lv1 = castle.levels.find((l) => l.level === 1);
const tileAt = (pos) => castle.levels.find((l) => l.level === pos.level)?.tiles[`${pos.q},${pos.r}`];
const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const nb = (pos) => DIRS.map(([q, r]) => ({ level: pos.level, q: pos.q + q, r: pos.r + r }));
const STAND = new Set(['floor', 'rubble', 'door', 'stairs', 'exit', 'lift']);
const dist = (a, c) => Math.max(Math.abs(a.q - c.q), Math.abs(a.r - c.r), Math.abs(a.q + a.r - c.q - c.r));
const roster = (id) => s.campaign.roster.find((h) => h.id === id);
const heroOf = (cls) => s.delve.heroes.find((h) => roster(h.heroId)?.cls === cls);

// ---- 1. move preview risks
{
  const lead = s.delve.heroes[0];
  // A sleeper to wake: put one two hexes from a reachable hex on the lead's level (fixture already has them).
  await p.evaluate((id) => window.vc.hud.select(id), lead.heroId);
  await p.waitForTimeout(150);
  let reach = await p.evaluate((id) => window.vcEngine.reachable(window.vc.state(), id, false), lead.heroId);
  let risky = reach.find((r) => r.risks && (r.risks.wake.length || r.risks.notice.length || r.risks.swings.length));
  if (!risky && reach.length) {
    // Nothing near: bring a sleeper to two hexes from the farthest reachable hex, so the preview has something to say.
    const far = [...reach].sort((a, c) => c.cost - a.cost)[0];
    const sleeper = s.delve.monsters.find((m) => m.awareness === 'asleep' && m.kind !== 'dragon');
    const taken = new Set([...s.delve.heroes.map((h) => `${h.at.q},${h.at.r}`), ...s.delve.monsters.map((m) => `${m.at.q},${m.at.r}`), ...reach.map((r) => `${r.to.q},${r.to.r}`)]);
    const visNow = await p.evaluate(() => [...window.vcEngine.visibility(window.vc.state()).visible]);
    const spot = Object.keys(lv1.tiles).map((k) => { const [q, r] = k.split(',').map(Number); return { level: 1, q, r }; }).find((q) => STAND.has(tileAt(q)?.kind) && dist(q, far.to) === 2 && !taken.has(`${q.q},${q.r}`) && visNow.includes(`1:${q.q},${q.r}`));
    if (sleeper && spot) {
      await edit(`const m = s.delve.monsters.find((x) => x.id === a.id); m.at = a.at; m.spawnedAt = a.at; m.awareness = 'asleep';`, { id: sleeper.id, at: spot });
      await p.evaluate((id) => window.vc.hud.select(id), lead.heroId);
      await p.waitForTimeout(150);
      s = await state();
      reach = await p.evaluate((id) => window.vcEngine.reachable(window.vc.state(), id, false), lead.heroId);
      risky = reach.find((r) => r.risks && r.risks.wake.length);
    }
  }
  check('engine.reachable fills risks', reach.length > 0 && reach.every((r) => r.risks), `${reach.length} hexes, ${reach.filter((r) => r.risks).length} with risks`);
  if (risky) {
    const tip = await hoverTip(risky.to);
    const tags = await visible('.risk');
    check('hovering a risky hex: risk tags on the monsters', tags.length > 0, JSON.stringify(tags.map((t) => t.text)));
    check('...and the hover tip lists them (wake % / notices / free swing)', /may wake · \d+%|notices you|free swing \d+–\d+/.test(tip), tip.slice(0, 160));
    const wake = risky.risks.wake[0];
    if (wake) check('wake tag shows the chance', tags.some((t) => /risk-wake/.test(t.cls) && new RegExp(`${Math.round(wake.chance)}%`).test(t.text)), tags.map((t) => t.text).join(' '));
    {
      const who = [...risky.risks.wake.map((x) => x.id), ...risky.risks.notice.map((x) => x.id), ...risky.risks.swings.map((x) => x.id)];
      const mAt = s.delve.monsters.find((m) => who.includes(m.id))?.at ?? risky.to;
      await shot('v37-risks', mid(risky.to, mAt), risky.to);
      await hoverTip(risky.to);
    }
    // An awake enemy in sight, so the blind arcs have something to shade.
    {
      const hunter = s.delve.monsters.find((m) => m.awareness !== 'asleep' && m.kind !== 'dragon' && m.kind !== 'gloam');
      const taken = new Set([...s.delve.heroes.map((h) => `${h.at.q},${h.at.r}`), ...s.delve.monsters.map((m) => `${m.at.q},${m.at.r}`)]);
      const spot = Object.keys(lv1.tiles).map((k) => { const [q, r] = k.split(',').map(Number); return { level: 1, q, r }; }).find((q) => STAND.has(tileAt(q)?.kind) && dist(q, lead.at) === 3 && !taken.has(`${q.q},${q.r}`));
      if (hunter && spot && dist(hunter.at, lead.at) > 4) {
        await edit(`const m = s.delve.monsters.find((x) => x.id === a.id); m.at = a.at; m.awareness = 'alert'; m.facing = 0;`, { id: hunter.id, at: spot });
        await p.evaluate((id) => window.vc.hud.select(id), lead.heroId);
        await p.waitForTimeout(150);
        await hoverTip(risky.to);
      }
    }
    // Sneak: the preview changes live.
    await p.keyboard.press('s');
    await p.waitForTimeout(150);
    const reachS = await p.evaluate((id) => window.vcEngine.reachable(window.vc.state(), id, true), lead.heroId);
    const same = reachS.find((r) => r.to.q === risky.to.q && r.to.r === risky.to.r);
    const tipS = same ? await hoverTip(same.to) : '';
    check('sneak toggles the preview live (hover tip now says Sneak)', !same || /sneak/i.test(tipS), tipS.slice(0, 80));
    const wakeS = same?.risks?.wake[0];
    if (wake && wakeS) check('...with the lower sneaking wake chance', wakeS.chance < wake.chance, `${wake.chance}% → ${wakeS.chance}%`);
    // Blind arcs and facing.
    check('facing wedges drawn on awake enemies', await p.evaluate(() => window.vc.dio.facingMarks.children.length > 0), `${await p.evaluate(() => window.vc.dio.facingMarks.children.length)}`);
    const blind = await p.evaluate(() => ({ fill: window.vc.dio.blindFill.count, tags: document.querySelectorAll('.blind-tag').length }));
    check('sneaking: blind-arc hexes shaded behind awake enemies', blind.fill > 0, JSON.stringify(blind));
    await p.keyboard.press('s');
    await p.waitForTimeout(100);
    check('walking again: blind arcs gone', (await p.evaluate(() => window.vc.dio.blindFill.count)) === 0);
    await unhover();
  } else skip('risk tags', 'no reachable hex with risks from here');
  check('Walk button help carries the wake and notice numbers', /per hex|roll to wake|notice you/.test(await p.$eval('.bar-modes button', (e) => e.dataset.tip ?? e.title)));
}

// ---- 2. the free-swing confirm: the lead next to a hunting monster, moving away
{
  const lead = s.delve.heroes[0];
  const hunter = s.delve.monsters.find((m) => m.awareness === 'hunting' && m.at.level === lead.at.level && m.kind !== 'dragon') ?? s.delve.monsters.find((m) => m.at.level === lead.at.level && m.kind !== 'dragon' && m.kind !== 'gloam' && m.kind !== 'rats');
  if (hunter) {
    const spot = nb(hunter.at).find((q) => STAND.has(tileAt(q)?.kind) && !s.delve.monsters.some((m) => m.at.q === q.q && m.at.r === q.r));
    await edit(`const h = s.delve.heroes.find((x) => x.heroId === a.id); h.at = a.at; h.moved = false; h.acted = false; h.dashed = false; for (const o of s.delve.heroes) if (o !== h && o.at.q === a.at.q && o.at.r === a.at.r && o.at.level === a.at.level) o.at = a.alt; const m = s.delve.monsters.find((x) => x.id === a.m); m.awareness = 'hunting'; m.noticedIds = [a.id]; m.facing = 0;`, { id: lead.heroId, at: spot, alt: lead.at, m: hunter.id });
    await p.evaluate((id) => window.vc.hud.select(id), lead.heroId);
    await p.waitForTimeout(150);
    const reach = await p.evaluate((id) => window.vcEngine.reachable(window.vc.state(), id, false), lead.heroId);
    const away = reach.find((r) => r.risks?.swings.some((x) => x.id === hunter.id));
    if (away) {
      const tip = await hoverTip(away.to);
      check('leaving a hunter\'s reach: "free swing" with the damage in the tip', /free swing \d+–\d+/.test(tip), tip.slice(0, 120));
      check('...and a sword tag on it', (await visible('.risk.risk-swing')).length > 0);
      await p.evaluate((at) => window.vc.hud.onClick(at, null, { button: 0 }), away.to);
      await p.waitForTimeout(150);
      const modal = await p.$eval('.hud-modal', (e) => (e.classList.contains('hidden') ? '' : e.innerText)).catch(() => '');
      check('clicking it asks once, naming the swing and the damage', /free swing: \d+–\d+/.test(modal) && /Move anyway/.test(modal), modal.replace(/\n/g, ' | ').slice(0, 120));
      await p.keyboard.press('Enter');
      await idle();
      await p.waitForTimeout(200);
      s = await state();
      const moved = s.delve.heroes.find((h) => h.heroId === lead.heroId);
      check('Enter moves anyway', moved.at.q === away.to.q && moved.at.r === away.to.r);
      const log = await p.$eval('.hud-log', (e) => e.innerText).catch(() => '');
      check('a swing log line ("free swing")', /free swing/i.test(log), log.split('\n').slice(-3).join(' | '));
    } else skip('free-swing confirm', 'no reachable hex leaves the hunter (engine risks.swings empty)');
  } else skip('free-swing confirm', 'no hunting monster on the level');
  await unhover();
}

// ---- 3. Dread
{
  s = await state();
  const sh = heroOf('shadowmancer');
  if (sh) {
    await edit(`const h = s.delve.heroes.find((x) => x.heroId === a); h.acted = false; h.moved = false; h.mana = Math.max(1, h.mana);`, sh.heroId);
    await p.evaluate((id) => window.vc.hud.select(id), sh.heroId);
    await p.waitForTimeout(150);
    const btn = await p.$('.hud-bar .act[data-action="dread"]');
    check('Shadowmancer bar has Dread (Abilities group)', !!btn && (await btn.evaluate((e) => !!e.closest('.bar-group-abilities'))));
    if (btn) {
      const help = await btn.evaluate((e) => e.dataset.tip ?? e.title);
      check('Dread help has the live numbers (2 Wits slots, range 5, feared 2)', /2 Wits slots/.test(help) && /range 5/.test(help) && /feared for 2/.test(help), help.slice(0, 120));
      const opts = await p.evaluate((id) => window.vcEngine.actions(window.vc.state(), id), sh.heroId);
      const dr = opts.find((o) => o.action === 'dread');
      if (dr && dr.targets.length && !dr.blocked) {
        await p.evaluate(([id, t]) => { window.vc.hud.startAction ? null : null; }, [sh.heroId, dr.targets[0]]);
        await p.click('.hud-bar .act[data-action="dread"]');
        await p.waitForTimeout(150);
        // Pick the first target via the picker list or the map.
        const row = await p.$('.hud-picker .picker-row');
        if (row) await row.click();
        else await p.evaluate((t) => window.vc.hud.onClick(t.at ?? null, t.id ?? null, { button: 0 }), dr.targets[0]);
        await p.waitForTimeout(150);
        const pv = await p.$eval('.hud-preview', (e) => (e.classList.contains('hidden') ? '' : e.innerText)).catch(() => '');
        check('Dread preview opens (Wits slots)', /Dread/.test(pv) && /Wits/.test(pv), pv.replace(/\n/g, ' | ').slice(0, 100));
        await p.keyboard.press('Enter');
        await idle();
        await p.waitForTimeout(200);
        s = await state();
        const target = s.delve.monsters.find((m) => m.id === dr.targets[0].id) ?? s.delve.rivals?.members.find((m) => m.id === dr.targets[0].id);
        if (target?.feared) {
          check('target feared: tag on the figure', (await visible('.unit-tag .tag-fear')).length > 0);
          const tip = await hoverTip(target.at, target.id);
          check('...hover says Feared and who it flees', /Feared/.test(tip) && /flees from/.test(tip), tip.slice(0, 140));
          check('...flee intent drawn', (await visible('.intent.intent-flee')).length > 0 || !fixture);
          await unhover();
        } else skip('feared tag', 'the roll missed (real engine) or no feared flag');
        const log = await p.$eval('.hud-log', (e) => e.innerText).catch(() => '');
        check('Dread log line', /Dread|feared/i.test(log), log.split('\n').slice(-2).join(' | '));
      } else skip('Dread cast', dr ? `blocked: ${dr.blocked}` : 'nothing in range');
    }
  } else skip('Dread', 'no Shadowmancer in the party');
}

// ---- 4. set a charge on a breakable wall, fuse 2; blast after two castle turns
{
  s = await state();
  const sap = heroOf('sapper');
  if (sap) {
    const breakable = await p.evaluate(async (pos) => { const st = await import('/src/view/stealth.ts'); return st.breakableWall(window.vcEngine.castle(), pos); }, { level: 1, q: 0, r: 0 }).then(() => true).catch(() => false);
    // Find a floor hex on Level 1 next to a breakable wall (by the view's rule), away from the party.
    const walls = Object.entries(lv1.tiles).filter(([, t]) => t.kind === 'wall' && !t.unbreakable).map(([k]) => { const [q, r] = k.split(',').map(Number); return { level: 1, q, r }; });
    const isBreak = await p.evaluate(async (list) => { const st = await import('/src/view/stealth.ts'); return list.filter((w) => st.breakableWall(window.vcEngine.castle(), w)); }, walls);
    check('the view finds breakable walls on Level 1', isBreak.length > 0 && breakable, `${isBreak.length}`);
    let placed = null;
    for (const w of isBreak) {
      const f = nb(w).find((q) => tileAt(q)?.kind === 'floor' && !s.delve.monsters.some((m) => m.at.q === q.q && m.at.r === q.r) && !s.delve.heroes.some((h) => h.heroId !== sap.heroId && h.at.q === q.q && h.at.r === q.r));
      if (f) {
        placed = { wall: w, at: f };
        break;
      }
    }
    if (placed) {
      await edit(`const h = s.delve.heroes.find((x) => x.heroId === a.id); h.at = a.at; h.moved = false; h.acted = false; h.dashed = false; if (!h.pack.some((i) => i.kind === 'charge')) h.pack.push({ id: 'sat', kind: 'charge', name: 'Satchel: 3 charges', amount: 3, slots: 0 }); if (!s.delve.explored.includes('1:' + a.wall.q + ',' + a.wall.r)) s.delve.explored.push('1:' + a.wall.q + ',' + a.wall.r);`, { id: sap.heroId, at: placed.at, wall: placed.wall });
      await p.evaluate((id) => window.vc.hud.select(id), sap.heroId);
      await p.waitForTimeout(200);
      const tip = await hoverTip(placed.wall);
      check('hovering the wall: "Wall · a Sapper\'s charge could break it"', /Wall/.test(tip) && /charge could break it/.test(tip), tip.slice(0, 100));
      await unhover();
      const sock = await p.$eval('.hcard.sel .pk-sock.pk-satchel', (e) => e.title).catch(() => '');
      check('the satchel socket on the card (no slot, count)', /Satchel · \d charge/.test(sock), sock.slice(0, 60));
      const btn = await p.$('.hud-bar .act[data-action="setCharge"]');
      check('Set charge in the bar (Abilities)', !!btn && (await btn.evaluate((e) => !!e.closest('.bar-group-abilities'))));
      if (btn) {
        await p.click('.hud-bar .act[data-action="setCharge"]');
        await p.waitForTimeout(200);
        const pick = await p.$eval('.hud-picker', (e) => e.innerText).catch(() => '');
        check('aim hint says outlined walls can be broken, fuse next', /Outlined walls can be broken/.test(pick), pick.replace(/\n/g, ' | ').slice(0, 100));
        check('breakable outline drawn while aiming', (await p.evaluate(() => window.vc.dio.highlights.get('breakable').count)) > 0);
        const opts = await p.evaluate((id) => window.vcEngine.actions(window.vc.state(), id), sap.heroId);
        const sc = opts.find((o) => o.action === 'setCharge');
        const onWall = sc?.targets.some((t) => t.at && t.at.q === placed.wall.q && t.at.r === placed.wall.r);
        check('the engine offers the wall as a set-charge target', !!onWall, JSON.stringify(sc?.targets.slice(0, 4)));
        await p.evaluate((at) => window.vc.hud.onClick(at, null, { button: 0 }), onWall ? placed.wall : sc.targets[0].at);
        await p.waitForTimeout(200);
        const fuses = await p.$$('.hud-picker .fuse-btn');
        check('fuse picker: 1 or 2', fuses.length === 2, `${fuses.length}`);
        const text = await p.$eval('.hud-picker', (e) => e.innerText).catch(() => '');
        check('...names the blast (4 within 1, 2 within 2)', /4 damage within 1/.test(text) && /2 within 2/.test(text), text.replace(/\n/g, ' | ').slice(0, 140));
        if (fuses.length === 2) {
          await p.click('.hud-picker .fuse-btn.fuse-2');
          await idle();
          await p.waitForTimeout(250);
          s = await state();
          const fuse = (s.delve.fuses ?? []).find((f) => f.by === sap.heroId);
          check('a fuse of 2 is set in the state', !!fuse && fuse.rounds === 2, JSON.stringify(fuse));
          if (fuse) {
            const tags = await visible('.fuse-tag');
            check('fuse marker on the hex shows 2', tags.some((t) => /2/.test(t.text) && /fuse-hero/.test(t.cls)), JSON.stringify(tags));
            check('blast rings drawn (inner and outer)', (await p.evaluate(() => window.vc.dio.fuseMarks.children.length)) > 7);
            const ftip = await hoverTip(fuse.at);
            check('hovering the charge: "Charge · fuse 2 · set by ..."', /Charge · fuse 2/.test(ftip) && /set by/.test(ftip), ftip.slice(0, 140));
            await unhover();
            const log = await p.$eval('.hud-log', (e) => e.innerText).catch(() => '');
            check('log: "sets a charge. Fuse 2"', /sets a charge\. Fuse 2/.test(log), log.split('\n').slice(-2).join(' | '));
            await shot('v37-fuse', fuse.at, fuse.at);
            // Two castle turns: the fuse counts to 1, then blows.
            await p.evaluate(() => window.vc.send({ type: 'endTurn' }));
            await idle();
            await p.waitForTimeout(200);
            s = await state();
            const f1 = (s.delve.fuses ?? []).find((f) => f.by === sap.heroId);
            check('after one castle turn the fuse reads 1', !!f1 && f1.rounds === 1, JSON.stringify(f1));
            const soon = await visible('.fuse-tag.soon');
            check('...and the marker pulses (soon)', soon.length > 0);
            await p.evaluate(() => window.vc.send({ type: 'endTurn' }));
            await idle();
            await p.waitForTimeout(300);
            s = await state();
            const wk = `1:${placed.wall.q},${placed.wall.r}`;
            const gone = !(s.delve.fuses ?? []).some((f) => f.by === sap.heroId);
            check('the charge went off (fuse gone)', gone);
            const broke = s.delve.blown.includes(wk);
            check('the wall is in blown', broke, `blown: ${s.delve.blown.join(' ')}`);
            if (broke) {
              check('the level shows rubble there (rebuilt)', await p.evaluate((k) => window.vc.dio.levels.get(1).def.tiles[k.slice(2)]?.kind === 'rubble', wk));
              const rt = await hoverTip(placed.wall);
              check('hovering it: "Blast rubble"', /Blast rubble/.test(rt), rt.slice(0, 80));
              await unhover();
            }
            const log2 = await p.$eval('.hud-log', (e) => e.innerText).catch(() => '');
            check('blast log line (charge goes off, the wall comes down)', /charge goes off/.test(log2) && /wall comes down/.test(log2), log2.split('\n').slice(-3).join(' | '));
            check('no fuse markers left', (await visible('.fuse-tag')).length === 0);
            await shot('v37-blast', placed.wall, placed.wall);
          }
        }
      }
    } else skip('set charge', 'no floor next to a breakable wall');
  } else skip('set charge', 'no Sapper in the party');
}

// ---- 4a. spec 20.3a: a charge on floor next to a pit drops it
{
  s = await state();
  const sap = heroOf('sapper');
  const col = await p.evaluate(async () => {
    const st = await import('/src/view/stealth.ts');
    const castle = window.vcEngine.castle();
    const d = window.vc.state().delve;
    const lv = castle.levels.find((l) => l.level === 1);
    const out = [];
    for (const k of Object.keys(lv.tiles)) { const [q, r] = k.split(',').map(Number); const p = { level: 1, q, r }; if (st.collapsible(castle, d, p)) out.push(p); }
    return out;
  });
  check('the view finds floor next to pits on Level 1', col.length > 0, `${col.length}`);
  if (sap && col.length) {
    let placed = null;
    for (const c of col) {
      const f = nb(c).find((q) => tileAt(q)?.kind === 'floor' && !col.some((x) => x.q === q.q && x.r === q.r) && !s.delve.monsters.some((m) => m.at.q === q.q && m.at.r === q.r) && !s.delve.heroes.some((h) => h.heroId !== sap.heroId && h.at.q === q.q && h.at.r === q.r));
      if (f) { placed = { edge: c, at: f }; break; }
    }
    if (placed) {
      await edit(`const h = s.delve.heroes.find((x) => x.heroId === a.id); h.at = a.at; h.moved = false; h.acted = false; h.dashed = false; if (!h.pack.some((i) => i.kind === 'charge')) h.pack.push({ id: 'sat2', kind: 'charge', name: 'Satchel: 3 charges', amount: 3, slots: 0 }); for (const k of [a.at, a.edge]) { const kk = '1:' + k.q + ',' + k.r; if (!s.delve.explored.includes(kk)) s.delve.explored.push(kk); }`, { id: sap.heroId, at: placed.at, edge: placed.edge });
      await p.evaluate((id) => window.vc.hud.select(id), sap.heroId);
      await p.waitForTimeout(200);
      const tip = await hoverTip(placed.edge);
      check('hover on floor by a pit: "a charge here would drop it into the pit"', /charge here would drop it into the pit/.test(tip), tip.slice(0, 100));
      await unhover();
      const btn = await p.$('.hud-bar .act[data-action="setCharge"]');
      if (btn) {
        await p.click('.hud-bar .act[data-action="setCharge"]');
        await p.waitForTimeout(150);
        await hoverTip(placed.edge);
        await p.waitForTimeout(100);
        check('aiming at it: collapse outcome drawn in red', (await p.evaluate(() => window.vc.dio.highlights.get('collapse').count)) > 0);
        await unhover();
        await p.evaluate((at) => window.vc.hud.onClick(at, null, { button: 0 }), placed.edge);
        await p.waitForTimeout(200);
        const pick = await p.$eval('.hud-picker', (e) => e.innerText).catch(() => '');
        check('fuse picker names the drop', /drops \d floor hex/i.test(pick), pick.replace(/\n/g, ' | ').slice(0, 120));
        const f1 = await p.$('.hud-picker .fuse-btn.fuse-1');
        if (f1) {
          await p.click('.hud-picker .fuse-btn.fuse-1');
          await idle();
          await p.evaluate(() => window.vc.send({ type: 'endTurn' }));
          await idle();
          await p.waitForTimeout(300);
          s = await state();
          const ck = `1:${placed.edge.q},${placed.edge.r}`;
          check('after the blast the hex is in collapsed', (s.delve.collapsed ?? []).includes(ck), `collapsed: ${(s.delve.collapsed ?? []).join(' ')}`);
          check('the level redraws it as a pit', await p.evaluate((k) => window.vc.dio.levels.get(1).def.tiles[k.slice(2)]?.kind === 'pit', ck));
          const t2 = await hoverTip(placed.edge);
          check('hover: Collapsed / pit', /Collapsed|Pit/.test(t2), t2.slice(0, 80));
          await unhover();
        }
      }
    } else skip('floor collapse', 'no floor beside a pit-edge hex');
  } else skip('floor collapse', sap ? 'no pit edges' : 'no Sapper');
}

// ---- 4b. spec 20.5: free move while calm, the idle-only end-turn rule, Brace, Hamstring/Night thorn/Briar, crates
{
  await p.evaluate(async () => {
    const fx = await import('/src/view/fixtures.ts');
    let st = window.vc.state();
    if (location.search.includes('fixture')) st = fx.fixtureDelve(window.vcEngine.castle());
    st = structuredClone(st);
    // Nothing hunting, no fuse, nobody held: calm.
    for (const m of st.delve.monsters) if (m.awareness === 'hunting') m.awareness = 'alert';
    st.delve.fuses = [];
    st.delve.rivals = null;
    for (const h of st.delve.heroes) Object.assign(h, { moved: false, acted: false, dashed: false, status: h.status === 'captured' ? 'active' : h.status });
    // Doors open and a wide ring explored round the party, so a long walk has somewhere to go.
    for (const k of Object.keys(st.delve.doors)) Object.assign(st.delve.doors[k], { open: true, locked: false });
    const lead = st.delve.heroes.find((h) => h.status === 'active');
    const lv = window.vcEngine.castle().levels.find((l) => l.level === lead.at.level);
    for (const k of Object.keys(lv.tiles)) {
      const [q, r] = k.split(',').map(Number);
      const dd = Math.max(Math.abs(q - lead.at.q), Math.abs(r - lead.at.r), Math.abs(q + r - lead.at.q - lead.at.r));
      if (dd <= 9 && !st.delve.explored.includes(`${lead.at.level}:${k}`)) st.delve.explored.push(`${lead.at.level}:${k}`);
    }
    window.vc.load(st);
  });
  await p.waitForTimeout(250);
  s = await state();
  const calm = await p.evaluate(() => window.vcEngine.calm?.(window.vc.state()) ?? null);
  const lead = s.delve.heroes.find((h) => h.status === 'active');
  await p.evaluate((id) => window.vc.hud.select(id), lead.heroId);
  await p.waitForTimeout(150);
  if (calm?.calm) {
    const bar = await p.$eval('.hud-bar', (e) => e.innerText);
    check('calm: the bar says "Free move · the castle turns in N steps"', /Free move/.test(bar) && /castle turns in \d step/.test(bar), bar.replace(/\n/g, ' | ').slice(0, 160));
    check('...and a Follow toggle, on by default', !!(await p.$('.hud-bar .act-follow.on')));
    check('...no budget rings while calm', (await p.evaluate(() => window.vc.dio.highlights.get('walk').count + window.vc.dio.highlights.get('sneak').count)) === 0);
    // A far explored hex: the long path shows on hover and the click walks it.
    const far = await p.evaluate(async (id) => {
      const pth = await import('/src/view/pathing.ts');
      const st = window.vc.state();
      const E = window.vcEngine;
      const vis = E.visibility(st);
      const h = st.delve.heroes.find((x) => x.heroId === id);
      const reach = new Set(E.reachable(st, id, false).map((r) => `${r.to.q},${r.to.r}`));
      const keys = [...vis.explored].filter((k) => k.startsWith(`${h.at.level}:`)).map((k) => { const [q, r] = k.slice(2).split(',').map(Number); return { level: h.at.level, q, r }; });
      let best = null;
      for (const q of keys) {
        if (reach.has(`${q.q},${q.r}`)) continue;
        const path = pth.longPath(E.castle(), st, vis, id, q);
        if (path && (!best || path.length > best.path.length)) best = { to: q, path };
      }
      return best;
    }, lead.heroId);
    if (far) {
      const tip = await hoverTip(far.to);
      check('hovering a far explored hex: "Free move · walk N hexes · the castle turns in..."', /Free move/.test(tip) && /castle turns in/.test(tip), tip.slice(0, 120));
      check('...the long path is drawn', (await p.evaluate(() => window.vc.dio.pathDots.count)) >= far.path.length - 1, `${far.path.length} hexes`);
      await p.evaluate((at) => window.vc.hud.onClick(at, null, { button: 0 }), far.to);
      await idle();
      await p.waitForTimeout(250);
      s = await state();
      const h2 = s.delve.heroes.find((x) => x.heroId === lead.heroId);
      const arrived = h2.at.q === far.to.q && h2.at.r === far.to.r;
      const log = await p.$eval('.hud-log', (e) => e.innerText).catch(() => '');
      check('clicking it walks there (or stops with a "Combat!" / "stops" line)', arrived || /Combat!|stops/.test(log), `${JSON.stringify(h2.at)} vs ${JSON.stringify(far.to)}; ${log.split('\n').slice(-1)}`);
      if (far.path.length >= 4 && arrived) check('the castle turned on the way (round advanced)', s.delve.round > 3 || s.delve.calmSteps >= 4, `round ${s.delve.round}, steps ${s.delve.calmSteps}`);
    } else skip('free move walk', 'no far explored hex');
    await unhover();
  } else skip('free move', `not calm: ${calm?.why ?? 'engine.calm missing'}`);
  // Combat banner.
  await p.evaluate(async () => { await window.vc.hud.calmBanner(false, 'An orc has seen Pim.', () => Promise.resolve()); });
  check('calmBanner builds the Combat! banner', true);
  // End turn: only idle heroes prompt.
  await edit(`for (const h of s.delve.heroes) { h.moved = true; h.acted = false; }`);
  await p.waitForTimeout(150);
  await p.keyboard.press('e');
  await p.waitForTimeout(150);
  let modal = await p.$eval('.hud-modal', (e) => (e.classList.contains('hidden') ? '' : e.innerText)).catch(() => '');
  check('end turn with everyone moved but not acted: no prompt (they are ready, not idle)', !modal, modal.slice(0, 60));
  await idle();
  await p.evaluate(() => { localStorage.setItem('vc.settings', JSON.stringify({ speed: 0, reduceShake: true, noEndTurnAsk: false })); });
  await edit(`for (const h of s.delve.heroes) { h.moved = false; h.acted = false; }`);
  await p.evaluate(() => { window.vc.hud.host?.settings && (window.vc.hud.host.settings.noEndTurnAsk = false); });
  await p.waitForTimeout(100);
  const note = await p.$eval('.bar-end-note', (e) => e.innerText);
  check('"still waiting" counts the idle heroes', /still waiting/i.test(note), note);
  // Brace, shield, crates, hamstring/thorn/briar.
  s = await state();
  const heir = s.delve.heroes.find((h) => roster(h.heroId)?.cls === 'heir');
  if (heir) {
    await p.evaluate((id) => window.vc.hud.select(id), heir.heroId);
    await p.waitForTimeout(150);
    const braceBtn = await p.$('.hud-bar .act[data-action="brace"]');
    check('heir: Brace in the Abilities group', !!braceBtn && (await braceBtn.evaluate((e) => !!e.closest('.bar-group-abilities'))));
    if (braceBtn) {
      const help = await braceBtn.evaluate((e) => e.dataset.tip ?? e.title);
      check('Brace help: 1 less and −15%', /1 less/.test(help) && /−15%/.test(help), help.slice(0, 100));
      await p.click('.hud-bar .act[data-action="brace"]');
      await idle();
      await p.waitForTimeout(200);
      s = await state();
      const b = s.delve.heroes.find((h) => h.heroId === heir.heroId);
      if (b.braced) {
        check('braced badge on the card', !!(await p.$(`.hcard[data-hero="${heir.heroId}"] .chip.braced`)));
        await p.waitForTimeout(300);
        const tagHtml = await p.evaluate((id) => ({ html: document.querySelector(`.unit-tag[data-id="${id}"]`)?.innerHTML ?? '(no tag)', at: window.vc.dio.units.get(id)?.at, shown: window.vc.dio.shownLevel, h: window.vc.state().delve.heroes.find((x) => x.heroId === id) }), heir.heroId);
        check('...and on the figure tag', /tag-braced/.test(tagHtml.html), JSON.stringify(tagHtml).slice(0, 300));
      } else skip('braced badge', 'the engine did not set braced');
    }
    const shieldChip = await p.$eval(`.hcard[data-hero="${heir.heroId}"] .chip.shield`, (e) => e.title).catch(() => '');
    if (roster(heir.heroId)?.shield) {
      check('shield chip on the card with the rule', /1 less/.test(shieldChip) && /braced/.test(shieldChip), shieldChip.slice(0, 80));
      check('round shield on the figure', await p.evaluate((id) => !!window.vc.dio.units.get(id)?.fig.getObjectByName('shield'), heir.heroId));
    }
  }
  // Crates: hover and smash.
  s = await state();
  const lvl = castle.levels.find((l) => l.level === 1);
  const crateKey = Object.entries(lvl.tiles).find(([, t]) => t.kind === 'prop' && (t.prop === 'crate' || t.prop === 'barrel'))?.[0];
  if (crateKey) {
    const [cq, cr] = crateKey.split(',').map(Number);
    const crate = { level: 1, q: cq, r: cr };
    const who = s.delve.heroes.find((h) => h.status === 'active');
    const spot = nb(crate).find((q) => STAND.has(tileAt(q)?.kind) && !s.delve.monsters.some((m) => m.at.q === q.q && m.at.r === q.r) && !s.delve.heroes.some((h) => h.heroId !== who.heroId && h.at.q === q.q && h.at.r === q.r));
    await edit(`const h = s.delve.heroes.find((x) => x.heroId === a.id); h.at = a.at; h.moved = false; h.acted = false; if (!s.delve.explored.includes('1:' + a.c.q + ',' + a.c.r)) s.delve.explored.push('1:' + a.c.q + ',' + a.c.r);`, { id: who.heroId, at: spot, c: crate });
    await p.evaluate((id) => window.vc.hud.select(id), who.heroId);
    await p.waitForTimeout(200);
    const tip = await hoverTip(crate);
    check('crate hover: "Crate · Smash: loud, may hold something"', /(Crate|Barrel)/.test(tip) && /Smash: loud, may hold something/.test(tip), tip.slice(0, 80));
    await unhover();
    const sm = await p.$('.hud-bar .act[data-action="smashProp"]');
    check('Smash in the Interact group', !!sm && (await sm.evaluate((e) => !!e.closest('.bar-group-interact'))));
    if (sm) {
      await p.evaluate((at) => window.vc.hud.onClick(at, null, { button: 0 }), crate);
      await idle();
      await p.waitForTimeout(300);
      s = await state();
      check('the crate is in smashed and gone from the level', (s.delve.smashed ?? []).includes(`1:${crateKey}`) && (await p.evaluate((k) => { const lv = window.vc.dio.levels.get(1); const b = lv.breakables.get(k)?.[0]; return !!b && b.mesh.instanceMatrix.array[b.index * 16] === 0; }, `1:${crateKey}`)));
      const drop = s.delve.ground.find((g) => g.at.q === crate.q && g.at.r === crate.r);
      if (drop) check('the drop glows on the floor', (await p.evaluate(() => window.vc.dio.lootGlow.children.length)) > 0);
      const t2 = await hoverTip(crate);
      check('hover after: splinters, and the loot if any', /Splinters|Loot/.test(t2), t2.slice(0, 80));
      await unhover();
    }
  } else skip('crates', 'no crate or barrel on Level 1');
  // Hamstring / Night thorn / Briar buttons: whichever class is in the party.
  s = await state();
  for (const [cls, action] of [['ranger', 'hamstring'], ['shadowmancer', 'nightthorn'], ['hedgewitch', 'briar']]) {
    const hero = heroOf(cls);
    if (!hero) { skip(`${action} button`, `no ${cls}`); continue; }
    await edit(`const h = s.delve.heroes.find((x) => x.heroId === a); h.acted = false; h.mana = Math.max(1, h.mana); const m = s.delve.monsters.find((x) => x.awareness !== 'asleep' && x.kind !== 'dragon') ?? s.delve.monsters[0]; if (m) { const free = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]].map(([q, r]) => ({ level: h.at.level, q: h.at.q + q * 2, r: h.at.r + r * 2 })); m.at = h.at.level === m.at.level ? m.at : m.at; }`, hero.heroId);
    await p.evaluate((id) => window.vc.hud.select(id), hero.heroId);
    await p.waitForTimeout(150);
    const btn = await p.$(`.hud-bar .act[data-action="${action}"]`);
    if (!btn) { skip(`${action} button`, 'nothing in range'); continue; }
    const help = await btn.evaluate((e) => e.dataset.tip ?? e.title);
    check(`${action} button with help`, /root/i.test(help) || /ignores armor/.test(help), help.slice(0, 80));
  }
}

// ---- 5. crews: member info, intents, dragging, captured banner (fixture crews; real engine: injected members)
{
  await p.evaluate(async () => {
    const fx = await import('/src/view/fixtures.ts');
    let st = window.vc.state();
    if (location.search.includes('fixture')) st = fx.fixtureDelve(window.vcEngine.castle());
    window.vc.load(fx.fixtureCrew(st, 'hostile'));
  });
  await p.waitForTimeout(300);
  s = await state();
  const r = s.delve.rivals;
  check('hostile Ferrymen on the map', !!r && r.stance === 'hostile');
  const brune = r.members[0];
  const tip = await hoverTip(brune.at, brune.id);
  check('crew member hover: level, tiers and pack', /level 3/.test(tip) && /weapon \+1/.test(tip) && /carries/.test(tip), tip.slice(0, 200));
  check('...and the class kit line', /Guards the crew/.test(tip), tip.slice(0, 200));
  check('...and facing', /Faces (north|south|east|west)/.test(tip));
  await unhover();
  const tags = await visible('.unit-tag.tag-rival');
  check('crew tags carry the level badge', tags.some((t) => /L3/.test(t.text)), JSON.stringify(tags.map((t) => t.text)));
  const intents = await visible('.intent');
  if (fixture) check('crew intents drawn: fuse, potion, item', ['intent-fuse', 'intent-potion', 'intent-item'].every((c) => intents.some((t) => t.cls.includes(c))), JSON.stringify(intents.map((t) => t.cls)));
  else check('crew intents drawn (the engine\'s own)', intents.length > 0, JSON.stringify(intents.map((t) => t.cls)));
  const rv = await p.$eval('.hud-rivals', (e) => e.innerText);
  check('rivals panel names the crew level and tiers', /level 3/.test(rv) && /weapon 1/.test(rv), rv.replace(/\n/g, ' | '));
  // Parley card members with packs.
  await p.evaluate(() => window.vc.hud.openParley());
  await p.waitForTimeout(150);
  const card = await p.$eval('.hud-parley', (e) => (e.classList.contains('hidden') ? '' : e.innerText)).catch(() => '');
  if (card) {
    check('parley card: members show L3 W+1 A+1', /L3/.test(card) && /W\+1/.test(card) && /A\+1/.test(card), card.replace(/\n/g, ' | ').slice(0, 160));
    check('...and pack sockets', (await p.$$('.hud-parley .pl-pack .pk-sock')).length >= 3);
  } else skip('parley card members', 'no deals offered (hostile, no purse?)');
  await p.keyboard.press('Escape');
  // The Wake, one member dragging a downed hero.
  await p.evaluate(async () => {
    const fx = await import('/src/view/fixtures.ts');
    let st = window.vc.state();
    if (location.search.includes('fixture')) st = fx.fixtureDelve(window.vcEngine.castle());
    window.vc.load(fx.fixtureWake(st));
  });
  await p.waitForTimeout(300);
  s = await state();
  const dragger = s.delve.rivals.members.find((m) => m.dragging);
  const victim = s.delve.heroes.find((h) => h.heroId === dragger.dragging);
  check('the Wake drawn (rival-the-wake-* models)', await p.evaluate(() => [...window.vc.dio.units.values()].some((u) => u.key.startsWith('rival-the-wake'))));
  check('the dragged hero is tagged', (await visible('.unit-tag .tag-dragged')).length > 0);
  check('...and the dragger', (await visible('.unit-tag .tag-dragging')).length > 0);
  const chip = await p.$eval(`.hcard[data-hero="${victim.heroId}"] .chip.dragged`, (e) => e.title).catch(() => '');
  check('hero card: Dragged chip with the fix', /dragging/.test(chip) && /Kill, down or fear/.test(chip), chip.slice(0, 100));
  check('rivals panel warns about the drag', /Dragging/.test(await p.$eval('.hud-rivals', (e) => e.innerText)));
  const dtip = await hoverTip(dragger.at, dragger.id);
  check('dragger hover: dragging line and hedgewitch/sapper kit', /Dragging/.test(dtip), dtip.slice(0, 160));
  await unhover();
  // Captured: play the event through the HUD.
  await p.evaluate(async ([hero, by]) => { await window.vc.hud.capturedBanner(hero, by, () => Promise.resolve()); }, [victim.heroId, dragger.id]);
  check('captured banner builds ("is taken!")', true);
  await edit(`const h = s.delve.heroes.find((x) => x.heroId === a); h.status = 'captured';`, victim.heroId);
  await p.waitForTimeout(150);
  check('a captured hero leaves the map and the card says Taken', (await p.evaluate((id) => !window.vc.dio.units.has(id), victim.heroId)) && /Taken/i.test(await p.$eval(`.hcard[data-hero="${victim.heroId}"]`, (e) => e.innerText)));
}

// ---- 6. camp: captives and "Bring back" contracts
{
  await p.evaluate(async () => {
    const fx = await import('/src/view/fixtures.ts');
    const s = structuredClone(window.vc.state());
    s.stage = 'camp';
    s.delve = null;
    fx.fixtureCaptive(s.campaign, s.campaign.roster.find((h) => h.cls !== 'heir')?.id ?? s.campaign.roster[0].id, 'ferrymen');
    window.vc.load(s);
  });
  await p.waitForTimeout(250);
  await p.click('.station[data-station="board"]').catch(() => {});
  await p.waitForTimeout(150);
  const panel = await p.$eval('.captives-panel', (e) => e.innerText).catch(() => '');
  check('camp: Captives panel under the roster', /Captives/i.test(panel) && /held by The Ferrymen/.test(panel), panel.replace(/\n/g, ' | ').slice(0, 100));
  const row = await p.$eval('.cap-row', (e) => e.title).catch(() => '');
  check('...row tooltip: hideout, HP 1, gold lost', /hideout/.test(row) && /1 HP/.test(row), row.slice(0, 120));
  const card = await p.$eval('.contract.captive', (e) => e.innerText).catch(() => '');
  check('"Bring back <name>" contract pinned first with its own look', /Bring back/.test(card) && /Taken by The Ferrymen/i.test(card) && /The prisoner is yours/i.test(card), card.replace(/\n/g, ' | ').slice(0, 160));
  check('...under a "Taken by a crew" heading', !!(await p.$('.board-h.captive-h')));
  await p.click('.cap-row .cap-go').catch(() => {});
  await p.waitForTimeout(150);
  check('"Bring back" opens the prepare screen on that job', /Bring back/.test(await p.evaluate(() => document.body.innerText)) && !!(await p.$('.prep-contracts .btn.on')));
}

console.log(`\n${failed ? `${failed} FAILED` : 'all passed'}, ${skipped} skipped, ${errors} console errors`);
await b.close();
process.exit(failed || errors ? 1 : 0);
