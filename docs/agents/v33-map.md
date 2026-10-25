# Brief: V3.3 castle data

Read docs/agents/v3-common.md, docs/agents/v31-map-progress.md (how the castle data is built), then docs/v3-spec.md section 16 and the contract diff (`git diff main -- src/game/types.ts`). You own src/data/castle/**. Branch `v3.3`.

1. **Spawns** (16.1, 16.3): `asleep` now defaults to false, so mark sleepers explicitly: L1 rats and spider; L2 the barracks squad only; L3 none but the Dragon. Add L1: two awake orcs and one patrol looping the great hall (route of 4–6 waypoints on floor, no doors). L2: a two-orc patrol on the arcade loop (shared route), one orc patrolling guard post ↔ barracks, the east-ledge walker (patrol along the ledge), orc archers (2) on the arcade/ledges, a captain with the barracks squad, two more spawns of your choice. L3: 3 ghouls buried in the Bone Pile (`buried: true`), two cave spiders, everything awake.
2. **Lights** (16.2): L1 abundant daylight (great hall collapsed roof: several daylight lights across the hall; corridors; courtyard and gatehouse as now) so most of L1 is lit without the lantern; L2 sparse (3–4 sconces total, forge, pit glow); L3 only the Lair's fires and vents, the fungus grove, the pit glow. Remove the rest.
3. **Tests**: patrol routes are on floor-like tiles, same level, connected hex to hex by walkable paths; buried ghouls on Bone Pile floor; sleepers as listed; light counts per level within the brief's intent (L1 many, L2 few, L3 only the named); existing tests still pass (update expectations the brief changes).
4. Update scripts/v3-map-preview.ts to draw patrol routes and sleepers; regenerate docs/castle-preview/*.svg (no PNGs needed).

Report: what changed per level, how to run the tests.
