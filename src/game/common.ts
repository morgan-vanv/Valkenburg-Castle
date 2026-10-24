// Shared delve helpers: lookups, occupancy, rolls, damage, noise, loot.

import { distance, posKey, samePos, type Pos } from './hex';
import type { Brightness, Hero, HeroInDelve, Item, ItemKind, SlotRoll } from './types';
import {
  BLEED_START, CLASSES, GEMS, JEWELRY, MONSTERS, PACK_SLOTS,
} from './data';
import { chance, int, pick, random } from './rng';
import { newItemId, say, type Ctx, type MonsterX } from './state';
import { brightnessOf, litSet, noiseField, within, type World } from './world';

// ---------------------------------------------------------------- lookups

export function heroDef(c: Ctx, id: string): Hero | undefined {
  return c.s.campaign.roster.find((h) => h.id === id);
}

export function hd(c: Ctx, id: string): HeroInDelve | undefined {
  return c.d.heroes.find((h) => h.heroId === id);
}

export function heroName(c: Ctx, id: string): string {
  return heroDef(c, id)?.name ?? id;
}

export function nameOf(c: Ctx, id: string): string {
  const m = c.d.monsters.find((x) => x.id === id);
  if (m) return m.name;
  const r = c.d.rivals?.members.find((x) => x.id === id);
  if (r) return r.name;
  if (c.d.prisoner?.id === id) return c.d.prisoner.name;
  return heroName(c, id);
}

export function armorOf(h: Hero): number {
  return CLASSES[h.cls].armor + h.armorTier;
}

export function activeHeroes(c: Ctx): HeroInDelve[] {
  return c.d.heroes.filter((h) => h.status === 'active');
}

// ---------------------------------------------------------------- occupancy

/** Who stands at p: a hero (active/downed), monster, rival on the map, or the prisoner. */
export function occupant(c: Ctx, p: Pos): { kind: 'hero' | 'monster' | 'rival' | 'prisoner'; id: string } | null {
  for (const m of c.d.monsters) if (samePos(m.at, p)) return { kind: 'monster', id: m.id };
  for (const r of rivalsOnMap(c)) if (samePos(r.at, p)) return { kind: 'rival', id: r.id };
  for (const h of c.d.heroes) {
    if ((h.status === 'active' || h.status === 'downed') && samePos(h.at, p)) return { kind: 'hero', id: h.heroId };
  }
  const pr = c.d.prisoner;
  if (pr && !pr.out && !pr.dead && samePos(pr.at, p)) return { kind: 'prisoner', id: pr.id };
  return null;
}

export function rivalsOnMap(c: Ctx) {
  const cr = c.d.rivals;
  if (!cr || !cr.entered) return [];
  return cr.members.filter((r) => !r.goneOut && r.hp > 0);
}

export function monsterAt(c: Ctx, p: Pos): MonsterX | undefined {
  return c.d.monsters.find((m) => samePos(m.at, p));
}

// ---------------------------------------------------------------- light

/** Brightness a hero acts at: the lantern's level, at least Dark when outside all light. */
export function brightnessAt(w: World, c: Ctx, at: Pos, lit?: Set<string>): Brightness {
  const g = brightnessOf(c.d.light);
  const L = lit ?? litSet(w, c.d);
  if (L.has(posKey(at))) return g === 'pitch' ? 'dark' : g;
  return g === 'pitch' ? 'pitch' : 'dark';
}

export const LIGHT_PENALTY: Record<Brightness, number> = { bright: 0, dim: -10, dark: -20, pitch: -30 };

// ---------------------------------------------------------------- rolls

export function clampChance(p: number): number {
  return Math.max(5, Math.min(95, Math.round(p)));
}

