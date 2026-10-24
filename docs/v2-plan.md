# V2 plan: one fast, readable dungeon run

V1 (the faithful 4-week campaign on the 1980 map) is saved on the `v1-prototype` branch. V2 is built on the `v2` branch and merged to `main` (which deploys) only once it's playable.

Owner feedback after playing V1: too claustrophobic, visually and mechanically; too many clunky rules. V2's thesis: make a single dungeon run as fun as possible. Faster pace, clearer visuals, fewer and more elegant rules, with real decisions left in.

## Design (decided for V2)

**One-shot run.** No weeks, wages or hiring. A run is: shop → one expedition → results. Score = gold carried out. Lord Hobart must get out alive or the run is lost. Medals at 600 / 1,200 / 2,000 gold.

**Default company.** Lord Hobart, Thorvold (Dwarf), Pim (Burglar), Aldous (Magic User), and two squads of 8 men. No muster screen; pick an entrance for everyone, or a split.

**Shop before the run.** 150 gold purse; unspent gold counts toward the score. Items go in a shared party pack and any unit can use them:

| Item | Cost | Use |
| --- | --- | --- |
| Blasting charge | 40 | Blow open a door or an inner wall. Loud. |
| Rope | 30 | Rappel safely down the shaft to the Deep; climb back up in 1 turn. |
| Healing draught | 25 | Heal a hero 2 wounds, or return 3 men to a squad. |
| Smoke bomb | 20 | Fill a square and its neighbours with smoke for a turn. |
| Sellsword band | 60 | A third squad of 6 men. |
| War banner | 50 | Every hero starts with full Focus. |

**New map.** Hand-built for play, not copied from 1980: two levels (the Halls, the Deep), big rooms, wide 2–3 square halls, few doors placed where they matter, a central shaft into the Deep, the Dragon's hoard at the bottom. Tiles render at twice the size.

**Simpler rules.**
- Doors: plain doors open by walking. Locked doors: Pim picks one silently for 1 action, always; anyone else forces it for 1 action, always, but loudly. No smash table, chop counters or jammed locks.
- Loot is visible: treasure piles sit in rooms from the start (bigger deeper and where monsters guard). No search rolls, no trap charts. Grab = 1 action standing on the pile.
- Carrying is counted in sacks, not coins: heroes 1 (Thorvold 2), squads 1 per 2 men. Carrying anything costs 1 move. A big hoard needs 2 sacks.
- Removed: shieldwall, dummy contacts, ESP, pyrotechnics, unlock spell, search, chests, traps, campaign economy.
- Kept: two actions, frontage, success slots with Focus, morale and panic, overwatch, the Alarm and reinforcement waves, monsters, the Dragon, Fireball and Smokescreen and Combat spells.

## Checklist

Each step ends with a commit and push to `v2`.

- [x] Save V1 to `v1-prototype`; create `v2`
- [ ] Map: cell-grid builder + the new two-level map, with tests
- [ ] Engine: one-shot run flow (shop → expedition → results), party pack and items
- [ ] Engine: simplified doors, visible loot and sacks, removals; tests updated
- [ ] Renderer: tiles at 2× scale, two-level map, items and loot piles visible
- [ ] UI: shop screen, results screen, item actions; remove muster/week/debrief
- [ ] Bot balance check on the new map; tune medal thresholds
- [ ] Play-test in headless Chromium, fix, merge to `main`, check the live page
- [ ] Changelog for the owner (docs/v2-changes.md) and GDD note

## Resuming

If a session is cut off: `git checkout v2 && git pull`, read this checklist, and continue from the first unchecked step. Run `npx tsc --noEmit && npx vitest run` first to see where things stand.
