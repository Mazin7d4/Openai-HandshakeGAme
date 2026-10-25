import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { PointLight } from '@babylonjs/core/Lights/pointLight.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { GameAudio } from '../audio/GameAudio.ts';
import type { GameMode } from '../app/GameMode.ts';
import type { FloorClearedMessage, MultiplayerSession, RunEndedMessage } from '../network/MultiplayerSession.ts';
import type {
  DroneNetworkState,
  DroneRole,
  MissionNetworkState,
  RoomStatus,
  SecurityNetworkState,
} from '../network/NetworkTypes.ts';
import type { Drone } from '../player/Drone.ts';
import { noteVaultCrack } from '../player/Cosmetics.ts';
import { HeistReport, type CoopReportState } from '../ui/HeistReport.ts';
import { escapeReplay } from '../fx/EscapeReplay.ts';
import type { RunStats } from '../ui/heistAwards.ts';
import type { GrabSystem } from './GrabSystem.ts';
import type { HackSession } from './HackSession.ts';
import { SecuritySystem } from './SecuritySystem.ts';
import layout from '../level/heist-layout.json';
import type { RunLayout } from '../seed/index.ts';
import { generateRun, nextFloorSeed, stashRunSeed } from '../seed/index.ts';
import { clearRunIntent, formatBeatMs, getRunInfo, prepareRun, randomSeed } from '../net/runInfo.ts';
import { updateHeistPresentation } from '../level/PrototypeHeist.ts';
import { gameEvents } from './GameEvents.ts';
import { getRunState, localEscape, localCapture, nextFloorSeed as runNextFloorSeed } from '../run/ClientRun.ts';
import { byInput } from '../ui/inputHints.ts';
import { beginFloor, getBest, recordBest, resetRun, runSummary, scoreFloor } from '../run/nightShiftScore.ts';
import { twistFlavor } from '../run/twistFlavor.ts';
import type { NightShiftSummary } from '../ui/HeistReport.ts';
import { getSettings, subscribeSettings } from '../ui/Settings.ts';
import { isTouchPlayDevice } from '../ui/touchDetect.ts';

export interface WarmupStep {
  label: string;
  done: boolean;
}

const FRESH_STATE: MissionNetworkState = {
  stage: 'infiltrate', alarm: false, securityActive: false, prototypeHeldBy: null,
  extracted: false, elapsedSeconds: 0, timesSpotted: 0, objectsThrown: 0, tetherSaves: 0,
};

