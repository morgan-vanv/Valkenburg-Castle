// V3.1 scene screenshots on the real engine and the test castle (?castle=test):
// jump flow (targets, landing hover, confirm dialog), edge badge and lip,
// shove preview, orc shove intent, Dragon breath intent, the fall animation,
// the breath jet, the winch, and the slay contract card.
//
//   node scripts/v31-shot-scenes.mjs <baseUrl> <outDir>
//
// Positions are odd-r offsets on src/game/test/testCastle.ts.

import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';

const [base, dir] = process.argv.slice(2);
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
const snap = async (name, wait = 600) => {
  await p.waitForTimeout(wait);
  await p.screenshot({ path: `${dir}/${name}.png`, timeout: 90000 });
  console.log('[shot]', name);
};
const idle = () => p.waitForFunction(() => window.vc && !window.vc.busy(), null, { timeout: 90000 });

await p.goto(`${base}?castle=test`);
await p.evaluate(() => localStorage.clear());
await p.reload();
await p.waitForFunction(() => !!window.vc && !!window.vcEngine, null, { timeout: 30000 });

// Helpers in the page.
await p.evaluate(() => {
  const off = (level, col, row) => ({ level, q: col - (row - (row & 1)) / 2, r: row });
  window.__off = off;
  /** Load a tweaked copy of the current state. */
  window.__tweak = (fn) => {
    const s = structuredClone(window.vc.state());
    fn(s, off);
    window.vc.load(s);
  };
});

// Start a delve on the first contract.
await p.evaluate(async () => {
  const E = window.vcEngine;
  let s = E.newGame(1980);
  s = E.apply(s, { type: 'newCampaign', seed: 1980 }).state;
  // Show the slay contract on the board for the card shot.
  s.campaign.reputation = 3;
  s.campaign.board.push({ id: 'kslay', kind: 'slay', title: 'Slay the Valkenburg Wyrm', brief: 'The Dragon sleeps on its hoard in the Lair.', siteId: 'slay', level: 3, bounty: 500, warnings: ['Level 3', '30 HP, breathes fire', 'A long way down and back'] });
  window.vc.load(s);
});
await p.waitForTimeout(400);
await snap('01-board');
await p.evaluate(async () => {
  const s = window.vc.state();
  const k = s.campaign.board[0];
  const ids = s.campaign.roster.filter((h) => !h.wounded).map((h) => h.id).slice(0, 4);
  await window.vc.send({ type: 'startDelve', contractId: k.id, heroIds: ids, entrance: 0, packs: {} });
});
await idle();

// Scene: party at the L1 pit mouth; lead on the edge (8,4) next to the two-level drop.
await p.evaluate(() =>
  window.__tweak((s, off) => {
    const d = s.delve;
    const spots = [off(1, 8, 4), off(1, 8, 3), off(1, 9, 5), off(1, 8, 5)];
    d.heroes.forEach((h, i) => {
      h.at = spots[i];
      h.moved = false;
      h.acted = false;
    });
    d.light = 60;
    // An orc next to the edge hero, awake, so it can shove.
    const orc = d.monsters.find((m) => m.kind === 'orc');
    if (orc) {
      orc.at = off(1, 7, 4);
      orc.awareness = 'hunting';
    }
  }),
);
await p.evaluate(() => {
  const { dio } = window.vc;
  const h = window.vc.state().delve.heroes[0];
  dio.lookAt(h.at, true);
  dio.rig.distance = 15;
  dio.rig.pitch = 0.85;
});
await snap('02-edge-and-intent', 1200);

