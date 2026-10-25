// Level 1: the Ruined Keep. Built from the approved sketch (mockup/sketch.py)
// region for region; hand edits below in offset (col, row).

import { LevelBuilder } from './build';
import { PIT_L1, REGIONS_L1 } from './regions';

export function buildLevel1(): LevelBuilder {
  const b = new LevelBuilder(
    1,
    'The Ruined Keep',
    {
      hall: { name: 'Great Hall', material: 'flagstone', tint: '#a89a84', label: [20, 15] },
      dais: { name: 'High Table', material: 'rug', tint: '#8e3a32' },
      gate: { name: 'Gatehouse', material: 'flagstone', tint: '#d4c8aa', label: [24, 26] },
      'gate-pass': { name: 'Gate passage', material: 'flagstone', tint: '#8c8272' },
      court: { name: 'Courtyard', material: 'earth', tint: '#a8a06a', label: [9, 24] },
      kitchen: { name: 'Kitchens', material: 'planks', tint: '#9a7e5c' },
      servants: { name: "Servants' passage", material: 'flagstone', tint: '#7d7468' },
      library: { name: 'Library', material: 'planks', tint: '#7e5f42' },
      tower: { name: 'Tower stair', material: 'flagstone', tint: '#9c9282', label: [37, 5] },
      armory: { name: 'Armory', material: 'flagstone', tint: '#8e6a5a' },
      chapel: { name: 'Chapel', material: 'flagstone', tint: '#b0a690', label: [37, 23] },
      breach: { name: 'East breach', material: 'rock', tint: '#7a7266' },
      sally: { name: 'Sally port', material: 'flagstone', tint: '#857b6c' },
    },
    REGIONS_L1,
    PIT_L1,
  );

  // The north bump of the hall is the dais: the high table on a long rug.
  for (let r = 7; r <= 8; r++) for (let c = 18; c <= 30; c++) if (b.regionAt(c, r) === 'hall') b.floor(c, r, 'dais');

  // Fix: the tower passage stopped one hex short of the hall.
  b.floor(33, 8, 'tower');

  // Doors, cracked wall, stairs, exits (as the sketch marks them).
  b.set(6, 10, { kind: 'door' }).set(6, 6, { kind: 'door' }).set(33, 7, { kind: 'door' });
  b.set(36, 12, { kind: 'door', locked: true });
  b.set(40, 16, { kind: 'cracked' });
  b.set(37, 3, { kind: 'stairs' });
  b.set(24, 31, { kind: 'exit' }).set(1, 14, { kind: 'exit' }).set(44, 21, { kind: 'exit' });
  b.set(37, 21, { kind: 'brazier' });

  // Great hall: columns down both flanks, the high table and benches.
  for (const [c, r] of [[17, 11], [17, 15], [17, 19], [32, 11], [21, 9], [28, 9]] as [number, number][]) b.set(c, r, { kind: 'pillar' });
  b.props('table', [[22, 7], [23, 7], [24, 7], [25, 7], [26, 7]]);
  b.props('bench', [[20, 18], [21, 18], [28, 19], [29, 19]]);

  // Library: shelves in rows, aisles between; a reading table.
  b.props('shelf', [[4, 2], [5, 2], [8, 2], [9, 2], [4, 4], [5, 4], [8, 4], [9, 4]], true);
  b.prop(11, 2, 'table');

  // Kitchens: two work tables, barrels along the north wall.
  b.props('table', [[6, 13], [7, 13], [6, 15], [7, 15]]);
  b.props('barrel', [[10, 11], [11, 11], [3, 17]]);

  // Courtyard: a rubble of fallen stones and a cart's crates.
  b.props('rock', [[13, 23], [6, 26]]);
  b.props('crate', [[3, 23], [4, 22]]);

  // Gatehouse: crates and a barrel by the gate.
  b.props('crate', [[21, 29], [28, 29]]);
  b.prop(28, 25, 'barrel');

  // Tower stair: stores.
  b.props('crate', [[34, 1], [35, 1]]);
  b.prop(40, 1, 'barrel');
  b.prop(40, 6, 'rack');

  // Armory: weapon racks on the walls.
  b.props('rack', [[37, 10], [38, 10], [42, 11], [42, 13], [37, 14]]);

  // Chapel: pews either side of the brazier, a statue of the saint.
  b.props('bench', [[34, 22], [35, 22], [39, 22], [40, 22]]);
  b.prop(37, 18, 'statue', true);

  // V3.7 (spec 20.3): the tower stair's shaft can't be blown into (the outer curtain is marked in finish).
  b.unbreakableAround('tower');

  // Railing: a few short bits left on the pit mouth's rim.
  b.railing([[25, 11], [26, 11], [22, 14], [22, 15]]);

  // Lights (V3.3, spec 16.2): abundant daylight, so most of the level is lit without the lantern.
  b.sconce(4, 1).sconce(12, 5); // library
  b.sconce(3, 11).sconce(11, 17); // kitchens
  b.sconce(18, 7).sconce(30, 7).sconce(15, 14).sconce(33, 15); // hall and dais
  b.sconce(34, 3).sconce(40, 3); // tower
  b.sconce(42, 10); // armory
  // Courtyard and gatehouse: open sky.
  b.light('daylight', [[4, 24], [9, 21], [12, 26], [7, 28], [17, 26], [22, 25], [27, 25], [24, 29]]);
  // The great hall's collapsed roof: daylight all round the pit mouth.
  b.light('daylight', [[20, 10], [29, 10], [19, 14], [32, 14], [19, 18], [31, 18], [24, 20]]);
  // Corridors open to the sky: the hall's library arm, the servants' passage, the gate passage,
  // the sally port and the east breach.
  b.light('daylight', [[15, 6], [6, 8], [23, 22], [2, 14], [42, 21]]);
  // More fallen roof: the chapel's nave and south aisle, the kitchens' chimney, the tower's top.
  // The library and the armory stay dim: the lantern still earns its oil there.
  b.light('daylight', [[37, 20], [34, 24], [8, 14], [37, 4]]);
  return b;
}
