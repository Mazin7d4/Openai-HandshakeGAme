import { test, expect, Page, ConsoleMessage } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const SCREENSHOT_DIR = 'playwright-screenshots';

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

test.describe.configure({ retries: 0 });

test.describe('Monsoon Run - Diagnostic Playtest', () => {
  let page: Page;
  let errors: string[] = [];
  const logs: any[] = [];

  test.beforeAll(async ({ browser }) => {
    ensureDir(SCREENSHOT_DIR);
    page = await browser.newPage();
    
    page.on('console', (msg: ConsoleMessage) => {
      const text = msg.text();
      const type = msg.type();
      logs.push({ type, text, location: msg.location() });
      if (type === 'error') errors.push(text);
      console.log(`[${type.toUpperCase()}] ${text}`);
    });
    
    page.on('pageerror', (err) => {
      errors.push(err.message);
      console.log('[PAGE ERROR]', err.message);
    });

    await page.goto('http://localhost:5174', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3000);
    
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible({ timeout: 10000 });
  });

  test.afterAll(async () => {
    await page?.close();
    fs.writeFileSync(path.join(SCREENSHOT_DIR, 'console-logs.json'), JSON.stringify(logs, null, 2));
    console.log('\n=== TEST COMPLETE ===');
    console.log(`Errors: ${errors.length}`);
    errors.forEach(e => console.log('  -', e));
  });

  async function screenshot(name: string) {
    const file = path.join(SCREENSHOT_DIR, `${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log(`Screenshot: ${file}`);
  }

  async function waitForGameReady() {
    await page.waitForFunction(() => {
      const msg = document.getElementById('missing-asset-message');
      return !msg || msg.style.display === 'none';
    }, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1000);
  }

  async function pressKey(key: string, duration: number) {
    await page.keyboard.down(key);
    await page.waitForTimeout(duration);
    await page.keyboard.up(key);
  }

  async function pressKeys(keys: string[], duration: number) {
    for (const k of keys) await page.keyboard.down(k);
    await page.waitForTimeout(duration);
    for (const k of keys) await page.keyboard.up(k);
  }

  test('1. Initial state - diagnostic', async () => {
    await waitForGameReady();
    await page.waitForTimeout(1000);
    await screenshot('01-initial-diagnostic');
    
    const gameState = await page.evaluate(() => {
      const gameScene = (window as any).gameScene;
      if (!gameScene) return { error: 'No gameScene on window' };
      
      const scene = gameScene.getScene?.();
      if (!scene) return { error: 'No scene' };
      
      const camera = scene.activeCamera;
      const character = scene.getTransformNodeByName('characterRoot');
      
      return {
        cameraPosition: camera?.position ? { x: camera.position.x, y: camera.position.y, z: camera.position.z } : null,
        cameraTarget: camera?.getTarget ? { x: camera.getTarget().x, y: camera.getTarget().y, z: camera.getTarget().z } : null,
        characterPosition: character?.getAbsolutePosition ? { x: character.getAbsolutePosition().x, y: character.getAbsolutePosition().y, z: character.getAbsolutePosition().z } : null,
        activeMeshes: scene.meshes.length,
      };
    });
    console.log('Game state:', JSON.stringify(gameState, null, 2));
  });

  test('2. Walk - W for 2s', async () => {
    await pressKey('KeyW', 2000);
    await page.waitForTimeout(500);
    await screenshot('02-walk-forward');
  });

  test('3. Run - Shift+W for 2s', async () => {
    await pressKeys(['Shift', 'KeyW'], 2000);
    await page.waitForTimeout(500);
    await screenshot('03-run-forward');
  });

  test('4. Jump - Space', async () => {
    await pressKey('Space', 200);
    await page.waitForTimeout(1000);
    await screenshot('04-jump');
  });

  test('5. Walk + Jump', async () => {
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(500);
    await page.keyboard.down('Space');
    await page.waitForTimeout(200);
    await page.keyboard.up('Space');
    await page.waitForTimeout(1000);
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(500);
    await screenshot('05-walk-jump');
  });

  test('6. Camera orbit', async () => {
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 400, box.y + box.height / 2, { steps: 15 });
      await page.mouse.up();
      await page.waitForTimeout(500);
      await screenshot('06-camera-orbit');
    }
  });

  test('7. Check world state after movement', async () => {
    const worldState = await page.evaluate(() => {
      const gameScene = (window as any).gameScene;
      if (!gameScene) return { error: 'No gameScene on window' };
      
      const scene = gameScene.getScene?.();
      if (!scene) return { error: 'No scene' };
      
      const camera = scene.activeCamera;
      const character = scene.getTransformNodeByName('characterRoot');
      
      return {
        cameraPosition: camera?.position ? { x: camera.position.x, y: camera.position.y, z: camera.position.z } : null,
        cameraTarget: camera?.getTarget ? { x: camera.getTarget().x, y: camera.getTarget().y, z: camera.getTarget().z } : null,
        characterPosition: character?.getAbsolutePosition ? { x: character.getAbsolutePosition().x, y: character.getAbsolutePosition().y, z: character.getAbsolutePosition().z } : null,
        activeMeshes: scene.meshes.length,
      };
    });
    console.log('World state:', JSON.stringify(worldState, null, 2));
    await screenshot('07-final-world-state');
  });
});