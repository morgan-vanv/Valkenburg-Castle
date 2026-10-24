// The expedition overlay: unit card, roster, action bar, pickers, attack
// preview, dice tray, alarm meter, turn and phase, event log, settings.
// Owns DOM only; asks the App to send commands and the Diorama to highlight.

import type { ActionOption, AttackPreview, Reach, Visibility } from '../engine/api';
import { dirBetween, edgeSquares, label, sameSquare, squareKey } from '../engine/geometry';
import type { AlarmTier, Command, Coord, DoorMethod, GameEvent, GameState, LevelId, LootItem, Modifier, RollResult, SpellId, Unit } from '../engine/types';
import { sfx } from '../audio/sfx';
import type { Diorama } from '../render/scene';
import { clear, gold, h, pips } from './dom';
import { ALARM_BANDS, maxFocus } from './rules';
import { CLASS_GLYPH, CLASS_NAME, FRONTAGE_NAME, METHOD_NAME, METHOD_NOTE, SPELL_NAME, SPELL_NOTE, isSquad, unitStrength } from './names';
import type { Settings } from './settings';
import type { Engine } from '../engine/api';

export interface HudHost {
  engine: Engine;
  send(cmd: Command): Promise<boolean>;
  isBusy(): boolean;
  settings: Settings;
  saveSettings(): void;
  abandon(): void;
}

type Mode =
  | { kind: 'idle' }
  | { kind: 'attack'; attack: 'melee' | 'missile'; targetIds: string[] }
  | { kind: 'square'; title: string; squares: Coord[]; pick: (c: Coord) => Command };

const HERO_COLOR: Record<string, string> = { hobart: '#d9a93a', rogier: '#3561c9', thorvold: '#b0702f', pim: '#3b9a4a', aldous: '#8a4cc9' };
const DIR_NAME = { n: 'north', s: 'south', e: 'east', w: 'west' } as const;

export class Hud {
  readonly root: HTMLElement;
  private state: GameState | null = null;
  private vis: Visibility | null = null;
  selectedId: string | null = null;
  private reach: Reach[] = [];
  private actions: ActionOption[] = [];
  private mode: Mode = { kind: 'idle' };
  private previewing: { targetId: string; kind: 'melee' | 'missile'; focus: number } | null = null;
  private mouse = { x: 0, y: 0 };

  private el = {
    turn: h('div', { class: 'turn-box' }),
    alarm: h('div', { class: 'alarm' }),
    levels: h('div', { class: 'level-buttons' }),
    tools: h('div', { class: 'tools' }),
    card: h('aside', { class: 'unit-card panel' }),
    log: h('div', { class: 'log panel' }),
    roster: h('div', { class: 'roster' }),
    bar: h('div', { class: 'action-bar' }),
    endTurn: h('button', { class: 'btn btn-end' }),
    preview: h('aside', { class: 'preview panel hidden' }),
    picker: h('div', { class: 'picker panel hidden' }),
    tip: h('div', { class: 'tip hidden' }),
    banner: h('div', { class: 'phase-banner' }),
    dice: h('div', { class: 'dice-tray hidden' }),
    vignette: h('div', { class: 'vignette' }),
    toast: h('div', { class: 'toast hidden' }),
    hint: h('div', { class: 'mode-hint hidden' }),
    settings: h('div', { class: 'settings panel hidden' }),
    empty: h('div', { class: 'level-empty hidden' }),
    enemy: h('aside', { class: 'enemy-card panel hidden' }),
  };
  private logLines: string[] = [];
  private logSeed = '';
  private lastTier: AlarmTier | null = null;

  constructor(
    private readonly host: HudHost,
    private readonly dio: Diorama,
  ) {
    const e = this.el;
    this.root = h(
      'div',
      { class: 'hud' },
      e.vignette,
      e.empty,
      h('header', { class: 'topbar' }, e.turn, e.alarm, h('div', { class: 'top-right' }, e.levels, e.tools)),
      e.card,
      e.enemy,
      e.log,
      h('footer', { class: 'bottombar' }, e.roster, e.bar),
      e.endTurn,
      e.preview,
      e.picker,
      e.dice,
      e.banner,
      e.hint,
      e.toast,
      e.settings,
      e.tip,
    );
    e.endTurn.addEventListener('click', () => this.endTurn());
    e.endTurn.append(h('span', null, 'End turn'), h('kbd', null, 'Enter'));
    this.buildTools();
    addEventListener('keydown', (ev) => this.onKey(ev));
    addEventListener('pointermove', (ev) => {
      this.mouse.x = ev.clientX;
      this.mouse.y = ev.clientY;
      this.placeTip();
    });
  }

  // ------------------------------------------------------------ state

  setState(s: GameState, vis: Visibility): void {
    this.state = s;
    this.vis = vis;
    const exp = s.expedition;
    if (!exp) return;
    const mine = this.players();
    if (!this.selectedId || !mine.some((u) => u.id === this.selectedId)) {
      const next = mine.find((u) => u.actionsLeft > 0) ?? mine[0];
      this.select(next?.id ?? null, true);
    } else this.refreshSelection();
    this.renderTop();
    this.renderRoster();
    // Seed the log from the save once per expedition; afterwards events feed it.
    if (this.logSeed !== `${s.seed}:${s.week}`) {
      this.logSeed = `${s.seed}:${s.week}`;
      this.renderLogFrom(exp.log);
    }
    if (this.previewing) this.renderPreview();
  }

  private players(): Unit[] {
    return this.state?.expedition?.units.filter((u) => u.side === 'player' && !u.exited) ?? [];
  }

  private unit(id: string | null): Unit | undefined {
    if (!id) return undefined;
    return this.state?.expedition?.units.find((u) => u.id === id);
  }

  select(id: string | null, follow = true): void {
    const changed = id !== this.selectedId;
    this.selectedId = id;
    this.mode = { kind: 'idle' };
    this.closePicker();
    if (changed) this.closePreview();
    this.dio.setSelected(id);
    this.dio.setFollow(null);
    const u = this.unit(id);
    if (u && follow) {
      this.dio.lookAt(u.pos);
    }
    this.refreshSelection();
    this.renderRoster();
  }

