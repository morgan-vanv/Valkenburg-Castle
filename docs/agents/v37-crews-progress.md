# V3.7 crews that fight back (engine): progress

Spec 20.4. Append-only sections; the presentation and kit agents read this.

## Done (chunk 1: engine, typecheck clean in src/game but the kit agent's new ActionKinds)

- **data.ts** (crew block only): `RIVAL_CLASSES` gains `hedgewitch` (legacy table for V3.5 saves), `CREWS` carries `level`, `weaponTier`, `armorTier`, `contracts`, per-member `pack` (item kinds) and `hideout` (site id + where); the Wake (level 4, W2 A1: Mother Grave the Sellsword, Sexton the Hedgewitch, Candle the Shadowmancer, Spade the Sapper, names as in the presentation fixture). `CREW_PURSE` (30 at level 2–3, 50 at level 4), `WAKE_CHANCE` 0.6, `RIVAL_MOVE` 4, `RIVAL_POTION_HEAL` 5, `DRAG_MOVE` 3.
- **rivals.ts**: `rivalStats(r)` builds from `CLASSES` when `r.level` is set (weapon slots/dmg, stat +5 per level above 1 when it's the main stat, +10 per weapon tier, armor + armorTier, move 4, range = the bow); legacy members keep the old table. `member()` builds with level, tiers, `pack` (real items via `makeItem`), `charges` = mana for the three mage classes ("firebolts left" for the Pyromancer), no `darts`/`smoke` counters (the pack is the source of truth; `hasKit`/`spendKit` in crewai.ts still read the old counters on old saves). `makeCrew`: L1 Sisters 50%, L2 pool 60% at an L2 post, L3 the Wake 60% at an L3 post (`rivalPosts` filtered by level; the pool on L2 when a castle has no L3 posts). Hostile planning and acting are delegated to crewai.ts; hired members use `hiredKit` (potion below half, Hedgewitch Mend on a hurt hero) before their old plan.
- **crewai.ts** (new): `crewTarget`/`currentTarget` (one target a round: the lantern bearer a member can reach, else the lowest-HP hero in reach, else the nearest on foot; cleared in `computeRivalIntents`), `pathToSpots` (reachable attack/shooting spot with the least exposure to the *other* heroes, i.e. doors and pillars), `attackPlan`, per-class `kitIntent` (Burglar darts the bearer first, smoke around a member below half under two lines of fire; Ranger knockback at edges, caltrops on the nearest hero's way in, overwatch when nobody is in reach; Sellsword edge shove, glue where two adjacent heroes stand, guards the caster: `guarding`, hits on an adjacent guarded member land on the Sellsword; Sapper: fuse-1 charge thrown behind a hero at a pit edge, else at a hero 2–3 away, else set on its own neighbour toward a hero 3–5 away; Pyromancer fireball (2 mana) where 3 heroes stand within 1, else firebolt; Shadowmancer Blink away below half, veil the striker on first contact, firecracker to pull a group of 2+ non-hunting monsters near a hero, smoke; Hedgewitch Mend below half, Gust a hero at an edge, Ward the striker; anyone below half with a potion backs off a hex and drinks), `useKit`, `rob`/`dragAct`/`capture`, `hostilePlan`/`hostileAct`, `rivalCaltropsStep`.
- **Captives**: a hero downed by a member's strike is robbed on the spot (`robbed` event, gold/gems/jewelry to the member's loot, `HeroX.robbed`, `r.dragging`); a downed hero within 2 of a member gets a `rob` intent the round before. Dragging: intent `drag` (`to` = the end of a 3-step walk toward the nearest exit); the member walks, the hero's `at` trails one hex behind (only the member's `moved` event is sent, as the diorama hauls the figure on it). On an exit tile: `captured` event, hero status `captured`, member `goneOut` (`out` event), `CrewX.captives`. Freed when the dragger dies (common.ts `hurtAny`), is feared (delve.ts dread) or the hero dies; a dragged hero does not bleed (world-phase.ts). `backToCamp`: captured heroes leave the roster into `campaign.captives` (hp 1), a "Bring back <name>" rescue contract (`cap-<heroId>`, site = the crew's hideout, bounty = the rescue bounty for the hideout's level) is rebuilt by `makeBoard` every camp refresh while the captive is held; the prisoner starts at HP 1; freed and extracted the hero rejoins with that HP; dead in the delve → `fallen`. Keven captured → stage `over`, "The heir is taken. Valkenburg stays dark."
- **Spoils**: killed members drop pack and purse (common.ts `hurtAny`).
- **Hero attacks on crews** now count the member's armor (class + tier) and ward (delve.ts `spec` attack/firebolt: "Armor −1", "Warded −1" modifiers).
- **Castle**: hideout sites `lantern-sisters-hideout` L2(10,5) officers' quarters, `ferrymen-hideout` L3(9,18) the Drain, `gallows-choir-hideout` L3(33,21) the Tunnels, `the-wake-hideout` L3(30,9) the Bone Pile; L3 posts L3(20,26) lift base and L3(31,17) the Lair approach. castle.test updated (posts per level, a hideout test). Test castle: an L3 post and four hideouts.
- Old 16.5/18.5 tests updated to the 20.4 numbers (Ferrymen 14/12/14 HP, pyromancer firebolt at Wits 85, darts the bearer first, the veil on the burglar sister, smoke around the hurt sister).

