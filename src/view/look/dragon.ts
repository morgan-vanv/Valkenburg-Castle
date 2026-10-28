// V5.0 (G, W3 pass 2): the Dragon on the joint rig, awake and asleep. The V3 silhouette (figures.ts) ported
// to joints so it breathes, lifts its head to roar and stirs in its sleep: body on torso, neck and head on
// head, wings on armL/armR, tail on back, legs on legL/legR. Built in world units; scale 1.

import * as THREE from 'three';
import { JointKit, RigFigure, type Clip, type ClipName, type RigMaterials, type RigSpec } from './rig';
import { humanoidDims, humanoidRest } from './keven';

const C = { scale: 0x8a2e1e, dark: 0x5a1c12, belly: 0xd8a868, horn: 0xe8dcc0, wing: 0x6a2216, eye: 0xffd040 };
const S = 1.3;
const sin = Math.sin;

function awakeKit(): { k: JointKit; rest: RigSpec['rest'] } {
  const k = new JointKit();
  // Rest: torso at the body's centre; head joint at the base of the neck; wings at the shoulders; tail at the rump.
  const rest = humanoidRest(humanoidDims(1));
  rest.hips = [0, 0, 0];
  rest.torso = [0, 0.95 * S, -0.15 * S];
  rest.head = [0, 0.3 * S, 0.75 * S];
  rest.armL = [-0.6 * S, 0.5 * S, -0.2 * S];
  rest.armR = [0.6 * S, 0.5 * S, -0.2 * S];
  rest.back = [0, -0.4 * S, -0.9 * S];
  rest.legL = [-0.5 * S, 0, 0];
  rest.legR = [0.5 * S, 0, 0];
  const b = (x: number, y: number, z: number): [number, number, number] => [x * S, y * S, z * S];
  // Body and belly (torso frame: origin at the body's centre).
  k.ball('torso', 0.75 * S, C.scale, b(0, 0, 0), 1, [1.05, 0.8, 1.45]);
  k.ball('torso', 0.55 * S, C.belly, b(0, -0.15, 0.35), 1, [1.0, 0.75, 1.1]);
  for (let i = 0; i < 6; i++) k.cone('torso', 0.09 * S, 0.32 * S, 4, C.horn, b(0, 0.6 - i * 0.07, 0.6 - i * 0.3), [-0.3, 0, 0]);
  // Legs (leg frames: origin at the hip, down to the ground).
  for (const [j, sx] of [['legL', -1], ['legR', 1]] as const) {
    k.cyl(j, 0.14 * S, 0.18 * S, 0.75 * S, 6, C.dark, b(0, 0.38, 0.45), [0.2, 0, sx * 0.1]);
    k.cyl(j, 0.18 * S, 0.22 * S, 0.8 * S, 6, C.dark, b(0.05 * sx, 0.4, -0.6), [-0.2, 0, sx * 0.1]);
    for (const dz of [0.45, -0.6]) for (let c = -1; c <= 1; c++) k.cone(j, 0.04 * S, 0.16 * S, 3, C.horn, b(c * 0.07, 0.05, dz + 0.15), [Math.PI / 2, 0, 0]);
  }
  // Wings (arm frames at the shoulders).
  for (const [j, sx] of [['armL', -1], ['armR', 1]] as const) {
    k.add(j, new THREE.ConeGeometry(1.2 * S, 2.3 * S, 3), C.wing, b(sx * 0.7, 0.25, -0.15), [0.35, 0, sx * 1.25], [1, 1, 0.12]);
    k.add(j, new THREE.ConeGeometry(0.8 * S, 1.7 * S, 3), C.dark, b(sx * 1.6, -0.2, -0.4), [0.6, 0, sx * 1.7], [1, 1, 0.12]);
    k.cyl(j, 0.05 * S, 0.07 * S, 1.9 * S, 4, C.dark, b(sx * 0.4, 0.45, -0.1), [0.2, 0, sx * 1.05]);
  }
  // Tail (back frame at the rump, curling back).
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    k.ball('back', (0.32 - i * 0.045) * S, i % 2 ? C.scale : C.dark, b(sin(t * 2.2) * 0.5, 0.3 - t * 0.35, -0.1 - i * 0.26), 1, [1, 0.8, 1.3]);
  }
  k.cone('back', 0.14 * S, 0.45 * S, 4, C.horn, b(sin(2.2) * 0.5, -0.02, -1.7), [-Math.PI / 2, 0, 0]);
  // Neck and head (head frame at the base of the neck).
  for (let i = 0; i < 4; i++) k.ball('head', (0.3 - i * 0.03) * S, i % 2 ? C.dark : C.scale, b(0, 0.05 + i * 0.3, 0.05 + i * 0.2), 1, [1, 1, 1.15]);
  const hy = 1.1;
  const hz = 0.75;
  k.ball('head', 0.34 * S, C.scale, b(0, hy, hz), 1, [1, 0.85, 1.2]);
  k.box('head', 0.38 * S, 0.2 * S, 0.6 * S, C.scale, b(0, hy + 0.02, hz + 0.45), [0.12, 0, 0]);
  k.box('head', 0.34 * S, 0.1 * S, 0.55 * S, C.dark, b(0, hy - 0.22, hz + 0.38), [0.4, 0, 0]);
  k.box('head', 0.26 * S, 0.12 * S, 0.4 * S, 0xff7a20, b(0, hy - 0.1, hz + 0.4), [0.25, 0, 0], 'glow');
  for (const sx of [-1, 1]) {
    k.cone('head', 0.07 * S, 0.55 * S, 4, C.horn, b(sx * 0.2, hy + 0.32, hz - 0.25), [-1.1, 0, sx * 0.35]);
    k.box('head', 0.08 * S, 0.05 * S, 0.05 * S, C.eye, b(sx * 0.16, hy + 0.12, hz + 0.24), undefined, 'glow');
    for (let t = 0; t < 3; t++) k.cone('head', 0.025 * S, 0.09 * S, 3, C.horn, b(sx * 0.12, hy - 0.1, hz + 0.3 + t * 0.12), [Math.PI, 0, 0]);
  }
  return { k, rest };
}

