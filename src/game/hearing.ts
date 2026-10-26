// V3.9.3 (spec 24.8): the heroes hear what they can't see. Footsteps and loud sounds of unseen
// monsters and crew members during the world phase become `Heard` entries (`Delve.heard`) and
// `heard` events: where, not who. For the heroes only: nothing here touches monsters or crews.

import { distance, posKey, type Pos } from './hex';
import type { Heard, MonsterKind } from './types';
import type { Ctx } from './state';
import { HEARING } from './data';
import { noiseField, visibleSet } from './world';

/** Footstep hearing range by kind (path distance, closed doors count 2). The Gloam makes no sound. */
export const STEP_RANGE: Record<MonsterKind, number> = {
  rats: 2, spider: 2, ghoul: 3, cutpurse: 3, orc: 4, archer: 4, captain: 4, berserker: 5, dragon: 8,
};
/** Crew members' footsteps. */
export const CREW_STEP_RANGE = 4;
/** Feared, fleeing figures run loud. */
export const FLEE_STEP_BONUS = 1;
/** Hearing-only radii for enemy sounds that make no monster-facing noise (spec 24.8). */
export const CLASH_HEAR = 2;
export const DOWNED_HEAR = 3;
export const FORCED_DOOR_HEAR = 4;

export type LoudWhat = 'clash' | 'shout' | 'crash' | 'blast' | 'roar' | 'scream' | 'lock' | 'dig';

/** Does the party see hex `at` right now (hearing's own copy of the visible set)? */
export function partySees(c: Ctx, at: Pos): boolean {
  return vis(c).has(posKey(at));
}

/** The world phase begins: last phase's sounds are forgotten. */
export function clearHeard(c: Ctx): void {
  c.d.heard = [];
}

/** What the party's sight depends on, cheaply: heroes, doors, light, smoke, fire, revealed figures. */
function sightSig(c: Ctx): string {
  const d = c.d;
  const heroes = d.heroes.map((h) => `${h.heroId}${h.status}${posKey(h.at)}/${h.facing ?? ''}/${h.torch}`).join(';');
  const doors = Object.entries(d.doors).filter(([, x]) => x.open).map(([k]) => k).join(',');
  const smoke = Object.keys(d.smoke ?? {}).join(',');
  const fire = Object.keys(d.burning ?? {}).join(',');
  return `${heroes}|${doors}|${d.light}${d.lanternOpen}${d.lanternBearer}|${smoke}|${fire}|${Object.keys(d.revealed ?? {}).join(',')}`;
}

/**
 * The party's visible set for hearing, kept apart from the engine's visCache (never read or written
 * here) so hearing can't change what monsters see; recomputed only when sight's inputs change.
 */
function vis(c: Ctx): Set<string> {
  const sig = sightSig(c);
  if (c.hearVis?.sig === sig) return c.hearVis.set;
  const set = visibleSet(c.w, c.d);
  c.hearVis = { sig, set };
  return set;
}

/** Is `id` an enemy figure (monster or crew member, not the Gloam)? Its step range, or 0. */
export function stepRangeOf(c: Ctx, id: string): number {
  const m = c.d.monsters.find((x) => x.id === id);
  if (m) {
    if (m.kind === 'gloam' as string || m.buried) return 0;
    const base = STEP_RANGE[m.kind as MonsterKind] ?? 0;
    return base && (m.feared ?? 0) > 0 ? base + FLEE_STEP_BONUS : base;
  }
  const r = c.d.rivals?.members.find((x) => x.id === id);
  // V4.0 (spec 28.1): a sneaking crew member is as silent as a sneaking hero.
  if (r) return r.sneaked ? 0 : (r.feared ?? 0) > 0 ? CREW_STEP_RANGE + FLEE_STEP_BONUS : CREW_STEP_RANGE;
  return 0;
}

export function isEnemy(c: Ctx, id: string | null | undefined): boolean {
  if (!id) return false;
  return c.d.monsters.some((m) => m.id === id && m.kind !== ('gloam' as string)) || !!c.d.rivals?.members.some((r) => r.id === id);
}

/** Does any active hero hear a sound of path radius `radius` at `at`? */
function heardByParty(c: Ctx, at: Pos, radius: number, otherLevels = false): boolean {
  if (radius <= 0) return false;
  const ears = c.d.heroes.filter((h) => h.status === 'active');
  const near = ears.filter((h) => h.at.level === at.level && distance(h.at, at) <= radius);
  if (otherLevels && ears.some((h) => Math.abs(h.at.level - at.level) === 1 && distance(h.at, at) <= radius)) return true;
  if (!near.length) return false;
  const field = noiseField(c.w, c.d, at, radius);
  return near.some((h) => field.has(posKey(h.at)));
}

function record(c: Ctx, sound: Omit<Heard, 'n'>): void {
  const list = (c.d.heard ??= []);
  const k = posKey(sound.at);
  if (list.some((x) => x.kind === sound.kind && x.what === sound.what && posKey(x.at) === k)) return;
  const s: Heard = { ...sound, at: { ...sound.at }, n: list.length };
  list.push(s);
  c.ev.push({ type: 'heard', sound: s });
}

/** An enemy figure `id` steps onto `p` (world phase): unseen and within hearing, the party hears footsteps. */
export function hearStep(c: Ctx, id: string, p: Pos): void {
  if (!HEARING.enabled || c.d.phase !== 'world') return;
  const range = stepRangeOf(c, id);
  if (!range) return;
  if (vis(c).has(posKey(p))) return;
  if (heardByParty(c, p, range)) record(c, { at: p, kind: 'steps' });
}

/**
 * A loud sound at `at` (world phase) made by an enemy: heard by any hero within its path radius,
 * unless the party sees the source (`seen`, or the hex is in the visible set).
 */
export function hearLoud(c: Ctx, at: Pos, radius: number, what: LoudWhat, opts: { otherLevels?: boolean; seen?: boolean } = {}): void {
  if (!HEARING.enabled || c.d.phase !== 'world') return;
  const seen = opts.seen ?? vis(c).has(posKey(at));
  if (seen) return;
  if (heardByParty(c, at, radius, opts.otherLevels)) record(c, { at, kind: 'loud', what });
}
