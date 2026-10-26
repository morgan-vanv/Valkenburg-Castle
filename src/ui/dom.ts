// Minimal DOM helpers. No framework.

import { iconSvg, type IconName } from '../view/icons';

type Child = Node | string | number | null | undefined | false | Child[];
type Attrs = Record<string, string | number | boolean | EventListener | undefined | null> & { class?: string };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (k === 'class') el.className = String(v);
      else if (k === 'html') el.innerHTML = String(v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el: Element, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function gold(n: number): string {
  return `${n.toLocaleString('en-US')}`;
}

/** Pip row: filled and empty markers. */
export function pips(filled: number, total: number, cls = ''): HTMLElement {
  const row = h('span', { class: `pips ${cls}` });
  for (let i = 0; i < total; i++) row.appendChild(h('i', { class: i < filled ? 'on' : '' }));
  return row;
}

/** V4.0 HUD: a line icon from the shared set (src/view/icons.ts) as an element. */
export function icon(name: IconName, size = 16, cls = '', color = 'currentColor'): HTMLElement {
  const el = document.createElement('span');
  el.className = `icw ${cls}`.trim();
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = iconSvg(name, size, color);
  return el;
}
