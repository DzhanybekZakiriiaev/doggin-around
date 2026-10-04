#!/usr/bin/env node
// Generates Panel Walk's walkable worlds with the World Labs Marble API and downloads every asset.
// Run `npm run worlds -- help` for usage. API docs: https://docs.worldlabs.ai/api

import { createWriteStream } from 'node:fs';
import { appendFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORLDS_DIR = path.join(ROOT, 'worlds');
const OUT_DIR = path.join(WORLDS_DIR, 'out');

const API = 'https://api.worldlabs.ai/marble/v1';
const MODELS = { draft: 'marble-1.0-draft', standard: 'marble-1.1', plus: 'marble-1.1-plus' };
const IMAGE_TYPES = ['png', 'jpg', 'jpeg', 'webp'];
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const POLL_MS = 10_000;

const HELP = `World Labs world generation

  npm run worlds -- generate <scene...> [--model draft|standard|plus] [--seed N] [--dry-run]
      Multi-image world from worlds/scenes/<scene>.json and the plates in worlds/plates/.
      Several scenes start together. Default model: draft (250 credits, ~$0.20).

  npm run worlds -- final <scene> (--from <worldId> | --pano <file>) [--model standard|plus] [--seed N] [--dry-run]
      Final world from a draft's panorama (or an edited one), so the layout matches the draft.
      Default model: standard (1,500 credits, ~$1.20).

  npm run worlds -- poll <scene> <operationId>    Resume waiting on a generation and download it.
  npm run worlds -- fetch <scene> <worldId>       Download an existing world's assets again.
  npm run worlds -- credits                       Show the remaining API credit balance.

The key is read from WLT_API_KEY (environment or .env). Output goes to worlds/out/<scene>/.`;

try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  // No .env file; WLT_API_KEY may come from the shell.
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (scene, message) => console.log(`[${scene}] ${message}`);

class CliError extends Error {}
const fail = (message) => {
  throw new CliError(message);
};

const STATUS_HINTS = {
  401: 'The API key is missing, wrong or expired.',
  402: 'Not enough API credits. Buy them at https://platform.worldlabs.ai/billing (Marble app credits do not work here).',
  422: 'The request did not match the API schema.',
};

async function api(method, endpoint, body) {
  const key = process.env.WLT_API_KEY;
  if (!key) fail('WLT_API_KEY is not set. Add it to .env or export it in your shell.');

  for (let attempt = 1; ; attempt++) {
    const res = await fetch(API + endpoint, {
      method,
      headers: { 'WLT-Api-Key': key, ...(body && { 'Content-Type': 'application/json' }) },
      body: body && JSON.stringify(body),
    });
    // A 429 means the request was not accepted, so retrying cannot start a duplicate generation.
    if (res.status === 429 && attempt < 4) {
      const waitSeconds = Number(res.headers.get('retry-after')) || 20 * attempt;
      console.log(`Rate limited by World Labs, retrying in ${waitSeconds}s`);
      await sleep(waitSeconds * 1000);
      continue;
    }
    const text = await res.text();
    if (!res.ok) {
      const hint = STATUS_HINTS[res.status] ? `\n${STATUS_HINTS[res.status]}` : '';
      fail(`${method} ${endpoint} failed: ${res.status} ${res.statusText}\n${text}${hint}`);
    }
    return text ? JSON.parse(text) : null;
  }
}

// ---------- Scenes and inputs ----------

async function loadScene(name) {
  const file = path.join(WORLDS_DIR, 'scenes', `${name}.json`);
  let scene;
  try {
    scene = JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    fail(`Could not read scene "${name}" from ${path.relative(ROOT, file)}: ${err.message}`);
  }

  const problems = [];
  if (!scene.displayName) problems.push('displayName is required');
  if (!scene.textPrompt) problems.push('textPrompt is required');
  if (scene.textPrompt?.length > 2000) problems.push(`textPrompt is ${scene.textPrompt.length} characters (max 2,000)`);
  if (!Array.isArray(scene.images) || scene.images.length < 1 || scene.images.length > 4) {
    problems.push('images must list 1 to 4 plates');
  }
  for (const image of scene.images ?? []) {
    image.path = path.join(WORLDS_DIR, 'plates', image.file);
    const ext = path.extname(image.file).slice(1).toLowerCase();
    if (!IMAGE_TYPES.includes(ext)) problems.push(`${image.file}: use ${IMAGE_TYPES.join(', ')}`);
    if (scene.images.length > 1 && typeof image.azimuth !== 'number') problems.push(`${image.file}: azimuth is required`);
    const info = await stat(image.path).catch(() => null);
    if (!info) problems.push(`${image.file}: not found in worlds/plates/`);
    else if (info.size > MAX_IMAGE_BYTES) problems.push(`${image.file}: larger than 20 MB`);
  }
  if (problems.length) fail(`Scene "${name}" is not ready:\n  - ${problems.join('\n  - ')}`);
  return scene;
}

function resolveModel(key, allowed) {
  if (!allowed.includes(key)) fail(`--model must be one of: ${allowed.join(', ')}`);
  return MODELS[key];
}

function parseSeed(value) {
  if (value === undefined) return undefined;
  const seed = Number(value);
  if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) fail('--seed must be an integer from 0 to 4294967295');
  return seed;
}

