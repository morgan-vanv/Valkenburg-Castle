# V3.3 engine progress

Brief: docs/agents/v33-engine.md. Spec: docs/v3-spec.md section 16. Branch `v3.3`.

## Plan (in order)
1. data.ts: LIGHT_MAX 20, stages, oil/brazier/kindle numbers, MONSTERS archer/captain/ghoul, TIERS, search rounds.
2. world.ts: stages, per-hex sight range (`sightRangeAt`), lantern shutter in litSet, `monsterSees` (lit or within 3; L3 ignores light).
3. camp.ts: spawn defaults (awake, patrol, buried ghouls, tiers), rival classes and kit counters, new Delve fields.
4. common.ts: buried ghouls are not on the map (occupant, noise, wake); tiered stats helper; killing a ghoul releases its hold.
5. delve.ts: `shutter` (free), `escape`, held heroes can't move/dash, ghouls rise when a hero ends a move within 2, shield wall in previews, rival overwatch fires on hero moves/acts.
6. world-phase.ts: patrols + knownRoutes, noticing, giving up (searchRounds), archer/captain/ghoul/spider-drag behaviour, rival kit (overwatch, knockback, veil, smoke, dart, burglar looting), Gloam in the Hollow.
7. engine.ts: sightRange(heroId), heroLit, intents include visible rivals.
8. Tests, test castle, sim.

## Done
(nothing yet; started 2026-10-24)

## In progress
Step 1.

## Design calls (spec silent)
(see below as they come)

## Contract requests
(none yet)

## Known issues
(none yet)
