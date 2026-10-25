// Low-poly figures built from primitives, merged into one vertex-coloured
// geometry per model (one draw call each) plus a glow geometry for eyes and
// staff tips. Cached by model key. Adapted from the V2 renderer.
//
// Spec 15.8: figures are built OSRS-chunky. A humanoid in model units is about
// 1.05 to the top of the head and 0.6 wide at the shoulders (big head, broad
// torso, short thick legs); UnitView scales it so a hero stands about as wide
// as its hex and well over a hex tall. Monsters are scaled by menace there.
// The Dragon is built in world units and drawn at scale 1.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { COLORS } from './world';

interface Part {
  geo: THREE.BufferGeometry;
  color: number;
  glow?: boolean;
}

export interface FigureModel {
  body: THREE.BufferGeometry;
  glow?: THREE.BufferGeometry;
  /** Height to the top of the head (or hat), in model units, for labels. */
  height: number;
  /** Whether the model hovers (banshee). */
  floats?: boolean;
  /** Translucent body (banshee). */
  ghost?: boolean;
  /** Footprint radius, for fanning. */
  radius: number;
}

const cache = new Map<string, FigureModel>();

export class Kit {
  parts: Part[] = [];
  add(geo: THREE.BufferGeometry, color: number, pos: [number, number, number], rot: [number, number, number] = [0, 0, 0], scale: [number, number, number] = [1, 1, 1], glow = false): this {
    const g = geo.clone();
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scale));
    g.applyMatrix4(m);
    this.parts.push({ geo: g, color, glow });
    return this;
  }
  box(w: number, h: number, d: number, color: number, pos: [number, number, number], rot?: [number, number, number], glow = false): this {
    return this.add(new THREE.BoxGeometry(w, h, d), color, pos, rot, undefined, glow);
  }
  cyl(rt: number, rb: number, h: number, seg: number, color: number, pos: [number, number, number], rot?: [number, number, number], scale?: [number, number, number]): this {
    return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), color, pos, rot, scale);
  }
  cone(r: number, h: number, seg: number, color: number, pos: [number, number, number], rot?: [number, number, number], scale?: [number, number, number]): this {
    return this.add(new THREE.ConeGeometry(r, h, seg), color, pos, rot, scale);
  }
  ball(r: number, color: number, pos: [number, number, number], scale?: [number, number, number], glow = false): this {
    return this.add(new THREE.IcosahedronGeometry(r, 0), color, pos, undefined, scale, glow);
  }
  /** Scale everything added so far about the origin (the feet). */
  scaleAll(s: number): this {
    const m = new THREE.Matrix4().makeScale(s, s, s);
    for (const p of this.parts) p.geo.applyMatrix4(m);
    return this;
  }
  build(height: number, radius: number, extra: Partial<FigureModel> = {}): FigureModel {
    const bake = (parts: Part[]) => {
      const geos = parts.map((p) => {
        let g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
        g.deleteAttribute('uv');
        if (!g.getAttribute('normal')) g.computeVertexNormals();
        const n = g.getAttribute('position').count;
        const c = new THREE.Color(p.color);
        const arr = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          arr[i * 3] = c.r;
          arr[i * 3 + 1] = c.g;
          arr[i * 3 + 2] = c.b;
        }
        g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
        g = g.clone();
        return g;
      });
      return geos.length ? mergeGeometries(geos, false) : undefined;
    };
    const body = bake(this.parts.filter((p) => !p.glow))!;
    const glow = bake(this.parts.filter((p) => p.glow));
    return { body, glow: glow ?? undefined, height, radius, ...extra };
  }
}

// ------------------------------------------------------------ humanoids
//
// V3.3 scale direction "C RuneScape" (docs/agents/v33-scale-study.md, mockup/scale-options.ts panel C):
// a humanoid is built 1.0 model unit to the top of the bare head with natural blocky proportions
// (head 1/5 of height, limb thickness 0.07, shoulder width 0.34, leg length 0.44). UnitView
// scales a hero by 2.0, so a hero stands 2.0 world units (hex size 1) and monsters are scaled
// relative to that (unit.ts FIGURE_SCALE).

interface HumanOpts {
  skin: number;
  tunic: number;
  legs: number;
  helm?: 'kettle' | 'great' | 'hood' | 'hat' | 'crown' | 'horned' | 'none';
  helmColor?: number;
  weapon?: 'sword' | 'spear' | 'mace' | 'dagger' | 'staff' | 'blade' | 'bow' | 'hammer' | 'none';
  shield?: number;
  /** Forward lean of the torso, radians (orcs 0.35, ghouls 0.6). */
  hunch?: number;
  eyes?: number;
  /** Width multiplier on the torso (orcs are wide). */
  wide?: number;
  beard?: number;
  pauldrons?: number;
  cape?: number;
  staffGlow?: number;
}

/** Proportions as fractions of the figure height (panel C). */
const PR = { head: 1 / 5, limb: 0.07, torso: 0.34, legs: 0.44 };
/** Top of the bare head in model units (helms add to it; see HELM_TOP). */
export const HEAD_TOP = 1.0;
const HELM_TOP: Record<NonNullable<HumanOpts['helm']>, number> = { none: 0, kettle: 0.07, great: 0.09, hood: 0.16, hat: 0.34, crown: 0.13, horned: 0.24 };

/** Key points of a built humanoid, in model units, so extras can be hung on it. */
export interface Frame {
  /** Top of the head or helm. */
  top: number;
  /** Head centre and radius (after the hunch). */
  hy: number;
  hz: number;
  headR: number;
  /** Hip (top of the legs) and shoulder heights. */
  hipY: number;
  shoulderY: number;
  shoulderW: number;
  depth: number;
  limbD: number;
  /** Right (+x, weapon) and left (−x, shield) hands. */
  handR: [number, number, number];
  handL: [number, number, number];
  /** The back of the torso (z) at mid height, for packs and sacks. */
  backZ: number;
  backY: number;
  hunch: number;
  /** Torso height (hip to shoulder top) and its half-width/half-depth at a torso-local height. */
  torsoH: number;
  torsoAt: (y: number) => { hw: number; hd: number };
}

