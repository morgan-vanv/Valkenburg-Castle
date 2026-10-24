// Rule numbers the UI shows, read straight from the engine's tables so
// labels can never drift from what the engine enforces.

import { ALARM_TIERS, CAMPAIGN as ENGINE_CAMPAIGN } from '../engine/data';
import { maxFocus as engineMaxFocus } from '../engine/combat';
import type { Unit } from '../engine/types';

export const CAMPAIGN = ENGINE_CAMPAIGN;
export const ALARM_BANDS = ALARM_TIERS;

export function maxFocus(u: Unit): number {
  return u.side === 'player' ? engineMaxFocus(u) : u.cls === 'orcSquad' ? 1 : 3;
}
