// A flat-shaded Lambert material that knows about fog of war.
//
// Fog value per fragment: 0 = unexplored (discarded), 0.5 = explored but not
// in sight (dim, desaturated, cold, ignores lights), 0.75 = in sight but
// unlit (only point lights, no lit floor), 1 = visible and lit (lit normally
// plus a floor of warmth so lit rooms read beyond the lamps).
//
// Instanced meshes take the value from an `aFog` instance attribute. Plain
// meshes take it from the `uFog` uniform (see setMeshFog).

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
export const EXPLORED_LEVEL = 0.22;

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
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uFog = fog;
    shader.uniforms.uCutCenter = CUTAWAY.center;
    shader.uniforms.uCutDir = CUTAWAY.dir;
    shader.uniforms.uCutHeight = CUTAWAY.height;
    shader.uniforms.uLitFloor = dim;
    shader.uniforms.uExplored = { value: EXPLORED_LEVEL };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
${instanced ? 'attribute float aFog;' : 'uniform float uFog;'}
uniform vec3 uCutCenter;
uniform vec3 uCutDir;
uniform float uCutHeight;
varying float vFog;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vFog = ${instanced ? 'aFog' : 'uFog'};
${
  cut
    ? `{
  vec3 iCenter = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec2 rel = iCenter.xz - uCutCenter.xz;
  float ahead = dot(rel, uCutDir.xz);
  float side = abs(dot(rel, vec2(-uCutDir.z, uCutDir.x)));
  float k = smoothstep(-1.3, -0.2, ahead) * (1.0 - smoothstep(6.0, 9.0, side)) * (1.0 - smoothstep(9.0, 13.0, ahead));
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
uniform float uLitFloor;
uniform float uExplored;`,
      )
      .replace(
        '#include <opaque_fragment>',
        `if (vFog < 0.25) discard;
if (vFog < 0.6) {
  float l = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  outgoingLight = mix(vec3(l), diffuseColor.rgb, 0.18) * uExplored + vec3(0.004, 0.006, 0.012);
} else if (vFog < 0.9) {
  outgoingLight += diffuseColor.rgb * uLitFloor * 0.25;
} else {
  outgoingLight += diffuseColor.rgb * uLitFloor;
}
#include <opaque_fragment>`,
      );
  };
  m.customProgramCacheKey = () => `fog-${instanced ? 'i' : 'u'}${cut ? '-cut' : ''}`;
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
