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
  /** V3.7 (spec 20.3): a built wall no charge can break (stair shafts, the lift, outer walls). */
  unbreakable?: boolean;
  /**
   * V4.0 (spec 25.2): doors only: a barred gate. Only its key (the `unbar` action) or a blast
   * within 1 opens it; no Pick, Smash, skeleton key or crew job.
   */
  barred?: boolean;
  /** V4.0 (spec 25.3): cracked only: a heap of fallen stone choking a way (same rules as a cracked wall; drawn as rubble). */
  heap?: boolean;
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

export type MonsterKind = 'rats' | 'orc' | 'spider' | 'cutpurse' | 'berserker' | 'dragon' | 'archer' | 'captain' | 'ghoul';

export interface SpawnDef {
  at: Pos;
  kind: MonsterKind;
  /** Starts asleep (default false since V3.3; sleepers are chosen by the map). */
  asleep?: boolean;
  /** Named elite, if any. */
  name?: string;
  /** Patrol route: looping waypoints, first = the spawn hex. Awareness starts 'patrol'. */
  patrol?: Pos[];
  /** Ghouls: buried until a hero ends a move within 2 (default true for ghouls). */
  buried?: boolean;
  /** V3.7 (spec 20.1): the direction the monster faces when placed (0..5, hex.ts DIRS). Default 0. */
  facing?: number;
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
  /** V3.6 (spec 19.1): a story site, used only by its story contract, never by the regular board. */
  story?: StoryId;
  /** V3.7 (spec 20.4): a crew's hideout, used only by "Bring back <name>" contracts for that crew's captives. */
  hideout?: CrewId;
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

/** V4.0 (spec 25): the two Level 1 ways in that a new campaign finds shut. */
export type WayId = 'sally' | 'breach';

/**
 * V4.0 (spec 25): an entrance that starts shut on a new campaign and, once opened, stays open
 * for the rest of the campaign (as a way in and a way out).
 * - gate: `at` is one barred, locked door (TileDef.barred); its key or a blast opens it.
 * - rubble: `at` are cracked tiles with `heap`; a blast within 1 or a Dig clears them. The way is
 *   open once a walkable path joins the exit to the castle's first entrance.
 */
export interface ShutWayDef {
  id: WayId;
  /** Index into CastleDef.entrances. */
  entrance: number;
  kind: 'gate' | 'rubble';
  at: Pos[];
  /** gate only: where a copy of its key lies while the gate is shut. */
  keyAt?: Pos;
  /** Short hover/Set-out hint while shut, e.g. "Choked with rubble." */
  hint: string;
  /** Log line when it opens for good. */
  openLine: string;
}

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
  /** V4.0: names of the entrances, index order ("Main gate", "Sally port", "East breach"). */
  entranceNames?: string[];
  /** V4.0 (spec 25): entrances that start shut on a new campaign (none listed: all open). */
  shutWays?: ShutWayDef[];
  spawns: SpawnDef[];
  chests: ChestDef[];
  coins: CoinDef[];
  traps: TrapDef[];
  braziers: Pos[];
  contractSites: ContractSiteDef[];
  /** Where rival crews enter (exit tiles). */
  rivalEntrances: Pos[];
  /** V3.5 (spec 18.5): where a cutthroat crew waits (choke points on Level 2; V3.7 adds Level 3 posts for the Wake). */
  rivalPosts?: Pos[];
  /** Fixed lights: sconces, daylight, the forge, fungus, the Lair's fires. */
  lights: LightDef[];
}

// ---------------------------------------------------------------- heroes and items

