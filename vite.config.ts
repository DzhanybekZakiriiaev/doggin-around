import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Two pages: the game (React menu + the walkable comic, index.html) and the dev viewer with its HUD
// (viewer.html: every downloaded world, collider view, fly mode, hand-animation previews).
export default defineConfig({
  plugins: [react()],
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
