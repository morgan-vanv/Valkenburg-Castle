// createEngine(castle): the V3 rules engine behind the Engine interface.

import { posKey, type Pos } from './hex';
import type { ActionKind, ActionTarget, ApplyResult, Brightness, CastleDef, Command, GameEvent, GameState, Intent } from './types';
import type { Engine, Reach, RollPreview, Visibility } from './api';
import { classInfo } from './data';
import type { Ctx, DelveX, GameStateX } from './state';
import { blastPreview } from './charges';
import { brightnessOf, litSet, sightRangeAt, visibleSet, World } from './world';
import { edgeRiskAt, fallInfo } from './falls';
import { aleOffers, backToCamp, campCommand, newGame, newVillage, partyProblem, shopOffers } from './camp';
import { deals, doDeal } from './parley';
import { hd, rivalsOnMap, valueOf } from './common';
import { abandon, actions, checkDelveEnd, doAct, doMove, moveNoise, reachable, refreshSight, spec } from './delve';
import { computeIntents, planMonster, worldPhase } from './world-phase';
import { checkCombatEnd, combatReason, doSneak, doStopWalk, doTick, doWalk, exploreAct, exploreDeal, explorePath, vision } from './explore';

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
        // V3.8 (spec 22.1): a delve starts exploring, on a clean clock.
        c.d.mode = 'explore';
        c.d.ticks = 0;
        c.d.lanternSteps = 0;
        refreshSight(c);
        computeIntents(c);
        for (const m of c.d.monsters) m.intent = undefined;
        c.ev.push({ type: 'light', light: c.d.light, brightness: brightnessOf(c.d.light) });
        c.ev.push({ type: 'phase', phase: 'player', round: 1 });
        c.ev.push({ type: 'mode', mode: 'explore' });
        c.ev.push({ type: 'say', text: `${c.d.contract.title}. The lantern is full.` });
        return { state: s, events: [...r.events, ...ev] };
      }
      return { state: s, events: r.events };
    }
    if (s.stage !== 'delve') return refuse('Not now.');
    const c = ctx(w, s, ev)!;
    if (c.d.phase !== 'player') return refuse('Wait for your turn.');
    // V3.8 (spec 22.1): absent `mode` (saves and states from before V3.8) is combat.
    const exploring = c.d.mode === 'explore';
    let err: string | undefined;
    switch (command.type) {
      case 'tick':
        // Ticks only move the world while exploring; one that arrives in combat changes nothing.
        if (!exploring) return { state, events: [] };
        doTick(c);
        break;
      case 'walk':
        if (!exploring) return refuse('In combat: move on your turn.');
        err = doWalk(c, command.heroId, command.path, command.sneak);
        break;
      case 'stopWalk':
        err = doStopWalk(c, command.heroId);
        break;
      case 'sneak':
        err = doSneak(c, command.heroId, command.on);
        break;
      case 'move':
        if (exploring) return refuse('Exploring: give a walk order.');
        err = doMove(c, command.heroId, command.path, command.sneak);
        break;
      case 'act':
        err = exploring ? exploreAct(c, command.heroId, command.action, command.target, command.focus) : doAct(c, command.heroId, command.action, command.target, command.focus);
        break;
      case 'endTurn':
        if (exploring) return refuse('Nothing to end while exploring.');
        worldPhase(c);
        break;
      case 'deal':
        if (exploring) err = exploreDeal(c, command.heroId, command.deal, command.job);
        else {
          err = doDeal(c, command.heroId, command.deal, command.job);
          if (!err) {
            refreshSight(c);
            checkDelveEnd(c);
          }
        }
        break;
      case 'abandon':
        abandon(c);
        break;
      default:
        return refuse('Not during a delve.');
    }
    if (err) return refuse(err);
    // In combat: monsters woken mid-turn get an intent the player can see; nothing left to fight, back to exploring (spec 22.5).
    if (s.stage === 'delve' && c.d.phase === 'player' && c.d.mode !== 'explore') {
      const lit = litSet(w, c.d);
      for (const m of c.d.monsters) if (m.awareness !== 'asleep' && !m.intent) m.intent = planMonster(c, m, lit).intent;
      checkCombatEnd(c);
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

    shop: (state) => shopOffers(state),
    ales: (state) => aleOffers(state),
    explorePath(state, heroId, to, sneak) {
      const c = rctx(state);
      return c && state.stage === 'delve' ? explorePath(c, heroId, to, sneak) : null;
    },
    vision(state) {
      const c = rctx(state);
      return c && state.stage === 'delve' ? vision(c) : [];
    },

    blastPreview(state, at) {
      const c = rctx(state);
      if (!c) return { broke: [], collapsed: [], rubbled: [], hit: [] as string[] };
      return blastPreview(c, at);
    },

    mode(state) {
      const c = rctx(state);
      if (!c || state.stage !== 'delve') return { mode: 'combat', why: 'Not in a delve.' };
      if (c.d.mode === 'explore') return { mode: 'explore' };
      const why = combatReason(c);
      return why === undefined ? { mode: 'combat' } : { mode: 'combat', why };
    },
    deals(state, heroId) {
      const c = rctx(state);
      if (!c || state.stage !== 'delve') return [];
      return deals(c, heroId);
    },
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
        // V3.5: saves without the village start with nothing won back.
        s.campaign.village ??= newVillage();
        // V3.8 (spec 22.1): a delve saved before exploration mode is in combat; it goes exploring once nothing is left to fight.
        if (s.delve && !s.delve.mode) s.delve.mode = 'combat';
        return s;
      } catch {
        return null;
      }
    },
  };
  return engine;
}
