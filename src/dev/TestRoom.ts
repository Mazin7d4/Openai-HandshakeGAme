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
  const floor = new Color3(0.3, 0.36, 0.4);
  const wall = new Color3(0.48, 0.55, 0.59);
  const dark = new Color3(0.12, 0.18, 0.22);
  const lab = new Color3(0.36, 0.5, 0.56);
  const server = new Color3(0.16, 0.25, 0.3);
  const accent = new Color3(0.24, 0.62, 0.7);
  const warning = new Color3(0.76, 0.43, 0.22);

  addBox(scene, { name: 'tech-floor', x: 0, y: -0.5, z: 0, width: 32, height: 1, depth: 44, color: floor });
  for (const [name, x, z, width, depth] of [
    ['tech-wall-west', -16, 0, 1, 44],
    ['tech-wall-east', 16, 0, 1, 44],
    ['tech-wall-south', 0, -22, 32, 1],
    ['tech-wall-north', 0, 22, 32, 1],
  ] as const) {
    addBox(scene, { name, x, y: 4, z, width, height: 8, depth, color: wall });
  }

  // Spawn lab: desks, shelves and server racks frame a readable central route.
  addBox(scene, { name: 'lab-desk-left', x: -7, y: 0.85, z: -13, width: 4.5, height: 1.7, depth: 1.3, color: lab });
  addBox(scene, { name: 'lab-desk-right', x: 7, y: 0.85, z: -11, width: 4.5, height: 1.7, depth: 1.3, color: lab });
  for (const [index, x] of [-11, 11].entries()) {
    for (let row = 0; row < 3; row++) {
      addBox(scene, {
        name: `server-rack-${index}-${row}`,
        x,
        y: 1.25,
        z: -9 + row * 3.2,
        width: 1.7,
        height: 2.5,
        depth: 1.25,
        color: server,
      });
    }
  }
  addBox(scene, { name: 'tether-obstacle-left', x: -6, y: 1.7, z: -5, width: 2, height: 3.4, depth: 2, color: accent });
  addBox(scene, { name: 'tether-obstacle-right', x: 6, y: 1.25, z: -5, width: 2.2, height: 2.5, depth: 2.2, color: warning });

  // Security divider and physical door opening.
  addBox(scene, { name: 'security-wall-left', x: -9.5, y: 4, z: 2, width: 13, height: 8, depth: 0.8, color: dark });
  addBox(scene, { name: 'security-wall-right', x: 9.5, y: 4, z: 2, width: 13, height: 8, depth: 0.8, color: dark });
  addBox(scene, { name: 'security-lintel', x: 0, y: 6.5, z: 2, width: 6, height: 3, depth: 0.8, color: dark });

  // A narrow post-door service passage creates useful tether corners.
  addBox(scene, { name: 'passage-left', x: -3.4, y: 1.8, z: 7, width: 0.7, height: 3.6, depth: 9, color: wall });
  addBox(scene, { name: 'passage-right', x: 3.4, y: 1.8, z: 7, width: 0.7, height: 3.6, depth: 9, color: wall });
  addBox(scene, { name: 'passage-overhead', x: 0, y: 4.1, z: 7, width: 7.5, height: 0.45, depth: 9, color: dark });

  // Vertical traversal steps and a small prototype vault at the back.
  addBox(scene, { name: 'vertical-step-1', x: -9, y: 1.2, z: 7, width: 4, height: 0.45, depth: 3, color: accent });
  addBox(scene, { name: 'vertical-step-2', x: -9, y: 3.2, z: 11, width: 4, height: 0.45, depth: 3, color: accent });
  addBox(scene, { name: 'vertical-step-3', x: -9, y: 5.2, z: 15, width: 4, height: 0.45, depth: 3, color: accent });
  addBox(scene, { name: 'vault-back', x: 0, y: 3, z: 18.5, width: 12, height: 6, depth: 0.8, color: dark });
  addBox(scene, { name: 'vault-left', x: -6, y: 3, z: 16, width: 0.8, height: 6, depth: 5, color: dark });
  addBox(scene, { name: 'vault-right', x: 6, y: 3, z: 16, width: 0.8, height: 6, depth: 5, color: dark });
  addBox(scene, { name: 'vault-plinth', x: 0, y: 0.65, z: 16.2, width: 3, height: 1.3, depth: 2.2, color: warning });

  return new Vector3(0, 2.15, -15);
}
