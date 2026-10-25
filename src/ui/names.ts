// Player-facing names, glyphs and short texts.

import type { ActionKind, AleEffect, AleKind, Brightness, CrewId, DealKind, HeroClass, Item, JobKind, MonsterKind, RivalCrew, StoryId } from '../game/types';
import {
  BLINK_RANGE, BRAZIER_LIGHT, BREATH_DMG, BURN_ROUNDS, CALTROPS_DMG, CLASSES, DIG_NOISE, DRAGON_WAKE_NOISE, FIREBALL_NOISE, FIREBALL_RANGE,
  FIRECRACKER_NOISE, FOCUS_MAX, GLUE_ROUNDS, GLOAM_DMG, GUST_NOISE, GUST_RANGE, KINDLE_LIGHT, KNOCKBACK_RANGE, LIGHT_MAX, OIL_LIGHT,
  OVERWATCH_RANGE, PACK_SLOTS, SLEEP_RANGE, SMOKE_ROUNDS, SPELL_RANGE, THROW_CHARGE_RANGE, THROW_RANGE, TORCH_ROUNDS, VEIL_BREAK_NOISE,
  VEIL_ROUNDS, WARD_ROUNDS, WINCH_NOISE, ARCHER_RANGE, CAPTAIN_SHOUT_RANGE, GHOUL_RISE_RANGE,
} from '../game/data';

/** Every class the UI knows (V3.1 'mage' kept so old data still renders). */
export type AnyClass = HeroClass | 'mage' | 'sellsword' | 'burglar' | 'ranger' | 'sapper' | 'pyromancer' | 'shadowmancer' | 'hedgewitch';

export const CLASS_NAME: Record<AnyClass, string> = {
  heir: 'Heir',
  sellsword: 'Sellsword',
  burglar: 'Burglar',
  mage: 'Hedge Mage',
  ranger: 'Ranger',
  sapper: 'Sapper',
  pyromancer: 'Pyromancer',
  shadowmancer: 'Shadowmancer',
  hedgewitch: 'Hedgewitch',
};

/** Counter-style badge glyph, 1980 style. */
export const CLASS_GLYPH: Record<AnyClass, string> = {
  heir: 'H',
  sellsword: 'S',
  burglar: 'B',
  mage: 'M',
  ranger: 'R',
  sapper: 'X',
  pyromancer: 'P',
  shadowmancer: 'D',
  hedgewitch: 'W',
};

/** One-line role, shown big on recruit cards. */
export const CLASS_ROLE: Record<AnyClass, string> = {
  heir: 'The heir: rallies the squad. If he dies, it is over.',
  sellsword: 'Front line: hits hard, guards allies, shoves harder.',
  burglar: 'Quiet: picks locks, sneaks fast, backstabs.',
  mage: 'Spells: firebolt, kindle, mend. Fragile.',
  ranger: 'Ranged: longbow, overwatch, knockback shots into pits.',
  sapper: 'Breacher: throws charges, digs through rubble and cracked walls.',
  pyromancer: 'Fire: firebolt, fireball (burns allies too), kindle the lantern.',
  shadowmancer: 'Shadow: veil allies, put monsters to sleep, blink across gaps.',
  hedgewitch: 'Support: mend wounds, ward allies, gust enemies off ledges.',
};

/** Longer text: kit and abilities (from docs/v3-spec.md 15.3). */
export const CLASS_BLURB: Record<AnyClass, string> = {
  heir: 'The heir. Rally: +1 Focus to allies nearby. If he dies, it is over.',
  sellsword: 'Hits hard, takes hits. Guard: soak blows aimed at an ally.',
  burglar: 'Picks locks, sneaks fast, backstabs the unwary.',
  mage: 'Firebolt, Kindle the lantern, Mend wounds. Fragile.',
  ranger: 'Longbow at range 6.',
  sapper: 'Hammer and a pack of charges.',
  pyromancer: 'Staff, mana 3.',
  shadowmancer: 'Staff, mana 3.',
  hedgewitch: 'Staff, mana 3.',
};

/** Weapon and armor line per class (spec 15.3), for recruit cards. */
export const CLASS_GEAR: Record<AnyClass, string> = {
  heir: 'Sword (Might, 3 slots) · Armor 2',
  sellsword: 'Sword (Might, 3 slots, 2 dmg) · Armor 1',
  burglar: 'Dagger (Finesse, 2 slots, 2 dmg) · Armor 0',
  mage: 'Staff (Might, 2 slots, 1 dmg) · Armor 0',
  ranger: 'Longbow (Finesse, 3 slots, 2 dmg, range 6) · Armor 0',
  sapper: 'Hammer (Might, 3 slots, 2 dmg) · Armor 1',
  pyromancer: 'Staff (Might, 2 slots, 1 dmg) · Armor 0 · Mana 3',
  shadowmancer: 'Staff (Might, 2 slots, 1 dmg) · Armor 0 · Mana 3',
  hedgewitch: 'Staff (Might, 2 slots, 1 dmg) · Armor 0 · Mana 3',
};

