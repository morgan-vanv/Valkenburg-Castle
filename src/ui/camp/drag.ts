// V5.1 (W0): drag and drop for the camp, three ways to do the same thing (Handoff: Interaction):
//   - pointer: press on a draggable, move past a few px, release over a target;
//   - click: click a draggable to pick it up, then click a target (click it again, Escape or click elsewhere to drop it back);
//   - keyboard: Enter or Space on a focused draggable lifts it, the arrow keys move between targets, Enter drops, Escape cancels.
// While something is lifted every connected target says whether it takes it: `.drop-ok` (lit amber, and the hint, such
// as a price, shows over the one under the pointer or focus) or `.drop-no` (dimmed, the reason as its tooltip via data-tip).
// UI only: onDrop is where a screen sends its command. Styles live in camp.css ([data-drag], [data-drop], .drag-ghost).

export interface DropSpec<T> {
  /** True to take the payload, or a short reason why not (shown on hover). */
  accepts: (payload: T) => true | string;
  /** `how`: the way it was carried (a keyboard drop may want to put focus somewhere that survives the re-render). */
  onDrop: (payload: T, how: Mode) => void;
  /** A short line shown over the target while a payload hovers it (e.g. the cost). */
  hint?: (payload: T) => string | undefined;
  /** V5.1.2: true when this target has nothing to do with the payload (neither lit nor dimmed; e.g. a slot while an ale is carried). */
  ignores?: (payload: T) => boolean;
}

interface Target {
  el: HTMLElement;
  spec: DropSpec<unknown>;
  /** The tabindex before a keyboard lift made it focusable (undefined: untouched). */
  tabindex: string | null | undefined;
  tip: string | undefined;
}

export type Mode = 'pointer' | 'select' | 'keyboard';
interface Lift {
  source: HTMLElement;
  payload: unknown;
  mode: Mode;
  ok: Target[];
  ghost?: HTMLElement;
  over?: Target;
  hint?: HTMLElement;
}

const targets = new Set<Target>();
let lift: Lift | null = null;
let swallowClick = false;
const THRESHOLD = 6;

/** Is something lifted right now? */
export const isDragging = (): boolean => !!lift;

/** The stage root (for the ghost and hint) and its scale (rendered px per stage px). */
function stageOf(el: HTMLElement): { root: HTMLElement; scale: number } {
  const root = el.closest<HTMLElement>('.camp') ?? document.body;
  const scale = root.offsetWidth ? root.getBoundingClientRect().width / root.offsetWidth : 1;
  return { root, scale: scale || 1 };
}
function toStage(root: HTMLElement, scale: number, x: number, y: number): [number, number] {
  const r = root.getBoundingClientRect();
  return [(x - r.left) / scale, (y - r.top) / scale];
}

function begin(source: HTMLElement, payload: unknown, mode: Mode): void {
  end(false);
  for (const t of [...targets]) if (!t.el.isConnected) targets.delete(t);
  const ok: Target[] = [];
  for (const t of targets) {
    if (t.spec.ignores?.(payload)) continue;
    const verdict = t.spec.accepts(payload);
    t.tip = t.el.dataset.tip;
    if (verdict === true) {
      t.el.classList.add('drop-ok');
      ok.push(t);
    } else {
      t.el.classList.add('drop-no');
      t.el.dataset.tip = verdict;
    }
    if (mode === 'keyboard' && verdict === true) {
      if (t.el.tabIndex < 0) {
        t.tabindex = t.el.getAttribute('tabindex');
        t.el.setAttribute('tabindex', '0');
      }
    }
  }
  source.classList.add('lifted');
  source.setAttribute('aria-pressed', 'true');
  document.getElementById('lg-tip')?.classList.add('hidden'); // V5.1.2: the source's tooltip doesn't ride along
  lift = { source, payload, mode, ok };
  document.addEventListener('click', onDocClick, true);
  document.addEventListener('keydown', onDocKey, true);
}

