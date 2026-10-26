# Brief: V3.8 exploration mode (engine)

Read docs/agents/v38-common.md, then docs/v3-spec.md section 22 in full (and 20.1/21.5 for noticing, 20.5 for what you're replacing: src/game/calm.ts).

1. **Modes:** `Delve.mode` ('explore' at delve start); `mode` events; `Engine.mode`. Old saves without `mode` behave as combat.
2. **tick** (22.2) in a new src/game/explore.ts replacing calm.ts: hero walk orders stepped at walk/sneak pace with every per-hex rule (reuse stealth.ts per-hex hooks and the doMove internals; factor a single-step function out of doMove if needed), patrols and investigators at 1 hex every 4 ticks, prospector crews likewise, noticing after the steps, exploring rounds every 8 ticks with every round-based timer (search `world-phase.ts` for what counts down per round and run those, minus the lantern burn and monster turns), lantern and torch burn by distance.
3. **walk / stopWalk / sneak** commands; `explorePath` (explored hexes, any length, through heroes, risks along it); `vision` (walk and sneak notice hexes per awake enemy).
4. **Investigating** (22.3) instead of hunting on noise in explore.
5. **Combat start** (22.4): enemies-first (immediate world phase, then a fresh player phase) on notice; party-first with surprise on a hostile act (list in 22.4; the surprised skip their first world phase), toll/fight/Gloam/fuse; overwatch armed in explore fires on the first enemy step in sight.
6. **Combat end** (22.5) check after every world phase and hero action; back to explore with a clean clock.
7. **Actions in explore** (22.6): no move/act limits, one at a time, the actor pauses 1 tick; no dash; parley works; hired crews follow at walking pace.
8. Remove calm.ts's walk and CALM_STEPS; make old calm tests into explore tests; update tests that start delves and assume turns (give them `mode: 'combat'` via a helper where they test combat rules).
9. Tests under `describe('V3.8 explore')` for every rule; a headless script scripts/v38-engine-patrol.ts that walks a hero past a patrol and prints the tick combat starts; sim: the bot explores with walk + ticks and fights in combat; report ticks, combat starts by trigger, lantern burned per delve.
