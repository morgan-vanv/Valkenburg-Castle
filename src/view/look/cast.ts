// V5.0 (G, W3): the cast on the joint rig. One parametric humanoid (hats, weapons, shields, packs, capes,
// robes, a hunch) covers Keven, the eight classes, the orcs, archers, cutpurses, ghouls, the Lantern Sisters,
// the crews in their colours and the prisoner. Rats, the spider and the Gloam have their own small builders.
// The Dragon keeps its V3 model until it gets its own rig.
//
// `makeRigFigure(key)` returns null for any key not built here, and UnitView falls back to the old model.

import * as THREE from 'three';
import type { ModelKey } from '../figures';
import { COLORS } from '../world';
import { HUMANOID_CLIPS, idle, walk } from './clips';
import { HEAD_SHARE, humanoidBody, humanoidDims, humanoidRest, type HumanoidLook } from './keven';
import { JointKit, RigFigure, type Clip, type ClipName, type RigMaterials, type RigSpec } from './rig';
import { makeDragon } from './dragon';

export type Hat = 'none' | 'crown' | 'kettle' | 'great' | 'hood' | 'hat' | 'horned' | 'band';
export type Weapon = 'none' | 'sword' | 'daggers' | 'staff' | 'bow' | 'hammer' | 'axe' | 'spear' | 'club' | 'claws';

export interface HumanoidSpec extends HumanoidLook {
  /** Height to the top of the bare head (world units). Heroes 1.35. */
  height?: number;
  head?: number;
  /** Shoulder width multiplier (orcs 1.25). */
  wide?: number;
  /** Forward lean of the torso, radians. */
  hunch?: number;
  hat?: Hat;
  hatColor?: number;
  weapon?: Weapon;
  /** Glow on a staff tip. */
  glow?: number;
  shield?: number;
  pauldrons?: number;
  /** Backpack and bedroll (the FTK signature); heroes and crews carry them. */
  pack?: boolean;
  /** A short mantle over the shoulders. */
  cape?: number;
  /** A robe skirt over the legs. */
  robe?: number;
  /** A lantern in the left hand (the Sisters). */
  lantern?: boolean;
  /** A crew's trim colour (a sash). */
  sash?: number;
  /** A bulky pack of charges with fuses (the Sapper). */
  charges?: boolean;
  /** Tusks (orcs). */
  tusks?: boolean;
  /** A ragged, bare look (the prisoner, ghouls): no boots, torn hem. */
  ragged?: boolean;
  /** A crest of hair (the berserker). */
  mohawk?: number;
  radius?: number;
}

