import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { ColorCurves } from '@babylonjs/core/Materials/colorCurves.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { Engine } from '@babylonjs/core/Engines/engine.js';
import { GlowLayer } from '@babylonjs/core/Layers/glowLayer.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder.js';
import { Scene } from '@babylonjs/core/scene.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import './babylonSideEffects.ts';
import { createStudioEnvironment } from './studioEnvironment.ts';
import { initialTier, QualityManager } from './Quality.ts';

/** `?scale=N` renders at 1/N resolution (low-end GPUs, software-render CI); `?lowfx` drops glow. */
const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
export const renderScale = Math.min(6, Math.max(1, Number(params.get('scale')) || 1));
export const lowFx = params.has('lowfx');

export function createEngine(canvas: HTMLCanvasElement): Engine {
  // MSAA can only be chosen at context creation: weak devices (auto low tier) start without it.
  const aa = !lowFx && initialTier() !== 'low';
  const engine = new Engine(canvas, aa, {
    adaptToDeviceRatio: renderScale === 1,
    antialias: aa,
    powerPreference: 'high-performance',
  });
  if (renderScale > 1) engine.setHardwareScalingLevel(renderScale);
  return engine;
}

// Intentional glow include-list (prod-art): core, screens, face-screens, security lenses, alarm/objective beacons.
const GLOW_NAMES = /^(p01-core|p01-core-halo|alarm-beacon-lamp|alarm-beacon-beam|security-camera|security-drone-\d+-eye)$/;
/** Glow include-list: face-screens, lenses, beacons and the core only. */
function isGlowMesh(mesh: AbstractMesh): boolean {
  if (GLOW_NAMES.test(mesh.name)) return true;
  const mat = mesh.material;
  if (!mat) return false;
  // Mascot face-screens: the drone GLB's 'Screen' material carries the animated face texture.
  if (mat.name === 'Screen' && !!(mat as { emissiveTexture?: unknown }).emissiveTexture) return true;
  return false;
}

const qualityManagers = new WeakMap<Scene, QualityManager>();
/** The scene's automatic quality tier manager (see Quality.ts). */
export function getQuality(scene: Scene): QualityManager | undefined { return qualityManagers.get(scene); }