/** Roll `slots` at `p`%, `focus` slots locked as hits first. Emits a roll event. */
export function roll(c: Ctx, who: string, what: string, slots: number, p: number, focus = 0): SlotRoll {
  const ch = clampChance(p);
  const f = Math.max(0, Math.min(focus, slots));
  const results: boolean[] = [];
  for (let i = 0; i < slots; i++) results.push(i < f ? true : chance(c.s, ch));
  const hits = results.filter(Boolean).length;
  const r: SlotRoll = { slots, chance: ch, focus: f, results, hits, perfect: slots > 0 && hits === slots };
  c.ev.push({ type: 'roll', who, what, roll: r });
  return r;
}

// ---------------------------------------------------------------- items

const SINGLE: Record<ItemKind, string> = {
  gold: 'Gold', gem: 'Gem', jewelry: 'Jewelry', torch: 'Torch', potion: 'Potion', rope: 'Rope',
  charge: 'Blasting charge', heirloom: 'Heirloom',
};

export function makeItem(c: { s: Ctx['s'] }, kind: ItemKind, amount = 1, name?: string): Item {
  return {
    id: newItemId(c.s),
    kind,
    name: name ?? (kind === 'gold' ? `${amount} gold` : SINGLE[kind]),
    amount,
    slots: kind === 'heirloom' ? 2 : 1,
  };
}

export function packUsed(pack: Item[]): number {
  return pack.reduce((n, i) => n + i.slots, 0);
}

/** Put item into pack if it fits (gold merges into stacks up to 100). Returns leftover or null. */
export function addToPack(c: Ctx, pack: Item[], item: Item): Item | null {
  if (item.kind === 'gold') {
    let left = item.amount;
    for (const g of pack) {
      if (g.kind !== 'gold' || g.amount >= 100) continue;
      const n = Math.min(100 - g.amount, left);
      g.amount += n;
      g.name = `${g.amount} gold`;
      left -= n;
      if (!left) return null;
    }
    while (left > 0 && packUsed(pack) < PACK_SLOTS) {
      const n = Math.min(100, left);
      pack.push(n === item.amount ? item : makeItem(c, 'gold', n));
      if (n === item.amount) {
        item.name = `${n} gold`;
      }
      left -= n;
    }
    if (left <= 0) return null;
    return { ...item, amount: left, name: `${left} gold` };
  }
  if (packUsed(pack) + item.slots > PACK_SLOTS) return item;
  pack.push(item);
  return null;
}

export function putOnGround(c: Ctx, at: Pos, items: Item[]): void {
  if (!items.length) return;
  const g = c.d.ground.find((x) => samePos(x.at, at));
  if (g) g.items.push(...items);
  else c.d.ground.push({ at, items: [...items] });
}

export function cleanGround(c: Ctx): void {
  c.d.ground = c.d.ground.filter((g) => g.items.length > 0);
}

/** Chest loot roll: d6 + tier. */
export function chestLoot(c: Ctx, tier: number): Item[] {
  const r = int(c.s, 1, 6) + tier;
  const T = tier;
  if (r <= 3) return [makeItem(c, 'gold', int(c.s, 15 * T, 30 * T))];
  if (r <= 5) {
    const extra = random(c.s) < 0.5 ? makeItem(c, 'torch') : makeItem(c, 'potion');
    return [makeItem(c, 'gold', int(c.s, 25 * T, 50 * T)), extra];
  }
  if (r <= 7) return [makeItem(c, 'gem', int(c.s, 40 * T, 80 * T), pick(c.s, GEMS))];
  return [makeItem(c, 'jewelry', int(c.s, 80 * T, 140 * T), pick(c.s, JEWELRY))];
}

export function valueOf(items: { kind: string; amount: number }[]): number {
  let v = 0;
  for (const i of items) if (i.kind === 'gold' || i.kind === 'gem' || i.kind === 'jewelry' || i.kind === 'heirloom') v += i.amount;
  return v;
}

// ---------------------------------------------------------------- damage

