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

### 15.8a Scale decision (owner, 2026-10-24 22:07)

From the three-panel study (mockup/shots/scale-options.png, mockup/scale-options.ts): **option C, "RuneScape"**: hero 2.0 units tall, natural blocky proportions (head 1/5, limb thickness 0.07, shoulders 0.34, legs 0.44 of height), rat 0.35x, spider 0.8x, orc 1.05x, walls 2.6 (thin), Dragon as is. "Good enough for now"; the owner wants to revisit scale and proportion later.

## 17. V3.4: tighter purse, wounds that stay, darker falls (owner's play-test, 2026-10-24 late night)

Overrides earlier sections where they disagree. Rival crews and the pub are proposals only (https://claude.ai/artifact/PttJ4kNWutJvUAegNgAxeA), not built.

### 17.1 Starting economy

- A campaign starts with **120 gold** (`START_GOLD`). Recruits cost **60 + 40 × (level − 1)** (`RECRUIT_PRICE`, `RECRUIT_PRICE_PER_LEVEL`): level 1 60, level 2 100. The opening tavern offers only level 1 recruits; after the first delve 35% are level 2 as before.
- So a new player can afford two level 1 hires and nothing else, or one hire and about 60 gold of gear (torch 10, rope 15, potion 20, firecracker 10). Shop prices are unchanged.

### 17.2 Wounds carry over; the infirmary charges per HP

- `Hero.hp` (campaign) carries between delves. A delve starts each hero at their campaign HP (at least 1); a survivor's HP when they leave is written back, and level-ups add +2 to both HP and max HP. Nothing heals for free between delves.
- Infirmary: `heal` restores HP at **3 gold per HP** (`HEAL_PER_HP`) up to full, or as much as the gold covers. The UI also offers "Heal everyone".
- The old wounded rule (revived heroes sit out 2 contracts; heal 30) is gone: a revived hero just comes out with the HP they have. `Hero.wounded` stays in the type, always 0, until it's removed. `DelveSummary.wounded` lists survivors below full HP.

### 17.3 View and HUD (no rule change)

- Hero torsos taper and lose their box corners. Walls stand at full height at every camera angle (the cutaway is off; a setting brings it back).
- Hero cards: the pack is a row of 4 sockets with names and uses on hover; no overlap with the light panel; every action, item, status, stage and pip explains itself on hover with the real numbers (Kindle: +6 lantern light for 1 mana, silent).

### 17.4 Sight in the dark: far lights and fixed-light sight

Owner's screenshot (docs/agents/v34-fall-reveal.png): a hero who jumps unlit into the Hollow saw the whole Lair and the Bone Pile, because any lit hex in line of sight showed from up to 14 hexes.

- **Far lights.** Beyond a hero's own sight range, only light sources show (up to `LIT_SIGHT` 14, in line of sight): the hex of a fixed light other than daylight (fire, fungus, glow, sconce), a lit brazier, a burning hex, the open lantern's bearer, a hero with a lit torch. The floor they light is not revealed until a hero is within sight range. Daylight still shows its whole lit patch (Level 1 stays navigable shuttered). Walls next to seen floor are revealed as before, but not around far lights. `farLit(w, d)` in src/game/world.ts.
- **Sight in a castle light.** A hero's sight range when their hex is lit depends on what lights it: the party's own light (the open lantern, a lit torch) gives the stage range minus depth as before; daylight gives 8; any other light (fire, brazier, sconce, fungus, glow, burning) gives 4 minus depth (`FIXED_LIGHT_SIGHT`), never below 2. Unlit is unchanged (4/2/1). So landing in the pit glow in the Hollow gives sight 2, not 6.
- Check: scripts/v34-fall-reveal.ts (shuttered two-level jump: Level 3 explored on landing went from 118 hexes to 28).

## 18. V3.5: The Heir's Return (owner, 2026-10-25; decisions in https://claude.ai/artifact/PttJ4kNWutJvUAegNgAxeA)

Overrides earlier sections where they disagree. Contract: `git diff v3.4 -- src/game/types.ts src/game/api.ts`.

### 18.1 Story

- The game is *Valkenburg Castle: The Heir's Return*. **Keven** (hero id `keven`, class `heir`; was Hobart) is the long-lost heir, son of the late Lord Hobart, the castle's last ruler. Same stats and Rally as before. If Keven dies the campaign ends: "The heir has fallen. Valkenburg stays dark."
- Keven camps in **Lowgate**, the derelict village under the castle walls. Save key `vc.save.v35` (fresh saves).
- New campaign intro (title screen / first camp): a few lines that set this up. Hobart appears only as lore (the father; "the Hobart Warhorn" heirloom stays).

### 18.2 The village (`Campaign.village`, all false at the start)

| Station | At the start | Won back by | Then |
| --- | --- | --- | --- |
| Notice post (board) | 3 contracts + pinned story contracts | | |
| Campfire (hiring) | 3 drifters, all level 1 | Old Wim (`innkeeper`) | Becomes the **Gilded Flagon**: 4 recruits, 35% level 2. With `caskbook`: 25% level 2, 10% level 3 |
| Peddler (quartermaster) | Everything except metalwork | Gerda (`smith`) | Caltrops, grappling hook, skeleton key (`ShopOffer.needs: 'smith'`) |
| Forge (smithy) | Cold: no upgrades | Gerda (`smith`) | Weapon and armor tiers as before |
| Infirmary | No surgeon: only `drink` | Brother Aldric (`surgeon`) | `heal` at 3 gold per HP (17.2) |
| Keven's cart (stash), the graves (memorial) | As before | | |

- `drink` (camp, always): a hero drinks a potion from the stash: +5 HP, up to max.
- Recruit price: 60 + 40 × (level − 1) (level 3: 140).
- Refusals name the fix: "The forge is cold. Rescue Gerda the smith (Level 2, the cellblock)."

### 18.3 Story contracts (`Contract.story`)

| Story | Kind | Site | On the board when | Subject |
| --- | --- | --- | --- | --- |
| surgeon | rescue | l1-rescue-library | from the start | Brother Aldric |
| innkeeper | rescue | l1-rescue-library | reputation ≥ 1 | Old Wim |
| smith | rescue | l2-rescue-cell-west | reputation ≥ 1 (Level 2 open) | Gerda the smith |
| copper | recover | l2-recover-forge | `innkeeper` home | the brewing copper |
| caskbook | recover | l3-recover-drain | `copper` home and Level 3 open | Wim's cask book |

- Every available story contract (prerequisites met, not done) is pinned on the board in addition to the 3 regular ones. Bounty: half the regular bounty for its kind and level (rounded down to 5). Reputation +1 as usual.
- A rescued story villager does not join the roster; on `backToCamp` the village flag is set and a `villageUnlocked` event fires with a line ("Brother Aldric sets up in the old chapel. The infirmary is open.").
- Story recover items: the brewing copper (2 slots, `heavy`: its carrier's move and dash allowance is 3, value 0); Wim's cask book (1 slot, value 0). Both have `story` set: carried out, they go to the village, not the stash; they can't be sold.

### 18.4 Ales (the Flagon, once `copper` is home)

`buyAle` puts the ale on `Hero.ale`; it is drunk when that hero starts their next delve (`HeroInDelve.ale`), then cleared. One per hero; buying a second is refused until the first is drunk.

| Ale | Price | Needs | Effect for one delve |
| --- | --- | --- | --- |
| Glowworm Pale | 15 | copper | The drinker sheds party light radius 1 (counts as their own light: never unlit, so the Gloam never targets them) |
| Featherfoot | 15 | copper | The drinker's first fall deals no damage (`aleSpent`) |
| Mole's Brown | 20 | copper | The drinker can Dig like a Sapper (rubble or a cracked wall next to them, action, noise 4) |
| Hobart's Reserve | 20 | copper | The drinker's Focus starts at 4 and its max is 4 |
| Smuggler's Mead | 20 | caskbook | Sneak moves 4 and sneaking makes no noise |
| Fireside Porter | 25 | caskbook | Heal 3 each time the drinker changes level (stairs, lift, fall, rope, hook), after any fall damage |
| Black Cask | 10 | caskbook | At delve start (seeded): 70% one of the six above at random; 30% a drawback: hiccups (noise 1 at the drinker every world phase) or heavy head (Focus starts at 1) |

### 18.5 Rival crews

- **Which crew:** a Level 1 contract may draw the **Lantern Sisters** (prospectors, 50%, as now). A Level 2 or 3 contract may draw a **cutthroat** crew (60%), picked from the pool by the seeded RNG, waiting from round 1 at a post on Level 2 (`CastleDef.rivalPosts`, choke points). Never both in one delve.
- **The pool** (L2 tier applies: +2 HP, +5 hit):
  - **The Ferrymen:** a Sellsword (HP 10, 3 slots 60%, 2 dmg, armor 1; shoves a hero standing at an unrailed edge, intent `shove`, like the orc), a Ranger (as the Sisters' ranger), a Sapper (HP 9, hammer 3 slots 55% 2 dmg; 1 charge: intent `charge` on a hex in range 3 the round before, then 3 damage to everyone within 1 of it, noise 8).
  - **The Gallows Choir:** a Sellsword, a Burglar (as the Sisters' burglar: sleep darts), a Pyromancer (HP 6; 3 firebolts: intent `firebolt` on a hero in range 5 and sight, then 3 Wits slots at 60%, 2 dmg per hit, noise 3).
  - Each cutthroat starts with 30 gold in its loot (dropped when killed, with whatever else it took).
- **Prospectors** behave as now (loot, leave; hostile when attacked or blocked).
- **Cutthroats** wait at their post (`waiting`, don't move). When any hero comes within 6 in line of sight of a member, or makes noise ≥ 4 they hear: stance `demanding`, `toll` = the larger of 50 and half the gold value the party carries (rounded to 5), the leader's intent is `toll` ("Your gold or your blood"). They don't attack that world phase. At the next world phase, still `demanding` → `hostile`, hunting.
- **Aim:** while a crew is spotted, `RivalCrew.aim` names what they're after (the chest or pile, rounds to reach it, its estimated value) for the parley card.

### 18.6 Parley (`deals`, the `deal` command)

- Any active hero within 4 hexes of a visible crew member, in line of sight, may make a deal. Deals are free (no move or action); one deal per crew per round.
- Prices (× 1.5 on Level 2 and deeper, rounded to 5):

| Deal | Price | Available | Effect |
| --- | --- | --- | --- |
| leave | 40 | not hired | Stance `bribed`, goal leave now; they drop the heirloom or prisoner |
| truce | 25; the toll while demanding; 50 if hostile | not hired, not truce | Stance `truce`: they never attack unless attacked; prospectors keep looting, cutthroats stay at their post |
| job | 30 | neutral, truce, waiting | `winch`: they walk to the winch on their level and work it (lift runs); `open`: the nearest seen locked door or chest on their level, opened silently; `scout`: every hex within 8 of each member becomes explored now. Then back to what they were doing |
| hire | 60 | not hostile | Stance `hired` for 5 rounds: they keep within 2 of the hero who hired them and attack monsters in reach (intents shown). When the rounds end, if the party carries loot worth ≥ 150, 25% they turn `hostile` (`betrayed`); otherwise prospectors go back to looting, cutthroats to `truce`. `risk` shows the odds before you hire |
| fight | free | not hostile | Stance `hostile` now |

- **Payment** from the party's packs (every active hero): gold coins first, then gems and jewelry, smallest value first, until the price is covered; no change given. Heirlooms, hoard pieces and story items are never handed over. Not enough → `blocked`: "You carry 25; they want 40." `pays` says what would go ("35 gold and a ruby (60)").
- Attacking a crew that is `bribed`, `truce` or `hired` turns it `hostile`; they keep what they were paid.
- The old `bribe` action is replaced by the deal card; the `parley` action exists so the action bar can offer it.

### 18.7 Presentation

- Title, intro and camp text for Keven and Lowgate; stations named as in 18.2, locked ones showing who to rescue and where. Story contracts pinned with their own look. The village unlock gets a moment on return to camp.
- The Flagon station: the ale menu (locked ales show what brews them), choose an ale per hero; the hero card in camp and in the delve shows the ale.
- The parley card: crew name and temperament, stance, members, what they're after (`aim`), and each deal with price, what it pays with, risk, blocked reason; Fight as a button. Cutthroat toll intent reads clearly as a demand with a one-round fuse.
- Models: rival Sellsword (shield), Sapper, Pyromancer by crew colours; hired crews marked as allies.

## 19. V3.6: play-test fixes (owner and play-testers, 2026-10-25 midday)

Overrides earlier sections where they disagree. The bigger asks from the same notes (stealth and aggro, the Sapper, tougher crews, attacks of opportunity) are proposals awaiting approval, not in this section.

### 19.1 Villagers in places that make sense (`ContractSiteDef.story`)

Story sites are used only by their story contract; the regular board never picks them. Each villager has their own place and reason:

| Story | Site (new) | Room | Why they're there |
| --- | --- | --- | --- |
| surgeon | l1-story-chapel, Level 1 Chapel | Chapel | Brother Aldric slipped back into the castle to pick herbs from the physic garden in the courtyard and was taken. The orcs keep him in the chapel to patch up their wounded. |
| innkeeper | l1-story-kitchens, Level 1 Kitchens | Kitchens | Old Wim never got out. The orcs keep him at the spit in the kitchens, cooking for the warband. |
| smith | l2-story-forge, Level 2 Forge | Forge | Gerda barred the forge door the night the castle fell and has held it since, trading mended blades for food. The door is locked; she opens it to a knock from the heir (the hex next to her counts as adjacent through the door, or the door is simply unlocked from her side when a hero is adjacent). Simplest: place her inside the forge behind its door, door unlocked. |
| copper | l2-story-barracks, Level 2 Barracks | Barracks | The orcs dragged Wim's brewing copper to the barracks to brew their own swill. It sits among the sleeping squad. |
| caskbook | l3-recover-drain (as before) | The Drain | Wim's cask book was lost in the Drain when the cellars flooded. |

Briefs and the camp's "Lowgate" panel use these reasons (one sentence each). Sites are placed on floor hexes away from the room's existing regular site (if any), reachable, not on a spawn.

### 19.2 Locks: the Burglar picks; everyone else smashes, unless they carry lockpicks

- **Pick** is the Burglar's alone by default (as spec 2). Any other hero gets Pick only while carrying **lockpicks**: 2 Finesse slots (same outcomes table: 2 hits opens silently... use the Burglar table on 2 slots: 2 hits opens silently, 1 hit opens with noise 2, 0 jams). Lockpicks are reusable for the delve, 1 slot, 25 gold, `needs: 'smith'` (metalwork).
- Without Pick, a locked door or chest offers Smash, a blasting charge, or the skeleton key (one use, anyone, needs the smith) as before. Option text on a locked thing for a non-Burglar without picks: "Locked · Smash it, or a Burglar or lockpicks could pick it."

### 19.3 Night-eye draught

- `nightsight`, 30 gold at the peddler (always sold), 1 slot. Drinking it is an action (`nightsight`), silent: `nightEyes = 8` rounds, counting down each world phase.
- While it lasts: the hero's sight range is the bright-stage range minus depth (8/7/6) whatever light they stand in, and the brightness penalty to their rolls is 0. Nothing else changes: they are still unlit for monsters' noticing rules, the Gloam still hunts them unlit, far-light rules unchanged. The hero card shows a badge with rounds left.

### 19.4 Movement through friends

- Heroes pass through heroes, the prisoner and **hired** crew members; monsters and other rivals block. (Heroes already passed through heroes; hired crews blocked them, which is fixed.) A hero still can't end a move on anyone.

### 19.5 Exits read as the way out (view and HUD)

- Every exit hex, once explored, gets a floating marker like the stairs' ("Way out" with an arrow; the entrance you came in by reads "Way out · you came in here") and a doorway/light model at the hex, and the hover tooltip "Way out · stand here, then Leave the castle".
- A hero standing on an exit gets a prominent bar button "Leave the castle" (hotkey), and the hex pulses, the same pattern as "Take stairs".
- Once the contract's prize is in hand (heirloom in a pack, prisoner freed and escorted) the goal box switches to "Get out: nearest way out is the main gate, 14 hexes" with a click-to-pan, and known exits pulse softly on the map.
- The context hint names a nearby exit ("Way out 3 hexes east").

## 20. V3.7: stealth, free swings, the Sapper, crews that fight back (owner-approved 2026-10-25, https://claude.ai/artifact/CZWDajgUP9WrVr4L39HgXH)

Overrides earlier sections where they disagree. Contract: `git diff v3.6 -- src/game/types.ts src/game/api.ts`. The owner's one addition: you can sneak up on an enemy from the hex directly behind it.

### 20.1 Stealth and aggro

- **Walking noise** is 1 at every hex passed (2 on rubble), not only the destination. Sneaking stays silent. Sleepers and alert monsters react per hex as they do to any noise, except the wake roll below replaces the old "ends adjacent" rule for sleepers.
- **Sleeper wake roll.** For each hex a hero passes within 2 of a sleeping monster (not the Dragon: its own rule stands), roll once: walking 50%, sneaking 10%; halve it when the hero's hex is unlit. Ending the move adjacent to a sleeper: walking wakes it for sure; sneaking 25%. A woken sleeper goes alert at the hero's hex (`woke` event). Rolls use the seeded RNG; the same seed and path wake the same monsters.
- **Noticing** (replaces 16.1's numbers): an awake monster (alert, hunting, patrol, waiting crew) notices a hero in line of sight within: lit and walking 6; lit and sneaking 4; unlit and walking 3; unlit and sneaking 1. In the Hollow, light doesn't matter: walking 6, sneaking 3. Noticing fires a `noticed` event and the usual hunting behaviour.
- **Facing.** Every monster and crew member has `facing` (0..5): the direction it last moved, or toward the last thing it noticed or heard; sleepers face where they were placed (data may set it; default 0). The three hexes behind (the back direction and its two neighbours, at any distance) are its blind arc: a **sneaking** hero in the blind arc is noticed only when adjacent and walking in; a sneaking hero on the hex directly behind it is never noticed by it. Walking heroes are noticed in the blind arc at half range (3 lit, 1 unlit). Facing turns toward noise and toward any hero it notices or attacks.
- **Cover.** A sneaking hero whose end hex has a wall, pillar, tall prop or closed door between them and the monster (i.e. no line of sight) is not noticed by it that round. (Line of sight already blocks; this just states that sneaking doesn't change LOS.)
- **Sneak attack.** A hero's first attack on a monster that hasn't noticed them (asleep, or awake without that hero as `focus`): +1 slot. The Burglar's backstab stacks (+2 total on an unnoticed target).
- **Move preview.** `Reach.risks` is filled for every reachable hex: sleepers that would roll to wake along the path (with the chance), awake enemies that would notice the hero at the destination, and the free swings leaving provokes (20.2). The UI colours the path and marks the monsters.
- Veil, smoke and sleep work as before on top of this.

### 20.2 Attacks of opportunity ("free swings") and Dread

- **Provoke.** When a hero moves from a hex adjacent to an enemy to a hex not adjacent to it, that enemy gets one free swing: its normal attack with 1 slot fewer (min 1), no Focus, damage as usual. Enemies that can swing: hunting monsters and hostile crew members that have noticed the hero. Asleep, alert, patrol, webbed, glued, grabbed-holding, feared, downed, the Dragon and the Gloam don't swing. Once per enemy per hero move. Sneaking doesn't avoid it. Jumping into a pit from next to an enemy provokes. Being shoved, dragged, blinked, gusted or pulled by the hook doesn't.
- **Heroes swing too.** When a monster or crew member moves from a hex adjacent to an active hero to a hex not adjacent, and that hero has not acted this round (action still ready), the hero gets a free swing with their weapon at 1 slot fewer (min 1). Ranged weapons (bow) swing at 1 slot. The hero's action is not spent. Fleeing rats and cutpurses provoke. Overwatch is separate and stacks.
- **Events.** `swing` with hits and damage. The preview warns before the move: "Orc gets a free swing: 0–2."
- **Dread** (Shadowmancer, 1 mana, action): 2 Wits slots at range ≤ 5 in sight; 1+ hits: the target is `feared` for 2 world phases (`fearOf` = the caster). A feared monster or crew member spends its world phase moving its full allowance away from the caster (farthest reachable hex) and takes free swings from heroes it leaves, does not attack, and drops any hold (ghoul grab, spider web intent). Not the Dragon or the Gloam; the captain's shield wall doesn't help. Intent `flee` shows the round before. Noise 0.

### 20.3 The Sapper

- **Charges** everywhere now have a fuse (`Delve.fuses`). A charge goes off at the end of the world phase when `rounds` reaches 0 (fuse 1 = the end of the coming world phase). Blast: 4 damage to everything within 1 of the hex (the hex included), 2 damage within 2, and everything in the inner ring is pushed 1 hex away from the blast with all shove outcomes (pits count; walls 1 damage). Noise 8, heard on the levels above and below. Opens locked doors and chests within 1; breaks cracked walls within 1; **breaks built walls** within 1 on Levels 1 and 2 into rubble (`blown`), unless `unbreakable` or cave rock (material rock/earth) or a pillar. The `blast` event lists what broke. Kills count for the setter.
- **Set a charge** (`setCharge`, Sapper only, 1 charge, action): on an adjacent floor hex or an adjacent breakable wall/door/chest; `target.fuse` 1 or 2. Intent-like marker: the fuse number and the blast area show to everyone. Sappers also keep **Throw a charge** (range 3, fuse 1) with the same blast; the old `charge` (instant on a door/chest/cracked wall) and `throwCharge` are replaced: `charge` now means set with fuse 1 on the thing (for non-Sappers carrying a bought charge; the action name stays so the UI's Items group keeps working).
- **Satchel:** the Sapper starts each delve with 3 charges (was 2); bought charges in the pack add to them. **Blast shield:** the Sapper who set a charge takes 0 from it; other heroes take half (rounded down).
- **Dig** unchanged; digging clears blast rubble too.
- **Map:** built walls between two floor hexes on L1 and L2 are breakable. Data marks `unbreakable` on the tower stair's shaft, the lift shaft, the outer curtain walls and anything whose breaking would skip the level (castle.test: from every entrance, the shortest path to each contract site with all breakable walls broken is at least 60% of the path without).
- Rival Sappers use set-and-fuse charges on the party's path (intent `fuse`), with the same blast rules; they take 0 from their own.
- Tripwire/traps: later, as a forge upgrade (ideas-later).

### 20.4 Crews that fight back

- **Built like a squad.** `makeCrew` builds each member as a hero of its class at the crew's level with the class table (spec 15.3) plus +2 HP and +5 main stat per level above 1, `weaponTier`/`armorTier`, Focus 0, and a 4-slot `pack` by class (members use items with the heroes' own rules, intents shown the round before: `item` with the item kind, `potion`):

| Crew | Level | Tiers | Where | Members and packs |
| --- | --- | --- | --- | --- |
| Lantern Sisters | 2 | weapon 1 | L1 contracts (50%) | Ranger: 2 caltrops, potion. Shadowmancer: smoke, firecracker. Burglar: 2 sleep darts, smoke, lockpicks |
| The Ferrymen | 3 | weapon 1, armor 1 | L2 contracts (60%, pooled) | Sellsword: potion, glue. Ranger: 2 caltrops, potion. Sapper: 2 charges, glue |
| The Gallows Choir | 3 | weapon 1, armor 1 | L2 contracts (pooled) | Sellsword: potion, glue. Burglar: 2 darts, smoke, lockpicks. Pyromancer: potion, oil |
| The Wake (new) | 4 | weapon 2, armor 1 | L3 contracts (60%) | Sellsword: 2 potions. Hedgewitch: 2 potions. Shadowmancer: smoke, firecracker. Sapper: 3 charges |

- **How they use the pack.** Burglar: darts the lantern bearer first, smoke when two heroes have line of fire on a sister below half; Ranger: caltrops on the hex the nearest hero would charge through, overwatch when nobody is in reach; Sellsword: guards the crew's caster, glue on the hero front line when 2+ heroes are adjacent to each other; Sapper: set-and-fuse on the party's path (fuse 1), throw when a hero stands on a pit edge; Pyromancer: fireball when 3 heroes stand within 1 of a hex, else firebolt; Shadowmancer: veils the striker on first contact, firecracker to pull a nearby monster group toward the party, Blink away below half; Hedgewitch: Mend the member below half, Gust a hero at an edge, Ward the striker. Any member below half HP with a potion backs off one hex and drinks it (intent `potion`).
- **Focus fire.** A hostile crew picks one target per round: the lantern bearer in reach, else the lowest-HP hero in reach, and every member who can attacks it. Members use doors and pillars (they path to hexes with line of sight to the target and not to other heroes when possible).
- **Captives.** A hero downed by or within 2 of a hostile crew member is **robbed** (gold and gems to that member's loot, `robbed`) and then **dragged**: the member moves at 3 a round toward the crew's exit, the hero with it (`dragging`); other members keep fighting. Heroes can free them by killing or fearing the dragger, or by downing it; the hero stays downed where dropped. If the dragger reaches an exit: `captured`, hero status `captured`, the member leaves with them. On `backToCamp`: a captured hero leaves the roster into `campaign.captives`, keeping level and gear but losing gold and gems; a **rescue contract** "Bring back <name>" appears on the board (full rescue bounty for the level below where they were taken, site = the crew's hideout: a `ContractSiteDef` per crew, `story`-like so the regular board doesn't use it; the prisoner is the hero, HP 1; freed and extracted they rejoin at full roster state with the HP they came out with). A captured Keven ends the campaign: "The heir is taken. Valkenburg stays dark."
- **Spoils.** Killed members drop their pack and purse (30 gold at level 2–3, 50 at level 4).
- Parley, tolls, hire and betrayal (18.5–18.6) unchanged; hired members use their packs for the party. Deals pay from the heroes' packs as before.
- **Balance target** (sim, careful bot): L1 Sisters winnable with one hero below half; L2 crews ~50% without a plan; L3 avoid or parley below hero level 3.
