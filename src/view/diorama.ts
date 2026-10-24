// The 3D diorama for V3. Owns the three.js scene, the hex levels, figures,
// props, fog of war, lights, highlights, picking, overlays (HP pips, intent
// icons, room labels, floating numbers) and the 3D side of every event.
// Knows nothing about the HUD panels; the UI layer drives it.

import * as THREE from 'three';
import type { Visibility } from '../game/api';
import { hexKey, hexToWorld, posKey, range, samePos, worldToHex, type Pos } from '../game/hex';
import type { Brightness, CastleDef, GameEvent, GameState, HeroInDelve, Intent, Item, Monster } from '../game/types';
import { AnimClock } from './anim';
import { CameraRig } from './camera';
import type { ModelKey } from './figures';
import { LevelView } from './level';
import { makeChest, makeCoins, makeHeirloom, makeRope, makeSack, makeTrap, type PropView } from './props';
import { glowTexture } from './sprites';
import { UnitView, type UnitSide } from './unit';
import { COLORS, FLOOR_TOP, HEX, easeInOut, easeOutBack, easeOutCubic, levelY } from './world';
import { CUTAWAY, setMaterialFog } from './fog';

const MAX_LIGHTS = 10;

export interface DioramaHooks {
  hover(at: Pos | null, unitId: string | null): void;
  click(at: Pos | null, unitId: string | null, ev: PointerEvent): void;
  levelChanged(level: number): void;
}

export type HighlightStyle = 'walk' | 'sneak' | 'target' | 'ally' | 'danger';

export type FloatKind = 'damage' | 'heal' | 'info' | 'warn' | 'gold' | 'miss';

interface Floater {
  el: HTMLElement;
  world: THREE.Vector3;
  born: number;
  life: number;
  rise: number;
}

interface Tag {
  el: HTMLElement;
  unitId: string;
}

/** Hex outline (pointy-top) lying flat. */
function hexRing(rIn: number, rOut: number): THREE.BufferGeometry {
  return new THREE.RingGeometry(rIn, rOut, 6, 1, Math.PI / 6).rotateX(-Math.PI / 2);
}

const HIGHLIGHT_COLORS: Record<HighlightStyle, number> = {
  walk: 0xffd08a,
  sneak: 0x9ec0ff,
  target: COLORS.danger,
  ally: 0x7fbf5a,
  danger: COLORS.danger,
};

export class Diorama {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly clock = new AnimClock();
  readonly rig: CameraRig;
  readonly fx: HTMLElement;
  levels = new Map<number, LevelView>();
  shownLevel = 1;
  castle: CastleDef | null = null;
  reduceShake = false;

  private state: GameState | null = null;
  private vis: Visibility = { visible: new Set(), explored: new Set(), lit: new Set() };
  private units = new Map<string, UnitView>();
  private props = new Map<string, PropView>();
  private propGroup = new THREE.Group();
  private overlay = new THREE.Group();
  private lights: THREE.PointLight[] = [];
  private flashLight: THREE.PointLight;
  private ambient: THREE.AmbientLight;
  private hemi: THREE.HemisphereLight;
  private highlights = new Map<HighlightStyle, THREE.InstancedMesh>();
  private pathDots: THREE.InstancedMesh;
  private pathEnd: THREE.Mesh;
  private hoverMesh: THREE.Mesh;
  private ring: THREE.Mesh;
  private rippleMesh: THREE.InstancedMesh;
  private rippleData: { center: THREE.Vector3; count: number } | null = null;
  private intentLines = new THREE.Group();
  private selectedId: string | null = null;
  private followId: string | null = null;
  private moving = new Set<string>();
  private floaters: Floater[] = [];
  private tags = new Map<string, Tag>();
  private intentTags = new Map<string, HTMLElement>();
  private roomTags: { el: HTMLElement; at: THREE.Vector3; key: string; level: number }[] = [];
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private lastTime = performance.now();
  private hoverPos: Pos | null = null;
  private hoverUnit: string | null = null;
  private downAt: { x: number; y: number; button: number } | null = null;
  private active = true;
  private brightness: Brightness = 'bright';
  /** Hero ids whose torch is lit. */
  private torches = new Set<string>();
  private lanternBearer: string | null = null;
  private litBraziers = new Set<string>();
  private extraVisible: Set<string> | null = null;
  private sparks: THREE.Points;

  constructor(
    private readonly container: HTMLElement,
    private readonly hooks: DioramaHooks,
  ) {
    const canvas = document.createElement('canvas');
    canvas.className = 'dio-canvas';
    container.appendChild(canvas);
    this.fx = document.createElement('div');
    this.fx.className = 'dio-fx';
    container.appendChild(this.fx);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(COLORS.void, 1);
    this.scene.background = new THREE.Color(COLORS.void);
    this.rig = new CameraRig(canvas);

    // Near-black ambient; light comes from the lantern, torches and braziers.
    this.ambient = new THREE.AmbientLight(0x3a3f4a, 0.45);
    this.hemi = new THREE.HemisphereLight(0x3a3046, 0x0a0806, 0.25);
    const rim = new THREE.DirectionalLight(COLORS.cold, 0.22);
    rim.position.set(-6, 9, -8);
    this.scene.add(this.ambient, this.hemi, rim, rim.target);
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const l = new THREE.PointLight(COLORS.emberHot, 0, 10, 1.3);
      this.scene.add(l);
      this.lights.push(l);
    }
    this.flashLight = new THREE.PointLight(0xffd2a0, 0, 20, 1.2);
    this.scene.add(this.flashLight);
    this.scene.add(this.propGroup, this.overlay);

