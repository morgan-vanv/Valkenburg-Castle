// Static castle indexes plus geometry that depends on the delve's runtime
// state: tiles, doors, line of sight, light, sight and path finding.

import { DIRS, distance, hexKey, hexToWorld, line, posKey, posNeighbors, range, samePos, worldToHex, type Hex, type Pos } from './hex';
import type { Brightness, CastleDef, HeroInDelve, Item, LevelDef, LightDef, TileDef, TileKind } from './types';
import type { DelveX } from './state';
import { DARK_SIGHT, FIXED_LIGHT_SIGHT, LIGHT_BRIGHT, LIGHT_DIM, LIGHT_MAX, MONSTER_DARK_SIGHT, MONSTER_SIGHT } from './data';
import { GLOW_ARROW_RADIUS } from './data'; // V4.1 (WS6)
import { CREW_LIGHT_RADIUS, LANTERN_LOW_AT, LANTERN_MAX, LANTERN_RADIUS_FULL, LANTERN_RADIUS_LOW, NIGHTEYE_ALE, TORCH_RADIUS, TORCH_ROUNDS } from './data'; // V4.1 (WS2)
import { PEEK_RANGE, STAIR_CROSS_COST } from './data'; // V5.0 (spec 32.15)

export class World {
  readonly levels = new Map<number, LevelDef>();
  readonly stairs = new Map<string, Pos>();
  /** Lift ends, by posKey, to the other end. Usable once the winch is worked. */
  readonly lifts = new Map<string, Pos>();
  /** Winch hexes (tallprops), by posKey. */
  readonly winches: Pos[] = [];
  readonly exits: Pos[] = [];
  readonly floors = new Map<number, Pos[]>();
  /** Fire vents: walkable hexes with a radius-1 'fire' light. */
  readonly vents = new Set<string>();
  /** Solid hexes that burn (the forge): a 'fire' light on a non-walkable hex. */
  readonly fires = new Set<string>();
  /** Fixed lit hexes, cached by door/blown state. */
  fixedCache: { key: string; lit: Set<string>; day?: Set<string> } | null = null;

  constructor(readonly castle: CastleDef) {
    for (const l of castle.levels) {
      this.levels.set(l.level, l);
      const fl: Pos[] = [];
      for (const [k, t] of Object.entries(l.tiles)) {
        const [q, r] = k.split(',').map(Number) as [number, number];
        const p = { level: l.level, q, r };
        if (t.kind === 'exit') this.exits.push(p);
        if (t.kind === 'floor') fl.push(p);
      }
      this.floors.set(l.level, fl);
    }
    for (const link of castle.links) {
      if (link.kind === 'stairs') {
        this.stairs.set(posKey(link.a), link.b);
        this.stairs.set(posKey(link.b), link.a);
      } else if (link.kind === 'lift') {
        this.lifts.set(posKey(link.a), link.b);
        this.lifts.set(posKey(link.b), link.a);
        this.winches.push(link.winch);
      }
    }
    for (const L of castle.lights ?? []) {
      const k = this.tile(L.at)?.kind;
      if (L.kind !== 'fire') continue;
      if (k && FLOORISH.includes(k)) {
        if (L.radius === 1) this.vents.add(posKey(L.at));
      } else this.fires.add(posKey(L.at));
    }
    for (const t of castle.levels.flatMap((l) => Object.entries(l.tiles).map(([k, d]) => [l.level, k, d] as const))) {
      const [lv, k, d] = t;
      if (d.kind === 'tallprop' && d.prop === 'forge') this.fires.add(`${lv}:${k}`);
    }
  }

  levelName(level: number): string {
    const n = this.levels.get(level)?.name ?? `Level ${level}`;
    return n.replace(/^The /, 'the ');
  }

  /** Room id of a hex, if any. */
  roomOf(p: Pos): string | undefined {
    return this.tile(p)?.room;
  }

  tile(p: Pos): TileDef | undefined {
    return this.levels.get(p.level)?.tiles[hexKey(p)];
  }

  roomName(p: Pos): string {
    const l = this.levels.get(p.level);
    const t = this.tile(p);
    const room = l?.rooms.find((r) => r.id === t?.room);
    return room ? room.name : (l?.name ?? `Level ${p.level}`);
  }
}

/** Tile kind at p with runtime changes (blown cracked walls are floor; a blasted built wall or floor is rubble until dug; collapsed floor is a pit, spec 20.3). */
export function kindAt(w: World, d: DelveX | null, p: Pos): TileKind | undefined {
  const t = w.tile(p);
  if (!t) return undefined;
  if (!d) return t.kind;
  const key = posKey(p);
  // V3.7 (spec 20.3a): floor blown into the pit column is a pit; floor blown to rubble is rubble until dug.
  if (t.kind === 'floor' && d.collapsed?.includes(key)) return 'pit';
  if (t.kind === 'floor' && d.blown.includes(key)) return d.dug?.includes(key) ? 'floor' : 'rubble';
  if ((t.kind === 'cracked' || t.kind === 'rubble') && d.blown.includes(key)) return 'floor';
  if (t.kind === 'wall' && d.blown.includes(key)) return d.dug?.includes(key) ? 'floor' : 'rubble';
  // V3.7 (spec 20.5): a smashed crate or barrel is floor.
  if (t.kind === 'prop' && d.smashed?.includes(posKey(p))) return 'floor';
  return t.kind;
}

