// A tiny animation clock: tweens that resolve promises, a global speed
// setting and hit-stop (a brief freeze of game time on impacts).

export interface Tween {
  /** Seconds of game time. */
  duration: number;
  elapsed: number;
  update: (t: number) => void;
  resolve: () => void;
}

export class AnimClock {
  /** Playback speed multiplier (settings: 0.5 slow .. 3 fast). */
  speed = 1;
  private tweens: Tween[] = [];
  private frozenUntil = 0;
  private waits: { at: number; resolve: () => void }[] = [];
  /** Game time in seconds (stops during hit-stop). */
  time = 0;
  /** Wall time in seconds. */
  real = 0;

  tick(dtReal: number): number {
    this.real += dtReal;
    const frozen = this.real < this.frozenUntil;
    const dt = frozen ? 0 : dtReal * this.speed;
    this.time += dt;
    if (dt > 0 && this.tweens.length) {
      const done: Tween[] = [];
      for (const tw of this.tweens) {
        tw.elapsed += dt;
        const t = Math.min(1, tw.elapsed / tw.duration);
        tw.update(t);
        if (t >= 1) done.push(tw);
      }
      if (done.length) {
        this.tweens = this.tweens.filter((t) => !done.includes(t));
        for (const d of done) d.resolve();
      }
    }
    if (this.waits.length) {
      const ready = this.waits.filter((w) => w.at <= this.time);
      if (ready.length) {
        this.waits = this.waits.filter((w) => w.at > this.time);
        for (const w of ready) w.resolve();
      }
    }
    return dt;
  }

  /** Run `update(t)` for t in 0..1 over `seconds` of game time. */
  tween(seconds: number, update: (t: number) => void): Promise<void> {
    if (seconds <= 0) {
      update(1);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      update(0);
      this.tweens.push({ duration: seconds, elapsed: 0, update, resolve });
    });
  }

  /** Wait `seconds` of game time. */
  wait(seconds: number): Promise<void> {
    if (seconds <= 0) return Promise.resolve();
    return new Promise((resolve) => this.waits.push({ at: this.time + seconds, resolve }));
  }

  /** Freeze game time for `ms` of wall time. */
  hitStop(ms: number): void {
    this.frozenUntil = Math.max(this.frozenUntil, this.real + ms / 1000);
  }

  /** Finish every running tween at once (used when skipping playback). */
  flush(): void {
    const all = this.tweens;
    this.tweens = [];
    for (const tw of all) {
      tw.update(1);
      tw.resolve();
    }
    const waits = this.waits;
    this.waits = [];
    for (const w of waits) w.resolve();
  }
}
