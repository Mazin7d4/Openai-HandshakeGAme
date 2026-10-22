import { Color3, PointLight, Vector3, type Scene } from '@babylonjs/core';
import type { GameAudio } from '../audio/GameAudio.ts';
import type { GameMode } from '../app/GameMode.ts';
import type { MultiplayerSession } from '../network/MultiplayerSession.ts';
import type { DroneRole, MissionNetworkState, RoomStatus, SecurityNetworkState } from '../network/NetworkTypes.ts';
import type { Drone } from '../player/Drone.ts';
import { HeistReport } from '../ui/HeistReport.ts';
import type { RunStats } from '../ui/heistAwards.ts';
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
  private readonly report: HeistReport | null;
  private successTimer: number | null = null;
  private alarmTimer: number | null = null;
  private localElapsed = 0;
  private lastStage = this.state.stage;
  private spotCooldown = 0;
  private tetherSaveCooldown = 0;
  private completedPresented = false;
  private cameraDisabledFor = 0;
  private hacksWereComplete = false;
  private clotheslines = 0;
  private cordTwangs = 0;
  private nearMisses = 0;
  private crateHaulMeters = 0;
  private readonly yankBy: DroneRole[] = [];
  private peakDetection = 0;
  private lastCrateX = 0;
  private lastCrateZ = 0;
  private crateSampleReady = false;
  /** Multiplayer: latest server-owned security state and pending server shoves for our drone. */
  private securityState: SecurityNetworkState | null = null;
  private readonly pendingShoves: { role: DroneRole; impulse: Vector3 }[] = [];
  private readonly spottedLog: DroneRole[] = [];
  /** Last few replicated patrol samples keyed by the server mission clock (test agreement checks). */
  private readonly securityHistory: { t: number; p: { x: number; y: number; z: number }[] }[] = [];
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
    const offSpotted = multiplayer?.onSecuritySpotted((role) => {
      this.spottedLog.push(role);
      this.audio.warning();
    });
    const offShove = multiplayer?.onPatrolShove((m) => {
      const impulse = new Vector3(m.impulse?.x, m.impulse?.y, m.impulse?.z);
      if ((m.role === 'pix' || m.role === 'nee') && Number.isFinite(impulse.x) && Number.isFinite(impulse.y) &&
        Number.isFinite(impulse.z) && impulse.length() <= 8) {
        this.pendingShoves.push({ role: m.role, impulse });
      }
    });
    const offLine = gameEvents.on('clothesline', () => { if (!this.multiplayer) this.clotheslines += 1; });
    const offYank = gameEvents.on('yank', (event) => {
      this.cordTwangs += 1;
      this.yankBy.push(event.from);
    });
    this.unsubscribe = () => { offStun?.(); offSpotted?.(); offShove?.(); offLine(); offYank(); };

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
      uiParent.append(objective);

      this.report = new HeistReport(uiParent, {
        audio,
        onLeave,
        onPlayAgain: () => {
          if (mode === 'multiplayer') multiplayer?.retryMission();
          else this.resetLocal();
        },
      });
      // TEST / screenshot hook: window.__heistReport.show(stats?)
      (window as unknown as { __heistReport?: unknown }).__heistReport = {
        show: (stats?: RunStats) => this.presentReport(stats ?? this.snapshotStats('win'), true),
        hide: () => this.report?.hide(),
        visible: () => this.report?.visible ?? false,
      };
    } else {
      this.objective = null;
      this.objectiveTitle = null;
      this.objectiveDetail = null;
      this.detectionFill = null;
      this.report = null;
    }
    this.renderObjective(0);
  }

  sync(status: RoomStatus): void {
    const previousAlarm = this.state.alarm;
    this.state = { ...status.mission };
    this.securityState = status.security;
    const last = this.securityHistory[this.securityHistory.length - 1];
    if (status.security.patrols.length && last?.t !== status.mission.elapsedSeconds) {
      this.securityHistory.push({ t: status.mission.elapsedSeconds, p: status.security.patrols.map(({ x, y, z }) => ({ x, y, z })) });
      if (this.securityHistory.length > 80) this.securityHistory.shift();
    }
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
    if (this.multiplayer && this.securityState) {
      // Server-owned enemies: render/interpolate only. Shoves land on our own (client-owned) drone.
      // On the partner's drone the impulse is overwritten by its replicated pose next frame; it still
      // marks the partner "in trouble" (rescue-yank prompt) and plays the panic reaction.
      for (const shove of this.pendingShoves.splice(0)) drones.get(shove.role)?.knockback(shove.impulse);
      this.security.updateNetworked(dt, drones, this.state.securityActive, this.securityState, tetherStrain,
        this.state.elapsedSeconds);
    } else {
      this.security.update(dt, drones, this.state.securityActive, this.cameraDisabledFor > 0, tetherStrain);
    }
    this.alarmLight.intensity = this.state.alarm ? 1.6 + Math.sin(this.localElapsed * 9) * 1.2 : 0;
    this.trackNearMisses();
    this.trackCrateHaul(grab);
    this.renderObjective(hack.completionCount());
    this.presentStageChange();
  }

  describe(): string {
    return `mission:${this.state.stage} alarm:${this.state.alarm ? 'on' : 'off'} ` +
      `security:${this.state.securityActive ? 'active' : 'standby'} prototype:${this.state.prototypeHeldBy ?? 'free'} ` +
      `spotted:${this.state.timesSpotted} thrown:${this.state.objectsThrown}`;
  }

  /** TEST-ONLY snapshot for two-client agreement checks. */
  debugSecurity() {
    return {
      patrols: this.security.patrolPositions(),
      server: this.securityState,
      history: [...this.securityHistory],
      detection: this.security.detection,
      stage: this.state.stage,
      alarm: this.state.alarm,
      securityActive: this.state.securityActive,
      timesSpotted: this.state.timesSpotted,
      spotted: [...this.spottedLog],
      clotheslines: this.clotheslines,
    };
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
    if (this.alarmTimer !== null) window.clearTimeout(this.alarmTimer);
    this.audio.stopAlarm();
    this.unsubscribe?.();
    this.security.dispose();
    this.alarmLight.dispose();
    this.objective?.remove();
    this.report?.dispose();
    const hook = window as unknown as { __heistReport?: unknown };
    if (hook.__heistReport) delete hook.__heistReport;
  }

  private spotted(role: DroneRole): void {
    if (this.spotCooldown > 0 || this.state.stage === 'complete') return;
    this.spotCooldown = 2.8;
    this.peakDetection = 0;
    // Single-player only: in multiplayer the server detects, counts and broadcasts 'security-spotted'.
    if (this.multiplayer) return;
    this.spottedLog.push(role);
    this.state = { ...this.state, timesSpotted: this.state.timesSpotted + 1 };
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
    if (this.alarmTimer !== null) window.clearTimeout(this.alarmTimer);
    this.alarmTimer = window.setTimeout(() => { this.alarmTimer = null; if (this.state.alarm && this.state.stage === 'escape') this.audio.startAlarm(); }, 600);
  }

  private presentStageChange(): void {
    if (this.lastStage === this.state.stage) return;
    this.lastStage = this.state.stage;
    if (this.state.stage === 'infiltrate') this.resetRunCounters();
    if (this.state.stage === 'complete' && !this.completedPresented) {
      this.completedPresented = true;
      this.audio.stopAlarm();
      this.audio.missionComplete();
      gameEvents.emit('heist', { beat: 'extract', position: EXTRACTION.clone() });
      // Let the extraction confetti play before the results panel covers it.
      if (this.successTimer !== null) window.clearTimeout(this.successTimer);
      this.successTimer = window.setTimeout(() => {
        this.successTimer = null;
        if (this.state.stage === 'complete') this.presentReport(this.snapshotStats('win'));
      }, 1200);
    } else if (this.state.stage !== 'complete') {
      this.completedPresented = false;
      this.report?.hide();
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

  private presentReport(stats: RunStats, force = false): void {
    if (!this.report) return;
    if (!force && this.state.stage !== 'complete') return;
    this.report.show(stats);
  }

  private snapshotStats(outcome: RunStats['outcome']): RunStats {
    return {
      elapsedSeconds: this.state.elapsedSeconds,
      timesSpotted: this.state.timesSpotted,
      objectsThrown: this.state.objectsThrown,
      tetherSaves: this.state.tetherSaves,
      clotheslines: this.clotheslines,
      cordTwangs: this.cordTwangs,
      nearMisses: this.nearMisses,
      crateHaulMeters: this.crateHaulMeters,
      spottedBy: [...this.spottedLog],
      yankBy: [...this.yankBy],
      outcome,
    };
  }

  /** Detection climbed past "almost" then cooled without a spot. */
  private trackNearMisses(): void {
    if (this.state.stage === 'complete' || !this.state.securityActive) return;
    const d = this.security.detection;
    if (d > this.peakDetection) this.peakDetection = d;
    if (this.peakDetection >= 0.72 && d < 0.35) {
      this.nearMisses += 1;
      this.peakDetection = 0;
    }
  }

  /** Accumulate planar metres while the heavy lab crate is held (helped or not). */
  private trackCrateHaul(grab: GrabSystem): void {
    if (this.state.stage === 'complete') return;
    const holder = grab.objectHeldBy('crate-blue');
    const pos = grab.objectPosition('crate-blue');
    if (!holder || !pos) {
      this.crateSampleReady = false;
      return;
    }
    if (!this.crateSampleReady) {
      this.lastCrateX = pos.x;
      this.lastCrateZ = pos.z;
      this.crateSampleReady = true;
      return;
    }
    const dx = pos.x - this.lastCrateX;
    const dz = pos.z - this.lastCrateZ;
    const step = Math.hypot(dx, dz);
    if (step > 0.02 && step < 4) this.crateHaulMeters += step;
    this.lastCrateX = pos.x;
    this.lastCrateZ = pos.z;
  }

  private resetRunCounters(): void {
    this.clotheslines = 0;
    this.cordTwangs = 0;
    this.nearMisses = 0;
    this.crateHaulMeters = 0;
    this.yankBy.length = 0;
    this.spottedLog.length = 0;
    this.peakDetection = 0;
    this.crateSampleReady = false;
  }

  private resetLocal(): void {
    this.state = { ...FRESH_STATE };
    this.resetRunCounters();
    this.localElapsed = 0;
    this.completedPresented = false;
    this.lastStage = 'infiltrate';
    this.audio.stopAlarm();
    this.report?.hide();
  }
}
