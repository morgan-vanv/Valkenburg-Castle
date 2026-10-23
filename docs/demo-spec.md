# Demo spec: a short campaign

The first playable build. One run is a 4-week campaign on levels 1 to 3 of the classic 1980 castle, played in a low-poly 3D view. Its job is to show whether the core is fun, so it favours the core rules over breadth. Numbers here are first guesses for tuning.

The full design lives in the Game Design Document. Where this spec and the GDD disagree, this spec wins for the demo. Rule numbers like (5.12) point to the 1980 manual.

Priorities: **P0** must be in the first playable build, **P1** should be, **P2** only if time allows.

## 1. Campaign (P0)

- 4 weeks. Win: treasury at least 3,000 gold after week 4's debrief, with Hobart alive. Lose: Hobart dies, or wages can't be paid.
- Start: 800 gold. Heroes: Lord Hobart (+2 leader), Rogier (+1 leader), Thorvold (Dwarf, +1 mace), Pim (Burglar), Aldous (Magic User, 10 spell points). 36 men in the barracks.
- Each week, in order:
  1. **Wages**: 1 gold per man, 2 per hero, 3 for Hobart. If the treasury can't cover them, the campaign is lost.
  2. **Hire**: 5 gold per man, up to 20 a week.
  3. **Muster**: pay 150 gold to outfit the expedition (it brings 2 explosive charges and climbing gear). Pick up to 6 units: heroes, plus squads of 3 to 10 men formed from the barracks, at most 30 men in all. Set each squad's armour (unarmored, normal, heavy). Pick each unit's entrance. Or skip the week: no expedition, no outfitting cost.
  4. **Expedition** (section 2).
  5. **Debrief**: bank all loot carried out. Pay 5 gold per man lost and 10 per hero lost. Rescued prisoners join the barracks.
  6. **Castle regroups**: +6 orcs, added to existing orc squads or forming a new one in a guardroom. Dead monsters stay dead. Dropped loot stays where it fell. Doors you destroyed stay destroyed; other doors relock.
  7. **Recovery**: heroes heal fully, Magic Users refill spell points, squads keep their losses.
- Death is permanent. If Hobart dies, the run ends at once.

## 2. Expedition

### 2.1 Start and end (P0)

- Each unit enters at its chosen entrance square on turn 1: level 1 at H-1, A-7 or F-12, or the level 3 cavern mouth at U-6 (4.6).
- A unit standing on an entrance square can **Exit** (1 action). It leaves with what it carries and can't come back (4.33).
- The expedition ends when no player units are left inside. Units still inside are never abandoned automatically.

### 2.2 Turns and actions (P0)

- Player phase, then castle phase. In the player phase, units act in any order and can switch between units freely.
- Each unit has **2 actions** per turn.
  - **Move** (1 action): up to its move allowance in squares. Normal armour 4, unarmored 5, heavy 3, −1 when over its carry limit. A unit that moves into a square adjacent to an enemy stops there (4.2).
  - Ending actions (use all remaining actions): melee attack, missile attack, cast a spell, Overwatch, Shieldwall.
  - 1-action actions: door actions, Search, open a chest, pick up or drop loot, hand loot to an adjacent friendly unit, give Focus (leaders), Exit, Jump into the Pit, climb.
- Movement is orthogonal. Stepping to a neighbouring square costs 1. Passing a closed unlocked door costs squads 1 extra; individuals pay nothing extra (4.42). Taking stairs up costs 1 extra; down costs nothing extra (4.52).
- Friendly units may share a square, up to 12 men in total (heroes count as 1) (4.31). No unit may enter a square holding an enemy (4.32).
- Adjacent means orthogonal neighbours with an open edge or an open door between them. A unit on a staircase square is also adjacent to the linked square on the other level (5.11).

### 2.3 Frontage (P0)

Frontage is measured across the edge between attacker and target (5.12):

