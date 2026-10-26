// V4.0: Lowgate, the camp before a delve. One path of four steps along the top (Job, Party,
// Outfit, Set out), each clickable at any time; the Lowgate ribbon (houses, Keven's cart, the
// graves) and the step buttons along the bottom. Keven's cart and the graves are side pages.
// The party, packs, entrance and shutter are UI state (a Loadout) until Delve sends startDelve.

import type { Engine } from '../game/api';
import type { AleKind, Campaign, Captive, Command, Contract, GameState, Hero, Item, ShopOffer, StoryId, Village } from '../game/types';
import { ARMOR_PRICE, CLASSES, HEAL_PER_HP, PACK_SLOTS, SAPPER_CHARGES, STORIES, WEAPON_PRICE } from '../game/data';
import { distance, hexToWorld, parseHexKey } from '../game/hex';
import { sfx } from '../audio/sfx';
import { clear, gold, h } from './dom';
import {
  ALE, ALE_SHORT, CLASS_ABILITIES, CLASS_PLAN, CLASS_ROLE, CREW, ENTRANCE_LINE, EPITAPH, ITEM_EFFECT, PARTY_CAN, PEDDLER_PATTER, STORY, V37, WARE, WARE_GROUP,
  classGlyph, className, itemBase, itemGlyph, itemLabel, type AbilityChip, type AnyClass,
} from './names';

// ------------------------------------------------------------ types

export const STEPS = ['job', 'party', 'outfit', 'setout'] as const;
export type Step = (typeof STEPS)[number];
/** A page of the camp: one of the four steps, or a side page from the ribbon. */
export type CampPage = Step | 'cart' | 'graves';

export interface Loadout {
  contractId?: string;
  heroIds: string[];
  /** Stash item ids per hero. */
  packs: Record<string, string[]>;
  entrance: number;
  /** 16.2: shutter the lantern as the delve starts (Level 1 has daylight). */
  startShuttered?: boolean;
}

export interface CampHost {
  engine: Engine;
  send(cmd: Command): Promise<boolean>;
  /** The state after the last command (for what a purchase put on the cart). */
  state(): GameState | null;
  page: CampPage;
  setPage(p: CampPage): void;
  /** The loadout being put together on this visit to Lowgate. */
  draft: Loadout;
  setDraft(l: Loadout, page?: CampPage): void;
  /** The loadout of the last delve (for "Same as last time"). */
  lastLoadout: Loadout | null;
  saveLoadout(l: Loadout): void;
  /** V3.5 (18.7): what was won back on this return, until dismissed. */
  wonBack: StoryId[];
  dismissWonBack(page?: CampPage): void;
  /** The first-visit welcome card, until "Got it". */
  welcome: boolean;
  dismissWelcome(): void;
}

const STEP_NAME: Record<Step, string> = { job: 'Job', party: 'Party', outfit: 'Outfit', setout: 'Set out' };
const STEP_WHAT: Record<Step, string> = {
  job: 'Pick a contract from the notice post.',
  party: 'Who goes in: hire, heal, take up to four.',
  outfit: 'Fill the packs from the peddler and the cart.',
  setout: 'Which way in, the lantern, and Delve.',
};

// ------------------------------------------------------------ engine helpers (defensive: the engine agent adds these in parallel)

export interface EntranceInfo {
  index: number;
  name: string;
  state: 'open' | 'locked' | 'blocked';
  known: boolean;
  hint?: string;
}

type EngineV4 = Engine & {
  entrances?: (s: GameState) => EntranceInfo[];
  castleMemory?: (s: GameState) => { level: number; hexes: string[] }[];
};

/** The castle's ways in, as the party knows them. Fallback: only the main gate, open and known. */
export function entrancesOf(engine: Engine, s: GameState): EntranceInfo[] {
  const e = engine as EngineV4;
  if (typeof e.entrances === 'function') {
    try {
      const list = e.entrances(s);
      if (Array.isArray(list) && list.length) return list;
    } catch {
      /* fall back */
    }
  }
  const n = Math.max(1, engine.castle().entrances.length);
  return Array.from({ length: n }, (_, i) => ({ index: i, name: i === 0 ? 'Main gate' : `Entrance ${i + 1}`, state: 'open' as const, known: i === 0 }));
}

/** Hexes ("q,r") the campaign has explored, by level. Fallback: none (new players go in blind). */
export function memoryOf(engine: Engine, s: GameState): Map<number, Set<string>> {
  const e = engine as EngineV4;
  const out = new Map<number, Set<string>>();
  if (typeof e.castleMemory !== 'function') return out;
  try {
    for (const m of e.castleMemory(s) ?? []) {
      const set = out.get(m.level) ?? new Set<string>();
      for (const k of m.hexes ?? []) set.add(k);
      out.set(m.level, set);
    }
  } catch {
    /* none */
  }
  return out;
}

function selectable(ents: EntranceInfo[], i: number): boolean {
  return ents.some((x) => x.index === i && x.known && x.state === 'open');
}

// ------------------------------------------------------------ the loadout

const VALUABLE = new Set(['gem', 'jewelry', 'heirloom', 'hoard']);
const isValuable = (i: Item) => VALUABLE.has(i.kind) && !i.story;
const isHeir = (c: Campaign, id: string) => id === 'keven' || c.roster.find((x) => x.id === id)?.cls === 'heir';

/** Contracts in the order they are shown: village pleas, bounties, then "Bring back" jobs. */
export function boardOrder(c: Campaign): Contract[] {
  const cap = (k: Contract) => !!contractCaptive(c, k);
  return [...c.board.filter((k) => k.story), ...c.board.filter((k) => !k.story && !cap(k)), ...c.board.filter((k) => !k.story && cap(k))];
}

/** The loadout checked against the state: heroes on the roster, items on the cart, a selectable entrance. */
export function cleanLoadout(s: GameState, engine: Engine, l: Loadout | null): Loadout {
  const c = s.campaign;
  const prev = l ?? { heroIds: [], packs: {}, entrance: 0 };
  const contract = c.board.find((k) => k.id === prev.contractId) ?? boardOrder(c)[0];
  const heroIds = [...new Set(prev.heroIds)].filter((id) => c.roster.some((x) => x.id === id)).slice(0, 4);
  const packs: Record<string, string[]> = {};
  const used = new Set<string>();
  for (const id of heroIds) {
    const pack: string[] = [];
    let slots = 0;
    for (const iid of prev.packs?.[id] ?? []) {
      const it = c.stash.find((i) => i.id === iid);
      if (!it || used.has(iid) || slots + it.slots > PACK_SLOTS) continue;
      slots += it.slots;
      pack.push(iid);
      used.add(iid);
    }
    packs[id] = pack;
  }
  const ents = entrancesOf(engine, s);
  const entrance = selectable(ents, prev.entrance) ? prev.entrance : selectable(ents, 0) ? 0 : (ents.find((x) => x.known && x.state === 'open')?.index ?? 0);
  return { contractId: contract?.id, heroIds, packs, entrance, startShuttered: !!prev.startShuttered };
}

/** A new visit to Lowgate: the last party (still on the roster, Keven first), empty packs, the last way in. */
export function freshLoadout(s: GameState, engine: Engine, last: Loadout | null): Loadout {
  const c = s.campaign;
  let heroIds = (last?.heroIds ?? []).filter((id) => c.roster.some((x) => x.id === id));
  if (!heroIds.length) heroIds = [c.roster.find((x) => x.cls === 'heir')?.id ?? c.roster[0]?.id].filter((x): x is string => !!x);
  heroIds.sort((a, b) => Number(isHeir(c, b)) - Number(isHeir(c, a)));
  return cleanLoadout(s, engine, { heroIds, packs: {}, entrance: last?.entrance ?? 0, startShuttered: last?.startShuttered });
}

/** "Same as last time": the remembered loadout, if its heroes are all still on the roster. */
export function sameAsLast(s: GameState, last: Loadout | null): boolean {
  return !!last && last.heroIds.length > 0 && last.heroIds.every((id) => s.campaign.roster.some((x) => x.id === id));
}

function packItems(c: Campaign, l: Loadout, id: string): Item[] {
  return (l.packs[id] ?? []).map((iid) => c.stash.find((i) => i.id === iid)).filter((x): x is Item => !!x);
}
const slotsUsed = (items: Item[]) => items.reduce((a, i) => a + i.slots, 0);
function packedIds(l: Loadout): Set<string> {
  return new Set(Object.values(l.packs).flat());
}
function lanternBearer(l: Loadout): string | undefined {
  return l.heroIds.includes('keven') ? 'keven' : l.heroIds[0];
}

// ------------------------------------------------------------ small pieces

function cap(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const NUM_WORD = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];
function numWord(n: number): string {
  return NUM_WORD[n] ?? `${n}`;
}

function heroOf(c: Campaign, id: string): Hero | undefined {
  return c.roster.find((x) => x.id === id);
}
function hpOf(hr: Hero): number {
  return Math.min(hr.maxHp, hr.hp ?? hr.maxHp);
}
function hurt(hr: Hero): boolean {
  return hpOf(hr) < hr.maxHp;
}
function classLine(hr: Hero): string {
  return `${hr.cls === 'heir' ? 'The heir' : className(hr.cls)} · Level ${hr.level}`;
}

/** The class's stats, weapon, armor and mana (the badge's hover). */
function statsTip(cls: string, hr?: Hero): string {
  const def = CLASSES[cls as keyof typeof CLASSES];
  if (!def) return className(cls);
  const st = hr?.stats ?? def.stats;
  const w = def.weapon;
  const wStat = cap(w.stat);
  return `${className(cls)} · Might ${st.might}, Finesse ${st.finesse}, Wits ${st.wits}, Nerve ${st.nerve}\n${w.name}: ${w.slots} ${wStat} slots, ${w.dmg} damage${w.range ? `, range ${w.range}` : ''} · Armor ${def.armor}${def.mana ? ` · Mana ${def.mana}` : ''}`;
}

/** The hex class badge; focusable with its stats on hover when `tip` is set. */
function hexBadge(cls: string, size: 'sm' | 'md' | 'lg' = 'md', tip?: string): HTMLElement {
  return h('span', { class: `cbadge lg-hex lg-hex-${size} cls-${cls}`, 'data-tip': tip, tabindex: tip ? 0 : undefined, role: tip ? 'img' : undefined, 'aria-label': tip ? className(cls) : undefined, 'aria-hidden': tip ? undefined : 'true' }, classGlyph(cls));
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function svg(tag: string, attrs: Record<string, string | number>, ...kids: (SVGElement | string)[]): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const k of kids) el.append(k);
  return el as SVGElement;
}
const tick = (stroke = '#e8a33d', size = 14) => svg('svg', { width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': 'true' }, svg('path', { d: 'M3 8.5 L6.5 12 L13 4.5', fill: 'none', stroke, 'stroke-width': 2 }));
const heart = () => svg('svg', { width: 13, height: 12, viewBox: '0 0 13 12', 'aria-hidden': 'true' }, svg('path', { d: 'M6.5 11 L1.2 5.6 A3 3 0 0 1 6.5 2 A3 3 0 0 1 11.8 5.6 Z', fill: '#c0473a' }));
const warnTri = (stroke = '#e8a33d', size = 12) => svg('svg', { width: size, height: size, viewBox: '0 0 12 12', 'aria-hidden': 'true' }, svg('path', { d: 'M6 1 L11 10 H1 Z', fill: 'none', stroke, 'stroke-width': 1.3 }));
const coin = () => svg('svg', { width: 18, height: 18, viewBox: '0 0 18 18', 'aria-hidden': 'true' }, svg('circle', { cx: 9, cy: 9, r: 7.5, fill: 'none', stroke: '#d9a93a', 'stroke-width': 1.5 }), svg('circle', { cx: 9, cy: 9, r: 3.5, fill: 'none', stroke: '#d9a93a', 'stroke-width': 1.2 }));
const cartIcon = () => svg('svg', { width: 18, height: 16, viewBox: '0 0 18 16', 'aria-hidden': 'true' }, svg('path', { d: 'M1 4 H15 L13.5 11 H3 Z', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4 }), svg('circle', { cx: 5, cy: 14, r: 1.5, fill: 'none', stroke: 'currentColor' }), svg('circle', { cx: 12, cy: 14, r: 1.5, fill: 'none', stroke: 'currentColor' }));
const stoneIcon = () => svg('svg', { width: 14, height: 18, viewBox: '0 0 14 18', 'aria-hidden': 'true' }, svg('path', { d: 'M2 17 V7 A5 5 0 0 1 12 7 V17 Z', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4 }));
const lanternIcon = () => svg('svg', { width: 12, height: 16, viewBox: '0 0 12 16', 'aria-hidden': 'true' }, svg('path', { d: 'M3 4 H9 V13 H3 Z M4.5 1.5 H7.5 M6 1.5 V4', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.3 }));

/** A button that stays hoverable when it can't be used (the reason is its tooltip). */
function btn(attrs: { class?: string; tip?: string; off?: boolean; k?: string; data?: Record<string, string>; label?: string; onclick: () => void | Promise<void> }, ...kids: (Node | string)[]): HTMLButtonElement {
  const el = h('button', { type: 'button', class: `${attrs.class ?? 'btn'}${attrs.off ? ' is-off' : ''}`, 'data-tip': attrs.tip, 'aria-disabled': attrs.off ? 'true' : undefined, 'data-k': attrs.k, 'aria-label': attrs.label }, ...kids) as HTMLButtonElement;
  for (const [k, v] of Object.entries(attrs.data ?? {})) el.dataset[k] = v;
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    if (attrs.off) {
      sfx.play('error');
      return;
    }
    void attrs.onclick();
  });
  return el;
}