export function createScene(engine: Engine): Scene {
  const scene = new Scene(engine);
  scene.clearColor = Color4.FromHexString('#1E2326FF');
  scene.ambientColor = new Color3(0.2, 0.2, 0.22);

  const surround = CreateGround('diorama-surround', { width: 200, height: 200 }, scene);
  const surroundMat = new StandardMaterial('diorama-surround-material', scene);
  surroundMat.diffuseColor = Color3.FromHexString('#15191B');
  surroundMat.specularColor = Color3.Black();
  surround.material = surroundMat;
  surround.position.y = -0.05;
  surround.isPickable = false;
  surround.freezeWorldMatrix();
  surround.doNotSyncBoundingInfo = true;
  surroundMat.freeze();

  const fill = new HemisphericLight('fill', new Vector3(0.15, 1, 0.2), scene);
  fill.intensity = 0.48;
  fill.diffuse = new Color3(0.92, 0.95, 1);
  fill.groundColor = new Color3(0.38, 0.33, 0.3);
  fill.specular = new Color3(0.08, 0.08, 0.08);

  scene.skipPointerMovePicking = true; // gameplay never hovers; avoids a per-move ray cast
  scene.constantlyUpdateMeshUnderPointer = false;
  const sun = new DirectionalLight('sun', new Vector3(0.38, -1, 0.48), scene);
  sun.intensity = 1.65;
  sun.diffuse = new Color3(1, 0.95, 0.88);
  sun.position.set(-10, 25, 3);
  sun.autoCalcShadowZBounds = false;
  sun.shadowMinZ = 1; sun.shadowMaxZ = 65;
  sun.orthoLeft = -24; sun.orthoRight = 24; sun.orthoBottom = -24; sun.orthoTop = 24;
  const shadows = new ShadowGenerator(1024, sun);
  shadows.usePercentageCloserFiltering = true;
  shadows.filteringQuality = ShadowGenerator.QUALITY_LOW;
  shadows.bias = 0.0005; shadows.normalBias = 0.035; shadows.setDarkness(0.25);
  // A mascot needs one silhouette, not a shadow draw for every pod, antenna and trim.
  // Decorative thin-instance sources span multiple rooms and made the old caster list expensive.
  scene.onBeforeRenderObservable.addOnce(() => {
    for (const mesh of scene.meshes) {
      if (mesh.material?.name === 'Shell' && mesh.isVisible) shadows.addShadowCaster(mesh, false);
    }
  });
  // Snap in LIGHT space at one shadow texel, rather than jumping the world-space centre 2 metres.
  // The caster list stays constant while moving through the building.
  const sunDir = sun.direction.normalizeToNew();
  const shadowRight = Vector3.Cross(Vector3.Up(), sunDir).normalize();
  const shadowUp = Vector3.Cross(sunDir, shadowRight).normalize();
  sun.shadowMaxZ = 75;
  scene.onBeforeRenderObservable.add(() => {
    if (!sun.shadowEnabled) return;
    const cam = scene.activeCamera; if (!cam) return;
    const p = (cam as { target?: Vector3 }).target ?? ('getTarget' in cam ? (cam as typeof cam & { getTarget(): Vector3 }).getTarget() : cam.globalPosition);
    const texel = 48 / (shadows.getShadowMap()?.getSize().width ?? 512);
    const u = p.x * shadowRight.x + 4 * shadowRight.y + p.z * shadowRight.z;
    const v = p.x * shadowUp.x + 4 * shadowUp.y + p.z * shadowUp.z;
    const du = Math.round(u / texel) * texel - u;
    const dv = Math.round(v / texel) * texel - v;
    sun.position.set(p.x + du * shadowRight.x + dv * shadowUp.x - sunDir.x * 38,
      4 + du * shadowRight.y + dv * shadowUp.y - sunDir.y * 38,
      p.z + du * shadowRight.z + dv * shadowUp.z - sunDir.z * 38);
  });

  let glow: GlowLayer | null = null;
  if (!lowFx && initialTier() !== 'low') {
    // Interaction and mascot include-list. Decorative surfaces never bloom.
    glow = new GlowLayer('glow', scene, { blurKernelSize: 16, mainTextureFixedSize: 256 });
    glow.intensity = 0.5;
    const layer = glow;
    const pending: AbstractMesh[] = [];
    scene.onNewMeshAddedObservable.add((mesh) => pending.push(mesh));
    // Materials are often assigned after creation, so classify on the next frame.
    scene.onBeforeRenderObservable.add(() => {
      if (pending.length === 0) return;
      for (const mesh of pending.splice(0)) if (isGlowMesh(mesh)) layer.addIncludedOnlyMesh(mesh as Mesh);
    });
  }
  const qualityManager = new QualityManager(scene, { sun, shadows, glow });
  qualityManagers.set(scene, qualityManager);
  if (params.get('fps') === '1') {
    let disposed = false;
    let disposeOverlay = () => {};
    scene.onDisposeObservable.addOnce(() => {
      disposed = true;
      disposeOverlay();
    });
    void import('../ui/FpsOverlay.ts').then(({ mountFpsOverlay }) => {
      if (!disposed) disposeOverlay = mountFpsOverlay(() => qualityManager.status);
    });
  }

  // Shared soft daylight reflections on painted surfaces, glass, metal and drones.
  scene.environmentTexture = createStudioEnvironment(scene);
  scene.environmentIntensity = 0.72;
  scene.imageProcessingConfiguration.toneMappingEnabled = true;
  scene.imageProcessingConfiguration.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
  scene.imageProcessingConfiguration.exposure = 1.12;
  scene.imageProcessingConfiguration.contrast = 1.06;

  // Cheap filmic framing for the miniature look: soft warm vignette, gentle saturation lift.
  const ip = scene.imageProcessingConfiguration;
  ip.vignetteEnabled = true; ip.vignetteWeight = 0.7; ip.vignetteStretch = 0.4;
  ip.vignetteColor = new Color4(0.12, 0.08, 0.05, 0);
  ip.colorCurvesEnabled = true;
  const curves = new ColorCurves(); curves.globalSaturation = 0; curves.highlightsHue = 40; curves.highlightsDensity = 3;
  ip.colorCurves = curves;
  let processingDetailed: boolean | null = null;
  const updateProcessingTier = () => {
    const detailed = document.documentElement.dataset.quality !== 'low';
    if (processingDetailed === detailed) return;
    processingDetailed = detailed;
    ip.vignetteEnabled = detailed; ip.colorCurvesEnabled = detailed;
  };
  updateProcessingTier();
  scene.onBeforeRenderObservable.add(updateProcessingTier);

  // glTF assigns material properties after registration; cap lights after imports finish.
  const pendingMaterials = [...scene.materials];
  scene.onNewMaterialAddedObservable.add(material => pendingMaterials.push(material));
  scene.onBeforeRenderObservable.add(() => {
    if (pendingMaterials.length === 0) return;
    for (const material of pendingMaterials) {
      if ('maxSimultaneousLights' in material) (material as StandardMaterial).maxSimultaneousLights = 4;
    }
    pendingMaterials.length = 0;
  });

  return scene;
}
