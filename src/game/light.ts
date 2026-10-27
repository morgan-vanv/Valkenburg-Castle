// V4.1 (WS2, spec 31.5): light. Torches are the clock. There is no free party lantern: a torch (Mott) or Gerda's
// lantern is a pack item with `rounds` left and `lit` (burning, or the lantern's shutter open); it lights where its
// carrier stands, or the hex it lies on when dropped lit, and burns 1 a world phase while lit. The geometry
// (lightSources, litSet, lightTierAt, sight) lives in world.ts; this file is the items, the actions and the burn.

import { distance } from './hex';
import type { ActionTarget, GameState, HeroInDelve, Item } from './types';
import { GLOW_ARROW_ROUNDS } from './data'; // V4.1 (WS6)
import { FREE_LANTERN, KINDLE_LIGHT, KINDLE_RANGE, LANTERN_MAX, OIL_LIGHT, TORCH_ROUNDS } from './data';
import { say, type Ctx, type DelveX } from './state';
import { heroName, makeItem, putOnGround } from './common';
import { burning, fixedLightReaches, isLightItem, lightSources, roundsMax, roundsOf, type LightSrc, type World } from './world';

/** Torches the hero can light now: unlit, with rounds left, half-burnt ones first; none while one burns (radii don't add up). */
export function torchesToLight(h: HeroInDelve): Item[] {
  if (h.pack.some((i) => i.kind === 'torch' && burning(i))) return [];
  const ts = h.pack.filter((i) => i.kind === 'torch' && !i.lit && roundsOf(i) > 0);
  return ts.sort((a, b) => roundsOf(a) - roundsOf(b));
}

/** The hero's lantern (the first one), if any. */
export function lanternOf(h: HeroInDelve): Item | undefined {
  return h.pack.find((i) => i.kind === 'lantern');
}

/** Targets for the light actions (delve.ts targetsFor calls in here). */
export function lightTargets(c: Ctx, h: HeroInDelve, action: 'torch' | 'snuff' | 'dropTorch' | 'shutter' | 'oil' | 'kindle'): ActionTarget[] {
  switch (action) {
    case 'torch':
      return torchesToLight(h).map((t) => ({ itemId: t.id }));
    case 'snuff':
    case 'dropTorch':
      return h.pack.filter((i) => i.kind === 'torch' && burning(i)).map((i) => ({ itemId: i.id }));
    case 'shutter': {
      // Free, any time: open it (light left) or shutter it.
      const l = lanternOf(h);
      return l && (l.lit || roundsOf(l) > 0) ? [{ id: h.heroId, itemId: l.id }] : [];
    }
    case 'oil': {
      const oil = h.pack.find((i) => i.kind === 'oil');
      const l = h.pack.find((i) => i.kind === 'lantern' && roundsOf(i) < LANTERN_MAX);
      return oil && l ? [{ id: h.heroId, itemId: oil.id }] : [];
    }
    case 'kindle': {
      // A torch or lantern held by a hero within 3 (the Pyromancer's own too): light it, or +6 rounds to a burning one.
      const out: ActionTarget[] = [];
      for (const o of c.d.heroes) {
        if ((o.status !== 'active' && o.status !== 'downed') || o.at.level !== h.at.level || distance(o.at, h.at) > KINDLE_RANGE) continue;
        for (const i of o.pack) if (kindleable(i)) out.push({ id: o.heroId, itemId: i.id });
      }
      return out;
    }
  }
}

/** Kindle can work on it: an unlit torch or lantern (a lantern even empty), or a burning one below its most. */
function kindleable(i: Item): boolean {
  if (!isLightItem(i)) return false;
  if (!burning(i)) return i.kind === 'lantern' || roundsOf(i) > 0;
  return roundsOf(i) < roundsMax(i);
}

