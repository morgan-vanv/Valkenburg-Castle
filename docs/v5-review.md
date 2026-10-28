# V5.0 review (session three, 2026-10-28)

Reviewed: `v5.0` at 1244003 (P's ship checkpoint 7cec9d1 merged), against `main` 3303949. The brief: docs/v5-ship.md "The reviewer's brief"; the owner's additions (the four play-test fixes, saves through the real UI, spec 32.14–32.17's seams, the shared files, the threshold as a new player). No game code was changed; this file is the only commit.

**Gate, re-run on the merged tree:** `tsc` clean · 606 tests green · `npm run build` fine · `v40-hud-check`, `v40-lowgate-check`, `v50-threshold-check` all pass on Low with 0 page errors · `SEED=1 POLICY=prepared SCENARIO=l2` (4 delves) runs with **0 refused commands**.

**Verdict: ship, after two one-line fixes (findings 1 and 2) and one look the owner must take himself (finding 3).** Nothing breaks an old save; both tracks survived the merge; the seams are small and all on the view side of a rule.

**Resolution (2026-10-28, same day, owner's call):** findings 1, 2, 5, 6, 8 and 9 fixed on `v5.0` by the review session (see the "Fixed" notes below and docs/v3-changes.md); 3 is to be looked at on the live site after the ship; 4 and 7 accepted (7 is now stated in docs/current-rules.md 13.6); 10 moot (no revert planned). The owner waived the local play-test (ship step 5).

## Findings, by severity

### 1. The shield block never reaches the diorama: G's gold flash is dead code · **P** · `src/ui/app.ts:720` · **Fixed:** the event is forwarded and joins `enemyFocus`.

`case 'blocked':` in `playEvents` plays a clang and `continue`s without `await this.dio.playEvent(e)`. The diorama's handler (`src/view/diorama.ts:2884`, G W1: the figure faces the attacker, flashes gold, floats "Blocked · 5 → 1") is therefore never called. P wrote the case before G landed the handler (the comment still says "a shield flash is under View needs") and neither saw the other. Every other event the diorama handles is forwarded (checked by script: `blocked` is the only one).

Repro: `scripts/v50-review-check.mjs` spies on `dio.playEvent`; a shield-block question answered Block gives the engine's `blocked` + `hit` events, the diorama sees only `hit`. The changelog's "a blocked hit flashes the shield" is false on the ship candidate.

Fix: `await this.dio.playEvent(e);` before the `continue` (and drop the stale comment). Optional: add `blocked` to `enemyFocus` so the world-phase camera treats it like the hit it precedes (the adjacent `hit` already pans, so this is cosmetic).

### 2. The "unlit" tag chip never shows: `heroTag` is never given `unlit` · **G** · `src/view/diorama.ts:1419` · **Fixed:** passed from `darkHeroes`; tags refresh when the dark set changes.

`heroTag(h, max, carried)` is called without the fourth argument, so the chip P built in `src/ui/tags.ts` (spec 32.12: "unlit · the dark hunts", red, on Level 3) never appears on any figure. The diorama already has the answer in `this.darkHeroes` (set from `engine.heroLit`). Still owed per docs/v5-ship.md step 1 and the status board.

Repro: Level 3, Keven unlit with the Gloam about: the card is marked `dark`, the figure goes cold, the pulse breathes under him, the HUD's Gloam line shows, the log says "The dark closes on Keven." — and no `.tag-unlit` exists in the DOM.

Fix: `heroTag(h, hero?.maxHp ?? 10, carriers.has(h.heroId), this.darkHeroes.has(h.heroId))`.

### 3. High quality: the gate's light blooms to a white-out on the first screen of a delve · **G, owner to confirm locally** · `src/view/look/lights.ts` (daylight 5), `post.ts` (bloom threshold)

In the headless High shots the main gate (the "Way out · you came in here" hex and the two hexes beside it) renders as a solid white disc: the party standing there is a silhouette in glare, and Keven lighting his torch on the gate hex disappears entirely (shots `l1-torch-lit-high`, `actioncam-high` in this session). The Great Hall under three torches at High reads beautifully (figures, rings, arrows all legible), so it is the entrance's `daylight` source (intensity 5) under bloom, not the look in general. SwiftShader may overdo it; the owner's local play this afternoon did not mention it, which is why this is "confirm", not "fix". If it is real: it is the first thing every new player sees.

### 4. Performance: the Great Hall at High is 1.52 M triangles, just over the ~1.5 M flag · **G** · numbers below

456 draw calls (fine). Low is a quarter of that. Nothing to do unless the owner's framerate feel says so; the hall is the heaviest room (dressing + brick runs + three torches casting a shadow).

### 5. Two stale strings after spec 32.10 and 32.15 · **P** · **Fixed.**

- `src/ui/hud.ts:2825`: the Stairs/Lift button's tip says "· 1 movement"; the crossing now costs 0 (`STAIR_CROSS_COST`). Say "free" or drop the cost.
- `src/game/ai.ts:388`: the shield block card's Block line reads "1 Focus (3 left): the hit does 1." with the Focus *before* spending (a hero at 3 who blocks ends at 2). Either `h.focus - SHIELD_BLOCK_FOCUS` or "(you have 3)".

### 6. The first-delve coach mark covers the Gloam warning · **P** · `src/style.css:2924` vs `:2927` · **Fixed:** the line steps up while a coach mark shows.

`.dl-gloam` sits at bottom 170 px centred; coach mark 1 ("Click a lit hex to move Keven") is anchored over the hotbar at the same spot and z-index 35. A first-delve party that falls to the Hollow unlit sees the coach mark, not "The dark here is awake. Stand in the light." Rare; move the Gloam line up when a coach mark is showing, or hide the coach mark on Level 3.

### 7. The peek writes the far landing into castle memory · **P, design question, not a bug** · `visibility()`

Standing on the tower stair added 26 Level 2 hexes to `delve.explored`: the Level 2 tab lights up as found before anyone has set foot there, and the return report's "Left behind" listed "A chest in the guard post is still shut" from a peek alone. Defensible (you did see it); say so in `docs/current-rules.md` 5.1 if intended, or keep peeked hexes in `visible` only.

### 8. Statuses the card marks and the figure doesn't · **G, accepted scope** · `src/view/look/status.ts` · **Built** (owner): guard link, overwatch ring, ward rim, held/rooted/webbed inner ring, dozing dim; no ring on a downed hostile member.

Built in world: dark (+ the L3 pulse), poison, downed pool, hunting ring (monsters, hostile crew), braced rim, veiled, feared. On the card and tag but not on the figure: guarding/guarded (the gold link), overwatch (the drawn-bow pose), warded, rooted/webbed/held (the hex marks), dozing. These are the status spec's priority-2 asks the owner reviewed at W1; listed so the gap is known, not as a defect. The reverse (figure marks the card lacks) does not occur. The hostile-crew red ring is also drawn under a crew member who is downed (`crew.stance === 'hostile'` only); harmless.

### 9. A shield-block answer is remembered per round and enemy · **P, note** · `src/game/react.ts:38` · **Fixed:** the key carries the damage; test in react.test.ts.

The reaction memo key is `round:kind:hero:enemy`; a second hit from the same enemy on the same hero in one world phase (two swings, a free swing then an attack) reuses the first answer without asking, whatever the new damage. Fine for the hidden swing and overwatch; for the block it means "Take it" on a 2 silently applies to a 6 a moment later. Add `q.damage` to the key, or accept.

### 10. Revert risk · **P, note**

V4.1 saves load on V5.0 (below). The other way: a V5.0 save paused at a `shieldBlock` question (`delve.pending.question.kind`) would not resume on main 3303949 if V5.0 were reverted; `letBy` and `reactions.shieldBlock` are ignored there harmlessly. Worth a sentence in docs/v5-ship.md's revert note.

## The owner's four play-test fixes, confirmed

| Fix | Verified by | Result |
| --- | --- | --- |
| G: the haze thins with distance | `scene.fog.density` read after two real frames at distances 16/26/40/60/90 | 0.026 → 0.0152 → 0.0106 → 0.0084 → 0.0073 (eases toward `far` 0.006). Fixed. |
| G: the action cam eases slower and the blow waits a beat | `ACTION_CAM` = ease 4.5, settleMs 320; `pushCam` awaits the settle; a hero's attack at speed 1 pushed the rig 16 → 11.2 and restored to 16 exactly | Fixed in code and seen in play (`actioncam-high` shot, held mid-push). Could not judge the feel headless. |
| P: captions time out | an enemy roll played in the player's phase at speed 1; the caption went by itself | gone after 3,223 ms (3.2 s); `armCaption` 1.6 s at Instant. Fixed. |
| P: the Shift badge beside the pill | DOM geometry of `.dl-who` / `.dl-switch` / `.dl-switch-hint` | column 176 px, badge right of the pill with 6 px gap, inside the column, not clipped. Fixed. |

## Saves (check 4), through the real UI

`scripts/v50-review-saves.mjs` (this session; main served from a worktree on :4186, v5.0 on :4185): three saves written by the V4.1 app itself under `vc.save.v39`, each loaded on v5.0 by the title screen's Continue:

- A camp save (a hire, a torch): loads (stage camp, gold and roster intact), a delve starts from it and a hero moves. 0 page errors.
- Mid-delve, the Lantern Sisters on the map, round 2: loads with the crew and its three members drawn, the HUD up; a move and a full castle turn play; round 3. 0 page errors.
- Paused at an overwatch question (`delve.pending`): the castle's turn replays to the question and the same card shows; key 1 answers; the turn plays on. 0 page errors.
- A v5.0 save mid-reaction survives a reload (`v40-hud-check`, the reactions section).

No key bump or migration needed. `vc.settings` from V4.1 (no `quality`/`actionCamera`/`tiltShift`/`autoEndTurn`, `cutaway: true`) loads with quality high, action cam on, tilt-shift on, auto end turn on; `cutaway` kept and ignored (`dio.cutaway` false, `LOOK_CUTAWAY` on).

## Spec 32.14–32.17 seams (the owner's list)

- **32.15 the threshold.** The eye mark and the log line appear as the hero stops on the stairs ("Down the stairs (the Crossing): orc hunting, 2 hexes from the foot; orc searching, 2 hexes from the foot. They can see you on the stairs too; a hunter will climb."), once in the chronicle. The peeked hexes come back under Level 2 keys (26). The diorama draws nothing of the far landing while Level 1 is shown (no figures, no ghost): below the stair the board is black. The crossing is one move (cost 2 to the hex beyond the far step), the hero lands with the action ready, the selection hands over to the hero still upstairs and the view comes back to Level 1. After a castle turn the patrol at the foot, now hunting, had climbed to the stair hex and struck Keven from behind: hunters climb as specified. The bounce (follow across, then back) cannot be judged headless at speed 0; at Instant it is a single cut.
- **32.16 the toll.** Empty pockets: `letBy` set, stance stays waiting, the engine's line plays once and no generic "waiting" line beside it (the app suppresses it). The Carrying tip says "never more than you carry (now nothing: empty pockets are let by…)". With 30 gold on them the Ferrymen demand 30; the crew card ("Pay 30 or they attack next turn") and the log agree. The crew card after the let-by shows plain "waiting" with no hint of the promise; a one-liner ("let you by once") on the stance card would carry the rule (P, nice to have).
- **32.10 / 32.9 / 32.1 clips.** Strike and hit clips fire from `lunge`/`recoil` on `hit`/`miss` (the diorama saw `faced, hit` for a hero's attack); the shoot clip is chosen by distance (> 2.2 world units) rather than by the weapon, so a Ranger's adjacent shot plays a swing: acceptable, note it. The Ranger's slot change (32.9) and the jump-as-move (32.1) change no event the view animates; a jump plays the `fell` tween with no clip. The `blocked` clip: finding 1. The block's gold (`0xffd060`, `1.0,0.75,0.2`) matches the braced rim colour family; the HUD's reaction card has no gold of its own.
- **32.17 settings.** Quality High/Low flips the shadow map and features live and saves; Action camera and Tilt-shift toggle `dio.actionCam.enabled` / `dio.tiltShift` live and save; "Lower walls" is gone from the menu. `settings.ts` DEFAULTS carries every key (`autoEndTurn`, `quality`, `actionCamera`, `tiltShift`, the retired `cutaway`).

## The merge (check 1)

Eight merges, the two tracks alternating. Shared files read as merged results: `settings.ts` (above); `app.ts` keeps P's `stayOn` hand-over (389–396, 931–938), the peek log line (398–402) and the flow, with G's two marked lines (`DEFAULT_DISTANCE` import and constant; the action cam is driven from the diorama, so no `// V5.0 G: action cam` blocks exist in app.ts — correct per decisions.md); `tags.ts` is P's content behind G's placement (finding 2); `style.css` has P's V5.0 blocks and no `/* V5.0 look */` block (G needed none); `decisions.md` carries both prefixes in order; `v3-changes.md` has the look entry and two play entries. Nothing was lost on either side.

## Docs vs code (check 6)

`docs/current-rules.md` matches the engine for 32.1, 32.7, 32.9, 32.10, 32.15 (cost 0, peek 3, hunters climb, crews don't peek), 32.16 (`min(carried, max(50, half))`, let by once) and the saves note. In `docs/v3-changes.md`, every sentence checked holds except "a blocked hit flashes the shield" (finding 1) and, by implication, the status spec's "unlit" chip (finding 2, not claimed in the changelog). `claude/game-state.md` matches the branches and hashes. `docs/v5-plan.md`'s status board closes with the ship line.

## Fresh eyes (check 7): three turns as a new player, and the threshold's warning

- The first screen (High): see finding 3; on Low the gate reads fine.
- The coach marks say what to do; the hotbar shows only what the hero can do; the tip on every button explains itself. The Walk/Sneak switch with its Shift badge reads at a glance.
- The Great Hall under torchlight at High is the game's best screen: figures, the hunting orc's red ring, the intent arrow and the selection ring all legible over the blur; nothing important sits under the tilt-shift band at the default distance.
- The level below the stairs is a black void while you stand on them, and the peek is words only (the eye mark's tip and one log line). It is enough warning in the owner's sense: you learn the mood, the kind and the distance of what waits, and that it can see you, before you commit, and the orc at the foot had indeed noticed the lit, walking hero the moment he stood on the step (the line already said "hunting"). Not a trapdoor: you can step back or hold the step. Not safe: a walking party with a torch is seen at once; only a sneaking, unlit hero gets a free look. What would make it better than enough: the far landing drawn (G's open item), and a sneak-first hint in the line when the party is lit ("they see your light").
- What the HUD and the figure say differently: the dark hero (card moon, cold figure, no tag chip: finding 2); the shield block (card and clang, no flash: finding 1). Everything else agrees.

## Numbers (check 5)

Default camera (distance 16), three heroes with lit torches, the room and a ring around it explored, read from `renderer.info` after `renderNow()` with `autoReset` off. Headless SwiftShader; shadows on at High.

| Scene | Quality | Draw calls | Triangles |
| --- | --- | --- | --- |
| Great Hall (L1) | Low | 226 | 303,842 |
| Great Hall (L1) | High | 456 | 1,525,454 |
| The lair (L3, the Dragon asleep) | Low | 174 | 54,434 |
| The lair (L3, the Dragon asleep) | High | 296 | 180,902 |

Flag: the hall at High is 1.7% over the ~1.5 M triangle line; draw calls are well under 800 everywhere.

## The bot (not re-run as a judge)

`SEED=1 POLICY=prepared SCENARIO=l2`, 4 delves (the gate): 0 refused commands; 0 done, 11 deaths; the deaths by room were L1 Tower stair 4, L2 Barracks 3. With 32.15 the landing fight has moved upstairs: hunters climb and the party meets them on the Level 1 step. That is the rule working, and consistent with docs/v5-difficulty.md's "the landing decides the delve"; whether holding the step feels like a choke or a queue is for the owner's play, not the bot.

## What I did not check

- The look on a real GPU (finding 3 hinges on it), framerate, and the action cam's and the bounce's feel: headless at speed 0 or 1 cannot say.
- The action cam on casts, throws and item use (only a hero's attack was driven); the Dragon's rig in motion; G's look shots of the dressed rooms (`v50-look-shots.mjs` was not re-run).
- A real walk from the gate to the tower stair and down into the guard's patrol: the stair scene placed the patrol at the foot by state. The guard's patrol path through the landing is still the owner's call after play.
- Touch and mobile (known gap); a GitHub Pages preview of `v5.0`.
- The 16-delve batches (per the owner); the crew arena.

## Scripts used

`scripts/v50-review-check.mjs` (the play-through: Level 1 torch, fight, shield block, the threshold, the toll, the return tally; Level 3 unlit with the Gloam; the four fixes; the settings rows; the renderer numbers) and `scripts/v50-review-saves.mjs` (V4.1 saves on v5.0). Both run against `npx vite preview --port 4185` (and main on 4186 for the saves). Committed to `scripts/` with the fixes.
