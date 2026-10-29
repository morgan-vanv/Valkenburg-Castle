// V5.1 (W3): the Outfit board's pure helpers (no DOM, unit-tested in outfit-logic.test.ts): which kit icon an item
// kind shows, which item a purchase put in the stash (the engine's `buy` adds to campaign.stash; the board then packs
// it for a hero), whether a thing fits a pack, and what sits on the wagon (spares grouped by kind, loot one by one).

import type { Item } from '../../game/types';
import type { CampIcon } from './icons';

export interface PackLoadout {
  heroIds: string[];
  packs: Record<string, string[]>;
}

const ICON: Record<string, CampIcon> = {
  torch: 'torch', lantern: 'lantern', oil: 'flame',
  potion: 'potion', greaterpotion: 'potion', antidote: 'leaf', antipoison: 'leaf', nightsight: 'moon',
  rope: 'rope', hook: 'chain', grapple: 'chain', key: 'lock', gatekey: 'lock', lockpicks: 'pick', improvised: 'pick',
  charge: 'bomb', 'improvised-charge': 'bomb', firecracker: 'fuse', caltrops: 'star',
  smoke: 'hood', glue: 'spider', dart: 'moon', venomdart: 'spider', poisondart: 'spider',
  quiver: 'bow', arrows: 'arrow', whistlearrows: 'arrow', glowarrows: 'arrow', firearrows: 'arrow', poisonarrows: 'arrow', barbarrows: 'arrow', ropearrow: 'arrow', blastarrows: 'arrow',
  gem: 'gem', jewelry: 'crown', heirloom: 'chest', hoard: 'crown', gold: 'coin',
  weapon: 'sword', armor: 'mail', shield: 'shield', ale: 'mug',
};

/** The camp kit icon for an item kind (or a catalog key: 'weapon', 'armor', 'shield'); a sack when unknown. */
export function itemIcon(kind: string): CampIcon {
  return ICON[kind] ?? ICON[kind.toLowerCase()] ?? 'sack';
}

/** A tint class for icons that share a glyph (arrows, potions), so they read apart on the shelf. */
export function itemTint(kind: string): string {
  if (/fire|blast/.test(kind)) return 't-fire';
  if (/poison|venom|glue/.test(kind)) return 't-venom';
  if (/glow|whistle/.test(kind)) return 't-glow';
  if (kind === 'greaterpotion') return 't-great';
  if (/gem/.test(kind)) return 't-gem';
  return '';
}

/** Ids in `after` that were not in `before` (what a purchase added to the stash), in stash order. */
export function newItemIds(before: readonly string[], after: readonly Item[]): string[] {
  const had = new Set(before);
  return after.filter((i) => !had.has(i.id)).map((i) => i.id);
}

/** Slots a hero's pack uses. */
export function packUsed(l: PackLoadout, heroId: string, stash: readonly Item[]): number {
  return (l.packs[heroId] ?? []).reduce((a, id) => a + (stash.find((i) => i.id === id)?.slots ?? 0), 0);
}

/** Does an item of `slots` fit the hero's pack (of `size` slots)? */
export function fitsPack(l: PackLoadout, heroId: string, stash: readonly Item[], slots: number, size: number): boolean {
  return packUsed(l, heroId, stash) + slots <= size;
}

/**
 * Move an item into a hero's pack (out of any other pack it was in). Returns the new loadout, or null when it does
 * not fit (it stays where it was: on the wagon when it was new). Pure: `l` is not changed.
 */
export function packInto(l: PackLoadout, heroId: string, itemId: string, stash: readonly Item[], size: number): PackLoadout | null {
  const it = stash.find((i) => i.id === itemId);
  if (!it || !l.heroIds.includes(heroId)) return null;
  if ((l.packs[heroId] ?? []).includes(itemId)) return l;
  if (!fitsPack(l, heroId, stash, it.slots, size)) return null;
  const packs: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(l.packs)) packs[k] = v.filter((x) => x !== itemId);
  packs[heroId] = [...(packs[heroId] ?? []), itemId];
  return { ...l, packs };
}

/** Take an item out of every pack (back onto the wagon). Pure. */
export function unpack(l: PackLoadout, itemId: string): PackLoadout {
  const packs: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(l.packs)) packs[k] = v.filter((x) => x !== itemId);
  return { ...l, packs };
}

/**
 * After a `buy`: the item the purchase added, packed for the hero when it fits. `packed` false (and the loadout
 * unchanged) means it stays on the wagon: no hero, a full pack, or no new item found.
 */
export function packAfterBuy<L extends PackLoadout>(l: L, heroId: string | null | undefined, beforeIds: readonly string[], after: readonly Item[], size: number): { loadout: L; itemId?: string; packed: boolean } {
  const id = newItemIds(beforeIds, after)[0];
  if (!id) return { loadout: l, packed: false };
  if (!heroId) return { loadout: l, itemId: id, packed: false };
  const next = packInto(l, heroId, id, after, size);
  return next ? { loadout: { ...l, packs: next.packs }, itemId: id, packed: true } : { loadout: l, itemId: id, packed: false };
}

const VALUABLE = new Set(['gem', 'jewelry', 'heirloom', 'hoard']);

/** What waits on the wagon: spares (unpacked gear, grouped by kind, first-bought first) and loot (unpacked valuables). */
export function wagonOf(stash: readonly Item[], l: PackLoadout): { spares: { kind: string; items: Item[] }[]; loot: Item[] } {
  const packed = new Set(Object.values(l.packs).flat());
  const spares: { kind: string; items: Item[] }[] = [];
  const loot: Item[] = [];
  for (const i of stash) {
    if (packed.has(i.id) || i.story || i.kind === 'gold') continue;
    if (VALUABLE.has(i.kind)) {
      loot.push(i);
      continue;
    }
    const g = spares.find((x) => x.kind === i.kind);
    if (g) g.items.push(i);
    else spares.push({ kind: i.kind, items: [i] });
  }
  return { spares, loot };
}

/** Split a list into pages of `per` (at least one page, possibly empty). */
export function pages<T>(list: readonly T[], per: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += per) out.push(list.slice(i, i + per));
  return out.length ? out : [[]];
}