function humanoid(k: Kit, o: HumanOpts): Frame {
  const h = 1;
  const wide = o.wide ?? 1;
  const hunch = o.hunch ?? 0;
  const headD = h * PR.head;
  const headR = headD / 2;
  const legL = h * PR.legs;
  const neck = h * 0.02;
  const torsoH = h - headD - legL - neck;
  const shoulderW = h * PR.torso * wide;
  const limbD = h * PR.limb;
  const legR = limbD * 0.55;
  const armR = limbD * 0.45;
  const depth = shoulderW * 0.5;
  const cs = Math.cos(hunch);
  const sn = Math.sin(hunch);
  // Torso-local (x, y up from the hip, z forward) to model space, leaning forward by `hunch` about the hip.
  const T = (x: number, y: number, z: number): [number, number, number] => [x, legL + y * cs - z * sn, y * sn + z * cs];
  const R = (rx = 0, ry = 0, rz = 0): [number, number, number] => [hunch + rx, ry, rz];
  // Legs and feet.
  const hip = shoulderW * 0.42;
  for (const sx of [-1, 1]) {
    k.cyl(legR, legR * 0.9, legL, 6, o.legs, [sx * hip * 0.5, legL / 2, 0]);
    k.box(legR * 2.2, legR * 0.9, legR * 3.2, 0x2a1d12, [sx * hip * 0.5, legR * 0.45, legR * 0.5]);
  }
  // Torso (V3.4: tapered to the waist, chamfered at the shoulders, shallower at the belly) and belt.
  k.add(shapedPrism(shoulderW, torsoH, depth, TORSO_RINGS), o.tunic, T(0, 0, 0), R());
  {
    const bw = torsoHalf(torsoH * 0.12, torsoH, shoulderW, depth);
    const ring: [number, number, number][] = [
      [0, 1, 1],
      [1, 1, 1],
    ];
    k.add(shapedPrism(bw.hw * 2.08, torsoH * 0.1, bw.hd * 2.1, ring), 0x2a1d12, T(0, torsoH * 0.07, 0), R());
  }
  // Shoulders: small caps (pauldrons when asked), arms hanging a little forward, hands.
  const armL = torsoH * 0.85;
  const shoulderY = torsoH - armR * 0.6;
  const hands: Record<'L' | 'R', [number, number, number]> = { L: [0, 0, 0], R: [0, 0, 0] };
  for (const sx of [-1, 1]) {
    const px = sx * (shoulderW / 2 + armR * 0.2);
    if (o.pauldrons !== undefined) k.ball(armR * 2.1, o.pauldrons, T(px, shoulderY, 0), [1.1, 0.8, 1]);
    else k.ball(armR * 1.4, o.tunic, T(px, shoulderY, 0));
    // The weapon arm (+x) swings forward; the other hangs.
    const lean = sx > 0 && o.weapon && o.weapon !== 'none' && o.weapon !== 'bow' ? 0.75 : 0.15;
    const ax = sx * (shoulderW / 2 + armR);
    const sy = torsoH - armR;
    const cy = sy - (armL / 2) * Math.cos(lean);
    const cz = armR * 0.3 + (armL / 2) * Math.sin(lean);
    k.cyl(armR, armR * 0.85, armL, 6, o.tunic, T(ax, cy, cz), R(-lean));
    const hand: [number, number, number] = T(ax, sy - armL * Math.cos(lean), armR * 0.3 + armL * Math.sin(lean));
    k.ball(armR * 1.05, o.skin, hand);
    hands[sx > 0 ? 'R' : 'L'] = hand;
  }
  // Head, eyes, beard.
  const hyL = torsoH + neck + headR;
  const [, hy, hz] = T(0, hyL, 0);
  k.ball(headR, o.skin, [0, hy, hz]);
  const glowEyes = o.eyes !== undefined;
  const eyeColor = o.eyes ?? 0x1a1410;
  for (const sx of [-1, 1]) k.box(headR * 0.24, headR * 0.16, headR * 0.1, eyeColor, [sx * headR * 0.32, hy + headR * 0.1, hz + headR * 0.92], undefined, glowEyes);
  if (o.beard) k.cone(headR * 0.8, headR * 1.6, 5, o.beard, [0, hy - headR * 1.1, hz + headR * 0.45], [Math.PI, 0, 0]);
  const hc = o.helmColor ?? COLORS.steel;
  switch (o.helm) {
    case 'kettle':
      k.cyl(headR * 0.85, headR * 1.0, headR * 0.65, 6, hc, [0, hy + headR * 0.65, hz]);
      k.cyl(headR * 1.5, headR * 1.5, 0.012, 8, hc, [0, hy + headR * 0.4, hz]);
      break;
    case 'great':
      k.cyl(headR * 1.06, headR * 1.06, headR * 2.0, 6, hc, [0, hy + headR * 0.1, hz]);
      k.box(headR * 1.5, 0.012, 0.02, 0x111111, [0, hy + headR * 0.25, hz + headR * 1.0]);
      break;
    case 'hood':
      k.cone(headR * 1.3, headR * 2.5, 6, hc, [0, hy + headR * 0.35, hz - headR * 0.1]);
      break;
    case 'hat':
      k.cyl(headR * 1.9, headR * 1.9, 0.012, 8, hc, [0, hy + headR * 0.7, hz]);
      k.cone(headR * 0.95, headR * 2.9, 6, hc, [0, hy + headR * 2.1, hz - headR * 0.2], [-0.18, 0, 0]);
      break;
    case 'crown':
      k.cyl(headR * 0.75, headR * 0.7, headR * 0.3, 8, hc, [0, hy + headR * 0.85, hz]);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        k.cone(headR * 0.12, headR * 0.35, 4, hc, [Math.sin(a) * headR * 0.68, hy + headR * 1.12, hz + Math.cos(a) * headR * 0.68]);
      }
      break;
    case 'horned':
      k.cyl(headR * 0.9, headR * 1.0, headR * 0.65, 6, hc, [0, hy + headR * 0.65, hz]);
      k.cone(headR * 0.25, headR * 1.7, 4, 0xd8cdb0, [-headR * 1.0, hy + headR * 1.4, hz], [0, 0, 0.7]);
      k.cone(headR * 0.25, headR * 1.7, 4, 0xd8cdb0, [headR * 1.0, hy + headR * 1.4, hz], [0, 0, -0.7]);
      break;
  }
  if (o.cape !== undefined) {
    const capeH = torsoH + legL * 0.5;
    k.box(shoulderW * 0.95, capeH, depth * 0.1, o.cape, T(0, torsoH - capeH / 2 - armR * 0.5, -depth / 2 - depth * 0.08), R(0.08));
  }
  // Weapon in the right hand (+x), shield on the left (−x).
  const hr = hands.R;
  const [hx, hyR, hzR] = hr;
  switch (o.weapon) {
    case 'sword': {
      const len = h * 0.42;
      k.box(limbD * 0.55, len, limbD * 0.14, COLORS.steel, [hx, hyR + (len / 2) * 0.94, hzR + (len / 2) * 0.34], [-0.35, 0, 0]);
      k.box(limbD * 1.6, limbD * 0.25, limbD * 0.3, 0x3a2a1a, [hx, hyR + limbD * 0.4, hzR], [-0.35, 0, 0]);
      k.ball(limbD * 0.3, COLORS.gold, [hx, hyR - limbD * 0.7, hzR - limbD * 0.2]);
      break;
    }
    case 'spear':
      k.cyl(limbD * 0.2, limbD * 0.2, h * 1.2, 4, COLORS.woodDark, [hx, hyR + h * 0.25, hzR]);
      k.cone(limbD * 0.5, limbD * 1.6, 4, COLORS.steel, [hx, hyR + h * 0.9, hzR]);
      break;
    case 'mace':
      k.cyl(limbD * 0.25, limbD * 0.25, h * 0.36, 4, COLORS.woodDark, [hx, hyR + h * 0.15, hzR + h * 0.06], [-0.4, 0, 0]);
      k.ball(limbD * 1.1, 0x9a8e7a, [hx, hyR + h * 0.3, hzR + h * 0.13]);
      break;
    case 'dagger':
      k.box(limbD * 0.4, h * 0.2, limbD * 0.14, COLORS.steel, [hx, hyR + h * 0.06, hzR + h * 0.07], [-0.9, 0, 0]);
      break;
    case 'staff':
      k.cyl(limbD * 0.22, limbD * 0.22, h * 1.1, 5, COLORS.woodDark, [hx, hyR + h * 0.3, hzR]);
      k.ball(limbD * 0.8, o.staffGlow ?? 0xb48cff, [hx, hyR + h * 0.88, hzR], undefined, true);
      break;
    case 'blade': {
      const len = h * 0.36;
      k.box(limbD * 1.1, len, limbD * 0.14, 0x6d6a66, [hx + limbD * 0.4, hyR + (len / 2) * 0.8, hzR + (len / 2) * 0.55], [-0.6, 0, 0.3]);
      k.cyl(limbD * 0.25, limbD * 0.25, limbD * 1.0, 5, 0x3a2a1a, [hx, hyR - limbD * 0.3, hzR - limbD * 0.2], [-0.6, 0, 0.3]);
      break;
    }
    case 'bow': {
      // A tall longbow held upright in the left hand, its string pale; a quiver on the back.
      const [bx, by, bz] = hands.L;
      for (let i = 0; i < 5; i++) {
        const t = (i - 2) / 2;
        k.box(limbD * 0.5, h * 0.17, limbd(limbD), 0x7a4a22, [bx, by + h * 0.1 + t * h * 0.3, bz + (1 - t * t) * h * 0.07], [-t * 0.55, 0, 0]);
      }
      k.box(0.006, h * 0.62, 0.006, 0xe8e0c8, [bx, by + h * 0.1, bz]);
      k.cyl(limbD * 0.8, limbD * 0.7, h * 0.3, 5, 0x5a3a1c, T(shoulderW * 0.25, torsoH * 0.55, -depth * 0.75), R(-0.3, 0, 0.25));
      for (const dx of [-0.02, 0, 0.02]) k.box(0.012, h * 0.07, 0.012, 0xd8d0b8, T(shoulderW * 0.25 + 0.05 + dx, torsoH * 0.75, -depth * 0.85), R());
      break;
    }
    case 'hammer':
      k.cyl(limbD * 0.3, limbD * 0.3, h * 0.4, 4, COLORS.woodDark, [hx, hyR + h * 0.15, hzR + h * 0.07], [-0.45, 0, 0]);
      k.box(limbD * 2.6, limbD * 1.4, limbD * 1.4, 0x7a7670, [hx, hyR + h * 0.32, hzR + h * 0.16], [-0.45, 0, 0]);
      break;
  }
  if (o.shield !== undefined) {
    const [lx, ly, lz] = hands.L;
    k.cyl(h * 0.15, h * 0.15, limbD * 0.5, 6, o.shield, [lx - limbD * 0.4, ly + h * 0.06, lz + h * 0.02], [0, 0, Math.PI / 2], [1, 1, 1.15]);
    k.ball(limbD * 0.5, COLORS.steelDark, [lx - limbD * 0.75, ly + h * 0.06, lz + h * 0.02]);
  }
  // The back of the shaped torso at mid height (shallower than the chest), for packs and sacks.
  const back = T(0, torsoH * 0.5, -torsoHalf(torsoH * 0.5, torsoH, shoulderW, depth).hd);
  return {
    top: HEAD_TOP - (1 - cs) * (torsoH + neck + headD) + HELM_TOP[o.helm ?? 'none'],
    hy,
    hz,
    headR,
    hipY: legL,
    shoulderY: legL + shoulderY,
    shoulderW,
    depth,
    limbD,
    handR: hands.R,
    handL: hands.L,
    backZ: back[2],
    backY: back[1],
    hunch,
    torsoH,
    torsoAt: (y: number) => torsoHalf(y, torsoH, shoulderW, depth),
  };
}