/** Build a humanoid on the rig from a spec. */
export function humanoidFigure(spec: HumanoidSpec, mats: RigMaterials): RigFigure {
  const d = humanoidDims(spec.height ?? 1.35, spec.head ?? HEAD_SHARE);
  if (spec.wide) d.W *= spec.wide;
  const { hs, torsoH, W, H } = d;
  const k = new JointKit();
  humanoidBody(k, d, { ...spec, boots: spec.ragged ? spec.legs : spec.boots });
  // Pauldrons.
  if (spec.pauldrons !== undefined) for (const s of [-1, 1]) k.ball('torso', W * 0.19, spec.pauldrons, [s * W * 0.5, torsoH * 0.95, 0], 0, [1.1, 0.75, 1], 'metal');
  if (spec.sash !== undefined) k.box('torso', W * 0.16, torsoH * 0.95, W * 0.08, spec.sash, [W * 0.1, torsoH * 0.5, W * 0.36], [0, 0, 0.35]);
  // Hats, built from the top of the head.
  const top = hs;
  const hc = spec.hatColor ?? 0x3b2a1c;
  switch (spec.hat ?? 'none') {
    case 'crown':
      k.cyl('head', hs * 0.42, hs * 0.42, hs * 0.18, 8, COLORS.gold, [0, top - hs * 0.04, 0], undefined, undefined, 'metal');
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        k.cone('head', hs * 0.07, hs * 0.2, 4, COLORS.gold, [Math.sin(a) * hs * 0.38, top + hs * 0.14, Math.cos(a) * hs * 0.38], undefined, undefined, 'metal');
      }
      break;
    case 'kettle':
      k.cyl('head', hs * 0.62, hs * 0.62, hs * 0.06, 8, hc, [0, top - hs * 0.14, 0], undefined, undefined, 'metal');
      k.ball('head', hs * 0.5, hc, [0, top - hs * 0.16, 0], 1, [1.02, 0.6, 1.02], 'metal');
      break;
    case 'great':
      k.ball('head', hs * 0.56, hc, [0, top - hs * 0.36, 0], 1, [1.06, 1.0, 1.06], 'metal');
      k.box('head', hs * 0.3, hs * 0.12, 0.02, 0x101010, [0, top - hs * 0.42, hs * 0.55], undefined, 'glow');
      break;
    case 'hood':
      k.cone('head', hs * 0.64, hs * 1.0, 6, hc, [0, top - hs * 0.14, -hs * 0.06], [-0.18, 0, 0]);
      break;
    case 'hat':
      k.cyl('head', hs * 0.88, hs * 0.88, hs * 0.07, 10, hc, [0, top - hs * 0.1, 0]);
      k.cone('head', hs * 0.48, hs * 1.15, 7, hc, [0, top + hs * 0.46, -hs * 0.05], [-0.25, 0, 0.1]);
      break;
    case 'horned':
      k.ball('head', hs * 0.56, 0x8d9095, [0, top - hs * 0.34, 0], 1, [1.04, 0.62, 1.04], 'metal');
      for (const s of [-1, 1]) k.cone('head', hs * 0.14, hs * 0.55, 5, 0xefe4cf, [s * hs * 0.55, top + hs * 0.05, 0], [0, 0, -s * 0.9]);
      break;
    case 'band':
      k.cyl('head', hs * 0.54, hs * 0.54, hs * 0.1, 8, hc, [0, top - hs * 0.3, 0]);
      break;
  }
  if (spec.tusks) for (const s of [-1, 1]) k.cone('head', hs * 0.06, hs * 0.22, 4, 0xe8dcc0, [s * hs * 0.2, hs * 0.3, hs * 0.45]);
  // Robe: a skirt from the hips.
  if (spec.robe !== undefined) k.cone('hips', W * 0.62, d.legH + 0.04, 7, spec.robe, [0, -(d.legH + 0.04) / 2 + 0.02, 0]);
  if (spec.ragged) k.cone('hips', W * 0.5, d.legH * 0.6, 6, spec.tunic, [0, -d.legH * 0.3, 0]);
  // Back: pack and bedroll, charges, cape.
  if (spec.pack) {
    k.box('back', W * 0.66, torsoH * 0.62, W * 0.3, 0x7a4a2a, [0, -torsoH * 0.05, -W * 0.08]);
    k.cyl('back', W * 0.16, W * 0.16, W * 0.9, 8, 0xd8cfbe, [0, torsoH * 0.33, -W * 0.1], [0, 0, Math.PI / 2]);
  }
  if (spec.charges) {
    k.box('back', W * 0.7, torsoH * 0.6, W * 0.36, 0x5a4024, [0, -torsoH * 0.02, -W * 0.1]);
    for (const x of [-W * 0.18, W * 0.18]) k.cyl('back', W * 0.11, W * 0.11, torsoH * 0.36, 6, 0xb03a2e, [x, torsoH * 0.4, -W * 0.1]);
    k.cyl('back', 0.012, 0.012, torsoH * 0.3, 4, 0xefe4cf, [W * 0.2, torsoH * 0.7, -W * 0.1], [0.3, 0, 0.3]);
  }
  if (spec.cape !== undefined) k.box('back', W * 0.98, torsoH * 0.42, 0.035, spec.cape, [0, torsoH * 0.24, W * 0.02], [0.1, 0, 0]);
  // Weapons in the right hand.
  const metal = 0xc8ccd2;
  switch (spec.weapon ?? 'none') {
    case 'sword':
      k.box('handR', 0.05, H * 0.5, 0.022, metal, [0, H * 0.27, 0.05], undefined, 'metal');
      k.box('handR', W * 0.36, 0.035, 0.06, 0x3b3a3d, [0, 0.035, 0.05], undefined, 'metal');
      k.cyl('handR', 0.022, 0.022, 0.1, 5, 0x3d2615, [0, -0.06, 0.05]);
      break;
    case 'daggers':
      k.box('handR', 0.035, H * 0.22, 0.018, metal, [0, H * 0.1, 0.05], [0.3, 0, 0], 'metal');
      k.box('handL', 0.035, H * 0.22, 0.018, metal, [0, H * 0.1, 0.05], [0.3, 0, 0], 'metal');
      break;
    case 'staff':
      k.cyl('handR', 0.028, 0.028, H * 1.05, 5, 0x6b4426, [0, H * 0.3, 0.02]);
      if (spec.glow !== undefined) k.ball('handR', 0.085, spec.glow, [0, H * 0.82, 0.02], 0, undefined, 'glow');
      break;
    case 'bow': {
      // A tall bow arc held in the left hand, the quiver on the back.
      const arc = new THREE.TorusGeometry(H * 0.36, 0.022, 5, 10, Math.PI * 1.1);
      k.add('handL', arc, 0x6b4426, [0, H * 0.1, 0.03], [0, Math.PI / 2, Math.PI * 0.95]);
      k.box('handL', 0.012, H * 0.66, 0.008, 0xd8cfbe, [0, H * 0.1, 0.03]);
      k.cyl('back', W * 0.11, W * 0.11, torsoH * 0.6, 6, 0x5a3a1c, [-W * 0.3, torsoH * 0.1, -W * 0.05], [0, 0, 0.35]);
      for (const x of [-0.03, 0.03]) k.cone('back', 0.02, 0.06, 3, 0xd8cfbe, [-W * 0.3 + x - torsoH * 0.12, torsoH * 0.46, -W * 0.05]);
      break;
    }
    case 'hammer':
      k.cyl('handR', 0.03, 0.03, H * 0.5, 5, 0x6b4426, [0, H * 0.12, 0.03]);
      k.box('handR', W * 0.28, W * 0.2, W * 0.2, 0x55585e, [0, H * 0.34, 0.03], undefined, 'metal');
      break;
    case 'axe':
      k.cyl('handR', 0.03, 0.03, H * 0.62, 5, 0x6b4426, [0, H * 0.14, 0.03]);
      k.box('handR', 0.05, H * 0.2, H * 0.2, 0x8d9095, [0, H * 0.38, 0.03 + H * 0.08], undefined, 'metal');
      break;
    case 'spear':
      k.cyl('handR', 0.022, 0.022, H * 1.2, 5, 0x6b4426, [0, H * 0.35, 0.03]);
      k.cone('handR', 0.04, 0.16, 4, metal, [0, H * 1.0, 0.03], undefined, undefined, 'metal');
      break;
    case 'club':
      k.cyl('handR', 0.06, 0.03, H * 0.5, 6, 0x5a3a1c, [0, H * 0.12, 0.03]);
      break;
    case 'claws':
      for (const j of ['handR', 'handL'] as const) for (const x of [-0.03, 0, 0.03]) k.cone(j, 0.012, 0.09, 3, 0xe8dcc0, [x, -0.06, 0.04], [Math.PI, 0, 0]);
      break;
  }
  if (spec.shield !== undefined) {
    k.cyl('armL', W * 0.42, W * 0.42, 0.05, 8, spec.shield, [-W * 0.2, -torsoH * 0.45, 0.06], [0, 0.5, Math.PI / 2], undefined, 'metal');
    k.ball('armL', W * 0.1, COLORS.gold, [-W * 0.23, -torsoH * 0.45, 0.06], 0, undefined, 'metal');
  }
  if (spec.lantern) {
    // The Sisters' lantern: a hooded iron frame hanging low from the left hand, its flame a glow.
    k.cyl('handL', 0.02, 0.02, 0.22, 4, 0x2a2420, [0, -0.12, 0.06]);
    k.box('handL', 0.2, 0.26, 0.2, 0x2a2420, [0, -0.36, 0.06]);
    k.cone('handL', 0.16, 0.1, 6, 0x2a2420, [0, -0.2, 0.06]);
    k.box('handL', 0.13, 0.18, 0.13, 0xffd27a, [0, -0.36, 0.06], undefined, 'glow');
  }
  if (spec.mohawk !== undefined) k.box('head', hs * 0.16, hs * 0.36, hs * 0.9, spec.mohawk, [0, hs * 0.98, -hs * 0.05]);
  const hunch = spec.hunch ?? 0;
  // Only bows shoot and only staves cast; the others fall back to a swing or a gesture (UnitView.playClip).
  const clips: Partial<Record<ClipName, Clip>> = { ...HUMANOID_CLIPS };
  if (spec.weapon !== 'bow') delete clips.shoot;
  if (spec.weapon !== 'staff') delete clips.cast;
  const rig: RigSpec = {
    rest: humanoidRest(d),
    restRot: hunch ? { torso: [hunch, 0, 0], head: [-hunch * 0.7, 0, 0] } : undefined,
    height: H + hs * (spec.hat === 'hat' ? 1.0 : spec.hat === 'hood' ? 0.3 : spec.hat === 'crown' || spec.hat === 'horned' ? 0.3 : 0.1),
    radius: spec.radius ?? 0.32 * (spec.wide ?? 1),
    clips,
  };
  return new RigFigure(k, rig, mats);
}

