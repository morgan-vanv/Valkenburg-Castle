// Spec 18.6: parley with a rival crew. Any active hero within 4 of a visible member, in line
// of sight, may make one deal per crew per round; deals are free (no move or action) and are
// paid from the party's packs: gold first, then gems and jewelry, smallest first, no change.

import { parsePosKey, posKey, range, type Pos } from './hex';
import type { DealKind, DealOption, Item, JobKind } from './types';
import {
  BETRAY_CHANCE, BETRAY_LOOT, DEAL_PRICE, DEAL_RANGE, DEEP_PRICE, HIRE_KEEP, HIRE_ROUNDS, SCOUT_RANGE, TRUCE_HOSTILE,
} from './data';
import { say, type Ctx, type CrewX } from './state';
import { hd, heroName, makeHostile, noteOnce, partyValue, putOnGround, rivalsOnMap, round5 } from './common';
import { distance } from './hex';
import { doorAt, kindAt, los, within } from './world';
import { computeRivalIntents } from './rivals';
import { crewPicker } from './crewmove';
import { visNow } from './delve';
import { crewBeaten } from './crewpower'; // V4.1 (WS7, spec 31.9)

/** Crew members this hero can talk to: visible, unveiled, within 4, in line of sight. */
export function parleyTargets(c: Ctx, heroId: string): { id: string; at: Pos }[] {
  const h = hd(c, heroId);
  const cr = c.d.rivals;
  if (!h || h.status !== 'active' || !cr || c.d.phase !== 'player' || c.s.stage !== 'delve') return [];
  const vis = visNow(c);
  return rivalsOnMap(c)
    .filter((r) => (r.veil ?? 0) <= 0 && vis.has(posKey(r.at)) && within(r.at, h.at, DEAL_RANGE) && los(c.w, c.d, h.at, r.at))
    .map((r) => ({ id: r.id, at: { ...r.at } }));
}

/** Price after depth: ×1.5 on Level 2 and deeper, rounded to 5. */
function priced(base: number, level: number): number {
  return level >= 2 ? round5(base * DEEP_PRICE) : base;
}

interface Payment {
  items: { item: Item; take: number }[];
  total: number;
  words: string;
}

/** What paying `price` would hand over, or null if the party can't cover it (see `payable`). */
function plan(c: Ctx, price: number): Payment | null {
  const heroes = c.d.heroes.filter((h) => h.status === 'active');
  const gold = heroes.flatMap((h) => h.pack.filter((i) => i.kind === 'gold' && !i.story));
  const gems = heroes
    .flatMap((h) => h.pack.filter((i) => (i.kind === 'gem' || i.kind === 'jewelry') && !i.story))
    .sort((a, b) => a.amount - b.amount || (a.id < b.id ? -1 : 1));
  const out: Payment['items'] = [];
  let owe = price;
  let coins = 0;
  for (const g of gold) {
    if (owe <= 0) break;
    const n = Math.min(g.amount, owe);
    out.push({ item: g, take: n });
    coins += n;
    owe -= n;
  }
  const valuables: Item[] = [];
  for (const g of gems) {
    if (owe <= 0) break;
    out.push({ item: g, take: g.amount });
    valuables.push(g);
    owe -= g.amount;
  }
  if (owe > 0) return null;
  const parts: string[] = [];
  if (coins) parts.push(`${coins} gold`);
  for (const v of valuables) parts.push(`${/^[aeiou]/i.test(v.name) ? 'an' : 'a'} ${v.name.toLowerCase()} (${v.amount})`);
  const words = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : (parts[0] ?? 'nothing');
  return { items: out, total: price - owe, words };
}

/** What the party could hand over in all: gold, gems and jewelry (never heirlooms, hoard or story items). */
export function payable(c: Ctx): number {
  return c.d.heroes
    .filter((h) => h.status === 'active')
    .flatMap((h) => h.pack)
    .filter((i) => !i.story && (i.kind === 'gold' || i.kind === 'gem' || i.kind === 'jewelry'))
    .reduce((n, i) => n + i.amount, 0);
}

