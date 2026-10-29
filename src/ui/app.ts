// The app: holds the GameState, switches screens on state.stage, sends every
// command through engine.apply, autosaves, and plays events in order while
// input is blocked.

import { showToast } from './camp/toast'; // V5.1.2
import type { Engine } from '../game/api';
import { heardLines } from '../view/sounds';
import { posKey, type Pos } from '../game/hex';
import type { ApplyResult, Command, GameEvent, GameState, Heard, ReactionQuestion } from '../game/types';
import { sfx } from '../audio/sfx';
import { Diorama } from '../view/diorama';
import { wasBackstab } from '../view/stealth';
import { clear, h } from './dom';
import { Hud, legend } from './hud';
import { overScreen, titleScreen, type ScreenHost, type TitleHost } from './screens';
import { recordRun } from './camp/runs';
import { returnScreen } from './return';
import { campScreen, freshLoadout, type CampHost, type CampPage, type Loadout } from './lowgate';
import { CREW, STANCE, dealLine } from './names';
import { loadSettings, saveSettings, type Settings } from './settings';
import { DEFAULT_DISTANCE } from '../view/camera'; // V5.0 G: camera default

export const SAVE_KEY = 'vc.save.v39';
/** The version line on the title screen. */
export const GAME_VERSION = 'V5.2';

const ACTION_SFX: Partial<Record<import('../game/types').ActionKind, import('../audio/sfx').Sfx>> = {
  pick: 'pick',
  smash: 'smash',
  torch: 'torch',
  kindle: 'spell',
  mend: 'spell',
  firebolt: 'fire',
  rally: 'horn',
  potion: 'spell',
  take: 'coin',
  bribe: 'coin',
  rope: 'creak',
  climb: 'creak',
  jump: 'slam',
  shove: 'chop',
  disarm: 'pick',
  charge: 'click',
  guard: 'sword',
  winch: 'winch',
  overwatch: 'click',
  knockback: 'arrow',
  throwCharge: 'whoosh',
  dig: 'chop',
  fireball: 'fire',
  veil: 'spell',
  sleep: 'spell',
  blink: 'whoosh',
  ward: 'spell',
  gust: 'whoosh',
  smoke: 'whoosh',
  glue: 'whoosh',
  dart: 'arrow',
  caltrops: 'coin',
  firecracker: 'whoosh',
  key: 'pick',
  oil: 'torch',
  grapple: 'creak',
  shutter: 'click',
  escape: 'chop',
  setCharge: 'click',
  dread: 'gloam',
  brace: 'sword',
  hamstring: 'arrow',
  nightthorn: 'spell',
  briar: 'spell',
  smashProp: 'smash',
};
const LOADOUT_KEY = 'vc.loadout.v33';
/** V4.0: the first-visit welcome card was dismissed (per browser). */
const WELCOME_KEY = 'vc.welcome.v40';
/** Default camera distance at delve start (V3.3 scale C: heroes are 2.0, a bit closer than 15.8's 22). */
const DELVE_DISTANCE = DEFAULT_DISTANCE; // V5.0 G: camera default (camera.ts), was 19

export class App {
  private state: GameState | null = null;
  private busy = false;
  readonly dio: Diorama;
  readonly hud: Hud;
  private screen: HTMLElement;
  private stage3d: HTMLElement;
  private settings: Settings = loadSettings();
  /** V4.0: the Lowgate page shown (one of the four steps, or Keven's cart / the graves). */
  private page: CampPage = 'job';
  /** The loadout of the last delve (remembered across sessions). */
  private loadout: Loadout | null = null;
  /** V4.0: the loadout being put together in Lowgate on this visit. */
  private draft: Loadout | null = null;
  private welcomeSeen = false;
  private hurry = false;
  private lastStage: string | null = null;
  /** V3.5 (18.7): stories won back on the last return to camp, shown until dismissed. */
  private wonBack: import('../game/types').StoryId[] = [];

  /** Dev only: `?reveal=1` shows the whole castle lit, for map review. */
  private readonly reveal = new URLSearchParams(location.search).get('reveal') === '1';

  private visibilityOf(s: GameState) {
    const v = this.engine.visibility(s);
    if (!this.reveal) return v;
    const all = new Set<string>();
    for (const lv of this.engine.castle().levels) for (const k of Object.keys(lv.tiles)) all.add(`${lv.level}:${k}`);
    return { visible: all, explored: all, lit: all };
  }

