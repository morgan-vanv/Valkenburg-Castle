// V3 game types: the contract between the rules engine (src/game), the castle
// data (src/data/castle) and the presentation (src/view, src/ui).
// Numbers and rules are in docs/v3-spec.md.

import type { Hex, Pos } from './hex';

// ---------------------------------------------------------------- castle data

/**
 * Static tile kinds. Doors, braziers and chests have runtime state on top.
 * - floor: walkable. `raised` floor is a balcony/dais: +10% per slot for ranged from it, drawn higher.
 * - wall: solid, blocks movement and sight.
 * - cracked: a wall a blasting charge turns into floor.
 * - pillar: solid, blocks sight, drawn as a column.
 * - rubble: walkable, costs 2 movement.
 * - door: walkable when open; blocks sight when closed.
 * - pit: open drop; impassable on foot, blocks nothing for sight. Jump, rope or be shoved down.
 *   Falling goes straight down the column: the first level below with a walkable tile at
 *   the same (q, r) is where you land (Level 1's pit mouth over a Level 2 bridge lands on
 *   the bridge; elsewhere it falls through Level 2's pit to the Hollow). See docs/v3-spec.md 14.
 * - stairs: walkable; a CastleLink joins it to a stairs hex on another level.
 * - lift: walkable; the lift platform. A 'lift' link joins its two ends once the winch is worked.
 * - exit: walkable; a hero standing here may Leave the castle.
 * - brazier: solid, a fire bowl; light it from an adjacent hex.
 * - prop: furniture that blocks movement but not sight (table, bunk, barrel, anvil, cage). Cover.
 * - tallprop: furniture that blocks movement and sight (bookshelf, forge, winch, statue).
 * - sealed: a sealed door, solid (the Sealed Stair). Not openable in the demo.
 */
export type TileKind =
  | 'floor'
  | 'wall'
  | 'cracked'
  | 'pillar'
  | 'rubble'
  | 'door'
  | 'pit'
  | 'stairs'
  | 'exit'
  | 'brazier'
  | 'lift'
  | 'prop'
  | 'tallprop'
  | 'sealed';

/** What a prop or tallprop tile is, for the view's model. */
export type PropKind =
  | 'table'
  | 'bench'
  | 'bunk'
  | 'barrel'
  | 'crate'
  | 'anvil'
  | 'cage'
  | 'bones'
  | 'rock'
  | 'shelf'
  | 'forge'
  | 'winch'
  | 'statue'
  | 'rack'
  | 'stalagmite';

/** Floor look, set per room. */
export type Material = 'flagstone' | 'planks' | 'rug' | 'earth' | 'rock' | 'water' | 'bone';

export interface TileDef {
  kind: TileKind;
  raised?: boolean;
  /** Doors only: starts locked. */
  locked?: boolean;
  /** Room id this hex belongs to (floor-like tiles). */
  room?: string;
  /** prop / tallprop: what it is. */
  prop?: PropKind;
  /** Floor next to a pit: a railing on this hex's pit side stops anyone being shoved off here. */
  railing?: boolean;
}

export interface RoomDef {
  id: string;
  name: string;
  /** Hex for the label in the view. */
  labelAt: Hex;
  /** Floor look. Default flagstone. */
  material?: Material;
  /** Floor tint, '#rrggbb', so neighbouring rooms read apart. */
  tint?: string;
}

export interface LevelDef {
  /** 1 = the Ruined Keep, 2 = the Crossing, 3 = the Hollow. */
  level: number;
  name: string;
  /** Tiles by hexKey. Hexes not listed are solid rock (void). */
  tiles: Record<string, TileDef>;
  rooms: RoomDef[];
}

export type MonsterKind = 'rats' | 'orc' | 'spider' | 'cutpurse' | 'berserker' | 'dragon';

export interface SpawnDef {
  at: Pos;
  kind: MonsterKind;
  /** Starts asleep (default true). */
  asleep?: boolean;
  /** Named elite, if any. */
  name?: string;
}