const FLOORISH: TileKind[] = ['floor', 'rubble', 'stairs', 'exit', 'door', 'lift'];

/** Can feet stand here at all (ignoring doors' state and occupants)? */
export function isFloorish(w: World, d: DelveX | null, p: Pos): boolean {
  const k = kindAt(w, d, p);
  return k !== undefined && FLOORISH.includes(k);
}

export function doorAt(d: DelveX, p: Pos) {
  return d.doors[posKey(p)];
}

/** Hero/monster can step in (doors: open, or closed and unlocked = opens on the way). */
export function canEnter(w: World, d: DelveX, p: Pos, allowLocked = false): boolean {
  const k = kindAt(w, d, p);
  if (!k || !FLOORISH.includes(k)) return false;
  if (k === 'door') {
    const door = doorAt(d, p);
    if (door && !door.open && door.locked && !allowLocked) return false;
  }
  return true;
}

/** Solid for sight by terrain: walls, pillars, cracked walls, tall props, sealed doors, closed doors, void. */
export function solidForSight(w: World, d: DelveX, p: Pos): boolean {
  const k = kindAt(w, d, p);
  if (k === undefined) return true;
  if (k === 'wall' || k === 'pillar' || k === 'cracked' || k === 'tallprop' || k === 'sealed') return true;
  if (k === 'door') return !doorAt(d, p)?.open;
  return false;
}

/** Smoke on this hex (spec 15.4). */
export function smoky(d: DelveX, p: Pos): boolean {
  return (d.smoke?.[posKey(p)] ?? 0) > 0;
}

export function blocksSight(w: World, d: DelveX, p: Pos, smoke = true): boolean {
  return solidForSight(w, d, p) || (smoke && smoky(d, p));
}

/** Target points: the hex center, then its 6 corners pulled 10% toward the center (spec 15.1). */
const CORNERS = Array.from({ length: 6 }, (_, i) => {
  const a = (Math.PI / 180) * (60 * i - 30);
  return { x: 0.9 * Math.cos(a), z: 0.9 * Math.sin(a) };
});
const POINTS = [{ x: 0, z: 0 }, ...CORNERS];

/** The integer hex line (cheap): the usual case in open rooms. */
function clearLine(w: World, d: DelveX, a: Pos, b: Pos, smoke: boolean): boolean {
  const hs = line(a, b);
  for (let i = 1; i < hs.length - 1; i++) {
    if (blocksSight(w, d, { level: a.level, ...hs[i]! }, smoke)) return false;
  }
  return true;
}

function clearSegment(w: World, d: DelveX, a: Pos, b: Pos, bx: number, bz: number, smoke: boolean): boolean {
  const A = hexToWorld(a);
  const n = Math.max(2, Math.ceil(distance(a, b) * 4));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const h = worldToHex(A.x + (bx - A.x) * t, A.z + (bz - A.z) * t);
    if ((h.q === a.q && h.r === a.r) || (h.q === b.q && h.r === b.r)) continue;
    if (blocksSight(w, d, { level: a.level, q: h.q, r: h.r }, smoke)) return false;
  }
  return true;
}

/**
 * Permissive line of sight (spec 15.1) from viewer `a` to target `b` on the same level:
 * clear if the segment from a's center to b's center, or to any of b's corners pulled 10%
 * toward its center, crosses no blocking hex (the end hexes never block). Pits don't block;
 * closed doors, tall props and (when `smoke`) smoke do.
 */
export function los(w: World, d: DelveX, a: Pos, b: Pos, smoke = true): boolean {
  if (a.level !== b.level) return false;
  if (distance(a, b) <= 1) return true;
  if (clearLine(w, d, a, b, smoke)) return true;
  const B = hexToWorld(b);
  for (const c of POINTS) if (clearSegment(w, d, a, b, B.x + c.x, B.z + c.z, smoke)) return true;
  return false;
}

/** Light passes smoke (smoke blocks sight, not light). */
function lightLos(w: World, d: DelveX, a: Pos, b: Pos): boolean {
  return los(w, d, a, b, false);
}

/**
 * Spec 15.1: walls, pillars, tall props (and other solid hexes) next to a seen floor hex
 * are seen too, so rooms don't show holes in their walls.
 */
export function addEdgeWalls(w: World, d: DelveX, seen: Set<string>): void {
  const add: string[] = [];
  for (const k of seen) {
    const p = parsePos(k);
    if (solidForSight(w, d, p)) continue;
    for (const n of posNeighbors(p)) {
      const nk = posKey(n);
      if (seen.has(nk) || !w.tile(n)) continue;
      if (solidForSight(w, d, n) || kindAt(w, d, n) === 'brazier' || kindAt(w, d, n) === 'prop') add.push(nk);
    }
  }
  for (const k of add) seen.add(k);
}

