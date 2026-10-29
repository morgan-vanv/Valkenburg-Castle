// V5.1 (W0): step 2, Party: party slots, the roster bench, the Flagon's recruits. Split out of src/ui/lowgate.ts.
// V5.1 (W2): rebuilt to the approved Party board (Party.dc.html) on the 1920x900 <main> of the camp stage: four big
// slots with baked rig busts (bust.ts), class shown by colour and a role icon, HP and a heal button, hex ability
// tiles (details on hover); empty slots are drop targets (drag.ts: pointer, click, keyboard) for a roster hero or a
// recruit (hired on drop, the price shows on the slot); a locked slot past the squad cap. Below: the roster bench (small
// busts, paged so it never scrolls) and the Flagon's recruits. "This party can" and the "Best at" text are gone.

import type { AleKind, AleOffer, GameState, Hero } from '../../game/types';
import { HEAL_PER_HP, SQUAD_SLOTS_MAX, squadSlots } from '../../game/data';
import { sfx } from '../../audio/sfx';
import { h } from '../dom';
import { ALE, type AbilityChip, type AnyClass, CLASS_ABILITIES, CLASS_ROLE, className } from '../names';
import { type Loadout, type CampHost, isHeir, heroOf, hpOf, hurt, classLine, statsTip, btn, villageOf, ui } from './shared';
import { aleLook, chalkGroups, pourCheck, roundOf, tankard, tapOrder } from './ales'; // V5.1.2 (One for the road)
import { ic, type CampIcon } from './icons';
import { PERKS, perkStatus } from '../vendors';
import { bust, bustKey } from './bust';
import { makeDraggable, makeDropTarget } from './drag';
import './party.css';

/**
 * What can be dragged: a hero on the roster or a recruit at the Flagon (hired on drop) into an empty slot; V5.1.2: an
 * ale off the taps onto a party hero's card (poured on drop).
 */
type Payload = { kind: 'hero'; id: string } | { kind: 'recruit'; id: string; price: number } | { kind: 'ale'; ale: AleKind; price: number; name: string };

/** The role icon per class (the hex emblem next to the class name). */
const ROLE_ICON: Record<string, CampIcon> = {
  heir: 'crown', sellsword: 'sword', burglar: 'hood', ranger: 'bow', sapper: 'bomb',
  pyromancer: 'flame', shadowmancer: 'moon', hedgewitch: 'leaf', mage: 'star',
};

/** Every ability's icon (from the kit's icon set); anything unknown gets a star. */
const ABILITY_ICON: Record<string, CampIcon> = {
  Rally: 'horn', Brace: 'anvil',
  Guard: 'shield', 'Strong shove': 'push',
  'Pick locks': 'lock', 'Quietest feet': 'hood', Backstab: 'sword', 'Light fingers': 'chest',
  Longbow: 'bow', Overwatch: 'aim', 'Knockback shot': 'push', Hamstring: 'arrow',
  'Improvised explosives': 'sack', 'Set charge': 'fuse', 'Throw charge': 'bomb', Dig: 'pick',
  Firebolt: 'arrow', Fireball: 'flame', Kindle: 'torch',
  Veil: 'hood', Sleep: 'moon', Blink: 'star', Dread: 'skull', 'Night thorn': 'spider',
  Mend: 'leaf', Ward: 'shield', Gust: 'push', Briar: 'chain',
};
export const abilityIcon = (name: string): CampIcon => ABILITY_ICON[name] ?? 'star';

/** Roster heroes per bench page (the bench never wraps or scrolls). */
const BENCH_PAGE = 7;
let benchPage = 0;

const ORDINAL = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth'];

