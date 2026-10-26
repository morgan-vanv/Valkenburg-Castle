// V4.0 HUD: the small line icons the board marks and the HUD share (intents, statuses, actions, the
// chronicle). Plain SVG path data, drawn as strings so the diorama's tags (innerHTML) and the HUD's
// DOM can both use them. No DOM, no three.js here.

export interface IconDef {
  /** viewBox width and height (square). */
  vb: number;
  /** Stroked path data. */
  d: string;
  /** Filled path data (drawn in the same colour, no stroke). */
  fill?: string;
  /** Stroke width in viewBox units. */
  w?: number;
}

export const ICONS = {
  sword: { vb: 20, d: 'M3 17 L15 5 M15 5 L17 3 M12 3 L17 8 M3 13 L7 17', w: 1.8 },
  shoot: { vb: 16, d: 'M2 14 L14 2 M9 2 H14 V7 M2 10 L6 14', w: 1.6 },
  shove: { vb: 20, d: 'M2 10 H14 M10 5 L15 10 L10 15 M17 3 V17', w: 1.7 },
  hand: { vb: 16, d: 'M4 6 V9.5 C4 12.5 6 14.5 8.5 14.5 C11 14.5 12.5 12.5 12.5 10 V5 M6.5 8 V2.5 M9 8 V2 M11 8 V3.5 M4 6 L2.5 4.5', w: 1.4 },
  shout: { vb: 16, d: 'M2 6 H5 L9 3 V13 L5 10 H2 Z M11 5 C13 6 13 10 11 11', w: 1.4 },
  flame: { vb: 16, d: 'M8 1.5 C10.5 5 12.5 6.5 12.5 9.8 C12.5 12.6 10.5 14.5 8 14.5 C5.5 14.5 3.5 12.6 3.5 9.8 C3.5 7.4 6 6 8 1.5 Z M8 9 C9 10 9.7 10.8 9.7 12 C9.7 13 9 13.6 8 13.6 C7 13.6 6.3 13 6.3 12 C6.3 10.8 7 10 8 9 Z', w: 1.3 },
  move: { vb: 16, d: 'M2 8 H14 M10 4 L14 8 L10 12', w: 1.5 },
  flee: { vb: 16, d: 'M12 4.5 A5.5 5.5 0 1 0 13.5 9.5 M12 1.5 V4.5 H9', w: 1.4 },
  bolt: { vb: 16, d: 'M9 1 L3 9 H8 L7 15 L13 7 H8 Z', w: 1.3 },
  blast: { vb: 16, d: 'M8 1 L9.5 5.5 L14 4 L11 8 L14 12 L9.5 10.5 L8 15 L6.5 10.5 L2 12 L5 8 L2 4 L6.5 5.5 Z', w: 1.2 },
  eye: { vb: 14, d: 'M1 7 C3 3 11 3 13 7 C11 11 3 11 1 7 Z', fill: 'M7 5 A2 2 0 1 1 7 9 A2 2 0 1 1 7 5 Z', w: 1.3 },
  eyeOff: { vb: 14, d: 'M1 7 C3 3 11 3 13 7 C11 11 3 11 1 7 Z M2 12 L12 2', w: 1.3 },
  smoke: { vb: 16, d: 'M4 12.5 H12 A3 3 0 0 0 12.3 6.5 A4.2 4.2 0 0 0 4.4 6.6 A3 3 0 0 0 4 12.5 Z', w: 1.3 },
  cross: { vb: 16, d: 'M8 2 V14 M2 8 H14', w: 2 },
  shield: { vb: 20, d: 'M10 2 L17 5 V10 C17 14 14 17 10 18 C6 17 3 14 3 10 V5 Z', w: 1.7 },
  coin: { vb: 16, d: 'M8 1.5 A6.5 6.5 0 1 1 8 14.5 A6.5 6.5 0 1 1 8 1.5 Z M8 5 A3 3 0 1 1 8 11 A3 3 0 1 1 8 5 Z', w: 1.3 },
  potion: { vb: 16, d: 'M6 1.5 H10 M7 1.5 V6 L3.8 11 C3 12.8 4 14.5 6 14.5 H10 C12 14.5 13 12.8 12.2 11 L9 6 V1.5', w: 1.3 },
  lantern: { vb: 12, d: 'M3 4 H9 V13 H3 Z M4.5 1.5 H7.5 M6 1.5 V4', w: 1.4 },
  drop: { vb: 14, d: 'M1 3 H7 V13 M7 9 L12 13', w: 1.6 },
  flag: { vb: 20, d: 'M5 18 V2 M5 3 H16 L13 7 L16 11 H5', w: 1.7 },
  diamond: { vb: 18, d: 'M9 1 L17 9 L9 17 L1 9 Z', w: 1.5 },
  steps: { vb: 14, d: 'M3 2 C5 2 6 4 6 6 C6 8 4 8 4 10 C4 12 6 12 7 12', w: 1.3 },
  crew: { vb: 16, d: 'M5.5 3 A2.2 2.2 0 1 1 5.5 7.4 A2.2 2.2 0 1 1 5.5 3 Z M1.5 13.5 C1.5 10.5 3.3 9 5.5 9 C7.7 9 9.5 10.5 9.5 13.5 M11 3.5 A2 2 0 1 1 11 7.5 M11.5 9.2 C13.4 9.4 14.5 11 14.5 13.5', w: 1.3 },
  warn: { vb: 16, d: 'M8 2 V10 M8 13 V14', w: 2 },
  moon: { vb: 16, d: 'M10.5 2 A6.3 6.3 0 1 0 14.5 11 A5 5 0 0 1 10.5 2 Z', w: 1.3 },
  chain: { vb: 16, d: 'M6.5 9.5 L4.5 11.5 A2.3 2.3 0 0 1 1.3 8.3 L4 5.6 A2.3 2.3 0 0 1 7.2 5.6 M9.5 6.5 L11.5 4.5 A2.3 2.3 0 0 1 14.7 7.7 L12 10.4 A2.3 2.3 0 0 1 8.8 10.4', w: 1.4 },
  torch: { vb: 16, d: 'M8 8 L7 15 H9 Z M8 7.5 C10 6 10.4 4 8 1.5 C5.6 4 6 6 8 7.5 Z', w: 1.3 },
  stairs: { vb: 16, d: 'M2 14 H6 V10 H10 V6 H14 V2', w: 1.5 },
  door: { vb: 16, d: 'M4 14.5 V2 H12 V14.5 M2 14.5 H14 M9.6 8.4 V8.6', w: 1.5 },
  lock: { vb: 16, d: 'M3.5 7.5 H12.5 V14.5 H3.5 Z M5.5 7.5 V5 A2.5 2.5 0 0 1 10.5 5 V7.5 M8 10 V12', w: 1.4 },
  hammer: { vb: 16, d: 'M2.5 14 L9 7.5 M6.5 4 L9.5 1 L15 6.5 L12 9.5 Z', w: 1.5 },
  exit: { vb: 16, d: 'M9 2 H14 V14 H9 M2 8 H10.5 M7.5 5 L10.5 8 L7.5 11', w: 1.5 },
  heart: { vb: 16, d: 'M8 14 L2 8.2 A3.4 3.4 0 0 1 8 4 A3.4 3.4 0 0 1 14 8.2 Z', w: 1.4 },
  key: { vb: 16, d: 'M5 5 A3 3 0 1 1 5 11 A3 3 0 1 1 5 5 Z M8 8 H15 M12.5 8 V11 M14.5 8 V10', w: 1.4 },
  trap: { vb: 16, d: 'M1.5 12 L4.5 5 L7 11 L9.5 5 L12 11 L14.5 5 M1 13.5 H15', w: 1.3 },
  winch: { vb: 16, d: 'M8 2.5 A5.5 5.5 0 1 1 8 13.5 A5.5 5.5 0 1 1 8 2.5 Z M8 2.5 V13.5 M2.5 8 H13.5', w: 1.3 },
  dig: { vb: 16, d: 'M10 2 L14 6 M12 4 L6 10 M3.5 8 L8 12.5 L5 15 L1 11 Z', w: 1.4 },
  down: { vb: 16, d: 'M8 2 V13 M4 9 L8 13 L12 9', w: 1.6 },
  up: { vb: 16, d: 'M8 14 V3 M4 7 L8 3 L12 7', w: 1.6 },
  rope: { vb: 16, d: 'M8 1 C4 4 12 6 8 9 C4 12 12 14 8 15', w: 1.5 },
  blink: { vb: 16, d: 'M2 8 H4 M6 8 H8 M10 8 H14 M11 5 L14 8 L11 11', w: 1.5 },
  veil: { vb: 16, d: 'M8 2 A6 6 0 1 1 8 14 A6 6 0 1 1 8 2 Z', fill: 'M8 2 A6 6 0 0 0 8 14 Z', w: 1.3 },
  gust: { vb: 16, d: 'M2 5 H10 C12.5 5 12.5 1.8 10 2.2 M2 9 H13 C15.5 9 15.5 12.4 13 12 M2 13 H7', w: 1.4 },
  skull: { vb: 16, d: 'M3.5 9 A4.5 4.5 0 1 1 12.5 9 V12 H10 V14 H6 V12 H3.5 Z M6.2 8 V8.6 M9.8 8 V8.6', w: 1.4 },
  thorn: { vb: 16, d: 'M2 14 C6 10 10 6 14 2 M5.5 10.5 L4 8 M8.5 7.5 L11 9 M9.5 6.5 L8.5 3.5', w: 1.4 },
  give: { vb: 16, d: 'M2 10 H11 M8 7 L11 10 L8 13 M10 2 H14 V6 H10 Z', w: 1.4 },
  scales: { vb: 16, d: 'M8 2 V14 M4.5 14 H11.5 M2.5 4.5 H13.5 M2.5 4.5 L1 9 H4 Z M13.5 4.5 L12 9 H15 Z', w: 1.3 },
  dots: { vb: 20, d: '', fill: 'M3 8 A2 2 0 1 1 3 12 A2 2 0 1 1 3 8 Z M10 8 A2 2 0 1 1 10 12 A2 2 0 1 1 10 8 Z M17 8 A2 2 0 1 1 17 12 A2 2 0 1 1 17 8 Z' },
  menu: { vb: 18, d: 'M1 3 H17 M1 9 H17 M1 15 H17', w: 1.6 },
  check: { vb: 16, d: 'M3 8.5 L6.5 12 L13 4.5', w: 2.2 },
  dot: { vb: 16, d: '', fill: 'M8 5.5 A2.5 2.5 0 1 1 8 10.5 A2.5 2.5 0 1 1 8 5.5 Z' },
  sack: { vb: 16, d: 'M6 2 H10 L9 4.5 C12.5 6 14 9 13.5 11.5 C13 14 11 14.5 8 14.5 C5 14.5 3 14 2.5 11.5 C2 9 3.5 6 7 4.5 Z', w: 1.3 },
  face: { vb: 16, d: 'M8 1.5 A6.5 6.5 0 1 1 8 14.5 A6.5 6.5 0 1 1 8 1.5 Z M8 4 L10 9 H6 Z', w: 1.3 },
  zz: { vb: 16, d: 'M3 5 H8 L3 11 H8 M10 3 H13.5 L10 7.5 H13.5', w: 1.4 },
  rotL: { vb: 16, d: 'M3.5 8 A4.5 4.5 0 1 0 5 4.6 M2.5 2 V5.5 H6', w: 1.5 },
  rotR: { vb: 16, d: 'M12.5 8 A4.5 4.5 0 1 1 11 4.6 M13.5 2 V5.5 H10', w: 1.5 },
  plus: { vb: 16, d: 'M8 3 V13 M3 8 H13', w: 1.6 },
  minus: { vb: 16, d: 'M3 8 H13', w: 1.6 },
  target: { vb: 16, d: 'M8 2 A6 6 0 1 1 8 14 A6 6 0 1 1 8 2 Z M8 0.5 V4 M8 12 V15.5 M0.5 8 H4 M12 8 H15.5', w: 1.3 },
  sound: { vb: 16, d: 'M2 6 H5 L9 3 V13 L5 10 H2 Z M11 6 C12 7 12 9 11 10', w: 1.3 },
} as const satisfies Record<string, IconDef>;

