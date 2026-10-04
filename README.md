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

## Deploy

It's a static site: `npm run build` puts everything in `dist/`, the Marble worlds included (~170 MB, most of
it splats). Serve that from any static host, or use the Docker image (nginx, listens on `$PORT`, default 8080):

```bash
docker build -t doggin-around .
docker run --rm -p 8080:8080 doggin-around   # http://localhost:8080, health check at /healthz
```
