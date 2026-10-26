// V4.0 (spec 25): the shut ways in. A new campaign enters by the main gate only; the sally port
// (a barred gate, opened by its key or a blast) and the east breach (rubble, cleared by a blast or a
// Dig) are found and opened through play, and stay open for the rest of the campaign. Exploration is
// remembered per campaign too, for the Set out screen's map.
//
// Campaign.opened: shut ways opened for good (absent on saves from before V4.0: every way open).
// Delve.ways: the ways open in this delve (from the campaign at the start, plus any opened inside);
// merged back into the campaign at backToCamp.

import { hexKey, parsePosKey, posKey, samePos, type Pos } from './hex';
import type { CastleDef, GameState, Item, ShutWayDef, WayId } from './types';
import { say, type Ctx, type DelveX } from './state';
import { distField, doorAt, type World } from './world';
import { occupant } from './common';

/** The castle's shut ways (none on a castle that lists none). */
export function shutWays(castle: CastleDef): ShutWayDef[] {
  return castle.shutWays ?? [];
}

/** Is this way open for the campaign (before any delve)? Saves without `opened` had every way open. */
export function campaignOpen(s: GameState, id: WayId): boolean {
  const o = s.campaign.opened;
  return !o || !!o[id];
}

/** Is this way open now: in the delve if one is running (opened before it or during it), else for the campaign. */
export function wayOpen(s: GameState, id: WayId): boolean {
  if (campaignOpen(s, id)) return true;
  return !!(s.delve as DelveX | null)?.ways?.[id];
}

/** The ways open at the start of a delve. */
export function startWays(w: World, s: GameState): Partial<Record<WayId, boolean>> {
  const out: Partial<Record<WayId, boolean>> = {};
  for (const way of shutWays(w.castle)) if (campaignOpen(s, way.id)) out[way.id] = true;
  return out;
}

/** Make the delve's map match the open ways: the gate stands open and unlocked, the rubble is gone. */
export function applyOpenWays(w: World, d: DelveX): void {
  for (const way of shutWays(w.castle)) {
    if (!d.ways?.[way.id]) continue;
    for (const p of way.at) {
      const k = posKey(p);
      if (way.kind === 'gate') d.doors[k] = { open: true, locked: false, jammed: false };
      else if (!d.blown.includes(k)) d.blown.push(k);
    }
  }
}

/** The shut way whose exit is `at`, if any. */
export function wayAtEntrance(castle: CastleDef, at: Pos): ShutWayDef | undefined {
  return shutWays(castle).find((x) => castle.entrances[x.entrance] && samePos(castle.entrances[x.entrance]!, at));
}

/** The shut way that hex `at` belongs to (its gate or one of its rubble heaps). */
export function wayAtHex(castle: CastleDef, at: Pos): ShutWayDef | undefined {
  return shutWays(castle).find((x) => x.at.some((p) => samePos(p, at)));
}

/** Is a shut way's own obstacle cleared on the map right now? */
function clearedNow(c: Ctx, way: ShutWayDef): boolean {
  const exit = c.w.castle.entrances[way.entrance];
  if (!exit) return false;
  // A crew holding the gate open on its way through (spec 25.4) has not opened it for anyone else.
  if (way.kind === 'gate') return !c.d.gateHeld && way.at.every((p) => !doorAt(c.d, p)?.locked);
  // Rubble: a walkable path (locked doors aside) joins the exit to the rest of the level (the main gate).
  const main = c.w.castle.entrances[0];
  if (!main || main.level !== exit.level) return false;
  return distField(c.w, c.d, [exit], { stairs: false, allowLocked: true }).has(posKey(main));
}

/**
 * After anything that can open a way (a blast, a Dig, the key, a crew coming in): a way whose gate is
 * unbarred or whose rubble no longer cuts it off is open for good, with its line in the log.
 */
export function checkWays(c: Ctx): void {
  for (const way of shutWays(c.w.castle)) {
    if (c.d.ways?.[way.id] || !clearedNow(c, way)) continue;
    (c.d.ways ??= {})[way.id] = true;
    say(c, way.openLine);
  }
}

/** The sally port key (spec 25.2): 1 slot, worth nothing, never sold, handed over or stolen. */
export function isGateKey(i: Item): boolean {
  return i.kind === 'gatekey';
}