/** Abilities and spells per class: [name, cost or kind, effect]. */
export const CLASS_KIT: Record<AnyClass, [string, string, string][]> = {
  heir: [['Rally', 'ability', '+1 Focus to allies within 3; ready every 3 rounds.']],
  sellsword: [
    ['Guard', 'ability', 'Soak blows aimed at an adjacent ally until your next turn.'],
    ['Shove', 'ability', '+1 slot: push an enemy 1 hex (into a pit, it falls).'],
  ],
  burglar: [
    ['Pick', 'ability', 'Pick locks on doors and chests.'],
    ['Sneak 4', 'passive', 'Sneaks further than anyone.'],
    ['Backstab', 'passive', 'Extra damage on unaware monsters.'],
    ['Light fingers', 'passive', 'Opens and takes from chests silently.'],
  ],
  mage: [
    ['Firebolt', '1 mana', 'Fire at range.'],
    ['Kindle', '1 mana', `+${KINDLE_LIGHT} lantern light (${KINDLE_LIGHT} more rounds). Silent.`],
    ['Mend', '1 mana', 'Heal 4 within 3.'],
  ],
  ranger: [
    ['Overwatch', 'action', 'Shoot the first enemy that moves or acts in sight within 6 next world phase.'],
    ['Knockback shot', 'ability', '2 Finesse slots, range ≤ 5: 2 hits push the target 1 hex (pits!).'],
    ['Close quarters', 'passive', 'Adjacent bow shots lose 1 slot.'],
  ],
  sapper: [
    ['2 free charges', 'passive', 'Starts every delve with 2 blasting charges.'],
    ['Throw charge', 'ability', 'Throw a charge up to 3 hexes (in sight).'],
    ['Dig', 'action', 'Clear adjacent rubble or a cracked wall, no charge. Noise 4.'],
  ],
  pyromancer: [
    ['Firebolt', '1 mana', 'Fire at range.'],
    ['Fireball', '2 mana', 'Radius 1 at range ≤ 5, 3 Wits slots, 2 dmg per hit to everything there (allies too). Burns 2 rounds. Noise 6.'],
    ['Kindle', '1 mana', `+${KINDLE_LIGHT} lantern light (${KINDLE_LIGHT} more rounds). Silent.`],
  ],
  shadowmancer: [
    ['Veil', '1 mana', 'An ally within 3 is unseen by monsters for 2 rounds (until they attack or make noise ≥ 4).'],
    ['Sleep', '1 mana', '2 Wits slots, range ≤ 5: 1+ hits puts a monster to sleep (not the Dragon or the Gloam).'],
    ['Blink', '1 mana', 'Teleport up to 4 hexes in sight, across pits and gaps. Silent.'],
  ],
  hedgewitch: [
    ['Mend', '1 mana', 'Heal 4 on an ally within 3.'],
    ['Ward', '1 mana', 'An ally within 3 takes 1 less per hit for 2 rounds.'],
    ['Gust', '1 mana', 'Push every figure within 1 of a hex (range ≤ 4) 1 hex outward. Noise 2.'],
  ],
};

export function className(cls: string): string {
  return CLASS_NAME[cls as AnyClass] ?? cls;
}
export function classGlyph(cls: string): string {
  return CLASS_GLYPH[cls as AnyClass] ?? '?';
}

export const MONSTER_NAME: Record<MonsterKind | 'gloam', string> = {
  rats: 'Rats',
  orc: 'Orc',
  spider: 'Spider',
  cutpurse: 'Cutpurse',
  berserker: 'Berserker',
  dragon: 'The Dragon',
  gloam: 'The Gloam',
  archer: 'Orc archer',
  captain: 'Orc captain',
  ghoul: 'Ghoul',
};

/** One or two lines per monster, for tooltips (spec 7, 14, 16.4). */
export const MONSTER_NOTE: Record<MonsterKind | 'gloam', string> = {
  rats: 'Weak but quick (moves 4). Runs off when down to 1 HP.',
  orc: 'Hits for 2. Shoves a hero standing on an unrailed edge.',
  spider: 'Webs you from up to 3 away (you can\'t move next turn), then drags you one hex toward it (pits count).',
  cutpurse: 'Fast. A hit steals a pack item instead of hurting, then it runs for an exit. Kill it to get the item back.',
  berserker: 'Once awake it always hunts, even out of sight. 4 slots, hits hard, knocks heroes back.',
  dragon: `Armor 1. Sleeps on its hoard; noise ${DRAGON_WAKE_NOISE}+ wakes it. Breathes fire down a line (${BREATH_DMG} damage) and sweeps its tail.`,
  archer: `Shoots at range ${ARCHER_RANGE}, keeps its distance. Knockback shot if a pit is behind you.`,
  captain: `Armor 1. Orcs beside it take 1 less per hit. Shouts: every orc within ${CAPTAIN_SHOUT_RANGE} wakes and hunts.`,
  ghoul: `Rises from the ground when you come within ${GHOUL_RISE_RANGE}. Grabs: you can\'t move until you Break free or kill it.`,
  gloam: `Can\'t be harmed. Only hunts heroes standing in the dark, and hits for ${GLOAM_DMG}. Get into the light.`,
};

