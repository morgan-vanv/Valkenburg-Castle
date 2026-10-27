// V4.1 WS4 (spec 31.6): the vendor catalog for Lowgate's Outfit step. Everything any vendor will ever sell, by vendor,
// with its gate and the in-voice hint shown while it's locked (docs/v41-vendors.md is the source). The Vendors side
// builds its rows from this table merged with what the engine lists (`engine.shop`, `engine.ales`): a row the engine
// sells is live at the engine's price; a row the engine doesn't list yet (a workstream not built on this branch) still
// shows, locked, with its hint. Pure data and logic: no DOM, so it is unit-tested (vendors.test.ts).
//
// Adding an item (later builders): add one row to CATALOG under its vendor, in the order it should show.
//   - `keys`: the engine's ShopKind (or AleKind for an ale). List several when a kind is being renamed
//     (['antidote', 'antipoison']): the first one the engine lists wins. Until the engine lists one, the row is locked.
//   - `gate`: who must be home (StoryIds). A pair lists both. The engine's own `locked` still wins when it lists the row.
//   - `hint`: Keven's thought or a villager's word, never the rule (pillar 11). `soon`: the line while the gate is met
//     but the engine doesn't sell it yet (defaults to the vendor's `soon`).
//   - `use`: one plain line, no numbers (pillar 15); the numbers are on hover (ITEM_EFFECT / the offer's text).

import type { AleKind, AleOffer, ShopOffer, StoryId, Vendor, Village } from '../game/types';
import * as DATA from '../game/data';

/** Playtest setting (owner, WS4): every vendor tab lists everything it will ever sell, locked rows dimmed with a hint. */
export const SHOW_LOCKED = true;

export type VendorId = 'mott' | 'gerda' | 'ilse' | 'flagon';
export const VENDOR_IDS: VendorId[] = ['mott', 'gerda', 'ilse', 'flagon'];

export interface VendorDef {
  id: VendorId;
  /** The tab's label. */
  tab: string;
  /** The header's name line. */
  name: string;
  /** The face's initial. */
  face: string;
  /** Who must be home for the vendor to be open (none: always). */
  home?: StoryId;
  /** Lines in their voice while open, one a delve in turn (Mott's patter comes from names.ts). */
  say: string[];
  /** While they're away: the header line, in voice. */
  away: string;
  /** While away: a second line. */
  awaySub: string;
  /** A row whose gate is met but the engine doesn't sell yet. */
  soon: string;
  /** While away, every row's hover says this instead of its own hint (the Flagon: the taps are dry). */
  awayHint?: string;
}

export const VENDORS: Record<VendorId, VendorDef> = {
  mott: {
    id: 'mott',
    tab: "Mott's wagon",
    name: 'Mott, by the gate',
    face: 'M',
    say: [],
    away: '',
    awaySub: '',
    soon: '"Next week, next week. The carter\'s late again."',
  },
  gerda: {
    id: 'gerda',
    tab: "Gerda's forge",
    name: "Gerda's forge",
    face: 'G',
    home: 'smith',
    say: ['Steel does what you paid for. No more, no less.', 'Bring it back dented. Not bent. Dented.', 'Your heir swings like a farmer. Let\'s give him something that forgives it.'],
    away: 'The forge is cold.',
    awaySub: 'Nobody in Lowgate works steel any more. They say Hobart\'s smith is still somewhere in the castle.',
    soon: '"Not yet. The mould\'s still setting."',
  },
  ilse: {
    id: 'ilse',
    tab: "Ilse's bench",
    name: "Ilse's bench",
    face: 'I',
    home: 'alchemist',
    say: ['Mind the green ones. And the blue ones. Mind all of them.', 'Don\'t sniff that. Well. Now you know.', 'Everything here is a medicine, in the right dose. The dose is the trick.'],
    away: 'The dye-house is shuttered.',
    awaySub: 'There was an alchemist in the castle once. The orcs would have kept her for her poisons.',
    soon: '"Still bubbling. Ask me after your next trip in."',
  },
  flagon: {
    id: 'flagon',
    tab: "The Flagon's taps",
    name: 'The Gilded Flagon',
    face: 'W',
    home: 'innkeeper',
    say: ['One a head, drunk as you go in. It lasts the delve.', 'Hobart drank here. Badly, but he drank here.', 'Pay now. The castle doesn\'t do tabs.'],
    away: "The Gilded Flagon's taps are dry.",
    awayHint: "The Gilded Flagon's taps are dry. Old Wim never came back from the kitchens.",
    awaySub: 'Old Wim never came back from the kitchens.',
    soon: '"That one\'s still in the barrel."',
  },
};

