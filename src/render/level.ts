// Builds the 3D diorama for one LevelMap: floor tiles, walls, rock, doors,
// stairs, ladders and the Pit. Owns per-square fog for everything it built.

import * as THREE from 'three';
import { edgeKey, squareKey, type Dir } from '../engine/geometry';
import type { CastleMap, CellKind, Coord, DoorState, EdgeKind, LevelId, LevelMap } from '../engine/types';
import { addFogAttribute, fogMaterial, setMaterialFog, type FogMaterial } from './fogMaterial';
import { COLORS, FLOOR_TOP, WALL_HEIGHT, WALL_THICK, hash2, levelY } from './world';

const DOOR_HEIGHT = 1.12;
const DOOR_THICK = 0.09;
const PIT_DEPTH = 5;

export interface DoorView {
  key: string;
  group: THREE.Group;
  /** Pivot at the hinge; rotate.y swings the slab. */
  hinge: THREE.Group;
  slab: THREE.Mesh;
  padlock: THREE.Group;
  splinters: THREE.Group;
  materials: THREE.Material[];
  squares: [string, string];
  /** Rotation for the open pose. */
  openAngle: number;
  /** World centre of the doorway, for effects. */
  center: THREE.Vector3;
  state: { open: boolean; locked: boolean; destroyed: boolean };
}

interface FogItem {
  sources: string[];
}

function cellOf(lv: LevelMap, x: number, y: number): CellKind {
  if (x < lv.x0 || x >= lv.x0 + lv.width || y < 0 || y >= lv.height) return 'rock';
  return lv.cells[y * lv.width + (x - lv.x0)]!;
}

export class LevelView {
  readonly group = new THREE.Group();
  readonly id: LevelId;
  readonly doors = new Map<string, DoorView>();
  private tiles!: THREE.InstancedMesh;
  private tileFog!: THREE.InstancedBufferAttribute;
  private tileItems: FogItem[] = [];
  private walls!: THREE.InstancedMesh;
  private wallFog!: THREE.InstancedBufferAttribute;
  private wallItems: FogItem[] = [];
  private rock!: THREE.InstancedMesh;
  private rockFog!: THREE.InstancedBufferAttribute;
  private rockItems: FogItem[] = [];
  /** Individually fogged meshes (stairs, ladders, pit shafts). */
  private extras: { mats: THREE.Material[]; sources: string[] }[] = [];
  /** Floor squares by key, for picking. */
  readonly floor = new Set<string>();

  constructor(
    readonly lv: LevelMap,
    readonly map: CastleMap,
  ) {
    this.id = lv.id;
    this.group.name = `level-${lv.id}`;
    this.buildTiles();
    this.buildRock();
    this.buildWalls();
    this.buildDoors();
    this.buildLinks();
    this.buildPit();
    this.buildMarks();
  }

  private key(x: number, y: number): string {
    return squareKey({ level: this.id, x, y });
  }

  // ------------------------------------------------------------ floor