- **Narrow**: the edge is a doorway.
- **Open**: the edge is open, and on at least one side both flank squares (the squares beside the attacker and beside the target, on the same side) are floor, connected to them and each other through open edges, and empty of units (5.123).
- **Wide**: any other open edge.
- Squads of 2 men never count as Open; a single man fights as an individual.

### 2.4 Attacks (P0)

- **Slots**: a squad rolls Narrow 1, Wide 2, Open 3 slots, never more than its men. Heroes and monsters roll their own number of slots, whatever the frontage. At most one hero may attack across a Narrow edge per phase, two across Wide, four across Open (5.23).
- **Hit chance per slot**: the attacker's base, then ±10 for each modifier, clamped to 10%–90%.
  - Up: charging (moved at least 2 squares this turn before a melee attack), attacking from two non-adjacent sides, attacking downstairs, enchanted weapon, a friendly leader in or next to the attacker's square (the best one only), target unarmored, Combat spell.
  - Down: attacking upstairs, target in Shieldwall facing the attacker (−20), target in heavy armour, attacker in Shieldwall, missile at range 3–4 (−10) or 5+ (−20), missile through a doorway, missile into or out of smoke.
- **Focus**: before rolling, spend any number of Focus to lock that many slots as hits.
- **Results**: each hit is 1 wound. If every slot hits and there were at least 2 slots, it's a **Perfect**: 1 extra wound, and the target checks morale.
- **Wounds**: a squad loses 1 man per wound (5.141). A squad of 0 is destroyed. A hero or monster dies when its wounds reach its maximum (5.151).
- Missiles: squads and leaders only (5.31), need line of sight (walls, closed doors and smoke block it), range up to 8 squares by shortest path. Squads fire with 2 slots, 1 through a doorway.
- **Focus gains**: +1 for a charge attack, +1 for killing a unit or hero, +1 for a Perfect. Heroes hold up to 3, squads up to 1. Each hero starts an expedition with 1, squads with 0. A leader can spend 1 action to give 1 of its own Focus to a squad in or next to its square.

| Unit | Base hit | Melee slots | Max wounds | Notes |
| --- | --- | --- | --- | --- |
| Hobart (+2 leader) | 65% | 2 | 4 | Leader bonus to friends nearby |
| Rogier (+1 leader) | 60% | 2 | 3 | Leader bonus |
| Thorvold (Dwarf) | 60% | 2 | 3 | +1 mace (enchanted). Counts as 2 men to smash doors. Carries explosives |
| Pim (Burglar) | 40% | 1 | 2 | Picks locks; +3 on trap checks |
| Aldous (Magic User) | 40% | 1 | 3 | 10 spell points |
| Squad (per slot) | 50% | by frontage | 1 per man | Bows |
| Orc squad | 45% | by frontage | 1 per orc | Bows |
| Evil leader | 55% | 2 | 3 | Leader bonus to orcs |
| Evil magic user C | 40% | 1 | 3 | 3 spell points |

The 1980 Burglar dies to 1 wound; the demo gives him 2 so he survives a stray arrow.

### 2.5 Morale (P0)

- Squads (both sides) check morale when they lose half or more of their men in one phase, take a Perfect, are hit by overwatch, or see a friendly leader die within 3 squares.
- Check: d100 under 60% for your squads, 50% for orcs; +10 with a friendly leader in or next to the square.
- Fail: **panic**. The squad immediately moves up to 4 squares away from the nearest enemy, and loses its actions next turn (5.44). Heroes and monsters never panic.

### 2.6 Overwatch and Shieldwall (P1)

- **Overwatch**: a squad or leader ends its turn watching. In the next castle phase, the first enemy that moves into its line of sight within 8 squares draws one missile attack, resolved the moment it enters. A hit forces a morale check. Then overwatch ends.
- **Shieldwall**: a squad of 4 or more men, not on Open frontage, ends its turn facing one adjacent square (5.246). Until its next turn, attacks from that square take −20. Its own attacks take −10. Moving breaks it.

