# V3.4 view: progress

## Done

1. **Less blocky chests** (src/view/figures.ts). The humanoid torso was one box; it's now a low-poly
   tapered octagonal prism (`shapedPrism` through `TORSO_RINGS`): 78% of shoulder width at the
   hip, full width at the chest, chamfered corners, the top ring pulled in so the shoulders read as
   bevelled, and the belly ~82% of chest depth. The belt follows the waist. Option C proportions
   are unchanged (shoulder width, torso height, depth, limb sizes), so arms, pauldrons, capes,
   banners, quivers and hands are where they were. `Frame` gains `torsoH` and `torsoAt(y)`
   (half-width/half-depth at a torso height); `backZ` now sits on the shaped back (it's a little
   shallower, so packs and sacks hug it). Ghoul ribs follow the chest. Applies to every
   humanoid (heroes, sisters, orcs, archer, captain, ghoul, cutpurse, berserker, prisoner);
   `wide` and `hunch` are untouched.
2. **Walls at full height** (src/view/diorama.ts). `Diorama.cutaway` now defaults to `false`.
   The shader cut stays in fog.ts/level.ts. **API for a settings toggle:
   `Diorama.setCutaway(on: boolean): void`** (plus the public `cutaway: boolean` field; it's read
   every frame). From the app: `app.dio.setCutaway(true)`; in the console: `vc.dio.setCutaway(true)`.
3. **Heroes behind walls** (src/view/unit.ts). Each hero figure has a second mesh named
   `silhouette` sharing the body geometry: a warm amber `MeshBasicMaterial`, opacity 0.42,
   `depthFunc: GreaterDepth`, no depth write, renderOrder −1. It only shows where something nearer
   (a wall) hides the hero, and fades with `setOpacity` (veil, death). It is excluded from
   `pickables()`. Heroes only; monsters stay hidden behind walls.
4. **Rings behind walls** (diorama.ts). The hover ring, path-end ring and selection ring each get a
   faint `GreaterDepth` copy (`throughWall()`), so a hex picked behind a wall still shows its ring.
   The hover copy follows `setHoverStyle` colours.
5. src/view/fixtures.ts: the fixture hero now has `hp: maxHp` (the lead's new `Hero.hp` broke
   typecheck there).

Checked with nothing else assuming the cut: picking is a ray against figures and then floor
planes (walls aren't pick targets), so hexes behind walls are still pickable; edge lips,
markers, intent lines and beacons were already drawn with `depthTest: false` or sit on the floor.

## Checks

- `npx tsc --noEmit` clean; `npx vitest run` 150/150.
- scripts/v3-stress.mjs, 2 delves, 0 console errors (run against a static build; the dev server
  reloads while other agents edit, which kills the bot's long evaluate).
- Shots (docs/agents/v34-shots/): view-figures-before/after.png (scripts/v34-view-figures.mjs, a
  lineup of 14 humanoids built from figures.ts via scripts/v34-view-lineup.ts),
  view-walls-before/after.png (scripts/v34-view-walls.mjs: Hobart moved just north of a wall run in
  the Great Hall, default camera, selection ring on).

## Known issues / next

- The silhouette shows through any nearer geometry, including another hero or a tall prop, not
  only walls; it's faint, so this reads fine.
- Monsters behind a wall are fully hidden at the default yaw; the player can rotate (snap 60°).
- The silhouette colour and opacity are constants at the top of unit.ts (`SILHOUETTE_*`).

## Contract requests

None.
