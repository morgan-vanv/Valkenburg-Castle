// Canvas-texture helpers for glyph sprites ("?" contact markers and the like).

import * as THREE from 'three';

const cache = new Map<string, THREE.Texture>();

export function glyphTexture(text: string, color = '#ff1f2d', font = 'bold 96px Georgia, serif'): THREE.Texture {
  const key = `${text}|${color}|${font}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 10;
  g.strokeStyle = 'rgba(0,0,0,0.85)';
  g.strokeText(text, 64, 70);
  g.fillStyle = color;
  g.fillText(text, 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}

export function glyphSprite(text: string, color?: string, size = 0.5): THREE.Sprite {
  const m = new THREE.SpriteMaterial({ map: glyphTexture(text, color), transparent: true, depthTest: false, depthWrite: false });
  const s = new THREE.Sprite(m);
  s.scale.setScalar(size);
  s.renderOrder = 10;
  return s;
}

/** A soft radial glow, for flashes and embers. */
export function glowTexture(): THREE.Texture {
  const key = '__glow';
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  cache.set(key, t);
  return t;
}
