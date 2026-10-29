// V5.2 (spec 35): the title screen on the camp's 1920x1080 stage, after the approved boards 8–10 of the "Lowgate V5.1
// Camp Screens" canvas. Dusk over Valkenburg (CSS and SVG, no WebGL, so it is up at once), the lockup with one hook
// line, and one card that says what Continue would pick up: the party as busts, the coin stack, villagers home and
// the graves; inside the castle, where and how it stands. No save: the card is the start, Keven alone and his purse.
// A campaign that ended is remembered (runs.ts) so the title can say how the last run ended. New campaign with a
// live save asks once, in place. Settings and keys are corner buttons. Enter plays, N starts over, ? keys, Esc closes.

import './title.css';
import type { GameState } from '../../game/types';
import type { Settings } from '../settings';
import { clear, h } from '../dom';
import { sfx } from '../../audio/sfx';
import { bust, warmBusts } from './bust';
import { coinStack } from './coinstack';
import { ic } from './icons';
import { mountStage, type Stage } from './stage';
import { installStageTips } from './frame';
import { campaignCard, loadRuns, recordRun, runLine, type CampaignCard, type CardHero, type RunRecord } from './runs';
import { className } from '../names';

export interface TitleHost {
  /** The save on disk (any stage), or null. */
  saved: GameState | null;
  newCampaign(seed: number): void;
  continueGame(): void;
  settings: Settings;
  /** Store the settings and apply them (playback, look). */
  saveSettings(): void;
  /** The game's version line ("V5.2"). */
  version: string;
  /** The keys legend (the delve menu's), shown in the keys panel. */
  legend(): HTMLElement[];
}

/** Playback speeds, as in the delve menu. */
const SPEEDS: { label: string; value: number }[] = [
  { label: '½×', value: 0.5 },
  { label: '1×', value: 1 },
  { label: '2×', value: 2 },
  { label: '4×', value: 4 },
  { label: 'Instant', value: 0 },
];

const HOOK_BACK = 'Lord Hobart is dead and the castle has gone dark. His heir camps under the walls.';
const HOOK_NEW = "Lord Hobart is dead and the castle has gone dark. His heir camps under the walls. Bring Lowgate's people home, and come back alive.";

let stage: Stage | null = null;
let offKeys: (() => void) | null = null;

const randomSeed = () => Math.floor(Math.random() * 1e9);
const parseSeed = (v: string) => {
  const n = Number.parseInt(v.trim(), 10);
  return Number.isFinite(n) ? n >>> 0 : randomSeed();
};

