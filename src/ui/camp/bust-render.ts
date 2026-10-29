// V5.1.1: the live hero-bust render, from the V5 joint rig (src/view/look/cast.ts, the same figures the delve uses),
// framed on the head and shoulders with a small offscreen three.js renderer. The camp no longer calls this for the
// usual classes: scripts/v511-bake-busts.mjs runs it once per class in headless Chromium and saves the result to
// public/busts/<cls>.webp. bust.ts only loads this module (lazily) for a class without a baked image.
// Changing anything here (or in cast.ts, keven.ts, rig.ts) changes the hash in public/busts/manifest.json, and
// src/ui/camp/busts.test.ts fails until the busts are baked again.

import * as THREE from 'three';
import { makeRigFigure } from '../../view/look/cast';
import { rigMaterials } from '../../view/look/keven';
import type { ModelKey } from '../../view/figures';

/** Pixel size of the image (square). Busts show at 58 to 196 CSS px on a 1920 stage that may scale 1.33x. */
export const BUST_PX = 256;

let renderer: THREE.WebGLRenderer | null = null;
let broken = false;
let disposeTimer: ReturnType<typeof setTimeout> | null = null;

function getRenderer(): THREE.WebGLRenderer | null {
  if (broken) return null;
  if (renderer) return renderer;
  try {
    const canvas = document.createElement('canvas');
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(BUST_PX, BUST_PX, false);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    return renderer;
  } catch {
    broken = true;
    return null;
  }
}

/** Free the offscreen context a moment after the last bust is drawn (the delve has its own renderer). */
function scheduleDispose(): void {
  if (disposeTimer) clearTimeout(disposeTimer);
  disposeTimer = setTimeout(() => {
    renderer?.dispose();
    renderer?.forceContextLoss();
    renderer = null;
    disposeTimer = null;
  }, 1500);
}

/**
 * Render one class's bust and return it as a data URL (`type` 'image/png' for the live fallback, 'image/webp' for
 * the bake). Null when WebGL is unavailable or the class has no rig figure.
 */
export function renderBust(cls: string, type = 'image/png', quality?: number): string | null {
  const r = getRenderer();
  if (!r) return null;
  const mats = rigMaterials();
  const fig = makeRigFigure(cls as ModelKey, mats);
  if (!fig) return null;
  try {
    fig.update(0, 0); // the rest pose, idle at t = 0
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffe2b8, 0x2a1a10, 1.3));
    const key = new THREE.DirectionalLight(0xffc98a, 2.6); // the camp's lamp, high and to the left
    key.position.set(-2, 3, 3);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xff9a4a, 1.4);
    rim.position.set(2.5, 1.5, -2.5);
    scene.add(rim);
    fig.object.rotation.y = 0.42; // three-quarter, like a figurine turned to the light
    scene.add(fig.object);
    const H = fig.height;
    const cam = new THREE.PerspectiveCamera(24, 1, 0.05, 20);
    const look = new THREE.Vector3(0, H * 0.79, 0);
    cam.position.set(0.15, H * 0.84, H * 1.75);
    cam.lookAt(look);
    r.render(scene, cam);
    const url = r.domElement.toDataURL(type, quality);
    for (const m of Object.values(mats)) m.dispose();
    fig.dispose();
    return url && url.length > 200 ? url : null;
  } catch {
    return null;
  } finally {
    scheduleDispose();
  }
}
