# V3 presentation progress

Status: brief complete. Typecheck, build and tests (93) pass. 0 console errors in all screenshot tours and the stress bot.

## Done
- src/view: Diorama (hex prisms with room tint and jitter, raised floor, walls with pale tops and a camera-side cutaway shader, rock rim, pillars, rubble, swinging doors with padlocks, pits with glow, stairs, exit gateposts, braziers with fire; fog with lit / visible-unlit / explored bands; point lights for the lantern sized by brightness, torches and lit braziers; figures for 4 classes, 5 monsters, the Gloam, Lantern Sisters and prisoner; chests with lids, coins, sacks, heirloom, spotted traps, ropes; walk/sneak/target/ally highlights, path dots, noise ripple preview, intent badges and dashed target lines, HP pips, status tags, floaters, room labels; picking; event playback with lunge/recoil, hit-stop, shake, door swing, chest lid, noise wave, blast flash, topple, stairs fade).
- src/view/camera.ts: orbit (right-drag), snap rotate 60° ([ ] or buttons), pan (middle drag, arrows), zoom, follow, shake.
- src/ui/app.ts: state, engine.apply, autosave `vc.save.v3`, title with Continue, event player, Space to hurry, speed ½×–4× plus Instant, action sounds, auto-select the next hero when one is spent.
- src/ui/hud.ts: light meter (stage edges probed from engine.brightness; max = highest light this delve), round, contract goal and status, level buttons, hero cards, action bar from engine.actions with hotkeys, target picker, roll preview (slots, % each, modifiers, Focus +/−, outcome per hit count with binomial odds, noise, light), roll animation, tooltips, rival panel, menu (speed, reduce shake, keys, abandon with confirm, title), unexplored-level notice.
- src/ui/screens.ts: title, camp with 7 stations, prepare delve (contract, 1–4 fit heroes, packs, entrance, Hobart warning, remembered last loadout), summary, game over.
- src/audio/sfx.ts: V2 synth plus fire, torch, chest, levelup, web, hurt and the Gloam drone.
- src/main.ts: real engine from src/game/index.ts; `?fixture=1` uses src/view/fixtures.ts (stand-in engine on testCastle).
- Scripts: v3-shot.mjs (tour `full` or `fixture`), v3-shot-scenes.mjs, v3-shot-scenes2.mjs, v3-shot-clicks.mjs (real mouse/keys, autosave resume), v3-stress.mjs (random bot through the UI at instant speed).

## Next (nice to have)
- Web visuals on webbed heroes, a fuse marker for placed charges, Gloam fog particles.
- Touch/mobile pass.

## Contract requests
- None. The UI no longer assumes LIGHT_MAX or brightness thresholds; it probes engine.brightness.

## Known issues
- V2 code in src/render, src/engine and src/data/maps is no longer imported by the presentation; the lead can delete it.
- Vite warns about bundle size > 500 kB (three.js); harmless.
