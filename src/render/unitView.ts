// One unit on the board: a root group placed at its square, holding one
// figure per man (squads, up to 10) or a single figure (heroes, monsters).

import * as THREE from 'three';
import type { Coord, Unit } from '../engine/types';
import { getModel, makeFigure, type FigureModel } from './figures';
import type { AnimClock } from './anim';
import { easeOutCubic } from './world';

export const MAX_FIGURES = 10;

export interface Figure {
  g: THREE.Group;
  body: THREE.MeshLambertMaterial;
  glow: THREE.MeshBasicMaterial;
  alive: boolean;
  /** Offset within the unit's formation. */
  home: THREE.Vector3;
  phase: number;
}

export class UnitView {
  readonly root = new THREE.Group();
  /** Inner group for lunges and recoils (root holds the square position). */
  readonly rig = new THREE.Group();
  figures: Figure[] = [];
  readonly model: FigureModel;
  coord: Coord;
  /** Fanning offset within the square. */
  slot = new THREE.Vector3();
  /** Formation spread (shrinks when the square is shared). */
  spread = 1;
  /** Shown at all (fog, other level). */
  shown = true;
  /** Animations in flight; skip snapping while > 0. */
  busy = 0;
  facing = 0;
  dying = false;
  readonly isSquad: boolean;
  readonly scale: number;

  constructor(
    public unit: Unit,
    private readonly clock: AnimClock,
  ) {
    this.coord = { ...unit.pos };
    this.isSquad = unit.cls === 'squad' || unit.cls === 'orcSquad';
    this.model = getModel(unit.cls, unit.armor, unit.heroId);
    this.scale = this.isSquad ? 0.95 : unit.side === 'player' ? 1.12 : unit.cls === 'dragon' ? 1.6 : 1.05;
    this.root.add(this.rig);
    this.root.name = `unit-${unit.id}`;
    this.setMen(this.isSquad ? unit.men : 1, false);
  }

  get aliveCount(): number {
    return this.figures.filter((f) => f.alive).length;
  }