const SKIN = 0xe0b48a;
const PACK = true;

/** Hero classes (and crew members of the same classes, in crew colours). */
function classSpec(cls: string, c?: { tunic: number; legs: number; cape: number; hood: number; trim: number; skin: number; eyes?: number }): HumanoidSpec {
  const skin = c?.skin ?? SKIN;
  switch (cls) {
    case 'heir':
      return { skin, tunic: 0x6f7378, legs: 0x3d3f44, beard: 0x7a4a2a, hat: 'crown', weapon: 'sword', shield: COLORS.gold, pauldrons: COLORS.steel, cape: 0x7a1414, pack: PACK };
    case 'sellsword':
      return { skin, tunic: c?.tunic ?? 0x7d2a22, legs: c?.legs ?? 0x3a2e24, hat: 'kettle', hatColor: c?.hood ?? 0x55585e, weapon: 'sword', shield: c ? c.trim : 0x5a3a1c, pauldrons: COLORS.steelDark, wide: 1.12, pack: PACK, sash: c?.trim };
    case 'burglar':
      return { skin, tunic: c?.tunic ?? 0x2f3a2a, legs: c?.legs ?? 0x22261f, hat: 'hood', hatColor: c?.hood ?? 0x2c3a28, weapon: 'daggers', cape: c?.cape ?? 0x1f2a1c, pack: PACK, eyes: c?.eyes };
    case 'mage':
      return { skin, tunic: 0x3b2659, legs: 0x3b2659, hat: 'hat', hatColor: 0x2d1d45, weapon: 'staff', glow: 0xffb35c, beard: 0xd6d0c4, robe: 0x3b2659, pack: PACK };
    case 'ranger':
      return { skin, tunic: c?.tunic ?? 0x4a5a2a, legs: c?.legs ?? 0x3a3424, hat: 'hood', hatColor: c?.hood ?? 0x3f5a26, weapon: 'bow', cape: c?.cape ?? 0x33461c, pack: PACK, eyes: c?.eyes };
    case 'sapper':
      return { skin, tunic: c?.tunic ?? 0x8a5a2a, legs: c?.legs ?? 0x3a2e24, hat: 'kettle', hatColor: c?.hood ?? 0x6a5a3a, weapon: 'hammer', wide: 1.15, beard: c ? undefined : 0x7a4a22, charges: true, sash: c?.trim, eyes: c?.eyes };
    case 'pyromancer':
      return { skin, tunic: c?.tunic ?? 0x8a2416, legs: c?.legs ?? 0x5a160e, hat: 'hat', hatColor: c?.hood ?? 0x5a160e, weapon: 'staff', glow: 0xff6a1a, robe: c?.tunic ?? 0x8a2416, pack: PACK, eyes: c?.eyes };
    case 'shadowmancer':
      return { skin: c?.skin ?? 0xa89aa8, tunic: c?.tunic ?? 0x241a3a, legs: c?.legs ?? 0x1a1428, hat: 'hood', hatColor: c?.hood ?? 0x1a1428, weapon: 'staff', glow: 0x9a6aff, cape: c?.cape ?? 0x120c1e, robe: c?.tunic ?? 0x241a3a, eyes: c?.eyes ?? 0xb08aff, pack: PACK };
    case 'hedgewitch':
      return { skin, tunic: c?.tunic ?? 0x2e5a3e, legs: c?.legs ?? 0x22402c, hat: 'hat', hatColor: c?.hood ?? 0x5a4a2a, weapon: 'staff', glow: 0x8affb0, robe: c?.tunic ?? 0x2e5a3e, pack: PACK, eyes: c?.eyes };
  }
  return { skin, tunic: 0x6f7378, legs: 0x3d3f44, pack: PACK };
}

