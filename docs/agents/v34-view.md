# Brief: V3.4 view (figures and walls)

Read docs/agents/v34-common.md first, then docs/v3-spec.md 15.8 and 15.8a (scale option C) and docs/agents/v33-scale-study.md. You own src/view/**.

## 1. Less blocky chests (owner: "their chests are just so blocky compared to the rest of their body")

In src/view/figures.ts the humanoid torso is one plain box (`k.box(shoulderW, torsoH, depth, ...)`), so next to the round limbs and head it reads as a crate. Reshape it, keeping the option-C proportions and the chunky RuneScape read:

- A torso that narrows from the shoulders to the waist (roughly 100% → 75–80% width), with chamfered/rounded shoulder edges and a little less depth at the belly than at the chest. Low-poly is fine (a tapered 6–8 sided prism, or a few stacked/bevelled boxes); it should look shaped, not smooth.
- Belt, cape, packs, quivers, sacks and anything else hung on the torso still sit on it (they use `torsoH`, `shoulderW`, `depth`; check `back` and the pack anchors). Arms still meet the shoulders.
- Applies to everyone built by the humanoid builder (heroes, rival sisters, orcs, ghouls); orcs and ghouls keep their `wide`/lean settings. Check every hero class and monster still has a clear silhouette.

## 2. Walls at full height (owner: "turn off the walls scaling vertically depending on view... see all walls at their full height")

`Diorama.cutaway` (src/view/diorama.ts) lowers walls between the camera and the focus. Default it off so every wall stands at full height at every camera angle. Keep the code so it can come back (the hud agent may add a settings toggle; expose a simple `setCutaway(on: boolean)` if there isn't one already and say so in your progress note). Check nothing else assumed the cut (hover picking of hexes behind walls, the selection ring, edge lips, markers). If heroes standing behind a tall wall become fully hidden from the default camera, add a cheap fix: draw the hidden part of hero figures as a faint silhouette through walls (depth-test-off outline pass or a second material). Heroes only. Note what you did.

## Check

Typecheck, vitest, scripts/v3-stress.mjs (console errors). Screenshots: one before/after pair of a few heroes close up (figures), one before/after of a room at the default camera (walls). Progress note: docs/agents/v34-view-progress.md.