// ------------------------------------------------------------ tooltips (hover and keyboard focus)

function tipHtml(text: string, nums?: string): string {
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const [first = '', ...rest] = text.split('\n');
  const cut = first.indexOf(' · ');
  const kind = cut > 0 ? first.slice(cut + 3) : '';
  const short = kind.length > 0 && kind.length <= 22;
  const head = cut > 0 ? `<b>${esc(first.slice(0, cut))}</b>${short ? `<span class="lg-tip-kind">${esc(kind)}</span>` : ''}` : `<b>${esc(first)}</b>`;
  const lines = cut > 0 && !short ? [kind, ...rest] : rest;
  const body = lines.map((l) => `<span class="lg-tip-line">${esc(l)}</span>`).join('');
  return `<span class="lg-tip-head">${head}</span>${body}${nums ? `<span class="lg-tip-nums">${esc(nums)}</span>` : ''}`;
}

/** Every element with a data-tip (or title) in the camp gets the camp's own tooltip, on hover and on focus. */
export function installTips(root: HTMLElement): void {
  const tip = h('div', { class: 'lg-tip hidden', role: 'tooltip', id: 'lg-tip' });
  root.append(tip);
  let on: HTMLElement | null = null;
  const hide = () => {
    on?.removeAttribute('aria-describedby');
    on = null;
    tip.classList.add('hidden');
  };
  const show = (t: HTMLElement) => {
    if (t.hasAttribute('title')) {
      t.dataset.tip = t.getAttribute('title') ?? '';
      t.removeAttribute('title');
    }
    const text = t.dataset.tip ?? '';
    if (!text) return hide();
    on?.removeAttribute('aria-describedby');
    on = t;
    t.setAttribute('aria-describedby', 'lg-tip');
    tip.innerHTML = tipHtml(text, t.dataset.tipNums);
    tip.classList.remove('hidden');
    const r = t.getBoundingClientRect();
    const w = tip.offsetWidth;
    const th = tip.offsetHeight;
    const x = Math.max(8, Math.min(innerWidth - w - 8, r.left));
    const below = r.bottom + 8;
    const y = below + th > innerHeight - 8 ? Math.max(8, r.top - th - 8) : below;
    tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  };
  const find = (e: Event) => (e.target instanceof Element ? e.target.closest<HTMLElement>('[data-tip],[title]') : null);
  root.addEventListener('pointerover', (e) => {
    const t = find(e);
    if (!t || !root.contains(t)) return hide();
    if (t !== on) show(t);
  });
  root.addEventListener('pointerleave', hide);
  root.addEventListener('focusin', (e) => {
    const t = find(e);
    if (t && root.contains(t) && t.matches(':focus-visible')) show(t);
    else hide();
  });
  root.addEventListener('focusout', hide);
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
  });
  root.addEventListener('scroll', hide, true);
}

// ------------------------------------------------------------ the camp

/** UI state that lives between renders (not worth a save). */
const ui = {
  packFor: null as string | null,
  outfitTab: 'peddler' as 'peddler' | 'cart',
  alePick: null as string | null,
  lastStep: 'job' as Step,
};

