import { Color3, PointLight, Vector3, type Scene } from '@babylonjs/core';
import type { GameAudio } from '../audio/GameAudio.ts';
import type { GameMode } from '../app/GameMode.ts';
import type { MultiplayerSession } from '../network/MultiplayerSession.ts';
import type { DroneRole, MissionNetworkState, RoomStatus } from '../network/NetworkTypes.ts';
import type { Drone } from '../player/Drone.ts';
import type { GrabSystem } from './GrabSystem.ts';
import type { HackSession } from './HackSession.ts';
import { SecuritySystem } from './SecuritySystem.ts';
import layout from '../level/heist-layout.json';
import { updateHeistPresentation } from '../level/PrototypeHeist.ts';
import { gameEvents } from './GameEvents.ts';

const VAULT = new Vector3(layout.objects.prototype.x, layout.objects.prototype.y, layout.objects.prototype.z);
const EXTRACTION = new Vector3(layout.extraction.x, layout.extraction.y, layout.extraction.z);

const FRESH_STATE: MissionNetworkState = {
  stage: 'infiltrate', alarm: false, securityActive: false, prototypeHeldBy: null,
  extracted: false, elapsedSeconds: 0, timesSpotted: 0, objectsThrown: 0, tetherSaves: 0,
};

/** Drives the complete Prototype Theft loop without owning flight, tether or grab mechanics. */
export class MissionDirector {
  private state: MissionNetworkState = { ...FRESH_STATE };
  private readonly multiplayer: MultiplayerSession | null;
  private readonly security: SecuritySystem;
  private readonly audio: GameAudio;
  private readonly alarmLight: PointLight;
  private readonly objective: HTMLElement | null;
  private readonly objectiveTitle: HTMLHeadingElement | null;
  private readonly objectiveDetail: HTMLParagraphElement | null;
  private readonly detectionFill: HTMLDivElement | null;
  private readonly completeOverlay: HTMLDivElement | null;
  private successTimer: number | null = null;
  private readonly stats: HTMLDListElement | null;
  private localElapsed = 0;
  private lastStage = this.state.stage;
  private spotCooldown = 0;
  private tetherSaveCooldown = 0;
  private completedPresented = false;
  private cameraDisabledFor = 0;
  private hacksWereComplete = false;
  private clotheslines = 0;
  private readonly unsubscribe: (() => void) | null;
  private readonly scene: Scene;
  private routeHint = 'Enter beneath reception, then rise together through the service vent.';

