// Searching rooms, treasure, traps, chests and carrying (spec 6; 7.0).

import { applyWounds } from './combat';
import { die } from './dice';
import { specialRow, trapRow, treasureRow } from './data';
import { label, sameSquare, squareKey } from './geometry';
import { areaAt } from './mapIndex';
import { openLock } from './doors';
import { RuleError, type Ctx } from './ctx';
import type { LootItem, Unit } from './types';

export function searchNeeded(squares: number): number {
  return Math.max(1, Math.ceil(squares / 6));
}

function enemiesInArea(ctx: Ctx, areaId: number): boolean {
  return ctx.fighters('castle').some((e) => ctx.ix.areaBySquare.get(squareKey(e.pos)) === areaId);
}

/** Can this unit search where it stands, and how far along is the room? */
export function searchStatus(ctx: Ctx, u: Unit): { ok: boolean; reason?: string; progress: number; needed: number; hoard?: boolean } {
  const k = squareKey(u.pos);
  if (ctx.ix.hoard.has(k)) {
    if (ctx.state.castle.hoardTaken) return { ok: false, reason: 'The hoard is gone.', progress: 0, needed: 1 };
    const dragon = ctx.fighters('castle').find((e) => e.cls === 'dragon');
    if (dragon && !dragon.dormant && ctx.ix.areaBySquare.get(squareKey(dragon.pos)) === ctx.ix.areaBySquare.get(k)) {
      return { ok: false, reason: 'The Dragon is watching.', progress: 0, needed: 1, hoard: true };
    }
    return { ok: true, progress: 0, needed: 1, hoard: true };
  }
  const area = areaAt(ctx.ix, u.pos);
  if (!area || !area.isRoom) return { ok: false, reason: 'Treasure is only found in rooms.', progress: 0, needed: 0 };
  const needed = searchNeeded(area.squares.length);
  const progress = ctx.exp.searchProgress[area.id] ?? 0;
  if (progress < 0) return { ok: false, reason: 'Already searched.', progress: needed, needed };
  if (enemiesInArea(ctx, area.id)) return { ok: false, reason: 'Not with enemies in the room.', progress, needed };
  return { ok: true, progress, needed };
}

function newItem(ctx: Ctx, base: Omit<LootItem, 'id'>): LootItem {
  return { ...base, id: ctx.nextId('i') };
}

/** Roll on the treasure chart (7.23) and hand the result to `u`. */
export function rollTreasure(ctx: Ctx, u: Unit, modifier: number): string {
  const r = die(ctx.state) + Math.min(10, modifier);
  let out = treasureRow(r);
  if (out.special) out = specialRow(die(ctx.state));
  if (out.wounds) {
    ctx.emit({ type: 'trap', unitId: u.id, detail: out.text });
    ctx.log(`${u.name} disturbs ${out.text}!`);
    applyWounds(ctx, u, out.wounds);
    return out.text;
  }
  if (out.item) giveItem(ctx, u, newItem(ctx, out.item), true);
  return out.text;
}

/** Hand an item to a unit. Magic Users absorb spell items at once. */
export function giveItem(ctx: Ctx, u: Unit, item: LootItem, found = false): void {
  if (item.spellPoints && u.cls === 'magicUser') {
    u.spellPoints += item.spellPoints;
    ctx.log(`${u.name} draws ${item.spellPoints} spell points from the ${item.name.toLowerCase()}.`);
    return;
  }
  u.loot.push(item);
  if (found) ctx.emit({ type: 'lootFound', unitId: u.id, items: [item] });
}

export function search(ctx: Ctx, u: Unit): void {
  if (u.actionsLeft < 1) throw new RuleError('No actions left.');
  const st = searchStatus(ctx, u);
  if (!st.ok) throw new RuleError(st.reason ?? 'Nothing to search.');
  u.actionsLeft -= 1;
  if (st.hoard) {
    ctx.state.castle.hoardTaken = true;
    ctx.log(`${u.name} plunders the Dragon's hoard!`);
    for (let i = 0; i < 4; i++) rollTreasure(ctx, u, 10);
    ctx.emit({ type: 'searched', unitId: u.id, areaId: -1, complete: true, result: 'The hoard' });
    return;
  }
  const area = areaAt(ctx.ix, u.pos)!;
  const progress = st.progress + (u.cls === 'burglar' ? 2 : 1);
  if (progress < st.needed) {
    ctx.exp.searchProgress[area.id] = progress;
    ctx.emit({ type: 'searched', unitId: u.id, areaId: area.id, complete: false });
    ctx.log(`${u.name} searches the room (${progress}/${st.needed}).`);
    return;
  }
  ctx.exp.searchProgress[area.id] = -1;
  const roll = die(ctx.state);
  let result: string;
  // Demo tuning: the 1980 chart (7.22) finds nothing on 1-3; the demo on 1-2.
  if (roll <= 2) {
    result = 'Nothing of value';
    ctx.log(`${u.name} finishes searching the room at ${label(u.pos)}: nothing.`);
  } else if (roll <= 4) {
    result = rollTreasure(ctx, u, treasureModifier(ctx, area.id, area.level));
    ctx.log(`${u.name} finds ${result}.`);
  } else if (roll === 5) {
    const spot = area.squares[die(ctx.state, area.squares.length) - 1]!;
    ctx.exp.chests.push({ id: ctx.nextId('c'), pos: spot, door: { open: false, locked: true, destroyed: false, jammed: false, unsmashable: false, chop: 0 } });
    result = 'A locked chest';
    ctx.log(`${u.name} finds a locked chest at ${label(spot)}.`);
  } else {
    result = springTrap(ctx, u, area.id);
  }
  ctx.emit({ type: 'searched', unitId: u.id, areaId: area.id, complete: true, result });
}

