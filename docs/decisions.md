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
