// V4.1 (WS2) test support: the old free party lantern as an item. Tests written before WS2 started every delve with a
// full, open lantern carried by Keven (or the first hero); `oldLantern` puts that back as a slotless loaner Lantern
// (exactly what a V4.0 save's lantern becomes on load), and `setLantern` stands in for writes to the retired
// `Delve.light`, `lanternBearer` and `lanternOpen` fields.

import type { GameState, Item } from '../types';
import { LANTERN_MAX } from '../data';

function loaner(s: GameState): Item | undefined {
  for (const h of s.delve!.heroes) for (const i of h.pack) if (i.kind === 'lantern' && i.loaner) return i;
  return undefined;
}

/** Give `heroId` (default: Keven if he went, else the first hero) the old free lantern: full and open. */
export function oldLantern(s: GameState, heroId?: string): GameState {
  const d = s.delve!;
  const id = heroId ?? (d.heroes.some((h) => h.heroId === 'keven') ? 'keven' : d.heroes[0]!.heroId);
  setLantern(s, { bearer: id, rounds: LANTERN_MAX, open: true });
  return s;
}

/** The old lantern's fields, as item edits: rounds (clamped 0..20), who carries it, open or shuttered. */
export function setLantern(s: GameState, o: { rounds?: number; bearer?: string; open?: boolean }): void {
  const d = s.delve!;
  let it = loaner(s);
  if (!it) {
    it = { id: 'lantern-old', kind: 'lantern', name: 'Lantern', amount: 1, slots: 0, loaner: true, lit: true, rounds: LANTERN_MAX };
    const b = d.heroes.find((h) => h.heroId === (o.bearer ?? 'keven')) ?? d.heroes[0]!;
    b.pack.push(it);
  }
  if (o.bearer) {
    for (const h of d.heroes) h.pack = h.pack.filter((i) => i !== it);
    d.heroes.find((h) => h.heroId === o.bearer)!.pack.push(it);
  }
  if (o.rounds !== undefined) it.rounds = Math.max(0, Math.min(LANTERN_MAX, o.rounds));
  if (o.open !== undefined) it.lit = o.open;
  if (it.rounds === 0) it.lit = o.open ?? it.lit;
}

/** Take the old lantern away. */
export function noLantern(s: GameState): void {
  for (const h of s.delve!.heroes) h.pack = h.pack.filter((i) => !(i.kind === 'lantern' && i.loaner));
}

/** Rounds left in the old lantern (undefined when nobody carries it). */
export function lanternRounds(s: GameState): number | undefined {
  const it = loaner(s);
  return it ? (it.rounds ?? LANTERN_MAX) : undefined;
}

/** Is the old lantern open? */
export function lanternIsOpen(s: GameState): boolean {
  return !!loaner(s)?.lit;
}

/** A lit torch in `heroId`'s pack with `rounds` left (slotless, so packs in old tests stay as they were). */
export function litTorch(s: GameState, heroId: string, rounds = 15): Item {
  const it: Item = { id: `torch-${heroId}-${rounds}`, kind: 'torch', name: 'Torch', amount: 1, slots: 0, lit: true, rounds };
  s.delve!.heroes.find((h) => h.heroId === heroId)!.pack.push(it);
  return it;
}

/** Put out (and take away) `heroId`'s test torches. */
export function noTorch(s: GameState, heroId: string): void {
  const h = s.delve!.heroes.find((x) => x.heroId === heroId)!;
  h.pack = h.pack.filter((i) => !(i.kind === 'torch' && i.slots === 0));
}
