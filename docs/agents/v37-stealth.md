# Brief: V3.7 stealth and free swings (engine)

Read docs/agents/v37-common.md, then docs/v3-spec.md 20.1 and 20.2 in full, and 16.1 for what you're replacing.

1. **Per-hex walking noise** (1 per hex, 2 on rubble; sneak silent) in doMove; keep the ripple events cheap (one `noise` event per move at the destination is fine for the view, but the engine reacts per hex).
2. **Sleeper wake rolls** per hex within 2 (50/10, halved unlit; end adjacent: walk sure, sneak 25%), seeded; `woke` event; replaces the old end-adjacent wake.
3. **Noticing** with the new ranges by lit/unlit × walk/sneak, Hollow rule, `noticed` event. The hero's last move mode must be known at world phase time: track `HeroX.sneaked` for the round.
4. **Facing** on monsters and crew members (`facing` 0..5 using hex.ts DIRS): set on move, on noise, on noticing/attacking; blind arc rules (sneaking hero directly behind: never noticed by it; sneaking in the blind arc: only adjacent and walking... read 20.1 exactly); data default 0; the test castle gives a few sleepers a facing.
5. **Sneak attack** +1 slot on an unnoticed target (stacks with backstab); `focus`/noticed bookkeeping per monster: a set of hero ids it has noticed (`MonsterX.noticedIds`).
6. **Free swings** both ways (20.2) with the `swing` event; hook into doMove (hero leaving) and monster/rival movement (ai.ts, world-phase.ts, rivals.ts); exclusions list; hero's action not spent; bow 1 slot.
7. **Dread** spell for the Shadowmancer (action `dread`, 1 mana, 2 Wits slots, range 5): `feared`/`fearOf`, the flee behaviour in the world phase with provoked swings, intent `flee`, `feared` event. Add it to CLASSES abilities text in data.ts.
8. **`Reach.risks`** filled in `reachable` for every hex (wake rolls along the path with chance, notice at the destination, swings provoked), cheap enough for the move preview (memoize litSet).
9. Tests for each numbered rule; update old tests that assumed the old wake/notice rules (several in 16.1's block). Sim: the bot sneaks when within 4 of a sleeper, otherwise walks; print wake and notice counts.
