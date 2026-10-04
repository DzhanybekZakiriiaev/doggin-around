#!/usr/bin/env node
// Paints the Storm Night comic panels with Gemini (the menu's comic: the bad ending first, the good one
// after the quest). Each panel uses the location plates the worlds were generated from as its background
// reference, plus the official Biscuit reference (worlds/plates/biscuit_reference.png, the Huawei dog the
// 3D model was made from). Panel 1 is the yard plate's exact framing seen through Mika's eyes, so it can
// dissolve straight into the first-person game; the first panel with Mika in it is the character reference
// for the rest. Lettering (captions, sound effects) is added in HTML by the game, so the art has none.
//
//   npm run comic                        # paints whatever is missing
//   npm run comic -- --force             # repaints everything
//   npm run comic -- --only panel-1 --force
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
const DOG_REFERENCE = path.join(PLATES, 'biscuit_reference.png');
const BISCUIT =
  'Biscuit, the small dog in the attached studio photo: fluffy, curly white coat, a blue satin bandana with white ' +
  'daisies on his head, round peach-framed sunglasses, and a blue-and-orange ribbon tied at his neck (keep all of ' +
  'these exactly; he is small, knee-high to an adult)';

const PANELS = [
  {
    id: 'panel-1',
    plates: ['yard_000.jpg'],
    aspect: '16:9',
    size: '2K',
    scene: () =>
      "Keep the attached yard picture's exact framing and composition: the same camera, at eye level from the middle " +
      'of the yard, facing the log cabin, its porch, steps, glowing lantern and shut red front door. This is what Mika ' +
      `sees: nobody else is in the picture. ${BISCUIT} sits on the gravel path in the near foreground, a little right ` +
      'of centre, looking up at the viewer with a sheepish, guilty face and muddy front paws; behind him, the freshly ' +
      'dug hole in the bare soil beside the porch steps. Overcast dusk turning stormy: the first raindrops, a flicker ' +
      'of lightning behind the pines.',
  },
  {
    id: 'panel-2-bad',
    plates: ['yard_180.jpg'],
    aspect: '4:5',
    scene: () =>
      `Night and heavy rain in the same yard. ${MIKA}, on her knees in the mud of the flower bed, searching with her ` +
      `bare hands by flashlight, exhausted and soaked through. ${BISCUIT} cowers under the porch steps behind her, ` +
      'shivering, ears flat. Cold blue light.',
  },
  {
    id: 'panel-3-bad',
    plates: ['yard_180.jpg'],
    aspect: '4:5',
    scene: () =>
      `Midnight, a violent thunderstorm, a huge lightning bolt across the sky. ${BISCUIT}, terrified, bolts through ` +
      'the gap in the split-rail fence into the dark pine forest. In the foreground Mika reaches out after him in the ' +
      'pouring rain, too late. Dark, cold, dramatic.',
  },
  {
    id: 'panel-2-good',
    plates: ['yard_000.jpg'],
    aspect: '4:5',
    scene: () =>
      `Dusk and light rain by the porch steps of the same cabin. ${BISCUIT} digs furiously in the freshly dug hole ` +
      'beside the steps, dirt flying, and proudly lifts a small brass key out of the soil in his mouth. Mika kneels ' +
      'beside him, delighted, reaching to ruffle his ears. Warm lantern light.',
  },
  {
    id: 'panel-4-bad',
    plates: ['yard_270.original.jpg'],
    aspect: '4:5',
    scene: () =>
      'Later that night, deep in the dark, dripping pine forest beyond the fence. Mika alone, soaked, sweeping a ' +
      'flashlight beam between the tree trunks and calling out with her hands cupped around her mouth. No dog anywhere: ' +
      'only a trail of small muddy paw prints fading into the dark. Lonely, cold blue night.',
  },
  {
    id: 'panel-5-bad',
    plates: ['yard_180.jpg'],
    aspect: '4:5',
    scene: () =>
      `Grey dawn after the storm, the same yard, everything wet. Mika sits slumped on the porch steps, exhausted, ` +
      `holding Biscuit's blue daisy bandana that she found snagged on a branch. A home-made "lost dog" poster with a ` +
      'drawing of Biscuit is pinned to the fence post beside the mailbox (no readable words, just a drawing and ' +
      'squiggles). The garden is empty and quiet. Melancholy.',
  },
  {
    id: 'panel-3-good',
    plates: ['yard_000.jpg'],
    aspect: '4:5',
    scene: () =>
      `Close on the cabin's red front door at dusk in light rain: Mika's hand turns the small brass key in the lock and ` +
      `the door swings open, warm golden firelight spilling out across the porch. ${BISCUIT} is already darting ` +
      'inside past her legs, tail up, happy. Triumphant, cozy.',
  },
  {
    id: 'panel-5-good',
    plates: ['yard_000.jpg'],
    aspect: '4:5',
    scene: () =>
      `The next morning in bright sunshine, the storm gone, puddles sparkling in the same yard. Mika on the porch in a ` +
      `sweater, hanging the small brass spare key on a new hook beside the red door, laughing. ${BISCUIT} sits ` +
      'proudly at her feet, chest out, with a fresh smear of mud on his nose. Warm, bright, happy.',
  },
  {
    id: 'panel-4-good',
    plates: ['cabin_000.jpg', 'cabin_090.jpg'],
    aspect: '4:5',
    scene: () =>
      'Night inside the attached cozy log cabin: a crackling fire in the stone fireplace. Mika asleep on the couch ' +
      `under a knitted blanket, her yellow raincoat drying on a hook, and ${BISCUIT} curled up asleep against her, ` +
      'sunglasses pushed up on his head. Rain streaks the dark window. Warm amber firelight, peaceful.',
  },
];

