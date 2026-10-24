// Screenshots in headless Chromium with WebGL (SwiftShader).
//
//   node scripts/shot.mjs <url> <out.png> [waitMs]
//       one screenshot after waitMs
//   node scripts/shot.mjs <url> --tour <outDir> [seed]
//       walk every screen and save week, muster, expedition, preview, dice,
//       castle phase, debrief and end shots into outDir
//
// The tour drives the game through window.vc (see src/main.ts).

import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';

const [url, out, arg3 = '1500'] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
// The sandbox can't reach Google Fonts; serve an empty stylesheet so the
// fallback font stack is used without network errors.
await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
let errors = 0;
p.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors += m.type() === 'error' ? 1 : 0;
  console.log('[console]', m.type(), m.text());
});
p.on('pageerror', (e) => {
  errors++;
  console.log('[pageerror]', e.message);
});

const snap = async (dir, name) => {
  const path = `${dir}/${name}.png`;
  await p.screenshot({ path, timeout: 90000 });
  console.log('[shot]', path);
};

const idle = () => p.waitForFunction(() => window.vc && !window.vc.busy(), null, { timeout: 60000 });

if (out !== '--tour') {
  await p.goto(url);
  await p.waitForTimeout(Number(arg3));
  await p.screenshot({ path: out });
} else {
  const dir = arg3;
  const seed = process.argv[5] ?? '1980';
  await p.goto(url);
  await p.evaluate(() => localStorage.clear());
  await p.reload();
  await p.waitForTimeout(800);
  await snap(dir, '00-title');
  await p.fill('input.seed', seed);
  await p.click('text=New campaign');
  await p.waitForTimeout(400);
  await snap(dir, '01-week');
  await p.click('text=Hire');
  await p.waitForTimeout(200);
  await p.click('text=Begin muster');
  await p.waitForTimeout(400);
  await snap(dir, '02-muster');
  await p.click('text=Launch the expedition');
  await p.waitForTimeout(500);
  await idle();
  await p.waitForTimeout(1200);
  await snap(dir, '03-expedition');

  // Walk toward the guardroom and find a fight: a scripted sequence that
  // works on any map. Move the selected unit to the reachable square closest
  // to a visible enemy, else the one furthest from its start.
  const script = async (steps) => {
    for (let i = 0; i < steps; i++) {
      const r = await p.evaluate(() => window.vcStep());
      await idle();
      await p.waitForTimeout(150);
      if (r === 'attack') return true;
      if (r === 'done') return false;
    }
    return false;
  };
  await p.evaluate(() => {
    window.vcStep = async () => {
      const vc = window.vc;
      const s = vc.state();
      if (!s || s.stage !== 'expedition') return 'done';
      const hud = vc.hud;
      const units = s.expedition.units.filter((u) => u.side === 'player' && !u.exited && u.actionsLeft > 0);
      if (!units.length) {
        await vc.send({ type: 'endTurn' });
        return 'turn';
      }
      const engine = window.vcEngine;
      for (const u of units) {
        const acts = engine.actions(s, u.id);
        const atk = acts.find((a) => a.kind === 'melee') ?? acts.find((a) => a.kind === 'missile');
        if (atk) {
          hud.select(u.id);
          hud.openPreview(atk.targetIds[0], atk.kind);
          return 'attack';
        }
      }
      const u = units[0];
      const vis = engine.visibility(s);
      const reach = engine.reachable(s, u.id);
      if (!reach.length) {
        // Try opening a locked door.
        const door = engine.actions(s, u.id).find((a) => a.kind === 'door');
        if (door) {
          await vc.send({ type: 'door', unitId: u.id, edge: door.edge, method: door.methods.includes('pick') ? 'pick' : door.methods.includes('smash') ? 'smash' : door.methods[0] });
          return 'door';
        }
        await vc.send({ type: 'endTurn' });
        return 'turn';
      }
      const enemies = s.expedition.units.filter((e) => e.side === 'castle' && e.cls !== 'dummy');
      const d = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + (a.level === b.level ? 0 : 20);
      let best = reach[0];
      let bestScore = Infinity;
      for (const r of reach) {
        const near = Math.min(...enemies.map((e) => d(r.to, e.pos)));
        const unexplored = vis.explored.has(`${r.to.level}:${r.to.x},${r.to.y}`) ? 0 : -1;
        const score = near * 2 + unexplored - r.cost * 0.1;
        if (score < bestScore) {
          bestScore = score;
          best = r;
        }
      }
      hud.select(u.id);
      await vc.send({ type: 'move', unitId: u.id, to: best.to });
      return 'move';
    };
  });
  await p.waitForTimeout(300);
  await snap(dir, '04-expedition-moved');
  const found = await script(40);
  await p.waitForTimeout(500);
  if (found) {
    await p.click('.focus-row button[aria-label="More Focus"]').catch(() => {});
    await p.waitForTimeout(200);
    await snap(dir, '05-attack-preview');
    await p.evaluate(() => (window.vc.hud.holdDice = true));
    await p.click('.pv-actions .btn-primary');
    // Catch the dice mid-flip and after.
    await p.waitForSelector('.die.flipped', { timeout: 20000 }).catch(() => {});
    await snap(dir, '06-dice-flipping');
    await p.waitForSelector('.dice-result span', { timeout: 20000 }).catch(() => {});
    await snap(dir, '07-dice-result');
    await idle();
    await p.evaluate(() => {
      window.vc.hud.holdDice = false;
      window.vc.hud.hideDice();
    });
    await p.waitForTimeout(1500);
    await snap(dir, '08-after-attack');
  } else console.log('[tour] no fight found');
  // End the turn and catch the castle phase.
  await p.evaluate(() => window.vc.send({ type: 'endTurn' }));
  await p.waitForTimeout(400);
  await snap(dir, '09-castle-phase');
  await idle();
  await p.waitForTimeout(400);
  await snap(dir, '10-next-turn');
  // Level 2 view.
  await p.click('.level-btn >> text=2').catch(() => {});
  await p.waitForTimeout(800);
  await snap(dir, '11-level2');
  // Play on until the expedition ends: everyone walks home or dies.
  await p.evaluate(async () => {
    const vc = window.vc;
    vc.dio.clock.speed = 12;
    const engine = window.vcEngine;
    for (let i = 0; i < 60; i++) {
      const s = vc.state();
      if (s.stage !== 'expedition') return;
      while (vc.busy()) await new Promise((r) => setTimeout(r, 50));
      const st = vc.state();
      if (st.stage !== 'expedition') return;
      let acted = false;
      for (const u of st.expedition.units.filter((x) => x.side === 'player' && !x.exited && x.actionsLeft > 0)) {
        const acts = engine.actions(st, u.id);
        if (acts.some((a) => a.kind === 'exit')) {
          await vc.send({ type: 'exit', unitId: u.id });
          acted = true;
          break;
        }
        const reach = engine.reachable(st, u.id);
        const ent = engine.map().levels.flatMap((l) => l.entrances);
        const d = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + (a.level === b.level ? 0 : 30);
        if (reach.length) {
          reach.sort((a, b) => Math.min(...ent.map((e) => d(a.to, e))) - Math.min(...ent.map((e) => d(b.to, e))));
          await vc.send({ type: 'move', unitId: u.id, to: reach[0].to });
          acted = true;
          break;
        }
      }
      if (!acted) await vc.send({ type: 'endTurn' });
    }
  });
  await idle().catch(() => {});
  await p.waitForTimeout(600);
  await snap(dir, '12-debrief');
  await p.click('text=Next week').catch(() => {});
  await p.waitForTimeout(400);
  await snap(dir, '13-week2');
  // Force an end screen by skipping weeks.
  for (let i = 0; i < 4; i++) {
    const ok = await p.click('text=Skip the week', { timeout: 1500 }).then(() => true).catch(() => false);
    if (!ok) break;
    await p.waitForTimeout(250);
  }
  await snap(dir, '14-end');
}
console.log('[errors]', errors);
await b.close();
