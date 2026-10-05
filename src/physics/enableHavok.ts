import { HavokPlugin, Vector3, type Scene } from '@babylonjs/core';
import '@babylonjs/core/Physics/physicsEngineComponent';
import HavokPhysics from '@babylonjs/havok';

export async function enableHavok(scene: Scene): Promise<HavokPlugin> {
  const havok = await HavokPhysics();
  const plugin = new HavokPlugin(true, havok);
  const enabled = scene.enablePhysics(new Vector3(0, -9.81, 0), plugin);
  if (!enabled) {
    throw new Error('Havok physics failed to start.');
  }
  return plugin;
}