export function treasureModifier(ctx: Ctx, areaId: number, level: number): number {
  // Demo tuning: 1980 gives +0/+1/+2 for levels 1-3; the demo rewards depth more.
  const lvl = level === 1 ? 1 : level === 2 ? 2 : level === 3 ? 4 : level === 4 ? 6 : 8;
  return Math.min(10, lvl + (ctx.exp.monsterRooms[areaId] ?? 0));
}

function springTrap(ctx: Ctx, u: Unit, areaId: number): string {
  const inRoom = ctx.fighters('player').filter((p) => ctx.ix.areaBySquare.get(squareKey(p.pos)) === areaId);
  let mod = 0;
  if (inRoom.some((p) => p.cls === 'burglar')) mod = 3;
  else if (inRoom.some((p) => ['hobart', 'leader', 'magicUser', 'dwarf'].includes(p.cls))) mod = 1;
  const t = trapRow(die(ctx.state) + mod);
  ctx.emit({ type: 'trap', unitId: u.id, detail: t.text });
  ctx.log(`${u.name}: ${t.text}.`);
  if (t.wounds) applyWounds(ctx, u, t.wounds);
  if (t.sleep) for (const p of [...inRoom, ...ctx.fighters('castle').filter((e) => ctx.ix.areaBySquare.get(squareKey(e.pos)) === areaId)]) p.asleepTurns = 2;
  return t.text;
}

export function openChest(ctx: Ctx, u: Unit, chestId: string, method: 'pick' | 'smash' | 'chop' | 'unlock'): void {
  const chest = ctx.exp.chests.find((c) => c.id === chestId);
  if (!chest) throw new RuleError('No such chest.');
  if (!sameSquare(chest.pos, u.pos)) throw new RuleError('Stand on the chest to open it.');
  if (u.actionsLeft < 1) throw new RuleError('No actions left.');
  const ok = openLock(ctx, u, chest.door, method, 'the chest');
  if (method === 'unlock') u.actionsLeft = 0;
  else u.actionsLeft -= 1;
  if (!ok) return;
  ctx.exp.chests = ctx.exp.chests.filter((c) => c.id !== chestId);
  const area = areaAt(ctx.ix, chest.pos);
  const text = rollTreasure(ctx, u, area ? treasureModifier(ctx, area.id, area.level) : 0);
  ctx.log(`The chest holds ${text}.`);
}

export function pickUp(ctx: Ctx, u: Unit, itemId: string): void {
  if (u.actionsLeft < 1) throw new RuleError('No actions left.');
  const k = squareKey(u.pos);
  const pile = ctx.exp.floorLoot[k] ?? [];
  const item = pile.find((i) => i.id === itemId);
  if (!item) throw new RuleError('That is not here.');
  ctx.exp.floorLoot[k] = pile.filter((i) => i.id !== itemId);
  if (!ctx.exp.floorLoot[k]!.length) delete ctx.exp.floorLoot[k];
  u.actionsLeft -= 1;
  giveItem(ctx, u, item);
  ctx.log(`${u.name} picks up ${item.name}.`);
  ctx.emit({ type: 'lootFound', unitId: u.id, items: [item] });
}

export function drop(ctx: Ctx, u: Unit, itemId: string): void {
  if (u.actionsLeft < 1) throw new RuleError('No actions left.');
  const item = u.loot.find((i) => i.id === itemId);
  if (!item) throw new RuleError('Not carrying that.');
  u.loot = u.loot.filter((i) => i.id !== itemId);
  (ctx.exp.floorLoot[squareKey(u.pos)] ??= []).push(item);
  u.actionsLeft -= 1;
  ctx.log(`${u.name} drops ${item.name}.`);
}

export function give(ctx: Ctx, u: Unit, to: Unit, itemId: string, adjacent: (a: Unit, b: Unit) => boolean): void {
  if (u.actionsLeft < 1) throw new RuleError('No actions left.');
  if (to.side !== u.side) throw new RuleError('Not to the enemy.');
  if (!sameSquare(u.pos, to.pos) && !adjacent(u, to)) throw new RuleError('Too far away.');
  const item = u.loot.find((i) => i.id === itemId);
  if (!item) throw new RuleError('Not carrying that.');
  u.loot = u.loot.filter((i) => i.id !== itemId);
  u.actionsLeft -= 1;
  giveItem(ctx, to, item);
  ctx.log(`${u.name} hands ${item.name} to ${to.name}.`);
}

/** Free prisoners when a player unit stands in a cell (spec 6.4). */
export function freePrisoners(ctx: Ctx): void {
  for (const u of ctx.fighters('player')) {
    const area = areaAt(ctx.ix, u.pos);
    if (!area?.isPrisonCell) continue;
    const n = ctx.exp.prisoners[area.id] ?? 0;
    if (n <= 0) continue;
    ctx.exp.prisoners[area.id] = 0;
    const id = ctx.nextId('u');
    ctx.exp.units.push({
      id,
      side: 'player',
      cls: 'squad',
      name: 'Freed prisoners',
      pos: { ...u.pos },
      men: n,
      wounds: 0,
      maxWounds: 0,
      armor: 'unarmored',
      focus: 0,
      actionsLeft: 0,
      movedThisTurn: 0,
      spellPoints: 0,
      enchanted: false,
      charges: 0,
      loot: [],
      dormant: false,
      panicked: false,
      panicTurns: 0,
      overwatch: false,
      asleepTurns: 0,
      webbed: false,
      climbingTurns: 0,
      exited: false,
      menAtPhaseStart: n,
    });
    ctx.emit({ type: 'freed', unitId: id, men: n });
    ctx.log(`${n} prisoners are freed and take up arms!`);
  }
}
