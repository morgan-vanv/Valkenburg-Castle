// createEngine(castle): the V3 rules engine behind the Engine interface.

import { posKey, type Pos } from './hex';
import type { ActionKind, ActionTarget, ApplyResult, Brightness, CastleDef, Command, GameEvent, GameState, Intent, ReactionChoice } from './types';

/** What a run leaves behind when it pauses: the events so far and the world as it stood (spec 31.13). */
interface Box {
  ev: GameEvent[];
  s?: GameState;
}
import type { Engine, Peek, Reach, RollPreview, Visibility } from './api';
import { classInfo } from './data';
import type { Ctx, DelveX, GameStateX, ReactionPolicy } from './state';
import { Pause } from './react'; // V4.1 (spec 31.13)
import { blastPreview, migrateSatchel } from './charges';
import { calmReach } from './calm';
import { litSet, peekFrom, sightRangeAt, visibleSet, World } from './world';
import { PEEK_RANGE } from './data'; // V5.0 (spec 32.15)
import { brightnessAt } from './common';
import { lightsOf, migrateLight, siteUnlit } from './light'; // V4.1 (WS2)
import { migrateArrows, syncGlows } from './arrows'; // V4.1 (WS6)
import { NIGHTSIGHT_REFUND } from './data';
import { SQUAD_SLOTS_MAX } from './data'; // V4.1 (squads)
import { sightWash } from './stealth';
import { edgeRiskAt, fallInfo } from './falls';
import { aleOffers, backToCamp, campCommand, fitClass, newGame, newVillage, partyProblem, shopOffers } from './camp';
import { deals, doDeal } from './parley';
import { hd, rivalsOnMap, valueOf } from './common';
import { abandon, actions, checkDelveEnd, doAct, doFace, doMove, doSetMoveMode, doSetReaction, moveNoise, reachable, refreshSight, seenSet, sneakSetting, spec } from './delve';
import { computeIntents, lookAll, planMonster, worldPhase } from './world-phase';
import { calmReason, updateCalm } from './calm';
import { applyOpenWays, castleMemory, entranceList, startWays } from './ways';

function ctx(w: World, s: GameStateX, ev: GameEvent[] = []): Ctx | null {
  if (!s.delve) return null;
  return { w, s, d: s.delve as DelveX, ev };
}

/** V4.1 (spec 31.13): engine options. `react`: answer every reaction by this policy and never pause (bots, the arena). */
export interface EngineOptions {
  react?: ReactionPolicy;
}

