// V5.1 (W4): step 4, Set out (the approved SetOut board): the castle map drawn from what the party remembers of
// Level 1 (floor, lit walls, pits, doors as hexes; room names; the job's seal; stairs down; a hex pin for each way in,
// the chosen one lamp-lit), the ways in as cards under it, and the muster panel (the job, each hero with their pack
// as hex slots, warnings as icon chips). Lays out on the 1920x900 <main> of the camp stage; nothing scrolls.

import type { Contract, GameState, Item, ItemKind } from '../../game/types';
import { GIFTS, PACK_SLOTS } from '../../game/data';
import { distance, parseHexKey } from '../../game/hex';
import { sfx } from '../../audio/sfx';
import { h } from '../dom';
import { ENTRANCE_LINE, STORY, className, itemLabel } from '../names';
import { type Loadout, type CampHost, type EntranceInfo, entrancesOf, memoryOf, isHeir, packItems, lightCarriers, heroOf, svg } from './shared';
import { ic, type CampIcon } from './icons';
import { bust, bustKey } from './bust';
import { coinStack } from './coinstack';
import { fitMap, hexPoints, loopsPath, traceLoops, type MapFit } from './setout-map';
import './setout.css';

/** The map board, in stage px (the mockup's 1202 x 660). */
const BOARD_W = 1202;
const BOARD_H = 660;

const SOLID = new Set(['wall', 'pillar', 'cracked', 'sealed', 'tallprop', 'brazier']);

const ENT_ICON: Record<string, CampIcon> = { 'Main gate': 'gate', Gatehouse: 'gate', 'Sally port': 'rope', 'East breach': 'push' };
const entIcon = (name: string): CampIcon => ENT_ICON[name] ?? 'gate';

const ITEM_ICON: Partial<Record<ItemKind, CampIcon>> = {
  gold: 'coin', gem: 'gem', jewelry: 'gem', torch: 'torch', potion: 'potion', greaterpotion: 'potion', antidote: 'potion', nightsight: 'moon',
  rope: 'rope', hook: 'rope', ropearrow: 'rope', charge: 'bomb', 'improvised-charge': 'bomb', smoke: 'bomb', glue: 'bomb', firecracker: 'fuse',
  caltrops: 'fuse', heirloom: 'chest', hoard: 'crown', dart: 'aim', venomdart: 'aim', key: 'lock', gatekey: 'lock', lockpicks: 'lock',
  improvised: 'pick', oil: 'flame', lantern: 'lantern', quiver: 'bow', arrows: 'bow', whistlearrows: 'bow', glowarrows: 'bow', firearrows: 'bow',
  poisonarrows: 'bow', barbarrows: 'bow', blastarrows: 'bow',
};
const itemIcon = (i: Item): CampIcon => ITEM_ICON[i.kind] ?? 'sack';

const JOB_ICON: Record<Contract['kind'], CampIcon> = { rescue: 'chain', recover: 'chest', slay: 'skull' };

