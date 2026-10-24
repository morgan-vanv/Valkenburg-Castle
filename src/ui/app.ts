// The app: holds the GameState, switches screens on state.stage, sends every
// command through engine.apply, autosaves, and plays events in order while
// input is blocked.

import type { Engine } from '../game/api';
import { posKey } from '../game/hex';
import type { Command, GameEvent, GameState } from '../game/types';
import { sfx } from '../audio/sfx';
import { Diorama } from '../view/diorama';
import { clear, h } from './dom';
import { Hud } from './hud';
import { campScreen, overScreen, summaryScreen, titleScreen, type Loadout, type ScreenHost, type Station } from './screens';
import { loadSettings, saveSettings, type Settings } from './settings';

export const SAVE_KEY = 'vc.save.v31';

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
};
const LOADOUT_KEY = 'vc.loadout.v31';

export class App {
  private state: GameState | null = null;
  private busy = false;
  readonly dio: Diorama;
  readonly hud: Hud;
  private screen: HTMLElement;
  private stage3d: HTMLElement;
  private settings: Settings = loadSettings();
  private station: Station = 'board';
  private loadout: Loadout | null = null;
  private hurry = false;
  private lastStage: string | null = null;

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

  private applySettings(): void {
    const sp = this.settings.speed;
    this.dio.clock.speed = this.hurry ? Math.max(6, sp * 4) : sp === 0 ? 1000 : sp;
    this.dio.reduceShake = this.settings.reduceShake;
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
      lastLoadout: this.loadout,
      saveLoadout: (l) => {
        this.loadout = l;
        try {
          localStorage.setItem(LOADOUT_KEY, JSON.stringify(l));
        } catch {
          /* ignore */
        }
      },
      station: this.station,
      setStation: (st) => {
        this.station = st;
        this.render();
      },
    };
  }

  private newCampaign(seed: number): void {
    const res = this.engine.apply(this.engine.newGame(seed), { type: 'newCampaign', seed });
    const s = res.error ? this.engine.newGame(seed) : res.state;
    this.state = s;
    this.station = 'board';
    this.loadout = null;
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
    titleScreen(this.screen, this.host());
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
      this.dio.sync(s, vis, this.engine.brightness(s));
      this.hud.setState(s, vis);
      this.hud.setDark(this.engine.brightness(s));
      sfx.setDrone(s.delve.monsters.some((m) => m.kind === 'gloam'));
      if (snapCamera || stageChanged) {
        const sel = s.delve.heroes.find((x) => x.heroId === this.hud.selectedId) ?? s.delve.heroes.find((x) => x.status === 'active');
        if (sel) {
          this.dio.showLevel(sel.at.level, true);
          this.dio.lookAt(sel.at, true);
          this.dio.rig.distance = 19;
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
        if (stageChanged) this.station = 'board';
        host.station = this.station;
        return campScreen(this.screen, s, host);
      case 'summary':
        return summaryScreen(this.screen, s, host);
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
    if (cmd.type === 'act') {
      const snd = ACTION_SFX[cmd.action];
      if (snd) sfx.play(snd);
    }
    const inDelve = before.stage === 'delve' && !!before.delve;
    if (inDelve && res.events.length) {
      this.busy = true;
      this.hud.setBusy(true);
      const nextVis = res.state.delve ? this.visibilityOf(res.state) : { visible: new Set<string>(), explored: new Set<string>(), lit: new Set<string>() };
      this.dio.beginPlayback(res.state, nextVis);
      try {
        await this.playEvents(res.events, before);
      } catch (e) {
        console.error('Event playback failed:', e);
      } finally {
        this.dio.clock.flush();
        this.dio.endPlayback();
        this.busy = false;
        this.hud.setBusy(false);
        this.hud.hideRoll();
      }
    } else if (cmd.type === 'startDelve') {
      sfx.play('horn', { pitch: 0.7, gain: 0.6 });
    }
    this.render(cmd.type === 'startDelve');
    if (this.state?.stage === 'delve' && (cmd.type === 'move' || cmd.type === 'act')) this.hud.autoAdvance();
    return true;
  }

  private screenToast(text: string): void {
    const t = h('div', { class: 'hud-toast screen-toast pop' }, text);
    this.root.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }

  // ------------------------------------------------------------ event player

  private isHero(id: string): boolean {
    return !!this.state?.campaign.roster.some((x) => x.id === id);
  }

  private async playEvents(events: GameEvent[], before: GameState): Promise<void> {
    const clock = this.dio.clock;
    const wait = (s: number) => clock.wait(s);
    const instant = () => this.settings.speed === 0 && !this.hurry;
    void before;
    for (const e of events) {
      if (!this.root.isConnected) return;
      switch (e.type) {
        case 'say':
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
          sfx.play(heroHurt ? 'hurt' : 'sword');
          if (heroHurt) this.hud.pulse('hurt');
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
          sfx.play('horn', { pitch: 0.4, gain: 0.5 });
          sfx.setDrone(true);
          this.hud.log('Something moves in the dark.', 'log-enemy');
          this.hud.pulse('dark');
          if (!instant()) await wait(0.6);
          continue;
        case 'blast':
          await this.dio.playEvent(e);
          continue;
        case 'trap':
          sfx.play('smash', { pitch: 1.6, gain: 0.6 });
          await this.dio.playEvent(e);
          continue;
        case 'stolen':
          sfx.play('coin', { pitch: 0.7 });
          this.hud.log(`${this.hud.nameOf(e.by)} stole ${e.item.name} from ${this.hud.nameOf(e.from)}.`, 'log-enemy');
          await this.dio.playEvent(e);
          continue;
        case 'rivalsEnter':
          sfx.play('horn', { pitch: 1.1, gain: 0.4 });
          this.hud.log('Lantern light at the edge of the keep. Someone else is here.', 'log-enemy');
          continue;
        case 'rivalsStance':
          this.hud.log(`The Lantern Sisters are now ${e.stance}.`, e.stance === 'hostile' ? 'log-enemy' : '');
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
        case 'out':
          this.hud.log(`${this.hud.nameOf(e.id)} is out.`);
          await this.dio.playEvent(e);
          continue;
        default:
          await this.dio.playEvent(e);
      }
    }
  }

  /** Debug and scripting hooks for screenshots. */
  get debug() {
    return {
      state: () => this.state,
      send: (c: Command) => this.send(c),
      dio: this.dio,
      hud: this.hud,
      busy: () => this.busy,
      posKey,
      /** Replace the state (debug/screenshots only). */
      load: (st: GameState) => {
        this.state = st;
        this.render(false);
      },
    };
  }
}