function end(dropped: boolean): void {
  if (!lift) return;
  const l = lift;
  lift = null;
  for (const t of targets) {
    t.el.classList.remove('drop-ok', 'drop-no', 'drop-over');
    if (t.tip === undefined) delete t.el.dataset.tip;
    else t.el.dataset.tip = t.tip;
    t.tip = undefined;
    if (t.tabindex !== undefined) {
      if (t.tabindex === null) t.el.removeAttribute('tabindex');
      else t.el.setAttribute('tabindex', t.tabindex);
    }
    t.tabindex = undefined;
  }
  l.ghost?.remove();
  l.hint?.remove();
  l.source.classList.remove('lifted');
  l.source.removeAttribute('aria-pressed');
  document.removeEventListener('click', onDocClick, true);
  document.removeEventListener('keydown', onDocKey, true);
  if (!dropped && l.mode === 'keyboard' && l.source.isConnected) l.source.focus({ preventScroll: true });
}

/** Drop what is lifted back where it came from. */
export function cancelDrag(): void {
  end(false);
}

function setOver(t: Target | undefined): void {
  if (!lift || lift.over === t) return;
  lift.over?.el.classList.remove('drop-over');
  lift.hint?.remove();
  lift.hint = undefined;
  lift.over = t;
  if (!t) return;
  t.el.classList.add('drop-over');
  const text = t.spec.hint?.(lift.payload);
  if (!text) return;
  const { root, scale } = stageOf(t.el);
  const r = t.el.getBoundingClientRect();
  const [x, y] = toStage(root, scale, r.left + r.width / 2, r.top);
  const hint = document.createElement('div');
  hint.className = 'drop-hint';
  hint.textContent = text;
  hint.style.left = `${x}px`;
  hint.style.top = `${y}px`;
  hint.style.transform = 'translate(-50%, calc(-100% - 6px))';
  root.append(hint);
  lift.hint = hint;
}

function drop(t: Target): void {
  if (!lift) return;
  const payload = lift.payload;
  const how = lift.mode;
  end(true);
  t.spec.onDrop(payload, how);
}

function targetAt(x: number, y: number): Target | undefined {
  if (!lift) return undefined;
  const hit = document.elementFromPoint(x, y);
  if (!(hit instanceof Element)) return undefined;
  return lift.ok.find((t) => t.el === hit || t.el.contains(hit));
}

function onDocClick(e: MouseEvent): void {
  if (!lift || lift.mode === 'pointer') return;
  const node = e.target instanceof Node ? e.target : null;
  if (node && lift.source.contains(node)) return; // the source's own click handler toggles
  const t = lift.ok.find((x) => node && x.el.contains(node));
  if (t) {
    e.preventDefault();
    e.stopPropagation();
    drop(t);
    return;
  }
  const no = [...targets].find((x) => node && x.el.contains(node) && x.el.classList.contains('drop-no'));
  if (no) {
    e.preventDefault();
    e.stopPropagation(); // keep holding it; the dimmed target's tooltip says why
    return;
  }
  end(false);
}

function onDocKey(e: KeyboardEvent): void {
  if (!lift) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    end(false);
    return;
  }
  if (lift.mode !== 'keyboard') return;
  const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const dir = arrows[e.key];
  if (dir) {
    e.preventDefault();
    e.stopPropagation();
    const next = nearest(lift.over?.el ?? lift.source, dir, lift.ok);
    if (next) {
      setOver(next);
      next.el.focus({ preventScroll: true });
    }
    return;
  }
  if ((e.key === 'Enter' || e.key === ' ') && lift.over) {
    e.preventDefault();
    e.stopPropagation();
    drop(lift.over);
  }
}

/** The target nearest in an arrow's direction (falling back to the next or previous in page order). */
function nearest(from: HTMLElement, [dx, dy]: [number, number], list: Target[]): Target | undefined {
  if (!list.length) return undefined;
  const c = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2] as const;
  };
  const [fx, fy] = c(from);
  let best: Target | undefined;
  let bestD = Infinity;
  for (const t of list) {
    if (t.el === from) continue;
    const [tx, ty] = c(t.el);
    const along = (tx - fx) * dx + (ty - fy) * dy;
    if (along <= 0) continue;
    const across = Math.abs((tx - fx) * dy) + Math.abs((ty - fy) * dx);
    const d = along + across * 2;
    if (d < bestD) (bestD = d), (best = t);
  }
  if (best) return best;
  const i = list.findIndex((t) => t.el === from);
  const step = dx + dy > 0 ? 1 : -1;
  return list[(i < 0 ? (step > 0 ? 0 : list.length - 1) : (i + step + list.length) % list.length)];
}

