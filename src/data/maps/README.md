# Map data

`classic.ts` holds levels 1 to 3 of the 1980 Valkenburg Castle map as ASCII grids. `parse.ts` turns each grid into a `LevelMap` (see `src/engine/types.ts`).

## Grid format

A level of `width` × `height` squares is written as `2*height + 1` lines of `2*width + 1` characters.

```
+-+-+-+        even lines: horizontal edges
|E .d.|        odd lines: vertical edges and cells
+ +L+-+
|. .|#|
+-+-+-+
```

- **Even lines** (0, 2, …, 2*height) are horizontal edge lines. The character at even column 2c is a corner, written `+` and ignored. The character at odd column 2c+1 is the edge above cell c of the next row.
- **Odd lines** (2r+1) are cell rows. The character at even column 2c is the edge to the left of cell c. The character at odd column 2c+1 is the cell.

Edge characters: `-` or `|` wall, space open (a dotted line on the 1980 map), `d` door, `L` locked door (the red door with two asterisks).

Cell characters: `.` floor, `#` rock, `p` pit (no floor on this level). These markers also mean floor:

| Marker | Meaning | Must also be listed in |
| --- | --- | --- |
| `G` | guardroom square | `guardrooms` |
| `S` | stairs | a link in `CLASSIC_LINKS`, or `reinforcementPoints` |
| `X` | ladder | a link in `CLASSIC_LINKS` |
| `E` | entrance | `entrances` |
| `C` | prison cell | `prisonCells` |
| `B` | balcony (ledge next to the Pit) | `balcony` |
| `D` | dragon's lair | `lair` |
| `H` | dragon's hoard | `hoard` |

Feature lists use 1980 labels such as `"H-1"`. Columns are the global 1980 letters (`x0` is the first column: 0 for A, 5 for F), so level 3 starts at F, and stairs, ladders and the Pit line up between levels.

`parseLevel` throws a `MapParseError` naming the level, line and column when:

- the line count or a line length is wrong
- a character is unknown
- the outer border isn't all walls
- an edge touching a rock cell isn't a wall
- a marker and its feature list disagree, either way round
- a listed square is outside the level or isn't floor

`formatLevel` writes a `LevelMap` back out as a grid, with markers turned into `.`.

## Transcription notes

Transcribed from the scanned map pages. Each level was checked by overlaying the grid on the scan and comparing a render (`npx tsx scripts/preview-map.ts`) with the scan, cell by cell.

- **Pit.** On levels 1 and 2 the Pit is K-4 to M-7 (12 squares, 4.9). The level 1 balcony is the 14 squares next to it. The corners J-3, N-3, J-8 and N-8 are in the same room but only touch the Pit diagonally, so they aren't balcony. Level 2's Pit room has no doors ("no access from this level"). On level 3 the Pit area is an ordinary walled room at K-4 to M-7.
- **Links.** These are the stairs and ladders between playable levels:
  - Level 1 to 2: stairs at F-4 and C-12, ladder at O-6.
  - Level 2 to 3: stairs at J-1 and G-11, ladder at P-1.

  Both ends are at the same square on each level. The stairs down to level 4 are reinforcement points: D-1 on level 2, and G-4 and I-7 on level 3.
- **Level 2 cell block.** The cells are E-8, F-8, G-8, H-8, G-10 and H-10. Each is a one-square room with a locked door onto the corridor E-9 to H-9. The corridor has two more locked doors: one to E-10 (the guardroom side) and one to I-9. E-10 and F-10 are open to the guardroom, so they aren't cells.
- **Level 3 cavern.** The rock outlines are hand-drawn and don't follow the grid. A square counts as rock when most of it is black on the scan. Squares that are part rock but mostly open stay floor, including the narrow openings P-6, P-10 and T-2 that rule 8.6 names. The cavern mouth U-5 to U-8 is the fourth entrance (4.6). The dragon's lair is S-7 and the hoard is U-1 and U-2.
- **Doors.** Doors are red squares straddling a wall line. A few are drawn off-centre or overlap a neighbour; each was assigned to the wall segment it crosses.

### Squares worth a second look

- Level 3, row 12, J to O: the bottom border is drawn as a thick black band about half a square deep. I read these as floor squares with a thick outer wall, because the dotted lines continue down into them. Rule 5.121 also has units standing in J-12 on level 3.
- Level 3, G-4 and F-5 to F-9: the rock strip down the left side is thinner than a square, so F-5 to F-9 stay floor. The wall is on the line between F and G.
- Level 2, A-2 to A-4 and M-10 to M-11: the thick black bars are walls, not rock. The squares on either side are floor.

No floor squares are unreachable: every one can be walked to from an entrance through open edges, doors (locked or not), stairs and ladders.
