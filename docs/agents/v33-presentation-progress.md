# V3.3 presentation progress

Status: 2026-10-24 night, done: steps 1–7 (spec 16) and step 8 (scale C) coded and verified (tsc 0 errors in src/view, src/ui, src/audio; v33-ui-check 29/29; stress bot 0 errors). Engine note (docs/agents/v33-engine-progress.md) says intents() will include visible rivals; the view accepts rival intents from either `engine.intents()` or `Rival.intent`.

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

## Verified (2026-10-24 night)
- tsc: 0 errors in src/view, src/ui, src/audio (src/game errors are the engine's mid-work).
- scripts/v33-ui-check.mjs (new): `node scripts/v33-ui-check.mjs <base>` on `?fixture=1`: 29 DOM assertions (prepare "Start shuttered" + remembered; delve starts shuttered; meter text/stage/toggle; Lantern bar group on L; L opens, meter button shutters; daylight hint; save key; dark card badges + hint + vignette; drawn route + footprint; new models incl. sisters by class; buried ghoul hidden; intent tags shout/attack/grab/overwatch/veil/dart + the radius-8 ring; held hero tags/bar/chip; sister overwatch/veiled tags; events shout/grabbed/released/routeKnown/shutter/dragged/spawned(rise) play clean; dark rings; creeping tiles; Gloam line on L3 + pitch vignette). All pass, 0 console errors. `SHOTS=<dir>` takes 3 reduced shots.
- scripts/v3-stress.mjs 1 delve on the real engine (static build): 0 errors (rerun after the scale port: 0 errors; v33-ui-check rerun: 29/29).
- Shots: scratchpad/v33-shots/{01-shuttered,02-patrol-intents,03-gloam}.png (1200x750, test castle). The meter's daylight hint first overlapped the cards; moved into the meter's foot line.

- **8. Scale C "RuneScape" (addendum)** — figures.ts `humanoid()` rebuilt parametrically from the study's panel C: height 1.0 model unit to the bare head, head 1/5, limb 0.07, shoulder width 0.34 (× `wide`), legs 0.44, neck 0.02, torso = the rest (box, no chunky prism); cylinder legs + feet, hanging cylinder arms (the weapon arm swung forward 0.75 rad), skin hands, blocky head (icosahedron) with eyes, helms/beards/capes/pauldrons/weapons/shield/bow/staff re-fit to the proportions; `hunch` is a true lean of the torso group about the hip. `humanoid()` now returns a `Frame` (top, head centre/radius, hip, shoulders, hands, back) and every model's extras (sapper pack, pyromancer flame, hedgewitch pouch/sprig, sister lanterns/sack, prisoner shackles, orc/archer/captain tusks, captain plume, ghoul ribs/claws, cutpurse sack, berserker axes) hang on it. Banner: pole over the left shoulder, flag top at 1.28 (panel C). `HEAD_TOP` 1.0; `HELM_TOP` per helm.
  - unit.ts: `HERO_SCALE` 2.0 (a hero is 2.0 world units); `FIGURE_SCALE` relative to the hero: rats 1.3 (≈0.7 long, 0.35x), orc 2.1 (1.05x), archer 2.0, captain 2.1 (orc with plume), ghoul 2.0 (gaunt, `wide` 0.8, hunch 0.6), cutpurse 1.9, berserker 2.5 (a head taller than the orc), spider 1.25 (≈1.6 across, 0.8x), gloam 1.8 (≈3.0 high), sisters 1.95, prisoner 1.9, Dragon 1 (unchanged).
  - world.ts `WALL_HEIGHT` 2.6 (thin panels, posts, doors, lintels, the sealed slab and sconces all derive from it; sconce at 0.72 of the wall, railings unchanged at waist height). app.ts `DELVE_DISTANCE` 22 → 19.
  - Overlays re-fit: `FLOAT_LIFT` 2.8 → 2.25; intent lines start at 0.9; link markers at 1.3; beacon tag at 2.3 (slay 4.6); thrown arcs start at 1.3. HP/intent tags, lantern/torch lights, ward domes, lunge/recoil and the hip lantern all follow `unit.height`, so they moved with the figures.
  - Shots (same camera as the V3.2 style pair): scratchpad/v33-scale/party.png (Hobart at the gate) and door.png (a doorway with a sconce and an orc beyond): doors and sconces sit right on the 2.6 walls; figures read as tall natural-blocky; HP tag just above the banner.

## Before / after (one pair for the report)
- Before (V3.2 style, 15.8 chunky figures, 2.2 walls): /tmp/claude-0/-home-claude/692da2aa-d3ab-5f2c-8721-44a0aca79867/scratchpad/style-final/party.png
- After (V3.3 scale C): /tmp/claude-0/-home-claude/692da2aa-d3ab-5f2c-8721-44a0aca79867/scratchpad/v33-scale/party.png
- Doorway check: …/scratchpad/v33-scale/door.png. Spec-16 looks: …/scratchpad/v33-shots/{01-shuttered,02-patrol-intents,03-gloam}.png.

## In progress
- Nothing.

## Next (if wanted)
- Known patrol routes could follow the engine's actual path between waypoints if `routeKnown` carried it.
- The Gloam edge tiles and the dark rings were checked on the test castle; a look in the real Hollow (Level 3 with the engine's Gloam) once the engine lands would confirm the effect reads at the default distance.
- Figures could face their intent target at sync (carried over from 15.8).

## Decisions (for docs/decisions.md; the lead may copy)
- 2026-10-24: Scale direction C: a hero is 2.0 world units, walls 2.6, humanoids built parametrically (head 1/5, limb 0.07, shoulders 0.34, legs 0.44) and monsters scaled relative to the hero (unit.ts FIGURE_SCALE). The Dragon is unchanged. Delve camera 19.
- 2026-10-24: Shutter is hotkey L and wins over Light (brazier) and Oil's L for the lantern bearer; L also toggles the lantern when another hero is selected and has no L button (it's free and any-time).
- 2026-10-24: "Start shuttered" is a presentation option: the prepare screen remembers it and the app sends the free `shutter` action right after `startDelve` (no contract change).
- 2026-10-24: The Gloam's creeping darkness is drawn on visible unlit hexes within 2 of the light, not on every dark hex, so it reads as an edge.
- 2026-10-24: Known patrol routes are drawn as straight segments between waypoints (the engine's path between them isn't published); good enough for "where it walks".

## Contract requests
- None. (Nice to have, not needed: `routeKnown` could carry the full walked path so the drawn route follows corridors.)

## Known issues
- `Rival.cls` is required by the contract but old saves won't have it: the view falls back to the plain sister model.
- The route drawing's arrows drift at a fixed speed regardless of segment length.
