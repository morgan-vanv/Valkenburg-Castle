// V5.1 (W0): the graves side page. Split out of src/ui/lowgate.ts.

import type { GameState } from '../../game/types';
import { h } from '../dom';
import { type AnyClass, EPITAPH, classGlyph, className } from '../names';
import { numWord } from './shared';

export function gravesPage(main: HTMLElement, s: GameState): void {
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
