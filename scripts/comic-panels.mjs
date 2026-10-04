#!/usr/bin/env node
// Paints the Storm Night comic panels with Gemini (the demo's bad and good endings).
// Each panel uses its location plate as the background reference; panels after the first also get
// panel 1 as the character reference, so Mika and Biscuit stay consistent. Lettering (captions,
// sound effects) is added in HTML by the game, so the art has none.
//
//   npm run comic                        # paints whatever is missing
//   npm run comic -- --force             # repaints everything
//   npm run comic -- --dog <photo> --force   # Biscuit from the official dog photo
//
// Output: public/comic/<panel>.jpg

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'comic');
const PLATES = path.join(ROOT, 'worlds', 'plates');
const MODEL = 'gemini-3-pro-image';

try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  // No .env file; GEMINI_API_KEY may come from the shell.
}

const STYLE =
  'A single comic-book panel in a modern, Spider-Verse-inspired style: bold ink outlines, halftone dot shading, ' +
  'a touch of colour misregistration, dramatic composition, semi-realistic proportions, and the painterly ' +
  'textures and palette of the attached location picture. No text, no speech bubbles, no caption boxes, ' +
  'no sound-effect lettering, no panel border.';
const MIKA = 'Mika, a woman in her twenties with a short dark bob, wearing a mustard-yellow rubber raincoat and dark jeans';
const BISCUIT_DEFAULT = 'Biscuit, a scruffy medium-sized golden-tan mutt with floppy ears, a white chest patch and a red collar';

const PANELS = [
  {
    id: 'panel-1',
    plate: 'yard_000.jpg',
    scene: (dog) =>
      `The attached log cabin's front yard at overcast dusk, porch lantern glowing. ${MIKA} stands at the closed red ` +
      `front door, soaked, patting the empty pockets of her raincoat in frustration. ${dog} sits beside a freshly dug ` +
      'muddy hole near the porch steps, ears down, looking guilty. Lightning flickers on the horizon.',
  },
  {
    id: 'panel-2-bad',
    plate: 'yard_180.jpg',
    scene: () =>
      'Night and heavy rain in the same yard. Mika on her knees in the mud by the flower bed, searching with her bare ' +
      'hands by flashlight, exhausted and soaked through. Biscuit cowers under the porch steps, shivering. Cold blue light.',
  },
  {
    id: 'panel-3-bad',
    plate: 'yard_270.original.jpg',
    scene: () =>
      'Midnight, a violent thunderstorm, a huge lightning bolt across the sky. Biscuit, terrified, bolts through a gap ' +
      'in the wooden fence into the dark pine forest. In the foreground Mika reaches out after him in the rain, too late. ' +
      'Dark, cold, dramatic.',
  },
  {
    id: 'panel-2-good',
    plate: 'yard_090.jpg',
    scene: () =>
      'Dusk and light rain in the same yard. Biscuit digs furiously in the soft soil by the big pine tree, dirt flying, ' +
      'and proudly lifts a small brass key out of the hole. Mika kneels beside him, delighted, reaching to ruffle his ears. ' +
      'Warm porch light.',
  },
  {
    id: 'panel-3-good',
    plate: 'cabin_000.jpg',
    scene: () =>
      'Night inside the attached cozy log cabin: a roaring fire in the stone fireplace. Mika asleep on the couch under a ' +
      'knitted blanket, Biscuit curled up asleep against her. Rain streaks the dark window. Warm amber firelight, peaceful.',
  },
];

async function inlineImage(file) {
  const data = await readFile(file);
  return { inline_data: { mime_type: file.endsWith('.png') ? 'image/png' : 'image/jpeg', data: data.toString('base64') } };
}

async function paint(prompt, references) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set. Add it to .env or export it in your shell.');
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }, ...(await Promise.all(references.map(inlineImage)))] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '4:5', imageSize: '1K' } },
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${body.slice(0, 400)}`);
  const parts = JSON.parse(body).candidates?.[0]?.content?.parts ?? [];
  const part = parts.find((p) => p.inlineData ?? p.inline_data);
  if (!part) throw new Error(`Gemini returned no image: ${body.slice(0, 400)}`);
  return Buffer.from((part.inlineData ?? part.inline_data).data, 'base64');
}

const exists = (file) => stat(file).then(() => true, () => false);

async function main() {
  const { values } = parseArgs({ options: { force: { type: 'boolean', default: false }, dog: { type: 'string' } } });
  await mkdir(OUT, { recursive: true });
  const dogPhoto = values.dog && path.resolve(values.dog);
  const dog = dogPhoto ? 'Biscuit, the dog in the attached photo' : BISCUIT_DEFAULT;
  const outFile = (id) => path.join(OUT, `${id}.jpg`);

  const render = async (panel, characterRefs) => {
    if (!values.force && (await exists(outFile(panel.id)))) return;
    console.log(`Painting ${panel.id}…`);
    const refs = [path.join(PLATES, panel.plate), ...characterRefs, ...(dogPhoto ? [dogPhoto] : [])];
    const consistency = characterRefs.length ? ' Mika and Biscuit must look exactly as they do in the attached comic panel.' : '';
    const png = await paint(`${STYLE} ${panel.scene(dog)}${consistency}`, refs);
    await writeFile(outFile(panel.id), await sharp(png).jpeg({ quality: 88 }).toBuffer());
  };

  const [first, ...rest] = PANELS;
  await render(first, []);
  await Promise.all(rest.map((panel) => render(panel, [outFile(first.id)])));
  console.log(`Done: ${path.relative(ROOT, OUT)}`);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
