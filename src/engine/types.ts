// Shared types for the rules engine, the map data and the renderer.
// Rules code never touches the DOM; the renderer reads these types and
// sends Commands through api.ts.

// ---------------------------------------------------------------- map

/** 1980 column letters, shared by all levels so stairs line up. */
export const COLUMN_LETTERS = 'ABCDEFGHIJKLMNOPQRSTU';

export type LevelId = 1 | 2 | 3 | 4 | 5;

/**
 * A square. `x` is the global column index into COLUMN_LETTERS (A = 0),
 * so level 3's first column, F, is x = 5. `y` is the row index (row 1 = 0).
 */
export interface Coord {
  level: LevelId;
  x: number;
  y: number;
}

/** What fills a square. */
export type CellKind =
  | 'floor'
  | 'rock' // solid, never enterable
  | 'pit'; // open shaft with no floor on this level (levels 1 and 2)

/** What separates two orthogonally neighbouring squares. */
export type EdgeKind =
  | 'open' // dotted boundary inside a room or corridor
  | 'wall'
  | 'door'
  | 'locked'; // a locked door (two asterisks on the 1980 map)

export type LinkKind = 'stairs' | 'ladder';

/** A two-way connection between a square on one level and one on another. */
export interface LevelLink {
  kind: LinkKind;
  a: Coord;
  b: Coord;
}

export interface LevelMap {
  id: LevelId;
  name: string;
  /** Global column index of the level's first column (level 3 starts at F = 5). */
  x0: number;
  width: number;
  height: number;
  /** Row-major, `cells[y * width + (x - x0)]`. */
  cells: CellKind[];
  /**
   * Horizontal edges: the edge above row y, for y in 0..height.
   * `hEdges[y * width + (x - x0)]`. Row 0 and row `height` are the outer walls.
   */
  hEdges: EdgeKind[];
  /**
   * Vertical edges: the edge left of column x, for x in x0..x0+width.
   * `vEdges[y * (width + 1) + (x - x0)]`.
   */
  vEdges: EdgeKind[];
  /** Squares you can enter from and leave the castle by (4.6). */
  entrances: Coord[];
  /** One square inside each guardroom; the engine floods to the whole room. */
  guardrooms: Coord[];
  /** One square inside each prison cell (level 2). */
  prisonCells: Coord[];
  /** Squares around the Pit you can jump or climb from (level 1). */
  balcony: Coord[];
  /** Stair squares leading to levels that aren't playable (reinforcement points). */
  reinforcementPoints: Coord[];
  /** The dragon's lair square (level 3), if any. */
  lair?: Coord;
  /** Squares holding the dragon's hoard (level 3). */
  hoard: Coord[];
}

/** A treasure pile placed on the map (V2: loot is visible, no search rolls). */
export interface LootSpot {
  at: Coord;
  name: string;
  value: number;
  /** Sacks needed to carry it. */
  sacks: number;
}

/** An enemy placed on the map at the start of a run. */
export interface Spawn {
  at: Coord;
  cls: UnitClass;
  name: string;
  /** Squads only. */
  men?: number;
  /** Starts awake and patrolling. */
  awake?: boolean;
}

export interface CastleMap {
  name: string;
  levels: LevelMap[];
  links: LevelLink[];
  loot?: LootSpot[];
  spawns?: Spawn[];
  /** Pairs of shaft squares: top (balcony side, upper level) and bottom (lower level). */
  shafts?: { top: Coord[]; bottom: Coord[] }[];
}

// ---------------------------------------------------------------- units

export type Side = 'player' | 'castle';

export type UnitClass =
  | 'hobart'
  | 'leader'
  | 'dwarf'
  | 'burglar'
  | 'magicUser'
  | 'squad'
  | 'orcSquad'
  | 'evilLeader'
  | 'evilMagicUser'
  | 'troll'
  | 'ogre'
  | 'berserker'
  | 'mantis'
  | 'spider'
  | 'drog'
  | 'banshee'
  | 'dragon'
  | 'dummy';

export type Armor = 'unarmored' | 'normal' | 'heavy';

export interface LootItem {
  id: string;
  name: string;
  /** Value in gold. */
  value: number;
  /** Weight in coins. */
  weight: number;
  /** Spell points it holds, for scrolls, rings and amulets. */
  spellPoints?: number;
  /** +1 weapon: gives the carrier the enchanted-weapon bonus. */
  enchanted?: boolean;
}