function limbd(d: number): number {
  return d * 0.5;
}

/**
 * V3.4 torso profile (owner: "their chests are just so blocky"): rings from the hip (t = 0) to the
 * top of the shoulders (t = 1), as fractions of the shoulder width and the chest depth. The torso
 * narrows to ~78% at the waist, the belly is a little shallower than the chest, and the top ring
 * pulls in so the shoulder edges read as chamfered rather than a crate's corners.
 */
const TORSO_RINGS: readonly (readonly [t: number, w: number, d: number])[] = [
  [0, 0.78, 0.82],
  [0.3, 0.8, 0.84],
  [0.62, 0.96, 1.0],
  [0.84, 1.0, 0.98],
  [0.95, 0.9, 0.84],
  [1, 0.7, 0.6],
];
/** How far each octagon's corners are cut (1 = a rectangle, smaller = rounder). */
const TORSO_CHAMFER = 0.6;

/** Torso half-width and half-depth at torso-local height y (0 at the hip, h at the shoulders). */
function torsoHalf(y: number, h: number, w: number, d: number): { hw: number; hd: number } {
  const t = Math.max(0, Math.min(1, y / h));
  for (let i = 1; i < TORSO_RINGS.length; i++) {
    const [t0, w0, d0] = TORSO_RINGS[i - 1]!;
    const [t1, w1, d1] = TORSO_RINGS[i]!;
    if (t <= t1) {
      const k = (t - t0) / (t1 - t0 || 1);
      return { hw: ((w0 + (w1 - w0) * k) * w) / 2, hd: ((d0 + (d1 - d0) * k) * d) / 2 };
    }
  }
  return { hw: w / 2, hd: d / 2 };
}