  private refreshSelection(): void {
    const s = this.state;
    const u = this.unit(this.selectedId);
    if (!s || !u) {
      this.reach = [];
      this.actions = [];
    } else {
      this.reach = this.host.engine.reachable(s, u.id);
      this.actions = this.host.engine.actions(s, u.id);
    }
    this.renderCard();
    this.renderBar();
    this.renderHighlights();
    this.renderEndTurn();
  }

  private renderHighlights(): void {
    const m = this.mode;
    if (m.kind === 'square') {
      this.dio.setReachable([]);
      this.dio.setTargets(m.squares);
      this.showHint(m.title);
    } else if (m.kind === 'attack') {
      this.dio.setReachable([]);
      this.dio.setTargets(this.targetSquares(m.targetIds));
      this.showHint(m.attack === 'melee' ? 'Choose a target to strike' : 'Choose a target to shoot');
    } else {
      this.dio.setReachable(this.reach.map((r) => r.to));
      const ids = this.actions.flatMap((a) => (a.kind === 'melee' || a.kind === 'missile' ? a.targetIds : []));
      this.dio.setTargets(this.targetSquares(ids));
      this.showHint(null);
    }
    this.dio.setPath([]);
  }

  private targetSquares(ids: string[]): Coord[] {
    const out: Coord[] = [];
    for (const id of ids) {
      const t = this.unit(id);
      if (t && !out.some((c) => sameSquare(c, t.pos))) out.push(t.pos);
    }
    return out;
  }

  // ------------------------------------------------------------ top bar

  private renderTop(): void {
    const s = this.state!;
    const exp = s.expedition!;
    clear(this.el.turn);
    this.el.turn.append(h('span', { class: 'kicker' }, `Week ${s.week} · ${exp.phase === 'player' ? 'your move' : 'castle phase'}`), h('span', { class: 'turn-num' }, 'Turn ', h('b', { class: 'num' }, String(exp.turn))));
    this.renderAlarm(exp.alarm);
    this.renderLevels();
  }

  renderAlarm(value: number, pulse = false): void {
    const tier = this.host.engine.alarmTier(value);
    const a = this.el.alarm;
    clear(a);
    const bands = h('div', { class: 'alarm-bands' });
    ALARM_BANDS.forEach((b, i) => {
      const next = ALARM_BANDS[i + 1]?.min ?? 100;
      bands.appendChild(h('span', { class: `band band-${i} ${b.tier === tier ? 'current' : ''}`, style: `flex:${next - b.min}` }, b.tier));
    });
    const fill = h('div', { class: 'alarm-fill', style: `width:${Math.min(100, value)}%` });
    a.append(
      h('div', { class: 'alarm-head' }, h('span', { class: 'kicker' }, 'Alarm'), h('span', { class: `alarm-tier tier-${tier.toLowerCase()}` }, tier), h('span', { class: 'alarm-value num' }, String(value))),
      h('div', { class: 'alarm-track' }, fill, bands),
    );
    a.dataset.tier = tier;
    if (pulse) {
      a.classList.remove('pulse');
      void a.offsetWidth;
      a.classList.add('pulse');
    }
    this.lastTier = tier;
  }

  private renderLevels(): void {
    const ls = this.el.levels;
    clear(ls);
    const s = this.state;
    const levels = this.host.engine.map().levels.map((l) => l.id);
    const occupied = new Set(this.players().map((u) => u.pos.level));
    const shown = this.dio.shownLevel;
    const seen = !!this.vis && [...this.vis.explored].some((k) => k.startsWith(`${shown}:`));
    clear(this.el.empty);
    this.el.empty.append(h('span', { class: 'banner-main' }, `Level ${shown}`), h('span', { class: 'banner-sub' }, 'unexplored · nothing seen down here yet'));
    this.el.empty.classList.toggle('hidden', seen || !s?.expedition);
    for (const id of levels) {
      const b = h('button', { class: `btn btn-sq level-btn ${id === this.dio.shownLevel ? 'on' : ''} ${occupied.has(id) ? 'occupied' : ''}`, title: `Show level ${id}` }, String(id));
      b.addEventListener('click', () => {
        this.dio.showLevel(id as LevelId);
        this.renderLevels();
        this.renderHighlights();
      });
      ls.appendChild(b);
    }
    void s;
  }

  levelChanged(): void {
    this.renderLevels();
    if (this.state) this.renderHighlights();
  }

  private buildTools(): void {
    const t = this.el.tools;
    const mute = h('button', { class: 'btn btn-sq', title: 'Mute (M)' });
    const setMute = () => (mute.textContent = sfx.muted ? '♪̸' : '♪');
    setMute();
    mute.addEventListener('click', () => {
      sfx.setMuted(!sfx.muted);
      setMute();
    });
    this.muteBtn = { el: mute, refresh: setMute };
    const gear = h('button', { class: 'btn btn-sq', title: 'Settings' }, '⚙');
    gear.addEventListener('click', () => this.toggleSettings());
    t.append(mute, gear);
  }
  private muteBtn!: { el: HTMLElement; refresh: () => void };

