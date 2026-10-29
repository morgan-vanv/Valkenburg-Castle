// V5.1 (W3): step 3, Outfit, on the 1920x900 main of the camp stage (board: Outfit.dc.html). Left, the party's packs
// (hex slots, "Buying here" on the chosen hero) over Keven's wagon (spares and loot only). Right, the vendors: a tab
// per vendor with their bust, a shelf of up to 8 wares on hex pedestals, and a strip of locked wares under it.
// Drag a ware onto a pack to buy and pack it in one move; Buy fills the chosen hero (their face is on the button).
// No engine change: `buy` puts the new thing in the stash, and the board packs it (outfit-logic.ts packAfterBuy).
// Drag also works between packs, from the wagon and back; every drag works by click and keyboard too (drag.ts).
// The wagon's side page (cartPage) is the same packs beside a big wagon. Details are in hover tips, never on the face.

import type { AleKind, AleOffer, Campaign, GameState, Hero, Item, ShopOffer } from '../../game/types';
import { ARMOR_PRICE, ARROWS_PER_LEVEL, CLASSES, PACK_SLOTS, WEAPON_PRICE, kitPerDelve, quiverPerDelve } from '../../game/data';
import { sfx } from '../../audio/sfx';
import { h } from '../dom';
import { ALE, ALE_SHORT, ITEM_EFFECT, PEDDLER_PATTER, V37, WARE, className, itemBase, itemLabel } from '../names';
import { CATALOG, type CatalogRow, PERKS, type PerkDef, type RowStatus, VENDORS, VENDOR_IDS, type VendorId, perkStatus, rowStatus, tabOf, vendorGroups, vendorHome } from '../vendors';
import { type CampPage, type Loadout, type CampHost, isValuable, packItems, slotsUsed, packedIds, numWord, heroOf, statsTip, btn, ui, villageOf } from './shared';
import { ic, type CampIcon } from './icons';
import { bust, bustKey } from './bust';
import { makeDraggable, makeDropTarget } from './drag';
import { itemIcon, itemTint, packAfterBuy, packInto, pages, unpack, wagonOf } from './outfit-logic';
import './outfit.css';

/** The shelf holds 8 wares a page; the locked strip 4 tiles a page (Handoff: no scrolling, cap or page). */
const SHELF = 8;
const STRIP = 4;

/** The vendors' faces and short names (busts from the hero rig; the board's casting). */
const VFACE: Record<VendorId, { cls: string; name: string; sub: string }> = {
  mott: { cls: 'sapper', name: 'Mott', sub: 'The wagon' },
  gerda: { cls: 'sellsword', name: 'Gerda', sub: 'The forge' },
  ilse: { cls: 'hedgewitch', name: 'Ilse', sub: 'Her bench' },
  flagon: { cls: 'burglar', name: 'Wim', sub: 'The Flagon' },
};

/** Paging between renders (not worth a save). */
const view = { shelf: {} as Partial<Record<VendorId, number>>, strip: {} as Partial<Record<VendorId, number>> };

/** What a drag carries: a ware (or forge work, an ale) off the shelf, or a thing already owned. */
type Pay = { t: 'buy'; r: CatalogRow; st: RowStatus } | { t: 'item'; id: string };

interface Ctx {
  s: GameState;
  c: Campaign;
  l: Loadout;
  host: CampHost;
  page: CampPage;
  who: Hero | undefined;
  shop: ShopOffer[];
  ales: AleOffer[];
}

const coinPrice = (n: number, label?: string) => h('span', { class: 'price', 'data-price': `${n}` }, ic('coin'), h('span', { class: 'num' }, label ?? `${n}`));
const heroName = (c: Campaign, id: string) => heroOf(c, id)?.name ?? id;
const plural = (n: number, w: string) => `${numWord(n).toLowerCase()} ${w}${n === 1 ? '' : 's'}`;

// ------------------------------------------------------------------------------------------------ the step

export function outfitStep(main: HTMLElement, s: GameState, l: Loadout, host: CampHost): void {
  const x = ctxOf(s, l, host, 'outfit');
  const root = h('div', { class: 'of', 'data-board': 'outfit' });
  const left = h('section', { class: 'of-col of-yours', 'data-side': 'yours', 'aria-label': 'Your packs and the wagon' });
  left.append(partyPacks(x), wagon(x, false));
  root.append(left, shopSide(x));
  main.append(root);
  ui.flash = null; // shown once
}

/** Keven's wagon, the side page from the header's wagon: the same packs, beside a big wagon. */
export function cartPage(main: HTMLElement, s: GameState, l: Loadout, host: CampHost): void {
  const x = ctxOf(s, l, host, 'cart');
  const root = h('div', { class: 'of of-cart', 'data-board': 'cart' });
  const left = h('section', { class: 'of-col of-yours', 'data-side': 'yours', 'aria-label': 'Your packs' });
  left.append(partyPacks(x));
  root.append(left, wagon(x, true));
  main.append(root);
  ui.flash = null;
}

/** The footer's one line for this board (the shell calls it). */
export function footNote(s: GameState, l: Loadout, host: CampHost): string | Node | null {
  if (host.page === 'cart') return l.heroIds.length ? 'Drag things between the wagon and the packs. Loot sells from here.' : 'Pick a party to pack for. Loot sells from here.';
  if (host.page !== 'outfit') return null;
  if (!l.heroIds.length) return 'Nobody to pack for yet. Pick a party first.';
  void s;
  return 'Drag a ware onto any pack to buy it there. Click Buy to fill the chosen hero.';
}