// Jump: pick the action, hover the far pit hex (two levels), then preview and confirm.
const clickAct = async (label) => {
  const ok = await p.evaluate((label) => {
    const btn = [...document.querySelectorAll('.hud-bar button.act')].find((x) => x.textContent.toLowerCase().includes(label.toLowerCase()));
    if (btn) btn.click();
    return !!btn;
  }, label);
  if (!ok) console.log('[no action]', label);
  return ok;
};
const hoverHex = async (pos) => {
  const xy = await p.evaluate((pos) => {
    const { dio } = window.vc;
    const w = { x: Math.sqrt(3) * (pos.q + pos.r / 2), z: 1.5 * pos.r };
    const y = -(pos.level - 1) * 9 + 0.18;
    const v = new dio.rig.camera.position.constructor(w.x, y, w.z).project(dio.rig.camera);
    const r = dio.renderer.domElement.getBoundingClientRect();
    return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height };
  }, pos);
  await p.mouse.move(xy.x, xy.y);
  return xy;
};
if (await clickAct('Jump')) {
  await snap('03-jump-targets', 500);
  const far = await p.evaluate(() => window.__off(1, 9, 4));
  await hoverHex(far);
  await snap('04-jump-hover-2levels', 600);
  const near = await p.evaluate(() => window.__off(1, 10, 3));
  await hoverHex(near);
  await snap('05-jump-hover-bridge', 600);
  const xy = await hoverHex(far);
  await p.mouse.click(xy.x, xy.y);
  await snap('06-jump-preview', 600);
  await p.keyboard.press('Enter');
  await snap('07-jump-confirm', 400);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(700);
  await snap('08-jump-falling', 0);
  await idle();
  await snap('09-jump-landed', 800);
}

// Shove preview: put an orc on the edge next to a hero, monster beyond is the pit.
await p.evaluate(() =>
  window.__tweak((s, off) => {
    const d = s.delve;
    d.heroes.forEach((h, i) => {
      h.status = 'active';
      h.hp = Math.max(h.hp, 6);
      h.at = [off(1, 7, 4), off(1, 8, 2), off(1, 7, 5), off(1, 7, 3)][i];
      h.moved = false;
      h.acted = false;
    });
    const orc = d.monsters.find((m) => m.kind === 'orc');
    orc.at = off(1, 8, 4);
    orc.hp = orc.maxHp;
    orc.awareness = 'hunting';
  }),
);
await p.evaluate(() => {
  const { dio, hud } = window.vc;
  hud.select(window.vc.state().delve.heroes[0].heroId);
  dio.lookAt(window.vc.state().delve.heroes[0].at, true);
});
if (await clickAct('Shove')) {
  await snap('10-shove-preview', 700);
  await p.keyboard.press('Escape');
}

// Dragon: party in the Lair, Dragon awake with a breath intent.
await p.evaluate(() =>
  window.__tweak((s, off) => {
    const d = s.delve;
    d.heroes.forEach((h, i) => {
      h.status = 'active';
      h.hp = Math.max(h.hp, 8);
      h.at = [off(3, 16, 7), off(3, 15, 5), off(3, 17, 7), off(3, 14, 5)][i];
      h.moved = false;
      h.acted = false;
    });
    d.lanternBearer = d.heroes[0].heroId;
    const dr = d.monsters.find((m) => m.kind === 'dragon');
    if (dr) {
      dr.awareness = 'hunting';
      dr.at = off(3, 16, 4);
    }
  }),
);
await p.evaluate(() => {
  const { dio, hud } = window.vc;
  hud.select(window.vc.state().delve.heroes[0].heroId);
  dio.lookAt(window.__off(3, 16, 5), true);
  dio.rig.distance = 17;
});
await snap('11-dragon-awake', 1200);
const intents = await p.evaluate(() => JSON.stringify(window.vcEngine.intents(window.vc.state())));
console.log('[intents]', intents);
// End the turn to see the world phase (breath or bite).
await p.evaluate(() => window.vc.send({ type: 'endTurn' }));
await p.waitForTimeout(2500);
await snap('12-dragon-world', 0);
await idle();
await snap('13-dragon-after', 800);

// Winch room on L2.
await p.evaluate(() =>
  window.__tweak((s, off) => {
    const d = s.delve;
    d.heroes.forEach((h, i) => {
      h.status = 'active';
      h.at = [off(2, 2, 7), off(2, 2, 6), off(2, 3, 7), off(2, 3, 8)][i];
      h.moved = false;
      h.acted = false;
    });
    d.liftWorking = false;
  }),
);
await p.evaluate(() => {
  const { dio, hud } = window.vc;
  hud.select(window.vc.state().delve.heroes[0].heroId);
  dio.lookAt(window.__off(2, 2, 7), true);
  dio.rig.distance = 13;
});
await snap('14-winch-room', 1000);
if (await clickAct('Winch')) {
  await p.waitForTimeout(400);
  await p.keyboard.press('Enter').catch(() => {});
  await idle();
  await snap('15-winch-worked', 600);
}
console.log(`[done] errors: ${errors}`);
await b.close();
