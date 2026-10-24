# V3.2 plan: squad building, classes, spells, gear, polish

Goal: the owner's seven play-test notes (2026-10-24 evening) built and deployed. Rules: docs/v3-spec.md section 15. Branch `v3.2`, merged to `main` (deploys) once playable.

## Workstreams

| Workstream | Owner | Paths |
| --- | --- | --- |
| Contract changes (types/api per spec 15, done first), rules, data, tests, sim | engine agent | src/game/**, src/data/** |
| View and UI: dash range, enemy camera, chest glow, squad building camp, classes/spells/items UI | presentation agent | src/view/**, src/ui/**, src/audio/**, src/main.ts, src/style.css, index.html |
| Integration, play-test, deploy | lead | everything |

## Checklist

- [x] Spec section 15, plan, briefs, safeguards
- [ ] Engine: contract + 15.1-15.4 rules; tests; sim
- [ ] Presentation: 15.2-15.6 UI; screenshots
- [ ] Integration: typecheck, tests, build
- [ ] Quick balance check (a new squad can finish a Level 1 contract)
- [ ] Play-test in headless Chromium
- [ ] Merge to `main`, verify live
- [ ] Changelog and decisions

## Resuming

0. Scheduled check-ins: 21:15 and 22:30 New York (after the 21:10 rate-limit reset).
1. `cd /home/claude/valkenburg-castle && git fetch origin && git checkout v3.2 && git pull`.
2. If `origin/wip/v3` is newer than `v3.2`, restore it: `git checkout origin/wip/v3 -- .`, review, commit.
3. Read this checklist and docs/agents/v32-*-progress.md; continue from the first unchecked step, re-briefing agents from docs/agents/v32-*.md.
