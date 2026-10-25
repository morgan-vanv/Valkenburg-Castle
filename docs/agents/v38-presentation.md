# Brief: V3.8 exploration mode (presentation)

Read docs/agents/v38-common.md, then docs/v3-spec.md section 22 in full (22.8 is yours). Remove the V3.7 free-move UI (steps counter, Follow toggle, calmReach usage).

1. **The clock:** while `Engine.mode` is explore and not paused, send `tick` every 500 ms (speed setting: slow 750, normal 500, fast/instant 300); stop while any modal is open, while a command is in flight, and in combat. Space toggles pause in explore; a Paused overlay. Mode label top-centre ("Exploring" / "Combat · round N").
2. **Selection and walking:** click a hero or 1–4 selects; Shift-click and drag-box multi-select; click a hex walks the selection (`explorePath` per hero to the hex nearest the target keeping its offset from the leader); right-click/Esc stops (`stopWalk`). S toggles the selection's stance (`sneak`), crouched pose while sneaking. Hover shows the path and risks.
3. **Smooth motion:** heroes, patrols and investigators interpolate between ticks over the tick interval; no camera jumps per tick (follow the selected hero gently).
4. **Vision cones** from `Engine.vision` for enemies within 10 of a selected hero: walk hexes red tint, sneak hexes darker; blind arcs clear. Awareness icons: z asleep, → patrolling, ? investigating, ! hunting. Red edge glow when a selected hero stands in a cone for their stance.
5. **Mode switches:** banners "Combat! <who> saw <hero>" (enemies first) / "Ambush!" (party first) with a camera pan to the trigger; "The castle quiets" on the way back; then the right bar: explore shows actions only (no Move group, no End turn); combat as V3.7.
6. Fixtures for explore (src/view/fixtures.ts: mode, tick that moves a patrol, vision) so you can build before the engine lands; switch to the real engine as it does (docs/agents/v38-engine-progress.md).
7. Check: typecheck, scripts/v38-ui-check.mjs (mode label, pause, multi-select walk, cones present, a combat banner on a forced notice, back to explore) on `?fixture=1` and the real engine, the older DOM checks still passing (update their explore/combat assumptions), stress bot (update it to send ticks in explore). One screenshot of cones and a patrol mid-walk.
