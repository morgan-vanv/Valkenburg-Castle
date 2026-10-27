# V3 spec: Hobart's Revenge to The Heir's Return (V3.0–V3.9.4)

> **Read `docs/current-rules.md` first.** This file is the version-by-version history: each section was the build spec for one release, and later sections override earlier ones (sections 1–13 are V3.0 and many of their numbers have changed). Section 22 (V3.8 exploration mode) was reverted and lives only on branch `shelf/exploration-mode` (see `docs/shelved/exploration-mode.md`). Where this file and the code disagree, the code wins; the known disagreements are listed at the end of `docs/current-rules.md`.

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
- **Captives.** (V4.0: only a hero helpless and alone, spec 28.8.) A hero downed by or within 2 of a hostile crew member is **robbed** (gold and gems to that member's loot, `robbed`) and then **dragged**: the member moves at 3 a round toward the crew's exit, the hero with it (`dragging`); other members keep fighting. Heroes can free them by killing or fearing the dragger, or by downing it; the hero stays downed where dropped. If the dragger reaches an exit: `captured`, hero status `captured`, the member leaves with them. On `backToCamp`: a captured hero leaves the roster into `campaign.captives`, keeping level and gear but losing gold and gems; a **rescue contract** "Bring back <name>" appears on the board (full rescue bounty for the level below where they were taken, site = the crew's hideout: a `ContractSiteDef` per crew, `story`-like so the regular board doesn't use it; the prisoner is the hero, HP 1; freed and extracted they rejoin at full roster state with the HP they came out with). A captured Keven ends the campaign: "The heir is taken. Valkenburg stays dark."
- **Spoils.** Killed members drop their pack and purse (30 gold at level 2–3, 50 at level 4).
- Parley, tolls, hire and betrayal (18.5–18.6) unchanged; hired members use their packs for the party. Deals pay from the heroes' packs as before.
- **Balance target** (sim, careful bot): L1 Sisters winnable with one hero below half; L2 crews ~50% without a plan; L3 avoid or parley below hero level 3.

### 20.5 Second play-test batch (owner, 2026-10-25 14:18; answers 14:30)

- **Free movement when calm.** `Delve.calm` is true when no monster is hunting on a level with an active hero, no crew is hostile or demanding, the Gloam is absent, no fuse is lit, and no hero is downed, grabbed, webbed or rooted. `Engine.calm(state)` says so with the reason when not ("An orc hunts Pim"). While calm, in the player phase: a `move` may have a path of any length (walk or sneak; stairs allowed; sneaking at calm costs nothing extra) and does not set `moved`; the engine walks it one hex at a time with all the per-hex rules (noise, wake rolls, noticing, traps, vents), counting `calmSteps`; every **4 steps** (`CALM_STEPS`) the castle takes a turn: a full world phase (light −1, torches, fuses, patrols, ales, searches) and a new round, then the walk continues. `follow: true` brings every other active hero within 3 of the mover along behind in single file along the same path (their steps are free: travelling together costs what travelling alone does); the lantern bearer's light moves with them. The walk **stops** (remaining path dropped, `calm` event with `calm: false`) the moment calm ends (something notices a hero, a sleeper wakes, the Gloam rises, a crew demands), a trap or vent triggers, a hero's HP drops, the lantern stage changes, or a new monster comes into sight; when it stops for combat, every active hero gets a fresh player phase (`moved`, `acted`, `dashed` false): the party acts first. Actions while calm work as before (they set `acted`), and End turn still runs a world phase. When calm begins again (every hunter lost or killed, etc.), `calm` fires with `calm: true` and the party is free to walk. The UI shows "Free move · the castle turns in N steps" and lets the player click any explored hex.
- **End turn warning** only for heroes who did nothing (neither moved nor acted); a hero who moved and kept their action is "ready", not "waiting", and raises no prompt. The bar note counts only idle heroes.
- **Brace** (`brace`: heir, sellsword, sapper; action, self): `braced` until the next player phase: every hit on them does 1 less (after armor, min 0) and enemies roll −15% against them; free swings by a braced hero are at full slots. Shown as a badge.
- **Shield** (`Hero.shield`, `buyShield` at the forge, 50 gold, needs the smith, any class): ranged hits (arrows, knockback shots, firebolts, darts' rolls count as ranged for the damage reduction only, the Dragon's breath no) do 1 less; while braced, 2 less. Shown on the hero card and the figure (a round shield on the back/arm).
- **Hamstring** (`hamstring`: anyone with a bow — the Ranger, orc archers and rival Rangers; action): 1 Finesse slot at −20%, range ≤ 5 in sight; a hit roots the target for 2 rounds (`rooted`/`stuck`: can't move or dash, can still act; a rooted hero can be hamstrung again to refresh). Monsters and rivals show the intent `hamstring` the round before. Noise 1.
- **Night thorn** (`nightthorn`, Shadowmancer, 1 mana): 2 Wits slots, 1 damage per hit ignoring armor, range ≤ 5 in sight, silent. **Briar** (`briar`, Hedgewitch, 1 mana): 2 Wits slots at range ≤ 4 in sight, 1 damage per hit; any hit roots the target 1 round, a perfect roll 2 rounds; noise 1.
- **Crates and barrels** (`smashProp`: any hero, adjacent crate or barrel prop; action; noise 4): the prop is gone (`Delve.smashed`; the hex is floor); seeded drop: 60% gold 3–12, 20% a small item (torch, potion, firecracker or caltrops), 20% nothing. `propSmashed` event with the items (placed as ground loot on the hex). Hover: "Crate · Smash: loud, may hold something".
- **Filed for later** (ideas-later): arrows as a purchasable consumable with specialty arrows as upgrades.

### 20.3a Blasting the floor (owner, 2026-10-25 14:34)

- A blast also works on the **floor** within 1 of its hex (the hex itself included): on Levels 1 and 2, a floor or raised-floor hex **adjacent to a pit hex** (an original pit or an already collapsed one) collapses into the pit column (`Delve.collapsed`; `kindAt` says 'pit'); anything standing on it falls by the normal column rules (14.2), fall damage on top of the blast's. Railings on a collapsed hex are gone. Every other floor or raised-floor hex within 1 becomes **rubble** (`blown`; move cost 2). The Hollow's floor only turns to rubble (nothing below). Never collapses or rubbles: stairs, lift, exits, doors, braziers, winch and other tall props, hexes with the Dragon's hoard, the Sealed Stair, and anything `unbreakable` (data marks the hexes on either side of the tower stair and the lift base).
- So a charge set or thrown at the pit's edge blows the edge away under whoever stands there; a charge on a bridge (floor over the column) drops the bridge and everyone on it into the Hollow. The blast preview shows the three outcomes by colour before you commit: break (walls), collapse (floor into the pit), rubble.
- The `blast` event lists `broke`, `collapsed` and `rubbled`. The level is redrawn: collapsed hexes as a ragged new pit edge, rubbled floor as rubble.
- Filed for later (ideas-later): charges that seal a hallway or bring a ceiling down (blocking tiles), after the owner play-tests this batch.

## 21. V3.7.1: play-test fixes (owner, 2026-10-25 evening; https://claude.ai/artifact/Dw2vU6Hixgak3UeBYd8w8T)

Core tenet (owner): **we want to offer flexibility in approach, but tradeoffs come with it.** Overrides earlier sections where they disagree.

### 21.1 Keven may go alone

- The engine already allows a party of Keven alone. The camp no longer forces a hire: the bounty board and prepare screen open from the start, and the prepare screen shows a warning line when Keven goes alone ("Keven goes in alone. If he falls, it's over.") instead of blocking. The campfire stays highlighted as a suggestion, not a gate.

### 21.2 Starting gold 90

- `START_GOLD` 90: one level-1 hire (60) and an item or two (torch 10 + rope 15, or potion 20 + firecracker 10). Full economy pass later.

### 21.3 Night-eye at the Flagon

- The night-eye draught (30) is sold only once Old Wim is home (`ShopOffer.needs: 'innkeeper'`), and is shown at the Gilded Flagon next to the ales (the UI may also list it at the peddler as locked with "Brewed at the Gilded Flagon: rescue Old Wim"). Bought into the stash, carried in a pack as before.

### 21.4 Lockpicks

- **Improvised pick** (`improvised`, 1 slot, worth 0, never sold): every Burglar starts each delve with 1 in their pack (it doesn't take a slot from their stash picks: it fills a free slot, or is dropped if the pack is full when the delve starts... simplest: it doesn't count toward the 4 slots, like the Sapper's satchel). A Pick using it rolls 2 Finesse slots and uses it up whatever the result.
- **Proper lockpicks** (`lockpicks`, the smith's, 25 gold, needs the smith): permanent, never used up. A Burglar with them picks at 3 Finesse slots; any other hero with them picks at 2.
- **No pick, no Pick:** a hero (Burglar included) with neither can't Pick; Smash, a charge or the skeleton key still open locks. Outcome table as before (on 2 slots: 2 hits silent, 1 hit noise 2, 0 jams; on 3 slots as spec 2).
- A Burglar carrying both uses the proper picks (keeping the improvised one).
- Blocked-option texts: "Locked · Smash it, or pick it with lockpicks" for heroes without; for a Burglar who's used theirs: "Your improvised pick is spent. Smash it, or buy lockpicks from Gerda."

### 21.5 Noticing a walking hero from farther

- Noticing ranges for a **walking** hero go up by 2: lit walking 8 (was 6), unlit walking 5 (was 3), Hollow walking 8 (was 6). Sneaking unchanged (lit 4, unlit 1, Hollow 3). Blind arc: walking still at half range (4 lit, 2 unlit).

## 22. V3.8: exploration mode (shelved)

Built, deployed, then reverted in V3.7.2. The full section is on branch `shelf/exploration-mode`; summary and how to resume: `docs/shelved/exploration-mode.md`.

## 23. V3.7.2: back to turns (owner, 2026-10-25 night)

V3.8's exploration mode (section 22) is reverted and shelved: docs/shelved/exploration-mode.md, branch `shelf/exploration-mode`. Section 22 doesn't apply to `main`.

### 23.1 Entirely turn-based

- V3.7's free movement while calm (20.5's calm walk, Follow, `CALM_STEPS`) is switched off: `FREE_MOVE.enabled = false` in src/game/data.ts. `Engine.calm` always reports not calm, no `calm` events fire, and `move` is the budgeted turn move. Everything else in 20.5 stays (End turn only prompts for idle heroes, Brace, shields, Hamstring, Night thorn, Briar, crates). The calm code and its tests stay for a later return.

### 23.2 Prospectors keep off the party's way in

- A prospector crew (the Lantern Sisters) never uses a rival entrance within 6 hexes of the entrance the party came in by; of the rest it takes the one farthest from the party's. It enters on round 6–9 (was 3–6), and waits while any hero stands within 6 hexes of its way in.

## 24. V3.9: eyes front, the Burglar's flavor (owner, 2026-10-25 late night)

New core tenets (claude/design-pillars.md): **flavor** (each class has a "flavor win" reflected in play) and **teach through gameplay** (warn only about what the party has seen; few "are you sure?" checks). New pillar: **watch each other's backs**. Overrides earlier sections where they disagree. Contract: `git diff main -- src/game/types.ts src/game/api.ts`.

### 24.1 Enemy field of view; sleepers hear

- Awake monsters and crew members see only their **front half**: the three hex directions centred on `facing`. Their **rear half** (the back direction and its two neighbours) is blind. (20.1's blind-arc rule becomes this: walking heroes in the rear half are noticed only when adjacent; sneaking heroes in the rear half are never noticed.) Noise still turns them to face it.
- **Sleepers don't see at all.** They wake only by sound: the per-hex wake rolls of 20.1 are "sound" rolls (walking 50%, sneaking 10%, halved unlit, within 2), ending a move adjacent (walking: sure; sneaking: 25%), and noise as before. A sleeper never notices a hero by sight.

### 24.2 Hero field of view

- Every hero has `facing` (0..5). After a move it faces the direction of its last step; after an action aimed at a hex or figure it faces that way; at delve start every hero faces into the castle (away from the entrance). **Face** (`face` command) is free and unlimited in the player phase.
- A hero sees only their **front half** (the three directions centred on `facing`), within their sight range (14.5/16.2/17.4 unchanged), plus far lights in that half. The rear half is unseen, adjacent hexes included. The party's visible set is the union of every active hero's front half: heroes cover each other's backs.
- Hexes explored stay explored (layout memory); only *visibility* (units, intents, lit floor) follows the front halves. Enemy intents show only for enemies the party sees.
- **Blindsided:** an attack on a hero from that hero's rear half gets **+1 slot** (monsters, crews, free swings, overwatch shots alike). If the attacker can't be seen by any hero, the hit lands as `unseenHit` (the log says "Something strikes Pim from behind"), and the attacker is visible to the party until the next player phase ends.
- Overwatch fires only at enemies in the watcher's front half. Rally, Mend, Guard and other ally targeting are unaffected (heroes know where their friends are).

### 24.3 The Burglar's flavor win

- **No sneak penalty:** a Burglar sneaks at full walking pace (4, dash 4) and over rubble without extra noise (sneaking is silent anyway). (Already 4; make sure dash and rubble match.)
- **Quietest feet:** a sneaking Burglar's sound rolls on sleepers are 5% (others 10%), ending adjacent 10% (others 25%); awake enemies notice a sneaking Burglar in their front half only within 2 if lit (others 4), only when adjacent if unlit (as others), 2 in the Hollow (others 3).
- **Backstab** (replaces the old +1 slot on non-hunting monsters): a Burglar's melee attack from a hex in the target's **rear half** on a target that hasn't noticed the Burglar (asleep, or awake without the Burglar noticed) gets **+1 slot and double damage per hit** (before armor). Stacks with sneak attack (+1 slot). Works on monsters and crew members, not the Dragon or the Gloam. The preview names it ("Backstab: +1 slot, double damage").
- Other heroes keep sneak attack (+1 slot on an unnoticed target) from any side.

### 24.4 Previews only for what the party has seen ("teach through gameplay")

- `Engine.seenEnemies(state)`: ids of monsters and crew members any hero has seen this delve (kept in the delve; dead ones dropped).
- `Reach.risks` lists only enemies in that set: wake rolls only for seen sleepers, notice only for enemies currently visible, swings only for seen enemies. Unseen sleepers still roll and wake: walking blind into a room is punished.
- The free-swing confirm dialog is removed (the preview's red sword stays). Confirms left: jumping down more than one level, ending the turn with heroes who did nothing.

### 24.5 Presentation

- No vision cones. Enemy facing as the existing small wedge; hero facing as a small wedge in the hero's colour; Face: key F, then click a neighbouring hex (or the hex the hero should face toward); the end of a move preview shows the facing it will leave.
- Unseen rear hexes render like explored-but-not-visible (dimmed, no units). A hero alone with nobody covering their back shows a small "back exposed" badge on their card with a tooltip.
- Remove the blind-arc wash shown while sneaking. Hovering a seen awake enemy shows its rear half faintly. When a Burglar is selected, seen unaware enemies get a small dagger marker on their rear hexes ("Backstab from here").
- `unseenHit`: the hero flashes, an arrow from behind, log line "Something strikes Pim from behind".

### 24.6 V3.9.1: facing simplified (owner, 2026-10-25 late night)

- The managed facing mechanic is shelved: no Face command or button (`FACING.faceCommand = false`), and actions no longer turn a hero toward their target (`FACING.turnOnAction = false`). A hero faces the way of their last step (and into the castle at delve start). To turn, move.
- Kept: front-half sight for heroes and enemies, sleepers hear only, blindsided +1 slot, unseen hits, the Burglar's quiet feet and backstab, previews only for seen enemies.
- Presentation: the move preview's end shows a subtle forward arrow only (no wedge); no rear-half wash on hovering an enemy; heroes and enemies keep their small facing arrows.
- The shelved code stays behind the two flags in src/game/data.ts; engine tests for it run with the flags on.

### 24.7 V3.9.2: turning on actions, blind cones (owner, 2026-10-26)

- **Everyone turns toward what they act on.** A hero faces the way of their last step, then toward the target of any action aimed at a hex or a figure (attack, shove, throw, cast, take or open something next to them, use an item on someone) (`FACING.turnOnAction = true`). Monsters and crew members likewise: moving faces the last step; any strike, item, spell or ability aimed at someone or somewhere turns them to it. The free Face command stays shelved.
- **Blind areas by kind.** Heroes and crew members are blind only in a **cone straight behind** (the single back hex direction, at any distance, adjacent included): they see the other five directions. Monsters keep the **whole rear half** blind (three directions). Everything built on "the rear half" uses the figure's blind area: noticing (a walking hero in it is noticed only when adjacent, a sneaking one never), blindsided (+1 slot when attacked from a hero's blind cone), unseen hits, overwatch, hero visibility, Burglar backstab (a monster from any of its rear-half neighbours; a crew member only from straight behind).

### 24.8 V3.9.3: heroes hear what they can't see (owner, 2026-10-26)

Sight is narrow; sound fills the gap, **for the heroes only**. Monsters and crews gain nothing: sneaking up behind them stays as feasible as before.

- During the world phase, every unseen monster or crew member (not in the party's visible set at that moment) that makes a sound within hearing of any active hero creates a `Heard` entry (`Delve.heard`) and a `heard` event: *where*, not *who*. Entries last through the following player phase and are cleared when the next world phase starts.
- **Footsteps** (`steps`): each hex an unseen monster or crew member steps onto is heard by a hero within **hearing range by path** (doors count 2, as noise does): rats and spiders 2, ghouls and cutpurses 3, orcs, archers, captains, crews 4, berserkers 5, the Dragon 8. The Gloam makes no sound. Feared, fleeing figures run loud (+1).
- **Loud** (`loud`, with `what`): any unseen enemy action that makes noise (its radius by the existing noise rules: attacks 2, shout 5, smash 4, charge blast 8, breath 6, a hero downed by an unseen attacker 3) is heard by every hero inside that noise's path radius: `clash` (attacks, free swings), `shout` (captain's shout, orc bellow, crew toll), `crash` (smashing, digging, a door forced), `blast` (charges), `roar` (the Dragon), `scream` (something hurt or killed out of sight).
- Seen enemies make no `Heard` entries (you see them). Heroes' own noise is unchanged and still only matters to enemies.
- Hearing is not seeing: heard enemies stay unseen (no intents, not targetable); `seenEnemies` and previews are unaffected.
- **Presentation:** footsteps as faint footprint glyphs on the heard hexes, a trail in the order heard, fading toward the oldest; loud sounds as a pulsing ring with an icon for `what` at the hex. Shown on the level they happened, drawn over fog (explored or not), never revealing the figure. A log line per world phase summarising, by direction from the party ("Footsteps beyond the door to the north-east", "A clash to the west"), at most two lines. Hover on a marker: "Heard footsteps here, last turn".
- Stale shove/drag arrows: an intent arrow from a victim to a landing hex is drawn only while the victim still stands next to that hex (the plan was made before they moved); otherwise the monster's intent tag still names it but no arrow is drawn.

### 24.9 V3.9.4: tidy-up before V4.0 (owner, 2026-10-26)

- Move-risk tags (wake %, notice eye, free swing) and the Burglar's backstab dagger appear over their figure or hex from their first frame: their appear animation is a fade only. (It used to animate `transform`, which these tags use for their screen position, so they slid in from the screen's top-left corner.) The owner will revisit the free-swing warning's presentation in V4.0.
- The unlit hint's tooltip names the live unlit notice ranges (5 walking, 1 sneaking) instead of a stale 3.
- Help texts brought in line with 24.6–24.7: a hero's hover says they are blind only straight behind; backstab and blindsided texts say "from behind" (a monster's rear half, straight behind a crew member or hero); the key list shows F (Face) only when `FACING.faceCommand` is on; the sneak help no longer mentions the removed rear-half hover. The Burglar's ability line reads "Opens chests without using the action" (Take is free for everyone).

## 25. V4.0: new players go in blind (owner, 2026-10-26)

A new campaign enters the castle by the main gate only. The other two ways in are found and opened through play, and once opened they stay open for the rest of the campaign, as entrances and as exits. The Set out screen draws its map only from what the campaign has explored. Contract: `git diff main -- src/game/types.ts src/game/api.ts`.

### 25.1 Entrances

- `castle.entrances` (index order): 0 main gate L1 (24, 31), 1 sally port L1 (1, 14), 2 east breach L1 (44, 21); `castle.entranceNames`: "Main gate", "Sally port", "East breach".
- `castle.shutWays` lists the two that start shut (`ShutWayDef`: id `sally` | `breach`, the entrance index, kind `gate` | `rubble`, the obstacle hexes, the key's hex for a gate, a hint and the line logged when it opens).
- `Campaign.opened?: Partial<Record<'sally' | 'breach', boolean>>`: ways opened for good. A new campaign starts with `{}`. A save without the field had every entrance open and keeps them (absent = all open).
- `Delve.ways`: the ways open in this delve (from the campaign at the start, plus any opened inside); merged into `Campaign.opened` at `backToCamp`.
- `startDelve` refuses a shut entrance: "The sally port is barred shut. Go in by the main gate." / "The east breach is choked with rubble. Go in by the main gate."
- An exit whose way is shut is not an exit: no Leave there (nor Abandon), and crews, draggers and cutpurses path only to open exits. The HUD gives no "Way out" marker, ring or hint for it; its hover reads "Way out, shut · <hint>".

### 25.2 The sally port: a barred gate

- A locked door with `barred` at L1 (2, 14), between the sally port's exit and the kitchens.
- Opens with **its key** (`unbar` action: adjacent, one action, silent, anyone; the key is used up in the lock) or **a blast** within 1 (a bought charge set on it, a Sapper's set or thrown charge). Not Pick, Smash, the skeleton key or a crew's open job. Hover: "Barred gate · the sally port key opens it (Unbar), or a charge. Then it stays open".
- Opened: "The sally port gate swings open. It stays open." The gate stands open in every later delve.
- **The sally port key** (`ItemKind` `gatekey`, "Sally port key"): 1 slot, worth 0, never sold, never handed over in parley, never stolen by a cutpurse, ignored by prospectors looting; it never reaches the stash and is never lost gear. A hero who gets out carrying it opens the gate for good ("With its key in hand, the sally port gate is yours. It stays open."). A dead hero's key drops with their pack and lies there for the rest of that delve.
- One copy lies in the library at L1 (3, 1) (the west end of the north aisle, 5 from the spider, 7 from the servants' passage trap) at every delve start while the gate is shut. A second comes with the Lantern Sisters by the sally port (25.4).

### 25.3 The east breach: rubble

- Two heaps (`cracked` tiles with `heap`) at L1 (42, 21) and (43, 21) choke the passage between the breach's exit and the chapel. Each is a cracked wall by the rules: blocks sight and passage; a blast within 1 or a Dig (Sapper, or a hero with Mole's Brown) turns it to floor. The view draws a heap as a mound of boulders over floor; the HUD names it "Rubble" ("fallen stone chokes the east breach · a charge clears it, or a Sapper's Dig").
- The breach is open once a walkable path (locked doors aside) joins its exit to the main gate: "The east breach is clear. A new way in." One blast at the inner heap clears both; a Dig clears one heap at a time.
- The daylight that lit the two passages moved onto their exit hexes, so the barred gate and the heaps don't spill light through.

### 25.4 Rival crews make an entrance

- The Lantern Sisters (Level 1, 50%, rounds 6–9) still arrive at a rival entrance more than 6 from the party's entrance, and wait while a hero is within 6 of it. With the party always at the main gate, both rival entrances qualify; the seeded RNG picks one (it used to be the farthest).
- **By a shut sally port:** the Burglar sister carries a sally port key in her pack. As they come in she unlocks the gate (silently): "A key turns in the sally port's bar. The Lantern Sisters let themselves in." The key stays in her pack and drops with it if she dies. Owner (2026-10-26): they lock it behind them. At the end of each world phase, once nobody stands in the gateway and nobody (crew or hero) is on its outer side, the gate closes and locks again ("The sally port's bar drops back into place.", `Delve.gateHeld` while held, `relockGate` in ways.ts). Their passing never opens it for the party: the player has to recover the key (the library's, or the sister's) and use it or carry it out, or blast the gate (a blast at the gate while they hold it opens it for good). Crews never leave by it while it is shut for the campaign. The breach, once a crew blasts it, stays open for good.
- **By a shut east breach:** "The Lantern Sisters set a charge in the rubble of the east breach." They blast the heap nearest the exit (and the other if still standing) as they arrive: a real blast set by the Burglar sister (4/2 damage to anything around the heap; the crew is still outside and unhurt; noise 8, heard on the levels above and below and by the party as a `blast`). The breach is open for good.
- Their way out is always an open exit (they came in by one); `exitsBy` never offers a shut one.

### 25.5 Castle memory

- `Campaign.explored?: Record<number, string[]>`: every hex a delve has explored, as hex keys "q,r" by level, merged in at `backToCamp` (deduplicated). New campaigns start with `{}`, old saves with nothing.
- `Engine.castleMemory(s): { level: number; hexes: string[] }[]`: one entry per castle level (empty arrays on a new campaign). The Set out screen draws its map from this.
- `Engine.entrances(s): { index; name; state: 'open' | 'locked' | 'blocked'; known; hint? }[]`, one per `castle.entrances`, index order. The main gate is always open and known. Sally port `open` or `locked`; east breach `open` or `blocked`. `known`: opened, or its exit hex or its gate/rubble is in the campaign's memory (or this delve's explored hexes). `hint` while shut: "A barred gate. It wants its key, or a charge." / "Choked with rubble."

### 25.6 Also

- Story contracts lose their "Story" and "Unlocks …" warnings (the board shows story status itself).
- The balance sim picks among the open entrances (`engine.entrances`), rotating through them.

## 26. V4.0 play-test fixes (owner, 2026-10-26)

Owner decisions from play (26.1 to 26.3 first, then 26.4 and 26.5). Contract: `HeroInDelve.moveMode`, the `setMoveMode` command, `move.sneak` optional, `Engine.reachable`/`moveNoise`/`calmReach` with `sneak` optional, `MoveRisks.notice[].at`, the `noticed` event's `at` and `faced` (types.ts, api.ts).

### 26.1 Walk/Sneak per hero

- Each hero has their own Walk/Sneak setting for the delve, in engine state: `HeroInDelve.moveMode?: 'walk' | 'sneak'`, set at `startDelve`: Burglars `sneak`, everyone else `walk`. Absent (older saves) = walk. It survives saves and reloads.
- `{ type: 'setMoveMode', heroId, sneak }`: free, any number, player phase, any active hero; changes only that hero; no events.
- `move` without `sneak` uses the hero's setting; an explicit `sneak` still wins (the sim bot passes it) and doesn't change the setting. `reachable`, `moveNoise` and `calmReach` without `sneak` use the setting too.
- The noticing rule's "sneaking" stays the hero's last move mode (`isSneaking`): switching a standing hero to Sneak doesn't hide them, and a Burglar who hasn't moved yet counts as walking.
- HUD: the Walk/Sneak buttons and S show and change the selected hero's setting; selecting another hero shows theirs; move previews, reach, the noise text and the move command use it. A hero set to sneak has a "◌ Sneak" badge on their party card (hover explains).

### 26.2 Noticing happens when it happens (the move goes on)

- In the player phase, at every hex of a walk, every awake monster on the level (not asleep, not the Gloam, not the Dragon, not buried) that hasn't noticed the moving hero checks `wouldNotice` (the same ranges, facing, light and smoke rules, with the hero's move mode) at that hex. A hero who walks through a field of view and out again is spotted on the hex in view. Arrivals that aren't walks (blink, fall, jump, climb, grapple, a gust push) check once at the landing hex.
- Order on each hex: the step (the hero faces it), the free swings it provoked (before it), the notice check, then the step's noise and wake rolls. A sleeper woken by a step is awake for the hero's next step; one woken by the last step (or a landing) stays alert until the world phase or the next move.
- Effects as in the world phase: `noticedIds`, a `noticed` event with `at` (the hero's hex) and `faced`, hunting with focus on that hex (unaware: turns to the hero; already hunting: keeps facing and quarry, 26.3), the orc's first-sight bellow (noise 5). The hero finishes the move. A walk's `moved` event is split at that hex so the view plays the "!" and the log line there.
- The monster's intent is re-planned when the command ends (`Ctx.replan`, the post-command pass in `engine.apply`), with its old intent's target as the preferred quarry, so the intent shown for the coming world phase is right.
- Waiting cutthroat crews: the same check for the moving hero at every hex (`crewNotice(c, heroId)`, within 6), the toll demanded there. They still check every hero after every command.
- Only the moving hero is checked during a move; a hero newly lit by the lantern bearer's walk is noticed in the world phase as before.
- The world phase's `perceive` stays: monsters that turn or move then can still spot heroes.
- Move preview: `Reach.risks.notice` lists watchers that would notice at any hex of the path, with `at` the first such hex, taking watchers as they face now (a wake roll or a bellow on the way can turn one: dice the preview can't know). A waiting crew counts only within 6.

### 26.3 When monsters turn

- Unaware monsters (asleep, alert, patrolling) turn toward a noise they hear and toward a hero they newly notice.
- Hunting monsters don't turn toward noise or toward a hero they newly notice (they still notice: `noticedIds`, event with `faced: false`). They turn on their own turn: toward their quarry as they look round (`perceive`: the hero their intent named while they still make them out, else the nearest), the step they take, what they strike; and when hit.
- A hit turns the target to face the attacker after the hit resolves (`turnOnHit`): melee and bow attacks, firebolt, night thorn, briar, hamstring, shove, knockback, heroes' free swings, overwatch shots, a hired crew member's hit on a monster. A backstab lands from behind, then the monster faces the stabber. Misses don't turn it.
- Area damage (fireball, gust, charge blasts, fire, caltrops, traps) doesn't turn a hunting monster. An unaware monster it hits goes hunting toward the caster and so faces them (unchanged).
- Noticing several heroes at once, a monster faces its quarry, not the last one noticed.
- A ghoul rising from the bones faces the hero it rose for.
- Crew members: unchanged for noise and noticing (no turn to noise; they face a hero they notice). Hits now turn them too (they didn't before).

### 26.4 The Burglar walks 5 (owner)

- The Burglar walks one further than they sneak: walk 5 (dash 5), sneak 4 (dash 4) as before. Everyone else: walk 4, sneak 2 (Smuggler's Mead: sneak 4). `moveBudget` (delve.ts); data.ts `WALK_MOVE` 4, `BURGLAR_WALK` 5.
- The caps still apply on top: escorting the prisoner 3 at most, carrying a heavy item (`HEAVY_MOVE`) 3 at most. Free move while calm has no budget, unchanged.
- Crews don't get it: every crew member moves `RIVAL_MOVE` 4 whatever its class, the Burglar sister and the Gallows Choir's burglar included. Crews have no Walk/Sneak, so "one further than they sneak" means nothing for them, and a faster thief that robs, drags and flees would be a difficulty change nobody asked for.
- Help text: the Quiet feet lines (class kit, recruit chips, the Sneak button's hover), the Walk help ("up to 4 hexes (Burglar 5)") and the dash line.

### 26.5 Class kit is the hero's own (owner)

Contract: a new `ItemKind`, `'improvised-charge'` (types.ts).

- Class kit: the Sapper's **improvised explosives** and the Burglar's **improvised pick** (21.4). Both are pack items with `slots: 0`, made fresh at `startDelve`. `isKit` (common.ts, re-exported by charges.ts) recognises them.
- The Sapper's free charges are their own item now, not a slotless `'charge'`: kind `'improvised-charge'`, one item with `amount` 3 (`SAPPER_CHARGES`), named "Improvised explosives" ("Improvised explosive" with 1 left; `satchelName`). Same blast, fuse, set and throw rules as a bought blasting charge (they only feed `setCharge`/`throwCharge`); `spendCharge` spends them before bought charges; `chargeCount` counts both. A bought "Blasting charge" stays its own 1-slot `'charge'` item.
- Bound to the hero: no pack slot (`packUsed` never counts them); not offered to Drop or Give (and refused if sent); a cutpurse never lifts them (`stealable`, world-phase.ts: not the heirloom, the sally key or kit; with only kit to take it strikes instead); a crew's rob takes only gold, gems and jewelry, and parley payment only gold, gems and jewelry, so neither touches kit; `backToCamp` never banks them.
- A hero who dies takes their kit with them: `killHero` drops the rest of the pack, not the kit, and kit is never in `lostIds`. (Before, the dead Sapper's slotless satchel dropped as loot that anyone could pick up and carry without a slot.)
- Old saves: `deserialize` turns a slotless `'charge'` in a delve hero's pack into improvised explosives (`migrateSatchel`); `isSatchel` still reads the old shape. No save-key bump.
- UI: names.ts glyph ⊛ (the blasting charge stays ✹), item help saying it's the Sapper's own. The in-delve party card draws kit apart from the 4 slot boxes, in a small "kit" mark after them (the slot boxes narrow a little so the row fits); hover "Fenna's own: improvised pick. Doesn't take a slot; can't be given away." and the item's use. The "N free" count ignores kit. Lowgate's Outfit card shows a line under the 4 slots: "Brings their own: improvised pick" / "Brings their own: 3 improvised explosives" (heroes have no pronoun in the data, so "their").

## 27. V4.0 monster sight by mood (owner, 2026-10-26)

Owner-approved; design pillar 16 (intuitive rules, creative approaches). Supersedes pillar 14's "monsters blind in their whole rear half" and spec 24.1/24.7's monster rear half. Contract: `MoveRisks.notice[].hero` (api.ts), the `noticed` event's `faced` now true only for the hero a monster turned to (types.ts unchanged).

### 27.1 Directions and moods

- Relative to a figure's facing: **front** = the facing and its two neighbours (3 directions), **sides** = the two rear-side directions, **behind** = the single back direction (`bearingOf`, stealth.ts).
- A monster's **mood** is the mark over its head (`moodOf`, `isSearching`): **unaware** = `alert` with no `searchRounds` (at its post, walking back to it) or `patrol`; **searching** (`?`) = `alert` with `searchRounds` (heard something; also a monster that lost its quarry, was smoked out, or lost a veiled hero: smoke and veil now set the search rounds, so they search and go back to their post like any searcher); **hunting** (`!`); **asleep**. No new `Awareness` value: saves load unchanged (an old `alert` without search rounds reads as unaware).
- The view's tag: z asleep, ? searching only (no mark at its post), ! hunting, 👣 patrol.

### 27.2 What each mood sees (new heroes; noticed heroes are tracked by plain sight as before)

- Front ranges unchanged (lit 8 walk / 4 sneak, sneaking Burglar 2; unlit 5 / 1; Level 3 8 / 3, Burglar 2; smoke; line of sight).
- **Unaware:** front: the front ranges. Sides: a walking hero within `SIDE_NOTICE_WALK` (2) in line of sight; any hero adjacent (`SIDE_NOTICE_ADJACENT` = true), sneaking or not, except a sneaking Burglar (`BURGLAR_SIDE_QUIET` = true: quietest feet). A sneaking hero 2+ away at the sides: never. Behind: a walking hero adjacent; a sneaking one never.
- **Searching** and **hunting** (for heroes not yet noticed): front and sides at the front ranges; behind as unaware.
- **Asleep:** unchanged (hears only). The Dragon and the Gloam: their own rules. Berserkers hunt once awake.
- Crew members: unchanged (blind only straight behind; their sides are front).
- Backstab: geometry unchanged: from outside the target's front (a monster's sides or straight behind it; straight behind a crew member), the target not having noticed the Burglar.

### 27.3 Monsters look whenever anything moves

- At every hex step of any hero's move, and at the landing of a blink, fall, jump, climb, grapple, gust or shove of a hero, every awake monster (not the Gloam, the Dragon, buried) looks at **every** active, unveiled hero on its level it hasn't noticed, as they stand and in the light at that moment (`lookAll`, world-phase.ts; `noticeOnMove` calls it with the mover first). A waiting crew still checks only the mover mid-move.
- After an `act` command whose result changes the lit hexes (torch, lantern opened/shuttered/passed, kindle, oil, fire), every awake monster looks again (engine.ts `apply`).
- All monsters look at the same moment (each `lookRound` on the state before anyone acts on it); then each acts in map order (events, hunting, bellow). A monster turned or sent searching by a bellow looks at the next look. Deterministic: no rolls.

### 27.4 Blowing cover (cascade)

- When a monster notices one or more heroes at once (`lookRound`): if it wasn't hunting it turns to the first of them (the figure that moved when among them, else the nearest, ties in party order), and goes hunting; then it looks again at every hero with its new facing and hunting sight; repeat until nobody new. Events: one `noticed` per hero, the one it turned to first with `faced: true`, the rest `faced: false`.
- An already hunting monster doesn't turn on noticing (26.3). In the world phase `perceive` does the same after facing its quarry.
- The orc's first-sight bellow (noise 5, `BELLOW_NOISE`) is unchanged: orc-only, once a delve, and alerts others through the noise rules.

### 27.5 Move preview

- `moveRisks` plays the move through copies of every monster the party has seen (facing, mood, noticed set): at each hex, free swings first (a monster that noticed the mover earlier on the path counts; the swing turns it), the mover's light and opened doors, every awake copy looks at every hero (`lookRound`, the cascade), then bellows, the step's noise and sure wakes (100%) turn heads and send monsters searching. `notice` lists every (watcher, hero) pair for watchers visible now, in order, with `at` the mover's hex and `hero` the hero seen. Dice aren't previewed: sleepers that may wake stay asleep, a hero who may be downed walks on.
- HUD: "👁 Orc will see you, then Fenna"; the eye tag's title names the same.
- Tests (src/game/sight.test.ts) check, over 40 seeded scenes, that the preview's pairs equal the move's `noticed` events whenever no swing landed.

### 27.5a The hover shading (V4.0 HUD)

- Contract (read-only, optional): `Engine.sightWash(state, watcherId, sneaking?, quiet?)` → `{ front, side }`: every floor hex within notice range on the watcher's level where a hero moving as given would be noticed now (`wouldNotice`), split into where it looks properly (`front`: ahead; the sides of a searching or hunting monster, or of a crew member) and the corner of an unaware monster's eye (`side`). Straight behind is never listed. The HUD shades the visible ones while a monster or crew member is hovered (walking hero), and uses the hero's own mode for its "it will / won't see you" line.

### 27.6 Hooks for crew parity (pillar 17, a later pass)

- `Sighted` (`id`, `at`, `sneaking`, `quiet`) is not hero-specific; `sightedHeroes(c)` builds the list monsters look for (add crew members there); `isSneaking` reads any figure's `sneaked` flag; `lookAll(c, firstId)` can be called after a crew member's step. Effects (`noticeHero`) are still hero-only. (Used by spec 28: crew members are in `sightedHeroes`, `lookAll` runs after their steps, `noticeFigure` covers them.)

## 28. V4.0 crews play by the party's rules (owner, 2026-10-26)

Design pillar 17 (owner): "Rivals play by the party's rules. Rival crews can do anything the party can: sneak, use their class abilities and kit, climb, jump and rope down levels, dig, blast, pick locks, light the way. They are the game's best teachers: a player who watches a Burglar sister sneak past a sleeping orc, a Sapper blow a new door, or a crew rope down into the pit learns what their own heroes can do. When a hero gains a verb, crews should get it too, and what they do should be visible and named in the log." This is the first pass (owner-approved cut); pass 2 is parked in docs/ideas-later.md ("Crew parity, pass 2"). Code: `src/game/crewmove.ts` (new), rivals.ts, crewai.ts, ai.ts (`foes`, `crewTargets`, `strikeCrew`), stealth.ts (`sightedHeroes`, `perceivable`, `noticeFigure`), world-phase.ts, parley.ts. Tests: `src/game/crews.test.ts`.

Contract changes (types.ts): `Rival.sneaked` (last move a sneak); `Intent.kind` gains `pick`, `smash`, `disarm`, `dig` and `Intent.sneak` (a sneaking move); `Delve.traps[k].crewSpotted`; `RivalCrew.job.price`/`by`; the `noticed` event's `hero` may be a crew member's id (sent only when the party sees the monster or the member); `Heard.what` gains `lock` and `dig`. Engine-private: `RivalX.seenBy`, `RivalX.attackedBy`.

### 28.1 Crews move like heroes

- Level-built members move as heroes of their class (`crewBudget`): walk 4 (Burglar 5), sneak 2 (Burglar 4). Supersedes V4.0's "crews keep `RIVAL_MOVE` 4" (legacy members without a level still walk 4). `rivalStats().move` is the walk.
- **Dash:** a member that moves and doesn't act may move again as far (one path up to twice the budget): prospectors toward loot, a job, the way out; a truce crew back to its post; hired members keeping up; hostile members that can't strike this round. A hostile member's dash stops short of any hex next to an active hero (it doesn't walk up to hand the party the first blow). Not when feared or dragging.
- **Walk or sneak** (`wantSneak`, chosen each time it plans a walk; `Rival.sneaked` keeps the last move's mode, as `HeroX.sneaked`): feared or dragging: walk. Hostile: walk, unless it stalks: the party can't see it, its target is within `CREW_STALK_RANGE` (6) and hasn't noticed it (28.5): sneak. Hired: as the hero who hired them last moved. At peace (prospectors, truce, bribed, a job): sneak when a monster it can see (within `CREW_LOOKOUT` 8, line of sight) that isn't hunting (asleep, unaware or searching) is within `CREW_CAUTION` (3) of its path, or an active hero within `CREW_PARTY_CAUTION` (5) of it. Waiting cutthroats don't move.
- **Every step, by the heroes' rules** (`crewWalk`): it faces the step; heroes it leaves swing at a hostile member (unchanged); hunting monsters that noticed it swing as it leaves their reach (one slot fewer, 20.2); unlocked doors open; walking, its footsteps are heard by the party (6.5; sneaking: silent, `stepRangeOf` 0); every awake monster looks (`lookAll` with the member first, also in the world phase: 28.2); heroes who see it notice it (28.5); walking makes step noise (1, rubble 2: wakes sleepers within path distance 1 for sure, turns heads, sends monsters searching); sleepers within 2 roll the heroes' wake chances (walking 50%, sneaking 10%, a crew Burglar 5%; ending adjacent 100/25/10; halved unlit); a trap on the hex springs (28.4). It looks for traps when the walk ends.
- Pathing keeps out of traps the crew knows and of live charges' blasts (within 2) when another way gets anywhere; else the plain walk.
- **Named:** "Sister Brisk sneaks past the sleeping rats." (once a walk, only when the party sees her); a sleeper it wakes: "The orc stirs as Ferryman Joost passes." when seen. Unseen, walking footsteps are heard.
- View: a figure whose last move was a sneak (crew member or hero) is drawn crouched (`UnitView.crouch`, 80% height). The intent's tag says "sneaks" for a sneaking move.

### 28.2 Monsters treat crew members like heroes

- Monsters look for crew members (on the map, unveiled, hired or not) with the heroes' sight-by-mood rules (spec 27): `sightedHeroes` lists them after the heroes (`sneaking`: last move a sneak; `quiet`: a crew Burglar); `perceivable` reads a crew `Target` like a hero (plain sight once noticed). Monsters look whenever anything moves: at every hero step (as before; crew members standing are looked at too) and every crew step (`lookAll(c, id, before, anyPhase)`), cascade included. A woken or turned monster goes after what it then sees.
- Monsters go for the nearest figure they make out, hero or crew member (`foes(c)` = `targets(c)` + `crewTargets(c)`; owner default: no preference for heroes). Their quarry, intents, `honored` checks, attacks, free swings and the orc's or archer's edge shove work on crew members; grab, web, drag, steal and hamstring stay hero-only (a ghoul or spider attacks a crew member instead). The captain's shout makes orcs notice a crew quarry.
- A crew member struck (`strikeCrew`): +1 slot from its blind cone, damage per hit max(1, dmg − armor) − ward, Perfect +1; a hit turns it; heard as a clash when neither is seen; the Sellsword guarding it takes the hit (as before). A crew member's hit on a monster makes it hunt and notice the member (`noticeFigure`).
- `noticed` events for crew members go out only when the party sees the monster or the member; `noticeFigure` generalizes `noticeHero`.
- **Crews defend themselves** (`defendTarget`, `defendAct`): a member a monster attacked this world phase (`attackedBy`) fights it (any stance but hired, who fight monsters anyway); a crew at peace also fights a hunting monster next to it that has noticed it. It closes in (a walk) and strikes with `hitMonster` (28.5's sneak attack and backstab included). Prospectors stay neutral to the party; the intent shows "attacks the orc".
- Later (ideas-later): the Gloam hunting unlit crew members (crews carry their own light in the fiction; crew light sources are pass 2), the Dragon going for crews.

### 28.3 Locks the honest way

- `crewWorkLock`: with lockpicks (the Burglar sister and Little Mags carry them) a member picks: a Burglar 3 Finesse slots, anyone else 2 (Finesse +5 a level for Finesse classes). Every slot: open, silent; one short: open, noise 2 (heard as "Something forcing a lock"); 1 hit of 3: holds; none: jammed. No picks, or a jammed lock: Smash, 2 Might slots, a chest opens on 1 hit, a door on 2, noise 4 (heard as a crash). Named when seen ("Little Mags picks the chest's lock without a sound.").
- Prospectors: a locked chest is a goal only for a member with picks while one is on the map (the others leave it to her); without one they smash it. A jammed chest is left alone. A lock that holds is tried again next round; the loot is taken the round it opens.
- **The paid "open" job** keeps its promise as the picker's best attempt: the job goes to the crew's lockpicker; every slot: "works the lock open without a sound"; one short: "Clunk: not quite silent"; holds: tried again next round; jammed: the job can't be done and the price is handed back to the hero who paid (`job.price`, `job.by`). (Superseded by 28.8: no refund.) The job is offered only to a crew with lockpicks ("None of them carries lockpicks.") and never for a jammed lock.

### 28.4 Traps

- Stepping onto a trap (spotted or not): 3 damage, no armor, the trap is gone, noise 2 (heard as a crash); the party sees it ("A trap bites Ferryman Sil.", the `trap` event) only when the member or hex is seen.
- Ending a walk, a member rolls 1 Wits slot for each trap within 1 the crew doesn't know (no darkness penalty: crews carry their own light): a hit marks it `crewSpotted` and the crew walks round it. If the party sees her mark it, they know it too (`spotted`, `trapSpotted` event): watching teaches.
- A crew Burglar whose way round a known trap is longer (or none) walks up to it and disarms it (2 Finesse slots: any hit removes it, none sets it off on her), shown as a `disarm` intent.

### 28.5 The Burglar sister: sneak attack and backstab

- Heroes notice crew members (`RivalX.seenBy`): a hero who sees a member's hex with their own eyes (facing, light; `seesHex`) has noticed her, updated whenever sight is refreshed and at every crew step. Once no hero sees her at the crew's turn, the party has lost her and every hero forgets (as a monster that loses its quarry).
- A hostile member's weapon attack on a hero who hasn't noticed it: +1 slot (`SNEAK_ATTACK_SLOTS`, the heroes' sneak attack; any member, bows too). A crew Burglar's melee strike from the hero's blind cone (straight behind) on a hero who hasn't noticed her is a **backstab**: double weapon damage before armor; its extra slot is the blindside slot from behind (so +2 slots in all, as a hero's backstab on a monster). Named: "Little Mags slips behind Fenna and backstabs." / "... strikes before Fenna sees it coming." when seen; unseen, "Something strikes Fenna from behind" as before.
- Crew members striking monsters (`hitMonster`, hired or fighting back): +20 on a sleeper, +1 slot on a monster that hasn't noticed the member, and a crew Burglar's backstab from outside its front (not the Dragon).

### 28.6 The Sapper reshapes the way

- Crew Sappers bring **improvised explosives** like hero Sappers: 3, slotless, their own kit (spent before bought charges, not dropped when they die). The Ferrymen's Brecht and the Wake's Spade so carry 5 and 6 charges.
- On any walk (`crewApproach`; hostile approach included), a crew Sapper looks (`sapperWay`) at the hexes next to where its walk can reach: a cracked wall or rubble heap it can dig, or a locked door (not the barred gate) or breakable wall it can blast with a charge. If going through saves `SAPPER_SHORTCUT` (6) hexes of walking to its goal, or opens a way where there was none, it walks there and digs (noise 4, heard as "Something digging"; the `dug` event; ways checked) or sets a charge (fuse 1; "sets a charge on the locked door and steps clear"). Digging is preferred to blasting. While its own fuse burns it waits; crewmates keep out of the blast (pathing). Intents: `dig`, or `fuse` with the blast hexes.

### 28.7 Not in this pass

Rope, jump, climb and grapple; crew light sources and lighting braziers; Focus, flanking and brace for crews; the missing spells (sleep, dread, night thorn, briar, kindle); revive. See docs/ideas-later.md.

### 28.8 Owner tweaks (2026-10-26)

**Capture is the surprise, not the default.** Owner: "Capturing a downed party member is a cool interaction, but I don't think it should occur more often than being killed outright. It should be a fun, surprising event that occurs when the situation calls for it. (Maybe your burglar is off alone looking for loot, and encounters an enemy crew, one of them has a sleep dart or something.)" After 28.1's dashes, captures outnumbered deaths in the crew arena. Supersedes 20.4's "a downed hero within 2 (or one it just downed) is robbed and dragged".

- **Helpless and alone** (`helpless`, `alone`, `seizable` in crewai.ts): a hostile member takes a hero only when they are helpless (downed, or dozing from a crew sleep dart) and alone: no other hero who is up (active, not dozing, not in a crew member's hands) within `CAPTURE_ALONE` = 4 hexes, straight-line, same level. Straight-line, not path, so the player can count it on the board. A member that can stand next to such a hero with its walk (`move`; was: within 2) shows `rob` and seizes them; so does a member that downs a lone hero with its attack. The robbing is unchanged: gold, gems and jewelry (not story items) to the member's loot. `robbed` no longer bars a second seizure: a hero dropped by a killed or feared dragger may be taken again if still helpless and alone.
- **Finishing** (`finishable`, `finish`): a downed hero who isn't alone is finished, not carried. Priority for a hostile member: dragging → seize a helpless lone hero → finish a downed hero next to it (not being dragged) when no hero who is up stands next to the member → kit → the crew's target. The finishing blow is the member's weapon roll (`strike`, "Finishing blow"); any damage to a downed hero kills (existing rule). Shown the round before as an `attack` intent on the downed hero; checked again when it acts. Members don't walk to finish (a downed hero with friends near is guarded ground).
- **Seizing a dozing hero:** grabbed and dragged like a downed one (no bleeding: they aren't bleeding). The hero is held (`HeroInDelve.grabbedBy` = the member's id, as a ghoul's grab). Dozing ends as before (the world phase after the one that drugged them), so they wake at their next player phase in the member's grip: they can't move or dash, and may **Escape** (2 Might slots, 1 hit, noise 1; the ghoul's rule) or attack the dragger; killing or fearing it frees them too. Chosen over "helpless until freed" because a dart costs one turn, not the campaign: the lone hero gets a turn to fight their way out, and the party a round or two to come running. `checkHolds` keeps a crew hold while the member still drags that hero; downed or revived, the hold lapses (a downed captive is still dragged, as before). `endDelve` captures a held hero as it does a dragged downed one. The dragger paths through its own captive (`ApproachOpts.through`), since an awake hero occupies a hex.
- The crew no longer targets a hero one of its members is carrying off (`heroTargets`). A crew Burglar's sleep dart goes first for a hero who is alone, then the lantern bearer, then the nearest.
- Keven captured still ends the campaign; a lone Keven is taken by the same rule.
- Help: the hostile stance's text says "A hero left helpless and alone may be carried off; a downed hero with friends near is finished." Escape's help names a crew member's grip.

**No refund for a failed "open a lock" job.** Owner: "If the enemy crew fails to accomplish the 'open a lock' job, I don't think the player should get refunded." Supersedes 28.3's refund: a lock that holds is still tried again next round; a jammed lock (or a picker who no longer has picks) ends the job, paid and failed, the crew keeps the money: "Sister Brisk jams the lock. The job's done; they keep the 30." `refundJob` is gone; `job.price` is kept for the line, `job.by` is still recorded. The deal card says: "a lock that holds is tried again; if it jams, the job is over and they keep the money."

Numbers (crew arena, 40 fights × 4 crews × 5 parties, SEED=1; dead / captured): before 277 / 272, after 610 / 123. Captures now come mostly from wipes (the last hero down is alone) and from parties of two; captures went down in every cell but two (vs l1x4: Ferrymen 14 → 16, the Wake 6 → 9). Side effect: crews are deadlier, because a member no longer leaves the fight to drag a hero off while the rest of the party stands, and finishes the downed: fights lost rose (Ferrymen vs l1x4 5% → 50%, Choir vs l1x3 28% → 98% (stalls before), vs l1x4 0% → 10%, the Wake vs l1x4 3% → 20%, vs l2x4 3% → 23%, vs l3x4 23% → 30%); L2+ parties still win every fight against the Sisters, Ferrymen and Choir. A balance pass on crew lethality may be wanted. Sim (`v3-engine-sim.ts 10`, SEED=1,2,3; 8 crew fights): dead 7 / captured 1 before, 6 / 3 after (all three: two-hero L1 parties wiped by the Sisters).

Tests: engine.test.ts "spec 28.8: helpless and alone" (seized when downed and alone; finished with a friend within 4, the living fought when one is at its blade; a dozing lone hero seized, dragged, wakes held, Escape frees; a lone heir taken ends the campaign), crews.test.ts (the jammed job: no refund).
## 29. V4.0 venom (owner, 2026-10-26)

Owner-approved; design pillars 15 (the countdown is a number that informs a choice), 16 (intuitive rules, creative approaches: an antidote, Mend, a friend's shoulders, or the way out), 17 (crews by the same rules). Contract (types.ts): `ItemKind` and `ShopKind` gain `'antidote'` and `'venomdart'`; `ActionKind` gains `'venomdart'`, `'antidote'`, `'shoulder'`, `'setDown'`; `HeroInDelve.venom`, `.paralyzed`, `.carrying`; `Monster.venom`, `.paralyzed`; `Rival.venom`, `.paralyzed`; `TrapDef.venom` and `Delve.traps[k].venom`; `Intent.kind` gains `'venomdart'`; events `envenomed` (`venom`, `dose`), `paralyzed` (`rounds`), `cured` (`how`: antidote, mend, worn, out), `shouldered`, `setDown`; `trap` and `trapSpotted` gain `venom`. Code: src/game/venom.ts (new). Tests: src/game/venom.test.ts.

### 29.1 Envenomed

- A dose sets a countdown of `VENOM_ROUNDS` 3 on a hero (up or downed), a monster (not the Dragon or the Gloam) or a crew member. It drops by 1 at step 2 of every world phase (with the bleeding, before monsters act); at 0 the figure is paralyzed. A second dose while envenomed takes 1 off (to 1 at least); a paralyzed figure takes no dose.

### 29.2 Paralyzed

- For `PARALYSIS_ROUNDS` 6 world phases (run down at step 2; a newly paralyzed figure doesn't count down that phase): no move, no action, free actions included; no free swings; no bleeding; not downed. Damage hurts as usual (a hero at 0 HP goes down by 8.5, the paralysis running on underneath). Monsters still target a paralyzed hero. It wears off by itself: back with HP as it is.
- What stops: a hero's escort (the prisoner waits), guard, brace and overwatch; a paralyzed lantern bearer drops the lantern to the nearest able hero. A monster's intent (none shown), its hold, its looking round and turning to noise. A crew member's walk and kit (it waits); a dragged hero is dropped.
- The delve ends when no hero can stir (active and not paralyzed). A paralyzed hero still inside at the end dies, as a downed one ("left behind").

### 29.3 Sources

- **Spiders:** a bite that hits (strike or free swing, every level) envenoms the hero or crew member. The intent reads "bites Fenna, 0–5 damage (venom)".
- **Venom dart** (new item, 1 slot, Mott, 30 gold, from the start): throw 5 at a visible monster (not the Dragon or the Gloam) or crew member in line of sight, not paralyzed: 1 Finesse slot (+20 asleep, light penalty as usual); a hit envenoms. Silent; a hit doesn't make a monster hunt (as the sleep dart); on a crew member the crew turns hostile.
- **Crews:** the Gallows Choir's Little Mags carries a venom dart instead of one sleep dart. A hostile crew Burglar with one shows the intent `venomdart` at a hero in range 5 and sight with no venom in them: a hero alone first (no other able hero within 4: nobody to carry them out), else the crew's target, else the nearest; then her sleep darts as before.
- **Venom traps:** see 29.5.

### 29.4 Carrying: Shoulder and Set down

- **Shoulder** (an action; target: an active, paralyzed ally next to you that nobody carries; the carrier able and carrying nobody): `carrying` = the ally. After each of the carrier's moves the carried ally is set on a free hex next to the carrier, nearest where they were (the escorted prisoner's rule: not onto doors but the open sally port gate, nor traps, vents or fire). The carrier moves `CARRY_MOVE` 3 at most (dash too), and their action is spent for the turn they shoulder.
- **Set down:** free, any time.
- Carrying ends: the carrier downed, paralyzed or gone; the carried one recovering (cured or worn off), downed or dead; a jump, climb, grapple or blink.
- A carrier who Leaves on an exit takes the carried ally out with them (both out; the venom drawn out).
- Crews don't shoulder yet (docs/ideas-later.md, "Venom, the crew side").

### 29.5 Venom traps

- Two on Level 2, added to the two plain ones: the east ledge corridor (34, 13), on the way down to the forge, and the cellblock's east passage (15, 23), by the door to the winch room. 1-wide corridors (no stepping round), off the bridges, more than 2 from any contract site (castle.test).
- Stepped on (heroes and crews) or set off by a failed Disarm: 1 damage (`VENOM_TRAP_DMG`) and a dose, instead of 3 damage. Hidden, spotted and disarmed like any trap. Spotted, it is drawn with a green ring and needles; the move preview says "A venom trap on the way: 1 damage, and paralyzed in 3 turns" when one lies on the path.

### 29.6 Cures

- **Antidote** (new item, 1 slot, 20 gold, always sold: an essential): an action, on yourself while envenomed or on a hero next to you (up or downed) who is envenomed or paralyzed: venom and paralysis gone.
- **Mend** (Hedgewitch): heals 4 and draws out venom and paralysis; an envenomed or paralyzed hero within 3 is a target even at full HP. Crew Hedgewitches mend a paralyzed or envenomed member first; a hired one mends a hero with venom first.
- **Leaving the castle** draws the venom out (a return report note: "Fenna came out with venom in them; the open air drew it out.").

### 29.7 Presentation

- Party card: a green drop with the countdown (aria "Venom 2", hover "Venom: paralyzed in 2 turns. Antidote, Mend, or get out."); paralyzed, a line under the HP ("Paralyzed · wears off in 4 turns. Shoulder them to carry them out." / "On Corin's shoulders · wears off in …"), both turn pips off; a carry icon on the carrier.
- Hotbar: the antidote and venom darts are pack items (click to use, targeted like the other throws and potions); Shoulder is a contextual action that glows next to a paralyzed ally; Set down takes its place while carrying.
- Enemy tags: a drop with the countdown, or "paralyzed"; cards say "Envenomed: paralyzed in N turns." / "Paralyzed: can't move or act for N more turns."; the mood word "paralyzed".
- The target card for a venom dart: "Envenoms it: paralyzed in 3 turns if it hits." The castle's-turn caption: "The spider bites Fenna" with "2 damage, venom." Float words over figures (Venom, Paralyzed, Venom drawn out, Can move again); Chronicle lines with a drop or carry icon.
- Lowgate: the antidote under "Light and mending", the venom dart under "Quiet work".

### 29.8 With spec 28.8 (crews take the helpless and alone)

- A paralyzed hero is **helpless** (as downed or dozing), and isn't "up" for another hero's "alone". A crew member that can stand next to a paralyzed hero with nobody up within `CAPTURE_ALONE` (4) seizes them ("finds Fenna paralyzed and alone"): held (`grabbedBy`), dragged toward the way out; they may Escape once the paralysis ends or a friend cures it (an antidote from next to them, Mend within 3). A friend can't Shoulder a hero a crew member holds. Held when the delve ends, they are captured, not left to die.
- The Gallows Choir's venom dart goes for a hero alone (28.8's `alone`) first: paralyzed and alone, the crew can carry them off.

## 30. V4.0 play-test fixes 2 (owner, 2026-10-26)

Owner requests from play. Design pillars 15 (numbers only where they inform a choice), 11 (visual clarity; every HUD element explains itself), 16 (intuitive), 17 (crews play by the party's rules). Contract: none changed (`kitPerDelve`, `KIT_PER_LEVEL` in data.ts; `classKit`, `pickName`, `spendPick` in charges.ts; `fitClass` in camp.ts; `Diorama.showPick`, `picked`, `pickDim` in the view). Tests: `src/game/kit.test.ts`, engine.test.ts and charges.test.ts updated.

### 30.1 The Sapper: no Brace, a little squishier (owner)

Owner: "Remove the brace ability from the sapper, and in general make them slightly weaker and squishier than dedicated melee units like the sellswords. Sappers aren't frail, but they should have noticeable tradeoffs compared to the other classes (particularly the sellswords)."

- `CLASSES.sapper`: HP 9 (was 10), Might 60 (was 65), armor 0 (was 1). The hammer stays (3 Might slots, 2 damage); Finesse 50, Wits 45, Nerve 60 unchanged. Their strength is charges and Dig. The Sellsword keeps HP 10, Might 70, armor 1, Brace, Guard and the strong shove.
- Brace is the Heir's and the Sellsword's only (`targetsFor('brace')`); refused for a Sapper. A Sapper braced in a save made mid-delve stays braced until that world phase ends.
- Text: `ROLES` (no Brace line; "Improvised explosives: 1 a level each delve"), `CLASS_KIT` and `CLASS_ABILITIES` (no Brace chip), `CLASS_GEAR` (Armor 0), the recruit card's "Best at" ("Blowing a new way through walls and doors. Lighter in a brawl than a Sellsword."). Lowgate's "This party can" never named Brace.
- **Old saves.** A hero's max HP and stats are stored on the hero (class base + 2 HP and +5 main stat a level), armor is read from the table at use. `fitClass` (camp.ts), run by `deserialize` on the roster, the tavern's recruits and captives, brings a Sapper down to the table at their level: max HP and any stat above the table are lowered (only lowered; idempotent); current HP drops by the same amount, so a wounded Sapper keeps their wounds (a level 3 Sapper at 8/14 becomes 7/13). A Sapper in the castle when the game was saved is capped at the new maximum. No save-key bump.
- **Crews (pillar 17).** Crew Sappers are built from the table at the crew level, so the Ferrymen's Brecht (level 3) is HP 13 (was 14), Might hit 80% (was 85%), armor 0 + 1 = 1 (was 2); the Wake's Spade (level 4) HP 15 (was 16), 95% (capped, unchanged), armor 1 (was 2). Members saved mid-delve keep their stored HP; legacy members (no level) already used the old `RIVAL_CLASSES` table (HP 9, armor 0).

### 30.2 Class kit by level (owner)

Owner: "Give the free items for sappers/burglars in accordance with that character's level (1 free explosive or lockpick per level per delve). Sappers starting with 3 charges is a lot."

- `kitPerDelve(level)` = level × `KIT_PER_LEVEL` (1), at least 1: level 1 brings 1, level 3 brings 3, level 6 (`MAX_LEVEL`) brings 6. Replaces `SAPPER_CHARGES` (3), which is gone; its callers use `kitPerDelve` / `classKit`.
- **Sapper:** improvised explosives, one slotless `improvised-charge` item with `amount` = level, made at `startDelve` (`classKit`). Bought blasting charges still add and are spent after them. Everything else as 26.5.
- **Burglar:** improvised picks, now one slotless `improvised` item with `amount` = level, named "Improvised picks (2)" / "Improvised pick" with one left (`pickName`). Each Pick attempt uses one (`spendPick`), whatever happens; the item goes at 0, and then Pick is blocked with "Your improvised picks are spent. Smash it, or buy lockpicks from Gerda." Same 2 Finesse slots and outcomes; the smith's lockpicks (3 slots for a Burglar, never used up) are unchanged and used first. Log: "Fenna has 1 improvised pick left." / "Fenna's last improvised pick is spent."; the roll's modifier "Improvised pick: 2 slots, uses 1 of 2".
- **Crews (pillar 17):** by the crew's level, in `member` (rivals.ts): the Ferrymen's Brecht 3 explosives (and his 2 bought charges: 5, as before), the Wake's Spade 4 (and 3 bought: 7, was 6), the Lantern Sisters' Burglar 2 picks, the Gallows Choir's Little Mags 3. Crew Burglars carry lockpicks and use them first; without, `crewWorkLock` works an improvised pick at 2 slots and uses one up a try.
- **Old saves:** a Burglar's single pick from before (amount 1) is one use; a Sapper's 3 explosives saved mid-delve stay 3 for that delve. The next delve brings the new count.
- UI: the kit mark on the party card shows the count for both kits ("⌐ 2 own"; hover "Fenna's own · 2 improvised picks left"); Lowgate's Outfit card says "Brings their own: 2 improvised picks" / "1 improvised explosive" by level; the help texts (Pick, the kit lines, recruit chips: "1 a level per delve") follow.

### 30.3 Which one you're picking (owner)

Owner: "When given an option to choose between multiple targets (whether it be attacks, or jump destinations) there is no real clarity about what target you're selecting. When selecting a target out of multiple, hovering the option should visually show which they are selecting."

- While an action is armed with several options, the one a click (or Enter) would take is marked: a thick near-white ring lifted off its hex with a breathing halo (red for a foe or a drop, green for a friend, amber for a hex), the other options' rings dimmed to 40%, and the figure's tag outlined (`Diorama.showPick`). Every pick mode goes through it: enemy, ally, hex, item and other pickers (Give, Free, Escape, Shoulder), jump (its landing and fall told: "Falls 2 levels into the Hollow: 7 damage"), shove and knockback (the hex they'd land on, for the knockback straight away from the Ranger), throws, fireball, gust, smoke and glue (the area under the marked hex), Set and Throw charge (the blast plan under it), blink, dig, unbar.
- The pill above the hotbar lists the options (up to 8 when they aren't all on the map, or when there are 6 or fewer); two with the same name say which way each is ("Orc · east", "Orc · south-west"). Hovering or focusing an entry marks its hex or figure on the board. The pill ends "▸ Orc · east  Tab: next of 2 · Enter: take it".
- Keyboard: Tab or the arrow keys step through the options with the same mark (Shift+Tab, Left, Up go back; the view follows to the option's level); Enter takes the marked one. Pointing at an option takes over from the keyboard's choice.

### 30.4 Only what a hero can do (owner)

Owner: "We should also consider hiding actions that party members are currently unable to take (this saves visual space). Right now my sapper's action selection bar is scrolling on a 2K screen. I can't even attack and I don't even have charges to use."

- The hotbar shows only what the selected hero can do now: the engine's options with a target, minus blocked ones (a lock with no pick, a full pack's Take, a shut way out's Leave). The dimmed "Attack · nobody in reach" button is gone. Spells without mana, Set/Throw charge without charges and acted heroes' actions never were options; free actions stay. Blocked reasons still show on the board's hover card ("Pick: Your improvised picks are spent...").
- Order is fixed with absent buttons collapsed: Attack, Shove, class abilities and spells in the engine's order, the way out, the stairs, then what's in reach.
- Nothing to do: "Nothing to do here. Move, or End turn." ("Action used. Move, or End turn." after acting; "Done this round. End turn, or pick another hero." after both). Hovering the hero's name (or that line) lists what they can do elsewhere: "Corin can: Attack, Shove, Set charge, Throw charge, Dig. The bar shows only what Corin can do from here, now; ..."
- More lists only usable entries, and is left off when it has none.
- The bar never scrolls: it is as wide as its buttons (at least 968px, at most the window less 32px; at 1360 and below at least the window less 200px), the actions never scroll, and if it still doesn't fit the labels fold away (`compact`: icons, keys and hovers stay), then it tightens (`tight`). Checked at 1280, 1440 and 2560 wide.
- Pack tooltips speak the V4.0 HUD: "Use: Items › Potion (...)" is gone; the hotbar says "Click to use (key H), then yourself or a hero next to you." and elsewhere (Lowgate) "Use: click it in the pack, then ..." (`ITEM_USE`, `itemUseLine`, `itemClickLine`); kit and lockpicks name their action ("Use: Pick, next to a locked door or chest").

### 30.5 The Set out sketch, larger (owner)

Owner on Lowgate's step 4 sketch of the castle: "It looks great, I'd like to see it emphasized more."

- The sketch takes the left column's spare height (at least 300px; the page scrolls below that) and scales to fill it: it is drawn in map units with `preserveAspectRatio="xMidYMid meet"`, fitting what you remember of Level 1 and the ways in with a hex and a half of padding. With a sketch, the lantern checkbox moves under the plan, so the ways in, the lantern choice and the plan stay in view at 1280 × 800 and 1440 × 900 (sketch 405px and 497px, ≥ 45% of the window).
- Room and entrance names grow with the sketch but never under ~12.5px on screen, with a dark outline; a room name that would overlap an entrance's or another room's is left out (laid out again when the sketch resizes). The entrance markers and the job's mark scale with it; "Closest to the job" stays on the entrance card. The empty state ("You've never been inside...") stays compact.

### 30.6 Numbers before and after (30.1, 30.2)

Before = the V4.0 branch with venom merged (3755b14), after = this change; each built fresh from its commit.

- Crew arena (`v37-crew-arena.ts 40`, SEED=1; 40 fights × 4 crews × 5 parties), dead / captured in all: 605 / 135 before, 564 / 137 after. Only the cells with a Sapper crew moved: the Ferrymen vs l1x4 lost 50% → 43%, vs l3x4 heroes dead 31 → 26; the Wake vs l2x4 lost 23% → 15% (dead 53 → 35), vs l3x4 30% → 33%, vs l1x4 20% → 18%. A softer crew Sapper (HP −1, armor −1) makes the Ferrymen and the Wake a little easier; the Wake's Spade's extra charge doesn't make up for it. The Sisters and the Gallows Choir are unchanged.
- Sim (`v3-engine-sim.ts 10`, SEED=1,2,3; 30 delves): contracts done 22 → 20, hero deaths 23 → 24; crew fights 9 → 7, dead in them 15 → 12, captured 4 → 3. With a Sapper hired first (SAPPER=1): done 18 → 19, deaths 25 → 29 (a level 1 Sapper has 9 HP, no armor and one explosive). Runs diverge after the first delve, so single-seed swings are noise.

## 31. V4.1: rebalance (owner, 2026-10-26)

V4.1 is a rebalance of the economy, progression and play, run as audit (docs/v41-audit.md), a measurable sim, a pitch, then small deployed steps. Sections are added here as each step ships.

### 31.1 The Sisters never come in by the party's way (owner, 2026-10-26)

Owner: "I'd like for enemy crews to not enter from whatever entrance the player party did. So if the player enters through the Sally, other squads should be able to enter through the default entrance."

- `castle.rivalEntrances` is every way in: the main gate L1 (24, 31), the east breach L1 (44, 21), the sally port L1 (1, 14) (was the breach and the sally port only).
- `makeCrew` still rules out any rival entrance within `PROSPECTOR_KEEP_OFF` (6) of the party's entrance, which always rules out the party's own; the seeded RNG picks among the rest. From the main gate: the sally port or the breach (unchanged). From the sally port: the main gate or the breach. From the breach: the main gate or the sally port.
- By the main gate (always open) they simply walk in: no key, no blast. Shut ways work as spec 25.4 (the key and the re-barred gate; the blasted breach, open for good). They still wait while a hero is within 6 of their way in.
- Only the Lantern Sisters enter mid-delve; cutthroat crews start at their posts on Levels 2 and 3, unchanged.
- Tests: ways.test.ts ("never by the party's own way in"; "by the open main gate ... nothing is blasted or unbarred"), castle.test.ts (rival entrances = every entrance).


### 31.2 Gold and the first delve (WS1, owner-approved plan, 2026-10-26)

Pillar 18 (unlocks or gold, not both) and the low-floor tenet: the first delve teaches sneaking, and a careful party builds wealth on Level 1. Source: docs/v41-plan.md WS1 (pitch A1, A4, A6, B1). Contract: `Campaign.credits?: { shield?: number }`; `SpawnDef.firstDelveAsleep?: boolean`; `StoryId` gains `alchemist` (31.3). Tests: `src/game/village.test.ts` (WS1 block), engine.test.ts updated.

- **Regular bounties** (`BOUNTY`): rescue 110 / 200 / 280 (L1/L2/L3; were 80/150/220), recover 140 / 250 / 340 (were 100/180/260), heirloom values unchanged (`HEIRLOOM_VALUE` 60/120/180), slay 600 (was 500).
- **Winning something back pays no gold.** Every story contract (`storyBounty` returns `STORY_PAY` 0; was half the regular bounty rounded down to 5) and every "Bring back <captive>" (`captiveBoard`, `CAPTIVE_PAY` 0; was the full rescue bounty). Reputation +1 and XP as before.
- **Gifts instead** (`GIFTS` in data.ts, `giveGift` in camp.ts), given in `backToCamp` the first time a villager comes home, after the roster is settled (so a rescued hero joining that delve is counted), with a `say` line after the villager's own:
  - Aldric (`surgeon`): 2 potions to the cart. "Brother Aldric presses two potions on you for the road."
  - Wim (`innkeeper`): every hero on the roster without an ale waiting gets `Hero.ale = 'reserve'` (Hobart's Reserve), drunk at their next `startDelve` as any ale. Works before the copper is home (his last cask). A hero with an ale already waiting keeps theirs.
  - Gerda (`smith`): `campaign.credits.shield += 1`. `buyShield` with a credit costs 0, takes the credit, and says "On the house."; afterwards shields cost `SHIELD_PRICE` (50) again.
  - Ilse (`alchemist`): 2 antidotes to the cart (WS6 adds 3 glow arrows).
  - The copper, the cask book, a brought-back captive: none. A story already home gives nothing again.
- **The castle keeps refilling** (A4): unchanged.
- **Starting gold 120** (`START_GOLD`, was 90). Two level 1 hires (120) are now affordable on the first visit; the plan's intent is one hire and 60 for items.
- **A gentler first delve** (B1): `startDelve` reads `campaign.delveCount === 0` before incrementing it; every spawn with `firstDelveAsleep` is placed asleep (its patrol dropped) on that delve. In the castle only the chapel orc by Aldric, L1 (35, 24), is marked. Later delves place it as before (awake at its post).
- **UI:** a contract card that pays 0 shows "Gift: 2 potions" (hover: "A gift, not gold · ...") or "No pay" where the bounty was (`bountyTag` in lowgate.ts); the Set out plan says "Wins back ... · gift: ..."; the return report adds "A gift for you: ...". The forge's shield button reads "Free · a gift" while a credit is owed. A hero with Wim's round waiting shows the ale on their Outfit card even before the copper is home.
- **Sim:** `scripts/v3-engine-sim.ts` runs unchanged (story contracts now report bounty 0); oil is bought only when Ilse's bench sells it.

Code: data.ts `BOUNTY`, `START_GOLD`, `STORY_PAY`, `CAPTIVE_PAY`, `GIFTS`; camp.ts `storyBounty`, `captiveBoard`, `giveGift`, `backToCamp`, `buyShield` (in `campCommand`), `startDelve`; castle/index.ts (the chapel orc's `firstDelveAsleep`); lowgate.ts `bountyTag`, `plan`, `loadoutCard`; return.ts.

### 31.3 Ilse and the village pairs (WS5, owner-approved plan, 2026-10-26)

Pitch H1, J, K as amended by the plan. Contract: `StoryId` + `alchemist`; `Village.alchemist` (old saves load it as false, `deserialize`); `ItemKind`/`ShopKind` + `greaterpotion`; `AleKind` + `nighteye`, `spidermilk`, `dragonfire` (so `AleEffect` too); `AleOffer.needs` + `'alchemist'`; `ShopOffer.needs` is now `StoryId | StoryId[]` (was `'smith' | 'innkeeper'`) and gains `vendor?: Vendor` (`'mott' | 'gerda' | 'ilse' | 'aldric'`, new type); `Fuse.tripwire?: boolean`; `ActionKind` + `setTripwire`. Tests: `src/game/village.test.ts` (WS5 block), castle.test.ts (Ilse's site), engine.test.ts updated.

- **Ilse the alchemist** (`STORIES` id `alchemist`, rescue, subject "Ilse the alchemist"): site `l2-story-archive`, L2 (6, 11) in the archive, a floor hex next to the archive spider (7, 12), 5 from the archive's regular recover site and clear of spawns, chests, coins and traps (castle.test's story-site invariants). On the board once Aldric is home and reputation ≥ 1 (`storyAvailable`: `v.surgeon && rep >= REP_FOR_LEVEL[2]`). Done, it sets `village.alchemist` ("Ilse's bench"); she stays in Lowgate. The spider is awake (it isn't a sleeper in the archive), so reaching her is a fight, a dart or a sneak past its front.
- **Mott** (from the start): torch 10, potion 20, antidote 20, rope 15, firecracker 10, blasting charge 45 (was 30). The night-eye draught (`nightsight`) is no longer sold (old copies on the cart or in a pack still work and sell for nothing, as before: it was never a valuable). **Ilse's bench** (`needs: 'alchemist'`): sleep dart 25, venom dart 30, smoke 20, glue 25, oil 15. Gerda keeps caltrops, hook, key, lockpicks, the forge tiers and the shield.
- **Pairs** (`pairHome(village, a, b)` in data.ts, both flags set; tolerant of old villages):
  - **Wim + Ilse:** three ales (`ALES`, `needs: 'alchemist'`, poured with Wim and Ilse home; the copper isn't needed): Night-eye Stout 25 (`nighteye`), Spider-milk Stout 20 (`spidermilk`), Dragonfire Porter 25 (`dragonfire`). Night-eye's and Spider-milk's effects belong to the light (WS2) and poison (WS3) rules: here they are bought, drunk and carried as `HeroInDelve.ale` and do nothing else yet. **Dragonfire Porter**: `fireWard(c, id, dmg)` (village.ts) takes `DRAGONFIRE_WARD` (2) off, to 0, for the drinker: blasts (`charges.ts blast`, after the blast shield), burning hexes (`world-phase.ts burnPhase`), the Dragon's breath (`dragon.ts dragonSpecial`), fire vents (`falls.ts ventCheck`, a shove onto a vent), being thrown into the forge (`falls.ts push` 'fire'), the Pyromancer's fireball on a hero (`delve.ts`) and a crew Pyromancer's fireball (`crewai.ts`). A hit reduced to 0 isn't dealt (so it never kills a downed drinker). Not the firebolt (a bolt, not a fire area).
  - **Gerda + Ilse:** the blasting charge from Gerda at 30 (`PAIR_PRICES`; the offer's `vendor` becomes `gerda`; one offer, the cheaper price wins). **The tripwire:** `setTripwire` (action, Sapper only, `canTripwire`: Gerda and Ilse home, a charge to spend): a free adjacent floor hex with no fuse; spends a charge (improvised first) and sets a fuse of `TRIPWIRE_FUSE` (2) with `tripwire: true`. It counts down and blows like any charge; and when a monster (not the Gloam) or crew member steps onto a hex within 1 of it (`ai.ts walk`, `crewmove.ts crewWalk`), every tripwire within 1 goes off at once (`springTripwires`: "Something steps on the tripwire." / "A tripwire goes taut.", then `blast`), and that walk ends on the step. Heroes walking by never set it off. The preview is the blast preview with "Tripwire: goes off when a monster or crew member steps next to it, or ..."; the hover card over the hex says "Tripwire · fuse N". Hotbar: Sapper ability "Tripwire" (key W, as Set charge; the bar gives the key to whichever comes first).
  - **Aldric + Ilse:** the **greater potion** (`greaterpotion`, 35, 1 slot, `needs: ['surgeon', 'alchemist']`, vendor Ilse): used through the Potion action (targets per potion kind carried; the preview says "Heal 8" / "Back up with 8 HP"; `POTION_HEAL` { potion 5, greaterpotion 8 }); on an active hero heals 8 to max; on a downed hero (the old potion-revive path, kept minimal for WS3's rewrite) up at 8. In camp, `drink` uses one (heals 8) when no plain potion is on the cart. The **antidote at 12** (`PAIR_PRICES`, vendor `aldric`).
  - **Aldric + Wim:** the **hot supper**: in `backToCamp`, with both home (including the one just brought home), every hero who got out heals `SUPPER_HEAL` (2) up to max, with "A hot supper at the Flagon ...: Brann, Pim heal 2."
  - **Gerda + Aldric:** splints (WS3: downed heroes crawl). Only the hook exists here: `pairHome(v, 'smith', 'surgeon')`.
- **Refusals** (`LOCKED` in camp.ts): "Ilse's work: rescue Ilse the alchemist (Level 2, the archive)."; ales "Wim needs Ilse for this brew: ..."; a pair's ware "Needs Brother Aldric and Ilse the alchemist together. Still away: Ilse the alchemist (Level 2, the archive)."
- **UI** (current Lowgate, before WS4's Outfit screen): Ilse's house ("Ilse's bench", the dye-house) in the ribbon with the others (a plea seal while her contract is up); her wares and the greater potion appear among the peddler's tiles once unlocked (locked wares are hidden as before); the three brews in the ale picker; the won-back banner "Ilse the alchemist is home."; `STORY.alchemist`, `ALE`/`ALE_SHORT`/`ALE_EFFECT` entries, item glyph and help for the greater potion, `ACTION_HELP.setTripwire`.

Code: data.ts V4.1 (WS1/WS5) block (`GIFTS`, `pairHome`, `PAIR_PRICES`, `POTION_HEAL`, `DRAGONFIRE_WARD`, `SUPPER_HEAL`, `TRIPWIRE_FUSE`), `SHOP`, `ALES`, `STORIES`; camp.ts `storyAvailable`, `shopOffers`, `aleOffers`, `needsLocked`, `backToCamp`; village.ts (new: `fireWard`, `canTripwire`, `tripwireNear`, `springTripwires`); delve.ts (`potion`, `setTripwire` targets, spec and effect); ai.ts `walk`; crewmove.ts `crewWalk`; castle/index.ts `l2-story-archive`.

### 31.5 Light: torches are the clock (WS2, owner-approved plan, 2026-10-26)

Plan: docs/v41-plan.md WS2 (pitch C1, C3, D, D1, E as amended, L3). Design pillars 15 (rounds left shown because they decide when to leave), 17 (crews carry light too). Overrides 16.2, 17.4, 19.3 and the lantern parts of 7 and 14.5 where they disagree.

**No free lantern.** A delve starts with no party light: `Delve.light`, `lanternBearer` and `lanternOpen` are optional and absent on new delves. `FREE_LANTERN = { enabled: false }` (data.ts) switched on puts the old free lantern back as a slotless loaner Lantern in Keven's (or the first hero's) pack.

**Light items** (`Item.lit`, `Item.rounds`; absent rounds = full):
- **Torch** (Mott, 10, 1 slot). Light (`torch`, an action, `target.itemId`): radius 3 (`TORCH_RADIUS`) for 15 rounds (`TORCH_ROUNDS`; were 2 and 12); a snuffed torch relights with what it had (the log says "relights the torch (13 rounds left)"). Snuff (`snuff`, free): dark, keeps its rounds. Drop torch (`dropTorch`, free): onto the hero's hex, still burning; it lights its hex, burns where it lies, and Take picks it up still lit. One lit torch a hero (a second waits: radii don't add up); several heroes may each carry one. Burns 1 a world phase while lit, carried (up or downed) or on the floor; at 0 it is gone ("Keven's torch gutters out.").
- **Lantern** (new item kind `lantern`, SHOP entry: Gerda, `needs: 'smith'`, `vendor: 'gerda'`, 120 gold, 1 slot, reusable). Holds 20 (`LANTERN_MAX`); radius 4 (`LANTERN_RADIUS_FULL`) at 7+ (`LANTERN_LOW_AT`), 3 (`LANTERN_RADIUS_LOW`) below. Shutter (`shutter`, free, `target.itemId`; label "Open lantern" while shut): open burns 1 a world phase and lights; shut does neither. Empty, it goes dark and stays in the pack (oil or Kindle bring it back). It goes in shuttered. Carried out, it goes back to the cart refilled and shut (`restLight`); lost with a fallen bearer's pack (it lies there still burning, and becomes lost gear as usual).
- **Oil** (`oil`, Ilse, 15; the village builder moved it): an action, +10 (`OIL_LIGHT`, was +8) to a lantern in the hero's pack, 20 at most.
- **Kindle** (Pyromancer, 1 mana; `target.id` = a hero within 3 (`KINDLE_RANGE`), self included, `target.itemId` = their torch or lantern): lights or relights it (an empty lantern lights with 6), or adds 6 (`KINDLE_LIGHT`) to one that burns, to its most. The ally's action is not spent.
- **Braziers** light radius 3 for good as before; lighting one adds nothing to any lantern now (was +4).
- Packed torches and lanterns go in unlit. Back in camp a torch is put out and keeps its rounds.

**Light sources** (`world.lightSources`): every burning torch and lantern in the pack of a hero on the map (active or downed) or on the ground; Glowworm drinkers (radius 1); every crew member on the map (radius 2, `CREW_LIGHT_RADIUS`, not party light); lit braziers (radius 3); then fixed castle lights and burning hexes (`litSet`). Far lights (17.4) include every one of them.

**Darkness by the hero's own hex** (`world.lightTierAt`: party / day / castle / unlit; replaces the lantern stage):

| Hero's hex | Rolls (`DARK_PENALTY`) | Sight L1 / L2 / L3 |
| --- | --- | --- |
| Party light (a torch, a lantern, Glowworm, a torch or lantern lying lit) or daylight | 0 | 8 / 7 / 6 |
| Lit only by a castle light (sconce, fire, brazier, fungus, glow, burning hex, a crew member's light) | −10 | 4 / 3 / 2 |
| Unlit | −20 | 4 / 2 / 1 |

`common.brightnessAt` maps these to the old `Brightness` words (bright, dim, dark; `pitch` is never returned), so roll modifiers read "Dim −10%" and "Dark −20%". `engine.brightness(state)` now reports the first active hero's hex. Monsters' noticing (5.4) reads lit/unlit from `litSet` as before: a hero is lit when any light (a friend's torch, a crew's light, a castle light) reaches them.

**Night-eye Stout** (ale effect `nighteye`, the village builder's ALES entry; `NIGHTEYE_ALE`): the drinker sees as if lit by party light (sight 8/7/6, no dark penalty, "Night-eye: no dark penalty") for the whole delve, but stays unlit to monsters and the Gloam and lights nothing for anyone else (`world.nightEyedHero`). The old night-eye draught (`nightsight` item) has no action any more; an old save's draught rounds (`nightEyes`) still count down and wear off; stash copies are bought back for 15 each on load (`NIGHTSIGHT_REFUND`).

**The Gloam:** Level 3 only, unlit heroes only (`gloamPhase`; the "lantern at 0 anywhere" rise 8–10 from the bearer is gone). It never hunts a lit crew member (crews carry light).

**Crews:** the Lantern Sisters leave after 3 pickups, when nothing is left, or at round 18 (`SISTERS_LEAVE_ROUND`; `SISTERS_LEAVE_LIGHT` is gone). A hostile crew's target (`crewTarget`) and its Burglar's sleep dart go for the hero carrying the most light (the biggest burning radius, `light.brightestHero`) where they used to go for the lantern bearer; then the lowest-HP hero in reach, then the nearest, as before.

**Level 1's dark rooms** (WS8 L1-2): the library stacks (sconces at 4,1 and 12,5), the tower stair (sconces 34,3 and 40,3; the tower top's daylight 37,4) and the armory (sconce 42,10) lost their lights. The tower, armory and library chests sit in the dark. Fixed-light reach of Level 1's floor ~0.80 → 0.73 (castle.test now asks > 0.70 and ≥ 20 lights).

**The board's "Unlit" chip** (C3): `engine.siteUnlit(state, siteId)`: the site hex is in `campaign.explored` and no fixed castle light (or a brazier lit for good) reaches it with every door open (`world.fixedLightReaches`). Lowgate's contract card shows "Unlit" (hover "You'll want light.").

**Old saves** (no save-key bump): a delve saved with the free lantern loads it as a slotless loaner Lantern (`loaner: true`) in its bearer's pack (rounds = the old light, open as it was); a hero's lit torch (`torch` rounds) as a slotless lit torch. Loaners never reach the cart or lost gear and a cutpurse can't lift them (`migrateLight`, run by `deserialize`).

**Contract** (types.ts, api.ts): `ItemKind` + `lantern`; `ShopKind` + `lantern`; `Item.lit`, `Item.rounds`, `Item.loaner`; `ActionKind` + `snuff`, `dropTorch` (both free); `torch`, `shutter`, `oil`, `kindle` take `target.itemId` (kindle also `target.id`); `Delve.light`, `lanternBearer`, `lanternOpen` optional (legacy); `HeroInDelve.torch` legacy (always 0 on new delves). `passLantern` and `nightsight` remain in `ActionKind` but are never offered. `Engine.lights?(state): LightInfo[]` (new `LightInfo`: at, radius, party, kind, holder?, rounds?, max?); `Engine.siteUnlit?(state, siteId)`; `Engine.brightness` documented as the first hero's light. The `light` GameEvent is no longer emitted by the engine (kept in the type for the view).

**Presentation:** the top strip's lantern bar is a light readout (`.dl-lights`): one chip per lit torch or open lantern with who carries it (or "floor") and the rounds left, red at 3 or less; hover gives the table above. The hotbar has Light (key T), Snuff, Drop torch (key U) as buttons; a lit torch's pack slot snuffs it, a lantern's slot or L opens or shutters it; the card shows a torch or lantern icon with its rounds. Lowgate's "Go in with the lantern shut" checkbox and the "Lantern" chip on Keven are gone (a hero who packs Gerda's lantern gets the chip); Set out warns "No light packed. Level 1's daylight will do; deeper, you'll want a torch." The 3D view lights hexes from every carried and dropped torch and lantern and every crew member (`diorama.viewLights`), and hangs the lantern model on whoever carries an open one.

**Sim** (scripts/v3-engine-sim.ts): buys 1 torch per Level 2 contract, 3 per Level 3 (one more at 300+ gold), Gerda's lantern once sold and 120 + 100 can be spared; lights one (the lantern first) when the lead stands unlit on Level 2 or 3, snuffs or shutters on Level 1 in a castle light, kindles a light at 6 or less, oils a lantern at 10 or less; heads out when out of light on Level 2/3 (`outOfLight`, was `LOW_LIGHT`). The "lead" the others keep near is whoever carries the most light.

Code: data.ts V4.1 (WS2) block (`FREE_LANTERN`, `TORCH_RADIUS`, `LANTERN_*`, `KINDLE_RANGE`, `CREW_LIGHT_RADIUS`, `SISTERS_LEAVE_ROUND`, `NIGHTEYE_ALE`, `DARK_PENALTY`, `NIGHTSIGHT_REFUND`), `TORCH_ROUNDS`, `OIL_LIGHT`, SHOP `lantern`; light.ts (new: `lightTargets`, `lightSpecText`, `doLight`, `burnLights`, `lightsOf`, `migrateLight`, `freeLantern`, `restLight`, `siteUnlit`, `brightestHero`); world.ts (`roundsOf`, `lightRadius`, `lightSources`, `emitsLight`, `lightSig`, `litSet`, `lightTierAt`, `nightEyedHero`, `sightRangeAt`, `partyLights`, `fixedLightReaches`); common.ts `brightnessAt`, `LIGHT_PENALTY`, `nightEyed`; delve.ts targets/spec/effects for the light actions; world-phase.ts (`burnLights` at step 1, `gloamPhase`); rivals.ts (Sisters' leave); crewai.ts (`crewTarget`, `dartIntent`); camp.ts (`startDelve`, `backToCamp`); engine.ts (`brightness`, `lights`, `siteUnlit`, `deserialize`); data/castle/level1.ts. UI: hud.ts (`lightMeter`, `toggleShutter`, `statusIcons`), lowgate.ts (`riskChips`, `plan`), names.ts, app.ts, view/diorama.ts. Tests: src/game/light.test.ts (new, 20), castle.test.ts (dark rooms), test/light.ts (the old free lantern as a loaner for pre-WS2 tests).

### 31.6 The Outfit screen (WS4, owner-approved plan, 2026-10-26; UI only, no rule changes)

Lowgate keeps its four steps (Job, Party, Outfit, Set out). Step 3 is two counters, so a player always knows whether they're buying or handling their own things.

**Left, "Yours"** (`[data-side="yours"]`): one card per party hero, in party order. Each card has the hero's name and class line, the 4 pack slots (click a packed item to send it back to the cart), the class kit line (Burglar, Sapper), and what they already have from the village as chips: blade and mail tier pips, the shield, the ale poured. These chips show no price. The hero being packed for is marked **Packing** (an ember border). Clicking another card, or its "Pack for them", selects it. Under the cards sits **Keven's cart** (`[data-cartbox]`): gear (click it into the selected hero's pack), then valuables, each with its worth and Pack / Sell, then Sell all. The cart's side page from the ribbon is unchanged. Owned things never show a price, except a valuable's worth.

**Right, "Vendors"** (`[data-side="vendors"]`): a "Buying for <hero>" line, then **four tabs, always**: Mott's wagon, Gerda's forge, Ilse's bench, the Flagon's taps (`[data-vendor-tab]`; arrow keys, Home and End move between them). A tab whose villager isn't home is dimmed with a lock. Its hover and its header say so in voice ("The forge is cold.", "The Gilded Flagon's taps are dry."). A live tab shows a count of what's for sale. Each tab's header has the vendor's face and name, a line of their voice (Mott's patter as before; Gerda, Ilse and Wim each have three, one per delve in turn), and an Open chip or the not-home line. Rows are grouped: Mott: Light and mending / Getting in and around / Quiet work / Arrows. Gerda: Gear for a hero / Metalwork / Arrows. Ilse: Light and mending / Quiet work / Arrows. The Flagon: On tap / From the cask book / Wim and Ilse's brews. Village perks (the hot supper at the Flagon, splints at the forge) appear as non-buy lines under "Lowgate looks after its own".

**A row** (`.lg-vrow[data-row][data-state]`): glyph, name, a one-line use with no numbers, how many you own ("2 packed", "1 on the cart"; an ale: "Poured: Fenna"), the price (gold glyph and number, `.lg-vprice[data-price]`), and the primary button with that price: "Buy · 20" for a ware, "Forge for Fenna · 60" or "Hone for Fenna · 150" for gear (with tier pips by the name), "Buy for Fenna · 50" for a shield ("Free for Fenna · a gift" while Gerda's credit lasts), "Pour for Fenna · 15" for an ale. Effects and numbers are on hover (pillar 15). Gear and ales go to the hero being packed for. A bought ware goes into their pack if it fits: the new slot glows once, and the row says "Into Fenna's pack." Otherwise it goes on the cart, and the row says "Fenna's pack is full: it's on Keven's cart." A blocked button stays focusable with `aria-disabled` and says why on hover: "You have N gold.", "Fenna has an ale waiting", "Nobody to buy for". At the best tier, or with a shield carried, a row says so instead of offering a button.

**Locked rows** (`SHOW_LOCKED = true` in `src/ui/vendors.ts`, a playtest setting). Every vendor tab lists everything it will ever sell. A locked row is dimmed and dashed, with a lock and no price or button. Its hover is the catalog's in-voice hint, never the rule. A pair's ware names the pair in the hint only. Rows the engine doesn't list yet (a workstream not yet built) appear from the catalog: locked while their gate isn't met, "Not yet" (with the vendor's own line) once it is. When a pair makes a ware cheaper at another vendor (the charge at the forge, the antipoison at Ilse's bench), the old seller's row points there instead of selling it.

**The catalog** (`src/ui/vendors.ts`, `CATALOG`, `PERKS`, `VENDORS`) is the one table of everything sold, by vendor: kind, engine keys, name, group, use line, catalog price, gate, hint. `rowStatus` merges a row with `engine.shop(s)` and `engine.ales(s)`: the engine's price, name and `locked` win when it lists the row, and a ware the engine lists but the catalog doesn't still shows, live, under "Also". Source: docs/v41-vendors.md. Unit-tested in `src/ui/vendors.test.ts`: every engine ware and ale has a row, the gates, the moved pair wares, and the unbuilt rows.

The old peddler's wagon / Keven's cart tabs, the per-hero forge row and the ale picker are gone. Checks: scripts/v40-lowgate-check.mjs (Outfit section), screenshots: scripts/v41-outfit-shot.mjs, docs/shots/v41-outfit.png.
