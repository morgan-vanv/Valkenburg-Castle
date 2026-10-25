# V3.2 engine progress

## Contract (DONE, types.ts / api.ts) — presentation builds against this

types.ts
- `HeroClass` = 'hobart' | 'sellsword' | 'burglar' | 'ranger' | 'sapper' | 'pyromancer' | 'shadowmancer' | 'hedgewitch' ('mage' is gone; save key vc.save.v32).
- `ItemKind` adds 'smoke' | 'glue' | 'dart' | 'caltrops' | 'hook' | 'key' | 'oil' | 'firecracker' (1 slot each).
- `ShopKind` (new) = torch|potion|rope|charge + the eight above; `ShopOffer.kind: ShopKind`; `buy` command takes it.
- `HeroInDelve` adds `dashed: boolean`, `overwatch: boolean` (eye icon + 6-hex cone), `veil: number` (rounds; draw translucent), `ward: number` (rounds; shield glint). `mana` is for the three mage classes.
- `Monster.stuck?: number` (glued rounds left). Sleeping = `awareness: 'asleep'` (draw z).
- `Delve` adds `smoke: Record<posKey, rounds>`, `glue: Record<posKey, rounds>` (drawing), `burning: Record<posKey, rounds>`, `caltrops: string[]` (posKeys). `blown` now also holds dug rubble/cracked walls (they become floor).
- `ActionKind` adds: overwatch [self], knockback [enemy], throwCharge [hex + itemId], dig [hex], fireball [hex], veil [ally id], sleep [enemy], blink [hex], ward [ally id], gust [hex], smoke [hex], glue [hex], dart [enemy], caltrops [hex], firecracker [hex], key [hex], oil [self], grapple [hex]. Item actions carry `itemId` in their targets (send the target as given).
- `GameEvent` adds: `thrown {by, kind: ItemKind, from, to}`, `cast {by, spell: ActionKind, at?, targetId?, hexes?}` (overwatch shot = spell 'overwatch'), `blinked {id, from, to}`, `dug {at}`, `caltrops {id, at}`.

api.ts
- `Reach.dash?: boolean`. **Walk vs dash:** call `reachable(state, id, sneak)` as before. Before the first move it returns normal entries (no `dash`). Once the hero has moved and not acted (and not dashed), it returns the dash range, every entry with `dash: true` — draw those in the second colour. Send a normal `move` command; the engine spends the action. After acting, a hero who hasn't moved still gets a normal move (dash false). Sneak works for dashes too.
- `ActionOption.pick`: 'self' | 'ally' | 'enemy' | 'hex' | 'item' | 'other' (how to target). `area?` radius to highlight around a picked hex (fireball/gust/smoke/glue = 1). `mana?` cost.
- `RollPreview.hexes?` (area affected) and `affects?` (figure ids hit or moved, allies included).
- `Engine.classInfo(cls): ClassInfo {name, role, weapon, armor, mana, abilities[]}` for recruit cards.
- `Engine.partyProblem(state, heroIds): string | null` (e.g. "Hire at least one hero at the tavern.").
- `ActionOption.blocked?: string` (spec 15.7): the option applies here but can't be done now; a plain-words reason. Used by `take` ("Heirloom needs 2 pack slots. Drop something first.", "Pack is full. Drop something first.") and `grapple` (no free hex above). `take` picks the contract item first; its preview outcome lists exactly what will be taken ("Takes the Valkenburg Signet and 30 gold").