export function setOutStep(main: HTMLElement, s: GameState, l: Loadout, host: CampHost): void {
  const castle = host.engine.castle();
  const ents = entrancesOf(host.engine, s).filter((x) => x.known);
  const open = ents.filter((x) => x.state === 'open');
  const mem = memoryOf(host.engine, s);
  const contract = s.campaign.board.find((k) => k.id === l.contractId);
  const site = contract ? castle.contractSites.find((x) => x.id === contract.siteId) : undefined;
  const siteKnown = !!site && !!mem.get(site.at.level)?.has(`${site.at.q},${site.at.r}`);
  let closest: number | null = null;
  if (siteKnown && open.length > 1) {
    let best = Infinity;
    for (const e of open) {
      const p = castle.entrances[e.index];
      if (!p || p.level !== site!.at.level) continue;
      const d = distance(p, site!.at);
      if (d < best) ((best = d), (closest = e.index));
    }
  }
  const pick = (e: EntranceInfo) => {
    if (e.state !== 'open') return sfx.play('error');
    sfx.play('click');
    host.setDraft({ ...l, entrance: e.index }, 'setout');
  };

  const left = h('section', { class: 'so-l', 'aria-label': 'Entrance' });
  left.append(
    h('div', { class: 'so-title' }, h('h2', null, 'How do you go in?'), h('span', { class: 'so-title-s' }, open.length > 1 ? 'Every way in is also a way out.' : ents.length > 1 ? 'Only one way in is open. It is also the way out.' : '')),
    sketch(l, host, ents, mem, siteKnown ? site!.at : null, pick),
  );
  const group = h('div', { class: 'so-ents', role: 'radiogroup', 'aria-label': 'Entrance' });
  for (const e of ents) {
    const ok = e.state === 'open';
    const on = ok && l.entrance === e.index;
    const line = ok ? (ENTRANCE_LINE[e.name] ?? e.hint ?? '') : (e.hint ?? (e.state === 'locked' ? 'Locked.' : 'Blocked.'));
    const tag = on ? h('span', { class: 'so-tg' }, ic('check'), closest === e.index ? 'Going in · closest' : 'Going in') : closest === e.index ? h('span', { class: 'so-tg' }, 'Closest to the job') : !ok ? h('span', { class: 'so-tg dim' }, ic('lock'), e.state === 'locked' ? 'Locked' : 'Blocked') : '';
    group.append(
      h(
        'button',
        {
          type: 'button',
          role: 'radio',
          class: `so-ent ${on ? 'on' : ''} ${ok ? '' : 'shut'}`,
          'aria-checked': on ? 'true' : 'false',
          'aria-disabled': ok ? undefined : 'true',
          'data-entrance': `${e.index}`,
          'data-k': `ent-${e.index}`,
          'data-tip': ok ? `${e.name} · ${on ? 'the way in' : 'go in here'}\nWhere you go in is also a way out.${closest === e.index ? '\nThe closest way in to the job.' : ''}` : `${e.name} · ${e.state}\n${line}`,
          onclick: () => pick(e),
        },
        h('b', null, ic(entIcon(e.name), { class: 'so-ent-ic' }), h('span', { class: 'so-ent-n' }, e.name), tag),
        line ? h('small', null, line) : '',
      ),
    );
  }
  left.append(group);
  main.append(h('div', { class: 'so', 'data-screen': 'setout' }, left, muster(s, l, host)));
}

