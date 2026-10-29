// V5.1 (W0): step 1, Job: the notice post, the welcome card, the won-back banner, renown. Split out of src/ui/lowgate.ts.
// V5.1 (W1): the board as the approved Job board: two rows of at most 3 cards (pinned by the village; work for hire),
// each card an art panel (level shield, pay as a coin stack or the villager's gift, a seal on a plea or a captive),
// the title, the place, what it wins back, risk marks as hexes. The brief of the chosen job is the footer's line
// (footNote); every card's own brief is on its hover. The welcome and the won-back banner are overlays on the board.

import type { Engine } from '../../game/api';
import type { Captive, Contract, GameState, StoryId } from '../../game/types';
import { GIFTS, STORIES } from '../../game/data';
import { sfx } from '../../audio/sfx';
import { h } from '../dom';
import { CREW, STORY, className } from '../names';
import { vendorOfStory } from '../vendors';
import { type Loadout, type CampHost, STEP_NAME, boardRows, cap, btn, ui, contractCaptive } from './shared';
import { ic, type CampIcon } from './icons';
import { coinColumns } from './coinstack';
import { bust } from './bust';
import './job.css';

/** V4.1 (spec 31.6): a villager's "Show me" opens their vendor tab on the Outfit step. */
export function showVendor(id: StoryId): void {
  const v = vendorOfStory(id);
  if (v) ui.outfitTab = v;
}

/** The footer's line on the Job step: the chosen job's brief. */
export function footNote(s: GameState, l: Loadout): string | null {
  const k = s.campaign.board.find((x) => x.id === l.contractId);
  return k ? k.brief : null;
}

function welcomeCard(host: CampHost): HTMLElement {
  return h(
    'div',
    { class: 'job-veil' },
    h(
      'section',
      { class: 'lg-welcome job-pop', 'aria-label': 'Welcome', role: 'dialog' },
      h('span', { class: 'seal', 'aria-hidden': 'true' }, ic('star')),
      h('div', { class: 'kick' }, "The heir's return"),
      h('p', { class: 'job-pop-story' }, "Lord Hobart is dead and Valkenburg has gone dark. His son Keven is back, camped in Lowgate under the walls, and the village's people are still inside."),
      h('p', { class: 'job-pop-how' }, "Every delve takes the four steps along the top: choose a job, pick a party, pack, set out. If Keven falls, it's over."),
      h('div', { class: 'job-pop-b' }, btn({ class: 'btn primary', k: 'welcome-ok', data: { welcome: 'ok' }, onclick: () => host.dismissWelcome() }, 'Got it')),
    ),
  );
}

function wonBackBanner(host: CampHost): HTMLElement {
  const ids = host.wonBack;
  const last = ids[ids.length - 1]!;
  return h(
    'div',
    { class: 'job-veil' },
    h(
      'section',
      { class: 'lg-wonback job-pop', 'aria-label': 'Won back', role: 'dialog' },
      h('span', { class: 'job-pop-house', 'aria-hidden': 'true' }, ic('star')),
      h('div', { class: 'kick' }, 'Won back for Lowgate'),
      h('div', { class: 'job-wb-list' }, ...ids.slice(-3).map((id) => h('div', { class: 'lg-wb-item', 'data-story': id }, ic(WINS[id]?.[0] ?? 'star'), h('span', null, h('b', { class: 'lg-wb-head' }, STORY[id].home), h('span', { class: 'lg-wb-line' }, STORY[id].homeLine))))),
      h(
        'div',
        { class: 'job-pop-b' },
        btn({ class: 'btn ghost', k: 'wb-later', data: { wonback: 'later' }, onclick: () => host.dismissWonBack() }, 'Later'),
        btn({ class: 'btn primary', k: 'wb-show', data: { wonback: 'show' }, tip: `Show me · ${STEP_NAME[STORY[last].step]}`, onclick: () => (showVendor(last), host.dismissWonBack(STORY[last].step)) }, 'Show me', ic('push')),
      ),
    ),
  );
}

