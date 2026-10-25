# V3.2 clarity progress

Status: 2026-10-24, done. Steps A–D are in; verified by tsc (0 errors), scripts/v32-stairs-walk.ts (PASS), scripts/v32-clarity-check.mjs (15/15, 0 console errors), scripts/v3-stress.mjs 2 delves (0 errors), scripts/v3-shot.mjs full and fixture tours (0 errors). Owner instruction (via the coordinator): screenshot testing is expensive. At most 4 targeted screenshots for the critique, cheap checks first (tsc, headless stairs walk asserting the level, stress bot, DOM assertions), one before/after pair for the report.

Before shots (taken once with scripts/v3-shot.mjs on a static build, seed 1980, before the owner's instruction arrived): /tmp/claude-0/-home-claude/692da2aa-d3ab-5f2c-8721-44a0aca79867/scratchpad/shots-before/ (00-title … 15-after). Looked at 00, 03, 04, 05 plus the owner's docs/agents/v32-los-bug.png. The rest of the critique is from reading src/ui/hud.ts, src/view/diorama.ts, src/view/level.ts and src/style.css. After shot (the one pair): …/scratchpad/shots-after/stairs-hud.png (Hobart on the tower stair; before = shots-before/05-delve.png).

## Critique (ranked; fixed in this order)

1. **Stairs are invisible as an action.** Stairs were a flat dark disc with 5 small steps sunk into it; from the default camera they read as a dark hex. No marker said where they go. `reachable` includes the other level's hex, but it's on a level not shown, so no highlight, no button, no tooltip ("Stairs" only). Click-own-hex did nothing. The lift read better (posts, ropes) but said nothing about the winch until hovered.
2. **Take failed silently.** `renderBar` drew `ActionOption.blocked` options like any other; clicking sent the command, the engine refused, and the only feedback was the error toast from app.ts. The hex tooltip listed the items but never said take was blocked.
3. **The goal box was status, not location.** "Find it and carry it out." The contract brief ("…lies in the chapel altar") was shown on the prepare screen and then forgotten. Once the objective hex was explored nothing on the map marked it.
4. **Hover was uniform.** Every hex got the same parchment ring; a door, a chest, a cold brazier and plain floor looked the same under the pointer. Tooltips described ("Closed door", "Chest") but named the interaction only when an action option existed, so things out of reach never said what they were for.
5. **Hero cards were the loudest thing on screen** (286 px, 4 rows each): Focus pips, 4 pack boxes, and Move/Act chips that repeated the bar's "MOVE READY · ACTION READY" and the card's dimming when done.
6. **The action bar was flat.** Walk/Sneak, every action, and End turn in one row at one weight; hotkeys 0.56rem corner labels; no grouping; End turn gave no count and never asked.
7. **No context line.** Nothing named what's near the selected hero without hovering.
8. Minor, left alone: the title, camp and prepare screens are fine; the room labels are good; the log is fine where it is.

## Done

- **A. Stairs and lift** (spec 15.7 paragraphs 1–2)
  - src/view/links.ts (new, pure): `linkAt`, `linkEnds`, `linkReach` (the `reachable` entry whose `to.level` differs and whose path is 1 step), `linkMarker` ("↓ L2", "Lift ↓ L3"), `linkButton` ("Take stairs ↓ Level 2"), `linkTooltip`, `levelPhrase`.
  - src/view/level.ts: stairs rebuilt (down: six pale treads with dark risers sinking into a black opening between two parapets, black mouth at the foot; up: a rising flight to a dark doorway with a lintel), oriented into the wall with the most solid neighbours. Lift rebuilt as an iron cage (corner posts, bars on three sides, open front toward the open side, roof frame, braces, chain ring) with an alternating-link chain up to a beam, pulley and gallows legs on the upper end, up into the dark on the lower.
  - src/view/diorama.ts: `.link-tag` DOM markers over every stairs/lift end on the shown level once explored (lift greyed "· needs the winch" until `liftWorking`); `showLinkPulse(at)` pulsing blue ring on the hex the selected hero stands on; cleared by `clearHighlights`.
  - src/ui/hud.ts: `linkHere()` / `takeLink()`; the Move group gets a prominent `.act.act-link` button (hotkey T, takes precedence over Torch's T on that hex); click your own hex or your own figure takes them; hover on the stairs/lift says "Stairs · down to the Crossing. Stand on them, then Take stairs." and "Click: Take stairs ↓ Level 2".
  - scripts/v32-stairs-walk.ts (headless, engine only): `npx tsx scripts/v32-stairs-walk.ts [seed]` walks Hobart from the main gate to the tower stair with the same helper and asserts Level 2. PASS on seed 1980 (round 5).
- **B. Objectives and blocked take** (paragraphs 3–4)
  - diorama `objectiveAt()` (heirloom pile / unfreed prisoner / living Dragon, only once explored), `refreshBeacon()`: additive light pillar (7 high), pulsing hex ring, glow sprite, and a `.beacon-tag` diamond + name in the contract colour (recover gold, rescue green, slay red).
  - hud goal box: before the hex is explored shows the contract brief in italics; after, a clickable "◆ The Hobart Warhorn · Level 1, the Chapel · seen/in sight" line that pans the camera there.
  - Blocked options: drawn with `.act.blocked` (greyed, dashed, red strike), `aria-disabled`, the reason as a hover bubble (`.act-why`) and in `title`; clicking (button or hex) calls `flashBlocked`: toast + floating warning at the target + shake. Hex tooltip shows "Take: <reason>" in red instead of "Click: Take". The engine's take preview already lists what will be taken.
- **C. Hover tooltips** (paragraph 5): `describeHex` rewritten as "**Thing** · what you can do" for doors (open/closed/locked/jammed), braziers, winch, lift, stairs, exits ("Way out · Leave the castle"), pits ("Pit · Jump or Rope" + fall words), cracked walls, rubble, the sealed door, chests (open/locked/jammed/empty), ground loot ("Loot · Take" + items), spotted traps. Unexplored hexes get no tooltip. `hoverKind()` → `dio.setHoverStyle()`: the hover ring turns ember on interactables, red on pits/traps, parchment on floor.
- **D. HUD hierarchy** (paragraph 6)
  - Bar grouped Move · Interact · Abilities · Items · End turn with small group names, visible ember hotkeys; `ABILITIES` set (guard, rally, overwatch, knockback, dig) joins the spells in Abilities; items by `ITEM_ACTIONS`.
  - End turn shows "N still waiting" / "all spent" and asks once (modal: who, and whether it's their move or action) when anyone has something left; `Settings.noEndTurnAsk` (menu checkbox "Ask before ending a turn with moves left", on by default) turns the question off. Scripts set it off via localStorage `vc.settings`.
  - Hero cards (262 px): turn state as two small marks (diamond = move, dot = action) in the name row with a title; Focus/Mana pips without labels (title text instead); pack as item icons + "n/4" count (empty boxes gone); statuses as badges only when present (Edge, Webbed, Veiled n, Warded n, Overwatch, Torch n, Guarding, Escorting, Rally in n, Downed/Out/Dead).
  - `.hud-hint` context line above the bar: up to four explored things within 4 hexes of the selected hero ("Stairs ↓ L2 here · Chest 2 hexes north-east"), each a click-to-look button; compass in world space.
- scripts/v32-clarity-check.mjs (new): `node scripts/v32-clarity-check.mjs <base> [seed]` drives the real UI headless and asserts 15 things by DOM (goal brief, stairs button/hotkey/hint/marker/tooltip, click puts Hobart on L2 and the view follows, blocked take greyed with reason + flash, beacon tag, goal location). `SHOT=<png>` takes the one allowed screenshot. All pass, 0 console errors.
- scripts/v3-shot.mjs: hires two recruits after the tavern shot (V3.2 starts Hobart alone; the tour broke at "Take the job").
- CSS: new block "V3.2 clarity (spec 15.7)" at the end of src/style.css.

- scripts/v3-stress.mjs: hires a recruit in camp while `partyProblem` says the party is too small (V3.2), so the bot can start delves again.
- Link marker rises 1.4 above a figure standing on the hex (so it doesn't sit on the HP tag). "Take stairs" as a dash (after a move, action free) shows a small "dash" tag and says so in the title. Menu key help lists T.

## Before / after (one pair, same moment: start of the delve, seed 1980, 1440x900)
- Before: /tmp/claude-0/-home-claude/692da2aa-d3ab-5f2c-8721-44a0aca79867/scratchpad/shots-before/05-delve.png
- After: /tmp/claude-0/-home-claude/692da2aa-d3ab-5f2c-8721-44a0aca79867/scratchpad/shots-tour/05-delve.png
- Plus the one critique shot of the new state: …/scratchpad/shots-after/stairs-hud.png (Hobart on the tower stair: marker, pulsing hex, "Take stairs ↓ Level 2" button, hint line, goal location, slim cards).

## Decisions (for docs/decisions.md, which isn't in my paths; the lead may copy)
- 2026-10-24: Take stairs/lift is hotkey T and wins over Torch's T on that hex (no free letter left; torch is rare while standing on stairs).
- 2026-10-24: End turn asks once when any hero still has a move or action; a settings checkbox turns it off. Scripts turn it off through `vc.settings.noEndTurnAsk`.
- 2026-10-24: Interactable hover = ember ring; hazard (pit, trap) = red ring; floor = parchment. Tooltip form is "Thing · what you can do".
- 2026-10-24: Beacon colours by contract: recover gold, rescue green, slay red (diorama BEACON_COLOR and .beacon-tag CSS).

## Next (if wanted)
- Compass in the hint line follows world north; rotate it with the camera yaw.
- The lift cage is ~45 small meshes per end; fine for two lifts, batch it if more are added.
- The sealed door and cracked walls have tooltips but no hover model change; a faint crack glow on hover would finish the set.

## Contract requests
- None. `ActionOption.blocked` as published is enough.

## Known issues
- The hint's compass is world-north; after rotating the camera with [ ] it won't match the screen.
