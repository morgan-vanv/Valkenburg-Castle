// WebAudio-synthesized effects. No audio files. The context starts on the
// first user gesture; mute is remembered in localStorage.

type Sfx =
  | 'step'
  | 'creak'
  | 'slam'
  | 'pick'
  | 'smash'
  | 'chop'
  | 'sword'
  | 'arrow'
  | 'death'
  | 'dice'
  | 'flip'
  | 'perfect'
  | 'horn'
  | 'coin'
  | 'explosion'
  | 'click'
  | 'error'
  | 'spell'
  | 'miss';

const MUTE_KEY = 'vc.muted';

class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  muted = false;
  private lastStep = 0;

  constructor() {
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      /* storage blocked */
    }
    const start = () => {
      this.ensure();
      removeEventListener('pointerdown', start, true);
      removeEventListener('keydown', start, true);
    };
    addEventListener('pointerdown', start, true);
    addEventListener('keydown', start, true);
  }

  private ensure(): AudioContext | null {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 1.5;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let seed = 1980;
    for (let i = 0; i < len; i++) {
      seed = (seed * 16807) % 2147483647;
      d[i] = (seed / 2147483647) * 2 - 1;
    }
    return this.ctx;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    try {
      localStorage.setItem(MUTE_KEY, m ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.02);
  }

  // ------------------------------------------------------------ building blocks

  private env(g: GainNode, t: number, a: number, peak: number, d: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  private tone(type: OscillatorType, f0: number, f1: number, t: number, dur: number, peak: number, attack = 0.005, dest?: AudioNode): void {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = c.createGain();
    this.env(g, t, attack, peak, dur);
    o.connect(g).connect(dest ?? this.master!);
    o.start(t);
    o.stop(t + attack + dur + 0.05);
  }

  private hiss(t: number, dur: number, peak: number, filter: BiquadFilterType, f0: number, f1 = f0, q = 1, attack = 0.003): void {
    const c = this.ctx!;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    const f = c.createBiquadFilter();
    f.type = filter;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    this.env(g, t, attack, peak, dur);
    s.connect(f).connect(g).connect(this.master!);
    s.start(t, Math.random());
    s.stop(t + attack + dur + 0.05);
  }

  // ------------------------------------------------------------ effects

  play(name: Sfx, opts: { pitch?: number; gain?: number } = {}): void {
    if (this.muted) return;
    const c = this.ensure();
    if (!c || !this.master) return;
    const t = c.currentTime + 0.005;
    const p = opts.pitch ?? 1;
    const v = opts.gain ?? 1;
    switch (name) {
      case 'step': {
        if (t - this.lastStep < 0.06) return;
        this.lastStep = t;
        const r = 0.85 + Math.random() * 0.3;
        this.hiss(t, 0.07, 0.22 * v, 'lowpass', 900 * r * p, 200, 1.2);
        this.tone('sine', 110 * r * p, 60, t, 0.06, 0.18 * v);
        break;
      }
      case 'creak': {
        const c2 = this.ctx!;
        const o = c2.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(180 * p, t);
        o.frequency.linearRampToValueAtTime(260 * p, t + 0.18);
        o.frequency.linearRampToValueAtTime(150 * p, t + 0.42);
        const lfo = c2.createOscillator();
        lfo.frequency.value = 32;
        const lg = c2.createGain();
        lg.gain.value = 30;
        lfo.connect(lg).connect(o.frequency);
        const f = c2.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 900;
        f.Q.value = 6;
        const g = c2.createGain();
        this.env(g, t, 0.04, 0.14 * v, 0.42);
        o.connect(f).connect(g).connect(this.master);
        o.start(t);
        lfo.start(t);
        o.stop(t + 0.5);
        lfo.stop(t + 0.5);
        break;
      }
      case 'slam':
        this.tone('sine', 120 * p, 40, t, 0.25, 0.5 * v);
        this.hiss(t, 0.18, 0.35 * v, 'lowpass', 1400, 200, 0.8);
        break;
      case 'pick':
        for (let i = 0; i < 4; i++) {
          const tt = t + i * 0.09 + Math.random() * 0.03;
          this.tone('square', 2400 + Math.random() * 900, 1800, tt, 0.018, 0.06 * v, 0.001);
          this.hiss(tt, 0.02, 0.08 * v, 'highpass', 4000, 4000, 1, 0.001);
        }
        break;
      case 'smash':
        this.tone('sine', 85 * p, 32, t, 0.35, 0.8 * v);
        this.hiss(t, 0.3, 0.5 * v, 'lowpass', 2200, 140, 0.7);
        this.hiss(t + 0.02, 0.12, 0.25 * v, 'bandpass', 600, 300, 2);
        break;
      case 'chop':
        this.tone('triangle', 220 * p, 90, t, 0.12, 0.4 * v);
        this.hiss(t, 0.1, 0.4 * v, 'bandpass', 1800, 700, 1.5);
        break;
      case 'sword': {
        this.hiss(t, 0.08, 0.3 * v, 'highpass', 2500, 5000, 0.8);
        const base = (1400 + Math.random() * 300) * p;
        this.tone('square', base, base * 0.98, t + 0.03, 0.22, 0.05 * v);
        this.tone('sine', base * 1.47, base * 1.45, t + 0.03, 0.3, 0.08 * v);
        this.tone('sine', 140, 60, t + 0.03, 0.12, 0.35 * v);
        break;
      }
      case 'arrow':
        this.hiss(t, 0.2, 0.25 * v, 'bandpass', 3500, 900, 3, 0.02);
        this.tone('sine', 180, 90, t + 0.2, 0.05, 0.2 * v);
        break;
      case 'miss':
        this.hiss(t, 0.12, 0.18 * v, 'bandpass', 1200, 2600, 2, 0.01);
        break;
      case 'death':
        this.tone('sawtooth', 220 * p, 70, t, 0.45, 0.16 * v, 0.02);
        this.tone('sine', 90, 40, t + 0.2, 0.3, 0.4 * v);
        this.hiss(t + 0.22, 0.2, 0.3 * v, 'lowpass', 800, 150, 1);
        break;
      case 'dice':
        for (let i = 0; i < 6; i++) {
          const tt = t + i * 0.045 + Math.random() * 0.02;
          this.tone('triangle', 900 + Math.random() * 800, 600, tt, 0.03, 0.08 * v, 0.001);
        }
        break;
      case 'flip':
        this.tone('triangle', 700 * p, 500 * p, t, 0.05, 0.12 * v, 0.001);
        this.hiss(t, 0.03, 0.08 * v, 'highpass', 3000, 3000, 1, 0.001);
        break;
      case 'perfect': {
        // A hard, bright sting: stacked fifths falling in.
        const notes = [523.25, 783.99, 1046.5];
        notes.forEach((n, i) => this.tone('sawtooth', n * 1.02, n, t + i * 0.04, 0.5, 0.09 * v, 0.004));
        this.tone('sine', 65, 40, t, 0.5, 0.6 * v);
        this.hiss(t, 0.3, 0.2 * v, 'highpass', 6000, 3000, 0.7);
        break;
      }
      case 'horn': {
        const c2 = this.ctx!;
        const g = c2.createGain();
        this.env(g, t, 0.15, 0.22 * v, 1.2);
        const f = c2.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.setValueAtTime(400, t);
        f.frequency.linearRampToValueAtTime(1400, t + 0.3);
        f.frequency.linearRampToValueAtTime(600, t + 1.3);
        f.connect(g).connect(this.master);
        for (const [fr, det] of [
          [110 * p, 0],
          [110 * p, 7],
          [165 * p, -5],
        ] as const) {
          const o = c2.createOscillator();
          o.type = 'sawtooth';
          o.frequency.setValueAtTime(fr * 0.94, t);
          o.frequency.linearRampToValueAtTime(fr, t + 0.2);
          o.detune.value = det;
          o.connect(f);
          o.start(t);
          o.stop(t + 1.5);
        }
        break;
      }
      case 'coin':
        this.tone('square', 1318 * p, 1318 * p, t, 0.06, 0.06 * v, 0.001);
        this.tone('square', 1760 * p, 1760 * p, t + 0.07, 0.25, 0.06 * v, 0.001);
        break;
      case 'explosion':
        this.tone('sine', 70, 25, t, 1.0, 1.0 * v, 0.005);
        this.hiss(t, 1.2, 0.9 * v, 'lowpass', 3000, 80, 0.5, 0.005);
        this.hiss(t, 0.15, 0.6 * v, 'highpass', 2000, 800, 0.5, 0.001);
        break;
      case 'click':
        this.tone('triangle', 900, 700, t, 0.03, 0.05 * v, 0.001);
        break;
      case 'error':
        this.tone('square', 160, 120, t, 0.14, 0.08 * v, 0.003);
        break;
      case 'spell': {
        for (let i = 0; i < 5; i++) this.tone('sine', (600 + i * 220) * p, (900 + i * 300) * p, t + i * 0.03, 0.35, 0.05 * v, 0.02);
        this.hiss(t, 0.4, 0.1 * v, 'bandpass', 2000, 6000, 4, 0.05);
        break;
      }
    }
  }
}

export const sfx = new Audio();
export type { Sfx };
