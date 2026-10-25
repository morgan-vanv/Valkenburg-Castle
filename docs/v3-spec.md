# V3 spec: Hobart's Revenge (first playable slice)

The rules the engine implements and the presentation shows. Design intent is in the GDD (https://claude.ai/artifact/Q7766w5bBz11paXkw4YPf1); this file is the buildable version with numbers. Types: src/game/types.ts. API: src/game/api.ts. Hex math: src/game/hex.ts.

Pillars to check every rule against: simplicity over simulation; never slow a fast player; always show the odds; readable spaces; risk you choose.

## 1. Campaign

- Start: 100 gold, reputation 0, roster of 4: **Lord Hobart** (hobart), **Brann** (sellsword), **Pim** (burglar), **Aldous** (mage). Two recruits in the tavern.
- Hobart is a hero like the others but irreplaceable: if he dies, the campaign is over (stage 'over', "The heir has fallen."). He may sit out delves.
- Camp loop: pick a contract → pick 1 to 4 fit heroes (not wounded) → give each up to 4 stash items → pick an entrance → delve → summary → camp.
- Board: always 3 contracts. Level 1 contracts always; Level 2 contracts once reputation ≥ 1. Refreshed after every delve (seeded). A contract is built from a castle contract site whose kind matches.
- Bounties: rescue L1 80, L2 150; recover L1 100, L2 180. Paid only if the objective is extracted (prisoner out alive, heirloom carried out).
- Reputation +1 per completed contract.
- Recruits: 2 offers, refreshed after each delve, price 40 + 20 × (level − 1). Recruits are level 1 or 2 of sellsword, burglar or mage with random names. A rescued prisoner joins the roster free as a level 1 hero (random class among the three).
- Infirmary: a wounded hero sits out `wounded` contracts (count down by 1 after each delve they don't join). Healing at once costs 30 gold.
- Smithy: weapon tier 1 = 60 gold, tier 2 = 150; armor tier 1 = 80, tier 2 = 200.
- Quartermaster (`shop()`): torch 10, potion 20, rope 15, blasting charge 30. Bought items go to the stash.
- `sellAll`: sells every gem, jewelry and heirloom in the stash for its amount. Gold coins carried out go straight to the stash gold.
- XP: kill +1 (berserker +3), contract done +3 for every survivor, survive a delve +1. Level thresholds (total XP): 2: 5, 3: 12, 4: 20, 5: 30, 6: 45. Each level: +2 max HP and +5 to the class's main stat.
- Fallen heroes go to `campaign.fallen`; their pack goes to `lostGear` at the hex where they died, and appears as ground loot on later delves.
- Lit braziers stay lit for good (`litBraziers`).

## 2. Heroes

| Class | HP | Might | Finesse | Wits | Nerve | Weapon | Armor | Main stat |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Hobart | 12 | 65 | 50 | 55 | 80 | Longsword: 3 slots Might, 2 dmg | 1 | Might |
| Sellsword | 10 | 70 | 45 | 40 | 60 | Sword: 3 slots Might, 2 dmg | 1 | Might |
| Burglar | 7 | 40 | 75 | 60 | 50 | Dagger: 2 slots Finesse, 2 dmg | 0 | Finesse |
| Mage | 6 | 30 | 50 | 75 | 55 | Staff: 2 slots Might, 1 dmg | 0 | Wits |

- Weapon tier: +10 per slot per tier. Armor tier: +1 armor per tier. Armor reduces each hit's damage by its value, to a minimum of 1 per hit.
- Focus: 3 per hero per delve. Mana (mage): 3 per delve.
- Abilities:
  - **Rally** (Hobart): action; every other active hero within 3 hexes gains 1 Focus (max 3). Cooldown 3 rounds.
  - **Guard** (Sellsword): action; pick an adjacent ally. Until the next player phase, monster attacks aimed at that ally hit the Sellsword instead.
  - **Pick** (Burglar only): 3 Finesse slots on a locked door or chest. 3 hits opens silently; 2 opens, noise 2; 1 fails; 0 jams it (only smash or a charge opens it now). Burglar Sneak moves 4 instead of 2. Backstab: +1 slot attacking a monster that is asleep or alert (not hunting).
  - **Firebolt** (mage, 1 mana): 3 Wits slots, 2 dmg per hit, range 5, line of sight. Noise 3.
  - **Kindle** (mage, 1 mana): +12 light. Silent. No roll.
  - **Mend** (mage, 1 mana): heal 4 on an active hero within 3 (or self). No roll.

## 3. Slot rolls

- An action rolls N slots, each hitting with chance p (0..100, clamped 5..95). Before rolling, the player may spend Focus (≤ slots, ≤ the hero's Focus) to lock that many slots as hits.
- Hits = slots that hit. Perfect = every slot hit: attacks deal +1 damage; other actions make no noise.
- Modifiers to p, shown in `preview().modifiers`:
  - Brightness at the acting hero: dim −10, dark −20, pitch −30. A hero outside all light (see 5) counts as dark at least.
  - Raised floor, ranged attack (firebolt) from it: +10.
  - Flanking: an ally adjacent to the target on the opposite side (the hex across the target from the attacker): +1 slot (not a %).
  - Target asleep: +20.
  - Weapon tier (attacks): +10 per tier.
- Every roll emits a `roll` event so the view can animate the slots.

## 4. Turns

- A round = player phase, then world phase. No initiative.
- Player phase: each active hero may **move once** and **act once**, in either order (move then act, or act then move). Moving is one `move` command with a path; it can't be split.
- Walk: up to 4 hexes. Sneak: up to 2 hexes (Burglar 4). Rubble costs 2. Stairs: stepping from a stairs hex to its linked stairs hex costs 1. Can't enter walls, pillars, braziers, closed doors, pits, or hexes with a monster or rival. Heroes may pass through each other but not end on another hero.
- Webbed heroes can't move this turn. A hero escorting the prisoner moves 3 at most; the prisoner follows to an adjacent free hex.
- `endTurn` runs the world phase:
  1. Light burns 1 (see 5). Torches burn 1. Downed heroes' bleed −1; at 0 they die.
  2. Monsters act in id order, following their shown intent if still valid, else re-planning.
  3. Rivals act.
  4. The Gloam (if present) acts.
  5. New intents are computed for every awake monster; `phase` event for the new player phase; heroes' moved/acted reset; webbed cleared on heroes who were webbed last turn.
- The delve ends when no hero is active (all out, downed or dead). Downed heroes still inside when it ends die.
- `abandon`: heroes standing on an exit leave; everyone else still inside is left behind and dies. The UI must confirm.

## 5. Light

- `LIGHT_MAX` = 40. A delve starts at 40. Burns 1 per world phase.
- Brightness from light: bright > 26, dim 13..26, dark 1..12, pitch 0.
- Light radius around the lantern bearer: bright 4, dim 3, dark 2, pitch 0. Hexes inside are lit. Each hero with a lit torch lights radius 2 around them. Each lit brazier lights radius 3 around it.
- Sight: heroes see units in lit hexes in line of sight within 8, plus every hex within 1 of them. Units in unlit hexes beyond 1 are unseen.
- Exploring: the layout (floors, walls, doors) of every hex in line of sight within 8 is revealed, lit or not, from every hex a hero steps on, not just where the move ends. Darkness hides what's in a room, not the room.
- A hero standing in an unlit hex fights at "dark" penalties (−20) regardless of the lantern. That's the cost of splitting up without a torch.
- Torch: `torch` action uses one from the pack: 12 rounds of radius-2 light around that hero. Lighting a brazier: +6 light to the lantern, permanent radius 3 light there, stays lit across delves.
- Kindle: +12 (cap 40). The lantern can be passed to an adjacent hero (action).
- **The Gloam**: when light hits 0, a Gloam spawns on a floor hex 8 to 10 hexes from the lantern bearer (on the bearer's level), out of sight if possible. It moves 3 hexes per world phase toward the nearest active hero (any level via stairs), and hits for 4 (no roll, ignores armor) when adjacent. It can't be harmed. When light rises above 0 it fades (removed). Message: "Something moves in the dark."

## 6. Noise

- Actions make a ripple of radius R around the actor: walk 1 (at the destination), sneak 0, attack 2 (firebolt 3), combat death 2, smash 4, picked lock with 2 hits 2, charge 8 (also heard on the level above and below), orc shout 5.
- Closed doors halve noise passing through them (use path distance through floor tiles: a hex hears if the walking path from the source is ≤ R, where crossing a closed door counts 2).
- Monsters inside: asleep → alert, focusAt = source. Alert/hunting monsters not seeing a hero move toward focusAt.
- Rivals hear too: neutral rivals avoid loud spots; hostile rivals come.
- `moveNoise` and `preview().noise` let the view draw the ripple before the player commits.

## 7. Monsters

| Kind | HP | Slots | Chance | Dmg | Move | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| rats | 3 | 2 | 50 | 1 | 4 | Flee (move away) when at 1 HP. |
| orc | 6 | 2 | 55 | 2 | 3 | The first time an orc sees a hero, it shouts: noise 5. |
| spider | 5 | 2 | 60 | 2 | 3 | If not adjacent and within 3 in sight: webs a hero (no damage, webbed next turn) instead of moving, once every 2 rounds. |
| cutpurse | 4 | 1 | 65 | 1 | 5 | On a hit, steals a random pack item (not heirloom) instead of damage, then flees toward the farthest exit; drops it when killed. Leaves the castle if it reaches an exit. |
| berserker | 9 | 4 | 55 | 2 | 4 | Always hunting once awake. Charges the nearest hero. |

- Awareness: asleep (doesn't act; wakes on noise or when a hero ends adjacent), alert (moves toward focusAt; becomes hunting on seeing a hero), hunting (moves to and attacks the nearest seen hero; if it loses sight, goes alert at the last seen hex).
- Monster sight: 6 hexes, line of sight, and only sees heroes in lit hexes or within 2.
- Monster attacks roll their slots at their listed chance (heroes have no defense stat). Damage per hit minus armor (min 1).
- Monsters ignore downed heroes. Monsters don't use stairs except the Gloam and hunting monsters chasing a hero they saw take them.
- Intents: before each player phase, every awake monster has an intent the player can see: attack target X for [min,max] damage, move to hex, web X, steal from X, flee.
- Shove: 2 Might slots, needs 2 hits: push the target 1 hex directly away. Into the pit: it falls (removed, counts as a kill). Into a wall: 1 damage.

## 8. Doors, chests, traps, items

- Doors: closed doors block sight. Unlocked doors open automatically when a move path goes through them (no extra cost); `open` on an adjacent door toggles it (free action that doesn't use the hero's action). Locked doors: Burglar `pick` (see 2), anyone `smash` (2 Might slots: 2 hits opens, noise 4 either way), or a `charge`.
- Chests: `open` an unlocked chest (adjacent, action) → loot roll goes on the ground at the chest; heroes `take`. Locked chests: pick or smash like doors (smash on a chest: 1 hit opens it).
- Loot roll per chest (tier T): roll a d6 + T: 2–3 gold 15×T..30×T; 4–5 gold 25×T..50×T plus a torch or potion (50/50); 6–7 gem worth 40×T..80×T; 8–9 jewelry 80×T..140×T. Coin piles: their gold.
- Taking: `take` picks everything at the hero's own or an adjacent hex that fits the pack (gold merges up to 100 per slot). Pack: 4 slots per hero. `drop` puts an item on the hero's hex.
- Traps: hidden. When a hero ends a move within 1 of an armed trap, roll 1 Wits slot: hit = spotted. Walking onto an unspotted trap: 3 damage, trap spent, noise 2. A spotted trap: hexes are walkable but walking on costs the same damage; `disarm` (adjacent) = 2 Finesse slots, any hit removes it, 0 hits sets it off on the disarmer.
- Charge: place on an adjacent locked door, chest or cracked wall; explodes at the end of the player phase: opens it (door destroyed = open forever; cracked wall becomes floor). 4 damage to anything within 1 of the target hex, 2 within 2. Noise 8.
- Potion: heal 5 (self or adjacent active hero; on a downed adjacent hero it revives them with 5 HP).
- Revive: adjacent downed hero → 3 HP, active, `revived` = leaves Wounded (sits out 2 contracts).
- Rope: `rope` at a pit edge hex anchors it there for the delve. `climb`: from a roped edge hex to a landing hex below, or from a landing hex up to a roped edge hex; uses both move and action.
- Jump: from a pit edge hex to a landing hex: 4 damage (armor doesn't help), uses move and action. Lands on a free landing hex.

## 9. Contracts

- **Rescue**: a prisoner (5 HP, named) waits at the site, shackled. `free` (adjacent, action). Freed prisoners follow the hero who freed them (escorting): after that hero moves, the prisoner steps to a free hex adjacent to them. Monsters may attack the prisoner. Out = the escorting hero leaves on an exit with the prisoner adjacent. Escorting can be passed by freeing again from another adjacent hero (re-target escort; no roll).
- **Recover**: an heirloom item (2 slots, value 60 at L1 / 120 at L2 for selling, plus the bounty) lies at the site. Extracting it in a pack completes the contract.

## 10. Rivals: the Lantern Sisters

- One crew of 3 sisters (HP 7, 3 slots, 55%, 2 dmg, move 4) on some delves: 50% chance per delve, enters at a rival entrance on round 3 to 6 (seeded).
- Neutral at first. Goal 'loot': they walk to the nearest unopened chest or coin pile they know of (they know the map), open it and take everything. On a recover contract, if they reach the heirloom first, they take it (goal 'objective'). After 3 pickups, or when light ≤ 18, goal 'leave' → walk to their nearest exit and go.
- Spotted: when a hero sees one, `spotted` = true and their goal shows in the UI.
- Neutral sisters don't attack. They become **hostile** if a hero attacks any of them, or if a hero blocks their only path for a full round. Hostile sisters hunt the nearest hero and fight.
- **Bribe**: a hero within 2 hexes of a sister with at least 40 gold in packs may `bribe` (action): 40 gold from the party's packs, stance 'bribed', goal 'leave'; they drop the heirloom if they had it.
- Killed sisters drop their loot on the ground. Sisters who leave take their loot with them.
- Hire/ally: future follow-up.

## 11. Delve end and summary

- `summary`: contract done, bounty, loot value carried out, survivors, wounded (revived heroes, wounded = 2), dead, XP and level-ups, notes ("The Lantern Sisters took the chapel chest").
- `backToCamp`: applies the summary to the campaign (gold, stash items, XP, wounded counts, fallen, lostGear, litBraziers, reputation, delveCount, prisoner recruit), refreshes board and recruits, stage 'camp'. If Hobart died, stage 'over'.
- Stash items taken on the delve but not carried out are lost.

## 12. Determinism

- All randomness from `state.rng` (mulberry32 state, see src/rng.ts). Same seed + same commands = same game.
- `serialize`/`deserialize` round-trip the whole state as JSON (version 3).

## 13. Not in the slice (later)

Levels 3 to 5, the Dragon, Sapper class, other crews, hiring/allying rivals, relight/eliminate/survey/hoard contracts, arcanist, traits, endless Deep Vaults mode.

## 14. V3.1: the three-level castle

Approved layout: the Castle Map Proposal, pass 2 (https://claude.ai/artifact/C8o5Sz4x4ngXzSMDG6cHsQ), drawn by mockup/sketch.py (images in mockup/shots/level1-3.png). Design intent: the redesign pitch (https://claude.ai/artifact/Do2xMUkTkDjgGjPRimNJJd). This section overrides earlier sections where they disagree.

### 14.1 Levels

- Level 1, the Ruined Keep; Level 2, the Crossing; Level 3, the Hollow. Light burns 1 per round on every level.
- Exits: Level 1 main gate, sally port, east breach; Level 3 cave mouth (open from the start; the cost of using it is the long walk). No exits on Level 2.
- Links: tower stair (L1 north-east) to the guard post (L2); the lift (L2 winch room to L3 lift base) runs once the winch is worked; the Sealed Stair (L3) is a sealed door, not usable.

### 14.2 Falling

- Pits are columns. Something entering a pit hex falls straight down: on each lower level in turn, if the tile at the same (q, r) is walkable it lands there (if occupied, the nearest free walkable hex within 3); if it's pit, it keeps falling. Level 1's pit mouth lies partly over Level 2's bridges, so a jump there may land on a bridge.
- Damage: 4 for one level, 7 for two. Armor doesn't help. A fall that kills a monster counts as a kill.
- Ways to fall: Jump (a hero action from a hex next to a pit: pick the pit hex), being shoved, a blast. Walking never steps into a pit.
- Rope: anchored at an edge hex; Climb from that edge goes to where a fall from the adjacent pit hex would land, with no damage, and back up from that landing hex. Uses move and action.
- Railing: an edge hex with `railing` can't be shoved off on its pit side. Level 1's pit mouth has only a few bits of railing; the arcade on Level 2 is railed except at its broken gaps.
- Jump preview: `warning` names the drop ("Falls 2 levels into the Hollow: 7 damage. This will down Pim.") and `confirm` is true for drops of more than one level; the UI asks before sending.
- `edgeRisk(heroId)`: the worst fall a shove could cause from where the hero stands (null if none). The UI shows an edge badge on the hero card and a red lip under the hero.

### 14.3 Shoves and knockback

- Hero Shove (action, adjacent target): 2 Might slots; 2 hits push it 1 hex straight away; 1 hit, nothing; Perfect also deals 1 damage. Into a pit hex: it falls. Into a wall or prop: 1 damage. Into another figure: both take 1. Into a fire (forge, vent, burning hex): 3 damage. The Dragon can't be shoved. The preview's outcomes name the landing hex result.
- Orcs: if a hero they could attack stands on an edge so that the hex straight behind them (away from the orc) is an unrailed pit, the orc's intent is `shove` instead of attack (60% chance to land, no roll shown to the player beyond the intent). The intent shows `to`.
- Berserker: its charge (moving 2+ hexes then attacking) knocks the target back 1 hex after the hit.

### 14.4 The Dragon

- 30 HP, armor 1, bite 4 slots at 65% for 3, moves 3, never leaves the Lair room. Starts asleep; wakes when a hero enters the Lair room or noise of 4+ reaches it.
- Breath: every other round once awake, its intent is `breath` with `hexes` = a 5-hex straight line from its hex toward the nearest hero (hexes in that direction); the next world phase every hero on those hexes takes 4 (no roll, ignores armor). Noise 6.
- Tail sweep: when not breathing and 2+ heroes are adjacent, intent `sweep`: every adjacent hero is shoved 1 hex away.
- Otherwise it bites the nearest adjacent hero, or moves toward one.
- Fire vents: walkable hexes listed in `castle.lights` with kind 'fire' and radius 1 (only those count as vents). Ending a move on one, or being shoved onto one, deals 3. The forge's fire is a tallprop with a 'fire' light next to it.
- The hoard: 3 hoard items (2 slots each, worth 300 each) on the ground around the Dragon's spawn. A Burglar can take them while it sleeps (taking is silent).
- Contract `slay`: unlocks at reputation 3; bounty 500; done when the Dragon dies and at least one hero gets out alive. XP for the kill +10 split among the heroes in the delve.

### 14.5 Sight and fixed light

- Sight range (layout glimpse and unit sight): bright 8, dim 6, dark 4, pitch 2; minus 1 on Level 2 and minus 2 on Level 3; never below 2.
- Fixed lights (`castle.lights`): each lights its radius for good (sconce 2, daylight 3, fire 3, fungus 2, glow 2). Lit hexes count as lit for penalties and for sight.
- Any lit hex in line of sight is visible from up to 14 hexes regardless of sight range (but only the lit hexes, not the dark ones between).

### 14.6 The winch and lift

- `winch` action: a hero next to the winch (the tallprop at the link's `winch`) works it: 1 action, noise 6, lift works for the rest of the delve. Then stepping from one lift tile to the other costs 1 movement, like stairs.

## 15. V3.2: squad building, classes, spells, gear, and polish

Owner's play-test notes (2026-10-24 evening). Design pillar added: **transformational over incremental.** Unlocks and gear should change how you approach the castle (a grappling hook, a blink spell) rather than add +10%. A heuristic, not a hard rule. This section overrides earlier ones where they disagree.

### 15.1 Line of sight polish (owner's screenshot: docs/agents/v32-los-bug.png)

- Reveal is patchy: holes of unrevealed floor inside seen rooms, and walls missing next to seen floor. Fix: a hex is in sight if a line from the viewer's center to the target's center OR to any of the target's 6 corners (pulled 10% toward the center) is clear (permissive LOS). Walls, pillars and tall props next to any revealed floor hex in sight are revealed too. Pits don't block sight; closed doors and tall props do. Same rule for heroes, monsters and the glimpse.

### 15.2 Move, then move again

- A hero who has moved and not acted may spend their action on a second move (a **dash**, XCOM style): same allowance, walk or sneak. A hero who dashes has used their action. Acting first and then moving stays allowed. The UI shows the dash range in a second colour once the first move is spent.

### 15.3 Squad building

- A new campaign starts with **Lord Hobart alone** and 160 gold. The tavern offers 4 recruits (refreshed after every delve, at least 3 different classes), price 40 + 20 × (level − 1). The first delve needs at least 1 hero.
- Classes (Hobart stays as he is). Mage splits into three schools. Hero.cls values: 'hobart' | 'sellsword' | 'burglar' | 'ranger' | 'sapper' | 'pyromancer' | 'shadowmancer' | 'hedgewitch'.

| Class | HP | Might | Finesse | Wits | Nerve | Weapon | Armor | Kit and abilities |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Sellsword | 10 | 70 | 45 | 40 | 60 | Sword 3 Might, 2 | 1 | Guard (as now). Shove gets +1 slot. |
| Burglar | 7 | 40 | 75 | 60 | 50 | Dagger 2 Finesse, 2 | 0 | Pick (as now), sneak 4, backstab. Takes and opens chests silently. |
| Ranger | 8 | 45 | 75 | 60 | 55 | Longbow 3 Finesse, 2, range 6, noise 1 | 0 | Overwatch: spend the action; in the next world phase, shoot (full roll) the first enemy that moves or acts in sight within 6. Knockback shot: 2 Finesse slots at range ≤ 5, 2 hits push the target 1 hex away from the Ranger with all shove outcomes (pits!). Adjacent bow shots lose 1 slot. |
| Sapper | 10 | 65 | 50 | 45 | 60 | Hammer 3 Might, 2 | 1 | Starts each delve with 2 free charges. Throw a charge up to 3 hexes (in sight). Dig: clear rubble or a cracked wall next to them without a charge (action, noise 4). |
| Pyromancer | 6 | 30 | 50 | 75 | 55 | Staff 2 Might, 1 | 0 | Mana 3. Firebolt (1), Fireball (2: radius 1 at range ≤ 5, 3 Wits slots, 2 dmg per hit to everything there, allies too; noise 6; sets the hexes burning for 2 rounds), Kindle (1). |
| Shadowmancer | 6 | 30 | 55 | 75 | 50 | Staff 2 Might, 1 | 0 | Mana 3. Veil (1: an ally within 3 can't be seen by monsters for 2 rounds or until they attack or make noise ≥ 4), Sleep (1: 2 Wits slots at range ≤ 5, 1+ hits puts a monster to sleep; not the Dragon or the Gloam), Blink (1: teleport up to 4 hexes to a free hex in sight on the same level, across pits and gaps; silent). |
| Hedgewitch | 7 | 35 | 50 | 70 | 65 | Staff 2 Might, 1 | 0 | Mana 3. Mend (1: heal 4 within 3), Ward (1: an ally within 3 takes 1 less per hit, minimum 0, for 2 rounds), Gust (1: every figure within 1 of a hex at range ≤ 4 is pushed 1 hex away from it with all shove outcomes; noise 2). |

- Existing 'mage' heroes in old saves: saves are reset (save key `vc.save.v32`).

### 15.4 Quartermaster

Current: torch 10, potion 20, rope 15, blasting charge 30. Add (all go in a pack slot; thrown items use the hero's action, range in hexes, need sight):

| Item | Price | Effect |
| --- | --- | --- |
| Smoke bomb | 20 | Throw 4: the hex and its neighbours fill with smoke for 2 rounds. Smoke blocks sight both ways; monsters lose track of heroes inside (go alert). |
| Glue bomb | 25 | Throw 4: every monster within 1 of the hex is stuck (can't move) for 2 rounds. |
| Sleep dart | 25 | Throw 5 (any hero): 1 Finesse slot; a hit puts a monster to sleep (not the Dragon). Silent. |
| Caltrops | 15 | Scatter on an adjacent hex: the first monster to step on it takes 2 and stops moving that turn. Lasts the delve. |
| Grappling hook | 40 | Reusable for the delve. From a pit landing or a pit floor hex, climb straight up to the level above (to the edge hex nearest the column) — getting back up without a rope already placed. Uses move and action. |
| Skeleton key | 30 | Opens one locked door or chest, silently, for anyone. One use. |
| Oil flask | 20 | +10 lantern light. |
| Firecracker | 10 | Throw 6: noise 6 at the target hex (lure monsters away). |

### 15.5 Camera on enemy actions (view)

- During the world phase, when a monster, rival or the Dragon acts or moves where any hero can see it (or it attacks a hero), the camera switches to that level and pans to it for the event, then moves on; at the end of the world phase it returns to the selected hero. Speed setting applies (instant skips the pans). Events nobody can see stay off camera.

### 15.6 Unlooted chests (view)

- An opened chest with items still on its hex (or ground loot heroes have seen) glows gold and shows a small coin marker until taken.

### 15.7 Visual clarity, with intention (design pillar, owner 2026-10-24)

Don't spoonfeed, but once something is in view, use visual hints to say what matters and what the player can do with it. The red edge lip is the model. Two play-test failures drove this: the player couldn't find how to take the tower stairs (the destination hex is on the other level, so nothing on screen offered it), and couldn't pick up a recover heirloom (it needs 2 pack slots; `take` silently skipped it).

- **Stairs and lift read as what they are.** Stairs: real descending steps into a dark opening (or rising, for the way up) with a level marker floating over them ("↓ L2" / "↑ L1") once explored. Lift: a cage with chain and the same marker ("Lift ↓ L3", greyed with "needs the winch" until it works). Hover tooltip names the interaction: "Stairs down to the Crossing. Stand on them, then Take stairs."
- **Taking stairs is a button.** A hero standing on stairs (or a working lift) gets a prominent action-bar button "Take stairs ↓ Level 2" (hotkey), and the hex pulses. Clicking the hex you stand on also takes them. The UI builds this from `reachable` (the entry whose `to.level` differs, path length 1); no engine change.
- **Objectives are beacons.** Once its hex is explored, the contract objective (heirloom, prisoner, the Dragon) gets a tall soft light pillar and a diamond marker in the contract colour, and the HUD goal box says where it is ("Heirloom · Level 1, the chapel · seen") and pans the camera there on click. Before it's explored, the goal box only names the room from the contract brief.
- **Take never fails silently.** `ActionOption.blocked?: string`: an option that applies here but can't be done now is still returned, with the reason; the UI shows it greyed with the reason on hover and as a flash on click. For take: "Heirloom needs 2 pack slots. Drop something first." When several items lie on a hex, take picks the contract item first; the preview lists exactly what will be taken.
- **Every interactable announces itself on hover:** outline + tooltip naming the interactions. Doors ("Door · walk through"), locked ("Locked · Pick, Smash or Charge"), chests ("Chest · Open" / "Locked chest"), braziers ("Brazier · Light: +6 lantern, lit for good"), winch ("Winch · work it to run the lift, loud"), exits ("Way out · Leave the castle"), pit edges ("Pit · Jump or Rope"), cracked walls ("Cracked wall · Charge or Sapper's Dig"), the sealed door ("Sealed. Nothing opens it yet."), ground loot ("Loot · Take").
- **HUD hierarchy.** Primary: light meter, goal, the selected hero's move/action state and action bar. Secondary: hero cards, round, levels. Tertiary: log, settings. Action bar grouped (Move · Interact · Abilities · Items · End turn) with visible hotkeys; End turn shows how many heroes still have moves or actions and asks once when any do. Hero cards: pack shown as item icons with slot count, statuses as small badges (webbed, veiled, warded, overwatch, edge). A one-line context hint under the bar names nearby interactables ("Stairs here · Chest 2 hexes north").
- **Markers only for what you've seen.** Beacons, markers and hints appear for explored hexes only, so exploration still means something.

### 15.8 Style and scale (owner, 2026-10-24 evening; view only)

- **Figure scale like Old School RuneScape.** A hero or monster stands about as wide as its hex and roughly two hexes tall, chunky and readable, with a clear silhouette per class and kind. Today's figures are small on their hexes. Monsters scale with menace: rats low, orcs hero-sized, berserker a head taller, spiders wide. The camera's default distance and the HUD overlays (HP bars, intent icons, markers) adjust to the new height.
- **The Dragon is big.** About three hexes long and two tall, with a wingspan over the hoard; asleep it fills the Lair's centre, awake it rears higher than any wall.
- **Thin walls, visually.** Tiles and rules stay as they are (a wall is still a whole hex). The renderer draws a built wall hex as a thin wall panel along each of its edges that faces floor, with the pale cap and dark face, instead of a solid block, so rooms have thin walls between them and the floor area reads larger. Interior wall hexes with no floor neighbour stay solid fill, so the castle still has mass. Cave walls (the Hollow, and any room with material rock/earth) stay thick rock. Pillars stay columns. Walls still drop low between the camera and the party.
- Keep the look consistent across the three levels and recheck that doors, railings, braziers and sconces sit correctly on the thinner walls.

## 16. V3.3: fear by depth (owner's play-test, 2026-10-24 night; plan approved 22:00)

Overrides earlier sections where they disagree. One delivery.

### 16.1 Awareness and patrols

- **Default awake.** `SpawnDef.asleep` defaults to false. Sleepers are chosen by the map: Level 1 rats and the spider; Level 2 only the barracks squad; Level 3 only the Dragon.
- **Patrols.** `SpawnDef.patrol?: Pos[]` is a looping route of waypoints (first waypoint = spawn hex). Awareness 'patrol': each world phase the monster walks its move allowance along the route (shortest path to the next waypoint). It notices heroes by the sight rule below and goes hunting. Once a hero has seen a patroller walk, its route is known (`Delve.knownRoutes` holds the monster id) and the UI may draw it.
- **Noticing.** An awake monster sees a hero within its sight (6) and line of sight if the hero is lit or within 3 hexes. In the Hollow (level 3) monsters see heroes in sight regardless of light. Seeing a hero → hunting. Noise rules unchanged.
- **Giving up.** A hunting monster that loses sight goes alert at the last seen hex and searches for 3 rounds (`searchRounds`), then returns: patrollers to the nearest waypoint and resume, others to their post (`spawnedAt`) and go alert-at-post (not asleep).

### 16.2 Light

- **Lantern 20.** `LIGHT_MAX` 20; a delve starts full. Stages: bright > 12, dim 7..12, dark 1..6, pitch 0. Lantern radius by stage unchanged (4/3/2/0). Burns 1 per world phase while open, on every level.
- **Shutter.** `shutter` is a free action for the lantern bearer, any time in the player phase, toggling `Delve.lanternOpen`. Shuttered: no burn, no lantern light. Passing the lantern keeps its state. The delve starts with it open; the UI may offer to start shuttered on Level 1.
- **Sight per hero.** `sightRange(state, heroId)`: if the hero's hex is lit (lantern, torch, brazier, fixed light) the stage range (8/6/4/2), minus the depth penalty as before (−1 on L2, −2 on L3, min 2). If unlit: Level 1 → 4, Level 2 → 2, Level 3 → 1. The glimpse (layout reveal) uses the same per-hero range. Visibility is the union over active heroes. Lit hexes in line of sight remain visible from up to 14 regardless.
- **Fuel economy.** Oil flask +8 (price 15). Torch unchanged (10 gold, 12 rounds, radius 2). Brazier relight +4. Kindle +6. Everything else as before.
- **The Gloam in the Hollow.** On Level 3, whenever any active hero stands in an unlit hex, the Gloam is present: if absent it rises at a dark hex 4..6 from the nearest unlit hero (out of sight if possible), awareness hunting. Each world phase it moves 3 toward the nearest unlit hero (any route through dark hexes; it never enters a lit hex) and strikes an adjacent unlit hero for 4, ignoring armor. It cannot be harmed or shoved. If no hero on Level 3 is unlit for 2 consecutive world phases, it fades. Levels 1 and 2 keep the pitch-black rule (section 5). Message on rising: "The dark here is awake." No grace period.
- **Light sources per level** (data): Level 1 abundant daylight (courtyard, gatehouse, the great hall's collapsed roof, corridors), so most of the level is navigable shuttered. Level 2 sparse: a few sconces, the forge, the pit glow. Level 3: only the Lair's fires and vents, the fungus grove, the pit glow.

### 16.3 Difficulty by depth

- **Tiers** applied at spawn to every monster except the Dragon and the Gloam: Level 2 +2 max HP, +5 hit chance; Level 3 +4 max HP, +10 hit chance, +1 damage.
- **Roster** (data): Level 1 adds two awake orcs and one patrol through the great hall. Level 2: orcs move as squads of 3–4, two more spawns, and orc archers on the arcade and ledges; an orc captain with the barracks squad. Level 3: ghouls buried in the Bone Pile; cave spiders; all awake.

### 16.4 New monsters and abilities (every ability shows as an intent the round before)

| Kind | HP | Slots | Hit | Dmg | Move | Behaviour |
| --- | --- | --- | --- | --- | --- | --- |
| archer (orc) | 5 | 2 | 55 | 2 | 3 | Shoots at range ≤ 4 in sight; keeps 2–4 away, backs off if adjacent. Knockback shot (intent `shove`, 60%) when a hero within 4 has an unrailed pit straight behind them. |
| captain (orc) | 9 | 3 | 60 | 2 | 3 | Armor 1. Shield wall: orcs/archers adjacent to it take 1 less per hit (min 1). Shout (intent `shout`, cooldown 4): the next phase every orc/archer/captain within 8 wakes and hunts the shouter's target. Shouts on first sight. |
| ghoul | 7 | 2 | 60 | 2 | 4 | Buried (not on the map) until a hero ends a move within 2 of its hex; then rises hunting (`spawned` event). Grab (intent `grab`, adjacent): the hero is held (`grabbedBy`): can't move or dash; the ghoul gets +1 slot against them. Escape: the hero's action, 2 Might slots, 1 hit frees; killing the ghoul frees. One hold per ghoul. |
| spider | as now | | | | | Web, then next round `drag`: pulls the webbed hero 1 hex toward it with shove outcomes (pits count). |

Existing: berserker knockback, cutpurse theft, orc shove on edges, the Dragon.

### 16.5 The Lantern Sisters' kit

Each sister has a class (`Rival.cls`) and uses the heroes' own rules, intents shown like monsters:
- **Ranger sister:** overwatch when hostile and no hero in reach; knockback shot on a hero within 5 with a pit behind them.
- **Shadowmancer sister:** veils herself when first spotted; drops a smoke bomb on the hero nearest her when any sister falls below half HP (once per delve).
- **Burglar sister:** sleep dart (1 slot, 65%) on the nearest hero within 5 when hostile (two darts per delve); when neutral, loots chests the heroes have opened but not emptied.

### 16.6 Data defaults

- Monster hit/damage/HP tables stay in src/game/data.ts; tiers in the same file. Patrol routes, sleepers, buried ghouls and lights are castle data (src/data/castle).
