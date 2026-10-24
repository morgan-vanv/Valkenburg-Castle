// Hand-made GameState fixtures and a tiny stand-in engine, for building the
// view before the real engine lands. Not used once src/game/index.ts exists,
// except by screenshots that want a fixed scene (`?fixture=1`).

import type { ActionOption, Engine, FallInfo, Reach, RollPreview, Visibility } from '../game/api';
import { distance, hexKey, posKey, posNeighbors, range, samePos, type Pos } from '../game/hex';
import type { ActionKind, ActionTarget, ApplyResult, CastleDef, Command, GameState, Hero, HeroClass, Item, ShopOffer } from '../game/types';

function hero(id: string, name: string, cls: HeroClass, maxHp: number, stats: Hero['stats']): Hero {
  return { id, name, cls, level: 1, xp: 0, maxHp, stats, weaponTier: 0, armorTier: 0, wounded: 0, delves: 0, kills: 0 };
}

function item(id: string, kind: Item['kind'], name: string, amount = 1, slots = 1): Item {
  return { id, kind, name, amount, slots };
}

export function fixtureCampaign(): GameState['campaign'] {
  return {
    gold: 100,
    stash: [item('i1', 'torch', 'Torch'), item('i2', 'potion', 'Potion'), item('i3', 'rope', 'Rope')],
    roster: [
      hero('hobart', 'Lord Hobart', 'hobart', 12, { might: 65, finesse: 50, wits: 55, nerve: 80 }),
      hero('brann', 'Brann', 'sellsword', 10, { might: 70, finesse: 45, wits: 40, nerve: 60 }),
      hero('pim', 'Pim', 'burglar', 7, { might: 40, finesse: 75, wits: 60, nerve: 50 }),
      { ...hero('aldous', 'Aldous', 'mage', 6, { might: 30, finesse: 50, wits: 75, nerve: 55 }), wounded: 1 },
    ],
    recruits: [
      { hero: hero('h5', 'Berta', 'sellsword', 10, { might: 70, finesse: 45, wits: 40, nerve: 60 }), price: 40 },
      { hero: { ...hero('h6', 'Quill', 'burglar', 9, { might: 40, finesse: 80, wits: 60, nerve: 50 }), level: 2 }, price: 60 },
    ],
    board: [
      { id: 'k1', kind: 'rescue', title: 'Rescue Brother Edric', brief: 'Brother Edric is held in the cells.', siteId: 'res1', level: 2, bounty: 150, warnings: ['Orcs', 'Spider'] },
      { id: 'k2', kind: 'recover', title: 'Recover the Valkenburg Signet', brief: 'The Valkenburg Signet lies in the pantry.', siteId: 'rec1', level: 1, bounty: 100, warnings: ['Rats'] },
      { id: 'k3', kind: 'recover', title: 'Recover the Silver Ewer', brief: 'The Silver Ewer lies in the pantry.', siteId: 'rec1', level: 1, bounty: 100, warnings: [] },
    ],
    reputation: 0,
    delveCount: 0,
    fallen: [{ name: 'Sten', cls: 'sellsword', level: 2, where: 'Level 1, the pit hall', delve: 1 }],
    litBraziers: [],
    lostGear: [],
  };
}

