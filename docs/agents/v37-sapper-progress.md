# V3.7 sapper (engine): progress

## Done (all of the brief)

- **src/game/charges.ts** (new): `FuseX` (engine-private `armedInWorld`), satchel helpers (`isSatchel`, `chargeCount`, `spendCharge`, `satchelName`), `breakableWall` / `blastableWall` / `wallsBrokenBy`, `setFuse`, `fuseAt`, `blastArea`, `tickFuses` (end of world phase), `blast` (rings 4/2, inner-ring push via falls.push, locks within 1, cracked and breakable walls → `blown`, noise 8 to adjacent levels, kills credited to the setter, blast shield via `shielded`).
- **src/game/charges.test.ts** (new, `describe('V3.7 sapper')`, 12 tests): satchel; plain `charge` item for non-Sappers; setCharge targets/preview/fuse 1|2; fuse timing; throw range 3; damage rings + push + noise below + kill credit; push over the pit edge; shield (setter 0, friends half, rival charge full); locks and chests within 1; breakable-wall rule (outer, pillar, L3, cracked, `unbreakable`); wall → rubble (move 2, sight) → Dig → floor; `broke` list and the preview's "Breaks the wall".
- **Map:** `LevelBuilder.unbreakableAround(rooms)` / `unbreakable(cells)`; `finish()` marks the outer curtain (void behind, one room before) and the shaft rooms' walls. L1 `tower`, L2 `guard` (stair landing) and `winch` (lift) marked. castle.test: 3 new tests incl. the 60% path rule (every entrance × every site, all breakable + cracked walls broken, rubble cost 2). 85 breakable walls on L1/L2 (armory beside its locked door, the cells, the barracks' south wall...), 0 on L3.
- **Sim** (scripts/v3-engine-sim.ts): `SAPPER=1` hires a Sapper first (adds one to the tavern if missing); a Sapper (or anyone with a bought charge) looks 7 hexes around for a breakable wall or locked door whose breach saves 6+ hexes (two distance fields: hex→goal and hex→hero), walks up and sets fuse 1; heroes keep out of lit fuses' blast areas; the report prints fuses lit, blasts, walls broken, locks blown, own-blast hero hits, and where each blast was. 24 delves seed 1: 2 blasts (the hall → armory door, +2 walls each), 0 refused commands.
- **Shared files I touched (small, function-scoped):**
  - `world.ts` `kindAt`: a built wall in `blown` reads as `rubble`, or `floor` once in `DelveX.dug`.
  - `world-phase.ts`: `blowCharges` removed; `tickFuses(c)` called right after `gloamPhase(c)`, before "5. New round"; unused imports dropped.
  - `state.ts`: `DelveX.dug?: string[]` (replaces `charges?`).
  - `data.ts`: `SAPPER_CHARGES = 3`, `BLAST_INNER_DMG`, `BLAST_OUTER_DMG`, `BLAST_NOISE`; sapper abilities text; charge shop text.
  - `delve.ts`: only charge code: `chargeSpot` helper, `targetsFor` cases `throwCharge` / `setCharge` / `charge` / `dig` (+ `drop`/`give` skip the satchel), `LABELS`/`ORDER`/`PICK`/`AREA` entries for `setCharge`, `sameTarget` compares `fuse`, `blastSpec` preview helper, `doAct` cases `throwCharge` / `setCharge` / `charge` / `dig`.
  - `camp.ts`: the satchel at delve start; skipped at `backToCamp` and in lost gear.
  - `rivals.ts`: the sapper's kit intent is `fuse` (lobs onto the hero's hex, fuse 1, shared blast); `KIT` updated. `SAPPER_CHARGE_DMG/NOISE` no longer used there (still in data.ts).
  - `falls.ts`: `afterLanding` is a `var` so delve.ts's registration survives the `common → stealth → rivals → delve` import cycle (the suite failed to load with the `let`).
  - engine.test.ts: the 15.3 sapper test and the 18.5 rival sapper test updated to fuses.
- docs/decisions.md: one line on the satchel, fuse timing, breakable rule and the shield.

## 20.3a blasting the floor (added 14:50)