/** Crew colours (figures.ts CREW_LOOK). */
const CREW_LOOK: Record<string, { tunic: number; legs: number; cape: number; hood: number; trim: number; skin: number; eyes?: number }> = {
  ferrymen: { tunic: 0x4f6272, legs: 0x2e3a44, cape: 0x6f8798, hood: 0x3e505e, trim: 0xa8bccb, skin: 0xc79a76 },
  'gallows-choir': { tunic: 0x1c1a1a, legs: 0x121111, cape: 0x0c0b0b, hood: 0x161414, trim: 0xe0d6be, skin: 0xd9d0bb, eyes: 0x2a0a0a },
  'the-wake': { tunic: 0x1f3d2a, legs: 0x15281c, cape: 0x2a5238, hood: 0x1a3324, trim: 0xe6dcc4, skin: 0xcfc6ae, eyes: 0x0a1a10 },
};
/** The Lantern Sisters: grey-blue habits, a lantern in hand. */
const SISTER = { tunic: 0x6a7488, legs: 0x3a4454, cape: 0x8a94a8, hood: 0x4a5468, trim: 0xe8dcc0, skin: 0xd9b89a };

// ------------------------------------------------------------ beasts

const ORC_SKIN = 0x5a7a3a;

function rats(mats: RigMaterials): RigFigure {
  // A pack of three rats on the root joint: bodies, heads, tails, red eyes. Idle twitch, a scurry when walking.
  const k = new JointKit();
  const s = 0.34;
  const spots: [number, number, number][] = [
    [0, 0, 0.15],
    [-0.3, 0, -0.15],
    [0.32, 0, -0.1],
  ];
  spots.forEach(([x, , z], i) => {
    const a = i * 2.1;
    const fwd: [number, number, number] = [Math.sin(a) * 0.2, 0, Math.cos(a) * 0.2];
    k.ball('root', s * 0.5, 0x2a2420, [x, s * 0.42, z], 1, [1, 0.8, 1.5]);
    k.ball('root', s * 0.28, 0x2a2420, [x + fwd[0] * 1.6, s * 0.42, z + fwd[2] * 1.6], 0, [1, 0.9, 1.3]);
    k.cyl('root', 0.012, 0.03, s * 1.2, 4, 0x8a6a5a, [x - fwd[0] * 2.6, s * 0.3, z - fwd[2] * 2.6], [Math.PI / 2 + 0.3, a, 0]);
    for (const e of [-1, 1]) k.ball('root', 0.025, 0xff3b30, [x + fwd[0] * 1.9 + e * 0.05 * Math.cos(a), s * 0.5, z + fwd[2] * 1.9 - e * 0.05 * Math.sin(a)], 0, undefined, 'glow');
  });
  const clips: Partial<Record<ClipName, Clip>> = {
    idle: { loop: true, duration: 2, pose: (_t, time) => ({ root: { ry: Math.sin(time * 3) * 0.05, py: Math.abs(Math.sin(time * 9)) * 0.004 } }) },
    walk: { loop: true, duration: 0.3, pose: (t) => ({ root: { py: Math.abs(Math.sin(t * Math.PI * 2)) * 0.05, rz: Math.sin(t * Math.PI * 2) * 0.1 } }) },
    hit: { loop: false, duration: 0.3, pose: (t) => ({ root: { py: Math.sin(t * Math.PI) * 0.12 } }) },
  };
  const rest = humanoidRest(humanoidDims(1));
  return new RigFigure(k, { rest, height: s * 1.1, radius: 0.5, clips }, mats);
}

