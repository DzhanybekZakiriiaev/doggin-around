import * as THREE from 'three';
import { propModel } from './props';

// Storm Night's fire: the branches the player brings in are laid on the cabin's cold grate, and once there
// are enough it lights, catching over a couple of seconds. Comic flames (flat bands of yellow, orange
// and red with a dark rim) drawn as opaque cut-outs, so the painted stones in front of the grate still cover
// them; rising embers, a soft glow, a flickering light for the toon meshes, and a crackle.

const CATCH_SECONDS = 2.6;
const FLAMES = 9;
const EMBERS = 36;

/** Where each branch lands on the grate (it's long along X): two crossed, any more across them. */
const LOG_PLACES: { at: [number, number, number]; yaw: number; roll: number }[] = [
  { at: [0, 0.035, 0.03], yaw: 0.4, roll: 0.04 },
  { at: [0.01, 0.08, -0.02], yaw: -0.45, roll: -0.05 },
  { at: [-0.02, 0.12, 0], yaw: 1.35, roll: 0.08 },
];

const FLAME_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  uniform vec3 uRight;
  attribute vec3 aCorner; // x: side (-1, 1), y: bottom (0) to tip (1), z: this flame's random
  varying vec2 vUv;
  varying float vSeed;

  void main() {
    float seed = aCorner.z;
    float flicker = 0.82 + 0.18 * sin(uTime * (6.0 + seed * 5.0) + seed * 20.0);
    // position: the flame's foot (x, z) and full height (y); it grows with the fire and gets wider.
    float height = position.y * uIntensity * flicker;
    float width = mix(0.13, 0.22, seed) * (0.55 + 0.45 * uIntensity);
    vec3 corner = vec3(position.x, 0.0, position.z) + uRight * aCorner.x * width + vec3(0.0, aCorner.y * height, 0.0);
    vUv = aCorner.xy;
    vSeed = seed;
    gl_Position = uIntensity > 0.02 ? projectionMatrix * modelViewMatrix * vec4(corner, 1.0) : vec4(0.0, 0.0, -2.0, 1.0);
  }`;

const NOISE = /* glsl */ `
  float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }`;

const FLAME_FRAGMENT = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  varying float vSeed;
  ${NOISE}

  void main() {
    float y = vUv.y;
    float licks = noise(vec2(vUv.x * 1.5 + vSeed * 13.0, y * 2.5 - uTime * 3.2));
    float detail = noise(vec2(vUv.x * 3.5 - vSeed * 7.0, y * 6.0 - uTime * 5.5));
    // A tongue: wide and round at the foot, tapering to a tip that sways as it rises.
    float sway = (licks - 0.5) * 0.9 * y;
    float body = pow(1.0 - y, 0.75) * smoothstep(0.0, 0.1, y + 0.03) * (0.72 + 0.28 * detail);
    float inside = body - abs(vUv.x + sway);
    if (inside < 0.0) discard;
    // Flat comic bands from the rim inwards.
    vec3 colour = inside < 0.06 ? vec3(0.42, 0.09, 0.03)
      : inside < 0.24 ? vec3(0.93, 0.28, 0.06)
      : inside < 0.44 ? vec3(1.0, 0.6, 0.12)
      : vec3(1.0, 0.92, 0.55);
    gl_FragColor = vec4(colour, 1.0);
  }`;

const EMBER_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  uniform vec3 uRight;
  uniform vec3 uUp;
  attribute vec3 aCorner; // xy: corner, z: this ember's random
  varying vec2 vUv;
  varying float vHeat;

  void main() {
    float seed = aCorner.z;
    float life = mix(1.1, 2.0, fract(seed * 7.13));
    float t = fract(uTime / life + seed);
    // Up from somewhere on the logs, drifting and wavering, shrinking as it cools.
    vec3 rise = vec3(position.x + sin(t * 6.0 + seed * 30.0) * 0.05, t * mix(0.6, 1.1, position.y), position.z);
    float size = 0.012 * (1.0 - t) * smoothstep(0.25, 0.6, uIntensity);
    vec3 corner = rise + (uRight * aCorner.x + uUp * aCorner.y) * size;
    vUv = aCorner.xy;
    vHeat = 1.0 - t;
    gl_Position = size > 0.0005 ? projectionMatrix * modelViewMatrix * vec4(corner, 1.0) : vec4(0.0, 0.0, -2.0, 1.0);
  }`;

const EMBER_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  varying float vHeat;
  void main() {
    if (dot(vUv, vUv) > 1.0) discard;
    gl_FragColor = vec4(mix(vec3(0.95, 0.3, 0.05), vec3(1.0, 0.85, 0.4), vHeat), 1.0);
  }`;

