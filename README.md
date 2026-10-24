# Valkenburg Castle: Hobart's Revenge

A turn-based extraction crawler for the browser, inspired by Task Force Games' *Valkenburg Castle* (1980), Dark and Darker, For the King 2, XCOM and Deep Rock Galactic. Take Lord Hobart's contracts, loot the ruined castle and get out before the light dies.

Play the current build: https://morgan-vanv.github.io/Valkenburg-Castle/

What's new in V3: [docs/v3-changes.md](docs/v3-changes.md). Rules: [docs/v3-spec.md](docs/v3-spec.md). Earlier versions: [docs/v2-changes.md](docs/v2-changes.md) and the `v1-prototype` branch.

## Run locally

Requires Node 22.12 or newer.

```sh
npm install
npm run dev       # dev server with hot reload
npm run build     # type-check and build to dist/
npm run preview   # serve the built dist/
```

## Deploying

Every push to `main` builds the game and publishes it to GitHub Pages through `.github/workflows/deploy.yml`. There is no server and no database: the game is static files, and saves live in the player's browser.

## Layout

```
src/        game code (TypeScript)
public/     static assets copied as-is
docs/       design notes and decisions
```
