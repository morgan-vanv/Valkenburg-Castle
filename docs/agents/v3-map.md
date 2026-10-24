# Brief: V3 castle, Levels 1 and 2

Read docs/agents/v3-common.md first.

You own src/data/castle/**. Build the real castle for the slice: two hand-designed levels on a pointy-top hex grid, as a `CastleDef` (src/game/types.ts), exported as `castle` from src/data/castle/index.ts.

## Format

- Author each level as ASCII rows in "odd-r" offset layout (row r, column c; convert with `offsetToAxial` from src/game/hex.ts). One character per hex. Suggested legend (yours to finalize, document it at the top of parse.ts): `.` floor, `#` wall, space or `~` void (not listed in tiles), `^` raised floor, `%` rubble, `o` pillar, `+` door, `L` locked door, `x` cracked wall, `O` pit, `S` stairs, `E` exit, `B` brazier. Put rooms, spawns, chests, coins, traps, contract sites, links and entrances in TypeScript next to the rows, referring to hexes by offset (col,row) through a helper, not by axial math by hand.
- Tag each floor-like hex with its room id (a flood fill per room from a seed hex, stopping at doors/walls, is fine; halls can be rooms too, e.g. "Long hall").

## Design (from the GDD: rooms, not mazes)

- Readable: 7 to 10 rooms per level, each roughly 4 to 9 hexes across, joined by short halls 2 hexes wide. Every level has a hub and at least one loop, so the player can circle around trouble. Few doors, each meaningful (a locked door guards something good). Keep each level within about 34 × 26 hexes.
- **Level 1, the Ruined Keep**: gatehouse with the main exit (south), a great hall hub in the middle, a pit balcony around the central pit (raised floor on the balcony edge is nice), chapel with a brazier, kitchens with a sally-port exit (west), armory behind a locked door (good chest), tower stair with stairs down, plus one or two more (courtyard ruin with rubble and open sky, old library). Third exit: an east breach. Monsters: rats, a cutpurse, a spider, two or three orcs. A few coin piles, 4 to 6 chests (tiers 1 and 2), 1 or 2 traps, 3 braziers.
- **Level 2, the Barracks and Cells**: pit landing area under the Level 1 pit (the pit is open above it: put the landing hexes on floor under the pit footprint), stairs up linked to Level 1's tower stair, a cellblock of small cells (rescue sites), guard room, barracks, mess hall, storeroom, an old shrine, a cracked wall shortcut. Monsters: orc squads (several orcs together), a berserker, a spider, rats. 5 to 7 chests (tiers 2 and 3, one locked tier 3), traps, 2 braziers. No exit on Level 2 (the way out is up the stairs or a rope up the pit).
- Contract sites: 3 rescue sites (mostly Level 2 cells, one on Level 1) and 4 recover sites (2 per level), each with a short `where` ("the chapel crypt").
- Rival entrances: the east breach and the sally port.
- Lore names welcome (the castle is the Van Valkenburg seat, ruined for generations; orcs hold the barracks).

## Deliverables

1. src/data/castle/parse.ts (format + parser), level1.ts, level2.ts, index.ts exporting `castle`.
2. src/data/castle/castle.test.ts (vitest): every floor-like hex reachable from an entrance (treat doors as passable, pits impassable, stairs/pit links as connections); spawns, chests, coins, traps, sites and braziers on valid tiles (braziers on brazier tiles; the rest on walkable tiles); stairs links join stairs tiles; pit edge hexes are floor adjacent to pit tiles; landing hexes are floor on the lower level; entrances and rival entrances are exit tiles; room ids exist.
3. scripts/v3-map-preview.ts: writes docs/castle-preview.svg (both levels side by side, hexes colored by kind, room names, markers for spawns/chests/sites/exits). The lead uses it to review the layout. Run with `npx tsx scripts/v3-map-preview.ts`.
4. Look at your preview and iterate until each level reads clearly as rooms around a hub.