  private toggleSettings(): void {
    const p = this.el.settings;
    if (!p.classList.contains('hidden')) {
      p.classList.add('hidden');
      return;
    }
    clear(p);
    const st = this.host.settings;
    const speed = h('select', null, [0.5, 1, 1.5, 2, 3].map((v) => h('option', { value: v, selected: st.speed === v }, `${v}×`)));
    speed.addEventListener('change', () => {
      st.speed = Number(speed.value);
      this.dio.clock.speed = st.speed;
      this.host.saveSettings();
    });
    const toggle = (name: string, key: 'reduceShake' | 'reduceFlashes') => {
      const cb = h('input', { type: 'checkbox', checked: st[key] });
      cb.addEventListener('change', () => {
        st[key] = cb.checked;
        this.dio.feel = { reduceShake: st.reduceShake, reduceFlashes: st.reduceFlashes };
        this.host.saveSettings();
      });
      return h('label', { class: 'tick' }, cb, name);
    };
    p.append(
      h('h2', null, 'Settings'),
      h('label', { class: 'row' }, 'Animation speed ', speed),
      toggle('Reduce screen shake', 'reduceShake'),
      toggle('Reduce flashes', 'reduceFlashes'),
      h('p', { class: 'fine' }, 'Camera: right-drag or Q/E to orbit, middle-drag or WASD to pan, wheel to zoom. Tab cycles units. Hold Space to hurry the castle.'),
      h('div', { class: 'row' }, h('button', { class: 'btn btn-small btn-danger', onclick: () => this.host.abandon() }, 'Abandon campaign…'), h('button', { class: 'btn btn-small', onclick: () => p.classList.add('hidden') }, 'Close')),
    );
    p.classList.remove('hidden');
  }

  // ------------------------------------------------------------ unit card

  private renderCard(): void {
    const c = this.el.card;
    clear(c);
    const u = this.unit(this.selectedId);
    if (!u) {
      c.appendChild(h('p', { class: 'fine' }, 'No one left inside.'));
      return;
    }
    const carry = this.host.engine.carry(u);
    const allowance = this.state ? this.host.engine.moveAllowance(this.state, u) : 0;
    const color = u.heroId ? HERO_COLOR[u.heroId] : undefined;
    const status: string[] = [];
    if (u.overwatch) status.push('Overwatch');
    if (u.shieldwallFacing) status.push(`Shieldwall → ${label(u.shieldwallFacing)}`);
    if (u.panicked || u.panicTurns > 0) status.push('Panicked');
    if (u.webbed) status.push('Webbed');
    if (u.asleepTurns > 0) status.push('Asleep');
    if (u.climbingTurns > 0) status.push('Climbing');
    if (carry.immobile) status.push('Can’t move: overloaded');
    else if (carry.overloaded) status.push('Overloaded −1 move');
    const strength = isSquad(u)
      ? h('div', { class: 'strength' }, h('span', { class: 'big-num num' }, String(u.men)), h('span', { class: 'dim' }, ' men'), menDots(u.men))
      : h('div', { class: 'strength' }, h('span', { class: 'big-num num' }, `${u.maxWounds - u.wounds}`), h('span', { class: 'dim' }, `/${u.maxWounds} wounds left`), pips(u.maxWounds - u.wounds, u.maxWounds, 'hp'));
    const pct = carry.limit ? Math.min(100, (carry.weight / carry.limit) * 100) : 0;
    appendAll(c,
      h(
        'div',
        { class: 'card-head', style: color ? `--banner:${color}` : '' },
        h('span', { class: 'counter-badge big' }, CLASS_GLYPH[u.cls] ?? '?'),
        h('div', null, h('h2', { class: 'unit-name' }, u.name), h('p', { class: 'unit-cls' }, `${CLASS_NAME[u.cls]} · ${u.armor === 'normal' ? 'normal armour' : u.armor === 'heavy' ? 'heavy armour' : 'unarmored'}`)),
        h('span', { class: 'coord num' }, `L${u.pos.level} ${label(u.pos)}`),
      ),
      strength,
      h(
        'dl',
        { class: 'card-stats' },
        h('dt', null, 'Actions'),
        h('dd', null, pips(u.actionsLeft, 2, 'acts')),
        h('dt', null, 'Focus'),
        h('dd', null, pips(u.focus, maxFocus(u), 'focus')),
        h('dt', null, 'Move'),
        h('dd', { class: 'num' }, String(allowance)),
        u.cls === 'magicUser' ? [h('dt', null, 'Spell pts'), h('dd', { class: 'num' }, String(u.spellPoints))] : null,
        u.cls === 'dwarf' ? [h('dt', null, 'Charges'), h('dd', { class: 'num' }, String(u.charges))] : null,
      ),
      status.length ? h('p', { class: 'status' }, status.join(' · ')) : null,
      h('div', { class: 'carry' }, h('div', { class: 'carry-head' }, h('span', null, 'Carrying'), h('span', { class: `num ${carry.overloaded ? 'neg' : ''}` }, `${carry.weight}/${carry.limit}`), h('span', { class: 'num gold-text' }, `${gold(carry.value)} g`)), h('div', { class: `carry-bar ${carry.overloaded ? 'over' : ''}` }, h('i', { style: `width:${pct}%` })), u.loot.length ? h('ul', { class: 'loot' }, u.loot.map((it) => h('li', null, h('span', null, it.name), h('span', { class: 'num dim' }, `${it.weight}c · ${gold(it.value)}g`)))) : null),
    );
  }

  // ------------------------------------------------------------ roster

  private renderRoster(): void {
    const r = this.el.roster;
    clear(r);
    const exp = this.state?.expedition;
    if (!exp) return;
    for (const u of exp.units.filter((x) => x.side === 'player')) {
      const color = u.heroId ? HERO_COLOR[u.heroId] : 'var(--ochre)';
      const b = h(
        'button',
        { class: `roster-chip ${u.id === this.selectedId ? 'on' : ''} ${u.exited ? 'out' : ''} ${u.actionsLeft === 0 && !u.exited ? 'spent' : ''}`, style: `--banner:${color}`, title: `${u.name} · ${unitStrength(u)}` },
        h('span', { class: 'counter-badge' }, CLASS_GLYPH[u.cls] ?? '?'),
        h('span', { class: 'chip-body' }, h('span', { class: 'chip-name' }, u.name), h('span', { class: 'chip-sub num' }, u.exited ? 'out' : isSquad(u) ? `${u.men} men` : `${u.maxWounds - u.wounds}/${u.maxWounds}`)),
        u.exited ? null : pips(u.actionsLeft, 2, 'acts'),
      );
      if (!u.exited) b.addEventListener('click', () => this.select(u.id));
      else b.setAttribute('disabled', '');
      r.appendChild(b);
    }
  }

