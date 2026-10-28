// V5.0 (G): the post chain and the sharp overlay pass.
//
// World (scene) → rtWorld (half float, with a depth texture) → composer: bloom → FXAA → tilt-shift
// (two separable 5-tap passes at 2.2, two at 1.0) → OutputPass (ACES + sRGB) → grade (warm multiply and
// a soft vignette) → composite, which lays the overlay frame on top and writes to the screen.
//
// The overlay scene (markers, rings, path dots, highlights) is rendered on its own into rtOverlay, which
// shares the world's depth texture, so rings still hide behind walls but never go through the blur or
// the bloom. On 'low' quality (or when every effect is off) both scenes render straight to the canvas,
// the overlay after the world with the depth buffer kept.
//
// three r186: EffectComposer, RenderPass-free (a TexturePass takes rtWorld), UnrealBloomPass, ShaderPass,
// OutputPass, FXAAShader from the bundled addons. No new dependency.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { TexturePass } from 'three/examples/jsm/postprocessing/TexturePass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import type { QualityFeatures } from './quality';

/** The look recipe (docs/v5-graphics-plan.md): bloom 0.55 / 0.5 / 0.82, tilt 2.2 + 1.0, band 0.2 ramp 0.32, vignette to 0.72. */
export const POST = {
  exposure: 1.3,
  bloom: { strength: 0.55, radius: 0.5, threshold: 0.82 },
  tilt: { amount: 2.2, amount2: 1.0, band: 0.2, ramp: 0.32 },
  vignette: 0.72,
  warm: [1.04, 0.99, 0.94] as const,
};

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';