export interface Unit {
  id: string;
  side: Side;
  cls: UnitClass;
  name: string;
  pos: Coord;
  /** Squads: men left. Individuals: always 1. */
  men: number;
  /** Individuals: wounds taken. */
  wounds: number;
  maxWounds: number;
  armor: Armor;
  focus: number;
  actionsLeft: number;
  /** Squares moved this turn, for the charge bonus. */
  movedThisTurn: number;
  spellPoints: number;
  enchanted: boolean;
  /** Carries the expedition's explosive charges (count). */
  charges: number;
  loot: LootItem[];
  // status
  dormant: boolean;
  panicked: boolean;
  /** Turns of panic left (loses actions while > 0). */
  panicTurns: number;
  overwatch: boolean;
  shieldwallFacing?: Coord;
  asleepTurns: number;
  webbed: boolean;
  climbingTurns: number;
  /** Monsters: the room they guard (area id). */
  homeArea?: number;
  /** Enemies: square they return to when idle. */
  post?: Coord;
  /** Mantis: first attack bonus not yet used. */
  ambushReady?: boolean;
  /** Where a climbing unit arrives when its climb finishes. */
  climbTarget?: Coord;
  /** Men at the start of the current phase, for the half-losses morale check. */
  menAtPhaseStart: number;
  /** Dragon: castle phases until it can breathe again. */
  breathCooldown?: number;
  /** Has exited the castle this expedition. */
  exited: boolean;
  /** Prisoners freed this expedition (they join the barracks if they get out). */
  freed?: boolean;
  /** Hero roster id, for player heroes. */
  heroId?: string;
  /** Squads: men at the start of the run (healing can't exceed it). */
  startMen?: number;
  /** Monsters: how far from their post they will go. */
  leash?: number;
}

// ---------------------------------------------------------------- expedition

export type AlarmTier = 'Quiet' | 'Wary' | 'Alert' | 'Roused' | 'Swarming';

export interface DoorState {
  open: boolean;
  /** Was locked; false once picked, unlocked or smashed. */
  locked: boolean;
  destroyed: boolean;
  /** Can never be picked again (a 6 on the pick roll). */
  jammed: boolean;
  /** Can never be smashed again this expedition. */
  unsmashable: boolean;
  /** Chop progress toward 10. */
  chop: number;
}

export interface Chest {
  id: string;
  pos: Coord;
  door: DoorState;
}

export interface Contact {
  /** Unit id for real contacts; dummies are units with cls 'dummy'. */
  unitId: string;
  pos: Coord;
}

export interface PendingCharge {
  /** Edge key the charge is set against. */
  edge: string;
  /** Square the charge sits in. */
  pos: Coord;
}

export interface Expedition {
  turn: number;
  phase: Side;
  alarm: number;
  units: Unit[];
  /** Keyed by edgeKey(). Only door and locked edges have entries. */
  doors: Record<string, DoorState>;
  chests: Chest[];
  /** Loot lying on the floor, keyed by squareKey(). */
  floorLoot: Record<string, LootItem[]>;
  /** Search progress per room area id; -1 once searched. */
  searchProgress: Record<number, number>;
  /** Squares any player unit has seen, keyed by squareKey(). */
  explored: Record<string, true>;
  /** Smoke: squareKey -> turns left. */
  smoke: Record<string, number>;
  charges: PendingCharge[];
  /** Castle phases since the last reinforcement wave. */
  waveTimer: number;
  waveCount: number;
  /** Squares where noise was made this turn, for Wary wake-ups. */
  noiseThisTurn: Coord[];
  /** Player unit ids already spotted once (for the +5 alarm). */
  spotted: Record<string, true>;
  /** Units that died this expedition, for the debrief. */
  fallen: Unit[];
  hasClimbingGear: boolean;
  /** Combat spell bonus waiting for this unit's next attack this turn. */
  combatBlessing: Record<string, true>;
  /** Enemy unit ids revealed by ESP, with the turn the reveal lasts until. */
  revealed: Record<string, number>;
  /** Prisoners still held, by prison cell area id. */
  prisoners: Record<number, number>;
  /** Monster max wounds by room area id, for the treasure modifier. */
  monsterRooms: Record<number, number>;
  /** Men from the barracks who went in. */
  musterMen: number;
  /** The party's shared pack of bought items. */
  pack: Record<ItemId, number>;
  /** A rope is anchored at the shaft: climbing down or up is safe and quick. */
  rope: boolean;
  log: string[];
}

// ---------------------------------------------------------------- campaign

export type CampaignStage = 'shop' | 'expedition' | 'results';

export interface Hero {
  id: string;
  cls: 'hobart' | 'leader' | 'dwarf' | 'burglar' | 'magicUser';
  name: string;
  alive: boolean;
  enchanted: boolean;
}

export type Medal = 'gold' | 'silver' | 'bronze' | 'none';

export interface RunResult {
  /** Hobart got out alive. */
  survived: boolean;
  /** Gold carried out plus the unspent purse (0 if Hobart died). */
  score: number;
  lootGold: number;
  purseLeft: number;
  medal: Medal;
  lootNames: string[];
  menLost: number;
  heroesLost: string[];
  turns: number;
  reason: string;
}

