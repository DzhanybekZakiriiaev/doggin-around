#!/usr/bin/env node
// Rebuilds the dog's walk and run clips inside its GLB with planted-paw gaits.
//
//   npm run dog-clips              rebuild public/models/dog-animated.glb in place
//   npm run dog-clips -- --dry-run measure the clips before/after without writing
//   npm run dog-clips -- --prune   also drop the data nothing in the GLB references (the authored file
//                                  carries two unused copies of the mesh and texture: ~5.7 MB)
//
// The authored clips skate (planted paws move at different speeds), leave paws in the ground or floating,
// lift three legs at once and bob the body ~7 cm. This poses every frame with the same IK gait the game uses
// (src/game/dog-gait.ts): a four-beat walk and a trot, each paw planted on flat ground, legs solved with two-bone
// IK. Body, head and tail keep a toned-down share of the authored motion. The clips keep the speed contract
// Larry's fetch demo uses (CONTACT_GAIT_SPEED: walk 2.25, run 4.7 Dog units/s at action rate 1), so they drop
// in. Only the walk and run animations change; meshes, skin, texture and the other clips are copied as is.
// Running it again rebuilds from the original clips (read from Larry's branch).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DogGait, gaitCycle } from '../src/game/dog-gait.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODEL = path.join(root, 'public/models/dog-animated.glb');
const RIG = path.join(root, 'public/models/huawei-dog-rig.json');
const ORIGINAL = 'origin/larry/dogmodels:public/models/dog-animated.glb';
const LENGTH = 0.85; // metres, nose to tail: the gait is tuned at Biscuit's size and everything scales with him
const DOG_UNITS = 2.6; // the Dog class normalises the model to this length; the speed contract is in these units
const CLIPS = [
  { name: 'walk', trot: false, contactSpeed: 2.25 },
  { name: 'run', trot: true, contactSpeed: 4.7 },
];
const FPS = 60;
const BODY_KEEP = 0.4; // share of the authored body/head/tail motion kept (all of it bobbed far too much)
const dryRun = process.argv.includes('--dry-run');
const prune = process.argv.includes('--prune');

// ---------- GLB in and out ----------

function readGlb(buffer) {
  if (buffer.readUInt32LE(0) !== 0x46546c67) throw new Error('Not a GLB file');
  const jsonLength = buffer.readUInt32LE(12);
  const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
  const binHeader = 20 + jsonLength;
  const bin = buffer.subarray(binHeader + 8, binHeader + 8 + buffer.readUInt32LE(binHeader));
  return { json, bin };
}

function writeGlb(json, bin) {
  const pad = (length) => (4 - (length % 4)) % 4;
  let text = Buffer.from(JSON.stringify(json), 'utf8');
  text = Buffer.concat([text, Buffer.alloc(pad(text.length), 0x20)]);
  const data = Buffer.concat([bin, Buffer.alloc(pad(bin.length))]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + text.length + 8 + data.length, 8);
  const chunk = (length, type) => {
    const head = Buffer.alloc(8);
    head.writeUInt32LE(length, 0);
    head.writeUInt32LE(type, 4);
    return head;
  };
  return Buffer.concat([header, chunk(text.length, 0x4e4f534a), text, chunk(data.length, 0x004e4942), data]);
}

const isRebuilt = ({ json }) => !!json.animations?.find((animation) => animation.name === 'walk')?.extras?.rebuiltBy;

function loadSource() {
  const current = readGlb(fs.readFileSync(MODEL));
  if (!isRebuilt(current)) return { glb: current, from: path.relative(root, MODEL) };
  // Already rebuilt: start again from the authored clips, not from our own output.
  const original = readGlb(execFileSync('git', ['show', ORIGINAL], { cwd: root, maxBuffer: 1 << 28 }));
  if (isRebuilt(original)) throw new Error(`${ORIGINAL} is a rebuilt file too; restore the authored GLB first`);
  return { glb: original, from: ORIGINAL };
}

