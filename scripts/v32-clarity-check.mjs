// Spec 15.7 checks in the real UI, headless, by DOM assertions (no screenshots unless SHOT=<path>):
//   - walking Keven onto the tower stair shows "Take stairs ↓ Level 2" in the bar, the hex hint
//     "Stairs here", the "↓ L2" marker, and clicking the button puts him on Level 2;
//   - a blocked take (pack full next to loot) shows a greyed button with its reason and flashes it;
//   - the goal box names the objective's location once its hex is explored, and the beacon tag shows.
//
//   node scripts/v32-clarity-check.mjs <baseUrl> [seed=1980]      (SHOT=/path/to.png takes one 1280x800 shot on the stairs)

import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';

const [base, seed = '1980'] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
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

await p.goto(base);
await p.evaluate(() => localStorage.clear());
await p.reload();
await p.waitForFunction(() => !!window.vc, null, { timeout: 30000 });
await p.evaluate(() => {
  localStorage.setItem('vc.settings', JSON.stringify({ speed: 0, reduceShake: true, reduceFlashes: false, noEndTurnAsk: true }));
});
await p.reload();
await p.waitForFunction(() => !!window.vc, null, { timeout: 30000 });
// V3.9.4: the camp screen changed in V3.4, so start the delve through the engine (as the later checks do):
// a campaign on the seed, one hire, the first job.
await p.evaluate(async (sd) => {
  const E = window.vcEngine;
  window.vc.load(E.apply(E.newGame(Number(sd)), { type: 'newCampaign', seed: Number(sd) }).state);
  const s0 = window.vc.state();
  const r = s0.campaign.recruits.find((x) => x.price <= s0.campaign.gold);
  if (r) await window.vc.send({ type: 'hire', heroId: r.hero.id });
  const s = window.vc.state();
  await window.vc.send({ type: 'startDelve', contractId: s.campaign.board[0].id, heroIds: s.campaign.roster.map((h) => h.id), entrance: 0, packs: {} });
}, seed);
await idle();
await p.waitForTimeout(300);

// Goal box before the objective is seen: the brief, no location line.
const goal0 = await p.evaluate(() => ({ brief: document.querySelector('.hud-goal .goal-brief')?.textContent ?? '', where: !!document.querySelector('.goal-where') }));
check('goal box shows the brief before the objective is seen', goal0.brief.length > 0 && !goal0.where, goal0.brief);

// Walk Keven to the stairs through the engine: a BFS over the level's tiles (closed doors count
// as passable, we open them on the way) gives the distance field; each move picks the reach entry
// that lowers it most.
const walk = await p.evaluate(async () => {
  const vc = window.vc;
  const E = window.vcEngine;
  const castle = E.castle();
  const link = castle.links.find((l) => l.kind === 'stairs');
  const goal = link.a.level === 1 ? link.a : link.b;
  const lv = castle.levels.find((l) => l.level === goal.level);
  const PASS = new Set(['floor', 'rubble', 'door', 'stairs', 'exit', 'lift', 'brazier']);
  const dirs = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  const key = (q, r) => `${q},${r}`;
  const field = new Map([[key(goal.q, goal.r), 0]]);
  const q = [goal];
  while (q.length) {
    const c = q.shift();
    const dc = field.get(key(c.q, c.r));
    for (const [dq, dr] of dirs) {
      const n = { q: c.q + dq, r: c.r + dr };
      const t = lv.tiles[key(n.q, n.r)];
      if (!t || !PASS.has(t.kind) || field.has(key(n.q, n.r))) continue;
      field.set(key(n.q, n.r), dc + 1);
      q.push(n);
    }
  }
  const same = (a, b) => a.level === b.level && a.q === b.q && a.r === b.r;
  const hob = () => vc.state().delve.heroes.find((h) => h.heroId === vc.state().campaign.roster.find((r) => r.cls === 'heir').id);
  const id = hob().heroId;
  vc.hud.select(id);
  for (let round = 0; round < 40; round++) {
    for (let leg = 0; leg < 2; leg++) {
      const h = hob();
      if (h.status !== 'active') return { fail: 'hobart down' };
      if (same(h.at, goal)) return { ok: true, round };
      const open = E.actions(vc.state(), id).find((o) => o.action === 'open' && !o.blocked);
      if (open && !h.acted && leg === 0) await vc.send({ type: 'act', heroId: id, action: 'open', target: open.targets[0], focus: 0 });
      const here = field.get(key(hob().at.q, hob().at.r)) ?? 999;
      const reach = E.reachable(vc.state(), id, false).filter((r) => r.to.level === goal.level && (field.get(key(r.to.q, r.to.r)) ?? 999) < here);
      if (!reach.length) break;
      reach.sort((a, b) => field.get(key(a.to.q, a.to.r)) - field.get(key(b.to.q, b.to.r)) || a.cost - b.cost);
      await vc.send({ type: 'move', heroId: id, path: reach[0].path, sneak: false });
    }
    if (same(hob().at, goal)) return { ok: true, round };
    await vc.send({ type: 'endTurn' });
    vc.hud.select(id);
  }
  return { fail: `never reached the stairs; at ${JSON.stringify(hob().at)} field ${field.get(key(hob().at.q, hob().at.r))}` };
});
await idle();
check('Keven reached the tower stair', !!walk.ok, JSON.stringify(walk));