export function titleScreen(el: HTMLElement, host: TitleHost): void {
  offKeys?.();
  offKeys = null;
  stage?.destroy();
  clear(el);
  stage = mountStage(el, 'title-screen');
  const root = stage.root;
  const tip = h('div', { class: 'lg-tip camp-tip hidden', role: 'tooltip', id: 'lg-tip' });
  installStageTips(stage, tip);

  const saved = host.saved;
  const runs: RunRecord[] = saved?.stage === 'over' ? recordRun(saved) : loadRuns();
  const live = saved && saved.stage !== 'over' ? saved : null;
  const card = live ? campaignCard(live) : null;
  warmBusts(card ? card.party.map((p) => p.cls) : ['heir']);

  // ---------------------------------------------------------- scene
  root.append(scene());

  // ---------------------------------------------------------- lockup
  root.append(
    h(
      'div',
      { class: 't-lock' },
      h('div', { class: 'kick' }, 'A delve into the ruined seat of the Van Valkenburgs'),
      h('h1', null, 'Valkenburg Castle'),
      h('div', { class: 't-sub' }, h('span', { class: 't-rule' }), "The Heir's Return"),
      h('p', { class: 't-hook' }, live ? HOOK_BACK : HOOK_NEW),
    ),
  );

  // ---------------------------------------------------------- the card and what's under it
  const col = h('div', { class: 't-col' });
  root.append(col);
  let confirmEl: HTMLElement | null = null;
  let seedInput: HTMLInputElement | null = null;

  const begin = () => {
    sfx.play('horn', { pitch: 0.8, gain: 0.5 });
    host.newCampaign(seedInput ? parseSeed(seedInput.value) : randomSeed());
  };
  const seedField = (focus = false) => {
    seedInput = h('input', { class: 'seed', id: 't-seed', type: 'text', inputmode: 'numeric', placeholder: 'random', maxlength: 10, autocomplete: 'off', 'aria-label': 'Seed' }) as HTMLInputElement;
    seedInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        if (live) askNew();
        else begin();
      }
    });
    if (focus) queueMicrotask(() => seedInput?.focus());
    return h('div', { class: 't-seedfield', 'data-tip': 'Blank is random. The same seed gives the same castle dice.' }, h('label', { for: 't-seed' }, 'Seed'), seedInput);
  };

  let askNew: () => void = begin;
  if (live && card) {
    const cont = h('button', { type: 'button', class: 'btn primary', 'data-continue': '1', onclick: () => host.continueGame() }, card.kind === 'delve' ? 'Continue the delve' : 'Continue', h('span', { class: 't-kbd' }, 'Enter'));
    const panel = cardPanel(card, runs.length, cont);
    col.append(panel);

    const newBtn = h('button', { type: 'button', class: 'btn', 'data-ask-new': '1', 'data-tip': 'Start over from Keven alone. Asks first: the saved campaign would be gone.', onclick: () => askNew() }, 'New campaign');
    const seedSlot = h('span', { class: 't-seedslot' });
    const seedLink = h('button', { type: 'button', class: 't-seedlink', onclick: () => seedSlot.replaceChildren(seedField(true)) }, 'Choose a seed');
    seedSlot.append(seedLink);
    const row = h('div', { class: 't-newrow' }, newBtn, seedSlot);
    if (runs.length) row.append(h('span', { class: 't-runs', 'data-tip': runsTip(runs) }, ic('grave'), `${runs.length} run${runs.length === 1 ? '' : 's'} before this one`));
    col.append(row);
    queueMicrotask(() => cont.focus({ preventScroll: true }));

    askNew = () => {
      if (confirmEl) return;
      panel.classList.add('dimmed');
      row.classList.add('hidden');
      const keep = () => {
        confirmEl?.remove();
        confirmEl = null;
        panel.classList.remove('dimmed');
        row.classList.remove('hidden');
        cont.focus({ preventScroll: true });
      };
      const bury = h('button', { type: 'button', class: 'btn danger', 'data-new-campaign': '1', onclick: begin }, 'Bury it and begin');
      confirmEl = h(
        'div',
        { class: 't-confirm', role: 'alertdialog', 'aria-labelledby': 't-confirm-q' },
        h('p', { id: 't-confirm-q' }, "Start over? Keven's line ends here."),
        h('p', { class: 's' }, `The saved campaign is gone for good: ${card.gold} gold, ${card.villagers} villager${card.villagers === 1 ? '' : 's'} home, ${card.delves} delve${card.delves === 1 ? '' : 's'}.`),
        h('div', { class: 'acts' }, bury, h('button', { type: 'button', class: 'btn ghost', 'data-keep': '1', onclick: keep }, 'Keep it', h('span', { class: 't-kbd' }, 'Esc'))),
      );
      (confirmEl as HTMLElement & { keep?: () => void }).keep = keep;
      col.append(confirmEl);
      bury.focus({ preventScroll: true });
    };
  } else {
    // First visit, or the last campaign ended: the card is the start.
    const last = runs[0] ?? null;
    const go = h('button', { type: 'button', class: 'btn primary', 'data-new-campaign': '1', onclick: begin }, last ? 'Begin again' : 'Begin', h('span', { class: 't-kbd' }, 'Enter'));
    const panel = h(
      'section',
      { class: 'panel t-card', 'aria-label': 'A new campaign' },
      h('div', { class: 't-hd' }, h('div', { class: 'kick' }, last ? `A new campaign · run ${runs.length + 1}` : 'A new campaign'), h('div', { class: 't-where' }, 'Delve 1')),
      h(
        'div',
        { class: 't-row t-row-start' },
        heroMed({ name: 'Keven', cls: 'heir', level: 1 }, true, 'alone'),
        h('div', { class: 't-facts t-facts-start' }, purse(70), h('div', { class: 't-fact t-say' }, 'Enough for one hire and a torch.')),
      ),
      last ? lastRun(last, runs.length) : null,
      h('div', { class: 't-go' }, go, seedField()),
    );
    col.append(panel);
    queueMicrotask(() => go.focus({ preventScroll: true }));
  }

  // ---------------------------------------------------------- corner: settings and keys
  const pop = h('div', { class: 'panel t-pop hidden', role: 'dialog' });
  let popKind: 'settings' | 'keys' | null = null;
  const closePop = () => {
    popKind = null;
    pop.classList.add('hidden');
    gear.setAttribute('aria-expanded', 'false');
    keys.setAttribute('aria-expanded', 'false');
  };
  const openPop = (kind: 'settings' | 'keys') => {
    if (popKind === kind) return closePop();
    popKind = kind;
    clear(pop);
    pop.setAttribute('aria-label', kind === 'settings' ? 'Settings' : 'Keys and marks');
    pop.classList.toggle('t-pop-keys', kind === 'keys');
    if (kind === 'settings') pop.append(...settingsRows(host, () => openPopAgain()));
    else pop.append(h('div', { class: 'kick' }, 'Keys and marks'), h('div', { class: 't-legend' }, ...host.legend()));
    pop.classList.remove('hidden');
    gear.setAttribute('aria-expanded', String(kind === 'settings'));
    keys.setAttribute('aria-expanded', String(kind === 'keys'));
  };
  const openPopAgain = () => {
    const k = popKind;
    popKind = null;
    if (k) openPop(k);
  };
  const gear = h('button', { type: 'button', class: 'prop', 'data-title-settings': '1', 'aria-label': 'Settings', 'aria-expanded': 'false', 'data-tip': 'Settings · playback, sound, quality, camera', onclick: () => openPop('settings') });
  gear.innerHTML = GEAR;
  const keys = h('button', { type: 'button', class: 'prop', 'data-title-keys': '1', 'aria-label': 'Keys and marks', 'aria-expanded': 'false', 'data-tip': 'Keys and marks', onclick: () => openPop('keys') }, h('span', { class: 't-q' }, '?'));
  root.append(h('div', { class: 't-corner' }, gear, keys), pop);
  root.addEventListener('pointerdown', (e) => {
    if (popKind && e.target instanceof Node && !pop.contains(e.target) && !gear.contains(e.target) && !keys.contains(e.target)) closePop();
  });

  root.append(h('div', { class: 't-fine' }, h('span', null, 'After the 1980 board game by Task Force Games'), h('span', { class: 'num' }, host.version)));

  // ---------------------------------------------------------- arrival: any key or click skips it
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) root.classList.add('settled');
  else {
    root.classList.add('arriving');
    const settle = () => root.classList.add('settled');
    setTimeout(settle, 1700);
    root.addEventListener('pointerdown', settle, { once: true });
  }

  // ---------------------------------------------------------- keys
  const onKey = (e: KeyboardEvent) => {
    if (!root.isConnected) return offKeys?.();
    root.classList.add('settled');
    const typing = e.target instanceof HTMLInputElement;
    if (e.key === 'Escape') {
      if (popKind) return closePop();
      const c = confirmEl as (HTMLElement & { keep?: () => void }) | null;
      if (c?.keep) return c.keep();
      return;
    }
    if (typing) return;
    if (e.key === '?' || e.key === 'F1') {
      e.preventDefault();
      return openPop('keys');
    }
    if ((e.key === 'n' || e.key === 'N') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      return askNew();
    }
    if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement) && !popKind && !confirmEl) {
      e.preventDefault();
      if (live) host.continueGame();
      else begin();
    }
  };
  addEventListener('keydown', onKey);
  offKeys = () => {
    removeEventListener('keydown', onKey);
    offKeys = null;
  };
}