  // ------------------------------------------------------------ actions

  private renderBar(): void {
    const bar = this.el.bar;
    clear(bar);
    const u = this.unit(this.selectedId);
    if (!u) return;
    const items = this.actionItems(u);
    if (!items.length) {
      bar.appendChild(h('span', { class: 'bar-empty' }, u.actionsLeft > 0 ? 'Nothing to do here.' : `${u.name} is spent this turn.`));
      return;
    }
    items.forEach((it, i) => {
      const b = h('button', { class: `act ${it.danger ? 'act-danger' : ''}`, title: it.note ?? '' }, h('kbd', null, String(i + 1)), h('span', { class: 'act-name' }, it.name), it.sub ? h('span', { class: 'act-sub' }, it.sub) : null);
      b.addEventListener('click', () => {
        sfx.play('click');
        it.run();
      });
      bar.appendChild(b);
    });
  }

  private actionItems(u: Unit): { name: string; sub?: string; note?: string; danger?: boolean; run: () => void }[] {
    const out: { name: string; sub?: string; note?: string; danger?: boolean; run: () => void }[] = [];
    const s = this.state!;
    const exp = s.expedition!;
    for (const a of this.actions) {
      switch (a.kind) {
        case 'move':
          break;
        case 'melee':
          out.push({ name: 'Melee', sub: `${a.targetIds.length} target${a.targetIds.length > 1 ? 's' : ''}`, danger: true, note: 'Ends the turn', run: () => this.beginAttack('melee', a.targetIds) });
          break;
        case 'missile':
          out.push({ name: 'Shoot', sub: `${a.targetIds.length} in range`, danger: true, note: 'Ends the turn', run: () => this.beginAttack('missile', a.targetIds) });
          break;
        case 'door': {
          const where = this.edgeWhere(u.pos, a.edge);
          const isWall = a.methods.length === 1 && a.methods[0] === 'blast' && !a.locked;
          out.push({ name: isWall ? 'Blast wall' : a.secured ? 'Secured door' : 'Locked door', sub: where, run: () => this.doorPicker(u, a.edge, a.methods, isWall, a.secured) });
          break;
        }
        case 'chest':
          out.push({ name: 'Chest', sub: 'locked', run: () => this.chestPicker(u, a.chestId, a.methods) });
          break;
        case 'search':
          out.push({ name: 'Search', sub: `${a.progress}/${a.needed}`, note: 'Search the room (1 action)', run: () => void this.host.send({ type: 'search', unitId: u.id }) });
          break;
        case 'pickUp': {
          const pile = exp.floorLoot[squareKey(u.pos)] ?? [];
          out.push({ name: 'Pick up', sub: `${a.itemIds.length}`, run: () => this.itemPicker('Pick up', pile.filter((i) => a.itemIds.includes(i.id)), (it) => ({ type: 'pickUp', unitId: u.id, itemId: it.id })) });
          break;
        }
        case 'drop':
          out.push({ name: 'Drop', run: () => this.itemPicker('Drop', u.loot.filter((i) => a.itemIds.includes(i.id)), (it) => ({ type: 'drop', unitId: u.id, itemId: it.id })) });
          break;
        case 'give':
          out.push({ name: 'Hand over', run: () => this.givePicker(u, a.toIds) });
          break;
        case 'giveFocus':
          out.push({ name: 'Inspire', sub: 'give Focus', run: () => this.unitPicker('Give 1 Focus to', a.toIds, (id) => ({ type: 'giveFocus', unitId: u.id, toId: id })) });
          break;
        case 'overwatch':
          out.push({ name: 'Overwatch', note: 'Shoot the first enemy that shows itself. Ends the turn.', run: () => void this.host.send({ type: 'overwatch', unitId: u.id }) });
          break;
        case 'shieldwall':
          out.push({ name: 'Shieldwall', note: 'Face a square: −20 to attacks from it. Ends the turn.', run: () => this.squareMode('Face the shieldwall toward…', a.facings, (c) => ({ type: 'shieldwall', unitId: u.id, facing: c })) });
          break;
        case 'cast':
          break;
        case 'jump':
          out.push({ name: 'Jump', sub: 'into the Pit', danger: true, note: 'Each man rolls: 1–4 is a wound', run: () => this.squareMode('Jump to…', a.targets, (c) => ({ type: 'jump', unitId: u.id, to: c })) });
          break;
        case 'climb':
          out.push({ name: 'Climb', sub: 'with gear', run: () => this.squareMode('Climb to…', a.targets, (c) => ({ type: 'climb', unitId: u.id, to: c })) });
          break;
        case 'exit':
          out.push({ name: 'Exit', sub: 'extract', note: 'Leave the castle with what you carry. No coming back this week.', run: () => void this.host.send({ type: 'exit', unitId: u.id }) });
          break;
      }
    }
    const spells = this.actions.filter((a): a is Extract<ActionOption, { kind: 'cast' }> => a.kind === 'cast');
    if (spells.length) out.push({ name: 'Spells', sub: `${u.spellPoints} pts`, run: () => this.spellPicker(u, spells) });
    return out;
  }

  private edgeWhere(from: Coord, edge: string): string {
    const [a, b] = edgeSquares(edge);
    const other = sameSquare(a, from) ? b : a;
    const d = dirBetween(from, other);
    return d ? `${DIR_NAME[d]} · ${label(other)}` : label(other);
  }

  private beginAttack(kind: 'melee' | 'missile', ids: string[]): void {
    if (ids.length === 1) {
      this.openPreview(ids[0]!, kind);
      return;
    }
    this.mode = { kind: 'attack', attack: kind, targetIds: ids };
    this.closePicker();
    this.renderHighlights();
  }

  private squareMode(title: string, squares: Coord[], pick: (c: Coord) => Command): void {
    this.closePicker();
    this.mode = { kind: 'square', title, squares, pick };
    if (squares[0] && squares[0].level !== this.dio.shownLevel) this.dio.showLevel(squares[0].level);
    this.renderHighlights();
  }

