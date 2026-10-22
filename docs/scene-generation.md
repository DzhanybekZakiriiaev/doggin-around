# Scene generation: from comic panel to walkable world

How a comic panel becomes a 3D world you can walk into, with physics that matches what you see.

```
panel → four views → 360° panorama → depth → point cloud → fill the unseen → Gaussian splat → collision mesh → physics
```

The loading card on the way into panel 1 (`src/WorldPipeline.tsx`) plays these stages with the yard's own data
in six steps, in step with Biscuit's six-step pipeline before page 2 (both 23 s):

| Card step | Stages below |
|---|---|
| VIEWS | 1 |
| STITCH | 2–4 |
| DEPTH | 5 |
| 3D | 6 |
| SPLAT | 7 |
| PHYSICS | 8–11 |

---

## 1. Generate the scene from four sides

An image model (Gemini 3 Pro) paints the panel's scene as four ordinary perspective views at 0°, 90°, 180° and
270°. Every view uses the same horizon, zero tilt and a wide field of view (about 110°), so neighbouring views
overlap. The comic panel is passed in as the style reference so all four match it. The prompts are in
`worlds/plates/PROMPTS.md`.

**Why not generate the 360° panorama in one shot?** Image models aren't trained on 360° projection. A single
generated "panorama" is a wide photo rather than a sphere:

- the horizon bends,
- the 2:1 aspect ratio isn't available,
- the left and right edges don't meet.

Generating normal views and doing the projection ourselves avoids all three. What four level views can't cover
is straight up and straight down; stage 3 handles that.

## 2. Stitch the views into a panorama

1. **Project onto a sphere.** Each view is mapped into an equirectangular panorama (the flat 2:1 image) with the
   pinhole camera projection: for a panorama pixel at longitude `λ` and latitude `φ`, seen by a view turned
   `ψ` with focal length `f`, `x = f·tan(λ − ψ)` and `y = f·tan(φ) / cos(λ − ψ)`.
2. **Fix the geometry.** The generated "cameras" never point exactly where we asked (one might really be turned
   87°, slightly tilted or zoomed).
   - Feature matching (SIFT) finds the same points in each overlap.
   - RANSAC throws out wrong matches, which AI textures like grass and leaves produce a lot of.
   - From what's left we solve a small rotation and focal-length correction per view.
   - A bundle adjustment fits all four together, so the loop closes cleanly at 360°.
3. **Fix the colour.** Comparing each pair in their overlap gives a gain per view that evens out brightness and
   colour.
4. **Hide the joins.** Each overlap is cut along the path where the two views agree most, then blended in layers
   (multi-band / Laplacian pyramid blending): overall light and colour over a wide band so it changes
   gradually, fine detail over a narrow band so edges don't double up.

Based on Brown & Lowe, *Automatic Panoramic Image Stitching using Invariant Features*, IJCV 2007.

## 3. Repair what still disagrees

Generated views never agree perfectly, so after stitching some seams still show.

1. **Find the problem areas.** Measure where neighbouring views still disagree, and mark only those.
2. **Cut out a view centred on each one,** wide enough to include clean panorama on both sides.
3. **Inpaint only a masked strip.** The model sees the whole view as context, but only the strip in the middle
   is regenerated, and only those pixels are kept from its output.
4. **Make the patch agree.** Colour-match it to its surroundings, project only the masked pixels back, and blend
   the edges (multi-band).
5. **Repeat if needed.** If a patch edge still shows, run a smaller pass centred on it.

The top and bottom of the sphere, which no level view saw, are repaired the same way with a circular mask.

- **Why a patch doesn't create new seams:** a patch edge borders only one image, and the model extended the real
  pixels across it. It's a continuation, not a join between two images.
- **Why stages 2–3 still matter:** good stitching keeps the inpainted area small, so little is invented, and
  the same colour-matching and blending tools then make the generated pixels agree with the real ones.
- **Avoiding blur:** every projection resamples pixels, so only masked pixels are projected back. A round trip
  (`--dry-run`) checks the projection itself moves and blurs nothing.

Implemented in `scripts/pano-fix.mjs`: views centred on the four seams (45°, 135°, 225°, 315°) and the two
poles, repainted and blended back with soft masks.

## 4. The panorama is the single source of truth

The original four views contradict each other in their overlaps. Used directly, they would give duplicated,
ghosted geometry in 3D and conflicting targets when training the splat, their exact cameras are unknown, and
none of them covers straight up or down. The panorama resolves all of that once: every direction gets exactly
one colour. Every view used afterwards is cut from it, so all of them agree and each has an exact, known camera.

## 5. Estimate depth

- **Cube faces.** Standing at the panorama's centre inside a cube, each of the six walls is a normal,
  undistorted 90° photo. We render them slightly wider (about 100°) so neighbouring faces overlap.
- **Depth per face.** A monocular depth model (Depth Anything V2) estimates depth for each face. It's trained on
  normal photos, which is why it gets cube faces instead of the stretched panorama.
- **Align the faces.** Its depth is only consistent within one image, so a scale and shift per face is solved
  (least squares) so neighbouring faces agree in their overlaps.
- **Merge.** Everything projects back into one 360° depth map that lines up pixel for pixel with the panorama.

## 6. Lift to 3D and fill in what was never seen

**Point cloud.** Every pixel is placed in 3D at its depth: coloured dots that say *where* things are, not yet
what they look like.

**Clean the edges first.** Pixels on the boundary between a near object and the background get an in-between
depth and float as streaks ("flying pixels"). Sharp depth jumps are found and those pixels deleted.

**Why there are gaps.** From the centre we only see the front of each post and tree. Step sideways and what was
behind them appears as holes (in the yard, 6% of a view 2.6 m to the side).