function renown(rep: number): HTMLElement {
  const n = Math.min(rep, 3);
  const line = rep >= 3 ? 'Word has reached the deepest halls.' : 'Deeper jobs go up as word spreads.';
  return h(
    'div',
    { class: 'renown lg-renown', tabindex: 0, 'data-tip': `Renown · ${n} of 3\nFinished jobs spread your name. ${line} At full renown, someone pays for the Dragon.`, 'aria-label': `Renown ${n} of 3` },
    h('span', { class: 'lg-pips', 'aria-hidden': 'true' }, ...[0, 1, 2].map((i) => ic('crown', { class: i < rep ? 'on' : '' }))),
  );
}

export function jobStep(main: HTMLElement, s: GameState, l: Loadout, host: CampHost): void {
  const c = s.campaign;
  const wrap = h('div', { class: 'jobs' });
  main.append(wrap);
  wrap.append(h('div', { class: 'jobs-title' }, h('h2', null, 'Choose a job'), renown(c.reputation)));
  if (!c.board.length) {
    wrap.append(h('div', { class: 'jobs-empty' }, ic('scroll'), h('p', { class: 'lg-empty' }, 'Nothing on the notice post. Come back after the next delve.')));
  } else {
    // V4.1 (spec 31.11, owner): two labelled rows, at most 3 cards each: what the village pinned, then work for hire.
    const { pins, hire, more } = boardRows(c, l.contractId);
    const row = (id: string, label: string, tip: string, ks: Contract[], extra?: HTMLElement) => {
      const grid = h('div', { class: 'cards', role: 'group', 'aria-label': label });
      for (const k of ks) grid.append(contractCard(k, l, host, s, k.story ? undefined : contractCaptive(c, k)));
      wrap.append(h('section', { class: `lg-board-row lg-board-${id}`, 'data-row': id }, h('div', { class: 'rowh' }, h('h3', { class: 'kick lg-board-h', tabindex: 0, 'data-tip': tip }, label), extra ?? ''), grid));
    };
    if (pins.length) {
      const hasCaptive = pins.some((k) => !k.story);
      row(
        'village',
        'Pinned by the village',
        `Pinned by the village · Pleas from Lowgate's people${hasCaptive ? ', and your own heroes a crew carried off' : ''}. They pay in gifts, not gold, and win people back: a house lit again, a hero home.`,
        pins,
        more > 0 ? h('span', { class: 'lg-board-more', tabindex: 0, 'data-tip': `${more} more · More pleas wait behind these. They go up once you've seen to these.` }, `+${more} more once you've seen to these`) : undefined,
      );
    }
    if (hire.length) row('hire', 'Work for hire', 'Work for hire · Bounties from whoever is paying. They pay gold, if the prize comes out with you.', hire);
  }
  if (host.wonBack.length) main.append(wonBackBanner(host));
  else if (host.welcome) main.append(welcomeCard(host));
}

const KIND_WORD: Record<Contract['kind'], string> = { rescue: 'Rescue', recover: 'Recover', slay: 'Slay' };
const KIND_ICON: Record<Contract['kind'], CampIcon> = { rescue: 'chain', recover: 'chest', slay: 'flame' };

/** What a plea wins back, as an icon and a few words (the full line is on hover). */
const WINS: Record<StoryId, [CampIcon, string]> = {
  surgeon: ['heart', 'The infirmary'],
  innkeeper: ['mug', 'The Flagon'],
  smith: ['anvil', 'The forge'],
  copper: ['mug', 'Ales at the Flagon'],
  caskbook: ['scroll', 'All the ales'],
  alchemist: ['leaf', "Ilse's bench"],
  muster: ['banner', 'A fourth hero'],
};
/** The big faint glyph on a plea's art (a thing to recover; a rescue shows the chain). */
const STORY_ART: Record<StoryId, CampIcon> = { surgeon: 'heart', innkeeper: 'mug', smith: 'anvil', copper: 'mug', caskbook: 'scroll', alchemist: 'leaf', muster: 'banner' };

interface Risk {
  icon: CampIcon;
  dark?: boolean;
  tip: string;
  label: string;
  chip?: string;
}

