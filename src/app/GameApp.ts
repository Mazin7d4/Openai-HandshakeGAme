import { cordState } from '../gameplay/Tether.ts';
import { Vector3, type Engine, type Scene } from '@babylonjs/core';
import { AssetLoader } from '../assets/AssetLoader.ts';
import { audio as audioHub } from '../audio/AudioManager.ts';
import { CinematicCamera } from '../camera/CinematicCamera.ts';
import { BotControlSource } from '../control/BotControlSource.ts';
import type { DroneControlSource } from '../control/DroneControlSource.ts';
import { HumanControlSource } from '../control/HumanControlSource.ts';
import { RemoteControlSource } from '../control/RemoteControlSource.ts';
import { Autopilot } from '../dev/Autopilot.ts';
import { DevOrbitCamera } from '../dev/DevOrbitCamera.ts';
import { DevReadout } from '../dev/DevReadout.ts';
import { reportStabilityIssue, StabilityDiagnostics } from '../dev/StabilityDiagnostics.ts';
import { TETHER_TUNING, Tether } from '../gameplay/Tether.ts';
import { GameplayWorld } from '../gameplay/GameplayWorld.ts';
import { gameEvents } from '../gameplay/GameEvents.ts';
import { Juice } from '../gameplay/Juice.ts';
import { TetherMoves, type YankKind } from '../gameplay/TetherMoves.ts';
import { PingEmote } from '../gameplay/PingEmote.ts';
import { zeroFlightAxes } from '../input/FlightAxes.ts';
import { PLAYER_ONE_KEYS } from '../input/KeyboardInput.ts';
import { MultiplayerSession } from '../network/MultiplayerSession.ts';
import type { DroneRole, EmoteId } from '../network/NetworkTypes.ts';
import { getRunState } from '../run/ClientRun.ts';
import { Drone, DRONE_PALETTES } from '../player/Drone.ts';
import { DRONE_MODEL_URL } from '../player/DroneVisual.ts';
import type { PlayerSnapshot } from '../player/PlayerState.ts';
import { enableHavok } from '../physics/enableHavok.ts';
import { createEngine, createScene } from '../scene/createScene.ts';
import { AccessibilityFeedback } from '../ui/AccessibilityFeedback.ts';
import { GameHud } from '../ui/GameHud.ts';
import { OnboardingCoach } from '../ui/OnboardingCoach.ts';
import { effectiveReducedMotion, getSettings, saveSettings } from '../ui/Settings.ts';
import { generateRun, type RunLayout } from '../seed/index.ts';
import { getRunInfo } from '../net/runInfo.ts';
import { TouchControls } from '../ui/TouchControls.ts';
import { isTouchPlayDevice } from '../ui/touchDetect.ts';
import { byInput } from '../ui/inputHints.ts';
import type { GameMode } from './GameMode.ts';

export interface GameAppOptions {
  canvas: HTMLCanvasElement;
  createLevel: (scene: Scene) => Vector3 | Promise<Vector3>;
  uiParent?: HTMLElement;
  devParent?: HTMLElement;
  mode?: GameMode;
  multiplayer?: MultiplayerSession;
  onLeaveGame?: () => void;
  /** Optional override; default is getRunInfo() → getRunSeed() stub (Netcode swaps later). */
  runSeed?: { seed: number; floor: number };
}

interface LocalPlayer {
  role: DroneRole;
  drone: Drone;
  control: DroneControlSource;
}

/**
 * Shared two-drone session. Control sources decide whether each pawn is driven
 * by local human actions, a replicated remote pose, or the future bot seam.
 */
export class GameApp {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly assets: AssetLoader;
  readonly players: readonly LocalPlayer[];
  readonly drones: readonly Drone[];
  readonly tether: Tether;
  readonly cameraRig: CinematicCamera;
  readonly mode: GameMode;
  readonly gameplay: GameplayWorld;

