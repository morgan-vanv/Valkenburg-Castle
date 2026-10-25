// Builds the 3D diorama for one castle level on the hex grid: floors by room
// material and tint (engraved hex joints, not separate blocks), cutaway walls
// with pale caps, pit ledges and bridge piers, railings, pillars, rubble,
// doors, the sealed door, stairs, the lift, exits, braziers, furniture props
// and fixed lights (sconces, daylight shafts, fires, fungus, glows, vents).
// Fixed lights are baked into per-instance glow so they cost no point lights.
// Owns per-hex fog for everything it built, and a "below" mode that shows only
// the hexes under a pit above, dimmed.

import * as THREE from 'three';
import { DIRS, add, distance, hexKey, hexToWorld, line, parseHexKey, posKey, range, type Hex, type Pos } from '../game/hex';
import type { CastleDef, LevelDef, LightDef, Material, PropKind, TileDef } from '../game/types';
import { addFogAttribute, fogMaterial, FOG_BELOW, MAT_ID, setMaterialFog } from './fog';
import { furnitureModel, winchDrum } from './furniture';
import { glowTexture } from './sprites';
import { COLORS, FLOOR_TOP, HEX, RAISED_TOP, WALL_HEIGHT, WALL_THICK, hash2, levelY } from './world';

const R = HEX * 0.985;

export interface DoorView {
  key: string;
  at: Pos;
  hinge: THREE.Group;
  padlock: THREE.Object3D;
  mats: THREE.Material[];
  open: boolean;
  center: THREE.Vector3;
}

export interface BrazierView {
  key: string;
  at: Pos;
  fire: THREE.Object3D;
  mats: THREE.Material[];
  lit: boolean;
  center: THREE.Vector3;
}

/** A fixed light as the diorama sees it: where to put a point light and what colour. */
export interface FixedLightView {
  def: LightDef;
  key: string;
  at: THREE.Vector3;
  color: number;
  power: number;
  radius: number;
  /** Animated parts (flames) to flicker. */
  flames: THREE.Object3D[];
  /** The drawn object (hidden by fog). */
  obj?: THREE.Object3D;
}

interface Batch {
  mesh: THREE.InstancedMesh;
  fog: THREE.InstancedBufferAttribute;
  sources: string[][];
}

interface Extra {
  obj: THREE.Object3D;
  mats: THREE.Material[];
  sources: string[];
}

export const LIGHT_COLOR: Record<LightDef['kind'], number> = {
  sconce: 0xffa050,
  daylight: 0xb4cbff,
  fire: 0xff6a20,
  fungus: 0x5cff9a,
  glow: 0xc58aff,
};
const LIGHT_GLOW_POWER: Record<LightDef['kind'], number> = { sconce: 0.75, daylight: 0.32, fire: 1.0, fungus: 0.6, glow: 0.65 };

/** Default floor colours per material, used when a room has no tint. */
const MATERIAL_COLOR: Record<Material, number> = {
  flagstone: 0x8a8072,
  planks: 0x8c6a46,
  rug: 0x7e3a2e,
  earth: 0x6a5442,
  rock: 0x625c54,
  water: 0x2c4654,
  bone: 0x6e6252,
};

const PROP_NAME: Record<PropKind, string> = {
  table: 'Table',
  bench: 'Bench',
  bunk: 'Bunk',
  barrel: 'Barrels',
  crate: 'Crates',
  anvil: 'Anvil',
  cage: 'Cage',
  bones: 'Bones',
  rock: 'Rocks',
  shelf: 'Shelf',
  forge: 'Forge',
  winch: 'Winch',
  statue: 'Statue',
  rack: 'Weapon rack',
  stalagmite: 'Stalagmite',
};
export function propName(p: PropKind | undefined): string {
  return p ? PROP_NAME[p] : 'Furniture';
}

/** Hex prism: pointy-top (CylinderGeometry puts a corner at +z), base at y = 0. */
function prism(radius: number, height: number, top = 1, bottom = 1, bottomRadius = radius, side = 1): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(radius, bottomRadius, height, 6, 1);
  g.translate(0, height / 2, 0);
  const n = g.toNonIndexed();
  // Vertex shade: top face factor `top`, sides fade from `bottom` at the base to 1 at the top.
  const pos = n.getAttribute('position');
  const nor = n.getAttribute('normal');
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / height;
    const up = nor.getY(i) > 0.9;
    const k = up ? top : (bottom + (1 - bottom) * y) * side;
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
  }
  n.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return n;
}

/** Vertex shade for any geometry with base at y = 0: top faces `top`, sides fade from `bottom` at the base to `side` at the top. */
function shade(g0: THREE.BufferGeometry, height: number, top: number, bottom: number, side: number): THREE.BufferGeometry {
  const n = g0.index ? g0.toNonIndexed() : g0;
  const pos = n.getAttribute('position');
  const nor = n.getAttribute('normal');
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / height;
    const up = nor.getY(i) > 0.9;
    const k = up ? top : (bottom + (1 - bottom) * y) * side;
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
  }
  n.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return n;
}

/** A thin wall panel (15.8) lying along the hex edge at local +z: base at y = 0, outer face on the edge. */
function panelGeo(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(HEX * 1.0, WALL_HEIGHT, WALL_THICK);
  g.translate(0, WALL_HEIGHT / 2, (Math.sqrt(3) / 2) * HEX - WALL_THICK / 2);
  return shade(g, WALL_HEIGHT, 1, 0.55, 0.52);
}

/** A corner post where panels meet. */
function postGeo(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(WALL_THICK * 0.72, WALL_THICK * 0.72, WALL_HEIGHT + 0.04, 6);
  g.translate(0, (WALL_HEIGHT + 0.04) / 2, 0);
  return shade(g, WALL_HEIGHT + 0.04, 1, 0.55, 0.52);
}

/** Room materials drawn as cave: their walls stay thick rock (15.8). */
const CAVE_MATERIALS = new Set<Material>(['rock', 'earth', 'bone']);

const WALKISH = new Set(['floor', 'rubble', 'door', 'stairs', 'exit', 'lift', 'prop', 'tallprop', 'brazier', 'pillar', 'sealed']);
const WALKABLE = new Set(['floor', 'rubble', 'door', 'stairs', 'exit', 'lift']);

function isSolid(t: TileDef | undefined): boolean {
  return !t || t.kind === 'wall' || t.kind === 'cracked' || t.kind === 'pillar' || t.kind === 'sealed';
}

function blocksLight(t: TileDef | undefined): boolean {
  return !t || t.kind === 'wall' || t.kind === 'cracked' || t.kind === 'pillar' || t.kind === 'tallprop' || t.kind === 'sealed' || t.kind === 'door';
}

export class LevelView {
  readonly group = new THREE.Group();
  readonly level: number;
  readonly doors = new Map<string, DoorView>();
  readonly braziers = new Map<string, BrazierView>();
  readonly fixedLights: FixedLightView[] = [];
  /** Winch drums, spun when the lift is worked. */
  readonly drums: THREE.Object3D[] = [];
  /** Cracked walls by posKey, so a blast can hide them. */
  readonly cracked = new Map<string, Extra>();
  /** Rubble heaps by posKey (hidden once dug out, V3.2). */
  readonly rubble = new Map<string, THREE.Object3D>();
  /** Hexes that can be clicked (walkable-ish), by hexKey. */
  readonly walkable = new Set<string>();
  /** Pit hexes by hexKey. */
  readonly pits = new Set<string>();
  /** Walkable top height per hexKey. */
  readonly top = new Map<string, number>();
  private batches: Batch[] = [];
  private extras: Extra[] = [];
  /** Baked fixed-light colour per hexKey. */
  private glow = new Map<string, THREE.Color>();
  /** World-space bounds of the level. */
  readonly min = new THREE.Vector2(Infinity, Infinity);
  readonly max = new THREE.Vector2(-Infinity, -Infinity);
  readonly y0: number;