export const BRIGHTNESS_NAME: Record<Brightness, string> = {
  bright: 'Bright',
  dim: 'Dim',
  dark: 'Dark',
  pitch: 'Pitch black',
};

/** Light thresholds learned from the engine (balance changes them). */
export interface LightScale {
  max: number;
  /** Lowest light value of each stage. */
  min: Record<Brightness, number>;
}

/** Probe engine.brightness on light values 0..200 to find the stage edges and the max. */
export function lightScale(brightness: (light: number) => Brightness, maxGuess: number): LightScale {
  const min: Record<Brightness, number> = { bright: Infinity, dim: Infinity, dark: Infinity, pitch: 0 };
  for (let l = 200; l >= 0; l--) {
    const b = brightness(l);
    if (l < min[b]) min[b] = l;
  }
  return { max: maxGuess, min };
}

/** Rounds of light left before the next stage, or before 0. */
export function roundsToNext(light: number, sc: LightScale): { stage: Brightness; rounds: number } {
  if (light >= sc.min.bright) return { stage: 'dim', rounds: light - sc.min.bright + 1 };
  if (light >= sc.min.dim) return { stage: 'dark', rounds: light - sc.min.dim + 1 };
  if (light >= 1) return { stage: 'pitch', rounds: light };
  return { stage: 'pitch', rounds: 0 };
}

export const ACTION_GLYPH: Partial<Record<ActionKind, string>> = {
  attack: '⚔',
  pick: '⚷',
  smash: '✊',
  open: '◫',
  take: '⇡',
  drop: '⇣',
  give: '⇄',
  disarm: '✂',
  light: '♨',
  torch: '🜂',
  potion: '⚱',
  revive: '✚',
  charge: '✹',
  rope: '⌇',
  climb: '⇅',
  jump: '⤓',
  shove: '⇥',
  free: '⛓',
  bribe: '¤',
  parley: '⚖',
  rally: '⚑',
  guard: '⛨',
  firebolt: '☄',
  kindle: '✦',
  mend: '✚',
  passLantern: '◆',
  winch: '⚙',
  leave: '⇱',
  overwatch: '👁',
  knockback: '➹',
  throwCharge: '✹',
  dig: '⛏',
  fireball: '☀',
  veil: '◐',
  sleep: '☾',
  blink: '⟿',
  ward: '⛉',
  gust: '≋',
  smoke: '☁',
  glue: '◍',
  dart: '➶',
  caltrops: '⁂',
  firecracker: '✺',
  key: '⚷',
  oil: '♁',
  grapple: '⚓',
  shutter: '◑',
  escape: '⛓',
};

/**
 * One or two plain sentences per action, with the real numbers (spec 16 over 15 over older
 * sections; constants from src/game/data.ts). Shown in the action-bar tooltip under
 * "Label · cost". Attack is per class: see actionHelp().
 */
