# What changed in V3: Hobart's Revenge

V3 rebuilds the game as a turn-based extraction crawler, following the V3 Game Design Document (https://claude.ai/artifact/Q7766w5bBz11paXkw4YPf1). Rules with numbers: docs/v3-spec.md. V2 is in `main`'s history (last V2 commit 7a62311).

## The loop

Camp → take a contract from Hobart's bounty board → pick up to 4 heroes and their packs → delve → get out with the prize and whatever else you carried → spend it at camp.

- **Contracts:** Rescue (free a prisoner and walk them out) and Recover (carry an heirloom out). Level 1 jobs from the start; Level 2 jobs after your first success.
- **Lord Hobart** joins delves as the strongest hero. If he dies, the campaign is over.
- **Permadeath:** heroes at 0 HP are downed and bleed out in 2 rounds unless revived. Revived heroes sit out 2 contracts. The dead go to the memorial, and their gear stays where they fell.

## In the castle

- **Two hand-built hex levels:** the Ruined Keep (12 rooms around the great hall, the pit balcony, three exits) and the Barracks and Cells (cellblock, mess hall, locked storeroom, a cracked-wall shortcut). Preview: docs/castle-preview.svg.
- **Turns:** each hero moves once and acts once, in either order; then the castle moves. Walk 4, or Sneak 2 quietly (the Burglar sneaks 4).
- **Slot rolls everywhere:** attacks, lockpicks, smashing doors, disarming traps. The preview shows slots, odds per hit count, modifiers and noise before you commit; Focus locks slots as hits.
- **Light is the clock:** a 40-round lantern. Bright, Dim and Dark make every roll harder; at pitch black the Gloam hunts you. Torches, braziers (they stay lit forever) and the mage's Kindle buy time. Splitting up is a real choice: heroes outside the light fight at Dark.
- **Noise:** every action makes a ripple you can see before acting. Sleeping monsters wake and come to look; closed doors muffle it.
- **Monsters show their intent:** who they'll hit and for how much. Rats, orcs (they shout for help), spiders (webs), the cutpurse (steals and runs) and berserkers.
- **The Lantern Sisters:** a rival crew that sometimes shows up to race you for chests and your prize. Leave them be, fight them, or bribe them 40 gold to leave.

## Since launch

- **V3.4, a tighter purse (2026-10-25):** a campaign starts with 120 gold and recruits cost 60 (level 1) or 100 (level 2), so your first choice is two hires and nothing else, or one hire and some cheap gear. Wounds carry over: heroes go back in with the HP they came out with, and the infirmary heals for 3 gold per HP (the old sit-out rule is gone). Falling into the dark shows only the lights below (a fire, the fungus, the pit glow), not the rooms they light, and standing in a castle light other than daylight lets you see 4 hexes (2 in the Hollow); your own lantern still sees farther. Hero cards are rebuilt: name and class, labelled HP, Focus and Mana, the pack as 4 sockets you can hover, and badges that explain themselves; every action, item, stage and counter has a tooltip with real numbers (Kindle: +6 lantern light for 1 mana). Torsos are shaped instead of boxes, walls stand at full height (heroes behind them show as a faint outline; a setting brings back the old lowered walls). Rival crews and a pub are written up as proposals, not built. Saves carry over.

- **V3.3, fear by depth (2026-10-24 night):** monsters are awake by default and some patrol (routes show once you've watched them walk); they notice you when lit or within 3, and give up after a 3-round search. The lantern holds 20 rounds and has a free **shutter**: Level 1 is bright enough to cross shuttered, Level 2 is a big disadvantage without light, and in the Hollow the Gloam rises the moment anyone stands in the dark and never enters light. Sight is per hero (in the dark: 4 hexes on Level 1, 2 on Level 2, 1 in the Hollow). Deeper monsters are tougher by tier. New: orc archers (knockback shots across the pit), orc captains (shield wall, rallying shout), ghouls buried in the Bone Pile (they grab), spiders web then drag. The Lantern Sisters now have a Ranger, a Shadowmancer and a Burglar using your own tricks. Figures re-proportioned to the chosen scale (option C). Saves start fresh.

- **V3.2, squad building and clarity (2026-10-24 evening):** a campaign starts with Lord Hobart alone and 160 gold; hire your squad at the tavern from eight classes (Sellsword, Burglar, Ranger, Sapper, Pyromancer, Shadowmancer, Hedgewitch, and Hobart). Dash: move again with your action, XCOM style. Twelve quartermaster items (smoke and glue bombs, sleep darts, caltrops, a grappling hook, a skeleton key, oil, firecrackers, plus the old four). Line of sight no longer leaves holes. The camera follows visible enemy actions during the castle's turn. Opened chests and ground loot glow until taken. Stairs and the lift are real models with a "Take stairs" button; contract objectives become beacons once seen; Take explains itself when the heirloom won't fit; every interactable says what you can do with it on hover; the HUD is regrouped with hotkeys and a "still waiting" count on End turn. Saves start fresh. Later the same evening: figures at Old School RuneScape scale (chunky, about two hexes tall), a Dragon about three and a half hexes long, and thin walls drawn along room edges while caves stay thick rock.

- **V3.1, the three-level castle (2026-10-24):** the castle from the approved map proposal (pass 2): the Ruined Keep, the Crossing (bridges over the pit) and the Hollow (caves, the Dragon's Lair, the Sealed Stair). Pits drop straight down (4 damage per level, 7 for two; two-level jumps ask first), shoves and railings make edges a weapon, orcs and berserkers push back, the Dragon breathes on marked hexes and sweeps with its tail, the winch runs the lift, sight shrinks with the lantern and with depth, and a 500-gold Dragon contract unlocks at reputation 3. New look: pale cutaway walls, floors per room, furniture, fixed lights, and you can see the levels below down the pit. Old saves start fresh.

- **Exploring by line of sight (2026-10-24):** every step of a walk reveals the layout of everything in line of sight within 8 hexes, lit or not, so long moves no longer leave gaps and walking into a room shows the room. Monsters still only show in light.

## Camp

Bounty board, quartermaster (torches, potions, rope, blasting charges), smithy (weapon and armor tiers), tavern (recruits), infirmary, stash (sell valuables) and memorial.

## Presentation

Low-poly hex diorama with a rotatable camera (right-drag, `[` `]`), light and fog of war, roll animations, intents over enemies, event log, playback speed up to instant, hold Space to hurry the castle's turn, autosave. Keys: 1–4 select, Tab next, S sneak, E end turn.

## Known gaps

No touch/mobile pass; Levels 3–5, the Dragon, the Sapper, other crews, hiring rivals and the endless Deep Vaults mode come later. Balance is a first pass from a bot: Level 1 is a warm-up, Level 2 is dangerous.