## 3. The castle

### 3.1 Map (P0)

Levels 1, 2 and 3 of the classic 1980 map, transcribed from the original sheets. Columns use the 1980 letters across all levels, so level 3 runs F to U and lines up with levels above it. Stairs, ladders and the Pit link squares at the same letter and row. Stairs from levels 2 and 3 down to level 4 become reinforcement points; level 4 itself isn't playable.

### 3.2 Doors (P0)

- Door edges are unlocked or locked (4.4). Hidden doors are left out of the demo.
- Doors start closed. A closed door blocks movement, sight and missiles. Moving through opens it.
- A door closes at the end of each castle phase unless a unit stands in one of its two squares (4.47).
- **Secured**: a locked door with an enemy in the square beyond it can't be picked or unlocked; it must be smashed, chopped or blasted (4.43).
- Enemies have keys: locked doors behave as unlocked for them (4.41).
- Ways through a locked door, by a unit next to it:

| Method | Who | Roll | Noise |
| --- | --- | --- | --- |
| Pick | Burglar | d6: 1–3 opens, 4–5 fails, 6 jams for good (8.32) | 0 |
| Unlock spell | Magic User, 2 spell points | Always opens (6.36) | 0 |
| Smash | 1 to 3 men from squads or heroes in the adjacent square; the Dwarf counts as 2 | 1980 table 4.451 | +6 |
| Chop | Any unit | Each chop adds d6; at 10 the door is destroyed (4.46) | +4 per chop |
| Blast (P1) | Dwarf with a charge | Set as 1 action; explodes at the end of the player phase, destroying the door (8.5) | +15, wakes the levels above and below |

Smashing table (4.451), by men trying: 1 man succeeds on 1–2, can never on 6; 2 men on 1–3, never on 6; 3 men on 1–4, never on 6. "Never" means the door can't be smashed for the rest of the expedition. A smashed door is unlocked and stays unlocked; a chopped or blasted door is gone for the campaign.

Blast damage (P1): units in the charge's square die (8.54). Units on the far side take d6 −2 wounds through a door, d6 −4 through a wall, and −1 more per square of distance.

### 3.3 Sight and fog of war (P0)

- Each player unit lights and sees squares within 6 squares that it has line of sight to. Walls, closed doors and smoke block sight. Squares once seen stay explored but dim.
- Visible enemies are shown fully. Active enemies that are not visible but within 8 squares of any player unit by path are shown as **contacts**: an unidentified marker on their square.
- P1: 3 dummy contacts wander the castle until seen, then vanish (4.82). ESP reveals what every contact within 4 squares of the caster really is.

### 3.4 Enemy deployment (P0)

From the 1980 set-up (9.1), scaled for the demo:

- Level 1: three orc squads of 4, one in each guardroom. An evil +1 leader and magic user C in the guardroom at H-5.
- Level 2: one orc squad of 6 and a +1 leader in the guardroom. Prisoners in the cell block (P1): 6 men spread across the cells.
- Level 3: one orc squad of 6 in the guardroom.
- Monsters (P1): 5 drawn at random from Troll, Ogre, Spider, Drog, Banshee, Mantis and Berserker, each placed in a random room on levels 1 to 3 that isn't a guardroom.
- The Dragon (P2): asleep in its lair at S-7.

### 3.5 Monsters (P1)

Monsters fight as individuals, never use missiles and never leave the room they were placed in (8.12, 8.14). They wake when a player unit enters their room.

