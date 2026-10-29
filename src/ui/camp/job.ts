// V5.1 (W0): step 1, Job: the notice post, the welcome card, the won-back banner, renown. Split out of src/ui/lowgate.ts.

import type { Engine } from '../../game/api';
import type { Captive, Contract, GameState, StoryId } from '../../game/types';
import { GIFTS, STORIES } from '../../game/data';
import { sfx } from '../../audio/sfx';
import { h } from '../dom';
import { CREW, STORY, className } from '../names';
import { vendorOfStory } from '../vendors';
import { type Loadout, type CampHost, STEP_NAME, boardRows, cap, hexBadge, svg, tick, warnTri, btn, ui, contractCaptive, stepHead } from './shared';

function welcomeCard(host: CampHost): HTMLElement {
  return h(
    'section',
    { class: 'lg-welcome', 'aria-label': 'Welcome' },
    h('div', { class: 'lg-seal lg-seal-lg', 'aria-hidden': 'true' }, '✦'),
    h(
      'div',
      { class: 'lg-welcome-t' },
      h('div', { class: 'lg-kick' }, "The heir's return"),
      h('p', { class: 'lg-welcome-story' }, "Lord Hobart is dead and Valkenburg has gone dark. His son Keven is back, camped in Lowgate under the walls, and the village's people are still inside."),
      h('p', { class: 'lg-welcome-how' }, "Every delve takes the four steps along the top: choose a job, pick a party, pack, set out. If Keven falls, it's over."),
    ),
    btn({ class: 'btn lg-btn', k: 'welcome-ok', data: { welcome: 'ok' }, onclick: () => host.dismissWelcome() }, 'Got it'),
  );
}

/** V4.1 (spec 31.6): a villager's "Show me" (or their house) opens their vendor tab on the Outfit step. */
export function showVendor(id: StoryId): void {
  const v = vendorOfStory(id);
  if (v) ui.outfitTab = v;
}

function wonBackBanner(host: CampHost): HTMLElement {
  const ids = host.wonBack;
  const last = ids[ids.length - 1]!;
  return h(
    'section',
    { class: 'lg-wonback', 'aria-label': 'Won back' },
    houseBig(),
    h(
      'div',
      { class: 'lg-wonback-t' },
      h('span', { class: 'lg-kick' }, 'Won back for Lowgate'),
      ...ids.map((id) => h('div', { class: 'lg-wb-item', 'data-story': id }, h('span', { class: 'lg-wb-head' }, STORY[id].home), h('span', { class: 'lg-wb-line' }, STORY[id].homeLine))),
    ),
    h(
      'div',
      { class: 'lg-wonback-b' },
      btn({ class: 'btn lg-btn lg-primary', k: 'wb-show', data: { wonback: 'show' }, tip: `Show me · ${STEP_NAME[STORY[last].step]}`, onclick: () => (showVendor(last), host.dismissWonBack(STORY[last].step)) }, 'Show me'),
      btn({ class: 'btn lg-ghost', k: 'wb-later', data: { wonback: 'later' }, onclick: () => host.dismissWonBack() }, 'Later'),
    ),
  );
}

function houseBig(): SVGElement {
  return svg('svg', { width: 64, height: 58, viewBox: '0 0 30 28', 'aria-hidden': 'true', class: 'lg-wb-house' }, svg('path', { d: 'M3 13 L15 3 L27 13 V26 H3 Z', fill: '#2a1f12', stroke: '#e8a33d', 'stroke-width': 1.2 }), svg('rect', { x: 11, y: 15, width: 8, height: 7, fill: '#ffb35c' }));
}

function renown(rep: number): HTMLElement {
  const pips = h('span', { class: 'lg-pips', 'aria-hidden': 'true' }, ...[0, 1, 2].map((i) => h('i', { class: i < rep ? 'on' : '' })));
  const line = rep >= 3 ? 'Word has reached the deepest halls' : 'Deeper jobs go up as word spreads';
  return h('div', { class: 'lg-renown', tabindex: 0, 'data-tip': `Renown · ${Math.min(rep, 3)} of 3\nFinished jobs spread your name. Deeper jobs go up on the post as it grows; at full renown, someone pays for the Dragon.`, 'aria-label': `Renown ${Math.min(rep, 3)} of 3` }, h('span', { class: 'lg-kick lg-kick-dim' }, 'Renown'), pips, h('span', null, line));
}

