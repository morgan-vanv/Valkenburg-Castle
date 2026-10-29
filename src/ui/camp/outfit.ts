// V5.1 (W0): step 3, Outfit: the vendors, packs and Keven's cart (also its side page). Split out of src/ui/lowgate.ts.

import type { AleKind, AleOffer, Campaign, GameState, Hero, Item, ShopOffer } from '../../game/types';
import { ARMOR_PRICE, ARROWS_PER_LEVEL, CLASSES, PACK_SLOTS, WEAPON_PRICE, kitPerDelve, quiverPerDelve } from '../../game/data';
import { sfx } from '../../audio/sfx';
import { gold, h } from '../dom';
import { ALE, ALE_SHORT, ITEM_EFFECT, PEDDLER_PATTER, V37, WARE, itemBase, itemGlyph, itemLabel } from '../names';
import { CATALOG, type CatalogRow, PERKS, type RowStatus, SHOW_LOCKED, VENDORS, VENDOR_IDS, type VendorId, perkStatus, rowStatus, tabOf, vendorGroups, vendorHome } from '../vendors';
import { type CampPage, type Loadout, type CampHost, isValuable, packItems, slotsUsed, packedIds, numWord, heroOf, classLine, statsTip, hexBadge, svg, cartIcon, lanternIcon, btn, ui, type Flash, villageOf, stepHead } from './shared';

// V4.1 WS4 (spec 31.6): two counters. Left, "Yours": the party's packs (the hero being packed for marked "Packing"),
// then Keven's cart. Right, "Vendors": a tab per vendor (Mott, Gerda, Ilse, the Flagon) listing everything they will
// ever sell (vendors.ts), live rows with a price and a Buy button, locked rows dimmed with an in-voice hint.
export function outfitStep(main: HTMLElement, s: GameState, l: Loadout, host: CampHost): void {
  const c = s.campaign;
  const flash = ui.flash;
  ui.flash = null;
  const wrap = h('div', { class: 'lg-outfit' });
  const left = h('section', { class: 'lg-packs lg-yours', 'aria-label': 'Yours', 'data-side': 'yours' });
  left.append(
    h(
      'div',
      { class: 'lg-sh-l' },
      h('span', { class: 'lg-kick lg-kick-dim' }, 'Yours'),
      h('h2', { class: 'lg-h2' }, 'Pack for the castle'),
      h('p', { class: 'lg-sub' }, l.heroIds.length > 1 ? 'Four slots each. What you buy lands on Keven\'s cart below; click a thing there to pack it for the hero marked Packing, or use its "Give to" buttons.' : 'Four slots each. What you buy lands on Keven\'s cart below; click a thing there to pack it.'),
    ),
  );
  if (!l.heroIds.length) left.append(h('p', { class: 'lg-empty' }, 'Nobody is going in yet. Pick a party first.'));
  for (const id of l.heroIds) {
    const hr = heroOf(c, id);
    if (hr) left.append(loadoutCard(hr, s, l, host, flash?.itemId));
  }
  left.append(h('p', { class: 'lg-note' }, "Whatever you take in and don't bring out is lost. What you bring out goes on Keven's cart."));
  const cartN = c.stash.filter((i) => !packedIds(l).has(i.id) && !i.story && i.kind !== 'gold').length;
  const cart = h(
    'section',
    { class: 'lg-cartbox', 'aria-label': "Keven's cart", 'data-cartbox': '1' },
    h('div', { class: 'lg-cartbox-h' }, cartIcon(), h('h3', { class: 'lg-h3' }, "Keven's cart"), h('span', { class: 'lg-sub' }, cartN ? `${numWord(cartN)} thing${cartN === 1 ? '' : 's'} not packed` : 'Nothing waiting')),
  );
  const cartIn = h('div', { class: 'lg-cartbox-b' });
  cartBody(cartIn, s, l, host, 'outfit', flash?.cart);
  cart.append(cartIn);
  left.append(cart);
  wrap.append(left, vendorsSide(s, l, host, flash));
  main.append(wrap);
}

/** The engine's lists, defensively (a missing helper means nothing sold, not a broken page). */
function offersOf(s: GameState, host: CampHost): { shop: ShopOffer[]; ales: AleOffer[] } {
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
  return { shop, ales };
}

const lockIcon = (size = 14) => svg('svg', { width: size, height: size, viewBox: '0 0 14 14', 'aria-hidden': 'true' }, svg('path', { d: 'M4 6.5 V4.5 A3 3 0 0 1 10 4.5 V6.5', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.3 }), svg('rect', { x: 2.5, y: 6.5, width: 9, height: 6.5, rx: 1, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.3 }));

const coinS = () => svg('svg', { width: 14, height: 14, viewBox: '0 0 18 18', 'aria-hidden': 'true', class: 'lg-coin' }, svg('circle', { cx: 9, cy: 9, r: 7.5, fill: 'none', stroke: '#d9a93a', 'stroke-width': 1.8 }), svg('circle', { cx: 9, cy: 9, r: 3.5, fill: 'none', stroke: '#d9a93a', 'stroke-width': 1.4 }));

const priceTag = (n: number, label?: string) => h('span', { class: 'lg-vprice', 'data-price': `${n}` }, coinS(), h('span', { class: 'num' }, label ?? `${n}`));

