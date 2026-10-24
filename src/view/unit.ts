// One figure on the board: hero, monster, rival or prisoner.

import * as THREE from 'three';
import type { Pos } from '../game/hex';
import type { AnimClock } from './anim';
import { getModel, makeFigure, type FigureModel, type ModelKey } from './figures';
import { easeOutCubic } from './world';

export type UnitSide = 'hero' | 'monster' | 'rival' | 'prisoner';

export class UnitView {
  readonly root = new THREE.Group();
  /** Inner group for lunges and recoils (root holds the hex position). */
  readonly rig = new THREE.Group();
  readonly fig: THREE.Group;
  readonly body: THREE.MeshLambertMaterial;
  readonly glow: THREE.MeshBasicMaterial;
  readonly model: FigureModel;
  at: Pos;
  /** Shown at all (fog, other level). */
  shown = true;
  /** Animations in flight; skip snapping while > 0. */
  busy = 0;
  facing = 0;
  dead = false;
  /** Small offset when sharing a hex (prisoner next to escort, etc.). */
  readonly offset = new THREE.Vector3();
  private phase = Math.random() * Math.PI * 2;
  readonly scale: number;
  baseOpacity: number;

  constructor(
    readonly id: string,
    readonly key: ModelKey,
    readonly side: UnitSide,
    at: Pos,
    private readonly clock: AnimClock,
  ) {
    this.at = { ...at };
    this.model = getModel(key);
    const ghost = !!this.model.ghost;
    this.baseOpacity = key === 'gloam' ? 0.92 : ghost ? 0.6 : 1;
    this.body = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, transparent: true, opacity: this.baseOpacity, emissive: 0x000000, depthWrite: !ghost || key === 'gloam' });
    this.glow = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 1, depthTest: key !== 'gloam' });
    this.fig = makeFigure(this.model, { body: this.body, glow: this.glow });
    this.scale = side === 'hero' ? 1.9 : key === 'dragon' || key === 'dragonSleep' ? 1.0 : key === 'berserker' ? 2.0 : key === 'gloam' ? 1.7 : key === 'rats' ? 1.8 : 1.75;
    this.fig.scale.setScalar(this.scale);
    this.fig.traverse((o) => {
      o.userData.unitId = id;
    });
    this.rig.add(this.fig);
    this.root.add(this.rig);
    this.root.name = `unit-${id}`;
  }

  get height(): number {
    return this.model.height * this.scale;
  }

  face(dx: number, dz: number): void {
    if (Math.abs(dx) + Math.abs(dz) < 1e-4) return;
    this.facing = Math.atan2(dx, dz);
    this.fig.rotation.y = this.facing;
  }

  idle(time: number, moving: boolean): void {
    if (this.dead) return;
    const floats = !!this.model.floats;
    const base = floats ? 0.15 + Math.sin(time * 1.6 + this.phase) * 0.06 : 0;
    this.fig.position.y = moving ? Math.abs(Math.sin(time * 16 + this.phase)) * 0.07 + base : base + Math.sin(time * 2.2 + this.phase) * 0.006;
  }

  flash(color: THREE.Color, amount: number): void {
    this.body.emissive.copy(color).multiplyScalar(amount);
  }

  setOpacity(k: number): void {
    this.body.opacity = this.baseOpacity * k;
    this.glow.opacity = k;
  }

  /** Fall over and fade. */
  topple(): Promise<void> {
    this.dead = true;
    const side = Math.random() < 0.5 ? -1 : 1;
    const f = this.fig;
    const startY = f.position.y;
    return this.clock.tween(0.6, (t) => {
      const k = easeOutCubic(Math.min(1, t * 1.6));
      f.rotation.z = k * 1.4 * side;
      f.position.y = startY + Math.sin(Math.min(1, t * 1.6) * Math.PI) * 0.08;
      const fade = Math.max(0, (t - 0.45) / 0.55);
      this.setOpacity(1 - fade);
      this.body.emissive.setRGB(0.5 * (1 - k), 0, 0);
    });
  }

  /** Lie down (downed hero), without fading. */
  lieDown(down: boolean): void {
    this.fig.rotation.z = down ? 1.35 : 0;
    this.fig.position.y = 0;
  }

  pickables(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    this.fig.traverse((o) => (o as THREE.Mesh).isMesh && out.push(o));
    return out;
  }

  dispose(): void {
    this.body.dispose();
    this.glow.dispose();
  }
}