/** three.js in Node can't decode images, and the clips don't need them: parse a copy without textures. */
async function parseForThree({ json, bin }) {
  const copy = structuredClone(json);
  delete copy.images;
  delete copy.textures;
  delete copy.samplers;
  for (const material of copy.materials ?? []) {
    for (const key of ['normalTexture', 'occlusionTexture', 'emissiveTexture']) delete material[key];
    delete material.pbrMetallicRoughness?.baseColorTexture;
    delete material.pbrMetallicRoughness?.metallicRoughnessTexture;
  }
  const buffer = writeGlb(copy, bin);
  return new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length), '');
}

// ---------- The dog, posed in a metres frame like the game's ----------

const source = loadSource();
const gltf = await parseForThree(source.glb);
const rig = JSON.parse(fs.readFileSync(RIG, 'utf8'));
const scene = gltf.scene;
const model = new THREE.Group(); // the Dog's group: the gait moves it for the body bob
const frame = new THREE.Group(); // ground at y = 0, facing -Z, metres
model.add(scene);
frame.add(model);
scene.updateMatrixWorld(true);
// Normalised as the Dog class does (longest side, feet on the ground, centred), but to LENGTH metres.
const box = new THREE.Box3().setFromObject(scene);
const size = box.getSize(new THREE.Vector3());
const center = box.getCenter(new THREE.Vector3());
const scale = LENGTH / Math.max(size.x, size.y, size.z);
scene.scale.setScalar(scale);
scene.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
frame.updateMatrixWorld(true);

const skinned = [];
scene.traverse((object) => object.isSkinnedMesh && skinned.push(object));
const bones = skinned[0].skeleton.bones;
const bodyRoot = scene.getObjectByName(rig.root);
const gait = new DogGait(rig, model, frame, () => 0);
gait.lift = 0;

// Leg chains from the shoulder blade / hip down take their pose from the gait (on top of the rest pose);
// everything else (spine, neck, head, ears, tail) keeps part of the authored motion.
const legBones = new Set();
for (const leg of rig.legs) scene.getObjectByName(leg.upper).parent.traverse((object) => object.isBone && legBones.add(object));

