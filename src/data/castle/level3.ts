// Level 3: the Hollow. Built from the approved sketch (mockup/sketch.py)
// region for region; hand edits below in offset (col, row).

import { LevelBuilder } from './build';
import { REGIONS_L3 } from './regions';

/**
 * Level 2 pit hexes with no Hollow floor under them in the sketch (the pit's
 * rim overhangs the bone pile's edge). Filled as bone pile so every fall lands
 * straight down.
 */
const UNDER_L2_PIT: [number, number][] = [
  [27, 8], [28, 8], [29, 8], [30, 8], [31, 8],
  [25, 9], [26, 9], [27, 9], [28, 9], [29, 9], [30, 9], [31, 9],
  [22, 10], [24, 10], [29, 10], [30, 10], [31, 10],
  [18, 11], [28, 11], [29, 11], [30, 11], [31, 11],
  [17, 12], [30, 12], [31, 12],
  [17, 13], [31, 13],
  [18, 14],
  [17, 17], [32, 17],
  [18, 18], [30, 18], [31, 18],
  [18, 19], [19, 19], [29, 19],
  [21, 20], [28, 20],
];

export function buildLevel3(): LevelBuilder {
  const b = new LevelBuilder(
    3,
    'The Hollow',
    {
      bones: { name: 'Bone Pile', material: 'bone', tint: '#9a8c78', label: [24, 16] },
      lair: { name: 'The Lair', material: 'rock', tint: '#8a4a32', label: [38, 15] },
      sealed: { name: 'Sealed Stair', material: 'flagstone', tint: '#5e5868' },
      grove: { name: 'Fungus Grove', material: 'earth', tint: '#6e8a6a', label: [10, 13] },
      nest: { name: 'Spider Nest', material: 'rock', tint: '#5a524c' },
      tunnels: { name: 'Tunnels', material: 'earth', tint: '#584838', label: [15, 25] },
      lift: { name: 'Lift base', material: 'earth', tint: '#7d6a56' },
      drain: { name: 'The Drain', material: 'water', tint: '#4e6a78', label: [6, 21] },
    },
    REGIONS_L3,
  );

  for (const [c, r] of UNDER_L2_PIT) b.floor(c, r, 'bones');
  // The collapsed cellblock floor above lands here, at the Drain's edge.
  b.floor(3, 23, 'drain');
  // Fix: a 1-hex dead pocket at the Lair's north tip.
  b.clear(38, 4);

  // Sealed Stair, lift, cave mouth.
  b.set(42, 4, { kind: 'sealed' });
  b.set(24, 27, { kind: 'lift' });
  b.set(1, 28, { kind: 'exit' });

  // Bone Pile: heaps of bones (cover), only in the bridges' shadow so no
  // fall column from above ends on one.
  b.props('bones', [[19, 16], [23, 12], [28, 16], [31, 16], [26, 20]]);

  // The Lair: stalagmites and rocks; the hoard ground stays open.
  b.props('stalagmite', [[35, 7], [42, 9], [34, 17], [43, 13]]);
  b.props('rock', [[36, 12], [41, 17]]);

  // Fungus Grove: stalagmites and rocks, a brazier.
  b.props('stalagmite', [[8, 11], [14, 11], [9, 15]]);
  b.prop(12, 15, 'rock');
  b.set(11, 12, { kind: 'brazier' });

  // Spider Nest: old bones and rocks.
  b.props('bones', [[13, 2], [16, 3], [13, 5]]);
  b.prop(16, 6, 'rock');

  // Lift base: crates and a barrel from the old works.
  b.props('crate', [[20, 24], [21, 24]]);
  b.prop(26, 26, 'barrel');
  b.prop(19, 27, 'rock');

  // The Drain: rocks in the water.
  b.props('rock', [[8, 18], [5, 23], [8, 20]]);

  // Lights (V3.3, spec 16.2): only fungus in the grove, the pit glow on the Bone Pile, the
  // Lair's fires and its fire vents (radius 1 on walkable hexes around the hoard). Nothing else.
  b.light('fungus', [[10, 11], [13, 13], [8, 14], [16, 15]]);
  b.light('glow', [[24, 13], [25, 18]]);
  b.light('fire', [[37, 10], [40, 14]], 2);
  b.light('fire', [[36, 9], [41, 15], [35, 15]], 1);
  return b;
}
