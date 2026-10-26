# V3.8 engine progress (exploration mode, spec 22)

## Done

- `src/game/explore.ts` (new; replaces `calm.ts`, deleted): modes, the tick, walk/stopWalk/sneak, explore actions and deals, combat start and end, `explorePath`, `vision`.
- `engine.ts`: commands `tick`, `walk`, `stopWalk`, `sneak`; `move`/`endTurn` refused while exploring; `act`/`deal` go through the explore wrappers while exploring; `Engine.mode`, `explorePath`, `vision`; `calm`/`calmReach` gone. `deserialize` gives a mode-less delve `mode: 'combat'`.
- `world-phase.ts`: `exploreRound` (the round timers without lantern, torches, bleeding, turns), `spawnGloam` split out of the Gloam phase, the ambush (`DelveX.ambush`) in the world phase, `calmSteps` gone.
- `rivals.ts`: `rivalsExplore(c, 'tick' | 'step' | 'round')`; loot/leave/post/job walks can take one hex.
- `common.ts`: exploring, `goAlert` never makes a berserker hunt; `investigate` events. `stealth.ts`: no free swings by heroes while exploring; `watchers` exported.
- `data.ts`: `WALK_TICKS 1, SNEAK_TICKS 2, HEAVY_TICKS 2, PATROL_TICKS 4, ROUND_TICKS 8, LANTERN_HEXES 4, TORCH_HEXES 4, EXPLORE_PATH_MAX 400`; `CALM_STEPS` gone.
- Tests: `src/game/explore.test.ts` (`describe('V3.8 explore')`, 29 tests). Old calm tests removed (their rules are gone); combat-rule tests run in turns via `delve()` (no `mode`) and `inTurns()` in engine.test.ts, and charges.test.ts's helper. 254/254 pass.

## What the UI can rely on

**Mode.** `state.delve.mode` is `'explore' | 'combat'`; absent = combat (only in old states; a loaded save gets `'combat'`). `engine.mode(state)` → `{ mode: 'explore' }`, or `{ mode: 'combat', why? }` where `why` is what keeps the fight going ("An orc hunts Pim.", "An orc is searching.", "The Ferrymen want their toll.", "A fuse is lit.", "Pim is down."). `d.phase` stays `'player'` while exploring.