function spider(mats: RigMaterials): RigFigure {
  const k = new JointKit();
  const s = 0.42;
  // Abdomen on the back joint, head on the torso, legs on the arm joints (four a side, splayed).
  k.ball('torso', s * 0.55, 0x1c1a20, [0, 0, -s * 0.6], 1, [1, 0.8, 1.2]);
  k.ball('torso', s * 0.32, 0x26222a, [0, 0, s * 0.3], 1);
  k.ball('torso', s * 0.12, 0xb3141e, [0, s * 0.42, -s * 0.6], 0, undefined, 'glow');
  for (const e of [-1, 1]) k.ball('torso', s * 0.05, 0xff3b30, [e * s * 0.1, s * 0.1, s * 0.58], 0, undefined, 'glow');
  for (let i = 0; i < 4; i++) for (const e of [-1, 1]) {
    const joint = e < 0 ? 'armL' : 'armR';
    const z = s * (0.35 - i * 0.3);
    k.box(joint, s * 1.1, s * 0.07, s * 0.07, 0x1c1a20, [e * s * 0.55, 0, z], [0, e * (i - 1.5) * 0.3, e * -0.5]);
    k.box(joint, s * 0.7, s * 0.06, s * 0.06, 0x1c1a20, [e * s * 1.2, -s * 0.3, z], [0, e * (i - 1.5) * 0.3, e * 0.9]);
  }
  const rest = humanoidRest(humanoidDims(1));
  rest.hips = [0, s * 0.75, 0];
  rest.torso = [0, 0, 0];
  rest.armL = [0, 0, 0];
  rest.armR = [0, 0, 0];
  const clips: Partial<Record<ClipName, Clip>> = {
    idle: { loop: true, duration: 2, pose: (_t, time) => ({ torso: { ry: Math.sin(time * 1.3) * 0.06, py: Math.sin(time * 2.4) * 0.01 }, armL: { rz: Math.sin(time * 2.4) * 0.03 }, armR: { rz: -Math.sin(time * 2.4) * 0.03 } }) },
    walk: { loop: true, duration: 0.36, pose: (t) => ({ armL: { rx: Math.sin(t * Math.PI * 2) * 0.25 }, armR: { rx: -Math.sin(t * Math.PI * 2) * 0.25 }, hips: { py: Math.abs(Math.sin(t * Math.PI * 4)) * 0.03 } }) },
    strike: { loop: false, duration: 0.4, pose: (t) => ({ torso: { rx: -Math.sin(t * Math.PI) * 0.5, py: Math.sin(t * Math.PI) * 0.15 } }) },
    hit: { loop: false, duration: 0.3, pose: (t) => ({ hips: { py: -Math.sin(t * Math.PI) * 0.1 } }) },
  };
  return new RigFigure(k, { rest, height: s * 1.4, radius: 0.55, clips }, mats);
}

