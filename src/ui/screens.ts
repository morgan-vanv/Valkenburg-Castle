// Campaign screens: title, week, muster, debrief, won and lost.
// Each renders into a root element and talks back through callbacks.

import type { Engine } from '../engine/api';
import { label } from '../engine/geometry';
import type { Armor, Coord, GameState, MusterPlan, MusterSquad } from '../engine/types';
import { CAMPAIGN } from './rules';
import { clear, gold, h } from './dom';
import { ARMOR_NAME, CLASS_NAME } from './names';

export interface ScreenHost {
  engine: Engine;
  send(cmd: Parameters<Engine['apply']>[1]): Promise<boolean>;
  newCampaign(seed?: number): void;
  hasSave: boolean;
}

const HERO_COLOR: Record<string, string> = { hobart: '#d9a93a', rogier: '#3561c9', thorvold: '#b0702f', pim: '#3b9a4a', aldous: '#8a4cc9' };

function panel(title: string, kicker: string, ...body: (Node | string | null | false)[]): HTMLElement {
  return h('section', { class: 'screen-panel' }, h('p', { class: 'kicker' }, kicker), h('h1', { class: 'screen-title' }, title), ...body);
}

function seedForm(host: ScreenHost, label_ = 'New campaign'): HTMLElement {
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
      h('p', { class: 'lede' }, 'Your family’s castle is full of orcs and worse. The King wants his loan back in four weeks. Go and get the silver out.'),
      seedForm(host),
      h('p', { class: 'fine' }, 'Progress saves in this browser after every action.'),
    ),
  );
}

// ------------------------------------------------------------ week

export function weekScreen(root: HTMLElement, s: GameState, host: ScreenHost): void {
  clear(root);
  const alive = s.heroes.filter((x) => x.alive);
  const wagesNext = s.barracks * CAMPAIGN.wagePerMan + alive.reduce((n, x) => n + (x.cls === 'hobart' ? CAMPAIGN.wageHobart : CAMPAIGN.wagePerHero), 0);
  const hireLeft = Math.max(0, CAMPAIGN.hirePerWeek - (s.hiredThisWeek ?? 0));
  const affordable = Math.min(hireLeft, Math.floor(s.gold / CAMPAIGN.hireCost));
  const pct = Math.max(0, Math.min(100, (s.gold / s.goalGold) * 100));

  let hireN = Math.min(5, affordable);
  const hireOut = h('output', { class: 'num big-num' }, String(hireN));
  const hireCost = h('span', { class: 'num' }, '');
  const hireBtn = h('button', { class: 'btn' }, 'Hire');
  const updateHire = () => {
    hireOut.textContent = String(hireN);
    hireCost.textContent = `${gold(hireN * CAMPAIGN.hireCost)} g`;
    hireBtn.toggleAttribute('disabled', hireN < 1);
  };
  hireBtn.addEventListener('click', () => void host.send({ type: 'hire', men: hireN }));
  const step = (d: number) => () => {
    hireN = Math.max(affordable > 0 ? 1 : 0, Math.min(affordable, hireN + d));
    updateHire();
  };
  updateHire();

  const weeks = h('div', { class: 'week-track' });
  for (let i = 1; i <= s.maxWeeks; i++) weeks.appendChild(h('span', { class: i < s.week ? 'done' : i === s.week ? 'now' : '' }, String(i)));

  root.appendChild(
    panel(
      `Week ${s.week} of ${s.maxWeeks}`,
      'The siege of the treasury',
      weeks,
      h(
        'div',
        { class: 'ledger' },
        h('div', { class: 'stat stat-gold' }, h('span', { class: 'stat-label' }, 'Treasury'), h('span', { class: 'stat-value num' }, gold(s.gold)), h('span', { class: 'stat-unit' }, 'gold')),
        h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, 'Goal'), h('span', { class: 'stat-value num' }, gold(s.goalGold)), h('span', { class: 'stat-unit' }, 'by week ' + s.maxWeeks)),
        h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, 'Wages paid'), h('span', { class: 'stat-value num neg' }, '−' + gold(s.lastWages ?? 0)), h('span', { class: 'stat-unit' }, `next week ≈ ${gold(wagesNext)}`)),
        h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, 'Barracks'), h('span', { class: 'stat-value num' }, String(s.barracks)), h('span', { class: 'stat-unit' }, 'men')),
      ),
      h('div', { class: 'goal-bar', title: `${Math.round(pct)}% of the goal` }, h('i', { style: `width:${pct}%` })),
      h(
        'div',
        { class: 'cols' },
        h(
          'div',
          { class: 'col' },
          h('h2', null, 'Heroes'),
          h(
            'ul',
            { class: 'hero-list' },
            s.heroes.map((x) =>
              h(
                'li',
                { class: x.alive ? '' : 'dead' },
                h('span', { class: 'banner-chip', style: `background:${HERO_COLOR[x.id] ?? '#888'}` }),
                h('span', { class: 'hero-name' }, x.name),
                h('span', { class: 'hero-cls' }, x.alive ? CLASS_NAME[x.cls] : 'fallen'),
              ),
            ),
          ),
        ),
        h(
          'div',
          { class: 'col' },
          h('h2', null, 'Hire men'),
          h('p', { class: 'fine' }, `${CAMPAIGN.hireCost} gold a head, ${hireLeft} more this week. Each man costs ${CAMPAIGN.wagePerMan} gold a week in wages.`),
          h('div', { class: 'stepper' }, h('button', { class: 'btn btn-sq', onclick: step(-5), 'aria-label': 'Five fewer' }, '−5'), h('button', { class: 'btn btn-sq', onclick: step(-1), 'aria-label': 'One fewer' }, '−'), hireOut, h('button', { class: 'btn btn-sq', onclick: step(1), 'aria-label': 'One more' }, '+'), h('button', { class: 'btn btn-sq', onclick: step(5), 'aria-label': 'Five more' }, '+5')),
          h('div', { class: 'hire-row' }, hireCost, hireBtn),
        ),
      ),
      h(
        'div',
        { class: 'screen-actions' },
        h('button', { class: 'btn', onclick: () => void host.send({ type: 'skipWeek' }) }, 'Skip the week'),
        h('button', { class: 'btn btn-primary', onclick: () => void host.send({ type: 'beginMuster' }), disabled: s.gold < CAMPAIGN.outfitCost }, `Begin muster · ${CAMPAIGN.outfitCost} g`),
      ),
    ),
  );
}

