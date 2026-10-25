// Player settings, remembered per browser.

const KEY = 'vc.settings';

export interface Settings {
  speed: number;
  reduceShake: boolean;
  reduceFlashes: boolean;
  /** Skip the "still waiting" question on End turn (15.7 asks once by default). */
  noEndTurnAsk: boolean;
}

const DEFAULTS: Settings = { speed: 1, reduceShake: false, reduceFlashes: false, noEndTurnAsk: false };

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
