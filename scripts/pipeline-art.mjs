#!/usr/bin/env node
// Paints the Gemini stills for the "bringing it to life" pipeline screen between the upload page and the comic:
//
//   npm run pipeline-art
//
// - extracted.png: Biscuit lifted out of comic panel 1 as a clean comic cut-out (step 1, reading the comic).
// - view-front.png, view-three-quarter.png, view-side.png, view-back.png: the dog from all sides as a 3D
//   wireframe (step 2, constructing the model).
// Both on white, so the page can multiply them onto its paper. Steps 3-5 (rig, mesh, run) are rendered from
// the real model instead: /tools/pipeline-frames.html in `npm run dev`.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'pipeline');
const PANEL = path.join(ROOT, 'public', 'comic', 'panel-1.jpg');
const DOG = path.join(ROOT, 'worlds', 'plates', 'biscuit_reference.png');
const MODEL = 'gemini-3-pro-image';

try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  // No .env file; GEMINI_API_KEY may come from the shell.
}

const WIREFRAME = (view) =>
  `A 3D wireframe model of the dog in the attached reference photo (a small white fluffy dog with a blue bandana), ` +
  `seen from ${view}, standing on all fours, full body, centred, the same proportions as the reference. Clean ` +
  'polygon wireframe only: thin blue lines showing the triangle and quad topology of the mesh, denser round the ' +
  'head and paws, no fill, no texture, no shading, like a viewport in 3D modelling software, with a bold black ' +
  'comic ink outline round the silhouette. Plain white background, no grid, no text, no ground.';

const STILLS = [
  {
    id: 'extracted',
    images: [PANEL, DOG],
    prompt:
      'Lift the small white dog with the daisy bandana out of the first attached comic panel and redraw just him as ' +
      'a clean comic-book character cut-out: sitting, full body, three-quarter view, the same bold ink outlines, ' +
      'halftone shading and flat colours as the panel, matching the dog in the second attached photo (his face, ' +
      'fur, glasses and bandana). Plain white background, nothing else, no text.',
  },
  { id: 'view-front', images: [DOG], prompt: WIREFRAME('straight in front') },
  { id: 'view-three-quarter', images: [DOG], prompt: WIREFRAME('the front three-quarter angle') },
  { id: 'view-side', images: [DOG], prompt: WIREFRAME('the side (a profile facing left)') },
  { id: 'view-back', images: [DOG], prompt: WIREFRAME('directly behind') },
];

async function inline(file) {
  const mime = file.endsWith('.png') ? 'image/png' : 'image/jpeg';
  return { inline_data: { mime_type: mime, data: (await readFile(file)).toString('base64') } };
}

async function paint(prompt, images) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set. Add it to .env or export it in your shell.');
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }, ...(await Promise.all(images.map(inline)))] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1', imageSize: '1K' } },
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${body.slice(0, 400)}`);
  const part = (JSON.parse(body).candidates?.[0]?.content?.parts ?? []).find((p) => p.inlineData ?? p.inline_data);
  if (!part) throw new Error(`Gemini returned no image: ${body.slice(0, 400)}`);
  return Buffer.from((part.inlineData ?? part.inline_data).data, 'base64');
}

const only = process.argv.slice(2);
await mkdir(OUT, { recursive: true });
await Promise.all(
  STILLS.filter((still) => !only.length || only.includes(still.id)).map(async (still) => {
    console.log(`Painting ${still.id}…`);
    const image = await paint(still.prompt, still.images);
    await writeFile(path.join(OUT, `${still.id}.png`), await sharp(image).resize(720, 720, { fit: 'inside' }).png({ palette: true }).toBuffer());
  }),
);
console.log(`Done: ${path.relative(ROOT, OUT)}`);