    // Overlays.
    for (const style of Object.keys(HIGHLIGHT_COLORS) as HighlightStyle[]) {
      const fill = style === 'walk' || style === 'sneak';
      const m = new THREE.InstancedMesh(
        fill ? hexRing(0.7, 0.8) : hexRing(0.68, 0.88),
        new THREE.MeshBasicMaterial({ color: HIGHLIGHT_COLORS[style], transparent: true, opacity: fill ? 0.6 : 0.9, depthWrite: false }),
        600,
      );
      m.count = 0;
      m.renderOrder = 2;
      m.frustumCulled = false;
      this.highlights.set(style, m);
      this.overlay.add(m);
    }
    this.pathDots = new THREE.InstancedMesh(new THREE.CircleGeometry(0.11, 6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: COLORS.emberHot, transparent: true, opacity: 0.95, depthWrite: false }), 64);
    this.pathDots.count = 0;
    this.pathDots.renderOrder = 3;
    this.pathDots.frustumCulled = false;
    this.pathEnd = new THREE.Mesh(hexRing(0.66, 0.84), new THREE.MeshBasicMaterial({ color: COLORS.emberHot, transparent: true, opacity: 0.95, depthWrite: false }));
    this.pathEnd.visible = false;
    this.pathEnd.renderOrder = 3;
    this.hoverMesh = new THREE.Mesh(hexRing(0.86, 0.96), new THREE.MeshBasicMaterial({ color: COLORS.parchment, transparent: true, opacity: 0.8, depthWrite: false }));
    this.hoverMesh.visible = false;
    this.hoverMesh.renderOrder = 4;
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.62, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: COLORS.ember, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide }));
    this.ring.visible = false;
    this.ring.renderOrder = 3;
    this.rippleMesh = new THREE.InstancedMesh(hexRing(0.74, 0.86), new THREE.MeshBasicMaterial({ color: 0x9ec8ff, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }), 400);
    this.rippleMesh.count = 0;
    this.rippleMesh.renderOrder = 2;
    this.rippleMesh.frustumCulled = false;
    this.overlay.add(this.pathDots, this.pathEnd, this.hoverMesh, this.ring, this.rippleMesh, this.intentLines);

    // Dust motes drifting in the lantern light.
    const n = 160;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 16;
      pos[i * 3 + 1] = Math.random() * 3;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 16;
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.sparks = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xffd9a0, size: 0.05, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending, map: glowTexture() }));
    this.sparks.frustumCulled = false;
    this.scene.add(this.sparks);

    this.bindPointer(canvas);
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.loop();
  }

  // ------------------------------------------------------------ castle and levels

  setCastle(def: CastleDef): void {
    if (this.castle === def) return;
    for (const lv of this.levels.values()) this.scene.remove(lv.group);
    for (const t of this.roomTags) t.el.remove();
    this.roomTags = [];
    this.levels.clear();
    this.castle = def;
    for (const ld of def.levels) {
      const lv = new LevelView(ld, def);
      this.levels.set(ld.level, lv);
      this.scene.add(lv.group);
      for (const l of lv.labels) {
        const el = document.createElement('div');
        el.className = 'room-label';
        el.textContent = l.text;
        this.fx.appendChild(el);
        this.roomTags.push({ el, at: l.at, key: l.key, level: ld.level });
      }
    }
    this.showLevel(def.levels[0]?.level ?? 1, true);
  }

  showLevel(level: number, instant = false): void {
    const lv = this.levels.get(level);
    if (!lv) return;
    const changed = level !== this.shownLevel;
    this.shownLevel = level;
    for (const [n, v] of this.levels) v.group.visible = n === level;
    const y = levelY(level);
    this.rig.bounds.set(new THREE.Vector3(lv.min.x - 2, y - 1, lv.min.y - 2), new THREE.Vector3(lv.max.x + 2, y + 1, lv.max.y + 2));
    this.rig.setHeight(y, instant);
    if (instant && !this.state?.delve) this.frameLevel();
    this.refreshUnits();
    this.refreshProps();
    if (changed) this.hooks.levelChanged(level);
  }

  frameLevel(): void {
    const lv = this.levels.get(this.shownLevel);
    if (!lv) return;
    const y = levelY(this.shownLevel);
    this.rig.focus(new THREE.Vector3((lv.min.x + lv.max.x) / 2, y, (lv.min.y + lv.max.y) / 2), true);
    this.rig.distance = Math.max(14, Math.min(60, Math.max(lv.max.x - lv.min.x, lv.max.y - lv.min.y) * 1.1));
  }

  lookAt(p: Pos, instant = false): void {
    if (p.level !== this.shownLevel) this.showLevel(p.level, instant);
    const w = hexToWorld(p, HEX);
    this.rig.focus(new THREE.Vector3(w.x, levelY(p.level), w.z), instant);
  }

  setFollow(id: string | null): void {
    this.followId = id;
  }

  select(id: string | null): void {
    this.selectedId = id;
  }

  setActive(on: boolean): void {
    this.active = on;
    this.fx.classList.toggle('hidden', !on);
  }

  // ------------------------------------------------------------ frame

  private resize(): void {
    const w = this.container.clientWidth || innerWidth;
    const h = this.container.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false);
    this.rig.resize(w, h);
  }

  private loop = (): void => {
    const now = performance.now();
    const dtReal = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.clock.tick(dtReal);
    const t = this.clock.real;
    if (this.followId) {
      const v = this.units.get(this.followId);
      if (v && v.at.level === this.shownLevel) {
        const p = v.root.position;
        this.rig.focus(new THREE.Vector3(p.x, levelY(this.shownLevel), p.z));
      }
    }
    this.rig.update(dtReal, t);
    this.updateCutaway();
    if (this.active) {
      for (const v of this.units.values()) v.idle(this.clock.time, this.moving.has(v.id));
      this.updateLights(t);
      this.updateOverlay(t, dtReal);
      this.renderer.render(this.scene, this.rig.camera);
      this.updateDom();
    }
    requestAnimationFrame(this.loop);
  };

  cutaway = true;

  private updateCutaway(): void {
    const cam = this.rig.camera.position;
    const tgt = this.rig.currentTarget();
    CUTAWAY.center.value.copy(tgt);
    const d = new THREE.Vector3(cam.x - tgt.x, 0, cam.z - tgt.z);
    if (d.lengthSq() < 1e-6) d.set(0, 0, 1);
    CUTAWAY.dir.value.copy(d.normalize());
    // Steep top-down views need no cut.
    CUTAWAY.height.value = this.cutaway ? 0.3 : 99;
  }

  /** Render one frame now (for screenshots in a throttled headless tab). */
  renderNow(): void {
    this.rig.update(1, this.clock.real);
    this.updateLights(this.clock.real);
    this.renderer.render(this.scene, this.rig.camera);
    this.updateDom();
  }

  private updateLights(t: number): void {
    type Src = { at: THREE.Vector3; radius: number; color: number; power: number; seed: number };
    const srcs: Src[] = [];
    const radiusOf: Record<Brightness, number> = { bright: 4, dim: 3, dark: 2, pitch: 0 };
    const bearer = this.lanternBearer ? this.units.get(this.lanternBearer) : undefined;
    if (bearer && bearer.shown && bearer.at.level === this.shownLevel && !bearer.dead) {
      const r = radiusOf[this.brightness];
      if (r > 0) srcs.push({ at: bearer.root.position.clone().add(new THREE.Vector3(0.15, 1.3, 0.1)), radius: r, color: this.brightness === 'bright' ? 0xffb862 : this.brightness === 'dim' ? 0xf09a48 : 0xd0763a, power: 1, seed: 0 });
    }
    for (const id of this.torches) {
      const v = this.units.get(id);
      if (!v || !v.shown || v.at.level !== this.shownLevel || id === this.lanternBearer) continue;
      srcs.push({ at: v.root.position.clone().add(new THREE.Vector3(-0.1, 1.2, 0)), radius: 2, color: 0xff9a40, power: 0.9, seed: srcs.length * 1.7 });
    }
    const lv = this.levels.get(this.shownLevel);
    if (lv) {
      const target = this.rig.target;
      const bz = [...lv.braziers.values()].filter((b) => b.lit).sort((a, b) => a.center.distanceToSquared(target) - b.center.distanceToSquared(target));
      for (const b of bz) srcs.push({ at: b.center.clone().add(new THREE.Vector3(0, 0.3, 0)), radius: 3, color: 0xff8a30, power: 1, seed: b.center.x });
    }
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const l = this.lights[i]!;
      const s = srcs[i];
      if (!s) {
        l.intensity = 0;
        continue;
      }
      const flicker = 1 + Math.sin(t * 11 + s.seed) * 0.05 + Math.sin(t * 23 + s.seed * 2) * 0.03 + Math.sin(t * 5.3 + s.seed) * 0.04;
      const reach = s.radius * Math.sqrt(3) * HEX + 2.2;
      l.color.setHex(s.color);
      l.distance = reach;
      l.decay = 1.1;
      l.intensity = (3 + s.radius * 1.3) * s.power * flicker;
      l.position.copy(s.at);
      l.position.y += Math.sin(t * 7 + s.seed) * 0.02;
    }
    // Braziers flicker.
    if (lv)
      for (const b of lv.braziers.values())
        if (b.lit)
          b.fire.children.forEach((c, i) => {
            c.scale.y = 1 + Math.sin(t * (9 + i * 3) + i) * 0.18;
            c.rotation.y = t * (1 + i);
          });
    this.flashLight.intensity *= 0.86;
    // Dust follows the camera target.
    this.sparks.position.set(this.rig.target.x, levelY(this.shownLevel) + 0.2, this.rig.target.z);
    this.sparks.rotation.y = t * 0.02;
  }

  private updateOverlay(t: number, dt: number): void {
    // Selection ring.
    const sel = this.selectedId ? this.units.get(this.selectedId) : undefined;
    if (sel && sel.shown && sel.root.visible) {
      this.ring.visible = true;
      this.ring.position.set(sel.root.position.x, sel.root.position.y + 0.03, sel.root.position.z);
      this.ring.scale.setScalar(1 + Math.sin(t * 4) * 0.04);
    } else this.ring.visible = false;
    const tm = this.highlights.get('target')!.material as THREE.MeshBasicMaterial;
    tm.opacity = 0.55 + 0.35 * Math.sin(t * 6);
    // Ripple: hex rings fade outward in a wave.
    if (this.rippleData && this.rippleMesh.count) {
      const m = this.rippleMesh.material as THREE.MeshBasicMaterial;
      m.opacity = 0.25 + 0.15 * Math.sin(t * 5);
    }
    void dt;
  }

  // ------------------------------------------------------------ DOM overlay

  private project(v: THREE.Vector3): { x: number; y: number; behind: boolean } {
    const p = v.clone().project(this.rig.camera);
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    return { x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h, behind: p.z > 1 };
  }

  private updateDom(): void {
    const now = this.clock.real;
    // Floaters.
    this.floaters = this.floaters.filter((f) => {
      const age = now - f.born;
      if (age > f.life) {
        f.el.remove();
        return false;
      }
      const p = this.project(f.world.clone().add(new THREE.Vector3(0, age * f.rise, 0)));
      f.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
      f.el.style.opacity = String(age > f.life * 0.7 ? 1 - (age - f.life * 0.7) / (f.life * 0.3) : 1);
      return true;
    });
    // Unit tags (HP pips) and intents.
    for (const [id, tag] of this.tags) {
      const v = this.units.get(id);
      if (!v || !v.root.visible || v.dead) {
        tag.el.style.display = 'none';
        continue;
      }
      const p = this.project(v.root.position.clone().add(new THREE.Vector3(0, v.height + 0.35, 0)));
      tag.el.style.display = p.behind ? 'none' : '';
      tag.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
    }
    for (const [id, el] of this.intentTags) {
      const v = this.units.get(id);
      if (!v || !v.root.visible || v.dead) {
        el.style.display = 'none';
        continue;
      }
      const p = this.project(v.root.position.clone().add(new THREE.Vector3(0, v.height + 0.35, 0)));
      el.style.display = p.behind ? 'none' : '';
      el.style.transform = `translate(${p.x}px, ${p.y - 22}px) translate(-50%, -100%)`;
    }
    for (const r of this.roomTags) {
      const show = r.level === this.shownLevel && this.vis.explored.has(r.key) && !!this.state?.delve;
      if (!show) {
        r.el.style.display = 'none';
        continue;
      }
      const p = this.project(r.at);
      r.el.style.display = p.behind ? 'none' : '';
      r.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
    }
  }

  floatText(at: Pos | THREE.Vector3, text: string, kind: FloatKind = 'info', life = 1.3): void {
    const el = document.createElement('div');
    el.className = `floater floater-${kind}`;
    el.textContent = text;
    this.fx.appendChild(el);
    const world = at instanceof THREE.Vector3 ? at.clone() : this.worldOf(at, 1.6);
    this.floaters.push({ el, world, born: this.clock.real, life, rise: kind === 'damage' ? 0.5 : 0.7 });
  }

  private worldOf(p: Pos, lift = 0): THREE.Vector3 {
    const w = hexToWorld(p, HEX);
    const lv = this.levels.get(p.level);
    const top = lv?.top.get(hexKey(p)) ?? FLOOR_TOP;
    return new THREE.Vector3(w.x, levelY(p.level) + top + lift, w.z);
  }

  // ------------------------------------------------------------ state sync

  /** Snap everything to `state` (no animation). */
  sync(state: GameState, vis: Visibility, brightness?: Brightness): void {
    this.state = state;
    this.vis = vis;
    this.extraVisible = null;
    const d = state.delve;
    for (const lv of this.levels.values()) lv.applyFog(vis.visible, vis.explored);
    this.applyLitFog();
    if (!d) {
      for (const v of [...this.units.values()]) this.removeUnit(v.id);
      for (const id of [...this.props.keys()]) this.removeProp(id);
      this.clearIntents();
      return;
    }
    this.brightness = brightness ?? (d.light > 36 ? 'bright' : d.light >= 19 ? 'dim' : d.light >= 1 ? 'dark' : 'pitch');
    this.lanternBearer = d.lanternBearer;
    this.torches = new Set(d.heroes.filter((h) => h.torch > 0 && h.status === 'active').map((h) => h.heroId));
    this.syncUnits(state);
    this.syncWorld(state);
    this.refreshUnits();
    this.refreshProps();
  }

  /** Visible-but-unlit hexes look darker than lit ones. */
  private applyLitFog(): void {
    // Handled per instance via fog value 0.75 for unlit visible hexes.
    const vis = new Set<string>();
    const unlit = new Set<string>();
    for (const k of this.vis.visible) (this.vis.lit.has(k) ? vis : unlit).add(k);
    for (const lv of this.levels.values()) lv.applyFogLit(vis, unlit, this.vis.explored);
  }

  private modelFor(kind: string): ModelKey {
    return kind as ModelKey;
  }

  private ensureUnit(id: string, key: ModelKey, side: UnitSide, at: Pos, name: string): UnitView {
    let v = this.units.get(id);
    if (!v) {
      v = new UnitView(id, key, side, at, this.clock);
      this.units.set(id, v);
      this.scene.add(v.root);
      v.root.position.copy(this.worldOf(at));
      v.face(0, side === 'hero' ? -1 : 1);
      const el = document.createElement('div');
      el.className = `unit-tag tag-${side}`;
      el.dataset.id = id;
      el.title = name;
      this.fx.appendChild(el);
      this.tags.set(id, { el, unitId: id });
    }
    return v;
  }

  private removeUnit(id: string): void {
    const v = this.units.get(id);
    if (!v) return;
    this.scene.remove(v.root);
    v.dispose();
    this.units.delete(id);
    this.tags.get(id)?.el.remove();
    this.tags.delete(id);
    this.intentTags.get(id)?.remove();
    this.intentTags.delete(id);
  }

  private syncUnits(state: GameState): void {
    const d = state.delve!;
    const keep = new Set<string>();
    const place = (v: UnitView, at: Pos) => {
      if (v.busy) return;
      v.at = { ...at };
      v.root.position.copy(this.worldOf(at)).add(v.offset);
    };
    for (const h of d.heroes) {
      if (h.status === 'out' || h.status === 'dead') continue;
      const hero = state.campaign.roster.find((r) => r.id === h.heroId);
      const v = this.ensureUnit(h.heroId, (hero?.cls ?? 'sellsword') as ModelKey, 'hero', h.at, hero?.name ?? h.heroId);
      keep.add(h.heroId);
      place(v, h.at);
      v.lieDown(h.status === 'downed');
      v.dead = false;
      v.setOpacity(1);
      this.setTag(h.heroId, heroTag(h, hero?.maxHp ?? 10, h.heroId === d.lanternBearer));
    }
    for (const m of d.monsters) {
      if (m.hp <= 0) continue;
      const v = this.ensureUnit(m.id, this.modelFor(m.kind), 'monster', m.at, m.name);
      keep.add(m.id);
      place(v, m.at);
      v.dead = false;
      v.setOpacity(1);
      v.fig.rotation.z = 0;
      this.setTag(m.id, m.kind === 'gloam' ? '' : monsterTag(m));
    }
    if (d.rivals) {
      for (const r of d.rivals.members) {
        if (r.goneOut || r.hp <= 0 || d.round < d.rivals.entersRound) continue;
        const v = this.ensureUnit(r.id, 'sister', 'rival', r.at, r.name);
        keep.add(r.id);
        place(v, r.at);
        this.setTag(r.id, pipsHtml(r.hp, r.maxHp, d.rivals.stance === 'hostile' ? 'enemy' : 'rival'));
      }
    }
    if (d.prisoner && !d.prisoner.out && !d.prisoner.dead) {
      const p = d.prisoner;
      const v = this.ensureUnit(p.id, 'prisoner', 'prisoner', p.at, p.name);
      keep.add(p.id);
      place(v, p.at);
      this.setTag(p.id, pipsHtml(p.hp, 5, 'ally') + (p.freed ? '' : '<b class="tag-shackled">shackled</b>'));
    }
    for (const id of [...this.units.keys()]) if (!keep.has(id)) this.removeUnit(id);
  }

  private setTag(id: string, html: string): void {
    const t = this.tags.get(id);
    if (t && t.el.innerHTML !== html) t.el.innerHTML = html;
  }

  private ensureProp(key: string, make: () => PropView, at: Pos, rot = 0): PropView {
    let p = this.props.get(key);
    if (!p) {
      p = make();
      p.obj.position.copy(this.worldOf(at, -FLOOR_TOP));
      p.obj.rotation.y = rot;
      p.obj.userData.at = at;
      this.props.set(key, p);
      this.propGroup.add(p.obj);
    }
    return p;
  }

  private removeProp(key: string): void {
    const p = this.props.get(key);
    if (!p) return;
    this.propGroup.remove(p.obj);
    this.props.delete(key);
  }

  private syncWorld(state: GameState): void {
    const d = state.delve!;
    const keep = new Set<string>();
    // Doors.
    for (const [k, ds] of Object.entries(d.doors)) {
      const level = Number(k.split(':')[0]);
      const door = this.levels.get(level)?.doors.get(k);
      if (!door) continue;
      door.open = ds.open;
      door.hinge.rotation.y = ds.open ? -Math.PI * 0.55 : 0;
      door.padlock.visible = ds.locked && !ds.open;
    }
    // Braziers.
    this.litBraziers = new Set(d.lit);
    for (const lv of this.levels.values()) {
      for (const b of lv.braziers.values()) {
        b.lit = this.litBraziers.has(b.key);
        b.fire.visible = b.lit;
      }
      lv.setBlown(new Set(d.blown));
    }
    // Chests.
    for (const c of d.chests) {
      const key = `chest:${c.id}`;
      keep.add(key);
      const rot = (hashStr(c.id) % 6) * (Math.PI / 3);
      const p = this.ensureProp(key, () => makeChest(c.tier), c.at, rot);
      p.lid!.rotation.x = c.opened ? -1.9 : 0;
      p.padlock!.visible = c.locked && !c.opened;
      p.obj.userData.chest = c.id;
    }
    // Ground loot.
    for (const g of d.ground) {
      if (!g.items.length) continue;
      const key = `ground:${posKey(g.at)}`;
      keep.add(key);
      const kind = groundKind(g.items);
      const p = this.props.get(key);
      if (p && p.state !== kind) this.removeProp(key);
      const np = this.ensureProp(key, () => (kind === 'heirloom' ? makeHeirloom() : kind === 'gold' ? makeCoins(g.items.reduce((a, i) => a + i.amount, 0)) : makeSack()), g.at);
      np.state = kind;
    }
    // Traps (only when spotted).
    for (const [k, tr] of Object.entries(d.traps)) {
      if (!tr.spotted) continue;
      const key = `trap:${k}`;
      keep.add(key);
      const at = parsePos(k);
      this.ensureProp(key, makeTrap, at);
    }
    for (const k of d.ropes) {
      const key = `rope:${k}`;
      keep.add(key);
      this.ensureProp(key, makeRope, parsePos(k));
    }
    for (const key of [...this.props.keys()]) if (!keep.has(key)) this.removeProp(key);
  }

  /** Show or hide units and props by level and fog. */
  refreshUnits(): void {
    const visible = this.extraVisible ? new Set([...this.vis.visible, ...this.extraVisible]) : this.vis.visible;
    for (const v of this.units.values()) {
      let show = v.at.level === this.shownLevel;
      if (show && v.side !== 'hero') {
        const k = posKey(v.at);
        show = visible.has(k) || (v.side === 'prisoner' && this.vis.explored.has(k));
      }
      v.shown = show;
      v.root.visible = show;
    }
  }

  private refreshProps(): void {
    for (const p of this.props.values()) {
      const at = p.obj.userData.at as Pos;
      const k = posKey(at);
      const fog = this.vis.visible.has(k) ? (this.vis.lit.has(k) ? 1 : 0.75) : this.vis.explored.has(k) ? 0.5 : 0;
      p.obj.visible = at.level === this.shownLevel && fog > 0;
      setMaterialFog(p.mats, fog);
    }
  }

  // ------------------------------------------------------------ highlights

  highlight(hexes: Pos[], style: HighlightStyle): void {
    const mesh = this.highlights.get(style)!;
    const m = new THREE.Matrix4();
    let n = 0;
    for (const p of hexes) {
      if (p.level !== this.shownLevel || n >= 600) continue;
      m.makeTranslation(this.worldOf(p, 0.025));
      mesh.setMatrixAt(n++, m);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
  }

  clearHighlights(): void {
    for (const m of this.highlights.values()) m.count = 0;
    this.showPath(null);
    this.showRipple(null, 0);
  }

  showPath(path: Pos[] | null): void {
    if (!path || !path.length) {
      this.pathDots.count = 0;
      this.pathEnd.visible = false;
      return;
    }
    const m = new THREE.Matrix4();
    let n = 0;
    for (const p of path.slice(0, -1)) {
      if (p.level !== this.shownLevel) continue;
      m.makeTranslation(this.worldOf(p, 0.04));
      this.pathDots.setMatrixAt(n++, m);
    }
    this.pathDots.count = n;
    this.pathDots.instanceMatrix.needsUpdate = true;
    const last = path[path.length - 1]!;
    this.pathEnd.visible = last.level === this.shownLevel;
    this.pathEnd.position.copy(this.worldOf(last, 0.045));
  }

  /** Draw the noise ripple of radius r around a hex (0 or null clears it). */
  showRipple(center: Pos | null, radius: number): void {
    if (!center || radius <= 0 || center.level !== this.shownLevel) {
      this.rippleMesh.count = 0;
      this.rippleData = null;
      return;
    }
    const lv = this.levels.get(center.level);
    const m = new THREE.Matrix4();
    let n = 0;
    for (const h of range(center, radius)) {
      if (!lv?.walkable.has(hexKey(h)) && !lv?.def.tiles[hexKey(h)]) continue;
      const t = lv.def.tiles[hexKey(h)];
      if (t && (t.kind === 'wall' || t.kind === 'pillar')) continue;
      m.makeTranslation(this.worldOf({ level: center.level, ...h }, 0.035));
      this.rippleMesh.setMatrixAt(n++, m);
    }
    this.rippleMesh.count = n;
    this.rippleMesh.instanceMatrix.needsUpdate = true;
    this.rippleData = { center: this.worldOf(center), count: n };
  }

  setHover(p: Pos | null): void {
    if (!p || p.level !== this.shownLevel) {
      this.hoverMesh.visible = false;
      return;
    }
    this.hoverMesh.visible = true;
    this.hoverMesh.position.copy(this.worldOf(p, 0.05));
  }

  // ------------------------------------------------------------ intents

  clearIntents(): void {
    this.intentLines.clear();
    for (const el of this.intentTags.values()) el.remove();
    this.intentTags.clear();
  }

  showIntents(state: GameState, intents: Record<string, Intent>): void {
    this.clearIntents();
    const d = state.delve;
    if (!d) return;
    for (const [id, it] of Object.entries(intents)) {
      const m = d.monsters.find((x) => x.id === id);
      if (!m || it.kind === 'wait') continue;
      const el = document.createElement('div');
      el.className = `intent intent-${it.kind}`;
      const target = it.targetId ? targetName(state, it.targetId) : '';
      const glyph = INTENT_GLYPH[it.kind];
      const dmg = it.damage ? `${it.damage[0]}–${it.damage[1]}` : '';
      el.innerHTML = `<span class="intent-icon">${glyph}</span>${dmg ? `<span class="intent-dmg">${dmg}</span>` : ''}`;
      el.title = `${m.name}: ${INTENT_WORDS[it.kind]}${target ? ` ${target}` : ''}${dmg ? ` for ${dmg}` : ''}`;
      this.fx.appendChild(el);
      this.intentTags.set(id, el);
      // A line to the target or destination.
      const from = this.worldOf(m.at, 0.6);
      let to: THREE.Vector3 | null = null;
      if (it.targetId) {
        const tp = targetPos(state, it.targetId);
        if (tp && tp.level === m.at.level) to = this.worldOf(tp, 0.6);
      } else if (it.to && it.to.level === m.at.level) to = this.worldOf(it.to, 0.08);
      if (to && m.at.level === this.shownLevel) {
        const col = it.kind === 'attack' || it.kind === 'steal' ? COLORS.danger : it.kind === 'web' ? 0xd8d8d8 : 0xb08a6a;
        const g = new THREE.BufferGeometry().setFromPoints([from, to]);
        const line = new THREE.Line(g, new THREE.LineDashedMaterial({ color: col, dashSize: 0.22, gapSize: 0.14, transparent: true, opacity: 0.85, depthTest: false }));
        line.computeLineDistances();
        line.renderOrder = 6;
        line.userData.monster = id;
        this.intentLines.add(line);
        if (!it.targetId) {
          const mark = new THREE.Mesh(hexRing(0.55, 0.7), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.6, depthWrite: false }));
          mark.position.copy(to);
          mark.userData.monster = id;
          this.intentLines.add(mark);
        }
      }
    }
    this.refreshIntentVisibility();
  }

  private refreshIntentVisibility(): void {
    for (const o of this.intentLines.children) {
      const v = this.units.get(o.userData.monster as string);
      o.visible = !!v && v.root.visible;
    }
  }

  // ------------------------------------------------------------ playback

  /** Before playing a batch: show units from the next state too, and widen sight to what either state saw. */
  beginPlayback(next: GameState, nextVis: Visibility): void {
    this.extraVisible = nextVis.visible;
    const d = next.delve;
    if (d) {
      for (const m of d.monsters) {
        if (m.hp <= 0 || this.units.has(m.id)) continue;
        const v = this.ensureUnit(m.id, this.modelFor(m.kind), 'monster', m.spawnedAt ?? m.at, m.name);
        v.root.position.copy(this.worldOf(m.at));
        v.at = { ...m.at };
        v.setOpacity(0);
        v.busy++;
        void this.clock.tween(0.4, (t) => v.setOpacity(t)).then(() => v.busy--);
      }
      if (d.rivals)
        for (const r of d.rivals.members) {
          if (r.goneOut || r.hp <= 0 || d.round < d.rivals.entersRound || this.units.has(r.id)) continue;
          const v = this.ensureUnit(r.id, 'sister', 'rival', r.at, r.name);
          v.at = { ...r.at };
        }
    }
    this.clearIntents();
    this.refreshUnits();
  }

  endPlayback(): void {
    this.extraVisible = null;
    this.moving.clear();
    this.followId = null;
  }

  unitPos(id: string): Pos | null {
    return this.units.get(id)?.at ?? null;
  }

  isWatchable(id: string): boolean {
    const v = this.units.get(id);
    return !!v && v.root.visible;
  }

  async playEvent(e: GameEvent): Promise<void> {
    const clock = this.clock;
    switch (e.type) {
      case 'moved': {
        const v = this.units.get(e.id);
        if (!v || !e.path.length) return;
        const visible = this.extraVisible ? new Set([...this.vis.visible, ...this.extraVisible]) : this.vis.visible;
        const seen = v.side === 'hero' || [v.at, ...e.path].some((p) => visible.has(posKey(p)));
        if (!seen) {
          v.at = { ...e.path[e.path.length - 1]! };
          v.root.position.copy(this.worldOf(v.at));
          this.refreshUnits();
          return;
        }
        v.busy++;
        this.moving.add(v.id);
        for (const step of e.path) {
          if (step.level !== v.at.level) {
            // Stairs: fade out, jump, fade in.
            await clock.tween(0.12, (t) => v.setOpacity(1 - t));
            v.at = { ...step };
            v.root.position.copy(this.worldOf(step));
            if (v.side === 'hero' && v.id === this.selectedId) this.showLevel(step.level);
            this.refreshUnits();
            await clock.tween(0.12, (t) => v.setOpacity(t));
            continue;
          }
          const from = v.root.position.clone();
          const to = this.worldOf(step);
          v.face(to.x - from.x, to.z - from.z);
          await clock.tween(0.14, (t) => {
            const k = easeInOut(t);
            v.root.position.lerpVectors(from, to, k);
            v.root.position.y = from.y + (to.y - from.y) * k;
          });
          v.at = { ...step };
          this.refreshUnits();
          this.onStep?.(v.side);
        }
        this.moving.delete(v.id);
        v.busy--;
        this.refreshIntentVisibility();
        return;
      }
      case 'levelChanged': {
        const v = this.units.get(e.id);
        if (v && v.side === 'hero' && e.id === this.selectedId) this.showLevel(e.to);
        return;
      }
      case 'hit':
      case 'miss': {
        const a = this.units.get(e.attacker);
        const t = this.units.get(e.target);
        if (!t) return;
        const watch = (a?.root.visible ?? false) || t.root.visible;
        if (!watch) return;
        if (a && a.id !== t.id) await this.lunge(a, t);
        if (e.type === 'hit') {
          t.flash(new THREE.Color(1, 0.15, 0.1), 0.9);
          this.floatText(t.root.position.clone().add(new THREE.Vector3(0, t.height + 0.2, 0)), `−${e.damage}`, 'damage', 1.2);
          if (!this.reduceShake) this.rig.addShake(0.05 + e.damage * 0.04 + (e.crit ? 0.1 : 0));
          clock.hitStop(e.crit ? 140 : 70);
          await this.recoil(t, a);
          t.flash(new THREE.Color(0, 0, 0), 0);
        } else {
          this.floatText(t.root.position.clone().add(new THREE.Vector3(0, t.height + 0.2, 0)), 'miss', 'miss', 0.9);
          await clock.wait(0.12);
        }
        return;
      }
      case 'downed': {
        const v = this.units.get(e.id);
        if (!v) return;
        this.floatText(v.root.position.clone().add(new THREE.Vector3(0, v.height, 0)), 'Downed', 'warn', 1.6);
        await clock.tween(0.3, (t) => (v.fig.rotation.z = easeOutCubic(t) * 1.35));
        return;
      }
      case 'revived': {
        const v = this.units.get(e.id);
        if (!v) return;
        await clock.tween(0.3, (t) => (v.fig.rotation.z = (1 - easeOutCubic(t)) * 1.35));
        this.floatText(v.root.position.clone().add(new THREE.Vector3(0, v.height, 0)), 'Back up', 'heal');
        return;
      }
      case 'died':
      case 'monsterDied': {
        const v = this.units.get(e.id);
        if (!v) return;
        v.busy++;
        if (v.root.visible) await v.topple();
        v.busy--;
        this.removeUnit(e.id);
        return;
      }
      case 'doorChanged': {
        const door = this.levels.get(e.at.level)?.doors.get(posKey(e.at));
        if (!door) return;
        const from = door.hinge.rotation.y;
        const to = e.open ? -Math.PI * 0.55 : 0;
        door.padlock.visible = e.locked && !e.open;
        this.onDoor?.(e.open);
        if (from !== to) await clock.tween(0.28, (t) => (door.hinge.rotation.y = from + (to - from) * easeOutBack(t)));
        door.open = e.open;
        return;
      }
      case 'chestOpened': {
        const p = this.props.get(`chest:${e.id}`);
        if (!p) return;
        if (p.padlock) p.padlock.visible = false;
        await clock.tween(0.35, (t) => (p.lid!.rotation.x = -1.9 * easeOutBack(t)));
        const at = p.obj.position.clone().add(new THREE.Vector3(0, 0.8, 0));
        this.floatText(at, itemsText(e.items), 'gold', 1.8);
        this.flash(at, 0xffd27a, 3);
        return;
      }
      case 'looted': {
        const v = this.units.get(e.id);
        if (!v || !e.items.length) return;
        this.floatText(v.root.position.clone().add(new THREE.Vector3(0, v.height + 0.1, 0)), `+ ${itemsText(e.items)}`, 'gold', 1.6);
        await clock.wait(0.15);
        return;
      }
      case 'noise': {
        if (e.at.level !== this.shownLevel || e.radius <= 0) return;
        await this.noiseWave(e.at, e.radius);
        return;
      }
      case 'brazierLit': {
        const b = this.levels.get(e.at.level)?.braziers.get(posKey(e.at));
        if (!b) return;
        b.lit = true;
        b.fire.visible = true;
        this.flash(b.center, 0xff9a40, 6);
        await clock.tween(0.4, (t) => b.fire.scale.setScalar(easeOutBack(t)));
        return;
      }
      case 'blast': {
        const at = this.worldOf(e.at, 0.6);
        this.flash(at, 0xffc070, 30);
        if (!this.reduceShake) this.rig.addShake(0.5);
        clock.hitStop(160);
        this.onExplosion?.();
        await clock.wait(0.35);
        return;
      }
      case 'trap': {
        const at = this.worldOf(e.at, 0.4);
        this.flash(at, 0xff4030, 4);
        this.floatText(at.clone().add(new THREE.Vector3(0, 1, 0)), `Trap! −${e.damage}`, 'damage', 1.4);
        if (!this.reduceShake) this.rig.addShake(0.15);
        await clock.wait(0.25);
        return;
      }
      case 'trapSpotted': {
        this.floatText(this.worldOf(e.at, 0.8), 'Trap spotted', 'warn', 1.4);
        const key = `trap:${posKey(e.at)}`;
        const p = this.ensureProp(key, makeTrap, e.at);
        p.obj.visible = e.at.level === this.shownLevel;
        await clock.wait(0.2);
        return;
      }
      case 'awake': {
        const v = this.units.get(e.id);
        if (!v || !v.root.visible) return;
        this.floatText(v.root.position.clone().add(new THREE.Vector3(0, v.height + 0.3, 0)), e.awareness === 'hunting' ? '!!' : '!', 'warn', 1.1);
        await clock.wait(0.12);
        return;
      }
      case 'spawned':
      case 'gloam': {
        const at = 'id' in e ? this.units.get(e.id)?.at : e.at;
        if (at && at.level === this.shownLevel) await clock.wait(0.25);
        return;
      }
      case 'stolen': {
        const v = this.units.get(e.from);
        if (v) this.floatText(v.root.position.clone().add(new THREE.Vector3(0, v.height, 0)), `${e.item.name} stolen!`, 'warn', 1.6);
        await clock.wait(0.2);
        return;
      }
      case 'freed': {
        const v = this.units.get(e.prisonerId);
        if (v) this.floatText(v.root.position.clone().add(new THREE.Vector3(0, v.height, 0)), 'Freed', 'heal', 1.4);
        return;
      }
      case 'out': {
        const v = this.units.get(e.id);
        if (!v) return;
        v.busy++;
        await clock.tween(0.4, (t) => {
          v.setOpacity(1 - t);
          v.root.position.y += 0.01;
        });
        v.busy--;
        this.removeUnit(e.id);
        return;
      }
      case 'light': {
        this.brightness = e.brightness;
        return;
      }
      default:
        return;
    }
  }

  onStep?: (side: UnitSide) => void;
  onDoor?: (open: boolean) => void;
  onExplosion?: () => void;

  private flash(at: THREE.Vector3, color: number, power: number): void {
    this.flashLight.position.copy(at);
    this.flashLight.color.setHex(color);
    this.flashLight.intensity = power;
  }

  private async lunge(a: UnitView, t: UnitView): Promise<void> {
    const dir = t.root.position.clone().sub(a.root.position);
    a.face(dir.x, dir.z);
    const len = dir.length();
    if (len < 0.01) return;
    dir.normalize();
    const reach = Math.min(0.45, len * 0.35);
    a.busy++;
    await this.clock.tween(0.1, (k) => a.rig.position.copy(dir).multiplyScalar(reach * easeOutCubic(k)));
    void this.clock.tween(0.16, (k) => a.rig.position.copy(dir).multiplyScalar(reach * (1 - k))).then(() => a.busy--);
  }

  private async recoil(t: UnitView, a?: UnitView): Promise<void> {
    const dir = a ? t.root.position.clone().sub(a.root.position).setY(0).normalize() : new THREE.Vector3(0, 0, 1);
    await this.clock.tween(0.18, (k) => t.rig.position.copy(dir).multiplyScalar(Math.sin(k * Math.PI) * 0.18));
    t.rig.position.set(0, 0, 0);
  }

  private async noiseWave(at: Pos, radius: number): Promise<void> {
    const lv = this.levels.get(at.level);
    const center = this.worldOf(at, 0.05);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x9ec8ff, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    ring.position.copy(center);
    ring.renderOrder = 5;
    this.overlay.add(ring);
    const maxR = radius * Math.sqrt(3) * HEX + 0.5;
    void lv;
    await this.clock.tween(0.25 + radius * 0.05, (t) => {
      const r = Math.max(0.01, maxR * easeOutCubic(t));
      ring.scale.setScalar(r);
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - t);
    });
    this.overlay.remove(ring);
  }

  // ------------------------------------------------------------ picking

  private bindPointer(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('pointermove', (e) => {
      const { at, unitId } = this.pick(e);
      const same = (a: Pos | null, b: Pos | null) => (a && b ? samePos(a, b) : a === b);
      if (!same(at, this.hoverPos) || unitId !== this.hoverUnit) {
        this.hoverPos = at;
        this.hoverUnit = unitId;
        this.setHover(at);
        this.hooks.hover(at, unitId);
      }
    });
    canvas.addEventListener('pointerleave', () => {
      this.hoverPos = null;
      this.hoverUnit = null;
      this.setHover(null);
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
      if (e.button === 2 && this.rig.dragged) return;
      const { at, unitId } = this.pick(e);
      this.hooks.click(at, unitId, e);
    });
  }

  pick(e: { clientX: number; clientY: number }): { at: Pos | null; unitId: string | null } {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.rig.camera);
    const objs: THREE.Object3D[] = [];
    for (const v of this.units.values()) if (v.root.visible && !v.dead) objs.push(...v.pickables());
    const hit = this.raycaster.intersectObjects(objs, false)[0];
    if (hit) {
      const id = hit.object.userData.unitId as string | undefined;
      const v = id ? this.units.get(id) : undefined;
      if (v) return { at: { ...v.at }, unitId: v.id };
    }
    const lv = this.levels.get(this.shownLevel);
    if (!lv) return { at: null, unitId: null };
    // Try the raised plane first, then the floor plane.
    for (const top of [0.62, FLOOR_TOP]) {
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(levelY(this.shownLevel) + top));
      const p = new THREE.Vector3();
      if (!this.raycaster.ray.intersectPlane(plane, p)) continue;
      const h = worldToHex(p.x, p.z, HEX);
      const t = lv.def.tiles[hexKey(h)];
      if (!t) continue;
      if (top > FLOOR_TOP && !t.raised) continue;
      return { at: { level: this.shownLevel, ...h }, unitId: null };
    }
    return { at: null, unitId: null };
  }
}