function ctxOf(s: GameState, l: Loadout, host: CampHost, page: CampPage): Ctx {
  const c = s.campaign;
  let shop: ShopOffer[] = [];
  let ales: AleOffer[] = [];
  try {
    shop = host.engine.shop(s);
  } catch {
    shop = [];
  }
  try {
    ales = host.engine.ales(s);
  } catch {
    ales = [];
  }
  return { s, c, l, host, page, who: ui.packFor ? heroOf(c, ui.packFor) : undefined, shop, ales };
}

// ------------------------------------------------------------------------------------------------ buying

/** Buy a ware for a hero (or onto the wagon) and pack it when it fits. */
async function buyWare(x: Ctx, r: CatalogRow, st: RowStatus, heroId: string | null): Promise<void> {
  const { c, host, l } = x;
  const before = c.stash.map((i) => i.id);
  if (!(await host.send({ type: 'buy', kind: st.key as ShopOffer['kind'] }))) return;
  sfx.play('coin');
  const now = host.state();
  const res = packAfterBuy(l, heroId, before, now?.campaign.stash ?? [], PACK_SLOTS);
  const name = st.name;
  const who = heroId ? heroName(c, heroId) : '';
  ui.flash = res.packed
    ? { row: r.id, itemId: res.itemId, text: `${name} into ${who}'s pack.` }
    : { row: r.id, cart: st.key, text: heroId ? `${who}'s pack is full. The ${name.toLowerCase()} waits on the wagon.` : `${name} on the wagon.` };
  host.setDraft(res.loadout, x.page);
}

/** Forge work, a shield or an ale for a hero. */
async function buyFor(x: Ctx, r: CatalogRow, st: RowStatus, heroId: string): Promise<void> {
  const { host, c } = x;
  if (r.kind === 'gear') {
    if (await host.send({ type: 'upgrade', heroId, part: r.keys[0] as 'weapon' | 'armor' })) sfx.play('smash', { pitch: 2, gain: 0.4 });
  } else if (r.kind === 'shield') {
    if (await host.send({ type: 'buyShield', heroId })) sfx.play('smash', { pitch: 1.6, gain: 0.4 });
  } else if (r.kind === 'ale') {
    if (await host.send({ type: 'buyAle', heroId, ale: st.key as AleKind })) sfx.play('coin', { pitch: 0.8 });
  } else return;
  ui.flash = { row: r.id, text: `${st.name} for ${heroName(c, heroId)}.` };
  host.setPage(x.page);
}

/** What a shelf thing costs for a hero now (gear climbs by tier; Gerda's gift is free); null when there is nothing to buy. */
function priceFor(x: Ctx, r: CatalogRow, st: RowStatus, hr: Hero | undefined): number | null {
  if (r.kind === 'gear') {
    const tier = hr ? (r.keys[0] === 'weapon' ? hr.weaponTier : hr.armorTier) : 0;
    return tier >= 2 ? null : (r.keys[0] === 'weapon' ? WEAPON_PRICE : ARMOR_PRICE)[tier + 1]!;
  }
  if (r.kind === 'shield') return (x.c.credits?.shield ?? 0) > 0 ? 0 : V37.shieldPrice;
  return st.price;
}

/** Why a hero can't take this shelf thing now (true: they can). */
function heroTakesBuy(x: Ctx, r: CatalogRow, st: RowStatus, hr: Hero): true | string {
  const price = priceFor(x, r, st, hr);
  if (r.kind === 'gear' && price === null) return `${hr.name} has the best Gerda makes.`;
  if (r.kind === 'shield' && hr.shield) return `${hr.name} carries a shield already.`;
  if (r.kind === 'ale' && hr.ale) return `${hr.name} has ${ALE[hr.ale].name} waiting. One a delve.`;
  if (price !== null && x.c.gold < price) return `Not enough gold: ${price}. You have ${x.c.gold}.`;
  if (r.kind === 'ware' && slotsUsed(packItems(x.c, x.l, hr.id)) + 1 > PACK_SLOTS) return `${hr.name}'s pack is full.`;
  return true;
}

// ------------------------------------------------------------------------------------------------ the party's packs

function partyPacks(x: Ctx): HTMLElement {
  const { c, l } = x;
  const n = l.heroIds.length;
  const box = h('div', { class: `of-party n${Math.max(1, n)}`, 'aria-label': 'Packs' });
  if (!n) {
    box.append(h('div', { class: 'of-nobody' }, ic('banner'), h('span', null, 'Nobody is going in yet.'), btn({ class: 'btn', k: 'of-party', onclick: () => x.host.setPage('party') }, 'Pick a party')));
    return box;
  }
  for (const id of l.heroIds) {
    const hr = heroOf(c, id);
    if (hr) box.append(heroCard(x, hr));
  }
  return box;
}

