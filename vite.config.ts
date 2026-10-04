import react from '@vitejs/plugin-react';
import { cpSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// The game fetches the Marble worlds from /worlds/out/… at runtime. In dev Vite serves them straight from the
// project folder; a build copies them into dist/, so dist/ is the whole site for any static host (or Docker).
const copyWorlds = (): Plugin => ({
  name: 'copy-worlds',
  apply: 'build',
  closeBundle() {
    cpSync(resolve(import.meta.dirname, 'worlds/out'), resolve(import.meta.dirname, 'dist/worlds/out'), {
      recursive: true,
      filter: (source) => !source.endsWith('pano.png'), // only needed to regenerate a world
    });
  },
});

// Two pages: the game (React menu + the walkable comic, index.html) and the dev viewer with its HUD
// (viewer.html: every downloaded world, collider view, fly mode, hand-animation previews).
export default defineConfig({
  plugins: [react(), copyWorlds()],
  build: {
    target: 'es2022', // top-level await (Rapier's init)
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        viewer: resolve(import.meta.dirname, 'viewer.html'),
      },
    },
  },
});
