// V5.1 (W1): the camp's frame. The 1920x1080 stage (stage.ts) is mounted once and kept across re-renders, with
// the header (brand, the four step medallions, the wagon and the gravestone, the purse as a coin stack) and the
// footer (Back, one line of note, the forward button). The screens render into <main> between them:
//   header.top   0..92px    (frame)
//   main         92..992px  1920x900, position absolute, overflow hidden (the screen modules)
//   footer.foot  992..1080  (frame)
// Tooltips live inside the stage and are positioned in stage px, so they scale with it.
// The footer's middle note: a screen module may export `footNote(s, l, host): string | Node | null` (host.page says
// which page; the outfit module's also serves the cart page).

import type { GameState } from '../../game/types';
import { sfx } from '../../audio/sfx';
import { clear, gold, h } from '../dom';
import { type Step, type CampPage, type Loadout, type CampHost, STEPS, STEP_NAME, STEP_WHAT, entrancesOf, selectable, isHeir, cleanLoadout, sameAsLast, numWord, heroOf, btn, tipHtml, ui, packedIds } from './shared';
import { mountStage, STAGE_W, STAGE_H, type Stage } from './stage';
import { coinStack, type CoinStack } from './coinstack';
import { ic, type CampIcon } from './icons';
import './frame.css';

interface Frame {
  parent: HTMLElement;
  stage: Stage;
  coins: CoinStack;
  /** The number the purse shows (it counts toward the gold). */
  shown: number;
  goldTarget: number;
  raf: number;
  tip: HTMLElement;
  hideTip(): void;
}

let frame: Frame | null = null;

/** The stage for this screen element, mounted on first use and kept across re-renders. Clears the stage. */
export function campStage(el: HTMLElement, s: GameState): Frame {
  if (frame && (frame.parent !== el || !el.contains(frame.stage.host))) {
    cancelAnimationFrame(frame.raf);
    frame.stage.destroy();
    frame = null;
  }
  if (!frame) {
    clear(el);
    const stage = mountStage(el, 'lowgate');
    const tip = h('div', { class: 'lg-tip camp-tip hidden', role: 'tooltip', id: 'lg-tip' });
    const g = s.campaign.gold;
    frame = { parent: el, stage, coins: coinStack(g), shown: g, goldTarget: g, raf: 0, tip, hideTip: () => {} };
    frame.hideTip = installStageTips(stage, tip);
  }
  frame.hideTip();
  clear(frame.stage.root);
  return frame;
}

