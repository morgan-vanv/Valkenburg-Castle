// Camp: new campaign, board, recruits, shop, smithy, infirmary, starting a
// delve, and applying the summary afterwards.

import { distance, posKey, posNeighbors, samePos, type Pos } from './hex';
import type {
  AleOffer, Campaign, Command, Contract, GameEvent, GameState, Hero, HeroClass, HeroInDelve, Item, Recruit, ShopOffer, SpawnDef, Village,
} from './types';
import {
  ARMOR_PRICE, BOUNTY, CLASSES, FOCUS_MAX, HEIRLOOM_VALUE, HEIRLOOMS, LEVEL_XP, LIGHT_MAX,
  MAX_LEVEL, MONSTERS, PACK_SLOTS, PRISONER_NAMES, RECRUIT_CLASSES, RECRUIT_NAMES, REP_FOR_LEVEL, REP_FOR_SLAY, SAPPER_CHARGES, SHOP,
  START_GOLD, TIERS, WEAPON_PRICE, RECRUIT_PRICE, RECRUIT_PRICE_PER_LEVEL, HEAL_PER_HP,
  ALES, CAMPFIRE_SIZE, CASK_BAD, CASK_GOOD, CASK_GOOD_CHANCE, CASKBOOK_L2, CASKBOOK_L3, DRINK_HEAL, FLAGON_L2, FLAGON_SIZE,
  HEAVYHEAD_FOCUS, RESERVE_FOCUS, STORIES, CREWS, type StoryDef,
} from './data';
import { placeHoard } from './dragon';
import { HOARD_PIECES, SHIELD_PRICE } from './data';
import { pick, random, shuffle } from './rng';
import type { Ctx, DelveX, GameStateX, MonsterX } from './state';
import { makeCrew } from './rivals';
import { makeItem, packUsed, valueOf } from './common';
import { isKit, satchelName } from './charges';
import { facingInto } from './stealth';
import { canEnter, kindAt, type World } from './world';
import { applyOpenWays, entranceList, isGateKey, mergeDelve, shutWays, startWays, wayOpen } from './ways';

export interface ContractX extends Contract {
  /** Prisoner or heirloom name. */
  subject: string;
  /** V3.7 (spec 20.4): a "Bring back" contract: the captive hero's id. */
  captiveId?: string;
}

type Res = { error?: string; events: GameEvent[] };

export function makeHero(id: string, name: string, cls: HeroClass, level = 1): Hero {
  const c = CLASSES[cls];
  const h: Hero = {
    id, name, cls, level: 1, xp: 0, maxHp: c.hp, hp: c.hp, stats: { ...c.stats },
    weaponTier: 0, armorTier: 0, wounded: 0, delves: 0, kills: 0,
  };
  while (h.level < level) levelUp(h);
  if (level > 1) h.xp = LEVEL_XP[level] ?? 0;
  return h;
}

function levelUp(h: Hero): void {
  h.level += 1;
  h.maxHp += 2;
  h.hp += 2;
  const main = CLASSES[h.cls].main;
  h.stats[main] += 5;
}

export function newGame(w: World, seed: number): GameStateX {
  const s: GameStateX = {
    version: 3,
    seed,
    rng: seed >>> 0,
    stage: 'camp',
    campaign: {
      gold: START_GOLD,
      stash: [],
      roster: [makeHero('keven', 'Keven', 'heir')],
      recruits: [],
      board: [],
      reputation: 0,
      delveCount: 0,
      fallen: [],
      litBraziers: [],
      lostGear: [],
      village: newVillage(),
      captives: [], // V3.7 (spec 20.4): filled by the crews rework
      opened: {}, // V4.0 (spec 25): a new campaign goes in by the main gate only
      explored: {},
    },
    delve: null,
    summary: null,
    nextId: 1,
    nextHero: 1,
  };
  refreshCamp(w, s);
  return s;
}

export function newVillage(): Village {
  return { surgeon: false, innkeeper: false, smith: false, copper: false, caskbook: false };
}

/** The village as saved (older saves have none). */
export function villageOf(s: GameState): Village {
  return s.campaign.village ?? newVillage();
}

function newHeroId(s: GameStateX): string {
  s.nextHero = (s.nextHero ?? 1) + 1;
  return `h${s.nextHero - 1}`;
}

function usedNames(s: GameStateX): Set<string> {
  return new Set([...s.campaign.roster.map((h) => h.name), ...s.campaign.fallen.map((f) => f.name)]);
}

export function refreshCamp(w: World, s: GameStateX): void {
  s.campaign.village ??= newVillage();
  s.campaign.board = makeBoard(w, s);
  const v = s.campaign.village;
  const names = usedNames(s);
  const recruits: Recruit[] = [];
  // Spec 18.2: the campfire has 3 level-1 drifters of 3 classes; the Gilded Flagon 4 (at least 3
  // classes), 35% level 2, or with the cask book 25% level 2 and 10% level 3.
  const size = v.innkeeper ? FLAGON_SIZE : CAMPFIRE_SIZE;
  const classes = shuffle(s, [...RECRUIT_CLASSES]).slice(0, 3);
  while (classes.length < size) classes.push(pick(s, RECRUIT_CLASSES));
  for (let i = 0; i < size; i++) {
    const pool = RECRUIT_NAMES.filter((n) => !names.has(n));
    const name = pick(s, pool.length ? pool : RECRUIT_NAMES);
    names.add(name);
    const cls = classes[i]!;
    let level = 1;
    if (v.innkeeper) {
      const r = random(s);
      if (v.caskbook) level = r < CASKBOOK_L3 ? 3 : r < CASKBOOK_L3 + CASKBOOK_L2 ? 2 : 1;
      else level = r < FLAGON_L2 ? 2 : 1;
    }
    recruits.push({ hero: makeHero(newHeroId(s), name, cls, level), price: recruitPrice(level) });
  }
  s.campaign.recruits = recruits;
}