/** A contract's warnings as risk marks (without the ones the card already shows: level, the crew, story lines). */
function risks(k: Contract, engine: Engine, captive?: Captive, s?: GameState): Risk[] {
  const crewNames = new Set(Object.values(CREW).map((x) => x.name));
  const storyUnlocks = k.story ? STORIES.find((x) => x.id === k.story)?.unlocks : undefined;
  const site = engine.castle().contractSites.find((x) => x.id === k.siteId);
  const out: Risk[] = [];
  for (const w of k.warnings) {
    if (w === 'Story' || /^Unlocks/.test(w) || w === storyUnlocks) continue;
    if (/^Level \d+$/.test(w)) continue; // the level shield
    if (crewNames.has(w) || (captive && /HP 1/.test(w))) continue; // the card's prisoner line
    const near = /^Nearby: (.+)$/.exec(w);
    if (near) {
      for (const m of near[1]!.split(/,\s*/)) {
        const plural = /s$/.test(m) && !/^the /.test(m);
        const a = /^the /.test(m) || plural ? '' : /^[aeiou]/.test(m) ? 'An ' : 'A ';
        const label = a ? `${a}${m} nearby` : `${cap(m)} nearby`;
        out.push({ icon: /spider/i.test(m) ? 'spider' : 'skull', label, tip: `${label} · Scouts saw ${a ? a.toLowerCase() : ''}${m} near ${site?.where ?? 'the job'}.` });
      }
      continue;
    }
    if (/^Heavy/.test(w)) {
      out.push({ icon: 'sack', dark: true, label: 'Heavy', tip: `Heavy · ${w}. Whoever carries it moves 3 at most.` });
      continue;
    }
    if (/breathes fire/i.test(w)) {
      out.push({ icon: 'flame', label: w, tip: `The Dragon · ${w}.` });
      continue;
    }
    if (/long way/i.test(w)) {
      out.push({ icon: 'stairs', dark: true, label: w, tip: `Deep · ${w}.` });
      continue;
    }
    out.push({ icon: 'warn', label: w, tip: w });
  }
  // V4.1 (WS2, C3): the site is in castle memory and no fixed light reaches it.
  let unlit = false;
  try {
    unlit = !!s && !!engine.siteUnlit?.(s, k.siteId);
  } catch {
    unlit = false;
  }
  if (unlit) out.push({ icon: 'torch', dark: true, label: 'Unlit', chip: 'unlit', tip: "Unlit · You'll want light." });
  return out;
}

/** The pay on the art: gold as a small coin stack and the number; a plea's gift as its icons; nothing for no pay. */
function payTag(k: Contract): { el: HTMLElement | null; line: string } {
  if (k.bounty > 0) {
    const cols = coinColumns(k.bounty).map((hh) => Math.max(8, Math.round(hh * 0.75)));
    return {
      el: h('span', { class: 'pay lg-bounty', 'aria-label': `${k.bounty} gold` }, h('span', { class: 'coinstack', 'aria-hidden': 'true' }, ...cols.map((hh) => h('i', { style: `--h:${hh}px` }))), h('span', { class: 'n num' }, `${k.bounty}`)),
      line: `Pays ${k.bounty} gold, if the prize comes out with you.`,
    };
  }
  const gift = k.story ? GIFTS[k.story] : undefined;
  if (!gift) return { el: null, line: 'No pay. Jobs that win something back pay no bounty.' };
  const parts: HTMLElement[] = [];
  for (const [kind, n] of gift.items ?? []) {
    const icon: CampIcon = /arrow/.test(kind) ? 'arrow' : 'potion';
    parts.push(h('span', { class: 'gp' }, ic(icon), n > 1 ? h('span', null, `×${n}`) : ''));
  }
  if (gift.ale) parts.push(h('span', { class: 'gp' }, ic('mug')));
  if (gift.shields) parts.push(h('span', { class: 'gp' }, ic('shield'), gift.shields > 1 ? h('span', null, `×${gift.shields}`) : ''));
  return { el: h('span', { class: 'pay gift lg-gift', 'aria-label': `Gift: ${gift.short}` }, ...parts.slice(0, 2)), line: `A gift, not gold: ${gift.short.charAt(0).toLowerCase()}${gift.short.slice(1)}, the first time they come home.` };
}

