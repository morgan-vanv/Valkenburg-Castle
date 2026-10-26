// V3.4 HUD checks, headless, by DOM assertions (fixture engine, injected 4-hero state).
//
//   node scripts/v34-hud-check.mjs <baseUrl>        SHOT=<path.png> also takes one 1440×900 shot
//                                                    of the top-left HUD (clip 560×520).
//   ONLY_SHOT=1 skips the assertions (for the "before" shot).

import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';

const [base] = process.argv.slice(2);
const shotPath = process.env.SHOT;
const onlyShot = process.env.ONLY_SHOT === '1';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
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

const url = base + (base.includes('?') ? '&' : '?') + 'fixture=1';
await p.goto(url);
await p.evaluate(() => localStorage.clear());
await p.evaluate(() => localStorage.setItem('vc.settings', JSON.stringify({ speed: 0, reduceShake: true, reduceFlashes: false, noEndTurnAsk: true })));
await p.reload();
await p.waitForFunction(() => !!window.vc, null, { timeout: 30000 });
await p.fill('input.seed', '7');
await p.click('text=New campaign');
await p.waitForTimeout(200);
await p.click('.lg-step[data-step="setout"]'); // V4.0: Lowgate's step 4
await p.click('.lg-delve');
await idle();
await p.waitForTimeout(300);

// Inject a 4-hero squad with a mix of packs and statuses (like the owner's screenshot).
await p.evaluate(() => {
  const vc = window.vc;
  const s = structuredClone(vc.state());
  const d = s.delve;
  const hob = d.heroes.find((h) => h.heroId === d.lanternBearer) ?? d.heroes[0];
  const hobDef = s.campaign.roster.find((r) => r.id === hob.heroId);
  const lv = window.vcEngine.castle().levels.find((l) => l.level === hob.at.level);
  const floors = Object.entries(lv.tiles)
    .filter(([, t]) => t.kind === 'floor')
    .map(([k]) => ({ level: hob.at.level, q: Number(k.split(',')[0]), r: Number(k.split(',')[1]) }))
    .filter((q) => !d.heroes.some((h) => h.at.q === q.q && h.at.r === q.r));
  const dist = (a, c) => (Math.abs(a.q - c.q) + Math.abs(a.r - c.r) + Math.abs(a.q + a.r - c.q - c.r)) / 2;
  floors.sort((a, c) => dist(a, hob.at) - dist(c, hob.at));
  const item = (id, kind, name, slots = 1, amount = 1) => ({ id, kind, name, slots, amount });
  const mk = (id, name, cls, level, maxHp) => ({ ...structuredClone(hobDef), id, name, cls, level, maxHp });
  const recruits = [mk('h-marek', 'Marek', 'ranger', 2, 8), mk('h-eskil', 'Eskil', 'pyromancer', 1, 6), mk('h-hilde', 'Hilde', 'sellsword', 1, 10)];
  s.campaign.roster = [hobDef, ...recruits];
  const base = (hd, at) => ({ ...structuredClone(hob), heroId: hd, at, moved: false, acted: false, dashed: false, torch: 0, webbed: false, veil: 0, ward: 0, overwatch: false, grabbedBy: undefined, guarding: undefined, escorting: undefined, mana: 0, rallyCooldown: 0 });
  hob.pack = [item('i1', 'torch', 'Torch'), item('i2', 'gold', 'Gold', 1, 34)];
  hob.hp = 12;
  const marek = { ...base('h-marek', floors[0]), hp: 3, focus: 3, pack: [item('i3', 'gem', 'Garnet', 1, 25)], moved: true, overwatch: true };
  const eskil = { ...base('h-eskil', floors[1]), hp: 6, focus: 2, mana: 2, pack: [item('i4', 'heirloom', 'the Valkenburg Signet', 2, 60), item('i5', 'oil', 'Oil flask'), item('i6', 'potion', 'Potion')], ward: 2 };
  const hilde = { ...base('h-hilde', floors[2]), hp: 7, focus: 1, pack: [], webbed: true, veil: 1 };
  d.heroes = [hob, marek, eskil, hilde];
  vc.load(s);
  vc.hud.select('h-marek');
  vc.dio.renderNow();
});
await p.waitForTimeout(200);

if (shotPath) {
  await p.evaluate(() => window.vc.dio.renderNow());
  await p.screenshot({ path: shotPath, clip: { x: 0, y: 0, width: 560, height: 520 }, timeout: 150000, animations: 'disabled' });
  console.log('shot', shotPath);
}
if (onlyShot) {
  await b.close();
  process.exit(0);
}

