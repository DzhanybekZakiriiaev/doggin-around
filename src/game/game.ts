import RAPIER from '@dimforge/rapier3d-compat';
import { SparkRenderer } from '@sparkjsdev/spark';
import * as THREE from 'three';
import { Footsteps, OneShot } from './audio';
import { Biscuit } from './biscuit';
import { Doorway } from './door';
import { Fire } from './fire';
import { FirstPersonHands } from './hands';
import { Interactions } from './interaction';
import { MoodLights } from './lighting';
import { type Footing, LEVEL_RUNS, PLACEMENTS, type Surface } from './levels';
import { FirstPersonPlayer } from './player';
import { gripFor, Prop, type PropKind, propModel } from './props';
import { AdaptiveQuality, splatRadiusCap } from './quality';
import { Rain } from './rain';
import { ComicTransition } from './transition';
import { MarbleWorld } from './world';
import { worldRuns } from './worlds-index';
import './game.css';

// The walkable comic: one renderer, scene and physics world shared by the menu and the game.
// - "showcase": Biscuit alone on a transparent background, drawn over a page element (the menu's
//   companion box). Meanwhile the worlds load and are warmed up off screen, so entering is instant.
// - "play": first person in the Marble worlds, with the Storm Night quest (when on): the cabin door is
//   locked, Biscuit digs up the spare key, the key opens the door; the cabin is freezing, so three
//   branches from the yard go on the cold grate, and lighting the fire completes it.
// The dev viewer (viewer.html) drives the same Game with its HUD and the quest off.

export interface GameUi {
  prompt: HTMLElement;
  hint: HTMLElement;
  transition: HTMLElement;
  /** "Click to play" (pointer lock); clicking it hides it. */
  start?: HTMLElement;
  objective?: HTMLElement;
}

export interface GameOptions {
  /** Where the canvas and the overlays go; by default a fixed layer on the body. */
  host?: HTMLElement;
  /** Existing overlay elements (the viewer's); otherwise the game makes its own. */
  ui?: GameUi;
  /** The Storm Night quest (locked door, dig, key). */
  quest?: boolean;
  /** Start invisible (loading and warming up behind a menu) until `showcase` or `play`. */
  hidden?: boolean;
  /** Splat resolution of the worlds ("500k", "100k", "full_res"); full_res by default. */
  resolution?: string;
  onStatus?: (message: string) => void;
}

export type QuestStage = 'arrive' | 'locked' | 'digging' | 'key' | 'unlocked' | 'cold' | 'fire' | 'complete';

const FIREWOOD = 2;
const QUICK_RESOLUTION = '500k';

const OBJECTIVES: Record<QuestStage, (gathered: number) => string> = {
  arrive: () => 'Get inside before the storm hits',
  locked: () => 'Locked out. Biscuit was digging by the porch earlier…',
  digging: () => 'Biscuit is digging…',
  key: () => 'The spare key! Take it to the door',
  unlocked: () => 'Get inside',
  cold: (gathered) =>
    gathered >= FIREWOOD ? 'Put the branches in the fireplace' : `Freezing in here. Fetch branches from the yard for the fire (${gathered}/${FIREWOOD})`,
  fire: () => 'The fire’s catching…',
  complete: () => 'Home, dry and warm',
};
/** Until the key turns, the front door is locked. */
const LOCKED_STAGES: QuestStage[] = ['arrive', 'locked', 'digging', 'key'];
/** The cabin before the fire (cold and blue) and with it roaring (warm). */
const COLD_TINT = new THREE.Color(0.78, 0.84, 0.98);
const WARM_TINT = new THREE.Color(1.1, 1.0, 0.88);

interface Settings {
  lookSpeed: number;
  dragLook: boolean;
  hands: boolean;
  splatHands: boolean;
  rain: boolean;
}

const wait = (seconds: number) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

// The jump clip, measured: crouch, take-off at ~0.57 s, airborne until ~1.95 s (at rate 1). Played faster: it floats.
const LEAP_RATE = 1.6;
const LEAP_TAKEOFF = 0.57;
const LEAP_LANDING = 1.95;

const lerpAngle = (from: number, to: number, t: number) => from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * t;

