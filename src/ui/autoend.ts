// V5.0 (P, spec 32.5 and 32.6): the turn's flow runs on one test. A hero is **done** when there is nothing plausible
// left for them this turn: no move or dash, and nothing the engine lists but housekeeping. The same test decides
// three things (owner, 2026-10-27): when the camera cycles to the next hero (after a tasteful delay), when the
// question before End turn is asked ("someone can still do something"), and when the turn ends on its own.
// This is the rule; hud.ts does the timing.

import type { Engine } from '../game/api';
import type { ActionKind, GameState } from '../game/types';

/**
 * Housekeeping a hero can always do with what they carry: not a reason to keep the turn open. Everything else the
 * engine lists (an attack, a spell, an item, Take beside loot, Open by a door or chest, Leave on an exit, Parley with
 * a crew in reach, Carry, Unshackle) means the player may still want to do something.
 */
export const HOUSEKEEPING: ReadonlySet<ActionKind> = new Set<ActionKind>(['drop', 'give', 'snuff', 'dropTorch', 'shutter', 'setDown']);

/** What a hero could still plausibly do this turn, in words ("move", "dash", "Attack", "Take"); empty when done. */
export function heroLeft(engine: Engine, s: GameState, heroId: string): string[] {
  const out: string[] = [];
  const walk = engine.reachable(s, heroId, false);
  const sneak = walk.length ? [] : engine.reachable(s, heroId, true);
  const reach = walk.length ? walk : sneak;
  if (reach.length) out.push(reach[0]!.dash ? 'dash' : 'move');
  for (const o of engine.actions(s, heroId)) if (!o.blocked && !HOUSEKEEPING.has(o.action)) out.push(o.label);
  return out;
}

/** This hero has nothing left this turn: no move or dash, and no option but housekeeping. */
export function heroDone(engine: Engine, s: GameState, heroId: string): boolean {
  return heroLeft(engine, s, heroId).length === 0;
}

/**
 * The whole party is done: it is the player phase with no reaction waiting, somebody is still up, and every hero who
 * is up (or crawling) has nothing left. The caller checks its own state (panels open, playback, the setting).
 */
export function partyDone(engine: Engine, s: GameState): boolean {
  const d = s.delve;
  if (!d || s.stage !== 'delve' || d.phase !== 'player' || d.pending) return false;
  const up = d.heroes.filter((h) => h.status === 'active' || h.status === 'downed');
  if (!up.some((h) => h.status === 'active')) return false;
  return up.every((h) => heroDone(engine, s, h.heroId));
}

/** The heroes who could still do something, with what, for the question before End turn. */
export function stillCan(engine: Engine, s: GameState): { heroId: string; left: string[] }[] {
  const d = s.delve;
  if (!d || s.stage !== 'delve' || d.phase !== 'player') return [];
  return d.heroes
    .filter((h) => h.status === 'active' || h.status === 'downed')
    .map((h) => ({ heroId: h.heroId, left: heroLeft(engine, s, h.heroId) }))
    .filter((x) => x.left.length > 0);
}
