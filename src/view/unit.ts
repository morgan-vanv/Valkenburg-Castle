// One figure on the board: hero, monster, rival or prisoner.

import * as THREE from 'three';
import type { Pos } from '../game/hex';
import type { AnimClock } from './anim';
import type { ModelKey } from './figures';
import { easeOutCubic } from './world';
import { rigMaterials } from './look/keven';
import { makeRigFigure } from './look/cast';
import type { Figure } from './look/rig';

export type UnitSide = 'hero' | 'monster' | 'rival' | 'prisoner';

/**
 * V3.3 scale direction "C RuneScape" (replaces 15.8): a humanoid model is 1.0 to the top of
 * the head, so a hero at 2.0 stands 2.0 world units (hex size 1) with natural blocky
 * proportions. Monsters are scaled relative to the hero: rats 0.35x (nose to rump), spider
 * 0.8x wide, orc 1.05x, berserker a head taller, captain like an orc, ghoul gaunt at hero
 * height, the Gloam looming. The Dragon is built in world units and drawn at 1 (unchanged).
 */
/** V5.0 (G): a hero stands about 1.35 hexes (For the King 1); the figures are built in world units (look/cast.ts). */
export const HERO_SCALE = 1.35;

/** Colour and opacity of a hero seen through a wall. */
const SILHOUETTE_COLOR = 0xffb24a;
const SILHOUETTE_OPACITY = 0.42;

