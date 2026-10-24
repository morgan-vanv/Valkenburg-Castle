# Brief: V3 rules engine

Read docs/agents/v3-common.md first.

You own src/game/** except types.ts, api.ts and hex.ts. Implement the `Engine` interface in src/game/api.ts per docs/v3-spec.md.

## Deliverables, in this order

1. **src/game/test/testCastle.ts** (first, within your first few minutes): a small hand-made `CastleDef` with two levels: a few rooms, a locked door, a chest or two, a pit with landing, stairs, two exits, 3 to 4 sleeping monsters, one rescue and one recover site, a trap and a brazier. The presentation agent uses it until the real castle exists, so export `testCastle` and keep it valid. Write a tiny ASCII helper if you like, but the map agent owns the real authoring format.
2. **src/game/engine.ts**: `createEngine(castle: CastleDef): Engine`. Split rules into modules as you see fit (rng, rolls, camp, delve setup, movement, sight/light, noise, combat, monsters, rivals, contracts, summary).
3. **src/game/index.ts**: export `engine`. Use the real castle when it exists: `import { castle } from '../data/castle'` (the map agent exports `castle: CastleDef` from src/data/castle/index.ts). Until that file exists, use testCastle; switch when it appears (check now and then).
4. **Tests** (vitest, src/game/*.test.ts): slot rolls and Focus, movement costs and blocking, stairs, light stages and the Gloam, noise waking monsters through doors, pick/smash outcomes, combat damage and armor, downed/bleed/revive, monster intents honored, cutpurse steal, contract completion, summary applied to the campaign, determinism (same seed + commands = same state), serialize round-trip.
5. **scripts/v3-engine-sim.ts**: a simple bot that plays N full delves through the public API on the real castle (or testCastle) and prints per-delve: contract, rounds, light left, loot value, bounty, deaths. Runnable with `npx tsx scripts/v3-engine-sim.ts 20`. The lead uses it to balance.

## Notes

- Pure functions only, no DOM. Clone state (structuredClone) at the top of `apply`, mutate the clone, return it. Refused commands return the original state plus `error`.
- RNG: `state.rng` is the mulberry32 state number. Write a helper that draws a value and advances `state.rng` (see src/rng.ts for the algorithm).
- Ids: heroes keep their roster id; monsters `m1`, `m2`…; rivals `r1`…; prisoner `p1`; items `i<n>` from a counter you keep in state or derive deterministically.
- `reachable`: BFS with costs; doors in the path open automatically (unlocked only). Include stairs transitions in paths.
- `actions`: return only actions valid right now, with their targets, so the UI can build buttons straight from it.
- `preview`: return outcomes text per number of hits, short and plain ("2 dmg", "Opens, noise 2").
- Intents must be computed at the end of each world phase and at delve start, and the monster should do what its intent said when still possible: the player plans around them.
- Emit events in the order things happen, so the view can animate them one by one. Every roll emits `roll`.
- Keep messages (`say` events, summary notes) short and a little dry in tone.
