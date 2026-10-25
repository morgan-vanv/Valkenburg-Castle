// Camp: new campaign, board, recruits, shop, smithy, infirmary, starting a
// delve, and applying the summary afterwards.

import { distance, posKey, posNeighbors, samePos, type Pos } from './hex';
import type {
  Campaign, Command, Contract, GameEvent, Hero, HeroClass, HeroInDelve, Item, Recruit, SpawnDef,
} from './types';
import {
  ARMOR_PRICE, BOUNTY, CLASSES, FOCUS_MAX, HEAL_PRICE, HEIRLOOM_VALUE, HEIRLOOMS, LEVEL_XP, LIGHT_MAX,
  MAX_LEVEL, MONSTERS, PACK_SLOTS, PRISONER_NAMES, RECRUIT_CLASSES, RECRUIT_NAMES, REP_FOR_LEVEL, REP_FOR_SLAY, SAPPER_CHARGES, SHOP, SISTER,
  SISTER_CLASSES, SISTER_DARTS, SISTER_NAMES, SISTER_SMOKE, START_GOLD, TAVERN_SIZE, TIERS, WEAPON_PRICE,
} from './data';
import { placeHoard } from './dragon';
import { HOARD_PIECES } from './data';
import { int, pick, random, shuffle } from './rng';
import type { Ctx, CrewX, DelveX, GameStateX, MonsterX } from './state';
import { makeItem, packUsed, valueOf } from './common';
import { canEnter, kindAt, type World } from './world';

export interface ContractX extends Contract {
  /** Prisoner or heirloom name. */
  subject: string;
}

type Res = { error?: string; events: GameEvent[] };

export function makeHero(id: string, name: string, cls: HeroClass, level = 1): Hero {
  const c = CLASSES[cls];
  const h: Hero = {
    id, name, cls, level: 1, xp: 0, maxHp: c.hp, stats: { ...c.stats },
    weaponTier: 0, armorTier: 0, wounded: 0, delves: 0, kills: 0,
  };
  while (h.level < level) levelUp(h);
  if (level > 1) h.xp = LEVEL_XP[level] ?? 0;
  return h;
}

function levelUp(h: Hero): void {
  h.level += 1;
  h.maxHp += 2;
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
      roster: [makeHero('hobart', 'Lord Hobart', 'hobart')],
      recruits: [],
      board: [],
      reputation: 0,
      delveCount: 0,
      fallen: [],
      litBraziers: [],
      lostGear: [],
    },
    delve: null,
    summary: null,
    nextId: 1,
    nextHero: 1,
  };
  refreshCamp(w, s);
  return s;
}

function newHeroId(s: GameStateX): string {
  s.nextHero = (s.nextHero ?? 1) + 1;
  return `h${s.nextHero - 1}`;
}

function usedNames(s: GameStateX): Set<string> {
  return new Set([...s.campaign.roster.map((h) => h.name), ...s.campaign.fallen.map((f) => f.name)]);
}

export function refreshCamp(w: World, s: GameStateX): void {
  s.campaign.board = makeBoard(w, s);
  const names = usedNames(s);
  const recruits: Recruit[] = [];
  // Four recruits, at least three different classes (spec 15.3): three distinct, one free pick.
  const classes = shuffle(s, [...RECRUIT_CLASSES]).slice(0, 3);
  classes.push(pick(s, RECRUIT_CLASSES));
  for (let i = 0; i < TAVERN_SIZE; i++) {
    const pool = RECRUIT_NAMES.filter((n) => !names.has(n));
    const name = pick(s, pool.length ? pool : RECRUIT_NAMES);
    names.add(name);
    const cls = classes[i]!;
    const level = random(s) < 0.35 ? 2 : 1;
    recruits.push({ hero: makeHero(newHeroId(s), name, cls, level), price: 40 + 20 * (level - 1) });
  }
  s.campaign.recruits = recruits;
}

