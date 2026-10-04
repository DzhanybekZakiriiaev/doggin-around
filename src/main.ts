import RAPIER from '@dimforge/rapier3d-compat';
import { SparkRenderer } from '@sparkjsdev/spark';
import * as THREE from 'three';
import { Footsteps, LoopingSound, OneShot } from './audio';
import { Biscuit } from './biscuit';
import { Doorway } from './door';
import { FirstPersonHands, HAND_ACTIONS, type HandAction } from './hands';
import { Interactions } from './interaction';
import { MoodLights } from './lighting';
import { LEVEL_RUNS, PLACEMENTS, type Footing, type Surface } from './levels';
import { FirstPersonPlayer } from './player';
import { Prop } from './props';
import { AdaptiveQuality } from './quality';
import { ComicTransition } from './transition';
import { MarbleWorld } from './world';
import { worldRuns } from './worlds-index';

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const canvas = $<HTMLCanvasElement>('#scene');
const worldSelect = $<HTMLSelectElement>('#world-select');
const resSelect = $<HTMLSelectElement>('#res-select');
const colliderToggle = $<HTMLInputElement>('#collider-toggle');
const flyToggle = $<HTMLInputElement>('#fly-toggle');
const handsToggle = $<HTMLInputElement>('#hands-toggle');
const splatHandsToggle = $<HTMLInputElement>('#splat-hands-toggle');
const dragToggle = $<HTMLInputElement>('#drag-toggle');
const lookSpeedInput = $<HTMLInputElement>('#look-speed');
const handActionSelect = $<HTMLSelectElement>('#hand-action');
const statusEl = $('#status');
const hintEl = $('#hint');
const fpsEl = $('#fps');
const startEl = $('#start');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b2028);
// covSplats/accumExtSplats: what Biscuit's skinned splats need (full covariance, extended precision).
const spark = new SparkRenderer({ renderer, covSplats: true, accumExtSplats: true });
scene.add(spark);
const worldLights = new MoodLights(); // for the toon meshes placed in the world; splats ignore it
scene.add(worldLights);
const quality = new AdaptiveQuality(renderer, spark);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 1000);

await RAPIER.init();
const physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
const player = new FirstPersonPlayer(camera, physics, canvas);
const hands = new FirstPersonHands(renderer);
hands.setAspect(camera.aspect);
const interactions = new Interactions($('#prompt'));
const transition = new ComicTransition($('#transition'));
// Ambience for the whole session. It starts for real on the player's first click: browsers block
// audio until then.
const rain = new LoopingSound('/audio/rain.mp3', 0.4);
rain.start();
rain.ready.catch((error) => console.error('No rain:', error)); // the game is still playable in silence
// Footfalls, on whichever surface the player is standing on. The cadence comes from how far they
// walk, not from the recordings, so wet ground and floorboards step at exactly the same rate.
const footsteps = new Footsteps(
  { wet: '/audio/wet-footsteps.mp3', wood: '/audio/wood-footsteps.mp3' },
  'wet',
  0.7,
);
const doorCreak = new OneShot('/audio/door-creak.mp3', 0.85);
doorCreak.ready.catch((error) => console.error('No door creak:', error));
footsteps.ready
  .then(() => {
    // How the recordings got cut up: if a surface reports 1, its footfalls weren't found and the
    // whole clip is being used as one step.
    if (import.meta.env.DEV) {
      const sliced = Object.entries(footsteps.sets).map(([surface, set]) => `${surface} ${set.count}`);
      console.log(`Footsteps per surface: ${sliced.join(', ')}`);
    }
  })
  .catch((error) => console.error('No footsteps:', error));
const biscuit = new Biscuit(renderer, physics);
scene.add(biscuit.group);
biscuit.ready.catch((error) => {
  console.error(error);
  statusEl.textContent = `Biscuit didn't load: ${(error as Error).message}`;
});

// ---------- Settings (remembered per browser) ----------