function heroCard(x: Ctx, hr: Hero): HTMLElement {
  const { c, l, host } = x;
  const sel = ui.packFor === hr.id;
  const many = l.heroIds.length > 1;
  const pick = () => {
    if (ui.packFor === hr.id) return;
    ui.packFor = hr.id;
    sfx.play('click');
    host.setPage(x.page);
  };
  const card = h('section', {
    class: `hr ${sel ? 'sel' : ''}`,
    style: `--c:var(--k-${bustKey(hr.cls)})`,
    'data-hero': hr.id,
    'data-packfor': hr.id,
    'data-k': `pack-${hr.id}`,
    role: 'button',
    tabindex: 0,
    'aria-pressed': sel ? 'true' : 'false',
    'aria-label': `${hr.name}'s pack${sel ? ', buying here' : ''}`,
  });
  card.addEventListener('click', (e) => {
    if (e.target instanceof Element && e.target.closest('[data-drag],button')) return;
    pick();
  });
  card.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target === card) {
      e.preventDefault();
      pick();
    }
  });
  const name = h('div', { class: 'nm' }, h('b', { 'data-tip': statsTip(hr.cls, hr) }, hr.name), h('span', { class: 'cl' }, hr.cls === 'heir' ? 'The heir' : className(hr.cls)), h('span', { class: 'lv num', 'data-tip': `Level ${hr.level}` }, `${hr.level}`));
  if (sel && x.page === 'outfit') name.append(h('span', { class: 'tgt', 'data-tip': many ? `Buying here · Buy fills ${hr.name}'s pack; forge work and ales are for ${hr.name}.\nClick another hero to buy for them, or drag a ware onto any pack.` : `Buying here · Buy fills ${hr.name}'s pack.` }, ic('check'), 'Buying here'));
  card.append(h('div', { class: 'bw', 'aria-hidden': 'true' }, bust(hr.cls, { size: 96 })), name, packRow(x, hr), gearRow(hr, packItems(c, l, hr.id)));
  makeDropTarget<Pay>(card, {
    accepts: (p) => {
      if (p.t === 'buy') return heroTakesBuy(x, p.r, p.st, hr);
      if ((l.packs[hr.id] ?? []).includes(p.id)) return `Already in ${hr.name}'s pack.`;
      const it = c.stash.find((i) => i.id === p.id);
      return it && slotsUsed(packItems(c, l, hr.id)) + it.slots <= PACK_SLOTS ? true : `${hr.name}'s pack is full.`;
    },
    hint: (p) => (p.t === 'buy' ? `${priceFor(x, p.r, p.st, hr) || 'Free'} · ${p.r.kind === 'ware' ? `into ${hr.name}'s pack` : `for ${hr.name}`}` : `into ${hr.name}'s pack`),
    onDrop: (p) => {
      if (p.t === 'buy') {
        if (p.r.kind === 'ware') void buyWare(x, p.r, p.st, hr.id);
        else void buyFor(x, p.r, p.st, hr.id);
        return;
      }
      const next = packInto(l, hr.id, p.id, c.stash, PACK_SLOTS);
      if (!next) return;
      sfx.play('click');
      ui.flash = { row: '', itemId: p.id, text: '' };
      host.setDraft({ ...l, packs: next.packs }, x.page);
    },
  });
  return card;
}

function packRow(x: Ctx, hr: Hero): HTMLElement {
  const { c, l } = x;
  const fresh = ui.flash?.itemId;
  const items = packItems(c, l, hr.id);
  const row = h('div', { class: 'packrow', 'data-pack': hr.id, 'aria-label': `${hr.name}'s pack` });
  let used = 0;
  for (const it of items) {
    const span = Math.min(it.slots, PACK_SLOTS - used);
    used += span;
    const val = isValuable(it);
    const el = h(
      'span',
      {
        class: `sl ${span > 1 ? 'w2' : ''} ${val ? 'val' : ''} ${fresh === it.id ? 'new' : ''} ${itemTint(it.kind)}`,
        'data-packed': it.id,
        'data-kind': it.kind,
        'data-k': `pk-${it.id}`,
        role: 'button',
        'aria-label': `${itemLabel(it)}, in ${hr.name}'s pack`,
        'data-tip': `${itemLabel(it)} · in ${hr.name}'s pack\n${val ? `Worth ${x.host.engine.value([it])} gold. A crew takes it as payment.` : (ITEM_EFFECT[itemBase(it.kind)] ?? it.name)}\nDrag it to the wagon or another pack.`,
      },
      ic(itemIcon(it.kind)),
    );
    makeDraggable<Pay>(el, { t: 'item', id: it.id });
    row.append(el);
  }
  for (let i = used; i < PACK_SLOTS; i++) row.append(h('span', { class: 'sl e', 'aria-hidden': 'true' }));
  return row;
}

/** What a hero has besides the pack: the forge's tiers, a shield, an ale, a lantern, the class kit (never a price). */
function gearRow(hr: Hero, pack: Item[]): HTMLElement {
  const row = h('div', { class: 'gear' });
  const pips = (tier: number, of: string) => h('span', { class: 'pips', 'aria-label': `${of}: tier ${tier} of 2` }, h('i', { class: `pip ${tier >= 1 ? 'on' : ''}` }), h('i', { class: `pip ${tier >= 2 ? 'on' : ''}` }));
  const chip = (icon: CampIcon, label: string, data: Record<string, string>, tip: string, extra?: Node) => {
    const el = h('span', { class: 'gc', tabindex: 0, 'data-tip': tip }, ic(icon), label, extra ?? '');
    for (const [k, v] of Object.entries(data)) el.dataset[k] = v;
    return el;
  };
  if (hr.weaponTier > 0) row.append(chip('sword', 'Blade', { have: 'blade' }, `Blade · tier ${hr.weaponTier} of 2\nFrom Gerda's forge. Each tier adds +10% per slot to every weapon roll.`, pips(hr.weaponTier, 'Blade')));
  if (hr.armorTier > 0) row.append(chip('mail', 'Mail', { have: 'mail' }, `Mail · tier ${hr.armorTier} of 2\nFrom Gerda's forge. Each tier soaks 1 more damage per hit.`, pips(hr.armorTier, 'Mail')));
  if (hr.shield) row.append(chip('shield', 'Shield', { have: 'shield' }, `Shield · carried\nRanged hits on ${hr.name} do 1 less; 2 less while braced. Not the Dragon's breath.`));
  if (hr.ale) row.append(chip('mug', ALE[hr.ale].name, { have: 'ale' }, `${ALE[hr.ale].name} · drunk when ${hr.name} starts the next delve\n${ALE[hr.ale].text}`));
  if (pack.some((i) => i.kind === 'lantern')) row.append(chip('lantern', 'Lantern', { have: 'lantern' }, `Lantern · ${hr.name} carries Gerda's lantern: 20 rounds, refilled in camp.\nIt burns down each round while open; the shutter is free. Lost if ${hr.name} falls.`));
  const kit = kitOf(hr);
  if (kit) {
    const k = chip(itemIcon(kit.kind), kit.short, { kit: kit.kind }, kit.tip);
    k.classList.add('kit');
    row.append(k);
  }
  if (!row.childElementCount) row.append(h('span', { class: 'free' }, 'Empty hands'));
  return row;
}

/** V4.0 (spec 26.5, 30.2) and V4.1 (WS6): the kit a hero brings of their own, outside the pack slots. */
function kitOf(hr: Hero): { kind: string; short: string; tip: string } | null {
  const n = kitPerDelve(hr.level);
  const q = quiverPerDelve(hr.level);
  const k = hr.cls === 'sapper' ? { kind: 'improvised-charge', what: `${n} improvised explosive${n === 1 ? '' : 's'}`, short: `${n} explosive${n === 1 ? '' : 's'}` } : hr.cls === 'burglar' ? { kind: 'improvised', what: `${n} improvised pick${n === 1 ? '' : 's'}`, short: `${n} pick${n === 1 ? '' : 's'}` } : CLASSES[hr.cls].weapon.range ? { kind: 'quiver', what: `${q} arrows`, short: `${q} arrows` } : null;
  if (!k) return null;
  const fresh = k.kind === 'quiver' ? `A fresh quiver every delve: ${ARROWS_PER_LEVEL} arrows for each level ${hr.name} has. Bought arrows are shot after.` : `A fresh ${n === 1 ? 'one' : 'set'} every delve: one for each level ${hr.name} has.`;
  return { kind: k.kind, short: k.short, tip: `${hr.name}'s own · ${k.what}\nDoesn't take a slot; can't be given away. ${fresh}\n${ITEM_EFFECT[k.kind] ?? ''}` };
}

// ------------------------------------------------------------------------------------------------ the wagon

function wagon(x: Ctx, big: boolean): HTMLElement {
  const { c, l, host } = x;
  const { spares, loot } = wagonOf(c.stash, l);
  const fresh = ui.flash;
  const nSp = spares.reduce((a, g) => a + g.items.length, 0);
  const box = h('section', { class: `wagon ${big ? 'big' : ''}`, 'data-cartbox': '1', 'aria-label': "Keven's wagon" });
  box.append(h('h3', null, ic('cart'), "Keven's wagon", h('span', { class: 'n' }, nSp + loot.length ? `${nSp} spare${nSp === 1 ? '' : 's'} · ${loot.length} loot` : 'Spares and loot')));
  makeDropTarget<Pay>(box, {
    accepts: (p) => {
      if (p.t === 'buy') {
        if (p.r.kind !== 'ware') return 'Forge work and ales are for a hero. Drop it on a pack.';
        return c.gold >= p.st.price ? true : `Not enough gold: ${p.st.price}. You have ${c.gold}.`;
      }
      return packedIds(l).has(p.id) ? true : 'Already on the wagon.';
    },
    hint: (p) => (p.t === 'buy' ? `${p.st.price} · onto the wagon` : 'back on the wagon'),
    onDrop: (p) => {
      if (p.t === 'buy') return void buyWare(x, p.r, p.st, null);
      sfx.play('click');
      host.setDraft({ ...l, packs: unpack(l, p.id).packs }, x.page);
    },
  });

  // Spares: one hex a kind, the count on it.
  const cap = big ? 20 : 7;
  const sp = h('div', { class: 'rowa spares', 'data-wagon': 'spares' });
  if (!spares.length) sp.append(h('span', { class: 'none' }, packedIds(l).size ? 'Nothing spare. It is all packed.' : 'Nothing spare. The vendors have some.'));
  const shown = spares.length > cap ? spares.slice(0, cap - 1) : spares;
  for (const g of shown) {
    const it = g.items[0]!;
    const el = h(
      'span',
      { class: `sl sp ${fresh?.cart === g.kind ? 'new' : ''} ${itemTint(g.kind)}`, 'data-cart': g.kind, 'data-k': `cart-${g.kind}`, role: 'button', 'aria-label': `${it.name}, ${g.items.length} on the wagon`, 'data-tip': `${it.name} · ${g.items.length} on the wagon\n${ITEM_EFFECT[itemBase(g.kind)] ?? ''}\n${l.heroIds.length ? 'Drag it onto a pack, or click it and then a hero.' : 'Pick a party to pack it.'}` },
      ic(itemIcon(g.kind)),
      g.items.length > 1 ? h('span', { class: 'x num' }, `${g.items.length}`) : '',
    );
    makeDraggable<Pay>(el, { t: 'item', id: it.id });
    sp.append(big ? h('span', { class: 'cell' }, el, h('span', { class: 'cn' }, it.name)) : el);
  }
  if (shown.length < spares.length) {
    const rest = spares.slice(shown.length);
    sp.append(h('span', { class: 'sl more', tabindex: 0, 'data-tip': `And ${plural(rest.length, 'more kind')} · ${rest.map((g) => `${g.items[0]!.name} ×${g.items.length}`).join(', ')}\nOpen the wagon from the top bar to see them all.` }, h('span', { class: 'num' }, `+${rest.length}`)));
  }

  // Loot: each valuable, its worth on a flag that sells it.
  const lootCap = big ? 16 : 5;
  const lt = h('div', { class: 'rowa loot-row', 'data-wagon': 'loot' });
  if (!loot.length) lt.append(h('span', { class: 'none' }, 'No loot yet. What you carry out lands here.'));
  const lootShown = loot.length > lootCap ? loot.slice(0, lootCap - 1) : loot;
  for (const it of lootShown) {
    const v = host.engine.value([it]);
    const hex = h('span', { class: `sl lt ${it.slots > 1 ? 'w2' : ''} ${itemTint(it.kind)}`, 'data-k': `loot-${it.id}`, role: 'button', 'aria-label': `${it.name}, worth ${v}`, 'data-tip': `${it.name} · worth ${v} gold\n${it.slots > 1 ? 'Takes two slots. ' : ''}Sell it, or pack it to pay off a crew.` }, ic(itemIcon(it.kind)));
    makeDraggable<Pay>(hex, { t: 'item', id: it.id });
    const sell = btn(
      {
        class: 'flag',
        k: `sell-${it.id}`,
        data: { sell: it.id },
        label: `Sell ${it.name} for ${v} gold`,
        tip: `Sell · ${it.name} for ${v} gold`,
        onclick: async () => {
          if (await host.send({ type: 'sell', itemId: it.id })) sfx.play('coin');
        },
      },
      ic('coin'),
      h('span', { class: 'num' }, `${v}`),
    );
    lt.append(h('span', { class: 'loot', 'data-valuable': it.id, 'data-kind': it.kind }, hex, sell, big ? h('span', { class: 'cn' }, it.name) : ''));
  }
  if (lootShown.length < loot.length) {
    const rest = loot.slice(lootShown.length);
    lt.append(h('span', { class: 'sl more', tabindex: 0, 'data-tip': `And ${plural(rest.length, 'more piece')} · ${rest.map((i) => `${i.name}: ${host.engine.value([i])}`).join(', ')}` }, h('span', { class: 'num' }, `+${rest.length}`)));
  }
  const vals = c.stash.filter(isValuable);
  if (vals.length) {
    const worth = host.engine.value(vals);
    const nPacked = vals.filter((i) => packedIds(l).has(i.id)).length;
    lt.append(
      btn(
        {
          class: 'sell',
          k: 'sellall',
          data: { sellall: '1' },
          label: `Sell all loot for ${worth} gold`,
          tip: `Sell all · ${worth} gold\n${vals.map((i) => `${i.name}: ${host.engine.value([i])}`).join('\n')}${nPacked ? `\nPacked loot sells too (${nPacked}).` : ''}\nSpares stay on the wagon.`,
          onclick: async () => {
            if (await host.send({ type: 'sellAll' })) sfx.play('coin');
          },
        },
        'Sell all ',
        h('span', { class: 'price' }, ic('coin'), h('span', { class: 'num' }, `${worth}`)), // a worth, not a price: no data-price
      ),
    );
  }
  box.append(h('div', { class: 'lab' }, 'Spares'), sp, h('div', { class: 'lab' }, 'Loot'), lt);
  return box;
}

// ------------------------------------------------------------------------------------------------ the vendors

/** V5.1.2 (One for the road): Wim's taps moved to the Party step (the Flagon's "The taps" tab); Outfit keeps the other three. */
const OUTFIT_VENDORS: VendorId[] = VENDOR_IDS.filter((vid) => vid !== 'flagon');

function shopSide(x: Ctx): HTMLElement {
  const { c, host, shop, ales } = x;
  const v = villageOf(x.s);
  if (!OUTFIT_VENDORS.includes(ui.outfitTab)) ui.outfitTab = 'mott';
  const id = ui.outfitTab;
  const open = vendorHome(v, id);
  const side = h('section', { class: 'of-col of-shop', 'data-side': 'vendors', 'data-vendor': id, 'data-home': open ? 'yes' : 'no', 'aria-label': 'Vendors' });

  const tabs = h('div', { class: 'vt', role: 'tablist', 'aria-label': 'Vendors' });
  for (const vid of OUTFIT_VENDORS) {
    const vd = VENDORS[vid];
    const home = vendorHome(v, vid);
    const on = id === vid;
    const n = CATALOG.filter((r) => r.vendor === vid && rowStatus(r, v, shop, ales).state === 'live').length;
    const f = VFACE[vid];
    tabs.append(
      h(
        'button',
        {
          type: 'button',
          role: 'tab',
          id: `of-vtab-${vid}`,
          class: `v ${on ? 'on' : ''} ${home ? '' : 'lock away'}`,
          'aria-selected': on ? 'true' : 'false',
          'aria-controls': 'of-shelf',
          tabindex: on ? 0 : -1,
          'data-tab': vid,
          'data-vendor-tab': vid,
          'data-k': `vtab-${vid}`,
          'data-tip': home ? `${vd.tab} · ${n ? `${plural(n, 'thing')} for sale now` : 'nothing for sale yet'}` : `${vd.tab} · not home\n${vd.away} ${vd.awaySub}`,
          onclick: () => {
            if (ui.outfitTab === vid) return;
            sfx.play('click');
            ui.outfitTab = vid;
            host.setPage(x.page);
          },
        },
        bust(f.cls, { size: 64 }),
        h('span', { class: 'vtx' }, h('span', { class: 'vn' }, f.name), h('span', { class: 'vs' }, f.sub)),
        h('span', { class: 'cnt num' }, home ? `${n}` : ic('lock')),
      ),
    );
  }
  tabs.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const i = OUTFIT_VENDORS.indexOf(ui.outfitTab);
    const n = OUTFIT_VENDORS.length;
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (i + (e.key === 'ArrowRight' ? 1 : n - 1)) % n;
    ui.outfitTab = OUTFIT_VENDORS[j]!;
    sfx.play('click');
    host.setPage(x.page);
  });

  // Every row of this vendor: live wares on the shelf, the rest (locked, not yet, sold elsewhere, perks) on the strip.
  const known = new Set(CATALOG.flatMap((r) => r.keys));
  const rows: { r: CatalogRow; st: RowStatus }[] = [];
  for (const g of vendorGroups(id)) for (const r of g.rows) rows.push({ r, st: rowStatus(r, v, shop, ales) });
  // A ware the engine sells that the catalog doesn't know yet still shows, live, under its seller.
  if (id !== 'flagon')
    for (const o of shop.filter((o) => !known.has(o.kind) && tabOf(o.vendor) === id && !o.locked)) rows.push({ r: { id: o.kind, vendor: id, kind: 'ware', keys: [o.kind], name: o.name, group: 'Also', use: WARE[o.kind]?.short ?? o.text, price: o.price, gate: [], hint: '' }, st: { state: 'live', key: o.kind, price: o.price, name: o.name, text: o.text } });
  const live = rows.filter((x2) => x2.st.state === 'live');
  const rest = rows.filter((x2) => x2.st.state !== 'live');
  const perks = PERKS.filter((p) => p.vendor === id);

  // The vendor's line, or what the last purchase did.
  const flash = ui.flash;
  const vd = VENDORS[id];
  const say = id === 'mott' ? PEDDLER_PATTER[c.delveCount % PEDDLER_PATTER.length]! : (vd.say[c.delveCount % Math.max(1, vd.say.length)] ?? '');
  const sayEl = h('div', { class: `say ${flash?.text ? 'flash' : ''}`, role: flash?.text ? 'status' : undefined }, flash?.text ? flash.text : open ? `"${say}"` : vd.away);

  const shelfPages = pages(live, SHELF);
  const sp = Math.min(view.shelf[id] ?? 0, shelfPages.length - 1);
  // The strip: this vendor's locked things and village perks first, then what the others keep locked (the board shows
  // the whole of what can still be unlocked, so playtesters see it; it pages, four at a time).
  const others = CATALOG.filter((r) => r.vendor !== id && r.vendor !== 'flagon')
    .map((r) => ({ r, st: rowStatus(r, v, shop, ales) }))
    .filter((y) => y.st.state === 'locked' || y.st.state === 'soon');
  const stripAll: HTMLElement[] = [...rest.map((y) => stripTile(x, y.r, y.st)), ...perks.map((p) => perkTile(p, perkStatus(p, v))), ...others.map((y) => stripTile(x, y.r, y.st, true))];
  const stripPages = pages(stripAll, STRIP);
  const kp = Math.min(view.strip[id] ?? 0, stripPages.length - 1);
  const top = h('div', { class: 'sayrow' }, sayEl, shelfPages.length > 1 ? pager('shelf', sp, shelfPages.length, (n) => ((view.shelf[id] = n), host.setPage(x.page))) : '');

  const shelf = h('div', { class: 'shelf', id: 'of-shelf', role: 'tabpanel', 'aria-labelledby': `of-vtab-${id}`, 'data-vendor': id });
  if (!open) {
    shelf.classList.add('closed');
    shelf.append(h('div', { class: 'shut' }, bust(VFACE[id].cls, { size: 180 }), h('div', null, h('h3', null, vd.away), h('p', null, vd.awaySub), h('p', { class: 'faint' }, 'What they would sell waits on the strip below.'))));
  } else if (!live.length) shelf.append(h('div', { class: 'shut' }, h('div', null, h('h3', null, 'Nothing on the shelf yet.'), h('p', null, VENDORS[id].soon))));
  shelfPages.forEach((pg, i) => pg.forEach((y) => shelf.append(wareTile(x, y.r, y.st, i !== sp))));

  const strip = h('div', { class: `lk ${stripPages.length > 1 ? 'paged' : ''}`, 'aria-label': 'Not for sale yet' });
  stripPages.forEach((pg, i) => pg.forEach((el) => (i !== kp ? el.setAttribute('hidden', '') : 0, strip.append(el))));
  if (stripPages.length > 1) strip.append(pager('strip', kp, stripPages.length, (n) => ((view.strip[id] = n), host.setPage(x.page))));
  if (!stripAll.length) strip.append(h('div', { class: 'lk-none' }, open ? 'Everything they make is on the shelf.' : ''));

  side.append(tabs, top, shelf, strip);
  return side;
}

