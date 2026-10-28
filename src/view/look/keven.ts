// V5.0 (G): Keven, the heir, on the joint rig: the first figure in the For the King 1 style.
//
// Built in world units: 1.35 to the top of the bare head, the head a third of that, legs 38% of the body
// under the head, a six-sided tapered torso, box arms and legs, an icosahedron head with dot eyes and a
// beard, a gold crown, steel pauldrons, a red mantle, the backpack and bedroll on the back, the sword in
// the right hand and the gold shield on the left arm. W3 builds the rest of the cast the same way.

import * as THREE from 'three';
import { COLORS } from '../world';
import { HUMANOID_CLIPS } from './clips';
import { JointKit, RigFigure, type RigMaterials, type RigSpec } from './rig';

export const FIGURE_HEIGHT = 1.35;
export const HEAD_SHARE = 1 / 3;

export interface HumanoidDims {
  H: number;
  hs: number;
  legH: number;
  torsoH: number;
  W: number;
}

export function humanoidDims(H = FIGURE_HEIGHT, head = HEAD_SHARE): HumanoidDims {
  const hs = H * head;
  const bodyH = H - hs;
  const legH = bodyH * 0.38;
  return { H, hs, legH, torsoH: bodyH - legH, W: Math.max(H * 0.3, hs * 1.0) };
}

export function humanoidRest(d: HumanoidDims): RigSpec['rest'] {
  const { legH, torsoH, W } = d;
  return {
    root: [0, 0, 0],
    hips: [0, legH, 0],
    torso: [0, 0, 0],
    head: [0, torsoH, 0],
    armL: [-W * 0.58, torsoH * 0.93, 0],
    armR: [W * 0.58, torsoH * 0.93, 0],
    handL: [0, -torsoH * 0.82, 0.02],
    handR: [0, -torsoH * 0.82, 0.02],
    legL: [-W * 0.2, 0, 0],
    legR: [W * 0.2, 0, 0],
    back: [0, torsoH * 0.5, -W * 0.42],
  };
}

export interface HumanoidLook {
  skin: number;
  tunic: number;
  legs: number;
  boots?: number;
  beard?: number;
  hair?: number;
  eyes?: number;
}

/** The common body: legs and boots, torso and belt, arms and hands, head with eyes (and a beard). */
export function humanoidBody(k: JointKit, d: HumanoidDims, o: HumanoidLook): void {
  const { hs, legH, torsoH, W } = d;
  for (const j of ['legL', 'legR'] as const) {
    k.box(j, W * 0.3, legH, W * 0.34, o.legs, [0, -legH / 2, 0]);
    k.box(j, W * 0.34, legH * 0.28, W * 0.46, o.boots ?? 0x3b2a1c, [0, -legH + legH * 0.14, W * 0.05]);
  }
  k.cyl('torso', W * 0.42, W * 0.5, torsoH, 6, o.tunic, [0, torsoH / 2, 0], [0, Math.PI / 6, 0], [1, 1, 0.78]);
  k.cyl('torso', W * 0.52, W * 0.52, torsoH * 0.13, 6, 0x3b2a1c, [0, torsoH * 0.12, 0], [0, Math.PI / 6, 0], [1, 1, 0.8]);
  for (const [j, s] of [['armL', -1], ['armR', 1]] as const) {
    k.box(j, W * 0.24, torsoH * 0.82, W * 0.26, o.tunic, [0, -torsoH * 0.41, 0], [0, 0, s * 0.06]);
  }
  for (const j of ['handL', 'handR'] as const) k.ball(j, W * 0.14, o.skin, [0, 0, 0]);
  const hy = hs * 0.5;
  k.ball('head', hs * 0.52, o.skin, [0, hy, 0], 1, [1.08, 1, 1]);
  for (const s of [-1, 1]) k.box('head', hs * 0.1, hs * 0.16, 0.02, o.eyes ?? 0x1a1210, [s * hs * 0.18, hy + hs * 0.04, hs * 0.5], undefined, 'glow');
  if (o.beard !== undefined) k.cone('head', hs * 0.36, hs * 0.5, 5, o.beard, [0, hy - hs * 0.32, hs * 0.22], [Math.PI, 0, 0]);
  if (o.hair !== undefined) k.ball('head', hs * 0.5, o.hair, [0, hy + hs * 0.12, -hs * 0.08], 0, [1.05, 0.8, 1]);
}

export function rigMaterials(): RigMaterials {
  return {
    body: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.82, metalness: 0, transparent: true, opacity: 1, emissive: 0x000000 }),
    metal: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.3, metalness: 0.6, transparent: true, opacity: 1, emissive: 0x000000 }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 1 }),
  };
}

/** Keven. */
export function makeKeven(mats = rigMaterials()): RigFigure {
  const d = humanoidDims();
  const { hs, torsoH, W, H } = d;
  const k = new JointKit();
  humanoidBody(k, d, { skin: 0xe0b48a, tunic: 0x6f7378, legs: 0x3d3f44, beard: 0x7a4a2a });
  // Steel pauldrons and a gold collar on the mail.
  for (const s of [-1, 1]) k.ball('torso', W * 0.19, COLORS.steel, [s * W * 0.5, torsoH * 0.95, 0], 0, [1.1, 0.75, 1], 'metal');
  k.cyl('torso', W * 0.36, W * 0.42, torsoH * 0.1, 6, COLORS.gold, [0, torsoH * 0.9, 0], [0, Math.PI / 6, 0], [1, 1, 0.8], 'metal');
  // Crown: a gold band with five points.
  const top = hs;
  k.cyl('head', hs * 0.42, hs * 0.42, hs * 0.18, 8, COLORS.gold, [0, top - hs * 0.04, 0], undefined, undefined, 'metal');
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    k.cone('head', hs * 0.07, hs * 0.2, 4, COLORS.gold, [Math.sin(a) * hs * 0.38, top + hs * 0.14, Math.cos(a) * hs * 0.38], undefined, undefined, 'metal');
  }
  // Back: pack and bedroll under a short red mantle.
  k.box('back', W * 0.66, torsoH * 0.62, W * 0.3, 0x7a4a2a, [0, -torsoH * 0.05, -W * 0.08]);
  k.cyl('back', W * 0.16, W * 0.16, W * 0.9, 8, 0xd8cfbe, [0, torsoH * 0.33, -W * 0.1], [0, 0, Math.PI / 2]);
  k.box('back', W * 0.98, torsoH * 0.42, 0.035, 0x7a1414, [0, torsoH * 0.24, W * 0.02], [0.1, 0, 0]);
  // Gear on the joints: sword in the right hand, shield on the left arm.
  k.box('handR', 0.05, H * 0.5, 0.022, 0xc8ccd2, [0, H * 0.27, 0.05], undefined, 'metal');
  k.box('handR', W * 0.36, 0.035, 0.06, 0x3b3a3d, [0, 0.035, 0.05], undefined, 'metal');
  k.cyl('handR', 0.022, 0.022, 0.1, 5, 0x3d2615, [0, -0.06, 0.05]);
  k.cyl('armL', W * 0.42, W * 0.42, 0.05, 8, COLORS.gold, [-W * 0.2, -torsoH * 0.45, 0.06], [0, 0.5, Math.PI / 2], undefined, 'metal');
  k.ball('armL', W * 0.1, COLORS.gold, [-W * 0.23, -torsoH * 0.45, 0.06], 0, undefined, 'metal');
  const spec: RigSpec = { rest: humanoidRest(d), height: H + hs * 0.3, radius: 0.32, clips: HUMANOID_CLIPS };
  return new RigFigure(k, spec, mats);
}