| Monster | Base hit | Slots | Max wounds | Trick |
| --- | --- | --- | --- | --- |
| Troll | 60% | 2 | 4 | Heals 1 wound each castle phase |
| Ogre | 60% | 2 | 3 | — |
| Berserker | 60% | 2 | 3 | Always counts as charging |
| Mantis | 55% | 2 | 2 | +20 on its first attack |
| Spider | 60% | 1 | 2 | A hit webs the target: it loses its next action |
| Drog | 55% | 1 | 2 | Half dog, half frog. Leaps: ignores the stop-next-to-enemy rule |
| Banshee | 50% | 1 | 2 | Instead of attacking, wails: every player squad in the room checks morale |
| Dragon (P2) | 70% | 3 | 30 | Breathes fire every other turn: d6+2 wounds on one square in the cavern within 6. Never leaves the cavern |

## 4. The Alarm (P0)

- A meter from 0 to 100, always on screen. Tiers: Quiet 0–19, Wary 20–39, Alert 40–59, Roused 60–79, Swarming 80+.
- It rises by: +2 each castle phase; +3 per attack; +2 per unit killed; +5 the first time any enemy sees a given player unit; door noise from the table above; Fireball +10.
- Enemy units start **dormant**: they don't move or act. A dormant unit wakes when it sees a player unit, is attacked, or is woken by its tier:
  - Wary: guardrooms within 8 squares by path of any noise this turn wake.
  - Alert: every guardroom on a level with player units wakes.
  - Roused: every 3 castle phases, a reinforcement wave arrives: one orc squad of 6 at a level 4 stair point (alternating between them).
  - Swarming: a wave every castle phase, with a +1 leader every other wave.
- Fireball wakes every enemy on its level (9.115). Blasts wake every enemy on the level above and below too (9.114).

## 5. Enemy AI (P0)

Each castle phase, every awake enemy, in turn:

1. Panicked: flee (2.5).
2. If a player unit is adjacent: melee it, preferring heroes, then the weakest squad.
3. Else if it has bows and a player unit is in line of sight within 8: fire.
4. Else move toward the nearest player unit it knows of (seen, or heard through noise) by shortest path, stopping adjacent, then attack with its second action if it can.
5. Monsters only act against player units inside or adjacent to their room.

Awake enemies with no known target walk toward the last noise, then return to post.

## 6. Search, loot and extraction

### 6.1 Rooms (P0)

Areas are found by flood fill across open edges; walls and doors bound them. An area is a **room** if it is at least 2 squares in both directions and holds no stairs or entrance (7.13). Guardrooms and the Pit hold no random treasure; in the cavern only the dragon's hoard holds treasure (7.2).

### 6.2 Searching (P0)

- A unit in a room spends 1 action to Search. A room needs one search per 6 of its squares, rounded up, from any units; a Burglar's search counts twice. No search is possible while enemies or monsters are in the room (7.14). Each room is searched once per expedition (7.12).
- When the search completes, roll d6 on the search chart (7.22): 1–3 nothing, 4 treasure, 5 locked chest (P1; otherwise treasure), 6 trap.
- **Treasure**: d6 + level modifier (level 1 +0, level 2 +1, level 3 +2) + the max wounds of a monster that was placed in the room, total modifier at most +10. Read it on 1980 table 7.23 (rows 1–16), with special treasure on 7.25.
- **Trap** (7.24): d6, +1 if a Leader, Magic User or Dwarf is in the room, +3 if a Burglar is. 1: 1 wound, 2: 2 wounds, 3: 1 wound, 4: no trap, 5: sleep gas (P1; otherwise 1 wound), 6: 1 wound, 7–9: trap found, no harm. Wounds fall on the searching unit.
- Sleep gas (P1): every unit in the room sleeps for 2 turns; attacks on sleepers score double (8.2).
- Locked chest (P1): opens like a door (pick, smash, chop, Unlock), then roll treasure.

### 6.3 Carrying (P0)

- Loot has a gold value and a weight in coins (7.23): coins weigh 1 each, a jewel 1, jewelry 10 or 15, worthless junk 10.
- Carry limit: 250 per man in a squad, 100 per hero, 150 for the Dwarf (4.72). Over the limit: −1 move. Over twice the limit: can't move.
- Found loot goes to the searching unit. Units can drop, pick up and hand over loot.
- A killed unit drops everything in its square. A squad that loses men drops what no longer fits. Dropped loot stays in the castle for later weeks.

