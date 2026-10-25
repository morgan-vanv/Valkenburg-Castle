# V3.5 engine progress

Status: spec 18.2-18.6 implemented, tested (describe "V3.5" in engine.test.ts, 30 tests; castle.test post check), sim updated.
`npx tsc --noEmit` clean in src/game, src/data, scripts/v3-engine-sim.ts. `npx vitest run` green (181).

## What the presentation can rely on
- `newGame`: `campaign.village` all false; `deserialize` adds it to old saves.
- Recruits: campfire 3 (lvl 1) until `village.innkeeper`; then the Flagon 4 (35% lvl 2; with `caskbook` 25% lvl 2 / 10% lvl 3). Price 60 + 40/level.
- Board: regular contracts (up to 3) followed by every available story contract: `id` `story-<story>`, `story` set,
  `warnings[0] === 'Story'`, `warnings[1]` = what it unlocks ("Unlocks the infirmary"...). Half bounty rounded down to 5.
  Availability: surgeon always; innkeeper rep>=1; smith rep>=1; copper innkeeper home; caskbook copper home and rep>=2.
- Refusal texts (exported as `LOCKED` in camp.ts): heal "No surgeon in Lowgate. Rescue Brother Aldric (Level 1, the library). Until then, drink a potion.",
  upgrade "The forge is cold. Rescue Gerda the smith (Level 2, the cellblock).", metalwork buy "Needs a smith: rescue Gerda (Level 2, the cellblock).".
- `shop(state)`: caltrops/hook/key have `needs: 'smith'` and `locked` text until the smith is home. `shop()` with no state: nothing locked.
- `ales(state)`: all 7; `locked` while Wim is away ("The Flagon is dark..."), then until the copper, then caskbook ales until the cask book.
- `drink` heroId: one stash potion, +5 HP up to max. `buyAle` heroId ale: one per hero (refused while `Hero.ale` is set).
- startDelve: `HeroInDelve.ale` = the effect (Black Cask already resolved: may be 'hiccups' / 'heavyhead'); `Hero.ale` cleared.
  Featherfoot sets `aleSpent` after the first fall. Glowworm hero counts as party light radius 1 (inLight/heroLit/sightRange).
- Story recover items: `story`, value 0; the copper `slots: 2, heavy: true` (carrier's move and dash max 3); cask book 1 slot.
  They go to the village on backToCamp (never stash, never sold, never parley payment). Story prisoners don't join the roster.
- backToCamp events: `{type:'villageUnlocked', story}` then a `say` line (e.g. "Brother Aldric sets up in the old chapel. The infirmary is open.").
- Crews: L1 contract 50% Sisters (prospector, enter round 3-6 as before). L2/L3 contract 60% a cutthroat crew (Ferrymen or Gallows Choir),
  `temperament: 'cutthroat'`, `stance: 'waiting'`, `entered` from round 1 near a `rivalPosts` hex on Level 2. Members: Ferrymen
  sellsword/ranger/sapper, Choir sellsword/burglar/pyromancer; L2 tier (+2 HP, +5 hit); each carries 30 gold in `loot`.
  Rival ids r1..r3; `crew` on each member is the CrewId.
- Waiting -> `demanding` when a hero is within 6 in LOS of a member, or noise >= 4 they hear (player phase): `toll` set, leader intent
  `{kind:'toll', targetId?, to}`, others 'wait'. Unpaid at the next world phase after the demand -> `hostile`.
- Intents: sellsword `shove` (to = pit hex), sapper `charge` (to = target hex, `hexes` = radius 1, damage [3,3]), pyromancer `firebolt`
  (targetId, damage range). Hired members show `attack` with a monster targetId.
- `aim` (when spotted): prospectors `{what: 'the chapel chest' | heirloom name | 'loot in the ...', rounds, value, at}`;
  cutthroats waiting/demanding `{what:'your purse', value: toll or carried}`, hostile `'your blood'`; leaving `'the way out'`.
- Parley: `actions()` offers `parley` (free, pick 'enemy', targets = crew members visible within 4 in LOS). `bribe` never offered now.
  `deals(state, heroId)` -> leave, truce (label 'Pay the toll' while demanding), job winch / open / scout, hire (with `risk`), fight.
  Each has price (×1.5 on L2+, rounded to 5), `pays` ("25 gold and a ruby (60)") when payable, `ok`, `blocked`
  ("You carry 25; they want 40.", "One deal a round with them. Try again next turn.", "The lift already runs.", ...).
  `deal` command: free; events `{type:'deal', deal, job?, price, paid: string[]}` + `rivalsStance`. Hire end may emit `betrayed`.
- Attacking a bribed/truce/hired crew -> hostile (they keep the coin).

## Files
- src/game: camp.ts, common.ts, data.ts, delve.ts, engine.ts, falls.ts, rivals.ts (rewritten for crews), parley.ts (new), state.ts,
  world.ts, world-phase.ts, engine.test.ts, test/testCastle.ts (rivalPosts at (2,14,5)).
- src/data/castle: index.ts (`rivalPosts` L2 (14,16) (35,16) (22,7) (22,26)), castle.test.ts.
- scripts/v3-engine-sim.ts.

## Contract requests
- None blocking. Nice to have: `RivalCrew.hiredBy` (which hero hired them) is engine-private (CrewX) right now; the UI may want it.

## Known issues / notes
- The old determinism test was already ~4.5 s alone (5 s default timeout); given 20 s.
- Monsters don't target hired crew members (they only hunt heroes and the prisoner), so hired crews take no monster damage.
- Cutthroats on a truce stand at their post; they don't loot (spec: "cutthroats stay at their post").

## Sim (npx tsx scripts/v3-engine-sim.ts 30, seed 1; the campaign restarts when Keven dies)
- 30 delves: 22 done, 25 deaths, 0 refused commands. L1 16/17 (7 deaths), L2 5/10 (10), L3 1/3 (8).
- Story: 17 story delves, 14 done; surgeon, innkeeper, smith and copper all came home at some point (the copper on delve 12);
  the final campaign ends with surgeon + innkeeper.
- Crews: 21 delves had a crew: Sisters 13 (9 neutral at the end), cutthroats 8 (6 still waiting at the end: the bot's route
  usually misses the post), 1 toll paid, 0 refused; 2 cutthroat delves ended hostile.
