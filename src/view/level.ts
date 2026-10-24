// Builds the 3D diorama for one castle level on the hex grid: floor prisms,
// raised floor, walls, rock rim, pillars, rubble, doors, pits, stairs, exits
// and braziers. Owns per-hex fog for everything it built.

import * as THREE from 'three';
import { DIRS, add, hexKey, hexToWorld, parseHexKey, posKey, type Hex, type Pos } from '../game/hex';
import type { CastleDef, LevelDef, TileDef } from '../game/types';
import { addFogAttribute, fogMaterial, setMaterialFog } from './fog';
import { COLORS, FLOOR_TOP, HEX, RAISED_TOP, WALL_HEIGHT, hash2, levelY } from './world';

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

/** Hex prism: pointy-top (CylinderGeometry puts a corner at +z), base at y = 0. */
function prism(radius: number, height: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(radius, radius, height, 6, 1);
  g.translate(0, height / 2, 0);
  return g.toNonIndexed();
}

function isSolid(t: TileDef | undefined): boolean {
  return !t || t.kind === 'wall' || t.kind === 'cracked' || t.kind === 'pillar';
}

export class LevelView {
  readonly group = new THREE.Group();
  readonly level: number;
  readonly doors = new Map<string, DoorView>();
  readonly braziers = new Map<string, BrazierView>();
  /** Cracked walls by posKey, so a blast can hide them. */
  readonly cracked = new Map<string, Extra>();
  /** Hexes that can be clicked (walkable-ish), by hexKey. */
  readonly walkable = new Set<string>();
  /** Walkable top height per hexKey. */
  readonly top = new Map<string, number>();
  private batches: Batch[] = [];
  private extras: Extra[] = [];
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

  // ------------------------------------------------------------ build

  private build(): void {
    const floors: { h: Hex; raised: boolean; kind: TileDef['kind'] }[] = [];
    const walls: Hex[] = [];
    const rim = new Map<string, Hex>();
    for (const [k, t] of Object.entries(this.def.tiles)) {
      const h = parseHexKey(k);
      const w = hexToWorld(h, HEX);
      this.min.set(Math.min(this.min.x, w.x), Math.min(this.min.y, w.z));
      this.max.set(Math.max(this.max.x, w.x), Math.max(this.max.y, w.z));
      if (t.kind === 'wall') walls.push(h);
      else if (t.kind !== 'pit' && t.kind !== 'cracked') {
        floors.push({ h, raised: !!t.raised, kind: t.kind });
      }
      if (t.kind !== 'wall') {
        for (const d of DIRS) {
          const n = add(h, d);
          if (!this.def.tiles[hexKey(n)]) rim.set(hexKey(n), n);
        }
      }
      if (t.kind !== 'wall' && t.kind !== 'cracked' && t.kind !== 'pillar' && t.kind !== 'brazier' && t.kind !== 'pit') {
        this.walkable.add(k);
      }
      this.top.set(k, t.raised ? RAISED_TOP : FLOOR_TOP);
    }

    // Floor prisms, tinted per room and jittered.
    const flat = floors.filter((f) => !f.raised);
    const high = floors.filter((f) => f.raised);
    this.batch(
      prism(R, FLOOR_TOP),
      flat.map((f) => f.h),
      (h) => this.floorColor(h, COLORS.floor),
      (h) => [this.pk(h)],
      (h) => (hash2(h.q, h.r, this.level) - 0.5) * 0.04,
      0.08,
    );
    this.batch(
      prism(R, RAISED_TOP),
      high.map((f) => f.h),
      (h) => this.floorColor(h, COLORS.raised),
      (h) => [this.pk(h)],
      (h) => (hash2(h.q, h.r, this.level) - 0.5) * 0.04,
      0.1,
    );
    // Walls: taller stone prisms, lit when any neighbour is.
    this.batch(
      prism(R, WALL_HEIGHT),
      walls,
      (h) => new THREE.Color(COLORS.stone).offsetHSL(0, (hash2(h.q, h.r, 3) - 0.5) * 0.04, (hash2(h.r, h.q, 9) - 0.5) * 0.08),
      (h) => this.withNeighbours(h),
      (h) => (hash2(h.q, h.r, this.level + 5) - 0.5) * 0.18,
      0.1,
    );
    // Wall caps: a lighter rim so wall tops read from above.
    this.batch(
      prism(R * 0.86, 0.05),
      walls,
      (h) => new THREE.Color(COLORS.stoneLight).offsetHSL(0, 0, (hash2(h.q, h.r, 4) - 0.5) * 0.08),
      (h) => this.withNeighbours(h),
      (h) => WALL_HEIGHT + (hash2(h.q, h.r, this.level + 5) - 0.5) * 0.18,
      0.12,
    );
    // Rock rim: void hexes around open tiles, low and dark.
    this.batch(
      prism(R, WALL_HEIGHT * 0.8),
      [...rim.values()],
      (h) => new THREE.Color(COLORS.rock).offsetHSL(0, 0, (hash2(h.q, h.r, 2) - 0.5) * 0.04),
      (h) => this.withNeighbours(h),
      () => 0,
      0.05,
    );

    for (const f of floors) {
      switch (f.kind) {
        case 'pillar':
          this.addPillar(f.h);
          break;
        case 'rubble':
          this.addRubble(f.h);
          break;
        case 'door':
          this.addDoor(f.h);
          break;
        case 'stairs':
          this.addStairs(f.h);
          break;
        case 'exit':
          this.addExit(f.h);
          break;
        case 'brazier':
          this.addBrazier(f.h);
          break;
      }
    }
    for (const [k, t] of Object.entries(this.def.tiles)) {
      const h = parseHexKey(k);
      if (t.kind === 'pit') this.addPit(h);
      if (t.kind === 'cracked') this.addCracked(h);
    }
    this.buildLabels();
  }