  constructor(
    scene: Scene,
    mode: GameMode,
    multiplayer: MultiplayerSession | null,
    grab: GrabSystem,
    audio: GameAudio,
    uiParent?: HTMLElement,
    onLeave?: () => void,
  ) {
    this.scene = scene;
    this.multiplayer = multiplayer;
    this.audio = audio;
    this.alarmLight = new PointLight('alarm-light', new Vector3(0, 5.5, 8), scene);
    this.alarmLight.diffuse = new Color3(1, 0.05, 0.03);
    this.alarmLight.intensity = 0;
    this.security = new SecuritySystem(scene, {
      onSpotted: (role) => this.spotted(role),
      hasFastObjectNear: (point, radius) => grab.nearbyFastObject(point, radius),
      requestStun: multiplayer
        ? (index, at) => multiplayer.requestPatrolStun({ index, x: at.x, y: at.y, z: at.z })
        : undefined,
    }, audio);
    const offStun = multiplayer?.onPatrolStunned((m) => {
      this.clotheslines = m.clotheslines ?? this.clotheslines + 1;
      this.security.remoteStun(m.index, new Vector3(m.x, m.y, m.z));
    });
    const offLine = gameEvents.on('clothesline', () => { if (!this.multiplayer) this.clotheslines += 1; });
    this.unsubscribe = () => { offStun?.(); offLine(); };

    if (uiParent) {
      const objective = document.createElement('aside');
      this.objective = objective;
      objective.className = 'mission-objective';
      objective.dataset.testid = 'mission-objective';
      const kicker = document.createElement('span');
      kicker.textContent = 'PROTOTYPE THEFT';
      this.objectiveTitle = document.createElement('h2');
      this.objectiveDetail = document.createElement('p');
      const detection = document.createElement('div');
      detection.className = 'detection-meter';
      this.detectionFill = document.createElement('div');
      detection.append(this.detectionFill);
      objective.append(kicker, this.objectiveTitle, this.objectiveDetail, detection);

      const completeOverlay = document.createElement('div');
      this.completeOverlay = completeOverlay;
      completeOverlay.className = 'mission-complete-overlay';
      completeOverlay.dataset.testid = 'mission-complete';
      const panel = document.createElement('section');
      panel.className = 'mission-complete-panel';
      panel.innerHTML = '<p class="menu-kicker">PROTOTYPE SECURED</p><h1>MISSION COMPLETE</h1>' +
        '<div class="mission-crew"><span class="crew-face pix">^ ^</span><span class="mission-rating"></span><span class="crew-face nee">^ ^</span></div>' +
        '<p class="mission-quip"></p>';
      this.stats = document.createElement('dl');
      this.stats.className = 'mission-stats';
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'menu-button';
      retry.textContent = 'RETRY';
      retry.dataset.testid = 'retry-mission';
      retry.addEventListener('click', () => {
        if (mode === 'multiplayer') multiplayer?.retryMission();
        else this.resetLocal();
      });
      const menu = document.createElement('button');
      menu.type = 'button';
      menu.className = 'menu-button';
      menu.textContent = 'RETURN TO MENU';
      menu.addEventListener('click', () => onLeave?.());
      const actions = document.createElement('div');
      actions.className = 'mission-complete-actions';
      actions.append(retry, menu);
      panel.append(this.stats, actions);
      completeOverlay.append(panel);
      uiParent.append(objective, completeOverlay);
    } else {
      this.objective = null;
      this.objectiveTitle = null;
      this.objectiveDetail = null;
      this.detectionFill = null;
      this.completeOverlay = null;
      this.stats = null;
    }
    this.renderObjective(0);
  }

  sync(status: RoomStatus): void {
    const previousAlarm = this.state.alarm;
    this.state = { ...status.mission };
    if (!previousAlarm && this.state.alarm) this.beginAlarm();
    this.presentStageChange();
  }

  notifyGrab(objectId: string, role: DroneRole): void {
    if (this.multiplayer || objectId !== 'prototype' || !this.state.stage.startsWith('steal')) return;
    this.state = { ...this.state, stage: 'escape', alarm: true, securityActive: true, prototypeHeldBy: role };
    this.beginAlarm();
  }

  notifyThrow(): void {
    if (!this.multiplayer) this.state = { ...this.state, objectsThrown: this.state.objectsThrown + 1 };
    this.audio.throwObject();
  }

