# V3.3 plan: fear by depth

Goal: spec section 16 (awareness and patrols, lantern 20 with shutter, per-hero sight, the Gloam owning the Hollow, difficulty tiers, three new monsters with abilities, the Lantern Sisters' kit), one delivery, deployed. Branch `v3.3`. The scale/proportion direction (study in mockup/shots/scale-options.png) is a separate decision with the owner and is NOT part of this delivery.

## Workstreams

| Workstream | Owner | Paths |
| --- | --- | --- |
| Contract (done) and spec 16 | lead | src/game/types.ts, api.ts |
| Rules: 16.1–16.5, tests, sim | engine agent | src/game/** (not types/api unless noted in progress) |
| Data: spawns, sleepers, patrols, buried ghouls, lights per level, tests, preview | map agent | src/data/castle/** |
| View and UI: shutter, per-hero darkness, patrol routes, Gloam in the Hollow, new monsters and rival classes, new intents and events | presentation agent | src/view/**, src/ui/**, src/audio/**, src/style.css |
| Integration, sim check, deploy | lead | everything |

## Checklist

- [x] Spec 16, contract, plan, briefs
- [ ] Engine: rules, tests, sim (bot opens the lantern on L2/L3)
- [ ] Castle data: spawns/patrols/lights per level, tests
- [ ] Presentation: shutter, darkness, patrols, Gloam, new monsters, intents; then scale option C (spec 15.8a)
- [ ] Integration: typecheck, tests, build; sim check (L1 easy, L2 resistance, L3 deadly unlit)
- [ ] Merge to `main`, verify live; changelog and decisions

## Resuming

1. `cd /home/claude/valkenburg-castle && git fetch origin && git checkout v3.3 && git pull`.
2. If `origin/wip/v3` is newer than `v3.3`, restore it: `git checkout origin/wip/v3 -- .`, review, commit.
3. Read this checklist and docs/agents/v33-*-progress.md; continue from the first unchecked step, re-briefing from docs/agents/v33-*.md.