/** The selling counter: four vendor tabs, always all four. */
function vendorsSide(s: GameState, l: Loadout, host: CampHost, flash: Flash | null): HTMLElement {
  const c = s.campaign;
  const v = villageOf(s);
  const who = ui.packFor ? heroOf(c, ui.packFor) : undefined;
  const { shop, ales } = offersOf(s, host);
  const side = h('section', { class: 'lg-where lg-vendors', 'aria-label': 'Vendors', 'data-side': 'vendors' });
  side.append(
    h(
      'div',
      { class: 'lg-vend-top' },
      h('span', { class: 'lg-kick' }, 'Vendors'),
      who
        ? h('span', { class: 'lg-buyfor', tabindex: 0, 'data-tip': `Buying for ${who.name} · Gear and ales are for them. Wares go on Keven's cart; pack them from there.${l.heroIds.length > 1 ? '\nClick another hero on the left to forge or pour for them.' : ''}` }, h('span', { class: 'lg-sub' }, 'Buying for'), hexBadge(who.cls, 'sm'), h('b', null, who.name))
        : h('span', { class: 'lg-buyfor' }, h('span', { class: 'lg-sub' }, "Wares go on Keven's cart. Pick a party to pack for.")),
    ),
  );
  const tabs = h('div', { class: 'lg-tabs lg-vtabs', role: 'tablist', 'aria-label': 'Vendors' });
  for (const id of VENDOR_IDS) {
    const vd = VENDORS[id];
    const open = vendorHome(v, id);
    const on = ui.outfitTab === id;
    const n = CATALOG.filter((r) => r.vendor === id && rowStatus(r, v, shop, ales).state === 'live').length;
    tabs.append(
      h(
        'button',
        {
          type: 'button',
          role: 'tab',
          id: `lg-vtab-${id}`,
          class: `lg-tab lg-vtab ${on ? 'on' : ''} ${open ? '' : 'away'}`,
          'aria-selected': on ? 'true' : 'false',
          'aria-controls': 'lg-vpanel',
          tabindex: on ? 0 : -1,
          'data-tab': id,
          'data-vendor-tab': id,
          'data-k': `vtab-${id}`,
          'data-tip': open ? `${vd.tab} · ${n ? `${numWord(n)} thing${n === 1 ? '' : 's'} for sale now` : 'nothing for sale yet'}` : `${vd.tab} · not home\n${vd.away} ${vd.awaySub}`,
          onclick: () => {
            if (ui.outfitTab === id) return;
            sfx.play('click');
            ui.outfitTab = id;
            host.setPage('outfit');
          },
        },
        open ? '' : h('span', { class: 'lg-vtab-lock' }, lockIcon(12)),
        h('span', null, vd.tab),
        open ? h('span', { class: 'lg-tab-n num' }, `${n}`) : '',
      ),
    );
  }
  // Arrow keys move between the tabs (the tablist pattern); Tab goes on into the panel.
  tabs.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const i = VENDOR_IDS.indexOf(ui.outfitTab);
    const n = VENDOR_IDS.length;
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (i + (e.key === 'ArrowRight' ? 1 : n - 1)) % n;
    ui.outfitTab = VENDOR_IDS[j]!;
    sfx.play('click');
    host.setPage('outfit');
  });
  const panel = h('div', { class: 'lg-tabbody lg-vpanel', role: 'tabpanel', id: 'lg-vpanel', 'aria-labelledby': `lg-vtab-${ui.outfitTab}`, 'data-vendor': ui.outfitTab });
  vendorPanel(panel, ui.outfitTab, s, l, host, who, shop, ales, flash);
  side.append(tabs, panel);
  return side;
}

