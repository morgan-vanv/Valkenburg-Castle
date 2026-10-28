// V5.0: the content of the figure tags (the strip over each figure): health pips, the mood marks, the bleed count,
// the poison drop. Moved here from src/view/diorama.ts so the play track can build the tag side of
// docs/v5-status-visuals.md without touching the diorama, which keeps the tags' placement and style.

import type { HeroInDelve, Monster } from '../game/types';
import { iconSvg } from '../view/icons';

export function pipsHtml(hp: number, max: number, cls: string): string {
  const n = Math.max(0, Math.min(max, hp));
  if (max > 14) return `<span class="hp-bar ${cls}"><i style="width:${(n / max) * 100}%"></i></span>`;
  let s = `<span class="hp-pips ${cls}">`;
  for (let i = 0; i < max; i++) s += `<i class="${i < n ? 'on' : ''}"></i>`;
  return s + '</span>';
}

/** V4.0 HUD: a hero's tag is their health only (lantern, braced, held and the rest are on the party card). */
export function heroTag(h: HeroInDelve, max: number, carried = false): string {
  // V4.1 (spec 31.4): the downed show their bleed-out count; the poisoned their drop.
  return pipsHtml(h.hp, max, 'hero') + (h.status === 'downed' ? bleedMark(h.bleed, carried) : '') + venomMark(h);
}

export function monsterTag(m: Monster): string {
  // V4.0 (spec 27): the mark is the mood: z asleep, ? searching (alert with a search running), ! hunting; at its post nothing, on patrol 👣.
  const aw = m.awareness === 'asleep' ? '<b class="tag-sleep">z</b>' : m.awareness === 'alert' && m.searchRounds !== undefined ? '<b class="tag-alert" title="Searching: sees its sides as well as ahead">?</b>' : m.awareness === 'hunting' && m.kind !== 'dragon' ? '<b class="tag-hunt" title="Hunting">!</b>' : m.awareness === 'patrol' ? '<b class="tag-patrol" title="On patrol">👣</b>' : '';
  const hold = m.holding ? '<b class="tag-grab">⛓</b>' : '';
  const fear = (m.feared ?? 0) > 0 ? `<b class="tag-fear" title="Feared: flees from the caster for ${m.feared} more turn${m.feared === 1 ? '' : 's'}, attacks nobody">feared</b>` : '';
  const stuck = (m.stuck ?? 0) > 0 ? `<b class="tag-rooted" title="Rooted or glued: can't move for ${m.stuck} more round${m.stuck === 1 ? '' : 's'}; it can still act">rooted · ${m.stuck}</b>` : '';
  return `${aw}${hold}${pipsHtml(m.hp, m.maxHp, 'enemy')}${fear}${stuck}${venomMark(m)}`;
}

/** V4.1 (spec 31.4): a poisoned figure's drop (heroes, monsters and crew members). */
export function venomMark(f: { poisoned?: boolean }): string {
  return f.poisoned ? `<b class="tag-venom" title="Poisoned: −1 a turn, never below 1. Antipoison, Mend, or get out.">${iconSvg('venom', 11)}</b>` : '';
}

/** V4.1 (spec 31.4): a downed hero's or crew member's bleed-out count, on its tag (pillar 15: it decides what you do). */
export function bleedMark(bleed: number | undefined, carried: boolean): string {
  if (carried) return '<b class="tag-carried" title="Carried: not bleeding">carried</b>';
  const n = bleed ?? 0;
  return `<b class="tag-bleed" title="Down: dies in ${n} turn${n === 1 ? '' : 's'}">✚ ${n}</b>`;
}

