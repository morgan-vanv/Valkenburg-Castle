// Player settings, remembered per browser.

const KEY = 'vc.settings';

export interface Settings {
  speed: number;
  reduceShake: boolean;
  reduceFlashes: boolean;
  /** Skip the "still waiting" question on End turn (15.7 asks once by default). */
  noEndTurnAsk: boolean;
  /** V3.4: lower walls between the camera and the focus (the diorama's cutaway). Off by default. */
  cutaway: boolean;
  /** V4.0 HUD: hover cards always show the full rules card (as if Alt were held), for touch screens. */
  fullCards: boolean;
  /** V5.0 (P, spec 32.5): end the turn on its own when no hero can move, act or use anything. On by default. */
  autoEndTurn: boolean;
}

const DEFAULTS: Settings = { speed: 1, reduceShake: false, reduceFlashes: false, noEndTurnAsk: false, cutaway: false, fullCards: false, autoEndTurn: true };

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage blocked */
  }
}