  cancelMode(): boolean {
    if (this.previewing) {
      this.closePreview();
      return true;
    }
    if (!this.el.picker.classList.contains('hidden')) {
      this.closePicker();
      return true;
    }
    if (this.mode.kind !== 'idle') {
      this.mode = { kind: 'idle' };
      this.renderHighlights();
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------ pickers

  private openPicker(title: string, rows: { name: string; note?: string; disabled?: boolean; run: () => void }[]): void {
    const p = this.el.picker;
    clear(p);
    p.appendChild(h('h3', null, title));
    rows.forEach((r, i) => {
      const b = h('button', { class: 'pick-row', disabled: r.disabled }, h('kbd', null, String(i + 1)), h('span', { class: 'pick-name' }, r.name), r.note ? h('span', { class: 'pick-note' }, r.note) : null);
      b.addEventListener('click', () => {
        sfx.play('click');
        this.closePicker();
        r.run();
      });
      p.appendChild(b);
    });
    p.appendChild(h('button', { class: 'pick-cancel', onclick: () => this.closePicker() }, 'Cancel ', h('kbd', null, 'Esc')));
    p.classList.remove('hidden');
  }

  private closePicker(): void {
    this.el.picker.classList.add('hidden');
  }

  private doorPicker(u: Unit, edge: string, methods: DoorMethod[], isWall: boolean, secured: boolean): void {
    const exp = this.state!.expedition!;
    const door = exp.doors[edge];
    const helpers = exp.units.filter((x) => x.side === 'player' && !x.exited && x.id !== u.id && sameSquare(x.pos, u.pos)).map((x) => x.id);
    const rows = methods.map((m) => ({
      name: METHOD_NAME[m],
      note: m === 'chop' && door ? `${METHOD_NOTE[m]} (${door.chop}/10)` : m === 'smash' && helpers.length ? `${METHOD_NOTE[m]} Helpers in square join in.` : METHOD_NOTE[m],
      run: () => void this.host.send({ type: 'door', unitId: u.id, edge, method: m, helpers: m === 'smash' ? helpers : undefined }),
    }));
    this.openPicker(`${isWall ? 'Wall' : 'Door'} ${this.edgeWhere(u.pos, edge)}${secured ? ' · held from the far side' : ''}`, rows);
  }

  private chestPicker(u: Unit, chestId: string, methods: ('pick' | 'smash' | 'chop' | 'unlock')[]): void {
    this.openPicker('Locked chest', methods.map((m) => ({ name: METHOD_NAME[m], note: METHOD_NOTE[m], run: () => void this.host.send({ type: 'chest', unitId: u.id, chestId, method: m }) })));
  }

  private itemPicker(title: string, items: LootItem[], cmd: (it: LootItem) => Command): void {
    this.openPicker(
      title,
      items.map((it) => ({ name: it.name, note: `${it.weight} coins weight · ${gold(it.value)} g`, run: () => void this.host.send(cmd(it)) })),
    );
  }

  private unitPicker(title: string, ids: string[], cmd: (id: string) => Command): void {
    this.openPicker(
      title,
      ids.map((id) => {
        const t = this.unit(id);
        return { name: t?.name ?? id, note: t ? `${unitStrength(t)} · ${label(t.pos)}` : '', run: () => void this.host.send(cmd(id)) };
      }),
    );
  }

  private givePicker(u: Unit, toIds: string[]): void {
    this.openPicker(
      'Hand loot to',
      toIds.map((to) => {
        const t = this.unit(to);
        const c = t ? this.host.engine.carry(t) : null;
        return {
          name: t?.name ?? to,
          note: c ? `carrying ${c.weight}/${c.limit}` : '',
          run: () => this.itemPicker(`Hand to ${t?.name ?? ''}`, u.loot, (it) => ({ type: 'give', unitId: u.id, toId: to, itemId: it.id })),
        };
      }),
    );
  }

  private spellPicker(u: Unit, spells: Extract<ActionOption, { kind: 'cast' }>[]): void {
    const rows = spells.map((sp) => ({
      name: `${SPELL_NAME[sp.spell]} · ${sp.cost}`,
      note: SPELL_NOTE[sp.spell],
      run: () => this.castSpell(u, sp.spell, sp),
    }));
    this.openPicker(`Spells · ${u.spellPoints} points`, rows);
  }

  private castSpell(u: Unit, spell: SpellId, sp: Extract<ActionOption, { kind: 'cast' }>): void {
    const base = { type: 'cast' as const, unitId: u.id, spell };
    if (sp.edges.length) {
      if (sp.edges.length === 1) void this.host.send({ ...base, edge: sp.edges[0] });
      else this.openPicker('Unlock which door?', sp.edges.map((e) => ({ name: this.edgeWhere(u.pos, e), run: () => void this.host.send({ ...base, edge: e }) })));
      return;
    }
    if (sp.targetIds.length) {
      if (sp.targetIds.length === 1) void this.host.send({ ...base, targetId: sp.targetIds[0] });
      else this.unitPicker(`${SPELL_NAME[spell]} on`, sp.targetIds, (id) => ({ ...base, targetId: id }));
      return;
    }
    if (sp.targets.length) {
      this.squareMode(`${SPELL_NAME[spell]}: choose a square`, sp.targets, (c) => ({ ...base, target: c }));
      return;
    }
    void this.host.send(base);
  }

  // ------------------------------------------------------------ attack preview

  openPreview(targetId: string, kind: 'melee' | 'missile'): void {
    const u = this.unit(this.selectedId);
    if (!u) return;
    this.mode = { kind: 'idle' };
    this.closePicker();
    this.previewing = { targetId, kind, focus: 0 };
    this.renderHighlights();
    const t = this.unit(targetId);
    if (t) this.dio.setTargets([t.pos]);
    this.renderPreview();
  }

  private closePreview(): void {
    this.previewing = null;
    this.el.preview.classList.add('hidden');
  }

  private renderPreview(): void {
    const pv = this.previewing;
    const s = this.state;
    const u = this.unit(this.selectedId);
    if (!pv || !s || !u) return this.closePreview();
    const t = this.unit(pv.targetId);
    if (!t) return this.closePreview();
    const p: AttackPreview = this.host.engine.previewAttack(s, u.id, t.id, pv.kind, pv.focus);
    pv.focus = Math.max(0, Math.min(pv.focus, p.maxFocus));
    const el = this.el.preview;
    clear(el);
    const sum = p.modifiers.reduce((n, m) => n + m.value, 0);
    const base = p.chance - sum;
    const clamped = p.chance === 10 || p.chance === 90;
    const slots = h('div', { class: 'slot-row' });
    for (let i = 0; i < p.slots; i++) slots.appendChild(h('span', { class: `slot ${i < pv.focus ? 'locked' : ''}` }, i < pv.focus ? 'F' : `${p.chance}`));
    const focusRow = h(
      'div',
      { class: 'focus-row' },
      h('span', { class: 'kicker' }, 'Focus'),
      h('button', { class: 'btn btn-sq', disabled: pv.focus <= 0, onclick: () => this.bumpFocus(-1), 'aria-label': 'Less Focus' }, '−'),
      h('span', { class: 'num big-num' }, `${pv.focus}`),
      h('span', { class: 'dim num' }, `/ ${p.maxFocus}`),
      h('button', { class: 'btn btn-sq', disabled: pv.focus >= p.maxFocus, onclick: () => this.bumpFocus(1), 'aria-label': 'More Focus' }, '+'),
      h('span', { class: 'dim small' }, `holding ${u.focus}`),
    );
    appendAll(el,
      h('p', { class: 'kicker' }, pv.kind === 'melee' ? 'Melee attack' : 'Missile attack'),
      h('h2', { class: 'pv-title' }, u.name, h('span', { class: 'arrow' }, ' → '), h('span', { class: 'enemy-name' }, t.name)),
      h('p', { class: 'pv-target dim' }, `${unitStrength(t)} · ${label(t.pos)}`),
      h('div', { class: 'pv-main' }, h('div', { class: 'pv-chance' }, h('span', { class: 'num huge' }, `${p.chance}`), h('span', { class: 'pct' }, '%'), h('span', { class: 'kicker' }, 'per slot')), h('div', { class: 'pv-front' }, h('span', { class: `frontage f-${p.frontage}` }, FRONTAGE_NAME[p.frontage]), h('span', { class: 'kicker' }, 'frontage'), h('span', { class: 'num' }, `${p.slots} slot${p.slots === 1 ? '' : 's'}`))),
      slots,
      h(
        'ul',
        { class: 'mods' },
        h('li', null, h('span', null, 'Base'), h('span', { class: 'num' }, `${base}%`)),
        p.modifiers.map((m: Modifier) => h('li', { class: m.value > 0 ? 'up' : m.value < 0 ? 'down' : '' }, h('span', null, m.label), h('span', { class: 'num' }, m.value ? `${m.value > 0 ? '+' : '−'}${Math.abs(m.value)}` : '×2'))),
        clamped ? h('li', { class: 'dim' }, h('span', null, 'Clamped to 10–90%'), h('span', null, '')) : null,
      ),
      focusRow,
      h('div', { class: 'pv-expect' }, h('span', { class: 'kicker' }, 'Expected wounds'), h('span', { class: 'num big-num' }, p.expectedWounds.toFixed(2)), p.slots >= 2 ? h('span', { class: 'dim small' }, 'Perfect: +1 wound, morale check') : null),
      p.ok ? null : h('p', { class: 'problems' }, p.reason ?? 'Cannot attack.'),
      h(
        'div',
        { class: 'pv-actions' },
        h('button', { class: 'btn', onclick: () => this.closePreview() }, 'Cancel ', h('kbd', null, 'Esc')),
        h('button', { class: 'btn btn-primary btn-danger', disabled: !p.ok, onclick: () => this.confirmAttack() }, 'Confirm ', h('kbd', null, 'Enter')),
      ),
    );
    el.classList.remove('hidden');
  }

  private bumpFocus(d: number): void {
    if (!this.previewing) return;
    this.previewing.focus = Math.max(0, this.previewing.focus + d);
    sfx.play('click');
    this.renderPreview();
  }

  private confirmAttack(): void {
    const pv = this.previewing;
    const u = this.unit(this.selectedId);
    if (!pv || !u) return;
    this.closePreview();
    void this.host.send({ type: pv.kind, unitId: u.id, targetId: pv.targetId, focus: pv.focus });
  }

  // ------------------------------------------------------------ board input

  onHover(c: Coord | null, unitId: string | null): void {
    if (!this.state?.expedition) return;
    const tip = this.el.tip;
    if (!c) {
      tip.classList.add('hidden');
      this.dio.setHover(null);
      this.dio.setPath([]);
      this.showEnemyCard(null);
      return;
    }
    const k = squareKey(c);
    const vis = this.vis;
    const known = !!vis && (vis.explored.has(k) || vis.visible.has(k));
    const lines: (string | HTMLElement)[] = [h('b', { class: 'num' }, `L${c.level} ${label(c)}`)];
    const target = unitId ? this.unit(unitId) : undefined;
    let danger = false;
    this.dio.setPath([]);
    if (this.host.isBusy()) {
      // Only the label while the castle moves.
    } else if (target && target.side === 'castle') {
      const kind = this.attackKindFor(target.id);
      if (kind) {
        danger = true;
        const p = this.host.engine.previewAttack(this.state, this.selectedId!, target.id, kind, 0);
        lines.push(h('span', { class: 'tip-danger' }, `${kind === 'melee' ? 'Strike' : 'Shoot'} ${target.name}: ${p.chance}% × ${p.slots}`));
      } else lines.push(h('span', null, target.name));
    } else if (this.mode.kind === 'square') {
      if (this.mode.squares.some((s) => sameSquare(s, c))) lines.push(h('span', { class: 'tip-go' }, 'Click to choose'));
    } else {
      const r = this.reach.find((x) => sameSquare(x.to, c));
      if (r) {
        this.dio.setPath(r.path);
        lines.push(h('span', { class: 'tip-go' }, `Move · ${r.cost} MP`));
      } else if (!known) lines.push(h('span', { class: 'dim' }, 'unexplored'));
    }
    const contact = vis?.contacts.find((x) => sameSquare(x.pos, c));
    if (contact) lines.push(h('span', { class: 'tip-danger' }, 'Contact: something moves here'));
    clear(tip);
    tip.append(...lines.flatMap((l, i) => (i ? [h('br'), l] : [l])));
    tip.classList.remove('hidden');
    this.placeTip();
    this.dio.setHover(c, danger);
    this.showEnemyCard(target && target.side === 'castle' ? target : null);
  }

  private showEnemyCard(t: Unit | null): void {
    const el = this.el.enemy;
    if (!t) {
      el.classList.add('hidden');
      return;
    }
    clear(el);
    appendAll(el,
      h('p', { class: 'kicker' }, t.dormant ? 'Dormant' : 'Awake'),
      h('h2', { class: 'enemy-name' }, t.name),
      h('p', { class: 'unit-cls' }, CLASS_NAME[t.cls]),
      isSquad(t) ? h('div', { class: 'strength' }, h('span', { class: 'big-num num' }, String(t.men)), h('span', { class: 'dim' }, ' orcs'), menDots(t.men, 'enemy')) : h('div', { class: 'strength' }, pips(t.maxWounds - t.wounds, t.maxWounds, 'hp enemy'), h('span', { class: 'dim num' }, ` ${t.maxWounds - t.wounds}/${t.maxWounds}`)),
      t.panicked ? h('p', { class: 'status' }, 'Panicked') : null,
    );
    el.classList.remove('hidden');
  }

  private placeTip(): void {
    const t = this.el.tip;
    t.style.transform = `translate(${this.mouse.x + 16}px, ${this.mouse.y + 18}px)`;
  }

  private attackKindFor(targetId: string): 'melee' | 'missile' | null {
    for (const a of this.actions) if (a.kind === 'melee' && a.targetIds.includes(targetId)) return 'melee';
    for (const a of this.actions) if (a.kind === 'missile' && a.targetIds.includes(targetId)) return 'missile';
    return null;
  }

  onClick(c: Coord | null, unitId: string | null, ev: PointerEvent): void {
    if (this.host.isBusy() || !this.state?.expedition) return;
    if (ev.button === 2) {
      this.cancelMode();
      return;
    }
    const clicked = unitId ? this.unit(unitId) : undefined;
    const m = this.mode;
    if (m.kind === 'square') {
      const hit = c && m.squares.find((s) => sameSquare(s, c));
      if (hit) {
        const cmd = m.pick(hit);
        this.mode = { kind: 'idle' };
        this.renderHighlights();
        void this.host.send(cmd);
      } else {
        this.mode = { kind: 'idle' };
        this.renderHighlights();
      }
      return;
    }
    if (m.kind === 'attack') {
      const id = clicked && m.targetIds.includes(clicked.id) ? clicked.id : m.targetIds.find((tid) => c && sameSquare(this.unit(tid)!.pos, c));
      if (id) this.openPreview(id, m.attack);
      else {
        this.mode = { kind: 'idle' };
        this.renderHighlights();
      }
      return;
    }
    // Idle: enemies, friends, then squares.
    let enemy = clicked && clicked.side === 'castle' ? clicked : undefined;
    if (!enemy && c) {
      const kinds = this.actions.flatMap((a) => (a.kind === 'melee' || a.kind === 'missile' ? a.targetIds : []));
      enemy = kinds.map((id) => this.unit(id)).find((t) => t && sameSquare(t.pos, c));
    }
    if (enemy) {
      const kind = this.attackKindFor(enemy.id);
      if (kind) this.openPreview(enemy.id, kind);
      else this.toast(`${enemy.name} is out of reach.`);
      return;
    }
    if (clicked && clicked.side === 'player') {
      if (clicked.id !== this.selectedId) {
        sfx.play('click');
        this.select(clicked.id, false);
        return;
      }
    }
    if (!c) return;
    const r = this.reach.find((x) => sameSquare(x.to, c));
    if (r && this.selectedId) {
      this.closePreview();
      void this.host.send({ type: 'move', unitId: this.selectedId, to: c });
      return;
    }
    // A friendly unit's square: select it (cycling if several).
    const here = this.players().filter((p) => sameSquare(p.pos, c));
    if (here.length) {
      const i = here.findIndex((p) => p.id === this.selectedId);
      this.select(here[(i + 1) % here.length]!.id, false);
    }
  }

  private onKey(e: KeyboardEvent): void {
    const tgt = e.target as HTMLElement | null;
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'SELECT' || tgt.tagName === 'TEXTAREA')) return;
    if (!this.state?.expedition || !this.root.isConnected) return;
    if (e.key === 'm' || e.key === 'M') {
      sfx.setMuted(!sfx.muted);
      this.muteBtn.refresh();
      return;
    }
    if (this.host.isBusy()) return;
    if (e.key === 'Escape') {
      if (!this.cancelMode()) this.el.settings.classList.add('hidden');
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const list = this.players();
      if (!list.length) return;
      const i = list.findIndex((u) => u.id === this.selectedId);
      const next = list[(i + (e.shiftKey ? -1 + list.length : 1)) % list.length]!;
      sfx.play('click');
      this.select(next.id);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (this.previewing) this.confirmAttack();
      else this.endTurn();
      return;
    }
    if (this.previewing && (e.key === '+' || e.key === '=')) return this.bumpFocus(1);
    if (this.previewing && (e.key === '-' || e.key === '_')) return this.bumpFocus(-1);
    if (/^[1-9]$/.test(e.key)) {
      const n = Number(e.key) - 1;
      const picker = this.el.picker;
      if (!picker.classList.contains('hidden')) {
        const rows = picker.querySelectorAll<HTMLButtonElement>('.pick-row');
        rows[n]?.click();
        return;
      }
      const acts = this.el.bar.querySelectorAll<HTMLButtonElement>('.act');
      acts[n]?.click();
    }
  }

