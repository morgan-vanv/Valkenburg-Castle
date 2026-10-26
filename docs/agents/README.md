# Agent briefs and progress notes

Each build round split its work between agents. A round has a shared brief (`*-common.md`), one brief per workstream (`<round>-<workstream>.md`) and the agent's own notes (`<round>-<workstream>-progress.md`, what was built and what the next layer can rely on). `*-shots/` hold the screenshots a round took. These are history: for the live rules read `docs/current-rules.md`.

| Round | Files | What it built |
| --- | --- | --- |
| V1 demo | `map-transcription.md`, `renderer.md` | 1980 map transcription, first renderer (code since replaced) |
| V3.0 | `v3-common.md`, `v3-engine*`, `v3-map*`, `v3-presentation*` | The extraction crawler's first slice. `v3-common.md` also holds the testing-cost rules later rounds point to |
| V3.1 | `v31-*` | The three-level castle |
| V3.2 | `v32-*` | Squad building, classes, clarity, style pass |
| V3.3 | `v33-*` | Fear by depth; `v33-scale-study.md` |
| V3.4 | `v34-*` | HUD rebuild, view (walls, figures), fall reveal |
| V3.5 | `v35-*` | The Heir's Return: Lowgate, villagers, the Flagon, parley |
| V3.6 | `v36-*` | Play-test fixes |
| V3.7 | `v37-*` (`stealth`, `sapper`, `crews`, `kit`, `presentation`) | Stealth, free swings, the Sapper, crews that fight back |
| V3.7.1 | `v371-fixes.md` | Play-test fixes |
| V3.8 | on branch `shelf/exploration-mode` only | Exploration mode (shelved; see `docs/shelved/exploration-mode.md`) |
| V3.9 | `v39-*` | Eyes front: fields of view, the Burglar's backstab |
| V3.9.3 | `v393-hearing.md`, `v393-shots/` | Heroes hear unseen enemies |

V3.7.2, V3.9.1, V3.9.2 and V3.9.4 were small enough to build without agents.

Paths in the older briefs may point at `/home/claude/valkenburg-castle`; the repo now lives at `/root/valkenburg-castle` in these sessions (any clone works).
