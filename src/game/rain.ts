import * as THREE from 'three';
import { LoopingSound } from './audio';
import type { RainShelter } from './levels';

// Storm Night's rain: streaks falling round the player in the yard, rings where they land, and the sound of
// it (the world-sfx recording: open outside, muffled through the cabin's walls). The drops move entirely in the vertex shader: each falls
// through a box that travels with the camera and wraps round its edges, so a frame only updates a few
// uniforms. A depth map of the world's collider seen from above (rendered once per world) keeps them off
// roofs and from falling through the ground; where the collider has holes (Marble only builds what the
// panorama saw), boxes from the level placements keep them off the porch and out of the house.

export type RainPlace = 'outside' | 'inside' | 'none';

const BOX = new THREE.Vector3(16, 10, 16); // metres of rain round the camera
const BOX_LOW = new THREE.Vector3(-8, -3, -8); // its corner relative to the camera: more of it above than below
const FALL_SPEED = 9; // m/s: heavy rain
const WIND = new THREE.Vector3(1.1, 0, 0.5); // m/s of slant
const STREAK_SECONDS = 0.035; // motion blur: how long each streak is
const SPLASH_AREA = 10; // metres square round the camera
const SPLASH_SECONDS = 0.5;
const FADE_SECONDS = 0.8;
const RAIN_VOLUME = 0.4;
const TIME_WRAP = 600; // seconds; the drops re-randomise when the clock wraps, which nobody can see in rain

// The shelter map: the collider seen from straight above, from SHELTER_TOP down.
const SHELTER_SIZE = 512;
const SHELTER_HALF = 24; // metres either side of the world origin
const SHELTER_TOP = 9; // anything higher (treetops, a sky dome) doesn't shelter: rain falls past it
const SHELTER_DEPTH = 40;
const MAX_BOXES = 4;

/** True inside any of the level's no-rain boxes (each matrix maps world space into its unit cube). */
const IN_BOX = /* glsl */ `
  #define MAX_BOXES ${MAX_BOXES}
  uniform mat4 uBoxes[MAX_BOXES];
  uniform int uBoxCount;
  bool inBox(vec3 point) {
    for (int i = 0; i < MAX_BOXES; i++) {
      if (i >= uBoxCount) break;
      if (all(lessThan(abs((uBoxes[i] * vec4(point, 1.0)).xyz), vec3(0.5)))) return true;
    }
    return false;
  }`;

const DROP_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform vec3 uCenter;
  uniform vec3 uBox;
  uniform vec3 uBoxLow;
  uniform vec3 uWind;
  uniform float uSpeed;
  uniform float uStreak;
  uniform float uPixel;
  uniform float uOpacity;
  uniform mat4 uShelterMatrix;
  uniform sampler2D uShelter;
  uniform float uShelterOn;
  attribute vec3 aCorner; // x: side (-1, 1), y: tail (0) to head (1), z: this drop's random
  varying vec2 vUv;
  varying float vAlpha;
  ${IN_BOX}

  void main() {
    vec3 velocity = vec3(uWind.x, -uSpeed * (0.8 + 0.4 * aCorner.z), uWind.z);
    // Falling from a random spot, wrapped into the box round the camera: still in the world as you walk.
    vec3 low = uCenter + uBoxLow;
    vec3 head = low + mod(position * uBox + velocity * uTime - low, uBox);
    vec3 tail = head - velocity * uStreak;

    // A streak facing the camera, at least a pixel or so wide (fainter instead of thinner far away).
    vec3 toCamera = uCenter - head;
    float dist = length(toCamera);
    vec3 side = cross(normalize(velocity), toCamera);
    float sideLength = length(side);
    side = sideLength > 1e-4 ? side / sideLength : vec3(1.0, 0.0, 0.0);
    float width = max(0.004, 1.3 * uPixel * dist);

    // Faded in close to the eye and out towards the box's edges, where drops wrap round.
    vec3 offset = head - uCenter;
    float alpha = uOpacity
      * smoothstep(0.3, 1.0, dist)
      * (1.0 - smoothstep(0.3 * uBox.x, 0.5 * uBox.x, length(offset.xz)))
      * (1.0 - smoothstep(uBoxLow.y + uBox.y - 2.0, uBoxLow.y + uBox.y, offset.y))
      * clamp(pow(0.004 / width, 0.6), 0.25, 1.0);

    // Under a roof or below the ground: gone.
    if (uShelterOn > 0.5) {
      vec4 shelter = uShelterMatrix * vec4(head, 1.0);
      bool onMap = all(greaterThan(shelter.xyz, vec3(0.0))) && all(lessThan(shelter.xy, vec2(1.0)));
      if (onMap && shelter.z > texture2D(uShelter, shelter.xy).r + 0.002) alpha = 0.0;
    }
    if (alpha > 0.0 && inBox(head)) alpha = 0.0;

    vUv = aCorner.xy;
    vAlpha = alpha;
    vec3 corner = mix(tail, head, aCorner.y) + side * aCorner.x * 0.5 * width;
    gl_Position = alpha > 0.001 ? projectionMatrix * viewMatrix * vec4(corner, 1.0) : vec4(0.0, 0.0, -2.0, 1.0);
  }`;

const DROP_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying vec2 vUv;
  varying float vAlpha;

  void main() {
    float across = 1.0 - vUv.x * vUv.x;
    float along = smoothstep(0.0, 1.0, vUv.y); // faint tail, bright head
    gl_FragColor = vec4(uColor, 0.6 * vAlpha * across * along);
  }`;

