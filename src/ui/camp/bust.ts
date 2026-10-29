// V5.1 (W0): hero busts for the camp. Each class is rendered ONCE from the V5 joint rig (src/view/look/cast.ts,
// the same figures the delve uses) with a small offscreen three.js renderer, framed on the head and shoulders,
// and kept in memory as a PNG data URL. The camp never runs live 3D. Where WebGL is missing (or fails), the bust
// falls back to the CSS figurine head from camp.css (.bust .sh/.hd/.ht), so a bust always shows.

import * as THREE from 'three';
import { makeRigFigure } from '../../view/look/cast';
import { rigMaterials } from '../../view/look/keven';
import type { ModelKey } from '../../view/figures';

/** camp.css's short class keys (.bust.k-*, .abil.k-*, --k-*). */
const CSS_KEY: Record<string, string> = {
  heir: 'heir', sellsword: 'sellsword', burglar: 'burglar', ranger: 'ranger', sapper: 'sapper',
  pyromancer: 'pyro', shadowmancer: 'shadow', hedgewitch: 'witch', mage: 'pyro',
};
/** The camp.css key for a hero class ('pyromancer' → 'pyro'). */
export const bustKey = (cls: string): string => CSS_KEY[cls] ?? 'heir';

/** Pixel size of the cached image (square). Busts show at 64 to 180 CSS px on a 1920 stage that may scale 1.33x. */
export const BUST_PX = 256;

const cache = new Map<string, string | null>();
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

function render(cls: string): string | null {
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
    const url = r.domElement.toDataURL('image/png');
    for (const m of Object.values(mats)) m.dispose();
    fig.dispose();
    return url && url.length > 200 ? url : null;
  } catch {
    return null;
  } finally {
    scheduleDispose();
  }
}

/** The cached bust image for a class, rendering it the first time. Null when WebGL is unavailable. */
export function bustUrl(cls: string): string | null {
  if (!cache.has(cls)) cache.set(cls, render(cls));
  return cache.get(cls) ?? null;
}

/** Render a set of classes ahead of time (e.g. when the camp opens), one per frame so nothing stalls. */
export function preloadBusts(classes: readonly string[]): void {
  const todo = classes.filter((c) => !cache.has(c));
  const step = () => {
    const c = todo.shift();
    if (!c) return;
    bustUrl(c);
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/**
 * A bust: `<div class="bust k-<key> [sm|lg]">` holding the rendered image, or the CSS figurine parts as a
 * fallback. `size` is 'sm' (64px), 'md' (120px, default) or 'lg' (180px), or a number of CSS px.
 */
export function bust(cls: string, opts: { size?: 'sm' | 'md' | 'lg' | number; label?: string } = {}): HTMLElement {
  const el = document.createElement('div');
  const size = opts.size ?? 'md';
  el.className = `bust k-${bustKey(cls)}${typeof size === 'string' && size !== 'md' ? ` ${size}` : ''}`;
  if (typeof size === 'number') el.style.setProperty('--bs', `${size}px`);
  el.dataset.cls = cls;
  if (opts.label) {
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', opts.label);
  } else el.setAttribute('aria-hidden', 'true');
  for (const part of ['sh', 'hd', 'ht']) {
    const i = document.createElement('i');
    i.className = part;
    el.append(i);
  }
  const url = bustUrl(cls);
  if (url) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.draggable = false;
    el.append(img);
    el.classList.add('img');
  }
  return el;
}
