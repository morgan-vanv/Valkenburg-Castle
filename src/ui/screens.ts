// Full-screen pages: title, camp (stations), prepare delve, summary, game over.

import type { Engine } from '../game/api';
import type { AleKind, Campaign, Captive, Command, Contract, GameState, Hero, Item, StoryId, Village } from '../game/types';
import { sfx } from '../audio/sfx';
import { clear, gold, h } from './dom';
import { HEAL_PER_HP } from '../game/data';
import { ALE, CREW, ITEM_EFFECT, STORY, V37, aleNeeds, itemBase, CLASS_GEAR, CLASS_KIT, CLASS_ROLE, classGlyph, className, itemGlyph, itemLabel, storyFix } from './names';

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
  /** V3.5 (18.7): what was won back on this return to camp, for the moment; cleared on dismiss. */
  wonBack: StoryId[];
  dismissWonBack(): void;
}

export type Station = 'board' | 'quartermaster' | 'smithy' | 'tavern' | 'infirmary' | 'stash' | 'memorial' | 'prepare';

export interface Loadout {
  contractId?: string;
  heroIds: string[];
  packs: Record<string, string[]>;
  entrance: number;
  /** 16.2: shutter the lantern as the delve starts (Level 1 has daylight). */
  startShuttered?: boolean;
}

const TITLE = 'Valkenburg Castle';
const SUBTITLE = "The Heir's Return";

const WEAPON_PRICE = [0, 60, 150];
const ARMOR_PRICE = [0, 80, 200];
const LEVEL_XP = [0, 0, 5, 12, 20, 30, 45];

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

// ------------------------------------------------------------ camp

interface StationDef {
  id: Station;
  name: string;
  glyph: string;
  blurb: string;
  /** 18.2: what is missing, with the fix ("The forge is cold. Rescue Gerda the smith (Level 2, the cellblock)."). */
  locked?: string;
  /** Which story lights it up (for the won-back moment). */
  story?: StoryId[];
}

/** 18.2: Lowgate's stations, named by what has been won back. */
export function stationsFor(v: Village): StationDef[] {
  return [
    { id: 'board', name: 'Notice post', glyph: '✠', blurb: 'Contracts, and pleas from the village' },
    v.innkeeper
      ? { id: 'tavern', name: 'The Gilded Flagon', glyph: '⚜', blurb: v.copper ? 'Hire hands · ales on tap' : 'Hire hands · the taps are dry', story: ['innkeeper', 'copper', 'caskbook'] }
      : { id: 'tavern', name: 'Campfire', glyph: '♨', blurb: 'Drifters for hire', locked: `The Flagon is shut. ${storyFix('innkeeper')}.`, story: ['innkeeper'] },
    { id: 'quartermaster', name: 'Peddler', glyph: '⚱', blurb: v.smith ? 'Torches, potions, rope, metalwork' : 'Torches, potions, rope', locked: v.smith ? undefined : `No metalwork without a smith. ${storyFix('smith')}.`, story: ['smith'] },
    { id: 'smithy', name: 'Forge', glyph: '⚒', blurb: v.smith ? 'Better blades and mail' : 'Cold', locked: v.smith ? undefined : `The forge is cold. ${storyFix('smith')}.`, story: ['smith'] },
    { id: 'infirmary', name: 'Infirmary', glyph: '✚', blurb: v.surgeon ? `Heal for ${HEAL_PER_HP} gold per HP` : 'No surgeon: potions only', locked: v.surgeon ? undefined : `No surgeon. ${storyFix('surgeon')}.`, story: ['surgeon'] },
    { id: 'stash', name: "Keven's cart", glyph: '▣', blurb: 'Gold and goods' },
    { id: 'memorial', name: 'The graves', glyph: '✝', blurb: 'The fallen' },
  ];
}

const NO_VILLAGE: Village = { surgeon: false, innkeeper: false, smith: false, copper: false, caskbook: false };
/** Tolerant of a state from an engine that hasn't set the village yet. */
export function villageOf(s: GameState): Village {
  return s.campaign.village ?? NO_VILLAGE;
}

