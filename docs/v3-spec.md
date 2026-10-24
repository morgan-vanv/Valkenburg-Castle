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

- `LIGHT_MAX` = 60. A delve starts at 60. Burns 1 per world phase.
- Brightness from light: bright > 36, dim 19..36, dark 1..18, pitch 0.
- Light radius around the lantern bearer: bright 4, dim 3, dark 2, pitch 0. Hexes inside are lit. Each hero with a lit torch lights radius 2 around them. Each lit brazier lights radius 3 around it.
- Sight: heroes see lit hexes in line of sight within 8, plus every hex within 1 of them. Unlit hexes beyond 1 are unseen.
- A hero standing in an unlit hex fights at "dark" penalties (−20) regardless of the lantern. That's the cost of splitting up without a torch.
- Torch: `torch` action uses one from the pack: 12 rounds of radius-2 light around that hero. Lighting a brazier: +6 light to the lantern, permanent radius 3 light there, stays lit across delves.
- Kindle: +12 (cap 60). The lantern can be passed to an adjacent hero (action).
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
