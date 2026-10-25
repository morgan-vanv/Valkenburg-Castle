# Brief: V3.3 engine

Read docs/agents/v3-common.md (incl. testing-cost rules), docs/agents/v32-engine-progress.md (engine layout), then docs/v3-spec.md section 16 and the contract diff (`git diff main -- src/game/types.ts src/game/api.ts`). You own src/game/** (types/api already changed by the lead; add small things if you must and record them in docs/agents/v33-engine-progress.md). Branch `v3.3`.

Implement 16.1–16.5:
1. Awareness: default awake, 'patrol' awareness walking `route`, noticing (lit or within 3; Hollow ignores light), giving up after 3 rounds (`searchRounds`) and returning to route/post, `knownRoutes` + `routeKnown` event when a hero sees a patroller move.
2. Light: LIGHT_MAX 20 and stages, `shutter` free action and `lanternOpen` (no burn, no light when shuttered), per-hero `sightRange(state, heroId)` and `heroLit`, glimpse and visibility per hero, oil +8, brazier +4, Kindle +6. Update the test castle for the new numbers.
3. The Gloam in the Hollow exactly as 16.2 (rises when any hero on L3 is unlit, never enters lit hexes, fades after 2 calm phases, no grace).
4. Tiers at spawn (16.3). New kinds archer, captain, ghoul with their abilities and intents; spider web-then-drag; `escape` action; buried ghouls rising (`spawned` event).
5. Rival kit (16.5): `Rival.cls`, intents and actions using the hero rules (overwatch shot, knockback shot, veil, smoke bomb, sleep dart, looting opened chests).
6. Tests for each of the above; keep the suite green. Sim: the bot shutters on L1 when daylight is near, opens on L2/L3, carries oil for L3; print per level: contracts done, deaths, rounds in darkness on L3, Gloam strikes. The lead wants L1 easy, L2 real resistance, L3 deadly without light.

Report: what works, rules you decided, how to run tests and the sim.
