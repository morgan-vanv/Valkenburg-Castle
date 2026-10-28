// V5.0 (G): keyframed joint clips for the code-built figures, as functions of phase.
//
// Rotations are radians about the joint; x pitches forward (a positive leg rx swings the leg forward),
// y turns, z tilts. Loops take a phase 0..1 per cycle and the view time (for breathing); one-shots
// take 0..1 once. W0 ships the humanoid set Keven needs: idle, walk, sneak, sneakWalk, strike, hit.
// W3 adds shoot, cast, use, downed, carried, carrying and the monsters' own.

import type { Clip, ClipName, Pose } from './rig';

const TAU = Math.PI * 2;
const sin = Math.sin;
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export const idle: Clip = {
  loop: true,
  duration: 4,
  pose: (_t, time) => ({
    torso: { sy: 1 + sin(time * 2.2) * 0.012, rx: sin(time * 1.1) * 0.012 },
    head: { rx: sin(time * 0.9) * 0.035, ry: sin(time * 0.37) * 0.08 },
    armL: { rz: 0.06 + sin(time * 1.3) * 0.02, rx: sin(time * 1.7) * 0.02 },
    armR: { rz: -0.04 + sin(time * 1.1 + 1) * 0.02 },
  }),
};

function walkPose(t: number, amp: number): Pose {
  const s = sin(t * TAU);
  const s2 = Math.abs(sin(t * TAU));
  return {
    hips: { py: s2 * 0.035 * amp, ry: s * 0.06 * amp },
    torso: { ry: -s * 0.08 * amp, rx: 0.04 * amp },
    head: { ry: s * 0.03 * amp, rx: -0.03 * amp },
    legL: { rx: s * 0.62 * amp },
    legR: { rx: -s * 0.62 * amp },
    armL: { rx: -s * 0.4 * amp, rz: 0.06 },
    armR: { rx: s * 0.22 * amp, rz: -0.04 },
  };
}

export const walk: Clip = {
  loop: true,
  duration: 0.55,
  pose: (t) => walkPose(t, 1),
};

const CROUCH: Pose = {
  hips: { py: -0.11, rx: 0.1 },
  torso: { rx: 0.42 },
  head: { rx: -0.3 },
  legL: { rx: 0.3, rz: 0.04 },
  legR: { rx: -0.2, rz: -0.04 },
  armL: { rx: -0.35, rz: 0.12 },
  armR: { rx: -0.3, rz: -0.08 },
};

function merge(a: Pose, b: Pose): Pose {
  const out: Pose = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof Pose>) {
    const pa = a[k] ?? {};
    const pb = b[k] ?? {};
    out[k] = {
      rx: (pa.rx ?? 0) + (pb.rx ?? 0),
      ry: (pa.ry ?? 0) + (pb.ry ?? 0),
      rz: (pa.rz ?? 0) + (pb.rz ?? 0),
      px: (pa.px ?? 0) + (pb.px ?? 0),
      py: (pa.py ?? 0) + (pb.py ?? 0),
      pz: (pa.pz ?? 0) + (pb.pz ?? 0),
      sy: (pa.sy ?? 1) * (pb.sy ?? 1),
    };
  }
  return out;
}

export const sneak: Clip = {
  loop: true,
  duration: 4,
  pose: (_t, time) => merge(CROUCH, { torso: { sy: 1 + sin(time * 2.6) * 0.01 }, head: { ry: sin(time * 0.5) * 0.15 } }),
};

export const sneakWalk: Clip = {
  loop: true,
  duration: 0.7,
  pose: (t) => merge(CROUCH, walkPose(t, 0.55)),
};

/** A sword strike: wind up, swing through, settle. One shot, 0.5 s. */
export const strike: Clip = {
  loop: false,
  duration: 0.5,
  pose: (t) => {
    const wind = t < 0.3 ? ease(t / 0.3) : 1;
    const swing = t < 0.3 ? 0 : t < 0.55 ? ease((t - 0.3) / 0.25) : 1;
    const settle = t < 0.55 ? 0 : ease((t - 0.55) / 0.45);
    const arm = -1.1 * wind + 2.4 * swing - 1.3 * settle;
    return {
      armR: { rx: arm, rz: -0.2 * (1 - settle) },
      handR: { rx: 0.3 * swing * (1 - settle) },
      torso: { ry: 0.35 * wind - 0.75 * swing + 0.4 * settle, rx: 0.12 * swing * (1 - settle) },
      hips: { ry: 0.12 * wind - 0.25 * swing + 0.13 * settle },
      legL: { rx: 0.25 * swing * (1 - settle) },
      legR: { rx: -0.2 * swing * (1 - settle) },
      head: { ry: -0.15 * wind + 0.3 * swing - 0.15 * settle },
    };
  },
};

/** Taking a blow: a flinch back and a recover. One shot, 0.35 s. */
export const hit: Clip = {
  loop: false,
  duration: 0.35,
  pose: (t) => {
    const k = sin(Math.min(1, t) * Math.PI);
    return {
      torso: { rx: -0.3 * k },
      head: { rx: -0.25 * k },
      hips: { py: -0.03 * k },
      armL: { rx: -0.4 * k, rz: 0.3 * k },
      armR: { rx: -0.3 * k },
    };
  },
};

export const HUMANOID_CLIPS: Partial<Record<ClipName, Clip>> = { idle, walk, sneak, sneakWalk, strike, hit };