export type RowKind = 'ware' | 'gear' | 'shield' | 'ale' | 'perk';

export interface CatalogRow {
  /** Unique row id (a vendor can sell what another does: 'charge' at Mott, 'gerda-charge' at the forge). */
  id: string;
  vendor: VendorId;
  kind: RowKind;
  /** Engine kinds: ShopKind (wares), AleKind (ales), 'weapon' | 'armor' (gear). First the engine lists wins. */
  keys: string[];
  name: string;
  /** Group heading inside the tab. */
  group: string;
  /** One plain line (no numbers). */
  use: string;
  /** Catalog price (the engine's price wins when it lists the row). Gear: the tier-1 price. */
  price: number;
  /** Who must be home. */
  gate: StoryId[];
  /** The in-voice hint while locked. */
  hint: string;
  /** While the gate is met but the engine doesn't sell it yet (else the vendor's `soon`). */
  soon?: string;
  /** The workstream that builds it, if it came from the plan (for builders; never shown). */
  ws?: string;
  /** A glyph when the item kind has none in names.ts (arrows, gear). */
  glyph?: string;
}

const G = 'smith' as const;
const I = 'alchemist' as const;
const A = 'surgeon' as const;
const W = 'innkeeper' as const;

const COPPER_HINT = "Wim says his brewing copper's in the barracks, among the orcs.";
const CASK_HINT = "Wim swears the recipe's in his cask book. Lost in the Drain.";