const settings = (() => {
  const defaults = { lookSpeed: 1, dragLook: quality.softwareRenderer, hands: true, splatHands: true };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem('panel-walk:settings') ?? '{}') };
  } catch {
    return defaults;
  }
})();
const saveSettings = () => {
  try {
    localStorage.setItem('panel-walk:settings', JSON.stringify(settings));
  } catch {
    // Storage unavailable (private window); settings just won't persist.
  }
};
lookSpeedInput.value = String(settings.lookSpeed);
dragToggle.checked = settings.dragLook;
handsToggle.checked = settings.hands;
splatHandsToggle.checked = settings.splatHands;
player.lookSpeed = settings.lookSpeed;
hands.visible = settings.hands;
hands.splats = settings.splatHands;

// ---------- Worlds (kept loaded once visited, so going back through a door is instant) ----------

const params = new URLSearchParams(location.search);
for (const run of worldRuns) worldSelect.add(new Option(run.label, run.id));
worldSelect.value = params.get('world') ?? LEVEL_RUNS.yard;
if (!worldSelect.value) worldSelect.value = worldRuns[0]?.id ?? '';
resSelect.value = params.get('res') ?? '500k';

const loaded = new Map<string, Promise<MarbleWorld>>();
const doorways = new WeakMap<MarbleWorld, Doorway[]>();
/** Which world each prop is in; carrying one through a door and dropping it moves it. */
const propHome = new Map<Prop, MarbleWorld>();
let carried: Prop | undefined;
let world: MarbleWorld | undefined;
let footing: Footing = { ground: 'wet' };

/** Planks if the player is up on the porch or its steps, otherwise whatever this world's ground is. */
function underfoot(feetY: number): Surface {
  return footing.boardsAbove !== undefined && feetY >= footing.boardsAbove ? 'wood' : footing.ground;
}

function loadWorld(runId: string): Promise<MarbleWorld> {
  const key = `${runId}@${resSelect.value}`;
  let promise = loaded.get(key);
  if (!promise) {
    const run = worldRuns.find((candidate) => candidate.id === runId);
    if (!run) return Promise.reject(new Error(`World ${runId} is not downloaded`));
    const resolution = run.resolutions.includes(resSelect.value) ? resSelect.value : run.resolutions[0];
    promise = MarbleWorld.load(run, resolution, physics, (message) => {
      if (worldSelect.value === runId) statusEl.textContent = message;
    }).then((created) => {
      created.deactivate();
      const doors = (PLACEMENTS[runId]?.doors ?? []).map((placement) => new Doorway(placement));
      for (const door of doors) {
        created.root.add(door.object);
        const shut = door.collider();
        if (shut) created.addCollider(physics, shut);
      }
      doorways.set(created, doors);
      for (const placement of PLACEMENTS[runId]?.props ?? []) {
        const prop = new Prop(placement.kind, physics, new THREE.Vector3(...placement.at));
        prop.setActive(false); // its world's floor isn't there until the world is entered
        created.root.add(prop.object);
        propHome.set(prop, created);
      }
      return created;
    });
    promise.catch(() => loaded.delete(key));
    loaded.set(key, promise);
  }
  return promise;
}

/** Shows a world; with `arrivingThrough`, puts the player at that doorway instead of the panorama spot. */
async function enterWorld(runId: string, arrivingThrough?: string) {
  worldSelect.value = runId;
  params.set('world', runId);
  params.set('res', resSelect.value);
  history.replaceState(null, '', `?${params}`);

  const next = await loadWorld(runId);
  if (worldSelect.value !== runId) return; // another world was picked while this one loaded
  world?.deactivate();
  world = next;
  world.activate(scene);
  world.colliderView.visible = colliderToggle.checked;
  physics.step(); // register the collider before the player moves against it

  biscuit.letGo(); // a stick in his mouth stays in the world it came from
  for (const [prop, home] of propHome) prop.setActive(home === world);

  const doors = doorways.get(world) ?? [];
  const arrival = doors.find((door) => door.placement.id === arrivingThrough)?.arrival();
  player.placeAt(arrival?.feet ?? new THREE.Vector3(), arrival?.yaw ?? 0);
  biscuit.placeBeside(player.feet, arrival?.yaw ?? 0); // he comes through the door with you
  const mood = runId.startsWith('cabin') ? 'indoor' : 'dusk';
  hands.setMood(mood);
  worldLights.setMood(mood);
  biscuit.setMood(mood);
  footing = PLACEMENTS[runId]?.footing ?? { ground: mood === 'indoor' ? 'wood' : 'wet' };
  // Straight cut, no fade: this lands under the tail of the door creak, which covers the change.
  rain.muffle(mood === 'indoor' ? 1 : 0, 0);
  refreshInteractions();
  quality.reset();
  statusEl.textContent = worldRuns.find((run) => run.id === runId)?.label ?? runId;

  // Warm up the worlds this one's doors lead to.
  for (const door of doors) void loadWorld(LEVEL_RUNS[door.placement.to]).catch(() => {});
}

