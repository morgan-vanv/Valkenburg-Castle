# V3 map progress

## Done
- src/data/castle/parse.ts: format (tile grid + room-letter grid, odd-r offset), legend, `parseLevel`, `at`, `pitEdge`, `pitFootprint`.
- src/data/castle/level1.ts (Ruined Keep, 12 rooms incl. 2 galleries and the breach) and level2.ts (Barracks and Cells, 9 rooms).
- src/data/castle/index.ts exports `castle`: stairs link (tower stair L1 28,14 <-> undercroft L2 28,14), pit link (edge = balcony rim, landing = hexes under the 7 pit hexes), 3 entrances (index 0 gate, 1 sally port, 2 east breach), 2 rival entrances (breach, sally port), 18 spawns, 12 chests, 7 coin piles, 5 traps, 5 braziers, 7 contract sites.
- src/data/castle/castle.test.ts: 9 tests, all pass. tsc clean for src/data/castle.
- scripts/v3-map-preview.ts -> docs/castle-preview.svg. scripts/v3-map-svg2png.mjs renders it to PNG with Playwright (`node scripts/v3-map-svg2png.mjs docs/castle-preview.svg out.png`).
- Reviewed the preview twice; both levels read as rooms around a hub with loops.

## In progress
(none)

## Next
- Optional polish only.

## Contract requests
(none)

## Known issues
- The armory (L1) orcs sit behind the locked door; they only get out once the door opens. Intended (guards on the good chest).
