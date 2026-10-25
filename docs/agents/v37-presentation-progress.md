# V3.7 presentation progress

Status: 2026-10-25, built; checks pass on the fixture and on the real engine for 20.1–20.4 (stealth and sapper landed; crews 20.4 and the kit 20.5 still fixture-only where noted).

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

## Done (second pass: spec 20.5 and 20.3a)

- **src/view/pathing.ts** (new, pure): `longPath` (Dijkstra over explored standable hexes: rubble 2, stairs and a working lift 1, open doors only, round monsters, other heroes passable but not an endpoint), `standable`, `stepsToTurn`.
- **Free move (20.5)**: `Hud.calmState()` (engine.calm, else `Delve.calm`); while calm in the player phase the Move group shows "☽ Free move · the castle turns in N steps" and a Follow toggle ("Party follows" / "Walk alone", default on, `hud.follow`); no budget rings; hovering any explored hex draws the long path with "Free move · walk 9 hexes · the castle turns in 2 steps (2 turns on the way) · the party follows"; clicking sends `move` with the whole path and `follow`; hexes inside the normal reach keep the engine's risks. `calm` event: "Combat!" banner with the reason (`calmBanner`), log line; calm again: toast + log.
- **End turn**: the prompt and "still waiting" count only heroes who neither moved nor acted ("3 idle"); the note reads "nobody idle" otherwise.
- **Brace / shield**: Brace in the Abilities group with help; `⛨ Braced` chip and figure tag; `◉ Shield` chip (rule in the tooltip), ◉ on the camp roster chip, a round shield mesh on the hero's back (`setShield`); the forge table gets a Shield column: "Buy a shield · 50" per hero (`buyShield`) or "◉ Shield".
- **Hamstring / Night thorn / Briar**: buttons from the engine's actions (hamstring in Abilities, the spells in Abilities as spells) with help and keys (H / N / I); `hamstring` intent glyph ➴, line and words; `rooted` event: green thorn ring + "Rooted · 2"; `❃ Rooted · n` chip on heroes (Move mark used), `rooted · n` tag on monsters (`stuck`) and in the monster tooltip; `braced` event: a brace pop.
- **Crates and barrels**: hover "Crate · Smash: loud, may hold something" ("Splinters" after); Smash (`smashProp`) in the Interact group and on click; `propSmashed`: lunge, splinters and dust, the prop vanishes (`LevelView.breakables` + `setSmashed`, crates and barrels are instanced per kind), "+ 7 gold" float and the loot glow on the drop ("Nothing inside" otherwise).
- **Blasting the floor (20.3a)**: `blastPreview(castle, delve, at)` in stealth.ts (break / collapse next to a pit on L1–2 / rubble; the untouchable kinds and `unbreakable` left out) and `collapsible`; while set-charge, throw or charge is pending, hovering a target hex shows the three outcomes by colour (orange outline = breaks, red fill = drops into the pit, pale fill = rubble, plus the outer ring) and the fuse picker names them ("Drops 3 floor hexes into the pit, 3 to rubble") with a colour key; hover on floor by a pit: "Floor · a charge here would drop it into the pit"; collapsed hexes: "Collapsed · a blast dropped this floor into the pit", rubbled floor: "Blast rubble"; the level rebuild turns collapsed hexes into pits (ledges and skirts come with the rebuild) and blown floor into rubble; the blast plays debris from every broken, collapsed and rubbled hex, "The floor drops away", and the engine's `fell` events then animate anyone on it.
- **names.ts**: `V37` gains calmSteps (CALM_STEPS), shieldPrice, brace/hamstring/thorn/briar/smash numbers (spec fallbacks until data.ts exports them); glyphs, help and keys for brace, hamstring, nightthorn, briar, smashProp; class kits list them; `MOVE_HELP.calm` / `.follow`.
- **fixtures.ts**: `engine.calm`, free move (castle turns every 4 steps, followers in file, stops and `calm:false` when a sleeper wakes), `smashed`/`calmSteps`, `withBreakables` (a crate and a barrel near the entrance: the test castle has none), brace/hamstring/nightthorn/briar/smashProp actions and events, `buyShield`, Keven starts with a shield; blasts collapse floor by pits and rubble the rest, with `fell` for anyone on it.

## Next

- Switch the 20.5 and 20.3a checks to the real engine when the kit agent lands (`engine.calm`, `blastPreview` from charges.ts: swap `src/view/stealth.ts#blastPreview` for it if its signature is simple).

## How tested

- `npx tsc --noEmit`: clean in src/view, src/ui, src/audio (the remaining errors are the engine agents' in-progress files).
- `npx vitest run src/view/stealth.test.ts`: 7 tests (dirIndexOf ties, facing, blind arc with and without a wall, breakable walls on the test castle, blast rings, blown walls).
- `node scripts/v37-ui-check.mjs http://localhost:5184/?fixture=1` and `... http://localhost:5184/` (real engine, seed 42; the second and third heroes are turned into a Sapper and a Shadowmancer when the campfire has none): ~90 DOM/state checks, 0 console errors. Real engine covers risks, blind arcs, swings and the confirm, Dread, set charge → fuse → blast → rubble, crew hover/parley/tags, captives at camp; 20.5 and 20.3a run on the fixture (skipped on the real engine until the kit lands).
- `node scripts/v3-stress.mjs http://localhost:5184/ 2`: 0 errors.
- Shots (real engine): docs/agents/v37-shots/v37-risks.png (move preview: red ring and facing wedge on the orc, "👁 Orc notices you" in the tip), v37-fuse.png (a fuse-2 charge on a wall: blast rings, the ✹2 tag, the hover text), v37-blast.png (the wall gone, "Blast rubble" on hover).

## Contract requests

- `CrewId` lacks `'the-wake'` and `RivalClass` lacks `'hedgewitch'` (spec 20.4 table); the UI keys `CREW` by `CrewId | 'the-wake'` and casts.
- `Intent.item?: ItemKind` for the crew `item` intent (the UI says "uses an item" without it).
- `GameEvent` still carries the old `{ type: 'blast'; at }` beside the new one; the UI accepts both.
- `swing`: if the engine also emits `roll`/`hit` for the swing, the damage number shows twice (the UI shows `−damage` from the swing event itself). Tell me which and I'll drop one.

- `Delve.dug` (blast rubble dug to floor) is engine-private: the view keeps its own set from `dug` events, lost on reload (the sapper agent asked for the same).
- `blastPreview`: an `Engine.blastPreview(state, at)` (or a simple export) would replace the view's copy of the rule.
- `reachable` while calm: if the engine returns only the 4-hex budget, the UI paths the rest itself (no risks on long paths); an engine `risks` for a given path would let the long hover show them too.

## Known issues

- Blind arc hexes follow the engine's `dirIndex` (largest dot product, ties low) with a straight-line wall test; the engine's own line of sight may differ by a hex at the edges.
- The fuse tag and the "Fuse 2" floater overlap for a second after setting.
- Risk tags over an enemy that stands under the hero cards are hidden by the cards (camera framing).
- Captured heroes' "dragged" chip and the summary line rely on `status: 'captured'` and `Rival.dragging`; the crews rework (lead) decides when those are set.
- The engine agents' file edits make vite reload the page mid-check; rerun when the tree is quiet.