/**
 * A tapered, chamfered octagonal prism through `rings` (t, width, depth fractions), base at y = 0,
 * capped top and bottom. Low-poly on purpose: with flat shading each band reads as a plane.
 */
function shapedPrism(w: number, h: number, d: number, rings: readonly (readonly [number, number, number])[], chamfer = TORSO_CHAMFER): THREE.BufferGeometry {
  const oct = (hw: number, hd: number): [number, number][] => [
    [hw, hd * chamfer],
    [hw * chamfer, hd],
    [-hw * chamfer, hd],
    [-hw, hd * chamfer],
    [-hw, -hd * chamfer],
    [-hw * chamfer, -hd],
    [hw * chamfer, -hd],
    [hw, -hd * chamfer],
  ];
  const pos: number[] = [];
  const idx: number[] = [];
  for (const [t, wf, df] of rings) for (const [x, z] of oct((wf * w) / 2, (df * d) / 2)) pos.push(x, t * h, z);
  const n = 8;
  for (let r = 0; r < rings.length - 1; r++)
    for (let i = 0; i < n; i++) {
      const a = r * n + i;
      const b = r * n + ((i + 1) % n);
      const c = a + n;
      const e = b + n;
      idx.push(a, c, b, b, c, e);
    }
  // Caps (fans about a centre vertex).
  const capBottom = pos.length / 3;
  pos.push(0, 0, 0);
  for (let i = 0; i < n; i++) idx.push(capBottom, i, (i + 1) % n);
  const top = (rings.length - 1) * n;
  const capTop = pos.length / 3;
  pos.push(0, h, 0);
  for (let i = 0; i < n; i++) idx.push(capTop, top + ((i + 1) % n), top + i);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  return flat;
}

// ------------------------------------------------------------ models

export type ModelKey =
  | 'heir'
  | 'sellsword'
  | 'burglar'
  | 'mage'
  | 'ranger'
  | 'sapper'
  | 'pyromancer'
  | 'shadowmancer'
  | 'hedgewitch'
  | 'rats'
  | 'orc'
  | 'spider'
  | 'cutpurse'
  | 'berserker'
  | 'gloam'
  | 'archer'
  | 'captain'
  | 'ghoul'
  | 'sister'
  | 'sisterRanger'
  | 'sisterShadow'
  | 'sisterBurglar'
  | 'prisoner'
  | 'dragon'
  | 'dragonSleep'
  | RivalModelKey;

/** V3.5 (18.5): a cutthroat crew member, by crew and class ("rival-ferrymen-sapper"). */
export type RivalModelKey = `rival-${'ferrymen' | 'gallows-choir'}-${'sellsword' | 'ranger' | 'burglar' | 'sapper' | 'pyromancer' | 'shadowmancer'}`;

/** Crew colours (18.7): Ferrymen river blue-grey; the Gallows Choir black and bone. */
const CREW_LOOK: Record<'ferrymen' | 'gallows-choir', { tunic: number; legs: number; cape: number; hood: number; trim: number; skin: number; eyes?: number }> = {
  ferrymen: { tunic: 0x4f6272, legs: 0x2e3a44, cape: 0x6f8798, hood: 0x3e505e, trim: 0xa8bccb, skin: 0xc79a76 },
  'gallows-choir': { tunic: 0x1c1a1a, legs: 0x121111, cape: 0x0c0b0b, hood: 0x161414, trim: 0xe0d6be, skin: 0xd9d0bb, eyes: 0x2a0a0a },
};

export function getModel(key: ModelKey): FigureModel {
  const hit = cache.get(key);
  if (hit) return hit;
  const m = buildModel(key);
  cache.set(key, m);
  return m;
}

const SKIN = 0xc79a76;

/** A robe skirt over the legs (mages, sisters): a cone from the hip to the ground. */
function robe(k: Kit, color: number, f: Frame, r = 0.2): void {
  k.cone(r, f.hipY + 0.04, 6, color, [0, (f.hipY + 0.04) / 2, 0]);
}

/** Orc tusks on a built frame. */
function tusks(k: Kit, f: Frame): void {
  for (const sx of [-1, 1]) k.cone(f.headR * 0.12, f.headR * 0.4, 4, 0xe8dcc0, [sx * f.headR * 0.35, f.hy - f.headR * 0.35, f.hz + f.headR * 0.85]);
}

