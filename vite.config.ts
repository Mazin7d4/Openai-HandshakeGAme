import { readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { defineConfig, searchForWorkspaceRoot, type Plugin } from 'vite';

let commitSha = 'dev';
try {
  commitSha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
} catch (_) {}
process.env.VITE_COMMIT_SHA = commitSha;

const rootDir = dirname(fileURLToPath(import.meta.url));

// Public URL prefix. Local dev and tests use '/'; the GitHub Pages build sets
// BASE_PATH=/Openai-HandshakeGAme/ so every asset resolves under the repo subpath.
function basePath(): string {
  const raw = process.env.BASE_PATH?.trim();
  if (!raw || raw === '/') {
    return '/';
  }
  return `/${raw.replace(/^\/+|\/+$/g, '')}/`;
}

// Blender sources live next to their exported .glb files in public/ so the
// export scripts can round-trip them; they must never ship to players.
const SOURCE_ONLY = /\.(blend\d*|py)$/i;

function stripSourceAssets(): Plugin {
  let outDir = 'dist';
  return {
    name: 'strip-source-assets',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const walk = (dir: string): void => {
        for (const name of readdirSync(dir)) {
          const path = join(dir, name);
          if (statSync(path).isDirectory()) {
            walk(path);
          } else if (SOURCE_ONLY.test(name)) {
            rmSync(path);
          }
        }
      };
      walk(outDir);
    },
  };
}

export default defineConfig({
  base: basePath(),
  plugins: [stripSourceAssets()],
  server: {
    fs: {
      // Parent of the package root so symlinked/hoisted node_modules can serve
      // HavokPhysics.wasm via /@fs/… (otherwise Vite 403s and Night Shift boot hangs).
      allow: [searchForWorkspaceRoot(rootDir), resolve(rootDir, '..')],
    },
  },
  optimizeDeps: {
    exclude: ['@babylonjs/havok'],
  },
});
