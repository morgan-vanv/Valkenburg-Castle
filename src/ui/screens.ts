// Full-screen pages: title, summary, game over. The camp (Lowgate) is src/ui/lowgate.ts.

import type { Engine } from '../game/api';
import type { Command, GameState } from '../game/types';
import { sfx } from '../audio/sfx';
import { clear, gold, h } from './dom';
import { STORY, classGlyph, className } from './names';

/** What the title, summary and game-over pages need from the app. */
export interface ScreenHost {
  engine: Engine;
  send(cmd: Command): Promise<boolean>;
  newCampaign(seed: number): void;
  continueGame(): void;
  hasSave: boolean;
}

const TITLE = 'Valkenburg Castle';
const SUBTITLE = "The Heir's Return";


// ------------------------------------------------------------ title

/** 18.1: the story, in the game's plain voice (title screen and the first camp). */
export const INTRO = [
  'Lord Hobart was the last to rule Valkenburg. He died, and the castle went dark.',
  'His son Keven grew up far from here. Now the heir is back, in Lowgate, the village under the walls.',
  "Lowgate's people were dragged into the castle. Bring them home and the village comes back to life.",
  'Take contracts. Come back alive. If Keven falls, Valkenburg stays dark.',
];

export function titleScreen(el: HTMLElement, host: ScreenHost): void {
  clear(el);
  const seed = h('input', { class: 'seed', type: 'text', inputmode: 'numeric', placeholder: 'random', 'aria-label': 'Seed' }) as HTMLInputElement;
  el.append(
    h(
      'div',
      { class: 'screen-panel title-panel' },
      h('div', { class: 'kicker' }, 'A delve into the ruined seat of the Van Valkenburgs'),
      h('h1', { class: 'game-title' }, TITLE, h('span', { class: 'game-sub' }, SUBTITLE)),
      h('div', { class: 'lede intro-lines' }, ...INTRO.map((l) => h('p', null, l))),
      h(
        'div',
        { class: 'title-actions' },
        host.hasSave ? h('button', { class: 'btn btn-primary btn-big', onclick: () => host.continueGame() }, 'Continue') : '',
        h(
          'button',
          {
            class: `btn ${host.hasSave ? '' : 'btn-primary'} btn-big`,
            onclick: () => {
              const n = Number.parseInt(seed.value, 10);
              host.newCampaign(Number.isFinite(n) ? n : Math.floor(Math.random() * 1e9));
            },
          },
          'New campaign',
        ),
      ),
      h('div', { class: 'seed-row' }, h('label', { class: 'seed-label' }, 'Seed', seed)),
      host.hasSave ? h('p', { class: 'fine' }, 'A new campaign replaces your saved one.') : '',
      h('p', { class: 'fine' }, 'After the 1980 board game by Task Force Games.'),
    ),
  );
}

// ------------------------------------------------------------ camp (V4.0: src/ui/lowgate.ts)

export { campScreen, captiveContract, contractCaptive, villageOf, type CampHost, type CampPage, type Loadout, type Step } from './lowgate';

