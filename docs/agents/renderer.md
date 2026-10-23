# Brief: 3D diorama, interface and sound

You are building the presentation layer of a browser game demo: a low-poly 3D diorama in Three.js, an HTML overlay UI, and synthesized sound effects. The rules engine (src/engine/**) and the castle map (src/data/maps/**) are separate workstreams; you build against their interfaces.

## Read first

- docs/demo-spec.md — the demo's rules; section 8 says exactly what the presentation must do. Sections 2 and 4 say what the player can do and see.
- src/engine/types.ts — GameState, Expedition, Unit, LevelMap, CastleMap, Command, GameEvent and more.
- src/engine/api.ts — the `Engine` interface. `createEngine(map)` in src/engine/engine.ts implements it. src/engine/index.ts will export `engine = createEngine(classicCastle)` once the map exists; until then use `miniCastle()` from src/engine/test/miniCastle.ts.
- src/engine/geometry.ts — coordinates, edge keys, labels ("C-12"). Use these helpers.
- Game context: a roguelite extraction strategy game based on the 1980 board game Valkenburg Castle. Influences: For The King 2 (low-poly diorama, tiles, Focus), Ultrakill (dark, punchy), XCOM (squad tactics, shown odds). Tone: grim with dry humour.

## You own

src/render/**, src/ui/**, src/audio/**, src/main.ts, src/style.css, index.html, public/** and scripts/shot.mjs. Don't edit src/engine/** or src/data/**; note any API gaps in your final report. Don't commit or push. No npm dependencies beyond `three` (installed, with @types/three). For npm network: `source scripts/npmenv.sh`.

## Architecture

- src/main.ts boots the app. src/ui/app.ts holds the GameState and switches screens on `state.stage`: 'week', 'muster', 'expedition', 'debrief', 'won', 'lost'.
- Every change goes through `engine.apply(state, command)`. On success, keep the new state, autosave with `engine.serialize` to localStorage, and play its `events` in order, blocking input meanwhile. On `error`, show the sentence briefly and keep the old state.
- On load, resume a saved game; otherwise offer "New campaign" with an optional seed.
- Events drive all animation. A castle phase arrives as one batch after `endTurn`: phase(castle) … phase(player). Event player with a speed setting.
- Rendering code separate from UI code: the 3D layer exposes `showLevel`, `syncUnits(state)`, `highlightSquares`, `playEvent(event)` and pick callbacks.

## 3D view (spec 8.1)

- One square = 1 world unit; levels stacked ~8 units apart; one level shown at a time with level buttons and auto-follow; levels above hidden.
- From each LevelMap: low-poly floor tiles (slight height/tint jitter, flat shading), walls as boxes on 'wall' edges (~1.4 high), rock as dark blocks, door slabs that swing open, a padlock on locked doors, stepped stairs on linked squares, a ladder model, the Pit as a dark shaft. InstancedMesh or merged geometry.
- Lighting: near-black ambient; a warm flickering PointLight per player unit (max 8, pooled); faint cold rim light.
- Fog of war from `engine.visibility(state)`: visible lit; explored dim and desaturated; unexplored hidden. Enemies drawn only when visible; contacts as pulsing red "?" markers.
- Units: low-poly figures. A squad shows one figure per man (up to 10) that topple and fade as men die. Heroes are larger with banners (Hobart gold, Rogier blue, Thorvold bronze, Pim green, Aldous violet). Orcs dark green with red eyes. Monsters: troll, ogre, berserker, mantis, spider, drog (dog-frog), banshee, dragon — simple distinct silhouettes. Units sharing a square fan out. Selection ring.
- Camera: tilted three-quarter; orbit (right drag, Q/E), pan (middle drag, WASD/arrows), zoom (wheel), smooth follow.

## Interface (spec 8.2)

- Unit card, roster strip (Tab cycles), hover highlight with square label, reachable squares with path and cost on hover, click to move.
- Action bar from `engine.actions(state, unitId)` with hotkeys; pickers for door, chest and spell methods and targets.
- Attack preview from `engine.previewAttack`: frontage, slots, hit chance, every modifier, Focus +/−, expected wounds, Confirm.
- Dice: slots flip to hit or miss one after another; Focus-locked slots glow; a Perfect gets a slow-motion beat.
- Alarm meter with tier bands and a pulse on tier change; turn counter; phase banner; End Turn (Enter); event log.
- Campaign screens: Week (gold, goal, week x of 4, wages paid `state.lastWages`, barracks, heroes, hire, Begin muster, Skip week), Muster (form squads with men and armour, tick heroes, entrance per unit; ≤6 units, ≤30 men, squads 3–10; Launch; `cancelMuster` to go back), Debrief (`state.lastDebrief`), Won and Lost (`state.endReason`, New campaign).

## Game feel and sound (spec 8.3, 8.4)

Hit-stop 60–120 ms, shake scaled to wounds, slamming damage numbers, falling figures, door splinters, explosion flash, red vignette pulse on Alarm tier change, a reduce-shake/flash setting. src/audio/sfx.ts: WebAudio-synthesized footsteps, door creak and slam, lock-pick clicks, smash and chop, sword hit, arrow, death, dice, Perfect sting, alarm horn, coins, explosion; start on first gesture; mute toggle remembered.

## Look

Dark stone, warm ember light (#e8a33d-ish), parchment text (#efe4cf-ish), hard red for danger and the Alarm. Serif display face plus monospace for coordinates and numbers. Sharp-edged translucent dark panels. Desktop 1280×720 and up; touch-sized buttons. Nods to 1980: "C-12" labels, counter-style badges.

## Checking your work

Headless Chromium with WebGL works: playwright at /home/claude/.npm-global/lib/node_modules/playwright/index.mjs, launch args `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`. Start the server and take shots in the same command (background processes die after a few minutes), e.g. `npx vite build && (npx vite preview --port 4173 & sleep 3; node scripts/shot.mjs http://localhost:4173/ out.png; kill %1)`. Script clicks and keys to reach each screen and an attack. Look at every screenshot and check the console.

## Done means

`npx tsc --noEmit` and `npx vite build` pass; every screen and the expedition view render with no console errors; screenshots of week, muster, expedition (lit and fogged), attack preview and dice. Report files written, how to switch engines and maps, API gaps, known gaps and screenshot paths.