  private buildTiles(): void {
    const lv = this.lv;
    const squares: [number, number][] = [];
    for (let y = 0; y < lv.height; y++)
      for (let x = lv.x0; x < lv.x0 + lv.width; x++) if (cellOf(lv, x, y) === 'floor') squares.push([x, y]);
    const geo = tileGeometry();
    const mat = fogMaterial({ instanced: true, litFloor: 0.07 });
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, squares.length));
    mesh.count = squares.length;
    this.tileFog = addFogAttribute(mesh, Math.max(1, squares.length));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const col = new THREE.Color();
    const base = new THREE.Color(COLORS.floor);
    const y0 = levelY(this.id);
    squares.forEach(([x, y], i) => {
      const h = hash2(x, y, this.id);
      const h2 = hash2(y, x, this.id + 7);
      const lift = (h - 0.5) * 0.035;
      q.setFromEuler(new THREE.Euler((h2 - 0.5) * 0.03, Math.floor(h * 4) * (Math.PI / 2), (h - 0.5) * 0.03));
      m.compose(new THREE.Vector3(x + 0.5, y0 + lift, y + 0.5), q, new THREE.Vector3(1, 1, 1));
      mesh.setMatrixAt(i, m);
      col.copy(base).offsetHSL((h2 - 0.5) * 0.02, (h - 0.5) * 0.05, (h2 - 0.5) * 0.08);
      mesh.setColorAt(i, col);
      const k = this.key(x, y);
      this.tileItems.push({ sources: [k] });
      this.floor.add(k);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.receiveShadow = false;
    mesh.name = 'tiles';
    this.tiles = mesh;
    this.group.add(mesh);
  }

  // ------------------------------------------------------------ rock

  private buildRock(): void {
    const lv = this.lv;
    const items: { x: number; y: number; sources: string[] }[] = [];
    for (let y = -1; y <= lv.height; y++)
      for (let x = lv.x0 - 1; x <= lv.x0 + lv.width; x++) {
        if (cellOf(lv, x, y) !== 'rock') continue;
        const sources: string[] = [];
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const c = cellOf(lv, x + dx, y + dy);
            if (c !== 'rock') sources.push(this.key(x + dx, y + dy));
          }
        if (sources.length) items.push({ x, y, sources });
      }
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = fogMaterial({ instanced: true, color: COLORS.rock, litFloor: 0.05 });
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
    mesh.count = items.length;
    this.rockFog = addFogAttribute(mesh, Math.max(1, items.length));
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    const y0 = levelY(this.id);
    items.forEach((it, i) => {
      const h = hash2(it.x, it.y, 31 + this.id);
      const height = WALL_HEIGHT * (0.92 + h * 0.12);
      m.makeScale(1.001, height, 1.001).setPosition(it.x + 0.5, y0 + height / 2 - 0.05, it.y + 0.5);
      mesh.setMatrixAt(i, m);
      col.setHex(COLORS.rock).offsetHSL(0, 0, (h - 0.5) * 0.04);
      mesh.setColorAt(i, col);
      this.rockItems.push({ sources: it.sources });
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.name = 'rock';
    this.rock = mesh;
    this.group.add(mesh);
  }

  // ------------------------------------------------------------ walls

  private buildWalls(): void {
    const lv = this.lv;
    type W = { cx: number; cz: number; along: 'x' | 'z'; sources: string[]; seed: number };
    const ws: W[] = [];
    const visibleSide = (a: CellKind, b: CellKind) => a !== 'rock' || b !== 'rock';
    // Horizontal edges: above row y, between (x, y-1) and (x, y).
    for (let y = 0; y <= lv.height; y++)
      for (let x = lv.x0; x < lv.x0 + lv.width; x++) {
        const kind = lv.hEdges[y * lv.width + (x - lv.x0)] as EdgeKind;
        const a = cellOf(lv, x, y - 1);
        const b = cellOf(lv, x, y);
        if (kind !== 'wall' || !visibleSide(a, b)) continue;
        const sources = [a !== 'rock' ? this.key(x, y - 1) : '', b !== 'rock' ? this.key(x, y) : ''].filter(Boolean);
        ws.push({ cx: x + 0.5, cz: y, along: 'x', sources, seed: x * 3 + y });
      }
    for (let y = 0; y < lv.height; y++)
      for (let x = lv.x0; x <= lv.x0 + lv.width; x++) {
        const kind = lv.vEdges[y * (lv.width + 1) + (x - lv.x0)] as EdgeKind;
        const a = cellOf(lv, x - 1, y);
        const b = cellOf(lv, x, y);
        if (kind !== 'wall' || !visibleSide(a, b)) continue;
        const sources = [a !== 'rock' ? this.key(x - 1, y) : '', b !== 'rock' ? this.key(x, y) : ''].filter(Boolean);
        ws.push({ cx: x, cz: y + 0.5, along: 'z', sources, seed: x * 5 + y * 11 });
      }
    const geo = wallGeometry();
    const mat = fogMaterial({ instanced: true, color: 0xffffff, litFloor: 0.08 });
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, ws.length));
    mesh.count = ws.length;
    this.wallFog = addFogAttribute(mesh, Math.max(1, ws.length));
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    const y0 = levelY(this.id);
    ws.forEach((w, i) => {
      const h = hash2(w.seed, this.id, 5);
      const height = WALL_HEIGHT * (0.97 + h * 0.06);
      const len = 1 + WALL_THICK;
      if (w.along === 'x') m.makeScale(len, height, WALL_THICK);
      else m.makeScale(WALL_THICK, height, len);
      m.setPosition(w.cx, y0 + height / 2 - 0.04, w.cz);
      mesh.setMatrixAt(i, m);
      col.setHex(COLORS.stone).offsetHSL((h - 0.5) * 0.02, 0, (hash2(w.seed, 3) - 0.5) * 0.08);
      mesh.setColorAt(i, col);
      this.wallItems.push({ sources: w.sources });
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.name = 'walls';
    this.walls = mesh;
    this.group.add(mesh);
  }

  // ------------------------------------------------------------ doors

  private buildDoors(): void {
    const lv = this.lv;
    const y0 = levelY(this.id);
    const add = (key: string, kind: EdgeKind, hx: number, hz: number, along: 'x' | 'z', a: Coord, b: Coord) => {
      const group = new THREE.Group();
      const hinge = new THREE.Group();
      hinge.position.set(hx, y0, hz);
      group.add(hinge);
      const wood = fogMaterial({ color: COLORS.wood, litFloor: 0.12 });
      const iron = fogMaterial({ color: COLORS.iron, litFloor: 0.1 });
      const stone = fogMaterial({ color: COLORS.stone, litFloor: 0.08 });
      const brass = fogMaterial({ color: COLORS.ember, emissive: 0x6a3a08, litFloor: 0.4 });
      const slabGeo = new THREE.BoxGeometry(0.9, DOOR_HEIGHT, DOOR_THICK);
      slabGeo.translate(0.5, DOOR_HEIGHT / 2, 0);
      const slab = new THREE.Mesh(slabGeo, wood);
      // Iron bands.
      for (const by of [0.22, 0.85]) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.06, DOOR_THICK + 0.02), iron);
        band.position.set(0.5, by, 0);
        slab.add(band);
      }
      hinge.add(slab);
      // Lintel over the doorway, filling the wall above the door.
      const lintelGeo = new THREE.BoxGeometry(1 + WALL_THICK, WALL_HEIGHT - DOOR_HEIGHT, WALL_THICK);
      const lintel = new THREE.Mesh(lintelGeo, stone);
      lintel.position.set(0.5, DOOR_HEIGHT + (WALL_HEIGHT - DOOR_HEIGHT) / 2 - 0.02, 0);
      hinge.add(lintel);
      // Posts.
      for (const px of [0.02, 0.98]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, DOOR_HEIGHT, WALL_THICK + 0.02), stone);
        post.position.set(px, DOOR_HEIGHT / 2, 0);
        hinge.add(post);
      }
      // Lintel and posts should not swing: move them out of the slab's
      // hinge pivot by keeping hinge rotation on the slab only.
      const padlock = makePadlock(brass, iron);
      padlock.position.set(0.5, 0.62, 0);
      hinge.add(padlock);
      padlock.visible = kind === 'locked';
      const splinters = new THREE.Group();
      for (let i = 0; i < 7; i++) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(0.06 + hash2(i, 1) * 0.18, 0.03, 0.05), wood);
        s.position.set(0.1 + hash2(i, 2) * 0.8, 0.02, (hash2(i, 3) - 0.5) * 0.7);
        s.rotation.y = hash2(i, 4) * Math.PI;
        splinters.add(s);
      }
      splinters.visible = false;
      hinge.add(splinters);
      if (along === 'z') hinge.rotation.y = -Math.PI / 2;
      // Swing into whichever side has floor (prefer b).
      const openAngle = along === 'x' ? -Math.PI / 2 * 0.92 : -Math.PI / 2 * 0.92;
      const center = new THREE.Vector3(along === 'x' ? hx + 0.5 : hx, y0 + 0.6, along === 'x' ? hz : hz + 0.5);
      const view: DoorView = {
        key,
        group,
        hinge,
        slab,
        padlock,
        splinters,
        materials: [wood, iron, stone, brass],
        squares: [squareKey(a), squareKey(b)],
        openAngle,
        center,
        state: { open: false, locked: kind === 'locked', destroyed: false },
      };
      this.doors.set(key, view);
      this.group.add(group);
    };
    for (let y = 0; y <= lv.height; y++)
      for (let x = lv.x0; x < lv.x0 + lv.width; x++) {
        const kind = lv.hEdges[y * lv.width + (x - lv.x0)] as EdgeKind;
        if (kind !== 'door' && kind !== 'locked') continue;
        const a = { level: this.id, x, y: y - 1 };
        const b = { level: this.id, x, y };
        add(edgeKey(b, 'n'), kind, x, y, 'x', a, b);
      }
    for (let y = 0; y < lv.height; y++)
      for (let x = lv.x0; x <= lv.x0 + lv.width; x++) {
        const kind = lv.vEdges[y * (lv.width + 1) + (x - lv.x0)] as EdgeKind;
        if (kind !== 'door' && kind !== 'locked') continue;
        const a = { level: this.id, x: x - 1, y };
        const b = { level: this.id, x, y };
        add(edgeKey(b, 'w'), kind, x, y, 'z', a, b);
      }
  }

  // ------------------------------------------------------------ stairs and ladders

  private buildLinks(): void {
    for (const link of this.map.links) {
      for (const [here, there] of [
        [link.a, link.b],
        [link.b, link.a],
      ] as const) {
        if (here.level !== this.id) continue;
        const down = there.level > here.level;
        const obj = link.kind === 'stairs' ? this.makeStairs(here, down) : this.makeLadder(here, down);
        this.group.add(obj.object);
        this.extras.push({ mats: obj.mats, sources: [squareKey(here)] });
      }
    }
    // Reinforcement points: stairs down to level 4 (not playable).
    for (const rp of this.lv.reinforcementPoints) {
      const obj = this.makeStairs(rp, true);
      this.group.add(obj.object);
      this.extras.push({ mats: obj.mats, sources: [squareKey(rp)] });
    }
  }

  /** The direction the stairs run toward: a side with a wall, else north. */
  private stairDir(c: Coord): Dir {
    const lv = this.lv;
    const order: Dir[] = ['n', 'w', 'e', 's'];
    for (const d of order) {
      const kind = edgeKindOf(lv, c, d);
      if (kind === 'wall') return d;
    }
    return 'n';
  }

  private makeStairs(c: Coord, down: boolean): { object: THREE.Object3D; mats: THREE.Material[] } {
    const g = new THREE.Group();
    const stone = fogMaterial({ color: 0x7a6f62, litFloor: 0.12 });
    const dark = fogMaterial({ color: 0x0b0908, litFloor: 0 });
    const steps = 5;
    const dir = this.stairDir(c);
    const y0 = levelY(this.id);
    if (down) {
      // A dark well in the floor with steps descending away from the wall.
      const well = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.02, 0.84), dark);
      well.position.set(0, FLOOR_TOP + 0.005, 0);
      g.add(well);
      for (let i = 0; i < steps; i++) {
        const depth = (i + 1) * 0.16;
        const s = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.06, 0.16), stone);
        s.position.set(0, FLOOR_TOP + 0.03 - depth * 0.5, 0.34 - i * 0.17);
        s.scale.setScalar(1);
        g.add(s);
      }
      // A low parapet on the open sides.
      const rail = fogMaterial({ color: COLORS.stoneDark, litFloor: 0.08 });
      for (const sx of [-0.44, 0.44]) {
        const r = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.9), rail);
        r.position.set(sx, FLOOR_TOP + 0.11, 0);
        g.add(r);
      }
      g.userData.mats = [stone, dark, rail];
    } else {
      for (let i = 0; i < steps; i++) {
        const h = (i + 1) * 0.2;
        const s = new THREE.Mesh(new THREE.BoxGeometry(0.82, h, 0.18), stone);
        s.position.set(0, FLOOR_TOP + h / 2, 0.36 - i * 0.18);
        g.add(s);
      }
      g.userData.mats = [stone];
    }
    // Local -z points toward `dir`.
    g.rotation.y = { n: 0, w: Math.PI / 2, s: Math.PI, e: -Math.PI / 2 }[dir];
    g.position.set(c.x + 0.5, y0, c.y + 0.5);
    return { object: g, mats: g.userData.mats as THREE.Material[] };
  }

  private makeLadder(c: Coord, down: boolean): { object: THREE.Object3D; mats: THREE.Material[] } {
    const g = new THREE.Group();
    const wood = fogMaterial({ color: COLORS.wood, litFloor: 0.14 });
    const dark = fogMaterial({ color: 0x0b0908, litFloor: 0 });
    const y0 = levelY(this.id);
    const height = down ? 0.6 : 1.5;
    for (const sx of [-0.18, 0.18]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, height, 0.05), wood);
      rail.position.set(sx, height / 2, 0);
      g.add(rail);
    }
    for (let r = 0.18; r < height; r += 0.22) {
      const rung = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.035, 0.035), wood);
      rung.position.set(0, r, 0);
      g.add(rung);
    }
    g.rotation.x = -0.18;
    const root = new THREE.Group();
    if (down) {
      const hatch = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.02, 0.6), dark);
      hatch.position.y = FLOOR_TOP + 0.01;
      root.add(hatch);
    }
    root.add(g);
    g.position.z = -0.3;
    const dir = this.stairDir(c);
    root.rotation.y = { n: 0, w: Math.PI / 2, s: Math.PI, e: -Math.PI / 2 }[dir];
    root.position.set(c.x + 0.5, y0, c.y + 0.5);
    return { object: root, mats: [wood, dark] };
  }

  // ------------------------------------------------------------ the Pit

  private buildPit(): void {
    const lv = this.lv;
    const y0 = levelY(this.id);
    const shaft = fogMaterial({ color: 0x241f1b, litFloor: 0.03, side: THREE.DoubleSide });
    const bottom = fogMaterial({ color: 0x020202, litFloor: 0 });
    let any = false;
    for (let y = 0; y < lv.height; y++)
      for (let x = lv.x0; x < lv.x0 + lv.width; x++) {
        if (cellOf(lv, x, y) !== 'pit') continue;
        any = true;
        const sources = [this.key(x, y)];
        const dirs: [Dir, number, number][] = [
          ['n', 0, -1],
          ['s', 0, 1],
          ['w', -1, 0],
          ['e', 1, 0],
        ];
        for (const [, dx, dy] of dirs) {
          const n = cellOf(lv, x + dx, y + dy);
          if (n !== 'rock') sources.push(this.key(x + dx, y + dy));
          if (n === 'pit') continue;
          // Shaft wall on this side, going down.
          const wall = new THREE.Mesh(new THREE.PlaneGeometry(1, PIT_DEPTH), shaft);
          wall.position.set(x + 0.5 + dx * 0.5, y0 - PIT_DEPTH / 2 + FLOOR_TOP, y + 0.5 + dy * 0.5);
          wall.rotation.y = dx !== 0 ? Math.PI / 2 : 0;
          this.group.add(wall);
          // Lip of the balcony.
          const lip = new THREE.Mesh(new THREE.BoxGeometry(dx ? 0.08 : 1, 0.16, dy ? 0.08 : 1), shaft);
          lip.position.set(x + 0.5 + dx * 0.46, y0 + 0.08, y + 0.5 + dy * 0.46);
          this.group.add(lip);
        }
        const b = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), bottom);
        b.rotation.x = -Math.PI / 2;
        b.position.set(x + 0.5, y0 - PIT_DEPTH + 0.1, y + 0.5);
        this.group.add(b);
        this.extras.push({ mats: [], sources });
      }
    if (any) {
      // One shared pair of materials: fog the whole pit by its brightest square.
      const pitSquares: string[] = [];
      for (let y = 0; y < lv.height; y++)
        for (let x = lv.x0; x < lv.x0 + lv.width; x++) if (cellOf(lv, x, y) === 'pit') pitSquares.push(this.key(x, y));
      this.extras.push({ mats: [shaft, bottom], sources: pitSquares });
    }
  }

  // ------------------------------------------------------------ entrance and lair marks

  private buildMarks(): void {
    const y0 = levelY(this.id);
    for (const e of this.lv.entrances) {
      const mat = fogMaterial({ color: COLORS.ember, emissive: 0x3a2205, litFloor: 0.3 });
      const g = new THREE.Group();
      // A threshold arrow: three chevrons.
      for (let i = 0; i < 2; i++) {
        const chev = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.025, 3, 4, Math.PI / 2), mat);
        chev.rotation.x = -Math.PI / 2;
        chev.rotation.z = Math.PI / 4;
        chev.position.set(0, FLOOR_TOP + 0.012, -0.12 + i * 0.18);
        g.add(chev);
      }
      g.position.set(e.x + 0.5, y0, e.y + 0.5);
      this.group.add(g);
      this.extras.push({ mats: [mat], sources: [squareKey(e)] });
    }
  }

  // ------------------------------------------------------------ fog

  /** Apply fog values: key -> 1 visible, 0.5 explored, absent hidden. */
  applyFog(fog: Map<string, number>): void {
    const val = (srcs: string[]) => {
      let v = 0;
      for (const s of srcs) v = Math.max(v, fog.get(s) ?? 0);
      return v;
    };
    this.tileItems.forEach((it, i) => (this.tileFog.array[i] = val(it.sources)));
    this.tileFog.needsUpdate = true;
    this.wallItems.forEach((it, i) => (this.wallFog.array[i] = val(it.sources)));
    this.wallFog.needsUpdate = true;
    this.rockItems.forEach((it, i) => {
      const v = val(it.sources);
      this.rockFog.array[i] = v;
    });
    this.rockFog.needsUpdate = true;
    for (const d of this.doors.values()) setMaterialFog(d.materials, val(d.squares));
    for (const e of this.extras) setMaterialFog(e.mats, val(e.sources));
    void this.tiles;
    void this.walls;
    void this.rock;
  }

  /** Set a door's pose instantly from state. */
  setDoor(key: string, st: DoorState | undefined, kind: EdgeKind): void {
    const d = this.doors.get(key);
    if (!d) return;
    const destroyed = !!st?.destroyed;
    const open = destroyed || !!st?.open;
    const locked = st ? st.locked && !destroyed : kind === 'locked';
    d.state = { open, locked, destroyed };
    d.slab.visible = !destroyed;
    d.slab.rotation.y = open ? d.openAngle : 0;
    d.padlock.visible = locked && !open;
    d.splinters.visible = destroyed;
  }
}