export function jobStep(main: HTMLElement, s: GameState, l: Loadout, host: CampHost): void {
  const c = s.campaign;
  if (host.wonBack.length) main.append(wonBackBanner(host));
  if (host.welcome) main.append(welcomeCard(host));
  main.append(stepHead('Choose a job', 'Bounties pay only if the prize comes out with you.', renown(c.reputation)));
  if (!c.board.length) {
    main.append(h('p', { class: 'lg-empty' }, 'Nothing on the notice post. Come back after the next delve.'));
    return;
  }
  // V4.1 (spec 31.11, owner): two labelled rows, at most 3 cards each: what the village pinned, then work for hire.
  const { pins, hire, more } = boardRows(c, l.contractId);
  const row = (id: string, label: string, tip: string, ks: Contract[], extra?: HTMLElement) => {
    const grid = h('div', { class: 'lg-cards', role: 'group', 'aria-label': label });
    for (const k of ks) {
      const cp = k.story ? undefined : contractCaptive(c, k);
      grid.append(contractCard(k, l, host, cp));
    }
    main.append(h('section', { class: `lg-board-row lg-board-${id}`, 'data-row': id }, h('h3', { class: 'lg-h3 lg-board-h', tabindex: 0, 'data-tip': tip }, label), grid, extra ?? ''));
  };
  if (pins.length) {
    const hasCaptive = pins.some((k) => !k.story);
    row(
      'village',
      'Pinned by the village',
      `Pinned by the village · Pleas from Lowgate's people${hasCaptive ? ', and your own heroes a crew carried off' : ''}. They pay in gifts, not gold, and win people back: a house lit again, a hero home.`,
      pins,
      more > 0 ? h('p', { class: 'lg-note lg-board-more' }, `+${more} more once you've seen to these`) : undefined,
    );
  }
  if (hire.length) row('hire', 'Work for hire', 'Work for hire · Bounties from whoever is paying. They pay gold, if the prize comes out with you.', hire);
}

const KIND_WORD: Record<Contract['kind'], string> = { rescue: 'Rescue', recover: 'Recover', slay: 'Slay' };

/** A contract's warnings as risk chips (without the ones that repeat the card's own lines). */
function riskChips(k: Contract, engine: Engine, captive?: Captive, s?: GameState): HTMLElement[] {
  const crewNames = new Set(Object.values(CREW).map((x) => x.name));
  const storyUnlocks = k.story ? STORIES.find((x) => x.id === k.story)?.unlocks : undefined;
  const site = engine.castle().contractSites.find((x) => x.id === k.siteId);
  const out: HTMLElement[] = [];
  for (const w of k.warnings) {
    if (w === 'Story' || /^Unlocks/.test(w) || w === storyUnlocks) continue;
    if (/^Level \d+$/.test(w)) continue; // shown as "Rescue · Level 2"
    if (crewNames.has(w) || (captive && /HP 1/.test(w))) continue; // on the card's prisoner box
    const near = /^Nearby: (.+)$/.exec(w);
    if (near) {
      for (const m of near[1]!.split(/,\s*/)) {
        const plural = /s$/.test(m) && !/^the /.test(m);
        const a = /^the /.test(m) || plural ? '' : /^[aeiou]/.test(m) ? 'An ' : 'A ';
        const label = a ? `${a}${m} nearby` : `${cap(m)} nearby`;
        out.push(h('span', { class: 'lg-chip lg-risk', 'data-tip': `${cap(m)} · Scouts saw ${a ? a.toLowerCase() : ''}${m} near ${site?.where ?? 'the job'}.` }, warnTri(), label));
      }
      continue;
    }
    if (/^Heavy/.test(w)) {
      out.push(h('span', { class: 'lg-chip lg-risk', 'data-tip': `Heavy · ${w}. Whoever carries it moves 3 at most.` }, warnTri(), 'Heavy'));
      continue;
    }
    out.push(h('span', { class: 'lg-chip lg-risk', 'data-tip': w }, warnTri(), w));
  }
  // V4.1 (WS2, C3): the site is in castle memory and no fixed light reaches it.
  let unlit = false;
  try {
    unlit = !!s && !!engine.siteUnlit?.(s, k.siteId);
  } catch {
    unlit = false;
  }
  if (unlit) out.push(h('span', { class: 'lg-chip lg-risk lg-unlit', 'data-chip': 'unlit', 'data-tip': "Unlit · You'll want light." }, warnTri(), 'Unlit'));
  return out;
}

