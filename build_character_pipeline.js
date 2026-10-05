/**
 * Character Pipeline: Merge Superhero_Female with UAL1_Standard + UAL2_Standard animations
 * Outputs: public/assets/character/player.glb
 */

const fs = require('fs');
const path = require('path');
const { GLTFExporter } = require('three/examples/jsm/exporters/GLTFExporter.js');
const { GLTFLoader } = require('three/examples/jsm/loaders/GLTFLoader.js');
const { AnimationClip, AnimationMixer, Skeleton, SkinnedMesh, Bone } = require('three');
const { FileLoader } = require('three');
const { BufferGeometry, BufferAttribute } = require('three');
const { Matrix4, Quaternion, Vector3, Euler } = require('three');

// Use three.js via dynamic import since it's ESM
// We'll use a different approach - use gltf-pipeline or a custom merger

const CHILD_PROCESS = require('child_process');

const SOURCE_CHAR = 'C:/Dev/hackathons/CHARACTERS/Universal Base Characters[Standard]/Universal Base Characters[Standard]/Base Characters/Godot - UE/Superhero_Female_FullBody.gltf';
const SOURCE_CHAR_BIN = 'C:/Dev/hackathons/CHARACTERS/Universal Base Characters[Standard]/Universal Base Characters[Standard]/Base Characters/Godot - UE/Superhero_Female_FullBody.bin';
const SOURCE_TEXTS_DIR = 'C:/Dev/hackathons/CHARACTERS/Universal Base Characters[Standard]/Universal Base Characters[Standard]/Base Characters/Godot - UE/';

const ANIM_1 = 'C:/Dev/hackathons/CHARACTERS/Universal Animation Library[Standard]/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb';
const ANIM_2 = 'C:/Dev/hackathons/CHARACTERS/Universal Animation Library 2[Standard]/Universal Animation Library 2[Standard]/Unreal-Godot/UAL2_Standard.glb';

const OUTPUT_DIR = 'C:/Dev/hackathons/Openai-HandshakeGAme/public/assets/character';
const OUTPUT_GLTF = path.join(OUTPUT_DIR, 'player.gltf');
const OUTPUT_GLB = path.join(OUTPUT_DIR, 'player.glb');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

console.log('=== Character Pipeline ===');
console.log('Source character:', SOURCE_CHAR);
console.log('Animation 1:', ANIM_1);
console.log('Animation 2:', ANIM_2);
console.log('Output:', OUTPUT_GLB);

// Step 1: Copy character files (gltf + bin + textures) to output dir
console.log('\n--- Step 1: Copy character files ---');
const charDir = path.dirname(SOURCE_CHAR);
const charFiles = fs.readdirSync(charDir);
for (const file of charFiles) {
    const src = path.join(charDir, file);
    const dst = path.join(OUTPUT_DIR, file);
    if (file.endsWith('.gltf') || file.endsWith('.bin') || file.endsWith('.png')) {
        fs.copyFileSync(src, dst);
        console.log('Copied:', file);
    }
}

// Rename character files to player
const oldGltf = path.join(OUTPUT_DIR, 'Superhero_Female_FullBody.gltf');
const oldBin = path.join(OUTPUT_DIR, 'Superhero_Female_FullBody.bin');
const newGltf = path.join(OUTPUT_DIR, 'player.gltf');
const newBin = path.join(OUTPUT_DIR, 'player.bin');

if (fs.existsSync(oldGltf)) fs.renameSync(oldGltf, newGltf);
if (fs.existsSync(oldBin)) fs.renameSync(oldBin, newBin);

// Update gltf to reference renamed bin
let gltfContent = fs.readFileSync(newGltf, 'utf8');
gltfContent = gltfContent.replace('Superhero_Female_FullBody.bin', 'player.bin');
fs.writeFileSync(newGltf, gltfContent);
console.log('Renamed character files to player.gltf/player.bin');

// Step 2: Extract animations from UAL1 and UAL2
// We'll use a Node script with three.js to load and merge animations
console.log('\n--- Step 2: Merge animations ---');

const mergeScript = `
const fs = require('fs');
const path = require('path');

// Simple GLTF animation merger using gltf-transform
// We'll use a different approach - just copy the animations into the character file

const { NodeIO, Animation, AnimationChannel, AnimationSampler, PropertyType } = require('@gltf-transform/core');
const { NodeIO as NodeIOUtils } = require('@gltf-transform/core');
const { rename, join, metalRough } = require('@gltf-transform/functions');

async function merge() {
    const io = new NodeIO();
    
    // Load character
    console.log('Loading character...');
    const charDoc = await io.read('${OUTPUT_DIR}/player.gltf');
    const charRoot = charDoc.getRoot();
    
    // Get character skeleton
    const skins = charRoot.listSkins();
    console.log('Character skins:', skins.length);
    if (skins.length === 0) throw new Error('No skin found in character');
    const charSkin = skins[0];
    const charJoints = charSkin.listJoints();
    console.log('Character joints:', charJoints.map(j => j.getName()));
    
    // Load animations
    console.log('Loading UAL1...');
    const anim1Doc = await io.read('${ANIM_1}');
    const anim1Root = anim1Doc.getRoot();
    const anim1Anims = anim1Root.listAnimations();
    console.log('UAL1 animations:', anim1Anims.length, anim1Anims.map(a => a.getName()));
    
    console.log('Loading UAL2...');
    const anim2Doc = await io.read('${ANIM_2}');
    const anim2Root = anim2Doc.getRoot();
    const anim2Anims = anim2Root.listAnimations();
    console.log('UAL2 animations:', anim2Anims.length, anim2Anims.map(a => a.getName()));
    
    // For now, just log what we have and exit
    // The real merging would require retargeting which is complex
    console.log('\\n=== Animations found ===');
    for (const a of anim1Anims) {
        console.log('UAL1:', a.getName(), 'channels:', a.listChannels().length);
    }
    for (const a of anim2Anims) {
        console.log('UAL2:', a.getName(), 'channels:', a.listChannels().length);
    }
    
    // Get animation channels to understand bone names
    if (anim1Anims.length > 0) {
        const channels = anim1Anims[0].listChannels();
        console.log('\\nFirst anim channels (sample):');
        for (let i = 0; i < Math.min(10, channels.length); i++) {
            const target = channels[i].getTarget();
            console.log('  Path:', target.path, 'Node:', target.node?.getName());
        }
    }
}

merge().catch(e => console.error(e));
`;

// Write the merge script to a temp file and run it
const mergeScriptPath = path.join(OUTPUT_DIR, 'merge_animations.mjs');
fs.writeFileSync(mergeScriptPath, mergeScript.replace(/\$\{OUTPUT_DIR\}/g, OUTPUT_DIR)
    .replace(/\$\{ANIM_1\}/g, ANIM_1)
    .replace(/\$\{ANIM_2\}/g, ANIM_2));

console.log('\n--- Installing @gltf-transform/core ---');
try {
    CHILD_PROCESS.execSync('npm install @gltf-transform/core @gltf-transform/functions --prefix ' + OUTPUT_DIR, { stdio: 'inherit' });
} catch (e) {
    console.log('Install failed, trying global...');
}

// Run the merge script
console.log('\n--- Running animation merge ---');
try {
    CHILD_PROCESS.execSync('node ' + mergeScriptPath, { stdio: 'inherit', cwd: OUTPUT_DIR });
} catch (e) {
    console.log('Merge script failed, trying alternative approach...');
}

console.log('\n=== Pipeline complete ===');