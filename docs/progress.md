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

Or **hold F and say it**: "sit", "Biscuit, dig!", "good boy", "do a backflip", "shake hands", "come here", "play bow", "fetch", "stop". The words appear in a comic speech bubble as they're transcribed, and the command fires on the first transcript that contains it — while you're still speaking for a longer phrase, on the commit for a short one. Needs `ELEVENLABS_API_KEY` in `.env`; without it the chip in the corner reads "voice is off" and nothing else changes.

`/viewer.html` is the dev viewer: any downloaded world, collider view, fly mode, hand-animation previews, splat or mesh hands, rain toggle. `?quest=1` plays the quest, `?res=full_res` loads the sharp splats.

## Done

- **Worlds**: World Labs Marble pipeline (`npm run worlds`), single-plate generation, Gemini pano repair, final yard and cabin worlds committed (`worlds/out`). Rapier colliders from Marble's collider meshes. The game loads the 500k splats first and swaps the full-resolution ones in when a world is off screen; a cap on splat size removes the long streaks some splats drew on a GPU.
- **First person**: kinematic capsule controller, adaptive quality (works without a GPU), drag-to-look fallback, doors with swinging leaves and comic iris transitions between yard and cabin.
- **Hands**: rigged WebXR hand with procedural actions (open/pull door, pick up, throw, point, beckon, unlock with a key…), petting, held props (a fist round sticks and branches, finger and thumb for the key). Drawn as Gaussian splats coloured from Gemini-painted matcaps (mesh fallback).
- **Biscuit**: Larry's 50k-splat dog (`larry/dogmodels`, latest: backflip and dig clips, re-exported model), sized and tinted per world. Follows, runs, fetches, comes through doors, side-on petting, digs (his real dig clip), tricks from the emote wheel. Procedural IK legs (`src/game/dog-gait.ts`) plant his paws while he walks in the world.
- **Quest**: Storm Night (locked door → dig → key in the lock → cold cabin → two branches → fire → complete), objectives on screen.
- **Rain** (`src/game/rain.ts`): streaks on the GPU round the player, splash rings, the recorded rain (world-sfx) muffled indoors. A depth map of the collider from above, plus boxes over the porch and house where the collider has holes, keep it off roofs and out of the house.
- **Voice** (`src/voice/`, `src/game/voice.ts`): hold F to command Biscuit by speech. ElevenLabs Scribe v2 Realtime over a WebSocket opened when the world does, push-to-talk with manual commits (hands-free VAD would let a neighbouring conversation command the dog in a loud room), the microphone gated in an AudioWorklet so no audio leaves the page between holds. Two things it gets wrong if built the obvious way, both about the audio device:
  - The worklet runs on the game's one AudioContext (`src/game/audio.ts`). A second context of its own at 16 kHz took the output device with it and the game lost every sound it had.
  - Chrome's echo cancellation, noise suppression and automatic gain are all off. They are set up as the stream opens, which was most of the wait before a hold went live, and the automatic gain then started each one cold and quiet, so the first words came through faint and had to be repeated. The level is made up in the graph instead (gain and a limiter, `captureChain`).
  - **Windows ducks the game while the microphone is open**, and the page cannot opt out: with `UserDuckingPreference` unset, Windows' default is to drop everything else playing by 80% for as long as any capture device is open. Opening the device per hold avoids that but is worse — opening one is slow enough to swallow the first word, which is the other half of "say it again" — so **the demo machine has Sound (`mmsys.cpl`) → Communications set to "Do nothing"** (`UserDuckingPreference = 3`, confirmed), and the device is then held from the first command until the world is left (`MIC_IDLE_SECONDS = 0`). Any other Windows machine needs that setting too, or `MIC_IDLE_SECONDS` set to a few seconds so the sound at least comes back between commands. macOS has no equivalent ducking; Bluetooth headsets there degrade output while the microphone is open, which is the codec rather than this.

  What that gives up is the speakers bleeding into the microphone, which measurement says is affordable: with broadband noise mixed in, a bare "sit" comes back as "see ya" by 15 dB SNR, but "Biscuit, sit" is right down to 0 dB. The name is a filler the parser drops, so the UI asks for it ("hold F and say 'Biscuit, sit!'"). The key stays on the server: `vite.config.ts` mints a single-use realtime token at `POST /api/scribe-token`. Partial transcripts are parsed as they stream in; the keyword parser does synonyms, spoken plurals and one-edit repairs ("sid" → sit) and refuses the ambiguous ones ("pow" could be paw or bow). Measured against the live service: Scribe holds its first partial back until roughly two seconds of audio are in, so "Biscuit, dig!" fires ~160 ms before the speaker stops, while a clipped "sit!" lands on the commit instead. "Dig" next to the fresh hole is the quest's dig, however it was asked for.
- **Sound**: the menu's theme, clicks and hovers (frontend); rain, footsteps (wet ground, porch planks, floorboards) and the door creak (world-sfx); the fire's crackle and Biscuit's bark. One volume control for all of it.
- **Fire** (`src/game/fire.ts`): comic flames, embers, glow and a flickering light; the cabin warms from a cold blue as it catches.
- **Deploy**: `npm run build` copies the worlds into `dist/`, a self-contained static site; `Dockerfile` serves it with nginx on `$PORT`.
- **Art** (Gemini): comic panels and pages (`npm run comic`, `comic-page`), the five panel-to-game in-betweens (`npm run comic-transition`), the pipeline's cut-out and wireframe views (`npm run pipeline-art`). `tools/pipeline-frames.html` (dev) renders fallback strips of the dog for the pipeline.

## Open / next

- **Check on the demo laptop**: transitions, the full-resolution swap, the rain and the pipeline's live dog were tested on an Intel Iris Xe and in a GPU-less VM; confirm frame rates and timings on the demo machine.
- **Re-capture the opening frame after any world or placement change**: `public/comic/transition/game-start.jpg` must match the game's first view (`copy(await game.captureFrame())` in the dev console after entering the yard), then `npm run comic-transition`.
- **Uploaded comic is decorative**: the demo always plays Storm Night, whatever is uploaded (the pipeline's character boxes are measured on the Storm Night page).
- **Voice, layer 2**: the keyword parser handles the tricks and "Biscuit, dig!"; anything naming an object or a place ("the stick by the fireplace") is only flagged (`parseUtterance(...).escalate`) and does nothing. Gemini would take the committed transcript from there, with the world's interactables and Biscuit's state as context, and reply in a structured command schema.
- **Dog walk/run clips**: Larry's new clips are used as they are; `npm run dog-clips` would replace them with ones rebuilt from the IK gait, which may no longer be wanted.
