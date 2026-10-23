// Facts derived once per CastleMap: areas (rooms and corridors), links by
// square, entrances and special rooms. Cached per map object.

import { cellAt, levelOf, neighbours, sameSquare, squareKey } from './geometry';
import type { CastleMap, Coord, LevelLink } from './types';

export interface Area {
  id: number;
  level: number;
  squares: Coord[];
  /** Holds random treasure when searched (7.2, 7.13). */
  isRoom: boolean;
  isGuardroom: boolean;
  isPrisonCell: boolean;
  isCavern: boolean;
  isPitArea: boolean;
}

export interface MapIndex {
  map: CastleMap;
  areas: Area[];
  areaBySquare: Map<string, number>;
  linksBySquare: Map<string, LevelLink[]>;
  entrances: Set<string>;
  balcony: Set<string>;
  hoard: Set<string>;
  floorSquares: Coord[];
}

const cache = new WeakMap<CastleMap, MapIndex>();

export function indexMap(map: CastleMap): MapIndex {
  const hit = cache.get(map);
  if (hit) return hit;

  const linksBySquare = new Map<string, LevelLink[]>();
  for (const link of map.links) {
    for (const end of [link.a, link.b]) {
      const k = squareKey(end);
      const list = linksBySquare.get(k) ?? [];
      list.push(link);
      linksBySquare.set(k, list);
    }
  }

  const entrances = new Set<string>();
  const balcony = new Set<string>();
  const hoard = new Set<string>();
  const floorSquares: Coord[] = [];
  for (const lv of map.levels) {
    lv.entrances.forEach((c) => entrances.add(squareKey(c)));
    lv.balcony.forEach((c) => balcony.add(squareKey(c)));
    lv.hoard.forEach((c) => hoard.add(squareKey(c)));
    for (let y = 0; y < lv.height; y++) {
      for (let x = lv.x0; x < lv.x0 + lv.width; x++) {
        const c = { level: lv.id, x, y };
        if (cellAt(map, c) === 'floor') floorSquares.push(c);
      }
    }
  }

  // Flood fill across open edges only: walls and doors bound areas.
  const areaBySquare = new Map<string, number>();
  const areas: Area[] = [];
  for (const start of floorSquares) {
    if (areaBySquare.has(squareKey(start))) continue;
    const id = areas.length;
    const squares: Coord[] = [];
    const queue = [start];
    areaBySquare.set(squareKey(start), id);
    while (queue.length) {
      const c = queue.pop()!;
      squares.push(c);
      for (const n of neighbours(map, c)) {
        if (n.edge !== 'open' || cellAt(map, n.to) !== 'floor') continue;
        const k = squareKey(n.to);
        if (areaBySquare.has(k)) continue;
        areaBySquare.set(k, id);
        queue.push(n.to);
      }
    }
    const lv = levelOf(map, start.level)!;
    const xs = squares.map((s) => s.x);
    const ys = squares.map((s) => s.y);
    const w = Math.max(...xs) - Math.min(...xs) + 1;
    const h = Math.max(...ys) - Math.min(...ys) + 1;
    const has = (pred: (c: Coord) => boolean) => squares.some(pred);
    const isGuardroom = lv.guardrooms.some((g) => has((c) => sameSquare(c, g)));
    const isPrisonCell = lv.prisonCells.some((g) => has((c) => sameSquare(c, g)));
    const isCavern = (lv.lair !== undefined && has((c) => sameSquare(c, lv.lair!))) || lv.hoard.some((g) => has((c) => sameSquare(c, g)));
    const level1 = levelOf(map, 1);
    const isPitArea =
      has((c) => balcony.has(squareKey(c))) ||
      (start.level !== 1 && level1 !== undefined && has((c) => cellAt(map, { level: 1, x: c.x, y: c.y }) === 'pit'));
    const hasLinkOrEntrance = has((c) => linksBySquare.has(squareKey(c)) || entrances.has(squareKey(c)));
    const isRoom = w >= 2 && h >= 2 && !hasLinkOrEntrance && !isGuardroom && !isCavern && !isPitArea && !isPrisonCell;
    areas.push({ id, level: start.level, squares, isRoom, isGuardroom, isPrisonCell, isCavern, isPitArea });
  }

  const index: MapIndex = { map, areas, areaBySquare, linksBySquare, entrances, balcony, hoard, floorSquares };
  cache.set(map, index);
  return index;
}

export function areaAt(index: MapIndex, c: Coord): Area | undefined {
  const id = index.areaBySquare.get(squareKey(c));
  return id === undefined ? undefined : index.areas[id];
}

/** The other end of each link from this square. */
export function linkedSquares(index: MapIndex, c: Coord): { to: Coord; link: LevelLink }[] {
  const links = index.linksBySquare.get(squareKey(c)) ?? [];
  return links.map((link) => ({ link, to: sameSquare(link.a, c) ? link.b : link.a }));
}