function gloam(mats: RigMaterials): RigFigure {
  // A hooded shade: a tall tattered cone with no legs, two pale eyes, floating. Idle drifts.
  const k = new JointKit();
  const H = 1.5;
  k.cone('torso', 0.42, H * 0.9, 7, 0x0c0a12, [0, H * 0.3, 0]);
  k.cone('torso', 0.3, H * 0.5, 6, 0x0c0a12, [0, H * 0.78, -0.02], [Math.PI, 0, 0]);
  k.ball('head', 0.24, 0x14101c, [0, 0.1, 0], 1);
  for (const e of [-1, 1]) k.ball('head', 0.045, 0xc8d8ff, [e * 0.1, 0.12, 0.2], 0, undefined, 'glow');
  for (const e of [-1, 1]) k.box(e < 0 ? 'armL' : 'armR', 0.1, H * 0.45, 0.1, 0x0c0a12, [0, -H * 0.2, 0], [0, 0, e * 0.15]);
  const rest = humanoidRest(humanoidDims(H));
  rest.hips = [0, 0.3, 0];
  rest.torso = [0, 0, 0];
  rest.head = [0, H * 0.9, 0];
  rest.armL = [-0.3, H * 0.65, 0];
  rest.armR = [0.3, H * 0.65, 0];
  const clips: Partial<Record<ClipName, Clip>> = {
    idle: { loop: true, duration: 3, pose: (_t, time) => ({ root: { py: Math.sin(time * 1.6) * 0.06 }, torso: { ry: Math.sin(time * 0.7) * 0.1, rz: Math.sin(time * 0.9) * 0.04 }, armL: { rx: Math.sin(time * 1.1) * 0.15 - 0.3 }, armR: { rx: Math.sin(time * 1.3 + 1) * 0.15 - 0.3 } }) },
    walk: { loop: true, duration: 0.9, pose: (t, time) => ({ root: { py: Math.sin(time * 1.6) * 0.06 }, torso: { rx: 0.15 }, armL: { rx: -0.6 + Math.sin(t * Math.PI * 2) * 0.1 }, armR: { rx: -0.6 } }) },
    strike: { loop: false, duration: 0.45, pose: (t) => ({ armL: { rx: -1.4 * Math.sin(t * Math.PI) }, armR: { rx: -1.4 * Math.sin(t * Math.PI) }, torso: { rx: 0.3 * Math.sin(t * Math.PI) } }) },
    hit: { loop: false, duration: 0.3, pose: (t) => ({ torso: { rx: -0.3 * Math.sin(t * Math.PI) } }) },
  };
  return new RigFigure(k, { rest, height: H + 0.2, radius: 0.36, clips }, mats);
}

// ------------------------------------------------------------ the registry

