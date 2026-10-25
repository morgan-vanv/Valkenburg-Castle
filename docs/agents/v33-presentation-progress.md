# V3.3 presentation progress

Status: started 2026-10-24 night. Reading the contract diff and the view/UI code. Engine progress note not yet published; building against the contract.

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
- (nothing yet)

## In progress
- Reading code.

## Next
- Step 1.

## Contract requests
- None yet.

## Known issues
- None yet.
