// V5.0 (G, W1): the action cam. On an attack, blow, shot, spell or item use the camera pushes in about
// 30% closer and a little lower toward the midpoint of actor and target, holds while the event's own
// animation plays, then eases back to exactly where the player had it (target, yaw, pitch bias, distance).
// It never adds time: it rides the animation the event already plays. If the player moves the camera while
// it is pushed in, the player wins and nothing is restored. The play track's follow and selection rules own
// where the camera rests afterwards; this module only ever restores what it took.

import * as THREE from 'three';
import type { CameraRig } from '../camera';

export const ACTION_CAM = { push: 0.7, lower: -0.12, minMs: 220 };

interface Home {
  target: THREE.Vector3;
  yaw: number;
  pitchBias: number;
  distance: number;
}

export class ActionCam {
  enabled = true;
  private home: Home | null = null;
  private set: Home | null = null;
  private until = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly rig: CameraRig) {}

  /** Push in toward the midpoint of `a` and `b` for `ms` (world points on the shown level). */
  play(a: THREE.Vector3, b: THREE.Vector3, ms: number): void {
    if (!this.enabled) return;
    const rig = this.rig;
    if (!this.home) this.home = { target: rig.target.clone(), yaw: rig.yaw, pitchBias: rig.pitchBias, distance: rig.distance };
    else if (this.set && !this.playerMoved()) {
      /* already pushed in: keep the original home */
    } else {
      this.cancel();
      return;
    }
    const mid = a.clone().add(b).multiplyScalar(0.5);
    mid.y = this.home.target.y;
    rig.focus(mid);
    rig.distance = Math.max(7, this.home.distance * ACTION_CAM.push);
    rig.pitchBias = this.home.pitchBias + ACTION_CAM.lower;
    this.set = { target: rig.target.clone(), yaw: rig.yaw, pitchBias: rig.pitchBias, distance: rig.distance };
    this.until = Math.max(this.until, performance.now() + Math.max(ACTION_CAM.minMs, ms));
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.restore(), this.until - performance.now());
  }

  /** Did the player (or the follow rules) move the camera since we set it? */
  private playerMoved(): boolean {
    const s = this.set;
    const r = this.rig;
    if (!s) return false;
    return s.target.distanceToSquared(r.target) > 1e-4 || Math.abs(s.yaw - r.yaw) > 1e-4 || Math.abs(s.distance - r.distance) > 1e-3 || Math.abs(s.pitchBias - r.pitchBias) > 1e-4;
  }

  private restore(): void {
    this.timer = null;
    const home = this.home;
    if (!home) return;
    if (!this.playerMoved()) {
      this.rig.focus(home.target);
      this.rig.yaw = home.yaw;
      this.rig.pitchBias = home.pitchBias;
      this.rig.distance = home.distance;
    }
    this.home = null;
    this.set = null;
  }

  /** Drop the push without restoring (the player took the camera). */
  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.home = null;
    this.set = null;
  }

  get active(): boolean {
    return this.home !== null;
  }
}