function parsePos(k: string): Pos {
  const [lv, rest] = k.split(':');
  const [q, r] = (rest ?? '0,0').split(',').map(Number) as [number, number];
  return { level: Number(lv), q, r };
}

// ---------------------------------------------------------------- facing (spec 20.1, 24.1, 24.2)

/** The DIRS index nearest to the direction from `from` to `to` (exact for neighbours; ties go to the lower index). */
export function dirIndex(from: Hex, to: Hex): number {
  const A = hexToWorld(from);
  const B = hexToWorld(to);
  const vx = B.x - A.x;
  const vz = B.z - A.z;
  let best = 0;
  let bestDot = -Infinity;
  DIRS.forEach((d, i) => {
    const D = hexToWorld(d);
    const dot = D.x * vx + D.z * vz;
    if (dot > bestDot + 1e-9) {
      bestDot = dot;
      best = i;
    }
  });
  return best;
}

/**
 * V3.9 (spec 24.1, 24.2): the front half: the three hex directions centred on `facing` (dirIndex of the
 * offset, as the view's dirIndexOf). Everything else on the level is the rear half. No facing: all round.
 */
export function inFrontHalf(f: { at: Pos; facing?: number; cone?: boolean }, p: Pos): boolean {
  if (f.facing === undefined || samePos(p, f.at)) return true;
  if (p.level !== f.at.level) return false;
  const i = dirIndex(f.at, p);
  // V3.9.2 (spec 24.7): heroes and crew members are blind only in a cone straight behind (one direction);
  // monsters keep the whole rear half blind.
  if (blindCone(f)) return i !== (f.facing + 3) % 6;
  return i === f.facing || i === (f.facing + 1) % 6 || i === (f.facing + 5) % 6;
}

/** V3.9.2 (spec 24.7): heroes (`heroId`) and crew members (`crew`) have a narrow blind cone; monsters a blind half. */
export function blindCone(f: object): boolean {
  return 'heroId' in f || 'crew' in f || (f as { cone?: boolean }).cone === true;
}

/**
 * Can a hero at `from` see hex `p` right now: within 1, or in line of sight and either
 * within the sight range or lit (up to LIT_SIGHT). A smoked hex is only seen from next to it.
 */
export function seesHex(w: World, d: DelveX, from: Pos, p: Pos, lit: Set<string>, facing?: number): boolean {
  if (from.level !== p.level) return false;
  if (!inFrontHalf({ at: from, facing, cone: true }, p)) return false; // V3.9 (spec 24.2, 24.7): not in the blind cone
  const dist = distance(from, p);
  if (dist <= 1) return true;
  if (smoky(d, p)) return false;
  if (dist > LIT_SIGHT) return false;
  if (dist > sightRangeAt(w, d, from, lit) && !farLitTest(w, d, lit)(posKey(p))) return false;
  return los(w, d, from, p);
}

/** Lantern stage by oil (spec 16.2): bright > 12, dim 7..12, dark 1..6, pitch 0. */
export function brightnessOf(light: number): Brightness {
  if (light > LIGHT_BRIGHT) return 'bright';
  if (light >= LIGHT_DIM) return 'dim';
  if (light >= 1) return 'dark';
  return 'pitch';
}

/**
 * Monster sight (spec 16.1): within MONSTER_SIGHT and line of sight, and the hero is lit or
 * within MONSTER_DARK_SIGHT. In the Hollow (level 3) light doesn't matter. Smoke hides beyond 1.
 */
export function monsterSees(w: World, d: DelveX, from: Pos, t: Pos, lit: Set<string>): boolean {
  if (from.level !== t.level) return false;
  const dist = distance(from, t);
  if (dist > MONSTER_SIGHT) return false;
  if (dist > 1 && (smoky(d, t) || smoky(d, from))) return false;
  if (from.level !== 3 && dist > MONSTER_DARK_SIGHT && !lit.has(posKey(t))) return false;
  return los(w, d, from, t);
}

/** Kept for old callers (the HUD's legend): the V3.3 lantern's radius by stage. V4.1 (WS2): the lantern is an item, see `lanternRadius`. */
export const LANTERN_RADIUS: Record<Brightness, number> = { bright: 4, dim: 3, dark: 2, pitch: 0 };

// ---------------------------------------------------------------- V4.1 (WS2): light sources

/** Rounds of light left in a torch or lantern item (absent = full: a fresh torch, a lantern refilled in camp). */
export function roundsOf(i: Item): number {
  if (i.rounds !== undefined) return i.rounds;
  return i.kind === 'lantern' ? LANTERN_MAX : TORCH_ROUNDS;
}

/** The most a torch or lantern holds. */
export function roundsMax(i: Item): number {
  return i.kind === 'lantern' ? LANTERN_MAX : TORCH_ROUNDS;
}

