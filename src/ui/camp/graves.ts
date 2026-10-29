// V5.1 (W4): the graves side page (the approved Graves board): a night yard outside the north gate. The old gatepost
// carries every fallen name (the newest glows); the newest few get a headstone with a bust in relief, an epitaph and
// a candle; empty plots wait. Same data as before (campaign.fallen, oldest first). Fills the 1920x900 <main>, no scroll.

import type { FallenHero, GameState } from '../../game/types';
import { h } from '../dom';
import { type AnyClass, EPITAPH, className } from '../names';
import { numWord } from './shared';
import { ic, type CampIcon } from './icons';
import { bust } from './bust';
import './graves.css';

/** Headstones that fit beside the gatepost; older names are only on the post. */
export const MAX_STONES = 4;
/** Names that fit on the post in one column, and in two (compact). */
const POST_ONE = 7;
const POST_TWO = 20;

const CLASS_ICON: Record<string, CampIcon> = { heir: 'crown', sellsword: 'sword', burglar: 'hood', ranger: 'bow', sapper: 'bomb', pyromancer: 'flame', shadowmancer: 'moon', hedgewitch: 'leaf', mage: 'flame' };

/** More lines per class; the first is the class's own (names.ts EPITAPH). */
const MORE: Partial<Record<AnyClass, string[]>> = {
  sellsword: ['Paid in full.', 'Stood where others ran.'],
  burglar: ['Quiet to the last.', 'Took one thing too many.'],
  ranger: ['Never missed twice.', 'Saw it coming, all the same.'],
  sapper: ['Lit the last fuse.', 'Left a hole in the castle.'],
  pyromancer: ['Warm to the end.', 'Ash and embers.'],
  shadowmancer: ['The dark kept them.', 'Seen by no one, missed by all.'],
  hedgewitch: ['Her herbs grow on.', 'Gave her last draught away.'],
  mage: ['The words ran out.'],
};
const FIRST = ['The first night in was the last.', 'In on the first delve, and no further.'];

/** A small, stable string hash (FNV-1a), so an epitaph never changes between visits. */
function hash(t: string): number {
  let x = 2166136261;
  for (let i = 0; i < t.length; i++) x = Math.imul(x ^ t.charCodeAt(i), 16777619);
  return x >>> 0;
}

/**
 * The line on a headstone, from what the record has: the class (its own lines), how far in they were (the delve:
 * the first delve has lines of its own) and who they were (a hash of the name, delve and place picks one). The heir
 * always gets the house's line. No Math.random: the same record always reads the same.
 */
export function epitaph(f: FallenHero): string {
  const own = EPITAPH[f.cls as AnyClass];
  if (f.cls === 'heir') return own ?? 'The last of the Hobarts.';
  const lines = [own, ...(MORE[f.cls as AnyClass] ?? [])].filter((x): x is string => !!x);
  if (f.delve === 1) lines.push(...FIRST);
  if (!lines.length) lines.push('Gone into the castle.');
  return lines[hash(`${f.name}|${f.delve}|${f.where}`) % lines.length]!;
}

const placeOf = (where: string) => {
  const room = where.replace(/^Level \d+,\s*/, '');
  return /^the /i.test(room) ? room : `the ${room}`;
};

/** Headstone slots (stage px in <main>): the mockup's two for one or two graves; four narrower ones for more. */
const WIDE = [{ x: 1280 }, { x: 310 }];
const NARROW = [{ x: 1180 }, { x: 440 }, { x: 1560 }, { x: 60 }];

export function gravesPage(main: HTMLElement, s: GameState): void {
  const f = s.campaign.fallen;
  const n = f.length;
  const yard = h('div', { class: 'gv', 'data-screen': 'graves' });
  yard.append(
    h(
      'div',
      { class: 'gv-sky', 'aria-hidden': 'true' },
      h('div', { class: 'gv-stars' }),
      h('div', { class: 'gv-moon' }),
      keep(),
    ),
    h('div', { class: 'gv-yard', 'aria-hidden': 'true' }, h('div', { class: 'gv-ground' })),
    h(
      'div',
      { class: 'gv-head' },
      h('div', { class: 'kick' }, 'Outside the north gate'),
      h('h2', null, 'The graves'),
      h('p', null, n ? `${numWord(n)} name${n === 1 ? '' : 's'} cut in the old gatepost, and a mound for each.` : 'The old gatepost, and nothing cut in it yet.'),
    ),
  );
  yard.append(post(f));

  // Newest first; the rest are on the post only.
  const shown = f.slice(-MAX_STONES).reverse();
  const slots = shown.length <= 2 ? WIDE : NARROW;
  const narrow = slots === NARROW;
  shown.forEach((x, i) => yard.append(...grave(x, slots[i]!.x, narrow, i === 0 && n > 0, n > 1)));
  // Empty plots, waiting: the mockup's two outer ones beside one or two stones, the free slots beside three.
  const plots: number[] = shown.length === 0 ? [90, 390, 1360, 1660] : shown.length === 1 ? [90, 390, 1660] : shown.length === 2 ? [90, 1660] : slots.slice(shown.length).map((sl) => sl.x + 65);
  for (const x of plots) yard.append(h('div', { class: 'gv-plot', style: `left:${x}px`, 'aria-hidden': 'true' }, ic('plus')));
  yard.append(n ? h('p', { class: 'gv-note' }, 'What they carried still lies where they fell. Some of it may turn up again.') : h('p', { class: 'gv-note none' }, 'No names yet. Keep it that way.'));
  main.append(yard);
}

