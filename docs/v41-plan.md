# V4.1 build plan (owner-approved, 2026-10-26)

The source of truth for building V4.1. Sources: the pitch "Classroom and Check" (https://claude.ai/artifact/DZndV5PWPSGz17rfhGBpDG), the owner's notes on it (2026-10-26 23:23) and the answers that followed. Where the owner's notes and the pitch differ, the notes win and this file says so. Background numbers: docs/v41-audit.md.

**The tenet everything is measured against:** low skill floor, high skill ceiling; each level teaches what the next one demands. Level 1 is the classroom (learn every mechanic, build wealth); Level 2 is the check (darkness first, and stealth, positioning, sound, items and class utility are all tested). Balance to preparation and play, not to raw hero level. Pillar 18: unlocks or gold, not both.

Each workstream below lists its rules with numbers. Numbers live in `src/game/data.ts`. Every rule change goes into `docs/v3-spec.md` (section 31, a subsection per workstream), `docs/current-rules.md`, `docs/decisions.md` (a dated line per decision) and the player changelog `docs/v3-changes.md`.

---

## WS1 Gold and the first delve (pitch A1, A4, A6, B1)

- **Regular bounties** (`BOUNTY`): rescue 110 / 200 / 280 (L1/L2/L3; was 80/150/220); recover 140 / 250 / 340 (was 100/180/260), heirloom values unchanged (60/120/180); slay 600 (was 500).
- **Contracts that win something back pay no gold** (pillar 18): every story contract (Aldric, Wim, Gerda, Ilse, the copper, the cask book) and every "Bring back <captive>" contract pays 0 gold. Reputation +1 and XP as before.
- **Gifts instead** (on return, the first time each villager comes home; a `villageUnlocked` line names the gift):
  - Aldric: 2 potions to the cart.
  - Wim: a round: every hero on the roster gets a free Hobart's Reserve, drunk on their next delve (works before the copper is home: his last cask).
  - Gerda: one free shield: the next shield bought at the forge costs 0 (`campaign.credits.shield`).
  - Ilse: 2 antipoisons to the cart (WS6 adds 3 glow arrows).
  - The copper, the cask book, a brought-back captive: none.
- **The castle keeps refilling** (A4): chests, coins and crates reset every delve, unchanged.
- **Starting gold 120** (`START_GOLD`, was 90).
- **A gentler first delve** (B1): on a campaign's first delve (`campaign.delveCount === 0`), the orc posted in the chapel (Aldric's guard) spawns asleep. Later delves as before.

## WS2 Light: torches are the clock (pitch C1, C3, D, D1, E as amended, L3)

