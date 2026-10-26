// Stairs, the lift and (V3.6) the exits, as the UI sees them (spec 15.7, 19.5). Pure: no DOM, no three.js,
// so the headless stairs walk (scripts/v32-stairs-walk.ts) can test the same logic
// the action bar uses.

import type { Reach } from '../game/api';
import { distance, hexKey, samePos, type Pos } from '../game/hex';
import type { CastleDef, CastleLink, Delve, GameState } from '../game/types';

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

// ------------------------------------------------------------ V3.6 (spec 19.5): exits as the way out


export interface ExitInfo {
  at: Pos;
  /** "the main gate", "the sally port", "the east breach", "the cave mouth". */
  name: string;
  /** The party came in by this one. */
  entrance: boolean;
}

/** Exit names from the castle data: by room id where the castle names them, else the room, else the level. */
export function exitName(castle: CastleDef, at: Pos): string {
  const lv = castle.levels.find((l) => l.level === at.level);
  const t = lv?.tiles[hexKey(at)];
  const room = lv?.rooms.find((r) => r.id === t?.room);
  const id = t?.room ?? '';
  if (id === 'gate' || id === 'gate-pass') return 'the main gate';
  if (id === 'sally') return 'the sally port';
  if (id === 'breach') return 'the east breach';
  if (at.level === 3) return 'the cave mouth';
  if (room) return /^the /i.test(room.name) ? room.name.replace(/^The /, 'the ') : `the ${room.name.charAt(0).toLowerCase()}${room.name.slice(1)}`;
  return 'a way out';
}

/** Every exit hex (on one level, or all), with the entrance marked. */
export function exitList(castle: CastleDef, entrance: Pos | null, level?: number): ExitInfo[] {
  const out: ExitInfo[] = [];
  for (const lv of castle.levels) {
    if (level !== undefined && lv.level !== level) continue;
    for (const [k, t] of Object.entries(lv.tiles)) {
      if (t.kind !== 'exit') continue;
      const [q, r] = k.split(',').map(Number);
      const at: Pos = { level: lv.level, q: q!, r: r! };
      out.push({ at, name: exitName(castle, at), entrance: !!entrance && samePos(entrance, at) });
    }
  }
  return out;
}

/** The exit on `at`, if any. */
export function exitAt(castle: CastleDef, at: Pos, entrance: Pos | null): ExitInfo | null {
  const lv = castle.levels.find((l) => l.level === at.level);
  if (lv?.tiles[hexKey(at)]?.kind !== 'exit') return null;
  return { at, name: exitName(castle, at), entrance: !!entrance && samePos(entrance, at) };
}

/**
 * V4.0 (spec 25): is this exit behind a way that's still shut (the sally port's barred gate, the east
 * breach's rubble)? Read from the state as the engine keeps it: Campaign.opened (absent: all open) and
 * Delve.ways. The engine's `entrances()` says the same for the Set out screen.
 */
export function exitShut(castle: CastleDef, s: GameState | null | undefined, at: Pos): boolean {
  const way = castle.shutWays?.find((x) => { const e = castle.entrances[x.entrance]; return !!e && samePos(e, at); });
  if (!way || !s?.campaign.opened) return false;
  return !s.campaign.opened[way.id] && !s.delve?.ways?.[way.id];
}

/** Floating marker text. */
export function exitMarker(e: ExitInfo): string {
  return e.entrance ? 'Way out · you came in here' : 'Way out';
}

/** Hover tooltip for an exit hex. */
export function exitTooltip(e: ExitInfo): string {
  return `stand here, then Leave the castle${e.entrance ? ' (you came in here)' : ''}`;
}

/** Spec 19.5: the contract's prize is in hand: heirloom in a pack, the prisoner freed and following, or the Dragon dead. */
export function prizeInHand(d: Delve): boolean {
  const k = d.contract;
  if (k.kind === 'recover') return d.heroes.some((h) => h.status === 'active' && h.pack.some((i) => i.contractId === k.id || i.kind === 'heirloom' || (!!k.story && i.story === k.story)));
  if (k.kind === 'rescue') return !!d.prisoner && d.prisoner.freed && !d.prisoner.out && !d.prisoner.dead;
  return !d.monsters.some((m) => m.kind === 'dragon' && m.hp > 0);
}

/**
 * The nearest known exit to `from`: on the same level by hex distance, else the entrance or any
 * known exit on another level (no distance then). `known` says whether a hex has been explored;
 * the entrance always counts as known.
 */
export function nearestExit(castle: CastleDef, from: Pos, known: (p: Pos) => boolean, entrance: Pos | null): { exit: ExitInfo; dist: number | null } | null {
  const all = exitList(castle, entrance).filter((e) => e.entrance || known(e.at));
  if (!all.length) return null;
  const same = all.filter((e) => e.at.level === from.level).map((e) => ({ exit: e, dist: distance(e.at, from) as number | null })).sort((a, b) => a.dist! - b.dist!);
  if (same.length) return same[0]!;
  const other = [...all].sort((a, b) => Math.abs(a.at.level - from.level) - Math.abs(b.at.level - from.level) || (a.entrance ? -1 : 1));
  return { exit: other[0]!, dist: null };
}

/** "the main gate, 14 hexes" / "the main gate, here" / "the main gate (Level 1)". */
export function exitWhere(n: { exit: ExitInfo; dist: number | null }, from: Pos): string {
  if (n.dist === null) return `${n.exit.name} (Level ${n.exit.at.level}${n.exit.at.level < from.level ? ', up' : ', down'})`;
  if (n.dist === 0) return `${n.exit.name}, here`;
  return `${n.exit.name}, ${n.dist} hex${n.dist === 1 ? '' : 'es'}`;
}