export function campScreen(el: HTMLElement, s: GameState, host: ScreenHost): void {
  clear(el);
  const c = s.campaign;
  const v = villageOf(s);
  const won = new Set(host.wonBack);
  const nav = h('nav', { class: 'camp-nav' });
  for (const st of stationsFor(v)) {
    const badge = st.id === 'infirmary' ? c.roster.filter(hurt).length : st.id === 'memorial' ? c.fallen.length : st.id === 'tavern' ? c.recruits.length : st.id === 'board' ? c.board.filter((k) => k.story).length : 0;
    const lit = !!st.story?.some((x) => won.has(x));
    // A station is fully locked when it can't do its job at all (the forge); partly when only some of it waits (peddler, infirmary, campfire).
    const cold = st.id === 'smithy' && !!st.locked;
    nav.append(
      h(
        'button',
        {
          class: `station st-${st.id} ${host.station === st.id ? 'on' : ''} ${st.id === 'tavern' && needsHire(s) ? 'call' : ''} ${cold ? 'locked' : st.locked ? 'partial' : ''} ${lit ? 'won' : ''}`,
          'data-station': st.id,
          title: st.locked ? `${st.name} · ${st.locked}` : `${st.name} · ${st.blurb}`,
          onclick: () => host.setStation(st.id),
        },
        h('span', { class: 'st-glyph' }, st.glyph),
        h('span', { class: 'st-text' }, h('b', null, st.name), h('span', { class: 'dim small' }, st.blurb)),
        cold ? h('span', { class: 'st-lock', 'aria-label': 'locked' }, '⚿') : badge ? h('span', { class: `st-badge num ${st.id === 'board' ? 'st-badge-story' : ''}` }, `${badge}`) : '',
      ),
    );
  }
  const head = h(
    'header',
    { class: 'camp-head' },
    h('div', null, h('div', { class: 'kicker' }, `Under the walls of Valkenburg · delve ${c.delveCount + 1}`), h('h1', { class: 'screen-title' }, 'Lowgate')),
    h('div', { class: 'ledger' }, stat('Gold', gold(c.gold), 'stat-gold'), stat('Reputation', `${c.reputation}`), stat('Roster', `${c.roster.length}`), stat('Won back', `${Object.values(v).filter(Boolean).length}/5`)),
  );
  const body = h('section', { class: 'camp-body' });
  if (host.wonBack.length) body.append(wonBackBanner(host));
  else if (c.delveCount === 0 && host.station === 'board') body.append(introCard());
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
  const rosterStrip = h('aside', { class: 'camp-roster' }, h('div', { class: 'kicker' }, 'Roster'), ...c.roster.map((hr) => heroChip(hr)), captivesPanel(c, host), villagePanel(v, c.board));
  el.append(h('div', { class: 'camp' }, head, h('div', { class: 'camp-grid' }, nav, body, rosterStrip)));
}

/** 18.7: the moment something is won back: a banner with the village's line, the station lit in the nav. */
function wonBackBanner(host: ScreenHost): HTMLElement {
  return h(
    'div',
    { class: 'won-back' },
    h('div', { class: 'kicker' }, 'Won back for Lowgate'),
    ...host.wonBack.map((id) => h('p', { class: 'wb-line' }, h('span', { class: 'wb-glyph' }, '✦'), STORY[id].line, h('span', { class: 'wb-what dim small' }, ` ${STORY[id].unlocks}.`))),
    h(
      'div',
      { class: 'wb-actions' },
      ...[...new Set(host.wonBack.map((id) => STORY[id].station))].map((st) =>
        h(
          'button',
          {
            class: 'btn btn-small btn-primary',
            onclick: () => {
              host.dismissWonBack();
              host.setStation(st);
            },
          },
          `Visit the ${st === 'tavern' ? 'Flagon' : st === 'smithy' ? 'forge' : st === 'quartermaster' ? 'peddler' : 'infirmary'}`,
        ),
      ),
      h('button', { class: 'btn btn-small btn-ghost', onclick: () => host.dismissWonBack() }, 'Back to the post'),
    ),
  );
}

function introCard(): HTMLElement {
  return h('div', { class: 'intro-card' }, h('div', { class: 'kicker' }, "The Heir's Return"), ...INTRO.map((l) => h('p', null, l)));
}

/** What Lowgate has won back, under the roster: each villager or thing, home or still in the castle. */
function villagePanel(v: Village, board: Contract[] = []): HTMLElement {
  const order: StoryId[] = ['surgeon', 'innkeeper', 'smith', 'copper', 'caskbook'];
  // 19.1: the one-line reason comes from the engine's story contract when it's on the post.
  const why = (id: StoryId) => board.find((k) => k.story === id)?.brief;
  return h(
    'div',
    { class: 'village-panel' },
    h('div', { class: 'kicker', title: 'Lowgate · Story contracts on the notice post bring these home. Each one wins back part of the village.' }, 'Lowgate'),
    ...order.map((id) =>
      h(
        'div',
        { class: `vp-row ${v[id] ? 'home' : ''}`, 'data-story': id, title: v[id] ? `${cap(STORY[id].who)} · home. ${STORY[id].unlocks}.` : `${cap(STORY[id].who)} · still in the castle (${STORY[id].where}). ${why(id) ? `${why(id)} ` : ''}On the post ${STORY[id].when}. Wins back: ${STORY[id].unlocks.toLowerCase()}.` },
        h('span', { class: 'vp-mark' }, v[id] ? '✦' : '·'),
        h('span', null, cap(STORY[id].who)),
        h('span', { class: 'vp-state small' }, v[id] ? 'home' : STORY[id].where.replace(/^Level (\d), (the )?/, 'L$1 ')),
      ),
    ),
  );
}