function pager(what: string, at: number, of: number, go: (n: number) => void): HTMLElement {
  return h(
    'span',
    { class: `pg pg-${what}` },
    btn({ class: 'pgb', k: `${what}-prev`, off: at === 0, label: 'Previous page', tip: at === 0 ? '' : 'Previous page', onclick: () => (sfx.play('click'), go(at - 1)) }, '‹'),
    h('span', { class: 'num' }, `${at + 1}/${of}`),
    btn({ class: 'pgb', k: `${what}-next`, off: at >= of - 1, label: 'Next page', tip: at >= of - 1 ? '' : 'Next page', onclick: () => (sfx.play('click'), go(at + 1)) }, '›'),
  );
}

/** Badges for what the party has of a ware: packed (ticked) and on the wagon. Never a price. */
function ownBadges(c: Campaign, keys: string[], packed: Set<string>): HTMLElement {
  const mine = c.stash.filter((i) => keys.includes(i.kind));
  const nP = mine.filter((i) => packed.has(i.id)).length;
  const nW = mine.length - nP;
  return h(
    'span',
    { class: 'own' },
    nP ? h('span', { class: 'on', 'data-owned': 'packed', 'data-n': `${nP}`, 'data-tip': `${nP} packed` }, ic('check'), `${nP}`) : '',
    nW ? h('span', { 'data-owned': 'cart', 'data-n': `${nW}`, 'data-tip': `${nW} on the wagon` }, ic('cart'), `${nW}`) : '',
  );
}

