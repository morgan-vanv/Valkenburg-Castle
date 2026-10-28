// V5.0 (G): the render quality the diorama runs at.
//
// 'high': shadows (one shadowed light), bloom, tilt-shift, vignette, pixel ratio up to 2.
// 'low':  none of that and pixel ratio 1. The headless checks in scripts/ run on software
//         rendering and set it; a player on an integrated GPU can pick it in Settings.
//
// Read once at start from the player's settings (src/ui/settings.ts, key `quality`), or from
// `?quality=low|high` in the URL for scripts and screenshots. Diorama.setQuality() changes it live.

import { loadSettings } from '../../ui/settings';

export type Quality = 'high' | 'low';

export function readQuality(): Quality {
  try {
    const q = new URLSearchParams(location.search).get('quality');
    if (q === 'low' || q === 'high') return q;
  } catch {
    /* no location (tests) */
  }
  return loadSettings().quality === 'low' ? 'low' : 'high';
}

/** What each quality turns on. */
export interface QualityFeatures {
  shadows: boolean;
  bloom: boolean;
  tiltShift: boolean;
  vignette: boolean;
  pixelRatio: number;
}

export function featuresOf(q: Quality): QualityFeatures {
  if (q === 'low') return { shadows: false, bloom: false, tiltShift: false, vignette: false, pixelRatio: 1 };
  return { shadows: true, bloom: true, tiltShift: true, vignette: true, pixelRatio: Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, 2) };
}
