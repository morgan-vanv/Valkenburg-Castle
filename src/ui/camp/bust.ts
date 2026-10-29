// V5.1 (W0): hero busts for the camp, the V5 joint rig's figures (src/view/look/cast.ts) framed on the head and
// shoulders. V5.1.1: the busts are PRE-RENDERED. scripts/v511-bake-busts.mjs renders each class once (bust-render.ts)
// and saves public/busts/<cls>.webp, so the camp shows a plain <img> and never opens a WebGL context (the live render
// stalled the page for seconds the first time a class showed, worst right after a delve). The CSS figurine head from
// camp.css (.bust .sh/.hd/.ht) sits underneath and the image fades in over it once decoded. A class with no baked
// image (not in BAKED_BUSTS) still gets the live render, loaded lazily, as a fallback.

/** camp.css's short class keys (.bust.k-*, .abil.k-*, --k-*). */
const CSS_KEY: Record<string, string> = {
  heir: 'heir', sellsword: 'sellsword', burglar: 'burglar', ranger: 'ranger', sapper: 'sapper',
  pyromancer: 'pyro', shadowmancer: 'shadow', hedgewitch: 'witch', mage: 'pyro',
};
/** The camp.css key for a hero class ('pyromancer' → 'pyro'). */
export const bustKey = (cls: string): string => CSS_KEY[cls] ?? 'heir';

/** Every class with a baked image in public/busts (the heir and the recruitable classes). The bake script reads this. */
export const BAKED_BUSTS = ['heir', 'sellsword', 'burglar', 'ranger', 'sapper', 'pyromancer', 'shadowmancer', 'hedgewitch'] as const;
/** Classes that share another class's image (the V3 'mage' looks like the pyromancer, as in CSS_KEY). */
const BUST_ALIAS: Record<string, string> = { mage: 'pyromancer' };

const baked = new Set<string>(BAKED_BUSTS);
/** The baked image's URL for a class, or null when it has none. Relative to the page (vite base './'). */
export function bakedBustUrl(cls: string): string | null {
  const c = BUST_ALIAS[cls] ?? cls;
  return baked.has(c) ? `${import.meta.env.BASE_URL}busts/${c}.webp` : null;
}

/** Images already decoded once: a bust built again (any re-render) shows the image at once, without the fade. */
const loaded = new Set<string>();
const warm = new Map<string, HTMLImageElement>();

/** Start fetching and decoding the baked busts for these classes (cheap; call when the camp opens). */
export function warmBusts(classes: Iterable<string>): void {
  for (const cls of classes) {
    const url = bakedBustUrl(cls);
    if (!url || warm.has(url)) continue;
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => loaded.add(url);
    img.src = url;
    warm.set(url, img);
  }
}

/** The live render's results for classes without a baked image (data URLs; null when WebGL failed). */
const live = new Map<string, Promise<string | null>>();
function liveBust(cls: string): Promise<string | null> {
  let p = live.get(cls);
  if (!p) {
    p = import('./bust-render').then((m) => m.renderBust(cls)).catch(() => null);
    live.set(cls, p);
  }
  return p;
}

function addImage(el: HTMLElement, src: string, instant: boolean, onLoad?: () => void): void {
  const img = document.createElement('img');
  img.alt = '';
  img.draggable = false;
  img.decoding = 'async';
  if (instant) el.classList.add('img');
  else
    img.addEventListener('load', () => {
      onLoad?.();
      el.classList.add('img');
    }, { once: true });
  img.src = src;
  el.append(img);
}

/**
 * A bust: `<div class="bust k-<key> [sm|lg]">` holding the CSS figurine parts and the bust image over them (the
 * element gets class `img` once the image has loaded). `size` is 'sm' (64px), 'md' (120px, default) or 'lg' (180px),
 * or a number of CSS px.
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
  const url = bakedBustUrl(cls);
  if (url) addImage(el, url, loaded.has(url), () => loaded.add(url));
  else
    void liveBust(cls).then((src) => {
      if (src) addImage(el, src, false);
    });
  return el;
}