### 6.4 Prisoners (P1)

Opening a cell door on level 2 frees its prisoners as a new squad of unarmored men under your control. Prisoners who exit join the barracks.

### 6.5 The Pit (P1)

- From a level 1 balcony square next to the Pit, a unit can **Jump** (1 action) to the square below on level 3. Each man rolls d6; 1–4 is a wound (4.91).
- With the climbing gear in the party, a unit next to the Pit can climb down safely in 1 action, or climb up from the level 3 pit floor in 2 actions per turn over 2 turns. A climbing unit is easier to hit (+20).

## 7. Spells (P1)

Aldous has 10 spell points a week, spent for good (6.1). Casting is an ending action.

| Spell | Cost | Effect |
| --- | --- | --- |
| ESP | 1 | Reveals every contact within 4 squares (6.31) |
| Fireball | 8 | A straight line of up to 4 squares through open edges only; d6+2 wounds to one unit in the target square. Wakes the level (6.32) |
| Smokescreen | 1 | Fills an adjacent square with smoke for 1 turn: blocks sight, entering costs 2 (6.33) |
| Pyrotechnics | 1 | Like Fireball's line; each squad in the target square checks morale (6.34) |
| Unlock Door | 2 | Opens an adjacent locked door (6.36) |
| Combat | 1 | +10 on one attack by a unit in or next to the caster's square this turn (6.38) |

The evil magic user casts Pyrotechnics at the nearest player squad in range, otherwise Combat on an orc squad.

## 8. Presentation

### 8.1 3D view (P0)

- Three.js, low-poly and flat-shaded. One level shown at a time; the levels above can be peeled away. Tilted three-quarter camera with orbit, pan and zoom.
- Darkness everywhere except lit squares. Each player unit carries a warm point light. Explored-but-unseen squares are dim.
- Units are small low-poly figures. A squad shows one figure per man, up to 10, so losses are visible. Heroes are a larger single figure with a coloured banner. Enemies are dark-green orcs; monsters each have a simple distinct silhouette.
- Doors are slabs that swing open. Locked doors show a padlock glyph. Stairs and ladders are visible geometry.
- Square coordinates ("C-12") on hover.

### 8.2 Interface (P0)

- HTML overlay. Selected unit card: name, men or wounds, Focus, actions left, carried loot and weight.
- Click a square to move; reachable squares highlight, with the path and cost on hover.
- Action bar for the selected unit, showing only legal actions.
- **Attack preview** before confirming: slots, hit chance, each modifier listed, Focus to spend (+/−), expected wounds.
- Dice resolve visibly: each slot flips to hit or miss, a Perfect gets a beat.
- Alarm meter with the current tier. Turn counter. Event log.
- Campaign screens: week summary, hire, muster (form squads, pick armour, pick entrances), debrief, win and loss.

### 8.3 Game feel (P0)

Hit-stop of 60–120 ms on hits, camera shake scaled to wounds, numbers that slam in, figures that fall over when men die, a flash when a door breaks, a pulse when the Alarm changes tier. A setting to reduce shake and flashes.

### 8.4 Sound (P0)

Synthesized with WebAudio, no files: footsteps, door creak and slam, lock pick clicks, smash and chop thuds, sword hit, arrow, death, dice roll, Perfect sting, alarm horn per tier change, coin pickup, explosion. A mute toggle.

### 8.5 Saving (P0)

The game autosaves to localStorage after every player action and castle phase. A new campaign takes an optional seed.

## 9. Out of the demo

Levels 4 and 5, hidden doors, Beast Control, Self Defense, the evil Wrog and Shaman, raids versus assaults, debt, hiring heroes, veterancy and traits, footholds, the legacy layer, music, touch controls, and everything in the GDD's parking lot.