/** What a light action will do, for the preview. */
export function lightSpecText(c: Ctx, h: HeroInDelve, action: 'torch' | 'snuff' | 'dropTorch' | 'shutter' | 'oil' | 'kindle', t: ActionTarget): string {
  const it = itemIn(c, t.id ?? h.heroId, t.itemId) ?? h.pack.find((i) => i.id === t.itemId);
  switch (action) {
    case 'torch':
      return `Light the torch: radius 3 for ${it ? roundsOf(it) : TORCH_ROUNDS} rounds`;
    case 'snuff':
      return `Snuff it: dark, keeps its ${it ? roundsOf(it) : 0} rounds. Free`;
    case 'dropTorch':
      return 'Drop it here, still burning: it lights this hex. Free';
    case 'shutter':
      return it?.lit ? 'Shutter the lantern: no light, no burn. Free' : `Open the lantern: radius ${it && roundsOf(it) >= 7 ? 4 : 3}, ${it ? roundsOf(it) : 0} rounds left. Free`;
    case 'oil': {
      const l = h.pack.find((i) => i.kind === 'lantern' && roundsOf(i) < LANTERN_MAX);
      return `+${OIL_LIGHT} to the lantern (${l ? Math.min(LANTERN_MAX, roundsOf(l) + OIL_LIGHT) : LANTERN_MAX} of ${LANTERN_MAX})`;
    }
    case 'kindle': {
      const who = t.id && t.id !== h.heroId ? `${heroName(c, t.id)}'s ` : 'your ';
      if (!it) return 'Kindle';
      return burning(it) ? `+${KINDLE_LIGHT} rounds to ${who}${it.kind}` : `Light ${who}${it.kind}${it.kind === 'lantern' && roundsOf(it) <= 0 ? ` (+${KINDLE_LIGHT} rounds)` : ''}`;
    }
  }
}

function itemIn(c: Ctx, heroId: string, itemId?: string): Item | undefined {
  return c.d.heroes.find((x) => x.heroId === heroId)?.pack.find((i) => i.id === itemId);
}

/** Do a light action (delve.ts doAct calls in here). */
export function doLight(c: Ctx, h: HeroInDelve, action: 'torch' | 'snuff' | 'dropTorch' | 'shutter' | 'oil' | 'kindle', t: ActionTarget): void {
  const name = heroName(c, h.heroId);
  c.visCache = undefined;
  switch (action) {
    case 'torch': {
      const it = h.pack.find((i) => i.id === t.itemId)!;
      const again = it.rounds !== undefined && it.rounds < TORCH_ROUNDS;
      it.rounds = roundsOf(it);
      it.lit = true;
      say(c, again ? `${name} relights the torch (${it.rounds} rounds left).` : `${name} lights a torch.`);
      break;
    }
    case 'snuff': {
      const it = h.pack.find((i) => i.id === t.itemId)!;
      it.lit = false;
      say(c, `${name} snuffs the torch (${roundsOf(it)} rounds left).`);
      break;
    }
    case 'dropTorch': {
      const i = h.pack.findIndex((x) => x.id === t.itemId);
      const it = h.pack.splice(i, 1)[0]!;
      putOnGround(c, h.at, [it]);
      say(c, `${name} sets the burning torch down.`);
      break;
    }
    case 'shutter': {
      const it = h.pack.find((i) => i.id === t.itemId)!;
      it.lit = !it.lit && roundsOf(it) > 0;
      c.ev.push({ type: 'shutter', open: !!it.lit });
      say(c, it.lit ? `${name} opens the lantern.` : `${name} shutters the lantern.`);
      break;
    }
    case 'oil': {
      const oi = h.pack.findIndex((x) => x.id === t.itemId);
      if (oi >= 0) h.pack.splice(oi, 1);
      const l = h.pack.find((i) => i.kind === 'lantern' && roundsOf(i) < LANTERN_MAX)!;
      l.rounds = Math.min(LANTERN_MAX, roundsOf(l) + OIL_LIGHT);
      say(c, `${name} tops up the lantern (${l.rounds} of ${LANTERN_MAX}).`);
      break;
    }
    case 'kindle': {
      const it = itemIn(c, t.id!, t.itemId)!;
      const who = t.id === h.heroId ? '' : ` ${heroName(c, t.id!)}'s`;
      if (burning(it)) {
        it.rounds = Math.min(roundsMax(it), roundsOf(it) + KINDLE_LIGHT);
        say(c, `${name} kindles${who || ' the'} ${it.kind}: ${it.rounds} rounds.`);
      } else {
        if (roundsOf(it) <= 0) it.rounds = KINDLE_LIGHT;
        else it.rounds = roundsOf(it);
        it.lit = true;
        say(c, `${name} kindles${who || ' the'} ${it.kind} alight.`);
      }
      break;
    }
  }
}

/**
 * World phase step 1 (V4.1): every lit torch and open lantern on the map burns 1: in the packs of heroes inside (up or
 * downed) and on the ground. A torch at 0 is gone; a lantern at 0 goes dark (oil or Kindle bring it back).
 */
