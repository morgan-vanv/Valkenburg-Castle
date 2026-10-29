// V5.3 (spec 36): the title's castle, built in the game's own look and baked once into an image. NOT imported by the
// app: scripts/v53-bake-title.mjs loads it from the vite dev server in headless Chromium, renders it with alpha, and
// saves public/title/castle.webp (and @2x) with a manifest of where it sits on the 1920x1080 title stage and where its
// lights are (the title draws their glow and flicker in CSS). The sky, moon and Lowgate stay the page's own.
//
// Valkenburg on a crag of hex basalt columns, terraced like the board: a hex keep, hex towers, curtain walls, all
// clad in the walls' bricks (WALL_LOOK). It has gone dark: a broken tower, a breached wall, rubble, a torn banner,
// most windows black and a few still lit. Moonlight from the right, Lowgate's warm glow from below, haze at the foot,
// a lantern-lit path of hex steps down toward the village. The tease of Level 3 (the owner's pick, V5.3.1): the
// keep's high window is dark, and one ember eye looks out of it (the title draws and blinks it).
//
// Changing this file changes the hash in public/title/manifest.json; src/ui/camp/title-bake.test.ts fails until the
// title is baked again.

import * as THREE from 'three';
import { bevelGeometry } from '../../view/look/floors';
import { WALL_LOOK } from '../../view/look/walls';

export interface TitleGlow {
  /** Stage px (1920x1080). */
  x: number;
  y: number;
  /** Glow radius in stage px. */
  r: number;
  kind: 'window' | 'gate' | 'lantern' | 'eye';
}

export interface TitleBake {
  /** The cropped image (alpha). */
  url: string;
  /** Where the crop sits on the stage, in stage px. */
  x: number;
  y: number;
  w: number;
  h: number;
  glows: TitleGlow[];
}

