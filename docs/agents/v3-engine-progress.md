# V3 engine progress

## Done (all brief deliverables)
- src/game/test/testCastle.ts: two-level test castle (`testCastle`, plus `at(level,col,row)` and `asciiLevel` helpers). Has 1 recover + 2 rescue sites (one rescue on L1).
- Modules in src/game: rng.ts, data.ts (all spec numbers), state.ts (engine-private extra fields stored in the state JSON), world.ts (tiles, LOS, light, sight, Dijkstra paths, noise field), common.ts (rolls, damage, noise, loot, lantern hand-off), camp.ts (new game, board, recruits, shop, smithy, infirmary, startDelve, summary, backToCamp), delve.ts (move, action targets, preview specs, effects, leave/abandon), world-phase.ts (light burn, bleed, monsters + intents, rivals, Gloam, charges), engine.ts (`createEngine`), index.ts (`engine` on the real castle from src/data/castle).
- src/game/engine.test.ts: 48 tests (rolls/Focus, movement/stairs/doors, light/Gloam, noise through doors, pick/smash, chests, combat/armor, downed/bleed/revive, guard, shove into pit, intents, orc shout, spider web, cutpurse, recover/rescue contracts, abandon/Hobart death, lost gear, determinism, no input mutation, serialize).
- scripts/v3-engine-sim.ts: bot plays N delves. `npx tsx scripts/v3-engine-sim.ts 20` (env: SEED, CASTLE=test, VERBOSE=1, EVENTS=1, TRACE=<delve#>).

## Design calls made (spec was silent)
- `open` on a door is free; `open` on a chest uses the action. `take`, `drop`, `give`, `leave` are free.
- Named spawns (elites) get +2 HP.
- A monster follows its shown intent if the destination is still free and reachable and the target still in reach; else it re-plans.
- Hunting monsters that lose sight go alert and search focusAt (berserkers stay hunting).
- Neutral sisters turn hostile after 2 rounds stuck on a path while spotted (spec: "blocks their only path for a full round").
- A dead hero's pack drops on the ground; non-heirloom items from fallen heroes become `lostGear`.
- Board: at least one Level 1 contract; contract ids `k<delveCount>-<i>`.

## Contract requests
(none)

## Known issues / for the lead
- Balance: on the real castle the careless sim bot completes ~100% of contracts with 0 deaths over 20 delves (avg ~15 rounds, light ~47 left). Monsters do engage (~28 hero hits per 20 delves) but the castle is gentle. Levers: more/awake spawns near sites, berserker placement, monster chance/dmg in src/game/data.ts.
- Monsters only take stairs while hunting (they plan with stairs only when hunting).
