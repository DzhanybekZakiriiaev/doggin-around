#!/usr/bin/env node
// Repairs a Marble panorama before the final world is generated from it.
//
// Multi-image worlds are stitched from separate plates, which leaves seams (sometimes black gaps)
// where the plates meet and an invented, often repetitive floor and ceiling/sky. This cuts
// perspective views out of the 360° panorama, centred on each seam and straight up/down,
// has Gemini repaint them, and blends the repaired areas back with soft masks so the
// plate content between the seams is left untouched.
//
//   npm run pano -- <scene> <worldId | pano file> [--only seam45,seam135,seam225,seam315,up,down] [--dry-run]
//
// --dry-run skips Gemini and blends the views back unchanged, to check the projection round trip.
// Writes pano_fixed.png (plus every view before/after in pano_fix/) next to the source panorama.
// Then: npm run worlds -- final <scene> --pano <that pano_fixed.png>

import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODEL = 'gemini-3-pro-image';
const FACE_SIZE = 1024;
const CONCURRENCY = 3;

try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  // No .env file; GEMINI_API_KEY may come from the shell.
}

// ---------- Views ----------
// Directions use x = right, y = up, z = forward (panorama centre). A view is a pinhole camera
// with forward/right/up axes; `weight` says how much of the repaired view replaces the original.

const deg = (degrees) => (degrees * Math.PI) / 180;
const smoothstep = (edge0, edge1, x) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

function seamView(yawDegrees) {
  const yaw = deg(yawDegrees);
  return {
    name: `seam${yawDegrees}`,
    kind: 'seam',
    fov: 90,
    forward: [Math.sin(yaw), 0, Math.cos(yaw)],
    right: [Math.cos(yaw), 0, -Math.sin(yaw)],
    up: [0, 1, 0],
    // A vertical band around the seam, fading out before the plate content and the view's top and bottom.
    weight: (a, b) => (1 - smoothstep(0.3, 0.65, Math.abs(a))) * (1 - smoothstep(0.75, 1, Math.abs(b))),
  };
}

function capView(name, sign) {
  return {
    name,
    kind: name,
    fov: 110,
    forward: [0, sign, 0],
    right: [1, 0, 0],
    up: [0, 0, -sign], // looking down: forward is at the top of the image; looking up: behind is
    // Everything beyond ~52° of latitude, fading in from 40°.
    weight: (a, b, lat) => smoothstep(deg(40), deg(52), Math.abs(lat)),
  };
}

const VIEWS = [seamView(45), seamView(135), seamView(225), seamView(315), capView('up', 1), capView('down', -1)];

const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];

// ---------- Pixels ----------

function sampleBilinear(image, fx, fy, out, wrapX) {
  const { data, width, height } = image;
  let x0 = Math.floor(fx);
  const y0 = Math.min(height - 1, Math.max(0, Math.floor(fy)));
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = fx - x0;
  const ty = Math.min(1, Math.max(0, fy - y0));
  let x1 = x0 + 1;
  if (wrapX) {
    x0 = ((x0 % width) + width) % width;
    x1 = ((x1 % width) + width) % width;
  } else {
    x0 = Math.min(width - 1, Math.max(0, x0));
    x1 = Math.min(width - 1, Math.max(0, x1));
  }
  for (let c = 0; c < 3; c++) {
    const top = data[(y0 * width + x0) * 3 + c] * (1 - tx) + data[(y0 * width + x1) * 3 + c] * tx;
    const bottom = data[(y1 * width + x0) * 3 + c] * (1 - tx) + data[(y1 * width + x1) * 3 + c] * tx;
    out[c] = top * (1 - ty) + bottom * ty;
  }
}

