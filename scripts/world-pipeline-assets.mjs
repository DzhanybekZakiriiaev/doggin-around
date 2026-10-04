#!/usr/bin/env node
// Builds the stills for the world pipeline that plays over the way into panel 1, from the real assets:
//
//   node scripts/world-pipeline-assets.mjs
//
// - view-000/090/180/270.jpg: the four Gemini scene plates (worlds/plates), the side views;
// - pano.jpg: the Marble world's own 360° panorama (its pano_url in world.json);
// - collider.jpg is captured from the game (the yard's collider as wireframe from the opening view; see
//   docs/progress.md), and the splat view is public/comic/transition/game-start.jpg.

import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'world-pipeline');
const PLATES = path.join(ROOT, 'worlds', 'plates');
const WORLD = path.join(ROOT, 'worlds', 'out', 'yard-single', '2026-10-04T02-05-08_standard_77b1c400', 'world.json');

await mkdir(OUT, { recursive: true });

// The 270° plate was later cropped for the game; the side view is the whole one.
const plates = { '000': 'yard_000.jpg', '090': 'yard_090.jpg', '180': 'yard_180.jpg', '270': 'yard_270.original.jpg' };
for (const [angle, file] of Object.entries(plates)) {
  await sharp(path.join(PLATES, file)).resize(640).jpeg({ quality: 80, mozjpeg: true }).toFile(path.join(OUT, `view-${angle}.jpg`));
}

const { world } = JSON.parse(await readFile(WORLD, 'utf8'));
const panoUrl = world.assets?.imagery?.pano_url;
if (!panoUrl) throw new Error('world.json has no pano_url');
const response = await fetch(panoUrl);
if (!response.ok) throw new Error(`Panorama: ${response.status} ${response.statusText}`);
await sharp(Buffer.from(await response.arrayBuffer())).resize(2048, 1024, { fit: 'fill' }).jpeg({ quality: 80, mozjpeg: true }).toFile(path.join(OUT, 'pano.jpg'));
console.log(`Done: ${path.relative(ROOT, OUT)}`);
