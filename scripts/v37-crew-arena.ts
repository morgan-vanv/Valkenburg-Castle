// V3.7 (spec 20.4) crew balance: a headless arena on the test castle's Crossing. A party of heroes
// (class, level, tiers as given) meets a hostile crew in the open and both sides fight with simple
// rules: heroes focus the lowest-HP member in reach, drink a potion below half, close in otherwise.
// Run: npx tsx scripts/v37-crew-arena.ts [fights=40]   (CREW=ferrymen PARTY=l1x3 SEED=1 VERBOSE=1)
// Prints, per crew and party: fights won (every member dead) / lost (every hero down, dead or taken)
// / stalled, heroes downed and captured, rounds, and members killed on a loss.

import { createEngine } from '../src/game/engine';
import { at, testCastle } from '../src/game/test/testCastle';
import { posKey, samePos, distance, type Pos } from '../src/game/hex';
import type { ActionKind, GameState, HeroClass, Item } from '../src/game/types';
import type { GameStateX } from '../src/game/state';
import { buildCrew } from '../src/game/rivals';
import { makeHero } from '../src/game/camp';
import { CREWS } from '../src/game/data';
import type { CrewId } from '../src/game/types';

const N = Number(process.argv[2] ?? 40);
const SEED = Number(process.env.SEED ?? 1);
const VERBOSE = process.env.VERBOSE === '1';
const e = createEngine(testCastle);

type PartyDef = { name: string; heroes: [HeroClass, number][]; weaponTier?: 0 | 1 | 2; armorTier?: 0 | 1 | 2; potions?: number };
const PARTIES: Record<string, PartyDef> = {
  l1x3: { name: '3 heroes L1 (heir, sellsword, burglar), 1 potion', heroes: [['heir', 1], ['sellsword', 1], ['burglar', 1]], potions: 1 },
  l1x4: { name: '4 heroes L1 (+ranger), 2 potions', heroes: [['heir', 1], ['sellsword', 1], ['burglar', 1], ['ranger', 1]], potions: 2 },
  l2x4: { name: '4 heroes L2 (heir, sellsword, ranger, pyromancer), W1, 2 potions', heroes: [['heir', 2], ['sellsword', 2], ['ranger', 2], ['pyromancer', 2]], weaponTier: 1, potions: 2 },
  l3x4: { name: '4 heroes L3, W1 A1, 3 potions', heroes: [['heir', 3], ['sellsword', 3], ['ranger', 3], ['hedgewitch', 3]], weaponTier: 1, armorTier: 1, potions: 3 },
  l4x4: { name: '4 heroes L4, W2 A1, 4 potions', heroes: [['heir', 4], ['sellsword', 4], ['ranger', 4], ['pyromancer', 4]], weaponTier: 2, armorTier: 1, potions: 4 },
};
const CREW_LIST: CrewId[] = (process.env.CREW ? [process.env.CREW as CrewId] : ['lantern-sisters', 'ferrymen', 'gallows-choir', 'the-wake']);
const PARTY_LIST = process.env.PARTY ? [process.env.PARTY] : Object.keys(PARTIES);

// The Crossing (L2): the crew east of the pit at its posts, the party by the west door.
const CREW_SPOTS = [at(2, 16, 4), at(2, 17, 4), at(2, 18, 4), at(2, 17, 3)];
const HERO_SPOTS = [at(2, 8, 2), at(2, 9, 2), at(2, 8, 1), at(2, 9, 1)];

function setup(seed: number, pd: PartyDef, crewId: CrewId): GameState {
  let s = e.newGame(seed);
  const ids: string[] = [];
  pd.heroes.forEach(([cls, level], i) => {
    const id = i === 0 ? 'keven' : `h${i}`;
    if (i > 0) s.campaign.roster.push(makeHero(id, `Hero${i}`, cls, level));
    else {
      const k = s.campaign.roster[0]!;
      for (let l = 1; l < level; l++) { k.level++; k.maxHp += 2; k.hp += 2; k.stats.might += 5; }
    }
    ids.push(id);
  });
  for (const h of s.campaign.roster) {
    h.weaponTier = pd.weaponTier ?? 0;
    h.armorTier = pd.armorTier ?? 0;
  }
  const packs: Record<string, string[]> = {};
  const r = e.apply(s, { type: 'startDelve', contractId: s.campaign.board[0]!.id, heroIds: ids, entrance: 0, packs });
  if (r.error) throw new Error(r.error);
  s = r.state;
  const d = s.delve!;
  d.monsters = [];
  d.traps = {};
  d.light = 20;
  d.lanternOpen = true;
  d.heroes.forEach((h, i) => (h.at = { ...HERO_SPOTS[i]! }));
  // Potions spread over the party.
  for (let i = 0; i < (pd.potions ?? 0); i++) {
    const h = d.heroes[i % d.heroes.length]!;
    const it: Item = { id: `pot${i}`, kind: 'potion', name: 'Potion', amount: 1, slots: 1 };
    h.pack.push(it);
  }
  const cr = buildCrew(s as GameStateX, crewId, CREW_SPOTS);
  cr.stance = 'hostile';
  cr.spotted = true;
  d.rivals = cr;
  // Doors open along the Crossing.
  for (const k of Object.keys(d.doors)) if (k.startsWith('2:')) d.doors[k]!.open = true;
  return s;
}

