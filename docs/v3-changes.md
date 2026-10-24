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

- **V3.1, the three-level castle (2026-10-24):** the castle from the approved map proposal (pass 2): the Ruined Keep, the Crossing (bridges over the pit) and the Hollow (caves, the Dragon's Lair, the Sealed Stair). Pits drop straight down (4 damage per level, 7 for two; two-level jumps ask first), shoves and railings make edges a weapon, orcs and berserkers push back, the Dragon breathes on marked hexes and sweeps with its tail, the winch runs the lift, sight shrinks with the lantern and with depth, and a 500-gold Dragon contract unlocks at reputation 3. New look: pale cutaway walls, floors per room, furniture, fixed lights, and you can see the levels below down the pit. Old saves start fresh.

- **Exploring by line of sight (2026-10-24):** every step of a walk reveals the layout of everything in line of sight within 8 hexes, lit or not, so long moves no longer leave gaps and walking into a room shows the room. Monsters still only show in light.

## Camp

Bounty board, quartermaster (torches, potions, rope, blasting charges), smithy (weapon and armor tiers), tavern (recruits), infirmary, stash (sell valuables) and memorial.

## Presentation

Low-poly hex diorama with a rotatable camera (right-drag, `[` `]`), light and fog of war, roll animations, intents over enemies, event log, playback speed up to instant, hold Space to hurry the castle's turn, autosave. Keys: 1–4 select, Tab next, S sneak, E end turn.

## Known gaps

No touch/mobile pass; Levels 3–5, the Dragon, the Sapper, other crews, hiring rivals and the endless Deep Vaults mode come later. Balance is a first pass from a bot: Level 1 is a warm-up, Level 2 is dangerous.
