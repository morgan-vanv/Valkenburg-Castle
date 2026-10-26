// V3.4 HUD checks, headless, by DOM assertions (fixture engine, injected 4-hero state).
// V4.0: updated to the rebuilt HUD (party rail, top strip, hotbar); the V3.4 card details it no longer
// draws (free-slot words, Focus pips, status words) became hover text, so those checks read the tooltips.
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

// V4.0 HUD (rebuilt): the same questions of the new DOM: the party rail clears the top strip, every
// card shows the pack (4 slots, a 2-slot item spans two), every mark explains itself on hover.
const tipOf = (e) => (e ? e.getAttribute('title') || e.dataset.tip || '' : '');
// 1. Layout: cards don't overlap the top strip at three viewport sizes.
for (const [w, hgt] of [
  [1200, 750],
  [1440, 900],
  [2560, 1305],
]) {
  await p.setViewportSize({ width: w, height: hgt });
  await p.waitForTimeout(150);
  const r = await p.evaluate(() => {
    const box = (e) => e.getBoundingClientRect();
    const top = [...document.querySelectorAll('.dl-strip > *')].map(box);
    const cards = [...document.querySelectorAll('.dl-rcard')].map(box);
    const over = (a, c) => a.left < c.right && c.left < a.right && a.top < c.bottom && c.top < a.bottom;
    let hits = 0;
    for (const c of cards) for (const t of top) if (over(c, t)) hits++;
    // The lantern's notched bar sits inside its panel.
    const bar = document.querySelector('.dl-notches');
    const light = document.querySelector('.dl-lantern');
    const footIn = bar && light ? box(bar).bottom <= box(light).bottom + 0.5 : false;
    const last = cards[cards.length - 1];
    return { hits, footIn, n: cards.length, lastBottom: last?.bottom ?? 0, right: Math.max(...cards.map((c) => c.right)) };
  });
  check(`${w}×${hgt}: hero cards clear the top strip`, r.hits === 0 && r.footIn, JSON.stringify(r));
  check(`${w}×${hgt}: four cards fit above the hotbar, left column only`, r.n === 4 && r.lastBottom < hgt - 120 && r.right < w * 0.3, `bottom ${Math.round(r.lastBottom)}, right ${Math.round(r.right)}`);
}
await p.setViewportSize({ width: 1440, height: 900 });
await p.waitForTimeout(150);

// 2. The pack row on each card: 4 slots, the heirloom spans two, empty ones marked, a tooltip naming what's in it.
const pk = await p.evaluate(() => {
  const cards = [...document.querySelectorAll('.dl-rcard')];
  return cards.map((c) => {
    const minis = [...c.querySelectorAll('.dl-mini')];
    const row = c.querySelector('.dl-minis');
    return {
      span: minis.reduce((n, s) => n + (s.classList.contains('wide') ? 2 : 1), 0),
      empty: minis.filter((s) => !s.classList.contains('full')).length,
      wide: minis.filter((s) => s.classList.contains('wide')).length,
      tip: row ? row.getAttribute('title') || row.dataset.tip || '' : '',
    };
  });
});
check('every card shows 4 pack slots', pk.every((c) => c.span === 4), pk.map((c) => c.span).join(','));
check('heirloom spans two slots, the pack reads full', pk[2].wide === 1 && pk[2].empty === 0 && /full/.test(pk[2].tip), JSON.stringify(pk[2]));
check('empty pack: 4 empty slots', pk[3].empty === 4 && /empty/.test(pk[3].tip), JSON.stringify(pk[3]));
check('the pack row names what is in it', /Torch/.test(pk[0].tip) && /34 gold/.test(pk[0].tip) && /2 free/.test(pk[0].tip), pk[0].tip);
// The selected hero's pack in the hotbar: click to use; the torch says what it does.
const slotTip = await p.evaluate(() => {
  const d = window.vc.state().delve;
  window.vc.hud.select(d.lanternBearer);
  const s = [...document.querySelectorAll('.dl-pack-slots .dl-slot')];
  return { n: s.length, torch: s[0] ? s[0].getAttribute('title') || s[0].dataset.tip || '' : '', empties: s.filter((x) => x.classList.contains('empty')).length };
});
check('the hotbar pack: 4 slots, the torch slot names 12 rounds', slotTip.n === 4 && /12 rounds/.test(slotTip.torch), slotTip.torch.split('\n')[0]);
await p.evaluate(() => window.vc.hud.select('h-marek'));