/** V3.2 (spec 15.3): the mage split into three schools; ranger and sapper added. */
export type HeroClass =
  | 'heir'
  | 'sellsword'
  | 'burglar'
  | 'ranger'
  | 'sapper'
  | 'pyromancer'
  | 'shadowmancer'
  | 'hedgewitch';
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
  | 'hoard' // a piece of the Dragon's hoard: valuable, takes 2 slots
  // V3.2 quartermaster (spec 15.4); each takes 1 slot
  | 'smoke' // smoke bomb: throw 4, smoke on the hex and its neighbours for 2 rounds
  | 'glue' // glue bomb: throw 4, monsters within 1 are stuck for 2 rounds
  | 'dart' // sleep dart: throw 5, 1 Finesse slot, a hit puts a monster to sleep
  | 'caltrops' // scatter on an adjacent hex
  | 'hook' // grappling hook: reusable, climb up out of a pit landing
  | 'key' // skeleton key: opens one locked door or chest, silently
  | 'oil' // oil flask: +10 light
  | 'firecracker' // throw 6: noise 6 at the target hex
  // V3.6 (spec 19.2, 19.3)
  | 'lockpicks' // the smith's proper lockpicks: reusable; Burglar picks at 3 slots, anyone else at 2 (spec 21.4)
  | 'improvised' // V3.7.1: the Burglar's improvised pick, 1 per delve, used up on any Pick (2 slots)
  | 'nightsight' // night-eye draught: drink; 8 rounds without dark penalties (sight and rolls)
  // V4.0 (spec 25.2)
  | 'gatekey'; // the sally port key: opens the barred gate (unbar); carried out, the gate is open for good. Worth 0, never sold, handed over or stolen.

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
  /** V3.5 (spec 18.3): a heavy item (the brewing copper): its carrier moves 3 at most. */
  heavy?: boolean;
  /** V3.5: a story item goes to the village when carried out (not to the stash, never sold). */
  story?: StoryId;
}

export interface Hero {
  id: string;
  name: string;
  cls: HeroClass;
  level: number;
  xp: number;
  maxHp: number;
  /** Spec 17.2: HP carries over between delves; only the infirmary restores it (for gold). */
  hp: number;
  stats: Stats;
  /** Smithy upgrades: weapon +10% per slot per tier, armor +1 per tier. */
  weaponTier: 0 | 1 | 2;
  armorTier: 0 | 1 | 2;
  /** V3.7 (spec 20.5): a shield from the forge: ranged hits do 1 less (2 less while braced). */
  shield?: boolean;
  /** Unused since V3.4 (always 0): hurt heroes now keep their HP instead of sitting out (spec 17.2). */
  wounded: number;
  /** Delves survived, for the memorial and bragging. */
  delves: number;
  kills: number;
  /** V3.5 (spec 18.4): an ale bought at the Flagon, drunk at the start of this hero's next delve. */
  ale?: AleKind;
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
  /** V3.5 (spec 18.2): a story contract; done, it unlocks that part of the village. */
  story?: StoryId;
}

// ---------------------------------------------------------------- V3.5: the village (spec 18)

/** Story contracts and the villagers or things they bring home to Lowgate. */
export type StoryId = 'surgeon' | 'innkeeper' | 'smith' | 'copper' | 'caskbook';

/** What Lowgate has won back. All false at the start. */
export interface Village {
  /** Brother Aldric is home: the infirmary heals for gold. */
  surgeon: boolean;
  /** Old Wim is home: the Gilded Flagon replaces the campfire (4 recruits, some level 2). */
  innkeeper: boolean;
  /** Gerda is home: the forge (smithy tiers) and metalwork (caltrops, hook, key). */
  smith: boolean;
  /** The brewing copper is home: the first four ales. */
  copper: boolean;
  /** Wim's cask book is home: the rest of the ales and level 3 recruits. */
  caskbook: boolean;
}

export type AleKind = 'glowworm' | 'featherfoot' | 'mole' | 'reserve' | 'smuggler' | 'fireside' | 'blackcask';
/** What an ale does once drunk: the Black Cask turns into another ale or a drawback. */
export type AleEffect = Exclude<AleKind, 'blackcask'> | 'hiccups' | 'heavyhead';