const SPLASH_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform vec3 uCenter;
  uniform float uArea;
  uniform float uPeriod;
  uniform float uOpacity;
  uniform mat4 uShelterMatrix;
  uniform sampler2D uShelter;
  uniform float uShelterTop;
  uniform float uShelterDepth;
  attribute vec3 aCorner; // xy: corner of the ring's square, z: this splash's phase
  varying vec2 vUv;
  varying float vLife;
  varying float vAlpha;
  ${IN_BOX}

  float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  void main() {
    float phase = uTime / uPeriod + aCorner.z;
    float cycle = floor(phase);
    vLife = phase - cycle;
    vUv = aCorner.xy;

    // A new spot every cycle, fixed in the world while it lives, on whatever the rain hits there.
    vec2 seed = position.xy * 113.0 + cycle;
    vec2 low = uCenter.xz - 0.5 * uArea;
    vec2 xz = low + mod(vec2(hash(seed), hash(seed + 17.31)) * uArea - low, uArea);
    vec4 shelter = uShelterMatrix * vec4(xz.x, 0.0, xz.y, 1.0);
    float depth = texture2D(uShelter, shelter.xy).r;
    float y = uShelterTop - depth * uShelterDepth;
    bool onMap = all(greaterThan(shelter.xy, vec2(0.0))) && all(lessThan(shelter.xy, vec2(1.0))) && depth < 0.999;

    // Only on the ground round you: rings on roofs and in trees above the eye would float.
    float alpha = onMap && y < uCenter.y - 0.5 && !inBox(vec3(xz.x, y + 0.05, xz.y)) ? uOpacity : 0.0;
    alpha *= 1.0 - smoothstep(0.3 * uArea, 0.5 * uArea, distance(xz, uCenter.xz));
    vAlpha = alpha;

    float radius = 0.06 + 0.06 * position.z;
    vec3 corner = vec3(xz.x + aCorner.x * radius, y + 0.02, xz.y + aCorner.y * radius);
    gl_Position = alpha > 0.001 ? projectionMatrix * viewMatrix * vec4(corner, 1.0) : vec4(0.0, 0.0, -2.0, 1.0);
  }`;

const SPLASH_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying vec2 vUv;
  varying float vLife;
  varying float vAlpha;

  void main() {
    float r = length(vUv);
    float ring = (1.0 - smoothstep(0.0, 0.15, abs(r - vLife))) * (1.0 - vLife);
    float hit = (1.0 - smoothstep(0.0, 0.2, vLife)) * (1.0 - smoothstep(0.0, 0.4, r));
    float alpha = 0.5 * vAlpha * (ring + hit);
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(uColor, alpha);
  }`;