function buildModel(key: ModelKey): FigureModel {
  const k = new Kit();
  let f: Frame;
  if (key.startsWith('rival-')) return crewMember(k, key as RivalModelKey);
  switch (key as Exclude<ModelKey, RivalModelKey>) {
    case 'heir':
      f = humanoid(k, { skin: SKIN, tunic: 0x6f7378, legs: 0x3d3f44, helm: 'crown', helmColor: COLORS.gold, weapon: 'sword', shield: COLORS.gold, pauldrons: COLORS.steel, cape: 0x7a1414 });
      banner(k, 0xd9a93a, f);
      return k.build(f.top + 0.05, 0.22);
    case 'sellsword':
      f = humanoid(k, { skin: SKIN, tunic: 0x7d2a22, legs: 0x3a2e24, helm: 'kettle', weapon: 'sword', shield: 0x5a3a1c, pauldrons: COLORS.steelDark, wide: 1.15 });
      banner(k, 0xb03a2e, f);
      return k.build(f.top + 0.05, 0.24);
    case 'burglar':
      f = humanoid(k, { skin: SKIN, tunic: 0x2f3a2a, legs: 0x22261f, helm: 'hood', helmColor: 0x2c3a28, weapon: 'dagger', cape: 0x1f2a1c });
      banner(k, 0x3b9a4a, f);
      return k.build(f.top + 0.05, 0.2);
    case 'mage':
      f = humanoid(k, { skin: SKIN, tunic: 0x3b2659, legs: 0x3b2659, helm: 'hat', helmColor: 0x2d1d45, weapon: 'staff', beard: 0xd6d0c4, staffGlow: 0xffb35c });
      robe(k, 0x3b2659, f);
      banner(k, 0x8a4cc9, f);
      return k.build(f.top + 0.03, 0.2);
    case 'ranger':
      // Green hood and cloak, longbow: reads from far by the tall bow arc.
      f = humanoid(k, { skin: SKIN, tunic: 0x4a5a2a, legs: 0x3a3424, helm: 'hood', helmColor: 0x3f5a26, weapon: 'bow', cape: 0x33461c });
      banner(k, 0x8fbf3a, f);
      return k.build(f.top + 0.05, 0.2);
    case 'sapper': {
      // Stocky, leather apron, hammer, a big pack of charges with a fuse on the back.
      f = humanoid(k, { skin: SKIN, tunic: 0x8a5a2a, legs: 0x3a2e24, helm: 'kettle', helmColor: 0x6a5a3a, weapon: 'hammer', wide: 1.2, beard: 0x7a4a22 });
      const bz = f.backZ - 0.07;
      k.box(0.26, 0.24, 0.13, 0x5a4024, [0, f.backY + 0.02, bz], [f.hunch, 0, 0]);
      k.cyl(0.045, 0.045, 0.14, 6, 0xb03a2e, [-0.07, f.backY + 0.18, bz]);
      k.cyl(0.045, 0.045, 0.14, 6, 0xb03a2e, [0.07, f.backY + 0.18, bz]);
      k.box(0.01, 0.07, 0.01, 0xffc860, [0.07, f.backY + 0.28, bz], undefined, true);
      banner(k, 0xe08a2a, f);
      return k.build(f.top + 0.05, 0.26);
    }
    case 'pyromancer':
      f = humanoid(k, { skin: SKIN, tunic: 0x8a2416, legs: 0x5a160e, helm: 'hat', helmColor: 0x5a160e, weapon: 'staff', staffGlow: 0xff6a1a });
      robe(k, 0x8a2416, f);
      k.ball(0.04, 0xffa040, [f.handL[0], f.handL[1] + 0.02, f.handL[2] + 0.04], undefined, true);
      banner(k, 0xff5a1a, f);
      return k.build(f.top + 0.03, 0.2);
    case 'shadowmancer':
      f = humanoid(k, { skin: 0xa89aa8, tunic: 0x241a3a, legs: 0x1a1428, helm: 'hood', helmColor: 0x1a1428, weapon: 'staff', staffGlow: 0x9a6aff, cape: 0x120c1e, eyes: 0xb08aff });
      robe(k, 0x241a3a, f, 0.21);
      banner(k, 0x7a4cff, f);
      return k.build(f.top + 0.05, 0.2);
    case 'hedgewitch':
      f = humanoid(k, { skin: SKIN, tunic: 0x2e5a3e, legs: 0x22402c, helm: 'hat', helmColor: 0x5a4a2a, weapon: 'staff', staffGlow: 0x8affb0 });
      robe(k, 0x2e5a3e, f);
      // Herb pouch at the hip and a sprig on the hat.
      k.ball(0.055, 0x8a7350, [f.shoulderW * 0.45, f.hipY + 0.02, f.depth * 0.5]);
      k.cone(0.025, 0.11, 4, 0x7fd06a, [f.headR * 0.7, f.top - 0.1, f.hz + 0.02], [0.3, 0, -0.4]);
      banner(k, 0x5ad08a, f);
      return k.build(f.top + 0.03, 0.2);
    case 'archer':
      // 16.4: an orc with a longbow, leaner than the cleaver orc, no shield.
      f = humanoid(k, { skin: COLORS.orc, tunic: 0x2e2a1e, legs: 0x1e1a12, helm: 'none', weapon: 'bow', hunch: 0.3, eyes: COLORS.danger, wide: 1.1 });
      tusks(k, f);
      return k.build(f.top, 0.24);
    case 'captain': {
      // 16.4: broad orc in a kettle helm with a red plume, big shield, pauldrons.
      f = humanoid(k, { skin: COLORS.orc, tunic: 0x4a3a2a, legs: 0x241c14, helm: 'kettle', helmColor: COLORS.steelDark, weapon: 'blade', shield: 0x6a1a12, hunch: 0.35, eyes: COLORS.danger, wide: 1.4, pauldrons: COLORS.steelDark });
      tusks(k, f);
      // Plume: a tall red crest swept back over the helm.
      const ph = f.hy + f.headR * 0.95;
      for (let i = 0; i < 4; i++) k.box(0.035, 0.08 + i * 0.02, 0.06, 0xb02a1e, [0, ph + 0.05 + i * 0.045, f.hz + 0.04 - i * 0.045], [-0.25 - i * 0.1, 0, 0]);
      return k.build(f.top + 0.2, 0.28);
    }
    case 'ghoul': {
      // 16.4: gaunt, grey-green and bony, hunched, long clawed arms, pale eyes.
      const bone = 0x8f9a86;
      f = humanoid(k, { skin: bone, tunic: 0x5c6a58, legs: 0x3e4a3c, helm: 'none', weapon: 'none', hunch: 0.6, eyes: 0xe8ffb0, wide: 0.8 });
      // Ribs showing through the front of the torso.
      const cs = Math.cos(f.hunch);
      const sn = Math.sin(f.hunch);
      for (let i = 0; i < 3; i++) {
        const y = 0.2 - i * 0.045;
        const at = f.torsoAt(y);
        const z = at.hd + 0.004;
        k.box(at.hw * 1.5, 0.012, 0.012, 0xc8d0bc, [0, f.hipY + y * cs - z * sn, y * sn + z * cs], [f.hunch, 0, 0]);
      }
      // Claws: three thin spikes hanging off each hand.
      for (const hand of [f.handL, f.handR]) for (let c = -1; c <= 1; c++) k.cone(0.008, 0.09, 3, 0xe8e4d0, [hand[0] + c * 0.02, hand[1] - 0.05, hand[2] + c * 0.012], [Math.PI * 0.95, 0, 0]);
      return k.build(f.top, 0.2);
    }
    case 'sister':
    case 'sisterRanger':
    case 'sisterShadow':
    case 'sisterBurglar': {
      // Lantern Sisters: pale hooded robes, a lantern held out front. 16.5: kit by class.
      const cls = key === 'sisterRanger' ? 'ranger' : key === 'sisterShadow' ? 'shadow' : key === 'sisterBurglar' ? 'burglar' : 'plain';
      const hood = cls === 'ranger' ? 0x5a6a3a : cls === 'shadow' ? 0x2a1e3e : cls === 'burglar' ? 0x2c2a26 : 0xb8ad98;
      f = humanoid(k, {
        skin: cls === 'shadow' ? 0xb0a4b4 : SKIN,
        tunic: 0x8a8070,
        legs: 0x5a5246,
        helm: 'hood',
        helmColor: hood,
        weapon: cls === 'ranger' ? 'bow' : cls === 'burglar' ? 'dagger' : 'none',
        eyes: cls === 'shadow' ? 0xb08aff : undefined,
        cape: cls === 'shadow' ? 0x1a1230 : undefined,
      });
      robe(k, 0x8a8070, f, 0.19);
      if (cls !== 'ranger') {
        // Lantern in the right hand (or the left for the burglar, who holds a dagger).
        const hd = cls === 'burglar' ? f.handL : f.handR;
        k.cyl(0.006, 0.006, 0.12, 3, 0x222222, [hd[0], hd[1] - 0.06, hd[2] + 0.02]);
        k.box(0.08, 0.1, 0.08, 0x3a3020, [hd[0], hd[1] - 0.16, hd[2] + 0.02]);
        k.box(0.05, 0.065, 0.05, 0xffd27a, [hd[0], hd[1] - 0.16, hd[2] + 0.02], undefined, true);
      } else {
        // The ranger sister hangs her lantern from the belt.
        k.box(0.07, 0.09, 0.07, 0x3a3020, [f.shoulderW * 0.5, f.hipY + 0.01, f.depth * 0.45]);
        k.box(0.045, 0.06, 0.045, 0xffd27a, [f.shoulderW * 0.5, f.hipY + 0.01, f.depth * 0.45], undefined, true);
      }
      if (cls === 'burglar') k.ball(0.08, 0x4a4030, [-f.shoulderW * 0.3, f.backY + 0.02, f.backZ - 0.05]);
      return k.build(f.top, 0.2);
    }
    case 'prisoner':
      f = humanoid(k, { skin: SKIN, tunic: 0x9a8a6a, legs: 0x5a4a3a, helm: 'none', weapon: 'none', hunch: 0.3, beard: 0x6a5a4a });
      // Shackles on the wrists.
      for (const hand of [f.handL, f.handR]) k.cyl(f.limbD * 0.7, f.limbD * 0.7, f.limbD * 0.6, 6, COLORS.iron, [hand[0], hand[1] + 0.03, hand[2]]);
      return k.build(f.top, 0.18);
    case 'rats': {
      // A pack of four fat rats filling the hex.
      const s = 0x4a3e36;
      for (const [x, z, r] of [
        [0.02, 0.2, 0.1],
        [-0.3, -0.12, 0.7],
        [0.3, -0.16, -0.5],
        [-0.04, -0.34, 2.6],
      ] as const) {
        k.ball(0.14, s, [x, 0.12, z], [0.85, 0.75, 1.45]);
        k.cone(0.08, 0.16, 4, s, [x + Math.sin(r) * 0.22, 0.12, z + Math.cos(r) * 0.22], [Math.PI / 2, r, 0]);
        k.box(0.03, 0.03, 0.34, 0xb07a6a, [x - Math.sin(r) * 0.32, 0.05, z - Math.cos(r) * 0.32], [0, r, 0]);
        k.box(0.03, 0.03, 0.02, COLORS.danger, [x + Math.sin(r) * 0.18 - Math.cos(r) * 0.04, 0.17, z + Math.cos(r) * 0.18 + Math.sin(r) * 0.04], undefined, true);
        k.box(0.03, 0.03, 0.02, COLORS.danger, [x + Math.sin(r) * 0.18 + Math.cos(r) * 0.04, 0.17, z + Math.cos(r) * 0.18 - Math.sin(r) * 0.04], undefined, true);
      }
      return k.build(0.3, 0.5);
    }
    case 'orc':
      // Hero-sized (1.05x), hunched and broad, red eyes, a cleaver.
      f = humanoid(k, { skin: COLORS.orc, tunic: 0x3a2e22, legs: 0x241c14, helm: 'none', weapon: 'blade', shield: 0x3a2a1a, hunch: 0.35, eyes: COLORS.danger, wide: 1.3 });
      tusks(k, f);
      return k.build(f.top, 0.26);
    case 'cutpurse':
      f = humanoid(k, { skin: SKIN, tunic: 0x3a3030, legs: 0x221c1c, helm: 'hood', helmColor: 0x2a2020, weapon: 'dagger', hunch: 0.3, eyes: 0xffd27a });
      // Bulging sack over the shoulder.
      k.ball(0.11, 0x6b5a3a, [-f.shoulderW * 0.35, f.backY + 0.08, f.backZ - 0.07]);
      return k.build(f.top, 0.2);
    case 'berserker':
      // A head taller than an orc (unit.ts scale), horned, two axes.
      f = humanoid(k, { skin: 0xc2614a, tunic: 0x8a1a12, legs: 0x3a1a12, helm: 'horned', helmColor: 0x3b3a3d, weapon: 'none', wide: 1.45, eyes: 0xffe0a0 });
      for (const hand of [f.handL, f.handR]) {
        const sx = Math.sign(hand[0]);
        k.cyl(0.018, 0.018, 0.42, 4, COLORS.woodDark, [hand[0], hand[1] + 0.12, hand[2] + 0.1], [-0.6, 0, 0]);
        k.box(0.16, 0.13, 0.02, COLORS.steel, [hand[0] + sx * 0.05, hand[1] + 0.3, hand[2] + 0.2], [-0.6, 0, 0]);
      }
      return k.build(f.top, 0.3);
    case 'spider': {
      // Wide: the legs reach past the hex edge.
      const s = 0x2a2420;
      k.ball(0.3, s, [0, 0.3, -0.2], [1.15, 0.75, 1.35]);
      k.ball(0.17, s, [0, 0.25, 0.24]);
      k.box(0.16, 0.02, 0.16, 0xa02020, [0, 0.51, -0.24]);
      for (let i = 0; i < 4; i++) k.ball(0.03, COLORS.danger, [-0.09 + i * 0.06, 0.32, 0.4], undefined, true);
      for (const sx of [-1, 1])
        for (let i = 0; i < 4; i++) {
          const z = 0.16 - i * 0.16;
          k.box(0.44, 0.04, 0.04, 0x1a1512, [sx * 0.32, 0.4, z], [0, (i - 1.5) * 0.25 * sx, sx * 0.45]);
          k.box(0.04, 0.42, 0.04, 0x1a1512, [sx * 0.58, 0.2, z], [0, 0, -sx * 0.25]);
        }
      return k.build(0.6, 0.6);
    }
    case 'dragon':
      dragon(k, false);
      return k.build(3.9, 2.6);
    case 'dragonSleep':
      dragon(k, true);
      return k.build(2.6, 2.1);
    case 'gloam': {
      // A shape of darkness with two pale eyes.
      const s = 0x050508;
      k.cone(0.4, 1.3, 7, s, [0, 0.65, 0], [Math.PI, 0, 0]);
      k.ball(0.32, s, [0, 1.25, 0], [1, 1.2, 1]);
      k.box(0.32, 0.7, 0.08, s, [-0.36, 0.9, 0.06], [0.2, 0, 0.6]);
      k.box(0.32, 0.7, 0.08, s, [0.36, 0.9, 0.06], [0.2, 0, -0.6]);
      k.box(0.09, 0.045, 0.02, 0xdfe8ff, [-0.1, 1.3, 0.3], undefined, true);
      k.box(0.09, 0.045, 0.02, 0xdfe8ff, [0.1, 1.3, 0.3], undefined, true);
      return k.build(1.65, 0.45, { floats: true, ghost: true });
    }
  }
}

