// The app: holds the GameState, switches screens on state.stage, sends every
// command through engine.apply, autosaves, and plays events in order while
// input is blocked.

import type { Engine } from '../engine/api';
import type { Command, GameEvent, GameState, Unit } from '../engine/types';
import { sfx } from '../audio/sfx';
import { Diorama } from '../render/scene';
import { clear, h } from './dom';
import { Hud } from './hud';
import { resultsScreen, shopScreen, titleScreen, type ScreenHost } from './screens';
import { loadSettings, saveSettings, type Settings } from './settings';

const SAVE_KEY = 'vc.save.v1';

export class App {
  private state: GameState | null = null;
  private busy = false;
  private dio: Diorama;
  private hud: Hud;
  private screen: HTMLElement;
  private stage3d: HTMLElement;
  private settings: Settings = loadSettings();
  /** Units as they were before the current batch, for names of the dead. */
  private prevUnits = new Map<string, Unit>();
  private lastStage: string | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly engine: Engine,
  ) {
    clear(root);
    this.stage3d = h('div', { class: 'stage3d' });
    this.screen = h('div', { class: 'screen' });
    root.append(this.stage3d, this.screen);
    this.dio = new Diorama(this.stage3d, engine.map(), {
      hover: (c, id) => this.hud.onHover(c, id),
      click: (c, id, ev) => this.hud.onClick(c, id, ev),
      levelChanged: () => this.hud?.levelChanged(),
    });
    this.dio.clock.speed = this.settings.speed;
    this.dio.feel = { reduceShake: this.settings.reduceShake, reduceFlashes: this.settings.reduceFlashes };
    this.dio.onStep = (u) => sfx.play('step', { gain: u.side === 'player' ? 0.8 : 0.5, pitch: u.side === 'player' ? 1 : 0.8 });
    this.dio.onDoor = (open) => sfx.play(open ? 'creak' : 'slam');
    this.dio.onExplosion = () => sfx.play('explosion');
    this.hud = new Hud(
      {
        engine,
        send: (cmd) => this.send(cmd),
        isBusy: () => this.busy,
        settings: this.settings,
        saveSettings: () => saveSettings(this.settings),
        abandon: () => this.abandon(),
      },
      this.dio,
    );
    this.stage3d.appendChild(this.hud.root);

    // Hold Space to hurry playback.
    addEventListener('keydown', (e) => {
      if (e.code === 'Space' && this.busy) {
        e.preventDefault();
        this.dio.clock.speed = Math.max(4, this.settings.speed * 4);
      }
    });
    addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.dio.clock.speed = this.settings.speed;
      }
    });

    const saved = this.load();
    if (saved) this.setState(saved, true);
    else this.showTitle();
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

  private abandon(): void {
    if (!confirm('Abandon this campaign? The save will be deleted.')) return;
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      /* ignore */
    }
    this.state = null;
    this.showTitle();
  }

  // ------------------------------------------------------------ screens

  private host(): ScreenHost {
    return { engine: this.engine, send: (c) => this.send(c), newCampaign: (seed) => this.newCampaign(seed), hasSave: !!this.state };
  }

  private newCampaign(seed?: number): void {
    const s = this.engine.newRun(seed);
    sfx.play('coin');
    this.setState(s, true);
  }

  private showTitle(): void {
    this.root.dataset.stage = 'title';
    this.dio.setActive(false);
    this.hud.root.classList.add('hidden');
    this.screen.classList.remove('hidden');
    titleScreen(this.screen, this.host());
  }

  /** Adopt a state and render it (no animation). */
  private setState(s: GameState, snapCamera: boolean): void {
    this.state = s;
    this.render(snapCamera);
  }

  private render(snapCamera = false): void {
    const s = this.state;
    if (!s) return this.showTitle();
    const stageChanged = this.lastStage !== s.stage;
    this.lastStage = s.stage;
    this.root.dataset.stage = s.stage;
    if (s.stage === 'expedition' && s.expedition) {
      this.screen.classList.add('hidden');
      clear(this.screen);
      this.hud.root.classList.remove('hidden');
      this.dio.setActive(true);
      const vis = this.engine.visibility(s);
      this.dio.sync(s, vis);
      this.hud.setState(s, vis);
      if (snapCamera || stageChanged) {
        const sel = s.expedition.units.find((u) => u.id === this.hud.selectedId) ?? s.expedition.units.find((u) => u.side === 'player' && !u.exited);
        if (sel) {
          this.dio.showLevel(sel.pos.level, true);
          this.dio.lookAt(sel.pos, true);
        }
      }
      return;
    }
    this.dio.setActive(false);
    this.hud.root.classList.add('hidden');
    this.screen.classList.remove('hidden');
    const host = this.host();
    switch (s.stage) {
      case 'shop':
        return shopScreen(this.screen, s, host);
      case 'results':
        return resultsScreen(this.screen, s, host);
    }
  }

  // ------------------------------------------------------------ commands

  async send(cmd: Command): Promise<boolean> {
    if (this.busy || !this.state) return false;
    const before = this.state;
    const res = this.engine.apply(before, cmd);
    if (res.error) {
      sfx.play('error');
      if (before.stage === 'expedition') this.hud.toast(res.error);
      else this.screenToast(res.error);
      return false;
    }
    this.state = res.state;
    this.save();
    const inExpedition = before.stage === 'expedition' && !!before.expedition;
    if (inExpedition && res.events.length) {
      this.busy = true;
      this.hud.setBusy(true);
      this.prevUnits = new Map((before.expedition?.units ?? []).map((u) => [u.id, u]));
      this.dio.beginPlayback(res.state, res.state.expedition ? this.engine.visibility(res.state) : undefined);
      try {
        await this.playEvents(res.events, before);
      } catch (e) {
        console.error('Event playback failed:', e);
      } finally {
        this.dio.clock.flush();
        this.busy = false;
        this.hud.setBusy(false);
        this.hud.hideDice();
      }
    } else if (cmd.type === 'launch') {
      sfx.play('horn', { pitch: 0.8, gain: 0.6 });
    } else if (cmd.type === 'buy' || cmd.type === 'refund') {
      sfx.play('coin');
    }
    this.render(cmd.type === 'launch');
    if (res.state.stage !== 'expedition' && before.stage === 'expedition') {
      // The expedition ended; the debrief or end screen is up.
      sfx.play(res.state.result?.survived ? 'coin' : 'death');
    }
    return true;
  }

  private screenToast(text: string): void {
    const t = h('div', { class: 'toast toast-error screen-toast' }, text);
    this.root.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }

  // ------------------------------------------------------------ event player

  private name(id: string): string {
    const exp = this.state?.expedition;
    return exp?.units.find((u) => u.id === id)?.name ?? exp?.fallen.find((u) => u.id === id)?.name ?? this.prevUnits.get(id)?.name ?? 'Someone';
  }

  private side(id: string): 'player' | 'castle' {
    const exp = this.state?.expedition;
    return (exp?.units.find((u) => u.id === id) ?? exp?.fallen.find((u) => u.id === id) ?? this.prevUnits.get(id))?.side ?? 'castle';
  }

  private async playEvents(events: GameEvent[], before: GameState): Promise<void> {
    const clock = this.dio.clock;
    const wait = (s: number) => clock.wait(s);
    void before;
    for (const e of events) {
      if (!this.root.isConnected) return;
      switch (e.type) {
        case 'log':
          this.hud.appendLog(e.text);
          continue;
        case 'phase': {
          if (e.phase === 'castle') {
            sfx.play('slam', { pitch: 0.6, gain: 0.5 });
            await this.hud.banner('Castle phase', `Turn ${e.turn} · the castle stirs`, true, wait);
          } else if (e.turn > 1) {
            await this.hud.banner(`Turn ${e.turn}`, 'Your move', false, (s) => wait(s * 0.7));
          }
          continue;
        }
        case 'attack': {
          const enemyAttacking = this.side(e.attackerId) === 'castle';
          const watchable = this.dio.shownLevel === this.unitLevel(e.attackerId) || this.dio.shownLevel === this.unitLevel(e.targetId);
          if (!watchable) {
            const lvl = this.unitLevel(e.targetId);
            if (lvl) this.dio.showLevel(lvl);
          }
          const tgt = this.unitPos(e.targetId);
          if (tgt) this.dio.lookAt(tgt);
          sfx.play('dice');
          await this.hud.showDice(
            e,
            { a: this.name(e.attackerId), t: this.name(e.targetId), enemyAttacking },
            wait,
            (hit) => sfx.play('flip', { pitch: hit ? 1.25 : 0.8 }),
            () => {
              sfx.play('perfect');
              clock.hitStop(this.settings.reduceFlashes ? 80 : 220);
            },
          );
          {
            const hits = e.roll.hits.filter(Boolean).length;
            const verb = e.kind === 'melee' ? 'strikes' : 'shoots at';
            this.hud.appendLog(`${this.name(e.attackerId)} ${verb} ${this.name(e.targetId)}: ${hits}/${e.roll.slots} at ${e.roll.chance}%${e.roll.perfect ? ', PERFECT' : ''}${e.roll.wounds ? `, ${e.roll.wounds} wound${e.roll.wounds > 1 ? 's' : ''}` : ''}.`, enemyAttacking ? 'log-enemy' : 'log-attack');
          }
          sfx.play(e.kind === 'missile' ? 'arrow' : e.roll.wounds ? 'sword' : 'miss');
          await this.dio.playEvent(e);
          continue;
        }
        case 'wounded':
          if (this.side(e.unitId) === 'player' || this.dio.shownLevel === this.unitLevel(e.unitId)) sfx.play('chop', { pitch: 0.7, gain: 0.6 });
          await this.dio.playEvent(e);
          continue;
        case 'died':
          if (this.prevUnits.get(e.unitId)?.cls !== 'dummy') this.hud.appendLog(`${this.name(e.unitId)} ${this.side(e.unitId) === 'player' ? 'falls' : 'is destroyed'}.`, this.side(e.unitId) === 'player' ? 'log-enemy' : 'log-attack');
          if (this.prevUnits.get(e.unitId)?.cls !== 'dummy') sfx.play('death', { pitch: this.side(e.unitId) === 'player' ? 1 : 0.8 });
          await this.dio.playEvent(e);
          continue;
        case 'alarm': {
          this.hud.renderAlarm(e.to, e.tierChanged);
          if (e.tierChanged && e.to > e.from) {
            sfx.play('horn');
            this.hud.pulseVignette(this.settings.reduceFlashes);
            this.hud.appendLog(`The Alarm rises to ${e.tier}.`);
            await wait(0.6);
          }
          continue;
        }
        case 'doorAttempt':
          sfx.play(e.method === 'pick' ? 'pick' : e.method === 'force' ? 'smash' : 'click');
          await this.dio.playEvent(e);
          continue;
        case 'doorDestroyed':
          sfx.play('smash', { pitch: 1.2 });
          await this.dio.playEvent(e);
          continue;
        case 'lootFound':
          sfx.play('coin');
          await this.dio.playEvent(e);
          continue;
        case 'spell':
          sfx.play('spell');
          await this.dio.playEvent(e);
          continue;
        case 'reinforcements':
          sfx.play('horn', { pitch: 0.7 });
          await this.dio.playEvent(e);
          continue;
        case 'trap':
          sfx.play('smash', { pitch: 1.6, gain: 0.6 });
          await this.dio.playEvent(e);
          continue;
        case 'moved': {
          // Follow the player's units; for the castle, only watch what can be seen.
          const side = this.side(e.unitId);
          if (side === 'player') {
            const last = e.path[e.path.length - 1];
            if (last && last.level !== this.dio.shownLevel && e.unitId === this.hud.selectedId) this.dio.showLevel(last.level);
            if (e.unitId === this.hud.selectedId) this.dio.setFollow(e.unitId);
          }
          await this.dio.playEvent(e);
          this.dio.setFollow(null);
          continue;
        }
        case 'expeditionOver':
        case 'runOver':
          await wait(0.4);
          continue;
        default:
          await this.dio.playEvent(e);
      }
    }
  }

  private unitPos(id: string) {
    const exp = this.state?.expedition;
    return (exp?.units.find((u) => u.id === id) ?? exp?.fallen.find((u) => u.id === id) ?? this.prevUnits.get(id))?.pos;
  }

  private unitLevel(id: string) {
    return this.unitPos(id)?.level;
  }

  /** Debug and scripting hooks for screenshots. */
  get debug() {
    return {
      state: () => this.state,
      send: (c: Command) => this.send(c),
      dio: this.dio,
      hud: this.hud,
      busy: () => this.busy,
    };
  }
}