// ------------------------------------------------------------ pieces

function purse(g: number): HTMLElement {
  return h('div', { class: 'purse', 'data-tip': `${g} gold in the purse` }, coinStack(g).el, h('span', { class: 'gold-n' }, `${g}`));
}

function heroMed(p: CardHero, lead: boolean, note?: string): HTMLElement {
  const sub = note ?? (p.taken ? 'Carried off' : p.down !== undefined ? `Down · ${p.down} left` : `${p.cls === 'heir' ? 'The heir' : className(p.cls)} · ${p.level}`);
  const tipText = `${p.name} · ${className(p.cls)}, level ${p.level}${p.down !== undefined ? `\nBleeding out: ${p.down} more of the castle's turns` : ''}${p.taken ? '\nCarried off by a crew' : ''}`;
  return h(
    'div',
    { class: `t-hero${p.down !== undefined || p.taken ? ' down' : ''}`, 'data-tip': tipText },
    h('div', { class: `t-hex${lead ? ' lead' : ''}`, style: `--c:var(--k-${bustKeyOf(p.cls)})` }, bust(p.cls, { size: lead ? 126 : 104, label: `${p.name}, ${className(p.cls)}` })),
    h('div', { class: 't-who' }, p.name, h('small', null, sub)),
  );
}

const KEY: Record<string, string> = { heir: 'heir', sellsword: 'sellsword', burglar: 'burglar', ranger: 'ranger', sapper: 'sapper', pyromancer: 'pyro', shadowmancer: 'shadow', hedgewitch: 'witch', mage: 'pyro' };
const bustKeyOf = (cls: string) => KEY[cls] ?? 'heir';