/** Drives the complete Prototype Theft loop without owning flight, tether or grab mechanics. */
/** Night Shift jobs: floor 2+ reads as a new job (kicker + objective titles), floor 1 keeps the classic heist. */
interface FloorJob { kicker: string; infiltrate: string; hack: string; steal: string; escape: string }
const CLASSIC_JOB: FloorJob = {
  kicker: 'Prototype theft', infiltrate: 'Sneak in under reception', hack: 'Crack the office consoles',
  steal: 'Grab the prototype', escape: 'Get out through the west vent',
};
const NIGHT_JOBS: readonly FloorJob[] = [
  { kicker: 'Night job · Server swap', infiltrate: 'Slip past the night desk', hack: 'Spoof the badge readers', steal: 'Lift the server core', escape: 'Haul it out the west vent' },
  { kicker: 'Night job · Board-room bug', infiltrate: 'Duck in behind the cleaners', hack: 'Hot-wire the key terminals', steal: 'Snatch the prototype drive', escape: 'Bail through the west vent' },
  { kicker: 'Night job · Lab breach', infiltrate: 'Ghost through reception', hack: 'Override the lab locks', steal: 'Pinch the robot brain', escape: 'Scram out the west vent' },
];
export function floorJob(floor: number | null | undefined): FloorJob {
  const f = Math.max(1, (floor ?? 1) | 0);
  return f <= 1 ? CLASSIC_JOB : NIGHT_JOBS[(f - 2) % NIGHT_JOBS.length];
}

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
  private readonly detectionMeter: HTMLElement | null;
  private readonly statusBadge: HTMLElement | null;
  private readonly report: HeistReport | null;
  private colourBlindSafe = false;
  private unsubSettings: (() => void) | null = null;
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
  private warmup: () => WarmupStep[] | null = () => null;
  private lastWarmupKey: string | null = null;
  private routeHint = 'Enter beneath reception, then rise together through the service vent.';
  private vault = new Vector3(layout.objects.prototype.x, layout.objects.prototype.y, layout.objects.prototype.z);
  private extraction = new Vector3(layout.extraction.x, layout.extraction.y, layout.extraction.z);
  private runLayout: RunLayout | null = null;
  private readonly mode: GameMode;
  private readonly uiParent: HTMLElement | undefined;
  private runChrome: HTMLElement | null = null;
  private floorChip: HTMLElement | null = null;
  private twistChip: HTMLElement | null = null;
  private scoreChip: HTMLElement | null = null;
  private beatChip: HTMLElement | null = null;
  private timeToBeatMs: number | undefined;
  private networkCaptures: ReadonlyMap<DroneRole, DroneNetworkState> | null = null;
  private floorCard: HTMLElement | null = null;
  private floorCardTimer: number | null = null;
  private floorCardRemoveTimer: number | null = null;
  private floorScored = false;
  private lastNightShiftSummary?: NightShiftSummary;
  private objectiveCollapseTimer: number | null = null;
  private objectiveKicker: HTMLElement | null = null;
  private objectiveTextKey = '';
  private rematchPartnerLeft = false;

  constructor(
    scene: Scene,
    mode: GameMode,
    multiplayer: MultiplayerSession | null,
    grab: GrabSystem,
    audio: GameAudio,
    uiParent?: HTMLElement,
    onLeave?: () => void,
    runLayout?: RunLayout | null,
  ) {
    this.scene = scene;
    this.mode = mode;
    this.uiParent = uiParent;
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
    grab.setAimTargets(() => this.security.aimTargets());
    const offStun = multiplayer?.onPatrolStunned((m) => {
      this.clotheslines = m.clotheslines ?? this.clotheslines + 1;
      this.security.remoteStun(m.index, new Vector3(m.x, m.y, m.z));
    });
    const offSpotted = multiplayer?.onSecuritySpotted((role) => {
      this.spottedLog.push(role);
      this.audio.spotted(role);
    });
    const offShove = multiplayer?.onPatrolShove((m) => {
      const impulse = new Vector3(m.impulse?.x, m.impulse?.y, m.impulse?.z);
      // The server addresses shoves to the shoved drone's owner; ignore anything not for our own drone.
      if (m.role === multiplayer.currentStatus.localRole && Number.isFinite(impulse.x) && Number.isFinite(impulse.y) &&
        Number.isFinite(impulse.z) && impulse.length() <= 8) {
        this.pendingShoves.push({ role: m.role, impulse });
      }
    });
    const offLine = gameEvents.on('clothesline', () => { if (!this.multiplayer) this.clotheslines += 1; });
    const offYank = gameEvents.on('yank', (event) => {
      this.cordTwangs += 1;
      if (this.isCoopNightShift()) multiplayer?.sendRunTwang();
      this.yankBy.push(event.from);
    });
    const offFloorCleared = multiplayer?.onFloorCleared((message) => this.handleFloorCleared(message));
    const offRunEnded = multiplayer?.onRunEnded((message) => this.handleRunEnded(message));
    const offRematchStart = multiplayer?.onRematchStart(() => {
      this.rematchPartnerLeft = false;
      this.resetLocal();
    });
    const offRematchPartnerLeft = multiplayer?.onRematchPartnerLeft(() => {
      this.rematchPartnerLeft = true;
      this.updateReportStatus(multiplayer.currentStatus);
    });
    this.unsubscribe = () => {
      offStun?.(); offSpotted?.(); offShove?.(); offLine(); offYank(); offFloorCleared?.(); offRunEnded?.();
      offRematchStart?.(); offRematchPartnerLeft?.();
    };

    if (uiParent) {
      const objective = document.createElement('aside');
      this.objective = objective;
      objective.className = 'mission-objective';
      objective.dataset.testid = 'mission-objective';
      const kicker = document.createElement('span');
      kicker.textContent = CLASSIC_JOB.kicker;
      this.objectiveKicker = kicker;
      this.statusBadge = document.createElement('p');
      this.statusBadge.className = 'mission-status-badge';
      this.statusBadge.dataset.testid = 'mission-status-badge';
      this.statusBadge.hidden = true;
      this.objectiveTitle = document.createElement('h2');
      this.objectiveDetail = document.createElement('p');
      const detection = document.createElement('div');
      detection.className = 'detection-meter';
      detection.setAttribute('role', 'meter');
      detection.setAttribute('aria-label', 'Security detection');
      detection.setAttribute('aria-valuemin', '0');
      detection.setAttribute('aria-valuemax', '100');
      this.detectionMeter = detection;
      this.detectionFill = document.createElement('div');
      detection.append(this.detectionFill);
      objective.append(kicker, this.statusBadge, this.objectiveTitle, this.objectiveDetail, detection);
      uiParent.append(objective);
      objective.addEventListener('click', () => {
        if (objective.dataset.collapsed !== '1') return;
        this.expandObjective();
      });
      this.colourBlindSafe = getSettings().colourBlindSafe;
      this.unsubSettings = subscribeSettings((s) => {
        this.colourBlindSafe = s.colourBlindSafe;
        this.renderObjectiveBadge();
      });

      // Night Shift chrome lives left of center so it clears the right-side touch / active-drone HUD.
      if (mode === 'night-shift' || this.isCoopNightShift() || runLayout) {
        const info = getRunInfo();
        this.timeToBeatMs = info.timeToBeatMs;
        this.runChrome = document.createElement('aside');
        this.runChrome.className = 'run-hud';
        this.runChrome.dataset.testid = 'run-hud';
        this.floorChip = document.createElement('span');
        this.floorChip.className = 'floor-chip';
        this.floorChip.dataset.testid = 'floor-counter';
        this.runChrome.append(this.floorChip);
        this.twistChip = document.createElement('span');
        this.twistChip.className = 'twist-chip';
        this.twistChip.dataset.testid = 'twist-chip';
        this.runChrome.append(this.twistChip);
        this.scoreChip = document.createElement('span');
        this.scoreChip.className = 'score-chip';
        this.scoreChip.dataset.testid = 'score-chip';
        this.runChrome.append(this.scoreChip);
        if (info.timeToBeatMs != null) {
          this.beatChip = document.createElement('span');
          this.beatChip.className = 'beat-chip';
          this.beatChip.dataset.testid = 'beat-chip';
          this.beatChip.textContent = `Beat ${formatBeatMs(info.timeToBeatMs)}`;
          this.runChrome.append(this.beatChip);
        }
        uiParent.append(this.runChrome);
      }

      const restartNightShift = (next: { seed: number; floor: number }, keepBeat = true) => {
        const floor = Math.max(1, next.floor | 0);
        stashRunSeed({ seed: next.seed, floor });
        prepareRun({
          seed: next.seed >>> 0,
          floor,
          captures: 0,
          mode: 'nightshift',
          ...(keepBeat && this.timeToBeatMs != null ? { timeToBeatMs: this.timeToBeatMs } : {}),
        });
        try { sessionStorage.setItem('pixnee.pendingMode', mode); } catch { /* private mode */ }
        onLeave?.();
      };

      this.report = new HeistReport(uiParent, {
        audio,
        onLeave,
        onReplay: () => this.watchReplay(),
        onPlayAgain: () => {
          if (mode === 'night-shift' && this.runLayout) {
            restartNightShift({ seed: this.runLayout.seed, floor: this.runLayout.floor });
          } else {
            this.resetLocal();
          }
        },
        onRematchVote: mode === 'multiplayer' ? (want) => multiplayer?.sendRematchVote(want) : undefined,
        onNewSeed: mode === 'night-shift' ? () => {
          resetRun();
          clearRunIntent();
          restartNightShift({ seed: randomSeed(), floor: 1 }, false);
        } : undefined,
        // Night Shift: solo advances locally; co-op asks the server once.
        onNextFloor: mode === 'night-shift' || this.isCoopNightShift() ? () => {
          if (this.isCoopNightShift()) {
            const floor = this.multiplayer?.currentStatus.run.floor ?? this.runLayout?.floor;
            if (floor != null) this.multiplayer?.sendRunNextFloor(floor);
            return;
          }
          const advanced = localEscape(this.state.elapsedSeconds);
          if (advanced) {
            restartNightShift({ seed: advanced.seed, floor: advanced.floor });
            return;
          }
          if (!this.runLayout) return;
          restartNightShift(nextFloorSeed({ seed: this.runLayout.seed, floor: this.runLayout.floor }));
        } : undefined,
      });
      // TEST / screenshot hook: window.__heistReport.show(stats?)
      (window as unknown as { __heistReport?: unknown }).__heistReport = {
        show: (stats?: RunStats) => this.presentReport(stats ?? this.snapshotStats('win'), true),
        hide: () => this.report?.hide(),
        visible: () => this.report?.visible ?? false,
        challengeUrl: () => this.report?.challengeUrl() ?? null,
      };
    } else {
      this.objective = null;
      this.objectiveTitle = null;
      this.objectiveKicker = null;
      this.objectiveDetail = null;
      this.detectionFill = null;
      this.detectionMeter = null;
      this.statusBadge = null;
      this.report = null;
      this.runChrome = null;
      this.floorChip = null;
      this.beatChip = null;
    }
    if (runLayout) this.applyRunLayout(runLayout);
    this.renderObjective(0);
    if (mode === 'night-shift') {
      (window as unknown as { __nightShift?: unknown }).__nightShift = {
        summary: runSummary,
        best: getBest,
      };
    } else if (this.isCoopNightShift()) {
      (window as unknown as { __nightShift?: unknown }).__nightShift = {
        summary: () => {
          const run = this.multiplayer?.currentStatus.run;
          return run
            ? { total: run.score, streak: run.streak, multiplier: run.multiplier, lastFloor: run.floorCleared ? run.floor : run.floor - 1 }
            : { total: 0, streak: 0, multiplier: 1, lastFloor: 0 };
        },
        best: getBest,
      };
    }
  }

  /** Solo / seed hook: update loot + extraction anchors and HUD floor chip. */
  applyRunLayout(run: RunLayout): void {
    this.runLayout = run;
    this.floorScored = false;
    this.completedPresented = false;
    this.vault.set(run.loot.x, run.loot.y, run.loot.z);
    this.extraction.set(run.extraction.x, run.extraction.y, run.extraction.z);
    this.security.applyRunLayout(run);
    this.renderFloorHud();
    if (this.mode === 'night-shift') {
      const floor = Math.max(1, run.floor | 0);
      beginFloor(floor);
      this.updateScoreHud();
      this.showFloorCard(floor, run.twist);
    } else if (this.isCoopNightShift()) {
      this.report?.hide();
      this.updateScoreHud();
      this.showFloorCard(Math.max(1, run.floor | 0), run.twist);
    }
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
    this.syncCaptureFromRoom(status);
    this.updateReportStatus(status);
    if (this.isCoopNightShift()) {
      this.updateScoreHud();
      this.restoreCoopReport(status);
    }
    this.presentStageChange();
  }

  /** Mirror server capture onto local drones (input lock + hold pose). */
  private syncCaptureFromRoom(status: RoomStatus): void {
    // Applied from GameApp via applyNetworkCapture; keep last known map for debug/tests.
    this.networkCaptures = status.players;
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
      if (!this.state.alarm) {
        noteVaultCrack();
        gameEvents.emit('heist', { beat: 'vault', position: this.vault.clone() });
      }
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
        const bothInside = [...drones.values()].every((drone) => Vector3.Distance(drone.position, this.extraction) <= 5.5);
        const carrierInside = Vector3.Distance(drones.get(holder)?.position ?? Vector3.Zero(), this.extraction) <= 4.5;
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
  /** Switched-on patrol positions, for the solo AI partner's avoidance. */
  activePatrolPositions(): { x: number; y: number; z: number }[] {
    return this.security.activePatrolPositions();
  }

  debugSecurity() {
    const captures: Record<string, {
      captured: boolean;
      capturedBy: number;
      struggles: number;
      carryFor: number;
      rescueProgress: number;
      x: number;
      y: number;
      z: number;
    }> = {};
    this.networkCaptures?.forEach((player, role) => {
      captures[role] = {
        captured: player.captured,
        capturedBy: player.capturedBy,
        struggles: player.struggles,
        carryFor: player.carryFor,
        rescueProgress: player.rescueProgress,
        x: player.position.x,
        y: player.position.y,
        z: player.position.z,
      };
    });
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
      captures,
      runCaptures: this.multiplayer?.currentStatus.run.captures ?? null,
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
    if (this.floorCardTimer !== null) window.clearTimeout(this.floorCardTimer);
    if (this.floorCardRemoveTimer !== null) window.clearTimeout(this.floorCardRemoveTimer);
    if (this.objectiveCollapseTimer !== null) window.clearTimeout(this.objectiveCollapseTimer);
    this.floorCard?.remove();
    this.floorCard = null;
    this.audio.stopAlarm();
    this.unsubscribe?.();
    this.unsubSettings?.();
    this.unsubSettings = null;
    this.security.dispose();
    this.alarmLight.dispose();
    this.objective?.remove();
    this.runChrome?.remove();
    this.report?.dispose();
    const hook = window as unknown as { __heistReport?: unknown; __nightShift?: unknown };
    if (hook.__heistReport) delete hook.__heistReport;
    if (hook.__nightShift) delete hook.__nightShift;
  }

  private spotted(role: DroneRole): void {
    if (this.spotCooldown > 0 || this.state.stage === 'complete') return;
    this.spotCooldown = 2.8;
    this.peakDetection = 0;
    // Single-player only: in multiplayer the server detects, counts and broadcasts 'security-spotted'.
    if (this.multiplayer) return;
    this.spottedLog.push(role);
    this.state = { ...this.state, timesSpotted: this.state.timesSpotted + 1 };
    this.audio.spotted(role);
  }

  private completeMission(): void {
    if (this.state.stage === 'complete') return;
    this.state = { ...this.state, stage: 'complete', extracted: true, securityActive: false };
    this.audio.stopAlarm();
  }

  /** Solo / offline Night Shift capture (test + future fail path). */
  reportCapture(): void {
    if (this.multiplayer || getRunState()?.mode !== 'nightshift') return;
    localCapture();
  }

  private beginAlarm(): void {
    gameEvents.emit('heist', { beat: 'pickup', position: this.vault.clone(), role: this.state.prototypeHeldBy });
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
      gameEvents.emit('heist', { beat: 'extract', position: this.extraction.clone() });
      escapeReplay.markEnd(400);
      // Let the extraction confetti play, then the slow-mo escape replay, then the results panel.
      if (this.successTimer !== null) window.clearTimeout(this.successTimer);
      this.successTimer = window.setTimeout(() => {
        this.successTimer = null;
        if (this.state.stage !== 'complete') return;
        const stats = this.snapshotStats('win');
        this.playReplayThen(() => {
          if (this.state.stage === 'complete') this.presentReport(stats);
        });
      }, 1200);
    } else if (this.state.stage !== 'complete') {
      this.completedPresented = false;
      if (escapeReplay.active) escapeReplay.skip();
      this.report?.hide();
    }
  }

  /** Apron warm-up checklist provider (CordPlayground); null once done. */
  setWarmup(provider: () => WarmupStep[] | null): void { this.warmup = provider; }

  /** Warm-up checklist line, exposed for tests. */
  get warmupLine(): string | null {
    const items = this.warmup();
    return items ? items.map((step) => step.label).join(' · ') : null;
  }
  get stage(): string { return this.state.stage; }

  private isCoopNightShift(): boolean {
    return this.mode === 'multiplayer' && this.multiplayer?.currentStatus.run.mode === 'nightshift';
  }

  private renderObjective(hackCount: number): void {
    if (!this.objectiveTitle || !this.objectiveDetail || !this.detectionFill) return;
    const warm = this.state.stage === 'infiltrate' ? this.warmup() : null;
    const job = floorJob(this.runLayout?.floor);
    if (this.objectiveKicker && this.objectiveKicker.textContent !== job.kicker) this.objectiveKicker.textContent = job.kicker;
    const [title, detail] = this.state.stage === 'infiltrate'
      ? warm ? ['Warm up on the apron', ''] : [job.infiltrate, this.routeHint]
      : this.state.stage === 'hack-security'
        ? [job.hack, `${hackCount} / 3 access keys · ${this.routeHint}`]
        : this.state.stage === 'steal-prototype'
          ? [
              job.steal,
              'The vault is open. Rise to the display cradle; ' +
                byInput({
                  keyboard: '[E] to carry the core.',
                  touch: 'tap Grab to carry the core.',
                  gamepad: 'grab to carry the core.',
                }),
            ]
          : this.state.stage === 'escape'
            ? [
                job.escape,
                'Main shutter sealed! West relief vent is open. Heavy Lab Crate is jamming the relief vent - haul it clear together. Follow green floor lights; throw loose objects at patrols. Both drones must reach Pickup / 01.',
              ]
            : ['Prototype secured', 'Extraction complete'];
    this.objectiveTitle.textContent = title;
    if (warm) {
      const key = warm.map((step) => `${step.label}:${step.done}`).join('|');
      if (this.lastWarmupKey !== key) {
        this.lastWarmupKey = key;
        this.objectiveDetail.replaceChildren();
        for (const step of warm) {
          const span = document.createElement('span');
          span.className = 'warmup-step';
          span.dataset.done = String(step.done);
          span.textContent = step.label;
          this.objectiveDetail.appendChild(span);
        }
        this.objectiveDetail.appendChild(document.createTextNode(' · then fly in under reception'));
      }
    } else {
      this.lastWarmupKey = null;
      this.objectiveDetail.textContent = detail;
    }
    // Re-expand only on a new objective title; per-step detail ticks would keep it open.
    const objectiveKey = title;
    if (objectiveKey !== this.objectiveTextKey) {
      this.objectiveTextKey = objectiveKey;
      this.expandObjective();
    }
    const detectionPct = Math.round(this.security.detection * 100);
    this.detectionFill.style.width = `${detectionPct}%`;
    this.detectionMeter?.setAttribute('aria-valuenow', String(detectionPct));
    this.objective?.classList.toggle('alarm', this.state.alarm);
    this.objective?.classList.toggle('security-active', this.state.securityActive && !this.state.alarm);
    this.renderObjectiveBadge();
  }

  /** Every layout collapses the card to a pill (desktop too) so the scene stays clear. */
  private compactObjective(): boolean {
    return true;
  }

  private expandObjective(): void {
    if (!this.objective || !this.compactObjective()) return;
    if (this.objectiveCollapseTimer !== null) window.clearTimeout(this.objectiveCollapseTimer);
    this.objective.classList.remove('mission-objective--collapsed');
    this.objective.dataset.collapsed = '0';
    this.objectiveCollapseTimer = window.setTimeout(() => {
      this.objectiveCollapseTimer = null;
      this.objective?.classList.add('mission-objective--collapsed');
      if (this.objective) this.objective.dataset.collapsed = '1';
    }, isTouchPlayDevice() ? 4000 : 5000);
  }

  /** Colourblind-safe shape + text for alarm / security (amber = security only). */
  private renderObjectiveBadge(): void {
    if (!this.statusBadge || !this.objective) return;
    this.objective.classList.toggle('colourblind-cues', this.colourBlindSafe);
    if (!this.colourBlindSafe) {
      this.statusBadge.hidden = true;
      this.statusBadge.textContent = '';
      this.statusBadge.removeAttribute('data-state');
      return;
    }
    if (this.state.alarm) {
      this.statusBadge.hidden = false;
      this.statusBadge.dataset.state = 'alarm';
      this.statusBadge.innerHTML =
        '<span class="mission-status-icon mission-status-icon--alarm" aria-hidden="true">▲</span>'
        + '<span class="mission-status-label">Alarm</span>';
    } else if (this.state.securityActive) {
      this.statusBadge.hidden = false;
      this.statusBadge.dataset.state = 'security';
      this.statusBadge.innerHTML =
        '<span class="mission-status-icon mission-status-icon--security" aria-hidden="true">◆</span>'
        + '<span class="mission-status-label">Security</span>';
    } else {
      this.statusBadge.hidden = true;
      this.statusBadge.textContent = '';
      this.statusBadge.removeAttribute('data-state');
    }
  }

  private showFloorCard(floor: number, twist: RunLayout['twist']): void {
    if (!this.uiParent) return;
    if (this.floorCardTimer !== null) {
      window.clearTimeout(this.floorCardTimer);
      this.floorCardTimer = null;
    }
    if (this.floorCardRemoveTimer !== null) {
      window.clearTimeout(this.floorCardRemoveTimer);
      this.floorCardRemoveTimer = null;
    }
    if (this.floorCard) {
      this.floorCard.remove();
      this.floorCard = null;
    }

    const serverRun = this.isCoopNightShift() ? this.multiplayer?.currentStatus.run : null;
    const { total, multiplier } = serverRun
      ? { total: serverRun.score, multiplier: serverRun.multiplier }
      : runSummary();
    const card = document.createElement('div');
    card.className = 'floor-card';
    card.dataset.testid = 'floor-card';

    const kicker = document.createElement('small');
    kicker.className = 'floor-card__kicker';
    kicker.style.display = 'block';
    kicker.textContent = floor > 1 ? `Floor ${floor} · ${floorJob(floor).kicker.replace('Night job · ', '')}` : `Floor ${floor}`;

    const title = document.createElement('h3');
    title.textContent = twist.label;

    const flavor = document.createElement('p');
    flavor.className = 'floor-card__flavor';
    flavor.textContent = twistFlavor(twist.id);

    const score = document.createElement('p');
    score.className = 'floor-card__score';
    score.textContent = `Score ${total.toLocaleString('en-US')} · streak x${multiplier}`;

    card.append(kicker, title, flavor, score);

    const dismiss = () => {
      if (this.floorCardTimer !== null) {
        window.clearTimeout(this.floorCardTimer);
        this.floorCardTimer = null;
      }
      if (!card.classList.contains('floor-card--out')) {
        card.classList.add('floor-card--out');
        if (this.floorCardRemoveTimer !== null) {
          window.clearTimeout(this.floorCardRemoveTimer);
        }
        this.floorCardRemoveTimer = window.setTimeout(() => {
          this.floorCardRemoveTimer = null;
          card.remove();
          if (this.floorCard === card) this.floorCard = null;
        }, 400);
      }
    };

    card.addEventListener('click', dismiss);
    this.uiParent.append(card);
    this.floorCard = card;
    this.floorCardTimer = window.setTimeout(dismiss, 3200);
  }

  private handleFloorCleared(message: FloorClearedMessage): void {
    if (!this.isCoopNightShift() || !message?.next) return;
    const wasComplete = this.state.stage === 'complete';
    if (this.successTimer !== null) {
      window.clearTimeout(this.successTimer);
      this.successTimer = null;
    }
    const nextTwist = generateRun(message.next.seed, message.next.floor).twist;
    this.floorScored = true;
    this.completedPresented = true;
    if (!wasComplete) {
      this.audio.stopAlarm();
      this.audio.missionComplete();
      gameEvents.emit('heist', { beat: 'extract', position: this.extraction.clone() });
      escapeReplay.markEnd(0);
    }
    const best = recordBest(message.floor, message.total);
    this.lastNightShiftSummary = {
      floor: message.floor,
      points: message.points,
      total: message.total,
      multiplier: message.multiplier,
      best,
      nextTwist: { label: nextTwist.label, flavor: twistFlavor(nextTwist.id) },
    };
    this.updateScoreHud();
    const stats = this.snapshotStats('win');
    this.playReplayThen(() => this.presentReport(stats, true));
  }

  /** Slow-mo escape replay before the report; falls straight through when there is no footage or reduced motion. */
  private playReplayThen(show: () => void): void {
    const reveal = () => {
      this.report?.setReplayAvailable(escapeReplay.hasFootage);
      show();
    };
    if (!escapeReplay.play({ onDone: reveal, subline: this.replaySubline() })) reveal();
  }

  /** Report "Watch replay": hide the report, replay, bring the same report back. */
  private watchReplay(): void {
    if (!this.report || escapeReplay.active) return;
    this.report.suspend();
    const played = escapeReplay.play({ manual: true, subline: this.replaySubline(), onDone: () => this.report?.resume() });
    if (!played) this.report.resume();
  }

  private replaySubline(): string | undefined {
    const nightShift = this.mode === 'night-shift' || this.isCoopNightShift();
    if (!nightShift || !this.runLayout) return undefined;
    const floor = this.multiplayer?.currentStatus.run.floor ?? this.runLayout.floor;
    return `Floor ${Math.max(1, floor | 0)} cleared`;
  }

  /** Late join / reconnect: rebuild the shared report from server run state if the broadcast was missed. */
  private restoreCoopReport(status: RoomStatus): void {
    const run = status.run;
    if (!run || run.mode !== 'nightshift') return;
    const current = this.lastNightShiftSummary;
    if (run.ended) {
      if (!current?.runEnded) {
        this.handleRunEnded({
          reason: 'captures', captures: run.captures, floor: run.floor, seed: run.seed,
          score: run.score, multiplier: run.multiplier, streak: run.streak,
        });
      }
      return;
    }
    if (run.floorCleared && current?.floor !== run.floor) {
      this.handleFloorCleared({
        floor: run.floor, seed: run.seed, points: run.lastFloorPoints, base: 0,
        multiplier: run.multiplier, streak: run.streak, total: run.score, clean: run.streak > 0,
        next: { seed: runNextFloorSeed(run.seed, run.floor + 1), floor: run.floor + 1 },
      });
    }
  }

  private handleRunEnded(message: RunEndedMessage): void {
    if (!this.isCoopNightShift()) return;
    if (this.successTimer !== null) {
      window.clearTimeout(this.successTimer);
      this.successTimer = null;
    }
    this.completedPresented = true;
    this.audio.stopAlarm();
    const best = recordBest(message.floor, message.score);
    this.lastNightShiftSummary = {
      floor: message.floor,
      points: 0,
      total: message.score,
      multiplier: message.multiplier,
      best,
      runEnded: true,
      captures: message.captures,
    };
    this.presentReport({ ...this.snapshotStats('fail'), seed: message.seed }, true);
  }

  private renderFloorHud(): void {
    if (!this.floorChip || !this.runLayout) return;
    // RunState / generateRun floors are already 1-based for Night Shift boots.
    const floor = Math.max(1, this.runLayout.floor | 0);
    this.floorChip.textContent = `Floor ${floor}`;
    if (this.twistChip && this.runLayout.twist) {
      this.twistChip.textContent = this.runLayout.twist.label;
    }
    this.updateScoreHud();
  }

  private updateScoreHud(): void {
    if (!this.scoreChip) return;
    const coop = this.isCoopNightShift();
    const serverRun = coop ? this.multiplayer?.currentStatus.run : null;
    const { total, multiplier } = serverRun
      ? { total: serverRun.score, multiplier: serverRun.multiplier }
      : runSummary();
    const multText = multiplier > 1 ? ` · x${multiplier}` : '';
    this.scoreChip.textContent = `Score ${total.toLocaleString('en-US')}${multText}`;
  }

  private presentReport(stats: RunStats, force = false): void {
    if (!this.report) return;
    if (!force && this.state.stage !== 'complete') return;
    if (this.isCoopNightShift()) {
      // Only the server's floor-cleared / run-ended for THIS floor drives the co-op report (never a stale one).
      const floor = this.multiplayer?.currentStatus.run.floor;
      const summary = this.lastNightShiftSummary;
      if (summary && summary.floor === floor) this.report.show(stats, summary, this.coopReportState());
      return;
    }
    if (this.mode === 'night-shift' && this.runLayout && stats.outcome === 'win') {
      if (!this.floorScored) {
        this.floorScored = true;
        const floor = Math.max(1, this.runLayout.floor | 0);
        const scored = scoreFloor(stats, floor);
        this.updateScoreHud();
        // Mirror onNextFloor: ClientRun.localEscape (advanceFloor) when a run exists, else seed-only advance.
        const run = getRunState();
        const next = run
          ? { seed: runNextFloorSeed(run.seed, run.floor + 1), floor: run.floor + 1 }
          : nextFloorSeed({ seed: this.runLayout.seed, floor: this.runLayout.floor });
        const nextTwist = generateRun(next.seed, next.floor).twist;
        this.lastNightShiftSummary = {
          floor,
          points: scored.points,
          total: scored.total,
          multiplier: scored.multiplier,
          best: getBest(),
          nextTwist: {
            label: nextTwist.label,
            flavor: twistFlavor(nextTwist.id),
          },
        };
      }
      this.report.show(stats, this.lastNightShiftSummary, this.coopReportState());
    } else {
      this.report.show(stats, this.lastNightShiftSummary, this.coopReportState());
    }
  }

  private coopReportState(): CoopReportState | undefined {
    if (!this.multiplayer) return undefined;
    return {
      localRole: this.multiplayer.currentStatus.localRole,
      players: this.multiplayer.currentStatus.players,
      partnerLeft: this.rematchPartnerLeft,
    };
  }

  private updateReportStatus(status: RoomStatus): void {
    if (!this.multiplayer || !this.report) return;
    this.report.updateCoopStatus({
      localRole: status.localRole,
      players: status.players,
      partnerLeft: this.rematchPartnerLeft,
    });
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
      ...(this.runLayout ? { seed: this.runLayout.seed } : {}),
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
    escapeReplay.reset();
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
    this.floorScored = false;
    this.lastNightShiftSummary = undefined;
    this.lastStage = 'infiltrate';
    this.audio.stopAlarm();
    this.report?.hide();
  }
}
