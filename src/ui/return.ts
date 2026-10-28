// V4.0: the return report, back in Lowgate after a delve (replaces the old summary screen). In
// Lowgate's style: the header with the strongbox and what this delve adds, the job's result as a
// headline, renown and what it opened, then the boxes: what was carried out, how the party came
// back, what was won back for Lowgate (V5.0), what was left behind (V5.0), and what the castle now
// remembers. "Back to Lowgate →" applies it all (backToCamp).
//
// V5.0 (P, spec 32.11, owner): the report is a tally. The boxes land one at a time with a beat and a
// sound: the haul (the strongbox counts up), the party (XP bars fill, level-ups punch in), what was
// won back (the villager, what reopened, the gift in their voice), what was left behind (room to do
// better), the castle. A click, E, Space or Enter skips to the end; the instant playback setting
// skips it too.

import type { Engine } from '../game/api';
import { hexKey, parsePosKey, type Pos } from '../game/hex';
import type { GameState, Hero, Item } from '../game/types';
import { CLASSES, GIFTS, LEVEL_XP, MAX_LEVEL, REP_FOR_LEVEL, REP_FOR_SLAY } from '../game/data';
import { CONTRACT_XP_POT, contractXpEach } from '../game/data'; // V4.1 (squads, spec 31.12)
import { isKit } from '../game/charges';
import { sfx } from '../audio/sfx';
import { clear, gold, h } from './dom';
import { STORY, className, classGlyph, itemGlyph, itemLabel } from './names';
import { installTips } from './lowgate';

export interface ReturnHost {
  engine: Engine;
  send(cmd: import('../game/types').Command): Promise<boolean>;
}

/** V5.0 (spec 32.11): how the report arrives. `tally` runs the staged reveal (false: everything at once). */
export interface ReturnOpts {
  tally?: boolean;
}

/** The stages of the tally, in order, with the beat before each (ms) and its sound. */
const STAGES: { key: string; wait: number; sfx: 'coin' | 'levelup' | 'horn' | 'flip' | 'click'; pitch: number }[] = [
  { key: 'head', wait: 0, sfx: 'flip', pitch: 1 },
  { key: 'haul', wait: 550, sfx: 'coin', pitch: 1 },
  { key: 'party', wait: 1100, sfx: 'flip', pitch: 1.2 },
  { key: 'won', wait: 1100, sfx: 'horn', pitch: 1.2 },
  { key: 'left', wait: 1000, sfx: 'click', pitch: 0.8 },
  { key: 'castle', wait: 500, sfx: 'flip', pitch: 0.9 },
];

/** The running tally's cancel, so a re-render or the skip ends it. */
let tallyAbort: AbortController | null = null;

