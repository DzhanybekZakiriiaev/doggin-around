# doggin-around

**Storm Night**: a comic whose first panel you can step into. Upload the comic, meet Biscuit (an animated
Gaussian-splat dog), jump into panel 1 and play it in first person in a World Labs Marble world. What you do
there changes how the comic ends.

```bash
npm install
npm run dev        # http://localhost:5173 (the game), /viewer.html (dev viewer)
```

- `src/App.tsx`, `src/index.css`: the menu (upload, the comic page, the way in and back out).
- `src/game/`: the game: worlds, first-person player, hands, Biscuit, the quest (`game.ts` ties it together).
- `src/voice/`: speech to text (ElevenLabs Scribe v2 Realtime) and the keyword parser behind it.
- `docs/progress.md`: where things stand. `docs/demo-quest.md`: the demo plan. `worlds/README.md`: the world
  pipeline and the game's systems in detail.

## Companions

On the comic screen, use the portrait rail on the left to switch between Hua (white) and Wei (tricolor). Press X to
preview that dog's skills. The wheel also works inside the comic. Its arrows, or the left and right arrow
keys, move between pages. Escape closes it. Only clips belonging to the loaded model are offered.
Hua's Peekaboo clip is excluded. Changing dogs closes the old wheel and resets the preview pose.

Hua includes the 29-clip asset from the dog sandbox, with 28 clips available in this app. Wei uses
its own 12 clips and face-bound Gaussian reconstruction. `src/game/companions.ts` defines the models,
portraits, and skill filtering. A failed load leaves the current companion in place so you can retry.

Wei's runtime bundle is tracked in `public/models/tricolor-research/` and included automatically in the
production build. It contains the GLB, manifest, splats, face bindings, head-look metadata, and animation
samples. Training archives and diagnostic files stay local. No separate asset copy is needed for a fresh
checkout or deployment. The browser tests require installed Google Chrome.

```bash
npm run typecheck
npm run test:e2e
npm run build
```

## Deploy

It's a static site: `npm run build` puts everything in `dist/`, the Marble worlds included (~170 MB, most of
it splats). Serve that from any static host, or use the Docker image (nginx, listens on `$PORT`, default 8080):

```bash
docker build -t doggin-around .
docker run --rm -p 8080:8080 doggin-around   # http://localhost:8080, health check at /healthz
```

## Voice control

Inside the comic world, hold **F**, wait for **Listening**, say “Biscuit, sit”, and release F.
The browser asks for microphone access on the first hold. Voice commands also include jump, bark,
spin, dig, come here, and fetch when carrying a throwable object.

For local use, copy `.env.example` to `.env.local`, set `ELEVENLABS_API_KEY`, and restart Vite.
For Vercel, set the same server environment variable for the deployment environment and redeploy.
`api/scribe-token.ts` provides the production endpoint. Never prefix this key with `VITE_`.
The browser receives only a short-lived token, following the
[ElevenLabs client-side flow](https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/client-side-streaming).

A plain static host or the nginx Docker image needs a separate server for `/api/scribe-token`.
Voice remains off without that route or a configured key. The rest of the game still works.
Run `npm run voice-check` for the spoken command parser and `npm run test:voice` for server and browser checks.
Browser checks use simulated audio and ElevenLabs responses, including a Sit command in the real comic world.