// Uploads a local file as a media asset and returns the reference the generate endpoint expects.
async function uploadImage(filePath, dryRun) {
  if (dryRun) return { source: 'media_asset', media_asset_id: `<upload of ${path.basename(filePath)}>` };

  const extension = path.extname(filePath).slice(1).toLowerCase();
  const { media_asset: asset, upload_info: upload } = await api('POST', '/media-assets:prepare_upload', {
    file_name: path.basename(filePath).slice(-64),
    kind: 'image',
    extension,
  });
  const res = await fetch(upload.upload_url, {
    method: upload.upload_method ?? 'PUT',
    headers: upload.required_headers ?? {},
    body: await readFile(filePath),
  });
  if (!res.ok) fail(`Uploading ${path.basename(filePath)} failed: ${res.status} ${await res.text()}`);
  return { source: 'media_asset', media_asset_id: asset.media_asset_id ?? asset.id };
}

// ---------- Generation ----------

async function startGeneration(sceneName, scene, { model, seed, worldPrompt, label, dryRun }) {
  const body = {
    display_name: `${scene.displayName} (${label})`.slice(0, 64),
    model,
    world_prompt: worldPrompt,
    ...(scene.tags && { tags: scene.tags }),
    ...(seed !== undefined && { seed }),
  };
  if (dryRun) {
    log(sceneName, `Dry run, nothing sent. Request body:\n${JSON.stringify(body, null, 2)}`);
    return null;
  }

  const operation = await api('POST', '/worlds:generate', body);
  await record(sceneName, { event: 'started', operation_id: operation.operation_id, model, label, seed });
  log(sceneName, `Started ${model}, operation ${operation.operation_id}`);
  return operation.operation_id;
}

async function waitForOperation(sceneName, operationId) {
  const startedAt = Date.now();
  let lastStatus = '';
  let lastLogAt = 0;
  for (;;) {
    const operation = await api('GET', `/operations/${operationId}`);
    if (operation.error) fail(`[${sceneName}] Generation failed: ${JSON.stringify(operation.error)}`);
    if (operation.done) return operation;

    const status = operation.metadata?.progress?.description ?? operation.metadata?.progress?.status ?? 'Waiting';
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    if (status !== lastStatus || Date.now() - lastLogAt > 60_000) {
      log(sceneName, `${status} (${elapsed}s)`);
      lastStatus = status;
      lastLogAt = Date.now();
    }
    await sleep(POLL_MS);
  }
}

async function finishOperation(sceneName, operationId, label) {
  const operation = await waitForOperation(sceneName, operationId);
  const worldId = operation.metadata?.world_id ?? operation.response?.world_id ?? operation.response?.id;
  if (!worldId) fail(`[${sceneName}] Operation finished without a world id:\n${JSON.stringify(operation, null, 2)}`);

  // The operation only carries a snapshot; the world endpoint has the complete record.
  const world = await api('GET', `/worlds/${worldId}`);
  const dir = await saveWorld(sceneName, world, { label, operation_id: operationId, cost: operation.cost ?? null });
  await record(sceneName, {
    event: 'finished',
    operation_id: operationId,
    world_id: worldId,
    model: world.model,
    label,
    credits: operation.cost?.total_credits ?? null,
    dir: path.relative(ROOT, dir).split(path.sep).join('/'),
    marble_url: world.world_marble_url,
  });
  return dir;
}

// ---------- Output ----------

async function saveWorld(sceneName, world, extra = {}) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const modelKey = Object.keys(MODELS).find((key) => MODELS[key] === world.model) ?? 'world';
  const dir = path.join(OUT_DIR, sceneName, `${stamp}_${modelKey}_${world.world_id.slice(0, 8)}`);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'world.json'), JSON.stringify({ ...extra, world }, null, 2));

  const assets = world.assets ?? {};
  const downloads = [
    ...Object.entries(assets.splats?.spz_urls ?? {}).map(([resolution, url]) => [`splats_${resolution}.spz`, url]),
    ['collider.glb', assets.mesh?.collider_mesh_url],
    [`pano${extensionOf(assets.imagery?.pano_url, '.png')}`, assets.imagery?.pano_url],
    [`thumbnail${extensionOf(assets.thumbnail_url, '.jpg')}`, assets.thumbnail_url],
  ].filter(([, url]) => url);

  const results = await Promise.all(downloads.map(([name, url]) => download(url, path.join(dir, name))));
  const semantics = assets.splats?.semantics_metadata;
  log(sceneName, [
    `World ${world.world_id} (${world.model})`,
    `  View:  ${world.world_marble_url}`,
    `  Saved: ${path.relative(ROOT, dir)}`,
    ...results.map((line) => `    ${line}`),
    semantics
      ? `  metric_scale_factor ${semantics.metric_scale_factor}, ground_plane_offset ${semantics.ground_plane_offset}`
      : '  No semantics_metadata on this world',
    extra.cost?.total_credits != null ? `  Cost: ${extra.cost.total_credits} credits` : null,
  ].filter(Boolean).join('\n'));
  return dir;
}

