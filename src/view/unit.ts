// One figure on the board: hero, monster, rival or prisoner.

import * as THREE from 'three';
import type { Pos } from '../game/hex';
import type { AnimClock } from './anim';
import { getModel, makeFigure, type FigureModel, type ModelKey } from './figures';
import { easeOutCubic } from './world';

export type UnitSide = 'hero' | 'monster' | 'rival' | 'prisoner';

/**
 * V3.3 scale direction "C RuneScape" (replaces 15.8): a humanoid model is 1.0 to the top of
 * the head, so a hero at 2.0 stands 2.0 world units (hex size 1) with natural blocky
 * proportions. Monsters are scaled relative to the hero: rats 0.35x (nose to rump), spider
 * 0.8x wide, orc 1.05x, berserker a head taller, captain like an orc, ghoul gaunt at hero
 * height, the Gloam looming. The Dragon is built in world units and drawn at 1 (unchanged).
 */
/**
 * V5.0 (G, W0): the owner's figurine scale: a hero stands about 1.35 hexes (For the King 1), so today's
 * figures are drawn at 1.35 / 2.0 of their V3.3 size until W3 rebuilds them on the joint rig. The Dragon
 * is built in world units and keeps scale 1.
 */
export const HERO_SCALE = 1.35;
const K = HERO_SCALE / 2.0;
export const FIGURE_SCALE: Partial<Record<ModelKey, number>> = {
  heir: 2.0 * K,
  rats: 1.3 * K,
  orc: 2.1 * K,
  archer: 2.0 * K,
  captain: 2.1 * K,
  ghoul: 2.0 * K,
  cutpurse: 1.9 * K,
  berserker: 2.5 * K,
  spider: 1.25 * K,
  gloam: 1.8 * K,
  sister: 1.95 * K,
  sisterRanger: 1.95 * K,
  sisterShadow: 1.95 * K,
  sisterBurglar: 1.95 * K,
  prisoner: 1.9 * K,
  dragon: 1,
  dragonSleep: 1,
};

/** Colour and opacity of a hero seen through a wall. */
const SILHOUETTE_COLOR = 0xffb24a;
const SILHOUETTE_OPACITY = 0.42;

export class UnitView {
  readonly root = new THREE.Group();
  /** Inner group for lunges and recoils (root holds the hex position). */
  readonly rig = new THREE.Group();
  readonly fig: THREE.Group;
  readonly body: THREE.MeshLambertMaterial;
  readonly glow: THREE.MeshBasicMaterial;
  /** Heroes: the through-wall silhouette material (see the constructor). */
  readonly silhouette?: THREE.MeshBasicMaterial;
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
    // V3.4: walls stand at full height (no cutaway), so a hero behind one shows as a faint
    // silhouette through it. Drawn before the figure bodies (renderOrder −1 in the transparent
    // pass) and only where something nearer is already in the depth buffer (GreaterDepth), so it
    // never tints the visible hero itself. Heroes only.
    if (side === 'hero') {
      this.silhouette = new THREE.MeshBasicMaterial({ color: SILHOUETTE_COLOR, transparent: true, opacity: SILHOUETTE_OPACITY, depthWrite: false, depthFunc: THREE.GreaterDepth });
      const sil = new THREE.Mesh(this.model.body, this.silhouette);
      sil.name = 'silhouette';
      sil.renderOrder = -1;
      this.fig.add(sil);
    }
    this.scale = FIGURE_SCALE[key] ?? (side === 'hero' ? HERO_SCALE : 2.0 * K);
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
    if (this.silhouette) this.silhouette.opacity = SILHOUETTE_OPACITY * k;
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

  /** V4.0 (spec 28.1): a figure whose last move was a sneak (hero or crew member) is drawn crouched, a little lower. */
  crouch(on: boolean): void {
    if (this.dead || this.busy) return;
    this.fig.scale.set(this.scale, this.scale * (on ? 0.8 : 1), this.scale);
  }

  /** Lie down (downed hero), without fading. */
  lieDown(down: boolean): void {
    this.fig.rotation.z = down ? 1.35 : 0;
    this.fig.position.y = 0;
  }

  pickables(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    this.fig.traverse((o) => (o as THREE.Mesh).isMesh && o.name !== 'silhouette' && out.push(o));
    return out;
  }

  dispose(): void {
    this.body.dispose();
    this.glow.dispose();
    this.silhouette?.dispose();
  }
}