function makeBoard(w: World, s: GameStateX): Contract[] {
  const rep = s.campaign.reputation;
  const open = (lv: number) => rep >= (REP_FOR_LEVEL[lv] ?? REP_FOR_LEVEL[REP_FOR_LEVEL.length - 1]!);
  const sites = w.castle.contractSites.filter((x) => x.kind !== 'slay' && open(x.at.level));
  const slay = rep >= REP_FOR_SLAY ? w.castle.contractSites.filter((x) => x.kind === 'slay') : [];
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
      const o = SHOP.find((x) => x.kind === cmd.kind);
      if (!o) return err('Not for sale.');
      if (C.gold < o.price) return err('Not enough gold.');
      C.gold -= o.price;
      C.stash.push(makeItem({ s }, o.kind, 1, o.name));
      events.push({ type: 'say', text: `Bought a ${o.name.toLowerCase()}.` });
      return { events };
    }
    case 'sellAll': {
      const sell = C.stash.filter((i) => i.kind === 'gem' || i.kind === 'jewelry' || i.kind === 'heirloom' || i.kind === 'hoard');
      if (!sell.length) return err('Nothing to sell.');
      const v = valueOf(sell);
      C.gold += v;
      C.stash = C.stash.filter((i) => !sell.includes(i));
      events.push({ type: 'say', text: `Sold ${sell.length} valuables for ${v} gold.` });
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
      if (!h.wounded) return err(`${h.name} is fit.`);
      if (C.gold < HEAL_PRICE) return err('Not enough gold.');
      C.gold -= HEAL_PRICE;
      h.wounded = 0;
      events.push({ type: 'say', text: `${h.name} is patched up.` });
      return { events };
    }
    case 'upgrade': {
      const h = C.roster.find((x) => x.id === cmd.heroId);
      if (!h) return err('No such hero.');
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
    if (h.wounded > 0) return `${h.name} is still wounded.`;
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
    if (h.wounded > 0) return err(`${h.name} is still wounded.`);
    heroes.push(h);
  }
  const entrance = w.castle.entrances[cmd.entrance];
  if (!entrance) return err('No such entrance.');
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
    lanternBearer: ids.includes('hobart') ? 'hobart' : ids[0]!,
    doors,
    chests: w.castle.chests.map((c) => ({ id: c.id, at: { ...c.at }, tier: c.tier, locked: !!c.locked, jammed: false, opened: false })),
    ground: [],
    traps: Object.fromEntries(w.castle.traps.map((t) => [posKey(t.at), { spotted: false }])),
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
  };
  // Coins and lost gear.
  for (const coin of w.castle.coins) d.ground.push({ at: { ...coin.at }, items: [makeItem({ s }, 'gold', coin.gold)] });
  for (const lg of C.lostGear) {
    d.ground.push({ at: { ...lg.at }, items: lg.items.map((i) => ({ ...i })) });
    d.lostIds!.push(...lg.items.map((i) => i.id));
  }
  // Objective.
  if (contract.kind === 'recover') {
    const it = makeItem({ s }, 'heirloom', HEIRLOOM_VALUE[contract.level] ?? 60, cap(contract.subject));
    it.contractId = contract.id;
    d.ground.push({ at: { ...site.at }, items: [it] });
  } else if (contract.kind === 'slay') {
    // Nothing to place: the Dragon is a castle spawn.
  } else {
    d.prisoner = { id: 'p1', name: contract.subject, at: { ...site.at }, hp: 5, freed: false, out: false, dead: false };
  }
  // The Dragon's hoard: what's been carried out never comes back.
  placeHoard(w, s, d, Math.max(0, HOARD_PIECES - (s.hoardTaken ?? 0)));
  // Rivals.
  if (w.castle.rivalEntrances.length && random(s) < 0.5) {
    const at = pick(s, w.castle.rivalEntrances);
    const crew: CrewX = {
      crew: 'lantern-sisters',
      name: 'The Lantern Sisters',
      stance: 'neutral',
      goal: 'loot',
      spotted: false,
      entersRound: int(s, 3, 6),
      members: SISTER_NAMES.map((n, i) => {
        const cls = SISTER_CLASSES[i % SISTER_CLASSES.length]!;
        return {
          id: `r${i + 1}`, crew: 'lantern-sisters' as const, name: n, at: { ...at }, hp: SISTER.hp, maxHp: SISTER.hp, loot: [], goneOut: false,
          cls,
          ...(cls === 'burglar' ? { darts: SISTER_DARTS } : {}),
          ...(cls === 'shadowmancer' ? { smoke: SISTER_SMOKE, veil: 0 } : {}),
          ...(cls === 'ranger' ? { overwatch: false } : {}),
        };
      }),
      pickups: 0,
      entered: false,
    };
    d.rivals = crew;
  }
  // Place heroes at the entrance and around it.
  const spots = freeSpotsNear(w, d, entrance, ids.length, monsters.map((m) => m.at));
  ids.forEach((id, i) => {
    const h = C.roster.find((x) => x.id === id)!;
    const hid: HeroInDelve = {
      heroId: id,
      at: spots[i] ?? { ...entrance },
      hp: h.maxHp,
      focus: FOCUS_MAX,
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
    };
    // Sappers bring two free charges (spec 15.3), on top of what fits.
    if (h.cls === 'sapper') {
      for (let i = 0; i < SAPPER_CHARGES && packUsed(hid.pack) < PACK_SLOTS; i++) hid.pack.push(makeItem({ s }, 'charge', 1, 'Blasting charge'));
    }
    d.heroes.push(hid);
  });
  s.delve = d;
  s.summary = null;
  s.stage = 'delve';
  return { events: [] };
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
  if (done) notes.unshift(`Contract done: ${d.contract.title}.`);
  else notes.unshift(`Contract failed: ${d.contract.title}.`);
  c.s.summary = {
    contractDone: done,
    bounty: done ? d.contract.bounty : 0,
    lootValue,
    survivors: out.map((h) => h.heroId),
    wounded: out.filter((h) => h.revived).map((h) => h.heroId),
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
      if (it.kind === 'gold') C.gold += it.amount;
      else C.stash.push(it);
    }
  }
  C.gold += sum.bounty;
  if (sum.contractDone) C.reputation += 1;
  // Heroes.
  const going = new Set(d.heroes.map((h) => h.heroId));
  for (const h of C.roster) {
    if (!going.has(h.id)) {
      if (h.wounded > 0) h.wounded -= 1;
      continue;
    }
    const hid = d.heroes.find((x) => x.heroId === h.id)!;
    h.kills += d.kills[h.id] ?? 0;
    h.xp += sum.xp[h.id] ?? 0;
    if (hid.status === 'out') {
      h.delves += 1;
      while (h.level < MAX_LEVEL && xpLevel(h.xp) > h.level) levelUp(h);
      if (hid.revived) h.wounded = 2;
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
    const items = g.items.filter((i) => lostIds.has(i.id) && i.kind !== 'heirloom' && i.kind !== 'hoard');
    if (items.length) lost.push({ at: { ...g.at }, items });
  }
  C.lostGear = lost;
  C.litBraziers = [...d.lit];
  // Prisoner joins.
  if (d.contract.kind === 'rescue' && d.prisoner?.out) {
    const cls = pick(s, RECRUIT_CLASSES);
    C.roster.push(makeHero(`h${(s.nextHero = (s.nextHero ?? 1) + 1) - 1}`, d.prisoner.name, cls));
  }
  const hobartDead = sum.dead.includes('hobart');
  s.delve = null;
  s.summary = null;
  if (hobartDead) {
    s.stage = 'over';
    s.overReason = 'The heir has fallen.';
    return { events: [{ type: 'say', text: 'The heir has fallen.' }] };
  }
  refreshCamp(w, s);
  s.stage = 'camp';
  return { events: [] };
}