function extensionOf(url, fallback) {
  if (!url) return fallback;
  const ext = path.extname(new URL(url).pathname);
  return ext && ext.length <= 5 ? ext : fallback;
}

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok || !res.body) return `${path.basename(file)}: download failed (${res.status}), retry with the fetch command`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
  const { size } = await stat(file);
  return `${path.basename(file)}: ${(size / 1024 / 1024).toFixed(1)} MB`;
}

async function record(sceneName, entry) {
  await mkdir(path.join(OUT_DIR, sceneName), { recursive: true });
  await appendFile(path.join(OUT_DIR, sceneName, 'runs.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
}

async function findDraftPano(sceneName, worldId) {
  const sceneDir = path.join(OUT_DIR, sceneName);
  const runs = await readdir(sceneDir).catch(() => []);
  const run = runs.find((name) => name.endsWith(`_${worldId.slice(0, 8)}`));
  if (!run) fail(`No downloaded run for world ${worldId} in ${path.relative(ROOT, sceneDir)}. Download it first with the fetch command.`);
  const pano = (await readdir(path.join(sceneDir, run))).find((name) => name.startsWith('pano.'));
  if (!pano) fail(`Run ${run} has no panorama file.`);
  return path.join(sceneDir, run, pano);
}

// ---------- Commands ----------

async function generate(sceneNames, options) {
  if (!sceneNames.length) fail('Name at least one scene, e.g. generate yard cabin');
  const modelKey = options.model ?? 'draft';
  const model = resolveModel(modelKey, ['draft', 'standard', 'plus']);
  const seed = parseSeed(options.seed);
  const scenes = await Promise.all(sceneNames.map(loadScene));

  const started = [];
  for (const [i, sceneName] of sceneNames.entries()) {
    const scene = scenes[i];
    const contents = [];
    for (const image of scene.images) contents.push(await uploadImage(image.path, options['dry-run']));
    const worldPrompt =
      scene.images.length === 1
        ? { type: 'image', image_prompt: contents[0], is_pano: false }
        : {
            type: 'multi-image',
            multi_image_prompt: scene.images.map((image, j) => ({ azimuth: image.azimuth, content: contents[j] })),
          };
    worldPrompt.text_prompt = scene.textPrompt;
    worldPrompt.disable_recaption = true;

    const operationId = await startGeneration(sceneName, scene, {
      model, seed, worldPrompt, label: modelKey, dryRun: options['dry-run'],
    });
    if (operationId) started.push(finishOperation(sceneName, operationId, modelKey));
  }
  // Let every scene finish (or fail) on its own so one failure does not orphan the others.
  const failures = (await Promise.allSettled(started)).filter((result) => result.status === 'rejected');
  if (failures.length) fail(failures.map((result) => result.reason.message ?? result.reason).join('\n'));
}

async function final([sceneName], options) {
  if (!sceneName) fail('Name the scene, e.g. final yard --from <worldId>');
  if (!options.from === !options.pano) fail('Pass exactly one of --from <draft worldId> or --pano <file>');
  const modelKey = options.model ?? 'standard';
  const model = resolveModel(modelKey, ['standard', 'plus']);
  const scene = await loadScene(sceneName);

  const panoPath = options.pano ? path.resolve(options.pano) : await findDraftPano(sceneName, options.from);
  if (!(await stat(panoPath).catch(() => null))) fail(`Panorama not found: ${panoPath}`);
  const worldPrompt = {
    type: 'image',
    image_prompt: await uploadImage(panoPath, options['dry-run']),
    is_pano: true,
    text_prompt: scene.textPrompt,
    disable_recaption: true,
  };

  const operationId = await startGeneration(sceneName, scene, {
    model, seed: parseSeed(options.seed), worldPrompt, label: modelKey, dryRun: options['dry-run'],
  });
  if (operationId) await finishOperation(sceneName, operationId, modelKey);
}

async function poll([sceneName, operationId]) {
  if (!sceneName || !operationId) fail('Usage: poll <scene> <operationId>');
  await finishOperation(sceneName, operationId, 'resumed');
}

async function fetchWorld([sceneName, worldId]) {
  if (!sceneName || !worldId) fail('Usage: fetch <scene> <worldId>');
  await saveWorld(sceneName, await api('GET', `/worlds/${worldId}`), { label: 'fetched' });
}

async function credits() {
  const { remaining_credits: remaining } = await api('GET', '/credits');
  console.log(`${remaining} API credits (~$${(remaining / 1250).toFixed(2)})`);
}

const COMMANDS = { generate, final, poll, fetch: fetchWorld, credits };

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    model: { type: 'string' },
    seed: { type: 'string' },
    from: { type: 'string' },
    pano: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});
const [command, ...args] = positionals;

if (!command || values.help || command === 'help' || !COMMANDS[command]) {
  console.log(HELP);
  process.exitCode = command && command !== 'help' && !values.help ? 1 : 0;
} else {
  try {
    await COMMANDS[command](args, values);
  } catch (err) {
    console.error(err instanceof CliError ? err.message : err);
    process.exitCode = 1;
  }
}
