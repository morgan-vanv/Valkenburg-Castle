// The approved layout, transcribed region for region from mockup/sketch.py
// (pass 2). Order matters: a hex belongs to the first region containing it.
// `room` maps each sketch region onto a game room (passages fold into the
// room they serve, or into small named rooms for the exits).

import type { RegionSpec } from './build';
import { ellipse, line, minus, rect, union, type Shape } from './shapes';

export const PIT_L1: Shape = ellipse(26, 15, 4.2, 3.4, 0.08, 1);
export const PIT_L2: Shape = union(ellipse(24, 15, 8.5, 5.6, 0.06, 2), ellipse(29, 12, 5, 4.6, 0.05, 3));

export const REGIONS_L1: RegionSpec[] = [
  { name: 'hall', room: 'hall', shape: minus(union(rect(15, 9, 33, 20), rect(18, 7, 30, 8)), union(rect(15, 9, 16, 10), rect(32, 19, 33, 20))) },
  { name: 'gate', room: 'gate', shape: rect(21, 24, 28, 29) },
  { name: 'gate-pass', room: 'gate-pass', shape: rect(23, 21, 25, 23) },
  { name: 'court', room: 'court', shape: ellipse(9, 24, 7.5, 5.5, 0.12, 4) },
  { name: 'court-gate', room: 'court', shape: rect(16, 25, 20, 27) },
  { name: 'court-hall', room: 'hall', shape: line([[13, 21], [16, 19]], 0.3) },
  { name: 'kitchen', room: 'kitchen', shape: rect(3, 11, 11, 17) },
  { name: 'kitchen-court', room: 'court', shape: rect(7, 18, 9, 19) },
  { name: 'servants', room: 'servants', shape: line([[6, 10], [6, 6]]) },
  { name: 'library', room: 'library', shape: rect(3, 1, 12, 5) },
  { name: 'lib-hall', room: 'hall', shape: line([[12, 4], [14, 4], [16, 7], [17, 8]], 0.2) },
  { name: 'tower', room: 'tower', shape: rect(34, 1, 40, 6) },
  { name: 'tower-hall', room: 'tower', shape: line([[33, 7], [35, 6]], 0.2) },
  { name: 'armory', room: 'armory', shape: rect(37, 10, 42, 14) },
  { name: 'hall-armory', room: 'hall', shape: line([[34, 12], [36, 12]]) },
  { name: 'chapel', room: 'chapel', shape: ellipse(37, 21, 5, 4, 0.1, 5) },
  { name: 'chapel-hall', room: 'chapel', shape: line([[33, 18], [34, 19]], 0.3) },
  { name: 'chapel-gate', room: 'chapel', shape: line([[32, 24], [29, 26]], 0.2) },
  { name: 'breach', room: 'breach', shape: line([[41, 21], [44, 21]]) },
  { name: 'sally', room: 'sally', shape: line([[3, 14], [1, 14]]) },
  { name: 'gate-out', room: 'gate', shape: line([[24, 29], [24, 31]]) },
  { name: 'armory-chapel', room: 'armory', shape: line([[40, 15], [40, 17]]) },
];