## Shared files touched (small, function-scoped)

- common.ts: `hurtAny` rival branch (guard redirect, spoils, drop the captive), `killHero` (draggers let go), new `rivalGuard`, `dropCaptive`.
- world-phase.ts: bleed skipped while a living member drags the hero.
- delve.ts: `rivalArmorMods` + the attack/firebolt specs, dread drops the captive, the spotted Shadowmancer veils the striker, `rivalCaltropsStep` hook in `doMove` (a crew's caltrops catch heroes: 2 dmg, the walk ends), imports.
- state.ts: `HeroX.robbed`, `RivalX.guarding/ward/kitFrom`, `CrewX.target`, `DelveX.rivalCaltrops`.
- camp.ts: `ContractX.captiveId`, `captiveBoard`, `makeBoard` skips hideouts, prisoner HP 1 for captives, `backToCamp` captives/rescues/heir taken, summary note.

## For the presentation agent

- Intents: item uses come as their own kinds with `item` set too: `dart`, `smoke`, `glue`, `caltrops`, `firecracker`, `potion` (`to` = the hex it steps back to, `targetId` = self); spells `firebolt`, `fireball` (`to`, `hexes`), `veil` (`targetId` = the member veiled), `blink` (`to`), `mend`/`ward` (`targetId` = the member), `gust` (`to`, `hexes`, `targetId` = the hero at the edge), `fuse` (`to`, `hexes`; thrown or set), `rob` (`targetId` = the downed hero, `to`), `drag` (`targetId`, `to`), `shove`, `overwatch`, `attack`, `move`, `flee`.
- Events: `robbed {hero, by, items}`, `captured {hero, by}` then `out {id: member}`, `cast` with spell `potion`/`mend`/`ward`/`gust`/`fireball`/`glue`/`smoke`/`dart`/`veil`, `blinked {id: member}`, `thrown` for every pack throw, `caltrops {id: hero}` when a hero treads on a crew's caltrops. The dragged hero gets no `moved`/`dragged` event: the member's `moved` carries it (the hero's state `at` trails one hex behind).
- `Rival.pack` is the kit; `charges` = mana for the Pyromancer, Shadowmancer and Hedgewitch; `ward` on a member is engine-private (RivalX) — ask if you want it in the contract. `Rival.guarding` likewise.
- `campaign.captives[]` and the board's `Bring back <name>` contracts (`id` `cap-<heroId>`, `siteId` `<crew>-hideout`, `warnings` [crew name, Level n, 'Held at HP 1']).

## Next

- `describe('V3.7 crews')` tests; the sim (fight on 1 in 3 crew delves, report fights/captures/rescues); balance.

## Contract requests

- None yet beyond what the lead added. `Rival.ward` and `Rival.guarding` could join the contract if the UI wants to show them.
