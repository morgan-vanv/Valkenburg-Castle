# Brief: V3.1 look and interface

Read docs/agents/v3-common.md first (own paths only, don't commit, keep a progress note at docs/agents/v31-presentation-progress.md, snapshot with `bash scripts/snapshot-wip.sh`). Branch: `v3.1`. Read docs/agents/v3-presentation-progress.md for how the view and UI are laid out.

You own src/view/**, src/ui/**, src/audio/**, src/main.ts, src/style.css, index.html. Implement the redesign's look and the UI for docs/v3-spec.md section 14, against the updated contract (`git diff main -- src/game/types.ts src/game/api.ts`).

## The look (the redesign pitch, https://claude.ai/artifact/Do2xMUkTkDjgGjPRimNJJd, "Contrast and decoration")

Reference renders of the target look: mockup/shots/crossing-overview.png and crossing-close.png (made by mockup/crossing.ts, which you may borrow from). The current game reads murky; fix that:

1. **Cutaway walls:** pale stone caps clearly lighter than floors, darker faces; walls between the camera and the selected hero drop low (keep that behaviour).
2. **Floors by room:** use each room's `material` and `tint` (planks, rug, flagstone, earth, rock, water, bone), with fine engraved hex lines rather than every hex a separate grey block.
3. **Props** from `prop`/`tallprop` tiles: low-poly models for each PropKind (table, bench, bunk, barrel, crate, anvil, cage, bones, rock, shelf, forge, winch, statue, rack, stalagmite). Simple shapes are fine; silhouettes must read.
4. **Fixed lights** from `castle.lights`: warm sconces on walls, daylight shafts (cool, soft), the forge glow, green fungus, the Lair's fires, fire vents glowing on the floor. Keep the point-light count sane (pool them; only nearby/visible ones on).
5. **Railings** on `railing` hexes along the pit side; bridges drawn as spans with an underside.
6. **See-through pit:** looking into a pit shows the level(s) below, dimmed (the bridges from Level 1, the Hollow's glow from Level 2). Only the parts under the pit need drawing.
7. **The Dragon:** a big low-poly dragon model, clearly the boss; asleep pose vs awake. The hoard as gold heaps.
8. **Three levels:** level buttons L1 to L3; the lift and sealed door have models.

## Interface for section 14

- **Jump:** the action bar offers Jump; picking it highlights the adjacent pit hexes; hovering one shows the landing ("Lands on the Crossing bridge, 1 level, 4 damage" / "Falls 2 levels into the Hollow: 7 damage"). When `preview().confirm` is true, a clear confirmation dialog with the `warning` text and two buttons (Jump / Stay) appears before sending.
- **Shove:** the preview shows the landing hex on the map and the outcome per hit count; a fall outcome is shown in red with its damage.
- **Edge risk:** `edgeRisk(heroId)` non-null → an edge badge on the hero card and a red lip on the hex under the hero.
- **Intents:** draw `shove` (arrow to the landing hex), `breath` (mark every hex in `hexes` with a fire warning, impossible to miss), `sweep` (a ring around the Dragon).
- **Events:** animate `shoved` (slide), `fell` (drop through the floor, level change, impact shake, damage number), `breath` (a jet of fire along the hexes), `liftWorking` (winch turning, sound).
- **Winch** action and riding the lift (it's just movement once working).
- **Contracts:** the slay contract card on the bounty board (Dragon icon, 500 gold).
- Keep everything that works today working: camp, roll previews, speed settings, autosave (bump the save key to `vc.save.v31` so old saves on the two-level castle are ignored).

Use screenshots (scripts/v3-shot.mjs and friends, scripts/v3-map-overview.mjs with `?reveal=1`) to check the look on all three levels, and iterate until it reads clearly: room shapes, walls and props distinct at a glance, the pit's depth visible.