/** V3.7 (20.4): the "Bring back" contract for a captive, if it is on the post (by site, else by title). */
export function captiveContract(c: Campaign, cp: Captive): Contract | undefined {
  return c.board.find((k) => k.kind === 'rescue' && (k.siteId === cp.siteId || k.title === `Bring back ${cp.hero.name}`));
}

/** The captive a contract brings back, if any. */
export function contractCaptive(c: Campaign, k: Contract): Captive | undefined {
  return (c.captives ?? []).find((cp) => captiveContract(c, cp)?.id === k.id);
}

/** V3.7 (20.4): heroes a crew carried off, under the roster, each with its "Bring back" job. */
function captivesPanel(c: Campaign, host: ScreenHost): HTMLElement | '' {
  const list = c.captives ?? [];
  if (!list.length) return '';
  return h(
    'div',
    { class: 'captives-panel' },
    h('div', { class: 'kicker', title: 'Captives · Heroes a rival crew dragged out of the castle. Each is held at that crew\'s hideout at 1 HP, with level and gear but no gold. Take the "Bring back" job to free them; freed and brought out, they rejoin the roster.' }, 'Captives'),
    ...list.map((cp) => {
      const k = captiveContract(c, cp);
      const crew = CREW[cp.crew];
      return h(
        'div',
        { class: `cap-row crew-${cp.crew}`, 'data-captive': cp.hero.id, title: `${cp.hero.name} · L${cp.hero.level} ${className(cp.hero.cls)}, taken by ${crew?.name ?? 'a crew'} on delve ${cp.delve}.\nHeld at their hideout${crew ? ` (${crew.where})` : ''} at 1 HP. Gold and gems lost; level and gear kept.${k ? `\n"${k.title}" is on the notice post: ${k.bounty} gold.` : ''}` },
        classBadge(cp.hero.cls),
        h('div', { class: 'cap-body' }, h('b', null, cp.hero.name), h('div', { class: 'dim small' }, `L${cp.hero.level} ${className(cp.hero.cls)} · held by ${crew?.name ?? 'a crew'}`)),
        k
          ? h(
              'button',
              {
                class: 'btn btn-small cap-go',
                title: `${k.title} · ${k.bounty} gold · Level ${k.level}`,
                onclick: () => {
                  const l = host.lastLoadout ?? { heroIds: [], packs: {}, entrance: 0 };
                  host.saveLoadout({ ...l, contractId: k.id });
                  host.setStation('prepare');
                },
              },
              'Bring back',
            )
          : h('span', { class: 'dim small' }, 'lost'),
      );
    }),
  );
}

