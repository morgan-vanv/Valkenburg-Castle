// Small props on the board: chests, coin piles, ground loot, heirlooms,
// spotted traps, ropes. Each is a group with fog materials.

import * as THREE from 'three';
import { fogMaterial } from './fog';
import { hoardModel } from './furniture';
import { COLORS, FLOOR_TOP } from './world';

export interface PropView {
  obj: THREE.Group;
  mats: THREE.Material[];
  /** Lid pivot for chests. */
  lid?: THREE.Group;
  padlock?: THREE.Object3D;
  state?: string;
}

export function makeChest(tier: number): PropView {
  const wood = fogMaterial({ color: tier >= 3 ? 0x5a2a3a : tier === 2 ? 0x6b4426 : 0x5a3e26, litFloor: 0.16 });
  const iron = fogMaterial({ color: tier >= 2 ? COLORS.gold : COLORS.iron, litFloor: 0.2, emissive: tier >= 2 ? 0x1a1000 : 0 });
  const brass = fogMaterial({ color: COLORS.gold, litFloor: 0.3, emissive: 0x3a2400 });
  const inner = fogMaterial({ color: 0x1a0f08, litFloor: 0.05 });
  const g = new THREE.Group();
  const w = 0.62;
  const d = 0.42;
  const box = new THREE.Mesh(new THREE.BoxGeometry(w, 0.32, d), wood);
  box.position.y = FLOOR_TOP + 0.16;
  const hollow = new THREE.Mesh(new THREE.BoxGeometry(w - 0.08, 0.02, d - 0.08), inner);
  hollow.position.y = FLOOR_TOP + 0.31;
  g.add(box, hollow);
  for (const x of [-w / 2 + 0.06, w / 2 - 0.06]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.34, d + 0.02), iron);
    band.position.set(x, FLOOR_TOP + 0.16, 0);
    g.add(band);
  }
  const lid = new THREE.Group();
  lid.position.set(0, FLOOR_TOP + 0.32, -d / 2);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(d / 2, d / 2, w, 6, 1, false, 0, Math.PI), wood);
  top.rotation.z = Math.PI / 2;
  top.position.set(0, 0, d / 2);
  lid.add(top);
  g.add(lid);
  const padlock = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.05), brass);
  padlock.position.set(0, FLOOR_TOP + 0.22, d / 2 + 0.03);
  g.add(padlock);
  return { obj: g, mats: [wood, iron, brass, inner], lid, padlock };
}

export function makeCoins(amount: number): PropView {
  const gold = fogMaterial({ color: COLORS.gold, litFloor: 0.35, emissive: 0x2a1a00 });
  const g = new THREE.Group();
  const n = Math.min(9, 3 + Math.floor(amount / 15));
  for (let i = 0; i < n; i++) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.025, 7), gold);
    const a = i * 2.4;
    const r = i === 0 ? 0 : 0.08 + (i % 3) * 0.06;
    c.position.set(Math.sin(a) * r, FLOOR_TOP + 0.015 + (i < 3 ? i * 0.025 : 0), Math.cos(a) * r);
    c.rotation.set((i % 2) * 0.2, 0, (i % 3) * 0.15);
    g.add(c);
  }
  return { obj: g, mats: [gold] };
}

export function makeSack(): PropView {
  const cloth = fogMaterial({ color: 0x8a7350, litFloor: 0.18 });
  const tie = fogMaterial({ color: 0x3a2a1a, litFloor: 0.1 });
  const g = new THREE.Group();
  const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.18, 0), cloth);
  s.scale.set(1, 0.85, 1);
  s.position.set(0.15, FLOOR_TOP + 0.15, 0.1);
  const t = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.12, 5), tie);
  t.position.set(0.15, FLOOR_TOP + 0.34, 0.1);
  g.add(s, t);
  return { obj: g, mats: [cloth, tie] };
}

export function makeHeirloom(): PropView {
  const gold = fogMaterial({ color: 0xffd36a, litFloor: 0.5, emissive: 0x4a3000 });
  const gem = new THREE.MeshBasicMaterial({ color: 0xff4a6a });
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.05, 8), gold);
  base.position.y = FLOOR_TOP + 0.025;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.18, 6), gold);
  stem.position.y = FLOOR_TOP + 0.13;
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.06, 0.2, 8, 1, true), gold);
  cup.position.y = FLOOR_TOP + 0.31;
  (cup.material as THREE.Material).side = THREE.DoubleSide;
  const jewel = new THREE.Mesh(new THREE.OctahedronGeometry(0.035, 0), gem);
  jewel.position.set(0, FLOOR_TOP + 0.31, 0.12);
  g.add(base, stem, cup, jewel);
  g.name = 'heirloom';
  return { obj: g, mats: [gold] };
}