export function campScreen(el: HTMLElement, s: GameState, host: CampHost): void {
  // Keep the scroll position and the focused control across re-renders of the same page.
  const old = el.querySelector<HTMLElement>('.lowgate');
  const keepScroll = old?.dataset.page === host.page ? (el.querySelector<HTMLElement>('.lg-main')?.scrollTop ?? 0) : 0;
  const focusKey = document.activeElement instanceof HTMLElement && el.contains(document.activeElement) ? document.activeElement.closest('[data-k]')?.getAttribute('data-k') : null;

  const l = cleanLoadout(s, host.engine, host.draft);
  if ((STEPS as readonly string[]).includes(host.page)) ui.lastStep = host.page as Step;
  if (!ui.packFor || !l.heroIds.includes(ui.packFor)) ui.packFor = l.heroIds[0] ?? null;

  clear(el);
  const root = h('div', { class: `lowgate lg-page-${host.page}`, 'data-page': host.page });
  const main = h('main', { class: 'lg-main', id: 'lg-main' });
  switch (host.page) {
    case 'job':
      jobStep(main, s, l, host);
      break;
    case 'party':
      partyStep(main, s, l, host);
      break;
    case 'outfit':
      outfitStep(main, s, l, host);
      break;
    case 'setout':
      setOutStep(main, s, l, host);
      break;
    case 'cart':
      cartPage(main, s, l, host);
      break;
    case 'graves':
      gravesPage(main, s);
      break;
  }
  root.append(header(s, l, host), main, footer(s, l, host));
  installTips(root);
  el.append(root);
  if (keepScroll) main.scrollTop = keepScroll;
  if (focusKey) root.querySelector<HTMLElement>(`[data-k="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
}

function goto(host: CampHost, p: CampPage): void {
  ui.alePick = null;
  sfx.play('click');
  host.setPage(p);
}

// ------------------------------------------------------------ header: the four steps and the gold

function stepSummary(s: GameState, l: Loadout, step: Step, host: CampHost): string {
  const c = s.campaign;
  switch (step) {
    case 'job':
      return c.board.find((k) => k.id === l.contractId)?.title ?? 'No jobs posted';
    case 'party': {
      if (!l.heroIds.length) return 'Nobody yet';
      if (l.heroIds.length === 1 && isHeir(c, l.heroIds[0]!)) return 'Keven alone';
      return l.heroIds.map((id) => heroOf(c, id)?.name ?? id).join(', ');
    }
    case 'outfit': {
      const n = l.heroIds.reduce((a, id) => a + (l.packs[id]?.length ?? 0), 0);
      return n ? `${n} item${n === 1 ? '' : 's'} packed` : 'Packs empty';
    }
    case 'setout':
      return entrancesOf(host.engine, s).find((x) => x.index === l.entrance)?.name ?? 'Main gate';
  }
}

function header(s: GameState, l: Loadout, host: CampHost): HTMLElement {
  const c = s.campaign;
  const left = h('div', { class: 'lg-brand', tabindex: 0, 'data-tip': `Lowgate · the village under the walls\nDelve ${c.delveCount + 1} is next. Keven camps here between delves.` }, h('div', { class: 'lg-kick' }, `Delve ${c.delveCount + 1} · under the walls`), h('div', { class: 'lg-title' }, 'Lowgate'));
  if (host.page === 'graves') {
    return h('header', { class: 'lg-head lg-head-graves' }, left, btn({ class: 'btn lg-btn', k: 'back-steps', onclick: () => goto(host, ui.lastStep) }, h('span', { 'aria-hidden': 'true' }, '←'), ' Back to the delve steps'));
  }
  const cur = STEPS.indexOf(host.page as Step);
  const nav = h('nav', { class: 'lg-steps', 'aria-label': 'Delve steps' });
  STEPS.forEach((st, i) => {
    if (i) nav.append(h('span', { class: `lg-link ${cur >= 0 && i <= cur ? 'done' : ''}`, 'aria-hidden': 'true' }));
    const here = st === host.page;
    const done = cur >= 0 && i < cur;
    const sub = stepSummary(s, l, st, host);
    nav.append(
      h(
        'button',
        { type: 'button', class: `lg-step ${here ? 'on' : ''} ${done ? 'done' : ''}`, 'data-step': st, 'data-k': `step-${st}`, 'aria-current': here ? 'step' : undefined, 'data-tip': `${STEP_NAME[st]} · step ${i + 1}\nNow: ${sub}\n${STEP_WHAT[st]}`, onclick: () => goto(host, st) },
        h('span', { class: 'lg-dot' }, done ? tick() : `${i + 1}`),
        h('span', { class: 'lg-step-t' }, h('span', { class: 'lg-step-n' }, STEP_NAME[st]), h('span', { class: 'lg-step-sub' }, sub)),
      ),
    );
  });
  const purse = h('div', { class: 'lg-gold', 'data-tip': `Gold · ${gold(c.gold)} in Keven's strongbox.\nBounties and sold valuables go in; hires, wares, healing and the forge come out.`, tabindex: 0 }, coin(), h('span', { class: 'lg-gold-n num' }, gold(c.gold)), h('span', { class: 'lg-gold-w' }, 'gold'));
  return h('header', { class: 'lg-head' }, left, nav, h('div', { class: 'lg-head-r' }, purse));
}

// ------------------------------------------------------------ footer: the Lowgate ribbon and the step buttons

interface House {
  id: string;
  story: StoryId;
  /** Extra lit windows (the Flagon: the copper and the cask book). */
  windows: StoryId[];
  name: string;
  place: string;
}
const HOUSES: House[] = [
  { id: 'chapel', story: 'surgeon', windows: [], name: "Brother Aldric's infirmary", place: 'chapel' },
  { id: 'flagon', story: 'innkeeper', windows: ['copper', 'caskbook'], name: 'The Gilded Flagon', place: 'Gilded Flagon' },
  { id: 'forge', story: 'smith', windows: [], name: "Gerda's forge", place: 'forge' },
];

function houseSvg(home: boolean, windows: boolean[] | null): SVGElement {
  const g = svg('svg', { width: 30, height: 28, viewBox: '0 0 30 28', 'aria-hidden': 'true' });
  if (!home) {
    g.append(svg('path', { d: 'M3 13 L15 3 L27 13 V26 H3 Z', fill: 'none', stroke: '#5a4c3f', 'stroke-width': 1.5 }), svg('path', { d: 'M9 16 L21 23 M9 23 L21 16', stroke: '#5a4c3f', 'stroke-width': 1.5 }));
    return g;
  }
  g.append(svg('path', { d: 'M3 13 L15 3 L27 13 V26 H3 Z', fill: '#1f1810', stroke: '#e8a33d', 'stroke-width': 1.5 }));
  if (!windows) g.append(svg('rect', { x: 11, y: 15, width: 8, height: 7, fill: '#ffb35c' }));
  else
    [6, 12.5, 19].forEach((x, i) => {
      const lit = i === 0 || !!windows[i - 1];
      g.append(svg('rect', { x, y: 15, width: 5, height: 6, fill: lit ? '#ffb35c' : '#120e0b', stroke: lit ? 'none' : '#5a4c3f', 'stroke-width': 0.8 }));
    });
  return g;
}

function ribbon(s: GameState, host: CampHost): HTMLElement {
  const c = s.campaign;
  const v = villageOf(s);
  const won = new Set(host.wonBack);
  const row = h('div', { class: 'lg-ribbon' }, h('span', { class: 'lg-kick lg-kick-dim', 'data-tip': 'Lowgate · The village under the walls. Its houses light up as its people come home.', tabindex: 0 }, 'Lowgate'));
  for (const hs of HOUSES) {
    const home = v[hs.story];
    const pleas = [hs.story, ...hs.windows].filter((id) => !v[id]).map((id) => c.board.find((k) => k.story === id)).filter((k): k is Contract => !!k);
    const plea = pleas[0];
    const lit = home && [hs.story, ...hs.windows].some((id) => won.has(id));
    const pic = houseSvg(home, hs.windows.length ? hs.windows.map((id) => v[id]) : null);
    const seal = plea ? h('span', { class: 'lg-seal lg-seal-sm', 'aria-hidden': 'true' }, '✦') : '';
    if (!home && !plea) {
      row.append(h('span', { class: 'lg-house boarded', 'data-house': hs.id, 'data-state': 'boarded', tabindex: 0, role: 'img', 'aria-label': 'A boarded-up house', 'data-tip': 'Boarded up.' }, pic));
      continue;
    }
    const plTip = plea ? `A plea for the ${plea.story === 'copper' || plea.story === 'caskbook' ? `${hs.place}'s ${plea.story === 'copper' ? 'brewing copper' : 'cask book'}` : hs.place} is pinned to the notice post.` : '';
    const tip = home ? `${hs.name} · ${STORY[hs.story].service}${hs.windows.filter((id) => v[id]).map((id) => `\n${STORY[id].service}`).join('')}${plTip ? `\n${plTip}` : ''}` : plTip;
    row.append(
      btn(
        {
          class: `lg-house ${home ? 'home' : 'boarded'} ${plea ? 'plea' : ''} ${lit ? 'won' : ''}`,
          k: `house-${hs.id}`,
          data: { house: hs.id, state: home ? 'home' : 'plea' },
          tip,
          label: home ? `${hs.name}, lit` : plTip,
          onclick: () => {
            if (plea) {
              sfx.play('click');
              host.setDraft({ ...host.draft, contractId: plea.id }, 'job');
            } else goto(host, STORY[hs.story].step);
          },
        },
        pic,
        seal,
      ),
    );
  }
  row.append(h('span', { class: 'lg-sep', 'aria-hidden': 'true' }));
  const stash = c.stash.length;
  row.append(
    btn({ class: `btn lg-ghost lg-rb ${host.page === 'cart' ? 'here' : ''}`, k: 'rb-cart', data: { ribbon: 'cart' }, tip: `Keven's cart · ${stash ? `${stash} thing${stash === 1 ? '' : 's'} on it` : 'Empty'}\nGear waits here until it goes in a pack; valuables wait to be sold.`, onclick: () => goto(host, 'cart') }, cartIcon(), "Keven's cart"),
    btn({ class: `btn lg-ghost lg-rb ${host.page === 'graves' ? 'here' : ''}`, k: 'rb-graves', data: { ribbon: 'graves' }, tip: c.fallen.length ? `The graves · ${numWord(c.fallen.length)} name${c.fallen.length === 1 ? '' : 's'} cut in the gatepost.` : 'The graves · No names yet.', onclick: () => goto(host, 'graves') }, stoneIcon(), 'The graves', c.fallen.length ? h('span', { class: 'lg-rb-n num' }, `${c.fallen.length}`) : ''),
  );
  return row;
}

function footer(s: GameState, l: Loadout, host: CampHost): HTMLElement {
  const right = h('div', { class: 'lg-foot-r' });
  const p = host.page;
  const next = (to: Step, label: string) => btn({ class: 'btn lg-btn lg-primary', k: `next-${to}`, data: { next: to }, onclick: () => goto(host, to) }, `Next: ${label} `, h('span', { 'aria-hidden': 'true' }, '→'));
  const back = (to: Step) => btn({ class: 'btn lg-ghost lg-back', k: `back-${to}`, data: { back: to }, onclick: () => goto(host, to) }, h('span', { 'aria-hidden': 'true' }, '←'), ` ${STEP_NAME[to]}`);
  if (p === 'job') {
    right.append(h('span', { class: 'lg-foot-hint' }, 'Next, choose who goes in.'));
    if (sameAsLast(s, host.lastLoadout)) right.append(sameButton(s, l, host));
    right.append(next('party', 'Party'));
  } else if (p === 'party') right.append(back('job'), next('outfit', 'Outfit'));
  else if (p === 'outfit') right.append(back('party'), next('setout', 'Set out'));
  else if (p === 'setout') right.append(back('outfit'), delveButton(s, l, host));
  else if (p === 'cart') right.append(btn({ class: 'btn lg-ghost lg-back', k: 'back-steps', onclick: () => goto(host, ui.lastStep) }, h('span', { 'aria-hidden': 'true' }, '←'), ` Back to ${STEP_NAME[ui.lastStep]}`));
  return h('footer', { class: 'lg-foot' }, ribbon(s, host), right);
}

function sameButton(s: GameState, l: Loadout, host: CampHost): HTMLElement {
  const last = host.lastLoadout!;
  const c = s.campaign;
  const names = last.heroIds.map((id) => heroOf(c, id)?.name ?? id).join(', ');
  const ents = entrancesOf(host.engine, s);
  return btn(
    {
      class: 'btn lg-btn lg-same',
      k: 'same',
      data: { same: '1' },
      tip: `Same as last time · ${names}\nThe same party, the same packs where the cart still has them, the same way in. Takes the job you've chosen and goes straight to Set out.`,
      onclick: () => {
        const next = cleanLoadout(s, host.engine, { contractId: l.contractId, heroIds: [...last.heroIds], packs: structuredClone(last.packs ?? {}), entrance: selectable(ents, last.entrance) ? last.entrance : 0, startShuttered: !!last.startShuttered });
        sfx.play('click');
        host.setDraft(next, 'setout');
      },
    },
    'Same as last time',
  );
}

function delveButton(s: GameState, l: Loadout, host: CampHost): HTMLElement {
  const c = s.campaign;
  const contract = c.board.find((k) => k.id === l.contractId);
  let problem: string | null = null;
  try {
    problem = host.engine.partyProblem(s, l.heroIds);
  } catch {
    problem = null;
  }
  if (!problem && !contract) problem = 'No job chosen.';
  if (!problem && !l.heroIds.length) problem = 'Pick at least one hero.';
  return btn(
    {
      class: 'btn lg-btn lg-primary lg-delve btn-delve',
      k: 'delve',
      off: !!problem,
      tip: problem ? `Not yet · ${problem}` : `Delve · ${contract!.title}`,
      onclick: async () => {
        const packs: Record<string, string[]> = {};
        for (const id of l.heroIds) packs[id] = l.packs[id] ?? [];
        host.saveLoadout(l);
        await host.send({ type: 'startDelve', contractId: contract!.id, heroIds: l.heroIds, entrance: l.entrance, packs });
      },
    },
    'Delve',
  );
}

// ------------------------------------------------------------ step 1: Job

const NO_VILLAGE: Village = { surgeon: false, innkeeper: false, smith: false, copper: false, caskbook: false };
export function villageOf(s: GameState): Village {
  return s.campaign.village ?? NO_VILLAGE;
}

/** V3.7 (20.4): the "Bring back" contract for a captive, if it is on the post (by site, else by title). */
export function captiveContract(c: Campaign, cp: Captive): Contract | undefined {
  return c.board.find((k) => k.kind === 'rescue' && (k.siteId === cp.siteId || k.title === `Bring back ${cp.hero.name}`));
}
/** The captive a contract brings back, if any. */
export function contractCaptive(c: Campaign, k: Contract): Captive | undefined {
  return (c.captives ?? []).find((cp) => captiveContract(c, cp)?.id === k.id);
}

function stepHead(title: string, sub: string, right?: HTMLElement): HTMLElement {
  return h('div', { class: 'lg-sh' }, h('div', { class: 'lg-sh-l' }, h('h2', { class: 'lg-h2' }, title), h('p', { class: 'lg-sub' }, sub)), right ?? '');
}

function welcomeCard(host: CampHost): HTMLElement {
  return h(
    'section',
    { class: 'lg-welcome', 'aria-label': 'Welcome' },
    h('div', { class: 'lg-seal lg-seal-lg', 'aria-hidden': 'true' }, '✦'),
    h(
      'div',
      { class: 'lg-welcome-t' },
      h('div', { class: 'lg-kick' }, "The heir's return"),
      h('p', { class: 'lg-welcome-story' }, "Lord Hobart is dead and Valkenburg has gone dark. His son Keven is back, camped in Lowgate under the walls, and the village's people are still inside."),
      h('p', { class: 'lg-welcome-how' }, "Every delve takes the four steps along the top: choose a job, pick a party, pack, set out. If Keven falls, it's over."),
    ),
    btn({ class: 'btn lg-btn', k: 'welcome-ok', data: { welcome: 'ok' }, onclick: () => host.dismissWelcome() }, 'Got it'),
  );
}

function wonBackBanner(host: CampHost): HTMLElement {
  const ids = host.wonBack;
  const last = ids[ids.length - 1]!;
  return h(
    'section',
    { class: 'lg-wonback', 'aria-label': 'Won back' },
    houseBig(),
    h(
      'div',
      { class: 'lg-wonback-t' },
      h('span', { class: 'lg-kick' }, 'Won back for Lowgate'),
      ...ids.map((id) => h('div', { class: 'lg-wb-item', 'data-story': id }, h('span', { class: 'lg-wb-head' }, STORY[id].home), h('span', { class: 'lg-wb-line' }, STORY[id].homeLine))),
    ),
    h(
      'div',
      { class: 'lg-wonback-b' },
      btn({ class: 'btn lg-btn lg-primary', k: 'wb-show', data: { wonback: 'show' }, tip: `Show me · ${STEP_NAME[STORY[last].step]}`, onclick: () => host.dismissWonBack(STORY[last].step) }, 'Show me'),
      btn({ class: 'btn lg-ghost', k: 'wb-later', data: { wonback: 'later' }, onclick: () => host.dismissWonBack() }, 'Later'),
    ),
  );
}
function houseBig(): SVGElement {
  return svg('svg', { width: 64, height: 58, viewBox: '0 0 30 28', 'aria-hidden': 'true', class: 'lg-wb-house' }, svg('path', { d: 'M3 13 L15 3 L27 13 V26 H3 Z', fill: '#2a1f12', stroke: '#e8a33d', 'stroke-width': 1.2 }), svg('rect', { x: 11, y: 15, width: 8, height: 7, fill: '#ffb35c' }));
}

function renown(rep: number): HTMLElement {
  const pips = h('span', { class: 'lg-pips', 'aria-hidden': 'true' }, ...[0, 1, 2].map((i) => h('i', { class: i < rep ? 'on' : '' })));
  const line = rep >= 3 ? 'Word has reached the deepest halls' : 'Deeper jobs go up as word spreads';
  return h('div', { class: 'lg-renown', tabindex: 0, 'data-tip': `Renown · ${Math.min(rep, 3)} of 3\nFinished jobs spread your name. Deeper jobs go up on the post as it grows; at full renown, someone pays for the Dragon.`, 'aria-label': `Renown ${Math.min(rep, 3)} of 3` }, h('span', { class: 'lg-kick lg-kick-dim' }, 'Renown'), pips, h('span', null, line));
}

function jobStep(main: HTMLElement, s: GameState, l: Loadout, host: CampHost): void {
  const c = s.campaign;
  if (host.wonBack.length) main.append(wonBackBanner(host));
  if (host.welcome) main.append(welcomeCard(host));
  main.append(stepHead('Choose a job', 'Bounties pay only if the prize comes out with you.', renown(c.reputation)));
  if (!c.board.length) {
    main.append(h('p', { class: 'lg-empty' }, 'Nothing on the notice post. Come back after the next delve.'));
    return;
  }
  const rescues = c.board.filter((k) => !k.story && contractCaptive(c, k));
  const grid = h('div', { class: 'lg-cards', role: 'group', 'aria-label': 'Jobs' });
  for (const k of [...c.board.filter((x) => x.story), ...c.board.filter((x) => !x.story && !rescues.includes(x))]) grid.append(contractCard(k, l, host));
  main.append(grid);
  if (rescues.length) {
    main.append(h('h3', { class: 'lg-h3 lg-captive-h', 'data-tip': "Taken by a crew · A crew dragged one of yours out. The hideout is theirs; the prisoner is your own hero, at 1 HP. Freed and brought out, they rejoin with their level and gear.", tabindex: 0 }, h('span', { class: 'lg-seal lg-seal-cap lg-seal-sm', 'aria-hidden': 'true' }, '⛓'), ' Taken by a crew'));
    const rg = h('div', { class: 'lg-cards', role: 'group', 'aria-label': 'Bring back' });
    for (const k of rescues) rg.append(contractCard(k, l, host, contractCaptive(c, k)));
    main.append(rg);
  }
}

const KIND_WORD: Record<Contract['kind'], string> = { rescue: 'Rescue', recover: 'Recover', slay: 'Slay' };

/** A contract's warnings as risk chips (without the ones that repeat the card's own lines). */
function riskChips(k: Contract, engine: Engine, captive?: Captive): HTMLElement[] {
  const crewNames = new Set(Object.values(CREW).map((x) => x.name));
  const storyUnlocks = k.story ? STORIES.find((x) => x.id === k.story)?.unlocks : undefined;
  const site = engine.castle().contractSites.find((x) => x.id === k.siteId);
  const out: HTMLElement[] = [];
  for (const w of k.warnings) {
    if (w === 'Story' || /^Unlocks/.test(w) || w === storyUnlocks) continue;
    if (/^Level \d+$/.test(w)) continue; // shown as "Rescue · Level 2"
    if (crewNames.has(w) || (captive && /HP 1/.test(w))) continue; // on the card's prisoner box
    const near = /^Nearby: (.+)$/.exec(w);
    if (near) {
      for (const m of near[1]!.split(/,\s*/)) {
        const plural = /s$/.test(m) && !/^the /.test(m);
        const a = /^the /.test(m) || plural ? '' : /^[aeiou]/.test(m) ? 'An ' : 'A ';
        const label = a ? `${a}${m} nearby` : `${cap(m)} nearby`;
        out.push(h('span', { class: 'lg-chip lg-risk', 'data-tip': `${cap(m)} · Scouts saw ${a ? a.toLowerCase() : ''}${m} near ${site?.where ?? 'the job'}.` }, warnTri(), label));
      }
      continue;
    }
    if (/^Heavy/.test(w)) {
      out.push(h('span', { class: 'lg-chip lg-risk', 'data-tip': `Heavy · ${w}. Whoever carries it moves 3 at most.` }, warnTri(), 'Heavy'));
      continue;
    }
    out.push(h('span', { class: 'lg-chip lg-risk', 'data-tip': w }, warnTri(), w));
  }
  return out;
}

function contractCard(k: Contract, l: Loadout, host: CampHost, captive?: Captive): HTMLElement {
  const st = k.story ? STORY[k.story] : null;
  const crew = captive ? CREW[captive.crew] : null;
  const chosen = l.contractId === k.id;
  const risks = riskChips(k, host.engine, captive);
  const card = h(
    'button',
    {
      type: 'button',
      class: `lg-card kind-${k.kind} ${st ? 'story' : ''} ${captive ? 'captive' : ''} ${chosen ? 'chosen' : ''}`,
      'aria-pressed': chosen ? 'true' : 'false',
      'data-contract': k.id,
      'data-story': k.story ?? '',
      'data-captive': captive?.hero.id ?? '',
      'data-k': `job-${k.id}`,
      onclick: () => {
        sfx.play('flip');
        host.setDraft({ ...l, contractId: k.id }, 'job');
      },
    },
    st ? h('span', { class: 'lg-seal lg-card-seal', 'aria-hidden': 'true' }, '✦') : '',
    captive ? h('span', { class: 'lg-seal lg-seal-cap lg-card-seal', 'aria-hidden': 'true' }, '⛓') : '',
    h('span', { class: `lg-kick ${st || captive ? '' : 'lg-kick-dim'}` }, st ? 'Pinned by the village' : captive ? `Taken by ${crew?.name ?? 'a crew'}` : 'Bounty'),
    h('span', { class: 'lg-card-row' }, h('span', { class: 'lg-card-kind' }, `${KIND_WORD[k.kind]} · Level ${k.level}`), h('span', { class: 'lg-bounty' }, h('span', { class: 'num' }, `${k.bounty}`), h('span', { class: 'lg-bounty-w' }, ' gold'))),
    h('span', { class: 'lg-card-title' }, k.title),
    h('span', { class: 'lg-card-brief' }, k.brief),
    st ? h('span', { class: 'lg-winsback', 'data-tip': `Wins back · ${st.unlocks}.\n${cap(st.who)} goes home to Lowgate, not ${k.kind === 'rescue' ? 'into your roster' : 'to the cart. It can\'t be sold'}.` }, h('span', { class: 'lg-kick' }, 'Wins back'), h('span', null, st.unlocks)) : '',
    captive
      ? h('span', { class: 'lg-winsback lg-prisoner', 'data-tip': `${captive.hero.name} · L${captive.hero.level} ${className(captive.hero.cls)}, taken on delve ${captive.delve}.\nHeld at ${crew?.name ?? 'the crew'}'s hideout${crew ? ` (${crew.where})` : ''} at 1 HP, with level and gear; gold and gems are gone. Freed and brought out, they rejoin the roster.` }, hexBadge(captive.hero.cls, 'sm'), h('span', null, h('span', { class: 'lg-kick' }, 'The prisoner is yours'), h('span', { class: 'lg-prisoner-n' }, `${captive.hero.name}, ${className(captive.hero.cls)} · 1 HP`)))
      : '',
    risks.length ? h('span', { class: 'lg-risks' }, ...risks) : '',
    h('span', { class: `lg-card-foot ${chosen ? 'on' : ''}` }, chosen ? tick('#ffcf86', 16) : '', chosen ? 'Chosen' : 'Choose'),
  );
  return card;
}

// ------------------------------------------------------------ step 2: Party

function partyStep(main: HTMLElement, s: GameState, l: Loadout, host: CampHost): void {
  const c = s.campaign;
  const v = villageOf(s);
  main.append(stepHead('Who goes in?', "Up to four. Keven can go alone, but if he falls, it's over."));
  const set = (next: Loadout) => host.setDraft(next, 'party');
  const slots = h('div', { class: 'lg-slots', role: 'list', 'aria-label': 'Party' });
  for (let i = 0; i < 4; i++) {
    const id = l.heroIds[i];
    const hr = id ? heroOf(c, id) : undefined;
    if (hr) slots.append(heroSlot(hr, s, l, host, set));
    else {
      const first = i === l.heroIds.length;
      const bench = c.roster.some((x) => !l.heroIds.includes(x.id));
      slots.append(h('div', { class: `lg-slot empty ${first ? 'first' : ''}`, role: 'listitem', 'data-slot': `${i}` }, h('span', { class: 'lg-slot-e' }, 'Empty'), first && c.recruits.length ? h('span', { class: 'lg-slot-h' }, 'Hire someone below.') : first && bench ? h('span', { class: 'lg-slot-h' }, 'Add someone from your roster.') : ''));
    }
  }
  main.append(slots);

  const bench = c.roster.filter((x) => !l.heroIds.includes(x.id));
  if (bench.length) {
    const full = l.heroIds.length >= 4;
    main.append(
      h(
        'div',
        { class: 'lg-bench' },
        h('span', { class: 'lg-kick lg-kick-dim' }, 'Your roster'),
        ...bench.map((hr) =>
          btn(
            {
              class: `lg-benchhero ${hurt(hr) ? 'wounded' : ''}`,
              k: `bench-${hr.id}`,
              data: { bench: hr.id },
              off: full,
              tip: full ? `${hr.name} · The party is full. Take someone out first.` : `${hr.name} · ${classLine(hr)}\n${hpOf(hr)} of ${hr.maxHp} HP. Click to take them along.`,
              onclick: () => {
                sfx.play('click');
                const next = structuredClone(l);
                next.heroIds.push(hr.id);
                if (isHeir(c, hr.id)) next.heroIds.sort((a, b) => Number(isHeir(c, b)) - Number(isHeir(c, a)));
                set(next);
              },
            },
            hexBadge(hr.cls, 'sm'),
            h('span', { class: 'lg-bh-n' }, hr.name),
            h('span', { class: 'lg-bh-c' }, classLine(hr)),
            hurt(hr) ? h('span', { class: 'lg-bh-hp' }, `${hpOf(hr)}/${hr.maxHp} HP`) : '',
            h('span', { class: 'lg-bh-add', 'aria-hidden': 'true' }, '+'),
          ),
        ),
      ),
    );
  }

  main.append(partyCan(s, l));

  const flagon = v.innkeeper;
  const n = c.recruits.length;
  const sub = flagon
    ? `Old Wim's regulars. Some have been inside before.${v.caskbook ? ' The old hands are back too.' : ''} New faces after every delve.`
    : `${numWord(n)} drifter${n === 1 ? '' : 's'} warm${n === 1 ? 's' : ''} their hands. Green and cheap. New faces after every delve.`;
  main.append(
    h(
      'div',
      { class: 'lg-sh lg-sh-sm' },
      h('div', { class: 'lg-sh-l' }, h('h3', { class: 'lg-h3' }, flagon ? 'At the Gilded Flagon' : 'At the campfire'), h('p', { class: 'lg-sub' }, sub)),
      n ? h('span', { class: 'lg-sub' }, l.heroIds.length < 4 ? 'Hired hands go straight into a free slot.' : 'The party is full: hired hands wait on the roster.') : '',
    ),
  );
  if (!n) main.append(h('p', { class: 'lg-empty' }, 'Nobody looking for work. Come back after the next delve.'));
  else {
    const grid = h('div', { class: 'lg-recruits', style: `--cols:${Math.min(4, Math.max(3, n))}` });
    for (const r of c.recruits) grid.append(recruitCard(r.hero, r.price, s, l, host));
    main.append(grid);
  }
}

function heroSlot(hr: Hero, s: GameState, l: Loadout, host: CampHost, set: (l: Loadout) => void): HTMLElement {
  const c = s.campaign;
  const v = villageOf(s);
  const heir = isHeir(c, hr.id);
  const hp = hpOf(hr);
  const wounded = hp < hr.maxHp;
  const kids: (HTMLElement | string)[] = [];
  if (wounded) {
    const low = hp * 3 <= hr.maxHp;
    kids.push(
      h(
        'span',
        { class: 'lg-hpbar-row', 'data-tip': `${hr.name} · ${hp} of ${hr.maxHp} HP\nWounds don't mend between delves. ${v.surgeon ? `Brother Aldric heals for ${HEAL_PER_HP} gold per HP.` : 'A potion from the cart heals 5.'}` },
        h('span', { class: 'lg-hpbar', 'aria-hidden': 'true' }, h('i', { style: `width:${Math.round((hp / hr.maxHp) * 100)}%` })),
        h('span', { class: `lg-hpw ${low ? 'low' : ''}` }, h('span', { class: 'num' }, `${hp}`), ' of ', h('span', { class: 'num' }, `${hr.maxHp}`), ' HP'),
      ),
    );
    const btns = h('span', { class: 'lg-heal' });
    if (v.surgeon) {
      const missing = hr.maxHp - hp;
      const can = Math.min(missing, Math.floor(c.gold / HEAL_PER_HP));
      const full = missing * HEAL_PER_HP;
      const label = can > 0 && can < missing ? `Heal ${can} of ${missing} HP · ` : 'Heal · ';
      btns.append(
        btn(
          {
            class: 'btn lg-btn-s lg-primary',
            k: `heal-${hr.id}`,
            data: { heal: hr.id },
            off: !can,
            tip: !can ? `Heal · ${full} gold\nYou have ${c.gold} gold.` : can < missing ? `Heal · ${can * HEAL_PER_HP} gold\nBrother Aldric heals ${can} of the ${missing} HP: all your gold covers. ${HEAL_PER_HP} gold per HP.` : `Heal · ${full} gold\nBrother Aldric patches ${hr.name} up to full: ${HEAL_PER_HP} gold per HP.`,
            onclick: async () => {
              if (await host.send({ type: 'heal', heroId: hr.id })) sfx.play('spell');
            },
          },
          label,
          h('span', { class: 'num' }, `${can > 0 ? can * HEAL_PER_HP : full}`),
          ' gold',
        ),
      );
    }
    const pots = c.stash.filter((i) => i.kind === 'potion').length;
    if (pots)
      btns.append(
        btn(
          {
            class: 'btn lg-btn-s',
            k: `drink-${hr.id}`,
            data: { drink: hr.id },
            tip: `Drink a potion · ${hr.name} heals ${Math.min(5, hr.maxHp - hp)} HP\n${pots} on the cart. A drunk potion doesn't go in.`,
            onclick: async () => {
              if (await host.send({ type: 'drink', heroId: hr.id })) sfx.play('spell', { pitch: 0.9 });
            },
          },
          'Drink a potion',
        ),
      );
    if (btns.childElementCount) kids.push(btns);
  } else {
    kids.push(h('span', { class: 'lg-hp', 'data-tip': `${hr.name} · ${hp} HP, unhurt.` }, heart(), h('span', { class: 'num' }, `${hp}`), ' HP'));
  }
  if (heir) kids.push(h('span', { class: 'lg-heirwarn' }, "If he falls, it's over."));
  return h(
    'div',
    { class: `lg-slot hero ${heir ? 'heir' : ''} ${wounded ? 'wounded' : ''}`, role: 'listitem', 'data-hero': hr.id },
    h(
      'span',
      { class: 'lg-slot-top' },
      hexBadge(hr.cls, 'lg', statsTip(hr.cls, hr)),
      h('span', { class: 'lg-slot-t' }, h('span', { class: 'lg-slot-n' }, hr.name), h('span', { class: 'lg-slot-c' }, classLine(hr)), hr.ale ? h('span', { class: 'lg-slot-ale', 'data-tip': `${ALE[hr.ale].name} · drunk when ${hr.name} starts the next delve\n${ALE[hr.ale].text}` }, `${ALE[hr.ale].glyph} ${ALE[hr.ale].name}`) : ''),
      btn(
        {
          class: 'lg-x',
          k: `out-${hr.id}`,
          data: { out: hr.id },
          label: `Leave ${hr.name} in Lowgate`,
          tip: `Leave ${hr.name} in Lowgate · They stay on the roster.${heir ? "\nA party can go in without Keven. If they fall, it isn't over." : ''}`,
          onclick: () => {
            sfx.play('click');
            const next = structuredClone(l);
            next.heroIds = next.heroIds.filter((x) => x !== hr.id);
            delete next.packs[hr.id];
            set(next);
          },
        },
        '×',
      ),
    ),
    ...kids,
  );
}

/** "This party can": chips lit when someone going in brings it. */
function partyCan(s: GameState, l: Loadout): HTMLElement {
  const c = s.campaign;
  const party = l.heroIds.map((id) => heroOf(c, id)).filter((x): x is Hero => !!x);
  const row = h('div', { class: 'lg-can', role: 'list', 'aria-label': 'This party can' }, h('span', { class: 'lg-kick lg-kick-dim' }, 'This party can'));
  for (const cap of PARTY_CAN) {
    let who: string[];
    if (cap.id === 'melee') who = party.filter((x) => !CLASSES[x.cls]?.weapon.range).map((x) => `${x.name} (${CLASSES[x.cls]?.weapon.name.toLowerCase() ?? 'blade'})`);
    else if (cap.id === 'locks')
      who = party.filter((x) => x.cls === 'burglar' || packItems(c, l, x.id).some((i) => itemBase(i.kind) === 'lockpicks')).map((x) => (x.cls === 'burglar' ? x.name : `${x.name} (lockpicks)`));
    else who = party.filter((x) => (cap.classes as string[]).includes(x.cls)).map((x) => x.name);
    const yes = who.length > 0;
    row.append(h('span', { class: `lg-canchip ${yes ? 'yes' : 'no'}`, role: 'listitem', tabindex: 0, 'data-can': cap.id, 'data-tip': yes ? `${cap.label} · ${who.join(', ')}` : `${cap.label} · Nobody going in.\nWho brings it: ${cap.who}` }, yes ? tick('#e8a33d', 12) : '', cap.label));
  }
  return row;
}

function abilityChips(cls: string, host: CampHost): AbilityChip[] {
  const mine = CLASS_ABILITIES[cls as AnyClass];
  if (mine?.length) return mine;
  try {
    return host.engine.classInfo(cls as Hero['cls']).abilities.map((line) => {
      const m = /^([^:(]+)(?:\([^)]*\))?:?\s*(.*)$/.exec(line);
      return { name: (m?.[1] ?? line).trim(), kind: 'Ability' as const, plain: m?.[2] ?? '', nums: '' };
    });
  } catch {
    return [];
  }
}

function recruitCard(hr: Hero, price: number, s: GameState, l: Loadout, host: CampHost): HTMLElement {
  const c = s.campaign;
  const plan = CLASS_PLAN[hr.cls as AnyClass];
  let role = CLASS_ROLE[hr.cls as AnyClass] ?? '';
  try {
    role = host.engine.classInfo(hr.cls).role || role;
  } catch {
    /* names.ts */
  }
  const short = c.gold < price;
  return h(
    'article',
    { class: `lg-rc cls-${hr.cls}`, 'data-recruit': hr.id },
    h('div', { class: 'lg-rc-top' }, hexBadge(hr.cls, 'lg', statsTip(hr.cls, hr)), h('div', { class: 'lg-rc-who' }, h('span', { class: 'lg-rc-n' }, hr.name), h('span', { class: 'lg-rc-c' }, `${className(hr.cls)} · Level ${hr.level}`)), plan ? h('span', { class: 'lg-chip lg-plantag', 'data-tip': `${plan.tag} · what a ${className(hr.cls)} is for` }, plan.tag) : ''),
    h('p', { class: 'lg-rc-role' }, role),
    plan ? h('div', { class: 'lg-rc-best' }, h('span', { class: 'lg-kick' }, 'Best at'), h('span', null, plan.best)) : '',
    h(
      'div',
      { class: 'lg-abs' },
      ...abilityChips(hr.cls, host).map((a) => h('button', { type: 'button', class: 'lg-ab', 'data-tip': `${a.name} · ${a.kind}\n${a.plain}`, 'data-tip-nums': a.nums || undefined, 'data-ability': a.name }, a.name)),
    ),
    h(
      'div',
      { class: 'lg-rc-foot' },
      h('span', { class: 'lg-hp', 'data-tip': `${hr.name} · ${hr.maxHp} HP` }, heart(), h('span', { class: 'num' }, `${hr.maxHp}`), ' HP'),
      btn(
        {
          class: 'btn lg-btn lg-primary lg-hire',
          k: `hire-${hr.id}`,
          data: { hire: hr.id },
          off: short,
          tip: short ? `Hire · ${price} gold\nYou have ${c.gold} gold.` : `Hire ${hr.name} · ${price} gold\n${l.heroIds.length < 4 ? 'Goes straight into a free party slot.' : 'The party is full: they wait on the roster.'}`,
          onclick: async () => {
            if (!(await host.send({ type: 'hire', heroId: hr.id }))) return;
            sfx.play('coin');
            if (l.heroIds.length < 4) host.setDraft({ ...structuredClone(l), heroIds: [...l.heroIds, hr.id] }, 'party');
          },
        },
        'Hire · ',
        h('span', { class: 'num' }, `${price}`),
      ),
    ),
  );
}

// ------------------------------------------------------------ step 3: Outfit

function outfitStep(main: HTMLElement, s: GameState, l: Loadout, host: CampHost): void {
  const c = s.campaign;
  const v = villageOf(s);
  const wrap = h('div', { class: 'lg-outfit' });
  const left = h('section', { class: 'lg-packs', 'aria-label': 'Packs' });
  const extras = v.smith || (v.innkeeper && v.copper);
  left.append(
    h(
      'div',
      { class: 'lg-sh-l' },
      h('h2', { class: 'lg-h2' }, 'Pack for the castle'),
      h('p', { class: 'lg-sub' }, extras ? `${[v.smith ? "Gerda's forge" : '', v.innkeeper && v.copper ? "Wim's taps" : ''].filter(Boolean).join(' and ')} ${v.smith && v.innkeeper && v.copper ? 'are' : 'is'} open: ${v.smith && v.innkeeper && v.copper ? 'gear and ales' : v.smith ? 'gear' : 'ales'} now live on each hero too.` : 'Four slots each. Pick a hero; what you buy goes in their pack.'),
    ),
  );
  if (!l.heroIds.length) left.append(h('p', { class: 'lg-empty' }, 'Nobody is going in yet. Pick a party first.'));
  for (const id of l.heroIds) {
    const hr = heroOf(c, id);
    if (hr) left.append(loadoutCard(hr, s, l, host));
  }
  left.append(h('p', { class: 'lg-note' }, "Whatever you take in and don't bring out is lost. What you bring out goes on Keven's cart."));

  const right = h('section', { class: 'lg-where', 'aria-label': 'Where to get gear' });
  const cartN = c.stash.filter((i) => !packedIds(l).has(i.id)).length;
  const tabs = h(
    'div',
    { class: 'lg-tabs', role: 'tablist' },
    h('button', { type: 'button', role: 'tab', class: `lg-tab ${ui.outfitTab === 'peddler' ? 'on' : ''}`, 'aria-selected': ui.outfitTab === 'peddler' ? 'true' : 'false', 'data-tab': 'peddler', 'data-k': 'tab-peddler', onclick: () => ((ui.outfitTab = 'peddler'), host.setPage('outfit')) }, "The peddler's wagon"),
    h('button', { type: 'button', role: 'tab', class: `lg-tab ${ui.outfitTab === 'cart' ? 'on' : ''}`, 'aria-selected': ui.outfitTab === 'cart' ? 'true' : 'false', 'data-tab': 'cart', 'data-k': 'tab-cart', onclick: () => ((ui.outfitTab = 'cart'), host.setPage('outfit')) }, "Keven's cart ", h('span', { class: 'lg-tab-n num' }, cartN ? `${cartN}` : 'empty')),
  );
  const body = h('div', { class: 'lg-tabbody', role: 'tabpanel' });
  if (ui.outfitTab === 'peddler') peddler(body, s, l, host);
  else cartBody(body, s, l, host, 'outfit');
  right.append(tabs, body);
  wrap.append(left, right);
  main.append(wrap);
}

function packSlots(c: Campaign, l: Loadout, hr: Hero, host: CampHost, page: CampPage): HTMLElement {
  const items = packItems(c, l, hr.id);
  const row = h('div', { class: 'lg-sl-row', 'aria-label': `${hr.name}'s pack` });
  let used = 0;
  for (const it of items) {
    const span = Math.min(it.slots, PACK_SLOTS - used);
    used += span;
    row.append(
      btn(
        {
          class: `lg-sl full ${span > 1 ? 'two' : ''} ${isValuable(it) ? 'val' : ''}`,
          k: `pk-${it.id}`,
          data: { packed: it.id, kind: it.kind },
          label: `${itemLabel(it)}, back to the cart`,
          tip: `${itemLabel(it)} · back to the cart\n${isValuable(it) ? `Worth ${it.amount} gold. A crew takes it as payment.` : (ITEM_EFFECT[itemBase(it.kind)] ?? it.name)}`,
          onclick: () => {
            sfx.play('click');
            const next = structuredClone(l);
            next.packs[hr.id] = (next.packs[hr.id] ?? []).filter((x) => x !== it.id);
            host.setDraft(next, page);
          },
        },
        h('span', { class: 'lg-g', 'aria-hidden': 'true' }, itemGlyph(it.kind)),
        h('span', { class: 'lg-sl-n' }, it.kind === 'gem' || it.kind === 'jewelry' ? it.name : itemLabel(it)),
      ),
    );
  }
  for (let i = used; i < PACK_SLOTS; i++) row.append(h('span', { class: 'lg-sl empty', 'aria-hidden': 'true' }));
  return row;
}

/** V4.0 (spec 26.5): class kit the hero brings of their own, under the 4 slots (Burglar, Sapper). */
function kitLine(hr: Hero): HTMLElement | '' {
  const k = hr.cls === 'sapper' ? { kind: 'improvised-charge', what: `${SAPPER_CHARGES} improvised explosives` } : hr.cls === 'burglar' ? { kind: 'improvised', what: 'improvised pick' } : null;
  if (!k) return '';
  return h(
    'p',
    { class: 'lg-kit', tabindex: 0, 'data-kit': k.kind, 'data-tip': `${hr.name}'s own · ${k.what}\nDoesn't take a slot; can't be given away. A fresh ${k.kind === 'improvised' ? 'one' : 'set'} every delve.\n${ITEM_EFFECT[k.kind] ?? ''}` },
    h('span', { class: 'lg-g', 'aria-hidden': 'true' }, itemGlyph(k.kind)),
    `Brings their own: ${k.what}`,
    h('span', { class: 'lg-kit-s' }, ' · no slot'),
  );
}

function loadoutCard(hr: Hero, s: GameState, l: Loadout, host: CampHost): HTMLElement {
  const c = s.campaign;
  const v = villageOf(s);
  const sel = ui.packFor === hr.id;
  const bearer = lanternBearer(l) === hr.id;
  const pick = () => {
    if (ui.packFor === hr.id) return;
    ui.packFor = hr.id;
    sfx.play('click');
    host.setPage('outfit');
  };
  const card = h('div', { class: `lg-hero ${sel ? 'sel' : ''}`, role: 'group', 'aria-label': hr.name, 'data-hero': hr.id, 'aria-current': sel ? 'true' : undefined });
  card.addEventListener('click', (e) => {
    if (e.target instanceof Element && e.target.closest('button,[role=dialog]')) return;
    pick();
  });
  card.append(
    h(
      'div',
      { class: 'lg-hero-top' },
      hexBadge(hr.cls, 'md', statsTip(hr.cls, hr)),
      h('span', { class: 'lg-hero-n' }, hr.name),
      bearer ? h('span', { class: 'lg-lantern', tabindex: 0, 'data-tip': `Lantern · The lantern goes with ${hr.name}.\nIt is the party's clock: it burns down each round while open. Oil tops it up.` }, lanternIcon(), 'Lantern') : '',
      sel ? h('span', { class: 'lg-kick lg-packing' }, 'Packing') : btn({ class: 'lg-pickpack', k: `pack-${hr.id}`, data: { packfor: hr.id }, tip: `${hr.name} · What you buy or take off the cart goes in this pack.`, onclick: pick }, 'Pick to pack'),
    ),
    packSlots(c, l, hr, host, 'outfit'),
    kitLine(hr),
  );
  // The forge and the Flagon, once won back.
  if (v.smith || (v.innkeeper && v.copper)) {
    const gear = h('div', { class: 'lg-gear-row' });
    if (v.smith) {
      const part = (p: 'weapon' | 'armor') => {
        const tier = p === 'weapon' ? hr.weaponTier : hr.armorTier;
        const price = tier >= 2 ? null : (p === 'weapon' ? WEAPON_PRICE : ARMOR_PRICE)[tier + 1]!;
        const word = p === 'weapon' ? 'Blade' : 'Mail';
        const what = p === 'weapon' ? 'Each tier adds +10% per slot to every weapon roll.' : 'Each tier soaks 1 more damage per hit.';
        const short = price !== null && c.gold < price;
        return btn(
          {
            class: 'lg-gear',
            k: `gear-${p}-${hr.id}`,
            data: { upgrade: p, hero: hr.id },
            off: price === null || short,
            tip: price === null ? `${word} · tier 2 of 2\nThe best Gerda makes. ${what}` : `${word} · tier ${tier} of 2\n${what} Tier ${tier + 1}: ${price} gold.${short ? `\nYou have ${c.gold} gold.` : ''}`,
            onclick: async () => {
              if (await host.send({ type: 'upgrade', heroId: hr.id, part: p })) sfx.play('smash', { pitch: 2, gain: 0.4 });
            },
          },
          h('span', { class: 'lg-gl' }, word, h('span', { class: 'lg-pips-s', 'aria-label': `tier ${tier} of 2` }, h('i', { class: `lg-pip ${tier >= 1 ? 'on' : ''}` }), h('i', { class: `lg-pip ${tier >= 2 ? 'on' : ''}` }))),
          h('span', { class: `lg-gear-p ${price === null ? 'dim' : ''}` }, price === null ? 'The best' : [tier === 0 ? 'Forge · ' : 'Hone · ', h('span', { class: 'num' }, `${price}`)]),
        );
      };
      gear.append(part('weapon'), part('armor'));
      const shieldPrice = V37.shieldPrice;
      gear.append(
        hr.shield
          ? h('div', { class: 'lg-gear have', tabindex: 0, 'data-tip': `Shield · carried\nRanged hits on ${hr.name} do 1 less; 2 less while braced. Not the Dragon's breath.` }, h('span', { class: 'lg-gl' }, 'Shield'), h('span', { class: 'lg-gear-p dim' }, 'Carried'))
          : btn(
              {
                class: 'lg-gear',
                k: `shield-${hr.id}`,
                data: { shield: hr.id },
                off: c.gold < shieldPrice,
                tip: `Shield · ${shieldPrice} gold\nRanged hits do 1 less; 2 less while braced. Any class.${c.gold < shieldPrice ? `\nYou have ${c.gold} gold.` : ''}`,
                onclick: async () => {
                  if (await host.send({ type: 'buyShield', heroId: hr.id })) sfx.play('smash', { pitch: 1.6, gain: 0.4 });
                },
              },
              h('span', { class: 'lg-gl' }, 'Shield'),
              h('span', { class: 'lg-gear-p' }, 'Buy · ', h('span', { class: 'num' }, `${shieldPrice}`)),
            ),
      );
    }
    if (v.innkeeper && v.copper) {
      const open = ui.alePick === hr.id;
      gear.append(
        hr.ale
          ? h('div', { class: 'lg-gear have ale', tabindex: 0, 'data-tip': `${ALE[hr.ale].name} · drunk when ${hr.name} starts the next delve\n${ALE[hr.ale].text}` }, h('span', { class: 'lg-gl' }, 'Ale'), h('span', { class: 'lg-gear-p' }, ALE[hr.ale].name))
          : btn(
              {
                class: `lg-gear ${open ? 'open' : ''}`,
                k: `ale-${hr.id}`,
                data: { ale: hr.id },
                tip: `Ale · one per hero, drunk as they start the next delve. It lasts that delve.`,
                onclick: () => {
                  ui.alePick = open ? null : hr.id;
                  host.setPage('outfit');
                },
              },
              h('span', { class: 'lg-gl' }, 'Ale'),
              h('span', { class: 'lg-gear-p' }, 'Pour one'),
            ),
      );
      if (open && !hr.ale) {
        const pk = alePicker(hr, s, host);
        card.append(pk);
        requestAnimationFrame(() => {
          pk.scrollIntoView({ block: 'nearest' });
          pk.querySelector<HTMLElement>('button:not(.is-off)')?.focus({ preventScroll: true });
        });
      }
    }
    card.append(gear);
  }
  return card;
}

function alePicker(hr: Hero, s: GameState, host: CampHost): HTMLElement {
  const c = s.campaign;
  let offers: ReturnType<Engine['ales']> = [];
  try {
    offers = host.engine.ales(s).filter((o) => !o.locked);
  } catch {
    offers = [];
  }
  const close = () => {
    ui.alePick = null;
    host.setPage('outfit');
  };
  const box = h(
    'div',
    { class: 'lg-alepick', role: 'dialog', 'aria-label': `Pour an ale for ${hr.name}` },
    h('span', { class: 'lg-alepick-h' }, h('b', null, `The Flagon's taps, for ${hr.name}`), h('span', { class: 'lg-sub' }, 'one per delve')),
    ...offers.map((o) => {
      const a = ALE[o.kind as AleKind];
      const short = c.gold < o.price;
      return btn(
        {
          class: 'lg-alerow',
          k: `pour-${o.kind}`,
          data: { pour: o.kind },
          off: short,
          tip: `${o.name || a.name} · ${o.price} gold\n${a.text}${short ? `\nYou have ${c.gold} gold.` : ''}`,
          onclick: async () => {
            ui.alePick = null;
            if (await host.send({ type: 'buyAle', heroId: hr.id, ale: o.kind })) sfx.play('coin', { pitch: 0.8 });
            else host.setPage('outfit');
          },
        },
        h('span', { class: 'lg-alerow-t' }, h('span', { class: 'lg-alerow-n' }, `${a.glyph} ${o.name || a.name}`), h('span', { class: 'lg-alerow-e' }, ALE_SHORT[o.kind as AleKind] ?? a.text)),
        h('span', { class: 'num lg-price' }, `${o.price}`),
      );
    }),
    btn({ class: 'btn lg-ghost lg-btn-s', k: 'ale-close', onclick: close }, 'Not now'),
  );
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  return box;
}

function peddler(el: HTMLElement, s: GameState, l: Loadout, host: CampHost): void {
  const c = s.campaign;
  const v = villageOf(s);
  const who = ui.packFor ? heroOf(c, ui.packFor) : undefined;
  el.append(
    h(
      'div',
      { class: 'lg-mott' },
      h('div', { class: 'lg-mott-face', 'aria-hidden': 'true' }, 'M'),
      h('div', { class: 'lg-mott-t' }, h('span', { class: 'lg-mott-n' }, 'Mott, by the gate'), h('span', { class: 'lg-mott-say' }, `"${PEDDLER_PATTER[c.delveCount % PEDDLER_PATTER.length]}"`)),
    ),
  );
  const offers = host.engine.shop(s);
  const packed = packedIds(l);
  const metal = offers.filter((o) => o.needs === 'smith');
  const order = ['torch', 'oil', 'potion', 'nightsight', 'rope', 'charge', 'hook', 'key', 'lockpicks', 'dart', 'smoke', 'glue', 'firecracker', 'caltrops'];
  const shown = offers.filter((o) => !o.locked).sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  for (const g of ['light', 'around', 'quiet'] as const) {
    const list = shown.filter((o) => (WARE[o.kind]?.group ?? 'around') === g);
    const tiles: HTMLElement[] = list.map((o) => wareTile(o, s, l, host, who, packed));
    if (g === 'around' && !v.smith && metal.length)
      tiles.push(h('div', { class: 'lg-ware metal', tabindex: 0, 'data-ware': 'metalwork', 'data-tip': `Metalwork · ${metal.map((o) => o.name).join(', ')}.\nThey need a smith.` }, h('span', { class: 'lg-wtop' }, h('span', { class: 'lg-wg dashed', 'aria-hidden': 'true' }, '⚿'), h('span', { class: 'lg-wn' }, 'Metalwork')), h('span', { class: 'lg-we' }, 'Hooks, keys and picks need a smith. Nobody in Lowgate works steel any more.')));
    if (!tiles.length) continue;
    el.append(h('div', { class: 'lg-kick lg-kick-dim lg-wgroup' }, WARE_GROUP[g]), h('div', { class: 'lg-wares' }, ...tiles));
  }
}

function wareTile(o: ShopOffer, s: GameState, l: Loadout, host: CampHost, who: Hero | undefined, packed: Set<string>): HTMLElement {
  const c = s.campaign;
  const mine = c.stash.filter((i) => i.kind === o.kind);
  const nPacked = mine.filter((i) => packed.has(i.id)).length;
  const nCart = mine.length - nPacked;
  const short = c.gold < o.price;
  const fits = who ? slotsUsed(packItems(c, l, who.id)) + 1 <= PACK_SLOTS : false;
  const where = who ? (fits ? `Goes in ${who.name}'s pack.` : `${who.name}'s pack is full: it goes on the cart.`) : "Goes on Keven's cart.";
  const rule = ITEM_EFFECT[itemBase(o.kind)] ?? o.text;
  return btn(
    {
      class: `lg-ware ${short ? 'dear' : ''} ${nPacked ? 'has' : ''}`,
      k: `ware-${o.kind}`,
      data: { ware: o.kind },
      off: short,
      tip: `${o.name} · ${o.price} gold\n${rule}\n${short ? `You have ${c.gold} gold.` : where}`,
      onclick: async () => {
        const before = new Set(c.stash.map((i) => i.id));
        if (!(await host.send({ type: 'buy', kind: o.kind }))) return;
        sfx.play('coin');
        const now = host.state();
        const it = now?.campaign.stash.find((i) => !before.has(i.id));
        if (it && who && slotsUsed(packItems(now!.campaign, l, who.id)) + it.slots <= PACK_SLOTS) {
          const next = structuredClone(l);
          (next.packs[who.id] ??= []).push(it.id);
          host.setDraft(next, 'outfit');
        }
      },
    },
    h('span', { class: 'lg-wtop' }, h('span', { class: 'lg-wg', 'aria-hidden': 'true' }, itemGlyph(o.kind)), h('span', { class: 'lg-wn' }, o.name), h('span', { class: 'lg-wp num' }, `${o.price}`)),
    h('span', { class: 'lg-we' }, WARE[o.kind]?.short ?? o.text),
    nPacked || nCart ? h('span', { class: 'lg-badges' }, nPacked ? h('span', { class: 'lg-badge on' }, `${nPacked} packed`) : '', nCart ? h('span', { class: 'lg-badge' }, `${nCart} on the cart`) : '') : '',
  );
}

// ------------------------------------------------------------ Keven's cart (Outfit tab and side page)

function groupGear(items: Item[]): [Item, Item[]][] {
  const m = new Map<string, [Item, Item[]]>();
  for (const i of items) {
    const e = m.get(i.kind);
    if (e) e[1].push(i);
    else m.set(i.kind, [i, [i]]);
  }
  return [...m.values()];
}

const VAL_WORD: Record<string, string> = { gem: 'Gem', jewelry: 'Jewelry', heirloom: 'Heirloom', hoard: "From the Dragon's hoard" };

function cartBody(el: HTMLElement, s: GameState, l: Loadout, host: CampHost, page: CampPage): void {
  const c = s.campaign;
  const packed = packedIds(l);
  const who = ui.packFor ? heroOf(c, ui.packFor) : undefined;
  const whoUsed = who ? slotsUsed(packItems(c, l, who.id)) : PACK_SLOTS;
  const pack = (it: Item) => {
    if (!who) return;
    sfx.play('click');
    const next = structuredClone(l);
    (next.packs[who.id] ??= []).push(it.id);
    host.setDraft(next, page);
  };
  const gear = c.stash.filter((i) => !isValuable(i) && i.kind !== 'gold' && !i.story && !packed.has(i.id));
  el.append(h('div', { class: 'lg-cart-h' }, h('span', { class: 'lg-kick' }, 'Gear · goes in packs'), h('span', { class: 'lg-sub' }, who ? `Click to pack it for ${who.name}` : 'Pick a party to pack for')));
  if (!gear.length) el.append(h('p', { class: 'lg-empty sm' }, packed.size ? 'Everything here is packed.' : "No gear on the cart. The peddler's wagon has some."));
  else
    el.append(
      h(
        'div',
        { class: 'lg-gearlist' },
        ...groupGear(gear).map(([it, all]) => {
          const full = whoUsed + it.slots > PACK_SLOTS;
          return btn(
            {
              class: 'lg-row lg-cartgear',
              k: `cart-${it.kind}`,
              data: { cart: it.kind },
              off: !who || full,
              tip: `${it.name} · ${all.length} on the cart\n${ITEM_EFFECT[itemBase(it.kind)] ?? ''}\n${!who ? 'Nobody to pack it for.' : full ? `${who.name}'s pack is full.` : `Click: into ${who.name}'s pack.`}`,
              onclick: () => pack(it),
            },
            h('span', { class: 'lg-wg', 'aria-hidden': 'true' }, itemGlyph(it.kind)),
            h('span', { class: 'lg-row-n' }, it.name),
            h('span', { class: 'num lg-row-x' }, `×${all.length}`),
          );
        }),
      ),
    );

  el.append(h('div', { class: 'lg-rule', 'aria-hidden': 'true' }));
  const vals = c.stash.filter(isValuable);
  el.append(h('div', { class: 'lg-cart-h' }, h('span', { class: 'lg-kick lg-kick-gold' }, 'Valuables · worth gold'), h('span', { class: 'lg-sub' }, 'Sell them, or pack a few to pay off a crew.')));
  if (!vals.length) {
    el.append(h('p', { class: 'lg-empty sm' }, 'No valuables. Gems and trinkets you carry out land here.'));
    return;
  }
  const owner = (id: string) => l.heroIds.find((hid) => (l.packs[hid] ?? []).includes(id));
  el.append(
    h(
      'div',
      { class: 'lg-vallist' },
      ...vals.map((it) => {
        const o = owner(it.id);
        const full = whoUsed + it.slots > PACK_SLOTS;
        return h(
          'div',
          { class: `lg-row lg-val ${o ? 'packed' : ''}`, 'data-valuable': it.id, 'data-kind': it.kind },
          h('span', { class: 'lg-wg gold', 'aria-hidden': 'true' }, itemGlyph(it.kind)),
          h('span', { class: 'lg-row-t' }, h('span', { class: 'lg-row-n' }, it.name), h('span', { class: 'lg-row-s' }, `${VAL_WORD[it.kind] ?? 'Valuable'}${it.slots > 1 ? ' · takes 2 slots' : ''}${o ? ` · packed for ${heroOf(c, o)?.name ?? o}` : ''}`)),
          h('span', { class: 'num lg-val-v' }, `${host.engine.value([it])}`),
          o
            ? ''
            : btn({ class: 'btn lg-ghost lg-btn-s', k: `packval-${it.id}`, data: { packval: it.id }, off: !who || full, tip: !who ? 'Pack · Nobody to pack it for.' : full ? `Pack · ${who.name}'s pack is full.` : `Pack · into ${who.name}'s pack\nCrews take gems and trinkets as payment.`, onclick: () => pack(it) }, 'Pack'),
          btn({ class: 'btn lg-btn-s', k: `sell-${it.id}`, data: { sell: it.id }, tip: `Sell · ${it.name} for ${host.engine.value([it])} gold${o ? `\nIt comes out of ${heroOf(c, o)?.name ?? o}'s pack.` : ''}`, onclick: async () => {
            if (await host.send({ type: 'sell', itemId: it.id })) sfx.play('coin');
          } }, 'Sell'),
        );
      }),
    ),
  );
  const worth = host.engine.value(vals);
  const nPacked = vals.filter((i) => owner(i.id)).length;
  el.append(
    h(
      'div',
      { class: 'lg-sellall' },
      h('span', null, `Sells the ${vals.length === 1 ? 'valuable' : `${numWord(vals.length).toLowerCase()} valuables`} above${nPacked ? ', packed ones too' : ''}. Gear stays on the cart.`),
      btn(
        {
          class: 'btn lg-btn lg-primary',
          k: 'sellall',
          data: { sellall: '1' },
          tip: `Sell all · ${worth} gold\n${vals.map((i) => `${i.name}: ${i.amount}`).join('\n')}`,
          onclick: async () => {
            if (await host.send({ type: 'sellAll' })) sfx.play('coin');
          },
        },
        'Sell all · ',
        h('span', { class: 'num' }, `${worth}`),
        ' gold',
      ),
    ),
  );
}

