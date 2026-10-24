// Mockup of the proposed Level 2 (the Crossing) for the castle redesign pitch.
// Not part of the game build: open mockup/crossing.html with `npx vite`.
// Shows the proposed look: pale cutaway walls, room floors, props, fixed
// lights, bridges over the pit and the Hollow (Level 3) glowing below.

import * as THREE from 'three';
import { DIRS, distance, hexKey, hexToWorld, neighbors, type Hex } from '../src/game/hex';

const SIZE = 1;
const L2Y = 0;
const L3Y = -7;

// ------------------------------------------------------------------ layout

type Kind = 'floor' | 'bridge' | 'platform' | 'pit' | 'door' | 'locked';
const tiles = new Map<string, { h: Hex; kind: Kind; room: string }>();
const set = (h: Hex, kind: Kind, room: string) => tiles.set(hexKey(h), { h, kind, room });
const O: Hex = { q: 0, r: 0 };
const scale = (d: Hex, n: number): Hex => ({ q: d.q * n, r: d.r * n });
const addH = (a: Hex, b: Hex): Hex => ({ q: a.q + b.q, r: a.r + b.r });

// The pit, the bridges and the Crossing.
for (let q = -6; q <= 6; q++) {
  for (let r = -6; r <= 6; r++) {
    const h = { q, r };
    if (distance(h, O) > 6) continue;
    if (distance(h, O) <= 1) set(h, 'platform', 'crossing');
    else if (r === 0 || q === 0 || q === -r) set(h, 'bridge', 'bridge');
    else set(h, 'pit', 'pit');
  }
}
// The arcade ring.
for (let q = -8; q <= 8; q++) {
  for (let r = -8; r <= 8; r++) {
    const h = { q, r };
    const d = distance(h, O);
    if (d === 7 || d === 8) set(h, 'floor', 'arcade');
  }
}

// Six rooms, one at each bridge end.
interface Room { name: string; dir: number; radius: number; tint: number; door?: Kind }
const rooms: Room[] = [
  { name: 'guard', dir: 0, radius: 2, tint: 0x8c8478, door: 'door' },
  { name: 'forge', dir: 1, radius: 4, tint: 0x8a7462 },
  { name: 'barracks', dir: 2, radius: 3, tint: 0x8a7a5e },
  { name: 'cells', dir: 3, radius: 3, tint: 0x7c7a76, door: 'door' },
  { name: 'winch', dir: 4, radius: 3, tint: 0x857d70 },
  { name: 'archive', dir: 5, radius: 4, tint: 0x6e5f4c, door: 'locked' },
];
const roomCenter = (rm: Room) => scale(DIRS[rm.dir]!, 10 + rm.radius);
for (const rm of rooms) {
  const c = roomCenter(rm);
  for (let q = -rm.radius; q <= rm.radius; q++) {
    for (let r = -rm.radius; r <= rm.radius; r++) {
      const h = addH(c, { q, r });
      if (distance(h, c) <= rm.radius) set(h, 'floor', rm.name);
    }
  }
  // Corridor from the arcade to the room, 1 hex wide; a door at the room's edge.
  const d = DIRS[rm.dir]!;
  for (let n = 9; n <= 10 + rm.radius - rm.radius; n++) set(scale(d, n), 'floor', 'hall');
  if (rm.door) set(scale(d, 10), rm.door, 'hall');
}
// Cell walls inside the cellblock: knock out a few hexes to make cells.
const cellsC = roomCenter(rooms[3]!);
for (const off of [{ q: 0, r: -1 }, { q: 1, r: -2 }, { q: 0, r: 1 }, { q: -1, r: 2 }, { q: -2, r: 1 }, { q: -1, r: -1 }]) tiles.delete(hexKey(addH(cellsC, off)));

const isWalk = (k: string) => {
  const t = tiles.get(k);
  return !!t && t.kind !== 'pit';
};
const walls: Hex[] = [];
const seen = new Set<string>();
for (const t of tiles.values()) {
  if (t.kind === 'pit') continue;
  for (const n of neighbors(t.h)) {
    const k = hexKey(n);
    if (tiles.has(k) || seen.has(k)) continue;
    seen.add(k);
    walls.push(n);
  }
}