export interface AleOffer {
  kind: AleKind;
  name: string;
  price: number;
  text: string;
  /** What has to be home before it's poured. */
  needs: 'copper' | 'caskbook';
  /** Why it can't be bought now (not brewed yet), if so. */
  locked?: string;
}

export type ShopKind =
  | 'torch' | 'potion' | 'rope' | 'charge'
  | 'smoke' | 'glue' | 'dart' | 'caltrops' | 'hook' | 'key' | 'oil' | 'firecracker'
  | 'lockpicks' | 'nightsight';

export interface ShopOffer {
  kind: ShopKind;
  name: string;
  price: number;
  text: string;
  /** V3.5 (spec 18.2): metalwork needs the smith home; V3.7.1 (spec 21.3): the night-eye draught needs the innkeeper. */
  needs?: 'smith' | 'innkeeper';
  /** Why it can't be bought now, if so ("Needs a smith: rescue Gerda"). */
  locked?: string;
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
  /** V3.5 (spec 18): what Lowgate has won back. */
  village: Village;
  /** V3.7 (spec 20.4): heroes a crew carried off; each has a rescue contract on the board until freed or given up. */
  captives: Captive[];
  /**
   * V4.0 (spec 25): the shut ways in (CastleDef.shutWays) opened for good. A new campaign starts with
   * `{}` (all shut); a save without the field had every entrance open, so the field absent = all open.
   */
  opened?: Partial<Record<WayId, boolean>>;
  /** V4.0 (spec 25.5): every hex the campaign's delves have seen, as hex keys "q,r" by level. Merged in at backToCamp. */
  explored?: Record<number, string[]>;
}

export interface Captive {
  hero: Hero;
  /** The crew that took them and where they're held (the crew's hideout site). */
  crew: CrewId;
  siteId: string;
  /** Delve count when taken. */
  delve: number;
}

// ---------------------------------------------------------------- delve

export type Brightness = 'bright' | 'dim' | 'dark' | 'pitch';
export type Awareness = 'asleep' | 'alert' | 'hunting' | 'patrol';

export interface HeroInDelve {
  heroId: string;
  at: Pos;
  /** V3.9 (spec 24.2): the hex direction (0..5, hex.ts DIRS) the hero faces; they see only their front half. */
  facing?: number;
  hp: number;
  focus: number;
  /** Pack, 4 slots. */
  pack: Item[];
  /** V3.5 (spec 18.4): the ale this hero drank for this delve (the Black Cask already resolved). */
  ale?: AleEffect;
  /** Featherfoot: the free fall has been used. */
  aleSpent?: boolean;
  /** V3.6 (spec 19.3): rounds of night-eye left: no dark penalties to sight or rolls. */
  nightEyes?: number;
  /** V3.7 (spec 20.5): braced until the next player phase: hits do 1 less, enemies −15% to hit; shield counts double. */
  braced?: boolean;
  /** V3.7 (spec 20.5): rounds rooted by a hamstring or briar: can't move or dash, can act. */
  rooted?: number;
  /** 'active' on the map, 'downed' bleeding out, 'out' left the castle, 'dead', 'captured' (spec 20.4: taken by a crew). */
  status: 'active' | 'downed' | 'out' | 'dead' | 'captured';
  /** Downed only: world phases left before death (starts at 2). */
  bleed: number;
  /** Rounds of torchlight left on this hero's own torch (0 = none lit). */
  torch: number;
  moved: boolean;
  acted: boolean;
  /** Rooted by a web: can't move this turn. */
  webbed: boolean;
  /** Pyromancer, Shadowmancer, Hedgewitch: mana left. */
  mana: number;
  /** The heir (Keven) only: rounds until Rally is ready (0 = ready). */
  rallyCooldown: number;
  /** Sellsword only: id of the ally guarded until the next player phase. */
  guarding?: string;
  /** Escorted prisoner follows this hero. */
  escorting?: string;
  /** Was revived this delve: leaves Wounded. */
  revived: boolean;
  /** Moved a second time this turn (a dash, spec 15.2); the action is spent. */
  dashed: boolean;
  /** Held by a ghoul (monster id): can't move or dash until freed (spec 16.4). */
  grabbedBy?: string;
  /** Ranger: on overwatch until the end of the next world phase. Draw the eye icon and a 6-hex cone. */
  overwatch: boolean;
  /** Veiled (Shadowmancer): rounds left; monsters can't see this hero while > 0. Draw translucent. */
  veil: number;
  /** Warded (Hedgewitch): rounds left; takes 1 less per hit while > 0. Draw a shield glint. */
  ward: number;
}