/** What the player can use in the current world: its doors and the props lying in it. */
function refreshInteractions() {
  if (!world) return;
  const here = world;
  interactions.set([
    ...(doorways.get(here) ?? []).map((door) => ({
      target: door.center,
      range: 2.6,
      prompt: door.placement.prompt,
      act: () => goThrough(door),
    })),
    {
      target: biscuit.back,
      range: 2.6,
      prompt: 'Pet Biscuit',
      enabled: () => !carried && !hands.busy && !biscuit.busy,
      act: pet,
    },
    ...[...propHome].filter(([, home]) => home === here).map(([prop]) => ({
      target: prop.position,
      range: 2.4,
      prompt: `Pick up the ${prop.label}`,
      enabled: () => !carried && !prop.isCarried,
      act: () => pickUp(prop),
    })),
  ]);
}

// ---------- Carrying ----------

async function pickUp(prop: Prop) {
  if (carried || hands.busy) return;
  const reach = hands.aimAt(prop.position, camera);
  await hands.play(
    'pickUp',
    {
      grab: () => {
        carried = prop;
        hands.hold(prop.pickUp());
        showHint();
      },
    },
    reach,
  );
}

async function throwCarried() {
  const prop = carried;
  if (!prop || hands.busy || !player.inputEnabled) return;
  await hands.play('throw', {
    release: () => {
      const from = hands.palmInWorld(camera);
      hands.release();
      const velocity = camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(8).add(new THREE.Vector3(0, 2.5, 0));
      const spin = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(14);
      putInWorld(prop, from, velocity, spin);
      biscuit.fetch(prop);
    },
  });
}

async function putDownCarried() {
  const prop = carried;
  if (!prop || hands.busy || !player.inputEnabled) return;
  await hands.play('drop', {
    release: () => {
      hands.release();
      // Just in front of the feet; it drops the last bit and settles.
      const ahead = camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
      putInWorld(prop, player.feet.addScaledVector(ahead, 0.6).setY(player.feet.y + 0.3));
    },
  });
}

function putInWorld(prop: Prop, at: THREE.Vector3, velocity?: THREE.Vector3, spin?: THREE.Vector3) {
  carried = undefined;
  if (world) {
    propHome.set(prop, world); // carried through a door? It lives here now
    world.root.add(prop.object);
  }
  prop.putDown(at, velocity, spin);
  refreshInteractions();
  showHint();
}

// ---------- Biscuit ----------

const wait = (seconds: number) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

/** He trots up and stands side-on in front of you (head to your left), you crouch, and the hand strokes his neck. */
async function pet() {
  if (carried || hands.busy || !player.inputEnabled) return;
  player.inputEnabled = false;
  try {
    const forward = new THREE.Vector3(-Math.sin(player.heading), 0, -Math.cos(player.heading));
    biscuit.comeForPets(player.feet.addScaledVector(forward, 0.62), player.heading + Math.PI / 2);
    player.crouching = true;
    player.focus = biscuit.petPoint;
    // His neck low in the view: the right arm reaches in from the bottom right, over his shoulders, with
    // his face clear to the left.
    player.focusTilt = 0.3;
    player.focusTurn = 0.08;
    for (let waited = 0; !biscuit.readyForPets && waited < 3; waited += 0.1) await wait(0.1);
    await wait(0.35); // let the view settle on him
    hands.startPetting(1.1, hands.aimAt(biscuit.petPoint, camera));
    await wait(3.2);
  } finally {
    hands.stopPetting();
    biscuit.petEnd();
    player.crouching = false;
    player.focus = undefined;
    player.focusTilt = player.focusTurn = 0;
    player.inputEnabled = true;
  }
}