  constructor(
    private readonly root: HTMLElement,
    private readonly engine: Engine,
  ) {
    clear(root);
    this.stage3d = h('div', { class: 'stage3d' });
    this.screen = h('div', { class: 'screen' });
    root.append(this.stage3d, this.screen);
    this.dio = new Diorama(this.stage3d, {
      hover: (at, id) => this.hud.onHover(at, id),
      click: (at, id, ev) => this.hud.onClick(at, id, ev),
      levelChanged: () => this.hud?.levelChanged(),
    });
    this.dio.setCastle(engine.castle());
    this.dio.onStep = (side) => sfx.play('step', { gain: side === 'hero' ? 0.8 : 0.5, pitch: side === 'hero' ? 1 : 0.8 });
    this.dio.onDoor = (open) => sfx.play(open ? 'creak' : 'slam');
    this.dio.onExplosion = () => sfx.play('explosion');
    this.dio.onImpact = (levels) => sfx.play('thud', { gain: 0.7 + levels * 0.2, pitch: levels > 1 ? 0.8 : 1 });
    this.dio.onBreath = () => sfx.play('roar');
    this.dio.onLift = () => sfx.play('winch');
    this.hud = new Hud(
      {
        engine,
        send: (cmd) => this.send(cmd),
        isBusy: () => this.busy,
        settings: this.settings,
        saveSettings: () => saveSettings(this.settings),
        applySettings: () => this.applySettings(),
        abandonDelve: () => void this.send({ type: 'abandon' }),
        toTitle: () => this.showTitle(),
        entrance: () => this.entrancePos(),
      },
      this.dio,
    );
    this.stage3d.appendChild(this.hud.root);
    this.applySettings();
    try {
      const raw = localStorage.getItem(LOADOUT_KEY);
      if (raw) this.loadout = JSON.parse(raw) as Loadout;
    } catch {
      /* ignore */
    }
    try {
      this.welcomeSeen = localStorage.getItem(WELCOME_KEY) === '1';
    } catch {
      /* ignore */
    }

    // Hold Space to hurry playback.
    addEventListener('keydown', (e) => {
      if (e.code === 'Space' && this.state?.stage === 'delve') {
        e.preventDefault();
        this.hurry = true;
        this.applySettings();
      }
    });
    addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.hurry = false;
        this.applySettings();
      }
    });

    // Title first; Continue resumes the autosave. ?resume=1 skips straight in.
    const saved = this.load();
    if (saved && new URLSearchParams(location.search).get('resume') === '1') {
      this.state = saved;
      this.render(true);
    } else this.showTitle();
  }

  /**
   * V3.6 (19.5): the exit the party came in by. The engine doesn't record it (contract request:
   * `Delve.entrance`), so it comes from the loadout Lowgate saved at Delve; the main gate otherwise.
   */
  private entrancePos(): Pos | null {
    const ents = this.engine.castle().entrances;
    if (!ents.length) return null;
    const i = this.loadout?.entrance ?? 0;
    return ents[i] ?? ents[0] ?? null;
  }

  private applySettings(): void {
    const sp = this.settings.speed;
    this.dio.clock.speed = this.hurry ? Math.max(6, sp * 4) : sp === 0 ? 1000 : sp;
    this.dio.reduceShake = this.settings.reduceShake;
    // V5.0 (P, docs/v5-ship.md step 2): "Lower walls near the camera" is retired: the cutaway is always on in the new
    // look (`LOOK_CUTAWAY`); the setting key `cutaway` stays in settings.ts (append-only) and is ignored.
  }

  // ------------------------------------------------------------ saving

  private load(): GameState | null {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      return this.engine.deserialize(raw);
    } catch (e) {
      console.warn('Could not load the save:', e);
      return null;
    }
  }

  private save(): void {
    if (!this.state) return;
    try {
      localStorage.setItem(SAVE_KEY, this.engine.serialize(this.state));
    } catch (e) {
      console.warn('Could not save:', e);
    }
  }

  // ------------------------------------------------------------ screens

  private host(): ScreenHost {
    return {
      engine: this.engine,
      send: (c) => this.send(c),
      newCampaign: (seed) => this.newCampaign(seed),
      continueGame: () => {
        const s = this.load();
        if (s) {
          this.state = s;
          this.render(true);
        }
      },
      hasSave: !!this.load(),
    };
  }

  /** V4.0: what the Lowgate pages need. */
  private campHost(s: GameState): CampHost {
    this.draft ??= freshLoadout(s, this.engine, this.loadout);
    return {
      engine: this.engine,
      send: (c) => this.send(c),
      state: () => this.state,
      page: this.page,
      setPage: (p) => {
        this.page = p;
        this.render();
      },
      draft: this.draft,
      setDraft: (l, p) => {
        this.draft = l;
        if (p) this.page = p;
        this.render();
      },
      lastLoadout: this.loadout,
      saveLoadout: (l) => this.saveLoadout(l),
      wonBack: this.wonBack,
      dismissWonBack: (p) => {
        this.wonBack = [];
        if (p) this.page = p;
        this.render();
      },
      welcome: !this.welcomeSeen && s.campaign.delveCount === 0,
      dismissWelcome: () => {
        this.welcomeSeen = true;
        try {
          localStorage.setItem(WELCOME_KEY, '1');
        } catch {
          /* ignore */
        }
        this.render();
      },
    };
  }

  private saveLoadout(l: Loadout): void {
    this.loadout = l;
    try {
      localStorage.setItem(LOADOUT_KEY, JSON.stringify(l));
    } catch {
      /* ignore */
    }
  }

  private newCampaign(seed: number): void {
    const res = this.engine.apply(this.engine.newGame(seed), { type: 'newCampaign', seed });
    const s = res.error ? this.engine.newGame(seed) : res.state;
    this.state = s;
    this.page = 'job'; // V4.0: every return lands on step 1
    this.loadout = null;
    this.draft = null;
    this.wonBack = [];
    sfx.play('horn', { pitch: 0.8, gain: 0.5 });
    this.save();
    this.render(true);
  }

  showTitle(): void {
    this.root.dataset.stage = 'title';
    this.lastStage = 'title';
    this.dio.setActive(false);
    this.hud.root.classList.add('hidden');
    this.screen.classList.remove('hidden');
    sfx.setDrone(false);
    titleScreen(this.screen, this.titleHost());
  }

  /** V5.2 (spec 35): what the title screen needs: the save as it stands, the settings, the keys legend. */
  private titleHost(): TitleHost {
    const host = this.host();
    return {
      saved: this.load(),
      newCampaign: host.newCampaign,
      continueGame: host.continueGame,
      settings: this.settings,
      saveSettings: () => {
        saveSettings(this.settings);
        this.applySettings();
        // The look rows (read by the view at start; set here so a change on the title holds for the next delve).
        this.dio.setQuality(this.settings.quality ?? 'high');
        this.dio.setActionCamera(this.settings.actionCamera !== false);
        this.dio.setTiltShift(this.settings.tiltShift !== false);
      },
      version: GAME_VERSION,
      legend,
    };
  }

  private render(snapCamera = false): void {
    const s = this.state;
    if (!s) return this.showTitle();
    const stageChanged = this.lastStage !== s.stage;
    this.lastStage = s.stage;
    this.root.dataset.stage = s.stage;
    if (s.stage === 'delve' && s.delve) {
      this.screen.classList.add('hidden');
      clear(this.screen);
      this.hud.root.classList.remove('hidden');
      this.dio.setActive(true);
      const vis = this.visibilityOf(s);
      this.dio.setEntrance(this.entrancePos());
      this.dio.sync(s, vis, this.engine.brightness(s));
      this.hud.setState(s, vis);
      this.hud.setDark(this.engine.brightness(s));
      // V4.1 (spec 31.13): a question waiting (a reloaded save, or an answer that didn't go through): ask it again.
      if (s.delve.pending && !this.busy) queueMicrotask(() => void this.resumePending());
      sfx.setDrone(s.delve.monsters.some((m) => m.kind === 'gloam'));
      if (snapCamera || stageChanged) {
        const sel = s.delve.heroes.find((x) => x.heroId === this.hud.selectedId) ?? s.delve.heroes.find((x) => x.status === 'active');
        if (sel) {
          this.dio.showLevel(sel.at.level, true);
          this.dio.lookAt(sel.at, true);
          this.dio.rig.distance = DELVE_DISTANCE;
        }
      }
      return;
    }
    sfx.setDrone(false);
    this.dio.setActive(false);
    this.hud.root.classList.add('hidden');
    this.screen.classList.remove('hidden');
    const host = this.host();
    switch (s.stage) {
      case 'camp':
        // V4.0: a return to camp lands on step 1 with a fresh draft (the last party, empty packs).
        if (stageChanged) {
          this.page = 'job';
          this.draft = null;
        }
        return campScreen(this.screen, s, this.campHost(s));
      case 'summary':
        // V5.0 (spec 32.11): the tally runs when the report first comes up; the instant playback setting skips it.
        return returnScreen(this.screen, s, host, { tally: stageChanged && this.settings.speed !== 0 });
      case 'over':
        return overScreen(this.screen, s, host);
    }
  }

  // ------------------------------------------------------------ commands

  async send(cmd: Command): Promise<boolean> {
    if (this.busy || !this.state) return false;
    const before = this.state;
    const res = this.engine.apply(before, cmd);
    if (res.error) {
      sfx.play('error');
      if (before.stage === 'delve') this.hud.toast(res.error);
      else this.screenToast(res.error);
      return false;
    }
    this.state = res.state;
    this.save();
    // V5.2 (spec 35): an ended campaign is remembered for the title screen ("Last run"), past the save it outlives.
    if (res.state.stage === 'over' && before.stage !== 'over') recordRun(res.state);
    if (cmd.type === 'act') {
      const snd = ACTION_SFX[cmd.action];
      if (snd) sfx.play(snd);
    }
    const inDelve = before.stage === 'delve' && !!before.delve;
    if (inDelve && res.events.length) {
      await this.playResult(res, before);
    } else if (cmd.type === 'startDelve') {
      sfx.play('horn', { pitch: 0.7, gain: 0.6 });
    }
    // 18.7: the won-back moment on return to camp.
    const won = res.events.filter((e): e is Extract<GameEvent, { type: 'villageUnlocked' }> => e.type === 'villageUnlocked').map((e) => e.story);
    if (won.length) {
      this.wonBack = won;
      sfx.play('levelup', { gain: 0.8 });
      setTimeout(() => sfx.play('horn', { pitch: 1.2, gain: 0.35 }), 260);
    } else if (cmd.type === 'startDelve') this.wonBack = [];
    // V5.0 (spec 32.15): the selected hero crossed while others still have to: hand the selection to the next able
    // hero on the level shown, before the render looks at anyone.
    if (this.stayOn !== null && this.state?.delve) {
      const lvl = this.stayOn;
      this.stayOn = null;
      const next = this.state.delve.heroes.find((x) => x.status === 'active' && x.at.level === lvl && !(x.moved && x.acted));
      if (next) this.hud.select(next.heroId);
    }
    this.render(cmd.type === 'startDelve');
    // V5.1.2 (spec 34.3): "One for the road": the party raises what Wim poured (the engine already drank it, the
    // Black Cask included). Over the delve view, not awaited; never at the Instant speed; nothing when nobody drank.
    if (cmd.type === 'startDelve' && this.state?.stage === 'delve' && this.settings.speed !== 0) showToast(before, this.state);
    // V5.0 (spec 32.15): the threshold's peek, said once as a hero stops on the stairs (the status mark keeps it).
    if (cmd.type === 'move' && this.state?.stage === 'delve') {
      const pk = this.hud.peekLine(cmd.heroId);
      if (pk) this.hud.log(pk.text, pk.figures ? 'log-enemy' : '');
    }
    // V5.0 (P, spec 32.5, 32.6): the flow. A done hero hands the camera on after a beat; with nothing left for anyone,
    // the turn ends on its own.
    if (this.state?.stage === 'delve' && cmd.type !== 'endTurn' && cmd.type !== 'react') this.hud.scheduleFlow();
    // V4.1 (WS2): the "Go in with the lantern shut" checkbox is gone: lanterns and torches go in unlit.
    return true;
  }

  /** Plays a command's events while input is blocked; the diorama heads for the result (V4.1: for its `view` when it paused). */
  private async playResult(res: ApplyResult, before: GameState): Promise<void> {
    this.busy = true;
    this.hud.setBusy(true);
    this.retarget(res);
    try {
      await this.playEvents(res.events, before, res.played ?? 0);
    } catch (e) {
      console.error('Event playback failed:', e);
    } finally {
      this.dio.clock.flush();
      this.dio.endPlayback();
      this.busy = false;
      this.hud.setBusy(false);
      this.hud.hideRoll();
    }
  }

  private retarget(res: ApplyResult): void {
    const next = res.view ?? res.state;
    const nextVis = next.delve ? this.visibilityOf(next) : { visible: new Set<string>(), explored: new Set<string>(), lit: new Set<string>() };
    this.dio.beginPlayback(next, nextVis);
  }

  /**
   * V4.1 (spec 31.13): a `react` event: the castle's turn waits. The camera goes to the enemy, the reaction card asks,
   * the answer goes to the engine, and the playback carries on with its result (the caller skips `played` events).
   */
  private async answerReaction(q: ReactionQuestion): Promise<ApplyResult | null> {
    if (this.settings.speed !== 0 || this.hurry) await this.dio.panTo(q.at);
    const choice = await this.hud.askReaction(q);
    const s = this.state;
    if (!s?.delve?.pending) return null;
    const res = this.engine.apply(s, { type: 'react', choice });
    if (res.error) {
      this.hud.toast(res.error);
      return null;
    }
    this.state = res.state;
    this.save();
    this.retarget(res);
    return res;
  }

  /** V4.1 (spec 31.13): a save loaded with a question waiting: the castle's turn plays again up to it, and asks. */
  private resuming = false;
  private async resumePending(): Promise<void> {
    const s = this.state;
    if (this.busy || this.resuming || !s?.delve?.pending) return;
    const res = this.engine.resume(s);
    if (!res) return;
    this.resuming = true;
    try {
      await this.playResult(res, s);
    } finally {
      this.resuming = false;
    }
    this.render();
  }

  private screenToast(text: string): void {
    const t = h('div', { class: 'hud-toast screen-toast pop' }, text);
    this.root.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }

  // ------------------------------------------------------------ event player

  /** "the orc" for a monster, a crew member's name otherwise (for the backstab line). */
  private monsterWords(id: string, before: GameState): string {
    const m = before.delve?.monsters.find((x) => x.id === id) ?? this.state?.delve?.monsters.find((x) => x.id === id);
    if (m) return /^[A-Z][a-z]+$/.test(m.name) && m.name.toLowerCase() === m.kind ? `the ${m.kind}` : m.name;
    return this.hud.nameOf(id);
  }

  private isHero(id: string): boolean {
    return !!this.state?.campaign.roster.some((x) => x.id === id);
  }

  private async playEvents(first: GameEvent[], before: GameState, from = 0): Promise<void> {
    /** V4.1 (spec 31.13): the list being played; an answered reaction swaps in its result's (the same events first). */
    let events = first;
    const clock = this.dio.clock;
    const wait = (s: number) => clock.wait(s);
    const instant = () => this.settings.speed === 0 && !this.hurry;
    void before;
    let panned = false;
    /** 18.6: a deal already says what the crew now does; skip the stance line that follows it. */
    let dealt = false;
    /** V3.9 (24.3): the last roll and whether a free swing introduced it (a swing is never a backstab). */
    let lastRoll: { who: string; what: string } | null = null;
    let swingNext = false;
    /** V3.9.3 (24.8): what the heroes heard this world phase, summarised in the log when it ends. */
    let heard: Heard[] = [];
    const logHeard = () => {
      if (!heard.length) return;
      const d = before.delve;
      const ears = (d?.heroes ?? []).filter((h) => h.status === 'active').map((h) => h.at);
      for (const text of heardLines(heard, ears, d?.doors ?? {}, 2)) this.hud.log(text, 'log-heard');
      heard = [];
    };
    // V4.1 (spec 31.13): resuming a paused turn (a reload), the castle's turn was already under way before `from`.
    let world = false;
    for (const x of first.slice(0, from)) if (x.type === 'phase') world = x.phase === 'world';
    for (let ei = from; ei < events.length; ei++) {
      const e = events[ei]!;
      if (!this.root.isConnected) return;
      // 15.5: in the world phase, take the camera to each visible enemy action or attack on a hero.
      if (world) {
        const at = this.enemyFocus(e);
        // V4.0 HUD: each enemy that acts where you can see it counts in the folded hotbar ("1 of 3 moves").
        const actor = at ? enemyActor(e) : null;
        if (actor && !this.isHero(actor)) this.hud.castleActor(actor);
        if (at && !instant()) {
          await this.dio.panTo(at);
          panned = true;
        }
        if (e.type === 'hit' || e.type === 'miss' || e.type === 'downed' || e.type === 'died' || e.type === 'shoved' || e.type === 'fell' || e.type === 'grabbed' || e.type === 'poisoned') this.hud.actResult(e);
      }
      if (e.type === 'phase') {
        if (e.phase === 'world') {
          world = true;
          // The enemies you will see act this castle turn, for the count.
          const ids = new Set<string>();
          for (const x of events.slice(ei + 1)) {
            if (x.type === 'phase') break;
            const id = this.enemyFocus(x) ? enemyActor(x) : null;
            if (id && !this.isHero(id)) ids.add(id);
          }
          this.hud.phase('world', e.round, ids.size);
        } else {
          logHeard();
          world = false;
          this.hud.phase('player', e.round);
          if (panned) this.returnToSelected();
          panned = false;
        }
      }
      if (e.type === 'moved' && world && !this.isHero(e.id) && !instant() && this.enemyFocus(e)) this.dio.setFollow(e.id);
      switch (e.type) {
        case 'react': {
          // V4.1 (spec 31.13): the castle's turn waits for the player's answer, then plays on from where it stopped.
          const next = await this.answerReaction(e.question);
          if (!next) return;
          events = next.events;
          ei = (next.played ?? 0) - 1;
          continue;
        }
        case 'say':
          // A deal's own line (the engine says it before the `deal` event) is replaced by dealLine below.
          if (events[events.indexOf(e) + 1]?.type === 'deal') continue;
          this.hud.log(e.text);
          continue;
        case 'phase': {
          if (e.phase === 'world') {
            sfx.play('slam', { pitch: 0.6, gain: 0.35 });
            if (!instant()) await this.hud.banner('The castle stirs', `Round ${e.round}`, (s) => wait(s * 0.7), true);
          } else if (!instant()) {
            await this.hud.banner(`Round ${e.round}`, 'Your move', (s) => wait(s * 0.6));
          }
          continue;
        }
        case 'roll': {
          lastRoll = { who: e.who, what: swingNext ? 'swing' : e.what };
          swingNext = false;
          const enemy = !this.isHero(e.who);
          if (instant()) {
            this.hud.log(`${this.hud.nameOf(e.who)} · ${e.what}: ${e.roll.hits}/${e.roll.slots}${e.roll.perfect ? ' PERFECT' : ''}`, enemy ? 'log-enemy' : 'log-roll');
            continue;
          }
          const watch = this.dio.isWatchable(e.who) || !enemy;
          if (!watch) continue;
          const p = this.dio.unitPos(e.who);
          if (p && !enemy) this.dio.lookAt(p);
          await this.hud.showRoll(e, wait, enemy);
          this.hud.log(`${this.hud.nameOf(e.who)} · ${e.what}: ${e.roll.hits}/${e.roll.slots}${e.roll.perfect ? ' PERFECT' : ''}`, enemy ? 'log-enemy' : 'log-roll');
          continue;
        }
        case 'hit': {
          const heroHurt = this.isHero(e.target);
          const byGloam = this.state?.delve?.monsters.some((m) => m.id === e.attacker && m.kind === 'gloam') || before.delve?.monsters.some((m) => m.id === e.attacker && m.kind === 'gloam');
          if (byGloam) {
            // 16.2: the Gloam's strike: a deep thrum, a hard shake and a dark pulse.
            sfx.play('gloam');
            this.hud.pulse('dark');
            this.hud.log(`The dark strikes ${this.hud.nameOf(e.target)} for ${e.damage}.`, 'log-enemy');
            if (!this.settings.reduceShake) this.dio.rig.addShake(0.45);
          } else sfx.play(heroHurt ? 'hurt' : 'sword');
          if (heroHurt) this.hud.pulse('hurt');
          // V3.9 (24.3): the Burglar's backstab: its own strike and log line, then the hit.
          const stab = !!e.backstab || !heroHurt && this.isHero(e.attacker) && lastRoll?.who === e.attacker && lastRoll.what !== 'swing' && (/backstab/i.test(lastRoll.what) || wasBackstab(before, e.attacker, e.target));
          if (stab) {
            sfx.play('sword', { pitch: 1.5, gain: 0.8 });
            if (!events.some((x) => x.type === 'say' && /backstabs/.test(x.text))) this.hud.log(`${this.hud.nameOf(e.attacker)} backstabs ${this.monsterWords(e.target, before)}: ${e.damage}`, 'log-ally');
            if (!instant()) await this.dio.playBackstab(e.attacker, e.target);
          }
          lastRoll = null;
          await this.dio.playEvent(e);
          this.hud.hideRoll();
          continue;
        }
        case 'miss':
          sfx.play('miss');
          await this.dio.playEvent(e);
          this.hud.hideRoll();
          continue;
        case 'downed':
          sfx.play('death', { pitch: 1.2, gain: 0.6 });
          this.hud.log(`${this.hud.nameOf(e.id)} is down!`, 'log-enemy');
          await this.dio.playEvent(e);
          continue;
        case 'died':
          sfx.play('death');
          this.hud.log(`${this.hud.nameOf(e.id)} is dead.`, 'log-enemy');
          await this.dio.playEvent(e);
          continue;
        case 'monsterDied':
          sfx.play('death', { pitch: 0.8, gain: 0.7 });
          await this.dio.playEvent(e);
          continue;
        case 'revived':
          sfx.play('spell');
          await this.dio.playEvent(e);
          continue;
        case 'chestOpened':
          sfx.play('chest');
          sfx.play('coin');
          await this.dio.playEvent(e);
          continue;
        case 'looted':
          sfx.play('coin', { pitch: 1.1 });
          await this.dio.playEvent(e);
          continue;
        case 'brazierLit':
          sfx.play('fire');
          await this.dio.playEvent(e);
          continue;
        case 'light': {
          const prev = this.state?.delve ? this.engine.brightness(before) : 'bright';
          this.hud.updateLight(e.light, e.brightness);
          this.hud.setDark(e.brightness);
          if (e.brightness !== prev) {
            this.hud.log(`The lantern gutters: ${e.brightness === 'pitch' ? 'pitch black' : e.brightness}.`, 'log-enemy');
            this.hud.pulse('dark');
          }
          await this.dio.playEvent(e);
          continue;
        }
        case 'gloam':
          sfx.play('gloam', { pitch: 0.8, gain: 0.8 });
          sfx.setDrone(true);
          this.hud.log('The dark here is awake.', 'log-enemy');
          this.hud.pulse('dark');
          await this.dio.playEvent(e);
          if (!instant()) await wait(0.4);
          continue;
        case 'shout':
          sfx.play('horn', { pitch: 1.35, gain: 0.55 });
          this.hud.log(`${this.hud.nameOf(e.id)} shouts: every orc within 8 wakes and hunts!`, 'log-enemy');
          await this.dio.playEvent(e);
          continue;
        case 'dragged':
          sfx.play('web', { pitch: 0.8 });
          this.hud.log(`${this.hud.nameOf(e.id)} is dragged toward the spider.`, 'log-enemy');
          if (this.isHero(e.id)) this.hud.pulse('hurt');
          await this.dio.playEvent(e);
          continue;
        case 'grabbed':
          sfx.play('chop', { pitch: 0.6, gain: 0.8 });
          this.hud.log(`${this.hud.nameOf(e.by)} grabs ${this.hud.nameOf(e.id)}! Escape (2 Might slots) or kill it.`, 'log-enemy');
          if (this.isHero(e.id)) this.hud.pulse('hurt');
          await this.dio.playEvent(e);
          continue;
        case 'released':
          sfx.play('click', { pitch: 1.3 });
          this.hud.log(`${this.hud.nameOf(e.id)} is free.`);
          await this.dio.playEvent(e);
          continue;
        case 'shutter':
          sfx.play('click', { pitch: e.open ? 1.2 : 0.7, gain: 0.8 });
          this.hud.log(e.open ? 'The lantern is open: it lights, and burns.' : 'The lantern is shuttered: no light, no burn.');
          this.hud.updateLight();
          await this.dio.playEvent(e);
          if (this.state?.delve) this.hud.updateLight();
          continue;
        case 'routeKnown':
          sfx.play('flip', { pitch: 1.1 });
          this.hud.log(`${this.hud.nameOf(e.id)}'s patrol route is known. It is drawn on the map.`);
          await this.dio.playEvent(e);
          continue;
        case 'spawned': {
          const isGhoul = this.state?.delve?.monsters.some((m) => m.id === e.id && m.kind === 'ghoul');
          if (isGhoul && this.dio.canSee(e.at)) {
            sfx.play('thud', { pitch: 0.7, gain: 0.6 });
            this.hud.log(`${this.hud.nameOf(e.id)} claws out of the ground!`, 'log-enemy');
          }
          await this.dio.playEvent(e);
          continue;
        }
        case 'blast': {
          await this.dio.playEvent(e);
          continue;
        }
        // ---- V3.7
        // The engine's own `say` lines cover fuses, blasts, swings, wakes and Dread; the HUD adds lines only where it doesn't speak.
        case 'fuseSet':
          sfx.play('torch', { pitch: 1.4, gain: 0.6 });
          await this.dio.playEvent(e);
          continue;
        // V5.0 (spec 32.10): a shield block: a clang; the engine's say line tells it; the diorama flashes the shield gold (G, W1).
        case 'blocked':
          sfx.play('thud', { pitch: 1.6, gain: 0.5 });
          await this.dio.playEvent(e);
          continue;
        case 'swing':
          swingNext = true;
          sfx.play('whoosh', { pitch: 1.3, gain: 0.5 });
          await this.dio.playEvent(e);
          continue;
        // ---- V3.9 (24.2): facing and unseen hits
        case 'faced':
          await this.dio.playEvent(e);
          continue;
        case 'heard':
          heard.push(e.sound);
          continue;
        case 'unseenHit':
          sfx.play('whoosh', { pitch: 0.7, gain: 0.7 });
          // The engine says it too (a `say` line); log it only when it doesn't.
          if (!events.some((x) => x.type === 'say' && /from behind/.test(x.text))) this.hud.log(`Something strikes ${this.hud.nameOf(e.target)} from behind.`, 'log-enemy');
          this.hud.pulse('hurt');
          if (!instant()) await this.dio.playEvent(e);
          continue;
        case 'feared':
          sfx.play('gloam', { pitch: 1.6, gain: 0.5 });
          await this.dio.playEvent(e);
          continue;
        // ---- V3.7 (20.5)
        case 'calm':
          if (e.calm) sfx.play('flip', { pitch: 1.1, gain: 0.5 });
          else {
            sfx.play('horn', { pitch: 1.2, gain: 0.5 });
            this.hud.pulse('hurt');
          }
          this.hud.log(e.calm ? `Calm again: free move.${e.why ? ` ${e.why}` : ''}` : `Combat! ${e.why ?? 'Something has noticed the party.'}`, e.calm ? 'log-ally' : 'log-enemy');
          if (!instant() || !e.calm) await this.hud.calmBanner(e.calm, e.why, (x) => wait(instant() ? 0 : x));
          continue;
        case 'propSmashed':
          sfx.play('smash', { pitch: 1.3, gain: 0.7 });
          if (e.items.length) setTimeout(() => sfx.play('coin', { pitch: 1.1, gain: 0.6 }), 350);
          await this.dio.playEvent(e);
          continue;
        case 'rooted':
          sfx.play('web', { pitch: 1.2, gain: 0.6 });
          if (this.isHero(e.id)) this.hud.pulse('hurt');
          await this.dio.playEvent(e);
          continue;
        case 'braced':
          sfx.play('click', { pitch: 0.9 });
          await this.dio.playEvent(e);
          continue;
        case 'noticed':
          if (this.dio.isWatchable(e.by)) sfx.play('click', { pitch: 0.55, gain: 0.8 });
          // V4.0 (spec 28): `hero` may be a crew member a monster spotted (sent only when visible): no alarm colour for that.
          this.hud.log(`${this.hud.nameOf(e.by)} notices ${this.hud.nameOf(e.hero)}!`, this.isHero(e.hero) ? 'log-enemy' : '');
          await this.dio.playEvent(e);
          continue;
        case 'woke':
          if (this.dio.isWatchable(e.id)) sfx.play('click', { pitch: 0.7 });
          await this.dio.playEvent(e);
          continue;
        case 'robbed':
          sfx.play('coin', { pitch: 0.6 });
          this.hud.log(`${this.hud.nameOf(e.by)} robs ${this.hud.nameOf(e.hero)}: ${e.items.length ? e.items.map((i) => (i.kind === 'gold' ? `${i.amount} gold` : i.name)).join(', ') : 'nothing worth taking'}.`, 'log-enemy');
          this.hud.pulse('hurt');
          await this.dio.playEvent(e);
          continue;
        case 'captured': {
          sfx.play('death', { pitch: 0.9 });
          sfx.play('horn', { pitch: 0.6, gain: 0.5 });
          this.hud.log(`${this.hud.nameOf(e.hero)} is taken: ${this.hud.nameOf(e.by)} drags them out of the castle.`, 'log-enemy');
          this.hud.pulse('dark');
          await this.dio.playEvent(e);
          if (!instant()) await this.hud.capturedBanner(e.hero, e.by, (x) => wait(x * 0.8));
          continue;
        }
        case 'trap':
          sfx.play('smash', { pitch: 1.6, gain: 0.6 });
          await this.dio.playEvent(e);
          continue;
        case 'stolen':
          sfx.play('coin', { pitch: 0.7 });
          this.hud.log(`${this.hud.nameOf(e.by)} stole ${e.item.name} from ${this.hud.nameOf(e.from)}.`, 'log-enemy');
          await this.dio.playEvent(e);
          continue;
        case 'rivalsEnter': {
          sfx.play('horn', { pitch: 1.1, gain: 0.4 });
          const crew = this.state?.delve?.rivals;
          this.hud.log(crew && crew.temperament === 'cutthroat' ? `Somebody holds the way ahead. ${crew.name} are waiting.` : 'Lantern light at the edge of the keep. Someone else is here.', 'log-enemy');
          continue;
        }
        case 'rivalsStance': {
          const crew = this.state?.delve?.rivals;
          const name = crew?.name ?? 'The rival crew';
          const st = STANCE[e.stance];
          if (e.stance === 'demanding') {
            sfx.play('horn', { pitch: 0.9, gain: 0.5 });
            this.hud.log(`${name}: "Your gold or your blood." Pay ${crew?.toll ?? 50} or they attack next turn.`, 'log-enemy');
            this.hud.pulse('hurt');
          } else if (e.stance === 'hostile') {
            sfx.play('sword', { pitch: 0.8 });
            if (!dealt) this.hud.log(`${name} draw steel. They are hostile.`, 'log-enemy');
          } else if (e.stance === 'waiting' && crew?.letBy) {
            // V5.0 (spec 32.16): empty pockets let by; the engine's say line carries the words.
            sfx.play('horn', { pitch: 0.8, gain: 0.3 });
          } else if (!dealt) this.hud.log(`${name}: ${st.name.toLowerCase()}. ${st.text}`, e.stance === 'hired' ? 'log-ally' : '');
          continue;
        }
        case 'deal': {
          dealt = true;
          const crew = this.state?.delve?.rivals ?? before.delve?.rivals;
          sfx.play(e.deal === 'fight' ? 'sword' : 'coin', { pitch: e.deal === 'fight' ? 0.8 : 0.9 });
          if (e.deal !== 'fight' && e.price > 0) setTimeout(() => sfx.play('coin', { pitch: 1.2, gain: 0.6 }), 90);
          this.hud.log(dealLine(crew?.name ?? CREW['lantern-sisters'].name, e.deal, e.job, e.paid), e.deal === 'fight' ? 'log-enemy' : e.deal === 'hire' ? 'log-ally' : 'log-deal');
          continue;
        }
        case 'betrayed': {
          const crew = this.state?.delve?.rivals ?? before.delve?.rivals;
          sfx.play('sword', { pitch: 0.6 });
          sfx.play('horn', { pitch: 0.7, gain: 0.4 });
          this.hud.log(`Betrayed! ${crew?.name ?? 'The sell-swords'} turn on you: they want what you carry.`, 'log-enemy');
          this.hud.pulse('hurt');
          if (!instant()) await this.hud.banner('Betrayed', `${crew?.name ?? 'The sell-swords'} turn on you`, (x) => wait(x * 0.8), true);
          continue;
        }
        case 'villageUnlocked':
          continue;
        case 'freed':
          sfx.play('slam', { pitch: 1.6, gain: 0.4 });
          await this.dio.playEvent(e);
          continue;
        case 'doorChanged':
          await this.dio.playEvent(e);
          continue;
        case 'awake':
          if (this.dio.isWatchable(e.id)) sfx.play('click', { pitch: 0.6 });
          await this.dio.playEvent(e);
          continue;
        case 'moved': {
          if (this.isHero(e.id)) {
            const last = e.path[e.path.length - 1];
            if (e.id === this.hud.selectedId) {
              if (last && last.level !== this.dio.shownLevel) this.dio.showLevel(last.level);
              this.dio.setFollow(e.id);
            }
          }
          if (instant()) {
            await this.dio.playEvent(e);
          } else await this.dio.playEvent(e);
          this.dio.setFollow(null);
          continue;
        }
        case 'noise':
          if (e.radius >= 4) sfx.play('slam', { pitch: 0.5, gain: 0.4 });
          if (!instant()) await this.dio.playEvent(e);
          continue;
        case 'delveOver':
          if (!instant()) await wait(0.5);
          continue;
        case 'shoved':
          sfx.play('smash', { pitch: 0.7, gain: 0.5 });
          await this.dio.playEvent(e);
          continue;
        case 'fell': {
          const hero = this.isHero(e.id);
          sfx.play('whoosh');
          const lvl = this.engine.castle().levels.find((l) => l.level === e.to.level)?.name ?? `Level ${e.to.level}`;
          this.hud.log(`${this.hud.nameOf(e.id)} falls ${e.levels === 1 ? '1 level' : `${e.levels} levels`} into ${lvl}: ${e.damage} damage.`, hero ? 'log-enemy' : '');
          if (hero) this.hud.pulse('hurt');
          await this.dio.playEvent(e);
          continue;
        }
        case 'breath':
          this.hud.log(`${this.hud.nameOf(e.by)} breathes fire!`, 'log-enemy');
          await this.dio.playEvent(e);
          continue;
        case 'liftWorking':
          this.hud.log('The winch groans. The lift runs.');
          await this.dio.playEvent(e);
          continue;
        case 'thrown':
          await this.dio.playEvent(e);
          if (e.kind === 'firecracker') sfx.play('explosion', { pitch: 2.2, gain: 0.5 });
          else if (e.kind === 'smoke' || e.kind === 'glue') sfx.play('whoosh', { pitch: 0.7, gain: 0.5 });
          else if (e.kind === 'caltrops') sfx.play('coin', { pitch: 0.6, gain: 0.5 });
          continue;
        case 'cast': {
          const shot = e.spell === 'overwatch' || e.spell === 'knockback';
          sfx.play(e.spell === 'fireball' ? 'fire' : shot ? 'arrow' : 'spell', { pitch: e.spell === 'fireball' ? 0.7 : 1 });
          if (e.spell === 'overwatch') this.hud.log(`${this.hud.nameOf(e.by)} fires from overwatch!`, this.isHero(e.by) ? 'log-roll' : 'log-enemy');
          await this.dio.playEvent(e);
          if (e.spell === 'fireball') sfx.play('explosion', { pitch: 1.3, gain: 0.6 });
          continue;
        }
        case 'blinked':
          sfx.play('whoosh', { pitch: 1.6, gain: 0.5 });
          await this.dio.playEvent(e);
          continue;
        case 'dug':
          sfx.play('chop', { pitch: 0.7 });
          await this.dio.playEvent(e);
          continue;
        case 'caltrops':
          sfx.play('hurt', { pitch: 1.4, gain: 0.5 });
          this.hud.log(`${this.hud.nameOf(e.id)} steps on caltrops.`);
          await this.dio.playEvent(e);
          continue;
        case 'out':
          this.hud.log(`${this.hud.nameOf(e.id)} is out.`);
          await this.dio.playEvent(e);
          continue;
        case 'levelChanged': {
          // V5.0 (spec 32.15): the selected hero took the stairs while another able hero who hasn't finished their
          // turn is still on the level they left: after the command the selection goes to that hero (`stayOn`), so
          // the view comes back to the level with work left on it. (The diorama follows the crossing itself; not
          // following while `stayOn` is set is on G's list.)
          const d = this.state?.delve;
          const stay = !!d && e.id === this.hud.selectedId && e.to !== e.from
            && d.heroes.some((x) => x.heroId !== e.id && x.status === 'active' && x.at.level === e.from && !(x.moved && x.acted));
          if (stay) this.stayOn = e.from;
          await this.dio.playEvent(e);
          continue;
        }
        default:
          await this.dio.playEvent(e);
      }
    }
    logHeard();
    if (panned) this.returnToSelected();
  }

  /** Where the camera should go for a world-phase event, or null when nobody can see it. */
  private enemyFocus(e: GameEvent): import('../game/hex').Pos | null {
    const d = this.dio;
    const enemy = (id: string) => !this.isHero(id);
    switch (e.type) {
      case 'moved': {
        if (!enemy(e.id)) return null;
        const from = d.unitPos(e.id);
        const seen = [from, ...e.path].find((p) => d.canSee(p));
        return seen ?? null;
      }
      case 'roll':
        return enemy(e.who) && d.canSee(d.unitPos(e.who)) ? d.unitPos(e.who) : null;
      case 'blocked': // V5.0 (spec 32.10): the block precedes its hit; the camera goes where the hit's will
        return this.isHero(e.id) ? d.unitPos(e.id) : d.canSee(d.unitPos(e.id)) ? d.unitPos(e.id) : null;
      case 'hit':
      case 'miss': {
        if (!enemy(e.attacker)) return null;
        const t = d.unitPos(e.target);
        if (this.isHero(e.target)) return t;
        const a = d.unitPos(e.attacker);
        return d.canSee(a) ? a : d.canSee(t) ? t : null;
      }
      case 'stolen':
        return d.unitPos(e.from);
      case 'shoved':
      case 'fell':
        return this.isHero(e.id) || d.canSee(e.from) ? e.from : null;
      case 'breath':
        return e.hexes.find((p) => d.canSee(p)) ?? (d.canSee(d.unitPos(e.by)) ? d.unitPos(e.by) : null);
      case 'awake':
        return d.canSee(d.unitPos(e.id)) ? d.unitPos(e.id) : null;
      case 'spawned':
        return d.canSee(e.at) ? e.at : null;
      case 'caltrops':
        return d.canSee(e.at) ? e.at : null;
      case 'shout':
        return d.canSee(d.unitPos(e.id)) ? d.unitPos(e.id) : null;
      case 'dragged':
        return this.isHero(e.id) || d.canSee(e.from) ? e.from : null;
      case 'grabbed':
      case 'released':
        return d.unitPos(e.id);
      case 'gloam':
        return d.canSee(e.at) ? e.at : null;
      case 'swing':
        return this.isHero(e.target) ? d.unitPos(e.target) : d.canSee(d.unitPos(e.by)) ? d.unitPos(e.by) : null;
      case 'blast':
        return d.canSee(e.at) ? e.at : null;
      case 'fuseSet':
        return d.canSee(e.at) ? e.at : null;
      case 'noticed':
        return d.canSee(d.unitPos(e.by)) ? d.unitPos(e.by) : null;
      case 'robbed':
      case 'captured':
        return d.unitPos(e.hero);
      case 'unseenHit':
        return d.unitPos(e.target);
      case 'rooted':
        return this.isHero(e.id) || d.canSee(d.unitPos(e.id)) ? d.unitPos(e.id) : null;
      case 'propSmashed':
        return d.canSee(e.at) ? e.at : null;
      case 'cast':
        // Overwatch shots fire in the world phase: show them.
        return d.canSee(e.at) ? (e.at ?? null) : d.canSee(d.unitPos(e.by)) ? d.unitPos(e.by) : null;
      case 'chestOpened':
        return null;
      default:
        return null;
    }
  }

  /** End of the world phase: back to the selected hero. */
  /** V5.0 (spec 32.15): the level the view is to stay on after the selected hero took the stairs (null: follow). */
  private stayOn: number | null = null;

  private returnToSelected(): void {
    const s = this.state;
    const id = this.hud.selectedId;
    const h = s?.delve?.heroes.find((x) => x.heroId === id && x.status === 'active') ?? s?.delve?.heroes.find((x) => x.status === 'active');
    if (h) this.dio.lookAt(h.at);
  }

  /** Debug and scripting hooks for screenshots. */
  get debug() {
    return {
      state: () => this.state,
      send: (c: Command) => this.send(c),
      dio: this.dio,
      hud: this.hud,
      busy: () => this.busy,
      /** The live settings object (checks flip a setting without reloading). */
      settings: this.settings,
      /** Play a list of events through the HUD as if the engine sent them (DOM checks only). */
      play: (events: GameEvent[], before: GameState) => this.playEvents(events, before),
      posKey,
      /** Replace the state (debug/screenshots only). */
      load: (st: GameState) => {
        this.state = st;
        this.render(false);
      },
    };
  }
}

/** V4.0 HUD: who acts in this event (an enemy's move, roll, swing, shove...), for the castle's-turn count. */
function enemyActor(e: GameEvent): string | null {
  switch (e.type) {
    case 'moved':
      return e.id;
    case 'roll':
      return e.who;
    case 'hit':
    case 'miss':
      return e.attacker;
    case 'breath':
    case 'swing':
    case 'cast':
    case 'thrown':
    case 'fuseSet':
      return e.by;
    case 'shout':
      return e.id;
    case 'grabbed':
    case 'stolen':
    case 'robbed':
      return e.by;
    default:
      return null;
  }
}
