# V3 agents: shared rules

You are one of three agents building V3 of Valkenburg Castle ("Hobart's Revenge"), a browser turn-based extraction crawler, in /home/claude/valkenburg-castle on the `v3` branch. The owner wants a playable demo deployed by morning, so favor working and simple over complete and clever.

## Read first

- CLAUDE.md (project rules: static site, TypeScript, Vite, seeded RNG, rules apart from rendering).
- docs/v3-spec.md: the rules with numbers.
- src/game/types.ts, src/game/api.ts, src/game/hex.ts: the contract. Don't change these files. If you need a change, write it in your progress note under "Contract requests" and work around it; the lead will decide.

## Working together

- Three agents share one working tree: engine (src/game/**), map (src/data/castle/**), presentation (src/view/**, src/ui/**, src/audio/**, src/main.ts, src/style.css, index.html). Only edit your own paths, plus your own progress note and scripts you create (prefix them with your workstream, e.g. scripts/v3-engine-sim.ts).
- Don't commit, push, switch branches, stash or reset. The lead commits.
- Old V2 code (src/engine, src/render, src/data/maps) is being replaced. Don't import from it. You may read it and copy what's useful.
- npm: run `source scripts/npmenv.sh` before npm commands. No new dependencies without a strong reason (note it in your progress note).
- `npx tsc --noEmit` checks the whole repo. Errors in someone else's paths are theirs; keep yours at zero.

## Safeguards (the session may hit a rate limit at any moment)

- Keep docs/agents/v3-<workstream>-progress.md up to date: done, in progress, next, contract requests, known issues. Update it after every meaningful chunk, so a fresh agent can pick up exactly where you stopped.
- About every 30 minutes of work, and whenever you finish a milestone, run `bash scripts/snapshot-wip.sh`. It pushes all uncommitted work in the tree to the `wip/v3` branch without touching `v3`.

## Final report

When done, reply with: what works, what's stubbed or missing, contract requests, and how to run/test your part. Keep it short.
