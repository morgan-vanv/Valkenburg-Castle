// V5.0 (G): the fill light and the point-light recipe, in physical light units (three r155+).
//
// From the Scale Lab (mockup/v5/scale-lab.html): ambient 0x5a4f78 at 1.0, hemisphere sky 0xa89ad0 /
// ground 0x3a2418 at 1.7, a warm key 0xffd6a8 at 1.6 from the camera's side. Point lights: torches ~9,
// braziers ~14, lanterns ~11, candles ~3; decay 1.4, distance 5..10. One shadow-casting light at most
// (512 map, PCF, bias −0.004), moved to the strongest source near the camera target.

import * as THREE from 'three';

export const FILL = {
  ambient: { color: 0x5a4f78, intensity: 1.0 },
  hemi: { sky: 0xa89ad0, ground: 0x3a2418, intensity: 1.7 },
  key: { color: 0xffd6a8, intensity: 1.6 },
  background: 0x0c0810,
  haze: { color: 0x1a1020, density: 0.032 },
};

export type SourceKind = 'torch' | 'lantern' | 'crew' | 'arrow' | 'brazier' | 'sconce' | 'daylight' | 'fire' | 'fungus' | 'glow' | 'candle';

/** Intensity (candela) and decay per source kind. */
export const POINT: Record<SourceKind, { intensity: number; decay: number }> = {
  torch: { intensity: 9, decay: 1.4 },
  lantern: { intensity: 11, decay: 1.4 },
  crew: { intensity: 6, decay: 1.4 },
  arrow: { intensity: 5, decay: 1.4 },
  brazier: { intensity: 14, decay: 1.4 },
  sconce: { intensity: 7, decay: 1.4 },
  daylight: { intensity: 5, decay: 1.2 },
  fire: { intensity: 12, decay: 1.4 },
  fungus: { intensity: 4, decay: 1.4 },
  glow: { intensity: 4, decay: 1.4 },
  candle: { intensity: 3, decay: 1.4 },
};

export const SHADOW = { mapSize: 512, bias: -0.004, radius: 3 };

export function makeFill(): { ambient: THREE.AmbientLight; hemi: THREE.HemisphereLight; key: THREE.DirectionalLight } {
  const ambient = new THREE.AmbientLight(FILL.ambient.color, FILL.ambient.intensity);
  const hemi = new THREE.HemisphereLight(FILL.hemi.sky, FILL.hemi.ground, FILL.hemi.intensity);
  const key = new THREE.DirectionalLight(FILL.key.color, FILL.key.intensity);
  key.position.set(6, 14, 16);
  return { ambient, hemi, key };
}

/** Keep the key light on the camera's side of the focus, so faces toward the player are lit. */
export function placeKey(key: THREE.DirectionalLight, camera: THREE.Camera, target: THREE.Vector3): void {
  const d = new THREE.Vector3(camera.position.x - target.x, 0, camera.position.z - target.z);
  if (d.lengthSq() < 1e-6) d.set(0, 0, 1);
  d.normalize();
  key.target.position.copy(target);
  key.position.set(target.x + d.x * 9 - d.z * 5, target.y + 14, target.z + d.z * 9 + d.x * 5);
}

export function setupShadowLight(l: THREE.PointLight): void {
  l.castShadow = true;
  l.shadow.mapSize.set(SHADOW.mapSize, SHADOW.mapSize);
  l.shadow.bias = SHADOW.bias;
  l.shadow.radius = SHADOW.radius;
  l.shadow.camera.near = 0.1;
  l.shadow.camera.far = 14;
}
