import {
  ImportMeshAsync,
  TransformNode,
  type AbstractMesh,
  type AnimationGroup,
  type Scene,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';

export interface LoadedModel {
  readonly root: TransformNode;
  readonly meshes: readonly AbstractMesh[];
  readonly animationGroups: readonly AnimationGroup[];
  dispose(): void;
}

/**
 * Loads glTF and GLB into the current scene.
 * The glTF plugin is registered by importing this module.
 */
export class AssetLoader {
  private readonly scene: Scene;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  async loadModel(url: string): Promise<LoadedModel> {
    const source = url.trim();
    if (!source) {
      throw new Error('AssetLoader.loadModel requires a glTF or GLB url.');
    }

    const result = await ImportMeshAsync(source, this.scene);
    const root = new TransformNode(`model:${source}`, this.scene);

    for (const mesh of result.meshes) {
      if (!mesh.parent) {
        mesh.parent = root;
      }
    }

    return {
      root,
      meshes: result.meshes,
      animationGroups: result.animationGroups,
      dispose: () => {
        for (const group of result.animationGroups) {
          group.dispose();
        }
        root.dispose(false, true);
      },
    };
  }
}