function cartPage(main: HTMLElement, s: GameState, l: Loadout, host: CampHost): void {
  const c = s.campaign;
  main.append(stepHead("Keven's cart", `${gold(c.gold)} gold in the strongbox. Gear waits here until it goes in a pack; valuables wait to be sold.`));
  if (l.heroIds.length > 1) {
    main.append(
      h(
        'div',
        { class: 'lg-bench lg-packfor' },
        h('span', { class: 'lg-kick lg-kick-dim' }, 'Packing for'),
        ...l.heroIds.map((id) => {
          const hr = heroOf(c, id)!;
          return btn({ class: `lg-benchhero ${ui.packFor === id ? 'on' : ''}`, k: `cpf-${id}`, data: { packfor: id }, tip: `${hr.name} · What you take off the cart goes in this pack.`, onclick: () => ((ui.packFor = id), host.setPage('cart')) }, hexBadge(hr.cls, 'sm'), h('span', { class: 'lg-bh-n' }, hr.name));
        }),
      ),
    );
  }
  const who = ui.packFor ? heroOf(c, ui.packFor) : undefined;
  const box = h('div', { class: 'lg-cartpage' });
  if (who) box.append(h('div', { class: 'lg-cartpack' }, h('span', { class: 'lg-kick lg-kick-dim' }, `${who.name}'s pack`), packSlots(c, l, who, host, 'cart')));
  const body = h('div', { class: 'lg-tabbody lg-cartbody' });
  cartBody(body, s, l, host, 'cart');
  box.append(body);
  main.append(box);
}