function vendorPanel(el: HTMLElement, id: VendorId, s: GameState, l: Loadout, host: CampHost, who: Hero | undefined, shop: ShopOffer[], ales: AleOffer[], flash: Flash | null): void {
  const c = s.campaign;
  const v = villageOf(s);
  const vd = VENDORS[id];
  const open = vendorHome(v, id);
  const say = id === 'mott' ? PEDDLER_PATTER[c.delveCount % PEDDLER_PATTER.length]! : (vd.say[c.delveCount % Math.max(1, vd.say.length)] ?? '');
  el.append(
    h(
      'div',
      { class: `lg-mott lg-vhead ${open ? '' : 'away'}`, 'data-home': open ? 'yes' : 'no' },
      h('div', { class: 'lg-mott-face', 'aria-hidden': 'true' }, vd.face),
      h('div', { class: 'lg-mott-t' }, h('span', { class: 'lg-mott-n' }, vd.name), open ? h('span', { class: 'lg-mott-say' }, `"${say}"`) : h('span', { class: 'lg-mott-say' }, vd.awaySub)),
      h('span', { class: `lg-chip lg-vhome ${open ? 'yes' : 'no'}` }, open ? 'Open' : [lockIcon(12), ` ${vd.away}`]),
    ),
  );
  if (id === 'flagon' && open) el.append(h('p', { class: 'lg-vnote' }, who?.ale ? `${who.name} has ${ALE[who.ale].name} waiting: one ale a hero, drunk as they go in.` : 'One ale a hero, poured now and drunk as they go in. It lasts the delve.'));
  const packed = packedIds(l);
  const known = new Set(CATALOG.flatMap((r) => r.keys));
  for (const g of vendorGroups(id)) {
    const rows = g.rows.map((r) => ({ r, st: rowStatus(r, v, shop, ales) })).filter((x) => SHOW_LOCKED || x.st.state === 'live');
    if (!rows.length) continue;
    el.append(h('div', { class: 'lg-kick lg-kick-dim lg-wgroup' }, g.group), h('div', { class: 'lg-vrows', role: 'list' }, ...rows.map(({ r, st }) => vendorRow(r, st, s, l, host, who, packed, flash))));
  }
  // A ware the engine sells that the catalog doesn't know yet still shows, live, under its seller (a builder forgot vendors.ts).
  if (id !== 'flagon') {
    const extra = shop.filter((o) => !known.has(o.kind) && tabOf(o.vendor) === id && !o.locked);
    if (extra.length) {
      el.append(
        h('div', { class: 'lg-kick lg-kick-dim lg-wgroup' }, 'Also'),
        h('div', { class: 'lg-vrows', role: 'list' }, ...extra.map((o) => vendorRow({ id: o.kind, vendor: id, kind: 'ware', keys: [o.kind], name: o.name, group: 'Also', use: WARE[o.kind]?.short ?? o.text, price: o.price, gate: [], hint: '' }, { state: 'live', key: o.kind, price: o.price, name: o.name, text: o.text }, s, l, host, who, packed, flash))),
      );
    }
  }
  const perks = PERKS.filter((p) => p.vendor === id);
  if (perks.length) {
    el.append(
      h('div', { class: 'lg-kick lg-kick-dim lg-wgroup' }, 'Lowgate looks after its own'),
      h(
        'div',
        { class: 'lg-vrows', role: 'list' },
        ...perks.map((p) => {
          const st = perkStatus(p, v);
          const live = st === 'live';
          return h(
            'div',
            { class: `lg-vrow lg-perk ${live ? 'live' : 'locked'}`, role: 'listitem', tabindex: 0, 'data-perk': p.id, 'data-state': st, 'data-tip': live ? `${p.name} · the village's doing\n${p.live}\nNothing to buy: it just happens.` : `${p.name} · not yet\n${st === 'soon' ? 'Soon. They\'re working on it.' : p.hint}` },
            h('span', { class: `lg-wg ${live ? '' : 'dashed'}`, 'aria-hidden': 'true' }, live ? '✦' : lockIcon(14)),
            h('span', { class: 'lg-vrow-t' }, h('span', { class: 'lg-vrow-n' }, p.name), h('span', { class: 'lg-vrow-u' }, live ? p.live : st === 'soon' ? 'Not yet.' : 'Locked.')),
            h('span', { class: 'lg-vrow-own' }, live ? h('span', { class: 'lg-badge on' }, 'Every delve') : ''),
          );
        }),
      ),
    );
  }
}

/** Badges for what the party already has of a ware: "2 packed", "1 on the cart" (never a price). */
function ownedBadges(c: Campaign, keys: string[], packed: Set<string>): HTMLElement {
  const mine = c.stash.filter((i) => keys.includes(i.kind));
  const nPacked = mine.filter((i) => packed.has(i.id)).length;
  const nCart = mine.length - nPacked;
  // Always a cell, so the price and Buy columns line up row to row.
  return h('span', { class: 'lg-badges-r' }, nPacked ? h('span', { class: 'lg-badge on', 'data-owned': 'packed' }, `${nPacked} packed`) : '', nCart ? h('span', { class: 'lg-badge', 'data-owned': 'cart' }, `${nCart} on the cart`) : '');
}

function tierPips(tier: number, of: string): HTMLElement {
  return h('span', { class: 'lg-pips-s', 'aria-label': `${of}: tier ${tier} of 2` }, h('i', { class: `lg-pip ${tier >= 1 ? 'on' : ''}` }), h('i', { class: `lg-pip ${tier >= 2 ? 'on' : ''}` }));
}