export const REGIONS_L2: RegionSpec[] = [
  { name: 'crossing', room: 'crossing', shape: ellipse(23, 16, 1.6, 1.4), overPit: true },
  { name: 'bridge-main', room: 'bridges', shape: line([[15, 16], [34, 16]]), overPit: true },
  { name: 'bridge-north', room: 'bridges', shape: line([[23, 8], [23, 15]]), overPit: true },
  { name: 'bridge-broken', room: 'bridges', shape: line([[26, 22], [25, 19]]), overPit: true },
  { name: 'arcade-n', room: 'arcade', shape: rect(14, 6, 33, 7) },
  { name: 'arcade-w', room: 'arcade', shape: rect(14, 7, 15, 19) },
  { name: 'ledge-e', room: 'ledge-e', shape: line([[34, 8], [35, 12], [34, 17], [35, 21]]) },
  { name: 'ledge-s', room: 'rim', shape: rect(19, 21, 30, 21) },
  { name: 'rim-winch', room: 'rim', shape: rect(22, 22, 22, 22) },
  { name: 'guard', room: 'guard', shape: rect(34, 2, 39, 7) },
  { name: 'barracks', room: 'barracks', shape: rect(16, 1, 31, 4) },
  { name: 'barracks-arc', room: 'barracks', shape: union(rect(19, 5, 20, 5), rect(28, 5, 29, 5)) },
  { name: 'guard-barracks', room: 'guard', shape: rect(32, 3, 33, 3) },
  { name: 'officers', room: 'officers', shape: rect(6, 1, 11, 5) },
  { name: 'off-barracks', room: 'barracks', shape: rect(12, 3, 15, 3) },
  { name: 'archive', room: 'archive', shape: ellipse(7, 13, 4.5, 5.2, 0.05, 6) },
  { name: 'archive-arc', room: 'arcade', shape: rect(11, 12, 13, 13) },
  { name: 'cells', room: 'cells', shape: rect(3, 23, 15, 23) },
  {
    name: 'cells-cells',
    room: 'cells',
    shape: union(rect(8, 21, 9, 22), rect(12, 21, 13, 22), rect(4, 24, 5, 25), rect(8, 24, 9, 25), rect(12, 24, 13, 25)),
  },
  { name: 'archive-cells', room: 'cells', shape: line([[5, 18], [5, 22]]) },
  { name: 'winch', room: 'winch', shape: rect(18, 23, 26, 28) },
  { name: 'cells-winch', room: 'winch', shape: rect(16, 23, 17, 23) },
  { name: 'forge', room: 'forge', shape: ellipse(34, 26, 5.5, 3.4, 0.06, 7) },
  { name: 'forge-ledge', room: 'ledge-e', shape: line([[35, 21], [35, 23]]) },
  { name: 'winch-forge', room: 'forge', shape: rect(27, 24, 28, 26) },
  // Officers' to archive: a cracked wall gap the charge opens.
  { name: 'off-archive', room: 'officers', shape: rect(9, 6, 9, 6) },
];

export const REGIONS_L3: RegionSpec[] = [
  { name: 'bones', room: 'bones', shape: ellipse(24, 15, 7, 5.5, 0.12, 8) },
  { name: 'lair', room: 'lair', shape: ellipse(38, 12, 6.5, 7.5, 0.1, 9) },
  { name: 'bones-lair', room: 'bones', shape: line([[30, 15], [33, 14]], 0.3) },
  { name: 'sealed', room: 'sealed', shape: line([[41, 5], [44, 2]], 0.2) },
  { name: 'grove', room: 'grove', shape: ellipse(11, 13, 5, 4, 0.12, 10) },
  { name: 'grove-bones', room: 'grove', shape: line([[15, 14], [17, 15]], 0.2) },
  { name: 'nest', room: 'nest', shape: ellipse(14, 4, 4, 3, 0.15, 11) },
  { name: 'nest-grove', room: 'tunnels', shape: line([[12, 7], [11, 9]]) },
  { name: 'nest-bones', room: 'tunnels', shape: line([[17, 6], [20, 10]]) },
  { name: 'lift', room: 'lift', shape: ellipse(22, 25, 4, 3, 0.1, 12) },
  { name: 'lift-bones', room: 'lift', shape: line([[23, 20], [22, 22]], 0.3) },
  { name: 'drain', room: 'drain', shape: line([[9, 17], [8, 20], [5, 23], [4, 26], [1, 28]], 0.4) },
  { name: 'lift-drain', room: 'tunnels', shape: line([[18, 25], [14, 25], [8, 22]]) },
  { name: 'lair-lift', room: 'tunnels', shape: line([[34, 19], [31, 23], [26, 25]]) },
];