/** Tooltips for every [data-tip] (or [title]) in the stage, on hover and keyboard focus, placed in stage px. */
function installStageTips(stage: Stage, tip: HTMLElement): () => void {
  const root = stage.root;
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
    if (!tip.isConnected) root.append(tip);
    tip.classList.remove('hidden');
    const r = t.getBoundingClientRect();
    const [x0, y0] = stage.toStage(r.left, r.top);
    const [, y1] = stage.toStage(r.right, r.bottom);
    const w = tip.offsetWidth;
    const th = tip.offsetHeight;
    const x = Math.max(8, Math.min(STAGE_W - w - 8, x0));
    const below = y1 + 10;
    const y = below + th > STAGE_H - 8 ? Math.max(8, y0 - th - 10) : below;
    tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  };
  const find = (e: Event) => (e.target instanceof Element ? e.target.closest<HTMLElement>('[data-tip],[title]') : null);
  root.addEventListener('pointerover', (e) => {
    const t = find(e);
    if (!t || !root.contains(t) || t === tip) return hide();
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
  return hide;
}

/** Put the tooltip back after a render cleared the stage. */
export function finishFrame(f: Frame): void {
  f.tip.classList.add('hidden');
  f.stage.root.append(f.tip);
}

function goto(host: CampHost, p: CampPage): void {
  sfx.play('click');
  host.setPage(p);
}

const STEP_ICON: Record<Step, CampIcon> = { job: 'scroll', party: 'banner', outfit: 'sack', setout: 'gate' };

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

/** Is a step done enough to tick? (A job chosen; a party; something packed; a way in.) */
function stepDone(s: GameState, l: Loadout, step: Step, host: CampHost): boolean {
  switch (step) {
    case 'job':
      return !!l.contractId && s.campaign.board.some((k) => k.id === l.contractId);
    case 'party':
      return l.heroIds.length > 0;
    case 'outfit':
      return l.heroIds.some((id) => (l.packs[id]?.length ?? 0) > 0);
    case 'setout':
      return selectable(entrancesOf(host.engine, s), l.entrance);
  }
}

export function header(f: Frame, s: GameState, l: Loadout, host: CampHost): HTMLElement {
  const c = s.campaign;
  const brand = h('div', { class: 'brand lg-brand', tabindex: 0, 'data-tip': `Lowgate · the village under the walls\nDelve ${c.delveCount + 1} is next. Keven camps here between delves.` }, h('div', { class: 'kick' }, `Delve ${c.delveCount + 1} · under the walls`), h('h1', { class: 'lg-title' }, 'Lowgate'));
  const cur = STEPS.indexOf(host.page as Step);
  const nav = h('nav', { class: 'steps lg-steps', 'aria-label': 'Delve steps' });
  STEPS.forEach((st, i) => {
    const here = st === host.page;
    const done = !here && (cur < 0 || i < cur) && stepDone(s, l, st, host);
    if (i) nav.append(h('span', { class: `link lg-link ${cur >= 0 && i <= cur ? 'done' : ''}`, 'aria-hidden': 'true' }));
    const sub = stepSummary(s, l, st, host);
    nav.append(
      h(
        'button',
        { type: 'button', class: `step lg-step ${here ? 'on' : ''} ${done ? 'done' : ''}`, 'data-step': st, 'data-k': `step-${st}`, 'aria-current': here ? 'step' : undefined, 'data-tip': `${STEP_NAME[st]} · step ${i + 1}\nNow: ${sub}\n${STEP_WHAT[st]}`, onclick: () => goto(host, st) },
        h('span', { class: 'med' }, ic(STEP_ICON[st]), done ? h('span', { class: 'tick' }, ic('check')) : ''),
        h('span', { class: 'step-t' }, h('span', { class: 'nm' }, STEP_NAME[st]), h('span', { class: 'sb' }, sub)),
      ),
    );
  });

  // The camp props: the wagon (Keven's cart) and the gravestone.
  const packed = packedIds(l);
  const onCart = c.stash.length;
  const waiting = c.stash.filter((i) => !packed.has(i.id)).length;
  const graves = c.fallen.length;
  const prop = (id: 'cart' | 'graves', icon: CampIcon, n: number, tip: string, label: string) =>
    btn(
      { class: `prop ${id === 'graves' ? 'grave' : ''} ${host.page === id ? 'here' : ''}`, k: `rb-${id}`, data: { ribbon: id }, tip, label, onclick: () => goto(host, host.page === id ? ui.lastStep : id) },
      ic(icon),
      n ? h('span', { class: 'bd num' }, `${n}`) : '',
    );
  const props = h(
    'div',
    { class: 'props' },
    prop('cart', 'cart', waiting, `Keven's cart · ${onCart ? `${onCart} thing${onCart === 1 ? '' : 's'} on it${waiting !== onCart ? `, ${waiting} not packed` : ''}` : 'Empty'}\nGear waits here until it goes in a pack; valuables wait to be sold.`, `Keven's cart, ${waiting} waiting`),
    prop('graves', 'grave', graves, graves ? `The graves · ${numWord(graves)} name${graves === 1 ? '' : 's'} cut in the gatepost.` : 'The graves · No names yet.', `The graves, ${graves} names`),
  );

  // The purse: one coin stack kept across renders, so earning and spending animate.
  const num = h('span', { class: 'gold-n lg-gold-n num' }, gold(f.shown));
  f.coins.setGold(c.gold);
  countTo(f, num, c.gold);
  const purse = h(
    'div',
    { class: 'purse lg-gold', tabindex: 0, 'data-tip': `Gold · ${gold(c.gold)} in Keven's strongbox.\nBounties and sold valuables go in; hires, wares, healing and the forge come out.` },
    f.coins.el,
    num,
    h('span', { class: 'sr-only' }, ' gold'),
  );
  return h('header', { class: 'top lg-head' }, brand, nav, h('div', { class: 'right lg-head-r' }, props, purse));
}

/** The purse's number counts toward the gold (instant with reduced motion). */
function countTo(f: Frame, el: HTMLElement, to: number): void {
  cancelAnimationFrame(f.raf);
  const from = f.shown;
  f.goldTarget = to;
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (from === to || reduced) {
    f.shown = to;
    el.textContent = gold(to);
    return;
  }
  const t0 = performance.now();
  const dur = 450;
  const tick = (t: number) => {
    const k = Math.min(1, (t - t0) / dur);
    f.shown = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
    el.textContent = gold(f.shown);
    if (k < 1) f.raf = requestAnimationFrame(tick);
  };
  f.raf = requestAnimationFrame(tick);
}

type FootNote = (s: GameState, l: Loadout, host: CampHost) => string | Node | null | undefined;

const DEFAULT_NOTE: Record<CampPage, string> = {
  job: 'Next, choose who goes in.',
  party: 'Next, pack for the delve.',
  outfit: 'Next, choose the way in.',
  setout: 'When the party is ready, delve.',
  cart: '',
  graves: '',
};

export function footer(s: GameState, l: Loadout, host: CampHost, mod: unknown): HTMLElement {
  const p = host.page;
  const left = h('div', { class: 'foot-l lg-foot-l' });
  const right = h('div', { class: 'foot-r lg-foot-r' });
  const fwd = (to: Step) => btn({ class: 'btn primary', k: `next-${to}`, data: { next: to }, onclick: () => goto(host, to) }, `Next: ${STEP_NAME[to]}`, ic('push'));
  const back = (to: Step) => btn({ class: 'btn ghost lg-back', k: `back-${to}`, data: { back: to }, onclick: () => goto(host, to) }, ic('push', { class: 'flip' }), STEP_NAME[to]);
  if (p === 'job') {
    if (sameAsLast(s, host.lastLoadout)) right.append(sameButton(s, l, host));
    right.append(fwd('party'));
  } else if (p === 'party') (left.append(back('job')), right.append(fwd('outfit')));
  else if (p === 'outfit') (left.append(back('party')), right.append(fwd('setout')));
  else if (p === 'setout') (left.append(back('outfit')), right.append(delveButton(s, l, host)));
  else left.append(btn({ class: 'btn ghost lg-back', k: 'back-steps', data: { back: 'steps' }, onclick: () => goto(host, ui.lastStep) }, ic('push', { class: 'flip' }), `Back to ${STEP_NAME[ui.lastStep]}`));

  let note: string | Node | null | undefined;
  const fn = (mod as { footNote?: FootNote } | undefined)?.footNote;
  try {
    note = typeof fn === 'function' ? fn(s, l, host) : DEFAULT_NOTE[p];
  } catch {
    note = DEFAULT_NOTE[p];
  }
  const mid = h('div', { class: 'mid lg-foot-hint', 'data-note': p }, note ?? '');
  return h('footer', { class: 'foot lg-foot' }, left, mid, right);
}

function sameButton(s: GameState, l: Loadout, host: CampHost): HTMLElement {
  const last = host.lastLoadout!;
  const c = s.campaign;
  const names = last.heroIds.map((id) => heroOf(c, id)?.name ?? id).join(', ');
  const ents = entrancesOf(host.engine, s);
  return btn(
    {
      class: 'btn ghost lg-same',
      k: 'same',
      data: { same: '1' },
      tip: `Same as last time · ${names}\nThe same party, the same packs where the cart still has them, the same way in. Takes the job you've chosen and goes straight to Set out.`,
      onclick: () => {
        const next = cleanLoadout(s, host.engine, { contractId: l.contractId, heroIds: [...last.heroIds], packs: structuredClone(last.packs ?? {}), entrance: selectable(ents, last.entrance) ? last.entrance : 0 });
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
      class: 'btn primary lg-delve btn-delve',
      k: 'delve',
      data: { next: 'delve' },
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
    ic('stairs'),
  );
}