export function recruitPrice(level: number): number {
  return RECRUIT_PRICE + RECRUIT_PRICE_PER_LEVEL * (level - 1);
}

/** Spec 17.2: what healing this hero costs now: HP that gold buys, up to full. */
export function healQuote(h: Hero, gold: number): { hp: number; cost: number; missing: number } {
  const missing = Math.max(0, h.maxHp - h.hp);
  const hp = Math.min(missing, Math.floor(gold / HEAL_PER_HP));
  return { hp, cost: hp * HEAL_PER_HP, missing };
}

function makeBoard(w: World, s: GameStateX): Contract[] {
  const rep = s.campaign.reputation;
  const open = (lv: number) => rep >= (REP_FOR_LEVEL[lv] ?? REP_FOR_LEVEL[REP_FOR_LEVEL.length - 1]!);
  // Spec 19.1: story sites belong to their story contract; the regular board never picks them.
  const sites = w.castle.contractSites.filter((x) => x.kind !== 'slay' && !x.story && !x.hideout && open(x.at.level));
  const slay = rep >= REP_FOR_SLAY ? w.castle.contractSites.filter((x) => x.kind === 'slay' && !x.story && !x.hideout) : [];
  const l1 = shuffle(s, sites.filter((x) => x.at.level === 1));
  const deep = shuffle(s, sites.filter((x) => x.at.level > 1));
  // The slay contract stays on the board once unlocked; at least one Level 1 contract; deeper ones mixed in.
  const chosen = [...slay.slice(0, 1), ...l1.slice(0, 1), ...shuffle(s, [...l1.slice(1), ...deep])].slice(0, 3);
  const out: Contract[] = [];
  const usedNames = new Set<string>();
  chosen.forEach((site, i) => {
    const lvl = Math.min(3, site.at.level);
    const dragon = w.castle.spawns.find((sp) => sp.kind === 'dragon' && sp.at.level === site.at.level && distance(sp.at, site.at) <= 3);
    const pool = (site.kind === 'rescue' ? PRISONER_NAMES : HEIRLOOMS).filter((n) => !usedNames.has(n));
    const subject = site.kind === 'slay' ? (dragon?.name ?? 'the Dragon') : pick(s, pool);
    usedNames.add(subject);
    const bounty = BOUNTY[site.kind][lvl] ?? 0;
    const near = new Set<string>();
    for (const sp of w.castle.spawns) {
      if (sp.at.level === site.at.level && distance(sp.at, site.at) <= 6) near.add(MONSTERS[sp.kind].name.toLowerCase());
    }
    const warnings: string[] = [];
    if (site.at.level > 1) warnings.push(`Level ${site.at.level}`);
    if (site.kind === 'slay') warnings.push('30 HP, breathes fire', 'A long way down and back');
    else if (near.size) warnings.push(`Nearby: ${[...near].join(', ')}`);
    const c: ContractX = {
      id: `k${s.campaign.delveCount}-${i}`,
      kind: site.kind,
      title: site.kind === 'rescue' ? `Rescue ${subject}` : site.kind === 'slay' ? `Slay ${subject}` : `Recover ${subject}`,
      brief: site.kind === 'rescue'
        ? `${subject} is held in ${site.where}.`
        : site.kind === 'slay'
          ? `${cap(subject)} sleeps on its hoard in ${site.where}. Kill it and get out alive.`
          : `${cap(subject)} lies in ${site.where}.`,
      siteId: site.id,
      level: lvl,
      bounty,
      warnings,
      subject,
    };
    out.push(c);
  });
  out.push(...storyBoard(w, s));
  out.unshift(...captiveBoard(w, s));
  return out;
}

/**
 * V3.7 (spec 20.4): a "Bring back <name>" contract per captive: a rescue at the crew's hideout with the
 * full rescue bounty for the hideout's level (the level below where they were taken, capped at 3).
 */
export function captiveBoard(w: World, s: GameStateX): Contract[] {
  const out: Contract[] = [];
  for (const cp of s.campaign.captives ?? []) {
    const crew = CREWS[cp.crew];
    const site = w.castle.contractSites.find((x) => x.id === cp.siteId) ?? w.castle.contractSites.find((x) => x.hideout === cp.crew);
    if (!site) continue;
    const lvl = Math.min(3, site.at.level);
    const c: ContractX = {
      id: `cap-${cp.hero.id}`,
      kind: 'rescue',
      title: `Bring back ${cp.hero.name}`,
      brief: `${cp.hero.name} was dragged off by ${crew.name}. They are held at ${crew.name.replace(/^The /, 'the ')}' hideout in ${site.where}, alive for now.`,
      siteId: site.id,
      level: lvl,
      bounty: BOUNTY.rescue[lvl] ?? 0,
      warnings: [crew.name, `Level ${lvl}`, 'Held at HP 1'],
      subject: cp.hero.name,
      captiveId: cp.hero.id,
    };
    out.push(c);
  }
  return out;
}