**Filling them, one viewpoint at a time:**

1. **Move the camera, without generating an image.** Render the points we already have from 0.5–1.5 m
   off-centre: `pixel = K·[R|t]·point`. Most of the view appears with correct parallax (depth-image-based
   rendering).
2. **Find the real holes.** Points are drawn as discs sized by distance, so the gaps between dots close and only
   real holes stay. Each hole is grown by a few pixels, since its edge colours are unreliable.
3. **Inpaint the colour,** continuing the background.
4. **Inpaint the depth.** Run the depth model on the filled image, align its scale and shift to the known
   pixels around the hole, and keep the aligned depth inside it.
5. **Sanity-check.** A filled pixel is behind whatever hid it, so anything that would land in front is dropped.
6. **Add the new points.** Later viewpoints render the updated cloud, so new fills agree with earlier ones.

A few dozen viewpoints across the walkable area is usually enough, each one small inpainting job. This is the
idea behind LucidDreamer and WonderWorld.

## 7. Train the Gaussian splat

A **splat** turns each point into a soft 3D blob with a position, size, rotation, opacity and colour; overlapping
blobs blend into continuous, photoreal surfaces.

- **Start:** one Gaussian per point, sized from its nearest neighbours, at low opacity.
- **Training views:** views cut from the panorama plus every inpainted off-centre view from stage 6.
- **Training:** gradient descent with gsplat on `0.8·L1 + 0.2·(1 − SSIM)` (the loss of our dog reconstruction)
  plus a depth term, so the geometry stays where the depth put it. Gaussians are split where detail is missing
  and pruned where they're nearly transparent. About 30,000 iterations on one GPU.
- **Export:** a standard `.ply`, compressed to SPZ for the browser.

**Same as the dog, and different.** The optimisation is the same as our Tricolor dog's: synthetic views, the
same loss, geometric constraints. What differs is how the unseen parts are made. The dog is seen from the
outside, so a 3D object generator (TRELLIS) imagined it whole. A scene is seen from the inside, so it's filled
step by step with reprojection and inpainting.

**Limitation:** the world holds together as far as the off-centre views reach; the walkable area stays near the
centre.

Related work: DreamScene360 (*Unconstrained Text-to-3D Scene Generation with Panoramic Gaussian Splatting*,
ECCV 2024).

## 8. Extract a collision mesh from the splat

A splat has no solid surface; physics needs triangles.

1. Render depth from the trained splat throughout the walkable area, ignoring see-through pixels such as sky.
2. Fuse the depth maps into a **TSDF** (Open3D): a 3D grid where each cell stores its distance to the nearest
   surface, averaged across views so noise cancels.
3. Extract the surface with **marching cubes**.
4. Remove floating fragments and simplify to about 50,000 triangles.

The collider comes from the splat's own geometry, so physics matches what you see.

## 9. Align the world

- **Gravity:** RANSAC fits the ground plane; the world is rotated so the ground is level and gravity points down.
- **Scale:** metres, from an object of known size (the door) or the depth model's metric estimate.
- **Starting view:** the origin is where the panel's camera was, so the game opens on the panel's exact view.
- **One transform:** the splat and the collider get the identical transform, so they stay aligned.

## 10. Physics and characters

In Rapier: the mesh is a static trimesh collider, with a flat ground plane under it against holes; the player
is a capsule character controller; Biscuit is a capsule that raycasts to the ground so his paws stay planted;
props (branches, the ball) are dynamic rigid bodies. See `src/game/world.ts`, `src/game/player.ts`,
`src/game/biscuit.ts`.

## 11. Render in the browser

Spark renders the splat with level of detail, a cap on how large a splat can grow on screen (no streaks), and a
storm tint. The comic panel dissolves straight into the live view.

---

## Design choices in one line each

- Classic stitching makes the problem as small as possible; generative inpainting fixes only what's left.
- The panorama is the single source of truth for every later stage.
- Moving the camera costs nothing (reprojection); only newly revealed pixels are generated.
- The splat optimisation is shared with the dog reconstruction.
- The collider is extracted from the splat itself, so physics and visuals agree.

## Where each stage is in this repo

| Stage | Status |
|---|---|
| 1. Four views | `worlds/plates/` (prompts in `PROMPTS.md`) |
| 2. Projection onto the sphere | `scripts/world-pipeline-assets.mjs` (`sphere.jpg`); alignment, gain and multi-band blending still to build |
| 3. Seam and pole repair | `scripts/pano-fix.mjs` |
| 5. Depth | To build (the card's depth still is rendered from the world's collider) |
| 6. Point cloud and the unseen | Prototype in `scripts/world-pipeline-capture.html` (point cloud from the panorama, holes measured off-centre) |
| 7–8. Splat and collider | To build; the current worlds (`worlds/out/`) were generated with World Labs Marble |
| 9–11. Alignment, physics, rendering | `src/game/world.ts`, Rapier, Spark |

## Future work: object-aware scenes

Today the panel becomes one static world with hand-placed props. Next, the story's interactive objects could be
found and built automatically:

1. **Find them.** SAM 3 (Segment Anything with Concepts) outlines every instance of a short phrase ("branch",
   "door").
2. **Decide what they're for.** A typed-decision model such as Jev (TypeSafe's "System One" model) classifies
   each one (static, pick up, open, container) with a confidence, sending uncertain ones to a larger model.
3. **Rebuild them.** SAM 3D Objects reconstructs each from one image, with its position, rotation and scale in
   the scene; the depth map confirms where it sits.
4. **Make them physical.** Remove them from the background before training the splat, then add each back as its
   own model with a collider.