/**
 * V4.1 (spec 31.2, pillar 18): the card's pay: gold for a regular job; a story job shows the villager's gift instead
 * ("Gift: 2 potions", or "No pay" for the copper and the cask book); a "Bring back" job "No pay".
 */
function bountyTag(k: Contract): HTMLElement {
  if (k.bounty > 0) return h('span', { class: 'lg-bounty' }, h('span', { class: 'num' }, `${k.bounty}`), h('span', { class: 'lg-bounty-w' }, ' gold'));
  const gift = k.story ? GIFTS[k.story] : undefined;
  const tip = gift ? `A gift, not gold · ${gift.short}, the first time they come home.
Jobs that win something back for Lowgate pay no bounty.` : 'No pay · Jobs that win something back pay no bounty.';
  return h('span', { class: 'lg-bounty lg-gift', tabindex: 0, 'data-tip': tip }, h('span', { class: 'lg-bounty-w' }, gift ? `Gift: ${gift.short.charAt(0).toLowerCase()}${gift.short.slice(1)}` : 'No pay'));
}

function contractCard(k: Contract, l: Loadout, host: CampHost, captive?: Captive): HTMLElement {
  const st = k.story ? STORY[k.story] : null;
  const crew = captive ? CREW[captive.crew] : null;
  const chosen = l.contractId === k.id;
  const risks = riskChips(k, host.engine, captive, host.state() ?? undefined);
  const card = h(
    'button',
    {
      type: 'button',
      class: `lg-card kind-${k.kind} ${st ? 'story' : ''} ${captive ? 'captive' : ''} ${chosen ? 'chosen' : ''}`,
      'aria-pressed': chosen ? 'true' : 'false',
      'data-contract': k.id,
      'data-story': k.story ?? '',
      'data-captive': captive?.hero.id ?? '',
      'data-k': `job-${k.id}`,
      onclick: () => {
        sfx.play('flip');
        host.setDraft({ ...l, contractId: k.id }, 'job');
      },
    },
    st ? h('span', { class: 'lg-seal lg-card-seal', 'aria-hidden': 'true' }, '✦') : '',
    captive ? h('span', { class: 'lg-seal lg-seal-cap lg-card-seal', 'aria-hidden': 'true' }, '⛓') : '',
    h('span', { class: `lg-kick ${st || captive ? '' : 'lg-kick-dim'}` }, st ? 'Pinned by the village' : captive ? `Taken by ${crew?.name ?? 'a crew'}` : 'Bounty'),
    h('span', { class: 'lg-card-row' }, h('span', { class: 'lg-card-kind' }, `${KIND_WORD[k.kind]} · Level ${k.level}`), bountyTag(k)),
    h('span', { class: 'lg-card-title' }, k.title),
    h('span', { class: 'lg-card-brief' }, k.brief),
    st ? h('span', { class: 'lg-winsback', 'data-tip': `Wins back · ${st.unlocks}.\n${cap(st.who)} goes home to Lowgate, not ${k.kind === 'rescue' ? 'into your roster' : 'to the cart. It can\'t be sold'}.` }, h('span', { class: 'lg-kick' }, 'Wins back'), h('span', null, st.unlocks)) : '',
    captive
      ? h('span', { class: 'lg-winsback lg-prisoner', 'data-tip': `${captive.hero.name} · L${captive.hero.level} ${className(captive.hero.cls)}, taken on delve ${captive.delve}.\nHeld at ${crew?.name ?? 'the crew'}'s hideout${crew ? ` (${crew.where})` : ''} at 1 HP, with level and gear; gold and gems are gone. Freed and brought out, they rejoin the roster.` }, hexBadge(captive.hero.cls, 'sm'), h('span', null, h('span', { class: 'lg-kick' }, 'The prisoner is yours'), h('span', { class: 'lg-prisoner-n' }, `${captive.hero.name}, ${className(captive.hero.cls)} · 1 HP`)))
      : '',
    risks.length ? h('span', { class: 'lg-risks' }, ...risks) : '',
    h('span', { class: `lg-card-foot ${chosen ? 'on' : ''}` }, chosen ? tick('#ffcf86', 16) : '', chosen ? 'Chosen' : 'Choose'),
  );
  return card;
}