  private addFigure(): Figure {
    const ghost = !!this.model.ghost;
    const body = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, transparent: true, opacity: ghost ? 0.6 : 1, emissive: 0x000000, depthWrite: !ghost });
    const glow = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 1 });
    const g = makeFigure(this.model, { body, glow });
    g.scale.setScalar(this.scale);
    const f: Figure = { g, body, glow, alive: true, home: new THREE.Vector3(), phase: Math.random() * Math.PI * 2 };
    g.traverse((o) => {
      o.userData.unitId = this.unit.id;
    });
    this.rig.add(g);
    this.figures.push(f);
    return f;
  }

  /** Set the number of standing figures. Extra dead figures are removed. */
  setMen(n: number, animate: boolean): Promise<void> {
    const want = Math.max(0, Math.min(MAX_FIGURES, n));
    let alive = this.figures.filter((f) => f.alive);
    while (alive.length < want) {
      this.addFigure();
      alive = this.figures.filter((f) => f.alive);
    }
    const doomed = alive.slice(want);
    if (!doomed.length) {
      this.layout(false);
      return Promise.resolve();
    }
    for (const f of doomed) f.alive = false;
    if (!animate) {
      for (const f of doomed) this.removeFigure(f);
      this.layout(false);
      return Promise.resolve();
    }
    return Promise.all(doomed.map((f, i) => this.topple(f, i * 0.05))).then(() => {
      for (const f of doomed) this.removeFigure(f);
      return this.layoutAnimated();
    });
  }

  private removeFigure(f: Figure): void {
    this.rig.remove(f.g);
    f.body.dispose();
    f.glow.dispose();
    this.figures = this.figures.filter((x) => x !== f);
  }

  /** A figure falls over and fades. */
  topple(f: Figure, delay = 0): Promise<void> {
    const side = Math.random() < 0.5 ? -1 : 1;
    const start = f.g.rotation.clone();
    const startY = f.g.position.y;
    return this.clock.wait(delay).then(() =>
      this.clock.tween(0.55, (t) => {
        const k = easeOutCubic(Math.min(1, t * 1.6));
        f.g.rotation.x = start.x + k * 1.45 * (side > 0 ? 1 : 0.2);
        f.g.rotation.z = start.z + k * 1.45 * (side < 0 ? 1 : 0.2) * side;
        f.g.position.y = startY + Math.sin(Math.min(1, t * 1.6) * Math.PI) * 0.05;
        const fade = Math.max(0, (t - 0.45) / 0.55);
        f.body.opacity = (this.model.ghost ? 0.6 : 1) * (1 - fade);
        f.glow.opacity = 1 - fade;
        f.body.emissive.setRGB(0.5 * (1 - k), 0, 0);
      }),
    );
  }

  /** Formation offsets for the standing figures. */
  formation(): THREE.Vector3[] {
    const alive = this.figures.filter((f) => f.alive);
    const n = alive.length;
    const out: THREE.Vector3[] = [];
    if (n <= 1) return [new THREE.Vector3()];
    const cols = n <= 2 ? 2 : n <= 4 ? 2 : n <= 6 ? 3 : 4;
    const rows = Math.ceil(n / cols);
    const sp = 0.2 * this.spread;
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / cols);
      const inRow = r === rows - 1 ? n - r * cols : cols;
      const c = i % cols;
      const x = (c - (inRow - 1) / 2) * sp + (r % 2 ? sp * 0.15 : 0);
      const z = (r - (rows - 1) / 2) * sp * 0.95;
      out.push(new THREE.Vector3(x, 0, z));
    }
    return out;
  }

  layout(animate: boolean): void {
    const pos = this.formation();
    const alive = this.figures.filter((f) => f.alive);
    alive.forEach((f, i) => {
      f.home.copy(pos[i] ?? new THREE.Vector3());
      if (!animate) f.g.position.set(f.home.x, f.g.position.y, f.home.z);
      f.g.scale.setScalar(this.scale * (this.spread < 1 && this.isSquad ? 0.85 : this.spread < 1 ? 0.9 : 1));
    });
  }

  layoutAnimated(): Promise<void> {
    const alive = this.figures.filter((f) => f.alive);
    const from = alive.map((f) => f.g.position.clone());
    this.layout(true);
    return this.clock.tween(0.18, (t) => {
      const k = easeOutCubic(t);
      alive.forEach((f, i) => {
        f.g.position.x = from[i]!.x + (f.home.x - from[i]!.x) * k;
        f.g.position.z = from[i]!.z + (f.home.z - from[i]!.z) * k;
      });
    });
  }

  /** Turn all figures to face a world direction. */
  face(dx: number, dz: number): void {
    if (Math.abs(dx) + Math.abs(dz) < 1e-4) return;
    this.facing = Math.atan2(dx, dz);
    for (const f of this.figures) if (f.alive) f.g.rotation.y = this.facing;
  }

  /** Idle animation: breathing bob, banshee hover. */
  idle(time: number, moving: boolean): void {
    const floats = !!this.model.floats;
    for (const f of this.figures) {
      if (!f.alive) continue;
      const base = floats ? 0.18 + Math.sin(time * 2 + f.phase) * 0.05 : 0;
      f.g.position.y = moving ? Math.abs(Math.sin(time * 18 + f.phase)) * 0.06 + base : base + Math.sin(time * 2.2 + f.phase) * 0.004;
    }
  }

  flash(color: THREE.Color, amount: number): void {
    for (const f of this.figures) if (f.alive) f.body.emissive.copy(color).multiplyScalar(amount);
  }

  /** Bodies for picking. */
  pickables(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    for (const f of this.figures) if (f.alive) f.g.traverse((o) => (o as THREE.Mesh).isMesh && out.push(o));
    return out;
  }

  setOpacity(k: number): void {
    for (const f of this.figures) {
      f.body.opacity = (this.model.ghost ? 0.6 : 1) * k;
      f.glow.opacity = k;
    }
  }

  dispose(): void {
    for (const f of [...this.figures]) this.removeFigure(f);
  }
}

/** Offsets for k units sharing a square. */
export function fanOffsets(k: number): [number, number][] {
  switch (k) {
    case 0:
    case 1:
      return [[0, 0]];
    case 2:
      return [
        [-0.22, 0.02],
        [0.22, -0.02],
      ];
    case 3:
      return [
        [-0.24, -0.16],
        [0.24, -0.16],
        [0, 0.22],
      ];
    case 4:
      return [
        [-0.24, -0.22],
        [0.24, -0.22],
        [-0.24, 0.22],
        [0.24, 0.22],
      ];
    default: {
      const out: [number, number][] = [];
      for (let i = 0; i < k; i++) {
        const a = (i / k) * Math.PI * 2;
        out.push([Math.sin(a) * 0.3, Math.cos(a) * 0.3]);
      }
      return out;
    }
  }
}