export const ACTION_HELP: Record<ActionKind, string> = {
  attack: 'Strike an enemy with your weapon. Each slot that hits deals its damage; all slots hit: +1.',
  pick: `Burglar. 3 Finesse slots on a locked door or chest next to you: 3 hits opens it silently, 2 opens it (noise 2), 1 fails, 0 jams it for good.`,
  smash: 'Force a locked door or chest next to you: 2 Might slots. A door needs 2 hits, a chest 1. Noise 4 either way.',
  open: 'Open or close a door next to you (free), or open a chest (uses the action; free for the Burglar). Chest loot lands on the floor: Take it.',
  take: `Pick up loot next to you or underfoot. Free. Each item fills a pack slot (${PACK_SLOTS} per hero); heirlooms and hoard pieces fill 2.`,
  drop: 'Put a pack item down on this hex. Free.',
  give: 'Hand a pack item to a hero next to you who has room. Free.',
  disarm: 'A spotted trap next to you: 2 Finesse slots. 1 hit disarms it; 0 sets it off (3 damage). Noise 2.',
  light: `Light a brazier next to you: +${BRAZIER_LIGHT} lantern light, and it lights the room around it for good.`,
  torch: `Light a torch from the pack: ${TORCH_ROUNDS} rounds of light around this hero (radius 2), whatever the lantern does.`,
  potion: 'Drink it, or give it to a hero next to you: heals 5. Gets a downed hero back up.',
  revive: 'Get a downed hero next to you back up with 3 HP. They come home wounded.',
  charge: 'Set a blasting charge on a door, chest or cracked wall next to you. It blows at the end of the turn: 4 damage within 1, 2 within 2. Noise 8, heard a level up and down.',
  rope: 'Anchor a rope at this pit edge. From then on anyone here can Climb down and back up.',
  climb: 'Climb the rope to the other level, no damage. Takes the whole turn (move and action).',
  jump: 'Drop into the pit to the level below. The fall hurts, more for each level. Takes the whole turn.',
  shove: 'Push an enemy next to you 1 hex straight away: 2 Might slots (Sellsword 3), needs 2 hits. Into a pit it falls; into a wall it takes 1. Noise 2.',
  free: 'Unshackle the prisoner next to you. They follow this hero; an escort moves 3 at most. Get them to an exit.',
  bribe: 'Pay the rival crew 40 gold from the party\'s packs: they stop fighting and leave.',
  parley: 'Talk to a rival crew within 4 hexes, in sight. Free. Opens the deal card: pay them to leave, buy a truce, give them a job, hire them, or fight. One deal per crew per round; paid from the party\'s packs.',
  rally: `Every other hero within 3 gains 1 Focus (max ${FOCUS_MAX}). Ready again after 3 rounds.`,
  guard: 'Until your next turn, attacks aimed at the ally next to you hit you instead.',
  firebolt: '1 mana. 3 Wits slots at range 5 in sight, 2 damage per hit; all 3 hit: +1. Noise 3.',
  kindle: `Feed the lantern ${KINDLE_LIGHT} rounds of light (+${KINDLE_LIGHT}). Silent, no roll. The lantern holds ${LIGHT_MAX} at most.`,
  mend: '1 mana. Heal 4 on a hero within 3, yourself included. Silent, no roll.',
  passLantern: 'Hand the lantern to a hero next to you. The light goes where the lantern goes.',
  winch: `Work the winch: the lift runs for the rest of the delve. Noise ${WINCH_NOISE}.`,
  leave: 'Step out of the castle here. Free. This hero is safe, with everything in their pack.',
  shutter: `Free. Shuttered, the lantern burns no oil and gives no light; open it again any time. Level 1 has daylight in most rooms.`,
  escape: '2 Might slots: 1 hit breaks the ghoul\'s grip. Killing the ghoul frees you too.',
  overwatch: `Spend the action: in the next world phase, shoot the first enemy that moves or acts in sight within ${OVERWATCH_RANGE} (a full roll).`,
  knockback: `2 Finesse slots at range ${KNOCKBACK_RANGE} or less: 2 hits push the target 1 hex away from you (into pits!).`,
  throwCharge: `Throw a blasting charge up to ${THROW_CHARGE_RANGE} hexes (in sight). It blows at the end of the turn: 4 damage within 1, 2 within 2. Noise 8.`,
  dig: `Clear rubble or a cracked wall next to you, no charge needed. Noise ${DIG_NOISE}.`,
  fireball: `2 mana. Radius 1 at range ${FIREBALL_RANGE} or less: 3 Wits slots, 2 damage per hit to everyone there, allies too. Burns ${BURN_ROUNDS} rounds. Noise ${FIREBALL_NOISE}.`,
  veil: `1 mana. A hero within ${SPELL_RANGE} is unseen by monsters for ${VEIL_ROUNDS} rounds. Attacking or noise ${VEIL_BREAK_NOISE}+ breaks it. Silent.`,
  sleep: `1 mana. 2 Wits slots at range ${SLEEP_RANGE} or less: 1 hit and the monster sleeps (not the Dragon or the Gloam). Silent.`,
  blink: `1 mana. Teleport up to ${BLINK_RANGE} hexes to a free hex in sight, across pits and gaps. Silent.`,
  ward: `1 mana. A hero within ${SPELL_RANGE} takes 1 less damage per hit for ${WARD_ROUNDS} rounds.`,
  gust: `1 mana. Everything within 1 of a hex (range ${GUST_RANGE}) is pushed 1 hex outward (pits!). Noise ${GUST_NOISE}.`,
  smoke: `Throw ${THROW_RANGE.smoke}: smoke on the hex and around it for ${SMOKE_ROUNDS} rounds. Blocks sight both ways; monsters inside lose you.`,
  glue: `Throw ${THROW_RANGE.glue}: monsters within 1 of the hex are stuck for ${GLUE_ROUNDS} rounds.`,
  dart: `Throw ${THROW_RANGE.dart}, 1 Finesse slot: a hit puts a monster to sleep (not the Dragon). Silent.`,
  caltrops: `Scatter on a hex next to you: the first monster to step on it takes ${CALTROPS_DMG} and stops. Lasts the delve.`,
  firecracker: `Throw ${THROW_RANGE.firecracker}: noise ${FIRECRACKER_NOISE} where it lands. Lures monsters away from you.`,
  key: 'Open a locked door or chest next to you, silently. One use.',
  oil: `Pour a flask into the lantern: +${OIL_LIGHT} light, ${OIL_LIGHT} more rounds. Silent.`,
  grapple: 'From a pit landing, climb straight up to the level above. The hook is kept. Takes the whole turn.',
};

