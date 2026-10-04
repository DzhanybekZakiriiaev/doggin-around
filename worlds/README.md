# Worlds

The two walkable worlds (yard and cabin) are generated with the World Labs Marble API by `scripts/worldlabs.mjs`. Each world is static scenery only: doors, fire, sticks, the key and all characters are separate objects added in the game.

## Layout

- `scenes/<scene>.json`: the Marble text prompt, the plates and which way each faces (`azimuth`, 90 = right), and hints for the panorama repair.
  - `yard-single` / `cabin-single`: one plate plus the text prompt. **Use these.** Marble paints the whole 360° panorama itself, so it comes out seamless with a believable floor and ceiling/sky.
  - `yard` / `cabin`: four plates. More control over each side, but Marble stitches the plates as panels, which leaves seams (sometimes black gaps) and an invented, repetitive floor and ceiling.
- `plates/`: the Gemini input images. Prompts are in [plates/PROMPTS.md](plates/PROMPTS.md). `*.original.jpg` are the unedited versions of plates we mirrored or cropped.
- `out/<scene>/`: one folder per generated world with `world.json`, `splats_*.spz`, `collider.glb`, the panorama and a thumbnail, plus `runs.jsonl` logging every run. Only the final worlds the game uses are committed (yard A, yard B and the cabin, without their panoramas); drafts stay local. After generating a new final, add its folder to `.gitignore`'s list.

## Workflow

Put `WLT_API_KEY` (and `GEMINI_API_KEY` for repairs) in `.env` (see `.env.example`), then:

1. Drafts, a few seeds to choose from (230 credits, about $0.18 each):
   `npm run worlds -- generate yard-single cabin-single --seed 1`
2. Compare the panoramas (`out/<scene>/<run>/pano.png`) and walk the drafts in the viewer (`npm run dev`).
3. Optional: repair the panorama with Gemini. `--only down` cleans the ground under the camera; seams and the sky/ceiling are also available:
   `npm run pano -- yard-single <draftWorldId> --only down`
4. Final from the chosen panorama, so the layout stays the same (1,500 credits, about $1.20):
   `npm run worlds -- final yard-single --from <draftWorldId>` or `--pano <path to pano_fixed.png>`
   `--model plus` makes a larger world (1,500 to 3,000 credits).
5. If a run gets interrupted, resume it with `poll <scene> <operationId>` (the id is in `runs.jsonl`), or download a finished world again with `fetch <scene> <worldId>`.

## Viewer

`npm run dev` opens a first-person viewer with every downloaded world in a dropdown. It flips Marble's y-down frame into three.js, scales drafts so the panorama camera sits at eye height (finals carry a metric scale), and walks on the world's collider mesh with Rapier. Adaptive quality lowers resolution and splat count until it holds ~60 fps; machines without a GPU (such as this VM) render on the CPU and stay at the lowest tiers.

- **Levels and doors:** `src/levels.ts` says which world each level uses and where its doors are (measured by raycasting the collider, `MarbleWorld.raycastPano`). A door with a leaf hides the painted door with a Spark splat edit, draws a real door that swings open, and the iris transition loads the linked world. Regenerating a world means measuring its placements again.
- **Hands:** the rigged WebXR generic hand (`public/models/hands`, MIT) shaded with matcaps painted by Gemini to match the cabin (`npm run hands-style`, output in `public/textures/hands`, with `reference.png` as the style target). By default they are drawn as Gaussian splats (`src/splat-hands.ts`: the hand surface and sleeve covered in small brush-like splats, skinned to the same skeleton and coloured from those matcaps) so they sit with the splat world; the HUD's "Splat hands" box switches back to the inked mesh. Poses and actions live in `src/hands.ts`; your own rigged hand model can replace the GLB as long as it has the WebXR joint names.
  - Actions for the quest line: open door (push / pull), pick up, throw, put down, point ("over there!"), beckon ("come here!"), pat the couch ("up!"), slide the bolt, rub hands, warm hands, wave, knock, wipe mud off, grab. Each fires named moments (`grab`, `release`, `swing`…) for gameplay to hook, and reaching ones aim at a target via `aimAt`.
  - Petting is continuous: `startPetting(strokesPerSecond)`, `setPetSpeed`, `stopPetting`; slow strokes read as calm, fast ones as frantic.
  - Preview any of them from the HUD's "Try" menu.
- **Props:** `src/props.ts` (placeholder stick and key with Rapier physics), placed per world in `src/levels.ts`. E picks up, T or click throws, G puts down; carried props come with you through doors.
- **Biscuit:** Larry's animated splat dog from `larry/dogmodels` (`src/dog/`, the Huawei challenge dog: 50,000 Gaussians skinned to a 41-joint rig, assets in `public/models/dog-*`). `src/biscuit.ts` sizes him to 0.85 m, keeps him on the collider and tinted to each world's light, and runs his behaviour: follows you (walks, runs to catch up), fetches whatever you throw, comes with you through doors, and on "Pet Biscuit" (E) trots up side-on while you crouch and stroke his neck. V calls him (beckon + two barks).
  - His legs are procedural (`src/dog-gait.ts`): while he stands or moves, each paw is planted on the ground (following steps and slopes) and steps in a four-beat walk or a trot matched to his speed, with two-bone IK per leg and the paw rolling over its toe at the end of a stride. The clips still drive body, head and tail (and sit, jump, spin etc. entirely).
  - The walk and run clips inside `dog-animated.glb` are rebuilt from the same gait (`npm run dog-clips`; `-- --dry-run` prints before/after measurements). The authored ones skated, sank and floated paws, lifted three legs at once and bobbed the body 7 cm. The rebuilt ones keep Larry's speed contract (walk 2.25, run 4.7 Dog units/s at action rate 1, as in his fetch demo) and a toned-down share of the authored body/head/tail motion; nothing else in the file changes. Re-running starts from the authored clips on `origin/larry/dogmodels`. `-- --prune` would also drop ~5.7 MB the authored GLB carries but never references (two extra copies of the mesh and texture).