function keep(): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const g = document.createElementNS(NS, 'svg');
  g.setAttribute('class', 'gv-keep');
  g.setAttribute('viewBox', '0 0 560 280');
  g.innerHTML =
    '<g fill="#0a0c12"><polygon points="0,280 0,170 40,170 40,130 60,130 60,150 90,150 90,100 110,100 110,60 130,40 150,60 150,100 170,100 170,150 220,150 220,180 260,180 260,110 280,110 280,70 300,50 320,70 320,110 340,110 340,180 400,180 400,150 440,150 440,120 470,120 470,160 520,160 520,200 560,200 560,280"/></g>' +
    '<rect x="125" y="78" width="9" height="14" fill="#ffb35c"/><rect x="293" y="90" width="9" height="14" fill="#ffb35c" opacity=".6"/>';
  return g;
}

/** The gatepost: every name, newest at the top and lit; compact in two columns when many; "and N more" past that. */
function post(f: FallenHero[]): HTMLElement {
  const newest = [...f].reverse();
  const two = newest.length > POST_ONE;
  const cap = two ? POST_TWO : POST_ONE;
  const list = newest.length > cap ? newest.slice(0, cap - 1) : newest;
  const names = h('div', { class: `gv-names${two ? ' two' : ''}` });
  list.forEach((x, i) => names.append(h('div', { class: i === 0 ? 'new' : '', 'data-tip': `${x.name} · ${className(x.cls)}, level ${x.level}\nFell on delve ${x.delve}: ${x.where}.`, tabindex: 0 }, x.name, h('small', null, two ? `delve ${x.delve}` : `${className(x.cls)} · delve ${x.delve}`))));
  if (newest.length > list.length) names.append(h('div', { class: 'gap more' }, `and ${newest.length - list.length} more`));
  for (let i = list.length; i < 4; i++) names.append(h('div', { class: 'gap', 'aria-hidden': 'true' }, '· · ·'));
  return h('div', { class: 'gv-post', 'aria-label': 'The old gatepost' }, ic('lantern', { class: 'gv-lantern' }), h('div', { class: 'cap' }), h('div', { class: 'shaft' }), names);
}

function grave(x: FallenHero, left: number, narrow: boolean, newest: boolean, many: boolean): (HTMLElement | string)[] {
  const w = narrow ? 300 : 330;
  const cls = `${className(x.cls)} · Level ${x.level}`;
  const stone = h(
    'article',
    { class: `gv-stone${newest ? ' newest' : ''}${narrow ? ' narrow' : ''}`, style: `left:${left}px`, 'data-fallen': x.name, tabindex: 0, 'data-tip': `${x.name} · ${className(x.cls)}, level ${x.level}\nFell on delve ${x.delve}: ${x.where}.` },
    h('div', { class: 'rel' }, bust(x.cls, { size: 110 })),
    h('h3', null, x.name),
    h('div', { class: `cl${cls.length > 18 ? ' long' : ''}` }, h('span', { class: 'em' }, ic(CLASS_ICON[x.cls] ?? 'grave')), cls),
    h('div', { class: 'orn', 'aria-hidden': 'true' }, '— ✦ —'),
    h('div', { class: 'w' }, `Fell in ${placeOf(x.where)}`),
    h('div', { class: 'dv' }, `Delve ${x.delve}${newest && many ? ' · the newest' : ''}`),
    h('div', { class: 'ep' }, epitaph(x)),
  );
  return [
    h('div', { class: `gv-glow${newest ? ' newest' : ''}`, style: `left:${left + w / 2 - (newest ? 170 : 130)}px`, 'aria-hidden': 'true' }),
    h('div', { class: 'gv-mound', style: `left:${left}px;width:${w}px`, 'aria-hidden': 'true' }),
    stone,
    h('div', { class: 'gv-candle', style: `left:${left + w + 12}px`, 'aria-hidden': 'true' }),
    // a second, shorter candle: lit for the newest, burnt out for the rest
    narrow && !newest ? '' : h('div', { class: `gv-candle short${newest ? '' : ' out'}`, style: `left:${left - 40}px`, 'aria-hidden': 'true' }),
  ];
}