function option(s: GameState, id: string, a: ActionKind) {
  const o = e.actions(s, id).find((x) => x.action === a);
  return o && !o.blocked ? o : undefined;
}

function heroTurn(s: GameState, id: string): GameState {
  const run = (cmd: Parameters<typeof e.apply>[1]) => {
    const r = e.apply(s, cmd);
    if (r.error) {
      if (VERBOSE) console.log('  refused', cmd.type, r.error);
      return s;
    }
    return r.state;
  };
  const me = () => s.delve?.heroes.find((h) => h.heroId === id);
  const alive = () => s.stage === 'delve' && me()?.status === 'active';
  const def = e.heroById(s, id)!;
  const hpOf = (tid: string) => s.delve!.rivals?.members.find((r) => r.id === tid)?.hp ?? 99;
  const tryAct = () => {
    if (!alive() || me()!.acted) return;
    const m = me()!;
    if (m.hp * 2 < def.maxHp) {
      const p = option(s, id, 'potion');
      const t = p?.targets.find((x) => x.id === id);
      if (t) {
        s = run({ type: 'act', heroId: id, action: 'potion', target: t, focus: 0 });
        return;
      }
    }
    const rev = option(s, id, 'revive');
    if (rev && !option(s, id, 'attack')) {
      s = run({ type: 'act', heroId: id, action: 'revive', target: rev.targets[0]!, focus: 0 });
      return;
    }
    for (const a of ['fireball', 'firebolt', 'attack', 'dread', 'mend'] as ActionKind[]) {
      const o = option(s, id, a);
      if (!o) continue;
      if (a === 'fireball') {
        // Only where 2+ members stand within 1 and no hero.
        const best = o.targets.find((t) => {
          const ms = s.delve!.rivals!.members.filter((r) => r.hp > 0 && !r.goneOut && r.at.level === t.at!.level && distance(r.at, t.at!) <= 1).length;
          const hs = s.delve!.heroes.filter((h) => h.status === 'active' && h.at.level === t.at!.level && distance(h.at, t.at!) <= 1).length;
          return ms >= 2 && hs === 0;
        });
        if (!best) continue;
        s = run({ type: 'act', heroId: id, action: a, target: best, focus: 0 });
        return;
      }
      if (a === 'mend') {
        const hurt = o.targets.find((t) => { const h = s.delve!.heroes.find((x) => x.heroId === t.id)!; return h.hp * 2 < (e.heroById(s, t.id!)?.maxHp ?? 0); });
        if (!hurt) continue;
        s = run({ type: 'act', heroId: id, action: a, target: hurt, focus: 0 });
        return;
      }
      const ts = o.targets.filter((t) => s.delve!.rivals!.members.some((r) => r.id === t.id)).sort((x, y) => hpOf(x.id!) - hpOf(y.id!));
      if (!ts.length) continue;
      const pv = e.preview(s, id, a, ts[0]!);
      s = run({ type: 'act', heroId: id, action: a, target: ts[0]!, focus: Math.min(pv.maxFocus, 1) });
      return;
    }
  };
  tryAct();
  if (!alive()) return s;
  if (!me()!.moved && !option(s, id, 'attack')) {
    const m = me()!;
    const foes = s.delve!.rivals!.members.filter((r) => r.hp > 0 && !r.goneOut);
    const reach = e.reachable(s, id, false).filter((r) => !r.dash);
    const dist = (p: Pos) => Math.min(99, ...foes.filter((f) => f.at.level === p.level).map((f) => distance(f.at, p)));
    let best: (typeof reach)[0] | undefined;
    let bestD = dist(m.at);
    const ranged = def.cls === 'ranger' || def.cls === 'pyromancer';
    for (const r of reach) {
      const dd = dist(r.to);
      // Ranged heroes keep 3 away; melee closes to 1.
      const score = ranged ? Math.abs(dd - 3) : dd;
      const cur = ranged ? Math.abs(bestD - 3) : bestD;
      if (score < cur || (best && score === cur && r.cost < best.cost)) { bestD = dd; best = r; }
    }
    if (best) s = run({ type: 'move', heroId: id, path: best.path, sneak: false });
  }
  tryAct();
  return s;
}