async function readRgb(input) {
  const { data, info } = await sharp(input).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

const toPng = (image) =>
  sharp(image.data, { raw: { width: image.width, height: image.height, channels: 3 } }).png().toBuffer();

/** Renders one perspective view out of the equirectangular panorama. */
function extractView(pano, view) {
  const tanHalf = Math.tan(deg(view.fov) / 2);
  const data = Buffer.alloc(FACE_SIZE * FACE_SIZE * 3);
  const pixel = [0, 0, 0];
  for (let j = 0; j < FACE_SIZE; j++) {
    for (let i = 0; i < FACE_SIZE; i++) {
      const a = (((i + 0.5) / FACE_SIZE) * 2 - 1) * tanHalf;
      const b = (1 - ((j + 0.5) / FACE_SIZE) * 2) * tanHalf;
      const d = [0, 1, 2].map((k) => view.forward[k] + a * view.right[k] + b * view.up[k]);
      const length = Math.hypot(...d);
      const lon = Math.atan2(d[0], d[2]);
      const lat = Math.asin(d[1] / length);
      const fx = ((lon + Math.PI) / (2 * Math.PI)) * pano.width - 0.5;
      const fy = ((Math.PI / 2 - lat) / Math.PI) * pano.height - 0.5;
      sampleBilinear(pano, fx, fy, pixel, true);
      data.set(pixel.map(Math.round), (j * FACE_SIZE + i) * 3);
    }
  }
  return { data, width: FACE_SIZE, height: FACE_SIZE };
}

/** Blends a repaired view back into the panorama in place. */
function blendView(pano, view, face) {
  const tanHalf = Math.tan(deg(view.fov) / 2);
  const pixel = [0, 0, 0];
  for (let y = 0; y < pano.height; y++) {
    const lat = Math.PI / 2 - ((y + 0.5) / pano.height) * Math.PI;
    for (let x = 0; x < pano.width; x++) {
      const lon = ((x + 0.5) / pano.width) * 2 * Math.PI - Math.PI;
      const d = [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
      const depth = dot(d, view.forward);
      if (depth <= 0) continue;
      const a = dot(d, view.right) / depth / tanHalf;
      const b = dot(d, view.up) / depth / tanHalf;
      if (Math.abs(a) > 1 || Math.abs(b) > 1) continue;
      const w = view.weight(a, b, lat);
      if (w <= 0) continue;
      sampleBilinear(face, ((a + 1) / 2) * face.width - 0.5, ((1 - b) / 2) * face.height - 0.5, pixel, false);
      const offset = (y * pano.width + x) * 3;
      for (let c = 0; c < 3; c++) pano.data[offset + c] = Math.round(pano.data[offset + c] * (1 - w) + pixel[c] * w);
    }
  }
}

// ---------- Gemini ----------

function promptFor(view, hints) {
  const keep =
    'Keep the hand-painted comic illustration style, colours and lighting exactly as they are. ' +
    'Do not add people, animals, text, logos, borders or frames.';
  if (view.kind === 'seam') {
    return (
      `This square image is a 90-degree perspective view from inside a 360-degree panorama of ${hints.place}. ` +
      'The panorama was stitched from separate pictures, so a vertical seam runs down the middle of this view, ' +
      'with mismatched edges and possibly black gaps, black borders or smeared areas around it. ' +
      'Repaint only the seam area so the scene continues naturally and seamlessly across it: continue walls, logs, ' +
      'beams, floor, ground, trees and objects with correct perspective, and fill every black area. ' +
      `Keep the rest of the image exactly the same, with the same objects in the same places. ${keep}`
    );
  }
  const subject = view.kind === 'down' ? hints.down : hints.up;
  const looking = view.kind === 'down' ? 'straight down at the ground from eye height' : 'straight up';
  return (
    `This square image looks ${looking} from inside a 360-degree panorama of ${hints.place}. ` +
    'The middle of it is distorted, smeared, repeated or black because no photo covered this direction. ' +
    `Repaint the middle as a believable, continuous ${subject}, seen in correct perspective from this viewpoint. ` +
    'Blend smoothly into the outer edges of the image, which must stay as they are. ' +
    `No repeating patterns, no black areas, no camera, tripod, feet or shadows of a person. ${keep}`
  );
}

async function repaint(png, prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set. Add it to .env or export it in your shell.');
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: 'image/png', data: png.toString('base64') } }] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1', imageSize: '1K' } },
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${body.slice(0, 500)}`);
  const parts = JSON.parse(body).candidates?.[0]?.content?.parts ?? [];
  const image = parts.find((part) => part.inlineData ?? part.inline_data);
  if (!image) throw new Error(`Gemini returned no image: ${body.slice(0, 500)}`);
  return Buffer.from((image.inlineData ?? image.inline_data).data, 'base64');
}

// ---------- Command ----------

async function resolvePano(scene, target) {
  if (await stat(target).catch(() => null)) return path.resolve(target);
  const sceneDir = path.join(ROOT, 'worlds', 'out', scene);
  const run = (await readdir(sceneDir).catch(() => [])).find((name) => name.endsWith(`_${target.slice(0, 8)}`));
  if (!run) throw new Error(`No downloaded run for world ${target} in worlds/out/${scene}`);
  return path.join(sceneDir, run, 'pano.png');
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { only: { type: 'string' }, 'dry-run': { type: 'boolean', default: false } },
  });
  const [scene, target] = positionals;
  if (!scene || !target) {
    console.log('Usage: npm run pano -- <scene> <worldId | pano file> [--only seam45,seam135,seam225,seam315,up,down]');
    process.exitCode = 1;
    return;
  }
  const hints = JSON.parse(await readFile(path.join(ROOT, 'worlds', 'scenes', `${scene}.json`), 'utf8')).panoFix;
  if (!hints) throw new Error(`worlds/scenes/${scene}.json has no panoFix hints`);

  const panoPath = await resolvePano(scene, target);
  const outDir = path.join(path.dirname(panoPath), 'pano_fix');
  await mkdir(outDir, { recursive: true });
  const pano = await readRgb(panoPath);
  const only = values.only?.split(',');
  const views = VIEWS.filter((view) => !only || only.includes(view.name));
  console.log(`Repairing ${path.relative(ROOT, panoPath)} (${pano.width}x${pano.height}) with ${MODEL}: ${views.map((v) => v.name).join(', ')}`);

  // Cut every view from the untouched panorama first, then repaint a few at a time.
  const faces = new Map();
  const queue = [...views];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let view = queue.shift(); view; view = queue.shift()) {
        const png = await toPng(extractView(pano, view));
        await writeFile(path.join(outDir, `${view.name}.png`), png);
        const started = Date.now();
        // A dry run blends the untouched views back, which must reproduce the original panorama.
        const repaired = values['dry-run'] ? png : await repaint(png, promptFor(view, hints));
        await writeFile(path.join(outDir, `${view.name}.fixed.png`), repaired);
        faces.set(view.name, await readRgb(await sharp(repaired).resize(FACE_SIZE, FACE_SIZE, { fit: 'fill' }).png().toBuffer()));
        console.log(`  ${view.name}: repainted in ${Math.round((Date.now() - started) / 1000)}s`);
      }
    }),
  );

  // Seams first, then the caps, so the ceiling/sky and floor win where they overlap.
  for (const view of views) blendView(pano, view, faces.get(view.name));
  const outPath = path.join(path.dirname(panoPath), 'pano_fixed.png');
  await writeFile(outPath, await toPng(pano));
  console.log(`Saved ${path.relative(ROOT, outPath)}\nNext: npm run worlds -- final ${scene} --pano ${path.relative(ROOT, outPath).split(path.sep).join('/')}`);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