/** Spec 18.3: is this story's contract on the board (prerequisites met, not done)? */
export function storyAvailable(s: GameState, st: StoryDef): boolean {
  const v = villageOf(s);
  const rep = s.campaign.reputation;
  if (v[st.id]) return false;
  switch (st.id) {
    case 'surgeon': return true;
    case 'innkeeper': return rep >= 1;
    case 'smith': return rep >= (REP_FOR_LEVEL[2] ?? 1);
    case 'copper': return v.innkeeper;
    case 'caskbook': return v.copper && rep >= (REP_FOR_LEVEL[3] ?? 2);
  }
}

/** Half the regular bounty for the kind and level, rounded down to 5. */
export function storyBounty(kind: 'rescue' | 'recover', level: number): number {
  return Math.floor((BOUNTY[kind][Math.min(3, level)] ?? 0) / 2 / 5) * 5;
}

function storyBoard(w: World, s: GameStateX): Contract[] {
  const out: Contract[] = [];
  for (const st of STORIES) {
    if (!storyAvailable(s, st)) continue;
    const site = w.castle.contractSites.find((x) => x.id === st.siteId);
    if (!site) continue;
    const lvl = Math.min(3, site.at.level);
    // V4.0: no "Story"/"Unlocks" lines: the board shows story status itself.
    const warnings: string[] = [];
    if (lvl > 1) warnings.push(`Level ${lvl}`);
    if (st.heavy) warnings.push('Heavy: its carrier moves 3');
    const c: ContractX = {
      id: `story-${st.id}`,
      kind: st.kind,
      title: st.kind === 'rescue' ? `Rescue ${st.subject}` : `Recover ${st.subject}`,
      brief: st.brief,
      siteId: site.id,
      level: lvl,
      bounty: storyBounty(st.kind, lvl),
      warnings,
      subject: st.subject,
      story: st.id,
    };
    out.push(c);
  }
  return out;
}

