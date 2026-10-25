# V3.7 stealth and free swings: progress (engine agent "stealth")

Spec 20.1 and 20.2. Append-only sections; the sapper and presentation agents read this to avoid collisions.

## Done

- **New module `src/game/stealth.ts`** (mine alone): facing (`dirIndex`, `faceToward`, blind arc), `wouldNotice`, `perceivable`, `noticeHero`/`forgetHeroes`/`hasNoticed` (`MonsterX.noticedIds`), per-hex `stepNoise`, `wakeChance`/`wakeRolls`, free swings both ways (`swingersFor`, `provokeSwings`, `heroSwings`), Dread's `fleePlan`, and `moveRisks` for `Reach.risks`.
- **data.ts**: a "V3.7 stealth and swings" block (STEP_NOISE, WAKE_*, NOTICE, SNEAK_ATTACK_SLOTS, SWING_*, DREAD_*) placed before the Sisters' kit; Dread added to the Shadowmancer's abilities text.
- **state.ts**: `MonsterX.noticedIds?: string[]`, `HeroX.sneaked?: boolean`.
- **common.ts**: `makeNoise` takes `quiet` (no event) and turns heads; `goHunting`/`goAlert` face the hex; `hurtAny` makes the hit monster notice its attacker; `wakeAdjacent(c, at, sneak, by)` is now only for non-walk arrivals (falls, blink, climb, grapple: sure when loud, 25% when quiet); new `loseQuarry`.
- **ai.ts**: `walk()` faces the way it stepped and gives heroes their free swing per step (stops the walk when the swing kills); `strikeDetailed` (strike with hits and damage).
- **world-phase.ts**: `chooseTarget`/`perceive` use `perceivable` (noticed heroes by plain sight, others by the 20.1 rule); `perceive` records notices and `loseQuarry` forgets; shout makes rallied orcs notice; feared monsters plan and run (`flee` intent); `feared` ticks down with `stuck` (rivals too); attacks face the target. I did not touch the sapper's fuse call.
- **delve.ts** (my functions only: `reachable`, `doMove`, `afterHeroMove`, `riseGhouls`, `targetsFor` dread case, LABELS/ROLLS/ORDER/PICK/MANA_COST dread entries, `foe`, new `unnoticedBy`, `spec` attack/dread/jump, `putToSleep`, `smokeOut`, veil, `doAct` dread/jump, `wakeTarget`): per-hex noise and wake rolls in `doMove`, one `noise` event per move, swings on leaving, `sneaked` tracking, sneak attack +1 slot, Dread, `Reach.risks`.
- **rivals.ts** (small hooks): `crewNotice` uses `wouldNotice` (light, sneaking, facing; still capped at 6); hostile members face their target; feared members flee (`fleeAct`, `planRival`).
- **camp.ts** `spawnMonster`: `facing` from the spawn (cast; see contract requests), default 0.
- **test castle**: the rats face 0, the spider 3.
- Tests: `describe('V3.7 stealth and swings')` at the end of engine.test.ts (18 tests); old tests updated: sneak-attack slots in three previews, the end-adjacent wake test; the `monster()` helper gives hunting monsters `noticedIds` of the whole party and no facing.

## Decisions worth knowing

- `facing === undefined` means "watches all round" (no blind arc): crew members at their post and hand-placed test monsters. Spawned monsters always get a facing (default 0 = east, DIRS index). Facing updates on move (last step), on noise heard, on noticing, on being hit, on striking.
- Blind arc geometry: `dirIndex(from, to)` = the DIRS index with the largest dot product against the from→to vector (ties to the lower index); the arc is the back direction ±1. The hex directly behind = `at + DIRS[(facing+3)%6]`.
- "Sneaking in the blind arc": noticed only when adjacent, and never from the hex directly behind. Walking in the blind arc: half range (lit 3, unlit 1, Hollow 3).
- `HeroX.sneaked` is the hero's last move mode and persists until the next move (a hero who never moved counts as walking). So sneaking up and then standing still stays quiet.
- A monster "has noticed" a hero (no sneak attack, free swings) via `noticedIds`: filled by perceive, by being hit/missed/shoved/knocked by them, by a captain's shout, by a ghoul rising; cleared when it loses its quarry (hunting → alert), is smoked, loses its target to a veil, or is put to sleep. Crew members: hostile or demanding = noticed everyone (no per-member list yet).
- Free swings by heroes: only at monsters (not the Gloam) and hostile crew members, never at neutral/hired crews walking past.
- `Reach.risks.notice` lists only enemies that have NOT yet noticed the hero (new aggro); `wake` has one entry per (hex, sleeper) with the chance (100 where walking noise reaches it); `swings` once per enemy with `hitRange` damage.

## Contract requests

- `SpawnDef.facing?: number` (0..5): the map's facing for sleepers. Worked around with a cast in `spawnMonster` and the test castle; the real castle data can add `facing` once the type has it.
- `Rival.noticedIds` is not in the contract; crews use stance instead (good enough for 20.4's rework to decide).

## Known issues / notes

- The `noticed` event for crews fires per member when the waiting crew spots a hero (from `crewNotice`).
- Dread on a neutral or hired crew member makes the crew hostile (like attacking them).

## Testing (hand-off)

- `npx tsc --noEmit`: clean for the whole repo at hand-off (I added `captives: []` to `newGame` in camp.ts so the lead's contract change compiles; the lead's 20.4 work owns it from here).
- `npx vitest run`: 224 tests green (engine.test.ts incl. 18 new V3.7 stealth tests; the sapper's charges.test.ts; castle.test).
- Sim (`npx tsx scripts/v3-engine-sim.ts 30`, real castle, bot sneaks within 4 of a sleeper): 819 walked / 13 sneaked moves; sleepers woken by passers-by 17; heroes noticed 358; free swings 49; refused commands 0. 12 delves on the test castle: woken 6, noticed 147, swings 19, no refusals.
- `reachable()` with risks: ~4 ms per hero on the real castle (90 calls in 350 ms), sneaking ~0.5 ms.

## For the presentation agent

- Events: `noticed {by, hero}`, `woke {id, by}`, `swing {by, target, hits, damage}` (by a monster/crew id or a hero id; the `roll` event before it is labelled "Free swing"), `feared {id, by}`, `cast {spell: 'dread'}`. Intent `flee` on feared monsters and crew members (shown the round before). One `noise` event per hero move, at the destination.
- `Monster.facing` / `Rival.facing`: DIRS index; undefined = watching all round (draw no blind arc). Blind arc = back direction ±1 at any distance; the hex directly behind is the safe one for a sneaking hero.
- `Reach.risks`: `wake` entries per (hex, sleeper) with chance (100 = walking noise reaches it); `notice` lists enemies that would newly notice the hero at the destination; `swings` once per enemy with `[min, max]` damage.
- The jump preview's `warning` names free swings ("Orc gets a free swing: 0–2").