export interface Intent {
  /**
   * shove: push targetId one hex away from the monster (`to` = where they'll end up; may be a pit).
   * breath: the Dragon's fire; every hero on `hexes` takes the damage next world phase.
   * sweep: the Dragon's tail; every adjacent hero is shoved one hex.
   */
  /**
   * shout: the captain rallies every orc within 8 next phase. drag: the spider pulls the webbed
   * targetId one hex toward it (`to`). grab: the ghoul holds targetId. Rivals also use
   * overwatch / smoke / veil / dart (spec 16.5): `to` = the hex a bomb lands on.
   */
  kind: 'attack' | 'move' | 'web' | 'steal' | 'flee' | 'wait' | 'shove' | 'breath' | 'sweep' | 'shout' | 'drag' | 'grab' | 'overwatch' | 'smoke' | 'veil' | 'dart' | 'toll' | 'firebolt' | 'charge' | 'fuse' | 'rob' | 'potion' | 'item' | 'fireball' | 'mend' | 'gust' | 'ward' | 'glue' | 'caltrops' | 'firecracker' | 'blink' | 'hamstring';
  /** V3.7 `item` intents: which item. */
  item?: ItemKind;
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
  spawnedAt: Pos;
  /** Glued: rounds left stuck in place (can still attack adjacent). Absent = 0. */
  stuck?: number;
  /** Patrol route and the index of the waypoint it's heading to. */
  route?: Pos[];
  routeIndex?: number;
  /** Alert rounds left before it gives up and returns to post/route. */
  searchRounds?: number;
  /** Ghoul: hero id it holds. */
  holding?: string;
  /** Captain: rounds until it may shout again. */
  shoutCooldown?: number;
  /** Buried ghoul: not on the map until it rises. */
  buried?: boolean;
  /** V3.7 (spec 20.1): heroes this monster has noticed (sneak attack and backstab apply to the others). */
  noticedIds?: string[];
  /** V3.7 (spec 20.1): the hex direction (0..5, see hex.ts DIRS) it faces: the way it last moved or looked. */
  facing?: number;
  /** V3.7 (spec 20.2): rounds of fear left: it flees from `fearOf` instead of acting. */
  feared?: number;
  fearOf?: string;
}

/** V3.5 (spec 18.5): the Sisters on Level 1; cutthroat crews on Level 2, from a pool. */
export type CrewId = 'lantern-sisters' | 'ferrymen' | 'gallows-choir' | 'the-wake';
export type RivalClass = 'ranger' | 'shadowmancer' | 'burglar' | 'sellsword' | 'sapper' | 'pyromancer' | 'hedgewitch';
/** Parley deals (spec 18.6). 'truce' is the toll when a cutthroat crew demands one. */
export type DealKind = 'leave' | 'truce' | 'job' | 'hire' | 'fight';
export type JobKind = 'winch' | 'open' | 'scout';

export interface DealOption {
  deal: DealKind;
  job?: JobKind;
  label: string;
  /** Gold value asked; 0 for fight. */
  price: number;
  /** What it buys, in a sentence. */
  text: string;
  /** What would be handed over, in words: "35 gold and a ruby (60)". */
  pays?: string;
  /** Shown before you commit, e.g. backstab odds for hire. */
  risk?: string;
  ok: boolean;
  /** Why it can't be done now. */
  blocked?: string;
}

