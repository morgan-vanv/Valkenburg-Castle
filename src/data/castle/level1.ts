// Level 1: the Ruined Keep. The upper floor of the Van Valkenburg seat,
// roofless in places and empty for generations. The great hall is the hub;
// the pit balcony, kitchens, tower and gatehouse ring it, so a party can
// always circle around trouble. Format: see parse.ts.
//
// Rooms: a pit balcony, b east breach, C east gallery, c chapel, g great hall,
// h gatehouse, k kitchens, L west gallery, l old library, t tower stair,
// y courtyard ruin, a armory.

import { parseLevel } from './parse';

const TILES = [
//              111111111122222222223333
//    0123456789012345678901234567890123
  '              ######     ######## ', // 0
  ' ########    #.....#    #.......# ', // 1
  ' #.......#   #......#   #.o.B.o.# ', // 2
  ' #..o.o..####..^^^..#####.......# ', // 3
  ' #..........#..^OO^.............# ', // 4
  ' #............^OOO^.............# ', // 5
  ' #..o.o..####..^OO^..####.......# ', // 6
  ' #.......#  #..^^^..#   #.......# ', // 7
  '  ##+#####   #......#    ###+#### ', // 8
  '   #..#      #.....#       #..#   ', // 9
  ' ###..####  ####..#####   ##..#   ', // 10
  '#........# #..........#  #....#   ', // 11
  '#.o......###..........####.....###', // 12
  'E.............o....o...........%%E', // 13
  'E...............B...........S...%E', // 14
  '#........###..........###......###', // 15
  '#........# #..o....o..#  #.....#  ', // 16
  '####..###  #..........#  #....#   ', // 17
  '   #..#     ####..#####   ##.##   ', // 18
  '####..####     #..#        #L#    ', // 19
  '#.........#   ##..###     ##.#### ', // 20
  '#..%%...%.####o....o#    #......# ', // 21
  '#....%..........B...#    #......# ', // 22
  '#......%............#    #......# ', // 23
  '#.%.......####......#    #......# ', // 24
  '##########   ###EE##     #######  ', // 25
];

const ROOMS = [
//              111111111122222222223333
//    0123456789012345678901234567890123
  '                                  ', // 0
  '              ppppp      ccccccc  ', // 1
  '  lllllll     pppppp     c c c c  ', // 2
  '  ll l ll    ppppppp     ccccccc  ', // 3
  '  lllllllLLL ppp  pppCCCCccccccc  ', // 4
  '  lllllllLLLppp   pppCCCCccccccc  ', // 5
  '  ll l ll    ppp  ppp    ccccccc  ', // 6
  '  lllllll    ppppppp     ccccccc  ', // 7
  '              pppppp              ', // 8
  '    ll        ppppp         tt    ', // 9
  '    ll          gg          tt    ', // 10
  ' kkkkkkkk   gggggggggg    tttt    ', // 11
  ' k kkkkkk   gggggggggg    ttttt   ', // 12
  'kkkkkkkkkkkkgg gggg gggggttttttbbb', // 13
  'kkkkkkkkkkkkgggg ggggggggtttttttbb', // 14
  ' kkkkkkkk   gggggggggg   tttttt   ', // 15
  ' kkkkkkkk   gg gggg gg    ttttt   ', // 16
  '    kk      gggggggggg    tttt    ', // 17
  '    kk          hh          t     ', // 18
  '    kk          hh                ', // 19
  ' yyyyyyyyy      hh          a     ', // 20
  ' yyyyyyyyy     hhhh       aaaaaa  ', // 21
  ' yyyyyyyyyyyyyhh hhh      aaaaaa  ', // 22
  ' yyyyyyyyyyyyyhhhhhh      aaaaaa  ', // 23
  ' yyyyyyyyy    hhhhhh      aaaaaa  ', // 24
  '                hh                ', // 25
];

export const level1 = parseLevel(1, 'The Ruined Keep', TILES, ROOMS, {
  g: { id: 'l1-great-hall', name: 'Great Hall', label: [16, 12] },
  p: { id: 'l1-pit-balcony', name: 'Pit Balcony', label: [16, 1] },
  l: { id: 'l1-library', name: 'Old Library', label: [5, 4] },
  L: { id: 'l1-west-gallery', name: 'West Gallery', label: [10, 4] },
  C: { id: 'l1-east-gallery', name: 'East Gallery', label: [22, 4] },
  c: { id: 'l1-chapel', name: 'Chapel', label: [28, 5] },
  k: { id: 'l1-kitchens', name: 'Kitchens', label: [5, 13] },
  t: { id: 'l1-tower', name: 'Tower Stair', label: [28, 12] },
  b: { id: 'l1-breach', name: 'East Breach', label: [32, 14] },
  y: { id: 'l1-courtyard', name: 'Courtyard Ruin', label: [5, 22] },
  h: { id: 'l1-gatehouse', name: 'Gatehouse', label: [17, 23] },
  a: { id: 'l1-armory', name: 'Armory', label: [28, 21] },
});
