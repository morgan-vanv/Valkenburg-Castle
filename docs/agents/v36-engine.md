# Brief: V3.6 engine

Read docs/agents/v36-common.md, then docs/v3-spec.md section 19. You own src/game/** (not the contract files) and src/data/castle/**.

1. **19.1 story sites:** add the four story sites to src/data/castle/index.ts (`story` set) in the named rooms, on floor hexes clear of spawns and existing sites; `makeBoard` never uses `story` sites for regular contracts; STORIES point at them with the new briefs (one sentence of reason each; keep them short and in the game's voice); castle.test covers reachability and the story-only rule. For Gerda in the Forge: put her inside the forge room; if the forge's door is locked in data, leave it locked (the Burglar/smash/charge path is part of the story) but make sure the regular path to the copper doesn't depend on it.
2. **19.2 locks:** Pick for non-Burglars only while carrying `lockpicks` (2 Finesse slots, Burglar outcome table on 2 slots); lockpicks item in SHOP (25, needs smith, reusable: not consumed); blocked-option text for a locked thing without Pick. Tests.
3. **19.3 night-eye:** `nightsight` item (30, peddler, always), `nightsight` action (drink, silent), `nightEyes` countdown; sight range and roll penalty exceptions in world.ts/common.ts; the Gloam and monster noticing unchanged. Tests, including "Gloam still strikes a night-eyed unlit hero" and "sight 6 unlit on L3 with night-eye".
4. **19.4 movement:** hired crew members don't block hero paths (`blocksHero`). Test.
5. Update the sim if trivial (buy lockpicks when the smith is home). Keep vitest green.
