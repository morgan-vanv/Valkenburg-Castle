// Spec 17.1 and 17.2 check, headless, by DOM text: a new campaign has 120 gold and level-1
// recruits at 60; a hurt hero shows their HP in camp; the infirmary offers per-HP healing and
// it works. No screenshots.
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
check('new campaign: 120 gold', s0.gold === 120, `${s0.gold}`);
check('opening recruits all level 1 at 60', s0.recruits.every(([l, pr]) => l === 1 && pr === 60), JSON.stringify(s0.recruits));
// Hire two, hurt one, open the infirmary.
await p.evaluate(async () => {
  for (const r of window.vc.state().campaign.recruits.slice(0, 2)) await window.vc.send({ type: 'hire', heroId: r.hero.id });
  const s = window.vc.state();
  s.campaign.gold = 50;
  s.campaign.roster[1].hp = s.campaign.roster[1].maxHp - 4;
  window.vc.load(s);
});
await p.getByText('Infirmary', { exact: false }).first().click();
await p.waitForTimeout(300);
const text = await p.evaluate(() => document.body.innerText);
check('infirmary explains per-HP healing', /3 gold per HP/.test(text));
check('infirmary offers "Heal 4 HP · 12"', /Heal 4 HP · 12/.test(text));
await p.getByText('Heal 4 HP · 12').click();
await p.waitForTimeout(300);
const after = await p.evaluate(() => {
  const s = window.vc.state();
  return { gold: s.campaign.gold, hp: s.campaign.roster[1].hp, max: s.campaign.roster[1].maxHp };
});
check('healing paid and applied', after.gold === 38 && after.hp === after.max, JSON.stringify(after));
console.log(`\n${failed} failed, ${errors} console errors`);
await b.close();
process.exit(failed || errors ? 1 : 0);