// 3. Each card: HP numbers, mana diamonds for casters, status icons and turn pips that explain themselves.
const cardText = await p.evaluate(() => [...document.querySelectorAll('.dl-rcard')].map((c) => {
  const t = (e) => (e ? e.getAttribute('title') || e.dataset.tip || '' : '');
  return {
    who: t(c.querySelector('.dl-hexwrap')),
    hp: c.querySelector('.dl-hpn')?.textContent ?? '',
    mana: t(c.querySelector('.dl-mana')),
    icons: [...c.querySelectorAll('.dl-si')].map((e) => ({ cls: e.className, tip: t(e) })),
    pips: [...c.querySelectorAll('.dl-pip')].map(t),
  };
}));
check('the badge names the class, level and Focus', /Marek · ranger, level 2/.test(cardText[1].who) && /Focus \d of \d/.test(cardText[1].who), cardText[1].who.split('\n')[0]);
check('HP shown as numbers', /3\s*\/\s*8/.test(cardText[1].hp), cardText[1].hp);
check('mana diamonds with a tooltip on the caster', /Mana · 2 of/.test(cardText[2].mana), cardText[2].mana.split('\n')[0]);
const icons = cardText.flatMap((c) => c.icons);
check('every status icon has a tooltip', icons.length >= 3 && icons.every((c) => c.tip.length > 12), icons.map((c) => `${c.cls}=${c.tip.length}`).join(', '));
check('turn pips have tooltips', cardText.every((c) => c.pips.length === 2 && c.pips.every((t) => /Move|Action/.test(t))));
check('lantern bearer icon', icons.some((c) => /lantern/.test(c.cls) && /carries it/.test(c.tip)));
check('webbed, warded and veiled show as icons', icons.some((c) => /Webbed/.test(c.tip)) && icons.some((c) => /Warded/.test(c.tip)) && icons.some((c) => /Veiled/.test(c.tip)));

// 4. The hotbar: every button has a tooltip; Kindle mentions 6.
const bar = await p.evaluate(() => {
  const vc = window.vc;
  const out = [];
  for (const id of vc.state().delve.heroes.map((h) => h.heroId)) {
    vc.hud.select(id);
    for (const btn of document.querySelectorAll('.dl-hotbar button')) out.push({ who: id, label: btn.textContent.trim(), title: btn.getAttribute('title') || btn.dataset.tip || '' });
  }
  return out;
});
const untitled = bar.filter((x) => x.title.trim().length < 6);
check('every hotbar button has a tooltip', bar.length > 8 && untitled.length === 0, untitled.map((x) => `${x.who}:${x.label}`).join(', '));
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

// 5. The top strip explains itself.
const top = await p.evaluate(() => {
  const t = (e) => (e ? e.getAttribute('title') || e.dataset.tip || '' : '');
  return {
    light: t(document.querySelector('.dl-lantern')),
    round: t(document.querySelector('.dl-round')),
    levels: [...document.querySelectorAll('.dl-lvl')].map(t),
    cam: [...document.querySelectorAll('.dl-cam button')].map(t),
  };
});
check('lantern tooltip names stages and sight', /Bright/.test(top.light) && /sight/i.test(top.light), top.light.slice(0, 80));
check('round counter has a tooltip', top.round.length > 10, top.round);
check('level tabs have tooltips', top.levels.length === 3 && top.levels.every((t) => t.length > 6));
check('camera buttons have tooltips', top.cam.length === 5 && top.cam.every((t) => t.length > 6));

// 6. Settings: "Lower walls near the camera", default off, toggles the diorama.
const st = await p.evaluate(async () => {
  const vc = window.vc;
  document.querySelector('.dl-menu-btn')?.click();
  await new Promise((r) => setTimeout(r, 50));
  const lab = [...document.querySelectorAll('.dl-check')].find((l) => /Lower walls/.test(l.textContent));
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
