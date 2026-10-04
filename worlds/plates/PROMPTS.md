# Plate prompts (Gemini image generation)

Eight plates: four views per world, one every 90°, all from the same spot. Save them here as PNG with these exact names.

| File | World | Facing |
|---|---|---|
| `yard_000.png` | Yard | The cabin and porch (generate first: style key for everything) |
| `yard_090.png` | Yard | Right: cabin side, woodpile, big pine |
| `yard_180.png` | Yard | Behind: path, fence, mailbox, stump, flower bed |
| `yard_270.png` | Yard | Left: fence, wheelbarrow, ferns |
| `cabin_000.png` | Cabin | Fireplace wall (generate first for the cabin) |
| `cabin_090.png` | Cabin | Right: couch under the window, dog bed |
| `cabin_180.png` | Cabin | Behind: empty front doorway, coat hooks |
| `cabin_270.png` | Cabin | Left: kitchen nook, open back door |

## How to generate

1. Generate `yard_000` from its prompt plus the style block. Re-roll until it looks right: every other plate copies it.
2. For each other plate, attach `yard_000` (and the neighbouring view you already made) and start the prompt with:
   "This is the same place. Keep exactly the same style, materials, colours, lighting and time of day. Turn the camera 90° to the right / 90° to the left / around to face the opposite way, staying at the same spot and height, and show: ..."
3. For the cabin, also attach `yard_000` to `cabin_000` so the log walls and palette match the outside.
4. Check every plate before using it:
   - Nobody in it: no people, animals, statues or figure-like shapes, even tiny ones in the distance.
   - No text, borders, letterboxing or visible watermark. Crop them out if they appear.
   - Camera level, floor visible in the lower third, nothing blurred.
   - 16:9, at least 1024 px wide, PNG.

## Style block (append to every prompt)

> Stylized semi-realistic 3D animated film look in the spirit of modern comic-book animated movies: cozy and warm, hand-painted textures with visible brush strokes, chunky readable shapes, rich saturated colour with a teal-and-amber palette and magenta tints in the shadows, soft rim light. Clean painted surfaces: no ink outlines, no halftone dots, no colour misregistration, no text, no speech bubbles, no panel borders, no film grain, no depth-of-field or motion blur. Eye-level camera 1.6 m above the ground, level horizon, straight vertical lines, natural wide-angle lens with about a 90° horizontal field of view, no fisheye. The ground fills the lower third of the frame. The place is empty and still: no people, no animals, no statues. 16:9 landscape.

The comic layer (ink lines, halftone, misregistration) is added later as a shader in Spark: baked into the plates it would smear across the 3D world.

## Yard: overcast dusk

**yard_000** (front, the cabin)
> Front yard of a small cozy log cabin in a pine forest at overcast dusk. The camera stands on a damp gravel path in the middle of the yard, facing the cabin about 6 m away. A wide covered wooden porch runs across the front with three broad steps, a warm glowing lantern beside a closed red front door, a woven doormat and a wooden bench. Log walls with one warmly lit window. Beside the porch steps, a freshly dug empty muddy hole in a patch of bare soil. Patchy grass and pine needles in the foreground. Soft even blue-grey dusk light with warm amber from the lantern and window.

**yard_090** (camera turned 90° right)
> The side of the log cabin recedes along the left edge of the frame. Against it, a neatly stacked woodpile under a small slanted roof, a chopping block and a rain barrel. Ahead, the yard opens to tall pines and one big old pine tree whose roots spread over soft dark ground. Patchy grass and pine needles in the foreground. Same overcast dusk light.

**yard_180** (camera turned to face away from the cabin)
> The gravel path leads ahead to a gap in a low split-rail wooden fence, with a mailbox on a post beside the gap. On the left, a wide old tree stump; on the right, a flower bed of loose dark soil with a few drooping flowers. Dark pine forest beyond the fence and a heavy storm cloud bank on the horizon with a faint violet glow. Same overcast dusk light.

**yard_270** (camera turned 90° left)
> The corner of the cabin's porch on the right edge of the frame. A low split-rail fence curves along the left with an old wooden wheelbarrow leaning against it, ferns and a patch of tall grass, tall pines behind. Damp ground and pine needles in the foreground. Same overcast dusk light.

## Cabin living room: evening, before the storm

**cabin_000** (front, the fireplace)
> Interior of a cozy rustic log cabin living room in the evening. The camera stands in the middle of the room facing a large river-stone fireplace about 3 m away. The hearth is empty and cold: a clean iron grate, a little grey ash, no fire, no logs. A thick wooden mantel with a clock and candles, an empty wicker log basket and iron fire tools beside it. A braided oval rug on a wide plank floor in the foreground, exposed log walls and ceiling beams. Soft even lamplight, warm amber with cool blue light from the windows.

**cabin_090** (camera turned 90° right)
> A worn brown leather couch with a chunky knitted blanket and cushions under a large window; outside, blue dusk and pine silhouettes. A side table with a lamp and a mug. In the corner beside the couch, an empty round dog bed. Braided rug and plank floor in the foreground. Same lamplight.

**cabin_180** (camera turned to face the front entrance)
> An open front doorway in the log wall: a heavy wooden door frame with no door in it, showing the dim blue covered porch outside. Beside it, coat hooks with a scarf and a lantern, a boot tray with a pair of rain boots and a small bench. A doormat just inside the doorway, plank floor in the foreground. Same lamplight.

**cabin_270** (camera turned 90° left)
> A small kitchen nook: a wooden counter, open shelves of mugs and jars, a kettle, a small round table with two chairs. At the back of the nook the back door stands wide open onto a dark back porch. Plank floor in the foreground. Same lamplight.