- **No free lantern.** A delve starts with no party light. The old lantern state (`Delve.light`, `lanternOpen`, `lanternBearer`) is retired from new delves; a save with a delve in progress keeps working (turn the old lantern into a Lantern item in the bearer's pack, or keep the old fields read-only: builder's choice, documented).
- **Torch** (Mott, 10 gold, 1 slot): Light (action): radius 3 for 15 rounds (`TORCH_RADIUS` 3, `TORCH_ROUNDS` 15; were 2 and 12). Snuff (free): goes dark, keeps its remaining rounds. Relight (action). Drop it lit (free): it stays burning on the hex and lights it. Burns down 1 a world phase while lit; at 0 it's gone.
- **The lantern** (Gerda, 120 gold, 1 slot, reusable): holds 20, refilled free in camp; radius 4 at 7+, 3 below; burns 1 a world phase while open; the shutter is free at any time. Carried out, it goes back on the cart; lost with a fallen bearer's pack (lost gear as usual). Oil (Ilse, 15) adds 10 to a lantern.
- **Kindle** (Pyromancer, 1 mana): lights or relights a torch or lantern held by an ally within 3, or adds 6 rounds to one.
- **How dark hurts, by the hero's own hex** (replaces the lantern stage): lit by party light (a torch, a lantern, Glowworm) or daylight: no penalty; lit only by a castle light (sconce, fire, brazier, fungus, glow, burning): −10; unlit: −20. Sight ranges: party light or daylight as today's "bright" row (8/7/6); castle light only as today's (4/3/2); unlit as today (4/2/1).
- **The Gloam:** only on Level 3, only for unlit heroes (the "lantern at 0 anywhere" trigger is gone).
- **The Sisters leave** after 3 pickups, when nothing is left, or at round 18 (`SISTERS_LEAVE_ROUND`; was: the party's lantern at 9 or less).
- **Night-eye becomes an ale** ("Night-eye Stout", 25 gold, at the Flagon, needs Wim and Ilse): drunk at the delve's start, lasts the delve. The drinker sees as if lit by party light (sight 8/7/6, no dark penalty) but stays unlit to monsters and the Gloam and lights nothing for anyone else. The Mott item (`nightsight`) goes away; old stash copies sell for 15 or convert to nothing (builder's choice, documented).
- **Crews carry light** (L3, crew parity pass 2): every crew member lights radius 2 around itself (lit hexes for everyone: heroes see them coming, monsters see them as lit). The Gloam never hunts a lit crew member.
- **Level 1 gets dark rooms** (B's lesson table): the library stacks, the armory and the tower top lose their sconces, so the richest Level 1 chests (tower, armory) sit in the dark and a torch pays for itself. Daylight elsewhere unchanged.
- **The board says "Unlit"** (C3): a contract card gets an "Unlit" chip (hover: "You'll want light.") when its site hex is in the campaign's castle memory and no fixed light reaches it.
- **HUD and Lowgate:** the top strip's lantern bar becomes a light readout (each lit torch or lantern: who carries it, rounds left); the hotbar gets Light / Snuff / Drop torch and the lantern's shutter; the Lowgate "lantern" checkbox goes; the Set out screen says when nobody in the party carries light ("No light packed. Level 1's daylight will do; deeper, you'll want a torch."). Pillar 15: rounds left are shown because they decide when to leave.

## WS3 Poison, downed, carry and unshackle (owner's notes replace pitch F)

**Poison** (replaces venom and paralysis entirely):
- A dose makes a figure **poisoned**: at step 2 of every world phase it takes 1 damage, never below 1 HP (poison never downs anyone and doesn't tick on a downed hero). It lasts until cured. Heroes, monsters (not the Dragon or the Gloam) and crew members alike. A second dose changes nothing.
- **Sources:** a spider's bite that hits (every level); the poison dart (was the venom dart; Ilse sells it, 30); the two Level 2 poison traps (were venom traps: 1 damage and a dose); the Gallows Choir's Little Mags (her dart).
- **Cures:** the **antipoison** (renamed antidote; 20 at Mott, an essential): an action, on yourself or an adjacent ally (up or downed); Mend (Hedgewitch) cures; leaving the castle cures. (WS5: Spider-milk Stout makes the drinker immune for the delve.)
- Paralysis, Shoulder, Set down and the lone-paralysis rule are removed. Old saves: a paralyzed or envenomed figure loads as poisoned.

**Downed:**
- At 0 HP a hero is downed and **bleeds out in 3** world phases (`BLEED_START` 3, was 2). Any damage to a downed hero still kills. Monsters still ignore downed heroes as targets.
- **Revive is removed.** A **potion** used on an adjacent downed hero gets them up at 5 HP (Greater potion, WS5: 8). **Mend** on a downed hero within 3 gets them up at 2 HP (1 mana).
- With the **splints** pairing (WS5: Gerda and Aldric home), a downed hero may **crawl**: move 1 hex a turn on their own, no actions but Leave on an exit; they still bleed.

**Carry** (replaces Shoulder, Free and the prisoner escort):
- **Carry** (an action): next to a downed hero or a shackled captive nobody carries. The carried body **shares the carrier's hex** and moves with them.
- While carrying: the carrier moves 3 at most (dash too); **takes no actions** but free ones (Set down, open/close a door, Take, Drop, Give, Leave, parley); can't jump, climb, grapple or blink (those set the body down first). **Set down** is free (onto the carrier's hex or a free adjacent one).
- A carried downed hero **doesn't bleed**. Leaving with a carried body takes it out: a downed hero comes out alive at 1 HP; a captive is rescued.
- Sharing a hex: area effects on the hex (blasts, fire, burning hexes, breath, falls) hit both (any damage to a downed body kills it); single-target strikes pick one (monsters still ignore downed heroes; they may strike a carried captive). If the carrier falls, the carried body falls with them. Carrying ends when the carrier is downed or killed (the body lies on that hex).
- Helpless and alone (crews, spec 28.8) reads "downed or dozing".

**Captives are shackled:**
- Rescue prisoners and captive heroes start **shackled**: they can't move on their own. Carry them, or **Unshackle** them (an action, adjacent): lockpicks (silent, sure), an improvised pick (uses one, sure), the skeleton key (used up, silent), or Smash (2 Might slots, 1 hit opens, noise 4 either way).
- Unshackled, the captive **follows** the hero who freed them at walk 4 (placed next to them after each move, as the escort today) without slowing them. Monsters still target captives. Leaving with the followed or carried captive adjacent (or on the hex) rescues them. "Free" goes away.

**Crews by the same rules** (pillar 17): crew members go **down** at 0 HP (bleed 3) instead of dying outright; any damage kills a downed member; crewmates get them up with potions and carry them; a crew Hedgewitch's Mend gets a member up at 2. Crews carrying off a hero use Carry (the hero shares the member's hex). Killing a carrier drops what it carried.