// ------------------------------------------------------------ muster

interface DraftSquad {
  squad: MusterSquad;
  entrance: number;
}

interface Draft {
  heroes: Map<string, number>;
  squads: DraftSquad[];
}

let draft: Draft | null = null;
let draftWeek = -1;

export function musterScreen(root: HTMLElement, s: GameState, host: ScreenHost): void {
  const entrances: Coord[] = host.engine.map().levels.flatMap((l) => l.entrances);
  if (!draft || draftWeek !== s.week) {
    draftWeek = s.week;
    const heroes = new Map<string, number>();
    for (const id of ['hobart', 'thorvold', 'pim', 'aldous']) if (s.heroes.find((x) => x.id === id && x.alive)) heroes.set(id, 0);
    const squads: DraftSquad[] = [];
    let men = Math.min(s.barracks, CAMPAIGN.maxMen);
    let n = 1;
    while (men >= CAMPAIGN.squadMin && heroes.size + squads.length < CAMPAIGN.maxUnits && squads.length < 2) {
      const take = Math.min(10, men);
      squads.push({ squad: { id: `q${n}`, name: `${ordinal(n)} Squad`, men: take, armor: 'normal' }, entrance: 0 });
      men -= take;
      n++;
    }
    draft = { heroes, squads };
  }
  const d = draft;
  render();

  function totals() {
    const units = d.heroes.size + d.squads.length;
    const men = d.squads.reduce((a, q) => a + q.squad.men, 0);
    const problems: string[] = [];
    if (units < 1) problems.push('Send someone.');
    if (units > CAMPAIGN.maxUnits) problems.push(`At most ${CAMPAIGN.maxUnits} units.`);
    if (men > CAMPAIGN.maxMen) problems.push(`At most ${CAMPAIGN.maxMen} men.`);
    if (men > s.barracks) problems.push(`Only ${s.barracks} men in the barracks.`);
    for (const q of d.squads) if (q.squad.men < CAMPAIGN.squadMin || q.squad.men > CAMPAIGN.squadMax) problems.push(`Squads are ${CAMPAIGN.squadMin} to ${CAMPAIGN.squadMax} men.`);
    return { units, men, problems };
  }

  function entranceSelect(value: number, onChange: (i: number) => void): HTMLSelectElement {
    const sel = h(
      'select',
      { class: 'entrance-select', 'aria-label': 'Entrance' },
      entrances.map((e, i) => h('option', { value: i, selected: i === value }, `L${e.level} ${label(e)}${e.level === 3 ? ' (cavern)' : ''}`)),
    );
    sel.addEventListener('change', () => onChange(Number(sel.value)));
    return sel;
  }

  function render(): void {
    clear(root);
    const t = totals();
    const heroRows = s.heroes.map((x) => {
      const on = d.heroes.has(x.id);
      const cb = h('input', { type: 'checkbox', checked: on, disabled: !x.alive, 'aria-label': `Bring ${x.name}` });
      cb.addEventListener('change', () => {
        if (cb.checked) d.heroes.set(x.id, d.heroes.get(x.id) ?? 0);
        else d.heroes.delete(x.id);
        render();
      });
      return h(
        'tr',
        { class: `${x.alive ? '' : 'dead'} ${on ? 'on' : ''}` },
        h('td', null, h('label', { class: 'tick' }, cb, h('span', { class: 'banner-chip', style: `background:${HERO_COLOR[x.id] ?? '#888'}` }), x.name)),
        h('td', { class: 'dim' }, x.alive ? CLASS_NAME[x.cls] : 'fallen'),
        h('td', null, on ? entranceSelect(d.heroes.get(x.id) ?? 0, (i) => d.heroes.set(x.id, i)) : h('span', { class: 'dim' }, '—')),
      );
    });
    const squadRows = d.squads.map((q, idx) => {
      const menOut = h('output', { class: 'num' }, String(q.squad.men));
      const set = (n: number) => {
        q.squad.men = Math.max(CAMPAIGN.squadMin, Math.min(CAMPAIGN.squadMax, n));
        render();
      };
      const armor = h('select', { 'aria-label': 'Armour' }, (['unarmored', 'normal', 'heavy'] as Armor[]).map((a) => h('option', { value: a, selected: a === q.squad.armor }, `${ARMOR_NAME[a]} · move ${a === 'unarmored' ? 5 : a === 'normal' ? 4 : 3}`)));
      armor.addEventListener('change', () => (q.squad.armor = armor.value as Armor));
      return h(
        'tr',
        { class: 'on' },
        h('td', null, h('span', { class: 'counter-badge' }, 'S'), ' ', q.squad.name),
        h('td', null, h('div', { class: 'stepper small' }, h('button', { class: 'btn btn-sq', onclick: () => set(q.squad.men - 1), 'aria-label': 'Fewer men' }, '−'), menOut, h('button', { class: 'btn btn-sq', onclick: () => set(q.squad.men + 1), 'aria-label': 'More men' }, '+')), ' ', armor),
        h('td', null, entranceSelect(q.entrance, (i) => (q.entrance = i)), ' ', h('button', { class: 'btn btn-sq btn-ghost', onclick: () => (d.squads.splice(idx, 1), render()), 'aria-label': 'Remove squad', title: 'Disband' }, '×')),
      );
    });
    const canAdd = t.units < CAMPAIGN.maxUnits && s.barracks - t.men >= CAMPAIGN.squadMin && t.men + CAMPAIGN.squadMin <= CAMPAIGN.maxMen;
    const addSquad = () => {
      const free = Math.min(10, s.barracks - t.men, CAMPAIGN.maxMen - t.men);
      let n = 1;
      while (d.squads.some((q) => q.squad.name === `${ordinal(n)} Squad`)) n++;
      d.squads.push({ squad: { id: `q${Date.now() % 100000}${n}`, name: `${ordinal(n)} Squad`, men: Math.max(CAMPAIGN.squadMin, free), armor: 'normal' }, entrance: 0 });
      render();
    };
    const launch = () => {
      const plan: MusterPlan = {
        heroes: [...d.heroes.entries()].map(([heroId, e]) => ({ heroId, entrance: entrances[e]! })),
        squads: d.squads.map((q) => ({ squad: { ...q.squad }, entrance: entrances[q.entrance]! })),
      };
      void host.send({ type: 'launch', plan }).then((ok) => {
        if (ok) draft = null;
      });
    };
    root.appendChild(
      panel(
        'Muster',
        `Week ${s.week} · outfitting ${CAMPAIGN.outfitCost} g · 2 charges and climbing gear`,
        h(
          'div',
          { class: 'muster-caps' },
          cap('Units', t.units, CAMPAIGN.maxUnits),
          cap('Men', t.men, Math.min(CAMPAIGN.maxMen, s.barracks)),
          h('span', { class: 'cap' }, h('span', { class: 'cap-label' }, 'Barracks left'), h('span', { class: 'num' }, String(s.barracks - t.men))),
          h('span', { class: 'cap' }, h('span', { class: 'cap-label' }, 'Treasury'), h('span', { class: 'num' }, gold(s.gold))),
        ),
        h('h2', null, 'Heroes'),
        h('table', { class: 'muster-table' }, h('tbody', null, heroRows)),
        h('h2', null, 'Squads ', h('button', { class: 'btn btn-small', onclick: addSquad, disabled: !canAdd }, '+ Form a squad')),
        d.squads.length ? h('table', { class: 'muster-table' }, h('tbody', null, squadRows)) : h('p', { class: 'fine' }, 'No squads. Heroes alone carry little and die quickly.'),
        h('p', { class: 'problems' }, t.problems.join(' ')),
        h(
          'div',
          { class: 'screen-actions' },
          h('button', { class: 'btn', onclick: () => void host.send({ type: 'cancelMuster' }) }, 'Back'),
          h('button', { class: 'btn btn-primary btn-danger', onclick: launch, disabled: t.problems.length > 0 }, 'Launch the expedition'),
        ),
      ),
    );
  }
}

