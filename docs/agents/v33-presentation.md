# Brief: V3.3 view and interface

Read docs/agents/v3-common.md (incl. testing-cost rules), docs/agents/v32-style-progress.md, v32-clarity-progress.md and v32-presentation-progress.md (view/UI layout), then docs/v3-spec.md section 16 and the contract diff (`git diff main -- src/game/types.ts src/game/api.ts`). You own src/view/**, src/ui/**, src/audio/**, src/style.css. Branch `v3.3`. The engine agent implements the rules in parallel; build against the contract and its progress note docs/agents/v33-engine-progress.md.

1. **Shutter**: a lantern toggle in the light meter and the action bar (free, hotkey), the meter showing "Open · burning" or "Shuttered · not burning"; the lantern model and light go dark when shuttered; a hint on Level 1 that the ruins have daylight. The prepare screen may offer "start shuttered".
2. **Per-hero darkness**: use `heroLit` and `sightRange(state, heroId)`: a hero in the dark gets a dim badge on the card and a dark vignette ring on the map; the context hint says "In the dark: sight 1" on L3. Visibility comes from the engine as before.
3. **Patrols**: once in `knownRoutes`, draw the route as a faint dotted path with arrows on the shown level; patrollers get a small footprint icon.
4. **The Gloam in the Hollow**: when present, a creeping darkness effect at the edge of the party's light and a persistent warning line ("The dark here is awake") while any hero on L3 is unlit; its strikes get a sound and a shake.
5. **New monsters**: models for archer (bow), captain (shield, plume), ghoul (bony, rising-from-the-ground animation on `spawned`), spider drag animation; rival sisters by class (ranger bow, shadowmancer hood, burglar).
6. **Intents and events**: shout (ring expanding to radius 8), drag (arrow toward the spider), grab (chain icon on the held hero; the `escape` action in the bar), archer shots and knockback shots, rival overwatch/smoke/veil/dart; events shout/dragged/grabbed/released/shutter/routeKnown with sfx and log lines.
7. Quartermaster text for oil (+8). Save key `vc.save.v33`.

Verify cheaply (typecheck, stress bot, DOM assertions); a few screenshots only where the look is the question (the Gloam effect, a patrol route, the shutter state). Report with one before/after pair.
