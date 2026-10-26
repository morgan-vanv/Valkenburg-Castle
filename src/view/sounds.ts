// V3.9.3 (spec 24.8): what the heroes heard of things they can't see: marker glyphs, tooltips and
// the summarised log lines. Pure helpers; the diorama draws the markers, the app logs the lines.

import { hexToWorld, line, posKey, type Pos } from '../game/hex';
import type { Heard } from '../game/types';

export const HEARD_ICON: Record<string, string> = {
  steps: '👣',
  clash: '⚔',
  shout: '‼',
  crash: '✸',
  blast: '✹',
  roar: '♨',
  scream: '!',
  lock: '🔓', dig: '⛏', // V4.0 (spec 28): a lock forced, digging
};

const NOUN: Record<string, string> = {
  clash: 'a clash',
  shout: 'a shout',
  crash: 'a crash',
  blast: 'a blast',
  roar: 'a roar',
  scream: 'a scream',
  lock: 'something forcing a lock', dig: 'something digging', // V4.0 (spec 28)
};

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The glyph for a heard sound. */
export function heardIcon(h: Heard): string {
  return h.kind === 'steps' ? HEARD_ICON.steps! : HEARD_ICON[h.what ?? ''] ?? '!';
}

/** Hover text for a marker: "Heard footsteps here, last turn". */
export function heardTitle(h: Heard): string {
  if (h.kind === 'steps') return 'Heard footsteps here, last turn';
  return `Heard ${NOUN[h.what ?? ''] ?? 'something'} here, last turn`;
}

/**
 * Opacity of each footstep in a trail, by order heard: the newest boldest, the oldest faintest.
 * Loud markers stay full.
 */
export function heardFade(list: Heard[]): Map<Heard, number> {
  const steps = list.filter((x) => x.kind === 'steps').sort((a, b) => a.n - b.n);
  const out = new Map<Heard, number>();
  steps.forEach((x, i) => out.set(x, steps.length <= 1 ? 0.9 : 0.3 + 0.6 * (i / (steps.length - 1))));
  for (const x of list) if (x.kind === 'loud') out.set(x, 1);
  return out;
}

/** Compass word from one hex to another, in world space (north = away from the default camera). */
export function compassWord(from: Pos, to: Pos): string {
  const a = hexToWorld(from, 1);
  const b = hexToWorld(to, 1);
  const ang = Math.atan2(b.x - a.x, -(b.z - a.z));
  const names = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  return names[Math.round(((ang + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8]!;
}

/**
 * The log's summary of a world phase's sounds, by direction from the party: "Footsteps beyond the
 * door to the north-east", "A clash to the west". Loud sounds first; at most `max` lines.
 */
export function heardLines(heard: Heard[], heroes: Pos[], doors: Record<string, { open: boolean }>, max = 2): string[] {
  if (!heard.length || !heroes.length) return [];
  const groups = new Map<string, { what: string; where: string; door: boolean; loud: boolean; n: number }>();
  for (const h of heard) {
    const same = heroes.filter((p) => p.level === h.at.level);
    let where: string;
    let door = false;
    if (!same.length) {
      where = h.at.level > heroes[0]!.level ? 'from below' : 'from above';
    } else {
      const from = same.reduce((a, b) => (dist2(a, h.at) <= dist2(b, h.at) ? a : b));
      const between = line(from, h.at).slice(1, -1);
      door = between.some((x) => doors[posKey({ level: h.at.level, q: x.q, r: x.r })]?.open === false);
      where = `to the ${compassWord(from, h.at)}`;
    }
    const what = h.kind === 'steps' ? 'footsteps' : NOUN[h.what ?? ''] ?? 'something';
    // One line per sound and direction (a trail through a doorway is one set of footsteps).
    const key = `${what}|${where}`;
    const g = groups.get(key);
    if (g) g.door ||= door;
    else groups.set(key, { what, where, door, loud: h.kind === 'loud', n: h.n });
  }
  return [...groups.values()]
    .sort((a, b) => Number(b.loud) - Number(a.loud) || a.n - b.n)
    .slice(0, max)
    .map((g) => `${cap(g.what)} ${g.door && g.where.startsWith('to') ? 'beyond the door ' : ''}${g.where}.`);
}

function dist2(a: Pos, b: Pos): number {
  const x = hexToWorld(a, 1);
  const y = hexToWorld(b, 1);
  return (x.x - y.x) ** 2 + (x.z - y.z) ** 2;
}