function sleepKit(): { k: JointKit; rest: RigSpec['rest'] } {
  const k = new JointKit();
  const T = 1.75;
  const rest = humanoidRest(humanoidDims(1));
  rest.hips = [0, 0, 0];
  rest.torso = [0, 0, 0];
  rest.head = [0.6 * T, 0.32 * T, 0.45 * T];
  rest.armL = [-0.3 * T, 0.95 * T, -0.1 * T];
  rest.armR = [0.3 * T, 0.95 * T, -0.1 * T];
  rest.back = [1.0 * T, 0.18 * T, -0.35 * T];
  const b = (x: number, y: number, z: number): [number, number, number] => [x * T, y * T, z * T];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 1.75 + 0.3;
    const r = 0.62;
    const s = 0.5 - i * 0.03;
    k.ball('torso', s * T, i % 2 ? C.scale : C.dark, b(Math.cos(a) * r, s * 0.7, sin(a) * r), 1, [1.25, 0.8, 1.1]);
  }
  k.ball('torso', 0.62 * T, C.scale, b(0, 0.5, 0), 1, [1.4, 0.75, 1.2]);
  for (let i = 0; i < 5; i++) k.cone('torso', 0.08 * T, 0.28 * T, 4, C.horn, b(-0.4 + i * 0.2, 1.0 - Math.abs(i - 2) * 0.06, -0.05));
  for (const [j, sx] of [['armL', -1], ['armR', 1]] as const) k.add(j, new THREE.ConeGeometry(0.55 * T, 1.3 * T, 3), C.wing, [0, 0, 0], [0.2, 0, sx * 1.2], [1, 1, 0.25]);
  // Head resting on the coil, eyes shut (head joint at [0.6, 0.32, 0.45] T: the skull; the snout points out and forward).
  k.ball('head', 0.28 * T, C.scale, [0, 0, 0], 1, [1, 0.8, 1.1]);
  k.add('head', new THREE.ConeGeometry(0.24 * T, 0.8 * T, 5), C.scale, b(0.3, -0.02, 0.3), [Math.PI / 2, 0, -0.75], [1, 1, 0.75]);
  k.box('head', 0.1 * T, 0.02 * T, 0.03 * T, 0x1a0a06, b(0.14, 0.08, 0.22));
  for (const sx of [-1, 1]) k.cone('head', 0.06 * T, 0.38 * T, 4, C.horn, b(-0.1 + sx * 0.12, 0.26, -0.12), [-1.0, 0, sx * 0.3]);
  k.ball('head', 0.06 * T, 0xffa060, b(0.55, 0.02, 0.55), 0, undefined, 'glow');
  // Tail tip past the coil (back joint at [1.0, 0.18, -0.35] T).
  k.cone('back', 0.12 * T, 0.6 * T, 4, C.dark, [0, 0, 0], [0, 0, -1.4]);
  k.ball('back', 0.16 * T, C.dark, b(-0.25, 0.02, 0.1), 1, [1.3, 0.8, 1]);
  return { k, rest };
}