export interface ChestDef {
  id: string;
  at: Pos;
  /** 1 = common, 2 = good, 3 = rich. Scales the loot roll. */
  tier: 1 | 2 | 3;
  locked?: boolean;
}

export interface CoinDef {
  at: Pos;
  gold: number;
}

export interface TrapDef {
  at: Pos;
}

/** Where a contract objective can be placed. */
export interface ContractSiteDef {
  id: string;
  /** 'slay': the Dragon's lair (the at hex is the Dragon's spawn). */
  kind: 'rescue' | 'recover' | 'slay';
  at: Pos;
  /** e.g. "the cellblock", "the chapel crypt". Used in contract text. */
  where: string;
}

/**
 * Connections between levels. Falls (pits) need no link: they go straight down the column.
 * - stairs: a and b are stairs tiles; stepping from one to the other costs 1 movement.
 * - lift: a and b are lift tiles on two levels; once the winch (a tallprop next to `winch`
 *   on the upper level) is worked, stepping from one to the other costs 1 movement.
 */
export type CastleLink =
  | { kind: 'stairs'; a: Pos; b: Pos }
  | { kind: 'lift'; a: Pos; b: Pos; winch: Pos };

/** A fixed light: lights its radius for good, no lantern needed. */
export interface LightDef {
  at: Pos;
  radius: number;
  kind: 'sconce' | 'daylight' | 'fire' | 'fungus' | 'glow';
}

export interface CastleDef {
  name: string;
  levels: LevelDef[];
  links: CastleLink[];
  /** Exit tiles where a party may enter at the start of a delve. */
  entrances: Pos[];
  spawns: SpawnDef[];
  chests: ChestDef[];
  coins: CoinDef[];
  traps: TrapDef[];
  braziers: Pos[];
  contractSites: ContractSiteDef[];
  /** Where rival crews enter (exit tiles). */
  rivalEntrances: Pos[];
  /** Fixed lights: sconces, daylight, the forge, fungus, the Lair's fires. */
  lights: LightDef[];
}

// ---------------------------------------------------------------- heroes and items

export type HeroClass = 'hobart' | 'sellsword' | 'burglar' | 'mage';
export type Stat = 'might' | 'finesse' | 'wits' | 'nerve';

export interface Stats {
  might: number;
  finesse: number;
  wits: number;
  nerve: number;
}

export type ItemKind =
  | 'gold' // stack, amount = coins, max 100 per slot
  | 'gem' // valuable, amount = gold value
  | 'jewelry'
  | 'torch'
  | 'potion' // heals 5
  | 'rope'
  | 'charge' // blasting charge
  | 'heirloom' // contract item, takes 2 slots
  | 'hoard'; // a piece of the Dragon's hoard: valuable, takes 2 slots

export interface Item {
  id: string;
  kind: ItemKind;
  name: string;
  /** Gold for 'gold'; sale value for valuables and heirlooms; 1 for consumables. */
  amount: number;
  /** Slots this item takes (heirloom and hoard 2, everything else 1). */
  slots: number;
  /** Contract id, for contract items. */
  contractId?: string;
}

export interface Hero {
  id: string;
  name: string;
  cls: HeroClass;
  level: number;
  xp: number;
  maxHp: number;
  stats: Stats;
  /** Smithy upgrades: weapon +10% per slot per tier, armor +1 per tier. */
  weaponTier: 0 | 1 | 2;
  armorTier: 0 | 1 | 2;
  /** Contracts left to sit out in the infirmary (0 = fit). */
  wounded: number;
  /** Delves survived, for the memorial and bragging. */
  delves: number;
  kills: number;
}

// ---------------------------------------------------------------- camp

export interface Contract {
  id: string;
  /** 'slay': kill the Dragon (unlocks at reputation 3). */
  kind: 'rescue' | 'recover' | 'slay';
  title: string;
  /** One-line brief, e.g. "Brother Edric is held in the cellblock." */
  brief: string;
  siteId: string;
  level: number;
  bounty: number;
  /** Short warnings shown on the card. */
  warnings: string[];
}

