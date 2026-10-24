// A flat-shaded Lambert material that knows about fog of war.
//
// Fog value per fragment:
//   0     unexplored (discarded)
//   0.35  "below": a lower level seen down a pit; lit normally but dimmed and
//         cooled, so the depth reads
//   0.5   explored but not in sight (dim, desaturated, cold, ignores lights)
//   0.75  in sight but unlit (only point lights, no lit floor)
//   1     visible and lit (lit normally plus a floor of warmth so lit rooms
//         read beyond the lamps)
//
// Instanced meshes take the value from an `aFog` instance attribute. Plain
// meshes take it from the `uFog` uniform (see setMaterialFog).
//
// Instanced meshes may also carry `aGlow` (vec3): baked light from the fixed
// lights (sconces, daylight, fire, fungus), added on visible hexes. Floors can
// carry `aMat` (float): the floor material, which draws engraved hex edges and
// a pattern (planks, rug weave, earth, rock, water, bone).

import * as THREE from 'three';

export interface FogMaterialOptions {
  color?: number;
  instanced?: boolean;
  vertexColors?: boolean;
  emissive?: number;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
  /** Fraction of the base colour always shown when visible. */
  litFloor?: number;
  /** Instanced walls: lower the ones between the camera and the focus point. */
  cutaway?: boolean;
  /** Instanced: read baked light from the `aGlow` attribute. */
  glow?: boolean;
  /** Instanced floors: draw material patterns from `aMat` and hex edges. */
  floor?: boolean;
}

/** Shared cutaway state, updated by the diorama every frame. */
export const CUTAWAY = {
  center: { value: new THREE.Vector3() },
  /** Horizontal unit vector from the focus point toward the camera. */
  dir: { value: new THREE.Vector3(0, 0, 1) },
  height: { value: 0.3 },
};

export type FogMaterial = THREE.MeshLambertMaterial & { userData: { fog: { value: number }; dim: { value: number } } };

/** Global dimming of explored squares; tweak for readability. */
export const EXPLORED_LEVEL = 0.26;

/** Fog value for a lower level seen down a pit. */
export const FOG_BELOW = 0.35;

/** Floor material ids for `aMat`. */
export const MAT_ID: Record<string, number> = { flagstone: 0, planks: 1, rug: 2, earth: 3, rock: 4, water: 5, bone: 6 };

const FLOOR_FRAG = `
{
  // Hex-local position on the top face: engraved edges.
  float m = vMat;
  if (vUp > 0.5) {
    vec2 p = vLocal;
    float d = max(abs(p.x), max(abs(dot(p, vec2(0.5, 0.8660254))), abs(dot(p, vec2(-0.5, 0.8660254)))));
    float edge = smoothstep(0.80, 0.86, d);
    vec2 w = vWorld.xz;
    float n1 = fract(sin(dot(floor(w * 2.3), vec2(12.9898, 78.233))) * 43758.5453);
    float n2 = fract(sin(dot(floor(w * 5.1), vec2(39.346, 11.135))) * 24634.6345);
    float lines = 0.55;
    if (m < 0.5) {
      // flagstone: crisp hex joints, slight stone mottling.
      diffuseColor.rgb *= 0.94 + n1 * 0.1;
      lines = 0.6;
    } else if (m < 1.5) {
      // planks: boards along x with dark seams and per-board shade.
      float row = w.y * 3.2;
      float seam = smoothstep(0.0, 0.07, fract(row)) * (1.0 - smoothstep(0.93, 1.0, fract(row)));
      float board = fract(sin(floor(row) * 91.7) * 4375.85);
      float butt = step(0.03, fract(w.x * 0.45 + board * 3.0));
      diffuseColor.rgb *= (0.84 + board * 0.22) * mix(0.55, 1.0, seam * butt);
      lines = 0.25;
    } else if (m < 2.5) {
      // rug: soft weave and a pale border band on the hex edges.
      float weave = 0.93 + 0.07 * sin(w.x * 18.0) * sin(w.y * 18.0);
      diffuseColor.rgb *= weave;
      float band = smoothstep(0.62, 0.66, d) * (1.0 - smoothstep(0.72, 0.76, d));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.62, 0.32), band * 0.45);
      lines = 0.2;
    } else if (m < 3.5) {
      // earth: blotchy, no joints to speak of.
      diffuseColor.rgb *= 0.82 + n1 * 0.16 + n2 * 0.1;
      lines = 0.12;
    } else if (m < 4.5) {
      // rock: coarse light and dark patches.
      diffuseColor.rgb *= 0.78 + n2 * 0.3;
      lines = 0.35;
    } else if (m < 5.5) {
      // water: dark, with moving pale ripples.
      float rip = sin(w.x * 3.0 + w.y * 2.0 + uTime * 1.3) * sin(w.y * 4.0 - uTime * 0.9);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55, 0.7, 0.78), smoothstep(0.6, 0.95, rip) * 0.35);
      lines = 0.1;
    } else {
      // bone: a few pale flecks on dark ground.
      vec2 cell = floor(w * 3.0);
      float r = fract(sin(dot(cell, vec2(27.17, 91.43))) * 15731.743);
      vec2 f = fract(w * 3.0) - 0.5 - (vec2(r, fract(r * 7.3)) - 0.5) * 0.5;
      float fleck = step(0.7, r) * (1.0 - smoothstep(0.05, 0.11, abs(f.x * 0.4 + f.y))) * (1.0 - smoothstep(0.2, 0.3, length(f)));
      diffuseColor.rgb = mix(diffuseColor.rgb * (0.88 + n1 * 0.12), vec3(0.82, 0.78, 0.68), fleck * 0.6);
      lines = 0.2;
    }
    diffuseColor.rgb *= 1.0 - edge * lines;
  }
}
`;

