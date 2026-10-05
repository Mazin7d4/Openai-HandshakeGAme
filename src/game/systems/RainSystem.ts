import {
  Scene,
  ParticleSystem,
  Texture,
  Vector3,
  Color4,
} from '@babylonjs/core';

export class RainSystem {
  private scene: Scene;
  private rainSystem: ParticleSystem | null = null;
  private splashSystem: ParticleSystem | null = null;
  private mistSystem: ParticleSystem | null = null;
  private followTarget: any = null;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  public create(target: any): void {
    this.followTarget = target;
    this.createRainParticles();
    this.createSplashParticles();
    this.createMistParticles();
  }

  private createRainParticles(): void {
    this.rainSystem = new ParticleSystem('rain', 8000, this.scene);

    const rainTexture = this.createRainTexture();
    this.rainSystem.particleTexture = rainTexture;

    this.rainSystem.emitter = new Vector3(0, 30, 0);
    this.rainSystem.minEmitBox = new Vector3(-30, 25, -30);
    this.rainSystem.maxEmitBox = new Vector3(30, 30, 30);

    this.rainSystem.gravity = new Vector3(0, -45, 0);
    this.rainSystem.direction1 = new Vector3(-0.5, -1, -0.3);
    this.rainSystem.direction2 = new Vector3(0.5, -1, 0.3);

    this.rainSystem.minSize = 0.08;
    this.rainSystem.maxSize = 0.15;
    this.rainSystem.minLifeTime = 0.5;
    this.rainSystem.maxLifeTime = 1.0;
    this.rainSystem.emitRate = 4000;
    this.rainSystem.blendMode = ParticleSystem.BLENDMODE_ONEONE;
    this.rainSystem.color1 = new Color4(0.6, 0.7, 0.8, 0.4);
    this.rainSystem.color2 = new Color4(0.4, 0.5, 0.7, 0.2);
    this.rainSystem.colorDead = new Color4(0.3, 0.4, 0.5, 0);
    this.rainSystem.minAngularSpeed = 0;
    this.rainSystem.maxAngularSpeed = 0;
    this.rainSystem.minEmitPower = 1;
    this.rainSystem.maxEmitPower = 1;
    this.rainSystem.updateSpeed = 0.01;

    this.rainSystem.start();
  }

  private createSplashParticles(): void {
    this.splashSystem = new ParticleSystem('splash', 1500, this.scene);

    const splashTexture = this.createSplashTexture();
    this.splashSystem.particleTexture = splashTexture;

    this.splashSystem.emitter = new Vector3(0, 0.1, 0);
    this.splashSystem.minEmitBox = new Vector3(-25, 0, -25);
    this.splashSystem.maxEmitBox = new Vector3(25, 0, 25);

    this.splashSystem.gravity = new Vector3(0, -15, 0);
    this.splashSystem.direction1 = new Vector3(-1, 1, -1);
    this.splashSystem.direction2 = new Vector3(1, 2, 1);

    this.splashSystem.minSize = 0.05;
    this.splashSystem.maxSize = 0.15;
    this.splashSystem.minLifeTime = 0.1;
    this.splashSystem.maxLifeTime = 0.3;
    this.splashSystem.emitRate = 300;
    this.splashSystem.blendMode = ParticleSystem.BLENDMODE_ONEONE;
    this.splashSystem.color1 = new Color4(0.5, 0.6, 0.7, 0.5);
    this.splashSystem.color2 = new Color4(0.4, 0.5, 0.6, 0.3);
    this.splashSystem.colorDead = new Color4(0.3, 0.4, 0.5, 0);
    this.splashSystem.minAngularSpeed = -Math.PI;
    this.splashSystem.maxAngularSpeed = Math.PI;

    this.splashSystem.start();
  }

