# Project notes for Claude

Valkenburg Castle: The Heir's Return. A browser-only, turn-based roguelite extraction strategy game based on the 1980 Task Force Games board game. Inspirations: XCOM (tactics), Deep Rock Galactic (extraction, co-op squad roles), Ultrakill (style and aggression), Dark and Darker and For the King 2 (the loop and the hex tiles).

## Hard constraints

- Static site only. No servers, databases or accounts. It must run from GitHub Pages.
- TypeScript everywhere. Vite builds it.
- Saves live in the browser (localStorage, key `vc.save.v39` in `src/ui/app.ts`; bump it when a save would no longer load).
- Keep dependencies few and justified (today: three, plus vite, vitest, typescript).

## Conventions

- Game rules live apart from rendering. Rules code (`src/game`) must not touch the DOM or canvas, so it can be unit-tested and replayed.
- All randomness in the rules goes through the seeded dice in `src/game/rng.ts` (state in `GameState.rng`), so runs are reproducible from a seed. (`src/rng.ts` is a V1 leftover used only by its own test.)
- The contract between engine and view is `src/game/types.ts`, `api.ts` and `hex.ts`. Change it deliberately and note it in the spec.
- Feature flags and tuning knobs live in `src/game/data.ts` (`FREE_MOVE`, `FACING`, `HEARING`, notice and sight ranges).
- Design decisions go in `docs/decisions.md` with a date and a one-line reason. Rules with numbers go in `docs/v3-spec.md` (version by version); `docs/current-rules.md` is the consolidated picture of the live game and should be updated with every rules change.
- Player-facing changes go in `docs/v3-changes.md`. Parked ideas in `docs/ideas-later.md`; built-then-shelved features in `docs/shelved/`.
- Before merging: `npm run build`, `npm test`, and the browser checks in `scripts/` that touch the change (see README).
- Never `pkill -f` or `pgrep -f` a pattern that can match your own shell; kill a dev server by the PID from `ps`.

## Off limits for now

- The Gemini prototype in the owner's Google Drive. Do not read it or borrow from it until the owner asks for a comparison.
