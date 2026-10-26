# Current rules (V4.0)

Current rules at V3.9.4 (2026-10-26), with V4.0's shut entrances (spec 25, branch `v4.0-entrances`) and V4.0's play-test fixes (spec 26: Walk/Sneak per hero, noticing during moves, when monsters turn). Verified against the code; where this and docs/v3-spec.md disagree, this file and the code win. The spec stays as the version-by-version history.

Scope: the rules engine (src/game) and castle data (src/data/castle) as they stand on `main` at V3.9.4 (commit bc3f1fd). Presentation is mentioned only where it carries a rule. Every number below was read from the code. Section 18 lists where the spec disagrees.

Conventions: "slot" is one die in a slot roll; "level" means a castle level (1 to 3) unless it says hero level; distances are hex steps on one level; "path distance" is walking distance where a closed door counts 2.

---

## 1. Premise and loop

Keven (id `keven`, class `heir`), son of the late Lord Hobart, retakes Castle Valkenburg from Lowgate, a derelict village under its walls. A campaign is one roguelite run on one fixed three-level castle.

Loop: in camp, pick a contract from the notice post, pick 1 to 4 heroes, fill their packs from the stash, pick an open entrance (a new campaign has only the main gate; section 3.1), delve. A delve is a turn-based extraction: reach the objective, get out through an exit. The summary is applied in camp, the board and recruits refresh, repeat. The campaign ends when Keven dies or is carried off by a crew. There is no win state in code.

Code: src/game/engine.ts (`createEngine`, `apply`), src/game/camp.ts (`newGame`, `campCommand`, `startDelve`, `buildSummary`, `backToCamp`). Stages: `Stage` = 'camp' | 'delve' | 'summary' | 'over' (types.ts).

---

## 2. Camp

### 2.1 Start

- Gold 90 (`START_GOLD`). Reputation 0. Roster: Keven alone. Village: nothing won back.
- Keven may delve alone; the camp does not force a hire.
- Entrances: only the main gate is open (`campaign.opened = {}`); the sally port and the east breach are shut until opened in play (section 3.1). Castle memory empty (`campaign.explored = {}`).

### 2.2 Village stations and who unlocks them

| Station | Before | Unlocked by (story) | After |
| --- | --- | --- | --- |
| Notice post | Up to 3 regular contracts, plus every available story contract, plus every "Bring back" contract | always | |
| Hiring | Campfire: 3 level-1 recruits | Old Wim (`innkeeper`) | Gilded Flagon: 4 recruits, 35% level 2. With `caskbook`: 25% level 2, 10% level 3 |
| Peddler | Everything but metalwork and night-eye | Gerda (`smith`): metalwork; Wim: night-eye draught | |
| Forge | Cold | Gerda (`smith`) | Weapon/armor tiers, shield |
| Infirmary | Only `drink` (a stash potion: +5 HP) | Brother Aldric (`surgeon`) | `heal`: 3 gold per HP, up to full or what the gold covers |
| Ales | Locked | Brewing copper (`copper`) home, and Wim | 4 ales; 3 more with the cask book |

Refusal texts name the fix (`LOCKED` in camp.ts).

### 2.3 Story contracts

Story contracts carry no "Story" or "Unlocks …" warnings (V4.0: the board shows story status itself); only "Level N" and the copper's "Heavy" line.

| Story | Kind | Site | On the board when | Bounty | Unlocks |
| --- | --- | --- | --- | --- | --- |
| surgeon | rescue Brother Aldric | l1-story-chapel (L1 Chapel) | from the start | 40 | infirmary |
| innkeeper | rescue Old Wim | l1-story-kitchens (L1 Kitchens) | reputation ≥ 1 | 40 | Gilded Flagon, night-eye draught |
| smith | rescue Gerda the smith | l2-story-forge (L2 Forge) | reputation ≥ 1 | 75 | forge, shield, metalwork |
| copper | recover the brewing copper | l2-story-barracks (L2 Barracks) | Wim home | 90 | the first four ales |
| caskbook | recover Wim's cask book | l3-recover-drain (L3 the Drain) | copper home and reputation ≥ 2 | 130 | three strong ales, better recruits |

- Story bounty = half the regular bounty for kind and level, rounded down to 5. Reputation +1 as usual.
- A rescued villager does not join the roster; the village flag is set on return and a `villageUnlocked` event fires.
- The copper takes 2 pack slots and is `heavy` (carrier moves 3 at most, dash too). The cask book takes 1 slot. Both are worth 0, never sold, never handed over in parley, and go to the village, not the stash.

### 2.4 Regular board

- Up to 3 regular contracts, rebuilt (seeded) every time camp refreshes (after every delve).
- Levels open by reputation (`REP_FOR_LEVEL`): Level 1 always, Level 2 at 1, Level 3 at 2. The slay contract appears at reputation 3 (`REP_FOR_SLAY`) and is always one of the three once unlocked. At least one Level 1 contract is on the board.
- Story sites and crew hideouts are never used by the regular board.
- Bounties (`BOUNTY`): rescue 80 / 150 / 220 (L1/L2/L3), recover 100 / 180 / 260, slay 500. Paid only if the contract is done.
- Done: rescue = the prisoner got out; recover = a hero got out with the contract item in their pack; slay = the Dragon died and at least one hero got out.
- Reputation +1 per contract done.
- A rescued regular prisoner joins the roster free as a level 1 hero of a random recruitable class.

### 2.5 Recruits

- Recruitable classes: sellsword, burglar, ranger, sapper, pyromancer, shadowmancer, hedgewitch. Offers include at least 3 different classes. Refreshed after every delve.
- Price 60 + 40 × (level − 1): 60 / 100 / 140.

### 2.6 Peddler (`SHOP`)

| Item | Price | Needs | Effect (details in section 9) |
| --- | --- | --- | --- |
| Torch | 10 | | 12 rounds of radius-2 light |
| Potion | 20 | | Heal 5, or get a downed hero up at 5 HP |
| Rope | 15 | | Anchor at a pit edge to climb down and back |
| Blasting charge | 30 | | Set with fuse 1 on an adjacent lock or breakable wall |
| Smoke bomb | 20 | | Throw 4: smoke on the hex and neighbours, 2 rounds |
| Glue bomb | 25 | | Throw 4: monsters within 1 stuck 2 rounds |
| Sleep dart | 25 | | Throw 5: 1 Finesse slot, a hit puts a monster to sleep |
| Oil flask | 15 | | +8 lantern light |
| Firecracker | 10 | | Throw 6: noise 6 there |
| Caltrops | 15 | smith | Adjacent hex: first monster across takes 2 and stops |
| Grappling hook | 40 | smith | Reusable: climb from a pit landing up a level |
| Skeleton key | 30 | smith | One use: opens a lock silently, anyone |
| Lockpicks | 25 | smith | Permanent picks: Burglar 3 slots, others 2 |
| Night-eye draught | 30 | innkeeper | Drink: 8 rounds of full sight, no dark penalty |

Bought items go to the stash. `sellAll` sells every gem, jewelry, heirloom and hoard piece in the stash for its value (story items excluded).

### 2.7 Forge (needs the smith)

- Weapon tier 1: 60, tier 2: 150 (`WEAPON_PRICE`). +10 to the weapon's roll chance per tier.
- Armor tier 1: 80, tier 2: 200 (`ARMOR_PRICE`). +1 armor per tier.
- Shield (`buyShield`): 50, any class, one per hero. Ranged hits do 1 less, 2 less while braced.

### 2.8 Ales (the Flagon, needs Wim and the copper)

One ale per hero, bought in camp (`buyAle`), drunk at the start of that hero's next delve, then cleared.

| Ale | Price | Needs | Effect for one delve |
| --- | --- | --- | --- |
| Glowworm Pale | 15 | copper | Drinker sheds party light radius 1 (counts as their own light) |
| Featherfoot | 15 | copper | Drinker's first fall deals no damage |
| Mole's Brown | 20 | copper | Drinker can Dig like a Sapper |
| Hobart's Reserve | 20 | copper | Focus starts at 4, max 4 |
| Smuggler's Mead | 20 | caskbook | Sneak moves 4 (silent as always) |
| Fireside Porter | 25 | caskbook | Heal 3 each time the drinker changes level (stairs, lift, fall, rope, hook), after fall damage |
| Black Cask | 10 | caskbook | At delve start (seeded): 70% one of the six above; 30% hiccups (noise 1 at the drinker every world phase) or heavy head (Focus starts at 1) |

### 2.9 Heroes between delves

- HP carries over. A delve starts each hero at their campaign HP (at least 1); a survivor's HP is written back. Nothing heals for free.
- XP: kill XP by monster (`MONSTERS[kind].xp`: berserker 3, captain 2, ghoul 2, others 1); crew member killed 1; survive +1; contract done +3 to every survivor; Dragon slain: 10 split among every hero in the delve (remainder to the killer).
- Level thresholds (total XP, `LEVEL_XP`): level 2 at 5, 3 at 12, 4 at 20, 5 at 30, 6 at 45 (max 6). Each level: +2 max HP and +2 HP, +5 to the class's main stat. Level-ups apply only to heroes who got out.
- The dead go to `campaign.fallen`. Their pack drops where they died; non-heirloom, non-hoard items from fallen heroes persist as ground loot in later delves (`lostGear`).
- Items taken in and not carried out are lost. Gold carried out goes to camp gold; other items to the stash. The satchel and the improvised pick never reach the stash.
- Lit braziers stay lit for the campaign (`litBraziers`). Hoard pieces carried out never come back (`hoardTaken`).
- V4.0: ways in opened during the delve (`Delve.ways`) are merged into `campaign.opened`; a hero who gets out carrying the sally port key opens the sally port for good ("With its key in hand, the sally port gate is yours. It stays open."). The key never reaches the stash and is never lost gear.
- V4.0: every hex the delve explored is merged into `campaign.explored` (hex keys "q,r" by level), the campaign's memory of the castle (`castleMemory`).

### 2.10 Captives

- A hero carried out by a crew leaves the roster for `campaign.captives` at HP 1 (gold, gems and jewelry already taken by the robbing; the rest of their pack is lost; level, tiers and shield stay with the hero record).
- A "Bring back <name>" rescue contract is pinned at the top of the board for each captive. Site: the crew's hideout. Bounty: the full regular rescue bounty for the hideout's level. The prisoner is the hero at HP 1. Freed and extracted, they rejoin the roster with the HP they came out with. If they die there, they go to the fallen.

| Crew | Hideout | Level | Bounty |
| --- | --- | --- | --- |
| Lantern Sisters | officers' quarters | 2 | 150 |
| Ferrymen | the Drain | 3 | 220 |
| Gallows Choir | the Tunnels | 3 | 220 |
| The Wake | the Bone Pile | 3 | 220 |

### 2.11 Campaign end

- Keven dead: stage 'over', "The heir has fallen. Valkenburg stays dark."
- Keven captured: stage 'over', "The heir is taken. Valkenburg stays dark."

Code: camp.ts (`refreshCamp`, `makeBoard`, `storyAvailable`, `storyBounty`, `captiveBoard`, `shopOffers`, `aleOffers`, `healQuote`, `backToCamp`); data.ts (`START_GOLD`, `BOUNTY`, `HEIRLOOM_VALUE`, `REP_FOR_LEVEL`, `REP_FOR_SLAY`, `SHOP`, `ALES`, `STORIES`, `RECRUIT_PRICE`, `RECRUIT_PRICE_PER_LEVEL`, `CAMPFIRE_SIZE`, `FLAGON_SIZE`, `FLAGON_L2`, `CASKBOOK_L2`, `CASKBOOK_L3`, `HEAL_PER_HP`, `DRINK_HEAL`, `WEAPON_PRICE`, `ARMOR_PRICE`, `SHIELD_PRICE`, `LEVEL_XP`, `MAX_LEVEL`, `SLAY_XP`).

