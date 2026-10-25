// Engine-private extensions of the contract types. These extra fields live in
// the same JSON (they survive structuredClone and serialize); the view ignores them.

import type { Pos } from './hex';
import type { Delve, GameEvent, GameState, HeroInDelve, Monster, Rival, RivalCrew } from './types';
import type { World } from './world';

export interface MonsterX extends Monster {
  /** Orc: has shouted already. */
  shouted?: boolean;
  /** Spider: round of the last web. */
  lastWeb?: number;
  /** Orc shove: the hex the orc shoves from. */
  shoveFrom?: Pos;
  /** Dragon: its next intent (once awake) is breath. */
  breathNext?: boolean;
  /** Spawn level tier (16.3): 1, 2 or 3. Absent = 1. */
  tier?: number;
  /** Patrol: the waypoint index to head for once the planned walk is done. */
  routeAfter?: number;
  /** Lost its quarry and is walking back to its post / route. */
  returning?: boolean;
  /** V3.7 (spec 20.1): heroes it has noticed (ids); cleared when it loses its quarry or sleeps. A hero not in it is open to a sneak attack. */
  noticedIds?: string[];
}

export interface HeroX extends HeroInDelve {
  /** Hit by a sister's sleep dart: loses the next move and action (cleared with webbed). */
  dozing?: boolean;
  /** V3.7 (spec 20.1): the last move was a sneak (undefined = never moved: counts as walking). Monsters notice by it. */
  sneaked?: boolean;
  /** V3.7 (spec 20.4): a hostile crew member has already taken this (downed) hero's gold and gems. */
  robbed?: boolean;
}

export interface RivalX extends Rival {
  /** Has veiled herself already (the Shadowmancer sister veils once, when first spotted). */
  veiled?: boolean;
  /** Rounds of the last kit use, to keep intents honest. */
  armedRound?: number;
  /** Cutthroats: the hex they hold (spec 18.5). */
  post?: Pos;
  /** Level tier (cutthroats 2: +2 HP, +5 hit). Absent = 1. */
  tier?: number;
  /** Sellsword shove: the hex it shoves from. */
  shoveFrom?: Pos;
  /** V3.7 (spec 20.4): the Sellsword guards this member (takes hits meant for it while adjacent). */
  guarding?: string;
  /** V3.7 (spec 20.4): warded by the Hedgewitch: rounds left of 1 less per hit. */
  ward?: number;
  /** V3.7: the kit intent's helper hex (a Sapper's set spot, a potion's step back). */
  kitFrom?: Pos;
  /** V3.7 (spec 20.5): rounds rooted by a hamstring or briar (like a monster's `stuck`): no walking. */
  stuck?: number;
}

export interface CrewX extends RivalCrew {
  members: RivalX[];
  pickups?: number;
  entered?: boolean;
  /** Rounds in a row a sister couldn't get closer to her goal. */
  blocked?: number;
  /** V3.5: the hero who hired them (spec 18.6). */
  hiredBy?: string;
  /** Round the toll was demanded: they turn hostile at the next world phase. */
  demandRound?: number;
  /** Round of the last deal (one deal per crew per round). */
  dealRound?: number;
  /** Chests a paid job opened for the party: the crew leaves the loot alone. */
  spare?: string[];
  /** V3.7 (spec 20.4): the hero the whole crew goes for this round (focus fire). */
  target?: string;
}

export interface DelveX extends Delve {
  heroes: HeroX[];
  monsters: MonsterX[];
  rivals: CrewX | null;
  /** V3.7 (spec 20.3): blast rubble (broken walls in `blown`) dug out to floor, by posKey. */
  dug?: string[];
  /** V3.7 (spec 20.4): caltrops a crew laid (also in `caltrops`): these catch heroes. */
  rivalCaltrops?: string[];
  /** XP earned this delve by hero id (kills). */
  xp?: Record<string, number>;
  /** Item ids dropped by heroes who died (become lostGear). */
  lostIds?: string[];
  /** Where heroes died, by hero id. */
  diedAt?: Record<string, Pos>;
  /** Summary notes collected along the way. */
  notes?: string[];
  nextMonster?: number;
  /** Stash items taken into the delve. */
  taken?: string[];
  /** The Dragon died this delve. */
  dragonSlain?: boolean;
}

export interface GameStateX extends GameState {
  delve: DelveX | null;
  /** Counter for item ids. */
  nextId?: number;
  /** Counter for hero ids. */
  nextHero?: number;
  /** Hoard pieces carried out so far (they don't come back). */
  hoardTaken?: number;
}

export interface Ctx {
  w: World;
  s: GameStateX;
  d: DelveX;
  ev: GameEvent[];
  /** Memo of visibleSet for target queries; cleared by refreshSight/setLight. */
  visCache?: Set<string>;
}

export function newItemId(s: GameStateX): string {
  s.nextId = (s.nextId ?? 1) + 1;
  return `i${s.nextId - 1}`;
}

export function note(c: Ctx, text: string): void {
  (c.d.notes ??= []).push(text);
}

export function say(c: Ctx, text: string): void {
  c.ev.push({ type: 'say', text });
  c.d.log.push(text);
  if (c.d.log.length > 60) c.d.log.splice(0, c.d.log.length - 60);
}
