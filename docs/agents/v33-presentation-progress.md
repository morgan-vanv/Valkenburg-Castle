# V3.3 presentation progress

Status: 2026-10-24 night, steps 1–7 coded (tsc 0 errors in src/view, src/ui, src/audio); headless verification next, then the scale addendum (step 8). Engine note (docs/agents/v33-engine-progress.md) says intents() will include visible rivals; the view accepts rival intents from either `engine.intents()` or `Rival.intent`.

## Plan (brief order)
1. Shutter: meter toggle + bar action + hotkey, lantern model dark when shuttered, L1 daylight hint, prepare "start shuttered".
2. Per-hero darkness: `heroLit` / `sightRange(state, heroId)` → card badge, vignette ring, hint "In the dark: sight 1".
3. Patrols: `knownRoutes` → dotted route with arrows; footprint icon on patrollers.
4. Gloam: creeping darkness at the light edge, persistent warning line, strike sfx + shake.
5. Monsters: archer, captain, ghoul (rise animation), spider drag, sisters by class.
6. Intents/events: shout ring, drag arrow, grab chain + escape action; events with sfx + log.
7. Oil +8 text; save key vc.save.v33.
8. **Addendum (lead, owner-approved, received mid-task):** after 1–7, apply scale direction "C RuneScape" from mockup/scale-options.ts (panel C preset + parametric humanoid): hero 2.0 world units high (hex size 1), natural blocky proportions (head 1/5 of height, limb thickness 0.07, shoulder width 0.34, leg length 0.44 of height; no chunky torsos); monsters relative to the hero: rat 0.35x, spider 0.8x wide, orc 1.05x, berserker a head taller, captain like an orc with plume, ghoul gaunt; WALL_HEIGHT 2.6 (thin walls stay); Dragon unchanged. Port into src/view/figures.ts, unit.ts, world.ts; re-fit overlays (HP bars, markers, intent icons, light heights) to the 2.0 height; check doors/sconces/railings on 2.6 walls; delve camera distance a bit closer than 22. One party shot + one doorway shot.