- `charges.ts`: `blastPreview(c, at) → { broke, collapsed, rubbled, hit }` (pure; the blast itself uses the same plan) and `collapseDrop(w, d, p)` (where collapsing floor lands, for previews). In `blast`: floor/raised floor within 1 (by kindAt, so a dug hole counts, rubble doesn't; never `unbreakable`, chest or hoard hexes, and stairs/lift/exit/door/brazier/tallprop/sealed aren't floor) → next to a pit (original or collapsed) with a level below: `Delve.collapsed`; occupants fall by the column rules (`falls.fall`) after the blast damage; ropes and fuses on it are dropped, ground loot falls to the landing hex; the rest → `blown` (rubble, Dig clears it via `dug`); the Hollow only rubbles. Event `blast { broke, collapsed, rubbled }`. The inner-ring push skips figures who already fell.
- `world.ts kindAt`: floor in `collapsed` → 'pit' (so sight, movement, shoves, jump targets, fallColumn from above, pitsNextTo/edgeRisk and later blasts all see it); floor in `blown` → 'rubble' (floor once in `dug`). `falls.railed` is false on a collapsed hex.
- `delve.ts` (mine only): `blastSpec` adds modifiers "Floor collapses into the pit: n hexes" / "Rubble: n hexes", a `warning` + `confirm` when a hero stands on collapsing floor ("The floor under Brann collapses: falls 1 level into the Hollow, 4 damage on top of the blast."); the dig case sends blasted floor to `dug`.
- Data: `LevelBuilder.protectAround(c, r)` marks the hex and its neighbours `unbreakable`; applied to L1 stairs (37,3), L2 stairs (37,3) and lift (24,27), L3 lift (24,27). castle.test checks it.
- Tests (charges.test.ts, 3 new): bridge charge drops Brann to the Hollow (half blast + fall damage), the hole is a pit (fallInfo, jump target, edge risk, unwalkable, seen through, widens on a later blast, L1 falls pass through it); room-centre charge rubbles 7 hexes, nothing collapses, Dig clears; stairs/exit/lift/chest/unbreakable floor untouched, the Hollow only rubbles.
- Sim line now prints `floor collapsed n / rubbled n`.

## For the presentation agent

- Satchel = one pack item `{ kind: 'charge', slots: 0, amount: n, name: 'Satchel: n charges' }`; bought charges are normal 1-slot items. Count = `chargeCount(h)` from charges.ts, or sum it yourself.
- `setCharge` targets come in pairs per hex: `{ at, fuse: 1 }` and `{ at, fuse: 2 }` (pick 'hex', area 2). Preview with the chosen fuse: `outcomes[0]` "Fuse n: blows ...", `modifiers` has "Breaks the wall" / "Breaks n walls", `warning` names friends in the blast, `hexes` = within 2, `affects` = figures there.
- `Delve.fuses[]` is the marker list (`rounds` = the number to show). `fuseSet` and `blast { at, by, broke }` events. A rival's `fuse` intent shows `to` and `hexes` (within 2).
- Breakable wall for the hover hint: `breakableWall(world, delve, pos)` in charges.ts (pure). A built wall whose posKey is in `blown` is rubble (draw a hole with debris); once dug it's floor but that's only in the engine-private `delve.dug`.
- Blast preview by colour (20.3a): `blastPreview(ctx, at)` in charges.ts returns `{ broke, collapsed, rubbled, hit }`; it needs a `Ctx` (`{ w: World, s, d: state.delve, ev: [] }`). `engine.preview(...)` for setCharge/throwCharge/charge already folds it into `modifiers` and `warning`; a contract query (`Engine.blastPreview(state, at)`) would be the clean way to get the hex lists. Redraw: `delve.collapsed` posKeys = new pit hexes (ragged edge); floor posKeys in `delve.blown` = rubble.

## Fuse timing

`rounds` counts down at the end of each world phase; 0 = blast (after monsters and rivals act). A fuse lit during a world phase (a rival's) is `armedInWorld` and skips that phase's countdown, so the player sees the marker for a turn.

## Contract requests

- Drop the old `{ type: 'blast'; at: Pos }` event variant from `GameEvent` (types.ts line ~802); both shapes coexist, so `ev.by` needs an `'by' in ev` guard.
- `Delve.dug?: string[]` in the contract if the view should draw dug blast rubble as floor (now engine-private).
- `Engine.breakable(state, at): boolean` would be cleaner than the view importing `breakableWall` from charges.ts.
- `Engine.blastPreview(state, at): { broke, collapsed, rubbled, hit }` for the coloured blast overlay (20.3a).
- Chest hexes don't collapse or rubble (not in the spec's list, but a chest hanging over a pit would break opening/loot); say if you'd rather they fall.

## Known issues

- Monster AI doesn't avoid lit fuses (ai.ts is stealth's); a telegraphed charge still catches monsters that walk into it. Fine for now, maybe a later tweak.
- Single breaches on the real castle rarely save 6+ hexes except the hall → armory door; the 60% rule holds everywhere (worst ratio 0.69, main gate → chapel story site) with every wall broken.
- The sim is slow with 4 heroes (~20–30 s a delve).