function vendorRow(r: CatalogRow, st: RowStatus, s: GameState, l: Loadout, host: CampHost, who: Hero | undefined, packed: Set<string>, flash: Flash | null): HTMLElement {
  const c = s.campaign;
  const glyph = r.glyph ?? (r.kind === 'ale' ? ALE[r.keys[0] as AleKind]?.glyph : [st.key, ...r.keys].map((k) => (k ? itemGlyph(k) : '•')).find((g) => g !== '•')) ?? '•';
  const use = r.kind === 'ale' ? (ALE_SHORT[r.keys[0] as AleKind] ?? r.use) : r.use;
  const base = { class: `lg-vrow ${st.state}`, role: 'listitem', 'data-row': r.id, 'data-state': st.state, 'data-vendor': r.vendor, 'data-kind': r.kind };
  const glyphEl = (dim = false) => h('span', { class: `lg-wg ${dim ? 'dashed' : ''}`, 'aria-hidden': 'true' }, glyph);
  // Locked, or not sold yet: dimmed, a lock, no price, no Buy. The hover is the hint, in voice, never the rule.
  if (st.state === 'locked' || st.state === 'soon') {
    const awayHint = !vendorHome(villageOf(s), r.vendor) && VENDORS[r.vendor].awayHint;
    return h(
      'div',
      { ...base, tabindex: 0, 'aria-label': `${st.name}, locked`, 'data-tip': `${st.name} · locked\n${awayHint || st.hint || ''}`, 'data-hint': awayHint || st.hint || '' },
      glyphEl(true),
      h('span', { class: 'lg-vrow-t' }, h('span', { class: 'lg-vrow-n' }, st.name), h('span', { class: 'lg-vrow-u' }, use)),
      h('span', { class: 'lg-vrow-own' }),
      h('span', { class: 'lg-vlock' }, lockIcon(14), h('span', null, st.state === 'soon' ? 'Not yet' : 'Locked')),
    );
  }
  // Sold by someone else now (a pair makes it cheaper there): a pointer, no Buy.
  if (st.state === 'moved') {
    const to = VENDORS[st.movedTo!];
    return h(
      'div',
      { ...base, 'data-tip': `${st.name} · at ${to.tab.replace(/^The /, 'the ')} now\nCheaper there, now the two of them work together.` },
      glyphEl(true),
      h('span', { class: 'lg-vrow-t' }, h('span', { class: 'lg-vrow-n' }, st.name), h('span', { class: 'lg-vrow-u' }, `${to.tab} sells these now.`)),
      ownedBadges(c, r.keys, packed),
      btn({ class: 'btn lg-ghost lg-btn-s lg-vgo', k: `go-${r.id}`, data: { goto: st.movedTo! }, tip: `Go to ${to.tab}`, onclick: () => ((ui.outfitTab = st.movedTo!), sfx.play('click'), host.setPage('outfit')) }, `${to.tab} `, h('span', { 'aria-hidden': 'true' }, '→')),
    );
  }
  const note = flash?.row === r.id ? h('span', { class: 'lg-vflash', role: 'status' }, flash.text) : '';
  const info = (tip: string, extra?: HTMLElement | '') => h('span', { class: 'lg-vrow-t', 'data-tip': tip }, h('span', { class: 'lg-vrow-n' }, st.name, extra ?? ''), h('span', { class: 'lg-vrow-u' }, use), note);
  const nobody = 'Nobody to buy for. Pick a party first.';
  if (r.kind === 'ware') {
    const short = c.gold < st.price;
    const where = "Goes on Keven's cart; pack it from there."; // V5.0 (P, B1)
    const rule = ITEM_EFFECT[itemBase(st.key!)] ?? st.text ?? '';
    return h(
      'div',
      base,
      glyphEl(),
      info(`${st.name} · ${st.price} gold\n${rule}`),
      ownedBadges(c, r.keys, packed),
      priceTag(st.price),
      btn(
        {
          class: 'btn lg-btn-s lg-primary lg-buy',
          k: `buy-${r.id}`,
          data: { buy: r.id, ware: st.key! },
          off: short,
          tip: short ? `Buy · ${st.price} gold\nYou have ${c.gold} gold.` : `Buy ${st.name} · ${st.price} gold\n${rule}\n${where}`,
          onclick: async () => {
            // V5.0 (P, B1): a purchase only ever lands on Keven's cart; packing it for a hero is a separate click on
            // the cart (the Yours side). The cart row glows so the player sees where it went.
            const before = new Set(c.stash.map((i) => i.id));
            if (!(await host.send({ type: 'buy', kind: st.key as ShopOffer['kind'] }))) return;
            sfx.play('coin');
            const now = host.state();
            const it = now?.campaign.stash.find((i) => !before.has(i.id));
            ui.flash = { row: r.id, itemId: it?.id, cart: it?.kind, text: "On Keven's cart." };
            host.setPage('outfit');
          },
        },
        'Buy · ',
        h('span', { class: 'num' }, `${st.price}`),
      ),
    );
  }
  if (r.kind === 'gear') {
    const part = r.keys[0] as 'weapon' | 'armor';
    const word = part === 'weapon' ? 'Blade' : 'Mail';
    const what = part === 'weapon' ? 'Each tier adds +10% per slot to every weapon roll.' : 'Each tier soaks 1 more damage per hit.';
    const tier = who ? (part === 'weapon' ? who.weaponTier : who.armorTier) : 0;
    const price = tier >= 2 ? null : (part === 'weapon' ? WEAPON_PRICE : ARMOR_PRICE)[tier + 1]!;
    const short = price !== null && c.gold < price;
    const verb = tier === 0 ? 'Forge' : 'Hone';
    const info2 = info(`${word} · ${who ? `${who.name}: tier ${tier} of 2` : 'for a hero'}\n${what}${price !== null ? `\nTier ${tier + 1}: ${price} gold.` : ''}`, who ? tierPips(tier, word) : '');
    if (who && price === null) return h('div', base, glyphEl(), info2, h('span', { class: 'lg-vrow-own' }, h('span', { class: 'lg-badge on' }, `${who.name}: the best`)), h('span', { class: 'lg-vdone' }, 'The best Gerda makes'));
    return h(
      'div',
      base,
      glyphEl(),
      info2,
      h('span', { class: 'lg-vrow-own' }, who && tier > 0 ? h('span', { class: 'lg-badge on' }, `${who.name}: tier ${tier}`) : ''),
      priceTag(price ?? 0),
      btn(
        {
          class: 'btn lg-btn-s lg-primary lg-buy',
          k: `buy-${r.id}`,
          data: { buy: r.id, upgrade: part, hero: who?.id ?? '' },
          off: !who || short,
          tip: !who ? `${verb} · ${price} gold\n${nobody}` : short ? `${verb} for ${who.name} · ${price} gold\nYou have ${c.gold} gold.` : `${verb} for ${who.name} · ${price} gold\n${what} Tier ${tier} to ${tier + 1}.`,
          onclick: async () => {
            if (await host.send({ type: 'upgrade', heroId: who!.id, part })) sfx.play('smash', { pitch: 2, gain: 0.4 });
          },
        },
        `${verb}${who ? ` for ${who.name}` : ''} · `,
        h('span', { class: 'num' }, `${price}`),
      ),
    );
  }
  if (r.kind === 'shield') {
    const free = (c.credits?.shield ?? 0) > 0; // V4.1 (spec 31.2): Gerda's gift
    const price = free ? 0 : V37.shieldPrice;
    const what = 'Ranged hits do 1 less; 2 less while braced. Not the Dragon\'s breath. Any class.';
    const short = c.gold < price;
    const info2 = info(`Shield · ${free ? 'free, Gerda\'s gift' : `${price} gold`}\n${what}`);
    if (who?.shield) return h('div', base, glyphEl(), info2, h('span', { class: 'lg-vrow-own' }, h('span', { class: 'lg-badge on' }, `${who.name} carries one`)), h('span', { class: 'lg-vdone' }, 'Carried'));
    return h(
      'div',
      { ...base, class: `${base.class} ${free ? 'gift' : ''}` },
      glyphEl(),
      info2,
      h('span', { class: 'lg-vrow-own' }),
      free ? h('span', { class: 'lg-vprice gift', 'data-price': '0' }, coinS(), h('span', null, 'Free')) : priceTag(price),
      btn(
        {
          class: 'btn lg-btn-s lg-primary lg-buy',
          k: `buy-${r.id}`,
          data: { buy: r.id, shield: who?.id ?? '' },
          off: !who || short,
          tip: !who ? `Shield · ${nobody}` : short ? `Shield for ${who.name} · ${price} gold\nYou have ${c.gold} gold.` : free ? `Shield for ${who.name} · free\nGerda owes you one. ${what}` : `Shield for ${who.name} · ${price} gold\n${what}`,
          onclick: async () => {
            if (await host.send({ type: 'buyShield', heroId: who!.id })) sfx.play('smash', { pitch: 1.6, gain: 0.4 });
          },
        },
        ...(free ? [`Free${who ? ` for ${who.name}` : ''} · a gift`] : [`Buy${who ? ` for ${who.name}` : ''} · `, h('span', { class: 'num' }, `${price}`)]),
      ),
    );
  }
  // An ale, poured for the hero being packed for.
  const kind = st.key as AleKind;
  const a = ALE[kind];
  const short = c.gold < st.price;
  const party = l.heroIds.map((id) => heroOf(c, id)).filter((x): x is Hero => !!x);
  const drinkers = party.filter((x) => x.ale === kind).map((x) => x.name);
  const has = who?.ale ? ALE[who.ale] : undefined;
  const ruleTxt = a?.text ?? st.text ?? '';
  return h(
    'div',
    base,
    glyphEl(),
    info(`${st.name} · ${st.price} gold\n${ruleTxt}`),
    h('span', { class: 'lg-vrow-own' }, drinkers.length ? h('span', { class: 'lg-badge on', 'data-owned': 'poured' }, `Poured: ${drinkers.join(', ')}`) : ''),
    priceTag(st.price),
    btn(
      {
        class: 'btn lg-btn-s lg-primary lg-buy',
        k: `buy-${r.id}`,
        data: { buy: r.id, pour: kind, hero: who?.id ?? '' },
        off: !who || short || !!has,
        tip: !who ? `Pour · ${st.price} gold\n${nobody}` : has ? `${who.name} has an ale waiting · ${has.name}\nOne a delve, drunk as they go in.` : short ? `Pour for ${who.name} · ${st.price} gold\nYou have ${c.gold} gold.` : `Pour for ${who.name} · ${st.price} gold\n${ruleTxt}\nDrunk as ${who.name} starts the next delve.`,
        onclick: async () => {
          if (await host.send({ type: 'buyAle', heroId: who!.id, ale: kind })) sfx.play('coin', { pitch: 0.8 });
        },
      },
      `Pour${who ? ` for ${who.name}` : ''} · `,
      h('span', { class: 'num' }, `${st.price}`),
    ),
  );
}

