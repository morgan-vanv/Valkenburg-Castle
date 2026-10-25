// The app: holds the GameState, switches screens on state.stage, sends every
// command through engine.apply, autosaves, and plays events in order while
// input is blocked.

import type { Engine } from '../game/api';
import { posKey, type Pos } from '../game/hex';
import type { Command, GameEvent, GameState } from '../game/types';
import { sfx } from '../audio/sfx';
import { Diorama } from '../view/diorama';
import { clear, h } from './dom';
import { Hud } from './hud';
import { campScreen, overScreen, summaryScreen, titleScreen, type Loadout, type ScreenHost, type Station } from './screens';
import { CREW, STANCE, STORY, dealLine } from './names';
import { loadSettings, saveSettings, type Settings } from './settings';

export const SAVE_KEY = 'vc.save.v37';

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
/** Default camera distance at delve start (V3.3 scale C: heroes are 2.0, a bit closer than 15.8's 22). */
const DELVE_DISTANCE = 19;

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
   * `Delve.entrance`), so it comes from the loadout the prepare screen saved; the main gate otherwise.
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
    // V3.4: "Lower walls near the camera" (the view agent's setCutaway; older dioramas: the field).
    const dio = this.dio as Diorama & { setCutaway?: (on: boolean) => void };
    if (typeof dio.setCutaway === 'function') dio.setCutaway(this.settings.cutaway);
    else dio.cutaway = this.settings.cutaway;
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
      wonBack: this.wonBack,
      dismissWonBack: () => {
        this.wonBack = [];
        this.render();
      },
    };
  }

  private newCampaign(seed: number): void {
    const res = this.engine.apply(this.engine.newGame(seed), { type: 'newCampaign', seed });
    const s = res.error ? this.engine.newGame(seed) : res.state;
    this.state = s;
    this.station = this.needsHire(s) ? 'tavern' : 'board';
    this.loadout = null;
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
      this.dio.setEntrance(this.entrancePos());
      this.dio.sync(s, vis, this.engine.brightness(s));
      this.hud.setState(s, vis);
      this.hud.setDark(this.engine.brightness(s));
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
        if (stageChanged && !this.wonBack.length) this.station = this.needsHire(s) ? 'tavern' : 'board';
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
    // 18.7: the won-back moment on return to camp.
    const won = res.events.filter((e): e is Extract<GameEvent, { type: 'villageUnlocked' }> => e.type === 'villageUnlocked').map((e) => e.story);
    if (won.length) {
      this.wonBack = won;
      const st = STORY[won[won.length - 1]!].station;
      this.station = st;
      this.lastStage = 'camp';
      sfx.play('levelup', { gain: 0.8 });
      setTimeout(() => sfx.play('horn', { pitch: 1.2, gain: 0.35 }), 260);
    } else if (cmd.type === 'startDelve') this.wonBack = [];
    this.render(cmd.type === 'startDelve');
    if (this.state?.stage === 'delve' && (cmd.type === 'move' || cmd.type === 'act')) this.hud.autoAdvance();
    // 16.2: "start shuttered" on the prepare screen: shutter is free, so send it right after the delve starts.
    if (cmd.type === 'startDelve' && this.loadout?.startShuttered && this.state?.delve && this.state.delve.lanternOpen !== false) {
      const bearer = this.state.delve.lanternBearer;
      void this.send({ type: 'act', heroId: bearer, action: 'shutter', target: {}, focus: 0 });
    }
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
    let world = false;
    let panned = false;
    /** 18.6: a deal already says what the crew now does; skip the stance line that follows it. */
    let dealt = false;
    for (const e of events) {
      if (!this.root.isConnected) return;
      // 15.5: in the world phase, take the camera to each visible enemy action or attack on a hero.
      if (world && !instant()) {
        const at = this.enemyFocus(e);
        if (at) {
          await this.dio.panTo(at);
          panned = true;
        }
      }
      if (e.type === 'phase') {
        if (e.phase === 'world') world = true;
        else {
          world = false;
          if (panned) this.returnToSelected();
          panned = false;
        }
      }
      if (e.type === 'moved' && world && !this.isHero(e.id) && !instant() && this.enemyFocus(e)) this.dio.setFollow(e.id);
      switch (e.type) {
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
          if (e.brightness !== prev && this.state?.delve?.lanternOpen !== false) {
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
          await this.dio.playEvent(e);
          if (this.state?.delve) this.hud.updateLight(this.state.delve.light, this.engine.brightness(this.state));
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
        case 'swing':
          sfx.play('whoosh', { pitch: 1.3, gain: 0.5 });
          await this.dio.playEvent(e);
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
          this.hud.log(`${this.hud.nameOf(e.by)} notices ${this.hud.nameOf(e.hero)}!`, 'log-enemy');
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
        default:
          await this.dio.playEvent(e);
      }
    }
    if (panned) this.returnToSelected();
  }

  /** Keven alone (15.3): the camp opens on the campfire. */
  private needsHire(s: GameState): boolean {
    return !s.campaign.roster.some((x) => x.cls !== 'heir' && x.wounded === 0);
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
      posKey,
      /** Replace the state (debug/screenshots only). */
      load: (st: GameState) => {
        this.state = st;
        this.render(false);
      },
    };
  }
}