/**
 * Merge a finished delve into the campaign: ways opened (and the key carried out), and every hex seen.
 * Returns lines for camp (the key carried out to a gate still shut).
 */
export function mergeDelve(w: World, s: GameState, d: DelveX): string[] {
  const C = s.campaign;
  const lines: string[] = [];
  if (C.opened) {
    for (const way of shutWays(w.castle)) if (d.ways?.[way.id]) C.opened[way.id] = true;
    // Spec 25.2: the key carried out opens its gate for good (it goes to the village, not the stash).
    if (d.heroes.some((h) => h.status === 'out' && h.pack.some(isGateKey))) {
      for (const way of shutWays(w.castle)) {
        if (way.kind !== 'gate' || C.opened[way.id]) continue;
        C.opened[way.id] = true;
        lines.push('With its key in hand, the sally port gate is yours. It stays open.');
      }
    }
  }
  const mem = (C.explored ??= {});
  const sets = new Map<number, Set<string>>();
  for (const k of d.explored) {
    const p = parsePosKey(k);
    let set = sets.get(p.level);
    if (!set) sets.set(p.level, (set = new Set(mem[p.level] ?? [])));
    set.add(hexKey(p));
  }
  for (const [lv, set] of sets) mem[lv] = [...set];
  return lines;
}

export interface EntranceInfo {
  index: number;
  name: string;
  state: 'open' | 'locked' | 'blocked';
  known: boolean;
  hint?: string;
}

/** One entry per castle entrance (index order): open or shut, known to the campaign, with a hint while shut. */
export function entranceList(w: World, s: GameState): EntranceInfo[] {
  const castle = w.castle;
  const mem = s.campaign.explored ?? {};
  const delveSeen = new Set((s.delve?.explored ?? []) as string[]);
  const seen = (p: Pos) => (mem[p.level] ?? []).includes(hexKey(p)) || delveSeen.has(posKey(p));
  return castle.entrances.map((at, index) => {
    const name = castle.entranceNames?.[index] ?? (index === 0 ? 'Main gate' : `Way in ${index + 1}`);
    const way = shutWays(castle).find((x) => x.entrance === index);
    if (!way) return { index, name, state: 'open' as const, known: true };
    const open = wayOpen(s, way.id);
    const known = open || seen(at) || way.at.some(seen);
    if (open) return { index, name, state: 'open' as const, known };
    return { index, name, state: way.kind === 'gate' ? ('locked' as const) : ('blocked' as const), known, hint: way.hint };
  });
}

/** Explored hex keys per level for the campaign (empty arrays on a new campaign). */
export function castleMemory(w: World, s: GameState): { level: number; hexes: string[] }[] {
  const mem = s.campaign.explored ?? {};
  return w.castle.levels.map((l) => ({ level: l.level, hexes: [...(mem[l.level] ?? [])] }));
}

/**
 * V4.0 (spec 25.4): a crew that let itself in by the sally port with its own key bars the gate behind
 * it once nobody stands in the gateway and none of its members is still outside. A hero outside keeps
 * it from closing too (nobody is locked out). Run at the end of every world phase.
 */
export function relockGate(c: Ctx): void {
  if (!c.d.gateHeld) return;
  const way = shutWays(c.w.castle).find((x) => x.kind === 'gate');
  const exit = way && c.w.castle.entrances[way.entrance];
  if (!way || !exit || c.d.ways?.[way.id]) {
    c.d.gateHeld = false;
    return;
  }
  if (way.at.some((p) => occupant(c, p))) return;
  // The gate's outer side: what the exit reaches with the gate barred.
  const doors = way.at.map((p) => doorAt(c.d, p)).filter((x): x is NonNullable<typeof x> => !!x);
  const was = doors.map((x) => ({ ...x }));
  for (const x of doors) (x.open = false), (x.locked = true);
  const outside = distField(c.w, c.d, [exit], { stairs: false });
  const someoneOut = [...outside.keys()].some((k) => occupant(c, parsePosKey(k)));
  if (someoneOut) {
    doors.forEach((x, i) => Object.assign(x, was[i]));
    return;
  }
  for (const x of doors) x.jammed = false;
  for (const p of way.at) c.ev.push({ type: 'doorChanged', at: p, open: false, locked: true });
  c.d.gateHeld = false;
  c.w.fixedCache = null;
  say(c, "The sally port's bar drops back into place.");
}