/** A torch or lantern (the things that make party light). */
export function isLightItem(i: Item): boolean {
  return i.kind === 'torch' || i.kind === 'lantern';
}

/** Is this torch lit, or this lantern open with light left? */
export function burning(i: Item): boolean {
  return isLightItem(i) && !!i.lit && roundsOf(i) > 0;
}

/** Radius a burning torch or lantern lights (the lantern 4 at LANTERN_LOW_AT and above, 3 below); 0 when out. */
export function lightRadius(i: Item): number {
  if (!burning(i)) return 0;
  if (i.kind === 'torch') return TORCH_RADIUS;
  return roundsOf(i) >= LANTERN_LOW_AT ? LANTERN_RADIUS_FULL : LANTERN_RADIUS_LOW;
}

/** One light in the castle right now: who or what carries it, where, how far it reaches; `party` = the party's own light. */
export interface LightSrc {
  at: Pos;
  radius: number;
  party: boolean;
  /** torch, lantern (an item: held by `holder`, or lying on the ground), glow (Glowworm Pale), crew, brazier; V4.1 (WS6) arrow: a glow arrow (on `holder`, or where it landed). */
  kind: 'torch' | 'lantern' | 'glow' | 'crew' | 'brazier' | 'arrow';
  /** V4.1 (WS6): a glow arrow's rounds left. */
  rounds?: number;
  holder?: string;
  item?: Item;
}

function alive(h: { status: string }): boolean {
  return h.status === 'active' || h.status === 'downed';
}

/**
 * V4.1 (WS2): every light that moves or burns down: torches and lanterns in the packs of heroes on the map (active or
 * downed) and lying on the ground, Glowworm drinkers, crew members (each carries its own, CREW_LIGHT_RADIUS) and lit
 * braziers. Fixed castle lights and burning hexes are added by `litSet`.
 */
export function lightSources(d: DelveX): LightSrc[] {
  const out: LightSrc[] = [];
  for (const h of d.heroes) {
    if (!alive(h)) continue;
    for (const i of h.pack) {
      const r = lightRadius(i);
      if (r > 0) out.push({ at: h.at, radius: r, party: true, kind: i.kind as 'torch' | 'lantern', holder: h.heroId, item: i });
    }
    // Spec 18.4: Glowworm Pale: the drinker sheds light radius 1.
    if (h.ale === 'glowworm') out.push({ at: h.at, radius: 1, party: true, kind: 'glow', holder: h.heroId });
  }
  for (const g of d.ground) {
    for (const i of g.items) {
      const r = lightRadius(i);
      if (r > 0) out.push({ at: g.at, radius: r, party: true, kind: i.kind as 'torch' | 'lantern', item: i });
    }
  }
  const cr = d.rivals;
  // V4.1 (WS7, spec 31.9): a cutthroat crew waiting at its post keeps its lights hooded (an ambush in the dark, Level 2's
  // lesson); they uncover them once they demand the toll or fight.
  const hooded = !!cr && cr.temperament === 'cutthroat' && cr.stance === 'waiting';
  if (cr && cr.entered && !hooded) for (const r of cr.members) if (!r.goneOut && r.hp > 0) out.push({ at: r.at, radius: CREW_LIGHT_RADIUS, party: false, kind: 'crew', holder: r.id });
  for (const k of d.lit) out.push({ at: parsePos(k), radius: 3, party: false, kind: 'brazier' });
  // V4.1 (WS6, spec 31.8): glow arrows: radius 2 where they landed, or on the figure they stuck in (it carries the light).
  // Not party light: a hero lit only by one stands in castle light (−10, sight 4/3/2), but monsters see them and the Gloam shies.
  for (const g of d.glows ?? []) {
    if (g.rounds <= 0) continue;
    const on = g.on ? glowHolderAt(d, g.on) : undefined;
    out.push({ at: on ?? g.at, radius: GLOW_ARROW_RADIUS, party: false, kind: 'arrow', ...(on && g.on ? { holder: g.on } : {}), rounds: g.rounds });
  }
  return out;
}

/** V4.1 (WS6): where the figure a glow arrow stuck in stands now (monster, crew member up or down, hero on the map). */
function glowHolderAt(d: DelveX, id: string): Pos | undefined {
  const m = d.monsters.find((x) => x.id === id && !x.buried);
  if (m) return m.at;
  const r = d.rivals?.members.find((x) => x.id === id && !x.goneOut && (x.hp > 0 || x.downed));
  if (r) return r.at;
  return d.heroes.find((x) => x.heroId === id && (x.status === 'active' || x.status === 'downed'))?.at;
}

/** Does this hero carry burning party light (a lit torch, an open lantern with light left, Glowworm)? */
export function emitsLight(h: HeroInDelve): boolean {
  return h.ale === 'glowworm' || h.pack.some(burning);
}

