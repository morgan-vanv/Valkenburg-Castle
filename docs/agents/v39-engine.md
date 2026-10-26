# Brief: V3.9 engine

Read docs/agents/v39-common.md, then docs/v3-spec.md 24.1–24.4 (and 20.1, 21.5 for the stealth you're changing: src/game/stealth.ts).

1. 24.1: enemy front half / rear half (replace the blind arc), sleepers never notice by sight; sound rolls unchanged.
2. 24.2: hero facing (after moves, aimed actions, delve start into the castle), `face` command (free, player phase), `faced` events; visibleSet and glimpse use each hero's front half (adjacent rear hexes unseen); intents only for visible enemies (the view reads `intents`, so filter there); blindsided +1 slot from a hero's rear half for every attacker kind; `unseenHit` and the attacker visible until the next player phase ends; overwatch front half only.
3. 24.3: Burglar sneak at full pace (dash, rubble), quietest feet numbers, backstab (rear half, unaware target: +1 slot, double damage before armor; not Dragon/Gloam), remove the old backstab; preview modifiers name it.
4. 24.4: `seenEnemies` (track in the delve as enemies become visible); `Reach.risks` filtered to seen enemies (wake: seen sleepers; notice: currently visible; swings: seen).
5. Tests under `describe('V3.9 eyes front')` for each rule; update older tests that assumed full-circle hero sight (several in 15.1/16.2/17.4) by facing heroes toward what they test. Sim: the bot faces outward when 2+ heroes stand together (one faces back), a Burglar backstabs sleepers when it can; report blindsided hits, backstabs, unseen hits.