const STAGE_W = 1920;
const STAGE_H = 1080;
/** The camera: low in Lowgate, looking up and to the left so the castle stands right of the lockup. */
const CAMERA = { fov: 30, pos: [-6, 3.5, 54] as const, look: [-14.2, 9.6, 0] as const };

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const S3 = Math.sqrt(3);
/** Axial hex (pointy along z, circumradius 1) to the x/z plane. */
const hx = (q: number, r: number) => new THREE.Vector2(S3 * (q + r / 2), 1.5 * r);
const hd = (q: number, r: number) => (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;

const TOP = 7.2;

/** The axial hex under a point (cube rounding). */
function hexAt(x: number, z: number): [number, number] {
  const fq = (S3 / 3) * x - z / 3, fr = (2 / 3) * z, fs = -fq - fr;
  let q = Math.round(fq), r = Math.round(fr);
  const s = Math.round(fs);
  const dq = Math.abs(q - fq), dr = Math.abs(r - fr), ds = Math.abs(s - fs);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return [q, r];
}
const BRICK = { l: 0.62, h: 0.27, d: 0.14, gap: 0.035 };

interface Built {
  scene: THREE.Scene;
  /** World positions of lights to glow on the title. */
  glows: { at: THREE.Vector3; r: number; kind: TitleGlow['kind'] }[];
  dispose(): void;
}

export function buildTitleCastle(): Built {
  const R = rng(1980);
  const scene = new THREE.Scene();
  const disposables: { dispose(): void }[] = [];
  const glows: Built['glows'] = [];
  const keepMat = <T extends { dispose(): void }>(m: T): T => (disposables.push(m), m);
  const flat = (c: number | THREE.Color, o: THREE.MeshStandardMaterialParameters = {}) =>
    keepMat(new THREE.MeshStandardMaterial({ color: c, roughness: 0.92, metalness: 0, flatShading: true, ...o }));
  const jit = (c: number, k = 0.12) => new THREE.Color(c).multiplyScalar(1 - k + R() * 2 * k);

  // ---------------------------------------------------------- bricks, instanced
  const brickGeo = keepMat(new THREE.BoxGeometry(1, 1, 1));
  const brickMat = flat(0xffffff);
  const bricks: { m: THREE.Matrix4; c: THREE.Color }[] = [];
  const pushBrick = (x: number, y: number, z: number, ang: number, l: number, h = BRICK.h, d = BRICK.d, tone = 1, tilt = 0) => {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, ang, tilt * 0.6)),
      new THREE.Vector3(l, h, d),
    );
    const c = new THREE.Color(WALL_LOOK.bricks[Math.floor(R() * WALL_LOOK.bricks.length)]!).multiplyScalar((0.86 + R() * 0.22) * tone);
    bricks.push({ m, c });
  };
  /**
   * Lay running-bond courses on a flat face: centre (cx, cz), facing `ang` (outward normal (sin, cos)), `width` wide,
   * from y0 to y0 + height. `keep(u, v)` (0..1 across and up) can drop bricks for breaches and broken tops.
   */
  const clad = (cx: number, cz: number, ang: number, width: number, y0: number, height: number, keep?: (u: number, v: number) => boolean) => {
    const tx = Math.cos(ang), tz = -Math.sin(ang); // the face's tangent
    const nx = Math.sin(ang), nz = Math.cos(ang);
    const rows = Math.max(1, Math.round(height / BRICK.h));
    const rh = height / rows;
    const n = Math.max(1, Math.round(width / BRICK.l));
    const bl = width / n;
    for (let row = 0; row < rows; row++) {
      const off = row % 2 ? 0.5 : 0;
      const cells = off ? n + 1 : n;
      for (let i = 0; i < cells; i++) {
        let a = (i - off) * bl, b = a + bl;
        a = Math.max(0, a);
        b = Math.min(width, b);
        if (b - a < bl * 0.3) continue;
        const u = (a + b) / 2 / width, v = (row + 0.5) / rows;
        if (keep && !keep(u, v)) continue;
        const s = (a + b) / 2 - width / 2;
        const out = BRICK.d / 2 - 0.02 + (R() - 0.5) * 0.02;
        pushBrick(cx + tx * s + nx * out, y0 + (row + 0.5) * rh, cz + tz * s + nz * out, ang, b - a - BRICK.gap, rh - BRICK.gap);
      }
    }
  };
  /** A hex prism of bricks around a mortar core (circumradius `rad`); faces numbered from +z clockwise. */
  const hexBody = (x: number, z: number, rad: number, y0: number, h: number, keep?: (face: number, u: number, v: number) => boolean) => {
    const core = new THREE.Mesh(keepMat(new THREE.CylinderGeometry(rad * 0.94, rad * 0.95, h, 6)), flat(WALL_LOOK.mortar));
    core.position.set(x, y0 + h / 2, z);
    core.castShadow = core.receiveShadow = true;
    scene.add(core);
    for (let f = 0; f < 6; f++) {
      const ang = ((f * 60 + 30) * Math.PI) / 180;
      const d = rad * Math.cos(Math.PI / 6) * 0.94;
      clad(x + Math.sin(ang) * d, z + Math.cos(ang) * d, ang, rad * 0.97, y0, h, keep ? (u, v) => keep(f, u, v) : undefined);
    }
  };
  const merlonRing = (x: number, z: number, rad: number, y: number, skip?: (i: number) => boolean) => {
    for (let f = 0; f < 6; f++) {
      const ang = ((f * 60 + 30) * Math.PI) / 180;
      const d = rad * Math.cos(Math.PI / 6);
      for (const s of [-0.28, 0.28]) {
        if (skip?.(f * 2 + (s > 0 ? 1 : 0))) continue;
        const tx = Math.cos(ang) * s * rad, tz = -Math.sin(ang) * s * rad;
        pushBrick(x + Math.sin(ang) * d + tx, y + 0.24, z + Math.cos(ang) * d + tz, ang, rad * 0.36, 0.46, 0.3);
      }
    }
  };

  // ---------------------------------------------------------- the crag
  const tops = new Map<string, number>();
  for (let q = -12; q <= 12; q++)
    for (let r = -12; r <= 12; r++) {
      const d = hd(q, r);
      if (d > 11) continue;
      const p = hx(q, r);
      const front = p.y > 0 ? p.y * 0.18 : 0;
      let top = TOP - Math.max(0, d - 3.2) * 1.15 - front - R() * 0.9;
      if (d <= 3) top = TOP;
      top = Math.round(top * 2.5) / 2.5;
      if (top < 0.3) continue;
      tops.set(`${q},${r}`, top);
      const col = new THREE.Mesh(keepMat(bevelGeometry(0.95, 0.99, top + 6, 0.55)), flat(d <= 3 ? jit(0x5e584e, 0.05) : jit(0x47403b, 0.18), { vertexColors: true }));
      col.position.set(p.x, top, p.y);
      col.castShadow = col.receiveShadow = true;
      scene.add(col);
      if (d > 3 && R() < 0.4) {
        const moss = new THREE.Mesh(keepMat(new THREE.CylinderGeometry(0.78, 0.9, 0.08, 6)), flat(jit(0x46552f, 0.2)));
        moss.position.set(p.x, top + 0.04, p.y);
        moss.receiveShadow = true;
        scene.add(moss);
      }
    }

  /** A fallen brick on whatever ground is below (none over the edge of the crag). */
  const rubble = (x: number, z: number) => {
    const [q, r] = hexAt(x, z);
    const t = tops.get(`${q},${r}`);
    if (t === undefined) return;
    pushBrick(x, t + 0.12 + R() * 0.12, z, R() * 3, BRICK.l * 0.9, BRICK.h, BRICK.d * 1.6, 0.8, (R() - 0.5) * 0.6);
  };
  const roofMat = flat(0x2f3446, { roughness: 0.8 });
  const darkMat = flat(0x0c090c);
  const glowMat = keepMat(new THREE.MeshStandardMaterial({ color: 0xffb35c, emissive: 0xffa040, emissiveIntensity: 1.6, flatShading: true }));
  const light = (x: number, y: number, z: number, i: number, dist: number, kind: TitleGlow['kind'], r: number) => {
    const l = new THREE.PointLight(0xffa850, i, dist, 1.7);
    l.position.set(x, y, z);
    scene.add(l);
    glows.push({ at: new THREE.Vector3(x, y, z), r, kind });
  };
  /** A window set into a face: a dark recess, lit or not. Front faces only (the camera's side). */
  const windowAt = (x: number, y: number, z: number, ang: number, lit: boolean, big = false) => {
    const w = big ? 0.34 : 0.24, h = big ? 0.66 : 0.46;
    const rec = new THREE.Mesh(keepMat(new THREE.BoxGeometry(w + 0.12, h + 0.12, 0.2)), darkMat);
    rec.position.set(x, y, z);
    rec.rotation.y = ang;
    scene.add(rec);
    if (!lit) return;
    const pane = new THREE.Mesh(keepMat(new THREE.BoxGeometry(w, h, 0.22)), glowMat);
    pane.position.set(x, y, z);
    pane.rotation.y = ang;
    scene.add(pane);
    light(x + Math.sin(ang) * 0.45, y, z + Math.cos(ang) * 0.45, big ? 3.5 : 1.6, 3.2, 'window', big ? 26 : 18);
  };
  /** Face centre of hex face `f` of a body at (x, z) with circumradius `rad`, pushed out by `out`. */
  const faceAt = (x: number, z: number, rad: number, f: number, out = 0.1) => {
    const ang = ((f * 60 + 30) * Math.PI) / 180;
    const d = rad * Math.cos(Math.PI / 6) + out;
    return { x: x + Math.sin(ang) * d, z: z + Math.cos(ang) * d, ang };
  };
  const roof = (x: number, z: number, rad: number, y: number) => {
    const c = new THREE.Mesh(keepMat(new THREE.ConeGeometry(rad * 1.2, rad * 2.7, 6)), roofMat);
    c.position.set(x, y + rad * 1.35, z);
    c.castShadow = true;
    scene.add(c);
    const lip = new THREE.Mesh(keepMat(new THREE.CylinderGeometry(rad * 1.12, rad * 1.02, 0.3, 6)), flat(WALL_LOOK.cap));
    lip.position.set(x, y - 0.05, z);
    lip.castShadow = true;
    scene.add(lip);
  };

  // ---------------------------------------------------------- the keep, its turret, the banner
  const K = hx(0, -1);
  const keepH = 8.6, keepR = 1.7;
  hexBody(K.x, K.y, keepR, TOP, keepH);
  const cap = new THREE.Mesh(keepMat(new THREE.CylinderGeometry(keepR * 1.08, keepR * 0.98, 0.32, 6)), flat(WALL_LOOK.cap));
  cap.position.set(K.x, TOP + keepH + 0.1, K.y);
  scene.add(cap);
  merlonRing(K.x, K.y, keepR * 1.04, TOP + keepH + 0.26, (i) => i === 1 || i === 2); // two merlons fallen
  const front = (f: number) => faceAt(K.x, K.y, keepR, f, 0.08);
  for (const [f, y, lit, big] of [[0, 6.3, true, true], [0, 4.2, false, false], [5, 5.2, false, false], [1, 3.3, false, false], [0, 2.0, false, false]] as const) {
    const p = front(f);
    // The keep's high window is dark, and something looks out of it.
    const eye = big;
    windowAt(p.x, TOP + y, p.z, p.ang, lit && !eye, big);
    if (eye) glows.push({ at: new THREE.Vector3(p.x + 0.06, TOP + y + 0.12, p.z + 0.12), r: 12, kind: 'eye' });
  }
  const T = { x: K.x + 1.25, z: K.y + 0.55 };
  hexBody(T.x, T.z, 0.6, TOP, 8.2);
  roof(T.x, T.z, 0.6, TOP + 8.35);
  {
    const p = faceAt(T.x, T.z, 0.6, 0, 0.08);
    windowAt(p.x, TOP + 6.9, p.z, p.ang, true);
  }
  // the torn banner of the Hobarts on the keep's face
  {
    const sh = new THREE.Shape();
    sh.moveTo(-0.45, 0);
    sh.lineTo(0.45, 0);
    const teeth = [[0.45, -1.7], [0.3, -1.95], [0.18, -1.6], [0.02, -2.25], [-0.12, -1.8], [-0.28, -2.05], [-0.45, -1.5]];
    for (const [x, y] of teeth) sh.lineTo(x!, y!);
    sh.lineTo(-0.45, 0);
    const p = front(0);
    const banner = new THREE.Mesh(keepMat(new THREE.ShapeGeometry(sh)), flat(0x7a2620, { side: THREE.DoubleSide }));
    banner.position.set(p.x - 0.62 * Math.cos(p.ang) + Math.sin(p.ang) * 0.12, TOP + 8.2, p.z + 0.62 * Math.sin(p.ang) + Math.cos(p.ang) * 0.12);
    banner.rotation.y = p.ang;
    banner.rotation.z = 0.04;
    scene.add(banner);
    const crest = new THREE.Mesh(keepMat(new THREE.CircleGeometry(0.2, 6)), flat(0xc9963a, { emissive: 0x2a1600 }));
    crest.position.copy(banner.position).add(new THREE.Vector3(Math.sin(p.ang) * 0.02, -0.55, Math.cos(p.ang) * 0.02));
    crest.rotation.y = p.ang;
    scene.add(crest);
  }

  // ---------------------------------------------------------- ring towers and curtain walls
  type Tower = { q: number; r: number; rad: number; h: number; roof: boolean; broken?: boolean; win?: [number, boolean][] };
  const ring: Tower[] = [
    { q: -3, r: 3, rad: 0.85, h: 5.2, roof: true, win: [[3.7, true]] }, // the gate, left
    { q: -1, r: 3, rad: 0.85, h: 5.2, roof: true, win: [[3.7, false]] }, // the gate, right
    { q: 2, r: 1, rad: 0.95, h: 4.1, roof: false, broken: true }, // fallen in
    { q: 3, r: -2, rad: 0.8, h: 5.0, roof: false, win: [[3.4, true]] },
    { q: 0, r: -4, rad: 0.9, h: 5.8, roof: true },
    { q: -3, r: -1, rad: 0.8, h: 4.6, roof: false, win: [[2.9, false]] },
  ];
  const pts: THREE.Vector2[] = [];
  for (const t of ring) {
    const p = hx(t.q, t.r);
    pts.push(p);
    if (t.broken) {
      const ragged = new Map<string, number>();
      hexBody(p.x, p.y, t.rad, TOP, t.h, (f, u, v) => {
        const k = `${f}:${Math.floor(u * 3)}`;
        if (!ragged.has(k)) ragged.set(k, 0.62 + R() * 0.38);
        return v < ragged.get(k)! - (f === 5 || f === 0 ? 0.25 : 0);
      });
      for (let i = 0; i < 22; i++) {
        const a = R() * Math.PI * 2, d = t.rad + 0.4 + R() * 1.6;
        rubble(p.x + Math.sin(a) * d, p.y + Math.cos(a) * d);
      }
    } else {
      hexBody(p.x, p.y, t.rad, TOP, t.h);
      if (t.roof) roof(p.x, p.y, t.rad, TOP + t.h + 0.15);
      else {
        const lip = new THREE.Mesh(keepMat(new THREE.CylinderGeometry(t.rad * 1.12, t.rad * 1.02, 0.3, 6)), flat(WALL_LOOK.cap));
        lip.position.set(p.x, TOP + t.h + 0.1, p.y);
        scene.add(lip);
        merlonRing(p.x, p.y, t.rad * 1.06, TOP + t.h + 0.24);
      }
    }
    for (const [y, lit] of t.win ?? []) {
      const f = faceAt(p.x, p.y, t.rad, 0, 0.08);
      windowAt(f.x, TOP + y, f.z, f.ang, lit);
    }
  }
  const wallH = 3.2;
  const wall = (a: THREE.Vector2, b: THREE.Vector2, breach = false) => {
    const len = a.distanceTo(b);
    const ang = Math.atan2(b.x - a.x, b.y - a.y); // along the wall
    const nAng = ang + Math.PI / 2;
    const top = (u: number) => (breach ? Math.min(1, 0.32 + 2.2 * Math.abs(u - 0.5) + (R() - 0.5) * 0.08) : 1);
    const slices = breach ? 7 : 1;
    for (let i = 0; i < slices; i++) {
      const u0 = i / slices, u1 = (i + 1) / slices;
      const h = wallH * top((u0 + u1) / 2) - (breach ? 0.25 : 0);
      if (h <= 0.2) continue;
      const m = new THREE.Mesh(keepMat(new THREE.BoxGeometry(0.52, h, len * (u1 - u0))), flat(WALL_LOOK.mortar));
      const t = (u0 + u1) / 2;
      m.position.set(a.x + (b.x - a.x) * t, TOP + h / 2, a.y + (b.y - a.y) * t);
      m.rotation.y = ang;
      m.castShadow = m.receiveShadow = true;
      scene.add(m);
    }
    const mid = a.clone().add(b).multiplyScalar(0.5);
    for (const side of [1, -1]) {
      const na = side > 0 ? nAng : nAng + Math.PI;
      clad(mid.x + Math.sin(na) * 0.26, mid.y + Math.cos(na) * 0.26, na, len, TOP, wallH, breach ? (u, v) => v < top(side > 0 ? u : 1 - u) : undefined);
    }
    if (!breach) {
      const n = Math.floor(len / 0.6);
      for (let i = 1; i < n; i += 2) {
        const t = i / n;
        pushBrick(a.x + (b.x - a.x) * t, TOP + wallH + 0.22, a.y + (b.y - a.y) * t, nAng, 0.36, 0.44, 0.56);
      }
    } else {
      for (let i = 0; i < 26; i++) {
        const t = 0.25 + R() * 0.5, s = (R() - 0.3) * 2.2;
        rubble(a.x + (b.x - a.x) * t + Math.sin(nAng) * s, a.y + (b.y - a.y) * t + Math.cos(nAng) * s);
      }
    }
  };
  for (let i = 1; i < pts.length; i++) wall(pts[i]!, pts[(i + 1) % pts.length]!, i === 1);

  // ---------------------------------------------------------- the gate: a deep arch, a glimmer inside
  {
    const g0 = pts[0]!, g1 = pts[1]!;
    const gm = g0.clone().add(g1).multiplyScalar(0.5);
    const span = g0.distanceTo(g1);
    const ang = Math.atan2(g1.x - g0.x, g1.y - g0.y);
    const n = ang + Math.PI / 2;
    const core = new THREE.Mesh(keepMat(new THREE.BoxGeometry(0.9, 1.7, span)), flat(WALL_LOOK.mortar));
    core.position.set(gm.x, TOP + 3.05, gm.y);
    core.rotation.y = ang;
    scene.add(core);
    for (const side of [1, -1]) {
      const na = side > 0 ? n : n + Math.PI;
      clad(gm.x + Math.sin(na) * 0.45, gm.y + Math.cos(na) * 0.45, na, span, TOP + 2.2, 1.7);
    }
    for (let i = 1; i < 7; i += 2) {
      const t = i / 7 - 0.5;
      pushBrick(gm.x + Math.sin(ang) * t * span, TOP + 4.12, gm.y + Math.cos(ang) * t * span, n, 0.36, 0.44, 0.9);
    }
    const inner = new THREE.Mesh(keepMat(new THREE.BoxGeometry(1.2, 2.2, 0.2)), darkMat);
    inner.position.set(gm.x, TOP + 1.1, gm.y - 0.2);
    inner.rotation.y = ang + Math.PI / 2;
    scene.add(inner);
    const glimmer = new THREE.Mesh(keepMat(new THREE.BoxGeometry(0.5, 1.3, 0.1)), glowMat);
    glimmer.position.set(gm.x, TOP + 0.7, gm.y - 0.45);
    glimmer.rotation.y = ang + Math.PI / 2;
    scene.add(glimmer);
    light(gm.x, TOP + 1.0, gm.y + 0.6, 2.4, 3.5, 'gate', 34);
  }

  // ---------------------------------------------------------- the path of hex steps, lit by a few lanterns
  {
    const pathMat = flat(0x84765f, { vertexColors: true });
    const stepGeo = keepMat(bevelGeometry(0.78, 0.84, 0.16, 0.6));
    let q = -2, r = 4, n = 0;
    const seen = new Set<string>();
    while (n < 14) {
      const k = `${q},${r}`;
      const t = tops.get(k);
      if (t === undefined) break;
      if (!seen.has(k)) {
        seen.add(k);
        const p = hx(q, r);
        const s = new THREE.Mesh(stepGeo, pathMat);
        s.position.set(p.x, t + 0.09, p.y);
        s.receiveShadow = true;
        scene.add(s);
        if (n % 3 === 1) {
          const post = new THREE.Mesh(keepMat(new THREE.BoxGeometry(0.07, 0.55, 0.07)), flat(0x2a2018));
          post.position.set(p.x + 0.55, t + 0.27, p.y);
          scene.add(post);
          const flame = new THREE.Mesh(keepMat(new THREE.OctahedronGeometry(0.08)), glowMat);
          flame.position.set(p.x + 0.55, t + 0.6, p.y);
          scene.add(flame);
          light(p.x + 0.55, t + 0.62, p.y, 1.4, 2.6, 'lantern', 14);
        }
      }
      // wind down the front: two steps one way, a step down, two the other way
      if (n % 4 < 2) q += n % 8 < 4 ? -1 : 1;
      else r += 1;
      n++;
    }
  }

  // ---------------------------------------------------------- the bricks, as one instanced mesh
  const inst = new THREE.InstancedMesh(brickGeo, brickMat, bricks.length);
  bricks.forEach((b, i) => {
    inst.setMatrixAt(i, b.m);
    inst.setColorAt(i, b.c);
  });
  inst.castShadow = inst.receiveShadow = true;
  scene.add(inst);

  // ---------------------------------------------------------- light: dusk fill, the moon from the right, Lowgate below
  scene.add(new THREE.AmbientLight(0x4a4a78, 0.42));
  scene.add(new THREE.HemisphereLight(0x7a88c8, 0x2a1810, 0.55));
  const moon = new THREE.DirectionalLight(0xa8b8ff, 1.8);
  moon.position.set(40, 34, 22);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  Object.assign(moon.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 130 });
  moon.shadow.bias = -0.0006;
  scene.add(moon);
  const ember = new THREE.DirectionalLight(0xff9a50, 0.38);
  ember.position.set(-14, -2, 30);
  scene.add(ember);
  scene.fog = new THREE.Fog(0x2a1c22, 50, 80);

  return {
    scene,
    glows,
    dispose() {
      for (const d of disposables) d.dispose();
      inst.dispose();
    },
  };
}