/**
 * A cheap signature of what lights the castle (for caches). `moving` false leaves out where carried lights are and the
 * crews' lights: what changes only when a light is lit, put out, dropped, burns out or a lantern runs low ("the light changed").
 */
export function lightSig(d: DelveX, moving = true): string {
  return lightSources(d)
    .filter((L) => moving || L.kind !== 'crew')
    .map((L) => `${L.kind}${L.holder ?? ''}${moving || !L.holder ? `@${posKey(L.at)}` : ''}/${L.radius}`)
    .join(';');
}

/** Kept for old callers: where the V3.3 party lantern is (V4.1: the first hero carrying a burning lantern), or null. */
export function lanternPos(d: DelveX): Pos | null {
  const L = lightSources(d).find((x) => x.kind === 'lantern' && x.holder);
  return L ? L.at : null;
}

/** Every lit hex, by posKey. */
export function litSet(w: World, d: DelveX): Set<string> {
  const out = new Set<string>();
  for (const L of lightSources(d)) {
    for (const h of range(L.at, L.radius)) {
      const p = { level: L.at.level, ...h };
      if (!w.tile(p)) continue;
      if (lightLos(w, d, L.at, p)) out.add(posKey(p));
    }
  }
  for (const k of fixedLit(w, d)) out.add(k);
  // Burning hexes (fireball) light themselves.
  for (const [k, n] of Object.entries(d.burning ?? {})) if (n > 0) out.add(k);
  return out;
}

/** Hexes lit for good by the castle's fixed lights (sconces, daylight, fires, fungus, glow). */
export function fixedLit(w: World, d: DelveX): Set<string> {
  return fixedLights(w, d).lit;
}

function fixedLights(w: World, d: DelveX): { lit: Set<string>; day: Set<string> } {
  const lights: LightDef[] = w.castle.lights ?? [];
  if (!lights.length) return { lit: new Set(), day: new Set() };
  const key = Object.entries(d.doors).filter(([, v]) => v.open).map(([k]) => k).sort().join('|') + '#' + [...d.blown].sort().join('|');
  if (w.fixedCache && w.fixedCache.key === key && w.fixedCache.day) return { lit: w.fixedCache.lit, day: w.fixedCache.day };
  const out = new Set<string>();
  const day = new Set<string>();
  for (const L of lights) {
    for (const h of range(L.at, L.radius)) {
      const p = { level: L.at.level, ...h };
      if (!w.tile(p)) continue;
      if (lightLos(w, d, L.at, p)) {
        out.add(posKey(p));
        if (L.kind === 'daylight') day.add(posKey(p));
      }
    }
  }
  w.fixedCache = { key, lit: out, day };
  return { lit: out, day };
}

/**
 * What a hero can make out beyond their own sight range (spec 17.4): daylight floods the
 * ground it falls on, so every daylit hex counts; anywhere else only the lights themselves
 * show (a fire, a fungus cluster, the pit glow, a lit brazier, a burning hex, another
 * hero's lantern or torch), not the floor around them. Only hexes that are lit right now.
 */
export function farLit(w: World, d: DelveX, lit: Set<string> = litSet(w, d)): Set<string> {
  const test = farLitTest(w, d, lit);
  return new Set([...lit].filter(test));
}

/** `farLit` as a membership test, without building the set (hot path: visibleSet). */
export function farLitTest(w: World, d: DelveX, lit: Set<string>): (k: string) => boolean {
  const day = fixedLights(w, d).day;
  const src = new Set<string>();
  for (const L of w.castle.lights ?? []) if (L.kind !== 'daylight') src.add(posKey(L.at));
  for (const [k, n] of Object.entries(d.burning ?? {})) if (n > 0) src.add(k);
  // V4.1 (WS2): every carried or dropped torch and lantern, Glowworm drinkers, crew members' lights, lit braziers.
  for (const L of lightSources(d)) src.add(posKey(L.at));
  return (k) => lit.has(k) && (day.has(k) || src.has(k));
}

/** Sight range by lantern stage and depth (spec 14.5): bright 8, dim 6, dark 4, pitch 2; −1 per level below 1; never below 2. */
export const SIGHT_BY_STAGE: Record<Brightness, number> = { bright: 8, dim: 6, dark: 4, pitch: 2 };
export function sightRangeOf(light: number, level: number): number {
  return Math.max(2, SIGHT_BY_STAGE[brightnessOf(light)] - Math.max(0, level - 1));
}

/**
 * V4.1 (WS2): what lights a hex, for darkness by the hero's own hex: `party` (a torch, a lantern, Glowworm, a torch or
 * lantern lying lit), `day` (daylight), `castle` (only a castle light: sconce, fire, brazier, fungus, glow, a burning hex,
 * a crew member's light), `unlit`.
 */
export type LightTier = 'party' | 'day' | 'castle' | 'unlit';
export function lightTierAt(w: World, d: DelveX, at: Pos, lit: Set<string> = litSet(w, d)): LightTier {
  const k = posKey(at);
  if (!lit.has(k)) return 'unlit';
  if (partyLights(w, d, at)) return 'party';
  if (fixedLights(w, d).day.has(k)) return 'day';
  return 'castle';
}

