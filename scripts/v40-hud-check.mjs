// V4.0 in-delve HUD check (the board is the screen), headless, by DOM and state, real engine only; no screenshots.
// Covers: the top strip (V4.1: the light readout, the job, Carrying, "?" level tabs), the party rail (a card per
// hero with its pack row; mana diamonds on casters), the hotbar for the selected hero (Walk/Sneak per hero, pack slots
// that use their item, More with Give and Drop, End turn with a dot per hero who can still act), the hover card beside
// the hovered figure, the monster sight shading on hover, the target card and the roll panel (a % on each die, an
// outcome bar, Focus diamonds raising the kill chance), the castle's turn (banner, folded hotbar), the Chronicle
// folding and opening (remembered), the parley tiles, the return report's boxes, and the first-delve coach marks
// (shown once, gone for good once done). V4.1 (spec 31.13): reactions: the Reactions button and popover, the castle's
// turn stopping at an overwatch question (the card, the save holding it, the card again after a reload, key 1 answering
// and the turn playing on), and a hero set to Always never stopping it. V4.1 poison (spec 31.4): the drop on a card, the antipoison from the pack; a downed ally's
// bleed count, Carry (the body on the carrier's hex). V4.0 spec 30.3/30.4: the hovered (or Tab-chosen) target marked apart from the other options, a
// pill entry marking its figure, a jump's landing; a Sapper with no charges and nobody in reach shows no unusable buttons;
// the hotbar never scrolls at 1280, 1440 and 2560 wide (SHOTS=<dir> saves screenshots). No page errors.
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
// V4.1 (spec 31.13): a reaction card that comes up in a castle's turn the check isn't about is answered (the first
// option) so the turn plays on; the reactions section sets window.__keepReact to look at the card itself.
const idle = () => p.waitForFunction(() => {
  const r = document.querySelector('.dl-react');
  if (r && !r.classList.contains('hidden') && !window.__keepReact) r.querySelector('[data-choice="yes"]')?.click();
  return window.vc && !window.vc.busy();
}, null, { timeout: 120000 });
const tip = (sel) => p.$eval(sel, (e) => e.dataset.tip ?? e.getAttribute('title') ?? '').catch(() => '');
const text = (sel) => p.$eval(sel, (e) => e.innerText).catch(() => '');
const shown = (sel) => p.$eval(sel, (e) => !e.classList.contains('hidden') && getComputedStyle(e).display !== 'none').catch(() => false);
const settings = (extra = {}) => p.evaluate((x) => localStorage.setItem('vc.settings', JSON.stringify({ speed: 0, reduceShake: true, noEndTurnAsk: true, ...x })), extra);

