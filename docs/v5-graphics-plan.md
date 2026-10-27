# V5.0 first push: the in-delve graphics overhaul

Owner-approved direction, 2026-10-27. This file is the source of truth for the V5.0 graphics track (G). V5.0 has a second track running beside it, the play track (P, `docs/v5-play-plan.md`); `docs/v5-plan.md` says who owns which files and how the tracks merge. The rules do not change here.

- Study (keep, read for the reasoning): "In-Delve Graphics Study" https://claude.ai/artifact/XUzRBsKB8pif7czKHRtHWn
- Scale Lab (interactive, the look's reference implementation): https://claude.ai/artifact/CFm7dkSH2DQGdZRJSi4VuL, source in `mockup/v5/scale-lab.html`
- Reference images and before shots: `mockup/v5/` (owner's references `ref-1..3`, the live game today, the lab's four presets)

## Owner decisions (27 Oct)

| Topic | Decision |
| --- | --- |
| Look | For the King 1's flat-shaded low-poly figurines (chunky, big heads, gear and bedrolls on the model). Not FTK2's smoother plastic look. |
| Scale | Hero about 1.35 hexes tall (today 2.0), head a third of the height (today a fifth), walls about 2.3 (today 2.6). |
| Camera | Default distance **16** (today 19), field of view **30°** (today 40°). Free rotation and free zoom stay. No separate tactical/planning view. |
| Action cam | Pushes in on **every** attack, blow, shot and item use, and on enemy moves (extends today's follow). |
| Effects | Tilt-shift is in (the owner likes it), with bloom, warm light and a vignette. |
| Walls | Flat brick walls as in the lab, not thin panels along tile edges. |
| Rooms | Dressed with props, carried over to the real castle. |
| Art | Claude builds everything in code for now (no art files, no model packs). Proper artists may take a pass later if the game becomes a real project, so leave a seam for their models. |
| Branch | All graphics work on `v5.0-gfx` (from `v5.0`), workstream branches `v5.0-gfx-*`; merge into `v5.0` only at owner-approved checkpoints (`docs/v5-plan.md`). Main keeps V4.x for play-tests. No preview toggle on the live site. |
| Scope | Graphics only. Touch mechanics and rules as little as possible: no changes to `src/game`, saves (`vc.save.v39`) or the engine contract (`types.ts`, `api.ts`, `hex.ts`) unless a view need truly requires it, and then logged. |

## The renderer today (audit at 04eb639; main 3303949 only touched diorama.ts and fixtures.ts lightly)

| What | Today | Where |
| --- | --- | --- |
| Hex | size 1 (centre to corner), pointy-top, `x = √3(q + r/2)`, `z = 1.5r` | `src/view/world.ts`, `src/game/hex.ts` |
| Hero | 2.0 tall, head 1/5; monsters scaled relative (`FIGURE_SCALE`) | `unit.ts`, `figures.ts` |
| Walls | 2.6 tall thin panels with pale caps; in the rules a wall is a whole hex (`TileKind 'wall'`) | `level.ts`, `types.ts` |
| Camera | hand-written rig: distance 19 (delve), zoom 7..90, pitch 0.92 rad, FOV 40, yaw snaps by 60°, smooth follow | `camera.ts` |
| Follow | `dio.setFollow(id)` on enemy moves (`app.ts` ~533) and during the castle's turn (~840) | `app.ts`, `diorama.ts` |
| Figures | primitives merged into one vertex-coloured mesh per model, Lambert; no skeleton | `figures.ts` (ModelKey: 9 hero classes incl. mage, rats, orc, spider, cutpurse, berserker, gloam, archer, captain, ghoul, Lantern Sisters x4, prisoner, dragon, dragonSleep; crews = `rival-<crew>-<class>` in crew colours) |
| Animation | tweens on whole figures (`AnimClock`, speed 0.5..3, hit-stop) | `anim.ts`, `diorama.ts` |
| Lights | ambient + hemisphere + 2 directional; pool of `MAX_LIGHTS` 12 point lights moved to the nearest sources; fixed lights baked into floor colour | `diorama.ts` |
| Shadows, post | none | |
| Fog of war | `onBeforeCompile` patch on every material, `aFog` instance attribute or `uFog` uniform | `fog.ts` |
| Props | rules props by `PropKind` (table, bench, bunk, barrel, crate, anvil, cage, bones, rock, shelf, forge, winch, statue, rack, stalagmite); furniture and fixtures | `furniture.ts`, `fixtures.ts`, `props.ts` |
| Levels | L1 1,033 hexes (~45 x 32), 13 rooms; L2 953, 12 rooms; L3 765, 8 rooms; levels stacked `LEVEL_GAP` 9 apart | `src/data/castle/` |
| Build | one ~1.3 MB JS chunk, no art files | |

Readouts at 16:9 (from the lab): today 14.2 hexes across, hero 9% of screen height. At the V5.0 default (distance 16, FOV 30) the view is about 8.8 hexes across.

## The look recipe (from the Scale Lab; tune in the real game)

- **Renderer**: stay on `WebGLRenderer` (WebGPU is still experimental in three.js and does not run `onBeforeCompile`, which `fog.ts` needs). three's own `EffectComposer`; no new dependency. three in the repo is r186 (the lab used r170 from a CDN): check shadow-map types and post-processing imports against r186.
- **Tone**: `ACESFilmicToneMapping`, exposure about 1.3, `SRGBColorSpace`.
- **Fill light**: ambient `0x5a4f78` 1.0, hemisphere sky `0xa89ad0` ground `0x3a2418` 1.7, a warm key directional `0xffd6a8` 1.6 from the camera side. Physical light units: ambient and hemisphere need roughly π times the old legacy values or the scene goes black.
- **Point lights**: torches ~9, brazier ~14, candles ~3, decay 1.4, distance 5..10. Keep the 12-light pool; one shadow-casting light at most (512 map, PCF, bias −0.004), placed at the nearest strong source to the camera target. Blob shadows under figures when shadows are off.
- **Materials**: `MeshStandardMaterial`, `flatShading: true`, roughness ~0.82 (stone, wood), ~0.3 with metalness ~0.6 for gold and steel. Flat colours, no textures; per-instance colour jitter for variety.
- **Post chain**: RenderPass → UnrealBloom (strength 0.55, radius 0.5, threshold 0.82) → tilt-shift (two separable 5-tap gaussian passes at amount 2.2, then two at 1.0; focus band at screen centre, half-width 0.2, ramp 0.32) → OutputPass → grade (warm multiply 1.04/0.99/0.94 and a soft vignette to 0.72). Markers, rings, path dots, tags and labels must stay sharp: draw overlays after the blur (a second scene rendered after the composer, or HTML), never through it.
- **Haze**: `FogExp2` `0x1a1020`, density ~0.032. Check it does not fight the fog-of-war shader.
- **Floors**: one `InstancedMesh` per level of hex prisms (`CylinderGeometry(0.935, 0.975, 0.26, 6)`, already pointy-top), top at y 0 with ±0.025 jitter, tiny tilt jitter, colour per room material/tint with ±15% jitter, a dark under-plane showing through the gaps. Occasional crack decals. Set `frustumCulled = false` on big instanced meshes (or compute their bounds).
- **Walls**: bricks 0.82 x 0.34 in running bond, depth 0.5, colour jitter, a dark mortar core, stone pillars (8-sided) at corners and door jambs, a lintel over doors.
- **Figures (lab stand-ins)**: legs 38% of the body under the head, a six-sided tapered torso, box arms, an icosahedron head (detail 1), dot eyes, hats by class (crown, hood, wizard hat, horned helm), backpack and bedroll on the back, weapons in the right hand, shield on the left arm. Idle breathing via a 1% vertical scale wave.
- **Lab bugs to avoid**: `parent.add(x)` returns the parent, so `world.add(mesh).scale.z = 0.1` squashes the whole world; set scale on the child first.

## Rules for the hard parts

### Flat walls on hex walls
In the rules a wall is a whole hex. Draw walls as straight brick runs: group wall hexes into straight lines along the three hex axes and draw one slab through their centres, thick enough to cover the hex; a run along the map's vertical (a zigzag of hexes) is drawn straight with the notches filled with stone. Put pillars at run ends, corners and junctions. Wall hexes away from any floor (deep rock) are drawn as dark rock mass, not brick. Cracked walls, rubble, built walls (unbreakable), the sealed door, doors, stairs, pits, railings, raised floors, bridges and the lift need matching pieces. What blocks movement must still read as blocking at a glance, and no walkable hex may be covered.

### Walls and free rotation
The camera rotates freely and sits lower, so walls between the camera and the party will hide things. Today's cutaway (`settings.cutaway`, off by default) lowers walls near the focus; with the new walls it likely needs to be on by default and smarter (cut walls on the camera's side of the focus to a stub, keep the far side full height). The existing see-through hero silhouettes stay.

### The action cam (owner: every blow, attack, shot and item use)
- Fires on every attack, blow, shot, spell and item use, the party's and the castle's, and keeps following enemy moves as today.
- Pushes in (about 30% closer and slightly lower) toward the midpoint of actor and target, holds while the existing animation plays, then eases back to exactly where the player had the camera (target, yaw, pitch, distance).
- Never adds time (pillar 2): it fits inside the animation the event already plays; at the fastest speed setting it is skipped. Respect `reduceShake`. Add an "Action camera" setting (on by default) so a player can turn it off.
- If the player moves the camera during it, the player wins.

### Figures: code-built, on a joint rig, with an artist seam
- Build each figure from parts parented to joints: root, hips, torso, head, arm L/R, hand L/R, leg L/R, back. Each joint is an `Object3D`; parts are flat-shaded meshes (merge per joint to keep draw calls low). No skinning needed.
- Gear hangs on joints: weapons in the right hand, shields on the left arm, packs and bedrolls on the back, lanterns and torches in a hand.
- Animation = keyframed joint rotations in code: idle, walk, sneak (crouched), strike, shoot, cast, throw/use item, hit, downed, carried and carrying, plus the Dragon's own. Drive them from the events the view already plays; keep `AnimClock` timing and hit-stop.
- Figure list: Keven and the 8 classes (with the mage key), rats, orc, spider, cutpurse, berserker, gloam, archer, captain, ghoul, the Lantern Sisters, crews in crew colours (reuse class figures as today), the prisoner, the Dragon awake and asleep.
- Artist seam: a single figure interface (named joints + named clips + height and footprint radius) that both the code-built figures and a future glTF model implement, so models can be swapped without touching game code.

### Dressing that never lies about the rules
Dressing is decoration only. Rules props (`PropKind`) keep their meaning and look. Decorative props live in a view-side table keyed by room id (for example `src/view/look/dressing.ts`), by room kind (library shelves, kitchen barrels and hearth, chapel pews and candles, barracks bunks) plus a few hand-placed set pieces, and sit against walls, on wall plinths or in hex corners. Nothing decorative may look like it blocks a walkable hex. Dressing data stays out of `src/data/castle` unless the owner agrees.

## Risks to watch

- The castle was laid out for today's scale; rooms may read empty or cramped until dressed. Prove one room first.
- Fog of war: every new material and the jointed figures must go through `fog.ts`; test each material type.
- Performance: one shadowed light only; post-processing at pixel ratio 2 is costly on integrated GPUs. Add a Quality setting (Low: no shadow, no bloom, no tilt-shift, pixel ratio 1). The headless checks in `scripts/` run on software rendering and should use Low.
- `diorama.ts` (~4,000 lines) is the hot spot. Put new look code in new modules (for example `src/view/look/`: `post.ts`, `walls.ts`, `floors.ts`, `rig.ts`, `clips.ts`, `dressing.ts`, `actioncam.ts`) and keep diorama.ts edits small, so merges with main and the play track stay easy.
- `v5.0-gfx` will drift from main and from the play track. Merge `origin/main` and `origin/v5.0` into `v5.0-gfx` at the start of each session.

## Workstreams

| # | Workstream | What it covers | Needs first | Who |
| --- | --- | --- | --- | --- |
| W0 | Great Hall slice | New look modules split out; scale and camera numbers; post chain; tone and fill light; floors and flat walls for the Great Hall (L1 `hall`, label at q13 r15) and its neighbours; a few dressing props; one rigged hero (Keven) with idle and walk; Quality setting; a shot script for fixed views of named rooms | — | Lead, one session |
| W1 | Camera and post | Default 16 / FOV 30 / pitch easing with zoom; action cam as one module (for example `dio.actionCam(actorId, targetId, ms)`, called from app.ts in blocks marked `// V5.0 G: action cam`); tilt-shift, bloom and Action camera settings; overlays drawn sharp after post; in-world darkness and status effects per P's `docs/v5-status-visuals.md` (owner feedback: the dark ring isn't clear, poison and other statuses need much more emphasis) | W0 | Builder |
| W2 | Architecture | Floors and flat walls on all three levels; cracked, built and rubble walls; doors, sealed door, stairs, pits, railings, raised floors, bridges, the lift; the cutaway; fixed lights and braziers in the new style | W0 | Builder |
| W3 | Figures | Joint rig, all heroes and gear, monsters, crews, prisoner, Dragon; the clip set; the artist seam; facing wedges, rings and tags re-fitted to the new heights | W0 | Builder |
| W4 | Dressing | Prop library and per-room dressing for all 33 rooms | W2 | Builder |
| W5 | Switch-over | Retire the old look code, update checks and docs, merge `v5.0` to main when the owner says | all | Lead |