function cap(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function stat(label: string, value: string, cls = ''): HTMLElement {
  return h('div', { class: `stat ${cls}` }, h('span', { class: 'stat-label' }, label), h('span', { class: 'stat-value num' }, value));
}

function classBadge(cls: string): HTMLElement {
  return h('span', { class: `cbadge cls-${cls}`, title: className(cls) }, classGlyph(cls));
}

// ------------------------------------------------------------ summary and game over

export function summaryScreen(el: HTMLElement, s: GameState, host: ScreenHost): void {
  clear(el);
  const sm = s.summary;
  if (!sm) {
    el.append(h('div', { class: 'screen-panel' }, h('p', null, 'No summary.'), h('button', { class: 'btn', onclick: () => host.send({ type: 'backToCamp' }) }, 'Back to camp')));
    return;
  }
  const name = (id: string) => s.campaign.roster.find((x) => x.id === id)?.name ?? id;
  /** 17.2: what each survivor carries home (HP stays until the infirmary heals it). */
  const outHp = (id: string) => {
    const hd = s.delve?.heroes.find((x) => x.heroId === id);
    const max = s.campaign.roster.find((x) => x.id === id)?.maxHp ?? 0;
    return hd ? `${hd.hp}/${max} HP` : 'out';
  };
  const heirDead = sm.dead.some((id) => s.campaign.roster.find((x) => x.id === id)?.cls === 'heir');
  // V3.7 (20.4): heroes a crew carried off.
  const taken = (s.delve?.heroes ?? []).filter((x) => x.status === 'captured').map((x) => x.heroId);
  const heirTaken = taken.some((id) => s.campaign.roster.find((x) => x.id === id)?.cls === 'heir');
  const crewName = s.delve?.rivals?.name ?? 'a crew';
  el.append(
    h(
      'div',
      { class: `screen-panel summary ${sm.contractDone ? 'won' : 'lost'}` },
      h('div', { class: 'kicker' }, s.delve?.contract.story ? `For Lowgate · ${s.delve.contract.title}` : (s.delve?.contract.title ?? 'Delve over')),
      h('h1', { class: 'screen-title' }, sm.contractDone ? 'Contract done' : 'Contract failed'),
      h('div', { class: 'ledger' }, stat('Bounty', `${sm.bounty}`, 'stat-gold'), stat('Loot', `${sm.lootValue}`, 'stat-gold'), stat('Out alive', `${sm.survivors.length}`), stat('Dead', `${sm.dead.length}`)),
      h(
        'div',
        { class: 'cols' },
        h(
          'div',
          null,
          h('h2', null, 'The party'),
          h(
            'ul',
            { class: 'hero-list' },
            ...[...sm.survivors, ...sm.dead.filter((x) => !sm.survivors.includes(x)), ...taken.filter((x) => !sm.survivors.includes(x) && !sm.dead.includes(x))].map((id) =>
              h(
                'li',
                { class: sm.dead.includes(id) ? 'dead' : taken.includes(id) ? 'taken' : '' },
                h('b', null, name(id)),
                h('span', { class: 'dim small' }, sm.dead.includes(id) ? ' fell' : taken.includes(id) ? ` taken by ${crewName}` : ` out · ${outHp(id)}`),
                sm.xp[id] ? h('span', { class: 'small pos' }, ` +${sm.xp[id]} XP`) : '',
                sm.levelUps.includes(id) ? h('span', { class: 'chip good' }, 'Level up!') : '',
              ),
            ),
          ),
        ),
        h('div', null, h('h2', null, 'Notes'), sm.notes.length ? h('ul', { class: 'loot-list' }, ...sm.notes.map((n) => h('li', null, n))) : h('p', { class: 'dim' }, 'Nothing worth a song.')),
      ),
      s.delve?.contract.story && sm.contractDone ? h('p', { class: 'prep-story' }, h('span', { class: 'seal-mini' }, '✦'), ` ${cap(STORY[s.delve.contract.story].who)} ${s.delve.contract.kind === 'rescue' ? 'is' : 'goes'} on the way home to Lowgate. Wins back: ${STORY[s.delve.contract.story].unlocks.toLowerCase()}.`) : '',
      taken.length && !heirTaken ? h('p', { class: 'warn-heir taken-line' }, h('span', { class: 'seal-mini seal-cap' }, '⛓'), ` ${taken.map(name).join(' and ')} ${taken.length === 1 ? 'was' : 'were'} dragged out by ${crewName}. Gold and gems are theirs now; the hero is held at their hideout at 1 HP. A "Bring back" job goes up on the notice post.`) : '',
      heirTaken ? h('p', { class: 'warn-heir' }, 'The heir is taken. Valkenburg stays dark.') : '',
      heirDead ? h('p', { class: 'warn-heir' }, 'Keven did not come back.') : '',
      h('div', { class: 'screen-actions' }, h('button', { class: 'btn btn-primary btn-big', onclick: () => host.send({ type: 'backToCamp' }) }, heirDead || heirTaken ? 'Continue' : 'Back to camp')),
    ),
  );
  if (sm.levelUps.length) sfx.play('levelup');
}

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
