# V3.3 engine progress

Brief: docs/agents/v33-engine.md. Spec: docs/v3-spec.md section 16. Branch `v3.3`.

## Plan (in order)
1. data.ts: LIGHT_MAX 20, stages, oil/brazier/kindle numbers, MONSTERS archer/captain/ghoul, TIERS, search rounds.
2. world.ts: stages, per-hex sight range (`sightRangeAt`), lantern shutter in litSet, `monsterSees` (lit or within 3; L3 ignores light).
3. camp.ts: spawn defaults (awake, patrol, buried ghouls, tiers), rival classes and kit counters, new Delve fields.
4. common.ts: buried ghouls are not on the map (occupant, noise, wake); tiered stats helper; killing a ghoul releases its hold.
5. delve.ts: `shutter` (free), `escape`, held heroes can't move/dash, ghouls rise when a hero ends a move within 2, shield wall in previews, rival overwatch fires on hero moves/acts.
6. world-phase.ts: patrols + knownRoutes, noticing, giving up (searchRounds), archer/captain/ghoul/spider-drag behaviour, rival kit (overwatch, knockback, veil, smoke, dart, burglar looting), Gloam in the Hollow.
7. engine.ts: sightRange(heroId), heroLit, intents include visible rivals.
8. Tests, test castle, sim.

## Done
- Steps 1–7 implemented; typecheck clean in src/game; the old suite passes (102) with light numbers updated.
- New modules: src/game/ai.ts (shared perception/movement/strike/overwatch helpers), src/game/rivals.ts (the sisters: entering, looting, kit, intents). world-phase.ts keeps monsters, the Gloam, charges and the phase.
- Test castle: sleepers marked (L1 rats, L2 spider, the Dragon), an L1 patrol orc in the east hall, an L2 archer on the bridge and a captain next to Grub, an L3 buried ghoul and a cave spider.

- Tests: 122 pass (`source scripts/npmenv.sh && npx vitest run src/game`, ~8s). New blocks: 16.1 awareness and patrols (spawn defaults + tiers, patrol loop, noticing rules, knownRoutes, giving up), 16.2 light (shutter, per-hero sight, the Gloam in the Hollow, Gloam immunity, pitch rule on L1/L2), 16.4 new monsters (archer, captain, ghoul, spider drag), 16.5 the sisters' kit (classes, dart, overwatch, knockback, veil + smoke, burglar looting).
- Sim updated (scripts/v3-engine-sim.ts): shutter discipline, oil for L3, `escape`, per-level table (done, deaths, dark rounds on L3, Gloam strikes). Test castle run: 6 delves, L1 3/3 done, L2 2/2, L3 slay 0/1 with 4 deaths.

## Sim numbers (real castle, `SEED=1 npx tsx scripts/v3-engine-sim.ts 16`, ~5 min)
Bot changes this pass: attacks before reviving (a hero revived under archer fire just went down again), closes in on hunters in sight within 4 (archers kite), squad cohesion (stay within 3 of the lantern bearer; the bearer waits for stragglers), shutter on L1 in fixed light, oil for L3, `escape` when held.
- Per level: L1 10/10 done, 0 deaths. L2 2/4 done, 6 deaths (recover L2 2/3; rescue L2 0/1 ran the lantern to 0 at round 33). L3 (slay only came up) 0/2, 8 deaths; dark rounds 1 and 3, Gloam strikes 0 on L3 (the tier-3 monsters and the Dragon did it, not the dark).
- Before the cohesion/attack-first bot fixes the same seed gave L2 1/4 with 14 deaths: scattered heroes got picked off by patrols and the two archers; a revive loop ate every action.
- Reading: L1 is easy as wanted. L2 is real resistance for this bot (half the delves wiped). L3 is deadly with or without light for the bot; it never gets to test "deadly without light" because the tiered spawns kill it first. The lead may want to look at L3 tier-3 numbers (+4 HP, +10%, +1 dmg on cave spiders 9 HP 75% 3 dmg, ghouls 11 HP 70%) before judging the Gloam.

- SEED=2, 16 delves: L1 9/9, 0 deaths. L2 2/5, 13 deaths (recover L2 2/3, rescue L2 0/2). L3 (slay) 0/2, 8 deaths, dark rounds 2, Gloam strikes 0. Same picture. Rescue L2 is 0/3 across both seeds: the cellblock is the far end of the Crossing and the walk back with the prisoner (escort move 3) runs through the patrols with the lantern near empty.

- Slay trace (SEED=1 delve 13): the party marked an L2 patrol, lost HP crossing the Crossing, took the lift down; at the lift base they stood unlit for a phase and "The dark here is awake" fired (the Gloam rose, then fled when the lantern came back); ghouls rose at the Bone Pile and grabbed Hobart (he wrenched free); the Dragon breathed, swept and **died at round 23**; the three others were down or dead by then and Hobart walked out alone with the lantern burning down (light 2 at round 31) and died on the way. So L3 kills with tiers plus the Dragon and the long walk, and the Gloam only adds to it when the bot lingers unlit. Contract failed because nobody got out.

## Done (status)
Everything in the brief is implemented and tested; the sim prints the per-level table. Nothing committed (the lead commits); WIP snapshots pushed to wip/v3 throughout.

