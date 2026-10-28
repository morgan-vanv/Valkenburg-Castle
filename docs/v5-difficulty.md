# Difficulty by level: the intent, and how to read the bot (V5.0, owner 2026-10-28)

The owner, 2026-10-28: "I trust my own, and other players' own experiences and playtesting results much more than the numbers that come out of our balance bot." This page states what each level is *for*, so balance work (creatures, unlocks, crews, rooms) has an intent to check against, and says what the bot can and can't tell us. Numbers in the spec (31.10, 32.13, 32.14) are evidence, not targets.

## The heuristic

| Level | What it is for | What should push back | What should not happen |
| --- | --- | --- | --- |
| **1 · The Ruined Keep** | Learn the mechanics and the strategy by playing and by watching (the Lantern Sisters show sneaking, light, picks, parley). | Only the silly and the reckless, above all with crews: wake the hall, pick a fight with the Sisters, walk into the dark rooms blind. | A careful party dying. A first delve that needs the shop to survive. |
| **2 · The Crossing** | Test what Level 1 taught: light, items, squad building, positioning, an intentional approach. A noticeable jump. | Being underprepared or unskilled: no light (the ambush in the dark), no cure, no plan for the archers' perches, standing on a bridge lip, splitting up, walking past the barracks door loudly. | A prepared, careful party losing most delves. A fight the player had no way to avoid (see the toll, below). |
| **3 · The Hollow** | Scary for everyone. Impending doom; urgency in every action. | Everything: the Gloam in the dark, the Wake, the Dragon's lair, the bone pile. | Nothing is off the table, but it should be *readable* doom: the player knows what killed them. |

Creature strength, crews and unlocks follow the same ladder: Level 1's roster is orcs, vermin and a cutpurse with the Sisters neutral; Level 2 adds archers on perches, a captain with a sleeping squad, a berserker asleep by the forge, two cutthroat crews (levels 4 and 5) and the toll; Level 3 is the Gloam, ghouls under the bones, the Wake (level 5, tier-2 weapons) and the Dragon. Village unlocks come from Level 1 (the surgeon, the innkeeper) and Level 2 (the smith, the alchemist, the muster): a party that has played Level 1 well goes into Level 2 with potions, a cure and a forge; that is the preparation Level 2 tests.

## What the bot is for

`scripts/v3-engine-sim.ts` plays a whole delve with a fixed policy. Two honest uses:

1. **Regression.** Same seeds before and after a change: did Level 2 get easier or harder, and where. `SEED=1 POLICY=prepared SCENARIO=l2 npx tsx scripts/v3-engine-sim.ts 16`, before and after.
2. **Finding what the castle does that nobody meant.** The report says where heroes die (room, last attacker), what the bot's own mistakes were, and what the crews did. Things it has turned up: the squad cap sending three heroes where the scenario promised four (31.12 / 32.14); a paid toll turning into a fight two rounds later (the bot shot a crew member under truce: a bot bug, but also a HUD question, a truce member should not be a casual target); a party that cannot pay a toll it is asked for (below); an archer in the dark keeping a rooted Ranger rooted for sixty rounds while the party waited for it.

It is not a player. It doesn't read a room, doesn't change plans mid-fight, and doesn't learn. Its "done%" is a floor for a competent human, not a prediction of one.

**The skill gap** is the measure that matches the heuristic. The same level is run with two policies: `careless` (buys nothing, never sneaks, ignores light, edges, cohesion, the lure, low HP and retreat; still fights, loots and uses kit) and `prepared` (all of it). What the level's mechanics are worth is the difference between the two:

- Level 1: a small gap, few deaths either way.
- Level 2: a wide gap: careless is pushed back hard, prepared mostly gets out (not always with the job).
- Level 3: both bleed; prepared sometimes makes it.

`SCENARIO=l1|l2|l3` builds the party for the level (three at level 1 with 120 gold; four at 3, 3, 2, 2 with 300; four at 4, 4, 3, 3 with 500) and gives it a regular contract there. The table below is 16 delves a cell, seed 1 (a 95% Wilson interval on done is ±20 points at this size, so read the shape, not the digits).

## The gap, measured (V5.0, 2026-10-28)

_To be filled from the run in progress._

## Open items from the measurement

- **The toll a fresh party cannot pay.** A cutthroat crew demands `max(50, half the party's carried value)`, but gold stays in camp, so a party that has looted nothing yet meets the Gallows Choir with empty pockets and the only answer is a fight against four level-5 members. One seed had this in 5 of 16 Level 2 delves. Proposed (owner to choose): (a) a party carrying nothing is told "Nothing on you? We'll see you on the way out": the crew returns to waiting and demands again when the party next passes carrying loot; or (b) heroes may pack a purse from camp gold.
- **Truce members as targets.** The engine lets a hero attack a crew member under truce (and the crew turns hostile, keeping the toll). Fine as a rule; the HUD should make it hard to do by accident (a confirm, or the target rings reading as "at peace").