## Done
- **1. Shutter** — hud.ts `lightMeter`: stage reads "Shuttered" when closed; foot line "Open · burning" / "Shuttered · not burning" + oil kept; `Shutter`/`Open` button (`.light-toggle`); `toggleShutter()` sends `act shutter` for the bearer (works whoever is selected). Bar: a **Lantern** group (`.act-shutter`, hotkey **L**, "free" tag) for the bearer; `shutter` filtered out of the engine's option groups. Hotkey L toggles the lantern unless the selected hero has a Light/Oil button on L. L1 hint in the meter ("The ruins have daylight. Shutter the lantern to save oil.") while open, any hero on L1, round ≤ 10. Prepare screen: "Start shuttered" checkbox (`Loadout.startShuttered`, remembered); app.ts sends the free shutter right after `startDelve`. Diorama: `lanternOpen` from state; no bearer point light when shuttered; a 3D lantern (iron frame, flame, glow sprite) hangs at the bearer's hip and goes dark when shuttered or at pitch; the ◆ tag becomes ◇. `shutter` event: float text, flash on opening, log line, click sfx, meter refresh. Vignette falls to 'dark' while shuttered (per-hero rule below wins).
- **2. Per-hero darkness** — hud `isLit()` / `sightOf()` wrap `engine.heroLit` / `sightRange(state, heroId)` in try/catch (an engine without them = lit). Card: `.hcard.dark` (dim badge) + chip "In the dark · sight N" with a title (L3 wording). Context hint leads with "**In the dark**: sight N". Vignette: selected hero unlit → 'dark' ('pitch' on L3). Diorama `setDarkHeroes(ids)`: breathing dark floor ring (0.92–1.55) that follows each unlit hero.
- **3. Patrols** — diorama `refreshRoutes()` (from refreshProps): for monsters in `knownRoutes` with a `route` on the shown level, dotted loop through the waypoints (straight segments between waypoints), small arrows drifting along each segment, faint hex rings at the waypoints. `routeKnown` event: adds the id to the local state's knownRoutes, redraws, "Patrol route known" float, ring pulse along the route, log line. Monster tag shows 👣 while `awareness === 'patrol'`; tooltip says "On patrol: route known".
- **4. Gloam** — diorama `refreshGloamEdge()`: while a gloam exists on the shown level, every visible unlit hex within 2 of a lit hex gets a near-black pulsing disc (InstancedMesh, ≤400). HUD `.hud-gloam` line "◉ The dark here is awake. Stand in the light." while a gloam exists and any active hero on L3 is unlit (breathing glow). `gloam` event: log "The dark here is awake.", new `sfx 'gloam'` (sub thrum + swell + cold ring), float at the rise hex. Its `hit`s: 'gloam' sfx, dark pulse, shake 0.45, log "The dark strikes X for N".
- **5. Monsters** — figures.ts: `archer` (orc, longbow + quiver, no shield), `captain` (broad orc, kettle helm, red plume crest, big shield, pauldrons), `ghoul` (gaunt grey-green, hunched, ribs, claws, pale eyes), `sisterRanger` / `sisterShadow` / `sisterBurglar` (hood colours, bow / glowing eyes + cape / dagger + sack; lantern at the belt for the ranger). unit.ts scales. Diorama `sisterModel(cls)`; a rival's model swaps when her class is known; veiled sisters translucent with a "veiled" tag, "overwatch" tag. Buried ghouls (`Monster.buried`) are not drawn; beginPlayback marks new ghouls `rise`, and the `spawned` event plays a rise: from one body-height below, dust at start and end, "Something rises" float, shake, log "claws out of the ground". `dragged` event: hero hauled from→to on a white web strand toward the spider, "Dragged!" float, web sfx.
- **6. Intents and events** — diorama `showIntents` handles monsters and rivals (from `engine.intents()` or `Rival.intent`): `shout` = big ring at radius 8 with an expanding pulse inside (📣); `drag` = pale arrow victim→to (red if a pit); `grab` = red line + ⛓ tag; `overwatch` = faint ring at 6 (👁); `smoke` = grey rings on the landing hex and neighbours + line; `veil` = ◐ on self; `dart` = blue line (➶); archer `attack`/`shove` use the existing line / knockback arrow (shove tooltip now says "knocks back … (a pit!)"). Hero tag shows "⛓ Held" while `grabbedBy`; ghoul tag shows ⛓ while `holding`. Bar: "Held" instead of "Move ready", a red "⛓ Held by X: Escape or kill it." line; `escape` button styled `.act-escape`, hotkey X. Card chip "⛓ Held". Events `shout` (horn, RALLY! float, racing ring, log), `grabbed` (lunge, green flash, "⛓ Grabbed!" float, log with the escape rule), `released` ("Free" float, log), `dragged`, `shutter`, `routeKnown` as above; enemy camera (15.5) pans to shout/dragged/grabbed/released/gloam. hud `intentText` covers all new kinds; `MONSTER_NOTE` one-liners in monster tooltips (archer, captain, ghoul, spider, gloam).
- **7. Text and keys** — names.ts: oil "+8 lantern oil", Kindle "+6", brazier "+4 lantern oil"; MONSTER_NAME archer/captain/ghoul; ACTION_GLYPH/KEY/HELP for shutter (◑, L) and escape (⛓, X); ACTION_SFX shutter/escape. Light-meter tooltip rewritten for the shutter. Save key `vc.save.v33`, loadout key `vc.loadout.v33`. Menu key help lists L.
- fixtures.ts: new Delve fields, `heroLit`, `sightRange(heroId)`, shutter action, shutter respected in the fixture's lit set.
- CSS: block "V3.3: fear by depth" at the end of style.css.

## In progress
- Headless verification (build to the scratchpad, DOM checks on ?fixture=1, stress bot).

## Next
- Step 8 (scale addendum).

## Decisions (for docs/decisions.md; the lead may copy)
- 2026-10-24: Shutter is hotkey L and wins over Light (brazier) and Oil's L for the lantern bearer; L also toggles the lantern when another hero is selected and has no L button (it's free and any-time).
- 2026-10-24: "Start shuttered" is a presentation option: the prepare screen remembers it and the app sends the free `shutter` action right after `startDelve` (no contract change).
- 2026-10-24: The Gloam's creeping darkness is drawn on visible unlit hexes within 2 of the light, not on every dark hex, so it reads as an edge.
- 2026-10-24: Known patrol routes are drawn as straight segments between waypoints (the engine's path between them isn't published); good enough for "where it walks".

## Contract requests
- None. (Nice to have, not needed: `routeKnown` could carry the full walked path so the drawn route follows corridors.)

## Known issues
- `Rival.cls` is required by the contract but old saves won't have it: the view falls back to the plain sister model.
- The route drawing's arrows drift at a fixed speed regardless of segment length.