export interface ShopOffer {
  kind: 'torch' | 'potion' | 'rope' | 'charge';
  name: string;
  price: number;
  text: string;
}

export interface Recruit {
  hero: Hero;
  price: number;
}

export interface FallenHero {
  name: string;
  cls: HeroClass;
  level: number;
  /** Where they fell, e.g. "Level 2, the cellblock". */
  where: string;
  delve: number;
}

export interface Campaign {
  /** Gold in the stash. */
  gold: number;
  /** Items in the stash. */
  stash: Item[];
  roster: Hero[];
  recruits: Recruit[];
  board: Contract[];
  reputation: number;
  /** Delves started so far. */
  delveCount: number;
  fallen: FallenHero[];
  /** Braziers relit for good, by posKey. */
  litBraziers: string[];
  /** Gear left where heroes died, by posKey, recoverable on later delves. */
  lostGear: { at: Pos; items: Item[] }[];
}

// ---------------------------------------------------------------- delve

export type Brightness = 'bright' | 'dim' | 'dark' | 'pitch';
export type Awareness = 'asleep' | 'alert' | 'hunting';

export interface HeroInDelve {
  heroId: string;
  at: Pos;
  hp: number;
  focus: number;
  /** Pack, 4 slots. */
  pack: Item[];
  /** 'active' on the map, 'downed' bleeding out, 'out' left the castle, 'dead'. */
  status: 'active' | 'downed' | 'out' | 'dead';
  /** Downed only: world phases left before death (starts at 2). */
  bleed: number;
  /** Rounds of torchlight left on this hero's own torch (0 = none lit). */
  torch: number;
  moved: boolean;
  acted: boolean;
  /** Rooted by a web: can't move this turn. */
  webbed: boolean;
  /** Mage only: mana left. */
  mana: number;
  /** Hobart only: rounds until Rally is ready (0 = ready). */
  rallyCooldown: number;
  /** Sellsword only: id of the ally guarded until the next player phase. */
  guarding?: string;
  /** Escorted prisoner follows this hero. */
  escorting?: string;
  /** Was revived this delve: leaves Wounded. */
  revived: boolean;
}

export interface Intent {
  /**
   * shove: push targetId one hex away from the monster (`to` = where they'll end up; may be a pit).
   * breath: the Dragon's fire; every hero on `hexes` takes the damage next world phase.
   * sweep: the Dragon's tail; every adjacent hero is shoved one hex.
   */
  kind: 'attack' | 'move' | 'web' | 'steal' | 'flee' | 'wait' | 'shove' | 'breath' | 'sweep';
  /** breath: the marked hexes. */
  hexes?: Pos[];
  targetId?: string;
  /** Hex the monster will end on (move/flee). */
  to?: Pos;
  /** Damage range if it hits with every slot, e.g. [0, 6]. */
  damage?: [number, number];
}

export interface Monster {
  id: string;
  kind: MonsterKind | 'gloam';
  name: string;
  at: Pos;
  hp: number;
  maxHp: number;
  awareness: Awareness;
  /** Where it heard noise (alert) or last saw a hero (hunting). */
  focusAt?: Pos;
  intent?: Intent;
  /** Cutpurse only: the stolen item. */
  stolen?: Item;
  /** Rounds rooted (not used by monsters yet). */
  spawnedAt: Pos;
}

export interface Rival {
  id: string;
  crew: 'lantern-sisters';
  name: string;
  at: Pos;
  hp: number;
  maxHp: number;
  /** Gold and items they've picked up. */
  loot: Item[];
  goneOut: boolean;
}

export interface RivalCrew {
  crew: 'lantern-sisters';
  name: string;
  stance: 'neutral' | 'hostile' | 'bribed';
  /** What they're doing now, shown once spotted. */
  goal: 'loot' | 'objective' | 'leave';
  spotted: boolean;
  /** Round they enter; they're off the map before it. */
  entersRound: number;
  members: Rival[];
}

