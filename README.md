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

The Tricolor reconstruction is a local demo bundle and stays outside Git. For a fresh checkout, copy
`public/models/tricolor-research/` from the existing dog-model checkout into the same path here. It contains
the GLB, manifest, splats, face bindings, head-look metadata, and animation samples. Both reference portraits
are tracked. The browser tests require that bundle and installed Google Chrome.

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
