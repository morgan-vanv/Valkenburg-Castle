// Loot (V2): treasure lies visible in the castle. Grab it, carry it in
// sacks, get it out. No search rolls, chests or trap charts.

import { label, sameSquare, squareKey } from './geometry';
import { carryInfo } from './movement';
import { RuleError, type Ctx } from './ctx';
import type { LootItem, Unit } from './types';

export function canCarry(u: Unit, item: LootItem): boolean {
  const c = carryInfo(u);
  return c.weight + item.weight <= c.limit;
}

export function pickUp(ctx: Ctx, u: Unit, itemId: string): void {
  if (u.actionsLeft < 1) throw new RuleError('No actions left.');
  const k = squareKey(u.pos);
  const pile = ctx.exp.floorLoot[k] ?? [];
  const item = pile.find((i) => i.id === itemId);
  if (!item) throw new RuleError('That is not here.');
  if (!canCarry(u, item)) {
    throw new RuleError(item.weight > 1 ? `${item.name} needs ${item.weight} free sacks: bring a squad.` : `${u.name} has no free sack.`);
  }
  ctx.exp.floorLoot[k] = pile.filter((i) => i.id !== itemId);
  if (!ctx.exp.floorLoot[k]!.length) delete ctx.exp.floorLoot[k];
  u.actionsLeft -= 1;
  u.loot.push(item);
  ctx.log(`${u.name} grabs ${item.name} (${item.value} gold).`);
  ctx.emit({ type: 'lootFound', unitId: u.id, items: [item] });
}

export function drop(ctx: Ctx, u: Unit, itemId: string): void {
  if (u.actionsLeft < 1) throw new RuleError('No actions left.');
  const item = u.loot.find((i) => i.id === itemId);
  if (!item) throw new RuleError('Not carrying that.');
  u.loot = u.loot.filter((i) => i.id !== itemId);
  (ctx.exp.floorLoot[squareKey(u.pos)] ??= []).push(item);
  u.actionsLeft -= 1;
  ctx.log(`${u.name} drops ${item.name} at ${label(u.pos)}.`);
}

export function give(ctx: Ctx, u: Unit, to: Unit, itemId: string, adjacent: (a: Unit, b: Unit) => boolean): void {
  if (u.actionsLeft < 1) throw new RuleError('No actions left.');
  if (to.side !== u.side) throw new RuleError('Not to the enemy.');
  if (!sameSquare(u.pos, to.pos) && !adjacent(u, to)) throw new RuleError('Too far away.');
  const item = u.loot.find((i) => i.id === itemId);
  if (!item) throw new RuleError('Not carrying that.');
  if (!canCarry(to, item)) throw new RuleError(`${to.name} has no room for it.`);
  u.loot = u.loot.filter((i) => i.id !== itemId);
  u.actionsLeft -= 1;
  to.loot.push(item);
  ctx.log(`${u.name} hands ${item.name} to ${to.name}.`);
}
