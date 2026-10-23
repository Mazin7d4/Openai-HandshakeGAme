import {
  Color3,
  CreateBox,
  CreateCylinder,
  CreatePlane,
  CreateTorus,
  DynamicTexture,
  Mesh,
  PBRMaterial,
  PhysicsAggregate,
  PhysicsShapeType,
  StandardMaterial,
  Vector3,
  type Scene,
} from '@babylonjs/core';
import type { DroneRole } from '../network/NetworkTypes.ts';
import type { Drone } from '../player/Drone.ts';
import { COLLISION_GROUP } from '../physics/CollisionGroups.ts';
import { cordState } from '../gameplay/Tether.ts';
import { gameEvents } from '../gameplay/GameEvents.ts';
import { byInput } from '../ui/inputHints.ts';

/**
 * Delivery-apron warm-up: teach the cord by doing, in the first minute.
 *  - A tower of desk-toy cups sits right in the flight line to the entrance: a
 *    swept or taut cord (or a clumsy drone) topples it. First laugh.
 *  - A slingshot hoop: fly through it on a yank / slingshot launch.
 *  - Yank your partner once.
 * None of it gates progress. Cups are local cosmetic physics (each client sees
 * its own topple from the same replicated drone and cord positions).
 */
const TOWER_ORIGINS = [new Vector3(0.6, 0, -57.4), new Vector3(-4.6, 0, -58.6)];
const CUP = 0.62;
/** Cups stand on a side table so the stack sits in the drones' hover band. */
const TABLE_H = 1.35;
const HOOP = new Vector3(7.5, 4.2, -59.2);
const HOOP_RADIUS = 1.75;

interface Cup { mesh: Mesh; body: PhysicsAggregate; rest: Vector3; toppled: boolean; cooldown: number; tower: number; row: number }

export interface WarmupState { toppled: boolean; hoop: boolean; yank: boolean }

export class CordPlayground {
  readonly state: WarmupState = { toppled: false, hoop: false, yank: false };
  cupsToppled = 0;
  private readonly cups: Cup[] = [];
  private readonly lastSide = new Map<DroneRole, number>();
  private hintCooldown = 0;
  private readonly offYank: () => void;
  private readonly meshes: Mesh[] = [];
  private readonly statics: PhysicsAggregate[] = [];
  private readonly hoopMat: StandardMaterial;
  private hoopFlash = 0;
  private readonly push = new Vector3();
  private readonly closest = new Vector3();

  constructor(scene: Scene) {
    const colors = ['#F26B5B', '#FFD27A', '#7CC6E8', '#9ED9A0', '#F7F3EA', '#C9A2F2'].map((c) => Color3.FromHexString(c));
    const mats = colors.map((c, i) => {
      const m = new PBRMaterial(`toy-cup-${i}`, scene);
      m.albedoColor = c; m.metallic = 0; m.roughness = 0.55;
      return m;
    });
    let n = 0;
    const tableMat = new PBRMaterial('toy-table', scene);
    tableMat.albedoColor = Color3.FromHexString('#C9A27A'); tableMat.metallic = 0; tableMat.roughness = 0.7;
    TOWER_ORIGINS.forEach((origin, tower) => {
      const table = CreateBox(`toy-table-${tower}`, { width: 2.5, height: TABLE_H, depth: 1.1 }, scene);
      table.position.set(origin.x, TABLE_H / 2, origin.z);
      table.material = tableMat;
      this.meshes.push(table);
      this.statics.push(new PhysicsAggregate(table, PhysicsShapeType.BOX, { mass: 0, friction: 0.7 }, scene));
      // 3-2-1 pyramid of cups.
      for (let row = 0; row < 3; row++) {
        for (let i = 0; i < 3 - row; i++) {
          const x = origin.x + (i - (2 - row) / 2) * (CUP + 0.04);
          const y = TABLE_H + CUP * 0.575 + row * (CUP * 1.15 + 0.01);
          const mesh = CreateCylinder(`toy-cup-${n}`, { height: CUP * 1.15, diameterTop: CUP, diameterBottom: CUP * 0.78, tessellation: 14 }, scene);
          mesh.position.set(x, y, origin.z);
          mesh.material = mats[n % mats.length];
          const body = new PhysicsAggregate(mesh, PhysicsShapeType.CYLINDER, { mass: 0.12, friction: 0.6, restitution: 0.25 }, scene);
          body.shape.filterMembershipMask = COLLISION_GROUP.grabbable;
          body.shape.filterCollideMask = COLLISION_GROUP.all;
          body.body.setLinearDamping(0.2);
          body.body.setAngularDamping(0.4);
          this.cups.push({ mesh, body, rest: mesh.position.clone(), toppled: false, cooldown: 0, tower, row });
          n++;
        }
      }
      this.meshes.push(label(scene, 'Desk toys', 'Please do not touch', origin.add(new Vector3(0, TABLE_H * 0.55, -0.56)), 1.5));
    });
    const hoop = CreateTorus('slingshot-hoop', { diameter: HOOP_RADIUS * 2, thickness: 0.2, tessellation: 48 }, scene);
    hoop.position.copyFrom(HOOP); hoop.rotation.x = Math.PI / 2; hoop.isPickable = false;
    this.hoopMat = new StandardMaterial('slingshot-hoop-mat', scene);
    this.hoopMat.emissiveColor = Color3.FromHexString('#FFB020'); this.hoopMat.diffuseColor = Color3.FromHexString('#FF8A3D');
    hoop.material = this.hoopMat;
    const postHeight = HOOP.y - HOOP_RADIUS;
    const postMidY = postHeight / 2;
    const post = CreateBox('slingshot-hoop-post', { width: 0.18, height: postHeight, depth: 0.18 }, scene);
    post.position.set(HOOP.x, postMidY, HOOP.z); post.material = this.hoopMat; post.isPickable = false;
    const sign = label(scene, 'Slingshot hoop', 'Stretch the cord, then yank', new Vector3(HOOP.x, postMidY, HOOP.z - 0.135), 1.6);
    const plate = CreateBox('slingshot-hoop-plate', { width: 1.7, height: 0.6, depth: 0.05 }, scene);
    plate.position.set(HOOP.x, postMidY, HOOP.z - 0.095);
    plate.isPickable = false;
    const plateMat = new StandardMaterial('slingshot-hoop-plate-mat', scene);
    plateMat.diffuseColor = Color3.FromHexString('#1E2A2B');
    plate.material = plateMat;
    this.meshes.push(hoop, post, plate, sign);
    (globalThis as { __playground?: CordPlayground }).__playground = this; // test/debug probe
    this.offYank = gameEvents.on('yank', (e) => {
      if (e.kind === 'yank' && !this.state.yank && e.position.z < -52) { this.state.yank = true; this.progress('yank'); }
    });
  }