/** A delve in progress on the test castle. */
export function fixtureDelve(castle: CastleDef): GameState {
  const e = castle.entrances[0]!;
  const near = (p: Pos, i: number): Pos => posNeighbors(p)[i] ?? p;
  const at0: Pos = near(e, 1);
  const c = fixtureCampaign();
  const heroIds = ['hobart', 'brann', 'pim', 'aldous'];
  const spots = [at0, near(at0, 0), near(at0, 2), near(at0, 1)];
  const heroes = heroIds.map((id, i) => ({
    heroId: id,
    at: spots[i]!,
    hp: id === 'brann' ? 7 : (c.roster.find((h) => h.id === id)?.maxHp ?? 8),
    focus: 3,
    pack: id === 'pim' ? [item('i9', 'gold', 'Gold', 35), item('i10', 'torch', 'Torch')] : id === 'hobart' ? [item('i11', 'potion', 'Potion')] : [],
    status: 'active' as const,
    bleed: 0,
    torch: id === 'brann' ? 8 : 0,
    moved: id === 'brann',
    acted: false,
    webbed: false,
    mana: id === 'aldous' ? 3 : 0,
    rallyCooldown: 0,
    revived: false,
  }));
  return {
    version: 3,
    seed: 1,
    rng: 1,
    stage: 'delve',
    campaign: c,
    summary: null,
    delve: {
      contract: c.board[1]!,
      round: 3,
      phase: 'player',
      heroes,
      monsters: castle.spawns.map((s, i) => ({
        id: `m${i + 1}`,
        kind: s.kind,
        name: s.name ?? s.kind[0]!.toUpperCase() + s.kind.slice(1),
        at: s.at,
        hp: s.kind === 'orc' ? 6 : s.kind === 'rats' ? 3 : 5,
        maxHp: s.kind === 'orc' ? 6 : s.kind === 'rats' ? 3 : 5,
        awareness: i === 0 ? 'hunting' : 'asleep',
        spawnedAt: s.at,
      })),
      rivals: null,
      light: 44,
      lanternBearer: 'hobart',
      doors: Object.fromEntries(
        castle.levels.flatMap((lv) =>
          Object.entries(lv.tiles)
            .filter(([, t]) => t.kind === 'door')
            .map(([k, t]) => [`${lv.level}:${k}`, { open: false, locked: !!t.locked, jammed: false }]),
        ),
      ),
      chests: castle.chests.map((ch) => ({ id: ch.id, at: ch.at, tier: ch.tier, locked: !!ch.locked, jammed: false, opened: false })),
      ground: [...castle.coins.map((co, i) => ({ at: co.at, items: [item(`g${i}`, 'gold', 'Gold', co.gold)] })), { at: castle.contractSites[0]!.at, items: [item('h1', 'heirloom', 'the Valkenburg Signet', 60, 2)] }],
      traps: Object.fromEntries(castle.traps.map((t) => [posKey(t.at), { spotted: true }])),
      lit: [posKey(castle.braziers[0]!)],
      blown: [],
      ropes: [],
      liftWorking: false,
      prisoner: null,
      explored: [],
      log: ['The party enters the keep.', 'Rats skitter in the dark.'],
      kills: {},
    },
  };
}