async function inlineImage(file) {
  const data = await readFile(file);
  return { inline_data: { mime_type: file.endsWith('.png') ? 'image/png' : 'image/jpeg', data: data.toString('base64') } };
}

async function paint(prompt, references, { aspect = '4:5', size = '1K' } = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set. Add it to .env or export it in your shell.');
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }, ...(await Promise.all(references.map(inlineImage)))] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspect, imageSize: size } },
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
  const { values } = parseArgs({ options: { force: { type: 'boolean', default: false }, only: { type: 'string' } } });
  await mkdir(OUT, { recursive: true });
  const only = values.only?.split(',');
  const outFile = (id) => path.join(OUT, `${id}.jpg`);

  const render = async (panel, characterRefs) => {
    if (only && !only.includes(panel.id)) return;
    if (!values.force && (await exists(outFile(panel.id)))) return;
    console.log(`Painting ${panel.id}…`);
    const refs = [...panel.plates.map((plate) => path.join(PLATES, plate)), DOG_REFERENCE, ...characterRefs];
    const consistency = characterRefs.length
      ? ' Mika and Biscuit must look exactly as they do in the attached comic panel, in the same comic style.'
      : '';
    const png = await paint(`${STYLE} ${panel.scene()}${consistency}`, refs, panel);
    await writeFile(outFile(panel.id), await sharp(png).jpeg({ quality: 88 }).toBuffer());
  };

  // Panel 1 (Biscuit only) sets the look; panel 2 (the first with Mika) is the character reference for the rest.
  const byId = Object.fromEntries(PANELS.map((panel) => [panel.id, panel]));
  await render(byId['panel-1'], []);
  await render(byId['panel-2-bad'], [outFile('panel-1')]);
  const rest = PANELS.filter((panel) => !['panel-1', 'panel-2-bad'].includes(panel.id));
  await Promise.all(rest.map((panel) => render(panel, [outFile('panel-2-bad')])));
  console.log(`Done: ${path.relative(ROOT, OUT)}`);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
