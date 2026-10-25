// Scale and proportion study (V3.3): the same room corner rendered at three
// figure scales so the owner can pick a direction before it is applied.
// Not part of the game build. Open mockup/scale-options.html with `npx vite`
// and pick a panel with ?panel=A|B|C; any preset field can be overridden by a
// URL parameter of the same name (e.g. ?panel=B&fig=1.5&wall=2.2&head=0.22),
// so a fourth variant is a parameter change. Camera: ?yaw ?pitch ?dist ?tx ?tz.
//
// Units: world units, hex size 1 (center to corner, as src/game/hex.ts), so a
// hex is 1.73 across the flats. Figure and wall heights are given in those
// units. The Dragon's coil is given in tiles across (2.3 tiles = 3.98 units)
// and does not scale with the hero, so it reads big in every panel.

import * as THREE from 'three';
import { DIRS, add, hexKey, hexToWorld, offsetToAxial, type Hex } from '../src/game/hex';
import { COLORS, FLOOR_TOP, HEX, WALL_THICK, hash2 } from '../src/view/world';

// ------------------------------------------------------------------ presets

export interface Preset {
  key: string;
  name: string;
  note: string;
  /** Hero height, world units (hex size 1). */
  fig: number;
  /** Wall height, world units. */
  wall: number;
  /** Head height as a fraction of figure height (1/6 = 0.1667). */
  head: number;
  /** Limb thickness (diameter) as a fraction of figure height. */
  limb: number;
  /** Shoulder width as a fraction of figure height. */
  torso: number;
  /** Leg length as a fraction of figure height. */
  legs: number;
  /** Monster scale factors relative to the hero. */
  rat: number;
  spider: number;
  orc: number;
  /** Dragon coil, in tiles across (flat to flat). */
  dragon: number;
  /** Chest scale (1 = the game's chest). */
  chest: number;
}

const PRESETS: Record<string, Preset> = {
  A: { key: 'A', name: 'Miniatures', note: 'board-game diorama: slender, lots of floor', fig: 1.3, wall: 1.6, head: 1 / 6, limb: 0.05, torso: 0.26, legs: 0.48, rat: 0.35, spider: 0.8, orc: 1.05, dragon: 2.3, chest: 1 },
  B: { key: 'B', name: 'Stylised', note: 'big head, short legs, broad shoulders: toy-like', fig: 1.7, wall: 2.4, head: 1 / 4, limb: 0.085, torso: 0.42, legs: 0.3, rat: 0.35, spider: 0.8, orc: 1.05, dragon: 2.3, chest: 1 },
  C: { key: 'C', name: 'RuneScape', note: 'natural blocky, tall figures, imposing walls', fig: 2.0, wall: 2.6, head: 1 / 5, limb: 0.07, torso: 0.34, legs: 0.44, rat: 0.35, spider: 0.8, orc: 1.05, dragon: 2.3, chest: 1 },
};

const qs = new URLSearchParams(location.search);
const num = (k: string, d: number) => (qs.has(k) ? Number(qs.get(k)) : d);
const P: Preset = { ...(PRESETS[qs.get('panel') ?? 'A'] ?? PRESETS.A!) };
for (const k of ['fig', 'wall', 'head', 'limb', 'torso', 'legs', 'rat', 'spider', 'orc', 'dragon', 'chest'] as const) P[k] = num(k, P[k]);
if (qs.has('name')) P.name = qs.get('name')!;
if (qs.has('note')) P.note = qs.get('note')!;
if (qs.has('key')) P.key = qs.get('key')!;

const W = num('w', 700);
const H = num('h', 800);
const SQ3 = Math.sqrt(3);

// ------------------------------------------------------------------ layout

// Floor: 6 columns x 7 rows (odd-r offset), walls along row -1 (back) and col -1 (left).
const COLS = 6;
const ROWS = 7;
const floors = new Map<string, Hex>();
for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
  const h = offsetToAxial(col, row);
  floors.set(hexKey(h), h);
}
const DOOR = offsetToAxial(4, -1);
const SCONCE_WALL = offsetToAxial(2, -1);
const walls: Hex[] = [];
for (let col = -1; col < COLS; col++) walls.push(offsetToAxial(col, -1));
for (let row = 0; row < ROWS; row++) walls.push(offsetToAxial(-1, row));
const wallSet = new Set(walls.map(hexKey));
wallSet.delete(hexKey(DOOR));
const isOpen = (h: Hex) => floors.has(hexKey(h)) || hexKey(h) === hexKey(DOOR);