/** V3.5 (18.3): the brewing copper: a squat copper pot with a domed lid and a swan-neck pipe. Heavy. */
export function makeCopper(): PropView {
  const copper = fogMaterial({ color: 0xb8683a, litFloor: 0.4, emissive: 0x2a1006 });
  const dark = fogMaterial({ color: 0x5a3018, litFloor: 0.2 });
  const g = new THREE.Group();
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.26, 0.36, 10), copper);
  pot.position.y = FLOOR_TOP + 0.18;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), copper);
  dome.position.y = FLOOR_TOP + 0.36;
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.025, 4, 12), dark);
  band.rotation.x = Math.PI / 2;
  band.position.y = FLOOR_TOP + 0.3;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.32, 6), copper);
  neck.position.set(0.12, FLOOR_TOP + 0.66, 0);
  neck.rotation.z = -0.5;
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 6), copper);
  spout.position.set(0.34, FLOOR_TOP + 0.72, 0);
  spout.rotation.z = -1.4;
  g.add(pot, dome, band, neck, spout);
  g.name = 'copper';
  return { obj: g, mats: [copper, dark] };
}

/** V3.5 (18.3): Wim's cask book: a fat leather book with brass corners. */
export function makeBook(): PropView {
  const leather = fogMaterial({ color: 0x5a2a1a, litFloor: 0.25 });
  const page = fogMaterial({ color: 0xe8dcc0, litFloor: 0.35 });
  const g = new THREE.Group();
  const cover = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.26), leather);
  cover.position.y = FLOOR_TOP + 0.05;
  const pages = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.07, 0.235), page);
  pages.position.set(0.012, FLOOR_TOP + 0.05, 0);
  g.add(cover, pages);
  g.rotation.y = 0.4;
  g.name = 'book';
  return { obj: g, mats: [leather, page] };
}

/** A spotted trap: an iron plate of spikes in a red ring; V4.0 (spec 29.5) a venom trap's needles and ring are green. */
export function makeTrap(venom = false): PropView {
  const iron = fogMaterial({ color: venom ? 0x4f6a48 : 0x5a5250, litFloor: 0.2 });
  const red = new THREE.MeshBasicMaterial({ color: venom ? 0x6fdc5a : COLORS.danger, transparent: true, opacity: venom ? 0.7 : 0.55, depthWrite: false });
  const g = new THREE.Group();
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.03, 6), iron);
  plate.position.y = FLOOR_TOP + 0.015;
  g.add(plate);
  for (let i = 0; i < 7; i++) {
    const a = (i / 6) * Math.PI * 2;
    const r = i === 6 ? 0 : 0.24;
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.2, 4), iron);
    spike.position.set(Math.sin(a) * r, FLOOR_TOP + 0.1, Math.cos(a) * r);
    g.add(spike);
  }
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.46, 0.56, 6), red);
  ring.rotation.x = -Math.PI / 2;
  ring.rotation.z = Math.PI / 6;
  ring.position.y = FLOOR_TOP + 0.03;
  g.add(ring);
  return { obj: g, mats: [iron] };
}

export function makeRope(): PropView {
  const rope = fogMaterial({ color: 0xb08a50, litFloor: 0.2 });
  const g = new THREE.Group();
  const coil = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.04, 4, 10), rope);
  coil.rotation.x = Math.PI / 2;
  coil.position.y = FLOOR_TOP + 0.04;
  const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 5), fogMaterial({ color: COLORS.iron }));
  stake.position.y = FLOOR_TOP + 0.15;
  const line = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 4, 4), rope);
  line.position.set(0.5, FLOOR_TOP - 1.8, 0);
  g.add(coil, stake, line);
  return { obj: g, mats: [rope] };
}

export function makeHoard(): PropView {
  const gold = fogMaterial({ vertexColors: true, litFloor: 0.45, emissive: 0x2a1800 });
  const glint = new THREE.MeshBasicMaterial({ vertexColors: true });
  const m = hoardModel();
  const g = new THREE.Group();
  const body = new THREE.Mesh(m.body, gold);
  body.position.y = FLOOR_TOP;
  g.add(body);
  if (m.glow) {
    const gl = new THREE.Mesh(m.glow, glint);
    gl.position.y = FLOOR_TOP;
    g.add(gl);
  }
  g.scale.setScalar(1.25);
  return { obj: g, mats: [gold] };
}
