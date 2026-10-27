// V4.1 (WS5, spec 31.3): what the village's pairs do in the castle. Kept apart from delve.ts and common.ts so the
// rules for Dragonfire Porter and the Sapper's tripwire live in one place:
//  - `fireWard`: Dragonfire Porter takes DRAGONFIRE_WARD off fire, burning, the Dragon's breath and blast damage to the drinker.
//  - the tripwire: a Sapper's charge (Gerda and Ilse home) that also goes off when a monster or crew member steps within 1.
// Pair checks themselves are `pairHome` in data.ts.

import { distance, samePos, type Pos } from './hex';
import { DRAGONFIRE_WARD, pairHome } from './data';
import { say, type Ctx } from './state';
import { hd } from './common';
import { blast, fuses } from './charges';
import type { HeroClass } from './types';

/**
 * Fire, burning, breath or blast damage `dmg` to figure `id`, after Dragonfire Porter: 2 less to a hero who drank it
 * (to 0 at least); everyone else takes it as is. Callers skip the hit at 0 (a 0 hit on a downed hero would still kill).
 */
export function fireWard(c: Ctx, id: string, dmg: number): number {
  const h = hd(c, id);
  if (h && h.ale === 'dragonfire') return Math.max(0, dmg - DRAGONFIRE_WARD);
  return dmg;
}

/** Can this hero set tripwires? A Sapper, with Gerda and Ilse both home. */
export function canTripwire(c: Ctx, cls: HeroClass): boolean {
  return cls === 'sapper' && pairHome(c.s.campaign.village, 'smith', 'alchemist');
}

/** Is a tripwire charge within 1 of `p` (same level)? */
export function tripwireNear(c: Ctx, p: Pos): boolean {
  return fuses(c.d).some((f) => f.tripwire && f.at.level === p.level && distance(f.at, p) <= 1);
}

/**
 * A monster (not the Gloam) or crew member `id` has just stepped onto `p`: every tripwire within 1 goes off now, in the
 * order set, as its fuse would (the same blast). Returns true if one did. The mover's position must already be `p`.
 */
export function springTripwires(c: Ctx, id: string, p: Pos): boolean {
  if (c.d.monsters.some((m) => m.id === id && m.kind === 'gloam')) return false;
  const due = fuses(c.d).filter((f) => f.tripwire && f.at.level === p.level && distance(f.at, p) <= 1);
  if (!due.length) return false;
  c.d.fuses = fuses(c.d).filter((f) => !due.includes(f));
  for (const f of due) {
    say(c, samePos(f.at, p) ? 'Something steps on the tripwire.' : 'A tripwire goes taut.');
    blast(c, f.at, f.by);
  }
  return true;
}