export function partyStep(main: HTMLElement, s: GameState, l: Loadout, host: CampHost): void {
  const c = s.campaign;
  const room = squadSlots(c);
  const set = (next: Loadout) => host.setDraft(next, 'party');
  const max = Math.max(SQUAD_SLOTS_MAX, room);
  const root = h('div', { class: 'pt' });

  // Title and the slot pips (filled, open, locked).
  const roomLine = `Up to ${room >= SQUAD_SLOTS_MAX ? 'four' : room === 3 ? 'three for now' : room}. Keven can go alone, but if he falls, it's over.`;
  const pips = h('div', { class: 'pt-pips', role: 'img', tabindex: 0, 'aria-label': roomLine, 'data-tip': `${l.heroIds.length} of ${room} going in · ${roomLine}` });
  for (let i = 0; i < max; i++) pips.append(i >= room ? ic('lock', { class: 'pt-pip lock' }) : ic('banner', { class: `pt-pip ${i < l.heroIds.length ? 'on' : ''}` }));
  root.append(h('div', { class: 'pt-title' }, h('h2', null, 'Who goes in?'), pips));

  // The four slots.
  const slots = h('div', { class: 'pt-slots lg-slots', role: 'list', 'aria-label': 'Party' });
  for (let i = 0; i < max; i++) {
    const id = l.heroIds[i];
    const hr = id ? heroOf(c, id) : undefined;
    if (hr) slots.append(heroSlot(hr, s, l, host, set));
    else if (i >= room) slots.append(lockedSlot(s, i));
    else slots.append(emptySlot(s, l, host, set, i, i === l.heroIds.length));
  }
  root.append(slots);

  root.append(benchRow(s, l, set, room));

  // The Flagon (or the campfire before Wim is home): V5.1.2, two tabs, Hire and The taps.
  const n = c.recruits.length;
  const offers = alesOf(s, host);
  const tab = flagonTab(s);
  root.append(flagonHead(s, l, host, offers, tab));
  if (tab === 'taps') root.append(tapsPanel(s, l, host, offers));
  else if (!n) root.append(h('div', { class: 'pt-recs pt-recs-none', id: 'pt-tab-hire', role: 'tabpanel' }, h('p', { class: 'lg-empty' }, 'Nobody looking for work. Come back after the next delve.')));
  else {
    const grid = h('div', { class: 'pt-recs', id: 'pt-tab-hire', role: 'tabpanel', 'aria-labelledby': 'pt-ftab-hire' });
    for (const r of c.recruits.slice(0, 4)) grid.append(recruitCard(r.hero, r.price, s, l, host));
    root.append(grid);
  }
  main.append(root);
}

/** W1's shell shows this in the footer's middle (null: nothing). */
export function footNote(s: GameState, l: Loadout, host: CampHost): string | Node | null {
  if (host.page !== 'party') return null;
  const c = s.campaign;
  if (!l.heroIds.length) return 'Nobody is going in yet.';
  if (!l.heroIds.some((id) => isHeir(c, id)) && c.roster.some((x) => x.cls === 'heir')) return "Keven stays in Lowgate: if this party falls, it isn't over.";
  // V5.1.2: the taps, said where the eye goes.
  const live = alesOf(s, host).filter((o) => !o.locked);
  if (flagonTab(s) === 'taps') return live.length ? 'Drag a tankard onto a hero. "Round" pours one for everyone without a drink. Click a full mug to tip it back.' : null;
  const thirsty = l.heroIds.filter((id) => !heroOf(c, id)?.ale).length;
  if (live.length && thirsty) {
    const sp = live.find((o) => o.special);
    return `Wim has ${live.length} on tap${sp ? `, and ${sp.name} is his special tonight` : ''}. One for the road? See The taps.`;
  }
  return null;
}

// ------------------------------------------------------------------------------------------------ V5.1.2: the taps

function alesOf(s: GameState, host: CampHost): AleOffer[] {
  try {
    return host.engine.ales(s);
  } catch {
    return [];
  }
}

/** The Flagon's open tab: what was chosen this visit; else Hire, or The taps when nobody is looking for work. */
function flagonTab(s: GameState): 'hire' | 'taps' {
  const visit = s.campaign.delveCount;
  if (ui.flagonTab && ui.flagonTab.visit === visit) return ui.flagonTab.tab;
  return s.campaign.recruits.length ? 'hire' : 'taps';
}

