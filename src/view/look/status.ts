// V5.0 (G, W1): in-world status effects, built to the play track's spec (docs/v5-status-visuals.md, the
// "In world" column). Three channels say one thing: the figure (here), its tag (the diorama's strip) and the
// party card (the HUD). Priority 1 states change the figure itself; the rest mark its hex.
//
// Colour has meaning and stays put: poison green, bleeding red, darkness desaturation and cold blue, fear pale,
// stealth a dark violet shimmer, guard and brace a warm gold edge.
//
// - Dark (unlit): the figure goes cold: desaturated and blue-shifted, no warm fill (the black ring is gone).
//   On Level 3 a slow dark pulse breathes on the floor under every unlit hero (the Gloam's palette).
// - Poisoned: a green tint on the figure; stronger at 1 HP.
// - Downed: a red pool under the figure that grows as the bleed count falls (3 small, 2 larger, 1 the hex).
// - Hunting monster / hostile crew member: a thin red ring on its hex (the free-swing warning).
// - Braced: a warm gold rim (emissive edge). Veiled: translucent with a violet shimmer. Feared: pale.

import * as THREE from 'three';
import type { UnitView } from '../unit';

export interface UnitStatus {
  dark?: boolean;
  /** Level 3 with the Gloam about: the dark pulse. */
  gloam?: boolean;
  poisoned?: boolean;
  /** HP 1 while poisoned: the stronger tint. */
  poisonBad?: boolean;
  /** Bleed count while downed (undefined when up). */
  bleed?: number;
  hunting?: boolean;
  braced?: boolean;
  veiled?: boolean;
  feared?: boolean;
}

const TINT = {
  none: new THREE.Color(1, 1, 1),
  dark: new THREE.Color(0.36, 0.42, 0.62),
  poison: new THREE.Color(0.62, 1.0, 0.6),
  poisonBad: new THREE.Color(0.45, 1.0, 0.45),
  veil: new THREE.Color(0.62, 0.5, 0.9),
  fear: new THREE.Color(0.92, 0.9, 1.0),
};
const RIM_GOLD = new THREE.Color(0.1, 0.065, 0.012);

export class StatusFx {
  /** Pools and pulses in the world (go through the blur, they are part of the scene). */
  readonly group = new THREE.Group();
  /** Hex rings that must stay sharp (the overlay scene). */
  readonly rings = new THREE.Group();
  private pools = new Map<string, THREE.Mesh>();
  private pulses = new Map<string, THREE.Mesh>();
  private huntRings = new Map<string, THREE.Mesh>();
  private applied = new Map<string, UnitStatus>();

