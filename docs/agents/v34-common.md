# V3.4 agents: shared rules

V3.4 addresses the owner's play-test notes on V3.3 (2026-10-24, late night). Repo: /root/valkenburg-castle, branch `v3.4` (made from `main`). Read CLAUDE.md and docs/agents/v3-common.md (testing-cost rules apply) first.

## Who owns what (one shared working tree)

- **Lead** (not you): src/game/**, src/data/**, src/ui/screens.ts (camp: tavern prices, infirmary), docs/v3-spec.md, docs/decisions.md, docs/ideas-later.md, docs/v3-changes.md. The lead is changing: recruit prices and starting gold; hero HP now carries between delves (new `Hero.hp` in the campaign) and the infirmary heals for gold per HP; distant light shows only light sources (the fire, the fungus), not the floor they light.
- **view** agent: src/view/** only.
- **hud** agent: src/ui/hud.ts, src/ui/names.ts, src/ui/dom.ts, src/ui/app.ts, src/ui/settings.ts, src/style.css. (The lead may append a small block at the very end of style.css marked `/* v3.4 lead: camp */`; leave it alone.)
- Shared contract files (src/game/types.ts, api.ts, hex.ts): don't change them; write "Contract requests" in your progress note.

## Rules

- Don't commit, push, switch branches, stash or reset. The lead commits.
- No new dependencies.
- `npx tsc --noEmit` must stay clean for your paths. `npx vitest run` must keep passing.
- Keep docs/agents/v34-<you>-progress.md current (done, in progress, next, known issues).
- Run your own dev server on your own port: view uses `npx vite --port 5181 --strictPort`, hud uses `--port 5182`. Headless browser: `import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs'` with args `['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']` (see scripts/v33-ui-check.mjs; `?fixture=1` and `vc.load()` inject states).
- Screenshots only where the look is the question: a handful at most, reduced scale, and one before/after pair for your report. Save them under docs/agents/v34-shots/ with your prefix.

## Final report

Reply with: what changed (files), what you checked and how, the before/after shot paths, known issues. Short.
