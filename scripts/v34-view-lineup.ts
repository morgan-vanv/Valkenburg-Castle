// V3.4 view: a lineup scene of the humanoid models, loaded in the browser through the Vite dev
// server by scripts/v34-view-figures.mjs. Not part of the game build.

import * as THREE from 'three';
import { getModel, makeFigure, type ModelKey } from '../src/view/figures';
import { FIGURE_SCALE, HERO_SCALE } from '../src/view/unit';

export function lineup(): void {
  document.body.innerHTML = '';
  const r = new THREE.WebGLRenderer({ antialias: true });
  r.setSize(innerWidth, innerHeight);
  document.body.appendChild(r.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1612);
  scene.add(new THREE.AmbientLight(0x8a8090, 1.1));
  const sun = new THREE.DirectionalLight(0xffd8a8, 2.2);
  sun.position.set(-3, 6, 5);
  scene.add(sun);
  const keys: ModelKey[] = ['heir', 'sellsword', 'burglar', 'ranger', 'sapper', 'pyromancer', 'shadowmancer', 'hedgewitch', 'sister', 'orc', 'archer', 'captain', 'ghoul', 'berserker'];
  const n = keys.length;
  keys.forEach((key, i) => {
    const m = getModel(key);
    const g = makeFigure(m, { body: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), glow: new THREE.MeshBasicMaterial({ vertexColors: true }) });
    g.scale.setScalar(FIGURE_SCALE[key] ?? HERO_SCALE);
    // Alternate three-quarter front and three-quarter back, so packs and capes show too.
    g.rotation.y = i % 2 ? Math.PI * 0.8 : 0.45;
    g.position.set((i - (n - 1) / 2) * 1.25, 0, 0);
    scene.add(g);
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 6), new THREE.MeshLambertMaterial({ color: 0x3a342c }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const cam = new THREE.PerspectiveCamera(22, innerWidth / innerHeight, 0.1, 200);
  cam.position.set(0, 4.2, 23);
  cam.lookAt(0, 1.1, 0);
  r.render(scene, cam);
}