/** V4.1 (WS2): Night-eye Stout (ale effect `nighteye`), or the old night-eye draught's rounds (saves from before). */
export function nightEyedHero(h: HeroInDelve): boolean {
  return h.status === 'active' && (h.ale === NIGHTEYE_ALE || (h.nightEyes ?? 0) > 0);
}

/**
 * Sight range of someone standing at `at` (V4.1, WS2). Party light or daylight: 8/7/6 by level (the old bright row);
 * a castle light only: FIXED_LIGHT_SIGHT minus depth (4/3/2); unlit: the level's dark range (4/2/1). A night-eyed hero
 * standing here sees as if lit by party light.
 */
export function sightRangeAt(w: World, d: DelveX, at: Pos, lit: Set<string> = litSet(w, d)): number {
  if (d.heroes.some((h) => nightEyedHero(h) && samePos(h.at, at))) return nightSightRange(at.level);
  const tier = lightTierAt(w, d, at, lit);
  if (tier === 'unlit') return DARK_SIGHT[at.level] ?? 1;
  if (tier === 'party' || tier === 'day') return nightSightRange(at.level);
  return Math.max(2, FIXED_LIGHT_SIGHT - Math.max(0, at.level - 1));
}

/** The party-light sight range: the bright-stage range minus depth (8/7/6). */
export function nightSightRange(level: number): number {
  return Math.max(2, SIGHT_BY_STAGE.bright - Math.max(0, level - 1));
}

/** Does the party's own light (a torch or lantern carried or lying lit, Glowworm) reach `at`? */
export function partyLights(w: World, d: DelveX, at: Pos): boolean {
  for (const L of lightSources(d)) {
    if (!L.party || L.at.level !== at.level || distance(L.at, at) > L.radius) continue;
    if (lightLos(w, d, L.at, at)) return true;
  }
  return false;
}

/**
 * V4.1 (WS2, the board's "Unlit" chip): does any fixed castle light (sconce, daylight, fire, fungus, glow, or a
 * brazier relit for good) reach `at`, with every door open? No delve needed.
 */
export function fixedLightReaches(w: World, at: Pos, braziers: string[] = []): boolean {
  for (const L of w.castle.lights ?? []) {
    if (L.at.level !== at.level || distance(L.at, at) > L.radius) continue;
    if (openLos(w, L.at, at)) return true;
  }
  for (const k of braziers) {
    const b = parsePos(k);
    if (b.level === at.level && distance(b, at) <= 3 && openLos(w, b, at)) return true;
  }
  return false;
}

/** Line of light with every door open (the castle as built). */
function openLos(w: World, a: Pos, b: Pos): boolean {
  const d = { doors: new Proxy({}, { get: () => ({ open: true, locked: false, jammed: false }) }), blown: [], burning: {}, smoke: {}, lit: [] } as unknown as DelveX;
  return lightLos(w, d, a, b);
}
/** Far lights (see `farLit`) in line of sight are visible from this far, whatever the sight range. */
export const LIT_SIGHT = 14;

/**
 * Hexes whose layout a hero at `from` can make out: every tile in line of
 * sight within the sight range, lit or not, in the front half of `facing` (none: all round).
 */
export function glimpseSet(w: World, d: DelveX, from: Pos, lit?: Set<string>, facing?: number): Pos[] {
  const seen = new Set<string>();
  const eye = { at: from, facing, cone: true }; // a hero's eyes (spec 24.7)
  for (const h of range(from, sightRangeAt(w, d, from, lit))) {
    const p = { level: from.level, ...h };
    // V3.9 (spec 24.2): only the front half, adjacent hexes included.
    if (!inFrontHalf(eye, p)) continue;
    if (w.tile(p) && (distance(from, p) <= 1 || (!smoky(d, from) && los(w, d, from, p)))) seen.add(posKey(p));
  }
  addEdgeWalls(w, d, seen);
  return [...seen].map(parsePos);
}

/**
 * Hexes the active heroes see now (units there are seen): every hex within 1,
 * every hex in line of sight within the sight range (lit or not), and, up to
 * LIT_SIGHT, the far lights of `farLit` (spec 17.4). V3.9 (spec 24.2): each hero sees only the front
 * half of their facing (adjacent rear hexes unseen); the union covers each other's backs. Figures that
 * struck a hero unseen (`revealed`) stand out until the next player phase ends.
 */
