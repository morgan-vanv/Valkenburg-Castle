# V3.6 agents: shared rules

V3.6 builds docs/v3-spec.md section 19 (play-test fixes). Repo /root/valkenburg-castle, branch `v3.6`. Read CLAUDE.md and docs/agents/v3-common.md (testing-cost rules) first. The shell's cwd resets between calls: always `cd /root/valkenburg-castle && ...`. Never pkill by a pattern that matches your own shell; kill servers by PID.

Contract (src/game/types.ts, api.ts, hex.ts) is already changed by the lead: `git diff main -- src/game/types.ts`. Don't edit it; write contract requests in your progress note.

- **engine** owns src/game/** (not the contract files), src/data/castle/**, scripts prefixed v36-engine, docs/agents/v36-engine-progress.md.
- **presentation** owns src/view/**, src/ui/**, src/audio/**, src/style.css, index.html, scripts prefixed v36-ui, docs/agents/v36-presentation-progress.md. Dev server `npx vite --port 5183 --strictPort`.
- Don't commit, push, switch branches, stash or reset. No new dependencies. Keep `npx tsc --noEmit` clean in your paths and `npx vitest run` green.
- Screenshots only where the look is the question (a handful, one before/after pair), under docs/agents/v36-shots/.

Final report: files changed, what you checked and how, known issues, contract requests. Short.
