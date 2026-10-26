# V3.9 engine progress

Status: 24.1–24.4 done in the engine. Tests green (`describe('V3.9 eyes front')`, 14 tests; older ones updated with `look()`/`allRound()` helpers). Sim updated (facing bot, Burglar backstabs, "eyes front" report line).

Burglar: sneaks at 4 (dash 4), rubble costs 2 like walking; sound rolls 5% / 10% ending adjacent; noticed sneaking within 2 lit, adjacent unlit, 2 in the Hollow (`NOTICE_QUIET`, `WAKE_*_QUIET` in data.ts). Backstab = Burglar melee, adjacent, in the target's rear half, target unaware of the Burglar; not the Dragon/Gloam; works on crew. Engine helper `canBackstab(c, hero, id)` in delve.ts; `inRearHalf`/`inFrontHalf` in stealth.ts.

## What the UI can rely on

- `HeroInDelve.facing` is always set during a delve (0..5, DIRS). Set at delve start (into the castle), after every move step (stairs keep it), and when an action is aimed at a hex or figure (turns before the roll). `undefined` (old saves) = sees all round.
- Front half = `dirIndex(at, p)` in {facing, facing±1}, the same rule as view/stealth.ts `dirIndexOf` (ties to the lower index). Rear half = the other three directions, any distance. Same for monsters/crew (`inFrontHalf` / `inRearHalf` in src/game/stealth.ts, also in world.ts).
- `face` command: free, unlimited, player phase, any active hero not out cold (webbed/held/rooted heroes may turn). Emits `faced`; refreshes sight. Errors: bad direction, not active, dozing.
- `faced` events: after a move whose facing changed (one, after the `moved` events), on `face`, and when an aimed action turns a hero.
- `visibility().visible`: union of every active hero's front half (adjacent rear hexes unseen), plus hexes of figures revealed by an unseen strike. `explored` keeps growing only from front halves too (layout memory stays).
- `intents()`: only enemies on visible hexes (the Gloam as before).
- `actions()`: adjacent-enemy targets (attack, shove, ...) need the enemy to be visible to the party, like ranged targets already did. Face first.
- Blindsided: any slot-rolled attack on a hero from the hero's rear half gets +1 slot; the roll's `what` gets " from behind" ("Attack from behind", "Free swing from behind", "Overwatch from behind", "Hamstring from behind"). If no hero sees the attacker: `unseenHit {target}` before the hit event (hits only), log "Something strikes Pim from behind." (miss: "Something lunges at Pim from behind and misses."), and the attacker's hex is in `visible` until the next player phase ends.
- `Reach.risks`: wake only for seen sleepers; notice only for watchers on visible hexes; swings only for seen enemies, with the blindsided slot in the damage range when the swinger is in the hero's rear half before the step.
- `seenEnemies(state)`: ids of monsters/crew seen this delve and still on the map, plus whoever is visible now.
- Backstab preview modifier: `'Backstab: +1 slot, double damage'`; the outcome damages are already doubled. Old `'Backstab +1 slot'` is gone.

## Rules calls

- Swings are rolled before the hero turns for the step: walking straight away from an enemy you faced is not blindsided; one already at your back is.
- Unseen strike: `unseenHit` only on a hit; the attacker is revealed hit or miss.
- Enemy overwatch (crew Ranger) also fires only into its front half.
- Already-noticed heroes are still tracked by plain sight (monsters face their quarry anyway).

## Sim (20 delves, real castle)

- SEED 1: done 15/20, deaths 14, avg rounds 15.2. Enemy strikes on heroes 182, from behind 105 (95 hit), unseen hits 28; backstabs 2 (both on sleepers, 1 kill); 373 face commands. Refused commands 0.
- SEED 5: done 14/20, deaths 13. Strikes 263, from behind 112 (104 hit), unseen 63; backstabs 0. Refused 0.
- Same engine before the bot learned to face (SEED 1): done 14, deaths 16.

## Contract requests

None.

## Known issues

- Balance flag: 40–60% of enemy strikes in the sim come from behind, and +1 slot makes them land ~93% of the time. The bot only covers backs when heroes stand together; a careful player will do better, but blindsided may be strong. Owner's call.
- The sim's Burglar seldom backstabs (sleepers it has seen are rarely within a sneak move with a rear-half hex free); a player hunting for them will find more.
- Sim runs ~50% slower than before (more rounds per delve, plus a visible-set per move preview and per strike).
- `face` is refused for a hero out cold (dozing); webbed, held and rooted heroes may turn.
