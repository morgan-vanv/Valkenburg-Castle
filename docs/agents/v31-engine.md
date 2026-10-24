# Brief: V3.1 rules engine

Read docs/agents/v3-common.md first (own paths only, don't commit, keep a progress note at docs/agents/v31-engine-progress.md, snapshot with `bash scripts/snapshot-wip.sh`). Branch: `v3.1`. Read docs/agents/v3-engine-progress.md for how the engine is laid out.

You own src/game/** except types.ts, api.ts and hex.ts. Implement docs/v3-spec.md section 14 against the updated contract (src/game/types.ts, api.ts). The contract changed: read the diff with `git diff main -- src/game/types.ts src/game/api.ts`.

## Deliverables

1. **Test castle first** (within your first minutes): update src/game/test/testCastle.ts to three small levels with a pit column (L1 pit over an L2 bridge and L2 pit), a lift with a winch, fixed lights, props, a railing, fire vents, and a Dragon lair. The presentation agent builds against it until the real castle lands (the map agent is writing src/data/castle in parallel; src/game/index.ts should use the real castle as soon as it typechecks).
2. **Rules** (section 14): falls down pit columns (jump, shove, blast) with landing search and damage; rope and climb on the new model; railing; tiles prop/tallprop/sealed/lift in movement and sight; the lift link and `winch` action; sight range by brightness and depth for both glimpse and units; fixed lights in `litSet`; long-range sight of lit hexes (14); fire vents; hero Shove with the full outcome list; orc `shove` intents on edges; berserker knockback; the Dragon (asleep/wake, breath intents with hexes every other round, sweep, bite, Lair leash, can't be shoved); the hoard items placed around the Dragon at delve start; the `slay` contract (rep ≥ 3, bounty 500, kill XP); the Level 3 cave mouth exit.
3. **API:** `sightRange`, `fallInfo`, `edgeRisk`; `preview` for jump and shove fills `warning` and sets `confirm` for drops over one level; `actions` offers Jump with each adjacent pit hex as a target, Shove with targets, Winch when next to the winch.
4. **Events** in order: `shoved`, `fell` (with levels and damage), `breath`, `liftWorking`, plus existing ones.
5. **Tests:** fall columns (L1 over a bridge lands on L2, elsewhere on L3, damage 4 and 7), railing blocks a shove, shove outcomes (pit, wall, figure, vent), orc shove intent on an edge, berserker knockback, Dragon breath hits only the marked hexes and alternates, sweep, can't shove the Dragon, lift needs the winch, sight range by stage and depth, fixed lights light hexes, slay contract completion, determinism and serialize still pass.
6. **Sim:** update scripts/v3-engine-sim.ts for three levels and the slay contract; report per contract type: done rate, rounds, light left, deaths. Add a `DRAGON=1` mode where the bot takes the slay contract with a full party so the lead can see whether a Dragon run stretches the lantern.

Keep everything pure and seeded. Existing behaviour (camp, rivals, contracts, light stages, the Gloam) must keep working; update old tests only where section 14 changes the rules.