/** Everything Lowgate will ever sell (docs/v41-vendors.md), vendor by vendor, in the order shown. */
export const CATALOG: CatalogRow[] = [
  // ---- Mott's wagon (from the start; Mott never locks anything)
  { id: 'torch', vendor: 'mott', kind: 'ware', keys: ['torch'], name: 'Torch', group: 'Light and mending', use: 'A light of your own, for a while.', price: 10, gate: [], hint: '' },
  { id: 'potion', vendor: 'mott', kind: 'ware', keys: ['potion'], name: 'Potion', group: 'Light and mending', use: 'Heals, or gets a downed friend up.', price: 20, gate: [], hint: '' },
  { id: 'antidote', vendor: 'mott', kind: 'ware', keys: ['antipoison', 'antidote'], name: 'Antipoison', group: 'Light and mending', use: 'Draws the poison out, yours or a friend\'s.', price: 20, gate: [], hint: '' },
  { id: 'rope', vendor: 'mott', kind: 'ware', keys: ['rope'], name: 'Rope', group: 'Getting in and around', use: 'Down a pit, and back up.', price: 15, gate: [], hint: '' },
  { id: 'charge', vendor: 'mott', kind: 'ware', keys: ['charge'], name: 'Blasting charge', group: 'Getting in and around', use: 'Blows doors, chests and walls open. Loud.', price: 45, gate: [], hint: '' },
  { id: 'firecracker', vendor: 'mott', kind: 'ware', keys: ['firecracker'], name: 'Firecracker', group: 'Quiet work', use: 'A loud bang, somewhere else.', price: 10, gate: [], hint: '' },
  { id: 'arrows', glyph: '➳', vendor: 'mott', kind: 'ware', keys: ['arrows'], name: 'Plain arrows', group: 'Arrows', use: 'A bundle for when the quiver runs dry.', price: 10, gate: [], hint: '', soon: '"Arrows? The fletcher\'s cart is due any day now."', ws: 'WS6' },
  { id: 'whistlearrows', glyph: '➳', vendor: 'mott', kind: 'ware', keys: ['whistlearrows', 'arrows-whistling'], name: 'Whistling arrows', group: 'Arrows', use: 'Shrieks where it lands. Draws them off.', price: 15, gate: [], hint: '', soon: '"Whistlers. I\'ve ordered a few. They\'re noisy in the post."', ws: 'WS6' },

  // ---- Gerda's forge (needs Gerda)
  { id: 'blade', glyph: '⚔', vendor: 'gerda', kind: 'gear', keys: ['weapon'], name: 'Blade', group: 'Gear for a hero', use: 'A keener edge on their weapon.', price: 60, gate: [G], hint: "Old Hobart's smith could put an edge on anything. If she's still alive down there..." },
  { id: 'mail', glyph: '▦', vendor: 'gerda', kind: 'gear', keys: ['armor'], name: 'Mail', group: 'Gear for a hero', use: 'Takes the sting out of every hit.', price: 80, gate: [G], hint: 'Proper mail needs a proper forge. Ours went cold the night the castle fell.' },
  { id: 'shield', glyph: '⛨', vendor: 'gerda', kind: 'shield', keys: ['shield'], name: 'Shield', group: 'Gear for a hero', use: 'Stops arrows and bolts short.', price: 50, gate: [G], hint: 'A good shield would stop those arrows. Nobody in Lowgate works steel any more.' },
  { id: 'lantern', vendor: 'gerda', kind: 'ware', keys: ['lantern'], name: 'Lantern', group: 'Metalwork', use: 'Light when you want it, dark when you don\'t. Keeps.', price: 120, gate: [G], hint: "A lantern with a shutter: light when we want it, dark when we don't. If only someone could make one.", ws: 'WS2' },
  { id: 'hook', vendor: 'gerda', kind: 'ware', keys: ['hook'], name: 'Grappling hook', group: 'Metalwork', use: 'Climb out of a pit, again and again.', price: 40, gate: [G], hint: 'With a hook I could climb out of that pit. Mott hasn\'t seen one in years.' },
  { id: 'key', vendor: 'gerda', kind: 'ware', keys: ['key'], name: 'Skeleton key', group: 'Metalwork', use: 'Opens one lock, silently.', price: 30, gate: [G], hint: 'Gerda used to cut keys for every lock in the keep, they say.' },
  { id: 'lockpicks', vendor: 'gerda', kind: 'ware', keys: ['lockpicks'], name: 'Lockpicks', group: 'Metalwork', use: 'Pick locks quietly, as often as you like.', price: 25, gate: [G], hint: 'Real picks, not bent nails. A smith\'s work.' },
  { id: 'caltrops', vendor: 'gerda', kind: 'ware', keys: ['caltrops'], name: 'Caltrops', group: 'Metalwork', use: 'Stops the first monster across.', price: 15, gate: [G], hint: 'Iron caltrops would slow them down. Iron needs a smith.' },
  { id: 'gerda-charge', vendor: 'gerda', kind: 'ware', keys: ['charge'], name: 'Blasting charge', group: 'Metalwork', use: 'Gerda\'s casing, Ilse\'s powder. Cheaper than Mott\'s.', price: 30, gate: [G, I], hint: "Gerda's iron and Ilse's powder. If only they were both here." },
  { id: 'barbarrows', glyph: '➳', vendor: 'gerda', kind: 'ware', keys: ['barbarrows', 'arrows-barbed'], name: 'Barbed arrows', group: 'Arrows', use: 'Holds a runner where it stands.', price: 25, gate: [G], hint: 'Barbed heads would hold a runner in place. A smith\'s work.', ws: 'WS6' },
  { id: 'ropearrow', glyph: '➳', vendor: 'gerda', kind: 'ware', keys: ['ropearrow', 'arrows-rope'], name: 'Rope arrow', group: 'Arrows', use: 'A line across a pit, or up a ledge.', price: 30, gate: [G], hint: 'A line fired across the pit... it would take a smith to forge the head.', ws: 'WS6' },
  { id: 'blastarrows', glyph: '➳', vendor: 'gerda', kind: 'ware', keys: ['blastarrows', 'arrows-blast'], name: 'Blast arrows', group: 'Arrows', use: 'Bursts where it lands, like a small charge.', price: 40, gate: [G, I], hint: 'An arrow that bursts where it lands. That would take a smith and an alchemist together.', ws: 'WS6' },

  // ---- Ilse's bench (needs Ilse)
  { id: 'oil', vendor: 'ilse', kind: 'ware', keys: ['oil'], name: 'Oil flask', group: 'Light and mending', use: 'Tops up a lantern.', price: 15, gate: [I], hint: 'Lamp oil, refined. Ilse would know how.' },
  { id: 'greaterpotion', vendor: 'ilse', kind: 'ware', keys: ['greaterpotion'], name: 'Greater potion', group: 'Light and mending', use: 'Heals more, or gets a downed friend up stronger.', price: 35, gate: [I, A], hint: "Brother Aldric's herbs and an alchemist's still. One day." },
  { id: 'ilse-antidote', vendor: 'ilse', kind: 'ware', keys: ['antipoison', 'antidote'], name: 'Antipoison', group: 'Light and mending', use: 'Brother Aldric\'s recipe, cheaper than Mott\'s.', price: 12, gate: [I, A], hint: 'Aldric says he could make these cheap, with the right help.' },
  { id: 'dart', vendor: 'ilse', kind: 'ware', keys: ['dart'], name: 'Sleep dart', group: 'Quiet work', use: 'Puts a monster to sleep, silently.', price: 25, gate: [I], hint: 'There was an alchemist in the castle once. The orcs would have kept her for her poisons.' },
  { id: 'venomdart', vendor: 'ilse', kind: 'ware', keys: ['poisondart', 'venomdart'], name: 'Poison dart', group: 'Quiet work', use: 'Poisons whatever it hits, silently.', price: 30, gate: [I], hint: 'Smells like something Ilse would mix. If we ever find her.' },
  { id: 'smoke', vendor: 'ilse', kind: 'ware', keys: ['smoke'], name: 'Smoke bomb', group: 'Quiet work', use: 'Blinds both ways. Hunters lose you.', price: 20, gate: [I], hint: 'Smoke to hide in. Somebody in that castle used to make it by the barrel.' },
  { id: 'glue', vendor: 'ilse', kind: 'ware', keys: ['glue'], name: 'Glue bomb', group: 'Quiet work', use: 'Sticks monsters where they stand.', price: 25, gate: [I], hint: 'Sticky, nasty stuff. An alchemist\'s work.' },
  { id: 'glowarrows', glyph: '➳', vendor: 'ilse', kind: 'ware', keys: ['glowarrows', 'arrows-glow'], name: 'Glow arrows', group: 'Arrows', use: 'Lights up where it lands.', price: 20, gate: [I], hint: 'Arrows that light where they land. If we had an alchemist...', ws: 'WS6' },
  { id: 'firearrows', glyph: '➳', vendor: 'ilse', kind: 'ware', keys: ['firearrows', 'arrows-fire'], name: 'Fire arrows', group: 'Arrows', use: 'Sets the spot it hits burning.', price: 25, gate: [I], hint: 'Pitch and fire on an arrowhead. Ilse could mix it.', ws: 'WS6' },
  { id: 'poisonarrows', glyph: '➳', vendor: 'ilse', kind: 'ware', keys: ['poisonarrows', 'arrows-poison'], name: 'Poison arrows', group: 'Arrows', use: 'A hit poisons.', price: 30, gate: [I], hint: 'Spider venom on an arrowhead. Only an alchemist would dare.', ws: 'WS6' },

  // ---- The Flagon's taps (one ale per hero per delve; needs Wim)
  { id: 'ale-glowworm', vendor: 'flagon', kind: 'ale', keys: ['glowworm'], name: 'Glowworm Pale', group: 'On tap', use: '', price: 15, gate: [W, 'copper'], hint: COPPER_HINT },
  { id: 'ale-featherfoot', vendor: 'flagon', kind: 'ale', keys: ['featherfoot'], name: 'Featherfoot', group: 'On tap', use: '', price: 15, gate: [W, 'copper'], hint: COPPER_HINT },
  { id: 'ale-mole', vendor: 'flagon', kind: 'ale', keys: ['mole'], name: "Mole's Brown", group: 'On tap', use: '', price: 20, gate: [W, 'copper'], hint: COPPER_HINT },
  { id: 'ale-reserve', vendor: 'flagon', kind: 'ale', keys: ['reserve'], name: "Hobart's Reserve", group: 'On tap', use: '', price: 20, gate: [W, 'copper'], hint: COPPER_HINT },
  { id: 'ale-smuggler', vendor: 'flagon', kind: 'ale', keys: ['smuggler'], name: "Smuggler's Mead", group: 'From the cask book', use: '', price: 20, gate: [W, 'copper', 'caskbook'], hint: CASK_HINT },
  { id: 'ale-fireside', vendor: 'flagon', kind: 'ale', keys: ['fireside'], name: 'Fireside Porter', group: 'From the cask book', use: '', price: 25, gate: [W, 'copper', 'caskbook'], hint: CASK_HINT },
  { id: 'ale-blackcask', vendor: 'flagon', kind: 'ale', keys: ['blackcask'], name: 'Black Cask', group: 'From the cask book', use: '', price: 10, gate: [W, 'copper', 'caskbook'], hint: CASK_HINT },
  { id: 'ale-nighteye', vendor: 'flagon', kind: 'ale', keys: ['nighteye'], name: 'Night-eye Stout', group: "Wim and Ilse's brews", use: '', price: 25, gate: [W, I], hint: 'A stout to see in the dark. Wim and an alchemist together could brew it.', ws: 'WS2' },
  { id: 'ale-spidermilk', vendor: 'flagon', kind: 'ale', keys: ['spidermilk'], name: 'Spider-milk Stout', group: "Wim and Ilse's brews", use: '', price: 20, gate: [W, I], hint: 'Wim and an alchemist could brew something that laughs at poison.', ws: 'WS3' },
  { id: 'ale-dragonfire', vendor: 'flagon', kind: 'ale', keys: ['dragonfire'], name: 'Dragonfire Porter', group: "Wim and Ilse's brews", use: '', price: 25, gate: [W, I], hint: 'A porter that cools the burn. Wim and Ilse together, maybe.' },
];

