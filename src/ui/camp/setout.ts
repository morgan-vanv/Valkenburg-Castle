// V5.1 (W0): step 4, Set out: the ways in, the castle sketch, the plan. Split out of src/ui/lowgate.ts.

import type { GameState } from '../../game/types';
import { GIFTS } from '../../game/data';
import { distance, hexToWorld, parseHexKey } from '../../game/hex';
import { sfx } from '../../audio/sfx';
import { h } from '../dom';
import { ENTRANCE_LINE, STORY, itemLabel } from '../names';
import { type Loadout, type CampHost, type EntranceInfo, entrancesOf, memoryOf, isHeir, packItems, lightCarriers, numWord, heroOf, hexBadge, svg, warnTri, stepHead } from './shared';

export function setOutStep(main: HTMLElement, s: GameState, l: Loadout, host: CampHost): void {
  const c = s.campaign;
  const castle = host.engine.castle();
  const ents = entrancesOf(host.engine, s).filter((x) => x.known);
  const open = ents.filter((x) => x.state === 'open');
  const mem = memoryOf(host.engine, s);
  const contract = c.board.find((k) => k.id === l.contractId);
  const site = contract ? castle.contractSites.find((x) => x.id === contract.siteId) : undefined;
  const siteKnown = !!site && !!mem.get(site.at.level)?.has(`${site.at.q},${site.at.r}`);
  let closest: number | null = null;
  if (siteKnown && open.length > 1) {
    let best = Infinity;
    for (const e of open) {
      const p = castle.entrances[e.index];
      if (!p) continue;
      const d = distance(p, site!.at);
      if (d < best) ((best = d), (closest = e.index));
    }
  }
  const left = h('section', { class: 'lg-setout-l', 'aria-label': 'Entrance' });
  const lvl1 = castle.levels.find((x) => x.level === 1)?.name ?? 'the castle';
  left.append(stepHead('How do you go in?', open.length > 1 ? `${numWord(open.length)} ways into ${lvl1.replace(/^The /, 'the ')} that you know of. Each one is also a way out.` : 'The main gate is the only way in anyone knows. It is also the way out.'));
  left.append(sketch(s, l, host, ents, mem, siteKnown ? site!.at : null));
  const group = h('div', { class: 'lg-ents', role: 'radiogroup', 'aria-label': 'Entrance' });
  for (const e of ents) {
    const ok = e.state === 'open';
    const on = ok && l.entrance === e.index;
    const line = ok ? (ENTRANCE_LINE[e.name] ?? e.hint ?? '') : (e.hint ?? (e.state === 'locked' ? 'Locked.' : 'Blocked.'));
    group.append(
      h(
        'button',
        {
          type: 'button',
          role: 'radio',
          class: `lg-ent ${on ? 'on' : ''} ${ok ? '' : 'shut'}`,
          'aria-checked': on ? 'true' : 'false',
          'aria-disabled': ok ? undefined : 'true',
          'data-entrance': `${e.index}`,
          'data-k': `ent-${e.index}`,
          'data-tip': ok ? `${e.name} · ${on ? 'the way in' : 'go in here'}\nWhere you go in is also a way out.` : `${e.name} · ${e.state}\n${line}`,
          onclick: () => {
            if (!ok) return sfx.play('error');
            sfx.play('click');
            host.setDraft({ ...l, entrance: e.index }, 'setout');
          },
        },
        h('span', { class: 'lg-ent-top' }, h('span', { class: 'lg-ent-n' }, e.name), closest === e.index ? h('span', { class: 'lg-kick' }, 'Closest to the job') : !ok ? h('span', { class: 'lg-kick lg-kick-dim' }, e.state === 'locked' ? 'Locked' : 'Blocked') : ''),
        line ? h('span', { class: 'lg-ent-l' }, line) : '',
      ),
    );
  }
  left.append(group);
  // V4.1 (WS2): the "Go in with the lantern shut" checkbox is gone (no free lantern; packed lights go in unlit).
  const hasSketch = !!left.querySelector('.lg-sketch:not(.none)');
  main.append(h('div', { class: 'lg-setout' }, left, hasSketch ? h('div', { class: 'lg-setout-r' }, plan(s, l, host)) : plan(s, l, host)));
}

