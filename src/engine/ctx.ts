// The working context for one apply() call: the mutable state copy, the map
// index, and the events emitted so far.

import { STATS } from './data';
import { sameSquare, squareKey } from './geometry';
import type { MapIndex } from './mapIndex';
import type { Coord, Expedition, GameEvent, GameState, Side, Unit } from './types';

export class RuleError extends Error {}

export class Ctx {
  readonly events: GameEvent[] = [];

  constructor(
    readonly state: GameState,
    readonly ix: MapIndex,
  ) {}

  get map() {
    return this.ix.map;
  }

  get exp(): Expedition {
    if (!this.state.expedition) throw new RuleError('No expedition is under way.');
    return this.state.expedition;
  }

  emit(e: GameEvent): void {
    this.events.push(e);
  }

  log(text: string): void {
    this.exp.log.push(text);
    if (this.exp.log.length > 200) this.exp.log.shift();
    this.emit({ type: 'log', text });
  }

  /** A unit still in play (inside, alive). */
  unit(id: string): Unit {
    const u = this.exp.units.find((x) => x.id === id);
    if (!u || u.exited) throw new RuleError('That unit is not in the castle.');
    return u;
  }

  findUnit(id: string): Unit | undefined {
    return this.exp.units.find((x) => x.id === id && !x.exited);
  }

  /** Units in play: alive and inside. */
  live(side?: Side): Unit[] {
    return this.exp.units.filter((u) => !u.exited && (side === undefined || u.side === side));
  }

  /** Real fighting units in play (dummies excluded). */
  fighters(side?: Side): Unit[] {
    return this.live(side).filter((u) => u.cls !== 'dummy');
  }

  unitsAt(c: Coord): Unit[] {
    return this.live().filter((u) => sameSquare(u.pos, c));
  }

  menIn(c: Coord, side: Side): number {
    return this.unitsAt(c)
      .filter((u) => u.side === side && u.cls !== 'dummy')
      .reduce((n, u) => n + (STATS[u.cls].isSquad ? u.men : 1), 0);
  }

  hasEnemyAt(c: Coord, side: Side): boolean {
    return this.unitsAt(c).some((u) => u.side !== side && u.cls !== 'dummy');
  }

  nextId(prefix: string): string {
    return `${prefix}${this.state.nextId++}`;
  }

  key(c: Coord): string {
    return squareKey(c);
  }
}

export function other(side: Side): Side {
  return side === 'player' ? 'castle' : 'player';
}