async function callBiscuit() {
  if (hands.busy || !player.inputEnabled) return;
  biscuit.come();
  biscuit.barkTwice();
  await hands.play('beckon');
}

function showHint() {
  hintEl.textContent = carried ? `Carrying the ${carried.label} · T throw · G put down` : '';
}

async function goThrough(door: Doorway) {
  const targetRun = LEVEL_RUNS[door.placement.to];
  player.inputEnabled = false;
  try {
    const leaf = door.placement.door;
    if (leaf) {
      // Grab the knob and turn it, then shove (push) or haul (pull): the door swings on the hand's cue.
      const knob = door.knob && hands.aimAt(door.knob, camera);
      const action = leaf.opens === 'push' ? 'openDoor' : 'pullDoor';
      await new Promise<void>((swing) => void hands.play(action, { swing }, knob));
      void door.open();
      doorCreak.play(); // the hinges, over whatever the rain is currently doing
      await new Promise((resolve) => setTimeout(resolve, leaf.opens === 'push' ? 300 : 450));
    }
    await transition.cover(door.placement.sfx);
    await enterWorld(targetRun, door.placement.id);
    door.close();
    await transition.reveal();
  } catch (error) {
    console.error(error);
    statusEl.textContent = `Couldn't go through: ${(error as Error).message}`;
    await transition.reveal();
  } finally {
    player.inputEnabled = true;
  }
}

const showError = (error: unknown) => {
  console.error(error);
  statusEl.textContent = `Failed to load: ${(error as Error).message}`;
};
worldSelect.addEventListener('change', () => enterWorld(worldSelect.value).catch(showError));
resSelect.addEventListener('change', async () => {
  // A different splat resolution means different worlds: drop the loaded ones.
  const previous = [...loaded.values()];
  loaded.clear();
  world = undefined;
  for (const pending of previous) pending.then((old) => old.dispose(physics)).catch(() => {});
  for (const prop of propHome.keys()) prop.dispose(physics);
  propHome.clear();
  carried = undefined;
  biscuit.letGo();
  hands.release();
  showHint();
  await enterWorld(worldSelect.value).catch(showError);
});
colliderToggle.addEventListener('change', () => {
  if (world) world.colliderView.visible = colliderToggle.checked;
});
flyToggle.addEventListener('change', () => {
  player.fly = flyToggle.checked;
  interactions.enabled = !player.fly;
});
handsToggle.addEventListener('change', () => {
  settings.hands = hands.visible = handsToggle.checked;
  saveSettings();
});
splatHandsToggle.addEventListener('change', () => {
  settings.splatHands = hands.splats = splatHandsToggle.checked;
  saveSettings();
});
dragToggle.addEventListener('change', () => {
  settings.dragLook = dragToggle.checked;
  if (settings.dragLook) document.exitPointerLock();
  saveSettings();
});
lookSpeedInput.addEventListener('input', () => {
  settings.lookSpeed = player.lookSpeed = Number(lookSpeedInput.value);
  saveSettings();
});

// Preview any hand animation from the HUD (the quest will trigger them for real).
const PETTING_PREVIEWS: Record<string, { label: string; strokesPerSecond: number; seconds: number }> = {
  'pet-gentle': { label: 'Pet (slow, calming)', strokesPerSecond: 0.7, seconds: 4 },
  'pet-frantic': { label: 'Pet (fast, frantic)', strokesPerSecond: 2.6, seconds: 3 },
};
for (const [value, { label }] of Object.entries(PETTING_PREVIEWS)) handActionSelect.add(new Option(label, value));
for (const { name, label } of HAND_ACTIONS) handActionSelect.add(new Option(label, name));
let pettingPreview = 0;
handActionSelect.addEventListener('change', () => {
  const choice = handActionSelect.value;
  handActionSelect.value = '';
  const petting = PETTING_PREVIEWS[choice];
  if (petting) {
    const preview = ++pettingPreview;
    hands.startPetting(petting.strokesPerSecond);
    setTimeout(() => preview === pettingPreview && hands.stopPetting(), petting.seconds * 1000);
  } else if (choice) {
    void hands.play(choice as HandAction);
  }
});