function cap(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// ---------------------------------------------------------------- camp commands

export function campCommand(w: World, s: GameStateX, cmd: Command): Res {
  const C = s.campaign;
  const events: GameEvent[] = [];
  const err = (e: string): Res => ({ error: e, events: [] });
  if (s.stage !== 'camp') return err('Not in camp.');
  switch (cmd.type) {
    case 'buy': {
      const o = shopOffers(s).find((x) => x.kind === cmd.kind);
      if (!o) return err('Not for sale.');
      if (o.locked) return err(o.locked);
      if (C.gold < o.price) return err('Not enough gold.');
      C.gold -= o.price;
      C.stash.push(makeItem({ s }, o.kind, 1, o.name));
      events.push({ type: 'say', text: `Bought a ${o.name.toLowerCase()}.` });
      return { events };
    }
    case 'sellAll': {
      const sell = C.stash.filter((i) => !i.story && (i.kind === 'gem' || i.kind === 'jewelry' || i.kind === 'heirloom' || i.kind === 'hoard'));
      if (!sell.length) return err('Nothing to sell.');
      const v = valueOf(sell);
      C.gold += v;
      C.stash = C.stash.filter((i) => !sell.includes(i));
      events.push({ type: 'say', text: `Sold ${sell.length} valuables for ${v} gold.` });
      return { events };
    }
    case 'sell': {
      // V4.0: one valuable at a time, from Keven's cart.
      const it = C.stash.find((i) => i.id === cmd.itemId);
      if (!it) return err('No such item on the cart.');
      if (it.story || !(it.kind === 'gem' || it.kind === 'jewelry' || it.kind === 'heirloom' || it.kind === 'hoard')) return err(`${it.name} can't be sold.`);
      const v = valueOf([it]);
      C.gold += v;
      C.stash = C.stash.filter((i) => i !== it);
      events.push({ type: 'say', text: `Sold ${it.name} for ${v} gold.` });
      return { events };
    }
    case 'hire': {
      const r = C.recruits.find((x) => x.hero.id === cmd.heroId);
      if (!r) return err('No such recruit.');
      if (C.gold < r.price) return err('Not enough gold.');
      C.gold -= r.price;
      C.roster.push(r.hero);
      C.recruits = C.recruits.filter((x) => x !== r);
      events.push({ type: 'say', text: `${r.hero.name} signs on.` });
      return { events };
    }
    case 'heal': {
      const h = C.roster.find((x) => x.id === cmd.heroId);
      if (!h) return err('No such hero.');
      if (!villageOf(s).surgeon) return err(LOCKED.surgeon);
      const q = healQuote(h, C.gold);
      if (!q.missing) return err(`${h.name} is unhurt.`);
      if (!q.hp) return err('Not enough gold.');
      C.gold -= q.cost;
      h.hp += q.hp;
      events.push({ type: 'say', text: h.hp >= h.maxHp ? `${h.name} is patched up (${q.cost} gold).` : `${h.name} gets ${q.hp} HP back (${q.cost} gold, all you could pay).` });
      return { events };
    }
    case 'drink': {
      const h = C.roster.find((x) => x.id === cmd.heroId);
      if (!h) return err('No such hero.');
      if (h.hp >= h.maxHp) return err(`${h.name} is unhurt.`);
      const pot = C.stash.find((i) => i.kind === 'potion');
      if (!pot) return err('No potion in the cart. The peddler sells them.');
      C.stash = C.stash.filter((i) => i !== pot);
      const before = h.hp;
      h.hp = Math.min(h.maxHp, h.hp + DRINK_HEAL);
      events.push({ type: 'say', text: `${h.name} drinks a potion (+${h.hp - before} HP).` });
      return { events };
    }
    case 'buyAle': {
      const h = C.roster.find((x) => x.id === cmd.heroId);
      if (!h) return err('No such hero.');
      const o = aleOffers(s).find((x) => x.kind === cmd.ale);
      if (!o) return err('Wim doesn\'t brew that.');
      if (o.locked) return err(o.locked);
      if (h.ale) return err(`${h.name} already has an ale waiting. One at a time.`);
      if (C.gold < o.price) return err('Not enough gold.');
      C.gold -= o.price;
      h.ale = o.kind;
      events.push({ type: 'say', text: `Wim draws ${h.name} a ${o.name}. Drunk at the start of the next delve.` });
      return { events };
    }
    case 'buyShield': {
      // V3.7 (spec 20.5): a round shield from the forge: ranged hits do 1 less (2 while braced). Any class.
      const h = C.roster.find((x) => x.id === cmd.heroId);
      if (!h) return err('No such hero.');
      if (!villageOf(s).smith) return err(LOCKED.smith);
      if (h.shield) return err(`${h.name} already carries a shield.`);
      if (C.gold < SHIELD_PRICE) return err('Not enough gold.');
      C.gold -= SHIELD_PRICE;
      h.shield = true;
      events.push({ type: 'say', text: `Gerda straps a shield to ${h.name}'s arm (${SHIELD_PRICE} gold).` });
      return { events };
    }
    case 'upgrade': {
      const h = C.roster.find((x) => x.id === cmd.heroId);
      if (!h) return err('No such hero.');
      if (!villageOf(s).smith) return err(LOCKED.smith);
      const tier = cmd.part === 'weapon' ? h.weaponTier : h.armorTier;
      if (tier >= 2) return err('Already the best the smithy makes.');
      const price = (cmd.part === 'weapon' ? WEAPON_PRICE : ARMOR_PRICE)[tier + 1]!;
      if (C.gold < price) return err('Not enough gold.');
      C.gold -= price;
      if (cmd.part === 'weapon') h.weaponTier = (tier + 1) as 1 | 2;
      else h.armorTier = (tier + 1) as 1 | 2;
      events.push({ type: 'say', text: `${h.name}'s ${cmd.part} is improved.` });
      return { events };
    }
    case 'startDelve':
      return startDelve(w, s, cmd);
    default:
      return err('Not now.');
  }
}

/** Refusals that name the fix (spec 18.2). */
export const LOCKED = {
  surgeon: 'No surgeon in Lowgate. Rescue Brother Aldric (Level 1, the chapel). Until then, drink a potion.',
  smith: 'The forge is cold. Rescue Gerda the smith (Level 2, the forge).',
  metal: 'Needs a smith: rescue Gerda (Level 2, the forge).',
  copper: 'Nothing to brew in: recover the brewing copper (Level 2, the barracks).',
  caskbook: 'Wim needs his cask book: recover it (Level 3, the Drain).',
  innkeeper: 'The Flagon is dark. Rescue Old Wim (Level 1, the kitchens).',
  brewed: 'Brewed at the Gilded Flagon: rescue Old Wim (Level 1, the kitchens).',
} as const;

/**
 * The peddler's stock; metalwork `locked` until the smith is home, the night-eye draught until
 * Old Wim is (spec 21.3: brewed at the Flagon). With no state, nothing is locked.
 */
export function shopOffers(s?: GameState): ShopOffer[] {
  const v = s ? villageOf(s) : null;
  return SHOP.map((o) => {
    const locked = !v ? undefined : o.needs === 'smith' && !v.smith ? LOCKED.metal : o.needs === 'innkeeper' && !v.innkeeper ? LOCKED.brewed : undefined;
    return { ...o, ...(locked ? { locked } : {}) };
  });
}

/** The Flagon's ales, `locked` until the copper (and the cask book) is home, and while Wim is away. */
export function aleOffers(s: GameState): AleOffer[] {
  const v = villageOf(s);
  return ALES.map((o) => {
    let locked: string | undefined;
    if (!v.innkeeper) locked = LOCKED.innkeeper;
    else if (!v.copper) locked = LOCKED.copper;
    else if (o.needs === 'caskbook' && !v.caskbook) locked = LOCKED.caskbook;
    return { ...o, ...(locked ? { locked } : {}) };
  });
}

/** Why a delve can't start with this party (spec 15.3), or null. */
export function partyProblem(s: GameStateX, heroIds: string[]): string | null {
  const C = s.campaign;
  const ids = [...new Set(heroIds)];
  if (C.roster.length < 1) return 'Hire at least one hero at the tavern.';
  if (ids.length < 1) return 'Pick at least one hero.';
  if (ids.length > 4) return 'Four heroes at most.';
  for (const id of ids) {
    const h = C.roster.find((x) => x.id === id);
    if (!h) return 'No such hero.';
  }
  return null;
}

export function upgradePrice(h: Hero, part: 'weapon' | 'armor'): number | null {
  const tier = part === 'weapon' ? h.weaponTier : h.armorTier;
  if (tier >= 2) return null;
  return (part === 'weapon' ? WEAPON_PRICE : ARMOR_PRICE)[tier + 1]!;
}

// ---------------------------------------------------------------- start a delve

function startDelve(w: World, s: GameStateX, cmd: Extract<Command, { type: 'startDelve' }>): Res {
  const C = s.campaign;
  const err = (e: string): Res => ({ error: e, events: [] });
  const contract = C.board.find((k) => k.id === cmd.contractId) as ContractX | undefined;
  if (!contract) return err('No such contract.');
  const ids = [...new Set(cmd.heroIds)];
  const problem = partyProblem(s, ids);
  if (problem) return err(problem);
  const heroes: Hero[] = [];
  for (const id of ids) {
    const h = C.roster.find((x) => x.id === id);
    if (!h) return err('No such hero.');
    heroes.push(h);
  }
  const entrance = w.castle.entrances[cmd.entrance];
  if (!entrance) return err('No such entrance.');
  // V4.0 (spec 25): a shut way in can't be used until it's opened.
  const ent = entranceList(w, s)[cmd.entrance];
  if (ent && ent.state !== 'open') {
    const name = ent.name.charAt(0).toLowerCase() + ent.name.slice(1);
    return err(`The ${name} is ${ent.state === 'locked' ? 'barred shut' : 'choked with rubble'}. Go in by the main gate.`);
  }
  const site = w.castle.contractSites.find((x) => x.id === contract.siteId);
  if (!site) return err('The contract site is missing.');
  // Packs from the stash.
  const packs: Record<string, Item[]> = {};
  const used = new Set<string>();
  for (const h of heroes) {
    const pack: Item[] = [];
    for (const iid of cmd.packs[h.id] ?? []) {
      if (used.has(iid)) return err('An item can only go in one pack.');
      const it = C.stash.find((x) => x.id === iid);
      if (!it) return err('That item is not in the stash.');
      used.add(iid);
      pack.push(it);
    }
    if (packUsed(pack) > PACK_SLOTS) return err(`${h.name}'s pack is too full.`);
    packs[h.id] = pack;
  }
  for (const k of Object.keys(cmd.packs)) if (!ids.includes(k) && (cmd.packs[k]?.length ?? 0) > 0) return err('Packs only for heroes going in.');
  C.stash = C.stash.filter((i) => !used.has(i.id));
  C.delveCount += 1;

  // Build the delve.
  const doors: DelveX['doors'] = {};
  for (const l of w.castle.levels) {
    for (const [k, t] of Object.entries(l.tiles)) {
      if (t.kind === 'door') doors[`${l.level}:${k}`] = { open: false, locked: !!t.locked, jammed: false };
    }
  }
  const monsters: MonsterX[] = w.castle.spawns.map((sp, i) => spawnMonster(sp, `m${i + 1}`));
  const d: DelveX = {
    contract,
    round: 1,
    phase: 'player',
    heroes: [],
    monsters,
    rivals: null,
    light: LIGHT_MAX,
    lanternBearer: ids.includes('keven') ? 'keven' : ids[0]!,
    doors,
    chests: w.castle.chests.map((c) => ({ id: c.id, at: { ...c.at }, tier: c.tier, locked: !!c.locked, jammed: false, opened: false })),
    ground: [],
    traps: Object.fromEntries(w.castle.traps.map((t) => [posKey(t.at), { spotted: false, ...(t.venom ? { venom: true } : {}) }])),
    lit: [...C.litBraziers],
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
    log: [],
    kills: {},
    xp: {},
    lostIds: [],
    notes: [],
    nextMonster: monsters.length + 1,
    taken: [...used],
    // V4.0 (spec 25): the ways in already opened this campaign stand open in this delve.
    ways: startWays(w, s),
  };
  applyOpenWays(w, d);
  // Coins and lost gear.
  for (const coin of w.castle.coins) d.ground.push({ at: { ...coin.at }, items: [makeItem({ s }, 'gold', coin.gold)] });
  // V4.0 (spec 25.2): while its gate is shut, a copy of the gate's key lies where the castle keeps it.
  for (const way of shutWays(w.castle)) {
    if (way.kind === 'gate' && way.keyAt && !wayOpen(s, way.id)) d.ground.push({ at: { ...way.keyAt }, items: [makeItem({ s }, 'gatekey')] });
  }
  for (const lg of C.lostGear) {
    d.ground.push({ at: { ...lg.at }, items: lg.items.map((i) => ({ ...i })) });
    d.lostIds!.push(...lg.items.map((i) => i.id));
  }
  // Objective.
  const story = contract.story ? STORIES.find((x) => x.id === contract.story) : undefined;
  if (contract.kind === 'recover') {
    const it = makeItem({ s }, 'heirloom', story ? 0 : (HEIRLOOM_VALUE[contract.level] ?? 60), cap(contract.subject));
    it.contractId = contract.id;
    if (story) {
      // Spec 18.3: story things go to the village, not the stash; the copper is heavy.
      it.story = story.id;
      it.slots = story.slots ?? 1;
      if (story.heavy) it.heavy = true;
    }
    d.ground.push({ at: { ...site.at }, items: [it] });
  } else if (contract.kind === 'slay') {
    // Nothing to place: the Dragon is a castle spawn.
  } else {
    // Spec 20.4: a captive hero is held at HP 1.
    d.prisoner = { id: 'p1', name: contract.subject, at: { ...site.at }, hp: contract.captiveId ? 1 : 5, freed: false, out: false, dead: false };
  }
  // The Dragon's hoard: what's been carried out never comes back.
  placeHoard(w, s, d, Math.max(0, HOARD_PIECES - (s.hoardTaken ?? 0)));
  // Rivals (spec 18.5): the Sisters on a Level 1 contract, a cutthroat crew from the pool on Level 2 or 3.
  d.rivals = makeCrew(w, s, d, contract.level, entrance);
  // Place heroes at the entrance and around it.
  const spots = freeSpotsNear(w, d, entrance, ids.length, monsters.map((m) => m.at));
  ids.forEach((id, i) => {
    const h = C.roster.find((x) => x.id === id)!;
    // Spec 18.4: the ale is drunk now (the Black Cask resolves on the seeded RNG) and cleared.
    const ale = h.ale ? drinkAle(s, h.ale) : undefined;
    h.ale = undefined;
    const hid: HeroInDelve = {
      heroId: id,
      at: spots[i] ?? { ...entrance },
      hp: Math.max(1, Math.min(h.maxHp, h.hp ?? h.maxHp)),
      focus: ale === 'reserve' ? RESERVE_FOCUS : ale === 'heavyhead' ? HEAVYHEAD_FOCUS : FOCUS_MAX,
      pack: packs[id] ?? [],
      status: 'active',
      bleed: 0,
      torch: 0,
      moved: false,
      acted: false,
      webbed: false,
      mana: CLASSES[h.cls].mana,
      rallyCooldown: 0,
      revived: false,
      dashed: false,
      overwatch: false,
      veil: 0,
      ward: 0,
      // V4.0 (spec 26.1): each hero's own Walk/Sneak setting; Burglars start sneaking.
      moveMode: h.cls === 'burglar' ? 'sneak' : 'walk',
      ...(ale ? { ale } : {}),
    };
    // V3.7 (spec 20.3), V4.0 (26.5): the Sapper's own 3 improvised explosives, one slotless pack item; bought charges add to them.
    if (h.cls === 'sapper') hid.pack.unshift({ ...makeItem({ s }, 'improvised-charge', SAPPER_CHARGES, satchelName(SAPPER_CHARGES)), slots: 0 });
    // V3.7.1 (spec 21.4): every Burglar brings one improvised pick, outside the 4 slots like the explosives.
    if (h.cls === 'burglar') hid.pack.push({ ...makeItem({ s }, 'improvised'), slots: 0 });
    // V3.9 (spec 24.2): everyone starts facing into the castle.
    hid.facing = facingInto(w, d, hid.at);
    d.heroes.push(hid);
  });
  s.delve = d;
  s.summary = null;
  s.stage = 'delve';
  return { events: [] };
}

/** What an ale does once drunk: the Black Cask is 70% one of the six others, 30% a drawback. */
export function drinkAle(s: GameStateX, kind: NonNullable<Hero['ale']>): HeroInDelve['ale'] {
  if (kind !== 'blackcask') return kind;
  return random(s) < CASK_GOOD_CHANCE ? pick(s, CASK_GOOD) : pick(s, CASK_BAD);
}

/**
 * A monster from a spawn (spec 16.1, 16.3): awake by default (patrollers walk their route,
 * the rest stand alert at their post), asleep only when the map says so; ghouls start buried;
 * tiers by spawn level for everything but the Dragon and the Gloam; named elites +2 HP.
 */
export function spawnMonster(sp: SpawnDef, id: string): MonsterX {
  const def = MONSTERS[sp.kind];
  const tiered = sp.kind !== 'dragon';
  const tier = tiered ? Math.min(3, Math.max(1, sp.at.level)) : 1;
  const hp = def.hp + (sp.name ? 2 : 0) + (tiered ? (TIERS[tier]?.hp ?? 0) : 0);
  const buried = sp.kind === 'ghoul' ? sp.buried !== false : !!sp.buried;
  const patrol = sp.patrol && sp.patrol.length > 1 ? sp.patrol.map((p) => ({ ...p })) : undefined;
  let awareness: MonsterX['awareness'] = 'alert';
  if (sp.asleep) awareness = 'asleep';
  else if (buried || sp.kind === 'berserker') awareness = 'hunting';
  else if (patrol) awareness = 'patrol';
  const m: MonsterX = {
    id,
    kind: sp.kind,
    name: sp.name ?? def.name,
    at: { ...sp.at },
    hp,
    maxHp: hp,
    awareness,
    spawnedAt: { ...sp.at },
    // V3.7 (spec 20.1): sleepers face where the map put them; default 0 (east). `facing` on SpawnDef is a contract request.
    facing: (sp as SpawnDef & { facing?: number }).facing ?? 0,
  };
  if (tier > 1) m.tier = tier;
  if (patrol) {
    m.route = patrol;
    m.routeIndex = 1 % patrol.length;
  }
  if (buried) m.buried = true;
  if (sp.kind === 'captain') m.shoutCooldown = 0;
  return m;
}

/** n free walkable hexes, the entrance first then nearest by BFS. */
export function freeSpotsNear(w: World, d: DelveX, from: Pos, n: number, taken: Pos[]): Pos[] {
  const out: Pos[] = [];
  const seen = new Set<string>([posKey(from)]);
  const q: Pos[] = [from];
  for (let i = 0; i < q.length && out.length < n; i++) {
    const p = q[i]!;
    const k = kindAt(w, d, p);
    if (k && k !== 'door' && canEnter(w, d, p) && !taken.some((t) => samePos(t, p))) out.push(p);
    for (const nb of posNeighbors(p)) {
      if (seen.has(posKey(nb)) || !canEnter(w, d, nb)) continue;
      if (kindAt(w, d, nb) === 'door' && !d.doors[posKey(nb)]?.open) continue;
      seen.add(posKey(nb));
      q.push(nb);
    }
  }
  return out;
}

// ---------------------------------------------------------------- summary

export function xpLevel(xp: number): number {
  let lv = 1;
  for (let i = 2; i <= MAX_LEVEL; i++) if (xp >= LEVEL_XP[i]!) lv = i;
  return lv;
}

export function contractDone(d: DelveX): boolean {
  if (d.contract.kind === 'rescue') return !!d.prisoner?.out;
  if (d.contract.kind === 'slay') return !!d.dragonSlain && d.heroes.some((h) => h.status === 'out');
  return d.heroes.some((h) => h.status === 'out' && h.pack.some((i) => i.kind === 'heirloom' && i.contractId === d.contract.id));
}

/** Build the summary (delve over). Downed heroes inside have already died. */
export function buildSummary(c: Ctx): void {
  const d = c.d;
  const C = c.s.campaign;
  const done = contractDone(d);
  const out = d.heroes.filter((h) => h.status === 'out');
  const xp: Record<string, number> = {};
  const levelUps: string[] = [];
  for (const h of d.heroes) {
    let x = d.xp?.[h.heroId] ?? 0;
    if (h.status === 'out') x += 1 + (done ? 3 : 0);
    xp[h.heroId] = x;
    const def = C.roster.find((r) => r.id === h.heroId);
    if (def && h.status === 'out' && xpLevel(def.xp + x) > def.level) levelUps.push(h.heroId);
  }
  const lootValue = valueOf(out.flatMap((h) => h.pack));
  const notes = [...(d.notes ?? [])];
  for (const h of d.heroes) if (h.status === 'captured') notes.push(`${C.roster.find((x) => x.id === h.heroId)?.name ?? h.heroId} was dragged out by ${d.rivals?.name ?? 'a crew'}.`);
  if (done) notes.unshift(`Contract done: ${d.contract.title}.`);
  else notes.unshift(`Contract failed: ${d.contract.title}.`);
  c.s.summary = {
    contractDone: done,
    bounty: done ? d.contract.bounty : 0,
    lootValue,
    survivors: out.map((h) => h.heroId),
    // Spec 17.2: everyone who comes out hurt (they keep that HP until the infirmary heals them).
    wounded: out.filter((h) => h.hp < (c.s.campaign.roster.find((x) => x.id === h.heroId)?.maxHp ?? 0)).map((h) => h.heroId),
    dead: d.heroes.filter((h) => h.status === 'dead').map((h) => h.heroId),
    xp,
    levelUps,
    notes,
  };
  c.s.stage = 'summary';
  c.ev.push({ type: 'delveOver', summary: c.s.summary });
}

export function backToCamp(w: World, s: GameStateX): Res {
  const d = s.delve;
  const sum = s.summary;
  if (s.stage !== 'summary' || !d || !sum) return { error: 'No delve to come back from.', events: [] };
  const C: Campaign = s.campaign;
  const out = d.heroes.filter((h) => h.status === 'out');
  // Loot.
  for (const h of out) {
    s.hoardTaken = (s.hoardTaken ?? 0) + h.pack.filter((i) => i.kind === 'hoard').length;
    for (const it of h.pack) {
      if (it.story || isGateKey(it)) continue; // spec 18.3: to the village, below; V4.0: the sally key opens its gate (ways.ts)
      if (isKit(it)) continue; // spec 20.3, 21.4, 26.5: class kit (improvised explosives, the improvised pick) refills each delve
      if (it.kind === 'gold') C.gold += it.amount;
      else C.stash.push(it);
    }
  }
  C.gold += sum.bounty;
  if (sum.contractDone) C.reputation += 1;
  // Heroes.
  const going = new Set(d.heroes.map((h) => h.heroId));
  for (const h of C.roster) {
    if (!going.has(h.id)) continue;
    const hid = d.heroes.find((x) => x.heroId === h.id)!;
    h.kills += d.kills[h.id] ?? 0;
    h.xp += sum.xp[h.id] ?? 0;
    if (hid.status === 'out') {
      h.delves += 1;
      // HP carries over (spec 17.2); level-ups still add their +2.
      h.hp = Math.max(1, Math.min(h.maxHp, hid.hp));
      while (h.level < MAX_LEVEL && xpLevel(h.xp) > h.level) levelUp(h);
    }
  }
  const lost: { at: Pos; items: Item[] }[] = [];
  for (const id of sum.dead) {
    const h = C.roster.find((x) => x.id === id);
    if (!h) continue;
    const at = d.diedAt?.[id] ?? d.heroes.find((x) => x.heroId === id)!.at;
    C.fallen.push({ name: h.name, cls: h.cls, level: h.level, where: `Level ${at.level}, ${w.roomName(at).toLowerCase()}`, delve: C.delveCount });
  }
  C.roster = C.roster.filter((h) => !sum.dead.includes(h.id));
  // Lost gear: ground items that came from fallen heroes (this or earlier delves).
  const lostIds = new Set(d.lostIds ?? []);
  for (const g of d.ground) {
    const items = g.items.filter((i) => lostIds.has(i.id) && i.kind !== 'heirloom' && i.kind !== 'hoard' && !isKit(i) && !isGateKey(i));
    if (items.length) lost.push({ at: { ...g.at }, items });
  }
  C.lostGear = lost;
  C.litBraziers = [...d.lit];
  // Spec 18.3: a story contract done brings its villager or thing home.
  const events: GameEvent[] = [];
  // V4.0 (spec 25): ways opened (or the sally key carried out) stay open; every hex seen is remembered.
  for (const text of mergeDelve(w, s, d)) events.push({ type: 'say', text });
  const story = d.contract.story;
  C.village ??= newVillage();
  if (story && sum.contractDone && !C.village[story]) {
    C.village[story] = true;
    const st = STORIES.find((x) => x.id === story)!;
    events.push({ type: 'villageUnlocked', story });
    events.push({ type: 'say', text: st.line });
  }
  // V3.7 (spec 20.4): a captive brought back rejoins the roster with the HP they came out with; one who
  // died in the crew's hands is mourned. (The contract comes off the board with the captive.)
  const captiveId = (d.contract as ContractX).captiveId;
  if (captiveId && d.prisoner) {
    const i = (C.captives ?? []).findIndex((cp) => cp.hero.id === captiveId);
    const cp = i >= 0 ? C.captives[i] : undefined;
    if (cp && d.prisoner.out) {
      C.captives.splice(i, 1);
      cp.hero.hp = Math.max(1, Math.min(cp.hero.maxHp, d.prisoner.hp));
      C.roster.push(cp.hero);
      events.push({ type: 'say', text: `${cp.hero.name} is home, and back on the roster.` });
    } else if (cp && d.prisoner.dead) {
      C.captives.splice(i, 1);
      const at = d.prisoner.at;
      C.fallen.push({ name: cp.hero.name, cls: cp.hero.cls, level: cp.hero.level, where: `Level ${at.level}, ${w.roomName(at).toLowerCase()}`, delve: C.delveCount });
    }
  }
  // Prisoner joins (story villagers stay in Lowgate; a captive hero is handled above).
  if (d.contract.kind === 'rescue' && d.prisoner?.out && !story && !captiveId) {
    const cls = pick(s, RECRUIT_CLASSES);
    C.roster.push(makeHero(`h${(s.nextHero = (s.nextHero ?? 1) + 1) - 1}`, d.prisoner.name, cls));
  }
  // V3.7 (spec 20.4): heroes a crew carried off leave the roster for the captives list (minus gold and
  // gems, which the crew took); a "Bring back" contract goes up for each. The heir taken ends it.
  C.captives ??= [];
  const cr = d.rivals;
  let heirTaken = false;
  for (const hid of d.heroes) {
    if (hid.status !== 'captured') continue;
    const h = C.roster.find((x) => x.id === hid.heroId);
    if (!h || !cr) continue;
    h.hp = 1;
    C.roster = C.roster.filter((x) => x !== h);
    const site = w.castle.contractSites.find((x) => x.hideout === cr.crew);
    C.captives.push({ hero: h, crew: cr.crew, siteId: site?.id ?? CREWS[cr.crew].hideout.siteId, delve: C.delveCount });
    if (h.id === 'keven') heirTaken = true;
    events.push({ type: 'say', text: `${h.name} was carried off by ${cr.name}. A "Bring back" job goes up on the post.` });
  }
  const heirDead = sum.dead.includes('keven');
  s.delve = null;
  s.summary = null;
  if (heirDead) {
    s.stage = 'over';
    s.overReason = 'The heir has fallen. Valkenburg stays dark.';
    return { events: [...events, { type: 'say', text: 'The heir has fallen. Valkenburg stays dark.' }] };
  }
  if (heirTaken) {
    s.stage = 'over';
    s.overReason = 'The heir is taken. Valkenburg stays dark.';
    return { events: [...events, { type: 'say', text: 'The heir is taken. Valkenburg stays dark.' }] };
  }
  refreshCamp(w, s);
  s.stage = 'camp';
  return { events };
}
