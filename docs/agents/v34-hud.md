# Brief: V3.4 HUD clarity and tooltips

Read docs/agents/v34-common.md first, then docs/v3-spec.md 15.7 (visual clarity pillar: don't spoonfeed, but once seen, show what matters and what you can do with it), 15.3–15.4 and 16 (abilities, items, numbers). You own src/ui/hud.ts, names.ts, dom.ts, app.ts, settings.ts and src/style.css.

The owner's own screenshot of the current HUD is at docs/agents/v34-shots/owner-hud.png (2560×1305): top-left hero cards under the lantern panel.

## Owner's notes

> The importance of inventory slots is not visually emphasized enough on the UI. To be honest, the character information in the top left of the UI could be a whole lot more clear (it's also clipping slightly on the lantern info graphic). In addition, let's do a pass to make sure things are explained / have tooltips. I've played 3 versions of this game and I still don't know what "Kindle" does really.

## 1. Hero cards, redone

- **No overlap.** The lantern panel's second line ("Open · burning" / the daylight hint) is cut off by the first card. Lay the top-left out so the light panel, round and cards never overlap at 1200×750, 1440×900 and 2560×1305.
- **Pack slots are a first-class row.** Always draw all 4 slots (spec: `PACK_SLOTS`) as sockets: empty ones visibly empty, filled ones with the item glyph; a 2-slot item (heirloom, hoard) spans two sockets. Under or beside it, "2 free" / "Full" in plain words. Hover a socket: item name, what it does, how to use it ("Torch · 12 rounds of light around the bearer. Use: Items › Torch"). The current 2/4 tiny boxes at the far right are too easy to miss.
- **Readable hierarchy.** Name + class word (e.g. "Marek · Ranger L2") instead of only a letter glyph; HP bar with numbers; Focus and Mana as labelled pips; turn state (move/action) clear; status badges (in the dark · sight 1, edge, webbed, veiled, warded, overwatch, grabbed, bleeding, carries the lantern, escorting) each with a tooltip saying what it means and what to do about it. Selected hero obvious. Downed/dead obvious.
- Keep cards compact enough that four fit in the left column at 1200×750 without covering the middle of the map. Use the existing style language (dark panels, small caps, gold accents).

## 2. Explain everything (tooltip pass)

Every thing a player can hover in the delve HUD says what it is and what it does, in one or two plain sentences with the real numbers (from src/game/data.ts and the spec; section 16 overrides older numbers):
- Every action button in the bar (move, sneak, dash, attack, each ability and spell with its mana cost, range, noise, roll; each item action). **Kindle**: "Kindle · 1 mana: feed the lantern 6 rounds of light. Silent, no roll." Check ACTION_HELP and other strings in names.ts against data.ts; several are stale (e.g. old Kindle +12, old lantern 24).
- Light panel: what the stages mean (bright/dim/dark/pitch, sight ranges), what the shutter does, what "daylight here" means. Round counter. Level buttons. Focus and Mana pips. Edge badge. The roll preview's modifiers (each modifier line explains itself).
- Monsters and rivals on hover already show a note (MONSTER_NOTE); make sure every kind has one and that intents are named in words.
- A small "?" or legend is fine if it helps, but prefer tooltips where the thing is.

Write in the game's voice: short, plain, concrete, no jargon the game hasn't taught.

## 3. Settings

Add a setting "Lower walls near the camera" (default off) that calls the diorama's cutaway toggle (the view agent defaults it off and exposes `setCutaway(on)` or the `cutaway` field). Coordinate through progress notes.

## Check

Typecheck, vitest, a headless DOM script (scripts/v34-hud-check.mjs) asserting: cards don't overlap the light panel at the three viewport sizes (bounding boxes), 4 pack sockets per hero card, every visible action button has a non-empty title/tooltip, Kindle's help mentions 6. One before/after screenshot pair of the top-left HUD at 1440×900. Progress note: docs/agents/v34-hud-progress.md.