function flagonHead(s: GameState, l: Loadout, host: CampHost, offers: AleOffer[], tab: 'hire' | 'taps'): HTMLElement {
  const c = s.campaign;
  const v = villageOf(s);
  const flagon = v.innkeeper;
  const n = c.recruits.length;
  const live = offers.filter((o) => !o.locked).length;
  const dry = offers.length - live;
  const special = offers.find((o) => o.special);
  const about = flagon
    ? `Old Wim's regulars. Some have been inside before.${v.caskbook ? ' The old hands are back too.' : ''} New faces after every delve.`
    : `Drifters warming their hands. Green and cheap. New faces after every delve.`;
  const go = (t: 'hire' | 'taps') => {
    if (t === tab) return;
    sfx.play('click');
    ui.flagonTab = { tab: t, visit: c.delveCount };
    host.setDraft(structuredClone(l), 'party');
  };
  const tabEl = (id: 'hire' | 'taps', icon: CampIcon, label: string, count: Node | string, tip: string, extra?: Node) =>
    h(
      'button',
      {
        type: 'button',
        class: `pt-ftab ${tab === id ? 'on' : ''}`,
        role: 'tab',
        id: `pt-ftab-${id}`,
        'aria-selected': tab === id ? 'true' : 'false',
        'aria-controls': `pt-tab-${id}`,
        tabindex: tab === id ? 0 : -1,
        'data-ftab': id,
        'data-tip': tip,
        onclick: () => go(id),
        onkeydown: (ev: Event) => {
          const e = ev as KeyboardEvent;
          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault();
            const to = id === 'hire' ? 'taps' : 'hire';
            go(to);
            requestAnimationFrame(() => document.getElementById(`pt-ftab-${to}`)?.focus());
          }
        },
      },
      ic(icon),
      label,
      h('span', { class: 'n' }, count),
      extra ?? '',
    );
  const roomy = l.heroIds.length < squadSlots(c);
  const line =
    tab === 'hire'
      ? n
        ? roomy
          ? 'Drag someone into a slot, or press Hire'
          : 'The party is full: hired hands wait on the roster'
        : ''
      : !flagon
        ? 'The Flagon is dark. Its taps with it.'
        : live
          ? '"One for the road? It\'s on the house to look at."'
          : '"Nothing on tap yet. Bring me my copper."';
  return h(
    'div',
    { class: 'pt-fl' },
    h('span', { class: 'kick', tabindex: 0, 'data-tip': `${flagon ? 'At the Gilded Flagon' : 'At the campfire'} · ${n} looking for work\n${about}` }, flagon ? 'At the Gilded Flagon' : 'At the campfire'),
    h(
      'span',
      { class: 'pt-ftabs', role: 'tablist', 'aria-label': 'At the Flagon' },
      tabEl('hire', 'banner', 'Hire', `${n}`, `Hire · ${n ? `${n} looking for work` : 'nobody looking for work'}`),
      tabEl(
        'taps',
        'tap',
        'The taps',
        dry && live ? `${live} + ${dry}` : `${live || dry}`,
        `The taps · ${live} on tap${dry ? `, ${dry} dry` : ''}\nAn ale is drunk as the hero next goes in: one each, a delve.${special ? `\nWim's special tonight: ${special.name}, ${special.price} instead of ${special.basePrice}.` : ''}`,
        special && tab !== 'taps' ? h('span', { class: 'pt-spbadge' }, "Wim's special tonight") : undefined,
      ),
    ),
    h('span', { class: 'line', 'aria-hidden': 'true' }),
    line ? h('span', { class: `pt-fl-sm ${tab === 'taps' ? 'wim' : ''}` }, line) : '',
    tab === 'taps' ? supperChip(s) : '',
  );
}

/** Wim's other doing (it lived on his Outfit tab): the hot supper, a village perk, nothing to buy. */
function supperChip(s: GameState): HTMLElement | string {
  const p = PERKS.find((x) => x.id === 'supper');
  if (!p) return '';
  const st = perkStatus(p, villageOf(s));
  return h(
    'span',
    { class: `pt-perk ${st}`, tabindex: 0, 'data-perk': p.id, 'data-state': st, 'data-tip': st === 'live' ? `${p.name} · the village's doing\n${p.live}\nNothing to buy: it just happens.` : `${p.name} · ${st === 'soon' ? 'not yet' : 'locked'}\n${p.hint}` },
    ic(st === 'live' ? 'heart' : 'lock'),
    p.name,
  );
}

async function pour(heroId: string, ale: AleKind, host: CampHost): Promise<boolean> {
  const ok = await host.send({ type: 'buyAle', heroId, ale });
  if (ok) sfx.play('coin', { pitch: 0.8 });
  return ok;
}

/** The bar: Wim's special on the chalkboard, then a tap per ale (dry taps grouped under one chalk line). */
function tapsPanel(s: GameState, l: Loadout, host: CampHost, offers: AleOffer[]): HTMLElement {
  const c = s.campaign;
  const v = villageOf(s);
  const party = l.heroIds.map((id) => heroOf(c, id)).filter((x): x is Hero => !!x);
  const special = offers.find((o) => o.special);
  const board = h('div', { class: 'pt-board', 'data-special': special?.kind ?? '' }, h('div', { class: 'k' }, "Wim's special"));
  if (special) {
    board.append(
      h('h4', null, special.name),
      h('p', null, aleLook(special.kind).wim ?? ''),
      h('div', { class: 'pr' }, h('span', { class: 'was num' }, `${special.basePrice}`), h('span', { class: 'now num' }, `${special.price}`)),
      h('p', { class: 'sm' }, 'A new special every visit.'),
    );
  } else if (!v.innkeeper) board.append(h('h4', null, 'The Flagon is dark'), h('p', null, 'Old Wim is still somewhere in the castle kitchens.'));
  else board.append(h('h4', null, 'Nothing on tap'), h('p', null, '"Bring me my copper and I\'ll pour you something."'));

  const ordered = tapOrder(offers);
  const taps = h('div', { class: 'pt-taps', style: `--n:${ordered.length}` });
  for (const g of chalkGroups(ordered, v)) {
    if (g.chalk === null) for (const o of g.taps) taps.append(liveTap(o, s, party, host));
    else {
      const grp = h('div', { class: 'pt-drygrp', style: `--k:${g.taps.length}` });
      for (const o of g.taps) grp.append(dryTap(o));
      grp.append(h('div', { class: 'chalk' }, g.chalk));
      taps.append(grp);
    }
  }
  return h('div', { class: 'pt-bar', id: 'pt-tab-taps', role: 'tabpanel', 'aria-labelledby': 'pt-ftab-taps' }, h('span', { class: 'lamp', 'aria-hidden': 'true' }), board, taps);
}

