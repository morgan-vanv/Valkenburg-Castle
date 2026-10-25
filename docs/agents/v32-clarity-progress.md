# V3.2 clarity progress

Status: started 2026-10-24. Owner instruction (via the coordinator): screenshot testing is expensive. At most 4 targeted screenshots for the critique, cheap checks first (tsc, headless stairs walk asserting the level, stress bot, DOM assertions), one before/after pair for the report.

Before shots (taken once with scripts/v3-shot.mjs on a static build, seed 1980): /tmp/claude-0/-home-claude/692da2aa-d3ab-5f2c-8721-44a0aca79867/scratchpad/shots-before/ (00-title … 15-after). Looked at 00, 03, 04, 05 plus the owner's docs/agents/v32-los-bug.png. The rest of the critique is from reading src/ui/hud.ts, src/view/diorama.ts, src/view/level.ts and src/style.css.

## Critique (ranked; fixing in this order)

1. **Stairs are invisible as an action.** Stairs are a flat dark disc with 5 small steps sunk into it; from the default camera they read as a dark hex. No marker says where they go. `reachable` includes the other level's hex, but it's on a level not shown, so no highlight, no button, no tooltip ("Stairs" only). Click-own-hex does nothing. The lift reads better (posts, ropes) but says nothing about the winch until hovered.
2. **Take fails silently.** `renderBar` draws `ActionOption.blocked` options like any other; clicking sends the command, the engine refuses, and the only feedback is a toast with the error (app.ts send). Hex tooltip lists the items but never says take is blocked.
3. **The goal box is status, not location.** "Find it and carry it out." The contract brief ("…lies in the chapel altar") is shown on the prepare screen and then forgotten. Once the objective hex is explored nothing on the map marks it (the heirloom is a small gold prop; the prisoner a figure).
4. **Hover is uniform.** Every hex gets the same parchment ring; a door, a chest, a cold brazier and plain floor look the same under the pointer. Tooltips describe ("Closed door", "Chest") but name the interaction only when an action option exists ("Click: Open"), so things out of reach never say what they're for.
5. **Hero cards are the loudest thing on screen** (286 px, 4 rows each): Focus pips, pack boxes, and Move/Act chips that repeat the bar's "MOVE READY · ACTION READY" and the card's dimming when done. Status chips (Webbed, Torch, Guarding) are the same weight as the Move/Act chips.
6. **The action bar is flat.** Walk/Sneak, every action, and End turn sit in one row at one weight; hotkeys are 0.56rem corner labels; no grouping between map actions, abilities and items; End turn gives no count of who still has moves and never asks.
7. **No context line.** Nothing names what's near the selected hero (stairs here, chest two hexes away) without hovering.
8. Minor: `.hud-levels` buttons show a diamond for "heroes here" but nothing for "explored"; the log sits bottom-right with the same panel weight as the bar; the room labels are good (55% parchment); the title, camp and prepare screens are fine and are left alone except where the recruit flow needed the shot script fixed.

## Plan

- A. Stairs and lift: new models (level.ts), DOM level markers once explored (diorama), hover tooltip, "Take stairs ↓ Level 2" button from `reachable` (hud + src/ui/links.ts pure helper), hex pulse, click-own-hex. Headless test scripts/v32-stairs-walk.ts (tsx, engine only, asserts level 2).
- B. Objective beacons + goal box with location/click-to-pan; blocked options greyed with reason, flash on click; take preview text.
- C. Interactable hover: outline colour by kind + tooltip "Thing · interactions" for the 15.7 list.
- D. HUD: grouped bar with visible hotkeys, End turn count + single confirm, slimmer cards (pack icons + slot count, status badges), context hint line.
- E. Verify: tsc, stairs walk, stress bot, DOM assertions script, one before/after pair.

## Done
- scripts/v3-shot.mjs: hires two recruits after the tavern shot (V3.2 starts Hobart alone; the tour broke at "Take the job").

## In progress
- A.

## Contract requests
- None yet.

## Known issues
- None yet.
