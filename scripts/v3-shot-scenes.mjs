// Extra V3 screenshots of specific situations (intents, dark light, the Gloam,
// level 2), built by editing the real engine's state through window.vc.load.
//   node scripts/v3-shot-scenes.mjs <baseUrl> <outDir>
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';

const [base, dir] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
let errors = 0;
p.on('console', (m) => m.type() === 'error' && (errors++, console.log('[console]', m.text())));
p.on('pageerror', (e) => (errors++, console.log('[pageerror]', e.message)));
const snap = async (name) => {
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${dir}/${name}.png` });
  console.log('[shot]', name);
};
const idle = () => p.waitForFunction(() => window.vc && !window.vc.busy(), null, { timeout: 60000 });
await p.goto(base);
await p.evaluate(() => localStorage.clear());
await p.reload();
await p.waitForFunction(() => !!window.vc);
// Start a delve on a level 1 contract with the default party.
await p.evaluate(async () => {
  const E = window.vcEngine;
  let s = E.newGame(7);
  s = E.apply(s, { type: 'newCampaign', seed: 7 }).state;
  window.vc.load(s);
  const k = s.campaign.board[0];
  await window.vc.send({ type: 'startDelve', contractId: k.id, heroIds: ['keven', 'brann', 'pim', 'aldous'].filter((id) => s.campaign.roster.some((h) => h.id === id)), entrance: 0, packs: {} });
});
await idle();
// Scene 1: wake monsters near the party and move one adjacent to see intents.
await p.evaluate(() => {
  const E = window.vcEngine;
  const s = structuredClone(window.vc.state());
  const d = s.delve;
  const lead = d.heroes[0];
  const H = (q, r) => ({ level: lead.at.level, q, r });
  const castle = E.castle();
  const lv = castle.levels.find((l) => l.level === lead.at.level);
  const free = (p) => {
    const t = lv.tiles[`${p.q},${p.r}`];
    return t && ['floor', 'rubble'].includes(t.kind) && !d.heroes.some((h) => h.at.q === p.q && h.at.r === p.r) && !d.monsters.some((m) => m.at.level === p.level && m.at.q === p.q && m.at.r === p.r);
  };
  const ring = [];
  for (let rad = 2; rad <= 3; rad++)
    for (let dq = -rad; dq <= rad; dq++)
      for (let dr = -rad; dr <= rad; dr++) {
        const dist = (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
        if (dist === rad && free(H(lead.at.q + dq, lead.at.r + dr))) ring.push(H(lead.at.q + dq, lead.at.r + dr));
      }
  const kinds = ['orc', 'spider', 'rats', 'cutpurse'];
  d.monsters.slice(0, 4).forEach((m, i) => {
    if (!ring[i * 2]) return;
    m.at = ring[i * 2];
    m.kind = kinds[i];
    m.name = kinds[i][0].toUpperCase() + kinds[i].slice(1);
    m.awareness = 'hunting';
  });
  window.vc.load(s);
});
await p.waitForTimeout(600);
await snap('20-intents');
// Hover a monster for its tooltip.
const box = await p.evaluate(() => {
  const el = document.querySelector('.intent');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height + 40 };
});
if (box) {
  await p.mouse.move(box.x, box.y);
  await snap('21-monster-hover');
}
// Scene 2: dim and dark light.
await p.evaluate(() => {
  const s = structuredClone(window.vc.state());
  s.delve.light = 14;
  window.vc.load(s);
});
await snap('22-dark');
// Scene 3: pitch black and the Gloam via endTurn.
await p.evaluate(async () => {
  const s = structuredClone(window.vc.state());
  s.delve.light = 1;
  window.vc.load(s);
  await window.vc.send({ type: 'endTurn' });
});
await idle();
await snap('23-gloam');
// Rotate camera.
await p.keyboard.press(']');
await p.keyboard.press(']');
await p.waitForTimeout(800);
await snap('24-rotated');
console.log('[errors]', errors);
await b.close();