/**
 * V3.5 (18.5, 18.7): a cutthroat by class in the crew's colours. Sellsword: shield and sword,
 * kettle helm. Sapper: hammer and a pack of charges with a lit fuse. Pyromancer: robe, staff
 * with a flame. Ranger: hood and bow. Burglar: hood, dagger, sack. The Gallows Choir wear
 * bone-white faces and a noose round the neck; the Ferrymen a boat-cloak and a pole-hook badge.
 */
function crewMember(k: Kit, key: RivalModelKey): FigureModel {
  const crew = key.startsWith('rival-ferrymen') ? 'ferrymen' : 'gallows-choir';
  const cls = key.slice(`rival-${crew}-`.length);
  const L = CREW_LOOK[crew];
  const base = { skin: L.skin, tunic: L.tunic, legs: L.legs, eyes: L.eyes };
  let f: Frame;
  switch (cls) {
    case 'sellsword':
      f = humanoid(k, { ...base, helm: 'kettle', helmColor: crew === 'ferrymen' ? 0x5a6a78 : 0x2a2626, weapon: 'sword', shield: crew === 'ferrymen' ? 0x6f8798 : 0xd8cfb8, pauldrons: COLORS.steelDark, wide: 1.15, cape: L.cape });
      break;
    case 'sapper': {
      f = humanoid(k, { ...base, helm: 'kettle', helmColor: L.hood, weapon: 'hammer', wide: 1.2, beard: crew === 'ferrymen' ? 0x5a4a3a : undefined });
      const bz = f.backZ - 0.07;
      k.box(0.26, 0.24, 0.13, L.cape, [0, f.backY + 0.02, bz], [f.hunch, 0, 0]);
      for (const x of [-0.07, 0.07]) k.cyl(0.045, 0.045, 0.14, 6, 0xb03a2e, [x, f.backY + 0.18, bz]);
      k.box(0.01, 0.07, 0.01, 0xffc860, [0.07, f.backY + 0.28, bz], undefined, true);
      break;
    }
    case 'pyromancer':
    case 'shadowmancer':
      f = humanoid(k, { ...base, helm: cls === 'pyromancer' ? 'hat' : 'hood', helmColor: L.hood, weapon: 'staff', staffGlow: cls === 'pyromancer' ? 0xff6a1a : 0x9a6aff, cape: L.cape });
      robe(k, L.tunic, f);
      if (cls === 'pyromancer') {
        // A flame cupped in the off hand.
        k.ball(0.045, 0xffa040, [f.handL[0], f.handL[1] + 0.03, f.handL[2] + 0.04], undefined, true);
        k.add(new THREE.ConeGeometry(0.03, 0.09, 4), 0xffd27a, [f.handL[0], f.handL[1] + 0.1, f.handL[2] + 0.04], undefined, undefined, true);
      }
      break;
    case 'ranger':
      f = humanoid(k, { ...base, helm: 'hood', helmColor: L.hood, weapon: 'bow', cape: L.cape });
      break;
    default:
      f = humanoid(k, { ...base, helm: 'hood', helmColor: L.hood, weapon: 'dagger', hunch: 0.2, cape: L.cape });
      k.ball(0.08, 0x4a4030, [-f.shoulderW * 0.3, f.backY + 0.02, f.backZ - 0.05]);
  }
  if (crew === 'gallows-choir') {
    // A noose of bone-pale rope round the neck, its tail down the chest.
    k.add(new THREE.TorusGeometry(f.headR * 0.62, 0.016, 4, 10), L.trim, [0, f.shoulderY + 0.01, f.depth * 0.1], [Math.PI / 2, 0, 0]);
    k.box(0.02, 0.12, 0.02, L.trim, [0, f.shoulderY - 0.07, f.depth * 0.5]);
  } else {
    // A river-grey sash across the chest with a brass hook badge.
    k.box(f.shoulderW * 0.9, 0.035, 0.02, L.trim, [0, f.shoulderY - 0.1, f.depth * 0.52], [0, 0, 0.5]);
    k.ball(0.022, COLORS.gold, [f.shoulderW * 0.18, f.shoulderY - 0.04, f.depth * 0.56], undefined, true);
  }
  return k.build(f.top + 0.03, cls === 'sapper' || cls === 'sellsword' ? 0.24 : 0.2);
}

