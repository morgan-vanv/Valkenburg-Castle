// Section 14.2 and 14.3: falling down pit columns, shoves and knockback,
// railings, fire vents and the forge.

import { posKey, samePos, type Pos } from './hex';
import type { FallInfo } from './api';
import type { HeroInDelve } from './types';
import { VENT_DMG } from './data';
import { say, type Ctx, type MonsterX } from './state';
import { hd, heroName, hurtAny, hurtHero, hurtPrisoner, killHero, killMonster, nameOf, occupant, rivalsOnMap, wakeAdjacent } from './common';
import { canEnter, doorAt, fallColumn, fallDamage, freeNear, kindAt, pitsNextTo, standable } from './world';

// ---------------------------------------------------------------- figures

type Figure =
  | { kind: 'hero'; id: string; h: HeroInDelve }
  | { kind: 'monster'; id: string; m: MonsterX }
  | { kind: 'rival'; id: string; r: { id: string; at: Pos; name: string } }
  | { kind: 'prisoner'; id: string };

export function figure(c: Ctx, id: string): Figure | null {
  const m = c.d.monsters.find((x) => x.id === id);
  if (m) return { kind: 'monster', id, m };
  const r = rivalsOnMap(c).find((x) => x.id === id);
  if (r) return { kind: 'rival', id, r };
  const pr = c.d.prisoner;
  if (pr && pr.id === id && !pr.dead && !pr.out) return { kind: 'prisoner', id };
  const h = hd(c, id);
  if (h && (h.status === 'active' || h.status === 'downed')) return { kind: 'hero', id, h };
  return null;
}

function posOf(c: Ctx, f: Figure): Pos {
  switch (f.kind) {
    case 'hero': return f.h.at;
    case 'monster': return f.m.at;
    case 'rival': return f.r.at;
    case 'prisoner': return c.d.prisoner!.at;
  }
}

function setPos(c: Ctx, f: Figure, p: Pos): void {
  const at = { ...p };
  if (f.kind === 'hero') f.h.at = at;
  else if (f.kind === 'monster') f.m.at = at;
  else if (f.kind === 'rival') f.r.at = at;
  else c.d.prisoner!.at = at;
}

/** Damage that ignores armor (falls, fire, slams). `by` gets kill credit if it's a hero. */
function hurtRaw(c: Ctx, f: Figure, dmg: number, by: string | null): void {
  if (dmg <= 0) return;
  if (f.kind === 'hero') hurtHero(c, f.h, dmg, by ?? 'fall');
  else if (f.kind === 'prisoner') hurtPrisoner(c, dmg, by ?? 'fall');
  else hurtAny(c, f.id, dmg, by, { noise: true });
}

function alive(c: Ctx, f: Figure): boolean {
  if (f.kind === 'hero') return f.h.status === 'active' || f.h.status === 'downed';
  if (f.kind === 'monster') return c.d.monsters.includes(f.m);
  if (f.kind === 'rival') return rivalsOnMap(c).some((x) => x.id === f.id);
  return !!c.d.prisoner && !c.d.prisoner.dead;
}

// ---------------------------------------------------------------- falls

/** Where something falling into `pit` lands now (a free hex), with damage. Null if not a pit. */
export function fallInfo(c: Ctx, pit: Pos, self?: string): FallInfo | null {
  const col = fallColumn(c.w, c.d, pit);
  if (!col) return null;
  const to = freeNear(c.w, c.d, col.to, (p) => {
    const o = occupant(c, p);
    return !!o && o.id !== self;
  });
  if (!to) return null;
  return { to, levels: col.levels, damage: fallDamage(col.levels), levelName: c.w.levelName(to.level) };
}

/** Is this hex railed against shoves? */
export function railed(c: Ctx, p: Pos): boolean {
  return !!c.w.tile(p)?.railing;
}

