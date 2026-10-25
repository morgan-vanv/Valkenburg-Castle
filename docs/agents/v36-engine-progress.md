# V3.6 engine progress

Status: spec 19.1–19.4 implemented and tested. `npx tsc --noEmit` clean; `npx vitest run` green (191: castle 25, engine 166 incl. a "V3.6" block of 9).

## Done
- **19.1 story sites** (src/data/castle/index.ts, `story` set): `l1-story-chapel` L1 (40,24) south aisle of the Chapel; `l1-story-kitchens` L1 (9,14) between the kitchen work tables; `l2-story-forge` L2 (38,26) by the forge fire (the forge has no door in data, so Gerda simply stands inside the room; the regular copper path never depended on it); `l2-story-barracks` L2 (28,3) among the sleeping squad. The cask book keeps `l3-recover-drain` (a regular site, as the spec says). STORIES (src/game/data.ts) point at the new ids with one-sentence briefs. `makeBoard` (camp.ts) skips `story` sites for regular and slay picks. LOCKED refusal texts name the new rooms (chapel / kitchens / forge / barracks). castle.test: one site per story in the named room, on floor, no stacking with spawns/chests/coins/traps/sites, ≥3 from the room's regular site, reachable on foot past unlocked doors only, STORIES ids resolve, the Drain stays regular.
- **19.2 lockpicks**: SHOP `lockpicks` 25, `needs: 'smith'`, 1 slot, never consumed. Pick targets for non-Burglars only with lockpicks; spec 2 Finesse slots with modifier "Lockpicks: 2 slots", outcomes jam / open noise 2 / open silent; doAct generalised on `sp.slots` (Burglar unchanged at 3). Without picks a non-Burglar next to a locked door/chest gets a blocked `pick` option: "Locked · Smash it, or a Burglar or lockpicks could pick it." (`NO_PICK` exported from delve.ts).
- **19.3 night-eye**: SHOP `nightsight` 30, always sold. Action `nightsight` (pick 'self', uses the action, noise 0): `nightEyes = NIGHTSIGHT_ROUNDS (8)`, counts down in the world phase's new-round step with a "night-eye fades" line at 0. `sightRangeAt` returns `nightSightRange(level)` (8/7/6) when an active night-eyed hero stands on the hex, whatever the light. `lightPenaltyFor(w, c, h, lit)` in common.ts gives 0 to a night-eyed hero; used by spec() (all rolls, with the modifier "Night-eye: no dark penalty"), spot-trap and overwatch. `litSet`, `heroLit`, monster noticing and the Gloam are untouched (tests: Gloam still strikes; orc 5 away on L1 still doesn't notice).
- **19.4 movement**: `blocksHero` lets heroes pass hired crew members (stance `hired`); any other crew still blocks; nobody can be ended on.
- Sim (scripts/v3-engine-sim.ts): buys lockpicks once the smith is home (gold ≥ 60) and hands them to a non-Burglar; the bot already prefers `pick` over `smash` and skips blocked options.

## How tested
- `npx tsc --noEmit`, `npx vitest run`.
- Scratch check on the real castle: 200 boards across reputations/village states, zero regular contracts on story sites; the surgeon story delve places Aldric on `l1-story-chapel` in the Chapel.
- `npx tsx scripts/v3-engine-sim.ts` (20 delves, seed 1): no engine errors.

## Known issues
- None known in the engine. The night-eye badge, item names and the `nightsight` action label are presentation's.

## Contract requests
- None.

## Notes for presentation
- src/ui/names.ts `STORY[*].where` (used by `storyFix`) should now read: surgeon "Level 1, the chapel"; innkeeper "Level 1, the kitchens"; smith "Level 2, the forge"; copper "Level 2, the barracks". The engine's own LOCKED texts already say so.
- `ActionOption.blocked` on `pick` now appears for non-Burglars next to a locked thing (targets list the locked hexes).
