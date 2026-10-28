# Ideas saved for later

Open ideas, newest batch last. Built-then-shelved features with code are in `docs/shelved/`. Ideas that have since shipped are listed at the bottom with the version that did it.

## Open

- **Thin walls as a gameplay model** (2026-10-24): walls along hex edges instead of whole wall hexes (the reference image in the castle redesign pitch, https://claude.ai/artifact/Do2xMUkTkDjgGjPRimNJJd). Tighter rooms; needs movement, sight and the renderer reworked. (The *look* of thin walls shipped in V3.2, spec 15.8.)
- **Endless descent** (2026-10-24): the Sealed Stair on Level 3 opens onto generated floors, each harder than the last. Stretch goal once the core game is settled; the stair stays sealed.
- **Scale and proportion, second look** (2026-10-24): option C is in but the owner isn't fully satisfied. The study is parametric (`mockup/scale-options.ts`, any value on the URL), so new variants are cheap.
- **Fear, Nerve and darkness** (2026-10-25, V3.3 play-test): make Nerve matter. Heroes who stand unlit, see an ally fall, or face the Gloam roll Nerve; a failure costs Focus, or makes them falter (no dash, −1 slot) or bolt one hex toward light. Keven's Rally and a lit brazier steady nerves. Ties to "light is the clock" and fear by depth (spec 16).
- **Summons and animal companions** (2026-10-25): summon a mouse to scout (a tiny unit that reveals as it walks, can't fight or carry, slips under doors); a Hunter class with a dog (tracks noise, flanks, can be sent ahead; dies for good). Pillar 8: a scout changes how you approach a room.
- **More meta progression** (2026-10-25): NPCs met in the castle hand out side quests; more rescued specialists reopen services (a retired adventurer, a bard, a fletcher); looted ingredients (glowcap fungus, forge coal, spider silk) craft items, potions and food. The Gilded Flagon's "version 3" (more ales, a bigger recruit pool) belongs here.
- **Crews that remember you** (2026-10-25, rival option C in https://claude.ai/artifact/PttJ4kNWutJvUAegNgAxeA): a crew you robbed, paid or betrayed treats you accordingly next time.
- **Arrows as ammunition** (2026-10-25): bows use purchasable arrows (a quiver item), with specialty arrows as forge upgrades (fire, barbed, grapple line, whistling lure).
- **Tripwire charges** (2026-10-25): the Sapper lays a charge as a trap that enemies set off; a forge upgrade from Gerda.
- **Collapse ceilings and seal hallways with charges** (2026-10-25): a charge against a hallway's roof or a doorway brings it down, filling hexes with rock that blocks movement and sight (Dig clears it slowly).
- **A full economy pass** (2026-10-25): prices, bounties and loot were tuned piecemeal (V3.4, V3.7.1); look at the whole curve once the systems settle.

### Crew parity, pass 2 (design pillar 17, after spec 28)

Crews play by the party's rules (spec 28 did movement, sneaking, noise and wake rolls, monsters vs crews, locks, traps, the Burglar's backstab, the Sapper's dig and blast). Still to give them, each visible and named in the log:
- **Rope, jump, climb, grapple** (2026-10-26): crews rope down into the pit, jump to a lower level, climb back up, grapple out; prospectors racing the party down levels.
- **Light, the rest** (2026-10-26; V4.1 WS2 gave every member radius 2 and WS7 hoods a waiting cutthroat crew): crews lighting braziers, and the Gloam hunting an unlit crew member on Level 3 (crews are never unlit today).
- **Poison, the crew side, the rest** (2026-10-26; V4.1 WS3 gave crews poison, carry and getting up, WS7 the antipoison): crew Burglars darting monsters with poison.
- **Crew parity, pass 3** (2026-10-27, from WS7): a hero mage's Kindle reaching crew torches (crews have no light items to kindle); crew Sapper's Brace was removed with the hero Sapper's (spec 30.1), so only the crew Sellsword braces; crews at peace using Dread to break off from monsters; a crew Shadowmancer's Dread lasting 2 rounds like the heroes' on monsters (heroes have no flee rule: it is "no action next turn" instead); ranged crews pulling back between rounds (they kite only on the turn they cast).
- **Smaller gaps** (2026-10-26): the party's caltrops catching crews; grab, web, drag, steal and hamstring by monsters on crew members (they attack instead today); the Dragon going for crews; crews picking or blasting locked doors on their way when they aren't the Sapper; a crew Burglar's improvised pick.

## Shelved (code exists)

- **Free exploration outside combat** (shelved 2026-10-25): BG3-style exploration (V3.8) and the earlier calm free move (V3.7). Code, findings and how to resume: `docs/shelved/exploration-mode.md` (branch `shelf/exploration-mode`; the calm walk is on `main` behind `FREE_MOVE.enabled`). The owner wants to return to it.
- **Managed facing** (shelved 2026-10-25, V3.9.1): the free Face command (F). Code behind `FACING.faceCommand` in `src/game/data.ts` and the HUD's Face mode; engine tests still cover it. Turning toward an action's target came back in V3.9.2 (`FACING.turnOnAction`). Revisit if blindsided feels unfair without a way to turn in place.
- **Rear-half shading on hover** (removed from view 2026-10-25, V3.9.1): hovering an enemy shaded its blind area. `Diorama.showRearHalf` still exists; the HUD always passes null.
- **The free-swing warning's presentation** (owner, 2026-10-26): revisit in V4.0 (the move preview's ⚔ tag over the enemy).

## Shipped since being filed

- Crew parity pass 2: Focus, flanking and brace; the missing spells (Sleep, Dread, Night thorn, Briar, Kindle); getting a downed member up (V4.1 WS3); the antipoison; crews carrying light (V4.1 WS2) → V4.1 WS7 (spec 31.9), with move-then-cast, a beaten crew calling the fight off and a wary crew keeping its distance.
- Hiring or allying with rival crews (V3 GDD) → V3.5 parley card: hire for a job or 5 rounds.
- Rival crews fleshed out (parley, prospectors on Level 1, cutthroats on Level 2) → V3.5.
- The Gilded Flagon, a Deep Rock-style pub with ales, opened by rescuing Old Wim and recovering the copper and the cask book → V3.5.
- Thin walls, the look → V3.2.

## Reactions, round two (owner, 2026-10-27, answering the V5.0 play pitch)

Saved from the pitch's P1 and the owner's notes for a later pass on meta-progression. Built in V5.0: the shield block (spec 32.10). Shelved: "Hellish Rebuke" (the pitch's Flame ward, renamed): the Pyromancer breathes fire back at a melee attacker for a Focus point plus a mana point; Hold (the melee overwatch: strike the first enemy that steps beside you, bought with the action you saved); Potion a friend who goes down beside you, at once; Riposte on a miss; Fade (a Shadowmancer veils as a monster notices them); Guard as a reaction; caltrops under a charger. The owner's direction for all of them: be restrictive about who gets them and what they do; powerful or useful ones cost Focus (or Focus plus mana); likely class-specific; and locked behind progression: unlocked at a level, or taught by a trainer who must be rescued (tie them to the villagers we rescue, or add a dedicated trainer). Each needs a cost, a guessable rule, a crew mirror (pillar 17) and a bot policy; questions must stay rare (pillar 2). The conversation "is gonna be a big one".
