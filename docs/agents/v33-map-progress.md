# V3.3 map progress

Brief: docs/agents/v33-map.md. Owns src/data/castle/**, scripts/v3-map-preview.ts, docs/castle-preview/*.svg.

## Done (brief complete)
- Read common rules, brief, v31 progress, spec 16, contract diff (SpawnDef.patrol / buried / asleep default false; MonsterKind + archer / captain / ghoul).
- Step 1 spawns (src/data/castle/index.ts): sleepers explicit (`asleep: true`): L1 rats x2 + spider; L2 barracks squad (4 orcs + new captain at (23,3)); L3 Dragon. Everything else awake (no `asleep: false` anywhere).
  - L1 adds: awake orcs at court (17,25) and chapel (35,24); hall patrol orc spawning (19,10), 6 waypoints clockwise round the pit, floor only, no doors.
  - L2: arcade orcs now a two-orc patrol on one loop [(32,7),(15,6),(15,18),(15,8)] (the (15,8) corner keeps the return leg off the bridges, which would be the shorter path), spawns (24,6) and (23,7) (the old (20,7) orc moved); new guard-post orc (36,4) patrolling to the barracks (22,3) via the barracks door; ledge orc (35,19) patrols [(34,11),(35,22)]; archers at (28,7) arcade railing gap and (35,10) ledge top; captain with the squad; extras of my choice: orc in the winch room (21,25), cutpurse in the archive (7,15).
  - L3: 3 ghouls `buried: true` on Bone Pile floor (20,12), (28,13), (23,19); the two nest spiders kept as the cave spiders; all awake but the Dragon.
- Step 2 lights: L1 +16 daylight (7 round the hall pit, corridors/sally/breach, chapel x2, kitchens, tower), gate-passage sconce replaced by daylight; 11 sconces kept; 83% of L1 standable hexes within a fixed light's radius (library and armory stay dim). L2 down to 4 sconces (barracks, arcade east end, cellblock, winch room) + forge fire + 2 pit-glow lights at the Crossing. L3: lift-base sconce removed; only fungus, glow, fire, vents remain.
- Step 3 tests (castle.test.ts): 8 new tests in two describes (awareness, light by depth): sleepers exactly as listed; roster per level; ghouls buried on bones floor and spread out; every patrol route standable, same level, first waypoint = spawn, consecutive waypoints (and last->first) joined by walkable paths (L1 without doors), no waypoint on another spawn or a locked door; light counts/kinds per level; L1 coverage > 75%. Grub expectation updated to `!asleep`. 22/22 pass.
- Step 4 preview (scripts/v3-map-preview.ts): draws each patrol as the walked loop (BFS shortest path waypoint to waypoint, as the engine walks it), dashed, one colour per route, waypoints numbered; sleepers get a blue "z" badge; buried ghouls are dashed purple; glyphs A/K/G for archer/captain/ghoul; legend updated. docs/castle-preview/level{1,2,3}.svg regenerated (PNGs left as they were, per brief).

## Run / test
- `source scripts/npmenv.sh && npx vitest run src/data/castle` (22 tests).
- `npx tsx scripts/v3-map-preview.ts` regenerates the SVGs; `node scripts/v3-map-svg2png.mjs docs/castle-preview/levelN.svg out.png` rasterizes one if needed.
- `npx tsc --noEmit`: zero errors in src/data/castle and scripts/v3-map-preview.ts. Remaining repo errors/failures are in src/game and src/view (engine/presentation in flight on spec 16.2 light numbers).

## Contract requests
- none

## Known issues / notes for the engine
- Awake berserkers (Ugluk L2, drain L3) start `hunting` under camp.ts's current mapping; spec 16.1's give-up rule should settle them at their post.
- The two arcade patrollers share the loop but start on adjacent hexes; they walk in step only if the engine moves them the same allowance along the same path.
- The guard-post patrol's shortest path crosses the barracks door (32,3); monsters open unlocked doors on the way (world.ts canEnter), so that is intended. Every other route stays clear of doors.
- Incident (22:25): a mistyped `git stash` briefly stashed the whole tree; `git stash pop` restored it cleanly within seconds with no conflicts (no tracked file changed in between; untracked files were never touched). Nothing lost.
