# V3.7 presentation progress

Status: 2026-10-25, in progress. Built against the contract and the fixture engine; switching checks to the real engine as the stealth and sapper pieces land.

## Done (first pass, typecheck clean in my paths)

- **src/view/stealth.ts** (new, pure): `facingOf`, `facingAngle`, `backDirs`, `blindArc` (the three back directions by nearest sector, standable hexes within 4, straight line not through a wall; the hex directly behind as `behind`), `facedUnits`, `breakableWall` (L1/L2, not unbreakable, not cave rooms, two floor-like neighbours), `blastRings` (inner within 1, outer at 2), `wallsBlastWouldBreak`, `fuseAt`, `fuseSide`, `fuseWords`, `blownWalls`.
- **src/view/diorama.ts**: facing wedges (eye cone + arrow) on awake monsters and crew members, following the figure; `showBlindArcs(on)` (dark hex wash + "sneak up here" ring and tag behind each visible enemy); `showRisks(MoveRisks)` (yellow ring + `☾ 50%` tag on sleepers, red eye on noticers, red sword + damage on swingers); fuse markers (keg + spark, inner red fill, outer orange rings, countdown tag; rival fuses red); `breakable` highlight style drawn on top of the wall; `applyBrokenWalls` rebuilds a level with blast-broken walls as rubble; `playBlast` (flash, shake, hit-stop, ring pulses, debris, dust, the wall comes down a third of the way in, "Wall broken" floats); events `fuseSet`, `swing` (lunge + flash + damage), `feared` (violet flash, shiver, turns away), `noticed` (turns, "👁 Noticed!"), `woke`, `robbed`, `captured` (fade out); a rival `moved` while `dragging` hauls the downed hero figure along; `dragged` by a crew member (no web strand); Dread cast: a dark ripple; intents `fuse` (blast rings in the enemy colour + fuse pip), `rob`, `potion`, `item`, `flee` words; tags: `L3` level badge on crew members, `feared`, `dragging <name>`, `dragged!` on the hero; figures turn to their `facing`.
- **src/view/figures.ts**: the Wake (`rival-the-wake-*`, deep green and bone: skull mask, spade on the back) and a hedgewitch crew member.
- **src/ui/hud.ts**: move hover lists the risks ("☾ Rats may wake · 50%", "👁 Orc notices you", "⚔ Orc: free swing 0–2") and draws them on the map; walk/sneak toggles it live; blind arcs shown while sneaking; a move that provokes swings asks once ("Orc gets a free swing: 0–2 ... Move anyway?"); set-charge flow: aim (breakable walls outlined, targets dashed) → fuse picker (1 / 2, blast rings previewed, walls it would break outlined) → act with `target.fuse`; hover: "Wall · a Sapper's charge could break it", "Charge · fuse 2 · set by Brann, goes off in 2 castle turns...", "Blast rubble"; monster/crew hover: "Faces north-east" and "You are behind it", feared, dragging, level/tiers/pack (`crewMemberLine`) and the class kit; parley card members show L4 W+2 A+1 and pack sockets; rivals panel: crew level/tiers and "Dragging <name> toward the way out!"; hero card: `⇜ Dragged` chip, `Taken` fate; Dread in the Abilities group (SPELLS), Set/Throw charge in Abilities, the satchel socket (no slot, count); `capturedBanner`; intent text for fuse/rob/potion/item/flee; context hint lists fuses.
- **src/ui/app.ts**: log lines and sounds for fuseSet, blast (walls broken), swing, feared, noticed, woke, robbed, captured (+ banner); camera focus for them in the world phase.
- **src/ui/names.ts**: `V37` live numbers (reads WAKE_*, NOTICE, DREAD_*, BLAST_* from data.ts, spec fallbacks), `MOVE_HELP` (walk / sneak / swing / blind arc), `setCharge` and `dread` glyph/help/key, charge texts on fuses, sneak attack in Attack help, AWARENESS_TEXT with the new numbers, `CREW['the-wake']`, `CREW_KIT`, `crewMemberLine`.
- **src/ui/screens.ts**: Captives panel under the roster ("Bring back" button to the prepare screen), "Taken by a crew" contracts first on the post with their own seal and the prisoner line, summary line for taken heroes / "The heir is taken. Valkenburg stays dark.", over screen variant.
- **src/view/fixtures.ts**: captives, `fixtureCaptive`, `fixtureWake`; Brann is a Sapper (satchel of 3), Aldous a Shadowmancer (Dread, Sleep); monsters have facings; `reachable` fills `risks`; move applies swings/wake/notice; setCharge/throwCharge set fuses; endTurn counts fuses down and blasts (walls broken into `blown`, locks opened, damage with the shield rule), feared monsters flee with hero swings.
- **src/style.css**: block "V3.7".

## Next

- scripts/v37-ui-check.mjs on `?fixture=1`, then on the real engine; stress bot; two screenshots.

## Contract requests

- `CrewId` lacks `'the-wake'` and `RivalClass` lacks `'hedgewitch'` (spec 20.4 table); the UI keys `CREW` by `CrewId | 'the-wake'` and casts.
- `Intent.item?: ItemKind` for the crew `item` intent (the UI says "uses an item" without it).
- `GameEvent` still carries the old `{ type: 'blast'; at }` beside the new one; the UI accepts both.
- `swing`: if the engine also emits `roll`/`hit` for the swing, the damage number shows twice (the UI shows `−damage` from the swing event itself). Tell me which and I'll drop one.

## Known issues

- Blind arc hexes are by nearest sector (±60° cone) with a straight-line wall test; the engine's rule may be narrower or wider at distance.
