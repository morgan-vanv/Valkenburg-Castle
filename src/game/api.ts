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
  HeroClass,
  Intent,
  ShopOffer,
  AleOffer,
  DealOption,
  Stat,
} from './types';

/** Recruit card text for a class (V3.2). */
export interface ClassInfo {
  name: string;
  /** e.g. "Quiet: picks locks, sneaks fast." */
  role: string;
  weapon: string;
  armor: number;
  /** Mana per delve (0 = none). */
  mana: number;
  /** One line per ability or spell, e.g. "Fireball (2 mana): radius 1 at range 5, 3 Wits slots, 2 dmg per hit, sets hexes burning." */
  abilities: string[];
}

/** One reachable hex for a hero this turn. */
export interface Reach {
  to: Pos;
  /** Movement spent. */
  cost: number;
  /** Hexes walked, start excluded, destination last. May cross stairs (level changes mid-path). */
  path: Pos[];
  /**
   * True when this is a dash (spec 15.2): the hero has already moved and not acted, so this
   * second move spends their action. reachable() returns only dash entries then; draw them in
   * the second colour. Send it as a normal 'move' command.
   */
  dash?: boolean;
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
  /** Plain-words risk to show prominently, e.g. "Falls 2 levels into the Hollow: 7 damage. This will down Pim." */
  warning?: string;
  /** The UI must ask the player to confirm before sending this action (drops of more than one level). */
  confirm?: boolean;
  /** Area actions (fireball, gust, smoke, glue): the hexes affected, for the preview overlay. */
  hexes?: Pos[];
  /** Figures (ids) the action will hit or move, e.g. everyone in the fireball, allies included. */
  affects?: string[];
}

/** Where a fall from a pit hex ends up. */
export interface FallInfo {
  /** Landing hex. */
  to: Pos;
  /** Levels fallen (1 or 2). */
  levels: number;
  /** Damage on landing (4 for one level, 7 for two). */
  damage: number;
  /** Level name, e.g. "the Hollow". */
  levelName: string;
}

/** One thing a hero can do right now, with its valid targets. */
export interface ActionOption {
  action: ActionKind;
  label: string;
  targets: ActionTarget[];
  /** True when the action rolls (show a RollPreview per target). */
  rolls: boolean;
  /**
   * How the UI picks a target (V3.2): 'self' = no pick (one target), 'ally' = click a hero,
   * 'enemy' = click a monster/rival, 'hex' = click a hex (throws, fireball, gust, blink, dig...),
   * 'item' = pick from the pack (drop/give/torch), 'other' = pick from `targets` as before.
   */
  pick: 'self' | 'ally' | 'enemy' | 'hex' | 'item' | 'other';
  /** Hex-target area actions: radius of the area around the picked hex to highlight (fireball/gust/smoke/glue 1). */
  area?: number;
  /** Mana it costs (spells). */
  mana?: number;
  /**
   * Spec 15.7: the option applies here but can't be done right now; this is the reason in plain
   * words ("Heirloom needs 2 pack slots. Drop something first."). Show it greyed with the reason
   * on hover and as a flash on click. `targets` still lists what it would apply to.
   */
  blocked?: string;
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
  /** Is this hex lit by the lantern, a torch, a brazier or a fixed light? Heroes outside light fight at Dark penalties. */
  inLight(state: GameState, at: Pos): boolean;
  /** Current sight range in hexes (lantern stage minus depth). */
  /** This hero's sight range in hexes: lantern stage minus depth when lit, the level's dark range when not (spec 16.2). */
  sightRange(state: GameState, heroId: string): number;
  /** Is the hero standing in light (lantern, torch, brazier or fixed light)? */
  heroLit(state: GameState, heroId: string): boolean;
  /** Where something falling into this pit hex lands, or null if it isn't a pit. */
  fallInfo(state: GameState, pit: Pos): FallInfo | null;
  /**
   * Is this hero standing where a shove could send them over? Returns the worst fall
   * (the deepest pit hex next to them without a railing), or null. For the edge badge.
   */
  edgeRisk(state: GameState, heroId: string): FallInfo | null;

  // camp queries
  /** The peddler's stock; with a state, metalwork is marked `locked` until the smith is home (spec 18.2). */
  shop(state?: GameState): ShopOffer[];
  /** V3.5 (spec 18.4): the Flagon's ales, each `locked` until its brewing gear is home. */
  ales(state: GameState): AleOffer[];
  /** V3.5 (spec 18.6): the parley deals a hero can make with the crew right now (empty if none in reach). */
  deals(state: GameState, heroId: string): DealOption[];
  /** V3.2: one-line role and the ability/spell lines for a class, for recruit cards. */
  classInfo(cls: HeroClass): ClassInfo;
  /** V3.2: why startDelve would refuse this party now (e.g. "Hire at least one hero at the tavern."), or null. */
  partyProblem(state: GameState, heroIds: string[]): string | null;
  heroById(state: GameState, id: string): Hero | undefined;
  /** Gold value of a list of items (gold + valuables). */
  value(items: { kind: string; amount: number }[]): number;

  serialize(state: GameState): string;
  deserialize(text: string): GameState | null;
}
