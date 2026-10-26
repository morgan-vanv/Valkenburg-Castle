// V3.9.3 presentation check (spec 24.8), headless, by DOM text and scene state; one screenshot with SHOTS.
// Covers: heard footsteps (a trail of 👣 tags fading toward the oldest) and loud sounds (an icon tag and a
// pulsing ring) from an injected `Delve.heard`, only on their level; the hover tooltip ("Heard footsteps
// here, last turn" and the hearing help); the log's summary lines on `heard` events (by direction, "beyond
// the door", at most two); a real castle turn with an unseen walker; a stale shove intent draws no arrow
// (the tag still names it) while a fresh one does.
//   node scripts/v393-ui-check.mjs <baseUrl>     (http://localhost:5187/, the real engine; ?fixture=1 works too)
//   SHOTS=<dir> saves v393-footsteps.png (a footstep trail beyond a closed door).
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';

const [base = 'http://localhost:5187/'] = process.argv.slice(2);
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


// A closed door on the party's level with floor on both sides along one line: D, the hero two hexes on
// one side (facing away from it), the trail on the other side.
const doorScene = () => {
  for (const k of Object.keys(L.tiles)) {
    if (L.tiles[k].kind !== 'door' || L.tiles[k].locked) continue;
    const [q, r] = k.split(',').map(Number);
    const D = { level: lvl, q, r };
    for (let rot = 0; rot < 6; rot++) {
      ROT = rot;
      if ([1, 2, 3].every((n) => plain(step(D, 0, n))) && [1, 2].every((n) => plain(step(D, 3, n)))) return D;
    }
  }
  return null;
};
const D = doorScene();
const ROTD = ROT; // the stale-shove scene fits its own rotation; the screenshot puts this one back
check('found a door with floor both sides', !!D, JSON.stringify(D));
const a = heroIds[0];
const trail = D ? [step(D, 0, 3), step(D, 0, 2), step(D, 0, 1)] : [];
const H = D ? step(D, 3, 2) : null;
const closeDoor = (st) => { const k = `${D.level}:${D.q},${D.r}`; if (st.delve.doors[k]) st.delve.doors[k].open = false; else st.delve.doors[k] = { open: false, locked: false }; };

