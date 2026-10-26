// The 3D diorama for V3. Owns the three.js scene, the hex levels, figures,
// props, fog of war, lights, highlights, picking, overlays (HP pips, intent
// icons, room labels, floating numbers) and the 3D side of every event.
// Knows nothing about the HUD panels; the UI layer drives it.

import * as THREE from 'three';
import type { MoveRisks, Visibility } from '../game/api';
import { DIRS, add, hexKey, hexToWorld, parseHexKey, posKey, range, samePos, worldToHex, type Pos } from '../game/hex';
import type { Brightness, CastleDef, GameEvent, GameState, HeroInDelve, Intent, Item, LevelDef, Monster, Rival, RivalCrew } from '../game/types';
import { AnimClock } from './anim';
import { CameraRig } from './camera';
import type { ModelKey } from './figures';
import { LevelView } from './level';
import { makeBook, makeChest, makeCoins, makeCopper, makeHeirloom, makeHoard, makeRope, makeSack, makeTrap, type PropView } from './props';
import { glowTexture } from './sprites';
import { UnitView, type UnitSide } from './unit';
import { CLASS_COLORS, COLORS, FLOOR_TOP, HEX, WALL_HEIGHT, easeInOut, easeOutBack, easeOutCubic, levelY } from './world';
import { blastRings, blindArc, blownWalls, facedUnits, facingAngle, facingOf, fuseSide } from './stealth';
import { CUTAWAY, setFogTime, setMaterialFog } from './fog';
import { MapEffects, effectsFromState } from './effects';
import { exitList, exitMarker, linkEnds, linkMarker, prizeInHand } from './links';
import { heardFade, heardIcon, heardTitle } from './sounds';

const MAX_LIGHTS = 12;
/** Floating text starts just above a hero's head (V3.3 scale: heroes are 2.0). */
const FLOAT_LIFT = 2.25;
/** How far below the shown level we draw through pits. */
const BELOW_HALO = 3;

export interface DioramaHooks {
  hover(at: Pos | null, unitId: string | null): void;
  click(at: Pos | null, unitId: string | null, ev: PointerEvent): void;
  levelChanged(level: number): void;
}

export type HighlightStyle = 'walk' | 'sneak' | 'dash' | 'target' | 'ally' | 'danger' | 'area' | 'breakable' | 'collapse' | 'rubble';

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
/** V3.9.3 (24.8): a shove/drag plan whose victim no longer stands next to the landing hex. */
export function staleShove(victim: Pos | null, to: Pos): boolean {
  if (!victim) return false;
  return victim.level !== to.level || Math.max(Math.abs(victim.q - to.q), Math.abs(victim.r - to.r), Math.abs(victim.q + victim.r - to.q - to.r)) !== 1;
}

function hexRing(rIn: number, rOut: number): THREE.BufferGeometry {
  return new THREE.RingGeometry(rIn, rOut, 6, 1, Math.PI / 6).rotateX(-Math.PI / 2);
}

