// V4.1 (spec 31.13, owner): reactions. The castle's turn can pause for a hero's answer.
//
// A reaction point in the rules calls `ask(c, question)`. The hero's setting answers it without pausing (always /
// never); a bot's policy answers it the same way. Otherwise the n-th question of the command takes `c.answers[n]`,
// and past the end of the answers `ask` throws a `Pause`: `apply` (engine.ts) then hands back the state from before
// the command with `delve.pending`, and the `react` command re-runs the command with one more answer. The re-run is
// deterministic (the seeded dice live in the state), so it reaches the same question and goes on from there.

import { REACTION_DEFAULTS, REACTION_FALLBACK } from './data';
import { hd } from './common';
import type { Ctx } from './state';
import type { HeroInDelve, ReactionChoice, ReactionKind, ReactionQuestion, ReactionSetting } from './types';

/** Thrown by `ask` when a question has no answer yet; caught only by `apply`. */
export class Pause {
  constructor(readonly question: ReactionQuestion) {}
}

/** The hero's setting for one kind of reaction (their own, else the default; the WIP `ambush` flag reads as always). */
export function reactionSetting(h: HeroInDelve, kind: ReactionKind): ReactionSetting {
  const own = h.reactions?.[kind];
  if (own) return own;
  if (kind === 'hiddenSwing' && (h as HeroInDelve & { ambush?: boolean }).ambush) return 'always';
  return REACTION_DEFAULTS[kind];
}

/**
 * A reaction point: the hero's answer to `q`. Setting always / never answers at once; then a question already
 * answered this castle's turn (same kind, hero and enemy; for a block, the same hit) keeps its answer; then a bot's policy; then the player's
 * answers in order; with none left, the turn pauses (throws `Pause`). With nobody to ask (a Ctx made outside
 * `apply`), the kind's fallback answer.
 */
export function ask(c: Ctx, q: ReactionQuestion): ReactionChoice {
  const h = hd(c, q.heroId);
  const set = h ? reactionSetting(h, q.kind) : 'ask';
  if (set === 'always') return 'yes';
  if (set === 'never') return 'no';
  // V5.0 (review): a block is a decision about one hit, so a second, harder hit from the same enemy asks again.
  const key = `${c.d.round}:${q.kind}:${q.heroId}:${q.enemyId}${q.damage !== undefined ? `:${q.damage}` : ''}`;
  const memo = (c.reacted ??= new Map());
  const seen = memo.get(key);
  if (seen) return seen;
  let a: ReactionChoice | undefined;
  if (c.policy) a = c.policy(q, c.s);
  else if (!c.answers) a = REACTION_FALLBACK[q.kind];
  else {
    const n = c.asked ?? 0;
    c.asked = n + 1;
    a = c.answers[n];
    if (a === undefined) throw new Pause(q);
  }
  memo.set(key, a);
  return a;
}

/** "the orc" for a plain monster, its own name otherwise ("Ugluk", "Brannoc the Sellsword"). */
export function called(c: Ctx, id: string): string {
  const m = c.d.monsters.find((x) => x.id === id);
  if (m && /^[A-Z][a-z]+$/.test(m.name) && m.name.toLowerCase() === m.kind) return `the ${m.kind}`;
  return m?.name ?? c.d.rivals?.members.find((r) => r.id === id)?.name ?? id;
}

export function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
