# Brief: V3.2 visual clarity pass and UI refinement

Read docs/agents/v3-common.md (own paths only, don't commit, progress note at docs/agents/v32-clarity-progress.md, `bash scripts/snapshot-wip.sh` every 15 minutes). Branch `v3.2`. Read docs/agents/v32-presentation-progress.md and v31-presentation-progress.md for the view and UI layout (you take over those paths from the presentation agent, who has finished).

You own src/view/**, src/ui/**, src/style.css. Implement docs/v3-spec.md section 15.7 and give the whole interface a refinement pass against the pillar it states: visual clarity, with intention. Don't spoonfeed; once something is seen, say what matters and what can be done with it. The red edge lip under a hero on a pit edge is the model.

## Order of work

1. **Look first.** Build and take screenshots of every screen and state (title, camp stations, prepare, a delve on each level, hover on each interactable, the preview, the confirm dialog, summary). Write a short critique in your progress note: what's unclear, what's noisy, what's missing, ranked. Then fix in that order.
2. **The two play-test failures, first and fully:**
   - Stairs and lift: distinctive models (steps into a dark opening; a lift cage with chain), floating level markers once explored, hover tooltips, the "Take stairs ↓ Level 2" action-bar button when standing on them (built from `reachable`: the entry whose `to.level` differs and whose path is 1 step), the hex pulsing, click-own-hex also takes them. Test it: a headless script that walks Hobart from the main gate to the tower stair and takes them must reach Level 2.
   - Objective beacons: light pillar + diamond marker on the explored contract objective, goal box with location and click-to-pan, `ActionOption.blocked` shown greyed with its reason (the engine agent is adding it; check docs/agents/v32-engine-progress.md for the field).
3. **Interactable hover tooltips** for everything in 15.7's list, with a consistent outline.
4. **HUD hierarchy and refinement** per 15.7: grouped action bar with hotkeys, End turn with the "still have actions" count and a single confirm, hero cards slimmed (item icons, status badges), the context hint line. Use your judgment on spacing, type and colour; the current UI reads busy. Keep the dark, warm look.
5. **Verify** with screenshots and the stress bot (scripts/v3-stress.mjs) for errors; keep scripts/v3-shot.mjs working (update selectors you change).

Finish with a short report: what changed (with before/after screenshot paths), what you left alone and why, anything you'd do next.
