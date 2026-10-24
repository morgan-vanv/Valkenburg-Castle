// Engine-private extensions of the contract types. These extra fields live in
// the same JSON (they survive structuredClone and serialize); the view ignores them.

import type { Pos } from './hex';
import type { Delve, GameEvent, GameState, Monster, RivalCrew } from './types';
import type { World } from './world';

export interface MonsterX extends Monster {
  /** Orc: has shouted already. */
  shouted?: boolean;
  /** Spider: round of the last web. */
  lastWeb?: number;
}

export interface CrewX extends RivalCrew {
  pickups?: number;
  entered?: boolean;
}

export interface DelveX extends Delve {
  monsters: MonsterX[];
  rivals: CrewX | null;
  /** Blasting charges waiting for the end of the player phase. */
  charges?: { at: Pos; by: string }[];
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
}

export interface GameStateX extends GameState {
  delve: DelveX | null;
  /** Counter for item ids. */
  nextId?: number;
  /** Counter for hero ids. */
  nextHero?: number;
}

export interface Ctx {
  w: World;
  s: GameStateX;
  d: DelveX;
  ev: GameEvent[];
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