export function burnLights(c: Ctx): void {
  const d = c.d;
  const burn = (items: Item[], who?: string): Item[] => {
    const left: Item[] = [];
    for (const i of items) {
      if (!burning(i)) {
        left.push(i);
        continue;
      }
      i.rounds = roundsOf(i) - 1;
      if (i.rounds > 0) {
        left.push(i);
        continue;
      }
      if (i.kind === 'torch') {
        say(c, who ? `${heroName(c, who)}'s torch gutters out.` : 'A dropped torch gutters out.');
        continue;
      }
      i.lit = false;
      say(c, who ? `${heroName(c, who)}'s lantern is empty.` : 'A lantern on the floor burns out.');
      left.push(i);
    }
    return left;
  };
  for (const h of d.heroes) if (h.status === 'active' || h.status === 'downed') h.pack = burn(h.pack, h.heroId);
  for (const g of d.ground) g.items = burn(g.items);
  d.ground = d.ground.filter((g) => g.items.length > 0);
  c.visCache = undefined;
}

/** What lights the castle as the HUD and view see it: the light sources of `world.lightSources`, with rounds. */
export function lightsOf(d: DelveX): (LightSrc & { rounds?: number; max?: number })[] {
  return lightSources(d).map((L) => (L.item ? { ...L, rounds: roundsOf(L.item), max: roundsMax(L.item) } : L.kind === 'arrow' ? { ...L, max: GLOW_ARROW_ROUNDS } : L));
}

/**
 * Old saves (V4.0 and before, a delve in progress): the free party lantern (`Delve.light`, `lanternOpen`,
 * `lanternBearer`) becomes a slotless loaner Lantern in its bearer's pack (it goes away when the delve ends), and a
 * hero's lit torch (`torch` rounds) becomes a slotless lit torch item. Idempotent.
 */
export function migrateLight(s: GameState): void {
  const d = s.delve as DelveX | null;
  if (!d) return;
  if (typeof d.light === 'number') {
    const b = d.heroes.find((h) => h.heroId === d.lanternBearer && (h.status === 'active' || h.status === 'downed')) ?? d.heroes.find((h) => h.status === 'active');
    if (b) {
      const it = makeItem({ s }, 'lantern', 1, 'Lantern');
      it.slots = 0;
      it.loaner = true;
      it.rounds = Math.max(0, Math.min(LANTERN_MAX, d.light));
      it.lit = d.lanternOpen !== false && it.rounds > 0;
      b.pack.push(it);
    }
    delete d.light;
    delete d.lanternBearer;
    delete d.lanternOpen;
  }
  for (const h of d.heroes) {
    if ((h.torch ?? 0) > 0) {
      const t = makeItem({ s }, 'torch', 1, 'Torch');
      t.slots = 0;
      t.loaner = true;
      t.rounds = Math.min(TORCH_ROUNDS, h.torch);
      t.lit = true;
      h.pack.push(t);
    }
    h.torch = 0;
  }
}

/** FREE_LANTERN (off since V4.1): the old free lantern as a slotless loaner in the first hero's pack. */
export function freeLantern(s: GameState, h: HeroInDelve): void {
  if (!FREE_LANTERN.enabled) return;
  const it = makeItem({ s }, 'lantern', 1, 'Lantern');
  it.slots = 0;
  it.loaner = true;
  it.lit = true;
  h.pack.push(it);
}

/**
 * Back in camp (and at a delve's start): a lantern is refilled free and shuttered; a torch is put out and keeps its
 * rounds. Returns false for a loaner (the old free lantern): it doesn't go to the cart.
 */
export function restLight(i: Item): boolean {
  if (i.loaner) return false;
  if (i.kind === 'lantern') {
    delete i.rounds;
    i.lit = false;
  } else if (i.kind === 'torch') i.lit = false;
  return true;
}

/**
 * V4.1 (WS2, the board's "Unlit" chip): the site hex is in the campaign's castle memory and no fixed castle light
 * (sconce, daylight, fire, fungus, glow, a brazier lit for good) reaches it.
 */
export function siteUnlit(w: World, s: GameState, siteId: string): boolean {
  const site = w.castle.contractSites.find((x) => x.id === siteId);
  if (!site) return false;
  const mem = s.campaign.explored?.[site.at.level] ?? [];
  if (!mem.includes(`${site.at.q},${site.at.r}`)) return false;
  return !fixedLightReaches(w, site.at, s.campaign.litBraziers);
}

/** The hero who carries the most light (biggest burning radius); undefined when nobody does. */
export function brightestHero(d: DelveX, ids?: string[]): string | undefined {
  let best: string | undefined;
  let r = 0;
  for (const L of lightSources(d)) {
    if (!L.party || !L.holder || (ids && !ids.includes(L.holder))) continue;
    if (L.radius > r) {
      r = L.radius;
      best = L.holder;
    }
  }
  return best;
}
