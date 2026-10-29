// V5.1 (W0): what more than one camp screen uses: the camp's types, engine and loadout helpers, small pieces,
// tooltips and the camp's between-render UI state. Split out of src/ui/lowgate.ts unchanged.

import type { Engine } from '../../game/api';
import type { Campaign, Captive, Command, Contract, GameState, Hero, Item, StoryId, Village } from '../../game/types';
import { CLASSES, PACK_SLOTS, squadSlots } from '../../game/data';
import { sfx } from '../../audio/sfx';
import { h } from '../dom';
import { classGlyph, className } from '../names';
import type { VendorId } from '../vendors';

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
  /** 16.2: shutter the lantern as the delve starts. V4.1 (WS2): retired (an old remembered loadout may still have it; ignored). */
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

export const STEP_NAME: Record<Step, string> = { job: 'Job', party: 'Party', outfit: 'Outfit', setout: 'Set out' };

export const STEP_WHAT: Record<Step, string> = {
  job: 'Pick a contract from the notice post.',
  party: 'Who goes in: hire, heal, pick the party.',
  outfit: 'Buy from the vendors, pack from the cart.',
  setout: 'Which way in, and Delve.',
};

export interface EntranceInfo {
  index: number;
  name: string;
  state: 'open' | 'locked' | 'blocked';
  known: boolean;
  hint?: string;
}

