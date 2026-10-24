# Brief: V3 diorama, interface and sound

Read docs/agents/v3-common.md first.

You own src/view/** (new: the 3D layer), src/ui/** (replace the V2 UI), src/audio/**, src/main.ts, src/style.css, index.html, public/**. Build the whole presentation for V3 against the engine API (src/game/api.ts). Game title: "Valkenburg Castle: Hobart's Revenge".

## Engine availability

The engine agent is writing `createEngine` in parallel. Until `src/game/index.ts` exports `engine`, build the view against `testCastle` from src/game/test/testCastle.ts (appears early) and hand-made GameState fixtures in src/view/fixtures.ts. When `src/game/index.ts` exists, switch src/main.ts to it. Check every so often. The real castle (src/data/castle) arrives the same way through the engine.

## Look (GDD pillars: readable, fast, shows the odds)

- Low-poly 3D diorama in Three.js (For the King 2 feel): one hex = a short hex prism tile, flat shading, slight tint/height jitter; walls as taller hex prisms in stone grey; pillars as columns; rubble as small rock clumps; doors as slabs that swing; locked doors with a padlock; pits as dark holes with a faint glow far below; stairs as stepped wedges; exits as a lit archway/marker; braziers as bowls that burn when lit; raised floor drawn higher; chests, coin piles, ground loot, traps (only when spotted), prisoner in shackles, heirloom glinting.
- Reuse what helps from the V2 renderer (src/render/camera.ts is already a rotatable camera rig: right-drag/Q-E orbit, pan, zoom; src/render/figures.ts has low-poly figure builders; src/audio/sfx.ts has synth sounds). Copy into src/view rather than importing src/render, which will be deleted.
- **Rotatable camera** (owner's choice): orbit, pan, zoom, smooth follow of the selected hero, snap buttons (rotate 60°).
- One level shown at a time: the selected hero's level, with level buttons; the level above hidden.
- **Light is the star**: near-black ambient; warm light around the lantern bearer sized by brightness; smaller lights for torches and lit braziers; unlit hexes dark. Fog of war from `engine.visibility`: visible = lit normally, explored = dim and desaturated, unexplored = hidden. Monsters and rivals drawn only when visible. The Gloam: a shape of darkness with two pale eyes.
- Distinct silhouettes per hero class and monster kind, readable at a glance; selection ring; HP pips over units.

## Interface

- **Title**: Continue (if a save exists), New campaign (optional seed).
- **Camp**: one screen of stations (clickable tents or a clean panel layout): Bounty board (3 contract cards with level, bounty, warnings), Quartermaster (shop), Smithy (tiers per hero), Tavern (recruits), Infirmary (wounded heroes, heal), Stash (gold, items, sell all), Memorial (fallen). Then **Prepare delve**: pick contract, 1 to 4 fit heroes, give each up to 4 stash items, pick entrance → `startDelve`. Show Hobart's warning ("If Hobart dies, it's over") when he's picked. Fast path: a "Last loadout" button.
- **Delve HUD**: always visible: light meter with stage name (Bright/Dim/Dark/Pitch black) and rounds left, hero cards (portrait/class icon, HP, Focus pips, pack slots, status), contract goal, round number, End turn button. Selected hero: reachable hexes highlighted (Walk and Sneak toggle), path preview on hover, noise ripple preview (`moveNoise`, `preview().noise`) drawn on the map before committing, action bar built from `engine.actions` (only valid actions), clicking an enemy/door/chest/ally picks the matching action.
- **Roll preview** (the key UX, For the King style): before any rolling action, a panel shows N slot boxes, chance per slot, modifiers in plain words, Focus to spend (+/−, locks slots), outcome per number of hits from `preview().outcomes`, noise. Confirm with a click or Enter. The roll then animates slot by slot (fast).
- **Enemy intents**: an icon over each visible awake monster (sword = attack with target line and damage range, foot = move, web, hand = steal, flee) from `engine.intents`.
- Rival crew: name, stance and goal shown once spotted; Bribe shows in the action bar when available.
- Event log (short lines), floating damage numbers, camera shake on big hits.
- **Summary screen** after a delve: contract done or not, bounty, loot value, survivors/wounded/dead, XP and level-ups, notes; Back to camp. **Game over** screen when Hobart dies.
- **Speed (pillar 2)**: event playback speed setting incl. instant; hold Space to fast-forward the world phase; click-to-walk; keyboard: 1–4 select hero, Tab next hero, S toggle sneak, E end turn, Esc cancel; undo is not needed.
- Autosave every applied command to localStorage key `vc.save.v3` via `engine.serialize`; resume on load. Ignore older saves.
- Sound: reuse/adapt sfx (steps, hits, door, lock pick, chest, coins, fire, torch, Gloam drone, level-up). Mute toggle.

## Architecture

- src/main.ts boots `new App(root, engine)` (src/ui/app.ts). The App holds the GameState, sends every command through `engine.apply`, keeps the new state on success, autosaves, and plays events in order while input is blocked. On `error`, flash the sentence and keep the old state.
- src/view exposes a class (e.g. `Diorama`) with `setCastle(def)`, `sync(state, visibility)`, `showLevel(n)`, `highlight(hexes, style)`, `showPath`, `showRipple`, `showIntents`, `playEvent(ev): Promise<void>`, pick callbacks for hover/click on hexes and units.
- Screenshots: scripts/shot.mjs takes headless screenshots (see how it works; adapt it to V3 as scripts/v3-shot.mjs). Look at your work in screenshots, desktop 1440×900, and iterate.
