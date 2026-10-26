// V4.0 HUD: reading a roll preview in words (target card, roll panel) and drawing the roll panel.
// Words before numbers: "Kills it about half the time"; the slots, percentages and the per-hit
// table wait behind Details or Alt. Pure helpers first, then the DOM builders.

import type { RollPreview } from '../game/api';
import { h, icon } from './dom';

/** Probability of exactly k hits for n free slots at chance p (0..100), plus `locked` sure hits. */
export function hitOdds(slots: number, chance: number, locked: number): number[] {
  const n = Math.max(0, slots - locked);
  const p = Math.max(0, Math.min(1, chance / 100));
  const out = new Array<number>(slots + 1).fill(0);
  let c = 1;
  for (let k = 0; k <= n; k++) {
    if (k > 0) c = (c * (n - k + 1)) / k;
    out[k + locked] = c * Math.pow(p, k) * Math.pow(1 - p, n - k);
  }
  return out;
}

/** "about half the time", "almost surely"... for a chance 0..1. */
export function oftenWords(p: number): string {
  if (p >= 0.995) return 'every time';
  if (p >= 0.9) return 'almost surely';
  if (p >= 0.7) return 'most of the time';
  if (p >= 0.58) return 'more often than not';
  if (p >= 0.42) return 'about half the time';
  if (p >= 0.25) return 'about 1 time in 3';
  if (p >= 0.12) return 'now and then';
  if (p >= 0.03) return 'rarely';
  return 'almost never';
}

/** "1 in 2", "1 in 10" for a wake chance 0..100. */
export function oddsWords(pct: number): string {
  if (pct >= 95) return 'sure';
  if (pct > 60) return `${Math.round(pct / 10)} in 10`;
  const n = Math.max(2, Math.round(100 / Math.max(1, pct)));
  return `1 in ${n}`;
}

export function pctText(p: number): string {
  const v = p * 100;
  if (v > 0 && v < 1) return '<1%';
  if (v < 100 && v > 99) return '>99%';
  return `${Math.round(v)}%`;
}

const FAIL = /^(miss|misses|fizzles|nothing|fails|holds|lock jams)/i;

export interface Segment {
  label: string;
  p: number;
  cls: 'miss' | 'hurt' | 'kill' | 'fail' | 'ok' | 'best';
}

export interface RollRead {
  /** Damage rolls read against the target's HP; anything else by its outcome words. */
  kind: 'damage' | 'other';
  segments: Segment[];
  /** Damage: chance it ends up dead (0 when the target has no HP to read). */
  kill: number;
  miss: number;
  /** Damage values that leave it standing (ascending). */
  hurts: number[];
  /** The single most likely damage (0 = a miss). */
  likely: number;
  /** Chance of anything but a failure (other rolls). */
  works: number;
  headline: string;
  sub: string;
}

/** Damage per number of hits, when every outcome is "N dmg ..." (or a miss). */
function damageTable(outcomes: string[]): number[] | null {
  const out: number[] = [];
  for (const [i, t] of outcomes.entries()) {
    const m = /^(\d+) dmg/.exec(t);
    if (m) out.push(Number(m[1]));
    else if (i === 0 && FAIL.test(t)) out.push(0);
    else return null;
  }
  return out.length > 1 ? out : null;
}

/**
 * Read a preview as words and outcome segments. `hp` is the target's HP (null for a hex or no HP to read);
 * `it` names the target in the sentence ("it", or a crew member's name).
 */