  update(
    dt: number,
    drones: ReadonlyMap<DroneRole, Drone>,
    hack: HackSession,
    grab: GrabSystem,
    tetherStrain: number,
  ): void {
    this.localElapsed += dt;
    this.spotCooldown = Math.max(0, this.spotCooldown - dt);
    this.tetherSaveCooldown = Math.max(0, this.tetherSaveCooldown - dt);
    this.cameraDisabledFor = Math.max(0, this.cameraDisabledFor - dt);
    if (hack.allComplete() && !this.hacksWereComplete) {
      this.cameraDisabledFor = 18;
      if (!this.state.alarm) gameEvents.emit('heist', { beat: 'vault', position: VAULT.clone() });
    }
    this.hacksWereComplete = hack.allComplete();
    if (!this.multiplayer) {
      this.state = { ...this.state, elapsedSeconds: this.localElapsed };
      if (this.state.stage === 'infiltrate' && [...drones.values()].some((drone) => drone.position.z > layout.infiltrationZ)) {
        this.state = { ...this.state, stage: 'hack-security' };
      }
      if (this.state.stage === 'hack-security' && hack.allComplete()) {
        this.state = { ...this.state, stage: 'steal-prototype' };
      }
      const holder = grab.objectHeldBy('prototype');
      if (holder && !this.state.alarm && hack.allComplete()) this.notifyGrab('prototype', holder);
      this.state = { ...this.state, prototypeHeldBy: holder };
      if (this.state.stage === 'escape' && holder) {
        const bothInside = [...drones.values()].every((drone) => Vector3.Distance(drone.position, EXTRACTION) <= 5.5);
        const carrierInside = Vector3.Distance(drones.get(holder)?.position ?? Vector3.Zero(), EXTRACTION) <= 4.5;
        if (bothInside && carrierInside) this.completeMission();
      }
    }
    if (this.state.securityActive && tetherStrain > 0.78 && this.tetherSaveCooldown <= 0) {
      this.tetherSaveCooldown = 5;
      if (this.multiplayer) this.multiplayer.reportTetherSave();
      else this.state = { ...this.state, tetherSaves: this.state.tetherSaves + 1 };
    }
    hack.setAlarmed(this.state.alarm);
    updateHeistPresentation(this.scene, dt, {
      alarm: this.state.alarm,
      complete: this.state.extracted,
      officeOpen: hack.isComplete('terminal-a') && hack.isComplete('terminal-b'),
      vaultOpen: hack.allComplete(),
      stage: this.state.stage,
      hacked: { 'terminal-a': hack.isComplete('terminal-a'), 'terminal-b': hack.isComplete('terminal-b'), 'terminal-c': hack.isComplete('terminal-c') },
      prototypeHeld: this.state.prototypeHeldBy !== null,
    });
    const centerZ = [...drones.values()].reduce((sum, drone) => sum + drone.position.z, 0) / Math.max(1, drones.size);
    this.routeHint = centerZ < -40
      ? 'Under reception, then climb into the high vent. Stay close through the opening.'
      : !hack.isComplete('terminal-a') || !hack.isComplete('terminal-b')
        ? 'Two keys: PIX on the left desktop; NEE beneath the right desk. Move together between them.'
        : !hack.isComplete('terminal-c')
          ? 'Server gallery unlocked. Weave around the racks or fly over them; reach the high memory shelf.'
          : 'Vault authorized. Through the central shutter, then climb to the companion core.';
    this.security.update(dt, drones, this.state.securityActive, this.cameraDisabledFor > 0, tetherStrain,
      this.multiplayer ? this.state.elapsedSeconds : undefined);
    this.alarmLight.intensity = this.state.alarm ? 1.6 + Math.sin(this.localElapsed * 9) * 1.2 : 0;
    this.renderObjective(hack.completionCount());
    this.presentStageChange();
  }

  describe(): string {
    return `mission:${this.state.stage} alarm:${this.state.alarm ? 'on' : 'off'} ` +
      `security:${this.state.securityActive ? 'active' : 'standby'} prototype:${this.state.prototypeHeldBy ?? 'free'} ` +
      `spotted:${this.state.timesSpotted} thrown:${this.state.objectsThrown}`;
  }

  get cameraContext() {
    return { alarm: this.state.alarm, vaultOpen: this.hacksWereComplete, complete: this.state.extracted };
  }

  /** A rescue yank. Multiplayer: the server counts it when it relays the yank. */
  recordTetherSave(): void {
    if (!this.multiplayer) this.state = { ...this.state, tetherSaves: this.state.tetherSaves + 1 };
  }

  dispose(): void {
    if (this.successTimer !== null) window.clearTimeout(this.successTimer);
    this.audio.stopAlarm();
    this.unsubscribe?.();
    this.security.dispose();
    this.alarmLight.dispose();
    this.objective?.remove();
    this.completeOverlay?.remove();
  }

  private spotted(role: DroneRole): void {
    if (this.spotCooldown > 0 || this.state.stage === 'complete') return;
    this.spotCooldown = 2.8;
    if (this.multiplayer) {
      if (this.multiplayer.currentStatus.localRole === role) this.multiplayer.reportSpotted();
    } else {
      this.state = { ...this.state, timesSpotted: this.state.timesSpotted + 1 };
    }
    this.audio.warning();
  }

  private completeMission(): void {
    if (this.state.stage === 'complete') return;
    this.state = { ...this.state, stage: 'complete', extracted: true, securityActive: false };
    this.audio.stopAlarm();
  }

