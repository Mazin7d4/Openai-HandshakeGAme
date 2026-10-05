import { Engine, Scene } from '@babylonjs/core';
import '@babylonjs/loaders';
import { InputSystem } from './systems/InputSystem';
import { CameraSystem } from './systems/CameraSystem';
import { LightingSystem } from './systems/LightingSystem';
import { Environment } from './scenes/Environment';
import { Character } from './components/Character';
import { CharacterController } from './components/CharacterController';

export class GameScene {
  private engine: Engine;
  private scene: Scene;

  private inputSystem: InputSystem;
  private cameraSystem: CameraSystem;
  private lightingSystem: LightingSystem;
  private environment: Environment;

  private character: Character;
  private characterController: CharacterController | null = null;

  private isRunning = false;
  private lastTime = 0;
  private missingAssetMessage: HTMLDivElement | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { antialias: true, stencil: true, preserveDrawingBuffer: false });
    this.scene = new Scene(this.engine);
    this.scene.collisionsEnabled = true;

    this.inputSystem = new InputSystem();
    this.cameraSystem = new CameraSystem(this.scene, canvas);
    this.lightingSystem = new LightingSystem(this.scene);
    this.environment = new Environment(this.scene);
    this.character = new Character(this.scene);

    this.engine.onResizeObservable.add(() => this.engine.resize());
    this.scene.onBeforeRenderObservable.add(() => this.update());
  }

  public async initialize(): Promise<void> {
    try {
      const sunLight = await this.lightingSystem.create();
      await this.environment.create();
      this.environment.setupShadows(sunLight);
      await this.loadCharacter();

      this.cameraSystem.setTarget(this.character.root);
      this.characterController = new CharacterController(this.character, this.cameraSystem, this.scene);

      this.hideMissingAssetMessage();
      this.isRunning = true;
      (window as any).gameScene = this;
    } catch (error) {
      console.error('Failed to initialize game:', error);
      this.showMissingAssetMessage();
      throw error;
    }
  }

  private async loadCharacter(): Promise<void> {
    try { await this.character.load(); console.log('Character loaded successfully'); }
    catch (error) { console.error('Failed to load character:', error); this.showMissingAssetMessage(); throw error; }
  }

  private showMissingAssetMessage(): void {
    if (this.missingAssetMessage) return;
    this.missingAssetMessage = document.createElement('div');
    this.missingAssetMessage.id = 'missing-asset-message';
    this.missingAssetMessage.style.cssText = `position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(10,12,18,0.95); border: 2px solid #3a3f4a; border-radius: 8px; padding: 32px 48px; color: #e8e6e3; font-family: system-ui, sans-serif; font-size: 18px; line-height: 1.5; text-align: center; z-index: 1000; box-shadow: 0 20px 40px rgba(0,0,0,0.5); max-width: 90vw;`;
    this.missingAssetMessage.innerHTML = `<div style="margin-bottom: 16px; color: #c084fc;">Character failed to load</div><div style="font-family: monospace; font-size: 14px; color: #9ca3af; margin-bottom: 20px;">Expected <strong>player.glb</strong> in:<br><code style="color: #6ee7b7;">/public/assets/character/</code></div>`;
    document.body.appendChild(this.missingAssetMessage);
  }

  private hideMissingAssetMessage(): void { if (this.missingAssetMessage) { this.missingAssetMessage.remove(); this.missingAssetMessage = null; } }

  private update(): void {
    if (!this.isRunning) return;
    const currentTime = performance.now();
    const deltaTime = Math.min((currentTime - this.lastTime) / 1000, 1 / 30);
    this.lastTime = currentTime;

    const input = this.inputSystem.getState();
    this.cameraSystem.update(deltaTime);
    this.characterController?.update(input, deltaTime);
    this.character.update(deltaTime);
    this.lightingSystem.update(currentTime);
  }

  public run(): void { this.lastTime = performance.now(); this.engine.runRenderLoop(() => { if (this.isRunning) this.scene.render(); }); }

  public dispose(): void { this.isRunning = false; this.inputSystem.dispose(); this.cameraSystem.dispose(); this.lightingSystem.dispose(); this.environment.dispose(); this.character.dispose(); this.characterController?.dispose(); this.scene.dispose(); this.engine.dispose(); this.hideMissingAssetMessage(); }

  public getScene(): Scene { return this.scene; }
  public getEngine(): Engine { return this.engine; }
}