const GLOW_VERTEX = /* glsl */ `
  uniform vec3 uRight;
  uniform vec3 uUp;
  uniform float uIntensity;
  attribute vec3 aCorner;
  varying vec2 vUv;
  void main() {
    vUv = aCorner.xy;
    vec3 corner = vec3(0.0, 0.3, 0.0) + (uRight * aCorner.x + uUp * aCorner.y) * 0.9;
    gl_Position = uIntensity > 0.02 ? projectionMatrix * modelViewMatrix * vec4(corner, 1.0) : vec4(0.0, 0.0, -2.0, 1.0);
  }`;

const GLOW_FRAGMENT = /* glsl */ `
  uniform float uIntensity;
  uniform float uFlicker;
  varying vec2 vUv;
  void main() {
    float falloff = 1.0 - smoothstep(0.0, 1.0, length(vUv));
    gl_FragColor = vec4(vec3(1.0, 0.55, 0.2) * falloff * falloff * 0.35 * uIntensity * uFlicker, 1.0);
  }`;

/** `count` camera-facing quads: `position` per quad (from `place`), `aCorner` its corner and a random. */
function quads(count: number, corners: [number, number][], place: (i: number) => [number, number, number]) {
  const position = new Float32Array(count * 12);
  const corner = new Float32Array(count * 12);
  const index = new Uint16Array(count * 6);
  for (let i = 0; i < count; i++) {
    const at = place(i);
    const r = Math.random();
    corners.forEach(([x, y], k) => {
      position.set(at, (i * 4 + k) * 3);
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

export class Fire {
  /** On the grate; goes in the cabin world. */
  readonly group = new THREE.Group();
  private readonly logs = new THREE.Group();
  private readonly glowLight = new THREE.PointLight(0xff8a3c, 0, 7, 1.6);
  private readonly sound = new CrackleSound();
  private readonly uniforms = {
    uTime: { value: 0 },
    uIntensity: { value: 0 },
    uFlicker: { value: 1 },
    uRight: { value: new THREE.Vector3(1, 0, 0) },
    uUp: { value: new THREE.Vector3(0, 1, 0) },
  };
  private burning = false;
  private heat = 0;
  private audible = false;

  /** `logsNeeded`: how many branches make a fire. */
  constructor(
    at: THREE.Vector3,
    private readonly logsNeeded: number,
  ) {
    this.group.position.copy(at);
    const material = (vertexShader: string, fragmentShader: string, additive = false) =>
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader,
        fragmentShader,
        side: THREE.DoubleSide,
        ...(additive && { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
      });
    const flames = new THREE.Mesh(
      quads(FLAMES, [[-1, 0], [1, 0], [-1, 1], [1, 1]], (i) => {
        const across = FLAMES > 1 ? i / (FLAMES - 1) - 0.5 : 0;
        // Taller in the middle of the pile, lower towards its ends.
        return [across * 0.54 + (Math.random() - 0.5) * 0.05, 0.82 - Math.abs(across) * 0.7 + Math.random() * 0.14, (Math.random() - 0.5) * 0.14];
      }),
      material(FLAME_VERTEX, FLAME_FRAGMENT),
    );
    const embers = new THREE.Mesh(
      quads(EMBERS, [[-1, -1], [1, -1], [-1, 1], [1, 1]], () => [(Math.random() - 0.5) * 0.4, Math.random(), (Math.random() - 0.5) * 0.15]),
      material(EMBER_VERTEX, EMBER_FRAGMENT),
    );
    const glow = new THREE.Mesh(quads(1, [[-1, -1], [1, -1], [-1, 1], [1, 1]], () => [0, 0, 0]), material(GLOW_VERTEX, GLOW_FRAGMENT, true));
    glow.renderOrder = 10; // over the splats round the fireplace, as light
    for (const mesh of [flames, embers, glow]) mesh.frustumCulled = false; // placed by their shaders
    this.glowLight.position.set(0, 0.4, 0.35);
    this.group.add(this.logs, flames, embers, glow, this.glowLight);
  }

  get logCount() {
    return this.logs.children.length;
  }

  /** How far the fire has caught, 0 (cold) to 1. */
  get intensity() {
    return this.heat;
  }

  get lit() {
    return this.burning;
  }

  /** Lays another branch on the grate; returns how many are there now. */
  addLog() {
    const place = LOG_PLACES[this.logs.children.length % LOG_PLACES.length];
    const log = propModel('branch');
    log.position.set(...place.at);
    log.rotation.set(0, place.yaw, place.roll);
    this.logs.add(log);
    return this.logs.children.length;
  }

  get ready() {
    return this.logCount >= this.logsNeeded;
  }

  /** Lights it: it catches over a couple of seconds. */
  light() {
    this.burning = true;
    this.updateSound();
  }

  /** Back to a cold, empty grate. */
  reset() {
    this.burning = false;
    this.heat = 0;
    this.logs.clear();
    this.updateSound();
  }

  /** Heard only while the player is in the cabin. */
  setAudible(on: boolean) {
    this.audible = on;
    this.updateSound();
  }

  update(dt: number, camera: THREE.Camera) {
    if (this.burning) this.heat = Math.min(1, this.heat + dt / CATCH_SECONDS);
    const u = this.uniforms;
    u.uTime.value = (u.uTime.value + dt) % 600;
    u.uIntensity.value = THREE.MathUtils.smoothstep(this.heat, 0, 1);
    const flicker = 0.85 + 0.1 * Math.sin(u.uTime.value * 13.7) + 0.05 * Math.sin(u.uTime.value * 31.3);
    u.uFlicker.value = flicker;
    this.glowLight.intensity = 7 * u.uIntensity.value * flicker;
    // Face the camera: flames turn about the vertical only, embers and glow fully.
    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements;
    u.uRight.value.set(e[0], 0, e[2]).normalize();
    u.uUp.value.set(e[4], e[5], e[6]).normalize();
    this.sound.setLevel(this.audible ? 0.22 * u.uIntensity.value : 0);
  }

  private updateSound() {
    if (!this.burning || !this.audible) this.sound.setLevel(0);
  }
}

/** Crackling: a low roar with pops and snaps, made on the spot and looped. */
class CrackleSound {
  private context?: AudioContext;
  private gain?: GainNode;
  private level = 0;

  setLevel(level: number) {
    if (Math.abs(level - this.level) < 0.005) return;
    this.level = level;
    if (level > 0) this.start();
    if (!this.context || !this.gain) return;
    this.gain.gain.setTargetAtTime(level, this.context.currentTime, 0.3);
    if (level > 0 && this.context.state === 'suspended') void this.context.resume().catch(() => {});
  }

  private start() {
    if (this.context) return;
    let context: AudioContext;
    try {
      context = new AudioContext();
    } catch {
      return;
    }
    const rate = context.sampleRate;
    const length = rate * 4;
    const buffer = context.createBuffer(1, length, rate);
    const data = buffer.getChannelData(0);
    let roar = 0;
    let pop = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      roar = 0.985 * roar + 0.015 * white; // brown-ish rumble
      if (Math.random() < 14 / rate) pop = 0.5 + Math.random() * 0.5; // a snap now and then
      pop *= 0.992;
      data[i] = roar * 1.6 + white * pop * 0.5;
    }
    // Fade the loop's ends into each other so it doesn't click as it wraps.
    const seam = Math.round(rate * 0.05);
    for (let i = 0; i < seam; i++) {
      const k = i / seam;
      data[i] = data[i] * k + data[length - seam + i] * (1 - k);
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = context.createGain();
    gain.gain.value = 0;
    source.connect(gain).connect(context.destination);
    source.start();
    this.context = context;
    this.gain = gain;
  }
}
