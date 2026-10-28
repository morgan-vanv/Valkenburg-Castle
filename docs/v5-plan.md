# V5.0: two tracks, one release

V5.0 is built by two tracks running side by side, each led by its own session. Together they are the V5.0 update. Main keeps V4.x for play-tests until the owner ships V5.0.

| Track | Plan (source of truth) | Branch | Lead's first task |
| --- | --- | --- | --- |
| Graphics (G) | `docs/v5-graphics-plan.md` | `v5.0-gfx` | W0, the Great Hall slice |
| Play (P) | `docs/v5-play-plan.md` | `v5.0-play` | Quick wins and the bug, then a pitch for the design items |

`v5.0` is the integration branch. It holds these plans; tracks merge into it only at owner-approved checkpoints.

## Branch rules

- Work on your track branch (`v5.0-gfx` or `v5.0-play`), or on `v5.0-gfx-<name>` / `v5.0-play-<name>` worktree branches merged back into it.
- At the start of every session: `git fetch`, merge `origin/main` (V4.x fixes) and `origin/v5.0` into your track branch, then run the checks.
- Merging into `v5.0`: only after the owner approves a checkpoint. Merge the latest `v5.0` into your branch first, run every check, then merge into `v5.0` and add a line to the status board below. Whoever merges second resolves the conflicts.
- Never push to `main`. The owner decides when V5.0 ships; then `v5.0` merges into main.
- A session can push only if the repo is attached (`add_repo`, push access). The git proxy refuses tag pushes.

## Who owns what

| Area | Owner | Notes |
| --- | --- | --- |
| `src/view/**` (3D scene, figures, lights, walls, floors, effects, overlays in the scene) | G | P does not edit these, except as noted under shared files. |
| `src/view/camera.ts` | G | Except the keyboard block (key listeners and key-driven pan/rotate/zoom), which P owns for the controls refresh. Mark the block with comments. |
| In-world darkness and status effects (the dark ring today, auras, tints, particles) | G | Built to P's spec `docs/v5-status-visuals.md` (W1/W2). |
| The action cam (push-in on attacks, blows, shots, item use) | G | A module with one call, for example `dio.actionCam(actorId, targetId, ms)`. |
| `src/game/**`, `src/data/**` (rules, data, balance) | P | G does not change rules. |
| `src/ui/**` (HUD, roll panel, Lowgate, vendors, return report, coach, key handling) | P | |
| Who gets selected next and when the camera follows a hero (`autoAdvance` in hud.ts, follow in app.ts) | P | The action cam must hand the camera back to wherever P's rules left it. |
| `src/style.css` | P | G adds only its own new rules, in a block marked `/* V5.0 look */`. |
| Sim, crew arena, balance (`scripts/v3-engine-sim.ts`, `scripts/v37-crew-arena.ts`) | P | |
| Look shots (`scripts/v50-look-*.mjs`), `mockup/v5/` | G | |
| Spec and rules docs (`docs/v3-spec.md` section 32 for V5.0, `docs/current-rules.md`, `docs/v3-changes.md`) | P | G adds a short "V5.0 look" entry to `docs/v3-changes.md` at the end. |
| `docs/decisions.md` | Both | Append only; prefix entries "V5.0 (G)" or "V5.0 (P)". |

## Shared files (edit with care)

- `src/ui/app.ts`: G adds only action-cam calls at event playback, in blocks marked `// V5.0 G: action cam`. P owns everything else in it, including follow and selection.
- `src/ui/settings.ts`: both add settings, append only, one line each. G: Quality, Action camera, Tilt-shift. P: Auto end turn, controls.
- `src/view/diorama.ts`: G owns it. If P needs something shown in the scene (a new status, a new reaction marker), P uses the existing hooks (figure tags, say lines, the log) and adds the need to "View needs" below; G draws it in the new look.
- `src/game/types.ts`: P owns it. If a rules change alters an event G animates, note it under "View needs".
- Saves: P owns the save key. If a change breaks old saves, bump `vc.save.v39` and add a load migration, and log it.