if (D) {
  // ---- 1. markers from Delve.heard
  const heard = [
    ...trail.map((at, n) => ({ at, kind: 'steps', n })),
    { at: step(D, 0, 2, ), kind: 'loud', what: 'clash', n: 3 },
    { at: { level: lvl === 1 ? 2 : lvl - 1, q: D.q, r: D.r }, kind: 'loud', what: 'shout', n: 4 }, // another level: not shown here
  ];
  const st = structuredClone(await state());
  await load(st); // make sure the party and doors are as the engine had them
  await scene({ [a]: { at: H, facing: F(3) } }, [], { heard });
  {
    const t = structuredClone(await state());
    closeDoor(t);
    await load(t);
    await p.waitForTimeout(80);
  }
  const tags = await p.$$eval('.heard-tag', (els) => els.map((e) => ({ kind: e.dataset.kind, what: e.dataset.what ?? '', at: e.dataset.at, op: Number(e.style.opacity), title: e.title, text: e.textContent })));
  const steps = tags.filter((x) => x.kind === 'steps');
  const loud = tags.filter((x) => x.kind === 'loud');
  check('three footprint tags on the trail', steps.length === 3 && steps.every((x) => x.text === '👣'), JSON.stringify(steps.map((x) => x.at)));
  check('the trail fades toward the oldest', steps.length === 3 && steps[0].op < steps[1].op && steps[1].op < steps[2].op, steps.map((x) => x.op.toFixed(2)).join(' < '));
  check('footprint title: "Heard footsteps here, last turn"', steps.every((x) => x.title === 'Heard footsteps here, last turn'));
  check('one loud marker on this level (the clash; the shout is on another level)', loud.length === 1 && loud[0].what === 'clash' && loud[0].text === '⚔', JSON.stringify(loud));
  check('clash title', loud[0]?.title === 'Heard a clash here, last turn', loud[0]?.title);
  const rings = await p.evaluate(() => window.vc.dio.soundMarks.children.length);
  check('a pulsing ring for the loud sound', rings === 1, `${rings} rings`);
  const vis = await p.evaluate(() => [...window.vc.dio.vis.visible]);
  const trailUnseen = trail.every((x) => !vis.includes(`${x.level}:${x.q},${x.r}`));
  check('the trail lies beyond sight (behind the closed door)', trailUnseen);
  const shown = await p.$$eval('.heard-tag', (els) => els.filter((e) => e.style.display !== 'none').length);
  check('markers drawn over the fog (displayed)', shown >= 3, `${shown} shown`);
  // ---- 2. tooltip
  const tip = await hoverTip(trail[1]);
  check('hover a footprint: "Heard footsteps here, last turn"', /Heard footsteps here, last turn/.test(tip), tip.slice(0, 90));
  check('...with the hearing help', /Hearing: your heroes hear/.test(tip));
  await unhover();
  // ---- 3. other level: switching shows its marker
  await p.evaluate((l) => window.vc.dio.showLevel(l, true), heard[4].at.level);
  const other = await p.$$eval('.heard-tag', (els) => els.map((e) => e.dataset.what ?? e.dataset.kind));
  check('the other level shows only its own sound', other.length === 1 && other[0] === 'shout', JSON.stringify(other));
  await p.evaluate((l) => window.vc.dio.showLevel(l, true), lvl);
  // ---- 4. log lines on `heard` events: summarised by direction, at most two
  const before = await state();
  await p.evaluate(() => (window.__log = []));
  const evs = [
    { type: 'phase', phase: 'world', round: before.delve.round },
    ...heard.slice(0, 4).map((sound) => ({ type: 'heard', sound })),
    { type: 'heard', sound: { at: step(H, 3, 3), kind: 'loud', what: 'roar', n: 5 } },
    { type: 'phase', phase: 'player', round: before.delve.round + 1 },
  ];
  await p.evaluate(([e, b]) => window.vc.play(e, b), [evs, before]);
  const lines = await p.evaluate(() => window.__log.filter((t) => /^(Footsteps|A clash|A roar|A shout)/.test(t)));
  check('at most two hearing lines a castle turn', lines.length >= 1 && lines.length <= 2, JSON.stringify(lines));
  check('loud first, by direction', /^A (clash|roar) .*to the (north|south|east|west|north-east|north-west|south-east|south-west)\.$/.test(lines[0] ?? ''), lines[0]);
  check('the clash is "beyond the door"', lines.some((t) => /^A clash beyond the door to the /.test(t)), JSON.stringify(lines));
  // footsteps alone: one line, beyond the door
  await p.evaluate(() => (window.__log = []));
  await p.evaluate(([e, b]) => window.vc.play(e, b), [[evs[0], ...heard.slice(0, 3).map((sound) => ({ type: 'heard', sound })), evs[evs.length - 1]], before]);
  const fl = await p.evaluate(() => window.__log.filter((t) => /^Footsteps/.test(t)));
  check('"Footsteps beyond the door to the …" (one line for the trail)', fl.length === 1 && /^Footsteps beyond the door to the [a-z-]+\.$/.test(fl[0]), JSON.stringify(fl));
  // ---- 5. a real castle turn: an unseen orc walks behind the door toward the hero
  await scene({ [a]: { at: H, facing: F(3) } }, [{ id: 'walker', kind: 'orc', at: step(D, 0, 3), awareness: 'alert', facing: F(3) }], { heard: [] });
  {
    const t = structuredClone(await state());
    closeDoor(t);
    t.delve.monsters[0].focusAt = H;
    t.delve.monsters[0].searchRounds = 3;
    await load(t);
  }
  await p.evaluate(() => (window.__log = []));
  await p.evaluate(() => window.vc.send({ type: 'endTurn' }));
  await idle();
  s = await state();
  if (s.delve) {
    const n = (s.delve.heard ?? []).length;
    const seenNow = s.delve.monsters.some((m) => m.id === 'walker');
    if (n) {
      check('real turn: Delve.heard filled by the unseen walker', n > 0, JSON.stringify(s.delve.heard));
      const ll = await p.evaluate(() => window.__log.filter((t) => /^(Footsteps|A [a-z]+ )/.test(t) && /to the|from (below|above)/.test(t)));
      check('real turn: a hearing line in the log', ll.length >= 1 && ll.length <= 2, JSON.stringify(ll));
      const tg = await p.$$eval('.heard-tag', (els) => els.length);
      check('real turn: markers drawn', tg === s.delve.heard.filter((x) => x.at.level === lvl).length, `${tg} tags`);
    } else skip('real turn hearing', `nothing heard (walker ${seenNow ? 'still here' : 'gone'})`);
  }
}

