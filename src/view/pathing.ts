// V3.7 (spec 20.5): a long path for free movement while the party is calm. Pure: the HUD asks
// for the path to any explored hex and sends it as one `move` command; the engine walks it hex
// by hex with its own rules, so this only has to be a sensible route (shortest by cost,
// rubble 2, stairs 1, a working lift 1, through open doors only, round monsters).

import type { Visibility } from '../game/api';
import { hexKey, posKey, posNeighbors, samePos, type Pos } from '../game/hex';
import type { CastleDef, GameState } from '../game/types';
import { linkAt } from './links';

const STAND = new Set(['floor', 'rubble', 'door', 'stairs', 'exit', 'lift']);

/** Can a hero stand on this hex now (map and delve state; not whether something stands there)? */
export function standable(castle: CastleDef, s: GameState, p: Pos): boolean {
  const d = s.delve;
  const t = castle.levels.find((l) => l.level === p.level)?.tiles[hexKey(p)];
  if (!t || !d) return false;
  const k = posKey(p);
  if (t.kind === 'door') {
    const door = d.doors[k];
    return !!door && door.open;
  }
  if (t.kind === 'wall') return d.blown.includes(k);
  if (t.kind === 'cracked') return d.blown.includes(k);
  if (t.kind === 'prop') return (d.smashed ?? []).includes(k);
  return STAND.has(t.kind);
}

/**
 * Shortest route from the hero to `to` over explored hexes, or null. Monsters block; other heroes
 * may be passed (they step aside, or follow) but not ended on. Stairs and a working lift join
 * levels. Capped at `maxCost` so a hopeless search stays cheap.
 */
export function longPath(castle: CastleDef, s: GameState, vis: Visibility, heroId: string, to: Pos, maxCost = 80): Pos[] | null {
  const d = s.delve;
  const h = d?.heroes.find((x) => x.heroId === heroId);
  if (!d || !h || samePos(h.at, to)) return null;
  if (!standable(castle, s, to) || !(vis.explored.has(posKey(to)) || vis.visible.has(posKey(to)))) return null;
  if (d.heroes.some((o) => o.status !== 'out' && o.status !== 'dead' && o.status !== 'captured' && o.heroId !== heroId && samePos(o.at, to))) return null;
  return longPaths(castle, s, vis, heroId, maxCost, to).get(posKey(to)) ?? null;
}

/** Every explored hex the hero can walk to while calm, with its path (one Dijkstra); `goal` stops the search early. */
export function longPaths(castle: CastleDef, s: GameState, vis: Visibility, heroId: string, maxCost = 80, goal?: Pos): Map<string, Pos[]> {
  const out = new Map<string, Pos[]>();
  const d = s.delve;
  const h = d?.heroes.find((x) => x.heroId === heroId);
  if (!d || !h) return out;
  const blocked = new Set<string>();
  for (const m of d.monsters) if (m.hp > 0 && !m.buried) blocked.add(posKey(m.at));
  for (const r of d.rivals?.members ?? []) if (r.hp > 0 && !r.goneOut && d.round >= d.rivals!.entersRound) blocked.add(posKey(r.at));
  if (d.prisoner && !d.prisoner.out && !d.prisoner.dead && !d.prisoner.freed) blocked.add(posKey(d.prisoner.at));
  const cost = (p: Pos) => (castle.levels.find((l) => l.level === p.level)?.tiles[hexKey(p)]?.kind === 'rubble' || (d.blown.includes(posKey(p)) && castle.levels.find((l) => l.level === p.level)?.tiles[hexKey(p)]?.kind === 'wall') ? 2 : 1);
  const start = posKey(h.at);
  const goalKey = goal ? posKey(goal) : null;
  const dist = new Map<string, number>([[start, 0]]);
  const prev = new Map<string, Pos>();
  const open: { p: Pos; c: number }[] = [{ p: h.at, c: 0 }];
  const seen = new Set<string>();
  const occupied = new Set(d.heroes.filter((o) => o.status !== 'out' && o.status !== 'dead' && o.status !== 'captured' && o.heroId !== heroId).map((o) => posKey(o.at)));
  while (open.length) {
    open.sort((a, b) => a.c - b.c);
    const cur = open.shift()!;
    const ck = posKey(cur.p);
    if (seen.has(ck)) continue;
    seen.add(ck);
    if (ck === goalKey) break;
    if (cur.c > maxCost) break;
    const nexts: Pos[] = posNeighbors(cur.p);
    const link = linkAt(castle, cur.p);
    if (link && (link.kind === 'stairs' || d.liftWorking)) nexts.push(link.to);
    for (const n of nexts) {
      const nk = posKey(n);
      if (seen.has(nk) || blocked.has(nk)) continue;
      if (!standable(castle, s, n)) continue;
      if (!(vis.explored.has(nk) || vis.visible.has(nk))) continue;
      const c = cur.c + cost(n);
      if (c < (dist.get(nk) ?? Infinity)) {
        dist.set(nk, c);
        prev.set(nk, cur.p);
        open.push({ p: n, c });
      }
    }
  }
  for (const k of seen) {
    if (k === start || occupied.has(k)) continue;
    const path: Pos[] = [];
    let at: Pos | undefined = parse(k);
    while (at && posKey(at) !== start) {
      path.unshift(at);
      at = prev.get(posKey(at));
    }
    if (path.length) out.set(k, path);
  }
  return out;
}

function parse(k: string): Pos {
  const [l, rest] = k.split(':');
  const [q, r] = (rest ?? '0,0').split(',').map(Number);
  return { level: Number(l), q: q ?? 0, r: r ?? 0 };
}

/** "the castle turns in N steps": steps left before the next world phase while calm. */
export function stepsToTurn(calmSteps: number | undefined, per: number): number {
  const n = calmSteps ?? 0;
  return per - (n % per);
}