function sketch(s: GameState, l: Loadout, host: CampHost, ents: EntranceInfo[], mem: Map<number, Set<string>>, site: { level: number; q: number; r: number } | null): HTMLElement {
  const castle = host.engine.castle();
  const lv = castle.levels.find((x) => x.level === 1);
  const known = mem.get(1);
  if (!lv || !known?.size) {
    return h('div', { class: 'lg-sketch none', 'data-sketch': 'none' }, h('span', { class: 'lg-sketch-none' }, "You've never been inside. All anyone knows is the main gate."));
  }
  void s;
  // V4.0 (spec 30.5, owner: "emphasized more"): the sketch is drawn in world units (a hex is 1 across its corners) and
  // scales to fill the column (preserveAspectRatio meet), so hexes, marks and room names grow with the space it gets.
  const hexes = [...known].map(parseHexKey);
  const pts = hexes.map((x) => hexToWorld(x));
  const entPts = ents.map((e) => ({ e, p: castle.entrances[e.index] })).filter((x) => x.p && x.p.level === 1);
  for (const x of entPts) pts.push(hexToWorld(x.p!));
  const pad = 1.6;
  const minX = Math.min(...pts.map((p) => p.x)) - pad;
  const maxX = Math.max(...pts.map((p) => p.x)) + pad;
  const minZ = Math.min(...pts.map((p) => p.z)) - pad;
  const maxZ = Math.max(...pts.map((p) => p.z)) + pad + 1.2; // room under the lowest entrance's name
  const W = maxX - minX;
  const H = maxZ - minZ;
  const at = (q: number, r: number) => {
    const w = hexToWorld({ q, r });
    return { x: w.x - minX, y: w.z - minZ };
  };
  const g = svg('svg', { viewBox: `0 0 ${W.toFixed(2)} ${H.toFixed(2)}`, preserveAspectRatio: 'xMidYMid meet', role: 'img', 'aria-label': 'Sketch of what you have seen of Level 1, with the ways in you know' });
  const rr = 0.97;
  const corners = (cx: number, cy: number) =>
    [0, 1, 2, 3, 4, 5]
      .map((i) => {
        const a = (Math.PI / 180) * (60 * i - 30);
        return `${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`;
      })
      .join(' ');
  const solid = new Set(['wall', 'pillar', 'cracked', 'sealed', 'tallprop', 'brazier']);
  for (const hx of hexes) {
    const t = lv.tiles[`${hx.q},${hx.r}`];
    if (!t) continue;
    const p = at(hx.q, hx.r);
    const fill = solid.has(t.kind) ? '#4a3f35' : t.kind === 'pit' ? '#070606' : t.kind === 'exit' ? '#3a2a12' : '#211b17';
    g.append(svg('polygon', { points: corners(p.x, p.y), fill }));
  }
  if (site && site.level === 1) {
    const p = at(site.q, site.r);
    g.append(svg('circle', { cx: p.x.toFixed(2), cy: p.y.toFixed(2), r: 0.75, fill: '#8f1018', stroke: '#ffcf86', 'stroke-width': 0.12 }), svg('text', { x: p.x.toFixed(2), y: (p.y + 0.38).toFixed(2), fill: '#ffcf86', 'font-size': 1.0, 'text-anchor': 'middle' }, '✦'));
  }
  const entMarks = entPts.map(({ e, p }) => ({ e, q: at(p!.q, p!.r) }));
  for (const { e, q } of entMarks) {
    const on = e.index === l.entrance;
    const ok = e.state === 'open';
    g.append(svg('rect', { x: (q.x - 0.65).toFixed(2), y: (q.y - 0.65).toFixed(2), width: 1.3, height: 1.3, fill: on ? '#3a2a12' : '#0b0908', stroke: on ? '#e8a33d' : ok ? '#8a7f6e' : '#5a4c3f', 'stroke-width': on ? 0.24 : 0.14, 'stroke-dasharray': ok ? '' : '0.3 0.2' }));
  }
  // Names (entrances first, then rooms): in map units, so they grow with the sketch, but never under ~12px on screen,
  // and never on top of each other (a room name that would overlap is left out). Laid out again when the sketch resizes.
  const entNames = new Set(ents.map((e) => e.name.toLowerCase()));
  const names = [
    ...entMarks.map(({ e, q }) => ({ text: e.name, x: q.x, y: q.y + 1.9, ent: true, on: e.index === l.entrance })),
    ...lv.rooms.filter((room) => known.has(`${room.labelAt.q},${room.labelAt.r}`) && !entNames.has(room.name.toLowerCase())).map((room) => ({ ...at(room.labelAt.q, room.labelAt.r), text: room.name, ent: false, on: false })),
  ];
  const layer = svg('g', { class: 'lg-sk-names' });
  g.append(layer);
  let laid = 0;
  const layout = (pxPerUnit: number) => {
    const fs = Math.max(1.05, 12.5 / Math.max(0.1, pxPerUnit));
    if (Math.abs(fs - laid) < 0.01) return;
    laid = fs;
    while (layer.firstChild) layer.removeChild(layer.firstChild);
    const taken: { x0: number; x1: number; y0: number; y1: number }[] = [];
    for (const n of names) {
      const size = n.ent ? fs * 1.08 : fs;
      const w = n.text.length * size * 0.5;
      const y = n.ent ? n.y + (size - 1.05) * 0.6 : n.y;
      const box = { x0: n.x - w / 2 - 0.2, x1: n.x + w / 2 + 0.2, y0: y - size * 0.85, y1: y + size * 0.3 };
      if (!n.ent && taken.some((o) => box.x0 < o.x1 && box.x1 > o.x0 && box.y0 < o.y1 && box.y1 > o.y0)) continue;
      taken.push(box);
      layer.append(svg('text', { class: n.ent ? 'lg-sk-ent' : 'lg-sk-room', x: n.x.toFixed(2), y: y.toFixed(2), fill: n.ent ? (n.on ? '#ffcf86' : '#c8bba4') : '#a89c88', 'font-family': 'IM Fell English, Georgia, serif', 'font-size': size.toFixed(2), 'text-anchor': 'middle', 'paint-order': 'stroke', stroke: '#110d0b', 'stroke-width': (size * 0.2).toFixed(2) }, n.text));
    }
  };
  layout(14);
  const box = h('div', { class: 'lg-sketch', 'data-sketch': 'level1' }, g);
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(() => {
      if (!box.isConnected) return ro.disconnect();
      const r = (g as unknown as SVGSVGElement).getBoundingClientRect();
      if (r.width && r.height) layout(Math.min(r.width / W, r.height / H));
    });
    ro.observe(box);
  }
  return box;
}