export function visibleSet(w: World, d: DelveX, lit?: Set<string>): Set<string> {
  const L = lit ?? litSet(w, d);
  const far = farLitTest(w, d, L);
  const out = new Set<string>();
  const distant = new Set<string>();
  const eyes = d.heroes.filter((h) => h.status === 'active');
  for (const h of eyes) {
    const sr = sightRangeAt(w, d, h.at, L);
    for (const n of range(h.at, LIT_SIGHT)) {
      const p = { level: h.at.level, ...n };
      if (!w.tile(p)) continue;
      const k = posKey(p);
      if (out.has(k)) continue;
      if (!inFrontHalf(h, p)) continue;
      const dist = distance(h.at, p);
      if (dist <= 1) {
        out.add(k);
        continue;
      }
      const near = dist <= sr;
      if (!near && !far(k)) continue;
      if (smoky(d, p) || smoky(d, h.at)) continue; // smoke blocks sight both ways
      if (los(w, d, h.at, p)) (near ? out : distant).add(k);
    }
  }
  // V5.0 (spec 32.15): the peek. A hero on a stair hex (or a working lift) looks across: the hexes within PEEK_RANGE
  // of the linked hex on the other level, in its line of sight and in whatever light is there, no facing.
  for (const h of eyes) {
    const o = peekFrom(w, d, h.at);
    if (!o) continue;
    const sr = Math.min(PEEK_RANGE, sightRangeAt(w, d, o, L));
    for (const n of range(o, PEEK_RANGE)) {
      const p = { level: o.level, ...n };
      if (!w.tile(p)) continue;
      const k = posKey(p);
      if (out.has(k)) continue;
      const dist = distance(o, p);
      if (dist === 0) {
        out.add(k);
        continue;
      }
      const near = dist <= sr;
      if (!near && !far(k)) continue;
      if (smoky(d, p) || smoky(d, o)) continue;
      if (los(w, d, o, p)) (near ? out : distant).add(k);
    }
  }
  // Walls next to seen floor are revealed (15.1), but not around a far light (17.4): a
  // distant fire shows the fire, not the room. Daylight still floods its whole patch.
  addEdgeWalls(w, d, out);
  for (const k of distant) out.add(k);
  for (const id of Object.keys(d.revealed ?? {})) {
    const f = d.monsters.find((m) => m.id === id && !m.buried) ?? d.rivals?.members.find((r) => r.id === id && r.hp > 0 && !r.goneOut);
    if (f) out.add(posKey(f.at));
  }
  return out;
}

export function clampLight(n: number): number {
  return Math.max(0, Math.min(LIGHT_MAX, n));
}

// ---------------------------------------------------------------- paths

export interface PathOpts {
  /** Can this hex be entered (beyond terrain)? */
  enter: (p: Pos) => boolean;
  /** Extra tie-break penalty for entering p (e.g. spotted traps). */
  penalty?: (p: Pos) => number;
  /** Allow stairs links. */
  stairs: boolean;
  /** Allow locked doors (the Gloam). */
  allowLocked?: boolean;
  /** Max cost. */
  budget: number;
}

export interface Node {
  p: Pos;
  cost: number;
  pen: number;
  prev?: string;
}

/** Steps from p: hex neighbours plus a stairs link. Returns [pos, cost]. */
export function steps(w: World, d: DelveX, p: Pos, opts: { stairs: boolean; allowLocked?: boolean }): [Pos, number][] {
  const out: [Pos, number][] = [];
  for (const n of posNeighbors(p)) {
    if (!canEnter(w, d, n, opts.allowLocked)) continue;
    out.push([n, kindAt(w, d, n) === 'rubble' ? 2 : 1]);
  }
  // V5.0 (spec 32.15): the step across is free (STAIR_CROSS_COST): on, across and off in one walk or sneak.
  if (opts.stairs) {
    const o = peekFrom(w, d, p);
    if (o) out.push([o, STAIR_CROSS_COST]);
  }
  return out;
}

/** V5.0 (spec 32.15): the hex on the other level a figure on `p` would cross to: a stair's link, or a working lift's. */
export function peekFrom(w: World, d: DelveX, p: Pos): Pos | null {
  const k = kindAt(w, d, p);
  if (k === 'stairs') return w.stairs.get(posKey(p)) ?? null;
  if (k === 'lift' && d.liftWorking) return w.lifts.get(posKey(p)) ?? null;
  return null;
}

/** Dijkstra from `from`. Returns nodes by posKey (start included, cost 0). */
export function dijkstra(w: World, d: DelveX, from: Pos, o: PathOpts): Map<string, Node> {
  const best = new Map<string, Node>();
  best.set(posKey(from), { p: from, cost: 0, pen: 0 });
  const open: Node[] = [best.get(posKey(from))!];
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) {
      const a = open[i]!;
      const b = open[bi]!;
      if (a.cost < b.cost || (a.cost === b.cost && a.pen < b.pen)) bi = i;
    }
    const cur = open.splice(bi, 1)[0]!;
    const ck = posKey(cur.p);
    if (best.get(ck) !== cur) continue;
    for (const [n, c] of steps(w, d, cur.p, o)) {
      const cost = cur.cost + c;
      if (cost > o.budget) continue;
      if (!o.enter(n)) continue;
      const pen = cur.pen + (o.penalty?.(n) ?? 0);
      const k = posKey(n);
      const old = best.get(k);
      if (old && (old.cost < cost || (old.cost === cost && old.pen <= pen))) continue;
      const node = { p: n, cost, pen, prev: ck };
      best.set(k, node);
      open.push(node);
    }
  }
  return best;
}