/** Attack help with the hero's own weapon numbers. Everything else: ACTION_HELP. */
export function actionHelp(action: ActionKind, cls?: string): string {
  if (action === 'attack' && cls && cls in CLASSES) {
    const w = CLASSES[cls as HeroClass].weapon;
    const stat = `${w.stat[0]!.toUpperCase()}${w.stat.slice(1)}`;
    return `${w.name}: ${w.slots} ${stat} slots, ${w.dmg} damage per hit${w.range ? `, range ${w.range} in sight (adjacent: 1 slot less)` : ', next to you'}. All slots hit: +1. Noise ${w.noise ?? 2}.`;
  }
  return ACTION_HELP[action] ?? '';
}

/** Actions that don't use the hero's action, and those that take the whole turn. */
export const FREE_ACTIONS = new Set<ActionKind>(['take', 'drop', 'give', 'leave', 'shutter', 'parley']);
export const WHOLE_TURN_ACTIONS = new Set<ActionKind>(['climb', 'jump', 'grapple']);

/** What the bar tooltip says it costs. */
export function actionCost(action: ActionKind, mana?: number, rolls?: boolean): string {
  const parts: string[] = [];
  if (mana) parts.push(`${mana} mana`);
  parts.push(FREE_ACTIONS.has(action) ? 'free' : WHOLE_TURN_ACTIONS.has(action) ? 'whole turn' : action === 'open' ? 'free for doors' : 'uses the action');
  if (rolls) parts.push('roll');
  return parts.join(' · ');
}

/** A roll-preview modifier line explained ("Dark −20%" → why). */
export function modifierHelp(m: string): string {
  if (/^(Bright|Dim|Dark|Pitch)/.test(m)) return 'how much light you stand in';
  if (/^Weapon/.test(m)) return 'smithy upgrade';
  if (/^Asleep/.test(m)) return 'the target is asleep';
  if (/^Backstab/.test(m)) return 'it isn\'t hunting you';
  if (/^Raised/.test(m)) return 'shooting from raised floor';
  if (/^Adjacent/.test(m)) return 'bows are clumsy point-blank';
  if (/^Flanked/.test(m)) return 'an ally stands across from it';
  if (/^Armor/.test(m)) return 'its armor, min 1 per hit';
  if (/^Shield wall/.test(m)) return 'an orc captain stands beside it';
  if (/^Sellsword/.test(m)) return 'Sellswords shove harder';
  if (/mana/.test(m)) return 'spell cost';
  return '';
}

/** Awareness in words, for monster tooltips. */
export const AWARENESS_TEXT: Record<string, string> = {
  asleep: 'Asleep: won\'t act until a noise wakes it or a hero ends next to it.',
  alert: 'Alert: heard something; searching for you.',
  hunting: 'Hunting: it has seen you and comes for you.',
  patrol: 'On patrol: walks its route; sees you if you\'re lit, or within 3.',
};

/** Pack: what each item kind does and how to use it ("Use: Items › Torch"). */
export const ITEM_HELP: Record<string, string> = {
  torch: `${TORCH_ROUNDS} rounds of light around the bearer (radius 2).\nUse: Items › Light torch`,
  potion: 'Heals 5, or gets a downed hero back up.\nUse: Items › Potion (yourself or a hero next to you)',
  rope: 'Anchor it at a pit edge to climb down and back up.\nUse: stand at a pit edge, Items › Anchor rope',
  charge: 'Blasts open a lock or a cracked wall: 4 damage within 1. Noise 8.\nUse: next to the target, Items › Place charge (Sapper: Throw charge)',
  smoke: `Smoke for ${SMOKE_ROUNDS} rounds; blocks sight both ways.\nUse: Items › Smoke bomb, then click a hex within ${THROW_RANGE.smoke}`,
  glue: `Monsters within 1 are stuck for ${GLUE_ROUNDS} rounds.\nUse: Items › Glue bomb, then click a hex within ${THROW_RANGE.glue}`,
  dart: `1 Finesse slot: a hit puts a monster to sleep. Silent.\nUse: Items › Sleep dart, then click a monster within ${THROW_RANGE.dart}`,
  caltrops: `The first monster across takes ${CALTROPS_DMG} and stops.\nUse: Items › Caltrops, then click a hex next to you`,
  hook: 'Climb from a pit landing up a level. Reusable.\nUse: on a pit landing, Items › Grapple up',
  key: 'Opens one locked door or chest, silently.\nUse: next to the lock, Items › Skeleton key',
  oil: `+${OIL_LIGHT} lantern light (${OIL_LIGHT} more rounds).\nUse: Items › Oil flask`,
  firecracker: `Noise ${FIRECRACKER_NOISE} where it lands: lures monsters.\nUse: Items › Firecracker, then click a hex within ${THROW_RANGE.firecracker}`,
};