function packSlots(c: Campaign, l: Loadout, hr: Hero, host: CampHost, page: CampPage, fresh?: string): HTMLElement {
  const items = packItems(c, l, hr.id);
  const row = h('div', { class: 'lg-sl-row', 'aria-label': `${hr.name}'s pack` });
  let used = 0;
  for (const it of items) {
    const span = Math.min(it.slots, PACK_SLOTS - used);
    used += span;
    row.append(
      btn(
        {
          class: `lg-sl full ${span > 1 ? 'two' : ''} ${isValuable(it) ? 'val' : ''} ${fresh === it.id ? 'new' : ''}`,
          k: `pk-${it.id}`,
          data: { packed: it.id, kind: it.kind },
          label: `${itemLabel(it)}, back to the cart`,
          tip: `${itemLabel(it)} · back to the cart\n${isValuable(it) ? `Worth ${it.amount} gold. A crew takes it as payment.` : (ITEM_EFFECT[itemBase(it.kind)] ?? it.name)}`,
          onclick: () => {
            sfx.play('click');
            const next = structuredClone(l);
            next.packs[hr.id] = (next.packs[hr.id] ?? []).filter((x) => x !== it.id);
            host.setDraft(next, page);
          },
        },
        h('span', { class: 'lg-g', 'aria-hidden': 'true' }, itemGlyph(it.kind)),
        h('span', { class: 'lg-sl-n' }, it.kind === 'gem' || it.kind === 'jewelry' ? it.name : itemLabel(it)),
      ),
    );
  }
  for (let i = used; i < PACK_SLOTS; i++) row.append(h('span', { class: 'lg-sl empty', 'aria-hidden': 'true' }));
  return row;
}

