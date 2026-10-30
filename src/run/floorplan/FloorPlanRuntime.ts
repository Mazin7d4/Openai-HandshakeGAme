import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { Scene } from '@babylonjs/core/scene.js';
import {
  applyObjectiveSnapshot,
  completeFragileCarry,
  createObjectiveState,
  lootLocked,
  objectiveBotAvoidYank,
  objectiveBotTarget,
  serializeObjectiveState,
  stepObjective,
} from '../../../shared/nightshift/objectives.mjs';
import { checkHazardTrips, hazardForceAt, hazardPhase, HazardTripGate } from '../../../shared/nightshift/hazards.mjs';
import type { ObjectivePlan, ObjectiveState, Vec3 } from '../../../shared/nightshift/types.d.ts';
import type { RunLayout } from '../../seed/index.ts';
import type { MultiplayerSession } from '../../network/MultiplayerSession.ts';
import type { DroneRole, RoomStatus } from '../../network/NetworkTypes.ts';
import type { Drone } from '../../player/Drone.ts';
import { Autopilot } from '../../dev/Autopilot.ts';
import { cordState } from '../../gameplay/Tether.ts';
import type { GrabSystem } from '../../gameplay/GrabSystem.ts';
import type { MissionDirector } from '../../gameplay/MissionDirector.ts';
import type { Grabbable } from '../../gameplay/Grabbable.ts';
import { buildRooms, type FloorBuildHandle } from './RoomBuilder.ts';
import { HazardVisuals } from './HazardVisuals.ts';
import { ObjectiveVisuals } from './ObjectiveVisuals.ts';

const MAX_DRONE_SPEED = 28;

