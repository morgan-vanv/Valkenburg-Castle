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

interface HumanOpts {
  skin: number;
  tunic: number;
  legs: number;
  helm?: 'kettle' | 'great' | 'hood' | 'hat' | 'crown' | 'horned' | 'none';
  helmColor?: number;
  weapon?: 'sword' | 'spear' | 'mace' | 'dagger' | 'staff' | 'blade' | 'bow' | 'hammer' | 'none';
  shield?: number;
  hunch?: number;
  eyes?: number;
  wide?: number;
  beard?: number;
  pauldrons?: number;
  cape?: number;
  staffGlow?: number;
}

/** Top of the bare head in model units (helms add to it; see HELM_TOP). */
export const HEAD_TOP = 1.05;
const HELM_TOP: Record<NonNullable<HumanOpts['helm']>, number> = { none: 0, kettle: 0.1, great: 0.12, hood: 0.2, hat: 0.42, crown: 0.2, horned: 0.3 };

function humanoid(k: Kit, o: HumanOpts): number {
  const w = o.wide ?? 1;
  const hunch = o.hunch ?? 0;
  // Legs: short and thick.
  k.box(0.15 * w, 0.34, 0.17, o.legs, [-0.1 * w, 0.17, 0]);
  k.box(0.15 * w, 0.34, 0.17, o.legs, [0.1 * w, 0.17, 0]);
  // Torso: broad tapered hexagonal prism.
  k.cyl(0.2 * w, 0.24 * w, 0.4, 6, o.tunic, [0, 0.56, hunch * 0.08], [hunch * 0.35, 0, 0]);
  // Belt.
  k.cyl(0.245 * w, 0.245 * w, 0.05, 6, 0x2a1d12, [0, 0.38, 0]);
  if (o.pauldrons) {
    k.ball(0.1, o.pauldrons, [-0.21 * w, 0.76, hunch * 0.12], [1.15, 0.8, 1]);
    k.ball(0.1, o.pauldrons, [0.21 * w, 0.76, hunch * 0.12], [1.15, 0.8, 1]);
  }
  if (o.cape) k.box(0.42 * w, 0.52 * w, 0.03, o.cape, [0, 0.5, -0.17], [0.12, 0, 0]);
  // Arms: thick, the right one raised to hold the weapon forward.
  k.box(0.11, 0.34, 0.12, o.tunic, [-0.27 * w, 0.55, 0.03 + hunch * 0.1], [hunch * 0.5, 0, 0.12]);
  k.box(0.11, 0.34, 0.12, o.tunic, [0.27 * w, 0.55, 0.03 + hunch * 0.1], [hunch * 0.5 - 0.4, 0, -0.12]);
  // Head: big, OSRS-like.
  const hy = 0.9 - hunch * 0.1;
  const hz = hunch * 0.2;
  k.ball(0.15, o.skin, [0, hy, hz]);
  // Eyes: glowing for monsters, plain dark dots for everyone else, so the front reads.
  const glowEyes = o.eyes !== undefined;
  const eyeColor = o.eyes ?? 0x1a1410;
  k.box(0.05, 0.035, 0.03, eyeColor, [-0.055, hy + 0.02, hz + 0.13], undefined, glowEyes);
  k.box(0.05, 0.035, 0.03, eyeColor, [0.055, hy + 0.02, hz + 0.13], undefined, glowEyes);
  if (o.beard) k.cone(0.13, 0.26, 5, o.beard, [0, hy - 0.16, hz + 0.07], [Math.PI, 0, 0]);
  const hc = o.helmColor ?? COLORS.steel;
  switch (o.helm) {
    case 'kettle':
      k.cyl(0.13, 0.15, 0.1, 6, hc, [0, hy + 0.1, hz]);
      k.cyl(0.23, 0.23, 0.02, 8, hc, [0, hy + 0.06, hz]);
      break;
    case 'great':
      k.cyl(0.16, 0.16, 0.3, 6, hc, [0, hy + 0.02, hz]);
      k.box(0.22, 0.02, 0.03, 0x111111, [0, hy + 0.04, hz + 0.15]);
      break;
    case 'hood':
      k.cone(0.19, 0.38, 6, hc, [0, hy + 0.1, hz - 0.02]);
      break;
    case 'hat':
      k.cyl(0.28, 0.28, 0.02, 8, hc, [0, hy + 0.1, hz]);
      k.cone(0.14, 0.44, 6, hc, [0, hy + 0.32, hz - 0.03], [-0.18, 0, 0]);
      break;
    case 'crown':
      k.cyl(0.15, 0.14, 0.12, 6, hc, [0, hy + 0.12, hz]);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        k.cone(0.03, 0.1, 3, hc, [Math.sin(a) * 0.13, hy + 0.23, hz + Math.cos(a) * 0.13]);
      }
      break;
    case 'horned':
      k.cyl(0.14, 0.15, 0.1, 6, hc, [0, hy + 0.1, hz]);
      k.cone(0.04, 0.26, 4, 0xd8cdb0, [-0.15, hy + 0.22, hz], [0, 0, 0.7]);
      k.cone(0.04, 0.26, 4, 0xd8cdb0, [0.15, hy + 0.22, hz], [0, 0, -0.7]);
      break;
  }
  // Weapon in the right hand (+x), shield on the left.
  const hx = 0.3 * w;
  switch (o.weapon) {
    case 'sword':
      k.box(0.05, 0.55, 0.02, COLORS.steel, [hx, 0.7, 0.24], [0.5, 0, 0]);
      k.box(0.16, 0.035, 0.04, 0x3a2a1a, [hx, 0.48, 0.14], [0.5, 0, 0]);
      break;
    case 'spear':
      k.cyl(0.02, 0.02, 1.5, 4, COLORS.woodDark, [hx, 0.75, 0.08]);
      k.cone(0.05, 0.16, 4, COLORS.steel, [hx, 1.56, 0.08]);
      break;
    case 'mace':
      k.cyl(0.025, 0.025, 0.5, 4, COLORS.woodDark, [hx, 0.65, 0.18], [0.5, 0, 0]);
      k.ball(0.1, 0x9a8e7a, [hx, 0.87, 0.31]);
      break;
    case 'dagger':
      k.box(0.04, 0.26, 0.02, COLORS.steel, [hx, 0.55, 0.18], [0.9, 0, 0]);
      break;
    case 'staff':
      k.cyl(0.022, 0.022, 1.55, 5, COLORS.woodDark, [hx, 0.78, 0.09]);
      k.ball(0.075, o.staffGlow ?? 0xb48cff, [hx, 1.6, 0.09], undefined, true);
      break;
    case 'blade':
      k.box(0.1, 0.48, 0.02, 0x6d6a66, [hx, 0.66, 0.24], [0.6, 0, 0.1]);
      break;
    case 'bow': {
      // A tall longbow held upright in the left hand, its string pale; a quiver on the back.
      const bx = -0.32 * w;
      for (let i = 0; i < 5; i++) {
        const t = (i - 2) / 2;
        k.box(0.04, 0.3, 0.04, 0x7a4a22, [bx, 0.7 + t * 0.55, 0.18 + (1 - t * t) * 0.13], [-t * 0.55, 0, 0]);
      }
      k.box(0.008, 1.12, 0.008, 0xe8e0c8, [bx, 0.7, 0.18]);
      k.cyl(0.065, 0.055, 0.48, 5, 0x5a3a1c, [0.1, 0.78, -0.2], [-0.35, 0, 0.3]);
      for (const dx of [-0.04, 0.0, 0.04]) k.box(0.02, 0.1, 0.02, 0xd8d0b8, [0.2 + dx, 1.05, -0.28]);
      break;
    }
    case 'hammer':
      k.cyl(0.03, 0.03, 0.65, 4, COLORS.woodDark, [hx, 0.7, 0.18], [0.45, 0, 0]);
      k.box(0.28, 0.15, 0.15, 0x7a7670, [hx, 1.0, 0.33], [0.45, 0, 0]);
      break;
  }
  if (o.shield !== undefined) {
    k.cyl(0.2, 0.2, 0.05, 6, o.shield, [-0.3 * w, 0.6, 0.12], [0, 0, Math.PI / 2], [1, 1, 1.15]);
    k.ball(0.05, COLORS.steelDark, [-0.33 * w, 0.6, 0.12]);
  }
  return HEAD_TOP - hunch * 0.1 + HELM_TOP[o.helm ?? 'none'];
}

