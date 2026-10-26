# V3.8 presentation progress (exploration mode, spec 22.8)

## Done

- **Clock** (src/ui/app.ts): `tick` every 750/500/300 ms by the speed setting (½× / 1× / faster and instant) while exploring; stops while paused, a modal is open (confirm, parley, menu, roll preview), a command is playing, the tab is hidden, or in combat. Quiet ticks (steps, door, noise < 4, light, say, investigate, walkStopped) update in place without the busy flag; anything else goes through the normal event player. Saves every 10 quiet ticks (and on doors / stops / any command).
- **Space** pauses in explore (hold-to-hurry stays in combat). Mode label top centre (`.hud-mode`, `data-mode`): "Exploring" + Space hint / Paused badge, "Combat · round N". Paused overlay (`.hud-paused`). Clicking the label toggles pause.
- **Selection**: click or 1–4 selects; Shift-click / Shift+1–4 / Shift-click a card toggles into the selection; left-drag box (diorama `boxSelect` hook, `.select-box`). Extra selection rings in the diorama. Click a hex: each hero gets `explorePath` to the hex nearest target + offset from the leader (12 candidates, unclaimed); a hero with no path stays. Right-click / Esc stops (`stopWalk`) when nothing else is open. S toggles the selection's stance (`sneak`); sneaking heroes crouch (UnitView.crouch).
- **Hover** in explore: the leader's explore path and its risks (wake/notice rings), tooltip "Walk N hexes · noise · about Ns · K more follow in formation".
- **Smooth motion**: `Diorama.glideNext(sec)` makes the next sync slide each moved figure over its own step interval: walking heroes 1 tick, sneaking or heavy heroes 2, monsters (patrols, investigators) and unhired crews 4, hired crews 1; rubble doubles. No walk-pause-walk. Vision cones cross-fade old → new over the longest monster slide in flight, so they turn and move with the figure. The camera follows the selected hero while they walk.
- **Vision cones** (`Diorama.showVision`): from `Engine.vision`, enemies seen and within 10 of a selected hero; walk-only hexes red, sneak hexes darker red. Awareness tags: z, → patrol, ? alert/investigating, ! hunting. Red edge glow (`.hud-vignette.in-cone`) when a selected hero stands in a cone for their stance.
- **Mode switches**: `mode` events → banner "Combat!" + why (enemies first, with the camera panning to `by`), "Ambush!" (party first), "The castle quiets"; `walkStopped`, `investigate` logged.
- **Bar**: explore shows the who line with a stance toggle and the walk order, a "Here" group (stairs/lift, Leave), Lantern, Interact/Abilities/Items; no Move group, no End turn. Combat as V3.7. Bar, cards and top bar only rebuild when their content changes (`Hud.swap`), so buttons stay clickable under ticks. Cards in explore show Walk/Sneak and the hexes left.
- **Removed** V3.7 free move: Follow toggle, steps counter, calmReach/calm usage, `stepsToTurn`, calm CSS, MOVE_HELP.calm/follow (now MOVE_HELP.explore/stance).
- **Fixtures** (src/view/fixtures.ts): delve starts exploring (rats asleep, an investigating orc, a patrol on its route); `mode`, `explorePath`, `vision` (21.5 ranges, blind arc, simple sight lines); walk/stopWalk/sneak/tick (hero pace, patrols every 4, rounds every 8, lantern by distance, notice → enemies-first combat with a world phase); hostile acts → Ambush; end turn with nothing hunting → explore.
- Lantern panel in explore: "burns 1 per 4 hexes walked", "N hexes to Dim". Mode banners rely on the engine's own `say` for the log line (no duplicates).
- Fixtures: `fixtureDelve(castle)` stays the V3.7 combat scene (mode combat, rats hunting) for the older checks; `fixtureDelve(castle, true)` / startDelve give the exploring one.
- **Checks**: scripts/v38-ui-check.mjs 39/39 on `?fixture=1` and the real engine (mode label, pause + overlay, menu stops the clock, no HUD rebuilds on idle ticks, 1 + Shift+2, hover path, walk orders for both, figures mid-slide, a patrol sliding its whole 4-tick step, Esc, S + crouch, cones, → / ! icons, edge glow, forced notice → "Combat!" + combat bar + no ticks, → "The castle quiets"). Older checks keep their delves in turns via scripts/v38-ui-turns.mjs (`inTurns(page)`); v37 free-move section replaced; v33 patrol icon now →; v35 hire line allows the quiet line. Results: v34-hud, v34-camp, v35 (both), v36 (both), v37 (both), v371 pass; v33 2 fails and v32-clarity not starting (no "Tavern" station) are confirmed pre-existing: identical on main (adbff82) run from a scratch worktree (removed afterwards). Stress bot (explore: walk/sneak/act/stopWalk/ticks; combat as before): 0 errors. Typecheck clean; vitest 293/293.
- Screenshot: docs/agents/v38-shots/v38-cones-patrol.png (scripts/v38-ui-shot.mjs).

## Known issues

- Headless swiftshader renders ~1 frame/s; the check steps the glide itself, and screenshots need a long timeout.
- A figure lags its engine hex by up to one step (a patrol up to 4 ticks); a non-quiet tick mid-slide snaps it into the playback animation.
- Edge glow mostly flashes: the engine notices at the end of the same tick.
- Any src edit reloads the dev server (HMR), killing a running check; run checks with src untouched.

## Contract requests

- None.
