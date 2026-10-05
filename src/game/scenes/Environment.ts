import {
  Scene, MeshBuilder, PBRMaterial, Color3, Vector3,
  TransformNode, ShadowGenerator, DirectionalLight
} from '@babylonjs/core';

export class Environment {
  private scene: Scene;
  private root: TransformNode;
  private shadowGenerator: ShadowGenerator | null = null;

  constructor(scene: Scene) {
    this.scene = scene;
    this.root = new TransformNode('environmentRoot', scene);
  }

  public async create(): Promise<void> {
    this.createMaterials();
    this.createTestArea();
  }

  private createMaterials(): void {
    // Ground - visible, light gray concrete
    const groundMat = new PBRMaterial('groundMat', this.scene);
    groundMat.albedoColor = new Color3(0.55, 0.55, 0.58);
    groundMat.roughness = 0.8;
    groundMat.metallic = 0;
    groundMat.environmentIntensity = 1.0;

    // Blocks - darker
    const blockMat = new PBRMaterial('blockMat', this.scene);
    blockMat.albedoColor = new Color3(0.35, 0.35, 0.38);
    blockMat.roughness = 0.7;
    blockMat.metallic = 0;
    blockMat.environmentIntensity = 1.0;

    // Ramps - slightly different
    const rampMat = new PBRMaterial('rampMat', this.scene);
    rampMat.albedoColor = new Color3(0.4, 0.4, 0.45);
    rampMat.roughness = 0.75;
    rampMat.metallic = 0;
    rampMat.environmentIntensity = 1.0;

    (this.scene as any).materialsLibrary = { ground: groundMat, block: blockMat, ramp: rampMat };
  }

  private getMat(name: string): PBRMaterial {
    return (this.scene as any).materialsLibrary[name];
  }

  private createTestArea(): void {
    const matGround = this.getMat('ground');
    const matBlock = this.getMat('block');
    const matRamp = this.getMat('ramp');

    // Large flat ground
    const ground = MeshBuilder.CreateBox('ground', { width: 60, height: 0.5, depth: 60 }, this.scene);
    ground.position.set(0, -0.25, 0);
    ground.material = matGround;
    ground.checkCollisions = true;

    // 4 boundary walls
    const wallH = 3, wallT = 0.5;
    const wallMat = matBlock;
    const createWall = (name: string, pos: Vector3, size: Vector3) => {
      const w = MeshBuilder.CreateBox(name, { width: size.x, height: size.y, depth: size.z }, this.scene);
      w.position.copyFrom(pos); w.material = wallMat; w.checkCollisions = true;
    };
    createWall('wallN', new Vector3(0, wallH * 0.5, -30), new Vector3(60, wallH, wallT));
    createWall('wallS', new Vector3(0, wallH * 0.5, 30), new Vector3(60, wallH, wallT));
    createWall('wallW', new Vector3(-30, wallH * 0.5, 0), new Vector3(wallT, wallH, 60));
    createWall('wallE', new Vector3(30, wallH * 0.5, 0), new Vector3(wallT, wallH, 60));

    // Waist-high blocks (obstacles)
    const blockData = [
      { pos: new Vector3(-15, 0.75, -10), size: new Vector3(4, 1.5, 4) },
      { pos: new Vector3(15, 0.75, -10), size: new Vector3(3, 1.5, 3) },
      { pos: new Vector3(0, 0.75, 15), size: new Vector3(5, 1.5, 5) },
      { pos: new Vector3(-20, 0.75, 20), size: new Vector3(3, 1.5, 6) },
      { pos: new Vector3(20, 0.75, 5), size: new Vector3(4, 1.5, 4) },
      { pos: new Vector3(-5, 0.75, -20), size: new Vector3(6, 1.5, 3) },
    ];
    blockData.forEach((b, i) => {
      const blk = MeshBuilder.CreateBox(`block_${i}`, { width: b.size.x, height: b.size.y, depth: b.size.z }, this.scene);
      blk.position.copyFrom(b.pos); blk.material = matBlock; blk.checkCollisions = true;
    });

    // 2 ramps
    this.createRamp('ramp1', new Vector3(-25, 0, -20), new Vector3(-25, 3, -26), 5, matRamp);
    this.createRamp('ramp2', new Vector3(20, 0, 20), new Vector3(20, 2, 28), 4, matRamp);

    // 3 platforms at different heights
    this.createPlatform('platform1', new Vector3(-20, 3, 10), new Vector3(8, 0.5, 8), matBlock);
    this.createPlatform('platform2', new Vector3(15, 2, -20), new Vector3(6, 0.5, 6), matBlock);
    this.createPlatform('platform3', new Vector3(0, 4, 0), new Vector3(5, 0.5, 5), matBlock);

    // Simple staircase
    this.createStairs('stairs', new Vector3(-25, 0, 15), 8, 0.3, 0.5, 3, matBlock);
  }

