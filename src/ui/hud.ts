// The delve HUD: light meter, round, contract goal, hero cards, action bar,
// roll preview, roll animation, event log, tooltips, banners. Drives the
// diorama's highlights from hover and click. Commands go through host.send.

import type { ActionOption, Engine, Reach, RollPreview, Visibility } from '../game/api';
import { add, hexKey, hexToWorld, posKey, samePos, type Pos } from '../game/hex';
import type { ActionKind, ActionTarget, Brightness, DealOption, GameEvent, GameState, Hero, HeroInDelve, Intent, Item, JobKind, Monster, SlotRoll } from '../game/types';
import { sfx } from '../audio/sfx';
import type { Diorama } from '../view/diorama';
import { propName } from '../view/level';
import { clear, h, pips } from './dom';
import { exitAt, exitTooltip, exitWhere, linkAt, linkButton, linkReach, linkTooltip, nearestExit, prizeInHand, type ExitInfo, type LinkInfo } from '../view/links';
import { ACTION_GLYPH, ACTION_HELP, ACTION_KEY, ALE_EFFECT, AWARENESS_TEXT, BRIGHTNESS_NAME, CLASS_ROLE, CREW, DEAL_GLYPH, JOB_NAME, MONSTER_NOTE, STANCE, TEMPERAMENT, actionCost, actionHelp, classGlyph, className, itemBase, itemGlyph, itemLabel, itemTip, lightScale, modifierHelp, roundsToNext, type LightScale } from './names';
import { BRAZIER_LIGHT, CLASSES, DARK_SIGHT, FOCUS_MAX, KINDLE_LIGHT, LIGHT_MAX, OIL_LIGHT, MONSTER_DARK_SIGHT, OVERWATCH_RANGE, PACK_SLOTS, VEIL_BREAK_NOISE } from '../game/data';
import { LANTERN_RADIUS, SIGHT_BY_STAGE } from '../game/world';
import type { Settings } from './settings';

export interface HudHost {
  engine: Engine;
  send(cmd: import('../game/types').Command): Promise<boolean>;
  isBusy(): boolean;
  settings: Settings;
  saveSettings(): void;
  applySettings(): void;
  abandonDelve(): void;
  toTitle(): void;
  /** V3.6 (19.5): the exit the party came in by, if known. */
  entrance(): Pos | null;
}

interface PreviewState {
  option: ActionOption;
  target: ActionTarget;
  preview: RollPreview;
  focus: number;
}

const ITEM_ACTIONS = new Set<ActionKind>(['smoke', 'glue', 'dart', 'caltrops', 'firecracker', 'key', 'oil', 'grapple', 'torch', 'potion', 'rope', 'charge', 'throwCharge', 'nightsight']);
const SPELLS = new Set<ActionKind>(['firebolt', 'fireball', 'kindle', 'mend', 'veil', 'sleep', 'blink', 'ward', 'gust']);
/** Class abilities that aren't spells (the Abilities group of the bar). */
const ABILITIES = new Set<ActionKind>(['guard', 'rally', 'overwatch', 'knockback', 'dig']);

const SPEEDS: { label: string; value: number }[] = [
  { label: '½×', value: 0.5 },
  { label: '1×', value: 1 },
  { label: '2×', value: 2 },
  { label: '4×', value: 4 },
  { label: 'Instant', value: 0 },
];

/** Probability of exactly k hits for n free slots at chance p (0..1), plus `locked` sure hits. */
export function hitOdds(slots: number, chance: number, locked: number): number[] {
  const n = Math.max(0, slots - locked);
  const p = Math.max(0, Math.min(1, chance / 100));
  const out = new Array<number>(slots + 1).fill(0);
  let c = 1;
  for (let k = 0; k <= n; k++) {
    if (k > 0) c = (c * (n - k + 1)) / k;
    out[k + locked] = c * Math.pow(p, k) * Math.pow(1 - p, n - k);
  }
  return out;
}

export class Hud {
  readonly root: HTMLElement;
  selectedId: string | null = null;
  sneak = false;
  private state: GameState | null = null;
  private vis: Visibility | null = null;
  private busy = false;
  private reach: Reach[] = [];
  private options: ActionOption[] = [];
  private pending: ActionOption | null = null;
  private pv: PreviewState | null = null;
  private lastPreview: PreviewState | null = null;
  private intents: Record<string, Intent> = {};
  private mouse = { x: 0, y: 0 };
  private hoverAt: Pos | null = null;
  private hoverUnit: string | null = null;
  private confirmBox: { text: string; ok: () => void } | null = null;
  /** Lines added during playback, shown before the state's log catches up. */
  private liveLog: { text: string; cls: string }[] = [];

  // Elements.
  private topbar = h('div', { class: 'hud-top' });
  private cards = h('div', { class: 'hud-cards' });
  private bar = h('div', { class: 'hud-bar' });
  /** 15.7 context hint line under the bar. */
  private hint = h('div', { class: 'hud-hint hidden' });
  private logEl = h('div', { class: 'hud-log' });
  private tip = h('div', { class: 'hud-tip hidden' });
  private previewEl = h('div', { class: 'hud-preview hidden' });
  private rollEl = h('div', { class: 'hud-roll hidden' });
  private bannerEl = h('div', { class: 'hud-banner hidden' });
  private toastEl = h('div', { class: 'hud-toast hidden' });
  private picker = h('div', { class: 'hud-picker hidden' });
  private modal = h('div', { class: 'hud-modal hidden' });
  private rivalEl = h('div', { class: 'hud-rivals hidden' });
  /** V3.5 (18.6): the parley card; open while `parleyHero` is set. */
  private parleyEl = h('div', { class: 'hud-parley hidden' });
  private parleyHero: string | null = null;
  private vignette = h('div', { class: 'hud-vignette' });
  private camBox = h('div', { class: 'hud-cam' });
  private menuEl = h('div', { class: 'hud-menu hidden' });
  private emptyEl = h('div', { class: 'hud-empty hidden' });
  /** 16.2: persistent warning while the Gloam is up and a hero on Level 3 stands in the dark. */
  private gloamEl = h('div', { class: 'hud-gloam hidden' }, h('span', { class: 'gloam-eye' }, '◉'), ' The dark here is awake. Stand in the light.');

  constructor(
    private readonly host: HudHost,
    private readonly dio: Diorama,
  ) {
    this.root = h('div', { class: 'hud' }, this.vignette, this.emptyEl, this.topbar, this.rivalEl, this.cards, this.logEl, this.camBox, this.gloamEl, this.hint, this.bar, this.picker, this.previewEl, this.parleyEl, this.rollEl, this.bannerEl, this.toastEl, this.tip, this.modal, this.menuEl);
    this.buildCamBox();
    addEventListener('pointermove', (e) => {
      this.mouse = { x: e.clientX, y: e.clientY };
      if (!this.tip.classList.contains('hidden')) this.placeTip();
    });
    addEventListener('keydown', (e) => this.onKey(e));
    addEventListener('resize', () => this.placeBelowTop());
    // V3.4: every HUD element with a title gets the HUD's own tooltip, at once and styled (15.7 pass).
    this.root.addEventListener('pointerover', (e) => this.onHudOver(e));
    this.root.addEventListener('pointerout', (e) => {
      if (this.hudTipOn && !(e.relatedTarget instanceof Node && this.hudTipOn.contains(e.relatedTarget))) {
        this.hudTipOn = null;
        this.hideTip();
      }
    });
  }

  private hudTipOn: HTMLElement | null = null;

  private onHudOver(e: PointerEvent): void {
    const t = e.target instanceof Element ? e.target.closest<HTMLElement>('[title],[data-tip]') : null;
    if (!t || !this.root.contains(t) || t === this.hudTipOn) return;
    if (t.hasAttribute('title')) {
      t.dataset.tip = t.getAttribute('title') ?? '';
      t.removeAttribute('title');
    }
    const text = t.dataset.tip ?? '';
    if (!text) return;
    this.hudTipOn = t;
    this.mouse = { x: e.clientX, y: e.clientY };
    this.showTip(tipHtml(text));
  }

  /** Cards, rivals and camera buttons sit under the top bar, however tall it gets (no overlap at any size). */
  private placeBelowTop(): void {
    const hgt = this.topbar.offsetHeight;
    if (!hgt) return;
    this.root.style.setProperty('--hud-below', `${this.topbar.offsetTop + hgt + 8}px`);
  }

  get engine(): Engine {
    return this.host.engine;
  }

  // ------------------------------------------------------------ state

  setState(s: GameState, vis: Visibility): void {
    this.state = s;
    this.vis = vis;
    this.liveLog = [];
    const d = s.delve;
    if (!d) return;
    const active = d.heroes.filter((x) => x.status === 'active');
    if (!this.selectedId || !active.some((x) => x.heroId === this.selectedId)) {
      const next = active.find((x) => !x.moved || !x.acted) ?? active[0];
      this.selectedId = next?.heroId ?? null;
    }
    this.dio.select(this.selectedId);
    this.intents = this.engine.intents(s);
    this.dio.showIntents(s, this.intents);
    this.refresh();
  }

  /** After a command: if the selected hero is spent, select the next one with something left. */
  autoAdvance(): void {
    const d = this.state?.delve;
    const sel = this.selected();
    if (!d || !sel || sel.status !== 'active' || !(sel.moved && sel.acted)) return;
    // Prefer a hero on the level in view (after a fall, stay with the faller's new level if nobody else is there).
    const ready = d.heroes.filter((x) => x.status === 'active' && (!x.moved || !x.acted));
    const next = ready.find((x) => x.at.level === this.dio.shownLevel) ?? (sel.at.level === this.dio.shownLevel ? undefined : ready[0]);
    if (next) this.select(next.heroId);
  }

  setBusy(b: boolean): void {
    this.busy = b;
    this.root.classList.toggle('busy', b);
    if (b) {
      this.closePreview();
      this.pending = null;
      this.picker.classList.add('hidden');
      this.dio.clearHighlights();
      this.hideTip();
    }
    this.renderBar();
  }

  select(id: string): void {
    const d = this.state?.delve;
    const hd = d?.heroes.find((x) => x.heroId === id);
    if (!hd || hd.status !== 'active') return;
    this.selectedId = id;
    this.pending = null;
    this.closePreview();
    this.dio.select(id);
    if (hd.at.level !== this.dio.shownLevel) this.dio.showLevel(hd.at.level);
    this.dio.lookAt(hd.at);
    sfx.play('click');
    this.refresh();
  }

  private selected(): HeroInDelve | undefined {
    return this.state?.delve?.heroes.find((x) => x.heroId === this.selectedId);
  }

  private heroDef(id: string): Hero | undefined {
    return this.state?.campaign.roster.find((x) => x.id === id);
  }

  /** 16.2: engine.heroLit, tolerant of an engine without it (then: lit). */
  private isLit(heroId: string): boolean {
    const s = this.state;
    if (!s?.delve) return true;
    try {
      return this.engine.heroLit(s, heroId);
    } catch {
      return true;
    }
  }