  constructor(
    readonly def: LevelDef,
    readonly castle: CastleDef,
  ) {
    this.level = def.level;
    this.y0 = levelY(def.level);
    this.group.name = `level-${def.level}`;
    this.build();
  }

  private pk(h: Hex): string {
    return posKey({ level: this.level, q: h.q, r: h.r });
  }

  tile(h: Hex): TileDef | undefined {
    return this.def.tiles[hexKey(h)];
  }

  private isPit(h: Hex): boolean {
    return this.tile(h)?.kind === 'pit';
  }

  // ------------------------------------------------------------ build

  private build(): void {
    const floors: Hex[] = [];
    const raised: Hex[] = [];
    const walls: Hex[] = [];
    for (const [k, t] of Object.entries(this.def.tiles)) {
      const h = parseHexKey(k);
      const w = hexToWorld(h, HEX);
      this.min.set(Math.min(this.min.x, w.x), Math.min(this.min.y, w.z));
      this.max.set(Math.max(this.max.x, w.x), Math.max(this.max.y, w.z));
      if (t.kind === 'wall') walls.push(h);
      else if (t.kind === 'pit') this.pits.add(k);
      else if (t.kind !== 'cracked') (t.raised ? raised : floors).push(h);
      if (WALKABLE.has(t.kind)) this.walkable.add(k);
      this.top.set(k, t.raised ? RAISED_TOP : FLOOR_TOP);
    }
    this.bakeLights();

    // Floors: one hex slab per tile (hairline engraved joints come from the shader).
    this.batch(
      prism(R, FLOOR_TOP, 1, 0.55),
      floors,
      (h) => this.floorColor(h),
      (h) => [this.pk(h)],
      () => 0,
      0.22,
      { floor: true },
    );
    this.batch(
      prism(R, RAISED_TOP, 1.06, 0.5),
      raised,
      (h) => this.floorColor(h).offsetHSL(0, 0, 0.04),
      (h) => [this.pk(h)],
      () => 0,
      0.24,
      { floor: true },
    );
    // Pit ledges: a skirt under every floor next to a pit, so the edge reads as a drop.
    const ledge = [...floors, ...raised].filter((h) => DIRS.some((d) => this.isPit(add(h, d))));
    this.batch(
      prism(R * 0.99, 1.1, 1, 0.35),
      ledge,
      (h) => new THREE.Color(0x6a5e52).offsetHSL(0, 0, (hash2(h.q, h.r, 21) - 0.5) * 0.05),
      (h) => [this.pk(h)],
      () => -1.1,
      0.12,
    );
    // Bridges (two or more pit sides): a tapering pier underneath, the bridge's underside.
    const piers = ledge.filter((h) => DIRS.filter((d) => this.isPit(add(h, d))).length >= 3);
    this.batch(
      prism(R * 0.55, 2.4, 1, 0.25, R * 0.3),
      piers,
      () => new THREE.Color(0x5a5048),
      (h) => [this.pk(h)],
      () => -3.5,
      0.08,
    );
    // Walls (15.8). A built wall hex with floor beside it is drawn as thin panels along its
    // floor-facing edges (pale cap, dark face) over a low dark core, with posts at the corners.
    // Wall hexes with no open neighbour, and cave walls (any open neighbour in a rock/earth/bone
    // room), stay solid blocks so the castle keeps its mass. All of it can cut away near the camera
    // (Diorama.setCutaway; off by default since V3.4).
    const wallColor = (h: Hex) => new THREE.Color(COLORS.wallCap).offsetHSL(0, (hash2(h.q, h.r, 3) - 0.5) * 0.03, (hash2(h.r, h.q, 9) - 0.5) * 0.05);
    const solid: Hex[] = [];
    const thin: Hex[] = [];
    const panels: { h: Hex; rot: number; dx: number; dz: number }[] = [];
    const posts = new Map<string, { h: Hex; rot: number; dx: number; dz: number }>();
    for (const h of walls) {
      const opens = DIRS.map((d) => this.tile(add(h, d))).map((t) => this.wallOpen(t));
      const cave = opens.some((o, i) => o && this.isCave(this.tile(add(h, DIRS[i]!))));
      if (!opens.some(Boolean) || cave) {
        solid.push(h);
        continue;
      }
      thin.push(h);
      for (let i = 0; i < 6; i++) {
        if (!opens[i]) continue;
        const a = this.dirAngle(i);
        panels.push({ h, rot: a, dx: 0, dz: 0 });
        // Posts at both ends of the edge (the hex corners 30° either side of the edge direction).
        for (const s of [-1, 1]) {
          const ca = a + (s * Math.PI) / 6;
          const dx = Math.sin(ca) * R;
          const dz = Math.cos(ca) * R;
          const w = hexToWorld(h, HEX);
          const key = `${Math.round((w.x + dx) * 20)},${Math.round((w.z + dz) * 20)}`;
          if (!posts.has(key)) posts.set(key, { h, rot: 0, dx, dz });
        }
      }
    }
    this.batch(
      prism(R, WALL_HEIGHT, 1, 0.55, R, 0.52),
      solid,
      wallColor,
      (h) => this.withNeighbours(h),
      (h) => (hash2(h.q, h.r, this.level + 5) - 0.5) * 0.06,
      0.3,
      { cutaway: true, glowScale: 0.35 },
    );
    this.batchItems(panelGeo(), panels, wallColor, (h) => this.withNeighbours(h), () => 0, 0.3, { cutaway: true, glowScale: 0.35 });
    this.batchItems(postGeo(), [...posts.values()], wallColor, (h) => this.withNeighbours(h), () => 0, 0.3, { cutaway: true, glowScale: 0.35 });
    // The wall's core between its panels: a low dark fill, so the gap reads as masonry, not a hole.
    // (Kept under the cutaway height, 0.3, so cut panels never z-fight with it.)
    this.batch(
      prism(R * 0.98, 0.24, 1, 0.5),
      thin,
      (h) => new THREE.Color(0x5e554c).offsetHSL(0, 0, (hash2(h.q, h.r, 23) - 0.5) * 0.05),
      (h) => this.withNeighbours(h),
      () => 0,
      0.1,
      { glowScale: 0.35 },
    );
    // A dark sill under walls that face a pit, so walls don't float.
    const pitWalls = walls.filter((h) => DIRS.some((d) => this.isPit(add(h, d))));
    this.batch(
      prism(R, 1.1, 0.5, 0.3),
      pitWalls,
      () => new THREE.Color(0x4a423a),
      (h) => this.withNeighbours(h),
      () => -1.1,
      0.08,
    );

    for (const [k, t] of Object.entries(this.def.tiles)) {
      const h = parseHexKey(k);
      switch (t.kind) {
        case 'pillar':
          this.addPillar(h);
          break;
        case 'rubble':
          this.addRubble(h);
          break;
        case 'door':
          this.addDoor(h);
          break;
        case 'stairs':
          this.addStairs(h);
          break;
        case 'exit':
          this.addExit(h);
          break;
        case 'brazier':
          this.addBrazier(h);
          break;
        case 'cracked':
          this.addCracked(h);
          break;
        case 'sealed':
          this.addSealed(h);
          break;
        case 'lift':
          this.addLift(h);
          break;
      }
      if (t.railing) this.addRailing(h);
    }
    this.addProps();
    this.addLights();
    this.buildLabels();
  }

