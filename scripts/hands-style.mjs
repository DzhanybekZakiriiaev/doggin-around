#!/usr/bin/env node
// Paints the first-person hands' look with Gemini so it matches the generated worlds:
//   1. a style reference: the player's own hands painted in the cabin plate's illustration style
//   2. matcaps (lit spheres) for the skin and the raincoat sleeve, painted from that reference
// The game shades the hand meshes with the matcaps, so they carry the painted lighting.
//
//   npm run hands-style            # paints whatever is missing
//   npm run hands-style -- --force # repaints everything
//
// Output: public/textures/hands/{reference,skin,sleeve}.png

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'textures', 'hands');
const RAW = path.join(ROOT, 'worlds', 'out', 'hands'); // uncropped Gemini output, git-ignored
const STYLE_PLATE = path.join(ROOT, 'worlds', 'plates', 'cabin_000.jpg');
const MODEL = 'gemini-3-pro-image';
const MATCAP_SIZE = 512;

try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  // No .env file; GEMINI_API_KEY may come from the shell.
}

const REFERENCE_PROMPT =
  'Paint a new image in exactly the same illustration style as the attached picture of a log cabin: ' +
  'the same painterly brush work, fine dark ink outlines, colour palette and warm-lamp-and-teal-window lighting. ' +
  'Subject: a first-person view of the viewer\'s own two hands in the lower half of the frame, reaching ' +
  'forward and relaxed, slightly curled, as if about to open a door. The forearms wear the cuffs of a ' +
  'mustard-yellow rubber raincoat with a darker yellow cuff band. Semi-realistic, natural adult proportions ' +
  '(not cartoonish): real hand anatomy, knuckles, short nails, subtle creases, painted skin with warm ' +
  'light from the left and a cool teal rim light from the right. Background: the cabin interior, softly ' +
  'out of focus. No text, no borders, no other people. 16:9.';

const matcapPrompt = (subject) =>
  `Using the attached painting as the style and lighting reference, paint a single perfect sphere made of ${subject}, ` +
  'centred on a plain pure black background and filling about 90% of the square image. Light it exactly like ' +
  'the hands in the reference: warm key light from the upper left, soft shadow on the lower right, a thin cool ' +
  'teal rim light along the right edge. Same painterly brush texture and subtle dark ink outline around the ' +
  'sphere. Nothing else in the image: no surface details, no props, no text, no reflections of objects.';

const MATCAPS = {
  skin: matcapPrompt('the same painted skin as the hands, with the same warm skin tone'),
  sleeve: matcapPrompt('the same mustard-yellow rubberized raincoat fabric as the sleeves, slightly glossy'),
};

async function paint(prompt, referencePath, aspectRatio) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set. Add it to .env or export it in your shell.');
  const image = await readFile(referencePath);
  const mimeType = referencePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: image.toString('base64') } }] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio, imageSize: '1K' } },
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${body.slice(0, 400)}`);
  const parts = JSON.parse(body).candidates?.[0]?.content?.parts ?? [];
  const part = parts.find((p) => p.inlineData ?? p.inline_data);
  if (!part) throw new Error(`Gemini returned no image: ${body.slice(0, 400)}`);
  return Buffer.from((part.inlineData ?? part.inline_data).data, 'base64');
}

/** Crops a painted sphere to its bounding square (everything brighter than the black background). */
async function cropSphere(png) {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width, maxX = 0, minY = info.height, maxY = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 3;
      if (data[i] + data[i + 1] + data[i + 2] > 60) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  const size = Math.max(maxX - minX, maxY - minY) + 1;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const left = Math.max(0, Math.round(cx - size / 2));
  const top = Math.max(0, Math.round(cy - size / 2));
  const side = Math.min(size, info.width - left, info.height - top);
  return sharp(png).extract({ left, top, width: side, height: side }).resize(MATCAP_SIZE, MATCAP_SIZE).png().toBuffer();
}

const exists = (file) => stat(file).then(() => true, () => false);

async function main() {
  const { values } = parseArgs({ options: { force: { type: 'boolean', default: false } } });
  await mkdir(OUT, { recursive: true });
  await mkdir(RAW, { recursive: true });

  const reference = path.join(OUT, 'reference.png');
  if (values.force || !(await exists(reference))) {
    console.log('Painting the style reference…');
    await writeFile(reference, await paint(REFERENCE_PROMPT, STYLE_PLATE, '16:9'));
  }

  await Promise.all(
    Object.entries(MATCAPS).map(async ([name, prompt]) => {
      const file = path.join(OUT, `${name}.png`);
      if (!values.force && (await exists(file))) return;
      console.log(`Painting the ${name} matcap…`);
      const raw = await paint(prompt, reference, '1:1');
      await writeFile(path.join(RAW, `${name}.raw.png`), raw);
      await writeFile(file, await cropSphere(raw));
    }),
  );
  console.log(`Done: ${path.relative(ROOT, OUT)}`);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
