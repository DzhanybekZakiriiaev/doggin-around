import react from '@vitejs/plugin-react';
import { cpSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { scribeToken } from './server/scribe-token.ts'

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

// Local development and Vercel use the same server-only token handler.
function scribeTokenPlugin(apiKey: string): Plugin {
  const configure = (server: { middlewares: import('vite').Connect.Server }) => {
    server.middlewares.use((request, response, next) => {
      if (request.url?.split('?')[0] !== '/api/scribe-token') return next()
      void scribeToken(request, response, apiKey)
    })
  }
  return {
    name: 'scribe-token',
    configureServer: configure,
    configurePreviewServer: configure,
  }
}

// Two pages: the game (React menu + the walkable comic, index.html) and the dev viewer with its HUD
// (viewer.html: every downloaded world, collider view, fly mode, hand-animation previews).
export default defineConfig(({ mode }) => ({
  plugins: [react(), copyWorlds(), scribeTokenPlugin(loadEnv(mode, import.meta.dirname, '').ELEVENLABS_API_KEY)],
  build: {
    target: 'es2022', // top-level await (Rapier's init)
    // Keep the audio worklet a real file: `addModule` would accept an inlined data URL, but a served module
    // is what every browser handles alike.
    assetsInlineLimit: (file: string) => (file.endsWith('pcm-worklet.js') ? false : undefined),
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        viewer: resolve(import.meta.dirname, 'viewer.html'),
      },
    },
  },
}));
