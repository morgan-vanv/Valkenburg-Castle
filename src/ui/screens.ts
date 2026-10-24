// Screens around the run (V2): title, shop and deploy, results.
// Each renders into a root element and talks back through callbacks.

import type { Engine } from '../engine/api';
import { RUN } from '../engine/data';
import { label } from '../engine/geometry';
import type { Coord, GameState, ItemId, Medal } from '../engine/types';
import { clear, gold, h } from './dom';
import { CLASS_NAME } from './names';

export interface ScreenHost {
  engine: Engine;
  send(cmd: Parameters<Engine['apply']>[1]): Promise<boolean>;
  newCampaign(seed?: number): void;
  hasSave: boolean;
}

const HERO_COLOR: Record<string, string> = { hobart: '#d9a93a', thorvold: '#b0702f', pim: '#3b9a4a', aldous: '#8a4cc9' };

function panel(title: string, kicker: string, ...body: (Node | string | null | false)[]): HTMLElement {
  return h('section', { class: 'screen-panel' }, h('p', { class: 'kicker' }, kicker), h('h1', { class: 'screen-title' }, title), ...body);
}

function seedForm(host: ScreenHost, label_ = 'New run'): HTMLElement {
  const input = h('input', { class: 'seed', type: 'text', inputmode: 'numeric', placeholder: 'random seed', 'aria-label': 'Seed (optional)', maxlength: 10 });
  const go = () => {
    const raw = input.value.trim();
    const n = raw ? Number.parseInt(raw, 10) : undefined;
    host.newCampaign(n !== undefined && Number.isFinite(n) ? n >>> 0 : undefined);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') go();
  });
  return h('div', { class: 'seed-row' }, h('button', { class: 'btn btn-primary', onclick: go }, label_), h('label', { class: 'seed-label' }, 'Seed ', input));
}

// ------------------------------------------------------------ title

export function titleScreen(root: HTMLElement, host: ScreenHost): void {
  clear(root);
  root.appendChild(
    h(
      'section',
      { class: 'screen-panel title-panel' },
      h('p', { class: 'kicker' }, 'Task Force Games, 1980 · reforged'),
      h('h1', { class: 'game-title' }, 'Valkenburg Castle'),
      h('p', { class: 'lede' }, 'Your family’s castle is full of orcs and worse. Go in, take what glitters, and get Lord Hobart out alive.'),
      seedForm(host),
      h('p', { class: 'fine' }, `Bronze ${gold(RUN.medals.bronze)} · Silver ${gold(RUN.medals.silver)} · Gold ${gold(RUN.medals.gold)}. Progress saves in this browser.`),
    ),
  );
}

// ------------------------------------------------------------ shop and deploy

let entranceChoice: Record<string, number> = {};
let entranceSeed = -1;

const SQUAD_NAMES: Record<string, string> = { squad1: '1st Squad', squad2: '2nd Squad', sellswords: 'Sellswords' };

export function shopScreen(root: HTMLElement, s: GameState, host: ScreenHost): void {
  const entrances: Coord[] = host.engine.map().levels.flatMap((l) => l.entrances);
  if (entranceSeed !== s.seed) {
    entranceSeed = s.seed;
    entranceChoice = {};
  }
  clear(root);
  const shop = host.engine.shop();
  const itemRows = shop.map((it) => {
    const owned = s.pack[it.id] ?? 0;
    const canBuy = s.purse >= it.cost && owned < it.max;
    return h(
      'tr',
      { class: owned ? 'on' : '' },
      h('td', null, h('strong', null, it.name), h('div', { class: 'dim' }, it.text)),
      h('td', { class: 'num' }, `${it.cost} g`),
      h(
        'td',
        null,
        h(
          'div',
          { class: 'stepper small' },
          h('button', { class: 'btn btn-sq', onclick: () => void host.send({ type: 'refund', item: it.id as ItemId }), disabled: owned < 1, 'aria-label': `Return ${it.name}` }, '−'),
          h('output', { class: 'num' }, `${owned}/${it.max}`),
          h('button', { class: 'btn btn-sq', onclick: () => void host.send({ type: 'buy', item: it.id as ItemId }), disabled: !canBuy, 'aria-label': `Buy ${it.name}` }, '+'),
        ),
      ),
    );
  });

  const entranceSelect = (key: string): HTMLSelectElement => {
    const sel = h(
      'select',
      { class: 'entrance-select', 'aria-label': 'Entrance' },
      entrances.map((e, i) => h('option', { value: i, selected: i === (entranceChoice[key] ?? 0) }, `${label(e)} ${i === 0 ? '(west gate)' : '(south gate)'}`)),
    );
    sel.addEventListener('change', () => (entranceChoice[key] = Number(sel.value)));
    return sel;
  };
  const keys = host.engine.companyKeys(s);
  const companyRows = keys.map((key) => {
    const hero = s.heroes.find((x) => x.id === key);
    const men = key === 'sellswords' ? RUN.sellswordMen : RUN.squadMen;
    return h(
      'tr',
      { class: 'on' },
      h(
        'td',
        null,
        hero
          ? h('span', { class: 'tick' }, h('span', { class: 'banner-chip', style: `background:${HERO_COLOR[hero.id] ?? '#888'}` }), hero.name)
          : h('span', null, h('span', { class: 'counter-badge' }, 'S'), ' ', SQUAD_NAMES[key] ?? key),
      ),
      h('td', { class: 'dim' }, hero ? CLASS_NAME[hero.cls] : `${men} men · carries ${Math.ceil(men / 2)} sacks`),
      h('td', null, entranceSelect(key)),
    );
  });
  const launch = () => {
    const plan = { entrances: Object.fromEntries(keys.map((k) => [k, entrances[entranceChoice[k] ?? 0]!])) };
    void host.send({ type: 'launch', plan });
  };
  root.appendChild(
    panel(
      'Into the castle',
      'One run · get Lord Hobart out with as much gold as you can carry',
      h('div', { class: 'muster-caps' }, h('span', { class: 'cap' }, h('span', { class: 'cap-label' }, 'Purse'), h('span', { class: 'num' }, `${gold(s.purse)} g`)), h('span', { class: 'cap' }, h('span', { class: 'cap-label' }, 'Unspent gold'), h('span', { class: 'num' }, 'counts toward your score'))),
      h('h2', null, 'Quartermaster'),
      h('table', { class: 'muster-table' }, h('tbody', null, itemRows)),
      h('h2', null, 'The company'),
      h('table', { class: 'muster-table' }, h('tbody', null, companyRows)),
      h('p', { class: 'fine' }, 'Heroes carry 1 sack (Thorvold 2); squads 1 per 2 men. Carrying anything costs 1 move. Loot only counts once it is outside.'),
      h('div', { class: 'screen-actions' }, h('button', { class: 'btn btn-primary btn-danger', onclick: launch }, 'Enter the castle')),
    ),
  );
}

