# Shelved: free exploration outside combat (V3.7 free move, V3.8 exploration mode)

**Status:** shelved 2026-10-25 by the owner after play-testing V3.8. The game is entirely turn-based again (V3.7.2). The owner wants to come back to this idea and experiment with it.

## Where the code is

| What | Where | State |
| --- | --- | --- |
| **V3.8 exploration mode** (BG3-style: free independent movement on a half-second tick, combat when noticed) | branch `shelf/exploration-mode` (= `v3.8`, commit 3e786cc) | Complete and tested at the time (293 tests, all DOM checks). Was live on `main` as bb714cf, reverted by ebb81d9 |
| Rules | `docs/v3-spec.md` section 22 on that branch | Exact numbers and triggers |
| Engine notes ("what the UI can rely on", rules calls) | `docs/agents/v38-engine-progress.md` on that branch | Best single summary of the engine |
| UI notes | `docs/agents/v38-presentation-progress.md` on that branch | Clock, selection, slides, cones |
| Owner's answers | https://claude.ai/artifact/Dw2vU6Hixgak3UeBYd8w8T | Plan and Q&A |
| **V3.7 free move** (calm walk: long paths, the castle turning every 4 steps, Follow) | still on `main` in `src/game/calm.ts`, switched off by `FREE_MOVE.enabled = false` in `src/game/data.ts` | Its tests run with the flag on (engine.test.ts "V3.7 kit and calm") |

## What we built, in order

1. **V3.7 free move** (spec 20.5): while nothing hunts you, click any explored hex and walk there; the castle took a full turn every 4 steps; Follow brought the party along in single file; the walk stopped when anything noticed, woke or appeared.
   - Owner's verdict: the castle's turns interrupted the flow; following by default was unwanted; the awareness notifications were clunky.
2. **V3.8 exploration mode** (spec 22): two modes. *Explore*: each hero moves independently (select one or several, click to walk; per-hero sneak stance), the world advances in half-second ticks the UI sends (Space pauses): walk 2 hexes/s, sneak 1, patrols 1 hex/2 s; noise sends monsters to investigate; lantern burns 1 per 4 hexes the bearer walks. *Combat*: turn-based, party-wide. Noticed → enemies act first; a hostile act → ambush (the unaware skip their first world phase). Back to explore when nothing hunts or searches. Vision cones and awareness icons (z → ? !) showed noticing.
   - Owner's verdict: "definitely an improvement over what came before, but not quite right"; more complicated than expected; vision cones read as visual clutter.

## What we learned

- **Determinism holds.** Making the clock a `tick` command kept the engine pure and replayable; tests and the bot drive ticks directly. Keep this if the idea returns.
- **Two time models in one game is the real cost.** Every round-based rule (Veil, Ward, fuses, rival entry, searches, bleeding, the lantern) needed an explore equivalent; each needed a call (round = 8 ticks; lantern by distance; no bleeding while exploring). Expect this tax on every future mechanic.
- **Being noticed ends exploring instantly**, so the "you're in a cone" warning only ever flashed. A noticing grace (suspicion building over a second or two) would make cones or warnings meaningful; without it, prefer none.
- **Patrol animation vs engine position:** sliding over the full 4-tick step made figures trail the rules by up to a step. Any return should decide whether the view or the engine leads.
- **Stairs:** walk orders had to be allowed onto the far end of a reached stair, since the next level is unexplored until you arrive.
- **Ambush feels right; enemies-first on notice felt harsh** with free swings and crews (not confirmed by the owner either way).
- **Cones are clutter** (owner). If notice needs showing, consider only the enemy's icon state and a one-line warning on the selected hero, or a cone shown only while hovering an enemy.
- Effort: V3.8 was ~2,700 lines changed across 23 files (engine: `src/game/explore.ts` new, `calm.ts` removed; view: continuous slides, selection box, cones).

## How to pick it up again

1. `git fetch origin && git checkout -b explore-v2 origin/main && git merge origin/shelf/exploration-mode` (expect conflicts in `src/game/data.ts`, `rivals.ts`, `world-phase.ts`, `engine.test.ts`, `src/ui/hud.ts`, `app.ts`: main has moved on). Or cherry-pick `src/game/explore.ts` and the tick plumbing into a fresh design.
2. Re-read spec 22 and the two v38 progress notes on the shelf branch first.
3. Decide up front: noticing grace or not; whether cones exist; how round-based rules map to time; who leads animation.
4. Bump the save key.