---

## 3. Delve setup

- Squad: 1 to 4 distinct heroes from the roster (`partyProblem`). No fitness check.
- Packs: up to 4 slots per hero from the stash; each item in one pack only.
- Entrances (`castle.entrances`, index order): 0 main gate L1 (24, 31), 1 sally port L1 (1, 14), 2 east breach L1 (44, 21). Only an open one may be used (section 3.1); `startDelve` refuses a shut one: "The sally port is barred shut. Go in by the main gate." / "The east breach is choked with rubble. Go in by the main gate." Heroes are placed on the entrance and the nearest free hexes.
- Ways already opened this campaign stand open (the gate open and unlocked, the rubble in `blown`). While the sally port is shut, its key lies in the library at L1 (3, 1).
- Lantern: full (20), open; the bearer is Keven if he goes, else the first hero.
- Each hero: Focus 3 (4 with Reserve, 1 with heavy head), mana 3 for the three mage classes. The Sapper gets the satchel (3 charges, slotless). Every Burglar gets one improvised pick (slotless).
- Every hero faces "into the castle": toward the centroid of floor hexes within 6.
- Objective placed: a recover item at the site (heirloom value 60 / 120 / 180 by level, or the story item), or a shackled prisoner (5 HP; a captive hero 1 HP). The slay target is the Dragon spawn.
- Hoard: up to 3 pieces (300 each, 2 slots) on free Lair hexes round the Dragon, minus those already carried out.
- Coins, chests, traps, lost gear, lit braziers from the castle data and campaign.
- A rival crew is rolled (section 12).

### 3.1 Shut entrances (V4.0)

