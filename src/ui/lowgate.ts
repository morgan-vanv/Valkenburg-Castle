// V4.0: Lowgate, the camp before a delve. One path of four steps along the top (Job, Party,
// Outfit, Set out), each clickable at any time; the Lowgate ribbon (houses, Keven's cart, the
// graves) and the step buttons along the bottom. Keven's cart and the graves are side pages.
// The party, packs and entrance are UI state (a Loadout) until Delve sends startDelve.

// V5.1 (W0): the screens live in src/ui/camp/ (shared.ts, job.ts, party.ts, outfit.ts, setout.ts, graves.ts); this file is
// the shell (campScreen, header, ribbon, footer) and re-exports what other modules import from here.

import type { Contract, GameState, StoryId } from '../game/types';
import { sfx } from '../audio/sfx';
import { clear, gold, h } from './dom';
import { STORY } from './names';
import { STEPS, type Step, type CampPage, type Loadout, type CampHost, STEP_NAME, STEP_WHAT, entrancesOf, selectable, isHeir, cleanLoadout, sameAsLast, numWord, heroOf, svg, tick, coin, cartIcon, stoneIcon, btn, installTips, ui, villageOf } from './camp/shared';
import { showVendor, jobStep } from './camp/job';
import { partyStep } from './camp/party';
import { outfitStep, cartPage } from './camp/outfit';
import { setOutStep } from './camp/setout';
import { gravesPage } from './camp/graves';

export { STEPS, type Step, type CampPage, type Loadout, type CampHost, type EntranceInfo, entrancesOf, memoryOf, BOARD_ROW_MAX, boardRows, boardOrder, cleanLoadout, freshLoadout, sameAsLast, installTips, villageOf, captiveContract, contractCaptive } from './camp/shared';

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
  sfx.play('click');
  host.setPage(p);
}

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
  // V4.1 (spec 31.3)
  { id: 'bench', story: 'alchemist', windows: [], name: "Ilse's bench", place: 'dye-house' },
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
            } else (showVendor(hs.story), goto(host, STORY[hs.story].step));
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