  /** 16.2: engine.sightRange per hero, or null when the engine can't say. */
  private sightOf(heroId: string): number | null {
    const s = this.state;
    if (!s?.delve) return null;
    try {
      const n = this.engine.sightRange(s, heroId);
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }

  /**
   * Spec 15.7: the stairs or working lift the selected hero stands on, with the
   * `reachable` entry that takes them (destination on another level, one step).
   */
  private linkHere(): { info: LinkInfo; reach: Reach } | null {
    const sel = this.selected();
    if (!sel) return null;
    const reach = linkReach(this.reach, sel.at);
    if (!reach) return null;
    const info = linkAt(this.engine.castle(), sel.at);
    return info ? { info, reach } : null;
  }

  private takeLink(): void {
    const l = this.linkHere();
    const sel = this.selected();
    if (!l || !sel || this.busy) return;
    this.cancel();
    sfx.play('click');
    void this.host.send({ type: 'move', heroId: sel.heroId, path: l.reach.path, sneak: this.sneak });
  }

  /** V3.6 (19.5): the exit the selected hero stands on, with the engine's `leave` option if it offers one. */
  private exitHere(): { info: ExitInfo; option: ActionOption | undefined } | null {
    const sel = this.selected();
    if (!sel || sel.status !== 'active') return null;
    const info = exitAt(this.engine.castle(), sel.at, this.host.entrance());
    if (!info) return null;
    return { info, option: this.options.find((o) => o.action === 'leave') };
  }

  private leaveHere(): void {
    const e = this.exitHere();
    const sel = this.selected();
    if (!e || !sel || this.busy) return;
    if (!e.option) {
      this.toast('Nobody can leave right now.');
      return;
    }
    if (e.option.blocked) {
      this.flashBlocked(e.option, e.option.targets[0]);
      return;
    }
    this.cancel();
    this.choose(e.option, e.option.targets[0] ?? { at: sel.at });
  }

  /** V3.6 (19.5): the exit hex is known (explored) or the one the party came in by. */
  private exitKnown(p: Pos): boolean {
    const k = posKey(p);
    return !!this.vis && (this.vis.explored.has(k) || this.vis.visible.has(k));
  }

  /** Recompute reach and options and redraw panels and highlights. */
  refresh(): void {
    const s = this.state;
    const d = s?.delve;
    if (!s || !d) return;
    const sel = this.selected();
    const canAct = !!sel && sel.status === 'active' && d.phase === 'player';
    this.reach = canAct && !this.busy ? this.engine.reachable(s, sel.heroId, this.sneak) : [];
    this.options = canAct && !this.busy ? this.engine.actions(s, sel.heroId) : [];
    this.renderTop();
    this.renderCards();
    this.placeBelowTop();
    this.renderBar();
    this.renderLog();
    this.renderRivals();
    this.renderParley();
    this.renderEmpty();
    this.drawHighlights();
  }

  // ------------------------------------------------------------ highlights

  private drawHighlights(): void {
    this.dio.clearHighlights();
    if (this.busy || !this.state?.delve) return;
    this.dio.showLanding(null, null, '', false);
    if (this.pending) {
      const ats = this.pending.targets.map((t) => this.targetPos(t)).filter((p): p is Pos => !!p);
      const friendly = this.pending.pick === 'ally' || ['mend', 'potion', 'give', 'guard', 'revive', 'passLantern', 'free', 'veil', 'ward'].includes(this.pending.action);
      const hexPick = this.pending.pick === 'hex' && !['jump', 'dig', 'key'].includes(this.pending.action);
      this.dio.highlight(ats, this.pending.action === 'jump' ? 'danger' : friendly ? 'ally' : hexPick ? 'dash' : 'target');
      this.applyHover();
      return;
    }
    if (this.pv) {
      const at = this.targetPos(this.pv.target);
      const area = this.pv.preview.hexes ?? (this.pv.option.area && at ? this.areaAround(at, this.pv.option.area) : []);
      if (area.length) this.dio.highlight(area, 'area');
      const hit = (this.pv.preview.affects ?? []).map((id) => this.targetPos({ id })).filter((p): p is Pos => !!p);
      if (hit.length) this.dio.highlight(hit, 'danger');
      if (at) this.dio.highlight([at], this.pv.option.action === 'jump' ? 'danger' : 'target');
      const sel = this.selected();
      if (sel && this.pv.preview.noise > 0) this.dio.showRipple(sel.at, this.pv.preview.noise);
      this.showActionLanding(this.pv.option.action, this.pv.target);
      return;
    }
    const dash = this.reach.some((r) => r.dash);
    this.dio.highlight(
      this.reach.map((r) => r.to),
      dash ? 'dash' : this.sneak ? 'sneak' : 'walk',
    );
    // Standing on stairs or a working lift: the hex pulses (15.7).
    const link = this.linkHere();
    this.dio.showLinkPulse(link ? this.selected()!.at : null);
    // Standing on an exit: the hex pulses too (19.5).
    const exit = this.exitHere();
    this.dio.showExitPulse(exit?.option && !exit.option.blocked ? this.selected()!.at : null);
    // Attackable enemies get a red ring.
    const atk = this.options.filter((o) => o.action === 'attack' || o.action === 'firebolt');
    const ats = atk.flatMap((o) => o.targets.map((t) => this.targetPos(t))).filter((p): p is Pos => !!p);
    this.dio.highlight(ats, 'target');
    this.applyHover();
  }

  /** Where a jump into this pit lands, as words. */
  private fallWords(pit: Pos): { to: Pos; text: string; danger: boolean } | null {
    const s = this.state;
    if (!s) return null;
    const f = this.engine.fallInfo(s, pit);
    if (!f) return null;
    const lvl = this.engine.castle().levels.find((l) => l.level === f.to.level);
    const room = lvl?.rooms.find((r) => r.id === lvl.tiles[hexKey(f.to)]?.room)?.name;
    const where = f.levels === 1 && room ? `on ${room.startsWith('the ') ? room : `the ${room}`}` : `into ${f.levelName}`;
    const text = f.levels === 1 ? `Lands ${where}, 1 level, ${f.damage} damage` : `Falls ${f.levels} levels ${where}: ${f.damage} damage`;
    return { to: f.to, text, danger: f.levels > 1 };
  }

  /** Where a shove from `from` sends whatever stands at `at`: one hex straight away. */
  private shoveDest(from: Pos, at: Pos): Pos {
    const dq = at.q - from.q;
    const dr = at.r - from.r;
    return { level: at.level, ...add(at, { q: dq, r: dr }) };
  }

  /** Landing marker for a jump or shove (preview or hover). */
  private showActionLanding(action: ActionKind, t: ActionTarget): void {
    const sel = this.selected();
    const s = this.state;
    if (!sel || !s) return;
    if (action === 'jump' && t.at) {
      const f = this.fallWords(t.at);
      if (f) this.dio.showLanding(t.at, f.to, f.text, f.danger);
    } else if (action === 'shove') {
      const at = this.targetPos(t);
      if (!at) return;
      const dest = this.shoveDest(sel.at, at);
      const f = this.fallWords(dest);
      if (f) this.dio.showLanding(dest, f.to, `Shoved in: ${f.text.replace(/^Lands/, 'lands').replace(/^Falls/, 'falls')}`, true);
      else this.dio.showLanding(null, dest, 'Lands here', false);
    }
  }

  private targetPos(t: ActionTarget): Pos | null {
    if (t.at) return t.at;
    const d = this.state?.delve;
    if (!t.id || !d) return null;
    return d.heroes.find((x) => x.heroId === t.id)?.at ?? d.monsters.find((m) => m.id === t.id)?.at ?? d.rivals?.members.find((r) => r.id === t.id)?.at ?? (d.prisoner?.id === t.id ? d.prisoner.at : null);
  }

  /** Hexes within `r` of `at` that exist on the map. */
  private areaAround(at: Pos, r: number): Pos[] {
    const lv = this.engine.castle().levels.find((l) => l.level === at.level);
    if (!lv) return [];
    const out: Pos[] = [];
    for (let dq = -r; dq <= r; dq++)
      for (let dr = Math.max(-r, -dq - r); dr <= Math.min(r, -dq + r); dr++) {
        const p = { level: at.level, q: at.q + dq, r: at.r + dr };
        const t = lv.tiles[hexKey(p)];
        if (t && t.kind !== 'wall') out.push(p);
      }
    return out;
  }

  // ------------------------------------------------------------ hover and click

  onHover(at: Pos | null, unitId: string | null): void {
    this.hoverAt = at;
    this.hoverUnit = unitId;
    this.applyHover();
  }

  private applyHover(): void {
    if (this.busy || !this.state?.delve || this.pv) {
      this.hideTip();
      return;
    }
    const at = this.hoverAt;
    const unitId = this.hoverUnit;
    const d = this.state.delve;
    if (this.pending && (this.pending.action === 'jump' || this.pending.action === 'shove')) {
      const t = this.pending.targets.find((x) => (unitId ? x.id === unitId : !!at && !!x.at && samePos(x.at, at)));
      this.dio.showLanding(null, null, '', false);
      if (t) this.showActionLanding(this.pending.action, t);
    }
    // Area preview while aiming a hex action (fireball, gust, smoke, glue).
    if (this.pending?.area && at) {
      const t = this.pending.targets.find((x) => x.at && samePos(x.at, at));
      this.drawPendingArea(t ? at : null);
    }
    // Path preview.
    const r = at && !unitId && !this.pending ? this.reach.find((x) => samePos(x.to, at)) : undefined;
    const sel = this.selected();
    if (r && sel) {
      this.dio.showPath(r.path);
      const noise = this.engine.moveNoise(this.state, sel.heroId, this.sneak);
      this.dio.showRipple(r.to, noise);
    } else if (!this.pending) {
      this.dio.showPath(null);
      this.dio.showRipple(null, 0);
    }
    // Tooltip.
    const lines: string[] = [];
    if (unitId) {
      const m = d.monsters.find((x) => x.id === unitId);
      const hero = d.heroes.find((x) => x.heroId === unitId);
      const rival = d.rivals?.members.find((x) => x.id === unitId);
      if (m) lines.push(...this.monsterLines(m));
      else if (hero) {
        const def = this.heroDef(hero.heroId);
        lines.push(`<b>${def?.name ?? hero.heroId}</b> <span class="dim">${def ? className(def.cls) : ''}</span>`, `HP ${hero.hp}/${def?.maxHp ?? '?'} · Focus ${hero.focus}`);
      } else if (rival && d.rivals) {
        const st = STANCE[d.rivals.stance];
        lines.push(
          `<b>${rival.name}</b> <span class="dim">${d.rivals.name}${rival.cls ? ` · ${className(rival.cls)}` : ''}</span>`,
          `HP ${rival.hp}/${rival.maxHp} · <span class="st-word st-${st.cls}">${st.name}</span>${d.rivals.stance === 'hired' && d.rivals.hiredRounds ? ` · ${d.rivals.hiredRounds} round${d.rivals.hiredRounds === 1 ? '' : 's'} left` : ''}`,
          `<span class="dim">${RIVAL_KIT[rival.cls] ?? ''}</span>`,
          d.rivals.spotted && d.rivals.stance !== 'hired' ? `Goal: ${GOAL_TEXT[d.rivals.goal]}${d.rivals.aim ? ` · after ${d.rivals.aim.what}` : ''}` : '',
        );
        const rit = this.intents[rival.id] ?? rival.intent;
        if (rit && rit.kind !== 'wait') lines.push(`<span class="${d.rivals.stance === 'hired' ? 'pos' : 'neg'}">Next: ${intentText(this.state, rit)}</span>`);
        const sel = this.selected();
        if (sel && this.dealsFor(sel.heroId).length) lines.push(`<span class="tip-act">${d.rivals.stance === 'hostile' ? 'Parley (B): buy a truce' : 'Click: Parley'}</span>`);
      }
      else if (d.prisoner?.id === unitId) lines.push(`<b>${d.prisoner.name}</b>`, d.prisoner.freed ? 'Freed, following' : 'Shackled. Free them (adjacent).', `HP ${d.prisoner.hp}/5`);
      const act = this.bestActionFor(unitId, at);
      const link = unitId === this.selectedId ? this.linkHere() : null;
      const exit = unitId === this.selectedId ? this.exitHere() : null;
      if (link) lines.push(`<span class="tip-act">Click: ${linkButton(link.info)}</span>`);
      else if (exit?.option && !exit.option.blocked) lines.push('<span class="tip-act">Click: Leave the castle</span>');
      else if (act) lines.push(act.option.blocked ? `<span class="neg">${act.option.label}: ${act.option.blocked}</span>` : `<span class="tip-act">Click: ${act.option.label}</span>`);
      this.dio.setHoverStyle('plain');
    } else if (at) {
      if (r) lines.push(`<b>${r.dash ? (this.sneak ? 'Dash (sneak)' : 'Dash') : this.sneak ? 'Sneak' : 'Walk'}</b> ${r.cost} · noise ${this.engine.moveNoise(this.state, sel!.heroId, this.sneak)}${r.dash ? ' · <span class="neg">uses the action</span>' : ''}`);
      const desc = this.describeHex(at);
      if (desc) lines.push(desc);
      const link = sel && samePos(sel.at, at) ? this.linkHere() : null;
      const exit = sel && samePos(sel.at, at) ? this.exitHere() : null;
      const act = this.bestActionFor(null, at);
      if (link) lines.push(`<span class="tip-act">Click: ${linkButton(link.info)}</span>`);
      else if (exit?.option && !exit.option.blocked) lines.push('<span class="tip-act">Click: Leave the castle</span>');
      else if (act && !r) lines.push(act.option.blocked ? `<span class="neg">${act.option.label}: ${act.option.blocked}</span>` : `<span class="tip-act">Click: ${act.option.label}</span>`);
      this.dio.setHoverStyle(this.hoverKind(at));
    }
    if (lines.filter(Boolean).length) this.showTip(lines.filter(Boolean).join('<br>'));
    else this.hideTip();
  }

  private areaDrawn = '';
  /** Highlight the area a hex action would cover around `at` (null: just the valid targets). */
  private drawPendingArea(at: Pos | null): void {
    const key = at ? posKey(at) : '';
    if (key === this.areaDrawn || !this.pending) return;
    this.areaDrawn = key;
    this.dio.clearHighlights();
    const ats = this.pending.targets.map((t) => this.targetPos(t)).filter((p): p is Pos => !!p);
    this.dio.highlight(ats, 'dash');
    if (at && this.pending.area) this.dio.highlight(this.areaAround(at, this.pending.area), 'area');
  }

  private monsterLines(m: Monster): string[] {
    const it = this.intents[m.id];
    const out = [`<b>${m.name}</b> <span class="dim">${m.awareness === 'patrol' ? 'on patrol' : m.awareness}</span>`];
    if (m.kind !== 'gloam') out.push(`HP ${m.hp}/${m.maxHp}${m.stuck ? ` · <span class="neg">glued ${m.stuck}</span>` : ''}`);
    const note = MONSTER_NOTE[m.kind];
    if (note) out.push(`<span class="dim">${note}</span>`);
    const aw = AWARENESS_TEXT[m.awareness];
    if (aw && m.kind !== 'gloam') out.push(`<span class="dim">${aw}${m.awareness === 'patrol' && this.state?.delve?.knownRoutes.includes(m.id) ? ' Route known (drawn on the map).' : ''}</span>`);
    if (m.holding) out.push(`<span class="neg">Holding ${this.nameOf(m.holding)}</span>`);
    if (it) out.push(`<span class="neg">Next: ${intentText(this.state!, it)}</span>`);
    return out;
  }

  private describeHex(at: Pos): string {
    const s = this.state!;
    const d = s.delve!;
    const lv = this.engine.castle().levels.find((l) => l.level === at.level);
    const t = lv?.tiles[hexKey(at)];
    if (!t) return '';
    const k = posKey(at);
    const room = lv?.rooms.find((r) => r.id === t.room)?.name;
    const explored = !!this.vis && (this.vis.explored.has(k) || this.vis.visible.has(k));
    if (!explored) return '';
    const parts: string[] = [];
    // 15.7: every interactable names itself and its interactions ("Thing · what you can do").
    const act = (name: string, what: string) => parts.push(`<b>${name}</b> <span class="tip-how">· ${what}</span>`);
    const door = d.doors[k];
    const castle = this.engine.castle();
    // 19.2: Pick is the Burglar's, or anyone's with lockpicks in the pack.
    const sel = this.selected();
    const selDef = sel ? this.heroDef(sel.heroId) : undefined;
    const canPick = !!sel && (selDef?.cls === 'burglar' || sel.pack.some((i) => itemBase(i.kind) === 'lockpicks'));
    const lockedHow = (more: string) => (canPick ? `Pick, Smash${more}` : `Smash it${more}, or a Burglar or lockpicks could pick it`);
    if (t.kind === 'door' && door) {
      if (door.open) act('Open door', 'walk through');
      else if (door.jammed) act('Jammed door', 'Smash or Charge');
      else if (door.locked) act('Locked door', lockedHow(' or Charge'));
      else act('Door', 'Open, then walk through');
    } else if (t.kind === 'brazier') {
      if (d.lit.includes(k)) parts.push('<b>Brazier</b>, lit for good');
      else act('Brazier', `Light: +${BRAZIER_LIGHT} lantern light, lit for good`);
    } else if (t.kind === 'prop' || t.kind === 'tallprop') {
      if (t.prop === 'winch') act('Winch', d.liftWorking ? 'the lift runs' : 'work it to run the lift, loud');
      else parts.push(`${propName(t.prop)} <span class="dim">${t.kind === 'tallprop' ? 'blocks sight' : 'cover'}</span>`);
    } else if (t.kind === 'lift' || t.kind === 'stairs') {
      const l = linkAt(castle, at);
      if (l) parts.push(`<b>${l.kind === 'lift' ? 'Lift' : 'Stairs'}</b> <span class="tip-how">· ${linkTooltip(castle, l, !!d.liftWorking).replace(/^(Lift|Stairs) /, '')}</span>`);
      else parts.push(TILE_NAME[t.kind] ?? t.kind);
    } else if (t.kind === 'exit') {
      const e = exitAt(castle, at, this.host.entrance());
      act('Way out', e ? exitTooltip(e) : 'stand here, then Leave the castle');
    }
    else if (t.kind === 'pit') {
      const f = this.fallWords(at);
      parts.push(`<b class="neg">Pit</b> <span class="tip-how">· Jump or Rope</span>${f ? `<br><span class="neg">${f.text}</span>` : ''}`);
    } else if (t.kind === 'cracked') act('Cracked wall', "Charge or Sapper's Dig");
    else if (t.kind === 'rubble') act('Rubble', "costs 2 to cross, or Sapper's Dig");
    else if (t.kind === 'sealed') parts.push('<b>Sealed.</b> Nothing opens it yet.');
    else if (t.kind !== 'floor') parts.push(TILE_NAME[t.kind] ?? t.kind);
    if (t.railing) parts.push('Railing');
    const vent = castle.lights.find((l) => l.kind === 'fire' && l.radius === 1 && samePos(l.at, at));
    if (vent) parts.push('<span class="neg">Fire vent: 3 damage</span>');
    if (t.raised) parts.push('Raised');
    const chest = d.chests.find((c) => samePos(c.at, at));
    if (chest) {
      if (chest.opened) parts.push('<b>Chest</b>, empty');
      else if (chest.jammed) act('Jammed chest', 'Smash');
      else if (chest.locked) act('Locked chest', lockedHow(' or Skeleton key'));
      else act('Chest', 'Open');
    }
    const g = d.ground.find((x) => samePos(x.at, at));
    if (g?.items.length) parts.push(`<b>Loot</b> <span class="tip-how">· Take</span> <span class="dim">${g.items.map(itemLabel).join(', ')}</span>`);
    if (d.traps[k]?.spotted) act('<span class="neg">Trap</span>', 'Disarm, or step around');
    const vis = this.vis;
    const light = vis?.lit.has(k) ? 'lit' : vis?.visible.has(k) ? 'unlit' : 'remembered';
    return `${parts.join(' · ')}${room ? ` <span class="dim">${room}</span>` : ''} <span class="dim">(${light})</span>`;
  }

  /** Does hovering this hex deserve the interactable outline (15.7)? */
  private hoverKind(at: Pos): 'plain' | 'interact' | 'danger' {
    const d = this.state?.delve;
    const lv = this.engine.castle().levels.find((l) => l.level === at.level);
    const t = lv?.tiles[hexKey(at)];
    if (!d || !t) return 'plain';
    const k = posKey(at);
    if (!this.vis || !(this.vis.explored.has(k) || this.vis.visible.has(k))) return 'plain';
    if (t.kind === 'pit' || d.traps[k]?.spotted) return 'danger';
    if (['door', 'brazier', 'lift', 'stairs', 'exit', 'cracked', 'rubble'].includes(t.kind)) return 'interact';
    if (t.prop === 'winch') return 'interact';
    if (d.chests.some((c) => samePos(c.at, at) && !c.opened)) return 'interact';
    if (d.ground.some((g) => samePos(g.at, at) && g.items.length)) return 'interact';
    return 'plain';
  }

  /** The action a click on this unit or hex would pick. */
  private bestActionFor(unitId: string | null, at: Pos | null): { option: ActionOption; target: ActionTarget } | null {
    const match = (t: ActionTarget) => (unitId ? t.id === unitId : !!at && !!t.at && samePos(t.at, at) && !t.id);
    if (this.pending) {
      const t = this.pending.targets.find(match) ?? (at ? this.pending.targets.find((x) => x.at && samePos(x.at, at)) : undefined);
      return t ? { option: this.pending, target: t } : null;
    }
    const crew = this.state?.delve?.rivals;
    const isRival = !!unitId && !!crew?.members.some((m) => m.id === unitId);
    // 18.6: clicking a crew member that isn't fighting you opens the deal card, not an attack.
    const order: ActionKind[] = unitId ? (isRival && crew!.stance !== 'hostile' ? ['parley', 'free', 'revive'] : ['attack', 'firebolt', 'free', 'revive', 'parley', 'bribe', 'shove']) : ['open', 'pick', 'take', 'light', 'disarm', 'smash', 'winch', 'leave', 'dig', 'jump'];
    for (const kind of order) {
      const o = this.options.find((x) => x.action === kind);
      const t = o?.targets.find(match);
      if (o && t) return { option: o, target: t };
    }
    return null;
  }

  onClick(at: Pos | null, unitId: string | null, ev: PointerEvent): void {
    if (this.busy || this.confirmBox) return;
    const s = this.state;
    const d = s?.delve;
    if (!s || !d) return;
    if (this.parleyHero && ev.button !== 2) return;
    if (ev.button === 2) {
      this.cancel();
      return;
    }
    if (this.pv) return;
    // Clicking the hex you stand on (or your own figure) takes the stairs or lift (15.7).
    const sel = this.selected();
    if (!this.pending && sel && ((unitId && unitId === this.selectedId) || (!unitId && at && samePos(at, sel.at))) && this.linkHere()) {
      this.takeLink();
      return;
    }
    // Or leaves by the exit they stand on (19.5).
    if (!this.pending && sel && ((unitId && unitId === this.selectedId) || (!unitId && at && samePos(at, sel.at))) && this.exitHere()?.option) {
      this.leaveHere();
      return;
    }
    const best = this.bestActionFor(unitId, at);
    const activeHero = d.heroes.some((x) => x.heroId === unitId && x.status === 'active');
    if (best && (this.pending || !activeHero)) {
      this.choose(best.option, best.target);
      return;
    }
    if (unitId && d.heroes.some((x) => x.heroId === unitId && x.status === 'active')) {
      this.select(unitId);
      return;
    }
    if (this.pending) {
      this.cancel();
      return;
    }
    if (at) {
      const r = this.reach.find((x) => samePos(x.to, at));
      if (r && this.selectedId) {
        void this.host.send({ type: 'move', heroId: this.selectedId, path: r.path, sneak: this.sneak });
        return;
      }
      if (best) this.choose(best.option, best.target);
    }
  }

  private cancel(): void {
    if (this.confirmBox) {
      this.closeConfirm();
      return;
    }
    if (this.parleyHero) {
      this.closeParley();
      return;
    }
    if (this.pv) this.closePreview();
    else if (this.pending) this.pending = null;
    else if (!this.menuEl.classList.contains('hidden')) this.menuEl.classList.add('hidden');
    this.picker.classList.add('hidden');
    this.drawHighlights();
    this.renderBar();
  }

  // ------------------------------------------------------------ actions

  /** 15.7: a blocked option says why, as a flash on the bar and at the target. */
  private flashBlocked(o: ActionOption, t?: ActionTarget): void {
    sfx.play('flip', { pitch: 0.7 });
    this.toast(o.blocked ?? 'Not now.');
    const at = t ? this.targetPos(t) : null;
    if (at) this.dio.floatText(at, o.blocked ?? 'Blocked', 'warn', 1.8);
    const btn = [...this.bar.querySelectorAll<HTMLButtonElement>('button.act.blocked')].find((b) => b.dataset.action === o.action);
    if (btn) {
      btn.classList.remove('shake');
      void btn.offsetWidth;
      btn.classList.add('shake');
    }
  }

  private startAction(o: ActionOption): void {
    if (this.busy) return;
    if (o.action === 'parley' && !o.blocked) {
      sfx.play('click');
      this.openParley();
      return;
    }
    if (o.blocked) {
      this.flashBlocked(o, o.targets[0]);
      return;
    }
    sfx.play('click');
    if (o.targets.length === 1) {
      this.choose(o, o.targets[0]!);
      return;
    }
    this.pending = o;
    this.areaDrawn = '';
    this.closePreview();
    if (o.pick === 'hex' || o.pick === 'enemy' || o.pick === 'ally') this.showAimHint(o);
    else this.showPicker(o);
    this.drawHighlights();
    this.renderBar();
  }

  /** Map-targeted actions: a short hint instead of a list (the list is still there for keyboard users). */
  private showAimHint(o: ActionOption): void {
    clear(this.picker);
    const what = o.pick === 'hex' ? (o.area ? 'a hex (the orange area is hit)' : 'a highlighted hex') : o.pick === 'ally' ? 'an ally' : 'an enemy';
    const list = o.targets.length <= 6 && o.pick !== 'hex' ? o.targets.map((t) => h('button', { class: 'btn btn-small picker-row', onclick: () => this.choose(o, t) }, this.targetLabel(t))) : [];
    this.picker.append(h('div', { class: 'kicker' }, `${o.label}${o.mana ? ` · ${o.mana} mana` : ''}`), h('div', { class: 'small' }, `Click ${what}.`), ...list, h('button', { class: 'btn btn-small btn-ghost', onclick: () => this.cancel() }, 'Cancel ', h('kbd', null, 'Esc')));
    this.picker.classList.remove('hidden');
  }

  private showPicker(o: ActionOption): void {
    clear(this.picker);
    this.picker.append(
      h('div', { class: 'kicker' }, `${o.label}: pick a target`),
      ...o.targets.map((t) => h('button', { class: 'btn btn-small picker-row', onclick: () => this.choose(o, t) }, this.targetLabel(t))),
      h('button', { class: 'btn btn-small btn-ghost', onclick: () => this.cancel() }, 'Cancel ', h('kbd', null, 'Esc')),
    );
    this.picker.classList.remove('hidden');
  }

  private choose(o: ActionOption, t: ActionTarget): void {
    this.pending = null;
    this.picker.classList.add('hidden');
    const sel = this.selected();
    if (!sel || !this.state) return;
    if (o.action === 'parley' && !o.blocked) {
      this.openParley();
      return;
    }
    if (o.blocked) {
      this.flashBlocked(o, t);
      return;
    }
    if (o.rolls || o.action === 'jump' || (o.area ?? 0) > 0 || o.action === 'blink') {
      const p = this.engine.preview(this.state, sel.heroId, o.action, t);
      this.openPreview({ option: o, target: t, preview: p, focus: 0 });
      return;
    }
    void this.act(o.action, t, 0);
  }

  private async act(action: ActionKind, target: ActionTarget, focus: number): Promise<void> {
    const sel = this.selected();
    if (!sel) return;
    this.closePreview();
    await this.host.send({ type: 'act', heroId: sel.heroId, action, target, focus });
  }

  private targetLabel(t: ActionTarget): string {
    const s = this.state!;
    const d = s.delve!;
    const parts: string[] = [];
    if (t.id) {
      const name = this.heroDef(t.id)?.name ?? d.monsters.find((m) => m.id === t.id)?.name ?? d.rivals?.members.find((r) => r.id === t.id)?.name ?? (d.prisoner?.id === t.id ? d.prisoner.name : t.id);
      parts.push(name);
    }
    if (t.itemId) {
      const all: Item[] = [...d.heroes.flatMap((x) => x.pack), ...d.ground.flatMap((g) => g.items)];
      const it = all.find((i) => i.id === t.itemId);
      parts.unshift(it ? itemLabel(it) : 'item');
    }
    if (!t.id && t.at) {
      const lv = this.engine.castle().levels.find((l) => l.level === t.at!.level);
      const tile = lv?.tiles[hexKey(t.at)];
      const chest = d.chests.find((c) => samePos(c.at, t.at!));
      const g = d.ground.find((x) => samePos(x.at, t.at!));
      parts.push(chest ? 'Chest' : tile?.kind === 'door' ? 'Door' : g?.items.length ? g.items.map(itemLabel).join(', ') : (TILE_NAME[tile?.kind ?? 'floor'] ?? 'There'));
    }
    return parts.join(' → ') || 'Self';
  }

  // ------------------------------------------------------------ roll preview

  private openPreview(p: PreviewState): void {
    this.pv = p;
    this.lastPreview = p;
    this.renderPreview();
    this.drawHighlights();
    this.hideTip();
  }

  private closePreview(): void {
    this.pv = null;
    this.previewEl.classList.add('hidden');
  }

  private renderPreview(): void {
    const p = this.pv;
    if (!p) return;
    const el = this.previewEl;
    clear(el);
    const pr = p.preview;
    const sel = this.selected();
    const name = sel ? (this.heroDef(sel.heroId)?.name ?? '') : '';
    el.append(
      h(
        'div',
        { class: 'pv-head' },
        h('span', { class: 'pv-glyph' }, ACTION_GLYPH[p.option.action] ?? '•'),
        h('div', null, h('div', { class: 'kicker' }, `${name} · ${p.option.label}`), h('div', { class: 'pv-target' }, this.targetLabel(p.target))),
      ),
    );
    if (!pr.ok) {
      el.append(h('p', { class: 'pv-reason neg' }, pr.reason ?? 'Not possible.'), h('div', { class: 'pv-actions' }, h('button', { class: 'btn', onclick: () => this.cancel() }, 'Back ', h('kbd', null, 'Esc'))));
      el.classList.remove('hidden');
      return;
    }
    if (pr.warning) el.append(h('div', { class: `pv-warning ${pr.confirm ? 'severe' : ''}` }, h('span', { class: 'pv-warn-icon' }, '⚠'), h('span', null, pr.warning)));
    if (pr.slots > 0) {
      const odds = hitOdds(pr.slots, pr.chance, p.focus);
      const slots = h('div', { class: 'pv-slots' });
      for (let i = 0; i < pr.slots; i++) {
        const locked = i < p.focus;
        slots.append(h('div', { class: `slot ${locked ? 'locked' : ''}` }, h('span', { class: 'slot-mark' }, locked ? '◆' : ''), h('span', { class: 'slot-pct num' }, locked ? '100%' : `${pr.chance}%`)));
      }
      el.append(h('div', { class: 'pv-stat', title: `Each slot hits on its own at ${pr.chance}%. Focus turns a slot into a sure hit. The table below lists every number of hits with its odds.` }, h('span', { class: 'dim' }, `${pr.slots} slot${pr.slots > 1 ? 's' : ''} of ${STAT_NAME[pr.stat ?? 'might']}`), h('b', { class: 'num' }, ` ${pr.chance}% each`)));
      el.append(slots);
      if (pr.modifiers.length)
        el.append(
          h(
            'ul',
            { class: 'pv-mods' },
            ...pr.modifiers.map((m) => {
              const why = modifierHelp(m);
              return h('li', { class: /[−-]/.test(m) ? 'neg' : 'pos', title: why ? `${m}: ${why}` : m }, m, why ? h('span', { class: 'pv-why dim' }, ` · ${why}`) : '');
            }),
          ),
        );
      // Focus.
      const max = Math.min(pr.maxFocus, pr.slots);
      el.append(
        h(
          'div',
          { class: 'pv-focus', title: `Focus: each point locks one slot as a sure hit. ${FOCUS_MAX} per delve; spent Focus is gone.` },
          h('span', { class: 'kicker' }, 'Focus'),
          h('button', { class: 'btn btn-sq btn-small', 'aria-label': 'Less Focus', disabled: p.focus <= 0, onclick: () => this.setFocus(p.focus - 1) }, '−'),
          h('output', { class: 'num' }, `${p.focus}`),
          h('button', { class: 'btn btn-sq btn-small', 'aria-label': 'More Focus', disabled: p.focus >= max, onclick: () => this.setFocus(p.focus + 1) }, '+'),
          h('span', { class: 'dim small' }, `${sel?.focus ?? 0} left · locks a slot as a hit`),
        ),
      );
      // Outcomes with odds.
      const rows = pr.outcomes.map((text, hits) => {
        const pct = odds[hits] ?? 0;
        const fall = /fall|falls|pit|into the/i.test(text);
        return h('li', { class: `${pct < 0.0005 ? 'impossible' : ''} ${hits === pr.slots ? 'perfect' : ''} ${fall ? 'falls' : ''}` }, h('span', { class: 'oc-hits num' }, `${hits}`), h('span', { class: 'oc-bar' }, h('i', { style: `width:${Math.round(pct * 100)}%` })), h('span', { class: 'oc-pct num' }, `${Math.round(pct * 100)}%`), h('span', { class: 'oc-text' }, text));
      });
      el.append(h('div', { class: 'kicker pv-oc-head' }, 'Hits → outcome'), h('ol', { class: 'pv-outcomes' }, ...rows));
    } else {
      el.append(h('ul', { class: 'pv-outcomes plain' }, ...pr.outcomes.map((t) => h('li', { class: /fall/i.test(t) ? 'falls' : '' }, t))));
    }
    const foot: (HTMLElement | string)[] = [];
    foot.push(h('span', { class: pr.noise > 0 ? 'pv-noise loud' : 'pv-noise', title: pr.noise > 0 ? `Monsters within ${pr.noise} hexes (by path; a closed door counts 2) hear it and come to look. Sleepers wake.` : 'Nobody hears it.' }, pr.noise > 0 ? `Noise ${pr.noise}` : 'Silent'));
    if (pr.light) foot.push(h('span', { class: pr.light > 0 ? 'pos' : 'neg', title: `${pr.light > 0 ? '+' : ''}${pr.light} rounds of lantern light.` }, `Light ${pr.light > 0 ? '+' : ''}${pr.light}`));
    el.append(h('div', { class: 'pv-foot' }, ...foot));
    el.append(
      h(
        'div',
        { class: 'pv-actions' },
        h('button', { class: 'btn btn-ghost', onclick: () => this.cancel() }, 'Cancel ', h('kbd', null, 'Esc')),
        h('button', { class: `btn ${p.option.action === 'jump' ? 'btn-danger' : 'btn-primary'} pv-go`, onclick: () => this.confirmPreview() }, `${p.option.label} `, h('kbd', null, 'Enter')),
      ),
    );
    el.classList.remove('hidden');
  }

  private setFocus(n: number): void {
    if (!this.pv) return;
    const max = Math.min(this.pv.preview.maxFocus, this.pv.preview.slots);
    this.pv.focus = Math.max(0, Math.min(max, n));
    sfx.play('flip', { pitch: 1.2 });
    this.renderPreview();
  }

  private confirmPreview(): void {
    const p = this.pv;
    if (!p || !p.preview.ok) return;
    if (p.preview.confirm) {
      const sel = this.selected();
      const name = sel ? (this.heroDef(sel.heroId)?.name ?? '') : '';
      this.confirm(p.preview.warning ?? 'This is a long drop. Are you sure?', p.option.action === 'jump' ? 'Jump' : p.option.label, () => void this.act(p.option.action, p.target, p.focus), { title: p.option.action === 'jump' ? `${name} jumps?` : `${p.option.label}?`, cancel: 'Stay', danger: true });
      return;
    }
    void this.act(p.option.action, p.target, p.focus);
  }

  // ------------------------------------------------------------ roll animation

  /** Animate slots flipping one by one. Resolves when done. */
  async showRoll(e: Extract<GameEvent, { type: 'roll' }>, wait: (s: number) => Promise<void>, enemy: boolean): Promise<void> {
    const r: SlotRoll = e.roll;
    const el = this.rollEl;
    clear(el);
    el.className = `hud-roll ${enemy ? 'enemy' : ''}`;
    const who = this.nameOf(e.who);
    const boxes = r.results.map((_, i) => h('div', { class: `slot ${i < r.focus ? 'locked' : ''}` }, h('span', { class: 'slot-mark' }, i < r.focus ? '◆' : '?')));
    const result = h('div', { class: 'roll-result' });
    el.append(h('div', { class: 'kicker' }, `${who} · ${e.what}`), h('div', { class: 'roll-chance dim num' }, `${r.chance}% per slot`), h('div', { class: 'pv-slots' }, ...boxes), result);
    el.classList.remove('hidden');
    sfx.play('dice');
    await wait(0.12);
    for (let i = 0; i < r.results.length; i++) {
      const hit = r.results[i]!;
      const b = boxes[i]!;
      b.classList.add('flipped', hit ? 'hit' : 'miss');
      (b.firstChild as HTMLElement).textContent = hit ? '✔' : '✖';
      if (i >= r.focus) sfx.play('flip', { pitch: hit ? 1.25 : 0.8 });
      await wait(i < r.focus ? 0.05 : 0.16);
    }
    const outcome = !enemy && this.lastPreview && this.lastPreview.preview.outcomes[r.hits] ? this.lastPreview.preview.outcomes[r.hits] : '';
    result.append(h('b', { class: 'num' }, `${r.hits}/${r.slots} hit${r.slots > 1 ? 's' : ''}`), outcome ? h('span', null, ` · ${outcome}`) : '', r.perfect ? h('span', { class: 'perfect' }, ' PERFECT') : '');
    if (r.perfect && r.slots > 1) {
      sfx.play('perfect');
      el.classList.add('is-perfect');
      this.dio.clock.hitStop(this.host.settings.speed === 0 ? 0 : 200);
    }
    await wait(r.perfect ? 0.55 : 0.4);
  }

  hideRoll(): void {
    this.rollEl.classList.add('hidden');
  }

  nameOf(id: string): string {
    const s = this.state;
    const d = s?.delve;
    return this.heroDef(id)?.name ?? d?.monsters.find((m) => m.id === id)?.name ?? d?.rivals?.members.find((r) => r.id === id)?.name ?? (d?.prisoner?.id === id ? d.prisoner.name : undefined) ?? id;
  }

  // ------------------------------------------------------------ panels

  private renderTop(): void {
    const s = this.state!;
    const d = s.delve!;
    clear(this.topbar);
    const light = d.light;
    const b = this.engine.brightness(s);
    this.topbar.append(this.lightMeter(light, b));
    this.topbar.append(h('div', { class: 'hud-round', title: `Round ${d.round}.\nA round is your turn (each hero moves once and acts once), then the castle's turn: the lantern burns 1 if open, torches burn, monsters act. End turn (E) starts the castle's turn.` }, h('span', { class: 'kicker' }, 'Round'), h('b', { class: 'num' }, `${d.round}`)));
    this.topbar.append(this.goalBox());
    const levels = h('div', { class: 'hud-levels' });
    for (const lv of this.engine.castle().levels) {
      const here = d.heroes.some((x) => x.status === 'active' && x.at.level === lv.level);
      levels.append(
        h(
          'button',
          {
            class: `btn btn-small level-btn ${lv.level === this.dio.shownLevel ? 'on' : ''} ${here ? 'occupied' : ''}`,
            title: `Level ${lv.level} · ${lv.name}${here ? ' · heroes here' : ''}\nShow this level. Heroes on other levels keep their place.`,
            onclick: () => {
              this.dio.showLevel(lv.level);
              this.refresh();
            },
          },
          `L${lv.level}`,
        ),
      );
    }
    this.topbar.append(levels);
    this.topbar.append(
      h(
        'div',
        { class: 'hud-sys' },
        h('button', { class: 'btn btn-small btn-sq', title: sfx.muted ? 'Sound is off. Click to turn it on.' : 'Sound is on. Click to mute.', onclick: () => this.toggleMute() }, sfx.muted ? '🔇' : '🔊'),
        h('button', { class: 'btn btn-small', title: 'Menu: playback speed, settings, keys, abandon the delve', onclick: () => this.toggleMenu() }, 'Menu'),
      ),
    );
  }

  updateLight(light: number, b: Brightness): void {
    const old = this.topbar.querySelector('.light');
    if (old) old.replaceWith(this.lightMeter(light, b));
  }

  private scale: LightScale | null = null;
  private scaleDelve = -1;

  /** Stage edges from engine.brightness; the max is the highest light seen this delve (light only falls, Kindle caps at max). */
  private lightScale(): LightScale {
    const s = this.state!;
    const delve = s.campaign.delveCount;
    if (this.scale && this.scaleDelve === delve) return this.scale;
    const probe = (l: number) => this.engine.brightness({ ...s, delve: { ...s.delve!, light: l } });
    let seen = 1;
    try {
      const saved = JSON.parse(localStorage.getItem('vc.lightmax.v3') ?? 'null') as { delve: number; max: number } | null;
      if (saved && saved.delve === delve) seen = saved.max;
    } catch {
      /* ignore */
    }
    this.scale = lightScale(probe, Math.max(s.delve?.light ?? 0, seen));
    this.scaleDelve = delve;
    return this.scale;
  }

  /** 16.2: is the lantern open (burning and lighting)? Old saves without the flag count as open. */
  private lanternOpen(): boolean {
    return this.state?.delve?.lanternOpen !== false;
  }

  /** 16.2: toggle the shutter for the bearer (free; any time in the player phase). */
  toggleShutter(): void {
    const d = this.state?.delve;
    if (!d || this.busy || d.phase !== 'player') return;
    const bearer = d.heroes.find((x) => x.heroId === d.lanternBearer);
    if (!bearer || bearer.status !== 'active') {
      this.toast('Nobody holds the lantern.');
      return;
    }
    sfx.play('click', { pitch: this.lanternOpen() ? 0.8 : 1.2 });
    this.cancel();
    void this.host.send({ type: 'act', heroId: bearer.heroId, action: 'shutter', target: {}, focus: 0 });
  }

  private lightMeter(light: number, b: Brightness): HTMLElement {
    const sc = this.lightScale();
    if (light > sc.max) sc.max = light;
    try {
      localStorage.setItem('vc.lightmax.v3', JSON.stringify({ delve: this.scaleDelve, max: sc.max }));
    } catch {
      /* ignore */
    }
    const open = this.lanternOpen();
    const next = roundsToNext(light, sc);
    const pct = Math.min(100, (light / sc.max) * 100);
    const at = (v: number) => `left:${Math.min(100, (v / sc.max) * 100)}%`;
    const d = this.state?.delve;
    const onL1 = !!d && d.heroes.some((x) => x.status === 'active' && x.at.level === 1);
    // Level 1 is mostly daylit: say so in the first rounds while the lantern is open (in the "next" slot, so the meter keeps its height).
    const daylight = open && onL1 && !!d && d.round <= 10;
    const toggle = h(
      'button',
      {
        class: `btn btn-small light-toggle ${open ? 'open' : 'shut'}`,
        title: open ? 'Shutter the lantern (L): burns no oil, gives no light. Free.' : 'Open the lantern (L): light and burn oil again. Free.',
        onclick: (e: Event) => {
          e.stopPropagation();
          this.toggleShutter();
        },
        disabled: this.busy || d?.phase !== 'player',
      },
      open ? 'Shutter' : 'Open',
      h('kbd', null, 'L'),
    );
    return h(
      'div',
      { class: `light light-${b} ${open ? '' : 'light-shut'}`, title: this.lightTip(light, sc, open) },
      h('div', { class: 'light-head' }, h('span', { class: 'kicker' }, 'Lantern'), h('b', { class: 'light-stage' }, open ? BRIGHTNESS_NAME[b] : 'Shuttered'), h('span', { class: 'light-num num', title: `${light} rounds of light left in the lantern (it holds ${LIGHT_MAX}).` }, `${light}`)),
      h('div', { class: 'light-track' }, h('div', { class: 'light-fill', style: `width:${pct}%` }), h('i', { class: 'mark', style: at(sc.min.dim) }), h('i', { class: 'mark', style: at(sc.min.bright) })),
      h(
        'div',
        { class: 'light-foot' },
        h('span', { class: `light-state ${open ? 'open' : 'shut'}`, title: open ? 'Open: the lantern lights the bearer\'s surroundings and burns 1 per round.' : 'Shuttered: no light from the lantern, and it burns nothing.' }, open ? 'Open · burning' : 'Shuttered · not burning'),
        toggle,
      ),
      h(
        'div',
        { class: 'light-sub' },
        daylight
          ? h('span', { class: 'light-next light-hint small', title: 'Most of the Ruined Keep is daylit. A shuttered lantern burns no oil; open it when it gets dark.' }, 'Daylight here: shutter to save oil')
          : h('span', { class: 'light-next dim small', title: open ? 'When the light drops to the next stage at 1 per round.' : 'Light kept in the shuttered lantern.' }, open ? (light > 0 ? `${next.rounds} round${next.rounds === 1 ? '' : 's'} to ${BRIGHTNESS_NAME[next.stage]}` : 'Pitch black') : `${light} oil kept`),
      ),
    );
  }

  /** The light panel explained: stages with their numbers, sight, shutter, daylight (spec 16.2). */
  private lightTip(light: number, sc: LightScale, open: boolean): string {
    const st = (b: Brightness, range: string) => `${BRIGHTNESS_NAME[b]} ${range}: lantern lights ${LANTERN_RADIUS[b]} around the bearer, sight ${SIGHT_BY_STAGE[b]}${b === 'bright' ? '' : `, rolls ${b === 'dim' ? '−10%' : b === 'dark' ? '−20%' : '−30%'}`}`;
    return [
      `Lantern · ${light} rounds of light left. Burns 1 per round while open.`,
      st('bright', `${sc.min.bright}+`),
      st('dim', `${sc.min.dim}–${sc.min.bright - 1}`),
      st('dark', `1–${sc.min.dim - 1}`),
      `Pitch black at 0: no lantern light; lit braziers and torches still shine.`,
      `Sight is 1 less on Level 2, 2 less on Level 3 (never below 2). A hero standing unlit sees ${DARK_SIGHT[1]} / ${DARK_SIGHT[2]} / ${DARK_SIGHT[3]} on Levels 1 / 2 / 3.`,
      `Shutter (L, free): ${open ? 'no light and no burn until you open it again' : 'it is shuttered now: no light, no burn'}. Daylight on Level 1 lets you save oil.`,
      `Refill: Kindle +${KINDLE_LIGHT}, oil flask +${OIL_LIGHT}, light a brazier +${BRAZIER_LIGHT}. In the Hollow the dark itself hunts anyone standing unlit.`,
    ].join('\n');
  }

  private goalBox(): HTMLElement {
    const s = this.state!;
    const d = s.delve!;
    const k = d.contract;
    let status = '';
    if (k.kind === 'rescue') {
      const p = d.prisoner;
      status = !p ? '' : p.dead ? 'The prisoner is dead.' : p.out ? 'Out. Done.' : p.freed ? `Freed. Escort ${p.name} to an exit.` : `Find and free ${p.name}.`;
    } else if (k.kind === 'slay') {
      const dragon = d.monsters.find((m) => m.kind === 'dragon');
      status = !dragon || dragon.hp <= 0 ? 'The Dragon is dead. Get out alive.' : `The Dragon: ${dragon.hp}/${dragon.maxHp} HP${dragon.awareness === 'asleep' ? ', asleep' : ''}.`;
    } else {
      const carrier = d.heroes.find((x) => x.pack.some((i) => i.kind === 'heirloom'));
      const rival = d.rivals?.members.find((r) => r.loot.some((i) => i.kind === 'heirloom'));
      status = carrier ? `${this.heroDef(carrier.heroId)?.name ?? ''} carries it. Get out.` : rival ? `${d.rivals?.name ?? 'A rival crew'} have it!` : 'Find it and carry it out.';
    }
    // 19.5: the prize is in hand: the goal is the way out now.
    const go = prizeInHand(d);
    // 15.7: where it is. Before its hex is explored, only the brief's room; after, level + room + a click to pan there.
    const obj = this.dio.objectiveAt();
    let where: HTMLElement | string = '';
    if (go) {
      const sel = this.selected() ?? d.heroes.find((x) => x.status === 'active');
      const from = sel?.at;
      const near = from ? nearestExit(this.engine.castle(), from, (p) => this.exitKnown(p), this.host.entrance()) : null;
      where = near
        ? h(
            'button',
            { class: 'goal-where goal-out', title: `Look there: ${near.exit.name}${near.exit.entrance ? ' (you came in here)' : ''}`, 'data-exit': posKey(near.exit.at), onclick: () => this.dio.lookAt(near.exit.at) },
            h('span', { class: 'goal-diamond' }, '⇱'),
            ` Get out: nearest way out is ${exitWhere(near, from!)}`,
          )
        : h('span', { class: 'goal-where goal-out' }, h('span', { class: 'goal-diamond' }, '⇱'), ' Get out: find a way out');
      status = k.kind === 'rescue' ? status : k.kind === 'slay' ? 'The Dragon is dead.' : status.replace(/ Get out\.$/, '');
    } else if (obj) {
      const lv = this.engine.castle().levels.find((l) => l.level === obj.at.level);
      const room = lv?.rooms.find((r) => r.id === lv.tiles[hexKey(obj.at)]?.room)?.name;
      const seen = this.vis?.visible.has(posKey(obj.at)) ? 'in sight' : 'seen';
      where = h(
        'button',
        { class: `goal-where goal-${obj.kind}`, title: 'Look there', onclick: () => this.dio.lookAt(obj.at) },
        h('span', { class: 'goal-diamond' }, '◆'),
        ` ${obj.label} · Level ${obj.at.level}${room ? `, ${room.startsWith('the ') || room.startsWith('The ') ? room : `the ${room}`}` : ''} · ${seen}`,
      );
    } else if (!status.startsWith('Out') && !/carries it|is dead|Get out/.test(status)) where = h('span', { class: 'dim small goal-brief' }, k.brief);
    return h('div', { class: `hud-goal goal-kind-${k.kind} ${go ? 'goal-go' : ''}` }, h('span', { class: 'kicker' }, `${k.kind === 'rescue' ? 'Rescue' : k.kind === 'slay' ? 'Slay' : 'Recover'} · ${k.bounty} gold`), h('b', null, k.title), where, h('span', { class: 'dim small goal-status' }, status));
  }

  private renderCards(): void {
    const s = this.state!;
    const d = s.delve!;
    clear(this.cards);
    const edges: Pos[] = [];
    const darks: string[] = [];
    d.heroes.forEach((hd, i) => {
      const risk = hd.status === 'active' ? this.engine.edgeRisk(s, hd.heroId) : null;
      if (risk) edges.push(hd.at);
      const def = this.heroDef(hd.heroId);
      if (!def) return;
      const sel = hd.heroId === this.selectedId;
      const active = hd.status === 'active';
      const done = active && hd.moved && hd.acted;
      const dark = active && !this.isLit(hd.heroId);
      if (dark) darks.push(hd.heroId);
      const word = def.cls === 'heir' ? 'Heir' : className(def.cls);
      const role = CLASS_ROLE[def.cls as keyof typeof CLASS_ROLE] ?? '';
      const manaMax = CLASSES[def.cls]?.mana ?? 0;
      const card = h(
        'button',
        {
          class: `hcard cls-${def.cls} st-${hd.status} ${sel ? 'sel' : ''} ${done ? 'done' : ''} ${dark ? 'dark' : ''}`,
          onclick: () => this.select(hd.heroId),
          disabled: !active,
          'data-hero': hd.heroId,
        },
        h('div', { class: 'hc-badge', title: `${def.name} · ${word}, level ${def.level}\n${role}\nClick the card or press ${i + 1} to select.` }, h('span', null, classGlyph(def.cls)), h('kbd', null, `${i + 1}`)),
        h(
          'div',
          { class: 'hc-body' },
          h('div', { class: 'hc-name' }, h('b', { class: 'hc-nm' }, def.name), h('span', { class: 'hc-cls', title: `${word} · level ${def.level}\n${role}` }, `${word} L${def.level}`), this.turnMarks(hd)),
          h(
            'div',
            { class: 'hc-hp', title: `HP ${hd.hp} of ${def.maxHp}\nAt 0 a hero is downed and bleeds out unless someone next to them revives them or gives a potion.` },
            h('span', { class: 'hc-lab' }, 'HP'),
            hpBar(hd.hp, def.maxHp),
            h('span', { class: 'num hc-hpn' }, `${hd.hp}/${def.maxHp}`),
          ),
          h(
            'div',
            { class: 'hc-row' },
            h('span', { class: 'hc-res hc-focus', title: `Focus ${hd.focus} of ${FOCUS_MAX}\nIn a roll preview, spend Focus to turn slots into sure hits. ${FOCUS_MAX} per delve; Keven's Rally gives 1 back.${hd.ale === 'reserve' ? "\nHobart's Reserve: this hero's Focus is 4 for this delve." : hd.ale === 'heavyhead' ? '\nHeavy head: Focus started at 1.' : ''}` }, h('span', { class: 'hc-lab' }, 'Focus'), pips(hd.focus, hd.ale === 'reserve' ? 4 : FOCUS_MAX, 'focus')),
            manaMax > 0 ? h('span', { class: 'hc-res hc-mana', title: `Mana ${hd.mana} of ${manaMax}\nPays for spells: Fireball 2, every other spell 1. ${manaMax} per delve, no refills inside.` }, h('span', { class: 'hc-lab' }, 'Mana'), pips(hd.mana, manaMax, 'mana')) : '',
          ),
          packRow(hd.pack),
          h('div', { class: 'hc-status' }, ...this.statusChips(hd, def.name, risk, dark ? this.sightOf(hd.heroId) : null)),
        ),
      );
      this.cards.append(card);
    });
    this.dio.showEdgeLips(edges);
    this.dio.setDarkHeroes(darks);
    this.renderGloam(darks);
    this.applyDark();
  }

  /** Turn state on a card: Move and Act marks, or the hero's fate when off the board. */
  private turnMarks(hd: HeroInDelve): HTMLElement {
    if (hd.status === 'downed') return h('span', { class: 'hc-fate bad', title: `Downed: bleeding out, dies after ${hd.bleed} more castle turn${hd.bleed === 1 ? '' : 's'}.\nA hero next to them can Revive (up with 3 HP) or give a Potion (up with 5).` }, `Downed · ${hd.bleed}`);
    if (hd.status === 'dead') return h('span', { class: 'hc-fate dead', title: 'Dead. Gone for good.' }, 'Dead');
    if (hd.status === 'out') return h('span', { class: 'hc-fate good', title: 'Out of the castle: safe, with everything in the pack.' }, 'Out');
    const held = !!hd.grabbedBy;
    const mv = held ? 'Held: can\'t move' : hd.webbed ? 'Webbed: can\'t move' : hd.moved ? 'Moved this round' : 'Move ready';
    const ac = hd.dashed ? 'Dashed: the action went on a second move' : hd.acted ? 'Acted this round' : 'Action ready';
    return h(
      'span',
      { class: 'hc-turn', title: `${mv} · ${ac}\nEach round a hero may move once and act once, in either order. A hero who has moved can spend the action on a second move (a dash).` },
      h('i', { class: `tp ${hd.moved || held || hd.webbed ? 'used' : ''}` }, 'Move'),
      h('i', { class: `tp ${hd.acted ? 'used' : ''}` }, 'Act'),
    );
  }

  /** Status badges, each with what it means and what to do about it (15.7). */
  private statusChips(hd: HeroInDelve, name: string, risk: { levels: number; damage: number; levelName: string } | null, darkSight: number | null): HTMLElement[] {
    const d = this.state!.delve!;
    const out: HTMLElement[] = [];
    const chip = (cls: string, text: string, tip: string) => out.push(h('span', { class: `chip ${cls}`, title: tip }, text));
    if (hd.heroId === d.lanternBearer && hd.status === 'active') {
      const open = this.lanternOpen();
      chip(`lantern ${open ? '' : 'shut'}`, open ? '◆ Lantern' : '◇ Lantern', `${name} carries the lantern${open ? '' : ' (shuttered)'}.\nIts light goes where ${name} goes. Shutter or open it with L (free); Pass lantern hands it to a hero next to you.`);
    }
    if (hd.status === 'active' && darkSight !== null) {
      if (hd.nightEyes && hd.nightEyes > 0) chip('dark', 'In the dark · night-eye', `${name} stands outside all light, but the night-eye draught keeps sight (${darkSight}) and rolls whole.${hd.at.level === 3 ? '\nIn the Hollow the dark itself still hunts anyone standing unlit.' : `\nMonsters still notice an unlit hero only within ${MONSTER_DARK_SIGHT}.`}`);
      else chip('dark', `In the dark · sight ${darkSight}`, `${name} stands outside all light: sees only ${darkSight} hex${darkSight === 1 ? '' : 'es'}, and rolls at −20% or worse.${hd.at.level === 3 ? '\nIn the Hollow the dark itself hunts anyone standing unlit.' : `\nMonsters notice an unlit hero only within ${MONSTER_DARK_SIGHT}.`}\nStep into the lantern's light, a brazier's or a torch's.`);
    }
    if (hd.grabbedBy) {
      const by = d.monsters.find((m) => m.id === hd.grabbedBy)?.name ?? 'a ghoul';
      chip('bad grab', '⛓ Held', `Held by ${by}: can't move or dash.\nBreak free (2 Might slots, 1 hit frees you) or kill it.`);
    }
    if (risk) chip('edge', `Edge · ${risk.damage}`, `On the edge: a shove would drop ${name} ${risk.levels === 1 ? '1 level' : `${risk.levels} levels`} into ${risk.levelName} (${risk.damage} damage).\nStep away from the drop, or kill whatever could shove.`);
    if (hd.webbed) chip('bad', 'Webbed', 'Stuck in a web: can\'t move this turn, can still act. It clears next round.');
    if (hd.veil > 0) chip('veil', `Veiled · ${hd.veil}`, `Veiled for ${hd.veil} more round${hd.veil === 1 ? '' : 's'}: monsters can't see ${name}.\nAttacking or making noise ${VEIL_BREAK_NOISE}+ breaks it.`);
    if (hd.ward > 0) chip('ward', `Warded · ${hd.ward}`, `Warded for ${hd.ward} more round${hd.ward === 1 ? '' : 's'}: takes 1 less damage per hit.`);
    if (hd.overwatch) chip('ow', 'Overwatch', `On overwatch: in the castle's turn, shoots the first enemy that moves or acts in sight within ${OVERWATCH_RANGE}.`);
    if (hd.nightEyes && hd.nightEyes > 0) chip('night', `◉ Night-eye · ${hd.nightEyes}`, `Night-eye draught: ${hd.nightEyes} more round${hd.nightEyes === 1 ? '' : 's'} without dark penalties to ${name}'s sight or rolls.\nThe dark still hides ${name} from nothing, and the Gloam still comes.`);
    if (hd.torch > 0) chip('warm', `Torch · ${hd.torch}`, `Torch lit: light around ${name} (radius 2) for ${hd.torch} more round${hd.torch === 1 ? '' : 's'}, whatever the lantern does.`);
    if (hd.guarding) chip('', 'Guarding', `Guarding ${this.nameOf(hd.guarding)}: until your next turn, attacks aimed at them hit ${name} instead.`);
    if (hd.escorting) chip('good', 'Escorting', `Escorting ${this.nameOf(hd.escorting)}: they follow ${name}, who moves 3 at most.\nReach an exit to bring them out.`);
    if (hd.rallyCooldown > 0) chip('', `Rally in ${hd.rallyCooldown}`, `Rally is ready again in ${hd.rallyCooldown} round${hd.rallyCooldown === 1 ? '' : 's'}.`);
    if (hd.ale) {
      const a = ALE_EFFECT[hd.ale];
      const spent = hd.ale === 'featherfoot' && hd.aleSpent;
      chip(`ale ${a.bad ? 'bad-ale' : ''} ${spent ? 'used' : ''}`, `${a.glyph} ${a.name}${spent ? ' · used' : ''}`, `${a.name} · ${a.bad ? 'a bad pull from the Black Cask' : 'ale from the Gilded Flagon'}, for this delve\n${a.text}${spent ? '\nUsed: the free fall is spent.' : ''}`);
    }
    if (hd.revived && hd.status === 'active') chip('', 'Revived', 'Was downed and got back up: comes home wounded and sits out the next contract.');
    return out;
  }

  /** 16.2: the Gloam line shows while it is up and a hero on Level 3 stands unlit. */
  private renderGloam(darks: string[]): void {
    const d = this.state?.delve;
    const gloam = !!d && d.monsters.some((m) => m.kind === 'gloam' && m.hp > 0);
    const unlitL3 = !!d && darks.some((id) => d.heroes.find((x) => x.heroId === id)?.at.level === 3);
    this.gloamEl.classList.toggle('hidden', !(gloam && unlitL3));
  }

  private renderBar(): void {
    const s = this.state;
    const d = s?.delve;
    clear(this.bar);
    if (!s || !d) return;
    const sel = this.selected();
    const def = sel ? this.heroDef(sel.heroId) : undefined;
    const left = h('div', { class: 'bar-who' });
    if (sel && def) {
      const held = sel.grabbedBy ? d.monsters.find((m) => m.id === sel.grabbedBy) : undefined;
      left.append(
        h('b', null, def.name),
        h('span', { class: 'dim small' }, ` ${className(def.cls)}`),
        h('div', { class: 'small bar-turn' }, h('span', { class: sel.moved || sel.grabbedBy ? 'used' : 'ready' }, sel.grabbedBy ? 'Held' : sel.moved ? 'Moved' : 'Move ready'), ' · ', h('span', { class: sel.acted ? 'used' : 'ready' }, sel.dashed ? 'Dashed' : sel.acted ? 'Acted' : 'Action ready'), this.reach.some((r) => r.dash) ? h('span', { class: 'dash-note', title: 'Moving again spends the action (a dash)' }, ' · Dash ready') : ''),
        sel.grabbedBy ? h('div', { class: 'small bar-held neg' }, `⛓ Held by ${held?.name ?? 'a ghoul'}: Escape or kill it.`) : '',
      );
    }
    // Move group: walk/sneak, and the stairs or lift under the hero (15.7).
    const usedKeys = new Set<string>(['s', 'e', 'c']);
    const link = this.linkHere();
    const modes = h(
      'div',
      { class: 'bar-modes' },
      h('button', { class: `btn btn-small ${!this.sneak ? 'on' : ''}`, onclick: () => this.setSneak(false), disabled: this.busy, title: 'Walk: up to 4 hexes, noise 1 where you stop. Click a blue hex to move.\nAfter moving, a second move (a dash) spends the action.' }, 'Walk'),
      h('button', { class: `btn btn-small ${this.sneak ? 'on' : ''}`, onclick: () => this.setSneak(true), disabled: this.busy, title: 'Sneak (S): up to 2 hexes (Burglar 4), silent. Sleeping monsters stay asleep.' }, 'Sneak ', h('kbd', null, 'S')),
    );
    const move = h('div', { class: 'bar-group' }, h('span', { class: 'bar-group-name' }, 'Move'), modes);
    if (link) {
      usedKeys.add('t');
      const l = link.info;
      move.append(
        h(
          'button',
          { class: `act act-link ${link.reach.dash ? 'dash' : ''}`, onclick: () => this.takeLink(), disabled: this.busy, 'data-key': 't', 'data-action': 'link', title: `${linkButton(l)}: 1 movement${link.reach.dash ? ' as a dash (uses the action)' : ''}. ${l.kind === 'lift' ? 'The lift' : 'The stairs'} come out on Level ${l.to.level}.` },
          h('span', { class: 'act-glyph' }, l.down ? '⇓' : '⇑'),
          h('span', { class: 'act-label' }, linkButton(l)),
          h('kbd', null, 'T'),
          link.reach.dash ? h('span', { class: 'act-count' }, 'dash') : '',
        ),
      );
    }
    // 19.5: standing on an exit: the one prominent thing is "Leave the castle" (hotkey Q).
    const exit = this.exitHere();
    if (exit?.option) {
      usedKeys.add('q');
      const o = exit.option;
      move.append(
        h(
          'button',
          {
            class: `act act-leave ${o.blocked ? 'blocked' : ''}`,
            onclick: () => this.leaveHere(),
            disabled: this.busy,
            'data-key': 'q',
            'data-action': 'leave',
            'aria-disabled': o.blocked ? 'true' : 'false',
            title: `Leave the castle by ${exit.info.name} · free · key Q${o.blocked ? `\nCan't now: ${o.blocked}` : ''}\n${ACTION_HELP.leave}`,
          },
          h('span', { class: 'act-glyph' }, '⇱'),
          h('span', { class: 'act-label' }, 'Leave the castle'),
          h('kbd', null, 'Q'),
          o.blocked ? h('span', { class: 'act-why' }, o.blocked) : h('span', { class: 'act-count' }, 'free'),
        ),
      );
    }
    const groupEls: HTMLElement[] = [move];
    // 16.2: the lantern bearer gets a Lantern group with the free shutter toggle (hotkey L, wins over Light/Oil's L).
    if (sel && sel.heroId === d.lanternBearer) {
      usedKeys.add('l');
      const open = this.lanternOpen();
      groupEls.push(
        h(
          'div',
          { class: 'bar-group bar-group-lantern' },
          h('span', { class: 'bar-group-name' }, 'Lantern'),
          h(
            'button',
            { class: `act act-shutter ${open ? 'open' : 'shut'}`, onclick: () => this.toggleShutter(), disabled: this.busy, 'data-key': 'l', 'data-action': 'shutter', title: `${open ? 'Shutter the lantern' : 'Open the lantern'} · free · key L\n${ACTION_HELP.shutter}` },
            h('span', { class: 'act-glyph' }, open ? '◑' : '◐'),
            h('span', { class: 'act-label' }, open ? 'Shutter' : 'Open'),
            h('kbd', null, 'L'),
            h('span', { class: 'act-count' }, 'free'),
          ),
        ),
      );
    }
    // The rest, grouped: Interact · Abilities · Items.
    const groups: Record<'interact' | 'ability' | 'item', ActionOption[]> = { interact: [], ability: [], item: [] };
    const opts = [...this.options];
    // 18.6: deals are free, so the card is offered whenever deals() lists any, even after the action is spent.
    if (sel && !opts.some((o) => o.action === 'parley') && this.dealsFor(sel.heroId).length) opts.push({ action: 'parley', label: 'Parley', targets: [{}], rolls: false, pick: 'self' });
    for (const o of opts) {
      if (o.action === 'shutter') continue;
      if (o.action === 'leave' && exit?.option) continue;
      groups[ITEM_ACTIONS.has(o.action) ? 'item' : SPELLS.has(o.action) || ABILITIES.has(o.action) ? 'ability' : 'interact'].push(o);
    }
    for (const [name, list] of [
      ['Interact', groups.interact],
      ['Abilities', groups.ability],
      ['Items', groups.item],
    ] as const) {
      if (!list.length) continue;
      const acts = h('div', { class: 'bar-actions' });
      for (const o of list) {
        let key = ACTION_KEY[o.action];
        if (key && usedKeys.has(key)) key = undefined;
        if (key) usedKeys.add(key);
        const btn = h(
          'button',
          {
            class: `act ${this.pending === o ? 'on' : ''} ${o.rolls ? 'rolls' : ''} ${o.blocked ? 'blocked' : ''} ${ITEM_ACTIONS.has(o.action) ? 'act-item' : SPELLS.has(o.action) ? 'act-spell' : o.action === 'escape' ? 'act-escape' : ''}`,
            onclick: () => this.startAction(o),
            disabled: this.busy,
            'data-key': key ?? '',
            'data-action': o.action,
            'aria-disabled': o.blocked ? 'true' : 'false',
            title: `${o.label} · ${actionCost(o.action, o.mana, o.rolls)}${key ? ` · key ${key.toUpperCase()}` : ''}${o.blocked ? `\nCan't now: ${o.blocked}` : o.targets.length > 1 ? ` · ${o.targets.length} targets` : ''}\n${actionHelp(o.action, def?.cls)}`,
          },
          h('span', { class: 'act-glyph' }, ACTION_GLYPH[o.action] ?? '•'),
          h('span', { class: 'act-label' }, o.label),
          key ? h('kbd', null, key.toUpperCase()) : '',
          o.targets.length > 1 ? h('span', { class: 'act-count num' }, `${o.targets.length}`) : '',
          o.mana ? h('span', { class: 'act-mana num' }, `${o.mana}`) : '',
          o.blocked ? h('span', { class: 'act-why' }, o.blocked) : '',
        );
        acts.append(btn);
      }
      groupEls.push(h('div', { class: `bar-group bar-group-${name.toLowerCase()}` }, h('span', { class: 'bar-group-name' }, name), acts));
    }
    if (!opts.some((o) => o.action !== 'shutter' && o.action !== 'leave') && !link && !exit?.option && sel && !this.busy) groupEls.push(h('div', { class: 'bar-group' }, h('span', { class: 'bar-group-name' }, 'Interact'), h('span', { class: 'dim small bar-empty' }, sel.acted ? 'Action used this round.' : 'Nothing in reach. Move closer to something.')));
    // End turn: how many heroes still have a move or an action.
    const waiting = d.heroes.filter((x) => x.status === 'active' && (!x.moved || !x.acted)).length;
    const end = h(
      'button',
      { class: `btn btn-primary bar-end ${waiting === 0 ? 'pulse' : ''}`, onclick: () => this.endTurn(), disabled: this.busy, title: `End turn (E): the castle takes its turn: the lantern burns 1 if open, monsters do what their marks say.\n${waiting ? `${waiting} hero${waiting === 1 ? '' : 'es'} still ha${waiting === 1 ? 's' : 've'} a move or an action.` : 'Everyone is spent.'}` },
      h('span', null, 'End turn ', h('kbd', null, 'E')),
      h('span', { class: `bar-end-note ${waiting ? 'waiting' : ''}` }, waiting ? `${waiting} still waiting` : 'all spent'),
    );
    this.bar.append(left, ...groupEls, end);
    this.hint.replaceChildren(...this.contextHint());
    this.hint.classList.toggle('hidden', !this.hint.childNodes.length || this.busy);
    // The bar grows when a group stacks; keep the hint just above it (V3.6).
    const barH = this.bar.offsetHeight;
    if (barH) this.hint.style.bottom = `${barH + 22}px`;
  }

  /**
   * 15.7: one line under the bar naming what's near the selected hero, explored hexes only
   * ("Stairs here · Chest 2 hexes north").
   */
  private contextHint(): (HTMLElement | string)[] {
    const s = this.state;
    const d = s?.delve;
    const sel = this.selected();
    if (!s || !d || !sel || !this.vis) return [];
    const castle = this.engine.castle();
    const lv = castle.levels.find((l) => l.level === sel.at.level);
    if (!lv) return [];
    const found: { text: string; dist: number; at: Pos; danger?: boolean }[] = [];
    const seen = (p: Pos) => this.vis!.explored.has(posKey(p)) || this.vis!.visible.has(posKey(p));
    const lead: HTMLElement[] = [];
    // 16.2: standing in the dark: say so, with the hero's own sight range.
    if (!this.isLit(sel.heroId)) {
      const sight = this.sightOf(sel.heroId);
      lead.push(h('span', { class: 'hint-dark', title: sel.at.level === 3 ? 'In the Hollow the dark itself hunts anyone standing unlit.' : 'Monsters see you only within 3 while you stand unlit; you see less too.' }, h('b', null, 'In the dark'), sight !== null ? `: sight ${sight}` : ''));
    }
    const R = 4;
    for (let dq = -R; dq <= R; dq++)
      for (let dr = Math.max(-R, -dq - R); dr <= Math.min(R, -dq + R); dr++) {
        const p = { level: sel.at.level, q: sel.at.q + dq, r: sel.at.r + dr };
        const t = lv.tiles[hexKey(p)];
        if (!t || !seen(p)) continue;
        const dist = (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
        const k = posKey(p);
        let text = '';
        if (t.kind === 'stairs' || t.kind === 'lift') {
          const l = linkAt(castle, p);
          text = l ? `${l.kind === 'lift' ? 'Lift' : 'Stairs'} ${l.down ? '↓' : '↑'} L${l.to.level}${l.kind === 'lift' && !d.liftWorking ? ' (dead)' : ''}` : '';
        } else if (t.kind === 'exit') {
          const e = exitAt(castle, p, this.host.entrance());
          text = e?.entrance ? 'Way out (you came in here)' : 'Way out';
        }
        else if (t.kind === 'brazier' && !d.lit.includes(k)) text = 'Cold brazier';
        else if (t.prop === 'winch' && !d.liftWorking) text = 'Winch';
        else if (t.kind === 'door' && d.doors[k] && !d.doors[k]!.open) text = d.doors[k]!.locked ? 'Locked door' : 'Door';
        else if (t.kind === 'cracked') text = 'Cracked wall';
        const chest = d.chests.find((c) => samePos(c.at, p) && !c.opened);
        if (chest) text = chest.locked ? 'Locked chest' : 'Chest';
        const g = d.ground.find((x) => samePos(x.at, p) && x.items.length);
        if (g) text = g.items.some((i) => i.contractId === d.contract.id) ? 'The objective' : 'Loot';
        if (d.prisoner && !d.prisoner.freed && samePos(d.prisoner.at, p)) text = d.prisoner.name;
        if (d.traps[k]?.spotted) text = 'Trap';
        if (text) found.push({ text, dist, at: p, danger: text === 'Trap' });
      }
    found.sort((a, b) => a.dist - b.dist);
    // 19.5: with the prize in hand, the nearest known exit leads, however far.
    if (prizeInHand(d) && !found.some((f) => f.text.startsWith('Way out'))) {
      const near = nearestExit(castle, sel.at, (p) => this.exitKnown(p), this.host.entrance());
      if (near && near.dist !== null) found.unshift({ text: 'Way out', dist: near.dist, at: near.exit.at });
    }
    const out: (HTMLElement | string)[] = [...lead];
    for (const f of found.slice(0, 4)) {
      const where = f.dist === 0 ? 'here' : f.dist === 1 ? 'next to you' : `${f.dist} hexes ${compass(sel.at, f.at)}`;
      if (out.length) out.push(h('span', { class: 'hint-sep' }, ' · '));
      out.push(h('button', { class: `hint-item ${f.danger ? 'neg' : ''}`, title: 'Look there', onclick: () => this.dio.lookAt(f.at) }, h('b', null, f.text), ` ${where}`));
    }
    return out;
  }

  private renderLog(): void {
    const d = this.state?.delve;
    clear(this.logEl);
    const lines = (d?.log ?? []).slice(-7);
    for (const l of lines) this.logEl.append(h('div', { class: 'log-line' }, l));
    for (const l of this.liveLog) this.logEl.append(h('div', { class: `log-line ${l.cls}` }, l.text));
    this.logEl.classList.toggle('hidden', !this.logEl.children.length);
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  log(text: string, cls = ''): void {
    this.liveLog.push({ text, cls });
    this.logEl.classList.remove('hidden');
    this.logEl.append(h('div', { class: `log-line fresh ${cls}` }, text));
    while (this.logEl.children.length > 9) this.logEl.firstChild?.remove();
  }

  private renderRivals(): void {
    const r = this.state?.delve?.rivals;
    const d = this.state?.delve;
    if (!r || !d || !r.spotted || d.round < r.entersRound) {
      this.rivalEl.classList.add('hidden');
      return;
    }
    clear(this.rivalEl);
    const alive = r.members.filter((m) => m.hp > 0 && !m.goneOut).length;
    const st = STANCE[r.stance];
    const tm = TEMPERAMENT[r.temperament ?? 'prospector'];
    const sel = this.selected();
    const canDeal = !!sel && this.dealsFor(sel.heroId).length > 0;
    this.rivalEl.className = `hud-rivals crew-${r.crew} st-${st.cls}`;
    this.rivalEl.append(
      h('div', { class: 'kicker', title: `${tm.name} · ${tm.text}` }, `Rival crew · ${tm.name}`),
      h('b', { title: `${r.name} · ${CREW[r.crew]?.blurb ?? ''}` }, r.name),
      h('div', { class: `rv-stance st-${r.stance}`, title: `${st.name} · ${st.text}` }, st.name, r.stance === 'hired' && r.hiredRounds ? ` · ${r.hiredRounds} round${r.hiredRounds === 1 ? '' : 's'}` : ''),
      r.stance === 'demanding' ? h('div', { class: 'rv-toll', title: `The toll · Pay ${r.toll ?? 50} (gold first, then gems and jewelry) or they attack in the next castle turn. Parley to pay.` }, h('b', null, `Pay ${r.toll ?? 50}`), ' or they attack next turn') : '',
      r.stance !== 'hired' ? h('div', { class: 'small' }, `Goal: ${GOAL_TEXT[r.goal]}`, r.aim ? h('span', { class: 'dim' }, ` · ${r.aim.what}`) : '') : h('div', { class: 'small pos' }, 'Fighting beside you'),
      h('div', { class: 'dim small' }, `${alive} on the map`),
      canDeal ? h('button', { class: 'btn btn-small rv-parley', title: 'Parley · free · key B\nOpen the deal card: pay, hire, give a job, or fight.', onclick: () => this.openParley() }, '⚖ Parley ', h('kbd', null, 'B')) : '',
    );
    this.rivalEl.classList.remove('hidden');
  }

  // ------------------------------------------------------------ parley (18.6)

  /** engine.deals, tolerant of an engine without it. */
  private dealsFor(heroId: string): DealOption[] {
    const s = this.state;
    if (!s?.delve?.rivals) return [];
    try {
      return this.engine.deals(s, heroId) ?? [];
    } catch {
      return [];
    }
  }

  openParley(): void {
    const sel = this.selected();
    if (!sel || this.busy) return;
    if (!this.dealsFor(sel.heroId).length) {
      this.toast('No crew close enough to talk to: within 4 hexes, in sight.');
      return;
    }
    this.pending = null;
    this.picker.classList.add('hidden');
    this.closePreview();
    this.parleyHero = sel.heroId;
    sfx.play('flip', { pitch: 0.9 });
    this.renderParley();
    this.drawHighlights();
  }

  private closeParley(): void {
    this.parleyHero = null;
    this.parleyEl.classList.add('hidden');
  }

  private async makeDeal(o: DealOption, job?: JobKind): Promise<void> {
    if (!this.parleyHero || this.busy) return;
    if (!o.ok) {
      sfx.play('error');
      this.toast(o.blocked ?? 'Not now.');
      return;
    }
    const heroId = this.parleyHero;
    this.closeParley();
    await this.host.send({ type: 'deal', heroId, deal: o.deal, job: job ?? o.job });
  }

  private renderParley(): void {
    const el = this.parleyEl;
    const d = this.state?.delve;
    const r = d?.rivals;
    const hd = d?.heroes.find((x) => x.heroId === this.parleyHero);
    if (!this.parleyHero || !d || !r || !hd || hd.status !== 'active' || d.phase !== 'player') {
      if (this.parleyHero) this.closeParley();
      return;
    }
    const deals = this.dealsFor(hd.heroId);
    if (!deals.length) {
      this.closeParley();
      return;
    }
    clear(el);
    el.className = `hud-parley crew-${r.crew}`;
    const st = STANCE[r.stance];
    const tm = TEMPERAMENT[r.temperament ?? 'prospector'];
    const who = this.heroDef(hd.heroId)?.name ?? hd.heroId;
    // Head: crew, temperament, stance.
    el.append(
      h(
        'div',
        { class: 'pl-head' },
        h('span', { class: 'pl-seal' }, '⚖'),
        h(
          'div',
          { class: 'pl-title' },
          h('div', { class: 'kicker' }, `Parley · ${who} speaks`),
          h('h3', null, r.name),
          h('div', { class: 'pl-tags' }, h('span', { class: `pl-tag tm-${r.temperament}`, title: `${tm.name} · ${tm.text}` }, tm.name), h('span', { class: `pl-tag st-${st.cls}`, title: `${st.name} · ${st.text}` }, st.name, r.stance === 'hired' && r.hiredRounds ? ` · ${r.hiredRounds} rounds` : '')),
        ),
        h('button', { class: 'btn btn-small btn-ghost pl-close', title: 'Close · Esc', onclick: () => this.cancel() }, '✕'),
      ),
    );
    el.querySelector('.pl-title h3')?.setAttribute('title', `${r.name} · ${CREW[r.crew]?.blurb ?? ''}`);
    // 18.5: the toll, a demand with a one-round fuse.
    if (r.stance === 'demanding')
      el.append(
        h(
          'div',
          { class: 'pl-toll', title: 'The toll · Pay it with "Pay the toll" below, or they attack in the next castle turn.' },
          h('span', { class: 'pl-fuse' }, '1'),
          h('div', null, h('b', null, '"Your gold or your blood."'), h('div', null, `Pay ${r.toll ?? 50} or they attack next turn.`)),
        ),
      );
    // Members.
    el.append(
      h(
        'div',
        { class: 'pl-members' },
        ...r.members
          .filter((m) => !m.goneOut)
          .map((m) =>
            h(
              'div',
              { class: `pl-mem ${m.hp <= 0 ? 'dead' : ''}`, title: `${m.name} · ${className(m.cls)}, HP ${m.hp}/${m.maxHp}\n${RIVAL_KIT[m.cls] ?? ''}` },
              h('span', { class: `cbadge cls-${m.cls}` }, classGlyph(m.cls)),
              h('span', null, h('b', null, m.name), h('span', { class: 'dim small' }, ` ${className(m.cls)} · `), h('span', { class: 'num small' }, m.hp > 0 ? `${m.hp}/${m.maxHp}` : 'dead')),
            ),
          ),
      ),
    );
    // What they're after (aim).
    if (r.aim && r.stance !== 'hired' && r.stance !== 'bribed')
      el.append(
        h(
          'div',
          { class: 'pl-aim', title: "What they're after · Where they are heading, how many rounds until they get there, and what you think it is worth." },
          h('span', { class: 'kicker' }, 'After'),
          h('b', null, r.aim.what),
          h('span', { class: 'dim small' }, ` · ${r.aim.rounds <= 0 ? 'there now' : `${r.aim.rounds} round${r.aim.rounds === 1 ? '' : 's'} away`} · ~${r.aim.value} gold`),
          h('button', { class: 'btn btn-small btn-ghost', title: 'Look there', onclick: () => this.dio.lookAt(r.aim!.at) }, '◎'),
        ),
      );
    // Purse.
    const purse = d.heroes.filter((x) => x.status === 'active').flatMap((x) => x.pack).filter((i) => i.kind === 'gold' || i.kind === 'gem' || i.kind === 'jewelry');
    const coin = purse.filter((i) => i.kind === 'gold').reduce((a, i) => a + i.amount, 0);
    const val = purse.filter((i) => i.kind !== 'gold').reduce((a, i) => a + i.amount, 0);
    el.append(h('div', { class: 'pl-purse small', title: "The party's purse · They take gold coins first, then gems and jewelry, smallest first, until the price is covered. No change given. Heirlooms, hoard pieces and story items are never handed over." }, h('span', { class: 'kicker' }, 'You carry'), ` ${coin} gold${val ? ` + ${val} in gems and jewelry` : ''}`));
    // Deals.
    const list = h('div', { class: 'pl-deals' });
    const jobs = deals.filter((x) => x.deal === 'job');
    const fight = deals.find((x) => x.deal === 'fight');
    for (const o of deals) {
      if (o.deal === 'fight' || o.deal === 'job') continue;
      list.append(this.dealRow(o));
      if (o.deal === 'truce' && jobs.length) list.append(this.jobRow(jobs));
    }
    if (jobs.length && !deals.some((x) => x.deal === 'truce')) list.append(this.jobRow(jobs));
    el.append(list);
    el.append(
      h(
        'div',
        { class: 'pl-foot' },
        h('span', { class: 'dim small' }, 'Free · one deal per crew per round'),
        h('button', { class: 'btn btn-ghost', onclick: () => this.cancel() }, 'Walk away ', h('kbd', null, 'Esc')),
        fight ? h('button', { class: 'btn btn-danger pl-fight', disabled: !fight.ok, title: fight.ok ? `Fight · ${fight.text}` : `Fight · ${fight.blocked ?? ''}`, onclick: () => void this.makeDeal(fight) }, `${DEAL_GLYPH.fight} Fight`) : '',
      ),
    );
    el.classList.remove('hidden');
  }

  private dealRow(o: DealOption): HTMLElement {
    return h(
      'div',
      { class: `pl-deal deal-${o.deal} ${o.ok ? '' : 'blocked'}`, 'data-deal': o.deal },
      h('span', { class: 'pl-glyph' }, DEAL_GLYPH[o.deal]),
      h(
        'div',
        { class: 'pl-text' },
        h('b', null, o.label),
        h('div', { class: 'small pl-what' }, o.text),
        o.pays && o.ok ? h('div', { class: 'small pl-pays' }, `They take: ${o.pays}`) : '',
        o.risk ? h('div', { class: `small pl-risk ${/1 in|%|turn on/i.test(o.risk) && !/not turn/i.test(o.risk) ? 'neg' : ''}` }, `⚠ ${o.risk}`) : '',
        !o.ok && o.blocked ? h('div', { class: 'small pl-why' }, o.blocked) : '',
      ),
      h('button', { class: `btn btn-small ${o.ok ? 'btn-primary' : ''}`, disabled: !o.ok, title: o.ok ? `${o.label} · ${o.price ? `${o.price} gold` : 'free'}${o.pays ? `\nThey take: ${o.pays}` : ''}` : `${o.label} · ${o.blocked ?? 'not now'}`, onclick: () => void this.makeDeal(o) }, o.price ? `${o.price}` : 'Free', o.price ? h('small', null, ' gold') : ''),
    );
  }

  /** The three jobs share one row with a button each. */
  private jobRow(jobs: DealOption[]): HTMLElement {
    const any = jobs.find((x) => x.ok) ?? jobs[0]!;
    return h(
      'div',
      { class: `pl-deal deal-job ${jobs.some((x) => x.ok) ? '' : 'blocked'}`, 'data-deal': 'job' },
      h('span', { class: 'pl-glyph' }, DEAL_GLYPH.job),
      h(
        'div',
        { class: 'pl-text' },
        h('b', { title: 'A job · They do it, then go back to what they were doing.' }, `A job · ${any.price} gold`),
        !jobs.some((x) => x.ok) && any.blocked ? h('span', { class: 'small pl-why' }, ` · ${any.blocked}`) : any.pays && any.ok ? h('span', { class: 'small pl-pays' }, ` · they take ${any.pays}`) : '',
        h(
          'div',
          { class: 'pl-jobs' },
          ...jobs.map((j) => h('button', { class: 'btn btn-small', 'data-job': j.job ?? '', disabled: !j.ok, title: `${j.job ? JOB_NAME[j.job] : j.label} · ${j.text}${j.ok ? '' : `\nCan't now: ${j.blocked ?? ''}`}`, onclick: () => void this.makeDeal(j) }, j.job ? JOB_NAME[j.job] : j.label)),
        ),
      ),
    );
  }

  // ------------------------------------------------------------ tooltips, banners, toasts

  private showTip(html: string): void {
    this.tip.innerHTML = html;
    this.tip.classList.remove('hidden');
    this.placeTip();
  }

  private placeTip(): void {
    const w = this.tip.offsetWidth;
    const th = this.tip.offsetHeight;
    const x = Math.max(8, Math.min(innerWidth - w - 12, this.mouse.x + 18));
    const below = this.mouse.y + 18;
    const y = below + th > innerHeight - 8 ? Math.max(8, this.mouse.y - th - 12) : below;
    this.tip.style.transform = `translate(${x}px, ${y}px)`;
  }

  private hideTip(): void {
    this.tip.classList.add('hidden');
  }

  async banner(title: string, sub: string, wait: (s: number) => Promise<void>, world = false): Promise<void> {
    clear(this.bannerEl);
    this.bannerEl.className = `hud-banner ${world ? 'world' : ''}`;
    this.bannerEl.append(h('div', { class: 'bn-title' }, title), h('div', { class: 'bn-sub' }, sub));
    await wait(0.55);
    this.bannerEl.classList.add('hidden');
  }

  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('hidden');
    this.toastEl.classList.remove('pop');
    void this.toastEl.offsetWidth;
    this.toastEl.classList.add('pop');
    clearTimeout((this.toastEl as unknown as { _t?: number })._t);
    (this.toastEl as unknown as { _t?: number })._t = window.setTimeout(() => this.toastEl.classList.add('hidden'), 2600);
  }

  pulse(kind: 'hurt' | 'dark'): void {
    this.vignette.classList.remove('pulse-hurt', 'pulse-dark');
    void this.vignette.offsetWidth;
    this.vignette.classList.add(kind === 'hurt' ? 'pulse-hurt' : 'pulse-dark');
  }

  private baseDark: Brightness = 'bright';

  setDark(b: Brightness): void {
    this.baseDark = b;
    this.applyDark();
  }

  /** 16.2: the vignette follows the selected hero: unlit = dark (pitch in the Hollow), else the lantern stage. */
  private applyDark(): void {
    const sel = this.selected();
    const unlit = !!sel && sel.status === 'active' && !this.isLit(sel.heroId);
    const b: Brightness = unlit ? (sel!.at.level === 3 ? 'pitch' : 'dark') : this.lanternOpen() ? this.baseDark : 'dark';
    this.vignette.dataset.b = b;
  }

  // ------------------------------------------------------------ confirm and menu

  confirm(text: string, okLabel: string, ok: () => void, opts: { title?: string; cancel?: string; danger?: boolean } = {}): void {
    this.confirmBox = { text, ok };
    clear(this.modal);
    this.modal.append(
      h(
        'div',
        { class: `modal-box ${opts.danger ? 'danger' : ''}` },
        opts.title ? h('div', { class: 'modal-title' }, opts.title) : '',
        h('p', null, text),
        h(
          'div',
          { class: 'pv-actions' },
          h('button', { class: 'btn btn-ghost', onclick: () => this.closeConfirm() }, `${opts.cancel ?? 'Cancel'} `, h('kbd', null, 'Esc')),
          h(
            'button',
            {
              class: 'btn btn-danger',
              onclick: () => {
                this.closeConfirm();
                ok();
              },
            },
            okLabel,
          ),
        ),
      ),
    );
    this.modal.classList.remove('hidden');
  }

  private closeConfirm(): void {
    this.confirmBox = null;
    this.modal.classList.add('hidden');
  }

  private toggleMenu(): void {
    const m = this.menuEl;
    if (!m.classList.contains('hidden')) {
      m.classList.add('hidden');
      return;
    }
    clear(m);
    const st = this.host.settings;
    const speed = h('div', { class: 'menu-row' }, h('span', { class: 'kicker' }, 'Playback'), ...SPEEDS.map((sp) => h('button', { class: `btn btn-small ${st.speed === sp.value ? 'on' : ''}`, onclick: () => this.setSpeed(sp.value) }, sp.label)));
    m.append(
      h('div', { class: 'kicker' }, 'Settings'),
      speed,
      h(
        'label',
        { class: 'menu-check' },
        h('input', {
          type: 'checkbox',
          checked: st.reduceShake,
          onchange: (e: Event) => {
            st.reduceShake = (e.target as HTMLInputElement).checked;
            this.host.saveSettings();
            this.host.applySettings();
          },
        }),
        ' Reduce camera shake',
      ),
      h(
        'label',
        { class: 'menu-check' },
        h('input', {
          type: 'checkbox',
          checked: !st.noEndTurnAsk,
          onchange: (e: Event) => {
            st.noEndTurnAsk = !(e.target as HTMLInputElement).checked;
            this.host.saveSettings();
          },
        }),
        ' Ask before ending a turn with moves left',
      ),
      h(
        'label',
        { class: 'menu-check', title: 'Walls between the camera and your heroes drop low so you can see past them. Off: every wall stands at full height.' },
        h('input', {
          type: 'checkbox',
          checked: !!st.cutaway,
          onchange: (e: Event) => {
            st.cutaway = (e.target as HTMLInputElement).checked;
            this.host.saveSettings();
            this.host.applySettings();
          },
        }),
        ' Lower walls near the camera',
      ),
      h('div', { class: 'menu-keys dim small' }, h('div', null, h('kbd', null, '1–4'), ' select · ', h('kbd', null, 'Tab'), ' next hero · ', h('kbd', null, 'S'), ' sneak · ', h('kbd', null, 'T'), ' take stairs or lift · ', h('kbd', null, 'Q'), ' leave the castle (on a way out) · ', h('kbd', null, 'L'), ' shutter/open the lantern (bearer) · ', h('kbd', null, 'B'), ' parley with a crew · ', h('kbd', null, 'E'), ' end turn'), h('div', null, 'Right-drag orbit · ', h('kbd', null, '['), h('kbd', null, ']'), ' rotate 60° · wheel zoom · middle-drag or arrows pan'), h('div', null, 'Hold ', h('kbd', null, 'Space'), ' to hurry the world phase')),
      h('div', { class: 'menu-row' }, h('button', { class: 'btn btn-small btn-danger', onclick: () => this.confirm('Abandon the delve? Heroes standing on an exit get out. Everyone else is left behind and dies.', 'Abandon', () => this.host.abandonDelve()) }, 'Abandon delve'), h('button', { class: 'btn btn-small', onclick: () => this.host.toTitle() }, 'Title screen')),
    );
    m.classList.remove('hidden');
  }

  private setSpeed(v: number): void {
    this.host.settings.speed = v;
    this.host.saveSettings();
    this.host.applySettings();
    this.menuEl.classList.add('hidden');
    this.toggleMenu();
  }

  private toggleMute(): void {
    sfx.setMuted(!sfx.muted);
    this.renderTop();
  }

  private buildCamBox(): void {
    clear(this.camBox);
    this.camBox.append(
      h('button', { class: 'btn btn-sq btn-small', title: 'Rotate the view left 60° ([). Right-drag to orbit freely.', onclick: () => this.dio.rig.snapRotate(1) }, '⟲'),
      h('button', { class: 'btn btn-sq btn-small', title: 'Rotate the view right 60° (]).', onclick: () => this.dio.rig.snapRotate(-1) }, '⟳'),
      h('button', { class: 'btn btn-sq btn-small', title: 'Zoom in (mouse wheel).', onclick: () => this.dio.rig.zoomBy(0.8) }, '+'),
      h('button', { class: 'btn btn-sq btn-small', title: 'Zoom out (mouse wheel).', onclick: () => this.dio.rig.zoomBy(1.25) }, '−'),
      h(
        'button',
        {
          class: 'btn btn-sq btn-small',
          title: 'Center the view on the selected hero (C).',
          onclick: () => {
            const s = this.selected();
            if (s) this.dio.lookAt(s.at);
          },
        },
        '◎',
      ),
    );
  }

  private renderEmpty(): void {
    const s = this.state;
    const lvl = this.dio.shownLevel;
    const seen = !!this.vis && [...this.vis.explored].some((k) => k.startsWith(`${lvl}:`));
    const name = this.engine.castle().levels.find((l) => l.level === lvl)?.name ?? `Level ${lvl}`;
    clear(this.emptyEl);
    if (s?.delve && !seen) {
      this.emptyEl.append(h('div', { class: 'bn-title' }, name), h('div', { class: 'bn-sub' }, 'Unexplored. Find the stairs, the lift or the pit.'));
      this.emptyEl.classList.remove('hidden');
    } else this.emptyEl.classList.add('hidden');
  }

  levelChanged(): void {
    if (this.state?.delve) {
      this.renderEmpty();
      this.renderTop();
      this.drawHighlights();
    }
  }

  // ------------------------------------------------------------ input

  private setSneak(on: boolean): void {
    this.sneak = on;
    this.refresh();
  }

  private endTurn(): void {
    if (this.busy) return;
    this.cancel();
    const d = this.state?.delve;
    const waiting = d ? d.heroes.filter((x) => x.status === 'active' && (!x.moved || !x.acted)) : [];
    // 15.7: ask once when anyone still has a move or an action.
    if (waiting.length && !this.host.settings.noEndTurnAsk) {
      const names = waiting.map((x) => this.heroDef(x.heroId)?.name ?? x.heroId);
      const what = waiting.map((x) => (!x.moved && !x.acted ? 'move and action' : !x.moved ? 'move' : 'action'));
      const list = names.map((n, i) => `${n} (${what[i]})`).join(', ');
      this.confirm(`${list} still ha${waiting.length === 1 ? 's' : 've'} something left. End the turn anyway?`, 'End turn', () => void this.host.send({ type: 'endTurn' }), { title: `${waiting.length} still waiting`, cancel: 'Keep playing' });
      return;
    }
    void this.host.send({ type: 'endTurn' });
  }

  private onKey(e: KeyboardEvent): void {
    const s = this.state;
    if (!s?.delve || this.root.classList.contains('hidden')) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if (e.key === 'Escape') {
      this.cancel();
      return;
    }
    if (this.confirmBox) {
      if (e.key === 'Enter') {
        const ok = this.confirmBox.ok;
        this.closeConfirm();
        ok();
      }
      return;
    }
    if (this.busy) return;
    if (this.parleyHero) return;
    if (this.pv) {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.confirmPreview();
      } else if (e.key === '+' || e.key === '=' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.setFocus(this.pv.focus + 1);
      } else if (e.key === '-' || e.key === 'ArrowDown') {
        e.preventDefault();
        this.setFocus(this.pv.focus - 1);
      }
      return;
    }
    const d = s.delve;
    const k = e.key.toLowerCase();
    if (k >= '1' && k <= '4') {
      const hd = d.heroes[Number(k) - 1];
      if (hd) this.select(hd.heroId);
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const act = d.heroes.filter((x) => x.status === 'active');
      if (!act.length) return;
      const i = act.findIndex((x) => x.heroId === this.selectedId);
      const order = [...act.slice(i + 1), ...act.slice(0, i + 1)];
      const next = (e.shiftKey ? [...order].reverse().slice(1) : order).find((x) => !x.moved || !x.acted) ?? order[0]!;
      this.select(next.heroId);
      return;
    }
    if (k === 'b' && !this.bar.querySelector('button.act[data-key="b"]:not([data-action="parley"])')) {
      const sel = this.selected();
      if (sel && this.dealsFor(sel.heroId).length) return this.openParley();
    }
    if (k === 's') return this.setSneak(!this.sneak);
    if (k === 'e') return this.endTurn();
    // 16.2: L shutters/opens the lantern unless the selected hero has a Light/Oil button on L.
    if (k === 'l' && !this.bar.querySelector('button.act[data-key="l"]:not(.act-shutter)')) return this.toggleShutter();
    if (k === '[') return this.dio.rig.snapRotate(1);
    if (k === ']') return this.dio.rig.snapRotate(-1);
    if (k === 'c') {
      const sel = this.selected();
      if (sel) this.dio.lookAt(sel.at);
      return;
    }
    if (this.pending && e.key === 'Enter') return;
    const btn = this.bar.querySelector<HTMLButtonElement>(`button.act[data-key="${k}"]`);
    if (btn && !btn.disabled) {
      e.preventDefault();
      btn.click();
    }
  }
}

// ------------------------------------------------------------ helpers

const STAT_NAME: Record<string, string> = { might: 'Might', finesse: 'Finesse', wits: 'Wits', nerve: 'Nerve' };

const TILE_NAME: Record<string, string> = {
  floor: 'Floor',
  wall: 'Wall',
  cracked: 'Cracked wall',
  pillar: 'Pillar',
  rubble: 'Rubble (costs 2)',
  door: 'Door',
  pit: 'Pit',
  stairs: 'Stairs',
  exit: 'Exit: leave here',
  brazier: 'Brazier',
  lift: 'Lift',
  prop: 'Furniture',
  tallprop: 'Furniture',
  sealed: 'The Sealed Stair: sealed shut',
};

const GOAL_TEXT: Record<string, string> = { loot: 'looting', objective: 'after your objective', leave: 'leaving' };

/** What each rival class does (16.5, 18.5), for tooltips. */
const RIVAL_KIT: Record<string, string> = {
  ranger: 'Longbow at range 6. Goes on overwatch.',
  shadowmancer: 'Veils herself; hard to see.',
  burglar: 'Sleep darts. Picks locks.',
  sellsword: 'Shield and sword: 3 slots, 2 damage, armor 1. Shoves a hero off an unrailed edge.',
  sapper: 'Hammer, and one charge: marks the hexes a round ahead, then 3 damage to everyone there. Noise 8.',
  pyromancer: 'Firebolts: marks a hero in range 5 a round ahead, then 3 Wits slots, 2 damage per hit.',
};

export function intentText(s: GameState, it: Intent): string {
  const d = s.delve;
  const name = (id?: string) => (id ? (s.campaign.roster.find((x) => x.id === id)?.name ?? (d?.prisoner?.id === id ? d.prisoner.name : undefined) ?? d?.rivals?.members.find((r) => r.id === id)?.name ?? id) : '');
  const dmg = it.damage ? ` for ${it.damage[0]}–${it.damage[1]}` : '';
  switch (it.kind) {
    case 'attack':
      return `attacks ${name(it.targetId)}${dmg}`;
    case 'move':
      return 'moves';
    case 'web':
      return `webs ${name(it.targetId)}`;
    case 'steal':
      return `steals from ${name(it.targetId)}`;
    case 'flee':
      return 'flees';
    case 'shove':
      return `shoves ${name(it.targetId)}`;
    case 'breath':
      return `breathes fire on ${it.hexes?.length ?? 5} hexes${dmg}`;
    case 'sweep':
      return `sweeps its tail: every adjacent hero shoved${dmg}`;
    case 'shout':
      return `shouts: every orc within 8 wakes and hunts${it.targetId ? ` ${name(it.targetId)}` : ''}`;
    case 'drag':
      return `drags ${name(it.targetId)} one hex closer`;
    case 'grab':
      return `grabs ${name(it.targetId)}: held until they escape`;
    case 'overwatch':
      return 'goes on overwatch: shoots the first hero that moves or acts within 6';
    case 'smoke':
      return `throws a smoke bomb${it.targetId ? ` at ${name(it.targetId)}` : ''}`;
    case 'veil':
      return 'veils herself';
    case 'dart':
      return `throws a sleep dart at ${name(it.targetId)}`;
    case 'toll':
      return `demands a toll: pay ${d?.rivals?.toll ?? 50} or they attack next turn`;
    case 'firebolt':
      return `hurls a firebolt at ${name(it.targetId)} (3 Wits slots at 60%, 2 per hit)`;
    case 'charge':
      return `lights a charge: next turn 3 damage to everyone on the marked hexes`;
    default:
      return 'waits';
  }
}

/** Compass word from one hex to another, in world space (north = away from the default camera). */
function compass(from: Pos, to: Pos): string {
  const a = hexToWorld(from, 1);
  const b = hexToWorld(to, 1);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const ang = Math.atan2(dx, -dz); // 0 = north, clockwise
  const names = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  return names[Math.round(((ang + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8]!;
}

/** A HUD title as tooltip HTML: escaped, line breaks kept, the name before the first " · " in bold. */
function tipHtml(text: string): string {
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const [first = '', ...rest] = text.split('\n');
  const cut = first.indexOf(' · ');
  const head = cut > 0 ? `<b>${esc(first.slice(0, cut))}</b><span class="tip-how"> · ${esc(first.slice(cut + 3))}</span>` : `<b>${esc(first)}</b>`;
  return [head, ...rest.map((l) => `<span class="tip-line">${esc(l)}</span>`)].join('<br>');
}

function hpBar(hp: number, max: number): HTMLElement {
  const pct = Math.max(0, Math.min(1, hp / max));
  return h('span', { class: `hp-bar ${pct <= 0.34 ? 'low' : ''}` }, h('i', { style: `width:${pct * 100}%` }));
}

/** V3.4: the pack as a first-class row: all sockets drawn, a 2-slot item spans two, free count in words. */
function packRow(pack: Item[]): HTMLElement {
  const socks: HTMLElement[] = [];
  let used = 0;
  for (const it of pack) {
    const span = Math.max(1, Math.min(it.slots, PACK_SLOTS - used));
    const val = it.kind === 'gold' || it.kind === 'gem' || it.kind === 'jewelry' || it.kind === 'hoard';
    socks.push(h('span', { class: `pk-sock pk-${itemBase(it.kind)} ${span > 1 ? 'wide' : ''}`, 'data-span': `${span}`, title: itemTip(it) }, h('span', { class: 'pk-g' }, itemGlyph(it.kind)), val ? h('small', { class: 'num' }, `${it.amount}`) : ''));
    used += it.slots;
  }
  for (let i = used; i < PACK_SLOTS; i++) socks.push(h('span', { class: 'pk-sock empty', 'data-span': '1', title: 'Empty pack slot · Take loot or an item to fill it.\nHeirlooms and hoard pieces need 2 free slots.' }));
  const free = Math.max(0, PACK_SLOTS - used);
  return h(
    'div',
    { class: 'hc-pack' },
    h('span', { class: 'hc-lab', title: `Pack · ${PACK_SLOTS} slots per hero\nEverything a hero carries out of the castle. Take, Drop and Give are free.` }, 'Pack'),
    h('span', { class: 'pk-socks' }, ...socks),
    h('span', { class: `pk-free ${free === 0 ? 'full' : ''}`, title: free === 0 ? 'Pack full: Drop or Give something (free) to take more.' : `${free} of ${PACK_SLOTS} pack slots free.` }, free === 0 ? 'Full' : `${free} free`),
  );
}
