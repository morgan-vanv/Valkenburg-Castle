// The engine's public surface. The renderer and UI import only from here
// and from types.ts / geometry.ts. Everything is pure: functions take a
// GameState and return data; apply() returns a new state plus events.

import type { ApplyResult, CastleMap, Command, Contact, Coord, Frontage, GameState, Modifier, SpellId, Unit, AlarmTier, DoorMethod } from './types';

export interface Reach {
  to: Coord;
  /** Movement points spent. */
  cost: number;
  /** Squares walked, start excluded, destination last. */
  path: Coord[];
}

export interface AttackPreview {
  ok: boolean;
  reason?: string;
  frontage: Frontage;
  slots: number;
  /** Per-slot hit chance after modifiers, 0..100. */
  chance: number;
  modifiers: Modifier[];
  /** Focus the attacker may spend (min of its Focus and slots). */
  maxFocus: number;
  /** Expected wounds with the given Focus spend, including the Perfect bonus. */
  expectedWounds: number;
}

/** One thing the selected unit can do right now. */
export type ActionOption =
  | { kind: 'move'; cost: 1 }
  | { kind: 'melee'; targetIds: string[] }
  | { kind: 'missile'; targetIds: string[] }
  | { kind: 'door'; edge: string; methods: DoorMethod[]; locked: boolean; secured: boolean }
  | { kind: 'chest'; chestId: string; methods: Exclude<DoorMethod, 'blast'>[] }
  | { kind: 'search'; progress: number; needed: number }
  | { kind: 'pickUp'; itemIds: string[] }
  | { kind: 'drop'; itemIds: string[] }
  | { kind: 'give'; toIds: string[] }
  | { kind: 'giveFocus'; toIds: string[] }
  | { kind: 'overwatch' }
  | { kind: 'shieldwall'; facings: Coord[] }
  | { kind: 'cast'; spell: SpellId; cost: number; targets: Coord[]; targetIds: string[]; edges: string[] }
  | { kind: 'jump'; targets: Coord[] }
  | { kind: 'climb'; targets: Coord[] }
  | { kind: 'exit' };

export interface CarryInfo {
  weight: number;
  limit: number;
  value: number;
  /** −1 move when over the limit; cannot move when over twice the limit. */
  overloaded: boolean;
  immobile: boolean;
}

export interface Visibility {
  /** Squares lit and in sight right now, by squareKey. */
  visible: Set<string>;
  /** Squares ever seen this expedition, by squareKey. */
  explored: Set<string>;
  /** Enemy units the player can see. */
  enemies: Unit[];
  /** Awake enemies (and dummies) heard but not seen. */
  contacts: Contact[];
}

export interface Engine {
  /** The castle map the game runs on. */
  map(): CastleMap;
  newCampaign(seed?: number): GameState;
  apply(state: GameState, cmd: Command): ApplyResult;

  reachable(state: GameState, unitId: string): Reach[];
  actions(state: GameState, unitId: string): ActionOption[];
  previewAttack(state: GameState, unitId: string, targetId: string, kind: 'melee' | 'missile', focus: number): AttackPreview;
  visibility(state: GameState): Visibility;
  carry(unit: Unit): CarryInfo;
  /** Area id for a square (rooms, corridors), and whether it's a searchable room. */
  area(coord: Coord): { id: number; isRoom: boolean; squares: Coord[] } | undefined;
  alarmTier(alarm: number): AlarmTier;
  moveAllowance(state: GameState, unit: Unit): number;

  serialize(state: GameState): string;
  deserialize(text: string): GameState;
}
