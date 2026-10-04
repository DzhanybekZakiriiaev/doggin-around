# Progress: Doggin' Around / Storm Night

Last updated 2026-10-04, branch `world-generation`.

## Where it stands

The whole demo loop runs in one page (`npm run dev` → http://localhost:5173):

1. **Upload your comic** (page 1, the React menu from the `frontend` branch, with its theme music, click and hover sounds and volume control). Upload `public/comic/storm-night-bad-ending.png`, the lettered bad-ending page. The splat worlds and Biscuit start loading in the background straight away; the top bar shows progress, then "World ready".
2. **Bringing it to life** (23 s, `src/Pipeline.tsx`): a comic page that plays the pipeline. Gemini reads the page and lifts Biscuit out of panel 1, paints him from every side as a wireframe; then the game's own Biscuit, drawn live: his mesh in X-ray with the 41-joint rig inside, the mesh, the 50,000 Gaussian splats going on, and the splat dog walking and running on his own clips. It hands straight over to page 2 (no chapter card).
3. **The comic** (page 2). Biscuit idles on his stand; drag to turn him, tap to make him wag. The comic is the bad ending: five panels, "THE END?".
4. **Step into panel 1.** The music stops on the click. Biscuit leaps into the panel, which fills the screen and dissolves through five Gemini in-betweens (all comic → barely inked, with rain over them) into a capture of the game's opening view, then the live game.
5. **Play** (first person in the Marble yard, in the rain): the door is locked; "Biscuit, dig!" at the fresh hole by the porch; he digs up the spare key; take it to the door and turn it in the lock. The cabin is freezing: bring the two branches from the yard (outlined in orange, in view from the start; they can be carried with the key) and lay them on the grate. The fire catches and the story ends well.
6. **Quest complete**: back to the comic, where panels 2 to 5 ink themselves into the good ending ("THE END").

Any time in the game, **hold X** for Biscuit's emote wheel (next to him on screen): sit, bark, spin, backflip, jump, play bow, paw, dig, wag, sniff, pet, come here. Move the mouse to one and let go (or click); a quick tap keeps it open.

`/viewer.html` is the dev viewer: any downloaded world, collider view, fly mode, hand-animation previews, splat or mesh hands, rain toggle. `?quest=1` plays the quest, `?res=full_res` loads the sharp splats.

## Done

- **Worlds**: World Labs Marble pipeline (`npm run worlds`), single-plate generation, Gemini pano repair, final yard and cabin worlds committed (`worlds/out`). Rapier colliders from Marble's collider meshes. The game loads the 500k splats first and swaps the full-resolution ones in when a world is off screen; a cap on splat size removes the long streaks some splats drew on a GPU.
- **First person**: kinematic capsule controller, adaptive quality (works without a GPU), drag-to-look fallback, doors with swinging leaves and comic iris transitions between yard and cabin.
- **Hands**: rigged WebXR hand with procedural actions (open/pull door, pick up, throw, point, beckon, unlock with a key…), petting, held props (a fist round sticks and branches, finger and thumb for the key). Drawn as Gaussian splats coloured from Gemini-painted matcaps (mesh fallback).
- **Biscuit**: Larry's 50k-splat dog (`larry/dogmodels`, latest: backflip and dig clips, re-exported model), sized and tinted per world. Follows, runs, fetches, comes through doors, side-on petting, digs (his real dig clip), tricks from the emote wheel. Procedural IK legs (`src/game/dog-gait.ts`) plant his paws while he walks in the world.
- **Quest**: Storm Night (locked door → dig → key in the lock → cold cabin → two branches → fire → complete), objectives on screen.
- **Rain** (`src/game/rain.ts`): streaks on the GPU round the player, splash rings, the recorded rain (world-sfx) muffled indoors. A depth map of the collider from above, plus boxes over the porch and house where the collider has holes, keep it off roofs and out of the house.
- **Sound**: the menu's theme, clicks and hovers (frontend); rain, footsteps (wet ground, porch planks, floorboards) and the door creak (world-sfx); the fire's crackle and Biscuit's bark. One volume control for all of it.
- **Fire** (`src/game/fire.ts`): comic flames, embers, glow and a flickering light; the cabin warms from a cold blue as it catches.
- **Deploy**: `npm run build` copies the worlds into `dist/`, a self-contained static site; `Dockerfile` serves it with nginx on `$PORT`.
- **Art** (Gemini): comic panels and pages (`npm run comic`, `comic-page`), the five panel-to-game in-betweens (`npm run comic-transition`), the pipeline's cut-out and wireframe views (`npm run pipeline-art`). `tools/pipeline-frames.html` (dev) renders fallback strips of the dog for the pipeline.

## Open / next

- **Check on the demo laptop**: transitions, the full-resolution swap, the rain and the pipeline's live dog were tested on an Intel Iris Xe and in a GPU-less VM; confirm frame rates and timings on the demo machine.
- **Re-capture the opening frame after any world or placement change**: `public/comic/transition/game-start.jpg` must match the game's first view (`copy(await game.captureFrame())` in the dev console after entering the yard), then `npm run comic-transition`.
- **Uploaded comic is decorative**: the demo always plays Storm Night, whatever is uploaded (the pipeline's character boxes are measured on the Storm Night page).
- **Voice** ("Biscuit, dig!" spoken; the `speech-integration` branch) is not wired in; E triggers the dig.
- **Dog walk/run clips**: Larry's new clips are used as they are; `npm run dog-clips` would replace them with ones rebuilt from the IK gait, which may no longer be wanted.
