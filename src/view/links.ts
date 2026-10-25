// Stairs and the lift, as the UI sees them (spec 15.7). Pure: no DOM, no three.js,
// so the headless stairs walk (scripts/v32-stairs-walk.ts) can test the same logic
// the action bar uses.

import type { Reach } from '../game/api';
import { samePos, type Pos } from '../game/hex';
import type { CastleDef, CastleLink } from '../game/types';

export interface LinkInfo {
  kind: CastleLink['kind'];
  /** The hex at this end. */
  at: Pos;
  /** The other end. */
  to: Pos;
  /** True when `to` is deeper. */
  down: boolean;
  /** Lift only: the winch hex. */
  winch?: Pos;
}

/** The stairs or lift ending on `at`, if any. */
export function linkAt(castle: CastleDef, at: Pos): LinkInfo | null {
  for (const l of castle.links) {
    const end = samePos(l.a, at) ? l.a : samePos(l.b, at) ? l.b : null;
    if (!end) continue;
    const to = end === l.a ? l.b : l.a;
    return { kind: l.kind, at: end, to, down: to.level > at.level, winch: l.kind === 'lift' ? l.winch : undefined };
  }
  return null;
}

/** Every link end (on one level, or all of them) for markers. */
export function linkEnds(castle: CastleDef, level?: number): LinkInfo[] {
  const out: LinkInfo[] = [];
  for (const l of castle.links)
    for (const end of [l.a, l.b]) {
      if (level !== undefined && end.level !== level) continue;
      const to = end === l.a ? l.b : l.a;
      out.push({ kind: l.kind, at: end, to, down: to.level > end.level, winch: l.kind === 'lift' ? l.winch : undefined });
    }
  return out;
}

/**
 * The reach entry that takes the stairs or lift the hero is standing on: its
 * destination is on another level and the path is one step. Undefined when the
 * hero isn't on a working link or can't move.
 */
export function linkReach(reach: Reach[], at: Pos): Reach | undefined {
  return reach.find((r) => r.to.level !== at.level && r.path.length === 1);
}

/** "the Crossing" from "The Crossing". */
export function levelPhrase(castle: CastleDef, level: number): string {
  const name = castle.levels.find((l) => l.level === level)?.name ?? `Level ${level}`;
  return name.replace(/^The /, 'the ');
}

/** Short marker text: "↓ L2", "↑ L1", "Lift ↓ L3". */
export function linkMarker(l: LinkInfo): string {
  const arrow = l.down ? '↓' : '↑';
  return l.kind === 'lift' ? `Lift ${arrow} L${l.to.level}` : `${arrow} L${l.to.level}`;
}

/** Button label: "Take stairs ↓ Level 2", "Take lift ↑ Level 2". */
export function linkButton(l: LinkInfo): string {
  return `Take ${l.kind === 'lift' ? 'lift' : 'stairs'} ${l.down ? '↓' : '↑'} Level ${l.to.level}`;
}

/** Hover tooltip: "Stairs down to the Crossing. Stand on them, then Take stairs." */
export function linkTooltip(castle: CastleDef, l: LinkInfo, liftWorking: boolean): string {
  const dir = l.down ? 'down' : 'up';
  const where = levelPhrase(castle, l.to.level);
  if (l.kind === 'lift') return liftWorking ? `Lift ${dir} to ${where}. Stand on it, then Take lift.` : `Lift ${dir} to ${where}. Dead until someone works the winch beside it.`;
  return `Stairs ${dir} to ${where}. Stand on them, then Take stairs.`;
}
