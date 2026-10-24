# V3.1 engine progress

## Done
- src/game/test/testCastle.ts: three levels. L1 pit mouth (10,3) over the L2 bridge (lands L2), L1 (9..11,4) fall through L2 pit (9..11,4..5) to L3. Railing L1 (9,3); L2 (9,3),(11,3),(8,4),(12,4). Lift L2 (1,6) <-> L3 (1,6), winch tallprop L2 (1,7). Forge L2 (17,2) + fire light. Vents L3 (15,2),(15,6). Dragon L3 (16,4) in room 'lair' (door L3 13,3), slay site there. L3 cave mouth exit (1,8). Sealed stair L3 (13,7). Props: table L1 (3,2), shelf L1 (3,4), stalagmite L3 (6,1). Rubble L2 (14,3).
- world.ts: lift links (work after winch), new tiles (prop blocks move only; tallprop/sealed block sight), fixed lights in litSet (cached by door state), sightRangeOf (14.5), visibleSet = within 1 + LOS within sight range + lit hexes in LOS within 14; glimpse uses sight range; fallColumn/fallDamage/freeNear; vents and fires indexes.
- falls.ts (new): fallInfo, edgeRiskAt, fall (fell event, 4/7 raw dmg, kill credit), pushOutcome/pushText/push (pit, railing, fire, vent, figure, wall, move; shoved event), ventCheck.
- dragon.ts (new): lair (room of spawn), wake on entering Lair (non-sneak) / adjacent (except sneaking burglar) / noise >= 4; plan: breath every other round (5-hex line toward nearest seen hero), sweep (2+ adjacent), bite, move within Lair; placeHoard (3 x 300, 2 slots, minus pieces already carried out over the campaign).
- delve.ts: jump (target = adjacent pit hex, warning/confirm), rope/climb on the column model, shove with full outcomes (Dragon excluded), winch action, vents on move end, lair check after moves/landings, armor shown on attacks vs the Dragon.
- world-phase.ts: orc `shove` intent (unrailed pit behind the hero, 60%), berserker charge knockback, Dragon breath/sweep/bite, blasts push figures within 1 into pits.
- camp.ts: Level 3 contracts at rep 2, slay at rep 3 (bounty 500, always on board once unlocked), slay done = Dragon dead + a hero out; slay XP 10 split; hoard sells via sellAll.
- engine.ts: sightRange, fallInfo, edgeRisk; preview carries warning/confirm.
- Tests: 78 pass (`npx vitest run src/game`).
- Sim (scripts/v3-engine-sim.ts): per-contract-type table (n, done%, rounds, light, deaths); bot works the winch or jumps a pit column when the goal is out of walking reach; DRAGON=1 forces rep 3 + slay with a full healed party and 4 potions.
- Lair wake is per hero (the one who moved/landed); the Dragon never breathes without showing a breath intent first (a freshly woken Dragon bites/moves, then shows breath).

## Status
- All brief deliverables done. src/game/index.ts already imports the real castle; it typechecks once the map agent drops the old 'pit' link in src/data/castle/index.ts (their file).

## Sim numbers (test castle, SEED=1)
- 30 delves: everything 100% done; slay L3 avg 18.6 rounds, 24.7 light left.
- DRAGON=1, 10 delves: slain 5/10, 2 deaths per delve, ~18.5 rounds, ~22 light left. The careless bot melees the Dragon; the test castle is tiny so the lantern isn't stretched there. Re-run on the real castle once it lands.

## Design calls (spec silent)
- Dragon wakes on a hero entering the Lair by a normal walk; a sneak into the Lair doesn't wake it unless ending adjacent (a sneaking Burglar not even then) so the hoard can be stolen.
- Breath goes off as shown even if heroes moved (dodge by leaving the marked hexes). Breath also hits downed heroes and the prisoner on the line.
- Dragon armor 1 lives in MONSTERS.dragon.armor (only the Dragon has armor).
- Contract levels: L2 at rep 1 (as before), L3 at rep 2, slay at rep 3. L3 bounties: rescue 220, recover 260 (spec silent).
- Shove Perfect: +1 damage on top of the push result. A hero shoved by a monster gets kill credit for nothing; monster pushes give no XP.
- Blast: figures within 1 of the blast with an unrailed pit straight behind (away from the blast) fall.
- A fall with nowhere to land kills outright (shouldn't happen on a valid castle).
- Hoard pieces carried out don't respawn (GameStateX.hoardTaken).

## Contract requests
(none)