export interface DoorState {
  open: boolean;
  locked: boolean;
  /** Lock ruined by a failed pick: only smashing or a charge opens it. */
  jammed: boolean;
}

export interface ChestState {
  id: string;
  at: Pos;
  tier: 1 | 2 | 3;
  locked: boolean;
  jammed: boolean;
  opened: boolean;
}

export interface GroundLoot {
  at: Pos;
  items: Item[];
}

export interface Prisoner {
  id: string;
  name: string;
  at: Pos;
  hp: number;
  freed: boolean;
  /** Hero id escorting, if any. */
  escortedBy?: string;
  out: boolean;
  dead: boolean;
}

export interface Delve {
  contract: Contract;
  round: number;
  phase: 'player' | 'world';
  heroes: HeroInDelve[];
  monsters: Monster[];
  rivals: RivalCrew | null;
  /** Lantern oil, 0..LIGHT_MAX. */
  light: number;
  /** Hero carrying the lantern. */
  lanternBearer: string;
  doors: Record<string, DoorState>; // by posKey
  chests: ChestState[];
  ground: GroundLoot[];
  /** Traps still armed, by posKey; `spotted` = visible to the player. */
  traps: Record<string, { spotted: boolean }>;
  /** Braziers lit, by posKey (includes campaign.litBraziers). */
  lit: string[];
  /** Cracked walls blown open, by posKey. */
  blown: string[];
  /** Ropes anchored at the pit, by posKey of the edge hex. */
  ropes: string[];
  /** The winch has been worked: the lift runs between its two ends. */
  liftWorking: boolean;
  prisoner: Prisoner | null;
  /** Hexes ever seen, by posKey. */
  explored: string[];
  /** Contract objective done (item extracted or prisoner out) is checked at the end. */
  log: string[];
  /** Kills this delve by hero id. */
  kills: Record<string, number>;
}

export interface DelveSummary {
  contractDone: boolean;
  bounty: number;
  /** Value of loot carried out (gold + valuables + heirloom bonus). */
  lootValue: number;
  survivors: string[];
  wounded: string[];
  dead: string[];
  xp: Record<string, number>;
  levelUps: string[];
  notes: string[];
}

export type Stage = 'camp' | 'delve' | 'summary' | 'over';

export interface GameState {
  version: 3;
  seed: number;
  /** RNG state, advanced by the engine (mulberry32 state). */
  rng: number;
  stage: Stage;
  campaign: Campaign;
  delve: Delve | null;
  summary: DelveSummary | null;
  /** Why the campaign ended (stage 'over'). */
  overReason?: string;
}

// ---------------------------------------------------------------- commands

export type ActionKind =
  | 'attack'
  | 'pick' // pick a lock (door or chest), Burglar only
  | 'smash' // force a door or chest open, loud
  | 'open' // open/close an unlocked door; open an unlocked chest
  | 'take' // pick up ground loot or the contract item from an adjacent or own hex
  | 'drop'
  | 'give' // hand an item to an adjacent hero
  | 'disarm' // a spotted trap
  | 'light' // light an adjacent brazier
  | 'torch' // light a torch from the pack
  | 'potion' // drink, or give to an adjacent downed/hurt hero
  | 'revive' // an adjacent downed hero
  | 'charge' // place a blasting charge on an adjacent door, chest or cracked wall
  | 'rope' // anchor a rope at a pit edge
  | 'climb' // climb a rope between levels (whole turn)
  | 'jump' // jump into the pit (wounds)
  | 'shove' // push an adjacent enemy 1 hex (into the pit = it falls)
  | 'free' // free an adjacent prisoner
  | 'bribe' // pay a rival crew to leave
  | 'rally' // Hobart: +1 Focus to allies within 3, cooldown 3
  | 'guard' // Sellsword: guard an adjacent ally
  | 'firebolt' // Mage spell
  | 'kindle' // Mage spell: +12 light
  | 'mend' // Mage spell: heal 4 on an ally within 3
  | 'passLantern' // give the lantern to an adjacent hero
  | 'winch' // next to the winch: work it so the lift runs (loud)
  | 'leave'; // on an exit: leave the castle