const AWAKE_CLIPS: Partial<Record<ClipName, Clip>> = {
  idle: {
    loop: true,
    duration: 4,
    pose: (_t, time) => ({
      torso: { sy: 1 + sin(time * 1.4) * 0.025, py: sin(time * 1.4) * 0.02 },
      head: { rx: sin(time * 0.8) * 0.08, ry: sin(time * 0.45) * 0.2 },
      armL: { rz: sin(time * 1.1) * 0.08, rx: sin(time * 1.4) * 0.04 },
      armR: { rz: -sin(time * 1.1) * 0.08, rx: sin(time * 1.4) * 0.04 },
      back: { ry: sin(time * 0.9) * 0.15 },
    }),
  },
  walk: {
    loop: true,
    duration: 0.9,
    pose: (t) => {
      const s = sin(t * Math.PI * 2);
      return { legL: { rx: s * 0.35 }, legR: { rx: -s * 0.35 }, torso: { py: Math.abs(s) * 0.05, rz: s * 0.04 }, head: { rx: -0.1, ry: s * 0.05 }, back: { ry: s * 0.25 }, armL: { rz: s * 0.1 }, armR: { rz: -s * 0.1 } };
    },
  },
  // The breath: the head rears, the wings lift, then the jaws drive forward and hold.
  cast: {
    loop: false,
    duration: 1.1,
    pose: (t) => {
      const rear = t < 0.3 ? t / 0.3 : t < 0.45 ? 1 : Math.max(0, 1 - (t - 0.45) / 0.25);
      const lunge = t < 0.4 ? 0 : t < 0.5 ? (t - 0.4) / 0.1 : t < 0.85 ? 1 : 1 - (t - 0.85) / 0.15;
      return {
        head: { rx: -0.6 * rear + 0.45 * lunge, pz: 0.2 * lunge },
        torso: { rx: -0.15 * rear + 0.1 * lunge, py: 0.08 * rear },
        armL: { rz: 0.5 * rear + 0.2 * lunge, rx: -0.2 * rear },
        armR: { rz: -0.5 * rear - 0.2 * lunge, rx: -0.2 * rear },
        back: { ry: 0.3 * rear },
      };
    },
  },
  strike: {
    loop: false,
    duration: 0.5,
    pose: (t) => {
      const k = sin(Math.min(1, t) * Math.PI);
      return { head: { rx: 0.5 * k, pz: 0.25 * k }, torso: { rx: 0.1 * k }, armL: { rz: 0.3 * k }, armR: { rz: -0.3 * k } };
    },
  },
  hit: {
    loop: false,
    duration: 0.35,
    pose: (t) => {
      const k = sin(Math.min(1, t) * Math.PI);
      return { head: { rx: -0.3 * k }, torso: { rx: -0.08 * k }, armL: { rz: 0.25 * k }, armR: { rz: -0.25 * k } };
    },
  },
};

const SLEEP_CLIPS: Partial<Record<ClipName, Clip>> = {
  idle: {
    loop: true,
    duration: 5,
    pose: (_t, time) => ({
      torso: { sy: 1 + sin(time * 0.9) * 0.03 },
      head: { ry: sin(time * 0.3) * 0.04, rx: sin(time * 0.9) * 0.02 },
      armL: { rz: sin(time * 0.9) * 0.03 },
      armR: { rz: -sin(time * 0.9) * 0.03 },
      back: { ry: sin(time * 0.5) * 0.1 },
    }),
  },
  hit: { loop: false, duration: 0.4, pose: (t) => ({ head: { rx: -0.3 * sin(t * Math.PI) }, torso: { py: 0.05 * sin(t * Math.PI) } }) },
};

export function makeDragon(asleep: boolean, mats: RigMaterials): RigFigure {
  const { k, rest } = asleep ? sleepKit() : awakeKit();
  return new RigFigure(k, { rest, height: asleep ? 2.0 : 4.2, radius: asleep ? 1.4 : 1.3, clips: asleep ? SLEEP_CLIPS : AWAKE_CLIPS }, mats);
}
