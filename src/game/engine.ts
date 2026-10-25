// createEngine(castle): the V3 rules engine behind the Engine interface.

import { posKey, type Pos } from './hex';
import type { ActionKind, ActionTarget, ApplyResult, Brightness, CastleDef, Command, GameEvent, GameState, Intent } from './types';
import type { Engine, Reach, RollPreview, Visibility } from './api';
import { classInfo, SHOP } from './data';
import type { Ctx, DelveX, GameStateX } from './state';
import { brightnessOf, litSet, sightRangeAt, visibleSet, World } from './world';
import { edgeRiskAt, fallInfo } from './falls';
import { backToCamp, campCommand, newGame, partyProblem } from './camp';
import { hd, rivalsOnMap, valueOf } from './common';
import { abandon, actions, doAct, doMove, moveNoise, reachable, refreshSight, spec } from './delve';
import { computeIntents, planMonster, worldPhase } from './world-phase';

function ctx(w: World, s: GameStateX, ev: GameEvent[] = []): Ctx | null {
  if (!s.delve) return null;
  return { w, s, d: s.delve as DelveX, ev };
}

export function createEngine(castle: CastleDef): Engine {
  const w = new World(castle);

  function apply(state: GameState, command: Command): ApplyResult {
    const s = structuredClone(state) as GameStateX;
    const ev: GameEvent[] = [];
    const refuse = (error: string): ApplyResult => ({ state, events: [], error });
    if (command.type === 'newCampaign') return { state: newGame(w, command.seed), events: [] };
    if (command.type === 'backToCamp') {
      const r = backToCamp(w, s);
      return r.error ? refuse(r.error) : { state: s, events: r.events };
    }
    if (s.stage === 'over') return refuse('The campaign is over.');
    if (s.stage === 'camp') {
      const r = campCommand(w, s, command);
      if (r.error) return refuse(r.error);
      if (command.type === 'startDelve') {
        const c = ctx(w, s, ev)!;
        refreshSight(c);
        computeIntents(c);
        c.ev.push({ type: 'light', light: c.d.light, brightness: brightnessOf(c.d.light) });
        c.ev.push({ type: 'phase', phase: 'player', round: 1 });
        c.ev.push({ type: 'say', text: `${c.d.contract.title}. The lantern is full.` });
        return { state: s, events: [...r.events, ...ev] };
      }
      return { state: s, events: r.events };
    }
    if (s.stage !== 'delve') return refuse('Not now.');
    const c = ctx(w, s, ev)!;
    if (c.d.phase !== 'player') return refuse('Wait for your turn.');
    let err: string | undefined;
    switch (command.type) {
      case 'move':
        err = doMove(c, command.heroId, command.path, command.sneak);
        break;
      case 'act':
        err = doAct(c, command.heroId, command.action, command.target, command.focus);
        break;
      case 'endTurn':
        worldPhase(c);
        break;
      case 'abandon':
        abandon(c);
        break;
      default:
        return refuse('Not during a delve.');
    }
    if (err) return refuse(err);
    // Monsters woken mid-turn get an intent the player can see.
    if (s.stage === 'delve' && c.d.phase === 'player') {
      const lit = litSet(w, c.d);
      for (const m of c.d.monsters) if (m.awareness !== 'asleep' && !m.intent) m.intent = planMonster(c, m, lit).intent;
    }
    return { state: s, events: ev };
  }

  function rctx(state: GameState): Ctx | null {
    return ctx(w, state as GameStateX);
  }

  const engine: Engine = {
    castle: () => castle,
    newGame: (seed) => newGame(w, seed),
    apply,

    reachable(state, heroId, sneak): Reach[] {
      // Queries never mutate: occupancy and dijkstra are read-only.
      const c = rctx(state);
      if (!c || state.stage !== 'delve') return [];
      return reachable(c, heroId, sneak);
    },

    actions(state, heroId) {
      const c = rctx(state);
      if (!c) return [];
      return actions(c, heroId);
    },

    preview(state, heroId, action: ActionKind, target: ActionTarget): RollPreview {
      const c = rctx(state);
      if (!c) return { ok: false, reason: 'Not in a delve.', slots: 0, chance: 0, modifiers: [], maxFocus: 0, outcomes: [], noise: 0, light: 0 };
      const sp = spec(c, heroId, action, target);
      const h = hd(c, heroId);
      return {
        ok: sp.ok,
        reason: sp.reason,
        stat: sp.stat,
        slots: sp.slots,
        chance: sp.chance,
        modifiers: sp.modifiers,
        maxFocus: sp.ok && h ? Math.min(h.focus, sp.slots) : 0,
        outcomes: sp.outcomes,
        noise: sp.noise,
        light: sp.light,
        ...(sp.warning ? { warning: sp.warning } : {}),
        ...(sp.confirm ? { confirm: true } : {}),
        ...(sp.hexes ? { hexes: sp.hexes } : {}),
        ...(sp.affects ? { affects: sp.affects } : {}),
      };
    },

    visibility(state): Visibility {
      const c = rctx(state);
      if (!c) return { visible: new Set(), explored: new Set(), lit: new Set() };
      const lit = litSet(w, c.d);
      const visible = visibleSet(w, c.d, lit);
      const explored = new Set(c.d.explored);
      for (const k of visible) explored.add(k);
      return { visible, explored, lit };
    },

    brightness(state): Brightness {
      return brightnessOf(state.delve?.light ?? 0);
    },

    intents(state): Record<string, Intent> {
      const c = rctx(state);
      const out: Record<string, Intent> = {};
      if (!c) return out;
      const vis = visibleSet(w, c.d);
      for (const m of c.d.monsters) {
        if (m.awareness === 'asleep' || m.buried || !m.intent) continue;
        if (vis.has(posKey(m.at)) || m.kind === 'gloam') out[m.id] = m.intent;
      }
      // The sisters show theirs too (spec 16.5), when seen and not veiled.
      for (const r of rivalsOnMap(c)) {
        if (r.intent && (r.veil ?? 0) <= 0 && vis.has(posKey(r.at))) out[r.id] = r.intent;
      }
      return out;
    },

    moveNoise(_state, _heroId, sneak) {
      return moveNoise(sneak);
    },

    inLight(state, at: Pos) {
      const c = rctx(state);
      if (!c) return false;
      return litSet(w, c.d).has(posKey(at));
    },

    sightRange(state, heroId) {
      const c = rctx(state);
      const h = c ? hd(c, heroId) : undefined;
      if (!c || !h) return 2;
      return sightRangeAt(w, c.d, h.at);
    },

    heroLit(state, heroId) {
      const c = rctx(state);
      const h = c ? hd(c, heroId) : undefined;
      if (!c || !h) return false;
      return litSet(w, c.d).has(posKey(h.at));
    },

    fallInfo(state, pit: Pos) {
      const c = rctx(state);
      if (!c) return null;
      return fallInfo(c, pit);
    },

    edgeRisk(state, heroId) {
      const c = rctx(state);
      if (!c) return null;
      const h = hd(c, heroId);
      if (!h || h.status !== 'active') return null;
      return edgeRiskAt(c, h.at, heroId);
    },

    shop: () => SHOP.map((o) => ({ ...o })),
    classInfo: (cls) => classInfo(cls),
    partyProblem: (state, heroIds) => partyProblem(state as GameStateX, heroIds),
    heroById: (state, id) => state.campaign.roster.find((h) => h.id === id),
    value: (items) => valueOf(items),

    serialize: (state) => JSON.stringify(state),
    deserialize(text) {
      try {
        const s = JSON.parse(text) as GameState;
        if (!s || s.version !== 3 || !s.campaign || typeof s.rng !== 'number') return null;
        // V3.4 (spec 17.2): saves from before HP carried over start everyone at full HP.
        for (const h of s.campaign.roster) if (typeof h.hp !== 'number') h.hp = h.maxHp;
        return s;
      } catch {
        return null;
      }
    },
  };
  return engine;
}