  private floorColor(h: Hex): THREE.Color {
    const t = this.tile(h);
    const room = this.def.rooms.find((r) => r.id === t?.room);
    const mat = room?.material ?? 'flagstone';
    let base: THREE.Color;
    if (room?.tint) base = new THREE.Color(room.tint);
    else {
      base = new THREE.Color(MATERIAL_COLOR[mat]);
      // Untinted rooms: a small hue/lightness shift per room so neighbours read apart.
      const id = t?.room ?? '';
      let rh = 0;
      for (let i = 0; i < id.length; i++) rh = (rh * 31 + id.charCodeAt(i)) | 0;
      const k = ((rh >>> 0) % 1000) / 1000;
      base.offsetHSL((k - 0.5) * 0.05, (k - 0.5) * 0.08, (k - 0.5) * 0.08);
    }
    // Corridors and unroomed floor: plain grey stone.
    if (!t?.room && !room) base = new THREE.Color(0x7a7268);
    const a = hash2(h.q, h.r, this.level);
    return base.offsetHSL(0, 0, (a - 0.5) * 0.035);
  }

  private matId(h: Hex): number {
    const t = this.tile(h);
    const room = this.def.rooms.find((r) => r.id === t?.room);
    return MAT_ID[room?.material ?? 'flagstone'] ?? 0;
  }

  private withNeighbours(h: Hex): string[] {
    return [this.pk(h), ...DIRS.map((d) => this.pk(add(h, d)))];
  }

  /**
   * 15.8: does a wall hex face a room across this neighbour (floor, door, exit, props...)?
   * Pits don't count: walls over the Hollow stay solid piers instead of panel rings.
   */
  private wallOpen(t: TileDef | undefined): boolean {
    return !!t && t.kind !== 'wall' && t.kind !== 'cracked' && t.kind !== 'sealed' && t.kind !== 'pit';
  }

  /** 15.8: a floor-like tile in a cave room (rock, earth, bone) keeps the walls beside it thick. */
  private isCave(t: TileDef | undefined): boolean {
    if (!t?.room) return false;
    const room = this.def.rooms.find((r) => r.id === t.room);
    return !!room && CAVE_MATERIALS.has(room.material ?? 'flagstone');
  }

  private batch(
    geo: THREE.BufferGeometry,
    hexes: Hex[],
    color: (h: Hex) => THREE.Color,
    sources: (h: Hex) => string[],
    lift: (h: Hex) => number,
    litFloor: number,
    opts: { cutaway?: boolean; floor?: boolean; glowScale?: number } = {},
  ): void {
    this.batchItems(
      geo,
      hexes.map((h) => ({ h, rot: 0, dx: 0, dz: 0 })),
      color,
      sources,
      lift,
      litFloor,
      opts,
    );
  }

