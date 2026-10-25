import { PhysicsAggregate } from '@babylonjs/core/Physics/v2/physicsAggregate.js';
import { PhysicsShapeType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin.js';
import type { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import type { Scene } from '@babylonjs/core/scene.js';

export function addStaticBody(
  mesh: Mesh,
  scene: Scene,
  shape: PhysicsShapeType = PhysicsShapeType.BOX,
): PhysicsAggregate {
  mesh.computeWorldMatrix(true);
  return new PhysicsAggregate(
    mesh,
    shape,
    { mass: 0, friction: 0.55, restitution: 0 },
    scene,
  );
}