function rowIcon(r: CatalogRow, st: RowStatus): CampIcon {
  if (r.kind === 'ale') return 'mug';
  if (r.kind === 'gear' || r.kind === 'shield') return itemIcon(r.keys[0]!);
  return itemIcon(st.key ?? r.keys[0] ?? r.id);
}

/** A live ware (or forge work, or an ale) on a pedestal: icon, name, one line, price, Buy with the chosen hero's face. */
function wareTile(x: Ctx, r: CatalogRow, st: RowStatus, hidden: boolean): HTMLElement {
  const { c, l, who } = x;
  const fresh = ui.flash?.row === r.id;
  const price = priceFor(x, r, st, who);
  const free = r.kind === 'shield' && price === 0;
  const short = price !== null && c.gold < price;
  const rule = r.kind === 'ale' ? (ALE[st.key as AleKind]?.text ?? st.text ?? '') : r.kind === 'gear' ? (r.keys[0] === 'weapon' ? 'Each tier adds +10% per slot to every weapon roll.' : 'Each tier soaks 1 more damage per hit.') : r.kind === 'shield' ? "Ranged hits do 1 less; 2 less while braced. Not the Dragon's breath. Any class." : (ITEM_EFFECT[itemBase(st.key!)] ?? st.text ?? '');
  const use = r.kind === 'ale' ? (ALE_SHORT[st.key as AleKind] ?? r.use) : r.use;
  const forHero = r.kind !== 'ware';
  const tier = who && r.kind === 'gear' ? (r.keys[0] === 'weapon' ? who.weaponTier : who.armorTier) : 0;
  const done = r.kind === 'gear' ? price === null : r.kind === 'shield' ? !!who?.shield : false;
  const tile = h('article', {
    class: `w ${short ? 'short' : ''} ${fresh ? 'new' : ''} ${done ? 'done' : ''}`,
    'data-row': r.id,
    'data-state': 'live',
    'data-vendor': r.vendor,
    'data-kind': r.kind,
    'aria-label': `${st.name}, ${price === null ? 'the best' : free ? 'free' : `${price} gold`}`,
    'data-tip': `${st.name} · ${price === null ? 'the best' : free ? "free, Gerda's gift" : `${price} gold`}\n${rule}${r.kind === 'gear' && who ? `\n${who.name}: tier ${tier} of 2.` : ''}${r.kind === 'ale' ? '\nOne ale a hero, drunk as they go in. It lasts the delve.' : ''}\n${forHero ? 'Drag it onto a hero, or Buy for the chosen one.' : 'Drag it onto any pack, or Buy into the chosen one.'}`,
    hidden: hidden ? true : undefined,
  });
  // the hero's tier pips on forge work; what the party owns on a ware; who has this ale poured
  if (r.kind === 'ware') tile.append(ownBadges(c, r.keys, packedIds(l)));
  else if (r.kind === 'gear' && who) tile.append(h('span', { class: 'own' }, h('span', { class: tier ? 'on' : '' }, h('span', { class: 'pips' }, h('i', { class: `pip ${tier >= 1 ? 'on' : ''}` }), h('i', { class: `pip ${tier >= 2 ? 'on' : ''}` })))));
  else if (r.kind === 'ale') {
    const drinkers = l.heroIds.map((id) => heroOf(c, id)).filter((y): y is Hero => !!y && y.ale === st.key);
    if (drinkers.length) tile.append(h('span', { class: 'own' }, h('span', { class: 'on', 'data-owned': 'poured', 'data-tip': `Poured: ${drinkers.map((y) => y.name).join(', ')}` }, ic('mug'), `${drinkers.length}`)));
  } else if (r.kind === 'shield' && who?.shield) tile.append(h('span', { class: 'own' }, h('span', { class: 'on' }, ic('check'), who.name)));
  tile.append(h('div', { class: `ped ${itemTint(st.key ?? r.id)}` }, ic(rowIcon(r, st))), h('h4', null, st.name), h('p', null, use));

  const verb = r.kind === 'gear' ? (tier === 0 ? 'Forge' : 'Hone') : r.kind === 'ale' ? 'Pour' : free ? 'Free' : 'Buy';
  const nobody = !who;
  const why = nobody ? 'Nobody to buy for. Pick a party first.' : forHero ? (() => {
    const t = heroTakesBuy(x, r, st, who);
    return t === true ? '' : t;
  })() : short ? `Not enough gold. You have ${c.gold}.` : '';
  const full = !!who && r.kind === 'ware' && slotsUsed(packItems(c, l, who.id)) + 1 > PACK_SLOTS;
  const data: Record<string, string> = { buy: r.id };
  if (r.kind === 'ware') data.ware = st.key!;
  if (r.kind === 'gear') Object.assign(data, { upgrade: r.keys[0]!, hero: who?.id ?? '' });
  if (r.kind === 'shield') data.shield = who?.id ?? '';
  if (r.kind === 'ale') Object.assign(data, { pour: st.key!, hero: who?.id ?? '' });
  const label = `${verb}${r.kind === 'ware' ? ` ${st.name}` : ''}${who ? ` for ${who.name}` : ''} · ${free ? 'a gift' : (price ?? '')}`;
  const buyBtn = done
    ? h('span', { class: 'buy off done' }, r.kind === 'shield' ? 'Carried' : 'The best')
    : btn(
        {
          class: 'buy',
          k: `buy-${r.id}`,
          data,
          off: !!why || (r.kind === 'ware' && short),
          label,
          tip: why ? `${verb} · ${why}` : r.kind === 'ware' ? `${label}\n${full ? `${who!.name}'s pack is full: it goes on the wagon.` : `Into ${who!.name}'s pack.`}` : `${label}\n${rule}`,
          onclick: () => (r.kind === 'ware' ? buyWare(x, r, st, who?.id ?? null) : buyFor(x, r, st, who!.id)),
        },
        verb,
        who ? h('span', { class: 'chipb' }, bust(who.cls, { size: 30 })) : '',
      );
  // Enter or a press on Buy buys; it does not lift the tile (the tile's pointer capture would take the click).
  buyBtn.addEventListener('keydown', (e) => e.stopPropagation());
  buyBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
  tile.append(h('div', { class: 'buyrow' }, price === null ? h('span', { class: 'price best' }, ic('star')) : free ? h('span', { class: 'price gift', 'data-price': '0' }, ic('coin'), 'Free') : coinPrice(price), buyBtn));
  if (!done) makeDraggable<Pay>(tile, { t: 'buy', r, st });
  return tile;
}

