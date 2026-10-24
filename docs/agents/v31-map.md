# Brief: V3.1 castle, three levels

Read docs/agents/v3-common.md first (same rules: own paths only, don't commit, keep a progress note at docs/agents/v31-map-progress.md, snapshot with `bash scripts/snapshot-wip.sh`). Branch: `v3.1`.

You own src/data/castle/**. Replace the two-level castle with the approved three-level castle and export it as `castle: CastleDef` from src/data/castle/index.ts.

## Source of truth

- The layout is approved: **mockup/sketch.py** draws it (images: mockup/shots/level1.png, level2.png, level3.png). Its grid is odd-r offset (col, row), the same as `offsetToAxial` in src/game/hex.ts, so its hexes map 1:1 onto the game's.
- Port the sketch's region shapes (ellipse, rect, line, union, minus, jitter included) to TypeScript (e.g. src/data/castle/shapes.ts) and generate the tiles from them, so the game matches the sketch hex for hex. Small fixes are fine where a shape makes an unplayable spot (a 1-hex dead pocket, a squeeze that doesn't connect); note them in your progress note.
- Rules for the data: docs/v3-spec.md section 14. Types: src/game/types.ts (new: lift/prop/tallprop/sealed tiles, `prop`, `railing`, room `material`/`tint`, `lights`, the 'lift' link, 'slay' sites, the 'dragon' monster).

## What to build

1. **Tiles** for all three levels from the shapes: floors with room ids; walls around walkable areas (only where the sketch draws walls: hexes next to walkable that aren't pit); pits (L1 pit mouth, L2 pit, the L2 cellblock's collapsed-floor hex as a 1-hex pit over the Drain); bridges as floor over the pit; doors, locked doors, cracked walls, the sealed door; stairs (L1 tower and L2 guard post, same (q, r)); lift tiles (L2 winch room and L3 lift base, same (q, r)); exits (L1 main gate, sally port, east breach; L3 cave mouth).
2. **Railing:** on Level 1 only a few short bits on the pit mouth's rim (3 to 5 hexes total); on Level 2 the arcade's pit side railed except two broken gaps of 1 to 2 hexes; bridges, the east ledge, the south rim and the broken bridge have no railing.
3. **Rooms** (`rooms` with names, label hex, `material` and `tint`): flagstone halls, planks in barracks/library/kitchens, rug down the great hall, earth and rock in the Hollow, water in the Drain, bone on the Bone Pile. Give neighbouring rooms clearly different tints.
4. **Props** (prop/tallprop tiles with `prop`), 3 to 6 per room, saying what each room is, placed so they create cover and lanes but never block a room's connection: hall columns (pillar), long tables and benches, kitchen tables and barrels, library and archive shelves (tallprop, in rows that make aisles), barracks bunks, forge (tallprop) and anvils, the winch (tallprop, next to the lift), cellblock cages, the Crossing's statue (tallprop), guard post table and rack, armory racks, Hollow stalagmites and rocks, bones on the Bone Pile.
5. **Lights:** sconces on walls of most rooms (2 to 4 per big room, some rooms dark on purpose), daylight in the courtyard and gatehouse (several daylight lights so the whole area is lit), the forge fire, glowing fungus in the grove, a pit glow at the Bone Pile, the Lair's fires and its fire vents (radius 1 'fire' lights on walkable hexes around the hoard). Braziers (relightable, `braziers`) in the chapel, the guard post, the archive and the fungus grove.
6. **Monsters** (spawns): Level 1: rats in the kitchens, a cutpurse in the courtyard (awake), a spider in the library, two orcs in the great hall near the pit (one awake), an orc at the tower stair. Level 2: an orc squad (3 to 4) in the barracks, Grub the Jailer (named orc, awake) in the cellblock, a spider in the archive, a berserker (Ugluk Red-Hand) in the forge, rats on the south rim, an orc patrol (awake) on the arcade, an orc on the east ledge. Level 3: rats on the Bone Pile, two spiders in the Spider Nest, an orc pair in the lift base, a berserker in the Drain, and the Dragon on its hoard in the Lair (asleep).
7. **Loot:** chests: L1 tier 1 to 2 (armory locked tier 2), L2 tier 2 (officers' locked tier 3, archive tier 3), L3 tier 3 (Spider Nest, Drain). Coin piles on every level, bigger deeper. The Dragon's hoard is placed by the engine around the Dragon (don't place it).
8. **Traps:** 2 per level, in corridors and doorways, never on a bridge.
9. **Contract sites:** rescue: L1 library, L2 cellblock cells (2), L3 Spider Nest; recover: L1 armory, L1 chapel, L2 archive, L2 forge, L3 Fungus Grove, L3 Drain; slay: the Dragon's spawn hex in the Lair.
10. **Entrances** (`entrances`, in this order): main gate, sally port, east breach. **Rival entrances:** east breach, sally port.
11. **Tests** (src/data/castle/castle.test.ts): everything walkable reachable from an entrance (stairs, lift, and falls count as connections; falls only go down); placements on valid tiles; links join matching tiles at the same (q, r); every pit column on L1/L2 lands somewhere walkable below; railings only on hexes next to a pit; lights on valid hexes; room ids exist; no two placements share a hex.
12. **Preview:** update scripts/v3-map-preview.ts for three levels (lights, props, railings, pits, sites, spawns) and compare it against mockup/shots; iterate until it matches the sketch.
