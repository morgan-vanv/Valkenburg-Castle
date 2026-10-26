# V3.9 agents: shared rules

V3.9 builds docs/v3-spec.md section 24 (fields of view, the Burglar's flavor win, previews only for seen enemies). Repo /root/valkenburg-castle, branch `v3.9`. Read CLAUDE.md, docs/agents/v3-common.md (testing-cost rules), and the project's new tenets at the top of section 24. The shell's cwd resets between calls: always `cd /root/valkenburg-castle && ...`. **Never pkill or pgrep -f a pattern that matches your own shell command line; kill servers by PID read from `ps`.**

Contract (types.ts, api.ts) already changed by the lead: `git diff main -- src/game/types.ts src/game/api.ts` (HeroInDelve.facing; `face` command; `faced`/`unseenHit` events; Engine.seenEnemies). Don't edit it; contract requests in your progress note.

- **engine** owns src/game/** (not the contract), src/data/**, scripts/v3-engine-sim.ts, scripts prefixed v39-engine.
- **presentation** owns src/view/**, src/ui/**, src/audio/**, src/style.css, index.html, scripts prefixed v39-ui; dev server port 5186.
- The game is turn-based: `FREE_MOVE.enabled` stays false (spec 23.1). Don't touch src/game/calm.ts beyond what facing needs.
- Don't commit, push, switch branches, stash or reset. No new dependencies. Progress notes docs/agents/v39-<you>-progress.md. Screenshots only where the look is the question, under docs/agents/v39-shots/.

Final report: what works, files changed, checks and results, known issues, contract requests. Short.
