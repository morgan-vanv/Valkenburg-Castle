// Level 2: the Barracks and Cells. The orcs hold this floor. The mess hall is
// the hub; the pit landing lies right under the Ruined Keep's pit, the tower
// stair comes down into the undercroft, and a cracked wall joins the
// cellblock to the landing. No exits: the way out is up. Format: see parse.ts.
//
// Rooms: b barracks, c cellblock, d drill yard, g guard room, m mess hall,
// p pit landing, r storeroom, s old shrine, u undercroft.

import { parseLevel } from './parse';

const TILES = [
//              111111111122222222223333
//    0123456789012345678901234567890123
  '  #########             ######### ', // 0
  ' #..#..#..#   #####    #........# ', // 1
  ' #..#..#..#   #....#   #........# ', // 2
  ' #+##+##+### #%....#####........# ', // 3
  ' #..........##..................# ', // 4
  ' #..........x%..................# ', // 5
  '  #+###+##+###......####........# ', // 6
  '  #..##..#..##....%#   #........# ', // 7
  '  #..##..#..# #....#    ####..### ', // 8
  '  #..#######  ##..#        #..#   ', // 9
  ' ##..#####  ####..#####    #..#   ', // 10
  '#........# #..........#   ##..#   ', // 11
  '#........###..........#####...#   ', // 12
  '#.............o....o..........#   ', // 13
  '#...............B...........S..#  ', // 14
  '#........###..........####....#   ', // 15
  '#........# #..o....o..#   #...#   ', // 16
  '####..###  #..........#   ####    ', // 17
  '   #..#     ####..#####           ', // 18
  '####..###   ####..####   #######  ', // 19
  '#........####.........#  #......# ', // 20
  '#..............%......####......# ', // 21
  '#...B....................L......# ', // 22
  '#........####......%..####......# ', // 23
  '#........#  #.........#  #......# ', // 24
  '#########   ##########   #######  ', // 25
];

const ROOMS = [
//              111111111122222222223333
//    0123456789012345678901234567890123
  '                                  ', // 0
  '  cc cc cc              bbbbbbbb  ', // 1
  '  cc cc cc     pppp     bbbbbbbb  ', // 2
  '              ppppp     bbbbbbbb  ', // 3
  '  cccccccccc  ppppppbbbbbbbbbbbb  ', // 4
  '  cccccccccc pppppppbbbbbbbbbbbb  ', // 5
  '              pppppp    bbbbbbbb  ', // 6
  '   gg  cc cc  ppppp     bbbbbbbb  ', // 7
  '   gg  cc cc   pppp         uu    ', // 8
  '   gg           mm          uu    ', // 9
  '   gg           mm          uu    ', // 10
  ' gggggggg   mmmmmmmmmm      uu    ', // 11
  ' gggggggg   mmmmmmmmmm     uuu    ', // 12
  ' gggggggggggmm mmmm mmmmmmuuuu    ', // 13
  ' gggggggggggmmmm mmmmmmmmmuuuuu   ', // 14
  ' gggggggg   mmmmmmmmmm    uuuu    ', // 15
  ' gggggggg   mm mmmm mm     uuu    ', // 16
  '    gg      mmmmmmmmmm            ', // 17
  '    gg          dd                ', // 18
  '    gg          dd                ', // 19
  ' ssssssss    ddddddddd    rrrrrr  ', // 20
  ' ssssssssssssddddddddd    rrrrrr  ', // 21
  ' sss ssssssssdddddddddrrr rrrrrr  ', // 22
  ' ssssssss    ddddddddd    rrrrrr  ', // 23
  ' ssssssss    ddddddddd    rrrrrr  ', // 24
  '                                  ', // 25
];

export const level2 = parseLevel(2, 'The Barracks and Cells', TILES, ROOMS, {
  m: { id: 'l2-mess-hall', name: 'Mess Hall', label: [16, 12] },
  p: { id: 'l2-pit-landing', name: 'Pit Landing', label: [16, 1] },
  c: { id: 'l2-cellblock', name: 'Cellblock', label: [6, 4] },
  g: { id: 'l2-guard-room', name: 'Guard Room', label: [5, 13] },
  b: { id: 'l2-barracks', name: 'Barracks', label: [27, 4] },
  u: { id: 'l2-undercroft', name: 'Undercroft', label: [28, 12] },
  d: { id: 'l2-drill-yard', name: 'Drill Yard', label: [17, 22] },
  s: { id: 'l2-shrine', name: 'Old Shrine', label: [5, 21] },
  r: { id: 'l2-storeroom', name: 'Storeroom', label: [28, 22] },
});
