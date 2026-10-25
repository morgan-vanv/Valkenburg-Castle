# V3.2 style progress (spec 15.8)

Status: 2026-10-24, done. Verified cheaply: tsc 0 errors, scripts/v32-stairs-walk.ts PASS, scripts/v3-stress.mjs 2+1 delves 0 errors, scripts/v32-clarity-check.mjs all ok 0 errors; look checked in 8 reduced-size shots (party, Dragon asleep/awake, door+sconce, bridges/railings, HUD at the default distance, one per level).

Static build for testing: `npx vite build --outDir <scratch>/dist-style --base ./`, served with `python3 -m http.server 5193` from that dir. Shots: `node scripts/v32-shot-style.mjs http://localhost:5193/ <outDir> [party,dragon,awake,door,levels]` (1200x750, reveal=1, seed 1980).

## Done
- **1. Figures (src/view/figures.ts, unit.ts, diorama.ts, effects.ts, camera.ts, app.ts)**
  - `humanoid()` rebuilt chunky: ~1.05 to the head and ~0.6 wide in model units (big head, broad hex-prism torso, short thick legs, thick arms, bigger helms/weapons/shields); every humanoid gets eyes (dark dots; glowing for monsters) so the front reads. Robes via `robe()`. Banner smaller and just over the head; `FigureModel.height` is the head/hat top so HP tags sit low. `Kit.scaleAll()` added.
  - unit.ts `HERO_SCALE` 2.5 and `FIGURE_SCALE` by menace: Hobart 2.6, orc 2.5, cutpurse 2.3, berserker 2.9, rats 2.6 (four fat rats), spider 2.6 (legs past the hex edge), gloam 2.3, sister 2.4, prisoner 2.3, dragon 1. A hero is ~2.6 high and ~1.5 wide (hex is 1.73 across).
  - Camera: delve start distance 19 → 22 (`DELVE_DISTANCE` in app.ts), zoom floor 6 → 7. Figures start facing the camera.
  - Overlays follow the new height: HP/intent tags already use `unit.height`; floating text lift 1.6 → 2.8 (`FLOAT_LIFT`); link marker over an occupied hex rises by the figure's height; beacon tag at 2.8 (4.6 for the Dragon), pillar 9 high; intent lines start at 1.1; selection ring 0.66–0.8; lunge 0.6 / recoil 0.26; lantern and torch point lights above the head (they were inside the new torsos, which went dark); ward dome scales with height; thrown arcs start at 1.6.
- **2. Dragon (figures.ts)**: awake model ×1.3 (about 3.5 hexes long, head ~4 high, wings ~8 across, low over the hoard hexes); asleep coil ×1.75 (~2.3 hexes across, 2.6 high). Breath origin follows `height * 0.85` (the head).
- **3. Walls (level.ts, world.ts)**: `WALL_HEIGHT` 1.25 → 2.2, `WALL_THICK` 0.24. A wall hex with an open neighbour (anything but wall/cracked/sealed/void) in a built room is drawn as thin panels (`panelGeo`, pale cap, dark face) along each open-facing edge, hex posts (`postGeo`) at the corners (deduped by world position), over a low dark core (0.24 high, under the cutaway height so no z-fighting). Wall hexes with no open neighbour, and any wall touching a floor in a rock/earth/bone room (`CAVE_MATERIALS`), stay solid prisms. New `batchItems()` (instances with rotation + offset); `batch()` wraps it. Cutaway applies to panels and posts.
  - Pits don't count as open: walls over the Hollow stay solid piers (a first pass drew panel rings there, which looked like hollow towers); a wall between a room and a pit gets panels on the room side only.
  - Fittings on the thinner walls: sconce bracket moved to the panel face (0.49 of the way to the neighbour, 0.72 wall height); door/exit/sealed spans 1.8 so the posts sit just inside the reveals; exit posts taller; lift cage 2.7 high (taller than a hero), chain/beam raised; railings waist high (posts 1.02).
- scripts/v32-shot-style.mjs (new): the style shots above.

## Shots (scratchpad = /tmp/claude-0/-home-claude/692da2aa-d3ab-5f2c-8721-44a0aca79867/scratchpad)
- Before/after pair for the report: style-before/party.png → style-final/party.png (Hobart at the gate, same camera).
- Final: style-final/{party,dragon,bridge,level1,level2,level3}.png; style-b/dragon-awake.png (awake, Hobart beside it); style-d/{door,hud}.png.

## Next (if wanted)
- The sleeping Dragon's head is half under its folded wings; a raised head on the coil would read better from the default pitch.
- Cracked walls as panels with cracks instead of a solid block.
- Monsters could face their intent target instead of the camera at sync.

## Decisions (for docs/decisions.md; the lead may copy)
- 2026-10-24: Walls are 2.2 high (hero ≈ 2.6) so thin panels still read as walls; the cutaway keeps the party visible.
- 2026-10-24: Cave = room material rock, earth or bone; those walls stay thick. Water (the Drain) and bone-free built rooms get thin walls.
- 2026-10-24: Figures start facing the camera.

## Contract requests
- None.

## Known issues
- Heroes standing next to the awake Dragon poke through its low wings (accepted; it's a boss).
- Cracked walls stay a solid hex block inside an otherwise thin wall line (they are special; a panel version could follow).