  private readonly devReadout: DevReadout | null;
  private readonly devOrbit: DevOrbitCamera | null;
  private readonly multiplayer: MultiplayerSession | null;
  private readonly removeNetworkStatus: (() => void) | null;
  private readonly snapshots: PlayerSnapshot[] = [];
  private readonly hud: GameHud | null;
  private readonly a11y: AccessibilityFeedback | null;
  private readonly coach: OnboardingCoach | null;
  private touch: TouchControls | null = null;
  private readonly pingEmote: PingEmote;
  private readonly diagnostics = new StabilityDiagnostics();
  private readonly idleAxes = zeroFlightAxes();
  /** TEST-ONLY (?autotest): position-targeted steering for deterministic verifiers. */
  private readonly autopilot = Autopilot.enabled ? new Autopilot() : null;
  private paused = false;
  /** Clothesline payoff: brief slow-motion beat (scales gameplay dt and the physics step). */
  private slowMo = 0;
  private hitStop = 0;
  private timeScale = 1;
  private readonly juice: Juice;
  private readonly moves: TetherMoves;
  private readonly unsubscribers: (() => void)[] = [];
  private hintTimer = 0;
  private yankRequested = false;
  private disposed = false;
  private activeDevRole: DroneRole = 'pix';
  readonly runLayout: RunLayout | null;
  private readonly touchPlay = isTouchPlayDevice();
  private readonly onResize = () => {
    this.engine.resize();
  };
  /** DEV ONLY: F2 toggles the orbit inspection camera. Gameplay keeps the cinematic rig. */
  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.code !== 'F2' || !this.devOrbit) {
      return;
    }
    event.preventDefault();
    if (this.devOrbit.isActive) {
      this.devOrbit.deactivate(this.cameraRig.camera);
    } else {
      this.devOrbit.activate();
    }
  };

  private constructor(
    engine: Engine,
    scene: Scene,
    assets: AssetLoader,
    players: LocalPlayer[],
    tether: Tether,
    cameraRig: CinematicCamera,
    devReadout: DevReadout | null,
    devOrbit: DevOrbitCamera | null,
    mode: GameMode,
    multiplayer: MultiplayerSession | null,
    gameplay: GameplayWorld,
    hudParent: HTMLElement | undefined,
    onLeaveGame: (() => void) | undefined,
    runLayout: RunLayout | null = null,
  ) {
    this.engine = engine;
    this.scene = scene;
    {
      const physicsScene = scene as unknown as { _advancePhysicsEngineStep?: (step: number) => void };
      const step = physicsScene._advancePhysicsEngineStep?.bind(scene);
      if (step) physicsScene._advancePhysicsEngineStep = (ms: number) => step(ms * this.timeScale);
    }
    this.assets = assets;
    this.players = players;
    this.drones = players.map((p) => p.drone);
    this.tether = tether;
    this.cameraRig = cameraRig;
    this.devReadout = devReadout;
    this.devOrbit = devOrbit;
    this.mode = mode;
    this.multiplayer = multiplayer;
    this.gameplay = gameplay;
    this.runLayout = runLayout;
    this.pingEmote = new PingEmote(
      scene,
      cameraRig.camera.getEngine().getRenderingCanvas() as HTMLCanvasElement,
      hudParent ?? cameraRig.camera.getEngine().getRenderingCanvas()?.parentElement ?? document.body,
      cameraRig.camera,
      this.drones,
      multiplayer,
      () => this.hudRole(),
    );
    this.hud = hudParent
      ? new GameHud(hudParent, {
          onResume: () => this.setPaused(false),
          onLeave: () => onLeaveGame?.(),
          // QualityManager (scene/Quality.ts) listens to this setting; AUTO re-enables the governor.
          onGraphicsQuality: (quality) => { saveSettings({ graphicsQuality: quality }); },
          onInteract: () => this.triggerHudAction('interact'),
          onGrabDrop: () => this.triggerHudAction('grabDrop'),
          onThrow: () => this.triggerHudAction('throwObject'),
          onYank: () => { this.yankRequested = true; },
          onReplayTutorial: () => this.coach?.begin(),
          runSeed: runLayout?.seed ?? null,
        })
      : null;
    this.a11y = hudParent ? new AccessibilityFeedback(hudParent) : null;
    this.coach = hudParent ? new OnboardingCoach(hudParent, mode === 'night-shift' ? 'singleplayer' : mode) : null;
    this.hud?.setControlsCardSuppressed(this.coach?.isActive === true);
    if (hudParent && this.touchPlay) {
      hudParent.classList.add('touch-play');
      this.bindTouchControls(hudParent);
    }
    this.juice = new Juice(scene);
    const audio = gameplay.sfx;
    if (multiplayer) {
      this.unsubscribers.push(multiplayer.onObjectEvent((event) => {
        if (event.event === 'handoff') audioHub.play('pass');
      }));
    }
    this.moves = new TetherMoves(
      audio,
      cameraRig,
      this.juice,
      multiplayer,
      (text, tone) => this.hud?.toast(text, tone),
      () => gameplay.recordTetherSave(),
    );
    const isLocalDrone = (id: string) => {
      const role = this.hudRole();
      return this.players.find((p) => p.role === role)?.drone.id === id;
    };
    this.unsubscribers.push(
      gameEvents.on('impact', (e) => {
        this.juice.burst('impact', e.position, 6 + Math.min(16, e.strength * 1.4));
        audio.impact(Math.min(1, e.strength / 12), e.position);
        if (isLocalDrone(e.droneId)) this.cameraRig.addShake(Math.min(0.4, e.strength * 0.03));
      }),
      gameEvents.on('boost', (e) => {
        if (!isLocalDrone(e.droneId)) return;
        audio.boostStart();
        this.cameraRig.kickFov(0.045);
      }),
      gameEvents.on('knockback', (e) => {
        this.juice.burst('impact', e.position, 12);
        if (isLocalDrone(e.droneId)) {
          this.cameraRig.addShake(0.35);
          this.hud?.toast(
            byInput({
              keyboard: 'Yank [R] to rescue!',
              touch: 'Tap Yank to rescue!',
              gamepad: 'Yank to rescue!',
            }),
            'good',
          );
        }
      }),
      gameEvents.on('toast', (e) => this.hud?.toast(e.text, e.tone)),
      gameEvents.on('camera-blind', (e) => {
        this.juice.burst('impact', e.position, 16);
        audio.bump();
        this.hud?.toast('Camera blinded!', 'good');
      }),
      gameEvents.on('capture', (e) => {
        const mine = isLocalDrone(e.droneId);
        const name = this.players.find((p) => p.drone.id === e.droneId)?.role === 'nee' ? 'NEE' : 'PIX';
        if (e.freed) {
          this.juice.burst('yank', e.position, 18);
          audio.bump();
          this.hud?.toast(mine ? 'Free!' : `${name} is free!`, 'good');
          for (const drone of this.drones) drone.react('proud', 1);
        } else {
          this.juice.burst('impact', e.position, 12);
          audio.clothesline();
          if (mine) this.cameraRig.addShake(0.3);
          this.hud?.toast(
            mine
              ? byInput({
                  keyboard: 'Grabbed! Mash [Shift] or wait for a yank',
                  touch: 'Grabbed! Mash Jump or wait for a yank',
                  gamepad: 'Grabbed! Mash boost or wait for a yank',
                })
              : byInput({
                  keyboard: `${name} got grabbed! Yank [R]`,
                  touch: `${name} got grabbed! Tap Yank`,
                  gamepad: `${name} got grabbed! Yank them free`,
                }),
            'good',
          );
        }
      }),
      gameEvents.on('warmup', (e) => {
        if (e.kind === 'hoop') {
          this.juice.burst('confetti', e.position, 60);
          audio.clothesline();
          this.cameraRig.addShake(0.25);
          for (const drone of this.drones) drone.react('proud', 1.4);
        } else if (e.count === 1 || e.count === 2) {
          this.juice.burst('confetti', e.position, 18);
          audio.bump();
          audioHub.play('snap', { intensity: 0.6, position: e.position });
          this.cameraRig.addShake(0.12);
          for (const drone of this.drones) {
            drone.react(drone.role === 'pix' ? 'proud' : 'shocked', drone.role === 'pix' ? 1.2 : 1.0);
          }
        } else {
          this.juice.burst('impact', e.position, 5);
          audio.bump();
          if (e.count <= 3) for (const drone of this.drones) drone.react('shocked', 0.8);
        }
      }),
      gameEvents.on('cord-knock', (e) => {
        this.juice.burst('impact', e.position, 7);
        audio.bump();
      }),
      gameEvents.on('clothesline', (e) => {
        this.juice.burst('zap', e.position, 34);
        this.juice.burst('confetti', e.position, 40);
        audio.clothesline();
        this.cameraRig.addShake(0.45);
        this.cameraRig.kickFov(0.1);
        this.slowMo = 0.45;
        for (const drone of this.drones) drone.react('proud', 1.6);
        this.hud?.toast('Clotheslined!', 'good');
      }),
      gameEvents.on('heist', (e) => {
        const pos = e.position;
        switch (e.beat) {
          case 'vault':
            this.juice.burst('zap', pos, 40);
            audioHub.play('vaultOpen', { position: pos });
            this.cameraRig.beat(pos, 2.4);
            this.cameraRig.addShake(0.12);
            for (const drone of this.drones) drone.react('happy', 2);
            this.hud?.toast('Vault open. Meet P01', 'good');
            break;
          case 'pickup':
            this.juice.burst('zap', pos, 60);
            this.juice.burst('pix', pos, 25);
            this.juice.burst('nee', pos, 25);
            this.cameraRig.addShake(0.6);
            this.cameraRig.kickFov(0.08);
            this.cameraRig.beat(pos, 1.4);
            for (const p of this.players) {
              if (e.role != null && p.role === e.role) {
                p.drone.react('proud', 2.5);
              } else {
                p.drone.react('panic', 2);
              }
            }
            this.hud?.toast('We got it!', 'good');
            setTimeout(() => { if (!this.disposed) this.hud?.toast('Alarm! Security drones online', 'good'); }, 900);
            break;
          case 'extract':
            this.juice.burst('confetti', pos, 120);
            setTimeout(() => { if (!this.disposed) this.juice.burst('confetti', pos.add(new Vector3(0, 2, 0)), 120); }, 250);
            setTimeout(() => { if (!this.disposed) this.juice.burst('confetti', pos.add(new Vector3(0, 4, 0)), 120); }, 500);
            this.juice.burst('pix', pos, 40);
            this.juice.burst('nee', pos, 40);
            for (const drone of this.drones) drone.react('proud', 6);
            this.cameraRig.addShake(0.3);
            break;
        }
      }),
      gameEvents.on('yank', (e) => {
        if (e.from !== this.hudRole()) return;
        const reducedMotion = effectiveReducedMotion(getSettings());
        if (e.kind === 'yank') {
          if (!reducedMotion) this.hitStop = 0.07;
          this.cameraRig.kickFov(0.06);
          this.cameraRig.addShake(0.15);
          audioHub.play('twang', { intensity: e.strength, position: e.position });
        } else if (e.kind === 'sling') {
          if (!reducedMotion) this.hitStop = 0.04;
          this.cameraRig.kickFov(0.08);
          audioHub.play('twang', { intensity: 1, position: e.position });
        }
        if (e.rescue) {
          this.juice.burst('yank', e.position, 10);
        }
      }),
    );
    if (multiplayer) {
      this.unsubscribers.push(multiplayer.onTetherYanked((message) => {
        const role = multiplayer.currentStatus.localRole;
        const local = this.players.find((p) => p.role === role)?.drone;
        if (local) {
          this.moves.receive(message, local, true);
          if (message.kind === 'yank') {
            audioHub.play('twang', { intensity: message.strength, position: local.position });
            if (!effectiveReducedMotion(getSettings())) this.hitStop = 0.05;
          }
        }
      }));
    }
    this.removeNetworkStatus = multiplayer
      ? multiplayer.onStatus((status) => {
          for (const player of this.players) {
            if (player.control instanceof RemoteControlSource) {
              const remote = status.players.get(player.role);
              if (remote) {
                player.control.push(remote);
              }
            }
          }
          this.gameplay.sync(status);
        })
      : null;
  }

  static async create(options: GameAppOptions): Promise<GameApp> {
    const engine = createEngine(options.canvas);
    const scene = createScene(engine);
    const plugin = await enableHavok(scene);
    const levelSpawn = await options.createLevel(scene);
    const mode = options.mode ?? 'dev-local';
    const multiplayer = options.multiplayer ?? null;
    // Solo + Night Shift share generateRun; multiplayer waits on server applySeedFloor (prod-net sync).
    // Story/solo/co-op keep the handcrafted level; only Night Shift remixes (until Netcode syncs room seeds).
    // UI reads seed/floor through getRunInfo() so Netcode can swap the source without HUD changes.
    const runSeed = mode === 'night-shift' ? options.runSeed ?? getRunInfo() : null;
    const runLayout = runSeed ? generateRun(runSeed.seed, runSeed.floor) : null;
    // TEST-ONLY: ?autotest&stage=escape starts local modes in the alarm escape, beside the heavy crate.
    const escapeStage = Autopilot.enabled && mode !== 'multiplayer'
      && new URLSearchParams(window.location.search).get('stage') === 'escape';
    const layoutSpawn = runLayout
      ? new Vector3(runLayout.spawn.x, runLayout.spawn.y, runLayout.spawn.z)
      : levelSpawn;
    const spawn = escapeStage ? new Vector3(-7, 4.5, 13) : layoutSpawn;
    const assets = new AssetLoader(scene);
    const localRole = multiplayer?.currentStatus.localRole ?? null;
    if (mode === 'multiplayer' && (!multiplayer || !localRole)) {
      throw new Error('Multiplayer mode requires a joined room and assigned role.');
    }

    // One GLB instance per player so accent materials can differ.
    const [modelOne, modelTwo] = await Promise.all([
      assets.loadModel(DRONE_MODEL_URL),
      assets.loadModel(DRONE_MODEL_URL),
    ]);

    // Late-bound refs so the single-player companion can perceive drones/camera created below.
    const live: { drones?: Drone[]; camera?: CinematicCamera; gameplay?: GameplayWorld } = {};
    const companionModes: GameMode[] = ['singleplayer', 'night-shift'];
    const controlFor = (role: DroneRole): DroneControlSource => {
      if (mode === 'multiplayer') {
        return role === localRole
          ? new HumanControlSource(PLAYER_ONE_KEYS)
          : new RemoteControlSource();
      }
      if (companionModes.includes(mode)) {
        return role === 'pix'
          ? new HumanControlSource(PLAYER_ONE_KEYS)
          : new BotControlSource({
            self: () => live.drones?.[1]?.position ?? null,
            leader: () => live.drones?.[0]?.position ?? null,
            basis: () => live.camera!.getPlanarBasis(),
            busy: () => live.gameplay?.isRoleHacking('nee') ?? false,
            leaderHacking: () => live.gameplay?.isRoleHacking('pix') ?? false,
            leaderHauling: () => live.gameplay?.isRoleHaulingHeavy('pix') ?? false,
            leaderVelocity: () => live.drones?.[0]?.velocity ?? null,
            leaderInTrouble: () => live.drones?.[0]?.inTrouble ?? false,
            leaderCaptured: () => live.drones?.[0]?.isCaptured ?? false,
            objective: () => {
              const leader = live.drones?.[0]?.position;
              return leader ? live.gameplay?.botObjective('nee', leader) ?? null : null;
            },
            work: (dt) => {
              const self = live.drones?.[1]?.position;
              return self ? live.gameplay?.botWork('nee', self, dt) ?? false : false;
            },
            cordPath: () => cordState.path,
            cordStrain: () => cordState.strain,
            zip: (path) => live.drones?.[1]?.startZip(path),
            zipping: () => live.drones?.[1]?.isZipping ?? false,
          });
      }
      return role === 'pix'
        ? new HumanControlSource(PLAYER_ONE_KEYS)
        : new BotControlSource();
    };
    const players: LocalPlayer[] = [
      {
        role: 'pix',
        drone: new Drone(scene, plugin, {
          id: 'player-1',
          spawn: spawn.add(new Vector3(-1.6, 0, 0)),
          palette: DRONE_PALETTES.pix,
          model: modelOne,
        }),
        control: controlFor('pix'),
      },
      {
        role: 'nee',
        drone: new Drone(scene, plugin, {
          id: 'player-2',
          spawn: spawn.add(new Vector3(1.6, 0, 0)),
          palette: DRONE_PALETTES.nee,
          model: modelTwo,
        }),
        control: controlFor('nee'),
      },
    ];
    const drones = players.map((p) => p.drone);
    const tetherTuning = { ...TETHER_TUNING };
    if (runLayout) {
      tetherTuning.restLength = runLayout.cord.restLength;
      tetherTuning.maxLength = runLayout.cord.maxLength;
    }
    const tether = new Tether(scene, drones[0], drones[1], tetherTuning, {
      collarA: DRONE_PALETTES.pix.accent,
      collarB: DRONE_PALETTES.nee.accent,
    });
    const uiParent = options.uiParent ?? options.devParent;
    const gameplay = new GameplayWorld(
      scene, plugin, mode, multiplayer, uiParent, options.onLeaveGame, runLayout,
    );
    if (escapeStage) gameplay.debugStartEscape();

    const cameraRig = new CinematicCamera(scene);
    for (const player of players) {
      if (player.control instanceof HumanControlSource) player.control.attachGamepadCamera(cameraRig);
    }
    cameraRig.snap(drones);
    Object.assign(live, { drones, camera: cameraRig, gameplay });
    scene.activeCamera = cameraRig.camera;
    const devReadout = options.devParent ? new DevReadout(options.devParent, mode) : null;
    const devOrbit = options.devParent ? new DevOrbitCamera(scene, options.canvas) : null;

    return new GameApp(
      engine,
      scene,
      assets,
      players,
      tether,
      cameraRig,
      devReadout,
      devOrbit,
      mode,
      multiplayer,
      gameplay,
      uiParent,
      options.onLeaveGame,
      runLayout,
    );
  }

  start(): void {
    this.autopilot?.install({
      /** Multiplayer agreement checks: rendered + server security state on this client. */
      security: () => this.gameplay.debugSecurity(),
      /** Teleport a drone this client owns (multiplayer: only the local role). */
      teleport: (role: DroneRole, x: number, y: number, z: number) => {
        const player = this.players.find((candidate) => candidate.role === role);
        if (!player || player.control.kind === 'remote') return false;
        player.drone.debugTeleport(x, y, z);
        return true;
      },
      /** Ask the server for a test stage (needs HANDSHAKE_TEST_HOOKS=1 on the server). */
      debugStage: (stage: 'escape') => this.multiplayer?.debugStage(stage),
      /** Propose a clothesline stun to the server (it validates against its own patrol + player positions). */
      requestStun: (index: number, at?: { x: number; y: number; z: number }) => {
        const point = at ?? this.gameplay.debugSecurity().patrols[index];
        if (point) this.multiplayer?.requestPatrolStun({ index, x: point.x, y: point.y, z: point.z });
      },
      /** Force an unexpected disconnect (server holds the seat for the reconnect grace window). */
      dropConnection: () => this.multiplayer?.dropConnectionForTest(),
      connectionState: () => this.multiplayer?.connectionState ?? null,
      partnerConnected: () => {
        const status = this.multiplayer?.currentStatus;
        if (!status?.localRole) return null;
        const partner = status.players.get(status.localRole === 'pix' ? 'nee' : 'pix');
        return partner?.connected ?? false;
      },
      /** Current seed/mode/floor/captures for UI + seed-sync checks. */
      runState: () => getRunState(),
      /** TEST-ONLY Night Shift floor advance (HANDSHAKE_TEST_HOOKS=1). */
      debugRunEscape: () => this.multiplayer?.debugRunEscape(),
      /** TEST-ONLY: force the authoritative room into the results phase. */
      debugRunClear: (stats: { timesSpotted?: number; elapsedSeconds?: number; tetherSaves?: number } = {}) => this.multiplayer?.debugRunClear(stats),
      /** TEST-ONLY Night Shift capture (HANDSHAKE_TEST_HOOKS=1). */
      debugRunCapture: () => this.multiplayer?.debugRunCapture(),
      /** TEST-ONLY: force patrol grab / free (HANDSHAKE_TEST_HOOKS=1). */
      debugForceCapture: (role: DroneRole, index = 0) => this.multiplayer?.debugForceCapture(role, index),
      debugForceRelease: (role: DroneRole, reason = 'yank') => this.multiplayer?.debugForceRelease(role, reason),
      /** TEST-ONLY: freeze autonomous patrol AI grabs/shoves (HANDSHAKE_TEST_HOOKS=1). */
      debugPatrolFreeze: (frozen = true) => this.multiplayer?.debugPatrolFreeze(frozen),
      /** TEST-ONLY: clear patrol stuns (HANDSHAKE_TEST_HOOKS=1). */
      debugClearStuns: () => this.multiplayer?.debugClearStuns(),
      /** Capture snapshot from synced room state. */
      captures: () => this.gameplay.debugSecurity().captures ?? {},
    });
    if (this.autopilot) {
      const test = (window as unknown as { __autotest?: Record<string, unknown> }).__autotest ?? {};
      (window as unknown as { __autotest: Record<string, unknown> }).__autotest = {
        ...test,
        pingEmote: {
          pings: () => this.pingEmote.overlay.pingsSnapshot(),
          emotes: () => this.pingEmote.overlay.emotesSnapshot(),
          ping: () => this.pingEmote.ping(),
          emote: (id: EmoteId) => this.pingEmote.emote(id),
        },
      };
    }
    // QA / debug: expose camera look yaw ("alpha") for Playwright touch-look checks.
    if (new URLSearchParams(window.location.search).has('debug')) {
      (window as unknown as { __pixneeCamera?: { getLookYaw: () => number; getZoom: () => number } }).__pixneeCamera = {
        getLookYaw: () => this.cameraRig.touchLookYaw,
        getZoom: () => this.cameraRig.touchLookZoom,
      };
    }
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);
    this.engine.runRenderLoop(() => {
      this.frame();
    });
    this.engine.resize();
  }

  dispose(): void {
    this.disposed = true;
    this.engine.stopRenderLoop();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown);
    for (const player of this.players) {
      player.control.dispose();
    }
    this.removeNetworkStatus?.();
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.juice.dispose();
    void this.multiplayer?.dispose();
    this.devReadout?.dispose();
    this.devOrbit?.dispose();
    this.cameraRig.dispose();
    this.gameplay.dispose();
    this.pingEmote.dispose();
    this.touch?.dispose();
    this.coach?.dispose();
    this.hud?.dispose();
    this.a11y?.dispose();
    this.diagnostics.dispose();
    this.scene.dispose();
    this.engine.dispose();
  }

  private frame(): void {
    try {
      this.tick();
    } catch (error) {
      reportStabilityIssue('game-loop', 'Frame execution failed; pausing the simulation.', error);
      this.setPaused(true);
    }
  }

  private tick(): void {
    if (this.paused) {
      for (const player of this.players) {
        if (player.control instanceof HumanControlSource && player.control.pollGamepadPause()) {
          this.setPaused(false);
          break;
        }
      }
      return;
    }
    const realDt = Math.min(this.engine.getDeltaTime() / 1000, 0.05);
    this.slowMo = Math.max(0, this.slowMo - realDt);
    this.hitStop = Math.max(0, this.hitStop - realDt);
    this.timeScale = this.hitStop > 0 ? 0.05 : (this.slowMo > 0 ? 0.3 : 1);
    const dt = realDt * this.timeScale;
    const basis = this.cameraRig.getPlanarBasis();
    const faceGameplayCamera = this.devOrbit?.isActive !== true;
    const droneByRole = new Map<DroneRole, Drone>();
    for (const player of this.players) droneByRole.set(player.role, player.drone);

    let switchDrone = false;
    let coachAxes = this.idleAxes;
    let coachActions = null as ReturnType<HumanControlSource['sample']>['interactions'] | null;
    for (const player of this.players) {
      const control = player.control.sample(dt);
      const net = this.multiplayer?.currentStatus.players.get(player.role) ?? null;
      if (control.remoteState) {
        player.drone.applyRemoteState(control.remoteState);
        this.applyNetworkCapture(player.drone, control.remoteState);
      } else if (player.control.kind !== 'remote') {
        // Co-op: server overrides pose while captured; boost still counts as struggle.
        if (net?.captured) {
          this.applyNetworkCapture(player.drone, net);
          const actions = control.actions;
          player.drone.steer(dt, actions, basis, faceGameplayCamera);
        } else {
          if (player.drone.isCaptured) player.drone.setCaptured(null);
          const piloted = this.autopilot?.steer(player.role, player.drone.position, basis) ?? null;
          const actions = this.gameplay.isRoleHacking(player.role)
            ? this.idleAxes
            : piloted ?? control.actions;
          player.drone.steer(dt, actions, basis, faceGameplayCamera);
        }
      }
      if (player.control.kind !== 'remote') {
        const interactions = this.autopilot
          ? this.autopilot.interactions(player.role, control.interactions)
          : control.interactions;
        if (!net?.captured) {
          this.gameplay.handle(player.role, player.drone, interactions);
        }
        const wantsYank = interactions.yank || (this.yankRequested && player.role === this.hudRole());
        if (wantsYank && !net?.captured && !this.gameplay.isRoleHacking(player.role)) this.yank(player);
        if (interactions.pause) {
          if (this.coach?.isActive) this.coach.skip();
          else this.setPaused(true);
        }
        switchDrone ||= control.interactions.switchDrone;
        if (player.role === this.hudRole() && player.control instanceof HumanControlSource) {
          coachAxes = control.actions;
          coachActions = interactions;
        }
      }
    }
    if (coachActions && this.coach?.isActive) {
      this.coach.observe(coachAxes, coachActions);
      this.hud?.setControlsCardSuppressed(true);
    } else if (this.coach && !this.coach.isActive) {
      this.hud?.setControlsCardSuppressed(false);
    }
    this.yankRequested = false;
    this.moves.update(dt);
    this.gameplay.sfx.cordTension(this.tether.currentStrain);
    if (switchDrone && this.mode === 'dev-local') this.switchDevDrone();
    this.gameplay.update(dt, droneByRole, this.tether.currentStrain);
    this.tether.apply(dt, (drone) => {
      const player = this.players.find((candidate) => candidate.drone === drone);
      return player?.control.kind !== 'remote';
    });
    for (const drone of this.drones) {
      drone.commit();
    }

    this.scene.render();

    this.snapshots.length = 0;
    for (const drone of this.drones) {
      drone.postPhysics(dt);
      this.snapshots.push(drone.captureSnapshot());
    }
    if (this.multiplayer) {
      // Server owns captured poses — re-snap after physics so the hold doesn't drift.
      for (const player of this.players) {
        const net = this.multiplayer.currentStatus.players.get(player.role);
        if (net?.captured && player.control.kind !== 'remote') {
          player.drone.debugTeleport(net.position.x, net.position.y, net.position.z);
        }
      }
      const localIndex = this.players.findIndex(
        (player) => player.role === this.multiplayer?.currentStatus.localRole,
      );
      const localSnapshot = this.snapshots[localIndex];
      if (localSnapshot) {
        this.multiplayer.publish(localSnapshot);
      }
      this.gameplay.publish();
    }
    this.tether.updateVisual();
    this.cameraRig.update(dt, this.drones, this.gameplay.cameraContext);
    this.pingEmote.update();
    this.devOrbit?.update(this.drones);
    this.updateAudio();
    this.devReadout?.update(
      this.snapshots,
      this.tether.currentStrain,
      this.gameplay.describe() + this.players.map((p) => p.control instanceof BotControlSource ? ` bot:${p.control.state}/z${p.control.zips}` : '').join(''),
      {
        fps: this.engine.getFps(),
        activeRole: this.mode === 'dev-local'
          ? this.activeDevRole
          : this.multiplayer?.currentStatus.localRole ?? 'pix',
        heldObject: this.gameplay.heldObjectId(
          this.mode === 'dev-local'
            ? this.activeDevRole
            : this.multiplayer?.currentStatus.localRole ?? 'pix',
        ),
        network: this.multiplayer?.connectionState ?? 'local',
        diagnostics: this.diagnostics.summary,
      },
    );
    const hudRole = this.mode === 'dev-local'
      ? this.activeDevRole
      : this.multiplayer?.currentStatus.localRole ?? 'pix';
    const hudPlayer = this.players.find((player) => player.role === hudRole);
    if (hudPlayer) {
      this.hud?.update(
        [...this.gameplay.promptsFor(hudRole, hudPlayer.drone), ...this.tetherPrompts(hudPlayer, dt)],
        this.mode,
        hudRole,
      );
    }
  }

  /** Camera as the audio listener, plus a thruster hum per drone (the partner's is spatialised). */
  private updateAudio(): void {
    const camera = this.scene.activeCamera;
    if (camera) audioHub.setListener(camera.globalPosition, camera.getDirection(Vector3.Right()));
    const local = this.hudRole();
    const dt = Math.max(1e-3, this.engine.getDeltaTime() / 1000);
    for (const player of this.players) {
      // Speed from position change so remote (replicated) drones hum correctly too.
      const p = player.drone.position;
      const last = this.audioLastPos.get(player.role);
      const speed = last ? Math.min(30, Vector3.Distance(p, last) / dt) : 0;
      if (last) last.copyFrom(p); else this.audioLastPos.set(player.role, p.clone());
      audioHub.setDroneMotion(player.role, speed, p, player.role === local);
    }
  }
  private readonly audioLastPos = new Map<DroneRole, Vector3>();

  private hudRole(): DroneRole {
    return this.mode === 'dev-local'
      ? this.activeDevRole
      : this.multiplayer?.currentStatus.localRole ?? 'pix';
  }

  private partnerOf(player: LocalPlayer): LocalPlayer | undefined {
    return this.players.find((candidate) => candidate !== player);
  }

  private partnerAnchored(partner: LocalPlayer): boolean {
    return this.gameplay.isRoleHacking(partner.role);
  }

  private yank(player: LocalPlayer): void {
    const partner = this.partnerOf(player);
    if (!partner) return;
    this.moves.tryYank(
      player.role,
      player.drone,
      partner.drone,
      partner.control.kind !== 'remote',
      this.tether.currentStrain,
      this.partnerAnchored(partner),
    );
  }

  /**
   * Apply server capture: lock pose to the hold point and mark the drone captured
   * so partner yanks read as rescues (same solo feel).
   */
  private applyNetworkCapture(drone: Drone, net: {
    captured: boolean;
    position: { x: number; y: number; z: number };
  }): void {
    if (!net.captured) {
      if (drone.isCaptured) {
        drone.setCaptured(null);
        gameEvents.emit('capture', {
          droneId: drone.id,
          position: drone.position.clone(),
          freed: true,
        });
      }
      return;
    }
    const was = drone.isCaptured;
    drone.debugTeleport(net.position.x, net.position.y, net.position.z);
    // Pull toward the hold so steer() keeps the capture haul feel.
    drone.setCaptured(new Vector3(0, 0, 0));
    if (!was) {
      gameEvents.emit('capture', {
        droneId: drone.id,
        position: drone.position.clone(),
        freed: false,
      });
    }
  }

  /** Contextual tether-move prompts. Only shown when the move is meaningful right now. */
  private tetherPrompts(player: LocalPlayer, dt: number): string[] {
    const net = this.multiplayer?.currentStatus.players.get(player.role);
    if (net?.captured || player.drone.isCaptured) {
      return [byInput({
        keyboard: 'Mash [Shift] to struggle — or wait for a yank',
        touch: 'Mash Jump to struggle — or wait for a yank',
        gamepad: 'Mash boost to struggle — or wait for a yank',
      })];
    }
    const partner = this.partnerOf(player);
    if (!partner || this.gameplay.isRoleHacking(player.role)) return [];
    const name = partner.role.toUpperCase();
    if (this.moves.cooldown(player.role) > 0) return [];
    if (partner.drone.inTrouble || partner.drone.isCaptured) return [`[R] Yank ${name} to safety`];
    const strain = this.tether.currentStrain;
    const kind: YankKind | null = this.moves.preview(player.drone, partner.drone, strain, this.partnerAnchored(partner));
    if (kind === 'sling') return [`[R] Slingshot past ${name}`];
    if (kind === 'yank' && strain > 0.25) {
      this.hintTimer += dt;
      return this.hintTimer < 9 ? [`[R] Yank ${name}`] : [];
    }
    return [];
  }

  private setPaused(paused: boolean): void {
    this.paused = paused;
    if (!paused) this.pingEmote.resetPadEdges();
    this.hud?.setPaused(paused);
    this.touch?.setVisible(!paused);
  }

  private switchDevDrone(): void {
    this.activeDevRole = this.activeDevRole === 'pix' ? 'nee' : 'pix';
    for (const player of this.players) {
      player.control.dispose();
      player.control = player.role === this.activeDevRole
        ? new HumanControlSource(PLAYER_ONE_KEYS)
        : new BotControlSource();
    }
    if (this.touchPlay && this.touch) {
      const human = this.humanControl();
      if (human) this.touch.rebindVirtual(human.enableVirtualControls());
    }
  }

  private humanControl(): HumanControlSource | null {
    const role = this.hudRole();
    const player = this.players.find((candidate) => candidate.role === role);
    return player?.control instanceof HumanControlSource ? player.control : null;
  }

  private bindTouchControls(parent: HTMLElement): void {
    const human = this.humanControl();
    if (!human) return;
    this.touch?.dispose();
    const virtual = human.enableVirtualControls();
    // Look up the live HumanControlSource each tap — drone switch recreates it.
    const live = () => this.humanControl();
    this.touch = new TouchControls(parent, {
      virtual,
      camera: this.cameraRig,
      solo: this.mode !== 'multiplayer',
      onGrab: () => live()?.requestGrabDrop(),
      onYank: () => live()?.requestYank(),
      onInteract: () => live()?.requestInteract(),
      onPause: () => live()?.requestPause(),
      onSwitch: this.mode !== 'multiplayer' ? () => live()?.requestSwitchDrone() : undefined,
      onPing: () => this.pingEmote.ping(),
      onEmote: (id) => this.pingEmote.emote(id),
    });
  }

  private triggerHudAction(action: 'interact' | 'grabDrop' | 'throwObject'): void {
    const role = this.mode === 'dev-local'
      ? this.activeDevRole
      : this.multiplayer?.currentStatus.localRole ?? 'pix';
    const player = this.players.find((candidate) => candidate.role === role);
    if (!player) return;
    this.gameplay.handle(role, player.drone, {
      grabDrop: action === 'grabDrop',
      throwObject: action === 'throwObject',
      interact: action === 'interact',
      pause: false,
      switchDrone: false,
      yank: false,
    });
  }
}