## WS4 The Outfit screen (pitch M1 with the owner's changes)

- **Two sides:** left "Yours" (the party's packs, then Keven's cart); right **"Vendors"**, one tab per vendor: Mott, Gerda's forge, Ilse's bench, the Flagon.
- **Every vendor tab lists everything that vendor will ever sell**, open or not (playtest setting `SHOW_LOCKED = true` in the UI). Locked rows are visibly locked (dimmed, a lock glyph, no Buy button) and their hover gives an in-voice hint instead of the rule: e.g. "If only someone in Lowgate still worked steel..." (Gerda's), "Wim would know how to brew this, if he had his copper back.", "Smells like something Ilse would mix. If we ever find her.", pairs: "Gerda and Ilse together might manage this." A vendor tab whose villager isn't home is still shown, labelled with what it needs.
- **Rows get proper attention:** glyph, name, a one-line use, the price clearly listed (gold glyph + number), how many you own (packed / on the cart), and a Buy button with the price ("Buy · 20"). Forge gear and ales are bought for the selected hero ("for Fenna"). Bought items go into the selected hero's pack when they fit (glow there), else the cart. Owned things never show a price. Pillar 15: effects and numbers behind hover.
- Keven's cart lives on the "Yours" side (sell one or all stays).
- Lowgate keeps four steps; the in-delve HUD is not part of this.

## WS5 Ilse and the village pairs (pitch H1, J, K)

- **Ilse the alchemist**, a story rescue on Level 2 in the archive, next to the spider (a new story site in the archive). On the board once Aldric is home and reputation is 1. Unlocks Ilse's bench (`village.alchemist`).
- **Mott** (from the start): torch 10, potion 20, antipoison 20, rope 15, firecracker 10, plain arrows 10 (WS6), whistling arrows 15 (WS6), blasting charge 45 (was 30).
- **Ilse's bench:** sleep dart 25, poison dart 30, smoke 20, glue 25, oil 15; glow, fire and poison arrows (WS6).
- **Gerda's forge:** weapon and armor tiers, shield, caltrops, grappling hook, skeleton key, lockpicks, the lantern (WS2), barbed and rope arrows (WS6).
- **Pairs** (available once both are home):
  - Wim + Ilse: Night-eye Stout (WS2), Spider-milk Stout (20: poison can't take hold of the drinker this delve), Dragonfire Porter (25: fire, burning, breath and blasts do 2 less to the drinker).
  - Gerda + Ilse: blasting charges at Gerda for 30; the tripwire (a Sapper may set a charge as a tripwire: it goes off when an enemy steps next to it, or when its fuse would); blast arrows (WS6).
  - Aldric + Ilse: Greater potion (35: heal 8; a downed hero up at 8); antipoison at 12 from Aldric.
  - Aldric + Wim: hot supper: every hero who gets out heals 2 HP on return.
  - Gerda + Aldric: splints: downed heroes crawl (WS3).
- The unlock map in the pitch (section K) is the reference for who opens what.

## WS6 Arrows (pitch G1)

- **The quiver:** Ranger class kit, slotless and their own, fresh each delve: 5 arrows a level (`ARROWS_PER_LEVEL` 5). Every bow shot uses one: attack, overwatch, knockback, hamstring, a free swing with the bow. Out of arrows: the Ranger fights with a knife (2 Finesse slots, 1 damage, melee).
- **Plain arrows** at Mott: a bundle of 6 for 10 gold, 1 slot; used after the quiver.
- **Specialty arrows**, 1-slot bundles; firing asks which arrow (plain by default): whistling (Mott, 15 for 3: noise 6 where it lands); glow (Ilse, 20 for 3: lights radius 2 for 8 rounds where it lands or on what it hits); fire (Ilse, 25 for 3: +1 damage, the hex burns 2 rounds); poison (Ilse, 30 for 3: a hit poisons); barbed (Gerda, 25 for 3: a hit roots 2 rounds); rope (Gerda, 30 for 1: shot at a pit's far edge or a ledge within 5, anchors a rope there); blast (Gerda + Ilse, 40 for 2: a blast of 3 within 1 where it lands, no ring, noise 8, opens locks and breaks walls like a charge).
- Ilse's gift gains 3 glow arrows.
- **Crews:** crew Rangers carry quivers by crew level and may fire specialty arrows from their packs.

## WS7 Crews as an equal power (owner's notes replace pitch L1)

- Crews are the party's equal: **at equal size and level a fight is near even (target ~50/50 in the arena); outlevelled or outnumbered by one, the party loses most fights; a battle-worn party should be reluctant to fight a fresh crew.** Crew difficulty scales with the castle level; Level 1's Sisters stay neutral unless provoked, so a fight there is chosen.
- To get there, crew parity pass 2 (docs/ideas-later.md) where it moves the balance: Focus on key rolls, flanking, brace, potions, the down state and getting each other up (WS3), antipoisons, the missing spells (Sleep, Dread, Night thorn, Briar, Kindle), light (WS2). Then tune crew levels, tiers and packs against the arena targets; the Level 2 crews may change level either way.
- Teach through play: crews use the same verbs the party will need on that level (stealth on Level 1, light and positioning on Level 2), named in the log.

## WS8 Level 1 teaches, Level 2 tests (owner: C1 plus every mechanic)

- Level 1 demonstrates every core mechanic in play: stealth past sleepers and patrols, light (the dark rooms), sound (a firecracker lure has an obvious use), locks and keys, traps, poison (the library spider), items and class utility (a Burglar's picks, a Sapper's shortcut, a Ranger's line of fire), crews and parley, terrain.
- Level 2 tests each one: darkness first; rooms that reward a stealthy approach and good positioning (sight lines, flanking, chokepoints) and punish a loud, careless walk; at least one problem best solved with sound, one with an item, one with a class's utility.
- Built as castle-data changes with castle.test invariants, from a room-by-room design note (`docs/v41-levels.md`) reviewed first.

## WS9 The sim

- The bot learns every new rule (torches, the lantern, poison, carry, unshackle, arrows, vendors).
- Two new policies for the Level 2 check: `prepared` (buys light and a cure, sneaks, uses items and class abilities) and `careless` (takes nothing, walks).
- Targets (pitch section 0, adjusted): first delves losing a hero ≤ 10%; median campaign 10+ delves; median wealth at delve 5 300–450; prepared party at level ~2.5 does ≥ 60% of Level 2 contracts with ≤ 1 death a delve; careless ≤ 25%; arena near 50/50 at parity.

## Order

Round 1 (parallel): WS1 + WS5 (the village), WS3 (poison and carry), WS2 (light). Round 2: WS6 (arrows), WS7 (crews), WS8 (levels), WS4 (Outfit). Round 3: WS9 tuning against the targets, then deploy for play-testing. Each round is merged into `v4.1`, tested, measured and deployed to `main` when it's coherent.