export function readRoll(pr: RollPreview, focus: number, hp: number | null, it = 'it'): RollRead {
  const odds = hitOdds(pr.slots, pr.chance, Math.min(focus, pr.slots));
  const dmg = damageTable(pr.outcomes);
  if (dmg) {
    let kill = 0;
    let miss = 0;
    const hurtP = new Map<number, number>();
    const byDmg = new Map<number, number>();
    dmg.forEach((d, k) => {
      const p = odds[k] ?? 0;
      byDmg.set(d, (byDmg.get(d) ?? 0) + p);
      if (d <= 0) miss += p;
      else if (hp !== null && d >= hp) kill += p;
      else hurtP.set(d, (hurtP.get(d) ?? 0) + p);
    });
    const hurt = [...hurtP.values()].reduce((a, b) => a + b, 0);
    const hurts = [...hurtP.entries()].filter(([, p]) => p > 0.0005).map(([d]) => d).sort((a, b) => a - b);
    let likely = 0;
    let best = -1;
    for (const [d, p] of byDmg) if (p > best + 1e-9) [best, likely] = [p, d];
    const segments: Segment[] = [];
    if (miss > 0.0005) segments.push({ label: 'misses', p: miss, cls: 'miss' });
    if (hurt > 0.0005) segments.push({ label: hp === null ? 'hits' : `hurts ${it === 'it' ? 'it' : it}`, p: hurt, cls: 'hurt' });
    if (kill > 0.0005) segments.push({ label: `kills ${it === 'it' ? 'it' : it}`, p: kill, cls: 'kill' });
    const missLine = miss < 0.03 ? 'a clean miss is rare' : `it misses ${oftenWords(miss)}`;
    const hurtLine = hurts.length ? `${listOr(hurts.map(String))} damage${hp !== null ? `, and ${it} stays up` : ''}` : '';
    let headline: string;
    let sub: string;
    if (hp !== null && kill >= 0.995) {
      headline = `Kills ${it}`;
      sub = focus > 0 && focus >= pr.slots ? 'Every try is a sure hit.' : `${cap(it)} can't survive this.`;
    } else if (hp !== null && kill >= 0.03) {
      headline = `Kills ${it} ${oftenWords(kill)}`;
      sub = `${focus > 0 ? 'With a sure hit it can\'t miss. ' : ''}Otherwise ${hurtLine || 'a miss'}${focus > 0 ? '.' : `; ${missLine}.`}`;
    } else {
      headline = likely > 0 ? `Likely ${likely} damage` : 'Likely a miss';
      sub = `${hurts.length > 1 ? `${listOr(hurts.map(String))} damage` : hurtLine || 'No harm done'}${focus > 0 ? '.' : `; ${missLine}.`}`;
      if (hp !== null && hurts.length && hurts[hurts.length - 1]! < hp) sub = `${cap(it)} has ${hp} HP: it stays up${focus > 0 ? '' : `; ${missLine}`}.`;
    }
    return { kind: 'damage', segments, kill: hp === null ? 0 : kill, miss, hurts, likely, works: 1 - miss, headline, sub };
  }
  // Anything else: merge equal outcome words in order.
  const segs: Segment[] = [];
  pr.outcomes.forEach((t, k) => {
    const p = odds[k] ?? 0;
    const last = segs[segs.length - 1];
    if (last && last.label === t) last.p += p;
    else segs.push({ label: t, p, cls: FAIL.test(t) ? 'fail' : 'ok' });
  });
  const shown = segs.filter((x) => x.p > 0.0005);
  const okSegs = shown.filter((x) => x.cls !== 'fail');
  if (okSegs.length) okSegs[okSegs.length - 1]!.cls = 'best';
  const works = okSegs.reduce((a, x) => a + x.p, 0);
  const top = [...shown].sort((a, b) => b.p - a.p);
  const headline = works >= 0.995 ? 'Works every time' : works < 0.005 ? "Can't work" : `Works ${oftenWords(works)}`;
  const sub = top
    .slice(0, 2)
    .map((x) => `${cap(x.label)}: ${oftenWords(x.p)}`)
    .join(' · ');
  return { kind: 'other', segments: shown, kill: 0, miss: 1 - works, hurts: [], likely: 0, works, headline, sub: sub ? `${sub}.` : '' };
}

function listOr(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? '';
  return `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`;
}

