// The delve HUD (V4.0 rebuild, pillars 3, 11, 15, 16): the board is the screen. Along the top the
// lantern, the job, what the party carries, the levels and the menu; the party down the left; the
// Chronicle on the right; one hotbar row for the selected hero at the bottom. Hover cards sit beside
// what you point at (three lines; Alt for the rules), the roll panel docks low, the castle's turn
// gets a thin banner and a caption beside each actor. Commands go through host.send.

import type { ActionOption, Engine, MoveRisks, Reach, RollPreview, Visibility } from '../game/api';
import { DIRS, add, distance, hexKey, hexToWorld, posKey, samePos, type Pos } from '../game/hex';
import type { ActionKind, ActionTarget, Brightness, DealOption, GameEvent, GameState, Hero, HeroClass, HeroInDelve, Intent, Item, JobKind, Monster, ReactionChoice, ReactionKind, ReactionQuestion, ReactionSetting, SlotRoll } from '../game/types';
import { sfx } from '../audio/sfx';
import type { Diorama } from '../view/diorama';
import { propName } from '../view/level';
import { clear, h, icon } from './dom';
import { exitAt, exitShut, exitTooltip, exitWhere, linkAt, linkButton, linkReach, linkTooltip, nearestExit, prizeInHand, type ExitInfo, type LinkInfo } from '../view/links';
import { heardIcon, heardTitle } from '../view/sounds';
import { ACTION_GLYPH, ACTION_KEY, ALE_EFFECT, CLASS_KIT, AWARENESS_TEXT, CLASS_ROLE, CREW, CREW_KIT, JOB_NAME, MONSTER_NOTE, FACING_HELP, MOVE_HELP, STANCE, TEMPERAMENT, V37, V39, REACT_NAME, REACT_HELP, REACT_SETTING_HELP, SETTING_WORD, actionCost, actionHelp, className, classGlyph, crewMemberLine, itemBase, itemClickLine, itemGlyph, itemLabel, itemTip, itemUseLine, keyName } from './names';
import { backExposed, backstabFrom, backstabSpots, blastPreview, breakableWall, collapsible, dirIndexOf, dirToward, facingOf, fuseAt, fuseSide, fuseWords, pathEndFacing } from '../view/stealth';
import { longPath, stepsToTurn } from '../view/pathing';
import { CARRY_MOVE } from '../game/data';
import { BURGLAR_WALK, CLASSES, DARK_SIGHT, FOCUS_MAX, HEAVY_MOVE, KINDLE_LIGHT, MONSTERS, OIL_LIGHT, TORCH_ROUNDS, OVERWATCH_RANGE, PACK_SLOTS, SMUGGLER_SNEAK, VEIL_BREAK_NOISE, WALK_MOVE, FACING, TOLL_MIN, BETRAY_LOOT } from '../game/data';
import { pairHome as pairsHome } from '../game/data'; // V4.1 (spec 31.4): splints
import { ARROWS_PER_LEVEL, KNIFE } from '../game/data'; // V4.1 (WS6)
import { ATTACK_ARROWS, arrowWord, bowReady, weaponNow } from '../game/arrows'; // V4.1 (WS6)
import { isKit } from '../game/charges';
import type { Settings } from './settings';
import { INTENT_ICON, iconSvg, type IconName } from '../view/icons';
import { Chronicle } from './hud-chronicle';
import { Coach } from './coach';
import { bonusSlots, cap, dieHex, hitTable, lightWords, modifierChip, noiseWords, oddsWords, outcomeBar, readRoll, statName, type RollRead } from './hud-roll';
import { heroDone, partyDone, stillCan } from './autoend'; // V5.0 (P, spec 32.5, 32.6)

export { hitOdds } from './hud-roll';

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

const ITEM_ACTIONS = new Set<ActionKind>(['smoke', 'glue', 'dart', 'caltrops', 'firecracker', 'key', 'oil', 'grapple', 'potion', 'rope', 'charge', 'nightsight', 'venomdart', 'antidote', 'shoot']); // V4.1 (WS6): a hex arrow's pack slot shoots it
/** V4.1 (WS6, spec 31.8): the quiver's rule, on its chip. */
const QUIVER_LINE = `A fresh quiver every delve: ${ARROWS_PER_LEVEL} arrows a level. Every bow shot uses one (attack, overwatch, knockback, hamstring, a free swing). Out of arrows: a knife (${KNIFE.slots} Finesse tries, ${KNIFE.dmg} damage, next to the target).`;
/** V4.1 (spec 31.4): the poison line, everywhere it shows (pillar 15: what it does and what cures it). */
const POISON_TIP = 'Poisoned: −1 a turn, never below 1. Antipoison, Mend, or get out.';

/** A hero who can move and act (V4.1: active; paralysis is gone). */
const able = (x: HeroInDelve) => x.status === 'active';
const turnsWord = (n: number) => `${n} turn${n === 1 ? '' : 's'}`;
const SPELLS = new Set<ActionKind>(['firebolt', 'fireball', 'kindle', 'mend', 'veil', 'sleep', 'blink', 'ward', 'gust', 'dread', 'nightthorn', 'briar']);
/** Class abilities that aren't spells. */
const ABILITIES = new Set<ActionKind>(['guard', 'rally', 'overwatch', 'knockback', 'dig', 'setCharge', 'setTripwire', 'throwCharge', 'brace', 'hamstring']);
/** V4.0 HUD: rare and free actions, folded into the More menu. */
const MORE_ACTIONS = new Set<ActionKind>(['give', 'drop', 'passLantern', 'shutter', 'parley']);
/** V4.1 (WS2): Light torch, Snuff and Drop torch are bar buttons (the torch's pack slot lights or snuffs it too); the lantern's slot and L shutter it. */

/** V4.0 HUD: the icon on each action button (no entry: the action's glyph). */
const ACTION_ICON: Partial<Record<ActionKind | 'link' | 'face' | 'follow', IconName>> = {
  attack: 'sword',
  shove: 'shove',
  rally: 'flag',
  brace: 'shield',
  guard: 'shield',
  overwatch: 'eye',
  knockback: 'shove',
  hamstring: 'shoot',
  dig: 'dig',
  setCharge: 'blast',
  setTripwire: 'trap', // V4.1 (spec 31.3)
  throwCharge: 'blast',
  firebolt: 'bolt',
  fireball: 'blast',
  kindle: 'flame',
  mend: 'cross',
  veil: 'veil',
  sleep: 'zz',
  blink: 'blink',
  ward: 'shield',
  gust: 'gust',
  dread: 'skull',
  nightthorn: 'thorn',
  briar: 'thorn',
  escape: 'chain',
  unshackle: 'chain',
  take: 'hand',
  open: 'door',
  pick: 'lock',
  smash: 'hammer',
  smashProp: 'hammer',
  unbar: 'key',
  light: 'flame',
  disarm: 'trap',
  winch: 'winch',
  leave: 'exit',
  link: 'stairs',
  jump: 'down',
  climb: 'rope',
  rope: 'rope',
  bribe: 'coin',
  parley: 'scales',
  give: 'give',
  drop: 'drop',
  passLantern: 'lantern',
  shutter: 'lantern',
  face: 'face',
  follow: 'flag',
  charge: 'blast',
  key: 'key',
  grapple: 'rope',
  torch: 'torch',
  snuff: 'torch',
  dropTorch: 'drop',
  potion: 'potion',
  smoke: 'smoke',
  glue: 'smoke',
  dart: 'shoot',
  caltrops: 'trap',
  firecracker: 'blast',
  oil: 'flame',
  nightsight: 'eye',
  venomdart: 'venom',
  antidote: 'potion',
  carry: 'carry',
  setDown: 'down',
};

/** The verb on the roll panel's commit button. */
const VERB: Partial<Record<ActionKind, string>> = {
  attack: 'Strike',
  pick: 'Pick',
  smash: 'Smash',
  shove: 'Shove',
  knockback: 'Shoot',
  hamstring: 'Shoot',
  escape: 'Break free',
  jump: 'Jump',
  disarm: 'Disarm',
  dart: 'Throw',
  venomdart: 'Throw',
};

const SPEEDS: { label: string; value: number }[] = [
  { label: '½×', value: 0.5 },
  { label: '1×', value: 1 },
  { label: '2×', value: 2 },
  { label: '4×', value: 4 },
  { label: 'Instant', value: 0 },
];

/** A line on a hover card: plain HTML, with a tone. */
interface CardLine {
  html: string;
  cls?: string;
}

export class Hud {
  readonly root: HTMLElement;
  selectedId: string | null = null;
  /** V4.0 (spec 26.1): the selected hero's own Walk/Sneak setting (engine state, `moveMode`). */
  get sneak(): boolean {
    return this.selected()?.moveMode === 'sneak';
  }
  /** V3.9 (24.2): Face mode (key F, when the flag is on): the next click on a hex turns the selected hero toward it. */
  facing = false;
  /** V3.7 (20.5): free move brings the party along (default on). */
  follow = true;
  /** The long path under the mouse while calm. */
  private hoverLong: Pos[] | null = null;
  private state: GameState | null = null;
  private vis: Visibility | null = null;
  private busy = false;
  private reach: Reach[] = [];
  /** V4.0 HUD: the selected hero's reach in the other move mode, for "Sneak (S) and it won't" (computed on first need). */
  private otherReach: Reach[] | null = null;
  private options: ActionOption[] = [];
  private pending: ActionOption | null = null;
  private pv: PreviewState | null = null;
  /** V4.1 (WS6, spec 31.8): the arrow picked for the armed shot (a specialty bundle's item id); null: plain. */
  private arrowPick: string | null = null;
  private lastPreview: PreviewState | null = null;
  private intents: Record<string, Intent> = {};
  private mouse = { x: 0, y: 0 };
  private hoverAt: Pos | null = null;
  private hoverUnit: string | null = null;
  /** V4.0 (spec 30.3): keyboard choice among the armed action's options (index into pickOrder), and the pill entry hovered. */
  private hotIdx = -1;
  private keyNav = false;
  private listHot: ActionTarget | null = null;
  private confirmBox: { text: string; ok: () => void } | null = null;
  /** V4.0 HUD: Alt held: hover cards and the roll panel show their numbers. */
  private alt = false;
  private detailsOpen = false;
  private keyMap = new Map<string, () => void>();
  /** V4.0 HUD: the castle's turn in progress (banner, folded hotbar, captions). */
  private castle: { round: number; total: number; n: number; seen: Set<string> } | null = null;
  /** Caches for hover: previews per target, sight washes per watcher (cleared with every new state). */
  private pvCache = new Map<string, RollPreview>();
  private washCache = new Map<string, { front: Pos[]; side: Pos[] }>();
  /** The hovered thing the card shows, to skip rebuilding it on every pointer move. */
  private cardKey = '';

  // Elements.
  private strip = h('div', { class: 'dl-strip' });
  private rail = h('div', { class: 'dl-rail' });
  private bar = h('div', { class: 'dl-hotbar' });
  private pill = h('div', { class: 'dl-pill hidden' });
  private moreEl = h('div', { class: 'dl-more hidden', role: 'menu' });
  private chron = new Chronicle();
  private crewEl = h('div', { class: 'dl-crew hidden' });
  private card = h('div', { class: 'dl-card hidden', role: 'tooltip' });
  private tip = h('div', { class: 'dl-tip hidden', role: 'tooltip', id: 'dl-tip' });
  private previewEl = h('section', { class: 'dl-roll hidden', 'aria-label': 'Roll' });
  private rollEl = h('div', { class: 'dl-rollanim hidden' });
  private caption = h('div', { class: 'dl-caption hidden' });
  private castleEl = h('div', { class: 'dl-castle hidden' });
  private bannerEl = h('div', { class: 'dl-banner hidden' });
  private toastEl = h('div', { class: 'hud-toast hidden' });
  private modal = h('div', { class: 'dl-modal hidden' });
  /** V5.0 (spec 32.8): the key help overlay (? or F1). */
  private keysEl = h('div', { class: 'dl-modal dl-keys hidden' });
  /** V4.1 (spec 31.13): the reaction card, up while the castle's turn waits for an answer (`reactWait`). */
  private reactEl = h('div', { class: 'dl-react hidden', role: 'dialog', 'aria-label': 'A hero can react', tabindex: -1 });
  private reactWait: { q: ReactionQuestion; done: (c: ReactionChoice) => void } | null = null;
  /** V4.1 (spec 31.13): the Reactions settings popover is open (for the selected hero). */
  private reactOpen = false;
  /** V3.5 (18.6): the parley card; open while `parleyHero` is set. */
  private parleyEl = h('div', { class: 'dl-parley hidden' });
  private parleyHero: string | null = null;
  private vignette = h('div', { class: 'hud-vignette' });
  private camBox = h('div', { class: 'dl-cam' });
  private menuEl = h('div', { class: 'dl-menu hidden' });
  private emptyEl = h('div', { class: 'hud-empty hidden' });
  private coach = new Coach();
  /** 16.2: persistent warning while the Gloam is up and a hero on Level 3 stands in the dark. */
  private gloamEl = h('div', { class: 'dl-gloam hidden' }, icon('eye', 14), ' The dark here is awake. Stand in the light.');

  constructor(
    private readonly host: HudHost,
    private readonly dio: Diorama,
  ) {
    this.root = h('div', { class: 'hud dl-hud' }, this.vignette, this.emptyEl, this.strip, this.rail, h('div', { class: 'dl-right' }, this.chron.el, this.crewEl), this.camBox, this.gloamEl, this.coach.el, this.pill, this.moreEl, this.bar, this.previewEl, this.parleyEl, this.rollEl, this.caption, this.castleEl, this.bannerEl, this.toastEl, this.reactEl, this.card, this.tip, this.modal, this.keysEl, this.menuEl);
    this.buildCamBox();
    addEventListener('pointermove', (e) => {
      this.mouse = { x: e.clientX, y: e.clientY };
      if (!this.card.classList.contains('hidden')) this.placeCard();
    });
    addEventListener('keydown', (e) => this.onKey(e));
    addEventListener('keyup', (e) => this.onKeyUp(e));
    addEventListener('keyup', (e) => {
      if (e.key === 'Alt') this.setAlt(false);
    });
    addEventListener('blur', () => this.setAlt(false));
    addEventListener('resize', () => {
      this.updateCoach();
      if (!this.castle) this.fitBar();
    });
    // Every HUD element with a title (or data-tip) explains itself on hover and on keyboard focus.
    this.root.addEventListener('pointerover', (e) => this.onHudOver(e));
    this.root.addEventListener('pointerout', (e) => {
      if (this.tipOn && !(e.relatedTarget instanceof Node && this.tipOn.contains(e.relatedTarget))) this.hideTip();
    });
    this.root.addEventListener('focusin', (e) => {
      const t = e.target instanceof Element ? e.target.closest<HTMLElement>('[title],[data-tip]') : null;
      if (t && this.root.contains(t) && t.matches(':focus-visible')) this.showTipFor(t);
    });
    this.root.addEventListener('focusout', () => this.hideTip());
    // Clicking anywhere else closes the More menu and the game menu.
    addEventListener('pointerdown', (e) => {
      const t = e.target as Node;
      this.cancelFlow(); // V5.0 (P): a click is the player's: the turn waits for them
      this.shiftArmed = false;
      if (!this.moreEl.classList.contains('hidden') && !this.moreEl.contains(t) && !(t instanceof Element && t.closest('[data-more]'))) this.moreEl.classList.add('hidden');
      if (!this.menuEl.classList.contains('hidden') && !this.menuEl.contains(t) && !(t instanceof Element && t.closest('[data-menu]'))) this.menuEl.classList.add('hidden');
      // V4.1 (spec 31.13): the Reactions popover closes on a click elsewhere.
      if (this.reactOpen && !(t instanceof Element && t.closest('.dl-reacts-pop, [data-react-b]'))) {
        this.reactOpen = false;
        this.renderBar();
      }
    });
  }

  get engine(): Engine {
    return this.host.engine;
  }

  // ------------------------------------------------------------ element tips

  private tipOn: HTMLElement | null = null;

  private onHudOver(e: PointerEvent): void {
    const t = e.target instanceof Element ? e.target.closest<HTMLElement>('[title],[data-tip]') : null;
    if (!t || !this.root.contains(t) || t === this.tipOn) return;
    this.showTipFor(t);
  }

