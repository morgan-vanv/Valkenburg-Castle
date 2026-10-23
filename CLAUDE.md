# Project notes for Claude

Valkenburg Castle: a browser-only roguelite extraction strategy game based on the 1980 Task Force Games board game. Inspirations: XCOM (tactics), Deep Rock Galactic (extraction, co-op squad roles), Ultrakill (style and aggression).

## Hard constraints

- Static site only. No servers, databases or accounts. It must run from GitHub Pages.
- TypeScript everywhere. Vite builds it.
- Saves live in the browser (localStorage or IndexedDB).
- Keep dependencies few and justified.

## Conventions

- Game rules live apart from rendering. Rules code must not touch the DOM or canvas, so it can be unit-tested and replayed.
- All randomness goes through a seeded RNG (`src/rng.ts`) so runs are reproducible from a seed.
- Design decisions go in `docs/decisions.md` with a date and a one-line reason.

## Off limits for now

- The Gemini prototype in the owner's Google Drive. Do not read it or borrow from it until the owner asks for a comparison.
