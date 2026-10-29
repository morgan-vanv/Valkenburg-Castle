// V5.1 (W0): step 2, Party: party slots, the roster bench, the Flagon's recruits. Split out of src/ui/lowgate.ts.

import type { GameState, Hero } from '../../game/types';
import { CLASSES, HEAL_PER_HP, SQUAD_SLOTS_MAX, squadSlots } from '../../game/data';
import { sfx } from '../../audio/sfx';
import { h } from '../dom';
import { ALE, type AbilityChip, type AnyClass, CLASS_ABILITIES, CLASS_PLAN, CLASS_ROLE, PARTY_CAN, className, itemBase } from '../names';
import { type Loadout, type CampHost, isHeir, packItems, numWord, heroOf, hpOf, hurt, classLine, statsTip, hexBadge, tick, heart, btn, villageOf, stepHead } from './shared';

export function partyStep(main: HTMLElement, s: GameState, l: Loadout, host: CampHost): void {
  const c = s.campaign;
  const v = villageOf(s);
  // V4.1 (squads, spec 31.12): three slots until the muster roll is home; the fourth shows locked with Wim's hint.
  const room = squadSlots(c);
  main.append(stepHead('Who goes in?', `Up to ${room >= SQUAD_SLOTS_MAX ? 'four' : room === 3 ? 'three for now' : room}. Keven can go alone, but if he falls, it's over.`));
  const set = (next: Loadout) => host.setDraft(next, 'party');
  const slots = h('div', { class: 'lg-slots', role: 'list', 'aria-label': 'Party' });
  for (let i = 0; i < Math.max(SQUAD_SLOTS_MAX, room); i++) {
    const id = l.heroIds[i];
    const hr = id ? heroOf(c, id) : undefined;
    if (hr) slots.append(heroSlot(hr, s, l, host, set));
    else if (i >= room) {
      const muster = c.board.some((k) => k.story === 'muster');
      const hint = "Wim says the old muster roll is in the officers' quarters. With it, a fourth could sign on.";
      slots.append(h('div', { class: 'lg-slot empty locked', role: 'listitem', 'data-slot': `${i}`, 'data-locked': 'muster', tabindex: 0, 'data-tip': `A fourth slot · locked\n${hint}${muster ? '\nThe job is on the notice post.' : ''}` }, h('span', { class: 'lg-slot-e' }, '🔒 Locked'), h('span', { class: 'lg-slot-h' }, hint)));
    } else {
      const first = i === l.heroIds.length;
      const bench = c.roster.some((x) => !l.heroIds.includes(x.id));
      slots.append(h('div', { class: `lg-slot empty ${first ? 'first' : ''}`, role: 'listitem', 'data-slot': `${i}` }, h('span', { class: 'lg-slot-e' }, 'Empty'), first && c.recruits.length ? h('span', { class: 'lg-slot-h' }, 'Hire someone below.') : first && bench ? h('span', { class: 'lg-slot-h' }, 'Add someone from your roster.') : ''));
    }
  }
  main.append(slots);

  const bench = c.roster.filter((x) => !l.heroIds.includes(x.id));
  if (bench.length) {
    const full = l.heroIds.length >= room; // V4.1 (squads)
    main.append(
      h(
        'div',
        { class: 'lg-bench' },
        h('span', { class: 'lg-kick lg-kick-dim' }, 'Your roster'),
        ...bench.map((hr) =>
          btn(
            {
              class: `lg-benchhero ${hurt(hr) ? 'wounded' : ''}`,
              k: `bench-${hr.id}`,
              data: { bench: hr.id },
              off: full,
              tip: full ? `${hr.name} · The party is full. Take someone out first.` : `${hr.name} · ${classLine(hr)}\n${hpOf(hr)} of ${hr.maxHp} HP. Click to take them along.`,
              onclick: () => {
                sfx.play('click');
                const next = structuredClone(l);
                next.heroIds.push(hr.id);
                if (isHeir(c, hr.id)) next.heroIds.sort((a, b) => Number(isHeir(c, b)) - Number(isHeir(c, a)));
                set(next);
              },
            },
            hexBadge(hr.cls, 'sm'),
            h('span', { class: 'lg-bh-n' }, hr.name),
            h('span', { class: 'lg-bh-c' }, classLine(hr)),
            hurt(hr) ? h('span', { class: 'lg-bh-hp' }, `${hpOf(hr)}/${hr.maxHp} HP`) : '',
            h('span', { class: 'lg-bh-add', 'aria-hidden': 'true' }, '+'),
          ),
        ),
      ),
    );
  }

  main.append(partyCan(s, l));

  const flagon = v.innkeeper;
  const n = c.recruits.length;
  const sub = flagon
    ? `Old Wim's regulars. Some have been inside before.${v.caskbook ? ' The old hands are back too.' : ''} New faces after every delve.`
    : `${numWord(n)} drifter${n === 1 ? '' : 's'} warm${n === 1 ? 's' : ''} their hands. Green and cheap. New faces after every delve.`;
  main.append(
    h(
      'div',
      { class: 'lg-sh lg-sh-sm' },
      h('div', { class: 'lg-sh-l' }, h('h3', { class: 'lg-h3' }, flagon ? 'At the Gilded Flagon' : 'At the campfire'), h('p', { class: 'lg-sub' }, sub)),
      n ? h('span', { class: 'lg-sub' }, l.heroIds.length < room ? 'Hired hands go straight into a free slot.' : 'The party is full: hired hands wait on the roster.') : '',
    ),
  );
  if (!n) main.append(h('p', { class: 'lg-empty' }, 'Nobody looking for work. Come back after the next delve.'));
  else {
    const grid = h('div', { class: 'lg-recruits', style: `--cols:${Math.min(4, Math.max(3, n))}` });
    for (const r of c.recruits) grid.append(recruitCard(r.hero, r.price, s, l, host));
    main.append(grid);
  }
}