function evaluator(clip) {
  const tracks = clip.tracks.map((track) => {
    const { nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(track.name);
    return { key: `${nodeName}.${propertyName}`, interpolant: track.createInterpolant() };
  });
  return (time) => new Map(tracks.map(({ key, interpolant }) => [key, Array.from(interpolant.evaluate(time))]));
}

const clipNamed = (name) => {
  const clip = gltf.animations.find((candidate) => candidate.name.toLowerCase() === name);
  if (!clip) throw new Error(`The GLB has no ${name} clip`);
  return clip;
};
const rest = evaluator(clipNamed('idle'))(0);

function bake({ name, trot, contactSpeed }) {
  const authored = clipNamed(name);
  const authoredAt = evaluator(authored);
  const speed = (contactSpeed * LENGTH) / DOG_UNITS; // m/s at action rate 1
  const { hz } = gaitCycle(speed, trot ? 1 : 0);
  const duration = 1 / hz;
  const frames = Math.round(duration * FPS);
  const times = [];
  const tracks = new Map(bones.map((bone) => [bone.name, { rotation: [], translation: [], scale: [] }]));
  const q = new THREE.Quaternion();
  const body = new THREE.Vector3();
  for (let k = 0; k <= frames; k++) {
    const phase = k / frames;
    times.push(phase * duration);
    const original = authoredAt(phase * authored.duration);
    for (const bone of bones) {
      const at = (property, values) => values.get(`${bone.name}.${property}`);
      bone.position.fromArray(at('position', rest));
      bone.scale.fromArray(at('scale', rest));
      bone.quaternion.fromArray(at('quaternion', rest));
      if (!legBones.has(bone)) bone.quaternion.slerp(q.fromArray(at('quaternion', original)), BODY_KEEP);
    }
    model.position.set(0, 0, 0);
    frame.updateMatrixWorld(true);
    gait.poseAt(phase, trot, speed);
    // The gait bobs the whole model; bake that into the body joint's translation instead.
    bodyRoot.getWorldPosition(body);
    model.position.set(0, 0, 0);
    model.updateMatrixWorld(true);
    bodyRoot.position.copy(bodyRoot.parent.worldToLocal(body));
    for (const bone of bones) {
      const track = tracks.get(bone.name);
      const previous = track.rotation.slice(-4);
      const value = bone.quaternion.toArray();
      // Keep neighbouring keys in the same hemisphere so interpolation takes the short way.
      if (previous.length && previous.reduce((sum, v, i) => sum + v * value[i], 0) < 0) value.forEach((v, i) => (value[i] = -v));
      track.rotation.push(...value);
      track.translation.push(...bone.position.toArray());
      track.scale.push(...bone.scale.toArray());
    }
  }
  return { name, trot, contactSpeed, speed, duration, times, tracks };
}

// ---------- Measuring a clip (the same checks as the review) ----------

function measure(clip, speed) {
  const mixer = new THREE.AnimationMixer(scene);
  const action = mixer.clipAction(clip).play();
  const samples = 48;
  const legs = rig.legs.map((leg) => ({
    name: leg.name,
    upper: scene.getObjectByName(leg.upper),
    lower: scene.getObjectByName(leg.lower),
    foot: scene.getObjectByName(leg.foot),
    contact: scene.getObjectByName(leg.contact),
    y: [],
    z: [],
    knee: [],
  }));
  const bodyY = [];
  const p = (object) => frame.worldToLocal(object.getWorldPosition(new THREE.Vector3()));
  for (let k = 0; k <= samples; k++) {
    action.time = (k / samples) * clip.duration * 0.99999;
    mixer.update(0);
    frame.updateMatrixWorld(true);
    bodyY.push(p(bodyRoot).y);
    for (const leg of legs) {
      const c = p(leg.contact);
      leg.y.push(c.y);
      leg.z.push(c.z);
      const u = p(leg.upper).sub(p(leg.lower));
      const f = p(leg.foot).sub(p(leg.lower));
      leg.knee.push(THREE.MathUtils.radToDeg(u.angleTo(f)));
    }
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(scene);
  const dt = clip.duration / samples;
  const rows = legs.map((leg) => {
    const low = Math.min(...leg.y);
    const planted = leg.y.map((y) => y < low + 0.004);
    const slide = [];
    for (let k = 0; k < samples; k++) if (planted[k] && planted[k + 1]) slide.push((leg.z[k + 1] - leg.z[k]) / dt);
    const restY = gait.restContactY(leg.name);
    return {
      leg: leg.name.replace('_positive_x', ' R').replace('_negative_x', ' L'),
      planted: `${Math.round((planted.filter(Boolean).length / (samples + 1)) * 100)}%`,
      'paw speed planted (m/s)': slide.length ? `${mean(slide).toFixed(2)} ±${spread(slide).toFixed(2)}` : '-',
      'lowest paw vs rest (cm)': ((low - restY) * 100).toFixed(1),
      'lift (cm)': ((Math.max(...leg.y) - low) * 100).toFixed(1),
      'knee (°)': `${Math.round(Math.min(...leg.knee))}–${Math.round(Math.max(...leg.knee))}`,
    };
  });
  return { rows, bob: (Math.max(...bodyY) - Math.min(...bodyY)) * 100, target: speed };
}
const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;
const spread = (values) => (Math.max(...values) - Math.min(...values)) / 2;

function toClip(baked) {
  const tracks = [];
  for (const [bone, { rotation, translation, scale: scales }] of baked.tracks) {
    tracks.push(new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, baked.times, rotation));
    tracks.push(new THREE.VectorKeyframeTrack(`${bone}.position`, baked.times, translation));
    tracks.push(new THREE.VectorKeyframeTrack(`${bone}.scale`, baked.times, scales));
  }
  return new THREE.AnimationClip(baked.name, baked.duration, tracks);
}

// ---------- Writing the clips back into the GLB ----------

function patch({ json, bin }, bakedClips) {
  json = structuredClone(json);
  const replaced = new Set(); // the authored clips' accessors
  for (const baked of bakedClips)
    for (const sampler of json.animations.find((candidate) => candidate.name === baked.name).samplers)
      replaced.add(sampler.input).add(sampler.output);
  const newData = new Map(); // bufferView index -> bytes, for views added here
  const addAccessor = (values, type, minMax) => {
    const bytes = Buffer.from(new Float32Array(values).buffer);
    const view = json.bufferViews.push({ buffer: 0, byteLength: bytes.length }) - 1;
    newData.set(view, bytes);
    const width = { SCALAR: 1, VEC3: 3, VEC4: 4 }[type];
    const accessor = { bufferView: view, componentType: 5126, count: values.length / width, type };
    if (minMax) Object.assign(accessor, minMax);
    return json.accessors.push(accessor) - 1;
  };
  const nodeIndex = new Map(json.nodes.map((node, i) => [node.name, i]));
  for (const baked of bakedClips) {
    const animation = json.animations.find((candidate) => candidate.name === baked.name);
    const input = addAccessor(baked.times, 'SCALAR', { min: [0], max: [baked.duration] });
    const input2 = addAccessor([0, baked.duration], 'SCALAR', { min: [0], max: [baked.duration] });
    animation.samplers = [];
    animation.channels = [];
    for (const [bone, tracks] of baked.tracks) {
      for (const [gltfPath, values, width] of [
        ['translation', tracks.translation, 3],
        ['rotation', tracks.rotation, 4],
        ['scale', tracks.scale, 3],
      ]) {
        // Constant channels get two STEP keys, as Blender writes them; moving ones every frame.
        const first = values.slice(0, width);
        const still = values.every((v, i) => Math.abs(v - first[i % width]) < 1e-6);
        const output = still
          ? addAccessor([...first, ...first], width === 4 ? 'VEC4' : 'VEC3')
          : addAccessor(values, width === 4 ? 'VEC4' : 'VEC3');
        animation.samplers.push({ input: still ? input2 : input, interpolation: still ? 'STEP' : 'LINEAR', output });
        animation.channels.push({ sampler: animation.samplers.length - 1, target: { node: nodeIndex.get(bone), path: gltfPath } });
      }
    }
    animation.extras = {
      ...animation.extras,
      rebuiltBy: 'scripts/dog-clips.mjs',
      gait: baked.trot ? 'trot' : 'four-beat walk',
      contactSpeed: baked.contactSpeed, // Dog units per second at action rate 1
    };
  }
  return compact(json, bin, newData, replaced);
}

/**
 * Drops the replaced clips' accessors and buffer views (or, with --prune, everything nothing references)
 * and repacks the binary chunk. Everything kept is copied byte for byte.
 */
function compact(json, bin, newData, replaced) {
  const usedAccessors = new Set();
  for (const mesh of json.meshes ?? [])
    for (const primitive of mesh.primitives) {
      Object.values(primitive.attributes).forEach((i) => usedAccessors.add(i));
      if (primitive.indices !== undefined) usedAccessors.add(primitive.indices);
      for (const target of primitive.targets ?? []) Object.values(target).forEach((i) => usedAccessors.add(i));
    }
  for (const skin of json.skins ?? []) if (skin.inverseBindMatrices !== undefined) usedAccessors.add(skin.inverseBindMatrices);
  for (const animation of json.animations ?? [])
    for (const sampler of animation.samplers) usedAccessors.add(sampler.input).add(sampler.output);

  const keepAccessor = (i) => usedAccessors.has(i) || (!prune && !replaced.has(i));
  const accessorMap = new Map();
  const accessors = [];
  json.accessors.forEach((accessor, i) => {
    if (keepAccessor(i)) accessorMap.set(i, accessors.push(accessor) - 1);
  });
  const viewsOf = (accessor) =>
    [accessor.bufferView, accessor.sparse?.indices.bufferView, accessor.sparse?.values.bufferView].filter((v) => v !== undefined);
  const usedViews = new Set();
  for (const accessor of accessors) viewsOf(accessor).forEach((view) => usedViews.add(view));
  for (const image of json.images ?? []) if (image.bufferView !== undefined) usedViews.add(image.bufferView);
  if (!prune) {
    // Keep views that only lost nothing: anything not exclusively serving a replaced accessor stays.
    const servesReplaced = new Set();
    json.accessors.forEach((accessor, i) => replaced.has(i) && !keepAccessor(i) && viewsOf(accessor).forEach((view) => servesReplaced.add(view)));
    json.bufferViews.forEach((_, i) => !servesReplaced.has(i) && usedViews.add(i));
  }

  const viewMap = new Map();
  const views = [];
  const parts = [];
  let offset = 0;
  json.bufferViews.forEach((view, i) => {
    if (!usedViews.has(i)) return;
    const bytes = newData.get(i) ?? bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    const padding = (4 - (offset % 4)) % 4;
    if (padding) parts.push(Buffer.alloc(padding));
    offset += padding;
    parts.push(bytes);
    viewMap.set(i, views.push({ ...view, byteOffset: offset }) - 1);
    offset += bytes.length;
  });

  for (const accessor of accessors) {
    if (accessor.bufferView !== undefined) accessor.bufferView = viewMap.get(accessor.bufferView);
    if (accessor.sparse) {
      accessor.sparse.indices.bufferView = viewMap.get(accessor.sparse.indices.bufferView);
      accessor.sparse.values.bufferView = viewMap.get(accessor.sparse.values.bufferView);
    }
  }
  for (const image of json.images ?? []) if (image.bufferView !== undefined) image.bufferView = viewMap.get(image.bufferView);
  for (const mesh of json.meshes ?? [])
    for (const primitive of mesh.primitives) {
      for (const key of Object.keys(primitive.attributes)) primitive.attributes[key] = accessorMap.get(primitive.attributes[key]);
      if (primitive.indices !== undefined) primitive.indices = accessorMap.get(primitive.indices);
      for (const target of primitive.targets ?? []) for (const key of Object.keys(target)) target[key] = accessorMap.get(target[key]);
    }
  for (const skin of json.skins ?? []) if (skin.inverseBindMatrices !== undefined) skin.inverseBindMatrices = accessorMap.get(skin.inverseBindMatrices);
  for (const animation of json.animations ?? [])
    for (const sampler of animation.samplers) {
      sampler.input = accessorMap.get(sampler.input);
      sampler.output = accessorMap.get(sampler.output);
    }

  const packed = Buffer.concat(parts);
  json.accessors = accessors;
  json.bufferViews = views;
  json.buffers = [{ ...json.buffers[0], byteLength: packed.length }];
  return { json, bin: packed };
}

// ---------- Run ----------

console.log(`Source: ${source.from}`);
const baked = CLIPS.map(bake);
for (const clip of baked) {
  const before = measure(clipNamed(clip.name), clip.speed);
  const after = measure(toClip(clip), clip.speed);
  console.log(
    `\n${clip.name}: ${clip.trot ? 'trot' : 'four-beat walk'} at ${clip.contactSpeed} Dog units/s (${clip.speed.toFixed(2)} m/s for an ${LENGTH} m dog) at rate 1`,
  );
  console.log(`  before: ${clipNamed(clip.name).duration.toFixed(3)} s loop, body bob ${before.bob.toFixed(1)} cm`);
  console.table(before.rows);
  console.log(`  after: ${clip.duration.toFixed(3)} s loop, body bob ${after.bob.toFixed(1)} cm`);
  console.table(after.rows);
}

if (dryRun) {
  console.log('\nDry run: nothing written.');
} else {
  const output = patch(source.glb, baked);
  // Everything but the two clips must come through byte for byte.
  const check = readGlb(writeGlb(output.json, output.bin));
  const bytesOf = ({ json, bin }, accessor) => {
    const view = json.bufferViews[json.accessors[accessor].bufferView];
    return bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
  };
  const oldPrimitive = source.glb.json.meshes[0].primitives[0];
  const newPrimitive = check.json.meshes[0].primitives[0];
  for (const key of Object.keys(oldPrimitive.attributes))
    if (!bytesOf(source.glb, oldPrimitive.attributes[key]).equals(bytesOf(check, newPrimitive.attributes[key])))
      throw new Error(`Mesh attribute ${key} changed`);
  if (!bytesOf(source.glb, source.glb.json.skins[0].inverseBindMatrices).equals(bytesOf(check, check.json.skins[0].inverseBindMatrices)))
    throw new Error('Skin changed');
  const imageBytes = ({ json, bin }) => {
    const view = json.bufferViews[json.images[0].bufferView];
    return bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
  };
  if (source.glb.json.images?.length && !imageBytes(source.glb).equals(imageBytes(check))) throw new Error('Texture changed');
  fs.writeFileSync(MODEL, writeGlb(output.json, output.bin));
  console.log(`\nWrote ${path.relative(root, MODEL)} (${(fs.statSync(MODEL).size / 1e6).toFixed(2)} MB): walk and run rebuilt, everything else unchanged.`);
}
