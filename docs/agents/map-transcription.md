# Brief: transcribe the classic castle map

You are transcribing levels 1, 2 and 3 of the 1980 board game "Valkenburg Castle" map into data for a browser game. Accuracy matters: this map is what the player will walk around in.

## Project context

- Repo: /home/claude/valkenburg-castle (Vite + TypeScript 7 + Vitest 5). Do NOT commit or push; the lead will commit. Do NOT edit files outside the paths listed under "You own".
- Read these first: docs/archive/demo-spec.md (sections 3.1, 6.1, 6.5), src/engine/types.ts (LevelMap, CastleMap, LevelLink, Coord, CellKind, EdgeKind), src/engine/geometry.ts (edge indexing, COLUMN_LETTERS, at()).
- Rules: game data must be plain TypeScript with no DOM access. Keep dependencies at zero.
- npm with network: `source scripts/npmenv.sh` first. `npx tsc` and `npx vitest run` work offline.

## Source images

The 1980 map sheets and manual are project files, attached to the session under /mnt/user-data/attachments/<id>/:

- `…Game_Map_Pages.pdf` — 4 scanned pages, the clearest source. Page 1 = Level 1, page 2 = Level 2, page 3 = Level 3, page 4 = Levels 4 and 5 (ignore). The pages are scanned ROTATED: column letters run along the top, row numbers 1–12 run down the left with the digits printed sideways. Check orientation before transcribing.
- `…Game_Map_Full.pdf` — a photo of the whole sheet, upright. Use it to cross-check orientation.
- `…Game_Manual.pdf` — rules. Sections 2.41 (terrain chart), 4.4–4.6, 4.9, 5.11, 5.383, 8.6 and 9.1 describe the map. Known facts: C-12 on level 1 is a stairway to level 2; level 1 has stairs at F-4 to level 2 (rule 4.52 walks G-4 → F-4 on level 2 and up); level 1 entrances are H-1, A-7 and F-12; the level 3 cavern mouth is U-5 to U-8; level 1 balcony squares include J-5 and K-3; the Dragon's lair is S-7 with its hoard in U-1 and U-2; on level 3 the dragon can never enter P-6, T-2 or P-10.
- Rasterize pages at high resolution, crop, rotate upright and zoom to inspect them (Python with whatever PDF tooling is installed). Use the Read tool on PNGs to look at them.

## Map symbols (1980)

- Thick black lines = walls. Solid black regions = rock (CellKind 'rock').
- Dotted lines = open boundaries inside a room or corridor (EdgeKind 'open').
- Red square on a wall line = door ('door'). Red square with two asterisks = locked door ('locked').
- "G" = guardroom. Arrows with a number = stairs to that level (black = down, white = up). "X—X TO n" = ladder to level n.
- The PIT on level 1: pit squares are 'pit' cells (no floor); the ring of floor around it is the balcony. On level 2 the PIT squares are 'pit'. On level 3 the pit area is an ordinary walled room with floor.
- Columns: levels 1 and 2 run A–P (x0 = 0, width 16). Level 3 runs F–U (x0 = 5, width 16). All have 12 rows. Coordinates use global letters so stairs, ladders and the Pit line up between levels.

## Deliverables (You own: src/data/maps/**, scripts/preview-map.*)

1. **A text format and parser**, src/data/maps/parse.ts, exporting `parseLevel(spec): LevelMap`. Each level is an ASCII grid of (2·height+1) lines × (2·width+1) characters:
   - Even lines are horizontal edge lines. Even columns = corners ('+', ignored). Odd column 2c+1 = the edge above cell c of the next row: '-' wall, ' ' open, 'd' door, 'L' locked.
   - Odd lines (2r+1) are cell rows. Even column 2c = the vertical edge left of cell c: '|' wall, ' ' open, 'd' door, 'L' locked. Odd column 2c+1 = the cell: '.' floor, '#' rock, 'p' pit; markers that also mean floor: 'G' guardroom, 'S' stairs, 'X' ladder, 'E' entrance, 'C' prison cell, 'B' balcony, 'D' dragon lair, 'H' hoard.
   - The spec also carries id, name, x0, width, height and the feature lists (entrances, guardrooms, prisonCells, balcony, reinforcementPoints, lair, hoard) as labels like "H-1". Describe the format in src/data/maps/README.md.
   - The parser validates line counts and lengths, outer walls, walls around rock, and markers against feature lists, throwing a clear error naming the line and column.
2. **The data**, src/data/maps/classic.ts, exporting `classicCastle: CastleMap` (levels 1–3 plus `links` for every stairs and ladder pair). Stairs from levels 2 and 3 down to level 4 are `reinforcementPoints` (no link). Link ends must be floor at the same letter and row unless the map clearly shows otherwise.
3. **Tests**, src/data/maps/classic.test.ts: parser round-trip and rejection; 3 levels of the right sizes; link ends are floor; the known facts above; every floor square reachable from an entrance through open, door or locked edges and links (list genuinely unreachable squares in the README and exclude them by label).
4. **A visual check**, scripts/preview-map.mjs (or .ts via `npx tsx`): render each level to SVG/PNG in the original's visual language, into the scratch folder. Compare with the scan crop by crop and fix differences; at least two full passes per level.

## Done means

`npx tsc --noEmit` and `npx vitest run src/data/maps` pass, and the renders match the scans. Report the files written, uncertain squares or doors (by label), unreachable areas, and preview paths.
