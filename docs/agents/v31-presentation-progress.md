# V3.1 presentation progress

Status: look built; section 14 UI verified in screenshots on ?castle=test (jump hover/preview/confirm/fall, edge badge+lips, shove preview, breath/sweep/shove intents, breath jet, winch, slay card). Real castle now typechecks; level shots of all three levels look right (scripts/v31-shot-levels.mjs real). Framing widened (camera max distance 90, frameLevel up to 110). v3-shot full tour passes on the real castle (0 errors). Perf fix: hidden instances collapse in the vertex shader; below-view only under explored pits (was 40 s/frame in SwiftShader). Daylight toned down, walls bake 35% of fixed light. Stress bot running against a static build (port 5192, scratchpad/dist) because the dev server reloads when the map agent saves.

## Done (files)
- src/ui/names.ts: dragon name, winch glyph + hotkey W, hoard glyph.
- src/ui/app.ts: SAVE_KEY `vc.save.v31`, LOADOUT_KEY `vc.loadout.v31`.
- src/view/fixtures.ts: liftWorking, sightRange, fallInfo, edgeRisk (fallFrom helper) for the stand-in engine.
- src/view/fog.ts: rewritten. Fog 0.35 = "below" (lower level seen down a pit, dim/cool). Instanced attrs `aGlow` (baked fixed light) and `aMat` (floor material pattern + engraved hex joints in the shader: flagstone, planks, rug, earth, rock, water, bone). setFogTime for water.
- src/view/furniture.ts (new): low-poly model per PropKind, winch drum, hoard heaps.
- src/view/figures.ts: Kit exported; 'dragon' (awake, reared, wings) and 'dragonSleep' (coiled) models.
- src/view/unit.ts: dragon scale 1.
- src/view/level.ts: rewritten. Floors by room material/tint, raised floors, pit ledges, bridge piers, two-tone walls (pale cap, dark face) with cutaway, railings, pillars, doors, sealed door, lift (upper/lower), stairs, exits, braziers, cracked walls, props (instanced by kind, back to wall), fixed lights (sconce on walls, daylight shaft, fire pit / vent / forge glow, fungus, glow) baked per hex with LOS. `applyBelow(column)` for see-through pits. `pits` set. `drums` for the winch. `propName()` export.
- src/view/world.ts: COLORS.wallCap, LEVEL_GAP 9.
- src/view/props.ts: makeHoard.
- src/view/diorama.ts: applyBelow (levels under the shown one drawn only under its pits + halo 3), pooled point lights (lantern, torches, braziers, nearest fixed lights; MAX_LIGHTS 12), flame flicker, drum spin, key light; dragon model swaps asleep/awake; hoard ground props; intents shove (arrow to `to`, red if pit), breath (pulsing fire hexes), sweep (rotating red ring); showEdgeLips(at[]), showLanding(from, to, text, danger) + landing-tag DOM label; events shoved (slide), fell (drop, level switch, shake, damage, dust), breath (fire jet), liftWorking; hooks onImpact/onBreath/onLift; focusXZ.
- scripts/v31-shot-levels.mjs: `node scripts/v31-shot-levels.mjs http://localhost:5191/ <outDir> [fixture|real]` → level<N>.png and level<N>-close.png, everything revealed.

## Done since
- src/main.ts: `?castle=test` = real engine on testCastle.
- src/ui/hud.ts: jump (danger highlight, hover/preview landing via fallInfo + showLanding), shove landing, preview warning box + red fall outcomes, confirm modal (title, Jump/Stay) when preview.confirm, edge badge on cards + showEdgeLips, describeHex for props/lift/pit/railing/vents, intentText shove/breath/sweep, goal box slay.
- src/ui/app.ts: events shoved/fell/breath/liftWorking (sfx + log), winch sfx. src/audio/sfx.ts: thud, whoosh, roar, winch.
- src/ui/screens.ts: slay card (Dragon icon, 'Slay'). src/style.css: V3.1 block at the end.

## Next (brief done; nice to have)
- Look tuning stopped at the lead's request. Ideas: thinner railings readable from far, Dragon breath on the real castle not yet seen in play (shown via scripted intents), touch pass.
- Hoard heaps only appear if the engine places 'hoard' ground items (it does at delve start).

## Final checks (2026-10-24)
- tsc: 0 errors in my paths. v3-shot.mjs full tour on the real castle: 0 errors. v3-stress.mjs (2 delves) on the real castle: 0 errors. v31-shot-scenes.mjs (?castle=test): 0 errors. Real-castle jump from the L1 rim to the Hollow: 0 errors.
- Static build for testing: `npx vite build --outDir <dir> --base ./` then serve it; the dev server reloads mid-run while other agents edit files.

## Contract requests
- None.

## Known issues
- Dev server: run `source scripts/npmenv.sh && npx vite --port 5191 --strictPort` (background).
- SwiftShader is slow when looking into a pit (about 0.7 s/frame headless); fine on a real GPU. Screenshot scripts may need longer timeouts.