export class UnitView {
  readonly root = new THREE.Group();
  /** Inner group for lunges and recoils (root holds the hex position). */
  readonly rig = new THREE.Group();
  readonly fig: THREE.Group;
  /** V5.0 (G): flat-shaded standard material (was Lambert); the rigged figures share it as their body. */
  readonly body: THREE.MeshStandardMaterial;
  /** V5.0 (G): the rigged figures' metal (gold, steel). */
  readonly metal?: THREE.MeshStandardMaterial;
  readonly glow: THREE.MeshBasicMaterial;
  /** V5.0 (G): the joint-rigged figure, when this unit has one (W0: Keven). */
  readonly rigged?: Figure;
  /** V5.0 (G): a soft blob under the feet: the figure's contact shadow on Low, a lighter grounding on High. */
  readonly blob: THREE.Mesh;
  private sneaking = false;
  private lastIdleTime = 0;
  /** Heroes: the through-wall silhouette material (see the constructor). */
  readonly silhouette?: THREE.MeshBasicMaterial;
  /** Height to the top of the head or hat and the footprint radius, world units; `floats`/`ghost` for the Gloam. */
  model: { height: number; radius: number; floats?: boolean; ghost?: boolean };
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
    // V5.0 (G, W5): every figure is built on the joint rig (look/cast.ts); the V3 merged models are retired.
    const ghost = key === 'gloam';
    this.baseOpacity = key === 'gloam' ? 0.92 : ghost ? 0.6 : 1;
    this.body = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.82, metalness: 0, transparent: true, opacity: this.baseOpacity, emissive: 0x000000, depthWrite: !ghost || key === 'gloam' });
    this.glow = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 1, depthTest: key !== 'gloam' });
    // V3.4: walls stand at full height (no cutaway), so a hero behind one shows as a faint
    // silhouette through it. Drawn before the figure bodies (renderOrder −1 in the transparent
    // pass) and only where something nearer is already in the depth buffer (GreaterDepth), so it
    // never tints the visible hero itself. Heroes only.
    if (side === 'hero') this.silhouette = new THREE.MeshBasicMaterial({ color: SILHOUETTE_COLOR, transparent: true, opacity: SILHOUETTE_OPACITY, depthWrite: false, depthFunc: THREE.GreaterDepth });
    const mats = rigMaterials();
    const rig = makeRigFigure(key, { body: this.body, metal: mats.metal, glow: this.glow });
    if (!rig) throw new Error(`No figure for model ${key}`);
    this.metal = mats.metal as THREE.MeshStandardMaterial;
    this.rigged = rig;
    this.fig = rig.object as THREE.Group;
    this.model = { height: rig.height, radius: rig.radius, floats: key === 'gloam', ghost };
    if (this.silhouette) {
      for (const m of rig.meshes()) {
        if (m.material === this.glow) continue;
        const sil = new THREE.Mesh(m.geometry, this.silhouette);
        sil.name = 'silhouette';
        sil.renderOrder = -1;
        m.parent?.add(sil);
      }
    }
    this.scale = 1;
    this.fig.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        (o as THREE.Mesh).castShadow = o.name !== 'silhouette' && o.name !== 'glow';
        (o as THREE.Mesh).receiveShadow = false;
      }
    });
    this.fig.traverse((o) => {
      o.userData.unitId = id;
    });
    this.rig.add(this.fig);
    this.root.add(this.rig);
    this.blob = new THREE.Mesh(new THREE.CircleGeometry(Math.max(0.22, this.model.radius * this.scale * 1.15), 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }));
    this.blob.position.y = 0.012;
    this.blob.name = 'blob';
    if (ghost || this.model.floats) this.blob.visible = false;
    this.root.add(this.blob);
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
    if (this.rigged) {
      const dt = Math.max(0, Math.min(0.1, time - this.lastIdleTime));
      this.lastIdleTime = time;
      const want = moving ? (this.sneaking ? 'sneakWalk' : 'walk') : this.sneaking ? 'sneak' : 'idle';
      const cur = this.rigged.current();
      if (cur !== want && (cur === 'idle' || cur === 'walk' || cur === 'sneak' || cur === 'sneakWalk')) this.rigged.play(want);
      this.rigged.update(time, dt);
      if (this.torch?.visible) for (const f of this.torch.children) if (f.name === 'flame') f.scale.set(1 + Math.sin(time * 13 + this.phase) * 0.1, 1 + Math.sin(time * 9 + this.phase) * 0.2, 1);
      return;
    }
    const floats = !!this.model.floats;
    const base = floats ? 0.15 + Math.sin(time * 1.6 + this.phase) * 0.06 : 0;
    this.fig.position.y = moving ? Math.abs(Math.sin(time * 16 + this.phase)) * 0.07 + base : base + Math.sin(time * 2.2 + this.phase) * 0.006;
  }

  /** V5.0 (G, W1): a steady emissive edge from a status (braced gold); flashes add on top of it. */
  readonly rim = new THREE.Color(0, 0, 0);
  /** V5.0 (G, W1): a status's own opacity (a veil), multiplied into setOpacity. */
  statusOpacity = 1;
  private lastOpacity = 1;

  flash(color: THREE.Color, amount: number): void {
    this.body.emissive.copy(this.rim).add(color.clone().multiplyScalar(amount));
    this.metal?.emissive.copy(this.body.emissive);
  }

  setOpacity(k: number): void {
    this.lastOpacity = k;
    const o = k * this.statusOpacity;
    this.body.opacity = this.baseOpacity * o;
    if (this.metal) this.metal.opacity = this.baseOpacity * o;
    this.glow.opacity = o;
    if (this.silhouette) this.silhouette.opacity = SILHOUETTE_OPACITY * k;
  }

  /** Re-apply the current opacity after a status changed `statusOpacity`, and the rim when no flash is on. */
  refreshStatus(): void {
    this.setOpacity(this.lastOpacity);
    if (this.body.emissive.r + this.body.emissive.g + this.body.emissive.b < 1e-4 || this.body.emissive.equals(this.rim)) this.flash(this.rim, 0);
  }

  /** V5.0 (G): a rigged figure plays a one-shot clip (a strike, a flinch) if it has one. */
  playClip(name: 'strike' | 'hit' | 'shoot' | 'cast' | 'use'): void {
    if (!this.rigged) return;
    // A figure without a bow swings instead of shooting; without a spell it gestures with its arm.
    const want = this.rigged.clips.has(name) ? name : name === 'shoot' ? 'strike' : name === 'cast' ? 'use' : name;
    this.rigged.play(want);
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
    this.sneaking = on;
    if (this.rigged) return; // the sneak clip crouches it (idle)
    this.fig.scale.set(this.scale, this.scale * (on ? 0.8 : 1), this.scale);
  }

  /** Lie down (downed hero), without fading. */
  lieDown(down: boolean): void {
    this.fig.rotation.z = down ? 1.35 : 0;
    // V5.0 (G): lifted a little so no part of a lying figure sinks under the tile (the silhouette would show through).
    this.fig.position.y = down ? 0.14 : 0;
  }

  private torch?: THREE.Group;
  /** V5.0 (G, W3): a lit torch in the left hand of a rigged figure (the diorama calls this from its light sources). */
  setTorch(on: boolean): void {
    if (!this.rigged) return;
    if (on && !this.torch) {
      const g = new THREE.Group();
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.5, 5), new THREE.MeshStandardMaterial({ color: 0x4a3018, flatShading: true, roughness: 0.9 }));
      stick.position.set(0, 0.1, 0.06);
      stick.rotation.x = -0.35;
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.035, 0.1, 6), new THREE.MeshStandardMaterial({ color: 0x2a1a10, flatShading: true, roughness: 0.9 }));
      head.position.set(0, 0.34, -0.02);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.24, 5), new THREE.MeshBasicMaterial({ color: 0xffb35c, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
      flame.position.set(0, 0.5, -0.03);
      flame.name = 'flame';
      const core = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.14, 5), new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
      core.position.set(0, 0.47, -0.03);
      core.name = 'flame';
      g.add(stick, head, flame, core);
      g.traverse((o) => ((o as THREE.Mesh).castShadow = false));
      this.torch = g;
      this.rigged.attach('handL', g);
    }
    if (this.torch) this.torch.visible = on;
  }

  /** V5.0 (G): how dark the contact blob is (0 hides it). */
  setBlob(opacity: number): void {
    (this.blob.material as THREE.MeshBasicMaterial).opacity = opacity;
    this.blob.visible = opacity > 0;
  }

  pickables(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    this.fig.traverse((o) => (o as THREE.Mesh).isMesh && o.name !== 'silhouette' && out.push(o));
    return out;
  }

  dispose(): void {
    this.body.dispose();
    this.metal?.dispose();
    this.glow.dispose();
    this.silhouette?.dispose();
    this.rigged?.dispose();
  }
}
