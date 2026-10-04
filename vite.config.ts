import react from '@vitejs/plugin-react';
import { cpSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Connect, defineConfig, loadEnv, type Plugin } from 'vite';

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

const TOKEN_ROUTE = '/api/scribe-token';
const MINT = 'https://api.elevenlabs.io/v1/single-use-token/realtime_scribe';

/**
 * Mints the short-lived realtime token the browser opens its Scribe socket with (src/voice/scribe.ts), so the
 * ElevenLabs API key stays on this machine. `loadEnv` reads it with an empty prefix, which keeps it out of the
 * client bundle: Vite only inlines variables matching `envPrefix`, and `VITE_` is deliberately not used here.
 *
 * This runs in `vite dev` and `vite preview` only. A built site served by anything else (the Dockerfile's
 * nginx) needs the same route in front of it, or voice control stays off.
 */
function scribeToken(apiKey: string): Plugin {
  const handler: Connect.NextHandleFunction = (request, response, next) => {
    if (!request.url?.startsWith(TOKEN_ROUTE)) {
      next();
      return;
    }
    const reply = (status: number, body: unknown) => {
      response.statusCode = status;
      response.setHeader('content-type', 'application/json');
      response.setHeader('cache-control', 'no-store');
      response.end(JSON.stringify(body));
    };
    if (request.method !== 'POST') return reply(405, { error: 'Use POST' });
    if (!apiKey) return reply(503, { error: 'Set ELEVENLABS_API_KEY in .env, then restart the dev server' });
    void fetch(MINT, { method: 'POST', headers: { 'xi-api-key': apiKey } })
      .then(async (minted) => {
        const payload = (await minted.json().catch(() => ({}))) as { token?: string };
        if (!minted.ok || !payload.token)
          return reply(minted.ok ? 502 : minted.status, { error: `ElevenLabs refused the token request (${minted.status})` });
        reply(200, { token: payload.token });
      })
      .catch(() => reply(502, { error: 'Could not reach ElevenLabs' }));
  };
  return {
    name: 'scribe-token',
    configureServer: (server) => void server.middlewares.use(handler),
    configurePreviewServer: (server) => void server.middlewares.use(handler),
  };
}

// Two pages: the game (React menu + the walkable comic, index.html) and the dev viewer with its HUD
// (viewer.html: every downloaded world, collider view, fly mode, hand-animation previews).
export default defineConfig(({ mode }) => ({
  plugins: [react(), copyWorlds(), scribeToken(loadEnv(mode, import.meta.dirname, '').ELEVENLABS_API_KEY)],
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