export function pathTo(nodes: Map<string, Node>, to: Pos): Pos[] {
  const out: Pos[] = [];
  let k: string | undefined = posKey(to);
  while (k) {
    const n = nodes.get(k);
    if (!n || !n.prev) break;
    out.push(n.p);
    k = n.prev;
  }
  return out.reverse();
}

/** Unbounded BFS distance (in steps) from goals over walkable terrain. */
export function distField(w: World, d: DelveX, goals: Pos[], opts: { stairs: boolean; allowLocked?: boolean; /** V5.0 (spec 32.14): hexes not to path through (the balance bot: a crew at peace standing on the way). */ blocked?: Set<string> }): Map<string, number> {
  const dist = new Map<string, number>();
  const q: Pos[] = [];
  for (const g of goals) {
    if (!dist.has(posKey(g))) {
      dist.set(posKey(g), 0);
      q.push(g);
    }
  }
  for (let i = 0; i < q.length; i++) {
    const p = q[i]!;
    const dp = dist.get(posKey(p))!;
    for (const [n] of steps(w, d, p, opts)) {
      const k = posKey(n);
      if (dist.has(k) || opts.blocked?.has(k)) continue;
      dist.set(k, dp + 1);
      q.push(n);
    }
  }
  return dist;
}

/** Noise reach: walking distance from src where crossing a closed door counts 2. */
export function noiseField(w: World, d: DelveX, src: Pos, radius: number): Map<string, number> {
  const best = new Map<string, number>();
  best.set(posKey(src), 0);
  const open: [Pos, number][] = [[src, 0]];
  while (open.length) {
    open.sort((a, b) => a[1] - b[1]);
    const [p, c] = open.shift()!;
    if (best.get(posKey(p))! < c) continue;
    for (const n of posNeighbors(p)) {
      const nk = kindAt(w, d, n);
      if (!isFloorish(w, d, n) && nk !== 'prop' && nk !== 'pit') continue;
      const door = nk === 'door' && !doorAt(d, n)?.open;
      const nc = c + (door ? 2 : 1);
      if (nc > radius) continue;
      const k = posKey(n);
      if ((best.get(k) ?? Infinity) <= nc) continue;
      best.set(k, nc);
      open.push([n, nc]);
    }
  }
  return best;
}

export function adjacent(a: Pos, b: Pos): boolean {
  return a.level === b.level && distance(a, b) === 1;
}

export function within(a: Pos, b: Pos, n: number): boolean {
  return a.level === b.level && distance(a, b) <= n;
}

export { samePos, posKey };
export type { Hex };

// ---------------------------------------------------------------- falls

/** Floor-like hex a figure can stand on (doors excluded). */
export function standable(w: World, d: DelveX | null, p: Pos): boolean {
  const k = kindAt(w, d, p);
  return k !== undefined && k !== 'door' && FLOORISH.includes(k);
}

/**
 * Where a fall into the pit column at `pit` comes to rest, ignoring who stands there:
 * the first level below whose tile at the same (q, r) is walkable. A solid tile
 * under the column stops the fall on the nearest walkable hex of that level.
 */
export function fallColumn(w: World, d: DelveX | null, pit: Pos): { to: Pos; levels: number } | null {
  if (kindAt(w, d, pit) !== 'pit') return null;
  const levels = [...w.levels.keys()].filter((l) => l > pit.level).sort((a, b) => a - b);
  for (const lv of levels) {
    const p = { level: lv, q: pit.q, r: pit.r };
    const k = kindAt(w, d, p);
    if (k === 'pit') continue;
    if (k && standable(w, d, p)) return { to: p, levels: lv - pit.level };
    // Solid or void under the column: nearest walkable on this level.
    for (let r = 1; r <= 3; r++) {
      const ring = range(p, r).map((h) => ({ level: lv, ...h })).filter((x) => distance(x, p) === r && standable(w, d, x));
      if (ring.length) return { to: ring[0]!, levels: lv - pit.level };
    }
    return null;
  }
  return null;
}

/** Fall damage: 4 for one level, 7 for two or more. */
export function fallDamage(levels: number): number {
  return levels <= 1 ? 4 : 7;
}

/** Nearest free standable hex to `p` within 3 on its level (p itself first). */
export function freeNear(w: World, d: DelveX, p: Pos, taken: (q: Pos) => boolean): Pos | null {
  for (let r = 0; r <= 3; r++) {
    for (const h of range(p, r)) {
      const x = { level: p.level, ...h };
      if (distance(x, p) !== r) continue;
      if (standable(w, d, x) && !taken(x)) return x;
    }
  }
  return null;
}

/** Floor hex next to a pit (an edge). */
export function pitsNextTo(w: World, d: DelveX | null, p: Pos): Pos[] {
  return posNeighbors(p).filter((n) => kindAt(w, d, n) === 'pit');
}