function aleStyle(k: AleKind): string {
  const a = aleLook(k);
  return `--ale:${a.colour};--ale-ink:${a.ink}`;
}

function liveTap(o: AleOffer, s: GameState, party: Hero[], host: CampHost): HTMLElement {
  const c = s.campaign;
  const a = aleLook(o.kind);
  const round = roundOf(party, o, c.gold);
  const price = h('span', { class: 'price' }, o.special ? h('s', { class: 'was num' }, `${o.basePrice}`) : '', ic('coin'), h('span', { class: 'num' }, `${o.price}`));
  const row = h('div', { class: 'row' }, price);
  if (round.ids.length) {
    const b = btn(
      {
        class: 'pt-round',
        k: `round-${o.kind}`,
        data: { round: o.kind },
        off: !round.ok,
        label: `A round of ${o.name} for ${round.names.join(', ')}: ${round.total} gold`,
        tip: round.ok ? `A round of ${o.name} · ${round.total} gold\nOne each for ${round.names.join(', ')}: everyone going in without a drink.` : `A round of ${o.name} · ${round.total} gold\n${round.reason}`,
        onclick: async () => {
          if (!round.ok) return;
          for (const id of round.ids) if (!(await host.send({ type: 'buyAle', heroId: id, ale: o.kind }))) break;
          sfx.play('coin', { pitch: 0.7 });
        },
      },
      ic('mug'),
      h('span', { class: 'rw' }, 'Round '),
      `×${round.ids.length} · ${round.total}`,
    );
    b.addEventListener('click', (e) => e.stopPropagation());
    row.append(own(b));
  }
  const el = h(
    'div',
    {
      class: `pt-tap ${o.special ? 'special' : ''}`,
      'data-tap': o.kind,
      'data-k': `tap-${o.kind}`,
      'data-special': o.special ? '1' : undefined,
      style: aleStyle(o.kind),
      role: 'button',
      'aria-label': `${o.name}, ${o.price} gold${o.special ? ", Wim's special" : ''}. ${a.short}. Enter picks it up; then choose a hero.`,
      'data-tip': `${o.name} · ${o.price} gold${o.special ? ` (Wim's special: usually ${o.basePrice})` : ''}\n${o.text}\nDrag it onto a hero, or click it, then the hero. Drunk as they next go in.`,
    },
    h('span', { class: 'handle', 'aria-hidden': 'true' }),
    h('span', { class: 'spout', 'aria-hidden': 'true' }),
    tankard(o.kind),
    h('h5', null, o.name),
    h('div', { class: 'fx' }, ic(a.icon), h('span', null, a.short)),
    row,
  );
  makeDraggable<Payload>(el, { kind: 'ale', ale: o.kind, price: o.price, name: o.name }, { ghost: () => h('span', { class: 'pt-flying', style: aleStyle(o.kind) }, tankard(o.kind, { size: 80 })) });
  return el;
}

function dryTap(o: AleOffer): HTMLElement {
  return h(
    'div',
    { class: 'pt-tap off', 'data-tap': o.kind, 'data-dry': '1', tabindex: 0, 'aria-label': `${o.name}, a dry tap. ${o.locked ?? ''}`, 'data-tip': `${o.name} · dry tap\n${o.locked ?? ''}` },
    h('span', { class: 'handle', 'aria-hidden': 'true' }),
    h('span', { class: 'spout', 'aria-hidden': 'true' }),
    tankard(null, { dry: true }),
    h('h5', null, o.name),
    h('div', { class: 'fx' }, ic('lock'), h('span', null, 'Dry tap')),
  );
}

/** What each hero's mug held at the last render: a mug that just filled plays the pour. */
const lastAle = new Map<string, string>();

/** A party hero's mug: empty ("Thirsty"), or full in the ale's colour (click to tip it back). Lights while a tankard is carried. */
function mugOf(hr: Hero, s: GameState, host: CampHost): { mug: HTMLElement; label: HTMLElement; when: { b: HTMLElement; sp: HTMLElement } } {
  const wb = h('b');
  const wsp = h('span');
  const when = h('span', { class: 'when' }, wb, wsp);
  if (!hr.ale) {
    lastAle.set(hr.id, '');
    const label = h('div', { class: 'pt-alename thirsty' }, h('span', { class: 'idle' }, h('b', null, 'Thirsty'), h('span', null, 'drag a tankard here')), when);
    const mug = h('span', { class: 'pt-mug empty', 'data-mug': hr.id, tabindex: 0, 'data-tip': `${hr.name} · thirsty\nDrag a tankard from The taps onto ${hr.name}, or click one and then ${hr.name}.` }, tankard(null));
    return { mug, label, when: { b: wb, sp: wsp } };
  }
  const a = aleLook(hr.ale);
  const name = ALE[hr.ale].name;
  const fresh = lastAle.has(hr.id) && lastAle.get(hr.id) !== hr.ale;
  lastAle.set(hr.id, hr.ale);
  const gift = !(hr.alePaid && hr.alePaid > 0);
  const label = h('div', { class: 'pt-alename full', style: `--ale-ink:${a.ink}` }, h('span', { class: 'idle' }, h('b', null, name), h('span', null, `${a.short}${gift ? ' · a gift' : ' · click to tip back'}`)), when);
  const mug = btn(
    {
      class: `pt-mug full ${gift ? 'gift' : ''} ${fresh ? 'poured' : ''}`,
      k: `mug-${hr.id}`,
      data: { mug: hr.id, ale: hr.ale },
      label: gift ? `${name}, a gift from Wim` : `Tip back ${name} for ${hr.alePaid} gold`,
      tip: `${name} · drunk as ${hr.name} next goes in\n${ALE[hr.ale].text}\n${gift ? "A gift from Wim. He'd be hurt." : `Click to tip it back: ${hr.alePaid} gold back.`}`,
      onclick: async () => {
        if (await host.send({ type: 'unpourAle', heroId: hr.id })) sfx.play('coin', { pitch: 1.25 });
      },
    },
    tankard(hr.ale),
  );
  void s;
  return { mug: own(mug), label, when: { b: wb, sp: wsp } };
}

/** The whole hero card takes a tankard (V5.1.2): lights its mug with "Pour for X · price", or dims with the reason. */
function pourTarget(el: HTMLElement, hr: Hero, s: GameState, host: CampHost, when: { b: HTMLElement; sp: HTMLElement }): void {
  const c = s.campaign;
  makeDropTarget<Payload>(el, {
    ignores: (p) => p.kind !== 'ale',
    accepts: (p) => {
      if (p.kind !== 'ale') return 'No.';
      const o = alesOf(s, host).find((x) => x.kind === p.ale);
      const ok = o ? pourCheck(hr, o, c.gold) : 'Not on tap.';
      if (ok === true) {
        when.b.textContent = 'Drop to pour';
        when.sp.textContent = `${p.name} · ${p.price}`;
      } else {
        when.b.textContent = "Can't pour";
        when.sp.textContent = hr.ale ? 'one a delve' : c.gold < p.price ? `${p.price} gold, you have ${c.gold}` : 'dry tap';
      }
      return ok;
    },
    hint: (p) => (p.kind === 'ale' ? `Pour for ${hr.name} · ${p.price}` : undefined),
    onDrop: (p, how) => {
      if (p.kind !== 'ale') return;
      // A keyboard pour would leave focus on the page (the card loses its lift tabindex and is re-rendered): hand it
      // back to the tap (restored by data-k) so the next pour is one Enter away.
      if (how === 'keyboard') document.querySelector<HTMLElement>(`.pt-tap[data-tap="${p.ale}"]`)?.focus({ preventScroll: true });
      void pour(hr.id, p.ale, host);
    },
  });
}

function withHero(c: GameState['campaign'], l: Loadout, id: string): Loadout {
  const next = structuredClone(l);
  if (!next.heroIds.includes(id)) next.heroIds.push(id);
  if (isHeir(c, id)) next.heroIds.sort((a, b) => Number(isHeir(c, b)) - Number(isHeir(c, a)));
  return next;
}

async function hire(id: string, s: GameState, l: Loadout, host: CampHost): Promise<void> {
  const c = s.campaign;
  if (!(await host.send({ type: 'hire', heroId: id }))) return;
  sfx.play('coin');
  if (l.heroIds.length < squadSlots(c)) host.setDraft({ ...structuredClone(l), heroIds: [...l.heroIds, id] }, 'party');
}

/** A control inside a draggable card: its press must not start the card's drag (drag.ts captures the pointer). */
function own<T extends HTMLElement>(el: T): T {
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  return el;
}

const clsStyle = (cls: string) => `--c:var(--k-${bustKey(cls)})`;

/** The class line: a hex emblem with the role icon, the class name in its colour, the level. */
function clsRow(hr: Hero): HTMLElement {
  return h(
    'div',
    { class: 'pt-cls', 'data-tip': `${hr.cls === 'heir' ? 'The heir' : className(hr.cls)} · Level ${hr.level}\n${CLASS_ROLE[hr.cls as AnyClass] ?? ''}` },
    h('span', { class: 'em' }, ic(ROLE_ICON[hr.cls] ?? 'star')),
    h('span', { class: 'pt-cn' }, hr.cls === 'heir' ? 'The heir' : className(hr.cls)),
    h('span', { class: 'lv' }, `· ${hr.level}`),
  );
}

function abilities(cls: string, host: CampHost): AbilityChip[] {
  const mine = CLASS_ABILITIES[cls as AnyClass];
  if (mine?.length) return mine;
  try {
    return host.engine.classInfo(cls as Hero['cls']).abilities.map((line) => {
      const m = /^([^:(]+)(?:\([^)]*\))?:?\s*(.*)$/.exec(line);
      return { name: (m?.[1] ?? line).trim(), kind: 'Ability' as const, plain: m?.[2] ?? '', nums: '' };
    });
  } catch {
    return [];
  }
}

/** Hex ability tiles: an icon each, the name and rules on hover or focus. */
function abilityTiles(cls: string, host: CampHost): HTMLElement {
  const key = bustKey(cls);
  return h(
    'div',
    { class: 'pt-abils' },
    ...abilities(cls, host).map((a) =>
      own(h(
        'button',
        { type: 'button', class: `abil k-${key} lg-ab`, 'data-tip': `${a.name} · ${a.kind}\n${a.plain}`, 'data-tip-nums': a.nums || undefined, 'data-ability': a.name, 'aria-label': a.name, onclick: (e: Event) => e.stopPropagation() },
        ic(abilityIcon(a.name)),
      )),
    ),
  );
}

function heroSlot(hr: Hero, s: GameState, l: Loadout, host: CampHost, set: (l: Loadout) => void): HTMLElement {
  const c = s.campaign;
  const v = villageOf(s);
  const heir = isHeir(c, hr.id);
  const hp = hpOf(hr);
  const wounded = hp < hr.maxHp;
  const vit = h('div', { class: 'pt-vit' });
  if (wounded) {
    const low = hp * 3 <= hr.maxHp;
    vit.append(
      h(
        'span',
        { class: 'pt-hp lg-hpbar-row', 'data-tip': `${hr.name} · ${hp} of ${hr.maxHp} HP\nWounds don't mend between delves. ${v.surgeon ? `Brother Aldric heals for ${HEAL_PER_HP} gold per HP.` : 'A potion from the cart heals 5.'}` },
        ic('heart'),
        h('span', { class: `num ${low ? 'low' : ''}` }, `${hp}`),
        h('span', { class: 'max num' }, `/${hr.maxHp}`),
        h('span', { class: 'bar lg-hpbar', 'aria-hidden': 'true' }, h('i', { style: `width:${Math.round((hp / hr.maxHp) * 100)}%` })),
      ),
    );
    if (v.surgeon) {
      const missing = hr.maxHp - hp;
      const can = Math.min(missing, Math.floor(c.gold / HEAL_PER_HP));
      const full = missing * HEAL_PER_HP;
      vit.append(
        btn(
          {
            class: 'pt-heal',
            k: `heal-${hr.id}`,
            data: { heal: hr.id },
            off: !can,
            tip: !can ? `Heal · ${full} gold\nYou have ${c.gold} gold.` : can < missing ? `Heal · ${can * HEAL_PER_HP} gold\nBrother Aldric heals ${can} of the ${missing} HP: all your gold covers. ${HEAL_PER_HP} gold per HP.` : `Heal · ${full} gold\nBrother Aldric patches ${hr.name} up to full: ${HEAL_PER_HP} gold per HP.`,
            label: `Heal ${hr.name} for ${can > 0 ? can * HEAL_PER_HP : full} gold`,
            onclick: async () => {
              if (await host.send({ type: 'heal', heroId: hr.id })) sfx.play('spell');
            },
          },
          ic('leaf'),
          'Heal',
          h('span', { class: 'price' }, ic('coin'), `${can > 0 ? can * HEAL_PER_HP : full}`),
        ),
      );
    }
    const pots = c.stash.filter((i) => i.kind === 'potion').length;
    if (pots)
      vit.append(
        btn(
          {
            class: 'pt-drink',
            k: `drink-${hr.id}`,
            data: { drink: hr.id },
            label: `Drink a potion: ${hr.name}`,
            tip: `Drink a potion · ${hr.name} heals ${Math.min(5, hr.maxHp - hp)} HP\n${pots} on the cart. A drunk potion doesn't go in.`,
            onclick: async () => {
              if (await host.send({ type: 'drink', heroId: hr.id })) sfx.play('spell', { pitch: 0.9 });
            },
          },
          ic('potion'),
        ),
      );
  } else {
    vit.append(h('span', { class: 'pt-hp lg-hp', 'data-tip': `${hr.name} · ${hp} HP, unhurt.` }, ic('heart'), h('span', { class: 'num' }, `${hp}`)));
  }
  const key = bustKey(hr.cls);
  const m = mugOf(hr, s, host); // V5.1.2: the mug in the card's corner
  const el = h(
    'section',
    { class: `pt-slot pt-hero lg-slot hero ${heir ? 'heir' : ''} ${wounded ? 'wounded' : ''}`, role: 'listitem', 'data-hero': hr.id, style: clsStyle(hr.cls), 'aria-label': `${hr.name}, ${classLine(hr)}` },
    h('span', { class: 'spot', 'aria-hidden': 'true' }),
    h('span', { class: 'plinth', 'aria-hidden': 'true' }),
    heir ? h('span', { class: 'crownmark', tabindex: 0, 'data-tip': `${hr.name} · the heir\nIf he falls, it's over.` }, ic('crown', { label: 'The heir' })) : '',
    btn(
      {
        class: 'pt-x lg-x',
        k: `out-${hr.id}`,
        data: { out: hr.id },
        label: `Leave ${hr.name} in Lowgate`,
        tip: `Leave ${hr.name} in Lowgate · They stay on the roster.${heir ? "\nA party can go in without Keven. If they fall, it isn't over." : ''}`,
        onclick: () => {
          sfx.play('click');
          const next = structuredClone(l);
          next.heroIds = next.heroIds.filter((x) => x !== hr.id);
          delete next.packs[hr.id];
          set(next);
        },
      },
      '×',
    ),
    h('div', { class: 'pt-bustw', 'data-tip': statsTip(hr.cls, hr) }, bust(hr.cls, { size: 180, label: `${hr.name}, ${className(hr.cls)}` })),
    h('h3', { class: 'lg-slot-n' }, hr.name),
    clsRow(hr),
    vit,
    h('div', { class: `pt-abw k-${key}` }, abilityTiles(hr.cls, host)),
    m.label,
    m.mug,
  );
  pourTarget(el, hr, s, host, m.when);
  return el;
}

function lockedSlot(s: GameState, i: number): HTMLElement {
  const muster = s.campaign.board.some((k) => k.story === 'muster');
  const hint = "Wim says the old muster roll is in the officers' quarters. With it, a fourth could sign on.";
  return h(
    'section',
    { class: 'pt-slot pt-empty pt-locked lg-slot empty locked', role: 'listitem', 'data-slot': `${i}`, 'data-locked': 'muster', tabindex: 0, 'data-tip': `${ORDINAL[i] ?? 'Another'} slot · locked\n${hint}${muster ? '\nThe job is on the notice post.' : ''}` },
    h('span', { class: 'plus' }, ic('lock')),
    h('span', { class: 't' }, `${ORDINAL[i] ?? 'Another'} slot`),
  );
}

function emptySlot(s: GameState, l: Loadout, host: CampHost, set: (l: Loadout) => void, i: number, first: boolean): HTMLElement {
  const c = s.campaign;
  const what = h('span', { class: 't when' });
  const price = h('span', { class: 'price when' });
  const el = h(
    'section',
    { class: `pt-slot pt-empty lg-slot empty ${first ? 'first' : ''}`, role: 'listitem', 'data-slot': `${i}`, 'aria-label': 'Open slot', 'data-tip': 'Open slot · drag a hero from your roster or a recruit from below into it' },
    h('span', { class: 'plus' }, ic('plus')),
    h('span', { class: 't idle' }, 'Open slot'),
    what,
    price,
  );
  makeDropTarget<Payload>(el, {
    ignores: (p) => p.kind === 'ale',
    accepts: (p) => {
      price.replaceChildren();
      if (p.kind === 'ale') return 'No.';
      if (p.kind === 'recruit') {
        if (c.gold < p.price) return `Hire · ${p.price} gold\nYou have ${c.gold} gold.`;
        what.textContent = 'Drop to hire';
        price.append(ic('coin'), `${p.price}`);
      } else what.textContent = 'Drop to take along';
      return true;
    },
    onDrop: (p) => {
      if (p.kind === 'ale') return;
      if (p.kind === 'recruit') void hire(p.id, s, l, host);
      else {
        sfx.play('click');
        set(withHero(c, l, p.id));
      }
    },
  });
  return el;
}

/** The roster heroes not going in: small busts, dragged (or "+"-ed) into a slot; paged, never wrapped. */
function benchRow(s: GameState, l: Loadout, set: (l: Loadout) => void, room: number): HTMLElement {
  const c = s.campaign;
  const bench = c.roster.filter((x) => !l.heroIds.includes(x.id));
  const full = l.heroIds.length >= room;
  const row = h('div', { class: 'pt-bench lg-bench', role: 'list', 'aria-label': 'Your roster' }, h('span', { class: 'kick pt-bench-k' }, 'Roster'));
  if (!bench.length) {
    row.append(h('span', { class: 'pt-bench-none' }, c.roster.length > 1 ? 'Everyone on the roster is going in.' : 'Hire someone and they join the roster.'));
    return row;
  }
  const pages = bench.length > BENCH_PAGE ? Math.ceil(bench.length / (BENCH_PAGE - 1)) : 1;
  const per = pages > 1 ? BENCH_PAGE - 1 : BENCH_PAGE;
  benchPage = Math.min(benchPage, pages - 1);
  for (const hr of bench.slice(benchPage * per, benchPage * per + per)) {
    const chip = h(
      'div',
      { class: `pt-bh ${hurt(hr) ? 'wounded' : ''}`, role: 'listitem', style: clsStyle(hr.cls), 'aria-label': `${hr.name}, ${classLine(hr)}. Enter picks them up for a slot.`, 'data-tip': `${hr.name} · ${classLine(hr)}\n${hpOf(hr)} of ${hr.maxHp} HP. ${full ? 'The party is full. Take someone out first.' : 'Drag into an open slot, or press +.'}` },
      h('span', { class: 'pt-bh-b' }, bust(hr.cls, { size: 58 })),
      h('span', { class: 'pt-bh-t' }, h('span', { class: 'pt-bh-n' }, hr.name), h('span', { class: 'pt-bh-c' }, ic(ROLE_ICON[hr.cls] ?? 'star'), hurt(hr) ? h('span', { class: 'num low' }, `${hpOf(hr)}/${hr.maxHp}`) : h('span', { class: 'num' }, `${hr.maxHp}`), ic('heart', { class: 'hrt' }))),
      hr.ale ? h('span', { class: 'pt-bh-ale', 'data-ale': hr.ale, tabindex: 0, 'data-tip': `${ALE[hr.ale].name} waits for ${hr.name} · an ale stays with the hero until they next go in.` }, tankard(hr.ale, { size: 22 })) : '',
      own(btn(
        {
          class: 'pt-add',
          k: `bench-${hr.id}`,
          data: { bench: hr.id },
          off: full,
          label: `Take ${hr.name} along`,
          tip: full ? `${hr.name} · The party is full. Take someone out first.` : `${hr.name} · ${classLine(hr)}\n${hpOf(hr)} of ${hr.maxHp} HP. Click to take them along.`,
          onclick: () => {
            sfx.play('click');
            set(withHero(c, l, hr.id));
          },
        },
        ic('plus'),
      )),
    );
    makeDraggable<Payload>(chip, { kind: 'hero', id: hr.id });
    row.append(chip);
  }
  if (pages > 1) {
    const rest = bench.length - per * (benchPage + 1);
    row.append(
      btn(
        {
          class: 'pt-more',
          k: 'bench-more',
          label: 'More of the roster',
          tip: `Your roster · ${bench.length} waiting in Lowgate\nPage ${benchPage + 1} of ${pages}.`,
          onclick: () => {
            sfx.play('click');
            benchPage = (benchPage + 1) % pages;
            set(structuredClone(l));
          },
        },
        rest > 0 ? `+${rest}` : '↺',
      ),
    );
  }
  return row;
}

function recruitCard(hr: Hero, price: number, s: GameState, l: Loadout, host: CampHost): HTMLElement {
  const c = s.campaign;
  const short = c.gold < price;
  const card = h(
    'article',
    { class: `pt-rc lg-rc cls-${hr.cls}`, 'data-recruit': hr.id, style: clsStyle(hr.cls), 'aria-label': `${hr.name}, ${className(hr.cls)}, level ${hr.level}, ${price} gold. Enter picks them up for a slot.` },
    h('div', { class: 'bw', 'data-tip': statsTip(hr.cls, hr) }, bust(hr.cls, { size: 104 })),
    h('div', { class: 'pt-rc-who' }, h('h4', { class: 'lg-rc-n' }, hr.name), clsRow(hr)),
    abilityTiles(hr.cls, host),
    h(
      'div',
      { class: 'pt-rc-row' },
      h('span', { class: 'pt-hp lg-hp', 'data-tip': `${hr.name} · ${hr.maxHp} HP` }, ic('heart'), h('span', { class: 'num' }, `${hr.maxHp}`), h('span', { class: 'sr' }, ' HP')),
      own(btn(
        {
          class: 'pt-buy lg-hire',
          k: `hire-${hr.id}`,
          data: { hire: hr.id },
          off: short,
          label: `Hire ${hr.name} for ${price} gold`,
          tip: short ? `Hire · ${price} gold\nYou have ${c.gold} gold.` : `Hire ${hr.name} · ${price} gold\n${l.heroIds.length < squadSlots(c) ? 'Goes straight into a free party slot.' : 'The party is full: they wait on the roster.'}`,
          onclick: () => hire(hr.id, s, l, host),
        },
        'Hire',
        h('span', { class: 'price' }, ic('coin'), h('span', { class: 'num' }, `${price}`)),
      )),
    ),
  );
  makeDraggable<Payload>(card, { kind: 'recruit', id: hr.id, price });
  return card;
}

