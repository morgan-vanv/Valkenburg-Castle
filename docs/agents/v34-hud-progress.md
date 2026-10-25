# V3.4 hud: progress

## Done

- **Hero cards redone** (src/ui/hud.ts `renderCards`, `turnMarks`, `statusChips`, `packRow`; CSS block "V3.4 hud" at the end of src/style.css, just above the lead's camp block).
  - Rows: name + class word and level ("Marek RANGER L2", Hobart reads "HEIR L1") with Move/Act tags at the right; labelled HP bar with numbers; labelled Focus pips and Mana pips (mana only for classes with mana, max from `CLASSES[cls].mana`); a Pack row; status badges.
  - Pack: always `PACK_SLOTS` sockets. Empty ones are dashed and sunken; a 2-slot item (heirloom, hoard) spans two; "N free" or "Full" in words. Every socket has a tooltip: name, what it does, how to use it ("Torch · 12 rounds of light around the bearer (radius 2). Use: Items › Light torch"); valuables give their sale value, the heirloom says to carry it out.
  - Badges, each with a tooltip saying what it means and what to do: Lantern (bearer; open or shuttered), In the dark · sight N, Held, Edge · dmg, Webbed, Veiled · n, Warded · n, Overwatch, Torch · n, Guarding, Escorting, Rally in n, Revived. Downed shows "Downed · n" in red in the name row (with how to save them); dead is greyed and struck through; out is dimmed with "Out".
  - Selected card: gold border, left bar, warmer background, brighter name.
- **No overlap.** The light panel's second line no longer wraps: "Open · burning" and the Shutter toggle share one row, the next-stage / daylight hint has its own row. Cards, the rival panel and the camera buttons are placed under the top bar by measuring it (`Hud.placeBelowTop` sets `--hud-below` on render and on resize).
- **Tooltip pass.**
  - Every HUD element with a `title` now shows the HUD's own styled tooltip at once (delegated `pointerover` on the HUD root moves `title` to `data-tip`; first line "Name · cost" bold, further lines dim).
  - `ACTION_HELP` (src/ui/names.ts) now covers every `ActionKind`, numbers taken from src/game/data.ts constants (Kindle `KINDLE_LIGHT` 6, oil `OIL_LIGHT` 8, brazier `BRAZIER_LIGHT` 4, torch `TORCH_ROUNDS` 12, ranges, noises, rounds). Kindle's tooltip: "Kindle · 1 mana · uses the action / Feed the lantern 6 rounds of light (+6). Silent, no roll. The lantern holds 20 at most." Attack help is per class from the weapon (`actionHelp`). Bar tooltips: label · cost (mana, free / uses the action / whole turn, roll) · hotkey, then the help; blocked buttons add "Can't now: reason".
  - Walk/Sneak, End turn, Round, level buttons, sound, menu, camera buttons, light panel (stages with their numbers, lantern radius, sight, roll penalties, dark sight per level, shutter, refills), light number/state/next line.
  - Roll preview: each modifier line explains itself ("Dark −20% · how much light you stand in"); slots, Focus, noise and light lines have tooltips.
  - `MONSTER_NOTE` covers every monster (rats, orc, spider, cutpurse, berserker, Dragon, archer, captain, ghoul, Gloam); monster tooltips add awareness in words (`AWARENESS_TEXT`). Intents were already words (`intentText`).
  - Stale texts fixed: CLASS_KIT Kindle, ITEM_EFFECT torch/oil, brazier hover (+4).
- **Setting "Lower walls near the camera"** (default off): `Settings.cutaway` (src/ui/settings.ts), checkbox in the HUD menu, applied in `App.applySettings` through the view agent's `Diorama.setCutaway(on)` (falls back to the `cutaway` field).
- **Check**: scripts/v34-hud-check.mjs (fixture engine, injected 4-hero state): no overlap at 1200×750, 1440×900, 2560×1305; 4 sockets per card, heirloom spans 2, free count; socket/badge/turn/res tooltips; every bar button for every hero has a tooltip; Kindle tooltip says 1 mana / 6 rounds / silent; ACTION_HELP and MONSTER_NOTE complete; settings toggle. 0 failed, 0 console errors. Also: tsc clean, vitest 150 passed, v33-ui-check 0 failed, v3-stress (1 delve) 0 errors.
- Shots: docs/agents/v34-shots/hud-before.png, docs/agents/v34-shots/hud-after.png (1440×900, top-left 560×520 clip).

## Known issues

- Four cards with badges are ~110 px each; at 1200×750 the column ends at ~570 px, clear of the bar but taller than before. Cards keep their width (258–272 px).
- The bar tooltip says "uses the action" for actions the engine treats specially (open is free for doors, chests use the action except for the Burglar); the help text says so.
- Tooltips are the HUD's own; native `title` tooltips no longer appear inside the HUD.

## Contract requests

None.
