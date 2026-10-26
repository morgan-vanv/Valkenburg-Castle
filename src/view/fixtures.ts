// Hand-made GameState fixtures and a tiny stand-in engine, for building the
// view before the real engine lands. Not used once src/game/index.ts exists,
// except by screenshots that want a fixed scene (`?fixture=1`).

import type { ActionOption, Engine, FallInfo, MoveRisks, Reach, RollPreview, Visibility } from '../game/api';
import { DIRS, distance, hexKey, posKey, posNeighbors, range, samePos, type Pos } from '../game/hex';
import type { ActionKind, ActionTarget, AleOffer, ApplyResult, CastleDef, Command, CrewId, DealOption, GameState, Hero, HeroClass, Intent, Item, Rival, RivalCrew, ShopOffer, StoryId } from '../game/types';
import { backDirs, backstabFrom, blastPreview, blastRings, breakableWall, dirToward, inFrontHalf, pathEndFacing } from './stealth';
import { longPaths } from './pathing';

function hero(id: string, name: string, cls: HeroClass, maxHp: number, stats: Hero['stats']): Hero {
  return { id, name, cls, level: 1, xp: 0, maxHp, hp: maxHp, stats, weaponTier: 0, armorTier: 0, wounded: 0, delves: 0, kills: 0 };
}

function item(id: string, kind: Item['kind'], name: string, amount = 1, slots = 1): Item {
  return { id, kind, name, amount, slots };
}

export function fixtureCampaign(): GameState['campaign'] {
  return {
    gold: 100,
    stash: [item('i1', 'torch', 'Torch'), item('i2', 'potion', 'Potion'), item('i3', 'rope', 'Rope')],
    roster: [
      { ...hero('keven', 'Keven', 'heir', 12, { might: 65, finesse: 50, wits: 55, nerve: 80 }), shield: true },
      // V3.7: Brann is a Sapper (set-charge flow) and Aldous a Shadowmancer (Dread) in the fixture.
      hero('brann', 'Brann', 'sapper', 11, { might: 70, finesse: 45, wits: 40, nerve: 60 }),
      hero('pim', 'Pim', 'burglar', 7, { might: 40, finesse: 75, wits: 60, nerve: 50 }),
      { ...hero('aldous', 'Aldous', 'shadowmancer', 6, { might: 30, finesse: 50, wits: 75, nerve: 55 }), wounded: 1 },
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
    village: { surgeon: false, innkeeper: false, smith: false, copper: false, caskbook: false },
    captives: [],
  };
}

/** V3.7 (20.4): a hero carried off by a crew, with the "Bring back" contract pinned (fixture and checks). */
export function fixtureCaptive(c: GameState['campaign'], heroId = 'pim', crew: CrewId = 'ferrymen'): void {
  const i = c.roster.findIndex((h) => h.id === heroId);
  if (i < 0) return;
  const [hero] = c.roster.splice(i, 1);
  const siteId = `${crew}-hideout`;
  c.captives.push({ hero: hero!, crew, siteId, delve: c.delveCount });
  c.board.push({ id: `rescue-${heroId}`, kind: 'rescue', title: `Bring back ${hero!.name}`, brief: `${hero!.name} was dragged off by ${crew === 'ferrymen' ? 'the Ferrymen' : crew === 'the-wake' ? 'the Wake' : 'a crew'}. They are held at the crew's hideout, alive for now.`, siteId, level: 2, bounty: 150, warnings: ['The Ferrymen', 'Held at HP 1'] });
}

/** V3.5 (18.3): the story contracts the fixture pins, by what is home. */
const STORY_CONTRACTS: { story: StoryId; kind: 'rescue' | 'recover'; title: string; brief: string; siteId: string; level: number; bounty: number; needs: (v: GameState['campaign']['village'], rep: number) => boolean }[] = [
  { story: 'surgeon', kind: 'rescue', title: 'Rescue Brother Aldric', brief: 'Brother Aldric slipped back into the castle to pick herbs from the physic garden and was taken. The orcs keep him in the chapel to patch up their wounded.', siteId: 'l1-story-chapel', level: 1, bounty: 50, needs: () => true },
  { story: 'innkeeper', kind: 'rescue', title: 'Rescue Old Wim', brief: 'Old Wim never got out. The orcs keep him at the spit in the kitchens, cooking for the warband.', siteId: 'l1-story-kitchens', level: 1, bounty: 50, needs: (_v, rep) => rep >= 1 },
  { story: 'smith', kind: 'rescue', title: 'Rescue Gerda the smith', brief: 'Gerda barred the forge door the night the castle fell and has held it since, trading mended blades for food.', siteId: 'l2-story-forge', level: 2, bounty: 75, needs: (_v, rep) => rep >= 1 },
  { story: 'copper', kind: 'recover', title: 'Recover the brewing copper', brief: "The orcs dragged Wim's brewing copper to the barracks to brew their own swill. It sits among the sleeping squad.", siteId: 'l2-story-barracks', level: 2, bounty: 75, needs: (v) => v.innkeeper },
  { story: 'caskbook', kind: 'recover', title: "Recover Wim's cask book", brief: "Wim's cask book was lost in the Drain when the cellars flooded.", siteId: 'l3-recover-drain', level: 3, bounty: 100, needs: (v) => v.copper },
];

/** Pin the story contracts whose prerequisites are met and that aren't done. */
export function pinStories(c: GameState['campaign']): void {
  c.board = c.board.filter((k) => !k.story);
  for (const sc of STORY_CONTRACTS) {
    if (c.village[sc.story] || !sc.needs(c.village, c.reputation)) continue;
    c.board.push({ id: `story-${sc.story}`, kind: sc.kind, title: sc.title, brief: sc.brief, siteId: sc.siteId, level: sc.level, bounty: sc.bounty, warnings: [], story: sc.story });
  }
}

/** A cutthroat crew demanding a toll next to the party (fixture, for the parley card). */
export function fixtureCrew(s: GameState, stance: RivalCrew['stance'] = 'demanding'): GameState {
  const d = s.delve!;
  const a = d.heroes[0]!.at;
  const near = (i: number, j: number): Pos => posNeighbors(posNeighbors(posNeighbors(a)[i] ?? a)[i] ?? a)[j] ?? a;
  const gold = (n: number): Item => item(`cg${n}`, 'gold', 'Gold', 30);
  const hostile = stance === 'hostile';
  const face = (p: Pos) => facingToward(p, a);
  // V3.7 (20.4): members are built like heroes: level 3, weapon 1, armor 1, a 4-slot pack each.
  const members: Rival[] = [
    { id: 'r1', crew: 'ferrymen', name: 'Brune', cls: 'sellsword', at: near(0, 0), hp: 12, maxHp: 12, loot: [gold(1)], goneOut: false, level: 3, weaponTier: 1, armorTier: 1, facing: face(near(0, 0)), pack: [item('rp1', 'potion', 'Potion'), item('rp2', 'glue', 'Glue bomb')], intent: stance === 'demanding' ? { kind: 'toll' } : hostile ? { kind: 'item', item: 'glue', to: a, hexes: [a, ...posNeighbors(a)] } : undefined },
    { id: 'r2', crew: 'ferrymen', name: 'Osk', cls: 'ranger', at: near(0, 1), hp: 9, maxHp: 9, loot: [gold(2)], goneOut: false, level: 3, weaponTier: 1, armorTier: 1, facing: face(near(0, 1)), pack: [item('rp3', 'caltrops', 'Caltrops'), item('rp4', 'caltrops', 'Caltrops'), item('rp5', 'potion', 'Potion')], intent: hostile ? { kind: 'potion' } : undefined },
    { id: 'r3', crew: 'ferrymen', name: 'Hackett', cls: 'sapper', at: near(0, 5), hp: 11, maxHp: 11, loot: [gold(3)], goneOut: false, charges: 2, level: 3, weaponTier: 1, armorTier: 1, facing: face(near(0, 5)), pack: [{ ...item('rp6', 'charge', 'Satchel: 2 charges', 2, 0) }, item('rp7', 'glue', 'Glue bomb')], intent: hostile ? { kind: 'fuse', to: a } : undefined },
  ];
  d.rivals = {
    crew: 'ferrymen',
    name: 'The Ferrymen',
    temperament: 'cutthroat',
    stance,
    goal: 'loot',
    aim: { at: near(3, 3), what: 'the chest by the bridge', rounds: 3, value: 60 },
    toll: 75,
    hiredRounds: stance === 'hired' ? 4 : undefined,
    spotted: true,
    entersRound: 1,
    members,
  };
  return s;
}

/** V3.7 (20.4): the Wake (Level 3 crew, deep green and bone) at full strength, hostile, one member dragging a downed hero. */
export function fixtureWake(s: GameState): GameState {
  const d = s.delve!;
  const a = d.heroes[0]!.at;
  const near = (i: number, j: number): Pos => posNeighbors(posNeighbors(posNeighbors(a)[i] ?? a)[i] ?? a)[j] ?? a;
  const gold = (n: number): Item => item(`wg${n}`, 'gold', 'Gold', 50);
  const victim = d.heroes.find((h, i) => i > 0 && h.status === 'active') ?? d.heroes[d.heroes.length - 1]!;
  victim.status = 'downed';
  victim.hp = 0;
  victim.bleed = 2;
  victim.at = near(0, 2);
  const crew: CrewId = 'the-wake';
  const members: Rival[] = [
    { id: 'w1', crew, name: 'Mother Grave', cls: 'sellsword', at: near(0, 0), hp: 16, maxHp: 16, loot: [gold(1)], goneOut: false, level: 4, weaponTier: 2, armorTier: 1, facing: facingToward(near(0, 0), a), pack: [item('wp1', 'potion', 'Potion'), item('wp2', 'potion', 'Potion')], intent: { kind: 'attack', targetId: d.heroes[0]!.heroId, damage: [0, 7] } },
    { id: 'w2', crew, name: 'Sexton', cls: 'hedgewitch', at: near(0, 1), hp: 12, maxHp: 12, loot: [gold(2)], goneOut: false, level: 4, weaponTier: 2, armorTier: 1, facing: facingToward(near(0, 1), a), pack: [item('wp3', 'potion', 'Potion'), item('wp4', 'potion', 'Potion')], intent: { kind: 'item', targetId: 'w1' } },
    { id: 'w3', crew, name: 'Candle', cls: 'shadowmancer', at: near(0, 5), hp: 11, maxHp: 11, loot: [gold(3)], goneOut: false, level: 4, weaponTier: 2, armorTier: 1, facing: facingToward(near(0, 5), a), pack: [item('wp5', 'smoke', 'Smoke bomb'), item('wp6', 'firecracker', 'Firecracker')], intent: { kind: 'veil' } },
    { id: 'w4', crew, name: 'Spade', cls: 'sapper', at: near(0, 2), hp: 13, maxHp: 13, loot: [gold(4)], goneOut: false, level: 4, weaponTier: 2, armorTier: 1, facing: facingToward(near(0, 2), a), pack: [item('wp7', 'charge', 'Satchel: 3 charges', 3, 0)], dragging: victim.heroId, intent: { kind: 'drag', targetId: victim.heroId, to: near(3, 2) } },
  ];
  d.rivals = { crew, name: 'The Wake', temperament: 'cutthroat', stance: 'hostile', goal: 'loot', spotted: true, entersRound: 1, members };
  return s;
}

/** DIRS index from `from` toward `to` (nearest of the six). */
function facingToward(from: Pos, to: Pos): number {
  if (samePos(from, to)) return 0;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < 6; i++) {
    const n = { level: from.level, q: from.q + DIRS[i]!.q, r: from.r + DIRS[i]!.r };
    const dd = distance(n, to);
    if (dd < bestD) {
      bestD = dd;
      best = i;
    }
  }
  return best;
}