// ------------------------------------------------------------ step 4: Set out

function setOutStep(main: HTMLElement, s: GameState, l: Loadout, host: CampHost): void {
  const c = s.campaign;
  const castle = host.engine.castle();
  const ents = entrancesOf(host.engine, s).filter((x) => x.known);
  const open = ents.filter((x) => x.state === 'open');
  const mem = memoryOf(host.engine, s);
  const contract = c.board.find((k) => k.id === l.contractId);
  const site = contract ? castle.contractSites.find((x) => x.id === contract.siteId) : undefined;
  const siteKnown = !!site && !!mem.get(site.at.level)?.has(`${site.at.q},${site.at.r}`);
  let closest: number | null = null;
  if (siteKnown && open.length > 1) {
    let best = Infinity;
    for (const e of open) {
      const p = castle.entrances[e.index];
      if (!p) continue;
      const d = distance(p, site!.at);
      if (d < best) ((best = d), (closest = e.index));
    }
  }
  const left = h('section', { class: 'lg-setout-l', 'aria-label': 'Entrance and lantern' });
  const lvl1 = castle.levels.find((x) => x.level === 1)?.name ?? 'the castle';
  left.append(stepHead('How do you go in?', open.length > 1 ? `${numWord(open.length)} ways into ${lvl1.replace(/^The /, 'the ')} that you know of. Each one is also a way out.` : 'The main gate is the only way in anyone knows. It is also the way out.'));
  left.append(sketch(s, l, host, ents, mem, siteKnown ? site!.at : null));
  const group = h('div', { class: 'lg-ents', role: 'radiogroup', 'aria-label': 'Entrance' });
  for (const e of ents) {
    const ok = e.state === 'open';
    const on = ok && l.entrance === e.index;
    const line = ok ? (ENTRANCE_LINE[e.name] ?? e.hint ?? '') : (e.hint ?? (e.state === 'locked' ? 'Locked.' : 'Blocked.'));
    group.append(
      h(
        'button',
        {
          type: 'button',
          role: 'radio',
          class: `lg-ent ${on ? 'on' : ''} ${ok ? '' : 'shut'}`,
          'aria-checked': on ? 'true' : 'false',
          'aria-disabled': ok ? undefined : 'true',
          'data-entrance': `${e.index}`,
          'data-k': `ent-${e.index}`,
          'data-tip': ok ? `${e.name} · ${on ? 'the way in' : 'go in here'}\nWhere you go in is also a way out.` : `${e.name} · ${e.state}\n${line}`,
          onclick: () => {
            if (!ok) return sfx.play('error');
            sfx.play('click');
            host.setDraft({ ...l, entrance: e.index }, 'setout');
          },
        },
        h('span', { class: 'lg-ent-top' }, h('span', { class: 'lg-ent-n' }, e.name), closest === e.index ? h('span', { class: 'lg-kick' }, 'Closest to the job') : !ok ? h('span', { class: 'lg-kick lg-kick-dim' }, e.state === 'locked' ? 'Locked' : 'Blocked') : ''),
        line ? h('span', { class: 'lg-ent-l' }, line) : '',
      ),
    );
  }
  left.append(group);
  const box = h('input', { type: 'checkbox', class: 'lg-check', 'data-k': 'shutter', checked: !!l.startShuttered }) as HTMLInputElement;
  box.addEventListener('change', () => host.setDraft({ ...l, startShuttered: box.checked }, 'setout'));
  left.append(h('label', { class: 'lg-shutter prep-shutter' }, box, h('span', { class: 'lg-shutter-t' }, h('span', { class: 'lg-shutter-n' }, 'Go in with the lantern shut'), h('span', { class: 'lg-sub' }, 'Level 1 has daylight. A shut lantern burns no oil; open it when it gets dark.'))));

  main.append(h('div', { class: 'lg-setout' }, left, plan(s, l, host)));
}