export function cap(t: string): string {
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

/** A modifier ("Sneak attack +1 slot") as a short chip: words, sign, and the full text for the hover. */
export function modifierChip(m: string, hero: string): { text: string; good: boolean; tip: string } | null {
  if (/^\d+ mana$/.test(m)) return null;
  const good = !/[−-]\d|−\d| −/.test(m) && !/^(Dim|Dark|Pitch) /.test(m) && !/Adjacent/.test(m);
  let text = m;
  if (/^Sneak attack/.test(m)) text = `It hasn't noticed ${hero}`;
  else if (/^Backstab/.test(m)) text = 'Backstab: double damage';
  else if (/^Flanked/.test(m)) text = 'Flanked';
  else if (/^Asleep/.test(m)) text = 'Asleep';
  else if (/^Adjacent/.test(m)) text = 'Too close for the bow';
  return { text, good, tip: m };
}

/** Bonus tries the modifiers add ("+1 slot"), with a short label each, for the dice. */
export function bonusSlots(mods: string[]): string[] {
  const out: string[] = [];
  for (const m of mods) {
    if (!/\+1 slot/.test(m)) continue;
    out.push(/^Sneak attack/.test(m) ? 'sneak' : /^Backstab/.test(m) ? 'backstab' : /^Flanked/.test(m) ? 'flanked' : 'bonus');
  }
  return out;
}

/** "bright light, no penalty" / "dim light, −10%" from the modifiers. */
export function lightWords(mods: string[]): string {
  const l = mods.find((m) => /^(Dim|Dark|Pitch) /.test(m));
  if (l) {
    const [stage, pen] = l.split(' ');
    return `${stage!.toLowerCase()} light, ${pen}`;
  }
  if (mods.some((m) => /Night-eye/.test(m))) return 'night-eye: no dark penalty';
  return 'good light, no penalty';
}

export function noiseWords(n: number): string {
  if (n <= 0) return 'Silent';
  if (n <= 2) return 'A little noise';
  if (n <= 4) return 'Noisy';
  return 'Loud';
}

const STAT: Record<string, string> = { might: 'Might', finesse: 'Finesse', wits: 'Wits', nerve: 'Nerve' };
export function statName(s?: string): string {
  return STAT[s ?? 'might'] ?? 'Might';
}

// ------------------------------------------------------------ DOM

/** The outcome bar: segments by outcome, the kill chance on the kill segment. */
export function outcomeBar(read: RollRead): HTMLElement {
  const bar = h('div', { class: 'dl-ocbar', role: 'img', 'aria-label': read.segments.map((s) => `${s.label} ${pctText(s.p)}`).join(', ') });
  for (const s of read.segments) {
    const label = s.cls === 'kill' ? `${s.label} · ${pctText(s.p)}` : s.p >= 0.12 ? s.label : '';
    bar.append(h('span', { class: `dl-oc dl-oc-${s.cls}`, style: `flex:${Math.max(0.02, s.p)} 1 0`, 'data-tip': `${cap(s.label)} · ${pctText(s.p)}` }, label));
  }
  return bar;
}

/** The per-hit table (Details / Alt). */
export function hitTable(pr: RollPreview, focus: number): HTMLElement {
  const odds = hitOdds(pr.slots, pr.chance, Math.min(focus, pr.slots));
  return h(
    'div',
    { class: 'dl-hits' },
    h('span', { class: 'dim' }, 'hits'),
    h('span', { class: 'dim' }, 'outcome'),
    h('span', { class: 'dim' }, 'chance'),
    ...pr.outcomes.flatMap((t, k) => [h('span', null, `${k}`), h('span', null, t), h('span', null, pctText(odds[k] ?? 0))]),
  );
}

/** One die as a hex: its chance, "sure" when Focus locks it, tinted when a bonus adds it. */
export function dieHex(state: 'sure' | 'plain' | 'bonus', chance: number, label = '', size: 'lg' | 'sm' = 'lg'): HTMLElement {
  if (state === 'sure') return h('span', { class: `dl-die dl-die-${size} sure`, 'data-tip': 'Sure hit · Focus makes this try a hit.' }, icon('check', size === 'lg' ? 14 : 10), size === 'lg' ? h('span', { class: 'dl-die-l' }, 'sure') : '');
  return h('span', { class: `dl-die dl-die-${size} ${state}`, 'data-tip': state === 'bonus' ? `${cap(label)} · an extra try at ${chance}%` : `One try · hits ${chance}% of the time` }, h('span', { class: 'dl-die-p num' }, `${chance}%`), state === 'bonus' && size === 'lg' ? h('span', { class: 'dl-die-l' }, label) : '');
}