## Design calls (spec silent)
- **Alert = searching.** Any monster that goes alert (noise, or lost its quarry) gets `searchRounds` 3; at zero it returns: patrollers to the nearest waypoint (awareness 'patrol'), others walk to `spawnedAt` and stand alert there with no `focusAt`. Fresh noise resets the clock. Berserkers never give up.
- **Patrol pace.** A patroller spends its whole move allowance along the route, through waypoints when there's movement left (`routeAfter` records the next waypoint; applied when the walk completes). Patrollers don't take stairs. A noise turns a patroller alert; it resumes the route after the search.
- **knownRoutes** is set when any hex of the patroller's walk (start included) is visible to the heroes at the start of its move; `routeKnown` carries a copy of the route. Only once per monster.
- **Monster sight** (`monsterSees` in world.ts): within 6 and LOS, and the hero is lit or within 3; on Level 3 light doesn't matter; smoke hides beyond 1. The Veil's "lost the trail" check uses the same rule.
- **Shown first.** shout, grab, drag and shove (orc and archer) only go off when they were the shown intent; otherwise the monster falls back to attack/move that phase (`planMonster(..., { noAbility: true })`). Web stays immediate as before.
- **Tiers** live on the engine-private `MonsterX.tier` (set at spawn from the spawn level); `monsterStats(m)` adds the chance/dmg bonus. Named elites keep +2 HP on top. The captain's shield wall is a +1 armor in `monsterArmor(c, m)` (min 1 dmg per hit as before) and shows as "Shield wall −1 dmg per hit" in previews.
- **Archer:** shoots within 4 with LOS (no adjacency); plans a spot 2..4 from the target (prefers 3) and backs off when adjacent, shooting after the step; point-blank if it can't back off. Knockback shot uses the rounded direction away from the archer (same as the Ranger's), 60%, shown as `shove` with `to`.
- **Captain shout:** intent `shout` whenever it has a target and the cooldown is 0 (so first sight, then every 4 rounds while fighting). Goes off next phase: noise 5, every orc/archer/captain within 8 on its level goes hunting with `focusAt` the target's hex and a preferred target. The captain is not an 'orc' kind, so it doesn't bellow like one.
- **Ghoul:** buried ghouls are not on the map at all (`onMap(c)` filters them: no occupancy, no noise, no targets, no intents). They rise when a hero ends a move (or a landing) within 2, hunting, `spawned` + `awake` events; if a hero stands on the hex they rise on the nearest free one. Grab is shown first, no roll; held heroes can't move or dash (`reachable` empty, move refused with "held fast"); `escape` is 2 Might slots, 1 hit frees, noise 1. The hold ends when the ghoul dies, is no longer adjacent, or the hero goes down. Attack on the held hero: +1 slot.
- **Spider drag:** the round after a web, if the hero is still webbed, not adjacent and within 3: `drag` with `to` = one hex toward the spider; resolved as a push toward the spider (`dragged` event instead of `shoved`; pits, walls, figures as shove outcomes).
- **Gloam:** one rule set for all levels: present when the lantern is out (any level) or an active hero on Level 3 stands unlit; targets only heroes in unlit hexes (veil hides from it too); never enters a lit hex (if light reaches its hex it recoils to the nearest dark hex within 3); rises 4..6 from the first unlit L3 hero (8..10 from the bearer under the pitch rule), out of sight if possible, and **acts the same phase** (no grace, both rules). Fades after 2 calm phases, or at once when the lantern comes back from 0 with nobody unlit on L3. Immune to pushes, falls, glue and damage.
- **Lantern shutter:** `shutter` is a free self action for the bearer; label flips to "Open lantern"; emits `shutter` and a `light` event. Shuttered: no burn, no lantern light; brightness for penalties still follows the oil stage when the hero stands in some other light (spec 16.2's wording).
- **Sisters' leave threshold** scaled: light ≤ 9 (was 18 of 40). Sisters wait for each other: the crew leaves only when no sister has a loot goal left.
- **Sisters' kit:** classes in name order (Wenna ranger, Odile shadowmancer, Brisk burglar). The Ranger sister shoots at range 6 (otherwise SISTER numbers: 3 slots 55% 2 dmg); overwatch only when she can't get a shot even after walking; her overwatch fires during the player phase after a hero's move or action in her sight within 6 (`cast` spell 'overwatch' by her id, then a full roll) and lapses at her next turn. Knockback shot: 2 slots at 55%, 2 hits push away from her. Shadowmancer veils herself when the crew is first spotted (intent `veil`, shown first; veiled 2 rounds: not a target, not in `intents`, the view may draw her translucent from `Rival.veil`); smoke once per delve on the nearest hero in sight within 4 when any sister is below half HP (smoke lands mid world phase so it lasts through the next player phase). Burglar sister: 2 darts, 1 slot at 65% on the nearest hero in sight within 5 when hostile; a hit makes the hero `webbed` plus engine-private `dozing` (no move, dash or action next player phase; `actions()` returns []). When neutral she alone goes for piles left at opened chests.
- **Engine.intents** now also returns visible, unveiled sisters' intents keyed by rival id (the view can show them like monsters').

## Contract requests
- A visible "drugged/asleep" state for heroes hit by a sleep dart: today it's `webbed: true` plus the engine-private `dozing`; the view can only show the web. Suggest `HeroInDelve.dazed?: boolean` (or `asleep: number`) if the look matters.
- `Monster.buried` is in the contract: the view must skip buried monsters (don't draw, don't hover). Noted for the presentation agent.

## Known issues
(none yet)