/** A delve in progress on the test castle. */
export function fixtureDelve(castle: CastleDef): GameState {
  const e = castle.entrances[0]!;
  const near = (p: Pos, i: number): Pos => posNeighbors(p)[i] ?? p;
  const at0: Pos = near(e, 1);
  const c = fixtureCampaign();
  const heroIds = ['keven', 'brann', 'pim', 'aldous'];
  const spots = [at0, near(at0, 0), near(at0, 2), near(at0, 1)];
  // V3.9 (24.2): everyone faces into the castle; Aldous at the back faces back the way they came (covering the others).
  const inward = dirToward(e, at0);
  const heroes = heroIds.map((id, i) => ({
    heroId: id,
    at: spots[i]!,
    facing: id === 'aldous' ? (inward + 3) % 6 : inward,
    hp: id === 'brann' ? 7 : (c.roster.find((h) => h.id === id)?.maxHp ?? 8),
    focus: 3,
    pack: id === 'pim' ? [item('i9', 'gold', 'Gold', 35), item('i10', 'torch', 'Torch'), { ...item('i12', 'gem', 'Ruby', 60) }, item('i17', 'improvised', 'Improvised pick', 1, 0)] : id === 'keven' ? [item('i11', 'potion', 'Potion'), item('i13', 'nightsight', 'Night-eye draught')] : id === 'brann' ? [item('i15', 'charge', 'Satchel: 3 charges', 3, 0), item('i14', 'lockpicks', 'Lockpicks'), item('i16', 'torch', 'Torch')] : [],
    nightEyes: id === 'brann' ? 5 : undefined,
    ale: id === 'keven' ? ('reserve' as const) : id === 'pim' ? ('smuggler' as const) : undefined,
    status: 'active' as const,
    bleed: 0,
    torch: id === 'brann' ? 8 : 0,
    moved: id === 'brann',
    acted: false,
    webbed: false,
    mana: id === 'aldous' ? 3 : 0,
    rallyCooldown: 0,
    revived: false,
    dashed: false,
    overwatch: false,
    veil: 0,
    ward: 0,
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
        // V3.7 (20.1): a facing each; the hunter faces the party.
        facing: i === 0 ? facingToward(s.at, at0) : (i * 2) % 6,
      })),
      rivals: null,
      light: 44,
      lanternBearer: 'keven',
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
      fuses: [],
      smashed: [],
      calmSteps: 0,
      ropes: [],
      liftWorking: false,
      lanternOpen: true,
      knownRoutes: [],
      gloamCalm: 0,
      smoke: {},
      glue: {},
      burning: {},
      caltrops: [],
      prisoner: null,
      explored: [],
      log: ['The party enters the keep.', 'Rats skitter in the dark.'],
      kills: {},
    },
  };
}

/** A stand-in engine with just enough behaviour to click around. */
/** V3.7 (20.5): the test castle with a crate and a barrel near the first entrance (it has none of its own). */
export function withBreakables(castle: CastleDef): CastleDef {
  const e = castle.entrances[0];
  const lv = castle.levels.find((l) => l.level === e?.level);
  if (!e || !lv || Object.values(lv.tiles).some((t) => t.prop === 'crate')) return castle;
  const at0 = posNeighbors(e)[1] ?? e;
  const ring = [...posNeighbors(at0).slice(3), ...posNeighbors(posNeighbors(at0)[3] ?? at0)];
  const spots = ring.filter((p, i) => lv.tiles[hexKey(p)]?.kind === 'floor' && !samePos(p, e) && distance(p, e) > 1 && ring.findIndex((q) => samePos(q, p)) === i).slice(0, 2);
  if (!spots.length) return castle;
  const tiles = { ...lv.tiles };
  spots.forEach((p, i) => (tiles[hexKey(p)] = { ...tiles[hexKey(p)]!, kind: 'prop', prop: i ? 'barrel' : 'crate' }));
  return { ...castle, levels: castle.levels.map((l) => (l === lv ? { ...l, tiles } : l)) };
}