/**
 * The Dragon, in world units (UnitView draws it at scale 1). Spec 15.8: about
 * three hexes long and two tall, red-brown scales, pale belly, horns, bat wings
 * spread over the hoard. Awake: reared up, neck raised, wings half open, jaws
 * glowing, the head higher than any wall. Asleep: coiled round, filling the
 * Lair's centre, head on its tail, wings folded.
 */
function dragon(k: Kit, asleep: boolean): void {
  const scale = 0x8a2e1e;
  const dark = 0x5a1c12;
  const belly = 0xd8a868;
  const horn = 0xe8dcc0;
  const wing = 0x6a2216;
  const eye = 0xffd040;
  if (asleep) {
    // Coiled body: a ring of segments.
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 1.75 + 0.3;
      const r = 0.62;
      const s = 0.5 - i * 0.03;
      k.ball(s, i % 2 ? scale : dark, [Math.cos(a) * r, s * 0.7, Math.sin(a) * r], [1.25, 0.8, 1.1]);
    }
    k.ball(0.62, scale, [0, 0.5, 0], [1.4, 0.75, 1.2]);
    // Folded wings on the back.
    for (const sx of [-1, 1]) k.add(new THREE.ConeGeometry(0.55, 1.3, 3), wing, [sx * 0.3, 0.95, -0.1], [0.2, 0, sx * 1.2], [1, 1, 0.25]);
    // Spines.
    for (let i = 0; i < 5; i++) k.cone(0.08, 0.28, 4, horn, [-0.4 + i * 0.2, 1.0 - Math.abs(i - 2) * 0.06, -0.05]);
    // Head resting on the coil, eyes shut (dark slits).
    k.add(new THREE.ConeGeometry(0.26, 0.85, 5), scale, [0.85, 0.32, 0.7], [Math.PI / 2, 0, -0.4], [1, 1, 0.75]);
    k.ball(0.28, scale, [0.6, 0.32, 0.45], [1, 0.8, 1.1]);
    k.box(0.1, 0.02, 0.03, 0x1a0a06, [0.68, 0.42, 0.62]);
    for (const sx of [-1, 1]) k.cone(0.06, 0.38, 4, horn, [0.5 + sx * 0.12, 0.55, 0.3], [-1.0, 0, sx * 0.3]);
    // Tail tip.
    k.cone(0.12, 0.6, 4, dark, [1.0, 0.18, -0.35], [0, 0, -1.4]);
    // Smoke wisp from the nostrils (glow).
    k.ball(0.06, 0xffa060, [1.1, 0.4, 1.0], undefined, true);
    // Built at the old size; the coil spans about two hexes across at this scale.
    k.scaleAll(1.75);
    return;
  }
  // Awake: body, legs, tail, raised neck, head, jaws, wings.
  k.ball(0.75, scale, [0, 0.95, -0.15], [1.05, 0.8, 1.45]);
  k.ball(0.55, belly, [0, 0.8, 0.2], [1.0, 0.75, 1.1]);
  for (const sx of [-1, 1]) {
    // Fore and hind legs with claws.
    k.cyl(0.14, 0.18, 0.75, 6, dark, [sx * 0.5, 0.38, 0.45], [0.2, 0, sx * 0.1]);
    k.cyl(0.18, 0.22, 0.8, 6, dark, [sx * 0.55, 0.4, -0.6], [-0.2, 0, sx * 0.1]);
    for (const dz of [0.45, -0.6]) for (let c = -1; c <= 1; c++) k.cone(0.04, 0.16, 3, horn, [sx * 0.5 + c * 0.07, 0.05, dz + 0.15], [Math.PI / 2, 0, 0]);
    // Wings: two big triangles each, spread wide and low over the hoard.
    k.add(new THREE.ConeGeometry(1.2, 2.3, 3), wing, [sx * 1.3, 1.7, -0.35], [0.35, 0, sx * 1.25], [1, 1, 0.12]);
    k.add(new THREE.ConeGeometry(0.8, 1.7, 3), dark, [sx * 2.2, 1.25, -0.6], [0.6, 0, sx * 1.7], [1, 1, 0.12]);
    k.cyl(0.05, 0.07, 1.9, 4, dark, [sx * 1.0, 1.9, -0.3], [0.2, 0, sx * 1.05]);
  }
  // Tail: tapering segments curling back.
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    k.ball(0.32 - i * 0.045, i % 2 ? scale : dark, [Math.sin(t * 2.2) * 0.5, 0.5 - t * 0.35, -1.0 - i * 0.26], [1, 0.8, 1.3]);
  }
  k.cone(0.14, 0.45, 4, horn, [Math.sin(2.2) * 0.5, 0.18, -2.6], [-Math.PI / 2, 0, 0]);
  // Spines along the back.
  for (let i = 0; i < 6; i++) k.cone(0.09, 0.32, 4, horn, [0, 1.55 - i * 0.07, 0.45 - i * 0.3], [-0.3, 0, 0]);
  // Neck rising forward.
  for (let i = 0; i < 4; i++) k.ball(0.3 - i * 0.03, i % 2 ? dark : scale, [0, 1.3 + i * 0.3, 0.55 + i * 0.18], [1, 1, 1.15]);
  // Head: skull, snout, open jaw with a fire glow, horns, eyes.
  const hy = 2.35;
  const hz = 1.35;
  k.ball(0.34, scale, [0, hy, hz], [1, 0.85, 1.2]);
  k.box(0.38, 0.2, 0.6, scale, [0, hy + 0.02, hz + 0.45], [0.12, 0, 0]);
  k.box(0.34, 0.1, 0.55, dark, [0, hy - 0.22, hz + 0.38], [0.4, 0, 0]);
  k.box(0.26, 0.12, 0.4, 0xff7a20, [0, hy - 0.1, hz + 0.4], [0.25, 0, 0], true);
  for (const sx of [-1, 1]) {
    k.cone(0.07, 0.55, 4, horn, [sx * 0.2, hy + 0.32, hz - 0.25], [-1.1, 0, sx * 0.35]);
    k.box(0.08, 0.05, 0.05, eye, [sx * 0.16, hy + 0.12, hz + 0.24], undefined, true);
    for (let t = 0; t < 3; t++) k.cone(0.025, 0.09, 3, horn, [sx * 0.12, hy - 0.1, hz + 0.3 + t * 0.12], [Math.PI, 0, 0]);
  }
  // Built at the old size (~4.8 long, 2.9 tall); scaled so it is ~3.5 hexes long, the head near 4 high
  // and the wings span about eight.
  k.scaleAll(1.3);
}

/** A class banner on a short pole over the left shoulder, the flag just above the head (panel C: top at 1.28). */
function banner(k: Kit, color: number, f: Frame): void {
  const top = Math.max(1.28, f.top + 0.22);
  const x = -(f.shoulderW / 2 - 0.02);
  const z = f.backZ - 0.02;
  const base = f.hipY * 0.6;
  k.cyl(0.01, 0.01, top - base, 4, 0x2a1d12, [x, base + (top - base) / 2, z]);
  const fh = 0.26;
  const fw = 0.2;
  k.box(fw, fh, 0.008, color, [x + fw / 2, top - fh / 2, z]);
  k.cone(0.018, 0.045, 4, COLORS.gold, [x, top + 0.02, z]);
}

/** Make a figure object: body mesh (+ glow mesh). Materials are per figure so it can flash and fade. */
export function makeFigure(model: FigureModel, mats: { body: THREE.MeshLambertMaterial; glow: THREE.MeshBasicMaterial }): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(model.body, mats.body);
  body.name = 'body';
  g.add(body);
  if (model.glow) {
    const glow = new THREE.Mesh(model.glow, mats.glow);
    glow.name = 'glow';
    g.add(glow);
  }
  return g;
}