  update(dt: number, drones: ReadonlyMap<DroneRole, Drone>): void {
    this.hintCooldown = Math.max(0, this.hintCooldown - dt);
    this.hoopFlash = Math.max(0, this.hoopFlash - dt);
    const glow = 0.55 + 0.45 * Math.sin(performance.now() / 260) * (this.state.hoop ? 0.2 : 1);
    this.hoopMat.emissiveColor.set(1 * glow + this.hoopFlash, 0.69 * glow + this.hoopFlash * 0.3, 0.12 * glow + this.hoopFlash);
    this.sweepCups(dt, drones);
    for (const [role, drone] of drones) this.checkHoop(role, drone);
  }

  /** One-line checklist for the objective panel during the arrival stage. */
  checklist(partner: string): { label: string; done: boolean }[] {
    return [
      { label: 'Topple the desk toys', done: this.state.toppled },
      { label: 'Slingshot the hoop', done: this.state.hoop },
      { label: `Yank ${partner}${byInput({ keyboard: ' [R]', touch: '', gamepad: '' })}`, done: this.state.yank },
    ];
  }

  get done(): boolean { return this.state.toppled && this.state.hoop && this.state.yank; }

  dispose(): void {
    this.offYank();
    const probe = globalThis as { __playground?: CordPlayground };
    if (probe.__playground === this) delete probe.__playground;
    for (const cup of this.cups) { cup.body.dispose(); cup.mesh.dispose(); }
    for (const body of this.statics) body.dispose();
    for (const mesh of this.meshes) mesh.dispose();
  }

  private sweepCups(dt: number, drones: ReadonlyMap<DroneRole, Drone>): void {
    const path = cordState.path;
    const pix = drones.get('pix');
    const nee = drones.get('nee');
    const live = path.length > 1 && pix && nee && (cordState.sweep > 2.5 || cordState.strain > 0.3);
    let newlyToppled = 0;
    for (const cup of this.cups) {
      cup.cooldown = Math.max(0, cup.cooldown - dt);
      if (cup.cooldown <= 0) {
        // Drones don't physically collide with cosmetic props (collision groups), so
        // a drone flying through a cup bonks it here; the cord sweeps it when live.
        let hit: Vector3 | null = null;
        let carry: Vector3 | null = null;
        for (const drone of drones.values()) {
          if (Vector3.Distance(drone.position, cup.mesh.position) < CUP * 0.5 + 0.75) {
            hit = drone.position; carry = drone.velocity; break;
          }
        }
        if (!hit && live) {
          let best = Number.POSITIVE_INFINITY;
          for (let i = 1; i < path.length; i++) {
            const d = closest(cup.mesh.position, path[i - 1], path[i], this.push);
            if (d < best) { best = d; this.closest.copyFrom(this.push); }
          }
          if (best < CUP * 0.5 + 0.35) { hit = this.closest; carry = pix.velocity.add(nee.velocity).scaleInPlace(0.5); }
        }
        if (hit && carry) this.knock(cup, hit, carry, 1);
      }
      if (!cup.toppled && Vector3.Distance(cup.mesh.position, cup.rest) > 0.45) {
        cup.toppled = true;
        newlyToppled += 1;
      }
    }
    if (newlyToppled > 0) {
      this.cupsToppled += newlyToppled;
      gameEvents.emit('warmup', { kind: 'topple', position: this.cups[0].mesh.position.clone(), count: this.cupsToppled });
      if (!this.state.toppled && this.cupsToppled >= 2) { this.state.toppled = true; this.progress('topple'); }
    }
  }

