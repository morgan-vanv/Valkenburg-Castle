# V3.7 agents: shared rules

V3.7 builds docs/v3-spec.md section 20 (owner-approved proposals: https://claude.ai/artifact/CZWDajgUP9WrVr4L39HgXH; the spec has every number). Repo /root/valkenburg-castle, branch `v3.7`. Read CLAUDE.md and docs/agents/v3-common.md (testing-cost rules) first. The shell's cwd resets between calls: always `cd /root/valkenburg-castle && ...`. Never pkill by a pattern that matches your own shell; kill servers by PID.

Contract (src/game/types.ts, api.ts, hex.ts) already changed by the lead: `git diff v3.6 -- src/game/types.ts src/game/api.ts`. Don't edit it; write contract requests in your progress note.

Three agents share one working tree:
- **stealth** (engine): src/game/world.ts, world-phase.ts, ai.ts, common.ts, delve.ts (move, reachable, attacks, dread), data.ts (stealth/swing/dread numbers), engine.ts, tests in engine.test.ts under `describe('V3.7 stealth and swings')`. Spec 20.1 and 20.2.
- **sapper** (engine): src/game/falls.ts (blast push), a new src/game/charges.ts (fuses, blasts, breakable walls), the charge/setCharge/throw/dig cases in delve.ts, src/data/castle/** (unbreakable walls, castle.test), tests under `describe('V3.7 sapper')`. Spec 20.3. Coordinate edits to delve.ts and data.ts with the stealth agent through the progress notes (append-only sections; touch different functions; re-read before editing).
- **presentation**: src/view/**, src/ui/**, src/audio/**, src/style.css, index.html. Spec 20 as seen by the player: move-preview risks (yellow wake hexes with %, red notice, swing warning with damage), facing arrows on awake monsters and a dim "blind arc" when a sneaking hero is selected, free-swing animation and log lines, Dread intent/cast, fuse markers with the number and blast area, breakable walls hinted on hover ("Wall · a charge could break it"), blast effect (shake, debris, hole stays as rubble), set-charge fuse picker (1 or 2), captives (drag animation and tag, "taken!" banner, camp: captives list and "Bring back <name>" contracts), crew items and intents. Fixtures for all of it.
- The crews rework (20.4) is built by the lead after stealth and sapper land (it depends on both); the presentation agent builds its UI against the contract and fixtures now.

Rules: don't commit, push, switch branches, stash or reset. No new dependencies. Keep `npx tsc --noEmit` clean in your paths and `npx vitest run` green at hand-off. Progress note docs/agents/v37-<you>-progress.md after each chunk. Screenshots only where the look is the question, under docs/agents/v37-shots/.

Final report: files changed, what you checked and how, known issues, contract requests. Short.