function cardPanel(card: CampaignCard, before: number, cont: HTMLElement): HTMLElement {
  const party = card.party.slice(0, 4);
  const facts: HTMLElement[] = [purse(card.gold)];
  if (card.kind === 'delve') {
    facts.push(h('div', { class: 't-fact', 'data-tip': 'Rounds of light left in the party\'s torches and lanterns' }, ic('torch'), h('span', null, h('span', { class: 'num' }, `${card.light ?? 0}`), ' rounds of light')));
    if (card.loot) facts.push(h('div', { class: 't-fact' }, ic('sack'), h('span', null, h('span', { class: 'num' }, `${card.loot}`), ' loot carried')));
    else facts.push(h('div', { class: 't-fact' }, ic('stairs'), 'In the castle'));
  } else {
    facts.push(h('div', { class: 't-fact', 'data-tip': 'Brother Aldric, Old Wim, Gerda and Ilse: who is home' }, ic('lantern'), h('span', null, h('span', { class: 'num' }, `${card.villagers}`), ` villager${card.villagers === 1 ? '' : 's'} home`)));
    facts.push(h('div', { class: 't-fact' }, ic('grave'), h('span', null, h('span', { class: 'num' }, `${card.graves}`), ' in the graves')));
  }
  return h(
    'section',
    { class: `panel t-card${party.length > 3 ? ' four' : ''}`, 'aria-label': 'Your campaign', 'data-card': card.kind },
    h('div', { class: 't-hd' }, h('div', { class: 'kick' }, before ? `Your campaign · run ${before + 1}` : 'Your campaign'), h('div', { class: 't-where' }, card.where)),
    h('div', { class: 't-row' }, ...party.map((p, i) => heroMed(p, i === 0 && p.cls === 'heir')), h('div', { class: 't-facts' }, ...facts)),
    h('div', { class: 't-go' }, cont),
  );
}

function lastRun(r: RunRecord, n: number): HTMLElement {
  const bits = [`${r.villagers} villager${r.villagers === 1 ? '' : 's'} home`, `${r.gold} gold`, `${r.graves} in the graves`];
  return h(
    'div',
    { class: 't-last', 'data-last-run': '1', 'data-tip': n > 1 ? runsTip([r]) : undefined },
    h('span', { class: 't-last-k' }, ic('grave'), n > 1 ? `Last of ${n} runs` : 'Last run'),
    h('span', { class: 't-last-l' }, runLine(r)),
    h('span', { class: 't-last-b' }, bits.join(' · ')),
  );
}

function runsTip(runs: RunRecord[]): string {
  return runs
    .slice(0, 5)
    .map((r) => `${runLine(r)} · ${r.villagers} home, ${r.gold} gold`)
    .join('\n');
}

function settingsRows(host: TitleHost, redraw: () => void): HTMLElement[] {
  const st = host.settings;
  const save = () => host.saveSettings();
  const check = (label: string, on: boolean, set: (v: boolean) => void, tipText = '') =>
    h('label', { class: 't-check', 'data-tip': tipText || undefined }, h('input', { type: 'checkbox', checked: on, onchange: (e: Event) => set((e.target as HTMLInputElement).checked) }), h('span', null, label));
  const seg = (label: string, opts: { label: string; on: boolean; pick: () => void; tip?: string }[]) =>
    h('div', { class: 't-seg-row' }, h('span', { class: 't-seg-k' }, label), h('span', { class: 't-seg' }, ...opts.map((o) => h('button', { type: 'button', class: o.on ? 'on' : '', 'aria-pressed': String(o.on), 'data-tip': o.tip, onclick: () => { o.pick(); redraw(); } }, o.label))));
  return [
    h('div', { class: 'kick' }, 'Settings'),
    seg('Playback', SPEEDS.map((sp) => ({ label: sp.label, on: st.speed === sp.value, pick: () => { st.speed = sp.value; save(); } }))),
    seg('Quality', (['high', 'low'] as const).map((q) => ({ label: q === 'high' ? 'High' : 'Low', on: (st.quality ?? 'high') === q, tip: q === 'high' ? 'High · shadows, bloom and the tilt-shift blur.' : 'Low · no shadows, bloom or blur; for slower machines.', pick: () => { st.quality = q; save(); } }))),
    check('Sound', !sfx.muted, (v) => sfx.setMuted(!v)),
    check('Action camera', st.actionCamera !== false, (v) => { st.actionCamera = v; save(); }, 'The camera pushes in on attacks, shots, spells and item use.'),
    check('Tilt-shift blur', st.tiltShift !== false, (v) => { st.tiltShift = v; save(); }, 'The diorama blur above and below the focus (High quality only).'),
    check('Reduce camera shake', st.reduceShake, (v) => { st.reduceShake = v; save(); }),
    check('Auto end turn', st.autoEndTurn !== false, (v) => { st.autoEndTurn = v; save(); }, 'When nobody can move, act or use anything, the turn ends on its own after a moment.'),
    check('Ask before ending a turn while someone can still act', !st.noEndTurnAsk, (v) => { st.noEndTurnAsk = !v; save(); }),
    check('Full hover cards (as if Alt were held)', !!st.fullCards, (v) => { st.fullCards = v; save(); }, 'For touch screens: every hover card shows its rules and numbers.'),
  ];
}

const GEAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></svg>';

/** Dusk: stars, the moon, Valkenburg on its crag with a few lit windows, the haze, Lowgate's roofs and its fire. */
function scene(): HTMLElement {
  const s = h('div', { class: 't-scene', 'aria-hidden': 'true' });
  s.innerHTML = `<div class="t-stars"></div><div class="t-moon"></div>
<svg class="t-castle" viewBox="0 0 1040 620"><g fill="#191a28"><rect x="560" y="200" width="44" height="200"/><polygon points="552,200 582,140 612,200"/><rect x="330" y="250" width="40" height="160"/><polygon points="324,250 350,200 376,250"/></g>
<path fill="#0d0e17" d="M40 620 L170 486 L250 452 L300 452 L300 360 L230 360 L230 300 L222 300 L222 282 L238 282 L238 292 L250 292 L250 282 L266 282 L266 292 L278 292 L278 282 L294 282 L294 300 L300 300 L300 360 L440 360 L440 346 L452 346 L452 360 L470 360 L470 168 L462 168 L462 150 L478 150 L478 160 L494 160 L494 150 L510 150 L510 160 L526 160 L526 150 L542 150 L542 160 L558 160 L558 150 L574 150 L574 168 L566 168 L566 360 L600 360 L600 346 L612 346 L612 360 L640 360 L640 236 L630 236 L668 172 L706 236 L696 236 L696 360 L760 360 L760 346 L772 346 L772 360 L820 360 L820 300 L812 300 L812 286 L824 286 L824 294 L836 294 L836 286 L848 286 L848 294 L860 294 L860 286 L872 286 L872 300 L866 300 L866 452 L900 470 L960 530 L1040 620 Z"/>
<polygon fill="#0d0e17" points="508,150 518,96 528,150"/><path fill="#000" opacity=".5" d="M420 452 h60 v-50 a30 30 0 0 0 -60 0 Z"/><path class="t-gate" fill="#ffb35c" opacity=".16" d="M426 452 h48 v-46 a24 24 0 0 0 -48 0 Z"/>
<g fill="#ffb35c"><rect class="t-win w1" x="512" y="210" width="10" height="16"/><rect class="t-win w2" x="512" y="262" width="10" height="16" style="--o:.55"/><rect class="t-win w3" x="660" y="262" width="8" height="13" style="--o:.7"/><rect class="t-win w4" x="258" y="320" width="8" height="12" style="--o:.45"/><rect class="t-win w5" x="838" y="330" width="8" height="12" style="--o:.6"/></g></svg>
<div class="t-haze"></div><div class="t-fire"></div>
<svg class="t-village" viewBox="0 0 1920 300" preserveAspectRatio="none"><path fill="#0a0705" d="M0 300 V190 L60 150 L120 190 V170 L190 120 L260 170 V200 L320 160 L380 200 V180 L450 140 L520 180 V210 L560 186 L600 210 V196 L670 150 L740 196 V220 L800 182 L860 220 V230 L940 200 L1010 230 V250 L1100 236 L1160 250 V262 H1400 V244 L1450 214 L1500 244 V200 L1570 150 L1640 200 V180 L1710 132 L1780 180 V196 L1850 160 L1920 196 V300 Z"/>
<g fill="#ffb35c"><rect x="180" y="200" width="14" height="18" opacity=".8"/><rect x="440" y="214" width="12" height="16" opacity=".5"/><rect x="660" y="226" width="12" height="16" opacity=".7"/><rect x="1560" y="226" width="14" height="18" opacity=".85"/><rect x="1700" y="214" width="12" height="16" opacity=".55"/></g>
<g class="t-flame"><path fill="#ffcf86" d="M1280 262 C1270 248 1276 236 1284 226 C1286 236 1294 238 1292 226 C1302 238 1304 252 1296 262 Z"/><path fill="#ff9a3c" opacity=".8" d="M1268 262 C1262 252 1266 244 1272 238 C1274 246 1280 248 1280 262 Z"/></g></svg>`;
  return s;
}
