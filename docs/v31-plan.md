# V3.1 plan: the three-level castle

Goal: the approved three-level castle (Castle Map Proposal, pass 2: https://claude.ai/artifact/C8o5Sz4x4ngXzSMDG6cHsQ) playable and deployed for the owner to play-test. Rules: docs/v3-spec.md section 14. Built on branch `v3.1`, merged to `main` (which deploys) once playable.

## Owner's answers (2026-10-24)

- Level size as sketched is fine.
- A full Dragon run should be a stretch on the lantern.
- Cave mouth: our call (open from the start; the walk is the cost).
- Level 1 pit mouth: only a few bits of broken railing; people should get shoved in.
- Landing in view of the Dragon: yes, that's the drama.
- Add monsters and loot now.
- Thin walls and endless descent: later (docs/ideas-later.md).

## Workstreams

| Workstream | Owner | Paths |
| --- | --- | --- |
| Contract, spec | lead | src/game/types.ts, api.ts, hex.ts; docs/v3-spec.md 14 |
| Castle: three levels, monsters, loot, lights, props | map agent | src/data/castle/** |
| Rules: falls, shoves, Dragon, lift, sight, fixed light, slay contract | engine agent | src/game/** (not the contract files) |
| Look and UI: cutaway walls, materials, props, lights, see-through pit, Dragon, jump confirm, edge badge, breath hexes | presentation agent | src/view/**, src/ui/**, src/audio/**, src/main.ts, src/style.css, index.html |
| Integration, balance, play-test, deploy | lead | everything |

## Checklist

- [x] Contract and spec (section 14)
- [x] Castle: three levels from mockup/sketch.py (hex for hex), monsters, loot, lights, props; 14 castle tests
- [x] Engine: section 14 rules; 78 tests; sim with DRAGON=1 (src/game/falls.ts, dragon.ts)
- [x] Presentation: new look and UI for section 14
- [x] Integration: typecheck clean, 95 tests, build OK
- [x] Balance: on the real castle a slay run takes ~38-41 rounds, ending with ~4 light (stretch, as asked); careful bot 86% done, head-on bot 2/12. Level 1 stays a warm-up. No tuning needed yet.
- [x] Play-test in headless Chromium: full tour, stress bot and level shots on the real castle, 0 errors
- [x] Merge to `main`, verify live (deployed 2026-10-24 ~17:40 New York; live page serves 3 levels, no console errors)
- [x] Changelog (docs/v3-changes.md) and decisions

## Resuming

0. Scheduled check-ins: 16:15 and 17:30 New York (after the 16:10 rate-limit reset).
1. `cd /home/claude/valkenburg-castle && git fetch origin && git checkout v3.1 && git pull`.
2. If `origin/wip/v3` is newer than `v3.1`, restore it: `git checkout origin/wip/v3 -- .`, review, commit.
3. Read this checklist and docs/agents/v31-*-progress.md; continue from the first unchecked step, re-briefing agents from docs/agents/v31-*.md.