**Events.**
- `{ type: 'mode', mode: 'explore' }` at delve start (no `why`).
- Combat start: `{ type: 'mode', mode: 'combat', first: 'enemies', why: 'The orc sees Pim.', by: <monster id> }` then, in the same result, a whole world phase (`phase world` ... `phase player`). Or `first: 'party'`: `why` is "Pim strikes first." (hostile act, `by` = hero), "Rae looses an arrow." (overwatch, `by` = hero), "Brann calls the fight." (Fight deal), "The Ferrymen want their toll." (`by` = a member), "A fuse is lit.", "The Gloam rises." (`by` = the Gloam's id; it spawns in that result). No world phase follows a party-first start.
- Combat end: `{ type: 'mode', mode: 'explore', why: 'The castle quiets.' }`.
- `walkStopped { heroId, at, why }` when a walk order ends early: `'a trap'`, `'caltrops'`, `'a fire vent'`, `'the way is blocked'`, `'someone is there'`, `'off the path'`. Not sent when an order completes, nor when combat clears all orders (the `mode` event says it).
- `investigate { id, at }` when a monster goes to look at a noise (exploring only). Show "?" for `awareness === 'alert'` while exploring.
- Each hero step: `moved { id, path: [hex] }` (one hex), `levelChanged` on stairs/lift, and walking (not sneaking) a `noise { at, radius: 1 }` (2 on rubble) per hex. Monsters and crews: `moved` with one hex per step.

**Commands.**
- `tick`: exploring only; in combat it returns the state unchanged with no events and no error (safe to send late).
- `walk { heroId, path, sneak? }`: exploring only. Path: consecutive steps (stairs ok) over explored hexes, through heroes and hired crew, not through monsters/unhired crews, not ending on another figure. `sneak` given → it also sets the hero's stance (`sneaking`); omitted → the hero's stance. Replaces any order the hero had. Errors: "You haven't seen that way yet.", "Can't go that way.", "Something is in the way.", "Someone is already there.", rooted/webbed/held.
- `stopWalk { heroId }`: any time, no error if there's no order.
- `sneak { heroId, on }`: any time, free; changes a walk under way too.
- `move`: refused while exploring ("Exploring: give a walk order."). `endTurn`: refused while exploring ("Nothing to end while exploring.").
- `act` while exploring: no limits; after it `acted`/`moved` are false again (unless it started combat party-first: then the actor has `acted: true`). The actor's walk holds 1 tick.
- `deal` while exploring: free; Fight → combat party-first.

**Pace.** Walking 1 hex/tick, sneaking or heavy copper 1 per 2 ticks; a hex costing 2 (rubble) takes twice as long. Patrols, investigators, monsters walking home and prospector crews: 1 hex every 4 ticks (on ticks 4, 8, ...). Hired crews keep within 2 of the hirer at 1 hex/tick. Exploring round every 8 ticks: `round` +1. `d.ticks` resets to 0 when exploring resumes. Lantern: `d.lanternSteps` counts the bearer's hexes; every 4th burns 1 light (open lantern only). A lit torch loses 1 round per 4 hexes its carrier walks. Standing still costs nothing.

**Queries.**
- `explorePath(state, heroId, to, sneak)` → `Reach` or null (unexplored, occupied end, unreachable, hero can't move). `risks.wake` along the path, `risks.notice` = enemies that would notice at ANY hex of the path, `risks.swings` (none while exploring in practice).
- `vision(state)` → `{ id, walk, sneak }[]` for every awake monster (not the Dragon or the Gloam) and every waiting/hostile crew member **on a level with an active hero** (other levels skipped for speed: ~16 ms on the real castle with 7 watchers; call it once per tick, not per frame). `sneak` ⊆ `walk`. Hexes are enterable tiles within 8.
- Walk orders and `explorePath` may use explored hexes plus the far end of a stair or lift whose near end is explored (otherwise nobody could ever go down a stair: the next level is unexplored until you arrive).
- `reachable` returns [] while exploring.

**Noticing.** Standing heroes are noticed by their stance (`sneaking`); a walking hero by the order's stance. Every tick after the steps, and after every explore action.

## Rules decisions (worth the lead's eye)

- A hostile act that leaves nothing to fight (a one-blow silent kill of a lone sleeper, nothing else hunting or searching) does not start combat.
- Ambush: everything that hadn't noticed a hero before the act loses its first world phase; those the act set hunting turn to face the attacker (no wider "everyone hunts").
- No bleeding while exploring (not in 22.2's list). A trap or vent that downs a hero leaves them downed; revive works; the next combat counts it.
- An investigator that can't get closer searches from where it is. A monster hunting nobody it can see while exploring goes back to searching (loseQuarry).
- Toll demand mid-explore → combat party first; paying it ends combat (nothing left) → explore.
- A prospector crew blocked by a hero while exploring counts half a block per step (two steps a round), so "blocked two rounds running" keeps its meaning.
- `vision` covers only levels with an active hero (spec says any level).

## Scripts

- `npx tsx scripts/v38-engine-patrol.ts`: Keven walks the test castle's row 7 toward the east-hall patrol: walking, sneaking, sneaking with the lantern shut; prints the tick combat starts and the light used.
- `npx tsx scripts/v3-engine-sim.ts N`: the bot explores with walk orders + ticks (the bearer toward the explored hex nearest the goal, the others keeping within 2), harmless explore actions, then fights in turns. Prints per delve ticks, fights, light burned by distance + by world phases; totals by combat trigger. `TICK_CAP` env (default 3000). Slow: ~25 s a delve (mostly the bot's own `actions()`/`deals()` calls in combat).

## Results (real castle, seed 1)

- Tests: 254/254 (`npx vitest run src/game`); typecheck clean in src/game and the two scripts.
- Patrol script: walking, combat at tick 10 (noticed, enemies first), light 20 → 17 (2 by distance, 1 by the world phase); sneaking, tick 20; sneaking with the lantern shut, tick 24, no light used.
- Sim, 20 delves: 2262 ticks (avg 113), 850 walk orders (76 sneaking), 56 stopped early, 158 explore actions; 82 combats (79 noticed / enemies first, 2 the Gloam, 1 a crew turning), 78 back to exploring, 288 world phases. Lantern: 30 burned by distance, 95 by world phases (1.5 + 4.8 a delve). 14/20 done; L1 13/13; L2 1/6 (10 deaths); L3 0/1. 0 refused commands. The bot never ambushes (no hostile acts while exploring), so party-first starts are rare in the sim.
- Known: the bot is slow (~25 s a delve); two L2 smith rescues ran to the 80-round cap in combat with the Gloam after the light ran out.

## Contract requests

- None so far.
