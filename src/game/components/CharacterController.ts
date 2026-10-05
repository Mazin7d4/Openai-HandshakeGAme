import { MeshBuilder, Quaternion, Ray, Scene, Vector3 } from '@babylonjs/core';
import type { AbstractMesh } from '@babylonjs/core';
import { Character } from './Character';
import { CameraSystem } from '../systems/CameraSystem';
import type { InputState } from '../types';

export class CharacterController {
  private readonly character: Character;
  private readonly cameraSystem: CameraSystem;
  private readonly scene: Scene;
  private readonly collider: AbstractMesh;

  private readonly walkSpeed = 1.7;
  private readonly runSpeed = 3.8;
  private readonly groundAcceleration = 10;
  private readonly airAcceleration = 4;
  private readonly jumpSpeed = 7.1;
  private readonly gravity = -22;
  private readonly terminalVelocity = -28;
  private readonly coyoteTime = 0.12;
  private readonly jumpBufferTime = 0.12;
  private readonly turnSpeed = 6.5;

  private velocity = Vector3.Zero();
  private isGrounded = false;
  private coyoteTimer = 0;
  private jumpBufferTimer = 0;
  private jumpWasDown = false;
  private yaw = 0;
  private runBlend = 0;
  private readonly groundRay: Ray;

  constructor(character: Character, cameraSystem: CameraSystem, scene: Scene) {
    this.character = character;
    this.cameraSystem = cameraSystem;
    this.scene = scene;

    this.collider = MeshBuilder.CreateBox('playerCollider', { size: 0.2 }, scene);
    this.collider.isVisible = false;
    this.collider.isPickable = false;
    this.collider.checkCollisions = true;
    this.collider.ellipsoid = new Vector3(0.28, 0.85, 0.28);
    this.collider.ellipsoidOffset = new Vector3(0, 0.85, 0);
    this.collider.position.set(0, 0.2, 8);
    this.collider.metadata = { player: true };

    this.groundRay = new Ray(Vector3.Zero(), Vector3.Down(), 0.45);
    this.syncVisual();
  }

  public update(input: Readonly<InputState>, deltaTime: number): void {
    const dt = Math.min(deltaTime, 1 / 30);

    const jumpPressed = input.jump && !this.jumpWasDown;
    this.jumpWasDown = input.jump;
    if (jumpPressed) this.jumpBufferTimer = this.jumpBufferTime;
    else this.jumpBufferTimer -= dt;

    this.runBlend += ((input.run && this.hasMoveInput(input) ? 1 : 0) - this.runBlend) * (1 - Math.exp(-8 * dt));

    const speed = this.walkSpeed + (this.runSpeed - this.walkSpeed) * this.runBlend;
    const wish = this.cameraRelativeWish(input).scale(speed);
    this.accelerate(wish, this.isGrounded ? this.groundAcceleration : this.airAcceleration, dt);

    const startedJump = this.tryJump();
    this.velocity.y += this.gravity * dt;
    this.velocity.y = Math.max(this.velocity.y, this.terminalVelocity);

    this.move(dt);
    this.snapToGround();

    if (this.isGrounded) this.coyoteTimer = this.coyoteTime;
    else this.coyoteTimer -= dt;

    this.yaw = this.rotateToward(this.cameraSystem.getYaw(), dt);
    this.syncVisual();

    const forward = new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const right = Vector3.Cross(Vector3.Up(), forward);
    const horizontal = new Vector3(this.velocity.x, 0, this.velocity.z);
    this.character.setIntent({
      localVelocity: {
        x: Vector3.Dot(horizontal, right),
        z: Vector3.Dot(horizontal, forward),
      },
      run: this.runBlend,
      yawRate: this.lastYawRate,
      grounded: this.isGrounded,
      jump: startedJump,
      horizontalSpeed: horizontal.length(),
    });
  }

  private lastYawRate = 0;

  private hasMoveInput(input: Readonly<InputState>): boolean {
    return input.forward || input.backward || input.left || input.right;
  }

  private cameraRelativeWish(input: Readonly<InputState>): Vector3 {
    const forward = this.cameraSystem.getForwardVector();
    const right = this.cameraSystem.getRightVector();
    const wish = Vector3.Zero();
    if (input.forward) wish.addInPlace(forward);
    if (input.backward) wish.subtractInPlace(forward);
    if (input.right) wish.addInPlace(right);
    if (input.left) wish.subtractInPlace(right);
    if (wish.lengthSquared() > 1) wish.normalize();
    return wish;
  }

