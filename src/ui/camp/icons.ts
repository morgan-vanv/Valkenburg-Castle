// V5.1 (W0): the camp kit's icons. Each glyph is a CSS mask in camp.css (.ic-<name>), tinted by currentColor and
// sized by font-size, so an icon is one empty <i>. Decorative by default; pass a label to make it an image.

export const ICONS = [
  'aim', 'anvil', 'arrow', 'banner', 'bomb', 'bow', 'cart', 'chain', 'check', 'chest', 'coin', 'crown', 'flame', 'fuse',
  'gate', 'gem', 'grave', 'heart', 'hood', 'horn', 'lantern', 'leaf', 'lock', 'mail', 'moon', 'mug', 'pick', 'plus',
  'potion', 'push', 'rope', 'sack', 'scroll', 'shield', 'skull', 'spider', 'stairs', 'star', 'sword', 'torch', 'warn',
] as const;
export type CampIcon = (typeof ICONS)[number];

/** `ic('sword')` is `<i class="ic ic-sword" aria-hidden="true">`; with a label it is `role="img"` with that name. */
export function ic(name: CampIcon, opts: { label?: string; class?: string } = {}): HTMLElement {
  const el = document.createElement('i');
  el.className = `ic ic-${name}${opts.class ? ` ${opts.class}` : ''}`;
  if (opts.label) {
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', opts.label);
  } else el.setAttribute('aria-hidden', 'true');
  return el;
}