// ------------------------------------------------------------ models

export type ModelKey =
  | 'hobart'
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

/** A robe skirt over the legs (mages, sisters). */
function robe(k: Kit, color: number, r = 0.3): void {
  k.cone(r, 0.52, 6, color, [0, 0.26, 0]);
}

function buildModel(key: ModelKey): FigureModel {
  const k = new Kit();
  let top: number;
  switch (key) {
    case 'hobart':
      top = humanoid(k, { skin: SKIN, tunic: 0x6f7378, legs: 0x3d3f44, helm: 'crown', helmColor: COLORS.gold, weapon: 'sword', shield: COLORS.gold, pauldrons: COLORS.steel, cape: 0x7a1414 });
      banner(k, 0xd9a93a, top + 0.25);
      return k.build(top + 0.1, 0.32);
    case 'sellsword':
      top = humanoid(k, { skin: SKIN, tunic: 0x7d2a22, legs: 0x3a2e24, helm: 'kettle', weapon: 'sword', shield: 0x5a3a1c, pauldrons: COLORS.steelDark, wide: 1.15 });
      banner(k, 0xb03a2e, top + 0.25);
      return k.build(top + 0.1, 0.34);
    case 'burglar':
      top = humanoid(k, { skin: SKIN, tunic: 0x2f3a2a, legs: 0x22261f, helm: 'hood', helmColor: 0x2c3a28, weapon: 'dagger', cape: 0x1f2a1c });
      banner(k, 0x3b9a4a, top + 0.25);
      return k.build(top + 0.1, 0.28);
    case 'mage':
      top = humanoid(k, { skin: SKIN, tunic: 0x3b2659, legs: 0x3b2659, helm: 'hat', helmColor: 0x2d1d45, weapon: 'staff', beard: 0xd6d0c4, staffGlow: 0xffb35c });
      robe(k, 0x3b2659);
      banner(k, 0x8a4cc9, top + 0.15);
      return k.build(top + 0.05, 0.3);
    case 'ranger':
      // Green hood and cloak, longbow: reads from far by the tall bow arc.
      top = humanoid(k, { skin: SKIN, tunic: 0x4a5a2a, legs: 0x3a3424, helm: 'hood', helmColor: 0x3f5a26, weapon: 'bow', cape: 0x33461c });
      banner(k, 0x8fbf3a, top + 0.25);
      return k.build(top + 0.1, 0.3);
    case 'sapper':
      // Stocky, leather apron, hammer, a big pack of charges with a fuse.
      top = humanoid(k, { skin: SKIN, tunic: 0x8a5a2a, legs: 0x3a2e24, helm: 'kettle', helmColor: 0x6a5a3a, weapon: 'hammer', wide: 1.2, beard: 0x7a4a22 });
      k.box(0.38, 0.4, 0.22, 0x5a4024, [0, 0.62, -0.26]);
      k.cyl(0.07, 0.07, 0.22, 6, 0xb03a2e, [-0.11, 0.88, -0.26]);
      k.cyl(0.07, 0.07, 0.22, 6, 0xb03a2e, [0.11, 0.88, -0.26]);
      k.box(0.015, 0.1, 0.015, 0xffc860, [0.11, 1.03, -0.26], undefined, true);
      banner(k, 0xe08a2a, top + 0.25);
      return k.build(top + 0.1, 0.36);
    case 'pyromancer':
      top = humanoid(k, { skin: SKIN, tunic: 0x8a2416, legs: 0x5a160e, helm: 'hat', helmColor: 0x5a160e, weapon: 'staff', staffGlow: 0xff6a1a });
      robe(k, 0x8a2416);
      k.ball(0.06, 0xffa040, [-0.3, 0.6, 0.14], undefined, true);
      banner(k, 0xff5a1a, top + 0.15);
      return k.build(top + 0.05, 0.3);
    case 'shadowmancer':
      top = humanoid(k, { skin: 0xa89aa8, tunic: 0x241a3a, legs: 0x1a1428, helm: 'hood', helmColor: 0x1a1428, weapon: 'staff', staffGlow: 0x9a6aff, cape: 0x120c1e, eyes: 0xb08aff });
      robe(k, 0x241a3a, 0.32);
      banner(k, 0x7a4cff, top + 0.25);
      return k.build(top + 0.1, 0.3);
    case 'hedgewitch':
      top = humanoid(k, { skin: SKIN, tunic: 0x2e5a3e, legs: 0x22402c, helm: 'hat', helmColor: 0x5a4a2a, weapon: 'staff', staffGlow: 0x8affb0 });
      robe(k, 0x2e5a3e);
      // Herb pouch and a sprig on the hat.
      k.ball(0.09, 0x8a7350, [0.2, 0.4, 0.14]);
      k.cone(0.04, 0.16, 4, 0x7fd06a, [0.1, 1.3, 0.04], [0.3, 0, -0.4]);
      banner(k, 0x5ad08a, top + 0.15);
      return k.build(top + 0.05, 0.3);
    case 'sister':
      // Lantern Sisters: pale hooded robes, a lantern held out front.
      top = humanoid(k, { skin: SKIN, tunic: 0x8a8070, legs: 0x5a5246, helm: 'hood', helmColor: 0xb8ad98, weapon: 'none' });
      robe(k, 0x8a8070, 0.28);
      k.cyl(0.008, 0.008, 0.2, 3, 0x222222, [0.32, 0.62, 0.26]);
      k.box(0.12, 0.16, 0.12, 0x3a3020, [0.32, 0.46, 0.26]);
      k.box(0.08, 0.1, 0.08, 0xffd27a, [0.32, 0.46, 0.26], undefined, true);
      return k.build(top, 0.28);
    case 'prisoner':
      top = humanoid(k, { skin: SKIN, tunic: 0x9a8a6a, legs: 0x5a4a3a, helm: 'none', weapon: 'none', hunch: 0.3, beard: 0x6a5a4a });
      // Shackles.
      k.cyl(0.06, 0.06, 0.06, 6, COLORS.iron, [-0.24, 0.4, 0.07]);
      k.cyl(0.06, 0.06, 0.06, 6, COLORS.iron, [0.24, 0.4, 0.07]);
      return k.build(top, 0.26);
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
      // Hero-sized, hunched and broad, red eyes, a cleaver.
      top = humanoid(k, { skin: COLORS.orc, tunic: 0x3a2e22, legs: 0x241c14, helm: 'none', weapon: 'blade', shield: 0x3a2a1a, hunch: 0.5, eyes: COLORS.danger, wide: 1.3 });
      // Tusks.
      k.cone(0.03, 0.09, 4, 0xe8dcc0, [-0.07, 0.82, 0.22]);
      k.cone(0.03, 0.09, 4, 0xe8dcc0, [0.07, 0.82, 0.22]);
      return k.build(top, 0.38);
    case 'cutpurse':
      top = humanoid(k, { skin: SKIN, tunic: 0x3a3030, legs: 0x221c1c, helm: 'hood', helmColor: 0x2a2020, weapon: 'dagger', hunch: 0.35, eyes: 0xffd27a });
      // Bulging sack.
      k.ball(0.18, 0x6b5a3a, [-0.2, 0.66, -0.24]);
      return k.build(top, 0.28);
    case 'berserker':
      // A head taller than an orc, horned, two axes.
      top = humanoid(k, { skin: 0xc2614a, tunic: 0x8a1a12, legs: 0x3a1a12, helm: 'horned', helmColor: 0x3b3a3d, weapon: 'none', wide: 1.45, eyes: 0xffe0a0 });
      for (const sx of [-1, 1]) {
        k.cyl(0.025, 0.025, 0.65, 4, COLORS.woodDark, [sx * 0.44, 0.65, 0.22], [0.6, 0, 0]);
        k.box(0.24, 0.2, 0.03, COLORS.steel, [sx * 0.44 + sx * 0.08, 0.92, 0.4], [0.6, 0, 0]);
      }
      return k.build(top, 0.42);
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

/** A class banner on a short pole over the left shoulder; `top` is where the flag's top sits. */
function banner(k: Kit, color: number, top: number): void {
  const x = -0.14;
  const z = -0.22;
  k.cyl(0.016, 0.016, top - 0.3, 4, 0x2a1d12, [x, (top - 0.3) / 2 + 0.3, z]);
  k.box(0.22, 0.24, 0.02, color, [x + 0.11, top - 0.12, z]);
  k.cone(0.11, 0.12, 3, color, [x + 0.11, top - 0.3, z], [Math.PI, 0, 0], [1, 1, 0.15]);
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