/** Village perks: not bought, shown as lines under their vendor (live or locked). */
export interface PerkDef {
  id: string;
  vendor: VendorId;
  name: string;
  /** While live: what it does, in a line (numbers allowed: it's the perk itself). */
  live: string;
  gate: StoryId[];
  hint: string;
  /** A data.ts export that exists once the rule is built (see perkStatus). */
  marker?: string;
  ws?: string;
}
export const PERKS: PerkDef[] = [
  { id: 'splints', vendor: 'gerda', name: 'Splints', live: 'A downed hero can crawl a hex a turn.', gate: [G, A], hint: 'With splints and a smith\'s frame, a downed friend could drag themselves out.', marker: 'CRAWL_MOVE', ws: 'WS3' },
  { id: 'supper', vendor: 'flagon', name: 'Hot supper', live: 'Heroes who get out heal 2 on the way home.', gate: [A, W], hint: "Wim's cooking and Aldric's care. If only both were home.", marker: 'SUPPER_HEAL' },
];

/**
 * A perk's state: live once its pair is home and the rule is built. "Built" = data.ts exports the perk's `marker`
 * (the builder of the rule exports it, or points `marker` at the constant they did export).
 */
export function perkStatus(p: PerkDef, v: Partial<Village>): 'live' | 'locked' | 'soon' {
  if (!gateMet(v, p.gate)) return 'locked';
  return !p.marker || (DATA as unknown as Record<string, unknown>)[p.marker] !== undefined ? 'live' : 'soon';
}

