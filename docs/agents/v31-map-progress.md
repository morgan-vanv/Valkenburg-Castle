# V3.1 map progress

## Done
- src/data/castle/shapes.ts: sketch.py shapes ported (ellipse with Python-random jitter tables, rect, line, union, minus). Parity vs the sketch owner map: 0 mismatches on all three levels.
- src/data/castle/regions.ts: the three levels' regions transcribed, mapped to game room ids.
- src/data/castle/build.ts: LevelBuilder (regions -> tiles; walls around non-pit tiles in finish(); set/floor/clear/prop/props/railing; rooms get label (centroid by default), material, tint).
- Scratch helpers (not in repo): /tmp/claude-0/-home-claude/692da2aa-d3ab-5f2c-8721-44a0aca79867/scratchpad/tools (owners.py, parity.ts, bare.ts grid printer, comps.ts, q.ts). Snapshot with SCRATCH=<that dir> to keep them.

## File state
- level1.ts / level2.ts / parse.ts: still the OLD V3 two-level files; to be replaced by level1/2/3.ts built with LevelBuilder. index.ts still old (has a 'pit' link -> does not typecheck). castle.test.ts old.

## Next (in order)
1. level1.ts, level2.ts, level3.ts with LevelBuilder (doors, cracked, stairs, lift, exits, sealed, props, railings, rooms).
2. index.ts: links (stairs L1/L2 (37,3); lift L2/L3 (24,27) with winch), entrances, spawns, loot, traps, sites, lights, braziers. Delete parse.ts once unused.
3. castle.test.ts rewrite per brief item 11.
4. scripts/v3-map-preview.ts for 3 levels; render with scripts/v3-map-svg2png.mjs; compare with mockup/shots.

## Findings on the raw sketch
- L1 tower stair is disconnected (tower-hall line doesn't reach the hall): needs a fix.
- L2 pit: 38 pit hexes have no L3 floor below (edge of the bone pile): need L3 floor added under them, or the engine's "nearest walkable within 3" fallback.
- Dead pockets: L1 sally (1,14) and breach (44,21) are the exit hexes (fine); L2 broken bridge end (25,19) is intended; L2 rim ends (19,21),(30,21); L3 lair tip (38,4).

## Contract requests
- none

## Known issues
- none yet
