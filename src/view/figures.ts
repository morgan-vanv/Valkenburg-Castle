// Low-poly figures built from primitives, merged into one vertex-coloured
// geometry per model (one draw call each) plus a glow geometry for eyes and
// staff tips. Cached by model key. Adapted from the V2 renderer.

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
  /** Height to the top of the head, for labels. */
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

interface HumanOpts {
  skin: number;
  tunic: number;
  legs: number;
  helm?: 'kettle' | 'great' | 'hood' | 'hat' | 'crown' | 'horned' | 'none';
  helmColor?: number;
  weapon?: 'sword' | 'spear' | 'mace' | 'dagger' | 'staff' | 'blade' | 'none';
  shield?: number;
  hunch?: number;
  eyes?: number;
  wide?: number;
  beard?: number;
  pauldrons?: number;
  cape?: number;
  staffGlow?: number;
}

function humanoid(k: Kit, o: HumanOpts): void {
  const w = o.wide ?? 1;
  const hunch = o.hunch ?? 0;
  // Legs.
  k.box(0.07 * w, 0.22, 0.08, o.legs, [-0.045 * w, 0.11, 0]);
  k.box(0.07 * w, 0.22, 0.08, o.legs, [0.045 * w, 0.11, 0]);
  // Torso: tapered hexagonal prism.
  k.cyl(0.085 * w, 0.11 * w, 0.24, 6, o.tunic, [0, 0.34, hunch * 0.05], [hunch * 0.35, 0, 0]);
  // Belt.
  k.cyl(0.112 * w, 0.112 * w, 0.03, 6, 0x2a1d12, [0, 0.235, 0]);
  if (o.pauldrons) {
    k.ball(0.055, o.pauldrons, [-0.1 * w, 0.44, hunch * 0.08], [1.1, 0.8, 1]);
    k.ball(0.055, o.pauldrons, [0.1 * w, 0.44, hunch * 0.08], [1.1, 0.8, 1]);
  }
  if (o.cape) k.box(0.2 * w, 0.32, 0.02, o.cape, [0, 0.31, -0.08], [0.12, 0, 0]);
  // Arms.
  k.box(0.05, 0.2, 0.06, o.tunic, [-0.12 * w, 0.34, 0.02 + hunch * 0.06], [hunch * 0.5, 0, 0.12]);
  k.box(0.05, 0.2, 0.06, o.tunic, [0.12 * w, 0.34, 0.02 + hunch * 0.06], [hunch * 0.5 - 0.4, 0, -0.12]);
  // Head.
  const hy = 0.53 - hunch * 0.06;
  const hz = hunch * 0.12;
  k.ball(0.075, o.skin, [0, hy, hz]);
  if (o.eyes !== undefined) {
    k.box(0.022, 0.016, 0.02, o.eyes, [-0.028, hy + 0.01, hz + 0.065], undefined, true);
    k.box(0.022, 0.016, 0.02, o.eyes, [0.028, hy + 0.01, hz + 0.065], undefined, true);
  }
  if (o.beard) k.cone(0.07, 0.14, 5, o.beard, [0, hy - 0.08, hz + 0.04], [Math.PI, 0, 0]);
  const hc = o.helmColor ?? COLORS.steel;
  switch (o.helm) {
    case 'kettle':
      k.cyl(0.07, 0.08, 0.06, 6, hc, [0, hy + 0.05, hz]);
      k.cyl(0.12, 0.12, 0.012, 8, hc, [0, hy + 0.025, hz]);
      break;
    case 'great':
      k.cyl(0.085, 0.085, 0.15, 6, hc, [0, hy + 0.01, hz]);
      k.box(0.11, 0.012, 0.02, 0x111111, [0, hy + 0.02, hz + 0.08]);
      break;
    case 'hood':
      k.cone(0.095, 0.2, 6, hc, [0, hy + 0.05, hz - 0.01]);
      break;
    case 'hat':
      k.cyl(0.15, 0.15, 0.012, 8, hc, [0, hy + 0.05, hz]);
      k.cone(0.075, 0.28, 6, hc, [0, hy + 0.19, hz - 0.02], [-0.18, 0, 0]);
      break;
    case 'crown':
      k.cyl(0.08, 0.075, 0.07, 6, hc, [0, hy + 0.06, hz]);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        k.cone(0.018, 0.06, 3, hc, [Math.sin(a) * 0.07, hy + 0.12, hz + Math.cos(a) * 0.07]);
      }
      break;
    case 'horned':
      k.cyl(0.075, 0.08, 0.06, 6, hc, [0, hy + 0.05, hz]);
      k.cone(0.022, 0.14, 4, 0xd8cdb0, [-0.08, hy + 0.12, hz], [0, 0, 0.7]);
      k.cone(0.022, 0.14, 4, 0xd8cdb0, [0.08, hy + 0.12, hz], [0, 0, -0.7]);
      break;
  }
  // Weapon in the right hand (+x), shield on the left.
  const hx = 0.15 * w;
  switch (o.weapon) {
    case 'sword':
      k.box(0.025, 0.3, 0.012, COLORS.steel, [hx, 0.38, 0.13], [0.5, 0, 0]);
      k.box(0.08, 0.018, 0.02, 0x3a2a1a, [hx, 0.26, 0.08], [0.5, 0, 0]);
      break;
    case 'spear':
      k.cyl(0.01, 0.01, 0.8, 4, COLORS.woodDark, [hx, 0.4, 0.04]);
      k.cone(0.025, 0.08, 4, COLORS.steel, [hx, 0.84, 0.04]);
      break;
    case 'mace':
      k.cyl(0.014, 0.014, 0.28, 4, COLORS.woodDark, [hx, 0.36, 0.1], [0.5, 0, 0]);
      k.ball(0.055, 0x9a8e7a, [hx, 0.48, 0.17]);
      break;
    case 'dagger':
      k.box(0.02, 0.14, 0.01, COLORS.steel, [hx, 0.3, 0.1], [0.9, 0, 0]);
      break;
    case 'staff':
      k.cyl(0.012, 0.012, 0.85, 5, COLORS.woodDark, [hx, 0.42, 0.05]);
      k.ball(0.04, o.staffGlow ?? 0xb48cff, [hx, 0.88, 0.05], undefined, true);
      break;
    case 'blade':
      k.box(0.05, 0.26, 0.012, 0x6d6a66, [hx, 0.36, 0.13], [0.6, 0, 0.1]);
      break;
  }
  if (o.shield !== undefined) {
    k.cyl(0.1, 0.1, 0.025, 6, o.shield, [-0.15 * w, 0.33, 0.06], [0, 0, Math.PI / 2], [1, 1, 1.15]);
    k.ball(0.025, COLORS.steelDark, [-0.165 * w, 0.33, 0.06]);
  }
}

