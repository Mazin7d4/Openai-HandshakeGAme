/**
 * Register only the glTF 2.0 loader + extensions our .glb assets actually use.
 * Checked against public/assets/{drone,lab,props}/*.glb:
 *   EXT_meshopt_compression, KHR_mesh_quantization (all three)
 *   KHR_materials_emissive_strength (drone, office-kit)
 *   KHR_materials_clearcoat (drone)
 * Importing `@babylonjs/loaders/glTF` pulls every extension and bloats the heist chunk.
 */
import '@babylonjs/loaders/glTF/2.0/glTFLoader.js';
import '@babylonjs/loaders/glTF/2.0/Extensions/EXT_meshopt_compression.js';
import '@babylonjs/loaders/glTF/2.0/Extensions/KHR_mesh_quantization.js';
import '@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_emissive_strength.js';
import '@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_clearcoat.js';