export function passLanternIfNeeded(c: Ctx): void {
  const b = hd(c, c.d.lanternBearer);
  if (b && b.status === 'active') return;
  const from = b?.at;
  const cands = activeHeroes(c);
  if (!cands.length) return;
  const far = (p: Pos) => (from && p.level === from.level ? distance(p, from) : 99);
  cands.sort((x, y) => far(x.at) - far(y.at));
  c.d.lanternBearer = cands[0]!.heroId;
  say(c, `${heroName(c, cands[0]!.heroId)} takes the lantern.`);
}

export function killHero(c: Ctx, h: HeroInDelve): void {
  h.status = 'dead';
  h.hp = 0;
  (c.d.diedAt ??= {})[h.heroId] = { ...h.at };
  c.ev.push({ type: 'died', id: h.heroId });
  say(c, `${heroName(c, h.heroId)} is dead.`);
  const drop = h.pack;
  (c.d.lostIds ??= []).push(...drop.filter((i) => i.kind !== 'heirloom').map((i) => i.id));
  putOnGround(c, h.at, drop);
  h.pack = [];
  if (h.escorting && c.d.prisoner) c.d.prisoner.escortedBy = undefined;
  h.escorting = undefined;
  // The lantern drops with them; the nearest active hero picks it up.
  if (c.d.lanternBearer === h.heroId) passLanternIfNeeded(c);
}

/** Damage a hero (already reduced by armor). Active → downed at 0; downed → dead. */
export function hurtHero(c: Ctx, h: HeroInDelve, dmg: number, by: string, crit = false): void {
  if (h.status === 'active') {
    h.hp -= dmg;
    c.ev.push({ type: 'hit', attacker: by, target: h.heroId, damage: dmg, crit });
    if (h.hp <= 0) {
      h.hp = 0;
      h.status = 'downed';
      h.bleed = BLEED_START;
      c.ev.push({ type: 'downed', id: h.heroId });
      say(c, `${heroName(c, h.heroId)} goes down.`);
      if (h.escorting && c.d.prisoner) c.d.prisoner.escortedBy = undefined;
      h.escorting = undefined;
      if (h.guarding) h.guarding = undefined;
      if (c.d.lanternBearer === h.heroId) passLanternIfNeeded(c);
    }
  } else if (h.status === 'downed') {
    c.ev.push({ type: 'hit', attacker: by, target: h.heroId, damage: dmg, crit });
    killHero(c, h);
  }
}

export function hurtPrisoner(c: Ctx, dmg: number, by: string): void {
  const p = c.d.prisoner;
  if (!p || p.dead || p.out) return;
  p.hp -= dmg;
  c.ev.push({ type: 'hit', attacker: by, target: p.id, damage: dmg, crit: false });
  if (p.hp <= 0) {
    p.hp = 0;
    p.dead = true;
    if (p.escortedBy) {
      const e = hd(c, p.escortedBy);
      if (e) e.escorting = undefined;
    }
    p.escortedBy = undefined;
    c.ev.push({ type: 'died', id: p.id });
    say(c, `${p.name} is dead. So is the contract.`);
    noteOnce(c, `${p.name} died in the castle.`);
  }
}

export function noteOnce(c: Ctx, text: string): void {
  const n = (c.d.notes ??= []);
  if (!n.includes(text)) n.push(text);
}

export function killMonster(c: Ctx, m: MonsterX, by: string | null): void {
  c.d.monsters = c.d.monsters.filter((x) => x !== m);
  c.ev.push({ type: 'monsterDied', id: m.id });
  if (m.stolen) {
    putOnGround(c, m.at, [m.stolen]);
    say(c, `${m.name} drops the ${m.stolen.name.toLowerCase()}.`);
  }
  if (by && hd(c, by)) {
    c.d.kills[by] = (c.d.kills[by] ?? 0) + 1;
    (c.d.xp ??= {})[by] = (c.d.xp[by] ?? 0) + (m.kind === 'gloam' ? 0 : MONSTERS[m.kind].xp);
  }
}