  private showTipFor(t: HTMLElement): void {
    if (t.hasAttribute('title')) {
      t.dataset.tip = t.getAttribute('title') ?? '';
      t.removeAttribute('title');
    }
    const text = t.dataset.tip ?? '';
    if (!text) return;
    this.tipOn?.removeAttribute('aria-describedby');
    this.tipOn = t;
    t.setAttribute('aria-describedby', 'dl-tip');
    this.tip.innerHTML = tipHtml(text);
    this.tip.classList.remove('hidden');
    const r = t.getBoundingClientRect();
    const w = this.tip.offsetWidth;
    const th = this.tip.offsetHeight;
    const x = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    // Below the element in the top half of the screen, above it in the bottom half (the hotbar).
    const below = r.top < innerHeight / 2;
    const y = below ? Math.min(innerHeight - th - 8, r.bottom + 8) : Math.max(8, r.top - th - 8);
    this.tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  private hideTip(): void {
    this.tipOn?.removeAttribute('aria-describedby');
    this.tipOn = null;
    this.tip.classList.add('hidden');
  }

  // ------------------------------------------------------------ state

  setState(s: GameState, vis: Visibility): void {
    this.state = s;
    this.vis = vis;
    this.pvCache.clear();
    this.washCache.clear();
    this.otherReach = null;
    this.cardKey = '';
    const d = s.delve;
    if (!d) return;
    this.chron.sync(`${s.seed}:${s.campaign.delveCount}`, d.round, d.phase, d.log);
    const active = d.heroes.filter((x) => x.status === 'active');
    if (!this.selectedId || !active.some((x) => x.heroId === this.selectedId)) {
      const next = active.find((x) => able(x) && (!x.moved || !x.acted)) ?? active.find(able) ?? active[0];
      this.selectedId = next?.heroId ?? null;
    }
    this.dio.select(this.selectedId);
    this.intents = this.engine.intents(s);
    this.dio.showIntents(s, this.intents);
    this.refresh();
  }

  // ---- V5.0 (P, spec 32.5 and 32.6): the turn's flow. One test (autoend.ts `heroDone`) decides when the camera
  // cycles to the next hero, when the question before End turn is asked, and when the turn ends on its own.
  private flowTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * After a command. If the selected hero has nothing plausible left, wait a beat (long enough to read what just
   * happened; any key, click, panel or playback cancels it), then cycle the selection and the camera to the next hero
   * who still has something to do; with nobody left and the setting on, end the turn instead, with a toast and no
   * idle question (nobody here could act). The camera is never taken away from a hero who can still open the chest
   * beside them, take its loot, open a door, parley, or act.
   */
  scheduleFlow(): void {
    this.cancelFlow();
    const s = this.state;
    const d = s?.delve;
    if (!s || !d || this.busy || this.reactWait || this.pv || this.pending || this.confirmBox || this.parleyHero) return;
    const sel = this.selected();
    if (!sel || sel.status !== 'active' || !heroDone(this.engine, s, sel.heroId)) return;
    const beat = this.host.settings.speed === 0 ? 220 : 700;
    this.flowTimer = setTimeout(() => {
      this.flowTimer = null;
      const now = this.state;
      const dn = now?.delve;
      if (!now || !dn || this.busy || this.reactWait || this.pv || this.pending || this.confirmBox || this.parleyHero) return;
      const cur = this.selected();
      if (!cur || !heroDone(this.engine, now, cur.heroId)) return;
      const ready = dn.heroes.filter((x) => x !== cur && able(x) && !heroDone(this.engine, now, x.heroId));
      const next = ready.find((x) => x.at.level === this.dio.shownLevel) ?? ready[0];
      if (next) {
        this.select(next.heroId);
        return;
      }
      if (!this.host.settings.autoEndTurn || !partyDone(this.engine, now)) return;
      this.toast('Everyone has done what they can. Ending the turn.');
      this.coach.done(3);
      this.coach.done(1);
      void this.host.send({ type: 'endTurn' });
    }, beat);
  }

  cancelFlow(): void {
    if (this.flowTimer !== null) {
      clearTimeout(this.flowTimer);
      this.flowTimer = null;
    }
  }

  setBusy(b: boolean): void {
    if (b) this.cancelFlow();
    this.busy = b;
    this.root.classList.toggle('busy', b);
    if (b) {
      this.closePreview();
      this.pending = null;
      this.pill.classList.add('hidden');
      this.moreEl.classList.add('hidden');
      this.dio.clearHighlights();
      this.dio.showSight(null);
      this.hideCard();
    } else {
      this.endCastleTurn();
    }
    this.renderBar();
    this.updateCoach();
  }

  select(id: string): void {
    const d = this.state?.delve;
    const hd = d?.heroes.find((x) => x.heroId === id);
    if (!hd || (hd.status !== 'active' && !this.crawler(hd))) return;
    this.selectedId = id;
    this.pending = null;
    this.otherReach = null;
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

  /** 24.4: enemies the party has seen this delve (engine.seenEnemies; without it, what is visible now). */
  private seenEnemies(): Set<string> {
    const s = this.state;
    const d = s?.delve;
    if (!s || !d) return new Set();
    try {
      if (typeof this.engine.seenEnemies === 'function') return this.engine.seenEnemies(s);
    } catch {
      /* fall through */
    }
    const vis = this.vis?.visible ?? new Set<string>();
    return new Set([...d.monsters.filter((m) => vis.has(posKey(m.at))).map((m) => m.id), ...(d.rivals?.members ?? []).filter((r) => vis.has(posKey(r.at))).map((r) => r.id)]);
  }

  /** 24.5: is this hero's back uncovered (no active hero's front half sees the hex behind them)? */
  backExposed(heroId: string): boolean {
    const d = this.state?.delve;
    if (!d || !this.vis) return false;
    return backExposed(this.engine.castle(), d, heroId, this.vis.visible);
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

  /** Spec 15.7: the stairs or working lift the selected hero stands on, with the `reachable` entry that takes them. */
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

  /** V3.6 (19.5): the exit hex is known (explored) or the one the party came in by. V4.0: never one whose way is still shut. */
  private exitKnown(p: Pos): boolean {
    const k = posKey(p);
    if (!this.vis || !(this.vis.explored.has(k) || this.vis.visible.has(k))) return false;
    return !this.exitShut(p);
  }

  /** V4.0 (spec 25): the shut-way hint if `p` is an exit whose way is still shut (barred or choked), else null. */
  private exitShut(p: Pos): string | null {
    const castle = this.engine.castle();
    if (!exitShut(castle, this.state, p)) return null;
    return castle.shutWays?.find((x) => samePos(castle.entrances[x.entrance]!, p))?.hint ?? 'Shut.';
  }

  /** V3.7 (20.5): engine.calm, tolerant of an engine without it. */
  private calmState(): { calm: boolean; why?: string } {
    const s = this.state;
    if (!s?.delve) return { calm: false };
    try {
      if (typeof this.engine.calm === 'function') return this.engine.calm(s);
    } catch {
      /* fall through */
    }
    return { calm: !!s.delve.calm };
  }

  /** Free move is on: calm, player phase, a selected active hero who can still walk. */
  private freeMove(): boolean {
    const d = this.state?.delve;
    const sel = this.selected();
    return !!d && d.phase === 'player' && !!sel && sel.status === 'active' && !sel.grabbedBy && !sel.webbed && !(sel.rooted ?? 0) && this.calmState().calm;
  }

  /** V4.1 (spec 31.4): a downed hero who may crawl (splints, nobody carries or holds them): selectable, moves 1, may Leave. */
  private crawler(h: HeroInDelve): boolean {
    const d = this.state?.delve;
    if (!d || h.status !== 'downed' || h.grabbedBy || !this.state || !pairsHome(this.state.campaign.village, 'smith', 'surgeon')) return false;
    return !d.heroes.some((x) => x.carrying === h.heroId && x.status === 'active') && !d.rivals?.members.some((r) => r.dragging === h.heroId && r.hp > 0 && !r.goneOut);
  }

  /** Recompute reach and options and redraw panels and highlights. */
  refresh(): void {
    const s = this.state;
    const d = s?.delve;
    if (!s || !d) return;
    const sel = this.selected();
    const canAct = !!sel && (sel.status === 'active' || this.crawler(sel)) && d.phase === 'player';
    this.reach = canAct && !this.busy ? this.engine.reachable(s, sel.heroId, this.sneak) : [];
    this.otherReach = null;
    if (canAct && !this.busy && this.freeMove()) {
      try {
        const far = typeof this.engine.calmReach === 'function' ? this.engine.calmReach(s, sel.heroId, this.sneak) : [];
        if (far.length) {
          const near = new Map(this.reach.map((r) => [posKey(r.to), r] as const));
          for (const r of far) if (!near.has(posKey(r.to))) near.set(posKey(r.to), r);
          this.reach = [...near.values()];
        }
      } catch {
        /* the view paths the rest itself */
      }
    }
    this.options = canAct && !this.busy ? this.engine.actions(s, sel.heroId) : [];
    this.renderTop();
    this.renderCards();
    this.renderBar();
    this.renderLog();
    this.renderRivals();
    this.renderParley();
    this.renderEmpty();
    this.drawHighlights();
    this.updateCoach();
  }

  // ------------------------------------------------------------ highlights

  private drawHighlights(): void {
    this.dio.clearHighlights();
    if (this.busy || !this.state?.delve) return;
    this.dio.showLanding(null, null, '', false);
    // V3.9 (24.5): with a Burglar selected, daggers on the rear hexes of seen, unaware enemies it could strike from.
    {
      const sel = this.selected();
      const s = this.state;
      const on = !this.pending && !this.pv && !this.facing && !!sel && sel.status === 'active' && !sel.acted && this.heroDef(sel.heroId)?.cls === 'burglar' && !!this.vis;
      this.dio.showBackstab(on ? backstabSpots(s, sel!.heroId, this.reach.map((r) => r.to), this.seenEnemies(), this.vis!.visible) : []);
    }
    if (this.facing) {
      this.applyHover();
      return;
    }
    if (this.pending) {
      const ats = this.pending.targets.map((t) => this.targetPos(t)).filter((p): p is Pos => !!p);
      const friendly = this.pending.pick === 'ally' || ['mend', 'potion', 'give', 'guard', 'carry', 'unshackle', 'passLantern', 'veil', 'ward'].includes(this.pending.action);
      const hexPick = this.pending.pick === 'hex' && !['jump', 'dig', 'key', 'unbar'].includes(this.pending.action);
      if (this.pending.action === 'setCharge' || this.pending.action === 'charge') {
        const castle = this.engine.castle();
        const walls = ats.filter((p) => breakableWall(castle, p));
        this.dio.highlight(walls, 'breakable');
        this.dio.highlight(ats.filter((p) => !walls.some((w) => samePos(w, p))), 'dash');
      } else this.dio.highlight(ats, this.pending.action === 'jump' ? 'danger' : friendly ? 'ally' : hexPick ? 'dash' : 'target');
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
    if (!this.freeMove()) this.dio.highlight(this.reach.map((r) => r.to), dash ? 'dash' : this.sneak ? 'sneak' : 'walk');
    const link = this.linkHere();
    this.dio.showLinkPulse(link ? this.selected()!.at : null);
    const exit = this.exitHere();
    this.dio.showExitPulse(exit?.option && !exit.option.blocked ? this.selected()!.at : null);
    // Attackable enemies get a red ring.
    const atk = this.options.filter((o) => o.action === 'attack' || o.action === 'firebolt');
    const sc = this.options.find((o) => o.action === 'setCharge');
    if (sc) this.dio.highlight(sc.targets.map((t) => t.at).filter((p): p is Pos => !!p && breakableWall(this.engine.castle(), p)), 'breakable');
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
    } else if (action === 'shove' || action === 'knockback') {
      const at = this.targetPos(t);
      if (!at) return;
      // V4.0 (spec 30.3): a knockback shot pushes straight away from the shooter, at any range.
      const dest = action === 'knockback' ? (at.level === sel.at.level && !samePos(at, sel.at) ? { level: at.level, ...add(at, DIRS[dirToward(sel.at, at)]!) } : at) : this.shoveDest(sel.at, at);
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
    // V4.0 (spec 30.3): pointing at an option takes over from the keyboard's choice.
    if (this.pending && this.keyNav && this.bestActionFor(unitId, at)) this.keyNav = false;
    this.applyHover();
  }

  private setAlt(on: boolean): void {
    if (this.alt === on) return;
    this.alt = on;
    this.cardKey = '';
    this.root.classList.toggle('alt', on);
    if (this.pv) this.renderPreview();
    this.applyHover();
  }

  /** Full rules cards: Alt held, or the setting for touch screens. */
  private get full(): boolean {
    return this.alt || !!this.host.settings.fullCards;
  }

  private applyHover(): void {
    if (this.busy || !this.state?.delve || this.pv || this.parleyHero) {
      this.hideCard();
      this.dio.showSight(null);
      return;
    }
    const at = this.hoverAt;
    const unitId = this.hoverUnit;
    const sel = this.selected();
    this.dio.showRearHalf(null);
    // V4.0 HUD (spec 27): hovering a monster or crew member shades the floor it sees, for a walking hero.
    this.showWash(unitId);
    if (this.facing) {
      const toward = at ?? (unitId ? this.targetPos({ id: unitId }) : null);
      const f = sel && toward && toward.level === sel.at.level && !samePos(toward, sel.at) ? dirToward(sel.at, toward) : undefined;
      this.dio.showPath(null);
      this.dio.showRisks(null);
      this.dio.showFacing(sel && f !== undefined ? sel.at : null, f);
      if (sel && f !== undefined) this.showCard(`face:${posKey(toward!)}`, [{ html: `<b>Face ${this.facingWords(sel.at, f)}</b> <span class="dim">· free</span>` }, { html: `Click to turn ${this.heroDef(sel.heroId)?.name ?? ''}. Esc: cancel.`, cls: 'foot' }]);
      else this.hideCard();
      return;
    }
    if (this.pending) this.showHot();
    // Path preview.
    const r = at && !unitId && !this.pending ? this.reach.find((x) => samePos(x.to, at)) : undefined;
    this.hoverLong = null;
    const free = this.freeMove();
    if (r && sel) {
      this.dio.showPath(r.path, pathEndFacing(sel.at, r.path, sel.facing));
      this.dio.showRipple(r.to, this.engine.moveNoise(this.state, sel.heroId, this.sneak));
      this.dio.showRisks(r.risks ?? null);
    } else if (free && at && !unitId && !this.pending && sel && this.vis) {
      this.hoverLong = longPath(this.engine.castle(), this.state, this.vis, sel.heroId, at);
      this.dio.showPath(this.hoverLong, this.hoverLong ? pathEndFacing(sel.at, this.hoverLong, sel.facing) : undefined);
      this.dio.showRipple(null, 0);
      this.dio.showRisks(null);
    } else if (!this.pending) {
      this.dio.showPath(null);
      this.dio.showRipple(null, 0);
      this.dio.showRisks(null);
    }
    // The card beside the cursor.
    const key = `${unitId ?? ''}|${at ? posKey(at) : ''}|${this.selectedId}|${this.pending?.action ?? ''}|${this.full ? 'F' : ''}`;
    if (key === this.cardKey && !this.card.classList.contains('hidden')) {
      this.placeCard();
      return;
    }
    const lines = this.cardFor(unitId, at, r);
    if (lines.length) this.showCard(key, lines);
    else this.hideCard();
    if (unitId) this.dio.setHoverStyle('plain');
    else if (at) this.dio.setHoverStyle(this.hoverKind(at));
  }

  /** The hover card for what's under the mouse: three lines, or the full rules card. */
  private cardFor(unitId: string | null, at: Pos | null, r: Reach | undefined): CardLine[] {
    const d = this.state!.delve!;
    const sel = this.selected();
    // Picking a target: the target card.
    if (this.pending) {
      const best = this.bestActionFor(unitId, at);
      if (best) return this.targetCard(best.option, best.target);
    }
    // Pointing at an enemy a click would attack: the target card (what the click does), the rules on Alt.
    if (unitId && !this.full) {
      const best = this.bestActionFor(unitId, at);
      if (best && !best.option.blocked && (best.option.action === 'attack' || best.option.action === 'firebolt')) return this.targetCard(best.option, best.target, true);
    }
    if (unitId) {
      const m = d.monsters.find((x) => x.id === unitId);
      const hero = d.heroes.find((x) => x.heroId === unitId);
      const rival = d.rivals?.members.find((x) => x.id === unitId);
      let lines: CardLine[] = [];
      if (m) lines = this.full ? this.monsterLines(m).map((html) => ({ html })) : this.monsterCard(m);
      else if (hero) lines = this.heroCard(hero);
      else if (rival) lines = this.rivalCard(rival);
      else if (d.prisoner?.id === unitId) lines = [{ html: `<b>${esc(d.prisoner.name)}</b> <span class="dim">${d.prisoner.freed ? 'freed, following' : 'shackled'}</span>` }, { html: d.prisoner.freed ? 'Bring them to a way out.' : 'Unshackle them (lockpicks, an improvised pick or a key), or carry them out.' }, { html: `HP ${d.prisoner.hp}/5`, cls: 'dim' }];
      const act = this.bestActionFor(unitId, at);
      const link = unitId === this.selectedId ? this.linkHere() : null;
      const exit = unitId === this.selectedId ? this.exitHere() : null;
      if (link) lines.push({ html: `Click: ${esc(linkButton(link.info))}`, cls: 'act' });
      else if (exit?.option && !exit.option.blocked) lines.push({ html: 'Click: Leave the castle', cls: 'act' });
      else if (act) lines.push(this.clickLine(act.option, act.target));
      // V4.1 (WS6, spec 31.8): a Ranger's bow shot that has nothing to loose says why.
      const dry = this.options.find((o) => o.blocked && ['hamstring', 'knockback', 'overwatch'].includes(o.action) && o.targets.some((t) => !t.id || t.id === unitId));
      if (dry && (m || rival) && !act) lines.push({ html: `${esc(dry.blocked!)}${dry.blocked === 'Out of arrows' ? ` · the knife reaches only next to ${esc(this.heroDef(this.selectedId ?? '')?.name ?? 'you')}` : ''}`, cls: 'bad' });
      // V4.1 (spec 31.11): next to the shackled captive with no lock tool: say what Unshackle takes (Carry stays the way out).
      const noTool = d.prisoner?.id === unitId ? this.options.find((o) => o.action === 'unshackle' && o.blocked) : undefined;
      if (noTool && act?.option !== noTool) lines.push({ html: esc(noTool.blocked!), cls: 'bad' });
      return lines;
    }
    if (!at) return [];
    const out: CardLine[] = [];
    if (r && sel) out.push(...this.moveCard(r, sel));
    else if (this.hoverLong) {
      const n = this.hoverLong.length;
      out.push({ html: `<b>Free move</b> <span class="dim">· ${this.sneak ? 'sneak' : 'walk'} ${n} hexes</span>` }, { html: `${this.calmWords(n)}${this.follow ? ' · the party follows' : ''}`, cls: 'dim' });
    } else if (this.freeMove() && !this.pending && !sel?.moved) {
      const why = this.longPathWhy(at);
      if (why) out.push({ html: why, cls: 'dim' });
    }
    // V3.9 (24.5): a backstab spot under the mouse.
    if (sel && this.heroDef(sel.heroId)?.cls === 'burglar' && this.vis && !this.pending) {
      const spot = backstabSpots(this.state!, sel.heroId, this.reach.map((x) => x.to), this.seenEnemies(), this.vis.visible).find((x) => samePos(x.at, at));
      if (spot) out.push({ html: `🗡 Backstab from here: ${esc(this.theName(spot.target))}${this.full ? ` · +${V39.backstabSlots} slot, ${V39.backstabMult === 2 ? 'double' : `×${V39.backstabMult}`} damage per hit` : ''}`, cls: 'good' });
    }
    // V3.9.3 (24.8): a heard sound under the mouse.
    const heard = (d.heard ?? []).filter((x) => samePos(x.at, at));
    if (heard.length) {
      out.push(...heard.map((x) => ({ html: `<b>${heardIcon(x)} ${esc(heardTitle(x))}</b>` })));
      if (this.full) out.push({ html: esc(FACING_HELP.hearing), cls: 'dim' });
    }
    const desc = this.describeHex(at);
    if (desc && !(r && !this.full && !this.hoverKindInteract(at))) out.push({ html: desc });
    const link = sel && samePos(sel.at, at) ? this.linkHere() : null;
    const exit = sel && samePos(sel.at, at) ? this.exitHere() : null;
    const act = this.bestActionFor(null, at);
    if (link) out.push({ html: `Click: ${esc(linkButton(link.info))}`, cls: 'act' });
    else if (exit?.option && !exit.option.blocked) out.push({ html: 'Click: Leave the castle', cls: 'act' });
    // V4.0 (spec 30.4): blocked options are hidden from the hotbar, so the card under the mouse must say why, even on
    // a hex the hero could also walk to ("Take: your pack is full").
    else if (act && (!r || act.option.blocked)) out.push(this.clickLine(act.option, act.target));
    return out;
  }

  private hoverKindInteract(at: Pos): boolean {
    return this.hoverKind(at) !== 'plain';
  }

  /** "Click: Attack · kills it about half the time" (or why not). */
  private clickLine(o: ActionOption, t: ActionTarget): CardLine {
    if (o.blocked) return { html: `${esc(o.label)}: ${esc(o.blocked)}`, cls: 'bad' };
    if (o.rolls && (o.action === 'attack' || SPELLS.has(o.action) || o.action === 'knockback' || o.action === 'hamstring')) {
      const pr = this.previewFor(o, t);
      if (pr?.ok) {
        const read = readRoll(pr, 0, this.hpOf(t), this.itWord(t));
        return { html: `Click: ${esc(o.label)} · ${esc(read.headline.charAt(0).toLowerCase() + read.headline.slice(1))}`, cls: 'act' };
      }
    }
    return { html: `Click: ${esc(o.label)}`, cls: 'act' };
  }

  /** V4.0 HUD (spec 27): the hovered watcher's sight wash; cached per state and watcher. */
  private showWash(unitId: string | null): void {
    const d = this.state?.delve;
    if (!unitId || !d || typeof this.engine.sightWash !== 'function') {
      this.dio.showSight(null);
      return;
    }
    const m = d.monsters.find((x) => x.id === unitId);
    const r = d.rivals?.members.find((x) => x.id === unitId);
    const awake = m ? m.awareness !== 'asleep' && m.kind !== 'gloam' : !!r && d.rivals?.stance !== 'hired';
    if (!awake || (!m && !r)) {
      this.dio.showSight(null);
      return;
    }
    const w = this.washFor(unitId, false, false);
    const vis = this.vis?.visible;
    const keep = (p: Pos) => !vis || vis.has(posKey(p));
    this.dio.showSight(w.front.filter(keep), w.side.filter(keep));
  }

  private washFor(id: string, sneaking: boolean, quiet: boolean): { front: Pos[]; side: Pos[] } {
    const k = `${id}|${sneaking ? 1 : 0}|${quiet ? 1 : 0}`;
    let w = this.washCache.get(k);
    if (!w) {
      try {
        w = this.engine.sightWash?.(this.state!, id, sneaking, quiet) ?? { front: [], side: [] };
      } catch {
        w = { front: [], side: [] };
      }
      this.washCache.set(k, w);
    }
    return w;
  }

  private showCard(key: string, lines: CardLine[]): void {
    this.cardKey = key;
    this.card.innerHTML = lines.map((l) => `<div class="dl-card-l ${l.cls ?? ''}">${l.html}</div>`).join('');
    this.card.classList.toggle('full', this.full);
    this.card.classList.remove('hidden');
    this.placeCard();
  }

  /**
   * Beside what you point at: right of a hovered figure (clear of it and its tag), else right of the cursor;
   * to the left near the right edge; never under the top strip or the hotbar.
   */
  private placeCard(): void {
    const w = this.card.offsetWidth;
    const th = this.card.offsetHeight;
    const u = this.hoverUnit ? this.dio.unitScreen(this.hoverUnit) : null;
    const ax = u && !u.behind ? u.x : this.mouse.x;
    const gap = u && !u.behind ? 48 : 26;
    let x = ax + gap;
    if (x + w > innerWidth - 12) x = ax - gap - w;
    x = Math.max(8, x);
    const top = 84;
    const bottom = innerHeight - (this.bar.offsetHeight || 96) - 24;
    let y = u && !u.behind ? u.y - 12 : this.mouse.y - th / 2;
    y = Math.max(top, Math.min(bottom - th, y));
    this.card.style.transform = `translate(${Math.round(x)}px, ${Math.round(Math.max(8, y))}px)`;
  }

  private hideCard(): void {
    this.cardKey = '';
    this.card.classList.add('hidden');
  }

  // ------------------------------------------------------------ hover cards

  /** "the orc" for a plain monster, its name otherwise (crew members, heroes, named monsters). */
  private theName(id: string): string {
    const d = this.state?.delve;
    const m = d?.monsters.find((x) => x.id === id);
    if (m) {
      const plain = MONSTERS[m.kind]?.name;
      return plain && m.name.toLowerCase() === plain.toLowerCase() ? `the ${m.name.toLowerCase()}` : m.name;
    }
    return this.nameOf(id);
  }

  /** " in the courtyard": the room a figure stands in, to tell two of a kind apart. */
  private roomOf(id: string): string {
    const at = this.targetPos({ id });
    if (!at) return '';
    const lv = this.engine.castle().levels.find((l) => l.level === at.level);
    const room = lv?.rooms.find((r) => r.id === lv.tiles[hexKey(at)]?.room)?.name;
    if (!room) return '';
    const words = room.split(/\s+/);
    const proper = words.length > 1 && words.every((w) => /^[A-Z]/.test(w));
    return ` in the ${/^the /i.test(room) ? room.slice(4) : proper ? room : room.toLowerCase()}`;
  }

  /** "it" for a monster, the name for anyone else. */
  private itWord(t: ActionTarget): string {
    const d = this.state?.delve;
    if (!t.id || !d) return 'it';
    return d.monsters.some((m) => m.id === t.id) ? 'it' : this.nameOf(t.id);
  }

  private hpOf(t: ActionTarget): number | null {
    const d = this.state?.delve;
    if (!t.id || !d) return null;
    const m = d.monsters.find((x) => x.id === t.id);
    if (m) return m.kind === 'gloam' ? null : m.hp;
    const r = d.rivals?.members.find((x) => x.id === t.id);
    if (r) return r.hp;
    return null;
  }

  private previewFor(o: ActionOption, t: ActionTarget): RollPreview | null {
    const sel = this.selected();
    if (!sel || !this.state) return null;
    const ta = this.withArrow(o, t); // V4.1 (WS6): with the picked arrow
    const k = `${sel.heroId}|${o.action}|${t.id ?? ''}|${t.at ? posKey(t.at) : ''}|${t.itemId ?? ''}|${t.fuse ?? ''}|${ta.arrow ?? ''}`;
    let pr = this.pvCache.get(k);
    if (!pr) {
      try {
        pr = this.engine.preview(this.state, sel.heroId, o.action, ta);
      } catch {
        return null;
      }
      this.pvCache.set(k, pr);
    }
    return pr;
  }

  /** The mood words: "unaware, at its post", "searching", "hunting Corin". */
  private moodWords(m: Monster): string {
    if (m.kind === 'gloam') return 'the dark itself';
    if (m.awareness === 'asleep') return 'asleep';
    if (m.awareness === 'hunting') {
      const it = this.intents[m.id];
      return it?.targetId ? `hunting ${this.nameOf(it.targetId)}` : 'hunting';
    }
    if (m.awareness === 'alert' && m.searchRounds !== undefined) return 'searching';
    return m.awareness === 'patrol' ? 'unaware, on patrol' : 'unaware, at its post';
  }

  /** "strikes Corin, 0–5 damage" for the card (the tag over its head has only the icon). */
  private intentLine(it: Intent | undefined, id?: string): string {
    if (!it || it.kind === 'wait') return '';
    return intentText(this.state!, it, id);
  }

  /** Where the selected hero stands for this watcher, and whether it would see them there. */
  private relationLine(id: string, at: Pos, noticed: string[], asleep: boolean): CardLine | null {
    const sel = this.selected();
    const s = this.state;
    if (!sel || !s || sel.status !== 'active') return null;
    const me = this.heroDef(sel.heroId)?.name ?? 'you';
    if (asleep) return { html: 'Asleep: it hears, it doesn\'t see. Walking near may wake it.', cls: 'dim' };
    if (at.level !== sel.at.level) return { html: 'On another level.', cls: 'dim' };
    if (noticed.includes(sel.heroId)) return { html: `It has seen ${esc(me)}: it knows where ${esc(me)} is.`, cls: 'bad' };
    const u = s.delve!.monsters.find((x) => x.id === id) ?? s.delve!.rivals?.members.find((x) => x.id === id);
    const f = u ? facingOf(u) : undefined;
    const dist = distance(at, sel.at);
    const sneaking = this.sneak;
    const quiet = sneaking && this.heroDef(sel.heroId)?.cls === 'burglar';
    let where = 'in front of it';
    let seen: boolean;
    const bearing = f === undefined ? 'front' : this.sightBearing(at, f, sel.at) ?? 'front';
    if (bearing === 'back') {
      where = 'straight behind it';
      seen = !sneaking && dist === 1;
    } else {
      if (bearing === 'side') where = 'at its side';
      if (typeof this.engine.sightWash === 'function') {
        const w = this.washFor(id, sneaking, quiet);
        seen = [...w.front, ...w.side].some((p) => samePos(p, sel.at));
      } else {
        // An engine without the sight query: the rule by distance alone (spec 27), no line of sight or light.
        const m = s.delve!.monsters.find((x) => x.id === id);
        const unaware = !!m && m.awareness !== 'hunting' && !(m.awareness === 'alert' && m.searchRounds !== undefined);
        if (bearing === 'side' && unaware) seen = dist === 1 ? !(sneaking && quiet) : !sneaking && dist <= V37.sideWalk;
        else seen = dist <= (sneaking ? V37.noticeLitSneak : V37.noticeLitWalk);
      }
    }
    return { html: `You're ${where}, ${dist} away, ${sneaking ? 'sneaking' : 'walking'}: ${seen ? 'it will see you' : 'it won\'t see you'}.`, cls: seen ? 'bad' : 'good' };
  }

  /** The short monster card: name and mood; what it will do (or how it looks); where you stand for it. */
  private monsterCard(m: Monster): CardLine[] {
    const out: CardLine[] = [{ html: `<b>${esc(m.name)}</b> <span class="dl-card-k">${esc(this.moodWords(m))}</span>` }];
    const it = this.intentLine(this.intents[m.id], m.id);
    if (m.kind === 'gloam') out.push({ html: esc(MONSTER_NOTE.gloam) });
    else if (it) out.push({ html: `Next: ${esc(it)}`, cls: 'bad' });
    else if (m.awareness === 'asleep') out.push({ html: 'Sees nothing; wakes by sound.' });
    else if (m.awareness === 'hunting' || (m.awareness === 'alert' && m.searchRounds !== undefined)) out.push({ html: 'Looks ahead and to its sides. Nothing straight behind.' });
    else out.push({ html: `Looks ahead. At its sides it catches only a walker within ${V37.sideWalk}, or anyone right beside it.` });
    if (m.poisoned) out.push({ html: esc(venomLine(m)), cls: 'good' });
    const rel = m.kind === 'gloam' || m.kind === 'dragon' ? null : this.relationLine(m.id, m.at, m.noticedIds ?? [], m.awareness === 'asleep');
    if (rel) out.push(rel);
    return out;
  }

  /**
   * V4.1 (spec 31.4, pillar 15): a downed hero's line: the bleed-out count (it decides what you do) and what saves them.
   * Carried, they don't bleed; with splints they crawl.
   */
  downLine(hero: HeroInDelve): string {
    const d = this.state?.delve;
    const carrier = d?.heroes.find((x) => x.carrying === hero.heroId && x.status === 'active');
    if (carrier) return `On ${this.nameOf(carrier.heroId)}'s shoulders: not bleeding. A potion or Mend gets them up; out by an exit, they live (1 HP).`;
    const dragger = d?.rivals?.members.find((r) => r.dragging === hero.heroId && r.hp > 0 && !r.goneOut);
    if (dragger) return `${dragger.name} is carrying them off!`;
    const crawl = this.state && pairsHome(this.state.campaign.village, 'smith', 'surgeon') ? ' Splints: they can crawl 1 a turn.' : '';
    return `Dies in ${turnsWord(hero.bleed)}. A potion from next to them gets them up (5), Mend within 3 (2); or Carry them out.${crawl}`;
  }

  private heroCard(hero: HeroInDelve): CardLine[] {
    const def = this.heroDef(hero.heroId);
    const out: CardLine[] = [{ html: `<b>${esc(def?.name ?? hero.heroId)}</b> <span class="dl-card-k">${def ? esc(className(def.cls)) : ''}${def ? ` · level ${def.level}` : ''}</span>` }];
    if (hero.status === 'downed') out.push({ html: esc(this.downLine(hero)), cls: 'bad' });
    else out.push({ html: `HP ${hero.hp} of ${def?.maxHp ?? '?'}${this.full ? ` · Focus ${hero.focus}` : ''}${hero.moveMode === 'sneak' ? ' · sneaking' : ''}` });
    if (hero.poisoned) out.push({ html: esc(POISON_TIP), cls: 'bad' });
    if (hero.carrying) out.push({ html: `Carrying ${esc(this.nameOf(hero.carrying))}.`, cls: 'dim' });
    const hf = facingOf(hero);
    if (hf !== undefined && hero.status === 'active' && this.full) out.push({ html: `Faces ${this.facingWords(hero.at, hf)} (the way they last moved or acted): blind only straight behind.`, cls: 'dim' });
    if (this.backExposed(hero.heroId)) out.push({ html: 'Back exposed: nobody covers the hex behind them.', cls: 'bad' });
    return out;
  }

  private rivalCard(rival: import('../game/types').Rival): CardLine[] {
    const d = this.state!.delve!;
    const cr = d.rivals!;
    const st = STANCE[cr.stance];
    const out: CardLine[] = [{ html: `<b>${esc(rival.name)}</b> <span class="dl-card-k">${esc(cr.name)} · ${esc(st.name.toLowerCase())}</span>` }];
    const it = this.intents[rival.id] ?? rival.intent;
    if (rival.downed) out.push({ html: `Down: dies in ${turnsWord(rival.bleed ?? 1)} unless a crewmate gets them up. Any hit finishes them.`, cls: 'good' });
    else if (it && it.kind !== 'wait') out.push({ html: `Next: ${esc(intentText(this.state!, it, rival.id))}`, cls: cr.stance === 'hired' ? 'good' : 'bad' });
    else out.push({ html: esc(st.text) });
    if (rival.poisoned) out.push({ html: esc(venomLine(rival)), cls: 'good' });
    if (this.full) {
      out.push({ html: `HP ${rival.hp}/${rival.maxHp}${rival.cls ? ` · ${esc(className(rival.cls))}` : ''}${rival.level ? ` L${rival.level}` : ''}`, cls: 'nums' });
      const line = crewMemberLine(rival);
      if (line) out.push({ html: esc(line), cls: 'dim' });
      out.push({ html: esc(CREW_KIT[rival.cls] ?? RIVAL_KIT[rival.cls] ?? ''), cls: 'dim' });
      if (cr.spotted && cr.stance !== 'hired') out.push({ html: `Goal: ${GOAL_TEXT[cr.goal]}${cr.aim ? ` · after ${esc(cr.aim.what)}` : ''}`, cls: 'dim' });
      const rf = facingOf(rival);
      if (rf !== undefined && cr.stance !== 'hired') out.push({ html: `Faces ${this.facingWords(rival.at, rf)}: blind only straight behind.`, cls: 'dim' });
    }
    if ((rival.feared ?? 0) > 0) out.push({ html: `Feared · ${rival.feared} turn${rival.feared === 1 ? '' : 's'}: runs from ${esc(this.nameOf(rival.fearOf ?? ''))}.`, cls: 'fear' });
    if (rival.dragging) out.push({ html: `Dragging ${esc(this.nameOf(rival.dragging))} toward the way out. Kill, down or fear them to free ${esc(this.nameOf(rival.dragging))}.`, cls: 'bad' });
    if (cr.stance !== 'hired') {
      const rel = this.relationLine(rival.id, rival.at, rival.noticedIds ?? (cr.stance === 'hostile' ? d.heroes.map((x) => x.heroId) : []), false);
      if (rel) out.push(rel);
    }
    const sel = this.selected();
    if (sel && this.dealsFor(sel.heroId).length) out.push({ html: cr.stance === 'hostile' ? 'Parley (B): buy a truce' : 'Click: Parley', cls: 'act' });
    return out;
  }

  /** The move preview card: "Walk here · 3 of 4 moves", then what the move risks, in words. */
  private moveCard(r: Reach, sel: HeroInDelve): CardLine[] {
    const free = this.freeMove();
    const out: CardLine[] = [];
    const n = r.path.length;
    const mode = r.dash ? (this.sneak ? 'Dash, sneaking' : 'Dash') : this.sneak ? 'Sneak' : 'Walk';
    if (free) out.push({ html: `<b>Free move</b> <span class="dl-card-k">${this.sneak ? 'sneak' : 'walk'} ${n} hex${n === 1 ? '' : 'es'}</span>` }, { html: this.calmWords(n), cls: 'dim' });
    else {
      const budget = this.moveBudget(sel, this.sneak);
      out.push({ html: `<b>${mode} here</b> <span class="dl-card-k">${r.cost} of ${budget} move${budget === 1 ? '' : 's'}${r.dash ? ' · uses the action' : ''}</span>` });
    }
    out.push(...this.riskCardLines(r.risks));
    // V4.0 (spec 29.5): a spotted trap on the way, in words (the venom kind especially).
    const traps = this.state?.delve?.traps ?? {};
    const onPath = r.path.map((p) => traps[posKey(p)]).filter((t): t is NonNullable<typeof t> => !!t && t.spotted);
    if (onPath.some((t) => t.venom)) out.push({ html: `${iconSvg('venom', 14)} A poison trap on the way: 1 damage, and poisoned (−1 a turn, never below 1)`, cls: 'rk bad' });
    else if (onPath.length) out.push({ html: `${iconSvg('trap', 14)} A trap on the way: 3 damage`, cls: 'rk bad' });
    if (sel.carrying) out.push({ html: `Carrying ${esc(this.nameOf(sel.carrying))}: they come along, on your hex.`, cls: 'dim' });
    const noticeMe = (r.risks?.notice ?? []).some((x) => !x.hero || x.hero === sel.heroId);
    if (noticeMe && !this.sneak) {
      const alt = this.otherReachAt(r.to);
      if (alt && !(alt.risks?.notice ?? []).some((x) => !x.hero || x.hero === sel.heroId)) out.push({ html: 'Sneak (S) and it won\'t, from there.', cls: 'hint' });
    }
    if (this.full) out.push({ html: `Noise ${this.engine.moveNoise(this.state!, sel.heroId, this.sneak)}${this.sneak ? '' : ' per hex'} · ${n} hex${n === 1 ? '' : 'es'} walked`, cls: 'nums' });
    return out;
  }

  /** The same destination in the other move mode (computed once per hero and state). */
  private otherReachAt(to: Pos): Reach | undefined {
    const sel = this.selected();
    if (!sel || !this.state) return undefined;
    if (!this.otherReach) {
      try {
        this.otherReach = this.engine.reachable(this.state, sel.heroId, !this.sneak);
      } catch {
        this.otherReach = [];
      }
    }
    return this.otherReach.find((x) => samePos(x.to, to));
  }

  /** V4.0 HUD: the selected hero's move allowance this move (mirrors the engine's moveBudget, spec 26.4). */
  private moveBudget(h: HeroInDelve, sneak: boolean): number {
    const cls = this.heroDef(h.heroId)?.cls;
    let b = sneak ? (cls === 'burglar' || h.ale === 'smuggler' ? SMUGGLER_SNEAK : 2) : cls === 'burglar' ? BURGLAR_WALK : WALK_MOVE;
    if (h.status === 'downed') return 1; // V4.1 (spec 31.4): a crawl (splints)
    if (h.pack.some((i) => i.heavy)) b = Math.min(b, HEAVY_MOVE);
    if (h.carrying) b = Math.min(b, CARRY_MOVE); // V4.1 (spec 31.4)
    return b;
  }

  /** What a move risks, as card lines: who sees whom, who may wake, who swings. */
  private riskCardLines(risks: MoveRisks | undefined): CardLine[] {
    if (!risks) return [];
    const out: CardLine[] = [];
    const me = this.selectedId;
    const seers = new Map<string, string[]>();
    for (const n of risks.notice) {
      const who = !n.hero || n.hero === me ? 'you' : this.nameOf(n.hero);
      const l = seers.get(n.id) ?? [];
      if (!l.includes(who)) l.push(who);
      seers.set(n.id, l);
    }
    // Two orcs in one card: say which ("the orc in the courtyard").
    const ids = [...seers.keys(), ...risks.wake.map((w) => w.id), ...risks.swings.map((w) => w.id)];
    const plain = ids.map((id) => this.theName(id));
    const named = (id: string) => {
      const n = this.theName(id);
      return plain.filter((x) => x === n).length > 1 || new Set(ids.filter((x) => this.theName(x) === n)).size > 1 ? `${n}${this.roomOf(id)}` : n;
    };
    for (const [id, who] of seers) out.push({ html: `${iconSvg('eye', 14)} ${esc(cap(named(id)))} will see ${esc(who.join(', then '))}`, cls: 'rk bad' });
    for (const w of risks.wake) out.push({ html: `${iconSvg('zz', 14)} May wake ${esc(named(w.id))}, ${oddsWords(w.chance)}${this.full ? ` (${Math.round(w.chance)}%)` : ''}`, cls: 'rk warn' });
    for (const sw of risks.swings) out.push({ html: `${iconSvg('sword', 14)} ${esc(cap(named(sw.id)))} gets a free swing${this.full ? ` (${sw.damage[0]}–${sw.damage[1]} damage)` : ''}`, cls: 'rk bad' });
    if (!out.length && this.sneak) out.push({ html: 'Nobody stirs.', cls: 'dim' });
    return out;
  }

  /** The target card: what this action does to this target, in words; the numbers on Alt. */
  private targetCard(o: ActionOption, t: ActionTarget, unarmed = false): CardLine[] {
    const sel = this.selected();
    const def = sel ? this.heroDef(sel.heroId) : undefined;
    const who = def?.name ?? '';
    const out: CardLine[] = [];
    const tName = t.id ? this.theName(t.id) : this.targetLabel(t).toLowerCase();
    const title = o.action === 'attack' ? `Attack ${tName}` : `${o.label}${t.id || t.at ? ` · ${tName}` : ''}`;
    const sub = o.action === 'attack' && def && sel ? `${who} · ${weaponNow(def.cls, sel.pack).name.toLowerCase()}` : o.mana ? `${who} · ${o.mana} mana` : who;
    out.push({ html: `<b>${esc(cap(title))}</b> <span class="dl-card-k">${esc(sub)}</span>` });
    if (o.blocked) {
      out.push({ html: esc(o.blocked), cls: 'bad' });
      return out;
    }
    const pr = o.rolls || o.action === 'jump' || (o.area ?? 0) > 0 ? this.previewFor(o, t) : null;
    if (pr && !pr.ok) {
      out.push({ html: esc(pr.reason ?? 'Not possible.'), cls: 'bad' });
      return out;
    }
    if (pr && pr.slots > 0) {
      const read = readRoll(pr, 0, this.hpOf(t), this.itWord(t));
      out.push({ html: esc(read.headline), cls: 'head' }, { html: esc(read.sub), cls: 'sub' });
      const al = this.arrowLine(o, t); // V4.1 (WS6): which arrow
      if (al) out.push({ html: `➳ ${esc(al.text)}`, cls: 'dim' });
      const chips = pr.modifiers.map((m) => modifierChip(m, who)).filter((c): c is NonNullable<typeof c> => !!c);
      if (chips.length) out.push({ html: chips.map((c) => `<span class="dl-chip ${c.good ? 'good' : 'bad'}">${c.good ? '▲' : '▼'} ${esc(c.text)}</span>`).join(' '), cls: 'chips' });
      if (this.full) {
        out.push({ html: `${pr.slots} tries of ${statName(pr.stat)} · ${pr.chance}% each`, cls: 'nums' });
        out.push({ html: pr.outcomes.map((x, k) => `${k}: ${esc(x)}`).join(' · '), cls: 'nums' });
      }
    } else if (pr) {
      for (const x of pr.outcomes.slice(0, 3)) out.push({ html: esc(x), cls: /fall|pit/i.test(x) ? 'bad' : '' });
      if (pr.warning) out.push({ html: esc(pr.warning), cls: 'bad' });
    } else if (this.full) out.push({ html: esc(actionHelp(o.action, def?.cls)), cls: 'dim' });
    const tint = t.id ? this.intents[t.id] ?? this.state?.delve?.rivals?.members.find((r) => r.id === t.id)?.intent : undefined;
    // V4.0 (spec 29.3): the venom dart in words.
    if (o.action === 'venomdart' && pr && pr.ok) out.splice(1, 0, { html: `${esc(pr.outcomes[1] ?? 'Poisons it')} if it hits.`, cls: 'head' });
    if (tint && tint.kind !== 'wait' && pr && pr.slots > 0) out.push({ html: `Then: ${esc(intentText(this.state!, tint, t.id))} next turn, unless you stop it.`, cls: 'then' });
    if (unarmed && t.id) {
      const m = this.state?.delve?.monsters.find((x) => x.id === t.id);
      if (m) out.splice(1, 0, { html: `${esc(cap(this.moodWords(m)))}`, cls: 'dim' });
    }
    out.push({ html: pr ? 'Click to line up the roll · Alt for the numbers' : `Click: ${esc(o.label)}`, cls: 'foot' });
    return out;
  }

  private areaDrawn = '';
  /** Highlight the area a hex action would cover around `at` (null: just the valid targets). */
  /** V4.0 (spec 30.3): the armed action's options, one per hex or figure (a charge's two fuses are one option). */
  private pickOrder(): ActionTarget[] {
    const o = this.pending;
    if (!o) return [];
    const seen = new Set<string>();
    const out: ActionTarget[] = [];
    for (const t of o.targets) {
      const k = `${t.id ?? ''}|${t.at ? posKey(t.at) : ''}|${t.itemId ?? ''}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
    return out;
  }

  /** The option a click or Enter takes now: the pill entry under the mouse, the keyboard's choice, or the mouse's. */
  private hotTarget(): ActionTarget | null {
    if (!this.pending) return null;
    if (this.listHot) return this.listHot;
    if (this.keyNav && this.hotIdx >= 0) return this.pickOrder()[this.hotIdx] ?? null;
    return this.bestActionFor(this.hoverUnit, this.hoverAt)?.target ?? null;
  }

  /** How the chosen option is marked: a foe (red), a friend (green), a drop (danger) or a hex (pale). */
  private hotKind(o: ActionOption, t: ActionTarget): 'foe' | 'ally' | 'hex' | 'danger' {
    if (o.action === 'jump') return 'danger';
    const d = this.state?.delve;
    if (t.id && d?.heroes.some((x) => x.heroId === t.id)) return 'ally';
    if (t.id && (d?.monsters.some((m) => m.id === t.id) || d?.rivals?.members.some((m) => m.id === t.id))) return o.action === 'parley' || o.action === 'bribe' ? 'hex' : 'foe';
    if (o.pick === 'ally') return 'ally';
    return 'hex';
  }

  /**
   * V4.0 (spec 30.3): mark "this one" among the armed action's options: a bright lifted ring on its hex (the others
   * dimmed), its tag lit, its landing (jump, shove, knockback) or the area it hits (throws, fireball, gust, charges), the
   * pill entry, and the pill's "Enter: ..." line.
   */
  private showHot(): void {
    const o = this.pending;
    if (!o || this.pv || this.pill.classList.contains('fuse')) return;
    const t = this.hotTarget();
    const at = t ? this.targetPos(t) : null;
    if (o.area || ['setCharge', 'setTripwire', 'throwCharge', 'charge'].includes(o.action)) this.drawPendingArea(t && t.at ? t.at : at);
    this.dio.showLanding(null, null, '', false);
    if (t) this.showActionLanding(o.action, t);
    const d = this.state?.delve;
    const unit = t?.id && (d?.heroes.some((x) => x.heroId === t.id) || d?.monsters.some((m) => m.id === t.id) || d?.rivals?.members.some((m) => m.id === t.id) || d?.prisoner?.id === t.id) ? t.id : null;
    this.dio.showPick(at, t ? this.hotKind(o, t) : 'hex', unit);
    const key = (x: ActionTarget) => `${x.id ?? ''}|${x.at ? posKey(x.at) : ''}|${x.itemId ?? ''}`;
    const hk = t ? key(t) : '';
    for (const b of this.pill.querySelectorAll<HTMLElement>('.dl-pill-opt[data-pick]')) b.classList.toggle('hot', b.dataset.pick === hk);
    const line = this.pill.querySelector<HTMLElement>('.dl-pill-hot');
    if (line) {
      const sel = this.selected();
      const tp = t ? this.targetPos(t) : null;
      line.textContent = t ? `${this.targetLabel(t)}${sel && tp && !samePos(tp, sel.at) && tp.level === sel.at.level ? ` · ${compass(sel.at, tp)}` : ''}` : '';
      line.classList.toggle('hidden', !t);
    }
  }

  /** V4.0 (spec 30.3): Tab / arrows step through the armed action's options; Enter takes the marked one. */
  private stepHot(dir: 1 | -1): void {
    const order = this.pickOrder();
    if (!order.length) return;
    const cur = this.hotTarget();
    const k = (x: ActionTarget) => `${x.id ?? ''}|${x.at ? posKey(x.at) : ''}|${x.itemId ?? ''}`;
    const i = cur ? order.findIndex((x) => k(x) === k(cur)) : -1;
    this.hotIdx = i < 0 ? (dir > 0 ? 0 : order.length - 1) : (i + dir + order.length) % order.length;
    this.keyNav = true;
    this.listHot = null;
    const p = this.targetPos(order[this.hotIdx]!);
    if (p && p.level !== this.dio.shownLevel) this.dio.showLevel(p.level);
    this.showHot();
  }

  private resetHot(): void {
    this.hotIdx = -1;
    this.keyNav = false;
    this.listHot = null;
  }

  private drawPendingArea(at: Pos | null): void {
    const key = at ? posKey(at) : '';
    if (key === this.areaDrawn || !this.pending) return;
    this.areaDrawn = key;
    this.dio.clearHighlights();
    const ats = this.pending.targets.map((t) => this.targetPos(t)).filter((p): p is Pos => !!p);
    const charge = this.pending.action === 'setCharge' || this.pending.action === 'throwCharge' || this.pending.action === 'charge';
    if (charge) {
      const castle = this.engine.castle();
      const walls = ats.filter((p) => breakableWall(castle, p));
      this.dio.highlight(walls, 'breakable');
      this.dio.highlight(ats.filter((p) => !walls.some((w) => samePos(w, p))), 'dash');
      if (at) this.showBlastOutcomes(at);
      return;
    }
    this.dio.highlight(ats, 'dash');
    if (at && this.pending.area) this.dio.highlight(this.areaAround(at, this.pending.area), 'area');
  }

  /** 20.3a: the three things a blast at `at` does to the ground, by colour: break (walls), collapse (floor into the pit), rubble. */
  private showBlastOutcomes(at: Pos): { breaks: Pos[]; collapses: Pos[]; rubbles: Pos[]; hit: string[] } {
    const pv = this.blastPlan(at);
    this.dio.highlight(pv.breaks, 'breakable');
    this.dio.highlight(pv.collapses, 'collapse');
    this.dio.highlight(pv.rubbles, 'rubble');
    this.dio.highlight(this.areaAround(at, 2).filter((p) => !this.areaAround(at, 1).some((q) => samePos(p, q))), 'area');
    this.dio.highlight([at], 'target');
    return pv;
  }

  /** The engine's blast plan (Engine.blastPreview), else the view's reading of the rule. */
  private blastPlan(at: Pos): { breaks: Pos[]; collapses: Pos[]; rubbles: Pos[]; hit: string[] } {
    const s = this.state;
    if (s) {
      try {
        if (typeof this.engine.blastPreview === 'function') {
          const e = this.engine.blastPreview(s, at);
          return { breaks: e.broke, collapses: e.collapsed, rubbles: e.rubbled, hit: e.hit ?? [] };
        }
      } catch {
        /* fall back */
      }
    }
    return { ...blastPreview(this.engine.castle(), s?.delve ?? null, at), hit: [] };
  }

  /** "breaks 1 wall, drops 2 hexes into the pit, 3 to rubble, hits Brann and Rats". */
  private blastWords(pv: { breaks: Pos[]; collapses: Pos[]; rubbles: Pos[]; hit?: string[] }): string {
    const parts: string[] = [];
    if (pv.breaks.length) parts.push(`breaks ${pv.breaks.length} wall${pv.breaks.length === 1 ? '' : 's'}`);
    if (pv.collapses.length) parts.push(`drops ${pv.collapses.length} floor hex${pv.collapses.length === 1 ? '' : 'es'} into the pit`);
    if (pv.rubbles.length) parts.push(`${pv.rubbles.length} to rubble`);
    if (pv.hit?.length) parts.push(`hits ${pv.hit.map((id) => this.nameOf(id)).join(', ')}`);
    return parts.join(', ');
  }

  /** The full rules card for a monster (Alt): today's long text with its numbers. */
  private monsterLines(m: Monster): string[] {
    const it = this.intents[m.id];
    const searching = m.awareness === 'alert' && m.searchRounds !== undefined;
    const out = [`<b>${esc(m.name)}</b> <span class="dl-card-k">${esc(this.moodWords(m))}</span>`];
    if (m.kind !== 'gloam') out.push(`<span class="nums">HP ${m.hp}/${m.maxHp}${m.stuck ? ` · <span class="neg">rooted ${m.stuck}: can't move, can act</span>` : ''}</span>`);
    const note = MONSTER_NOTE[m.kind];
    if (note) out.push(`<span class="dim">${esc(note)}</span>`);
    const aw = AWARENESS_TEXT[searching ? 'searching' : m.awareness];
    if (aw && m.kind !== 'gloam') out.push(`<span class="dim">${esc(aw)}${m.awareness === 'patrol' && this.state?.delve?.knownRoutes.includes(m.id) ? ' Route known (drawn on the map).' : ''}</span>`);
    if (m.holding) out.push(`<span class="neg">Holding ${esc(this.nameOf(m.holding))}</span>`);
    const mf = facingOf(m);
    if (m.awareness !== 'asleep' && m.kind !== 'dragon' && m.kind !== 'gloam' && mf !== undefined) out.push(`<span class="dim">Faces ${this.facingWords(m.at, mf)}.</span>`);
    {
      const sel = this.selected();
      const s = this.state;
      if (sel && s && this.heroDef(sel.heroId)?.cls === 'burglar' && m.kind !== 'dragon' && m.kind !== 'gloam' && mf !== undefined) {
        const now = backstabFrom(s, sel.heroId, m.id, sel.at);
        const unaware = m.awareness === 'asleep' || (!(m.noticedIds ?? []).includes(sel.heroId) && m.awareness !== 'hunting');
        if (now) out.push(`<span class="pos">🗡 Backstab now: +${V39.backstabSlots} slot, ${V39.backstabMult === 2 ? 'double' : `×${V39.backstabMult}`} damage.</span>`);
        else if (unaware) out.push(`<span class="dim">🗡 Unaware of ${esc(this.heroDef(sel.heroId)?.name ?? '')}: strike from its side or from behind to backstab.</span>`);
      }
    }
    if ((m.feared ?? 0) > 0) out.push(`<span class="fear-word">Feared · ${m.feared} turn${m.feared === 1 ? '' : 's'}: flees from ${esc(this.nameOf(m.fearOf ?? ''))}, attacks nobody, and your heroes swing free as it leaves them.</span>`);
    if (it && it.kind !== 'wait') out.push(`<span class="neg">Next: ${esc(intentText(this.state!, it, m.id))}</span>`);
    const vl = venomLine(m);
    if (vl) out.push(`<span class="neg">${esc(vl)}</span>`);
    const rel = m.kind === 'gloam' || m.kind === 'dragon' ? null : this.relationLine(m.id, m.at, m.noticedIds ?? [], m.awareness === 'asleep');
    if (rel) out.push(`<span class="${rel.cls === 'bad' ? 'neg' : rel.cls === 'good' ? 'pos' : 'dim'}">${rel.html}</span>`);
    return out;
  }

  /** 20.5: "the castle turns in 2 steps (3 turns on the way)". */
  private calmWords(steps: number): string {
    const d = this.state?.delve;
    const per = V37.calmSteps;
    const left = stepsToTurn(d?.calmSteps, per);
    const turns = Math.floor((((d?.calmSteps ?? 0) % per) + steps) / per);
    return `the castle turns in ${left} step${left === 1 ? '' : 's'}${turns ? ` (${turns} turn${turns === 1 ? '' : 's'} on the way)` : ''}`;
  }

  /** Why a free move can't end on this hex, in a few words (or nothing worth saying). */
  private longPathWhy(at: Pos): string {
    const d = this.state?.delve;
    const k = posKey(at);
    if (!d || !this.vis || !(this.vis.explored.has(k) || this.vis.visible.has(k))) return '';
    if (d.monsters.some((m) => samePos(m.at, at))) return '';
    const t = this.engine.castle().levels.find((l) => l.level === at.level)?.tiles[hexKey(at)];
    if (t?.kind === 'door' && !d.doors[k]?.open) return 'Closed door: open it first.';
    return '';
  }

  /** "faces north-east" for a figure with a facing. */
  private facingWords(at: Pos, facing: number): string {
    const d = DIRS[facing]!;
    return compass(at, { level: at.level, q: at.q + d.q, r: at.r + d.r });
  }

  /** V4.0 (spec 27): where `p` lies from a monster at `at` facing `facing`: front (3 directions), side (the 2 rear-side ones), back. */
  private sightBearing(at: Pos, facing: number, p: Pos): 'front' | 'side' | 'back' | null {
    if (samePos(at, p) || at.level !== p.level) return null;
    const off = (dirIndexOf(p.q - at.q, p.r - at.r) - facing + 6) % 6;
    return off === 3 ? 'back' : off === 2 || off === 4 ? 'side' : 'front';
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
    const act = (name: string, what: string) => parts.push(`<b>${name}</b> <span class="dl-card-k">· ${what}</span>`);
    const door = d.doors[k];
    const castle = this.engine.castle();
    const sel = this.selected();
    const selDef = sel ? this.heroDef(sel.heroId) : undefined;
    const canPick = !!sel && sel.pack.some((i) => itemBase(i.kind) === 'lockpicks' || i.kind === 'improvised');
    const spent = !canPick && selDef?.cls === 'burglar';
    const lockedHow = (more: string) => (canPick ? `Pick, Smash${more}` : spent ? `Smash it${more}: the improvised picks are spent, Gerda sells lockpicks` : `Smash it${more}, or pick it with lockpicks`);
    if (t.kind === 'door' && door) {
      if (door.open) act(t.barred ? 'Sally port gate' : 'Open door', 'walk through');
      else if (t.barred && door.locked) act('Barred gate', 'the sally port key opens it (Unbar), or a charge. Then it stays open');
      else if (door.jammed) act('Jammed door', 'Smash or Charge');
      else if (door.locked) act('Locked door', lockedHow(' or Charge'));
      else act('Door', 'Open, then walk through');
    } else if (t.kind === 'brazier') {
      if (d.lit.includes(k)) parts.push('<b>Brazier</b>, lit for good');
      else act('Brazier', this.full ? 'Light: lights the room (radius 3), for good' : 'Light it: it lights the room for good');
    } else if (t.kind === 'prop' || t.kind === 'tallprop') {
      if (t.prop === 'winch') act('Winch', d.liftWorking ? 'the lift runs' : 'work it to run the lift, loud');
      else if ((t.prop === 'crate' || t.prop === 'barrel' || (!t.prop && t.kind === 'prop')) && (d.smashed ?? []).includes(k)) parts.push(`Splinters <span class="dim">a smashed ${t.prop ?? 'crate'}</span>`);
      else if (t.prop === 'crate' || t.prop === 'barrel' || (!t.prop && t.kind === 'prop')) act(t.prop === 'barrel' ? 'Barrel' : 'Crate', 'Smash: loud, may hold something');
      else parts.push(`${propName(t.prop)} <span class="dim">${t.kind === 'tallprop' ? 'blocks sight' : 'cover'}</span>`);
    } else if (t.kind === 'lift' || t.kind === 'stairs') {
      const l = linkAt(castle, at);
      if (l) parts.push(`<b>${l.kind === 'lift' ? 'Lift' : 'Stairs'}</b> <span class="dl-card-k">· ${linkTooltip(castle, l, !!d.liftWorking).replace(/^(Lift|Stairs) /, '')}</span>`);
      else parts.push(TILE_NAME[t.kind] ?? t.kind);
    } else if (t.kind === 'exit') {
      const e = exitAt(castle, at, this.host.entrance());
      const shut = this.exitShut(at);
      if (shut) act('Way out, shut', shut);
      else act('Way out', e ? exitTooltip(e) : 'stand here, then Leave the castle');
    } else if (t.kind === 'pit') {
      const f = this.fallWords(at);
      parts.push(`<b class="neg">Pit</b> <span class="dl-card-k">· Jump or Rope</span>${f ? `<br><span class="neg">${f.text}</span>` : ''}`);
    } else if (t.kind === 'cracked' && t.heap) act('Rubble', d.blown.includes(k) ? 'cleared' : "fallen stone chokes the east breach · a charge clears it, or a Sapper's Dig");
    else if (t.kind === 'cracked') act('Cracked wall', d.blown.includes(k) ? 'blown open' : "a charge breaks it, or a Sapper's Dig");
    else if (t.kind === 'rubble') act('Rubble', "costs 2 to cross, or Sapper's Dig");
    else if (t.kind === 'sealed') parts.push('<b>Sealed.</b> Nothing opens it yet.');
    else if (t.kind === 'wall' && d.blown.includes(k)) act('Blast rubble', "a wall a charge broke · costs 2 to cross, or Sapper's Dig");
    else if (t.kind === 'wall' && breakableWall(castle, at)) act('Wall', `a Sapper's charge could break it${selDef?.cls === 'sapper' ? ' (Set charge next to it)' : ''}`);
    else if (t.kind === 'floor' && (d.collapsed ?? []).includes(k)) parts.push('<b class="neg">Collapsed</b> <span class="dl-card-k">· a blast dropped this floor into the pit</span>');
    else if (t.kind === 'floor' && d.blown.includes(k)) act('Blast rubble', "floor a charge broke up · costs 2 to cross, or Sapper's Dig");
    else if (t.kind === 'floor' && collapsible(castle, d, at) && this.full) parts.push('<b>Floor</b> <span class="dl-card-k">· a charge here would drop it into the pit</span>');
    else if (t.kind !== 'floor') parts.push(TILE_NAME[t.kind] ?? t.kind);
    const fuse = fuseAt(d, at);
    if (fuse) {
      const side = fuseSide(s, fuse.by);
      const words = this.blastWords(this.blastPlan(at));
      parts.push(`<b class="${side === 'rival' ? 'neg' : 'warn-word'}">${fuse.tripwire ? 'Tripwire' : 'Charge'} · fuse ${fuse.rounds}</b> <span class="dl-card-k">· set by ${esc(this.nameOf(fuse.by))}, ${fuseWords(fuse.rounds)}${fuse.tripwire ? ', or when an enemy steps next to it' : ''}: ${V37.blastInner} within 1 (and a shove), ${V37.blastOuter} within 2${words ? `; ${words}` : ''}</span>`);
    }
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
    if (g?.items.length) parts.push(`<b>Loot</b> <span class="dl-card-k">· Take</span> <span class="dim">${esc(g.items.map(itemLabel).join(', '))}</span>`);
    if (d.traps[k]?.spotted) act('<span class="neg">Trap</span>', 'Disarm, or step around');
    if (!parts.length && !this.full) return room ? `<span class="dim">${esc(cap(room))}</span>` : '';
    const vis = this.vis;
    const light = vis?.lit.has(k) ? 'lit' : vis?.visible.has(k) ? 'unlit' : 'remembered';
    return `${parts.join(' · ')}${room ? ` <span class="dim">${esc(room)}</span>` : ''}${this.full ? ` <span class="dim">(${light})</span>` : ''}`;
  }

  /** Does hovering this hex deserve the interactable outline (15.7)? */
  private hoverKind(at: Pos): 'plain' | 'interact' | 'danger' {
    const d = this.state?.delve;
    const lv = this.engine.castle().levels.find((l) => l.level === at.level);
    const t = lv?.tiles[hexKey(at)];
    if (!d || !t) return 'plain';
    const k = posKey(at);
    if (!this.vis || !(this.vis.explored.has(k) || this.vis.visible.has(k))) return 'plain';
    if (t.kind === 'pit' || d.traps[k]?.spotted || fuseAt(d, at)) return 'danger';
    if (['door', 'brazier', 'lift', 'stairs', 'exit', 'cracked', 'rubble'].includes(t.kind)) return 'interact';
    if (t.kind === 'wall' && this.options.some((o) => o.action === 'setCharge' && o.targets.some((x) => x.at && samePos(x.at, at)))) return 'interact';
    if (t.prop === 'winch') return 'interact';
    if ((t.prop === 'crate' || t.prop === 'barrel') && !(d.smashed ?? []).includes(k)) return 'interact';
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
    const order: ActionKind[] = unitId ? (isRival && crew!.stance !== 'hostile' ? ['parley'] : ['attack', 'firebolt', 'potion', 'take', 'carry', 'unshackle', 'parley', 'bribe', 'shove']) : ['open', 'pick', 'take', 'light', 'disarm', 'smash', 'smashProp', 'winch', 'leave', 'dig', 'jump'];
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
    this.moreEl.classList.add('hidden');
    if (this.facing) {
      const toward = at ?? (unitId ? this.targetPos({ id: unitId }) : null);
      if (toward) this.faceToward(toward);
      return;
    }
    const sel = this.selected();
    if (!this.pending && sel && ((unitId && unitId === this.selectedId) || (!unitId && at && samePos(at, sel.at))) && this.linkHere()) {
      this.takeLink();
      return;
    }
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
    if (unitId && activeHero) {
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
        this.moveAlong(r);
        return;
      }
      if (this.freeMove() && sel && this.vis) {
        const path = this.hoverLong && samePos(this.hoverLong[this.hoverLong.length - 1]!, at) ? this.hoverLong : longPath(this.engine.castle(), s, this.vis, sel.heroId, at);
        if (path) {
          this.coach.done(1);
          void this.host.send({ type: 'move', heroId: sel.heroId, path, sneak: this.sneak, follow: this.follow });
          return;
        }
      }
      if (best) this.choose(best.option, best.target);
    }
  }

  /** A move. V3.9 (24.4): no "are you sure?" for free swings; the preview says it. */
  private moveAlong(r: Reach): void {
    const sel = this.selected();
    if (!sel) return;
    const free = this.freeMove();
    this.coach.done(1);
    void this.host.send({ type: 'move', heroId: sel.heroId, path: r.path, sneak: this.sneak, follow: free ? this.follow : undefined });
  }

  /** V3.9 (24.2): Face mode on or off (key F, or the Face entry in More, when the flag is on). */
  private setFacing(on: boolean): void {
    const sel = this.selected();
    const d = this.state?.delve;
    if (on && (!sel || sel.status !== 'active' || !d || d.phase !== 'player' || this.busy)) return;
    if (on) {
      this.pending = null;
      if (this.pv) this.closePreview();
    }
    this.facing = on;
    if (!on) this.dio.showFacing(null);
    this.renderBar();
    this.drawHighlights();
  }

  /** Turn the selected hero toward `at` (free). */
  private faceToward(at: Pos): void {
    const sel = this.selected();
    if (!sel || at.level !== sel.at.level || samePos(at, sel.at)) return;
    const f = dirToward(sel.at, at);
    this.facing = false;
    this.dio.showFacing(null);
    void this.host.send({ type: 'face', heroId: sel.heroId, facing: f });
  }

  private cancel(): void {
    this.fusePicked = false;
    this.hideTip();
    if (!this.keysEl.classList.contains('hidden')) {
      this.keysEl.classList.add('hidden');
      return;
    }
    if (this.reactOpen) {
      this.reactOpen = false;
      this.renderBar();
      return;
    }
    if (this.facing) {
      this.setFacing(false);
      return;
    }
    if (this.confirmBox) {
      this.closeConfirm();
      return;
    }
    if (this.parleyHero) {
      this.closeParley();
      this.renderBar();
      return;
    }
    if (!this.menuEl.classList.contains('hidden')) {
      this.menuEl.classList.add('hidden');
      return;
    }
    if (!this.moreEl.classList.contains('hidden')) {
      this.moreEl.classList.add('hidden');
      return;
    }
    if (this.pv) this.closePreview();
    else if (this.pending) this.pending = null;
    this.resetHot();
    this.pill.classList.add('hidden');
    this.drawHighlights();
    this.renderBar();
  }

  // ------------------------------------------------------------ actions

  /** 15.7: a blocked option says why, as a toast and at the target. */
  private flashBlocked(o: ActionOption, t?: ActionTarget): void {
    sfx.play('flip', { pitch: 0.7 });
    this.toast(o.blocked ?? 'Not now.');
    const at = t ? this.targetPos(t) : null;
    if (at) this.dio.floatText(at, o.blocked ?? 'Blocked', 'warn', 1.8);
    const btn = [...this.bar.querySelectorAll<HTMLButtonElement>('button.blocked')].find((b) => b.dataset.action === o.action);
    if (btn) {
      btn.classList.remove('shake');
      void btn.offsetWidth;
      btn.classList.add('shake');
    }
  }

  private startAction(o: ActionOption): void {
    if (this.busy) return;
    this.moreEl.classList.add('hidden');
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
    this.coach.done(2);
    this.arrowPick = null; // V4.1 (WS6): each shot starts plain
    // V4.1 (WS6): a Ranger with specialty arrows always gets the pill, so the arrow can be picked first.
    if (o.targets.length === 1 && !this.arrowChoices(o).length) {
      this.choose(o, o.targets[0]!);
      return;
    }
    this.pending = o;
    this.areaDrawn = '';
    this.resetHot();
    this.closePreview();
    this.showPill(o);
    this.drawHighlights();
    this.renderBar();
  }

  /** V4.1 (WS6, spec 31.8): the specialty bundles the selected Ranger's Attack can loose (none: no picker). */
  private arrowChoices(o: ActionOption): Item[] {
    const sel = this.selected();
    if (!sel || o.action !== 'attack' || !CLASSES[this.heroDef(sel.heroId)?.cls ?? 'heir']?.weapon.range || !bowReady(sel.pack)) return [];
    return sel.pack.filter((i) => ATTACK_ARROWS.includes(i.kind) && i.amount > 0);
  }

  /** The arrow the armed shot looses now: the picked bundle if it's still there, else plain. */
  private arrowNow(o: ActionOption): Item | null {
    const list = this.arrowChoices(o);
    return list.find((i) => i.id === this.arrowPick) ?? null;
  }

  /** "Arrow: Plain · Glow (3) · Fire (3)": the arrow picker, with the shot (the pill, the roll panel; keys , and .). */
  private arrowRow(o: ActionOption, onPick?: (id: string | null) => void): HTMLElement | '' {
    const list = this.arrowChoices(o);
    if (!list.length) return '';
    const sel = this.selected()!;
    const plainN = sel.pack.filter((i) => i.kind === 'quiver' || i.kind === 'arrows').reduce((n, i) => n + i.amount, 0);
    const cur = this.arrowNow(o)?.id ?? null;
    const pick = (id: string | null) => {
      if (onPick) return onPick(id);
      this.arrowPick = id;
      this.pvCache.clear();
      this.showPill(o);
      this.showHot();
    };
    const opt = (id: string | null, label: string, tip: string, off = false) =>
      h('button', { type: 'button', class: `dl-pill-opt dl-arrow-opt ${cur === id ? 'on' : ''}`, 'data-arrow': id ?? 'plain', 'aria-pressed': cur === id ? 'true' : 'false', disabled: off, 'data-tip': tip, onclick: () => pick(id) }, label);
    return h(
      'span',
      { class: 'dl-pill-arrows', role: 'group', 'aria-label': 'Which arrow' },
      h('span', { class: 'dl-kick dl-kick-dim', 'data-tip': 'Which arrow this shot looses · keys , and . step through them' }, 'Arrow ', h('kbd', null, ','), h('kbd', null, '.')),
      opt(null, plainN ? `Plain (${plainN})` : 'Plain (none)', `Plain · ${plainN} left: the quiver first, then bought arrows.`, !plainN),
      ...list.map((i) => opt(i.id, `${cap(arrowWord(i.kind))} (${i.amount})`, `${itemTip(i, false)}`)),
    );
  }

  /** "Plain arrow · 9 left" / "Glow arrow · 2 left after" / "Knife · out of arrows": which arrow a shot looses, for the cards. */
  private arrowLine(o: ActionOption, t: ActionTarget): { text: string; tip: string } | null {
    const sel = this.selected();
    const def = sel ? this.heroDef(sel.heroId) : undefined;
    if (!sel || !def || !CLASSES[def.cls]?.weapon.range || !['attack', 'knockback', 'hamstring', 'overwatch'].includes(o.action)) return null;
    if (o.action === 'attack' && !bowReady(sel.pack)) return { text: 'Knife · out of arrows', tip: QUIVER_LINE };
    const id = t.arrow ?? this.withArrow(o, t).arrow;
    // No plain arrow left: the bow looses a specialty one (the engine's attackArrow).
    const sp = id ? sel.pack.find((i) => i.id === id) : !sel.pack.some((i) => (i.kind === 'quiver' || i.kind === 'arrows') && i.amount > 0) ? sel.pack.find((i) => ATTACK_ARROWS.includes(i.kind) && i.amount > 0) : undefined;
    if (sp) return { text: `${cap(arrowWord(sp.kind))} arrow · ${sp.amount - 1} left after`, tip: itemTip(sp, false) };
    const q = sel.pack.find((i) => i.kind === 'quiver')?.amount ?? 0;
    const bought = sel.pack.filter((i) => i.kind === 'arrows').reduce((n, i) => n + i.amount, 0);
    const left = q + bought - 1;
    return { text: `Plain arrow${q ? ' from the quiver' : ''} · ${Math.max(0, left)} left after`, tip: `The quiver first (${q}), then bought arrows (${bought}).` };
  }

  /** V4.1 (WS6): the roll panel's arrow changed: preview the shot again with it. */
  private repickArrow(id: string | null): void {
    const p = this.pv;
    const sel = this.selected();
    if (!p || !sel || !this.state) return;
    this.arrowPick = id;
    const { arrow: _old, ...base } = p.target;
    void _old;
    const t = this.withArrow(p.option, base);
    this.pv = { ...p, target: t, preview: this.engine.preview(this.state, sel.heroId, p.option.action, t), focus: 0 };
    this.pvCache.clear();
    sfx.play('flip', { pitch: 1.1 });
    this.renderPreview();
  }

  /** The target with the picked arrow on it (the engine's `target.arrow`). */
  private withArrow(o: ActionOption, t: ActionTarget): ActionTarget {
    const a = o.action === 'attack' ? this.arrowNow(o) : null;
    return a ? { ...t, arrow: a.id } : t;
  }

  /** "Attack: pick a target · Esc to cancel", with a list for keyboard users and for picks that aren't on the map. */
  private showPill(o: ActionOption): void {
    clear(this.pill);
    const what = o.pick === 'hex' ? (o.area ? 'pick a hex (the shaded area is hit)' : 'pick a lit hex') : o.pick === 'ally' ? 'pick a friend' : o.pick === 'enemy' ? 'pick a target' : 'pick one';
    const onMap = o.pick === 'hex' || o.pick === 'ally' || o.pick === 'enemy';
    // V4.0 (spec 30.3): hovering an entry marks its hex or figure on the board, as pointing at it there would.
    const opts = this.pickOrder();
    const pk = (x: ActionTarget) => `${x.id ?? ''}|${x.at ? posKey(x.at) : ''}|${x.itemId ?? ''}`;
    // Two options with the same name ("Orc", "Orc") say which way each one is from the hero.
    const sel0 = this.selected();
    const names = opts.map((t) => this.targetLabel(t));
    const label = (t: ActionTarget, i: number) => {
      const p = this.targetPos(t);
      return names.filter((n) => n === names[i]).length > 1 && sel0 && p && !samePos(p, sel0.at) ? `${names[i]} · ${compass(sel0.at, p)}` : names[i]!;
    };
    const list =
      !onMap || opts.length <= 6
        ? opts.slice(0, 8).map((t, i) =>
            h(
              'button',
              {
                type: 'button',
                class: 'dl-pill-opt',
                'data-pick': pk(t),
                onclick: () => this.choose(o, t),
                onmouseenter: () => {
                  this.listHot = t;
                  this.showHot();
                },
                onmouseleave: () => {
                  this.listHot = null;
                  this.showHot();
                },
                onfocus: () => {
                  this.listHot = t;
                  this.showHot();
                },
                onblur: () => {
                  this.listHot = null;
                  this.showHot();
                },
              },
              label(t, i),
            ),
          )
        : [];
    this.pill.className = `dl-pill ${onMap ? 'map' : 'list'} ${o.action === 'attack' || o.pick === 'enemy' ? 'foe' : ''}`;
    this.pill.append(
      h('span', { class: 'dl-pill-t' }, h('b', null, `${o.label}${o.mana ? ` (${o.mana} mana)` : ''}`), `: ${what} · `, h('button', { type: 'button', class: 'dl-pill-esc', onclick: () => this.cancel() }, 'Esc to cancel')),
      o.action === 'setCharge' ? h('span', { class: 'dl-pill-note' }, 'Outlined walls can be broken. You pick the fuse next.') : '',
      this.arrowRow(o),
      list.length ? h('span', { class: 'dl-pill-list' }, ...list) : '',
      h('span', { class: 'dl-pill-keys' }, h('span', { class: 'dl-pill-hot hidden', 'aria-live': 'polite' }), h('span', { class: 'dim' }, `Tab: ${opts.length > 1 ? 'next of ' + opts.length : 'mark it'} · Enter: take it`)),
    );
    this.pill.classList.remove('hidden');
  }

  private choose(o: ActionOption, t: ActionTarget): void {
    if (this.pending !== o) this.arrowPick = null; // V4.1 (WS6): a direct click shoots plain (the roll panel can switch)
    this.pending = null;
    this.resetHot();
    this.dio.showPick(null);
    this.pill.classList.add('hidden');
    this.moreEl.classList.add('hidden');
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
    this.coach.done(2);
    // V3.7 (20.3): set-charge: the hex is picked; now the fuse, when the engine offers more than one.
    if (o.action === 'setCharge' && t.at && !this.fusePicked) {
      const fuses = [...new Set(o.targets.filter((x) => x.at && samePos(x.at, t.at!)).map((x) => x.fuse ?? 1))].sort();
      if (fuses.length > 1) {
        this.showFusePicker(o, t, fuses as (1 | 2)[]);
        return;
      }
    }
    const picked = this.fusePicked;
    this.fusePicked = false;
    // V4.1 (WS6): the shot carries the arrow picked in the pill.
    t = this.withArrow(o, t);
    if (!picked && (o.rolls || o.action === 'jump' || (o.area ?? 0) > 0 || o.action === 'blink')) {
      const p = this.engine.preview(this.state, sel.heroId, o.action, t);
      this.openPreview({ option: o, target: t, preview: p, focus: 0 });
      return;
    }
    void this.act(o.action, t, 0);
  }

  private fusePicked = false;

  /** 20.3: "Fuse 1 or 2": a small picker above the bar; the blast rings stay on the chosen hex meanwhile. */
  private showFusePicker(o: ActionOption, t: ActionTarget, fuses: (1 | 2)[]): void {
    const at = t.at!;
    this.pending = o;
    clear(this.pill);
    const where = this.targetLabel({ at });
    this.dio.clearHighlights();
    const pv = this.showBlastOutcomes(at);
    const words = this.blastWords(pv);
    this.pill.className = 'dl-pill fuse';
    this.pill.append(
      h('span', { class: 'dl-pill-t' }, h('b', null, `Set charge · ${where}`), ` ${V37.blastInner} damage within 1 (and a shove), ${V37.blastOuter} within 2.${words ? ` ${words[0]!.toUpperCase()}${words.slice(1)}.` : ''} Pick the fuse:`),
      h('span', { class: 'blast-key' }, h('i', { class: 'bk bk-break' }), ' breaks ', h('i', { class: 'bk bk-collapse' }), ' drops into the pit ', h('i', { class: 'bk bk-rubble' }), ' rubble'),
      h(
        'span',
        { class: 'dl-pill-list' },
        ...fuses.map((f) =>
          h(
            'button',
            {
              type: 'button',
              class: `dl-pill-opt dl-fuse dl-fuse-${f}`,
              'data-fuse': `${f}`,
              'data-tip': f === 1 ? 'Fuse 1 · goes off at the end of the coming castle turn. Step out of the rings first.' : 'Fuse 2 · goes off at the end of the castle turn after next: time to walk clear, or to lure something onto it.',
              onclick: () => {
                this.fusePicked = true;
                this.choose(o, { ...t, fuse: f });
              },
            },
            h('b', { class: 'num' }, `${f}`),
            f === 1 ? ' end of this castle turn' : ' the turn after next',
          ),
        ),
        h('button', { type: 'button', class: 'dl-pill-esc', onclick: () => this.cancel() }, 'Esc'),
      ),
    );
    this.pill.classList.remove('hidden');
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
      parts.push(chest ? 'Chest' : tile?.kind === 'door' ? 'Door' : g?.items.length ? g.items.map(itemLabel).join(', ') : tile?.kind === 'wall' ? (breakableWall(this.engine.castle(), t.at) ? 'Wall (breakable)' : 'Wall') : (TILE_NAME[tile?.kind ?? 'floor'] ?? 'There'));
    }
    return parts.join(' → ') || 'Self';
  }

  // ------------------------------------------------------------ the roll panel

  private openPreview(p: PreviewState): void {
    this.pv = p;
    this.lastPreview = p;
    this.detailsOpen = false;
    this.root.classList.add('rolling');
    this.renderPreview();
    this.drawHighlights();
    this.hideCard();
    this.dio.showSight(null);
    this.renderBar();
    this.updateCoach();
  }

  private closePreview(): void {
    const was = !!this.pv;
    this.pv = null;
    this.previewEl.classList.add('hidden');
    this.root.classList.remove('rolling');
    if (was) {
      this.renderBar();
      this.updateCoach();
    }
  }

  private renderPreview(): void {
    const p = this.pv;
    if (!p) return;
    const el = this.previewEl;
    clear(el);
    const pr = p.preview;
    const sel = this.selected();
    const def = sel ? this.heroDef(sel.heroId) : undefined;
    const name = def?.name ?? '';
    const t = p.target;
    const tName = t.id ? this.theName(t.id) : this.targetLabel(t).toLowerCase();
    const title = p.option.action === 'attack' ? `Attack ${tName}` : `${p.option.label}${t.id || t.at ? ` · ${tName}` : ''}`;
    const kick = p.option.action === 'attack' && def && sel ? `${name} · ${weaponNow(def.cls, sel.pack).name.toLowerCase()}` : `${name} · ${p.option.label.toLowerCase()}`;
    const verb = p.option.action === 'attack' && def && sel && weaponNow(def.cls, sel.pack).range ? 'Shoot' : (VERB[p.option.action] ?? p.option.label);
    el.classList.toggle('jump', p.option.action === 'jump');
    const head = h('div', { class: 'dl-roll-head' }, h('div', { class: 'dl-roll-who' }, h('span', { class: 'dl-kick' }, kick), h('span', { class: 'dl-roll-title' }, cap(title))));
    el.append(head);
    if (!pr.ok) {
      el.append(h('p', { class: 'dl-roll-why' }, pr.reason ?? 'Not possible.'), h('div', { class: 'dl-roll-foot' }, h('span', { class: 'dl-roll-btns' }, h('button', { type: 'button', class: 'dl-btn', onclick: () => this.cancel() }, 'Back ', h('kbd', null, 'Esc')))));
      el.classList.remove('hidden');
      return;
    }
    if (pr.warning) el.append(h('div', { class: `dl-roll-warn ${pr.confirm ? 'severe' : ''}` }, icon('warn', 14), h('span', null, pr.warning)));
    // V4.1 (WS6, spec 31.8): which arrow this shot looses, and the picker (keys , and .).
    {
      const line = this.arrowLine(p.option, t);
      if (line) head.append(h('span', { class: 'dl-roll-arrow', 'data-tip': line.tip }, '➳ ', line.text));
      const row = this.arrowRow(p.option, (id) => this.repickArrow(id));
      if (row) el.append(h('div', { class: 'dl-roll-arrows' }, row));
    }
    let read: RollRead | null = null;
    if (pr.slots > 0) {
      head.append(h('span', { class: 'dl-roll-ctx' }, `${pr.slots} tr${pr.slots === 1 ? 'y' : 'ies'} of ${statName(pr.stat)} · ${lightWords(pr.modifiers)}`));
      read = readRoll(pr, p.focus, this.hpOf(t), this.itWord(t));
      // The dice: Focus-locked tries first (gold, "sure"), bonus tries last (green, labelled).
      const bonus = bonusSlots(pr.modifiers);
      const dice = h('div', { class: 'dl-dice', role: 'group', 'aria-label': `${pr.slots} tries` });
      for (let i = 0; i < pr.slots; i++) {
        const bi = i - (pr.slots - bonus.length);
        dice.append(i < p.focus ? dieHex('sure', pr.chance) : bi >= 0 ? dieHex('bonus', pr.chance, bonus[bi]) : dieHex('plain', pr.chance));
      }
      // Focus: one diamond per point left; filled = spent on this roll.
      const left = sel?.focus ?? 0;
      const max = Math.min(pr.maxFocus, pr.slots);
      const dias = h('span', { class: 'dl-focus-dias', role: 'group', 'aria-label': `Focus: ${p.focus} of ${left} spent` });
      for (let i = 0; i < left; i++) {
        const on = i < p.focus;
        dias.append(h('button', { type: 'button', class: `dl-dia ${on ? 'on' : ''}`, disabled: i >= max, 'aria-label': on ? 'Take back this Focus' : 'Spend Focus', 'data-tip': i >= max ? 'Focus · no more tries to make sure of' : on ? 'Focus · spent on this roll: click to take it back' : 'Focus · click to make one more try a sure hit', onclick: () => this.setFocus(on && p.focus === i + 1 ? i : i + 1) }));
      }
      const focus = h(
        'div',
        { class: 'dl-focus' },
        h('span', { class: 'dl-focus-row' }, h('span', { class: 'dl-focus-l', 'data-tip': `Focus · ${left} left this delve (${FOCUS_MAX} at the start)\nEach point locks one try as a sure hit. +/− or the arrow keys too.` }, 'Focus'), left ? dias : h('span', { class: 'dim small' }, 'none left')),
        h('span', { class: 'dl-focus-help' }, left ? "Each Focus makes one try a sure hit. It doesn't come back this delve." : 'No Focus left this delve. Keven\'s Rally gives 1 back.'),
      );
      el.append(h('div', { class: 'dl-roll-mid' }, dice, focus));
      // The outcome bar.
      const was = p.focus > 0 && read.kind === 'damage' && read.kill > 0 ? readRoll(pr, 0, this.hpOf(t), this.itWord(t)).kill : null;
      // V5.0 (P, B4): a thicker bar and nothing under it; the read and the numbers are on the segments' hover.
      el.append(h('div', { class: 'dl-roll-oc' }, outcomeBar(read, was)));
      const chips = pr.modifiers.map((m) => modifierChip(m, name)).filter((c): c is NonNullable<typeof c> => !!c);
      if (chips.length) el.append(h('div', { class: 'dl-roll-chips' }, ...chips.map((c) => h('span', { class: `dl-chip ${c.good ? 'good' : 'bad'}`, 'data-tip': c.tip }, `${c.good ? '▲' : '▼'} ${c.text}`))));
    } else {
      el.append(h('ul', { class: 'dl-roll-plain' }, ...pr.outcomes.map((x) => h('li', { class: /fall/i.test(x) ? 'bad' : '' }, x))));
    }
    // Details: the per-hit table and the modifiers in full (also while Alt is held).
    if (read && (this.detailsOpen || this.alt)) {
      el.append(h('div', { class: 'dl-roll-details' }, h('span', { class: 'dl-kick dl-kick-dim' }, 'Details'), h('span', { class: 'nums' }, `${pr.slots} tries of ${statName(pr.stat)} · ${pr.chance}% each${p.focus ? ` · ${p.focus} made sure` : ''}`), ...pr.modifiers.map((m) => h('span', { class: 'nums' }, m)), hitTable(pr, p.focus), this.hpOf(t) !== null ? h('span', { class: 'dim small' }, `${cap(tName)} has ${this.hpOf(t)} HP.`) : ''));
    }
    const noise = h('span', { class: `dl-noise ${pr.noise >= 4 ? 'loud' : ''}`, 'data-tip': pr.noise > 0 ? `Noise ${pr.noise} · heard ${pr.noise} hexes away by path (a closed door counts 2). Sleepers wake; monsters come to look.` : 'Silent · nobody hears it.' }, icon('sound', 15), noiseWords(pr.noise));
    const foot = h(
      'div',
      { class: 'dl-roll-foot' },
      noise,
      pr.light ? h('span', { class: pr.light > 0 ? 'pos' : 'neg', 'data-tip': `Light · ${pr.light > 0 ? '+' : ''}${pr.light} rounds of lantern light.` }, `Light ${pr.light > 0 ? '+' : ''}${pr.light}`) : '',
      read ? h('button', { type: 'button', class: 'dl-roll-det', 'aria-expanded': this.detailsOpen ? 'true' : 'false', onclick: () => { this.detailsOpen = !this.detailsOpen; this.renderPreview(); } }, this.detailsOpen ? 'Hide details' : 'Details') : '',
      h(
        'span',
        { class: 'dl-roll-btns' },
        h('button', { type: 'button', class: 'dl-btn dl-ghost', onclick: () => this.cancel() }, 'Cancel ', h('kbd', null, 'Esc')),
        h('button', { type: 'button', class: `dl-btn ${p.option.action === 'jump' ? 'dl-danger' : 'dl-primary'} dl-go`, onclick: () => this.confirmPreview() }, `${verb} `, h('kbd', null, 'Enter'), h('kbd', null, 'E')),
      ),
    );
    el.append(foot);
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

  // ------------------------------------------------------------ rolls as they happen

  /** A hero's roll flips its dice in the roll panel's place; an enemy's shows as a caption beside it. Resolves when done. */
  async showRoll(e: Extract<GameEvent, { type: 'roll' }>, wait: (s: number) => Promise<void>, enemy: boolean): Promise<void> {
    const r: SlotRoll = e.roll;
    if (enemy) return this.enemyRoll(e, wait);
    const el = this.rollEl;
    clear(el);
    el.className = 'dl-rollanim';
    const dice = r.results.map((_, i) => (i < r.focus ? dieHex('sure', r.chance) : dieHex('plain', r.chance)));
    const result = h('div', { class: 'dl-rollanim-res' });
    el.append(h('div', { class: 'dl-rollanim-head' }, h('span', { class: 'dl-kick' }, `${this.nameOf(e.who)} · ${e.what}`), h('span', { class: 'dim small num' }, `${r.chance}% a try`)), h('div', { class: 'dl-dice' }, ...dice), result);
    el.classList.remove('hidden');
    sfx.play('dice');
    await wait(0.12);
    for (let i = 0; i < r.results.length; i++) {
      const hit = r.results[i]!;
      const b = dice[i]!;
      b.classList.add('flipped', hit ? 'hit' : 'miss');
      b.innerHTML = `${iconSvg(hit ? 'check' : 'minus', 14)}<span class="dl-die-l">${hit ? 'hit' : 'miss'}</span>`;
      if (i >= r.focus) sfx.play('flip', { pitch: hit ? 1.25 : 0.8 });
      await wait(i < r.focus ? 0.05 : 0.16);
    }
    const outcome = this.lastPreview && this.lastPreview.preview.outcomes[r.hits] ? this.lastPreview.preview.outcomes[r.hits] : '';
    result.append(h('b', { class: 'num' }, `${r.hits} of ${r.slots} hit`), outcome ? h('span', null, ` · ${outcome}`) : '', r.perfect && r.slots > 1 ? h('span', { class: 'perfect' }, ' · Perfect') : '');
    if (r.perfect && r.slots > 1) {
      sfx.play('perfect');
      el.classList.add('is-perfect');
      this.dio.clock.hitStop(this.host.settings.speed === 0 ? 0 : 200);
    }
    await wait(r.perfect ? 0.55 : 0.4);
  }

  private captionFor: string | null = null;
  private captionVerb = '';
  private captionRaf = 0;

  /** The castle's turn: a caption card beside the actor with its dice as small hexes, then the result. */
  private async enemyRoll(e: Extract<GameEvent, { type: 'roll' }>, wait: (s: number) => Promise<void>): Promise<void> {
    const r = e.roll;
    const it = this.intents[e.who] ?? this.state?.delve?.rivals?.members.find((x) => x.id === e.who)?.intent;
    const spider = this.state?.delve?.monsters.find((m) => m.id === e.who)?.kind === 'spider';
    const verb = /shot|overwatch/i.test(e.what) ? 'shoots' : /bite/i.test(e.what) || (spider && /attack|swing/i.test(e.what)) ? 'bites' : /venom dart/i.test(e.what) ? 'throws a venom dart at' : /firebolt/i.test(e.what) ? 'hurls a firebolt at' : /attack/i.test(e.what) ? 'strikes' : e.what.toLowerCase();
    // The title names the planned target only until the act reports who it really hit (actResult): a guard or
    // a re-plan can change it, and the caption must never name two different heroes.
    const target = it?.targetId ? this.nameOf(it.targetId) : '';
    this.captionVerb = `${cap(this.theName(e.who))} ${verb}`;
    this.captionStart(e.who, `${this.captionVerb}${target ? ` ${target}` : ''}`);
    const dice = r.results.map(() => h('span', { class: 'dl-die dl-die-sm plain' }, h('span', { class: 'dl-die-p num' }, '')));
    const row = h('div', { class: 'dl-cap-dice' }, ...dice);
    this.caption.querySelector('.dl-cap-body')?.append(row);
    sfx.play('dice', { gain: 0.6 });
    for (let i = 0; i < r.results.length; i++) {
      const hit = r.results[i]!;
      dice[i]!.classList.add('flipped', hit ? 'hit' : 'miss');
      dice[i]!.innerHTML = `<span class="dl-die-p">${hit ? 'hit' : 'miss'}</span>`;
      await wait(0.1);
    }
  }

  private captionStart(actor: string, title: string): void {
    this.captionFor = actor;
    this.caption.replaceChildren(h('div', { class: 'dl-cap-t' }, title), h('div', { class: 'dl-cap-body' }));
    this.caption.classList.remove('hidden');
    this.placeCaption();
    if (!this.captionRaf) {
      const tick = () => {
        if (this.caption.classList.contains('hidden')) {
          this.captionRaf = 0;
          return;
        }
        this.placeCaption();
        this.captionRaf = requestAnimationFrame(tick);
      };
      this.captionRaf = requestAnimationFrame(tick);
    }
  }

  private placeCaption(): void {
    const p = this.captionFor ? this.dio.unitScreen(this.captionFor) : null;
    const box = this.root.getBoundingClientRect();
    const w = this.caption.offsetWidth || 280;
    const th = this.caption.offsetHeight || 80;
    let x = p ? p.x + 40 : innerWidth / 2 + 60;
    if (x + w > box.width - 12) x = (p ? p.x - 40 : innerWidth / 2) - w;
    const y = Math.max(84, Math.min(innerHeight - th - 120, (p ? p.y : innerHeight / 3) - th / 2));
    this.caption.style.transform = `translate(${Math.round(Math.max(8, x))}px, ${Math.round(y)}px)`;
  }

  /** The playback reports what an act did, for the caption ("4 damage", "Corin goes down."). */
  actResult(e: GameEvent): void {
    if (!this.castle || this.caption.classList.contains('hidden')) return;
    const body = this.caption.querySelector('.dl-cap-body');
    if (!body) return;
    let text = '';
    let cls = '';
    if ((e.type === 'hit' || e.type === 'miss') && e.attacker === this.captionFor && this.captionVerb) {
      const t = this.caption.querySelector('.dl-cap-t');
      if (t) t.textContent = `${this.captionVerb} ${this.nameOf(e.target)}`;
    }
    if (e.type === 'hit' && (e.attacker === this.captionFor || !this.captionFor)) {
      text = e.damage > 0 ? `${e.damage} damage` : 'Hits.';
      cls = 'dmg';
    } else if (e.type === 'poisoned' && e.by === this.captionFor) {
      // V4.1 (spec 31.4): "The spider bites Fenna: 2 damage, poisoned."
      const last = [...body.querySelectorAll('.dl-cap-res.dmg')].pop();
      if (last) {
        last.textContent = `${(last.textContent ?? '').replace(/\.$/, '')}, poisoned.`;
        return;
      }
      text = 'Poisoned.';
      cls = 'dmg';
    } else if (e.type === 'miss' && e.attacker === this.captionFor) text = 'Misses.';
    else if (e.type === 'downed') {
      text = `${this.nameOf(e.id)} goes down.`;
      cls = 'down';
    } else if (e.type === 'died') {
      text = `${this.nameOf(e.id)} is dead.`;
      cls = 'down';
    } else if (e.type === 'shoved' && this.isHeroId(e.id)) text = `${this.nameOf(e.id)} is shoved back.`;
    else if (e.type === 'fell' && this.isHeroId(e.id)) {
      text = `${this.nameOf(e.id)} falls: ${e.damage} damage.`;
      cls = 'down';
    } else if (e.type === 'grabbed') text = `${this.nameOf(e.id)} is held.`;
    if (text) body.append(h('div', { class: `dl-cap-res ${cls}` }, text));
  }

  private isHeroId(id: string): boolean {
    return !!this.state?.campaign.roster.some((x) => x.id === id);
  }

  hideRoll(): void {
    this.rollEl.classList.add('hidden');
  }

  // ------------------------------------------------------------ the castle's turn

  /** The playback reports each phase change: the Chronicle's grouping and the castle's turn. */
  phase(phase: 'player' | 'world', round: number, actors = 0): void {
    this.chron.setPhase(phase, round);
    this.chron.render();
    if (phase === 'world') {
      this.castle = { round, total: actors, n: 0, seen: new Set() };
      this.renderCastle();
    } else this.endCastleTurn();
  }

  /** An enemy acts (first sight of it in this castle turn): the count in the folded hotbar goes up. */
  castleActor(id: string): void {
    const c = this.castle;
    if (!c || c.seen.has(id)) return;
    c.seen.add(id);
    c.n = Math.min(Math.max(c.total, c.seen.size), c.seen.size);
    if (c.total < c.n) c.total = c.n;
    this.caption.classList.add('hidden');
    this.renderCastle();
  }

  private renderCastle(): void {
    const c = this.castle;
    if (!c) return;
    this.castleEl.replaceChildren(h('span', { class: 'dl-castle-t' }, 'The castle moves'), h('span', { class: 'dl-castle-r num' }, `round ${c.round}`));
    this.castleEl.classList.remove('hidden');
    this.root.classList.add('castle-turn');
    this.renderBar();
  }

  private endCastleTurn(): void {
    if (!this.castle) return;
    this.castle = null;
    this.castleEl.classList.add('hidden');
    this.caption.classList.add('hidden');
    this.root.classList.remove('castle-turn');
  }

  nameOf(id: string): string {
    const s = this.state;
    const d = s?.delve;
    return this.heroDef(id)?.name ?? d?.monsters.find((m) => m.id === id)?.name ?? d?.rivals?.members.find((r) => r.id === id)?.name ?? (d?.prisoner?.id === id ? d.prisoner.name : undefined) ?? id;
  }

  // ------------------------------------------------------------ the top strip

  private renderTop(): void {
    const s = this.state!;
    const d = s.delve!;
    clear(this.strip);
    this.strip.append(this.lightMeter(), this.goalBox(), this.carryBox());
    const right = h('div', { class: 'dl-strip-r' });
    const levels = h('div', { class: 'dl-levels dl-pan', role: 'group', 'aria-label': 'Levels' });
    const mem = s.campaign.explored ?? {};
    for (const lv of this.engine.castle().levels) {
      const here = d.heroes.some((x) => x.status === 'active' && x.at.level === lv.level);
      const known = here || (mem[lv.level]?.length ?? 0) > 0 || (!!this.vis && [...this.vis.explored].some((k) => k.startsWith(`${lv.level}:`)));
      const word = shortLevel(lv.name);
      levels.append(
        h(
          'button',
          {
            type: 'button',
            class: `dl-lvl ${lv.level === this.dio.shownLevel ? 'on' : ''} ${here ? 'occupied' : ''} ${known ? '' : 'unknown'}`,
            'data-level': `${lv.level}`,
            'aria-disabled': known ? undefined : 'true',
            'data-tip': known ? `${cap(lv.name)} · Level ${lv.level}${here ? ', heroes here' : ''}\nShow this level. Heroes on other levels keep their place.` : 'Not found yet · Find the stairs, the lift or the pit.',
            onclick: () => {
              if (!known) return;
              this.dio.showLevel(lv.level);
              this.refresh();
            },
          },
          known ? word : '?',
        ),
      );
    }
    right.append(levels, h('button', { type: 'button', class: 'dl-menu-btn dl-pan', 'data-menu': '1', 'aria-label': 'Menu', 'aria-expanded': this.menuEl.classList.contains('hidden') ? 'false' : 'true', 'data-tip': 'Menu · playback speed, settings, sound, keys and marks, abandon the delve', onclick: () => this.toggleMenu() }, icon('menu', 18)));
    this.strip.append(right);
  }

  /** V4.1 (WS2): the light readout is redrawn from the state (the args are kept for app.ts's `light` event). */
  updateLight(_light?: number, _b?: Brightness): void {
    const old = this.strip.querySelector('.dl-lantern');
    if (old) old.replaceWith(this.lightMeter());
  }

  /** V4.1 (WS2): the lantern the selected hero carries (the first one), for the shutter key L. */
  private heldLantern(heroId?: string): { hero: HeroInDelve; item: Item } | null {
    const d = this.state?.delve;
    if (!d) return null;
    const order = [heroId ?? this.selectedId, ...d.heroes.map((x) => x.heroId)];
    for (const id of order) {
      const hd = d.heroes.find((x) => x.heroId === id && x.status === 'active');
      const it = hd?.pack.find((i) => i.kind === 'lantern');
      if (hd && it) return { hero: hd, item: it };
    }
    return null;
  }

  /** 16.2, V4.1: is the selected hero's lantern open? (No lantern: false.) */
  private lanternOpen(): boolean {
    return !!this.heldLantern()?.item.lit;
  }

  /** V4.1 (WS2): open or shutter a lantern (free; the selected hero's first, else anyone's). */
  toggleShutter(): void {
    const d = this.state?.delve;
    if (!d || this.busy || d.phase !== 'player') return;
    const l = this.heldLantern();
    if (!l) {
      this.toast('Nobody carries a lantern. Gerda sells one once she is home.');
      return;
    }
    const o = this.engine.actions(this.state!, l.hero.heroId).find((x) => x.action === 'shutter');
    if (!o) {
      this.toast('The lantern is empty. Oil or Kindle brings it back.');
      return;
    }
    sfx.play('click', { pitch: l.item.lit ? 0.8 : 1.2 });
    this.cancel();
    void this.host.send({ type: 'act', heroId: l.hero.heroId, action: 'shutter', target: { itemId: l.item.id }, focus: 0 });
  }

  /**
   * V4.1 (WS2, pillar 15): the light readout, where the lantern bar was. One chip per lit torch or open lantern: who
   * carries it (or "on the floor") and the rounds left, because they decide when to leave. None lit: says so.
   */
  private lightMeter(): HTMLElement {
    const s = this.state!;
    const d = s.delve!;
    const lights = (this.engine.lights?.(s) ?? []).filter((L) => (L.kind === 'torch' || L.kind === 'lantern') && L.rounds !== undefined);
    const spare = d.heroes.filter((x) => x.status === 'active').flatMap((x) => x.pack.filter((i) => (i.kind === 'torch' || i.kind === 'lantern') && !i.lit).map((i) => ({ who: x.heroId, i })));
    const low = lights.some((L) => (L.rounds ?? 0) <= 3);
    const chips = lights.map((L) => {
      const who = L.holder ? this.nameOf(L.holder) : 'on the floor';
      const word = L.kind === 'lantern' ? 'Lantern' : 'Torch';
      const r = L.rounds ?? 0;
      return h(
        'span',
        { class: `dl-lchip ${L.kind} ${r <= 3 ? 'low' : ''}`, tabindex: 0, 'data-tip': `${word} · ${who}${L.holder ? ' carries it' : ''}
${r} of ${L.max} rounds left; burns 1 a round while lit. Radius ${L.radius}.${L.kind === 'torch' ? ' Snuff it (free) to save the rest.' : ' The shutter is free (L).'}` },
        icon(L.kind === 'lantern' ? 'lantern' : 'torch', 12),
        h('span', { class: 'dl-lchip-n' }, L.holder ? who : 'floor'),
        h('b', { class: 'num' }, `${r}`),
      );
    });
    const ctx = lights.length ? (low ? 'running low' : `${lights.length} lit`) : spare.length ? `none lit · ${spare.length} packed` : 'no light';
    const tip = [
      'Light · what lights the party, and how long it lasts.',
      'Party light (a torch, a lantern, Glowworm) or daylight: sight 8 / 7 / 6 on Levels 1 / 2 / 3, no penalty.',
      `Only a castle light (a sconce, a fire, a brazier, fungus, the pit glow): sight 4 / 3 / 2, rolls −10%. Unlit: sight ${DARK_SIGHT[1]} / ${DARK_SIGHT[2]} / ${DARK_SIGHT[3]}, rolls −20%.`,
      `A torch lights 3 for ${TORCH_ROUNDS} rounds; Gerda's lantern 4 (3 when low) for 20, refilled free in camp. Each burns 1 a round while lit.`,
      `Kindle lights a friend's torch or lantern within 3, or adds ${KINDLE_LIGHT}; oil adds ${OIL_LIGHT} to a lantern. In the Hollow the dark itself hunts anyone standing unlit.`,
    ].join('\n');
    return h(
      'button',
      {
        type: 'button',
        class: `dl-lantern dl-pan dl-lights ${lights.length ? (low ? 'lt-dim' : 'lt-bright') : 'lt-dark shut'}`,
        'data-tip': tip,
        'aria-label': `Light: ${ctx}.${this.heldLantern() ? ' Press L to open or shutter the lantern.' : ''}`,
        disabled: this.busy || d.phase !== 'player',
        onclick: () => (this.heldLantern() ? this.toggleShutter() : undefined),
      },
      h('span', { class: 'dl-lantern-head' }, icon('torch', 14, 'dl-lantern-ic'), h('span', { class: 'dl-lantern-stage' }, 'Light'), h('span', { class: 'dl-lantern-ctx' }, `· ${ctx}`), h('span', { class: 'dl-round num', 'data-tip': `Round ${d.round} · A round is your turn (each hero moves once and acts once), then the castle's turn.` }, `R${d.round}`)),
      h('span', { class: 'dl-lchips' }, ...(chips.length ? chips : [h('span', { class: 'dl-lchip none' }, spare.length ? 'Light a torch from a pack' : 'Nobody carries a light')])),
    );
  }

  /** The job: what, where (or "not yet seen"), and a compass arrow toward it once it's known on this level. */
  private goalBox(): HTMLElement {
    const s = this.state!;
    const d = s.delve!;
    const k = d.contract;
    const sel = this.selected() ?? d.heroes.find((x) => x.status === 'active');
    const site = this.engine.castle().contractSites.find((x) => x.id === k.siteId);
    let title = k.title;
    let where = site ? cap(site.where) : '';
    let state = 'not yet seen';
    let toward: Pos | null = null;
    let status = '';
    if (k.kind === 'rescue') {
      const p = d.prisoner;
      status = !p ? '' : p.dead ? 'The prisoner is dead.' : p.out ? 'Out. Done.' : p.freed ? `Freed: bring ${p.name} to a way out.` : `Find and free ${p.name}.`;
    } else if (k.kind === 'slay') {
      const dragon = d.monsters.find((m) => m.kind === 'dragon');
      status = !dragon || dragon.hp <= 0 ? 'The Dragon is dead. Get out alive.' : `The Dragon: ${dragon.hp}/${dragon.maxHp} HP${dragon.awareness === 'asleep' ? ', asleep' : ''}.`;
    } else {
      const carrier = d.heroes.find((x) => x.pack.some((i) => i.kind === 'heirloom'));
      const rival = d.rivals?.members.find((r) => r.loot.some((i) => i.kind === 'heirloom'));
      status = carrier ? `${this.heroDef(carrier.heroId)?.name ?? ''} carries it.` : rival ? `${d.rivals?.name ?? 'A rival crew'} have it!` : 'Find it and carry it out.';
    }
    const go = prizeInHand(d);
    const obj = this.dio.objectiveAt();
    if (go) {
      const near = sel ? nearestExit(this.engine.castle(), sel.at, (p) => this.exitKnown(p), this.host.entrance()) : null;
      title = k.kind === 'slay' ? 'The Dragon is dead: get out' : 'Get out';
      where = near && sel ? cap(exitWhere(near, sel.at)) : 'Find a way out';
      state = near?.exit.entrance ? 'the way you came in' : '';
      toward = near?.exit.at ?? null;
    } else if (obj) {
      const lv = this.engine.castle().levels.find((l) => l.level === obj.at.level);
      const room = lv?.rooms.find((r) => r.id === lv.tiles[hexKey(obj.at)]?.room)?.name;
      where = room ? cap(room) : where;
      state = this.vis?.visible.has(posKey(obj.at)) ? 'in sight' : 'seen';
      toward = obj.at;
    }
    let arrow: HTMLElement | string = '';
    if (toward && sel && toward.level === sel.at.level && !samePos(toward, sel.at)) {
      const word = compass(sel.at, toward);
      arrow = h('span', { class: 'dl-compass', 'data-tip': `${cap(word)} · the way to it from ${this.heroDef(sel.heroId)?.name ?? 'here'}, as the map is drawn (north is up before you turn the view).` }, compassSvg(sel.at, toward), h('span', { class: 'num' }, abbrev(word)));
    } else if (toward && sel && toward.level !== sel.at.level) arrow = h('span', { class: 'dl-compass dim', 'data-tip': `Level ${toward.level} · it lies on another level.` }, `L${toward.level}`);
    const tip = `${k.title} · ${k.bounty} gold\n${k.brief}${status ? `\n${status}` : ''}${toward ? '\nClick to look there.' : ''}`;
    return h(
      'button',
      { type: 'button', class: `dl-job dl-pan dl-job-${k.kind} ${go ? 'go' : ''}`, 'data-tip': tip, 'data-exit': go && toward ? posKey(toward) : undefined, onclick: () => (toward ? this.dio.lookAt(toward) : undefined) },
      icon(go ? 'exit' : 'diamond', 18, 'dl-job-ic'),
      h('span', { class: 'dl-job-t' }, h('span', { class: 'dl-job-title' }, title), h('span', { class: `dl-job-where ${go ? 'out' : ''}` }, `${where}${state ? ` · ${state}` : ''}`)),
      arrow,
    );
  }

  /** What the party carries: its value, what a crew's toll is worked out from. */
  private carryBox(): HTMLElement {
    const d = this.state!.delve!;
    const items = d.heroes.filter((x) => x.status === 'active' || x.status === 'downed').flatMap((x) => x.pack.filter((i) => !i.story));
    const value = this.engine.value(items);
    const coin = items.filter((i) => i.kind === 'gold').reduce((a, i) => a + i.amount, 0);
    const rest = items.filter((i) => i.kind === 'gem' || i.kind === 'jewelry' || i.kind === 'heirloom' || i.kind === 'hoard');
    const words = [coin ? `${coin} gold` : '', ...rest.map((i) => (i.kind === 'heirloom' || i.kind === 'hoard' ? i.name : `${article(i.name)} ${i.name.toLowerCase()}`))].filter(Boolean);
    const toll = Math.max(TOLL_MIN, Math.round(value / 2 / 5) * 5);
    return h(
      'div',
      { class: 'dl-carry dl-pan', tabindex: 0, 'data-tip': `Carrying · worth ${value} gold\nWhat a crew's toll is worked out from: half of it, at least ${TOLL_MIN} (now ${toll}). Hired crews may turn on a party carrying ${BETRAY_LOOT} or more when their deal ends.${words.length ? `\n${words.join(', ')}.` : ''}` },
      h('span', { class: 'dl-kick dl-kick-dim' }, 'Carrying'),
      value > 0 ? h('span', { class: 'dl-carry-v' }, h('span', { class: `num dl-goldtxt ${value >= BETRAY_LOOT ? 'rich' : ''}` }, `${value}`), h('span', { class: 'dl-carry-w' }, ` · ${shortList(words)}`)) : h('span', { class: 'dl-carry-w' }, 'Nothing yet'),
    );
  }

  // ------------------------------------------------------------ the party rail

  private renderCards(): void {
    const s = this.state!;
    const d = s.delve!;
    clear(this.rail);
    const edges: Pos[] = [];
    const darks: string[] = [];
    d.heroes.forEach((hd, i) => {
      const risk = hd.status === 'active' ? this.engine.edgeRisk(s, hd.heroId) : null;
      if (risk) edges.push(hd.at);
      const def = this.heroDef(hd.heroId);
      if (!def) return;
      const active = hd.status === 'active';
      const dark = active && !this.isLit(hd.heroId);
      if (dark) darks.push(hd.heroId);
      this.rail.append(this.railCard(hd, def, i, risk, dark));
    });
    this.dio.showEdgeLips(edges);
    this.dio.setDarkHeroes(darks);
    this.renderGloam(darks);
    this.applyDark();
  }

  private railCard(hd: HeroInDelve, def: Hero, i: number, risk: { levels: number; damage: number; levelName: string } | null, dark: boolean): HTMLElement {
    const sel = hd.heroId === this.selectedId;
    const active = hd.status === 'active';
    const word = def.cls === 'heir' ? 'the heir' : className(def.cls).toLowerCase();
    const badge = h('span', { class: `cbadge dl-hexb cls-${def.cls}`, 'aria-hidden': 'true' }, classGlyph(def.cls));
    const tipLines = [`${def.name} · ${word}, level ${def.level}`, CLASS_ROLE[def.cls as keyof typeof CLASS_ROLE] ?? '', `Focus ${hd.focus} of ${hd.ale === 'reserve' ? 4 : FOCUS_MAX}: spent in the roll panel.`, `Click or press ${i + 1} to select.`];
    if (!active) {
      // V4.1 (spec 31.4, pillar 15): the bleed-out count, because it decides what you do (potion, Mend, Carry, or run).
      const fate = hd.status === 'downed' ? { tag: `Down · ${hd.bleed}`, line: this.downLine(hd) } : hd.status === 'dead' ? { tag: 'Dead', line: 'Gone for good.' } : hd.status === 'out' ? { tag: 'Out', line: 'Safe outside, with what they carry.' } : { tag: 'Taken', line: `Dragged out by ${this.state?.delve?.rivals?.name ?? 'a crew'}.` };
      // A crew member hauling a downed hero out: say so, and what stops it.
      const dragger = hd.status === 'downed' ? this.state?.delve?.rivals?.members.find((r) => r.dragging === hd.heroId && r.hp > 0 && !r.goneOut) : undefined;
      if (dragger) fate.line = `${dragger.name} is hauling them out!`;
      const drag = dragger ? h('span', { class: 'dl-si bad dragged', tabindex: 0, 'data-tip': `Carried off · ${dragger.name} is carrying ${def.name} toward the way out, ${3} a round. Kill, down or fear ${dragger.name} to free them.` }, icon('hand', 13)) : '';
      const poisonMark = hd.status === 'downed' && hd.poisoned ? h('span', { class: 'dl-si venom', tabindex: 0, 'aria-label': 'Poisoned', 'data-tip': `${POISON_TIP}\nDown, it doesn't hurt them; cure it before they get up.` }, icon('venom', 13)) : '';
      return h(
        'div',
        { class: `dl-rcard st-${hd.status} cls-${def.cls} ${sel ? 'sel' : ''}`, 'data-hero': hd.heroId, tabindex: 0, 'data-tip': `${def.name} · ${fate.tag.toLowerCase()}\n${fate.line}`, ...(this.crawler(hd) ? { onclick: () => this.select(hd.heroId) } : {}) },
        badge,
        h('span', { class: 'dl-rcard-b' }, h('span', { class: 'dl-rcard-top' }, h('span', { class: 'dl-rcard-n' }, def.name), drag, poisonMark, h('span', { class: `dl-fate ${hd.status}` }, fate.tag)), h('span', { class: 'dl-rcard-fate' }, fate.line)),
      );
    }
    const pip = (on: boolean, what: string, tip: string) => h('span', { class: `dl-pip ${on ? 'on' : ''}`, 'data-tip': tip, 'aria-label': `${what} ${on ? 'ready' : 'used'}` }, on ? icon(what === 'Move' ? 'move' : 'dot', 9) : '');
    const held = !!hd.grabbedBy || hd.webbed || (hd.rooted ?? 0) > 0;
    const mv = held ? "Can't move" : hd.moved ? 'Moved this round' : 'Move ready';
    const ac = hd.carrying ? `Carrying ${this.nameOf(hd.carrying)}: free actions only` : hd.dashed ? 'Dashed: the action went on a second move' : hd.acted ? 'Acted this round' : 'Action ready';
    const pips = h('span', { class: 'dl-pips' }, pip(!hd.moved && !held, 'Move', `Move · ${mv}\nEach hero moves once and acts once a round, in either order. Moving again spends the action (a dash).`), pip(!hd.acted && !hd.carrying, 'Action', `Action · ${ac}`));
    const max = def.maxHp;
    const hurt = hd.hp < max;
    const manaMax = CLASSES[def.cls]?.mana ?? 0;
    return h(
      'button',
      { type: 'button', class: `dl-rcard cls-${def.cls} st-${hd.status} ${sel ? 'sel' : ''} ${hd.moved && hd.acted ? 'done' : ''} ${dark ? 'dark' : ''} ${hd.poisoned ? 'poisoned' : ''}`, 'data-hero': hd.heroId, 'aria-pressed': sel ? 'true' : 'false', onclick: () => this.select(hd.heroId) },
      h('span', { class: 'dl-hexwrap', 'data-tip': tipLines.filter(Boolean).join('\n') }, badge, h('kbd', { class: 'dl-hexkey' }, `${i + 1}`)),
      h(
        'span',
        { class: 'dl-rcard-b' },
        h('span', { class: 'dl-rcard-top' }, h('span', { class: 'dl-rcard-n' }, def.name), h('span', { class: 'dl-stat-icons' }, ...this.statusIcons(hd, def.name, risk, dark ? this.sightOf(hd.heroId) : null)), pips),
        h('span', { class: 'dl-hprow', 'data-tip': `HP · ${hd.hp} of ${max}\nAt 0 a hero is down and bleeds out in 3 turns: a potion from next to them gets them up, so does a Hedgewitch's Mend within 3; or Carry them out. Wounds stay after the delve.` }, h('span', { class: `dl-hp ${hd.hp / max <= 0.34 ? 'low' : ''}` }, h('i', { style: `width:${Math.max(0, Math.min(1, hd.hp / max)) * 100}%` })), h('span', { class: `num dl-hpn ${hurt ? 'hurt' : ''}` }, `${hd.hp}/${max}`)),
        h('span', { class: 'dl-packrow' }, manaMax > 0 ? manaDias(hd.mana, manaMax) : '', packMini(hd.pack, def.name)),
      ),
    );
  }

  /** Status icons on a party card, each explaining itself (15.7, the Legend). */
  private statusIcons(hd: HeroInDelve, name: string, risk: { levels: number; damage: number; levelName: string } | null, darkSight: number | null): HTMLElement[] {
    const d = this.state!.delve!;
    const out: HTMLElement[] = [];
    const add = (cls: string, ic: IconName | null, tip: string, text = '') => out.push(h('span', { class: `dl-si ${cls}`, tabindex: 0, 'data-tip': tip }, ic ? icon(ic, 13) : '', text));
    // V4.1 (WS2): the torch or lantern this hero carries lit, with its rounds.
    for (const it of hd.pack.filter((i) => i.kind === 'lantern' || i.kind === 'torch')) {
      const r = it.rounds ?? (it.kind === 'lantern' ? 20 : TORCH_ROUNDS);
      if (it.lit && r > 0) out.push(h('span', { class: `dl-si lantern ${it.kind}`, tabindex: 0, 'data-tip': `${it.kind === 'lantern' ? 'Lantern' : 'Torch'} lit · ${name} carries it: ${r} round${r === 1 ? '' : 's'} left.\nIts light goes where ${name} goes. ${it.kind === 'lantern' ? 'L shuts or opens it (free).' : 'Snuff it (free) to save the rest; Drop torch leaves it burning here.'}` }, icon(it.kind === 'lantern' ? 'lantern' : 'torch', 13), h('b', { class: 'num' }, `${r}`)));
      else if (it.kind === 'lantern') add('lantern shut', 'lantern', `Lantern · ${name} carries it, shut (${r} rounds). L opens it (free).`);
    }
    // V4.1 (spec 31.4): poisoned: a green drop.
    if (hd.poisoned) out.push(h('span', { class: 'dl-si venom', tabindex: 0, 'aria-label': 'Poisoned', 'data-tip': `${POISON_TIP}\n${name} has ${hd.hp} HP; the poison never takes the last one.` }, icon('venom', 13)));
    if (hd.carrying) add('carry', 'carry', `Carrying ${this.nameOf(hd.carrying)} · moves ${CARRY_MOVE} at most, free actions only (doors, Take, Drop, Give, Leave, Parley). Leave by an exit and ${this.nameOf(hd.carrying)} comes out too${this.state?.delve?.heroes.some((x) => x.heroId === hd.carrying) ? ' (alive, at 1 HP)' : ''}. Set down (free) puts them down.`);
    // V4.1 (spec 31.13): a hero set to strike from hiding without being asked.
    if (hd.reactions?.hiddenSwing === 'always') add('ambush', 'sword', `Strikes from hiding · ${name} takes the free swing at an enemy passing them that hasn't spotted them, without asking, and gives themselves away. Change it under Reactions (beside Walk/Sneak).`);
    if (hd.moveMode === 'sneak') add('sneak', null, `Sneak · ${name} is set to sneak: moves ${this.heroDef(hd.heroId)?.cls === 'burglar' || hd.ale === 'smuggler' ? 4 : 2}, silently.\nEach hero keeps their own Walk/Sneak: select ${name} and press S to change it.`, 'sneak');
    // Something a seen enemy means to strike at them.
    const seen = this.seenEnemies();
    const threats = Object.entries(this.intents).filter(([id, it]) => it.targetId === hd.heroId && seen.has(id) && ['attack', 'shove', 'grab', 'drag', 'web', 'firebolt', 'dart', 'venomdart', 'hamstring', 'rob', 'steal', 'dread', 'nightthorn', 'briar'].includes(it.kind));
    if (threats.length) add('bad threat', 'sword', `Targeted · ${threats.map(([id, it]) => `${cap(this.theName(id))} ${intentText(this.state!, it, id)}`).join('; ')} next turn.`);
    if (this.backExposed(hd.heroId)) add('bad back-exposed', 'eyeOff', `Back exposed · ${FACING_HELP.backExposed}`);
    if (risk) add('bad edge', 'drop', `By a drop · a shove would send ${name} ${risk.levels === 1 ? '1 level' : `${risk.levels} levels`} down into ${risk.levelName} (${risk.damage} damage).\nStep away from the drop, or kill whatever could shove.`);
    const nightEye = (hd.nightEyes ?? 0) > 0 || hd.ale === 'nighteye'; // V4.1 (WS2): Night-eye Stout
    if (darkSight !== null) add(`dark ${nightEye ? 'night' : ''}`, 'moon', nightEye ? `In the dark · night-eye: sight ${darkSight} and whole rolls.` : `In the dark · ${name} stands outside all light: sees only ${darkSight} hex${darkSight === 1 ? '' : 'es'} and rolls at −20% or worse.${hd.at.level === 3 ? '\nIn the Hollow the dark itself hunts anyone standing unlit.' : `\nMonsters notice an unlit hero within ${V37.noticeDarkWalk} walking, ${V37.noticeDarkSneak} sneaking.`}`);
    if (hd.grabbedBy) add('bad grab', 'chain', `Held · by ${d.monsters.find((m) => m.id === hd.grabbedBy)?.name ?? 'a ghoul'}: can't move or dash.\nBreak free (2 Might tries, 1 hit frees you) or kill it.`);
    else if (hd.webbed) add('bad', 'chain', "Webbed · can't move this turn, can still act. It clears next round.");
    else if (hd.dreaded) add('bad dread', 'flee', `Dread · ${name} can move this turn but not act (a crew Shadowmancer's Dread).`); // V4.1 (WS7)
    else if ((hd.rooted ?? 0) > 0) add('bad rooted', 'chain', `Rooted · can't move or dash for ${hd.rooted} more round${hd.rooted === 1 ? '' : 's'}. ${name} can still act.`);
    const dragger = d.rivals?.members.find((r) => r.dragging === hd.heroId && r.hp > 0 && !r.goneOut);
    if (dragger) add('bad dragged', 'hand', `Dragged · ${dragger.name} is hauling ${name} toward the way out. Kill, down or fear ${dragger.name} to free them.`);
    const guards: string[] = [];
    if (hd.braced) guards.push(`Braced: hits do 1 less, enemies roll −${V37.bracePenalty}%`);
    if (hd.ward > 0) guards.push(`Warded ${hd.ward} round${hd.ward === 1 ? '' : 's'}: 1 less per hit`);
    if (hd.veil > 0) guards.push(`Veiled ${hd.veil} round${hd.veil === 1 ? '' : 's'}: monsters can't see ${name} (attacking or noise ${VEIL_BREAK_NOISE}+ breaks it)`);
    if (guards.length) add('guarded', 'shield', `Protected · ${guards.join('\n')}`);
    const more: string[] = [];
    if (this.heroDef(hd.heroId)?.shield) more.push('Shield: ranged hits do 1 less (2 while braced).');
    if (hd.overwatch) more.push(`Overwatch: shoots the first enemy that moves or acts within ${OVERWATCH_RANGE}.`);
    if (hd.nightEyes && hd.nightEyes > 0) more.push(`Night-eye: ${hd.nightEyes} more round${hd.nightEyes === 1 ? '' : 's'} without dark penalties.`);
    if (hd.guarding) more.push(`Guarding ${this.nameOf(hd.guarding)}.`);
    if (hd.escorting) more.push(`${this.nameOf(hd.escorting)} follows ${name}. Leave with them next to you to get them out.`);
    if (hd.rallyCooldown > 0) more.push(`Rally ready again in ${hd.rallyCooldown} round${hd.rallyCooldown === 1 ? '' : 's'}.`);
    if (hd.ale) {
      const a = ALE_EFFECT[hd.ale];
      more.push(`${a.name}: ${a.text}${hd.ale === 'featherfoot' && hd.aleSpent ? ' (used)' : ''}`);
    }
    if (more.length) add('more', 'dot', `Also · ${more.join('\n')}`);
    return out;
  }

  /** 16.2: the Gloam line shows while it is up and a hero on Level 3 stands unlit. */
  private renderGloam(darks: string[]): void {
    const d = this.state?.delve;
    const gloam = !!d && d.monsters.some((m) => m.kind === 'gloam' && m.hp > 0);
    const unlitL3 = !!d && darks.some((id) => d.heroes.find((x) => x.heroId === id)?.at.level === 3);
    this.gloamEl.classList.toggle('hidden', !(gloam && unlitL3));
  }

  // ------------------------------------------------------------ the hotbar

  private renderBar(): void {
    const s = this.state;
    const d = s?.delve;
    clear(this.bar);
    this.keyMap.clear();
    if (!s || !d) return;
    // The castle's turn: the bar folds to a strip.
    if (this.castle) {
      const c = this.castle;
      this.bar.className = 'dl-hotbar folded';
      this.bar.append(
        h('span', { class: 'dl-fold-t' }, "The castle's turn"),
        h('span', { class: 'dl-fold-n' }, c.total ? `${Math.max(1, c.n)} of ${c.total} move${c.total === 1 ? '' : 's'}` : 'nothing you can see stirs'),
        h('span', { class: 'dl-fold-hurry' }, 'Hold ', h('kbd', null, 'Space'), ' to hurry'),
      );
      return;
    }
    this.bar.className = `dl-hotbar ${this.busy ? 'busy' : ''}`;
    const sel = this.selected();
    const def = sel ? this.heroDef(sel.heroId) : undefined;
    if (!sel || !def) {
      this.bar.append(h('span', { class: 'dl-fold-t' }, 'Nobody left to move.'), this.endButton(d));
      return;
    }
    // V5.0 (spec 32.8): W A S D are the camera's, E ends the turn, F centers; nothing on the bar takes them.
    const usedKeys = new Set<string>(['w', 'a', 's', 'd', 'e', 'f']);
    const keyFor = (action: string, preferred?: string): string | undefined => {
      let key = preferred;
      if (key && usedKeys.has(key)) key = undefined;
      if (key) usedKeys.add(key);
      void action;
      return key;
    };
    // Who, and Walk/Sneak for this hero.
    const who = h(
      'div',
      { class: 'dl-who' },
      h(
        'div',
        { class: 'dl-who-top' },
        h('span', { class: 'dl-who-n', tabindex: 0, 'data-tip': this.elsewhereTip(def) }, def.name, h('span', { class: 'dl-who-c' }, ` ${def.cls === 'heir' ? 'the heir' : className(def.cls).toLowerCase()}`)),
        this.reactionsButton(sel, def),
      ),
      this.calmState().calm && d.phase === 'player' ? h('span', { class: 'dl-who-calm', 'data-tip': `Free move · ${MOVE_HELP.calm}` }, `Free move · the castle turns in ${stepsToTurn(d.calmSteps, V37.calmSteps)} step${stepsToTurn(d.calmSteps, V37.calmSteps) === 1 ? '' : 's'}`) : '',
      // V5.0 (spec 32.8, owner): Walk / Sneak is a sliding switch; a tap of Shift flips it for this hero.
      h(
        'button',
        {
          type: 'button',
          role: 'switch',
          class: `dl-switch ${this.sneak ? 'on' : ''}`,
          'aria-checked': this.sneak ? 'true' : 'false',
          'aria-label': `${def.name} moves by: ${this.sneak ? 'sneaking' : 'walking'}`,
          disabled: this.busy,
          'data-move-switch': this.sneak ? 'sneak' : 'walk',
          'data-tip': `${this.sneak ? 'Sneak · silent' : 'Walk · noise 1 a hex'} · tap Shift to switch (this hero only)\n${this.sneak ? MOVE_HELP.sneak : MOVE_HELP.walk}${this.sneak && def.cls === 'burglar' ? `\n${FACING_HELP.quietFeet}` : ''}`,
          onclick: () => this.setSneak(!this.sneak),
        },
        h('span', { class: 'dl-switch-l walk' }, 'Walk'),
        h('span', { class: 'dl-switch-track' }, h('span', { class: 'dl-switch-knob' })),
        h('span', { class: 'dl-switch-l sneak' }, 'Sneak'),
        h('kbd', null, 'Shift'),
      ),
    );
    // Actions: Attack (always), Shove, class abilities and spells, then whatever is in reach.
    const acts = h('div', { class: 'dl-acts', role: 'toolbar', 'aria-label': `${def.name}'s actions` });
    const opts = [...this.options];
    const exit = this.exitHere();
    const link = this.linkHere();
    const used = new Set<ActionOption>();
    const button = (o: ActionOption) => {
      used.add(o);
      // V4.0 (spec 30.4, owner): only what this hero can do now. A blocked option (no pick for the lock, a full pack) is
      // left off the bar; the board's hover card still says why.
      if (o.blocked) return;
      const key = keyFor(o.action, ACTION_KEY[o.action]);
      const btn = this.actButton(o, key, def.cls);
      if (key) this.keyMap.set(key, () => btn.click());
      acts.append(btn);
    };
    // Fixed order, absent ones collapsed: Attack, Shove, class abilities and spells (the engine's order), then what's in reach.
    usedKeys.add('a');
    const attack = opts.find((o) => o.action === 'attack');
    if (attack) button(attack);
    for (const o of opts) if (o.action === 'shove') button(o);
    for (const o of opts) if ((ABILITIES.has(o.action) || SPELLS.has(o.action)) && !used.has(o)) button(o);
    // Contextual: the way out, the stairs, then the rest.
    if (exit?.option && !exit.option.blocked) {
      usedKeys.add('q');
      const o = exit.option;
      used.add(o);
      const btn = h('button', { type: 'button', class: `dl-ab glow ${o.blocked ? 'blocked' : ''}`, 'data-action': 'leave', 'data-key': 'q', 'aria-disabled': o.blocked ? 'true' : undefined, disabled: this.busy, 'data-tip': `Leave the castle · by ${exit.info.name}, free · key Q${o.blocked ? `\nCan't now: ${o.blocked}` : ''}\n${actionHelp('leave')}`, onclick: () => this.leaveHere() }, h('span', { class: 'dl-kb' }, 'Q'), icon('exit', 20), h('span', { class: 'dl-ab-l' }, 'Leave'));
      this.keyMap.set('q', () => btn.click());
      acts.append(btn);
    }
    if (link) {
      usedKeys.add('t');
      const l = link.info;
      const btn = h('button', { type: 'button', class: `dl-ab glow ${link.reach.dash ? 'dash' : ''}`, 'data-action': 'link', 'data-key': 't', disabled: this.busy, 'data-tip': `${linkButton(l)} · 1 movement${link.reach.dash ? ' as a dash (uses the action)' : ''} · key T\n${l.kind === 'lift' ? 'The lift' : 'The stairs'} come out on Level ${l.to.level}.`, onclick: () => this.takeLink() }, h('span', { class: 'dl-kb' }, 'T'), icon(l.down ? 'down' : 'up', 20), h('span', { class: 'dl-ab-l' }, l.kind === 'lift' ? 'Lift' : 'Stairs'));
      this.keyMap.set('t', () => btn.click());
      acts.append(btn);
    }
    // The pack takes the item actions; More takes the rare ones.
    const bearer = sel.pack.some((i) => i.kind === 'lantern'); // V4.1 (WS2): L opens or shutters this hero's lantern
    if (bearer) usedKeys.add('l');
    const dealsNow = this.dealsFor(sel.heroId).length > 0;
    if (dealsNow) usedKeys.add('b');
    for (const o of opts) {
      if (used.has(o) || ITEM_ACTIONS.has(o.action) || MORE_ACTIONS.has(o.action) || o.action === 'leave') continue;
      if (o.action === 'unbar' && !o.targets.length) continue;
      button(o);
    }
    if (!acts.querySelector('.dl-ab') && !this.busy) {
      const line = sel.moved && sel.acted ? 'Done this round. End turn, or pick another hero.' : sel.acted ? 'Action used. Move, or End turn.' : sel.moved ? 'Nothing to do here. End turn, or pick another hero.' : 'Nothing to do here. Move, or End turn.';
      acts.append(h('span', { class: 'dl-acts-none', 'data-tip': this.elsewhereTip(def) }, line));
    }
    // The pack: click an item to use it.
    const pack = this.packSlots(sel, def, keyFor);
    // More.
    const more = this.moreItems(sel, def, opts, keyFor, dealsNow, bearer).filter((m) => !m.blocked);
    const moreBtn = h('button', { type: 'button', class: 'dl-ab dl-more-b', 'data-more': '1', 'aria-haspopup': 'menu', 'aria-expanded': this.moreEl.classList.contains('hidden') ? 'false' : 'true', disabled: this.busy || !more.length, 'data-tip': more.length ? `More · ${more.map((m) => m.label).join(', ')}` : 'More · nothing else to do here', onclick: () => this.toggleMore(more) }, icon('dots', 20), h('span', { class: 'dl-ab-l' }, 'More'));
    this.renderMore(more);
    this.bar.append(who, h('span', { class: 'dl-sep' }), acts, h('span', { class: 'dl-sep' }), pack, more.length ? moreBtn : '', this.endButton(d));
    if (this.reactOpen && !this.busy) this.bar.append(this.reactionsPop(sel, def)); // V4.1 (spec 31.13)
    this.fitBar();
    // The armed-action pill sits just above the bar.
    if (this.pending && !this.pill.classList.contains('hidden')) this.pill.style.bottom = `${(this.bar.offsetHeight || 94) + 24}px`;
  }

  /** V4.0 (spec 30.4): what this hero can do somewhere (their class's abilities), for the name's hover and the empty bar. */
  private elsewhereTip(def: Hero): string {
    const kit = (CLASS_KIT[def.cls] ?? []).filter(([, kind]) => kind !== 'passive').map(([name]) => name);
    const base = ['Attack', 'Shove'];
    return `${def.name} can: ${[...base, ...kit].join(', ')}.\nThe bar shows only what ${def.name} can do from here, now; the rest turns up when there's something to use it on.`;
  }

  /**
   * V4.0 (spec 30.4): the bar never scrolls. If its buttons don't fit (a hero with many options, a narrow window), the
   * action labels fold away (icons and keys stay; the name is in each button's hover), then the bar tightens further.
   */
  private fitBar(): void {
    const bar = this.bar;
    bar.classList.remove('compact', 'tight');
    const over = () => bar.scrollWidth > bar.clientWidth + 1 || [...bar.querySelectorAll<HTMLElement>('.dl-acts')].some((a) => a.scrollWidth > a.clientWidth + 1);
    if (!bar.isConnected || !bar.clientWidth) return;
    if (over()) bar.classList.add('compact');
    if (over()) bar.classList.add('tight');
  }

  private actButton(o: ActionOption, key: string | undefined, cls: string): HTMLButtonElement {
    const ic = ACTION_ICON[o.action];
    const contextual = !ABILITIES.has(o.action) && !SPELLS.has(o.action) && o.action !== 'attack' && o.action !== 'shove';
    const label = SHORT_LABEL[o.action] ?? o.label;
    return h(
      'button',
      {
        type: 'button',
        class: `dl-ab ${this.pending?.action === o.action ? 'on' : ''} ${o.blocked ? 'blocked' : ''} ${contextual && !o.blocked ? 'glow' : ''} ${SPELLS.has(o.action) ? 'spell' : ''}`,
        'aria-pressed': this.pending?.action === o.action ? 'true' : undefined,
        'aria-disabled': o.blocked ? 'true' : undefined,
        disabled: this.busy,
        'data-action': o.action,
        'data-key': key ?? '',
        'data-tip': `${o.label} · ${actionCost(o.action, o.mana, o.rolls)}${key ? ` · key ${keyName(key)}` : ''}${o.blocked ? `\nCan't now: ${o.blocked}` : o.targets.length > 1 ? `\n${o.targets.length} targets in reach.` : ''}\n${actionHelp(o.action, cls)}`,
        onclick: () => this.startAction(o),
      },
      key ? h('span', { class: `dl-kb ${key === ' ' ? 'wide' : ''}` }, keyName(key)) : '',
      ic ? icon(o.action === 'attack' && CLASSES[cls as keyof typeof CLASSES]?.weapon.range && bowReady(this.selected()?.pack ?? []) ? 'shoot' : ic, 20) : h('span', { class: 'dl-ab-g' }, ACTION_GLYPH[o.action] ?? '•'),
      h('span', { class: 'dl-ab-l' }, label),
      o.mana ? h('span', { class: 'dl-ab-mana', 'aria-label': `${o.mana} mana` }, ...Array.from({ length: o.mana }, () => h('i', null))) : '',
    );
  }

  /** The selected hero's four pack slots (2-slot items span two), and their class kit beside them. */
  private packSlots(sel: HeroInDelve, def: Hero, keyFor: (a: string, k?: string) => string | undefined): HTMLElement {
    const row = h('div', { class: 'dl-pack-slots' });
    let used = 0;
    for (const it of sel.pack) {
      if (isKit(it)) continue;
      const span = Math.max(1, Math.min(it.slots, PACK_SLOTS - used));
      used += it.slots;
      // V4.1 (WS2): a lit torch's slot snuffs it; a lantern's opens or shutters it.
      const o = this.options.find((x) => (ITEM_ACTIONS.has(x.action) || x.action === 'unbar' || x.action === 'torch' || x.action === 'snuff' || x.action === 'shutter') && x.targets.some((t) => t.itemId === it.id));
      const item = o ? { ...o, targets: o.targets.filter((t) => t.itemId === it.id) } : null;
      const key = o ? keyFor(o.action, ACTION_KEY[o.action]) : undefined;
      const val = it.kind === 'gold' || it.kind === 'gem' || it.kind === 'jewelry' || it.kind === 'hoard';
      const how = item ? (item.blocked ? `\nCan't now: ${item.blocked}` : `\n${itemClickLine(it.kind, key)}`) : val || it.kind === 'heirloom' ? '\nCarry it out.' : `\nNothing to use it on here.${itemUseLine(it.kind) ? `\n${itemUseLine(it.kind)}` : ''}`;
      const btn = h(
        'button',
        {
          type: 'button',
          class: `dl-slot ${span > 1 ? 'wide' : ''} ${item && !item.blocked ? 'usable' : ''} ${this.pending && item && this.pending.action === item.action ? 'on' : ''} dl-slot-${itemBase(it.kind)}`,
          'data-item': it.id,
          'data-action': item?.action,
          'data-key': key,
          disabled: this.busy,
          'data-tip': `${itemTip(it, false)}${how}`,
          onclick: () => (item ? this.startAction(item) : this.toast(val || it.kind === 'heirloom' ? `${itemLabel(it)}: carry it out.` : `${itemLabel(it)}: nothing to use it on here.`)),
        },
        h('span', { class: 'dl-slot-g' }, itemGlyph(it.kind)),
        val ? h('small', { class: 'num' }, `${it.amount}`) : '',
        key ? h('span', { class: 'dl-kb' }, key.toUpperCase()) : '',
      );
      if (key && item) this.keyMap.set(key, () => btn.click());
      row.append(btn);
    }
    for (let i = used; i < PACK_SLOTS; i++) row.append(h('span', { class: 'dl-slot empty', 'data-tip': 'Empty slot · Take loot or an item to fill it.\nHeirlooms and hoard pieces need 2 free slots.' }));
    const kit = sel.pack.filter(isKit);
    return h(
      'div',
      { class: 'dl-pack' },
      h('span', { class: 'dl-kick dl-kick-dim dl-pack-k' }, 'Pack · click to use'),
      h('span', { class: 'dl-pack-row' }, row, ...kit.map((it) => kitChip(it, def.name, false, sel.pack))),
    );
  }

  /** What the More menu offers: Give, Drop, Pass lantern, the shutter, Parley, Face, Follow. */
  private moreItems(sel: HeroInDelve, def: Hero, opts: ActionOption[], keyFor: (a: string, k?: string) => string | undefined, dealsNow: boolean, bearer: boolean): { label: string; key?: string; tip: string; icon: IconName; action: string; run: () => void; blocked?: string }[] {
    const out: { label: string; key?: string; tip: string; icon: IconName; action: string; run: () => void; blocked?: string }[] = [];
    for (const kind of ['give', 'drop', 'passLantern'] as const) {
      const o = opts.find((x) => x.action === kind);
      if (!o) continue;
      const key = keyFor(kind, ACTION_KEY[kind]);
      out.push({ label: o.label, key, tip: `${o.label} · ${actionCost(o.action, o.mana, o.rolls)}\n${actionHelp(o.action, def.cls)}`, icon: ACTION_ICON[kind]!, action: kind, run: () => this.startAction(o), blocked: o.blocked });
    }
    if (bearer && opts.some((x) => x.action === 'shutter')) {
      const open = this.lanternOpen();
      out.push({ label: open ? 'Shut the lantern' : 'Open the lantern', key: 'l', tip: `${open ? 'Shut the lantern' : 'Open the lantern'} · free · key L\nShut: no light and no burn. Open: light, and 1 round of oil a round.`, icon: 'lantern', action: 'shutter', run: () => this.toggleShutter() });
    }
    if (dealsNow) out.push({ label: 'Parley', key: 'b', tip: 'Parley · free · key B\nTalk to the crew: pay, hire, give a job, or fight.', icon: 'scales', action: 'parley', run: () => this.openParley() });
    if (FACING.faceCommand && sel.status === 'active') out.push({ label: this.facing ? 'Stop facing' : 'Face', key: 'f', tip: `Face · free · key F\n${FACING_HELP.face}`, icon: 'face', action: 'face', run: () => this.setFacing(!this.facing) });
    if (this.calmState().calm && this.state?.delve?.phase === 'player') out.push({ label: this.follow ? 'Party follows' : 'Walk alone', tip: `Follow · ${this.follow ? 'on' : 'off'}\n${MOVE_HELP.follow}`, icon: 'flag', action: 'follow', run: () => this.toggleFollow() });
    for (const m of out) if (m.key && !this.keyMap.has(m.key)) this.keyMap.set(m.key, () => (m.blocked ? this.toast(m.blocked) : m.run()));
    return out;
  }

  private renderMore(items: ReturnType<Hud['moreItems']>): void {
    clear(this.moreEl);
    for (const m of items)
      this.moreEl.append(
        h(
          'button',
          {
            type: 'button',
            role: 'menuitem',
            class: `dl-more-i ${m.blocked ? 'blocked' : ''}`,
            'data-action': m.action,
            'data-key': m.key ?? '',
            'aria-disabled': m.blocked ? 'true' : undefined,
            'data-tip': `${m.tip}${m.blocked ? `\nCan't now: ${m.blocked}` : ''}`,
            onclick: () => {
              this.moreEl.classList.add('hidden');
              if (m.blocked) this.toast(m.blocked);
              else m.run();
            },
          },
          icon(m.icon, 15),
          h('span', null, m.label),
          m.key ? h('kbd', null, m.key.toUpperCase()) : '',
        ),
      );
  }

  private toggleMore(items: ReturnType<Hud['moreItems']>): void {
    if (!this.moreEl.classList.contains('hidden')) {
      this.moreEl.classList.add('hidden');
      return;
    }
    this.renderMore(items);
    this.moreEl.classList.remove('hidden');
    const b = this.bar.querySelector<HTMLElement>('[data-more]')?.getBoundingClientRect();
    if (b) {
      const w = this.moreEl.offsetWidth;
      this.moreEl.style.transform = `translate(${Math.round(Math.min(innerWidth - w - 8, b.left))}px, ${Math.round(b.top - this.moreEl.offsetHeight - 8)}px)`;
    }
    this.moreEl.querySelector<HTMLElement>('button')?.focus();
  }

  /** End turn, always at the right of the bar: one dot per hero who can still act. */
  private endButton(d: NonNullable<GameState['delve']>): HTMLElement {
    const ready = d.heroes.filter((x) => able(x) && (!x.moved || !x.acted));
    const idle = d.heroes.filter((x) => able(x) && !x.moved && !x.acted).length;
    const btn = h(
      'button',
      {
        type: 'button',
        class: `dl-end ${ready.length === 0 ? 'pulse' : ''}`,
        disabled: this.busy,
        'data-key': 'e',
        'data-tip': `End turn · key E\nThen the castle moves: the lantern burns 1 if open, monsters do what their marks say.\n${ready.length ? `${ready.length} hero${ready.length === 1 ? '' : 'es'} can still act${idle ? ` (${idle} did nothing yet)` : ''}.` : 'Everyone is done.'}`,
        onclick: () => this.endTurn(),
      },
      h('span', { class: 'dl-end-t' }, 'End turn'),
      h('span', { class: 'dl-end-dots', 'aria-label': `${ready.length} can still act` }, ...ready.map(() => h('i', null))),
      h('span', { class: 'dl-kb' }, 'E'),
    );
    return btn;
  }

  // ------------------------------------------------------------ the Chronicle

  private renderLog(): void {
    this.chron.render();
  }

  log(text: string, cls = ''): void {
    this.chron.add(text, cls);
  }

  // ------------------------------------------------------------ the crew

  private renderRivals(): void {
    const r = this.state?.delve?.rivals;
    const d = this.state?.delve;
    if (!r || !d || !r.spotted || d.round < r.entersRound) {
      this.crewEl.classList.add('hidden');
      return;
    }
    clear(this.crewEl);
    const alive = r.members.filter((m) => m.hp > 0 && !m.goneOut).length;
    const st = STANCE[r.stance];
    const tm = TEMPERAMENT[r.temperament ?? 'prospector'];
    const sel = this.selected();
    const canDeal = !!sel && this.dealsFor(sel.heroId).length > 0;
    this.crewEl.className = `dl-crew dl-pan crew-${r.crew} st-${st.cls}`;
    this.crewEl.append(
      h('span', { class: 'dl-crew-top' }, icon('crew', 14), h('span', { class: 'dl-crew-n', tabindex: 0, 'data-tip': `${r.name} · ${tm.name.toLowerCase()}\n${CREW[r.crew]?.blurb ?? ''}\n${tm.text}` }, r.name), h('span', { class: `dl-crew-st st-${r.stance}`, tabindex: 0, 'data-tip': `${st.name} · ${st.text}` }, st.name.toLowerCase(), r.stance === 'hired' && r.hiredRounds ? ` · ${r.hiredRounds}` : '')),
      r.stance === 'demanding' ? h('span', { class: 'dl-crew-toll', tabindex: 0, 'data-tip': `The toll · pay ${r.toll ?? TOLL_MIN} (gold first, then gems) or they attack in the next castle turn. Parley to pay.` }, `Pay ${r.toll ?? TOLL_MIN} or they attack next turn`) : '',
      h('span', { class: 'dl-crew-line' }, r.stance === 'hired' ? 'Fighting beside you' : `${cap(GOAL_TEXT[r.goal] ?? '')}${r.aim ? ` · ${r.aim.what}` : ''}`, ` · ${alive} on the map`),
      r.members.some((m) => m.level) ? h('span', { class: 'dl-crew-line' }, `Level ${Math.max(...r.members.map((m) => m.level ?? 1))}, ${CREW[r.crew]?.tiers ?? ''}`) : '',
      r.members.some((m) => m.dragging) ? h('span', { class: 'dl-crew-line bad' }, `Dragging ${r.members.filter((m) => m.dragging).map((m) => this.nameOf(m.dragging!)).join(', ')} out!`) : '',
      canDeal ? h('button', { type: 'button', class: 'dl-btn dl-btn-s', 'data-tip': 'Parley · free · key B\nPay, hire, give a job, or fight.', onclick: () => this.openParley() }, icon('scales', 14), ' Parley ', h('kbd', null, 'B')) : '',
    );
    this.crewEl.classList.remove('hidden');
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
    this.pill.classList.add('hidden');
    this.moreEl.classList.add('hidden');
    this.closePreview();
    this.parleyHero = sel.heroId;
    sfx.play('flip', { pitch: 0.9 });
    this.renderParley();
    this.drawHighlights();
    this.hideCard();
    this.updateCoach();
  }

  private closeParley(): void {
    this.parleyHero = null;
    this.parleyEl.classList.add('hidden');
    this.root.classList.remove('parley-open');
    this.updateCoach();
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
    el.className = `dl-parley crew-${r.crew}`;
    this.root.classList.add('parley-open');
    const st = STANCE[r.stance];
    const tm = TEMPERAMENT[r.temperament ?? 'prospector'];
    const who = this.heroDef(hd.heroId)?.name ?? hd.heroId;
    const blurb = r.temperament === 'cutthroat' ? "Cutthroats. They hold the way and want what you carry." : "Prospectors. They're here for the loot, not for you. Yet.";
    el.append(
      h(
        'div',
        { class: 'dl-pl-head' },
        h('div', { class: 'dl-pl-t' }, h('span', { class: 'dl-kick' }, `Parley · ${who} speaks · ${st.name.toLowerCase()}`), h('span', { class: 'dl-pl-name', tabindex: 0, 'data-tip': `${r.name} · ${tm.name.toLowerCase()}, ${st.name.toLowerCase()}\n${CREW[r.crew]?.blurb ?? ''}\n${tm.text}\n${st.text}` }, r.name), h('span', { class: 'dl-pl-blurb' }, blurb)),
        h(
          'div',
          { class: 'dl-pl-mems', 'aria-label': 'The crew' },
          ...r.members
            .filter((m) => !m.goneOut)
            .map((m) =>
              h(
                'span',
                { class: `dl-pl-mem ${m.hp <= 0 ? 'dead' : ''}`, tabindex: 0, 'data-tip': `${m.name} · ${className(m.cls)}${m.level ? `, level ${m.level}` : ''}\n${m.hp > 0 ? `${m.hp} of ${m.maxHp} HP` : 'dead'}${crewMemberLine(m) ? ` · ${crewMemberLine(m)}` : ''}\n${CREW_KIT[m.cls] ?? RIVAL_KIT[m.cls] ?? ''}` },
                h('span', { class: `cbadge dl-hexb cls-${m.cls}` }, classGlyph(m.cls)),
                h('span', { class: 'dl-pl-mem-n' }, m.name.replace(/^Sister /, '')),
              ),
            ),
        ),
      ),
    );
    if (r.stance === 'demanding') el.append(h('div', { class: 'dl-pl-toll' }, h('b', null, '"Your gold or your blood."'), ` Pay ${r.toll ?? TOLL_MIN} or they attack next turn.`));
    // What the party carries, and how they take it.
    const purse = d.heroes.filter((x) => x.status === 'active').flatMap((x) => x.pack).filter((i) => i.kind === 'gold' || i.kind === 'gem' || i.kind === 'jewelry');
    const coin = purse.filter((i) => i.kind === 'gold').reduce((a, i) => a + i.amount, 0);
    const gems = purse.filter((i) => i.kind !== 'gold');
    const val = gems.reduce((a, i) => a + i.amount, 0);
    const words = [coin ? `${coin} gold` : '', ...gems.map((i) => `${article(i.name)} ${i.name.toLowerCase()}`)].filter(Boolean);
    el.append(
      h(
        'div',
        { class: 'dl-pl-purse' },
        h('span', { class: 'dl-kick dl-kick-dim' }, 'You carry'),
        h('span', null, words.length ? listAnd(words) : 'nothing they want', val ? h('span', { class: 'dim' }, ` (worth ${coin + val})`) : ''),
        h('span', { class: 'dl-pl-how', 'data-tip': "How they take it · gold coins first, then gems and jewelry, smallest first, until the price is covered. No change given. Heirlooms, hoard pieces and story items are never handed over." }, 'They take gold first, then gems. No change.'),
      ),
    );
    if (r.aim && r.stance !== 'hired' && r.stance !== 'bribed') el.append(h('div', { class: 'dl-pl-aim' }, h('span', { class: 'dl-kick dl-kick-dim' }, 'After'), ` ${r.aim.what} · ${r.aim.rounds <= 0 ? 'there now' : `${r.aim.rounds} round${r.aim.rounds === 1 ? '' : 's'} away`} · about ${r.aim.value} gold `, h('button', { type: 'button', class: 'dl-linkbtn', onclick: () => this.dio.lookAt(r.aim!.at) }, 'look')));
    // The deals, as tiles.
    const grid = h('div', { class: 'dl-pl-deals' });
    const jobs = deals.filter((x) => x.deal === 'job');
    const fight = deals.find((x) => x.deal === 'fight');
    for (const o of deals) if (o.deal !== 'fight' && o.deal !== 'job') grid.append(this.dealTile(o));
    if (jobs.length) grid.append(this.jobTile(jobs));
    el.append(grid);
    el.append(
      h(
        'div',
        { class: 'dl-pl-foot' },
        h('span', { class: 'dim small' }, 'Talking is free · one deal a round'),
        h(
          'span',
          { class: 'dl-roll-btns' },
          h('button', { type: 'button', class: 'dl-btn dl-ghost', onclick: () => this.cancel() }, 'Walk away ', h('kbd', null, 'Esc')),
          fight ? h('button', { type: 'button', class: 'dl-btn dl-danger dl-fight', disabled: !fight.ok, 'data-deal': 'fight', 'data-tip': fight.ok ? `Fight them · ${fight.text}` : `Fight them · ${fight.blocked ?? ''}`, onclick: () => void this.makeDeal(fight) }, 'Fight them') : '',
        ),
      ),
    );
    el.classList.remove('hidden');
  }

  private dealTile(o: DealOption): HTMLElement {
    const risky = !!o.risk && /1 in|%|turn on/i.test(o.risk) && !/not turn/i.test(o.risk);
    return h(
      'button',
      {
        type: 'button',
        class: `dl-deal ${o.ok ? '' : 'blocked'} ${o.deal === 'hire' ? 'hire' : ''}`,
        'data-deal': o.deal,
        'aria-disabled': o.ok ? undefined : 'true',
        'data-tip': `${o.label} · ${o.price ? `${o.price} gold` : 'free'}${o.pays && o.ok ? `\nThey take: ${o.pays}` : ''}${!o.ok && o.blocked ? `\nCan't now: ${o.blocked}` : ''}`,
        onclick: () => void this.makeDeal(o),
      },
      h('span', { class: 'dl-deal-top' }, h('span', { class: 'dl-deal-n' }, o.label), h('span', { class: 'dl-deal-p num' }, o.price ? `${o.price}` : 'free')),
      h('span', { class: 'dl-deal-d' }, o.text),
      o.ok && o.pays ? h('span', { class: 'dl-deal-pay' }, `You'd hand over ${o.pays}.`) : '',
      o.risk ? h('span', { class: `dl-deal-risk ${risky ? 'bad' : ''}` }, o.risk) : '',
      !o.ok && o.blocked ? h('span', { class: 'dl-deal-why' }, o.blocked) : '',
    );
  }

  /** The jobs share one tile with a button each. */
  private jobTile(jobs: DealOption[]): HTMLElement {
    const any = jobs.find((x) => x.ok) ?? jobs[0]!;
    return h(
      'div',
      { class: `dl-deal ${jobs.some((x) => x.ok) ? '' : 'blocked'}`, 'data-deal': 'job' },
      h('span', { class: 'dl-deal-top' }, h('span', { class: 'dl-deal-n' }, 'Give them a job'), h('span', { class: 'dl-deal-p num' }, `${any.price}`)),
      h('span', { class: 'dl-deal-d' }, 'One quick job, then they go back to what they were doing.'),
      any.ok && any.pays ? h('span', { class: 'dl-deal-pay' }, `You'd hand over ${any.pays}.`) : !jobs.some((x) => x.ok) && any.blocked ? h('span', { class: 'dl-deal-why' }, any.blocked) : '',
      h('span', { class: 'dl-deal-jobs' }, ...jobs.map((j) => h('button', { type: 'button', class: 'dl-sub', 'data-job': j.job ?? '', disabled: !j.ok, 'data-tip': `${j.job ? JOB_NAME[j.job] : j.label} · ${j.text}${j.ok ? '' : `\nCan't now: ${j.blocked ?? ''}`}`, onclick: () => void this.makeDeal(j) }, j.job ? JOB_NAME[j.job] : j.label))),
    );
  }

  // ------------------------------------------------------------ banners, toasts

  /** V3.7 (20.4): "Taken!" when a crew drags a hero out of the castle. */
  async capturedBanner(heroId: string, by: string, wait: (s: number) => Promise<void>): Promise<void> {
    const crew = this.state?.delve?.rivals?.name ?? 'A crew';
    await this.flashBanner(`${this.nameOf(heroId)} is taken!`, `${this.nameOf(by)} of ${crew} dragged them out. A "Bring back" contract will go up at camp.`, 'taken', wait, 0.9);
  }

  /** The round's start ("Round 3 · your move") and the castle's ("The castle stirs"). */
  async banner(title: string, sub: string, wait: (s: number) => Promise<void>, world = false): Promise<void> {
    if (world) {
      // The castle's turn has its own standing banner (phase()); a beat is enough.
      await wait(0.35);
      return;
    }
    await this.flashBanner(title, sub, 'round', wait, 0.55);
  }

  private async flashBanner(title: string, sub: string, cls: string, wait: (s: number) => Promise<void>, hold: number): Promise<void> {
    clear(this.bannerEl);
    this.bannerEl.className = `dl-banner ${cls}`;
    this.bannerEl.append(h('span', { class: 'dl-banner-t bn-title' }, title), h('span', { class: 'dl-banner-s bn-sub' }, sub));
    await wait(hold);
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
    // V4.1 (WS2): the light the selected hero stands in (engine.brightness: bright, dim castle light, dark).
    const b: Brightness = unlit ? (sel!.at.level === 3 ? 'pitch' : 'dark') : this.baseDark;
    this.vignette.dataset.b = b;
  }

  // ------------------------------------------------------------ confirm and menu

  confirm(text: string, okLabel: string, ok: () => void, opts: { title?: string; cancel?: string; danger?: boolean } = {}): void {
    this.confirmBox = { text, ok };
    clear(this.modal);
    this.modal.append(
      h(
        'div',
        { class: `dl-modal-box ${opts.danger ? 'danger' : ''}`, role: 'dialog', 'aria-modal': 'true' },
        opts.title ? h('div', { class: 'dl-modal-t' }, opts.title) : '',
        h('p', null, text),
        h(
          'div',
          { class: 'dl-roll-btns' },
          h('button', { type: 'button', class: 'dl-btn dl-ghost', onclick: () => this.closeConfirm() }, `${opts.cancel ?? 'Cancel'} `, h('kbd', null, 'Esc')),
          h(
            'button',
            {
              type: 'button',
              class: `dl-btn ${opts.danger ? 'dl-danger' : 'dl-primary'}`,
              onclick: () => {
                this.closeConfirm();
                ok();
              },
            },
            okLabel,
            ' ',
            h('kbd', null, 'Enter'),
            h('kbd', null, 'E'),
          ),
        ),
      ),
    );
    this.modal.classList.remove('hidden');
    this.modal.querySelector<HTMLElement>('.dl-primary, .dl-danger')?.focus();
  }

  /** V5.0 (spec 32.8): every key on one card, grouped; the Actions group reads the bar as it stands. */
  toggleKeys(): void {
    if (!this.keysEl.classList.contains('hidden')) {
      this.keysEl.classList.add('hidden');
      return;
    }
    const kb = (...ks: string[]) => h('span', { class: 'dl-keys-k' }, ...ks.map((k) => h('kbd', null, k)));
    const row = (keys: string[], what: string) => h('div', { class: 'dl-keys-row' }, kb(...keys), h('span', null, what));
    const group = (title: string, ...rows: HTMLElement[]) => h('div', { class: 'dl-keys-g' }, h('span', { class: 'dl-kick dl-kick-dim' }, title), ...rows);
    const acts: HTMLElement[] = [];
    for (const b of this.bar.querySelectorAll<HTMLElement>('button[data-action]')) {
      const k = b.querySelector('.dl-kb')?.textContent;
      const l = b.querySelector('.dl-ab-l')?.textContent;
      if (k && l) acts.push(row([k], l));
    }
    clear(this.keysEl);
    this.keysEl.append(
      h(
        'div',
        { class: 'dl-modal-box dl-keys-box', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Keys' },
        h('div', { class: 'dl-keys-head' }, h('span', { class: 'dl-modal-t' }, 'Keys'), h('button', { type: 'button', class: 'dl-btn dl-ghost dl-btn-s', onclick: () => this.keysEl.classList.add('hidden') }, 'Close ', h('kbd', null, 'Esc'))),
        h(
          'div',
          { class: 'dl-keys-cols' },
          group('Camera', row(['W', 'A', 'S', 'D'], 'pan (or the arrows)'), row(['[', ']'], 'rotate a sixth of a turn'), row(['wheel'], 'zoom'), row(['F'], 'center on the selected hero'), row(['right drag'], 'orbit'), row(['middle drag'], 'pan')),
          group('Heroes and the turn', row(['1', '2', '3', '4'], 'select a hero'), row(['Tab'], 'next hero with something left'), row(['Shift'], 'walk or sneak (a tap; this hero only)'), row(['E'], 'end the turn, or confirm what is open'), row(['Enter', 'Space'], 'confirm; Space also attacks, or takes the marked target'), row(['Esc'], 'cancel, or close this'), row(['Alt'], 'hold: the numbers behind every card'), row(['Space'], "hold: hurry the castle's turn")),
          group('Actions on the bar now', ...(acts.length ? acts : [h('span', { class: 'dim' }, 'Nobody selected.')]), row(['L'], 'lantern shutter'), row(['B'], 'parley'), row(['T'], 'stairs or lift'), row(['Q'], 'leave'), row([',', '.'], 'which arrow to loose')),
          group('Reactions', row(['1', 'Enter'], 'the first answer'), row(['2', 'Esc'], 'the second')),
        ),
      ),
    );
    this.keysEl.classList.remove('hidden');
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
    this.renderMenu();
    m.classList.remove('hidden');
  }

  private renderMenu(): void {
    const m = this.menuEl;
    clear(m);
    const st = this.host.settings;
    const check = (label: string, on: boolean, set: (v: boolean) => void, tip = '') =>
      h('label', { class: 'dl-check', 'data-tip': tip || undefined }, h('input', { type: 'checkbox', checked: on, onchange: (e: Event) => set((e.target as HTMLInputElement).checked) }), ` ${label}`);
    const save = () => {
      this.host.saveSettings();
      this.host.applySettings();
    };
    m.append(
      h('div', { class: 'dl-menu-sec' }, h('span', { class: 'dl-kick dl-kick-dim' }, 'Playback'), h('span', { class: 'dl-menu-row' }, ...SPEEDS.map((sp) => h('button', { type: 'button', class: `dl-btn dl-btn-s ${st.speed === sp.value ? 'on' : ''}`, onclick: () => this.setSpeed(sp.value) }, sp.label)))),
      h(
        'div',
        { class: 'dl-menu-sec' },
        h('span', { class: 'dl-kick dl-kick-dim' }, 'Settings'),
        check('Sound', !sfx.muted, (v) => {
          sfx.setMuted(!v);
        }),
        check('Reduce camera shake', st.reduceShake, (v) => {
          st.reduceShake = v;
          save();
        }),
        check('Ask before ending a turn while someone can still act', !st.noEndTurnAsk, (v) => {
          st.noEndTurnAsk = !v;
          save();
        }),
        check('Auto end turn', st.autoEndTurn !== false, (v) => {
          st.autoEndTurn = v;
          save();
          if (!v) this.cancelFlow();
        }, 'When nobody can move, act or use anything, the turn ends on its own after a moment. Any key or click keeps it open.'),
        check('Lower walls near the camera', !!st.cutaway, (v) => {
          st.cutaway = v;
          save();
        }, 'Walls between the camera and your heroes drop low so you can see past them.'),
        check('Full hover cards (as if Alt were held)', !!st.fullCards, (v) => {
          st.fullCards = v;
          save();
          this.cardKey = '';
          this.applyHover();
        }, 'For touch screens: every hover card shows its rules and numbers.'),
        h(
          'span',
          { class: 'dl-menu-row' },
          check('First-delve tips', !this.coach.off, (v) => {
            this.coach.setOff(!v);
            this.updateCoach();
          }),
          h('button', { type: 'button', class: 'dl-btn dl-btn-s', 'data-tip': 'Show the three tips again · from now, on any delve.', onclick: () => { this.coach.reset(); this.updateCoach(); this.toast('The tips will show again.'); } }, 'Show them again'),
        ),
      ),
      h('div', { class: 'dl-menu-sec dl-legend' }, h('span', { class: 'dl-kick dl-kick-dim' }, 'Keys and marks'), ...legend()),
      h('div', { class: 'dl-menu-row dl-menu-end' }, h('button', { type: 'button', class: 'dl-btn dl-btn-s dl-danger', onclick: () => this.confirm('Abandon the delve? Heroes standing on a way out get out. Everyone else is left behind and dies.', 'Abandon', () => this.host.abandonDelve(), { title: 'Abandon the delve?', danger: true }) }, 'Abandon delve'), h('button', { type: 'button', class: 'dl-btn dl-btn-s', onclick: () => this.host.toTitle() }, 'Title screen')),
    );
  }

  private setSpeed(v: number): void {
    this.host.settings.speed = v;
    this.host.saveSettings();
    this.host.applySettings();
    this.renderMenu();
  }

  private buildCamBox(): void {
    clear(this.camBox);
    const b = (ic: IconName, tip: string, run: () => void) => h('button', { type: 'button', class: 'dl-cam-b', 'data-tip': tip, 'aria-label': tip.split(' · ')[0], onclick: run }, icon(ic, 16));
    this.camBox.append(
      b('rotL', 'Rotate left · 60°, key [. Right-drag to orbit freely.', () => this.dio.rig.snapRotate(1)),
      b('rotR', 'Rotate right · 60°, key ].', () => this.dio.rig.snapRotate(-1)),
      b('plus', 'Zoom in · or the mouse wheel.', () => this.dio.rig.zoomBy(0.8)),
      b('minus', 'Zoom out · or the mouse wheel.', () => this.dio.rig.zoomBy(1.25)),
      b('target', 'Center · on the selected hero, key C.', () => {
        const s = this.selected();
        if (s) this.dio.lookAt(s.at);
      }),
    );
  }

  private renderEmpty(): void {
    const s = this.state;
    const lvl = this.dio.shownLevel;
    const seen = !!this.vis && [...this.vis.explored].some((k) => k.startsWith(`${lvl}:`));
    const name = this.engine.castle().levels.find((l) => l.level === lvl)?.name ?? `Level ${lvl}`;
    clear(this.emptyEl);
    if (s?.delve && !seen) {
      this.emptyEl.append(h('div', { class: 'bn-title' }, cap(name)), h('div', { class: 'bn-sub' }, 'Unexplored. Find the stairs, the lift or the pit.'));
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

  // ------------------------------------------------------------ coach marks

  private updateCoach(): void {
    const s = this.state;
    const d = s?.delve;
    const first = !!s && s.campaign.delveCount <= 1;
    if (!d || !this.coach.active(first) || this.busy || d.phase !== 'player' || this.pv || this.parleyHero || this.root.classList.contains('hidden')) {
      this.coach.hide();
      return;
    }
    const sel = this.selected();
    const name = sel ? (this.heroDef(sel.heroId)?.name ?? '') : '';
    const barR = this.bar.getBoundingClientRect();
    if (!this.coach.isDone(1)) {
      // Above the hotbar, left of centre: the board is just above.
      const r = new DOMRect(barR.left + barR.width * 0.3, barR.top, barR.width * 0.2, 1);
      this.coach.show(1, `Click a lit hex to move ${name}. Each hero moves once and acts once a round, in any order.`, { at: r });
      return;
    }
    const acts = this.bar.querySelector('.dl-acts')?.getBoundingClientRect();
    const someAction = this.options.some((o) => !o.blocked && !MORE_ACTIONS.has(o.action) && o.action !== 'leave');
    if (!this.coach.isDone(2) && someAction && acts) {
      this.coach.show(2, 'Pick an action, then its target.', { at: acts });
      return;
    }
    const idle = d.heroes.filter((x) => able(x) && !x.moved && !x.acted).length;
    const end = this.bar.querySelector('.dl-end')?.getBoundingClientRect();
    if (!this.coach.isDone(3) && end && (idle === 0 || this.coach.isDone(2))) {
      this.coach.show(3, "When everyone's done, End turn: then the castle moves.", { at: end });
      return;
    }
    this.coach.hide();
  }

  // ------------------------------------------------------------ input

  private toggleFollow(): void {
    this.follow = !this.follow;
    sfx.play('click', { pitch: this.follow ? 1.2 : 0.8 });
    this.renderBar();
  }

  /** 20.5: free move ends: "Combat!" with the reason; begins: a quiet note. */
  async calmBanner(calm: boolean, why: string | undefined, wait: (s: number) => Promise<void>): Promise<void> {
    if (calm) {
      this.toast(`Calm again: free move. ${why ?? ''}`.trim());
      return;
    }
    await this.flashBanner('Combat!', why ?? 'Something has noticed the party. Your move.', 'combat', wait, 0.7);
  }

  // ------------------------------------------------------------ reactions (V4.1, spec 31.13)

  /** The kinds of reaction this hero can be asked for: the hidden swing for everyone, overwatch for a Ranger, the shield block with a shield (V5.0). */
  private reactionKinds(cls: HeroClass, shield = false): ReactionKind[] {
    return [...(cls === 'ranger' ? (['hiddenSwing', 'overwatch'] as ReactionKind[]) : (['hiddenSwing'] as ReactionKind[])), ...(shield ? (['shieldBlock'] as ReactionKind[]) : [])];
  }

  /** The small Reactions button beside the hero's name: opens the per-hero settings (Ask / Always / Never). */
  private reactionsButton(sel: HeroInDelve, def: Hero): HTMLElement {
    const kinds = this.reactionKinds(def.cls, !!def.shield);
    const set = (k: ReactionKind) => sel.reactions?.[k] ?? 'ask';
    const custom = kinds.some((k) => set(k) !== 'ask');
    const lines = kinds.map((k) => `${REACT_NAME[k]}: ${SETTING_WORD[set(k)]}`).join('\n');
    return h(
      'button',
      {
        type: 'button',
        class: `dl-react-b ${custom ? 'custom' : ''} ${this.reactOpen ? 'open' : ''}`,
        'aria-expanded': this.reactOpen ? 'true' : 'false',
        'aria-label': `${def.name}'s reactions`,
        'data-react-b': '1',
        disabled: this.busy,
        'data-tip': `Reactions · ${def.name}\nWhat ${def.name} does when the castle's turn gives them a chance to react.\n${lines}\nAsk pauses the castle's turn for your answer; Always and Never answer for you.`,
        onclick: () => {
          this.reactOpen = !this.reactOpen;
          this.renderBar();
        },
      },
      icon('target', 14),
      custom ? h('span', { class: 'dl-react-dot' }) : '',
    );
  }

  /** The settings popover above the hotbar: one Ask / Always / Never row per kind of reaction. */
  private reactionsPop(sel: HeroInDelve, def: Hero): HTMLElement {
    const row = (k: ReactionKind) => {
      const now = sel.reactions?.[k] ?? 'ask';
      return h(
        'div',
        { class: 'dl-reacts-row' },
        h('span', { class: 'dl-reacts-k', tabindex: 0, 'data-tip': REACT_HELP[k](def.name) }, REACT_NAME[k]),
        h(
          'span',
          { class: 'dl-seg', role: 'radiogroup', 'aria-label': `${def.name}: ${REACT_NAME[k]}` },
          ...(['ask', 'always', 'never'] as const).map((v) =>
            h(
              'button',
              {
                type: 'button',
                role: 'radio',
                class: `dl-seg-b ${now === v ? 'on' : ''}`,
                'aria-checked': now === v ? 'true' : 'false',
                disabled: this.busy,
                'data-tip': `${REACT_NAME[k]} · ${SETTING_WORD[v]}\n${REACT_SETTING_HELP[k][v](def.name)}`,
                onclick: () => this.setReaction(sel.heroId, k, v),
              },
              SETTING_WORD[v],
            ),
          ),
        ),
      );
    };
    return h(
      'div',
      { class: 'dl-reacts-pop', role: 'group', 'aria-label': `${def.name}'s reactions` },
      h('div', { class: 'dl-reacts-t' }, `Reactions · ${def.name}`),
      h('p', { class: 'dl-reacts-p' }, `When the castle's turn gives ${def.name} a chance to react: ask you, always do it, or never.`),
      ...this.reactionKinds(def.cls, !!def.shield).map(row),
    );
  }

  private setReaction(heroId: string, kind: ReactionKind, setting: ReactionSetting): void {
    if (this.busy) return;
    void this.host.send({ type: 'setReaction', heroId, kind, setting });
  }

  /**
   * The castle's turn waits for a hero's answer: the reaction card (who, what, the two options with their consequence).
   * Enter or 1 takes the first, Esc or 2 the second. Resolves with the answer; the app sends it and plays on.
   */
  askReaction(q: ReactionQuestion): Promise<ReactionChoice> {
    return new Promise((resolve) => {
      const name = this.heroDef(q.heroId)?.name ?? q.heroId;
      const done = (c: ReactionChoice) => {
        if (this.reactWait?.q !== q) return;
        this.reactWait = null;
        this.reactEl.classList.add('hidden');
        clear(this.reactEl);
        sfx.play('click', { pitch: c === 'yes' ? 1.1 : 0.85 });
        resolve(c);
      };
      this.reactWait = { q, done };
      this.caption.classList.add('hidden');
      this.hideTip();
      const opt = (c: ReactionChoice, keys: [string, string]) => {
        const o = c === 'yes' ? q.yes : q.no;
        return h(
          'button',
          { type: 'button', class: `dl-react-o ${c === 'yes' ? 'yes' : 'no'}`, 'data-choice': c, onclick: () => done(c) },
          h('span', { class: 'dl-react-ol' }, o.label, ' ', h('kbd', null, keys[0]), h('kbd', null, keys[1])),
          h('span', { class: 'dl-react-oc' }, o.line),
        );
      };
      clear(this.reactEl);
      this.reactEl.append(
        h('div', { class: 'dl-react-k' }, icon(q.kind === 'overwatch' ? 'shoot' : 'sword', 14), ` ${REACT_NAME[q.kind]} · ${name}`),
        h('p', { class: 'dl-react-q' }, q.text),
        h('div', { class: 'dl-react-opts' }, opt('yes', ['1', 'Enter']), opt('no', ['2', 'Esc'])),
        h('div', { class: 'dl-react-f' }, `The castle waits. To stop being asked, set ${name}'s Reactions (beside Walk/Sneak) to Always or Never.`),
      );
      this.reactEl.classList.remove('hidden');
      this.reactEl.focus({ preventScroll: true });
      sfx.play('click', { pitch: 1.3, gain: 0.6 });
    });
  }

  /** V4.0 (spec 26.1): Walk/Sneak is per hero: set the selected hero's (a free command; the engine keeps it). */
  private setSneak(on: boolean): void {
    const sel = this.selected();
    if (!sel || this.busy || this.sneak === on) return;
    void this.host.send({ type: 'setMoveMode', heroId: sel.heroId, sneak: on });
  }

  private endTurn(): void {
    if (this.busy) return;
    this.cancel();
    const s = this.state;
    const go = () => {
      this.coach.done(3);
      this.coach.done(1);
      void this.host.send({ type: 'endTurn' });
    };
    // V5.0 (P, spec 32.6): the question means "someone can still do something", on the flow's own test.
    const can = s ? stillCan(this.engine, s) : [];
    if (can.length && !this.host.settings.noEndTurnAsk) {
      const lines = can.map((x) => `${this.heroDef(x.heroId)?.name ?? x.heroId} can still ${listWords(x.left.slice(0, 3))}${x.left.length > 3 ? ' and more' : ''}`);
      this.confirm(`${lines.join('. ')}. End the turn anyway?`, 'End turn', go, { title: `${can.length} can still act`, cancel: 'Keep playing' });
      return;
    }
    go();
  }

  /** V5.0 (spec 32.8): a tap of Shift (down and up with no other key between) flips the selected hero's Walk / Sneak. */
  private shiftArmed = false;
  private onKeyUp(e: KeyboardEvent): void {
    if (e.key !== 'Shift') return;
    const armed = this.shiftArmed;
    this.shiftArmed = false;
    if (!armed || !this.state?.delve || this.root.classList.contains('hidden') || this.busy || this.reactWait || this.confirmBox || this.parleyHero) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    this.setSneak(!this.sneak);
  }

  private onKey(e: KeyboardEvent): void {
    const s = this.state;
    if (e.key === 'Shift') {
      if (!e.repeat) this.shiftArmed = true;
      return;
    }
    this.shiftArmed = false;
    if (!s?.delve || this.root.classList.contains('hidden')) return;
    this.cancelFlow(); // V5.0 (P): any key is the player's: the turn waits for them
    // V4.1 (spec 31.13): the reaction card takes its keys first, and only those, while the castle waits.
    // V5.0 (P, B3): E is deliberately inert here. The card has two real answers and comes up during the castle's turn,
    // right after the player pressed E to end theirs; a second E must not strike (and blow their cover) unread.
    if (this.reactWait) {
      const w = this.reactWait;
      if (e.key === 'Enter' || e.key === '1') {
        e.preventDefault();
        w.done('yes');
      } else if (e.key === 'Escape' || e.key === '2') {
        e.preventDefault();
        w.done('no');
      }
      return;
    }
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    const k0 = e.key.toLowerCase();
    if (e.key === 'Alt') {
      e.preventDefault();
      this.setAlt(true);
      return;
    }
    if (e.key === 'Escape') {
      this.cancel();
      return;
    }
    // V5.0 (P, B3): E confirms too. While a confirmation or a roll panel is open, E, Enter and Space all confirm it,
    // and E never ends the turn underneath. A held key (auto-repeat) never confirms a window it just raised.
    const confirms = (e.key === 'Enter' || e.key === ' ' || k0 === 'e') && !e.repeat;
    if (this.confirmBox) {
      if (confirms) {
        e.preventDefault();
        const ok = this.confirmBox.ok;
        this.closeConfirm();
        ok();
      }
      return;
    }
    if (this.busy) return;
    if (this.parleyHero) return;
    if (this.pv) {
      // V4.1 (WS6): , and . step through the arrows on the roll panel too.
      if ((e.key === ',' || e.key === '.') && this.arrowChoices(this.pv.option).length) {
        e.preventDefault();
        const ids = [null, ...this.arrowChoices(this.pv.option).map((i) => i.id)];
        const i = ids.indexOf(this.arrowNow(this.pv.option)?.id ?? null);
        this.repickArrow(ids[(i + (e.key === '.' ? 1 : ids.length - 1)) % ids.length] ?? null);
        return;
      }
      if (confirms) {
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
    // V4.0 (spec 30.3): picking among options: Tab or the arrows mark the next, Enter takes the marked one.
    // V4.1 (WS6): , and . step through the arrows for the armed shot (Plain · Glow · Fire ...).
    if (this.pending && !this.confirmBox && (e.key === ',' || e.key === '.') && this.arrowChoices(this.pending).length) {
      e.preventDefault();
      const o = this.pending;
      const ids = [null, ...this.arrowChoices(o).map((i) => i.id)];
      const i = ids.indexOf(this.arrowNow(o)?.id ?? null);
      this.arrowPick = ids[(i + (e.key === '.' ? 1 : ids.length - 1)) % ids.length] ?? null;
      this.pvCache.clear();
      this.showPill(o);
      this.showHot();
      return;
    }
    if (this.pending && !this.confirmBox) {
      if (e.key === 'Tab' || e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.stepHot(e.key === 'ArrowLeft' || e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey) ? -1 : 1);
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        const hot = this.hotTarget();
        if (hot && !(t instanceof HTMLButtonElement && t.classList.contains('dl-pill-opt'))) {
          e.preventDefault();
          this.choose(this.pending, hot);
          return;
        }
      }
    }
    // A focused button handles Enter and Space itself.
    if ((e.key === 'Enter' || e.key === ' ') && t instanceof HTMLButtonElement) return;
    const d = s.delve;
    const k = e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey || e.altKey) return;
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
    // V5.0 (spec 32.8): W A S D belong to the camera (camera.ts polls them); S no longer toggles sneaking.
    if (k === 'w' || k === 'a' || k === 's' || k === 'd') return;
    if (k === 'e') return this.endTurn();
    if (k === '[') return this.dio.rig.snapRotate(1);
    if (k === ']') return this.dio.rig.snapRotate(-1);
    if (k === 'f' || k === 'home') {
      const sel = this.selected();
      if (sel) this.dio.lookAt(sel.at);
      return;
    }
    if (e.key === '?' || e.key === 'F1') {
      e.preventDefault();
      this.toggleKeys();
      return;
    }
    if (this.pending && e.key === 'Enter') return;
    // Space: the marked target of an open pick, else the hero's attack (the keyMap holds ' ' for it).
    const fn = this.keyMap.get(k === ' ' ? ' ' : k);
    if (fn) {
      e.preventDefault();
      fn();
      return;
    }
    // 16.2: L shutters or opens the lantern for whoever carries it; B opens the parley when a crew is in reach.
    if (k === 'l') return this.toggleShutter();
    if (k === 'b') {
      const sel = this.selected();
      if (sel && this.dealsFor(sel.heroId).length) return this.openParley();
    }
  }
}

// ------------------------------------------------------------ helpers

/** "move, Attack or Take" */
function listWords(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? '';
  return `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`;
}

const TILE_NAME: Record<string, string> = {
  floor: 'Floor',
  wall: 'Wall',
  cracked: 'Cracked wall',
  pillar: 'Pillar',
  rubble: 'Rubble (costs 2)',
  door: 'Door',
  pit: 'Pit',
  stairs: 'Stairs',
  exit: 'Way out',
  brazier: 'Brazier',
  lift: 'Lift',
  prop: 'Furniture',
  tallprop: 'Furniture',
  sealed: 'The Sealed Stair: sealed shut',
};

const GOAL_TEXT: Record<string, string> = { loot: 'looting', objective: 'after your objective', leave: 'leaving' };

/** Short labels for the square buttons (the hover has the full one). */
const SHORT_LABEL: Partial<Record<ActionKind, string>> = {
  smashProp: 'Smash',
  setCharge: 'Set charge',
  setTripwire: 'Tripwire', // V4.1 (spec 31.3)
  throwCharge: 'Throw charge',
  passLantern: 'Pass lantern',
  torch: 'Light', // V4.1 (WS2)
  snuff: 'Snuff',
  dropTorch: 'Drop torch',
  nightthorn: 'Thorn',
  overwatch: 'Overwatch',
  knockback: 'Knockback',
  hamstring: 'Hamstring',
};

/** What each rival class does (16.5, 18.5), for tooltips. */
const RIVAL_KIT: Record<string, string> = {
  ranger: 'Longbow at range 6. Goes on overwatch.',
  shadowmancer: 'Veils herself; hard to see.',
  burglar: 'Sleep darts. Picks locks.',
  sellsword: 'Shield and sword: 3 slots, 2 damage, armor 1. Shoves a hero off an unrailed edge.',
  sapper: 'Hammer, and charges on fuses: the rings show a turn ahead, then 4 damage within 1 and 2 within 2. Noise 8.',
  pyromancer: 'Firebolts: marks a hero in range 5 a round ahead, then 3 Wits slots, 2 damage per hit.',
};

export function intentText(s: GameState, it: Intent, who?: string): string {
  const d = s.delve;
  const name = (id?: string) => (id ? (s.campaign.roster.find((x) => x.id === id)?.name ?? (d?.prisoner?.id === id ? d.prisoner.name : undefined) ?? d?.rivals?.members.find((r) => r.id === id)?.name ?? id) : '');
  const dmg = it.damage ? `, ${it.damage[0]}–${it.damage[1]} damage` : '';
  switch (it.kind) {
    case 'attack':
      // V4.0 (spec 29.3): a spider's bite carries venom.
      if (who && d?.monsters.find((m) => m.id === who)?.kind === 'spider') return `bites ${name(it.targetId)}${dmg} (poison)`;
      return `strikes ${name(it.targetId)}${dmg}`;
    case 'move':
      return it.sneak ? 'sneaks' : 'moves';
    case 'web':
      return `webs ${name(it.targetId)}`;
    case 'steal':
      return `steals from ${name(it.targetId)}`;
    case 'flee':
      return it.targetId ? `flees from ${name(it.targetId)} (feared)` : 'flees';
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
    case 'venomdart':
      return `throws a poison dart at ${name(it.targetId)} (a hit poisons: −1 a turn, never below 1)`;
    case 'carry':
      return `lifts ${name(it.targetId)} to carry them out`;
    // V4.1 (WS7, spec 31.9): crews as an equal power.
    case 'brace':
      return 'braces: hits on them do 1 less, and you roll −15% against them';
    case 'sleep':
      return `casts Sleep on ${name(it.targetId)} (2 Wits slots)`;
    case 'dread':
      return `casts Dread on ${name(it.targetId)} (2 Wits slots: a hit, and they can't act next turn)`;
    case 'nightthorn':
      return `looses a night thorn at ${name(it.targetId)} (2 Wits slots, 1 a hit, armor ignored)`;
    case 'briar':
      return `calls briars on ${name(it.targetId)} (2 Wits slots, 1 a hit and rooted)`;
    case 'antidote':
      return it.targetId && it.targetId !== who ? `gives ${name(it.targetId)} an antipoison` : 'drinks an antipoison';
    case 'kindle':
      return `kindles ${name(it.targetId)}'s ${it.item ?? 'light'}`;
    case 'arrow':
      // V4.1 (WS6, spec 31.8): a crew Ranger's specialty arrow.
      return it.item === 'glowarrows' ? `shoots a glow arrow at ${name(it.targetId)}: it lights them up for the crew` : it.item === 'barbarrows' ? `shoots a barbed arrow at ${name(it.targetId)}: a hit roots them 2 rounds` : `shoots a special arrow at ${name(it.targetId)}`;
    case 'toll':
      return `demands a toll: pay ${d?.rivals?.toll ?? 50} or they attack next turn`;
    case 'firebolt':
      return `hurls a firebolt at ${name(it.targetId)} (3 Wits slots at 60%, 2 per hit)`;
    case 'charge':
      return 'lights a charge: next turn 3 damage to everyone on the marked hexes';
    case 'fuse':
      return 'sets a charge with a 1-turn fuse on the marked hex: 4 within 1, 2 within 2, breaks walls';
    case 'rob':
      return `robs ${name(it.targetId)} and carries them toward the way out`;
    case 'potion':
      return it.targetId && it.targetId !== who ? `gives ${name(it.targetId)} a potion: back up` : 'backs off a hex and drinks a potion';
    case 'item':
      return `uses ${it.item ? `a ${it.item}` : 'an item'}${it.targetId ? ` on ${name(it.targetId)}` : ''}`;
    case 'fireball':
      return 'hurls a fireball at the marked hexes (3 Wits slots, 2 per hit)';
    case 'mend':
      return d?.rivals?.members.find((r) => r.id === it.targetId)?.downed || d?.heroes.find((h) => h.heroId === it.targetId)?.status === 'downed' ? `mends ${name(it.targetId)} back up (2 HP)` : `mends ${name(it.targetId)} (heals 4)`;
    case 'gust':
      return 'gusts everything round the marked hex outward (pits!)';
    case 'ward':
      return `wards ${name(it.targetId)}`;
    case 'glue':
      return 'throws a glue bomb at the marked hexes';
    case 'caltrops':
      return 'scatters caltrops on the marked hex';
    case 'firecracker':
      return 'throws a firecracker: noise 6 where it lands';
    case 'blink':
      return 'blinks away';
    case 'hamstring':
      return `shoots ${name(it.targetId)} in the legs (1 Finesse slot at −20%: a hit roots them 2 rounds)`;
    case 'pick': case 'smash': case 'disarm': case 'dig': // V4.0 (spec 28): crews play by the party's rules
      return { pick: 'picks a lock (silent when every slot hits)', smash: 'smashes a lock (noise 4)', disarm: 'disarms a trap (2 Finesse slots)', dig: 'digs through (noise 4)' }[it.kind];
    default:
      return 'waits';
  }
}

/** V4.1 (spec 31.4): an enemy's poison in words. */
function venomLine(f: { poisoned?: boolean }): string {
  return f.poisoned ? 'Poisoned: −1 a turn, never below 1.' : '';
}

/** Compass word from one hex to another, in world space (north = away from the default camera). */
function compass(from: Pos, to: Pos): string {
  const a = hexToWorld(from, 1);
  const b = hexToWorld(to, 1);
  const ang = Math.atan2(b.x - a.x, -(b.z - a.z));
  const names = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  return names[Math.round(((ang + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8]!;
}

function abbrev(word: string): string {
  return word
    .split('-')
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

/** A small compass with an arrow pointing from one hex toward another (world space, north up). */
function compassSvg(from: Pos, to: Pos): HTMLElement {
  const a = hexToWorld(from, 1);
  const b = hexToWorld(to, 1);
  const ang = Math.atan2(b.x - a.x, -(b.z - a.z));
  const el = h('span', { class: 'dl-compass-ic', 'aria-hidden': 'true' });
  el.innerHTML = `<svg width="22" height="22" viewBox="0 0 22 22"><circle cx="11" cy="11" r="10" fill="none" stroke="#5a4c3f"/><g transform="rotate(${((ang * 180) / Math.PI).toFixed(1)} 11 11)"><path d="M11 15 V4 M7.5 7.5 L11 4 L14.5 7.5" fill="none" stroke="#e8a33d" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></g></svg>`;
  return el;
}

/** "Keep" for "the Ruined Keep": the level's last word. */
function shortLevel(name: string): string {
  const w = name.replace(/^the /i, '').split(/\s+/);
  return cap(w[w.length - 1] ?? name);
}

function article(name: string): string {
  return /^[aeiou]/i.test(name) ? 'an' : 'a';
}

function listAnd(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? '';
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

/** "45 gold, a garnet" with "+2 more" when long. */
function shortList(xs: string[]): string {
  if (xs.length <= 2) return xs.join(', ');
  return `${xs.slice(0, 2).join(', ')}, +${xs.length - 2} more`;
}

function esc(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** A HUD tip as HTML: "Name · kind" in the head, then the lines. */
function tipHtml(text: string): string {
  const [first = '', ...rest] = text.split('\n');
  const cut = first.indexOf(' · ');
  const kind = cut > 0 ? first.slice(cut + 3) : '';
  const short = kind.length > 0 && kind.length <= 26;
  const head = cut > 0 ? `<b>${esc(first.slice(0, cut))}</b>${short ? `<span class="dl-tip-kind">${esc(kind)}</span>` : ''}` : `<b>${esc(first)}</b>`;
  const lines = cut > 0 && !short ? [kind, ...rest] : rest;
  return `<span class="dl-tip-head">${head}</span>${lines.map((l) => `<span class="dl-tip-line">${esc(l)}</span>`).join('')}`;
}

/** Mana as diamonds: filled = left. */
function manaDias(left: number, max: number): HTMLElement {
  return h('span', { class: 'dl-mana', tabindex: 0, 'data-tip': `Mana · ${left} of ${max}\nPays for spells: Fireball 2, every other spell 1. No refills inside.` }, ...Array.from({ length: max }, (_, i) => h('i', { class: i < left ? 'on' : '' })));
}

/** The pack on a party card: 4 tiny slots with glyphs (a 2-slot item spans two), then the class kit. */
function packMini(pack: Item[], owner: string): HTMLElement {
  const socks: HTMLElement[] = [];
  let used = 0;
  const names: string[] = [];
  for (const it of pack) {
    if (isKit(it)) continue;
    const span = Math.max(1, Math.min(it.slots, PACK_SLOTS - used));
    socks.push(h('i', { class: `dl-mini full ${span > 1 ? 'wide' : ''}` }, itemGlyph(it.kind)));
    names.push(itemLabel(it));
    used += it.slots;
  }
  for (let i = used; i < PACK_SLOTS; i++) socks.push(h('i', { class: 'dl-mini' }));
  const free = Math.max(0, PACK_SLOTS - used);
  const row = h('span', { class: 'dl-minis', tabindex: 0, 'data-tip': `Pack · ${names.length ? names.join(', ') : 'empty'}${free ? `, ${free} free` : ', full'}\nSelect ${owner} to use what's in it (the bar's pack).` }, ...socks);
  const kit = pack.filter(isKit);
  return h('span', { class: 'dl-minipack' }, row, ...kit.map((it) => kitChip(it, owner, true, pack)));
}

/** V4.0 (spec 26.5): the hero's own kit, as a small chip ("⌐ own"). */
function kitChip(it: Item, owner: string, small = false, pack?: Item[]): HTMLElement {
  // V4.1 (WS6, spec 31.8): the Ranger's quiver: "➶ 10", bought arrows after.
  if (it.kind === 'quiver') {
    const bought = (pack ?? []).filter((i) => i.kind === 'arrows').reduce((n, i) => n + i.amount, 0);
    const tip = `${owner}'s own · ${it.amount} arrow${it.amount === 1 ? '' : 's'}; bought arrows after${bought ? ` (${bought} plain in the pack)` : ''}\nTakes no slot; can't be given away. ${QUIVER_LINE}${it.amount ? '' : '\nThe quiver is empty.'}`;
    return h('span', { class: `dl-own dl-quiver ${small ? 'sm' : ''} ${it.amount ? '' : 'empty'}`, tabindex: 0, 'data-kit': it.kind, 'data-tip': tip }, itemGlyph(it.kind), ' ', h('small', { class: 'num' }, `${it.amount}`));
  }
  // V4.0 (spec 30.2): both kits count their uses (one a level each delve); an old save's single pick reads 1.
  const n = Math.max(1, it.amount);
  const pick = it.kind === 'improvised';
  const what = pick ? `${n} improvised pick${n === 1 ? '' : 's'}` : `${n} improvised explosive${n === 1 ? '' : 's'}`;
  const use = pick ? 'Each Pick rolls 2 Finesse tries and uses one up, whatever happens. Use: Pick, next to a lock.' : `Blasts like a blasting charge (${V37.blastInner} within 1, ${V37.blastOuter} within 2), spent before bought charges. Use: Set charge or Throw charge.`;
  return h('span', { class: `dl-own ${small ? 'sm' : ''}`, tabindex: 0, 'data-kit': it.kind, 'data-tip': `${owner}'s own · ${what} left\nTakes no slot; can't be given away. A fresh set every delve: one for each level.\n${use}` }, itemGlyph(it.kind), h('small', { class: 'num' }, `${n}`), ' own');
}

/** The menu's legend: the marks over figures, on the party cards, and the keys (Legend.dc.html, compact). */
function legend(): HTMLElement[] {
  const li = (mark: HTMLElement | string, text: string) => h('span', { class: 'dl-leg-i' }, h('span', { class: 'dl-leg-m' }, mark), text);
  const svgEl = (name: IconName, color: string) => {
    const s = h('span', { class: 'icw' });
    s.innerHTML = iconSvg(name, 13, color);
    return s;
  };
  return [
    h(
      'div',
      { class: 'dl-leg-cols' },
      h(
        'div',
        { class: 'dl-leg-col' },
        h('span', { class: 'dl-leg-h' }, 'Over an enemy'),
        li(h('b', { class: 'tag-sleep' }, 'z'), 'Asleep: hears, doesn\'t see'),
        li(h('b', { class: 'tag-alert' }, '?'), 'Searching: heard something'),
        li(h('b', { class: 'tag-hunt' }, '!'), 'Hunting: it has seen you'),
        li(svgEl(INTENT_ICON.attack!, '#ff8a8f'), 'Strikes, with a line to who'),
        li(svgEl('shoot', '#ff8a8f'), 'Shoots'),
        li(svgEl('shove', '#ff8a8f'), 'Shoves, with where you\'d land'),
        li(svgEl('hand', '#ff8a8f'), 'Grabs, webs, drags'),
        li(svgEl('shout', '#ffcf86'), 'Shouts for help'),
        h('span', { class: 'dim small' }, 'No damage numbers over heads: hover for them. Hovering an enemy shades the floor it sees.'),
      ),
      h(
        'div',
        { class: 'dl-leg-col' },
        h('span', { class: 'dl-leg-h' }, 'On a hero\'s card'),
        li(h('i', { class: 'dl-pip on' }), 'Move or action still to use'),
        li(svgEl('lantern', '#ffcf86'), 'Carries the lantern'),
        li(h('span', { class: 'dl-si sneak' }, 'sneak'), 'Set to sneak'),
        li(svgEl('eyeOff', '#ff8a8f'), 'Back exposed'),
        li(svgEl('drop', '#ff8a8f'), 'By a drop'),
        li(svgEl('sword', '#ff8a8f'), 'Something means to strike them'),
        li(svgEl('shield', '#9cc8ff'), 'Braced, warded or veiled'),
        li(svgEl('moon', '#9a8f7d'), 'Standing in the dark'),
      ),
      h(
        'div',
        { class: 'dl-leg-col' },
        h('span', { class: 'dl-leg-h' }, 'Keys'),
        h('span', { class: 'dl-leg-keys' }, h('kbd', null, '1–4'), ' pick a hero · ', h('kbd', null, 'Tab'), ' next hero · ', h('kbd', null, 'Shift'), ' walk or sneak (this hero) · ', h('kbd', null, 'Space'), ' attack, or take the marked target · every other button shows its key · ', h('kbd', null, 'L'), ' lantern · ', h('kbd', null, 'B'), ' parley · ', h('kbd', null, 'T'), ' stairs · ', h('kbd', null, 'Q'), ' leave · ', h('kbd', null, 'E'), ' end turn, or confirm · ', h('kbd', null, 'Esc'), ' cancel · ', h('kbd', null, 'Alt'), ' numbers · ', h('kbd', null, '?'), ' all the keys'),
        h('span', { class: 'dl-leg-keys' }, 'Camera: ', h('kbd', null, 'W'), h('kbd', null, 'A'), h('kbd', null, 'S'), h('kbd', null, 'D'), ' or arrows pan · right-drag orbit · ', h('kbd', null, '['), h('kbd', null, ']'), ' rotate · wheel zoom · ', h('kbd', null, 'F'), ' center on the hero · hold ', h('kbd', null, 'Space'), " to hurry the castle's turn"),
      ),
    ),
  ];
}