  private beginAlarm(): void {
    gameEvents.emit('heist', { beat: 'pickup', position: VAULT.clone(), role: this.state.prototypeHeldBy });
    this.audio.prototypePickup();
    window.setTimeout(() => { if (this.state.alarm && this.state.stage === 'escape') this.audio.startAlarm(); }, 600);
  }

  private presentStageChange(): void {
    if (this.lastStage === this.state.stage) return;
    this.lastStage = this.state.stage;
    if (this.state.stage === 'infiltrate') this.clotheslines = 0;
    if (this.state.stage === 'complete' && !this.completedPresented) {
      this.completedPresented = true;
      this.audio.stopAlarm();
      this.audio.missionComplete();
      gameEvents.emit('heist', { beat: 'extract', position: EXTRACTION.clone() });
      this.renderStats();
      // Let the extraction confetti play before the results panel covers it.
      if (this.successTimer !== null) window.clearTimeout(this.successTimer);
      this.successTimer = window.setTimeout(() => {
        this.successTimer = null;
        if (this.state.stage === 'complete') this.completeOverlay?.classList.add('visible');
      }, 1200);
    } else if (this.state.stage !== 'complete') {
      this.completedPresented = false;
      this.completeOverlay?.classList.remove('visible');
    }
  }

  private renderObjective(hackCount: number): void {
    if (!this.objectiveTitle || !this.objectiveDetail || !this.detectionFill) return;
    const [title, detail] = this.state.stage === 'infiltrate'
      ? ['A SMALL DELIVERY', this.routeHint]
      : this.state.stage === 'hack-security'
        ? ['INSIDE MORROW', `${hackCount} / 3 access keys · ${this.routeHint}`]
        : this.state.stage === 'steal-prototype'
          ? ['MEET THE PROTOTYPE', 'The vault is open. Rise to the display cradle; [E] to carry the core.']
          : this.state.stage === 'escape'
            ? ['EVERYBODY OUT!', 'Main shutter sealed! West relief vent is open. Heavy Lab Crate is jamming the relief vent - haul it clear together. Follow green floor lights; throw loose objects at patrols. Both drones must reach PICKUP / 01.']
            : ['PROTOTYPE SECURED', 'Extraction complete'];
    this.objectiveTitle.textContent = title;
    this.objectiveDetail.textContent = detail;
    this.detectionFill.style.width = `${Math.round(this.security.detection * 100)}%`;
    this.objective?.classList.toggle('alarm', this.state.alarm);
  }

  private renderStats(): void {
    if (!this.stats) return;
    this.stats.replaceChildren();
    const values: [string, string][] = [
      ['COMPLETION TIME', formatTime(this.state.elapsedSeconds)],
      ['TIMES SPOTTED', String(Math.round(this.state.timesSpotted))],
      ['OBJECTS THROWN', String(Math.round(this.state.objectsThrown))],
      ['TETHER SAVES', String(Math.round(this.state.tetherSaves))],
      ['CLOTHESLINES', String(this.clotheslines)],
    ];
    const spotted = Math.round(this.state.timesSpotted);
    const stars = 1 + (spotted <= 1 ? 1 : 0) + (this.state.elapsedSeconds < 420 || this.state.tetherSaves + this.clotheslines >= 2 ? 1 : 0);
    const rating = this.completeOverlay?.querySelector('.mission-rating');
    if (rating) {
      rating.textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
      rating.setAttribute('aria-label', `${stars} of 3 stars`);
    }
    const quip = this.completeOverlay?.querySelector('.mission-quip');
    if (quip) quip.textContent = spotted === 0
      ? 'PIX: “Ghosts. We were ghosts.”   NEE: “I was SO nervous.”'
      : this.state.tetherSaves > 0
        ? 'NEE: “You yanked me out of there!”   PIX: “That’s what the cord is for.”'
        : 'PIX: “Nobody saw a thing.”   NEE: “Everybody saw everything.”';
    for (const [label, value] of values) {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      this.stats.append(dt, dd);
    }
  }

  private resetLocal(): void {
    this.state = { ...FRESH_STATE };
    this.clotheslines = 0;
    this.localElapsed = 0;
    this.completedPresented = false;
    this.lastStage = 'infiltrate';
    this.audio.stopAlarm();
    this.completeOverlay?.classList.remove('visible');
  }
}

function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
