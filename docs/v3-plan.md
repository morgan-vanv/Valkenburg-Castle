# V3 plan: Hobart's Revenge (extraction crawler)

Goal: a playable first slice of the V3 design, deployed to GitHub Pages from `main`.
Design: the V3 Game Design Document, https://claude.ai/artifact/Q7766w5bBz11paXkw4YPf1 (summary in docs/v3-spec.md).
V2 stays on the `v2-final` tag and in `main` history. V3 is built on the `v3` branch and merged to `main` only once playable.

## Owner's answers (2026-10-24)

- Title: "Valkenburg Castle: Hobart's Revenge".
- Hobart joins delves as a powerful, irreplaceable hero. If he dies, the campaign ends.
- Party of up to 4.
- Splitting up is a real tactical choice with trade-offs, not a side feature.
- Light burns per turn. The Gloam hunts at pitch black.
- Rival crews can be bribed, hired or allied with.
- Endless "Deep Vaults" mode: stub only, later.
- Rotatable camera.
- Open-ended for now (no story ending).

## Slice scope

Levels 1 and 2 on hex grids; Hobart plus Sellsword, Burglar, Hedge Mage; slot rolls with Focus; light and the Gloam; noise; combat in place with enemy intents; 5 monster kinds; Rescue and Recover contracts; one rival crew (the Lantern Sisters) with bribe; camp with bounty board, quartermaster, tavern, infirmary and stash; XCOM permadeath; rotatable 3D camera.

## Workstreams

| Workstream | Owner | Paths |
| --- | --- | --- |
| Contract (types, hex math, API) | lead | src/game/types.ts, src/game/hex.ts, src/game/api.ts, docs/v3-spec.md |
| Rules engine and tests | engine agent | src/game/** (not the contract files) |
| Castle levels 1 and 2 | map agent | src/data/castle/** |
| 3D view, HUD, camp screens, sound | presentation agent | src/view/**, src/ui/**, src/audio/**, src/main.ts, src/style.css, index.html |
| Integration, balance, play-test, deploy | lead | everything |

## Checklist

Each step ends with a commit and push to `v3`. Agents don't commit; the lead commits their work, and `scripts/snapshot-wip.sh` pushes uncommitted work to `wip/v3` every so often.

- [ ] Plan, safeguards and resume reminders
- [ ] Contract: types, hex math, engine API, spec
- [ ] Engine: rules for exploration, slot rolls, light, noise, combat, AI, rivals, contracts, camp; tests pass
- [ ] Castle: Levels 1 and 2 as hex maps, validated (every room reachable, spawns on floor)
- [ ] Presentation: hex diorama, rotatable camera, HUD with roll previews, camp screens
- [ ] Integration: wire it together, remove V2 code, typecheck and tests pass
- [ ] Balance: bot plays delves; tune light, loot and bounties
- [ ] Play-test in headless Chromium; fix blockers
- [ ] Merge to `main` and verify the live page
- [ ] Changelog (docs/v3-changes.md) and decision log

## Resuming

If a session is cut off (rate limit or otherwise):

1. `cd /home/claude/valkenburg-castle` (clone `morgan-vanv/valkenburg-castle` if missing), `git fetch origin && git checkout v3 && git pull`.
2. Check `origin/wip/v3` for uncommitted work newer than `v3`: `git log -1 origin/wip/v3` vs `git log -1 v3`. If newer, `git checkout origin/wip/v3 -- .` to restore it, review, and commit to `v3`.
3. Read this checklist and the progress notes in docs/agents/v3-*-progress.md. Continue from the first unchecked step; re-brief agents from docs/agents/v3-*.md for unfinished workstreams.
4. Run `npx tsc --noEmit && npx vitest run` to see where things stand.