/**
 * Render the castle at `scale` (1 = 1920x1080), with the diorama's soft focus at the foot of the crag, cropped to
 * what was drawn. Returns the crop as a data URL and where it and its lights sit on the stage.
 */
export function renderTitleCastle(scale = 1, type = 'image/webp', quality = 0.9): TitleBake | null {
  const W = Math.round(STAGE_W * scale), H = Math.round(STAGE_H * scale);
  const canvas = document.createElement('canvas');
  let r: THREE.WebGLRenderer;
  try {
    r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  } catch {
    return null;
  }
  r.setPixelRatio(1);
  r.setSize(W, H, false);
  r.setClearColor(0x000000, 0);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.0;
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFShadowMap;
  const built = buildTitleCastle();
  const cam = new THREE.PerspectiveCamera(CAMERA.fov, W / H, 0.5, 200);
  cam.position.set(...CAMERA.pos);
  cam.lookAt(new THREE.Vector3(...CAMERA.look));
  cam.updateMatrixWorld();
  r.render(built.scene, cam);

  // The diorama's soft focus: the foot of the crag blurs toward the bottom (sharp above ~78% of the stage height).
  const c2 = document.createElement('canvas');
  c2.width = W;
  c2.height = H;
  const g = c2.getContext('2d')!;
  const sharp = document.createElement('canvas');
  sharp.width = W;
  sharp.height = H;
  const gs = sharp.getContext('2d')!;
  gs.drawImage(canvas, 0, 0);
  const soft = document.createElement('canvas');
  soft.width = W;
  soft.height = H;
  const gb = soft.getContext('2d')!;
  gb.filter = `blur(${(2.6 * scale).toFixed(1)}px)`;
  gb.drawImage(canvas, 0, 0);
  gb.filter = 'none';
  const ramp = (ctx: CanvasRenderingContext2D, inv: boolean) => {
    const gr = ctx.createLinearGradient(0, H * 0.72, 0, H * 0.92);
    gr.addColorStop(0, inv ? 'rgba(0,0,0,1)' : 'rgba(0,0,0,0)');
    gr.addColorStop(1, inv ? 'rgba(0,0,0,0)' : 'rgba(0,0,0,1)');
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
  };
  ramp(gs, true);
  ramp(gb, false);
  g.drawImage(sharp, 0, 0);
  g.globalCompositeOperation = 'lighter';
  g.drawImage(soft, 0, 0);
  g.globalCompositeOperation = 'source-over';

  // Crop to what was drawn.
  const data = g.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (data[(y * W + x) * 4 + 3]! > 2) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < x0) return null;
  const pad = Math.round(4 * scale);
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(W - 1, x1 + pad);
  y1 = Math.min(H - 1, y1 + pad);
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext('2d')!.drawImage(c2, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  const url = out.toDataURL(type, quality);

  const glows: TitleGlow[] = built.glows.map((gl) => {
    const v = gl.at.clone().project(cam);
    return { x: Math.round(((v.x + 1) / 2) * STAGE_W), y: Math.round(((1 - v.y) / 2) * STAGE_H), r: gl.r, kind: gl.kind };
  });
  built.dispose();
  r.dispose();
  r.forceContextLoss();
  return { url, x: x0 / scale, y: y0 / scale, w: out.width / scale, h: out.height / scale, glows };
}
