// V3.2 map effects (spec 15.3/15.4): smoke clouds, glue puddles, caltrops,
// burning hexes, veiled heroes (translucent), warded heroes (shield glint),
// overwatch (eye + cone), sleeping monsters (z). Pure view: the diorama feeds
// it an EffectsInput built from the state by effectsFromState().

import * as THREE from 'three';
import { distance, hexToWorld, parsePosKey, posKey, type Pos } from '../game/hex';
import type { GameState } from '../game/types';
import { glowTexture } from './sprites';
import { HEX } from './world';

export interface EffectsInput {
  smoke: Pos[];
  glue: Pos[];
  caltrops: Pos[];
  burning: Pos[];
  /** Hero ids. */
  veiled: string[];
  warded: string[];
  /** Ranger on overwatch: hero id, where, range. */
  overwatch: { id: string; at: Pos; range: number }[];
  /** Monster ids stuck in glue. */
  stuck: string[];
  /** Monster ids asleep (sleep spell, dart, or never woke). */
  sleeping: string[];
}

export const NO_EFFECTS: EffectsInput = { smoke: [], glue: [], caltrops: [], burning: [], veiled: [], warded: [], overwatch: [], stuck: [], sleeping: [] };

/** Read effect state from the delve (contract fields from V3.2). */
export function effectsFromState(s: GameState | null): EffectsInput {
  const d = s?.delve;
  if (!d) return NO_EFFECTS;
  const live = (r: Record<string, number> | undefined) => Object.entries(r ?? {}).filter(([, n]) => n > 0).map(([k]) => parsePosKey(k));
  const active = d.heroes.filter((h) => h.status === 'active');
  return {
    smoke: live(d.smoke),
    glue: live(d.glue),
    caltrops: (d.caltrops ?? []).map(parsePosKey),
    burning: live(d.burning),
    veiled: active.filter((h) => (h.veil ?? 0) > 0).map((h) => h.heroId),
    warded: active.filter((h) => (h.ward ?? 0) > 0).map((h) => h.heroId),
    overwatch: active.filter((h) => h.overwatch).map((h) => ({ id: h.heroId, at: h.at, range: 6 })),
    stuck: d.monsters.filter((m) => (m.stuck ?? 0) > 0 && m.hp > 0).map((m) => m.id),
    sleeping: d.monsters.filter((m) => m.awareness === 'asleep' && m.kind !== 'dragon' && m.hp > 0).map((m) => m.id),
  };
}

export interface EffectsHost {
  worldOf(p: Pos, lift?: number): THREE.Vector3;
  shownLevel: number;
  /** Hex visible or explored (effects on unknown hexes are not drawn). */
  known(p: Pos): boolean;
  visible(p: Pos): boolean;
  unit(id: string): { root: THREE.Object3D; height: number; facing: number; setOpacity(k: number): void; shown: boolean } | undefined;
  fx: HTMLElement;
  project(v: THREE.Vector3): { x: number; y: number; behind: boolean };
}

/** Draws and animates the effects. */
export class MapEffects {
  readonly group = new THREE.Group();
  private input: EffectsInput = NO_EFFECTS;
  private smoke = new THREE.Group();
  private glue = new THREE.Group();
  private caltrops = new THREE.Group();
  private fire = new THREE.Group();
  private wards = new THREE.Group();
  private cones = new THREE.Group();
  private tags = new Map<string, { el: HTMLElement; id: string }>();
  private veiledNow = new Set<string>();