function sketch(s: GameState, l: Loadout, host: CampHost, ents: EntranceInfo[], mem: Map<number, Set<string>>, site: { level: number; q: number; r: number } | null): HTMLElement {
  const castle = host.engine.castle();
  const lv = castle.levels.find((x) => x.level === 1);
  const known = mem.get(1);
  if (!lv || !known?.size) {
    return h('div', { class: 'lg-sketch none', 'data-sketch': 'none' }, h('span', { class: 'lg-sketch-none' }, "You've never been inside. All anyone knows is the main gate."));
  }
  void s;
  const W = 620;
  const H = 250;
  const hexes = [...known].map(parseHexKey);
  const pts = hexes.map((x) => hexToWorld(x));
  const entPts = ents.map((e) => ({ e, p: castle.entrances[e.index] })).filter((x) => x.p && x.p.level === 1);
  for (const x of entPts) pts.push(hexToWorld(x.p!));
  const minX = Math.min(...pts.map((p) => p.x)) - 1;
  const maxX = Math.max(...pts.map((p) => p.x)) + 1;
  const minZ = Math.min(...pts.map((p) => p.z)) - 1;
  const maxZ = Math.max(...pts.map((p) => p.z)) + 1;
  const sc = Math.min((W - 60) / (maxX - minX), (H - 50) / (maxZ - minZ));
  const ox = (W - (maxX - minX) * sc) / 2;
  const oz = (H - (maxZ - minZ) * sc) / 2;
  const at = (q: number, r: number) => {
    const w = hexToWorld({ q, r });
    return { x: ox + (w.x - minX) * sc, y: oz + (w.z - minZ) * sc };
  };
  const g = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, role: 'img', 'aria-label': 'Sketch of what you have seen of Level 1, with the ways in you know' });
  const rr = sc * 0.97;
  const corners = (cx: number, cy: number) =>
    [0, 1, 2, 3, 4, 5]
      .map((i) => {
        const a = (Math.PI / 180) * (60 * i - 30);
        return `${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`;
      })
      .join(' ');
  const solid = new Set(['wall', 'pillar', 'cracked', 'sealed', 'tallprop', 'brazier']);
  for (const hx of hexes) {
    const t = lv.tiles[`${hx.q},${hx.r}`];
    if (!t) continue;
    const p = at(hx.q, hx.r);
    const fill = solid.has(t.kind) ? '#4a3f35' : t.kind === 'pit' ? '#070606' : t.kind === 'exit' ? '#3a2a12' : '#211b17';
    g.append(svg('polygon', { points: corners(p.x, p.y), fill }));
  }
  const entNames = new Set(ents.map((e) => e.name.toLowerCase()));
  for (const room of lv.rooms) {
    if (!known.has(`${room.labelAt.q},${room.labelAt.r}`) || entNames.has(room.name.toLowerCase())) continue;
    const p = at(room.labelAt.q, room.labelAt.r);
    g.append(svg('text', { x: p.x.toFixed(1), y: p.y.toFixed(1), fill: '#8a7f6e', 'font-family': 'IM Fell English, Georgia, serif', 'font-size': 13, 'text-anchor': 'middle' }, room.name));
  }
  if (site && site.level === 1) {
    const p = at(site.q, site.r);
    g.append(svg('circle', { cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: 8, fill: '#8f1018' }), svg('text', { x: p.x.toFixed(1), y: (p.y + 4).toFixed(1), fill: '#ffcf86', 'font-size': 11, 'text-anchor': 'middle' }, '✦'));
  }
  for (const { e, p } of entPts) {
    const q = at(p!.q, p!.r);
    const on = e.index === l.entrance;
    const ok = e.state === 'open';
    g.append(
      svg('rect', { x: (q.x - 7).toFixed(1), y: (q.y - 7).toFixed(1), width: 14, height: 14, fill: on ? '#3a2a12' : '#0b0908', stroke: on ? '#e8a33d' : ok ? '#8a7f6e' : '#5a4c3f', 'stroke-width': on ? 2.5 : 1.5, 'stroke-dasharray': ok ? '' : '3 2' }),
      svg('text', { x: q.x.toFixed(1), y: (q.y + 22).toFixed(1), fill: on ? '#ffcf86' : '#b8ab94', 'font-family': 'IM Fell English, Georgia, serif', 'font-size': 13, 'text-anchor': 'middle' }, e.name),
    );
  }
  return h('div', { class: 'lg-sketch', 'data-sketch': 'level1' }, g);
}