function cap(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** A station's locked note with the fix and a link to the pinned story contract, if it's up. */
function lockNote(el: HTMLElement, s: GameState, host: ScreenHost, text: string, story: StoryId): void {
  const pinned = s.campaign.board.find((k) => k.story === story);
  el.append(
    h(
      'div',
      { class: 'lock-note' },
      h('span', { class: 'ln-glyph' }, '⚿'),
      h('div', null, h('b', null, text), h('div', { class: 'dim small' }, pinned ? `${STORY[story].unlocks}. The job is pinned on the notice post.` : `${STORY[story].unlocks}. The job goes up on the notice post ${STORY[story].when}.`)),
      pinned
        ? h(
            'button',
            {
              class: 'btn btn-small',
              onclick: () => {
                const l = host.lastLoadout ?? { heroIds: [], packs: {}, entrance: 0 };
                host.saveLoadout({ ...l, contractId: pinned.id });
                host.setStation('prepare');
              },
            },
            'Take the job',
          )
        : '',
    ),
  );
}

function stat(label: string, value: string, cls = ''): HTMLElement {
  return h('div', { class: `stat ${cls}` }, h('span', { class: 'stat-label' }, label), h('span', { class: 'stat-value num' }, value));
}

function classBadge(cls: string): HTMLElement {
  return h('span', { class: `cbadge cls-${cls}`, title: className(cls) }, classGlyph(cls));
}

/** Keven alone: the squad needs hiring before the first delve. */
function needsHire(s: GameState): boolean {
  return !s.campaign.roster.some((x) => x.cls !== 'heir');
}

/** Spec 17.2: HP carries over between delves. */
function hpOf(hr: Hero): number {
  return Math.min(hr.maxHp, hr.hp ?? hr.maxHp);
}
function hurt(hr: Hero): boolean {
  return hpOf(hr) < hr.maxHp;
}
/** "7/10 HP", marked when hurt (badly when at a third or less). */
function hpText(hr: Hero): HTMLElement {
  const hp = hpOf(hr);
  const cls = hp >= hr.maxHp ? '' : hp * 3 <= hr.maxHp ? 'neg' : 'warn';
  return h('span', { class: `hp-text ${cls}`, title: hp < hr.maxHp ? `${hr.name} goes in with ${hp} of ${hr.maxHp} HP. Wounds don't mend between delves; the infirmary heals for ${HEAL_PER_HP} gold per HP.` : 'Unhurt.' }, `${hp}/${hr.maxHp} HP`);
}

function heroChip(hr: Hero): HTMLElement {
  const next = LEVEL_XP[hr.level + 1];
  return h(
    'div',
    { class: `hchip ${hurt(hr) ? 'wounded' : ''}`, 'data-hero': hr.id },
    classBadge(hr.cls),
    h('div', { class: 'hchip-body' }, h('b', null, hr.name, hr.shield ? h('span', { class: 'shield-mark', title: 'Carries a shield: ranged hits do 1 less (2 while braced).' }, ' ◉') : ''), h('div', { class: 'dim small' }, `L${hr.level} ${className(hr.cls)} · `, hpText(hr), next ? ` · XP ${hr.xp}/${next}` : '')),
    hr.ale ? aleBadge(hr.ale, hr.name) : '',
  );
}

/** 18.4: a hero's waiting ale, as a small badge with its effect. */
export function aleBadge(kind: AleKind, name: string): HTMLElement {
  const a = ALE[kind];
  return h('span', { class: `ale-badge ale-${kind}`, title: `${a.name} · drunk when ${name} starts the next delve\n${a.text}` }, h('span', { class: 'ale-g' }, a.glyph), h('span', { class: 'ale-n' }, a.name));
}

function stationHead(title: string, text: string): HTMLElement {
  return h('div', { class: 'st-head' }, h('h2', null, title), h('p', { class: 'dim' }, text));
}

// ---- board

function boardStation(el: HTMLElement, s: GameState, host: ScreenHost): void {
  el.append(stationHead('Notice post', 'Jobs nailed to the post. Bounties pay only if the prize comes out with you.'));
  const hire = needsHire(s);
  if (hire)
    el.append(
      h(
        'div',
        { class: 'hire-first' },
        h('b', null, 'Hire at least one hero'),
        h('span', null, ` Keven will not go in alone. Find hands at the ${villageOf(s).innkeeper ? 'Flagon' : 'campfire'} first.`),
        h('button', { class: 'btn btn-primary btn-small', onclick: () => host.setStation('tavern') }, `Go to the ${villageOf(s).innkeeper ? 'Flagon' : 'campfire'}`),
      ),
    );
  // V3.7 (20.4): "Bring back <name>" jobs for captives come first, with their own seal.
  const rescues = s.campaign.board.filter((k) => contractCaptive(s.campaign, k));
  if (rescues.length) {
    el.append(h('h3', { class: 'board-h captive-h', title: 'Captives · A crew dragged one of yours out. The hideout is theirs; the prisoner is your own hero, at 1 HP. Freed and brought out, they rejoin with their level and gear.' }, h('span', { class: 'seal-mini seal-cap' }, '⛓'), ' Taken by a crew'));
    const rg = h('div', { class: 'contracts captive-contracts' });
    for (const k of rescues) rg.append(contractCard(k, host, hire, contractCaptive(s.campaign, k)));
    el.append(rg);
  }
  const story = s.campaign.board.filter((k) => k.story);
  if (story.length) {
    el.append(h('h3', { class: 'board-h story-h', title: 'For Lowgate · Pinned by the village. Half the usual bounty, but each one wins back part of Lowgate for good.' }, h('span', { class: 'seal-mini' }, '✦'), ' Pinned by the village'));
    const sg = h('div', { class: 'contracts story-contracts' });
    for (const k of story) sg.append(contractCard(k, host, hire));
    el.append(sg);
    el.append(h('h3', { class: 'board-h' }, 'Bounties'));
  }
  const grid = h('div', { class: 'contracts' });
  for (const k of s.campaign.board.filter((x) => !x.story && !contractCaptive(s.campaign, x))) grid.append(contractCard(k, host, hire));
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

function contractCard(k: Contract, host: ScreenHost, locked = false, captive?: Captive): HTMLElement {
  const st = k.story ? STORY[k.story] : null;
  const crew = captive ? CREW[captive.crew] : null;
  return h(
    'article',
    { class: `contract kind-${k.kind} ${st ? 'story' : ''} ${captive ? `captive crew-${captive.crew}` : ''}`, 'data-story': k.story ?? '', 'data-captive': captive?.hero.id ?? '' },
    st ? h('span', { class: 'ct-seal', title: 'For Lowgate · A story contract. Done, it wins back part of the village for good.' }, '✦') : '',
    captive ? h('span', { class: 'ct-seal ct-seal-cap', title: `Taken by ${crew?.name ?? 'a crew'} · ${captive.hero.name} is held at their hideout. Free them and bring them out.` }, '⛓') : '',
    h('div', { class: 'ct-top' }, h('span', { class: 'kicker' }, `${st ? 'For Lowgate · ' : captive ? `Taken by ${crew?.name ?? 'a crew'} · ` : ''}${KIND_WORD[k.kind]} · Level ${k.level}`), h('span', { class: 'ct-bounty num' }, `${k.bounty}`, h('small', null, ' gold'))),
    k.kind === 'slay' ? h('h3', null, h('span', { class: 'ct-dragon', 'aria-hidden': 'true' }, '🐉 '), k.title) : h('h3', null, k.title),
    h('p', null, k.brief),
    captive ? h('div', { class: 'ct-unlock ct-captive', title: `${captive.hero.name} · L${captive.hero.level} ${className(captive.hero.cls)}. Held at 1 HP with level and gear; gold and gems are gone. Freed and extracted, they rejoin the roster with the HP they come out with.` }, classBadge(captive.hero.cls), h('span', null, h('span', { class: 'kicker' }, 'The prisoner is yours'), h('b', null, ` ${captive.hero.name}, L${captive.hero.level} ${className(captive.hero.cls)} · HP 1`))) : '',
    st ? h('div', { class: 'ct-unlock', title: `Wins back · ${st.unlocks}.\n${k.kind === 'rescue' ? `${cap(st.who)} goes home to Lowgate, not into your roster.` : `${cap(st.who)} goes home to Lowgate, not to the cart. It can't be sold.`}` }, h('span', { class: 'kicker' }, 'Wins back'), h('b', null, st.unlocks)) : '',
    st && k.story === 'copper' ? h('p', { class: 'ct-heavy small' }, 'Heavy: whoever carries it moves 3 at most.') : '',
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
  el.append(stationHead('Peddler', "A pedlar's cart by the gate. Bought goods go on Keven's cart; give them out when you prepare a delve."));
  const offers = host.engine.shop(s);
  if (!villageOf(s).smith) lockNote(el, s, host, 'No metalwork without a smith. Caltrops, hooks and keys wait for Gerda.', 'smith');
  const list = h('div', { class: 'shop' });
  for (const o of [...offers.filter((x) => !x.locked), ...offers.filter((x) => x.locked)]) {
    const have = s.campaign.stash.filter((i) => i.kind === o.kind).length;
    list.append(
      h(
        'div',
        { class: `shop-row ${o.locked ? 'locked' : ''}`, 'data-kind': o.kind },
        h('span', { class: 'shop-glyph' }, itemGlyph(o.kind)),
        h('div', null, h('b', null, o.name), h('div', { class: 'dim small' }, ITEM_EFFECT[itemBase(o.kind)] ?? o.text), o.locked ? h('div', { class: 'lock-why small' }, `⚿ ${o.locked}`) : ''),
        h('span', { class: 'dim small' }, `On the cart: ${have}`),
        h(
          'button',
          {
            class: 'btn btn-small',
            disabled: !!o.locked || s.campaign.gold < o.price,
            title: o.locked ?? (s.campaign.gold < o.price ? `You have ${s.campaign.gold} gold.` : ''),
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
  if (!villageOf(s).smith) {
    el.append(stationHead('Forge', 'Cold ash and a split anvil. Nobody in Lowgate can work steel.'));
    lockNote(el, s, host, 'The forge is cold. Rescue Gerda the smith (Level 2, the cellblock).', 'smith');
    el.append(h('p', { class: 'dim small' }, 'With Gerda home: weapon tiers add +10% per slot per tier, armor tiers soak 1 more damage per hit.'));
    return;
  }
  el.append(stationHead('Forge', `Gerda's forge. Weapon tiers add +10% per slot per tier. Armor tiers soak 1 more damage per hit. A shield (${V37.shieldPrice}) takes 1 off every arrow, bolt and dart (2 while braced).`));
  const t = h('table', { class: 'tbl' });
  t.append(h('tr', null, h('th', null, 'Hero'), h('th', null, 'Weapon'), h('th', null, 'Armor'), h('th', { title: `Shield · ${V37.shieldPrice} gold, any class. Ranged hits (arrows, knockback shots, firebolts, darts) do 1 less; 2 less while braced. Not the Dragon's breath.` }, 'Shield')));
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
    // V3.7 (20.5): a shield per hero.
    const shield = h(
      'td',
      { class: 'td-shield' },
      hr.shield
        ? h('span', { class: 'shield-have', title: `${hr.name} carries a shield: ranged hits do 1 less (2 while braced).` }, '◉ Shield')
        : h(
            'button',
            {
              class: 'btn btn-small',
              'data-shield': hr.id,
              disabled: s.campaign.gold < V37.shieldPrice,
              title: `Buy a shield for ${hr.name} · ${V37.shieldPrice} gold\nRanged hits do 1 less; 2 less while braced. Any class.`,
              onclick: async () => {
                if (await host.send({ type: 'buyShield', heroId: hr.id })) sfx.play('smash', { pitch: 1.6, gain: 0.4 });
              },
            },
            `Buy a shield · ${V37.shieldPrice}`,
          ),
    );
    t.append(h('tr', null, h('td', null, classBadge(hr.cls), ' ', hr.name), cell('weapon'), cell('armor'), shield));
  }
  el.append(t);
}

// ---- tavern

function tavernStation(el: HTMLElement, s: GameState, host: ScreenHost): void {
  const hire = needsHire(s);
  const v = villageOf(s);
  const flagon = v.innkeeper;
  const sub = hire
    ? `Keven can't take the castle alone. Hire at least one hero: you have ${gold(s.campaign.gold)} gold.`
    : flagon
      ? `Old Wim's regulars. Some have been inside before.${v.caskbook ? ' The old hands are back too.' : ''} Offers change after every delve.`
      : 'Three drifters warm their hands at the fire. All green, all cheap. Offers change after every delve.';
  el.append(stationHead(flagon ? 'The Gilded Flagon' : 'Campfire', sub));
  if (!flagon) lockNote(el, s, host, 'The Flagon is shut. Rescue Old Wim (Level 1, the library).', 'innkeeper');
  const grid = h('div', { class: 'recruits' });
  if (!s.campaign.recruits.length) grid.append(h('p', { class: 'dim' }, 'Nobody looking for work. Come back after the next delve.'));
  for (const r of s.campaign.recruits) grid.append(recruitCard(r.hero, r.price, s, host));
  if (flagon) aleMenu(el, s, host);
  el.append(grid);
  if (!hire)
    el.append(h('div', { class: 'screen-actions' }, h('button', { class: 'btn', onclick: () => host.setStation('board') }, 'To the notice post')));
}

/** Whose ale the Flagon pours next (kept between renders). */
let alePick: string | null = null;

/** 18.4: the ale menu: pick a hero, pour an ale; locked ales say what brews them. */
function aleMenu(el: HTMLElement, s: GameState, host: ScreenHost): void {
  const c = s.campaign;
  let offers: ReturnType<Engine['ales']> = [];
  try {
    offers = host.engine.ales(s);
  } catch {
    offers = [];
  }
  if (!c.roster.some((x) => x.id === alePick)) alePick = c.roster.find((x) => !x.ale)?.id ?? c.roster[0]?.id ?? null;
  const who = c.roster.find((x) => x.id === alePick);
  const box = h('div', { class: 'ale-menu' });
  box.append(
    h('div', { class: 'am-head' }, h('h3', null, 'On tap'), h('span', { class: 'dim small' }, 'One ale per hero, drunk as they start the next delve. It lasts that delve.')),
  );
  if (!villageOf(s).copper) {
    box.append(h('div', { class: 'lock-note slim' }, h('span', { class: 'ln-glyph' }, '⚿'), h('div', null, h('b', null, 'The taps are dry.'), h('div', { class: 'dim small' }, "Wim's brewing copper is still in the forge on Level 2. Bring it home and he brews again."))));
  }
  const picks = h('div', { class: 'am-who' }, h('span', { class: 'kicker' }, 'Pour for'));
  for (const hr of c.roster)
    picks.append(
      h(
        'button',
        { class: `btn btn-small am-hero ${hr.id === alePick ? 'on' : ''}`, 'data-hero': hr.id, title: hr.ale ? `${hr.name} · has ${ALE[hr.ale].name} waiting.` : `${hr.name} · no ale yet.`, onclick: () => ((alePick = hr.id), host.setStation('tavern')) },
        classBadge(hr.cls),
        ` ${hr.name}`,
        hr.ale ? h('span', { class: 'am-has' }, ` ${ALE[hr.ale].glyph}`) : '',
      ),
    );
  box.append(picks);
  const list = h('div', { class: 'shop ales' });
  for (const o of offers) {
    const a = ALE[o.kind];
    const busy = !!who?.ale;
    const why = o.locked ?? (busy ? `${who!.name} already has ${ALE[who!.ale!].name} waiting. It is drunk at the start of the next delve.` : c.gold < o.price ? `You have ${c.gold} gold.` : '');
    list.append(
      h(
        'div',
        { class: `shop-row ale-row ${o.locked ? 'locked' : ''}`, 'data-ale': o.kind },
        h('span', { class: 'shop-glyph ale-glyph' }, a.glyph),
        h('div', null, h('b', null, o.name || a.name), h('div', { class: 'dim small' }, a.text), o.locked ? h('div', { class: 'lock-why small' }, `⚿ ${o.locked || aleNeeds(o.needs)}`) : ''),
        h('span', { class: 'dim small' }, o.needs === 'caskbook' ? 'From the cask book' : 'From the copper'),
        h(
          'button',
          {
            class: 'btn btn-small',
            disabled: !who || !!o.locked || busy || c.gold < o.price,
            title: why,
            onclick: async () => {
              if (who && (await host.send({ type: 'buyAle', heroId: who.id, ale: o.kind }))) sfx.play('coin', { pitch: 0.8 });
            },
          },
          who ? `Pour for ${who.name} · ${o.price}` : `${o.price}`,
        ),
      ),
    );
  }
  box.append(list);
  el.append(box);
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
  const c = s.campaign;
  const surgeon = villageOf(s).surgeon;
  el.append(
    stationHead(
      'Infirmary',
      surgeon
        ? `Brother Aldric's cots in the old chapel. Wounds don't mend on their own; he charges ${HEAL_PER_HP} gold per HP. A potion from the cart heals 5 for free.`
        : "Empty cots and no one to tend them. Wounds don't mend on their own: a hero goes back in with the HP they came out with.",
    ),
  );
  if (!surgeon) lockNote(el, s, host, 'No surgeon. Rescue Brother Aldric (Level 1, the library).', 'surgeon');
  const list = c.roster.filter(hurt);
  if (!list.length) {
    el.append(h('p', { class: 'dim' }, 'Every cot is empty. Nobody needs patching.'));
    return;
  }
  // 18.2: drink a potion from the cart: +5 HP, always available.
  const pots = c.stash.filter((i) => i.kind === 'potion').length;
  const drinkBtn = (hr: Hero) =>
    h(
      'button',
      {
        class: 'btn btn-small btn-drink',
        disabled: !pots,
        title: pots ? `Drink a potion · ${hr.name} heals ${Math.min(5, hr.maxHp - hpOf(hr))} HP (5, up to full). ${pots} on the cart.` : 'No potions on the cart. The peddler sells them for 20.',
        onclick: async () => {
          if (await host.send({ type: 'drink', heroId: hr.id })) sfx.play('spell', { pitch: 0.9 });
        },
      },
      `⚱ Drink a potion${pots ? ` (${pots})` : ''}`,
    );
  if (!surgeon) {
    const rows = h('div', { class: 'shop' });
    for (const hr of list)
      rows.append(
        h(
          'div',
          { class: 'shop-row' },
          classBadge(hr.cls),
          h('div', null, h('b', null, hr.name), h('div', { class: 'dim small' }, `L${hr.level} ${className(hr.cls)} · `, hpText(hr))),
          h('span', { class: 'dim small' }, `${hr.maxHp - hpOf(hr)} HP short`),
          drinkBtn(hr),
        ),
      );
    el.append(rows);
    if (!pots) el.append(h('p', { class: 'dim small' }, 'No potions on the cart. The peddler sells them for 20 gold.'));
    return;
  }
  const quote = (hr: Hero, purse: number) => {
    const missing = hr.maxHp - hpOf(hr);
    const hp = Math.min(missing, Math.floor(purse / HEAL_PER_HP));
    return { missing, hp, cost: hp * HEAL_PER_HP };
  };
  const rows = h('div', { class: 'shop' });
  for (const hr of list) {
    const q = quote(hr, c.gold);
    const label = !q.hp ? `Heal · ${q.missing * HEAL_PER_HP}` : q.hp < q.missing ? `Heal ${q.hp} of ${q.missing} HP · ${q.cost}` : `Heal ${q.hp} HP · ${q.cost}`;
    rows.append(
      h(
        'div',
        { class: 'shop-row' },
        classBadge(hr.cls),
        h('div', null, h('b', null, hr.name), h('div', { class: 'dim small' }, `L${hr.level} ${className(hr.cls)} · `, hpText(hr))),
        h('span', { class: 'dim small' }, `Full: ${q.missing * HEAL_PER_HP} gold`),
        h('span', { class: 'heal-btns' }, pots ? drinkBtn(hr) : '', h(
          'button',
          {
            class: 'btn btn-small',
            disabled: !q.hp,
            title: q.hp < q.missing ? 'You can only pay for part of it. Heals as much as your gold covers.' : '',
            onclick: async () => {
              if (await host.send({ type: 'heal', heroId: hr.id })) sfx.play('spell');
            },
          },
          label,
        )),
      ),
    );
  }
  el.append(rows);
  if (list.length > 1) {
    const total = list.reduce((n, hr) => n + (hr.maxHp - hpOf(hr)) * HEAL_PER_HP, 0);
    el.append(
      h(
        'div',
        { class: 'screen-actions' },
        h(
          'button',
          {
            class: 'btn',
            disabled: c.gold < HEAL_PER_HP,
            title: 'Heals everyone in roster order, as far as your gold goes.',
            onclick: async () => {
              let ok = false;
              for (const hr of list) {
                if (!(await host.send({ type: 'heal', heroId: hr.id }))) break;
                ok = true;
              }
              if (ok) sfx.play('spell');
            },
          },
          `Heal everyone · ${total}`,
        ),
      ),
    );
  }
}

// ---- stash

function stashStation(el: HTMLElement, s: GameState, host: ScreenHost): void {
  const c = s.campaign;
  const valuables = c.stash.filter((i) => i.kind === 'gem' || i.kind === 'jewelry' || i.kind === 'heirloom');
  const worth = host.engine.value(valuables);
  el.append(stationHead("Keven's cart", `${gold(c.gold)} gold in the strongbox. Gear waits here until you hand it out.`));
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
  el.append(stationHead('The graves', 'Names cut in the old gatepost, and a row of fresh mounds below it.'));
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
  const fit = (id: string) => c.roster.some((x) => x.id === id);
  const l: Loadout = {
    contractId: contract.id,
    heroIds: prev.heroIds.filter(fit).slice(0, 4),
    packs: {},
    entrance: Math.min(prev.entrance, host.engine.castle().entrances.length - 1),
    startShuttered: !!prev.startShuttered,
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
  if (!l.heroIds.length) l.heroIds = c.roster.slice(0, 4).map((x) => x.id);
  const save = () => {
    host.saveLoadout(l);
    host.setStation('prepare');
  };

  el.append(stationHead(`Prepare: ${contract.title}`, contract.brief));
  // Contract switcher.
  el.append(h('div', { class: 'prep-contracts' }, ...c.board.map((k) => h('button', { class: `btn btn-small ${k.id === contract.id ? 'on' : ''} ${k.story ? 'story' : ''}`, title: k.story ? `${k.title} · For Lowgate. Wins back: ${STORY[k.story].unlocks.toLowerCase()}.` : k.title, onclick: () => ((l.contractId = k.id), save()) }, k.story ? '✦ ' : '', `${KIND_WORD[k.kind]} L${k.level} · ${k.bounty}`))));
  if (contract.story) el.append(h('p', { class: 'prep-story small' }, h('span', { class: 'seal-mini' }, '✦'), ` For Lowgate. Wins back: ${STORY[contract.story].unlocks.toLowerCase()}.${contract.story === 'copper' ? ' The copper is heavy: whoever carries it moves 3 at most.' : ''}`));

  // Party.
  const party = h('div', { class: 'prep-party' });
  for (const hr of c.roster) {
    const on = l.heroIds.includes(hr.id);
    const disabled = !on && l.heroIds.length >= 4;
    party.append(
      h(
        'button',
        {
          class: `pick-hero ${on ? 'on' : ''} ${hurt(hr) ? 'wounded' : ''}`,
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
        h('div', null, h('b', null, hr.name), h('div', { class: 'dim small' }, `L${hr.level} ${className(hr.cls)} · `, hpText(hr))),
        hr.ale ? aleBadge(hr.ale, hr.name) : '',
      ),
    );
  }
  el.append(h('h3', { class: 'prep-h' }, `Party `, h('span', { class: 'dim small' }, `${l.heroIds.length}/4`)), party);
  if (l.heroIds.includes('keven') || l.heroIds.some((id) => c.roster.find((x) => x.id === id)?.cls === 'heir')) {
    el.append(h('p', { class: 'warn-heir' }, '⚠ If Keven dies, it is over. The campaign ends with him.'));
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
  // 16.2: the lantern shutter. Level 1 is mostly daylit, so starting shuttered saves oil for the dark below.
  el.append(
    h('h3', { class: 'prep-h' }, 'Lantern'),
    h(
      'label',
      { class: 'menu-check prep-shutter' },
      h('input', {
        type: 'checkbox',
        checked: !!l.startShuttered,
        onchange: (e: Event) => {
          l.startShuttered = (e.target as HTMLInputElement).checked;
          host.saveLoadout(l);
        },
      }),
      ' Start shuttered ',
      h('span', { class: 'dim small' }, '— the ruins have daylight; a shuttered lantern burns no oil. Open it with L when it gets dark.'),
    ),
  );

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