// ------------------------------------------------------------ models

export type ModelKey =
  | 'hobart'
  | 'sellsword'
  | 'burglar'
  | 'mage'
  | 'rats'
  | 'orc'
  | 'spider'
  | 'cutpurse'
  | 'berserker'
  | 'gloam'
  | 'sister'
  | 'prisoner'
  | 'dragon'
  | 'dragonSleep';

export function getModel(key: ModelKey): FigureModel {
  const hit = cache.get(key);
  if (hit) return hit;
  const m = buildModel(key);
  cache.set(key, m);
  return m;
}

const SKIN = 0xc79a76;

function buildModel(key: ModelKey): FigureModel {
  const k = new Kit();
  switch (key) {
    case 'hobart':
      humanoid(k, { skin: SKIN, tunic: 0x6f7378, legs: 0x3d3f44, helm: 'crown', helmColor: COLORS.gold, weapon: 'sword', shield: COLORS.gold, pauldrons: COLORS.steel, cape: 0x7a1414 });
      banner(k, 0xd9a93a, 0.95);
      return k.build(0.95, 0.16);
    case 'sellsword':
      humanoid(k, { skin: SKIN, tunic: 0x7d2a22, legs: 0x3a2e24, helm: 'kettle', weapon: 'sword', shield: 0x5a3a1c, pauldrons: COLORS.steelDark, wide: 1.15 });
      banner(k, 0xb03a2e, 0.85);
      return k.build(0.85, 0.15);
    case 'burglar':
      humanoid(k, { skin: SKIN, tunic: 0x2f3a2a, legs: 0x22261f, helm: 'hood', helmColor: 0x2c3a28, weapon: 'dagger', cape: 0x1f2a1c });
      banner(k, 0x3b9a4a, 0.8);
      return k.build(0.8, 0.13);
    case 'mage':
      humanoid(k, { skin: SKIN, tunic: 0x3b2659, legs: 0x3b2659, helm: 'hat', helmColor: 0x2d1d45, weapon: 'staff', beard: 0xd6d0c4, staffGlow: 0xffb35c });
      k.cone(0.15, 0.28, 6, 0x3b2659, [0, 0.14, 0]);
      banner(k, 0x8a4cc9, 1.0);
      return k.build(1.0, 0.14);
    case 'sister':
      // Lantern Sisters: pale hooded robes, a lantern held out front.
      humanoid(k, { skin: SKIN, tunic: 0x8a8070, legs: 0x5a5246, helm: 'hood', helmColor: 0xb8ad98, weapon: 'none' });
      k.cone(0.14, 0.26, 6, 0x8a8070, [0, 0.13, 0]);
      k.cyl(0.004, 0.004, 0.1, 3, 0x222222, [0.16, 0.36, 0.14]);
      k.box(0.06, 0.08, 0.06, 0x3a3020, [0.16, 0.28, 0.14]);
      k.box(0.04, 0.05, 0.04, 0xffd27a, [0.16, 0.28, 0.14], undefined, true);
      return k.build(0.75, 0.13);
    case 'prisoner':
      humanoid(k, { skin: SKIN, tunic: 0x9a8a6a, legs: 0x5a4a3a, helm: 'none', weapon: 'none', hunch: 0.3, beard: 0x6a5a4a });
      // Shackles.
      k.cyl(0.03, 0.03, 0.03, 6, COLORS.iron, [-0.12, 0.25, 0.04]);
      k.cyl(0.03, 0.03, 0.03, 6, COLORS.iron, [0.12, 0.25, 0.04]);
      return k.build(0.6, 0.12);
    case 'rats': {
      // A pack of three rats.
      const s = 0x4a3e36;
      for (const [x, z, r] of [
        [0, 0.08, 0],
        [-0.16, -0.08, 0.6],
        [0.15, -0.1, -0.4],
      ] as const) {
        k.ball(0.07, s, [x, 0.06, z], [0.8, 0.7, 1.4]);
        k.cone(0.04, 0.08, 4, s, [x + Math.sin(r) * 0.11, 0.06, z + Math.cos(r) * 0.11], [Math.PI / 2, r, 0]);
        k.box(0.012, 0.012, 0.16, 0xb07a6a, [x - Math.sin(r) * 0.15, 0.03, z - Math.cos(r) * 0.15], [0, r, 0]);
        k.box(0.015, 0.015, 0.01, COLORS.danger, [x + Math.sin(r) * 0.09 - 0.02, 0.09, z + Math.cos(r) * 0.09], undefined, true);
        k.box(0.015, 0.015, 0.01, COLORS.danger, [x + Math.sin(r) * 0.09 + 0.02, 0.09, z + Math.cos(r) * 0.09], undefined, true);
      }
      return k.build(0.25, 0.25);
    }
    case 'orc':
      humanoid(k, { skin: COLORS.orc, tunic: 0x3a2e22, legs: 0x241c14, helm: 'none', weapon: 'blade', shield: 0x3a2a1a, hunch: 0.6, eyes: COLORS.danger, wide: 1.25 });
      return k.build(0.6, 0.16);
    case 'cutpurse':
      humanoid(k, { skin: SKIN, tunic: 0x3a3030, legs: 0x221c1c, helm: 'hood', helmColor: 0x2a2020, weapon: 'dagger', hunch: 0.35, eyes: 0xffd27a });
      // Bulging sack.
      k.ball(0.09, 0x6b5a3a, [-0.1, 0.38, -0.12]);
      return k.build(0.7, 0.13);
    case 'berserker':
      humanoid(k, { skin: 0xc2614a, tunic: 0x8a1a12, legs: 0x3a1a12, helm: 'horned', helmColor: 0x3b3a3d, weapon: 'none', wide: 1.45, eyes: 0xffe0a0 });
      for (const sx of [-1, 1]) {
        k.cyl(0.012, 0.012, 0.36, 4, COLORS.woodDark, [sx * 0.22, 0.36, 0.12], [0.6, 0, 0]);
        k.box(0.12, 0.1, 0.015, COLORS.steel, [sx * 0.22 + sx * 0.04, 0.51, 0.22], [0.6, 0, 0]);
      }
      return k.build(0.75, 0.18);
    case 'spider': {
      const s = 0x2a2420;
      k.ball(0.16, s, [0, 0.16, -0.1], [1.1, 0.7, 1.3]);
      k.ball(0.09, s, [0, 0.13, 0.12]);
      k.box(0.08, 0.01, 0.08, 0xa02020, [0, 0.27, -0.12]);
      for (let i = 0; i < 4; i++) k.ball(0.015, COLORS.danger, [-0.045 + i * 0.03, 0.17, 0.2], undefined, true);
      for (const sx of [-1, 1])
        for (let i = 0; i < 4; i++) {
          const z = 0.08 - i * 0.08;
          k.box(0.22, 0.02, 0.02, 0x1a1512, [sx * 0.16, 0.2, z], [0, (i - 1.5) * 0.25 * sx, sx * 0.45]);
          k.box(0.02, 0.2, 0.02, 0x1a1512, [sx * 0.29, 0.1, z], [0, 0, -sx * 0.25]);
        }
      return k.build(0.35, 0.28);
    }
    case 'dragon':
      dragon(k, false);
      return k.build(2.6, 1.3);
    case 'dragonSleep':
      dragon(k, true);
      return k.build(1.3, 1.3);
    case 'gloam': {
      // A shape of darkness with two pale eyes.
      const s = 0x050508;
      k.cone(0.32, 1.1, 7, s, [0, 0.55, 0], [Math.PI, 0, 0]);
      k.ball(0.26, s, [0, 1.05, 0], [1, 1.2, 1]);
      k.box(0.26, 0.6, 0.06, s, [-0.3, 0.75, 0.05], [0.2, 0, 0.6]);
      k.box(0.26, 0.6, 0.06, s, [0.3, 0.75, 0.05], [0.2, 0, -0.6]);
      k.box(0.07, 0.035, 0.02, 0xdfe8ff, [-0.08, 1.08, 0.24], undefined, true);
      k.box(0.07, 0.035, 0.02, 0xdfe8ff, [0.08, 1.08, 0.24], undefined, true);
      return k.build(1.4, 0.35, { floats: true, ghost: true });
    }
  }
}