/** The castle map: only what the party remembers of Level 1, fitted into the board, so it grows as they explore. */
function sketch(l: Loadout, host: CampHost, ents: EntranceInfo[], mem: Map<number, Set<string>>, site: { level: number; q: number; r: number } | null, pick: (e: EntranceInfo) => void): HTMLElement {
  const castle = host.engine.castle();
  const lv = castle.levels.find((x) => x.level === 1);
  const known = [...(mem.get(1) ?? [])].filter((k) => !!lv?.tiles[k]);
  if (!lv || !known.length) {
    return h(
      'div',
      { class: 'so-board none', 'data-sketch': 'none' },
      h('div', { class: 'so-none' }, ic('gate', { class: 'so-none-ic' }), h('span', { class: 'so-none-t' }, "You've never been inside. All anyone knows is the main gate.")),
    );
  }
  const entPts = ents.map((e) => ({ e, p: castle.entrances[e.index] })).filter((x) => x.p && x.p.level === 1);
  const fit = fitMap([...known.map(parseHexKey), ...entPts.map((x) => x.p!)], BOARD_W, BOARD_H, { foot: 30, maxS: 30 });
  const of = (kind: (k: string) => boolean) => known.filter((k) => kind(lv.tiles[k]!.kind));
  const g = svg('svg', { viewBox: `0 0 ${BOARD_W} ${BOARD_H}`, preserveAspectRatio: 'xMidYMid meet', role: 'img', 'aria-label': 'Map of what you have seen of Level 1, with the ways in you know' });
  g.append(defs(fit));
  g.append(
    svg('path', { d: loopsPath(traceLoops(known), fit.px), fill: 'url(#so-floor)', 'fill-rule': 'evenodd' }),
    svg('path', { d: loopsPath(traceLoops(of((k) => SOLID.has(k))), fit.px), fill: 'url(#so-wall)', 'fill-rule': 'evenodd', stroke: '#120d08', 'stroke-width': 1.6, 'stroke-linejoin': 'round', filter: 'url(#so-rim)' }),
    svg('path', { d: loopsPath(traceLoops(of((k) => k === 'pit')), fit.px), fill: '#040303', stroke: '#2e2419', 'stroke-width': 2.2, 'stroke-linejoin': 'round' }),
  );
  const tiles = (kind: string, attrs: Record<string, string | number>) => {
    const grp = svg('g', attrs);
    for (const k of of((x) => x === kind)) {
      const { q, r } = parseHexKey(k);
      grp.append(svg('polygon', { points: hexPoints(fit, q, r, 0.9) }));
    }
    return grp;
  };
  g.append(tiles('exit', { fill: '#3a2a12', stroke: '#c9972f', 'stroke-width': 1.4, opacity: 0.95 }), tiles('door', { fill: '#4b3320', stroke: '#a97b3d', 'stroke-width': 1.3 }));
  for (const k of of((x) => x === 'brazier')) {
    const { q, r } = parseHexKey(k);
    const p = fit.at(q, r);
    g.append(svg('circle', { cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: Math.max(30, fit.s * 4), fill: 'url(#so-lamp)' }));
  }
  g.append(tiles('brazier', { fill: '#ffb450', stroke: '#ffe0a0', 'stroke-width': 1.2 }));
  const chosen = entPts.find((x) => x.e.index === l.entrance && x.e.state === 'open');
  if (chosen) {
    const p = fit.at(chosen.p!.q, chosen.p!.r);
    g.append(svg('circle', { class: 'so-lamp', cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: 150, fill: 'url(#so-lamp)' }));
  }
  // Stairs down: one pin per remembered stairs tile (a tile next to one already pinned shares its pin).
  const stairs: { x: number; y: number; q: number; r: number }[] = [];
  for (const k of of((x) => x === 'stairs')) {
    const hx = parseHexKey(k);
    if (stairs.some((o) => distance(o, hx) <= 1)) continue;
    stairs.push({ ...fit.at(hx.q, hx.r), ...hx });
  }
  for (const st of stairs) g.append(svg('circle', { cx: st.x.toFixed(1), cy: st.y.toFixed(1), r: 70, fill: 'url(#so-stl)' }));

  const board = h('div', { class: 'so-board', 'data-sketch': 'level1' }, g);
  // Pins (HTML over the map, in board px): ways in, the job's seal, stairs. Their boxes keep room names off them.
  const taken: { x0: number; x1: number; y0: number; y1: number }[] = [];
  const pin = (cls: string, x: number, y: number, kids: (Node | string)[], attrs: Record<string, string | undefined> = {}, tag: 'div' | 'button' = 'div') => {
    const el = h(tag, { class: `so-pin ${cls}`, style: `left:${x.toFixed(0)}px;top:${y.toFixed(0)}px`, ...attrs }, ...kids);
    board.append(el);
    return el;
  };
  for (const st of stairs) {
    pin('stairs', st.x, st.y, [h('span', { class: 'dot' }, ic('stairs'))], { 'data-stairs': `${st.q},${st.r}`, 'data-tip': 'Stairs down · to Level 2\nYou have found the way deeper.', tabindex: '0' });
    taken.push({ x0: st.x - 22, x1: st.x + 22, y0: st.y - 24, y1: st.y + 20 });
  }
  if (site && site.level === 1) {
    const p = fit.at(site.q, site.r);
    pin('seal', p.x, p.y, [h('span', { class: 'dot' }, ic('star'))], { 'data-seal': '1', 'data-tip': 'The job · where it is', tabindex: '0' });
    taken.push({ x0: p.x - 18, x1: p.x + 18, y0: p.y - 22, y1: p.y + 20 });
  }
  for (const { e, p } of entPts) {
    const q = fit.at(p!.q, p!.r);
    const ok = e.state === 'open';
    const on = ok && e.index === l.entrance;
    const el = pin(on ? 'on' : ok ? 'plain' : 'off', q.x, q.y, [h('span', { class: 'dot' }, ic(entIcon(e.name))), h('span', { class: 'lb lg-sk-ent' }, e.name)], {
      type: 'button',
      'data-entrance-pin': `${e.index}`,
      'aria-label': `${e.name}${on ? ', the way in' : ok ? '' : `, ${e.state}`}`,
      'aria-disabled': ok ? undefined : 'true',
      'data-tip': ok ? `${e.name} · ${on ? 'the way in' : 'go in here'}` : `${e.name} · ${e.state}`,
    }, 'button');
    el.addEventListener('click', () => pick(e));
    const w = e.name.length * 10 + 30;
    taken.push({ x0: q.x - Math.max(28, w / 2), x1: q.x + Math.max(28, w / 2), y0: q.y - 46, y1: q.y + 46 });
  }
  // Room names with a dark halo, where the room's label hex is remembered; a name that would overlap is left out.
  const entNames = new Set(ents.map((e) => e.name.toLowerCase()));
  const names = svg('g', { class: 'so-names' });
  for (const room of lv.rooms) {
    if (!known.includes(`${room.labelAt.q},${room.labelAt.r}`) || entNames.has(room.name.toLowerCase())) continue;
    const p = fit.at(room.labelAt.q, room.labelAt.r);
    const size = room.name.length > 14 ? 16 : 19;
    const w = room.name.length * size * 0.46;
    // At its label hex, else just under it (a pin may sit on the label hex, like the stairs in the Tower stair).
    const free = [0, 40].map((dy) => ({ dy, x0: p.x - w / 2 - 4, x1: p.x + w / 2 + 4, y0: p.y + dy - size + 2, y1: p.y + dy + 8 })).find((b) => b.x0 >= 4 && b.x1 <= BOARD_W - 4 && b.y1 <= BOARD_H - 40 && !taken.some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0));
    if (!free) continue;
    taken.push(free);
    names.append(svg('text', { class: 'so-rn lg-sk-room', x: p.x.toFixed(0), y: (p.y + free.dy + 6).toFixed(0), 'font-size': size }, room.name));
  }
  g.append(names);
  board.append(
    h(
      'div',
      { class: 'so-legend' },
      site && site.level === 1 ? h('span', null, ic('star', { class: 'so-lj' }), 'The job') : '',
      stairs.length ? h('span', null, ic('stairs', { class: 'so-ls' }), 'Stairs down') : '',
      h('span', null, ic('gate', { class: 'so-lw' }), 'Ways in you know'),
    ),
  );
  return board;
}

