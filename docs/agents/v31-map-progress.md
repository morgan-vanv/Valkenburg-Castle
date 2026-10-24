# V3.1 map progress

## Done
- shapes.ts: sketch.py shapes ported (jitter uses Python random tables). Parity vs sketch owner map: 0 mismatches on all 3 levels.
- regions.ts: the three levels' regions, mapped to game room ids.
- build.ts: LevelBuilder (regions -> tiles, walls, hand edits, props, railing, sconce/light helpers, rooms with label/material/tint).
- level1.ts / level2.ts / level3.ts: buildLevelN() with doors, cracked walls, stairs, lift, exits, sealed door, props, railings, lights.
- index.ts: castle (links, entrances, rival entrances, spawns, chests, coins, traps, braziers, sites, lights). parse.ts deleted.
- castle.test.ts: 14 tests, all pass. Full repo: tsc clean, 95 tests pass.

- scripts/v3-map-preview.ts: three per-level SVGs in sketch framing (docs/castle-preview/levelN.svg + .png), compared with mockup/shots: shapes match; tints adjusted so neighbours read apart.

## Status
- Brief complete. Nothing in progress.

## Fixes vs the sketch
- L1: tower passage extended by 1 hex (33,8) — it didn't reach the hall. Hall north bump split off as room 'dais' (rug).
- L2: archive hex (9,8) added so the officers' cracked wall (9,7) opens onto the archive. Collapsed floor (3,23) is a 1-hex pit over the Drain.
- L3: 38 bone-pile hexes added under L2 pit hexes the sketch left over rock, so every fall lands straight down. Collapsed-floor landing (3,23) added to the Drain. 1-hex pocket at the Lair tip (38,4) removed.
- Bone props on L3 only where no pit column ends (under the bridges).
- The Crossing's statue (L2 23,16) is under the L1 pit mouth: a fall there lands on the nearest bridge hex (engine fallback). Intentional.

## Contract requests
- none

## Known issues
- none