function contractCard(k: Contract, l: Loadout, host: CampHost, s: GameState, captive?: Captive): HTMLElement {
  const st = k.story ? STORY[k.story] : null;
  const crew = captive ? CREW[captive.crew] : null;
  const chosen = l.contractId === k.id;
  const rs = risks(k, host.engine, captive, host.state() ?? s);
  const site = host.engine.castle().contractSites.find((x) => x.id === k.siteId);
  const pay = payTag(k);
  const kindWord = captive ? 'Bring back' : KIND_WORD[k.kind];
  const where = captive ? `Held by ${crew?.name ?? 'a crew'}` : cap(site?.where ?? st?.where.replace(/^Level \d+, /, '') ?? `Level ${k.level}`);
  const wins: [CampIcon, string] | null = k.story ? (WINS[k.story] ?? ['star', st!.unlocks]) : captive ? ['banner', `Your ${className(captive.hero.cls)}, 1 HP`] : null;
  const winsTip = st
    ? `Wins back · ${st.unlocks}.\n${cap(st.who)} goes home to Lowgate, not ${k.kind === 'rescue' ? 'into your roster' : "to the cart. It can't be sold"}.`
    : captive
      ? `${captive.hero.name} · L${captive.hero.level} ${className(captive.hero.cls)}, taken on delve ${captive.delve}.\nHeld at ${crew?.name ?? 'the crew'}'s hideout${crew ? ` (${crew.where})` : ''} at 1 HP, with level and gear; gold and gems are gone. Freed and brought out, they rejoin the roster.`
      : '';
  const tip = [`${k.title} · ${kindWord} · Level ${k.level}`, k.brief, pay.line, st ? `Wins back: ${st.unlocks}.` : '', captive ? `${captive.hero.name} rejoins the roster if brought out.` : '', ...rs.map((r) => r.label)].filter(Boolean).join('\n');
  const art = h(
    'span',
    { class: `art ${k.kind}` },
    h('span', { class: 'lvl', 'aria-label': `Level ${k.level}` }, h('small', null, 'LVL'), `${k.level}`),
    ic(k.story && k.kind !== 'rescue' ? STORY_ART[k.story] : KIND_ICON[k.kind], { class: 'big' }),
    captive ? h('span', { class: 'cap' }, bust(captive.hero.cls, { size: 112 })) : '',
    h('span', { class: 'typ' }, ic(captive ? 'chain' : KIND_ICON[k.kind]), kindWord),
    pay.el ?? '',
  );
  const meta = h(
    'span',
    { class: 'meta' },
    wins ? h('span', { class: `wins lg-winsback ${captive ? 'lg-prisoner' : ''}`, 'data-tip': winsTip }, h('span', { class: 'sr-only' }, captive ? 'The prisoner is yours: ' : 'Wins back: '), ic(wins[0]), h('span', { class: 'wl' }, wins[1])) : '',
    h('span', { class: 'lg-risks' }, ...rs.slice(0, 4).map((r) => h('span', { class: `risk lg-risk ${r.dark ? 'dark' : ''}`, 'data-tip': r.tip, 'data-chip': r.chip, role: 'img', 'aria-label': r.label }, ic(r.icon)))),
    h('span', { class: `pick lg-card-foot ${chosen ? 'on' : ''}` }, chosen ? h('span', { class: 'tk' }, ic('check')) : '', chosen ? 'Chosen' : 'Choose'),
  );
  return h(
    'button',
    {
      type: 'button',
      class: `job lg-card kind-${k.kind} ${st ? 'story village' : ''} ${captive ? 'captive village' : ''} ${chosen ? 'chosen' : ''}`,
      'aria-pressed': chosen ? 'true' : 'false',
      'data-contract': k.id,
      'data-story': k.story ?? '',
      'data-captive': captive?.hero.id ?? '',
      'data-k': `job-${k.id}`,
      'data-tip': tip,
      onclick: () => {
        sfx.play('flip');
        host.setDraft({ ...l, contractId: k.id }, 'job');
      },
    },
    st ? h('span', { class: 'seal lg-card-seal', 'aria-hidden': 'true' }, ic('star')) : '',
    captive ? h('span', { class: 'seal cap-seal lg-card-seal', 'aria-hidden': 'true' }, ic('chain')) : '',
    art,
    h('span', { class: 'body' }, h('span', { class: 'h3 lg-card-title' }, k.title), h('span', { class: 'site' }, ic('gate'), where), meta),
  );
}