// ------------------------------------------------------------ helpers

const INTENT_GLYPH: Record<Intent['kind'], string> = {
  attack: '⚔',
  move: '➜',
  web: '✲',
  steal: '✋',
  flee: '↶',
  wait: '…',
};
const INTENT_WORDS: Record<Intent['kind'], string> = {
  attack: 'attacks',
  move: 'moves',
  web: 'webs',
  steal: 'steals from',
  flee: 'flees',
  wait: 'waits',
};

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

function parsePos(k: string): Pos {
  const [l, rest] = k.split(':');
  const [q, r] = (rest ?? '0,0').split(',').map(Number);
  return { level: Number(l), q: q ?? 0, r: r ?? 0 };
}

function groundKind(items: Item[]): string {
  if (items.some((i) => i.kind === 'heirloom')) return 'heirloom';
  if (items.every((i) => i.kind === 'gold')) return 'gold';
  return 'sack';
}

export function itemsText(items: Item[]): string {
  const gold = items.filter((i) => i.kind === 'gold').reduce((a, i) => a + i.amount, 0);
  const rest = items.filter((i) => i.kind !== 'gold').map((i) => i.name);
  return [gold ? `${gold} gold` : '', ...rest].filter(Boolean).join(', ') || 'nothing';
}

function pipsHtml(hp: number, max: number, cls: string): string {
  const n = Math.max(0, Math.min(max, hp));
  if (max > 14) return `<span class="hp-bar ${cls}"><i style="width:${(n / max) * 100}%"></i></span>`;
  let s = `<span class="hp-pips ${cls}">`;
  for (let i = 0; i < max; i++) s += `<i class="${i < n ? 'on' : ''}"></i>`;
  return s + '</span>';
}