function plan(s: GameState, l: Loadout, host: CampHost): HTMLElement {
  const c = s.campaign;
  const k = c.board.find((x) => x.id === l.contractId);
  const st = k?.story ? STORY[k.story] : null;
  const bearer = lanternBearer(l);
  const box = h('aside', { class: 'lg-plan', 'aria-label': 'The plan' }, h('div', { class: 'lg-kick' }, 'The plan'));
  box.append(
    k
      ? h('div', { class: 'lg-plan-job' }, h('span', { class: 'lg-plan-t' }, k.title), h('span', { class: 'lg-plan-s' }, h('span', { class: 'num lg-goldtxt' }, `${k.bounty}`), ` gold${st ? ` · wins back ${st.unlocks.charAt(0).toLowerCase()}${st.unlocks.slice(1)}` : ''}`), h('span', { class: 'lg-plan-s' }, k.brief))
      : h('div', { class: 'lg-plan-job' }, h('span', { class: 'lg-plan-s' }, 'No job chosen.')),
  );
  const who = h('div', { class: 'lg-plan-who' });
  if (!l.heroIds.length) who.append(h('span', { class: 'lg-plan-s' }, 'Nobody is going in.'));
  for (const id of l.heroIds) {
    const hr = heroOf(c, id);
    if (!hr) continue;
    const carry = [...(bearer === id ? ['Lantern'] : []), ...packItems(c, l, id).map((i) => (i.kind === 'gem' || i.kind === 'jewelry' ? i.name : itemLabel(i)))];
    who.append(h('div', { class: 'lg-plan-hero', 'data-hero': id }, hexBadge(hr.cls, 'sm'), h('span', { class: 'lg-plan-n' }, hr.name), h('span', { class: 'lg-plan-c' }, carry.length ? carry.join(' · ') : 'Nothing packed')));
  }
  box.append(who);
  const keven = l.heroIds.some((id) => isHeir(c, id));
  if (keven) {
    const alone = l.heroIds.length === 1;
    box.append(h('div', { class: 'lg-plan-warn warn-heir' }, warnTri('#ff8a8f', 16), h('span', null, alone ? "Keven goes in alone. If he falls, it's over." : 'Keven goes in. If he falls, the campaign ends with him.')));
  }
  let problem: string | null = null;
  try {
    problem = host.engine.partyProblem(s, l.heroIds);
  } catch {
    problem = null;
  }
  if (problem) box.append(h('div', { class: 'lg-plan-warn' }, warnTri('#ff8a8f', 16), h('span', null, problem)));
  box.append(h('span', { class: 'lg-plan-s dim' }, 'Every step stays open: click one along the top to change it.'));
  return box;
}