  private floorColor(h: Hex, base: number): THREE.Color {
    const t = this.tile(h);
    const room = t?.room ?? '';
    let rh = 0;
    for (let i = 0; i < room.length; i++) rh = (rh * 31 + room.charCodeAt(i)) | 0;
    const roomTint = ((rh >>> 0) % 1000) / 1000;
    const a = hash2(h.q, h.r, this.level);
    const b = hash2(h.r, h.q, this.level + 7);
    return new THREE.Color(base).offsetHSL((roomTint - 0.5) * 0.04, (roomTint - 0.5) * 0.08 + (a - 0.5) * 0.04, (b - 0.5) * 0.07 + (roomTint - 0.5) * 0.04);
  }

  private withNeighbours(h: Hex): string[] {
    return [this.pk(h), ...DIRS.map((d) => this.pk(add(h, d)))];
  }

  private batch(geo: THREE.BufferGeometry, hexes: Hex[], color: (h: Hex) => THREE.Color, sources: (h: Hex) => string[], lift: (h: Hex) => number, litFloor: number): void {
    if (!hexes.length) return;
    const mat = fogMaterial({ instanced: true, litFloor });
    const mesh = new THREE.InstancedMesh(geo, mat, hexes.length);
    const fog = addFogAttribute(mesh, hexes.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    const srcs: string[][] = [];
    hexes.forEach((h, i) => {
      const w = hexToWorld(h, HEX);
      m.compose(new THREE.Vector3(w.x, this.y0 + lift(h), w.z), q, s);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, color(h));
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

  private addPillar(h: Hex): void {
    const stone = fogMaterial({ color: COLORS.stoneLight, litFloor: 0.12 });
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.48, 0.2, 8), stone);
    base.position.y = FLOOR_TOP + 0.1;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.33, WALL_HEIGHT - 0.2, 8), stone);
    shaft.position.y = FLOOR_TOP + (WALL_HEIGHT - 0.2) / 2 + 0.2;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.36, 0.18, 8), stone);
    cap.position.y = FLOOR_TOP + WALL_HEIGHT + 0.08;
    g.add(base, shaft, cap);
    this.place(h, g);
    this.extra(h, g, [stone], this.withNeighbours(h));
  }

  private addRubble(h: Hex): void {
    const rock = fogMaterial({ color: 0x6a6158, litFloor: 0.1 });
    const g = new THREE.Group();
    const n = 5;
    for (let i = 0; i < n; i++) {
      const a = hash2(h.q * 7 + i, h.r, 11) * Math.PI * 2;
      const d = 0.15 + hash2(h.q, h.r * 5 + i, 12) * 0.45;
      const s = 0.12 + hash2(h.q + i, h.r, 13) * 0.16;
      const m = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rock);
      m.position.set(Math.sin(a) * d, FLOOR_TOP + s * 0.5, Math.cos(a) * d);
      m.rotation.set(a, a * 2, 0);
      g.add(m);
    }
    this.place(h, g);
    this.extra(h, g, [rock]);
  }

  private addDoor(h: Hex): void {
    const k = this.pk(h);
    const axis = this.wallAxis(h);
    const ang = this.dirAngle(axis);
    const wood = fogMaterial({ color: COLORS.wood, litFloor: 0.14 });
    const iron = fogMaterial({ color: COLORS.iron, litFloor: 0.1 });
    const brass = fogMaterial({ color: COLORS.gold, litFloor: 0.25, emissive: 0x3a2400 });
    const frame = fogMaterial({ color: COLORS.stoneLight, litFloor: 0.12 });
    const root = new THREE.Group();
    root.rotation.y = ang;
    const span = HEX * 1.5;
    // Posts and lintel along the local z axis (the wall line).
    for (const z of [-span / 2, span / 2]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, WALL_HEIGHT, 0.22), frame);
      post.position.set(0, WALL_HEIGHT / 2, z);
      root.add(post);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.24, span + 0.2), frame);
    lintel.position.set(0, WALL_HEIGHT - 0.12, 0);
    root.add(lintel);
    // The slab hangs from a hinge at one post.
    const hinge = new THREE.Group();
    hinge.position.set(0, FLOOR_TOP, -span / 2 + 0.1);
    root.add(hinge);
    const slabH = WALL_HEIGHT - 0.38;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(0.1, slabH, span - 0.2), wood);
    slab.position.set(0, slabH / 2, (span - 0.2) / 2);
    hinge.add(slab);
    for (const y of [0.25, slabH - 0.25]) {
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
    hinge.add(padlock);
    const pad2 = padlock.clone();
    pad2.position.x = -0.1;
    hinge.add(pad2);
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
    // Steps run toward a solid neighbour.
    let dir = 0;
    for (let i = 0; i < 6; i++) if (isSolid(this.tile(add(h, DIRS[i]!)))) dir = i;
    const stone = fogMaterial({ color: 0x8a7e6e, litFloor: 0.14 });
    const dark = fogMaterial({ color: 0x050403, litFloor: 0 });
    const g = new THREE.Group();
    const steps = 5;
    if (down) {
      const well = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.86, R * 0.86, 0.02, 6), dark);
      well.position.y = FLOOR_TOP + 0.01;
      g.add(well);
      for (let i = 0; i < steps; i++) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.26), stone);
        s.position.set(0, FLOOR_TOP - (i + 1) * 0.14, -0.5 + i * 0.24);
        g.add(s);
      }
    } else {
      for (let i = 0; i < steps; i++) {
        const hgt = (i + 1) * 0.22;
        const s = new THREE.Mesh(new THREE.BoxGeometry(0.9, hgt, 0.24), stone);
        s.position.set(0, FLOOR_TOP + hgt / 2, -0.5 + i * 0.24);
        g.add(s);
      }
    }
    g.rotation.y = this.dirAngle(dir);
    this.place(h, g);
    this.extra(h, g, [stone, dark]);
  }

  private addExit(h: Hex): void {
    const axis = this.wallAxis(h);
    const stone = fogMaterial({ color: COLORS.stoneLight, litFloor: 0.2 });
    const glow = new THREE.MeshBasicMaterial({ color: 0xbfd8ff, transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const g = new THREE.Group();
    g.rotation.y = this.dirAngle(axis);
    const span = HEX * 1.5;
    for (const z of [-span / 2, span / 2]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.28, WALL_HEIGHT + 0.3, 0.28), stone);
      post.position.set(0, (WALL_HEIGHT + 0.3) / 2, z);
      g.add(post);
    }
    const arch = new THREE.Mesh(new THREE.TorusGeometry(span / 2, 0.14, 4, 10, Math.PI), stone);
    arch.rotation.y = Math.PI / 2;
    arch.position.y = WALL_HEIGHT + 0.3;
    g.add(arch);
    // Pale daylight spilling in: a column of light.
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.75, 2.6, 6, 1, true), glow);
    beam.position.y = 1.3 + FLOOR_TOP;
    g.add(beam);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.75, 6), glow);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = FLOOR_TOP + 0.02;
    g.add(disc);
    this.place(h, g);
    this.extra(h, g, [stone, glow], this.withNeighbours(h));
  }

  private addBrazier(h: Hex): void {
    const k = this.pk(h);
    const iron = fogMaterial({ color: 0x4a4440, litFloor: 0.12 });
    const stone = fogMaterial({ color: COLORS.stoneLight, litFloor: 0.12 });
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

  private addPit(h: Hex): void {
    const shaftMat = fogMaterial({ color: 0x2a2320, litFloor: 0.04, side: THREE.BackSide });
    const g = new THREE.Group();
    const depth = 3.2;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(R, R, depth, 6, 1, true), shaftMat);
    shaft.position.y = FLOOR_TOP - depth / 2;
    const glowMat = new THREE.MeshBasicMaterial({ color: COLORS.pitGlow, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending });
    const glow = new THREE.Mesh(new THREE.CircleGeometry(R * 0.95, 6), glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.rotation.z = Math.PI / 6;
    glow.position.y = FLOOR_TOP - depth + 0.05;
    const bottom = new THREE.Mesh(new THREE.CircleGeometry(R, 6), new THREE.MeshBasicMaterial({ color: 0x020102 }));
    bottom.rotation.x = -Math.PI / 2;
    bottom.rotation.z = Math.PI / 6;
    bottom.position.y = FLOOR_TOP - depth;
    g.add(shaft, bottom, glow);
    this.place(h, g);
    this.extra(h, g, [shaftMat, glowMat]);
  }

  private addCracked(h: Hex): void {
    const k = this.pk(h);
    const stone = fogMaterial({ color: 0x6a5f55, litFloor: 0.1 });
    const crack = fogMaterial({ color: 0x0a0806, litFloor: 0 });
    const g = new THREE.Group();
    const wall = new THREE.Mesh(prism(R, WALL_HEIGHT), stone);
    g.add(wall);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.04, WALL_HEIGHT * 0.7, 0.05), crack);
      c.position.set(Math.sin(a) * R * 0.86, WALL_HEIGHT * 0.45, Math.cos(a) * R * 0.86);
      c.rotation.set(0, a, (hash2(h.q + i, h.r, 1) - 0.5) * 0.9);
      g.add(c);
    }
    // Floor under it, for after the blast.
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
  }

  applyFog(visible: Set<string>, explored: Set<string>): void {
    this.applyFogLit(visible, new Set(), explored);
  }
}