/** The floor and wall hex patterns, aligned to the real grid (hex 0,0), plus the lamp and stairs glows. */
function defs(fit: MapFit): SVGElement {
  const R = fit.s;
  const wd = Math.sqrt(3) * R;
  const o = fit.at(0, 0);
  const hexAt = (cx: number, cy: number) => [0, 1, 2, 3, 4, 5].map((i) => `${(cx + R * 0.94 * Math.sin((Math.PI / 3) * i)).toFixed(2)},${(cy - R * 0.94 * Math.cos((Math.PI / 3) * i)).toFixed(2)}`).join(' ');
  const pat = (id: string, fill: string, face: string, stroke: string) =>
    svg(
      'pattern',
      { id, width: wd.toFixed(3), height: (3 * R).toFixed(3), x: (o.x - wd / 2).toFixed(2), y: (o.y - R).toFixed(2), patternUnits: 'userSpaceOnUse' },
      svg('rect', { width: wd.toFixed(3), height: (3 * R).toFixed(3), fill }),
      svg('g', { fill: face, stroke, 'stroke-width': 1 }, ...[[wd / 2, R], [0, 2.5 * R], [wd, 2.5 * R]].map(([cx, cy]) => svg('polygon', { points: hexAt(cx!, cy!) }))),
    );
  const glow = (id: string, c: string, a: number) => svg('radialGradient', { id, cx: '50%', cy: '50%', r: '50%' }, svg('stop', { offset: 0, 'stop-color': c, 'stop-opacity': a }), svg('stop', { offset: 1, 'stop-color': c, 'stop-opacity': 0 }));
  return svg(
    'defs',
    {},
    pat('so-floor', '#1c1612', '#27201a', '#0d0906'),
    pat('so-wall', '#40362d', '#5b4e41', '#17110b'),
    glow('so-lamp', '#ffb450', 0.38),
    glow('so-stl', '#8fe3d6', 0.5),
    svg('filter', { id: 'so-rim' }, svg('feDropShadow', { dx: 0, dy: -1.5, stdDeviation: 0, 'flood-color': '#8a7358', 'flood-opacity': 0.55 })),
  );
}

const lower = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

