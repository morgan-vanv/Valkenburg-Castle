// V5.0 (G): the figure interface and the code-built joint rig (docs/v5-graphics-plan.md, "Figures").
//
// The artist seam. `Figure` is what the view talks to: an object to put in the scene, named joints, named
// clips, a height and a footprint. `RigFigure` builds one from flat-shaded parts parented to joints and
// plays keyframed clips written in code (look/clips.ts). A future glTF model implements the same interface
// with its own skeleton and AnimationClips (a `GltfFigure` would wrap an AnimationMixer); UnitView and the
// diorama never see the difference.
//
// Joints: root → hips → torso → head; hips → legL, legR; torso → armL → handL, armR → handR; torso → back.
// Parts are merged per joint and per material (body, metal, glow), so a figure is a dozen draw calls.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type JointName = 'root' | 'hips' | 'torso' | 'head' | 'armL' | 'armR' | 'handL' | 'handR' | 'legL' | 'legR' | 'back';
export const JOINTS: readonly JointName[] = ['root', 'hips', 'torso', 'head', 'armL', 'armR', 'handL', 'handR', 'legL', 'legR', 'back'];

export type ClipName = 'idle' | 'walk' | 'sneak' | 'sneakWalk' | 'strike' | 'shoot' | 'cast' | 'use' | 'hit' | 'downed' | 'carried' | 'carrying';

/** Which hand or back a piece of gear hangs from. */
export type GearSlot = 'handR' | 'handL' | 'back' | 'head';

export interface Figure {
  /** Put this in the scene; its origin is between the feet on the floor. */
  readonly object: THREE.Object3D;
  readonly joints: Readonly<Record<JointName, THREE.Object3D>>;
  /** Height to the top of the head or hat, world units. */
  readonly height: number;
  /** Footprint radius, world units (fanning, rings). */
  readonly radius: number;
  readonly clips: ReadonlySet<ClipName>;
  /** Play a clip; loops loop, one-shots return to the last loop when done. `fade` in seconds. */
  play(name: ClipName, opts?: { fade?: number; speed?: number }): void;
  /** The clip currently driving the pose. */
  current(): ClipName;
  /** Advance the animation. `time` is the view clock (so the speed setting scales it). */
  update(time: number, dt: number): void;
  /** Hang gear on a joint (a weapon in handR, a shield on armL, a pack on back). */
  attach(slot: GearSlot | JointName, obj: THREE.Object3D): void;
  /** Every pickable mesh. */
  meshes(): THREE.Mesh[];
  dispose(): void;
}

/** A joint's pose: rotation (Euler XYZ, radians), position offset and uniform-ish scale. */
export interface JointPose {
  rx?: number;
  ry?: number;
  rz?: number;
  px?: number;
  py?: number;
  pz?: number;
  sy?: number;
}
export type Pose = Partial<Record<JointName, JointPose>>;

/** A clip is a function of phase (0..1 over one cycle for loops; 0..1 once for one-shots) returning joint deltas. */
export interface Clip {
  loop: boolean;
  /** Seconds per cycle (loops) or total (one-shots). */
  duration: number;
  pose(t: number, time: number): Pose;
}

export interface RigMaterials {
  body: THREE.Material;
  metal: THREE.Material;
  glow: THREE.Material;
}

interface Part {
  joint: JointName;
  kind: keyof RigMaterials;
  geo: THREE.BufferGeometry;
  color: number;
}

/** Collects parts per joint before baking them into meshes. Positions are in the joint's frame. */
export class JointKit {
  readonly parts: Part[] = [];
  add(joint: JointName, geo: THREE.BufferGeometry, color: number, pos: [number, number, number], rot: [number, number, number] = [0, 0, 0], scale: [number, number, number] = [1, 1, 1], kind: keyof RigMaterials = 'body'): this {
    const g = geo.clone();
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scale)));
    this.parts.push({ joint, kind, geo: g, color });
    return this;
  }
  box(joint: JointName, w: number, h: number, d: number, color: number, pos: [number, number, number], rot?: [number, number, number], kind?: keyof RigMaterials): this {
    return this.add(joint, new THREE.BoxGeometry(w, h, d), color, pos, rot, undefined, kind);
  }
  cyl(joint: JointName, rt: number, rb: number, h: number, seg: number, color: number, pos: [number, number, number], rot?: [number, number, number], scale?: [number, number, number], kind?: keyof RigMaterials): this {
    return this.add(joint, new THREE.CylinderGeometry(rt, rb, h, seg), color, pos, rot, scale, kind);
  }
  cone(joint: JointName, r: number, h: number, seg: number, color: number, pos: [number, number, number], rot?: [number, number, number], scale?: [number, number, number], kind?: keyof RigMaterials): this {
    return this.add(joint, new THREE.ConeGeometry(r, h, seg), color, pos, rot, scale, kind);
  }
  ball(joint: JointName, r: number, color: number, pos: [number, number, number], detail = 0, scale?: [number, number, number], kind?: keyof RigMaterials): this {
    return this.add(joint, new THREE.IcosahedronGeometry(r, detail), color, pos, undefined, scale, kind);
  }
}

function bake(parts: Part[]): THREE.BufferGeometry | undefined {
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
}