export class Game {
  readonly layer: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly spark: SparkRenderer;
  readonly quality: AdaptiveQuality;
  readonly rain: Rain;
  readonly camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 1000);
  readonly physics: RAPIER.World;
  readonly player: FirstPersonPlayer;
  readonly hands: FirstPersonHands;
  readonly interactions: Interactions;
  readonly transition: ComicTransition;
  readonly biscuit: Biscuit;
  readonly worldLights = new MoodLights();
  readonly ui: GameUi;
  readonly settings: Settings;

  mode: 'hidden' | 'showcase' | 'play' = 'play';
  resolution: string;
  world?: MarbleWorld;
  /** Called once the quest is done (inside the cabin with Biscuit). */
  onQuestComplete?: () => void;
  /** Called every second while playing, with the measured frame rate. */
  onFps?: (fps: number) => void;
  /** Called whenever the objective changes. */
  onObjective?: (text: string) => void;
  /** Extra keys for the host page (the viewer's toggles). */
  onKey?: (event: KeyboardEvent) => void;

  questStage: QuestStage = 'arrive';
  private readonly questOn: boolean;
  private readonly loaded = new Map<string, Promise<MarbleWorld>>();
  private readonly doorways = new WeakMap<MarbleWorld, Doorway[]>();
  private readonly runOf = new WeakMap<MarbleWorld, string>();
  /** Which world each prop is in; carrying one through a door and dropping it moves it. */
  private readonly propHome = new Map<Prop, MarbleWorld>();
  /** What the right hand holds: one prop, or an armful of branches (the last one picked up on top). */
  private carried: Prop[] = [];
  private readonly inHand = new Map<Prop, THREE.Object3D>();
  private fire?: Fire;
  private fireWorld?: MarbleWorld;
  private readonly tint = new THREE.Color();
  // Footfalls on whatever's underfoot, and the front door's hinges (world-sfx). Footsteps keep their
  // cadence from the distance walked, so wet ground and floorboards step at the same rate.
  private readonly footsteps = new Footsteps({ wet: '/audio/wet-footsteps.mp3', wood: '/audio/wood-footsteps.mp3' }, 'wet', 0.7);
  private readonly doorCreak = new OneShot('/audio/door-creak.mp3', 0.85);
  private footing: Footing = { ground: 'wet' };
  private showcaseEl?: HTMLElement;
  private readonly showcaseCamera = new THREE.PerspectiveCamera(28, 1, 0.05, 50);
  private showcaseSize = new THREE.Vector2();
  private warmups: MarbleWorld[] = [];
  private warmTarget?: THREE.WebGLRenderTarget;
  private dirt?: Dirt;
  private readonly timer = new THREE.Timer();
  private readonly onStatus: (message: string) => void;

  static async create(options: GameOptions = {}) {
    await RAPIER.init();
    return new Game(options);
  }

  private constructor(options: GameOptions) {
    this.questOn = options.quest ?? false;
    this.onStatus = options.onStatus ?? (() => {});
    this.resolution = options.resolution ?? 'full_res'; // loaded at 500k first, the full splats swapped in later

    this.layer = options.host ?? document.body.appendChild(document.createElement('div'));
    this.layer.classList.add('game-layer', 'game-layer--play');
    this.canvas = this.layer.appendChild(document.createElement('canvas'));
    this.canvas.className = 'game-canvas';
    this.ui = options.ui ?? this.makeUi();

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, alpha: true });
    this.scene.background = new THREE.Color(0x1b2028);
    // covSplats/accumExtSplats: what Biscuit's skinned splats need (full covariance, extended precision).
    this.spark = new SparkRenderer({ renderer: this.renderer, covSplats: true, accumExtSplats: true });
    this.scene.add(this.spark, this.worldLights); // the lights are for the toon meshes; splats ignore them
    this.quality = new AdaptiveQuality(this.renderer, this.spark);
    this.rain = new Rain(this.renderer, this.quality.softwareRenderer);

    this.physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.player = new FirstPersonPlayer(this.camera, this.physics, this.canvas);
    this.hands = new FirstPersonHands(this.renderer);
    this.hands.setAspect(this.camera.aspect);
    this.interactions = new Interactions(this.ui.prompt);
    this.transition = new ComicTransition(this.ui.transition);
    this.biscuit = new Biscuit(this.renderer, this.physics);
    this.scene.add(this.biscuit.group);
    this.biscuit.ready.catch((error) => this.onStatus(`Biscuit didn't load: ${(error as Error).message}`));
    // The game plays on in silence if a sound can't load.
    this.footsteps.ready.catch((error) => console.error('No footsteps:', error));
    this.doorCreak.ready.catch((error) => console.error('No door creak:', error));

    this.settings = this.loadSettings();
    this.player.lookSpeed = this.settings.lookSpeed;
    this.hands.visible = this.settings.hands;
    this.hands.splats = this.settings.splatHands;
    this.rain.enabled = this.settings.rain;

    if (options.hidden) this.hide();
    this.listen();
    this.renderer.setAnimationLoop((time) => this.frame(time));
    if (import.meta.env.DEV) Object.assign(window, { game: this });
  }

  // ---------- Settings ----------

  private loadSettings(): Settings {
    const defaults: Settings = { lookSpeed: 1, dragLook: this.quality.softwareRenderer, hands: true, splatHands: true, rain: true };
    try {
      return { ...defaults, ...JSON.parse(localStorage.getItem('panel-walk:settings') ?? '{}') };
    } catch {
      return defaults;
    }
  }

  saveSettings() {
    this.player.lookSpeed = this.settings.lookSpeed;
    this.hands.visible = this.settings.hands;
    this.hands.splats = this.settings.splatHands;
    this.rain.enabled = this.settings.rain;
    if (this.settings.dragLook) document.exitPointerLock();
    try {
      localStorage.setItem('panel-walk:settings', JSON.stringify(this.settings));
    } catch {
      // Storage unavailable (private window); settings just won't persist.
    }
  }

  // ---------- Overlays ----------

  private makeUi(): GameUi {
    const ui = this.layer.appendChild(document.createElement('div'));
    ui.className = 'game-ui';
    ui.innerHTML = `
      <div id="crosshair"></div>
      <div id="prompt"></div>
      <div id="hint"></div>
      <div class="game-objective"></div>
      <div id="transition"><div class="ink"></div><div class="sfx"></div></div>
      <div id="start" class="hidden">
        <p class="title">Click to play</p>
        <p>Mouse (or drag) look · WASD move · Shift run · E interact · V call Biscuit · T throw · Esc release</p>
      </div>`;
    const $ = (selector: string) => ui.querySelector<HTMLElement>(selector)!;
    return { prompt: $('#prompt'), hint: $('#hint'), transition: $('#transition'), start: $('#start'), objective: $('.game-objective') };
  }

  private showHint(text?: string) {
    this.ui.hint.textContent = text ?? this.carryingHint();
  }

  private carryingHint() {
    const top = this.carried.at(-1);
    if (!top) return '';
    const branches = this.branchesHeld;
    if (top.kind === 'key') return `Carrying the key${branches ? ` and ${branches > 1 ? `${branches} branches` : 'a branch'}` : ''} · G put down`;
    const what = branches > 1 ? `${branches} branches` : `the ${top.label}`; // only branches stack
    return `Carrying ${what} · T throw · G put down`;
  }

  // ---------- Worlds ----------

  loadWorld(runId: string): Promise<MarbleWorld> {
    const key = `${runId}@${this.resolution}`;
    let promise = this.loaded.get(key);
    if (!promise) {
      const run = worldRuns.find((candidate) => candidate.id === runId);
      if (!run) return Promise.reject(new Error(`World ${runId} is not downloaded`));
      const resolution = run.resolutions.includes(this.resolution) ? this.resolution : run.resolutions[0];
      // Full resolution takes a while to load: start with the 500k splats, swap the sharp ones in later.
      const quick = resolution === 'full_res' && run.resolutions.includes(QUICK_RESOLUTION) ? QUICK_RESOLUTION : resolution;
      promise = MarbleWorld.load(run, quick, this.physics, this.onStatus).then((created) => {
        created.deactivate();
        this.runOf.set(created, runId);
        const doors = (PLACEMENTS[runId]?.doors ?? []).map((placement) => new Doorway(placement));
        for (const door of doors) {
          created.root.add(door.object);
          const shut = door.collider();
          if (shut) created.addCollider(this.physics, shut);
        }
        this.doorways.set(created, doors);
        for (const placement of PLACEMENTS[runId]?.props ?? []) this.addProp(placement.kind, created, new THREE.Vector3(...placement.at));
        const fireplace = PLACEMENTS[runId]?.fireplace;
        if (fireplace) {
          this.fire = new Fire(new THREE.Vector3(...fireplace), FIREWOOD);
          this.fireWorld = created;
          created.root.add(this.fire.group);
        }
        this.warmups.push(created);
        if (quick !== resolution) {
          created
            .upgrade(run, resolution, () => this.warmups.push(created))
            .catch((error) => console.warn(`[world] ${runId} stays at ${quick}: ${(error as Error).message}`));
        }
        return created;
      });
      promise.catch(() => this.loaded.delete(key));
      this.loaded.set(key, promise);
    }
    return promise;
  }

  /** Loads the quest's worlds in the background (call from the menu). */
  preload() {
    return Promise.all([this.loadWorld(LEVEL_RUNS.yard), this.loadWorld(LEVEL_RUNS.cabin), this.biscuit.ready, this.hands.ready]);
  }

  /** Drops every loaded world (a different splat resolution means different worlds). */
  unloadWorlds() {
    const previous = [...this.loaded.values()];
    this.loaded.clear();
    this.world = undefined;
    for (const pending of previous) {
      pending
        .then((old) => {
          this.rain.forget(old.colliderView);
          old.dispose(this.physics);
        })
        .catch(() => {});
    }
    for (const prop of this.propHome.keys()) prop.dispose(this.physics);
    this.propHome.clear();
    this.carried = [];
    this.inHand.clear();
    this.fire?.setAudible(false);
    this.fire = this.fireWorld = undefined;
    this.biscuit.letGo();
    this.hands.release();
    this.showHint();
  }

  /** Shows a world; with `arrivingThrough`, puts the player at that doorway instead of the panorama spot. */
  async enterWorld(runId: string, arrivingThrough?: string) {
    const next = await this.loadWorld(runId);
    this.world?.deactivate();
    this.world = next;
    next.activate(this.scene);
    this.physics.step(); // register the collider before the player moves against it

    this.biscuit.letGo(); // a stick in his mouth stays in the world it came from
    for (const [prop, home] of this.propHome) prop.setActive(home === next);

    const doors = this.doorways.get(next) ?? [];
    const arrival = doors.find((door) => door.placement.id === arrivingThrough)?.arrival();
    this.player.placeAt(arrival?.feet ?? new THREE.Vector3(), arrival?.yaw ?? 0);
    this.biscuit.placeBeside(this.player.feet, arrival?.yaw ?? 0); // he comes through the door with you
    const mood = runId.startsWith('cabin') ? 'indoor' : 'dusk';
    this.hands.setMood(mood);
    this.worldLights.setMood(mood);
    this.biscuit.setMood(mood);
    this.rain.setPlace(mood === 'dusk' ? 'outside' : 'inside', next.colliderView, PLACEMENTS[runId]?.rainShelters);
    this.footing = PLACEMENTS[runId]?.footing ?? { ground: mood === 'indoor' ? 'wood' : 'wet' };
    this.fire?.setAudible(next === this.fireWorld);
    this.refreshInteractions();
    this.quality.reset();
    this.onStatus(worldRuns.find((run) => run.id === runId)?.label ?? runId);

    // Warm up the worlds this one's doors lead to.
    for (const door of doors) void this.loadWorld(LEVEL_RUNS[door.placement.to]).catch(() => {});
    if (this.questOn && runId === LEVEL_RUNS.cabin && this.questStage === 'unlocked') void this.inFromTheStorm();
  }

  // ---------- Modes ----------

  /** Nothing on screen (a menu page without Biscuit); loading and warm-up carry on. */
  hide() {
    this.mode = 'hidden';
    this.layer.classList.add('game-layer--hidden');
    this.layer.classList.remove('game-layer--play', 'game-layer--showcase');
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.interactions.enabled = false;
    this.player.inputEnabled = false;
    this.world?.deactivate();
    this.world = undefined;
    this.rain.setPlace('none');
    this.fire?.setAudible(false);
  }

  /** Menu mode: Biscuit alone, drawn over `element` (the page shows through around him). */
  showcase(element: HTMLElement) {
    this.mode = 'showcase';
    this.showcaseEl = element;
    this.layer.classList.add('game-layer--showcase');
    this.layer.classList.remove('game-layer--play', 'game-layer--hidden');
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.ui.start?.classList.add('hidden');
    this.interactions.enabled = false;
    this.player.inputEnabled = false;
    this.world?.deactivate();
    this.world = undefined;
    this.rain.setPlace('none');
    this.fire?.setAudible(false);
    this.scene.background = null;
    this.hands.stopPetting();
    this.biscuit.setMood('studio');
    this.biscuit.stage(Math.PI - 0.55); // three-quarters on, looking out of the page
    this.leap = undefined;
    this.canvas.style.transition = '';
    this.canvas.style.opacity = '';
    this.showcaseSize.set(0, 0);
  }

  /**
   * Resolves once the world is really on screen: the splats sorted for this view and a few frames drawn with
   * them (on a slow machine the first sort of a new view takes a moment, and until then the world is blank).
   */
  whenDrawn(timeoutSeconds = 8): Promise<void> {
    return new Promise((resolve) => {
      const waiter = { since: performance.now(), frames: 0, resolve };
      this.drawWaiters.push(waiter);
      setTimeout(() => {
        this.drawWaiters = this.drawWaiters.filter((other) => other !== waiter);
        resolve();
      }, timeoutSeconds * 1000);
    });
  }

  private drawWaiters: { since: number; frames: number; resolve: () => void }[] = [];

  private checkDrawn() {
    if (!this.drawWaiters.length || !this.world) return;
    // Drawn means the world's own splats are in what's on screen (its level-of-detail pick for a new view
    // arrives a little after the first sort, and Biscuit alone is 50k), sorted after we started waiting.
    const spark = this.spark as SparkRenderer & { lastSortTime?: number; sorting?: boolean };
    for (const waiter of [...this.drawWaiters]) {
      const sorted = (spark.lastSortTime ?? 0) > waiter.since && !spark.sorting;
      const withWorld = spark.display.numSplats > 100_000;
      if (sorted && withWorld) waiter.frames++;
      if (waiter.frames >= 3) {
        this.drawWaiters = this.drawWaiters.filter((other) => other !== waiter);
        waiter.resolve();
      }
    }
  }

  /**
   * The opening view as a JPEG data URL, at full quality: the last frame of the comic-to-game transition
   * (public/comic/transition/game-start.jpg, see scripts/comic-transition.mjs). Without the rain: it fades in
   * over the live picture. Call after `play()`; in the dev console: `copy(await game.captureFrame())`.
   */
  async captureFrame(width = 1920, height = 1080): Promise<string> {
    const ratio = this.renderer.getPixelRatio();
    const lod = this.spark.lodSplatCount;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.hands.setAspect(this.camera.aspect);
    this.spark.lodSplatCount = 2_500_000;
    this.spark.maxPixelRadius = splatRadiusCap(height); // the window's cap is sized for the window
    await this.whenDrawn();
    // Adaptive quality may have resized the canvas to the window meanwhile.
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.hands.setAspect(this.camera.aspect);
    this.renderer.render(this.scene, this.camera);
    this.renderer.autoClear = false;
    this.renderer.clearDepth();
    this.renderer.render(this.hands.scene, this.hands.camera);
    this.renderer.autoClear = true;
    const url = this.canvas.toDataURL('image/jpeg', 0.92);
    this.spark.lodSplatCount = lod;
    this.renderer.setPixelRatio(ratio);
    this.onResize();
    return url;
  }

  /** Into a world (by default the Storm Night yard) at the panorama spot, where comic panel 1 is drawn from. */
  async play(runId = LEVEL_RUNS.yard) {
    this.mode = 'play';
    this.layer.classList.remove('game-layer--showcase', 'game-layer--hidden');
    this.layer.classList.add('game-layer--play');
    this.canvas.style.cssText = '';
    this.scene.background = new THREE.Color(0x1b2028);
    this.quality.resize();
    this.onResize();
    if (this.questOn) await this.resetQuest();
    await this.enterWorld(runId);
    // Where comic panel 1 draws him: sitting on the path ahead, a little right, looking back at you.
    const posed = PLACEMENTS[runId]?.biscuitStart;
    if (this.questOn && posed) this.biscuit.sitAt(new THREE.Vector3(...posed), this.player.feet);
    this.interactions.enabled = true;
    this.player.inputEnabled = true;
    const locked = document.pointerLockElement === this.canvas;
    this.ui.start?.classList.toggle('hidden', this.settings.dragLook || locked);
  }

  // ---------- Menu companion ----------

  spinDog(radians: number) {
    this.biscuit.spin(radians);
  }

  petDog() {
    this.biscuit.wag();
  }

  /**
   * The leap into a comic panel. The render widens from his box to the whole window (with a camera that keeps
   * him exactly where he was), he turns, crouches and jumps on an arc away from the viewer into the page,
   * landing sitting at `target` (window pixels: his paws) at `target.height` pixels tall (the painted dog
   * there), then fades into the painting. Resolves when he's gone.
   */
  leapInto(target: { x: number; y: number; height: number }): Promise<void> {
    const box = this.showcaseEl?.getBoundingClientRect();
    if (this.mode !== 'showcase' || !box || !this.biscuit.group.visible) return Promise.resolve();
    const W = window.innerWidth;
    const H = window.innerHeight;
    // A window-sized camera with the same pixel scale and his box's centre as its principal point.
    const box3 = this.showcaseCamera;
    const pixel = (2 * Math.tan(THREE.MathUtils.degToRad(box3.fov / 2))) / box.height; // tan-space per pixel
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const virtualW = 2 * Math.max(cx, W - cx);
    const virtualH = 2 * Math.max(cy, H - cy);
    const camera = box3.clone();
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan((pixel * virtualH) / 2));
    camera.aspect = virtualW / virtualH;
    camera.setViewOffset(virtualW, virtualH, virtualW / 2 - cx, virtualH / 2 - cy, W, H);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();

    // Where to land: on the ray through the target pixel, as far away as makes him the painted size.
    const start = this.biscuit.group.position.clone();
    const project = (p: THREE.Vector3) => p.clone().project(camera);
    const standing = (project(new THREE.Vector3(0, 0.62, 0).add(start)).y - project(start).y) * (H / 2);
    const startDistance = camera.position.distanceTo(start);
    const distance = (startDistance * standing) / Math.max(target.height / 0.85, 8); // he sits a bit lower than he stands
    const ndc = new THREE.Vector3((target.x / W) * 2 - 1, -(target.y / H) * 2 + 1, 0.5);
    const ray = ndc.unproject(camera).sub(camera.position).normalize();
    const forward = camera.getWorldDirection(new THREE.Vector3());
    const end = camera.position.clone().addScaledVector(ray, distance / ray.dot(forward));

    // A modest arc: about an eighth of the window's height above the line between take-off and landing.
    const midDistance = (startDistance + distance) / 2;
    const apex = 0.12 * H * midDistance * pixel * (virtualH / H) * (H / virtualH);
    this.leap = { camera, start, end, apex, time: 0, landed: false, done: () => {} };
    this.biscuit.jump(LEAP_RATE);
    this.showcaseSize.set(0, 0);
    return new Promise((resolve) => (this.leap!.done = resolve));
  }

  private leap?: {
    camera: THREE.PerspectiveCamera;
    start: THREE.Vector3;
    end: THREE.Vector3;
    apex: number;
    time: number;
    landed: boolean;
    done: () => void;
  };

  /** Moves him along the leap (called every frame while leaping). */
  private updateLeap(dt: number) {
    const leap = this.leap!;
    leap.time += dt;
    const takeOff = LEAP_TAKEOFF / LEAP_RATE;
    const landing = LEAP_LANDING / LEAP_RATE;
    const group = this.biscuit.group;
    const travel = leap.end.clone().sub(leap.start);
    const away = Math.atan2(-travel.x, -travel.z);
    if (leap.time < takeOff) {
      // Crouching: turn to face where he's going.
      const turn = Math.min(1, leap.time / takeOff);
      group.rotation.y = lerpAngle(group.rotation.y, away, turn * 0.35);
    } else if (leap.time < landing) {
      const s = (leap.time - takeOff) / (landing - takeOff);
      const along = s * s * (3 - 2 * s) * 0.35 + s * 0.65; // a touch of ease without stalling at the ends
      group.position.lerpVectors(leap.start, leap.end, along);
      group.position.y += Math.sin(Math.PI * s) * leap.apex;
      // Facing the way he flies, then round to face out of the page for the landing (as he's painted).
      group.rotation.y = lerpAngle(away, Math.PI, THREE.MathUtils.smoothstep(s, 0.55, 1));
    } else if (!leap.landed) {
      leap.landed = true;
      group.position.copy(leap.end);
      group.rotation.y = Math.PI;
      this.biscuit.sit();
      this.canvas.style.transition = 'opacity .45s ease .25s';
      this.canvas.style.opacity = '0';
      setTimeout(() => {
        this.leap = undefined;
        leap.done();
      }, 750);
    }
  }

  /** Puts the showcase render over `element`'s rectangle (called every frame while showing). */
  private placeShowcase() {
    const rect = this.showcaseEl?.getBoundingClientRect();
    if (!rect || rect.width < 2 || rect.height < 2) return false;
    const style = this.canvas.style;
    style.left = `${rect.left}px`;
    style.top = `${rect.top}px`;
    style.width = `${rect.width}px`;
    style.height = `${rect.height}px`;
    if (this.showcaseSize.x !== rect.width || this.showcaseSize.y !== rect.height) {
      this.showcaseSize.set(rect.width, rect.height);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.softwareRenderer ? 0.75 : 2));
      this.renderer.setSize(rect.width, rect.height, false);
      this.showcaseCamera.aspect = rect.width / rect.height;
      // Frame him whole, from slightly above, his paws low in the box (on the page's platform).
      this.showcaseCamera.position.set(0, 0.52, 2.3);
      this.showcaseCamera.lookAt(0, 0.4, 0);
      this.showcaseCamera.updateProjectionMatrix();
    }
    return true;
  }

  /** One off-screen render of a freshly loaded world, so its splats are on the GPU before anyone enters. */
  private warmUp(world: MarbleWorld) {
    this.warmTarget ??= new THREE.WebGLRenderTarget(64, 64);
    const wasIn = !!world.root.parent;
    if (!wasIn) world.activate(this.scene);
    this.camera.position.set(0, 1.6, 0);
    this.camera.rotation.set(0, 0, 0);
    this.renderer.setRenderTarget(this.warmTarget);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    if (!wasIn) world.deactivate();
  }

  // ---------- Interactions ----------

  /** What the player can use in the current world: its doors, Biscuit, the props lying in it, the dig spot and the fireplace. */
  refreshInteractions() {
    const here = this.world;
    if (!here) return;
    const runId = this.runOf.get(here);
    const digSpot = runId && PLACEMENTS[runId]?.digSpot;
    const fire = here === this.fireWorld ? this.fire : undefined;
    this.interactions.set([
      ...(this.doorways.get(here) ?? []).map((door) => ({
        target: door.center,
        range: 2.6,
        prompt: () => (this.isLocked(door) ? (this.holding('key') ? 'Unlock the door' : 'Try the door') : door.placement.prompt),
        act: () => this.useDoor(door),
      })),
      {
        target: this.biscuit.back,
        range: 2.6,
        prompt: 'Pet Biscuit',
        enabled: () => !this.carried.length && !this.hands.busy && !this.biscuit.busy,
        act: () => this.pet(),
      },
      ...(this.questOn && fire
        ? [
            {
              target: fire.group.position,
              range: 2.8,
              prompt: () => `Put ${this.carried.length > 1 ? 'the branches' : 'the branch'} in the fireplace`,
              enabled: () => this.questStage === 'cold' && this.holding('branch') && !this.hands.busy,
              act: () => this.stokeFire(fire),
            },
          ]
        : []),
      ...(this.questOn && digSpot
        ? [
            {
              target: new THREE.Vector3(...digSpot),
              range: 3.2,
              prompt: '“Biscuit, dig!”',
              enabled: () => (this.questStage === 'arrive' || this.questStage === 'locked') && !this.biscuit.busy,
              act: () => this.digForKey(new THREE.Vector3(...digSpot)),
            },
          ]
        : []),
      ...[...this.propHome].filter(([, home]) => home === here).map(([prop]) => ({
        target: prop.position,
        range: 2.4,
        prompt: () => `Pick up the ${prop.label}${this.carried.length ? ' too' : ''}`,
        enabled: () => this.canPickUp(prop),
        act: () => this.pickUp(prop),
      })),
    ]);
  }

  /** Whether the top of what's carried is a `kind`. */
  private holding(kind: PropKind) {
    return this.carried.at(-1)?.kind === kind;
  }

  /**
   * An empty hand takes anything. Firewood and the key go together (so the demo never stalls on full hands):
   * branches gather under your arm, up to what the fire needs, and the key rides on top in your fingers.
   */
  private canPickUp(prop: Prop) {
    if (prop.isCarried) return false;
    if (!this.carried.length) return true;
    const questItems = this.carried.every((held) => held.kind === 'branch' || held.kind === 'key');
    if (prop.kind === 'branch') return questItems && this.branchesHeld < FIREWOOD;
    if (prop.kind === 'key') return questItems && !this.holding('key');
    return false;
  }

  private get branchesHeld() {
    return this.carried.filter((prop) => prop.kind === 'branch').length;
  }

  /** Branches gathered for the fire so far: on the grate and in hand. */
  private get gathered() {
    return (this.fire?.logCount ?? 0) + this.branchesHeld;
  }

  /** Puts what's carried in the right hand: the key in the fingers, or the branches fanned out as an armful. */
  private updateHeld() {
    const top = this.carried.at(-1);
    if (!top) {
      this.hands.release();
      return;
    }
    // Under the key, any branches are tucked under the arm: carried, not drawn.
    const shown = top.kind === 'branch' ? this.carried.filter((prop) => prop.kind === 'branch') : [top];
    const armful = new THREE.Group();
    const spread = (shown.length - 1) / 2;
    shown.forEach((prop, i) => {
      const model = this.inHand.get(prop)!;
      model.rotation.z = (i - spread) * 0.22; // fanned a little, like a bundle
      model.position.y = (i - spread) * -0.012;
      armful.add(model);
    });
    this.hands.hold(armful, gripFor(top.kind));
  }

  /** Takes `prop` out of the hand (whatever else is carried stays). */
  private letGoOf(prop: Prop) {
    this.carried = this.carried.filter((held) => held !== prop);
    this.inHand.delete(prop);
    this.updateHeld();
  }

  private addProp(kind: PropKind, world: MarbleWorld, at: THREE.Vector3) {
    const prop = new Prop(kind, this.physics, at);
    prop.setActive(world === this.world); // its world's floor isn't there until the world is entered
    world.root.add(prop.object);
    this.propHome.set(prop, world);
    return prop;
  }

  private async pickUp(prop: Prop) {
    if (!this.canPickUp(prop) || this.hands.busy) return;
    const reach = this.hands.aimAt(prop.position, this.camera);
    await this.hands.play(
      'pickUp',
      {
        grab: () => {
          if (!this.canPickUp(prop)) return; // Biscuit got there first
          this.inHand.set(prop, prop.pickUp());
          // The key stays on top, in the fingers; a branch picked up meanwhile goes under the arm.
          const keyAt = this.carried.findIndex((held) => held.kind === 'key');
          if (prop.kind === 'branch' && keyAt >= 0) this.carried.splice(keyAt, 0, prop);
          else this.carried.push(prop);
          this.updateHeld();
          this.showHint();
          if (this.questStage === 'cold') this.setStage('cold'); // the count
        },
      },
      reach,
    );
  }

  async throwCarried() {
    const prop = this.carried.at(-1);
    if (!prop || this.hands.busy || !this.player.inputEnabled) return;
    if (prop.kind === 'key') return this.showHint('Better hang on to the key');
    await this.hands.play('throw', {
      release: () => {
        const from = this.hands.palmInWorld(this.camera);
        this.letGoOf(prop);
        const velocity = this.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(8).add(new THREE.Vector3(0, 2.5, 0));
        const spin = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(14);
        this.putInWorld(prop, from, velocity, spin);
        this.biscuit.fetch(prop);
      },
    });
  }

  async putDownCarried() {
    const prop = this.carried.at(-1);
    if (!prop || this.hands.busy || !this.player.inputEnabled) return;
    await this.hands.play('drop', {
      release: () => {
        this.letGoOf(prop);
        // Just in front of the feet; it drops the last bit and settles.
        const ahead = this.camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
        this.putInWorld(prop, this.player.feet.addScaledVector(ahead, 0.6).setY(this.player.feet.y + 0.3));
      },
    });
  }

  private putInWorld(prop: Prop, at: THREE.Vector3, velocity?: THREE.Vector3, spin?: THREE.Vector3) {
    if (this.world) {
      this.propHome.set(prop, this.world); // carried through a door? It lives here now
      this.world.root.add(prop.object);
    }
    prop.putDown(at, velocity, spin);
    this.refreshInteractions();
    this.showHint();
    if (this.questStage === 'cold') this.setStage('cold'); // the count
  }

  /** He trots up and stands side-on in front of you (head to your left), you crouch, and the hand strokes his neck. */
  private async pet() {
    if (this.carried.length || this.hands.busy || !this.player.inputEnabled) return;
    const { player, biscuit, hands } = this;
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
      hands.startPetting(1.1, hands.aimAt(biscuit.petPoint, this.camera));
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

  async callBiscuit() {
    if (this.hands.busy || !this.player.inputEnabled) return;
    this.biscuit.come();
    this.biscuit.barkTwice();
    await this.hands.play('beckon');
  }

  // ---------- Doors and the quest ----------

  private isLocked(door: Doorway) {
    return this.questOn && !!door.placement.locked && LOCKED_STAGES.includes(this.questStage);
  }

  private async useDoor(door: Doorway) {
    if (!this.isLocked(door)) return this.goThrough(door);
    const key = this.carried.at(-1);
    if (key?.kind === 'key' && door.keyhole) {
      // Look down at the lock, push the key in and turn it; it stays in the lock and the door's open for good.
      const { player } = this;
      player.inputEnabled = false;
      player.focus = door.keyhole;
      player.focusTilt = 0.12; // the lock a little below the middle of the view, where the hand reaches
      try {
        await wait(0.45);
        await this.hands.play(
          'unlock',
          {
            turned: () => {
              this.letGoOf(key);
              this.propHome.delete(key);
              key.dispose(this.physics);
              door.insertKey(propModel('key'));
              this.setStage('unlocked');
              this.showHint('Click!');
            },
          },
          this.hands.aimAt(door.keyhole, this.camera),
        );
      } finally {
        player.focus = undefined;
        player.focusTilt = 0;
        player.inputEnabled = true;
      }
      if (this.questStage === 'unlocked') return this.goThrough(door);
      return;
    }
    await this.hands.play('knock', {}, door.knob && this.hands.aimAt(door.knob, this.camera));
    this.showHint('Locked. Mika’s keys are gone…');
    if (this.questStage === 'arrive') this.setStage('locked');
  }

  private async digForKey(spot: THREE.Vector3) {
    this.setStage('digging');
    this.showHint('');
    await this.hands.play('point', {}, this.hands.aimAt(spot, this.camera));
    this.dirt ??= new Dirt(this.scene);
    const digging = this.biscuit.dig(spot);
    const throwDirt = setInterval(() => this.biscuit.digging && this.dirt?.burst(spot), 140);
    await digging;
    clearInterval(throwDirt);
    if (this.mode !== 'play' || !this.world) return;
    // Out it pops: the spare key, flicked up out of the hole.
    const key = this.addProp('key', this.world, spot.clone().setY(spot.y + 0.25));
    key.putDown(key.position.clone(), new THREE.Vector3(0.3, 2.2, 0.6), new THREE.Vector3(4, 7, 2));
    this.refreshInteractions();
    this.biscuit.barkTwice();
    this.showHint('Biscuit dug up the spare key!');
    this.setStage('key');
  }

  private setStage(stage: QuestStage) {
    this.questStage = stage;
    const text = this.questOn ? OBJECTIVES[stage](this.gathered) : '';
    if (this.ui.objective) this.ui.objective.textContent = text;
    this.onObjective?.(text);
  }

  /** Inside at last, but the cabin is freezing and the grate is cold: off to find firewood. */
  private async inFromTheStorm() {
    this.setStage('cold');
    this.showHint(this.gathered >= FIREWOOD ? 'Brr… good thing you brought firewood' : 'Brr… the fire’s out and there’s no firewood in');
    await wait(0.6);
    if (this.mode === 'play' && !this.hands.busy && !this.carried.length) await this.hands.play('rubHands');
  }

  /** Lays the branches in hand on the grate; once there are enough, the fire lights. */
  private async stokeFire(fire: Fire) {
    if (!this.holding('branch') || this.hands.busy) return;
    const logs = this.carried.filter((prop) => prop.kind === 'branch');
    await this.hands.play(
      'drop',
      {
        release: () => {
          for (const log of logs) {
            this.letGoOf(log);
            this.propHome.delete(log);
            log.dispose(this.physics);
            fire.addLog();
          }
          this.refreshInteractions();
          const missing = FIREWOOD - fire.logCount;
          this.showHint(missing > 0 ? `${missing} more for a proper fire` : '');
          this.setStage('cold');
        },
      },
      this.hands.aimAt(fire.group.position, this.camera),
    );
    if (fire.ready && this.mode === 'play') await this.lightFire(fire);
  }

  /** It catches: Biscuit settles by the hearth, warm hands, and the story ends well. */
  private async lightFire(fire: Fire) {
    const { player } = this;
    player.inputEnabled = false;
    player.focus = fire.group.position.clone().setY(fire.group.position.y + 0.35);
    this.setStage('fire');
    fire.light();
    // On the rug, by the hearth, looking at you.
    this.biscuit.sitAt(fire.group.position.clone().add(new THREE.Vector3(-0.75, -fire.group.position.y, 1.15)), player.feet);
    await wait(1.8);
    if (this.mode !== 'play') return;
    await this.hands.play('warmHands');
    player.focus = undefined;
    await this.completeQuest();
  }

  /** Back to the start of the story: the door locked, the key still buried, the branches round the yard, the grate cold. */
  async resetQuest() {
    for (const prop of [...this.propHome.keys()]) {
      if (prop.kind !== 'key' && prop.kind !== 'branch') continue;
      this.propHome.delete(prop);
      prop.dispose(this.physics);
    }
    this.carried = [];
    this.inHand.clear();
    this.hands.release();
    this.fire?.reset();
    for (const pending of this.loaded.values()) {
      const world = await pending.catch(() => undefined);
      const runId = world && this.runOf.get(world);
      if (!world || !runId) continue;
      for (const door of this.doorways.get(world) ?? []) door.removeKey();
      for (const placement of PLACEMENTS[runId]?.props ?? []) {
        if (placement.kind === 'branch') this.addProp('branch', world, new THREE.Vector3(...placement.at));
      }
    }
    this.showHint();
    this.setStage('arrive');
  }

  private async completeQuest() {
    this.setStage('complete');
    await wait(1.6); // a moment to take in the fire
    if (this.mode !== 'play') return;
    this.player.inputEnabled = false;
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.onQuestComplete?.();
  }

  private async goThrough(door: Doorway) {
    const targetRun = LEVEL_RUNS[door.placement.to];
    this.player.inputEnabled = false;
    try {
      const leaf = door.placement.door;
      if (leaf) {
        // Grab the knob and turn it, then shove (push) or haul (pull): the door swings on the hand's cue.
        const knob = door.knob && this.hands.aimAt(door.knob, this.camera);
        const action = leaf.opens === 'push' ? 'openDoor' : 'pullDoor';
        await new Promise<void>((swing) => void this.hands.play(action, { swing }, knob));
        void door.open();
        this.doorCreak.play(); // the hinges, over whatever the rain is doing
        await wait(leaf.opens === 'push' ? 0.3 : 0.45);
      }
      await this.transition.cover(door.placement.sfx);
      await this.enterWorld(targetRun, door.placement.id);
      door.close();
      await this.transition.reveal();
    } catch (error) {
      console.error(error);
      this.onStatus(`Couldn't go through: ${(error as Error).message}`);
      await this.transition.reveal();
    } finally {
      if (this.questStage !== 'complete') this.player.inputEnabled = true;
    }
  }

  // ---------- Input ----------

  private lockPointer = () => {
    if (this.mode !== 'play') return;
    this.capturePointer();
  };

  /**
   * Mouse look: locks the pointer to the game (needs a click or key press to call it from). The menu calls it
   * on the click into panel 1, so the game opens already looking around, with no "click to play" in between.
   */
  capturePointer() {
    if (this.settings.dragLook || document.pointerLockElement === this.canvas) return;
    this.canvas.requestPointerLock({ unadjustedMovement: true }).catch(() => this.canvas.requestPointerLock().catch(() => {}));
  }

  private listen() {
    // Pointer lock gives the best mouse look, but over Remote Desktop / in VMs and some embedded browsers it
    // misbehaves or is refused; drag-to-look (the default without a GPU) avoids it entirely.
    this.ui.start?.addEventListener('click', () => {
      this.ui.start?.classList.add('hidden');
      this.lockPointer();
    });
    this.canvas.addEventListener('click', this.lockPointer);
    this.canvas.addEventListener('pointerdown', () => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    document.addEventListener('pointerlockchange', () => {
      const lost = document.pointerLockElement !== this.canvas;
      if (lost && this.mode === 'play' && !this.settings.dragLook && this.questStage !== 'complete') this.ui.start?.classList.remove('hidden');
    });
    window.addEventListener('keydown', (event) => {
      if (event.repeat || event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement) return;
      if (this.mode !== 'play') return;
      this.onKey?.(event);
      if (event.code === 'KeyR' && this.player.inputEnabled) this.player.respawn();
      else if (event.code === 'KeyT') void this.throwCarried();
      else if (event.code === 'KeyG') void this.putDownCarried();
      else if (event.code === 'KeyV') void this.callBiscuit();
    });
    // With the pointer locked, a left click throws too (in drag-to-look mode the button is for looking).
    this.canvas.addEventListener('mousedown', (event) => {
      if (event.button === 0 && document.pointerLockElement === this.canvas) void this.throwCarried();
    });
    window.addEventListener('resize', () => this.onResize());
  }

  private onResize() {
    if (this.mode !== 'play') return;
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.hands.setAspect(this.camera.aspect);
    this.quality.resize(); // the render size, and the splat size cap that goes with it
  }

  /** Planks if the player is up on the porch or its steps, otherwise whatever this world's ground is. */
  private underfoot(feetY: number): Surface {
    return this.footing.boardsAbove !== undefined && feetY >= this.footing.boardsAbove ? 'wood' : this.footing.ground;
  }

  // ---------- Loop ----------

  private frame(time: number) {
    this.timer.update(time);
    const frameSeconds = this.timer.getDelta();
    const dt = Math.min(frameSeconds, 1 / 20);
    this.dirt?.update(dt);

    if (this.mode !== 'play') {
      // Warm up one freshly loaded world per frame while nobody is looking.
      const world = this.warmups.shift();
      if (world) this.warmUp(world);
      if (this.mode === 'hidden') return;
      this.biscuit.update(dt, this.player.feet);
      if (this.leap) {
        this.updateLeap(dt);
        // Over the whole window while he flies.
        if (this.showcaseSize.x !== window.innerWidth || this.showcaseSize.y !== window.innerHeight) {
          this.showcaseSize.set(window.innerWidth, window.innerHeight);
          const style = this.canvas.style;
          style.left = style.top = '0px';
          style.width = `${window.innerWidth}px`;
          style.height = `${window.innerHeight}px`;
          this.renderer.setSize(window.innerWidth, window.innerHeight, false);
        }
        this.renderer.setClearColor(0x000000, 0);
        if (this.leap) this.renderer.render(this.scene, this.leap.camera);
        return;
      }
      if (!this.placeShowcase()) return;
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.render(this.scene, this.showcaseCamera);
      return;
    }

    this.warmups.length = 0;
    const world = this.world;
    if (world) {
      this.player.update(dt);
      this.footsteps.surface = this.underfoot(this.player.feet.y); // the porch is planked though it's outdoors
      this.footsteps.update(dt, this.player.motion);
      this.physics.timestep = dt;
      this.physics.step();
      for (const [prop, home] of this.propHome) if (home === world) prop.sync();
      this.biscuit.update(dt, this.player.feet);
      this.interactions.update(this.camera);
    }
    this.hands.visible = this.settings.hands && !this.player.fly;
    this.hands.update(dt, this.player.motion);
    this.rain.update(dt, this.camera);
    if (world && world === this.fireWorld && this.fire) {
      this.fire.update(dt, this.camera);
      // Storm Night's cabin is cold and blue until the fire's lit, then warms with it.
      if (this.questOn) world.setTint(this.tint.lerpColors(COLD_TINT, WARM_TINT, this.fire.intensity));
    }

    this.renderer.render(this.scene, this.camera);
    this.renderer.autoClear = false;
    // Rain over the world, tested against its depth; then the hands on top: clear depth so they never sink into walls.
    if (this.rain.showing) this.renderer.render(this.rain.scene, this.camera);
    this.renderer.clearDepth();
    this.renderer.render(this.hands.scene, this.hands.camera);
    this.renderer.autoClear = true;
    this.checkDrawn();

    const fps = world ? this.quality.update(frameSeconds) : undefined;
    if (fps !== undefined) this.onFps?.(fps);
  }
}

/** Clods of earth flicked up behind a digging dog. */
class Dirt {
  private readonly clods: { mesh: THREE.Mesh; velocity: THREE.Vector3; life: number }[] = [];
  private readonly geometry = new THREE.IcosahedronGeometry(0.022, 0);
  private readonly material = new THREE.MeshLambertMaterial({ color: 0x4a3322 });

  constructor(private readonly scene: THREE.Scene) {}

  burst(at: THREE.Vector3) {
    for (let i = 0; i < 5; i++) {
      const mesh = new THREE.Mesh(this.geometry, this.material);
      mesh.position.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 0.15, 0.04, (Math.random() - 0.5) * 0.15));
      mesh.scale.setScalar(0.6 + Math.random());
      const velocity = new THREE.Vector3((Math.random() - 0.5) * 1.6, 1.4 + Math.random() * 1.4, (Math.random() - 0.5) * 1.6);
      this.scene.add(mesh);
      this.clods.push({ mesh, velocity, life: 0.9 });
    }
  }

  update(dt: number) {
    for (let i = this.clods.length - 1; i >= 0; i--) {
      const clod = this.clods[i];
      clod.velocity.y -= 9.8 * dt;
      clod.mesh.position.addScaledVector(clod.velocity, dt);
      clod.mesh.rotation.x += dt * 8;
      clod.life -= dt;
      if (clod.life <= 0) {
        clod.mesh.removeFromParent();
        this.clods.splice(i, 1);
      }
    }
  }
}