/** V4.0 (spec 26.5): class kit the hero brings of their own, under the 4 slots (Burglar, Sapper). */
function kitLine(hr: Hero): HTMLElement | '' {
  // V4.0 (spec 30.2): one a level each delve.
  const n = kitPerDelve(hr.level);
  // V4.1 (WS6, spec 31.8): the Ranger's quiver, 5 arrows a level.
  const q = quiverPerDelve(hr.level);
  const k = hr.cls === 'sapper' ? { kind: 'improvised-charge', what: `${n} improvised explosive${n === 1 ? '' : 's'}` } : hr.cls === 'burglar' ? { kind: 'improvised', what: `${n} improvised pick${n === 1 ? '' : 's'}` } : CLASSES[hr.cls].weapon.range ? { kind: 'quiver', what: `${q} arrows` } : null;
  if (!k) return '';
  const fresh = k.kind === 'quiver' ? `A fresh quiver every delve: ${ARROWS_PER_LEVEL} arrows for each level ${hr.name} has. Bought arrows are shot after.` : `A fresh ${n === 1 ? 'one' : 'set'} every delve: one for each level ${hr.name} has.`;
  return h(
    'p',
    { class: 'lg-kit', tabindex: 0, 'data-kit': k.kind, 'data-tip': `${hr.name}'s own · ${k.what}\nDoesn't take a slot; can't be given away. ${fresh}\n${ITEM_EFFECT[k.kind] ?? ''}` },
    h('span', { class: 'lg-g', 'aria-hidden': 'true' }, itemGlyph(k.kind)),
    `Brings their own: ${k.what}`,
    h('span', { class: 'lg-kit-s' }, ' · no slot'),
  );
}

/** What a hero already has from the forge and the Flagon: tier pips, the shield, the ale poured (never a price). */
function haveLine(hr: Hero): HTMLElement | '' {
  const chips: HTMLElement[] = [];
  const gear = (word: string, tier: number, what: string) => chips.push(h('span', { class: 'lg-have', tabindex: 0, 'data-have': word.toLowerCase(), 'data-tip': `${word} · tier ${tier} of 2\n${what}` }, h('span', { class: 'lg-gl' }, word), tierPips(tier, word)));
  if (hr.weaponTier > 0) gear('Blade', hr.weaponTier, 'From Gerda\'s forge. Each tier adds +10% per slot to every weapon roll.');
  if (hr.armorTier > 0) gear('Mail', hr.armorTier, 'From Gerda\'s forge. Each tier soaks 1 more damage per hit.');
  if (hr.shield) chips.push(h('span', { class: 'lg-have', tabindex: 0, 'data-have': 'shield', 'data-tip': `Shield · carried\nRanged hits on ${hr.name} do 1 less; 2 less while braced. Not the Dragon's breath.` }, h('span', { class: 'lg-g', 'aria-hidden': 'true' }, '⛨'), 'Shield'));
  if (hr.ale) chips.push(h('span', { class: 'lg-have ale', tabindex: 0, 'data-have': 'ale', 'data-tip': `${ALE[hr.ale].name} · drunk when ${hr.name} starts the next delve\n${ALE[hr.ale].text}` }, h('span', { class: 'lg-g', 'aria-hidden': 'true' }, ALE[hr.ale].glyph), ALE[hr.ale].name));
  return chips.length ? h('div', { class: 'lg-have-row' }, ...chips) : '';
}

