import { Scene, DirectionalLight, HemisphericLight, Color3, Vector3, Mesh, PBRMaterial } from '@babylonjs/core';

export class LightingSystem {
  private scene: Scene;
  private sunLight: DirectionalLight | null = null;
  private ambientLight: HemisphericLight | null = null;
  private skybox: Mesh | null = null;

  constructor(scene: Scene) { this.scene = scene; }

  public async create(): Promise<DirectionalLight> {
    this.createSkybox();
    this.createSunLight();
    this.createAmbientLight();
    this.configureSceneEnvironment();
    return this.sunLight!;
  }

  private createSkybox(): void {
    this.skybox = Mesh.CreateBox('skybox', 500, this.scene);
    this.skybox.infiniteDistance = true;
    const mat = new PBRMaterial('skyMat', this.scene);
    mat.unlit = true; mat.backFaceCulling = false; mat.metallic = 0; mat.roughness = 1;
    mat.albedoColor = new Color3(0.5, 0.7, 0.95); // bright sky blue
    mat.emissiveColor = new Color3(0.5, 0.7, 0.95); mat.emissiveIntensity = 1.0;
    mat.environmentIntensity = 0;
    this.skybox.material = mat;
  }

  private createSunLight(): void {
    this.sunLight = new DirectionalLight('sunLight', new Vector3(-0.3, -0.7, -0.5), this.scene);
    this.sunLight.intensity = 1.2;
    this.sunLight.diffuse = new Color3(1, 0.95, 0.85);
    this.sunLight.specular = new Color3(0.6, 0.5, 0.4);
    this.sunLight.shadowMinZ = 1; this.sunLight.shadowMaxZ = 80; this.sunLight.shadowOrthoScale = 35;
  }

  private createAmbientLight(): void {
    this.ambientLight = new HemisphericLight('ambientLight', new Vector3(0, 1, 0), this.scene);
    this.ambientLight.intensity = 0.5;
    this.ambientLight.diffuse = new Color3(0.7, 0.8, 0.9);
    this.ambientLight.specular = new Color3(0.2, 0.2, 0.25);
    this.ambientLight.groundColor = new Color3(0.3, 0.35, 0.4);
  }

  private configureSceneEnvironment(): void {
    this.scene.imageProcessingConfiguration.toneMappingEnabled = true;
    this.scene.imageProcessingConfiguration.toneMappingType = 2; // ACES
    this.scene.imageProcessingConfiguration.exposure = 1.0;
    this.scene.imageProcessingConfiguration.contrast = 1.05;
    this.scene.imageProcessingConfiguration.colorCurvesEnabled = true;
    const curves = this.scene.imageProcessingConfiguration.colorCurves;
    if (curves) { curves.globalHue = 0; curves.globalSaturation = 1.0; curves.globalDensity = 0; curves.globalExposure = 0; }
  }

  public getSunLight(): DirectionalLight | null { return this.sunLight; }
  public update(time: number): void {
    if (this.sunLight) {
      const angle = time * 0.00005;
      this.sunLight.direction = new Vector3(-0.3 * Math.cos(angle), -0.7, -0.5 * Math.cos(angle)).normalize();
    }
  }
  public dispose(): void { this.sunLight?.dispose(); this.ambientLight?.dispose(); this.skybox?.dispose(); }
}