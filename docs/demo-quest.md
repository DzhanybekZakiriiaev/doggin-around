# Storm Night: the 3-minute demo cut

One playable panel, one dog action, one visible change to the comic.

## The comic

| Panel | Bad ending (shown first) | Good ending (after you play) |
|---|---|---|
| 1. Dusk, the yard | Locked out as the storm comes in; Biscuit sits by a fresh muddy hole looking guilty. *(the playable panel; the same in both)* | same |
| 2 | Hours on her knees in the rain, searching by flashlight. No key. | "Biscuit, dig!" He digs the key up. |
| 3 | KRA-KOOM! Biscuit bolts into the storm. | CLICK! The key turns; he darts in past her into the firelight. |
| 4 | She searches the woods all night, calling for him. | Home, dry and warm: asleep together by the fire. |
| 5 | Dawn: lost-dog posters, just his bandana. **THE END?** | Next morning, the key gets its own hook. **THE END** |

The lettered pages are `public/comic/storm-night-bad-ending.png` (the one to upload) and `storm-night-good-ending.png`.

Cause and effect in one line: **Biscuit buried the key; Biscuit digging it up gets them inside before the storm.**

## Playing panel 1 (~75 seconds)

1. **Land in the yard.** Biscuit jumps in with you and sits by the muddy hole.
2. **Try the door.** The hand grabs the knob and rattles it: *LOCKED.* Hint: "The spare key's gone… and Biscuit looks guilty."
3. **"Biscuit, dig!"** Look at the patch of soft soil and press E. Your hand points; Biscuit runs over, sniffs, digs (dirt flying), and the key pops out. *This is the one dog action.*
4. **Pick up the key** (E), walk to the porch, **unlock the door** (E): turn the key, shove the door open.
5. **Step inside.** A few seconds in the warm cabin, then the iris closes and you're back at the comic.
6. **The comic redraws.** Panels 2 and 3 ink-wipe from the bad ending to the good one, one after the other, with new captions.

Stepping out without the key (Esc, or "Step out") leaves the bad ending in place, so you can jump back in.

## Demo script (3:00)

| Time | Beat |
|---|---|
| 0:00 | The comic strip, bad ending. Read the three panels. |
| 0:20 | Hover the turntable dog: he stops, turns, leans in to be petted. Point out the FPS counter. |
| 0:35 | Click panel 1. The dog leaps in; dive into the 3D yard. |
| 0:45 | Try the door: locked. |
| 1:00 | "Biscuit, dig!" He runs, sniffs and digs; IK paws on the uneven ground, springy ears and tail. The key pops out. |
| 1:40 | Pick up the key, unlock and open the door, step into the cabin. |
| 2:00 | Back to the strip: panels 2 and 3 redraw into the good ending, voiced. |
| 2:30 | One slide of the pipeline: plates, Marble worlds, rigged splat dog, Spark. |

## Cut for the demo (stretch goals)

Fetch (sticks for the fire), tug (the door in the wind), lie down (calming Biscuit by petting), the two neutral endings, and panels 2–3 as walkable worlds. The engine already has the pieces for them: carrying and throwing props, door pulling, continuous petting with stroke speed, and the cabin world.

## Where things live

- Comic panels: `public/comic/`, painted by `npm run comic` (`scripts/comic-panels.mjs`). Pass `-- --dog <photo>` once the official dog photo is in, so Biscuit matches it.
- Quest logic: `src/quest.ts`. Comic strip: `src/comic.ts`.
- Biscuit: `src/dog.ts` is a stand-in with the interface the real dog implements (`goTo`, `dig`, `sit`, `lookAt`).
