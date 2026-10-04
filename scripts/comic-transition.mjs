#!/usr/bin/env node
// Paints the in-between frames for stepping out of comic panel 1 into the game, with Gemini:
//
//   npm run comic-transition
//
// The last frame is the game's own opening view (public/comic/transition/game-start.jpg, captured from the
// game: open it with `npm run dev`, enter a world, then in the console `copy(await game.captureFrame())`
// and save the data URL as that file). The in-betweens repaint that exact view in five steps from fully in
// the comic's style to barely touched, so the menu can cross-fade panel 1 → comic version of the game view →
// … → the real game without anything jumping.
//
// Output: public/comic/transition/blend-1.jpg (all comic) … blend-5.jpg (nearly the game)

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'public', 'comic', 'transition');
const GAME = path.join(DIR, 'game-start.jpg');
const PANEL = path.join(ROOT, 'public', 'comic', 'panel-1.jpg');
const MODEL = 'gemini-3-pro-image';

try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  // No .env file; GEMINI_API_KEY may come from the shell.
}

const KEEP =
  'Keep the first attached image\'s exact composition: the same camera and framing, and every object at exactly the ' +
  'same position, size and outline: the log cabin and porch, the trees, the path, the small white dog with the daisy ' +
  'bandana sitting by the hole, and the two first-person hands in yellow raincoat sleeves at the bottom. It must ' +
  'line up pixel for pixel with the first image so the two can be cross-faded. 16:9, no text, no border.';

// From the comic (blend-1) to the game (blend-5): each a step less inked than the one before.
const FRAMES = [
  {
    id: 'blend-1',
    prompt:
      'Repaint the first attached image (a frame from a 3D game) as a comic-book panel in the style of the second ' +
      'attached image: bold black ink outlines, halftone dot shading, flat comic colours, stormy sky with slanting ' +
      `rain and a flicker of lightning. ${KEEP}`,
  },
  {
    id: 'blend-2',
    prompt:
      'Repaint the first attached image (a frame from a 3D game) mostly in the comic-book style of the second ' +
      'attached image: bold black ink outlines and halftone shading, flat colours, with a little of the original\'s ' +
      `soft painterly light showing through, and slanting rain. ${KEEP}`,
  },
  {
    id: 'blend-3',
    prompt:
      'Repaint the first attached image (a frame from a 3D game) exactly halfway between its own soft painterly 3D ' +
      'look and the comic-book style of the second attached image: medium ink outlines, light halftone dots in the ' +
      `shadows only, the original lighting and colours, and light rain. ${KEEP}`,
  },
  {
    id: 'blend-4',
    prompt:
      'Repaint the first attached image (a frame from a 3D game) only slightly towards the comic-book style of the ' +
      'second attached image: keep its soft painterly 3D look, lighting and colours, and add just thin ink outlines ' +
      `on the main shapes and a faint halftone texture, with a little light rain. ${KEEP}`,
  },
  {
    id: 'blend-5',
    prompt:
      'Reproduce the first attached image (a frame from a 3D game) almost unchanged: the same soft painterly 3D look, ' +
      'lighting and colours, with only the faintest thin ink lines on the outlines of the main shapes, a hint of ' +
      `the comic style of the second attached image. ${KEEP}`,
  },
];

async function inline(file) {
  return { inline_data: { mime_type: 'image/jpeg', data: (await readFile(file)).toString('base64') } };
}

async function paint(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set. Add it to .env or export it in your shell.');
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }, await inline(GAME), await inline(PANEL)] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '16:9', imageSize: '2K' } },
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${body.slice(0, 400)}`);
  const part = (JSON.parse(body).candidates?.[0]?.content?.parts ?? []).find((p) => p.inlineData ?? p.inline_data);
  if (!part) throw new Error(`Gemini returned no image: ${body.slice(0, 400)}`);
  return Buffer.from((part.inlineData ?? part.inline_data).data, 'base64');
}

const { width, height } = await sharp(GAME).metadata();
await Promise.all(
  FRAMES.map(async (frame) => {
    console.log(`Painting ${frame.id}…`);
    const image = await paint(frame.prompt);
    // Exactly the game frame's size, so the cross-fades line up.
    await writeFile(path.join(DIR, `${frame.id}.jpg`), await sharp(image).resize(width, height, { fit: 'fill' }).jpeg({ quality: 88 }).toBuffer());
  }),
);
console.log(`Done: ${path.relative(ROOT, DIR)}`);
