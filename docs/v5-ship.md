# Shipping V5.0: the sequence

The owner wants V5.0 playable for feedback. Two tracks (G graphics, P play) land on `v5.0`; one independent reviewer checks the combined result; then `v5.0` goes to `main` and GitHub Pages. This file is the checklist both leads and the reviewer work from. Append under "Log" as steps complete.

## What ships

- Everything on `v5.0` at the ship commit: G's W0–W5 (the look) and P's spec 32.x (the owner's play-test fixes, the flow, controls, the shield block, the return tally, status HUD, the balance pass, the bot as an instrument).
- Saves: the key stays `vc.save.v39` (no bump through V5.0); a V4.1 save loads in V5.0. If anything on `v5.0` would break an old save, bump the key and add a migration before step 5.
- `main` 3303949 stays the revert target (the proxy refuses tags; the hash is in `claude/game-state.md`).

## Steps and owners

1. **G: W4/W5 checkpoint** (owner approved 2026-10-28). Merge `origin/v5.0` into `v5.0-gfx`, run the gate, merge into `v5.0`, status board line. Then pass the `unlit` flag to `heroTag` (P's View needs, 2026-10-28) once P's tags are in `v5.0`.
2. **P: wrap and checkpoint.** Finish the balance pass at a state the owner approves; merge `origin/v5.0` (G's W4/W5) into `v5.0-play`; add the three look menu rows (Quality High/Low → `dio.setQuality`, Action camera → `dio.setActionCamera`, Tilt-shift → `dio.setTiltShift`; settings `quality`, `actionCamera`, `tiltShift` already exist and the view reads them at start) and retire "Lower walls near the camera" (the cutaway is always on now); run the gate; merge into `v5.0`; status board line.
3. **Docs match the code** (P for rules, G for the look): `docs/current-rules.md` reflects spec 32; `docs/v3-changes.md` has the V5.0 play and look entries (both written); `claude/game-state.md` says what shipped; `docs/v5-plan.md` status board closes with the ship line.
4. **Independent review** (a third session, brief below) on `v5.0`. It files findings as a list in `docs/v5-review.md`; the lead that owns each finding fixes it on its track branch and re-merges; the reviewer re-checks. Two rounds at most before the owner decides.
5. **Owner plays `v5.0` locally** (`npm ci && npm run dev`): one full delve on each level, High and Low quality, and reports framerate feel and anything that reads wrong. This is the one check no session can run (SwiftShader stills only).
6. **Ship.** G (or whoever the owner names) merges `v5.0` into `main` with a merge commit "V5.0: The Heir's Return, the look and the flow", pushes, confirms the deploy with `gh run list`, and the owner opens the live site. `claude/game-state.md` gets the new main hash and revert target.

## The gate (every merge into `v5.0`, and before step 6)

- `npx tsc --noEmit`, `npx vitest run` (595 on `v5.0`), `npm run build`.
- `npx vite preview --port 4185 --strictPort`, then `node scripts/v40-hud-check.mjs http://localhost:4185/` and `node scripts/v40-lowgate-check.mjs http://localhost:4185/` (both on Low quality), 0 page errors.
- G's look shots when the view changed: `QUALITY=high node scripts/v50-look-shots.mjs http://localhost:4185/ <dir> hall,chapel,barracks,bones` and `lineup`, `status`, `dragon`.
- P's sim when rules changed: `scripts/v3-engine-sim.ts` on the L2 scenario, no refused commands.
- Kill the preview server by PID, never `pkill -f`.

## The reviewer's brief (session three)

Read CLAUDE.md, docs/v5-plan.md, docs/v5-ship.md (this file), docs/v5-graphics-plan.md, docs/v5-play-plan.md, docs/v5-status-visuals.md, and the V5.0 entries in docs/decisions.md and docs/v3-changes.md. Clone the repo, check out `v5.0`, `source scripts/npmenv.sh && npm ci`, run the gate. Attach the repo with push access only if you will commit; the review itself changes no code. Work alone (no helper agents; the owner's rate limit is shared with two other sessions).

You are reviewing the combined output of two sessions that did not see each other's work. Look for what neither could: seams. In order:

1. **The merge itself.** `git log --merges v5.0` and `git diff main..v5.0 --stat`. Any file touched by both tracks (`src/ui/settings.ts`, `src/ui/app.ts`, `docs/v5-plan.md`, `docs/decisions.md`, `src/ui/tags.ts`, `src/style.css`): read the merged result, not the diffs, and confirm both sides survived (settings DEFAULTS has every key; app.ts keeps P's follow and G's one marked line).
2. **Rules vs view.** Every event in `src/game/types.ts` GameEvent that the diorama animates (grep `case '` in `src/view/diorama.ts`): the new ones (`blocked`) are handled; the rig's clips fire on the events P's spec 32 changed (jump is the move, the shield block, the Ranger's shot). Status visuals (`src/view/look/status.ts`) read the same state fields the HUD side reads (`src/ui/tags.ts`, `src/ui/hud.ts`): a state the HUD marks and the figure doesn't, or the reverse, is a finding.
3. **A play-through by script.** Extend or copy `scripts/v40-hud-check.mjs` into `scripts/v50-review-check.mjs`: a first delve on the real engine, Level 1 to the stairs, one fight, one torch lit, one reaction card answered, the return tally; then a Level 3 delve with a hero unlit and the Gloam about. Assert by DOM and state (the owner's testing-cost rule); take screenshots only where the look is the question (the status scene, the action cam mid-push via `renderNow()` during a hit). Run on Low; one High pass for the shots. 0 page errors is the bar.
4. **Saves.** A V4.1 save (make one on `main` with the same script) loads on `v5.0` and plays a turn. A `v5.0` save survives a reload mid-reaction. If either fails, the fix is a migration under the existing key or a key bump (`vc.save.v39` → v50) with a migration; say which.
5. **Performance budget.** Count draw calls and triangles at the default camera in the Great Hall and the lair (`renderer.info` via `window.vc.dio.renderer.info` after `renderNow()`), High and Low. Report the numbers; flag anything over ~800 draw calls or ~1.5M triangles.
6. **Docs.** `docs/current-rules.md` vs the engine for the spec 32 rules; the changelog's claims vs the code (every sentence in the two V5.0 entries should be true); `claude/game-state.md` matches the branches.
7. **Fresh eyes.** Play the first three turns as a new player would (the coach marks on): what is unclear, what the new look hides (markers under the blur? a wall cut that reveals a room not yet explored?), what the HUD and the figure say differently.

Write `docs/v5-review.md`: findings ranked by severity, each with the file, a reproduction and who owns it (G: `src/view/**`; P: `src/game/**`, `src/ui/**`, docs on rules), then the numbers from 5, then what you did not check. Commit it to `v5.0` (docs only) and push. Final reply: the top five findings and whether you would ship.

## Log

- 2026-10-28 · Plan written (G). W4/W5 awaiting the checkpoint merge; P at spec 32.14 on `v5.0-play`.
