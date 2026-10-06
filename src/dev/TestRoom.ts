import {
  Color3,
  CreateBox,
  CreateCylinder,
  PhysicsShapeType,
  Quaternion,
  Vector3,
  type Mesh,
  type Scene,
} from '@babylonjs/core';
import { addStaticBody } from '../physics/staticBody.ts';
import { applySolidColor } from '../scene/solidMaterial.ts';

const FLOOR = new Color3(0.78, 0.74, 0.68);
const WALL = new Color3(0.58, 0.6, 0.63);
const RAMP = new Color3(0.72, 0.46, 0.36);
const PLATFORM = new Color3(0.5, 0.56, 0.6);
const FRAME = new Color3(0.36, 0.52, 0.56);
const TUNNEL = new Color3(0.42, 0.46, 0.52);
const LOW = new Color3(0.33, 0.48, 0.55);
const HIGH = new Color3(0.46, 0.38, 0.52);

interface BoxSpec {
  name: string;
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
  color: Color3;
  pitch?: number;
}

function addBox(scene: Scene, spec: BoxSpec): Mesh {
  const mesh = CreateBox(
    spec.name,
    { width: spec.width, height: spec.height, depth: spec.depth },
    scene,
  );
  mesh.position.set(spec.x, spec.y, spec.z);
  if (spec.pitch) {
    mesh.rotationQuaternion = Quaternion.FromEulerAngles(spec.pitch, 0, 0);
  }
  applySolidColor(mesh, spec.color, scene);
  addStaticBody(mesh, scene, PhysicsShapeType.BOX);
  return mesh;
}

/**
 * Temporary collision course made of primitives.
 * Replace this with the real level. The spawn point is the only contract GameApp needs.
 */
export function createLegacyTestRoom(scene: Scene): Vector3 {
  addBox(scene, {
    name: 'floor',
    x: 0,
    y: -0.5,
    z: 0,
    width: 64,
    height: 1,
    depth: 86,
    color: FLOOR,
  });

  const wallHeight = 10;
  const wallY = wallHeight / 2;
  addBox(scene, {
    name: 'wall-south',
    x: 0,
    y: wallY,
    z: -43,
    width: 64,
    height: wallHeight,
    depth: 1,
    color: WALL,
  });
  addBox(scene, {
    name: 'wall-north',
    x: 0,
    y: wallY,
    z: 43,
    width: 64,
    height: wallHeight,
    depth: 1,
    color: WALL,
  });
  addBox(scene, {
    name: 'wall-west',
    x: -32,
    y: wallY,
    z: 0,
    width: 1,
    height: wallHeight,
    depth: 86,
    color: WALL,
  });
  addBox(scene, {
    name: 'wall-east',
    x: 32,
    y: wallY,
    z: 0,
    width: 1,
    height: wallHeight,
    depth: 86,
    color: WALL,
  });

  addBox(scene, {
    name: 'center-pillar',
    x: 0,
    y: 1.7,
    z: -6,
    width: 1.6,
    height: 3.4,
    depth: 1.6,
    color: LOW,
  });
  addBox(scene, {
    name: 'low-crate',
    x: 5.5,
    y: 0.7,
    z: -11,
    width: 2.4,
    height: 1.4,
    depth: 2.4,
    color: LOW,
  });
  addBox(scene, {
    name: 'mid-block',
    x: 8,
    y: 3.3,
    z: -2,
    width: 2.6,
    height: 1.3,
    depth: 1.8,
    color: HIGH,
  });
  addBox(scene, {
    name: 'high-beam',
    x: 0,
    y: 6.4,
    z: 2,
    width: 16,
    height: 0.7,
    depth: 1.3,
    color: HIGH,
  });

  addBox(scene, {
    name: 'ramp-up',
    x: -10,
    y: 1.35,
    z: -1,
    width: 5,
    height: 0.4,
    depth: 9,
    color: RAMP,
    pitch: -0.32,
  });
  addBox(scene, {
    name: 'platform',
    x: -10,
    y: 2.85,
    z: 5.2,
    width: 6.5,
    height: 0.45,
    depth: 5.5,
    color: PLATFORM,
  });
  addBox(scene, {
    name: 'ramp-down',
    x: -10,
    y: 1.35,
    z: 11.2,
    width: 5,
    height: 0.4,
    depth: 9,
    color: RAMP,
    pitch: 0.32,
  });

  addBox(scene, {
    name: 'gate-left',
    x: -17.5,
    y: wallY,
    z: 8,
    width: 29,
    height: wallHeight,
    depth: 1,
    color: WALL,
  });
  addBox(scene, {
    name: 'gate-right',
    x: 17.5,
    y: wallY,
    z: 8,
    width: 29,
    height: wallHeight,
    depth: 1,
    color: WALL,
  });
  addBox(scene, {
    name: 'gate-sill',
    x: 0,
    y: 0.7,
    z: 8,
    width: 6,
    height: 1.4,
    depth: 1,
    color: FRAME,
  });
  addBox(scene, {
    name: 'gate-lintel',
    x: 0,
    y: 6.7,
    z: 8,
    width: 6,
    height: 6.6,
    depth: 1,
    color: FRAME,
  });

  const tunnelZ = 18;
  const tunnelLength = 10;
  addBox(scene, {
    name: 'tunnel-left',
    x: -1.85,
    y: 1.15,
    z: tunnelZ,
    width: 0.5,
    height: 2.3,
    depth: tunnelLength,
    color: TUNNEL,
  });
  addBox(scene, {
    name: 'tunnel-right',
    x: 1.85,
    y: 1.15,
    z: tunnelZ,
    width: 0.5,
    height: 2.3,
    depth: tunnelLength,
    color: TUNNEL,
  });
  addBox(scene, {
    name: 'tunnel-ceiling',
    x: 0,
    y: 2.45,
    z: tunnelZ,
    width: 4.2,
    height: 0.4,
    depth: tunnelLength,
    color: TUNNEL,
  });

  const column = CreateCylinder('height-column', { height: 4.2, diameter: 1.3, tessellation: 16 }, scene);
  column.position.set(14, 2.1, 4);
  applySolidColor(column, LOW, scene);
  addStaticBody(column, scene, PhysicsShapeType.CYLINDER);

  const stack = CreateCylinder('high-column', { height: 7.5, diameter: 1.1, tessellation: 12 }, scene);
  stack.position.set(-16, 3.75, 16);
  applySolidColor(stack, HIGH, scene);
  addStaticBody(stack, scene, PhysicsShapeType.CYLINDER);

  addBox(scene, {
    name: 'hover-block',
    x: 12,
    y: 5.4,
    z: 20,
    width: 2.8,
    height: 1.4,
    depth: 2.8,
    color: HIGH,
  });

  return new Vector3(0, 2.15, -15);
}

