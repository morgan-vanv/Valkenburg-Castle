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