/** Hand the payment over: out of the packs, into the lead member's loot. Returns the item names. */
function pay(c: Ctx, p: Payment): string[] {
  const cr = c.d.rivals!;
  const lead = rivalsOnMap(c)[0] ?? cr.members[0]!;
  const paid: string[] = [];
  let coins = 0;
  for (const { item, take } of p.items) {
    if (item.kind === 'gold') {
      item.amount -= take;
      item.name = `${item.amount} gold`;
      coins += take;
    } else {
      for (const h of c.d.heroes) h.pack = h.pack.filter((i) => i !== item);
      lead.loot.push(item);
      paid.push(item.name);
    }
  }
  for (const h of c.d.heroes) h.pack = h.pack.filter((i) => i.kind !== 'gold' || i.amount > 0);
  if (coins) {
    lead.loot.push({ id: `pay${c.d.round}-${lead.loot.length}`, kind: 'gold', name: `${coins} gold`, amount: coins, slots: 1 });
    paid.unshift(`${coins} gold`);
  }
  return paid;
}

/** The winch on the crew's level (and the lift not yet running). */
function winchFor(c: Ctx): Pos | undefined {
  const lv = rivalsOnMap(c)[0]?.at.level;
  if (c.d.liftWorking) return undefined;
  return c.w.winches.find((w) => w.level === lv);
}

/** The nearest seen locked door or chest on the crew's level. */
function lockFor(c: Ctx): Pos | undefined {
  const lead = rivalsOnMap(c)[0];
  if (!lead) return undefined;
  const seen = new Set(c.d.explored);
  const cands: Pos[] = [];
  for (const [k, door] of Object.entries(c.d.doors)) {
    if (!door.locked || door.open || door.jammed || !seen.has(k)) continue; // V4.0 (spec 28.3): a jammed lock can't be picked
    // V4.0 (spec 25.2): no crew job opens a barred gate.
    if (c.w.tile(parsePosKey(k))?.barred) continue;
    const [lv, rest] = k.split(':');
    const [q, r] = (rest ?? '0,0').split(',').map(Number) as [number, number];
    cands.push({ level: Number(lv), q, r });
  }
  for (const ch of c.d.chests) if (!ch.opened && ch.locked && !ch.jammed && seen.has(posKey(ch.at))) cands.push(ch.at);
  return cands
    .filter((p) => p.level === lead.at.level)
    .sort((a, b) => distance(a, lead.at) - distance(b, lead.at) || posKey(a).localeCompare(posKey(b)))[0];
}

const JOB_TEXT: Record<JobKind, string> = {
  winch: 'They walk to the winch and work it: the lift runs.',
  open: 'Their lockpicker opens the nearest locked door or chest you have seen, silently if every slot hits; a lock that holds is tried again; if it jams, the job is over and they keep the money.',
  scout: `Everything within ${SCOUT_RANGE} of each of them is mapped for you, now.`,
};

