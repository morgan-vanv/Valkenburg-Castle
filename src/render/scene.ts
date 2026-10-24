// The 3D diorama. Owns the three.js scene, the levels, unit figures, fog of
// war, lights, highlights, picking and the 3D side of every event. Knows
// nothing about the DOM panels; the UI layer drives it.

import * as THREE from 'three';
import { edgeSquares, label, levelOf, parseSquareKey, sameSquare, squareKey } from '../engine/geometry';
import type { Visibility } from '../engine/api';
import type { CastleMap, Coord, EdgeKind, GameEvent, GameState, LevelId, Unit } from '../engine/types';
import { AnimClock } from './anim';
import { CameraRig } from './camera';
import { LevelView } from './level';
import { glowTexture, glyphSprite } from './sprites';
import { UnitView, fanOffsets } from './unitView';
import { COLORS, FLOOR_TOP, LEVEL_GAP, easeInOut, easeOutBack, easeOutCubic, levelY, squareCenter } from './world';

const MAX_LIGHTS = 8;

export interface SceneHooks {
  hover(c: Coord | null, unitId: string | null): void;
  click(c: Coord | null, unitId: string | null, ev: PointerEvent): void;
  /** The level shown changed (buttons, follow). */
  levelChanged(id: LevelId): void;
}

export interface FeelSettings {
  reduceShake: boolean;
  reduceFlashes: boolean;
}

type FloatKind = 'damage' | 'info' | 'focus' | 'warn' | 'gold';

interface Floater {
  el: HTMLElement;
  world: THREE.Vector3;
  born: number;
  life: number;
  rise: number;
}

export class Diorama {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly clock = new AnimClock();
  readonly rig: CameraRig;
  readonly levels = new Map<LevelId, LevelView>();
  readonly fxLayer: HTMLElement;
  shownLevel: LevelId = 1;
  feel: FeelSettings = { reduceShake: false, reduceFlashes: false };

  private views = new Map<string, UnitView>();
  private lights: THREE.PointLight[] = [];
  private lightOwner: (string | null)[] = [];
  private ambient: THREE.AmbientLight;
  private flashLight: THREE.PointLight;
  private visible = new Set<string>();
  private explored = new Set<string>();
  private contacts = new THREE.Group();
  private props = new THREE.Group();
  private overlay = new THREE.Group();
  private reachMesh: THREE.InstancedMesh;
  private pathMesh: THREE.InstancedMesh;
  private hoverMesh: THREE.Mesh;
  private targetMesh: THREE.InstancedMesh;
  private ring: THREE.Mesh;
  private selectedId: string | null = null;
  private followId: string | null = null;
  private floaters: Floater[] = [];
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private lastTime = performance.now();
  private hoverCoord: Coord | null = null;
  private hoverUnit: string | null = null;
  private lookup: (id: string) => Unit | undefined = () => undefined;
  private shownUnitsFilter: (u: Unit) => boolean = () => true;
  private moving = new Set<string>();
  private downAt: { x: number; y: number; button: number } | null = null;
  private resizeObs: ResizeObserver;
  private disposed = false;
  private active = true;

  constructor(
    private readonly container: HTMLElement,
    readonly map: CastleMap,
    private readonly hooks: SceneHooks,
  ) {
    const canvas = document.createElement('canvas');
    canvas.className = 'dio-canvas';
    container.appendChild(canvas);
    this.fxLayer = document.createElement('div');
    this.fxLayer.className = 'dio-fx';
    container.appendChild(this.fxLayer);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(COLORS.void, 1);
    this.scene.background = new THREE.Color(COLORS.void);

    this.rig = new CameraRig(canvas);

    // Lights: near-black ambient, a faint cold rim, pooled warm lamps.
    this.ambient = new THREE.AmbientLight(0x2a2f3a, 0.35);
    this.scene.add(this.ambient);
    const rim = new THREE.DirectionalLight(COLORS.cold, 0.32);
    rim.position.set(-6, 9, -8);
    this.scene.add(rim);
    this.scene.add(rim.target);
    const fill = new THREE.HemisphereLight(0x3a3046, 0x0a0806, 0.25);
    this.scene.add(fill);
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const l = new THREE.PointLight(COLORS.emberHot, 0, 8, 1.4);
      l.visible = true;
      this.scene.add(l);
      this.lights.push(l);
      this.lightOwner.push(null);
    }
    this.flashLight = new THREE.PointLight(0xffd2a0, 0, 14, 1.2);
    this.scene.add(this.flashLight);

    for (const lv of map.levels) {
      const view = new LevelView(lv, map);
      this.levels.set(lv.id, view);
      this.scene.add(view.group);
    }
    this.scene.add(this.props, this.contacts, this.overlay);

    // Overlays.
    const sq = new THREE.PlaneGeometry(0.94, 0.94).rotateX(-Math.PI / 2);
    this.reachMesh = new THREE.InstancedMesh(sq, new THREE.MeshBasicMaterial({ color: COLORS.ember, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending }), 400);
    this.reachMesh.count = 0;
    this.reachMesh.renderOrder = 2;
    const dot = new THREE.CircleGeometry(0.09, 4).rotateX(-Math.PI / 2);
    this.pathMesh = new THREE.InstancedMesh(dot, new THREE.MeshBasicMaterial({ color: COLORS.emberHot, transparent: true, opacity: 0.95, depthWrite: false }), 64);
    this.pathMesh.count = 0;
    this.pathMesh.renderOrder = 3;
    const frame = squareFrame(0.98, 0.06);
    this.hoverMesh = new THREE.Mesh(frame, new THREE.MeshBasicMaterial({ color: COLORS.parchment, transparent: true, opacity: 0.85, depthWrite: false }));
    this.hoverMesh.visible = false;
    this.hoverMesh.renderOrder = 4;
    this.targetMesh = new THREE.InstancedMesh(squareFrame(0.92, 0.07), new THREE.MeshBasicMaterial({ color: COLORS.danger, transparent: true, opacity: 0.9, depthWrite: false }), 64);
    this.targetMesh.count = 0;
    this.targetMesh.renderOrder = 4;
    const ringGeo = new THREE.RingGeometry(0.34, 0.42, 24).rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: COLORS.ember, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
    this.ring.visible = false;
    this.ring.renderOrder = 3;
    this.overlay.add(this.reachMesh, this.pathMesh, this.hoverMesh, this.targetMesh, this.ring);