Run W0 alone. The play track runs at the same time and shares the owner's rate limit, so run at most one builder at a time beside the lead, in `git worktree`s under `/root/wt/<name>` as in V4.x. The lead writes a brief per workstream in `docs/agents/v50-<name>.md` and merges into `v5.0-gfx`.

Boundaries with the play track (`docs/v5-plan.md` has the full table):
- P owns who gets selected next and when the camera follows a hero (`autoAdvance` in hud.ts, follow in app.ts). The action cam hands the camera back to wherever those rules leave it.
- P owns the keyboard block of `camera.ts` (key listeners and key-driven pan, rotate and zoom) for the controls refresh; G owns the rest of the rig.
- `src/ui/settings.ts` is append-only for both; G adds Quality, Action camera and Tilt-shift.
- G's CSS goes in a block marked `/* V5.0 look */` in `src/style.css`; P owns the rest of the HUD styles.
- Anything P adds that must show in the scene (new statuses, reaction stances) is listed under "View needs" in `docs/v5-plan.md`; check it at the start of each session.

## Checks and review

- `npx tsc --noEmit` and `npx vitest run` must stay green; the rules are untouched, so they should not change.
- A new script (for example `scripts/v50-look-shots.mjs`) loads a delve, places the party in a named room and saves fixed camera shots (default, close, zoomed out, rotated). Here the look is the question, so screenshots are the deliverable (owner's testing-cost rule allows it). Headless Chromium on SwiftShader is slow: raise screenshot timeouts to ~3 minutes and use the Quality setting's Low for non-look checks.
- The existing HUD and Lowgate checks keep passing.
- Owner review points: after W0 (the Great Hall), after W1 + W2 (walk the levels), after W3 (figure lineup), after W4 (dressed castle). The owner reviews from screenshots and by running the branch locally; GitHub Pages keeps serving main. A private artifact build of the branch may also work (static files, three bundled); try it once and note the result.

## Rate-limit-safe sessions

Every session ends at a commit on its branch, a line on the status board in `docs/v5-plan.md`, a short report (what changed, what's next, screenshots), and the project briefing updated if the direction moved. Nothing important lives only in a conversation.
