# What changed in V2

V2 turns the game into one fast dungeon run. It answers the play-test notes: too claustrophobic, too many clunky rules, and the campaign pulled focus away from the fun part. V1 is saved untouched on the `v1-prototype` branch.

## The shape of a run

- **One run, no campaign.** Shop, one trip into the castle, results. No weeks, wages, hiring, debt or muster screen.
- **Goal:** get Lord Hobart out alive with as much gold as you can carry. If Hobart dies or is left inside, the run is lost.
- **Score:** loot carried out plus any gold you didn't spend in the shop.
- **Medals:**

| Medal | Score |
| --- | --- |
| Bronze | 600 |
| Silver | 1,200 |
| Gold | 2,000 |

- **Default company:** Lord Hobart, Thorvold (Dwarf), Pim (Burglar), Aldous (Magic User), and two squads of 8. You pick an entrance for each: the west gate or the south gate.

## The shop

You start with a purse of 150 gold. Anything bought goes into a shared pack any unit can use.

| Item | Cost | What it does |
| --- | --- | --- |
| Blasting charge | 40 | Blows a door, or a cracked wall, at the end of your turn. Very loud. |
| Rope | 30 | Anchors at the shaft. Climbing down to the Deep or back up becomes safe and takes 1 action. |
| Healing draught | 25 | Heals a hero 2 wounds, or returns 3 men to a squad. |
| Smoke bomb | 20 | Smokes a square and its neighbours for a turn, blocking sight. |
| Sellsword band | 60 | Adds a third squad of 6 men. |
| War banner | 50 | Every hero starts with full Focus. |

## A new map

The 1980 transcription is replaced by a castle built for play. The old map is still in the code (`src/data/maps/classic.ts`) if we want it back.

- **Two levels:**
  - **The Halls:** treasury, library, barracks, the Long Hall, the gatehouse, the shaft hall and the chapel.
  - **The Deep:** the orc warren, the Dragon's cavern, the Undertunnel, the bone vault, the Drop and the crypt.
- **Space:** big rooms, halls two squares wide, and five doors in total. There were 39 doors on the old level 1 alone.
- **Locked doors guard the good stuff:** the treasury and the bone vault.
- **Cracked walls:** three spots where a charge opens a shortcut between rooms.
- **The shaft:** a central drop into the Deep. Use a rope, or jump and take some wounds.
- **Bigger on screen:** tiles render at twice the size and figures at 1.5×.

## Simpler rules

| Before (1980-faithful) | Now |
| --- | --- |
| Pick: d6, can jam forever. Smash table by number of men. Chop counter to 10. Unlock spell. | Pim picks any lock silently, always. Anyone forces one loudly (Alarm +6), always. A charge blows it. |
| Search rooms over several actions, roll a d6 search chart, then a treasure table, a trap table and locked chests | Treasure lies visible on the map. Stand on it, Grab (1 action). |
| Weight in coins: 250 per man, slowed when over the limit | **Sacks:** heroes carry 1 (Thorvold 2), squads 1 per 2 men. Carrying anything costs 1 move. The Dragon's hoard takes 2 sacks. |
| Monsters bound to walled rooms | Monsters guard a spot and won't stray more than 5 squares (the Dragon 7) |
| Guardroom-based waking | Sleeping orcs wake by sight or by noise nearby; the Alarm tiers do the rest |
| 9 spells, 10 spell points | 3 spells (Fireball 3, Smokescreen 1, Bless 1), 6 spell points |
| Shieldwall, dummy contacts, prisoners, ESP, Pyrotechnics, traps | Removed |

**Still in, because they make decisions:** two actions per unit, frontage (doorways still choke a fight to one man), success slots with Focus, morale and panic, overwatch, the Alarm with reinforcement waves from the Deep, monsters, and the Dragon.

## What to try

- **Sack space is the real budget.** The company carries 13 sacks, and the castle holds 16 sacks of loot. Choose what's worth carrying.
- **Bronze** comes from the Halls alone.
- **Silver** means going down into the Deep.
- **Gold** means robbing the Dragon, which needs a squad with 2 free sacks per hoard pile, and getting back up past the reinforcements.
- A careless bot banks 355–515 gold in about 10 turns, just short of bronze.

## Known gaps

- `scripts/shot.mjs` (the screenshot tour) still drives V1's screens.
- The Dragon, smoke bombs and charges haven't been seen in a real browser run yet. The engine tests cover them, and random-play tests run 300 steps × 15 seeds on the new map.
- Medal thresholds are first guesses; tell me how your runs land.
