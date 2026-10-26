// V4.0 in-delve HUD check (the board is the screen), headless, by DOM and state, real engine only; no screenshots.
// Covers: the top strip (lantern stage and notched bar, the job, Carrying, "?" level tabs), the party rail (a card per
// hero with its pack row; mana diamonds on casters), the hotbar for the selected hero (Walk/Sneak per hero, pack slots
// that use their item, More with Give and Drop, End turn with a dot per hero who can still act), the hover card beside
// the hovered figure, the monster sight shading on hover, the target card and the roll panel (a % on each die, an
// outcome bar, Focus diamonds raising the kill chance), the castle's turn (banner, folded hotbar), the Chronicle
// folding and opening (remembered), the parley tiles, the return report's boxes, and the first-delve coach marks
// (shown once, gone for good once done). No page errors.
//   node scripts/v40-hud-check.mjs <baseUrl>      (npx vite preview --port 4185 --strictPort → http://localhost:4185/)
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';

const [base = 'http://localhost:4185/'] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.route(/fonts\./, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
let errors = 0;
let failed = 0;
p.on('pageerror', (e) => (errors++, console.log('[pageerror]', e.message)));
p.on('console', (m) => m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource/.test(m.text()) && (errors++, console.log('[console]', m.text())));
const check = (name, ok, extra = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`);
};
const idle = () => p.waitForFunction(() => window.vc && !window.vc.busy(), null, { timeout: 120000 });
const tip = (sel) => p.$eval(sel, (e) => e.dataset.tip ?? e.getAttribute('title') ?? '').catch(() => '');
const text = (sel) => p.$eval(sel, (e) => e.innerText).catch(() => '');
const shown = (sel) => p.$eval(sel, (e) => !e.classList.contains('hidden') && getComputedStyle(e).display !== 'none').catch(() => false);
const settings = (extra = {}) => p.evaluate((x) => localStorage.setItem('vc.settings', JSON.stringify({ speed: 0, reduceShake: true, noEndTurnAsk: true, ...x })), extra);

await p.goto(base);
await p.evaluate(() => { localStorage.clear(); localStorage.setItem('vc.welcome.v40', '1'); });
await settings();
await p.reload();
await p.waitForFunction(() => !!window.vc);

// A first delve with four heroes (a caster among them), a torch and a potion in Keven's pack, the Lantern Sisters on Level 1.
const seed = await p.evaluate(async () => {
  const E = window.vcEngine;
  for (let seed = 1; seed < 80; seed++) {
    const s = E.newGame(seed);
    s.campaign.gold = 1000;
    window.vc.load(s);
    for (const r of window.vc.state().campaign.recruits) await window.vc.send({ type: 'hire', heroId: r.hero.id });
    for (const k of ['torch', 'potion', 'smoke']) await window.vc.send({ type: 'buy', kind: k });
    const st = window.vc.state();
    const ids = st.campaign.roster.slice(0, 4).map((h) => h.id);
    if (!st.campaign.roster.slice(0, 4).some((h) => ['pyromancer', 'shadowmancer', 'hedgewitch'].includes(h.cls))) continue;
    const stash = st.campaign.stash.map((i) => i.id);
    const k = st.campaign.board.find((x) => x.kind === 'recover' && !x.story) ?? st.campaign.board[0];
    await window.vc.send({ type: 'startDelve', contractId: k.id, heroIds: ids, entrance: 0, packs: { [ids[0]]: stash.slice(0, 2), [ids[1]]: stash.slice(2, 3) } });
    if (window.vc.state().delve?.rivals) return seed;
  }
  return 0;
});
check('a first delve: four heroes with a caster, the Sisters about', seed > 0, `seed ${seed}`);
if (!seed) process.exit(1);
await idle();
await p.waitForTimeout(400);

// ---- coach marks: the first one shows on the first delve
const coach1 = await p.evaluate(() => { const e = document.querySelector('.dl-coach'); return e && !e.classList.contains('hidden') ? { n: e.dataset.mark, t: e.innerText } : null; });
check('coach mark 1 on the first delve: "Click a lit hex to move <hero>"', coach1?.n === '1' && /Click a lit hex to move \w+/.test(coach1.t), coach1?.t.replace(/\n/g, ' | '));

// ---- the top strip
const strip = await p.evaluate(() => ({
  stage: document.querySelector('.dl-lantern-stage')?.textContent ?? '',
  round: document.querySelector('.dl-round')?.textContent ?? '',
  notches: document.querySelectorAll('.dl-notch').length,
  lit: document.querySelectorAll('.dl-notch.on').length,
  bands: ['bright', 'dim', 'dark'].map((b) => document.querySelectorAll(`.dl-notch.${b}`).length),
  light: window.vc.state().delve.light,
  job: document.querySelector('.dl-job-title')?.textContent ?? '',
  where: document.querySelector('.dl-job-where')?.textContent ?? '',
  title: window.vc.state().delve.contract.title,
  carry: document.querySelector('.dl-carry')?.innerText ?? '',
  levels: [...document.querySelectorAll('.dl-lvl')].map((e) => ({ t: e.textContent, off: e.getAttribute('aria-disabled') === 'true', tip: e.dataset.tip ?? '' })),
}));
check('lantern: a stage word and the round', /^(Bright|Dim|Dark|Pitch|Shut)$/.test(strip.stage) && /^R\d+$/.test(strip.round), `${strip.stage} ${strip.round}`);
check('lantern: a notched bar of 20 in its bands (8 bright, 6 dim, 6 dark), lit up to the oil left', strip.notches === 20 && strip.bands.join() === '8,6,6' && strip.lit === Math.min(20, strip.light), `${strip.lit} lit of ${strip.notches}, bands ${strip.bands}`);
check('lantern hover gives the numbers', /of 20 rounds of light/.test(await tip('.dl-lantern')));
check('job: the contract title, where, and "not yet seen"', strip.job === strip.title && /not yet seen/.test(strip.where), `${strip.job} · ${strip.where}`);
check('job hover: bounty and brief', /\d+ gold/.test(await tip('.dl-job')));
check('Carrying: "Nothing yet" on an empty-handed party', /Carrying/i.test(strip.carry) && /Nothing yet/.test(strip.carry), strip.carry.replace(/\n/g, ' '));
check('Carrying hover: the toll is half, hired crews may turn at 150+', /half of it/.test(await tip('.dl-carry')) && /150 or more/.test(await tip('.dl-carry')));
check('level tabs: "Keep", then "?" for levels not found yet ("Not found yet")', strip.levels.length === 3 && strip.levels[0].t === 'Keep' && strip.levels.slice(1).every((l) => l.t === '?' && l.off && /^Not found yet/.test(l.tip)), JSON.stringify(strip.levels.map((l) => l.t)));
// Carry something: the strip says what.
await p.evaluate(() => { const s = structuredClone(window.vc.state()); const h = s.delve.heroes[2]; h.pack.push({ id: 'cg', kind: 'gold', name: 'Gold', amount: 45, slots: 1 }, { id: 'cgm', kind: 'gem', name: 'Garnet', amount: 55, slots: 1 }); window.vc.load(s); });
check('Carrying: "100 · 45 gold, a garnet"', /100\s*·\s*45 gold, a garnet/.test(await text('.dl-carry')), (await text('.dl-carry')).replace(/\n/g, ' '));

// ---- the party rail
const rail = await p.evaluate(() => [...document.querySelectorAll('.dl-rail .dl-rcard')].map((c) => ({
  id: c.dataset.hero,
  minis: [...c.querySelectorAll('.dl-mini')].reduce((n, m) => n + (m.classList.contains('wide') ? 2 : 1), 0),
  full: c.querySelectorAll('.dl-mini.full').length,
  mana: c.querySelectorAll('.dl-mana i').length,
  pips: c.querySelectorAll('.dl-pip').length,
  hp: c.querySelector('.dl-hpn')?.textContent ?? '',
  w: c.getBoundingClientRect().width,
})));
const casters = await p.evaluate(() => { const s = window.vc.state(); return s.delve.heroes.filter((h) => ['pyromancer', 'shadowmancer', 'hedgewitch'].includes(s.campaign.roster.find((r) => r.id === h.heroId).cls)).map((h) => h.heroId); });
check('a card per hero, ~236px wide, two turn pips and HP numbers each', rail.length === 4 && rail.every((c) => c.w >= 220 && c.w <= 250 && c.pips === 2 && /^\d+\/\d+$/.test(c.hp)), JSON.stringify(rail.map((c) => [c.w, c.pips, c.hp])));
check('each card has the pack row: 4 tiny slots; Keven\'s holds the torch and the potion', rail.every((c) => c.minis === 4) && rail[0].full === 2, rail.map((c) => `${c.minis}/${c.full}`).join(' '));
check('mana diamonds on the casters only', rail.filter((c) => c.mana > 0).map((c) => c.id).join() === casters.join(), JSON.stringify(rail.map((c) => c.mana)));

// ---- the hotbar for the selected hero
const keven = rail[0].id;
await p.evaluate((id) => window.vc.hud.select(id), keven);
const bar = await p.evaluate(() => ({
  who: document.querySelector('.dl-who-n')?.textContent ?? '',
  seg: [...document.querySelectorAll('.dl-seg button')].map((e) => `${e.textContent.trim().split(' ')[0]}:${e.getAttribute('aria-checked')}`),
  attack: document.querySelector('.dl-hotbar [data-action="attack"]')?.dataset.tip ?? '',
  slots: [...document.querySelectorAll('.dl-pack-slots .dl-slot')].map((e) => ({ action: e.dataset.action ?? '', usable: e.classList.contains('usable'), empty: e.classList.contains('empty') })),
  more: [...document.querySelectorAll('.dl-more [data-action]')].map((e) => e.dataset.action),
  end: document.querySelectorAll('.dl-end-dots i').length,
  endRight: (() => { const h = document.querySelector('.dl-hotbar').getBoundingClientRect(); const e = document.querySelector('.dl-end').getBoundingClientRect(); return h.right - e.right; })(),
}));
check('hotbar: the selected hero\'s name and Walk/Sneak', /Keven/.test(bar.who) && bar.seg.join() === 'Walk:true,Sneak:false', `${bar.who} ${bar.seg}`);
check('Attack shown dimmed with why when nobody is in reach', /Attack · (nobody in reach|the action is used)/.test(bar.attack), bar.attack.split('\n')[0]);
check('the pack: 4 slots, the torch and the potion usable, 2 empty', bar.slots.length === 4 && bar.slots[0].action === 'torch' && bar.slots[0].usable && bar.slots.filter((x) => x.empty).length === 2, JSON.stringify(bar.slots));
check('End turn at the right of the bar, one dot per hero who can still act (4)', bar.end === 4 && bar.endRight < 20, `${bar.end} dots, ${bar.endRight}px from the edge`);
// Sneak per hero: S sets only the selected hero.
await p.keyboard.press('s');
await p.waitForTimeout(150);
const modes = await p.evaluate(() => window.vc.state().delve.heroes.map((h) => h.moveMode ?? 'walk'));
check('S sets only the selected hero to sneak; its card says "sneak"', modes[0] === 'sneak' && modes.slice(1).every((m) => m === 'walk' || m === 'sneak') && !!(await p.$(`.dl-rcard[data-hero="${keven}"] .dl-si.sneak`)), modes.join());
await p.keyboard.press('s');
await p.waitForTimeout(150);
// More: Give and Drop (stand two heroes together so Give has someone to give to).
await p.evaluate(() => { const s = structuredClone(window.vc.state()); const [a, c] = s.delve.heroes; c.at = { ...a.at, q: a.at.q + 1 }; window.vc.load(s); window.vc.hud.select(a.heroId); });
await p.click('.dl-hotbar [data-more]');
await p.waitForTimeout(100);
const more = await p.evaluate(() => ({ open: !document.querySelector('.dl-more').classList.contains('hidden'), items: [...document.querySelectorAll('.dl-more [data-action]')].map((e) => e.dataset.action) }));
check('More opens a small menu with Give and Drop (and the lantern for its bearer)', more.open && more.items.includes('give') && more.items.includes('drop'), more.items.join(','));
await p.keyboard.press('Escape');
// A pack slot uses its item: the torch lights.
await p.click('.dl-pack-slots .dl-slot[data-action="torch"]');
await idle();
await p.waitForTimeout(150);
check('clicking the torch slot lights it', await p.evaluate((id) => window.vc.state().delve.heroes.find((h) => h.heroId === id).torch > 0, keven));
check('the coach marks go in order: mark 1 still waits for a move after the torch', await p.evaluate(() => document.querySelector('.dl-coach')?.dataset.mark === '1'));

// ---- the Chronicle: folded shows two lines; open shows rounds; remembered
const fold = await p.evaluate(() => ({ open: document.querySelector('.dl-chron').classList.contains('open'), lines: document.querySelectorAll('.dl-chron .dl-chron-line').length, head: document.querySelector('.dl-chron-head')?.innerText ?? '' }));
check('Chronicle folded: "Chronicle · round N" and at most 2 lines', !fold.open && fold.lines <= 2 && fold.lines > 0 && /Chronicle · round \d/i.test(fold.head), JSON.stringify(fold));
await p.click('.dl-chron-head');
const open = await p.evaluate(() => ({ open: document.querySelector('.dl-chron').classList.contains('open'), groups: [...document.querySelectorAll('.dl-chron-group')].map((e) => e.textContent), icons: document.querySelectorAll('.dl-chron-ic svg').length, saved: localStorage.getItem('vc.chronicle.open.v40') }));
check('Chronicle open: grouped by round and phase, an icon per line, remembered', open.open && open.groups.some((g) => /Round \d · your turn/i.test(g)) && open.icons > 0 && open.saved === '1', JSON.stringify(open.groups));

// ---- the Great Hall next to an orc: hover card, sight shading, target card, roll panel
const ax = (c, r) => ({ level: 1, q: c - (r - (r & 1)) / 2, r });
await p.evaluate((spots) => { const s = structuredClone(window.vc.state()); s.delve.heroes.forEach((h, i) => { h.at = spots[i]; h.facing = 1; h.moved = false; h.acted = false; }); window.vc.load(s); window.vc.hud.select(s.delve.heroes[0].heroId); }, [ax(20, 16), ax(21, 16), ax(20, 17), ax(22, 17)]);
await p.waitForTimeout(1500);
const orc = await p.evaluate(() => { const s = window.vc.state(); const vis = window.vcEngine.visibility(s).visible; const o = s.delve.monsters.filter((m) => m.kind === 'orc' && m.awareness !== 'asleep' && vis.has(`${m.at.level}:${m.at.q},${m.at.r}`))[0]; return o ? { id: o.id, at: o.at } : null; });
check('an awake orc in sight in the Great Hall', !!orc);
if (orc) {
  const card = await p.evaluate((o) => {
    window.vc.hud.onHover(o.at, o.id);
    const c = document.querySelector('.dl-card');
    const r = c.getBoundingClientRect();
    const u = window.vc.dio.unitScreen(o.id);
    return { shown: !c.classList.contains('hidden'), lines: c.querySelectorAll('.dl-card-l').length, text: c.innerText, left: r.left, right: r.right, ux: u?.x ?? -1, wash: window.vc.dio.sightFront.count + window.vc.dio.sightSide.count };
  }, orc);
  check('hovering the orc: a card beside it (not over it), three lines', card.shown && card.lines === 3 && (card.left > card.ux + 20 || card.right < card.ux - 20), `${card.lines} lines, card ${Math.round(card.left)}–${Math.round(card.right)}, orc at ${Math.round(card.ux)}`);
  check('...name and mood; what it does or how it looks; where you stand for it', /^Orc/.test(card.text) && /(unaware|searching|hunting)/.test(card.text) && /You're .* away, (walking|sneaking): it (will|won't) see you/.test(card.text), card.text.replace(/\n/g, ' | '));
  check('...and the floor it sees is shaded while hovering', card.wash > 0, `${card.wash} hexes`);
  await p.keyboard.down('Alt');
  await p.waitForTimeout(100);
  const alt = await p.evaluate(() => ({ full: document.querySelector('.dl-card').classList.contains('full'), text: document.querySelector('.dl-card').innerText }));
  await p.keyboard.up('Alt');
  check('Alt: the full rules card (HP, sight in numbers)', alt.full && /HP \d+\/\d+/.test(alt.text) && /lit/.test(alt.text), alt.text.slice(0, 80));
  await p.evaluate(() => window.vc.hud.onHover(null, null));
  check('unhover: no shading', await p.evaluate(() => window.vc.dio.sightFront.count + window.vc.dio.sightSide.count === 0));
  // Bring the orc next to Keven, unaware of him: the target card, then the roll panel.
  await p.evaluate((o) => { const s = structuredClone(window.vc.state()); const k = s.delve.heroes[0]; const m = s.delve.monsters.find((x) => x.id === o.id); m.at = { ...k.at, q: k.at.q + 1 }; m.awareness = 'alert'; m.noticedIds = []; m.hp = 6; window.vc.load(s); window.vc.hud.select(k.heroId); }, orc);
  await p.waitForTimeout(300);
  const tcard = await p.evaluate((id) => { const s = window.vc.state(); const m = s.delve.monsters.find((x) => x.id === id); window.vc.hud.onHover(m.at, id); return document.querySelector('.dl-card').innerText; }, orc.id);
  check('target card on an enemy in reach: "Attack the orc", a headline in words, "Click to line up the roll"', /^Attack the orc/.test(tcard) && /(Kills it|Likely \d+ damage|Likely a miss)/.test(tcard) && /Click to line up the roll/.test(tcard), tcard.replace(/\n/g, ' | '));
  check('...with the sneak-attack chip ("It hasn\'t noticed Keven")', /It hasn't noticed Keven/.test(tcard));
  await p.evaluate((id) => { const s = window.vc.state(); const m = s.delve.monsters.find((x) => x.id === id); window.vc.hud.onClick(m.at, id, { button: 0 }); }, orc.id);
  await p.waitForTimeout(200);
  const roll = await p.evaluate(() => {
    const el = document.querySelector('.dl-roll');
    return { shown: !el.classList.contains('hidden'), dice: [...el.querySelectorAll('.dl-dice .dl-die')].map((d) => d.innerText.replace(/\n/g, ' ')), bar: [...el.querySelectorAll('.dl-ocbar .dl-oc')].map((s) => s.className.split(' ').pop()), kill: el.querySelector('.dl-oc-kill')?.textContent ?? '', dias: el.querySelectorAll('.dl-dia').length, text: el.innerText };
  });
  check('roll panel: a die per try showing its chance ("65%"), a sneak-attack die', roll.shown && roll.dice.length >= 3 && roll.dice.every((d) => /\d+%/.test(d)) && roll.dice.some((d) => /sneak/.test(d)), roll.dice.join(' | '));
  check('...an outcome bar by outcome, the kill chance on the kill segment', roll.bar.includes('dl-oc-kill') && /kills it · \d+%/.test(roll.kill), `${roll.bar.join(',')} ${roll.kill}`);
  check('...Focus diamonds, its help line, the noise in words, Cancel and Strike', roll.dias > 0 && /Each Focus makes one try a sure hit/.test(roll.text) && /(Silent|A little noise|Noisy|Loud)/.test(roll.text) && /Cancel/.test(roll.text) && /Strike/.test(roll.text));
  const k0 = parseInt(roll.kill.match(/(\d+)%/)?.[1] ?? '0', 10);
  await p.click('.dl-dia:not([disabled])');
  await p.waitForTimeout(100);
  const after = await p.evaluate(() => ({ kill: document.querySelector('.dl-oc-kill')?.textContent ?? '', sure: document.querySelectorAll('.dl-die.sure').length, was: document.querySelector('.dl-roll-was')?.textContent ?? '' }));
  const k1 = parseInt(after.kill.match(/(\d+)%/)?.[1] ?? '0', 10);
  check('a Focus diamond makes a die "sure" and raises the kill chance ("Was N% before Focus")', after.sure === 1 && k1 > k0 && new RegExp(`Was ${k0}% before Focus`).test(after.was), `${k0}% → ${k1}%, ${after.was}`);
  await p.click('.dl-roll-det');
  check('Details shows the per-hit table', (await p.$$('.dl-hits span')).length > 6);
  await p.keyboard.press('Escape');
  check('Esc closes the roll panel', !(await shown('.dl-roll')));
}

// ---- the castle's turn: banner and the folded hotbar while it plays
await settings({ speed: 1 });
await p.evaluate(() => { window.__castle = { banner: false, strip: '' }; const tick = () => { const b = document.querySelector('.dl-castle'); const h = document.querySelector('.dl-hotbar'); if (b && !b.classList.contains('hidden')) window.__castle.banner = b.innerText; if (h?.classList.contains('folded')) window.__castle.strip = h.innerText; if (window.vc.busy() || !window.__castle.done) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
await p.evaluate(() => window.vc.send({ type: 'endTurn' }).then(() => (window.__castle.done = true)));
await idle();
await p.waitForTimeout(200);
const castle = await p.evaluate(() => window.__castle);
check('the castle\'s turn: "The castle moves · round N" banner', /The castle moves/.test(castle.banner) && /round \d/.test(castle.banner), castle.banner.replace(/\n/g, ' '));
check('...the hotbar folds to "The castle\'s turn · … · Hold Space to hurry"', /The castle's turn/.test(castle.strip) && /Hold\s+Space\s+to hurry/.test(castle.strip), castle.strip.replace(/\n/g, ' '));
check('...and unfolds after', !(await p.$('.dl-hotbar.folded')) && !(await shown('.dl-castle')));
await settings();
await p.reload();
await p.waitForFunction(() => !!window.vc);
await p.evaluate(() => { localStorage.setItem('vc.settings', JSON.stringify({ speed: 0, reduceShake: true, noEndTurnAsk: true })); });

// After the reload (Continue): the Chronicle is still open; the coach mark still waits.
await p.evaluate(() => { const raw = localStorage.getItem('vc.save.v39'); if (raw) window.vc.load(window.vcEngine.deserialize(raw)); });
await p.waitForTimeout(500);
check('the Chronicle stays open across a reload', await p.evaluate(() => document.querySelector('.dl-chron').classList.contains('open')));

// ---- coach marks: moving clears mark 1 for good
const mv = await p.evaluate(() => { const s = window.vc.state(); const h = s.delve.heroes.find((x) => x.status === 'active'); window.vc.hud.select(h.heroId); const r = window.vcEngine.reachable(s, h.heroId)[0]; return r ? { at: r.to } : null; });
if (mv) {
  await p.evaluate((m) => window.vc.hud.onClick(m.at, null, { button: 0 }), mv);
  await idle();
  await p.waitForTimeout(200);
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('vc.coach.v40') ?? '{}'));
  check('a move clears coach mark 1, saved in vc.coach.v40', (saved.done ?? []).includes(1) && (await p.evaluate(() => document.querySelector('.dl-coach').dataset.mark !== '1' || document.querySelector('.dl-coach').classList.contains('hidden'))), JSON.stringify(saved));
  await p.evaluate(() => { const e = document.querySelector('.dl-coach'); if (!e.classList.contains('hidden')) e.querySelector('.dl-coach-ok').click(); });
  await p.evaluate(() => { const e = document.querySelector('.dl-coach'); if (!e.classList.contains('hidden')) e.querySelector('.dl-coach-ok').click(); });
  await p.reload();
  await p.waitForFunction(() => !!window.vc);
  await p.evaluate(() => { const raw = localStorage.getItem('vc.save.v39'); if (raw) window.vc.load(window.vcEngine.deserialize(raw)); });
  await p.waitForTimeout(400);
  check('dismissed coach marks never come back (after a reload)', !(await shown('.dl-coach')), JSON.stringify(await p.evaluate(() => JSON.parse(localStorage.getItem('vc.coach.v40') ?? '{}'))));
}

// ---- parley tiles
await p.evaluate(() => { const s = structuredClone(window.vc.state()); s.delve.rivals.entersRound = s.delve.round; window.vc.load(s); });
await p.evaluate(() => window.vc.send({ type: 'endTurn' }));
await idle();
const crewAt = await p.evaluate(() => window.vc.state().delve.rivals?.members.find((m) => m.hp > 0 && !m.goneOut)?.at ?? null);
if (crewAt) {
  await p.evaluate((at) => { const s = structuredClone(window.vc.state()); const h = s.delve.heroes.find((x) => x.status === 'active'); h.at = { ...at, q: at.q + 2 }; h.moved = false; h.acted = false; h.pack.push({ id: 'pg', kind: 'gold', name: 'Gold', amount: 45, slots: 1 }); window.vc.load(s); window.vc.hud.select(h.heroId); }, crewAt);
  await p.waitForTimeout(300);
  await p.keyboard.press('b');
  await p.waitForTimeout(200);
  const pl = await p.evaluate(() => { const el = document.querySelector('.dl-parley'); return { shown: !el.classList.contains('hidden'), tiles: [...el.querySelectorAll('.dl-deal')].map((d) => d.dataset.deal), mems: el.querySelectorAll('.dl-pl-mem').length, text: el.innerText }; });
  check('parley: the crew, its members as hexes, "You carry", deals as tiles with prices', pl.shown && pl.mems >= 1 && /You carry/i.test(pl.text) && /They take gold first, then gems\. No change\./.test(pl.text) && pl.tiles.length >= 3, `${pl.tiles.join(',')}`);
  check('...the honest payment line and Walk away / Fight them', /You'd hand over/.test(pl.text) && /Walk away/.test(pl.text) && /Fight them/.test(pl.text));
  await p.keyboard.press('Escape');
  check('Esc walks away', !(await shown('.dl-parley')));
} else check('the Sisters on the map for the parley', false, 'no crew member');

// ---- the return report
await p.evaluate(async () => {
  const E = window.vcEngine;
  const exit = E.castle().entrances[0];
  const s = structuredClone(window.vc.state());
  const h = s.delve.heroes.find((x) => x.status === 'active');
  h.pack.push({ id: 'rg', kind: 'gold', name: 'Gold', amount: 12, slots: 1 });
  s.delve.heroes.forEach((x) => { if (x !== h && x.at.q === exit.q && x.at.r === exit.r && x.at.level === exit.level) x.at = { ...x.at, r: x.at.r - 3 }; });
  h.at = { ...exit };
  h.acted = false;
  window.vc.load(s);
  await window.vc.send({ type: 'act', heroId: h.heroId, action: 'leave', target: { at: exit }, focus: 0 });
  if (window.vc.state().stage === 'delve') await window.vc.send({ type: 'abandon' });
});
await idle();
await p.waitForTimeout(500);
const rep = await p.evaluate(() => ({
  stage: window.vc.state().stage,
  boxes: [...document.querySelectorAll('.dl-return .dl-rt-box')].map((e) => e.getAttribute('aria-label')),
  h1: document.querySelector('.dl-rt-h1')?.textContent ?? '',
  line: document.querySelector('.dl-rt-line')?.textContent ?? '',
  gold: document.querySelector('.dl-return .lg-gold')?.innerText ?? '',
  heroes: document.querySelectorAll('.dl-rt-hero').length,
  carried: document.querySelector('[aria-label="Carried out"]')?.innerText ?? '',
  castle: document.querySelector('[aria-label="The castle remembers"]')?.innerText ?? '',
  go: document.querySelector('.dl-rt-go')?.innerText ?? '',
}));
check('the return report replaces the summary: three boxes', rep.stage === 'summary' && rep.boxes.join('|') === 'Carried out|The party|The castle remembers', rep.boxes.join('|'));
check('...a headline and a line with the rounds and the lantern', rep.h1.length > 5 && /round/.test(rep.line), `${rep.h1} / ${rep.line}`);
check('...the strongbox with what this delve adds ("+N"), the loose gold carried out', /\+\d+/.test(rep.gold) && /Loose gold\s*\+\d+/.test(rep.carried), rep.gold.replace(/\n/g, ' '));
check('...every hero of the party, the rooms mapped', rep.heroes === 4 && /You mapped/.test(rep.castle), `${rep.heroes} heroes; ${rep.castle.split('\n')[1]}`);
check('..."Back to Lowgate →" or "Continue"', /Back to Lowgate|Continue/.test(rep.go), rep.go);
await p.click('.dl-rt-go');
await p.waitForTimeout(400);
check('Back to Lowgate goes to camp', (await p.evaluate(() => window.vc.state().stage)) !== 'summary');

console.log(`\n${failed ? `${failed} FAILED` : 'all passed'}, ${errors} page errors`);
await b.close();
process.exit(failed || errors ? 1 : 0);
