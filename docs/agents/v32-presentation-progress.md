# V3.2 presentation progress

Status: started 2026-10-24. Reading code; engine contract not yet published.

## Done
- 15.5 enemy camera: src/ui/app.ts playEvents tracks the world phase; `enemyFocus(e)` picks the hex for visible enemy moves/rolls/attacks/shoves/falls/breath/awake/spawned (any attack on a hero always); `dio.panTo(p)` switches level + pans + holds 0.35 s game time (scaled by speed; instant skips); visible enemy moves are followed; `returnToSelected()` at the end of the world phase. Diorama: `canSee(p)`, `panTo(p, hold)`.
- 15.6 loot glow: diorama `refreshLootGlow()` (called from refreshProps): additive gold sprite pulsing on every explored ground pile on the shown level (chest loot is put on the chest hex by the engine, so opened chests glow until emptied) + DOM `.loot-marker` coin (style.css V3.2 block).
- Save key vc.save.v32, loadout key vc.loadout.v32 (src/ui/app.ts).

- 15.3 (contract-independent parts): figures.ts models ranger (longbow + quiver), sapper (hammer, pack of charges with lit fuse, wide), pyromancer (red/orange), shadowmancer (violet hood, glowing eyes), hedgewitch (green, herb pouch); world.ts CLASS_COLORS. names.ts: AnyClass, CLASS_NAME/GLYPH/ROLE/GEAR/KIT for all classes, className()/classGlyph(). screens.ts: tavern recruit cards (role line, stat bars, gear, kit list), "Hire at least one hero" banner on the board + contract buttons disabled + tavern station pulses while Hobart is alone; app.ts opens camp on the tavern then. CSS in the V3.2 block.
- 15.4 text: names.ts ITEM_GLYPH (string-keyed) + itemGlyph()/itemBase() (tolerant of engine kind names) + ITEM_EFFECT one-liners for all 12 items; quartermaster shows ITEM_EFFECT.

- Contract adopted (engine progress note): fixtures.ts updated (pyromancer Aldous, new HeroInDelve/Delve fields, pick, classInfo/partyProblem); hud mana pips for the 3 mage classes.
- src/view/effects.ts (new): MapEffects (smoke puffs, glue puddle, caltrops spikes, burning hexes with flames + glow, ward shield dome, overwatch cone of hex fills in facing direction + edge ring, DOM tags: eye/zz/Stuck/Veiled; veiled heroes translucent). effectsFromState() reads Delve.smoke/glue/burning/caltrops, HeroInDelve.veil/ward/overwatch, Monster.stuck/asleep. Diorama owns `effects`, rebuilt in refreshProps, updated per frame.
- level.ts: rubble heaps hidden when their posKey is in Delve.blown (dug).
- 15.2 dash: diorama highlight style 'dash' (teal) and 'area' (orange); hud draws reach in 'dash' when any Reach.dash; tooltip says "Dash · uses the action"; bar shows "Dashed" / "Dash ready".
- Targeting: hud startAction uses ActionOption.pick: hex/enemy/ally → aim hint (+short list for units), hex targets drawn teal, area (ActionOption.area) previewed in orange under the hovered hex; preview opens for rolls, area actions and blink; RollPreview.hexes drawn orange and .affects drawn red. names.ts: ACTION_GLYPH/ACTION_KEY/ACTION_HELP for all new actions (smoke key M since C is camera). Action buttons get act-item/act-spell classes and a mana chip.

- Events: diorama playEvent handles `thrown` (arc of a coloured ball from→to, puff/flash on landing), `cast` (caster flash + float label, bolt to the target for ranged spells/shots, ring pulse over `hexes`, shake on fireball), `blinked` (fade/squash out, reappear at `to`, follow if selected), `dug` (hides the rubble/cracked wall at once + dust), `caltrops` (float "−2" + red flash). app.ts: sfx + log lines for them; ACTION_SFX for all new actions; enemy camera also follows `cast` (overwatch shots) and `caltrops`.
- Tavern recruit cards use `engine.classInfo(cls)` (role/weapon/armor/mana/abilities parsed as "Name (cost): text") with names.ts tables as the fallback (try/catch, so it runs against an engine without it). Prepare: `engine.partyProblem(state, heroIds)` shown in red in the footer and disables Delve.
- CSS (V3.2 block at the end of style.css): .loot-marker, class badges, hire banner + pulsing tavern station, recruit cards, .dash-note, .act-spell/.act-item/.act-mana, .fx-tag (ow/zz/gl/vl).
- Fixture engine: dash support (second move spends the action, `dash: true` entries) for the scene script.
- scripts/v32-shot-fx.mjs: `node scripts/v32-shot-fx.mjs <base> <outDir>` on ?fixture=1 → fx-01-effects.png (smoke, glue, caltrops, burning, veil, ward, overwatch, stuck) and fx-02-dash.png (dash range teal, spell buttons with mana chips).

## Verified (2026-10-24 evening, static build served from the scratchpad)
- tsc: 0 errors in src/view, src/ui, src/audio, src/main.ts (the remaining errors are in src/game, the engine's mid-work).
- scripts/v3-shot.mjs fixture tour: 0 errors. scripts/v32-shot-fx.mjs: 0 errors, both scenes look right. Real-engine camp (seed 1980): opens on the tavern, Hobart alone with 160 gold, 4 recruit cards, board shows "Hire at least one hero" with contracts disabled, quartermaster lists all 12 items with one-line effects.
- Not yet seen in play against the real engine (its rules were still in progress): dash, the new actions' targeting flow, thrown/cast events, enemy camera pans in a real world phase. All are wired to the published contract.

## Next (for the clarity agent, if wanted)
- The overwatch cone uses the figure's last facing (120°); if the engine means "all around within 6", drop the facing test in effects.ts rebuild().
- `cast` for mend/kindle/veil/ward on self shows only the flash + label; fine but plain.

## Next
- 15.2 dash, 15.3 squad building, abilities/spells/items bar + map effects, quartermaster, save key vc.save.v32.

## Contract requests
- None.

## Known issues
- None.
