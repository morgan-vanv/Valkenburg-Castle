// V4.0 HUD: three coach marks on the first delve. Each points at what to do next, goes away once
// the player has done it (or clicks "Got it") and never comes back. Remembered per browser
// (`vc.coach.v40`); the menu can switch them off or show them again.

import { h } from './dom';

export const COACH_KEY = 'vc.coach.v40';

export type CoachMark = 1 | 2 | 3;

interface Saved {
  done: CoachMark[];
  /** "Show them again" from the menu: show on the next delve whatever its number. */
  again?: boolean;
  off?: boolean;
}

function load(): Saved {
  try {
    const raw = localStorage.getItem(COACH_KEY);
    if (raw) return { done: [], ...(JSON.parse(raw) as Partial<Saved>) };
  } catch {
    /* storage blocked: start fresh */
  }
  return { done: [] };
}

export interface CoachWhere {
  /** The rectangle the arrow points at (client coordinates). */
  at: DOMRect | null;
  /** Put the mark above the target (default) or below it. */
  above?: boolean;
}

export class Coach {
  readonly el = h('div', { class: 'dl-coach hidden', role: 'note' });
  private saved: Saved = load();
  private shown: CoachMark | null = null;

  get off(): boolean {
    return !!this.saved.off;
  }

  /** Marks can show at all this delve: the first delve (or "again"), not switched off, not all done. */
  active(firstDelve: boolean): boolean {
    if (this.saved.off) return false;
    if (!firstDelve && !this.saved.again) return false;
    return this.saved.done.length < 3;
  }

  isDone(m: CoachMark): boolean {
    return this.saved.done.includes(m);
  }

  done(m: CoachMark): void {
    if (this.isDone(m)) return;
    this.saved.done.push(m);
    if (this.saved.done.length >= 3) this.saved.again = false;
    this.save();
    if (this.shown === m) this.hide();
  }

  setOff(off: boolean): void {
    this.saved.off = off;
    this.save();
    if (off) this.hide();
  }

  /** Show all three again, on the next chance (any delve). */
  reset(): void {
    this.saved = { done: [], again: true, off: false };
    this.save();
  }

  private save(): void {
    try {
      localStorage.setItem(COACH_KEY, JSON.stringify(this.saved));
    } catch {
      /* ignore */
    }
  }

  hide(): void {
    this.shown = null;
    this.el.classList.add('hidden');
  }

  /** Show mark `m` with its text, placed at `where`. */
  show(m: CoachMark, text: string, where: CoachWhere): void {
    if (this.isDone(m)) return this.hide();
    const fresh = this.shown !== m;
    this.shown = m;
    if (fresh || !this.el.childNodes.length) {
      this.el.replaceChildren(
        h('span', { class: 'dl-coach-n num' }, `${m} / 3`),
        h('span', { class: 'dl-coach-t' }, text),
        h('button', { type: 'button', class: 'dl-coach-ok', onclick: () => this.done(m) }, 'Got it'),
        h('span', { class: 'dl-coach-arrow', 'aria-hidden': 'true' }),
      );
      this.el.dataset.mark = String(m);
    } else {
      const t = this.el.querySelector('.dl-coach-t');
      if (t && t.textContent !== text) t.textContent = text;
    }
    this.el.classList.remove('hidden');
    const r = where.at;
    const w = this.el.offsetWidth || 480;
    const ht = this.el.offsetHeight || 60;
    const cx = r ? r.left + r.width / 2 : innerWidth / 2;
    const x = Math.max(12, Math.min(innerWidth - w - 12, cx - w / 2));
    const above = where.above !== false;
    const y = r ? (above ? r.top - ht - 16 : r.bottom + 16) : innerHeight / 2;
    this.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(Math.max(8, y))}px)`;
    this.el.classList.toggle('below', !above);
    const arrow = this.el.querySelector<HTMLElement>('.dl-coach-arrow');
    if (arrow) arrow.style.left = `${Math.round(Math.max(16, Math.min(w - 30, cx - x - 7)))}px`;
  }

  get current(): CoachMark | null {
    return this.shown;
  }
}
