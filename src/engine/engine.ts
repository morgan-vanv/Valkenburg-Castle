// createEngine(map): the Engine interface (api.ts) over a given castle map.

import type { Engine } from './api';
import { tierOf } from './alarm';
import { dispatch, legalActions } from './apply';
import { companyKeys, newRun } from './run';
import { SHOP } from './data';
import { previewAttack } from './combat';
import { Ctx, RuleError } from './ctx';
import { areaAt, indexMap } from './mapIndex';
import { carryInfo, moveAllowance, reachable } from './movement';
import { visibility } from './sight';
import type { CastleMap, GameState } from './types';

export function createEngine(map: CastleMap): Engine {
  const ix = indexMap(map);
  const read = (state: GameState) => new Ctx(state, ix);
  return {
    map: () => map,
    newRun: (seed) => newRun(ix, seed ?? (Math.floor(Math.random() * 2 ** 31) >>> 0)),
    shop: () => SHOP,
    companyKeys: (state) => companyKeys(state),
    apply(state, cmd) {
      const next = structuredClone(state);
      const ctx = new Ctx(next, ix);
      try {
        dispatch(ctx, cmd);
      } catch (e) {
        if (e instanceof RuleError) return { state, events: [], error: e.message };
        throw e;
      }
      return { state: next, events: ctx.events };
    },
    reachable(state, unitId) {
      const ctx = read(state);
      const u = ctx.findUnit(unitId);
      if (!u || !state.expedition || u.actionsLeft < 1 || state.expedition.phase !== 'player') return [];
      return reachable(ctx, u);
    },
    actions(state, unitId) {
      const ctx = read(state);
      const u = ctx.findUnit(unitId);
      return u ? legalActions(ctx, u) : [];
    },
    previewAttack(state, unitId, targetId, kind, focus) {
      const ctx = read(state);
      const a = ctx.findUnit(unitId);
      const t = ctx.findUnit(targetId);
      if (!a || !t) return { ok: false, reason: 'Unknown unit.', frontage: 'wide', slots: 0, chance: 0, modifiers: [], maxFocus: 0, expectedWounds: 0 };
      return previewAttack(ctx, a, t, kind, focus);
    },
    visibility(state) {
      if (!state.expedition) return { visible: new Set(), explored: new Set(), enemies: [], contacts: [] };
      return visibility(read(state));
    },
    carry: (unit) => carryInfo(unit),
    area(coord) {
      const a = areaAt(ix, coord);
      return a ? { id: a.id, isRoom: a.isRoom, squares: a.squares } : undefined;
    },
    alarmTier: (alarm) => tierOf(alarm),
    moveAllowance: (state, unit) => moveAllowance(read(state), unit),
    serialize: (state) => JSON.stringify(state),
    deserialize(text) {
      const s = JSON.parse(text) as GameState;
      if (s.version !== 2) throw new Error('Saved game is from an older version.');
      return s;
    },
  };
}
