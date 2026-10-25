// Hand-made GameState fixtures and a tiny stand-in engine, for building the
// view before the real engine lands. Not used once src/game/index.ts exists,
// except by screenshots that want a fixed scene (`?fixture=1`).

import type { ActionOption, Engine, FallInfo, Reach, RollPreview, Visibility } from '../game/api';
import { distance, hexKey, posKey, posNeighbors, range, samePos, type Pos } from '../game/hex';
import type { ActionKind, ActionTarget, AleOffer, ApplyResult, CastleDef, Command, DealOption, GameState, Hero, HeroClass, Item, RivalCrew, ShopOffer, StoryId } from '../game/types';

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
      hero('keven', 'Keven', 'heir', 12, { might: 65, finesse: 50, wits: 55, nerve: 80 }),
      hero('brann', 'Brann', 'sellsword', 10, { might: 70, finesse: 45, wits: 40, nerve: 60 }),
      hero('pim', 'Pim', 'burglar', 7, { might: 40, finesse: 75, wits: 60, nerve: 50 }),
      { ...hero('aldous', 'Aldous', 'pyromancer', 6, { might: 30, finesse: 50, wits: 75, nerve: 55 }), wounded: 1 },
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
  };
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
    members: [
      { id: 'r1', crew: 'ferrymen', name: 'Brune', cls: 'sellsword', at: near(0, 0), hp: 12, maxHp: 12, loot: [gold(1)], goneOut: false, intent: stance === 'demanding' ? { kind: 'toll' } : undefined },
      { id: 'r2', crew: 'ferrymen', name: 'Osk', cls: 'ranger', at: near(0, 1), hp: 9, maxHp: 9, loot: [gold(2)], goneOut: false },
      { id: 'r3', crew: 'ferrymen', name: 'Hackett', cls: 'sapper', at: near(0, 5), hp: 11, maxHp: 11, loot: [gold(3)], goneOut: false, charges: 1, intent: stance === 'hostile' ? { kind: 'charge', to: a, hexes: [a, ...posNeighbors(a)] } : undefined },
    ],
  };
  return s;
}

/** A delve in progress on the test castle. */
export function fixtureDelve(castle: CastleDef): GameState {
  const e = castle.entrances[0]!;
  const near = (p: Pos, i: number): Pos => posNeighbors(p)[i] ?? p;
  const at0: Pos = near(e, 1);
  const c = fixtureCampaign();
  const heroIds = ['keven', 'brann', 'pim', 'aldous'];
  const spots = [at0, near(at0, 0), near(at0, 2), near(at0, 1)];
  const heroes = heroIds.map((id, i) => ({
    heroId: id,
    at: spots[i]!,
    hp: id === 'brann' ? 7 : (c.roster.find((h) => h.id === id)?.maxHp ?? 8),
    focus: 3,
    pack: id === 'pim' ? [item('i9', 'gold', 'Gold', 35), item('i10', 'torch', 'Torch'), { ...item('i12', 'gem', 'Ruby', 60) }] : id === 'keven' ? [item('i11', 'potion', 'Potion'), item('i13', 'nightsight', 'Night-eye draught')] : id === 'brann' ? [item('i14', 'lockpicks', 'Lockpicks')] : [],
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
    { kind: 'caltrops', name: 'Caltrops', price: 15, text: 'Scatter next to you: the first monster across takes 2 and stops.', needs: 'smith' },
    { kind: 'hook', name: 'Grappling hook', price: 40, text: 'Climb from a pit landing back up a level. Reusable.', needs: 'smith' },
    { kind: 'key', name: 'Skeleton key', price: 30, text: 'Opens one locked door or chest, silently. One use.', needs: 'smith' },
    { kind: 'lockpicks', name: 'Lockpicks', price: 25, text: 'Reusable. Anyone carrying them can Pick a lock: 2 Finesse slots.', needs: 'smith' },
    { kind: 'nightsight', name: 'Night-eye draught', price: 30, text: 'Drink: 8 rounds without dark penalties.' },
  ];
  const shopFor = (s?: GameState): ShopOffer[] => shop.map((o) => (o.needs === 'smith' && !s?.campaign.village?.smith ? { ...o, locked: 'Needs a smith: rescue Gerda (Level 2, the forge).' } : o));
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
  const eng: Engine = {
    castle: () => castle,
    newGame: (seed) => {
      const c = fixtureCampaign();
      pinStories(c);
      return { version: 3, seed, rng: seed, stage: 'camp', campaign: c, delve: null, summary: null };
    },
    apply(state: GameState, cmd: Command): ApplyResult {
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
      if (cmd.type === 'move' && s.delve) {
        const h = s.delve.heroes.find((x) => x.heroId === cmd.heroId)!;
        h.at = cmd.path[cmd.path.length - 1]!;
        if (h.moved) {
          h.dashed = true;
          h.acted = true;
        }
        h.moved = true;
        for (const k of lit(s)) if (!s.delve.explored.includes(k)) s.delve.explored.push(k);
        return { state: s, events: [{ type: 'moved', id: cmd.heroId, path: cmd.path }, { type: 'noise', at: h.at, radius: cmd.sneak ? 0 : 1 }] };
      }
      if (cmd.type === 'endTurn' && s.delve) {
        s.delve.round++;
        s.delve.light = Math.max(0, s.delve.light - 1);
        for (const h of s.delve.heroes) {
          h.moved = h.acted = false;
          if (h.nightEyes) h.nightEyes--;
        }
        return { state: s, events: [{ type: 'phase', phase: 'world', round: s.delve.round - 1 }, { type: 'light', light: s.delve.light, brightness: eng.brightness(s) }, { type: 'phase', phase: 'player', round: s.delve.round }] };
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
        if (cmd.action === 'nightsight') {
          h.nightEyes = 8;
          h.pack = h.pack.filter((i) => i.kind !== 'nightsight');
          return { state: s, events: [{ type: 'say', text: 'The draught goes down. The dark thins.' }] };
        }
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
    },
    reachable(state, heroId, sneak): Reach[] {
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
      return [...seen.values()].filter((r) => r.cost > 0 && !d.heroes.some((o) => o.status === 'active' && samePos(o.at, r.to))).map((r) => (dash ? { ...r, dash: true } : r));
    },
    actions(state, heroId): ActionOption[] {
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
      if (heroId === 'aldous') {
        const far = d.monsters.filter((m) => distance(m.at, h.at) <= 5 && m.at.level === h.at.level);
        if (far.length) out.push({ action: 'firebolt', label: 'Firebolt', targets: far.map((m) => ({ id: m.id, at: m.at })), rolls: true, pick: 'enemy', mana: 1 });
        out.push({ action: 'kindle', label: 'Kindle', targets: [{}], rolls: false, pick: 'self', mana: 1 });
      }
      if (h.pack.some((i) => i.kind === 'torch')) out.push({ action: 'torch', label: 'Light torch', targets: [{}], rolls: false, pick: 'self' });
      if (h.pack.some((i) => i.kind === 'nightsight')) out.push({ action: 'nightsight', label: 'Night-eye draught', targets: [{ id: h.heroId }], rolls: false, pick: 'self' });
      const crew = d.rivals?.members.filter((m) => m.hp > 0 && !m.goneOut && m.at.level === h.at.level && distance(m.at, h.at) <= 4) ?? [];
      if (crew.length) out.push({ action: 'parley', label: 'Parley', targets: crew.map((m) => ({ id: m.id, at: m.at })), rolls: false, pick: 'enemy' });
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