/** Damage to any creature by id (monster, rival, prisoner, hero). Hero damage here ignores armor. */
export function hurtAny(c: Ctx, id: string, dmg: number, by: string | null, opts: { crit?: boolean; noise?: boolean } = {}): void {
  const m = c.d.monsters.find((x) => x.id === id);
  if (m) {
    if (m.kind === 'gloam') return;
    m.hp -= dmg;
    c.ev.push({ type: 'hit', attacker: by ?? 'blast', target: m.id, damage: dmg, crit: !!opts.crit });
    if (m.awareness !== 'hunting') {
      m.awareness = 'hunting';
      const src = by ? hd(c, by) : undefined;
      if (src) m.focusAt = { ...src.at };
      c.ev.push({ type: 'awake', id: m.id, awareness: 'hunting' });
    }
    if (m.hp <= 0) {
      killMonster(c, m, by);
      if (opts.noise !== false) makeNoise(c, m.at, 2);
    }
    return;
  }
  const r = c.d.rivals?.members.find((x) => x.id === id);
  if (r) {
    r.hp -= dmg;
    c.ev.push({ type: 'hit', attacker: by ?? 'blast', target: r.id, damage: dmg, crit: !!opts.crit });
    if (by && hd(c, by)) makeHostile(c);
    if (r.hp <= 0) {
      r.hp = 0;
      c.ev.push({ type: 'monsterDied', id: r.id });
      say(c, `${r.name} falls.`);
      putOnGround(c, r.at, r.loot);
      r.loot = [];
      if (by && hd(c, by)) {
        c.d.kills[by] = (c.d.kills[by] ?? 0) + 1;
        (c.d.xp ??= {})[by] = (c.d.xp[by] ?? 0) + 1;
      }
      if (opts.noise !== false) makeNoise(c, r.at, 2);
    }
    return;
  }
  if (c.d.prisoner?.id === id) return hurtPrisoner(c, dmg, by ?? 'blast');
  const h = hd(c, id);
  if (h) hurtHero(c, h, dmg, by ?? 'blast', !!opts.crit);
}

export function makeHostile(c: Ctx): void {
  const cr = c.d.rivals;
  if (!cr || cr.stance === 'hostile') return;
  cr.stance = 'hostile';
  c.ev.push({ type: 'rivalsStance', stance: 'hostile' });
  say(c, 'The Lantern Sisters draw steel.');
}

// ---------------------------------------------------------------- noise

/** A ripple of radius R at `at`. Wakes sleepers, draws alert monsters. */
export function makeNoise(c: Ctx, at: Pos, radius: number, opts: { otherLevels?: boolean } = {}): void {
  if (radius <= 0) return;
  c.ev.push({ type: 'noise', at, radius });
  const heard = noiseField(c.w, c.d, at, radius);
  for (const m of c.d.monsters) {
    if (m.kind === 'gloam') continue;
    let hears = heard.has(posKey(m.at));
    if (!hears && opts.otherLevels && Math.abs(m.at.level - at.level) === 1) hears = distance(m.at, at) <= radius;
    if (!hears) continue;
    if (m.awareness === 'asleep') {
      m.awareness = m.kind === 'berserker' ? 'hunting' : 'alert';
      m.focusAt = { ...at };
      c.ev.push({ type: 'awake', id: m.id, awareness: m.awareness });
    } else if (m.awareness === 'alert') {
      m.focusAt = { ...at };
    } else if (m.kind === 'berserker' && !m.focusAt) {
      m.focusAt = { ...at };
    }
  }
}

export function wakeAdjacent(c: Ctx, at: Pos): void {
  for (const m of c.d.monsters) {
    if (m.awareness === 'asleep' && within(m.at, at, 1)) {
      m.awareness = m.kind === 'berserker' ? 'hunting' : 'alert';
      m.focusAt = { ...at };
      c.ev.push({ type: 'awake', id: m.id, awareness: m.awareness });
    }
  }
}

export { random };