if (walk.ok) {
  // Make sure the move is available (a fresh turn), then read the bar.
  await p.evaluate(async () => {
    const vc = window.vc;
    const id = vc.state().campaign.roster.find((r) => r.cls === 'heir').id;
    if (vc.state().delve.heroes.find((h) => h.heroId === id).moved) await vc.send({ type: 'endTurn' });
    vc.hud.select(id);
    vc.hud.refresh();
  });
  await idle();
  await p.waitForTimeout(300);
  const bar = await p.evaluate(() => ({
    link: document.querySelector('.act.act-link .act-label')?.textContent ?? '',
    key: document.querySelector('.act.act-link kbd')?.textContent ?? '',
    hint: document.querySelector('.hud-hint')?.textContent ?? '',
    marker: [...document.querySelectorAll('.link-tag')].filter((e) => e.style.display !== 'none').map((e) => e.textContent),
    groups: [...document.querySelectorAll('.bar-group-name')].map((e) => e.textContent),
    end: document.querySelector('.bar-end-note')?.textContent ?? '',
  }));
  check('bar offers "Take stairs ↓ Level 2"', bar.link === 'Take stairs ↓ Level 2', bar.link);
  check('stairs button has hotkey T', bar.key === 'T');
  check('context hint says "Stairs ↓ L2 here"', /Stairs ↓ L2 here/.test(bar.hint), bar.hint);
  check('"↓ L2" marker floats over the explored stairs', bar.marker.includes('↓ L2'), bar.marker.join(','));
  check('bar is grouped (Move first)', bar.groups[0] === 'Move', bar.groups.join(' · '));
  check('End turn shows who is waiting', /waiting|spent/.test(bar.end), bar.end);
  // Hover the stairs hex: tooltip names the interaction.
  const tip = await p.evaluate(() => {
    const vc = window.vc;
    const id = vc.state().campaign.roster.find((r) => r.cls === 'heir').id;
    const h = vc.state().delve.heroes.find((x) => x.heroId === id);
    vc.hud.onHover(h.at, null);
    return document.querySelector('.hud-tip')?.textContent ?? '';
  });
  check('stairs tooltip names the interaction', /Stairs.*down to the Crossing.*Take stairs/.test(tip), tip);
  if (process.env.SHOT) {
    await p.waitForTimeout(400);
    await p.screenshot({ path: process.env.SHOT, timeout: 90000 });
    console.log('[shot]', process.env.SHOT);
  }
  await p.evaluate(() => window.vc.hud.onHover(null, null));
  // Click the button.
  await p.click('.act.act-link');
  await idle();
  await p.waitForTimeout(200);
  const after = await p.evaluate(() => {
    const vc = window.vc;
    const id = vc.state().campaign.roster.find((r) => r.cls === 'heir').id;
    return { level: vc.state().delve.heroes.find((x) => x.heroId === id).at.level, shown: vc.dio.shownLevel };
  });
  check('clicking it puts Keven on Level 2', after.level === 2, JSON.stringify(after));
  check('the view followed him to Level 2', after.shown === 2);
}