  /** One instanced mesh for many placed items: a hex each, plus a turn about y and an offset from its centre. */
  private batchItems(
    geo: THREE.BufferGeometry,
    items: { h: Hex; rot: number; dx: number; dz: number }[],
    color: (h: Hex) => THREE.Color,
    sources: (h: Hex) => string[],
    lift: (h: Hex) => number,
    litFloor: number,
    opts: { cutaway?: boolean; floor?: boolean; glowScale?: number } = {},
  ): void {
    if (!items.length) return;
    const mat = fogMaterial({ instanced: true, litFloor, vertexColors: true, cutaway: opts.cutaway, glow: true, floor: opts.floor });
    const mesh = new THREE.InstancedMesh(geo, mat, items.length);
    const fog = addFogAttribute(mesh, items.length);
    const glow = new THREE.InstancedBufferAttribute(new Float32Array(items.length * 3), 3);
    geo.setAttribute('aGlow', glow);
    let matAttr: THREE.InstancedBufferAttribute | null = null;
    if (opts.floor) {
      matAttr = new THREE.InstancedBufferAttribute(new Float32Array(items.length), 1);
      geo.setAttribute('aMat', matAttr);
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const s = new THREE.Vector3(1, 1, 1);
    const srcs: string[][] = [];
    items.forEach(({ h, rot, dx, dz }, i) => {
      const w = hexToWorld(h, HEX);
      q.setFromAxisAngle(up, rot);
      m.compose(new THREE.Vector3(w.x + dx, this.y0 + lift(h), w.z + dz), q, s);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, color(h));
      const g = this.glow.get(hexKey(h));
      const gs = opts.glowScale ?? 1;
      if (g) glow.setXYZ(i, g.r * gs, g.g * gs, g.b * gs);
      if (matAttr) matAttr.setX(i, this.matId(h));
      srcs.push(sources(h));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.group.add(mesh);
    this.batches.push({ mesh, fog, sources: srcs });
  }

  private place(h: Hex, obj: THREE.Object3D, lift = 0): void {
    const w = hexToWorld(h, HEX);
    obj.position.set(w.x, this.y0 + lift, w.z);
    this.group.add(obj);
  }

  private extra(h: Hex, obj: THREE.Object3D, mats: THREE.Material[], sources = [this.pk(h)]): Extra {
    const e = { obj, mats, sources };
    this.extras.push(e);
    return e;
  }

  /** Axis (0..2) along which the hex has solid neighbours on both sides, for doors and arches. */
  private wallAxis(h: Hex): number {
    let best = 0;
    let bestScore = -1;
    for (let i = 0; i < 3; i++) {
      const a = this.tile(add(h, DIRS[i]!));
      const b = this.tile(add(h, DIRS[i + 3]!));
      const score = (isSolid(a) ? 1 : 0) + (isSolid(b) ? 1 : 0);
      if (score > bestScore) {
        best = i;
        bestScore = score;
      }
    }
    return best;
  }

  /** World angle (around y) of the direction toward DIRS[i]. */
  private dirAngle(i: number): number {
    const w = hexToWorld(DIRS[i]!, 1);
    return Math.atan2(w.x, w.z);
  }

  // ------------------------------------------------------------ fixed lights

  /** Bake every fixed light on this level into a per-hex glow colour (with line of sight). */
  private bakeLights(): void {
    const lights = (this.castle.lights ?? []).filter((l) => l.at.level === this.level);
    for (const l of lights) {
      const col = new THREE.Color(LIGHT_COLOR[l.kind]);
      const reach = l.radius + 1;
      for (const h of range(l.at, reach)) {
        const t = this.tile(h);
        if (!t) continue;
        const d = distance(h, l.at);
        if (d > 0) {
          const path = line(l.at, h).slice(1, -1);
          if (path.some((p) => blocksLight(this.tile(p)))) continue;
        }
        const k = Math.max(0, 1 - d / (reach + 0.5));
        const f = LIGHT_GLOW_POWER[l.kind] * (0.25 + 0.75 * k * k) * (d <= l.radius ? 1 : 0.45);
        const prev = this.glow.get(hexKey(h)) ?? new THREE.Color(0, 0, 0);
        prev.r = Math.min(0.9, prev.r + col.r * f);
        prev.g = Math.min(0.9, prev.g + col.g * f);
        prev.b = Math.min(0.9, prev.b + col.b * f);
        this.glow.set(hexKey(h), prev);
      }
    }
  }

  private addLights(): void {
    const lights = (this.castle.lights ?? []).filter((l) => l.at.level === this.level);
    for (const l of lights) {
      const h: Hex = { q: l.at.q, r: l.at.r };
      const t = this.tile(h);
      const w = hexToWorld(h, HEX);
      const view: FixedLightView = { def: l, key: posKey(l.at), at: new THREE.Vector3(w.x, this.y0 + 1.4, w.z), color: LIGHT_COLOR[l.kind], power: 1, radius: l.radius, flames: [] };
      const g = new THREE.Group();
      const glowSprite = (color: number, size: number, y: number, opacity = 0.8) => {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
        s.scale.setScalar(size);
        s.position.y = y;
        return s;
      };
      const flameMat = new THREE.MeshBasicMaterial({ color: 0xffb040, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
      switch (l.kind) {
        case 'sconce': {
          // On a wall: bracket and flame on the face toward the nearest open hex.
          let dir = -1;
          if (!t || t.kind === 'wall' || t.kind === 'pillar') {
            for (let i = 0; i < 6; i++) if (WALKISH.has(this.tile(add(h, DIRS[i]!))?.kind ?? '')) dir = i;
          }
          const iron = fogMaterial({ color: COLORS.iron, litFloor: 0.2 });
          const holder = new THREE.Group();
          const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.38), iron);
          arm.position.set(0, 0, 0.19);
          const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.06, 0.12, 6), iron);
          cup.position.set(0, 0.06, 0.4);
          const flame = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.32, 5), flameMat);
          flame.position.set(0, 0.28, 0.4);
          const halo = glowSprite(0xff9a40, 1.3, 0.28, 0.75);
          halo.position.z = 0.4;
          holder.add(arm, cup, flame, halo);
          view.flames.push(flame);
          if (dir >= 0) {
            holder.rotation.y = this.dirAngle(dir);
            holder.position.y = WALL_HEIGHT * 0.72;
            // Out from the wall hex center to its face.
            const off = hexToWorld(DIRS[dir]!, 1);
            // On the wall's face (a thin panel's outer face sits on the edge, 0.5 of the way to the neighbour).
            holder.position.x = off.x * 0.49;
            holder.position.z = off.z * 0.49;
            view.at.set(w.x + off.x * 0.8, this.y0 + WALL_HEIGHT * 0.9, w.z + off.z * 0.8);
          } else {
            // Free-standing: a torch post.
            const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 1.1, 5), iron);
            post.position.y = 0.55 + FLOOR_TOP;
            g.add(post);
            holder.position.set(0, 1.0, -0.4);
          }
          g.add(holder);
          this.place(h, g);
          this.extra(h, g, [iron], dir >= 0 ? [this.pk(add(h, DIRS[dir]!)), this.pk(h)] : [this.pk(h)]);
          view.power = 0.8;
          break;
        }
        case 'daylight': {
          // A soft cool shaft from above.
          const shaftMat = new THREE.MeshBasicMaterial({ color: 0xc8dcff, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
          const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.5, 6, 6, 1, true), shaftMat);
          shaft.position.set(0.6, 3.2, -0.4);
          shaft.rotation.z = -0.18;
          const pool = new THREE.Mesh(new THREE.CircleGeometry(1.6, 6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xc8dcff, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false }));
          pool.position.y = FLOOR_TOP + 0.02;
          g.add(shaft, pool);
          g.userData.noFog = true;
          this.place(h, g);
          this.extra(h, g, [], [this.pk(h)]);
          view.at.y = this.y0 + 3;
          view.power = 0.7;
          break;
        }
        case 'fire': {
          const onFloor = !!t && WALKABLE.has(t.kind);
          if (onFloor && l.radius <= 1) {
            // A fire vent: a glowing crack in the floor.
            const ventMat = new THREE.MeshBasicMaterial({ color: 0xff5a10, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
            const plate = new THREE.Mesh(new THREE.CircleGeometry(0.62, 6).rotateX(-Math.PI / 2), ventMat);
            plate.rotation.y = Math.PI / 6;
            plate.position.y = FLOOR_TOP + 0.015;
            const crackMat = fogMaterial({ color: 0x2a1a12, litFloor: 0.1 });
            for (let i = 0; i < 3; i++) {
              const c = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.03, 0.08), crackMat);
              c.rotation.y = (i * Math.PI) / 3 + hash2(h.q, h.r, i) * 0.4;
              c.position.y = FLOOR_TOP + 0.02;
              g.add(c);
            }
            const lick = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 5), flameMat);
            lick.position.y = FLOOR_TOP + 0.25;
            g.add(plate, lick, glowSprite(0xff5a10, 1.8, FLOOR_TOP + 0.2, 0.7));
            view.flames.push(lick);
            this.place(h, g);
            this.extra(h, g, [crackMat], [this.pk(h)]);
            view.at.y = this.y0 + 0.8;
            view.power = 0.7;
          } else if (onFloor) {
            // A fire pit: ring of stones and tall flames (the Lair's fires).
            const stone = fogMaterial({ color: 0x5a524a, litFloor: 0.15 });
            for (let i = 0; i < 7; i++) {
              const a = (i / 7) * Math.PI * 2;
              const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.16, 0), stone);
              s.position.set(Math.sin(a) * 0.5, FLOOR_TOP + 0.08, Math.cos(a) * 0.5);
              g.add(s);
            }
            for (let i = 0; i < 3; i++) {
              const f = new THREE.Mesh(new THREE.ConeGeometry(0.28 - i * 0.06, 0.9 + i * 0.25, 5), flameMat);
              f.position.set(Math.sin(i * 2.1) * 0.12, FLOOR_TOP + 0.45 + i * 0.1, Math.cos(i * 2.1) * 0.12);
              g.add(f);
              view.flames.push(f);
            }
            g.add(glowSprite(0xff6a20, 2.6, FLOOR_TOP + 0.6, 0.8));
            this.place(h, g);
            this.extra(h, g, [stone], [this.pk(h)]);
            view.at.y = this.y0 + 1.3;
          } else {
            // Next to a forge or in a wall: just a glow at hearth height.
            g.add(glowSprite(0xff7a2a, 2.2, 0.9, 0.7));
            this.place(h, g);
            this.extra(h, g, [], [this.pk(h)]);
            view.at.y = this.y0 + 1.2;
          }
          break;
        }
        case 'fungus': {
          const capMat = new THREE.MeshBasicMaterial({ color: 0x6affa8 });
          const stemMat = fogMaterial({ color: 0xc8d8c0, litFloor: 0.4 });
          for (let i = 0; i < 6; i++) {
            const a = hash2(h.q * 3 + i, h.r, 31) * Math.PI * 2;
            const d = 0.15 + hash2(h.q, h.r * 3 + i, 32) * 0.5;
            const s = 0.6 + hash2(h.q + i, h.r, 33) * 0.7;
            const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03 * s, 0.04 * s, 0.25 * s, 5), stemMat);
            stem.position.set(Math.sin(a) * d, FLOOR_TOP + 0.12 * s, Math.cos(a) * d);
            const cap = new THREE.Mesh(new THREE.SphereGeometry(0.11 * s, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2), capMat);
            cap.position.set(Math.sin(a) * d, FLOOR_TOP + 0.24 * s, Math.cos(a) * d);
            g.add(stem, cap);
          }
          g.add(glowSprite(0x5cff9a, 2.2, FLOOR_TOP + 0.3, 0.55));
          this.place(h, g);
          this.extra(h, g, [stemMat], [this.pk(h)]);
          view.at.y = this.y0 + 0.9;
          view.power = 0.6;
          break;
        }
        case 'glow': {
          g.add(glowSprite(0xc58aff, 3.2, FLOOR_TOP + 0.4, 0.55));
          const motes = new THREE.Group();
          for (let i = 0; i < 5; i++) {
            const m = glowSprite(0xe0c0ff, 0.25, 0.4 + i * 0.3, 0.9);
            m.position.x = (hash2(h.q, i, 41) - 0.5) * 1.2;
            m.position.z = (hash2(h.r, i, 42) - 0.5) * 1.2;
            motes.add(m);
          }
          g.add(motes);
          view.flames.push(motes);
          this.place(h, g);
          this.extra(h, g, [], [this.pk(h)]);
          view.at.y = this.y0 + 1;
          view.power = 0.6;
          break;
        }
      }
      view.obj = g;
      this.fixedLights.push(view);
    }
  }

  // ------------------------------------------------------------ props

  private addProps(): void {
    const byKind = new Map<PropKind, { h: Hex; rot: number }[]>();
    for (const [k, t] of Object.entries(this.def.tiles)) {
      if (t.kind !== 'prop' && t.kind !== 'tallprop') continue;
      const h = parseHexKey(k);
      const kind: PropKind = t.prop ?? (t.kind === 'tallprop' ? 'shelf' : 'crate');
      const list = byKind.get(kind) ?? [];
      list.push({ h, rot: this.propRotation(h, kind) });
      byKind.set(kind, list);
      if (kind === 'winch') this.addWinchDrum(h, list[list.length - 1]!.rot);
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0);
    for (const [kind, list] of byKind) {
      const model = furnitureModel(kind);
      const parts: [THREE.BufferGeometry | undefined, number][] = [
        [model.body, 0.22],
        [model.glow, 1.4],
      ];
      for (const [geo0, lit] of parts) {
        if (!geo0) continue;
        const geo = geo0.clone();
        const mat = fogMaterial({ instanced: true, vertexColors: true, litFloor: lit, glow: true });
        const mesh = new THREE.InstancedMesh(geo, mat, list.length);
        const fog = addFogAttribute(mesh, list.length);
        const glow = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 3), 3);
        geo.setAttribute('aGlow', glow);
        const srcs: string[][] = [];
        list.forEach((p, i) => {
          const w = hexToWorld(p.h, HEX);
          q.setFromAxisAngle(up, p.rot);
          const sc = 0.92 + hash2(p.h.q, p.h.r, 51) * 0.12;
          s.set(sc, sc, sc);
          m.compose(new THREE.Vector3(w.x, this.y0 + FLOOR_TOP, w.z), q, s);
          mesh.setMatrixAt(i, m);
          const g = this.glow.get(hexKey(p.h));
          if (g) glow.setXYZ(i, g.r, g.g, g.b);
          srcs.push([this.pk(p.h)]);
        });
        mesh.instanceMatrix.needsUpdate = true;
        this.group.add(mesh);
        this.batches.push({ mesh, fog, sources: srcs });
      }
    }
  }

  /** Long side along a wall if there is one (back to the wall), else a hashed 60° step. */
  private propRotation(h: Hex, kind: PropKind): number {
    const round = kind === 'barrel' || kind === 'rock' || kind === 'bones' || kind === 'stalagmite' || kind === 'anvil';
    const jitter = (hash2(h.q, h.r, 61) - 0.5) * (round ? 1.2 : 0.06);
    // Find a solid neighbour to put the back against.
    for (let i = 0; i < 6; i++) {
      const n = this.tile(add(h, DIRS[i]!));
      if (n?.kind === 'wall') {
        // Model front is +z; face away from the wall.
        return this.dirAngle(i) + Math.PI + jitter;
      }
    }
    // Tables, benches and shelves: line up with same-kind neighbours.
    for (let i = 0; i < 3; i++) {
      const a = this.tile(add(h, DIRS[i]!));
      const b = this.tile(add(h, DIRS[i + 3]!));
      if ((a?.prop === this.tile(h)?.prop && a) || (b?.prop === this.tile(h)?.prop && b)) return this.dirAngle(i) + Math.PI / 2 + jitter;
    }
    return Math.floor(hash2(h.q, h.r, 62) * 6) * (Math.PI / 3) + jitter;
  }

  private addWinchDrum(h: Hex, rot: number): void {
    const model = winchDrum();
    const mat = fogMaterial({ vertexColors: true, litFloor: 0.22 });
    const mesh = new THREE.Mesh(model.body, mat);
    mesh.position.y = 1.1;
    const g = new THREE.Group();
    g.add(mesh);
    g.rotation.y = rot;
    this.place(h, g, FLOOR_TOP);
    this.extra(h, g, [mat]);
    this.drums.push(mesh);
  }

  // ------------------------------------------------------------ fixtures

  private addPillar(h: Hex): void {
    const stone = fogMaterial({ color: COLORS.wallCap, litFloor: 0.18 });
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.5, 0.22, 8), stone);
    base.position.y = FLOOR_TOP + 0.11;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, WALL_HEIGHT + 0.6, 8), stone);
    shaft.position.y = FLOOR_TOP + (WALL_HEIGHT + 0.6) / 2 + 0.2;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.36, 0.2, 8), stone);
    cap.position.y = FLOOR_TOP + WALL_HEIGHT + 0.85;
    g.add(base, shaft, cap);
    this.place(h, g);
    this.extra(h, g, [stone], this.withNeighbours(h));
  }

  private addRubble(h: Hex): void {
    const rock = fogMaterial({ color: 0x7a7066, litFloor: 0.14 });
    const g = new THREE.Group();
    const n = 6;
    for (let i = 0; i < n; i++) {
      const a = hash2(h.q * 7 + i, h.r, 11) * Math.PI * 2;
      const d = 0.15 + hash2(h.q, h.r * 5 + i, 12) * 0.45;
      const s = 0.12 + hash2(h.q + i, h.r, 13) * 0.18;
      const m = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rock);
      m.position.set(Math.sin(a) * d, FLOOR_TOP + s * 0.5, Math.cos(a) * d);
      m.rotation.set(a, a * 2, 0);
      g.add(m);
    }
    this.place(h, g);
    this.extra(h, g, [rock]);
    this.rubble.set(this.pk(h), g);
  }

  private addRailing(h: Hex): void {
    const mat = fogMaterial({ color: 0xcfc4b0, litFloor: 0.2 });
    const g = new THREE.Group();
    let any = false;
    for (let i = 0; i < 6; i++) {
      if (!this.isPit(add(h, DIRS[i]!))) continue;
      any = true;
      const seg = new THREE.Group();
      seg.rotation.y = this.dirAngle(i);
      // Edge between this hex and the pit: 0.866 from the center, length 1.
      const edge = 0.8;
      // Waist high on a hex-tall figure (15.8).
      const rail = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.1, 0.1), mat);
      rail.position.set(0, FLOOR_TOP + 0.95, edge);
      const rail2 = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.07, 0.07), mat);
      rail2.position.set(0, FLOOR_TOP + 0.5, edge);
      seg.add(rail, rail2);
      for (const x of [-0.46, 0, 0.46]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.02, 0.12), mat);
        post.position.set(x, FLOOR_TOP + 0.51, edge);
        seg.add(post);
      }
      g.add(seg);
    }
    if (!any) return;
    this.place(h, g);
    this.extra(h, g, [mat]);
  }

  private addDoor(h: Hex): void {
    const k = this.pk(h);
    const axis = this.wallAxis(h);
    const ang = this.dirAngle(axis);
    const wood = fogMaterial({ color: COLORS.wood, litFloor: 0.2 });
    const iron = fogMaterial({ color: COLORS.iron, litFloor: 0.12 });
    const brass = fogMaterial({ color: COLORS.gold, litFloor: 0.3, emissive: 0x3a2400 });
    const frame = fogMaterial({ color: COLORS.wallCap, litFloor: 0.2 });
    const root = new THREE.Group();
    root.rotation.y = ang;
    // Posts just inside the flanking walls' reveals (15.8 thin walls put those ~1.08 out).
    const span = HEX * 1.8;
    for (const z of [-span / 2, span / 2]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.24, WALL_HEIGHT + 0.1, 0.24), frame);
      post.position.set(0, (WALL_HEIGHT + 0.1) / 2, z);
      root.add(post);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, span + 0.24), frame);
    lintel.position.set(0, WALL_HEIGHT, 0);
    root.add(lintel);
    const hinge = new THREE.Group();
    hinge.position.set(0, FLOOR_TOP, -span / 2 + 0.1);
    root.add(hinge);
    const slabH = WALL_HEIGHT - 0.3;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(0.1, slabH, span - 0.2), wood);
    slab.position.set(0, slabH / 2, (span - 0.2) / 2);
    hinge.add(slab);
    for (const y of [0.22, slabH - 0.22]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, span - 0.2), iron);
      band.position.set(0, y, (span - 0.2) / 2);
      hinge.add(band);
    }
    const padlock = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.18, 0.16), brass);
    const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.018, 4, 8, Math.PI), brass);
    shackle.rotation.y = Math.PI / 2;
    shackle.position.y = 0.09;
    padlock.add(body, shackle);
    padlock.position.set(0.1, slabH * 0.5, span - 0.45);
    const pad2 = padlock.clone();
    pad2.position.x = -0.1;
    const pad = new THREE.Group();
    pad.add(padlock, pad2);
    hinge.add(pad);
    this.place(h, root);
    const mats = [wood, iron, brass, frame];
    this.extra(h, root, mats, this.withNeighbours(h));
    const w = hexToWorld(h, HEX);
    this.doors.set(k, { key: k, at: { level: this.level, ...h }, hinge, padlock: pad, mats, open: false, center: new THREE.Vector3(w.x, this.y0 + 0.8, w.z) });
    pad.visible = !!this.tile(h)?.locked;
  }

  /** The Sealed Stair: a heavy stone slab with glowing runes, chained shut. */
  private addSealed(h: Hex): void {
    const axis = this.wallAxis(h);
    const stone = fogMaterial({ color: 0x8a8070, litFloor: 0.22 });
    const iron = fogMaterial({ color: COLORS.iron, litFloor: 0.12 });
    const runeMat = new THREE.MeshBasicMaterial({ color: 0x7ab8ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    const g = new THREE.Group();
    g.rotation.y = this.dirAngle(axis);
    const span = HEX * 1.8;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(0.4, WALL_HEIGHT + 0.25, span), stone);
    slab.position.y = (WALL_HEIGHT + 0.25) / 2;
    g.add(slab);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const r = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.18, 0.06), runeMat);
        r.position.set(side * 0.21, 0.4 + i * 0.28, -0.3 + i * 0.3);
        r.rotation.x = i * 0.7;
        g.add(r);
      }
      const chain = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, span * 1.05), iron);
      chain.position.set(side * 0.23, 0.75, 0);
      chain.rotation.x = side * 0.5;
      g.add(chain);
    }
    const floor = new THREE.Mesh(prism(R, FLOOR_TOP), stone);
    g.add(floor);
    this.place(h, g);
    this.extra(h, g, [stone, iron], this.withNeighbours(h));
  }

  /** Lift platform: planks with a frame; the upper end has a beam and ropes overhead. */
  private addLift(h: Hex): void {
    const link = this.castle.links.find((l) => l.kind === 'lift' && ((l.a.level === this.level && l.a.q === h.q && l.a.r === h.r) || (l.b.level === this.level && l.b.q === h.q && l.b.r === h.r)));
    let upper = true;
    if (link) {
      const other = link.a.level === this.level && link.a.q === h.q && link.a.r === h.r ? link.b : link.a;
      upper = other.level > this.level;
    }
    // Spec 15.7: the lift reads as a cage on a chain. Plank deck, an iron cage of bars on three
    // sides with an open front (toward the most open neighbour), a roof ring, and a chain
    // rising from the roof: to a beam and pulley on the upper end, up into the dark on the lower.
    let front = 0;
    let bestOpen = -1;
    for (let i = 0; i < 6; i++) {
      const open = (isSolid(this.tile(add(h, DIRS[i]!))) ? 0 : 2) + (isSolid(this.tile(add(h, DIRS[(i + 1) % 6]!))) ? 0 : 1) + (isSolid(this.tile(add(h, DIRS[(i + 5) % 6]!))) ? 0 : 1);
      if (open > bestOpen) {
        bestOpen = open;
        front = i;
      }
    }
    const wood = fogMaterial({ color: COLORS.wood, litFloor: 0.2 });
    const dark = fogMaterial({ color: COLORS.woodDark, litFloor: 0.14 });
    const iron = fogMaterial({ color: 0x3c3a3a, litFloor: 0.14 });
    const chainMat = fogMaterial({ color: 0x8a8580, litFloor: 0.22 });
    const g = new THREE.Group();
    const deck = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.1, 1.3), wood);
    deck.position.y = FLOOR_TOP + 0.06;
    g.add(deck);
    for (let i = -2; i <= 2; i++) {
      const seam = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.11, 0.03), dark);
      seam.position.set(0, FLOOR_TOP + 0.065, i * 0.26);
      g.add(seam);
    }
    const CAGE_H = 2.7;
    // Corner posts.
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, CAGE_H, 0.08), iron);
        post.position.set(sx * 0.62, FLOOR_TOP + CAGE_H / 2, sz * 0.62);
        g.add(post);
      }
    // Bars on the back and both sides (the front, local +z, stays open).
    const barGeo = new THREE.BoxGeometry(0.03, CAGE_H - 0.1, 0.03);
    for (let i = 1; i < 5; i++) {
      const t = -0.62 + i * 0.248;
      const back = new THREE.Mesh(barGeo, iron);
      back.position.set(t, FLOOR_TOP + CAGE_H / 2, -0.62);
      const left = new THREE.Mesh(barGeo, iron);
      left.position.set(-0.62, FLOOR_TOP + CAGE_H / 2, t);
      const right = new THREE.Mesh(barGeo, iron);
      right.position.set(0.62, FLOOR_TOP + CAGE_H / 2, t);
      g.add(back, left, right);
    }
    // Roof frame and a waist rail.
    for (const y of [FLOOR_TOP + CAGE_H, FLOOR_TOP + 1.0]) {
      for (const sz of [-0.62, 0.62]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.06, 0.06), iron);
        rail.position.set(0, y, sz);
        if (sz > 0 && y < FLOOR_TOP + CAGE_H) continue; // open front: no waist rail
        g.add(rail);
      }
      for (const sx of [-0.62, 0.62]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.32), iron);
        rail.position.set(sx, y, 0);
        g.add(rail);
      }
    }
    // Roof cross-braces meeting at the chain ring.
    for (const a of [Math.PI / 4, -Math.PI / 4]) {
      const brace = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 1.7), iron);
      brace.position.y = FLOOR_TOP + CAGE_H;
      brace.rotation.y = a;
      g.add(brace);
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.03, 6, 12), chainMat);
    ring.position.y = FLOOR_TOP + CAGE_H + 0.12;
    g.add(ring);
    // The chain: alternating links up from the ring.
    const chainTop = upper ? 3.8 : 5.0;
    const linkGeo = new THREE.TorusGeometry(0.07, 0.022, 5, 8);
    for (let i = 0, y = FLOOR_TOP + CAGE_H + 0.26; y < FLOOR_TOP + chainTop; i++, y += 0.11) {
      const link = new THREE.Mesh(linkGeo, chainMat);
      link.position.y = y;
      link.rotation.y = i % 2 ? Math.PI / 2 : 0;
      g.add(link);
    }
    if (upper) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.16, 0.16), dark);
      beam.position.y = FLOOR_TOP + chainTop + 0.2;
      const pulley = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.05, 6, 12), iron);
      pulley.position.y = FLOOR_TOP + chainTop + 0.02;
      g.add(beam, pulley);
      for (const sx of [-0.72, 0.72]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, chainTop + 0.2, 0.12), dark);
        leg.position.set(sx, FLOOR_TOP + (chainTop + 0.2) / 2, -0.72);
        g.add(leg);
      }
      const brace = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 0.12), dark);
      brace.position.set(0, FLOOR_TOP + chainTop + 0.2, -0.72);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.8), dark);
      arm.position.set(0, FLOOR_TOP + chainTop + 0.2, -0.36);
      g.add(brace, arm);
    }
    g.rotation.y = this.dirAngle(front);
    this.place(h, g);
    this.extra(h, g, [wood, dark, iron, chainMat], this.withNeighbours(h));
  }

  /** Swing a door; returns the target angle. */
  doorAngle(open: boolean): number {
    return open ? -Math.PI * 0.55 : 0;
  }

  private addStairs(h: Hex): void {
    const link = this.castle.links.find((l) => l.kind === 'stairs' && ((l.a.level === this.level && l.a.q === h.q && l.a.r === h.r) || (l.b.level === this.level && l.b.q === h.q && l.b.r === h.r)));
    let down = true;
    if (link && link.kind === 'stairs') {
      const other = link.a.level === this.level && link.a.q === h.q && link.a.r === h.r ? link.b : link.a;
      down = other.level > this.level;
    }
    // Face the steps toward a solid neighbour (the stairwell goes into the wall); prefer one
    // with solid hexes either side so the opening sits in a wall face.
    let dir = 0;
    let bestScore = -1;
    for (let i = 0; i < 6; i++) {
      if (!isSolid(this.tile(add(h, DIRS[i]!)))) continue;
      const score = 1 + (isSolid(this.tile(add(h, DIRS[(i + 1) % 6]!))) ? 1 : 0) + (isSolid(this.tile(add(h, DIRS[(i + 5) % 6]!))) ? 1 : 0);
      if (score > bestScore) {
        bestScore = score;
        dir = i;
      }
    }
    // Spec 15.7: stairs read as what they are. Down: a flight of pale treads sinking into a
    // dark opening between two parapets. Up: a rising flight with a dark doorway at its head.
    const stone = fogMaterial({ color: 0xb3a692, litFloor: 0.2 });
    const riser = fogMaterial({ color: 0x5c5247, litFloor: 0.08 });
    const dark = fogMaterial({ color: 0x030202, litFloor: 0 });
    const g = new THREE.Group();
    const steps = 6;
    const W = 1.0;
    const D = 0.2;
    if (down) {
      // The opening: a dark slab the size of the flight, sunk a hair below the floor.
      const well = new THREE.Mesh(new THREE.BoxGeometry(W + 0.3, 0.04, steps * D + 0.3), dark);
      well.position.set(0, FLOOR_TOP - 0.01, -0.1 + (steps * D) / 2 - 0.5);
      g.add(well);
      for (let i = 0; i < steps; i++) {
        const drop = (i + 1) * 0.13;
        const tread = new THREE.Mesh(new THREE.BoxGeometry(W, 0.06, D), stone);
        tread.position.set(0, FLOOR_TOP - drop, -0.5 + i * D);
        const face = new THREE.Mesh(new THREE.BoxGeometry(W, 0.13, 0.03), riser);
        face.position.set(0, FLOOR_TOP - drop + 0.065, -0.5 + i * D - D / 2);
        g.add(tread, face);
      }
      // Parapets either side, stepping down with the flight.
      for (const sx of [-1, 1]) {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.32, steps * D + 0.2), stone);
        wall.position.set(sx * (W / 2 + 0.08), FLOOR_TOP + 0.16, -0.5 + (steps * D) / 2 - 0.1);
        g.add(wall);
      }
      // The black mouth at the bottom, standing up so it reads from the camera.
      const mouth = new THREE.Mesh(new THREE.BoxGeometry(W + 0.1, 0.9, 0.06), dark);
      mouth.position.set(0, FLOOR_TOP - 0.3, -0.5 + steps * D + 0.02);
      g.add(mouth);
    } else {
      for (let i = 0; i < steps; i++) {
        const hgt = (i + 1) * 0.16;
        const s = new THREE.Mesh(new THREE.BoxGeometry(W, hgt, D), stone);
        s.position.set(0, FLOOR_TOP + hgt / 2, -0.5 + i * D);
        const face = new THREE.Mesh(new THREE.BoxGeometry(W, 0.16, 0.03), riser);
        face.position.set(0, FLOOR_TOP + hgt - 0.08, -0.5 + i * D - D / 2);
        g.add(s, face);
      }
      for (const sx of [-1, 1]) {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.1, steps * D + 0.2), stone);
        wall.position.set(sx * (W / 2 + 0.08), FLOOR_TOP + 0.55, -0.5 + (steps * D) / 2 - 0.1);
        g.add(wall);
      }
      // The doorway at the head of the flight: dark, with a lintel.
      const door = new THREE.Mesh(new THREE.BoxGeometry(W + 0.1, 1.3, 0.06), dark);
      door.position.set(0, FLOOR_TOP + steps * 0.16 + 0.55, -0.5 + steps * D + 0.02);
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(W + 0.4, 0.14, 0.2), stone);
      lintel.position.set(0, FLOOR_TOP + steps * 0.16 + 1.25, -0.5 + steps * D);
      g.add(door, lintel);
    }
    g.rotation.y = this.dirAngle(dir);
    this.place(h, g);
    this.extra(h, g, [stone, riser, dark]);
  }

  private addExit(h: Hex): void {
    // V3.6 (19.5): the exit reads as a doorway out. Two posts and a lintel stand along the wall
    // axis; between them a pale sheet of daylight faces the outside (the side with fewer open
    // hexes), a lit threshold slab and a glowing hex ring mark the floor, and an arrow points out.
    const axis = this.wallAxis(h);
    const open = (i: number) => (WALKABLE.has(this.tile(add(h, DIRS[(i + 6) % 6]!))?.kind ?? '') ? 1 : 0);
    // Local +x after the rotation points toward DIRS[axis + 1..2]; -x toward DIRS[axis + 4..5].
    const plus = open(axis + 1) + open(axis + 2);
    const minus = open(axis + 4) + open(axis + 5);
    const out = plus <= minus ? 1 : -1;
    const stone = fogMaterial({ color: COLORS.wallCap, litFloor: 0.3 });
    const dark = fogMaterial({ color: 0x3a332c, litFloor: 0.12 });
    const slab = fogMaterial({ color: 0xcfc4ad, litFloor: 0.45 });
    const glow = new THREE.MeshBasicMaterial({ color: 0xbfd8ff, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const day = new THREE.MeshBasicMaterial({ color: 0xdceeff, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const g = new THREE.Group();
    g.rotation.y = this.dirAngle(axis);
    const span = HEX * 1.8;
    const H = 1.9;
    for (const z of [-span / 2, span / 2]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, H, 0.3), stone);
      post.position.set(out * 0.35, FLOOR_TOP + H / 2, z);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.18, 0.42), dark);
      foot.position.set(out * 0.35, FLOOR_TOP + 0.09, z);
      g.add(post, foot);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.24, span + 0.5), stone);
    lintel.position.set(out * 0.35, FLOOR_TOP + H + 0.12, 0);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.1, span + 0.7), dark);
    cap.position.set(out * 0.35, FLOOR_TOP + H + 0.29, 0);
    g.add(lintel, cap);
    // The daylight in the opening: a sheet between the posts, just outside the hex's centre.
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(span - 0.3, H - 0.05), day);
    sheet.rotation.y = Math.PI / 2;
    sheet.position.set(out * 0.42, FLOOR_TOP + (H - 0.05) / 2, 0);
    g.add(sheet);
    // A second, fainter sheet a step further out so the light has depth from an angle.
    const haze = new THREE.Mesh(new THREE.PlaneGeometry(span + 0.3, H + 0.4), glow);
    haze.rotation.y = Math.PI / 2;
    haze.position.set(out * 0.7, FLOOR_TOP + (H + 0.4) / 2 - 0.1, 0);
    g.add(haze);
    // Threshold: a pale slab across the doorway, and the glowing ring on the hex.
    const step = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, span - 0.2), slab);
    step.position.set(out * 0.3, FLOOR_TOP + 0.025, 0);
    g.add(step);
    const disc = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.82, 6, 1, Math.PI / 6), glow);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = FLOOR_TOP + 0.02;
    g.add(disc);
    // The arrow points out through the doorway.
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.34, 3), glow);
    arrow.rotation.z = -out * Math.PI / 2;
    arrow.position.set(-out * 0.15, FLOOR_TOP + 0.55, 0);
    g.add(arrow);
    this.place(h, g);
    this.extra(h, g, [stone, dark, slab], this.withNeighbours(h));
  }

  private addBrazier(h: Hex): void {
    const k = this.pk(h);
    const iron = fogMaterial({ color: 0x4a4440, litFloor: 0.16 });
    const stone = fogMaterial({ color: COLORS.wallCap, litFloor: 0.18 });
    const coal = fogMaterial({ color: 0x1a1210, litFloor: 0.05 });
    const g = new THREE.Group();
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, 0.6, 6), stone);
    ped.position.y = FLOOR_TOP + 0.3;
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.24, 0.26, 8, 1, true), iron);
    bowl.position.y = FLOOR_TOP + 0.72;
    (bowl.material as THREE.Material).side = THREE.DoubleSide;
    const coals = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.04, 8), coal);
    coals.position.y = FLOOR_TOP + 0.76;
    g.add(ped, bowl, coals);
    const fire = new THREE.Group();
    const flameMat = new THREE.MeshBasicMaterial({ color: COLORS.fire, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < 3; i++) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.2 - i * 0.03, 0.6 + i * 0.12, 5), i === 2 ? coreMat : flameMat);
      f.position.set(Math.sin(i * 2.1) * 0.1, FLOOR_TOP + 1.0 + i * 0.04, Math.cos(i * 2.1) * 0.1);
      fire.add(f);
    }
    fire.visible = false;
    g.add(fire);
    this.place(h, g);
    this.extra(h, g, [iron, stone, coal]);
    const w = hexToWorld(h, HEX);
    this.braziers.set(k, { key: k, at: { level: this.level, ...h }, fire, mats: [iron, stone, coal], lit: false, center: new THREE.Vector3(w.x, this.y0 + 1.2, w.z) });
  }

  private addCracked(h: Hex): void {
    const k = this.pk(h);
    const stone = fogMaterial({ color: 0xb8ae9c, litFloor: 0.2, vertexColors: true });
    const crack = fogMaterial({ color: 0x0a0806, litFloor: 0 });
    const g = new THREE.Group();
    const wall = new THREE.Mesh(prism(R, WALL_HEIGHT, 1, 0.55, R, 0.52), stone);
    g.add(wall);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.05, WALL_HEIGHT * 0.75, 0.06), crack);
      c.position.set(Math.sin(a) * R * 0.86, WALL_HEIGHT * 0.45, Math.cos(a) * R * 0.86);
      c.rotation.set(0, a, (hash2(h.q + i, h.r, 1) - 0.5) * 0.9);
      g.add(c);
    }
    const floor = new THREE.Mesh(prism(R, FLOOR_TOP), stone);
    floor.visible = false;
    floor.name = 'floor';
    g.add(floor);
    this.place(h, g);
    const e = this.extra(h, g, [stone, crack], this.withNeighbours(h));
    this.cracked.set(k, e);
  }

  /** Blown cracked walls become floor. */
  setBlown(keys: Set<string>): void {
    for (const [k, e] of this.cracked) {
      const blown = keys.has(k);
      for (const c of e.obj.children) c.visible = c.name === 'floor' ? blown : !blown;
      if (blown) this.walkable.add(k.split(':')[1] ?? '');
    }
    for (const [k, g] of this.rubble) for (const c of g.children) c.visible = !keys.has(k);
  }

  // ------------------------------------------------------------ room labels

  readonly labels: { text: string; at: THREE.Vector3; key: string }[] = [];

  private buildLabels(): void {
    for (const room of this.def.rooms) {
      const w = hexToWorld(room.labelAt, HEX);
      this.labels.push({ text: room.name, at: new THREE.Vector3(w.x, this.y0 + FLOOR_TOP + 0.05, w.z), key: this.pk(room.labelAt) });
    }
  }

  // ------------------------------------------------------------ fog

  /** Fog per posKey: 1 visible and lit, 0.75 visible but unlit, 0.5 explored, else hidden. */
  applyFogLit(lit: Set<string>, unlit: Set<string>, explored: Set<string>): void {
    const f = (k: string) => (lit.has(k) ? 1 : unlit.has(k) ? 0.75 : explored.has(k) ? 0.5 : 0);
    this.applyFogFn(f);
  }

  /** Below mode: only hexes in `column` (hexKeys) show, dimmed. */
  applyBelow(column: Set<string>): void {
    const f = (k: string) => (column.has(k.slice(k.indexOf(':') + 1)) ? FOG_BELOW : 0);
    this.applyFogFn(f);
  }

  private applyFogFn(f: (k: string) => number): void {
    const max = (src: string[]) => {
      let v = 0;
      for (const k of src) {
        const x = f(k);
        if (x > v) v = x;
        if (v === 1) break;
      }
      return v;
    };
    for (const b of this.batches) {
      for (let i = 0; i < b.sources.length; i++) b.fog.setX(i, max(b.sources[i]!));
      b.fog.needsUpdate = true;
    }
    for (const e of this.extras) {
      const v = max(e.sources);
      setMaterialFog(e.mats, v);
      e.obj.visible = v > 0;
    }
    for (const l of this.fixedLights) l.power = l.def.kind === 'daylight' ? 0.7 : 1;
  }

  applyFog(visible: Set<string>, explored: Set<string>): void {
    this.applyFogLit(visible, new Set(), explored);
  }

  /** Is the fixed light at this view currently drawn (its hex shown)? */
  lightShown(l: FixedLightView): boolean {
    return !!l.obj?.visible;
  }
}