/** Tooltip for one pack socket. */
export function itemTip(i: Item): string {
  const base = itemBase(i.kind);
  const name = itemLabel(i);
  const tail = '\nDrop or Give it (free) to make room.';
  if (i.kind === 'gold') return `${name} · Coins, up to 100 to a slot. Yours when this hero gets out.${tail}`;
  if (i.kind === 'gem' || i.kind === 'jewelry') return `${name} · A valuable: sells for ${i.amount} gold at camp. Carry it out.${tail}`;
  if (i.story) return `${i.name} · ${STORY[i.story].itemTip}${tail}`;
  if (i.heavy) return `${i.name} · Heavy: whoever carries it moves 3 at most.${tail}`;
  if (i.kind === 'heirloom') return `${i.name} · The contract heirloom. Fills 2 slots. Carry it out of the castle to finish the job.${tail}`;
  if (i.kind === 'hoard') return `${i.name} · A piece of the Dragon's hoard, worth ${i.amount} gold. Fills 2 slots.${tail}`;
  return `${name} · ${ITEM_HELP[base] ?? ITEM_EFFECT[base] ?? ''}`;
}

/** Hotkey per action (letters not used by the global keys). */
export const ACTION_KEY: Partial<Record<ActionKind, string>> = {
  attack: 'a',
  firebolt: 'f',
  pick: 'p',
  smash: 'x',
  open: 'o',
  take: 'g',
  torch: 't',
  potion: 'h',
  revive: 'v',
  light: 'l',
  rally: 'r',
  guard: 'r',
  kindle: 'k',
  mend: 'm',
  free: 'g',
  leave: 'q',
  disarm: 'd',
  shove: 'z',
  bribe: 'b',
  parley: 'b',
  charge: 'w',
  passLantern: 'n',
  rope: 'y',
  climb: 'y',
  jump: 'j',
  give: 'i',
  drop: 'u',
  winch: 'w',
  overwatch: 'o',
  knockback: 'k',
  throwCharge: 'w',
  dig: 'd',
  fireball: 'b',
  veil: 'v',
  sleep: 'z',
  blink: 'j',
  ward: 'r',
  gust: 'x',
  smoke: 'm',
  glue: 'u',
  dart: 'z',
  caltrops: 'y',
  firecracker: 'i',
  key: 'p',
  oil: 'l',
  grapple: 'y',
  shutter: 'l',
  escape: 'x',
};

export const ITEM_GLYPH: Record<string, string> = {
  gold: '¤',
  gem: '◆',
  jewelry: '◎',
  torch: '🜂',
  potion: '⚱',
  rope: '⌇',
  charge: '✹',
  heirloom: '♛',
  hoard: '♜',
  smoke: '☁',
  glue: '◍',
  dart: '➶',
  caltrops: '⁂',
  grapple: '⚓',
  key: '⚷',
  oil: '♁',
  firecracker: '✺',
};

/** Glyph for any item kind, tolerant of names the engine picks (smokeBomb, sleepDart, skeletonKey...). */
export function itemGlyph(kind: string): string {
  return ITEM_GLYPH[itemBase(kind)] ?? '•';
}

/** Normalise engine item kind names to the UI's short keys. */
export function itemBase(kind: string): string {
  const k = kind.toLowerCase();
  if (k.includes('smoke')) return 'smoke';
  if (k.includes('glue')) return 'glue';
  if (k.includes('dart')) return 'dart';
  if (k.includes('caltrop')) return 'caltrops';
  if (k.includes('grappl') || k === 'hook') return 'grapple';
  if (k.includes('key')) return 'key';
  if (k.includes('oil')) return 'oil';
  if (k.includes('firecracker') || k.includes('cracker')) return 'firecracker';
  return kind;
}

/** One-line effect per shop item (spec 15.4). Used when the engine's text is missing or long. */
export const ITEM_EFFECT: Record<string, string> = {
  torch: `Light it for your own pool of light, radius 2, for ${TORCH_ROUNDS} rounds.`,
  potion: 'Drink or give: heals 5.',
  rope: 'Anchor at a pit edge to climb between levels.',
  charge: 'Blast a door, chest or cracked wall open. Loud.',
  smoke: 'Throw 4: smoke on the hex and around it for 2 rounds. Blocks sight; monsters lose you.',
  glue: 'Throw 4: monsters within 1 are stuck for 2 rounds.',
  dart: 'Throw 5, 1 Finesse slot: a hit puts a monster to sleep. Silent.',
  caltrops: 'Scatter next to you: the first monster on it takes 2 and stops. Lasts the delve.',
  grapple: 'From a pit floor or landing, climb straight up a level. Reusable. Move and action.',
  key: 'Opens one locked door or chest, silently, for anyone. One use.',
  oil: `+${OIL_LIGHT} lantern light. The lantern burns 1 per round while open.`,
  firecracker: 'Throw 6: noise 6 at the target hex. Lure monsters away.',
};