export function makeRigFigure(key: ModelKey, mats: RigMaterials): RigFigure | null {
  if (key.startsWith('rival-')) {
    const [, crew, cls] = key.split('-') as [string, string, string];
    const c = CREW_LOOK[crew];
    if (!c) return null;
    return humanoidFigure({ ...classSpec(cls, c), height: 1.32, pack: true }, mats);
  }
  switch (key) {
    case 'heir':
    case 'sellsword':
    case 'burglar':
    case 'mage':
    case 'ranger':
    case 'sapper':
    case 'pyromancer':
    case 'shadowmancer':
    case 'hedgewitch':
      return humanoidFigure(classSpec(key), mats);
    case 'sister':
      return humanoidFigure({ skin: SISTER.skin, tunic: SISTER.tunic, legs: SISTER.legs, hat: 'hood', hatColor: SISTER.hood, weapon: 'sword', robe: SISTER.tunic, lantern: true, height: 1.32, sash: SISTER.trim, pack: true }, mats);
    case 'sisterRanger':
      return humanoidFigure({ ...classSpec('ranger', { ...SISTER }), height: 1.32, robe: SISTER.tunic, sash: SISTER.trim }, mats);
    case 'sisterShadow':
      return humanoidFigure({ ...classSpec('shadowmancer', { ...SISTER, eyes: 0xb08aff }), height: 1.32, lantern: true, sash: SISTER.trim }, mats);
    case 'sisterBurglar':
      return humanoidFigure({ ...classSpec('burglar', { ...SISTER }), height: 1.32, lantern: true, robe: SISTER.tunic, sash: SISTER.trim }, mats);
    case 'orc':
      return humanoidFigure({ skin: ORC_SKIN, tunic: 0x5a4030, legs: 0x2a2620, hat: 'band', hatColor: 0x8a2a2a, weapon: 'axe', pauldrons: 0x4a3a2a, wide: 1.25, height: 1.45, head: 0.3, hunch: 0.25, tusks: true, eyes: 0xffd060, radius: 0.4 }, mats);
    case 'captain':
      return humanoidFigure({ skin: ORC_SKIN, tunic: 0x3a2a2a, legs: 0x2a2620, hat: 'horned', weapon: 'sword', shield: 0x5a1a1a, pauldrons: 0x55585e, wide: 1.25, height: 1.5, head: 0.3, hunch: 0.15, tusks: true, eyes: 0xffd060, cape: 0x5a1a1a, radius: 0.4 }, mats);
    case 'berserker':
      return humanoidFigure({ skin: 0x6a8a4a, tunic: 0x6a8a4a, legs: 0x3a2a1a, hat: 'none', mohawk: 0xb03a2e, weapon: 'club', wide: 1.4, height: 1.65, head: 0.28, hunch: 0.3, tusks: true, eyes: 0xff6040, sash: 0x8a2a2a, radius: 0.45 }, mats);
    case 'archer':
      return humanoidFigure({ skin: ORC_SKIN, tunic: 0x3a4a2a, legs: 0x2a2620, hat: 'band', hatColor: 0x2a2a1a, weapon: 'bow', height: 1.35, head: 0.3, tusks: true, eyes: 0xffd060 }, mats);
    case 'cutpurse':
      return humanoidFigure({ skin: 0xc79a76, tunic: 0x3a3030, legs: 0x242020, hat: 'hood', hatColor: 0x2a2424, weapon: 'daggers', height: 1.28, cape: 0x1e1a1a }, mats);
    case 'ghoul':
      return humanoidFigure({ skin: 0x9aa08a, tunic: 0x4a4a3a, legs: 0x4a4a3a, hat: 'none', weapon: 'claws', height: 1.35, head: 0.3, hunch: 0.5, ragged: true, eyes: 0xd0ff80 }, mats);
    case 'prisoner':
      return humanoidFigure({ skin: 0xd9b89a, tunic: 0x8a7a6a, legs: 0x6a5a4a, hat: 'none', weapon: 'none', height: 1.28, ragged: true, hair: 0x5a4030 }, mats);
    case 'rats':
      return rats(mats);
    case 'spider':
      return spider(mats);
    case 'gloam':
      return gloam(mats);
    case 'dragon':
      return makeDragon(false, mats);
    case 'dragonSleep':
      return makeDragon(true, mats);
    default:
      return null;
  }
}

export { idle as idleClip, walk as walkClip };