/** Every deal the hero could make with the crew right now (empty when nobody is in reach). */
export function deals(c: Ctx, heroId: string): DealOption[] {
  const cr = c.d.rivals;
  const h = hd(c, heroId);
  if (!cr || !h || !parleyTargets(c, heroId).length) return [];
  const lv = h.at.level;
  const st = cr.stance;
  const once = cr.dealRound === c.d.round ? 'One deal a round with them. Try again next turn.' : undefined;
  const have = payable(c);
  const out: DealOption[] = [];
  const offer = (deal: DealKind, label: string, price: number, text: string, unavailable?: string, extra: Partial<DealOption> = {}, job?: JobKind) => {
    const p = price > 0 ? plan(c, price) : null;
    let blocked = unavailable ?? (deal === 'fight' ? undefined : once);
    if (!blocked && price > 0 && !p) blocked = `You carry ${have}; they want ${price}.`;
    out.push({
      deal, label, price, text,
      ...(job ? { job } : {}),
      ...(p ? { pays: p.words } : {}),
      ...extra,
      ok: !blocked,
      ...(blocked ? { blocked } : {}),
    });
  };
  // V4.1 (WS7, spec 31.9): a hostile crew with half its members down takes a truce or a leave for nothing.
  const beaten = crewBeaten(c);
  // leave
  offer('leave', beaten ? 'Let them go' : 'Pay them to leave', beaten ? 0 : priced(DEAL_PRICE.leave, lv), 'They make for the nearest exit now and drop any heirloom they carry.',
    st === 'hired' ? 'They work for you now.' : st === 'bribed' ? 'They are already leaving.' : undefined);
  // truce (the toll while demanding)
  const trucePrice = beaten ? 0 : st === 'demanding' ? (cr.toll ?? 0) : st === 'hostile' ? priced(TRUCE_HOSTILE, lv) : priced(DEAL_PRICE.truce, lv);
  offer('truce', st === 'demanding' ? 'Pay the toll' : beaten ? 'Offer a truce' : 'Buy a truce', trucePrice,
    cr.temperament === 'cutthroat' ? 'They never attack unless attacked, and hold their post.' : 'They never attack unless attacked, and keep looting.',
    st === 'hired' ? 'They work for you now.' : st === 'truce' ? 'You already have a truce.' : undefined);
  // jobs
  const jobOk = st === 'neutral' || st === 'truce' || st === 'waiting';
  const jobWhy = cr.job ? 'They are still on the last job.' : !jobOk ? (st === 'hired' ? 'They work for you now: no extra jobs.' : st === 'demanding' ? 'Pay the toll first.' : 'Only for a crew at peace with you.') : undefined;
  const jobPrice = priced(DEAL_PRICE.job, lv);
  offer('job', 'Job: work the winch', jobPrice, JOB_TEXT.winch, jobWhy ?? (winchFor(c) ? undefined : c.d.liftWorking ? 'The lift already runs.' : 'No winch on their level.'), {}, 'winch');
  // V4.0 (spec 28.3): a lock is opened by the heroes' rules: only a crew with lockpicks can promise silence.
  offer('job', 'Job: open a lock', jobPrice, JOB_TEXT.open, jobWhy ?? (!crewPicker(c) ? 'None of them carries lockpicks.' : lockFor(c) ? undefined : 'No locked door or chest seen on their level.'), {}, 'open');
  offer('job', 'Job: scout', jobPrice, JOB_TEXT.scout, jobWhy, {}, 'scout');
  // hire
  const carried = partyValue(c);
  const risk = carried >= BETRAY_LOOT
    ? `You carry ${carried} in loot: when the ${HIRE_ROUNDS} rounds end, ${BETRAY_CHANCE}% they turn on you.`
    : `When the ${HIRE_ROUNDS} rounds end, ${BETRAY_CHANCE}% they turn on you if you carry ${BETRAY_LOOT}+ in loot (you carry ${carried}).`;
  offer('hire', `Hire them (${HIRE_ROUNDS} rounds)`, priced(DEAL_PRICE.hire, lv),
    `For ${HIRE_ROUNDS} rounds they keep within ${HIRE_KEEP} of ${heroName(c, heroId)} and fight the monsters in reach.`,
    st === 'hostile' ? 'They are out for your blood.' : st === 'hired' ? 'They already work for you.' : undefined, { risk });
  // fight
  offer('fight', 'Fight', 0, 'No deal. They turn hostile now.', st === 'hostile' ? 'You are already fighting.' : undefined);
  return out;
}