/** Which entrance each unit uses. Keys: hero ids and squad keys ('squad1', 'squad2', 'sellswords'). */
export interface LaunchPlan {
  entrances: Record<string, Coord>;
}

export interface GameState {
  version: 2;
  seed: number;
  /** RNG state, advanced by every roll. */
  rng: number;
  stage: CampaignStage;
  /** Gold left to spend in the shop; what's unspent counts toward the score. */
  purse: number;
  /** Items bought, carried in as the party pack. */
  pack: Record<ItemId, number>;
  heroes: Hero[];
  expedition?: Expedition;
  result?: RunResult;
  /** Running id counter for new units and items. */
  nextId: number;
}

// ---------------------------------------------------------------- commands

export type DoorMethod = 'pick' | 'force' | 'blast';

export type ItemId = 'charge' | 'rope' | 'draught' | 'smoke' | 'sellswords' | 'banner';

export type SpellId = 'esp' | 'fireball' | 'smokescreen' | 'pyrotechnics' | 'unlock' | 'combat';

export type Command =
  // before the run
  | { type: 'buy'; item: ItemId }
  | { type: 'refund'; item: ItemId }
  | { type: 'launch'; plan: LaunchPlan }
  // the run
  | { type: 'move'; unitId: string; to: Coord }
  | { type: 'melee'; unitId: string; targetId: string; focus: number }
  | { type: 'missile'; unitId: string; targetId: string; focus: number }
  | { type: 'door'; unitId: string; edge: string; method: DoorMethod }
  | { type: 'pickUp'; unitId: string; itemId: string }
  | { type: 'drop'; unitId: string; itemId: string }
  | { type: 'give'; unitId: string; toId: string; itemId: string }
  | { type: 'giveFocus'; unitId: string; toId: string }
  | { type: 'overwatch'; unitId: string }
  | { type: 'cast'; unitId: string; spell: SpellId; target?: Coord; targetId?: string; edge?: string }
  | { type: 'useItem'; unitId: string; item: ItemId; target?: Coord; targetId?: string; edge?: string }
  | { type: 'jump'; unitId: string; to: Coord }
  | { type: 'climb'; unitId: string; to: Coord }
  | { type: 'exit'; unitId: string }
  | { type: 'endTurn' };

// ---------------------------------------------------------------- events

export type Frontage = 'narrow' | 'wide' | 'open';

export interface Modifier {
  label: string;
  /** Percentage points, e.g. +10 or -20. */
  value: number;
}

export interface RollResult {
  slots: number;
  chance: number;
  /** One entry per slot: true = hit. Locked (Focus) slots come first. */
  hits: boolean[];
  locked: number;
  perfect: boolean;
  wounds: number;
}

/** Everything the renderer animates. Emitted in order by apply(). */
export type GameEvent =
  | { type: 'moved'; unitId: string; path: Coord[] }
  | { type: 'attack'; attackerId: string; targetId: string; kind: 'melee' | 'missile'; frontage: Frontage; modifiers: Modifier[]; roll: RollResult }
  | { type: 'wounded'; unitId: string; amount: number; menLeft: number; woundsTaken: number }
  | { type: 'died'; unitId: string }
  | { type: 'panicked'; unitId: string }
  | { type: 'moraleHeld'; unitId: string }
  | { type: 'focus'; unitId: string; amount: number; reason: string }
  | { type: 'doorOpened'; edge: string }
  | { type: 'doorClosed'; edge: string }
  | { type: 'doorAttempt'; unitId: string; edge: string; method: DoorMethod; success: boolean; detail: string }
  | { type: 'doorDestroyed'; edge: string }
  | { type: 'explosion'; at: Coord }
  | { type: 'searched'; unitId: string; areaId: number; complete: boolean; result?: string }
  | { type: 'lootFound'; unitId: string; items: LootItem[] }
  | { type: 'trap'; unitId: string; detail: string }
  | { type: 'spell'; unitId: string; spell: SpellId; target?: Coord }
  | { type: 'alarm'; from: number; to: number; tier: AlarmTier; tierChanged: boolean }
  | { type: 'woke'; unitId: string }
  | { type: 'spotted'; unitId: string }
  | { type: 'reinforcements'; at: Coord; unitIds: string[] }
  | { type: 'exited'; unitId: string }
  | { type: 'phase'; phase: Side; turn: number }
  | { type: 'freed'; unitId: string; men: number }
  | { type: 'log'; text: string }
  | { type: 'expeditionOver' }
  | { type: 'itemUsed'; unitId: string; item: ItemId; target?: Coord }
  | { type: 'runOver'; survived: boolean; score: number; medal: Medal; reason: string };

export interface ApplyResult {
  state: GameState;
  events: GameEvent[];
  /** Set when the command was illegal; state is unchanged. */
  error?: string;
}