    this.bindPointer(canvas);
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();
    this.showLevel(1, true);
    this.loop();
  }

  // ------------------------------------------------------------ frame

  private resize(): void {
    const w = this.container.clientWidth || innerWidth;
    const h = this.container.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false);
    this.rig.resize(w, h);
  }

  private loop = (): void => {
    if (this.disposed) return;
    const now = performance.now();
    const dtReal = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    const dt = this.clock.tick(dtReal);
    const t = this.clock.real;
    this.rig.update(dtReal, t);
    if (this.followId) {
      const v = this.views.get(this.followId);
      if (v && v.coord.level === this.shownLevel) {
        const p = v.root.position;
        this.rig.focus(new THREE.Vector3(p.x, levelY(this.shownLevel), p.z));
      }
    }
    for (const v of this.views.values()) v.idle(this.clock.time, this.moving.has(v.unit.id));
    this.updateLights(t);
    // Selection ring and contact pulse.
    if (this.selectedId) {
      const v = this.views.get(this.selectedId);
      if (v && v.root.visible) {
        this.ring.visible = true;
        this.ring.position.set(v.root.position.x + v.slot.x * 0, v.root.position.y + 0.075, v.root.position.z);
        const s = 1 + Math.sin(t * 4) * 0.05;
        this.ring.scale.setScalar(s * (v.isSquad ? 1.05 : 0.8));
      } else this.ring.visible = false;
    }
    for (const c of this.contacts.children) {
      const k = 0.5 + 0.5 * Math.sin(t * 5 + c.position.x);
      const disk = c.children[0] as THREE.Mesh;
      (disk.material as THREE.MeshBasicMaterial).opacity = 0.25 + k * 0.45;
      disk.scale.setScalar(0.8 + k * 0.35);
    }
    const tm = this.targetMesh.material as THREE.MeshBasicMaterial;
    tm.opacity = 0.55 + 0.4 * Math.sin(t * 6);
    // Flash light decays.
    this.flashLight.intensity *= Math.exp(-dtReal * 7);
    this.updateFloaters();
    void dt;
    if (this.active) this.renderer.render(this.scene, this.rig.camera);
    requestAnimationFrame(this.loop);
  };

  private updateLights(t: number): void {
    // Assign lamps to player units on the shown level, selected first.
    const lit: UnitView[] = [];
    for (const v of this.views.values()) {
      if (v.unit.side !== 'player' || !v.root.visible || v.coord.level !== this.shownLevel) continue;
      lit.push(v);
    }
    lit.sort((a, b) => (a.unit.id === this.selectedId ? -1 : b.unit.id === this.selectedId ? 1 : 0));
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const l = this.lights[i]!;
      const v = lit[i];
      if (!v) {
        l.intensity = 0;
        this.lightOwner[i] = null;
        continue;
      }
      this.lightOwner[i] = v.unit.id;
      const seed = i * 1.7;
      const flicker = 1 + Math.sin(t * 11 + seed) * 0.04 + Math.sin(t * 23 + seed * 2) * 0.03 + Math.sin(t * 5.3 + seed) * 0.03;
      l.intensity = (v.isSquad ? 5 : 4.5) * flicker;
      l.distance = 8.5;
      l.position.set(v.root.position.x + 0.1, v.root.position.y + 1.05 + Math.sin(t * 7 + seed) * 0.02, v.root.position.z + 0.1);
    }
  }

  // ------------------------------------------------------------ levels

  showLevel(id: LevelId, instant = false): void {
    if (!this.levels.has(id)) return;
    const changed = id !== this.shownLevel;
    this.shownLevel = id;
    for (const [lid, v] of this.levels) v.group.visible = lid === id;
    const lv = levelOf(this.map, id)!;
    const y = levelY(id);
    this.rig.bounds.set(new THREE.Vector3(lv.x0 - 1, y - 1, -1), new THREE.Vector3(lv.x0 + lv.width + 1, y + 1, lv.height + 1));
    this.rig.setHeight(y, instant);
    if (instant) {
      this.rig.focus(new THREE.Vector3(lv.x0 + lv.width / 2, y, lv.height / 2), true);
    }
    this.refreshUnitVisibility();
    this.refreshContacts();
    this.overlay.visible = true;
    if (changed) this.hooks.levelChanged(id);
  }

  /** Centre the camera on a square, switching level if needed. */
  lookAt(c: Coord, instant = false): void {
    if (c.level !== this.shownLevel) this.showLevel(c.level, instant);
    this.rig.focus(squareCenter(c, 0), instant);
  }

  /** Frame the whole shown level. */
  frameLevel(): void {
    const lv = levelOf(this.map, this.shownLevel)!;
    this.rig.focus(new THREE.Vector3(lv.x0 + lv.width / 2, levelY(lv.id), lv.height / 2));
    this.rig.distance = Math.max(10, Math.min(36, Math.max(lv.width, lv.height) * 1.15));
  }

  setFollow(unitId: string | null): void {
    this.followId = unitId;
  }

  // ------------------------------------------------------------ state sync

  /** Snap everything to `state` (no animation). */
  sync(state: GameState, vis: Visibility): void {
    const exp = state.expedition;
    this.lookup = (id) => exp?.units.find((u) => u.id === id) ?? exp?.fallen.find((u) => u.id === id);
    this.visible = vis.visible;
    this.explored = vis.explored;
    if (!exp) {
      for (const v of this.views.values()) this.removeView(v);
      this.contacts.clear();
      this.props.clear();
      return;
    }
    const keep = new Set<string>();
    for (const u of exp.units) {
      if (u.exited || u.cls === 'dummy') continue;
      keep.add(u.id);
      let v = this.views.get(u.id);
      if (!v) v = this.addView(u);
      v.unit = u;
      v.coord = { ...u.pos };
      if (!v.busy) v.setMen(v.isSquad ? u.men : 1, false);
    }
    for (const v of [...this.views.values()]) if (!keep.has(v.unit.id)) this.removeView(v);
    this.applyFog();
    this.syncDoors(state);
    this.syncProps(state);
    this.setContacts(vis);
    this.layoutAll(false);
    this.refreshUnitVisibility();
  }

  /** Point unit lookups at the state that events are about to describe. */
  beginPlayback(next: GameState, nextVis?: Visibility): void {
    const exp = next.expedition;
    const prev = this.lookup;
    this.lookup = (id) => exp?.units.find((u) => u.id === id) ?? exp?.fallen.find((u) => u.id === id) ?? prev(id);
    // While events play, show enemies seen before or after (fog tiles update at the end).
    if (nextVis) {
      this.visible = new Set([...this.visible, ...nextVis.visible]);
      this.refreshUnitVisibility();
    }
  }

  private addView(u: Unit): UnitView {
    const v = new UnitView(u, this.clock);
    this.views.set(u.id, v);
    this.scene.add(v.root);
    v.root.position.copy(squareCenter(u.pos, 0));
    v.face(0, u.side === 'player' ? -1 : 1);
    return v;
  }

  private removeView(v: UnitView): void {
    this.scene.remove(v.root);
    v.dispose();
    this.views.delete(v.unit.id);
  }

  private applyFog(): void {
    const fog = new Map<string, number>();
    for (const k of this.explored) fog.set(k, 0.5);
    for (const k of this.visible) fog.set(k, 1);
    for (const lv of this.levels.values()) lv.applyFog(fog);
  }

  private syncDoors(state: GameState): void {
    const exp = state.expedition;
    for (const lv of this.levels.values()) {
      for (const [key] of lv.doors) {
        const [a] = edgeSquares(key);
        const kind = edgeKindFromKey(this.map, key, a);
        lv.setDoor(key, exp?.doors[key], kind);
      }
    }
  }

  private syncProps(state: GameState): void {
    this.props.clear();
    const exp = state.expedition;
    if (!exp) return;
    const coin = new THREE.MeshLambertMaterial({ color: COLORS.gold, emissive: 0x3a2604, flatShading: true });
    const wood = new THREE.MeshLambertMaterial({ color: COLORS.wood, flatShading: true });
    const iron = new THREE.MeshLambertMaterial({ color: COLORS.iron, flatShading: true });
    for (const [k, items] of Object.entries(exp.floorLoot)) {
      if (!items.length || !this.explored.has(k)) continue;
      const c = parseSquareKey(k);
      const g = new THREE.Group();
      const n = Math.min(6, 2 + items.length);
      for (let i = 0; i < n; i++) {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 6), coin);
        m.position.set((i % 3) * 0.08 - 0.08, 0.01 + Math.floor(i / 3) * 0.022, Math.floor(i / 3) * 0.04);
        g.add(m);
      }
      g.position.copy(squareCenter(c)).add(new THREE.Vector3(0.28, 0, 0.28));
      g.userData.square = k;
      this.props.add(g);
    }
    for (const ch of exp.chests) {
      const k = squareKey(ch.pos);
      if (!this.explored.has(k)) continue;
      const g = new THREE.Group();
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.2, 0.24), wood);
      box.position.y = 0.1;
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.36, 6, 1, false, 0, Math.PI), wood);
      lid.rotation.z = Math.PI / 2;
      lid.position.y = 0.2;
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.33, 0.26), iron);
      band.position.y = 0.15;
      g.add(box, lid, band);
      g.position.copy(squareCenter(ch.pos)).add(new THREE.Vector3(-0.25, 0, -0.25));
      g.userData.square = k;
      this.props.add(g);
    }
    for (const [k, turns] of Object.entries(exp.smoke)) {
      if (!turns) continue;
      const c = parseSquareKey(k);
      const mat = new THREE.MeshLambertMaterial({ color: 0x8a8a90, transparent: true, opacity: 0.55, depthWrite: false, flatShading: true });
      const g = new THREE.Group();
      for (let i = 0; i < 6; i++) {
        const p = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22 + (i % 3) * 0.06, 0), mat);
        p.position.set(Math.sin(i * 2.1) * 0.25, 0.25 + (i % 2) * 0.25, Math.cos(i * 1.7) * 0.25);
        g.add(p);
      }
      g.position.copy(squareCenter(c));
      g.userData.square = k;
      this.props.add(g);
    }
    for (const ch of exp.charges) {
      const g = new THREE.Group();
      const keg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.2, 8), wood);
      keg.position.y = 0.1;
      const fuse = new THREE.Mesh(new THREE.SphereGeometry(0.03, 4, 3), new THREE.MeshBasicMaterial({ color: 0xffd060 }));
      fuse.position.y = 0.23;
      g.add(keg, fuse);
      const [a, b] = edgeSquares(ch.edge);
      const toward = sameSquare(a, ch.pos) ? b : a;
      g.position.copy(squareCenter(ch.pos)).lerp(squareCenter(toward), 0.32);
      g.userData.square = squareKey(ch.pos);
      this.props.add(g);
    }
    this.refreshProps();
  }

  private refreshProps(): void {
    for (const p of this.props.children) {
      const k = p.userData.square as string;
      p.visible = parseSquareKey(k).level === this.shownLevel;
    }
  }

  private setContacts(vis: Visibility): void {
    this.contacts.clear();
    for (const c of vis.contacts) {
      const g = new THREE.Group();
      const disk = new THREE.Mesh(new THREE.CircleGeometry(0.34, 12).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: COLORS.danger, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
      disk.position.y = 0.08;
      g.add(disk);
      const q = glyphSprite('?', '#ff1f2d', 0.55);
      q.position.y = 0.55;
      g.add(q);
      g.position.copy(squareCenter(c.pos, 0));
      g.userData.level = c.pos.level;
      g.userData.unitId = c.unitId;
      this.contacts.add(g);
    }
    this.refreshContacts();
  }

  private refreshContacts(): void {
    for (const g of this.contacts.children) g.visible = g.userData.level === this.shownLevel;
  }

  /** Units shown: right level; enemies only where the player can see. */
  private refreshUnitVisibility(): void {
    for (const v of this.views.values()) {
      const onLevel = v.coord.level === this.shownLevel;
      let show = onLevel && this.shownUnitsFilter(v.unit);
      if (v.unit.side === 'castle' && !this.visible.has(squareKey(v.coord)) && !v.dying) show = false;
      v.root.visible = show;
    }
    this.refreshProps();
  }

  /** Recompute fan offsets for every square. */
  private layoutAll(animate: boolean): Promise<void> {
    const bySquare = new Map<string, UnitView[]>();
    for (const v of this.views.values()) {
      if (v.dying) continue;
      const k = squareKey(v.coord);
      const list = bySquare.get(k) ?? [];
      list.push(v);
      bySquare.set(k, list);
    }
    const jobs: Promise<void>[] = [];
    for (const [k, list] of bySquare) {
      const c = parseSquareKey(k);
      list.sort((a, b) => (a.unit.side === b.unit.side ? a.unit.id.localeCompare(b.unit.id) : a.unit.side === 'player' ? -1 : 1));
      const offs = fanOffsets(list.length);
      list.forEach((v, i) => {
        const [ox, oz] = offs[i] ?? [0, 0];
        v.slot.set(ox, 0, oz);
        const spread = list.length > 1 ? 0.55 : 1;
        if (spread !== v.spread) {
          v.spread = spread;
          v.layout(false);
        }
        const target = squareCenter(c, 0).add(v.slot);
        if (v.busy) return;
        if (!animate) v.root.position.copy(target);
        else {
          const from = v.root.position.clone();
          if (from.distanceTo(target) > 0.01) jobs.push(this.clock.tween(0.2, (t) => v.root.position.lerpVectors(from, target, easeOutCubic(t))));
        }
      });
    }
    return Promise.all(jobs).then(() => undefined);
  }

  // ------------------------------------------------------------ highlights

  setSelected(unitId: string | null): void {
    this.selectedId = unitId;
    if (!unitId) this.ring.visible = false;
  }

  setReachable(squares: Coord[]): void {
    const m = new THREE.Matrix4();
    let n = 0;
    for (const c of squares) {
      if (c.level !== this.shownLevel || n >= 400) continue;
      m.makeTranslation(c.x + 0.5, levelY(c.level) + FLOOR_TOP + 0.012, c.y + 0.5);
      this.reachMesh.setMatrixAt(n++, m);
    }
    this.reachMesh.count = n;
    this.reachMesh.instanceMatrix.needsUpdate = true;
  }

  setPath(path: Coord[]): void {
    const m = new THREE.Matrix4();
    let n = 0;
    for (const c of path) {
      if (c.level !== this.shownLevel || n >= 64) continue;
      m.makeTranslation(c.x + 0.5, levelY(c.level) + FLOOR_TOP + 0.02, c.y + 0.5);
      this.pathMesh.setMatrixAt(n++, m);
    }
    this.pathMesh.count = n;
    this.pathMesh.instanceMatrix.needsUpdate = true;
  }

  setTargets(squares: Coord[]): void {
    const m = new THREE.Matrix4();
    let n = 0;
    for (const c of squares) {
      if (c.level !== this.shownLevel || n >= 64) continue;
      m.makeTranslation(c.x + 0.5, levelY(c.level) + FLOOR_TOP + 0.025, c.y + 0.5);
      this.targetMesh.setMatrixAt(n++, m);
    }
    this.targetMesh.count = n;
    this.targetMesh.instanceMatrix.needsUpdate = true;
  }

  setHover(c: Coord | null, danger = false): void {
    if (!c || c.level !== this.shownLevel) {
      this.hoverMesh.visible = false;
      return;
    }
    this.hoverMesh.visible = true;
    (this.hoverMesh.material as THREE.MeshBasicMaterial).color.setHex(danger ? COLORS.danger : COLORS.parchment);
    this.hoverMesh.position.set(c.x + 0.5, levelY(c.level) + FLOOR_TOP + 0.03, c.y + 0.5);
  }

  // ------------------------------------------------------------ picking

  private bindPointer(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('pointermove', (e) => {
      const { coord, unitId } = this.pick(e);
      const changed = !sameMaybe(coord, this.hoverCoord) || unitId !== this.hoverUnit;
      this.hoverCoord = coord;
      this.hoverUnit = unitId;
      if (changed) this.hooks.hover(coord, unitId);
    });
    canvas.addEventListener('pointerleave', () => {
      this.hoverCoord = null;
      this.hoverUnit = null;
      this.hooks.hover(null, null);
    });
    canvas.addEventListener('pointerdown', (e) => {
      this.downAt = { x: e.clientX, y: e.clientY, button: e.button };
    });
    canvas.addEventListener('pointerup', (e) => {
      const d = this.downAt;
      this.downAt = null;
      if (!d || d.button !== e.button) return;
      if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 6) return;
      if (e.button !== 0 && e.button !== 2) return;
      if (e.button === 2 && this.rig.dragged) return;
      const { coord, unitId } = this.pick(e);
      this.hooks.click(coord, unitId, e);
    });
  }

  pick(e: { clientX: number; clientY: number }): { coord: Coord | null; unitId: string | null } {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.rig.camera);
    // Units first.
    const objs: THREE.Object3D[] = [];
    for (const v of this.views.values()) if (v.root.visible) objs.push(...v.pickables());
    const hits = this.raycaster.intersectObjects(objs, false);
    let unitId: string | null = null;
    let coord: Coord | null = null;
    if (hits.length) {
      unitId = (hits[0]!.object.userData.unitId as string) ?? null;
      const v = unitId ? this.views.get(unitId) : undefined;
      if (v) coord = { ...v.coord };
    }
    if (!coord) {
      const y = levelY(this.shownLevel) + FLOOR_TOP;
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y);
      const p = new THREE.Vector3();
      if (this.raycaster.ray.intersectPlane(plane, p)) {
        const lv = levelOf(this.map, this.shownLevel)!;
        const x = Math.floor(p.x);
        const yy = Math.floor(p.z);
        if (x >= lv.x0 && x < lv.x0 + lv.width && yy >= 0 && yy < lv.height) coord = { level: this.shownLevel, x, y: yy };
      }
    }
    // A contact marker under the pointer counts as that square.
    return { coord, unitId };
  }

  /** Screen position of a square (for anchoring DOM popups). */
  screenOf(c: Coord, lift = 0.8): { x: number; y: number } {
    const p = squareCenter(c, lift).project(this.rig.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
  }

  // ------------------------------------------------------------ feel

  shake(amount: number): void {
    if (this.feel.reduceShake) amount *= 0.2;
    this.rig.addShake(amount);
  }

  flash(at: THREE.Vector3, color: number, intensity: number): void {
    if (this.feel.reduceFlashes) intensity *= 0.3;
    this.flashLight.color.setHex(color);
    this.flashLight.position.copy(at).add(new THREE.Vector3(0, 0.8, 0));
    this.flashLight.intensity = intensity;
  }

  /** A number or word that slams in above a square and rises away. */
  floatText(c: Coord, text: string, kind: FloatKind = 'info', lift = 1.0): void {
    const el = document.createElement('div');
    el.className = `floater floater-${kind}`;
    el.textContent = text;
    this.fxLayer.appendChild(el);
    this.floaters.push({ el, world: squareCenter(c, lift), born: this.clock.real, life: kind === 'damage' ? 1.3 : 1.6, rise: kind === 'damage' ? 0.5 : 0.7 });
  }

  private updateFloaters(): void {
    if (!this.floaters.length) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const crect = this.container.getBoundingClientRect();
    const keep: Floater[] = [];
    for (const f of this.floaters) {
      const age = this.clock.real - f.born;
      const t = age / f.life;
      if (t >= 1) {
        f.el.remove();
        continue;
      }
      keep.push(f);
      const w = f.world.clone();
      w.y += easeOutCubic(t) * f.rise;
      const p = w.project(this.rig.camera);
      const x = rect.left - crect.left + ((p.x + 1) / 2) * rect.width;
      const y = rect.top - crect.top + ((1 - p.y) / 2) * rect.height;
      const slam = t < 0.12 ? 2.1 - easeOutBack(t / 0.12) * 1.1 : 1;
      const alpha = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
      f.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${slam})`;
      f.el.style.opacity = String(alpha);
      f.el.style.display = p.z > 1 ? 'none' : '';
    }
    this.floaters = keep;
  }

  // ------------------------------------------------------------ events

  /** Animate the 3D side of one event. Resolves when it has finished. */
  async playEvent(e: GameEvent): Promise<void> {
    switch (e.type) {
      case 'moved':
        return this.animMove(e.unitId, e.path);
      case 'attack':
        return this.animAttack(e.attackerId, e.targetId, e.kind, e.roll.wounds, e.roll.perfect);
      case 'wounded':
        return this.animWound(e.unitId, e.amount, e.menLeft);
      case 'died':
        return this.animDeath(e.unitId);
      case 'doorOpened':
        return this.animDoor(e.edge, true);
      case 'doorClosed':
        return this.animDoor(e.edge, false);
      case 'doorAttempt':
        return this.animDoorAttempt(e.unitId, e.edge, e.method, e.success);
      case 'doorDestroyed':
        return this.animDoorDestroyed(e.edge);
      case 'explosion':
        return this.animExplosion(e.at);
      case 'reinforcements':
        return this.animSpawn(e.unitIds, 'up');
      case 'freed':
        return this.animSpawn([e.unitId], 'fade');
      case 'exited':
        return this.animExit(e.unitId);
      case 'spotted': {
        const v = this.views.get(e.unitId);
        if (v) this.floatText(v.coord, 'SPOTTED', 'warn', 1.2);
        return this.clock.wait(0.25);
      }
      case 'woke': {
        const v = this.views.get(e.unitId);
        const u = this.lookup(e.unitId);
        const c = v?.coord ?? u?.pos;
        if (c && c.level === this.shownLevel && this.visible.has(squareKey(c))) {
          this.floatText(c, '!', 'warn', 1.1);
          return this.clock.wait(0.25);
        }
        return;
      }
      case 'focus': {
        const v = this.views.get(e.unitId);
        if (v && v.unit.side === 'player') this.floatText(v.coord, `+${e.amount} FOCUS`, 'focus', 1.3);
        return this.clock.wait(0.15);
      }
      case 'panicked': {
        const v = this.views.get(e.unitId);
        if (v && this.canSee(v)) {
          this.floatText(v.coord, 'PANIC', 'warn', 1.2);
          return this.clock.wait(0.35);
        }
        return;
      }
      case 'moraleHeld': {
        const v = this.views.get(e.unitId);
        if (v && this.canSee(v)) this.floatText(v.coord, 'holds', 'info', 1.2);
        return this.clock.wait(0.15);
      }
      case 'lootFound': {
        const v = this.views.get(e.unitId);
        if (v) {
          for (const it of e.items) this.floatText(v.coord, it.value ? `+${it.value.toLocaleString('en-US')} g` : it.name, 'gold', 1.2);
          this.flash(v.root.position, COLORS.gold, 3);
        }
        return this.clock.wait(0.4);
      }
      case 'trap': {
        const v = this.views.get(e.unitId);
        if (v) {
          this.floatText(v.coord, 'TRAP', 'warn', 1.3);
          this.flash(v.root.position, COLORS.danger, 4);
        }
        return this.clock.wait(0.3);
      }
      case 'searched': {
        const v = this.views.get(e.unitId);
        if (v) this.floatText(v.coord, e.complete ? 'searched' : 'searching…', 'info', 1.1);
        return this.clock.wait(0.3);
      }
      case 'spell':
        return this.animSpell(e.unitId, e.spell, e.target);
      default:
        return;
    }
  }

  private canSee(v: UnitView): boolean {
    return v.coord.level === this.shownLevel && (v.unit.side === 'player' || this.visible.has(squareKey(v.coord)));
  }

  /** Where the unit's root should sit when standing alone in a square. */
  private standPoint(c: Coord): THREE.Vector3 {
    return squareCenter(c, 0);
  }

  private async animMove(unitId: string, path: Coord[]): Promise<void> {
    const v = this.views.get(unitId);
    if (!v || !path.length) return;
    v.busy++;
    this.moving.add(unitId);
    const stepTime = v.unit.side === 'player' ? 0.17 : 0.14;
    // Free its old square's layout first.
    for (const c of path) {
      const from = v.root.position.clone();
      const levelChange = c.level !== v.coord.level;
      v.coord = { ...c };
      const to = this.standPoint(c);
      if (levelChange) {
        await this.clock.tween(0.12, (t) => v.setOpacity(1 - t));
        v.root.position.copy(to);
        if (this.followId === unitId) this.showLevel(c.level);
        this.refreshUnitVisibility();
        await this.clock.tween(0.12, (t) => v.setOpacity(t));
        continue;
      }
      v.face(to.x - from.x, to.z - from.z);
      this.refreshUnitVisibility();
      if (v.root.visible) this.onStep?.(v.unit);
      await this.clock.tween(stepTime, (t) => v.root.position.lerpVectors(from, to, easeInOut(t)));
    }
    this.moving.delete(unitId);
    v.busy--;
    this.refreshUnitVisibility();
    await this.layoutAll(true);
  }

  /** Optional per-step callback (footstep sounds). */
  onStep?: (u: Unit) => void;

  private async animAttack(attackerId: string, targetId: string, kind: 'melee' | 'missile', wounds: number, perfect: boolean): Promise<void> {
    const a = this.views.get(attackerId);
    const t = this.views.get(targetId);
    if (!a || !t) return;
    const from = a.root.position.clone();
    const to = t.root.position.clone();
    const dir = to.clone().sub(from);
    dir.y = 0;
    if (dir.lengthSq() > 1e-4) a.face(dir.x, dir.z);
    if (dir.lengthSq() > 1e-4) t.face(-dir.x, -dir.z);
    dir.normalize();
    const visible = this.canSee(a) || this.canSee(t);
    if (!visible) return;
    if (kind === 'melee') {
      await this.clock.tween(0.12, (k) => a.rig.position.copy(dir).multiplyScalar(-0.08 * easeOutCubic(k)));
      await this.clock.tween(0.08, (k) => a.rig.position.copy(dir).multiplyScalar(-0.08 + 0.36 * easeOutCubic(k)));
    } else {
      // Arrow volley.
      const mat = new THREE.MeshBasicMaterial({ color: 0xd8cdb0 });
      const arrows: THREE.Mesh[] = [];
      const n = Math.min(4, Math.max(1, a.aliveCount));
      for (let i = 0; i < n; i++) {
        const ar = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.32), mat);
        this.scene.add(ar);
        arrows.push(ar);
      }
      const start = from.clone().add(new THREE.Vector3(0, 0.45, 0));
      const end = to.clone().add(new THREE.Vector3(0, 0.35, 0));
      const dist = start.distanceTo(end);
      await this.clock.tween(Math.min(0.5, 0.12 + dist * 0.04), (k) => {
        arrows.forEach((ar, i) => {
          const kk = Math.max(0, Math.min(1, k * 1.15 - i * 0.05));
          const p = start.clone().lerp(end, kk);
          p.y += Math.sin(kk * Math.PI) * dist * 0.08;
          p.x += (i - n / 2) * 0.05;
          ar.position.copy(p);
          ar.lookAt(end);
        });
      });
      for (const ar of arrows) this.scene.remove(ar);
      mat.dispose();
    }
    if (wounds > 0) {
      this.clock.hitStop(perfect ? 120 : 60 + Math.min(60, wounds * 20));
      t.flash(new THREE.Color(1, 0.15, 0.1), 0.9);
      this.flash(to, COLORS.danger, perfect ? 7 : 3);
      this.shake(0.05 + wounds * 0.05 + (perfect ? 0.12 : 0));
    } else {
      this.floatText(t.coord, 'MISS', 'info', 1.0);
    }
    // Recoil the target, return the attacker.
    const recoil = dir.clone().multiplyScalar(wounds > 0 ? 0.12 : 0.04);
    await this.clock.tween(0.16, (k) => {
      const kk = easeOutCubic(k);
      if (kind === 'melee') a.rig.position.copy(dir).multiplyScalar(0.28 * (1 - kk));
      t.rig.position.copy(recoil).multiplyScalar(Math.sin(kk * Math.PI));
      t.flash(new THREE.Color(1, 0.15, 0.1), 0.9 * (1 - kk));
    });
    a.rig.position.set(0, 0, 0);
    t.rig.position.set(0, 0, 0);
  }

  private async animWound(unitId: string, amount: number, menLeft: number): Promise<void> {
    const v = this.views.get(unitId);
    if (!v) return;
    const seen = this.canSee(v);
    if (seen) {
      this.floatText(v.coord, `−${amount}`, 'damage', 0.9);
      this.shake(0.04 + amount * 0.06);
    }
    if (v.isSquad) {
      v.busy++;
      await v.setMen(menLeft, seen);
      v.busy--;
    } else if (seen) {
      await this.clock.tween(0.25, (k) => v.flash(new THREE.Color(1, 0.1, 0.1), 0.8 * (1 - k)));
    }
  }

  private async animDeath(unitId: string): Promise<void> {
    const v = this.views.get(unitId);
    if (!v) return;
    v.dying = true;
    v.busy++;
    const seen = this.canSee(v);
    if (seen) {
      if (!v.isSquad) this.shake(0.15);
      await Promise.all(v.figures.filter((f) => f.alive).map((f, i) => v.topple(f, i * 0.04)));
    }
    v.busy--;
    this.removeView(v);
    await this.layoutAll(true);
  }

  private doorView(edge: string) {
    const lvl = Number(edge.split(':')[0]) as LevelId;
    return this.levels.get(lvl)?.doors.get(edge);
  }

  private async animDoor(edge: string, open: boolean): Promise<void> {
    const d = this.doorView(edge);
    if (!d || d.state.destroyed) return;
    const from = d.slab.rotation.y;
    const to = open ? d.openAngle : 0;
    d.state.open = open;
    if (open) d.padlock.visible = false;
    this.onDoor?.(open);
    const lvl = Number(edge.split(':')[0]);
    if (lvl !== this.shownLevel) {
      d.slab.rotation.y = to;
      return;
    }
    await this.clock.tween(open ? 0.28 : 0.18, (t) => (d.slab.rotation.y = from + (to - from) * (open ? easeOutCubic(t) : t * t)));
    if (!open) this.shake(0.03);
  }

  /** Optional door sound hook (open = creak, close = slam). */
  onDoor?: (open: boolean) => void;

  private async animDoorAttempt(unitId: string, edge: string, method: string, success: boolean): Promise<void> {
    const d = this.doorView(edge);
    const v = this.views.get(unitId);
    if (v && d) {
      const dir = d.center.clone().sub(v.root.position);
      dir.y = 0;
      v.face(dir.x, dir.z);
      dir.normalize();
      if (method === 'smash' || method === 'chop') {
        await this.clock.tween(0.1, (k) => v.rig.position.copy(dir).multiplyScalar(0.25 * easeOutCubic(k)));
        this.shake(method === 'smash' ? 0.12 : 0.06);
        if (d.slab.visible) {
          const base = d.slab.rotation.y;
          await this.clock.tween(0.14, (k) => (d.slab.rotation.y = base + Math.sin(k * Math.PI * 3) * 0.06 * (1 - k)));
        }
        await this.clock.tween(0.12, (k) => v.rig.position.copy(dir).multiplyScalar(0.25 * (1 - k)));
        v.rig.position.set(0, 0, 0);
      } else if (method === 'pick') {
        await this.clock.wait(0.45);
      } else if (method === 'blast') {
        this.floatText(v.coord, 'CHARGE SET', 'warn', 1.2);
        await this.clock.wait(0.25);
      }
    }
    if (d && v && method !== 'blast') {
      if (success && (method === 'pick' || method === 'unlock')) {
        d.padlock.visible = false;
        d.state.locked = false;
        this.floatText(v.coord, 'unlocked', 'focus', 1.2);
      } else if (!success) this.floatText(v.coord, method === 'chop' ? 'chop' : 'holds', 'info', 1.2);
    }
  }

  private async animDoorDestroyed(edge: string): Promise<void> {
    const d = this.doorView(edge);
    if (!d) return;
    d.state.destroyed = true;
    d.state.open = true;
    d.padlock.visible = false;
    this.flash(d.center, 0xffc070, 8);
    this.shake(0.22);
    this.clock.hitStop(90);
    // Fling the slab apart into splinters.
    const slab = d.slab;
    d.splinters.visible = true;
    const base = d.splinters.children.map((c) => c.position.clone());
    await this.clock.tween(0.35, (t) => {
      slab.scale.setScalar(Math.max(0.01, 1 - t));
      slab.position.y = t * 0.3;
      d.splinters.children.forEach((c, i) => {
        const b = base[i]!;
        c.position.set(b.x + Math.sin(i * 2.3) * 0.3 * (1 - t), b.y + Math.sin(t * Math.PI) * 0.4 * (1 - i * 0.08), b.z + Math.cos(i * 1.7) * 0.5 * t);
      });
    });
    slab.visible = false;
    slab.scale.setScalar(1);
    slab.position.y = 0;
  }

  private async animExplosion(at: Coord): Promise<void> {
    const c = squareCenter(at, 0.3);
    this.onExplosion?.();
    this.flash(c, 0xffb050, 40);
    this.shake(0.5);
    this.clock.hitStop(120);
    if (at.level !== this.shownLevel) return;
    const mat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffa040, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const s = new THREE.Sprite(mat);
    s.position.copy(c);
    this.scene.add(s);
    const debris = new THREE.Group();
    const dm = new THREE.MeshLambertMaterial({ color: COLORS.stone, flatShading: true });
    for (let i = 0; i < 14; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), dm);
      b.userData.v = new THREE.Vector3(Math.sin(i * 2.4) * 2, 2 + (i % 4), Math.cos(i * 1.3) * 2);
      debris.add(b);
    }
    debris.position.copy(c);
    this.scene.add(debris);
    await this.clock.tween(0.6, (t) => {
      s.scale.setScalar(0.5 + easeOutCubic(t) * 4);
      mat.opacity = 1 - t;
      for (const b of debris.children) {
        const v = b.userData.v as THREE.Vector3;
        b.position.set(v.x * t, v.y * t - 6 * t * t, v.z * t);
        b.rotation.x = t * 8;
      }
    });
    this.scene.remove(s, debris);
    mat.dispose();
    dm.dispose();
  }

  onExplosion?: () => void;

  private async animSpawn(ids: string[], how: 'up' | 'fade'): Promise<void> {
    const views: UnitView[] = [];
    for (const id of ids) {
      const u = this.lookup(id);
      if (!u || this.views.has(id)) continue;
      const v = this.addView(u);
      views.push(v);
    }
    this.refreshUnitVisibility();
    await this.layoutAll(false);
    const seen = views.filter((v) => this.canSee(v));
    if (!seen.length) return;
    await this.clock.tween(0.4, (t) => {
      for (const v of seen) {
        if (how === 'up') v.rig.position.y = -0.6 * (1 - easeOutCubic(t));
        v.setOpacity(t);
      }
    });
    for (const v of seen) v.rig.position.y = 0;
  }

  private async animExit(unitId: string): Promise<void> {
    const v = this.views.get(unitId);
    if (!v) return;
    v.busy++;
    this.floatText(v.coord, 'EXTRACTED', 'focus', 1.2);
    await this.clock.tween(0.45, (t) => {
      v.setOpacity(1 - t);
      v.rig.position.y = t * 0.3;
    });
    v.busy--;
    this.removeView(v);
  }

  private async animSpell(unitId: string, spell: string, target?: Coord): Promise<void> {
    const v = this.views.get(unitId) ?? null;
    const caster = v?.root.position.clone();
    const color = spell === 'fireball' ? 0xff6a20 : spell === 'pyrotechnics' ? 0xffd040 : spell === 'combat' ? 0xff4040 : spell === 'esp' ? 0x80c0ff : spell === 'smokescreen' ? 0xaaaaaa : 0xb48cff;
    if (caster && v && this.canSee(v)) this.flash(caster, color, 4);
    if (target && caster && (spell === 'fireball' || spell === 'pyrotechnics')) {
      const mat = new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      const s = new THREE.Sprite(mat);
      s.scale.setScalar(0.6);
      this.scene.add(s);
      const from = caster.clone().add(new THREE.Vector3(0, 0.6, 0));
      const to = squareCenter(target, 0.4);
      await this.clock.tween(0.35, (t) => s.position.lerpVectors(from, to, t));
      this.flash(to, color, spell === 'fireball' ? 20 : 10);
      this.shake(spell === 'fireball' ? 0.3 : 0.1);
      await this.clock.tween(0.25, (t) => {
        s.scale.setScalar(0.6 + t * 2.5);
        mat.opacity = 1 - t;
      });
      this.scene.remove(s);
      mat.dispose();
    } else if (v) {
      const names: Record<string, string> = { esp: 'ESP', combat: 'COMBAT', smokescreen: 'SMOKE', unlock: 'UNLOCK' };
      this.floatText(target ?? v.coord, names[spell] ?? spell.toUpperCase(), 'focus', 1.3);
      await this.clock.wait(0.35);
    }
  }

  /** Hide or show the figures (between screens). */
  setActive(active: boolean): void {
    this.renderer.domElement.style.visibility = active ? 'visible' : 'hidden';
    this.rig.enabled = active;
    this.active = active;
  }

  dispose(): void {
    this.disposed = true;
    this.resizeObs.disconnect();
    this.renderer.dispose();
  }

  /** Debug helper: label of the hovered square. */
  hoverLabel(): string {
    return this.hoverCoord ? label(this.hoverCoord) : '';
  }

  static readonly LEVEL_GAP = LEVEL_GAP;
}

function sameMaybe(a: Coord | null, b: Coord | null): boolean {
  if (!a || !b) return a === b;
  return sameSquare(a, b);
}

function squareFrame(size: number, w: number): THREE.BufferGeometry {
  const s = size / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-s, -s).lineTo(s, -s).lineTo(s, s).lineTo(-s, s).lineTo(-s, -s);
  const hole = new THREE.Path();
  const i = s - w;
  hole.moveTo(-i, -i).lineTo(-i, i).lineTo(i, i).lineTo(i, -i).lineTo(-i, -i);
  shape.holes.push(hole);
  return new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
}

function edgeKindFromKey(map: CastleMap, key: string, a: Coord): EdgeKind {
  const [, kind] = key.split(':');
  const lv = levelOf(map, a.level);
  if (!lv) return 'wall';
  const [x, y] = key.split(':')[2]!.split(',').map(Number) as [number, number];
  if (kind === 'h') return lv.hEdges[y * lv.width + (x - lv.x0)] ?? 'wall';
  return lv.vEdges[y * (lv.width + 1) + (x - lv.x0)] ?? 'wall';
}
