# Brief: scale and proportion study (mockup only)

Read docs/agents/v3-common.md (testing-cost rules apply; here the screenshots ARE the deliverable, so take the ones you need, at most ~6). Branch `v3.2`. You own mockup/** only; don't edit src/**.

The owner finds the current figures (OSRS-scale, chunky) clunky against the tiles and map, and wants to pick a holistic scale and proportion direction before it's applied. Produce ONE composite image, mockup/shots/scale-options.png (about 2100x800), with three panels side by side, each the same scene at a different scale and proportion, each labelled with its name and numbers.

## The scene (identical in all three panels)

A room corner on the game's hex grid (hex size 1, pointy-top, same hexToWorld as src/game/hex.ts), roughly 7x6 hexes of flagstone floor with the game's engraved hex lines; two thin walls meeting at a corner (pale cap, dark face, corner posts) with a door opening and a lit sconce; one pillar; one chest; a hero (Hobart: crown, banner, sword), an orc, a spider and a rat; and the Dragon asleep in the far corner for relative scale. Use the game's colours and materials (import from src/view/world.ts where handy) and its lighting style (dark ambient, warm sconce light). Camera: the game's default pitch (0.95) and yaw, framing the same hexes in each panel so sizes compare directly.

## The three options

Build figures parametrically in the mockup (height, head ratio, limb thickness, torso width), not with src/view/figures.ts.

| Panel | Name | Figure height (hexes) | Proportions | Wall height | Notes |
| --- | --- | --- | --- | --- | --- |
| A | Miniatures | 1.3 | slender, head 1/6, thin limbs | 1.6 | a board-game diorama feel (For the King): small figures, lots of visible floor |
| B | Stylised | 1.7 | big head (1/4), short legs, broad shoulders | 2.4 | readable silhouettes, toy-like, like current game but calmer |
| C | RuneScape | 2.0 | natural blocky, head 1/5, limbs medium | 2.6 | tall figures, imposing walls |

Monsters scale with the hero in each panel: rat 0.35x, spider 0.8x (wide), orc 1.05x, Dragon asleep coil about 2.3 hexes across, so the Dragon reads big in every panel. Label each panel at top-left: name, figure height, wall height, head ratio.

Render headless with the pattern in mockup/shot.mjs (SwiftShader), one PNG per panel, then compose them side by side with Python (PIL is fine) into scale-options.png. Look at the result and fix framing so all three are at the same camera distance and nothing is cut off. Write mockup/scale-options.ts (+ an html entry) so a fourth variant is a parameter change. Report with the file path and the exact parameters used per panel.
