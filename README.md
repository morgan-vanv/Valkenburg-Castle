# Valkenburg Castle

A roguelite extraction strategy game for the browser, a modern take on Task Force Games' *Valkenburg Castle* (1980), with inspiration from XCOM, Deep Rock Galactic and Ultrakill.

Play the current build: https://morgan-vanv.github.io/Valkenburg-Castle/

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
