# V3.2 plan: squad building, classes, spells, gear, polish

Goal: the owner's seven play-test notes (2026-10-24 evening) built and deployed. Rules: docs/v3-spec.md section 15. Branch `v3.2`, merged to `main` (deploys) once playable.

## Workstreams

| Workstream | Owner | Paths |
| --- | --- | --- |
| Contract changes (types/api per spec 15, done first), rules, data, tests, sim | engine agent | src/game/**, src/data/** |
| View and UI: dash range, enemy camera, chest glow, squad building camp, classes/spells/items UI | presentation agent | src/view/**, src/ui/**, src/audio/**, src/main.ts, src/style.css, index.html |
| Visual clarity pass and UI refinement (spec 15.7), after the presentation agent finishes | clarity agent | src/view/**, src/ui/**, src/style.css |
| Integration, play-test, deploy | lead | everything |

## Checklist

- [x] Spec section 15, plan, briefs, safeguards
- [x] Engine: contract + 15.1-15.4 rules + take feedback (15.7); 102 tests; sim hires a squad (20 delves: 19 done, 3 deaths)
- [x] Presentation: 15.2-15.6 UI; screenshots (effects in src/view/effects.ts)
- [x] Clarity pass: 15.7 (stairs/lift, objective beacons, take feedback, interactable tooltips, HUD hierarchy); screenshots
- [x] Style and scale pass: 15.8 (OSRS-like figure scale, big Dragon, thin walls visually), after the clarity agent finishes
- [x] Integration (clarity build): typecheck clean, 119 tests, build OK, stairs walk PASS, clarity DOM checks pass
- [x] Quick balance check: sim's hired squad finished 19 of 20 delves
- [x] Play-test in headless Chromium: tour and stress bot, 0 errors
- [x] Merge to `main`, verify live (clarity build ~20:50, style build after)
- [x] Changelog and decisions

## Resuming

0. (Rate-limit check-ins cancelled 20:05 New York: the owner upgraded the plan.)
1. `cd /home/claude/valkenburg-castle && git fetch origin && git checkout v3.2 && git pull`.
2. If `origin/wip/v3` is newer than `v3.2`, restore it: `git checkout origin/wip/v3 -- .`, review, commit.
3. Read this checklist and docs/agents/v32-*-progress.md; continue from the first unchecked step, re-briefing agents from docs/agents/v32-*.md.