export type EngineV4 = Engine & {
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

export function selectable(ents: EntranceInfo[], i: number): boolean {
  return ents.some((x) => x.index === i && x.known && x.state === 'open');
}

export const VALUABLE = new Set(['gem', 'jewelry', 'heirloom', 'hoard']);

export const isValuable = (i: Item) => VALUABLE.has(i.kind) && !i.story;

export const isHeir = (c: Campaign, id: string) => id === 'keven' || c.roster.find((x) => x.id === id)?.cls === 'heir';

/** V4.1 (spec 31.11, owner): at most this many cards in each row of the board (village pins; work for hire). */
export const BOARD_ROW_MAX = 3;

/**
 * V4.1 (spec 31.11, owner): the board in two rows. "Pinned by the village": "Bring back" jobs first (urgent: they always
 * show and count toward the 3), then the village's pleas in board order, at most 3 shown (`more`: how many wait behind
 * them). "Work for hire": the regular bounties, at most 3. The chosen job always shows (a house's plea seal can pick one
 * that waits): it takes the last plea's place.
 */
export function boardRows(c: Campaign, chosenId?: string): { pins: Contract[]; hire: Contract[]; more: number } {
  const cap = (k: Contract) => !k.story && !!contractCaptive(c, k);
  const captives = c.board.filter(cap);
  const pleas = c.board.filter((k) => k.story);
  const all = [...captives, ...pleas];
  const pins = all.slice(0, Math.max(BOARD_ROW_MAX, captives.length));
  const chosen = all.find((k) => k.id === chosenId);
  if (chosen && !pins.includes(chosen)) {
    const last = pins.map((k) => !!k.story).lastIndexOf(true);
    if (last >= 0) pins[last] = chosen;
    else pins.push(chosen);
  }
  const hire = c.board.filter((k) => !k.story && !cap(k)).slice(0, BOARD_ROW_MAX);
  return { pins, hire, more: all.length - pins.length };
}

/** Contracts in the order they are shown: the village row (captives, then pleas), then work for hire. */
export function boardOrder(c: Campaign): Contract[] {
  const { pins, hire } = boardRows(c);
  return [...pins, ...hire];
}

/** The loadout checked against the state: heroes on the roster, items on the cart, a selectable entrance. */
export function cleanLoadout(s: GameState, engine: Engine, l: Loadout | null): Loadout {
  const c = s.campaign;
  const prev = l ?? { heroIds: [], packs: {}, entrance: 0 };
  const contract = c.board.find((k) => k.id === prev.contractId) ?? boardOrder(c)[0];
  const heroIds = [...new Set(prev.heroIds)].filter((id) => c.roster.some((x) => x.id === id)).slice(0, squadSlots(c)); // V4.1 (squads)
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
  return { contractId: contract?.id, heroIds, packs, entrance };
}

/** A new visit to Lowgate: the last party (still on the roster, Keven first), empty packs, the last way in. */
export function freshLoadout(s: GameState, engine: Engine, last: Loadout | null): Loadout {
  const c = s.campaign;
  let heroIds = (last?.heroIds ?? []).filter((id) => c.roster.some((x) => x.id === id));
  if (!heroIds.length) heroIds = [c.roster.find((x) => x.cls === 'heir')?.id ?? c.roster[0]?.id].filter((x): x is string => !!x);
  heroIds.sort((a, b) => Number(isHeir(c, b)) - Number(isHeir(c, a)));
  return cleanLoadout(s, engine, { heroIds, packs: {}, entrance: last?.entrance ?? 0 });
}

/** "Same as last time": the remembered loadout, if its heroes are all still on the roster. */
export function sameAsLast(s: GameState, last: Loadout | null): boolean {
  return !!last && last.heroIds.length > 0 && last.heroIds.length <= squadSlots(s.campaign) && last.heroIds.every((id) => s.campaign.roster.some((x) => x.id === id)); // V4.1 (squads): within the slots
}

export function packItems(c: Campaign, l: Loadout, id: string): Item[] {
  return (l.packs[id] ?? []).map((iid) => c.stash.find((i) => i.id === iid)).filter((x): x is Item => !!x);
}

export const slotsUsed = (items: Item[]) => items.reduce((a, i) => a + i.slots, 0);

export function packedIds(l: Loadout): Set<string> {
  return new Set(Object.values(l.packs).flat());
}

/** V4.1 (WS2): who packs a torch or a lantern (no free lantern any more). */
export function lightCarriers(c: Campaign, l: Loadout): string[] {
  return l.heroIds.filter((id) => packItems(c, l, id).some((i) => i.kind === 'torch' || i.kind === 'lantern'));
}

export function cap(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export const NUM_WORD = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];

export function numWord(n: number): string {
  return NUM_WORD[n] ?? `${n}`;
}

export function heroOf(c: Campaign, id: string): Hero | undefined {
  return c.roster.find((x) => x.id === id);
}

export function hpOf(hr: Hero): number {
  return Math.min(hr.maxHp, hr.hp ?? hr.maxHp);
}

export function hurt(hr: Hero): boolean {
  return hpOf(hr) < hr.maxHp;
}

export function classLine(hr: Hero): string {
  return `${hr.cls === 'heir' ? 'The heir' : className(hr.cls)} · Level ${hr.level}`;
}

/** The class's stats, weapon, armor and mana (the badge's hover). */
export function statsTip(cls: string, hr?: Hero): string {
  const def = CLASSES[cls as keyof typeof CLASSES];
  if (!def) return className(cls);
  const st = hr?.stats ?? def.stats;
  const w = def.weapon;
  const wStat = cap(w.stat);
  return `${className(cls)} · Might ${st.might}, Finesse ${st.finesse}, Wits ${st.wits}, Nerve ${st.nerve}\n${w.name}: ${w.slots} ${wStat} slots, ${w.dmg} damage${w.range ? `, range ${w.range}` : ''} · Armor ${def.armor}${def.mana ? ` · Mana ${def.mana}` : ''}`;
}

/** The hex class badge; focusable with its stats on hover when `tip` is set. */
export function hexBadge(cls: string, size: 'sm' | 'md' | 'lg' = 'md', tip?: string): HTMLElement {
  return h('span', { class: `cbadge lg-hex lg-hex-${size} cls-${cls}`, 'data-tip': tip, tabindex: tip ? 0 : undefined, role: tip ? 'img' : undefined, 'aria-label': tip ? className(cls) : undefined, 'aria-hidden': tip ? undefined : 'true' }, classGlyph(cls));
}

export const SVG_NS = 'http://www.w3.org/2000/svg';

export function svg(tag: string, attrs: Record<string, string | number>, ...kids: (SVGElement | string)[]): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const k of kids) el.append(k);
  return el as SVGElement;
}