  private createWall(name: string, pos: Vector3, size: Vector3): void {
    const w = MeshBuilder.CreateBox(name, { width: size.x, height: size.y, depth: size.z }, this.scene);
    w.position.copyFrom(pos); w.material = this.getMat('block'); w.checkCollisions = true;
  }

  private createPlatform(name: string, pos: Vector3, size: Vector3, mat: PBRMaterial): void {
    const p = MeshBuilder.CreateBox(name, { width: size.x, height: size.y, depth: size.z }, this.scene);
    p.position.copyFrom(pos); p.material = mat; p.checkCollisions = true;

    // Low edge walls
    const edgeH = 0.8, edgeT = 0.2;
    this.createWall(`${name}_edgeN`, new Vector3(pos.x, pos.y + edgeH * 0.5, pos.z - size.z * 0.5), new Vector3(size.x, edgeH, edgeT));
    this.createWall(`${name}_edgeS`, new Vector3(pos.x, pos.y + edgeH * 0.5, pos.z + size.z * 0.5), new Vector3(size.x, edgeH, edgeT));
    this.createWall(`${name}_edgeW`, new Vector3(pos.x - size.x * 0.5, pos.y + edgeH * 0.5, pos.z), new Vector3(edgeT, edgeH, size.z));
    this.createWall(`${name}_edgeE`, new Vector3(pos.x + size.x * 0.5, pos.y + edgeH * 0.5, pos.z), new Vector3(edgeT, edgeH, size.z));
  }

  private createRamp(name: string, from: Vector3, to: Vector3, width: number, mat: PBRMaterial): void {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const length = Math.sqrt(dx * dx + dz * dz);
    const ramp = MeshBuilder.CreateBox(name, { width, height: 0.3, depth: length }, this.scene);
    const midX = (from.x + to.x) * 0.5, midZ = (from.z + to.z) * 0.5;
    const midY = (from.y + to.y) * 0.5 + 0.15;
    ramp.position.set(midX, midY, midZ);
    ramp.rotation.y = Math.atan2(dx, dz);
    ramp.rotation.x = Math.atan2(dy, length);
    ramp.material = mat; ramp.checkCollisions = true;
  }

  private createStairs(name: string, from: Vector3, count: number, stepH: number, stepD: number, stepW: number, mat: PBRMaterial): void {
    for (let i = 0; i < count; i++) {
      const s = MeshBuilder.CreateBox(`${name}_${i}`, { width: stepW, height: stepH, depth: stepD }, this.scene);
      s.position.set(from.x, from.y + i * stepH + stepH * 0.5, from.z + i * stepD + stepD * 0.5);
      s.material = mat; s.checkCollisions = true;
    }
  }

  public setupShadows(light: DirectionalLight): void {
    this.shadowGenerator = new ShadowGenerator(2048, light);
    this.shadowGenerator.useBlurExponentialShadowMap = true;
    this.shadowGenerator.blurScale = 2;
    this.shadowGenerator.setDarkness(0.3);
    this.root.getChildMeshes().forEach(m => { if (m.checkCollisions) this.shadowGenerator?.addShadowCaster(m); });
  }

  public getRoot(): TransformNode { return this.root; }
  public dispose(): void { this.root.dispose(); if (this.shadowGenerator) this.shadowGenerator.dispose(); }
}