# V3.8 agents: shared rules

V3.8 builds docs/v3-spec.md section 22 (exploration mode, owner-approved: https://claude.ai/artifact/Dw2vU6Hixgak3UeBYd8w8T). It replaces V3.7's free movement (spec 20.5's calm walk). Repo /root/valkenburg-castle, branch `v3.8`. Read CLAUDE.md and docs/agents/v3-common.md (testing-cost rules) first. The shell's cwd resets between calls: always `cd /root/valkenburg-castle && ...`. Never pkill by a pattern that matches your own shell; kill servers by PID.

Contract (types.ts, api.ts) already changed by the lead: `git diff main -- src/game/types.ts src/game/api.ts` (Delve.mode/ticks/lanternSteps; HeroInDelve.walk/sneaking; commands walk/stopWalk/sneak/tick; `move` loses `follow`; events mode/walkStopped/investigate replace calm; Engine.mode/explorePath/vision replace calm/calmReach). Typecheck fails across the tree until both of you finish; keep your own paths clean. Don't edit the contract; write requests in your progress note.

- **engine** owns src/game/** (not the contract), src/data/**, scripts/v3-engine-sim.ts and scripts prefixed v38-engine.
- **presentation** owns src/view/**, src/ui/**, src/audio/**, src/style.css, index.html, scripts prefixed v38-ui. Dev server port 5185.
- Don't commit, push, switch branches, stash or reset. No new dependencies. Progress notes docs/agents/v38-<you>-progress.md after each chunk. Screenshots only where the look is the question, under docs/agents/v38-shots/.

Final report: what works, files changed, checks and results, known issues, contract requests. Short.