// Generous timeouts: the 3D view renders in software here; a busy machine makes a reload slow, not wrong.
p.setDefaultNavigationTimeout(180000);
p.setDefaultTimeout(180000);
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
    s.campaign.squadSlots = 4; // V4.1 (spec 31.12): a new campaign takes 3; this check plays a full four
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
  chips: document.querySelectorAll('.dl-lchip:not(.none)').length,
  none: document.querySelector('.dl-lchip.none')?.textContent ?? '',
  job: document.querySelector('.dl-job-title')?.textContent ?? '',
  where: document.querySelector('.dl-job-where')?.textContent ?? '',
  title: window.vc.state().delve.contract.title,
  carry: document.querySelector('.dl-carry')?.innerText ?? '',
  levels: [...document.querySelectorAll('.dl-lvl')].map((e) => ({ t: e.textContent, off: e.getAttribute('aria-disabled') === 'true', tip: e.dataset.tip ?? '' })),
}));
check('V4.1 light readout: "Light" and the round', strip.stage === 'Light' && /^R\d+$/.test(strip.round), `${strip.stage} ${strip.round}`);
check('V4.1 light readout: no free lantern, nothing lit yet (the torch is packed)', strip.chips === 0 && /Light a torch/.test(strip.none), `${strip.chips} chips, "${strip.none}"`);
check('light hover gives the numbers', /sight 8 \/ 7 \/ 6/.test(await tip('.dl-lantern')) && /15 rounds/.test(await tip('.dl-lantern')));
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
  seg: (() => { const sw = document.querySelector('.dl-switch'); return sw ? `${sw.dataset.moveSwitch}:${sw.getAttribute('aria-checked')}` : ''; })(), // V5.0 (spec 32.8): a sliding switch
  attack: document.querySelector('.dl-hotbar [data-action="attack"]')?.dataset.tip ?? '',
  slots: [...document.querySelectorAll('.dl-pack-slots .dl-slot')].map((e) => ({ action: e.dataset.action ?? '', usable: e.classList.contains('usable'), empty: e.classList.contains('empty') })),
  more: [...document.querySelectorAll('.dl-more [data-action]')].map((e) => e.dataset.action),
  end: document.querySelectorAll('.dl-end-dots i').length,
  endRight: (() => { const h = document.querySelector('.dl-hotbar').getBoundingClientRect(); const e = document.querySelector('.dl-end').getBoundingClientRect(); return h.right - e.right; })(),
}));
check('hotbar: the selected hero\'s name and the Walk / Sneak switch (off = walk)', /Keven/.test(bar.who) && bar.seg === 'walk:false', `${bar.who} ${bar.seg}`);
check('no Attack button when nobody is in reach (V4.0 spec 30.4: only what the hero can do)', bar.attack === '', bar.attack.split('\n')[0]);
check('the pack: 4 slots, the torch and the potion usable, 2 empty', bar.slots.length === 4 && bar.slots[0].action === 'torch' && bar.slots[0].usable && bar.slots.filter((x) => x.empty).length === 2, JSON.stringify(bar.slots));
check('End turn at the right of the bar, one dot per hero who can still act (4)', bar.end === 4 && bar.endRight < 20, `${bar.end} dots, ${bar.endRight}px from the edge`);
// Sneak per hero: a tap of Shift flips only the selected hero (V5.0, spec 32.8); S pans the camera and sets nothing.
await p.keyboard.press('s');
await p.waitForTimeout(150);
check('S no longer touches sneaking', (await p.evaluate(() => window.vc.state().delve.heroes[0].moveMode ?? 'walk')) === 'walk');
await p.keyboard.press('Shift');
await p.waitForTimeout(150);
const modes = await p.evaluate(() => window.vc.state().delve.heroes.map((h) => h.moveMode ?? 'walk'));
check('a tap of Shift sets only the selected hero to sneak; the switch slides on; its card says "sneak"', modes[0] === 'sneak' && modes.slice(1).every((m) => m === 'walk' || m === 'sneak') && (await p.$eval('.dl-switch', (e) => e.getAttribute('aria-checked'))) === 'true' && !!(await p.$(`.dl-rcard[data-hero="${keven}"] .dl-si.sneak`)), modes.join());
await p.keyboard.down('Shift');
await p.keyboard.press('Tab');
await p.keyboard.up('Shift');
await p.waitForTimeout(150);
check('Shift held for Shift+Tab does not flip the switch', (await p.evaluate(() => window.vc.state().delve.heroes[0].moveMode)) === 'sneak');
await p.evaluate((id) => window.vc.hud.select(id), keven);
await p.keyboard.press('Shift');
await p.waitForTimeout(150);
check('the key help: ? opens a card with the camera, turn and action keys; Esc closes it', await (async () => { await p.keyboard.press('?'); await p.waitForTimeout(80); const open = await p.$eval('.dl-keys', (e) => !e.classList.contains('hidden') && /W\s*A\s*S\s*D/.test(e.innerText.replace(/\n/g, ' ')) && /Shift/.test(e.innerText)); await p.keyboard.press('Escape'); await p.waitForTimeout(80); return open && (await p.$eval('.dl-keys', (e) => e.classList.contains('hidden'))); })());
// More: Give and Drop (stand two heroes together so Give has someone to give to).
await p.evaluate(() => { const s = structuredClone(window.vc.state()); const [a, c] = s.delve.heroes; c.at = { ...a.at, q: a.at.q + 1 }; window.vc.load(s); window.vc.hud.select(a.heroId); });
await p.click('.dl-hotbar [data-more]');
await p.waitForTimeout(100);
const more = await p.evaluate(() => ({ open: !document.querySelector('.dl-more').classList.contains('hidden'), items: [...document.querySelectorAll('.dl-more [data-action]')].map((e) => e.dataset.action) }));
check('More opens a small menu with Give and Drop (and the lantern for whoever packs one)', more.open && more.items.includes('give') && more.items.includes('drop'), more.items.join(','));
await p.keyboard.press('Escape');
// A pack slot uses its item: the torch lights.
await p.click('.dl-pack-slots .dl-slot[data-action="torch"]');
await idle();
await p.waitForTimeout(150);
check('clicking the torch slot lights it (V4.1: the torch item burns)', await p.evaluate((id) => window.vc.state().delve.heroes.find((h) => h.heroId === id).pack.some((i) => i.kind === 'torch' && i.lit), keven));
check('...and the light readout shows it: who carries it, 15 rounds', await p.evaluate(() => [...document.querySelectorAll('.dl-lchip.torch')].some((e) => /Keven/.test(e.textContent) && /15/.test(e.textContent))));
check('...and the bar offers Snuff', !!(await p.$('.dl-hotbar [data-action="snuff"]')));
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
  check('a Focus diamond makes a die "sure" and raises the kill chance (the kill segment says "was N%")', after.sure === 1 && k1 > k0 && new RegExp(`was ${k0}%`).test(after.was), `${k0}% → ${k1}%, ${after.was}`);
  // V5.0 (P, B4): a thicker bar, nothing under it, the numbers on hover.
  const barLook = await p.evaluate(() => { const b = document.querySelector('.dl-ocbar'); const segs = [...b.querySelectorAll('.dl-oc')]; return { h: b.getBoundingClientRect().height, line: !!document.querySelector('.dl-roll-ocline'), tips: segs.every((s) => /\d+%/.test(s.dataset.tip ?? '')), barTip: b.dataset.tip ?? '' }; });
  check('the outcome bar is thick (≥ 32px), has no line under it, and every segment\'s hover carries its number', barLook.h >= 32 && !barLook.line && barLook.tips && /(Kills it|Likely)/.test(barLook.barTip), JSON.stringify(barLook));
  if (process.env.SHOTS) { const bb = await p.$eval('.dl-roll', (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }); await p.screenshot({ path: `${process.env.SHOTS}/roll-panel.png`, clip: bb, timeout: 180000 }); }
  await p.click('.dl-roll-det');
  check('Details shows the per-hit table', (await p.$$('.dl-hits span')).length > 6);
  await p.keyboard.press('Escape');
  check('Esc closes the roll panel', !(await shown('.dl-roll')));
}