const at = (h: Hex, y = 0) => {
  const w = hexToWorld(h, HEX);
  return new THREE.Vector3(w.x, y, w.z);
};
const dirAngle = (i: number) => {
  const w = hexToWorld(DIRS[i]!, 1);
  return Math.atan2(w.x, w.z);
};

// ------------------------------------------------------------------ renderer and lights

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H);
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(COLORS.void, 1);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(COLORS.void);

// The game's lighting (src/view/diorama.ts): near-black ambient, a cool rim, a soft key.
scene.add(new THREE.AmbientLight(0x3a3f4a, 0.55));
scene.add(new THREE.HemisphereLight(0x9aa4b8, 0x2a2018, 0.7));
const rim = new THREE.DirectionalLight(COLORS.cold, 0.22);
rim.position.set(-6, 9, -8);
const key = new THREE.DirectionalLight(0xfff0dc, 0.55);
key.position.set(-20, 40, 25);
scene.add(rim, rim.target, key, key.target);
const point = (p: THREE.Vector3, color: number, intensity: number, reach: number) => {
  const l = new THREE.PointLight(color, intensity, reach, 1.1);
  l.position.copy(p);
  scene.add(l);
  return l;
};

// ------------------------------------------------------------------ materials and geometry helpers

const mat = (color: number, extra: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });
const glowMat = (color: number, opacity = 0.95) => new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, blending: THREE.AdditiveBlending, depthWrite: false });

/** Vertex shade (as src/view/level.ts): top faces `top`, sides fade from `bottom` at the base to `side` at the top. */
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
/** Hex prism, pointy-top, base at y = 0. */
function prism(radius: number, height: number, top = 1, bottom = 1, side = 1): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(radius, radius, height, 6, 1);
  g.translate(0, height / 2, 0);
  return shade(g, height, top, bottom, side);
}

