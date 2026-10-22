#!/usr/bin/env node
// Builds the stills for the world pipeline that plays over the way into panel 1, from the real assets:
//
//   node scripts/world-pipeline-assets.mjs
//
// - view-000/090/180/270.jpg: the four Gemini scene plates (worlds/plates), the side views;
// - sphere.jpg: those plates projected onto the sphere as they are, before stitching cleans them up;
// - pano.jpg: the world's 360° panorama (its pano_url in world.json).
// The rest come from the world itself: depth.jpg, points.jpg, holes.jpg, filled.jpg and splat.jpg from
// scripts/world-pipeline-capture.html; collider.jpg and collider-splats.jpg captured from the game (the
// yard's collider as wireframe from the opening view); the splat view is public/comic/transition/game-start.jpg.

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

// sphere.jpg: the four plates projected onto the sphere as they are (90° wide, a quarter turn apart), the
// panorama before stitching cleans it up: seams where neighbours meet, nothing above or below them.
{
  const PW = 1600;
  const PH = 800;
  const HALF_WIDTH = Math.tan(Math.PI / 4); // 90° horizontal field of view
  const yaws = { '000': 0, '090': Math.PI / 2, '180': Math.PI, '270': -Math.PI / 2 };
  const sources = [];
  for (const [angle, file] of Object.entries(plates)) {
    const { data, info } = await sharp(path.join(PLATES, file)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    sources.push({ yaw: yaws[angle], data, width: info.width, height: info.height });
  }
  const out = Buffer.alloc(PW * PH * 3);
  for (let v = 0; v < PH; v++) {
    const lat = Math.PI / 2 - ((v + 0.5) / PH) * Math.PI;
    for (let u = 0; u < PW; u++) {
      const lon = ((u + 0.5) / PW) * 2 * Math.PI - Math.PI;
      // The plate whose centre is nearest this longitude, then its pinhole camera.
      let best;
      let bestDelta = Infinity;
      for (const source of sources) {
        const delta = Math.atan2(Math.sin(lon - source.yaw), Math.cos(lon - source.yaw));
        if (Math.abs(delta) < Math.abs(bestDelta)) {
          best = source;
          bestDelta = delta;
        }
      }
      const x = Math.tan(bestDelta) / HALF_WIDTH;
      const halfHeight = (HALF_WIDTH * best.height) / best.width;
      const y = Math.tan(lat) / Math.cos(bestDelta) / halfHeight;
      if (Math.abs(x) > 1 || Math.abs(y) > 1) continue; // outside every plate: left black
      const px = Math.min(best.width - 1, Math.floor(((x + 1) / 2) * best.width));
      const py = Math.min(best.height - 1, Math.floor(((1 - y) / 2) * best.height));
      const from = (py * best.width + px) * 3;
      const to = (v * PW + u) * 3;
      out[to] = best.data[from];
      out[to + 1] = best.data[from + 1];
      out[to + 2] = best.data[from + 2];
    }
  }
  await sharp(out, { raw: { width: PW, height: PH, channels: 3 } }).jpeg({ quality: 80, mozjpeg: true }).toFile(path.join(OUT, 'sphere.jpg'));
}

const { world } = JSON.parse(await readFile(WORLD, 'utf8'));
const panoUrl = world.assets?.imagery?.pano_url;
if (!panoUrl) throw new Error('world.json has no pano_url');
const response = await fetch(panoUrl);
if (!response.ok) throw new Error(`Panorama: ${response.status} ${response.statusText}`);
await sharp(Buffer.from(await response.arrayBuffer())).resize(2048, 1024, { fit: 'fill' }).jpeg({ quality: 80, mozjpeg: true }).toFile(path.join(OUT, 'pano.jpg'));
console.log(`Done: ${path.relative(ROOT, OUT)}`);
