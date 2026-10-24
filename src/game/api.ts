// The V3 engine's public surface. The view and UI import only from here,
// types.ts and hex.ts. Everything is pure: queries read a GameState,
// apply() returns a new state plus events for animation.

import type { Pos } from './hex';
import type {
  ActionKind,
  ActionTarget,
  ApplyResult,
  Brightness,
  CastleDef,
  Command,
  GameState,
  Hero,
  Intent,
  ShopOffer,
  Stat,
} from './types';

/** One reachable hex for a hero this turn. */
export interface Reach {
  to: Pos;
  /** Movement spent. */
  cost: number;
  /** Hexes walked, start excluded, destination last. May cross stairs (level changes mid-path). */
  path: Pos[];
}

/** What a risky action will look like before the player commits. */
export interface RollPreview {
  ok: boolean;
  /** Why it can't be done, when !ok. */
  reason?: string;
  stat?: Stat;
  slots: number;
  /** Per-slot chance after modifiers, 0..100. */
  chance: number;
  /** Plain-words modifiers, e.g. ["Dark −20%", "Raised +10%"]. */
  modifiers: string[];
  /** Focus the hero may spend (min of its Focus and slots). */
  maxFocus: number;
  /** Outcome by number of hits, index = hits (0..slots), e.g. ["Lock jams", "Fails", "Opens, noise 2", "Opens silently"]. */
  outcomes: string[];
  /** Noise radius the action makes (0 = silent). For rolls that vary, the loudest. */
  noise: number;
  /** Light it costs or adds (negative = costs). Usually 0. */
  light: number;
}

/** One thing a hero can do right now, with its valid targets. */
export interface ActionOption {
  action: ActionKind;
  label: string;
  targets: ActionTarget[];
  /** True when the action rolls (show a RollPreview per target). */
  rolls: boolean;
}

export interface Visibility {
  /** Hexes in sight of any active hero right now, by posKey. */
  visible: Set<string>;
  /** Hexes ever seen this delve, by posKey. */
  explored: Set<string>;
  /** Hexes lit (by the lantern, torches or braziers), by posKey. */
  lit: Set<string>;
}

export interface Engine {
  castle(): CastleDef;
  newGame(seed: number): GameState;
  apply(state: GameState, command: Command): ApplyResult;

  // delve queries
  reachable(state: GameState, heroId: string, sneak: boolean): Reach[];
  actions(state: GameState, heroId: string): ActionOption[];
  preview(state: GameState, heroId: string, action: ActionKind, target: ActionTarget): RollPreview;
  visibility(state: GameState): Visibility;
  brightness(state: GameState): Brightness;
  /** Intent per visible, awake monster id. */
  intents(state: GameState): Record<string, Intent>;
  /** Noise radius a move would make (for the ripple preview). */
  moveNoise(state: GameState, heroId: string, sneak: boolean): number;
  /** Is this hex lit by the lantern, a torch or a brazier? Heroes outside light fight at Dark penalties. */
  inLight(state: GameState, at: Pos): boolean;

  // camp queries
  shop(): ShopOffer[];
  heroById(state: GameState, id: string): Hero | undefined;
  /** Gold value of a list of items (gold + valuables). */
  value(items: { kind: string; amount: number }[]): number;

  serialize(state: GameState): string;
  deserialize(text: string): GameState | null;
}