// ------------------------------------------------------------------ scene

const W = 1600;
const H = 1000;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H);
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = false;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0a0c);
scene.fog = new THREE.Fog(0x0b0a0c, 95, 170);

scene.add(new THREE.HemisphereLight(0xb8c4d8, 0x2a2018, 0.55));
const key = new THREE.DirectionalLight(0xfff0dc, 0.75);
key.position.set(-20, 40, 25);
scene.add(key);

const hexShape = (s: number) => {
  const sh = new THREE.Shape();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    const x = s * Math.cos(a);
    const y = s * Math.sin(a);
    if (i === 0) sh.moveTo(x, y);
    else sh.lineTo(x, y);
  }
  sh.closePath();
  return sh;
};
const prism = (s: number, h: number) => {
  const g = new THREE.ExtrudeGeometry(hexShape(s), { depth: h, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  return g;
};
const at = (h: Hex, y: number) => {
  const w = hexToWorld(h, SIZE);
  return new THREE.Vector3(w.x, y, w.z);
};
const mat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, flatShading: true, ...extra });

// Floors: one slab per hex with a hairline gap, tinted by room.
const floorGeo = prism(SIZE * 0.97, 0.25);
const tintOf: Record<string, number> = { crossing: 0xa69c8c, bridge: 0x9c9282, arcade: 0x948a7c, hall: 0x8a8276 };
for (const rm of rooms) tintOf[rm.name] = rm.tint;
for (const t of tiles.values()) {
  if (t.kind === 'pit') continue;
  const jitter = ((t.h.q * 7 + t.h.r * 13) % 5) * 0.008;
  const c = new THREE.Color(tintOf[t.room] ?? 0x8a8276).offsetHSL(0, 0, jitter - 0.016);
  const m = new THREE.Mesh(floorGeo, mat(c.getHex()));
  m.position.copy(at(t.h, L2Y - 0.25));
  scene.add(m);
}
// Bridge undersides, so the bridges read as spans over the void.
const underGeo = prism(SIZE * 0.6, 1.2);
for (const t of tiles.values()) {
  if (t.kind !== 'bridge' && t.kind !== 'platform') continue;
  const m = new THREE.Mesh(underGeo, mat(0x5e564c));
  m.position.copy(at(t.h, L2Y - 1.45));
  scene.add(m);
}

// Cutaway walls: low, pale cap, darker face.
const wallGeo = prism(SIZE * 1.0, 0.9);
const capGeo = prism(SIZE * 1.0, 0.08);
const wallMat = mat(0x8f877b);
const capMat = mat(0xd9d0c0);
for (const w of walls) {
  const m = new THREE.Mesh(wallGeo, wallMat);
  m.position.copy(at(w, L2Y));
  scene.add(m);
  const cap = new THREE.Mesh(capGeo, capMat);
  cap.position.copy(at(w, L2Y + 0.9));
  scene.add(cap);
}

// Railing along the pit side of the arcade, with two broken gaps.
const railGeo = new THREE.BoxGeometry(0.9, 0.35, 0.18);
const railMat = mat(0xc9bfae);
let railCount = 0;
for (const t of tiles.values()) {
  if (t.room !== 'arcade' || distance(t.h, O) !== 7) continue;
  for (const n of neighbors(t.h)) {
    const nt = tiles.get(hexKey(n));
    if (!nt || nt.kind !== 'pit') continue;
    railCount++;
    if (railCount % 11 === 4 || railCount % 11 === 5) continue; // broken gap
    const a = at(t.h, L2Y);
    const b = at(n, L2Y);
    const mid = a.clone().lerp(b, 0.5);
    const m = new THREE.Mesh(railGeo, railMat);
    m.position.set(mid.x, L2Y + 0.17, mid.z);
    m.lookAt(b.x, L2Y + 0.17, b.z);
    scene.add(m);
  }
}
// Arcade pillars and arches on the outer ring.
const pillarGeo = new THREE.CylinderGeometry(0.28, 0.32, 2.2, 8);
const pillarMat = mat(0xcfc6b5);
const ring8 = [...tiles.values()].filter((t) => t.room === 'arcade' && distance(t.h, O) === 8);
ring8.sort((a, b) => Math.atan2(at(a.h, 0).z, at(a.h, 0).x) - Math.atan2(at(b.h, 0).z, at(b.h, 0).x));
ring8.forEach((t, i) => {
  if (i % 4 !== 0) return;
  const p = new THREE.Mesh(pillarGeo, pillarMat);
  p.position.copy(at(t.h, L2Y + 1.1));
  scene.add(p);
});