// ---- 6. stale shove arrows
if (fit([[0, 1], [0, 2], [0, 3], [3, 1]])) {
  // The orc stands at P+1, the hero at P (shove to P-1, adjacent to P). Then the hero walks off to P+3... stale.
  const M = step(P, 0);
  await scene({ [a]: { at: P, facing: F(0) } }, [{ id: 'sh', kind: 'orc', at: M, awareness: 'hunting', facing: F(3), noticedIds: [a] }], { heard: [] });
  const draw = (heroAt) => p.evaluate(([id, to, at]) => {
    const st = structuredClone(window.vc.state());
    st.delve.heroes.find((h) => h.heroId === id).at = at;
    window.vc.dio.showIntents(st, { sh: { kind: 'shove', targetId: id, to } });
    const tag = document.querySelector('.intent-shove');
    return { lines: window.vc.dio.intentLines.children.length, title: tag?.title ?? '' };
  }, [a, step(P, 3), heroAt]);
  const fresh = await draw(P);
  check('a fresh shove draws its arrow and ring', fresh.lines >= 2, `${fresh.lines} objects`);
  const stale = await draw(step(P, 0, 3));
  check('a stale shove (victim moved away) draws no arrow', stale.lines === 0, `${stale.lines} objects`);
  check('...the intent tag still names it', /knocks .* back/.test(stale.title), stale.title);
  const dragStale = await p.evaluate(([id, to, at]) => {
    const st = structuredClone(window.vc.state());
    st.delve.heroes.find((h) => h.heroId === id).at = at;
    window.vc.dio.showIntents(st, { sh: { kind: 'drag', targetId: id, to } });
    return { lines: window.vc.dio.intentLines.children.length, title: document.querySelector('.intent-drag')?.title ?? '' };
  }, [a, step(P, 0, 2), step(P, 3)]);
  check('a stale drag draws no arrow either', dragStale.lines === 0 && /drags/.test(dragStale.title), `${dragStale.lines} · ${dragStale.title}`);
  await p.evaluate(() => window.vc.dio.clearIntents());
} else skip('stale shove', 'no floor');

// ---- the screenshot: a footstep trail beyond a closed door
if (shots && D) {
  ROT = ROTD;
  const heard = [...trail.map((at, n) => ({ at, kind: 'steps', n })), { at: step(D, 0, 4), kind: 'loud', what: 'clash', n: 3 }];
  await scene({ [a]: { at: H, facing: F(3) } }, [], { heard });
  const t = structuredClone(await state());
  closeDoor(t);
  await load(t);
  await select(a);
  await p.evaluate((f) => { window.vc.dio.lookAt(f, true); window.vc.dio.rig.distance = 15; window.vc.dio.renderNow(); }, step(D, 0, 1));
  await p.waitForTimeout(400);
  await p.evaluate(() => window.vc.dio.renderNow());
  await p.screenshot({ path: `${shots}/v393-footsteps.png`, clip: { x: 240, y: 120, width: 800, height: 520 } });
  console.log(`shot ${shots}/v393-footsteps.png`);
}

console.log(`\n${failed ? `${failed} FAILED` : 'all passed'}, ${skipped} skipped, ${errors} console errors`);
await b.close();
process.exit(failed || errors ? 1 : 0);
