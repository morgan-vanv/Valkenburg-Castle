// The V3.1 castle: three levels from the approved sketch (mockup/sketch.py).
// Tiles come from region shapes (shapes.ts, regions.ts) plus hand edits in
// level1-3.ts; everything placed on them lives here, by offset (col, row).

import type { CastleDef } from '../../game/types';
import { at } from './build';
import { buildLevel1 } from './level1';
import { buildLevel2 } from './level2';
import { buildLevel3 } from './level3';

const b1 = buildLevel1();
const b2 = buildLevel2();
const b3 = buildLevel3();

const L1 = (c: number, r: number) => at(1, c, r);
const L2 = (c: number, r: number) => at(2, c, r);
const L3 = (c: number, r: number) => at(3, c, r);

/** A patrol route on one level, in offset (col, row); the first waypoint is the spawn hex. */
const route = (level: number, pts: [number, number][]) => pts.map(([c, r]) => at(level, c, r));

// Level 2 arcade loop: east end, the length of the north arcade, down the west arcade and back
// up it (the corner waypoint keeps the return leg off the bridges, which would be shorter).
// Two orcs share it; the second starts one hex off the first so they walk as a pair.
const ARCADE_LOOP: [number, number][] = [[32, 7], [15, 6], [15, 18], [15, 8]];