## Done
- Contract above.
- data.ts: the eight classes (CLASSES with `mana`, weapon `range`/`noise`), RECRUIT_CLASSES, classInfo() role/ability lines, 12-item SHOP, section 15 constants.
- camp.ts: Hobart alone + 160 gold, tavern of 4 (3 distinct classes + 1), partyProblem(), new HeroInDelve/Delve fields, Sapper's 2 free charges, prisoners join as a random recruit class.
- world.ts: permissive LOS (center line, then 6 corners pulled 10% in, 4 samples per hex), addEdgeWalls (solid hexes next to seen floor are seen), smoke blocks sight both ways but not light, dug rubble/cracked = floor via `blown`, burning hexes are lit.
- delve.ts: dash (reachable/doMove via moveKind), all class abilities and items, Sellsword shove 3 slots, Ranger bow range 6 / noise 1 / adjacent −1, Burglar opens chests without the action, `take` blocked reasons + contract item first, ActionOption pick/area/mana, RollPreview hexes/affects.
- world-phase.ts: veiled heroes unseen, ward (−1 per hit, min 0; Gloam too), overwatch (monsters and hostile rivals, before they move/act), glue (stuck = move 0), caltrops (stop + 2 dmg), burning (1 dmg at the world phase; monsters won't path into fire), timers and per-round resets.
- Existing tests updated (79 pass): starting roster via a `party()` helper, dash, Sellsword shove slots, glimpse edge walls.

- Tests: 102 pass (`source scripts/npmenv.sh && npx vitest run src/game`): 15.1 LOS (patchy pantry reveal reproduced and fixed; doors/tallprops block, pits and props don't; monsters share the rule), 15.2 dash, every class ability and spell, all eight items, 15.7 take blocked reasons.
- Sim (scripts/v3-engine-sim.ts): recruits 2 then up to 3 heroes (front, quiet, mage), dashes toward the goal, skips blocked options, prints the squad per delve and a "first five L1 delves" line.

## Sim numbers (real castle, SEED=1, 20 delves, `npx tsx scripts/v3-engine-sim.ts 20`, ~6 min)
- Bot hires 2 at the start (sellsword, burglar), a third/fourth as gold allows. 19/20 done; first five L1 delves 4/5 done, 2 deaths (delve 2, rescue L1, ran to the 80-round cap with the light out: the bot's escort logic, not a rules change as far as I can see, but worth a look). Recover L1 8/8 done, avg 8 rounds, 33 light left; slay L3 5/5. 3 deaths over 20 delves.
- Test castle (CASTLE=test, 6 delves): 6/6 done, 1 death (slay).

## Design calls (spec silent)
- Dash: any second move (walk or sneak) while unacted; after a dash no action. Climb/jump/grapple still need both move and action.
- Veil breaks on attack, knockback, firebolt, fireball, shove, gust, smash, or any action with noise >= 4. Veiled heroes are left out of monster targeting (Dragon too); casting veil makes hunting monsters with no unveiled hero in sight go alert at the veiled hero's hex.
- Ward: 1 less per hit (min 0) from monster/rival strikes and the Gloam's touch; the perfect +1 still lands. Not against falls, fire or breath.
- Overwatch fires once, before the enemy's move/act, at monsters and hostile rivals only; neutral sisters don't trigger it. Clears at the end of the world phase.
- Knockback/gust at range push along the rounded direction from the pusher (awayFrom()); a figure standing on the gust's own hex is not moved. Gust pushes allies too (no kill credit to the witch for allies).
- Fireball: per hit 2 minus armor (min 1) for heroes and monsters alike; +1 on a perfect. Burning hexes: 1 damage to anyone standing there at the start of each world phase (ignores armor), lit, 2 rounds; monsters won't path into fire.
- Sleep dart / Sleep spell: not the Dragon or the Gloam; a sleeping monster wakes on damage as usual (+20% to hit it). A missed dart is silent and doesn't wake the target.
- Glue: Dragon and Gloam immune; a stuck monster still attacks adjacent heroes. Caltrops: monsters only (heroes step around them); the stopped monster still bites if it ends adjacent.
- Smoke: blocks sight both ways (a hero inside sees only adjacent hexes), light passes; hunting monsters inside go alert; monsters can't see into or out of smoke beyond 1.
- Dig: the hex goes into Delve.blown (rubble and cracked both become floor). View note: level.ts currently reads `blown` for cracked walls only; rubble keys there mean "cleared".
- Burglar opens chests without spending the action (the spec's "takes and opens chests silently"; take was already free and silent).
- Sapper's free charges are added on top of the pack from the stash (dropped if the pack is full). Thrown charges may land on any visible floor/pit/cracked hex within 3, not only on locks.
- Skeleton key doesn't open jammed locks. Grapple: from a hex under a pit column (within 2 of the column on the level above), to the free edge hex nearest the column; blocked with a reason when none is free.
- Tavern: 3 distinct classes + 1 free pick, level 2 at 35%, price 40 + 20 × (level − 1). Rescued prisoners join as a random recruit class.
- `partyProblem` messages: "Hire at least one hero at the tavern." / "Pick at least one hero." / "Four heroes at most." / "<name> is still wounded."

## Known issues
- Permissive LOS is ~3x the old cost; visibleSet is memoized per query/apply on the Ctx. The full test file runs in ~7s.

## Contract requests
(none)
