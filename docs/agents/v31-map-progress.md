# V3.1 map progress

## Done
- src/data/castle/shapes.ts: sketch.py shapes ported (ellipse with Python-random jitter tables, rect, line, union, minus). Parity check vs the sketch owner map: 0 mismatches on all three levels (scratch tool: sketch owners dumped from Python, compared in TS).
- src/data/castle/regions.ts: the three levels' regions transcribed, mapped to game rooms.
- src/data/castle/build.ts: LevelBuilder (regions -> tiles, walls around non-pit tiles, hand edits, props, railing, rooms with label/material/tint).

## In progress
- level1.ts, level2.ts, level3.ts, index.ts placements.

## Next
- Tests (castle.test.ts), preview script, compare with mockup/shots.

## Decisions / small fixes vs the sketch
- (filled in as made)

## Contract requests
- none yet

## Known issues
- none yet
