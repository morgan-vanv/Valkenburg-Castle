// V5.0 (P, B5, spec 32.5): auto end turn. When no able hero can move, act or use anything, the turn ends on its own
// after a short beat (the "Auto end turn" setting, on by default). This is the rule; hud.ts does the timing.

import type { Engine } from '../game/api';
import type { ActionKind, GameState } from '../game/types';

/**
 * Housekeeping a hero can always do with what they carry: not a reason to keep the turn open. Everything else the
 * engine lists (an attack, a spell, an item, Take beside loot, Open by a door or chest, Leave on an exit, Parley with
 * a crew in reach, Carry, Unshackle) means the player may still want to do something.
 */
export const HOUSEKEEPING: ReadonlySet<ActionKind> = new Set<ActionKind>(['drop', 'give', 'snuff', 'dropTorch', 'shutter', 'setDown']);

/** This hero has nothing left this turn: no move or dash, and no option but housekeeping. */
export function heroDone(engine: Engine, s: GameState, heroId: string): boolean {
  if (engine.reachable(s, heroId, false).length) return false;
  if (engine.reachable(s, heroId, true).length) return false;
  return engine.actions(s, heroId).every((o) => o.blocked || HOUSEKEEPING.has(o.action));
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