/** Count `el` up from `from` to `to` over `ms` (a strongbox, an XP number). */
function countUp(el: HTMLElement, from: number, to: number, ms: number, signal: AbortSignal, format: (n: number) => string = (n) => `${n}`): void {
  const t0 = performance.now();
  const step = (now: number) => {
    if (signal.aborted) {
      el.textContent = format(to);
      return;
    }
    const k = Math.min(1, (now - t0) / ms);
    const eased = 1 - Math.pow(1 - k, 3);
    el.textContent = format(Math.round(from + (to - from) * eased));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

const NUM = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];
const num = (n: number) => NUM[n] ?? `${n}`;
const cap = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

function xpLevel(xp: number): number {
  let lv = 1;
  for (let i = 2; i <= MAX_LEVEL; i++) if (xp >= (LEVEL_XP[i] ?? Infinity)) lv = i;
  return lv;
}

/** "the Great Hall", "the gate passage", "the chapel". */
export function roomWords(name: string): string {
  if (/^the /i.test(name)) return `the ${name.slice(4)}`;
  const words = name.split(/\s+/);
  const proper = words.length > 1 && words.every((w) => /^[A-Z]/.test(w));
  return `the ${proper ? name : name.toLowerCase()}`;
}

function listAnd(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? '';
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

/** Rooms with hexes first seen on this delve (the delve's explored set against the campaign's memory before it). */
export function roomsMapped(engine: Engine, s: GameState): string[] {
  const d = s.delve;
  if (!d) return [];
  const mem = s.campaign.explored ?? {};
  const before = new Map<number, Set<string>>();
  for (const [lv, keys] of Object.entries(mem)) before.set(Number(lv), new Set(keys));
  const count = new Map<string, { name: string; n: number }>();
  for (const k of d.explored) {
    let p: Pos;
    try {
      p = parsePosKey(k);
    } catch {
      continue;
    }
    if (before.get(p.level)?.has(hexKey(p))) continue;
    const lv = engine.castle().levels.find((l) => l.level === p.level);
    const t = lv?.tiles[hexKey(p)];
    const room = t?.room ? lv?.rooms.find((r) => r.id === t.room) : undefined;
    if (!room) continue;
    const key = `${p.level}:${room.id}`;
    const c = count.get(key) ?? { name: room.name, n: 0 };
    c.n++;
    count.set(key, c);
  }
  return [...count.values()].filter((c) => c.n >= 3).sort((a, b) => b.n - a.n).map((c) => roomWords(c.name));
}

export function returnScreen(el: HTMLElement, s: GameState, host: ReturnHost, opts: ReturnOpts = {}): void {
  clear(el);
  tallyAbort?.abort();
  tallyAbort = null;
  const sm = s.summary;
  const d = s.delve;
  const C = s.campaign;
  if (!sm || !d) {
    el.append(h('div', { class: 'screen-panel' }, h('p', null, 'Nothing to report.'), h('button', { class: 'btn', onclick: () => host.send({ type: 'backToCamp' }) }, 'Back to Lowgate')));
    return;
  }
  const engine = host.engine;
  const k = d.contract;
  const def = (id: string) => C.roster.find((x) => x.id === id);
  const name = (id: string) => def(id)?.name ?? id;
  const out = d.heroes.filter((x) => x.status === 'out');
  const taken = d.heroes.filter((x) => x.status === 'captured');
  const dead = d.heroes.filter((x) => x.status === 'dead');
  const heirDead = dead.some((x) => def(x.heroId)?.cls === 'heir');
  const heirTaken = taken.some((x) => def(x.heroId)?.cls === 'heir');
  const crew = d.rivals?.name ?? 'a crew';
  // Money.
  const carried = out.flatMap((x) => x.pack);
  const loose = carried.filter((i) => i.kind === 'gold').reduce((a, i) => a + i.amount, 0);
  const gain = sm.bounty + loose;
  const cart = carried.filter((i) => i.kind !== 'gold' && !isKit(i) && !i.story && i.kind !== 'gatekey');
  const storyItems = carried.filter((i) => i.story);
  const gateKey = carried.some((i) => i.kind === 'gatekey');
  // Headline.
  const prize = carried.find((i) => i.kind === 'heirloom' && i.contractId === k.id) ?? carried.find((i) => !!k.story && i.story === k.story);
  let headline: string;
  let kicker = `${k.title} · ${sm.contractDone ? 'done' : 'failed'}`;
  if (!out.length) headline = 'Nobody came back.';
  else if (sm.contractDone) headline = k.kind === 'rescue' ? `${d.prisoner?.name ?? 'The prisoner'} is out.` : k.kind === 'slay' ? 'The Dragon is dead.' : `${prize ? cap(prize.name.replace(/^The /, 'the ')) : 'The prize'} is out.`;
  else {
    const why =
      k.kind === 'rescue'
        ? d.prisoner?.dead
          ? `${d.prisoner.name} died inside`
          : `${d.prisoner?.name ?? 'the prisoner'} is still inside`
        : k.kind === 'slay'
          ? 'the Dragon still lives'
          : d.rivals?.members.some((r) => r.loot.some((i) => i.kind === 'heirloom'))
            ? `${crew} have the prize`
            : 'the prize is still inside';
    headline = `Contract failed: ${why}.`;
  }
  if (heirDead) headline = 'Keven did not come back.';
  else if (heirTaken) headline = 'The heir is taken.';
  if (k.story) kicker = `For Lowgate · ${kicker}`;
  const rounds = d.round;
  // V5.0: torches are the clock (31.5); the rounds, and the torches the party carried back lit or spent.
  const torchesLeft = carried.filter((i) => i.kind === 'torch').reduce((a, i) => a + (i.rounds ?? 15), 0);
  const line = out.length ? `${num(rounds)} round${rounds === 1 ? '' : 's'} inside.${torchesLeft ? ` ${torchesLeft} round${torchesLeft === 1 ? '' : 's'} of torchlight came back.` : ''}` : `${num(rounds)} round${rounds === 1 ? '' : 's'} inside.`;
  // Renown.
  const repBefore = C.reputation;
  const repAfter = repBefore + (sm.contractDone ? 1 : 0);
  const opened: string[] = [];
  for (const lv of [2, 3]) {
    const need = REP_FOR_LEVEL[lv];
    if (need !== undefined && repBefore < need && repAfter >= need) opened.push(`jobs on Level ${lv}`);
  }
  if (repBefore < REP_FOR_SLAY && repAfter >= REP_FOR_SLAY) opened.push('a bounty on the Dragon');
  const pips = h('span', { class: 'lg-pips', 'aria-hidden': 'true' }, ...[0, 1, 2].map((i) => h('i', { class: `${i < Math.min(repAfter, 3) ? 'on' : ''} ${i >= repBefore && i < repAfter ? 'fresh' : ''}` })));
  const renown =
    repAfter > repBefore
      ? h('div', { class: 'dl-rt-renown', tabindex: 0, 'data-tip': `Renown · ${Math.min(repAfter, 3)} of 3\nFinished jobs spread your name. Deeper jobs go up on the post as it grows.` }, pips, h('span', null, opened.length ? h('span', null, 'Word spreads: ', h('span', { class: 'lg-cream' }, listAnd(opened)), ' go up on the post.') : 'Word spreads.'))
      : '';

  // Header.
  const head = h(
    'header',
    { class: 'lg-head' },
    h('div', { class: 'lg-brand', tabindex: 0, 'data-tip': `Lowgate · the village under the walls\nBack from delve ${C.delveCount}.` }, h('div', { class: 'lg-kick' }, `Delve ${C.delveCount} · back under the walls`), h('div', { class: 'lg-title' }, 'Lowgate')),
    h('div', { class: 'lg-gold', tabindex: 0, 'data-tip': `Gold · ${gold(C.gold + gain)} in Keven's strongbox once you're back${gain ? `\n+${gain} from this delve: the bounty and the loose gold carried out.` : ''}` }, h('span', { class: 'lg-gold-n num', 'data-gold-to': `${C.gold + gain}` }, gold(C.gold + gain)), h('span', { class: 'lg-gold-w' }, 'gold'), gain ? h('span', { class: 'num dl-rt-gain', 'data-stage': 'haul' }, `+${gain}`) : ''),
  );

  // Carried out.
  const carriedBox = h('section', { class: 'dl-rt-box', 'aria-label': 'Carried out', 'data-stage': 'haul' }, h('span', { class: 'lg-kick lg-kick-dim' }, 'Carried out'));
  if (sm.bounty) carriedBox.append(h('span', { class: 'dl-rt-row' }, h('span', { class: 'dl-rt-grow' }, 'The bounty'), h('span', { class: 'num lg-goldtxt' }, `+${sm.bounty}`)));
  if (loose) carriedBox.append(h('span', { class: 'dl-rt-row' }, h('span', { class: 'dl-rt-grow' }, 'Loose gold'), h('span', { class: 'num lg-goldtxt' }, `+${loose}`)));
  if (cart.length) {
    if (sm.bounty || loose) carriedBox.append(h('span', { class: 'dl-rt-rule' }));
    carriedBox.append(h('span', { class: 'dl-rt-note' }, "To Keven's cart"));
    for (const it of cart) carriedBox.append(h('span', { class: 'dl-rt-row', 'data-item': it.kind }, h('span', { class: 'dl-rt-glyph' }, itemGlyph(it.kind)), h('span', { class: 'dl-rt-grow' }, it.kind === 'gem' || it.kind === 'jewelry' ? it.name : itemLabel(it)), it.kind === 'gem' || it.kind === 'jewelry' || it.kind === 'hoard' ? h('span', { class: 'num dim small' }, `worth ${it.amount}`) : ''));
  }
  for (const it of storyItems) carriedBox.append(h('span', { class: 'dl-rt-row' }, h('span', { class: 'dl-rt-glyph' }, itemGlyph(it.kind)), h('span', { class: 'dl-rt-grow' }, `${it.name}: goes home to Lowgate`)));
  if (gateKey) carriedBox.append(h('span', { class: 'dl-rt-row' }, h('span', { class: 'dl-rt-glyph' }, itemGlyph('gatekey')), h('span', { class: 'dl-rt-grow' }, 'The sally port key: the gate is yours for good')));
  if (!sm.bounty && !loose && !cart.length && !storyItems.length && !gateKey) carriedBox.append(h('span', { class: 'dl-rt-empty' }, 'Nothing came out.'));
  const lost = lostThisDelve(s);
  if (taken.length) carriedBox.append(h('span', { class: 'dl-rt-note' }, `${listAnd(taken.map((x) => name(x.heroId)))}'s gold and gems went with ${crew}.`));

  // The party.
  const partyBox = h('section', { class: 'dl-rt-box', 'aria-label': 'The party', 'data-stage': 'party' }, h('span', { class: 'lg-kick lg-kick-dim' }, 'The party'));
  const rows = h('div', { class: 'dl-rt-party' });
  const ups: HTMLElement[] = [];
  for (const hd of d.heroes) {
    const hr = def(hd.heroId);
    if (!hr) continue;
    const xpGain = sm.xp[hd.heroId] ?? 0;
    const xpAfter = hr.xp + xpGain;
    const lvAfter = hd.status === 'out' ? Math.min(MAX_LEVEL, xpLevel(xpAfter)) : hr.level;
    const lo = LEVEL_XP[lvAfter] ?? 0;
    const hi = LEVEL_XP[lvAfter + 1];
    const frac = hi === undefined ? 1 : Math.max(0, Math.min(1, (xpAfter - lo) / (hi - lo)));
    // V5.0 (spec 32.11): the bar starts where the hero stood and fills to where they are now.
    const lo0 = LEVEL_XP[hr.level] ?? 0;
    const hi0 = LEVEL_XP[hr.level + 1];
    const frac0 = hi0 === undefined ? 1 : Math.max(0, Math.min(1, (hr.xp - lo0) / (hi0 - lo0)));
    const up = sm.levelUps.includes(hd.heroId);
    const maxHp = hr.maxHp + (up ? 2 * (lvAfter - hr.level) : 0);
    const hp = hd.status === 'out' ? Math.min(maxHp, hd.hp + (up ? 2 * (lvAfter - hr.level) : 0)) : 0;
    let fate = '';
    if (hd.status === 'dead') fate = fellWords(engine, s, hd.heroId);
    else if (hd.status === 'captured') fate = `dragged out by ${crew}`;
    const hurt = hd.status === 'out' && hp < maxHp;
    rows.append(
      h(
        'span',
        { class: `dl-rt-hero ${hd.status}`, 'data-hero': hd.heroId },
        h('span', { class: `cbadge lg-hex lg-hex-sm cls-${hr.cls}`, 'aria-hidden': 'true' }, classGlyph(hr.cls)),
        h('span', { class: 'dl-rt-grow' }, hr.name, hurt ? h('span', { class: 'dl-rt-hurt' }, ` ${hp} of ${maxHp} HP`) : '', fate ? h('span', { class: 'dl-rt-fate' }, ` ${fate}`) : ''),
        hd.status === 'out'
          ? h('span', { class: 'dl-rt-bars', 'data-tip': `${hr.name} · ${className(hr.cls)}, level ${lvAfter}\nHP ${hp} of ${maxHp}. XP ${xpAfter}${hi !== undefined ? ` of ${hi} for level ${lvAfter + 1}` : ' (top level)'}.` , tabindex: 0 }, h('span', { class: 'dl-rt-hp' }, h('i', { style: `width:${(hp / Math.max(1, maxHp)) * 100}%` })), h('span', { class: `dl-rt-xp ${up ? 'up' : ''}` }, h('i', { class: 'dl-rt-xp-fill', style: `width:${(up ? 1 : frac) * 100}%`, 'data-from': `${(up ? frac0 : frac0) * 100}`, 'data-to': `${(up ? 1 : frac) * 100}` })))
          : h('span', { class: 'dl-rt-bars off' }),
        h('span', { class: 'num dl-rt-xpn' }, xpGain ? `+${xpGain}` : ''),
      ),
    );
    if (up) ups.push(h('div', { class: 'dl-rt-up', 'data-punch': '1' }, h('span', { class: 'dl-rt-up-t' }, `${hr.name} is level ${lvAfter}`), h('span', { class: 'dl-rt-up-d' }, upWords(hr))));
  }
  partyBox.append(rows, ...ups);
  // V4.1 (squads, spec 31.12): the contract's XP is a pot shared by the heroes who got out.
  if (sm.contractDone && out.length) partyBox.append(h('span', { class: 'dl-rt-note', 'data-xp': 'contract', 'data-tip': `Contract XP · ${CONTRACT_XP_POT} for the job, shared by the heroes who got out (rounded up): ${contractXpEach(out.length)} each. Kills and getting out (+1) are on top.` }, `Contract: ${CONTRACT_XP_POT} XP ${out.length === 1 ? `to ${name(out[0]!.heroId)}` : `shared by ${out.length}`}.`));
  const wounded = out.filter((x) => x.hp < (def(x.heroId)?.maxHp ?? 0));
  if (wounded.length) partyBox.append(h('span', { class: 'dl-rt-note' }, `Wounds don't mend on their own. ${listAnd(wounded.map((x) => name(x.heroId)))} can be healed when you pick the party.`));
  const notes = sm.notes.filter((n) => !/^Contract (done|failed)/.test(n) && !/dragged out by/.test(n) && !/was left behind/.test(n));
  if (notes.length) partyBox.append(h('span', { class: 'dl-rt-note' }, notes.join(' ')));

  // The castle remembers.
  const castleBox = h('section', { class: 'dl-rt-box', 'aria-label': 'The castle remembers', 'data-stage': 'castle' }, h('span', { class: 'lg-kick lg-kick-dim' }, 'The castle remembers'));
  const rooms = roomsMapped(engine, s);
  castleBox.append(h('span', { class: 'dl-rt-mapped' }, rooms.length ? `You mapped ${listAnd(rooms.length > 5 ? [...rooms.slice(0, 4), `${rooms.length - 4} more places`] : rooms)}.` : 'Nothing new mapped this time.'));
  for (const w of waysFound(engine, s)) castleBox.append(h('span', { class: 'dl-rt-way' }, h('span', { class: 'dl-rt-way-ic', 'aria-hidden': 'true', html: '<svg width="22" height="22" viewBox="0 0 40 40"><path d="M6 34 V16 L20 6 L34 16 V34 Z" fill="none" stroke="#e8a33d" stroke-width="2"/><path d="M14 34 V22 H26 V34 M14 26 H26 M14 30 H26" fill="none" stroke="#e8a33d" stroke-width="1.6"/></svg>' }), h('span', { class: 'dl-rt-way-t' }, h('span', null, w.title), w.hint ? h('span', { class: 'dim small' }, w.hint) : '')));
  if (rooms.length) castleBox.append(h('span', { class: 'dl-rt-note' }, "The Set out map now shows what you've seen."));

  // V5.0 (spec 32.11): what was won back for Lowgate, as its own reveal (players missed the gift as a line of prose).
  const gift = k.story && !C.village?.[k.story] ? GIFTS[k.story] : undefined;
  const wonBox = k.story && sm.contractDone ? wonBackBox(k.story, k.kind === 'rescue', gift, renown) : null;
  // V5.0 (spec 32.11): what was left behind: room to do better next time, in the castle's voice.
  const leftBox = leftBehindBox(engine, s, lost, name);
  const warn = heirDead || heirTaken ? h('p', { class: 'dl-rt-warn' }, heirTaken ? 'The heir is taken. Valkenburg stays dark.' : 'Keven did not come back. Valkenburg stays dark.') : '';
  const root = h(
    'div',
    { class: `lowgate dl-return ${sm.contractDone ? 'won' : 'lost'}` },
    head,
    h(
      'main',
      { class: 'lg-main dl-rt-main' },
      h('div', { class: 'dl-rt-top', 'data-stage': 'head' }, h('div', { class: 'dl-rt-head' }, h('span', { class: 'lg-kick' }, kicker), h('h1', { class: 'dl-rt-h1' }, headline), h('span', { class: 'dl-rt-line' }, line), warn), wonBox ? '' : renown),
      h('div', { class: `dl-rt-boxes ${wonBox ? 'with-won' : ''}` }, carriedBox, partyBox, wonBox ?? '', leftBox, castleBox),
    ),
    h('footer', { class: 'lg-foot dl-rt-foot', 'data-stage': 'castle' }, h('span', { class: 'lg-foot-hint' }, heirDead || heirTaken ? '' : 'New jobs and new faces are waiting.'), h('button', { type: 'button', class: 'btn lg-primary dl-rt-go', onclick: () => { tallyAbort?.abort(); void host.send({ type: 'backToCamp' }); } }, heirDead || heirTaken ? 'Continue' : 'Back to Lowgate ', heirDead || heirTaken ? '' : h('span', { 'aria-hidden': 'true' }, '→'))),
  );
  el.append(root);
  installTips(root);
  runTally(root, { from: C.gold, to: C.gold + gain, levelUps: sm.levelUps.length > 0, won: !!wonBox }, opts.tally !== false);
}

/** V5.0 (spec 32.11): the staged reveal. Every `[data-stage]` starts hidden and lands in STAGES order; skip shows all. */
function runTally(root: HTMLElement, o: { from: number; to: number; levelUps: boolean; won: boolean }, tally: boolean): void {
  const ctrl = new AbortController();
  tallyAbort = ctrl;
  const sig = ctrl.signal;
  const stages = [...root.querySelectorAll<HTMLElement>('[data-stage]')];
  const goldEl = root.querySelector<HTMLElement>('.lg-gold-n');
  const fills = [...root.querySelectorAll<HTMLElement>('.dl-rt-xp-fill')];
  const show = (key: string) => {
    for (const e of stages) if (e.dataset.stage === key) e.classList.remove('pending');
    if (key === 'haul' && goldEl) countUp(goldEl, o.from, o.to, 900, sig, gold);
    if (key === 'party') {
      for (const f of fills) f.style.width = `${f.dataset.to}%`;
      if (o.levelUps) sfx.play('levelup', { gain: 0.8 });
    }
  };
  const finish = () => {
    for (const e of stages) e.classList.remove('pending');
    for (const f of fills) f.style.width = `${f.dataset.to}%`;
    if (goldEl) goldEl.textContent = gold(o.to);
    root.classList.remove('tallying');
  };
  if (!tally) {
    finish();
    return;
  }
  root.classList.add('tallying');
  for (const e of stages) e.classList.add('pending');
  for (const f of fills) f.style.width = `${f.dataset.from}%`;
  if (goldEl) goldEl.textContent = gold(o.from);
  // Skip: a click anywhere, or E, Space, Enter.
  root.addEventListener('click', () => { if (!sig.aborted) { ctrl.abort(); finish(); } }, { signal: sig });
  addEventListener('keydown', (e) => {
    if (e.key === 'e' || e.key === 'E' || e.key === ' ' || e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      ctrl.abort();
      finish();
    }
  }, { signal: sig });
  let t = 0;
  const present = new Set(stages.map((e) => e.dataset.stage));
  for (const st of STAGES) {
    if (!present.has(st.key) && st.key !== 'head') continue;
    t += st.wait;
    setTimeout(() => {
      if (sig.aborted) return;
      show(st.key);
      sfx.play(st.sfx, { pitch: st.pitch, gain: 0.6 });
      if (st.key === 'castle') {
        ctrl.abort();
        root.classList.remove('tallying');
      }
    }, t);
  }
}

/** V5.0 (spec 32.11): "Won back for Lowgate": the villager (or thing), what reopened, the gift in their voice, renown. */
function wonBackBox(story: keyof typeof STORY, rescue: boolean, gift: (typeof GIFTS)[keyof typeof GIFTS] | undefined, renown: HTMLElement | ''): HTMLElement {
  const st = STORY[story];
  const box = h('section', { class: 'dl-rt-box dl-rt-won', 'aria-label': 'Won back for Lowgate', 'data-stage': 'won' }, h('span', { class: 'lg-kick' }, 'Won back for Lowgate'));
  box.append(h('div', { class: 'dl-rt-won-h', 'data-punch': '1' }, h('span', { class: 'dl-rt-won-t' }, st.home), h('span', { class: 'dl-rt-won-l' }, `${cap(st.who)} ${rescue ? 'is' : 'goes'} on the way home. ${st.homeLine}`)));
  if (gift) {
    const items = h('div', { class: 'dl-rt-won-items' });
    for (const [kind, n] of gift.items ?? []) items.append(h('span', { class: 'dl-rt-row', 'data-gift': kind }, h('span', { class: 'dl-rt-glyph' }, itemGlyph(kind)), h('span', { class: 'dl-rt-grow' }, `${n} × ${cap(itemLabel({ id: '', kind, name: kind, amount: 1, slots: 1 }))}`), h('span', { class: 'dim small' }, "to Keven's cart")));
    if (gift.ale) items.append(h('span', { class: 'dl-rt-row', 'data-gift': 'ale' }, h('span', { class: 'dl-rt-glyph' }, '🍺'), h('span', { class: 'dl-rt-grow' }, gift.short)));
    if (gift.shields) items.append(h('span', { class: 'dl-rt-row', 'data-gift': 'shield' }, h('span', { class: 'dl-rt-glyph' }, '⛨'), h('span', { class: 'dl-rt-grow' }, gift.short), h('span', { class: 'dim small' }, 'free at the forge')));
    box.append(h('p', { class: 'dl-rt-won-gift' }, gift.line), items);
  }
  if (renown) box.append(renown);
  return box;
}

/** V5.0 (spec 32.11): "Left behind": seen but unopened chests, loot seen and not taken, the fallen's packs. */
function leftBehindBox(engine: Engine, s: GameState, lost: { owner: string; items: Item[] }[], name: (id: string) => string): HTMLElement {
  const d = s.delve!;
  const box = h('section', { class: 'dl-rt-box dl-rt-left', 'aria-label': 'Left behind', 'data-stage': 'left' }, h('span', { class: 'lg-kick lg-kick-dim' }, 'Left behind'));
  const seen = new Set(d.explored);
  const roomOf = (p: Pos) => {
    const lv = engine.castle().levels.find((l) => l.level === p.level);
    const room = lv?.rooms.find((r) => r.id === lv.tiles[hexKey(p)]?.room)?.name;
    return room ? roomWords(room) : `Level ${p.level}`;
  };
  const chests = d.chests.filter((c) => !c.opened && seen.has(`${c.at.level}:${c.at.q},${c.at.r}`));
  const lostIds = new Set(lost.flatMap((l) => l.items.map((i) => i.id)));
  const piles = d.ground.filter((g) => seen.has(`${g.at.level}:${g.at.q},${g.at.r}`) && g.items.some((i) => (i.kind === 'gold' || i.kind === 'gem' || i.kind === 'jewelry' || i.kind === 'hoard') && !lostIds.has(i.id)));
  const lines: HTMLElement[] = [];
  const byRoom = new Map<string, number>();
  for (const c of chests) byRoom.set(roomOf(c.at), (byRoom.get(roomOf(c.at)) ?? 0) + 1);
  for (const [room, n] of byRoom) lines.push(h('span', { class: 'dl-rt-row', 'data-left': 'chest' }, h('span', { class: 'dl-rt-glyph' }, '▣'), h('span', { class: 'dl-rt-grow' }, n === 1 ? `A chest in ${room} is still shut.` : `${n} chests in ${room} are still shut.`)));
  const worth = piles.reduce((a, g) => a + g.items.filter((i) => !lostIds.has(i.id)).reduce((b, i) => b + (i.kind === 'gold' ? i.amount : i.kind === 'gem' || i.kind === 'jewelry' || i.kind === 'hoard' ? i.amount : 0), 0), 0);
  if (piles.length) lines.push(h('span', { class: 'dl-rt-row', 'data-left': 'loot' }, h('span', { class: 'dl-rt-glyph' }, '◇'), h('span', { class: 'dl-rt-grow' }, `${piles.length === 1 ? 'Loot' : `${piles.length} piles of loot`} seen and not taken${worth ? ` (worth about ${worth})` : ''}: ${listAnd([...new Set(piles.map((g) => roomOf(g.at)))].slice(0, 3))}.`)));
  if (lost.length) lines.push(h('span', { class: 'dl-rt-row', 'data-left': 'pack' }, h('span', { class: 'dl-rt-glyph' }, '✕'), h('span', { class: 'dl-rt-grow' }, `Lost inside: ${listAnd(lost.map((l) => `${l.items.map((i) => itemLabel(i).toLowerCase()).join(', ')} (${name(l.owner)}'s pack)`))}. It waits where they fell.`)));
  if (!lines.length) box.append(h('span', { class: 'dl-rt-empty' }, 'Nothing you saw was left behind.'));
  else box.append(...lines);
  return box;
}

/** "fell in the Great Hall" / "was left behind". */
function fellWords(engine: Engine, s: GameState, id: string): string {
  const d = s.delve!;
  const n = (s.campaign.roster.find((x) => x.id === id)?.name ?? '').toLowerCase();
  if ((s.summary?.notes ?? []).some((x) => x.toLowerCase().startsWith(`${n} was left behind`))) return 'was left behind';
  const at = (d as { diedAt?: Record<string, Pos> }).diedAt?.[id] ?? d.heroes.find((x) => x.heroId === id)?.at;
  if (!at) return 'fell';
  const lv = engine.castle().levels.find((l) => l.level === at.level);
  const room = lv?.rooms.find((r) => r.id === lv.tiles[hexKey(at)]?.room)?.name;
  return room ? `fell in ${roomWords(room)}` : 'fell';
}

/** What a level-up gives, in words. */
function upWords(hr: Hero): string {
  const main = CLASSES[hr.cls]?.main ?? 'might';
  const stat = main === 'might' ? 'sword arm' : main === 'finesse' ? 'hands' : main === 'wits' ? 'wits' : 'nerve';
  return `Tougher (+2 HP), and their ${stat} sharper (+5 ${cap(main)}).`;
}

/** Items dropped by heroes who died on this delve (not earlier lost gear), with whose they were. */
function lostThisDelve(s: GameState): { owner: string; items: Item[] }[] {
  const d = s.delve as (GameState['delve'] & { lostIds?: string[]; diedAt?: Record<string, Pos> }) | null;
  if (!d) return [];
  const earlier = new Set(s.campaign.lostGear.flatMap((g) => g.items.map((i) => i.id)));
  const ids = new Set((d.lostIds ?? []).filter((id) => !earlier.has(id)));
  if (!ids.size) return [];
  const out: { owner: string; items: Item[] }[] = [];
  for (const [owner, at] of Object.entries(d.diedAt ?? {})) {
    const items = d.ground.filter((g) => g.at.level === at.level && g.at.q === at.q && g.at.r === at.r).flatMap((g) => g.items.filter((i) => ids.has(i.id)));
    if (items.length) out.push({ owner, items });
  }
  return out;
}

/** Ways in first found (or opened for good) on this delve. */
function waysFound(engine: Engine, s: GameState): { title: string; hint?: string }[] {
  if (typeof engine.entrances !== 'function') return [];
  let now;
  let before;
  try {
    now = engine.entrances(s);
    before = engine.entrances({ ...s, delve: null });
  } catch {
    return [];
  }
  const out: { title: string; hint?: string }[] = [];
  for (const e of now) {
    const b = before.find((x) => x.index === e.index);
    if (!b) continue;
    if (e.state === 'open' && b.state !== 'open') out.push({ title: `Opened for good: the ${e.name.toLowerCase()}`, hint: 'In and out, for the rest of the campaign.' });
    else if (e.known && !b.known) out.push({ title: `Found: the ${e.name.toLowerCase()}`, hint: e.hint });
  }
  return out;
}
