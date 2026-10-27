# V4.1 audit: economy and progression at V4.0 (main d659e06)

Step 1 of the V4.1 rebalance (owner, 2026-10-26): every gold source and sink and every progression track in one place, with where each number lives. Nothing here changes a rule. Numbers read from the code at d659e06; `data.ts` means `src/game/data.ts`.

## 1. What stands out

1. **The castle refills every delve.** Chests, coins and crates are rebuilt from the castle data at every `startDelve` (camp.ts:532 chests, :560 coins; crates are map props). A full sweep of Level 1 is worth about 380 gold in valuables, Level 2 about 850, Level 3 about 580, every time. Bounties (80 to 260) are the smaller share of income for any party that loots. Contracts matter for reputation, XP and the village, less for gold.
2. **The sinks run out.** The forge is the only large sink: 540 gold to fully kit one hero (weapon 60 + 150, armor 80 + 200, shield 50), 2,160 for four. Past that, gold buys consumables at 10 to 40, ales at 10 to 25 and healing at 3 per HP. A geared party has nothing to save for; the only recurring large sink is replacing the dead (forge tiers die with the hero).
3. **Reputation stops mattering after three contracts.** It gates Level 2 (1), Wim and Gerda (1), Level 3 (2), the cask book (2) and the slay contract (3), and nothing else. It never goes down.
4. **Levels come fast.** Level 2 needs 5 XP: one successful delve (contract 3, survive 1, one kill) gets there. Level 6 (45 XP) is roughly 10 to 12 good delves. Hired heroes level for free while the recruit price rises 40 a level, so a home-grown hero is the bargain.
5. **Rescues pay twice.** A regular rescue pays the bounty and the prisoner joins free as a level 1 hero (60 gold at the campfire).
6. **The lantern is free and is the clock.** It starts full (20) every delve; oil (15) adds 8 rounds. Torches (10) give 12 rounds of radius 2. Light costs nothing until Level 3, which is why it feels dull (owner's note).
7. **Almost everything is sold from day one.** Mott's wagon carries 12 of 16 shop items before anyone is rescued, including every "chemistry" item (sleep and venom darts, glue, smoke, blasting charge, oil). Gerda gates 4 items and the forge; Wim gates 1 item and the Flagon.
8. **Nothing you buy can be sold back.** Only valuables sell (gems, jewelry, heirlooms, hoard). Gear and consumables are one-way.

## 2. Gold sources

| Source | Amount | When | Code |
| --- | --- | --- | --- |
| Starting gold | 90 | new campaign | data.ts `START_GOLD` (402) |
| Regular bounty: rescue | 80 / 150 / 220 (L1/L2/L3) | contract done | data.ts `BOUNTY` (349) |
| Regular bounty: recover | 100 / 180 / 260, plus the heirloom (sellable) 60 / 120 / 180 | contract done | data.ts `BOUNTY`, `HEIRLOOM_VALUE` (350) |
| Slay the Dragon | 500 | Dragon dead, a hero out | data.ts `BOUNTY` |
| Story bounty | half the regular, rounded down to 5: Aldric 40, Wim 40, Gerda 75, copper 90, cask book 130 | contract done | camp.ts `storyBounty` |
| "Bring back" a captive | full rescue bounty at the hideout's level: 150 (Sisters, L2), 220 (L3 crews) | contract done | camp.ts `captiveBoard` |
| Rescued regular prisoner | a free level 1 hero (worth 60) | rescue done | camp.ts `backToCamp` |
| Chests, tier 1 / 2 / 3 | expected 40 / 109 / 208 per chest (d6 + tier: gold, gold + torch or potion, gem, jewelry); a third of them add a torch or potion | every delve, reset | common.ts `chestLoot` (233); castle/index.ts `chests` (109) |
| Chests by level | L1: 3 × T1 + 2 × T2 = 338 · L2: 3 × T2 + 2 × T3 = 743 · L3: 2 × T3 = 415 | every delve | castle/index.ts |
| Coins on the floor | L1 45 (10, 15, 20) · L2 110 · L3 165 | every delve, reset | castle/index.ts `coins` (126) |
| Crates and barrels | 8 / 6 / 3 by level; each 60% gold 3–12, 20% a torch, potion, firecracker or caltrops, 20% nothing (about 7 gold-equivalent) | every delve, reset; noise 4 | data.ts `SMASH_*` (327) |
| Dragon's hoard | 3 pieces × 300, once each per campaign (2 slots each) | L3 Lair | data.ts `HOARD_PIECES`, `HOARD_VALUE` (357) |
| Crew purses | Ferrymen, Gallows Choir 3 × 30 = 90; the Wake 4 × 50 = 200; Sisters none | killing members | data.ts `CREW_PURSE` (587) |
| Crew loot | whatever prospectors picked up (chest contents) | killing members | rivals.ts |
| Lost gear | fallen heroes' non-valuable items lie where they died in later delves | campaign | camp.ts `lostGear` |
| Selling | valuables only, at face value, one or all | camp | camp.ts `sell`, `sellAll` (314) |

**A full sweep, per delve** (valuables only, expected): L1 about 440 (chests 338, coins 45, crates 58) · L2 about 900 · L3 about 600 plus the hoard.

## 3. Gold sinks

| Sink | Price | Needs | Code |
| --- | --- | --- | --- |
| Recruit | 60 / 100 / 140 (level 1 / 2 / 3) | campfire 3 offers (level 1); the Flagon 4 offers, 35% level 2 (cask book: 25% L2, 10% L3) | data.ts `RECRUIT_PRICE` (404), `CAMPFIRE_SIZE`, `FLAGON_*` (479–484) |
| Healing | 3 per HP | Aldric | data.ts `HEAL_PER_HP` (455) |
| Drinking a stash potion in camp | a 20-gold potion for 5 HP (4 per HP) | before Aldric | data.ts `DRINK_HEAL` (486) |
| Forge, weapon | tier 1 60, tier 2 150 (+10 to hit a tier) | Gerda | data.ts `WEAPON_PRICE` (456) |
| Forge, armor | tier 1 80, tier 2 200 (+1 armor a tier) | Gerda | data.ts `ARMOR_PRICE` (457) |
| Shield | 50, one per hero (ranged hits −1, −2 braced) | Gerda | data.ts `SHIELD_PRICE` (307) |
| Ales | 10–25, one per hero per delve | the copper; three need the cask book | data.ts `ALES` (535) |
| Parley: Leave | 40 / 60 (L1 / L2+) | | data.ts `DEAL_PRICE` (705), `DEEP_PRICE` 1.5 |
| Parley: Truce | 25 / 40; while demanding, the toll; hostile 50 / 75 | | data.ts `TRUCE_HOSTILE` |
| Parley: Job (winch, open, scout) | 30 / 45; a failed open is not refunded | | |
| Parley: Hire | 60 / 90 for 5 rounds | | |
| Cutthroat toll | max(50, half the party's carried value, to 5) | | data.ts `TOLL_MIN` (624) |
| Robbed by a crew | a captured hero's gold, gems and jewelry | | crewai.ts `rob` |
| Cutpurse | one random pack item | | world-phase.ts `steal` |
| Death | the hero's forge tiers, shield and level; their pack drops in the castle | | camp.ts `backToCamp` |

### Mott's wagon (`SHOP`, data.ts 369)

| Item | Price | Needs | Kind of item |
| --- | --- | --- | --- |
| Torch | 10 | | light |
| Oil flask | 15 | | light (lantern +8) |
| Potion | 20 | | mending |
| Antidote | 20 | essential | mending |
| Rope | 15 | | terrain |
| Firecracker | 10 | | noise |
| Smoke bomb | 20 | | chemistry |
| Glue bomb | 25 | | chemistry |
| Sleep dart | 25 | | chemistry |
| Venom dart | 30 | | chemistry |
| Blasting charge | 30 | | chemistry, explosive |
| Caltrops | 15 | Gerda | metalwork |
| Grappling hook | 40 | Gerda | metalwork |
| Skeleton key | 30 | Gerda | metalwork |
| Lockpicks | 25 | Gerda | metalwork |
| Night-eye draught | 30 | Wim | brew |

## 4. Progression tracks

| Track | Rule | Code |
| --- | --- | --- |
| XP | kills: berserker 3, captain 2, ghoul 2, others 1; crew member 1; survive +1; contract done +3 to every survivor; Dragon 10 split | data.ts `MONSTERS[].xp`, `SLAY_XP`; common.ts 341–442; camp.ts 722 |
| Hero level | thresholds 5 / 12 / 20 / 30 / 45 for levels 2–6; each level +2 max HP, +5 main stat; only heroes who got out level up | data.ts `LEVEL_XP` (346), `MAX_LEVEL`; camp.ts `levelUp` |
| Class kit | 1 a level per delve: Sapper improvised explosives, Burglar improvised picks | data.ts `KIT_PER_LEVEL` (411), `kitPerDelve` |
| Gear | weapon and armor tiers 0–2, shield; bound to the hero, lost on death | camp.ts 382–403 |
| Reputation | +1 per contract done, never lost; L2 contracts at 1, L3 at 2, slay at 3 | data.ts `REP_FOR_LEVEL`, `REP_FOR_SLAY` (354); camp.ts 766 |
| Board | up to 3 regular contracts (at least one L1), plus story and captive contracts; rebuilt after every delve | camp.ts `makeBoard` |
| Village | Aldric (from the start): healing · Wim (rep 1): the Flagon, night-eye · Gerda (rep 1): forge, metalwork · copper (Wim home): 4 ales · cask book (copper, rep 2): 3 ales, better recruits | data.ts `STORIES` (507); camp.ts `storyAvailable` |
| Ways in | sally port and east breach opened through play, for good | ways.ts (spec 25) |
| Castle memory | explored hexes kept for the Set out map | ways.ts `castleMemory` |
| Campaign-wide castle state | lit braziers, hoard pieces taken, ways opened, lost gear | camp.ts `backToCamp` |

## 5. Light, as it stands (for the lantern rethink)

| Thing | Number | Code |
| --- | --- | --- |
| Lantern | holds 20, starts full, burns 1 a world phase while open; free shutter; radius 4 / 3 / 2 / 0 by stage | data.ts `LIGHT_MAX` (7); world.ts `LANTERN_RADIUS` |
| Brightness penalty | 0 / −10 / −20 / −30 to every hero roll, by the lantern's stage (not the hex's light) | common.ts `LIGHT_PENALTY` |
| Torch | 10 gold, 12 rounds, radius 2 | data.ts `TORCH_ROUNDS` (13) |
| Refuel | Kindle +6, oil +8 (15 gold), a brazier +4 (lit for the campaign) | data.ts `KINDLE_LIGHT`, `OIL_LIGHT`, `BRAZIER_LIGHT` |
| Night-eye | 30 gold, 8 rounds of full sight, no penalty | data.ts `NIGHTSIGHT_ROUNDS` |
| Glowworm Pale | 15 gold, radius 1 on the drinker | data.ts `ALES` |
| The Gloam | rises at lantern 0 anywhere, or for an unlit hero on Level 3 | world-phase.ts `gloamPhase` |
| Things that read the lantern | the Sisters leave at 9 or less (`SISTERS_LEAVE_LIGHT`); crews' hostile target is the bearer; the brightness penalty; the HUD's top strip; the sim's "leave at 5" | 32 source files, about 300 lines |

## 6. What the sim can't tell us yet

The balance bot (`scripts/v3-engine-sim.ts`) records per-delve loot, bounty, deaths and crews, but:

- It never sells valuables, never buys forge gear, blasting charges or ales for anyone but Keven, so gold over time and the forge sink are not measured.
- It never sets Sapper charges in combat and rarely sneaks (owner and spec 30.6).
- When Keven dies it starts a new campaign inside the same run, so campaign-length curves mix campaigns.
- It prints no per-delve gold, stash value, hero levels or contract success by hero level.

Step 2 fixes these before any number changes.

## 7. Baseline numbers (d659e06)

Filled in below from `v3-engine-sim.ts 30` on seeds 1–4 and `v37-crew-arena.ts 40` (seed 1).
