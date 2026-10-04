import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { outlineMaterial } from '../game/toon';

// Dev tool (tools/pipeline-frames.html in `npm run dev`): renders the real dog into the sprite strips the
// pipeline screen plays between the upload page and the comic. Each strip is its frames side by side:
// - rig: the model in X-ray with its 41-joint rig lit up inside, turning round (no animation);
// - mesh: the textured mesh, inked like the comic, turning round, its wireframe fading over it;
// - run: the mesh running (the GLB's own run clip), the rig still showing through.

const MODEL = '/models/dog-animated.glb';
const SIZE = 360;
const INK = 0x120c10;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(SIZE, SIZE);
renderer.setClearColor(0x000000, 0);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(26, 1, 0.01, 50);
scene.add(new THREE.HemisphereLight(0xffffff, 0x6b5a4a, 1.7));
const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.position.set(1.5, 2.5, 2);
scene.add(sun);

const gltf = await new GLTFLoader().loadAsync(MODEL);
const dog = gltf.scene;
const skinned = (() => {
  let found: THREE.SkinnedMesh | undefined;
  dog.traverse((object) => {
    if (!found && object instanceof THREE.SkinnedMesh) found = object;
  });
  if (!found) throw new Error('The dog model has no skinned mesh');
  return found;
})();
skinned.frustumCulled = false;
const textured = skinned.material as THREE.MeshStandardMaterial;

// Feet on the ground, centred, one unit tall.
const turntable = new THREE.Group();
turntable.add(dog);
scene.add(turntable);
const bounds = new THREE.Box3().setFromObject(dog);
const scale = 1 / (bounds.max.y - bounds.min.y);
dog.scale.setScalar(scale);
dog.position.set(-(bounds.min.x + bounds.max.x) / 2, -bounds.min.y, -(bounds.min.z + bounds.max.z) / 2).multiplyScalar(scale);

// Looks: comic-inked (toon + outline), X-ray, and a wireframe that can lie over either.
const toon = new THREE.MeshToonMaterial({ map: textured.map, color: 0xffffff });
const xray = new THREE.MeshBasicMaterial({ color: 0x8fb4f0, transparent: true, opacity: 0.16, depthWrite: false });
const wireMaterial = new THREE.MeshBasicMaterial({ color: 0x2f62d0, wireframe: true, transparent: true, opacity: 0.3, depthWrite: false });
const twin = (material: THREE.Material) => {
  const mesh = new THREE.SkinnedMesh(skinned.geometry, material);
  mesh.bind(skinned.skeleton, skinned.bindMatrix);
  mesh.frustumCulled = false;
  skinned.parent!.add(mesh);
  return mesh;
};
const outline = twin(outlineMaterial(0.011 / scale, INK));
const wire = twin(wireMaterial);

// The rig: a bar per bone and a dot per joint, drawn over everything.
const rig = new THREE.Group();
scene.add(rig);
const bones = skinned.skeleton.bones;
const boneMaterial = new THREE.MeshBasicMaterial({ color: 0xffd322, depthTest: false, transparent: true });
const jointMaterial = new THREE.MeshBasicMaterial({ color: 0xf04431, depthTest: false, transparent: true });
const links = bones
  .filter((bone) => bone.parent instanceof THREE.Bone)
  .map((bone) => ({ bone, parent: bone.parent as THREE.Bone, bar: new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.009, 1, 6), boneMaterial) }));
const joints = bones.map((bone) => ({ bone, dot: new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), jointMaterial) }));
for (const { bar } of links) rig.add(bar);
for (const { dot } of joints) rig.add(dot);
for (const object of [...links.map((link) => link.bar), ...joints.map((joint) => joint.dot)]) object.renderOrder = 10;

const from = new THREE.Vector3();
const to = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
function placeRig(opacity: number) {
  scene.updateMatrixWorld(true);
  boneMaterial.opacity = jointMaterial.opacity = opacity;
  for (const { bone, parent, bar } of links) {
    parent.getWorldPosition(from);
    bone.getWorldPosition(to);
    const length = from.distanceTo(to);
    bar.visible = length > 0.005 && length < 0.5; // no bar from the root out to the hips
    bar.position.lerpVectors(from, to, 0.5);
    bar.scale.set(1, length, 1);
    bar.quaternion.setFromUnitVectors(UP, to.clone().sub(from).normalize());
  }
  for (const { bone, dot } of joints) bone.getWorldPosition(dot.position);
}

function look(name: 'rig' | 'mesh' | 'run') {
  skinned.material = name === 'rig' ? xray : toon;
  outline.visible = name !== 'rig';
  wire.visible = name !== 'run';
  wireMaterial.opacity = name === 'rig' ? 0.07 : 0.05; // the mesh is dense: any more and it's a solid blue
  rig.visible = name !== 'mesh';
}

const mixer = new THREE.AnimationMixer(dog);
const runClip = gltf.animations.find((clip) => clip.name === 'run');

interface Strip {
  name: string;
  frames: number;
  /** Poses the scene for frame `i` of `count`. */
  pose(i: number, count: number): void;
}

const aim = (y: number, distance: number) => {
  camera.position.set(0, y, distance);
  camera.lookAt(0, 0.42, 0);
};

const STRIPS: Strip[] = [
  {
    name: 'rig',
    frames: 24,
    pose: (i, count) => {
      look('rig');
      mixer.stopAllAction();
      skinned.skeleton.pose();
      turntable.rotation.y = (i / count) * Math.PI * 2;
      aim(0.75, 3.1);
      placeRig(1);
    },
  },
  {
    name: 'mesh',
    frames: 24,
    pose: (i, count) => {
      look('mesh');
      mixer.stopAllAction();
      skinned.skeleton.pose();
      turntable.rotation.y = (i / count) * Math.PI * 2 + 0.6;
      aim(0.75, 3.1);
    },
  },
  {
    name: 'run',
    frames: 16,
    pose: (i, count) => {
      look('run');
      if (!runClip) throw new Error('The dog model has no run clip');
      const action = mixer.clipAction(runClip);
      action.play();
      mixer.setTime((i / count) * runClip.duration);
      dog.updateMatrixWorld(true);
      turntable.rotation.y = -Math.PI / 2 + 0.35; // side on, a little towards the camera
      aim(0.6, 3.2);
      placeRig(0.55);
    },
  },
];

/** Renders a strip and returns it as a PNG data URL. */
function render(strip: Strip): string {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE * strip.frames;
  canvas.height = SIZE;
  const context = canvas.getContext('2d')!;
  for (let i = 0; i < strip.frames; i++) {
    strip.pose(i, strip.frames);
    renderer.render(scene, camera);
    context.drawImage(renderer.domElement, i * SIZE, 0);
  }
  return canvas.toDataURL('image/png');
}

/** Every strip by name (the harness and the buttons both use it). */
async function renderStrips() {
  return Object.fromEntries(STRIPS.map((strip) => [strip.name, render(strip)]));
}
Object.assign(window, { renderStrips });

const buttons = document.querySelector('#buttons')!;
const previews = document.querySelector('#previews')!;
for (const strip of STRIPS) {
  const button = buttons.appendChild(document.createElement('button'));
  button.textContent = `Render ${strip.name} (${strip.frames} frames)`;
  button.addEventListener('click', () => {
    const url = render(strip);
    const image = previews.appendChild(document.createElement('img'));
    image.src = url;
    image.style.cssText = 'display:block;max-width:100%;margin-bottom:8px';
    const link = previews.appendChild(document.createElement('a'));
    link.href = url;
    link.download = `${strip.name}.png`;
    link.textContent = `Download ${strip.name}.png`;
  });
}
