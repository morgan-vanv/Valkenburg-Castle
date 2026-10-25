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

## In progress / next
- Rules: LOS (15.1), dash (15.2), squad/classes (15.3), items (15.4); tests; sim.

## Contract requests
(none)