if (import.meta.env.DEV) {
  Object.assign(window, {
    game: {
      renderer, scene, spark, quality, camera, player, hands, biscuit, physics, interactions, doorways, propHome,
      rain, footsteps, doorCreak,
      getWorld: () => world, getCarried: () => carried, throwCarried, putDownCarried,
    },
  });
}

// ---------- Input ----------

// Pointer lock gives the best mouse look, but over Remote Desktop / in VMs and some embedded browsers it
// misbehaves or is refused; drag-to-look (the default without a GPU) avoids it entirely.
const lockPointer = () => {
  if (settings.dragLook || document.pointerLockElement === canvas) return;
  canvas.requestPointerLock({ unadjustedMovement: true }).catch(() => canvas.requestPointerLock().catch(() => {}));
};
startEl.addEventListener('click', () => {
  startEl.classList.add('hidden');
  lockPointer();
});
canvas.addEventListener('click', lockPointer);

// Hand the keyboard back to the game after using the HUD: a focused checkbox would toggle on Space
// (jump) and a focused dropdown would jump to options when letters are typed.
for (const control of document.querySelectorAll<HTMLElement>('#hud input, #hud select')) {
  control.addEventListener('change', () => control.blur());
}
canvas.addEventListener('pointerdown', () => {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
});
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement !== canvas && !settings.dragLook) startEl.classList.remove('hidden');
});
window.addEventListener('keydown', (event) => {
  if (event.repeat || event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement) return;
  const toggle = { KeyC: colliderToggle, KeyF: flyToggle, KeyH: handsToggle }[event.code];
  if (toggle) {
    toggle.checked = !toggle.checked;
    toggle.dispatchEvent(new Event('change'));
  } else if (event.code === 'KeyR' && player.inputEnabled) {
    player.respawn();
  } else if (event.code === 'KeyT') {
    void throwCarried();
  } else if (event.code === 'KeyG') {
    void putDownCarried();
  } else if (event.code === 'KeyV') {
    void callBiscuit();
  }
});
// With the pointer locked, a left click throws too (in drag-to-look mode the button is for looking).
canvas.addEventListener('mousedown', (event) => {
  if (event.button === 0 && document.pointerLockElement === canvas) void throwCarried();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  hands.setAspect(camera.aspect);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
});

// ---------- Loop ----------

const timer = new THREE.Timer();
const softwareNote = quality.softwareRenderer ? ' · no GPU (software rendering)' : '';

renderer.setAnimationLoop((time) => {
  timer.update(time);
  const frameSeconds = timer.getDelta();
  const dt = Math.min(frameSeconds, 1 / 20);
  if (world) {
    player.update(dt);
    footsteps.surface = underfoot(player.feet.y); // the porch is planked even though it's outdoors
    footsteps.update(dt, player.motion);
    physics.timestep = dt;
    physics.step();
    for (const [prop, home] of propHome) if (home === world) prop.sync();
    biscuit.update(dt, player.feet);
    interactions.update(camera);
  }
  hands.visible = settings.hands && !player.fly;
  hands.update(dt, player.motion);

  renderer.render(scene, camera);
  // Hands go on top: clear depth so they never sink into walls.
  renderer.autoClear = false;
  renderer.clearDepth();
  renderer.render(hands.scene, hands.camera);
  renderer.autoClear = true;

  const fps = world ? quality.update(frameSeconds) : undefined;
  if (fps !== undefined) fpsEl.textContent = `${Math.round(fps)} fps · ${quality.label}${softwareNote}`;
});

enterWorld(worldSelect.value).catch(showError);