## View needs (P → G, append only)

Each line: date, what the player must see, where it comes from in the state or events.

- 2026-10-27 · Darkness and status effects need strong in-world emphasis (owner feedback). Spec to come in `docs/v5-status-visuals.md` (P writes it first; G builds it in W1/W2).
- 2026-10-27 (evening) · **The status spec is written: `docs/v5-status-visuals.md`.** Every hero, monster and crew status with its priority, the HUD treatment and the "In world" ask (the dark as a drained, blue-shifted figure with a breathing shadow pulse on Level 3 instead of the black ring; poison as a green tint, veins and a drip on the tick; downed as a red pool that grows as the count falls; braced/guarding as gold rim light and links; veils as a violet shimmer; a hunting monster's red hex ring). State: `HeroInDelve` (`poisoned`, `status`/`bleed`, `carrying`, `rooted`, `webbed`, `grabbedBy`, `dreaded`, `dozing`, `braced`, `guarding`, `ward`, `overwatch`, `veil`), `Monster` (`awareness`, `searchRounds`, `feared`, `stuck`, `holding`, `poisoned`), crew members likewise; darkness from `visibility.lit` and `lightTierAt`. Owner gate: the pitch (P6) before building.
- 2026-10-27 (evening) · Request: the figure-tag content functions (`heroTag`, `monsterTag`, `venomMark`, `bleedMark`, `pipsHtml`) in `src/view/diorama.ts` could move to a P-owned `src/ui/tags.ts` so P can build the tag side of the spec without touching the diorama. G's call; P specs the content either way.
- 2026-10-28 · **New event `blocked` { id, attacker, from, to }** (spec 32.10, the shield block): the figure took the hit on its shield. Ask: a shield flash on the figure (gold, the brace colour) at the moment of the hit; the engine's say line and a clang play already. Heroes with the forge shield and crew Sellswords.
- 2026-10-27 (evening) · Spec 32.5 auto end turn and 32.1 (a jump keeps the action) change nothing G animates. Spec 32.4: the roll panel's `.dl-roll-ocline` is gone (no in-world effect).
- 2026-10-28 (G) · Answered: the status spec's in-world side is built in `src/view/look/status.ts` (dark, Gloam pulse on L3, poison, downed pool, hunting ring, braced, veiled, feared); the tag content moved to `src/ui/tags.ts` (P's); `blocked` draws a gold shield flash on the figure.

## Owner gates

- G: the Great Hall (W0); the levels after W1 + W2; the figure lineup (W3); the dressed castle (W4).
- P: the pitch for reactions, the reward screen, the Ranger, controls, the camera after a hero is done, and status visuals; then each built item.
- Both: V5.0 ships to main.

## Rate limit

Both tracks share the owner's rate limit. Each lead works mostly alone, with at most one builder at a time. Commit and push at every milestone; nothing important should live only in a conversation.

## Status board (append only)

