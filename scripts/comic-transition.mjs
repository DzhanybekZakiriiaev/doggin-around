#!/usr/bin/env node
// Paints the in-between frames for stepping out of comic panel 1 into the game, with Gemini:
//
//   npm run comic-transition
//
// The last frame is the game's own opening view (public/comic/transition/game-start.jpg, captured from the
// game: open it with `npm run dev`, enter a world, then in the console `copy(await game.captureFrame())`
// and save the data URL as that file). The in-betweens repaint that exact view, first almost fully in the
// comic's style, then only lightly, so the menu can cross-fade panel 1 → comic version of the game view →
// half-way → the real game without anything jumping.
//
// Output: public/comic/transition/blend-1.jpg (mostly comic), blend-2.jpg (mostly game)

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
      'Repaint the first attached image (a frame from a 3D game) halfway towards the comic-book style of the second ' +
      'attached image: keep its soft painterly 3D look and lighting, and add only thin ink outlines and a faint ' +
      `halftone texture, with a little light rain. ${KEEP}`,
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