let timeUniform = { value: 0 };
/** Advance the shared time uniform (water ripples). */
export function setFogTime(t: number): void {
  timeUniform.value = t;
}

export function fogMaterial(opts: FogMaterialOptions = {}): FogMaterial {
  const m = new THREE.MeshLambertMaterial({
    color: opts.color ?? 0xffffff,
    flatShading: true,
    vertexColors: opts.vertexColors ?? false,
    emissive: opts.emissive ?? 0x000000,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    side: opts.side ?? THREE.FrontSide,
  }) as FogMaterial;
  const fog = { value: 1 };
  const dim = { value: opts.litFloor ?? 0.1 };
  m.userData.fog = fog;
  m.userData.dim = dim;
  const instanced = !!opts.instanced;
  const cut = !!opts.cutaway && instanced;
  const glow = !!opts.glow && instanced;
  const floor = !!opts.floor && instanced;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uFog = fog;
    shader.uniforms.uCutCenter = CUTAWAY.center;
    shader.uniforms.uCutDir = CUTAWAY.dir;
    shader.uniforms.uCutHeight = CUTAWAY.height;
    shader.uniforms.uLitFloor = dim;
    shader.uniforms.uExplored = { value: EXPLORED_LEVEL };
    shader.uniforms.uTime = timeUniform;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
${instanced ? 'attribute float aFog;' : 'uniform float uFog;'}
${glow ? 'attribute vec3 aGlow; varying vec3 vGlow;' : ''}
${floor ? 'attribute float aMat; varying float vMat; varying vec2 vLocal; varying vec3 vWorld; varying float vUp;' : ''}
uniform vec3 uCutCenter;
uniform vec3 uCutDir;
uniform float uCutHeight;
varying float vFog;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vFog = ${instanced ? 'aFog' : 'uFog'};
${glow ? 'vGlow = aGlow;' : ''}
${
  floor
    ? `vMat = aMat; vLocal = position.xz; vUp = normal.y;
vWorld = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;`
    : ''
}
${
  cut
    ? `{
  vec3 iCenter = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec2 rel = iCenter.xz - uCutCenter.xz;
  float ahead = dot(rel, uCutDir.xz);
  float side = abs(dot(rel, vec2(-uCutDir.z, uCutDir.x)));
  float k = smoothstep(-1.3, -0.2, ahead) * (1.0 - smoothstep(6.0, 9.0, side)) * (1.0 - smoothstep(9.0, 13.0, ahead));
  k *= step(abs(iCenter.y - uCutCenter.y), 2.0);
  transformed.y = mix(transformed.y, min(transformed.y, uCutHeight), k);
}`
    : ''
}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying float vFog;
${glow ? 'varying vec3 vGlow;' : ''}
${floor ? 'varying float vMat; varying vec2 vLocal; varying vec3 vWorld; varying float vUp;' : ''}
uniform float uLitFloor;
uniform float uExplored;
uniform float uTime;`,
      )
      .replace('#include <color_fragment>', `#include <color_fragment>\n${floor ? FLOOR_FRAG : ''}`)
      .replace(
        '#include <opaque_fragment>',
        `if (vFog < 0.25) discard;
${glow ? 'vec3 baked = diffuseColor.rgb * vGlow;' : 'vec3 baked = vec3(0.0);'}
if (vFog < 0.45) {
  // Seen down a pit: flat, cool and dim, but readable; fixed lights still glow.
  outgoingLight = outgoingLight * 0.5 + diffuseColor.rgb * 0.30 * vec3(0.78, 0.82, 1.0) + baked * 0.8;
} else if (vFog < 0.6) {
  float l = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  outgoingLight = mix(vec3(l), diffuseColor.rgb, 0.25) * uExplored + baked * 0.12 + vec3(0.004, 0.006, 0.012);
} else if (vFog < 0.9) {
  outgoingLight += diffuseColor.rgb * uLitFloor * 0.25 + baked * 0.85;
} else {
  outgoingLight += diffuseColor.rgb * uLitFloor + baked;
}
#include <opaque_fragment>`,
      );
  };
  m.customProgramCacheKey = () => `fog-${instanced ? 'i' : 'u'}${cut ? '-cut' : ''}${glow ? '-glow' : ''}${floor ? '-floor' : ''}`;
  return m;
}

/** Set the fog value on a plain mesh's fog material (clone-per-mesh materials). */
export function setMaterialFog(m: THREE.Material | THREE.Material[], value: number): void {
  const list = Array.isArray(m) ? m : [m];
  for (const mat of list) {
    const f = (mat as FogMaterial).userData?.fog;
    if (f) f.value = value;
  }
}

/** Make an `aFog` instance attribute for an InstancedMesh. */
export function addFogAttribute(mesh: THREE.InstancedMesh, count: number): THREE.InstancedBufferAttribute {
  const attr = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
  attr.setUsage(THREE.DynamicDrawUsage);
  mesh.geometry.setAttribute('aFog', attr);
  return attr;
}