  private endTurn(): void {
    if (this.host.isBusy() || !this.state?.expedition) return;
    this.closePreview();
    this.closePicker();
    this.mode = { kind: 'idle' };
    void this.host.send({ type: 'endTurn' });
  }

  private renderEndTurn(): void {
    const left = this.players().some((u) => u.actionsLeft > 0);
    this.el.endTurn.classList.toggle('ready', !left);
  }

  setBusy(busy: boolean): void {
    this.root.classList.toggle('busy', busy);
    if (busy) {
      this.dio.setReachable([]);
      this.dio.setPath([]);
      this.dio.setTargets([]);
      this.closePicker();
      this.showHint(null);
    }
  }

  // ------------------------------------------------------------ feedback

  private showHint(text: string | null): void {
    const el = this.el.hint;
    if (!text) {
      el.classList.add('hidden');
      return;
    }
    clear(el);
    el.append(text, h('span', { class: 'dim' }, '  ·  right-click or Esc to cancel'));
    el.classList.remove('hidden');
  }

  private toastTimer = 0;
  toast(text: string, kind: 'error' | 'info' = 'error'): void {
    const t = this.el.toast;
    t.textContent = text;
    t.className = `toast toast-${kind}`;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.classList.add('hidden'), 2600);
  }

  private renderLogFrom(lines: string[]): void {
    this.logLines = lines.slice(-60);
    const el = this.el.log;
    clear(el);
    for (const l of this.logLines) el.appendChild(h('p', null, l));
    el.scrollTop = el.scrollHeight;
  }

  appendLog(text: string, cls = ''): void {
    const el = this.el.log;
    const p = h('p', { class: `fresh ${cls}` }, text);
    el.appendChild(p);
    while (el.childElementCount > 60) el.firstElementChild?.remove();
    el.scrollTop = el.scrollHeight;
  }

  async banner(text: string, sub: string, danger: boolean, wait: (s: number) => Promise<void>): Promise<void> {
    const b = this.el.banner;
    clear(b);
    b.append(h('span', { class: 'banner-main' }, text), h('span', { class: 'banner-sub' }, sub));
    b.className = `phase-banner show ${danger ? 'danger' : ''}`;
    await wait(0.85);
    b.className = 'phase-banner';
  }

  pulseVignette(reduce: boolean): void {
    const v = this.el.vignette;
    v.classList.remove('pulse', 'soft');
    void v.offsetWidth;
    v.classList.add('pulse');
    if (reduce) v.classList.add('soft');
  }

  /** Dice resolution for one attack event. Flips each slot in turn. */
  async showDice(e: Extract<GameEvent, { type: 'attack' }>, names: { a: string; t: string; enemyAttacking: boolean }, wait: (s: number) => Promise<void>, onFlip: (hit: boolean, i: number) => void, onPerfect: () => void): Promise<void> {
    const roll: RollResult = e.roll;
    const tray = this.el.dice;
    clearTimeout(this.diceTimer);
    clear(tray);
    const tiles: HTMLElement[] = [];
    const row = h('div', { class: 'dice-row' });
    for (let i = 0; i < roll.slots; i++) {
      const locked = i < roll.locked;
      const tile = h('div', { class: `die ${locked ? 'locked' : ''}` }, h('div', { class: 'die-inner' }, h('span', { class: 'die-front' }, locked ? 'F' : `${roll.chance}`), h('span', { class: `die-back ${roll.hits[i] ? 'hit' : 'miss'}` }, roll.hits[i] ? 'HIT' : 'MISS')));
      tiles.push(tile);
      row.appendChild(tile);
    }
    const result = h('div', { class: 'dice-result' });
    tray.append(
      h('div', { class: `dice-head ${names.enemyAttacking ? 'enemy' : ''}` }, h('span', null, names.a), h('span', { class: 'arrow' }, e.kind === 'melee' ? ' strikes ' : ' shoots '), h('span', null, names.t), h('span', { class: 'dim small' }, ` · ${FRONTAGE_NAME[e.frontage]} · ${roll.chance}%`)),
      row,
      result,
    );
    tray.className = `dice-tray show ${names.enemyAttacking ? 'enemy' : ''}`;
    await wait(0.18);
    for (let i = 0; i < tiles.length; i++) {
      tiles[i]!.classList.add('flipped');
      onFlip(!!roll.hits[i], i);
      await wait(i < roll.locked ? 0.1 : 0.2);
    }
    if (roll.perfect) {
      tray.classList.add('perfect');
      result.append(h('span', { class: 'perfect-stamp' }, 'PERFECT'));
      onPerfect();
      await wait(0.55);
    } else {
      result.append(h('span', { class: roll.wounds ? 'wounds' : 'dim' }, roll.wounds ? `${roll.wounds} wound${roll.wounds > 1 ? 's' : ''}` : 'No wounds'));
      await wait(0.25);
    }
    // It stays up while the blow lands; hideDice() clears it after playback.
    void result;
  }

  /** Keep the dice tray up after playback (screenshots, debugging). */
  holdDice = false;
  private diceTimer = 0;

  /** Hide the dice tray a moment after playback ends. */
  hideDice(): void {
    clearTimeout(this.diceTimer);
    if (this.holdDice) return;
    this.diceTimer = window.setTimeout(() => this.el.dice.classList.remove('show'), 900 / Math.max(0.5, this.host.settings.speed));
  }

  get tier(): AlarmTier | null {
    return this.lastTier;
  }
}

function menDots(n: number, cls = ''): HTMLElement {
  const row = h('span', { class: `men-dots ${cls}` });
  for (let i = 0; i < Math.min(12, n); i++) row.appendChild(h('i'));
  return row;
}

function appendAll(el: HTMLElement, ...kids: (Node | null)[]): void {
  for (const k of kids) if (k) el.appendChild(k);
}
