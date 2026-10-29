// Spec 17.1 and 17.2 check, headless, by DOM text: a new campaign has 90 gold (V3.7.1) and level-1
// recruits at 60; a hurt hero shows their HP in camp; with the surgeon home, healing for gold is
// offered in the hero's party slot (V4.0: the infirmary page is gone) and it works. No screenshots.
//   node scripts/v34-camp-check.mjs <baseUrl>
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';

const [base] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
await p.route(/fonts\./, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
let errors = 0;
let failed = 0;
p.on('pageerror', (e) => (errors++, console.log('[pageerror]', e.message)));
p.on('console', (m) => m.type() === 'error' && (errors++, console.log('[console]', m.text())));
const check = (name, ok, extra = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`);
};
await p.goto(base);
await p.evaluate(() => localStorage.clear());
await p.reload();
await p.waitForFunction(() => !!window.vc);
const s0 = await p.evaluate(() => {
  const s = window.vcEngine.newGame(42);
  window.vc.load(s);
  return { gold: s.campaign.gold, recruits: s.campaign.recruits.map((r) => [r.hero.level, r.price]) };
});
check('new campaign: 90 gold', s0.gold === 90, `${s0.gold}`);
check('opening drifters: 3, all level 1 at 60 (18.2)', s0.recruits.length === 3 && s0.recruits.every(([l, pr]) => l === 1 && pr === 60), JSON.stringify(s0.recruits));
// Hire one (90 gold buys one), hurt them, open the infirmary.
await p.evaluate(async () => {
  for (const r of window.vc.state().campaign.recruits.slice(0, 1)) await window.vc.send({ type: 'hire', heroId: r.hero.id });
  const s = window.vc.state();
  s.campaign.gold = 50;
  s.campaign.village.surgeon = true; // V3.5: healing for gold needs Brother Aldric home
  s.campaign.roster[1].hp = s.campaign.roster[1].maxHp - 4;
  window.vc.load(s);
});
// V4.0: healing lives in the party slots on step 2; take the hire along from the roster bench.
await p.click('.lg-step[data-step="party"]');
await p.waitForTimeout(150);
const hid = await p.evaluate(() => window.vc.state().campaign.roster[1].id);
if (await p.$(`[data-bench="${hid}"]`)) await p.click(`[data-bench="${hid}"]`);
await p.waitForTimeout(150);
const heal = p.locator(`[data-heal="${hid}"]`);
const tip = await heal.getAttribute('data-tip').catch(() => '');
check('healing explains per-HP pricing', /3 gold per HP/.test(tip ?? ''), tip ?? '');
// V5.1 (W2): the Party board's heal button reads "Heal" and the price on a coin.
check('the slot offers "Heal 12" (coin)', /Heal\s*12/.test(await heal.innerText().catch(() => '')));
await heal.click();
await p.waitForTimeout(300);
const after = await p.evaluate(() => {
  const s = window.vc.state();
  return { gold: s.campaign.gold, hp: s.campaign.roster[1].hp, max: s.campaign.roster[1].maxHp };
});
check('healing paid and applied', after.gold === 38 && after.hp === after.max, JSON.stringify(after));
console.log(`\n${failed} failed, ${errors} console errors`);
await b.close();
process.exit(failed || errors ? 1 : 0);
