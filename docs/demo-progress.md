# Demo progress and handoff

Where the playable demo stands, so work can resume from a fresh session. Update this file whenever a workstream changes state.

Last updated: 2026-10-23, 20:05 New York.

## Goal

A playable 4-week campaign on levels 1–3 of the classic 1980 castle, in low-poly 3D, deployed to https://morgan-vanv.github.io/Valkenburg-Castle/. The full spec is [demo-spec.md](demo-spec.md). The design lives in the Game Design Document (link in [decisions.md](decisions.md)).

## Workstreams

| Workstream | Owner | State | Where the work is |
| --- | --- | --- | --- |
| Demo spec and engine contract | Lead | Done | docs/demo-spec.md, src/engine/types.ts, api.ts, geometry.ts |
| Rules engine | Lead | Done, 19 tests passing | src/engine/** (createEngine in engine.ts) |
| Balance bot | Lead | Runs on the classic map; bot still banks too little, diagnosing | scripts/sim.ts |
| Classic map, levels 1–3 | Map agent | Done, committed, 17 tests | src/data/maps/**, scripts/preview-map.ts; src/engine/index.ts exports the engine on it |
| 3D view, UI and sound | Render agent | Done and committed | src/render/**, src/ui/**, src/audio/**, src/main.ts, index.html, src/style.css |
| Integration, play-test, deploy | Lead | First deploy 2026-10-23; play-testing continues | main |

The agents' full briefs are in [docs/agents/](agents/). To relaunch one, start a general-purpose agent with that file's contents as its prompt, plus a note on what already exists.

## Saving work in progress

Agent work is uncommitted on main until the lead reviews it. `scripts/snapshot-wip.sh` pushes everything uncommitted to the `wip/demo` branch without touching main or the live site (Pages only deploys main). Run it with `SCRATCH=<scratch folder>` to include the map agent's helper scripts.

While agents were working, their folders (src/render, src/ui, src/audio, src/data and their scripts) are listed in `.git/info/exclude` so half-built code isn't committed to main by accident; the snapshot script force-includes them. Remove those exclude lines at integration. The agent also edits the tracked files index.html, src/main.ts and src/style.css; those are marked `git update-index --skip-worktree` locally for the same reason. Undo with `--no-skip-worktree` at integration.

To recover after a lost session: `git fetch origin wip/demo && git checkout origin/wip/demo -- src scripts docs index.html` from a clone of main.

## Remaining steps

The demo is live. Next:

1. The owner plays it and reports what is and isn't fun.
2. Untested in a real run so far: Alarm tier waves late in an expedition, the cavern and the Dragon, the Pit and ladders, chests, smoke, explosions, melee Perfects. Exercise these next.
3. Known UI rough edges: orc figures small at default zoom; 743 kB bundle (code-split Three.js); touch untested.
4. API gaps the render agent noted: `died` events don't carry the unit; chest positions aren't exposed (UI assumes the unit's square).
5. Tune numbers in src/engine/data.ts from play feedback; `npx tsx scripts/sim.ts 20` gives a quick bot baseline (median about 500 gold against the 2,000 goal).

## Workspace notes

- npm needs `source scripts/npmenv.sh`-style overrides in the cloud workspace: set `npm_config_noproxy=localhost,127.0.0.1` and `NO_PROXY=localhost,127.0.0.1` so npm goes through the proxy.
- Headless Chromium with WebGL: playwright from /home/claude/.npm-global, launch args `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`.
