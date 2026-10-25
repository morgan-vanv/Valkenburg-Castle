# Decisions

A running log. Newest at the bottom.

- **2026-10-23** Static site on GitHub Pages, TypeScript and Vite. Keeps the demo free to host with no server to maintain.
- **2026-10-23** Rules engine kept separate from rendering. Lets us test the rules and try different visual directions independently.
- **2026-10-23** All randomness seeded. Runs can be replayed and bugs reproduced from a seed.
- **2026-10-23** One roguelite run is one campaign of several weeks. Closest to the 1980 siege structure; expeditions are the campaign's turns.
- **2026-10-23** The castle is generated once per campaign and fixed for that campaign, with the 1980 map as a classic seed. Keeps the feel of retaking one place while staying replayable.
- **2026-10-23** Multi-man squads fight alongside named heroes. It is the 1980 game's identity and what makes frontage matter.
- **2026-10-23** Desktop first with mouse and keyboard; UI kept touch-friendly to adapt later. Lets the camera and UI be designed without phone compromises.
- **2026-10-23** Demo economy tuned: goal 2,000 gold, outfitting 100, searches find something on 3–6, deeper levels add more to treasure rolls. The 1980 tables assume a 52-week siege; at 4 weeks a simple bot banked almost nothing.
- **2026-10-23** V2: one-shot run instead of a 4-week campaign; a new spacious two-level map instead of the 1980 transcription; doors, loot and carrying simplified (see docs/v2-changes.md). Play-testers found V1 claustrophobic and clunky; V1 is kept on the `v1-prototype` branch.

The full design lives in the Game Design Document: https://claude.ai/artifact/5p4XddApJVqAodPrEuEGzc
- **2026-10-24** V3: rebuilt as a turn-based extraction crawler (Dark and Darker premise, For the King 2 slot rolls, XCOM permadeath) on a new two-level hex castle; light is the clock, noise is spatial. The owner found the 1980-derived rules encumbering; see docs/v3-changes.md.
- **2026-10-24** V3 rounds are a player phase then a world phase, with no initiative order. Faster to read and play; enemy intents carry the information.
- **2026-10-24** V3 lantern is 40 rounds. With 60 a bot finished every contract with most of its light left.

The V3 Game Design Document: https://claude.ai/artifact/Q7766w5bBz11paXkw4YPf1
- **2026-10-24** Exploration reveals layout by line of sight from every step, lit or not; units still need light. The owner found long moves left the map full of holes.
- **2026-10-24** V3.1: three-level castle from the approved map proposal (pass 2); falls go straight down pit columns; the Dragon is the demo's final boss. The owner wanted verticality, asymmetry and terrain tactics.
- **2026-10-24** The Hollow's cave mouth is open from the start. Carrying the hoard the length of the Hollow is the cost; a locked-until-found shortcut wasn't worth the extra rules for the demo.
- **2026-10-24** Design pillar: visual clarity, with intention. Once seen, important things (stairs, objectives, interactables, edges) announce themselves and what you can do with them; markers never appear for unexplored hexes. Driven by play-test: the player couldn't find how to take stairs or why the heirloom wouldn't pick up.
- **2026-10-24** V3.2 line of sight is permissive: a hex is seen if a line to its center or to any corner (pulled 10% in) is clear, and solid hexes next to seen floor are seen too. The strict center-to-center line left holes beside pillars and walls (owner's screenshot).
- **2026-10-24** V3.2 dash: a hero who has moved and not acted may move again for their action. Acting first keeps a plain move; climb, jump and grapple still take the whole turn.
- **2026-10-24** V3.2 a Veil breaks on any attack or push the hero makes (including fireball and gust) or any action of noise 4+; Sleep and the sleep dart are silent and don't break it. Ward reduces monster and Gloam hits only, never falls, fire or breath.
- **2026-10-24** V3.2 `take` is never silent: an option that can't be done now is returned with a plain-words reason (`ActionOption.blocked`), the contract item is taken first, and the preview names exactly what will be taken.
- **2026-10-24** V3.2 the Burglar opens chests without spending the action. The spec's "takes and opens chests silently" added nothing to a take that was already free and silent, so the class got a real perk instead.
- **2026-10-24** Take stairs/lift is hotkey T and wins over Torch's T on that hex (no free letter left; torch is rare while standing on stairs).
- **2026-10-24** End turn asks once when any hero still has a move or action; a settings checkbox turns it off. Scripts turn it off through `vc.settings.noEndTurnAsk`.
- **2026-10-24** Interactable hover = ember ring; hazard (pit, trap) = red ring; floor = parchment. Tooltip form is "Thing · what you can do".
- **2026-10-24** Beacon colours by contract: recover gold, rescue green, slay red (diorama BEACON_COLOR and .beacon-tag CSS).
- **2026-10-24** Walls are 2.2 high (hero ≈ 2.6) so thin panels still read as walls; the cutaway keeps the party visible.
- **2026-10-24** Cave = room material rock, earth or bone; those walls stay thick. Water (the Drain) and bone-free built rooms get thin walls.
- **2026-10-24** Figures start facing the camera.
- **2026-10-24** Scale: option C (RuneScape) from the three-panel study; hero 2.0 units, natural proportions, walls 2.6. The owner picked it as good enough for now and wants to revisit.
- **2026-10-24** Scale direction C: a hero is 2.0 world units, walls 2.6, humanoids built parametrically (head 1/5, limb 0.07, shoulders 0.34, legs 0.44) and monsters scaled relative to the hero (unit.ts FIGURE_SCALE). The Dragon is unchanged. Delve camera 19.
- **2026-10-24** Shutter is hotkey L and wins over Light (brazier) and Oil's L for the lantern bearer; L also toggles the lantern when another hero is selected and has no L button (it's free and any-time).
- **2026-10-24** "Start shuttered" is a presentation option: the prepare screen remembers it and the app sends the free `shutter` action right after `startDelve` (no contract change).
- **2026-10-24** The Gloam's creeping darkness is drawn on visible unlit hexes within 2 of the light, not on every dark hex, so it reads as an edge.
- **2026-10-24** Known patrol routes are drawn as straight segments between waypoints (the engine's path between them isn't published); good enough for "where it walks".
- **2026-10-24** V3.3 "fear by depth": monsters awake by default with patrols; lantern 20 with a free shutter; sight per hero (lit: stage range; dark: 4/2/1 by level); the Gloam hunts any unlit hero in the Hollow with no grace; depth tiers; archer, captain, ghoul; the Sisters use the heroes' own kit. The owner found the castle too forgiving and wanted Level 3 to be frightening.
- **2026-10-25** V3.4 economy: start 120 gold, recruits 60 + 40 a level, opening tavern all level 1. The owner wants the first purse to force a choice (two hires, or one hire and cheap gear) so looting and replaying pay.
- **2026-10-25** HP carries over between delves and the infirmary heals 3 gold per HP; the revived-heroes-sit-out rule is dropped, since lost HP is now the cost of getting hurt (one mechanic instead of two).
- **2026-10-25** Far sight shows light sources, not the floor they light (daylight excepted), and sight in a castle light other than daylight is 4 minus depth; your own lantern still gives the stage range. The owner's unlit jump into the Hollow revealed too much; light you carry should matter more than light you happen to stand in.
- **2026-10-25** Rival crews (parley, temperament by level, memory) and the pub (three versions) are written up as proposals for the owner, not built: https://claude.ai/artifact/PttJ4kNWutJvUAegNgAxeA