export function createEngine(castle: CastleDef, opts: EngineOptions = {}): Engine {
  const w = new World(castle);

  /**
   * V4.1 (spec 31.13): every command runs through here. While a question is pending only `react` is taken: the
   * paused command runs again from the state before it, with the answers so far plus this one.
   */
  function apply(state: GameState, command: Command): ApplyResult {
    const pend = state.delve?.pending;
    if (pend) {
      if (command.type !== 'react') return { state, events: [], error: `Answer first: ${pend.question.text}` };
      if (command.choice !== 'yes' && command.choice !== 'no') return { state, events: [], error: 'Answer yes or no.' };
      const base = structuredClone(state);
      delete base.delve!.pending;
      return run(base, pend.command, [...pend.answers, command.choice], pend.played);
    }
    if (command.type === 'react') return { state, events: [], error: 'Nothing to answer.' };
    return run(state, command, []);
  }

  /** Runs `command` with these answers; a `Pause` becomes the pre-command state with `pending`, the events so far and the question. */
  function run(state: GameState, command: Command, answers: ReactionChoice[], played?: number): ApplyResult {
    const box: Box = { ev: [] };
    try {
      const r = exec(state, command, answers, box);
      return played === undefined || r.error ? r : { ...r, played };
    } catch (e) {
      if (!(e instanceof Pause)) throw e;
      const keep = structuredClone(state);
      keep.delve!.pending = { command, question: e.question, answers, played: box.ev.length };
      return { state: keep, events: [...box.ev, { type: 'react', question: e.question }], ...(played !== undefined ? { played } : {}), ...(box.s ? { view: box.s } : {}) };
    }
  }

  function exec(state: GameState, command: Command, answers: ReactionChoice[], box: Box): ApplyResult {
    const s = structuredClone(state) as GameStateX;
    const ev: GameEvent[] = box.ev;
    box.s = s;
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
        updateCalm(c);
        c.ev.push({ type: 'phase', phase: 'player', round: 1 });
        // V4.1 (WS2): no free lantern; the party brings its own light, or none.
        c.ev.push({ type: 'say', text: `${c.d.contract.title}.${c.d.heroes.some((h) => h.pack.some((i) => i.kind === 'torch' || i.kind === 'lantern')) ? '' : ' Nobody brought a light.'}` });
        return { state: s, events: [...r.events, ...ev] };
      }
      return { state: s, events: r.events };
    }
    if (s.stage !== 'delve') return refuse('Not now.');
    const c = ctx(w, s, ev)!;
    c.answers = answers; // V4.1 (spec 31.13): reactions can pause this command
    if (opts.react) c.policy = opts.react;
    if (c.d.phase !== 'player') return refuse('Wait for your turn.');
    let err: string | undefined;
    switch (command.type) {
      case 'move':
        err = doMove(c, command.heroId, command.path, command.sneak ?? sneakSetting(c, command.heroId), command.follow);
        break;
      case 'setMoveMode':
        err = doSetMoveMode(c, command.heroId, command.sneak);
        break;
      case 'setReaction':
        err = doSetReaction(c, command.heroId, command.kind, command.setting);
        break;
      case 'setAmbush':
        err = doSetReaction(c, command.heroId, 'hiddenSwing', command.on ? 'always' : 'never');
        break;
      case 'act': {
        // V4.0 (spec 27): an action that changes the light (a torch, the lantern opened, shuttered or passed, kindle, oil)
        // lets every awake monster look again.
        const before = litSet(w, c.d);
        err = doAct(c, command.heroId, command.action, command.target, command.focus);
        if (!err && s.stage === 'delve' && c.d.phase === 'player') {
          const after = litSet(w, c.d);
          if (after.size !== before.size || [...after].some((k) => !before.has(k))) lookAll(c);
        }
        break;
      }
      case 'endTurn':
        worldPhase(c);
        break;
      case 'face':
        err = doFace(c, command.heroId, command.facing);
        break;
      case 'deal':
        err = doDeal(c, command.heroId, command.deal, command.job);
        if (!err) {
          refreshSight(c);
          checkDelveEnd(c);
        }
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
      syncGlows(c); // V4.1 (WS6): glow arrows keep up with what they stuck in (one in a figure killed now stays where it fell)
      const lit = litSet(w, c.d);
      // V4.0 (spec 26.2): monsters that noticed a hero during the command re-plan (keeping their quarry), so the shown intent is right.
      for (const m of c.d.monsters) if (m.awareness !== 'asleep' && !m.buried  && (!m.intent || c.replan?.has(m.id))) m.intent = planMonster(c, m, lit).intent;
      c.replan = undefined;
      // V3.7 (spec 20.5): free movement on or off, with a `calm` event when it changes.
      updateCalm(c);
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
    resume(state) {
      // V4.1 (spec 31.13): the paused command run again with the answers given so far: it stops at the same question.
      const pend = state.delve?.pending;
      if (!pend) return null;
      const base = structuredClone(state);
      delete base.delve!.pending;
      return run(base, pend.command, pend.answers, 0);
    },

    reachable(state, heroId, sneak): Reach[] {
      // Queries never mutate: occupancy and dijkstra are read-only.
      const c = rctx(state);
      if (!c || state.stage !== 'delve') return [];
      return reachable(c, heroId, sneak ?? sneakSetting(c, heroId));
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

    // V5.0 (spec 32.15): the threshold's peek, for the HUD line and the bot.
    peek(state, heroId): Peek | null {
      const c = rctx(state);
      const h = c ? hd(c, heroId) : undefined;
      if (!c || !h || h.status !== 'active') return null;
      const o = peekFrom(w, c.d, h.at);
      if (!o) return null;
      const lit = litSet(w, c.d);
      const vis = visibleSet(w, c.d, lit);
      const dist = (p: Pos) => Math.max(Math.abs(p.q - o.q), Math.abs(p.r - o.r), Math.abs(p.q + p.r - o.q - o.r));
      const figures: Peek['figures'] = [];
      for (const m of c.d.monsters) {
        if (m.buried || m.at.level !== o.level || dist(m.at) > PEEK_RANGE || !vis.has(posKey(m.at))) continue;
        figures.push({ id: m.id, name: m.name, kind: m.kind, dist: dist(m.at), mood: m.awareness, at: { ...m.at } });
      }
      for (const r of rivalsOnMap(c)) {
        if (r.at.level !== o.level || dist(r.at) > PEEK_RANGE || !vis.has(posKey(r.at))) continue;
        figures.push({ id: r.id, name: r.name, kind: r.cls, dist: dist(r.at), mood: 'crew', at: { ...r.at } });
      }
      figures.sort((a, b) => a.dist - b.dist || a.id.localeCompare(b.id));
      return { level: o.level, down: o.level > h.at.level, lit: lit.has(posKey(o)) || sightRangeAt(w, c.d, o, lit) > 1, figures };
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
      // V4.1 (WS2): the light the party acts in, by the first active hero's own hex (no lantern stage any more).
      const c = rctx(state);
      const h = c?.d.heroes.find((x) => x.status === 'active');
      return c && h ? brightnessAt(w, c, h.at) : 'bright';
    },
    lights(state) {
      const c = rctx(state);
      return c ? lightsOf(c.d).map(({ at, radius, party, kind, holder, rounds, max }) => ({ at, radius, party, kind, ...(holder ? { holder } : {}), ...(rounds !== undefined ? { rounds, max } : {}) })) : [];
    },
    siteUnlit: (state, siteId) => siteUnlit(w, state, siteId),

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

    moveNoise(state, heroId, sneak) {
      const c = rctx(state);
      return moveNoise(sneak ?? (c ? sneakSetting(c, heroId) : false));
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
    seenEnemies(state) {
      const c = rctx(state);
      if (!c || state.stage !== 'delve') return new Set<string>();
      return seenSet(c, visibleSet(w, c.d));
    },
    calmReach(state, heroId, sneak) {
      const c = rctx(state);
      return c ? calmReach(c, heroId, sneak ?? sneakSetting(c, heroId)) : [];
    },

    blastPreview(state, at) {
      const c = rctx(state);
      if (!c) return { broke: [], collapsed: [], rubbled: [], hit: [] as string[] };
      return blastPreview(c, at);
    },

    calm(state) {
      const c = rctx(state);
      if (!c || state.stage !== 'delve') return { calm: false, why: 'Not in a delve.' };
      const why = calmReason(c);
      return why === undefined ? { calm: true } : { calm: false, why };
    },
    sightWash(state, watcherId, sneaking, quiet) {
      const c = rctx(state);
      if (!c || state.stage !== 'delve') return { front: [], side: [] };
      return sightWash(c, watcherId, sneaking ?? false, quiet ?? false);
    },
    deals(state, heroId) {
      const c = rctx(state);
      if (!c || state.stage !== 'delve') return [];
      return deals(c, heroId);
    },
    classInfo: (cls) => classInfo(cls),
    partyProblem: (state, heroIds) => partyProblem(state as GameStateX, heroIds),
    entrances: (state) => entranceList(w, state),
    castleMemory: (state) => castleMemory(w, state),
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
        s.campaign.village.alchemist ??= false; // V4.1 (spec 31.3): saves from before Ilse
        s.campaign.village.muster ??= false;
        s.campaign.squadSlots ??= SQUAD_SLOTS_MAX; // V4.1 (squads, spec 31.12): saves from before keep four slots
        // V4.0 (spec 25): a save without `opened` had every way in open, and keeps them (campaignOpen
        // reads the absent field as open). A delve saved mid-way gets its ways set up the same way.
        const d = s.delve as DelveX | null;
        // V4.0 (spec 26.5): a Sapper's satchel saved mid-delve becomes their improvised explosives.
        for (const h of d?.heroes ?? []) for (const i of h.pack) migrateSatchel(i);
        // V4.0 (spec 30.1): Sappers saved before the class was toned down come down to the class table (HP, Might);
        // one mid-delve keeps their wounds and is capped at the new maximum.
        for (const h of [...s.campaign.roster, ...(s.campaign.recruits ?? []).map((r) => r.hero), ...(s.campaign.captives ?? []).map((x) => x.hero)]) fitClass(h);
        for (const dh of d?.heroes ?? []) {
          const def = s.campaign.roster.find((x) => x.id === dh.heroId);
          if (def?.cls === 'sapper' && dh.hp > def.maxHp) dh.hp = def.maxHp;
        }
        // V4.1 (spec 31.4): venom and paralysis are gone: an envenomed or paralyzed figure loads as poisoned. A V4.0
        // shouldered ally (paralyzed, active) is set down: Carry lifts only the downed and the shackled.
        if (d) migratePoison(d);
        // V4.1 (spec 31.13): the WIP build's "strike from hiding" flag is the hidden-swing reaction set to always.
        for (const h of d?.heroes ?? []) {
          const x = h as typeof h & { ambush?: boolean };
          if (x.ambush) (h.reactions ??= {}).hiddenSwing ??= 'always';
          delete x.ambush;
        }
        // V4.1 (WS2): a delve saved with the old free lantern: it becomes a loaner Lantern in its bearer's pack.
        migrateLight(s);
        // V4.1 (WS6, spec 31.8): a delve saved before arrows: Rangers (heroes and crew) get their quiver.
        migrateArrows(s);
        // V4.1 (WS2): the old night-eye draught is no longer sold (Night-eye Stout is an ale): stash copies go back for 15 each.
        const flat = s.campaign.stash.filter((i) => i.kind === 'nightsight');
        if (flat.length) {
          s.campaign.stash = s.campaign.stash.filter((i) => i.kind !== 'nightsight');
          s.campaign.gold += NIGHTSIGHT_REFUND * flat.length;
        }
        if (d && !d.ways) {
          d.ways = startWays(w, s);
          applyOpenWays(w, d);
        }
        return s;
      } catch {
        return null;
      }
    },
  };
  return engine;
}

/** V4.1 (spec 31.4): old `venom` / `paralyzed` fields become `poisoned`; a V4.0 shoulder carry of an active ally ends. */
export function migratePoison(d: DelveX): void {
  type Old = { venom?: number; paralyzed?: number; poisoned?: boolean };
  const fix = (f: Old) => {
    if ((f.venom ?? 0) > 0 || (f.paralyzed ?? 0) > 0) f.poisoned = true;
    delete f.venom;
    delete f.paralyzed;
  };
  for (const h of d.heroes) fix(h as Old);
  for (const m of d.monsters) fix(m as Old);
  for (const r of d.rivals?.members ?? []) fix(r as Old);
  for (const h of d.heroes) {
    if (!h.carrying) continue;
    const x = d.heroes.find((o) => o.heroId === h.carrying);
    const pr = d.prisoner?.id === h.carrying ? d.prisoner : undefined;
    if (!(x && x.status === 'downed') && !(pr && !pr.freed)) h.carrying = undefined;
  }
}
