# Brief: V3.7 the Sapper (engine)

Read docs/agents/v37-common.md, then docs/v3-spec.md 20.3 in full, plus 15.3 (Sapper) and 14.3 (shoves) for what exists.

1. **Fuses** (`Delve.fuses`): `setCharge` (Sapper, adjacent floor or breakable wall/door/chest, `target.fuse` 1|2, 1 charge), `throwCharge` (range 3, fuse 1), and the plain `charge` item action for non-Sappers (set with fuse 1 on an adjacent door/chest/wall). `fuseSet` event. Count down at the end of each world phase; blast when 0.
2. **Blast** in a new src/game/charges.ts: 4 within 1, 2 within 2, inner-ring push away with shove outcomes (reuse falls.ts push), noise 8 heard on adjacent levels, opens locks within 1, breaks cracked and built walls within 1 on L1/L2 unless unbreakable/rock/pillar → `blown` (kindAt treats a broken wall as rubble), `blast` event with `broke`, kills credited to the setter, blast shield (setter 0, other heroes half), rivals' own charges likewise.
3. **Satchel** 3 charges at delve start; bought charges add. **Dig** clears blast rubble.
4. **Map:** mark `unbreakable` in src/data/castle (tower stair shaft, lift shaft, outer curtain, anything whose breaking skips the level); add the castle.test rule from 20.3 (shortest path to each site with all breakable walls broken ≥ 60% of the normal path, from every entrance).
5. Sim: the Sapper sets a charge on a locked door or a wall between it and the goal when that saves 6+ hexes; prints blasts and walls broken.
6. Tests for each rule (fuse timing, blast damage rings and push, walls broken vs unbreakable, shield, locks opened, rubble dug).