  private createMistParticles(): void {
    this.mistSystem = new ParticleSystem('mist', 500, this.scene);

    const mistTexture = this.createMistTexture();
    this.mistSystem.particleTexture = mistTexture;

    this.mistSystem.emitter = new Vector3(0, 0.5, 0);
    this.mistSystem.minEmitBox = new Vector3(-30, 0, -30);
    this.mistSystem.maxEmitBox = new Vector3(30, 3, 30);

    this.mistSystem.gravity = new Vector3(0, 0.2, 0);
    this.mistSystem.direction1 = new Vector3(-0.3, 0.1, -0.3);
    this.mistSystem.direction2 = new Vector3(0.3, 0.5, 0.3);

    this.mistSystem.minSize = 2;
    this.mistSystem.maxSize = 5;
    this.mistSystem.minLifeTime = 2;
    this.mistSystem.maxLifeTime = 5;
    this.mistSystem.emitRate = 80;
    this.mistSystem.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    this.mistSystem.color1 = new Color4(0.4, 0.45, 0.5, 0.03);
    this.mistSystem.color2 = new Color4(0.3, 0.35, 0.4, 0.01);
    this.mistSystem.colorDead = new Color4(0.2, 0.25, 0.3, 0);
    this.mistSystem.minAngularSpeed = -0.1;
    this.mistSystem.maxAngularSpeed = 0.1;

    this.mistSystem.start();
  }

  private createRainTexture(): Texture {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(0, 0, size, size);

    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';

    for (let i = 0; i < 8; i++) {
      const x = (i + 0.5) * (size / 8) + (Math.random() - 0.5) * 4;
      const yStart = Math.random() * size * 0.3;
      const yEnd = yStart + size * 0.6 + Math.random() * size * 0.2;
      ctx.beginPath();
      ctx.moveTo(x, yStart);
      ctx.lineTo(x + (Math.random() - 0.5) * 2, yEnd);
      ctx.stroke();
    }

    const dataUrl = canvas.toDataURL('image/png');
    return new Texture(dataUrl, this.scene, true, true, Texture.NEAREST_SAMPLINGMODE);
  }

  private createSplashTexture(): Texture {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(0, 0, size, size);

    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    for (let i = 0; i < 6; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const r = Math.random() * 3 + 1;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    const dataUrl = canvas.toDataURL('image/png');
    return new Texture(dataUrl, this.scene, true, true, Texture.NEAREST_SAMPLINGMODE);
  }

  private createMistTexture(): Texture {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    const imageData = ctx.createImageData(size, size);
    const data = imageData.data;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = (y * size + x) * 4;
        const noise = Math.sin(x * 0.1) * Math.cos(y * 0.1) * Math.sin((x + y) * 0.05);
        const val = Math.max(0, noise * 0.5 + 0.5);
        data[idx] = 255;
        data[idx + 1] = 255;
        data[idx + 2] = 255;
        data[idx + 3] = val * 80;
      }
    }
    ctx.putImageData(imageData, 0, 0);

    const dataUrl = canvas.toDataURL('image/png');
    return new Texture(dataUrl, this.scene, true, true, Texture.NEAREST_SAMPLINGMODE);
  }

  public update(): void {
    if (!this.followTarget || !this.rainSystem) return;

    const targetPos = this.followTarget.getAbsolutePosition();
    this.rainSystem.minEmitBox.x = targetPos.x - 30;
    this.rainSystem.maxEmitBox.x = targetPos.x + 30;
    this.rainSystem.minEmitBox.z = targetPos.z - 30;
    this.rainSystem.maxEmitBox.z = targetPos.z + 30;

    if (this.splashSystem) {
      this.splashSystem.minEmitBox.x = targetPos.x - 25;
      this.splashSystem.maxEmitBox.x = targetPos.x + 25;
      this.splashSystem.minEmitBox.z = targetPos.z - 25;
      this.splashSystem.maxEmitBox.z = targetPos.z + 25;
    }

    if (this.mistSystem) {
      this.mistSystem.minEmitBox.x = targetPos.x - 30;
      this.mistSystem.maxEmitBox.x = targetPos.x + 30;
      this.mistSystem.minEmitBox.z = targetPos.z - 30;
      this.mistSystem.maxEmitBox.z = targetPos.z + 30;
    }
  }

  public dispose(): void {
    this.rainSystem?.dispose();
    this.splashSystem?.dispose();
    this.mistSystem?.dispose();
  }
}