/** A thing not on the shelf: locked or not yet (dim, lock, hint on hover), or sold by another vendor now (a pointer). */
function stripTile(x: Ctx, r: CatalogRow, st: RowStatus, elsewhere = false): HTMLElement {
  const base = { 'data-row': r.id, 'data-state': st.state, 'data-vendor': r.vendor, 'data-kind': r.kind, 'data-elsewhere': elsewhere ? '1' : undefined };
  if (st.state === 'moved') {
    const to = VENDORS[st.movedTo!];
    const el = h('button', { ...base, type: 'button', class: 'lkt moved', 'data-goto': st.movedTo!, 'data-k': `go-${r.id}`, 'data-tip': `${st.name} · at ${to.tab.replace(/^The /, 'the ')} now\nCheaper there, now the two of them work together. Click to go.` }, ic(rowIcon(r, st)), h('span', null, h('b', null, st.name), h('small', null, `${VFACE[st.movedTo!].name} sells it now`)));
    el.addEventListener('click', () => {
      sfx.play('click');
      ui.outfitTab = st.movedTo!;
      x.host.setPage(x.page);
    });
    return el;
  }
  const awayHint = !vendorHome(villageOf(x.s), r.vendor) && VENDORS[r.vendor].awayHint;
  const hint = awayHint || st.hint || '';
  return h(
    'div',
    { ...base, class: `lkt ${st.state}`, tabindex: 0, 'aria-label': `${st.name}, locked`, 'data-tip': `${st.name} · ${st.state === 'soon' ? 'not yet' : 'locked'}${elsewhere ? `\n${VFACE[r.vendor].name}, ${VFACE[r.vendor].sub.toLowerCase()}.` : ''}\n${hint}`, 'data-hint': hint },
    h('span', { class: 'lki' }, ic(rowIcon(r, st)), h('span', { class: 'lkl' }, ic('lock'))),
    h('span', null, h('b', null, st.name), h('small', null, st.state === 'soon' ? 'Not yet' : hint)),
  );
}

/** A village perk: nothing to buy, it just happens once its pair is home (lit), or a hint while locked. */
function perkTile(p: PerkDef, st: 'live' | 'locked' | 'soon'): HTMLElement {
  const live = st === 'live';
  return h(
    'div',
    { class: `lkt perk ${live ? 'live' : st}`, tabindex: 0, 'data-perk': p.id, 'data-state': st, 'data-tip': live ? `${p.name} · the village's doing\n${p.live}\nNothing to buy: it just happens.` : `${p.name} · not yet\n${st === 'soon' ? "Soon. They're working on it." : p.hint}` },
    h('span', { class: 'lki' }, ic(live ? 'star' : 'lock')),
    h('span', null, h('b', null, p.name), h('small', null, live ? 'Every delve' : st === 'soon' ? 'Not yet' : p.hint)),
  );
}