function loadoutCard(hr: Hero, s: GameState, l: Loadout, host: CampHost, fresh?: string): HTMLElement {
  const c = s.campaign;
  const sel = ui.packFor === hr.id;
  const bearer = packItems(c, l, hr.id).some((i) => i.kind === 'lantern'); // V4.1 (WS2): Gerda's lantern, packed
  const pick = () => {
    if (ui.packFor === hr.id) return;
    ui.packFor = hr.id;
    sfx.play('click');
    host.setPage('outfit');
  };
  const card = h('div', { class: `lg-hero ${sel ? 'sel' : ''}`, role: 'group', 'aria-label': hr.name, 'data-hero': hr.id, 'aria-current': sel ? 'true' : undefined });
  card.addEventListener('click', (e) => {
    if (e.target instanceof Element && e.target.closest('button,[role=dialog]')) return;
    pick();
  });
  card.append(
    h(
      'div',
      { class: 'lg-hero-top' },
      hexBadge(hr.cls, 'md', statsTip(hr.cls, hr)),
      h('span', { class: 'lg-hero-n' }, hr.name, h('span', { class: 'lg-hero-c' }, classLine(hr))),
      bearer ? h('span', { class: 'lg-lantern', tabindex: 0, 'data-tip': `Lantern · ${hr.name} carries Gerda's lantern: 20 rounds, refilled in camp.\nIt burns down each round while open; the shutter is free. Lost if ${hr.name} falls.` }, lanternIcon(), 'Lantern') : '',
      sel ? h('span', { class: 'lg-kick lg-packing', 'data-tip': `Packing · What you click on the cart goes in ${hr.name}'s pack; forge work and ales are for ${hr.name}.`, tabindex: 0 }, 'Packing') : btn({ class: 'lg-pickpack', k: `pack-${hr.id}`, data: { packfor: hr.id }, tip: `${hr.name} · What you click on the cart goes in this pack.`, onclick: pick }, 'Pack for them'),
    ),
    packSlots(c, l, hr, host, 'outfit', fresh),
    kitLine(hr),
    haveLine(hr),
  );
  return card;
}

function groupGear(items: Item[]): [Item, Item[]][] {
  const m = new Map<string, [Item, Item[]]>();
  for (const i of items) {
    const e = m.get(i.kind);
    if (e) e[1].push(i);
    else m.set(i.kind, [i, [i]]);
  }
  return [...m.values()];
}

const VAL_WORD: Record<string, string> = { gem: 'Gem', jewelry: 'Jewelry', heirloom: 'Heirloom', hoard: "From the Dragon's hoard" };

