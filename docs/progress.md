# Progress: Doggin' Around / Storm Night

Last updated 2026-10-04, branch `world-generation`.

## Where it stands

The whole demo loop runs in one page (`npm run dev` → http://localhost:5173):

1. **Upload your comic** (page 1, the React menu from the `frontend` branch). Upload `public/comic/storm-night-bad-ending.png`, the lettered bad-ending page. The splat worlds and Biscuit start loading in the background straight away; the top bar shows progress, then "World ready".
2. **The comic** (page 2). Biscuit, the real animated splat dog, idles on his stand; drag to turn him, tap to make him wag. The Storm Night comic page shows the bad ending: five panels with slanted ink frames, narration, speech bubbles, sound effects and "THE END?".
3. **Step into panel 1.** Biscuit turns, crouches and leaps in 3D into the panel, landing where he's painted. The panel fills the screen and dissolves through two Gemini-painted in-between frames into a capture of the game's opening view. That frame holds until the live game has really drawn the yard, then fades into the identical live picture. Mouse look is captured on the click, so there's no "click to play" in between.
4. **Play** (first person in the Marble yard): the door is locked; "Biscuit, dig!" at the fresh hole by the porch; he digs and the spare key pops out; pick it up, unlock the door, walk in with him.
5. **Quest complete**: a card takes you back to the comic, where panels 2 to 5 ink themselves into the good ending ("THE END").

`/viewer.html` is the dev viewer: any downloaded world, collider view, fly mode, hand-animation previews, splat or mesh hands. Add `?quest=1` to play the quest there.

## Done

- **Worlds**: World Labs Marble pipeline (`npm run worlds`), single-plate generation, Gemini pano repair, final yard and cabin worlds committed (`worlds/out`). Rapier colliders from Marble's collider meshes.
- **First person**: kinematic capsule controller, adaptive quality (works without a GPU), drag-to-look fallback, doors with swinging leaves and comic iris transitions between yard and cabin.
- **Hands**: rigged WebXR hand with a library of procedural actions (open/pull door, pick up, throw, point, beckon, pat, knock…), petting, held props. Drawn as Gaussian splats coloured from Gemini-painted matcaps (mesh fallback).
- **Biscuit**: Larry's 50k-splat Huawei dog (`larry/dogmodels`), sized and tinted per world. Follows, runs, fetches thrown sticks, comes through doors, side-on petting with the player crouching, digs on command.
- **Dog animation**: procedural IK legs (`src/game/dog-gait.ts`: planted paws per ground point, four-beat walk and trot, heel-off). The GLB's walk and run clips are rebuilt from the same gait (`npm run dog-clips`), keeping Larry's speed contract; everything else in the file is byte-identical.
- **Quest**: Storm Night (locked door → dig → key → unlock → cabin → complete), objectives on screen.
- **Menu integration**: the `frontend` branch's React app (copied in, not merged: the merge was blocked as a shared-history change) is the shell; the game is one module (`src/game/game.ts`) with a hidden/showcase/play mode, background preloading and warm-up.
- **Rain** (`src/game/rain.ts`): streaks falling round the player in the yard, splash rings on the ground, and rain sound made with Web Audio (muffled on the roof in the cabin). The drops move in the vertex shader; a depth map of the collider seen from above keeps them off the porch, out of the house and from falling through the ground. Fewer drops without a GPU; a "Rain" toggle in the viewer.
- **Deploy**: `npm run build` copies the worlds into `dist/`, so it's a self-contained static site; `Dockerfile` serves it with nginx on `$PORT`.
- **Comic art** (Gemini, from the scene plates + the official Biscuit reference): `npm run comic` (9 panels: shared panel 1, four bad, four good), `npm run comic-page` (lettered PNG pages for both endings), `npm run comic-transition` (in-between frames for the panel-to-game dissolve).

## Open / next

- **Check on a GPU machine**: everything above was tested in headless Edge and the in-app browser on a GPU-less VM (software rendering). The transition timings, the "world drawn" wait and the splat budgets should be confirmed on the demo laptop.
- **Re-capture the opening frame after any world or placement change**: `public/comic/transition/game-start.jpg` must match the game's first view. In the dev console after entering the yard: `copy(await game.captureFrame())`, save it, then `npm run comic-transition`. The capture leaves the rain out: it comes in as the frame fades into the live game.
- **Rain needs a look in a real browser**: density, streak brightness, splash size and sound level are first guesses, and the shelter map ignores collider geometry above 9 m (treetops, sky) but treats lower canopies as roofs; tune the constants at the top of `src/game/rain.ts`.
- **No dig clip**: Biscuit "digs" with the paw clip plus dirt clods. A real dig animation from Larry would read better.
- **Uploaded comic is decorative**: the demo always plays Storm Night, whatever is uploaded.
- **Voice** ("Biscuit, dig!" spoken; the `speech-integration` branch) is not wired in; E triggers the dig.
- **`frontend` history**: the menu files were copied, so draco-dominus's commits aren't in this branch's history. A real merge of `origin/frontend` (done by hand) would keep it.
- **Dog GLB size**: `npm run dog-clips -- --prune` would drop ~5.7 MB of unreferenced data from `dog-animated.glb` (8.9 → 3.1 MB download).