/** Compact tech-lab test layout for interaction, traversal and tether situations. */
export function createTestRoom(scene: Scene): Vector3 {
  const floor = new Color3(0.24, 0.3, 0.33);
  const wall = new Color3(0.5, 0.57, 0.59);
  const dark = new Color3(0.1, 0.16, 0.19);
  const lab = new Color3(0.34, 0.48, 0.52);
  const server = new Color3(0.13, 0.22, 0.26);
  const cyan = new Color3(0.19, 0.62, 0.68);
  const coral = new Color3(0.78, 0.35, 0.28);
  const glass = new Color3(0.42, 0.68, 0.72);

  // Exterior apron and full interior footprint.
  addBox(scene, { name: 'lab-floor', x: 0, y: -0.5, z: 0, width: 38, height: 1, depth: 54, color: floor });
  addBox(scene, { name: 'extraction-pad', x: -13, y: 0.04, z: -20, width: 7, height: 0.12, depth: 7, color: cyan });

  // Perimeter is deliberately segmented: reception opening south, emergency route west.
  addBox(scene, { name: 'south-wall-left', x: -11.5, y: 4, z: -17.5, width: 15, height: 8, depth: 0.8, color: wall });
  addBox(scene, { name: 'south-wall-right', x: 11.5, y: 4, z: -17.5, width: 15, height: 8, depth: 0.8, color: wall });
  addBox(scene, { name: 'south-entry-lintel', x: 0, y: 6.7, z: -17.5, width: 8, height: 2.6, depth: 0.8, color: dark });
  addBox(scene, { name: 'east-wall', x: 18.5, y: 4, z: 4.5, width: 1, height: 8, depth: 45, color: wall });
  addBox(scene, { name: 'north-wall', x: 0, y: 4, z: 26.5, width: 38, height: 8, depth: 1, color: wall });
  addBox(scene, { name: 'west-wall-north', x: -18.5, y: 4, z: 10, width: 1, height: 8, depth: 33, color: wall });
  addBox(scene, { name: 'west-wall-south', x: -18.5, y: 4, z: -15, width: 1, height: 8, depth: 5, color: wall });

  // Reception and office: low furniture leaves two small routes and throwable clutter.
  addBox(scene, { name: 'reception-desk', x: -7, y: 0.8, z: -13.2, width: 6, height: 1.6, depth: 1.2, color: lab });
  addBox(scene, { name: 'office-desk-left', x: -7, y: 0.75, z: -9.5, width: 4, height: 1.5, depth: 1.4, color: lab });
  addBox(scene, { name: 'office-desk-right', x: 7, y: 0.75, z: -10.2, width: 4, height: 1.5, depth: 1.4, color: lab });
  addBox(scene, { name: 'office-glass-left', x: -10.5, y: 2.3, z: -7.4, width: 6, height: 4.6, depth: 0.18, color: glass });
  addBox(scene, { name: 'office-glass-right', x: 10.5, y: 2.3, z: -7.4, width: 6, height: 4.6, depth: 0.18, color: glass });

  // Server/security room: paired terminals sit apart so players have independent UI and space.
  for (const [index, x] of [-15, -12, 12, 15].entries()) {
    addBox(scene, { name: `server-rack-${index}`, x, y: 1.6, z: -3.5, width: 1.8, height: 3.2, depth: 4, color: server });
  }
  addBox(scene, { name: 'server-shelf-left', x: -10, y: 2.2, z: -1.5, width: 0.7, height: 4.4, depth: 5.5, color: dark });
  addBox(scene, { name: 'server-shelf-right', x: 10, y: 2.2, z: -1.5, width: 0.7, height: 4.4, depth: 5.5, color: dark });
  addBox(scene, { name: 'security-wall-left', x: -11.2, y: 4, z: 2, width: 14.5, height: 8, depth: 0.8, color: dark });
  addBox(scene, { name: 'security-wall-right', x: 11.2, y: 4, z: 2, width: 14.5, height: 8, depth: 0.8, color: dark });
  addBox(scene, { name: 'security-lintel', x: 0, y: 6.5, z: 2, width: 8, height: 3, depth: 0.8, color: dark });

  // Robotics lab: offset gantries, shelf gaps and a narrow tether passage.
  addBox(scene, { name: 'robotics-bench-left', x: -7, y: 1, z: 7.2, width: 6, height: 2, depth: 2, color: lab });
  addBox(scene, { name: 'robotics-bench-right', x: 7, y: 1, z: 8.8, width: 6, height: 2, depth: 2, color: lab });
  addBox(scene, { name: 'narrow-left', x: -2.2, y: 2, z: 9, width: 0.6, height: 4, depth: 7, color: wall });
  addBox(scene, { name: 'narrow-right', x: 2.2, y: 2, z: 9, width: 0.6, height: 4, depth: 7, color: wall });
  addBox(scene, { name: 'robotics-gantry', x: 0, y: 5.2, z: 8, width: 13, height: 0.5, depth: 2, color: cyan });
  addBox(scene, { name: 'vertical-platform-low', x: 10, y: 1.6, z: 12, width: 4, height: 0.4, depth: 3, color: coral });
  addBox(scene, { name: 'vertical-platform-high', x: 10, y: 4.3, z: 16, width: 4, height: 0.4, depth: 3, color: cyan });

  // Vault plus raised observation shelf.
  addBox(scene, { name: 'vault-back', x: 0, y: 3, z: 20, width: 13, height: 6, depth: 0.8, color: dark });
  addBox(scene, { name: 'vault-left', x: -6.5, y: 3, z: 17, width: 0.8, height: 6, depth: 6, color: dark });
  addBox(scene, { name: 'vault-right', x: 6.5, y: 3, z: 17, width: 0.8, height: 6, depth: 6, color: dark });
  addBox(scene, { name: 'vault-plinth', x: 0, y: 0.65, z: 16.2, width: 3, height: 1.3, depth: 2.2, color: coral });
  addBox(scene, { name: 'vault-shelf', x: 0, y: 4.4, z: 19, width: 9, height: 0.35, depth: 1.6, color: cyan });

  // Alarm escape is a west service corridor, not the central entry path.
  addBox(scene, { name: 'escape-divider-south', x: -12, y: 3, z: -0.25, width: 0.7, height: 6, depth: 18.5, color: dark });
  addBox(scene, { name: 'escape-divider-north', x: -12, y: 3, z: 17.25, width: 0.7, height: 6, depth: 0.5, color: dark });
  addBox(scene, { name: 'escape-ceiling', x: -15.2, y: 4.3, z: 4, width: 6, height: 0.4, depth: 27, color: wall });
  addBox(scene, { name: 'escape-turn', x: -15, y: 2.5, z: -9.5, width: 7, height: 5, depth: 0.7, color: dark });
  // A vent-height alternate opening above the turn rewards vertical flight.
  addBox(scene, { name: 'escape-turn-lintel', x: -15, y: 6.2, z: -9.5, width: 7, height: 2.4, depth: 0.7, color: wall });

  return new Vector3(0, 2.15, -23);
}
