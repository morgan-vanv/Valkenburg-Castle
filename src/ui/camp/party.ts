// V5.1 (W0): step 2, Party: party slots, the roster bench, the Flagon's recruits. Split out of src/ui/lowgate.ts.
// V5.1 (W2): rebuilt to the approved Party board (Party.dc.html) on the 1920x900 <main> of the camp stage: four big
// slots with rig-rendered busts (bust.ts), class shown by colour and a role icon, HP and a heal button, hex ability
// tiles (details on hover); empty slots are drop targets (drag.ts: pointer, click, keyboard) for a roster hero or a
// recruit (hired on drop, the price shows on the slot); a locked slot past the squad cap. Below: the roster bench (small
// busts, paged so it never scrolls) and the Flagon's recruits. "This party can" and the "Best at" text are gone.

import type { GameState, Hero } from '../../game/types';
import { HEAL_PER_HP, SQUAD_SLOTS_MAX, squadSlots } from '../../game/data';
import { sfx } from '../../audio/sfx';
import { h } from '../dom';
import { ALE, type AbilityChip, type AnyClass, CLASS_ABILITIES, CLASS_ROLE, className } from '../names';
import { type Loadout, type CampHost, isHeir, heroOf, hpOf, hurt, classLine, statsTip, btn, villageOf } from './shared';
import { ic, type CampIcon } from './icons';
import { bust, bustKey } from './bust';
import { makeDraggable, makeDropTarget } from './drag';
import './party.css';

/** What can be dragged into an empty slot: a hero on the roster, or a recruit at the Flagon (hired on drop). */
type Payload = { kind: 'hero'; id: string } | { kind: 'recruit'; id: string; price: number };

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

/**
 * A bust that never holds up the screen: a class drawn before comes straight from bust.ts's cache; a new one shows the
 * CSS figurine first and is rendered a moment later, one class per task (on software WebGL a first render can take
 * seconds, and a fresh Flagon can bring three new classes at once).
 */
const drawn = new Set<string>();
const queue: (() => void)[] = [];
function lazyBust(cls: string, opts: { size: number; label?: string }): HTMLElement {
  if (drawn.has(cls)) return bust(cls, opts);
  const el = document.createElement('div');
  el.className = `bust k-${bustKey(cls)}`;
  el.style.setProperty('--bs', `${opts.size}px`);
  el.dataset.cls = cls;
  if (opts.label) {
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', opts.label);
  } else el.setAttribute('aria-hidden', 'true');
  for (const part of ['sh', 'hd', 'ht']) el.append(h('i', { class: part }));
  queue.push(() => {
    const real = bust(cls, opts); // renders (and caches) the class
    drawn.add(cls);
    if (el.isConnected) el.replaceWith(real);
  });
  if (queue.length === 1) setTimeout(drain, 30);
  return el;
}
function drain(): void {
  const job = queue.shift();
  if (!job) return;
  job();
  if (queue.length) setTimeout(drain, 0);
}

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

  // The Flagon (or the campfire before Wim is home).
  const v = villageOf(s);
  const flagon = v.innkeeper;
  const n = c.recruits.length;
  const about = flagon
    ? `Old Wim's regulars. Some have been inside before.${v.caskbook ? ' The old hands are back too.' : ''} New faces after every delve.`
    : `Drifters warming their hands. Green and cheap. New faces after every delve.`;
  const roomy = l.heroIds.length < room;
  root.append(
    h(
      'div',
      { class: 'pt-fl' },
      h('span', { class: 'kick', tabindex: 0, 'data-tip': `${flagon ? 'At the Gilded Flagon' : 'At the campfire'} · ${n} looking for work\n${about}` }, flagon ? 'At the Gilded Flagon' : 'At the campfire'),
      n ? h('span', { class: 'pt-fl-sm' }, roomy ? 'Drag someone into a slot, or press Hire' : 'The party is full: hired hands wait on the roster') : '',
    ),
  );
  if (!n) root.append(h('div', { class: 'pt-recs pt-recs-none' }, h('p', { class: 'lg-empty' }, 'Nobody looking for work. Come back after the next delve.')));
  else {
    const grid = h('div', { class: 'pt-recs' });
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
  return null;
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
  return h(
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
    h('div', { class: 'pt-bustw', 'data-tip': statsTip(hr.cls, hr) }, lazyBust(hr.cls, { size: 196, label: `${hr.name}, ${className(hr.cls)}` })),
    h('h3', { class: 'lg-slot-n' }, hr.name),
    clsRow(hr),
    vit,
    hr.ale ? h('span', { class: 'pt-ale lg-slot-ale', 'data-tip': `${ALE[hr.ale].name} · drunk when ${hr.name} starts the next delve\n${ALE[hr.ale].text}` }, ic('mug'), ALE[hr.ale].name) : '',
    h('div', { class: `pt-abw k-${key}` }, abilityTiles(hr.cls, host)),
  );
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
    accepts: (p) => {
      price.replaceChildren();
      if (p.kind === 'recruit') {
        if (c.gold < p.price) return `Hire · ${p.price} gold\nYou have ${c.gold} gold.`;
        what.textContent = 'Drop to hire';
        price.append(ic('coin'), `${p.price}`);
      } else what.textContent = 'Drop to take along';
      return true;
    },
    onDrop: (p) => {
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
      h('span', { class: 'pt-bh-b' }, lazyBust(hr.cls, { size: 58 })),
      h('span', { class: 'pt-bh-t' }, h('span', { class: 'pt-bh-n' }, hr.name), h('span', { class: 'pt-bh-c' }, ic(ROLE_ICON[hr.cls] ?? 'star'), hurt(hr) ? h('span', { class: 'num low' }, `${hpOf(hr)}/${hr.maxHp}`) : h('span', { class: 'num' }, `${hr.maxHp}`), ic('heart', { class: 'hrt' }))),
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
    h('div', { class: 'bw', 'data-tip': statsTip(hr.cls, hr) }, lazyBust(hr.cls, { size: 104 })),
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