// ------------------------------------------------------------ status: the catalog merged with the engine

export type RowState = 'live' | 'locked' | 'soon' | 'moved';

export interface RowStatus {
  state: RowState;
  /** The engine kind that matched (live, moved). */
  key?: string;
  /** Price now (the engine's when it lists the row). */
  price: number;
  /** The engine's name when it lists the row, else the catalog's. */
  name: string;
  /** The engine's rule text (for the hover), if any. */
  text?: string;
  /** Locked or soon: the in-voice hint. */
  hint?: string;
  /** Moved: the vendor that sells it now. */
  movedTo?: VendorId;
}

export const gateMet = (v: Partial<Village>, gate: StoryId[]): boolean => gate.every((id) => !!v[id]);
export const vendorHome = (v: Partial<Village>, id: VendorId): boolean => {
  const home = VENDORS[id].home;
  return !home || !!v[home];
};

/** The engine's seller (`ShopOffer.vendor`) as a tab: Aldric's pair ware (the cheap antipoison) sits at Ilse's bench. */
export function tabOf(v: Vendor | undefined): VendorId {
  return v === 'gerda' ? 'gerda' : v === 'ilse' || v === 'aldric' ? 'ilse' : 'mott';
}

/** A row's state against the engine's lists and the village. */
export function rowStatus(row: CatalogRow, v: Partial<Village>, shop: ShopOffer[], ales: AleOffer[]): RowStatus {
  const met = gateMet(v, row.gate);
  const locked = (): RowStatus => ({ state: 'locked', price: row.price, name: row.name, hint: row.hint || VENDORS[row.vendor].soon });
  if (row.kind === 'gear' || row.kind === 'shield') {
    // The forge's own work (engine: `upgrade`, `buyShield`): open while Gerda is home.
    return met ? { state: 'live', key: row.keys[0], price: row.price, name: row.name } : locked();
  }
  if (row.kind === 'ale') {
    const o = ales.find((x) => row.keys.includes(x.kind));
    if (!o) return met ? { state: 'soon', price: row.price, name: row.name, hint: row.soon ?? VENDORS[row.vendor].soon } : locked();
    if (o.locked || !met) return { ...locked(), price: o.price, name: o.name || row.name };
    return { state: 'live', key: o.kind, price: o.price, name: o.name || row.name, text: o.text };
  }
  const o = row.keys.map((k) => shop.find((x) => x.kind === k)).find((x): x is ShopOffer => !!x);
  if (!o) return met ? { state: 'soon', price: row.price, name: row.name, hint: row.soon ?? VENDORS[row.vendor].soon } : locked();
  // The engine's name, so the row and what lands on the cart agree (an engine rename shows here at once).
  const name = o.name || row.name;
  if (!met || o.locked) return { ...locked(), name };
  const seller = tabOf(o.vendor);
  if (seller !== row.vendor) return { state: 'moved', key: o.kind, price: row.price, name, text: o.text, movedTo: seller };
  return { state: 'live', key: o.kind, price: o.price, name, text: o.text };
}

/** A vendor's rows, grouped in catalog order. */
export function vendorGroups(id: VendorId): { group: string; rows: CatalogRow[] }[] {
  const out: { group: string; rows: CatalogRow[] }[] = [];
  for (const r of CATALOG) {
    if (r.vendor !== id) continue;
    const g = out.find((x) => x.group === r.group);
    if (g) g.rows.push(r);
    else out.push({ group: r.group, rows: [r] });
  }
  return out;
}

/** The vendor tab a villager (or the thing they wait for) belongs to, for "Show me". */
export function vendorOfStory(id: StoryId): VendorId | undefined {
  return id === 'smith' ? 'gerda' : id === 'alchemist' ? 'ilse' : id === 'copper' || id === 'caskbook' ? 'flagon' : undefined;
}

/** The ales' kinds in the catalog (for the check that every engine ale has a row). */
export const CATALOG_ALES = CATALOG.filter((r) => r.kind === 'ale').flatMap((r) => r.keys) as AleKind[];
