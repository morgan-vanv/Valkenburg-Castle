// Full-screen pages: title, camp (stations), prepare delve, summary, game over.

import type { Engine } from '../game/api';
import type { Command, Contract, GameState, Hero, Item } from '../game/types';
import { sfx } from '../audio/sfx';
import { clear, gold, h } from './dom';
import { ITEM_EFFECT, itemBase, CLASS_GEAR, CLASS_KIT, CLASS_ROLE, classGlyph, className, itemGlyph, itemLabel } from './names';

export interface ScreenHost {
  engine: Engine;
  send(cmd: Command): Promise<boolean>;
  newCampaign(seed: number): void;
  continueGame(): void;
  hasSave: boolean;
  /** Remembered loadout from the last delve. */
  lastLoadout: Loadout | null;
  saveLoadout(l: Loadout): void;
  /** Camp station shown. */
  station: Station;
  setStation(s: Station): void;
}

export type Station = 'board' | 'quartermaster' | 'smithy' | 'tavern' | 'infirmary' | 'stash' | 'memorial' | 'prepare';

export interface Loadout {
  contractId?: string;
  heroIds: string[];
  packs: Record<string, string[]>;
  entrance: number;
}

const TITLE = 'Valkenburg Castle';
const SUBTITLE = "Hobart's Revenge";

const WEAPON_PRICE = [0, 60, 150];
const ARMOR_PRICE = [0, 80, 200];
const HEAL_PRICE = 30;
const LEVEL_XP = [0, 0, 5, 12, 20, 30, 45];

// ------------------------------------------------------------ title