export const castle: CastleDef = {
  name: 'Castle Valkenburg',
  levels: [b1.finish(), b2.finish(), b3.finish()],
  links: [
    // Tower stair (L1) down to the guard post (L2).
    { kind: 'stairs', a: L1(37, 3), b: L2(37, 3) },
    // The lift: winch room (L2) down to the lift base (L3); the winch stands beside it.
    { kind: 'lift', a: L2(24, 27), b: L3(24, 27), winch: L2(25, 27) },
  ],
  // Index order matters to `startDelve.entrance`: main gate, sally port, east breach.
  entrances: [L1(24, 31), L1(1, 14), L1(44, 21)],
  entranceNames: ['Main gate', 'Sally port', 'East breach'],
  // V4.0 (spec 25): a new campaign goes in by the main gate only. The sally port's barred gate opens
  // with its key (one copy lies in the library, by the west shelves) or a blast; the east breach's
  // rubble with a blast or a Dig. Once open, each stays open for the rest of the campaign.
  shutWays: [
    {
      id: 'sally', entrance: 1, kind: 'gate', at: [L1(2, 14)], keyAt: L1(3, 1),
      hint: 'A barred gate. It wants its key, or a charge.',
      openLine: 'The sally port gate swings open. It stays open.',
    },
    {
      id: 'breach', entrance: 2, kind: 'rubble', at: [L1(42, 21), L1(43, 21)],
      hint: 'Choked with rubble.',
      openLine: 'The east breach is clear. A new way in.',
    },
  ],
  // V4.1 (owner): the Sisters may come by any way in but the party's own (the main gate too).
  rivalEntrances: [L1(24, 31), L1(44, 21), L1(1, 14)],
  // V3.5 (spec 18.5): where a cutthroat crew waits on Level 2, at choke points: the west and east
  // ends of the main bridge, the arcade end of the north bridge, and the winch room by the lift.
  // V3.7 (spec 20.4): the Wake waits on Level 3, at the lift base or where the Bone Pile narrows
  // toward the Lair.
  rivalPosts: [L2(14, 16), L2(35, 16), L2(22, 7), L2(22, 26), L3(20, 26), L3(31, 17)],
  // V3.3 (spec 16.1): spawns are awake unless `asleep: true`. Sleepers: Level 1 the rats and
  // the spider; Level 2 only the barracks squad; Level 3 only the Dragon.
  spawns: [
    // Level 1: the Ruined Keep. Vermin sleep; the orcs are up, one walks the hall.
    { at: L1(8, 12), kind: 'rats', asleep: true }, // kitchens
    { at: L1(5, 16), kind: 'rats', asleep: true }, // kitchens
    { at: L1(7, 3), kind: 'spider', asleep: true }, // library
    { at: L1(8, 24), kind: 'cutpurse' }, // courtyard
    { at: L1(22, 13), kind: 'orc' }, // hall, west of the pit: V4.1 (WS8 L1-5) on the unrailed lip, so a shove, knockback or gust drops it
    { at: L1(31, 17), kind: 'orc' }, // hall, east of the pit
    { at: L1(36, 4), kind: 'orc' }, // tower stair
    // V4.1 (WS8 L1-3): a second post on the way down; a firecracker in the tower passage (33, 8) sends both searching.
    { at: L1(35, 5), kind: 'orc' }, // tower stair
    { at: L1(17, 25), kind: 'orc' }, // courtyard, by the gatehouse
    // V4.1 (spec 31.2, B1): Aldric's guard dozes on a campaign's first delve.
    { at: L1(35, 24), kind: 'orc', firstDelveAsleep: true }, // chapel, by the chest
    // The hall patrol: clockwise round the pit mouth, floor only, no doors.
    { at: L1(19, 10), kind: 'orc', patrol: route(1, [[19, 10], [27, 10], [32, 12], [32, 18], [25, 20], [18, 17]]) },
    // Level 2: the Crossing. The barracks squad sleeps with its captain; everything else is up.
    { at: L2(19, 3), kind: 'orc', asleep: true }, // barracks squad
    { at: L2(21, 2), kind: 'orc', asleep: true },
    { at: L2(26, 3), kind: 'orc', asleep: true },
    { at: L2(29, 2), kind: 'orc', asleep: true },
    { at: L2(23, 3), kind: 'captain', asleep: true }, // with the squad
    // V4.1 (WS8 L2-3): Grub keeps the cellblock's way from the winch room side, within the winch's noise.
    { at: L2(21, 23), kind: 'orc', name: 'Grub the Jailer' }, // cellblock passage, winch room end
    { at: L2(7, 12), kind: 'spider' }, // archive
    // V4.1 (WS8 L2-1): Ugluk sleeps by the forge fire: Gerda's rescue is a stealth test, not a slugfest.
    { at: L2(34, 27), kind: 'berserker', name: 'Ugluk Red-Hand', asleep: true }, // forge
    { at: L2(28, 21), kind: 'rats' }, // south rim
    // The arcade patrol: two orcs on one loop, the second a hex behind the first.
    { at: L2(24, 6), kind: 'orc', patrol: route(2, [[24, 6], ...ARCADE_LOOP]) },
    { at: L2(23, 7), kind: 'orc', patrol: route(2, [[23, 7], ...ARCADE_LOOP]) },
    // Guard post <-> barracks: the short way is through the barracks door (it opens it), the long
    // way round by the arcade gaps if the door is ever blocked.
    // V4.1 (spec 31.10): the guard walks the guard post and the arcade's east end, no longer through the barracks: the
    // squad sleeps behind a closed door, so a fight at the stair landing doesn't wake it by itself.
    { at: L2(36, 4), kind: 'orc', patrol: route(2, [[36, 4], [29, 6]]) },
    // The east-ledge walker: down the ledge from below the archer to the forge end and back.
    { at: L2(35, 19), kind: 'orc', patrol: route(2, [[35, 19], [34, 11], [35, 22]]) },
    { at: L2(28, 7), kind: 'archer' }, // arcade, in the broken railing over the pit
    { at: L2(35, 10), kind: 'archer' }, // top of the east ledge
    { at: L2(21, 25), kind: 'orc' }, // winch room, guarding the lift
    { at: L2(7, 15), kind: 'cutpurse' }, // archive, after the chest
    // Level 3: the Hollow. All awake but the Dragon; ghouls wait under the bones.
    { at: L3(22, 14), kind: 'rats' }, // bone pile
    { at: L3(20, 12), kind: 'ghoul', buried: true }, // bone pile, north-west
    { at: L3(28, 13), kind: 'ghoul', buried: true }, // bone pile, east
    { at: L3(23, 19), kind: 'ghoul', buried: true }, // bone pile, by the lift tunnel
    { at: L3(14, 3), kind: 'spider' }, // spider nest
    { at: L3(15, 5), kind: 'spider' }, // spider nest
    { at: L3(23, 25), kind: 'orc' }, // lift base
    { at: L3(25, 25), kind: 'orc' }, // lift base
    { at: L3(7, 22), kind: 'berserker' }, // the drain
    { at: L3(39, 11), kind: 'dragon', asleep: true },
  ],
  chests: [
    // Level 1: tiers 1 and 2; the armory's is locked.
    { id: 'l1-library-chest', at: L1(11, 4), tier: 1 },
    { id: 'l1-kitchen-chest', at: L1(4, 12), tier: 1 },
    { id: 'l1-chapel-chest', at: L1(38, 24), tier: 1 },
    { id: 'l1-tower-chest', at: L1(39, 2), tier: 2 },
    { id: 'l1-armory-chest', at: L1(40, 12), tier: 2, locked: true },
    // Level 2: tier 2; the officers' strongbox (locked) and the archive's are tier 3.
    { id: 'l2-barracks-chest', at: L2(30, 1), tier: 2 },
    { id: 'l2-guard-chest', at: L2(38, 4), tier: 2 },
    { id: 'l2-forge-chest', at: L2(31, 26), tier: 2 },
    { id: 'l2-officers-strongbox', at: L2(8, 3), tier: 3, locked: true },
    { id: 'l2-archive-chest', at: L2(4, 15), tier: 3 },
    // Level 3: tier 3.
    { id: 'l3-nest-chest', at: L3(12, 3), tier: 3 },
    { id: 'l3-drain-chest', at: L3(5, 26), tier: 3 },
  ],
  coins: [
    { at: L1(13, 25), gold: 10 },
    { at: L1(26, 20), gold: 15 },
    { at: L1(41, 12), gold: 20 },
    { at: L2(24, 2), gold: 25 },
    { at: L2(12, 22), gold: 30 },
    { at: L2(34, 9), gold: 30 },
    { at: L2(22, 27), gold: 25 },
    { at: L3(26, 15), gold: 40 },
    { at: L3(30, 24), gold: 35 },
    { at: L3(17, 4), gold: 50 },
    { at: L3(12, 10), gold: 40 },
  ],
  traps: [
    { at: L1(6, 8) }, // servants' passage
    { at: L1(24, 22) }, // gate passage
    { at: L2(14, 3) }, // officers' corridor, by the locked door
    { at: L2(5, 19) }, // archive to cellblock, by the door
    // V4.0 (spec 29.5): two venom traps on Level 2, off the main ways but in a corridor you can't step round.
    { at: L2(34, 13), venom: true }, // the east ledge, on the way down to the forge
    { at: L2(15, 23), venom: true }, // the cellblock's east passage, by the door to the winch room
    { at: L3(19, 8) }, // nest tunnel
    { at: L3(16, 25) }, // drain tunnel
  ],
  braziers: [L1(37, 21), L2(39, 6), L2(10, 15), L3(11, 12)],
  contractSites: [
    { id: 'l1-rescue-library', kind: 'rescue', at: L1(12, 1), where: 'the library' },
    { id: 'l1-recover-armory', kind: 'recover', at: L1(41, 14), where: 'the armory' },
    { id: 'l1-recover-chapel', kind: 'recover', at: L1(36, 20), where: 'the chapel altar' },
    { id: 'l2-rescue-cell-west', kind: 'rescue', at: L2(8, 21), where: 'the cellblock' },
    { id: 'l2-rescue-cell-east', kind: 'rescue', at: L2(12, 24), where: 'the cellblock' },
    { id: 'l2-recover-archive', kind: 'recover', at: L2(11, 11), where: 'the archive' },
    { id: 'l2-recover-forge', kind: 'recover', at: L2(34, 28), where: 'the forge' },
    { id: 'l3-rescue-nest', kind: 'rescue', at: L3(15, 2), where: 'the Spider Nest' },
    { id: 'l3-recover-grove', kind: 'recover', at: L3(11, 14), where: 'the Fungus Grove' },
    { id: 'l3-recover-drain', kind: 'recover', at: L3(3, 27), where: 'the Drain' },
    { id: 'l3-slay-dragon', kind: 'slay', at: L3(39, 11), where: 'the Lair' },
    // V3.6 (spec 19.1): story sites, used only by their story contract. Each villager in a place
    // that makes sense: Aldric patching orcs in the chapel's south aisle, Wim at the kitchens'
    // spit between the work tables, Gerda by the forge fire behind Ugluk, the copper among the
    // sleeping barracks squad. (The cask book stays at the Drain's regular site.)
    { id: 'l1-story-chapel', kind: 'rescue', at: L1(40, 24), where: 'the chapel', story: 'surgeon' },
    { id: 'l1-story-kitchens', kind: 'rescue', at: L1(9, 14), where: 'the kitchens', story: 'innkeeper' },
    { id: 'l2-story-forge', kind: 'rescue', at: L2(38, 26), where: 'the forge', story: 'smith' },
    { id: 'l2-story-barracks', kind: 'recover', at: L2(28, 3), where: 'the barracks', story: 'copper' },
    // V4.1 (spec 31.3): Ilse among the archive's shelves, a step from the spider she milks (it's awake: no sneaking up
    // on her unseen), across the room from the archive's regular site and chest.
    { id: 'l2-story-archive', kind: 'rescue', at: L2(6, 11), where: 'the archive', story: 'alchemist' },
    // V3.7 (spec 20.4): crew hideouts, used only by "Bring back <name>" contracts for that crew's
    // captives: the Sisters camp in the officers' quarters (behind the locked door), the Ferrymen
    // by the Drain's water, the Choir in the east tunnels, the Wake in the Bone Pile's north-east corner.
    { id: 'lantern-sisters-hideout', kind: 'rescue', at: L2(10, 5), where: "the officers' quarters", hideout: 'lantern-sisters' },
    { id: 'ferrymen-hideout', kind: 'rescue', at: L3(9, 18), where: 'the Drain', hideout: 'ferrymen' },
    { id: 'gallows-choir-hideout', kind: 'rescue', at: L3(33, 21), where: 'the Tunnels', hideout: 'gallows-choir' },
    { id: 'the-wake-hideout', kind: 'rescue', at: L3(30, 9), where: 'the Bone Pile', hideout: 'the-wake' },
  ],
  lights: [...b1.lights, ...b2.lights, ...b3.lights],
};