function cap(name: string, n: number, max: number): HTMLElement {
  return h('span', { class: `cap ${n > max ? 'over' : ''}` }, h('span', { class: 'cap-label' }, name), h('span', { class: 'num' }, `${n}/${max}`));
}

function ordinal(n: number): string {
  return ['1st', '2nd', '3rd'][n - 1] ?? `${n}th`;
}

// ------------------------------------------------------------ debrief

export function debriefScreen(root: HTMLElement, s: GameState, host: ScreenHost): void {
  clear(root);
  const r = s.lastDebrief;
  if (!r) {
    root.appendChild(panel('Debrief', 'Nothing to report', h('div', { class: 'screen-actions' }, h('button', { class: 'btn btn-primary', onclick: () => void host.send({ type: 'continueAfterDebrief' }) }, 'Continue'))));
    return;
  }
  const net = r.goldBanked - r.deathPayments;
  const counts = new Map<string, number>();
  for (const n of r.lootNames) counts.set(n, (counts.get(n) ?? 0) + 1);
  const quip = r.heroesLost.length ? 'The chaplain is running out of nice things to say.' : r.menLost > 5 ? 'The widows’ fund grows faster than the treasury.' : r.goldBanked === 0 ? 'A brisk walk in the dark. Character-building, the sergeant says.' : 'Not bad. The King will hear of it, eventually.';
  root.appendChild(
    panel(
      `Week ${r.week} debrief`,
      'Back at the gatehouse',
      h(
        'div',
        { class: 'ledger' },
        h('div', { class: 'stat stat-gold' }, h('span', { class: 'stat-label' }, 'Banked'), h('span', { class: 'stat-value num' }, '+' + gold(r.goldBanked)), h('span', { class: 'stat-unit' }, 'gold')),
        h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, 'Men lost'), h('span', { class: `stat-value num ${r.menLost ? 'neg' : ''}` }, String(r.menLost)), h('span', { class: 'stat-unit' }, 'killed or left inside')),
        h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, 'Death payments'), h('span', { class: 'stat-value num neg' }, '−' + gold(r.deathPayments)), h('span', { class: 'stat-unit' }, 'to the families')),
        h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, 'Rescued'), h('span', { class: 'stat-value num' }, String(r.prisonersRescued)), h('span', { class: 'stat-unit' }, 'prisoners')),
      ),
      h('p', { class: 'net' }, 'Net ', h('span', { class: `num ${net < 0 ? 'neg' : 'pos'}` }, `${net >= 0 ? '+' : '−'}${gold(Math.abs(net))} g`), ' · treasury now ', h('span', { class: 'num' }, gold(s.gold))),
      h(
        'div',
        { class: 'cols' },
        h('div', { class: 'col' }, h('h2', null, 'Carried out'), counts.size ? h('ul', { class: 'loot-list' }, [...counts].map(([n, c]) => h('li', null, c > 1 ? `${n} ×${c}` : n))) : h('p', { class: 'fine' }, 'Nothing but bruises.')),
        h('div', { class: 'col' }, h('h2', null, 'Fallen heroes'), r.heroesLost.length ? h('ul', { class: 'loot-list fallen' }, r.heroesLost.map((n) => h('li', null, n))) : h('p', { class: 'fine' }, 'None. Remarkable.')),
      ),
      h('p', { class: 'quip' }, quip),
      h('div', { class: 'screen-actions' }, h('button', { class: 'btn btn-primary', onclick: () => void host.send({ type: 'continueAfterDebrief' }) }, s.week >= s.maxWeeks ? 'Face the King' : 'Next week')),
    ),
  );
}

// ------------------------------------------------------------ the end

export function endScreen(root: HTMLElement, s: GameState, host: ScreenHost): void {
  clear(root);
  const won = s.stage === 'won';
  root.appendChild(
    h(
      'section',
      { class: `screen-panel end-panel ${won ? 'won' : 'lost'}` },
      h('p', { class: 'kicker' }, won ? 'Victory' : 'Defeat'),
      h('h1', { class: 'game-title' }, won ? 'The treasury holds' : 'Valkenburg falls'),
      h('p', { class: 'lede' }, s.endReason ?? ''),
      h('p', { class: 'fine' }, `Week ${s.week} · ${gold(s.gold)} gold · seed ${s.seed}`),
      seedForm(host, 'New campaign'),
    ),
  );
}