// ---- V4.1 poison (spec 31.4): the drop on a card, an antipoison from the pack clears it; a downed ally's bleed count, Carry
const SHOTS = process.env.SHOTS ?? '';
{
  const ids = await p.evaluate((spots) => {
    const s = structuredClone(window.vc.state());
    s.delve.monsters = s.delve.monsters.filter((m) => !(m.at.level === 1 && Math.abs(m.at.r - 16) <= 3 && Math.abs(m.at.q - 12) <= 6));
    const [k, f] = s.delve.heroes;
    k.at = spots[0]; f.at = spots[1];
    for (const h of s.delve.heroes) { h.moved = false; h.acted = false; h.poisoned = undefined; h.carrying = undefined; }
    f.poisoned = true;
    k.pack = k.pack.filter((i) => i.kind !== 'gold' && i.kind !== 'gem').slice(0, 2);
    k.pack.push({ id: 'va1', kind: 'antidote', name: 'Antipoison', amount: 1, slots: 1 });
    window.vc.load(s);
    window.vc.hud.select(k.heroId);
    return { k: k.heroId, f: f.heroId };
  }, [ax(20, 16), ax(20, 17)]);
  await p.waitForTimeout(300);
  const vcard = await p.evaluate((id) => { const e = document.querySelector(`.dl-rcard[data-hero="${id}"] .dl-si.venom`); return e ? { tip: e.dataset.tip ?? '', label: e.getAttribute('aria-label') ?? '' } : null; }, ids.f);
  check('poison: a green drop on the card ("Poisoned"), hover "Poisoned: −1 a turn, never below 1. Antipoison, Mend, or get out."', !!vcard && vcard.label === 'Poisoned' && /^Poisoned: −1 a turn, never below 1\. Antipoison, Mend, or get out\./.test(vcard.tip), JSON.stringify(vcard));
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/poison-card.png`, clip: { x: 0, y: 80, width: 300, height: 320 }, timeout: 180000 });
  const slot = await p.evaluate(() => { const e = document.querySelector('.dl-pack-slots .dl-slot[data-action="antidote"]'); return e ? { usable: e.classList.contains('usable'), tip: e.dataset.tip ?? '' } : null; });
  check('the antipoison sits in the pack, usable ("Cures poison")', !!slot && slot.usable && /Antipoison/.test(slot.tip) && /[Cc]ures poison/.test(slot.tip), slot?.tip.split('\n')[0]);
  await p.click('.dl-pack-slots .dl-slot[data-action="antidote"]');
  await p.waitForTimeout(200);
  if (await shown('.dl-roll')) await p.click('.dl-roll-go').catch(() => {});
  await idle();
  await p.waitForTimeout(200);
  const cured = await p.evaluate((id) => { const s = window.vc.state(); const f = s.delve.heroes.find((h) => h.heroId === id); return { poisoned: !!f.poisoned, drop: !!document.querySelector(`.dl-rcard[data-hero="${id}"] .dl-si.venom`), left: s.delve.heroes[0].pack.some((i) => i.kind === 'antidote') }; }, ids.f);
  check('using the antipoison on the ally next to you cures them (and the drop goes)', !cured.poisoned && !cured.drop && !cured.left, JSON.stringify(cured));
  // Downed: the card shows the bleed-out count and what saves them; Carry glows on the hotbar of the hero next to them.
  await p.evaluate((x) => { const s = structuredClone(window.vc.state()); const f = s.delve.heroes.find((h) => h.heroId === x.f); Object.assign(f, { status: 'downed', hp: 0, bleed: 3 }); const k = s.delve.heroes.find((h) => h.heroId === x.k); k.acted = false; window.vc.load(s); window.vc.hud.select(x.k); }, ids);
  await p.waitForTimeout(300);
  const down = await p.evaluate((x) => ({ tag: document.querySelector(`.dl-rcard[data-hero="${x.f}"] .dl-fate`)?.textContent ?? '', line: document.querySelector(`.dl-rcard[data-hero="${x.f}"] .dl-rcard-fate`)?.textContent ?? '', btn: (() => { const e = document.querySelector('.dl-hotbar .dl-ab[data-action="carry"]'); return e ? { glow: e.classList.contains('glow'), tip: e.dataset.tip ?? '' } : null; })(), revive: !!document.querySelector('.dl-hotbar .dl-ab[data-action="revive"]') }), ids);
  check('downed: the card shows the bleed-out count ("Down · 3", "Dies in 3 turns. A potion ...")', /Down · 3/.test(down.tag) && /^Dies in 3 turns\. A potion/.test(down.line), JSON.stringify(down));
  check('...Carry glows on the hotbar of the hero next to them, and there is no Revive', !!down.btn && down.btn.glow && /^Carry/.test(down.btn.tip) && !down.revive, JSON.stringify(down.btn));
  await p.click('.dl-hotbar .dl-ab[data-action="carry"]');
  await idle();
  await p.waitForTimeout(200);
  const carry = await p.evaluate((x) => { const s = window.vc.state(); const k = s.delve.heroes.find((h) => h.heroId === x.k); const f = s.delve.heroes.find((h) => h.heroId === x.f); return { carrying: k.carrying ?? '', same: k.at.q === f.at.q && k.at.r === f.at.r, setDown: !!document.querySelector('.dl-hotbar .dl-ab[data-action="setDown"]'), icon: !!document.querySelector(`.dl-rcard[data-hero="${x.k}"] .dl-si.carry`), line: document.querySelector(`.dl-rcard[data-hero="${x.f}"] .dl-rcard-fate`)?.textContent ?? '', lifted: (window.vc.dio.units?.get?.(x.f)?.offset?.y ?? 0) > 0.5 }; }, ids);
  check('Carry: the body shares the carrier\'s hex, drawn on its shoulders; Set down is offered; the cards say so', carry.carrying === ids.f && carry.same && carry.setDown && carry.icon && /shoulders: not bleeding/.test(carry.line) && carry.lifted, JSON.stringify(carry));
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/carry-full.png`, timeout: 180000 });
  await p.evaluate(() => { const s = structuredClone(window.vc.state()); for (const h of s.delve.heroes) { h.poisoned = undefined; h.carrying = undefined; if (h.status === 'downed') Object.assign(h, { status: 'active', hp: 5, bleed: 0 }); } window.vc.load(s); });
}

