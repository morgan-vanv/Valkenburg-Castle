// V5.1.2 "One for the road" (spec 34.3, Toast.dc.html): pressing Delve with at least one hero holding an ale shows
// the party at the Flagon raising what Wim poured, about two seconds, and any Black Cask cracks open here instead of
// quietly in the log. Pure view: startDelve has already run (the Black Cask resolved on the seeded dice); this only
// reads the states either side of it (ales.ts toastPlan). It sits on its own camp stage above the delve view and
// removes itself. Click, Space, E, Enter or Escape skip it (the key is swallowed: E would end the turn); the Instant
// speed setting never shows it (app.ts); prefers-reduced-motion gets a plain fade.

import type { GameState } from '../../game/types';
import { ALES } from '../../game/data';
import { ALE_EFFECT } from '../names';
import { h } from '../dom';
import { sfx } from '../../audio/sfx';
import { mountStage } from './stage';
import { bust } from './bust';
import { ic } from './icons';
import { aleLook, tankard, toastPlan, type Drinker } from './ales';
import './camp.css';
import './toast.css';

/** How long it stays (ms), without and with a Black Cask to reveal. */
export const TOAST_MS = 2100;
export const TOAST_CASK_MS = 2700;

let current: { close: () => void } | null = null;

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** What the ale does, in a line, for the reveal card (the engine's own words for a good one). */
function effectText(d: Drinker): string {
  if (!d.ale) return '';
  const offer = ALES.find((a) => a.kind === d.ale);
  return offer?.text ?? ALE_EFFECT[d.ale].text;
}

/** Show the toast for this startDelve (before → after). Returns false (and shows nothing) when nobody drank. */
export function showToast(before: GameState, after: GameState, opts: { parent?: HTMLElement } = {}): boolean {
  const plan = toastPlan(before, after);
  if (!plan.length) return false;
  current?.close();
  const stage = mountStage(opts.parent ?? document.body, 'vc-toast');
  stage.host.classList.add('vc-toast-host');
  const root = stage.root;
  if (reduced()) root.classList.add('still');
  const casks = plan.filter((d) => d.cask);
  root.classList.toggle('has-cask', casks.length > 0);
  root.style.setProperty('--n', `${plan.length}`);
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'One for the road');

  const kick = `Delve ${after.campaign.delveCount} · the Flagon, before the gate`;
  root.append(
    h('div', { class: 'ts-scene', 'aria-hidden': 'true' }),
    h('div', { class: 'ts-head' }, h('div', { class: 'kick' }, kick), h('h1', null, 'One for the road')),
    h('span', { class: 'ts-table', 'aria-hidden': 'true' }),
  );

  const crew = h('div', { class: 'ts-crew' });
  plan.forEach((d, i) => {
    const pos = plan.length === 1 ? 'c' : i === 0 ? 'l' : i === plan.length - 1 ? 'r' : 'c';
    const look = d.ale ? aleLook(d.ale) : null;
    const shown = d.cask ? 'blackcask' : d.ale;
    crew.append(
      h(
        'div',
        { class: `ts-drinker ${pos} ${d.ale ? '' : 'dry'} ${look?.bad ? 'bad' : ''}`, 'data-drinker': d.heroId, 'data-ale': d.ale ?? '', style: `--i:${i}` },
        bust(d.cls, { size: plan.length > 3 ? 210 : 240 }),
        d.ale && shown ? h('span', { class: 'ts-raise' }, tankard(shown, { size: 88 })) : '',
        h('div', { class: 'ts-say' }, d.ale ? `"${d.line}"` : '"Just water for me."', h('small', null, `${d.name}${d.ale ? ` · ${d.cask ? 'Black Cask' : ALE_EFFECT[d.ale].name}` : ''}`)),
        d.ale && look ? h('span', { class: `ts-fx ${look.bad ? 'bad' : ''}`, style: `--ale-ink:${look.ink};--edge:color-mix(in srgb,${look.colour} 70%,#000)` }, ic(look.icon), d.cask ? `${ALE_EFFECT[d.ale].name}: ${look.short.replace(/^[^:]+: /, '')}` : look.toast) : '',
      ),
    );
  });
  root.append(crew, h('span', { class: 'ts-clink', 'aria-hidden': 'true' }));

  if (casks.length) {
    const box = h('div', { class: `ts-casks ${casks.length > 1 ? 'many' : ''}` });
    for (const d of casks) {
      const look = aleLook(d.ale!);
      box.append(
        h(
          'div',
          { class: `ts-card ${look.bad ? 'bad' : ''}`, 'data-cask': d.heroId, 'data-became': d.ale!, style: `--ale-ink:${look.ink}` },
          h('div', { class: 'k' }, `${d.name}'s Black Cask`),
          h('div', { class: 'ts-barrel', 'aria-hidden': 'true' }, h('span', { class: 'crack' }), h('span', { class: 'q' }, '?'), h('span', { class: 'got' }, tankard(d.ale!, { size: 64 }))),
          h('h3', null, `${ALE_EFFECT[d.ale!].name}!`),
          h('p', null, effectText(d)),
          h('div', { class: 'who' }, look.bad ? '3 in 10 it goes wrong. Tonight it did.' : "7 in 10 it's a good one. This was."),
        ),
      );
    }
    root.append(box);
  }
  root.append(h('div', { class: 'ts-skip' }, 'Click, Space, E or Enter to go in'));

  let done = false;
  const close = () => {
    if (done) return;
    done = true;
    removeEventListener('keydown', onKey, true);
    clearTimeout(timer);
    if (current?.close === close) current = null;
    root.classList.add('out');
    setTimeout(() => stage.destroy(), reduced() ? 150 : 260);
  };
  const onKey = (e: KeyboardEvent) => {
    // Everything waits while the party drinks: no key reaches the delve under the overlay.
    e.preventDefault();
    e.stopImmediatePropagation();
    if ([' ', 'Enter', 'Escape', 'e', 'E'].includes(e.key)) close();
  };
  addEventListener('keydown', onKey, true);
  stage.host.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    close();
  });
  // `window.vcToastHold` (screenshot checks only) keeps it up until skipped.
  const hold = !!(globalThis as { vcToastHold?: boolean }).vcToastHold;
  const timer = hold ? undefined : setTimeout(close, casks.length ? TOAST_CASK_MS : TOAST_MS);
  current = { close };
  try {
    sfx.play('coin', { pitch: 0.6, gain: 0.5 });
    if (!reduced()) setTimeout(() => !done && sfx.play('coin', { pitch: 1.4, gain: 0.7 }), 520);
  } catch {
    /* sound is optional */
  }
  return true;
}

/** Is the toast up (for checks)? */
export const toastShowing = (): boolean => !!current;