export interface Rival {
  id: string;
  crew: CrewId;
  name: string;
  at: Pos;
  hp: number;
  maxHp: number;
  /** Gold and items they've picked up. */
  loot: Item[];
  goneOut: boolean;
  /** Class and kit (spec 16.5, 18.5). */
  cls: RivalClass;
  intent?: Intent;
  /** Kit uses left: darts, smoke; veil rounds left; overwatch armed. */
  darts?: number;
  smoke?: number;
  veil?: number;
  overwatch?: boolean;
  /** Sapper: charges left; Pyromancer: firebolts left (spec 18.5). */
  charges?: number;
  /** V3.7 (spec 20.1, 20.2, 20.4). */
  facing?: number;
  feared?: number;
  fearOf?: string;
  /** Spec 20.4: level, tiers and a pack like a hero's. */
  level?: number;
  weaponTier?: 0 | 1 | 2;
  armorTier?: 0 | 1 | 2;
  pack?: Item[];
  /** Spec 20.4: the downed hero this member is dragging out. */
  dragging?: string;
  /** V3.7 (spec 20.1): heroes this member has noticed (sneak attack applies to the others). */
  noticedIds?: string[];
  /** V3.7 (spec 20.5): rounds rooted by a hamstring or briar: no walking. */
  stuck?: number;
}

export interface RivalCrew {
  crew: CrewId;
  name: string;
  /** Spec 18.5: prospectors race you for loot; cutthroats wait on Level 2 and demand a toll. */
  temperament: 'prospector' | 'cutthroat';
  /**
   * neutral: looting, not fighting. waiting: a cutthroat crew at its post. demanding: the toll
   * is asked (`toll`), they attack next world phase unless paid. hostile: fighting. bribed: paid
   * to leave. truce: paid not to attack (they may still loot). hired: fighting beside you
   * (`hiredRounds` left).
   */
  stance: 'neutral' | 'waiting' | 'demanding' | 'hostile' | 'bribed' | 'truce' | 'hired';
  /** What they're doing now, shown once spotted. */
  goal: 'loot' | 'objective' | 'leave';
  /** Spec 18.6: what they're after, for the parley card ("the chapel chest", 3 rounds, ~60 gold). */
  aim?: { at: Pos; what: string; rounds: number; value: number };
  /** Gold value of the toll asked while demanding. */
  toll?: number;
  /** Rounds of sell-sword service left. */
  hiredRounds?: number;
  /** A job paid for and not yet done. */
  job?: { kind: JobKind; at?: Pos };
  spotted: boolean;
  /** Round they enter; they're off the map before it. */
  entersRound: number;
  members: Rival[];
}

/** V3.9.3 (spec 24.8): a sound the heroes heard from something they can't see. Where, not who. */
export interface Heard {
  at: Pos;
  /** steps: footsteps (a walking monster or crew member); loud: a fight, a shout, a smash, a blast, a roar. */
  kind: 'steps' | 'loud';
  /** For loud sounds, what it sounded like: 'clash' | 'shout' | 'crash' | 'blast' | 'roar' | 'scream'. */
  what?: string;
  /** Order heard within the world phase (for a footstep trail). */
  n: number;
}

