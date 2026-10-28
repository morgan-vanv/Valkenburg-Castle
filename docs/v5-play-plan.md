# V5.0 play track: owner and play-test feedback (27 Oct)

The play track takes the owner's play-test feedback (with new players, on V4.1 round 3) into V5.0. It owns rules, data, balance and the UI (see `docs/v5-plan.md` for ownership and branch rules; branch `v5.0-play`). The graphics overhaul runs beside it on `v5.0-gfx`.

Work in two kinds of steps:
- **Build now** (clear asks, small, low risk): fix, test, commit.
- **Pitch first** (design choices the owner must make): a short pitch doc with options, a recommendation and numbers, then stop for the owner. Build only what he approves.

Pillars that matter most here (claude/design-pillars.md): 2 never slow fast players · 3 show what's needed to decide · 11 visual clarity · 15 numbers only where they inform a choice · 16 intuitive rules · 17 rivals play by the party's rules (crews get every new verb) · flexibility with tradeoffs (every option has a cost).

## Build now

### B1. Shop: buying fills the cart; equipping is a separate act
**Shipped (spec 32.2).**
Feedback: buying is confusing because bought items auto-equip to a hero.
Today: the engine already puts a purchase on Keven's cart (`case 'buy'` in `src/game/camp.ts`, `C.stash.push`). The Outfit screen's Buy button then moves it into the selected hero's pack (`src/ui/lowgate.ts` ~1280–1300, "Into X's pack"). This is UI-only.
Do: buying only ever puts the item on the cart (show it landing there); equipping happens on the "Yours" side by an explicit act (give to a hero, drag, or a per-item "Give to" menu). Make the cart read as the inventory. Supersedes the 2026-10-26 decision "a purchase goes into the selected hero's pack only if it fits"; log the new decision. Update `scripts/v40-lowgate-check.mjs` and the vendor tests.

### B2. Items that can't be used: the torch after jumping to the bottom level
**Shipped (spec 32.1).** The cause: the jump was a whole-turn action, so the hero landed with no action and Light (an action) came only next round. A jump is now the hero's move (no dash after), the action stays. Audit in `src/game/itemuse.test.ts`.
Feedback: players couldn't light their torch after jumping down to the bottom level. Find the cause first; don't guess.
Places to look: `src/game/falls.ts` (the drop), `src/game/light.ts` (`torchesToLight` needs an unlit torch with rounds left and no torch already burning; `lightTargets`, `doLight`), whether the jump spends the hero's action, and the HUD's "only usable actions shown" filter in `src/ui/hud.ts`.
Do: reproduce in a unit test (jump or fall to Level 3 with an unlit torch, try to light it), fix, and keep the test. Then audit item use in odd states (after a fall or jump, carrying or being carried, on a raised floor, in the dark, with a full pack, the turn after a reaction) with a table-driven test. The owner's note "Also lets make sure that using items …" was cut off: ask him what he meant.

