// V3.3 (spec 16) presentation checks, headless, by DOM assertions. Runs on the fixture engine
// (?fixture=1, test castle) so it works whatever the real engine's state; `vc.load()` injects
// delve states for the patrol route, the Gloam, a grabbed hero and the new monsters.
//
//   node scripts/v33-ui-check.mjs <baseUrl>          (SHOTS=<dir> also takes three reduced shots:
//                                                     shutter, patrol route, gloam)

import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';

const [base] = process.argv.slice(2);
const shots = process.env.SHOTS;
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1200, height: 750 } });
await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
let errors = 0;
let failed = 0;
p.on('console', (m) => {
  if (m.type() === 'error') {
    errors++;
    console.log('[console]', m.text());
  }
});
p.on('pageerror', (e) => {
  errors++;
  console.log('[pageerror]', e.message);
});
const check = (name, ok, extra = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`);
};
const idle = () => p.waitForFunction(() => window.vc && !window.vc.busy(), null, { timeout: 60000 });
const shot = async (name) => {
  if (!shots) return;
  await p.evaluate(() => window.vc.dio.renderNow());
  await p.screenshot({ path: `${shots}/${name}.png` });
};

const url = base + (base.includes('?') ? '&' : '?') + 'fixture=1';
await p.goto(url);
await p.evaluate(() => localStorage.clear());
await p.evaluate(() => localStorage.setItem('vc.settings', JSON.stringify({ speed: 0, reduceShake: true, reduceFlashes: false, noEndTurnAsk: true })));
await p.reload();
await p.waitForFunction(() => !!window.vc, null, { timeout: 30000 });
await p.fill('input.seed', '7');
await p.click('text=New campaign');
await p.waitForTimeout(200);

// Prepare screen: the "Start shuttered" option exists and is remembered.
await p.click('.station:has-text("Bounty board")').catch(() => {});
await p.click('.contract >> nth=0 >> text=Take the job');
const prep = await p.evaluate(() => !!document.querySelector('.prep-shutter input[type=checkbox]'));
check('prepare screen offers "Start shuttered"', prep);
await p.click('.prep-shutter input[type=checkbox]');
const remembered = await p.evaluate(() => JSON.parse(localStorage.getItem('vc.loadout.v33') ?? '{}').startShuttered === true);
check('start shuttered is remembered in vc.loadout.v33', remembered);
await p.click('.btn-delve');
await idle();
await p.waitForTimeout(300);

// 1. Shutter: the delve started shuttered (the app sent the free action), the meter says so.
const m0 = await p.evaluate(() => ({
  state: document.querySelector('.light-state')?.textContent ?? '',
  stage: document.querySelector('.light-stage')?.textContent ?? '',
  open: window.vc.state().delve.lanternOpen,
  toggle: document.querySelector('.light-toggle')?.textContent ?? '',
  saveKey: Object.keys(localStorage).find((k) => k.startsWith('vc.save.')) ?? null,
}));
check('delve starts shuttered when asked; meter says "Shuttered · not burning"', m0.open === false && /Shuttered · not burning/.test(m0.state) && m0.stage === 'Shuttered', `${m0.state} | ${m0.stage}`);
check('meter toggle offers Open', /Open/.test(m0.toggle), m0.toggle);
check('a save is written (current key, V3.9: vc.save.v39)', m0.saveKey === 'vc.save.v39', String(m0.saveKey));
await shot('01-shuttered');
// The bar's Lantern group for the bearer (hotkey L), then L opens it.
const bar0 = await p.evaluate(() => {
  const vc = window.vc;
  vc.hud.select(vc.state().delve.lanternBearer);
  const btn = document.querySelector('.act-shutter');
  return { label: btn?.textContent ?? '', key: btn?.dataset.key, group: !!document.querySelector('.bar-group-lantern') };
});
check('bar has a Lantern group with the shutter button on L', bar0.group && bar0.key === 'l' && /Open/.test(bar0.label), bar0.label);
await p.keyboard.press('l');
await idle();
await p.waitForTimeout(150);
const m1 = await p.evaluate(() => ({ state: document.querySelector('.light-state')?.textContent ?? '', open: window.vc.state().delve.lanternOpen, hint: document.querySelector('.light-hint')?.textContent ?? '', log: [...document.querySelectorAll('.log-line')].map((e) => e.textContent).join(' | ') }));
check('L opens the lantern: "Open · burning"', m1.open === true && /Open · burning/.test(m1.state), m1.state);
check('Level 1 daylight hint shows while open', /Daylight/.test(m1.hint), m1.hint);
// The meter button shutters it again.
await p.click('.light-toggle');
await idle();
await p.waitForTimeout(100);
const m2 = await p.evaluate(() => window.vc.state().delve.lanternOpen);
check('meter button shutters it again', m2 === false);

// 2. Per-hero darkness: shuttered, no braziers, no torches: everyone stands unlit.
const dark = await p.evaluate(() => {
  const vc = window.vc;
  const s = structuredClone(vc.state());
  s.delve.lit = [];
  for (const h of s.delve.heroes) h.torch = 0;
  vc.load(s);
  vc.hud.select(s.delve.lanternBearer);
  const E = window.vcEngine;
  const d = s.delve;
  const unlit = d.heroes.filter((h) => h.status === 'active' && !E.heroLit(s, h.heroId));
  return {
    unlit: unlit.map((h) => h.heroId),
    chips: [...document.querySelectorAll('.chip.dark')].map((e) => e.textContent),
    darkCards: document.querySelectorAll('.hcard.dark').length,
    hint: document.querySelector('.hint-dark')?.textContent ?? '',
    vignette: document.querySelector('.hud-vignette')?.dataset.b,
    sight: E.sightRange(s, d.lanternBearer),
  };
});
check('unlit heroes get the dark card badge', dark.unlit.length > 0 && dark.darkCards === dark.unlit.length && dark.chips.every((c) => /In the dark · (sight \d|night-eye)/.test(c)), `${dark.unlit.length} unlit, chips: ${dark.chips.join(', ')}`);
check('context hint leads with "In the dark: sight N"', new RegExp(`In the dark: sight ${dark.sight}`).test(dark.hint), dark.hint);
check('vignette is dark for an unlit selected hero', dark.vignette === 'dark' || dark.vignette === 'pitch', dark.vignette);

// 3. Patrols and 6. new monsters/intents, through an injected state (the fixture engine has no AI).
const inj = await p.evaluate(() => {
  const vc = window.vc;
  const s = structuredClone(vc.state());
  const d = s.delve;
  const hob = d.heroes.find((h) => h.heroId === d.lanternBearer);
  const E = window.vcEngine;
  const lv = E.castle().levels.find((l) => l.level === hob.at.level);
  // Floor hexes near Hobart for a route and spawns.
  const floors = Object.entries(lv.tiles)
    .filter(([, t]) => t.kind === 'floor')
    .map(([k]) => ({ level: hob.at.level, q: Number(k.split(',')[0]), r: Number(k.split(',')[1]) }))
    .filter((p) => !d.heroes.some((h) => h.at.q === p.q && h.at.r === p.r));
  const dist = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
  floors.sort((a, b) => dist(a, hob.at) - dist(b, hob.at));
  const route = [floors[0], floors[2], floors[4]];
  d.monsters = [
    { id: 'pat', kind: 'orc', name: 'Patrol orc', at: route[0], hp: 6, maxHp: 6, awareness: 'patrol', spawnedAt: route[0], route, routeIndex: 1 },
    { id: 'cap', kind: 'captain', name: 'Orc captain', at: floors[1], hp: 9, maxHp: 9, awareness: 'hunting', spawnedAt: floors[1], intent: { kind: 'shout', targetId: hob.heroId } },
    { id: 'arc', kind: 'archer', name: 'Orc archer', at: floors[3], hp: 5, maxHp: 5, awareness: 'hunting', spawnedAt: floors[3], intent: { kind: 'attack', targetId: hob.heroId, damage: [0, 2] } },
    { id: 'gho', kind: 'ghoul', name: 'Ghoul', at: floors[5], hp: 7, maxHp: 7, awareness: 'hunting', spawnedAt: floors[5], holding: hob.heroId, intent: { kind: 'grab', targetId: hob.heroId } },
    { id: 'bur', kind: 'ghoul', name: 'Buried ghoul', at: floors[6], hp: 7, maxHp: 7, awareness: 'hunting', spawnedAt: floors[6], buried: true },
  ];
  hob.grabbedBy = 'gho';
  d.knownRoutes = ['pat'];
  d.lanternOpen = true;
  d.explored = [...new Set([...d.explored, ...floors.slice(0, 8).map((p) => `${p.level}:${p.q},${p.r}`)])];
  d.rivals = {
    crew: 'lantern-sisters',
    name: 'The Lantern Sisters',
    stance: 'hostile',
    goal: 'loot',
    spotted: true,
    entersRound: 1,
    members: [
      { id: 'sis1', crew: 'lantern-sisters', name: 'Sister Ranger', at: floors[7], hp: 6, maxHp: 6, loot: [], goneOut: false, cls: 'ranger', intent: { kind: 'overwatch' }, overwatch: true },
      { id: 'sis2', crew: 'lantern-sisters', name: 'Sister Shadow', at: floors[8], hp: 6, maxHp: 6, loot: [], goneOut: false, cls: 'shadowmancer', veil: 2, intent: { kind: 'veil' } },
      { id: 'sis3', crew: 'lantern-sisters', name: 'Sister Burglar', at: floors[9], hp: 6, maxHp: 6, loot: [], goneOut: false, cls: 'burglar', intent: { kind: 'dart', targetId: hob.heroId } },
    ],
  };
  vc.load(s);
  vc.hud.select(hob.heroId);
  // The fixture engine invents its own intents; feed the diorama the V3.3 ones directly.
  vc.dio.showIntents(vc.state(), { cap: { kind: 'shout', targetId: hob.heroId }, arc: { kind: 'attack', targetId: hob.heroId, damage: [0, 2] }, gho: { kind: 'grab', targetId: hob.heroId }, sis1: { kind: 'overwatch' }, sis2: { kind: 'veil' }, sis3: { kind: 'dart', targetId: hob.heroId } });
  vc.dio.renderNow();
  const dio = vc.dio;
  const units = dio['units'];
  return {
    routeObjects: dio['routes'].children.length,
    patrolTag: document.querySelector('.unit-tag[data-id="pat"] .tag-patrol')?.textContent ?? '',
    heldTag: document.querySelector(`.unit-tag[data-id="${hob.heroId}"] .tag-grab`)?.textContent ?? '',
    ghoulHold: document.querySelector('.unit-tag[data-id="gho"] .tag-grab')?.textContent ?? '',
    buriedDrawn: units.has('bur'),
    models: ['cap', 'arc', 'gho', 'sis1', 'sis2', 'sis3'].map((id) => units.get(id)?.key),
    intents: [...document.querySelectorAll('.intent')].map((e) => e.className.replace('intent ', '')).sort(),
    shoutMarks: dio['breathMarks'].children.filter((g) => g.userData.shout).length,
    heldLine: document.querySelector('.bar-held')?.textContent ?? '',
    heldChip: [...document.querySelectorAll('.chip.grab')].length,
    turn: document.querySelector('.bar-turn')?.textContent ?? '',
    sisterTags: ['sis1', 'sis2'].map((id) => document.querySelector(`.unit-tag[data-id="${id}"] b`)?.textContent ?? ''),
  };
});
check('known patrol route is drawn (dots, arrows, waypoint rings)', inj.routeObjects > 6, `${inj.routeObjects} objects`);
check('patroller gets the footprint icon', inj.patrolTag === '👣', inj.patrolTag);
check('new monster models: captain, archer, ghoul; sisters by class', JSON.stringify(inj.models) === JSON.stringify(['captain', 'archer', 'ghoul', 'sisterRanger', 'sisterShadow', 'sisterBurglar']), inj.models.join(','));
check('buried ghoul is not drawn', inj.buriedDrawn === false);
check('intent tags: shout, attack, grab, overwatch, veil, dart', ['intent-attack', 'intent-dart', 'intent-grab', 'intent-overwatch', 'intent-shout', 'intent-veil'].every((c) => inj.intents.includes(c)), inj.intents.join(','));
check('shout draws the radius-8 ring', inj.shoutMarks === 1, `${inj.shoutMarks}`);
check('held hero: chain tag, ghoul chain tag, bar "Held by", card chip', /Held/.test(inj.heldTag) && inj.ghoulHold === '⛓' && /Held by Ghoul/.test(inj.heldLine) && inj.heldChip === 1 && /^Held/.test(inj.turn), `${inj.heldTag} | ${inj.heldLine} | ${inj.turn}`);
check('sister tags: overwatch, veiled', inj.sisterTags[0] === 'overwatch' && inj.sisterTags[1] === 'veiled', inj.sisterTags.join(','));
await shot('02-patrol-intents');

// Events: play shout, dragged, grabbed, released, routeKnown, spawned (ghoul rise) through the diorama and HUD.
const ev = await p.evaluate(async () => {
  const vc = window.vc;
  const s = vc.state();
  const d = s.delve;
  const hob = d.heroes.find((h) => h.heroId === d.lanternBearer);
  const dio = vc.dio;
  const units = dio['units'];
  const errs = [];
  const run = async (e) => {
    try {
      await dio.playEvent(e);
    } catch (x) {
      errs.push(`${e.type}: ${x.message}`);
    }
  };
  await run({ type: 'shout', id: 'cap' });
  await run({ type: 'grabbed', by: 'gho', id: hob.heroId });
  await run({ type: 'released', id: hob.heroId });
  await run({ type: 'routeKnown', id: 'pat', route: units.get('pat') ? d.monsters[0].route : [] });
  await run({ type: 'shutter', open: false });
  await run({ type: 'shutter', open: true });
  const to = d.monsters[1].at;
  await run({ type: 'dragged', id: hob.heroId, from: hob.at, to });
  // Ghoul rise: mark the buried one as rising and play spawned.
  const bur = d.monsters.find((m) => m.id === 'bur');
  bur.buried = false;
  const v = dio['ensureUnit']('bur', 'ghoul', 'monster', bur.at, bur.name);
  v.setOpacity(0);
  v.root.userData.rise = true;
  dio.refreshUnits();
  await run({ type: 'spawned', id: 'bur', at: bur.at });
  const y = v.root.position.y - dio['worldOf'](bur.at).y;
  return { errs, floaters: document.querySelectorAll('.floater').length, riseDone: Math.abs(y) < 0.01 && v.body.opacity > 0.9, hobAt: units.get(hob.heroId).at, to };
});
check('events shout/grabbed/released/routeKnown/shutter/dragged/spawned play without errors', ev.errs.length === 0, ev.errs.join('; '));
check('ghoul rise ends at floor level, opaque', ev.riseDone);
check('dragged moves the hero figure to `to`', ev.hobAt.q === ev.to.q && ev.hobAt.r === ev.to.r);

// 4. The Gloam: a gloam on the heroes' level with the bearer unlit → creeping darkness tiles and the warning line (when on L3).
const gl = await p.evaluate(() => {
  const vc = window.vc;
  const s = structuredClone(vc.state());
  const d = s.delve;
  const hob = d.heroes.find((h) => h.heroId === d.lanternBearer);
  d.lanternOpen = false;
  d.lit = [];
  for (const h of d.heroes) h.torch = 0;
  d.monsters = [{ id: 'glo', kind: 'gloam', name: 'The Gloam', at: { ...hob.at, q: hob.at.q + 2 }, hp: 99, maxHp: 99, awareness: 'hunting', spawnedAt: hob.at }];
  // The test castle has no Level 3; pretend by moving everyone to level 3 for the HUD line check is not possible, so check the tiles and the line's condition separately.
  vc.load(s);
  vc.dio.renderNow();
  const dio = vc.dio;
  const E = window.vcEngine;
  const unlit = d.heroes.filter((h) => h.status === 'active' && !E.heroLit(s, h.heroId)).length;
  return { tiles: dio['gloamEdge'].count, unlit, lit: E.visibility(s).lit.size, line: !document.querySelector('.hud-gloam').classList.contains('hidden'), rings: dio['darkRings'].children.length };
});
check('gloam present: dark rings under unlit heroes', gl.rings === gl.unlit && gl.unlit > 0, `${gl.rings} rings, ${gl.unlit} unlit`);
check('gloam creeping-darkness tiles drawn at the light edge (or none when nothing is lit)', gl.lit === 0 ? gl.tiles === 0 : gl.tiles > 0, `${gl.tiles} tiles, ${gl.lit} lit hexes`);
check('warning line hidden off Level 3', gl.line === false);
// Force the Level 3 condition for the line: a hero on level 3 (HUD only reads positions).
const gl3 = await p.evaluate(() => {
  const vc = window.vc;
  const s = structuredClone(vc.state());
  const d = s.delve;
  const hob = d.heroes.find((h) => h.heroId === d.lanternBearer);
  const lv3 = window.vcEngine.castle().levels.find((l) => l.level === 3);
  if (lv3) {
    const floors = Object.keys(lv3.tiles).filter((k) => lv3.tiles[k].kind === 'floor').map((k) => ({ level: 3, q: Number(k.split(',')[0]), r: Number(k.split(',')[1]) }));
    hob.at = floors[0];
    d.monsters[0].at = floors[Math.min(3, floors.length - 1)];
  } else {
    hob.at = { ...hob.at, level: 3 };
    d.monsters[0].at = { ...d.monsters[0].at, level: 3 };
  }
  vc.load(s);
  const E = window.vcEngine;
  const st = vc.state();
  return { line: !document.querySelector('.hud-gloam').classList.contains('hidden'), text: document.querySelector('.hud-gloam').textContent, vignette: document.querySelector('.hud-vignette').dataset.b, sel: vc.hud.selectedId, hob: hob.heroId, lit: E.heroLit(st, hob.heroId), lvl: st.delve.heroes.find((h) => h.heroId === hob.heroId).at.level, gloam: st.delve.monsters.map((m) => m.kind).join() };
});
check('warning line "The dark here is awake" while a hero on L3 is unlit and the Gloam is up', gl3.line && /dark here is awake/.test(gl3.text), JSON.stringify(gl3));
check('vignette pitch for an unlit hero on L3', gl3.vignette === 'pitch', gl3.vignette);
await shot('03-gloam');

console.log(`\n${failed} failed, ${errors} console errors`);
await b.close();
process.exit(failed || errors ? 1 : 0);