/** A stand-in engine with just enough behaviour to click around. */
export function fixtureEngine(castle: CastleDef): Engine {
  const tile = (p: Pos) => castle.levels.find((l) => l.level === p.level)?.tiles[hexKey(p)];
  const walk = (s: GameState, p: Pos) => {
    const t = tile(p);
    if (!t || ['wall', 'cracked', 'pillar', 'pit', 'brazier'].includes(t.kind)) return false;
    if (t.kind === 'door' && s.delve?.doors[posKey(p)]?.locked) return false;
    return !s.delve?.monsters.some((m) => samePos(m.at, p));
  };
  const shop: ShopOffer[] = [
    { kind: 'torch', name: 'Torch', price: 10, text: '12 rounds of light around the bearer.' },
    { kind: 'potion', name: 'Potion', price: 20, text: 'Heals 5. Gets a downed hero up.' },
    { kind: 'rope', name: 'Rope', price: 15, text: 'Anchor at the pit edge to climb down and back.' },
    { kind: 'charge', name: 'Blasting charge', price: 30, text: 'Opens locks and cracked walls. Very loud.' },
  ];
  const lit = (s: GameState): Set<string> => {
    const d = s.delve!;
    const out = new Set<string>();
    const b = d.heroes.find((h) => h.heroId === d.lanternBearer)!;
    const r = d.light > 36 ? 4 : d.light >= 19 ? 3 : d.light >= 1 ? 2 : 0;
    for (const h of range(b.at, r)) out.add(posKey({ level: b.at.level, ...h }));
    for (const h of d.heroes) if (h.torch > 0) for (const x of range(h.at, 2)) out.add(posKey({ level: h.at.level, ...x }));
    for (const k of d.lit) {
      const [l, rest] = k.split(':');
      const [q, rr] = rest!.split(',').map(Number);
      for (const x of range({ q: q!, r: rr! }, 3)) out.add(`${l}:${hexKey(x)}`);
    }
    return out;
  };
  const eng: Engine = {
    castle: () => castle,
    newGame: (seed) => ({ version: 3, seed, rng: seed, stage: 'camp', campaign: fixtureCampaign(), delve: null, summary: null }),
    apply(state: GameState, cmd: Command): ApplyResult {
      const s = structuredClone(state);
      if (cmd.type === 'newCampaign') return { state: eng.newGame(cmd.seed), events: [] };
      if (cmd.type === 'startDelve') return { state: fixtureDelve(castle), events: [{ type: 'say', text: 'The party enters.' }] };
      if (cmd.type === 'buy') {
        const o = shop.find((x) => x.kind === cmd.kind)!;
        if (s.campaign.gold < o.price) return { state, events: [], error: 'Not enough gold.' };
        s.campaign.gold -= o.price;
        s.campaign.stash.push(item(`b${Date.now()}`, o.kind, o.name));
        return { state: s, events: [] };
      }
      if (cmd.type === 'move' && s.delve) {
        const h = s.delve.heroes.find((x) => x.heroId === cmd.heroId)!;
        h.at = cmd.path[cmd.path.length - 1]!;
        h.moved = true;
        for (const k of lit(s)) if (!s.delve.explored.includes(k)) s.delve.explored.push(k);
        return { state: s, events: [{ type: 'moved', id: cmd.heroId, path: cmd.path }, { type: 'noise', at: h.at, radius: cmd.sneak ? 0 : 1 }] };
      }
      if (cmd.type === 'endTurn' && s.delve) {
        s.delve.round++;
        s.delve.light = Math.max(0, s.delve.light - 1);
        for (const h of s.delve.heroes) h.moved = h.acted = false;
        return { state: s, events: [{ type: 'phase', phase: 'world', round: s.delve.round - 1 }, { type: 'light', light: s.delve.light, brightness: eng.brightness(s) }, { type: 'phase', phase: 'player', round: s.delve.round }] };
      }
      if (cmd.type === 'act' && s.delve) {
        const h = s.delve.heroes.find((x) => x.heroId === cmd.heroId)!;
        h.acted = true;
        if (cmd.action === 'attack' && cmd.target.id) {
          const m = s.delve.monsters.find((x) => x.id === cmd.target.id)!;
          const results = [true, false, true].slice(0, 3);
          m.hp -= 2;
          const ev: ApplyResult['events'] = [
            { type: 'roll', who: cmd.heroId, what: 'Attack', roll: { slots: 3, chance: 55, focus: cmd.focus, results, hits: 2, perfect: false } },
            { type: 'hit', attacker: cmd.heroId, target: m.id, damage: 2, crit: false },
          ];
          if (m.hp <= 0) {
            s.delve.monsters = s.delve.monsters.filter((x) => x !== m);
            ev.push({ type: 'monsterDied', id: m.id });
          }
          return { state: s, events: ev };
        }
        return { state: s, events: [{ type: 'say', text: `${cmd.action}: not in the fixture engine.` }] };
      }
      if (cmd.type === 'abandon' || cmd.type === 'backToCamp') {
        s.stage = 'camp';
        s.delve = null;
        return { state: s, events: [] };
      }
      return { state, events: [], error: 'The fixture engine does not do that.' };
    },
    reachable(state, heroId, sneak): Reach[] {
      const d = state.delve!;
      const h = d.heroes.find((x) => x.heroId === heroId)!;
      if (h.moved) return [];
      const max = sneak ? 2 : 4;
      const seen = new Map<string, Reach>();
      const q: Reach[] = [{ to: h.at, cost: 0, path: [] }];
      seen.set(posKey(h.at), q[0]!);
      while (q.length) {
        const cur = q.shift()!;
        for (const n of posNeighbors(cur.to)) {
          const t = tile(n);
          const cost = cur.cost + (t?.kind === 'rubble' ? 2 : 1);
          if (cost > max || !walk(state, n) || seen.has(posKey(n))) continue;
          const r = { to: n, cost, path: [...cur.path, n] };
          seen.set(posKey(n), r);
          q.push(r);
        }
      }
      return [...seen.values()].filter((r) => r.cost > 0 && !d.heroes.some((o) => o.status === 'active' && samePos(o.at, r.to)));
    },
    actions(state, heroId): ActionOption[] {
      const d = state.delve!;
      const h = d.heroes.find((x) => x.heroId === heroId)!;
      if (h.acted) return [];
      const out: ActionOption[] = [];
      const adj = d.monsters.filter((m) => distance(m.at, h.at) === 1 && m.at.level === h.at.level);
      if (adj.length) out.push({ action: 'attack', label: 'Attack', targets: adj.map((m) => ({ id: m.id, at: m.at })), rolls: true });
      if (heroId === 'aldous') {
        const far = d.monsters.filter((m) => distance(m.at, h.at) <= 5 && m.at.level === h.at.level);
        if (far.length) out.push({ action: 'firebolt', label: 'Firebolt', targets: far.map((m) => ({ id: m.id, at: m.at })), rolls: true });
        out.push({ action: 'kindle', label: 'Kindle', targets: [{}], rolls: false });
      }
      if (h.pack.some((i) => i.kind === 'torch')) out.push({ action: 'torch', label: 'Light torch', targets: [{}], rolls: false });
      return out;
    },
    preview(_s, heroId, action: ActionKind, _t: ActionTarget): RollPreview {
      void _s;
      void _t;
      const fb = action === 'firebolt';
      return {
        ok: true,
        stat: fb ? 'wits' : 'might',
        slots: fb ? 3 : heroId === 'pim' ? 2 : 3,
        chance: fb ? 75 : 55,
        modifiers: ['Dim −10%', 'Target asleep +20%', 'Flanked +1 slot'],
        maxFocus: 3,
        outcomes: fb ? ['Miss', '2 dmg', '4 dmg', '6 dmg, +1 perfect'] : ['Miss', '2 dmg', '4 dmg', '6 dmg +1 (perfect)'],
        noise: fb ? 3 : 2,
        light: 0,
      };
    },
    visibility(state): Visibility {
      const d = state.delve;
      if (!d) return { visible: new Set(), explored: new Set(), lit: new Set() };
      const l = lit(state);
      const visible = new Set<string>();
      for (const h of d.heroes) {
        for (const x of range(h.at, 8)) {
          const k = posKey({ level: h.at.level, ...x });
          if (l.has(k) || distance(x, h.at) <= 1) visible.add(k);
        }
      }
      return { visible, explored: new Set([...d.explored, ...visible]), lit: l };
    },
    brightness: (s) => {
      const L = s.delve?.light ?? 60;
      return L > 36 ? 'bright' : L >= 19 ? 'dim' : L >= 1 ? 'dark' : 'pitch';
    },
    intents(state) {
      const d = state.delve!;
      const vis = eng.visibility(state).visible;
      const out: Record<string, import('../game/types').Intent> = {};
      for (const m of d.monsters) {
        if (m.awareness === 'asleep' || !vis.has(posKey(m.at))) continue;
        const target = d.heroes[0]!;
        out[m.id] = distance(m.at, target.at) <= 1 ? { kind: 'attack', targetId: target.heroId, damage: [0, 4] } : { kind: 'move', to: posNeighbors(m.at)[3] };
      }
      return out;
    },
    moveNoise: (_s, _h, sneak) => (sneak ? 0 : 1),
    sightRange: (s, level) => Math.max(2, (eng.brightness(s) === 'bright' ? 8 : eng.brightness(s) === 'dim' ? 6 : eng.brightness(s) === 'dark' ? 4 : 2) - (level - 1)),
    fallInfo: (_s, pit) => fallFrom(castle, pit),
    edgeRisk(s, heroId) {
      const h = s.delve?.heroes.find((x) => x.heroId === heroId);
      if (!h || tile(h.at)?.railing) return null;
      let worst: FallInfo | null = null;
      for (const n of posNeighbors(h.at)) {
        const f = fallFrom(castle, n);
        if (f && (!worst || f.levels > worst.levels)) worst = f;
      }
      return worst;
    },
    inLight: (s, at) => lit(s).has(posKey(at)),
    shop: () => shop,
    heroById: (s, id) => s.campaign.roster.find((h) => h.id === id),
    value: (items) => items.reduce((a, i) => a + (['gold', 'gem', 'jewelry', 'heirloom'].includes(i.kind) ? i.amount : 0), 0),
    serialize: (s) => JSON.stringify(s),
    deserialize: (t) => {
      try {
        const s = JSON.parse(t) as GameState;
        return s.version === 3 ? s : null;
      } catch {
        return null;
      }
    },
  };
  return eng;
}

const WALKABLE_KINDS = ['floor', 'rubble', 'door', 'stairs', 'exit', 'lift'];

/** Where a fall into this pit hex lands (fixture version of the rule in spec 14.2). */
export function fallFrom(castle: CastleDef, pit: Pos): FallInfo | null {
  const lv = (n: number) => castle.levels.find((l) => l.level === n);
  if (lv(pit.level)?.tiles[hexKey(pit)]?.kind !== 'pit') return null;
  for (let n = pit.level + 1; lv(n); n++) {
    const t = lv(n)!.tiles[hexKey(pit)];
    if (t?.kind === 'pit') continue;
    const levels = n - pit.level;
    let to: Pos = { level: n, q: pit.q, r: pit.r };
    if (!t || !WALKABLE_KINDS.includes(t.kind)) {
      const near = range(pit, 3)
        .filter((h) => WALKABLE_KINDS.includes(lv(n)!.tiles[hexKey(h)]?.kind ?? ''))
        .sort((a, b) => distance(a, pit) - distance(b, pit))[0];
      if (!near) return null;
      to = { level: n, ...near };
    }
    return { to, levels, damage: levels === 1 ? 4 : 7, levelName: lv(n)!.name };
  }
  return null;
}