function heroTag(h: HeroInDelve, max: number, lantern: boolean): string {
  const status = h.status === 'downed' ? `<b class="tag-down">Downed · ${h.bleed}</b>` : h.webbed ? '<b class="tag-web">Webbed</b>' : '';
  return `${lantern ? '<span class="tag-lantern" title="Lantern">◆</span>' : ''}${pipsHtml(h.hp, max, 'hero')}${status}`;
}

function monsterTag(m: Monster): string {
  const aw = m.awareness === 'asleep' ? '<b class="tag-sleep">z</b>' : m.awareness === 'alert' ? '<b class="tag-alert">?</b>' : '';
  return `${aw}${pipsHtml(m.hp, m.maxHp, 'enemy')}`;
}

function targetPos(state: GameState, id: string): Pos | null {
  const d = state.delve;
  if (!d) return null;
  return d.heroes.find((h) => h.heroId === id)?.at ?? (d.prisoner?.id === id ? d.prisoner.at : null) ?? d.rivals?.members.find((r) => r.id === id)?.at ?? null;
}

function targetName(state: GameState, id: string): string {
  const d = state.delve;
  return state.campaign.roster.find((h) => h.id === id)?.name ?? (d?.prisoner?.id === id ? d.prisoner.name : undefined) ?? d?.rivals?.members.find((r) => r.id === id)?.name ?? id;
}