| Date | Track | Branch @ commit | What landed | Next |
| --- | --- | --- | --- | --- |
| 2026-10-27 | — | `v5.0` @ plans | V5.0 plans: graphics, play, this file | G: W0 · P: quick wins + pitch |
| 2026-10-27 (evening) | P | `v5.0-play` @ B1–B5 + spec + pitch | Spec 32.1–32.5 (a jump keeps the action; the shop fills the cart; E confirms; the thicker bar; auto end turn), `docs/v5-status-visuals.md`, damage by class in the sim and the arena, the pitch https://claude.ai/artifact/TNGjrZ54oitgRP4fe2B6iA | Owner answers the pitch; then P5, P4, P6 (HUD side), P3, P1, P2 in that order. Not merged into `v5.0` yet |
| 2026-10-28 | P | `v5.0-play` @ spec 32.6–32.11 | The owner's answers built: the flow on one test (32.6), items between people (32.7), controls (32.8), the Ranger's "it saw you draw" (32.9), the shield block (32.10), the return tally (32.11); reactions round two in ideas-later; new event `blocked` under View needs | Owner: P6's three questions; review and the `v5.0` checkpoint. Not merged into `v5.0` yet |
| 2026-10-27 | G | `v5.0-gfx` @ W0 | W0, the Great Hall slice: look modules under `src/view/look/` (post chain with sharp overlays, lights, quality, bevelled floors, brick walls on five line families, hall dressing, joint rig with Keven); camera 16/30 with pitch easing; figures scaled to 1.35, walls 2.3; Quality setting (`quality`, view reads it; P adds the menu row); `scripts/v50-look-shots.mjs`; one marked line in app.ts (`DELVE_DISTANCE` from camera.ts). Checks green on Low. | Owner reviews the hall; then W1 (docs/agents/v50-w1-camera.md) and W2 (v50-w2-architecture.md) |
| 2026-10-27 | G | `v5.0` @ W0 merge | Owner approved the Great Hall; W0 merged into `v5.0` (tsc, vitest, build, HUD and Lowgate checks on Low all green). | G: W2 architecture → W3 figures → W1 camera and status visuals |
| 2026-10-28 | P | `v5.0` @ P checkpoint | Owner approved the play items; `v5.0-play` merged into `v5.0` after merging G's W0 (settings.ts resolved append-only: `autoEndTurn` + `quality`): spec 32.1–32.13 (the five fixes, the flow, items, controls, the Ranger, the shield block, the return tally, status HUD, the balance pass). tsc, 595 tests, build, the HUD and Lowgate checks green on the merged tree | G: W1/W2 (the status spec's in-world side; the `blocked` event); P: the Ferrymen's four, player feedback |
| 2026-10-28 | G | `v5.0-gfx` @ W1+W2+W3 pass 1 | W2: brick walls on every level (rock columns in caves), the cutaway on at the plinth, portcullis, standard materials everywhere. W3 pass 1: the whole cast on the rig (Dragon still V3), shoot/cast/use clips, torches in hand. W1: action cam (`look/actioncam.ts`, settings `actionCamera`, `tiltShift`), tilt-shift focus follows the party, in-world statuses (`look/status.ts`) per P's spec. Tag content moved to `src/ui/tags.ts` for P. Checks green. | Owner reviews the levels, the lineup and the statuses; P adds the menu rows (Quality, Action camera, Tilt-shift) and retires "Lower walls"; G: W4 dressing, the Dragon's rig, W5 |
| 2026-10-28 | G | `v5.0` @ W1–W3 merge | Owner approved the levels, the lineup and the statuses; W1 + W2 + W3 pass 1 merged into `v5.0` (checks green on the merged tree). | G: W4 dressing, the Dragon's rig, W5 switch-over · P: the three look menu rows |
| 2026-10-28 | G | `v5.0-gfx` @ W4+W5 | W4: every room dressed (recipes per room, ten new kinds; face-hung pieces go with the cutaway). W3 pass 2: the Dragon on the rig, awake and asleep. W5: the V3 look code retired (thin walls, merged figures, `FIGURE_SCALE`), the changelog entry, fire and room tints toned. Checks green. | Owner review of the dressed castle; P: the three look menu rows and retiring "Lower walls"; then `v5.0` → main when the owner says |
| 2026-10-28 | G | `v5.0-gfx` @ owner feedback 1 | Owner's local play-test: the haze thins when zoomed out (the board no longer goes black), the tilt band opens with distance, the action cam eases slower and the blow waits for it. Two items routed to P: the free-swing caption that lingers (hud.ts captionStart on an enemy roll in the player's phase) and the Walk/Sneak switch's clipping Shift tip. | W4/W5 + this → `v5.0` checkpoint |