function cartBody(el: HTMLElement, s: GameState, l: Loadout, host: CampHost, page: CampPage, justBought?: string): void {
  const c = s.campaign;
  const packed = packedIds(l);
  const who = ui.packFor ? heroOf(c, ui.packFor) : undefined;
  const whoUsed = who ? slotsUsed(packItems(c, l, who.id)) : PACK_SLOTS;
  // V5.0 (P, B1): packing is the explicit act: the row packs for the hero marked Packing; "Give to" packs for any hero.
  const pack = (it: Item, forId = who?.id) => {
    if (!forId) return;
    sfx.play('click');
    const next = structuredClone(l);
    (next.packs[forId] ??= []).push(it.id);
    ui.flash = { row: '', itemId: it.id, text: '' }; // the slot it lands in glows
    host.setDraft(next, page);
  };
  const party = l.heroIds.map((id) => heroOf(c, id)).filter((x): x is NonNullable<typeof x> => !!x);
  const gear = c.stash.filter((i) => !isValuable(i) && i.kind !== 'gold' && !i.story && !packed.has(i.id));
  el.append(h('div', { class: 'lg-cart-h' }, h('span', { class: 'lg-kick' }, 'Gear · goes in packs'), h('span', { class: 'lg-sub' }, who ? `Click to pack it for ${who.name}` : 'Pick a party to pack for')));
  if (!gear.length) el.append(h('p', { class: 'lg-empty sm' }, packed.size ? 'Everything here is packed.' : 'No gear on the cart. The vendors have some.'));
  else
    el.append(
      h(
        'div',
        { class: 'lg-gearlist' },
        ...groupGear(gear).map(([it, all]) => {
          const full = whoUsed + it.slots > PACK_SLOTS;
          const main = btn(
            {
              class: `lg-row lg-cartgear ${justBought === it.kind ? 'new' : ''}`,
              k: `cart-${it.kind}`,
              data: { cart: it.kind },
              off: !who || full,
              tip: `${it.name} · ${all.length} on the cart\n${ITEM_EFFECT[itemBase(it.kind)] ?? ''}\n${!who ? 'Nobody to pack it for.' : full ? `${who.name}'s pack is full.` : `Click: into ${who.name}'s pack.`}`,
              onclick: () => pack(it),
            },
            h('span', { class: 'lg-wg', 'aria-hidden': 'true' }, itemGlyph(it.kind)),
            h('span', { class: 'lg-row-n' }, it.name),
            h('span', { class: 'num lg-row-x' }, `×${all.length}`),
          );
          if (party.length < 2) return main;
          // V5.0 (P, B1): with several heroes, one small "Give to" button per hero on every cart row.
          const give = h('span', { class: 'lg-giveto', 'aria-label': `Give ${it.name} to` });
          for (const hr of party) {
            const used = slotsUsed(packItems(c, l, hr.id));
            const f = used + it.slots > PACK_SLOTS;
            give.append(btn({ class: `lg-giveto-b ${hr.id === who?.id ? 'on' : ''}`, k: `give-${it.kind}-${hr.id}`, data: { giveto: hr.id, kind: it.kind }, off: f, tip: f ? `${hr.name}'s pack is full.` : `Give ${it.name} to ${hr.name} · ${PACK_SLOTS - used} slot${PACK_SLOTS - used === 1 ? '' : 's'} free`, onclick: () => pack(it, hr.id) }, hexBadge(hr.cls, 'sm'), h('span', { class: 'lg-giveto-n' }, hr.name.split(' ')[0]!)));
          }
          return h('div', { class: 'lg-cartrow' }, main, give);
        }),
      ),
    );

  el.append(h('div', { class: 'lg-rule', 'aria-hidden': 'true' }));
  const vals = c.stash.filter(isValuable);
  el.append(h('div', { class: 'lg-cart-h' }, h('span', { class: 'lg-kick lg-kick-gold' }, 'Valuables · worth gold'), h('span', { class: 'lg-sub' }, 'Sell them, or pack a few to pay off a crew.')));
  if (!vals.length) {
    el.append(h('p', { class: 'lg-empty sm' }, 'No valuables. Gems and trinkets you carry out land here.'));
    return;
  }
  const owner = (id: string) => l.heroIds.find((hid) => (l.packs[hid] ?? []).includes(id));
  el.append(
    h(
      'div',
      { class: 'lg-vallist' },
      ...vals.map((it) => {
        const o = owner(it.id);
        const full = whoUsed + it.slots > PACK_SLOTS;
        return h(
          'div',
          { class: `lg-row lg-val ${o ? 'packed' : ''}`, 'data-valuable': it.id, 'data-kind': it.kind },
          h('span', { class: 'lg-wg gold', 'aria-hidden': 'true' }, itemGlyph(it.kind)),
          h('span', { class: 'lg-row-t' }, h('span', { class: 'lg-row-n' }, it.name), h('span', { class: 'lg-row-s' }, `${VAL_WORD[it.kind] ?? 'Valuable'}${it.slots > 1 ? ' · takes 2 slots' : ''}${o ? ` · packed for ${heroOf(c, o)?.name ?? o}` : ''}`)),
          h('span', { class: 'num lg-val-v' }, `${host.engine.value([it])}`),
          o
            ? ''
            : btn({ class: 'btn lg-ghost lg-btn-s', k: `packval-${it.id}`, data: { packval: it.id }, off: !who || full, tip: !who ? 'Pack · Nobody to pack it for.' : full ? `Pack · ${who.name}'s pack is full.` : `Pack · into ${who.name}'s pack\nCrews take gems and trinkets as payment.`, onclick: () => pack(it) }, 'Pack'),
          btn({ class: 'btn lg-btn-s', k: `sell-${it.id}`, data: { sell: it.id }, tip: `Sell · ${it.name} for ${host.engine.value([it])} gold${o ? `\nIt comes out of ${heroOf(c, o)?.name ?? o}'s pack.` : ''}`, onclick: async () => {
            if (await host.send({ type: 'sell', itemId: it.id })) sfx.play('coin');
          } }, 'Sell'),
        );
      }),
    ),
  );
  const worth = host.engine.value(vals);
  const nPacked = vals.filter((i) => owner(i.id)).length;
  el.append(
    h(
      'div',
      { class: 'lg-sellall' },
      h('span', null, `Sells the ${vals.length === 1 ? 'valuable' : `${numWord(vals.length).toLowerCase()} valuables`} above${nPacked ? ', packed ones too' : ''}. Gear stays on the cart.`),
      btn(
        {
          class: 'btn lg-btn lg-primary',
          k: 'sellall',
          data: { sellall: '1' },
          tip: `Sell all · ${worth} gold\n${vals.map((i) => `${i.name}: ${i.amount}`).join('\n')}`,
          onclick: async () => {
            if (await host.send({ type: 'sellAll' })) sfx.play('coin');
          },
        },
        'Sell all · ',
        h('span', { class: 'num' }, `${worth}`),
        ' gold',
      ),
    ),
  );
}

export function cartPage(main: HTMLElement, s: GameState, l: Loadout, host: CampHost): void {
  const c = s.campaign;
  main.append(stepHead("Keven's cart", `${gold(c.gold)} gold in the strongbox. Gear waits here until it goes in a pack; valuables wait to be sold.`));
  if (l.heroIds.length > 1) {
    main.append(
      h(
        'div',
        { class: 'lg-bench lg-packfor' },
        h('span', { class: 'lg-kick lg-kick-dim' }, 'Packing for'),
        ...l.heroIds.map((id) => {
          const hr = heroOf(c, id)!;
          return btn({ class: `lg-benchhero ${ui.packFor === id ? 'on' : ''}`, k: `cpf-${id}`, data: { packfor: id }, tip: `${hr.name} · What you take off the cart goes in this pack.`, onclick: () => ((ui.packFor = id), host.setPage('cart')) }, hexBadge(hr.cls, 'sm'), h('span', { class: 'lg-bh-n' }, hr.name));
        }),
      ),
    );
  }
  const who = ui.packFor ? heroOf(c, ui.packFor) : undefined;
  const box = h('div', { class: 'lg-cartpage' });
  if (who) box.append(h('div', { class: 'lg-cartpack' }, h('span', { class: 'lg-kick lg-kick-dim' }, `${who.name}'s pack`), packSlots(c, l, who, host, 'cart')));
  const body = h('div', { class: 'lg-tabbody lg-cartbody' });
  cartBody(body, s, l, host, 'cart');
  box.append(body);
  main.append(box);
}