export function edgeKindOf(lv: LevelMap, c: Coord, d: Dir): EdgeKind {
  if (d === 'n' || d === 's') {
    const y = d === 'n' ? c.y : c.y + 1;
    if (c.x < lv.x0 || c.x >= lv.x0 + lv.width || y < 0 || y > lv.height) return 'wall';
    return lv.hEdges[y * lv.width + (c.x - lv.x0)]!;
  }
  const x = d === 'w' ? c.x : c.x + 1;
  if (c.y < 0 || c.y >= lv.height || x < lv.x0 || x > lv.x0 + lv.width) return 'wall';
  return lv.vEdges[c.y * (lv.width + 1) + (x - lv.x0)]!;
}

function tileGeometry(): THREE.BufferGeometry {
  // A slightly bevelled flagstone: a box with its top face inset.
  const w = 0.47;
  const inset = 0.43;
  const top = FLOOR_TOP;
  const mid = FLOOR_TOP - 0.025;
  const bot = -0.1;
  const p: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => p.push(...a, ...b, ...c, ...a, ...c, ...d);
  const T = (x: number, z: number) => [x, top, z];
  const M = (x: number, z: number) => [x, mid, z];
  const B = (x: number, z: number) => [x, bot, z];
  quad(T(-inset, inset), T(inset, inset), T(inset, -inset), T(-inset, -inset));
  // Bevel ring.
  quad(M(-w, w), M(w, w), T(inset, inset), T(-inset, inset));
  quad(M(w, w), M(w, -w), T(inset, -inset), T(inset, inset));
  quad(M(w, -w), M(-w, -w), T(-inset, -inset), T(inset, -inset));
  quad(M(-w, -w), M(-w, w), T(-inset, inset), T(-inset, -inset));
  // Sides.
  quad(B(-w, w), B(w, w), M(w, w), M(-w, w));
  quad(B(w, w), B(w, -w), M(w, -w), M(w, w));
  quad(B(w, -w), B(-w, -w), M(-w, -w), M(w, -w));
  quad(B(-w, -w), B(-w, w), M(-w, w), M(-w, -w));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  return g;
}

function wallGeometry(): THREE.BufferGeometry {
  // Unit box; a ragged top is overkill at this scale.
  return new THREE.BoxGeometry(1, 1, 1);
}

function makePadlock(brass: FogMaterial, iron: FogMaterial): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.17, 0.22), brass);
  g.add(body);
  const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.022, 4, 8, Math.PI), iron);
  shackle.position.y = 0.085;
  g.add(shackle);
  const hole = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.24), iron);
  hole.position.y = -0.02;
  g.add(hole);
  return g;
}
