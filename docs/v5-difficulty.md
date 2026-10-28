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

`SEED=1 SCENARIO=l1|l2|l3 POLICY=careless|prepared npx tsx scripts/v3-engine-sim.ts 16`, after the second and third bot passes (spec 32.14). Done = the job done and the party out; wiped = the heir dead or taken; hurt = damage taken as a share of the party's HP pool; first down = the round the first hero fell.

| Level | Policy | Done | Wiped | Deaths (16 delves) | Hurt | First down | Where they died |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | careless | 14/16 | 2 | 2 | 0.33 | r13.5 (2 delves) | both after provoking the Lantern Sisters (the heir taken) |
| 1 | prepared | **16/16** | 0 | 0 | 0.25 | never | — |
| 2 | careless | 0/16 | 3 | 21 | 0.62 | r9.1 | the guard post (12): the stairs' landing |
| 2 | prepared | **4/16** (recover 4/8, rescue 0/8) | 5 | 34 | 0.93 | r15.0 | Arcade 10, Barracks 9, Guard post 6, East ledge 6 |
| 2, seed 2 | careless | 0/16 | 1 | 23 | 0.57 | r6.3 | the Drain and the Bone Pile (fell through the hall pit), the tower stair |
| 2, seed 2 | prepared | 2/16 (recover 2/8, rescue 0/8) | 8 | 38 | 0.89 | r13.6 | Arcade 12, Guard post 7, Barracks 6, the Great Hall and gatehouse 9 (on the way back out) |
| 3 | careless | 0/16 | 0 | 19 | 0.51 | r7.4 | the guard post (8) on the way through Level 2; the Drain (7); 5 forced Wake fights (tolls unpayable) |
| 3 | prepared | 1/16 | 9 | 39 | 1.08 | r23.7 | Arcade 10 and the East ledge 4 on the way through; the Drain 8, the Tunnels 7, the lift base 5 |

**Read against the heuristic:**
- **Level 1 is right.** A prepared party of three fresh heroes finishes every job unhurt; a careless one finishes most and loses only when it picks on the Sisters. Teaching, not punishing.
- **Level 2 pushes back, and then some.** Careless never gets out with the job and dies at the landing within nine rounds: the jump is there. Prepared completes recover jobs a quarter to half of the time (6 of 16 over two seeds) and **rescue jobs never** (0 of 16): the cellblock is at the far end of the level and every route there runs the gauntlet at the top (the guard's patrol, two archers, the arcade pair, the barracks' open arches). A player is better than the bot at that gauntlet (the bot can't wait for a patrol to turn, and still gives free swings when it must move), so the human number is higher; the shape is the point: the landing decides the delve.
- **Level 3 is deadly for both,** as wanted, but for the wrong reason in part: half the prepared party's deaths on Level 3 contracts happen on Level 2 on the way through, and the careless party's forced Wake fights come from the unpayable toll. The Hollow's own killers are the Drain's berserker and the Tunnels.

**What this says to change (for playtesting to confirm, not the bot):**
1. The arrival on Level 2 (the stairs' landing and the guard's patrol) is the single biggest lever on Level 2's feel; the stairs rework (32.15, the peek) is where to look first.
2. The unpayable toll (below) turns a Level 2 or 3 crew from a tax into a wipe.
3. Rescue contracts on Level 2 may want a nearer cell, or a second way to the cellblock that isn't past the barracks.

## Open items from the measurement

- **The toll a fresh party cannot pay.** A cutthroat crew demands `max(50, half the party's carried value)`, but gold stays in camp, so a party that has looted nothing yet meets the Gallows Choir with empty pockets and the only answer is a fight against four level-5 members. One seed had this in 5 of 16 Level 2 delves. Proposed (owner to choose): (a) a party carrying nothing is told "Nothing on you? We'll see you on the way out": the crew returns to waiting and demands again when the party next passes carrying loot; or (b) heroes may pack a purse from camp gold.
- **Truce members as targets.** The engine lets a hero attack a crew member under truce (and the crew turns hostile, keeping the toll). Fine as a rule; the HUD should make it hard to do by accident (a confirm, or the target rings reading as "at peace").
