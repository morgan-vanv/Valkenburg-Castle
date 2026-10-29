// V5.2 (spec 35): what the title screen knows about campaigns. `campaignCard` reads a save (pure, for tests): where it
// stands, who is in it, the purse, the village and the graves. `RunRecord` is the short memory of a campaign that
// ended (Keven fell or was taken), kept per browser under its own key so it outlives the save a new campaign
// replaces. UI only: the save shape and the rules are unchanged.

import { isLightItem, roundsOf } from '../../game/world';
import type { GameState, HeroClass } from '../../game/types';

export const RUNS_KEY = 'vc.runs.v52';
/** Ended runs kept (newest first). */
export const MAX_RUNS = 12;

export interface CardHero {
  name: string;
  cls: HeroClass;
  level: number;
  /** In a delve: bleeding out (with phases left), or carried off. */
  down?: number;
  taken?: boolean;
}

export interface CampaignCard {
  /** 'camp' resting in Lowgate (or the return report), 'delve' saved inside the castle, 'over' the line has ended. */
  kind: 'camp' | 'delve' | 'over';
  /** One line: "After 4 delves · resting in Lowgate", "Delve 6 · Level 2, round 8". */
  where: string;
  party: CardHero[];
  gold: number;
  /** Villagers brought home (Aldric, Wim, Gerda, Ilse). */
  villagers: number;
  /** Names in the graves. */
  graves: number;
  delves: number;
  /** Delve only: rounds of light left in the party's torches and lanterns. */
  light?: number;
  /** Delve only: loot carried (valuables, gold, contract and story items). */
  loot?: number;
}

/** Brother Aldric, Old Wim, Gerda and Ilse: the people of Lowgate who can come home. */
export function villagersHome(s: GameState): number {
  const v = s.campaign.village;
  return [v.surgeon, v.innkeeper, v.smith, v.alchemist].filter(Boolean).length;
}

/** What counts as loot carried on the mid-delve card. */
const LOOT = new Set<string>(['gold', 'gem', 'jewelry', 'heirloom', 'hoard']);

const plural =(n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function campaignCard(s: GameState): CampaignCard {
  const c = s.campaign;
  const base = { gold: c.gold, villagers: villagersHome(s), graves: c.fallen.length, delves: c.delveCount };
  if (s.stage === 'over') {
    const keven = c.fallen.find((f) => f.cls === 'heir');
    return { ...base, kind: 'over', where: keven ? `Keven fell · ${keven.where}` : 'The line has ended', party: [] };
  }
  const byId = new Map(c.roster.map((h) => [h.id, h]));
  if (s.stage === 'delve' && s.delve) {
    const d = s.delve;
    const party: CardHero[] = [];
    for (const hd of d.heroes) {
      const h = byId.get(hd.heroId);
      if (!h || hd.status === 'dead') continue;
      party.push({ name: h.name, cls: h.cls, level: h.level, down: hd.status === 'downed' ? hd.bleed : undefined, taken: hd.status === 'captured' || undefined });
    }
    party.sort((a, b) => (a.cls === 'heir' ? -1 : b.cls === 'heir' ? 1 : 0));
    const lead = d.heroes.find((hd) => byId.get(hd.heroId)?.cls === 'heir' && hd.status !== 'out') ?? d.heroes.find((hd) => hd.status === 'active');
    const lvl = lead ? lead.at.level : 1;
    const inside = d.heroes.filter((hd) => hd.status === 'active' || hd.status === 'downed');
    const light = inside.reduce((n, hd) => n + hd.pack.filter((i) => isLightItem(i)).reduce((m, i) => m + roundsOf(i), 0), 0);
    const loot = inside.reduce((n, hd) => n + hd.pack.filter((i) => LOOT.has(i.kind) || !!i.story || !!i.contractId).length, 0);
    return { ...base, kind: 'delve', where: `Delve ${Math.max(1, c.delveCount)} · Level ${lvl}, round ${d.round}`, party, light, loot };
  }
  const party = c.roster.map((h) => ({ name: h.name, cls: h.cls, level: h.level }));
  party.sort((a, b) => (a.cls === 'heir' ? -1 : b.cls === 'heir' ? 1 : 0));
  const where = s.stage === 'summary' ? `Back from delve ${c.delveCount}` : c.delveCount === 0 ? 'Fresh in Lowgate' : `After ${plural(c.delveCount, 'delve')} · resting in Lowgate`;
  return { ...base, kind: 'camp', where, party };
}

// ------------------------------------------------------------ ended runs

export interface RunRecord {
  /** `${seed}:${delves}`: the same ended save recorded twice is one run. */
  id: string;
  seed: number;
  delves: number;
  gold: number;
  reputation: number;
  villagers: number;
  /** Heroes in the graves, Keven included. */
  graves: number;
  /** Keven's level and where it ended ("Level 2, the cellblock"), or null if unknown. */
  level: number;
  where: string | null;
  taken: boolean;
  /** ms since the epoch. */
  at: number;
}

export function runRecord(s: GameState, at = Date.now()): RunRecord {
  const c = s.campaign;
  const keven = c.fallen.find((f) => f.cls === 'heir');
  return {
    id: `${s.seed}:${c.delveCount}`,
    seed: s.seed,
    delves: c.delveCount,
    gold: c.gold,
    reputation: c.reputation,
    villagers: villagersHome(s),
    graves: c.fallen.length,
    level: keven?.level ?? c.roster.find((h) => h.cls === 'heir')?.level ?? 1,
    where: keven?.where ?? null,
    taken: /taken/i.test(s.overReason ?? ''),
    at,
  };
}

/** Add a run to the list (newest first, no duplicate ids, at most MAX_RUNS). Pure. */
export function addRun(list: RunRecord[], r: RunRecord): RunRecord[] {
  return [r, ...list.filter((x) => x.id !== r.id)].slice(0, MAX_RUNS);
}

export function loadRuns(): RunRecord[] {
  try {
    const raw = localStorage.getItem(RUNS_KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(v) ? (v as RunRecord[]).filter((r) => r && typeof r.id === 'string') : [];
  } catch {
    return [];
  }
}

/** Remember an ended campaign (stage 'over'); a no-op for anything else or a run already kept. */
export function recordRun(s: GameState): RunRecord[] {
  const runs = loadRuns();
  if (s.stage !== 'over') return runs;
  const r = runRecord(s);
  if (runs.some((x) => x.id === r.id)) return runs;
  const next = addRun(runs, r);
  try {
    localStorage.setItem(RUNS_KEY, JSON.stringify(next));
  } catch {
    /* storage blocked */
  }
  return next;
}

/** "Keven fell on delve 7, Level 2, the cellblock" / "Keven was taken on delve 3". */
export function runLine(r: RunRecord): string {
  const how = r.taken ? 'was taken' : 'fell';
  return `Keven ${how} on delve ${Math.max(1, r.delves)}${r.where ? `, ${r.where}` : ''}`;
}