  private static poolGeo = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2);
  private static hexRing = new THREE.RingGeometry(0.86, 0.95, 6, 1, Math.PI / 6).rotateX(-Math.PI / 2);

  /** Apply the states for every unit in `states`; units not listed are cleared. */
  sync(units: Map<string, UnitView>, states: Map<string, UnitStatus>): void {
    for (const [id, v] of units) {
      const s = states.get(id) ?? {};
      this.applyTint(v, s);
      this.pool(id, v, s.bleed);
      this.pulse(id, v, !!(s.dark && s.gloam));
      this.hunt(id, v, !!s.hunting);
      this.applied.set(id, s);
    }
    for (const id of [...this.pools.keys()]) if (!units.has(id)) this.drop(this.pools, id);
    for (const id of [...this.pulses.keys()]) if (!units.has(id)) this.drop(this.pulses, id);
    for (const id of [...this.huntRings.keys()]) if (!units.has(id)) this.drop(this.huntRings, id);
  }

  private applyTint(v: UnitView, s: UnitStatus): void {
    const tint = s.veiled ? TINT.veil : s.poisonBad ? TINT.poisonBad : s.poisoned ? TINT.poison : s.dark ? TINT.dark : s.feared ? TINT.fear : TINT.none;
    v.body.color.copy(tint);
    v.metal?.color.copy(tint);
    v.statusOpacity = s.veiled ? 0.55 : 1;
    v.rim.copy(s.braced ? RIM_GOLD : new THREE.Color(0, 0, 0));
    v.refreshStatus();
  }

  private pool(id: string, v: UnitView, bleed: number | undefined): void {
    let m = this.pools.get(id);
    if (bleed === undefined) {
      if (m) this.drop(this.pools, id);
      return;
    }
    if (!m) {
      // Self-lit so the pool reads in the dark too (it is the count, pillar 15).
      m = new THREE.Mesh(StatusFx.poolGeo, new THREE.MeshBasicMaterial({ color: 0x7a0c14, transparent: true, opacity: 0.85, depthWrite: false }));
      m.renderOrder = 1;
      this.group.add(m);
      this.pools.set(id, m);
    }
    m.userData.radius = bleed >= 3 ? 0.35 : bleed === 2 ? 0.6 : 0.9;
    m.position.set(v.root.position.x, v.root.position.y + 0.02, v.root.position.z);
    m.visible = v.shown && v.root.visible;
  }

  private pulse(id: string, v: UnitView, on: boolean): void {
    let m = this.pulses.get(id);
    if (!on) {
      if (m) this.drop(this.pulses, id);
      return;
    }
    if (!m) {
      // A cold ring breathing on the floor: the Gloam's palette, additive so it reads on dark stone too.
      m = new THREE.Mesh(new THREE.RingGeometry(0.72, 1.18, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x3a2c90, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.renderOrder = 1;
      m.userData.phase = Math.random() * 6;
      this.group.add(m);
      this.pulses.set(id, m);
    }
    m.position.set(v.root.position.x, v.root.position.y + 0.03, v.root.position.z);
    m.visible = v.shown && v.root.visible;
  }

  private hunt(id: string, v: UnitView, on: boolean): void {
    let m = this.huntRings.get(id);
    if (!on) {
      if (m) this.drop(this.huntRings, id);
      return;
    }
    if (!m) {
      m = new THREE.Mesh(StatusFx.hexRing, new THREE.MeshBasicMaterial({ color: 0xff2a30, transparent: true, opacity: 0.75, depthWrite: false }));
      m.renderOrder = 2;
      this.rings.add(m);
      this.huntRings.set(id, m);
    }
    m.position.set(v.root.position.x, v.root.position.y + 0.04, v.root.position.z);
    m.visible = v.shown && v.root.visible;
  }

  private drop(map: Map<string, THREE.Mesh>, id: string): void {
    const m = map.get(id);
    if (!m) return;
    m.parent?.remove(m);
    (m.material as THREE.Material).dispose();
    map.delete(id);
  }

  /** Per frame: the pulses breathe, the pools spread, the rings follow their figures. */
  update(units: Map<string, UnitView>, t: number): void {
    for (const [id, m] of this.pools) {
      const v = units.get(id);
      if (!v) continue;
      m.visible = v.shown && v.root.visible;
      const r = m.userData.radius as number;
      const k = 1 + Math.sin(t * 2.4) * 0.04;
      m.scale.setScalar(r * k);
      m.position.set(v.root.position.x, v.root.position.y + 0.02, v.root.position.z);
      (m.material as THREE.MeshBasicMaterial).opacity = 0.75 + Math.sin(t * 2.4) * 0.1;
    }
    for (const [id, m] of this.pulses) {
      const v = units.get(id);
      if (!v) continue;
      m.visible = v.shown && v.root.visible;
      const k = 0.5 + 0.5 * Math.sin(t * 1.4 + (m.userData.phase as number));
      m.scale.setScalar(0.9 + k * 0.3);
      (m.material as THREE.MeshBasicMaterial).opacity = 0.14 + 0.18 * k;
      m.position.set(v.root.position.x, v.root.position.y + 0.03, v.root.position.z);
    }
    for (const [id, m] of this.huntRings) {
      const v = units.get(id);
      if (!v) continue;
      m.visible = v.shown && v.root.visible;
      m.position.set(v.root.position.x, v.root.position.y + 0.04, v.root.position.z);
      (m.material as THREE.MeshBasicMaterial).opacity = 0.6 + 0.25 * Math.sin(t * 4);
    }
  }
}