export function fixtureEngine(castle0: CastleDef): Engine {
  const castle = withBreakables(castle0);
  const tile = (p: Pos) => castle.levels.find((l) => l.level === p.level)?.tiles[hexKey(p)];
  const walk = (s: GameState, p: Pos) => {
    const t = tile(p);
    if (!t || ['wall', 'cracked', 'pillar', 'pit', 'brazier', 'tallprop', 'sealed'].includes(t.kind)) return false;
    if (t.kind === 'prop' && !(s.delve?.smashed ?? []).includes(posKey(p))) return false;
    if (t.kind === 'door' && s.delve?.doors[posKey(p)]?.locked) return false;
    return !s.delve?.monsters.some((m) => samePos(m.at, p));
  };
  /** V3.7: an awake monster's blind arc holds `p` (direction from the monster is one of the three back directions). */
  const inBlindArc = (m: { at: Pos; facing?: number }, p: Pos): boolean => {
    const dq = p.q - m.at.q;
    const dr = p.r - m.at.r;
    if (!dq && !dr) return false;
    const back = new Set(backDirs(m.facing ?? 0));
    // Nearest direction by the hex metric: the DIR whose scaled step best matches the offset.
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < 6; i++) {
      const k = distance({ q: 0, r: 0 }, { q: dq, r: dr });
      const d = distance({ q: dq, r: dr }, { q: DIRS[i]!.q * k, r: DIRS[i]!.r * k });
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return back.has(best);
  };
  /** V3.9 (24.4): enemies the party has seen this delve (the fixture keeps it here, not in the delve). */
  const seenIds = new Set<string>();
  const noteSeen = (s: GameState, visible: Set<string>) => {
    const d = s.delve;
    if (!d) return;
    for (const m of d.monsters) if (m.hp > 0 && visible.has(posKey(m.at))) seenIds.add(m.id);
    for (const r of d.rivals?.members ?? []) if (r.hp > 0 && !r.goneOut && visible.has(posKey(r.at))) seenIds.add(r.id);
  };
  /** V3.7 (20.1, 20.2): what a path risks, the fixture way (no line of sight, lit = the lantern's reach). V3.9: seen enemies only. */
  const risksFor = (s: GameState, heroId: string, path: Pos[], sneak: boolean): MoveRisks => {
    const all = risksAll(s, heroId, path, sneak);
    const vis = visInner(s).visible;
    noteSeen(s, vis);
    const posOf = (id: string) => s.delve!.monsters.find((m) => m.id === id)?.at ?? s.delve!.rivals?.members.find((r) => r.id === id)?.at;
    return {
      wake: all.wake.filter((w) => seenIds.has(w.id)),
      notice: all.notice.filter((n) => { const p = posOf(n.id); return !!p && vis.has(posKey(p)); }),
      swings: all.swings.filter((sw) => seenIds.has(sw.id)),
    };
  };
  const risksAll = (s: GameState, heroId: string, path: Pos[], sneak: boolean): MoveRisks => {
    const d = s.delve!;
    const h = d.heroes.find((x) => x.heroId === heroId)!;
    const end = path[path.length - 1] ?? h.at;
    const litSet = lit(s);
    const out: MoveRisks = { wake: [], notice: [], swings: [] };
    for (const m of d.monsters) {
      if (m.hp <= 0 || m.at.level !== h.at.level) continue;
      if (m.awareness === 'asleep') {
        if (m.kind === 'dragon') continue;
        let chance = 0;
        let at: Pos | null = null;
        for (const p of path) {
          if (distance(p, m.at) > 2) continue;
          const c = (sneak ? 10 : 50) / (litSet.has(posKey(p)) ? 1 : 2);
          if (c > chance) {
            chance = c;
            at = p;
          }
        }
        if (distance(end, m.at) === 1) {
          chance = sneak ? 25 : 100;
          at = end;
        }
        if (at) out.wake.push({ at, id: m.id, chance });
        continue;
      }
      // Awake: notices the hero at the destination unless it is in the blind arc (sneaking) or out of range.
      const litEnd = litSet.has(posKey(end));
      const blind = inBlindArc(m, end);
      const rng = h.at.level === 3 ? (sneak ? 3 : 6) : litEnd ? (sneak ? 4 : 6) : sneak ? 1 : 3;
      const dist = distance(end, m.at);
      const noticed = m.awareness === 'hunting' ? false : sneak ? !blind && dist <= rng : dist <= (blind ? Math.ceil(rng / 2) : rng);
      if (noticed) out.notice.push({ id: m.id });
      if (m.awareness === 'hunting' && distance(h.at, m.at) === 1 && distance(end, m.at) > 1) out.swings.push({ id: m.id, damage: [0, m.kind === 'orc' ? 2 : 3] });
    }
    if (d.rivals?.stance === 'hostile')
      for (const r of d.rivals.members) {
        if (r.hp <= 0 || r.goneOut || r.at.level !== h.at.level) continue;
        if (distance(h.at, r.at) === 1 && distance(end, r.at) > 1 && !(r.feared ?? 0)) out.swings.push({ id: r.id, damage: [0, 4] });
      }
    return out;
  };
  const shop: ShopOffer[] = [
    { kind: 'torch', name: 'Torch', price: 10, text: '12 rounds of light around the bearer.' },
    { kind: 'potion', name: 'Potion', price: 20, text: 'Heals 5. Gets a downed hero up.' },
    { kind: 'rope', name: 'Rope', price: 15, text: 'Anchor at the pit edge to climb down and back.' },
    { kind: 'charge', name: 'Blasting charge', price: 30, text: 'Opens locks and cracked walls. Very loud.' },
    { kind: 'caltrops', name: 'Caltrops', price: 15, text: 'Scatter next to you: the first monster across takes 2 and stops.', needs: 'smith' },
    { kind: 'hook', name: 'Grappling hook', price: 40, text: 'Climb from a pit landing back up a level. Reusable.', needs: 'smith' },
    { kind: 'key', name: 'Skeleton key', price: 30, text: 'Opens one locked door or chest, silently. One use.', needs: 'smith' },
    { kind: 'lockpicks', name: 'Lockpicks', price: 25, text: 'Proper picks, never used up. A Burglar picks at 3 Finesse slots, anyone else at 2.', needs: 'smith' },
    { kind: 'nightsight', name: 'Night-eye draught', price: 30, text: 'Drink: 8 rounds without dark penalties.', needs: 'innkeeper' },
  ];
  const shopFor = (s?: GameState): ShopOffer[] =>
    shop.map((o) =>
      !s ? o
      : o.needs === 'smith' && !s.campaign.village?.smith ? { ...o, locked: 'Needs a smith: rescue Gerda (Level 2, the forge).' }
      : o.needs === 'innkeeper' && !s.campaign.village?.innkeeper ? { ...o, locked: 'Brewed at the Gilded Flagon: rescue Old Wim (Level 1, the kitchens).' }
      : o,
    );
  const ALES: Omit<AleOffer, 'locked'>[] = [
    { kind: 'glowworm', name: 'Glowworm Pale', price: 15, text: 'Shed light radius 1 for the delve.', needs: 'copper' },
    { kind: 'featherfoot', name: 'Featherfoot', price: 15, text: 'Your first fall deals no damage.', needs: 'copper' },
    { kind: 'mole', name: "Mole's Brown", price: 20, text: 'Dig like a Sapper.', needs: 'copper' },
    { kind: 'reserve', name: "Hobart's Reserve", price: 20, text: 'Focus starts at 4, max 4.', needs: 'copper' },
    { kind: 'smuggler', name: "Smuggler's Mead", price: 20, text: 'Sneak 4, silently.', needs: 'caskbook' },
    { kind: 'fireside', name: 'Fireside Porter', price: 25, text: 'Heal 3 on every level change.', needs: 'caskbook' },
    { kind: 'blackcask', name: 'Black Cask', price: 10, text: '70% a random ale, 30% a drawback.', needs: 'caskbook' },
  ];
  const alesFor = (s: GameState): AleOffer[] =>
    ALES.map((a) => (s.campaign.village?.[a.needs] ? a : { ...a, locked: a.needs === 'copper' ? 'Not brewed yet: recover the brewing copper (Level 2, the forge).' : "Not brewed yet: recover Wim's cask book (Level 3, the Drain)." }));
  const PAYABLE = ['gold', 'gem', 'jewelry'];
  const dealsFor = (s: GameState, heroId: string): DealOption[] => {
    const d = s.delve;
    const r = d?.rivals;
    const h = d?.heroes.find((x) => x.heroId === heroId);
    if (!d || !r || !h || h.status !== 'active') return [];
    if (!r.members.some((m) => m.hp > 0 && !m.goneOut && m.at.level === h.at.level && distance(m.at, h.at) <= 4)) return [];
    const purse = d.heroes.filter((x) => x.status === 'active').flatMap((x) => x.pack).filter((i) => PAYABLE.includes(i.kind));
    const total = purse.reduce((a, i) => a + i.amount, 0);
    const pay = (price: number): { pays?: string; blocked?: string } => {
      if (price <= 0) return {};
      if (total < price) return { blocked: `You carry ${total}; they want ${price}.` };
      const sorted = [...purse].sort((a, b) => (a.kind === 'gold' ? -1 : b.kind === 'gold' ? 1 : a.amount - b.amount));
      let got = 0;
      let coins = 0;
      const rest: string[] = [];
      for (const i of sorted) {
        if (got >= price) break;
        if (i.kind === 'gold') {
          const take = Math.min(i.amount, price - got);
          coins += take;
          got += take;
        } else {
          rest.push(`${/^[AEIOU]/.test(i.name) ? 'an' : 'a'} ${i.name.toLowerCase()} (${i.amount})`);
          got += i.amount;
        }
      }
      return { pays: [coins ? `${coins} gold` : '', ...rest].filter(Boolean).join(' and ') };
    };
    const lv = h.at.level >= 2 ? 1.5 : 1;
    const p = (n: number) => Math.round((n * lv) / 5) * 5;
    const out: DealOption[] = [];
    const st = r.stance;
    const add = (o: Omit<DealOption, 'ok'> & { cond: boolean; why?: string }) => {
      const { cond, why, ...rest } = o;
      const pay2 = pay(rest.price);
      const blocked = !cond ? why : pay2.blocked;
      out.push({ ...rest, pays: pay2.pays, ok: !blocked, blocked });
    };
    add({ deal: 'leave', label: 'Pay them to leave', price: p(40), text: 'They take the money and head for the way out now. They drop any heirloom or prisoner they hold.', cond: st !== 'hired', why: 'They work for you now.' });
    add({ deal: 'truce', label: st === 'demanding' ? 'Pay the toll' : 'Buy a truce', price: st === 'demanding' ? (r.toll ?? 50) : st === 'hostile' ? p(50) : p(25), text: r.temperament === 'cutthroat' ? 'They never attack unless attacked, and stay at their post.' : 'They never attack unless attacked. They keep looting.', cond: st !== 'hired' && st !== 'truce', why: st === 'truce' ? 'You already have a truce.' : 'They work for you now.' });
    for (const job of ['winch', 'open', 'scout'] as const)
      add({ deal: 'job', job, label: job === 'winch' ? 'Job: work the winch' : job === 'open' ? 'Job: open a lock' : 'Job: scout ahead', price: p(30), text: job === 'winch' ? 'They walk to the winch on this level and work it: the lift runs.' : job === 'open' ? 'They open the nearest seen locked door or chest on this level, silently.' : 'Every hex within 8 of each of them is explored now.', cond: ['neutral', 'truce', 'waiting'].includes(st), why: st === 'demanding' ? 'Pay the toll first.' : st === 'hostile' ? 'They are fighting you.' : 'Not now.' });
    add({ deal: 'hire', label: 'Hire them', price: p(60), text: 'They fight beside you for 5 rounds, keeping within 2 of the hero who hired them.', risk: total >= 150 ? 'You carry 150+ in loot: 1 in 4 they turn on you when the 5 rounds end.' : 'You carry under 150 in loot: they will not turn on you.', cond: st !== 'hostile' && st !== 'hired', why: st === 'hired' ? 'Already hired.' : 'They are fighting you. Buy a truce first.' });
    add({ deal: 'fight', label: 'Fight', price: 0, text: 'They turn hostile now.', cond: st !== 'hostile', why: 'Already fighting.' });
    return out;
  };
  const lit = (s: GameState): Set<string> => {
    const d = s.delve!;
    const out = new Set<string>();
    const b = d.heroes.find((h) => h.heroId === d.lanternBearer)!;
    const r = d.lanternOpen === false ? 0 : d.light > 36 ? 4 : d.light >= 19 ? 3 : d.light >= 1 ? 2 : 0;
    if (r > 0) for (const h of range(b.at, r)) out.add(posKey({ level: b.at.level, ...h }));
    for (const h of d.heroes) if (h.torch > 0) for (const x of range(h.at, 2)) out.add(posKey({ level: h.at.level, ...x }));
    for (const k of d.lit) {
      const [l, rest] = k.split(':');
      const [q, rr] = rest!.split(',').map(Number);
      for (const x of range({ q: q!, r: rr! }, 3)) out.add(`${l}:${hexKey(x)}`);
    }
    return out;
  };
  /** V3.7 (20.5): calm when nothing hunts a hero's level, no crew is hostile or demanding, no fuse burns, nobody is downed/held/webbed/rooted. */
  const calmOf = (s: GameState): { calm: boolean; why?: string } => {
    const d = s.delve;
    if (!d) return { calm: false };
    const levels = new Set(d.heroes.filter((h) => h.status === 'active').map((h) => h.at.level));
    const hunter = d.monsters.find((m) => m.hp > 0 && m.awareness === 'hunting' && levels.has(m.at.level));
    if (hunter) return { calm: false, why: `${hunter.name} hunts the party.` };
    if (d.rivals && (d.rivals.stance === 'hostile' || d.rivals.stance === 'demanding')) return { calm: false, why: `${d.rivals.name} ${d.rivals.stance === 'hostile' ? 'are fighting you' : 'demand a toll'}.` };
    if (d.monsters.some((m) => m.kind === 'gloam')) return { calm: false, why: 'The dark is awake.' };
    if (d.fuses?.length) return { calm: false, why: 'A fuse is burning.' };
    const bad = d.heroes.find((h) => h.status === 'downed' || h.grabbedBy || h.webbed || (h.rooted ?? 0) > 0);
    if (bad) return { calm: false, why: `${s.campaign.roster.find((x) => x.id === bad.heroId)?.name ?? bad.heroId} is ${bad.status === 'downed' ? 'down' : bad.grabbedBy ? 'held' : bad.webbed ? 'webbed' : 'rooted'}.` };
    return { calm: true };
  };
  const eng: Engine = {
    castle: () => castle,
    calm: (s) => calmOf(s),
    calmReach: (s, heroId, sneak) => {
      if (!calmOf(s).calm) return [];
      const vis = visInner(s);
      return [...longPaths(castle, s, vis, heroId, 60).entries()].map(([, path]) => ({ to: path[path.length - 1]!, cost: path.length, path, risks: risksFor(s, heroId, path, !!sneak) }));
    },
    blastPreview: (s, at) => {
      const pv = blastPreview(castle, s.delve ?? null, at);
      const d = s.delve;
      const hit = d ? [...d.heroes.filter((h) => h.status === 'active' && h.at.level === at.level && distance(h.at, at) <= 2).map((h) => h.heroId), ...d.monsters.filter((m) => m.hp > 0 && m.at.level === at.level && distance(m.at, at) <= 2).map((m) => m.id)] : [];
      return { broke: pv.breaks, collapsed: pv.collapses, rubbled: pv.rubbles, hit };
    },
    newGame: (seed) => {
      const c = fixtureCampaign();
      pinStories(c);
      return { version: 3, seed, rng: seed, stage: 'camp', campaign: c, delve: null, summary: null };
    },
    apply(state: GameState, cmd: Command): ApplyResult {
      const res = applyInner(state, cmd);
      // The fixture writes the V3.7 lines into the delve log too (the real engine says them itself).
      if (res.state.delve && !res.error) {
        const name = (id: string) => res.state.campaign.roster.find((h) => h.id === id)?.name ?? res.state.delve!.monsters.find((m) => m.id === id)?.name ?? res.state.delve!.rivals?.members.find((r) => r.id === id)?.name ?? id;
        for (const e of res.events) {
          if (e.type === 'swing') res.state.delve.log.push(`${name(e.by)} gets a free swing at ${name(e.target)}.`);
          else if (e.type === 'fuseSet') res.state.delve.log.push(`${name(e.by)} sets a charge. Fuse ${e.rounds}. Stand clear.`);
          else if (e.type === 'blast' && 'broke' in e) res.state.delve.log.push(`${name(e.by)}'s charge goes off. BOOM.${e.broke.length ? ' The wall comes down.' : ''}`);
          else if (e.type === 'feared') res.state.delve.log.push(`${name(e.id)} is seized by dread and turns to run.`);
          else if (e.type === 'woke') res.state.delve.log.push(`${name(e.id)} stirs as ${name(e.by)} passes.`);
        }
      }
      return res;
    },
    reachable(state, heroId, sneak): Reach[] {
      return reachInner(state, heroId, sneak);
    },
    actions(state, heroId): ActionOption[] {
      return actionsInner(state, heroId);
    },
    preview(_s, heroId, action: ActionKind, _t: ActionTarget): RollPreview {
      return previewInner(_s, heroId, action, _t);
    },
    visibility(state): Visibility {
      const v = visInner(state);
      noteSeen(state, v.visible);
      return v;
    },
    seenEnemies(state) {
      noteSeen(state, visInner(state).visible);
      const d = state.delve;
      const alive = new Set([...(d?.monsters ?? []).filter((m) => m.hp > 0).map((m) => m.id), ...(d?.rivals?.members ?? []).filter((r) => r.hp > 0).map((r) => r.id)]);
      return new Set([...seenIds].filter((id) => alive.has(id)));
    },
    brightness: (s) => {
      const L = s.delve?.light ?? 60;
      return L > 36 ? 'bright' : L >= 19 ? 'dim' : L >= 1 ? 'dark' : 'pitch';
    },
    intents(state) {
      return intentsInner(state);
    },
    moveNoise: (_s, _h, sneak) => (sneak ? 0 : 1),
    sightRange(s, heroId) {
      const h = s.delve?.heroes.find((x) => x.heroId === heroId);
      const level = h?.at.level ?? 1;
      if (h && !eng.heroLit(s, heroId)) return level === 1 ? 4 : level === 2 ? 2 : 1;
      return Math.max(2, (eng.brightness(s) === 'bright' ? 8 : eng.brightness(s) === 'dim' ? 6 : eng.brightness(s) === 'dark' ? 4 : 2) - (level - 1));
    },
    heroLit(s, heroId) {
      const h = s.delve?.heroes.find((x) => x.heroId === heroId);
      return !!h && lit(s).has(posKey(h.at));
    },
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
    shop: (s) => shopFor(s),
    ales: (s) => alesFor(s),
    deals: (s, heroId) => dealsFor(s, heroId),
    heroById: (s, id) => s.campaign.roster.find((h) => h.id === id),
    classInfo: (cls) => ({ name: cls, role: '', weapon: '', armor: 0, mana: 0, abilities: [] }),
    partyProblem: () => null,
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
  function applyInner(state: GameState, cmd: Command): ApplyResult {
      const s = structuredClone(state);
      if (cmd.type === 'newCampaign') return { state: eng.newGame(cmd.seed), events: [] };
      if (cmd.type === 'drink') {
        const hr = s.campaign.roster.find((x) => x.id === cmd.heroId);
        const pot = s.campaign.stash.findIndex((i) => i.kind === 'potion');
        if (!hr || pot < 0) return { state, events: [], error: 'No potion in the stash.' };
        if (hr.hp >= hr.maxHp) return { state, events: [], error: `${hr.name} is unhurt.` };
        s.campaign.stash.splice(pot, 1);
        const r = s.campaign.roster.find((x) => x.id === cmd.heroId)!;
        r.hp = Math.min(r.maxHp, r.hp + 5);
        return { state: s, events: [] };
      }
      if (cmd.type === 'heal') {
        if (!s.campaign.village.surgeon) return { state, events: [], error: 'No surgeon in Lowgate. Rescue Brother Aldric (Level 1, the chapel).' };
        const r = s.campaign.roster.find((x) => x.id === cmd.heroId)!;
        const hp = Math.min(r.maxHp - r.hp, Math.floor(s.campaign.gold / 3));
        r.hp += hp;
        s.campaign.gold -= hp * 3;
        return { state: s, events: [] };
      }
      if (cmd.type === 'upgrade') {
        if (!s.campaign.village.smith) return { state, events: [], error: 'The forge is cold. Rescue Gerda the smith (Level 2, the forge).' };
        const r = s.campaign.roster.find((x) => x.id === cmd.heroId)!;
        if (cmd.part === 'weapon') r.weaponTier++;
        else r.armorTier++;
        return { state: s, events: [] };
      }
      if (cmd.type === 'buyShield') {
        if (!s.campaign.village.smith) return { state, events: [], error: 'The forge is cold. Rescue Gerda the smith (Level 2, the forge).' };
        const r = s.campaign.roster.find((x) => x.id === cmd.heroId);
        if (!r) return { state, events: [], error: 'No such hero.' };
        if (r.shield) return { state, events: [], error: `${r.name} already carries a shield.` };
        if (s.campaign.gold < 50) return { state, events: [], error: 'Not enough gold.' };
        s.campaign.gold -= 50;
        r.shield = true;
        return { state: s, events: [] };
      }
      if (cmd.type === 'buyAle') {
        const a = alesFor(s).find((x) => x.kind === cmd.ale);
        const r = s.campaign.roster.find((x) => x.id === cmd.heroId);
        if (!a || !r) return { state, events: [], error: 'No such ale.' };
        if (a.locked) return { state, events: [], error: a.locked };
        if (r.ale) return { state, events: [], error: `${r.name} already has an ale waiting.` };
        if (s.campaign.gold < a.price) return { state, events: [], error: 'Not enough gold.' };
        s.campaign.gold -= a.price;
        r.ale = a.kind;
        return { state: s, events: [] };
      }
      if (cmd.type === 'hire') {
        const i = s.campaign.recruits.findIndex((r) => r.hero.id === cmd.heroId);
        if (i < 0) return { state, events: [], error: 'Gone.' };
        const r = s.campaign.recruits[i]!;
        if (s.campaign.gold < r.price) return { state, events: [], error: 'Not enough gold.' };
        s.campaign.gold -= r.price;
        s.campaign.roster.push(r.hero);
        s.campaign.recruits.splice(i, 1);
        return { state: s, events: [] };
      }
      if (cmd.type === 'deal' && s.delve?.rivals) {
        const o = dealsFor(state, cmd.heroId).find((x) => x.deal === cmd.deal && x.job === cmd.job);
        if (!o) return { state, events: [], error: 'Nobody to deal with.' };
        if (!o.ok) return { state, events: [], error: o.blocked ?? 'Not now.' };
        const r = s.delve.rivals;
        const was = r.stance;
        r.stance = cmd.deal === 'leave' ? 'bribed' : cmd.deal === 'truce' ? 'truce' : cmd.deal === 'hire' ? 'hired' : cmd.deal === 'fight' ? 'hostile' : r.stance;
        if (cmd.deal === 'hire') r.hiredRounds = 5;
        if (cmd.deal === 'leave') r.goal = 'leave';
        for (const m of r.members) m.intent = cmd.deal === 'fight' ? { kind: 'attack', targetId: cmd.heroId, damage: [0, 4] } : undefined;
        const paid = o.pays ? [o.pays] : [];
        // Take the coins (fixture: gold only, then valuables) from the packs.
        let left = o.price;
        for (const hd of s.delve.heroes) {
          for (const it of [...hd.pack]) {
            if (left <= 0 || !PAYABLE.includes(it.kind)) continue;
            if (it.kind === 'gold' && it.amount > left) {
              it.amount -= left;
              left = 0;
            } else {
              left -= it.amount;
              hd.pack = hd.pack.filter((x) => x !== it);
            }
          }
        }
        const ev: ApplyResult['events'] = [{ type: 'deal', deal: cmd.deal, job: cmd.job, price: o.price, paid }];
        if (r.stance !== was) ev.push({ type: 'rivalsStance', stance: r.stance });
        return { state: s, events: ev };
      }
      if (cmd.type === 'startDelve') {
        const st = fixtureDelve(castle);
        st.campaign = structuredClone(state.campaign);
        const k = st.campaign.board.find((x) => x.id === cmd.contractId);
        if (k) st.delve!.contract = k;
        for (const hd of st.delve!.heroes) {
          const r = st.campaign.roster.find((x) => x.id === hd.heroId);
          hd.ale = r?.ale === 'blackcask' ? 'hiccups' : r?.ale;
          if (r) delete r.ale;
        }
        return { state: st, events: [{ type: 'say', text: 'The party enters.' }] };
      }
      if (cmd.type === 'buy') {
        const o = shop.find((x) => x.kind === cmd.kind)!;
        if (s.campaign.gold < o.price) return { state, events: [], error: 'Not enough gold.' };
        s.campaign.gold -= o.price;
        s.campaign.stash.push(item(`b${Date.now()}`, o.kind, o.name));
        return { state: s, events: [] };
      }
      if (cmd.type === 'face' && s.delve) {
        // V3.9 (24.2): free, unlimited in the player phase.
        const h = s.delve.heroes.find((x) => x.heroId === cmd.heroId);
        if (!h || h.status !== 'active') return { state, events: [], error: 'No such hero.' };
        if (s.delve.phase !== 'player') return { state, events: [], error: 'Not now.' };
        const f = ((Math.round(cmd.facing) % 6) + 6) % 6;
        if (h.facing === f) return { state: s, events: [] };
        h.facing = f;
        return { state: s, events: [{ type: 'faced', id: h.heroId, facing: f }] };
      }
      if (cmd.type === 'move' && s.delve && calmOf(state).calm && cmd.path.length > 0) {
        // V3.7 (20.5): free move: the whole path, the castle turning every 4 steps, followers in file.
        const d = s.delve;
        const h = d.heroes.find((x) => x.heroId === cmd.heroId)!;
        const ev: ApplyResult['events'] = [];
        const followers = cmd.follow ? d.heroes.filter((o) => o !== h && o.status === 'active' && o.at.level === h.at.level && distance(o.at, h.at) <= 3) : [];
        const trail: Pos[] = [h.at];
        let walked: Pos[] = [];
        let stopped: string | undefined;
        const risks = risksFor(state, cmd.heroId, cmd.path, !!cmd.sneak);
        for (const step of cmd.path) {
          h.at = step;
          trail.push(step);
          walked.push(step);
          d.calmSteps = (d.calmSteps ?? 0) + 1;
          const woke = risks.wake.find((w) => samePos(w.at, step) && w.chance >= 50);
          if (woke) {
            const m = d.monsters.find((x) => x.id === woke.id);
            if (m) {
              m.awareness = 'hunting';
              m.facing = facingToward(m.at, h.at);
              stopped = `${m.name} wakes and has seen ${s.campaign.roster.find((x) => x.id === h.heroId)?.name ?? h.heroId}.`;
              ev.push({ type: 'moved', id: cmd.heroId, path: walked }, { type: 'woke', id: m.id, by: cmd.heroId }, { type: 'noticed', by: m.id, hero: cmd.heroId });
              walked = [];
              break;
            }
          }
          if (d.calmSteps % 4 === 0) {
            ev.push({ type: 'moved', id: cmd.heroId, path: walked });
            walked = [];
            followers.forEach((f, i) => {
              const spot = trail[Math.max(0, trail.length - 2 - i)]!;
              if (!samePos(f.at, spot)) ev.push({ type: 'moved', id: f.heroId, path: [spot] });
              f.at = spot;
            });
            d.round++;
            d.light = Math.max(0, d.light - 1);
            ev.push({ type: 'phase', phase: 'world', round: d.round - 1 }, { type: 'light', light: d.light, brightness: eng.brightness(s) }, { type: 'phase', phase: 'player', round: d.round });
          }
        }
        if (walked.length) ev.push({ type: 'moved', id: cmd.heroId, path: walked });
        const calmF = pathEndFacing(trail[Math.max(0, trail.length - 2)]!, [trail[trail.length - 1]!], h.facing);
        if (calmF !== undefined && calmF !== h.facing) {
          h.facing = calmF;
          ev.push({ type: 'faced', id: cmd.heroId, facing: calmF });
        }
        followers.forEach((f, i) => {
          const spot = trail[Math.max(0, trail.length - 2 - i)]!;
          if (!samePos(f.at, spot)) ev.push({ type: 'moved', id: f.heroId, path: [spot] });
          f.at = spot;
        });
        for (const k of lit(s)) if (!d.explored.includes(k)) d.explored.push(k);
        if (stopped) {
          for (const o of d.heroes) o.moved = o.acted = o.dashed = false;
          ev.push({ type: 'calm', calm: false, why: stopped });
        }
        return { state: s, events: ev };
      }
      if (cmd.type === 'move' && s.delve) {
        const h = s.delve.heroes.find((x) => x.heroId === cmd.heroId)!;
        const risks = risksFor(state, cmd.heroId, cmd.path, !!cmd.sneak);
        const ev: ApplyResult['events'] = [];
        // V3.7 (20.2): free swings as the hero leaves reach, before the move plays.
        for (const sw of risks.swings) {
          const hits = sw.id.startsWith('m') ? 1 : 0;
          const damage = hits ? Math.max(1, sw.damage[1] - 1) : 0;
          ev.push({ type: 'swing', by: sw.id, target: cmd.heroId, hits, damage });
          ev.push(hits ? { type: 'hit', attacker: sw.id, target: cmd.heroId, damage, crit: false } : { type: 'miss', attacker: sw.id, target: cmd.heroId });
          if (damage) h.hp = Math.max(1, h.hp - damage);
        }
        const startAt = h.at;
        h.at = cmd.path[cmd.path.length - 1]!;
        const endF = pathEndFacing(startAt, cmd.path, h.facing);
        if (endF !== undefined) h.facing = endF;
        if (h.moved) {
          h.dashed = true;
          h.acted = true;
        }
        h.moved = true;
        for (const k of lit(s)) if (!s.delve.explored.includes(k)) s.delve.explored.push(k);
        ev.push({ type: 'moved', id: cmd.heroId, path: cmd.path });
        if (endF !== undefined) ev.push({ type: 'faced', id: cmd.heroId, facing: endF });
        ev.push({ type: 'noise', at: h.at, radius: cmd.sneak ? 0 : 1 });
        // 20.1: wake rolls (the fixture wakes at 50%+) and noticing.
        for (const w of risks.wake) {
          if (w.chance < 50) continue;
          const m = s.delve.monsters.find((x) => x.id === w.id);
          if (!m) continue;
          m.awareness = 'alert';
          m.facing = facingToward(m.at, h.at);
          ev.push({ type: 'woke', id: m.id, by: cmd.heroId });
        }
        for (const n of risks.notice) {
          const m = s.delve.monsters.find((x) => x.id === n.id);
          if (!m) continue;
          m.awareness = 'hunting';
          m.facing = facingToward(m.at, h.at);
          ev.push({ type: 'noticed', by: m.id, hero: cmd.heroId });
        }
        return { state: s, events: ev };
      }
      if (cmd.type === 'endTurn' && s.delve) {
        const d = s.delve;
        const ev: ApplyResult['events'] = [{ type: 'phase', phase: 'world', round: d.round }];
        // V3.7 (20.2): feared figures run; the fear wears off.
        for (const m of d.monsters) {
          if (!m.feared) continue;
          const from = d.heroes.find((x) => x.heroId === m.fearOf)?.at ?? m.at;
          const away = posNeighbors(m.at).filter((p) => walk(s, p) && !d.heroes.some((x) => samePos(x.at, p))).sort((a, b) => distance(b, from) - distance(a, from))[0];
          if (away) {
            const path = [away];
            const next = posNeighbors(away).filter((p) => walk(s, p) && !d.heroes.some((x) => samePos(x.at, p))).sort((a, b) => distance(b, from) - distance(a, from))[0];
            if (next) path.push(next);
            // Heroes it leaves get a free swing.
            for (const hx of d.heroes) if (hx.status === 'active' && !hx.acted && distance(hx.at, m.at) === 1 && distance(hx.at, path[path.length - 1]!) > 1) {
              m.hp -= 1;
              ev.push({ type: 'swing', by: hx.heroId, target: m.id, hits: 1, damage: 1 });
            }
            m.at = path[path.length - 1]!;
            ev.push({ type: 'moved', id: m.id, path });
          }
          m.feared--;
          if (!m.feared) delete m.fearOf;
          if (m.hp <= 0) ev.push({ type: 'monsterDied', id: m.id });
        }
        d.monsters = d.monsters.filter((m) => m.hp > 0);
        // V3.9 (24.2): an awake, unfeared monster next to a hero strikes it; from the hero's rear half it is
        // blindsided, and when no hero can see the attacker the hit lands as `unseenHit`.
        {
          const seenNow = visInner(state).visible;
          for (const m of d.monsters) {
            if (m.awareness === 'asleep' || m.feared || m.kind === 'dragon' || m.kind === 'gloam') continue;
            const hx = d.heroes.find((x) => x.status === 'active' && x.at.level === m.at.level && distance(x.at, m.at) === 1);
            if (!hx) continue;
            m.facing = dirToward(m.at, hx.at);
            const blind = hx.facing !== undefined && !inFrontHalf(hx.at, hx.facing, m.at);
            const dmg = blind ? 3 : 2;
            if (!seenNow.has(posKey(m.at))) {
              ev.push({ type: 'say', text: `Something strikes ${s.campaign.roster.find((x) => x.id === hx.heroId)?.name ?? hx.heroId} from behind.` }, { type: 'unseenHit', target: hx.heroId });
            }
            ev.push({ type: 'hit', attacker: m.id, target: hx.heroId, damage: dmg, crit: false });
            hx.hp = Math.max(1, hx.hp - dmg);
          }
        }
        // 20.3: fuses burn down; at 0 the charge goes off.
        const left: typeof d.fuses = [];
        for (const f of d.fuses ?? []) {
          f.rounds--;
          if (f.rounds > 0) {
            left.push(f);
            continue;
          }
          const rings = blastRings(castle, f.at);
          const pv = blastPreview(castle, d, f.at);
          const broke = pv.breaks;
          for (const p of [...pv.breaks, ...pv.rubbles]) d.blown.push(posKey(p));
          d.collapsed = [...(d.collapsed ?? []), ...pv.collapses.map((p) => posKey(p))];
          for (const p of rings.inner) {
            const door = d.doors[posKey(p)];
            if (door?.locked) {
              door.locked = false;
              door.open = true;
              ev.push({ type: 'doorChanged', at: p, open: true, locked: false });
            }
          }
          const setter = s.campaign.roster.some((h) => h.id === f.by);
          for (const hx of d.heroes) {
            if (hx.status !== 'active' || hx.at.level !== f.at.level) continue;
            const dist = distance(hx.at, f.at);
            const base = dist <= 1 ? 4 : dist === 2 ? 2 : 0;
            const dmg = hx.heroId === f.by ? 0 : setter ? Math.floor(base / 2) : base;
            if (dmg) {
              hx.hp = Math.max(1, hx.hp - dmg);
              ev.push({ type: 'hit', attacker: f.by, target: hx.heroId, damage: dmg, crit: false });
            }
          }
          for (const m of d.monsters) {
            if (m.at.level !== f.at.level) continue;
            const dist = distance(m.at, f.at);
            const dmg = dist <= 1 ? 4 : dist === 2 ? 2 : 0;
            if (!dmg) continue;
            m.hp -= dmg;
            ev.push({ type: 'hit', attacker: f.by, target: m.id, damage: dmg, crit: false });
            if (m.hp <= 0) ev.push({ type: 'monsterDied', id: m.id });
          }
          d.monsters = d.monsters.filter((m) => m.hp > 0);
          ev.push({ type: 'blast', at: f.at, by: f.by, broke, collapsed: pv.collapses, rubbled: pv.rubbles }, { type: 'noise', at: f.at, radius: 8 });
          // 20.3a: whoever stood on collapsed floor falls by the column rules.
          for (const hx of d.heroes) {
            const c = pv.collapses.find((p) => samePos(p, hx.at));
            if (!c || hx.status !== 'active') continue;
            const f2 = fallFrom(castle, c) ?? fallFrom({ ...castle, levels: castle.levels.map((l) => (l.level === c.level ? { ...l, tiles: { ...l.tiles, [hexKey(c)]: { kind: 'pit' } } } : l)) }, c);
            if (!f2) continue;
            hx.hp = Math.max(1, hx.hp - f2.damage);
            const from = hx.at;
            hx.at = f2.to;
            ev.push({ type: 'fell', id: hx.heroId, from, to: f2.to, levels: f2.levels, damage: f2.damage });
          }
        }
        d.fuses = left;
        d.round++;
        d.light = Math.max(0, d.light - 1);
        const wasCalm = calmOf(state).calm;
        for (const h of d.heroes) {
          h.moved = h.acted = h.dashed = false;
          if (h.nightEyes) h.nightEyes--;
          if (h.rooted) h.rooted--;
          delete h.braced;
        }
        for (const m of d.monsters) if (m.stuck) m.stuck--;
        ev.push({ type: 'light', light: d.light, brightness: eng.brightness(s) }, { type: 'phase', phase: 'player', round: d.round });
        const nowCalm = calmOf(s);
        if (nowCalm.calm !== wasCalm) ev.push({ type: 'calm', calm: nowCalm.calm, why: nowCalm.why });
        return { state: s, events: ev };
      }
      if (cmd.type === 'act' && s.delve) {
        const h = s.delve.heroes.find((x) => x.heroId === cmd.heroId)!;
        h.acted = true;
        if (cmd.action === 'shutter') {
          h.acted = false;
          s.delve.lanternOpen = !s.delve.lanternOpen;
          return { state: s, events: [{ type: 'shutter', open: s.delve.lanternOpen }] };
        }
        if (cmd.action === 'leave') {
          h.acted = false;
          h.status = 'out';
          const left = s.delve.heroes.filter((x) => x.status === 'active');
          if (!left.length) {
            s.stage = 'summary';
            s.summary = { contractDone: s.delve.heroes.some((x) => x.pack.some((i) => i.kind === 'heirloom')), bounty: 0, lootValue: 0, survivors: s.delve.heroes.map((x) => x.heroId), wounded: [], dead: [], xp: {}, levelUps: [], notes: [] };
          }
          return { state: s, events: [{ type: 'say', text: `${h.heroId} leaves the castle.` }] };
        }
        // V3.7 (20.3): set or throw a charge: a fuse on the hex, nothing else yet.
        if ((cmd.action === 'setCharge' || cmd.action === 'throwCharge' || cmd.action === 'charge') && cmd.target.at) {
          const sat = h.pack.find((i) => i.kind === 'charge');
          if (sat) {
            if (sat.slots === 0 && sat.amount > 1) {
              sat.amount--;
              sat.name = `Satchel: ${sat.amount} charge${sat.amount === 1 ? '' : 's'}`;
            } else h.pack = h.pack.filter((i) => i !== sat);
          }
          const rounds = cmd.action === 'setCharge' ? (cmd.target.fuse ?? 1) : 1;
          s.delve.fuses = [...(s.delve.fuses ?? []).filter((f) => !samePos(f.at, cmd.target.at!)), { at: cmd.target.at, rounds, by: h.heroId }];
          const ev: ApplyResult['events'] = [];
          if (cmd.action === 'throwCharge') ev.push({ type: 'thrown', by: h.heroId, kind: 'charge', from: h.at, to: cmd.target.at });
          ev.push({ type: 'fuseSet', at: cmd.target.at, rounds, by: h.heroId }, { type: 'say', text: `${s.campaign.roster.find((x) => x.id === h.heroId)?.name ?? h.heroId} sets a charge: fuse ${rounds}.` });
          return { state: s, events: ev };
        }
        // V3.7 (20.5): Brace, Hamstring, Night thorn, Briar, Smash a crate.
        if (cmd.action === 'brace') {
          h.braced = true;
          return { state: s, events: [{ type: 'braced', id: h.heroId }] };
        }
        if ((cmd.action === 'hamstring' || cmd.action === 'briar' || cmd.action === 'nightthorn') && cmd.target.id) {
          const m = s.delve.monsters.find((x) => x.id === cmd.target.id) ?? s.delve.rivals?.members.find((x) => x.id === cmd.target.id);
          if (!m) return { state, events: [], error: 'Nothing there.' };
          if (cmd.action !== 'hamstring') h.mana = Math.max(0, h.mana - 1);
          const ev: ApplyResult['events'] = [
            { type: 'cast', by: h.heroId, spell: cmd.action, targetId: m.id },
            { type: 'roll', who: h.heroId, what: cmd.action === 'hamstring' ? 'Hamstring' : cmd.action === 'briar' ? 'Briar' : 'Night thorn', roll: { slots: cmd.action === 'hamstring' ? 1 : 2, chance: cmd.action === 'hamstring' ? 55 : 70, focus: cmd.focus, results: cmd.action === 'hamstring' ? [true] : [true, false], hits: 1, perfect: cmd.action === 'hamstring' } },
          ];
          if (cmd.action !== 'hamstring') {
            m.hp -= 1;
            ev.push({ type: 'hit', attacker: h.heroId, target: m.id, damage: 1, crit: false });
          }
          if (cmd.action !== 'nightthorn') {
            const rounds = cmd.action === 'hamstring' ? 2 : 1;
            if ('awareness' in m) m.stuck = rounds;
            ev.push({ type: 'rooted', id: m.id, by: h.heroId, rounds });
          }
          if (m.hp <= 0) {
            s.delve.monsters = s.delve.monsters.filter((x) => x !== m);
            ev.push({ type: 'monsterDied', id: m.id });
          }
          return { state: s, events: ev };
        }
        if (cmd.action === 'smashProp' && cmd.target.at) {
          const k = posKey(cmd.target.at);
          s.delve.smashed = [...(s.delve.smashed ?? []), k];
          const roll = (cmd.target.at.q * 7 + cmd.target.at.r * 13 + s.delve.round) % 10;
          const items: Item[] = roll < 6 ? [item(`sm${k}`, 'gold', 'Gold', 3 + (roll * 3) % 10)] : roll < 8 ? [item(`sm${k}`, roll === 6 ? 'torch' : 'potion', roll === 6 ? 'Torch' : 'Potion')] : [];
          if (items.length) s.delve.ground.push({ at: cmd.target.at, items });
          return { state: s, events: [{ type: 'propSmashed', at: cmd.target.at, by: h.heroId, items }, { type: 'noise', at: cmd.target.at, radius: 4 }, { type: 'say', text: `${s.campaign.roster.find((x) => x.id === h.heroId)?.name ?? h.heroId} smashes the ${tile(cmd.target.at)?.prop ?? 'crate'}.` }] };
        }
        // 20.2: Dread: 2 Wits slots; the fixture always lands one.
        if (cmd.action === 'dread' && cmd.target.id) {
          const m = s.delve.monsters.find((x) => x.id === cmd.target.id) ?? s.delve.rivals?.members.find((x) => x.id === cmd.target.id);
          if (!m) return { state, events: [], error: 'Nothing to dread.' };
          h.mana = Math.max(0, h.mana - 1);
          m.feared = 2;
          m.fearOf = h.heroId;
          if ('awareness' in m && m.awareness === 'asleep') m.awareness = 'alert';
          m.intent = { kind: 'flee', targetId: h.heroId };
          return {
            state: s,
            events: [
              { type: 'cast', by: h.heroId, spell: 'dread', targetId: m.id },
              { type: 'roll', who: h.heroId, what: 'Dread', roll: { slots: 2, chance: 70, focus: cmd.focus, results: [true, false], hits: 1, perfect: false } },
              { type: 'feared', id: m.id, by: h.heroId },
            ],
          };
        }
        if (cmd.action === 'nightsight') {
          h.nightEyes = 8;
          h.pack = h.pack.filter((i) => i.kind !== 'nightsight');
          return { state: s, events: [{ type: 'say', text: 'The draught goes down. The dark thins.' }] };
        }
        if (cmd.action === 'attack' && cmd.target.id) {
          const m = s.delve.monsters.find((x) => x.id === cmd.target.id)!;
          // V3.9 (24.3): a Burglar from the rear half on an unaware target: +1 slot, double damage.
          const stab = backstabFrom(state, cmd.heroId, m.id, h.at);
          const results = stab ? [true, false, true, true] : [true, false, true];
          const dmg = stab ? 6 : 2;
          m.hp -= dmg;
          const ev: ApplyResult['events'] = [];
          const f = dirToward(h.at, m.at);
          if (h.facing !== f) {
            h.facing = f;
            ev.push({ type: 'faced', id: h.heroId, facing: f });
          }
          if (m.awareness === 'asleep') m.awareness = 'hunting';
          ev.push(
            { type: 'roll', who: cmd.heroId, what: stab ? 'Backstab' : 'Attack', roll: { slots: results.length, chance: 55, focus: cmd.focus, results, hits: stab ? 3 : 2, perfect: false } },
            { type: 'hit', attacker: cmd.heroId, target: m.id, damage: dmg, crit: false },
          );

          if (m.hp <= 0) {
            s.delve.monsters = s.delve.monsters.filter((x) => x !== m);
            ev.push({ type: 'monsterDied', id: m.id });
          }
          return { state: s, events: ev };
        }
        return { state: s, events: [{ type: 'say', text: `${cmd.action}: not in the fixture engine.` }] };
      }
      if (cmd.type === 'abandon' || cmd.type === 'backToCamp') {
        const story = s.delve?.contract.story;
        s.stage = 'camp';
        s.delve = null;
        // Fixture: a story contract counts as done on the way home (`?fixture=1` only).
        if (cmd.type === 'backToCamp' && story && !s.campaign.village[story]) {
          s.campaign.village[story] = true;
          s.campaign.reputation++;
          pinStories(s.campaign);
          return { state: s, events: [{ type: 'villageUnlocked', story }] };
        }
        return { state: s, events: [] };
      }
      return { state, events: [], error: 'The fixture engine does not do that.' };
  }
  function reachInner(state: GameState, heroId: string, sneak?: boolean): Reach[] {
    {
      const d = state.delve!;
      const h = d.heroes.find((x) => x.heroId === heroId)!;
      if (h.moved && (h.acted || h.dashed)) return [];
      const dash = h.moved;
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
      return [...seen.values()]
        .filter((r) => r.cost > 0 && !d.heroes.some((o) => o.status === 'active' && samePos(o.at, r.to)))
        .map((r) => ({ ...r, dash: dash || undefined, risks: risksFor(state, heroId, r.path, !!sneak) }));
    }
  }
  function actionsInner(state: GameState, heroId: string): ActionOption[] {
    {
      const d = state.delve!;
      const h = d.heroes.find((x) => x.heroId === heroId)!;
      const out: ActionOption[] = [];
      // Leaving is free (V3.6 19.5): offered on an exit whatever else is spent.
      if (tile(h.at)?.kind === 'exit') out.push({ action: 'leave', label: 'Leave castle', targets: [{ at: h.at }], rolls: false, pick: 'self' });
      if (h.acted) {
        const crew = d.rivals?.members.filter((m) => m.hp > 0 && !m.goneOut && m.at.level === h.at.level && distance(m.at, h.at) <= 4) ?? [];
        if (crew.length) out.push({ action: 'parley', label: 'Parley', targets: crew.map((m) => ({ id: m.id, at: m.at })), rolls: false, pick: 'enemy' });
        return out;
      }
      const adj = d.monsters.filter((m) => distance(m.at, h.at) === 1 && m.at.level === h.at.level);
      if (adj.length) out.push({ action: 'attack', label: 'Attack', targets: adj.map((m) => ({ id: m.id, at: m.at })), rolls: true, pick: 'enemy' });
      const cls = state.campaign.roster.find((x) => x.id === heroId)?.cls;
      // V3.7 (20.5)
      if ((cls === 'heir' || cls === 'sellsword' || cls === 'sapper') && !h.braced) out.push({ action: 'brace', label: 'Brace', targets: [{ id: h.heroId }], rolls: false, pick: 'self' });
      const inRange = (n: number) => [...d.monsters.filter((m) => m.kind !== 'dragon' && m.kind !== 'gloam'), ...(d.rivals?.members ?? [])].filter((m) => m.hp > 0 && distance(m.at, h.at) <= n && m.at.level === h.at.level);
      if (cls === 'ranger' && inRange(5).length) out.push({ action: 'hamstring', label: 'Hamstring', targets: inRange(5).map((m) => ({ id: m.id, at: m.at })), rolls: true, pick: 'enemy' });
      if (cls === 'shadowmancer' && inRange(5).length) out.push({ action: 'nightthorn', label: 'Night thorn', targets: inRange(5).map((m) => ({ id: m.id, at: m.at })), rolls: true, pick: 'enemy', mana: 1, blocked: h.mana < 1 ? 'No mana left.' : undefined });
      if (cls === 'hedgewitch' && inRange(4).length) out.push({ action: 'briar', label: 'Briar', targets: inRange(4).map((m) => ({ id: m.id, at: m.at })), rolls: true, pick: 'enemy', mana: 1, blocked: h.mana < 1 ? 'No mana left.' : undefined });
      const crates = posNeighbors(h.at).filter((p) => { const t = tile(p); return t?.kind === 'prop' && (t.prop === 'crate' || t.prop === 'barrel') && !(d.smashed ?? []).includes(posKey(p)); });
      if (crates.length) out.push({ action: 'smashProp', label: 'Smash', targets: crates.map((at) => ({ at })), rolls: false, pick: 'hex' });
      if (cls === 'shadowmancer') {
        const far = [...d.monsters.filter((m) => m.kind !== 'dragon' && m.kind !== 'gloam'), ...(d.rivals?.members ?? [])].filter((m) => m.hp > 0 && distance(m.at, h.at) <= 5 && m.at.level === h.at.level);
        if (far.length) out.push({ action: 'dread', label: 'Dread', targets: far.map((m) => ({ id: m.id, at: m.at })), rolls: true, pick: 'enemy', mana: 1, blocked: h.mana < 1 ? 'No mana left.' : undefined });
        const sleepers = d.monsters.filter((m) => m.awareness !== 'asleep' && m.kind !== 'dragon' && distance(m.at, h.at) <= 5 && m.at.level === h.at.level);
        if (sleepers.length) out.push({ action: 'sleep', label: 'Sleep', targets: sleepers.map((m) => ({ id: m.id, at: m.at })), rolls: true, pick: 'enemy', mana: 1 });
      }
      if (cls === 'sapper' && h.pack.some((i) => i.kind === 'charge')) {
        // 20.3: adjacent floor hexes and breakable walls/doors/chests, each with fuse 1 and 2 (like the engine).
        const spots = posNeighbors(h.at).filter((p) => {
          const t = tile(p);
          if (!t) return false;
          if (t.kind === 'wall') return breakableWall(castle, p);
          return ['floor', 'rubble', 'door', 'cracked', 'stairs', 'exit'].includes(t.kind) || d.chests.some((c) => samePos(c.at, p));
        });
        if (spots.length) out.push({ action: 'setCharge', label: 'Set charge', targets: spots.flatMap((at) => [{ at, fuse: 1 as const }, { at, fuse: 2 as const }]), rolls: false, pick: 'hex' });
        const far = range(h.at, 3)
          .map((x) => ({ level: h.at.level, q: x.q, r: x.r }))
          .filter((p) => !samePos(p, h.at) && walk(state, p));
        if (far.length) out.push({ action: 'throwCharge', label: 'Throw charge', targets: far.map((at) => ({ at })), rolls: false, pick: 'hex' });
      }
      if (cls === 'sapper') {
        const dig = posNeighbors(h.at).filter((p) => tile(p)?.kind === 'rubble' || tile(p)?.kind === 'cracked' || (tile(p)?.kind === 'wall' && d.blown.includes(posKey(p))));
        if (dig.length) out.push({ action: 'dig', label: 'Dig', targets: dig.map((at) => ({ at })), rolls: false, pick: 'hex' });
      }
      if (h.pack.some((i) => i.kind === 'torch')) out.push({ action: 'torch', label: 'Light torch', targets: [{}], rolls: false, pick: 'self' });
      if (h.pack.some((i) => i.kind === 'nightsight')) out.push({ action: 'nightsight', label: 'Night-eye draught', targets: [{ id: h.heroId }], rolls: false, pick: 'self' });
      const crew = d.rivals?.members.filter((m) => m.hp > 0 && !m.goneOut && m.at.level === h.at.level && distance(m.at, h.at) <= 4) ?? [];
      if (crew.length) out.push({ action: 'parley', label: 'Parley', targets: crew.map((m) => ({ id: m.id, at: m.at })), rolls: false, pick: 'enemy' });
      return out;
    }
  }
  function previewInner(_s: GameState, heroId: string, action: ActionKind, _t: ActionTarget): RollPreview {
    {
      const fb = action === 'firebolt';
      const hh = _s.delve?.heroes.find((x) => x.heroId === heroId);
      const stab = action === 'attack' && !!_t.id && !!hh && backstabFrom(_s, heroId, _t.id, hh.at);
      if (action === 'hamstring') return { ok: true, stat: 'finesse', slots: 1, chance: 55, modifiers: ['Legs −20%'], maxFocus: 3, outcomes: ['Miss', 'Rooted 2 rounds'], noise: 1, light: 0 };
      if (action === 'nightthorn' || action === 'briar') return { ok: true, stat: 'wits', slots: 2, chance: 70, modifiers: ['Dim −10%'], maxFocus: 3, outcomes: ['Miss', action === 'briar' ? '1 dmg, rooted 1 round' : '1 dmg (ignores armor)', action === 'briar' ? '2 dmg, rooted 2 rounds' : '2 dmg (ignores armor)'], noise: action === 'briar' ? 1 : 0, light: 0 };
      if (action === 'dread' || action === 'sleep')
        return { ok: true, stat: 'wits', slots: 2, chance: 70, modifiers: ['Dim −10%'], maxFocus: 3, outcomes: ['Miss', action === 'dread' ? 'Feared 2 turns' : 'Asleep', action === 'dread' ? 'Feared 2 turns' : 'Asleep'], noise: 0, light: 0 };
      return {
        ok: true,
        stat: fb ? 'wits' : 'might',
        slots: fb ? 3 : (heroId === 'pim' ? 2 : 3) + (stab ? 2 : 0),
        chance: fb ? 75 : 55,
        modifiers: stab ? ['Dim −10%', 'Sneak attack +1 slot', 'Backstab: +1 slot, double damage'] : ['Dim −10%', 'Target asleep +20%', 'Sneak attack +1 slot'],
        maxFocus: 3,
        outcomes: fb ? ['Miss', '2 dmg', '4 dmg', '6 dmg, +1 perfect'] : stab ? ['Miss', '4 dmg', '8 dmg', '12 dmg', '16 dmg +2 (perfect)'] : ['Miss', '2 dmg', '4 dmg', '6 dmg +1 (perfect)'],
        noise: fb ? 3 : 2,
        light: 0,
      };
    }
  }
  function visInner(state: GameState): Visibility {
    {
      const d = state.delve;
      if (!d) return { visible: new Set(), explored: new Set(), lit: new Set() };
      const l = lit(state);
      const visible = new Set<string>();
      // V3.9 (24.2): each active hero sees their own hex and their front half only; the party sees the union.
      for (const h of d.heroes) {
        if (h.status !== 'active') continue;
        visible.add(posKey(h.at));
        for (const x of range(h.at, 8)) {
          const p = { level: h.at.level, ...x };
          const k = posKey(p);
          if (h.facing !== undefined && !inFrontHalf(h.at, h.facing, p)) continue;
          if (l.has(k) || distance(x, h.at) <= 1) visible.add(k);
        }
      }
      return { visible, explored: new Set([...d.explored, ...visible]), lit: l };
    }
  }
  function intentsInner(state: GameState): Record<string, Intent> {
    {
      const d = state.delve!;
      const vis = visInner(state).visible;
      const out: Record<string, Intent> = {};
      for (const m of d.monsters) {
        if (m.awareness === 'asleep' || !vis.has(posKey(m.at))) continue;
        const target = d.heroes[0]!;
        if (m.feared) {
          out[m.id] = { kind: 'flee', targetId: m.fearOf };
          continue;
        }
        out[m.id] = distance(m.at, target.at) <= 1 ? { kind: 'attack', targetId: target.heroId, damage: [0, 4] } : { kind: 'move', to: posNeighbors(m.at)[3] };
      }
      return out;
    }
  }
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