export function titleScreen(el: HTMLElement, host: ScreenHost): void {
  clear(el);
  const seed = h('input', { class: 'seed', type: 'text', inputmode: 'numeric', placeholder: 'random', 'aria-label': 'Seed' }) as HTMLInputElement;
  el.append(
    h(
      'div',
      { class: 'screen-panel title-panel' },
      h('div', { class: 'kicker' }, 'A delve into the ruined seat of the Van Valkenburgs'),
      h('h1', { class: 'game-title' }, TITLE, h('span', { class: 'game-sub' }, SUBTITLE)),
      h('p', { class: 'lede' }, 'The keep fell three generations ago. Lord Hobart, last of the line, wants it back, one contract at a time. Mind the lantern. Something waits for the dark.'),
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

// ------------------------------------------------------------ camp

const STATIONS: { id: Station; name: string; glyph: string; blurb: string }[] = [
  { id: 'board', name: 'Bounty board', glyph: '✠', blurb: 'Pick a contract' },
  { id: 'quartermaster', name: 'Quartermaster', glyph: '⚱', blurb: 'Torches, potions, rope' },
  { id: 'smithy', name: 'Smithy', glyph: '⚒', blurb: 'Better blades and mail' },
  { id: 'tavern', name: 'Tavern', glyph: '☕', blurb: 'Hire hands' },
  { id: 'infirmary', name: 'Infirmary', glyph: '✚', blurb: 'Patch the wounded' },
  { id: 'stash', name: 'Stash', glyph: '▣', blurb: 'Gold and goods' },
  { id: 'memorial', name: 'Memorial', glyph: '✝', blurb: 'The fallen' },
];

export function campScreen(el: HTMLElement, s: GameState, host: ScreenHost): void {
  clear(el);
  const c = s.campaign;
  const nav = h('nav', { class: 'camp-nav' });
  for (const st of STATIONS) {
    const badge = st.id === 'infirmary' ? c.roster.filter((x) => x.wounded > 0).length : st.id === 'memorial' ? c.fallen.length : st.id === 'tavern' ? c.recruits.length : 0;
    nav.append(
      h(
        'button',
        { class: `station ${host.station === st.id ? 'on' : ''} ${st.id === 'tavern' && needsHire(s) ? 'call' : ''}`, onclick: () => host.setStation(st.id) },
        h('span', { class: 'st-glyph' }, st.glyph),
        h('span', { class: 'st-text' }, h('b', null, st.name), h('span', { class: 'dim small' }, st.blurb)),
        badge ? h('span', { class: 'st-badge num' }, `${badge}`) : '',
      ),
    );
  }
  const head = h(
    'header',
    { class: 'camp-head' },
    h('div', null, h('div', { class: 'kicker' }, `Camp below the keep · delve ${c.delveCount + 1}`), h('h1', { class: 'screen-title' }, "Hobart's camp")),
    h('div', { class: 'ledger' }, stat('Gold', gold(c.gold), 'stat-gold'), stat('Reputation', `${c.reputation}`), stat('Roster', `${c.roster.length}`), stat('Fallen', `${c.fallen.length}`)),
  );
  const body = h('section', { class: 'camp-body' });
  switch (host.station) {
    case 'board':
      boardStation(body, s, host);
      break;
    case 'quartermaster':
      shopStation(body, s, host);
      break;
    case 'smithy':
      smithyStation(body, s, host);
      break;
    case 'tavern':
      tavernStation(body, s, host);
      break;
    case 'infirmary':
      infirmaryStation(body, s, host);
      break;
    case 'stash':
      stashStation(body, s, host);
      break;
    case 'memorial':
      memorialStation(body, s);
      break;
    case 'prepare':
      prepareStation(body, s, host);
      break;
  }
  const rosterStrip = h('aside', { class: 'camp-roster' }, h('div', { class: 'kicker' }, 'Roster'), ...c.roster.map((hr) => heroChip(hr)));
  el.append(h('div', { class: 'camp' }, head, h('div', { class: 'camp-grid' }, nav, body, rosterStrip)));
}

function stat(label: string, value: string, cls = ''): HTMLElement {
  return h('div', { class: `stat ${cls}` }, h('span', { class: 'stat-label' }, label), h('span', { class: 'stat-value num' }, value));
}

function classBadge(cls: string): HTMLElement {
  return h('span', { class: `cbadge cls-${cls}`, title: className(cls) }, classGlyph(cls));
}

/** Hobart alone: the squad needs hiring before the first delve. */
function needsHire(s: GameState): boolean {
  return !s.campaign.roster.some((x) => x.cls !== 'hobart' && x.wounded === 0);
}

function heroChip(hr: Hero): HTMLElement {
  const next = LEVEL_XP[hr.level + 1];
  return h(
    'div',
    { class: `hchip ${hr.wounded ? 'wounded' : ''}` },
    classBadge(hr.cls),
    h('div', null, h('b', null, hr.name), h('div', { class: 'dim small' }, `L${hr.level} ${className(hr.cls)} · ${hr.maxHp} HP${next ? ` · XP ${hr.xp}/${next}` : ''}`), hr.wounded ? h('div', { class: 'neg small' }, `Wounded: sits out ${hr.wounded}`) : ''),
  );
}

function stationHead(title: string, text: string): HTMLElement {
  return h('div', { class: 'st-head' }, h('h2', null, title), h('p', { class: 'dim' }, text));
}

// ---- board

function boardStation(el: HTMLElement, s: GameState, host: ScreenHost): void {
  el.append(stationHead('Bounty board', 'Three jobs nailed to the post. Bounties pay only if the prize comes out with you.'));
  const hire = needsHire(s);
  if (hire)
    el.append(
      h(
        'div',
        { class: 'hire-first' },
        h('b', null, 'Hire at least one hero'),
        h('span', null, ' Lord Hobart will not go in alone. Visit the tavern first.'),
        h('button', { class: 'btn btn-primary btn-small', onclick: () => host.setStation('tavern') }, 'Go to the tavern'),
      ),
    );
  const grid = h('div', { class: 'contracts' });
  for (const k of s.campaign.board) grid.append(contractCard(k, host, hire));
  el.append(grid);
  if (host.lastLoadout && s.campaign.board.length) {
    el.append(
      h(
        'div',
        { class: 'screen-actions' },
        h(
          'button',
          {
            class: 'btn',
            onclick: () => {
              host.setStation('prepare');
            },
          },
          'Last loadout',
        ),
      ),
    );
  }
}

const KIND_WORD: Record<Contract['kind'], string> = { rescue: 'Rescue', recover: 'Recover', slay: 'Slay' };

function contractCard(k: Contract, host: ScreenHost, locked = false): HTMLElement {
  return h(
    'article',
    { class: `contract kind-${k.kind}` },
    h('div', { class: 'ct-top' }, h('span', { class: 'kicker' }, `${KIND_WORD[k.kind]} · Level ${k.level}`), h('span', { class: 'ct-bounty num' }, `${k.bounty}`, h('small', null, ' gold'))),
    k.kind === 'slay' ? h('h3', null, h('span', { class: 'ct-dragon', 'aria-hidden': 'true' }, '🐉 '), k.title) : h('h3', null, k.title),
    h('p', null, k.brief),
    k.warnings.length ? h('ul', { class: 'ct-warn' }, ...k.warnings.map((w) => h('li', null, w))) : h('p', { class: 'dim small' }, 'No warnings posted.'),
    h(
      'button',
      {
        class: 'btn btn-primary',
        disabled: locked,
        title: locked ? 'Hire at least one hero first' : '',
        onclick: () => {
          const l = host.lastLoadout ?? { heroIds: [], packs: {}, entrance: 0 };
          host.saveLoadout({ ...l, contractId: k.id });
          host.setStation('prepare');
        },
      },
      'Take the job',
    ),
  );
}

// ---- quartermaster

function shopStation(el: HTMLElement, s: GameState, host: ScreenHost): void {
  el.append(stationHead('Quartermaster', 'Bought goods go to the stash. Give them out when you prepare a delve.'));
  const list = h('div', { class: 'shop' });
  for (const o of host.engine.shop()) {
    const have = s.campaign.stash.filter((i) => i.kind === o.kind).length;
    list.append(
      h(
        'div',
        { class: 'shop-row' },
        h('span', { class: 'shop-glyph' }, itemGlyph(o.kind)),
        h('div', null, h('b', null, o.name), h('div', { class: 'dim small' }, ITEM_EFFECT[itemBase(o.kind)] ?? o.text)),
        h('span', { class: 'dim small' }, `In stash: ${have}`),
        h(
          'button',
          {
            class: 'btn btn-small',
            disabled: s.campaign.gold < o.price,
            onclick: async () => {
              if (await host.send({ type: 'buy', kind: o.kind })) sfx.play('coin');
            },
          },
          `Buy · ${o.price}`,
        ),
      ),
    );
  }
  el.append(list);
}

// ---- smithy

function smithyStation(el: HTMLElement, s: GameState, host: ScreenHost): void {
  el.append(stationHead('Smithy', 'Weapon tiers add +10% per slot per tier. Armor tiers soak 1 more damage per hit.'));
  const t = h('table', { class: 'tbl' });
  t.append(h('tr', null, h('th', null, 'Hero'), h('th', null, 'Weapon'), h('th', null, 'Armor')));
  for (const hr of s.campaign.roster) {
    const cell = (part: 'weapon' | 'armor') => {
      const tier = part === 'weapon' ? hr.weaponTier : hr.armorTier;
      const price = tier >= 2 ? null : (part === 'weapon' ? WEAPON_PRICE : ARMOR_PRICE)[tier + 1]!;
      return h(
        'td',
        null,
        h('span', { class: 'tiers' }, ...[1, 2].map((n) => h('i', { class: n <= tier ? 'on' : '' }))),
        price === null
          ? h('span', { class: 'dim small' }, ' Best')
          : h(
              'button',
              {
                class: 'btn btn-small',
                disabled: s.campaign.gold < price,
                onclick: async () => {
                  if (await host.send({ type: 'upgrade', heroId: hr.id, part })) sfx.play('smash', { pitch: 2, gain: 0.4 });
                },
              },
              `Tier ${tier + 1} · ${price}`,
            ),
      );
    };
    t.append(h('tr', null, h('td', null, classBadge(hr.cls), ' ', hr.name), cell('weapon'), cell('armor')));
  }
  el.append(t);
}

// ---- tavern

function tavernStation(el: HTMLElement, s: GameState, host: ScreenHost): void {
  const hire = needsHire(s);
  el.append(stationHead('Tavern', hire ? `Lord Hobart can't take the castle alone. Hire at least one hero: you have ${gold(s.campaign.gold)} gold.` : 'Blades, bows, sneaks and spellcasters, for a price. Offers change after every delve.'));
  const grid = h('div', { class: 'recruits' });
  if (!s.campaign.recruits.length) grid.append(h('p', { class: 'dim' }, 'Nobody looking for work. Come back after the next delve.'));
  for (const r of s.campaign.recruits) grid.append(recruitCard(r.hero, r.price, s, host));
  el.append(grid);
  if (!hire)
    el.append(h('div', { class: 'screen-actions' }, h('button', { class: 'btn', onclick: () => host.setStation('board') }, 'To the bounty board')));
}

function recruitCard(hr: Hero, price: number, s: GameState, host: ScreenHost): HTMLElement {
  const st = hr.stats;
  const bar = (label: string, v: number) => h('div', { class: 'rc-stat' }, h('span', { class: 'dim' }, label), h('span', { class: 'rc-bar' }, h('i', { style: `width:${Math.min(100, v)}%` })), h('b', { class: 'num' }, `${v}`));
  // The engine's class text first; the UI's own tables as fallback.
  let info: ReturnType<Engine['classInfo']> | null = null;
  try {
    info = host.engine.classInfo(hr.cls);
  } catch {
    info = null;
  }
  const role = info?.role || CLASS_ROLE[hr.cls as keyof typeof CLASS_ROLE] || '';
  const gear = info ? `${info.weapon} · Armor ${info.armor}${info.mana ? ` · Mana ${info.mana}` : ''}` : (CLASS_GEAR[hr.cls as keyof typeof CLASS_GEAR] ?? '');
  const kit: HTMLElement[] = info?.abilities.length
    ? info.abilities.map((line) => {
        const m = /^([^:(]+)(\([^)]*\))?:?\s*(.*)$/.exec(line);
        return m ? h('li', null, h('b', null, m[1]!.trim()), m[2] ? h('span', { class: 'rc-cost' }, m[2].slice(1, -1)) : '', h('span', null, m[3] ?? '')) : h('li', null, h('span', null, line));
      })
    : (CLASS_KIT[hr.cls as keyof typeof CLASS_KIT] ?? []).map(([name, cost, text]) => h('li', null, h('b', null, name), h('span', { class: 'rc-cost' }, cost), h('span', null, text)));
  return h(
    'div',
    { class: `recruit cls-${hr.cls}` },
    h('div', { class: 'rc-head' }, classBadge(hr.cls), h('div', null, h('b', null, hr.name), h('div', { class: 'dim small' }, `Level ${hr.level} ${className(hr.cls)} · ${hr.maxHp} HP`))),
    h('p', { class: 'rc-role' }, role),
    h('div', { class: 'rc-stats small' }, bar('Might', st.might), bar('Finesse', st.finesse), bar('Wits', st.wits), bar('Nerve', st.nerve)),
    h('div', { class: 'rc-gear small dim' }, gear),
    kit.length ? h('ul', { class: 'rc-kit small' }, ...kit) : '',
    h(
      'button',
      {
        class: 'btn btn-small btn-primary',
        disabled: s.campaign.gold < price,
        onclick: async () => {
          if (await host.send({ type: 'hire', heroId: hr.id })) sfx.play('coin');
        },
      },
      `Hire · ${price}`,
    ),
  );
}

// ---- infirmary

function infirmaryStation(el: HTMLElement, s: GameState, host: ScreenHost): void {
  el.append(stationHead('Infirmary', `Wounded heroes sit out contracts. The surgeon can patch one up at once for ${HEAL_PRICE} gold.`));
  const hurt = s.campaign.roster.filter((x) => x.wounded > 0);
  if (!hurt.length) {
    el.append(h('p', { class: 'dim' }, 'Every cot is empty.'));
    return;
  }
  const list = h('div', { class: 'shop' });
  for (const hr of hurt)
    list.append(
      h(
        'div',
        { class: 'shop-row' },
        classBadge(hr.cls),
        h('div', null, h('b', null, hr.name), h('div', { class: 'dim small' }, `Sits out ${hr.wounded} more contract${hr.wounded > 1 ? 's' : ''}`)),
        h('span', null),
        h(
          'button',
          {
            class: 'btn btn-small',
            disabled: s.campaign.gold < HEAL_PRICE,
            onclick: async () => {
              if (await host.send({ type: 'heal', heroId: hr.id })) sfx.play('spell');
            },
          },
          `Heal now · ${HEAL_PRICE}`,
        ),
      ),
    );
  el.append(list);
}

// ---- stash

function stashStation(el: HTMLElement, s: GameState, host: ScreenHost): void {
  const c = s.campaign;
  const valuables = c.stash.filter((i) => i.kind === 'gem' || i.kind === 'jewelry' || i.kind === 'heirloom');
  const worth = host.engine.value(valuables);
  el.append(stationHead('Stash', `${gold(c.gold)} gold in the chest.`));
  if (!c.stash.length) el.append(h('p', { class: 'dim' }, 'Nothing but dust.'));
  else el.append(h('ul', { class: 'stash-list' }, ...groupItems(c.stash).map(([it, n]) => h('li', null, h('span', { class: 'shop-glyph' }, itemGlyph(it.kind)), itemLabel(it), n > 1 ? h('span', { class: 'dim' }, ` ×${n}`) : ''))));
  el.append(
    h(
      'div',
      { class: 'screen-actions' },
      h(
        'button',
        {
          class: 'btn btn-primary',
          disabled: !valuables.length,
          onclick: async () => {
            if (await host.send({ type: 'sellAll' })) sfx.play('coin');
          },
        },
        valuables.length ? `Sell valuables · ${worth} gold` : 'No valuables to sell',
      ),
    ),
  );
}

function groupItems(items: Item[]): [Item, number][] {
  const m = new Map<string, [Item, number]>();
  for (const i of items) {
    const k = i.kind === 'gem' || i.kind === 'jewelry' || i.kind === 'heirloom' ? i.id : i.kind;
    const e = m.get(k);
    if (e) e[1]++;
    else m.set(k, [i, 1]);
  }
  return [...m.values()];
}

// ---- memorial

function memorialStation(el: HTMLElement, s: GameState): void {
  el.append(stationHead('Memorial', 'Names cut in the old gatepost.'));
  if (!s.campaign.fallen.length) {
    el.append(h('p', { class: 'dim' }, 'No names yet. Keep it that way.'));
    return;
  }
  el.append(h('ul', { class: 'memorial' }, ...s.campaign.fallen.map((f) => h('li', null, classBadge(f.cls), h('b', null, f.name), h('span', { class: 'dim small' }, ` L${f.level} ${className(f.cls)} · ${f.where} · delve ${f.delve}`)))));
}

// ---- prepare

function prepareStation(el: HTMLElement, s: GameState, host: ScreenHost): void {
  const c = s.campaign;
  const prev = host.lastLoadout ?? { heroIds: [], packs: {}, entrance: 0 };
  const contract = c.board.find((k) => k.id === prev.contractId) ?? c.board[0];
  if (!contract) {
    el.append(h('p', null, 'No contracts on the board.'));
    return;
  }
  // Clean the remembered loadout against the current state.
  const fit = (id: string) => c.roster.some((x) => x.id === id && x.wounded === 0);
  const l: Loadout = {
    contractId: contract.id,
    heroIds: prev.heroIds.filter(fit).slice(0, 4),
    packs: {},
    entrance: Math.min(prev.entrance, host.engine.castle().entrances.length - 1),
  };
  const used = new Set<string>();
  for (const id of l.heroIds) {
    const want = (prev.packs[id] ?? []).filter((iid) => c.stash.some((i) => i.id === iid) && !used.has(iid));
    const pack: string[] = [];
    let slots = 0;
    for (const iid of want) {
      const it = c.stash.find((i) => i.id === iid)!;
      if (slots + it.slots > 4) continue;
      slots += it.slots;
      pack.push(iid);
      used.add(iid);
    }
    l.packs[id] = pack;
  }
  if (!l.heroIds.length) l.heroIds = c.roster.filter((x) => x.wounded === 0).slice(0, 4).map((x) => x.id);
  const save = () => {
    host.saveLoadout(l);
    host.setStation('prepare');
  };

  el.append(stationHead(`Prepare: ${contract.title}`, contract.brief));
  // Contract switcher.
  el.append(h('div', { class: 'prep-contracts' }, ...c.board.map((k) => h('button', { class: `btn btn-small ${k.id === contract.id ? 'on' : ''}`, onclick: () => ((l.contractId = k.id), save()) }, `${KIND_WORD[k.kind]} L${k.level} · ${k.bounty}`))));

  // Party.
  const party = h('div', { class: 'prep-party' });
  for (const hr of c.roster) {
    const on = l.heroIds.includes(hr.id);
    const disabled = hr.wounded > 0 || (!on && l.heroIds.length >= 4);
    party.append(
      h(
        'button',
        {
          class: `pick-hero ${on ? 'on' : ''} ${hr.wounded ? 'wounded' : ''}`,
          disabled,
          onclick: () => {
            if (on) {
              l.heroIds = l.heroIds.filter((x) => x !== hr.id);
              delete l.packs[hr.id];
            } else l.heroIds.push(hr.id);
            sfx.play('click');
            save();
          },
        },
        h('span', { class: 'tick' }, on ? '✔' : ''),
        classBadge(hr.cls),
        h('div', null, h('b', null, hr.name), h('div', { class: 'dim small' }, hr.wounded ? `Wounded (${hr.wounded})` : `L${hr.level} ${className(hr.cls)} · ${hr.maxHp} HP`)),
      ),
    );
  }
  el.append(h('h3', { class: 'prep-h' }, `Party `, h('span', { class: 'dim small' }, `${l.heroIds.length}/4`)), party);
  if (l.heroIds.includes('hobart') || l.heroIds.some((id) => c.roster.find((x) => x.id === id)?.cls === 'hobart')) {
    el.append(h('p', { class: 'warn-hobart' }, '⚠ If Hobart dies, it is over. The campaign ends with him.'));
  }

  // Packs.
  const free = c.stash.filter((i) => !Object.values(l.packs).flat().includes(i.id));
  const packs = h('div', { class: 'prep-packs' });
  for (const id of l.heroIds) {
    const hr = c.roster.find((x) => x.id === id)!;
    const pack = (l.packs[id] ??= []);
    const items = pack.map((iid) => c.stash.find((i) => i.id === iid)!).filter(Boolean);
    const slots = items.reduce((a, i) => a + i.slots, 0);
    const row = h('div', { class: 'pack' }, h('div', { class: 'pack-who' }, classBadge(hr.cls), h('b', null, hr.name), h('span', { class: 'dim small' }, ` ${slots}/4`)));
    const slotsEl = h('div', { class: 'pack-slots' });
    for (const it of items)
      slotsEl.append(
        h(
          'button',
          {
            class: 'pk-btn',
            title: 'Back to the stash',
            onclick: () => {
              l.packs[id] = pack.filter((x) => x !== it.id);
              save();
            },
          },
          itemGlyph(it.kind),
          ' ',
          itemLabel(it),
          ' ×',
        ),
      );
    for (let i = slots; i < 4; i++) slotsEl.append(h('span', { class: 'pk-empty' }, 'empty'));
    row.append(slotsEl);
    // Add buttons for free stash consumables (one per kind).
    const kinds = new Map<string, Item>();
    for (const it of free) if (!kinds.has(it.kind) && it.kind !== 'gold') kinds.set(it.kind, it);
    const adds = h('div', { class: 'pack-add' });
    for (const it of kinds.values()) {
      adds.append(
        h(
          'button',
          {
            class: 'btn btn-small',
            disabled: slots + it.slots > 4,
            onclick: () => {
              pack.push(it.id);
              save();
            },
          },
          `+ ${itemGlyph(it.kind)} ${it.name}`,
        ),
      );
    }
    row.append(adds);
    packs.append(row);
  }
  el.append(h('h3', { class: 'prep-h' }, 'Packs ', h('span', { class: 'dim small' }, `${free.filter((i) => i.kind !== 'gold').length} items left in the stash`)), packs);

  // Entrance.
  const castle = host.engine.castle();
  const ents = castle.entrances.map((e, i) => {
    const lv = castle.levels.find((x) => x.level === e.level);
    const room = lv?.rooms.find((r) => r.id === lv.tiles[`${e.q},${e.r}`]?.room)?.name ?? `Entrance ${i + 1}`;
    return h('button', { class: `btn btn-small ${l.entrance === i ? 'on' : ''}`, onclick: () => ((l.entrance = i), save()) }, room);
  });
  el.append(h('h3', { class: 'prep-h' }, 'Entrance'), h('div', { class: 'prep-contracts' }, ...ents));

  let problem: string | null = null;
  try {
    problem = host.engine.partyProblem(s, l.heroIds);
  } catch {
    problem = null;
  }
  el.append(
    h(
      'div',
      { class: 'screen-actions sticky-actions' },
      problem ? h('span', { class: 'neg prep-sum' }, problem) : h('span', { class: 'dim prep-sum' }, `${l.heroIds.length} hero${l.heroIds.length === 1 ? '' : 'es'} · ${contract.bounty} gold bounty`),
      h('button', { class: 'btn btn-ghost', onclick: () => host.setStation('board') }, 'Back to the board'),
      h(
        'button',
        {
          class: 'btn btn-primary btn-big btn-delve',
          disabled: !l.heroIds.length || !!problem,
          title: problem ?? '',
          onclick: async () => {
            host.saveLoadout(l);
            const packsOut: Record<string, string[]> = {};
            for (const id of l.heroIds) packsOut[id] = l.packs[id] ?? [];
            await host.send({ type: 'startDelve', contractId: contract.id, heroIds: l.heroIds, entrance: l.entrance, packs: packsOut });
          },
        },
        'Delve',
      ),
    ),
  );
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
  const hobartDead = sm.dead.some((id) => s.campaign.roster.find((x) => x.id === id)?.cls === 'hobart');
  el.append(
    h(
      'div',
      { class: `screen-panel summary ${sm.contractDone ? 'won' : 'lost'}` },
      h('div', { class: 'kicker' }, s.delve?.contract.title ?? 'Delve over'),
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
            ...[...sm.survivors, ...sm.dead.filter((x) => !sm.survivors.includes(x))].map((id) =>
              h(
                'li',
                { class: sm.dead.includes(id) ? 'dead' : '' },
                h('b', null, name(id)),
                h('span', { class: 'dim small' }, sm.dead.includes(id) ? ' fell' : sm.wounded.includes(id) ? ' wounded' : ' out'),
                sm.xp[id] ? h('span', { class: 'small pos' }, ` +${sm.xp[id]} XP`) : '',
                sm.levelUps.includes(id) ? h('span', { class: 'chip good' }, 'Level up!') : '',
              ),
            ),
          ),
        ),
        h('div', null, h('h2', null, 'Notes'), sm.notes.length ? h('ul', { class: 'loot-list' }, ...sm.notes.map((n) => h('li', null, n))) : h('p', { class: 'dim' }, 'Nothing worth a song.')),
      ),
      hobartDead ? h('p', { class: 'warn-hobart' }, 'Lord Hobart did not come back.') : '',
      h('div', { class: 'screen-actions' }, h('button', { class: 'btn btn-primary btn-big', onclick: () => host.send({ type: 'backToCamp' }) }, hobartDead ? 'Continue' : 'Back to camp')),
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
      h('p', { class: 'lede' }, s.overReason ?? 'The heir has fallen.'),
      h('div', { class: 'ledger' }, stat('Gold', gold(c.gold), 'stat-gold'), stat('Reputation', `${c.reputation}`), stat('Fallen', `${c.fallen.length}`), stat('Delves', `${c.delveCount}`)),
      c.fallen.length ? h('ul', { class: 'memorial' }, ...c.fallen.map((f) => h('li', null, classBadge(f.cls), h('b', null, f.name), h('span', { class: 'dim small' }, ` ${f.where}`)))) : '',
      h('div', { class: 'screen-actions' }, h('button', { class: 'btn btn-primary btn-big', onclick: () => host.newCampaign(Math.floor(Math.random() * 1e9)) }, 'New campaign')),
    ),
  );
}