// ---- V4.0 play-test fixes 2 (spec 30.3, 30.4): "this one" marked among several targets; the hotbar shows only what a hero can do
{
  // Screenshots point the real mouse at the target (so the board's own hover runs), with the first-delve coach mark set aside.
  const shot = async (path, at, id = null) => {
    if (!SHOTS) return;
    if (at) {
      const sp = await p.evaluate((x) => window.vc.dio.screenOf(x, 0.05), at);
      await p.mouse.move(sp.x, sp.y);
      await p.waitForTimeout(250);
      // The real hover has to land on the option; if the figure's raycast says otherwise, point the HUD at it directly.
      if (id) await p.evaluate((x) => { if (window.vc.dio.picked.unit !== x.id) window.vc.hud.onHover(x.at, x.id); }, { at, id });
      else await p.evaluate((x) => { const k = window.vc.dio.picked.at; if (!k || k.q !== x.q || k.r !== x.r) window.vc.hud.onHover(x, null); }, at);
      await p.waitForTimeout(150);
    }
    await p.evaluate(() => { const c = document.querySelector('.dl-coach'); if (c) c.style.visibility = 'hidden'; });
    await p.screenshot({ path: `${SHOTS}/${path}`, timeout: 180000 });
    await p.evaluate(() => { const c = document.querySelector('.dl-coach'); if (c) c.style.visibility = ''; });
  };
  // Keven and a second hero in the Great Hall, two awake orcs next to Keven, nothing else near. (The state is put back after.)
  await p.evaluate(() => { window.__pre30 = structuredClone(window.vc.state()); });
  const spots = await p.evaluate((x) => {
    const s = structuredClone(window.vc.state());
    const [k, f] = s.delve.heroes;
    k.at = x.k; f.at = x.f;
    for (const h of s.delve.heroes) { h.moved = false; h.acted = false; h.venom = undefined; h.paralyzed = undefined; h.carrying = undefined; }
    const near = (m) => m.at.level === 1 && Math.abs(m.at.r - x.k.r) <= 6 && Math.abs(m.at.q - x.k.q) <= 8;
    s.delve.monsters = s.delve.monsters.filter((m) => !near(m));
    const orcs = [{ ...x.k, q: x.k.q + 1 }, { ...x.k, q: x.k.q - 1, r: x.k.r + 1 }].map((at, i) => ({ id: `t-orc${i}`, kind: 'orc', name: 'Orc', at, hp: 6, maxHp: 6, awareness: 'hunting', spawnedAt: at, noticedIds: [k.heroId], facing: 3 }));
    s.delve.monsters.push(...orcs);
    window.vc.load(s);
    window.vc.hud.select(k.heroId);
    return { k: k.heroId, f: f.heroId, orcs: orcs.map((o) => ({ id: o.id, at: o.at })) };
  }, { k: ax(16, 14), f: ax(14, 12) });
  await p.waitForTimeout(400);
  // V5.0 (spec 32.8): Space is Attack; with the pick open, Tab marks and Space takes the mark.
  check('the Attack button shows Space as its key', (await p.$eval('.dl-hotbar [data-action="attack"] .dl-kb', (e) => e.textContent)) === 'Space');
  await p.keyboard.press(' ');
  await p.waitForTimeout(120);
  check('Space arms the attack pick', await p.evaluate(() => !!window.vc.hud.pending && window.vc.hud.pending.action === 'attack'));
  await p.keyboard.press('Tab');
  await p.keyboard.press(' ');
  await p.waitForTimeout(200);
  check('...Tab marks a target and Space takes it (the roll panel opens)', await shown('.dl-roll'));
  await p.keyboard.press('Escape');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(100);
  await p.click('.dl-hotbar [data-action="attack"]');
  await p.waitForTimeout(150);
  const armed = await p.evaluate(() => ({ pill: !document.querySelector('.dl-pill').classList.contains('hidden'), keys: document.querySelector('.dl-pill-keys')?.innerText ?? '' }));
  check('Attack with two orcs in reach arms a pick ("Tab: next of 2 · Enter: take it")', armed.pill && /Tab: next of 2/.test(armed.keys), armed.keys);
  const pickOf = () => p.evaluate(() => ({ pk: window.vc.dio.picked, tags: [...document.querySelectorAll('.unit-tag.tag-picked')].map((e) => e.dataset.id), dim: window.vc.dio.pickDim, pill: document.querySelector('.dl-pill-hot')?.textContent ?? '' }));
  await p.evaluate(() => window.vc.hud.onHover(null, null));
  check('nothing marked before pointing at one; the options at full strength', await p.evaluate(() => !window.vc.dio.picked.at && !window.vc.dio.pickDim));
  await p.evaluate((o) => window.vc.hud.onHover(o.at, o.id), spots.orcs[0]);
  let pk = await pickOf();
  check('hovering one orc marks it: the bright ring on its hex, its tag lit, the other option dimmed', pk.pk.unit === spots.orcs[0].id && pk.pk.at && pk.pk.at.q === spots.orcs[0].at.q && pk.tags.join() === spots.orcs[0].id && pk.dim === true, JSON.stringify(pk));
  check('...and the pill says what Enter takes ("Orc")', /Orc/.test(pk.pill), pk.pill);
  await shot('pick-attack-1440.png', spots.orcs[0].at, spots.orcs[0].id);
  await p.evaluate((o) => window.vc.hud.onHover(o.at, o.id), spots.orcs[0]);
  await p.evaluate((o) => window.vc.hud.onHover(o.at, o.id), spots.orcs[1]);
  pk = await pickOf();
  check('...pointing at the other moves the mark (one at a time)', pk.pk.unit === spots.orcs[1].id && pk.tags.join() === spots.orcs[1].id, JSON.stringify(pk));
  await p.evaluate(() => window.vc.hud.onHover(null, null));
  await p.keyboard.press('Tab');
  const k1 = (await pickOf()).pk.unit;
  await p.keyboard.press('Tab');
  const k2 = (await pickOf()).pk.unit;
  check('Tab steps through the options with the same mark', !!k1 && !!k2 && k1 !== k2 && spots.orcs.some((o) => o.id === k1) && spots.orcs.some((o) => o.id === k2), `${k1} → ${k2}`);
  // The pill's list: hovering an entry marks it on the board.
  const listed = await p.$$('.dl-pill-opt[data-pick]');
  if (listed.length) {
    await listed[0].evaluate((e) => e.dispatchEvent(new MouseEvent('mouseenter'))); // (the first-delve coach mark may sit over the pill)
    await p.waitForTimeout(80);
    const lp = await pickOf();
    check('hovering a pill entry marks its figure on the board', !!lp.pk.unit && (await listed[0].evaluate((e) => e.classList.contains('hot'))), JSON.stringify(lp.pk));
  } else check('the pill lists the two orcs', false);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(200);
  check('Enter takes the marked one (the roll panel opens)', await shown('.dl-roll'));
  // V5.0 (P, B3): E confirms the roll panel (and never ends the turn underneath it); the button says Enter and E.
  check('the roll panel\'s Go button shows Enter and E', /Enter\s*E/.test(await p.$eval('.dl-roll .dl-go', (e) => e.innerText.replace(/\s+/g, ' '))));
  const r0 = await p.evaluate(() => window.vc.state().delve.round);
  const hero0 = await p.evaluate(() => window.vc.hud.selectedId);
  await p.keyboard.press('e');
  await idle();
  const afterE = await p.evaluate((id) => ({ round: window.vc.state().delve.round, phase: window.vc.state().delve.phase, acted: window.vc.state().delve.heroes.find((h) => h.heroId === id)?.acted, roll: !!document.querySelector('.dl-roll') && !document.querySelector('.dl-roll').classList.contains('hidden') }), hero0);
  check('E confirms the roll (the hero acted, the panel closed) and the turn did not end', afterE.acted === true && !afterE.roll && afterE.round === r0 && afterE.phase === 'player', JSON.stringify(afterE));
  // E on a confirmation window confirms it too: the idle check before ending a turn.
  await p.evaluate(() => { window.vc.settings.noEndTurnAsk = false; const s = structuredClone(window.vc.state()); for (const h of s.delve.heroes) { h.moved = false; h.acted = false; } window.vc.load(s); });
  await p.waitForTimeout(150);
  await p.keyboard.press('e');
  await p.waitForTimeout(150);
  const modal = await p.evaluate(() => ({ open: !document.querySelector('.dl-modal')?.classList.contains('hidden'), text: document.querySelector('.dl-modal-box')?.innerText ?? '' }));
  check('E while heroes can still act raises the "can still" question, with Enter and E on its button', modal.open && /can still (move|dash|Attack)/.test(modal.text) && /Enter\s*E/.test(modal.text.replace(/\s+/g, ' ')), JSON.stringify(modal));
  const r1 = await p.evaluate(() => window.vc.state().delve.round);
  await p.keyboard.press('e');
  await idle();
  check('...and a second E confirms it: the turn ends', (await p.evaluate(() => window.vc.state().delve.round)) === r1 + 1);
  await p.evaluate(() => { window.vc.settings.noEndTurnAsk = true; });
  await p.evaluate(() => window.vc.hud.onHover(null, null));
  await p.keyboard.press('Escape');
  await p.keyboard.press('Escape');
  check('Esc clears the mark', await p.evaluate(() => !window.vc.dio.picked.at && document.querySelectorAll('.unit-tag.tag-picked').length === 0));

  // A jump with several drops in reach: the hovered one is marked and its landing told.
  const findJump = (hid) => p.evaluate((id) => {
    const s0 = window.vc.state();
    const lv = window.vcEngine.castle().levels.find((l) => l.level === 1);
    for (const key of Object.keys(lv.tiles)) {
      const t = lv.tiles[key];
      if (t.kind !== 'floor') continue;
      const [q, r] = key.split(',').map(Number);
      const s = structuredClone(s0);
      const h = s.delve.heroes.find((x) => x.heroId === id);
      if (s.delve.heroes.some((x) => x !== h && x.at.level === 1 && x.at.q === q && x.at.r === r)) continue;
      h.at = { level: 1, q, r };
      const o = window.vcEngine.actions(s, id).find((a) => a.action === 'jump');
      if (o && o.targets.length >= 2) { window.vc.load(s); window.vc.hud.select(id); return o.targets.map((t) => t.at); }
    }
    return null;
  }, hid);
  const jump = await findJump(spots.k);
  check('a hex with two or more drops to jump into', !!jump, `${jump?.length ?? 0}`);
  if (jump) {
    await p.waitForTimeout(400);
    await p.evaluate((at) => window.vc.dio.lookAt(at), jump[0]);
    await p.click('.dl-hotbar [data-action="jump"]');
    await p.waitForTimeout(150);
    await p.evaluate((at) => window.vc.hud.onHover(at, null), jump[1]);
    await p.waitForTimeout(80);
    const jp = await p.evaluate(() => ({ pk: window.vc.dio.picked, landing: (() => { const e = document.querySelector('.landing-tag'); return e && !e.classList.contains('hidden') ? e.textContent : ''; })() }));
    check('Jump: hovering one drop marks it and tells where it lands', !!jp.pk.at && jp.pk.at.q === jump[1].q && jp.pk.at.r === jump[1].r && /(Lands|Falls)/.test(jp.landing), JSON.stringify(jp));
    await shot('pick-jump-1440.png', jump[1]);
    await p.keyboard.press('Escape');
  }

  // The hotbar: a Sapper with no charges and nobody in reach shows no button it can't use, and never scrolls.
  const sap = await p.evaluate((x) => {
    const s = structuredClone(window.vc.state());
    const f = s.delve.heroes.find((h) => h.heroId === x.f);
    const def = s.campaign.roster.find((r) => r.id === x.f);
    def.cls = 'sapper';
    f.at = x.at; f.moved = false; f.acted = false;
    f.pack = f.pack.filter((i) => i.kind !== 'charge' && i.kind !== 'improvised-charge');
    s.delve.monsters = s.delve.monsters.filter((m) => !m.id.startsWith('t-orc'));
    window.vc.load(s);
    window.vc.hud.select(x.f);
    const o = window.vcEngine.actions(window.vc.state(), x.f).map((a) => a.action);
    return o;
  }, { f: spots.f, at: ax(12, 18) });
  await p.waitForTimeout(300);
  const hb = await p.evaluate(() => {
    const bar = document.querySelector('.dl-hotbar');
    const acts = [...bar.querySelectorAll('.dl-acts .dl-ab')].map((e) => ({ a: e.dataset.action, off: e.classList.contains('off') || e.classList.contains('blocked') || e.getAttribute('aria-disabled') === 'true' }));
    return { acts, none: bar.querySelector('.dl-acts-none')?.textContent ?? '', over: bar.scrollWidth - bar.clientWidth, actsOver: (() => { const a = bar.querySelector('.dl-acts'); return a.scrollWidth - a.clientWidth; })(), overflowX: getComputedStyle(bar.querySelector('.dl-acts')).overflowX, who: bar.querySelector('.dl-who-n')?.dataset.tip ?? '' };
  });
  check('a Sapper with no charges and nobody in reach: no Attack, no Set or Throw charge, nothing dimmed', !hb.acts.some((x) => x.off) && !hb.acts.some((x) => ['attack', 'setCharge', 'throwCharge', 'brace'].includes(x.a)), JSON.stringify(hb.acts) + ' engine: ' + sap.join(','));
  check('...with nothing to do, the bar says so ("Nothing to do here. Move, or End turn.")', hb.acts.length > 0 || /Nothing to do here\. Move, or End turn\./.test(hb.none), hb.none || JSON.stringify(hb.acts));
  check('...hovering the name lists what they can do elsewhere', /can: Attack, Shove, .*Set charge.*Dig/.test(hb.who), hb.who.split('\n')[0]);
  check('...and the bar does not scroll (1440)', hb.over <= 1 && hb.actsOver <= 1 && hb.overflowX !== 'auto' && hb.overflowX !== 'scroll', `${hb.over}/${hb.actsOver} ${hb.overflowX}`);
  if (SHOTS) {
    await p.mouse.move(700, 300);
    await shot('hotbar-sapper-1440.png');
    await p.screenshot({ path: `${SHOTS}/hotbar-sapper-1440-bar.png`, clip: { x: 0, y: 900 - 150, width: 1440, height: 150 }, timeout: 180000 });
  }
  // Keven with many options (two orcs, a potion, a torch) still fits at 1280 and 2560 wide.
  await p.evaluate((x) => { const s = structuredClone(window.vc.state()); const k = s.delve.heroes.find((h) => h.heroId === x.k); k.acted = false; k.moved = false; const orcs = [{ ...k.at, q: k.at.q + 1 }, { ...k.at, q: k.at.q - 1, r: k.at.r + 1 }].map((at, i) => ({ id: `t-orc${i}`, kind: 'orc', name: 'Orc', at, hp: 6, maxHp: 6, awareness: 'hunting', spawnedAt: at, noticedIds: [k.heroId], facing: 3 })); s.delve.monsters.push(...orcs); window.vc.load(s); window.vc.hud.select(x.k); }, spots);
  for (const [w, hgt] of [[1280, 800], [2560, 1440], [1440, 900]]) {
    await p.setViewportSize({ width: w, height: hgt });
    await p.waitForTimeout(400);
    for (const id of [spots.k, spots.f]) {
      await p.evaluate((i) => window.vc.hud.select(i), id);
      await p.waitForTimeout(150);
      const f = await p.evaluate(() => { const bar = document.querySelector('.dl-hotbar'); const r = bar.getBoundingClientRect(); const a = bar.querySelector('.dl-acts'); return { over: bar.scrollWidth - bar.clientWidth, actsOver: a.scrollWidth - a.clientWidth, left: r.left, right: r.right, page: document.documentElement.scrollWidth - innerWidth, n: bar.querySelectorAll('.dl-acts .dl-ab').length, mode: bar.className }; });
      check(`hotbar at ${w}×${hgt} (${id}): no scrolling, inside the window`, f.over <= 1 && f.actsOver <= 1 && f.left >= 0 && f.right <= w && f.page <= 0, JSON.stringify(f));
      if (SHOTS && w === 2560 && id === spots.f) {
        await p.mouse.move(1300, 400);
        await shot('hotbar-sapper-2560.png');
      }
    }
    if (SHOTS && w === 2560) {
      await p.evaluate((i) => window.vc.hud.select(i), spots.k);
      await p.waitForTimeout(150);
      await p.click('.dl-hotbar [data-action="attack"]');
      await p.waitForTimeout(100);
      await shot('pick-attack-2560.png', await p.evaluate(() => window.vc.state().delve.monsters.find((m) => m.id === 't-orc0').at), 't-orc0');
      await p.keyboard.press('Escape');
      const back = await p.evaluate(() => structuredClone(window.vc.state()));
      const j2 = await findJump(spots.k);
      if (j2) {
        await p.waitForTimeout(300);
        await p.evaluate((at) => window.vc.dio.lookAt(at), j2[0]);
        await p.waitForTimeout(300);
        await p.click('.dl-hotbar [data-action="jump"]');
        await p.waitForTimeout(150);
        await shot('pick-jump-2560.png', j2[1]);
        await p.keyboard.press('Escape');
      }
      await p.evaluate((s) => window.vc.load(s), back);
    }
  }
  await p.evaluate(() => { window.vc.load(window.__pre30); window.vc.hud.select(window.__pre30.delve.heroes[0].heroId); });
  await p.waitForTimeout(300);
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

// ---- V4.1 (spec 31.13): reactions. The castle's turn stops at a question, shows the card, and plays on after the answer.
{
  // A hero on overwatch (any class: the shot uses their weapon) and an orc hunting them a few hexes off in sight.
  const scene = await p.evaluate(() => {
    const E = window.vcEngine;
    const base = structuredClone(window.vc.state());
    const d0 = base.delve;
    const h0 = d0.heroes.find((x) => x.status === 'active');
    const vis = E.visibility(base).visible;
    const orc = d0.monsters.find((m) => m.kind === 'orc' && m.hp > 0) ?? d0.monsters.find((m) => m.hp > 0 && m.kind !== 'gloam' && m.kind !== 'dragon');
    if (!h0 || !orc) return null;
    const dist = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
    const spots = [...vis].map((k) => { const [lv, q, r] = k.split(/[:,]/).map(Number); return { level: lv, q, r }; }).filter((x) => x.level === h0.at.level && dist(x, h0.at) >= 2 && dist(x, h0.at) <= 4);
    for (const at of spots) {
      const s = structuredClone(base);
      const d = s.delve;
      d.rivals = null;
      d.monsters = d.monsters.filter((m) => m.id === orc.id);
      const h = d.heroes.find((x) => x.heroId === h0.heroId);
      h.overwatch = true;
      h.acted = true;
      h.moved = true;
      h.facing = undefined;
      h.reactions = {};
      const m = d.monsters[0];
      m.at = { ...at };
      m.awareness = 'hunting';
      m.noticedIds = d.heroes.map((x) => x.heroId);
      m.hp = 99;
      if (d.heroes.some((x) => x.at.level === at.level && x.at.q === at.q && x.at.r === at.r)) continue;
      const r = E.apply(s, { type: 'endTurn' });
      if (r.state.delve?.pending?.question.kind === 'overwatch') return { s, hero: h.heroId, q: r.state.delve.pending.question };
    }
    return null;
  });
  check('reactions: a scene where an overwatch shot is asked', !!scene, scene ? scene.q.text : 'none found');
  if (scene) {
    await settings({ speed: 4 });
    await p.evaluate((s) => { window.__keepReact = true; window.vc.load(s); }, scene.s);
    await p.waitForTimeout(200);
    // The Reactions button beside the name, its popover with the per-hero settings.
    await p.evaluate((id) => window.vc.hud.select(id), scene.hero);
    await p.waitForTimeout(150);
    const btn = await p.$('.dl-hotbar .dl-react-b');
    check('the hero block has a Reactions button with a hover that explains it', !!btn && /Reactions ·[\s\S]*Ask pauses the castle's turn/.test(await tip('.dl-hotbar .dl-react-b')));
    if (btn) {
      await btn.click();
      await p.waitForTimeout(150);
      const pop = await p.evaluate(() => { const e = document.querySelector('.dl-reacts-pop'); return e ? { rows: [...e.querySelectorAll('.dl-reacts-row')].map((r) => r.querySelector('.dl-reacts-k').textContent), on: [...e.querySelectorAll('.dl-seg-b.on')].map((b) => b.textContent) } : null; });
      check('...opening a popover: a row per reaction, each on Ask', !!pop && pop.rows.includes('Hidden swing') && pop.on.every((x) => x === 'Ask'), JSON.stringify(pop));
      await p.keyboard.press('Escape');
      await p.waitForTimeout(100);
      check('...Esc closes it', !(await p.$('.dl-reacts-pop')));
      // V5.0 (spec 32.10): a hero with the forge shield gets the Shield block row.
      const shielded = await p.evaluate((id) => { const s = structuredClone(window.vc.state()); const h = s.campaign.roster.find((x) => x.id === id); const before = !!h.shield; h.shield = true; window.vc.load(s); window.vc.hud.select(id); return before; }, scene.hero);
      await p.waitForTimeout(150);
      await p.click('.dl-hotbar .dl-react-b');
      await p.waitForTimeout(150);
      const rows2 = await p.evaluate(() => [...document.querySelectorAll('.dl-reacts-pop .dl-reacts-row .dl-reacts-k')].map((e) => e.textContent));
      check('a hero with a shield has a "Shield block" reaction row', rows2.includes('Shield block'), rows2.join(','));
      await p.keyboard.press('Escape');
      await p.evaluate((x) => { const s = structuredClone(window.vc.state()); s.campaign.roster.find((h) => h.id === x.id).shield = x.before; window.vc.load(s); window.vc.hud.select(x.id); }, { id: scene.hero, before: shielded });
      await p.waitForTimeout(150);
    }
    // End turn: the playback stops at the question with the card up.
    await p.evaluate(() => { window.__endDone = false; void window.vc.send({ type: 'endTurn' }).then(() => (window.__endDone = true)); });
    await p.waitForFunction(() => { const r = document.querySelector('.dl-react'); return r && !r.classList.contains('hidden'); }, null, { timeout: 120000 });
    const card = await p.evaluate(() => { const r = document.querySelector('.dl-react'); return { text: r.innerText, opts: [...r.querySelectorAll('.dl-react-o')].map((b) => b.dataset.choice), busy: window.vc.busy(), pending: !!window.vc.state().delve.pending, saved: !!JSON.parse(localStorage.getItem('vc.save.v39') ?? '{}').delve?.pending }; });
    check('the castle\'s turn stops at the question: the reaction card (who, the question, Shoot / Hold with what each does, keys)', /Overwatch ·/i.test(card.text) && card.text.includes(scene.q.text) && /Shoot[\s\S]*1[\s\S]*Enter/.test(card.text) && /Hold[\s\S]*2[\s\S]*Esc/.test(card.text) && card.opts.join() === 'yes,no', card.text.replace(/\n/g, ' | '));
    check('...the turn waits (busy), the question is in the state and in the save', card.busy && card.pending && card.saved);
    // A reload while it waits: the card comes back.
    await p.reload();
    await p.waitForFunction(() => !!window.vc);
    await p.evaluate(() => { window.__keepReact = true; const raw = localStorage.getItem('vc.save.v39'); if (raw) window.vc.load(window.vcEngine.deserialize(raw)); });
    await p.waitForFunction(() => { const r = document.querySelector('.dl-react'); return r && !r.classList.contains('hidden'); }, null, { timeout: 120000 });
    check('after a reload mid-question, the castle\'s turn plays up to it and the card shows again', (await text('.dl-react')).includes(scene.q.text));
    // Answer with the key: 1 shoots; the turn plays on to the player's phase.
    await p.keyboard.press('1');
    await idle();
    await p.waitForTimeout(200);
    const after = await p.evaluate((id) => { const s = window.vc.state(); return { pending: !!s.delve?.pending, phase: s.delve?.phase, round: s.delve?.round, card: !document.querySelector('.dl-react').classList.contains('hidden'), over: !!document.querySelector('.dl-hotbar.folded'), shot: s.delve?.log.some((l) => l.includes('looses an arrow') || l.includes('Overwatch')) }; }, scene.hero);
    check('...key 1 answers: the card goes, the turn plays on to the next round', !after.pending && after.phase === 'player' && after.round === scene.s.delve.round + 1 && !after.card && !after.over, JSON.stringify(after));
    // Set to Always: the same turn never stops.
    await p.evaluate((x) => { window.vc.load(x.s); }, scene);
    await p.waitForTimeout(150);
    await p.evaluate((id) => window.vc.send({ type: 'setReaction', heroId: id, kind: 'overwatch', setting: 'always' }), scene.hero);
    await p.evaluate(() => { window.__sawCard = false; const tick = () => { const r = document.querySelector('.dl-react'); if (r && !r.classList.contains('hidden')) window.__sawCard = true; if (!window.__endDone) requestAnimationFrame(tick); }; window.__endDone = false; requestAnimationFrame(tick); void window.vc.send({ type: 'endTurn' }).then(() => (window.__endDone = true)); });
    await p.waitForFunction(() => window.__endDone, null, { timeout: 120000 });
    const alw = await p.evaluate(() => ({ saw: window.__sawCard, pending: !!window.vc.state().delve?.pending, phase: window.vc.state().delve?.phase }));
    check('a hero set to Always: the castle\'s turn never stops for it', !alw.saw && !alw.pending && alw.phase === 'player', JSON.stringify(alw));
    await p.evaluate(() => { window.__keepReact = false; });
    await settings();
  }
}

// ---- the return report
// V5.0 (P, B5, spec 32.5): auto end turn. Everyone spent, nothing in reach: after a beat the turn ends by itself (a toast
// says so). With the setting off, or with Take in reach, it waits.
{
  const spent = () => p.evaluate(() => {
    const s = structuredClone(window.vc.state());
    s.delve.ground = [];
    s.delve.monsters = [];
    s.delve.rivals = null;
    s.delve.prisoner = null;
    s.delve.pending = undefined;
    for (const h of s.delve.heroes) { if (h.status === 'active') { h.moved = true; h.acted = true; h.dashed = true; h.pack = h.pack.filter((i) => i.kind !== 'potion'); } }
    window.vc.load(s);
    return s.delve.round;
  });
  await p.evaluate(() => { window.vc.settings.autoEndTurn = false; });
  const ra = await spent();
  await p.evaluate(() => window.vc.send({ type: 'setMoveMode', heroId: window.vc.state().delve.heroes.find((h) => h.status === 'active').heroId, sneak: false }));
  await p.waitForTimeout(700);
  check('auto end turn off: everyone spent, the turn stays open', (await p.evaluate(() => window.vc.state().delve.round)) === ra);
  await p.evaluate(() => { window.vc.settings.autoEndTurn = true; });
  const rb = await spent();
  const nothingLeft = await p.evaluate(() => { const s = window.vc.state(); const E = window.vcEngine; return s.delve.heroes.filter((h) => h.status === 'active').map((h) => ({ id: h.heroId, reach: E.reachable(s, h.heroId, false).length, acts: E.actions(s, h.heroId).filter((o) => !o.blocked).map((o) => o.action) })); });
  await p.evaluate(() => window.vc.send({ type: 'setMoveMode', heroId: window.vc.state().delve.heroes.find((h) => h.status === 'active').heroId, sneak: false }));
  await p.waitForFunction(() => /Ending the turn/.test(document.querySelector('.hud-toast')?.textContent ?? ''), null, { timeout: 5000 }).catch(() => {});
  const toastEarly = await p.evaluate(() => document.querySelector('.hud-toast')?.textContent ?? '');
  await p.waitForFunction((r) => window.vc.state().delve && window.vc.state().delve.round === r + 1 && !window.vc.busy(), rb, { timeout: 20000 }).catch(() => {});
  await idle();
  const rc = await p.evaluate(() => window.vc.state().delve.round);
  check('auto end turn on: everyone spent, the turn ends by itself after a beat', rc === rb + 1, `${rb} → ${rc}; ${JSON.stringify(nothingLeft)}`);
  check('...and a toast said so', /Ending the turn/.test(toastEarly), toastEarly);
  // V5.0 (P, spec 32.6): the flow. A done hero hands the selection and the camera on after a beat; one with loot in
  // reach keeps them.
  {
    const re = await p.evaluate(() => { const s = structuredClone(window.vc.state()); s.delve.ground = []; for (const h of s.delve.heroes) { h.moved = false; h.acted = false; h.dashed = false; } window.vc.load(s); const first = s.delve.heroes.find((h) => h.status === 'active'); window.vc.hud.select(first.heroId); return first.heroId; });
    await p.waitForTimeout(150);
    await p.evaluate((id) => { const s = structuredClone(window.vc.state()); const h = s.delve.heroes.find((x) => x.heroId === id); h.moved = true; h.acted = true; h.dashed = true; window.vc.load(s); window.vc.hud.select(id); }, re);
    await p.evaluate(() => window.vc.send({ type: 'setMoveMode', heroId: window.vc.hud.selectedId, sneak: false }));
    await p.waitForFunction((id) => window.vc.hud.selectedId !== id, re, { timeout: 5000 }).catch(() => {});
    const selAfter = await p.evaluate(() => window.vc.hud.selectedId);
    check('a done hero: after a beat the selection (and camera) cycles to a hero with something left', selAfter !== re, `${re} → ${selAfter}`);
    await p.evaluate((id) => { const s = structuredClone(window.vc.state()); const h = s.delve.heroes.find((x) => x.heroId === id); s.delve.ground.push({ at: { ...h.at }, items: [{ id: 'fl-g', kind: 'potion', name: 'Potion', amount: 1, slots: 1 }] }); window.vc.load(s); window.vc.hud.select(id); }, re);
    await p.evaluate(() => window.vc.send({ type: 'setMoveMode', heroId: window.vc.hud.selectedId, sneak: false }));
    await p.waitForTimeout(1000);
    check('...but a done hero with loot to take keeps the selection and the camera', (await p.evaluate(() => window.vc.hud.selectedId)) === re);
    await p.evaluate(() => { const s = structuredClone(window.vc.state()); s.delve.ground = []; for (const h of s.delve.heroes) { h.moved = false; h.acted = false; h.dashed = false; } window.vc.load(s); });
  }
  // Take in reach keeps it open.
  const rd = await spent();
  await p.evaluate(() => { const s = structuredClone(window.vc.state()); const h = s.delve.heroes.find((x) => x.status === 'active'); s.delve.ground.push({ at: { ...h.at }, items: [{ id: 'ae-g', kind: 'potion', name: 'Potion', amount: 1, slots: 1 }] }); window.vc.load(s); });
  await p.evaluate(() => window.vc.send({ type: 'setMoveMode', heroId: window.vc.state().delve.heroes.find((h) => h.status === 'active').heroId, sneak: false }));
  await p.waitForTimeout(700);
  check('auto end turn on, but loot to take: the turn stays open', (await p.evaluate(() => window.vc.state().delve.round)) === rd);
  await p.evaluate(() => { const s = structuredClone(window.vc.state()); s.delve.ground = []; for (const h of s.delve.heroes) { h.moved = false; h.acted = false; h.dashed = false; } window.vc.load(s); });
}

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
