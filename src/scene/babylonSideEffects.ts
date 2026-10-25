// Babylon's barrel normally registers these scene components and engine extensions.
// Keep the registrations explicit when using deep imports so the corresponding
// prototype APIs remain available at runtime.
import '@babylonjs/core/Culling/ray.js';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent.js';
import '@babylonjs/core/Layers/effectLayerSceneComponent.js';
import '@babylonjs/core/Layers/glowLayer.js';
import '@babylonjs/core/Physics/physicsEngineComponent.js';
import '@babylonjs/core/Physics/v2/physicsEngineComponent.js';
import '@babylonjs/core/Animations/animatable.js';
import '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import '@babylonjs/core/Materials/standardMaterial.js';
import '@babylonjs/core/Materials/Textures/dynamicTexture.js';
import '@babylonjs/core/Meshes/thinInstanceMesh.js';
import '@babylonjs/core/Meshes/instancedMesh.js';
import '@babylonjs/core/Particles/particleSystem.js';
import '@babylonjs/core/Engines/Extensions/engine.dynamicTexture.js';
import '@babylonjs/core/Engines/Extensions/engine.renderTarget.js';
import '@babylonjs/core/Engines/Extensions/engine.multiRender.js';
