// V3 screenshots in headless Chromium with WebGL (SwiftShader).
//
//   node scripts/v3-shot.mjs <baseUrl> <outDir> [tour] [seed]
//
// tours:
//   fixture  - stand-in engine on the test castle (?fixture=1): title, camp, delve, preview
//   full     - real engine: title, camp stations, prepare, delve, move, preview, roll, world phase, summary
//
// Drives the game through window.vc (see src/main.ts).

import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';

const [base, dir, tour = 'full', seed = '1980'] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
let errors = 0;
p.on('console', (m) => {
  if (m.type() === 'error') errors++;
  if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.type(), m.text());
});
p.on('pageerror', (e) => {
  errors++;
  console.log('[pageerror]', e.message);
});

const snap = async (name) => {
  await p.waitForTimeout(250);
  const path = `${dir}/${name}.png`;
  await p.screenshot({ path, timeout: 90000 });
  console.log('[shot]', path);
};
const idle = () => p.waitForFunction(() => window.vc && !window.vc.busy(), null, { timeout: 60000 });
const click = async (sel) => {
  await p.click(sel, { timeout: 5000 }).catch((e) => console.log('[click failed]', sel, e.message.split('\n')[0]));
  await p.waitForTimeout(250);
};

const url = tour === 'fixture' ? `${base}?fixture=1` : base;
await p.goto(url);
await p.evaluate(() => localStorage.clear());
await p.reload();
await p.waitForFunction(() => !!window.vc, null, { timeout: 30000 });
await p.waitForTimeout(500);
await snap('00-title');
await p.fill('input.seed', seed);
await click('text=New campaign');
await snap('01-camp-board');

if (tour === 'full') {
  for (const st of ['Quartermaster', 'Smithy', 'Tavern', 'Stash']) {
    await click(`.station:has-text("${st}")`);
  }
  await click('.station:has-text("Quartermaster")');
  await click('.shop-row:has-text("Torch") button');
  await snap('02-quartermaster');
  await click('.station:has-text("Tavern")');
  await snap('03-tavern');
  // V3.2: Hobart starts alone; hire the first two recruits we can afford.
  for (let i = 0; i < 2; i++) await click('.recruit button:not([disabled]) >> nth=0');
  await click('.station:has-text("Bounty board")');
}
await click('.contract >> nth=0 >> text=Take the job');
await snap('04-prepare');
await click('.btn-delve');
await idle();
await p.waitForTimeout(1200);
await snap('05-delve');

// Script: walk toward the nearest visible monster, attack when possible.
await p.evaluate(() => {
  window.vcStep = async () => {
    const vc = window.vc;
    const E = window.vcEngine;
    const s = vc.state();
    if (!s || s.stage !== 'delve') return 'done';
    const d = s.delve;
    const heroes = d.heroes.filter((h) => h.status === 'active' && (!h.moved || !h.acted));
    for (const h of heroes) {
      const acts = E.actions(s, h.heroId);
      const atk = acts.find((a) => a.action === 'attack' || a.action === 'firebolt');
      if (atk && !h.acted) return { attack: h.heroId, action: atk.action, target: atk.targets[0] };
    }
    const h = heroes.find((x) => !x.moved);
    if (!h) {
      await vc.send({ type: 'endTurn' });
      return 'turn';
    }
    const reach = E.reachable(s, h.heroId, false);
    if (!reach.length) {
      await vc.send({ type: 'endTurn' });
      return 'turn';
    }
    const vis = E.visibility(s);
    const mons = d.monsters.filter((m) => m.kind !== 'gloam' && m.at.level === h.at.level);
    const dist = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
    let best = reach[0];
    let bestScore = Infinity;
    for (const r of reach) {
      const near = mons.length ? Math.min(...mons.map((m) => dist(r.to, m.at))) : 0;
      const unexplored = vis.explored.has(vc.posKey(r.to)) ? 0 : -1;
      const score = near * 2 + unexplored - r.cost * 0.3;
      if (score < bestScore) {
        bestScore = score;
        best = r;
      }
    }
    vc.hud.select(h.heroId);
    await vc.send({ type: 'move', heroId: h.heroId, path: best.path, sneak: false });
    return 'move';
  };
});

// Hover a reachable hex to show a path and ripple.
const hoverReach = await p.evaluate(() => {
  const vc = window.vc;
  const s = vc.state();
  const h = s.delve.heroes.find((x) => x.heroId === vc.hud.selectedId);
  const r = window.vcEngine.reachable(s, h.heroId, false);
  const far = r.sort((a, b) => b.cost - a.cost)[0];
  if (!far) return null;
  vc.hud.onHover(far.to, null);
  return true;
});
if (hoverReach) await snap('06-path-preview');

let found = null;
for (let i = 0; i < 40 && !found; i++) {
  const r = await p.evaluate(() => window.vcStep());
  await idle();
  if (r && typeof r === 'object') found = r;
  if (r === 'done') break;
  if (i === 2) await snap('07-explore');
}
if (found) {
  await p.evaluate((f) => {
    const vc = window.vc;
    vc.hud.select(f.attack);
    const s = vc.state();
    const opt = window.vcEngine.actions(s, f.attack).find((a) => a.action === f.action);
    vc.hud['choose'](opt, f.target);
  }, found);
  await p.waitForTimeout(300);
  await click('.pv-focus button[aria-label="More Focus"]');
  await snap('08-roll-preview');
  await p.evaluate(() => (window.vc.dio.clock.speed = 0.35));
  await click('.pv-go');
  await p.waitForSelector('.hud-roll:not(.hidden) .slot.flipped', { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(500);
  await snap('09-rolling');
  await p.evaluate(() => (window.vc.dio.clock.speed = 1));
  await idle();
  await snap('10-after-attack');
} else console.log('[tour] no fight found');

// World phase.
await p.evaluate(() => window.vc.send({ type: 'endTurn' }));
await p.waitForTimeout(350);
await snap('11-world-phase');
await idle();
await snap('12-next-round');
await p.click('.level-btn >> text=L2').catch(() => {});
await p.waitForTimeout(600);
await snap('13-level2');

if (tour === 'full') {
  // Abandon to reach the summary.
  await p.evaluate(() => window.vc.send({ type: 'abandon' }));
  await idle().catch(() => {});
  await p.waitForTimeout(600);
  await snap('14-summary');
  await click('.summary .btn-primary');
  await snap('15-after');
}
console.log('[errors]', errors);
await b.close();