function plan(s: GameState, l: Loadout, host: CampHost): HTMLElement {
  const c = s.campaign;
  const k = c.board.find((x) => x.id === l.contractId);
  const st = k?.story ? STORY[k.story] : null;
  const box = h('aside', { class: 'lg-plan', 'aria-label': 'The plan' }, h('div', { class: 'lg-kick' }, 'The plan'));
  box.append(
    k
      ? h('div', { class: 'lg-plan-job' }, h('span', { class: 'lg-plan-t' }, k.title), h('span', { class: 'lg-plan-s' }, k.bounty ? h('span', { class: 'num lg-goldtxt' }, `${k.bounty}`) : '', k.bounty ? ` gold${st ? ` · wins back ${st.unlocks.charAt(0).toLowerCase()}${st.unlocks.slice(1)}` : ''}` : st ? `Wins back ${st.unlocks.charAt(0).toLowerCase()}${st.unlocks.slice(1)}${k.story && GIFTS[k.story] ? ` · gift: ${GIFTS[k.story]!.short.charAt(0).toLowerCase()}${GIFTS[k.story]!.short.slice(1)}` : ''}` : 'No pay: bring them home'), h('span', { class: 'lg-plan-s' }, k.brief))
      : h('div', { class: 'lg-plan-job' }, h('span', { class: 'lg-plan-s' }, 'No job chosen.')),
  );
  const who = h('div', { class: 'lg-plan-who' });
  if (!l.heroIds.length) who.append(h('span', { class: 'lg-plan-s' }, 'Nobody is going in.'));
  for (const id of l.heroIds) {
    const hr = heroOf(c, id);
    if (!hr) continue;
    const carry = [...packItems(c, l, id).map((i) => (i.kind === 'gem' || i.kind === 'jewelry' ? i.name : itemLabel(i)))];
    who.append(h('div', { class: 'lg-plan-hero', 'data-hero': id }, hexBadge(hr.cls, 'sm'), h('span', { class: 'lg-plan-n' }, hr.name), h('span', { class: 'lg-plan-c' }, carry.length ? carry.join(' · ') : 'Nothing packed')));
  }
  box.append(who);
  const keven = l.heroIds.some((id) => isHeir(c, id));
  if (keven) {
    const alone = l.heroIds.length === 1;
    box.append(h('div', { class: 'lg-plan-warn warn-heir' }, warnTri('#ff8a8f', 16), h('span', null, alone ? "Keven goes in alone. If he falls, it's over." : 'Keven goes in. If he falls, the campaign ends with him.')));
  }
  let problem: string | null = null;
  try {
    problem = host.engine.partyProblem(s, l.heroIds);
  } catch {
    problem = null;
  }
  if (problem) box.append(h('div', { class: 'lg-plan-warn' }, warnTri('#ff8a8f', 16), h('span', null, problem)));
  // V4.1 (WS2): nobody packs a torch or a lantern.
  if (l.heroIds.length && !lightCarriers(c, l).length) box.append(h('div', { class: 'lg-plan-warn warn-light', 'data-warn': 'nolight' }, warnTri('#e8a33d', 16), h('span', null, "No light packed. Level 1's daylight will do; deeper, you'll want a torch.")));
  box.append(h('span', { class: 'lg-plan-s dim' }, 'Every step stays open: click one along the top to change it.'));
  return box;
}