const HIGHLIGHT_COLORS: Record<HighlightStyle, number> = {
  walk: 0xffd08a,
  sneak: 0x9ec0ff,
  dash: 0x5ae0d0,
  area: 0xffa040,
  target: COLORS.danger,
  ally: 0x7fbf5a,
  danger: COLORS.danger,
  breakable: 0xff9a40,
  collapse: 0xff2a30,
  rubble: 0xb8a88a,
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
  /** Fog sets from the last sync, so a level switch can reapply them. */
  private fogLit = new Set<string>();
  private fogUnlit = new Set<string>();
  /** The lift runs (for tooltips and the winch drum). */
  liftWorking = false;
  private drumSpin = 0;
  /** Red lips under heroes standing on a shove-able edge (posKeys of the hero hex + pit hex). */
  private lips = new THREE.Group();
  /** Landing marker for jump/shove previews. */
  private landing = new THREE.Group();
  private landingTag: HTMLElement;
  private landingAt: THREE.Vector3 | null = null;
  private breathMarks = new THREE.Group();
  /** 15.6: gold glow under unlooted piles (opened chests, seen ground loot), plus DOM coin markers. */
  private lootGlow = new THREE.Group();
  private lootTags = new Map<string, { el: HTMLElement; at: THREE.Vector3 }>();
  /** V3.2 effects: smoke, glue, caltrops, fire, veil, ward, overwatch, sleep. */
  readonly effects: MapEffects;
  /** 15.7: pulsing ring on the stairs/lift hex the selected hero stands on. */
  private linkPulse: THREE.Mesh;
  /** 15.7: floating level markers over explored stairs and lift ends ("↓ L2"). */
  private linkTags: { el: HTMLElement; pos: Pos; at: THREE.Vector3; key: string; level: number; lift: boolean; exit?: boolean }[] = [];
  /** V3.6 (19.5): the exit the party came in by; its marker says so. */
  private entrance: Pos | null = null;
  /** V3.6 (19.5): the pulse under a hero standing on an exit, and the soft rings on known exits once the prize is in hand. */
  private exitPulse: THREE.Mesh;
  private exitRings = new THREE.Group();
  private exitRingsKey = '';
  /** 15.7: the contract objective's beacon (light pillar + DOM diamond) once its hex is explored. */
  private beacon = new THREE.Group();
  private beaconTag: HTMLElement;
  private beaconAt: THREE.Vector3 | null = null;
  private beaconKey = '';
  /** 16.2: the lantern shutter; shuttered = no lantern light, dark lantern model. */
  lanternOpen = true;
  /** 16.2: a small lantern that hangs beside the bearer (iron frame + glow). */
  private lanternObj = new THREE.Group();
  private lanternGlow: THREE.Sprite;
  private lanternFlame: THREE.Mesh;
  /** 16.2: heroes standing in the dark get a dark ring on the floor. */
  private darkHeroes = new Set<string>();
  private darkRings = new THREE.Group();
  /** V3.5 (18.7): a ring under each rival: green hired (allies), red hostile, amber demanding, pale otherwise. */
  private crewRings = new THREE.Group();
  private crewRingKey = '';
  /** 16.1: known patrol routes, dotted, with arrows. */
  private routes = new THREE.Group();
  private routesKey = '';
  /** 16.2: the Gloam's creeping darkness at the edge of the party's light (Level 3). */
  private gloamEdge: THREE.InstancedMesh;
  private gloamEdgeKey = '';
  /** V3.7 (20.1): facing wedges on awake monsters and crew members; V3.9 (24.5): and on heroes, in their colour. */
  private facingMarks = new THREE.Group();
  private facingKey = '';
  /** V3.9 (24.5): the enemy whose rear half is shown faintly (hover), and the Burglar's backstab spots. */
  private rearOf: string | null = null;
  private stabSpots: { at: Pos; target: string }[] = [];
  /** V3.9: the facing a move or a Face will leave (a wedge at the path end or on the hero). */
  private facePreview = new THREE.Group();
  private blindFill: THREE.InstancedMesh;
  private blindMarks = new THREE.Group();
  private blindTags: { el: HTMLElement; at: THREE.Vector3 }[] = [];
  private blindKey = '';
  /** V3.7 (20.1, 20.2): move-preview risks: rings on the monsters and a tag each. */
  private riskRings = new THREE.Group();
  private riskTags = new Map<string, HTMLElement>();
  /** V3.7 (20.3): fuses: blast rings on the map and a countdown tag per charge. */
  private fuseMarks = new THREE.Group();
  private fuseTags: { el: HTMLElement; at: THREE.Vector3; level: number }[] = [];
  private fuseKey = '';
  /** V3.9.3 (24.8): what the heroes heard: pulsing rings for loud sounds, a tag per heard hex (footprints, icons). */
  private soundMarks = new THREE.Group();
  private soundTags: { el: HTMLElement; at: THREE.Vector3; level: number }[] = [];
  private soundKey = '';
  /** V3.7 (20.3): built walls broken by blasts, per level (the level is rebuilt with rubble there). */
  private brokenKey = new Map<number, string>();
  /** The state a playback is heading to (beginPlayback), for drags and fuses mid-animation. */
  private nextState: GameState | null = null;
  /** Blast rubble dug back to floor (`dug` events; the engine keeps this privately: contract request). */
  private dugWalls = new Set<string>();
  /** 20.3a: loose stone round collapsed hexes, so the new pit edge reads ragged. */
  private collapseDebris = new THREE.Group();

  constructor(
    private readonly container: HTMLElement,
    private readonly hooks: DioramaHooks,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    const canvas = document.createElement('canvas');
    canvas.className = 'dio-canvas';
    container.appendChild(canvas);
    this.fx = document.createElement('div');
    this.fx.className = 'dio-fx';
    container.appendChild(this.fx);
    void 0;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(COLORS.void, 1);
    this.scene.background = new THREE.Color(COLORS.void);
    this.rig = new CameraRig(canvas);

    // Near-black ambient; light comes from the lantern, torches and braziers.
    this.ambient = new THREE.AmbientLight(0x3a3f4a, 0.4);
    this.hemi = new THREE.HemisphereLight(0x9aa4b8, 0x2a2018, 0.55);
    const rim = new THREE.DirectionalLight(COLORS.cold, 0.22);
    rim.position.set(-6, 9, -8);
    // A soft key from above-left so wall faces and props have form.
    const key = new THREE.DirectionalLight(0xfff0dc, 0.55);
    key.position.set(-20, 40, 25);
    this.scene.add(this.ambient, this.hemi, rim, rim.target, key, key.target);
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
      const fill = style === 'walk' || style === 'sneak' || style === 'dash';
      const disc = style === 'collapse' || style === 'rubble';
      const m = new THREE.InstancedMesh(
        disc ? new THREE.CircleGeometry(0.84, 6).rotateX(-Math.PI / 2).rotateY(Math.PI / 6) : fill ? hexRing(0.7, 0.8) : hexRing(0.68, 0.88),
        new THREE.MeshBasicMaterial({ color: HIGHLIGHT_COLORS[style], transparent: true, opacity: disc ? 0.45 : fill ? 0.6 : 0.9, depthWrite: false }),
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
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.66, 0.8, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: COLORS.ember, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide }));
    this.ring.visible = false;
    this.ring.renderOrder = 3;
    this.rippleMesh = new THREE.InstancedMesh(hexRing(0.74, 0.86), new THREE.MeshBasicMaterial({ color: 0x9ec8ff, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }), 400);
    this.rippleMesh.count = 0;
    this.rippleMesh.renderOrder = 2;
    this.rippleMesh.frustumCulled = false;
    this.linkPulse = new THREE.Mesh(hexRing(0.62, 0.94), new THREE.MeshBasicMaterial({ color: 0x9ad8ff, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.linkPulse.visible = false;
    this.linkPulse.renderOrder = 4;
    this.exitPulse = new THREE.Mesh(hexRing(0.62, 0.94), new THREE.MeshBasicMaterial({ color: 0xd8ecff, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.exitPulse.visible = false;
    this.exitPulse.renderOrder = 4;
    // 16.2: creeping darkness tiles (Gloam) and dark rings under unlit heroes.
    this.gloamEdge = new THREE.InstancedMesh(new THREE.CircleGeometry(0.9, 6, Math.PI / 6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x04030a, transparent: true, opacity: 0.5, depthWrite: false }), 400);
    this.gloamEdge.count = 0;
    this.gloamEdge.renderOrder = 1;
    this.gloamEdge.frustumCulled = false;
    // V3.9 (24.5): the rear half of a hovered enemy: a faint cool wash (the V3.7 sneaking wash is gone).
    this.blindFill = new THREE.InstancedMesh(new THREE.CircleGeometry(0.88, 6, Math.PI / 6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x6f9cff, transparent: true, opacity: 0.13, depthWrite: false, blending: THREE.AdditiveBlending }), 600);
    this.blindFill.count = 0;
    this.blindFill.renderOrder = 1;
    this.blindFill.frustumCulled = false;
    // Breakable-wall outlines sit on top of the wall and draw over it.
    {
      const bm = this.highlights.get('breakable')!.material as THREE.MeshBasicMaterial;
      bm.depthTest = false;
      this.highlights.get('breakable')!.renderOrder = 8;
    }
    // V3.4: walls stand at full height, so the hover, path-end and selection rings get a faint
    // copy drawn only where a wall is in front of them (GreaterDepth): a hex picked behind a wall
    // still shows its ring.
    for (const m of [this.pathEnd, this.hoverMesh, this.ring]) m.add(throughWall(m));
    this.overlay.add(this.pathDots, this.pathEnd, this.hoverMesh, this.ring, this.rippleMesh, this.intentLines, this.lips, this.landing, this.breathMarks, this.lootGlow, this.linkPulse, this.exitPulse, this.exitRings, this.beacon, this.routes, this.darkRings, this.crewRings, this.gloamEdge, this.blindFill, this.blindMarks, this.facingMarks, this.facePreview, this.riskRings, this.fuseMarks, this.soundMarks, this.collapseDebris);
    // V3.9: the facing a move or a Face leaves: an ember wedge with an arrow.
    {
      const col = COLORS.emberHot;
      const R = Math.sqrt(3) * HEX * 1.05;
      const cone = new THREE.Mesh(new THREE.CircleGeometry(R, 12, -Math.PI / 3, (Math.PI * 2) / 3).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.26, depthWrite: false, side: THREE.DoubleSide }));
      cone.rotation.y = -Math.PI / 2;
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.36, 3), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.95, depthWrite: false }));
      arrow.rotation.x = Math.PI / 2;
      arrow.position.z = Math.sqrt(3) * HEX * 0.62;
      // V3.9.1 (spec 24.6): a subtle forward arrow only (no wedge).
      void cone;
      arrow.material.opacity = 0.7;
      this.facePreview.add(arrow);
      this.facePreview.visible = false;
      this.facePreview.renderOrder = 3;
    }
    // 16.2: the bearer's lantern: an iron frame on a short hook, a flame and a glow sprite.
    {
      const iron = new THREE.MeshLambertMaterial({ color: 0x2a2420, flatShading: true });
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.34, 0.26), iron);
      const hook = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 4), iron);
      hook.position.y = 0.3;
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.12, 6), iron);
      cap.position.y = 0.22;
      this.lanternFlame = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 0.16), new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 1 }));
      this.lanternGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffb862, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }));
      this.lanternGlow.scale.setScalar(1.6);
      this.lanternObj.add(frame, hook, cap, this.lanternFlame, this.lanternGlow);
      this.lanternObj.visible = false;
      this.scene.add(this.lanternObj);
    }
    this.landingTag = document.createElement('div');
    this.landingTag.className = 'landing-tag hidden';
    this.beaconTag = document.createElement('div');
    this.beaconTag.className = 'beacon-tag hidden';
    this.effects = new MapEffects({
      worldOf: (p, lift) => this.worldOf(p, lift ?? 0),
      get shownLevel() {
        return self.shownLevel;
      },
      known: (p) => this.vis.explored.has(posKey(p)) || this.vis.visible.has(posKey(p)),
      visible: (p) => this.vis.visible.has(posKey(p)),
      unit: (id) => this.units.get(id),
      fx: this.fx,
      project: (v) => this.project(v),
    });
    this.overlay.add(this.effects.group);

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

    this.fx.appendChild(this.landingTag);
    this.fx.appendChild(this.beaconTag);
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
    for (const t of this.linkTags) t.el.remove();
    this.roomTags = [];
    this.linkTags = [];
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
    // 15.7: a level marker over each stairs and lift end, shown once that hex is explored.
    for (const l of linkEnds(def)) {
      const el = document.createElement('div');
      el.className = `link-tag ${l.kind === 'lift' ? 'lift' : 'stairs'} ${l.down ? 'down' : 'up'}`;
      el.textContent = linkMarker(l);
      this.fx.appendChild(el);
      this.linkTags.push({ el, pos: l.at, at: this.worldOf(l.at, 1.3), key: posKey(l.at), level: l.at.level, lift: l.kind === 'lift' });
    }
    // V3.6 (19.5): a "Way out" marker over every exit hex, shown once explored (the entrance always is).
    for (const e of exitList(def, this.entrance)) {
      const el = document.createElement('div');
      el.className = `link-tag exit-tag ${e.entrance ? 'entrance' : ''}`;
      el.textContent = exitMarker(e);
      el.title = e.name;
      this.fx.appendChild(el);
      this.linkTags.push({ el, pos: e.at, at: this.worldOf(e.at, 1.9), key: posKey(e.at), level: e.at.level, lift: false, exit: true });
    }
    this.showLevel(def.levels[0]?.level ?? 1, true);
  }

  /** 15.7: pulse the hex the selected hero stands on when it's stairs or a working lift. */
  showLinkPulse(at: Pos | null): void {
    if (!at || at.level !== this.shownLevel) {
      this.linkPulse.visible = false;
      return;
    }
    this.linkPulse.visible = true;
    this.linkPulse.position.copy(this.worldOf(at, 0.06));
  }

  /** V3.6 (19.5): which exit the party came in by; its marker reads "Way out · you came in here". */
  setEntrance(p: Pos | null): void {
    if ((p && this.entrance && samePos(p, this.entrance)) || (!p && !this.entrance)) return;
    this.entrance = p;
    if (!this.castle) return;
    for (const t of this.linkTags) {
      if (!t.exit) continue;
      const e = exitList(this.castle, p, t.level).find((x) => samePos(x.at, t.pos));
      if (!e) continue;
      t.el.classList.toggle('entrance', e.entrance);
      t.el.textContent = exitMarker(e);
    }
  }

  /** V3.6 (19.5): pulse the exit hex the selected hero stands on (same pattern as the stairs). */
  showExitPulse(at: Pos | null): void {
    if (!at || at.level !== this.shownLevel) {
      this.exitPulse.visible = false;
      return;
    }
    this.exitPulse.visible = true;
    this.exitPulse.position.copy(this.worldOf(at, 0.06));
  }

  /** 15.7: the hover ring says whether the hex is something you can use (ember), a hazard (red) or floor. */
  setHoverStyle(kind: 'plain' | 'interact' | 'danger'): void {
    const m = this.hoverMesh.material as THREE.MeshBasicMaterial;
    m.color.setHex(kind === 'interact' ? COLORS.emberHot : kind === 'danger' ? COLORS.danger : COLORS.parchment);
    m.opacity = kind === 'plain' ? 0.8 : 1;
    const ghost = this.hoverMesh.children[0] as THREE.Mesh | undefined;
    if (ghost) ((ghost.material as THREE.MeshBasicMaterial).color.copy(m.color));
    this.hoverMesh.scale.setScalar(kind === 'plain' ? 1 : 1.04);
  }

  showLevel(level: number, instant = false): void {
    const lv = this.levels.get(level);
    if (!lv) return;
    const changed = level !== this.shownLevel;
    this.shownLevel = level;
    this.applyBelow();
    const y = levelY(level);
    this.rig.bounds.set(new THREE.Vector3(lv.min.x - 2, y - 1, lv.min.y - 2), new THREE.Vector3(lv.max.x + 2, y + 1, lv.max.y + 2));
    this.rig.setHeight(y, instant);
    if (instant && !this.state?.delve) this.frameLevel();
    this.refreshUnits();
    this.refreshProps();
    this.refreshIntentVisibility();
    for (const l of this.lips.children) l.visible = l.userData.level === level;
    for (const c of this.collapseDebris.children) c.visible = c.userData.level === level;
    this.facingKey = '';
    this.blindKey = '';
    this.fuseKey = '';
    this.soundKey = '';
    this.refreshFacing();
    this.refreshBlindArcs();
    this.refreshFuses();
    this.refreshSounds();
    if (changed) this.hooks.levelChanged(level);
  }

  /** Show the shown level normally, and the levels below it only where a pit above opens onto them. */
  private applyBelow(): void {
    const shown = this.shownLevel;
    let column: Set<string> | null = null;
    for (const [n, v] of [...this.levels.entries()].sort((a, b) => a[0] - b[0])) {
      if (n < shown) {
        v.group.visible = false;
        continue;
      }
      if (n === shown) {
        v.group.visible = true;
        v.applyFogLit(this.fogLit, this.fogUnlit, this.vis.explored);
        // Only pits the party has seen open onto what's below (no spoilers, less to draw).
        column = new Set([...v.pits].filter((k) => this.vis.explored.has(`${n}:${k}`)));
        continue;
      }
      if (!column || !column.size) {
        v.group.visible = false;
        continue;
      }
      // What is seen down the shaft: the column plus a halo (the camera looks in at an angle).
      const seen = new Set<string>();
      // Only under the shown level's footprint (elsewhere the void would show it floating).
      const upper = this.levels.get(shown)!.def.tiles;
      for (const k of column) for (const hx of range(parseHexKey(k), BELOW_HALO)) if (upper[hexKey(hx)]) seen.add(hexKey(hx));
      v.group.visible = true;
      v.applyBelow(seen);
      // The next level down is seen only through pits on this one that are inside the column.
      const next = new Set<string>();
      for (const k of column) if (v.pits.has(k)) next.add(k);
      column = next;
    }
  }

  frameLevel(): void {
    const lv = this.levels.get(this.shownLevel);
    if (!lv) return;
    const y = levelY(this.shownLevel);
    this.rig.focus(new THREE.Vector3((lv.min.x + lv.max.x) / 2, y, (lv.min.y + lv.max.y) / 2), true);
    this.rig.distance = Math.max(14, Math.min(110, Math.max(lv.max.x - lv.min.x, lv.max.y - lv.min.y) * 1.15));
  }

  /** Look at a world x/z on the shown level (scripts and screenshots). */
  focusXZ(x: number, z: number, instant = false): void {
    this.rig.focus(new THREE.Vector3(x, levelY(this.shownLevel), z), instant);
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
      this.effects.update(t);
      this.renderer.render(this.scene, this.rig.camera);
      this.updateDom();
    }
    requestAnimationFrame(this.loop);
  };

  /**
   * V3.4 (owner: "see all walls at their full height"): the cutaway that lowered walls between the
   * camera and the focus is off by default. The shader code stays; `setCutaway(true)` brings it back
   * (a settings toggle may call it). Hero figures hidden behind walls draw as a faint silhouette.
   */
  cutaway = false;

  /** Lower walls between the camera and the focus (true) or keep every wall at full height (false, default). */
  setCutaway(on: boolean): void {
    this.cutaway = on;
    this.updateCutaway();
  }

  private updateCutaway(): void {
    const cam = this.rig.camera.position;
    const tgt = this.rig.currentTarget();
    CUTAWAY.center.value.copy(tgt);
    const d = new THREE.Vector3(cam.x - tgt.x, 0, cam.z - tgt.z);
    if (d.lengthSq() < 1e-6) d.set(0, 0, 1);
    CUTAWAY.dir.value.copy(d.normalize());
    // Off: the cut height is above every wall, so nothing is lowered.
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
    const bearerShown = !!bearer && bearer.shown && bearer.at.level === this.shownLevel && !bearer.dead;
    if (bearer && bearerShown && this.lanternOpen) {
      const r = radiusOf[this.brightness];
      if (r > 0) srcs.push({ at: bearer.root.position.clone().add(new THREE.Vector3(0.3, bearer.height + 0.5, 0.3)), radius: r, color: this.brightness === 'bright' ? 0xffb862 : this.brightness === 'dim' ? 0xf09a48 : 0xd0763a, power: 1, seed: 0 });
    }
    // 16.2: the lantern itself hangs at the bearer's right hip, dark when shuttered or empty.
    this.lanternObj.visible = bearerShown;
    if (bearer && bearerShown) {
      const f = bearer.facing;
      const side = new THREE.Vector3(Math.cos(f), 0, -Math.sin(f)).multiplyScalar(bearer.height * 0.28);
      this.lanternObj.position.copy(bearer.root.position).add(side).add(new THREE.Vector3(0, bearer.height * 0.42 + bearer.fig.position.y, 0));
      this.lanternObj.rotation.y = f;
      const lit = this.lanternOpen && this.brightness !== 'pitch';
      const k = lit ? 0.75 + Math.sin(t * 9) * 0.1 + Math.sin(t * 23) * 0.05 : 0;
      (this.lanternGlow.material as THREE.SpriteMaterial).opacity = k;
      (this.lanternFlame.material as THREE.MeshBasicMaterial).color.setHex(lit ? 0xffd27a : 0x2a1e14);
      this.lanternFlame.scale.y = lit ? 0.9 + Math.sin(t * 11) * 0.12 : 0.6;
    }
    for (const id of this.torches) {
      const v = this.units.get(id);
      if (!v || !v.shown || v.at.level !== this.shownLevel || id === this.lanternBearer) continue;
      srcs.push({ at: v.root.position.clone().add(new THREE.Vector3(-0.3, v.height + 0.4, 0.2)), radius: 2, color: 0xff9a40, power: 0.9, seed: srcs.length * 1.7 });
    }
    const lv = this.levels.get(this.shownLevel);
    if (lv) {
      const target = this.rig.currentTarget();
      const pool: (Src & { d: number })[] = [];
      for (const b of lv.braziers.values()) if (b.lit) pool.push({ at: b.center.clone().add(new THREE.Vector3(0, 0.3, 0)), radius: 3, color: 0xff8a30, power: 1, seed: b.center.x, d: b.center.distanceToSquared(target) });
      // Fixed lights are baked into the floors; the nearest few also get a point light so figures pick them up.
      for (const f of lv.fixedLights) {
        if (!lv.lightShown(f)) continue;
        const d = f.at.distanceToSquared(target);
        if (d > 22 * 22) continue;
        pool.push({ at: f.at, radius: Math.max(1.5, f.radius), color: f.color, power: f.power * (f.def.kind === 'fire' ? 0.9 : 0.55), seed: f.at.x * 3.1 + f.at.z, d });
      }
      pool.sort((a, b) => a.d - b.d);
      for (const p of pool) if (srcs.length < MAX_LIGHTS) srcs.push(p);
      for (const f of lv.fixedLights)
        f.flames.forEach((c, i) => {
          if (f.def.kind === 'glow') {
            c.position.y = Math.sin(t * 0.7 + i) * 0.2;
            c.rotation.y = t * 0.3;
          } else {
            c.scale.y = 1 + Math.sin(t * (9 + i * 3) + f.at.x) * 0.2;
            c.scale.x = 1 + Math.sin(t * 13 + f.at.z) * 0.08;
          }
        });
      if (this.drumSpin > 0) {
        this.drumSpin = Math.max(0, this.drumSpin - 0.016);
        for (const d of lv.drums) d.rotation.x += 0.12;
      }
    }
    setFogTime(t);
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
    for (const g of this.breathMarks.children) {
      if (g.userData.breath) {
        const k = 0.5 + 0.5 * Math.sin(t * 7 + g.position.x);
        g.children[2]!.scale.set(1, 0.7 + k * 0.8, 1);
        g.children[2]!.position.y = 0.25 + k * 0.15;
        ((g.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.3 + 0.3 * k;
      } else if (g.userData.sweep) g.rotation.y = t * 0.8;
      else if (g.userData.shout) {
        const p = g.children[1] as THREE.Mesh | undefined;
        if (p) {
          const k = (t * 0.45) % 1;
          p.scale.setScalar(0.3 + k * (p.userData.max as number));
          (p.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - k);
        }
      }
    }
    for (const g of this.lootGlow.children) {
      const k = 0.5 + 0.5 * Math.sin(t * 2.6 + g.position.x * 1.7 + g.position.z);
      (g as THREE.Sprite).material.opacity = 0.45 + 0.35 * k;
      g.scale.setScalar(1.25 + 0.2 * k);
    }
    for (const l of this.lips.children) ((l as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.6 + 0.35 * Math.sin(t * 5);
    if (this.linkPulse.visible) {
      const k = 0.5 + 0.5 * Math.sin(t * 3.2);
      this.linkPulse.scale.setScalar(1 + k * 0.22);
      (this.linkPulse.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.55 * (1 - k);
    }
    if (this.exitPulse.visible) {
      const k = 0.5 + 0.5 * Math.sin(t * 3.2);
      this.exitPulse.scale.setScalar(1 + k * 0.22);
      (this.exitPulse.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.55 * (1 - k);
    }
    // 19.5: known exits breathe softly once the prize is in hand.
    for (const r of this.exitRings.children) {
      const k = 0.5 + 0.5 * Math.sin(t * 1.6 + (r.userData.phase as number));
      r.scale.setScalar(1 + k * 0.1);
      ((r as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.18 + 0.32 * k;
    }
    for (const b of this.beacon.children) {
      const k = 0.5 + 0.5 * Math.sin(t * 1.8 + (b.userData.phase as number));
      if (b.userData.pillar) ((b as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.16 + 0.1 * k;
      else if (b.userData.ring) {
        b.scale.setScalar(1 + 0.12 * k);
        ((b as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.5 + 0.4 * (1 - k);
      }
    }
    // Ripple: hex rings fade outward in a wave.
    if (this.rippleData && this.rippleMesh.count) {
      const m = this.rippleMesh.material as THREE.MeshBasicMaterial;
      m.opacity = 0.25 + 0.15 * Math.sin(t * 5);
    }
    // 16.2: dark rings follow unlit heroes; they breathe slowly.
    for (const r of this.darkRings.children) {
      const u = this.units.get(r.userData.unit as string);
      r.visible = !!u && u.shown && u.root.visible;
      if (u) {
        r.position.set(u.root.position.x, u.root.position.y + 0.035, u.root.position.z);
        const k = 0.5 + 0.5 * Math.sin(t * 1.6 + (r.userData.phase as number));
        r.scale.setScalar(1 + k * 0.08);
        ((r as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.45 + 0.2 * k;
      }
    }
    // V3.7 (20.1): facing wedges follow their figure and face where it turns.
    for (const g of this.facingMarks.children) {
      const u = this.units.get(g.userData.unit as string);
      g.visible = !!u && u.shown && u.root.visible && !u.dead;
      if (u) g.position.set(u.root.position.x, u.root.position.y + 0.045, u.root.position.z);
    }
    for (const r of this.riskRings.children) {
      const k = 0.5 + 0.5 * Math.sin(t * 6 + (r.userData.phase as number));
      r.scale.setScalar(1 + k * 0.14);
      ((r as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.5 + 0.5 * k;
    }
    for (const r of this.blindMarks.children) {
      const k = 0.5 + 0.5 * Math.sin(t * 2.4 + (r.userData.phase as number));
      r.scale.setScalar(1 + k * 0.12);
      ((r as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.45 * k;
    }
    for (const r of this.soundMarks.children) {
      // 24.8: a loud sound's ring pulses outward and fades, over and over.
      const k = ((t * 0.9 + (r.userData.phase as number)) % 1 + 1) % 1;
      r.scale.setScalar(0.7 + k * 0.6);
      ((r as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - k);
    }
    for (const g of this.fuseMarks.children) {
      if (g.userData.spark) {
        const k = 0.5 + 0.5 * Math.sin(t * 11 + (g.userData.phase as number));
        g.scale.setScalar(0.5 + k * 0.5);
        ((g as THREE.Sprite).material as THREE.SpriteMaterial).opacity = 0.6 + 0.4 * k;
      } else if (g.userData.inner) {
        const k = 0.5 + 0.5 * Math.sin(t * 4 + g.position.x);
        ((g.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.22 + 0.25 * k;
      }
    }
    // 18.7: crew rings follow their rival.
    for (const r of this.crewRings.children) {
      const u = this.units.get(r.userData.unit as string);
      r.visible = !!u && u.shown && u.root.visible;
      if (u) {
        r.position.set(u.root.position.x, u.root.position.y + 0.04, u.root.position.z);
        if (r.userData.pulse) ((r as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.35 * Math.abs(Math.sin(t * 3));
      }
    }
    // 16.2: the Gloam's darkness creeps: tiles pulse out of phase, deeper when the Gloam is near.
    if (this.gloamEdge.count) {
      const m = this.gloamEdge.material as THREE.MeshBasicMaterial;
      m.opacity = 0.42 + 0.18 * Math.sin(t * 1.3);
    }
    // 16.1: route arrows drift along their segment.
    for (const g of this.routes.children) {
      if (!g.userData.arrow) continue;
      const a = g.userData.a as THREE.Vector3;
      const b = g.userData.b as THREE.Vector3;
      const k = ((t * 0.25 + (g.userData.phase as number)) % 1 + 1) % 1;
      g.position.lerpVectors(a, b, k);
    }
    void dt;
  }

  /** 16.2: heroes standing in the dark (from engine.heroLit) get a dark ring on the floor. */
  setDarkHeroes(ids: string[]): void {
    const next = new Set(ids);
    const same = next.size === this.darkHeroes.size && [...next].every((id) => this.darkHeroes.has(id));
    if (same) return;
    this.darkHeroes = next;
    this.darkRings.clear();
    let i = 0;
    for (const id of next) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.92, 1.55, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x030208, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
      ring.userData = { unit: id, phase: i++ * 1.3 };
      ring.renderOrder = 1;
      this.darkRings.add(ring);
    }
  }

  /** 16.2: open or shutter the lantern model and light. */
  setLantern(open: boolean): void {
    this.lanternOpen = open;
  }

  /**
   * 16.1: known patrol routes on the shown level: a faint dotted loop through the waypoints
   * with small arrows drifting along it.
   */
  private refreshRoutes(): void {
    const d = this.state?.delve;
    const known = new Set(d?.knownRoutes ?? []);
    const list = (d?.monsters ?? []).filter((m) => m.hp > 0 && m.route && m.route.length > 1 && known.has(m.id) && m.route[0]!.level === this.shownLevel);
    const key = list.map((m) => `${m.id}:${m.route!.length}`).join('|');
    if (key === this.routesKey) return;
    this.routesKey = key;
    this.routes.clear();
    if (!list.length) return;
    const dotGeo = new THREE.CircleGeometry(0.09, 6).rotateX(-Math.PI / 2);
    const dotMat = new THREE.MeshBasicMaterial({ color: 0xc8a070, transparent: true, opacity: 0.4, depthWrite: false });
    const arrowMat = new THREE.MeshBasicMaterial({ color: 0xe0b078, transparent: true, opacity: 0.7, depthWrite: false });
    let phase = 0;
    for (const m of list) {
      const pts = m.route!.map((p) => this.worldOf(p, 0.05));
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i]!;
        const b = pts[(i + 1) % pts.length]!;
        const len = a.distanceTo(b);
        if (len < 0.05) continue;
        const n = Math.max(1, Math.round(len / 0.55));
        for (let j = 0; j < n; j++) {
          const dot = new THREE.Mesh(dotGeo, dotMat);
          dot.position.lerpVectors(a, b, j / n);
          dot.renderOrder = 2;
          this.routes.add(dot);
        }
        const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.34, 3), arrowMat);
        arrow.rotation.x = Math.PI / 2;
        const g = new THREE.Group();
        g.add(arrow);
        g.position.copy(a);
        g.lookAt(b);
        g.position.y += 0.04;
        g.userData = { arrow: true, a: a.clone().setY(a.y + 0.04), b: b.clone().setY(b.y + 0.04), phase: (phase += 0.37) };
        g.renderOrder = 3;
        this.routes.add(g);
      }
      // Waypoint rings.
      for (const p of pts) {
        const ring = new THREE.Mesh(hexRing(0.5, 0.6), dotMat);
        ring.position.copy(p);
        ring.renderOrder = 2;
        this.routes.add(ring);
      }
    }
  }

  /**
   * 16.2: while the Gloam is on the shown level (the Hollow), every visible unlit hex that
   * touches the party's light is tiled with creeping darkness.
   */
  private refreshGloamEdge(): void {
    const d = this.state?.delve;
    const gloam = d?.monsters.find((m) => m.kind === 'gloam' && m.hp > 0);
    const on = !!gloam && gloam.at.level === this.shownLevel;
    const key = on ? `${this.shownLevel}:${this.vis.visible.size}:${this.vis.lit.size}:${gloam!.id}` : '';
    if (key === this.gloamEdgeKey) return;
    this.gloamEdgeKey = key;
    if (!on) {
      this.gloamEdge.count = 0;
      return;
    }
    const lvPrefix = `${this.shownLevel}:`;
    const m = new THREE.Matrix4();
    let n = 0;
    for (const k of this.vis.visible) {
      if (!k.startsWith(lvPrefix) || this.vis.lit.has(k) || n >= 400) continue;
      const p = parsePos(k);
      // Only hexes within 2 of the light (the edge), so the dark reads as a ring and not a blanket.
      let near = false;
      for (const h of range(p, 2)) if (this.vis.lit.has(posKey({ level: p.level, ...h }))) near = true;
      if (!near) continue;
      m.makeTranslation(this.worldOf(p, 0.03));
      this.gloamEdge.setMatrixAt(n++, m);
    }
    this.gloamEdge.count = n;
    this.gloamEdge.instanceMatrix.needsUpdate = true;
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
    for (const t of this.lootTags.values()) {
      const p = this.project(t.at);
      t.el.style.display = p.behind ? 'none' : '';
      t.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
    }
    // V3.7: move-risk tags sit above the intent tag (if any) over the enemy.
    for (const [id, el] of this.riskTags) {
      const v = this.units.get(id);
      if (!v || !v.root.visible || v.dead) {
        el.style.display = 'none';
        continue;
      }
      const stack = this.intentTags.has(id) ? 46 : 22;
      const p = this.project(v.root.position.clone().add(new THREE.Vector3(0, v.height + 0.35, 0)));
      el.style.display = p.behind ? 'none' : '';
      el.style.transform = `translate(${p.x}px, ${p.y - stack}px) translate(-50%, -100%)`;
    }
    for (const t of this.blindTags) {
      const p = this.project(t.at);
      t.el.style.display = p.behind ? 'none' : '';
      t.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
    }
    for (const t of this.fuseTags) {
      const p = this.project(t.at);
      t.el.style.display = p.behind || t.level !== this.shownLevel ? 'none' : '';
      t.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
    }
    for (const t of this.soundTags) {
      const p = this.project(t.at);
      t.el.style.display = p.behind || t.level !== this.shownLevel ? 'none' : '';
      t.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
    }
    if (this.landingAt) {
      const p = this.project(this.landingAt);
      this.landingTag.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
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
    // 15.7: level markers over explored stairs and lift ends; the lift's is greyed until the winch runs.
    for (const l of this.linkTags) {
      const show = l.level === this.shownLevel && this.vis.explored.has(l.key) && !!this.state?.delve;
      if (!show) {
        l.el.style.display = 'none';
        continue;
      }
      // Above a figure standing there, so it doesn't sit on their HP tag.
      let occupied = 0;
      for (const v of this.units.values()) if (v.shown && samePos(v.at, l.pos)) occupied = Math.max(occupied, v.height + 0.9);
      const p = this.project(occupied ? l.at.clone().setY(l.at.y + occupied - 1.5) : l.at);
      l.el.style.display = p.behind ? 'none' : '';
      if (l.lift) l.el.classList.toggle('dead', !this.liftWorking);
      l.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
    }
    if (this.beaconAt) {
      const p = this.project(this.beaconAt);
      this.beaconTag.style.display = p.behind ? 'none' : '';
      this.beaconTag.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
    }
  }

  floatText(at: Pos | THREE.Vector3, text: string, kind: FloatKind = 'info', life = 1.3): void {
    const el = document.createElement('div');
    el.className = `floater floater-${kind}`;
    el.textContent = text;
    this.fx.appendChild(el);
    const world = at instanceof THREE.Vector3 ? at.clone() : this.worldOf(at, FLOAT_LIFT);
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
    this.applyLitFog();
    if (!d) {
      for (const v of [...this.units.values()]) this.removeUnit(v.id);
      for (const id of [...this.props.keys()]) this.removeProp(id);
      this.clearIntents();
      this.refreshLootGlow();
      this.refreshSounds();
      this.dugWalls.clear();
      this.applyBrokenWalls([]);
      return;
    }
    this.brightness = brightness ?? (d.light > 36 ? 'bright' : d.light >= 19 ? 'dim' : d.light >= 1 ? 'dark' : 'pitch');
    this.lanternBearer = d.lanternBearer;
    this.lanternOpen = d.lanternOpen !== false;
    this.liftWorking = !!d.liftWorking;
    this.torches = new Set(d.heroes.filter((h) => h.torch > 0 && h.status === 'active').map((h) => h.heroId));
    this.syncUnits(state);
    this.syncWorld(state);
    this.refreshUnits();
    this.refreshProps();
    this.facingKey = '';
    this.refreshFacing();
    this.blindKey = '';
    this.refreshBlindArcs();
    this.refreshFuses();
    this.refreshSounds();
  }

  /** Visible-but-unlit hexes look darker than lit ones. */
  private applyLitFog(): void {
    // Handled per instance via fog value 0.75 for unlit visible hexes.
    const vis = new Set<string>();
    const unlit = new Set<string>();
    for (const k of this.vis.visible) (this.vis.lit.has(k) ? vis : unlit).add(k);
    this.fogLit = vis;
    this.fogUnlit = unlit;
    this.applyBelow();
  }

  private modelFor(kind: string, awareness?: string): ModelKey {
    if (kind === 'dragon') return awareness === 'asleep' ? 'dragonSleep' : 'dragon';
    return kind as ModelKey;
  }

  /** 16.5: a sister's model by her class; 18.5: cutthroats by crew and class. */
  private rivalModel(r: Rival): ModelKey {
    if (r.crew === 'ferrymen' || r.crew === 'gallows-choir' || r.crew === 'the-wake') return `rival-${r.crew}-${r.cls}` as ModelKey;
    const cls = r.cls;
    return cls === 'ranger' ? 'sisterRanger' : cls === 'shadowmancer' ? 'sisterShadow' : cls === 'burglar' ? 'sisterBurglar' : 'sister';
  }

  /** 18.7: rebuild the crew rings when the members or the stance change. */
  private syncCrewRings(crew: RivalCrew | null, round: number): void {
    const live = crew && round >= crew.entersRound ? crew.members.filter((m) => !m.goneOut && m.hp > 0) : [];
    const key = crew ? `${crew.stance}|${live.map((m) => m.id).join(',')}` : '';
    if (key === this.crewRingKey) return;
    this.crewRingKey = key;
    this.crewRings.clear();
    if (!crew) return;
    const col = crew.stance === 'hired' ? 0x7fe07a : crew.stance === 'hostile' ? COLORS.danger : crew.stance === 'demanding' ? 0xffb35c : 0xb8ad98;
    for (const m of live) {
      const ring = new THREE.Mesh(hexRing(0.62, crew.stance === 'hired' ? 0.86 : 0.78), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: crew.stance === 'hired' ? 0.85 : 0.6, depthWrite: false }));
      ring.userData = { unit: m.id, pulse: crew.stance === 'demanding' };
      ring.renderOrder = 2;
      this.crewRings.add(ring);
    }
  }

  private ensureUnit(id: string, key: ModelKey, side: UnitSide, at: Pos, name: string): UnitView {
    let v = this.units.get(id);
    if (!v) {
      v = new UnitView(id, key, side, at, this.clock);
      this.units.set(id, v);
      this.scene.add(v.root);
      v.root.position.copy(this.worldOf(at));
      // Everyone starts facing the camera (+z), so faces and shields read at a glance.
      v.face(0, 1);
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
    const draggers = new Map<string, string>();
    for (const r of d.rivals?.members ?? []) if (r.dragging && r.hp > 0 && !r.goneOut) draggers.set(r.dragging, r.name);
    for (const h of d.heroes) {
      if (h.status === 'out' || h.status === 'dead' || h.status === 'captured') continue;
      const hero = state.campaign.roster.find((r) => r.id === h.heroId);
      const v = this.ensureUnit(h.heroId, (hero?.cls ?? 'sellsword') as ModelKey, 'hero', h.at, hero?.name ?? h.heroId);
      keep.add(h.heroId);
      place(v, h.at);
      v.lieDown(h.status === 'downed');
      v.dead = false;
      v.setOpacity(1);
      this.setTag(h.heroId, heroTag(h, hero?.maxHp ?? 10, h.heroId === d.lanternBearer, this.lanternOpen, draggers.get(h.heroId), !!hero?.shield));
      // V3.9 (24.2): heroes turn to their facing too.
      if (h.facing !== undefined && !v.busy && h.status === 'active') {
        const a = facingAngle(h.facing);
        v.face(Math.sin(a), Math.cos(a));
      }
      this.setShield(v, !!hero?.shield);
    }
    // V3.7 (20.1): figures turn to their engine facing when it is known (and they aren't mid-animation).
    const turn = (v: UnitView, u: { facing?: number }) => {
      if (u.facing === undefined || v.busy) return;
      const a = facingAngle(u.facing);
      v.face(Math.sin(a), Math.cos(a));
    };
    for (const m of d.monsters) {
      if (m.hp <= 0 || m.buried) continue;
      const want = this.modelFor(m.kind, m.awareness);
      const have = this.units.get(m.id);
      if (have && have.key !== want && !have.busy) this.removeUnit(m.id);
      const v = this.ensureUnit(m.id, want, 'monster', m.at, m.name);
      keep.add(m.id);
      place(v, m.at);
      turn(v, m);
      v.dead = false;
      v.setOpacity(1);
      v.fig.rotation.z = 0;
      this.setTag(m.id, m.kind === 'gloam' ? '' : monsterTag(m));
    }
    this.syncCrewRings(d.rivals, d.round);
    if (d.rivals) {
      const st = d.rivals.stance;
      const pip = st === 'hostile' ? 'enemy' : st === 'hired' ? 'ally' : 'rival';
      const flag = st === 'hired' ? `<b class="tag-hired" title="Hired: fighting beside you">hired${d.rivals.hiredRounds ? ` · ${d.rivals.hiredRounds}` : ''}</b>` : st === 'demanding' ? '<b class="tag-toll">toll!</b>' : st === 'truce' ? '<b class="tag-truce">truce</b>' : '';
      for (const r of d.rivals.members) {
        if (r.goneOut || r.hp <= 0 || d.round < d.rivals.entersRound) continue;
        const want = this.rivalModel(r);
        const have = this.units.get(r.id);
        if (have && have.key !== want && !have.busy) this.removeUnit(r.id);
        const v = this.ensureUnit(r.id, want, 'rival', r.at, r.name);
        keep.add(r.id);
        place(v, r.at);
        turn(v, r);
        v.setOpacity((r.veil ?? 0) > 0 ? 0.45 : 1);
        const tagEl = this.tags.get(r.id)?.el;
        if (tagEl) tagEl.className = `unit-tag tag-rival tag-st-${st} crew-${r.crew}`;
        // V3.7 (20.4): level badge, feared and dragging marks.
        const lvl = r.level && r.level > 1 ? `<b class="tag-lvl" title="Level ${r.level}${r.weaponTier ? `, weapon +${r.weaponTier}` : ''}${r.armorTier ? `, armor +${r.armorTier}` : ''}">L${r.level}</b>` : '';
        const marks = (r.feared ?? 0) > 0 ? '<b class="tag-fear">feared</b>' : r.dragging ? `<b class="tag-dragging">dragging ${state.campaign.roster.find((x) => x.id === r.dragging)?.name ?? ''}</b>` : (r.veil ?? 0) > 0 ? '<b class="tag-veil">veiled</b>' : r.overwatch ? '<b class="tag-ow">overwatch</b>' : '';
        this.setTag(r.id, lvl + pipsHtml(r.hp, r.maxHp, pip) + flag + marks);
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
    // V3.7 (20.3, 20.3a): walls a blast broke are rubble, floor it dropped is pit: rebuild those levels.
    this.applyBrokenWalls(d.blown, d.collapsed ?? []);
    // V3.7 (20.5): smashed crates and barrels are gone.
    for (const lv of this.levels.values()) lv.setSmashed(new Set(d.smashed ?? []));
    // Braziers.
    this.litBraziers = new Set(d.lit);
    for (const lv of this.levels.values()) {
      for (const b of lv.braziers.values()) {
        b.lit = this.litBraziers.has(b.key);
        b.fire.visible = b.lit;
      }
      lv.setBlown(this.blownForView(d.blown));
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
      const np = this.ensureProp(key, () => (kind === 'copper' ? makeCopper() : kind === 'book' ? makeBook() : kind === 'hoard' ? makeHoard() : kind === 'heirloom' ? makeHeirloom() : kind === 'gold' ? makeCoins(g.items.reduce((a, i) => a + i.amount, 0)) : makeSack()), g.at, (hashStr(key) % 6) * (Math.PI / 3));
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

  /**
   * 15.7: where the contract objective is, if its hex has been explored: the heirloom on the
   * ground (or carried by a rival, then none), the prisoner until freed, the Dragon while it lives.
   * Null before it's seen or once it's done.
   */
  objectiveAt(): { at: Pos; kind: 'recover' | 'rescue' | 'slay'; label: string } | null {
    const d = this.state?.delve;
    if (!d) return null;
    const k = d.contract;
    let at: Pos | null = null;
    let label = '';
    if (k.kind === 'recover') {
      const g = d.ground.find((x) => x.items.some((i) => i.contractId === k.id || i.kind === 'heirloom' || (!!k.story && i.story === k.story)));
      if (g) {
        at = g.at;
        label = g.items.find((i) => i.contractId === k.id || i.kind === 'heirloom' || (!!k.story && i.story === k.story))!.name;
      }
    } else if (k.kind === 'rescue') {
      const p = d.prisoner;
      if (p && !p.freed && !p.out && !p.dead) {
        at = p.at;
        label = p.name;
      }
    } else {
      const m = d.monsters.find((x) => x.kind === 'dragon' && x.hp > 0);
      if (m) {
        at = m.at;
        label = m.name;
      }
    }
    if (!at || !this.vis.explored.has(posKey(at))) return null;
    return { at, kind: k.kind, label };
  }

  /** Rebuild the beacon (pillar of light + diamond) for the objective, on the shown level only. */
  private refreshBeacon(): void {
    const o = this.objectiveAt();
    const key = o && o.at.level === this.shownLevel ? `${posKey(o.at)}:${o.kind}` : '';
    if (key === this.beaconKey) return;
    this.beaconKey = key;
    this.beacon.clear();
    this.beaconAt = null;
    this.beaconTag.classList.add('hidden');
    if (!o || !key) return;
    const col = BEACON_COLOR[o.kind];
    const base = this.worldOf(o.at, 0.05);
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.5, 9, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    pillar.position.copy(base).add(new THREE.Vector3(0, 4.5, 0));
    pillar.userData = { pillar: true, phase: 0 };
    const ring = new THREE.Mesh(hexRing(0.55, 0.92), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8, depthWrite: false }));
    ring.position.copy(base);
    ring.userData = { ring: true, phase: 1 };
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: col, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.position.copy(base).add(new THREE.Vector3(0, 0.3, 0));
    glow.scale.setScalar(2.4);
    glow.userData = { phase: 2 };
    this.beacon.add(pillar, ring, glow);
    this.beaconAt = this.worldOf(o.at, o.kind === 'slay' ? 4.6 : 2.3);
    this.beaconTag.className = `beacon-tag ${o.kind}`;
    this.beaconTag.textContent = o.label;
    this.beaconTag.classList.remove('hidden');
  }

  /**
   * V3.6 (19.5): once the prize is in hand, every known exit on the shown level gets a soft
   * pulsing ring (the entrance always counts as known).
   */
  private refreshExitRings(): void {
    const d = this.state?.delve;
    const go = !!d && !!this.castle && prizeInHand(d);
    const list = go ? exitList(this.castle!, this.entrance, this.shownLevel).filter((e) => e.entrance || this.vis.explored.has(posKey(e.at))) : [];
    const key = list.map((e) => posKey(e.at)).join('|');
    if (key === this.exitRingsKey) return;
    this.exitRingsKey = key;
    this.exitRings.clear();
    for (const t of this.linkTags) if (t.exit) t.el.classList.toggle('go', go);
    let i = 0;
    for (const e of list) {
      const ring = new THREE.Mesh(hexRing(0.58, 0.96), new THREE.MeshBasicMaterial({ color: 0xd8ecff, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending }));
      ring.position.copy(this.worldOf(e.at, 0.05));
      ring.userData = { phase: i++ * 1.1 };
      ring.renderOrder = 3;
      this.exitRings.add(ring);
    }
  }

  private refreshProps(): void {
    this.refreshLootGlow();
    this.refreshBeacon();
    this.refreshExitRings();
    this.refreshRoutes();
    this.refreshGloamEdge();
    this.effects.set(effectsFromState(this.state));
    for (const p of this.props.values()) {
      const at = p.obj.userData.at as Pos;
      const k = posKey(at);
      const fog = this.vis.visible.has(k) ? (this.vis.lit.has(k) ? 1 : 0.75) : this.vis.explored.has(k) ? 0.5 : 0;
      p.obj.visible = at.level === this.shownLevel && fog > 0;
      setMaterialFog(p.mats, fog);
    }
  }

  /** 15.6: every pile on an explored hex of the shown level glows gold until taken. */
  private refreshLootGlow(): void {
    const d = this.state?.delve;
    const want = new Map<string, Pos>();
    if (d)
      for (const g of d.ground) {
        if (!g.items.length || g.at.level !== this.shownLevel) continue;
        const k = posKey(g.at);
        if (this.vis.explored.has(k)) want.set(k, g.at);
      }
    for (const [k, t] of this.lootTags)
      if (!want.has(k)) {
        t.el.remove();
        this.lootTags.delete(k);
      }
    this.lootGlow.clear();
    for (const [k, at] of want) {
      const sp = new THREE.Sprite(this.lootGlowMat());
      sp.position.copy(this.worldOf(at, 0.25));
      sp.renderOrder = 3;
      this.lootGlow.add(sp);
      if (!this.lootTags.has(k)) {
        const el = document.createElement('div');
        el.className = 'loot-marker';
        el.textContent = '';
        el.title = 'Unlooted';
        this.fx.appendChild(el);
        this.lootTags.set(k, { el, at: this.worldOf(at, 0.9) });
      }
    }
  }

  private lootMat: THREE.SpriteMaterial | null = null;
  private lootGlowMat(): THREE.SpriteMaterial {
    // One material per sprite so each can pulse on its own phase.
    if (!this.lootMat) this.lootMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffc040, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending });
    return this.lootMat.clone();
  }

  // ------------------------------------------------------------ highlights

  highlight(hexes: Pos[], style: HighlightStyle): void {
    const mesh = this.highlights.get(style)!;
    const m = new THREE.Matrix4();
    let n = 0;
    // V3.7: a breakable wall's outline sits on the wall's top, not under it.
    const lift = style === 'breakable' ? WALL_HEIGHT + 0.06 : 0.025;
    for (const p of hexes) {
      if (p.level !== this.shownLevel || n >= 600) continue;
      m.makeTranslation(this.worldOf(p, lift));
      mesh.setMatrixAt(n++, m);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
  }

  clearHighlights(): void {
    for (const m of this.highlights.values()) m.count = 0;
    this.showPath(null);
    this.showRipple(null, 0);
    this.linkPulse.visible = false;
    this.exitPulse.visible = false;
  }

  showPath(path: Pos[] | null, endFacing?: number): void {
    if (!path || !path.length) {
      this.pathDots.count = 0;
      this.pathEnd.visible = false;
      this.showFacing(null);
      return;
    }
    this.showFacing(path[path.length - 1]!, endFacing);
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
    this.breathMarks.clear();
    for (const el of this.intentTags.values()) el.remove();
    this.intentTags.clear();
  }

  showIntents(state: GameState, intents: Record<string, Intent>): void {
    this.clearIntents();
    const d = state.delve;
    if (!d) return;
    // 16.5: rivals carry their own intent; monsters' come from the engine.
    const list: { id: string; name: string; at: Pos; it: Intent }[] = [];
    for (const [id, it] of Object.entries(intents)) {
      const m = d.monsters.find((x) => x.id === id) ?? d.rivals?.members.find((x) => x.id === id);
      if (m) list.push({ id, name: m.name, at: m.at, it });
    }
    if (d.rivals && d.rivals.spotted && d.round >= d.rivals.entersRound)
      for (const r of d.rivals.members) {
        if (r.intent && r.hp > 0 && !r.goneOut && this.vis.visible.has(posKey(r.at)) && !intents[r.id]) list.push({ id: r.id, name: r.name, at: r.at, it: r.intent });
      }
    for (const { id, name, at, it } of list) {
      if (it.kind === 'wait') continue;
      const el = document.createElement('div');
      el.className = `intent intent-${it.kind}`;
      const target = it.targetId ? targetName(state, it.targetId) : '';
      const glyph = INTENT_GLYPH[it.kind] ?? '?';
      const dmg = it.damage && it.damage[1] > 0 ? (it.damage[0] === it.damage[1] ? `${it.damage[1]}` : `${it.damage[0]}–${it.damage[1]}`) : '';
      el.innerHTML = `<span class="intent-icon">${glyph}</span>${dmg ? `<span class="intent-dmg">${dmg}</span>` : ''}`;
      el.title = `${name}: ${INTENT_WORDS[it.kind] ?? it.kind}${target ? ` ${target}` : ''}${dmg ? ` for ${dmg}` : ''}`;
      this.fx.appendChild(el);
      this.intentTags.set(id, el);
      if (it.kind === 'breath' && it.hexes?.length) {
        this.markBreath(it.hexes, id);
        el.title = `${name}: breathes fire next turn on the marked hexes (${it.damage ? it.damage[1] : 4} damage, no roll, armor doesn't help)`;
        continue;
      }
      if (it.kind === 'sweep') {
        this.markSweep(at, id);
        continue;
      }
      if (it.kind === 'shove' && it.to) {
        const victim = it.targetId ? targetPos(state, it.targetId) : null;
        // V3.9.3 (24.8): the plan was made before the victim moved away: no stale arrow, the tag still names it.
        if (!staleShove(victim, it.to)) this.markShove(at, victim, it.to, id);
        el.title = `${name}: knocks ${target} back to the marked hex${this.levels.get(it.to.level)?.pits.has(hexKey(it.to)) ? ' (a pit!)' : ''}`;
        continue;
      }
      // 16.4: drag: the webbed hero is pulled one hex toward the spider (pits count).
      if (it.kind === 'drag' && it.to) {
        const victim = it.targetId ? targetPos(state, it.targetId) : null;
        if (!staleShove(victim, it.to)) this.markShove(at, victim, it.to, id, 0xd8d8e8);
        el.title = `${name}: drags ${target} one hex closer${this.levels.get(it.to.level)?.pits.has(hexKey(it.to)) ? ' (into a pit!)' : ''}`;
        continue;
      }
      // 16.4: shout: every orc within 8 wakes and hunts next phase.
      if (it.kind === 'shout') {
        this.markRadius(at, 8, id, 0xffa040, 'shout');
        el.title = `${name}: shouts next turn. Every orc within 8 hexes wakes and hunts${target ? ` ${target}` : ''}.`;
        continue;
      }
      // 16.5: rival overwatch: a faint ring at range 6.
      if (it.kind === 'overwatch') {
        this.markRadius(at, 6, id, 0xffd060, 'ring');
        el.title = `${name}: on overwatch. Shoots the first hero that moves or acts within 6.`;
        continue;
      }
      if (it.kind === 'veil') {
        el.title = `${name}: veils herself. Hard to see next turn.`;
        continue;
      }
      // 18.5: the toll: a demand with a one-round fuse, not an attack yet.
      if (it.kind === 'toll') {
        const crew = d.rivals;
        const toll = crew?.toll ?? 50;
        el.innerHTML = `<span class="intent-icon">¤</span><span class="intent-dmg">${toll}</span><span class="intent-fuse">1</span>`;
        el.title = `${name}: "Your gold or your blood." Pay ${toll} or they attack next turn. Parley to pay or deal.`;
        this.markRadius(at, 1, id, 0xffb35c, 'ring');
        continue;
      }
      // 20.3: a rival Sapper sets a fused charge: the two blast rings in the enemy colour and the fuse number.
      if (it.kind === 'fuse') {
        const centre = it.to ?? at;
        if (this.castle) {
          const rings = blastRings(this.castle, centre);
          this.markBreath(rings.inner, id);
          for (const p of rings.outer) {
            const ring = new THREE.Mesh(hexRing(0.66, 0.78), new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.6, depthWrite: false }));
            ring.position.copy(this.worldOf(p, 0.04));
            ring.userData = { monster: id, level: p.level };
            this.intentLines.add(ring);
          }
        }
        el.innerHTML = `<span class="intent-icon">✹</span><span class="intent-dmg">4</span><span class="intent-fuse">1</span>`;
        el.title = `${name}: sets a charge on the marked hex with a 1-turn fuse. When it blows: 4 damage within 1 (and a shove), 2 within 2; it breaks walls within 1. Get out of the rings.`;
        continue;
      }
      if (it.kind === 'rob') {
        el.title = `${name}: robs ${target || 'a downed hero'} of their gold and gems, then drags them toward the way out.`;
      }
      if (it.kind === 'potion') {
        el.title = `${name}: backs off a hex and drinks a potion (heals 5).`;
        continue;
      }
      if (it.kind === 'item') {
        const what = it.item;
        el.title = `${name}: uses ${what ? `a ${what}` : 'an item from the pack'}${target ? ` on ${target}` : ''} next turn.`;
      }
      // 20.4: crew spells and items with an area: fireball and gust hit everything within 1 of the hex.
      if ((it.kind === 'fireball' || it.kind === 'gust' || it.kind === 'glue') && (it.to || it.hexes?.length)) {
        const centre = it.to ?? it.hexes![0]!;
        const hexes = it.hexes?.length ? it.hexes : [centre, ...range(centre, 1).filter((h) => h.q !== centre.q || h.r !== centre.r).map((h) => ({ level: centre.level, ...h }))];
        if (it.kind === 'fireball') this.markBreath(hexes, id);
        else
          for (const p of hexes) {
            const ring = new THREE.Mesh(hexRing(0.6, 0.8), new THREE.MeshBasicMaterial({ color: it.kind === 'gust' ? 0xd0f0ff : 0xd8e04a, transparent: true, opacity: 0.6, depthWrite: false }));
            ring.position.copy(this.worldOf(p, 0.04));
            ring.userData = { monster: id, level: p.level };
            this.intentLines.add(ring);
          }
        el.title = `${name}: ${INTENT_WORDS[it.kind]} the marked hexes next turn${it.kind === 'fireball' ? ' (3 Wits slots, 2 per hit, allies too)' : it.kind === 'gust' ? ' (everything pushed a hex outward: pits!)' : ' (monsters and heroes there stuck 2 rounds)'}.`;
        continue;
      }
      if (it.kind === 'hamstring') el.title = `${name}: shoots ${target || 'a hero'} in the legs next turn: 1 Finesse slot at −20%; a hit roots them 2 rounds (no move, no dash). Break the line of sight or get out of range 5.`;
      if (it.kind === 'mend' || it.kind === 'ward') el.title = `${name}: ${INTENT_WORDS[it.kind]} ${target || 'a friend'} next turn${it.kind === 'mend' ? ' (heals 4)' : ' (1 less damage per hit)'}.`;
      if (it.kind === 'caltrops' || it.kind === 'firecracker' || it.kind === 'blink') el.title = `${name}: ${INTENT_WORDS[it.kind]} the marked hex next turn${it.kind === 'firecracker' ? ' (noise 6: monsters come running)' : it.kind === 'caltrops' ? ' (the first across takes 2 and stops)' : ''}.`;
      if (it.kind === 'flee') {
        el.title = `${name}: feared: runs its full move away${target ? ` from ${target}` : ''}, attacks nobody. Every hero it leaves gets a free swing.`;
      }
      // 18.5: the Sapper's charge: the blast hexes, 3 damage to everyone within 1 of the mark.
      if (it.kind === 'charge') {
        const centre = it.to ?? (it.targetId ? targetPos(state, it.targetId) : null);
        const hexes = it.hexes?.length ? it.hexes : centre ? [centre, ...range(centre, 1).filter((h) => h.q !== centre.q || h.r !== centre.r).map((h) => ({ level: centre.level, ...h }))] : [];
        if (hexes.length) this.markBreath(hexes, id);
        el.innerHTML = `<span class="intent-icon">✹</span><span class="intent-dmg">3</span>`;
        el.title = `${name}: lights a charge. Next turn it blows: 3 damage to everyone on the marked hexes, no roll. Noise 8. Get off them.`;
        continue;
      }
      if (it.kind === 'firebolt') {
        el.title = `${name}: hurls a firebolt at ${target || 'a hero'} next turn: 3 Wits slots at 60%, 2 damage per hit. Break the line of sight or get out of range 5.`;
      }
      // Smoke: the bomb lands on `to`; mark the hex and its neighbours.
      if (it.kind === 'smoke' && it.to) {
        const hexes = [it.to, ...range(it.to, 1).map((h) => ({ level: it.to!.level, ...h }))];
        for (const p of hexes) {
          const ring = new THREE.Mesh(hexRing(0.6, 0.8), new THREE.MeshBasicMaterial({ color: 0xb0b0b4, transparent: true, opacity: 0.5, depthWrite: false }));
          ring.position.copy(this.worldOf(p, 0.04));
          ring.userData = { monster: id, level: p.level };
          this.intentLines.add(ring);
        }
        el.title = `${name}: throws a smoke bomb at the marked hexes${target ? ` (near ${target})` : ''}.`;
      }
      // A line to the target or destination.
      const from = this.worldOf(at, 0.9);
      let to: THREE.Vector3 | null = null;
      if (it.targetId) {
        const tp = targetPos(state, it.targetId);
        if (tp && tp.level === at.level) to = this.worldOf(tp, 0.9);
      } else if (it.to && it.to.level === at.level) to = this.worldOf(it.to, 0.08);
      if (to && at.level === this.shownLevel) {
        const col = it.kind === 'attack' || it.kind === 'steal' || it.kind === 'grab' || it.kind === 'rob' ? COLORS.danger : it.kind === 'firebolt' ? 0xff7a20 : it.kind === 'web' ? 0xd8d8d8 : it.kind === 'dart' ? 0x9ad0ff : it.kind === 'smoke' ? 0xb0b0b4 : it.kind === 'mend' || it.kind === 'ward' ? 0x7fe08a : it.kind === 'blink' ? 0x9a6aff : it.kind === 'hamstring' ? 0xd8c080 : 0xb08a6a;
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

  /** 16.4/16.5: a big ring of radius `r` hexes round a figure (shout, rival overwatch). */
  private markRadius(at: Pos, r: number, monster: string, color: number, kind: 'shout' | 'ring'): void {
    const g = new THREE.Group();
    const R = r * Math.sqrt(3) * HEX;
    const ring = new THREE.Mesh(new THREE.RingGeometry(R - 0.18, R, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: kind === 'shout' ? 0.55 : 0.3, depthWrite: false, side: THREE.DoubleSide, depthTest: false }));
    g.add(ring);
    if (kind === 'shout') {
      // An expanding pulse ring inside, animated in updateOverlay via userData.shout.
      const pulse = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide, depthTest: false, blending: THREE.AdditiveBlending }));
      pulse.userData.max = R;
      g.add(pulse);
    }
    g.position.copy(this.worldOf(at, 0.06));
    g.renderOrder = 5;
    g.userData = { monster, level: at.level, [kind]: true };
    this.breathMarks.add(g);
  }

  private refreshIntentVisibility(): void {
    for (const o of [...this.intentLines.children, ...this.breathMarks.children]) {
      const v = this.units.get(o.userData.monster as string);
      o.visible = !!v && v.root.visible && (o.userData.level ?? v.at.level) === this.shownLevel;
    }
  }

  /** Breath: every marked hex gets a pulsing fire warning (impossible to miss). */
  private markBreath(hexes: Pos[], monster: string): void {
    const fill = new THREE.MeshBasicMaterial({ color: 0xff4a10, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending });
    const edge = new THREE.MeshBasicMaterial({ color: 0xffc040, transparent: true, opacity: 0.95, depthWrite: false });
    for (const p of hexes) {
      const g = new THREE.Group();
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.86, 6).rotateX(-Math.PI / 2).rotateY(Math.PI / 6), fill);
      const ring = new THREE.Mesh(hexRing(0.74, 0.9), edge);
      const tongue = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 4), edge);
      tongue.position.y = 0.3;
      g.add(disc, ring, tongue);
      g.position.copy(this.worldOf(p, 0.04));
      g.userData = { monster, level: p.level, breath: true };
      g.renderOrder = 5;
      this.breathMarks.add(g);
    }
  }

  /** Sweep: a red ring around the monster's reach. */
  private markSweep(at: Pos, monster: string): void {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.0, 2.35, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: COLORS.danger, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }));
    g.add(ring);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.38, 3), new THREE.MeshBasicMaterial({ color: COLORS.danger, transparent: true, opacity: 0.85, depthWrite: false }));
      arrow.position.set(Math.sin(a) * 2.6, 0.05, Math.cos(a) * 2.6);
      arrow.rotation.set(Math.PI / 2, 0, -a);
      g.add(arrow);
    }
    g.position.copy(this.worldOf(at, 0.06));
    g.userData = { monster, level: at.level, sweep: true };
    this.breathMarks.add(g);
  }

  /** Shove intent: an arrow from the victim to where they'll land; red if that's a pit. */
  private markShove(mAt: Pos, victim: Pos | null, to: Pos, monster: string, color = 0xffa040): void {
    const pit = this.levels.get(to.level)?.pits.has(hexKey(to)) ?? false;
    const col = pit ? COLORS.danger : color;
    const from = victim && victim.level === to.level ? this.worldOf(victim, 0.35) : this.worldOf(mAt, 0.35);
    const end = this.worldOf(to, pit ? -0.1 : 0.35);
    if (pit) end.y = levelY(to.level) + FLOOR_TOP + 0.05;
    const dir = end.clone().sub(from);
    const len = dir.length();
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false });
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, Math.max(0.1, len - 0.35)), mat);
    shaft.position.z = (len - 0.35) / 2;
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.42, 3), mat);
    head.rotation.x = Math.PI / 2;
    head.position.z = len - 0.2;
    g.add(shaft, head);
    g.position.copy(from);
    g.lookAt(end);
    g.renderOrder = 7;
    g.userData = { monster, level: to.level };
    this.intentLines.add(g);
    const ring = new THREE.Mesh(hexRing(0.6, 0.86), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8, depthWrite: false }));
    ring.position.copy(this.worldOf(to, 0.04));
    ring.userData = { monster, level: to.level };
    this.intentLines.add(ring);
  }

  // ------------------------------------------------------------ V3.7: facing, blind arcs, move risks, fuses

  /**
   * 20.1: a facing wedge on the floor in front of every awake monster and crew member on the shown
   * level: a translucent eye-cone the way it looks plus a small arrow at the hex edge. Crew members
   * take their ring colour (stance); monsters a hot amber; feared figures a cold violet.
   */
  private refreshFacing(): void {
    const d = this.state?.delve;
    if (!d) {
      this.facingMarks.clear();
      this.facingKey = '';
      return;
    }
    const list = facedUnits(d).filter((u) => u.at.level === this.shownLevel);
    // V3.9 (24.5): heroes' wedges, smaller, in the hero's colour.
    const heroes = d.heroes.filter((h) => h.status === 'active' && h.at.level === this.shownLevel && facingOf(h) !== undefined);
    const key = `#${this.shownLevel}|${d.rivals?.stance ?? ''}|` + list.map((u) => `${u.id}:${u.facing}:${u.feared ? 'f' : ''}`).join('|') + '|H' + heroes.map((h) => `${h.heroId}:${h.facing}`).join('|');
    if (key === this.facingKey) return;
    this.facingKey = key;
    this.facingMarks.clear();
    for (const h of heroes) {
      const cls = this.state?.campaign.roster.find((r) => r.id === h.heroId)?.cls ?? '';
      const col = CLASS_COLORS[cls] ?? COLORS.parchment;
      const g = new THREE.Group();
      const R = Math.sqrt(3) * HEX * 1.0;
      const cone = new THREE.Mesh(new THREE.CircleGeometry(R, 12, -Math.PI / 3, (Math.PI * 2) / 3).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide }));
      cone.rotation.y = -Math.PI / 2;
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.32, 3), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.95, depthWrite: false }));
      arrow.rotation.x = Math.PI / 2;
      arrow.position.z = Math.sqrt(3) * HEX * 0.6;
      // V3.9 (owner: cones are clutter): the arrow only; the sector stays built but unused, for a quick revisit.
      void cone;
      g.add(arrow);
      g.rotation.y = facingAngle(facingOf(h)!);
      g.userData = { unit: h.heroId, level: h.at.level, hero: true };
      g.renderOrder = 2;
      this.facingMarks.add(g);
    }
    const st = d.rivals?.stance;
    for (const u of list) {
      const col = u.feared ? 0x9a6aff : u.crew ? (st === 'hired' ? 0x7fe07a : st === 'hostile' ? COLORS.danger : st === 'demanding' ? 0xffb35c : 0xb8ad98) : 0xffa040;
      const g = new THREE.Group();
      // The eye cone: a 120° sector, apex at the figure, reaching a hex and a half.
      const R = Math.sqrt(3) * HEX * 1.45;
      const cone = new THREE.Mesh(new THREE.CircleGeometry(R, 14, -Math.PI / 3, (Math.PI * 2) / 3).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }));
      // CircleGeometry's arc starts on +x; rotate so the sector's middle points down +z (our forward), then by the facing.
      cone.rotation.y = -Math.PI / 2;
      // V3.9 (owner: cones are clutter): the arrow only.
      void cone;
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.4, 3), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.95, depthWrite: false }));
      arrow.rotation.x = Math.PI / 2;
      arrow.position.z = Math.sqrt(3) * HEX * 0.62;
      g.add(arrow);
      g.rotation.y = facingAngle(u.facing);
      g.userData = { unit: u.id, level: u.at.level };
      g.renderOrder = 2;
      this.facingMarks.add(g);
    }
  }

  /** V3.9 (24.5): show the rear half of this enemy faintly (hover a seen awake enemy); null hides it. */
  showRearHalf(unitId: string | null): void {
    if (unitId === this.rearOf) return;
    this.rearOf = unitId;
    this.blindKey = '';
    this.refreshBlindArcs();
  }

  /** V3.9 (24.5): dagger markers on the hexes a selected Burglar could backstab from ([] hides them). */
  showBackstab(spots: { at: Pos; target: string }[]): void {
    const a = spots.map((x) => `${posKey(x.at)}>${x.target}`).join('|');
    const b = this.stabSpots.map((x) => `${posKey(x.at)}>${x.target}`).join('|');
    if (a === b) return;
    this.stabSpots = spots;
    this.blindKey = '';
    this.refreshBlindArcs();
  }

  /** V3.9: the facing a move or Face would leave, as a wedge on `at`; null hides it. */
  showFacing(at: Pos | null, facing?: number): void {
    if (!at || facing === undefined || at.level !== this.shownLevel) {
      this.facePreview.visible = false;
      return;
    }
    this.facePreview.visible = true;
    this.facePreview.position.copy(this.worldOf(at, 0.05));
    this.facePreview.rotation.y = facingAngle(facing);
  }

  private refreshBlindArcs(): void {
    const d = this.state?.delve;
    const lv = this.levels.get(this.shownLevel)?.def as LevelDef | undefined;
    const rear = d && this.rearOf ? facedUnits(d).find((u) => u.id === this.rearOf && u.at.level === this.shownLevel && this.vis.visible.has(posKey(u.at))) : undefined;
    const stabs = this.stabSpots.filter((x) => x.at.level === this.shownLevel);
    const key = `#${this.shownLevel}|${rear ? `${rear.id}:${posKey(rear.at)}:${rear.facing}` : ''}|` + stabs.map((x) => posKey(x.at)).join('|');
    if (key === this.blindKey) return;
    this.blindKey = key;
    this.blindFill.count = 0;
    this.blindMarks.clear();
    for (const t of this.blindTags) t.el.remove();
    this.blindTags = [];
    const m = new THREE.Matrix4();
    let n = 0;
    if (rear && lv) {
      for (const p of blindArc(lv, rear.at, rear.facing, 3).hexes) {
        if (n >= 600) break;
        m.makeTranslation(this.worldOf(p, 0.028));
        this.blindFill.setMatrixAt(n++, m);
      }
    }
    this.blindFill.count = n;
    this.blindFill.instanceMatrix.needsUpdate = true;
    stabs.forEach((x, i) => {
      const ring = new THREE.Mesh(hexRing(0.56, 0.76), new THREE.MeshBasicMaterial({ color: 0xcfe8d0, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }));
      ring.position.copy(this.worldOf(x.at, 0.045));
      ring.userData = { unit: x.target, phase: i * 0.7 };
      ring.renderOrder = 3;
      this.blindMarks.add(ring);
      const el = document.createElement('div');
      el.className = 'backstab-tag';
      el.textContent = '🗡';
      el.dataset.target = x.target;
      el.title = `Backstab from here: ${this.nameOf(x.target)} has not noticed the Burglar. A melee strike from behind it gets +1 slot and double damage per hit (before armor), on top of the sneak attack.`;
      this.fx.appendChild(el);
      this.blindTags.push({ el, at: this.worldOf(x.at, 0.35) });
    });
  }

  /**
   * 20.1, 20.2: what the hovered move risks: sleepers that may wake (yellow ring, the chance), awake
   * enemies that would notice the hero at the end (red eye), enemies that get a free swing (red sword
   * with the damage). Null clears.
   */
  showRisks(risks: MoveRisks | null): void {
    this.riskRings.clear();
    for (const el of this.riskTags.values()) el.remove();
    this.riskTags.clear();
    if (!risks) return;
    const mk = (id: string, cls: string, html: string, title: string, color: number) => {
      const v = this.units.get(id);
      const pos = v?.at;
      // 24.4: never mark an enemy the party can't see (the engine filters too).
      if (!v || !pos || pos.level !== this.shownLevel || !v.shown || !this.vis.visible.has(posKey(pos))) return;
      const ring = new THREE.Mesh(hexRing(0.6, 0.9), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, depthTest: false }));
      ring.position.copy(this.worldOf(pos, 0.05));
      ring.userData = { phase: Math.random() * 3 };
      ring.renderOrder = 8;
      this.riskRings.add(ring);
      if (this.riskTags.has(id)) return;
      const el = document.createElement('div');
      el.className = `risk ${cls}`;
      el.innerHTML = html;
      el.title = title;
      this.fx.appendChild(el);
      this.riskTags.set(id, el);
    };
    for (const w of risks.wake) mk(w.id, 'risk-wake', `<span class="risk-icon">☾</span><span class="risk-num">${Math.round(w.chance)}%</span>`, `${this.nameOf(w.id)} may wake as you pass (${Math.round(w.chance)}%).`, 0xffd040);
    for (const n of risks.notice) mk(n.id, 'risk-notice', '<span class="risk-icon">👁</span>', `${this.nameOf(n.id)} would notice you where this move ends.`, COLORS.danger);
    for (const sw of risks.swings) mk(sw.id, 'risk-swing', `<span class="risk-icon">⚔</span><span class="risk-num">${sw.damage[0]}–${sw.damage[1]}</span>`, `${this.nameOf(sw.id)} gets a free swing as you leave its reach: ${sw.damage[0]}–${sw.damage[1]} damage.`, COLORS.danger);
  }

  private nameOf(id: string): string {
    const d = this.state?.delve;
    return d?.monsters.find((m) => m.id === id)?.name ?? d?.rivals?.members.find((r) => r.id === id)?.name ?? this.state?.campaign.roster.find((h) => h.id === id)?.name ?? id;
  }

  /** 20.3: the fuses on the shown level: blast rings (inner red, outer orange) and a countdown tag; rival fuses in the enemy colour. */
  private refreshFuses(): void {
    const s = this.state;
    const d = s?.delve;
    const fuses = (d?.fuses ?? []).filter((f) => f.at.level === this.shownLevel && (this.vis.visible.has(posKey(f.at)) || this.vis.explored.has(posKey(f.at)) || s?.campaign.roster.some((h) => h.id === f.by)));
    const key = `#${this.shownLevel}|` + fuses.map((f) => `${posKey(f.at)}:${f.rounds}:${f.by}`).join('|');
    if (key === this.fuseKey) return;
    this.fuseKey = key;
    this.fuseMarks.clear();
    for (const t of this.fuseTags) t.el.remove();
    this.fuseTags = [];
    if (!fuses.length || !this.castle || !s) return;
    for (const f of fuses) {
      const side = fuseSide(s, f.by);
      const rings = blastRings(this.castle, f.at);
      const innerMat = new THREE.MeshBasicMaterial({ color: side === 'rival' ? 0xff3a30 : 0xff4a10, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending });
      const innerEdge = new THREE.MeshBasicMaterial({ color: side === 'rival' ? 0xff6a60 : 0xff8a40, transparent: true, opacity: 0.9, depthWrite: false });
      const outerMat = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.7, depthWrite: false });
      for (const p of rings.inner) {
        const g = new THREE.Group();
        const wall = this.levels.get(p.level)?.def.tiles[hexKey(p)]?.kind === 'wall';
        const lift = wall ? WALL_HEIGHT + 0.06 : 0.042;
        g.add(new THREE.Mesh(new THREE.CircleGeometry(0.86, 6).rotateX(-Math.PI / 2).rotateY(Math.PI / 6), innerMat), new THREE.Mesh(hexRing(0.74, 0.9), innerEdge));
        g.position.copy(this.worldOf(p, lift));
        g.userData = { level: p.level, inner: true };
        g.renderOrder = 5;
        this.fuseMarks.add(g);
      }
      for (const p of rings.outer) {
        const ring = new THREE.Mesh(hexRing(0.66, 0.78), outerMat);
        ring.position.copy(this.worldOf(p, 0.04));
        ring.userData = { level: p.level };
        ring.renderOrder = 5;
        this.fuseMarks.add(ring);
      }
      // The charge itself: a small keg with a spark (on top of the wall when it is set on one).
      const onWall = this.levels.get(f.at.level)?.def.tiles[hexKey(f.at)]?.kind === 'wall' ? WALL_HEIGHT : 0;
      const keg = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.3, 8), new THREE.MeshLambertMaterial({ color: 0x4a2a1a, flatShading: true }));
      keg.position.copy(this.worldOf(f.at, onWall + 0.15));
      keg.userData = { level: f.at.level };
      const spark = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffd060, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
      spark.scale.setScalar(0.7);
      spark.position.copy(this.worldOf(f.at, onWall + 0.48));
      spark.userData = { spark: true, phase: Math.random() * 6, level: f.at.level };
      this.fuseMarks.add(keg, spark);
      const el = document.createElement('div');
      el.className = `fuse-tag fuse-${side} ${f.rounds <= 1 ? 'soon' : ''}`;
      el.innerHTML = `<span class="fuse-icon">✹</span><span class="fuse-n">${f.rounds}</span>`;
      el.title = `Charge set by ${this.nameOf(f.by)} · ${f.rounds <= 1 ? 'goes off at the end of the coming castle turn' : `goes off in ${f.rounds} castle turns`}. 4 damage within 1 (everyone there pushed a hex away), 2 within 2; breaks walls within 1. ${side === 'hero' ? 'The setter takes nothing; other heroes take half.' : 'Get out of the rings.'}`;
      this.fx.appendChild(el);
      this.fuseTags.push({ el, at: this.worldOf(f.at, onWall + 1.1), level: f.at.level });
    }
  }

  /**
   * V3.9.3 (24.8): what the heroes heard during the last castle turn, on the shown level: footprints
   * on each heard hex (a trail, fading toward the oldest) and a pulsing ring with an icon for loud
   * sounds. Drawn over the fog, explored or not, and never the figure itself.
   */
  private refreshSounds(): void {
    const d = this.state?.delve;
    const list = (d?.heard ?? []).filter((x) => x.at.level === this.shownLevel);
    const key = `#${this.shownLevel}|` + list.map((x) => `${posKey(x.at)}:${x.kind}:${x.what ?? ''}:${x.n}`).join('|');
    if (key === this.soundKey) return;
    this.soundKey = key;
    this.soundMarks.clear();
    for (const t of this.soundTags) t.el.remove();
    this.soundTags = [];
    if (!list.length) return;
    const fade = heardFade(list);
    list.forEach((h, i) => {
      const loud = h.kind === 'loud';
      if (loud) {
        const ring = new THREE.Mesh(hexRing(0.6, 0.82), new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.8, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }));
        ring.position.copy(this.worldOf(h.at, 0.06));
        ring.userData = { level: h.at.level, phase: i * 0.37 };
        ring.renderOrder = 9;
        this.soundMarks.add(ring);
      }
      const el = document.createElement('div');
      el.className = `heard-tag heard-${h.kind}${loud ? ` heard-${h.what ?? 'loud'}` : ''}`;
      el.dataset.kind = h.kind;
      el.dataset.at = posKey(h.at);
      if (h.what) el.dataset.what = h.what;
      el.textContent = heardIcon(h);
      el.style.opacity = String(fade.get(h) ?? 1);
      el.title = heardTitle(h);
      this.fx.appendChild(el);
      this.soundTags.push({ el, at: this.worldOf(h.at, loud ? 0.5 : 0.08), level: h.at.level });
    });
  }

  /** 20.3: what the levels hide: blown cracked walls and dug rubble, but not blast-broken walls (they show as rubble until dug). */
  private blownForView(blown: string[]): Set<string> {
    if (!this.castle) return new Set(blown);
    const walls = blownWalls(this.castle, blown);
    return new Set(blown.filter((k) => !walls.has(k) || this.dugWalls.has(k)));
  }

  /** 20.3: rebuild a level with its blast-broken walls as rubble (walls are batched, so the level is remade). */
  private applyBrokenWalls(blown: string[], collapsed: string[] = this.state?.delve?.collapsed ?? []): void {
    if (!this.castle) return;
    const broken = blownWalls(this.castle, blown);
    for (const ld of this.castle.levels) {
      const mine = [...broken].filter((k) => k.startsWith(`${ld.level}:`)).sort();
      const fallen = collapsed.filter((k) => k.startsWith(`${ld.level}:`)).sort();
      const key = `${mine.join('|')}#${fallen.join('|')}`;
      if ((this.brokenKey.get(ld.level) ?? '#') === key) continue;
      this.brokenKey.set(ld.level, key);
      const old = this.levels.get(ld.level);
      if (old) this.scene.remove(old.group);
      for (const c of [...this.collapseDebris.children]) if (c.userData.level === ld.level) this.collapseDebris.remove(c);
      const tiles = { ...ld.tiles };
      for (const k of mine) {
        const hk = k.slice(k.indexOf(':') + 1);
        const t = tiles[hk];
        if (!t) continue;
        // Rubble takes the room of a floor neighbour so it is lit and tinted like the room it opens into.
        const h = parseHexKey(hk);
        const room = t.room ?? DIRS.map((dd) => tiles[hexKey(add(h, dd))]).find((n) => n && n.kind !== 'wall' && n.room)?.room;
        tiles[hk] = { kind: 'rubble', room };
      }
      // 20.3a: collapsed floor is a pit now (railings gone with it).
      for (const k of fallen) {
        const hk = k.slice(k.indexOf(':') + 1);
        const t = tiles[hk];
        if (!t) continue;
        tiles[hk] = { kind: 'pit', room: t.room };
      }
      // Ragged edge: broken slabs and stones on the floor round each collapsed hex, a few hanging over the drop.
      for (const k of fallen) {
        const p = parsePos(k);
        const stone = new THREE.MeshLambertMaterial({ color: 0x6e645a, flatShading: true });
        for (const dd of DIRS) {
          const n = add(p, dd);
          const nt = tiles[hexKey(n)];
          if (!nt || nt.kind === 'pit' || nt.kind === 'wall') continue;
          const a = this.worldOf({ level: p.level, ...n }, 0);
          const b = this.worldOf(p, 0);
          for (let i = 0; i < 2; i++) {
            const t = 0.3 + i * 0.22 + (hashStr(`${k}${dd.q}${dd.r}${i}`) % 10) / 60;
            const m = new THREE.Mesh(new THREE.BoxGeometry(0.16 + (i % 2) * 0.1, 0.07, 0.12), stone);
            m.position.lerpVectors(a, b, t);
            m.position.y = a.y + 0.03 - (t > 0.5 ? (t - 0.5) * 0.5 : 0);
            m.rotation.set((t - 0.5) * 0.8, hashStr(k + i) % 6, 0);
            m.userData.level = p.level;
            this.collapseDebris.add(m);
          }
        }
      }
      const def: LevelDef = { ...ld, tiles };
      const lv = new LevelView(def, this.castle);
      this.levels.set(ld.level, lv);
      this.scene.add(lv.group);
      lv.group.visible = old?.group.visible ?? ld.level === this.shownLevel;
      // Doors, braziers and the blown set are re-applied by the sync that follows; here the rubble shows at once.
      if (this.state?.delve) lv.setBlown(this.blownForView(this.state.delve.blown));
    }
    this.applyBelow();
  }

  /** 20.3: a blast: flash, shake, dust and debris flying out, the broken walls crumbling into rubble. */
  private async playBlast(ev: Extract<GameEvent, { type: 'blast' }>): Promise<void> {
    // The contract still carries the old `{ type: 'blast', at }` shape beside the V3.7 one.
    const e = { at: ev.at, by: 'by' in ev ? ev.by : '', broke: 'broke' in ev ? ev.broke : [], collapsed: 'collapsed' in ev ? (ev.collapsed ?? []) : [], rubbled: 'rubbled' in ev ? (ev.rubbled ?? []) : [] };
    const clock = this.clock;
    const watch = e.at.level === this.shownLevel;
    const at = this.worldOf(e.at, 0.6);
    this.flash(at, 0xffc070, 30);
    if (!this.reduceShake) this.rig.addShake(0.55);
    clock.hitStop(160);
    this.onExplosion?.();
    // The fuse is spent: drop its marker now.
    if (this.state?.delve?.fuses) this.state.delve.fuses = this.state.delve.fuses.filter((f) => !samePos(f.at, e.at));
    this.fuseKey = '';
    this.refreshFuses();
    const breakNow = () => {
      if (!(e.broke.length || e.collapsed.length || e.rubbled.length) || !this.state?.delve) return;
      const blown = this.state.delve.blown;
      const more = [...e.broke, ...e.rubbled].map((p) => posKey(p)).filter((k) => !blown.includes(k));
      if (more.length) this.state.delve.blown = [...blown, ...more];
      const col = this.state.delve.collapsed ?? [];
      const moreCol = e.collapsed.map((p) => posKey(p)).filter((k) => !col.includes(k));
      if (moreCol.length) this.state.delve.collapsed = [...col, ...moreCol];
      this.applyBrokenWalls(this.state.delve.blown, this.state.delve.collapsed ?? []);
      this.applyLitFog();
      this.levels.get(e.at.level)?.setBlown(this.blownForView(this.state.delve.blown));
      this.levels.get(e.at.level)?.applyFogLit(this.fogLit, this.fogUnlit, this.vis.explored);
    };
    if (!watch) {
      breakNow();
      return;
    }
    // Fire over the inner ring, a shock ring over the outer, then debris.
    if (this.castle) {
      const rings = blastRings(this.castle, e.at);
      void this.ringPulse(rings.inner, 0xff5a10);
      void this.ringPulse(rings.outer, 0xffa040);
    }
    this.dustPuff(this.worldOf(e.at, 0.1));
    const bits: { m: THREE.Mesh; v: THREE.Vector3; spin: THREE.Vector3 }[] = [];
    const group = new THREE.Group();
    const stone = new THREE.MeshLambertMaterial({ color: 0x8a8076, flatShading: true });
    const ember = new THREE.MeshBasicMaterial({ color: 0xff8a30 });
    for (const o of [e.at, ...e.broke, ...e.collapsed, ...e.rubbled]) {
      const base = this.worldOf(o, 0.3);
      const n = samePos(o, e.at) ? 14 : e.broke.some((b) => samePos(b, o)) ? 10 : 5;
      for (let i = 0; i < n; i++) {
        const sz = 0.08 + Math.random() * 0.14;
        const m = new THREE.Mesh(new THREE.BoxGeometry(sz, sz * 0.8, sz * 1.2), Math.random() < 0.3 ? ember : stone);
        m.position.copy(base);
        const a = Math.random() * Math.PI * 2;
        const sp = 2 + Math.random() * 4;
        bits.push({ m, v: new THREE.Vector3(Math.cos(a) * sp, 3 + Math.random() * 4, Math.sin(a) * sp), spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8) });
        group.add(m);
      }
    }
    this.overlay.add(group);
    for (const b of e.broke) this.dustPuff(this.worldOf(b, 0.2));
    const floorY = this.worldOf(e.at, 0.05).y;
    let last = 0;
    let broke = false;
    await clock.tween(0.9, (t) => {
      const time = t * 0.9;
      const dt = time - last;
      last = time;
      for (const b of bits) {
        b.v.y -= 14 * dt;
        b.m.position.addScaledVector(b.v, dt);
        if (b.m.position.y < floorY) {
          b.m.position.y = floorY;
          b.v.set(b.v.x * 0.4, Math.abs(b.v.y) * 0.3, b.v.z * 0.4);
        }
        b.m.rotation.x += b.spin.x * dt;
        b.m.rotation.y += b.spin.y * dt;
        b.m.rotation.z += b.spin.z * dt;
      }
      this.flash(at, 0xffb060, 30 * (1 - t));
      // The wall comes down a third of the way in.
      if (!broke && t > 0.3) {
        broke = true;
        breakNow();
      }
    });
    if (!broke) breakNow();
    this.overlay.remove(group);
    stone.dispose();
    ember.dispose();
    for (const b of e.broke) if (b.level === this.shownLevel) this.floatText(this.worldOf(b, 0.9), 'Wall broken', 'warn', 1.4);
    if (e.collapsed.length) {
      const c = e.collapsed[0]!;
      if (c.level === this.shownLevel) this.floatText(this.worldOf(c, 0.9), e.collapsed.length === 1 ? 'The floor drops away' : `${e.collapsed.length} hexes drop into the pit`, 'warn', 1.6);
      for (const p of e.collapsed) this.dustPuff(this.worldOf(p, 0.1));
    }
  }

  // ------------------------------------------------------------ edge risk and landing previews

  /** Red lips on the pit side of each given hero's hex. */
  showEdgeLips(at: Pos[]): void {
    this.lips.clear();
    for (const p of at) {
      const lv = this.levels.get(p.level);
      if (!lv) continue;
      for (let i = 0; i < 6; i++) {
        const n = add(p, DIRS[i]!);
        if (!lv.pits.has(hexKey(n))) continue;
        if (lv.def.tiles[hexKey(p)]?.railing) continue;
        const a = this.worldOf(p, 0.03);
        const b = this.worldOf({ level: p.level, ...n }, 0);
        const mid = a.clone().lerp(b, 0.47);
        const lip = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.08, 0.14), new THREE.MeshBasicMaterial({ color: COLORS.danger, transparent: true, opacity: 0.9, depthWrite: false }));
        lip.position.set(mid.x, a.y + 0.02, mid.z);
        lip.lookAt(b.x, a.y + 0.02, b.z);
        lip.userData.level = p.level;
        lip.renderOrder = 4;
        this.lips.add(lip);
      }
    }
    for (const l of this.lips.children) l.visible = l.userData.level === this.shownLevel;
  }

  /**
   * Show where something will land: a marker on the landing hex (maybe on a lower
   * level, seen through the pit), a dashed drop line, and a label. Null clears.
   */
  showLanding(from: Pos | null, to: Pos | null, text: string, danger: boolean): void {
    this.landing.clear();
    this.landingAt = null;
    this.landingTag.classList.add('hidden');
    if (!to) return;
    const col = danger ? COLORS.danger : 0x7fe0ff;
    const end = this.worldOf(to, 0.05);
    const mark = new THREE.Group();
    const ring = new THREE.Mesh(hexRing(0.5, 0.9), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false }));
    const x1 = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.03, 0.12), ring.material);
    const x2 = x1.clone();
    x1.rotation.y = Math.PI / 4;
    x2.rotation.y = -Math.PI / 4;
    mark.add(ring, x1, x2);
    mark.position.copy(end);
    mark.renderOrder = 9;
    this.landing.add(mark);
    if (from) {
      const top = this.worldOf(from, 0.1);
      const pts = [top, new THREE.Vector3(end.x, top.y, end.z), end];
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      const lineMat = new THREE.LineDashedMaterial({ color: col, dashSize: 0.25, gapSize: 0.15, transparent: true, opacity: 0.9, depthTest: false });
      const ln = new THREE.Line(g, lineMat);
      ln.computeLineDistances();
      ln.renderOrder = 9;
      this.landing.add(ln);
    }
    // Label at the jump-off hex when there is one (a deep landing may be off screen).
    this.landingAt = (from && from.level === this.shownLevel ? this.worldOf(from, 0.2) : end).clone().add(new THREE.Vector3(0, 0.6, 0));
    this.landingTag.textContent = text;
    this.landingTag.classList.toggle('danger', danger);
    this.landingTag.classList.toggle('hidden', !text);
  }

  // ------------------------------------------------------------ playback

  /** Before playing a batch: show units from the next state too, and widen sight to what either state saw. */
  beginPlayback(next: GameState, nextVis: Visibility): void {
    this.extraVisible = nextVis.visible;
    this.nextState = next;
    this.showRisks(null);
    const d = next.delve;
    if (d) {
      for (const m of d.monsters) {
        if (m.hp <= 0 || m.buried || this.units.has(m.id)) continue;
        const v = this.ensureUnit(m.id, this.modelFor(m.kind, m.awareness), 'monster', m.spawnedAt ?? m.at, m.name);
        v.root.position.copy(this.worldOf(m.at));
        v.at = { ...m.at };
        v.setOpacity(0);
        if (m.kind === 'ghoul') {
          // 16.4: ghouls rise from the ground on their `spawned` event (see playEvent).
          v.root.userData.rise = true;
          continue;
        }
        v.busy++;
        void this.clock.tween(0.4, (t) => v.setOpacity(t)).then(() => v.busy--);
      }
      if (d.rivals)
        for (const r of d.rivals.members) {
          if (r.goneOut || r.hp <= 0 || d.round < d.rivals.entersRound || this.units.has(r.id)) continue;
          const v = this.ensureUnit(r.id, this.rivalModel(r), 'rival', r.at, r.name);
          v.at = { ...r.at };
        }
    }
    this.clearIntents();
    this.refreshUnits();
  }

  endPlayback(): void {
    this.extraVisible = null;
    this.nextState = null;
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

  /** Can any hero see this hex, in the current or the incoming state (level independent)? */
  canSee(p: Pos | null | undefined): boolean {
    if (!p) return false;
    const k = posKey(p);
    return this.vis.visible.has(k) || !!this.extraVisible?.has(k);
  }

  /**
   * 15.5: move the camera to an event on any level and hold a beat (scaled by the clock speed).
   * Skips the pan when already looking close by.
   */
  async panTo(p: Pos, hold = 0.35): Promise<void> {
    const w = this.worldOf(p);
    const cur = this.rig.currentTarget();
    const near = p.level === this.shownLevel && Math.hypot(cur.x - w.x, cur.z - w.z) < 2.5;
    if (p.level !== this.shownLevel) this.showLevel(p.level);
    this.lookAt(p);
    if (!near) await this.clock.wait(hold);
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
        // 20.4: a crew member hauling a downed hero drags the figure along behind.
        const dragId = v.side === 'rival' ? (this.nextState?.delve?.rivals?.members.find((r) => r.id === v.id)?.dragging ?? this.state?.delve?.rivals?.members.find((r) => r.id === v.id)?.dragging) : undefined;
        const dragged = dragId ? this.units.get(dragId) : undefined;
        if (dragged) {
          dragged.busy++;
          dragged.lieDown(true);
          this.floatText(dragged.root.position.clone().add(new THREE.Vector3(0, 1.2, 0)), 'Dragged!', 'warn', 1.2);
        }
        let prev = v.root.position.clone();
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
          const dFrom = dragged?.root.position.clone();
          await clock.tween(0.14, (t) => {
            const k = easeInOut(t);
            v.root.position.lerpVectors(from, to, k);
            v.root.position.y = from.y + (to.y - from.y) * k;
            if (dragged && dFrom) {
              // The hauled hero trails one hex behind, bumping along the floor.
              dragged.root.position.lerpVectors(dFrom, prev, k);
              dragged.root.position.y += Math.abs(Math.sin(t * Math.PI * 2)) * 0.05;
            }
          });
          if (dragged) {
            dragged.at = { ...v.at };
            dragged.root.position.copy(prev);
          }
          prev = to.clone();
          v.at = { ...step };
          this.refreshUnits();
          this.onStep?.(v.side);
        }
        if (dragged) {
          const where = this.nextState?.delve?.heroes.find((h) => h.heroId === dragged.id)?.at;
          if (where) {
            dragged.at = { ...where };
            dragged.root.position.copy(this.worldOf(where));
          }
          dragged.busy--;
          this.refreshUnits();
        }
        this.moving.delete(v.id);
        v.busy--;
        this.refreshIntentVisibility();
        this.facingKey = '';
        this.refreshFacing();
        return;
      }
      case 'faced': {
        // V3.9 (24.2): a hero (or anyone) turns; the wedge follows.
        const v = this.units.get(e.id);
        const d = this.state?.delve;
        const h = d?.heroes.find((x) => x.heroId === e.id);
        if (h) h.facing = e.facing;
        const n = this.nextState?.delve?.heroes.find((x) => x.heroId === e.id);
        if (n) n.facing = e.facing;
        if (v) {
          const a = facingAngle(e.facing);
          v.face(Math.sin(a), Math.cos(a));
        }
        this.facingKey = '';
        this.refreshFacing();
        return;
      }
      case 'unseenHit': {
        await this.playUnseenHit(e.target);
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
      case 'blast':
        await this.playBlast(e);
        return;
      case 'fuseSet': {
        // 20.3: the charge is set: the rings appear at once, the fuse tag counts from `rounds`.
        if (this.state?.delve) {
          const list = (this.state.delve.fuses ?? []).filter((f) => !samePos(f.at, e.at));
          this.state.delve.fuses = [...list, { at: e.at, rounds: e.rounds, by: e.by }];
        }
        this.fuseKey = '';
        this.refreshFuses();
        if (e.at.level !== this.shownLevel) return;
        const by = this.units.get(e.by);
        if (by) {
          const w = this.worldOf(e.at);
          by.face(w.x - by.root.position.x, w.z - by.root.position.z);
        }
        this.flash(this.worldOf(e.at, 0.5), 0xffd060, 2);
        this.floatText(this.worldOf(e.at, 0.9), `Fuse ${e.rounds}`, 'warn', 1.3);
        if (this.castle) await this.ringPulse(blastRings(this.castle, e.at).inner, 0xff6a20);
        return;
      }
      case 'swing': {
        // 20.2: a free swing: the attacker turns and a "Free swing" label pops; the strike itself
        // (lunge, damage or miss) comes with the roll/hit/miss events the engine sends around it.
        const a = this.units.get(e.by);
        const t = this.units.get(e.target);
        if (!t || !((a?.root.visible ?? false) || t.root.visible)) return;
        if (a && a.id !== t.id) a.face(t.root.position.x - a.root.position.x, t.root.position.z - a.root.position.z);
        this.floatText((a ?? t).root.position.clone().add(new THREE.Vector3(0, (a ?? t).height + 0.55, 0)), 'Free swing', 'warn', 1.0);
        await clock.wait(0.1);
        return;
      }
      case 'feared': {
        const v = this.units.get(e.id);
        if (!v) return;
        const m = this.state?.delve?.monsters.find((x) => x.id === e.id) ?? this.state?.delve?.rivals?.members.find((x) => x.id === e.id);
        if (m) {
          m.feared = Math.max(m.feared ?? 0, 1);
          m.fearOf = e.by;
        }
        this.facingKey = '';
        this.refreshFacing();
        if (!v.root.visible) return;
        v.flash(new THREE.Color(0.35, 0.1, 0.6), 0.8);
        this.floatText(v.root.position.clone().add(new THREE.Vector3(0, v.height + 0.3, 0)), 'Feared!', 'warn', 1.5);
        // A shiver: the figure shrinks back and quakes.
        const by = this.units.get(e.by);
        if (by) {
          const dir = v.root.position.clone().sub(by.root.position);
          v.face(-dir.x, -dir.z);
        }
        await clock.tween(0.35, (t) => {
          v.rig.position.x = Math.sin(t * 40) * 0.05 * (1 - t);
          v.fig.scale.setScalar(v.scale * (1 - Math.sin(t * Math.PI) * 0.12));
        });
        v.rig.position.set(0, 0, 0);
        v.fig.scale.setScalar(v.scale);
        v.flash(new THREE.Color(0, 0, 0), 0);
        return;
      }
      case 'noticed': {
        const v = this.units.get(e.by);
        const hero = this.units.get(e.hero);
        if (!v || !v.root.visible) return;
        if (hero) v.face(hero.root.position.x - v.root.position.x, hero.root.position.z - v.root.position.z);
        this.facingKey = '';
        this.refreshFacing();
        this.floatText(v.root.position.clone().add(new THREE.Vector3(0, v.height + 0.3, 0)), '👁 Noticed!', 'warn', 1.3);
        await clock.wait(0.15);
        return;
      }
      case 'woke': {
        const v = this.units.get(e.id);
        if (!v || !v.root.visible) return;
        const hero = this.units.get(e.by);
        if (hero) v.face(hero.root.position.x - v.root.position.x, hero.root.position.z - v.root.position.z);
        this.floatText(v.root.position.clone().add(new THREE.Vector3(0, v.height + 0.3, 0)), '! Awake', 'warn', 1.2);
        await clock.tween(0.25, (t) => (v.fig.position.y = Math.sin(t * Math.PI) * 0.15));
        v.fig.position.y = 0;
        return;
      }
      case 'propSmashed':
        await this.playSmash(e);
        return;
      case 'rooted': {
        const v = this.units.get(e.id);
        if (!v || !v.root.visible) return;
        const by = this.units.get(e.by);
        if (by) by.face(v.root.position.x - by.root.position.x, v.root.position.z - by.root.position.z);
        // Thorny tendrils: a ring of small green spikes rising round the feet.
        const g = new THREE.Group();
        const mat = new THREE.MeshBasicMaterial({ color: 0x6aa84a, transparent: true, opacity: 0.9, depthWrite: false });
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const spike = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.4, 4), mat);
          spike.position.set(Math.cos(a) * 0.5, 0.2, Math.sin(a) * 0.5);
          spike.rotation.set(Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4);
          g.add(spike);
        }
        g.position.copy(v.root.position);
        this.overlay.add(g);
        this.floatText(v.root.position.clone().add(new THREE.Vector3(0, v.height + 0.3, 0)), `Rooted · ${e.rounds}`, 'warn', 1.4);
        await clock.tween(0.5, (t) => {
          g.scale.y = Math.min(1, t * 3);
          mat.opacity = 0.9 * (1 - Math.max(0, t - 0.6) / 0.4);
        });
        this.overlay.remove(g);
        mat.dispose();
        return;
      }
      case 'braced': {
        const v = this.units.get(e.id);
        if (!v || !v.root.visible) return;
        this.floatText(v.root.position.clone().add(new THREE.Vector3(0, v.height + 0.3, 0)), '⛨ Braced', 'info', 1.2);
        await clock.tween(0.25, (t) => {
          const k = Math.sin(t * Math.PI);
          v.fig.scale.set(v.scale * (1 + k * 0.08), v.scale * (1 - k * 0.08), v.scale * (1 + k * 0.08));
        });
        v.fig.scale.setScalar(v.scale);
        return;
      }
      case 'robbed': {
        const v = this.units.get(e.hero);
        if (!v) return;
        const by = this.units.get(e.by);
        if (by) await this.lunge(by, v);
        this.floatText(v.root.position.clone().add(new THREE.Vector3(0, v.height + 0.3, 0)), `Robbed: ${itemsText(e.items)}`, 'warn', 1.6);
        await clock.wait(0.2);
        return;
      }
      case 'captured': {
        // 20.4: dragged out of the castle: the hero fades at the exit.
        const v = this.units.get(e.hero);
        if (!v) return;
        v.busy++;
        if (v.root.visible) {
          this.floatText(v.root.position.clone().add(new THREE.Vector3(0, v.height + 0.6, 0)), 'Taken!', 'warn', 2);
          if (!this.reduceShake) this.rig.addShake(0.12);
          await clock.tween(0.5, (t) => v.setOpacity(1 - t));
        }
        v.busy--;
        this.removeUnit(e.hero);
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
      case 'spawned': {
        const v = this.units.get(e.id);
        if (!v) return;
        if (v.root.userData.rise) {
          // 16.4: a ghoul claws its way up out of the ground.
          delete v.root.userData.rise;
          v.at = { ...e.at };
          const rest = this.worldOf(e.at);
          v.root.position.copy(rest);
          this.refreshUnits();
          if (!v.root.visible) {
            v.setOpacity(1);
            return;
          }
          v.busy++;
          const depth = v.height * 0.95;
          this.dustPuff(rest);
          this.floatText(rest.clone().add(new THREE.Vector3(0, v.height + 0.6, 0)), 'Something rises', 'warn', 1.4);
          if (!this.reduceShake) this.rig.addShake(0.12);
          await clock.tween(0.55, (t) => {
            const k = easeOutCubic(t);
            v.setOpacity(Math.min(1, t * 3));
            v.root.position.y = rest.y - depth * (1 - k);
            v.fig.rotation.x = Math.sin(t * Math.PI) * 0.35;
          });
          v.fig.rotation.x = 0;
          v.root.position.y = rest.y;
          this.dustPuff(rest);
          v.busy--;
          return;
        }
        if (e.at.level === this.shownLevel) await clock.wait(0.25);
        return;
      }
      case 'gloam': {
        if (e.at.level === this.shownLevel) {
          this.floatText(this.worldOf(e.at, 1.4), 'The dark here is awake', 'warn', 2);
          if (!this.reduceShake) this.rig.addShake(0.1);
          await clock.wait(0.35);
        }
        return;
      }
      case 'shout': {
        const v = this.units.get(e.id);
        if (!v || !v.root.visible) return;
        this.floatText(v.root.position.clone().add(new THREE.Vector3(0, v.height + 0.3, 0)), 'RALLY!', 'warn', 1.3);
        this.flash(v.root.position.clone().add(new THREE.Vector3(0, v.height, 0)), 0xffa040, 2.5);
        if (!this.reduceShake) this.rig.addShake(0.12);
        // One big ring racing out to radius 8.
        const R = 8 * Math.sqrt(3) * HEX;
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.05, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.8, depthWrite: false, depthTest: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
        ring.position.copy(v.root.position).add(new THREE.Vector3(0, 0.06, 0));
        ring.renderOrder = 7;
        this.overlay.add(ring);
        await clock.tween(0.6, (t) => {
          ring.scale.setScalar(Math.max(0.01, R * easeOutCubic(t)));
          (ring.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - t);
        });
        this.overlay.remove(ring);
        return;
      }
      case 'dragged': {
        // 16.4: the webbed hero is hauled one hex toward the spider on a strand of web.
        // 20.4: a crew member hauling a downed hero: same pull, no strand, lying down.
        const v = this.units.get(e.id);
        if (!v) return;
        const crewDrag = !!(this.nextState ?? this.state)?.delve?.rivals?.members.some((r) => r.dragging === e.id);
        if (crewDrag) {
          const to2 = this.worldOf(e.to);
          if (!(v.root.visible || e.from.level === this.shownLevel)) {
            v.at = { ...e.to };
            v.root.position.copy(to2);
            return;
          }
          v.busy++;
          v.lieDown(true);
          const from2 = v.root.position.clone();
          this.floatText(from2.clone().add(new THREE.Vector3(0, 1.2, 0)), 'Dragged!', 'warn', 1.2);
          await clock.tween(0.3, (t) => {
            v.root.position.lerpVectors(from2, to2, easeInOut(t));
            v.root.position.y += Math.abs(Math.sin(t * Math.PI * 2)) * 0.05;
          });
          v.at = { ...e.to };
          v.busy--;
          return;
        }
        const to = this.worldOf(e.to);
        const watch = v.root.visible || e.from.level === this.shownLevel;
        if (this.levels.get(e.to.level)?.pits.has(hexKey(e.to))) to.y = levelY(e.to.level) + FLOOR_TOP;
        if (!watch) {
          v.at = { ...e.to };
          v.root.position.copy(to);
          return;
        }
        v.busy++;
        const from = v.root.position.clone();
        const dir = to.clone().sub(from).setY(0).normalize();
        const strandEnd = to.clone().add(dir.clone().multiplyScalar(Math.sqrt(3) * HEX * 1.4)).add(new THREE.Vector3(0, 0.9, 0));
        const strand = new THREE.Line(new THREE.BufferGeometry().setFromPoints([from.clone().add(new THREE.Vector3(0, v.height * 0.5, 0)), strandEnd]), new THREE.LineBasicMaterial({ color: 0xe8e8f0, transparent: true, opacity: 0.9, depthTest: false }));
        strand.renderOrder = 7;
        this.overlay.add(strand);
        v.face(dir.x, dir.z);
        v.flash(new THREE.Color(0.8, 0.8, 0.9), 0.4);
        this.floatText(from.clone().add(new THREE.Vector3(0, v.height + 0.2, 0)), 'Dragged!', 'warn', 1.2);
        await clock.tween(0.38, (t) => {
          const k = easeInOut(t);
          v.root.position.lerpVectors(from, to, k);
          v.fig.rotation.x = -Math.sin(t * Math.PI) * 0.35;
          (strand.geometry as THREE.BufferGeometry).setFromPoints([v.root.position.clone().add(new THREE.Vector3(0, v.height * 0.5, 0)), strandEnd]);
        });
        v.fig.rotation.x = 0;
        v.flash(new THREE.Color(0, 0, 0), 0);
        v.at = { ...e.to };
        this.overlay.remove(strand);
        strand.geometry.dispose();
        v.busy--;
        if (!this.reduceShake) this.rig.addShake(0.06);
        return;
      }
      case 'grabbed': {
        const v = this.units.get(e.id);
        const g = this.units.get(e.by);
        if (!v || !v.root.visible) return;
        if (g) await this.lunge(g, v);
        v.flash(new THREE.Color(0.6, 1, 0.5), 0.5);
        this.floatText(v.root.position.clone().add(new THREE.Vector3(0, v.height + 0.2, 0)), '⛓ Grabbed!', 'warn', 1.5);
        if (!this.reduceShake) this.rig.addShake(0.1);
        await clock.wait(0.25);
        v.flash(new THREE.Color(0, 0, 0), 0);
        return;
      }
      case 'released': {
        const v = this.units.get(e.id);
        if (!v || !v.root.visible) return;
        this.floatText(v.root.position.clone().add(new THREE.Vector3(0, v.height + 0.2, 0)), 'Free', 'heal', 1.2);
        await this.recoil(v);
        return;
      }
      case 'shutter': {
        this.lanternOpen = e.open;
        const b = this.lanternBearer ? this.units.get(this.lanternBearer) : undefined;
        if (b && b.root.visible) {
          this.floatText(b.root.position.clone().add(new THREE.Vector3(0, b.height + 0.3, 0)), e.open ? 'Lantern open' : 'Lantern shuttered', 'info', 1.2);
          if (e.open) this.flash(b.root.position.clone().add(new THREE.Vector3(0, b.height, 0)), 0xffb862, 4);
        }
        if (this.state?.delve) this.state.delve.lanternOpen = e.open;
        for (const h of this.state?.delve?.heroes ?? []) if (h.heroId === this.lanternBearer) this.setTag(h.heroId, heroTag(h, this.state!.campaign.roster.find((r) => r.id === h.heroId)?.maxHp ?? 10, true, e.open));
        await clock.wait(0.2);
        return;
      }
      case 'routeKnown': {
        // 16.1: the route lights up once, then stays as the faint dotted loop.
        if (!e.route.length || e.route[0]!.level !== this.shownLevel) return;
        if (this.state?.delve && !this.state.delve.knownRoutes.includes(e.id)) this.state.delve.knownRoutes = [...this.state.delve.knownRoutes, e.id];
        const m = this.state?.delve?.monsters.find((x) => x.id === e.id);
        if (m && !m.route) m.route = e.route;
        this.routesKey = '';
        this.refreshRoutes();
        const v = this.units.get(e.id);
        if (v && v.root.visible) this.floatText(v.root.position.clone().add(new THREE.Vector3(0, v.height + 0.3, 0)), 'Patrol route known', 'info', 1.6);
        await this.ringPulse(e.route, 0xe0b078);
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
      case 'shoved': {
        const v = this.units.get(e.id);
        if (!v) return;
        const watch = v.root.visible || e.from.level === this.shownLevel;
        const to = this.worldOf(e.to);
        if (this.levels.get(e.to.level)?.pits.has(hexKey(e.to))) to.y = levelY(e.to.level) + FLOOR_TOP;
        if (!watch) {
          v.at = { ...e.to };
          v.root.position.copy(to);
          return;
        }
        v.busy++;
        const from = v.root.position.clone();
        v.flash(new THREE.Color(1, 0.5, 0.1), 0.5);
        await clock.tween(0.22, (t) => {
          const k = easeOutCubic(t);
          v.root.position.lerpVectors(from, to, k);
          v.root.position.y += Math.sin(t * Math.PI) * 0.25;
        });
        v.flash(new THREE.Color(0, 0, 0), 0);
        v.at = { ...e.to };
        v.busy--;
        if (!this.reduceShake) this.rig.addShake(0.08);
        return;
      }
      case 'fell': {
        const v = this.units.get(e.id);
        const watchHero = !!v && v.side === 'hero';
        const follow = !!v && (v.id === this.selectedId || (watchHero && e.from.level === this.shownLevel));
        if (!v) return;
        v.busy++;
        // Step out over the pit if not already there.
        const over = this.worldOf(e.from);
        over.y = levelY(e.from.level) + FLOOR_TOP;
        if (v.root.position.distanceTo(over) > 0.05) {
          const a = v.root.position.clone();
          await clock.tween(0.14, (t) => v.root.position.lerpVectors(a, over, easeOutCubic(t)));
        }
        const start = v.root.position.clone();
        const land = this.worldOf(e.to);
        v.root.visible = v.root.visible || follow;
        if (follow && e.to.level !== this.shownLevel) {
          // Keep the faller on screen: draw the levels between as we go.
          this.rig.focus(new THREE.Vector3(start.x, start.y, start.z));
        }
        const dur = 0.35 + e.levels * 0.18;
        let switched = false;
        await clock.tween(dur, (t) => {
          const k = t * t;
          v.root.position.set(start.x + (land.x - start.x) * k, start.y + (land.y - start.y) * k, start.z + (land.z - start.z) * k);
          v.fig.rotation.x = Math.sin(t * Math.PI * 1.5) * 0.4;
          if (follow) {
            this.rig.focus(new THREE.Vector3(v.root.position.x, v.root.position.y, v.root.position.z));
            if (!switched && t > 0.55 && e.to.level !== this.shownLevel) {
              switched = true;
              this.showLevel(e.to.level);
            }
          }
        });
        v.fig.rotation.x = 0;
        v.at = { ...e.to };
        if (follow && !switched && e.to.level !== this.shownLevel) this.showLevel(e.to.level);
        this.refreshUnits();
        if (follow) v.root.visible = true;
        // Impact.
        this.flash(land.clone().add(new THREE.Vector3(0, 0.5, 0)), 0xffd0a0, 4 + e.levels * 2);
        if (!this.reduceShake && (follow || v.root.visible)) this.rig.addShake(0.25 + e.levels * 0.15);
        clock.hitStop(120);
        this.onImpact?.(e.levels);
        if (v.root.visible) {
          this.floatText(land.clone().add(new THREE.Vector3(0, v.height + 0.3, 0)), `−${e.damage}`, 'damage', 1.4);
          this.dustPuff(land);
          v.flash(new THREE.Color(1, 0.15, 0.1), 0.9);
          await clock.tween(0.18, (t) => v.fig.scale.set(v.scale * (1 + Math.sin(t * Math.PI) * 0.18), v.scale * (1 - Math.sin(t * Math.PI) * 0.25), v.scale * (1 + Math.sin(t * Math.PI) * 0.18)));
          v.fig.scale.setScalar(v.scale);
          v.flash(new THREE.Color(0, 0, 0), 0);
        }
        v.busy--;
        return;
      }
      case 'breath': {
        const src = this.units.get(e.by);
        if (!e.hexes.length) return;
        const lvl = e.hexes[0]!.level;
        if (lvl !== this.shownLevel && !(src && src.root.visible)) return;
        const from = src ? src.root.position.clone().add(new THREE.Vector3(0, src.height * 0.85, 0)) : this.worldOf(e.hexes[0]!, 1);
        if (src && e.hexes[0]) {
          const tgt = this.worldOf(e.hexes[e.hexes.length - 1]!);
          src.face(tgt.x - src.root.position.x, tgt.z - src.root.position.z);
        }
        this.onBreath?.();
        await this.fireJet(from, e.hexes);
        return;
      }
      case 'liftWorking': {
        this.liftWorking = true;
        this.drumSpin = 2.2;
        const lv = [...this.levels.values()].find((l) => l.drums.length);
        if (lv && lv.level === this.shownLevel) {
          const d = lv.drums[0]!;
          const p = new THREE.Vector3();
          d.getWorldPosition(p);
          this.floatText(p.clone().add(new THREE.Vector3(0, 1.2, 0)), 'The lift runs', 'info', 1.8);
        }
        this.onLift?.();
        await clock.wait(0.6);
        return;
      }
      case 'thrown': {
        const a = this.worldOf(e.from, 1.3);
        const b = this.worldOf(e.to, 0.2);
        const watch = e.from.level === this.shownLevel && (this.canSee(e.from) || this.canSee(e.to));
        if (!watch) return;
        const by = this.units.get(e.by);
        if (by) by.face(b.x - a.x, b.z - a.z);
        const color = THROW_COLOR[e.kind] ?? 0xd8d0c0;
        const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.09, 0), new THREE.MeshBasicMaterial({ color }));
        this.overlay.add(m);
        const dist = a.distanceTo(b);
        await clock.tween(0.18 + dist * 0.035, (t) => {
          m.position.lerpVectors(a, b, t);
          m.position.y += Math.sin(t * Math.PI) * (0.4 + dist * 0.12);
          m.rotation.set(t * 9, t * 7, 0);
        });
        this.overlay.remove(m);
        m.geometry.dispose();
        if (e.kind === 'smoke' || e.kind === 'glue') this.dustPuff(b);
        if (e.kind === 'firecracker') this.flash(b.clone().add(new THREE.Vector3(0, 0.4, 0)), 0xffe080, 3);
        return;
      }
      case 'cast': {
        const by = this.units.get(e.by);
        const at = e.at ?? (e.targetId ? this.units.get(e.targetId)?.at : undefined);
        const watch = (by?.root.visible ?? false) || (at ? this.canSee(at) && at.level === this.shownLevel : false);
        if (!watch) return;
        const color = SPELL_COLOR[e.spell] ?? 0xb48cff;
        if (by && at) {
          const w = this.worldOf(at);
          by.face(w.x - by.root.position.x, w.z - by.root.position.z);
        }
        if (by) {
          by.flash(new THREE.Color(color), 0.6);
          this.flash(by.root.position.clone().add(new THREE.Vector3(0, by.height, 0)), color, 1.5);
        }
        const label = SPELL_LABEL[e.spell];
        if (label && by) this.floatText(by.root.position.clone().add(new THREE.Vector3(0, by.height + 0.3, 0)), label, 'info', 1.2);
        // 20.2: Dread: a dark ripple rolls out from the caster to the target, no bolt.
        if (e.spell === 'dread') {
          await this.darkRipple(by ? by.root.position.clone() : at ? this.worldOf(at) : null, at ? this.worldOf(at) : null);
          if (by) by.flash(new THREE.Color(0, 0, 0), 0);
          return;
        }
        // A bolt to the target for ranged spells and shots.
        if (by && at && !samePos(by.at, at) && e.spell !== 'blink') {
          const from = by.root.position.clone().add(new THREE.Vector3(0, by.height * 0.7, 0));
          const to = this.worldOf(at, 0.5);
          const bolt = new THREE.Mesh(new THREE.SphereGeometry(e.spell === 'fireball' ? 0.2 : 0.1, 8, 6), new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
          this.overlay.add(bolt);
          await clock.tween(0.12 + from.distanceTo(to) * 0.025, (t) => {
            bolt.position.lerpVectors(from, to, t);
            if (e.spell === 'fireball') bolt.position.y += Math.sin(t * Math.PI) * 0.8;
          });
          this.overlay.remove(bolt);
          bolt.geometry.dispose();
        }
        if (e.hexes?.length) {
          const c = e.hexes.reduce((acc, p) => acc.add(this.worldOf(p, 0.4)), new THREE.Vector3()).multiplyScalar(1 / e.hexes.length);
          this.flash(c, color, e.spell === 'fireball' ? 6 : 3);
          if (e.spell === 'fireball' && !this.reduceShake) this.rig.addShake(0.2);
          if (e.spell === 'fireball' || e.spell === 'gust') this.onSpellBurst?.(e.spell);
          await this.ringPulse(e.hexes, color);
        } else if (at) {
          this.flash(this.worldOf(at, 0.6), color, 2.5);
        }
        if (by) by.flash(new THREE.Color(0, 0, 0), 0);
        return;
      }
      case 'blinked': {
        const v = this.units.get(e.id);
        if (!v) return;
        const watch = v.root.visible || this.canSee(e.to);
        const to = this.worldOf(e.to);
        if (!watch) {
          v.at = { ...e.to };
          v.root.position.copy(to);
          this.refreshUnits();
          return;
        }
        v.busy++;
        this.flash(v.root.position.clone().add(new THREE.Vector3(0, 0.5, 0)), 0x9a6aff, 3);
        await clock.tween(0.15, (t) => {
          v.setOpacity(1 - t);
          v.fig.scale.set(v.scale * (1 - t * 0.6), v.scale * (1 + t * 0.6), v.scale * (1 - t * 0.6));
        });
        v.root.position.copy(to);
        v.at = { ...e.to };
        if (v.side === 'hero' && v.id === this.selectedId) this.lookAt(e.to);
        this.refreshUnits();
        this.flash(to.clone().add(new THREE.Vector3(0, 0.5, 0)), 0x9a6aff, 3);
        await clock.tween(0.18, (t) => {
          v.setOpacity(t);
          v.fig.scale.set(v.scale * (0.4 + t * 0.6), v.scale * (1.6 - t * 0.6), v.scale * (0.4 + t * 0.6));
        });
        v.fig.scale.setScalar(v.scale);
        v.setOpacity(1);
        v.busy--;
        return;
      }
      case 'dug': {
        const lv = this.levels.get(e.at.level);
        this.dugWalls.add(posKey(e.at));
        if (lv && this.state?.delve) lv.setBlown(new Set([...this.blownForView(this.state.delve.blown), posKey(e.at)]));
        if (e.at.level === this.shownLevel) {
          const w = this.worldOf(e.at, 0.2);
          this.dustPuff(w);
          if (!this.reduceShake) this.rig.addShake(0.08);
          await clock.wait(0.2);
        }
        return;
      }
      case 'caltrops': {
        const v = this.units.get(e.id);
        if (e.at.level !== this.shownLevel || !this.canSee(e.at)) return;
        this.floatText(this.worldOf(e.at, 1), 'Caltrops! −2', 'damage', 1.3);
        if (v) {
          v.flash(new THREE.Color(1, 0.2, 0.1), 0.9);
          await clock.wait(0.2);
          v.flash(new THREE.Color(0, 0, 0), 0);
        }
        return;
      }
      default:
        return;
    }
  }

  /** Expanding hex rings over an area (fireball, gust, smoke, glue). */
  private async ringPulse(hexes: Pos[], color: number): Promise<void> {
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending });
    for (const p of hexes) {
      if (p.level !== this.shownLevel) continue;
      const m = new THREE.Mesh(hexRing(0.4, 0.86), mat);
      m.position.copy(this.worldOf(p, 0.05));
      group.add(m);
    }
    this.overlay.add(group);
    await this.clock.tween(0.4, (t) => {
      mat.opacity = 0.8 * (1 - t);
      for (const m of group.children) m.scale.setScalar(0.6 + t * 0.5);
    });
    this.overlay.remove(group);
    mat.dispose();
  }

  onSpellBurst?: (spell: string) => void;
  onStep?: (side: UnitSide) => void;
  onImpact?: (levels: number) => void;
  onBreath?: () => void;
  onLift?: () => void;

  /** A jet of fire from `from` along the hexes, one hex after another. */
  private async fireJet(from: THREE.Vector3, hexes: Pos[]): Promise<void> {
    const group = new THREE.Group();
    this.overlay.add(group);
    const mats = [0xffe08a, 0xff9a30, 0xff5a10].map((c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
    const blobs: { m: THREE.Mesh; at: THREE.Vector3; born: number }[] = [];
    const pts = hexes.map((p) => this.worldOf(p, 0.5));
    const total = 0.55;
    this.flash(from, 0xff7a20, 10);
    if (!this.reduceShake) this.rig.addShake(0.18);
    await this.clock.tween(total + 0.5, (t) => {
      const time = t * (total + 0.5);
      // Spawn blobs along the line up to the head.
      const head = Math.min(1, time / total);
      const want = Math.floor(head * 36);
      while (blobs.length < want) {
        const i = blobs.length;
        const f = i / 36;
        const seg = f * pts.length;
        const a = seg < 1 ? from : pts[Math.min(pts.length - 1, Math.floor(seg) - 1)]!;
        const b = pts[Math.min(pts.length - 1, Math.floor(seg))]!;
        const at = a.clone().lerp(b, seg % 1);
        at.x += (Math.random() - 0.5) * 0.4;
        at.z += (Math.random() - 0.5) * 0.4;
        const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3 + Math.random() * 0.25, 0), mats[i % 3]!);
        m.position.copy(at);
        group.add(m);
        blobs.push({ m, at, born: time });
      }
      for (const bl of blobs) {
        const age = time - bl.born;
        const k = Math.min(1, age / 0.45);
        bl.m.scale.setScalar(0.6 + k * 1.2);
        bl.m.position.y = bl.at.y + k * 0.6;
        (bl.m.material as THREE.MeshBasicMaterial).opacity = 0.95 * (1 - k);
        bl.m.visible = k < 1;
      }
      const tip = pts[Math.min(pts.length - 1, Math.floor(head * pts.length))]!;
      this.flash(tip, 0xff6a20, 8 * (1 - Math.max(0, time - total) * 2));
    });
    this.overlay.remove(group);
    for (const m of mats) m.dispose();
  }

  private dustPuff(at: THREE.Vector3): void {
    const mat = new THREE.MeshBasicMaterial({ color: 0xbfb2a0, transparent: true, opacity: 0.6, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.6, 16).rotateX(-Math.PI / 2), mat);
    ring.position.copy(at).add(new THREE.Vector3(0, 0.05, 0));
    this.overlay.add(ring);
    void this.clock.tween(0.5, (t) => {
      ring.scale.setScalar(1 + t * 2.2);
      mat.opacity = 0.6 * (1 - t);
    }).then(() => {
      this.overlay.remove(ring);
      mat.dispose();
    });
  }
  onDoor?: (open: boolean) => void;
  onExplosion?: () => void;

  private flash(at: THREE.Vector3, color: number, power: number): void {
    this.flashLight.position.copy(at);
    this.flashLight.color.setHex(color);
    this.flashLight.intensity = power;
  }

  /**
   * V3.9 (24.2): something the party can't see strikes a hero from behind: an arrow-streak flies in
   * from the hero's back, the hero flashes and a "From behind!" floater pops.
   */
  async playUnseenHit(heroId: string): Promise<void> {
    const t = this.units.get(heroId);
    if (!t) return;
    const h = (this.nextState ?? this.state)?.delve?.heroes.find((x) => x.heroId === heroId);
    const f = h ? facingOf(h) : undefined;
    const back = f === undefined ? new THREE.Vector3(0, 0, -1) : (() => {
      const a = facingAngle((f + 3) % 6);
      return new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
    })();
    const end = t.root.position.clone().add(new THREE.Vector3(0, t.height * 0.55, 0));
    const start = end.clone().add(back.clone().multiplyScalar(Math.sqrt(3) * HEX * 2.2));
    const dart = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.7, 5).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffe0d0, transparent: true, opacity: 0.95, depthWrite: false, depthTest: false }));
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 4).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff3a2a, transparent: true, opacity: 1, depthWrite: false, depthTest: false }));
    head.position.z = 0.42;
    const trail = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 1.4).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff5a40, transparent: true, opacity: 0.45, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    trail.position.z = -0.6;
    dart.add(shaft, head, trail);
    dart.renderOrder = 9;
    dart.position.copy(start);
    dart.lookAt(end);
    this.overlay.add(dart);
    this.floatText(t.root.position.clone().add(new THREE.Vector3(0, t.height + 0.55, 0)), 'From behind!', 'warn', 1.4);
    await this.clock.tween(0.22, (k) => dart.position.lerpVectors(start, end, easeInOut(k)));
    this.overlay.remove(dart);
    dart.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    t.flash(new THREE.Color(1, 0.35, 0.3), 1);
    if (!this.reduceShake) this.rig.addShake(0.18);
    this.flash(end, 0xff4030, 3);
    await this.clock.wait(0.12);
    t.flash(new THREE.Color(0, 0, 0), 0);
  }

  /**
   * V3.9 (24.3): the Burglar's backstab: a pale crescent slash across the target, a cold flash, a
   * longer hit-stop and a "Backstab!" floater. Played before the ordinary hit.
   */
  async playBackstab(attackerId: string, targetId: string): Promise<void> {
    const t = this.units.get(targetId);
    const a = this.units.get(attackerId);
    if (!t || !t.root.visible) return;
    const at = t.root.position.clone().add(new THREE.Vector3(0, t.height * 0.6, 0));
    const slash = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.045, 4, 24, Math.PI * 0.9), new THREE.MeshBasicMaterial({ color: 0xe8fff0, transparent: true, opacity: 1, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
    slash.position.copy(at);
    if (a) slash.lookAt(a.root.position.clone().setY(at.y));
    slash.rotateZ(-Math.PI * 0.7);
    slash.renderOrder = 9;
    this.overlay.add(slash);
    this.floatText(t.root.position.clone().add(new THREE.Vector3(0, t.height + 0.6, 0)), 'Backstab!', 'gold', 1.5);
    this.flash(at, 0xc8ffd8, 4);
    this.clock.hitStop(180);
    await this.clock.tween(0.24, (k) => {
      slash.rotation.z += 0.18;
      slash.scale.setScalar(0.7 + k * 0.6);
      (slash.material as THREE.MeshBasicMaterial).opacity = 1 - k;
    });
    this.overlay.remove(slash);
    slash.geometry.dispose();
    (slash.material as THREE.Material).dispose();
  }

  private async lunge(a: UnitView, t: UnitView): Promise<void> {
    const dir = t.root.position.clone().sub(a.root.position);
    a.face(dir.x, dir.z);
    const len = dir.length();
    if (len < 0.01) return;
    dir.normalize();
    const reach = Math.min(0.6, len * 0.35);
    a.busy++;
    await this.clock.tween(0.1, (k) => a.rig.position.copy(dir).multiplyScalar(reach * easeOutCubic(k)));
    void this.clock.tween(0.16, (k) => a.rig.position.copy(dir).multiplyScalar(reach * (1 - k))).then(() => a.busy--);
  }

  private async recoil(t: UnitView, a?: UnitView): Promise<void> {
    const dir = a ? t.root.position.clone().sub(a.root.position).setY(0).normalize() : new THREE.Vector3(0, 0, 1);
    await this.clock.tween(0.18, (k) => t.rig.position.copy(dir).multiplyScalar(Math.sin(k * Math.PI) * 0.26));
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

  /** 20.5: a round shield on a hero's back (the forge's), added once and toggled. */
  private setShield(v: UnitView, on: boolean): void {
    let sh = v.fig.getObjectByName('shield') as THREE.Mesh | undefined;
    if (!sh && on) {
      const g = new THREE.Group();
      g.name = 'shield';
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.03, 12), new THREE.MeshLambertMaterial({ color: 0x8a5a2a, flatShading: true }));
      const boss = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshLambertMaterial({ color: 0xb8bcc4, flatShading: true }));
      rim.rotation.x = Math.PI / 2;
      boss.position.z = -0.02;
      g.add(rim, boss);
      // On the back, below the shoulders (model space: 1.0 tall, +z forward).
      g.position.set(-0.08, 0.62, -0.17);
      g.rotation.y = 0.2;
      v.fig.add(g);
      sh = g as unknown as THREE.Mesh;
    }
    if (sh) sh.visible = on;
  }

  /** 20.5: a crate or barrel breaks: splinters and dust, the prop gone, the loot (if any) on the floor. */
  private async playSmash(e: Extract<GameEvent, { type: 'propSmashed' }>): Promise<void> {
    const lv = this.levels.get(e.at.level);
    if (lv && this.state?.delve) {
      const next = new Set(this.state.delve.smashed ?? []);
      next.add(posKey(e.at));
      this.state.delve.smashed = [...next];
      lv.setSmashed(next);
    }
    if (e.at.level !== this.shownLevel) return;
    const by = this.units.get(e.by);
    const at = this.worldOf(e.at, 0.3);
    if (by) {
      by.face(at.x - by.root.position.x, at.z - by.root.position.z);
      await this.lunge(by, { root: { position: at } } as UnitView);
    }
    this.dustPuff(this.worldOf(e.at, 0.1));
    if (!this.reduceShake) this.rig.addShake(0.08);
    const wood = new THREE.MeshLambertMaterial({ color: 0x8a5a2a, flatShading: true });
    const group = new THREE.Group();
    const bits: { m: THREE.Mesh; v: THREE.Vector3; spin: number }[] = [];
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.05 + Math.random() * 0.08, 0.03, 0.12 + Math.random() * 0.14), wood);
      m.position.copy(at);
      const a = Math.random() * Math.PI * 2;
      bits.push({ m, v: new THREE.Vector3(Math.cos(a) * (1 + Math.random() * 1.5), 2 + Math.random() * 2, Math.sin(a) * (1 + Math.random() * 1.5)), spin: 4 + Math.random() * 6 });
      group.add(m);
    }
    this.overlay.add(group);
    const floorY = this.worldOf(e.at, 0.04).y;
    let last = 0;
    await this.clock.tween(0.55, (t) => {
      const time = t * 0.55;
      const dt = time - last;
      last = time;
      for (const b of bits) {
        b.v.y -= 12 * dt;
        b.m.position.addScaledVector(b.v, dt);
        if (b.m.position.y < floorY) {
          b.m.position.y = floorY;
          b.v.multiplyScalar(0.3);
        }
        b.m.rotation.x += b.spin * dt;
        b.m.rotation.z += b.spin * 0.7 * dt;
      }
    });
    this.overlay.remove(group);
    wood.dispose();
    if (e.items.length) {
      this.floatText(this.worldOf(e.at, 0.9), `+ ${itemsText(e.items)}`, 'gold', 1.6);
      this.flash(this.worldOf(e.at, 0.5), 0xffd27a, 2);
      if (this.state?.delve && !this.state.delve.ground.some((g) => samePos(g.at, e.at))) this.state.delve.ground = [...this.state.delve.ground, { at: e.at, items: e.items }];
      this.refreshLootGlow();
    } else this.floatText(this.worldOf(e.at, 0.9), 'Nothing inside', 'info', 1.2);
  }

  /** 20.2: Dread's cast: a near-black ring swells from the caster, and a second one closes on the target. */
  private async darkRipple(from: THREE.Vector3 | null, to: THREE.Vector3 | null): Promise<void> {
    if (!from) return;
    const mk = (at: THREE.Vector3) => {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 1.0, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x050108, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
      ring.position.copy(at).add(new THREE.Vector3(0, 0.06, 0));
      ring.renderOrder = 6;
      this.overlay.add(ring);
      return ring;
    };
    const a = mk(from);
    const b = to ? mk(to) : null;
    const R = Math.sqrt(3) * HEX * 3;
    await this.clock.tween(0.55, (t) => {
      const k = easeOutCubic(t);
      a.scale.setScalar(Math.max(0.01, R * k));
      (a.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - t);
      if (b) {
        b.scale.setScalar(Math.max(0.01, 2.2 * (1 - k) + 0.3));
        (b.material as THREE.MeshBasicMaterial).opacity = 0.9 * Math.min(1, t * 2);
      }
    });
    this.overlay.remove(a);
    if (b) {
      this.flash(b.position, 0x6a30a0, 3);
      await this.clock.tween(0.2, (t) => ((b.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - t)));
      this.overlay.remove(b);
    }
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

/** A faint copy of a ring overlay drawn only behind nearer geometry (walls), V3.4. */
function throughWall(src: THREE.Mesh): THREE.Mesh {
  const base = src.material as THREE.MeshBasicMaterial;
  const mat = new THREE.MeshBasicMaterial({ color: base.color, transparent: true, opacity: 0.35, depthWrite: false, depthFunc: THREE.GreaterDepth, side: base.side });
  const m = new THREE.Mesh(src.geometry, mat);
  m.name = 'through-wall';
  m.renderOrder = src.renderOrder;
  return m;
}

const INTENT_GLYPH: Record<Intent['kind'], string> = {
  attack: '⚔',
  move: '➜',
  web: '✲',
  steal: '✋',
  flee: '↶',
  wait: '…',
  shove: '⇥',
  breath: '🔥',
  sweep: '↻',
  shout: '📣',
  drag: '⇜',
  grab: '⛓',
  overwatch: '👁',
  smoke: '☁',
  veil: '◐',
  dart: '➶',
  toll: '¤',
  firebolt: '☄',
  charge: '✹',
  fuse: '✹',
  rob: '✋',
  potion: '⚱',
  item: '⚒',
  fireball: '☀',
  mend: '✚',
  gust: '≋',
  ward: '⛉',
  glue: '◍',
  caltrops: '⁂',
  firecracker: '✺',
  blink: '⟿',
  hamstring: '➴',
};
const INTENT_WORDS: Record<Intent['kind'], string> = {
  attack: 'attacks',
  move: 'moves',
  web: 'webs',
  steal: 'steals from',
  flee: 'flees',
  wait: 'waits',
  shove: 'shoves',
  breath: 'breathes fire on',
  sweep: 'sweeps its tail at',
  shout: 'shouts: every orc within 8 wakes and hunts',
  drag: 'drags',
  grab: 'grabs',
  overwatch: 'goes on overwatch',
  smoke: 'throws a smoke bomb at',
  veil: 'veils herself',
  dart: 'throws a sleep dart at',
  toll: 'demands a toll from',
  firebolt: 'hurls a firebolt at',
  charge: 'lights a charge near',
  fuse: 'sets a charge on a fuse at',
  rob: 'robs',
  potion: 'backs off and drinks a potion',
  item: 'uses an item on',
  fireball: 'hurls a fireball at',
  mend: 'mends',
  gust: 'gusts everything around',
  ward: 'wards',
  glue: 'throws a glue bomb at',
  caltrops: 'scatters caltrops on',
  firecracker: 'throws a firecracker to',
  blink: 'blinks away to',
  hamstring: 'shoots the legs of',
};

/** Contract colours (15.7): recover gold, rescue green, slay red. Mirrored in style.css .beacon-tag. */
const BEACON_COLOR: Record<'recover' | 'rescue' | 'slay', number> = { recover: 0xffd36a, rescue: 0x8fe07a, slay: 0xff5a4a };

const THROW_COLOR: Partial<Record<string, number>> = { smoke: 0xb0b0b4, glue: 0xd8e04a, dart: 0x9ad0ff, caltrops: 0x8a8e94, firecracker: 0xff5a3a, charge: 0x8a2a1a };
const SPELL_COLOR: Partial<Record<string, number>> = {
  firebolt: 0xff7a20,
  fireball: 0xff5a10,
  kindle: 0xffd27a,
  mend: 0x7fe08a,
  veil: 0x8a6aff,
  sleep: 0x9ab0ff,
  blink: 0x9a6aff,
  ward: 0x8ad0ff,
  gust: 0xd0f0ff,
  overwatch: 0xffd060,
  knockback: 0xffd060,
  dread: 0x2a1040,
};
const SPELL_LABEL: Partial<Record<string, string>> = {
  fireball: 'Fireball!',
  veil: 'Veil',
  sleep: 'Sleep',
  ward: 'Ward',
  gust: 'Gust',
  overwatch: 'Overwatch!',
  knockback: 'Knockback',
  mend: 'Mend',
  dread: 'Dread',
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
  if (items.some((i) => i.story === 'copper' || i.heavy)) return 'copper';
  if (items.some((i) => i.story === 'caskbook')) return 'book';
  if (items.some((i) => i.kind === 'hoard')) return 'hoard';
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

function heroTag(h: HeroInDelve, max: number, lantern: boolean, open = true, draggedBy?: string, shield = false): string {
  const status = draggedBy ? `<b class="tag-dragged" title="Dragged by ${draggedBy} toward the way out. Kill, down or fear the dragger to free them.">dragged!</b>` : h.status === 'downed' ? `<b class="tag-down">Downed · ${h.bleed}</b>` : h.grabbedBy ? '<b class="tag-grab">⛓ Held</b>' : h.webbed ? '<b class="tag-web">Webbed</b>' : (h.rooted ?? 0) > 0 ? `<b class="tag-rooted" title="Rooted: can't move or dash for ${h.rooted} more round${h.rooted === 1 ? '' : 's'}">rooted · ${h.rooted}</b>` : '';
  const braced = h.braced && h.status === 'active' ? '<b class="tag-braced" title="Braced: hits do 1 less, enemies roll −15%">⛨ braced</b>' : '';
  return `${lantern ? `<span class="tag-lantern ${open ? '' : 'shut'}" title="${open ? 'Lantern, open' : 'Lantern, shuttered'}">${open ? '◆' : '◇'}</span>` : ''}${shield ? '<span class="tag-shield" title="Shield: ranged hits do 1 less (2 while braced)">◉</span>' : ''}${pipsHtml(h.hp, max, 'hero')}${status}${braced}`;
}

function monsterTag(m: Monster): string {
  const aw = m.awareness === 'asleep' ? '<b class="tag-sleep">z</b>' : m.awareness === 'alert' ? '<b class="tag-alert">?</b>' : m.awareness === 'patrol' ? '<b class="tag-patrol" title="On patrol">👣</b>' : '';
  const hold = m.holding ? '<b class="tag-grab">⛓</b>' : '';
  const fear = (m.feared ?? 0) > 0 ? `<b class="tag-fear" title="Feared: flees from the caster for ${m.feared} more turn${m.feared === 1 ? '' : 's'}, attacks nobody">feared</b>` : '';
  const stuck = (m.stuck ?? 0) > 0 ? `<b class="tag-rooted" title="Rooted or glued: can't move for ${m.stuck} more round${m.stuck === 1 ? '' : 's'}; it can still act">rooted · ${m.stuck}</b>` : '';
  return `${aw}${hold}${pipsHtml(m.hp, m.maxHp, 'enemy')}${fear}${stuck}`;
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
