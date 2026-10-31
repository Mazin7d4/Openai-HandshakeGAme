import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder.js';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.js';
import type { PhysicsEngine } from '@babylonjs/core/Physics/v2/physicsEngine.js';
import { PhysicsRaycastResult } from '@babylonjs/core/Physics/physicsRaycastResult.js';
import { COLLISION_GROUP } from '../physics/CollisionGroups.ts';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh.js';
import type { Scene } from '@babylonjs/core/scene.js';

interface ShadowTargetState {
  readonly target: { mesh: AbstractMesh; radius: number };
  readonly instance: InstancedMesh;
  cachedHitY: number;
  hasHit: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Soft dark blob decals on the ground under moving objects.
 * Uses a single shared StandardMaterial, a single source ground plane, and InstancedMesh
 * so all blobs are drawn in a single draw call.
 */
export function addContactShadows(scene: Scene, targets: { mesh: AbstractMesh; radius: number }[]): void {
  if (targets.length === 0) return;

  const shadowMat = new StandardMaterial('contact-shadow-mat', scene);
  shadowMat.disableLighting = true;
  shadowMat.diffuseColor = Color3.Black();
  shadowMat.emissiveColor = Color3.Black();
  shadowMat.zOffset = -2;
  shadowMat.backFaceCulling = true;

  const opacityTex = new DynamicTexture('contact-shadow-tex', { width: 64, height: 64 }, scene, false);
  const ctx = opacityTex.getContext() as CanvasRenderingContext2D;
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  opacityTex.update();
  opacityTex.hasAlpha = true;
  shadowMat.opacityTexture = opacityTex;

  const source = CreateGround('contact-shadow-source', { width: 1, height: 1, subdivisions: 1 }, scene);
  source.material = shadowMat;
  source.isVisible = false;
  source.isPickable = false;

  const states: ShadowTargetState[] = [];
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    const instance = source.createInstance(`contact-shadow-blob-${target.mesh.name || i}`);
    instance.isPickable = false;
    instance.isVisible = false;
    states.push({
      target,
      instance,
      cachedHitY: 0,
      hasHit: false,
    });
  }

  // Query Havok's broad phase and simple collision shapes, never every decorative triangle.
  // Excluding drone/grabbable categories prevents a moving object casting its blob onto itself.
  const rayOrigin = new Vector3();
  const rayEnd = new Vector3();
  const hit = new PhysicsRaycastResult();
  const query = { membership: COLLISION_GROUP.all, collideWith: COLLISION_GROUP.world, shouldHitTriggers: false };
  const physics = scene.getPhysicsEngine() as PhysicsEngine | null;

  let frameCount = 0;

  const obs = scene.onBeforeRenderObservable.add(() => {
    const slot = frameCount % 4;
    frameCount++;

    for (let i = 0; i < states.length; i++) {
      const state = states[i];
      const mesh = state.target.mesh;

      // Skip disabled targets (hide their blob)
      if (!mesh.isEnabled()) {
        state.instance.isVisible = false;
        continue;
      }

      const pos = mesh.absolutePosition;

      // Cast downward ray every 4th frame per target
      if (i % 4 === slot || !state.hasHit) {
        rayOrigin.copyFrom(pos);
        rayEnd.set(pos.x, pos.y - 12, pos.z);
        physics?.raycastToRef(rayOrigin, rayEnd, hit, query);
        if (hit.hasHit) {
          state.cachedHitY = hit.hitPointWorld.y;
          state.hasHit = true;
        } else {
          state.hasHit = false;
        }
      }

      if (!state.hasHit) {
        state.instance.isVisible = false;
        continue;
      }

      const height = pos.y - state.cachedHitY;
      // Hide when height > 12 or no hit
      if (height > 12) {
        state.instance.isVisible = false;
        continue;
      }

      const safeHeight = height > 0 ? height : 0;
      const hNorm = clamp(safeHeight / 6, 0, 1);
      const fade = clamp(1 - safeHeight / 12, 0, 1);
      const scale = state.target.radius * 2 * (1 + 0.6 * hNorm) * fade;

      state.instance.isVisible = true;
      state.instance.position.set(pos.x, state.cachedHitY + 0.02, pos.z);
      state.instance.scaling.set(scale, 1, scale);
    }
  });

  scene.onDisposeObservable.addOnce(() => {
    scene.onBeforeRenderObservable.remove(obs);
  });
}
