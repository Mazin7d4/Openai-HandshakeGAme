import { PhysicsAggregate, PhysicsShapeType, type Mesh, type Scene } from '@babylonjs/core';

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
