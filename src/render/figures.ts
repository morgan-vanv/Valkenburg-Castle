// Low-poly figures built from primitives, merged into one vertex-coloured
// geometry per model (one draw call each) plus a separate glow geometry for
// eyes, staff tips and the like. Cached by model key.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Armor, UnitClass } from '../engine/types';
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

class Kit {
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

export function modelKey(cls: UnitClass, armor: Armor, heroId?: string): string {
  return cls === 'squad' ? `squad-${armor}` : heroId ? `hero-${heroId}` : cls;
}

export function getModel(cls: UnitClass, armor: Armor = 'normal', heroId?: string): FigureModel {
  const key = modelKey(cls, armor, heroId);
  const hit = cache.get(key);
  if (hit) return hit;
  const m = buildModel(cls, armor, heroId);
  cache.set(key, m);
  return m;
}

const SKIN = 0xc79a76;
const ORC_SKIN = COLORS.orc;
const OURS = 0x8a5a2b; // tabard of the company: burnt ochre
const OURS_LEGS = 0x3a2e24;

function buildModel(cls: UnitClass, armor: Armor, heroId?: string): FigureModel {
  const k = new Kit();
  switch (cls) {
    case 'squad': {
      if (armor === 'unarmored') humanoid(k, { skin: SKIN, tunic: 0x7b6a4f, legs: OURS_LEGS, helm: 'none', weapon: 'spear' });
      else if (armor === 'heavy') humanoid(k, { skin: SKIN, tunic: 0x6f7378, legs: 0x4a4d52, helm: 'great', weapon: 'spear', shield: OURS, pauldrons: COLORS.steel });
      else humanoid(k, { skin: SKIN, tunic: OURS, legs: OURS_LEGS, helm: 'kettle', weapon: 'spear', shield: 0x5a3a1c });
      return k.build(0.62, 0.09);
    }
    case 'hobart':
      humanoid(k, { skin: SKIN, tunic: 0x6f7378, legs: 0x3d3f44, helm: 'crown', helmColor: COLORS.gold, weapon: 'sword', shield: COLORS.gold, pauldrons: COLORS.steel, cape: 0x7a1414 });
      banner(k, heroColor(heroId), 0.95);
      return k.build(0.95, 0.16);
    case 'leader':
      humanoid(k, { skin: SKIN, tunic: 0x36456a, legs: 0x2a2a30, helm: 'kettle', weapon: 'sword', shield: 0x3561c9, pauldrons: COLORS.steel, cape: 0x1f2c55 });
      banner(k, heroColor(heroId), 0.95);
      return k.build(0.9, 0.15);
    case 'dwarf':
      humanoid(k, { skin: SKIN, tunic: 0x6b4a2a, legs: 0x3a2a1c, helm: 'horned', helmColor: 0x8b6f4a, weapon: 'mace', shield: 0x8b5a2b, wide: 1.45, beard: 0xb0702f, pauldrons: 0x8b6f4a });
      banner(k, heroColor(heroId), 0.8);
      return k.build(0.75, 0.16);
    case 'burglar':
      humanoid(k, { skin: SKIN, tunic: 0x2f3a2a, legs: 0x22261f, helm: 'hood', helmColor: 0x2c3a28, weapon: 'dagger' });
      banner(k, heroColor(heroId), 0.85);
      return k.build(0.8, 0.13);
    case 'magicUser':
      humanoid(k, { skin: SKIN, tunic: 0x3b2659, legs: 0x3b2659, helm: 'hat', helmColor: 0x2d1d45, weapon: 'staff', beard: 0xd6d0c4 });
      // Robe skirt.
      k.cone(0.15, 0.28, 6, 0x3b2659, [0, 0.14, 0], undefined, [1, 1, 1]);
      banner(k, heroColor(heroId), 1.0);
      return k.build(1.0, 0.14);
    case 'orcSquad':
      humanoid(k, { skin: ORC_SKIN, tunic: 0x3a2e22, legs: 0x241c14, helm: 'none', weapon: 'blade', shield: 0x3a2a1a, hunch: 0.6, eyes: COLORS.danger, wide: 1.1 });
      return k.build(0.55, 0.09);
    case 'evilLeader':
      humanoid(k, { skin: ORC_SKIN, tunic: 0x2a1e18, legs: 0x1c1410, helm: 'horned', helmColor: 0x3b3a3d, weapon: 'blade', shield: 0x5a1010, hunch: 0.5, eyes: COLORS.danger, wide: 1.25, pauldrons: 0x3b3a3d, cape: 0x4a0d0d });
      return k.build(0.8, 0.15);
    case 'evilMagicUser':
      humanoid(k, { skin: ORC_SKIN, tunic: 0x241a2e, legs: 0x241a2e, helm: 'hood', helmColor: 0x1a1222, weapon: 'staff', staffGlow: 0x7dff6a, hunch: 0.4, eyes: COLORS.danger });
      k.cone(0.15, 0.28, 6, 0x241a2e, [0, 0.14, 0]);
      return k.build(0.85, 0.14);
    case 'troll': {
      // Big, hunched, long-armed.
      const s = 0x5f6b55;
      k.box(0.12, 0.3, 0.12, 0x3f463a, [-0.1, 0.15, 0]).box(0.12, 0.3, 0.12, 0x3f463a, [0.1, 0.15, 0]);
      k.cyl(0.17, 0.2, 0.42, 6, s, [0, 0.52, 0.08], [0.6, 0, 0]);
      k.ball(0.11, s, [0, 0.72, 0.28], [1, 0.9, 1.1]);
      k.box(0.03, 0.02, 0.02, COLORS.emberHot, [-0.04, 0.75, 0.38], undefined, true).box(0.03, 0.02, 0.02, COLORS.emberHot, [0.04, 0.75, 0.38], undefined, true);
      k.box(0.08, 0.52, 0.09, s, [-0.24, 0.38, 0.18], [0.3, 0, 0.15]).box(0.08, 0.52, 0.09, s, [0.24, 0.38, 0.18], [0.3, 0, -0.15]);
      k.ball(0.07, s, [-0.28, 0.12, 0.26]).ball(0.07, s, [0.28, 0.12, 0.26]);
      return k.build(0.9, 0.28);
    }
    case 'ogre': {
      const s = 0x9c7a55;
      k.box(0.13, 0.32, 0.13, 0x4a3524, [-0.1, 0.16, 0]).box(0.13, 0.32, 0.13, 0x4a3524, [0.1, 0.16, 0]);
      k.cyl(0.2, 0.24, 0.42, 7, s, [0, 0.52, 0], [0.15, 0, 0]);
      k.cyl(0.25, 0.25, 0.08, 7, 0x4a3524, [0, 0.36, 0]);
      k.ball(0.1, s, [0, 0.82, 0.05]);
      k.box(0.03, 0.02, 0.02, 0xffd28a, [-0.04, 0.84, 0.14], undefined, true).box(0.03, 0.02, 0.02, 0xffd28a, [0.04, 0.84, 0.14], undefined, true);
      k.box(0.09, 0.36, 0.1, s, [-0.27, 0.52, 0.04], [0, 0, 0.25]).box(0.09, 0.36, 0.1, s, [0.27, 0.52, 0.12], [-0.7, 0, -0.2]);
      // Club.
      k.cyl(0.08, 0.035, 0.55, 6, COLORS.woodDark, [0.3, 0.72, 0.36], [-1.0, 0, 0]);
      return k.build(1.0, 0.28);
    }
    case 'berserker':
      humanoid(k, { skin: 0xc2614a, tunic: 0x8a1a12, legs: 0x3a1a12, helm: 'none', weapon: 'none', wide: 1.3, eyes: 0xffe0a0 });
      // Two axes.
      for (const sx of [-1, 1]) {
        k.cyl(0.012, 0.012, 0.36, 4, COLORS.woodDark, [sx * 0.2, 0.36, 0.12], [0.6, 0, 0]);
        k.box(0.1, 0.09, 0.015, COLORS.steel, [sx * 0.2 + sx * 0.04, 0.51, 0.22], [0.6, 0, 0]);
      }
      return k.build(0.65, 0.16);
    case 'mantis': {
      const s = 0x86a83c;
      k.cyl(0.05, 0.07, 0.4, 5, s, [0, 0.62, -0.02], [0.2, 0, 0]);
      k.cyl(0.07, 0.04, 0.32, 5, 0x6f8f2c, [0, 0.42, -0.14], [1.2, 0, 0]);
      k.cone(0.07, 0.14, 4, s, [0, 0.9, 0.05], [Math.PI - 0.3, 0, 0]);
      k.ball(0.022, COLORS.danger, [-0.05, 0.92, 0.07], undefined, true).ball(0.022, COLORS.danger, [0.05, 0.92, 0.07], undefined, true);
      for (const sx of [-1, 1]) {
        k.box(0.025, 0.26, 0.025, s, [sx * 0.07, 0.72, 0.1], [0.9, 0, 0]);
        k.box(0.02, 0.28, 0.04, 0xd2e08a, [sx * 0.08, 0.66, 0.26], [-0.5, 0, 0]);
        // Legs.
        k.box(0.02, 0.42, 0.02, 0x6f8f2c, [sx * 0.1, 0.2, 0], [0, 0, sx * 0.25]);
        k.box(0.02, 0.36, 0.02, 0x6f8f2c, [sx * 0.1, 0.18, -0.2], [-0.3, 0, sx * 0.25]);
      }
      return k.build(1.0, 0.18);
    }
    case 'spider': {
      const s = 0x2a2420;
      k.ball(0.16, s, [0, 0.16, -0.1], [1.1, 0.7, 1.3]);
      k.ball(0.09, s, [0, 0.13, 0.12]);
      for (let i = 0; i < 4; i++) k.ball(0.015, COLORS.danger, [-0.045 + i * 0.03, 0.17, 0.2], undefined, true);
      for (const sx of [-1, 1])
        for (let i = 0; i < 4; i++) {
          const z = 0.08 - i * 0.08;
          k.box(0.22, 0.02, 0.02, 0x1a1512, [sx * 0.16, 0.2, z], [0, (i - 1.5) * 0.25 * sx, sx * 0.45]);
          k.box(0.02, 0.2, 0.02, 0x1a1512, [sx * 0.29, 0.1, z], [0, 0, -sx * 0.25]);
        }
      return k.build(0.35, 0.26);
    }
    case 'drog': {
      // Dog-frog: squat, wide mouth, big hind legs.
      const s = 0x5c7a3a;
      k.ball(0.17, s, [0, 0.2, 0], [1.2, 0.75, 1.2]);
      k.box(0.3, 0.03, 0.1, 0x2a0e0e, [0, 0.19, 0.17]);
      k.ball(0.04, 0xf0e070, [-0.1, 0.3, 0.12], undefined, true).ball(0.04, 0xf0e070, [0.1, 0.3, 0.12], undefined, true);
      k.cone(0.035, 0.08, 4, 0x3f5528, [-0.09, 0.34, -0.02]).cone(0.035, 0.08, 4, 0x3f5528, [0.09, 0.34, -0.02]);
      for (const sx of [-1, 1]) {
        k.ball(0.09, s, [sx * 0.17, 0.12, -0.14], [0.8, 1, 1.4]);
        k.box(0.05, 0.03, 0.18, 0x3f5528, [sx * 0.19, 0.02, -0.04]);
        k.box(0.04, 0.14, 0.04, s, [sx * 0.12, 0.07, 0.14]);
      }
      k.box(0.03, 0.03, 0.14, s, [0, 0.2, -0.24], [0.5, 0, 0]);
      return k.build(0.4, 0.22);
    }
    case 'banshee': {
      const s = 0xb8d4e8;
      k.cone(0.18, 0.5, 7, s, [0, 0.3, 0], [Math.PI, 0, 0]);
      k.ball(0.09, 0xdbe8f2, [0, 0.62, 0.02]);
      k.ball(0.025, 0x1a2a3a, [-0.03, 0.63, 0.09]).ball(0.025, 0x1a2a3a, [0.03, 0.63, 0.09]);
      k.box(0.04, 0.03, 0.02, 0x1a2a3a, [0, 0.57, 0.09]);
      k.box(0.05, 0.3, 0.04, s, [-0.17, 0.48, 0.06], [0.5, 0, 0.8]).box(0.05, 0.3, 0.04, s, [0.17, 0.48, 0.06], [0.5, 0, -0.8]);
      k.ball(0.06, 0xcfe8ff, [0, 0.62, 0.02], undefined, true);
      return k.build(0.9, 0.16, { floats: true, ghost: true });
    }
    case 'dragon': {
      const s = 0x6a1a14;
      const belly = 0xa8642a;
      k.ball(0.32, s, [0, 0.38, 0], [1, 0.8, 1.5]);
      k.ball(0.2, belly, [0, 0.3, 0.18], [1, 0.6, 1.2]);
      k.cyl(0.1, 0.16, 0.4, 6, s, [0, 0.6, 0.38], [-0.7, 0, 0]);
      k.box(0.18, 0.14, 0.32, s, [0, 0.8, 0.6], [0.2, 0, 0]);
      k.box(0.16, 0.05, 0.2, 0x3a0c08, [0, 0.72, 0.7], [0.2, 0, 0]);
      k.ball(0.03, 0xffc040, [-0.07, 0.86, 0.66], undefined, true).ball(0.03, 0xffc040, [0.07, 0.86, 0.66], undefined, true);
      k.cone(0.03, 0.14, 4, 0xd8cdb0, [-0.07, 0.92, 0.5], [-1.0, 0, 0]).cone(0.03, 0.14, 4, 0xd8cdb0, [0.07, 0.92, 0.5], [-1.0, 0, 0]);
      for (const sx of [-1, 1]) {
        k.box(0.11, 0.26, 0.12, s, [sx * 0.22, 0.13, 0.22]).box(0.12, 0.26, 0.14, s, [sx * 0.24, 0.13, -0.24]);
        // Wings: two triangles' worth of flat boxes.
        k.box(0.62, 0.02, 0.34, 0x4a100c, [sx * 0.5, 0.72, -0.05], [0.15, sx * 0.2, sx * 0.45]);
        k.box(0.44, 0.02, 0.22, 0x3a0c08, [sx * 0.82, 0.92, -0.18], [0.1, sx * 0.4, sx * 0.7]);
      }
      k.cone(0.12, 0.7, 5, s, [0, 0.3, -0.7], [-Math.PI / 2 + 0.2, 0, 0]);
      return k.build(1.1, 0.5);
    }
    default:
      k.ball(0.1, 0x888888, [0, 0.1, 0]);
      return k.build(0.3, 0.1);
  }
}

function heroColor(heroId?: string): number {
  const map: Record<string, number> = { hobart: 0xd9a93a, rogier: 0x3561c9, thorvold: 0xb0702f, pim: 0x3b9a4a, aldous: 0x8a4cc9 };
  return (heroId && map[heroId]) || COLORS.ember;
}

function banner(k: Kit, color: number, height: number): void {
  // A pole on the back with a hanging pennant.
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
