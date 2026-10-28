// V5.0 (G, W5): the V3 merged-primitive figures are retired; every figure is built on the joint rig in
// src/view/look/cast.ts. This file keeps the primitive Kit (furniture.ts builds props with it), the
// FigureModel shape it bakes to, and the ModelKey names the view uses.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

interface Part {
  geo: THREE.BufferGeometry;
  color: number;
  glow?: boolean;
}

export interface FigureModel {
  body: THREE.BufferGeometry;
  glow?: THREE.BufferGeometry;
  /** Height to the top of the head (or hat), in model units, for labels. */
  height: number;
  /** Whether the model hovers (banshee). */
  floats?: boolean;
  /** Translucent body (banshee). */
  ghost?: boolean;
  /** Footprint radius, for fanning. */
  radius: number;
}


export class Kit {
  parts: Part[] = [];
  add(geo: THREE.BufferGeometry, color: number, pos: [number, number, number], rot: [number, number, number] = [0, 0, 0], scale: [number, number, number] = [1, 1, 1], glow = false): this {
    const g = geo.clone();
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scale));
    g.applyMatrix4(m);
    this.parts.push({ geo: g, color, glow });
    return this;
  }
  box(w: number, h: number, d: number, color: number, pos: [number, number, number], rot?: [number, number, number], glow = false): this {
    return this.add(new THREE.BoxGeometry(w, h, d), color, pos, rot, undefined, glow);
  }
  cyl(rt: number, rb: number, h: number, seg: number, color: number, pos: [number, number, number], rot?: [number, number, number], scale?: [number, number, number]): this {
    return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), color, pos, rot, scale);
  }
  cone(r: number, h: number, seg: number, color: number, pos: [number, number, number], rot?: [number, number, number], scale?: [number, number, number]): this {
    return this.add(new THREE.ConeGeometry(r, h, seg), color, pos, rot, scale);
  }
  ball(r: number, color: number, pos: [number, number, number], scale?: [number, number, number], glow = false): this {
    return this.add(new THREE.IcosahedronGeometry(r, 0), color, pos, undefined, scale, glow);
  }
  /** Scale everything added so far about the origin (the feet). */
  scaleAll(s: number): this {
    const m = new THREE.Matrix4().makeScale(s, s, s);
    for (const p of this.parts) p.geo.applyMatrix4(m);
    return this;
  }
  build(height: number, radius: number, extra: Partial<FigureModel> = {}): FigureModel {
    const bake = (parts: Part[]) => {
      const geos = parts.map((p) => {
        let g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
        g.deleteAttribute('uv');
        if (!g.getAttribute('normal')) g.computeVertexNormals();
        const n = g.getAttribute('position').count;
        const c = new THREE.Color(p.color);
        const arr = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          arr[i * 3] = c.r;
          arr[i * 3 + 1] = c.g;
          arr[i * 3 + 2] = c.b;
        }
        g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
        g = g.clone();
        return g;
      });
      return geos.length ? mergeGeometries(geos, false) : undefined;
    };
    const body = bake(this.parts.filter((p) => !p.glow))!;
    const glow = bake(this.parts.filter((p) => p.glow));
    return { body, glow: glow ?? undefined, height, radius, ...extra };
  }
}

export type ModelKey =
  | 'heir'
  | 'sellsword'
  | 'burglar'
  | 'mage'
  | 'ranger'
  | 'sapper'
  | 'pyromancer'
  | 'shadowmancer'
  | 'hedgewitch'
  | 'rats'
  | 'orc'
  | 'spider'
  | 'cutpurse'
  | 'berserker'
  | 'gloam'
  | 'archer'
  | 'captain'
  | 'ghoul'
  | 'sister'
  | 'sisterRanger'
  | 'sisterShadow'
  | 'sisterBurglar'
  | 'prisoner'
  | 'dragon'
  | 'dragonSleep'
  | RivalModelKey;

/** V3.5 (18.5): a cutthroat crew member, by crew and class ("rival-ferrymen-sapper"). */
export type RivalModelKey = `rival-${'ferrymen' | 'gallows-choir' | 'the-wake'}-${'sellsword' | 'ranger' | 'burglar' | 'sapper' | 'pyromancer' | 'shadowmancer' | 'hedgewitch'}`;