export interface ActionTarget {
  /** Monster, rival, hero or prisoner id. */
  id?: string;
  at?: Pos;
  itemId?: string;
}

export type Command =
  // camp
  | { type: 'newCampaign'; seed: number }
  | { type: 'buy'; kind: ShopOffer['kind'] }
  | { type: 'sellAll' } // sell every valuable in the stash
  | { type: 'hire'; heroId: string }
  | { type: 'heal'; heroId: string }
  | { type: 'upgrade'; heroId: string; part: 'weapon' | 'armor' }
  | { type: 'startDelve'; contractId: string; heroIds: string[]; entrance: number; /** stash item ids per hero */ packs: Record<string, string[]> }
  // delve
  | { type: 'move'; heroId: string; path: Pos[]; sneak: boolean }
  | { type: 'act'; heroId: string; action: ActionKind; target: ActionTarget; focus: number }
  | { type: 'endTurn' }
  | { type: 'abandon' } // everyone still active flees: only heroes on exits get out
  // after the delve
  | { type: 'backToCamp' };

// ---------------------------------------------------------------- results and events

export interface SlotRoll {
  slots: number;
  /** Per-slot chance after modifiers, 0..100. */
  chance: number;
  /** Slots locked by Focus (always hit). */
  focus: number;
  /** One entry per slot: true = hit. Focused slots first. */
  results: boolean[];
  hits: number;
  perfect: boolean;
}

export type GameEvent =
  | { type: 'moved'; id: string; path: Pos[] }
  | { type: 'levelChanged'; id: string; from: number; to: number }
  | { type: 'roll'; who: string; what: string; roll: SlotRoll }
  | { type: 'hit'; attacker: string; target: string; damage: number; crit: boolean }
  | { type: 'miss'; attacker: string; target: string }
  | { type: 'downed'; id: string }
  | { type: 'revived'; id: string }
  | { type: 'died'; id: string }
  | { type: 'monsterDied'; id: string }
  | { type: 'doorChanged'; at: Pos; open: boolean; locked: boolean }
  | { type: 'chestOpened'; id: string; items: Item[] }
  | { type: 'looted'; id: string; items: Item[] }
  | { type: 'noise'; at: Pos; radius: number }
  | { type: 'light'; light: number; brightness: Brightness }
  | { type: 'brazierLit'; at: Pos }
  | { type: 'blast'; at: Pos }
  | { type: 'trap'; at: Pos; id: string; damage: number }
  | { type: 'trapSpotted'; at: Pos }
  | { type: 'awake'; id: string; awareness: Awareness }
  | { type: 'spawned'; id: string; at: Pos }
  | { type: 'gloam'; at: Pos }
  | { type: 'stolen'; by: string; from: string; item: Item }
  | { type: 'rivalsEnter'; at: Pos }
  | { type: 'rivalsStance'; stance: RivalCrew['stance'] }
  | { type: 'freed'; prisonerId: string }
  | { type: 'out'; id: string }
  | { type: 'phase'; phase: Delve['phase']; round: number }
  | { type: 'delveOver'; summary: DelveSummary }
  | { type: 'shoved'; id: string; from: Pos; to: Pos }
  | { type: 'fell'; id: string; from: Pos; to: Pos; levels: number; damage: number }
  | { type: 'breath'; by: string; hexes: Pos[] }
  | { type: 'liftWorking' }
  | { type: 'say'; text: string };

export interface ApplyResult {
  state: GameState;
  events: GameEvent[];
  /** Set when the command was refused; state is unchanged. A sentence for the player. */
  error?: string;
}
