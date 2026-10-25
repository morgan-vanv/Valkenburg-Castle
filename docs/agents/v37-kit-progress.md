# V3.7 kit and free movement (engine agent "kit"): progress

Spec 20.5. Append-only sections; the crews and presentation agents read this.

## Done

- **src/game/calm.ts** (new, mine): `calmReason`/`isCalm` (hunter on a level with an active hero, hostile or demanding crew with members on the map, the Gloam, a lit fuse, a hero down/held/webbed/rooted), `updateCalm` (syncs `Delve.calm`, one `calm` event per change), `calmReach(c, heroId, sneak)` (every explored hex, any distance, stairs and the lift, risks per path, spotted traps and vents as tie-break penalties; empty when not calm), `followersOf`, `calmWalk` (the long-walk executor).
- **Free movement** (`doMove` in delve.ts): while calm a `move` path may be any length; `moved` is never set (so calm heroes walk again and again, acted or not); the path is validated hex by hex (terrain, monsters/rivals block, the end hex free). `calmWalk` steps the mover one hex at a time with the per-hex rules (doors, walking noise, wake rolls, the crews' caltrops, traps, prisoner follow, trap spotting, ghouls, lair check), counts `Delve.calmSteps`, and when it reaches `CALM_STEPS` (4) runs the normal `worldPhase` (light, torches, fuses, monsters, rivals, the Gloam, ales, searches, a new round) and resets the count; the last step of a path counts too (so 4 + 4 + 4 behaves like 12). `endTurn` resets `calmSteps` as well.
- **Stops**: calm ending (something hunts, a crew demands or turns hostile, the Gloam rises, a fuse is lit, a hero goes down), a sleeper waking or any monster going alert/hunting, a trap or crew caltrops, a hero's HP dropping, a lantern stage change, a monster or (non-hired) crew member newly in sight. The remaining path is dropped. When calm ended: `calm {calm:false, why}` and every active hero gets `moved/acted/dashed = false` (the party acts first). Other stops: a `say` line ("Brann stops: Spider in sight." / "...: the light is dim." / "...: a trap."), `Delve.calm` stays true, no `calm` event.
- **Follow** (`move.follow`): the other active heroes on the mover's level within 3 (not webbed/held/rooted/dozing) walk in single file into the hex the one ahead just left (a short dijkstra hop of up to 6 for the first step when not adjacent); their hexes get the per-hex rules too but count no steps (the castle turns for the mover's steps only). A follower that can't make its hop "falls behind" and drops out of the line. End-of-walk: vents and the end-adjacent wake rule (`wakeAdjacent`) for followers and for a mover stopped short.
- **Engine.calm(state)** → `{ calm }` or `{ calm:false, why }` ("An orc hunts Pim." / "Rats hunt Pim." / "The Ferrymen are hostile." / "...want their toll." / "A fuse is lit." / "The Gloam is near." / "Pim is down." / "is held." / "is stuck." / "is rooted."). `updateCalm` runs after every delve command and at `startDelve` (so the delve opens with a `calm: true` event).
- **Brace** (`brace`: heir, sellsword, sapper; self; action; `braced` event): `HeroInDelve.braced` until the new round (cleared in world-phase "5. New round", so a calm castle turn clears it too). In `ai.ts strikeDetailed` (every monster/crew strike, free swing, firebolt, overwatch): chance −15, 1 less per hit after armor and ward (min 0). `stealth.ts heroSwings`: a braced hero's free swing is at full slots.
- **Shield** (`buyShield` in camp.ts: 50 gold, needs the smith, once per hero, `Hero.shield`): `common.ts guardMods`/`rangedLabel`: labels Shot/Firebolt/Overwatch/dart count as ranged: 1 less, 2 less while braced (stacked on the brace's own 1). Breath, blasts, falls, the Gloam untouched.
- **Hamstring** (`hamstring`: anyone whose weapon has a range = the Ranger; enemy in sight within 5, awake, not the Dragon): 1 Finesse slot at −20 (shown as "Aimed low −20%"), noise 1; a hit = `rootFigure` (common.ts): a hero `rooted` (refreshed to the max), a monster or crew member `stuck` (rivals: new engine-private `RivalX.stuck`). `rooted` event `{id, by, rounds}`. Rooted heroes: `moveKind` null (move refused with "rooted to the spot for n more rounds", `reachable` empty, no climb/jump/grapple), actions allowed; rooted ticks at the **start** of the world phase, so an archer's hamstring costs two of the hero's turns. Rooted rivals: `walk()` in ai.ts refuses to move them; their `stuck` ticks at the end of the world phase like a monster's.
- **Orc archer hamstring**: `ai.ts hamstringIntent(c, from, target)` (a hero not rooted, within 3 and within HAMSTRING_RANGE with line of sight) and `hamstringShot(c, attackerId, target, chance)` (the roll at chance −20 with the brace penalty, noise 1, miss/hit events, the root). `world-phase.ts`: `archerPlan` prefers it over a plain shot, `SHOWN_FIRST` includes it (so it's always shown the round before), `honored` keeps it while the hero is in range and unrooted, `monsterAct` case `hamstring`.
- **Night thorn** (`nightthorn`, Shadowmancer, 1 mana): 2 Wits slots at range 5 in sight (the Dragon allowed), 1 per hit ignoring armor (+1 perfect), noise 0; `cast {spell:'nightthorn'}`. **Briar** (`briar`, Hedgewitch, 1 mana): 2 Wits slots at range 4 in sight (not the Dragon), 1 per hit, any hit roots 1 round, a perfect roll 2; noise 1; `cast {spell:'briar'}`. Both break a Veil (attacks).
- **Crates and barrels** (`smashProp`: any hero, adjacent `prop` tile with `prop: 'crate' | 'barrel'`, pick 'hex'): `Delve.smashed` (posKey), `kindAt` reads a smashed prop as floor (world.ts), noise 4, seeded drop 60% gold 3–12 / 20% torch, potion, firecracker or caltrops / 20% nothing, placed as ground loot; `propSmashed {at, by, items}`. Preview "Smash the crate: loud, may hold something".
- **data.ts**: a "V3.7 kit and free movement" block (CALM_STEPS, BRACE_*, SHIELD_*, HAMSTRING_*, NIGHTTHORN_*, BRIAR_*, SMASH_*); Brace / Hamstring / Night thorn / Briar lines in the class ability texts.
- **engine.ts**: `calm`, `follow` passed through, `updateCalm` after commands.
- **Tests**: `describe('V3.7 kit and calm')` (16 tests) at the end of engine.test.ts. Old tests that assumed the budgeted rules in a monster-free delve now call `alarm(s)` (a 99-round fuse far away keeps the party from being calm); the archer test roots Brann first (an unrooted hero within 3 gets hamstrung, spec 20.5); the determinism test's timeout is 45 s (every calm move of 4 now turns the castle).
- **Sim** (scripts/v3-engine-sim.ts, function-scoped): while calm the lantern bearer walks the whole way with `follow: true` (others only catch up when 3+ behind); a front-liner with 2+ enemies adjacent braces; the report prints free moves, steps walked while calm, castle turns on the way, walks stopped by combat, braces, heroes hamstrung.

## Shared files touched (small, function-scoped)

- delve.ts: `doMove` (rooted refusal, `calm` branch, `follow` param), `moveKind` (rooted), `springTrap` exported, `targetsFor`/`spec`/`doAct` new cases, `smashable`, LABELS/ROLLS/ORDER/PICK/MANA_COST/VEIL_BREAKERS entries, `canDo` (rooted blocks whole-turn actions), imports.
- common.ts: `guardMods`, `rangedLabel`, `rootFigure` (new, at the end), imports.
- ai.ts: `strikeDetailed` (brace/shield), `walk` (rooted rivals stay), `hamstringIntent`, `hamstringShot`, imports.
- world-phase.ts: archer hamstring (see above), rooted tick at the start, `calmSteps = 0` + `braced` cleared at the new round, rival `stuck` tick.
- stealth.ts: `heroSwings` full slots when braced. world.ts: `kindAt` smashed props. state.ts: `RivalX.stuck`. camp.ts: `buyShield`. engine.test.ts: `alarm` helper + the four old tests above.

## For the presentation agent

- `Engine.calm(state)` and `Delve.calm`/`calmSteps` are live after every command. "The castle turns in N steps": N = `CALM_STEPS − (calmSteps ?? 0)`.
- To offer any explored hex: `import { calmReach } from '../game/calm'` with a Ctx (`{ w: new World(castle), s, d: s.delve, ev: [] }`) — or ask the lead for `Engine.calmReach` (requested below). Its entries are plain `Reach` with `path`, `cost`, `risks`. Send the path as a normal `move` (with `follow: true` when the toggle is on). `reachable` stays the budgeted set.
- Events in a calm walk: `moved` per leg (per hero; followers get their own), `doorChanged`, `woke`/`awake`, `trap`, `levelChanged`, a `say` "The castle turns." then the usual world-phase events (`phase` world → player, `light`, intents...) every 4 steps, one `noise` per leg at the mover's hex, and at a stop either `calm {calm:false, why}` (combat: the party's flags are reset) or a `say` "X stops: …". A move that ends short of the clicked hex = a stop.
- `braced {id}`; `rooted {id, by, rounds}` (heroes: `HeroInDelve.rooted`; monsters: `stuck`; crew members: engine-private); `propSmashed {at, by, items}`; `cast` with spells `nightthorn`, `briar`; the hamstring is a `roll` "Hamstring" + `hit` (damage 0) or `miss`; monster intent `hamstring` (`targetId`, `to`).
- Preview texts: brace "Braced until your next turn: hits do 1 less, enemies roll −15% against you. Free swings at full slots." (+ " Shield: ranged hits 2 less."); hamstring modifiers "Aimed low −20%".

## For the crews agent

- `hamstringIntent(c, from, target)` and `hamstringShot(c, rivalId, target, chance)` in ai.ts are for your rival Rangers too (SHOWN_FIRST-style: show `hamstring` the round before, then shoot). Rooted members have `RivalX.stuck` (ticked in world-phase); `walk()` refuses to move them, but your planner still shows a `move` intent for them: a one-liner in `rivalStats` (`move: (r.stuck ?? 0) > 0 ? 0 : RIVAL_MOVE`) would make the intent honest. I didn't touch rivals.ts.
- `rivalCaltropsStep` is called per hex in calm walks too (it stops the walk).

## Contract requests

- `Engine.calmReach(state, heroId, sneak): Reach[]` (the UI imports it from calm.ts for now).
- `Rival.stuck?: number` (rooted crew members), if the UI should badge them.
- A `GameEvent` for a walk that stopped while still calm (e.g. `{ type: 'calm'; calm: true; why }` or `walkStopped {id, why}`) would be cleaner than a `say` line; I kept the contract's `calm:false` for combat only.

## Known issues

- A calm walk's castle turns happen per mover: four heroes walking separately turn the castle four times as often as one walking with `follow`. That's the rule as written ("travelling together costs what travelling alone does"); the UI should default `follow` on.
- Per-step `refreshSight` (the full visible set) only runs while a crew is unspotted or waiting; the per-step "new monster in sight" test uses `seesHex` per figure instead (cheap). Castle turns are the real cost (~70 ms each on the test castle with its spawns).
- Trap spotting rolls once per step on a calm walk (vs once per move before): more spotting on long walks, by design of "walked hex by hex".
- `hamstring` by a hero needs the target awake (sleepers are better attacked); the archer only hamstrings heroes within 3 of its shooting spot.

## Testing (hand-off)

- `npx tsc --noEmit`: clean in src/game and scripts (the one error is src/view/fixtures.ts missing the lead's new `Engine.blastPreview`: presentation's).
- `npx vitest run`: 265 tests, all green but one crews test in progress ("ranger: caltrops on the hex the nearest hero would charge through": their intent planner, not touched by me).
- Sim, test castle (`CASTLE=test`, 6 delves, seed 1): free moves 83 (31 with follow), steps walked while calm 291, castle turns on the way 60, walks stopped by combat 2, braces 2; L1 contracts done in 3–6 rounds; 0 refused commands.
- Sim, real castle (10 delves, seed 1): free moves 195 (73 with follow), steps walked while calm 892, castle turns on the way 199 (≈ one per 4.5 steps), walks stopped by combat 38, braces 4, heroes hamstrung by archers 3; 9/10 done (the slay delve lost), 0 refused commands. Rounds per delve read higher than V3.6 because every castle turn on a walk is a round; the lantern burns the same per turn, so a party that walks apart (the bot's catch-up walks) burns it faster than one that follows.