/** The muster panel: the job, who goes in with what, and the warnings. */
function muster(s: GameState, l: Loadout, host: CampHost): HTMLElement {
  const c = s.campaign;
  const k = c.board.find((x) => x.id === l.contractId);
  const box = h('aside', { class: 'panel so-muster', 'aria-label': 'The party goes in' }, h('div', { class: 'kick' }, 'The party goes in'));
  if (k) {
    const st = k.story ? STORY[k.story] : null;
    const gift = k.story ? GIFTS[k.story] : undefined;
    const sub = h('div', { class: 'so-job-sub' }, h('span', { class: 'lv num' }, `Lvl ${k.level}`));
    if (k.bounty) {
      const cs = coinStack(k.bounty).el;
      cs.classList.add('so-coins');
      sub.append(h('span', { class: 'so-bounty', 'data-tip': `Bounty · ${k.bounty} gold when the job is done` }, cs, h('span', { class: 'num' }, `${k.bounty}`)));
    }
    if (gift) {
      const gIc: CampIcon = gift.items?.[0] ? (ITEM_ICON[gift.items[0][0] as ItemKind] ?? 'sack') : gift.ale ? 'mug' : 'shield';
      sub.append(h('span', { class: 'gift', 'data-tip': `A gift · ${gift.line}` }, ic(gIc), gift.short));
    }
    if (st) sub.append(h('span', { class: 'so-wins', 'data-tip': `Wins back · ${st.unlocks}` }, ic('heart', { class: 'so-heart' }), `wins back ${lower(st.unlocks.split(':')[0]!)}`));
    else if (!k.bounty) sub.append(h('span', null, 'No pay: bring them home'));
    box.append(h('div', { class: 'so-job', 'data-tip': `${k.title} · the job\n${k.brief}` }, h('span', { class: 'ico itm' }, ic(JOB_ICON[k.kind] ?? 'scroll')), h('div', { class: 'so-job-t' }, h('h3', null, k.title), sub)));
  } else box.append(h('div', { class: 'so-job none' }, h('span', { class: 'ico itm' }, ic('scroll')), h('div', { class: 'so-job-t' }, h('h3', null, 'No job chosen.'))));

  const who = h('div', { class: 'so-who' });
  if (!l.heroIds.length) who.append(h('p', { class: 'so-nobody dim' }, 'Nobody is going in.'));
  for (const id of l.heroIds) {
    const hr = heroOf(c, id);
    if (!hr) continue;
    const items = packItems(c, l, id);
    const row = h('div', { class: 'so-slots' });
    let used = 0;
    for (const it of items) {
      const n = Math.max(1, it.slots);
      for (let j = 0; j < n && used < PACK_SLOTS; j++, used++) row.append(h('span', { class: `ms${j ? ' cont' : ''}`, 'data-tip': itemLabel(it), 'data-item': it.kind }, ic(itemIcon(it))));
    }
    for (; used < PACK_SLOTS; used++) row.append(h('span', { class: 'ms e', 'aria-hidden': 'true' }));
    const key = bustKey(hr.cls);
    who.append(
      h(
        'div',
        { class: 'so-mh', 'data-hero': id, style: `--c:var(--k-${key})` },
        h('div', { class: 'bw' }, bust(hr.cls, { size: 78 })),
        h('div', null, h('div', { class: 'nm' }, h('b', null, hr.name), h('span', null, hr.cls === 'heir' ? 'The heir' : className(hr.cls))), row),
      ),
    );
  }
  box.append(who);

  const warns = h('div', { class: 'so-warns' });
  if (l.heroIds.some((id) => isHeir(c, id))) {
    const alone = l.heroIds.length === 1;
    warns.append(h('div', { class: 'wn red', 'data-warn': 'heir' }, ic('crown'), alone ? "Keven goes in alone. If he falls, it's over." : 'Keven goes in. If he falls, the campaign ends with him.'));
  }
  let problem: string | null = null;
  try {
    problem = host.engine.partyProblem(s, l.heroIds);
  } catch {
    problem = null;
  }
  if (problem) warns.append(h('div', { class: 'wn red', 'data-warn': 'party' }, ic('warn'), problem));
  // V4.1 (WS2): nobody packs a torch or a lantern.
  if (l.heroIds.length && !lightCarriers(c, l).length) warns.append(h('div', { class: 'wn amb', 'data-warn': 'nolight', 'data-tip': "No light · Level 1's daylight will do; deeper, you'll want a torch." }, ic('torch'), 'No light source packed.'));
  box.append(warns);
  return box;
}

/** The footer's middle line on Set out (for the shell): what stops the Delve, else nothing. */
export function footNote(s: GameState, l: Loadout, host: CampHost): string {
  let problem: string | null = null;
  try {
    problem = host.engine.partyProblem(s, l.heroIds);
  } catch {
    problem = null;
  }
  if (!problem && !s.campaign.board.some((k) => k.id === l.contractId)) problem = 'No job chosen.';
  if (!problem && !l.heroIds.length) problem = 'Pick at least one hero.';
  return problem ?? '';
}
