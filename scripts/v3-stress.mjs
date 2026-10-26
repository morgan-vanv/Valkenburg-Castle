// Bot that plays the real engine through the UI (window.vc.send) with random
// valid commands at instant speed, to catch playback and rendering errors.
// V3.8: while exploring it gives walk orders, toggles stances, acts and sends ticks; in combat it plays turns.
//   node scripts/v3-stress.mjs <baseUrl> [delves] [outDir]
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';

const [base, delves = '3', dir = ''] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
await p.route(/fonts\./, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
let errors = 0;
p.on('console', (m) => m.type() === 'error' && (errors++, console.log('[console]', m.text().slice(0, 300))));
p.on('pageerror', (e) => (errors++, console.log('[pageerror]', e.message, e.stack?.split('\n').slice(0, 3).join(' | '))));
await p.goto(base);
await p.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('vc.settings', JSON.stringify({ speed: 0, reduceShake: true, reduceFlashes: false }));
});
await p.reload();
await p.waitForFunction(() => !!window.vc);
const res = await p.evaluate(async (n) => {
  const vc = window.vc;
  const E = window.vcEngine;
  let seed = Number(new URLSearchParams(location.search).get('bot') ?? 11);
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  let s = E.apply(E.newGame(5), { type: 'newCampaign', seed: 5 }).state;
  s.campaign.gold = 400; // V3.8: hire a party, so the bot sees several delves
  vc.load(s);
  const log = [];
  const stats = { explore: 0, combat: 0, walks: 0, ticks: 0, combatStarts: 0 };
  let lastMode = '';
  let delvesDone = 0;
  for (let step = 0; step < 6000 && delvesDone < n; step++) {
    while (vc.busy()) await new Promise((r) => setTimeout(r, 5));
    s = vc.state();
    if (s.stage === 'camp') {
      // V3.2: Hobart starts alone; hire while the engine says the party is too small and gold allows.
      let fit = s.campaign.roster.filter((h) => h.wounded === 0).slice(0, 4);
      if (E.partyProblem(s, fit.map((h) => h.id)) || (fit.length < 3 && s.campaign.recruits.some((x) => x.price <= s.campaign.gold))) {
        const r = s.campaign.recruits.find((x) => x.price <= s.campaign.gold);
        if (r) {
          await vc.send({ type: 'hire', heroId: r.hero.id });
          continue;
        }
      }
      fit = s.campaign.roster.filter((h) => h.wounded === 0).slice(0, 4);
      if (!fit.length || !s.campaign.board.length) break;
      const k = pick(s.campaign.board);
      const stash = s.campaign.stash.filter((i) => i.kind !== 'gold').slice(0, 2).map((i) => i.id);
      await vc.send({ type: 'startDelve', contractId: k.id, heroIds: fit.map((h) => h.id), entrance: 0, packs: { [fit[0].id]: stash } });
      continue;
    }
    if (s.stage === 'delve' && s.delve) {
      const m = E.mode(s).mode;
      if (m === 'combat' && lastMode === 'explore') stats.combatStarts++;
      lastMode = m;
    }
    if (s.stage === 'summary') {
      delvesDone++;
      log.push({ done: s.summary.contractDone, dead: s.summary.dead.length, loot: s.summary.lootValue, round: s.delve?.round });
      await vc.send({ type: 'backToCamp' });
      continue;
    }
    if (s.stage === 'over') {
      log.push('over');
      break;
    }
    const d = s.delve;
    const heroes = d.heroes.filter((h) => h.status === 'active');
    let sent = false;
    // V3.8 (22): exploring: walk orders, stance, actions, and ticks; combat below as before.
    if (E.mode(s).mode === 'explore') {
      stats.explore++;
      const h = pick(heroes);
      const r = rnd();
      if (h && r < 0.25) {
        const lv = E.castle().levels.find((l) => l.level === h.at.level);
        const keys = Object.keys(lv.tiles).filter((k) => { const [q, rr] = k.split(',').map(Number); return Math.abs(q - h.at.q) + Math.abs(rr - h.at.r) <= 12; });
        for (let i = 0; i < 6; i++) {
          const [q, rr] = pick(keys).split(',').map(Number);
          const reach = E.explorePath(s, h.heroId, { level: h.at.level, q, r: rr }, rnd() < 0.3);
          if (reach?.path.length) {
            await vc.send({ type: 'walk', heroId: h.heroId, path: reach.path, sneak: rnd() < 0.3 });
            stats.walks++;
            break;
          }
        }
      } else if (h && r < 0.3) {
        await vc.send({ type: 'sneak', heroId: h.heroId, on: !h.sneaking });
      } else if (h && r < 0.45) {
        const all = E.actions(s, h.heroId);
        const acts = all.some((a) => a.action === 'leave') && d.round > 12 ? all.filter((a) => a.action === 'leave') : all.filter((a) => a.action !== 'leave');
        if (acts.length) {
          const a = pick(acts);
          const t = pick(a.targets);
          if (a.rolls) E.preview(s, h.heroId, a.action, t);
          await vc.send({ type: 'act', heroId: h.heroId, action: a.action, target: t, focus: Math.floor(rnd() * 2) });
        }
      } else if (h && r < 0.48) {
        await vc.send({ type: 'stopWalk', heroId: h.heroId });
      } else {
        for (let i = 0; i < 4; i++) {
          while (vc.busy()) await new Promise((r) => setTimeout(r, 5));
          await vc.send({ type: 'tick' });
          stats.ticks++;
        }
      }
      if (d.round > 40) await vc.send({ type: 'abandon' });
      vc.hud.refresh();
      continue;
    }
    stats.combat++;
    for (const h of heroes) {
      if (!h.acted && rnd() < 0.7) {
        const all = E.actions(s, h.heroId);
        const acts = all.some((a) => a.action === 'leave') && d.round > 6 ? all.filter((a) => a.action === 'leave') : all.filter((a) => a.action !== 'leave');
        if (acts.length) {
          const a = pick(acts);
          const t = pick(a.targets);
          if (a.rolls) E.preview(s, h.heroId, a.action, t);
          await vc.send({ type: 'act', heroId: h.heroId, action: a.action, target: t, focus: Math.floor(rnd() * 2) });
          sent = true;
          break;
        }
      }
      if (!h.moved) {
        const r = E.reachable(s, h.heroId, rnd() < 0.3);
        if (r.length) {
          const t = pick(r);
          E.moveNoise(s, h.heroId, false);
          await vc.send({ type: 'move', heroId: h.heroId, path: t.path, sneak: false });
          sent = true;
          break;
        }
      }
    }
    if (!sent) {
      if (d.round > 30) await vc.send({ type: 'abandon' });
      else await vc.send({ type: 'endTurn' });
    }
    // Exercise HUD paths.
    vc.hud.refresh();
  }
  return { log, stats };
}, Number(delves));
console.log(JSON.stringify(res));
if (dir) await p.screenshot({ path: `${dir}/stress-end.png` });
console.log('[errors]', errors);
await b.close();