// ------------------------------------------------------------ results

const MEDAL_NAME: Record<Medal, string> = { gold: 'Gold', silver: 'Silver', bronze: 'Bronze', none: 'No medal' };

export function resultsScreen(root: HTMLElement, s: GameState, host: ScreenHost): void {
  clear(root);
  const r = s.result;
  if (!r) {
    titleScreen(root, host);
    return;
  }
  const counts = new Map<string, number>();
  for (const n of r.lootNames) counts.set(n, (counts.get(n) ?? 0) + 1);
  const next = r.medal === 'gold' ? null : r.medal === 'silver' ? RUN.medals.gold : r.medal === 'bronze' ? RUN.medals.silver : RUN.medals.bronze;
  const quip = !r.survived
    ? 'The Van Valkenburg line ends in the dark. The orcs keep the silver.'
    : r.medal === 'gold'
      ? 'The King may yet get his loan back. Do not tell him how.'
      : r.heroesLost.length
        ? 'The chaplain is running out of nice things to say.'
        : r.lootGold === 0
          ? 'A brisk walk in the dark. Character-building, the sergeant says.'
          : 'Not bad. The Deep held more, if you have the nerve.';
  root.appendChild(
    h(
      'section',
      { class: `screen-panel end-panel ${r.survived ? 'won' : 'lost'}` },
      h('p', { class: 'kicker' }, r.survived ? `${MEDAL_NAME[r.medal]}${r.medal !== 'none' ? ' medal' : ''}` : 'Defeat'),
      h('h1', { class: 'game-title' }, r.survived ? `${gold(r.score)} gold` : 'Valkenburg keeps its lord'),
      h('p', { class: 'lede' }, r.reason),
      h(
        'div',
        { class: 'ledger' },
        h('div', { class: 'stat stat-gold' }, h('span', { class: 'stat-label' }, 'Loot'), h('span', { class: 'stat-value num' }, gold(r.lootGold)), h('span', { class: 'stat-unit' }, 'carried out')),
        h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, 'Purse'), h('span', { class: 'stat-value num' }, gold(r.purseLeft)), h('span', { class: 'stat-unit' }, 'unspent')),
        h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, 'Men lost'), h('span', { class: `stat-value num ${r.menLost ? 'neg' : ''}` }, String(r.menLost)), h('span', { class: 'stat-unit' }, 'killed or left inside')),
        h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, 'Turns'), h('span', { class: 'stat-value num' }, String(r.turns)), h('span', { class: 'stat-unit' }, 'inside')),
      ),
      h(
        'div',
        { class: 'cols' },
        h('div', { class: 'col' }, h('h2', null, 'Carried out'), counts.size ? h('ul', { class: 'loot-list' }, [...counts].map(([n, c]) => h('li', null, c > 1 ? `${n} ×${c}` : n))) : h('p', { class: 'fine' }, 'Nothing but bruises.')),
        h('div', { class: 'col' }, h('h2', null, 'Fallen heroes'), r.heroesLost.length ? h('ul', { class: 'loot-list fallen' }, r.heroesLost.map((n) => h('li', null, n))) : h('p', { class: 'fine' }, 'None. Remarkable.')),
      ),
      h('p', { class: 'quip' }, quip),
      next ? h('p', { class: 'fine' }, `Next medal at ${gold(next)} gold.`) : null,
      h('p', { class: 'fine' }, `Seed ${s.seed}`),
      seedForm(host, 'Run again'),
    ),
  );
}