// Doors.
for (const t of tiles.values()) {
  if (t.kind !== 'door' && t.kind !== 'locked') continue;
  const g = new THREE.BoxGeometry(1.3, 1.5, 0.2);
  const m = new THREE.Mesh(g, mat(t.kind === 'locked' ? 0xb08a2e : 0x6b4a2a, { emissive: t.kind === 'locked' ? 0x2a1a00 : 0 }));
  const p = at(t.h, L2Y + 0.75);
  m.position.copy(p);
  m.lookAt(0, L2Y + 0.75, 0);
  scene.add(m);
}

// ------------------------------------------------------------------ props

const box = (w: number, h: number, d: number, color: number, p: THREE.Vector3, rotY = 0, extra: THREE.MeshStandardMaterialParameters = {}) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, extra));
  m.position.set(p.x, p.y + h / 2, p.z);
  m.rotation.y = rotY;
  scene.add(m);
  return m;
};
const light = (p: THREE.Vector3, color: number, intensity: number, dist: number) => {
  const l = new THREE.PointLight(color, intensity, dist, 1.6);
  l.position.copy(p);
  scene.add(l);
};
const roomAt = (name: string, off: Hex) => addH(roomCenter(rooms.find((r) => r.name === name)!), off);

// Forge: furnace, anvils, a rack.
const forgeP = at(roomAt('forge', { q: 2, r: -1 }), L2Y);
box(1.8, 1.6, 1.6, 0x4a403a, forgeP, 0.4);
box(1.0, 0.3, 1.0, 0xff6a1a, forgeP.clone().add(new THREE.Vector3(0, 1.0, 0.7)), 0.4, { emissive: 0xff5a10, emissiveIntensity: 2 });
light(forgeP.clone().add(new THREE.Vector3(0, 1.6, 1.2)), 0xff7a2a, 40, 12);
for (const off of [{ q: -1, r: 0 }, { q: 0, r: 1 }]) box(0.7, 0.6, 0.4, 0x3a3a40, at(roomAt('forge', off), L2Y), 0.3);
box(2.4, 1.3, 0.3, 0x5a3e28, at(roomAt('forge', { q: -2, r: -1 }), L2Y), 1.0);

// Archive: rows of tall shelves and a reading table.
for (const off of [{ q: -2, r: 1 }, { q: -1, r: 1 }, { q: 1, r: -1 }, { q: 2, r: -1 }, { q: -2, r: 3 }, { q: 2, r: 1 }]) {
  box(1.6, 1.8, 0.45, 0x5a3a22, at(roomAt('archive', off), L2Y), 0);
  box(1.45, 1.6, 0.47, 0x7a2e2e, at(roomAt('archive', off), L2Y + 0.1), 0);
}
box(1.6, 0.7, 0.9, 0x6a4a2e, at(roomAt('archive', { q: 0, r: 0 }), L2Y), 0.5);
light(at(roomAt('archive', { q: 0, r: 0 }), L2Y + 2), 0xffc070, 10, 7);

// Barracks: bunks and a long table.
for (const off of [{ q: -2, r: 0 }, { q: -1, r: -1 }, { q: 2, r: -2 }, { q: 2, r: 0 }]) box(1.6, 0.5, 0.8, 0x6b4f33, at(roomAt('barracks', off), L2Y), 0.5);
box(2.4, 0.7, 0.8, 0x6a4a2e, at(roomAt('barracks', { q: 0, r: 0 }), L2Y), -0.5);

