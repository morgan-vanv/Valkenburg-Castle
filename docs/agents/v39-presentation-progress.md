# V3.9 presentation: progress

Status: built and checked against the fixture and the engine's in-tree V3.9 work (2026-10-25).

## Done
- **stealth.ts** (pure, tested in stealth.test.ts): `frontDirs`, `inFrontHalf`, `inRearHalf`, `rearNeighbours`, `dirToward`, `pathEndFacing`, `backExposed`, `unawareOf`, `backstabFrom`, `wasBackstab`, `backstabSpots`.
- **Hero facing wedges** (diorama `refreshFacing`): a small wedge in the class colour under every active hero; enemy wedges unchanged. Figures turn to `facing` on sync and on `faced`.
- **Face (F)**: key F or the Face button in the Move group; hover shows the wedge and "Face north-east · free"; click any hex (neighbour or far) sends `face`; Esc / right-click cancels. Firebolt's key moved to V, Dread's to K (F is Face).
- **Move preview** ends with an ember wedge showing the facing the move leaves (`showPath(path, endFacing)`), turn-based and free-move paths.
- **Back exposed**: a "◐ Back exposed" chip on the hero card (and a line in the hero hover) when the hex behind the hero (or a back flank, when that is wall) is standable, not visible and not occupied by a hero. Tooltip `FACING_HELP.backExposed`.
- **Removed**: the sneaking blind-arc wash and "sneak up here" tags; the free-swing confirm (`moveAlong` moves at once; the red sword stays).
- **Rear half on hover**: hovering a seen awake enemy (or non-hired crew member) washes its rear half faintly (3 hexes deep, walls stop it).
- **Backstab daggers**: with a Burglar selected (action unused), 🗡 tags and rings on the rear-neighbour hexes of seen (`engine.seenEnemies`), visible, unaware enemies that the Burglar stands on or can reach; hover line "Backstab from here".
- **Risk tags**: `showRisks` skips any enemy not shown/visible (24.4), on top of the engine's filter.
- **unseenHit**: a red dart flies in from the hero's back, flash, shake, "From behind!" floater, sound; log line only if the engine didn't `say` it. Camera pans to the hero in the world phase.
- **Backstab**: detected from the roll (`what` matching /backstab/) or from the pre-command state (`wasBackstab`); a pale crescent slash, cold flash, longer hit-stop, "Backstab!" floater, log "Pim backstabs the orc: 8" (unless the engine says it).
- **Tooltips/help** (names.ts `V39`, `FACING_HELP`, live numbers via `liveNum`): Face, back exposed, blindsided, backstab, quietest feet (on the Burglar's Sneak button), rear half; awareness and walk/sneak texts rewritten for front/rear halves; Burglar kit; menu keys list F.
- **Fixture engine**: hero facing (into the castle, Aldous facing back), `face`/`faced`, facing after moves and attacks, front-half visibility, `seenEnemies`, risks filtered to seen enemies, backstab preview/roll/double damage, adjacent awake monsters strike in the world phase (blindsided +1, `unseenHit` + say when unseen).

## Checks
- `npx tsc --noEmit`: 0 errors in my paths.
- `npx vitest run src/view/stealth.test.ts`: 11 passed.
- `node scripts/v39-ui-check.mjs 'http://localhost:5186/?fixture=1'` and `'http://localhost:5186/'`: all passed, 0 console errors.
- Older checks (port 5186): v34-hud, v35, v36, v37 pass on fixture and real; v34-camp and v371 pass on the real engine (their fixture runs fail on camp-economy lines, pre-existing, not V3.9). v37 updated: no blind-arc wash, no swing confirm, crew scene keeps the lead active/lit so 24.2 intents show.
- Stress bot (`scripts/v3-stress.mjs`, 3 delves, real engine): 0 errors.
- Shot: docs/agents/v39-shots/v39-facing.png (hero wedges in class colours, two backstab daggers behind a sleeping orc).

## Contract requests
- A backstab marker on the event (e.g. `roll.what` "Backstab" or `hit.backstab: true`) so the view needn't infer it from the state; and an engine `say` line "Pim backstabs the orc: 8" so it stays in the delve log (the HUD's live line gives way to the log after playback).
- `noticedIds` on `Monster` in types.ts (the view reads it untyped for "unaware").

## Known issues
- v34-camp-check on `?fixture=1` fails two camp-economy lines (fixture campaign data, unrelated to V3.9); passes on the real engine.