### B3. E also confirms
**Shipped (spec 32.3; E stays inert on the reaction card).**
Feedback: if E ends the turn, it should also confirm dice rolls and other confirmation windows.
Today: `onKey` in `src/ui/hud.ts` (~3491; `k === 'e'` ends the turn ~3599); the reaction card takes its keys first.
Do: while a roll panel or confirmation is open, E confirms it (Enter and Space too), and never ends the turn underneath. Decide what E means on the reaction card (it has two answers; E should pick the first only if that's obvious, otherwise leave it to the number keys) and note it. Update the HUD check.

### B4. The probability bar: thicker, no text under it
**Shipped (spec 32.4).**
Feedback: remove the text under the probability bar and make the bar thicker.
Today: `outcomeBar` in `src/ui/hud-roll.ts` (~209, class `dl-ocbar`) and its CSS in `src/style.css`.
Do: drop the lines under the bar, make the bar clearly thicker, keep labels inside the segments where they fit and full numbers on hover (pillar 15). Update `hud-roll.test.ts`.

### B5. Auto end turn
**Shipped (spec 32.5).**
Feedback: if no party member can do anything (no move, no action, no usable item), end the turn automatically; allow opting out in settings.
Do: after each command, if every able hero has nothing left (use `engine.actions(state, heroId)` from `src/game/api.ts`; ignore free toggles like Walk/Sneak and reaction settings), end the turn after a short beat. Add "Auto end turn" (on by default) to `src/ui/settings.ts` (append only; G also adds lines there). Don't fire while a reaction or roll is pending, or while a loot panel is open. Keep the existing "ending a turn with heroes who did nothing" check sensible: auto end only when they truly can't act.

## Pitch first (one pitch doc, then stop for the owner)

Write one pitch (a Claude Doc, like V4.1's "Classroom and Check") covering P1–P6, each with: what players hit, two or three options with their costs, a recommendation, and numbers where they matter. Keep it skimmable.

**Written (2026-10-27 evening): "V5.0 play pitch: Reactions, the Return, the Ranger, Controls, the Camera, Status"** https://claude.ai/artifact/TNGjrZ54oitgRP4fe2B6iA. Recommendations: P1 Hold, Shield block, Flame ward, Potion a friend; P2 a counting tally with story-gift reveals and a "left behind" list, no grade; P3 "dodging targets" (−1 slot on a bow shot at a target that has noticed the shooter; crew Rangers too); P4 WASD camera, sneak on Shift, Attack on Space, E stays End turn, a `?` overlay; P5 advance the selection, never the camera, and no advance while free things (Take, an open door) remain; P6 the spec `docs/v5-status-visuals.md` with three open questions. **Answered 2026-10-27 (the owner's column in the pitch) and built 2026-10-28:** P5 → spec 32.6 (the flow on one test; the camera cycles after a beat, the End turn question says what's left, auto end; "advance the selection, not the camera" rejected as deceptive), items → 32.7, P4 → 32.8 (plus a sliding Walk / Sneak switch on Shift), P3 → 32.9 (option 1), P1 → 32.10 (the shield block only; the rest in ideas-later for the meta-progression pass), P2 → 32.11 (option 1). P6: the owner's column was empty; the three questions stand (the HUD side of the status spec waits on them).

### P1. Reactions: more of them, for melee, mages and items
Owner: keep Brace proactive (it rewards foresight: you brace before the hit). He likes reactions (overwatch, the hidden swing) and wants melee fighters to have one, and more for mages, items and the shield.
Today: `src/game/react.ts` (`ask` at a reaction point; `Pause`; the `react` command replays the turn with the answer); `ReactionKind = 'hiddenSwing' | 'overwatch'` in `src/game/types.ts`; per-hero Ask / Always / Never (`setReaction`); bots answer by policy (`createEngine(castle, { react })`). The free swing on stepping away (spec 31.11) already exists.
Shape the pitch around a short list (three to five), each with a real cost (next turn's action, Focus, mana, a shield charge, noise) and a rule a player can guess. Candidates to weigh:
- A melee "hold" stance: the melee answer to overwatch (strike the first enemy that steps next to you during the castle's turn).
- Riposte or counter: when an adjacent enemy attacks and misses.
- Shield block: raise the shield when struck, at a cost (the forge shield exists, `data.ts` ~342).
- Guard as a reaction: step in for an adjacent ally who is struck.
- Mage reactions: a flame ward that burns a melee attacker (Pyromancer), fading into shadow when noticed (Shadowmancer), mending a friend who goes down (Hedgewitch).
- Item reactions: a potion for a friend who goes down, caltrops when an enemy charges.
Rules for all: crews get the same reactions (pillar 17); bots need a policy so the sim and arena keep working; questions must stay rare enough not to slow fast players (pillar 2).

### P2. The return report: rewards that feel good and show room to optimise
Feedback: half the players didn't notice what story contracts gave them. Emphasise rewards and scoring, show players they can optimise, and make it feel good (Megabonk, Vampire Survivors, Balatro).
Today: `src/ui/return.ts` (header with the strongbox, the job's result, renown and what it opened, three boxes). Gifts are in `GIFTS` (`data.ts` ~660); there is no score.
Pitch: a tally that counts up (gold, XP bars filling, renown, then unlocks and story gifts revealed one at a time with sound and a little punch), skippable at any point with a click, E or Space (pillar 2). Story rewards get their own reveal and say what they unlock in Lowgate. "Room to optimise": what was left behind (seen but unopened chests, loot dropped, a missed bonus), a per-delve breakdown, a best-so-far line. A delve score or grade is a design question: offer it as presentation over existing numbers first; anything that changes rewards needs the owner's yes.

### P3. The Ranger's power curve
Feedback: the Ranger is overpowered: most damage, and from range. Keep them this strong against unaware enemies; tone them down elsewhere.
Today: `src/game/data.ts` ranger (Finesse 75, Longbow 3 slots, damage 2, range 6, noise 1; quiver 5 a level; Overwatch, Knockback, Hamstring; specialty arrows); sneak attack and backstab constants ~300; crew Rangers use `BOW_RANGE`.
Pitch: measure first (add damage dealt by class to the sim if it isn't reported), then two or three options, for example fewer slots or less damage against aware targets at range, a closer "sweet spot", or overwatch limits, each with before/after numbers from `scripts/v3-engine-sim.ts` and `scripts/v37-crew-arena.ts`. Crew Rangers change with the party's (pillar 17).

### P4. Controls, with intention
Feedback: the controls could use a refresh. The owner likes WASD or arrows for the camera and likes how keyboard-accessible things are.
Today: camera keys live in `src/view/camera.ts` (arrows pan; P owns that keyboard block, see `docs/v5-plan.md`); the HUD's keys are in `onKey` (`src/ui/hud.ts`): S sneak, E end turn, number keys select heroes, and more.
Pitch: one complete keymap. WASD collides with S (sneak) and E (end turn), so resolve it deliberately: camera on WASD and arrows, rotation, zoom, hero selection, actions, confirm and cancel. Add a key help overlay. Rebinding can wait unless cheap.

### P5. The camera after a hero is done
Feedback: a player moved next to a chest and opened it, then the camera jumped to another hero while they still wanted to take the items. The same happened after opening a door. Keep the pace, but not at the expense of usability.
Today: `autoAdvance()` in `src/ui/hud.ts` (~355) selects the next hero as soon as the selected one has moved and acted; the selection change moves the camera.
Pitch an elegant rule. Directions to weigh:
- Don't advance while the spent hero still has free things to do: loot to take, an open loot panel, an item to hand over, a room just revealed.
- Advance the selection without moving the camera until the player's next input.
- Show the next hero as a gentle nudge (Tab or a glow on the card) instead of a jump.
G's action cam (W1) must hand the camera back to wherever this rule leaves it.

### P6. Darkness and status effects that read at a glance
Feedback: the black ring for darkness isn't clear; poison, and status effects in general, need much more visual emphasis.
Today: dark rings under unlit heroes (`src/view/diorama.ts`, 16.2); the hero card has `dark` and `poisoned` classes (`src/ui/hud.ts` ~2534).
Split: P writes `docs/v5-status-visuals.md`: every status (dark, poisoned, downed with bleed count, carried, shackled, rooted/hamstrung, asleep/dozing, braced, guarding, on overwatch, veiled, noticed or hunting, and any new reaction stance). For each: what the player must read, its priority, the HUD treatment (card, figure tag, log), and the in-world ask. P builds the HUD side; G builds the in-world side in the new look (W1/W2). Add the spec's path to "View needs" in `docs/v5-plan.md` when written.

## Checks

- `npx tsc --noEmit`, `npx vitest run`, `npm run build`, and the browser checks that touch the change (`scripts/v40-hud-check.mjs`, `scripts/v40-lowgate-check.mjs`, others as relevant). Prefer DOM and state assertions; screenshots only when the look is the question.
- Balance changes: the sim (`POLICY=v41|prepared|careless`, `SCENARIO=l2`) and the crew arena before and after.
- Rules changes go in `docs/v3-spec.md` section 32 (V5.0), `docs/current-rules.md`, `docs/v3-changes.md` (player changelog), and `docs/decisions.md` (prefix "V5.0 (P)").