export const tick = (stroke = '#e8a33d', size = 14) => svg('svg', { width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': 'true' }, svg('path', { d: 'M3 8.5 L6.5 12 L13 4.5', fill: 'none', stroke, 'stroke-width': 2 }));

export const heart = () => svg('svg', { width: 13, height: 12, viewBox: '0 0 13 12', 'aria-hidden': 'true' }, svg('path', { d: 'M6.5 11 L1.2 5.6 A3 3 0 0 1 6.5 2 A3 3 0 0 1 11.8 5.6 Z', fill: '#c0473a' }));

export const warnTri = (stroke = '#e8a33d', size = 12) => svg('svg', { width: size, height: size, viewBox: '0 0 12 12', 'aria-hidden': 'true' }, svg('path', { d: 'M6 1 L11 10 H1 Z', fill: 'none', stroke, 'stroke-width': 1.3 }));

export const coin = () => svg('svg', { width: 18, height: 18, viewBox: '0 0 18 18', 'aria-hidden': 'true' }, svg('circle', { cx: 9, cy: 9, r: 7.5, fill: 'none', stroke: '#d9a93a', 'stroke-width': 1.5 }), svg('circle', { cx: 9, cy: 9, r: 3.5, fill: 'none', stroke: '#d9a93a', 'stroke-width': 1.2 }));

export const cartIcon = () => svg('svg', { width: 18, height: 16, viewBox: '0 0 18 16', 'aria-hidden': 'true' }, svg('path', { d: 'M1 4 H15 L13.5 11 H3 Z', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4 }), svg('circle', { cx: 5, cy: 14, r: 1.5, fill: 'none', stroke: 'currentColor' }), svg('circle', { cx: 12, cy: 14, r: 1.5, fill: 'none', stroke: 'currentColor' }));

export const stoneIcon = () => svg('svg', { width: 14, height: 18, viewBox: '0 0 14 18', 'aria-hidden': 'true' }, svg('path', { d: 'M2 17 V7 A5 5 0 0 1 12 7 V17 Z', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4 }));

export const lanternIcon = () => svg('svg', { width: 12, height: 16, viewBox: '0 0 12 16', 'aria-hidden': 'true' }, svg('path', { d: 'M3 4 H9 V13 H3 Z M4.5 1.5 H7.5 M6 1.5 V4', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.3 }));

/** A button that stays hoverable when it can't be used (the reason is its tooltip). */
export function btn(attrs: { class?: string; tip?: string; off?: boolean; k?: string; data?: Record<string, string>; label?: string; onclick: () => void | Promise<void> }, ...kids: (Node | string)[]): HTMLButtonElement {
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

export function tipHtml(text: string, nums?: string): string {
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

/** UI state that lives between renders (not worth a save). */
export const ui = {
  packFor: null as string | null,
  /** V4.1 (spec 31.6): the Vendors side's open tab. */
  outfitTab: 'mott' as VendorId,
  /** V4.1 (spec 31.6): what the last purchase did, shown once on its row (and the slot it went to glows). */
  flash: null as Flash | null,
  lastStep: 'job' as Step,
};

export interface Flash {
  row: string;
  itemId?: string;
  /** V5.0 (P, B1): the kind just bought: its cart row glows. */
  cart?: string;
  text: string;
}

export const NO_VILLAGE: Village = { surgeon: false, innkeeper: false, smith: false, copper: false, caskbook: false, alchemist: false, muster: false };

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

export function stepHead(title: string, sub: string, right?: HTMLElement): HTMLElement {
  return h('div', { class: 'lg-sh' }, h('div', { class: 'lg-sh-l' }, h('h2', { class: 'lg-h2' }, title), h('p', { class: 'lg-sub' }, sub)), right ?? '');
}