function point(value: Vec3): Vector3 {
  return new Vector3(value.x, value.y, value.z);
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export class FloorPlanRuntime {
  private readonly scene: Scene;
  private readonly session: MultiplayerSession | null;
  private readonly grab: GrabSystem;
  private readonly mission: MissionDirector;
  private readonly prototype: Grabbable;
  private layout: RunLayout | null = null;
  private build: FloorBuildHandle | null = null;
  private objectiveVisuals: ObjectiveVisuals | null = null;
  private hazardVisuals: HazardVisuals | null = null;
  private objectiveState: ObjectiveState | null = null;
  private activeObjectivePlan: ObjectivePlan | null = null;
  private phaseIndex = 0;
  private objectiveGate = new HazardTripGate();
  private readonly physicsForce = { ax: 0, ay: 0, az: 0, slip: 0 };
  private readonly previousVelocity = new Map<DroneRole, Vector3>();
  private readonly playerInputs = [
    { role: 'pix' as const, x: 0, y: 0, z: 0, tetherPull: 0 },
    { role: 'nee' as const, x: 0, y: 0, z: 0, tetherPull: 0 },
  ];
  private readonly yanks: DroneRole[] = [];
  private readonly yankCounts = { pix: 0, nee: 0 };
  private elapsed = 0;
  private generation = 0;
  private campaignFinaleShown = false;
  private removeNetworkListeners: (() => void)[] = [];

  constructor(
    scene: Scene,
    session: MultiplayerSession | null,
    grab: GrabSystem,
    mission: MissionDirector,
    prototype: Grabbable,
  ) {
    this.scene = scene;
    this.session = session;
    this.grab = grab;
    this.mission = mission;
    this.prototype = prototype;
    if (session) {
      this.removeNetworkListeners.push(
        session.onObjectiveState((message) => {
          if (!this.layout || message.floor !== this.layout.floor || message.seed !== this.layout.seed || !this.objectiveState) return;
          if (message.phase && this.layout.plan?.phases && message.phase - 1 !== this.phaseIndex) {
            this.phaseIndex = Math.max(0, Math.min(this.layout.plan.phases.length - 1, message.phase - 1));
            this.activeObjectivePlan = this.layout.plan.phases[this.phaseIndex];
            this.objectiveVisuals?.dispose();
            this.objectiveVisuals = new ObjectiveVisuals(this.scene, this.activeObjectivePlan, {
              mesh: this.prototype.mesh, cradle: point(this.layout.loot),
            }, Boolean(this.layout.plan.campaign));
          }
          applyObjectiveSnapshot(this.objectiveState, message.state);
          this.advanceCampaignPhaseIfReady();
          this.presentCampaignPhase();
          this.maybePresentCampaignFinale();
          this.mission.setObjectiveState(this.activeObjectivePlan, this.objectiveState);
        }),
        session.onHazardTrip((message) => this.hazardVisuals?.flash(message.id)),
        session.onObjectiveEvent((message) => {
          if (message.type === 'shatter') this.resetPrototype();
        }),
      );
    }
  }

  applyLayout(run: RunLayout): void {
    this.disposeFloor();
    this.layout = run;
    const plan = run.plan;
    if (!plan) {
      this.mission.setObjectiveState(null, null);
      this.publishDebugHook();
      return;
    }
    this.phaseIndex = 0;
    this.campaignFinaleShown = false;
    this.activeObjectivePlan = plan.phases?.[0] ?? plan.objective;
    this.objectiveState = createObjectiveState(this.activeObjectivePlan);
    this.yankCounts.pix = 0;
    this.yankCounts.nee = 0;
    this.objectiveVisuals = new ObjectiveVisuals(this.scene, this.activeObjectivePlan, {
      mesh: this.prototype.mesh,
      cradle: point(run.loot),
    }, Boolean(plan.campaign));
    this.hazardVisuals = new HazardVisuals(this.scene, plan.hazards);
    this.mission.setObjectiveState(this.activeObjectivePlan, this.objectiveState);
    this.elapsed = 0;
    this.objectiveGate = new HazardTripGate();
    const generation = ++this.generation;
    void buildRooms(this.scene, plan.rooms, plan.job.boss && !plan.campaign).then((handle) => {
      if (generation !== this.generation) {
        handle.dispose();
        return;
      }
      this.build = handle;
      this.publishDebugHook();
    }).catch(() => {
      // Room dressing is presentation-only; the authored level remains playable.
    });
    this.publishDebugHook();
  }

  sync(status: RoomStatus): void {
    if (this.session) this.elapsed = status.mission.elapsedSeconds;
  }

  update(dt: number, drones: ReadonlyMap<DroneRole, Drone>): void {
    const plan = this.layout?.plan;
    const state = this.objectiveState;
    if (!plan || !state) return;
    const delta = Math.max(0, Math.min(0.25, dt));
    this.elapsed += delta;
    for (const input of this.playerInputs) {
      const drone = drones.get(input.role);
      if (drone) this.writePlayer(input, drone, cordState.strain);
    }
    if (!this.session) {
      const pix = drones.get('pix');
      const nee = drones.get('nee');
      if (pix && nee) {
        const events = stepObjective(state, this.activeObjectivePlan ?? plan.objective, {
          dt: delta,
          players: this.playerInputs,
          carrier: this.grab.objectHeldBy('prototype'),
          yanks: this.yanks,
        });
        this.yanks.length = 0;
        for (const event of events) {
          if (event.type === 'shatter') {
            this.resetPrototype();
            this.mission.spotted(event.role ?? 'pix', true);
          }
        }
        this.advanceCampaignPhaseIfReady();
        this.presentCampaignPhase();
        this.maybePresentCampaignFinale();
      }
      const trips = this.objectiveGate.filter(
        checkHazardTrips(plan.hazards, this.elapsed, this.playerInputs, cordState.path as readonly Vec3[]),
        this.elapsed,
      );
      for (const trip of trips) {
        this.mission.spotted(trip.role);
        this.hazardVisuals?.flash(trip.id);
      }
    }
    this.objectiveVisuals?.update(delta, this.objectiveState ?? state, this.playerInputs);
    this.hazardVisuals?.update(this.elapsed, hazardPhase);
    this.mission.setObjectiveState(this.activeObjectivePlan, state);
  }

  applyPhysics(dt: number, drones: ReadonlyMap<DroneRole, Drone>): void {
    const plan = this.layout?.plan;
    if (!plan) return;
    const localRole = this.session?.currentStatus.localRole ?? null;
    for (const role of ['pix', 'nee'] as const) {
      if (this.session && localRole !== role) continue;
      const drone = drones.get(role);
      if (!drone) continue;
      const velocity = drone.velocity;
      const previous = this.previousVelocity.get(role) ?? new Vector3();
      hazardForceAt(plan.hazards, this.elapsed, drone.position.x, drone.position.y, drone.position.z, this.physicsForce);
      velocity.x += this.physicsForce.ax * dt;
      velocity.y += this.physicsForce.ay * dt;
      velocity.z += this.physicsForce.az * dt;
      if (this.physicsForce.slip > 0) {
        velocity.scaleInPlace(1 - this.physicsForce.slip).addInPlace(previous.scale(this.physicsForce.slip));
      }
      const speed = velocity.length();
      if (speed > MAX_DRONE_SPEED) velocity.scaleInPlace(MAX_DRONE_SPEED / speed);
      previous.copyFrom(velocity);
      this.previousVelocity.set(role, previous);
    }
  }

  notifyYank(role: DroneRole): void {
    this.yankCounts[role] += 1;
    if (!this.session) this.yanks.push(role);
  }

  canGrabPrototype(): boolean {
    return !this.layout?.plan || !this.objectiveState || !lootLocked(this.objectiveState, this.activeObjectivePlan ?? this.layout.plan.objective);
  }

  botObjective(role: DroneRole, leader: Vector3): Vector3 | null {
    const plan = this.layout?.plan;
    const state = this.objectiveState;
    if (!plan || !state || (this.mission.stage !== 'hack-security' && this.mission.stage !== 'steal-prototype')) return null;
    const target = objectiveBotTarget(state, this.activeObjectivePlan ?? plan.objective, role, [{
      role: role === 'pix' ? 'nee' : 'pix',
      position: leader,
      x: leader.x,
      y: leader.y,
      z: leader.z,
      tetherPull: 0,
    }]);
    if (!target) return null;
    const leaderNear = Math.hypot(leader.x - target.x, leader.y - target.y, leader.z - target.z) < 7;
    if (this.mission.stage === 'steal-prototype' || leaderNear) return new Vector3(target.x, Math.max(1.6, target.y), target.z);
    return null;
  }

  botAvoidYank(): boolean {
    const plan = this.layout?.plan;
    const state = this.objectiveState;
    return !!plan && !!state && ((this.activeObjectivePlan?.kind ?? plan.objective.kind) === 'fragile' || objectiveBotAvoidYank(
      state,
      this.activeObjectivePlan ?? plan.objective,
      this.grab.objectHeldBy('prototype'),
    ));
  }

  get state(): ObjectiveState | null { return this.objectiveState; }
  get phase(): number { return this.phaseIndex; }
  get plan() { return this.layout?.plan ?? null; }

  /** Mark an authored fragile carry complete once the mission extraction check passes. */
  completeAtExtraction(): void {
    const plan = this.activeObjectivePlan ?? this.layout?.plan?.objective;
    if (!plan || !this.objectiveState) return;
    if (completeFragileCarry(this.objectiveState, plan)) this.maybePresentCampaignFinale();
  }

  dispose(): void {
    this.disposeFloor();
    for (const remove of this.removeNetworkListeners) remove();
    this.removeNetworkListeners = [];
    const hook = window as unknown as { __floorPlan?: unknown };
    if (hook.__floorPlan) delete hook.__floorPlan;
  }

  private writePlayer(target: typeof this.playerInputs[number], drone: Drone, tetherPull: number): void {
    target.x = drone.position.x;
    target.y = drone.position.y;
    target.z = drone.position.z;
    target.tetherPull = tetherPull;
  }

  private resetPrototype(): void {
    const loot = this.layout?.loot;
    if (loot) this.grab.resetToCradle('prototype', point(loot));
  }

  private disposeFloor(): void {
    this.generation += 1;
    this.build?.dispose();
    this.build = null;
    this.objectiveVisuals?.dispose();
    this.hazardVisuals?.dispose();
    this.objectiveVisuals = null;
    this.hazardVisuals = null;
    this.objectiveState = null;
    this.activeObjectivePlan = null;
    this.phaseIndex = 0;
    this.campaignFinaleShown = false;
    this.previousVelocity.clear();
  }

  private publishDebugHook(): void {
    if (!Autopilot.enabled || !this.layout?.plan) return;
    const plan = this.layout.plan;
    const hook = window as unknown as {
      __floorPlan?: {
        seed: number;
        floor: number;
        job: string;
        objectiveKind: string;
        phase: number;
        phases: number;
        objective: () => unknown;
        hazards: string[];
        rooms: string[];
        drawCalls: number;
        bodies: number;
        planHash: string;
        yanks: () => { pix: number; nee: number };
        complete: (stars?: unknown) => void;
      };
    };
    hook.__floorPlan = {
      seed: this.layout.seed,
      floor: this.layout.floor,
      job: plan.job.name,
      objectiveKind: this.activeObjectivePlan?.kind ?? plan.objective.kind,
      phase: this.phaseIndex,
      phases: plan.phases?.length ?? 1,
      objective: () => this.objectiveState ? serializeObjectiveState(this.objectiveState) : null,
      hazards: plan.hazards.map((hazard) => hazard.kind),
      rooms: plan.rooms.map((room) => room.archetype),
      drawCalls: (this.build?.drawCalls ?? 0) + (this.objectiveVisuals?.drawCalls ?? 0) + (this.hazardVisuals?.drawCalls ?? 0),
      bodies: this.build?.bodies ?? 0,
      planHash: stableHash(JSON.stringify(plan)),
      yanks: () => ({ ...this.yankCounts }),
      complete: () => { if (this.objectiveState) { this.objectiveState.done = true; this.objectiveState.progress = 1; } },
    };
    if (plan.campaign) {
      const campaign = hook as unknown as { __campaign?: unknown };
      campaign.__campaign = {
        levelId: plan.campaign.levelId,
        phase: this.phaseIndex + 1,
        phases: plan.phases?.length ?? 1,
        objective: () => this.objectiveState ? serializeObjectiveState(this.objectiveState) : null,
        stars: () => ({ time: false, loot: this.objectiveState?.shatters === 0, noAlarm: true, count: this.objectiveState?.shatters === 0 ? 1 : 0 }),
        complete: () => { if (this.objectiveState) { this.objectiveState.done = true; this.objectiveState.progress = 1; } },
      };
    }
  }

  private advanceCampaignPhaseIfReady(): void {
    const plan = this.layout?.plan;
    if (!plan?.phases || !this.objectiveState?.done || this.phaseIndex >= plan.phases.length - 1) return;
    this.phaseIndex += 1;
    this.activeObjectivePlan = plan.phases[this.phaseIndex];
    this.objectiveState = createObjectiveState(this.activeObjectivePlan);
    this.objectiveVisuals?.dispose();
    this.objectiveVisuals = new ObjectiveVisuals(this.scene, this.activeObjectivePlan, {
      mesh: this.prototype.mesh,
      cradle: point(this.layout!.loot),
    }, Boolean(plan.campaign));
    this.mission.setObjectiveState(this.activeObjectivePlan, this.objectiveState);
    this.publishDebugHook();
  }

  private presentCampaignPhase(): void {
    const campaign = this.layout?.plan?.campaign;
    if (!campaign || campaign.index !== 5 || !this.layout?.plan?.phases?.length) return;
    if (this.phaseIndex !== this.layout.plan.phases.length - 1) return;
    this.mission.campaignFinale();
  }

  private maybePresentCampaignFinale(): void {
    const plan = this.layout?.plan;
    if (!plan?.campaign || !plan.phases?.length || this.phaseIndex !== plan.phases.length - 1 || !this.objectiveState?.done) return;
    if (this.campaignFinaleShown) return;
    this.campaignFinaleShown = true;
    this.mission.campaignFinale();
  }
}
