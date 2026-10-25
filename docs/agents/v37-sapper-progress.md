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

## For the presentation agent

- Satchel = one pack item `{ kind: 'charge', slots: 0, amount: n, name: 'Satchel: n charges' }`; bought charges are normal 1-slot items. Count = `chargeCount(h)` from charges.ts, or sum it yourself.
- `setCharge` targets come in pairs per hex: `{ at, fuse: 1 }` and `{ at, fuse: 2 }` (pick 'hex', area 2). Preview with the chosen fuse: `outcomes[0]` "Fuse n: blows ...", `modifiers` has "Breaks the wall" / "Breaks n walls", `warning` names friends in the blast, `hexes` = within 2, `affects` = figures there.
- `Delve.fuses[]` is the marker list (`rounds` = the number to show). `fuseSet` and `blast { at, by, broke }` events. A rival's `fuse` intent shows `to` and `hexes` (within 2).
- Breakable wall for the hover hint: `breakableWall(world, delve, pos)` in charges.ts (pure). A built wall whose posKey is in `blown` is rubble (draw a hole with debris); once dug it's floor but that's only in the engine-private `delve.dug`.

## Fuse timing

`rounds` counts down at the end of each world phase; 0 = blast (after monsters and rivals act). A fuse lit during a world phase (a rival's) is `armedInWorld` and skips that phase's countdown, so the player sees the marker for a turn.

## Contract requests

- Drop the old `{ type: 'blast'; at: Pos }` event variant from `GameEvent` (types.ts line ~802); both shapes coexist, so `ev.by` needs an `'by' in ev` guard.
- `Delve.dug?: string[]` in the contract if the view should draw dug blast rubble as floor (now engine-private).
- `Engine.breakable(state, at): boolean` would be cleaner than the view importing `breakableWall` from charges.ts.

## Known issues

- Monster AI doesn't avoid lit fuses (ai.ts is stealth's); a telegraphed charge still catches monsters that walk into it. Fine for now, maybe a later tweak.
- Single breaches on the real castle rarely save 6+ hexes except the hall → armory door; the 60% rule holds everywhere (worst ratio 0.69, main gate → chapel story site) with every wall broken.
- The sim is slow with 4 heroes (~20–30 s a delve).