function heroSlot(hr: Hero, s: GameState, l: Loadout, host: CampHost, set: (l: Loadout) => void): HTMLElement {
  const c = s.campaign;
  const v = villageOf(s);
  const heir = isHeir(c, hr.id);
  const hp = hpOf(hr);
  const wounded = hp < hr.maxHp;
  const kids: (HTMLElement | string)[] = [];
  if (wounded) {
    const low = hp * 3 <= hr.maxHp;
    kids.push(
      h(
        'span',
        { class: 'lg-hpbar-row', 'data-tip': `${hr.name} · ${hp} of ${hr.maxHp} HP\nWounds don't mend between delves. ${v.surgeon ? `Brother Aldric heals for ${HEAL_PER_HP} gold per HP.` : 'A potion from the cart heals 5.'}` },
        h('span', { class: 'lg-hpbar', 'aria-hidden': 'true' }, h('i', { style: `width:${Math.round((hp / hr.maxHp) * 100)}%` })),
        h('span', { class: `lg-hpw ${low ? 'low' : ''}` }, h('span', { class: 'num' }, `${hp}`), ' of ', h('span', { class: 'num' }, `${hr.maxHp}`), ' HP'),
      ),
    );
    const btns = h('span', { class: 'lg-heal' });
    if (v.surgeon) {
      const missing = hr.maxHp - hp;
      const can = Math.min(missing, Math.floor(c.gold / HEAL_PER_HP));
      const full = missing * HEAL_PER_HP;
      const label = can > 0 && can < missing ? `Heal ${can} of ${missing} HP · ` : 'Heal · ';
      btns.append(
        btn(
          {
            class: 'btn lg-btn-s lg-primary',
            k: `heal-${hr.id}`,
            data: { heal: hr.id },
            off: !can,
            tip: !can ? `Heal · ${full} gold\nYou have ${c.gold} gold.` : can < missing ? `Heal · ${can * HEAL_PER_HP} gold\nBrother Aldric heals ${can} of the ${missing} HP: all your gold covers. ${HEAL_PER_HP} gold per HP.` : `Heal · ${full} gold\nBrother Aldric patches ${hr.name} up to full: ${HEAL_PER_HP} gold per HP.`,
            onclick: async () => {
              if (await host.send({ type: 'heal', heroId: hr.id })) sfx.play('spell');
            },
          },
          label,
          h('span', { class: 'num' }, `${can > 0 ? can * HEAL_PER_HP : full}`),
          ' gold',
        ),
      );
    }
    const pots = c.stash.filter((i) => i.kind === 'potion').length;
    if (pots)
      btns.append(
        btn(
          {
            class: 'btn lg-btn-s',
            k: `drink-${hr.id}`,
            data: { drink: hr.id },
            tip: `Drink a potion · ${hr.name} heals ${Math.min(5, hr.maxHp - hp)} HP\n${pots} on the cart. A drunk potion doesn't go in.`,
            onclick: async () => {
              if (await host.send({ type: 'drink', heroId: hr.id })) sfx.play('spell', { pitch: 0.9 });
            },
          },
          'Drink a potion',
        ),
      );
    if (btns.childElementCount) kids.push(btns);
  } else {
    kids.push(h('span', { class: 'lg-hp', 'data-tip': `${hr.name} · ${hp} HP, unhurt.` }, heart(), h('span', { class: 'num' }, `${hp}`), ' HP'));
  }
  if (heir) kids.push(h('span', { class: 'lg-heirwarn' }, "If he falls, it's over."));
  return h(
    'div',
    { class: `lg-slot hero ${heir ? 'heir' : ''} ${wounded ? 'wounded' : ''}`, role: 'listitem', 'data-hero': hr.id },
    h(
      'span',
      { class: 'lg-slot-top' },
      hexBadge(hr.cls, 'lg', statsTip(hr.cls, hr)),
      h('span', { class: 'lg-slot-t' }, h('span', { class: 'lg-slot-n' }, hr.name), h('span', { class: 'lg-slot-c' }, classLine(hr)), hr.ale ? h('span', { class: 'lg-slot-ale', 'data-tip': `${ALE[hr.ale].name} · drunk when ${hr.name} starts the next delve\n${ALE[hr.ale].text}` }, `${ALE[hr.ale].glyph} ${ALE[hr.ale].name}`) : ''),
      btn(
        {
          class: 'lg-x',
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
    ),
    ...kids,
  );
}

/** "This party can": chips lit when someone going in brings it. */
function partyCan(s: GameState, l: Loadout): HTMLElement {
  const c = s.campaign;
  const party = l.heroIds.map((id) => heroOf(c, id)).filter((x): x is Hero => !!x);
  const row = h('div', { class: 'lg-can', role: 'list', 'aria-label': 'This party can' }, h('span', { class: 'lg-kick lg-kick-dim' }, 'This party can'));
  for (const cap of PARTY_CAN) {
    let who: string[];
    if (cap.id === 'melee') who = party.filter((x) => !CLASSES[x.cls]?.weapon.range).map((x) => `${x.name} (${CLASSES[x.cls]?.weapon.name.toLowerCase() ?? 'blade'})`);
    else if (cap.id === 'locks')
      who = party.filter((x) => x.cls === 'burglar' || packItems(c, l, x.id).some((i) => itemBase(i.kind) === 'lockpicks')).map((x) => (x.cls === 'burglar' ? x.name : `${x.name} (lockpicks)`));
    else who = party.filter((x) => (cap.classes as string[]).includes(x.cls)).map((x) => x.name);
    const yes = who.length > 0;
    row.append(h('span', { class: `lg-canchip ${yes ? 'yes' : 'no'}`, role: 'listitem', tabindex: 0, 'data-can': cap.id, 'data-tip': yes ? `${cap.label} · ${who.join(', ')}` : `${cap.label} · Nobody going in.\nWho brings it: ${cap.who}` }, yes ? tick('#e8a33d', 12) : '', cap.label));
  }
  return row;
}

function abilityChips(cls: string, host: CampHost): AbilityChip[] {
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

function recruitCard(hr: Hero, price: number, s: GameState, l: Loadout, host: CampHost): HTMLElement {
  const c = s.campaign;
  const plan = CLASS_PLAN[hr.cls as AnyClass];
  let role = CLASS_ROLE[hr.cls as AnyClass] ?? '';
  try {
    role = host.engine.classInfo(hr.cls).role || role;
  } catch {
    /* names.ts */
  }
  const short = c.gold < price;
  return h(
    'article',
    { class: `lg-rc cls-${hr.cls}`, 'data-recruit': hr.id },
    h('div', { class: 'lg-rc-top' }, hexBadge(hr.cls, 'lg', statsTip(hr.cls, hr)), h('div', { class: 'lg-rc-who' }, h('span', { class: 'lg-rc-n' }, hr.name), h('span', { class: 'lg-rc-c' }, `${className(hr.cls)} · Level ${hr.level}`)), plan ? h('span', { class: 'lg-chip lg-plantag', 'data-tip': `${plan.tag} · what a ${className(hr.cls)} is for` }, plan.tag) : ''),
    h('p', { class: 'lg-rc-role' }, role),
    plan ? h('div', { class: 'lg-rc-best' }, h('span', { class: 'lg-kick' }, 'Best at'), h('span', null, plan.best)) : '',
    h(
      'div',
      { class: 'lg-abs' },
      ...abilityChips(hr.cls, host).map((a) => h('button', { type: 'button', class: 'lg-ab', 'data-tip': `${a.name} · ${a.kind}\n${a.plain}`, 'data-tip-nums': a.nums || undefined, 'data-ability': a.name }, a.name)),
    ),
    h(
      'div',
      { class: 'lg-rc-foot' },
      h('span', { class: 'lg-hp', 'data-tip': `${hr.name} · ${hr.maxHp} HP` }, heart(), h('span', { class: 'num' }, `${hr.maxHp}`), ' HP'),
      btn(
        {
          class: 'btn lg-btn lg-primary lg-hire',
          k: `hire-${hr.id}`,
          data: { hire: hr.id },
          off: short,
          tip: short ? `Hire · ${price} gold\nYou have ${c.gold} gold.` : `Hire ${hr.name} · ${price} gold\n${l.heroIds.length < squadSlots(c) ? 'Goes straight into a free party slot.' : 'The party is full: they wait on the roster.'}`,
          onclick: async () => {
            if (!(await host.send({ type: 'hire', heroId: hr.id }))) return;
            sfx.play('coin');
            if (l.heroIds.length < squadSlots(c)) host.setDraft({ ...structuredClone(l), heroIds: [...l.heroIds, hr.id] }, 'party');
          },
        },
        'Hire · ',
        h('span', { class: 'num' }, `${price}`),
      ),
    ),
  );
}