function tiltShader(dir: [number, number], amount: number): THREE.ShaderMaterialParameters {
  return {
    uniforms: {
      tDiffuse: { value: null },
      dir: { value: new THREE.Vector2(dir[0], dir[1]) },
      res: { value: new THREE.Vector2(1, 1) },
      amount: { value: amount },
      focusY: { value: 0.5 },
      band: { value: POST.tilt.band },
      ramp: { value: POST.tilt.ramp },
    },
    vertexShader: VERT,
    fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 dir; uniform vec2 res; uniform float amount; uniform float focusY; uniform float band; uniform float ramp; varying vec2 vUv;
void main(){
  float d = smoothstep(band, band + ramp, abs(vUv.y - focusY));
  vec2 st = dir / res * amount * d;
  vec4 c = texture2D(tDiffuse, vUv) * 0.2270270270;
  c += texture2D(tDiffuse, vUv + st * 1.3846153846) * 0.3162162162;
  c += texture2D(tDiffuse, vUv - st * 1.3846153846) * 0.3162162162;
  c += texture2D(tDiffuse, vUv + st * 3.2307692308) * 0.0702702703;
  c += texture2D(tDiffuse, vUv - st * 3.2307692308) * 0.0702702703;
  gl_FragColor = c;
}`,
  };
}

const GRADE: THREE.ShaderMaterialParameters = {
  uniforms: { tDiffuse: { value: null }, strength: { value: 1 }, vignette: { value: POST.vignette }, warm: { value: new THREE.Vector3(...POST.warm) } },
  vertexShader: VERT,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float strength; uniform float vignette; uniform vec3 warm; varying vec2 vUv;
void main(){
  vec4 c = texture2D(tDiffuse, vUv);
  vec2 p = vUv - 0.5;
  float v = smoothstep(0.85, 0.25, length(p * vec2(1.1, 1.25)));
  vec3 g = mix(c.rgb, c.rgb * warm * mix(vignette, 1.0, v), strength);
  gl_FragColor = vec4(g, c.a);
}`,
};

/** Lays the (premultiplied) overlay frame over the graded world. */
const COMPOSITE: THREE.ShaderMaterialParameters = {
  uniforms: { tDiffuse: { value: null }, tOverlay: { value: null } },
  vertexShader: VERT,
  fragmentShader: `uniform sampler2D tDiffuse; uniform sampler2D tOverlay; varying vec2 vUv;
void main(){
  vec4 c = texture2D(tDiffuse, vUv);
  vec4 o = texture2D(tOverlay, vUv);
  gl_FragColor = vec4(o.rgb + c.rgb * (1.0 - o.a), 1.0);
}`,
};

export class LookPost {
  private composer: EffectComposer;
  private depth: THREE.DepthTexture;
  private rtWorld: THREE.WebGLRenderTarget;
  private rtOverlay: THREE.WebGLRenderTarget;
  private bloom: UnrealBloomPass;
  private fxaa: ShaderPass;
  private tilts: ShaderPass[];
  private grade: ShaderPass;
  private composite: ShaderPass;
  private features: QualityFeatures = { shadows: false, bloom: false, tiltShift: false, vignette: false, pixelRatio: 1 };
  private w = 1;
  private h = 1;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.depth = new THREE.DepthTexture(1, 1);
    this.depth.format = THREE.DepthFormat;
    this.depth.type = THREE.UnsignedIntType;
    this.rtWorld = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthTexture: this.depth });
    this.rtWorld.texture.name = 'look.world';
    this.rtOverlay = new THREE.WebGLRenderTarget(1, 1, { depthTexture: this.depth });
    this.rtOverlay.texture.name = 'look.overlay';
    this.rtOverlay.texture.colorSpace = THREE.SRGBColorSpace;
    this.composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }));
    this.composer.addPass(new TexturePass(this.rtWorld.texture));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), POST.bloom.strength, POST.bloom.radius, POST.bloom.threshold);
    this.composer.addPass(this.bloom);
    this.fxaa = new ShaderPass(FXAAShader);
    this.composer.addPass(this.fxaa);
    this.tilts = [tiltShader([1, 0], POST.tilt.amount), tiltShader([0, 1], POST.tilt.amount), tiltShader([1, 0], POST.tilt.amount2), tiltShader([0, 1], POST.tilt.amount2)].map((s) => new ShaderPass(new THREE.ShaderMaterial(s)));
    for (const t of this.tilts) this.composer.addPass(t);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(new THREE.ShaderMaterial(GRADE));
    this.composer.addPass(this.grade);
    this.composite = new ShaderPass(new THREE.ShaderMaterial(COMPOSITE));
    this.composite.uniforms.tOverlay!.value = this.rtOverlay.texture;
    this.composer.addPass(this.composite);
  }

  setFeatures(f: QualityFeatures): void {
    this.features = f;
    this.bloom.enabled = f.bloom;
    for (const t of this.tilts) t.enabled = f.tiltShift;
    this.grade.uniforms.strength!.value = f.vignette ? 1 : 0;
    this.renderer.setPixelRatio(f.pixelRatio);
    this.setSize(this.w, this.h);
  }

  /** Does the frame go through the chain at all? Off: straight to the canvas. */
  get active(): boolean {
    const f = this.features;
    return f.bloom || f.tiltShift || f.vignette;
  }

  setSize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    const pr = this.renderer.getPixelRatio();
    const W = Math.max(1, Math.round(w * pr));
    const H = Math.max(1, Math.round(h * pr));
    this.rtWorld.setSize(W, H);
    this.rtOverlay.setSize(W, H);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    for (const t of this.tilts) (t.uniforms.res!.value as THREE.Vector2).set(W, H);
    (this.fxaa.uniforms.resolution!.value as THREE.Vector2).set(1 / W, 1 / H);
  }

  /** Render one frame: the world through the chain (or straight), then the overlay sharp on top. */
  render(scene: THREE.Scene, overlay: THREE.Scene, camera: THREE.Camera): void {
    const r = this.renderer;
    if (!this.active) {
      r.setRenderTarget(null);
      r.render(scene, camera);
      r.autoClear = false;
      r.render(overlay, camera);
      r.autoClear = true;
      return;
    }
    r.setRenderTarget(this.rtWorld);
    r.render(scene, camera);
    // The overlay shares the world's depth: clear its colour only.
    r.setRenderTarget(this.rtOverlay);
    r.setClearColor(0x000000, 0);
    r.clear(true, false, false);
    r.autoClear = false;
    r.render(overlay, camera);
    r.autoClear = true;
    r.setRenderTarget(null);
    this.composer.render();
  }

  dispose(): void {
    this.rtWorld.dispose();
    this.rtOverlay.dispose();
    this.depth.dispose();
    this.composer.dispose();
  }
}