// Winch room: the great drum and a gear.
const wp = at(roomAt('winch', { q: 0, r: 0 }), L2Y);
const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 2.4, 12), mat(0x5a4632));
drum.rotation.z = Math.PI / 2;
drum.position.set(wp.x, L2Y + 1.1, wp.z);
scene.add(drum);
const gear = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.18, 6, 16), mat(0x4a4a50, { metalness: 0.4, roughness: 0.6 }));
gear.position.set(wp.x + 1.4, L2Y + 1.3, wp.z);
gear.rotation.y = Math.PI / 2;
scene.add(gear);
box(0.4, 1.8, 0.4, 0x4a3a2a, wp.clone().add(new THREE.Vector3(-1.4, 0, 0)));
box(0.4, 1.8, 0.4, 0x4a3a2a, wp.clone().add(new THREE.Vector3(1.0, 0, 0)));

// Cellblock: cage bars.
for (const off of [{ q: 1, r: -1 }, { q: -1, r: 0 }, { q: 1, r: 1 }]) {
  const p = at(addH(cellsC, off), L2Y);
  for (let i = 0; i < 5; i++) {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.4, 5), mat(0x3a3a40, { metalness: 0.5 }));
    bar.position.set(p.x - 0.5 + i * 0.25, L2Y + 0.7, p.z + 0.55);
    scene.add(bar);
  }
}

// Guard post: table and weapon rack.
box(1.2, 0.7, 0.8, 0x6a4a2e, at(roomAt('guard', { q: 0, r: 0 }), L2Y), 0.2);
box(0.3, 1.4, 1.4, 0x4a3420, at(roomAt('guard', { q: 1, r: -1 }), L2Y), 0.5);

// Statue of the first Van Valkenburg on the Crossing.
const sp = at(O, L2Y);
box(1.2, 0.5, 1.2, 0xbfb6a6, sp);
const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.42, 1.4, 7), mat(0xbfb6a6));
torso.position.set(sp.x, L2Y + 1.2, sp.z);
scene.add(torso);
const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 0), mat(0xbfb6a6));
head.position.set(sp.x, L2Y + 2.1, sp.z);
scene.add(head);

// Wall sconces: warm points of light on walls next to floors.
const sconceSpots: Hex[] = [];
for (const w of walls) {
  const k = ((w.q * 31 + w.r * 17) % 9 + 9) % 9;
  if (k !== 0) continue;
  if (!neighbors(w).some((n) => isWalk(hexKey(n)))) continue;
  sconceSpots.push(w);
}
for (const w of sconceSpots.slice(0, 16)) {
  const p = at(w, L2Y + 1.15);
  const inward = neighbors(w).map((n) => at(n, L2Y + 1.15)).find((_, i) => isWalk(hexKey(neighbors(w)[i]!)))!;
  const s = p.clone().lerp(inward, 0.45);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 5), mat(0xffb040, { emissive: 0xff9020, emissiveIntensity: 3 }));
  flame.position.copy(s);
  scene.add(flame);
  light(s.clone().lerp(inward, 0.3), 0xffa050, 6, 6);
}

// ------------------------------------------------------------------ Level 3 below the pit