/** `count` quads: `position` is a random point per quad, `aCorner` its corner (xy) and another random (z). */
function quads(count: number, corners: [number, number][]) {
  const position = new Float32Array(count * 12);
  const corner = new Float32Array(count * 12);
  const index = new Uint32Array(count * 6);
  for (let i = 0; i < count; i++) {
    const random = [Math.random(), Math.random(), Math.random()];
    const r = Math.random();
    corners.forEach(([x, y], k) => {
      position.set(random, (i * 4 + k) * 3);
      corner.set([x, y, r], (i * 4 + k) * 3);
    });
    const v = i * 4;
    index.set([v, v + 1, v + 2, v + 2, v + 1, v + 3], i * 6);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('aCorner', new THREE.BufferAttribute(corner, 3));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  return geometry;
}

interface Shelter {
  target: THREE.WebGLRenderTarget;
  /** World position â†’ (u, v, depth) in the map. */
  matrix: THREE.Matrix4;
}

const DEPTH_ONLY = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, colorWrite: false });

export class Rain {
  /** Drawn after the world, keeping its depth (before the hands). */
  readonly scene = new THREE.Scene();
  private readonly uniforms = {
    uTime: { value: 0 },
    uCenter: { value: new THREE.Vector3() },
    uBox: { value: BOX },
    uBoxLow: { value: BOX_LOW },
    uWind: { value: WIND },
    uSpeed: { value: FALL_SPEED },
    uStreak: { value: STREAK_SECONDS },
    uPixel: { value: 0.001 },
    uOpacity: { value: 0 },
    uShelterMatrix: { value: new THREE.Matrix4() },
    uShelter: { value: null as THREE.Texture | null },
    uShelterOn: { value: 0 },
    uShelterTop: { value: SHELTER_TOP },
    uShelterDepth: { value: SHELTER_DEPTH },
    uArea: { value: SPLASH_AREA },
    uPeriod: { value: SPLASH_SECONDS },
    uBoxes: { value: Array.from({ length: MAX_BOXES }, () => new THREE.Matrix4()) },
    uBoxCount: { value: 0 },
  };
  private readonly splashes: THREE.Mesh;
  private readonly shelters = new WeakMap<THREE.Object3D, Shelter>();
  /** The recorded rain (world-sfx), muffled through the cabin's walls. */
  private readonly sound = new LoopingSound('/audio/rain.mp3', 0);
  private readonly bufferSize = new THREE.Vector2();
  private place: RainPlace = 'none';
  private intensity = 0;
  private time = 0;
  private on = true;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    lowSpec: boolean,
  ) {
    const material = (vertexShader: string, fragmentShader: string, color: number) =>
      new THREE.ShaderMaterial({
        uniforms: { ...this.uniforms, uColor: { value: new THREE.Color(color) } },
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
    // Without a GPU the rasterizer shares the CPU with the splat sort: far fewer drops.
    const drops = new THREE.Mesh(
      quads(lowSpec ? 2500 : 9000, [[-1, 0], [1, 0], [-1, 1], [1, 1]]),
      material(DROP_VERTEX, DROP_FRAGMENT, 0xbcccdf),
    );
    this.splashes = new THREE.Mesh(
      quads(lowSpec ? 100 : 350, [[-1, -1], [1, -1], [-1, 1], [1, 1]]),
      material(SPLASH_VERTEX, SPLASH_FRAGMENT, 0xc4d0e0),
    );
    drops.frustumCulled = this.splashes.frustumCulled = false; // placed by the shader, round the camera
    drops.renderOrder = 1; // over the splashes
    this.scene.add(this.splashes, drops);
  }

  /** The viewer's toggle: off means neither seen nor heard. */
  get enabled() {
    return this.on;
  }

  set enabled(on: boolean) {
    this.on = on;
    this.updateSound();
  }

  /** Whether there's any rain to draw this frame. */
  get showing() {
    return this.intensity > 0.01;
  }

  /**
   * Where the player is: out in it (seen and heard; `ground` is the world's collider, which shelters it,
   * along with the level's `boxes`), indoors (heard on the roof) or nowhere (the menu).
   */
  setPlace(place: RainPlace, ground?: THREE.Object3D, boxes: RainShelter[] = []) {
    this.place = place;
    boxes.slice(0, MAX_BOXES).forEach((box, i) => {
      const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), box.yaw);
      this.uniforms.uBoxes.value[i]
        .compose(new THREE.Vector3(...box.center), turn, new THREE.Vector3(...box.size))
        .invert();
    });
    this.uniforms.uBoxCount.value = Math.min(boxes.length, MAX_BOXES);
    const shelter = place === 'outside' && ground ? this.shelterFor(ground) : undefined;
    this.uniforms.uShelter.value = shelter?.target.depthTexture ?? null;
    if (shelter) this.uniforms.uShelterMatrix.value.copy(shelter.matrix);
    this.uniforms.uShelterOn.value = shelter ? 1 : 0;
    this.splashes.visible = !!shelter; // they need the map to find the ground
    if (place !== 'outside') this.intensity = 0; // the door's iris hides the change
    this.updateSound();
  }

  /** Frees a world's shelter map (the world is being unloaded). */
  forget(ground: THREE.Object3D) {
    const shelter = this.shelters.get(ground);
    if (!shelter) return;
    if (this.uniforms.uShelter.value === shelter.target.depthTexture) {
      this.uniforms.uShelter.value = null;
      this.uniforms.uShelterOn.value = 0;
      this.splashes.visible = false;
    }
    shelter.target.depthTexture?.dispose();
    shelter.target.dispose();
    this.shelters.delete(ground);
  }

  update(dt: number, camera: THREE.PerspectiveCamera) {
    const target = this.place === 'outside' && this.on ? 1 : 0;
    this.intensity += (target - this.intensity) * (1 - Math.exp(-dt / FADE_SECONDS));
    if (!this.showing) return;
    const u = this.uniforms;
    this.time = (this.time + dt) % TIME_WRAP;
    u.uTime.value = this.time;
    u.uOpacity.value = this.intensity;
    camera.getWorldPosition(u.uCenter.value);
    // World size of a pixel one metre away, for the streaks' minimum width.
    const height = this.renderer.getDrawingBufferSize(this.bufferSize).y;
    u.uPixel.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / Math.max(1, height);
  }

  /** Out in it, or heard through the cabin's walls (the same level, muffled); silent in the menu. */
  private updateSound() {
    const audible = this.on && this.place !== 'none';
    if (audible) {
      this.sound.start(); // waits for a click or key press if the browser's holding sound back
      this.sound.muffle(this.place === 'inside' ? 1 : 0, 0); // a straight cut: the door's iris covers it
    }
    this.sound.fadeTo(audible ? RAIN_VOLUME : 0);
  }

  /** The collider's depth from straight above, rendered once per world (with a copy sharing its geometry). */
  private shelterFor(ground: THREE.Object3D): Shelter {
    const known = this.shelters.get(ground);
    if (known) return known;

    const occluder = ground.clone();
    occluder.visible = true; // the collider view is normally hidden
    occluder.traverse((object) => {
      if (object instanceof THREE.Mesh) object.material = DEPTH_ONLY;
    });
    ground.updateWorldMatrix(true, false);
    occluder.matrixAutoUpdate = false;
    occluder.matrix.copy(ground.matrixWorld);
    const scene = new THREE.Scene().add(occluder);

    const camera = new THREE.OrthographicCamera(-SHELTER_HALF, SHELTER_HALF, SHELTER_HALF, -SHELTER_HALF, 0, SHELTER_DEPTH);
    camera.position.set(0, SHELTER_TOP, 0);
    camera.rotation.set(-Math.PI / 2, 0, 0); // looking straight down
    camera.updateMatrixWorld();

    const target = new THREE.WebGLRenderTarget(SHELTER_SIZE, SHELTER_SIZE);
    target.depthTexture = new THREE.DepthTexture(SHELTER_SIZE, SHELTER_SIZE);
    const previous = this.renderer.getRenderTarget();
    const autoClear = this.renderer.autoClear;
    this.renderer.autoClear = true;
    this.renderer.setRenderTarget(target);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(previous);
    this.renderer.autoClear = autoClear;

    // Clip space to texture space, as for a shadow map.
    const matrix = new THREE.Matrix4()
      .set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(camera.projectionMatrix)
      .multiply(camera.matrixWorldInverse);
    const shelter = { target, matrix };
    this.shelters.set(ground, shelter);
    return shelter;
  }
}