/** The worst fall a shove could cause to someone standing at `at` (null if none or railed). */
export function edgeRiskAt(c: Ctx, at: Pos, self?: string): FallInfo | null {
  if (railed(c, at)) return null;
  let worst: FallInfo | null = null;
  for (const p of pitsNextTo(c.w, c.d, at)) {
    const f = fallInfo(c, p, self);
    if (f && (!worst || f.levels > worst.levels)) worst = f;
  }
  return worst;
}

/**
 * Drop figure `id` into the pit at `pit`: it lands per the column, takes 4 or 7
 * (armor doesn't help). `by` gets credit for a kill.
 */
export function fall(c: Ctx, id: string, pit: Pos, by: string | null): void {
  const f = figure(c, id);
  if (!f) return;
  if (f.kind === 'monster' && (f.m.kind === 'dragon' || f.m.kind === 'gloam')) return;
  const info = fallInfo(c, pit, id);
  const name = nameOf(c, id);
  if (!info) {
    // Nowhere to land: the drop is bottomless.
    c.ev.push({ type: 'fell', id, from: pit, to: pit, levels: 9, damage: 99 });
    say(c, `${name} falls into the dark.`);
    if (f.kind === 'hero') killHero(c, f.h);
    else if (f.kind === 'monster') killMonster(c, f.m, by);
    else hurtRaw(c, f, 99, by);
    return;
  }
  const from = posOf(c, f);
  setPos(c, f, info.to);
  c.ev.push({ type: 'fell', id, from: pit, to: info.to, levels: info.levels, damage: info.damage });
  if (from.level !== info.to.level) c.ev.push({ type: 'levelChanged', id, from: from.level, to: info.to.level });
  say(c, `${name} falls ${info.levels === 1 ? 'a level' : `${info.levels} levels`} into ${info.levelName}.`);
  if (f.kind === 'hero') {
    // An escort can't follow a fall.
    const pr = c.d.prisoner;
    if (f.h.escorting && pr) pr.escortedBy = undefined;
    f.h.escorting = undefined;
    f.h.guarding = undefined;
  }
  if (f.kind === 'monster') {
    f.m.intent = undefined;
    f.m.focusAt = undefined;
    if (f.m.awareness === 'asleep') {
      f.m.awareness = 'alert';
      c.ev.push({ type: 'awake', id: f.m.id, awareness: 'alert' });
    }
  }
  if (f.kind === 'prisoner') {
    const pr = c.d.prisoner!;
    const e = pr.escortedBy ? hd(c, pr.escortedBy) : undefined;
    if (e) e.escorting = undefined;
    pr.escortedBy = undefined;
  }
  hurtRaw(c, f, info.damage, by);
  if (f.kind === 'hero' && f.h.status === 'active') wakeAdjacent(c, f.h.at);
  afterLanding?.(c, f.kind === 'hero' ? f.h : null);
}

/** Hook set by delve.ts: lair checks after a hero lands somewhere new. */
export let afterLanding: ((c: Ctx, h: HeroInDelve | null) => void) | undefined;
export function setAfterLanding(fn: (c: Ctx, h: HeroInDelve | null) => void): void {
  afterLanding = fn;
}

// ---------------------------------------------------------------- shoves

export type PushKind = 'fall' | 'railing' | 'fire' | 'move' | 'vent' | 'figure' | 'wall';

export interface PushOutcome {
  kind: PushKind;
  /** The hex straight behind the target. */
  dest: Pos;
  /** Who's in the way (kind 'figure'). */
  other?: string;
  /** Where a fall lands (kind 'fall'). */
  fall?: FallInfo | null;
}

/** The hex straight away from `from` past `at`. */
export function behind(from: Pos, at: Pos): Pos {
  return { level: at.level, q: 2 * at.q - from.q, r: 2 * at.r - from.r };
}