const caveMat = mat(0x3e3028);
for (let q = -9; q <= 9; q++) {
  for (let r = -9; r <= 9; r++) {
    const h = { q, r };
    const d = distance(h, O);
    if (d > 9) continue;
    const bump = (((q * 13 + r * 7) % 4) + 4) % 4;
    const m = new THREE.Mesh(prism(SIZE * 0.98, 0.4 + bump * 0.12), caveMat);
    m.position.copy(at(h, L3Y - 0.4));
    scene.add(m);
  }
}
// Hoard: heaps of gold.
const goldMat = mat(0xe0b040, { emissive: 0x6a4000, emissiveIntensity: 0.6, metalness: 0.6, roughness: 0.4 });
for (const off of [{ q: 1, r: 1 }, { q: 2, r: 0 }, { q: 0, r: 2 }, { q: 2, r: 1 }, { q: 1, r: 2 }]) {
  const heap = new THREE.Mesh(new THREE.ConeGeometry(0.7, 0.5, 7), goldMat);
  heap.position.copy(at(off, L3Y + 0.45));
  scene.add(heap);
}
// The Dragon, curled on its hoard: a low-poly body, neck, head and wings.
const drMat = mat(0x6a2a1e, { emissive: 0x200805 });
const dp = at({ q: 1, r: 1 }, L3Y + 0.5);
const dragon = new THREE.Group();
const body = new THREE.Mesh(new THREE.IcosahedronGeometry(1.3, 0), drMat);
body.scale.set(2.0, 1.1, 1.4);
body.position.set(dp.x, dp.y + 0.8, dp.z);
scene.add(body);
const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.45, 2, 6), drMat);
neck.position.set(dp.x - 1.6, dp.y + 1.5, dp.z - 0.6);
neck.rotation.z = 0.9;
scene.add(neck);
const dHead = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.3, 5), drMat);
dHead.position.set(dp.x - 2.5, dp.y + 2.1, dp.z - 0.9);
dHead.rotation.z = Math.PI / 2 + 0.3;
scene.add(dHead);
for (const s of [-1, 1]) {
  const wing = new THREE.Mesh(new THREE.ConeGeometry(1.4, 0.15, 3), mat(0x4a1e16));
  wing.position.set(dp.x + 0.3, dp.y + 1.6, dp.z + s * 1.1);
  wing.rotation.set(s * 0.6, 0, Math.PI / 2);
  scene.add(wing);
}
// Fire vents and the glow that rises through the pit.
for (const off of [{ q: -3, r: 2 }, { q: 3, r: -2 }, { q: -1, r: -3 }, { q: 3, r: 1 }]) {
  const v = new THREE.Mesh(prism(0.6, 0.15), mat(0xff5a10, { emissive: 0xff4a00, emissiveIntensity: 3 }));
  v.position.copy(at(off, L3Y + 0.2));
  scene.add(v);
}
light(at({ q: 0, r: 0 }, L3Y + 3), 0xff6a20, 120, 22);
light(at({ q: 0, r: 0 }, L2Y - 1.5), 0xff8a40, 18, 9);

// ------------------------------------------------------------------ figures and UI hints

const figure = (h: Hex, color: number, tall = 1) => {
  const p = at(h, L2Y);
  const b = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.9 * tall, 7), mat(color));
  b.position.set(p.x, L2Y + 0.45 * tall, p.z);
  scene.add(b);
  const hd = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), mat(0xd8b898));
  hd.position.set(p.x, L2Y + 0.9 * tall + 0.15, p.z);
  scene.add(hd);
};
// The party on the west bridge, an orc on the bridge's far end.
const party: Hex[] = [{ q: -4, r: 0 }, { q: -5, r: 0 }, { q: -6, r: 0 }, { q: -7, r: 0 }];
const colors = [0xd8a030, 0xb83a30, 0x3a9a50, 0x7a50c0];
party.forEach((h, i) => figure(h, colors[i]!));
figure({ q: -2, r: 0 }, 0x4a5a2a, 1.15);
light(at({ q: -5, r: 0 }, L2Y + 2.2), 0xffb862, 14, 8);

// Cyan reach outlines from the lead hero; a red edge lip under the hero on the bridge.
const outline = (h: Hex, color: number, y = L2Y + 0.02) => {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    const c = at(h, y);
    pts.push(new THREE.Vector3(c.x + 0.9 * Math.cos(a), y, c.z + 0.9 * Math.sin(a)));
  }
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color })));
};
for (const h of [{ q: -3, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }, { q: -1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 }]) outline(h, 0x48e0f0);
outline({ q: -2, r: 0 }, 0xff9a30);
outline({ q: -4, r: 0 }, 0xff3a2a);

// ------------------------------------------------------------------ camera

const cam = new THREE.PerspectiveCamera(34, W / H, 0.1, 300);
const yaw = Number(new URLSearchParams(location.search).get('yaw') ?? '0.55');
const pitch = Number(new URLSearchParams(location.search).get('pitch') ?? '0.95');
const dist = Number(new URLSearchParams(location.search).get('dist') ?? '70');
const tx = Number(new URLSearchParams(location.search).get('tx') ?? '0');
const tz = Number(new URLSearchParams(location.search).get('tz') ?? '0');
cam.position.set(tx + Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, tz + Math.cos(yaw) * Math.cos(pitch) * dist);
cam.lookAt(tx, -1.5, tz);
renderer.render(scene, cam);
(window as unknown as { mockupReady: boolean }).mockupReady = true;
