# V3.1 presentation progress

Status: look built; section 14 UI verified in screenshots on ?castle=test (jump hover/preview/confirm/fall, edge badge+lips, shove preview, breath/sweep/shove intents, breath jet, winch, slay card). Next: real castle when it typechecks; full tour + stress bot.

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

## Next (old list, items 2-3 done)
1. Check latest screenshots, tune look.
2. (done) HUD: Jump flow (highlight pit hexes, hover shows landing via engine.fallInfo + dio.showLanding, confirm dialog when preview.confirm with preview.warning, Jump/Stay), Shove preview landing + red fall outcome, edge badge on hero card + dio.showEdgeLips from engine.edgeRisk, winch action, describeHex for prop/lift/sealed/railing/vents, intentText for shove/breath/sweep, goalBox + contract card for 'slay' (Dragon icon), TILE_NAME new kinds.
3. app.ts: sfx for shoved/fell/breath/liftWorking events, hook dio.onImpact etc; css for .landing-tag, edge badge, jump confirm.
4. Switch to real engine/castle (engine committed; check src/data/castle typechecks) and shoot all three levels.
5. Run scripts/v3-shot.mjs full tour + v3-stress.mjs for errors.

- scripts/v31-shot-scenes.mjs: scenes on ?castle=test. Fixed: intent marks now re-shown on level change.

## Contract requests
- None.

## Known issues
- Dev server: run `source scripts/npmenv.sh && npx vite --port 5191 --strictPort` (background).