interface Result { won: boolean; lost: boolean; rounds: number; downed: number; captured: number; dead: number; killed: number; heroesLeft: number }

function fight(seed: number, pd: PartyDef, crewId: CrewId): Result {
  let s = setup(seed, pd, crewId);
  let downed = 0;
  for (let round = 0; round < 30 && s.stage === 'delve'; round++) {
    for (const h of s.delve!.heroes.filter((x) => x.status === 'active')) {
      if (s.stage !== 'delve') break;
      s = heroTurn(s, h.heroId);
    }
    if (s.stage !== 'delve') break;
    const members = s.delve!.rivals!.members.filter((r) => r.hp > 0 && !r.goneOut);
    if (!members.length) break;
    const r = e.apply(s, { type: 'endTurn' });
    downed += r.events.filter((x) => x.type === 'downed').length;
    if (VERBOSE) for (const x of r.events) if (x.type === 'say') console.log('   ', x.text);
    s = r.state;
    if (VERBOSE && s.delve) console.log(`r${s.delve.round}`, s.delve.heroes.map((h) => `${h.heroId}:${h.status}${h.hp}`).join(' '), '|', s.delve.rivals!.members.map((m) => `${m.cls}${m.hp}${m.dragging ? '*' : ''}`).join(' '));
  }
  const d = s.delve;
  const cr = d?.rivals;
  const alive = cr ? cr.members.filter((m) => m.hp > 0).length : 0;
  const heroesLeft = d ? d.heroes.filter((h) => h.status === 'active').length : 0;
  const captured = d ? d.heroes.filter((h) => h.status === 'captured').length : 0;
  const dead = d ? d.heroes.filter((h) => h.status === 'dead').length : 0;
  const won = cr ? cr.members.every((m) => m.hp <= 0) : false;
  const lost = !won && heroesLeft === 0;
  return { won, lost, rounds: d?.round ?? 0, downed, captured, dead, killed: cr ? cr.members.length - alive : 0, heroesLeft };
}

// LEVEL=n WEAPON=n ARMOR=n override the crew table (tuning).
for (const crewId of CREW_LIST) {
  if (process.env.LEVEL) CREWS[crewId].level = Number(process.env.LEVEL);
  if (process.env.WEAPON) CREWS[crewId].weaponTier = Number(process.env.WEAPON) as 0 | 1 | 2;
  if (process.env.ARMOR) CREWS[crewId].armorTier = Number(process.env.ARMOR) as 0 | 1 | 2;
  console.log(`\n${CREWS[crewId].name} (level ${CREWS[crewId].level}, W${CREWS[crewId].weaponTier} A${CREWS[crewId].armorTier}, ${CREWS[crewId].members.map((m) => m.cls).join('/')})`);
  for (const pk of PARTY_LIST) {
    const pd = PARTIES[pk]!;
    const rs: Result[] = [];
    for (let i = 0; i < N; i++) rs.push(fight(SEED + i * 7919, pd, crewId));
    const n = rs.length;
    const sum = (f: (r: Result) => number) => rs.reduce((a, r) => a + f(r), 0);
    const pct = (k: number) => `${Math.round((100 * k) / n)}%`;
    console.log(
      `  ${pk.padEnd(5)} ${pd.name.padEnd(62)} won ${pct(sum((r) => (r.won ? 1 : 0))).padStart(4)}  lost ${pct(sum((r) => (r.lost ? 1 : 0))).padStart(4)}  rounds ${(sum((r) => r.rounds) / n).toFixed(1).padStart(4)}  downed/fight ${(sum((r) => r.downed) / n).toFixed(1)}  dead ${sum((r) => r.dead)}  captured ${sum((r) => r.captured)}  members killed/fight ${(sum((r) => r.killed) / n).toFixed(1)}  heroes left on a win ${(sum((r) => (r.won ? r.heroesLeft : 0)) / Math.max(1, sum((r) => (r.won ? 1 : 0)))).toFixed(1)}`,
    );
  }
}
void posKey;
void samePos;