/** What a push of the figure at `at` away from `from` would do. */
export function pushOutcome(c: Ctx, from: Pos, at: Pos, self?: string): PushOutcome {
  const dest = behind(from, at);
  const k = kindAt(c.w, c.d, dest);
  if (k === 'pit') {
    if (railed(c, at)) return { kind: 'railing', dest };
    return { kind: 'fall', dest, fall: fallInfo(c, dest, self) };
  }
  if (c.w.fires.has(posKey(dest))) return { kind: 'fire', dest };
  const o = occupant(c, dest);
  if (o && o.id !== self) return { kind: 'figure', dest, other: o.id };
  const open = k === 'door' ? !!doorAt(c.d, dest)?.open : true;
  if (k && canEnter(c.w, c.d, dest) && open && (standable(c.w, c.d, dest) || k === 'door')) {
    return { kind: c.w.vents.has(posKey(dest)) ? 'vent' : 'move', dest };
  }
  return { kind: 'wall', dest };
}

/** Plain words for a push outcome, for previews and intents. */
export function pushText(o: PushOutcome, extra = 0): string {
  const plus = (n: number) => `${n + extra} dmg`;
  switch (o.kind) {
    case 'fall':
      return o.fall ? `Over the edge: falls ${o.fall.levels === 1 ? '1 level' : `${o.fall.levels} levels`}, ${plus(o.fall.damage)}` : 'Over the edge';
    case 'railing': return `Slams the railing: ${plus(1)}`;
    case 'fire': return `Into the fire: ${plus(3)}`;
    case 'vent': return `Onto the vent: ${plus(VENT_DMG)}`;
    case 'figure': return `Into someone: both take 1${extra ? `, ${plus(1)} total` : ''}`;
    case 'wall': return `Slams the wall: ${plus(1)}`;
    case 'move': return extra ? `Pushed back, ${plus(0)}` : 'Pushed back';
  }
}

/**
 * Push figure `id` one hex straight away from `from`. Resolves pits (falls),
 * railings, fire, vents, other figures and walls. Emits `shoved` when it moves.
 */
export function push(c: Ctx, id: string, from: Pos, by: string | null, evType: 'shoved' | 'dragged' = 'shoved'): PushKind | null {
  const f = figure(c, id);
  if (!f) return null;
  if (f.kind === 'monster' && (f.m.kind === 'dragon' || f.m.kind === 'gloam')) return null;
  const at = posOf(c, f);
  const o = pushOutcome(c, from, at, id);
  switch (o.kind) {
    case 'fall':
      c.ev.push({ type: evType, id, from: at, to: o.dest });
      setPos(c, f, o.dest);
      fall(c, id, o.dest, by);
      break;
    case 'railing':
      say(c, `The railing holds ${nameOf(c, id)}.`);
      hurtRaw(c, f, 1, by);
      break;
    case 'fire':
      say(c, `${nameOf(c, id)} is thrown into the fire.`);
      hurtRaw(c, f, 3, by);
      break;
    case 'figure': {
      const other = figure(c, o.other!);
      hurtRaw(c, f, 1, by);
      if (other && !(other.kind === 'monster' && other.m.kind === 'dragon')) hurtRaw(c, other, 1, by);
      else if (other) hurtRaw(c, other, 1, by);
      break;
    }
    case 'wall':
      hurtRaw(c, f, 1, by);
      break;
    case 'move':
    case 'vent': {
      if (kindAt(c.w, c.d, o.dest) === 'door') {
        // Shoved into an open doorway.
      }
      c.ev.push({ type: evType, id, from: at, to: o.dest });
      setPos(c, f, o.dest);
      if (o.kind === 'vent') {
        say(c, `${nameOf(c, id)} lands on a fire vent.`);
        hurtRaw(c, f, VENT_DMG, by);
      }
      if (f.kind === 'hero' && alive(c, f)) afterLanding?.(c, f.h);
      break;
    }
  }
  return o.kind;
}

/** A hero ending a move on a fire vent burns. */
export function ventCheck(c: Ctx, h: HeroInDelve): void {
  if (h.status !== 'active' || !c.w.vents.has(posKey(h.at))) return;
  say(c, `${heroName(c, h.heroId)} steps on a fire vent.`);
  hurtHero(c, h, VENT_DMG, 'vent');
}

export function samePlace(a: Pos, b: Pos): boolean {
  return samePos(a, b);
}
