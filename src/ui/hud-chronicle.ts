// V4.0 HUD: the Chronicle, the delve's log as a panel on the right. Folded: the round and the last
// two lines. Open: every line of this delve, newest first, grouped by round and phase ("Round 2 · the
// castle", "Round 2 · your turn"), each with a small icon for what kind of thing happened.
// Open or folded is remembered per browser.

import type { IconName } from '../view/icons';
import { clear, h, icon } from './dom';

const OPEN_KEY = 'vc.chronicle.open.v40';

export type ChronKind = 'strike' | 'move' | 'heard' | 'shout' | 'item' | 'crew' | 'warn' | 'light' | 'plain';

export interface ChronEntry {
  round: number;
  /** 'start': lines from before this session saw the delve (a reload): no round known. */
  phase: 'player' | 'world' | 'start';
  text: string;
  kind: ChronKind;
  cls: string;
}

const KIND_ICON: Record<ChronKind, IconName> = {
  strike: 'sword',
  move: 'move',
  heard: 'steps',
  shout: 'shout',
  item: 'sack',
  crew: 'crew',
  warn: 'warn',
  light: 'lantern',
  plain: 'dot',
};

/** What kind of line this is, from its words (and the class the playback gave it). */
export function chronKind(text: string, cls = ''): ChronKind {
  if (/log-heard/.test(cls) || /^(footsteps|a clash|a shout|a crash|a blast|a roar|a scream|something)/i.test(text)) return 'heard';
  if (/shout|bellow|horn/i.test(text)) return 'shout';
  if (/lantern|gutters|pitch black|the dark/i.test(text)) return 'light';
  if (/ · [a-z]+.*: \d+\/\d+|strike|attack|hits|swing|backstab|damage|dmg|misses|fires|shot|bite|firebolt|fireball/i.test(text)) return 'strike';
  if (/ is down|is dead|taken|left behind|notices|wakes|combat|grabs|webbed|dragged|robs|stole/i.test(text)) return 'warn';
  if (/crew|sisters|ferrymen|choir|the wake|toll|truce|hire|parley|deal|sell-swords/i.test(text)) return 'crew';
  if (/gold|takes|picks up|finds|loot|chest|potion|torch|garnet|ruby|gem|key|heirloom|carries/i.test(text)) return 'item';
  if (/moves|walks|steps|slips|sneaks|comes|enters|climbs|jumps|falls|leaves|is out/i.test(text)) return 'move';
  return 'plain';
}

export class Chronicle {
  readonly el = h('section', { class: 'dl-chron', 'aria-label': 'Chronicle' });
  private entries: ChronEntry[] = [];
  private key = '';
  private round = 1;
  private phase: 'player' | 'world' = 'player';
  open = false;

  constructor() {
    try {
      this.open = localStorage.getItem(OPEN_KEY) === '1';
    } catch {
      /* storage blocked: folded */
    }
  }

  /** A new delve (or a reload): start over, seeding with the state's log lines when this session saw none of them. */
  sync(key: string, round: number, phase: 'player' | 'world', log: string[]): void {
    if (key !== this.key) {
      this.key = key;
      this.entries = log.slice(-40).map((text) => ({ round, phase: 'start' as const, text, kind: chronKind(text), cls: '' }));
    }
    this.round = round;
    this.phase = phase;
  }

  setPhase(phase: 'player' | 'world', round: number): void {
    this.phase = phase;
    this.round = round;
  }

  add(text: string, cls = ''): void {
    // The same line twice in a row (an engine line echoed by the playback) is kept once.
    const last = this.entries[this.entries.length - 1];
    if (last && last.text === text && last.round === this.round && last.phase === this.phase) return;
    this.entries.push({ round: this.round, phase: this.phase, text, kind: chronKind(text, cls), cls });
    if (this.entries.length > 400) this.entries.splice(0, this.entries.length - 400);
    this.render();
  }

  get lines(): ChronEntry[] {
    return this.entries;
  }

  toggle(): void {
    this.open = !this.open;
    try {
      localStorage.setItem(OPEN_KEY, this.open ? '1' : '0');
    } catch {
      /* ignore */
    }
    this.render();
  }

  render(): void {
    const el = this.el;
    clear(el);
    el.classList.toggle('open', this.open);
    const head = h(
      'button',
      { type: 'button', class: 'dl-chron-head', 'aria-expanded': this.open ? 'true' : 'false', 'data-tip': `Chronicle · what has happened this delve\n${this.open ? 'Click to fold it to the last lines.' : 'Click to open every line, newest first, by round.'}`, onclick: () => this.toggle() },
      h('span', { class: 'dl-kick dl-kick-dim' }, `Chronicle · round ${this.round}`),
      h('span', { class: 'dl-chron-tog' }, this.open ? 'fold ▴' : 'open ▾'),
    );
    el.append(head);
    if (!this.entries.length) {
      el.append(h('div', { class: 'dl-chron-line dim' }, 'Nothing yet.'));
      return;
    }
    if (!this.open) {
      for (const e of this.entries.slice(-2)) el.append(this.line(e, true));
      return;
    }
    const list = h('div', { class: 'dl-chron-list' });
    // Newest group first; within a group, oldest line first (it reads as a story).
    const groups: { key: string; title: string; cls: string; items: ChronEntry[] }[] = [];
    for (const e of this.entries) {
      const key = `${e.phase}:${e.round}`;
      let g = groups[groups.length - 1];
      if (!g || g.key !== key) {
        g = { key, title: e.phase === 'start' ? 'Earlier' : `Round ${e.round} · ${e.phase === 'world' ? 'the castle' : 'your turn'}`, cls: e.phase === 'world' ? 'world' : e.phase === 'start' ? 'start' : 'player', items: [] };
        groups.push(g);
      }
      g.items.push(e);
    }
    for (const g of groups.reverse()) {
      list.append(h('div', { class: `dl-chron-group ${g.cls}` }, g.title));
      for (const e of g.items) list.append(this.line(e, false));
    }
    el.append(list);
  }

  private line(e: ChronEntry, folded: boolean): HTMLElement {
    const tone = /log-enemy/.test(e.cls) ? 'foe' : /log-ally/.test(e.cls) ? 'friend' : /log-heard/.test(e.cls) ? 'heard' : '';
    return h('div', { class: `dl-chron-line ${tone} ${folded ? 'folded' : ''}` }, h('span', { class: `dl-chron-ic k-${e.kind}` }, icon(KIND_ICON[e.kind], 13)), h('span', { class: 'dl-chron-t' }, e.text));
  }
}
