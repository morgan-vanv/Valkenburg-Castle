// Scenes: rescue prisoner, rival crew, Gloam close up, and a won summary.
//   node scripts/v3-shot-scenes2.mjs <baseUrl> <outDir>
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';

const [base, dir] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.route(/fonts\./, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
let errors = 0;
p.on('console', (m) => m.type() === 'error' && (errors++, console.log('[console]', m.text())));
p.on('pageerror', (e) => (errors++, console.log('[pageerror]', e.message)));
const snap = async (name) => {
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${dir}/${name}.png` });
  console.log('[shot]', name);
};
const idle = () => p.waitForFunction(() => window.vc && !window.vc.busy(), null, { timeout: 60000 });
await p.goto(base);
await p.evaluate(() => localStorage.clear());
await p.reload();
await p.waitForFunction(() => !!window.vc);

// Find a seed whose board has a rescue contract, start it, and teleport the party next to the prisoner.
const ok = await p.evaluate(async () => {
  const E = window.vcEngine;
  for (let seed = 1; seed < 60; seed++) {
    let s = E.apply(E.newGame(seed), { type: 'newCampaign', seed }).state;
    s.campaign.reputation = 3;
    const k = s.campaign.board.find((c) => c.kind === 'rescue');
    if (!k) continue;
    const r = E.apply(s, { type: 'startDelve', contractId: k.id, heroIds: ['keven', 'brann', 'pim', 'aldous'], entrance: 0, packs: {} });
    if (r.error || !r.state.delve?.prisoner) continue;
    s = structuredClone(r.state);
    const d = s.delve;
    const pr = d.prisoner;
    const lv = E.castle().levels.find((l) => l.level === pr.at.level);
    const dirs = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
    const spots = [];
    for (const [dq, dr] of dirs) {
      const q = pr.at.q + dq, rr = pr.at.r + dr;
      const t = lv.tiles[`${q},${rr}`];
      if (t && ['floor', 'rubble'].includes(t.kind)) spots.push({ level: pr.at.level, q, r: rr });
    }
    for (const [dq, dr] of dirs) for (const [eq, er] of dirs) {
      const q = pr.at.q + dq + eq, rr = pr.at.r + dr + er;
      const t = lv.tiles[`${q},${rr}`];
      if (t && t.kind === 'floor' && !spots.some((x) => x.q === q && x.r === rr) && !(q === pr.at.q && rr === pr.at.r)) spots.push({ level: pr.at.level, q, r: rr });
    }
    d.heroes.forEach((h, i) => spots[i] && (h.at = spots[i]));
    d.monsters = d.monsters.filter((m) => m.at.level !== pr.at.level || Math.abs(m.at.q - pr.at.q) + Math.abs(m.at.r - pr.at.r) > 4);
    d.lanternBearer = 'keven';
    window.vc.load(s);
    window.vc.dio.lookAt(pr.at, true);
    return seed;
  }
  return null;
});
console.log('[rescue seed]', ok);
await snap('30-prisoner');
// Free the prisoner if possible.
await p.evaluate(async () => {
  const E = window.vcEngine;
  const s = window.vc.state();
  for (const h of s.delve.heroes) {
    const a = E.actions(s, h.heroId).find((x) => x.action === 'free');
    if (a) {
      window.vc.hud.select(h.heroId);
      await window.vc.send({ type: 'act', heroId: h.heroId, action: 'free', target: a.targets[0], focus: 0 });
      return;
    }
  }
});
await idle();
await snap('31-freed');

// Rivals: put the Lantern Sisters on the map near the party, spotted.
await p.evaluate(() => {
  const s = structuredClone(window.vc.state());
  const d = s.delve;
  const h0 = d.heroes[0].at;
  const lv = window.vcEngine.castle().levels.find((l) => l.level === h0.level);
  const free = [];
  for (let dq = -4; dq <= 4; dq++)
    for (let dr = -4; dr <= 4; dr++) {
      const q = h0.q + dq, r = h0.r + dr;
      const dist = (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
      const t = lv.tiles[`${q},${r}`];
      if (dist >= 2 && dist <= 3 && t && t.kind === 'floor' && !d.heroes.some((h) => h.at.q === q && h.at.r === r)) free.push({ level: h0.level, q, r });
    }
  d.rivals = {
    crew: 'lantern-sisters',
    name: 'The Lantern Sisters',
    stance: 'neutral',
    goal: 'loot',
    spotted: true,
    entersRound: 1,
    members: ['Sister Wenna', 'Sister Odile', 'Sister Brisk'].map((name, i) => ({ id: `r${i + 1}`, crew: 'lantern-sisters', name, at: free[i * 2] ?? h0, hp: 7, maxHp: 7, loot: [], goneOut: false })),
  };
  d.heroes[0].pack.push({ id: 'gx', kind: 'gold', name: 'Gold', amount: 60, slots: 1 });
  window.vc.load(s);
});
await snap('32-rivals');

// The Gloam close: spawn it 2 hexes from the lantern bearer at light 0.
await p.evaluate(() => {
  const s = structuredClone(window.vc.state());
  const d = s.delve;
  d.light = 0;
  d.rivals = null;
  const h0 = d.heroes.find((h) => h.heroId === d.lanternBearer).at;
  const lv = window.vcEngine.castle().levels.find((l) => l.level === h0.level);
  let at = null;
  for (const [dq, dr] of [[2, 0], [0, 2], [-2, 0], [0, -2], [2, -2], [-2, 2], [1, 1], [-1, -1]]) {
    const t = lv.tiles[`${h0.q + dq},${h0.r + dr}`];
    if (t && t.kind === 'floor') {
      at = { level: h0.level, q: h0.q + dq, r: h0.r + dr };
      break;
    }
  }
  d.monsters.push({ id: 'm99', kind: 'gloam', name: 'The Gloam', at, hp: 99, maxHp: 99, awareness: 'hunting', spawnedAt: at, intent: { kind: 'move', to: h0 } });
  window.vc.load(s);
});
await snap('33-gloam-close');

// A won summary.
await p.evaluate(() => {
  const s = structuredClone(window.vc.state());
  s.stage = 'summary';
  s.summary = { contractDone: true, bounty: 150, lootValue: 212, survivors: ['keven', 'brann', 'pim'], wounded: ['pim'], dead: ['aldous'], xp: { hobart: 6, brann: 5, pim: 4 }, levelUps: ['keven', 'brann'], notes: ['Brother Edric is free.', 'The Lantern Sisters took the chapel chest.', 'Aldous fell in the cellblock.'] };
  window.vc.load(s);
});
await snap('34-summary-won');
console.log('[errors]', errors);
await b.close();
