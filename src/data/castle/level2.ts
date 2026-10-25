// Level 2: the Crossing. Built from the approved sketch (mockup/sketch.py)
// region for region; hand edits below in offset (col, row).

import { LevelBuilder } from './build';
import { PIT_L2, REGIONS_L2 } from './regions';

export function buildLevel2(): LevelBuilder {
  const b = new LevelBuilder(
    2,
    'The Crossing',
    {
      crossing: { name: 'The Crossing', material: 'flagstone', tint: '#c4b89e', label: [23, 17] },
      bridges: { name: 'Bridges', material: 'flagstone', tint: '#b3a893', label: [18, 16] },
      arcade: { name: 'Arcade', material: 'flagstone', tint: '#8f8070', label: [22, 7] },
      'ledge-e': { name: 'East ledge', material: 'rock', tint: '#7c7062', label: [34, 15] },
      rim: { name: 'South rim', material: 'rock', tint: '#857563', label: [21, 21] },
      guard: { name: 'Guard post', material: 'flagstone', tint: '#a0978a' },
      barracks: { name: 'Barracks', material: 'planks', tint: '#9a7e5c', label: [21, 3] },
      officers: { name: "Officers' quarters", material: 'rug', tint: '#8e5a4a' },
      archive: { name: 'Archive', material: 'planks', tint: '#76604a' },
      cells: { name: 'Cellblock', material: 'flagstone', tint: '#6e665c', label: [10, 23] },
      winch: { name: 'Winch room', material: 'flagstone', tint: '#9c9282', label: [21, 25] },
      forge: { name: 'Forge', material: 'flagstone', tint: '#8e5e4a' },
    },
    REGIONS_L2,
    PIT_L2,
  );

  // Fix: the cracked wall from the officers' quarters touched no archive hex.
  b.floor(9, 8, 'archive');

  // Doors, cracked wall, stairs, lift, the collapsed floor.
  b.set(13, 3, { kind: 'door', locked: true }).set(32, 3, { kind: 'door' }).set(16, 23, { kind: 'door' }).set(5, 20, { kind: 'door' });
  b.set(9, 7, { kind: 'cracked' });
  b.set(37, 3, { kind: 'stairs' });
  b.set(24, 27, { kind: 'lift' });
  b.set(3, 23, { kind: 'pit' }); // collapsed floor: drops into the Drain

  // The Crossing's statue, between the four bridge ends.
  b.prop(23, 16, 'statue', true);

  // Barracks: bunks along the north wall, a table and a barrel.
  b.props('bunk', [[17, 1], [18, 1], [22, 1], [23, 1], [27, 1], [28, 1]]);
  b.props('table', [[24, 4], [25, 4]]);
  b.prop(31, 4, 'barrel');

  // Officers' quarters: a table, a rack, a crate.
  b.props('table', [[8, 1], [9, 1]]);
  b.prop(6, 2, 'rack');
  b.prop(11, 5, 'crate');

  // Guard post: table and weapon rack; brazier in the corner.
  b.props('table', [[35, 5], [36, 5]]);
  b.props('rack', [[39, 2], [39, 3]]);
  b.set(39, 6, { kind: 'brazier' });

  // Archive: shelves in rows with aisles, a brazier at the reading end.
  b.props('shelf', [[5, 10], [6, 10], [8, 10], [9, 10], [4, 13], [5, 13], [6, 13], [8, 13], [9, 13], [5, 16], [6, 16], [8, 16]], true);
  b.set(10, 15, { kind: 'brazier' });

  // Cellblock: cages in three of the cells.
  b.props('cage', [[9, 21], [13, 25], [5, 25]]);

  // Winch room: the winch beside the lift, crates and a barrel.
  b.prop(25, 27, 'winch', true);
  b.props('crate', [[18, 28], [19, 28]]);
  b.prop(18, 26, 'barrel');

  // Forge: the forge (burning), anvils, a rack and a barrel.
  b.prop(37, 28, 'forge', true);
  b.props('anvil', [[35, 26], [36, 25]]);
  b.prop(38, 24, 'rack');
  b.prop(32, 28, 'barrel');

  // V3.7 (spec 20.3): the stair's landing (guard post) and the lift shaft (winch room) can't be blown into.
  b.unbreakableAround('guard', 'winch');

  // Railing: the arcade's pit side, broken at (28, 7) and (15, 14).
  b.railing([[26, 7], [27, 7], [29, 7], [30, 7], [31, 7], [15, 13], [15, 15]]);

  // Lights (V3.3, spec 16.2): sparse. Four sconces, the forge's fire and the pit glow at the
  // Crossing; the arcade, the bridges and the ledge are dark.
  b.sconce(16, 1); // barracks, by the door end
  b.sconce(33, 6); // arcade, at the guard post end
  b.sconce(7, 23); // cellblock
  b.sconce(26, 28); // winch room, by the lift
  b.light('fire', [[37, 28]]); // the forge
  b.light('glow', [[23, 15], [22, 17]]); // the pit glow from the Hollow, strongest at the Crossing
  return b;
}