// 1. Layout: cards don't overlap the light panel or round at three viewport sizes.
for (const [w, hgt] of [
  [1200, 750],
  [1440, 900],
  [2560, 1305],
]) {
  await p.setViewportSize({ width: w, height: hgt });
  await p.waitForTimeout(150);
  const r = await p.evaluate(() => {
    const box = (e) => e.getBoundingClientRect();
    const top = [...document.querySelectorAll('.hud-top > *')].map(box);
    const cards = [...document.querySelectorAll('.hcard')].map(box);
    const over = (a, c) => a.left < c.right && c.left < a.right && a.top < c.bottom && c.top < a.bottom;
    let hits = 0;
    for (const c of cards) for (const t of top) if (over(c, t)) hits++;
    // Light foot (second line) fully inside its panel and visible.
    const foot = document.querySelector('.light-foot');
    const light = document.querySelector('.light');
    const footIn = foot && light ? box(foot).bottom <= box(light).bottom + 0.5 : false;
    const last = cards[cards.length - 1];
    return { hits, footIn, n: cards.length, lastBottom: last?.bottom ?? 0, right: Math.max(...cards.map((c) => c.right)) };
  });
  check(`${w}×${hgt}: hero cards clear the top panels`, r.hits === 0 && r.footIn, JSON.stringify(r));
  check(`${w}×${hgt}: four cards fit above the bottom, left column only`, r.n === 4 && r.lastBottom < hgt - 90 && r.right < w * 0.3, `bottom ${Math.round(r.lastBottom)}, right ${Math.round(r.right)}`);
}
await p.setViewportSize({ width: 1440, height: 900 });
await p.waitForTimeout(150);

// 2. Pack sockets: 4 per card, empty ones marked, the heirloom spans two, free count in words, tooltips.
const pk = await p.evaluate(() => {
  const cards = [...document.querySelectorAll('.hcard')];
  return cards.map((c) => {
    const socks = [...c.querySelectorAll('.pk-sock')];
    return {
      name: c.querySelector('.hc-name')?.textContent ?? '',
      span: socks.reduce((n, s) => n + Number(s.dataset.span || 1), 0),
      empty: socks.filter((s) => s.classList.contains('empty')).length,
      wide: socks.filter((s) => s.dataset.span === '2').length,
      free: c.querySelector('.pk-free')?.textContent ?? '',
      tips: socks.map((s) => s.getAttribute('title') || s.dataset.tip || ''),
    };
  });
});
check('every card has 4 pack sockets', pk.every((c) => c.span === 4), pk.map((c) => c.span).join(','));
check('free count in words', pk.every((c) => /^(\d free|Full)$/.test(c.free.trim())), pk.map((c) => c.free).join(' | '));
check('heirloom spans two sockets, card reads Full', pk[2].wide === 1 && /Full/.test(pk[2].free), JSON.stringify(pk[2]));
check('empty pack: 4 empty sockets', pk[3].empty === 4 && /4 free/.test(pk[3].free));
check('every socket has a tooltip; filled ones say how to use', pk.every((c) => c.tips.every((t) => t.length > 8)) && /Use:/.test(pk[0].tips[0]), pk[0].tips[0]);
check('torch tooltip names 12 rounds', /12 rounds/.test(pk[0].tips[0]), pk[0].tips[0]);

// 3. Names with class words; HP numbers; labelled focus/mana; status badges with titles.
const cardText = await p.evaluate(() => [...document.querySelectorAll('.hcard')].map((c) => ({
  name: c.querySelector('.hc-name')?.textContent ?? '',
  hp: c.querySelector('.hc-hp')?.textContent ?? '',
  res: [...c.querySelectorAll('.hc-res')].map((e) => `${e.textContent}|${e.getAttribute('title') ?? ''}`),
  chips: [...c.querySelectorAll('.chip')].map((e) => ({ t: e.textContent, tip: e.getAttribute('title') ?? '' })),
  turn: c.querySelector('.hc-turn')?.getAttribute('title') ?? '',
})));
check('names carry the class word and level', /Marek.*Ranger.*L2/.test(cardText[1].name) && /Eskil.*Pyromancer/.test(cardText[2].name), cardText.map((c) => c.name).join(' | '));
check('HP shown as numbers', /3\s*\/\s*8/.test(cardText[1].hp), cardText[1].hp);
check('Focus and Mana labelled, with tooltips', /Focus/i.test(cardText[2].res.join()) && /Mana/i.test(cardText[2].res.join()) && cardText[2].res.every((r) => r.split('|')[1].length > 10), cardText[2].res.join(' ; '));
const chips = cardText.flatMap((c) => c.chips);
check('every status badge has a tooltip', chips.length >= 4 && chips.every((c) => c.tip.length > 12), chips.map((c) => `${c.t}=${c.tip.length}`).join(', '));
check('turn state has a tooltip', cardText.every((c) => /move|Moved/i.test(c.turn)));
check('lantern bearer badge', /lantern/i.test(chips.map((c) => c.t + c.tip).join()));