export function itemLabel(i: Item): string {
  if (i.kind === 'gold') return `${i.amount} gold`;
  if (i.kind === 'gem' || i.kind === 'jewelry') return `${i.name} (${i.amount})`;
  return i.name;
}

// ------------------------------------------------------------ V3.5: Lowgate, story, ales, crews (spec 18)

/** Story contracts: who or what comes home, from where, and what it wins back for Lowgate (18.2, 18.3). */
export const STORY: Record<StoryId, {
  /** The villager or thing. */
  who: string;
  /** Where in the castle, in words. */
  where: string;
  /** Contract kind word. */
  verb: 'Rescue' | 'Recover';
  /** What it unlocks, short ("The infirmary heals for gold"). */
  unlocks: string;
  /** The station it lights up. */
  station: 'infirmary' | 'tavern' | 'smithy' | 'quartermaster';
  /** The line on return to camp. */
  line: string;
  /** Pack tooltip for story items. */
  itemTip: string;
  /** When it goes up on the notice post. */
  when: string;
}> = {
  surgeon: {
    who: 'Brother Aldric',
    where: 'Level 1, the library',
    verb: 'Rescue',
    unlocks: 'The infirmary: heal for gold',
    station: 'infirmary',
    line: 'Brother Aldric sets up in the old chapel. The infirmary is open.',
    itemTip: '',
    when: 'from the start',
  },
  innkeeper: {
    who: 'Old Wim',
    where: 'Level 1, the library',
    verb: 'Rescue',
    unlocks: 'The Gilded Flagon: four recruits, some seasoned',
    station: 'tavern',
    line: 'Old Wim lights the hearth of the Gilded Flagon. Better hands come looking for work.',
    itemTip: '',
    when: 'at reputation 1',
  },
  smith: {
    who: 'Gerda the smith',
    where: 'Level 2, the cellblock',
    verb: 'Rescue',
    unlocks: 'The forge, and metalwork at the peddler',
    station: 'smithy',
    line: 'Gerda stokes the forge. Steel can be bought and mended again.',
    itemTip: '',
    when: 'at reputation 1',
  },
  copper: {
    who: 'the brewing copper',
    where: 'Level 2, the forge',
    verb: 'Recover',
    unlocks: 'The first four ales at the Flagon',
    station: 'tavern',
    line: 'The brewing copper is back on its bricks. Wim pours the first ales.',
    itemTip: 'Heavy: whoever carries it moves 3 at most. Carry it out and it goes home to Lowgate, not the cart. It can\'t be sold.',
    when: 'once Old Wim is home',
  },
  caskbook: {
    who: "Wim's cask book",
    where: 'Level 3, the Drain',
    verb: 'Recover',
    unlocks: 'The rest of the ales, and level 3 recruits',
    station: 'tavern',
    line: "Wim reads his cask book by the fire. The old recipes are back, and so are the old hands.",
    itemTip: 'Carry it out and it goes home to Lowgate, not the cart. It can\'t be sold.',
    when: 'once the copper is home and Level 3 is open',
  },
};

/** "Rescue Gerda the smith (Level 2, the cellblock)." */
export function storyFix(id: StoryId): string {
  const st = STORY[id];
  return `${st.verb} ${st.who} (${st.where})`;
}

/** Ales (18.4): glyph and what it does, in the game's plain words; the engine's `text` wins when present. */
export const ALE: Record<AleKind, { name: string; glyph: string; text: string }> = {
  glowworm: { name: 'Glowworm Pale', glyph: '✦', text: 'The drinker glows: light radius 1 around them all delve. Never unlit, so the dark in the Hollow leaves them be.' },
  featherfoot: { name: 'Featherfoot', glyph: '❦', text: "The drinker's first fall deals no damage." },
  mole: { name: "Mole's Brown", glyph: '⛏', text: 'The drinker can Dig like a Sapper: rubble or a cracked wall next to them. Noise 4.' },
  reserve: { name: "Hobart's Reserve", glyph: '♛', text: "The old lord's own. The drinker's Focus starts at 4, and 4 is the max." },
  smuggler: { name: "Smuggler's Mead", glyph: '☾', text: 'The drinker sneaks 4 hexes, and sneaking makes no noise.' },
  fireside: { name: 'Fireside Porter', glyph: '♨', text: 'The drinker heals 3 each time they change level: stairs, lift, fall, rope or hook (after any fall damage).' },
  blackcask: { name: 'Black Cask', glyph: '⚑', text: 'Nobody knows what is in it. 7 in 10: one of the six other ales. 3 in 10: hiccups or a heavy head.' },
};

