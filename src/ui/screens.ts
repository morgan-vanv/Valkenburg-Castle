// Full-screen pages: title, game over. The return report is src/ui/return.ts. The camp (Lowgate) is src/ui/lowgate.ts.

import type { Engine } from '../game/api';
import type { Command, GameState } from '../game/types';
import { clear, gold, h } from './dom';
import { classGlyph, className } from './names';

/** What the summary and game-over pages need from the app (the title has its own host, TitleHost). */
export interface ScreenHost {
  engine: Engine;
  send(cmd: Command): Promise<boolean>;
  newCampaign(seed: number): void;
  continueGame(): void;
  hasSave: boolean;
}

// ------------------------------------------------------------ title

/** 18.1: the story, in the game's plain voice (title screen and the first camp). */
export const INTRO = [
  'Lord Hobart was the last to rule Valkenburg. He died, and the castle went dark.',
  'His son Keven grew up far from here. Now the heir is back, in Lowgate, the village under the walls.',
  "Lowgate's people were dragged into the castle. Bring them home and the village comes back to life.",
  'Take contracts. Come back alive. If Keven falls, Valkenburg stays dark.',
];

// V5.2 (spec 35): the title screen lives on the camp stage, src/ui/camp/title.ts.
export { titleScreen, type TitleHost } from './camp/title';

// ------------------------------------------------------------ camp (V4.0: src/ui/lowgate.ts)

export { campScreen, captiveContract, contractCaptive, villageOf, type CampHost, type CampPage, type Loadout, type Step } from './lowgate';

function stat(label: string, value: string, cls = ''): HTMLElement {
  return h('div', { class: `stat ${cls}` }, h('span', { class: 'stat-label' }, label), h('span', { class: 'stat-value num' }, value));
}

function classBadge(cls: string): HTMLElement {
  return h('span', { class: `cbadge cls-${cls}`, title: className(cls) }, classGlyph(cls));
}

// ------------------------------------------------------------ summary and game over

// V4.0: the summary after a delve is the return report, src/ui/return.ts.

export function overScreen(el: HTMLElement, s: GameState, host: ScreenHost): void {
  clear(el);
  const c = s.campaign;
  el.append(
    h(
      'div',
      { class: 'screen-panel end-panel lost' },
      h('div', { class: 'kicker' }, `After ${c.delveCount} delve${c.delveCount === 1 ? '' : 's'}`),
      h('h1', { class: 'game-title' }, 'The line ends'),
      h('p', { class: 'lede over-line' }, s.overReason && /taken/i.test(s.overReason) ? 'The heir is taken. Valkenburg stays dark.' : 'The heir has fallen. Valkenburg stays dark.'),
      s.overReason && !/stays dark/.test(s.overReason) ? h('p', { class: 'dim' }, s.overReason) : '',
      h('div', { class: 'ledger' }, stat('Gold', gold(c.gold), 'stat-gold'), stat('Reputation', `${c.reputation}`), stat('Fallen', `${c.fallen.length}`), stat('Delves', `${c.delveCount}`)),
      c.fallen.length ? h('ul', { class: 'memorial' }, ...c.fallen.map((f) => h('li', null, classBadge(f.cls), h('b', null, f.name), h('span', { class: 'dim small' }, ` ${f.where}`)))) : '',
      h('div', { class: 'screen-actions' }, h('button', { class: 'btn btn-primary btn-big', onclick: () => host.newCampaign(Math.floor(Math.random() * 1e9)) }, 'New campaign')),
    ),
  );
}