// 4. Action bar: every visible button has a title; Kindle mentions 6.
const bar = await p.evaluate(() => {
  const vc = window.vc;
  const out = [];
  for (const id of vc.state().delve.heroes.map((h) => h.heroId)) {
    vc.hud.select(id);
    for (const btn of document.querySelectorAll('.hud-bar button')) out.push({ who: id, label: btn.textContent.trim(), title: btn.getAttribute('title') || btn.dataset.tip || '' });
  }
  return out;
});
const untitled = bar.filter((x) => x.title.trim().length < 6);
check('every action-bar button has a tooltip', untitled.length === 0, untitled.map((x) => `${x.who}:${x.label}`).join(', '));
const help = await p.evaluate(async () => {
  const n = await import('/src/ui/names.ts');
  return { ...n.ACTION_HELP, kindleTip: `Kindle · ${n.actionCost('kindle', 1, false)}\n${n.actionHelp('kindle', 'pyromancer')}` };
});
check('Kindle tooltip: 1 mana, 6 rounds of light, silent', /Kindle · 1 mana/.test(help.kindleTip) && /6 rounds of light/.test(help.kindleTip) && /[Ss]ilent/.test(help.kindleTip) && !/12/.test(help.kindleTip), help.kindleTip.replace('\n', ' / '));
check('Oil help says +8', /\+?8/.test(help.oil ?? '') && !/10/.test(help.oil));
const missing = await p.evaluate(async () => {
  const n = await import('/src/ui/names.ts');
  const kinds = ['attack', 'pick', 'smash', 'open', 'take', 'drop', 'give', 'disarm', 'light', 'torch', 'potion', 'revive', 'charge', 'rope', 'climb', 'jump', 'shove', 'free', 'bribe', 'rally', 'guard', 'firebolt', 'kindle', 'mend', 'passLantern', 'winch', 'shutter', 'escape', 'leave', 'overwatch', 'knockback', 'throwCharge', 'dig', 'fireball', 'veil', 'sleep', 'blink', 'ward', 'gust', 'smoke', 'glue', 'dart', 'caltrops', 'firecracker', 'key', 'oil', 'grapple'];
  const monsters = ['rats', 'orc', 'spider', 'cutpurse', 'berserker', 'dragon', 'gloam', 'archer', 'captain', 'ghoul'];
  return { acts: kinds.filter((k) => !n.ACTION_HELP[k]), mons: monsters.filter((k) => !n.MONSTER_NOTE[k]) };
});
check('ACTION_HELP covers every action', missing.acts.length === 0, missing.acts.join(','));
check('MONSTER_NOTE covers every monster', missing.mons.length === 0, missing.mons.join(','));

// 5. Top panels explain themselves.
const top = await p.evaluate(() => ({
  light: document.querySelector('.light')?.getAttribute('title') ?? '',
  round: document.querySelector('.hud-round')?.getAttribute('title') ?? '',
  levels: [...document.querySelectorAll('.level-btn')].map((e) => e.getAttribute('title') ?? ''),
  cam: [...document.querySelectorAll('.hud-cam button')].map((e) => e.getAttribute('title') ?? ''),
}));
check('light panel tooltip names stages and sight', /Bright/.test(top.light) && /sight/i.test(top.light), top.light.slice(0, 80));
check('round counter has a tooltip', top.round.length > 10, top.round);
check('level buttons have tooltips', top.levels.every((t) => t.length > 6));

// 6. Settings: "Lower walls near the camera", default off, toggles the diorama.
const st = await p.evaluate(async () => {
  const vc = window.vc;
  document.querySelector('.hud-sys button[title^="Menu"]')?.click();
  await new Promise((r) => setTimeout(r, 50));
  const lab = [...document.querySelectorAll('.menu-check')].find((l) => /Lower walls/.test(l.textContent));
  const box = lab?.querySelector('input');
  const before = { checked: box?.checked, cut: vc.dio.cutaway };
  box?.click();
  const after = { checked: box?.checked, cut: vc.dio.cutaway, saved: JSON.parse(localStorage.getItem('vc.settings')).cutaway };
  box?.click();
  return { found: !!lab, before, after, back: vc.dio.cutaway };
});
check('setting exists, off by default, toggles dio.cutaway and is saved', st.found && st.before.checked === false && st.before.cut === false && st.after.cut === true && st.after.saved === true && st.back === false, JSON.stringify(st));

console.log(`\n${failed} failed, ${errors} console errors`);
await b.close();
process.exit(failed || errors ? 1 : 0);