  /** Knock a cup and collapse whatever was stacked above it in the same tower. */
  private knock(cup: Cup, from: Vector3, carry: Vector3, scale: number): void {
    const away = cup.mesh.position.subtract(from); away.y = 0;
    if (away.lengthSquared() < 1e-4) away.set(0, 0, 1);
    away.normalize().scaleInPlace(3.5 * scale);
    const v = carry.scale(0.45 * scale).addInPlace(away);
    v.y = Math.max(v.y, 2.2 * scale);
    cup.body.body.setLinearVelocity(v);
    cup.body.body.setAngularVelocity(new Vector3(Math.random() * 8 - 4, Math.random() * 2 - 1, Math.random() * 8 - 4));
    cup.cooldown = 0.3;
    if (scale < 1) return;
    for (const other of this.cups) {
      if (other !== cup && other.tower === cup.tower && other.row > cup.row && other.cooldown <= 0) {
        this.knock(other, from, carry, 0.55);
      }
    }
  }

  private checkHoop(role: DroneRole, drone: Drone): void {
    const p = drone.position;
    const side = Math.sign(p.z - HOOP.z) || 1;
    const prev = this.lastSide.get(role);
    this.lastSide.set(role, side);
    if (prev === undefined || prev === side) return;
    if (Math.hypot(p.x - HOOP.x, p.y - HOOP.y) > HOOP_RADIUS + 0.2) return;
    const launched = drone.yankedRecently > 0 || drone.speed > 15;
    if (launched) {
      this.hoopFlash = 1.2;
      gameEvents.emit('warmup', { kind: 'hoop', position: HOOP.clone(), count: 1 });
      if (!this.state.hoop) { this.state.hoop = true; this.progress('hoop'); }
    } else if (!this.state.hoop && this.hintCooldown <= 0) {
      this.hintCooldown = 6;
      gameEvents.emit('toast', {
        text: byInput({
          keyboard: 'Too slow. Pull the cord tight, then [R]',
          touch: 'Too slow. Pull the cord tight, then tap Yank',
          gamepad: 'Too slow. Pull the cord tight, then yank',
        }),
        tone: 'good',
      });
    }
  }

  private progress(step: 'topple' | 'hoop' | 'yank'): void {
    const text = step === 'topple' ? 'Oops. Nobody saw that.' : step === 'hoop' ? 'Slingshot! Nothing but hoop' : 'Yank! The cord is a tool';
    gameEvents.emit('toast', { text, tone: 'good' });
    if (this.done) setTimeout(() => gameEvents.emit('toast', { text: 'Warm-up done. Go steal something', tone: 'good' }), 1400);
  }
}

function closest(point: Vector3, a: Vector3, b: Vector3, out: Vector3): number {
  const sx = b.x - a.x, sy = b.y - a.y, sz = b.z - a.z;
  const len2 = sx * sx + sy * sy + sz * sz;
  let t = len2 < 1e-6 ? 0 : ((point.x - a.x) * sx + (point.y - a.y) * sy + (point.z - a.z) * sz) / len2;
  t = Math.max(0, Math.min(1, t));
  out.set(a.x + sx * t, a.y + sy * t, a.z + sz * t);
  return Vector3.Distance(point, out);
}

/** Small printed label card (no instructions walls). */
function label(scene: Scene, title: string, sub: string, at: Vector3, width: number): Mesh {
  const plane = CreatePlane(`label-${title}`, { width, height: width * 0.32 }, scene);
  plane.position.copyFrom(at);
  // The plane's front faces -z (towards the apron camera); flip U so text isn't mirrored.
  plane.isPickable = false;
  const tex = new DynamicTexture(`label-${title}-tex`, { width: 512, height: 164 }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.setTransform(-1, 0, 0, 1, 512, 0); // pre-mirror: the plane's UVs read reversed from this side
  ctx.fillStyle = '#F7F3EA'; ctx.fillRect(0, 0, 512, 164);
  ctx.fillStyle = '#1D2226'; ctx.fillRect(0, 150, 512, 14);
  ctx.textAlign = 'center';
  ctx.font = "bold 62px 'Trebuchet MS', sans-serif"; ctx.fillText(title, 256, 76);
  ctx.font = "32px 'Trebuchet MS', sans-serif"; ctx.fillStyle = '#5A646B'; ctx.fillText(sub, 256, 126);
  tex.update();
  const mat = new StandardMaterial(`label-${title}-mat`, scene);
  mat.diffuseTexture = tex; mat.emissiveColor = new Color3(0.55, 0.55, 0.55); mat.specularColor = Color3.Black();
  plane.material = mat;
  return plane;
}
