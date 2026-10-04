# Doggin’ Around

Step inside **Storm Night**, an interactive comic, with a Gaussian-splat dog by your side. Explore a rainy 3D world, solve a small quest, and change how the story ends.

[Play the demo](https://itslowkey.tech/) · Built for SFU StormHacks 2026

## Features

- **Two companions:** Hua and Wei, each with their own appearance and tricks.
- **Interactive pets:** Pet, fetch, dig, and choose animations from the skills wheel.
- **Voice commands:** Hold F and speak to your dog using ElevenLabs speech-to-text.
- **Immersive worlds:** World Labs environments with physics, rain, and spatial audio.

**Stack:** React, TypeScript, Vite, Three.js, Spark Gaussian splatting, Rapier, World Labs, and ElevenLabs.

## Run locally

Requires Node.js 22+.

```bash
npm install
npm run dev
```

Open the URL printed in your terminal. The included demo worlds and dog assets require no generation setup.

**Controls:** WASD to move · Shift to run · E to interact · X for skills · F to talk · V to call your dog · T to throw · Esc to release the cursor.

## Enable voice

Copy `.env.example` to `.env.local`, set `ELEVENLABS_API_KEY`, and restart the server. Inside the comic, hold F, wait for **Listening**, say “Biscuit, sit”, and release.

For Vercel, add the same environment variable and redeploy. Keep the key server-side, without a `VITE_` prefix. Other static hosts need a backend for `/api/scribe-token`.

## Build and test

```bash
npm run build
npm run test:e2e
npm run test:voice
```

Build output is in `dist/`. Browser tests require Google Chrome.

See [the world pipeline](worlds/README.md) and [the demo quest](docs/demo-quest.md) for more detail.
