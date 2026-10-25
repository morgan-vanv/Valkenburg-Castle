# V3.5 agents: shared rules

V3.5 "The Heir's Return" builds docs/v3-spec.md section 18 (read it all; 17 and 16 still apply). Owner's decisions: https://claude.ai/artifact/PttJ4kNWutJvUAegNgAxeA (the spec has everything you need). Repo /root/valkenburg-castle, branch `v3.5`. Read CLAUDE.md and docs/agents/v3-common.md (testing-cost rules) first. The shell's cwd resets between calls: always `cd /root/valkenburg-castle && ...`.

## Contract

The lead has already changed src/game/types.ts and src/game/api.ts (see `git diff v3.4 -- src/game/types.ts src/game/api.ts`) and renamed Hobart: hero id `keven`, class `heir`. Don't change the contract files; write "Contract requests" in your progress note and work around them. `npx tsc --noEmit` currently fails in both workstreams' paths until you implement your side; keep your own paths at zero errors.

## Who owns what (one shared working tree)

- **engine**: src/game/** (not types.ts/api.ts/hex.ts), src/data/castle/**, scripts/v3-engine-sim.ts and scripts you create (prefix v35-engine).
- **presentation**: src/view/**, src/ui/**, src/audio/**, src/main.ts, src/style.css, index.html, scripts you create (prefix v35-ui).
- Lead: docs/v3-spec.md, docs/decisions.md, docs/v3-changes.md, the contract.

## Rules

- Don't commit, push, switch branches, stash or reset. The lead commits.
- No new dependencies.
- Keep docs/agents/v35-<you>-progress.md current (done, in progress, next, contract requests, known issues) after each chunk.
- Dev server on your own port: presentation `npx vite --port 5182 --strictPort`. Headless browser: `import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs'` with args `['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']`. Never `pkill -f` with a pattern that matches your own shell command; kill by PID.
- Screenshots only where the look is the question: a handful at most, one before/after pair in your report, saved under docs/agents/v35-shots/ with your prefix.

## Final report

Files changed, what you checked and how, known issues, contract requests. Short.