  private mats = {
    smoke: new THREE.MeshLambertMaterial({ color: 0x9a9a9e, transparent: true, opacity: 0.55, depthWrite: false, flatShading: true }),
    glue: new THREE.MeshBasicMaterial({ color: 0xc8d24a, transparent: true, opacity: 0.55, depthWrite: false }),
    glueHi: new THREE.MeshBasicMaterial({ color: 0xf0f6a0, transparent: true, opacity: 0.7, depthWrite: false }),
    spike: new THREE.MeshLambertMaterial({ color: 0x8a8e94, flatShading: true }),
    flameA: new THREE.MeshBasicMaterial({ color: 0xffb040, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    flameB: new THREE.MeshBasicMaterial({ color: 0xff5a10, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
    scorch: new THREE.MeshBasicMaterial({ color: 0xff4a10, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }),
    ward: new THREE.MeshBasicMaterial({ color: 0x8ad0ff, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    cone: new THREE.MeshBasicMaterial({ color: 0xffd060, transparent: true, opacity: 0.18, depthWrite: false }),
    coneEdge: new THREE.MeshBasicMaterial({ color: 0xffd060, transparent: true, opacity: 0.6, depthWrite: false }),
  };
  private geo = {
    puff: new THREE.IcosahedronGeometry(0.32, 0),
    disc: new THREE.CircleGeometry(0.7, 6, Math.PI / 6).rotateX(-Math.PI / 2),
    blob: new THREE.CircleGeometry(0.22, 7).rotateX(-Math.PI / 2),
    spike: new THREE.TetrahedronGeometry(0.07, 0),
    flame: new THREE.ConeGeometry(0.16, 0.55, 5),
    hexFill: new THREE.CircleGeometry(0.82, 6, Math.PI / 6).rotateX(-Math.PI / 2),
    hexRing: new THREE.RingGeometry(0.72, 0.84, 6, 1, Math.PI / 6).rotateX(-Math.PI / 2),
    shield: new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.6),
  };

  constructor(private readonly host: EffectsHost) {
    this.group.add(this.smoke, this.glue, this.caltrops, this.fire, this.wards, this.cones);
    this.group.renderOrder = 2;
  }

  set(input: EffectsInput): void {
    this.input = input;
    this.rebuild();
  }

  /** Redraw for the shown level and fog. */
  rebuild(): void {
    const h = this.host;
    const lv = h.shownLevel;
    const on = (p: Pos) => p.level === lv && h.known(p);
    for (const g of [this.smoke, this.glue, this.caltrops, this.fire, this.wards, this.cones]) g.clear();
    const inp = this.input;

    for (const p of inp.smoke.filter(on)) {
      const c = new THREE.Group();
      c.position.copy(h.worldOf(p, 0));
      const seed = hash(posKey(p));
      for (let i = 0; i < 5; i++) {
        const m = new THREE.Mesh(this.geo.puff, this.mats.smoke);
        const a = seed * 0.37 + i * 1.3;
        m.position.set(Math.sin(a) * 0.32, 0.25 + (i % 3) * 0.2, Math.cos(a) * 0.32);
        m.scale.setScalar(0.9 + ((seed + i * 7) % 5) * 0.12);
        m.userData.base = m.position.clone();
        m.userData.ph = a;
        m.renderOrder = 5;
        c.add(m);
      }
      this.smoke.add(c);
    }
    for (const p of inp.glue.filter(on)) {
      const g = new THREE.Group();
      g.position.copy(h.worldOf(p, 0.03));
      const d = new THREE.Mesh(this.geo.disc, this.mats.glue);
      d.scale.setScalar(0.85);
      g.add(d);
      const seed = hash(posKey(p));
      for (let i = 0; i < 4; i++) {
        const b = new THREE.Mesh(this.geo.blob, this.mats.glueHi);
        const a = seed + i * 1.7;
        b.position.set(Math.sin(a) * 0.32, 0.005, Math.cos(a) * 0.32);
        b.scale.setScalar(0.5 + (i % 2) * 0.4);
        g.add(b);
      }
      this.glue.add(g);
    }
    for (const p of inp.caltrops.filter(on)) {
      const g = new THREE.Group();
      g.position.copy(h.worldOf(p, 0.04));
      const seed = hash(posKey(p));
      for (let i = 0; i < 9; i++) {
        const s = new THREE.Mesh(this.geo.spike, this.mats.spike);
        const a = seed * 0.11 + i * 2.39;
        const r = 0.12 + (i % 3) * 0.14;
        s.position.set(Math.sin(a) * r, 0.03, Math.cos(a) * r);
        s.rotation.set(a, a * 0.7, a * 1.3);
        g.add(s);
      }
      this.caltrops.add(g);
    }
    for (const p of inp.burning.filter(on)) {
      const g = new THREE.Group();
      g.position.copy(h.worldOf(p, 0.02));
      const s = new THREE.Mesh(this.geo.hexFill, this.mats.scorch);
      g.add(s);
      const seed = hash(posKey(p));
      for (let i = 0; i < 4; i++) {
        const f = new THREE.Mesh(this.geo.flame, i % 2 ? this.mats.flameB : this.mats.flameA);
        const a = seed * 0.3 + i * 1.6;
        f.position.set(Math.sin(a) * 0.3, 0.25, Math.cos(a) * 0.3);
        f.userData.ph = a;
        f.renderOrder = 6;
        g.add(f);
      }
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff7a20, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }));
      glow.scale.setScalar(1.8);
      glow.position.y = 0.4;
      g.add(glow);
      this.fire.add(g);
    }
    for (const id of inp.warded) {
      const u = h.unit(id);
      if (!u) continue;
      const m = new THREE.Mesh(this.geo.shield, this.mats.ward);
      m.userData.unit = id;
      m.scale.set(0.55, u.height * 0.75, 0.55);
      m.renderOrder = 6;
      this.wards.add(m);
    }
    for (const ow of inp.overwatch) {
      if (ow.at.level !== lv) continue;
      const u = h.unit(ow.id);
      const facing = u?.facing ?? 0;
      const fx = Math.sin(facing);
      const fz = Math.cos(facing);
      const o = hexToWorld(ow.at, HEX);
      for (let dq = -ow.range; dq <= ow.range; dq++)
        for (let dr = -ow.range; dr <= ow.range; dr++) {
          const p = { level: ow.at.level, q: ow.at.q + dq, r: ow.at.r + dr };
          const dist = distance(p, ow.at);
          if (dist < 1 || dist > ow.range || !h.visible(p)) continue;
          const w = hexToWorld(p, HEX);
          const vx = w.x - o.x;
          const vz = w.z - o.z;
          const len = Math.hypot(vx, vz) || 1;
          // A 120 degree cone in front of the ranger.
          if ((vx * fx + vz * fz) / len < 0.5) continue;
          const m = new THREE.Mesh(dist === ow.range ? this.geo.hexRing : this.geo.hexFill, dist === ow.range ? this.mats.coneEdge : this.mats.cone);
          m.position.copy(h.worldOf(p, 0.03));
          m.renderOrder = 2;
          this.cones.add(m);
        }
    }
    this.syncTags();
  }

  private syncTags(): void {
    const want = new Map<string, string>();
    for (const ow of this.input.overwatch) want.set(`ow:${ow.id}`, ow.id);
    for (const id of this.input.sleeping) want.set(`zz:${id}`, id);
    for (const id of this.input.stuck) want.set(`gl:${id}`, id);
    for (const id of this.input.veiled) want.set(`vl:${id}`, id);
    for (const [k, t] of this.tags)
      if (!want.has(k)) {
        t.el.remove();
        this.tags.delete(k);
      }
    for (const [k, id] of want) {
      if (this.tags.has(k)) continue;
      const el = document.createElement('div');
      const kind = k.slice(0, 2);
      el.className = `fx-tag fx-${kind}`;
      el.textContent = kind === 'ow' ? '👁' : kind === 'zz' ? 'z z' : kind === 'gl' ? 'Stuck' : 'Veiled';
      el.title = kind === 'ow' ? 'Overwatch: shoots the first enemy that moves or acts in the cone' : kind === 'zz' ? 'Asleep' : kind === 'gl' ? 'Stuck in glue: cannot move' : 'Veiled: monsters cannot see this hero';
      this.host.fx.appendChild(el);
      this.tags.set(k, { el, id });
    }
  }

  /** Per frame: animate and place DOM tags; keep veiled heroes translucent. */
  update(t: number): void {
    for (const c of this.smoke.children)
      for (const m of c.children) {
        const b = m.userData.base as THREE.Vector3;
        const ph = m.userData.ph as number;
        m.position.set(b.x + Math.sin(t * 0.5 + ph) * 0.06, b.y + Math.sin(t * 0.7 + ph) * 0.05, b.z + Math.cos(t * 0.4 + ph) * 0.06);
        m.rotation.y = t * 0.2 + ph;
      }
    for (const g of this.fire.children)
      for (const f of g.children) {
        if (f.userData.ph === undefined) continue;
        const ph = f.userData.ph as number;
        f.scale.set(1, 0.7 + 0.45 * Math.abs(Math.sin(t * 9 + ph)), 1);
        f.rotation.y = t * 2 + ph;
      }
    this.mats.ward.opacity = 0.25 + 0.2 * (0.5 + 0.5 * Math.sin(t * 3));
    this.mats.cone.opacity = 0.12 + 0.08 * (0.5 + 0.5 * Math.sin(t * 2.4));
    for (const w of this.wards.children) {
      const u = this.host.unit(w.userData.unit as string);
      w.visible = !!u && u.shown && u.root.visible;
      if (u) w.position.copy(u.root.position);
      w.rotation.y = t * 0.8;
    }
    // Veiled heroes: translucent (restore when the veil drops).
    const veiled = new Set(this.input.veiled);
    for (const id of veiled) this.host.unit(id)?.setOpacity(0.38 + 0.08 * Math.sin(t * 2));
    for (const id of this.veiledNow) if (!veiled.has(id)) this.host.unit(id)?.setOpacity(1);
    this.veiledNow = veiled;
    for (const tag of this.tags.values()) {
      const u = this.host.unit(tag.id);
      if (!u || !u.shown || !u.root.visible) {
        tag.el.style.display = 'none';
        continue;
      }
      const p = this.host.project(u.root.position.clone().add(new THREE.Vector3(0, u.height + 0.35, 0)));
      tag.el.style.display = p.behind ? 'none' : '';
      tag.el.style.transform = `translate(${p.x}px, ${p.y - 40}px) translate(-50%, -100%)`;
    }
  }
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0) % 1000;
}