export interface RigSpec {
  /** Rest position of each joint in its parent's frame. */
  rest: Record<JointName, [number, number, number]>;
  /** Rest rotation (Euler XYZ) added under every clip: a hunch, a cocked head. */
  restRot?: Partial<Record<JointName, [number, number, number]>>;
  height: number;
  radius: number;
  clips: Partial<Record<ClipName, Clip>>;
}

const PARENT: Record<JointName, JointName | null> = {
  root: null,
  hips: 'root',
  torso: 'hips',
  head: 'torso',
  armL: 'torso',
  armR: 'torso',
  handL: 'armL',
  handR: 'armR',
  legL: 'hips',
  legR: 'hips',
  back: 'torso',
};

export class RigFigure implements Figure {
  readonly object = new THREE.Group();
  readonly joints: Record<JointName, THREE.Object3D>;
  readonly height: number;
  readonly radius: number;
  readonly clips: ReadonlySet<ClipName>;
  private readonly spec: RigSpec;
  private readonly meshList: THREE.Mesh[] = [];
  private active: { name: ClipName; start: number; speed: number } = { name: 'idle', start: 0, speed: 1 };
  private previous: { name: ClipName; start: number; speed: number; fadeStart: number; fade: number } | null = null;
  private lastLoop: ClipName = 'idle';
  private lastTime = 0;

  constructor(kit: JointKit, spec: RigSpec, mats: RigMaterials) {
    this.spec = spec;
    this.height = spec.height;
    this.radius = spec.radius;
    this.clips = new Set(Object.keys(spec.clips) as ClipName[]);
    const joints = {} as Record<JointName, THREE.Object3D>;
    for (const j of JOINTS) {
      const o = new THREE.Object3D();
      o.name = j;
      o.position.set(...spec.rest[j]);
      joints[j] = o;
      const p = PARENT[j];
      if (p) joints[p]!.add(o);
      else this.object.add(o);
    }
    this.joints = joints;
    for (const j of JOINTS) {
      for (const kind of ['body', 'metal', 'glow'] as const) {
        const geo = bake(kit.parts.filter((p) => p.joint === j && p.kind === kind));
        if (!geo) continue;
        const m = new THREE.Mesh(geo, mats[kind]);
        m.name = `${j}-${kind}`;
        m.castShadow = kind !== 'glow';
        m.receiveShadow = kind !== 'glow';
        joints[j].add(m);
        this.meshList.push(m);
      }
    }
  }

  play(name: ClipName, opts: { fade?: number; speed?: number } = {}): void {
    if (!this.clips.has(name)) return;
    if (this.active.name === name) return;
    const fade = opts.fade ?? 0.15;
    this.previous = { ...this.active, fadeStart: this.lastTime, fade };
    this.active = { name, start: this.lastTime, speed: opts.speed ?? 1 };
    if (this.spec.clips[name]!.loop) this.lastLoop = name;
  }

  current(): ClipName {
    return this.active.name;
  }

  private poseOf(c: { name: ClipName; start: number; speed: number }, time: number): Pose {
    const clip = this.spec.clips[c.name]!;
    const el = ((time - c.start) * c.speed) / clip.duration;
    const t = clip.loop ? el - Math.floor(el) : Math.min(1, el);
    return clip.pose(t, time);
  }

  update(time: number, _dt: number): void {
    this.lastTime = time;
    const clip = this.spec.clips[this.active.name]!;
    // A one-shot that has run its course hands back to the last loop.
    if (!clip.loop && (time - this.active.start) * this.active.speed >= clip.duration) this.play(this.lastLoop, { fade: 0.2 });
    const a = this.poseOf(this.active, time);
    let b: Pose | null = null;
    let k = 1;
    if (this.previous) {
      k = Math.min(1, (time - this.previous.fadeStart) / Math.max(1e-3, this.previous.fade));
      if (k >= 1) this.previous = null;
      else b = this.poseOf(this.previous, time);
    }
    for (const j of JOINTS) {
      const o = this.joints[j];
      const pa = a[j] ?? {};
      const pb = b?.[j] ?? {};
      const mix = (x: number | undefined, y: number | undefined) => (x ?? 0) * k + (y ?? 0) * (1 - k);
      const rest = this.spec.rest[j];
      const rr = this.spec.restRot?.[j] ?? [0, 0, 0];
      o.rotation.set(rr[0] + mix(pa.rx, pb.rx), rr[1] + mix(pa.ry, pb.ry), rr[2] + mix(pa.rz, pb.rz));
      o.position.set(rest[0] + mix(pa.px, pb.px), rest[1] + mix(pa.py, pb.py), rest[2] + mix(pa.pz, pb.pz));
      const sy = (pa.sy ?? 1) * k + (pb.sy ?? 1) * (1 - k);
      o.scale.set(1, sy, 1);
    }
  }

  attach(slot: GearSlot | JointName, obj: THREE.Object3D): void {
    this.joints[slot].add(obj);
    obj.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) this.meshList.push(o as THREE.Mesh);
    });
  }

  meshes(): THREE.Mesh[] {
    return this.meshList;
  }

  dispose(): void {
    for (const m of this.meshList) m.geometry.dispose();
  }
}
