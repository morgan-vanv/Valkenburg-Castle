# Brief: V3.2 engine (rules, data, contract)

Read docs/agents/v3-common.md (own paths only, don't commit, progress note at docs/agents/v32-engine-progress.md, `bash scripts/snapshot-wip.sh` every 10-15 minutes; the account is near its usage limit, so save often). Branch `v3.2`. Read docs/agents/v31-engine-progress.md for the engine's layout.

You own src/game/** (including types.ts and api.ts this time) and src/data/**. Implement docs/v3-spec.md section 15.1 to 15.4.

1. **Contract first (within your first 10 minutes):** update types.ts/api.ts for section 15 (new HeroClass values, item kinds, action kinds for overwatch, knockback shot, throw/use item, dig, fireball, veil, sleep, blink, ward, gust, grapple; delve state for smoke, glue, caltrops, burning hexes, veil/ward/overwatch/dash; ShopOffer kinds). Add `reachable` support for the dash (a hero who has moved and not acted gets their dash range) and say how the UI tells walk from dash. Write the contract changes into your progress note at once: the presentation agent builds against them.
2. **Rules** for 15.1 (permissive LOS, walls next to seen floor), 15.2 (dash), 15.3 (Hobart alone + 160 gold, tavern of 4 across classes, the eight classes with their abilities and spells), 15.4 (the eight new shop items). Keep it elegant: reuse the shove outcomes for knockback shot and gust, the fall rules, the noise system, sleep = monster awareness 'asleep'.
3. **Tests** for each new class ability, spell and item, dash, and the LOS fix (a test that reproduces patchy reveal next to walls/pillars and now passes). Existing tests keep passing (update ones the rules change, e.g. the starting roster).
4. **Sim:** the bot recruits a squad at the start (2 to 3 heroes) and still plays delves; report done rate and deaths so the lead can check a new squad can finish a Level 1 contract.

Finish with a short report: what works, rules you decided, contract summary, how to run tests and the sim.