/** Make the deal (the `deal` command). Returns an error sentence, or undefined. */
export function doDeal(c: Ctx, heroId: string, deal: DealKind, job?: JobKind): string | undefined {
  const cr = c.d.rivals;
  const h = hd(c, heroId);
  if (!h) return 'No such hero.';
  if (!cr || !parleyTargets(c, heroId).length) return `Nobody to parley with within ${DEAL_RANGE} of ${heroName(c, heroId)}.`;
  const opt = deals(c, heroId).find((o) => o.deal === deal && (deal !== 'job' || o.job === job));
  if (!opt) return deal === 'job' ? 'Pick a job: winch, open or scout.' : 'No such deal.';
  if (!opt.ok) return opt.blocked ?? 'Not now.';
  let paid: string[] = [];
  const beaten = crewBeaten(c) && (deal === 'truce' || deal === 'leave'); // V4.1 (WS7)
  if (opt.price > 0) {
    const p = plan(c, opt.price)!;
    paid = pay(c, p);
  }
  if (deal !== 'fight') cr.dealRound = c.d.round;
  const name = cr.name;
  switch (deal) {
    case 'leave': {
      cr.stance = 'bribed';
      cr.goal = 'leave';
      cr.toll = undefined;
      cr.job = undefined;
      for (const r of cr.members) {
        const hl = r.loot.filter((i) => i.kind === 'heirloom');
        if (hl.length && !r.goneOut && r.hp > 0) {
          r.loot = r.loot.filter((i) => i.kind !== 'heirloom');
          putOnGround(c, r.at, hl);
          say(c, `${r.name} drops ${hl[0]!.name.replace(/^The /, 'the ')} at your feet.`);
        }
      }
      say(c, beaten ? `${name} take the way out you offer, carrying their own. Nobody pays.` : `${name} pocket the coin and make for the way out.`);
      if (beaten) noteOnce(c, `${name} took a truce when the fight turned against them.`);
      break;
    }
    case 'truce':
      cr.stance = 'truce';
      cr.toll = undefined;
      cr.blocked = 0;
      if (cr.goal === 'leave' && cr.temperament === 'cutthroat') cr.goal = 'loot';
      say(c, opt.label === 'Pay the toll' ? `${name} count the coin. "Pass, then."` : beaten ? `${name} lower their blades. "Done. We'll go." A truce, for nothing.` : `${name} lower their blades. A truce.`);
      if (beaten) {
        cr.goal = 'leave';
        noteOnce(c, `${name} took a truce when the fight turned against them.`);
      }
      break;
    case 'job': {
      if (job === 'scout') {
        const ex = new Set(c.d.explored);
        for (const r of rivalsOnMap(c)) {
          for (const x of range(r.at, SCOUT_RANGE)) {
            const p = { level: r.at.level, ...x };
            const k = posKey(p);
            if (!c.w.tile(p) || ex.has(k)) continue;
            ex.add(k);
            c.d.explored.push(k);
          }
        }
        say(c, `${name} sketch you a map of everything around them.`);
      } else {
        const at = job === 'winch' ? winchFor(c)! : lockFor(c)!;
        cr.job = { kind: job!, at: { ...at }, price: opt.price, by: heroId };
        say(c, job === 'winch' ? `${name} agree to work the winch.` : `${name} agree to open the ${kindAt(c.w, c.d, at) === 'door' && doorAt(c.d, at) ? 'door' : 'chest'} for you.`);
      }
      break;
    }
    case 'hire':
      cr.stance = 'hired';
      cr.hiredRounds = HIRE_ROUNDS;
      (cr as CrewX).hiredBy = heroId;
      cr.toll = undefined;
      cr.job = undefined;
      cr.goal = 'loot';
      say(c, `${name} take your coin. For ${HIRE_ROUNDS} rounds, they fight beside ${heroName(c, heroId)}.`);
      break;
    case 'fight':
      makeHostile(c);
      break;
  }
  c.ev.push({ type: 'deal', deal, ...(job ? { job } : {}), price: opt.price, paid });
  if (deal !== 'fight') c.ev.push({ type: 'rivalsStance', stance: cr.stance });
  // New stance, new intents.
  computeRivalIntents(c);
  return undefined;
}