/** Make an element draggable with a payload. Returns a function that undoes it. */
export function makeDraggable<T>(el: HTMLElement, payload: T, opts: { ghost?: boolean | (() => HTMLElement) } = {}): () => void {
  el.dataset.drag = '1';
  if (el.tabIndex < 0 && !el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
  let start: { x: number; y: number; id: number } | null = null;

  const move = (e: PointerEvent) => {
    if (!start || e.pointerId !== start.id) return;
    if (!lift || lift.source !== el || lift.mode !== 'pointer') {
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < THRESHOLD) return;
      begin(el, payload, 'pointer');
      if (opts.ghost !== false) {
        const { root } = stageOf(el);
        // V5.1.2: a screen may draw its own ghost (the taps lift a big tilted tankard, not the whole tap).
        const own = typeof opts.ghost === 'function' ? opts.ghost() : null;
        const g = own ?? (el.cloneNode(true) as HTMLElement);
        g.classList.add('drag-ghost');
        g.classList.remove('lifted');
        g.removeAttribute('id');
        if (!own) {
          g.style.width = `${el.offsetWidth}px`;
          g.style.height = `${el.offsetHeight}px`;
        }
        root.append(g);
        lift!.ghost = g;
      }
    }
    if (lift?.ghost) {
      const { root, scale } = stageOf(el);
      const [x, y] = toStage(root, scale, e.clientX, e.clientY);
      lift.ghost.style.transform = `translate(${x - lift.ghost.offsetWidth / 2}px, ${y - lift.ghost.offsetHeight / 2}px)`;
    }
    setOver(targetAt(e.clientX, e.clientY));
  };
  const up = (e: PointerEvent) => {
    if (!start || e.pointerId !== start.id) return;
    start = null;
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', cancel);
    if (lift && lift.source === el && lift.mode === 'pointer') {
      swallowClick = true; // the click that follows a real drag is not a "pick up"
      setTimeout(() => (swallowClick = false), 0);
      const t = targetAt(e.clientX, e.clientY);
      if (t) drop(t);
      else end(false);
    }
  };
  const cancel = () => {
    start = null;
    if (lift?.source === el && lift.mode === 'pointer') end(false);
  };
  const down = (e: PointerEvent) => {
    if (e.button !== 0 || (lift && lift.mode !== 'pointer')) return;
    start = { x: e.clientX, y: e.clientY, id: e.pointerId };
    el.setPointerCapture?.(e.pointerId);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
  };
  const click = (e: MouseEvent) => {
    if (swallowClick) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    e.stopPropagation();
    if (lift?.source === el) end(false);
    // V5.1.2: the second click of a double-click never picks something up (a double-clicked Round re-renders under
    // the pointer and its second click would land on the tap behind it, leaving a tankard lifted).
    else if (e.detail > 1) e.preventDefault();
    else begin(el, payload, e.detail === 0 ? 'keyboard' : 'select');
  };
  const key = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (lift?.source === el && lift.mode === 'keyboard') return; // handled by the document listener
    if (lift) return;
    e.preventDefault();
    e.stopPropagation();
    begin(el, payload, 'keyboard');
    const first = lift!.ok[0];
    if (first) {
      setOver(first);
      first.el.focus({ preventScroll: true });
    }
  };
  el.addEventListener('pointerdown', down);
  el.addEventListener('click', click);
  el.addEventListener('keydown', key);
  return () => {
    if (lift?.source === el) end(false);
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('click', click);
    el.removeEventListener('keydown', key);
    delete el.dataset.drag;
  };
}

/** Make an element a drop target. Returns a function that undoes it. */
export function makeDropTarget<T>(el: HTMLElement, spec: DropSpec<T>): () => void {
  el.dataset.drop = '1';
  const t: Target = { el, spec: spec as DropSpec<unknown>, tabindex: undefined, tip: undefined };
  targets.add(t);
  const enter = () => {
    if (lift && lift.mode !== 'pointer' && lift.ok.includes(t)) setOver(t);
  };
  el.addEventListener('pointerenter', enter);
  el.addEventListener('focus', enter);
  return () => {
    targets.delete(t);
    el.removeEventListener('pointerenter', enter);
    el.removeEventListener('focus', enter);
    delete el.dataset.drop;
  };
}
