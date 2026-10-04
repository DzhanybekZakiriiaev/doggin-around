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
