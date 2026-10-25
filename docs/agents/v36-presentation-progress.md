# V3.6 presentation progress

Status: 2026-10-25, done. Spec 19.5 (exits), 19.2/19.3 names and help, 19.1 briefs. Verified on the fixture engine and the real engine (see How tested).

## Done

- **src/view/links.ts** (pure): `exitName` (room id gate/gate-pass → the main gate, sally → the sally port, breach → the east breach, Level 3 → the cave mouth, else the room), `exitList`, `exitAt`, `exitMarker` ("Way out" / "Way out · you came in here"), `exitTooltip`, `prizeInHand` (heirloom in an active pack, prisoner freed and following, or the Dragon dead), `nearestExit` (same level by hex distance, else the entrance or a known exit on another level), `exitWhere` ("the main gate, 14 hexes").
- **src/view/diorama.ts**: `.link-tag.exit-tag` markers over every exit once explored (entrance: `.entrance`, "you came in here"); `setEntrance(pos)`; `showExitPulse(at)` (pale blue, same animation as the stairs pulse); `refreshExitRings()`: once `prizeInHand`, known exits on the shown level get soft pulsing rings and their tags get `.go` (gold).
- **src/view/level.ts** `addExit`: a doorway: two posts with feet, lintel and cap along the wall axis, a sheet of daylight and a fainter haze facing the outside (the side with fewer open hexes), a pale threshold slab, the glowing hex ring, the arrow pointing out.
- **src/ui/hud.ts**: `exitHere()` / `leaveHere()`; Move group gets `.act.act-leave` "Leave the castle" (hotkey Q, `free` tag, blocked reason as `.act-why`) and the plain Leave option is dropped from Interact; the hex pulses; own-hex/own-figure click leaves; hover says "Click: Leave the castle"; exit tooltip "Way out · stand here, then Leave the castle (you came in here)"; goal box switches to "⇱ Get out: nearest way out is the main gate, 14 hexes" (click pans, `data-exit`) with `.goal-go`; context hint names exits ("Way out (you came in here)") and, with the prize in hand, leads with the nearest known exit however far; 19.2 locked text: "Locked door · Smash it or Charge, or a Burglar or lockpicks could pick it" for a hero without Pick (Burglar or lockpicks in the pack → "Pick, Smash or Charge"); 19.3 chip `◉ Night-eye · n` (`.chip.night`) with tooltip; the "In the dark" chip says the draught keeps sight and rolls; `nightsight` in the Items group; menu key help lists Q.
- **src/ui/names.ts**: `nightsight` glyph/help/key (N), lockpicks and night-eye in ITEM_HELP / ITEM_EFFECT / ITEM_GLYPH / itemBase; Pick help and the Burglar kit mention lockpicks; STORY.where per 19.1 (chapel, kitchens, forge, barracks, Drain); `aleNeeds` copper → barracks.
- **src/ui/screens.ts**: the Lowgate panel row tooltip carries the pinned story contract's `brief` (the engine's one-line reason); story cards already show `brief` and `warnings`.
- **src/ui/app.ts**: `HudHost.entrance()` and `dio.setEntrance()` from the saved loadout's `entrance` index (main gate when unknown).
- **src/view/fixtures.ts**: lockpicks (needs smith) and night-eye in the shop; `leave` offered on an exit (free, even after acting); `nightsight` action (nightEyes = 8, counts down at end turn); Pim carries lockpicks, Keven a draught, Brann has Night-eye 5; story briefs are the 19.1 sentences and site ids.
- **src/style.css**: block "V3.6 play-test fixes (spec 19)".

- **hud-hint**: pinned just above the bar's real height (`bar.offsetHeight + 22`); before, a stacked Interact group hid it (visible in the before shot too).

## How tested

- `npx tsc --noEmit` clean (whole repo), `npx vitest run` green (191).
- `node scripts/v36-ui-check.mjs http://localhost:5183/?fixture=1` and `... http://localhost:5183/` (real engine): 32 / 31 DOM checks, all pass, 0 console errors. Covers: Lowgate panel rows and story card carry the engine's brief; peddler lockpicks (locked without the smith) and night-eye text; "Way out · you came in here" marker over the explored entrance; exit hover text; standing on it: `.act-leave` in the Move group with Q, no duplicate Leave, pulse on, "Click: Leave the castle", hint "Way out here"; heirloom in the pack: goal "⇱ Get out: nearest way out is the main gate, here" as a pan button with `data-exit`, tags `.go`, exit rings; 5 hexes away: "5 hexes" and the hint leads with the way out; 19.2 locked hover for a hero without picks vs one carrying lockpicks; night-eye chip, pack tooltip, Items-group button, drinking → 8; Q leaves (status out).
- `node scripts/v3-stress.mjs http://localhost:5183/ 2`: 0 errors.
- One shot pair (`node scripts/v36-ui-shot.mjs <base> <png>`, Keven on the main gate with the heirloom, real engine, seed 42): docs/agents/v36-shots/exit-before.png (main) and exit-after.png (v3.6).

## Contract requests

- `Delve.entrance?: Pos` (or the index): the engine knows which entrance `startDelve` used; the UI currently reads the saved loadout, which is right in practice but not state.

## Known issues

- `nearestExit` uses hex distance on the hero's level, not path length; on Level 2 (no exits) it names the entrance or a known exit on another level without a count ("the main gate (Level 1, up)").
- The exit doorway faces the side with fewer open neighbours; on an exit at a corridor's end that is right, on an odd shape it could face the wrong way (the test castle's east exit looks fine in the checks, not inspected by eye).
- Hotkey N is shared by Night-eye draught and Pass lantern (first in bar order wins; the other gets no key), like other shared letters.