  private accelerate(wishVelocity: Vector3, acceleration: number, dt: number): void {
    const current = new Vector3(this.velocity.x, 0, this.velocity.z);
    const delta = wishVelocity.subtract(current);
    const maxDelta = acceleration * dt;
    if (delta.length() <= maxDelta) {
      this.velocity.x = wishVelocity.x;
      this.velocity.z = wishVelocity.z;
      return;
    }
    const step = delta.normalize().scale(maxDelta);
    this.velocity.x += step.x;
    this.velocity.z += step.z;
  }

  private tryJump(): boolean {
    if (this.coyoteTimer <= 0 || this.jumpBufferTimer <= 0) return false;
    this.velocity.y = this.jumpSpeed;
    this.isGrounded = false;
    this.coyoteTimer = 0;
    this.jumpBufferTimer = 0;
    return true;
  }

  private move(dt: number): void {
    const displacement = this.velocity.scale(dt);
    const horizontal = new Vector3(displacement.x, 0, displacement.z);
    const before = this.collider.position.clone();
    this.collider.moveWithCollisions(horizontal);

    const moved = new Vector3(this.collider.position.x - before.x, 0, this.collider.position.z - before.z);
    if (this.isGrounded && horizontal.length() > 0.001 && moved.length() < horizontal.length() * 0.45 && this.canStepUp(horizontal)) {
      this.collider.position.y += 0.4;
      this.collider.moveWithCollisions(horizontal.subtract(moved));
    }

    const vertical = new Vector3(0, displacement.y, 0);
    const yBefore = this.collider.position.y;
    this.collider.moveWithCollisions(vertical);
    const yMoved = this.collider.position.y - yBefore;
    if (displacement.y < 0 && yMoved > displacement.y + 0.001) {
      this.isGrounded = true;
      this.velocity.y = 0;
    } else if (displacement.y > 0.001) {
      this.isGrounded = false;
    }
  }

  private canStepUp(horizontal: Vector3): boolean {
    const direction = horizontal.normalize();
    const feet = this.collider.position;
    const blocks = (mesh: AbstractMesh) => mesh.checkCollisions && !mesh.metadata?.player;
    const low = this.scene.pickWithRay(new Ray(feet.add(new Vector3(0, 0.2, 0)), direction, 0.5), blocks);
    const high = this.scene.pickWithRay(new Ray(feet.add(new Vector3(0, 1.05, 0)), direction, 0.5), blocks);
    return !!low?.hit && !high?.hit;
  }

  private snapToGround(): void {
    if (this.velocity.y > 0.2) {
      this.isGrounded = false;
      return;
    }
    const origin = this.collider.position.add(new Vector3(0, 0.35, 0));
    this.groundRay.origin.copyFrom(origin);
    this.groundRay.direction.copyFrom(Vector3.Down());
    this.groundRay.length = 0.7;
    const hit = this.scene.pickWithRay(this.groundRay, (mesh) => mesh.checkCollisions && !mesh.metadata?.player);
    if (hit?.hit && hit.pickedPoint && hit.distance <= 0.48) {
      this.collider.position.y = hit.pickedPoint.y;
      this.velocity.y = 0;
      this.isGrounded = true;
    }
  }

  private rotateToward(desiredYaw: number, dt: number): number {
    const delta = Math.atan2(Math.sin(desiredYaw - this.yaw), Math.cos(desiredYaw - this.yaw));
    const maxStep = this.turnSpeed * dt;
    const applied = Math.max(-maxStep, Math.min(maxStep, delta));
    this.lastYawRate = dt > 0 ? applied / dt : 0;
    return this.yaw + applied;
  }

  private syncVisual(): void {
    this.character.root.position.copyFrom(this.collider.position);
    const rotation = this.character.root.rotationQuaternion ?? Quaternion.Identity();
    Quaternion.FromEulerAnglesToRef(0, this.yaw, 0, rotation);
    this.character.root.rotationQuaternion = rotation;
  }

  public dispose(): void {
    this.collider.dispose();
  }
}