// Blocked take: stage Keven next to loot with a full pack (state surgery through vc.load).
const blocked = await p.evaluate(() => {
  const vc = window.vc;
  const E = window.vcEngine;
  const s = JSON.parse(JSON.stringify(vc.state()));
  const d = s.delve;
  const hob = d.heroes.find((h) => h.heroId === s.campaign.roster.find((r) => r.cls === 'heir').id);
  // The contract heirloom pile (2 slots) if this is a recover contract, else any pile.
  const pile = d.ground.find((g) => g.items.some((i) => i.kind === 'heirloom')) ?? d.ground.find((g) => g.items.length);
  if (!pile) return { skip: 'no ground loot' };
  const lv = E.castle().levels.find((l) => l.level === pile.at.level);
  const dirs = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  const key = (q, r) => `${q},${r}`;
  const spot = dirs.map(([dq, dr]) => ({ level: pile.at.level, q: pile.at.q + dq, r: pile.at.r + dr })).find((p) => lv.tiles[key(p.q, p.r)]?.kind === 'floor' && !d.heroes.some((h) => h.at.q === p.q && h.at.r === p.r && h.at.level === p.level));
  if (!spot) return { skip: 'no free hex by the pile' };
  hob.at = spot;
  hob.moved = false;
  hob.acted = false;
  hob.pack = [1, 2, 3, 4].map((i) => ({ id: `fill${i}`, kind: 'torch', name: 'Torch', slots: 1, amount: 1 }));
  d.explored.push(`${pile.at.level}:${pile.at.q},${pile.at.r}`, `${spot.level}:${spot.q},${spot.r}`);
  vc.load(s);
  vc.hud.select(hob.heroId);
  vc.hud.refresh();
  const opt = E.actions(vc.state(), hob.heroId).find((o) => o.action === 'take');
  const btn = document.querySelector('.act.blocked[data-action="take"]');
  return { engineBlocked: opt?.blocked ?? null, drawn: !!btn, why: btn?.querySelector('.act-why')?.textContent ?? '', items: pile.items.map((i) => i.name) };
});
if (blocked.skip) console.log('skip blocked take:', blocked.skip);
else {
  check('engine returns take with a blocked reason', !!blocked.engineBlocked, blocked.engineBlocked ?? 'none');
  if (blocked.engineBlocked) {
    check('blocked take is drawn greyed with its reason', blocked.drawn && blocked.why === blocked.engineBlocked, blocked.why);
    await p.click('.act.blocked[data-action="take"]', { force: true });
    await p.waitForTimeout(150);
    const toast = await p.evaluate(() => document.querySelector('.hud-toast:not(.hidden)')?.textContent ?? '');
    check('clicking it flashes the reason', toast === blocked.engineBlocked, toast);
  }
  // The beacon and goal box for the objective (if this pile is the objective).
  const beacon = await p.evaluate(() => ({
    obj: window.vc.dio.objectiveAt(),
    tag: document.querySelector('.beacon-tag:not(.hidden)')?.textContent ?? '',
    where: document.querySelector('.goal-where')?.textContent ?? '',
  }));
  if (beacon.obj) {
    check('beacon tag shows the objective', beacon.tag.length > 0, beacon.tag);
    check('goal box names the location', /Level \d/.test(beacon.where), beacon.where);
  } else console.log('note: the staged pile is not the contract objective; beacon not checked here');
}

console.log(`[errors] ${errors}  [failed] ${failed}`);
await b.close();
process.exit(failed || errors ? 1 : 0);