/**
 * The Dragon, in real world units (UnitView draws it at scale 1): about two
 * hexes long, red-brown scales, pale belly, horns, bat wings. Awake: reared up,
 * neck raised, wings half open, jaws glowing. Asleep: curled round, head on its
 * tail, wings folded.
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
    // Wings: two big triangles each, half open.
    k.add(new THREE.ConeGeometry(1.1, 2.0, 3), wing, [sx * 1.15, 1.75, -0.35], [0.35, 0, sx * 1.15], [1, 1, 0.12]);
    k.add(new THREE.ConeGeometry(0.7, 1.4, 3), dark, [sx * 1.75, 1.45, -0.6], [0.6, 0, sx * 1.6], [1, 1, 0.12]);
    k.cyl(0.05, 0.07, 1.6, 4, dark, [sx * 0.9, 1.95, -0.3], [0.2, 0, sx * 1.0]);
  }
  // Tail: tapering segments curling back.
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    k.ball(0.32 - i * 0.045, i % 2 ? scale : dark, [Math.sin(t * 2.2) * 0.5, 0.5 - t * 0.35, -1.0 - i * 0.32], [1, 0.8, 1.4]);
  }
  k.cone(0.14, 0.45, 4, horn, [Math.sin(2.2) * 0.5, 0.18, -2.95], [-Math.PI / 2, 0, 0]);
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
}

function banner(k: Kit, color: number, height: number): void {
  k.cyl(0.008, 0.008, height, 4, 0x2a1d12, [-0.06, height / 2 + 0.2, -0.1]);
  k.box(0.16, 0.2, 0.012, color, [-0.06 + 0.08, height + 0.08, -0.1]);
  k.cone(0.08, 0.1, 3, color, [-0.06 + 0.08, height - 0.07, -0.1], [Math.PI, 0, 0], [1, 1, 0.15]);
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