export interface Fuse {
  at: Pos;
  /** World phases left before it goes off (1 = the end of the coming world phase). */
  rounds: number;
  /** Who set it (hero or rival id), for kills and the blast shield. */
  by: string;
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
  /** Cracked walls blown open, built walls broken, and rubble/cracked walls dug out, by posKey. Engine kindAt treats these as floor (rubble for broken walls, spec 20.3). */
  blown: string[];
  /** V3.7 (spec 20.3): charges set or thrown with a fuse, by anyone; they go off at the end of a world phase. */
  fuses?: Fuse[];
  /** V3.7 (spec 20.5): the party is calm (free movement). Steps walked since the castle's last turn. */
  calm?: boolean;
  calmSteps?: number;
  /** Crates and barrels smashed, by posKey (the hex is floor now). */
  smashed?: string[];
  /** V3.9.3 (spec 24.8): what the heroes heard during the last world phase (unseen enemies only); cleared when the next one starts. */
  heard?: Heard[];
  /** V3.7 (spec 20.3): floor blown open next to a pit, by posKey: the hex is a pit now (the column widens). */
  collapsed?: string[];
  /** V3.7 (spec 20.3): rubble (natural, blast-made or a cracked wall's) dug out, by posKey: floor now. */
  dug?: string[];
  /** Ropes anchored at the pit, by posKey of the edge hex. */
  ropes: string[];
  /** The winch has been worked: the lift runs between its two ends. */
  liftWorking: boolean;
  /** Lantern shutter (spec 16.2): open burns oil and lights; shuttered does neither. */
  lanternOpen: boolean;
  /** Patrollers whose route a hero has watched (monster ids). */
  knownRoutes: string[];
  /** Level 3 Gloam: world phases in a row with every hero lit (fades at 2). */
  gloamCalm: number;
  /** Smoke clouds: rounds left by posKey. Smoke blocks sight (not light). */
  smoke: Record<string, number>;
  /** Glue puddles: rounds left by posKey (drawing only; the stuck state is Monster.stuck). */
  glue: Record<string, number>;
  /** Burning hexes (fireball): rounds left by posKey. Anyone on one at the world phase takes 1; they light themselves. */
  burning: Record<string, number>;
  /** Caltrops scattered, by posKey. The first monster to step on one takes 2 and stops. */
  caltrops: string[];
  prisoner: Prisoner | null;
  /** Hexes ever seen, by posKey. */
  explored: string[];
  /** V4.0 (spec 25): shut ways in that are open in this delve (opened before it or during it). Merged into Campaign.opened at backToCamp. */
  ways?: Partial<Record<WayId, boolean>>;
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
  /** Survivors who came out below full HP (spec 17.2). */
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
  | 'nightsight' // V3.6: drink the night-eye draught (action)
  // V3.7 (spec 20.5)
  | 'brace' // heir, sellsword, sapper [self]: action; braced until the next player phase
  | 'hamstring' // anyone with a bow [enemy]: 1 Finesse slot at −20, range 5; a hit roots 2 rounds
  | 'nightthorn' // Shadowmancer [enemy]: 1 mana, 2 Wits slots, 1 dmg per hit ignoring armor, range 5, silent
  | 'briar' // Hedgewitch [enemy]: 1 mana, 2 Wits slots at range 4, 1 dmg per hit; any hit roots 1 round (perfect: 2); noise 1
  | 'smashProp' // [adjacent crate or barrel]: action, noise 4; may drop gold or a small item
  | 'setCharge' // V3.7 Sapper [hex adjacent, floor or breakable wall]: set a charge with a fuse (target.fuse 1 or 2)
  | 'dread' // V3.7 Shadowmancer [enemy]: 1 mana, 2 Wits slots at range 5, 1+ hits = feared 2 rounds
  | 'parley' // V3.5: open the deal card with a crew in sight within 4 (free; the deal is a 'deal' command)
  | 'rally' // the heir: +1 Focus to allies within 3, cooldown 3
  | 'guard' // Sellsword: guard an adjacent ally
  | 'firebolt' // Mage spell
  | 'kindle' // Mage spell: +12 light
  | 'mend' // Mage spell: heal 4 on an ally within 3
  | 'passLantern' // give the lantern to an adjacent hero
  | 'winch' // next to the winch: work it so the lift runs (loud)
  | 'shutter' // lantern bearer: open or shutter the lantern (free)
  | 'escape' // held by a ghoul: 2 Might slots, 1 hit frees
  | 'leave' // on an exit: leave the castle
  // ---- V3.2 class abilities (target kind in brackets: self / ally id / enemy id / hex at)
  | 'overwatch' // Ranger [self]: shoot the first enemy that moves or acts in sight within 6 next world phase
  | 'knockback' // Ranger [enemy]: 2 Finesse slots, range 5, 2 hits push it 1 hex away from the Ranger
  | 'throwCharge' // Sapper [hex, itemId = the charge]: throw a charge up to 3; blows at the end of the turn
  | 'dig' // Sapper [hex]: clear adjacent rubble or a cracked wall, noise 4
  | 'fireball' // Pyromancer [hex]: 2 mana, radius 1 at range 5, 3 Wits slots, 2 dmg per hit, burning 2 rounds, noise 6
  | 'veil' // Shadowmancer [ally id, self included]: 1 mana, within 3, unseen by monsters 2 rounds
  | 'sleep' // Shadowmancer [enemy]: 1 mana, 2 Wits slots at range 5, 1+ hits = asleep
  | 'blink' // Shadowmancer [hex]: 1 mana, teleport up to 4 to a free hex in sight, same level, silent
  | 'ward' // Hedgewitch [ally id, self included]: 1 mana, within 3, 1 less per hit for 2 rounds
  | 'gust' // Hedgewitch [hex]: 1 mana, range 4, every figure within 1 of the hex pushed 1 away from it, noise 2
  // ---- V3.2 items (target carries itemId)
  | 'smoke' // [hex] throw 4
  | 'glue' // [hex] throw 4
  | 'dart' // [enemy] throw 5, 1 Finesse slot
  | 'caltrops' // [hex] adjacent free hex
  | 'firecracker' // [hex] throw 6, noise 6 there
  | 'key' // [hex] adjacent (or own hex) locked door or chest, silent
  | 'unbar' // V4.0 [hex] the sally port key on the adjacent barred gate: opens it for good, silent
  | 'oil' // [self] +10 light
  | 'grapple'; // [hex on the level above] uses move and action; the hook is kept

export interface ActionTarget {
  /** V3.7 setCharge: fuse length in world phases (1 or 2). */
  fuse?: 1 | 2;
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
  | { type: 'buyShield'; heroId: string } // V3.7 camp (spec 20.5): 50 gold at the forge
  | { type: 'drink'; heroId: string } // V3.5 camp: drink a stash potion, +5 HP
  | { type: 'buyAle'; heroId: string; ale: AleKind } // V3.5: at the Flagon, for the hero's next delve
  | { type: 'upgrade'; heroId: string; part: 'weapon' | 'armor' }
  | { type: 'startDelve'; contractId: string; heroIds: string[]; entrance: number; /** stash item ids per hero */ packs: Record<string, string[]> }
  // delve
  /**
   * Path of any length while the party is calm (spec 20.5 free movement): the engine walks it hex by
   * hex, the castle taking a turn every CALM_STEPS steps, and stops when calm ends. `follow` brings
   * the other active heroes within 3 along behind.
   */
  | { type: 'move'; heroId: string; path: Pos[]; sneak: boolean; follow?: boolean }
  | { type: 'act'; heroId: string; action: ActionKind; target: ActionTarget; focus: number }
  | { type: 'endTurn' }
  | { type: 'face'; heroId: string; facing: number } // V3.9 (spec 24.2): turn to face a direction; free, player phase
  | { type: 'deal'; heroId: string; deal: DealKind; job?: JobKind } // V3.5 parley (spec 18.6), free
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
  | { type: 'hit'; attacker: string; target: string; damage: number; crit: boolean; /** V3.9: a Burglar's backstab */ backstab?: boolean }
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
  | { type: 'trap'; at: Pos; id: string; damage: number }
  | { type: 'trapSpotted'; at: Pos }
  | { type: 'awake'; id: string; awareness: Awareness }
  | { type: 'spawned'; id: string; at: Pos }
  | { type: 'gloam'; at: Pos }
  | { type: 'stolen'; by: string; from: string; item: Item }
  | { type: 'rivalsEnter'; at: Pos }
  | { type: 'rivalsStance'; stance: RivalCrew['stance'] }
  | { type: 'deal'; deal: DealKind; job?: JobKind; price: number; paid: string[] } // V3.5
  | { type: 'betrayed' } // V3.5: sell-swords turn on the party when their deal ends
  | { type: 'villageUnlocked'; story: StoryId } // V3.5, on backToCamp
  // V3.7
  | { type: 'noticed'; by: string; hero: string } // an awake monster or crew member spots a hero (spec 20.1)
  | { type: 'woke'; id: string; by: string } // a sleeper woken by a passing hero
  | { type: 'swing'; by: string; target: string; hits: number; damage: number } // attack of opportunity (spec 20.2)
  | { type: 'feared'; id: string; by: string }
  | { type: 'fuseSet'; at: Pos; rounds: number; by: string }
  | { type: 'blast'; at: Pos; by: string; broke: Pos[]; collapsed?: Pos[]; rubbled?: Pos[] } // a charge went off; walls broken, floor dropped into the pit, floor turned to rubble
  | { type: 'captured'; hero: string; by: string } // dragged out of the castle by a crew
  | { type: 'robbed'; hero: string; by: string; items: Item[] }
  | { type: 'heard'; sound: Heard } // V3.9.3 (spec 24.8): the heroes hear something they can't see
  | { type: 'faced'; id: string; facing: number } // V3.9: a hero turned (free) or turned by moving/acting
  | { type: 'unseenHit'; target: string } // V3.9 (spec 24.2): something the party can't see attacked this hero from behind
  | { type: 'calm'; calm: boolean; why?: string } // spec 20.5: free movement starts or ends ("An orc has seen Pim")
  | { type: 'walkStopped'; heroId: string; at: Pos; why: string } // spec 20.5: a calm walk halted early while still calm (a trap, a new monster in sight)
  | { type: 'propSmashed'; at: Pos; by: string; items: Item[] }
  | { type: 'rooted'; id: string; by: string; rounds: number }
  | { type: 'braced'; id: string }
  | { type: 'freed'; prisonerId: string }
  | { type: 'out'; id: string }
  | { type: 'phase'; phase: Delve['phase']; round: number }
  | { type: 'delveOver'; summary: DelveSummary }
  | { type: 'shoved'; id: string; from: Pos; to: Pos }
  | { type: 'fell'; id: string; from: Pos; to: Pos; levels: number; damage: number }
  | { type: 'breath'; by: string; hexes: Pos[] }
  | { type: 'liftWorking' }
  /** An item thrown (smoke, glue, dart, firecracker, caltrops, a Sapper's charge): animate from -> to. */
  | { type: 'thrown'; by: string; kind: ItemKind; from: Pos; to: Pos }
  /** A spell or ability went off. `hexes` = the area (fireball, gust, smoke, glue). Overwatch firing = spell 'overwatch'. */
  | { type: 'cast'; by: string; spell: ActionKind; at?: Pos; targetId?: string; hexes?: Pos[] }
  /** Blink: teleport, no path. */
  | { type: 'blinked'; id: string; from: Pos; to: Pos }
  /** Dig: rubble or a cracked wall at `at` is now floor (it's in Delve.blown). */
  | { type: 'dug'; at: Pos }
  /** A monster stepped on caltrops (they're gone). */
  | { type: 'caltrops'; id: string; at: Pos }
  | { type: 'shout'; id: string }
  | { type: 'dragged'; id: string; from: Pos; to: Pos }
  | { type: 'grabbed'; by: string; id: string }
  | { type: 'released'; id: string }
  | { type: 'shutter'; open: boolean }
  | { type: 'routeKnown'; id: string; route: Pos[] }
  | { type: 'say'; text: string };

export interface ApplyResult {
  state: GameState;
  events: GameEvent[];
  /** Set when the command was refused; state is unchanged. A sentence for the player. */
  error?: string;
}