let glowTex: THREE.Texture | null = null;
function glowSprite(color: number, size: number, opacity = 0.75): THREE.Sprite {
  if (!glowTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    glowTex = new THREE.CanvasTexture(c);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.scale.setScalar(size);
  return s;
}

// ------------------------------------------------------------------ floor (engraved hex joints, as src/view/fog.ts flagstone)

{
  const R = HEX * 0.985;
  const geo = prism(R, FLOOR_TOP, 1, 0.55);
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, vertexColors: true });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vLocal; varying vec3 vWorld; varying float vUp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocal = position.xz; vUp = normal.y; vWorld = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vLocal; varying vec3 vWorld; varying float vUp;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        if (vUp > 0.5) {
          vec2 p = vLocal;
          float d = max(abs(p.x), max(abs(dot(p, vec2(0.5, 0.8660254))), abs(dot(p, vec2(-0.5, 0.8660254)))));
          float edge = smoothstep(0.80, 0.86, d);
          float n1 = fract(sin(dot(floor(vWorld.xz * 2.3), vec2(12.9898, 78.233))) * 43758.5453);
          diffuseColor.rgb *= (0.94 + n1 * 0.1) * (1.0 - edge * 0.6);
        }`,
      );
  };
  const list = [...floors.values()];
  const mesh = new THREE.InstancedMesh(geo, m, list.length);
  const mtx = new THREE.Matrix4();
  list.forEach((h, i) => {
    mtx.makeTranslation(at(h).x, 0, at(h).z);
    mesh.setMatrixAt(i, mtx);
    mesh.setColorAt(i, new THREE.Color(0x8a8072).offsetHSL(0, 0, (hash2(h.q, h.r, 1) - 0.5) * 0.035));
  });
  scene.add(mesh);
  // Door sill.
  const sill = new THREE.Mesh(geo, mat(0x7a7268, { vertexColors: true }));
  sill.position.copy(at(DOOR));
  scene.add(sill);
}

// ------------------------------------------------------------------ walls: thin panels, pale cap, dark face, posts (src/view/level.ts 15.8)

const WALL_H = P.wall;
{
  const wallColor = (h: Hex) => new THREE.Color(COLORS.wallCap).offsetHSL(0, (hash2(h.q, h.r, 3) - 0.5) * 0.03, (hash2(h.r, h.q, 9) - 0.5) * 0.05);
  const panelGeo = shade(new THREE.BoxGeometry(HEX, WALL_H, WALL_THICK).translate(0, WALL_H / 2, (SQ3 / 2) * HEX - WALL_THICK / 2), WALL_H, 1, 0.55, 0.52);
  const postGeo = shade(new THREE.CylinderGeometry(WALL_THICK * 0.72, WALL_THICK * 0.72, WALL_H + 0.04, 6).translate(0, (WALL_H + 0.04) / 2, 0), WALL_H + 0.04, 1, 0.55, 0.52);
  const coreGeo = prism(HEX * 0.98, 0.24, 1, 0.5);
  const posts = new Set<string>();
  for (const h of walls) {
    if (!wallSet.has(hexKey(h))) continue;
    const c = at(h);
    const wm = mat(wallColor(h).getHex(), { vertexColors: true });
    const core = new THREE.Mesh(coreGeo, mat(new THREE.Color(0x5e554c).offsetHSL(0, 0, (hash2(h.q, h.r, 23) - 0.5) * 0.05).getHex(), { vertexColors: true }));
    core.position.copy(c);
    scene.add(core);
    for (let i = 0; i < 6; i++) {
      if (!isOpen(add(h, DIRS[i]!))) continue;
      const a = dirAngle(i);
      const panel = new THREE.Mesh(panelGeo, wm);
      panel.position.copy(c);
      panel.rotation.y = a;
      scene.add(panel);
      for (const s of [-1, 1]) {
        const ca = a + (s * Math.PI) / 6;
        const px = c.x + Math.sin(ca) * HEX * 0.985;
        const pz = c.z + Math.cos(ca) * HEX * 0.985;
        const k = `${Math.round(px * 20)},${Math.round(pz * 20)}`;
        if (posts.has(k)) continue;
        posts.add(k);
        const post = new THREE.Mesh(postGeo, wm);
        post.position.set(px, 0, pz);
        scene.add(post);
      }
    }
  }
}

// Door: frame posts and lintel along the wall axis, the slab swung open.
{
  const frame = mat(COLORS.wallCap);
  const wood = mat(COLORS.wood);
  const iron = mat(COLORS.iron);
  const root = new THREE.Group();
  root.position.copy(at(DOOR));
  root.rotation.y = dirAngle(0); // wall runs along world x
  const span = HEX * 1.8;
  for (const z of [-span / 2, span / 2]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.24, WALL_H + 0.1, 0.24), frame);
    post.position.set(0, (WALL_H + 0.1) / 2, z);
    root.add(post);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, span + 0.24), frame);
  lintel.position.set(0, WALL_H, 0);
  root.add(lintel);
  const hinge = new THREE.Group();
  hinge.position.set(0, FLOOR_TOP, -span / 2 + 0.1);
  hinge.rotation.y = -1.75; // open, swung into the room
  const slabH = WALL_H - 0.3;
  const slab = new THREE.Mesh(new THREE.BoxGeometry(0.1, slabH, span - 0.2), wood);
  slab.position.set(0, slabH / 2, (span - 0.2) / 2);
  hinge.add(slab);
  for (const y of [0.22, slabH - 0.22]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, span - 0.2), iron);
    band.position.set(0, y, (span - 0.2) / 2);
    hinge.add(band);
  }
  root.add(hinge);
  scene.add(root);
  // Dark beyond the doorway: a black slab so the opening reads as a passage.
  const dark = new THREE.Mesh(new THREE.BoxGeometry(span, WALL_H, 0.05), new THREE.MeshBasicMaterial({ color: 0x030203 }));
  dark.position.copy(at(DOOR, WALL_H / 2)).add(new THREE.Vector3(0, 0, -0.75));
  scene.add(dark);
}

// Sconce: bracket, cup, flame and halo on the wall face toward the room; a warm point light.
{
  const dir = 5; // toward row 0 from the back wall
  const iron = mat(COLORS.iron);
  const holder = new THREE.Group();
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.38), iron);
  arm.position.set(0, 0, 0.19);
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.06, 0.12, 6), iron);
  cup.position.set(0, 0.06, 0.4);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.32, 5), glowMat(0xffb040));
  flame.position.set(0, 0.28, 0.4);
  const halo = glowSprite(0xff9a40, 1.3, 0.75);
  halo.position.set(0, 0.28, 0.4);
  holder.add(arm, cup, flame, halo);
  holder.rotation.y = dirAngle(dir);
  const off = hexToWorld(DIRS[dir]!, 1);
  const c = at(SCONCE_WALL);
  holder.position.set(c.x + off.x * 0.49, WALL_H * 0.72, c.z + off.z * 0.49);
  scene.add(holder);
  point(new THREE.Vector3(c.x + off.x * 0.8, WALL_H * 0.9, c.z + off.z * 0.8), 0xffa050, 6.5, 3 * SQ3 + 2.2);
}

// Pillar: follows the wall height, as in the game (WALL_HEIGHT + 0.6).
{
  const stone = mat(COLORS.wallCap);
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.5, 0.22, 8), stone);
  base.position.y = FLOOR_TOP + 0.11;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, WALL_H + 0.6, 8), stone);
  shaft.position.y = FLOOR_TOP + (WALL_H + 0.6) / 2 + 0.2;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.36, 0.2, 8), stone);
  cap.position.y = FLOOR_TOP + WALL_H + 0.85;
  g.add(base, shaft, cap);
  g.position.copy(at(offsetToAxial(5, 3)));
  scene.add(g);
}

// Chest (src/view/props.ts makeChest, tier 2).
{
  const wood = mat(0x6b4426);
  const iron = mat(COLORS.gold, { emissive: 0x1a1000 });
  const brass = mat(COLORS.gold, { emissive: 0x3a2400 });
  const g = new THREE.Group();
  const w = 0.62;
  const d = 0.42;
  const box = new THREE.Mesh(new THREE.BoxGeometry(w, 0.32, d), wood);
  box.position.y = 0.16;
  g.add(box);
  for (const x of [-w / 2 + 0.06, w / 2 - 0.06]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.34, d + 0.02), iron);
    band.position.set(x, 0.16, 0);
    g.add(band);
  }
  const top = new THREE.Mesh(new THREE.CylinderGeometry(d / 2, d / 2, w, 6, 1, false, 0, Math.PI), wood);
  top.rotation.z = Math.PI / 2;
  top.position.set(0, 0.32, 0);
  g.add(top);
  const padlock = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.05), brass);
  padlock.position.set(0, 0.22, d / 2 + 0.03);
  g.add(padlock);
  g.scale.setScalar(P.chest);
  g.position.copy(at(offsetToAxial(5, 0), FLOOR_TOP));
  g.rotation.y = 0.35;
  scene.add(g);
}

// ------------------------------------------------------------------ parametric figures

interface Proportions {
  head: number;
  limb: number;
  torso: number;
  legs: number;
}
interface HumanOpts {
  skin: number;
  tunic: number;
  legs: number;
  /** Width multiplier on the torso (orcs are wide). */
  wide?: number;
  /** Forward lean of the torso, radians. */
  hunch?: number;
  crown?: boolean;
  banner?: number;
  sword?: boolean;
  blade?: boolean;
  cape?: number;
  eyes?: number;
  tusks?: boolean;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
function part(g: THREE.Group, geo: THREE.BufferGeometry, color: number, p: THREE.Vector3, rot?: [number, number, number], glow = false): THREE.Mesh {
  const m = new THREE.Mesh(geo, glow ? glowMat(color, 1) : mat(color));
  m.position.copy(p);
  if (rot) m.rotation.set(...rot);
  g.add(m);
  return m;
}

/** A humanoid of height `h` with the panel's proportions. Feet at y = 0, facing +z. */
function humanoid(h: number, pr: Proportions, o: HumanOpts): THREE.Group {
  const g = new THREE.Group();
  const wide = o.wide ?? 1;
  const headD = h * pr.head;
  const legL = h * pr.legs;
  const neck = h * 0.02;
  const torsoH = Math.max(h * 0.12, h - headD - legL - neck);
  const shoulderW = h * pr.torso * wide;
  const limbD = h * pr.limb;
  const legR = limbD * 0.55;
  const armR = limbD * 0.45;
  const depth = shoulderW * 0.5;
  // Legs and feet.
  const hip = shoulderW * 0.42;
  for (const sx of [-1, 1]) {
    part(g, new THREE.CylinderGeometry(legR, legR * 0.9, legL, 6), o.legs, V(sx * hip * 0.5, legL / 2, 0));
    part(g, new THREE.BoxGeometry(legR * 2.2, legR * 0.9, legR * 3.2), 0x2a1d12, V(sx * hip * 0.5, legR * 0.45, legR * 0.5));
  }
  // Torso (hunch tilts it forward about the hips).
  const torso = new THREE.Group();
  torso.position.y = legL;
  torso.rotation.x = o.hunch ?? 0;
  g.add(torso);
  const body = new THREE.Mesh(new THREE.BoxGeometry(shoulderW, torsoH, depth), mat(o.tunic));
  body.position.y = torsoH / 2;
  torso.add(body);
  // Belt.
  const belt = new THREE.Mesh(new THREE.BoxGeometry(shoulderW * 1.02, torsoH * 0.1, depth * 1.04), mat(0x2a1d12));
  belt.position.y = torsoH * 0.12;
  torso.add(belt);
  // Shoulders: a small cap each side so broad presets read as pauldrons.
  for (const sx of [-1, 1]) {
    part(torso, new THREE.SphereGeometry(armR * 1.5, 6, 4), COLORS.steel, V(sx * (shoulderW / 2 + armR * 0.2), torsoH - armR * 0.6, 0));
    // Arms hang from the shoulder, slightly forward.
    const armL = torsoH * 0.85;
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(armR, armR * 0.85, armL, 6), mat(o.tunic));
    arm.position.set(sx * (shoulderW / 2 + armR), torsoH - armR - armL / 2, armR * 0.3);
    arm.rotation.x = -0.15;
    torso.add(arm);
    part(torso, new THREE.SphereGeometry(armR * 1.05, 6, 4), o.skin, V(sx * (shoulderW / 2 + armR), torsoH - armR - armL, armR * 0.3 + armL * 0.08));
  }
  // Head.
  const hy = torsoH + neck + headD / 2;
  const headR = headD / 2;
  const head = new THREE.Mesh(new THREE.SphereGeometry(headR, 8, 6), mat(o.skin));
  head.position.set(0, hy, 0);
  torso.add(head);
  const eye = o.eyes ?? 0x1a1410;
  for (const sx of [-1, 1]) part(torso, new THREE.BoxGeometry(headR * 0.22, headR * 0.16, headR * 0.1), eye, V(sx * headR * 0.32, hy + headR * 0.1, headR * 0.92), undefined, o.eyes !== undefined);
  if (o.tusks) for (const sx of [-1, 1]) part(torso, new THREE.ConeGeometry(headR * 0.12, headR * 0.4, 4, 1), 0xe8dcc0, V(sx * headR * 0.35, hy - headR * 0.35, headR * 0.85));
  if (o.crown) {
    part(torso, new THREE.CylinderGeometry(headR * 0.75, headR * 0.7, headR * 0.3, 8), COLORS.gold, V(0, hy + headR * 0.85, 0));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      part(torso, new THREE.ConeGeometry(headR * 0.12, headR * 0.35, 4), COLORS.gold, V(Math.sin(a) * headR * 0.68, hy + headR * 1.12, Math.cos(a) * headR * 0.68));
    }
  }
  if (o.cape !== undefined) {
    const cape = new THREE.Mesh(new THREE.BoxGeometry(shoulderW * 0.95, torsoH + legL * 0.5, depth * 0.1), mat(o.cape));
    cape.position.set(0, torsoH - (torsoH + legL * 0.5) / 2 - armR * 0.5, -depth / 2 - depth * 0.08);
    cape.rotation.x = 0.08;
    torso.add(cape);
  }
  // Right hand (world -x when facing +z): sword or blade, held up and forward.
  const hx = -(shoulderW / 2 + armR);
  const handY = torsoH - armR - torsoH * 0.85;
  if (o.sword) {
    const len = h * 0.42;
    const sw = new THREE.Group();
    sw.position.set(hx, handY, armR * 0.3 + torsoH * 0.07);
    sw.rotation.x = -0.35;
    part(sw, new THREE.BoxGeometry(limbD * 0.55, len, limbD * 0.14), COLORS.steel, V(0, len / 2 + limbD * 0.4, 0));
    part(sw, new THREE.BoxGeometry(limbD * 1.6, limbD * 0.25, limbD * 0.3), 0x3a2a1a, V(0, limbD * 0.4, 0));
    part(sw, new THREE.CylinderGeometry(limbD * 0.22, limbD * 0.22, limbD * 0.9, 6), 0x3a2a1a, V(0, -limbD * 0.2, 0));
    part(sw, new THREE.SphereGeometry(limbD * 0.3, 6, 4), COLORS.gold, V(0, -limbD * 0.75, 0));
    torso.add(sw);
  }
  if (o.blade) {
    const len = h * 0.36;
    const bl = new THREE.Group();
    bl.position.set(hx, handY, armR * 0.3 + torsoH * 0.07);
    bl.rotation.set(-0.6, 0, 0.3);
    part(bl, new THREE.BoxGeometry(limbD * 1.1, len, limbD * 0.14), 0x6d6a66, V(0, len / 2, 0));
    part(bl, new THREE.CylinderGeometry(limbD * 0.25, limbD * 0.25, limbD * 1.0, 5), 0x3a2a1a, V(0, -limbD * 0.4, 0));
    torso.add(bl);
  }
  // Banner: a short pole over the left shoulder, flag above head height.
  if (o.banner !== undefined) {
    const top = h * 1.28;
    const x = shoulderW / 2 - armR * 0.3;
    const z = -depth * 0.35;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(limbD * 0.14, limbD * 0.14, top - legL * 0.6, 4), mat(0x2a1d12));
    pole.position.set(x, legL * 0.6 + (top - legL * 0.6) / 2, z);
    g.add(pole);
    const fh = h * 0.26;
    const fw = h * 0.2;
    const flag = new THREE.Mesh(new THREE.BoxGeometry(fw, fh, limbD * 0.1), mat(o.banner));
    flag.position.set(x + fw / 2, top - fh / 2, z);
    g.add(flag);
    part(g, new THREE.ConeGeometry(limbD * 0.25, limbD * 0.6, 4), COLORS.gold, V(x, top + limbD * 0.3, z));
  }
  return g;
}

/** Spider: `span` is the leg span across. Body low, eight legs out and down. */
function spider(span: number): THREE.Group {
  const g = new THREE.Group();
  const s = 0x2a2420;
  const legC = 0x1a1512;
  const bodyY = span * 0.17;
  part(g, new THREE.SphereGeometry(span * 0.17, 7, 5), s, V(0, bodyY, -span * 0.13), undefined).scale.set(1, 0.8, 1.15);
  part(g, new THREE.SphereGeometry(span * 0.11, 7, 5), s, V(0, bodyY, span * 0.1));
  part(g, new THREE.BoxGeometry(span * 0.12, span * 0.015, span * 0.14), 0xa02020, V(0, bodyY + span * 0.135, -span * 0.13));
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const z = span * (0.14 - i * 0.1);
      const yaw = (i - 1.5) * 0.3 * sx;
      const up = new THREE.Mesh(new THREE.BoxGeometry(span * 0.3, span * 0.03, span * 0.03), mat(legC));
      up.position.set(sx * span * 0.2, bodyY + span * 0.08, z);
      up.rotation.set(0, yaw, sx * 0.5);
      g.add(up);
      const down = new THREE.Mesh(new THREE.BoxGeometry(span * 0.03, span * 0.3, span * 0.03), mat(legC));
      down.position.set(sx * span * 0.42, bodyY - span * 0.02, z + Math.sin(yaw) * span * 0.14);
      down.rotation.set(0, 0, -sx * 0.3);
      g.add(down);
    }
    part(g, new THREE.SphereGeometry(span * 0.018, 5, 4), 0xff3030, V(sx * span * 0.045, bodyY + span * 0.04, span * 0.2), undefined, true);
    part(g, new THREE.SphereGeometry(span * 0.012, 5, 4), 0xff3030, V(sx * span * 0.08, bodyY + span * 0.02, span * 0.19), undefined, true);
  }
  return g;
}

/** Rat: `len` is nose-to-rump length. */
function rat(len: number): THREE.Group {
  const g = new THREE.Group();
  const fur = 0x4a3e36;
  const bodyR = len * 0.26;
  part(g, new THREE.SphereGeometry(bodyR, 7, 5), fur, V(0, bodyR * 0.85, 0)).scale.set(0.9, 0.8, 1.6);
  part(g, new THREE.ConeGeometry(bodyR * 0.75, len * 0.5, 6), fur, V(0, bodyR * 0.8, len * 0.62), [Math.PI / 2, 0, 0]);
  part(g, new THREE.SphereGeometry(bodyR * 0.12, 5, 4), 0xffb0a0, V(0, bodyR * 0.8, len * 0.88));
  for (const sx of [-1, 1]) {
    part(g, new THREE.SphereGeometry(bodyR * 0.25, 5, 4), 0xb07a6a, V(sx * bodyR * 0.45, bodyR * 1.25, len * 0.38));
    part(g, new THREE.SphereGeometry(bodyR * 0.08, 4, 3), 0xff4040, V(sx * bodyR * 0.3, bodyR * 0.95, len * 0.6), undefined, true);
  }
  for (let i = 0; i < 4; i++) {
    const t = i / 4;
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(bodyR * 0.12 * (1 - t * 0.6), bodyR * 0.12 * (1 - t * 0.6), len * 0.26, 4), mat(0xb07a6a));
    seg.position.set(Math.sin(t * 2.5) * len * 0.1, bodyR * 0.4, -len * 0.4 - t * len * 0.24);
    seg.rotation.set(Math.PI / 2, 0, -t * 0.8);
    g.add(seg);
  }
  return g;
}

/** The Dragon asleep (src/view/figures.ts dragon(asleep)), built at unit size and scaled so the coil spans `across`. */
function dragonAsleep(across: number): THREE.Group {
  const g = new THREE.Group();
  const scale = 0x8a2e1e;
  const dark = 0x5a1c12;
  const horn = 0xe8dcc0;
  const wing = 0x6a2216;
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 1.75 + 0.3;
    const r = 0.62;
    const s = 0.5 - i * 0.03;
    part(g, new THREE.SphereGeometry(s, 8, 6), i % 2 ? scale : dark, V(Math.cos(a) * r, s * 0.7, Math.sin(a) * r)).scale.set(1.25, 0.8, 1.1);
  }
  part(g, new THREE.SphereGeometry(0.62, 8, 6), scale, V(0, 0.5, 0)).scale.set(1.4, 0.75, 1.2);
  for (const sx of [-1, 1]) part(g, new THREE.ConeGeometry(0.55, 1.3, 3), wing, V(sx * 0.3, 0.95, -0.1), [0.2, 0, sx * 1.2]).scale.set(1, 1, 0.25);
  for (let i = 0; i < 5; i++) part(g, new THREE.ConeGeometry(0.08, 0.28, 4), horn, V(-0.4 + i * 0.2, 1.0 - Math.abs(i - 2) * 0.06, -0.05));
  part(g, new THREE.ConeGeometry(0.26, 0.85, 5), scale, V(0.85, 0.32, 0.7), [Math.PI / 2, 0, -0.4]).scale.set(1, 1, 0.75);
  part(g, new THREE.SphereGeometry(0.28, 8, 6), scale, V(0.6, 0.32, 0.45)).scale.set(1, 0.8, 1.1);
  part(g, new THREE.BoxGeometry(0.1, 0.02, 0.03), 0x1a0a06, V(0.68, 0.42, 0.62));
  for (const sx of [-1, 1]) part(g, new THREE.ConeGeometry(0.06, 0.38, 4), horn, V(0.5 + sx * 0.12, 0.55, 0.3), [-1.0, 0, sx * 0.3]);
  part(g, new THREE.ConeGeometry(0.12, 0.6, 4), dark, V(1.0, 0.18, -0.35), [0, 0, -1.4]);
  part(g, new THREE.SphereGeometry(0.06, 6, 4), 0xffa060, V(1.1, 0.4, 1.0), undefined, true);
  // Unit coil is about 2.5 across.
  g.scale.setScalar(across / 2.5);
  return g;
}

// ------------------------------------------------------------------ place the cast

const PR: Proportions = { head: P.head, limb: P.limb, torso: P.torso, legs: P.legs };
const SKIN = 0xc79a76;
const place = (obj: THREE.Object3D, h: Hex, face: number) => {
  obj.position.copy(at(h, FLOOR_TOP));
  obj.rotation.y = face;
  scene.add(obj);
};
const HERO_AT = offsetToAxial(2, 4);
const ORC_AT = offsetToAxial(4, 2);
const SPIDER_AT = offsetToAxial(0, 5);
const RAT_AT = offsetToAxial(4, 5);
const DRAGON_AT = offsetToAxial(1, 1);
const faceTo = (from: Hex, to: Hex) => {
  const a = at(from);
  const b = at(to);
  return Math.atan2(b.x - a.x, b.z - a.z);
};

const hero = humanoid(P.fig, PR, { skin: SKIN, tunic: 0x6f7378, legs: 0x3d3f44, crown: true, banner: 0xd9a93a, sword: true, cape: 0x7a1414 });
place(hero, HERO_AT, faceTo(HERO_AT, ORC_AT));
const orc = humanoid(P.fig * P.orc, PR, { skin: COLORS.orc, tunic: 0x3a2e22, legs: 0x241c14, wide: 1.3, hunch: 0.35, blade: true, eyes: COLORS.danger, tusks: true });
place(orc, ORC_AT, faceTo(ORC_AT, HERO_AT));
place(spider(P.fig * P.spider), SPIDER_AT, faceTo(SPIDER_AT, HERO_AT) + 0.4);
place(rat(P.fig * P.rat), RAT_AT, faceTo(RAT_AT, HERO_AT) - 0.6);
const dragon = dragonAsleep(P.dragon * SQ3);
dragon.position.copy(at(DRAGON_AT, FLOOR_TOP)).add(new THREE.Vector3(0.5, 0, 0.3));
dragon.rotation.y = 0.9;
scene.add(dragon);

// The hero's lantern (the game's bright radius 4) and the Dragon's ember breath.
point(at(HERO_AT, FLOOR_TOP).add(new THREE.Vector3(0.3, P.fig + 0.5, 0.3)), 0xffb862, 8.2, 4 * SQ3 + 2.2);
point(at(DRAGON_AT, 0.5).add(new THREE.Vector3(1.6, 0, 1.4)), 0xff7a30, 1.6, 4);
const breath = glowSprite(0xff7a30, 1.2, 0.5);
breath.position.copy(at(DRAGON_AT, 0.7)).add(new THREE.Vector3(1.9, 0, 1.6));
scene.add(breath);

// ------------------------------------------------------------------ camera (the game's default pitch and yaw)

const yaw = num('yaw', 0);
const pitch = num('pitch', 0.95);
const dist = num('dist', 20);
const center = at(offsetToAxial(2, 3));
const tx = num('tx', center.x + 0.85);
const tz = num('tz', center.z - 0.4);
const ty = num('ty', 0.6);
const cam = new THREE.PerspectiveCamera(40, W / H, 0.1, 300);
cam.position.set(tx + Math.sin(yaw) * Math.cos(pitch) * dist, ty + Math.sin(pitch) * dist, tz + Math.cos(yaw) * Math.cos(pitch) * dist);
cam.lookAt(tx, ty, tz);
renderer.render(scene, cam);

// ------------------------------------------------------------------ label

const frac = (x: number) => {
  for (const d of [3, 4, 5, 6, 7, 8]) if (Math.abs(x * d - Math.round(x * d)) < 0.02) return `${Math.round(x * d)}/${d}`;
  return x.toFixed(2);
};
const label = document.getElementById('label');
if (label) {
  label.innerHTML =
    `<div class="name"><b>${P.key}</b>${P.name}</div>` +
    `<div class="nums">figure ${P.fig.toFixed(1)} hex · wall ${P.wall.toFixed(1)} hex · head ${frac(P.head)}</div>` +
    `<div class="note">${P.note}</div>`;
}
(window as unknown as { mockupReady: boolean }).mockupReady = true;