export type IconName = keyof typeof ICONS;

/** An icon as an SVG string (`currentColor` unless a colour is given). */
export function iconSvg(name: IconName, size = 16, color = 'currentColor', cls = ''): string {
  const ic: IconDef = ICONS[name];
  const sw = ic.w ?? 1.5;
  const stroke = ic.d ? `<path d="${ic.d}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>` : '';
  const fill = ic.fill ? `<path d="${ic.fill}" fill="${color}"/>` : '';
  return `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 ${ic.vb} ${ic.vb}" aria-hidden="true">${stroke}${fill}</svg>`;
}

/** Which icon each intent kind shows over a monster or crew member (no entry: its glyph, see the diorama's INTENT_GLYPH). */
export const INTENT_ICON: Partial<Record<string, IconName>> = {
  attack: 'sword',
  move: 'move',
  web: 'hand',
  steal: 'hand',
  flee: 'flee',
  shove: 'shove',
  breath: 'flame',
  sweep: 'shove',
  shout: 'shout',
  drag: 'hand',
  grab: 'hand',
  overwatch: 'eye',
  smoke: 'smoke',
  veil: 'veil',
  dart: 'shoot',
  toll: 'coin',
  firebolt: 'bolt',
  charge: 'blast',
  fuse: 'blast',
  rob: 'hand',
  potion: 'potion',
  item: 'potion',
  fireball: 'blast',
  mend: 'cross',
  gust: 'gust',
  ward: 'shield',
  glue: 'smoke',
  caltrops: 'trap',
  firecracker: 'blast',
  blink: 'blink',
  hamstring: 'shoot',
};

/** Friendly intents (a hired crew member's mend or ward) draw green; shouts amber; the rest red. */
export function intentTone(kind: string): 'foe' | 'friend' | 'warn' {
  if (kind === 'mend' || kind === 'ward' || kind === 'potion') return 'friend';
  if (kind === 'shout' || kind === 'toll' || kind === 'move' || kind === 'veil' || kind === 'flee' || kind === 'overwatch') return 'warn';
  return 'foe';
}
