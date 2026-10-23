# Demo progress and handoff

Where the playable demo stands, so work can resume from a fresh session. Update this file whenever a workstream changes state.

Last updated: 2026-10-23, 16:35 New York.

## Goal

A playable 4-week campaign on levels 1–3 of the classic 1980 castle, in low-poly 3D, deployed to https://morgan-vanv.github.io/Valkenburg-Castle/. The full spec is [demo-spec.md](demo-spec.md). The design lives in the Game Design Document (link in [decisions.md](decisions.md)).

## Workstreams

| Workstream | Owner | State | Where the work is |
| --- | --- | --- | --- |
| Demo spec and engine contract | Lead | Done | docs/demo-spec.md, src/engine/types.ts, api.ts, geometry.ts |
| Rules engine | Lead | Done, 19 tests passing | src/engine/** (createEngine in engine.ts) |
| Balance bot | Lead | Done; needs the real map to mean anything | scripts/sim.ts |
| Classic map, levels 1–3 | Map agent | In progress | Target: src/data/maps/** ; helper scripts in the scratch folder (snapshotted to wip-scratch/map-tools/ on the wip/demo branch) |
| 3D view, UI and sound | Render agent | In progress | src/render/**, src/ui/**, src/audio/**, src/main.ts, index.html, src/style.css |
| Integration, play-test, deploy | Lead | Not started | — |

The agents' full briefs are in [docs/agents/](agents/). To relaunch one, start a general-purpose agent with that file's contents as its prompt, plus a note on what already exists.

## Saving work in progress

Agent work is uncommitted on main until the lead reviews it. `scripts/snapshot-wip.sh` pushes everything uncommitted to the `wip/demo` branch without touching main or the live site (Pages only deploys main). Run it with `SCRATCH=<scratch folder>` to include the map agent's helper scripts.

While agents are working, their folders (src/render, src/ui, src/audio, src/data and their scripts) are listed in `.git/info/exclude` so half-built code isn't committed to main by accident; the snapshot script force-includes them. Remove those exclude lines at integration.

To recover after a lost session: `git fetch origin wip/demo && git checkout origin/wip/demo -- src scripts docs index.html` from a clone of main.

## Remaining steps

1. Map agent delivers src/data/maps/classic.ts (`classicCastle`) with tests and preview renders. Review the renders against the scans.
2. Add src/engine/index.ts: `export const engine = createEngine(classicCastle)`.
3. Render agent delivers the 3D view and UI. Switch main.ts to the real engine and classic map.
4. Run `npx tsx scripts/sim.ts 20` on the classic map; tune numbers in src/engine/data.ts so the 3,000-gold goal is reachable but hard.
5. Play a full run in the browser (headless Chromium works here: see the render brief), fix what breaks.
6. Commit, push to main, check the live page, update the GDD with anything learned.

## Workspace notes

- npm needs `source scripts/npmenv.sh`-style overrides in the cloud workspace: set `npm_config_noproxy=localhost,127.0.0.1` and `NO_PROXY=localhost,127.0.0.1` so npm goes through the proxy.
- Headless Chromium with WebGL: playwright from /home/claude/.npm-global, launch args `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`.