// ------------------------------------------------------------ the graves

function gravesPage(main: HTMLElement, s: GameState): void {
  const f = s.campaign.fallen;
  const n = f.length;
  main.append(
    h(
      'div',
      { class: 'lg-graves' },
      h('div', { class: 'lg-kick lg-kick-dim' }, 'Outside the north gate'),
      h('h1', { class: 'lg-graves-h' }, 'The graves'),
      h('p', { class: 'lg-graves-sub' }, n ? `${numWord(n)} name${n === 1 ? '' : 's'} cut in the old gatepost, and a row of mounds below it.` : 'The old gatepost, and nothing cut in it yet.'),
      n
        ? h(
            'div',
            { class: 'lg-stones' },
            ...f.map((x, i) => {
              const newest = i === n - 1;
              const room = x.where.replace(/^Level \d+,\s*/, '');
              const place = /^the /i.test(room) ? room : `the ${room}`;
              return h(
                'div',
                { class: `lg-grave ${newest ? 'newest' : ''}`, 'data-fallen': x.name },
                h(
                  'div',
                  { class: `lg-stone cls-${x.cls}`, tabindex: 0, 'data-tip': `${x.name} · ${className(x.cls)}, level ${x.level}\nFell on delve ${x.delve}: ${x.where}.` },
                  h('div', { class: 'lg-carve', 'aria-hidden': 'true' }, classGlyph(x.cls)),
                  h('span', { class: 'lg-stone-n' }, x.name),
                  h('span', { class: 'lg-stone-c' }, `${className(x.cls)} · Level ${x.level}`),
                  h('span', { class: 'lg-stone-o', 'aria-hidden': 'true' }, '— ✦ —'),
                  h('span', { class: 'lg-stone-w' }, `Fell in ${place}`),
                  h('span', { class: 'lg-stone-d' }, `Delve ${x.delve}${newest && n > 1 ? ' · the newest' : ''}`),
                  h('span', { class: 'lg-stone-e' }, EPITAPH[x.cls as AnyClass] ?? ''),
                ),
                h('div', { class: 'lg-mound' }, h('div', { class: 'lg-candle' }, h('div', { class: 'lg-flame' }))),
              );
            }),
          )
        : h('p', { class: 'lg-graves-none' }, 'No names yet. Keep it that way.'),
      n ? h('p', { class: 'lg-graves-note' }, 'What they carried still lies where they fell. Some of it may turn up again.') : '',
    ),
  );
}
