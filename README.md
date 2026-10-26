# Valkenburg Castle: The Heir's Return

A turn-based extraction crawler for the browser, inspired by Task Force Games' *Valkenburg Castle* (1980), Dark and Darker, For the King 2, XCOM and Deep Rock Galactic.

Keven, long-lost heir of the late Lord Hobart, camps in Lowgate, a derelict village under the castle walls. Build a squad (or go in alone), delve a three-level castle for contracts and loot, and get out before the lantern dies. People you rescue bring the village back to life. If Keven falls, the campaign ends.

Play the current build (V3.9.4): https://morgan-vanv.github.io/Valkenburg-Castle/

## Docs

| Doc | What it holds |
| --- | --- |
| [docs/current-rules.md](docs/current-rules.md) | How the game works right now, checked against the code. Start here |
| [docs/v3-changes.md](docs/v3-changes.md) | Player-facing changelog, newest first |
| [docs/v3-spec.md](docs/v3-spec.md) | Rules with numbers, version by version (later sections override earlier ones) |
| [docs/decisions.md](docs/decisions.md) | Design and engineering decisions, dated, with reasons |
| [docs/ideas-later.md](docs/ideas-later.md) | Parked ideas |
| [docs/shelved/](docs/shelved/) | Built-then-shelved features, with how to resume them |
| [docs/agents/](docs/agents/) | Briefs and progress notes from each build round |

Earlier versions and old plans: [docs/archive/](docs/archive/) (V1 demo spec, V2 changes, the V3–V3.3 plans) and the `v1-prototype` and `v2` branches.

## Run locally

Requires Node 22.12 or newer.

```sh
npm install
npm run dev       # dev server with hot reload
npm run build     # type-check and build to dist/
npm run preview   # serve the built dist/
npm test          # unit tests (vitest)
```

URL options for development: `?castle=test` runs the real rules on the small test castle; `?fixture=1` runs a stand-in engine with canned states (for presentation work).

## Checks

- **Unit tests:** `src/game/engine.test.ts`, `charges.test.ts`, `src/data/castle/castle.test.ts`, `src/view/stealth.test.ts`, `src/rng.test.ts`.
- **Balance bot:** `npx tsx scripts/v3-engine-sim.ts [delves]` plays delves through the engine and prints stats. `npx tsx scripts/v37-crew-arena.ts` pits rival crews against a party.
- **Browser checks:** `scripts/v3*-check.mjs` and `v3*-ui-check.mjs` drive the real UI headless with Playwright and assert on the DOM and state. Start `npm run dev`, then for example `node scripts/v39-ui-check.mjs http://localhost:5173/`. Each script's header says what it covers and whether it also runs with `?fixture=1`. `scripts/v3-stress.mjs` plays random valid commands through the UI to catch playback and rendering errors.

## Deploying

Every push to `main` builds the game and publishes it to GitHub Pages through `.github/workflows/deploy.yml`. There is no server and no database: the game is static files, and saves live in the player's browser (`localStorage`, key `vc.save.v39`).

## Layout

```
src/game/      rules engine: pure TypeScript, no DOM; seeded dice in rng.ts; the contract is types.ts, api.ts, hex.ts
src/data/      the castle: three hand-built levels, spawns, patrols, lights, story sites
src/view/      Three.js diorama: levels, figures, fog, markers, animation
src/ui/        HUD, camp screens, names and help texts, settings
src/audio/     sound effects
scripts/       balance bot, crew arena, headless browser checks, screenshot helpers
docs/          rules, changelog, decisions, ideas, agent notes
public/        static assets copied as-is
```