| Entrance | New campaign | Shut by | Opens with | Engine state |
| --- | --- | --- | --- | --- |
| Main gate | open | | always open | `open` |
| Sally port | shut | a barred gate at L1 (2, 14), between the exit and the kitchens | its key (Unbar), or a blast within 1 (a charge, a Sapper's charge) | `locked` |
| East breach | shut | two rubble heaps at L1 (42, 21) and (43, 21), between the exit and the chapel | a blast within 1 or a Dig on each heap; open once a walkable path joins the exit to the main gate | `blocked` |

- Once opened, a way stays open for the rest of the campaign: as an entrance and as an exit. Until then its exit can't be used to Leave, and no crew or cutpurse paths out through it.
- The barred gate is a locked door (`barred`): Pick, Smash, the skeleton key and a crew's open job never work on it. The heaps are cracked tiles (`heap`): they block sight and passage like a cracked wall until cleared.
- The sally port key (`gatekey`): 1 slot, worth 0, never sold, never handed over in parley, never stolen by a cutpurse, ignored by prospectors looting. Unbar: action, silent, anyone, next to the gate; the key stays in the lock. Carried out of the castle, it opens the gate for good. One copy lies in the library while the gate is shut and has never been opened; a second comes with the Lantern Sisters when they enter by the shut sally port (section 12.1).
- Log lines: "The sally port gate swings open. It stays open." and "The east breach is clear. A new way in." (when a blast, a Dig, the key or a crew's blast opens them; never when a crew lets itself in by the gate with its own key).
- `Engine.entrances(s)`: one entry per entrance, index order: `{ index, name, state: 'open' | 'locked' | 'blocked', known, hint? }`. `known`: open, or the exit hex or the gate/rubble in the campaign's memory (or this delve's explored hexes). `hint` while shut: "A barred gate. It wants its key, or a charge." / "Choked with rubble."
- `Engine.castleMemory(s)`: `{ level, hexes }` per castle level, hex keys "q,r" the campaign has explored (empty on a new campaign).
- Saves from before V4.0 (no `campaign.opened`) keep all three entrances open; their memory starts empty.

Code: camp.ts `startDelve`, `spawnMonster`, `freeSpotsNear`, `drinkAle`; dragon.ts `placeHoard`; stealth.ts `facingInto`; ways.ts (`shutWays`, `campaignOpen`, `wayOpen`, `startWays`, `applyOpenWays`, `checkWays`, `mergeDelve`, `entranceList`, `castleMemory`, `isGateKey`); data/castle/index.ts `entranceNames`, `shutWays`.

---

## 4. Turn structure

- A round = player phase, then world phase. No initiative.
- Player phase: each active hero may move once and act once, in either order.
  - **Dash**: a hero who has moved and not acted may spend the action on a second move (same allowance, walk or sneak). A hero who acted first gets a normal move afterwards.
  - Whole-turn actions (need both move and action unused): jump, climb, grapple.
  - Free actions (no action used, any number): open/close a door, take, drop, give, leave, shutter, parley (deals are a separate free command, one per crew per round). Opening a chest is free for a Burglar; for anyone else it uses the action.
  - Walk/Sneak (`setMoveMode`, V4.0): free, any number, any active hero; changes only that hero's setting (section 5.1).
- **End turn** runs the world phase:
  1. Sight refreshed; `heard` cleared; unseen-attacker reveals that expired are dropped.
  2. Lantern burns 1 if open. Burning hexes deal 1 to everyone on them. Hiccups noise. Torches −1. Roots on heroes −1. Downed heroes bleed −1 (die at 0), except a hero being dragged by a crew.
  3. Monsters act in id order (the Gloam separately).
  4. The rival crew acts (enters, notices, tolls, then each member).
  5. The Gloam acts (rises, hunts, or fades).
  6. Fuses count down; charges at 0 go off.
  7. Reset: moved, acted, dashed, overwatch, guard and brace cleared on heroes; Rally cooldown, veil, ward, night-eye tick down; heroes webbed or dozing since the last world phase are freed. Monster `stuck`, shout cooldown and fear tick down; crew fear and roots tick down. Smoke, glue, burning tick down.
  8. Round +1, player phase, new intents for every awake monster and crew member.
- The delve ends when no hero is active. At the end, downed heroes still inside die (a downed hero being dragged is captured instead).
- `abandon`: heroes on an exit leave; everyone else still inside dies.

Code: world-phase.ts `worldPhase`, `computeIntents`; delve.ts `moveKind`, `canDo` (`FREE`, `WHOLE_TURN`), `checkDelveEnd`, `endDelve`, `abandon`.

---

## 5. Movement, noise and stealth

### 5.1 Movement

- Walk 4. Sneak 2 (Burglar 4; Smuggler's Mead 4). Escorting the prisoner: 3 at most. Carrying a heavy item: 3 at most.
- Walk or sneak is each hero's own setting for the delve (`HeroInDelve.moveMode`, V4.0): Burglars start on `sneak`, everyone else on `walk` (absent, as in older saves: walk). The free `setMoveMode` command (`{ heroId, sneak }`) changes it for that hero only. A `move` without `sneak` uses it, as do `reachable`, `moveNoise` and `calmReach` when their `sneak` argument is left out; an explicit `sneak` on a move wins and doesn't change the setting.
- Rubble costs 2. Stairs: stepping from a stairs hex to its linked hex costs 1. Lift: the same, once the winch is worked.
- Can't enter walls, pillars, props, tall props, braziers, pits, cracked walls, the sealed stair, locked closed doors, or a hex with a monster or non-hired crew member. Heroes pass through heroes, the prisoner and hired crew members; they can't end on anyone.
- Unlocked closed doors open as a path passes through them and stay open.
- Webbed, grabbed, dozing or rooted heroes can't move or dash (they may still act unless dozing).
- Spotted traps are avoided by the pathfinder when an equal path exists.
- Walking a step faces the hero in that step's direction (stairs keep facing).

### 5.2 Noise

Noise is a ripple of radius R; a hex hears it if its path distance from the source is ≤ R (closed doors count 2; floor, props and pits carry it). The charge blast is also heard on the levels above and below within straight distance R.

| Source | Noise |
| --- | --- |
| Walking, per hex stepped (rubble 2) | 1 |
| Sneaking | 0 |
| Melee attack, shove | 2 |
| Bow attack, overwatch, knockback, hamstring | 1 |
| Firebolt | 3 |
| Fireball | 6 |
| Briar | 1 |
| Gust | 2 |
| Night thorn, Sleep, Dread, Blink, Veil, Ward, Mend, Kindle | 0 |
| Pick, one hit short of all slots | 2 |
| Smash (lock), smash crate, Dig | 4 |
| Trap set off | 2 |
| Escape a grab | 1 |
| Winch | 6 |
| Firecracker | 6 |
| Charge blast | 8 (levels above and below too) |
| Monster or crew member killed | 2 |
| Orc's first-sight bellow, captain's shout | 5 |
| Dragon's breath | 6 |
| Hiccups (Black Cask) | 1 |

Effects of noise on monsters (not the Gloam, not buried ghouls): every monster that hears it and isn't hunting turns to face it (V4.0: a hunting monster keeps its facing, section 6.1). Asleep or patrolling → alert at the source, searching 3 rounds (berserkers go hunting). Alert → re-focus on the source and restart the search. The Dragon wakes on noise ≥ 4. A waiting cutthroat crew hears noise ≥ 4 made in the player phase and demands its toll.

### 5.3 Wake rolls (sleepers hear only)

Sleepers never notice anyone by sight. For each hex a hero steps on within 2 of a sleeping monster (not the Dragon or the Gloam):

| | Walking | Sneaking | Sneaking Burglar |
| --- | --- | --- | --- |
| Per hex within 2 | 50% | 10% | 5% |
| Ending the move adjacent | 100% | 25% | 10% |

- Per-hex chances halve when the hero's hex is unlit.
- Walking noise (1 per hex) also wakes any sleeper within path distance 1 for sure.
- Arriving without walking (fall, climb, grapple, blink) next to a sleeper: wakes it for sure, 25% if the arrival counts as quiet (blink).
- A woken sleeper goes alert at the hero's hex.

### 5.4 Noticing (awake monsters and waiting/hostile crews)

An awake watcher notices a hero it has not yet noticed by these ranges (line of sight; smoke on either hex hides beyond 1):

| Hero is | Walking | Sneaking | Sneaking Burglar |
| --- | --- | --- | --- |
| Lit (L1, L2) | 8 | 4 | 2 |
| Unlit (L1, L2) | 5 | 1 | 1 |
| Level 3, any light | 8 | 3 | 2 |

- In the watcher's blind area (section 6): a walking hero is noticed only when adjacent; a sneaking hero never.
- "Sneaking" is the hero's last move mode; it persists while they stand still. A hero who never moved counts as walking. The Walk/Sneak setting (5.1) doesn't change this: a Burglar set to sneak who hasn't moved yet counts as walking, and switching a standing hero to Sneak doesn't hide them.

When (V4.0, spec 26.2): noticing happens the moment it would.
- **During a move, in the player phase:** at every hex of a walk, every awake monster on that level (not asleep, not the Gloam, not the Dragon, not buried) that hasn't noticed the moving hero checks the rule above at that hex; so a hero who walks through a field of view and out again is still spotted. The check comes after the step (the hero faces the step) and before that step's noise and wake rolls: a sleeper woken by a step notices from the hero's next step on; a sleeper woken by the last step stays alert until the world phase or the hero's next move. Arrivals that aren't walks (blink, fall, jump, climb, grapple, a gust push) check once at the landing hex, before the landing's wake rolls. Only the hero who moved is checked (another hero newly lit by the lantern bearer's walk is noticed in the world phase).
- Effects, the same as in the world phase: remembered (`noticedIds`), a `noticed` event (`at`: the hero's hex then; `faced`: whether it turned), hunting with focus on that hex (an unaware monster turns to the hero; one already hunting keeps its facing and its quarry), the orc's first-sight bellow (noise 5, which can set off a waiting cutthroat crew's toll). The hero finishes the move. The monster re-plans its intent when the command ends (`Ctx.replan`, in `engine.apply`), keeping its quarry, so the intent shown for the world phase is right. A walk's `moved` event is split at the hex so the view plays the "!" there.
- A waiting cutthroat crew checks the moving hero the same way at every hex (`crewNotice(c, heroId)`), and demands its toll then; it still checks every hero after every command (`refreshSight`).
- **In the world phase:** each monster still looks round as it acts (`perceive`), so one that turned or moved can spot heroes then.
- A monster that has noticed a hero (`noticedIds`) keeps tracking them by plain sight, ignoring facing: within 8 (`MONSTER_SIGHT`) in line of sight, and the hero lit or within 5 (`MONSTER_DARK_SIGHT`); on Level 3 light doesn't matter; smoke hides beyond 1.
- Noticing makes the monster hunt. In the world phase it looks round on its turn and hunts its quarry: the hero its intent named, while it still makes them out, else the nearest perceived hero; it faces the quarry (V4.0: not the last hero noticed). A monster forgets who it noticed when it loses its quarry, is put to sleep, or is smoked out.
- Veiled heroes are not targets at all.
- Waiting cutthroats use the same noticing rule capped at 6 (`CUTTHROAT_SIGHT`).

### 5.5 Monster awareness states

- `asleep`: doesn't act; wakes by sound only.
- `alert`: walks toward `focusAt`; searches 3 rounds (`SEARCH_ROUNDS`), then patrollers return to the nearest waypoint (`patrol`), others walk back to their spawn hex and stand alert there.
- `patrol`: walks its move allowance along its looping route. A hero who sees a patroller walk learns its route (`knownRoutes`).
- `hunting`: goes for the nearest perceived hero; on losing sight, goes alert at the last seen hex (berserkers never lose interest).
- Defaults at spawn: alert at post; patrol if it has a route; asleep only if the map says so; berserkers and buried ghouls hunting.
- Monsters use stairs and the lift only while hunting. The Gloam uses stairs and passes locked doors.

### 5.6 Move preview (`Reach.risks`)

Each reachable hex lists: wake rolls along the path for sleepers the party has seen, with chance; awake enemies currently visible that would notice the hero at any hex of the path (V4.0, `at`: the first such hex), taking watchers as they face now (a wake roll or a bellow on the way can turn one; the dice can't be previewed), a waiting crew within 6; free swings leaving provokes from seen enemies, with damage range (blindside slot included). Unseen enemies still roll and act; they are just not previewed.

Code: delve.ts `doMove`, `afterHeroMove`, `reachable`, `moveBudget`, `sneakSetting`, `doSetMoveMode`, `blocksHero`; camp.ts `startDelve` (`moveMode`); engine.ts `apply` (`setMoveMode`, the `replan` pass); stealth.ts `wouldNotice`, `perceivable`, `isSneaking`, `noticeHero`, `wakeChance`, `wakeRolls`, `stepNoise`, `moveRisks`; common.ts `makeNoise`, `goAlert`, `goHunting`, `loseQuarry`, `wakeAdjacent`; world.ts `noiseField`, `monsterSees`; world-phase.ts `perceive`, `noticeOnMove`, `firstSightBellow`, `searchTick`, `patrolPlan`; rivals.ts `crewNotice`; calm.ts `stepTo`; data.ts `STEP_NOISE`, `RUBBLE_STEP_NOISE`, `WAKE_RANGE`, `WAKE_WALK`, `WAKE_SNEAK`, `WAKE_END_SNEAK`, `WAKE_SNEAK_QUIET`, `WAKE_END_SNEAK_QUIET`, `NOTICE`, `NOTICE_QUIET`, `MONSTER_SIGHT`, `MONSTER_DARK_SIGHT`, `SEARCH_ROUNDS`, `SMUGGLER_SNEAK`, `HEAVY_MOVE`.

---

## 6. Facing, fields of view, blind areas, hearing

### 6.1 Facing

- Every hero, monster and crew member has `facing` 0..5. Direction from a hex to another is the nearest of the six (`dirIndex`, ties to the lower index).
- Heroes: face their last step; turn toward the target of any action aimed at a hex or figure on their level (`FACING.turnOnAction = true`). There is no Face command (`FACING.faceCommand = false`).
- Monsters and crew members: face their last step and turn toward anything they strike or use an item, spell or ability on. Spawned monsters face the map's facing (default 0). A figure with no facing (a crew at its post) sees all round.
- V4.0 (spec 26.3), monsters: an unaware one (asleep, alert, patrolling) turns toward a noise it hears and toward a hero it newly notices. A hunting one does neither (it still notices them): it turns on its own turn, toward its quarry as it looks round (5.4), the step it takes or what it strikes, and when hit. Going hunting turns a monster to its quarry (hit while unaware, the captain's shout, a ghoul rising).
- Crew members turn toward a hero they notice and never toward noise (unchanged).
- **Hits turn them** (V4.0): a single-target attack that hits a monster (not the Gloam) or crew member turns it to face the attacker, after the hit resolves (a backstab lands from behind first): strikes, shots, firebolt, night thorn, briar, hamstring, shove, knockback, free swings, overwatch, a hired crew member's hit on a monster. Misses don't turn it. Area damage (fireball, gust, blasts, fire, caltrops, traps) doesn't turn a hunting monster; an unaware one hit by it goes hunting toward the caster, and so faces them, as before.

### 6.2 Blind areas

| Figure | Blind area |
| --- | --- |
| Hero | Cone straight behind: the single back direction, any distance, adjacent included |
| Crew member | Same cone straight behind |
| Monster | Whole rear half: the back direction and its two neighbours |

Everything that says "behind" uses the figure's blind area: hero visibility, noticing, blindsided, unseen hits, overwatch (heroes and crew), backstab.

### 6.3 Hero visibility

- The party's visible set is the union over active heroes. A hero sees hexes outside their blind cone: every such hex within 1, plus hexes in line of sight within their sight range (section 7.3), plus far lights in line of sight up to 14.
- Explored layout stays explored. Units, intents and lit floor follow the visible set.
- Enemies the party can't see are not targets for attack or shove, even adjacent; their intents are not shown.
- `seenEnemies`: monsters and crew members any hero has seen this delve (dead ones dropped). Previews use it.

### 6.4 Blindsided and unseen hits

- An enemy attack on a hero from the hero's blind cone gets +1 slot (`BLINDSIDE_SLOTS`): monster and crew strikes, free swings, overwatch shots, hamstring shots.
- If the attack comes from the hero's blind cone and no hero can see the attacker, the log says "Something strikes X from behind" (`unseenHit` on a hit), and the attacker is visible to the party through the end of the next player phase, hit or miss.

### 6.5 Hearing (heroes only; `HEARING.enabled = true`)

During the world phase, a monster or crew member the party can't see that makes a sound within a hero's hearing creates a `Heard` entry (`Delve.heard`) and a `heard` event: where, not who. Entries last through the next player phase and are cleared when the following world phase starts. Deduplicated per hex and kind. Heard enemies stay unseen.

- **Footsteps** (`steps`): each hex an unseen enemy steps onto, heard by a hero within path distance: rats, spiders 2; ghouls, cutpurses 3; orcs, archers, captains, crew members 4; berserkers 5; the Dragon 8. Feared figures +1. The Gloam is silent.
- **Loud** (`loud` with `what`), heard within the sound's own path radius: `clash` (enemy strikes and free swings 2; enemy noise-making attacks at their noise), `shout` (5), `crash` (a locked door forced 4; crew winch 6; crew gust 2), `blast` (charges 8, crew fireball 6, crew firecracker 6), `roar` (breath 6), `scream` (a monster or crew member hurt out of sight 2; a hero downed by an unseen attacker 3).
- Hearing never changes what monsters see or do.

Code: world.ts `dirIndex`, `inFrontHalf`, `blindCone`, `seesHex`, `visibleSet`, `glimpseSet`; stealth.ts `faceToward`, `noticeHero`, `inRearHalf`, `facingInto`; common.ts `turnOnHit`, `makeNoise`, `goHunting`; world-phase.ts `perceive`; ai.ts `blindside`, `unseenStrike`; delve.ts `setFacing`, `refreshSight`, `noteSeen`, `seenSet`; hearing.ts (`STEP_RANGE`, `CREW_STEP_RANGE`, `FLEE_STEP_BONUS`, `CLASH_HEAR`, `DOWNED_HEAR`, `FORCED_DOOR_HEAR`, `hearStep`, `hearLoud`, `clearHeard`); data.ts `FACING`, `HEARING`, `BLINDSIDE_SLOTS`.

---

## 7. Light, lantern, sight, dark, the Gloam

### 7.1 The lantern

- Holds 20 (`LIGHT_MAX`); a delve starts full. Burns 1 per world phase while open, on every level.
- Stages: bright 13–20, dim 7–12, dark 1–6, pitch 0.
- Lantern light radius around the bearer: bright 4, dim 3, dark 2, pitch 0.
- **Shutter** (free, bearer only, any time in the player phase): toggles `lanternOpen`. Shuttered: no burn, no lantern light. Passing keeps the state.
- **Pass lantern** (action): to an adjacent active hero. If the bearer is downed, dies, leaves or is captured, the nearest active hero takes it.
- Refuel: Kindle +6, oil flask +8, lighting a brazier +4. Capped at 20.

### 7.2 Lit hexes

A hex is lit if in line of light (smoke doesn't block light) of: the open lantern (stage radius); a hero's lit torch (radius 2, 12 rounds); a Glowworm drinker (radius 1); a lit brazier (radius 3); a fixed castle light; a burning hex (itself).

Fixed lights (`castle.lights`, radius): sconce 2, daylight 3, fungus 2, glow 2, fire 3 by default; the Lair's two fires are radius 2 and its three fire vents radius 1.

### 7.3 Sight range (per hero, `sightRangeAt`)

| Hero's hex | Level 1 | Level 2 | Level 3 |
| --- | --- | --- | --- |
| Night-eye draught active | 8 | 7 | 6 |
| Unlit | 4 | 2 | 1 |
| Lit by party light (open lantern, torch, Glowworm): bright | 8 | 7 | 6 |
| … dim | 6 | 5 | 4 |
| … dark | 4 | 3 | 2 |
| … pitch | 2 | 2 | 2 |
| Lit by daylight only | 8 | – | – |
| Lit by another castle light only (sconce, fire, brazier, fungus, glow, burning) | 4 | 3 | 2 |

- Never below 2 when lit. The layout glimpse (exploring) uses the same range, in the hero's field of view, from every hex they step on.
- **Far lights**: beyond sight range, up to 14 (`LIT_SIGHT`) in line of sight, only light sources show: a non-daylight fixed light's own hex, a lit brazier, a burning hex, the open lantern's bearer, a torch-bearer or Glowworm drinker. Daylight shows its whole lit patch. Walls are not revealed around far lights.
- Walls, pillars, tall props, braziers and props next to seen floor are revealed (no holes in rooms). Line of sight is permissive: clear to the target's centre or any of its six corners pulled 10% in. Pits don't block sight; closed doors, walls, pillars, cracked walls, tall props, the sealed stair and smoke do.

### 7.4 Brightness penalty to rolls

| | Bright | Dim | Dark | Pitch |
| --- | --- | --- | --- | --- |
| Penalty | 0 | −10 | −20 | −30 |

The stage is the lantern's, whatever lights the hero's hex. A hero on a lit hex rolls at the lantern stage (pitch counts as dark). A hero on an unlit hex rolls at dark (pitch if the lantern is at 0). Night-eye removes the penalty.

### 7.5 The Gloam

- Present when the lantern is at 0 (any level), or when an active hero stands on an unlit hex on Level 3.
- Rises (if absent) on a dark, free floor hex out of the party's sight if possible: 8 to 10 from the lantern bearer for the pitch case ("Something moves in the dark."); 4 to 6 from the first unlit hero on Level 3 ("The dark here is awake."). It acts at once.
- Moves 3 per world phase through dark hexes only (uses stairs, passes locked doors); targets only heroes on unlit hexes, nearest by walking distance through the dark; strikes an adjacent unlit hero for 4, no roll, ignoring armor (Ward −1). If light reaches it, it recoils to the nearest dark hex.
- Can't be harmed, shoved, slept, dreaded, rooted or made to fall. No sound.
- Fades: when the lantern rises above 0 and nobody is unlit on Level 3; or after 2 consecutive world phases with neither condition.

Code: world.ts `brightnessOf`, `litSet`, `fixedLit`, `farLit`, `farLitTest`, `sightRangeAt`, `partyLights`, `LANTERN_RADIUS`, `SIGHT_BY_STAGE`, `LIT_SIGHT`; common.ts `brightnessAt`, `LIGHT_PENALTY`, `lightPenaltyFor`; delve.ts `setLight`, `unlitOnL3`; world-phase.ts `gloamPhase`, `planGloam`; data.ts `LIGHT_MAX`, `LIGHT_BRIGHT`, `LIGHT_DIM`, `TORCH_ROUNDS`, `DARK_SIGHT`, `FIXED_LIGHT_SIGHT`, `KINDLE_LIGHT`, `OIL_LIGHT`, `BRAZIER_LIGHT`, `NIGHTSIGHT_ROUNDS`, `GLOAM_*`; data/castle/build.ts `light`, `sconce`.

---

## 8. Combat

### 8.1 Slot rolls

- An action rolls N slots; each hits with chance p, clamped 5..95. Before rolling the player may spend Focus (≤ slots, ≤ the hero's Focus) to lock that many slots as hits.
- **Perfect** = every slot hit. Attacks deal +1 total damage on a Perfect. Shove: +1 damage. Pick: all slots = silent. There is no general "Perfect is silent" rule.
- Focus: 3 per delve (Reserve 4, heavy head 1); restored only by Rally. Mana: 3 per delve for mage classes.

### 8.2 Hero attack modifiers

| Modifier | Effect | Applies to |
| --- | --- | --- |
| Brightness | 0 / −10 / −20 / −30 | every hero roll |
| Weapon tier | +10 per tier | weapon attacks, knockback, hamstring, free swings, overwatch |
| Target asleep | +20 | attack, knockback, firebolt, dart, overwatch |
| Raised floor (ranged) | +10 | bow attack, firebolt, fireball (no raised hexes exist in the current castle) |
| Flanked | +1 slot | melee: an active ally on the hex directly across the target |
| Sneak attack | +1 slot | weapon `attack` on an enemy that hasn't noticed this hero (asleep, or not in its `noticedIds`; crew: not hostile or demanding) |
| Backstab (Burglar) | +1 slot, weapon damage ×2 per hit before armor | melee from the target's blind area, target unaware of the Burglar; monsters and crew members, not the Dragon or the Gloam. Stacks with sneak attack |
| Adjacent bow shot | −1 slot | Ranger attack |
| Hamstring aim | −20 | hamstring |

Damage to a monster or crew member per hit: max(1, weapon damage − armor), minus 1 if the crew member is warded. Monster armor: Dragon 1, captain 1, plus 1 for an orc or archer adjacent to a captain (shield wall). Crew armor: class armor + armor tier. Being hit makes a monster hunt and notice the attacker (so sneak attack works once).

### 8.3 Enemy attacks on heroes

- Roll the enemy's slots at its chance (+1 slot blindsided; −15 if the hero is braced).
- Damage per hit: max(0, max(1, damage − hero armor) − ward 1 − brace 1 − shield (ranged only: 1, or 2 braced)); Perfect +1.
- Hero armor = class armor + armor tier. Ranged for the shield: attack labels matching shot, firebolt, overwatch, arrow, bolt, dart.
- Guard: hits aimed at the Sellsword's guarded ally hit the Sellsword instead.
- No roll, armor ignored: falls, blasts, fire vents, forge, breath, the Gloam, burning, traps, caltrops, slams from shoves.

### 8.4 Free swings (attacks of opportunity)

- A hero stepping from a hex adjacent to an enemy to one not adjacent provokes one swing per enemy per move: hunting monsters that have noticed the hero, and hostile crew members. Not: asleep, alert, patrol, stuck, holding, feared, the Dragon, the Gloam. The enemy's attack with 1 slot fewer (min 1), no Focus. Sneaking doesn't avoid it. Jumping into a pit from next to an enemy provokes. Shoves, drags, blinks, gusts, climbs and the hook don't.
- Heroes swing too: an enemy (monster, or a hostile crew member) stepping out of reach of an active hero whose action is unspent gets a swing: weapon slots − 1 (min 1), a bow 1 slot, a braced hero full slots. The action is not spent. A swing can kill the enemy mid-walk.

### 8.5 Downed, bleeding, death

- At 0 HP an active hero is downed with bleed 2; each world phase bleed −1; at 0 they die (they die in the second world phase after going down). Any damage to a downed hero kills them.
- Monsters ignore downed heroes as targets (area damage still hits them).
- Revive (action, adjacent downed hero): back up at 3 HP; the revived hero has used their move and action this round.
- Potion on an adjacent downed hero: back up at 5 HP (move and action not spent).
- A dead hero's pack drops on their hex; if they carried the lantern, the nearest active hero takes it.
- Crew members have no downed state: at 0 HP they die and drop loot and pack.

Code: common.ts `roll`, `clampChance`, `hurtHero`, `hurtAny`, `turnOnHit`, `killHero`, `killMonster`, `monsterArmor`, `shieldWalled`, `guardMods`, `rangedLabel`; delve.ts `spec` (attack, knockback, firebolt...), `doAct`, `canBackstab`, `unnoticedBy`; ai.ts `strike`, `strikeDetailed`, `guardFor`, `wardOf`; stealth.ts `swingersFor`, `provokeSwings`, `enemySwing`, `heroSwings`, `monsterCanSwing`; data.ts `FOCUS_MAX`, `MANA_MAX`, `BLEED_START`, `SNEAK_ATTACK_SLOTS`, `BACKSTAB_SLOTS`, `BACKSTAB_DMG_MULT`, `SWING_SLOT_PENALTY`, `SWING_BOW_SLOTS`, `BRACE_DMG`, `BRACE_CHANCE`, `SHIELD_DMG`, `SHIELD_BRACED_DMG`.

---

## 9. Classes, abilities, items

### 9.1 Classes (`CLASSES`)

| Class | HP | Might | Finesse | Wits | Nerve | Weapon | Armor | Main | Mana |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Heir (Keven, "Lord") | 12 | 65 | 50 | 55 | 80 | Longsword 3 Might, 2 dmg | 1 | Might | 0 |
| Sellsword | 10 | 70 | 45 | 40 | 60 | Sword 3 Might, 2 | 1 | Might | 0 |
| Burglar | 7 | 40 | 75 | 60 | 50 | Dagger 2 Finesse, 2 | 0 | Finesse | 0 |
| Ranger | 8 | 45 | 75 | 60 | 55 | Longbow 3 Finesse, 2, range 6, noise 1 | 0 | Finesse | 0 |
| Sapper | 10 | 65 | 50 | 45 | 60 | Hammer 3 Might, 2 | 1 | Might | 0 |
| Pyromancer | 6 | 30 | 50 | 75 | 55 | Staff 2 Might, 1 | 0 | Wits | 3 |
| Shadowmancer | 6 | 30 | 55 | 75 | 50 | Staff 2 Might, 1 | 0 | Wits | 3 |
| Hedgewitch | 7 | 35 | 50 | 70 | 65 | Staff 2 Might, 1 | 0 | Wits | 3 |

Nerve is not used by any rule.

### 9.2 Actions anyone can take

| Action | Rule |
| --- | --- |
| Attack | Weapon: melee on an adjacent visible enemy; Ranger on a visible enemy in line of sight within 6 |
| Shove | 2 Might slots (Sellsword 3) on an adjacent visible enemy (not the Dragon); 2+ hits push it 1 hex straight away (section 13.2); Perfect +1 damage; noise 2 |
| Pick | Needs lockpicks or the improvised pick (section 9.4) |
| Smash | 2 Might slots on an adjacent (or own-hex) locked door or chest, jammed included (not the barred gate); door opens on 2 hits, chest on 1; noise 4 either way |
| Unbar | V4.0: with the sally port key, next to the barred gate: opens it, silent, for the campaign (section 3.1) |
| Smash crate/barrel | Adjacent crate or barrel; noise 4; 60% gold 3–12, 20% torch/potion/firecracker/caltrops, 20% nothing; the hex becomes floor |
| Open (free) | Toggle an adjacent unlocked door (not one someone stands in); open an adjacent unlocked chest (action, free for Burglar); loot rolls onto the chest hex |
| Take (free) | Everything that fits from one pile on or next to the hero, contract item first; blocked with a reason when nothing fits |
| Drop, Give (free) | Drop on own hex; give to an adjacent active hero with room |
| Disarm | Spotted trap on or next to the hero: 2 Finesse slots; any hit removes it; 0 sets it off on the disarmer (3 damage, noise 2) |
| Light brazier | Adjacent unlit brazier: +4 light, lit for the campaign |
| Torch, Potion, Oil, Night-eye, thrown items | Section 9.5 |
| Revive | Section 8.5 |
| Jump | Whole turn; from a hex next to a pit, into it (section 13.1). Preview confirms for drops over 1 level |
| Rope, Climb, Grapple | Section 13.1 |
| Winch | Next to the winch, if the lift isn't running: lift works for the delve; noise 6 |
| Free | Adjacent prisoner: frees them (first time) and makes this hero the escort; another adjacent hero can take over the escort |
| Escape | Grabbed: 2 Might slots, 1 hit frees; noise 1 |
| Pass lantern, Shutter | Section 7.1 |
| Leave (free) | On an exit hex whose way is open (section 3.1): the hero is out; the prisoner goes out too if this hero escorts them and they are adjacent |
| Parley (free) | Opens the deal card (section 12.4) |

### 9.3 Class abilities

| Class | Ability | Rule |
| --- | --- | --- |
| Heir | Rally | Action: every other active hero within 3 gains 1 Focus (to their max). Cooldown 3 rounds |
| Heir, Sellsword, Sapper | Brace | Action: until the next player phase, each hit on them does 1 less (after armor, min 0) and enemies roll −15; their free swings are at full slots |
| Sellsword | Guard | Action: pick an adjacent active ally; until the next player phase, monster and crew strikes aimed at that ally hit the Sellsword (adjacency not rechecked) |
| Sellsword | Strong shove | Shove at 3 slots |
| Burglar | Quiet feet | Sneaks 4; quieter wake rolls and noticing (sections 5.3, 5.4); a sneaking Burglar next to the sleeping Dragon doesn't wake it |
| Burglar | Backstab | Section 8.2 |
| Burglar | Light fingers | Opens chests without using the action. Starts each delve with an improvised pick |
| Ranger | Overwatch | Action: in the coming world phase, shoots the first monster or crew member that moves or acts within 6 that the Ranger can see (field of view counts). Full bow roll (adjacent −1 slot, asleep +20). Lapses at the end of the world phase |
| Ranger | Knockback shot | 2 Finesse slots at range ≤ 5 in sight, not the Dragon; 2 hits push the target 1 hex away from the Ranger with all shove outcomes; noise 1 |
| Ranger (any bow) | Hamstring | 1 Finesse slot at −20, range ≤ 5 in sight, awake target, not the Dragon; a hit roots it 2 rounds (heroes: no move or dash; monsters and crew: stuck in place); noise 1 |
| Sapper | Set charge | Action, 1 charge: an adjacent floor-like hex, cracked wall or breakable wall with no fuse; fuse 1 or 2 |
| Sapper | Throw charge | Action, 1 charge: a hex within 3 the party can see; fuse 1 |
| Sapper (and Mole's Brown) | Dig | Action: adjacent rubble or cracked wall becomes floor; noise 4; no roll |
| Sapper | Satchel | 3 charges each delve (slotless); bought charges add to them; the satchel is spent first |
| Pyromancer | Firebolt (1 mana) | 3 Wits slots, range 5, visible enemy in line of sight; 2 per hit minus armor; noise 3 |
| Pyromancer | Fireball (2 mana) | A floor or pit hex within 5 the party can see: 3 Wits slots; every figure within 1 (allies too) takes hits × max(1, 2 − armor) (monster or hero armor; crew armor and ward are ignored), Perfect +1; floor hexes burn 2 world phases (1 damage per phase to whoever stands there; lit; monsters won't path into fire); noise 6 |
| Pyromancer | Kindle (1 mana) | +6 light (only below 20); silent |
| Shadowmancer | Veil (1 mana) | An active ally within 3 (or self): 2 rounds unseen by monsters and crews (not a target); hunting monsters that see no unveiled hero go alert. Broken by any attack, knockback, hamstring, damaging spell (firebolt, fireball, night thorn, briar), shove, gust, smash (lock or crate) or action of noise ≥ 4 the hero makes. Sleep, darts and Dread don't break it |
| Shadowmancer | Sleep (1 mana) | 2 Wits slots, range 5, an awake visible monster (not the Dragon, not crew): 1+ hits puts it to sleep (forgets everyone); silent |
| Shadowmancer | Blink (1 mana) | Teleport up to 4 to a free standable hex the party can see on the same level (across pits); ends any escort; silent |
| Shadowmancer | Dread (1 mana) | 2 Wits slots, range 5, a visible monster or crew member (not the Dragon): 1+ hits feared 2 world phases: it runs its full move away from the caster, attacks nothing, drops any grab or dragged hero, provokes free swings. On a crew member it turns the crew hostile. Silent |
| Shadowmancer | Night thorn (1 mana) | 2 Wits slots, range 5: 1 damage per hit ignoring armor, Perfect +1; silent |
| Hedgewitch | Mend (1 mana) | Heal 4 on a hurt active hero within 3 (or self); no roll |
| Hedgewitch | Ward (1 mana) | An active ally within 3: 2 rounds of 1 less per hit (min 0) from monster, crew and Gloam strikes |
| Hedgewitch | Gust (1 mana) | A floor or pit hex within 4 the party can see: every figure within 1 of it (not on it) is pushed 1 hex away from it with all shove outcomes, heroes too; noise 2 |
| Hedgewitch | Briar (1 mana) | 2 Wits slots, range 4, not the Dragon: 1 damage per hit (Perfect 3), roots 1 round, 2 on a Perfect; noise 1 |

Sneak attack and backstab apply only to the weapon `attack` action, not to spells.

### 9.4 Locks

| Tool | Who | Slots | Used up |
| --- | --- | --- | --- |
| Lockpicks (smith, 25) | Burglar | 3 | never |
| Lockpicks | anyone else | 2 | never |
| Improvised pick (every Burglar, each delve, slotless) | its carrier | 2 | after one pick, whatever the result |

No pick, no Pick (Burglar included). A Burglar with both uses the lockpicks.

Pick outcomes: all slots hit: opens silently; one short: opens, noise 2; on 3 slots, 1 hit: holds; 0 hits: jams (only smash or a charge opens it now).

Other ways in: Smash (section 9.2), a blasting charge, the skeleton key (one use, anyone, silent, not on jammed locks), a crew's paid "open" job.

V4.0: the sally port's barred gate is none of these: only its own key (Unbar) or a blast within 1 opens it (section 3.1).

### 9.5 Items

- Pack: 4 slots. Most items 1 slot; heirlooms and hoard pieces 2; the copper 2 and heavy; satchel and improvised pick 0. Gold stacks to 100 per slot.
- Torch: action; 12 rounds of radius-2 light round the carrier.
- Potion: action; heal 5 on self or an adjacent hurt active hero, or get an adjacent downed hero up at 5 HP.
- Oil flask: action; +8 light.
- Night-eye draught: action, silent; 8 rounds (ticks each world phase): sight range 8/7/6 by level whatever the light, no brightness penalty. Still unlit for monsters' noticing and for the Gloam.
- Smoke bomb: throw 4 at a hex the party can see: that hex and neighbours smoked 2 rounds. Smoke blocks sight both ways beyond 1 (light passes). Hunting monsters inside go alert and forget who they noticed.
- Glue bomb: throw 4: monsters (not the Dragon or the Gloam) within 1 stuck 2 rounds (can't move).
- Sleep dart: throw 5 at an awake visible monster (not the Dragon, not crew): 1 Finesse slot; a hit puts it to sleep. Silent.
- Caltrops: an adjacent free floor hex: the first monster stepping there takes 2 and stops. Lasts the delve. The party's own caltrops never catch heroes.
- Firecracker: throw 6: noise 6 at the hex.
- Skeleton key, lockpicks: section 9.4.
- Sally port key (V4.0): section 3.1.
- Grappling hook, rope: section 13.1.
- Blasting charge (bought): a non-Sapper sets it with fuse 1 on an adjacent locked door, locked chest or breakable/cracked wall. A Sapper spends bought charges through Set/Throw.

Code: data.ts `CLASSES`, `ROLES` (ability text), `SHOP`, ability constants (`DREAD_*`, `HAMSTRING_*`, `NIGHTTHORN_*`, `BRIAR_*`, `FIREBALL_*`, `SPELL_RANGE`, `SLEEP_RANGE`, `BLINK_RANGE`, `GUST_*`, `VEIL_*`, `WARD_ROUNDS`, `BURN_ROUNDS`, `BURN_DMG`, `THROW_RANGE`, `SMOKE_ROUNDS`, `GLUE_ROUNDS`, `CALTROPS_DMG`, `FIRECRACKER_NOISE`, `LOCKPICK_SLOTS`, `BURGLAR_PICK_SLOTS`, `SMASH_*`, `PACK_SLOTS`); delve.ts `targetsFor`, `spec`, `doAct`, `pickTool`, `takePlan`, `smokeOut`, `putToSleep`; charges.ts `chargeCount`, `spendCharge`, `isKit`; common.ts `addToPack`, `rootFigure`.

---

## 10. Monsters

### 10.1 Base stats (`MONSTERS`) and depth tiers (`TIERS`)

| Kind | HP | Slots | Hit % | Dmg | Move | Armor | XP |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Rats | 3 | 2 | 50 | 1 | 4 | 0 | 1 |
| Orc | 6 | 2 | 60 | 2 | 3 | 0 | 1 |
| Spider | 5 | 2 | 65 | 2 | 3 | 0 | 1 |
| Cutpurse | 4 | 1 | 65 | 1 | 5 | 0 | 1 |
| Berserker | 10 | 4 | 60 | 3 | 4 | 0 | 3 |
| Orc archer | 5 | 2 | 55 | 2 | 3 | 0 | 1 |
| Orc captain | 9 | 3 | 60 | 2 | 3 | 1 | 2 |
| Ghoul | 7 | 2 | 60 | 2 | 4 | 0 | 2 |
| The Dragon | 30 | 4 | 65 | 3 | 3 | 1 | 0 (10 split) |
| The Gloam | – | – | – | 4 | 3 | – | 0 |

Tier by spawn level, every monster but the Dragon: Level 2 +2 HP, +5 hit; Level 3 +4 HP, +10 hit, +1 damage. A named spawn (Grub the Jailer, Ugluk Red-Hand) has +2 HP on top.

Effective stats where they spawn:

| Kind | Level 1 | Level 2 | Level 3 |
| --- | --- | --- | --- |
| Rats | 3 HP, 50%, 1 | 5, 55%, 1 | 7, 60%, 2 |
| Orc | 6, 60%, 2 | 8, 65%, 2 (Grub 10) | 10, 70%, 3 |
| Spider | 5, 65%, 2 | 7, 70%, 2 | 9, 75%, 3 |
| Cutpurse | 4, 65%, 1 | 6, 70%, 1 | – |
| Berserker | – | Ugluk 14, 65%, 3 | 14, 70%, 4 |
| Archer | – | 7, 60%, 2 | – |
| Captain | – | 11, 65%, 2 | – |
| Ghoul | – | – | 11, 70%, 3 |

### 10.2 Behaviour

Every special ability shows as the monster's intent the round before it goes off; an intent that is no longer valid is re-planned (abilities then fall back to plain attacks or moves).

- **Rats**: at 1 HP they flee (move away from heroes).
- **Orc**: the first time it notices a hero it bellows (noise 5), whenever that happens (V4.0: mid-move in the player phase too). Edge shove: if a hero it could hit has an unrailed pit straight behind them, the intent is `shove`; 60% to push them 1 hex (they fall).
- **Spider**: not adjacent, a hero within 3 in plain sight: web (no damage, the hero can't move next turn) at most every 2 rounds. Next round, a webbed hero within 3 and not adjacent: `drag` 1 hex toward the spider with shove outcomes.
- **Cutpurse**: its strike is `steal`: on a hit it takes a random pack item (not an heirloom; story items count as heirlooms) instead of damage (damage if nothing to take), then flees toward the farthest exit; on an exit it leaves with it; killed, it drops it.
- **Berserker**: always hunting once awake; goes for heroes within 10 even unseen. Moving 2+ hexes then hitting knocks the target back 1 hex.
- **Orc archer**: shoots at range 2–4 in line of sight, preferring 3, backing off when adjacent (shoots point-blank if it can't). `hamstring` a non-rooted hero within 3. Edge knockback shot like the orc's shove (60%).
- **Orc captain**: armor 1. Shield wall: orcs and archers adjacent to it get +1 armor. Shout (cooldown 4, first one as soon as it has a quarry): every orc, archer and captain within 8 on its level hunts the shouter's target; noise 5.
- **Ghoul**: buried (off the map) until a hero ends any move within 2; rises hunting. `grab` an adjacent hero: held (`grabbedBy`: can't move or dash; the ghoul has +1 slot against them). Escape: 2 Might slots, 1 hit; killing or fearing the ghoul frees too. One hold per ghoul.
- **The Dragon**: section 14.3.
- **The Gloam**: section 7.5.

Code: data.ts `MONSTERS`, `TIERS`, `ARCHER_RANGE`, `ARCHER_KEEP`, `CAPTAIN_SHOUT_RANGE`, `CAPTAIN_SHOUT_COOLDOWN`, `SHOUT_NOISE`, `GHOUL_RISE_RANGE`, `ORC_SHOVE_CHANCE`; world-phase.ts `planMonster`, `honored`, `monsterAct`, `archerPlan`, `edgeShove`, `chooseTarget` (`SHOWN_FIRST`); delve.ts `riseGhouls`; camp.ts `spawnMonster`; common.ts `monsterStats`.

---

## 11. Monster roster by level (castle data)

| Level | Spawns |
| --- | --- |
| 1 Ruined Keep | 2 sleeping rats (kitchens), sleeping spider (library), cutpurse (courtyard), 5 orcs at posts (hall ×2, tower stair, courtyard, chapel), 1 patrolling orc (round the hall's pit mouth) |
| 2 Crossing | Sleeping barracks squad (4 orcs, the captain), Grub the Jailer (orc, cellblock), spider (archive), Ugluk Red-Hand (berserker, forge), rats (south rim), 2 orcs patrolling the arcade loop, orc patrolling guard post ↔ barracks, orc patrolling the east ledge, 2 archers (arcade, east ledge), orc (winch room), cutpurse (archive) |
| 3 Hollow | Rats (Bone Pile), 3 buried ghouls (Bone Pile), 2 spiders (Spider Nest), 2 orcs (lift base), berserker (the Drain), the Dragon asleep (the Lair) |

Code: src/data/castle/index.ts `castle.spawns`.

---

## 12. Rival crews

### 12.1 Which crew

One crew at most per delve, by contract level:

| Contract | Crew | Chance | Arrival |
| --- | --- | --- | --- |
| Level 1 | The Lantern Sisters (prospectors) | 50% | Round 6–9, at a rival entrance more than 6 from the party's entrance, picked by the seeded RNG (V4.0); waits while any hero is within 6 of it |
| Level 2 | The Ferrymen or the Gallows Choir (cutthroats, seeded pick) | 60% | From round 1, waiting at a random Level 2 post |
| Level 3 | The Wake (cutthroats) | 60% | From round 1, waiting at a random Level 3 post |

Rival entrances: east breach, sally port. V4.0: the Sisters make their own entrance when theirs is shut. By the sally port, the Burglar sister carries the sally port key (in her pack; it drops with her pack if she dies) and unlocks the gate as they come in ("A key turns in the sally port's bar. The Lantern Sisters let themselves in."), silently. They bar it again behind themselves: at the end of each world phase, once nobody stands in the gateway and nobody (crew or hero) is on its outer side, the gate closes and locks ("The sally port's bar drops back into place."; `Delve.gateHeld` while they hold it). Their passing never opens it for the party: only a hero's key, the key carried out, or a blast does (a blast at the gate while they hold it opens it for good). By the east breach, they blast the rubble as they come in ("The Lantern Sisters set a charge in the rubble of the east breach."): a real blast at the heap nearest the exit, then the other, set by the Burglar sister (the crew is still outside and unhurt; noise 8, heard by the party as a blast). The breach so blasted is open for the rest of the campaign. Level 2 posts: west and east ends of the main bridge, the arcade end of the north bridge, the winch room. Level 3 posts: the lift base, the Bone Pile's narrowing toward the Lair.

### 12.2 Members

Built as heroes of their class at the crew level: HP = class HP + 2 × (level − 1); weapon chance = weapon stat + 5 × (level − 1) if it is the main stat, + 10 × weapon tier; armor = class armor + armor tier; move 4; range 6 with a bow else 1. Spell chance = Wits + 5 × (level − 1). Dart chance = Finesse + 5 × (level − 1) for Finesse classes. Mana 3 for mages. Chances clamp at 95.

| Crew | Level | Tiers | Members (pack) |
| --- | --- | --- | --- |
| Lantern Sisters | 2 | weapon 1, armor 1 | Ranger (2 caltrops, potion): 10 HP, 90%, armor 1. Shadowmancer (smoke, firecracker): 8 HP, spells 80%. Burglar (2 darts, smoke, lockpicks): 9 HP, 90%, darts 80% |
| The Ferrymen | 3 | weapon 1, armor 1 | Sellsword (potion, glue): 14 HP, 90%, armor 2. Ranger (2 caltrops, potion): 12 HP, 95%. Sapper (2 charges, glue): 14 HP, 85%, armor 2 |
| The Gallows Choir | 3 | weapon 1, armor 1 | Sellsword (potion, glue). Burglar (2 darts, smoke, lockpicks): 11 HP, 95%. Pyromancer (potion, oil): 10 HP, spells 85% |
| The Wake | 4 | weapon 2, armor 1 | Sellsword (2 potions): 16 HP, 95%, armor 2. Hedgewitch (2 potions): 13 HP, spells 85%. Shadowmancer (smoke, firecracker): 12 HP, spells 90%. Sapper (3 charges): 16 HP, 95%, armor 2 |

Cutthroat members each carry a purse: 30 gold (level 2–3), 50 (the Wake). The Sisters carry none. A killed member drops loot, purse and pack. Members who leave take everything.

### 12.3 Stances and behaviour

- **Prospectors (neutral)**: walk to the nearest unopened, unjammed chest or ground pile (not one a hero stands on; piles at opened chests only for the Burglar sister, or if it holds an heirloom) and take everything. Goal becomes `leave` after 3 pickups, when the lantern is at 9 or less, or when nothing is left; then they walk to the nearest open exit and go (never one behind a shut gate or rubble; the same for a crew dragging a hero and a fleeing cutpurse). On first being spotted, the Shadowmancer veils the crew's striker (or herself).
- They turn **hostile** if a hero damages, gusts or dreads any member, or if they are spotted, neutral, and blocked from moving toward their goal 2 rounds running.
- **Cutthroats (waiting)**: stand at their post. Noticing a hero (section 5.4, within 6) or hearing noise ≥ 4 in the player phase: stance `demanding`, toll = max(50, half the party's carried value rounded to 5). They don't attack that world phase. At the next world phase, still demanding → hostile.
- **Hostile crews**: pick one target a round for the whole crew (the lantern bearer if any member can reach them, else the lowest-HP hero in reach, else the nearest hero on foot); path to hexes with a line to the target and least exposure to other heroes. Each member first checks its kit (below), else attacks.
- Kit by class (shown as intents first): any member below half HP with a potion steps back and drinks (+5). Burglar: sleep dart (lantern bearer first; a hit means the hero loses their next move and action), smoke when a member below half has two heroes with a line on them. Ranger: knockback shot on a hero at an unrailed edge, hamstring a hero within 3, caltrops on the nearest hero's way in (these catch heroes: 2 damage, walk ends), overwatch when no hero is in bow reach (front field of view only). Sellsword: edge shove (60%), glue on two adjacent heroes (they can't move next turn) when nobody is at his blade; guards the caster when adjacent. Sapper: charge with fuse 1 (behind a hero at an edge, at a hero 2–3 away, or set on the way in toward a hero 3–5 away). Pyromancer: fireball where 3 heroes stand within 1 of a hex, else firebolt (3 slots, 2 dmg, range 5, noise 3). Shadowmancer: blink away below half, veil the striker, firecracker at a hero's feet near 2+ non-hunting monsters, smoke. Hedgewitch: mend a member below half (+4), gust a hero at an edge, ward the striker.
- **Captives**: a hostile member robs a downed hero within 2 (or one it just downed): gold, gems and jewelry go to its loot and it takes hold. It drags them 3 hexes a round toward the nearest exit, the hero trailing behind; a dragged hero doesn't bleed. Killing or fearing the dragger drops the hero where they lie. If the dragger reaches an exit, the hero is `captured` and the member leaves with them. A downed hero being dragged when the delve ends is captured too.
- Heroes never free-swing at neutral, truce, bribed or hired crew walking past. Crew members path with stairs (and a working lift) allowed.

### 12.4 Parley (`deals`, `deal` command)

Any active hero within 4 of a visible, unveiled member in line of sight may deal. Deals are free; one deal per crew per round (Fight excepted).

| Deal | Price (L1 / L2+) | Available when | Effect |
| --- | --- | --- | --- |
| Leave | 40 / 60 | not hired, not already bribed | Stance `bribed`, goal leave now; they drop any heirloom they carry |
| Truce | 25 / 40; the toll while demanding; 50 / 75 if hostile | not hired, no truce yet | Stance `truce`: they don't attack unless attacked; prospectors keep looting, cutthroats return to their post |
| Job: winch / open / scout | 30 / 45 | neutral, truce or waiting, no job in progress | Winch: the nearest member works the winch on their level. Open: the nearest seen locked door or chest on their level, silently (a chest so opened is left to the party). Scout: every hex within 8 of each member is explored now |
| Hire | 60 / 90 | not hostile, not hired | Stance `hired` 5 rounds: keep within 2 of the hirer, fight monsters in reach, use potions, the Hedgewitch mends heroes below half. When the rounds end: if the party carries 150+ in value, 25% they turn hostile (`betrayed`); otherwise prospectors go neutral, cutthroats truce |
| Fight | free | not hostile | Hostile now |

- The L2+ price applies when the dealing hero stands on Level 2 or deeper (×1.5, rounded to 5).
- Payment from the active heroes' packs: gold first, then gems and jewelry smallest first, no change. Heirlooms, hoard and story items are never handed over. Short: blocked with "You carry X; they want Y."
- Any attack on a bribed, truce or hired crew makes it hostile; they keep what they were paid.

Code: rivals.ts (`makeCrew`, `postCrew`, `member`, `rivalStats`, `rivalEnter`, `makeEntrance`, `lootAct`, `crewNotice`, `crewAim`, `planRival`, `rivalsAct`, `hireEnds`, `rivalOverwatchFire`); ai.ts `exitsBy`, `exitOpen`; crewai.ts (`crewTarget`, `kitIntent`, `useKit`, `hostilePlan`, `hostileAct`, `rob`, `dragAct`, `capture`, `rivalCaltropsStep`, `hiredKit`); parley.ts (`parleyTargets`, `deals`, `doDeal`); common.ts `crewDemand`, `makeHostile`, `partyValue`, `rivalGuard`, `dropCaptive`; data.ts `CREWS`, `CUTTHROAT_POOL`, `CREW_PURSE`, `PROSPECTOR_CHANCE`, `CUTTHROAT_CHANCE`, `WAKE_CHANCE`, `PROSPECTOR_ENTERS`, `PROSPECTOR_KEEP_OFF`, `SISTERS_LEAVE_LIGHT`, `CUTTHROAT_SIGHT`, `CUTTHROAT_HEAR`, `TOLL_MIN`, `RIVAL_MOVE`, `RIVAL_POTION_HEAL`, `DRAG_MOVE`, `DEAL_RANGE`, `DEAL_PRICE`, `TRUCE_HOSTILE`, `DEEP_PRICE`, `HIRE_ROUNDS`, `HIRE_KEEP`, `BETRAY_LOOT`, `BETRAY_CHANCE`, `SCOUT_RANGE`, `SELLSWORD_SHOVE_CHANCE`.

---

## 13. Terrain and level features

### 13.1 Pits, falls, ropes, the hook

- Pits are columns. Something entering a pit falls straight down: on each lower level the hex at the same (q, r): walkable → lands there (occupied → nearest free standable hex within 3); pit → keeps falling; solid → nearest standable hex within 3 on that level. No landing anywhere: it dies.
- Fall damage, no armor: 4 for one level, 7 for two. A fall that kills a monster counts as a kill for whoever caused it. Featherfoot: first fall free. Fireside Porter heals 3 after.
- Ways to fall: Jump, shoves and knockback, gusts, drags, blasts (pushed or floor collapsing). Walking never enters a pit. The Dragon and the Gloam never fall.
- An escort ends with a fall, climb, grapple or blink.
- Rope (consumed): anchored at the edge hex the hero stands on (next to a droppable pit). Climb (whole turn): from the roped hex down to where a fall from the adjacent pit would land, no damage; or from on or next to that landing up to the roped hex.
- Grappling hook (reusable, whole turn): from a pit landing or pit-floor hex, up to a free edge hex beside the nearest pit within 2 of the column on the level above.
- Railing: an edge hex with a railing can't be shoved into the pit (1 damage instead). Collapsed floor loses its railing.
- `edgeRisk`: the worst fall a shove could cause where a hero stands.

### 13.2 Shoves and push outcomes

A push moves the figure 1 hex straight away from the pusher (ranged pushes use the nearest hex direction):

| Destination | Result |
| --- | --- |
| Pit (not railed) | Moves in and falls |
| Pit, pushed from a railed hex | 1 damage |
| Forge or other solid fire | 3 damage, stays |
| Another figure | Both take 1, stays |
| Open floor or open doorway | Moves |
| Fire vent | Moves, 3 damage |
| Wall, prop, closed door, anything else | 1 damage, stays |

The Dragon and the Gloam can't be pushed.

### 13.3 Doors, locks, chests

- Doors block sight and light when closed and halve noise reach (count 2). Locked doors: Pick, Smash, charge, key, crew job. A jammed lock: only Smash or a charge. A blasted door is opened and unlocked (it can be closed again).
- V4.0: the sally port's barred gate (a locked door with `barred`): only its key (Unbar) or a blast. Its hover: "Barred gate · the sally port key opens it (Unbar), or a charge. Then it stays open".
- Monsters and crews path through unlocked doors (opening them); they can't pass locked ones (the Gloam can).
- Chests: tier 1–3. Loot roll on opening (d6 + tier): 2–3 gold 15T–30T; 4–5 gold 25T–50T plus a torch or potion (50/50); 6–7 a gem worth 40T–80T; 8+ jewelry worth 80T–140T.
- Locked chests: Pick, Smash (1 hit), charge, key.

### 13.4 Traps

- Hidden. A hero ending any move (including landings, blinks, climbs) within 1 of an unspotted trap rolls 1 Wits slot (brightness penalty applies): a hit spots it.
- Stepping onto a trap, spotted or not: 3 damage, trap gone, noise 2; the walk continues if the hero is still up.
- Disarm: section 9.2.

### 13.5 Fire vents, the forge, burning

- Fire vents: walkable hexes with a radius-1 `fire` light (the three in the Lair). Ending a move there or being pushed onto one: 3 damage.
- The forge (L2): a solid tall prop that burns; being pushed into it: 3 damage.
- Burning hexes (fireball): 1 damage per world phase to anyone standing there, 2 world phases; monsters won't path into them.

### 13.6 Stairs, lift, winch, sealed stair

- Tower stair: L1 (37, 3) ↔ L2 (37, 3), cost 1. Monsters use it only while hunting.
- Lift: L2 winch room (24, 27) ↔ L3 lift base (24, 27), cost 1, only after the winch (L2 (25, 27)) is worked by a hero (action, noise 6) or a crew job. Runs for the rest of the delve.
- Sealed Stair (L3): never opens.
- L2 has a collapsed-floor pit at (3, 23) in the cellblock that drops into the Drain.

### 13.7 Crates, barrels, breakable walls, rubble

- Crates and barrels: Smash (section 9.2). The smashed hex is floor.
- Cracked walls: a charge within 1 or Dig turns them to floor.
- V4.0: rubble heaps (cracked tiles with `heap`) choke the east breach: same rules as a cracked wall, drawn as a mound of boulders; the hover says "Rubble · fallen stone chokes the east breach · a charge clears it, or a Sapper's Dig" (section 3.1).
- Breakable built walls: on Levels 1 and 2 only; a wall hex with two floor-like neighbours that aren't adjacent to each other; not `unbreakable` (outer curtain walls, the tower stair shaft, the guard post landing, the winch room); not cave rock (every floor beside it rock or earth); never pillars. A blast within 1 turns them to rubble (`blown`), move cost 2, until dug.

### 13.8 Charges and blasts

- A charge is a fuse on a hex (`Delve.fuses`). At the end of each world phase fuses count down; at 0 it goes off. Fuse 1 = the end of the coming world phase. A fuse lit during a world phase (a crew's) skips that phase's countdown.
- Blast at hex X: 4 damage to every figure within 1 (X included), 2 within 2, no armor; the setter takes 0; if a hero set it, other heroes take half (rounded down); if a crew member set it, crewmates take half; the prisoner takes full. Figures in the ring around X (not on X) still standing are pushed 1 hex away (all push outcomes). Kills credit a hero setter.
- Within 1: locked or closed doors are opened and unlocked (they can be closed again); unopened chests open (loot rolled); cracked walls break; breakable walls become rubble.
- Floor within 1 on Levels 1 and 2: floor next to a pit hex collapses into the pit column (`collapsed`; anything on it falls; loot on it drops to the landing; ropes and fuses on it go). Other floor becomes rubble. On Level 3 floor only rubbles. Never affected: stairs, lift, exits, doors, braziers, props and tall props, chest hexes, hoard hexes, the sealed stair, `unbreakable` hexes (around the tower stair and lift ends).
- Collapse and rubble are decided from the map before the blast (no chain collapse).
- Noise 8, also heard on the levels above and below.

Code: world.ts `kindAt`, `canEnter`, `steps`, `fallColumn`, `fallDamage`, `freeNear`, `pitsNextTo`, `standable`; falls.ts `fall`, `fallInfo`, `push`, `pushOutcome`, `railed`, `edgeRiskAt`, `ventCheck`; delve.ts `grappleTop`, `springTrap`, `afterHeroMove`, `smashable`; charges.ts `breakableWall`, `blastableWall`, `setFuse`, `tickFuses`, `blast` (calls ways.ts `checkWays`), `blastPreview`, `shielded`; common.ts `chestLoot`; data.ts `VENT_DMG`, `WINCH_NOISE`, `BLAST_INNER_DMG`, `BLAST_OUTER_DMG`, `BLAST_NOISE`, `SAPPER_CHARGES`, `THROW_CHARGE_RANGE`, `DIG_NOISE`; data/castle/build.ts `unbreakableAround`, `protectAround`, `railing`.

---

## 14. The castle's three levels

### 14.1 Level 1: the Ruined Keep

- Rooms: Great Hall (with the pit mouth and the High Table dais), Gatehouse, Gate passage, Courtyard, Kitchens, Servants' passage, Library, Tower stair, Armory, Chapel, East breach, Sally port.
- Exits (also the party's entrances): main gate (24, 31), sally port (1, 14), east breach (44, 21). Tower stair down to Level 2. V4.0: the sally port is shut by a barred gate at (2, 14) and the east breach by rubble at (42, 21) and (43, 21) until opened (section 3.1); the sally port key lies in the library at (3, 1) while its gate is shut. The daylight that lit the two passages now sits on the exit hexes (1, 14) and (44, 21).
- Light: abundant daylight (courtyard, gatehouse, round the hall's pit mouth, open corridors, the chapel's nave and south aisle, the kitchens' chimney, the tower top), sconces in library, kitchens, hall, tower, armory. Library and armory stay dim.
- Locked: the armory door (36, 12), the armory chest. Cracked wall (40, 16). Brazier in the chapel. Traps: servants' passage, gate passage. Railing: a few hexes on the pit mouth.
- Chests: library, kitchens, chapel (tier 1); tower, armory (tier 2). Coins 10, 15, 20.
- Contract sites: l1-rescue-library, l1-recover-armory, l1-recover-chapel; story: chapel (Aldric), kitchens (Wim).

### 14.2 Level 2: the Crossing

- Rooms: the Crossing and its bridges over the pit, Arcade, East ledge, South rim, Guard post, Barracks, Officers' quarters, Archive, Cellblock, Winch room, Forge.
- No exits. Up by the tower stair; down by the lift (after the winch), the pit, or the cellblock's collapsed floor into the Drain.
- Light: sparse: sconces in barracks, arcade, cellblock, winch room; the forge's fire; the pit glow at the Crossing. Braziers: guard post, archive.
- Locked: the officers' corridor door (13, 3), the officers' strongbox. Cracked wall officers' quarters → archive (9, 7). Traps: officers' corridor, archive → cellblock. Railing: the arcade's pit side, broken at two gaps.
- Chests: barracks, guard post, forge (tier 2); officers' strongbox, archive (tier 3). Coins 25, 30, 30, 25.
- Contract sites: l2-rescue-cell-west, l2-rescue-cell-east, l2-recover-archive, l2-recover-forge; story: forge (Gerda), barracks (copper); the Sisters' hideout in the officers' quarters.

### 14.3 Level 3: the Hollow, and the Dragon

- Rooms: Bone Pile (under the pit), the Lair, Sealed Stair, Fungus Grove, Spider Nest, Tunnels, Lift base, the Drain.
- Exit: the cave mouth (1, 28), open from the start. Up only by the lift (after the winch) or the hook/rope.
- Light: fungus in the grove, the pit glow on the Bone Pile, the Lair's two fires and three vents. Brazier in the grove. Everything else is dark (the Gloam hunts any unlit hero here). Monsters see heroes regardless of light here.
- Chests: nest, drain (tier 3). Coins 40, 35, 50, 40. Traps: nest tunnel, drain tunnel.
- Contract sites: l3-rescue-nest, l3-recover-grove, l3-recover-drain (also the cask book), l3-slay-dragon; hideouts for the Ferrymen (the Drain), Gallows Choir (Tunnels), the Wake (Bone Pile).
- **The Dragon**: 30 HP, armor 1, bite 4 slots at 65% for 3, moves 3, never leaves the Lair. Not affected by shoves, falls, sleep, darts, dread, briar, hamstring, knockback, glue or backstab. It never takes free swings itself, but heroes get free swings at it when it steps out of their reach. Starts asleep. Wakes when a hero walks (not sneaks) into the Lair, ends next to it (unless a sneaking Burglar), or noise ≥ 4 reaches it. Awake, it sees heroes within 10 in line of sight. Its first action awake is breath, then it alternates: a breath round (intent `breath`: a straight 5-hex line toward the nearest seen hero, stopped by walls; next world phase every hero on those hexes takes 4, no roll, no armor, no ward; noise 6), then a non-breath round: tail sweep if 2+ heroes are adjacent (each pushed 1 hex), else bite an adjacent hero, else close in. Hoard: 3 pieces worth 300, 2 slots each, around its spawn; taking is free and silent.

Code: src/data/castle/index.ts (`castle`: links, entrances, entranceNames, shutWays, rivalEntrances, rivalPosts, spawns, chests, coins, traps, braziers, contractSites), level1.ts, level2.ts, level3.ts, regions.ts, shapes.ts, build.ts; dragon.ts (`lairCheck`, `planDragon`, `breathLine`, `dragonSpecial`, `placeHoard`); data.ts `BREATH_DMG`, `BREATH_LEN`, `BREATH_NOISE`, `DRAGON_WAKE_NOISE`, `HOARD_PIECES`, `HOARD_VALUE`.

---

## 15. Win, lose and extraction

- Extraction: a hero on an exit hex uses Leave (free). Exits: three on Level 1 (V4.0: only those whose way is open), the cave mouth on Level 3. Leaving with the escorted prisoner adjacent takes the prisoner out.
- Prisoner: 5 HP (a captive hero 1). Freed (action, adjacent), they follow their escort to a free adjacent hex after each of the escort's moves (not onto doors or traps). Monsters target a freed prisoner. If they die, the contract fails.
- Delve over when no hero is active; summary: contract done, bounty, value carried out, survivors, survivors below full HP (`wounded`), dead, XP, level-ups, notes.
- Campaign over: section 2.11. No victory condition exists.

Code: delve.ts `leaveCastle`, `canLeaveAt`, `afterHeroMove`; camp.ts `contractDone`, `buildSummary`, `backToCamp`.

---

## 16. Determinism and saves

- All randomness from `state.rng` (mulberry32, src/game/rng.ts). Same seed and commands give the same game.
- `serialize`/`deserialize`: the whole state as JSON, `version` 3. Older saves without campaign HP get full HP; without a village, a fresh one. V4.0: saves without `campaign.opened` keep every entrance open (the field absent means open); without `campaign.explored`, an empty memory; a delve saved without `Delve.ways` gets it from the campaign. No save-key bump.
- Browser storage keys: save `vc.save.v39` (src/ui/app.ts `SAVE_KEY`); loadout `vc.loadout.v33`; settings `vc.settings`; mute `vc.muted`; light meter scale `vc.lightmax.v3`.

---

## 17. Feature flags and shelved systems

| Flag / system | State | Notes |
| --- | --- | --- |
| `FREE_MOVE.enabled` (data.ts) | false | V3.7 calm free movement (spec 20.5's calm walk, Follow, `CALM_STEPS` 4). Engine always reports not calm; code in calm.ts stays. See docs/shelved/exploration-mode.md |
| V3.8 exploration mode (spec section 22) | removed from main | Reverted; section 22 in docs/v3-spec.md is a stub pointing to the shelf branch. Code on branch `shelf/exploration-mode`; findings in docs/shelved/exploration-mode.md |
| `FACING.faceCommand` | false | The free Face command; `face` returns a refusal. docs/ideas-later.md "Managed facing" |
| `FACING.turnOnAction` | true | Heroes turn toward an action's target |
| `HEARING.enabled` | true | Heroes hear unseen enemies (hearing.ts) |
| `bribe` action | dead | Replaced by parley deals; always returns no targets |
| `Hero.wounded`, `HeroInDelve.revived` | vestigial | Always 0 / unused by rules |
| Legacy crew numbers (`RIVAL_CLASSES`, `SISTER`, `CUTTHROAT_TIER`, `SISTER_DART_CHANCE`, `PYRO_BOLT_CHANCE`) | old saves only | Members without `level` |
| Raised floor (`TileDef.raised`) | rule live, no data | +10 for ranged from raised floor; no raised hex in the castle |
| Later ideas | not built | docs/ideas-later.md: arrows as ammunition, tripwire charges, ceiling collapse, Nerve checks, companions, endless descent past the Sealed Stair |

---

## 18. Spec vs code discrepancies found

Each entry: what docs/v3-spec.md (latest applicable section) says, what the code does. The code is what this file describes. Spec references are by section; code line numbers are as of commit bc3f1fd and will drift. 28 are open (25 and 30 were fixed in V3.9.4); V4.0 should settle each one, either by changing the code or by accepting the code as the rule.

1. **Orc, spider, berserker stats.** Spec 7 table (never revised later): orc 55%, spider 60%, berserker 9 HP, 2 damage. Code: orc 60%, spider 65%, berserker 10 HP, 3 damage (src/game/data.ts:198, :199, :201).
2. **Monster sight.** Spec 16.1 and spec 7: monsters see within 6, and dark heroes within 3 (spec 7: 2). Code: `MONSTER_SIGHT` 8, `MONSTER_DARK_SIGHT` 5 (data.ts:220-221), recorded in decisions.md (V3.7.1) but not in the spec.
3. **Sisters leave on low light.** Spec 10: goal leave when light ≤ 18 (of the old 40). Code: `SISTERS_LEAVE_LIGHT` 9 (data.ts:329).
4. **Sisters' tiers.** Spec 20.4 table: Lantern Sisters weapon tier 1 only. Code: weapon 1 and armor 1 (data.ts:605).
5. **Sisters' purse.** Spec 20.4: killed members drop their purse (30 gold at level 2–3). Code: only cutthroat crews get purses (rivals.ts:101, postCrew; :151 buildCrew); prospectors carry none.
6. **Leave deal and the prisoner.** Spec 18.6: on Leave they drop the heirloom or prisoner. Code drops heirlooms only (parley.ts:209-216); no crew code ever takes or holds the prisoner.
7. **Prospectors turning hostile when blocked.** Spec 10: blocked for a full round. Code: unable to move toward their goal 2 rounds running, and only while spotted and neutral (rivals.ts:564-571).
8. **Rivals react to noise.** Spec 6: neutral rivals avoid loud spots; hostile rivals come. Code: no crew reacts to noise except a waiting cutthroat crew hearing ≥ 4 in the player phase (common.ts:492). Not implemented.
9. **"Perfect: other actions make no noise".** Spec 3. Code has no general rule: Smash always makes noise 4 (delve.ts:1661), escape always 1 (delve.ts:1744), shove always 2 (delve.ts:1622); only Pick is silent on all hits (delve.ts:1643-1645).
10. **Shove into a burning hex.** Spec 14.3: into a fire (forge, vent, burning hex): 3 damage. Code: forge/solid fires 3 (falls.ts:189), vents 3 on landing (falls.ts:255-258); a burning hex is an ordinary move (no immediate damage; 1 burn damage at the next world phase).
11. **Gloam rise anchor on Level 3.** Spec 16.2: rises 4..6 from the nearest unlit hero. Code: 4..6 from the first unlit hero in party order (world-phase.ts:618).
12. **Gloam in pitch black targets.** Spec 5: moves toward the nearest active hero and hits when adjacent. Code: in every case it targets only heroes on unlit hexes and keeps to dark hexes (world-phase.ts:261-276, :512).
13. **Disarm noise in the preview.** Code-internal: the preview reports noise 2 for every disarm (delve.ts:1182), but noise is made only when the trap goes off (delve.ts:1668-1681). The spec doesn't say.
14. **Captive's gear.** Spec 20.4: a captured hero keeps level and gear, losing gold and gems. Code: gold, gems and jewelry are taken by the robbing (crewai.ts:749-752); the rest of their pack is never returned to the stash or the ground (backToCamp only banks packs of heroes who got out, camp.ts:697-706), so it is lost. Tiers and shield stay.
15. **Freeing a dragged hero by "downing" the dragger.** Spec 20.4. Crew members have no downed state; at 0 HP they die (common.ts:399-413). Killing or fearing is the only way.
16. **Rival Sapper charge damage.** Spec 18.5: 3 damage within 1. Superseded by 20.3 in practice: crew charges use the standard 4/2 blast (charges.ts:259). `SAPPER_CHARGE_DMG` 3 and `SAPPER_CHARGE_NOISE` (data.ts:571-572) are unused.
17. **XP by monster.** Spec 1: kill +1, berserker +3. Code: also captain 2, ghoul 2 (data.ts:206-207), crew member 1 (common.ts:410). Not in the spec.
18. **Level 3 reputation and Level 3 numbers.** The spec never states that Level 3 contracts open at reputation 2 (data.ts:343), nor the Level 3 bounties (rescue 220, recover 260) and heirloom value 180 (data.ts:338-339).
19. **Named elites.** Not in the spec: a named spawn (Grub the Jailer, Ugluk Red-Hand) gets +2 HP (camp.ts:593).
20. **Burning damage.** Spec 15.3 says fireball hexes burn 2 rounds but gives no damage. Code: 1 damage per world phase to anyone on a burning hex, armor ignored (data.ts:405 `BURN_DMG`, world-phase.ts:660-674); burning hexes also block monster paths (ai.ts:64) and are lit (world.ts:320).
21. **Dread on a crew member makes the crew hostile.** Code (delve.ts:1493); not in spec 20.2.
22. **Revive spends the revived hero's turn; potion revive doesn't.** Code: revive sets the revived hero's moved and acted (delve.ts:1780-1781); a potion revive leaves them free to act (delve.ts:1766-1770). Not in the spec.
23. **Downed timing.** The spec never gives the bleed start. Code: `BLEED_START` 2 (data.ts:14): a downed hero dies in the second world phase; any damage to a downed hero kills them (common.ts:280-283).
24. **Dragon and sneaking.** Spec 14.4: wakes when a hero enters the Lair room. Code: only a walking hero entering wakes it; ending adjacent wakes it unless a sneaking Burglar (dragon.ts:41-50).
25. ~~Burglar ability text~~: fixed in V3.9.4 (data.ts `ROLES.burglar` now reads "Opens chests without using the action."; Take is free for everyone).
26. **Arrival next to sleepers ignores quiet feet.** Spec 24.3 gives the Burglar 10% for ending adjacent. Code applies that to walks only; arrivals by fall, climb or grapple wake adjacent sleepers for sure and blink at 25% for anyone (common.ts:549-556).
27. **Blink, throws and fireball target "in sight".** Spec 15.3/15.4 say "in sight". Code checks the party's visible set, not the caster's own line of sight (delve.ts:430-439 `hexesInSight`).
28. **Cutpurse can steal hoard pieces.** Spec 7: not heirloom. Code excludes only `heirloom` items (story items are heirlooms) and, since V4.0, the sally port key, so hoard pieces can be stolen (world-phase.ts `steal`).
29. **Sounds the spec lists that never happen.** Spec 24.8 lists the crew toll as a `shout` and smashing and digging as `crash`. Code: `crewDemand` makes no sound (common.ts:465-477), and no monster or crew member ever smashes or digs; the only `crash` sounds are a locked door forced open, a crew working the winch and a crew gust (ai.ts:148, rivals.ts:521, crewai.ts:713).
30. ~~Section 22 missing~~: fixed in V3.9.4 (a stub now points to the shelf branch).

Rules I could not confirm in the engine (UI-only or unverified):

- The confirm before a jump of more than one level (the engine only sets `confirm`; the dialog is UI).
- The End turn prompt for idle heroes (UI, settings `noEndTurnAsk`).
- "Start shuttered" on Level 1 (UI sends `shutter` after `startDelve`).
- Camera, markers, beacons, hover texts and footprint glyphs (view; not checked).
- Balance targets in spec 20.4 (sim, not checked).
- The castle.test invariant that breaking every breakable wall keeps each contract path at least 60% of its length (castle.test.ts; runs green; since V4.0 the "normal" path counts the east breach's rubble as cleared).

Note: the working tree had uncommitted edits by someone else while this was written (comments in src/game/ai.ts, UI text in src/ui, docs); none change a rule. Line numbers are from the files as they stood.