/** What an ale does in the delve (the Black Cask resolved). */
export const ALE_EFFECT: Record<AleEffect, { name: string; glyph: string; text: string; bad?: boolean }> = {
  glowworm: ALE.glowworm,
  featherfoot: ALE.featherfoot,
  mole: ALE.mole,
  reserve: ALE.reserve,
  smuggler: ALE.smuggler,
  fireside: ALE.fireside,
  hiccups: { name: 'Hiccups', glyph: '!', text: 'Black Cask gone wrong: noise 1 at the drinker every castle turn.', bad: true },
  heavyhead: { name: 'Heavy head', glyph: '☁', text: 'Black Cask gone wrong: Focus starts at 1.', bad: true },
};

/** Where an ale's brewing gear comes from (locked ales say this). */
export function aleNeeds(needs: 'copper' | 'caskbook'): string {
  return needs === 'copper' ? 'Needs the brewing copper: recover it from the forge (Level 2).' : "Needs Wim's cask book: recover it from the Drain (Level 3).";
}

/** Rival crews (16.5, 18.5). */
export const CREW: Record<CrewId, { name: string; blurb: string; colour: string }> = {
  'lantern-sisters': { name: 'The Lantern Sisters', blurb: 'Pale-robed prospectors with lanterns of their own.', colour: '#b8ad98' },
  ferrymen: { name: 'The Ferrymen', blurb: 'River toughs in blue-grey. They take a toll from anyone who crosses.', colour: '#7f97ad' },
  'gallows-choir': { name: 'The Gallows Choir', blurb: 'Black and bone. They sing while they rob you.', colour: '#d8cfb8' },
};

export const TEMPERAMENT: Record<RivalCrew['temperament'], { name: string; text: string }> = {
  prospector: { name: 'Prospectors', text: 'They race you for loot, then leave. They fight only if attacked or blocked.' },
  cutthroat: { name: 'Cutthroats', text: 'They hold a choke point on Level 2 and demand a toll from anyone who comes close.' },
};

export const STANCE: Record<RivalCrew['stance'], { name: string; text: string; cls: 'enemy' | 'ally' | 'calm' | 'warn' }> = {
  neutral: { name: 'Neutral', text: 'Looting, not fighting.', cls: 'calm' },
  waiting: { name: 'Waiting', text: 'Holding their post. Come within 6 in sight, or make noise 4+ they hear, and they demand a toll.', cls: 'warn' },
  demanding: { name: 'Demanding', text: 'Pay the toll or they attack in the next castle turn.', cls: 'warn' },
  hostile: { name: 'Hostile', text: 'Fighting you.', cls: 'enemy' },
  bribed: { name: 'Paid off', text: 'Paid to leave. They are heading out.', cls: 'calm' },
  truce: { name: 'Truce', text: 'Paid not to attack. They never attack unless attacked.', cls: 'calm' },
  hired: { name: 'Hired', text: 'Fighting beside you: they keep within 2 of the hero who hired them and attack monsters in reach.', cls: 'ally' },
};

export const DEAL_GLYPH: Record<DealKind, string> = { leave: '⇱', truce: '⚐', job: '⚒', hire: '⚔', fight: '✖' };
export const JOB_NAME: Record<JobKind, string> = { winch: 'Work the winch', open: 'Open a lock', scout: 'Scout ahead' };
export const JOB_TEXT: Record<JobKind, string> = {
  winch: 'They walk to the winch on their level and work it: the lift runs.',
  open: 'They open the nearest seen locked door or chest on their level, silently.',
  scout: 'Every hex within 8 of each of them is explored now.',
};

/** Log line for a done deal. */
export function dealLine(crew: string, deal: DealKind, job: JobKind | undefined, paid: string[]): string {
  const took = paid.length ? `take ${paid.join(', ')}` : '';
  switch (deal) {
    case 'leave':
      return `${crew} ${took ? `${took} and ` : ''}head for the way out.`;
    case 'truce':
      return `${crew} ${took ? `${took}. ` : ''}${took ? 'A truce: they' : 'agree a truce: they'} won't attack unless attacked.`;
    case 'job':
      return `${crew} ${took ? `${took} and ` : ''}take the job: ${job ? JOB_NAME[job].toLowerCase() : 'as agreed'}.`;
    case 'hire':
      return `${crew} ${took ? `${took}. ` : ''}${took ? 'They' : 'They'} fight beside you for 5 rounds.`;
    case 'fight':
      return `You draw steel on ${crew.replace(/^The /, 'the ')}.`;
  }
}
