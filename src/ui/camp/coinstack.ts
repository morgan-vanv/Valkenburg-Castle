// V5.1 (W0): the purse's coin stack. Columns of coins whose number and height grow with the gold (roughly
// logarithmic, so 25 gold is one short column and a few thousand is six tall ones). setGold() animates the change:
// a coin drops onto the stack when gold comes in, lifts off when it goes out. Looks live in camp.css (.coinstack).

/** Column heights (px) for an amount of gold: 0 columns at 0, up to 6 columns of at most 96px. Pure, for tests. */
export function coinColumns(goldAmount: number): number[] {
  const g = Math.max(0, Math.floor(goldAmount));
  if (g <= 0) return [];
  // Total coin height grows with log2: 25 gold → one 20px column, 340 → five (~40px tallest), 2400 → six (~96px).
  const total = Math.min(420, Math.round(8 * Math.pow(Math.log2(1 + g / 12), 1.9)));
  const cols = Math.max(1, Math.min(6, Math.ceil(total / 38)));
  const shape = [0.62, 1, 0.82, 0.9, 0.7, 0.86]; // uneven, like stacks pushed together by hand
  const sum = shape.slice(0, cols).reduce((a, b) => a + b, 0);
  return shape.slice(0, cols).map((w) => Math.max(6, Math.min(96, Math.round((total * w) / sum / 2) * 2)));
}

export interface CoinStack {
  readonly el: HTMLElement;
  /** Show a new amount; animates if it changed (unless `instant`). */
  setGold(goldAmount: number, instant?: boolean): void;
}

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function coinStack(goldAmount: number): CoinStack {
  const el = document.createElement('span');
  el.className = 'coinstack';
  el.setAttribute('aria-hidden', 'true');
  el.style.position = 'relative';
  let current = goldAmount;
  const draw = (g: number) => {
    const hs = coinColumns(g);
    while (el.querySelectorAll(':scope > i:not(.fly)').length > hs.length) el.querySelector(':scope > i:not(.fly)')!.remove();
    while (el.querySelectorAll(':scope > i:not(.fly)').length < hs.length) el.append(document.createElement('i'));
    el.querySelectorAll<HTMLElement>(':scope > i:not(.fly)').forEach((c, i) => c.style.setProperty('--h', `${hs[i]}px`));
  };
  draw(current);
  return {
    el,
    setGold(next: number, instant = false) {
      if (next === current) return;
      const up = next > current;
      current = next;
      draw(next);
      if (instant || reduced()) return;
      el.classList.remove('earn', 'spend');
      void el.offsetWidth; // restart the animation
      el.classList.add(up ? 'earn' : 'spend');
      const cols = el.querySelectorAll<HTMLElement>(':scope > i:not(.fly)');
      const top = cols[cols.length - 1];
      const fly = document.createElement('i');
      fly.className = `fly ${up ? 'in' : 'out'}`;
      fly.style.left = `${top ? top.offsetLeft : 0}px`;
      fly.style.bottom = `${6 + (top ? top.offsetHeight : 0)}px`;
      el.append(fly);
      setTimeout(() => {
        fly.remove();
        el.classList.remove('earn', 'spend');
      }, 550);
    },
  };
}
