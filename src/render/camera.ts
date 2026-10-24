// Tilted three-quarter camera: orbit (right drag, Q/E), pan (middle drag,
// WASD/arrows), zoom (wheel), smooth follow. Written by hand, no OrbitControls.

import * as THREE from 'three';

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  /** Desired values; current values ease toward them. */
  target = new THREE.Vector3();
  yaw = -0.5;
  pitch = 0.95;
  distance = 20;
  private cur = { target: new THREE.Vector3(), yaw: -0.5, pitch: 0.95, distance: 20 };
  private keys = new Set<string>();
  private drag: { button: number; x: number; y: number } | null = null;
  /** Limits for the target, set from the shown level's bounds. */
  bounds = new THREE.Box3(new THREE.Vector3(-100, -100, -100), new THREE.Vector3(100, 100, 100));
  shake = 0;
  private shakeOffset = new THREE.Vector3();
  /** True if the last pointer gesture moved enough to count as a drag. */
  dragged = false;
  enabled = true;

  constructor(dom: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('pointerdown', (e) => {
      if (e.button === 1 || e.button === 2) {
        this.drag = { button: e.button, x: e.clientX, y: e.clientY };
        this.dragged = false;
        dom.setPointerCapture(e.pointerId);
        e.preventDefault();
      }
    });
    dom.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 2) this.dragged = true;
      if (this.drag.button === 2 && !e.shiftKey) {
        this.yaw -= dx * 0.006;
        this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.004, 0.45, 1.45);
      } else {
        this.panScreen(-dx, -dy);
      }
    });
    const end = (e: PointerEvent) => {
      if (this.drag && (e.button === this.drag.button || e.type === 'pointercancel')) this.drag = null;
    };
    dom.addEventListener('pointerup', end);
    dom.addEventListener('pointercancel', end);
    dom.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const f = Math.exp(Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 120) * 0.0015);
        this.distance = THREE.MathUtils.clamp(this.distance * f, 6, 64);
      },
      { passive: false },
    );
    addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      this.keys.add(e.key.toLowerCase());
    });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  private panScreen(dx: number, dy: number): void {
    const scale = this.distance * 0.0016;
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
    this.target.addScaledVector(right, -dx * scale).addScaledVector(fwd, -dy * scale * 1.3);
    this.clampTarget();
  }

  private clampTarget(): void {
    this.target.x = THREE.MathUtils.clamp(this.target.x, this.bounds.min.x, this.bounds.max.x);
    this.target.z = THREE.MathUtils.clamp(this.target.z, this.bounds.min.z, this.bounds.max.z);
  }

  /** Smoothly look at a point. */
  focus(p: THREE.Vector3, instant = false): void {
    this.target.copy(p);
    this.clampTarget();
    if (instant) this.cur.target.copy(this.target);
  }

  /** Jump the vertical target (level change) and optionally snap. */
  setHeight(y: number, instant = false): void {
    this.target.y = y;
    if (instant) this.cur.target.y = y;
  }

  update(dt: number, time: number): void {
    if (this.enabled) {
      const k = this.keys;
      const pan = 9 * dt * (this.distance / 13);
      const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
      // Camera looks along -fwd (it sits at target + fwd * distance).
      if (k.has('w') || k.has('arrowup')) this.target.addScaledVector(fwd, -pan);
      if (k.has('s') || k.has('arrowdown')) this.target.addScaledVector(fwd, pan);
      if (k.has('a') || k.has('arrowleft')) this.target.addScaledVector(right, -pan);
      if (k.has('d') || k.has('arrowright')) this.target.addScaledVector(right, pan);
      if (k.has('q')) this.yaw += 1.8 * dt;
      if (k.has('e')) this.yaw -= 1.8 * dt;
      this.clampTarget();
    }
    const a = 1 - Math.exp(-dt * 8);
    this.cur.target.lerp(this.target, a);
    this.cur.yaw += (this.yaw - this.cur.yaw) * a;
    this.cur.pitch += (this.pitch - this.cur.pitch) * a;
    this.cur.distance += (this.distance - this.cur.distance) * a;

    const { target, yaw, pitch, distance } = this.cur;
    const off = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(distance);
    this.camera.position.copy(target).add(off);
    this.camera.lookAt(target);
    if (this.shake > 0.001) {
      const s = this.shake;
      this.shakeOffset.set(Math.sin(time * 61) * s, Math.sin(time * 47 + 1) * s * 0.7, Math.sin(time * 53 + 2) * s);
      this.camera.position.add(this.shakeOffset);
      this.shake *= Math.exp(-dt * 9);
    } else this.shake = 0;
  }

  addShake(amount: number): void {
    this.shake = Math.min(0.6, this.shake + amount);
  }
}

export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}
