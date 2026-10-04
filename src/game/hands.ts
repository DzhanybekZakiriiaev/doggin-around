import { SparkRenderer, type SplatMesh } from '@sparkjsdev/spark';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { type Mood, MoodLights } from './lighting';
import { WALK_SPEED } from './player';
import type { Grip } from './props';
import { Matcap, rigidSplats, SkinnedSplats } from './splat-hands';
import { outlineMaterial } from './toon';

// First-person hands, rendered as a separate layer over the world so they never clip into walls.
// Shape: the rigged WebXR generic hand (MIT, @webxr-input-profiles/assets). Look: matcaps painted by
// Gemini from a reference of these hands in the cabin's illustration style (npm run hands-style). Drawn
// either as Gaussian splats coloured from those matcaps (the default, to sit with the splat world; see
// splat-hands.ts) or as the inked mesh. Poses and actions are procedural, driving the finger joints directly.

const HAND_MODEL = '/models/hands/right.glb';
const SKIN_MATCAP = '/textures/hands/skin.png';
const SLEEVE_MATCAP = '/textures/hands/sleeve.png';
const OUTLINE = 0.0012;
const INK = 0x1a0f0c;

/** A hand pose in camera space (metres / radians). The left hand mirrors the right. */
interface Pose {
  x: number;
  y: number;
  z: number;
  rx: number; // pitch: positive tips the fingers up
  ry: number; // yaw: positive points the fingers towards the centre of the screen
  rz: number; // roll: negative turns the thumb up, about -1.6 is a "handshake" hand, about 3 palm up
  curl: number; // 0 open hand .. 1 fist
  thumb: number; // 0 open .. 1 tucked
  wrist: number; // bends the hand up (+) at the wrist; the forearm stays put
  point: number; // 0 .. 1 straightens the index finger out of the curl
}

const REST: Pose = { x: 0.15, y: -0.15, z: -0.36, rx: 0.32, ry: 0.3, rz: -0.3, curl: 0.3, thumb: 0.3, wrist: 0, point: 0 };
/** The right hand while carrying something: a loose fist, thumb up, a little higher. */
const HOLD: Pose = { x: 0.17, y: -0.16, z: -0.38, rx: 0.25, ry: 0.35, rz: -1.1, curl: 0.85, thumb: 0.75, wrist: 0, point: 0 };
/** Carrying something small (the key) between finger and thumb, held up a little where it can be seen. */
const PINCH: Pose = { x: 0.15, y: -0.12, z: -0.4, rx: 0.45, ry: 0.3, rz: -1.1, curl: 0.8, thumb: 0.72, wrist: 0, point: 0 };
/** The left hand lowered out of view (it is mirrored, so +x moves it outwards). */
const LEFT_LOWERED: Pose = { ...REST, x: 0.2, y: -0.26, z: -0.32, rx: 0.1 };
/** Palm flat and down, over something at arm's length (a dog's back, later). */
const PET: Pose = { x: 0.07, y: -0.165, z: -0.46, rx: -0.25, ry: 0.7, rz: -0.15, curl: 0.15, thumb: 0.25, wrist: 0.15, point: 0 };
/** How far the grip (middle of the palm) sits in front of the wrist. */
const GRIP_OFFSET = 0.085;
/** Where the right shoulder is, in camera space: the sleeve always runs from the wrist towards it. */
const SHOULDER = new THREE.Vector3(0.24, -0.42, 0.1);
const SLEEVE_FORWARD = new THREE.Vector3(0, 0, 1);
const HAND_SCALE = 1.12; // a touch larger than life, as first-person hands usually are

interface Keyframe {
  t: number;
  /** Missing fields come from the hand's base pose (rest, or holding), so actions start and end there. */
  pose: Partial<Pose>;
  /** When the action is aimed at something, the wrist goes to the target plus this offset instead of pose x/y/z. */
  reach?: [number, number, number];
}
interface Action {
  label: string;
  duration: number;
  right?: Keyframe[];
  left?: Keyframe[];
  /** Named moments, in seconds; `play` callers hook these (grab, release, swing…). */
  events: Record<string, number>;
}

// Keyframe poses for both hands are written in right-hand terms; the left hand is mirrored.
const DOOR_GRIP = { rx: 0.05, ry: 0.1, rz: -1.35 };
// Palms pressed together, fingers up and forward (turned in, they crossed through each other).
const RUB = { x: 0.055, rx: 0.7, ry: 0.1, rz: -1.55, curl: 0.15, thumb: 0.2 };
const WARM = { x: 0.11, y: -0.1, z: -0.45, rx: 0.15, ry: 0.2, rz: -0.15, curl: 0.05, thumb: 0.05, wrist: 1.15 };
const WAVE = { x: 0.17, y: -0.02, z: -0.42, rx: 0.3, ry: 0.1, curl: 0.05, thumb: 0.1, wrist: 1.2 };
const BECKON = { x: 0.12, y: -0.12, z: -0.42, rx: 0.35, ry: 0.25, rz: 2.6, thumb: 0.2 };
const WIPE = { y: -0.05, z: -0.24, rx: 1.45, ry: 0, rz: 3.0, curl: 0.15, thumb: 0.2 };

const ACTIONS = {
  openDoor: {
    label: 'Open door (push)',
    duration: 1.3,
    right: [
      { t: 0, pose: {} },
      { t: 0.28, reach: [0, 0, 0.03], pose: { x: 0.07, y: -0.1, z: -0.45, ...DOOR_GRIP, curl: 0.15, thumb: 0.1 } },
      { t: 0.38, reach: [0, 0, 0], pose: { x: 0.07, y: -0.1, z: -0.47, ...DOOR_GRIP, curl: 0.85, thumb: 0.8 } },
      { t: 0.52, reach: [0, 0, 0], pose: { x: 0.07, y: -0.1, z: -0.47, ...DOOR_GRIP, rz: -1.9, curl: 0.85, thumb: 0.8 } },
      { t: 0.62, reach: [0, 0.01, 0.02], pose: { x: 0.07, y: -0.09, z: -0.45, rx: 0.1, ry: 0.1, rz: -1.3, curl: 0.2, thumb: 0.2, wrist: 0.2 } },
      // The forearm stays level while the wrist bends back, so the palm meets the door.
      { t: 0.85, reach: [-0.05, 0.05, -0.1], pose: { x: 0.03, y: -0.05, z: -0.56, rx: 0.1, ry: 0.05, rz: -0.1, curl: 0.05, thumb: 0.05, wrist: 1.25 } },
      { t: 1.3, pose: {} },
    ],
    left: [
      { t: 0, pose: {} },
      { t: 0.5, pose: { y: -0.22, z: -0.42, curl: 0.5 } },
      { t: 1.3, pose: {} },
    ],
    events: { grab: 0.36, swing: 0.72 },
  },
  pullDoor: {
    label: 'Open door (pull)',
    duration: 1.4,
    right: [
      { t: 0, pose: {} },
      { t: 0.28, reach: [0, 0, 0.03], pose: { x: 0.04, y: -0.1, z: -0.45, ...DOOR_GRIP, curl: 0.15, thumb: 0.1 } },
      { t: 0.38, reach: [0, 0, 0], pose: { x: 0.04, y: -0.1, z: -0.47, ...DOOR_GRIP, curl: 0.85, thumb: 0.8 } },
      { t: 0.52, reach: [0, 0, 0], pose: { x: 0.04, y: -0.1, z: -0.47, ...DOOR_GRIP, rz: -1.9, curl: 0.85, thumb: 0.8 } },
      // Haul it back towards the body, still gripping, then let go as it swings past.
      { t: 0.82, reach: [0.04, -0.02, 0.16], pose: { x: 0.08, y: -0.12, z: -0.31, rx: 0.1, ry: 0.2, rz: -1.7, curl: 0.85, thumb: 0.8 } },
      { t: 1.0, reach: [0.06, -0.03, 0.18], pose: { x: 0.1, y: -0.13, z: -0.29, rx: 0.2, ry: 0.25, rz: -1.1, curl: 0.15, thumb: 0.15, wrist: 0.2 } },
      { t: 1.4, pose: {} },
    ],
    left: [
      { t: 0, pose: {} },
      { t: 0.6, pose: { y: -0.21, z: -0.4, curl: 0.5 } },
      { t: 1.4, pose: {} },
    ],
    events: { grab: 0.36, swing: 0.6 },
  },
  /** Reach down, close the hand round it, bring it up to carry. Hook `grab` to attach the item. */
  pickUp: {
    label: 'Pick up',
    duration: 0.85,
    right: [
      { t: 0, pose: {} },
      { t: 0.32, reach: [0, 0.02, 0.02], pose: { x: 0.06, y: -0.3, z: -0.42, rx: -0.6, ry: 0.15, rz: -0.4, curl: 0.1, thumb: 0.1, wrist: -0.2 } },
      { t: 0.44, reach: [0, 0, 0], pose: { x: 0.06, y: -0.3, z: -0.42, rx: -0.6, ry: 0.15, rz: -0.4, curl: 0.9, thumb: 0.8, wrist: -0.2 } },
      { t: 0.85, pose: {} },
    ],
    events: { grab: 0.42 },
  },
  /** Wind up over the shoulder and fling. Hook `release` to launch the item. */
  throw: {
    label: 'Throw',
    duration: 0.95,
    right: [
      { t: 0, pose: {} },
      { t: 0.25, pose: { x: 0.2, y: -0.02, z: -0.22, rx: 0.9, ry: 0.2, rz: -1.1, curl: 0.9, thumb: 0.8, wrist: -0.3 } },
      { t: 0.38, pose: { x: 0.08, y: -0.04, z: -0.55, rx: -0.2, ry: 0.3, rz: -1.0, curl: 0.9, thumb: 0.8, wrist: 0.4 } },
      { t: 0.48, pose: { x: 0.05, y: -0.12, z: -0.58, rx: -0.5, ry: 0.3, rz: -0.6, curl: 0.1, thumb: 0.1, wrist: 0.2 } },
      { t: 0.95, pose: {} },
    ],
    events: { release: 0.38 },
  },
  /** Lower the item and open the hand. Hook `release` to put it down. */
  drop: {
    label: 'Put down',
    duration: 0.85,
    right: [
      { t: 0, pose: {} },
      { t: 0.35, reach: [0, 0.02, 0], pose: { x: 0.08, y: -0.3, z: -0.45, rx: -0.5, ry: 0.15, rz: -0.8, curl: 0.85, thumb: 0.75 } },
      { t: 0.45, reach: [0, 0.02, 0], pose: { x: 0.08, y: -0.3, z: -0.45, rx: -0.5, ry: 0.15, rz: -0.8, curl: 0.1, thumb: 0.1 } },
      { t: 0.85, pose: {} },
    ],
    events: { release: 0.42 },
  },
  /** "Over there!" Index finger out at the target, held for a beat. */
  point: {
    label: 'Point ("over there!")',
    duration: 1.15,
    right: [
      { t: 0, pose: {} },
      { t: 0.25, reach: [0, 0, 0.04], pose: { x: 0.1, y: -0.08, z: -0.5, rx: 0.15, ry: 0.1, rz: -0.6, curl: 0.9, thumb: 0.8, point: 1 } },
      { t: 0.85, reach: [0, 0, 0.04], pose: { x: 0.1, y: -0.08, z: -0.5, rx: 0.15, ry: 0.1, rz: -0.6, curl: 0.9, thumb: 0.8, point: 1 } },
      { t: 1.15, pose: {} },
    ],
    events: { pointed: 0.25 },
  },
  /** "Come here!" Palm up, fingers curling in twice. */
  beckon: {
    label: 'Beckon ("come here!")',
    duration: 1.2,
    right: [
      { t: 0, pose: {} },
      { t: 0.25, pose: { ...BECKON, curl: 0.1 } },
      { t: 0.42, pose: { ...BECKON, curl: 0.85 } },
      { t: 0.58, pose: { ...BECKON, curl: 0.1 } },
      { t: 0.74, pose: { ...BECKON, curl: 0.85 } },
      { t: 0.9, pose: { ...BECKON, curl: 0.15 } },
      { t: 1.2, pose: {} },
    ],
    events: { called: 0.42 },
  },
  /** "Up here!" Two pats on a surface (the couch). */
  pat: {
    label: 'Pat the couch ("up!")',
    duration: 0.9,
    right: [
      { t: 0, pose: {} },
      { t: 0.25, reach: [0, 0.06, 0], pose: { x: 0.08, y: -0.16, z: -0.5, rx: -0.2, ry: 0.15, rz: -0.2, curl: 0.1, thumb: 0.15, wrist: 0.1 } },
      { t: 0.35, reach: [0, 0, 0], pose: { x: 0.08, y: -0.22, z: -0.5, rx: -0.2, ry: 0.15, rz: -0.2, curl: 0.1, thumb: 0.15, wrist: 0.1 } },
      { t: 0.45, reach: [0, 0.06, 0], pose: { x: 0.08, y: -0.16, z: -0.5, rx: -0.2, ry: 0.15, rz: -0.2, curl: 0.1, thumb: 0.15, wrist: 0.1 } },
      { t: 0.55, reach: [0, 0, 0], pose: { x: 0.08, y: -0.22, z: -0.5, rx: -0.2, ry: 0.15, rz: -0.2, curl: 0.1, thumb: 0.15, wrist: 0.1 } },
      { t: 0.9, pose: {} },
    ],
    events: { pat: 0.35, pat2: 0.55 },
  },
  /**
   * Key in the lock: reach it to the keyhole, push it in, turn it, let go (it stays in the lock). Hook
   * `turned` to leave the key in the door.
   */
  unlock: {
    label: 'Unlock with the key',
    duration: 1.55,
    right: [
      { t: 0, pose: {} },
      { t: 0.38, reach: [0, 0, 0.07], pose: { x: 0.08, y: -0.09, z: -0.44, rx: 0.05, ry: 0.1, rz: -0.9, curl: 0.62, thumb: 0.6 } },
      { t: 0.58, reach: [0, 0, 0.015], pose: { x: 0.08, y: -0.09, z: -0.47, rx: 0.05, ry: 0.1, rz: -0.9, curl: 0.62, thumb: 0.6 } },
      { t: 0.92, reach: [0, 0, 0.015], pose: { x: 0.08, y: -0.09, z: -0.47, rx: 0.05, ry: 0.1, rz: 0.45, curl: 0.62, thumb: 0.6 } },
      { t: 1.08, reach: [0, 0, 0.015], pose: { x: 0.08, y: -0.09, z: -0.47, rx: 0.05, ry: 0.1, rz: 0.45, curl: 0.62, thumb: 0.6 } },
      { t: 1.2, reach: [0.01, -0.01, 0.06], pose: { x: 0.09, y: -0.1, z: -0.43, rx: 0.1, ry: 0.15, rz: 0.2, curl: 0.15, thumb: 0.15 } },
      { t: 1.55, pose: {} },
    ],
    events: { inserted: 0.58, turned: 0.95 },
  },
  /** Grip the door bolt and slide it home. */
  slideBolt: {
    label: 'Slide the bolt',
    duration: 1.15,
    right: [
      { t: 0, pose: {} },
      { t: 0.28, reach: [0, 0, 0.02], pose: { x: 0.1, y: -0.08, z: -0.45, rx: 0.05, ry: 0.1, rz: -0.25, curl: 0.2, thumb: 0.15 } },
      { t: 0.38, reach: [0, 0, 0], pose: { x: 0.1, y: -0.08, z: -0.47, rx: 0.05, ry: 0.1, rz: -0.25, curl: 0.85, thumb: 0.7 } },
      { t: 0.7, reach: [-0.14, 0, 0], pose: { x: -0.04, y: -0.08, z: -0.47, rx: 0.05, ry: 0.1, rz: -0.25, curl: 0.85, thumb: 0.7 } },
      { t: 0.8, reach: [-0.14, 0.01, 0.02], pose: { x: -0.04, y: -0.07, z: -0.45, rx: 0.1, ry: 0.1, rz: -0.25, curl: 0.2, thumb: 0.2 } },
      { t: 1.15, pose: {} },
    ],
    events: { grab: 0.36, slide: 0.5, slid: 0.7 },
  },
  /** Rub cold hands together. */
  rubHands: {
    label: 'Rub hands (cold)',
    duration: 1.6,
    right: [
      { t: 0, pose: {} },
      { t: 0.3, pose: { ...RUB, y: -0.17, z: -0.34 } },
      { t: 0.45, pose: { ...RUB, y: -0.15, z: -0.35 } },
      { t: 0.6, pose: { ...RUB, y: -0.19, z: -0.33 } },
      { t: 0.75, pose: { ...RUB, y: -0.15, z: -0.35 } },
      { t: 0.9, pose: { ...RUB, y: -0.19, z: -0.33 } },
      { t: 1.05, pose: { ...RUB, y: -0.15, z: -0.35 } },
      { t: 1.25, pose: { ...RUB, y: -0.17, z: -0.34 } },
      { t: 1.6, pose: {} },
    ],
    left: [
      { t: 0, pose: {} },
      { t: 0.3, pose: { ...RUB, y: -0.17, z: -0.34 } },
      { t: 0.45, pose: { ...RUB, y: -0.19, z: -0.33 } },
      { t: 0.6, pose: { ...RUB, y: -0.15, z: -0.35 } },
      { t: 0.75, pose: { ...RUB, y: -0.19, z: -0.33 } },
      { t: 0.9, pose: { ...RUB, y: -0.15, z: -0.35 } },
      { t: 1.05, pose: { ...RUB, y: -0.19, z: -0.33 } },
      { t: 1.25, pose: { ...RUB, y: -0.17, z: -0.34 } },
      { t: 1.6, pose: {} },
    ],
    events: {},
  },
  /** Both palms out to the fire. */
  warmHands: {
    label: 'Warm hands (fire)',
    duration: 2.2,
    right: [
      { t: 0, pose: {} },
      { t: 0.45, pose: WARM },
      { t: 1.1, pose: { ...WARM, curl: 0.15, y: -0.095 } },
      { t: 1.8, pose: WARM },
      { t: 2.2, pose: {} },
    ],
    left: [
      { t: 0, pose: {} },
      { t: 0.5, pose: WARM },
      { t: 1.2, pose: { ...WARM, curl: 0.15, y: -0.105 } },
      { t: 1.85, pose: WARM },
      { t: 2.2, pose: {} },
    ],
    events: {},
  },
  wave: {
    label: 'Wave',
    duration: 1.15,
    right: [
      { t: 0, pose: {} },
      { t: 0.25, pose: { ...WAVE, rz: 0.1 } },
      { t: 0.4, pose: { ...WAVE, rz: -0.35 } },
      { t: 0.55, pose: { ...WAVE, rz: 0.25 } },
      { t: 0.7, pose: { ...WAVE, rz: -0.35 } },
      { t: 0.85, pose: { ...WAVE, rz: 0.1 } },
      { t: 1.15, pose: {} },
    ],
    events: {},
  },
  /** Two knocks with the knuckles. */
  knock: {
    label: 'Knock',
    duration: 0.85,
    right: [
      { t: 0, pose: {} },
      { t: 0.25, reach: [0, 0, 0.06], pose: { x: 0.08, y: -0.06, z: -0.4, rx: 0.2, ry: 0.1, rz: -1.45, curl: 0.95, thumb: 0.8, wrist: 0.15 } },
      { t: 0.33, reach: [0, 0, 0], pose: { x: 0.08, y: -0.06, z: -0.46, rx: 0.2, ry: 0.1, rz: -1.45, curl: 0.95, thumb: 0.8, wrist: 0.15 } },
      { t: 0.42, reach: [0, 0, 0.06], pose: { x: 0.08, y: -0.06, z: -0.4, rx: 0.2, ry: 0.1, rz: -1.45, curl: 0.95, thumb: 0.8, wrist: 0.15 } },
      { t: 0.5, reach: [0, 0, 0], pose: { x: 0.08, y: -0.06, z: -0.46, rx: 0.2, ry: 0.1, rz: -1.45, curl: 0.95, thumb: 0.8, wrist: 0.15 } },
      { t: 0.85, pose: {} },
    ],
    events: { knock: 0.33, knock2: 0.5 },
  },
  /** Wipe mud off your face: palm to the camera, swept across the view. */
  wipe: {
    label: 'Wipe mud off',
    duration: 0.95,
    right: [
      { t: 0, pose: {} },
      { t: 0.2, pose: { ...WIPE, x: 0.24 } },
      { t: 0.5, pose: { ...WIPE, x: -0.12 } },
      { t: 0.65, pose: { ...WIPE, x: -0.1, y: -0.12 } },
      { t: 0.95, pose: {} },
    ],
    events: { wiped: 0.45 },
  },
  /** A quick generic reach-and-grab, no carrying. */
  grab: {
    label: 'Grab',
    duration: 0.8,
    right: [
      { t: 0, pose: {} },
      { t: 0.3, reach: [0, 0, 0.02], pose: { x: 0.1, y: -0.2, z: -0.5, rx: -0.4, ry: 0.2, rz: -0.9, curl: 0.1, thumb: 0.1 } },
      { t: 0.42, reach: [0, 0, 0], pose: { x: 0.1, y: -0.2, z: -0.5, rx: -0.4, ry: 0.2, rz: -0.9, curl: 0.95, thumb: 0.9 } },
      { t: 0.8, pose: {} },
    ],
    events: { grab: 0.4 },
  },
} satisfies Record<string, Action>;

export type HandAction = keyof typeof ACTIONS;
/** Every action with its label, for menus. */
export const HAND_ACTIONS = Object.entries(ACTIONS).map(([name, action]) => ({ name: name as HandAction, label: action.label }));

const FINGERS = ['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'];
const FINGER_JOINTS = ['metacarpal', 'phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'];
const THUMB_JOINTS = ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'];

/** A joint chain from the flat WebXR skeleton, with its bind pose split into parent-relative steps. */
class Chain {
  private readonly bindPosition: THREE.Vector3;
  private readonly bindRotation: THREE.Quaternion;
  private readonly offsets: THREE.Vector3[] = [];
  private readonly turns: THREE.Quaternion[] = [];

  constructor(private readonly bones: THREE.Bone[]) {
    this.bindPosition = bones[0].position.clone();
    this.bindRotation = bones[0].quaternion.clone();
    for (let i = 1; i < bones.length; i++) {
      const parentInverse = bones[i - 1].quaternion.clone().invert();
      this.offsets.push(bones[i].position.clone().sub(bones[i - 1].position).applyQuaternion(parentInverse));
      this.turns.push(parentInverse.multiply(bones[i].quaternion));
    }
  }

  /** Bends each joint about its local X axis (negative curls towards the palm) and re-places the chain. */
  pose(bends: number[]) {
    const bend = new THREE.Quaternion();
    const axis = new THREE.Vector3(1, 0, 0);
    const position = this.bindPosition.clone();
    const rotation = this.bindRotation.clone().multiply(bend.setFromAxisAngle(axis, bends[0] ?? 0));
    this.bones[0].position.copy(position);
    this.bones[0].quaternion.copy(rotation);
    for (let i = 1; i < this.bones.length; i++) {
      position.add(this.offsets[i - 1].clone().applyQuaternion(rotation));
      rotation.multiply(this.turns[i - 1]).multiply(bend.setFromAxisAngle(axis, bends[i] ?? 0));
      this.bones[i].position.copy(position);
      this.bones[i].quaternion.copy(rotation);
    }
  }
}

interface Rig {
  root: THREE.Group;
  /** Separate from `root`: it follows the wrist but points at the shoulder, never into the camera. */
  sleeve: THREE.Group;
  /** The inked mesh look (hand, outline, sleeve parts); hidden when drawn as splats. */
  meshes: THREE.Mesh[];
  wrist: THREE.Group;
  /** Where a held item sits: the middle of the palm, long axis across the hand (X). */
  socket: THREE.Group;
  fingers: Chain[];
  thumb: Chain;
}

type Motion = { speed: number; grounded: boolean; yawVelocity: number; pitchVelocity: number };

export class FirstPersonHands {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.01, 10);
  visible = true;
  /** Resolves once the model and textures are loaded. */
  readonly ready: Promise<void>;

  private right?: Rig;
  private left?: Rig;
  private readonly materials: THREE.MeshMatcapMaterial[] = [];
  private readonly skins: SkinnedSplats[] = [];
  private readonly splatMeshes: SplatMesh[] = [];
  private splatLook = true;
  private readonly tint = new THREE.Color(0xffffff);
  /** The hands carry painted light (matcaps), but held toon props need real lights, matched to the world. */
  private readonly lights = new MoodLights();

  private time = 0;
  private stepPhase = 0;
  private readonly sway = new THREE.Vector2();
  private airborne = 0;
  private action?: { spec: Action; time: number; fired: Set<string>; listeners: Map<string, () => void>; done: () => void };
  private held?: THREE.Object3D;
  private holdPose = HOLD;
  private readonly petting = { active: false, weight: 0, phase: 0, speed: 0.8, target: undefined as THREE.Vector3 | undefined };

  /** With `renderer`, the hands can be drawn as Gaussian splats (they need their own SparkRenderer in this scene). */
  constructor(private readonly renderer?: THREE.WebGLRenderer) {
    this.scene.add(this.lights);
    if (renderer) this.scene.add(new SparkRenderer({ renderer, covSplats: true, accumExtSplats: true }));
    else this.splatLook = false;
    this.ready = this.load();
  }

  private async load() {
    const textures = new THREE.TextureLoader();
    const [gltf, skinMatcap, sleeveMatcap] = await Promise.all([
      new GLTFLoader().loadAsync(HAND_MODEL),
      textures.loadAsync(SKIN_MATCAP),
      textures.loadAsync(SLEEVE_MATCAP),
    ]);
    skinMatcap.colorSpace = sleeveMatcap.colorSpace = THREE.SRGBColorSpace;
    const skin = new THREE.MeshMatcapMaterial({ matcap: skinMatcap, color: this.tint });
    const sleeve = new THREE.MeshMatcapMaterial({ matcap: sleeveMatcap, color: this.tint });
    this.materials.push(skin, sleeve);

    const leftModel = SkeletonUtils.clone(gltf.scene); // clone before rigging adds outline meshes
    this.right = buildRig(gltf.scene, skin, sleeve);
    this.left = buildRig(leftModel, skin, sleeve);
    const mirror = new THREE.Group();
    mirror.scale.x = -1;
    mirror.add(this.left.root, this.left.sleeve);
    this.scene.add(this.right.root, this.right.sleeve, mirror);

    if (this.renderer) {
      // Bake the splats with the hands at rest, where the matcap light was painted for.
      applyPose(this.right, REST);
      applyPose(this.left, REST);
      this.scene.updateMatrixWorld(true);
      const skinLight = new Matcap(skinMatcap);
      const sleeveLight = new Matcap(sleeveMatcap);
      const along = new THREE.Vector3(0, 0, 1); // sleeve strokes run down the arm
      for (const [rig, seed] of [[this.right, 11], [this.left, 23]] as const) {
        const hand = rig.meshes.find((mesh): mesh is THREE.SkinnedMesh => mesh instanceof THREE.SkinnedMesh && mesh.material === skin);
        if (hand) this.skins.push(await SkinnedSplats.create(hand, skinLight, seed));
        const sleeveParts = rig.meshes.filter((mesh) => mesh.parent === rig.sleeve && mesh.material === sleeve);
        this.splatMeshes.push(await rigidSplats(rig.sleeve, sleeveParts, sleeveLight, seed + 1, along));
      }
      this.splatMeshes.push(...this.skins.map((part) => part.splats));
      for (const splats of this.splatMeshes) splats.recolor.copy(this.tint);
    }
    this.showLook();
  }

  /** Gaussian splats (true) or the inked mesh (false). */
  get splats() {
    return this.splatLook;
  }

  set splats(on: boolean) {
    this.splatLook = on && !!this.renderer;
    this.showLook();
  }

  private showLook() {
    const splats = this.splatLook && this.splatMeshes.length > 0;
    for (const rig of [this.right, this.left]) for (const mesh of rig?.meshes ?? []) mesh.visible = !splats;
    for (const mesh of this.splatMeshes) mesh.visible = splats;
  }

  /** Tint the painted light to match the world: the matcaps are painted in the cabin's lamplight. */
  setMood(mood: Mood) {
    this.tint.set(mood === 'indoor' ? 0xffffff : 0xdfe5f5); // dusk: a little cooler and darker
    for (const material of this.materials) material.color.copy(this.tint);
    for (const splats of this.splatMeshes) splats.recolor.copy(this.tint);
    this.lights.setMood(mood);
  }

  get busy() {
    return this.action !== undefined;
  }

  /**
   * Plays an action. `on` callbacks fire at the action's named moments (e.g. `swing` when the palm
   * meets the door); the promise resolves when the hands are back at their base pose. With `target`
   * (from `aimAt`), reaching keyframes go to it instead of their default spot.
   */
  play(name: HandAction, on: Record<string, () => void> = {}, target?: THREE.Vector3): Promise<void> {
    this.action?.done();
    const spec: Action = ACTIONS[name];
    const aimed = (frames?: Keyframe[]) =>
      frames?.map((frame) =>
        target && frame.reach
          ? { ...frame, pose: { ...frame.pose, x: target.x + frame.reach[0], y: target.y + frame.reach[1], z: target.z + frame.reach[2] } }
          : frame,
      );
    return new Promise((resolve) => {
      this.action = {
        spec: { ...spec, right: aimed(spec.right), left: aimed(spec.left) },
        time: 0,
        fired: new Set(),
        listeners: new Map(Object.entries(on)),
        done: resolve,
      };
    });
  }

  /**
   * Where the right wrist should go to reach a point seen by the world camera: the same spot on screen,
   * at arm's length in the hands' own space (it has a different field of view).
   */
  aimAt(point: THREE.Vector3, worldCamera: THREE.PerspectiveCamera): THREE.Vector3 {
    worldCamera.updateMatrixWorld();
    const view = point.clone().applyMatrix4(worldCamera.matrixWorldInverse);
    const worldTan = Math.tan(THREE.MathUtils.degToRad(worldCamera.fov / 2));
    const handTan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const depth = 0.48;
    const ndcX = view.x / -view.z / (worldTan * worldCamera.aspect);
    const ndcY = view.y / -view.z / worldTan;
    return new THREE.Vector3(
      THREE.MathUtils.clamp(ndcX * handTan * this.camera.aspect * depth, -0.2, 0.3),
      THREE.MathUtils.clamp(ndcY * handTan * depth, -0.3, 0.15),
      -depth + GRIP_OFFSET,
    );
  }

  // ---------- Carrying ----------

  get holding(): THREE.Object3D | undefined {
    return this.held;
  }

  /** Puts an item (built in hand space, long axis along X) in the right palm, in a fist or between finger and thumb. */
  hold(item: THREE.Object3D, grip: Grip = 'fist') {
    this.release();
    this.held = item;
    this.holdPose = grip === 'pinch' ? PINCH : HOLD;
    this.right?.socket.add(item);
  }

  /** Takes the item out of the hand. */
  release(): THREE.Object3D | undefined {
    const item = this.held;
    item?.removeFromParent();
    this.held = undefined;
    return item;
  }

  /** The palm's position in the world, for launching or placing whatever it held. */
  palmInWorld(worldCamera: THREE.Camera): THREE.Vector3 {
    const palm = new THREE.Vector3();
    this.right?.socket.getWorldPosition(palm); // hand space, which shares the world camera's orientation
    worldCamera.updateMatrixWorld();
    return palm.applyMatrix4(worldCamera.matrixWorld);
  }

  // ---------- Petting ----------

  /**
   * Starts stroking: palm down, moving back and forth at `strokesPerSecond`. Slow strokes read as
   * gentle, fast ones as frantic (the lie-down quest cares). `target` comes from `aimAt`.
   */
  startPetting(strokesPerSecond = 0.8, target?: THREE.Vector3) {
    this.petting.active = true;
    this.petting.speed = strokesPerSecond;
    this.petting.target = target;
  }

  setPetSpeed(strokesPerSecond: number) {
    this.petting.speed = strokesPerSecond;
  }

  stopPetting() {
    this.petting.active = false;
  }

  setAspect(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number, motion: Motion) {
    this.time += dt;
    this.scene.visible = this.visible;

    // Walking bob: one step per half cycle, stronger when running.
    const stride = Math.min(motion.speed / WALK_SPEED, 2);
    this.stepPhase += motion.speed * dt * 2.4;
    // Lag behind camera turns, then spring back.
    const swayTarget = new THREE.Vector2(
      THREE.MathUtils.clamp(motion.yawVelocity * 0.012, -0.06, 0.06),
      THREE.MathUtils.clamp(-motion.pitchVelocity * 0.01, -0.05, 0.05),
    );
    this.sway.lerp(swayTarget, 1 - Math.exp(-dt * 10));
    this.airborne = THREE.MathUtils.lerp(this.airborne, motion.grounded ? 0 : 1, 1 - Math.exp(-dt * 8));

    // Base poses: what each hand returns to between actions.
    const rightBase = this.held ? this.holdPose : this.pettingPose(dt);
    // While petting, the free left hand drops out of the way.
    const leftBase = blend(REST, LEFT_LOWERED, this.petting.weight);

    let rightPose: Pose = { ...rightBase };
    let leftPose: Pose = { ...leftBase };
    let actionWeight = 0;
    if (this.action) {
      const action = this.action;
      action.time += dt;
      for (const [name, at] of Object.entries(action.spec.events)) {
        if (action.time >= at && !action.fired.has(name)) {
          action.fired.add(name);
          action.listeners.get(name)?.();
        }
      }
      // Re-read the base after events: a `grab` or `release` changes what the hand returns to.
      const base = this.held ? this.holdPose : rightBase;
      if (action.spec.right) rightPose = sample(action.spec.right, action.time, base);
      if (action.spec.left) leftPose = sample(action.spec.left, action.time, leftBase);
      actionWeight = 1;
      if (action.time >= action.spec.duration) {
        this.action = undefined;
        action.done();
      }
    }

    if (!this.right || !this.left) return;
    const quiet = 1 - Math.max(actionWeight, this.petting.weight) * 0.8; // actions and petting mostly suppress bob and sway
    for (const [rig, pose, side] of [[this.right, rightPose, 1], [this.left, leftPose, -1]] as const) {
      const phase = this.stepPhase + (side === 1 ? 0 : Math.PI);
      pose.y += Math.sin(this.time * 1.7 + side) * 0.003 * quiet; // breathing
      pose.y += -Math.abs(Math.sin(this.stepPhase)) * 0.012 * stride * quiet;
      pose.x += Math.sin(this.stepPhase) * 0.006 * stride * quiet * side;
      pose.z += Math.sin(phase) * 0.012 * stride * quiet; // arms swing opposite each other
      pose.x += this.sway.x * side * quiet; // the mirrored left hand flips x
      pose.y += this.sway.y * quiet + this.airborne * 0.025;
      applyPose(rig, pose);
    }
    if (this.splatLook && this.skins.length) {
      this.scene.updateMatrixWorld(true);
      for (const skin of this.skins) skin.update();
    }
  }

  /** The right hand's pose with petting blended in (it eases in and out over a quarter second or so). */
  private pettingPose(dt: number): Pose {
    const petting = this.petting;
    petting.weight = THREE.MathUtils.lerp(petting.weight, petting.active ? 1 : 0, 1 - Math.exp(-dt * 6));
    if (petting.weight < 0.001) return REST;

    petting.phase += dt * petting.speed * Math.PI * 2;
    const stroke = Math.sin(petting.phase);
    const frantic = THREE.MathUtils.clamp((petting.speed - 1.4) / 1.5, 0, 1);
    const anchor = petting.target ?? new THREE.Vector3(PET.x, PET.y, PET.z);
    const pet: Pose = {
      ...PET,
      x: anchor.x + Math.sin(petting.phase * 0.5) * 0.015 + Math.sin(this.time * 31) * 0.004 * frantic,
      y: anchor.y - Math.max(0, Math.cos(petting.phase)) * 0.012, // press in on the forward stroke
      z: anchor.z + stroke * 0.055,
      wrist: PET.wrist - stroke * 0.18,
      curl: PET.curl + (1 - Math.cos(petting.phase)) * 0.04 + frantic * 0.25, // tense fingers when frantic
    };
    return blend(REST, pet, petting.weight);
  }
}

function blend(a: Pose, b: Pose, k: number): Pose {
  const out = {} as Pose;
  for (const key of Object.keys(REST) as (keyof Pose)[]) out[key] = a[key] + (b[key] - a[key]) * k;
  return out;
}

/** Interpolates keyframes; missing fields fall back to `base`, so actions start and end there. */
function sample(frames: Keyframe[], time: number, base: Pose): Pose {
  const t = Math.min(time, frames[frames.length - 1].t);
  let i = 0;
  while (i < frames.length - 2 && frames[i + 1].t < t) i++;
  const span = frames[i + 1].t - frames[i].t;
  const k = span > 0 ? THREE.MathUtils.smoothstep((t - frames[i].t) / span, 0, 1) : 1;
  return blend({ ...base, ...frames[i].pose }, { ...base, ...frames[i + 1].pose }, k);
}

function applyPose(rig: Rig, pose: Pose) {
  rig.root.position.set(pose.x, pose.y, pose.z);
  rig.root.rotation.set(pose.rx, pose.ry, pose.rz, 'YXZ');
  rig.wrist.rotation.x = pose.wrist;
  rig.sleeve.position.copy(rig.root.position);
  rig.sleeve.quaternion.setFromUnitVectors(SLEEVE_FORWARD, SHOULDER.clone().sub(rig.root.position).normalize());
  // Each finger curls a little more towards the little finger, like a relaxed hand; `point` frees the index.
  rig.fingers.forEach((finger, f) => {
    let curl = THREE.MathUtils.clamp(pose.curl + f * 0.05, 0, 1);
    if (f === 0) curl *= 1 - pose.point;
    finger.pose([0, -curl * 1.2, -curl * 1.45, -curl * 0.95, 0]);
  });
  rig.thumb.pose([-pose.thumb * 0.35, -pose.thumb * 0.6, -pose.thumb * 0.7, 0]);
}

/**
 * Wraps the WebXR hand so it matches the pose frame: wrist at the origin, fingers along -Z, back of the
 * hand up (+Y), thumb on the -X side. Adds the held-item socket, ink outlines and the raincoat sleeve
 * (a separate object; `applyPose` aims it).
 */
function buildRig(model: THREE.Object3D, skin: THREE.Material, sleeveMaterial: THREE.Material): Rig {
  const bone = (name: string) => {
    const found = model.getObjectByName(name);
    if (!(found instanceof THREE.Bone)) throw new Error(`Hand model has no joint "${name}"`);
    return found;
  };

  const skinned: THREE.SkinnedMesh[] = [];
  model.traverse((object) => object instanceof THREE.SkinnedMesh && skinned.push(object));
  const meshes: THREE.Mesh[] = [];
  for (const hand of skinned) {
    hand.material = skin;
    hand.frustumCulled = false; // bones move it beyond its bind-pose bounds
    const outline = new THREE.SkinnedMesh(hand.geometry, outlineMaterial(OUTLINE, INK));
    outline.bind(hand.skeleton, hand.bindMatrix);
    outline.frustumCulled = false;
    hand.parent!.add(outline);
    meshes.push(hand, outline);
  }

  // Orientation from the bind pose: the palm points wrist -> middle knuckle (the fingers are slightly bent
  // in the bind pose, so the fingertip would tilt it); the knuckles run index -> little.
  const wrist = bone('wrist').position;
  const forward = bone('middle-finger-phalanx-proximal').position.clone().sub(wrist).normalize();
  const across = bone('pinky-finger-phalanx-proximal').position.clone().sub(bone('index-finger-phalanx-proximal').position);
  across.addScaledVector(forward, -across.dot(forward)).normalize();
  const back = new THREE.Vector3().crossVectors(across, forward);
  const toPoseFrame = new THREE.Quaternion()
    .setFromRotationMatrix(new THREE.Matrix4().makeBasis(across, back, forward.clone().negate()))
    .invert();

  const anchor = new THREE.Group();
  anchor.quaternion.copy(toPoseFrame);
  anchor.scale.setScalar(HAND_SCALE);
  anchor.position.copy(wrist).applyQuaternion(toPoseFrame).multiplyScalar(-HAND_SCALE);
  anchor.add(model);

  const socket = new THREE.Group();
  socket.position.set(0, -0.028, -0.07); // inside the curled fingers, palm side

  const wristJoint = new THREE.Group(); // bends the hand at the wrist
  wristJoint.add(anchor, socket);
  const root = new THREE.Group();
  root.add(wristJoint);

  const fingers = FINGERS.map((finger) => new Chain(FINGER_JOINTS.map((joint) => bone(`${finger}-${joint}`))));
  const sleeve = buildSleeve(sleeveMaterial);
  sleeve.traverse((object) => object instanceof THREE.Mesh && meshes.push(object));
  return { root, sleeve, meshes, wrist: wristJoint, socket, fingers, thumb: new Chain(THUMB_JOINTS.map(bone)) };
}

/** A raincoat sleeve from the wrist back past the edge of the view, with a few soft folds and a cuff band. */
function buildSleeve(material: THREE.Material) {
  const sleeve = new THREE.Group();
  const geometry = new THREE.CylinderGeometry(0.038, 0.05, 0.36, 28, 12, true);
  const position = geometry.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i);
    const angle = Math.atan2(v.z, v.x);
    const along = v.y / 0.36 + 0.5; // 0 at the elbow end, 1 at the wrist
    const fold = 1 + 0.06 * Math.sin(along * 14 + angle * 2) * (1 - along) + 0.03 * Math.sin(angle * 5);
    position.setXYZ(i, v.x * fold, v.y, v.z * fold);
  }
  geometry.computeVertexNormals();
  const tube = new THREE.Mesh(geometry, material);
  const tubeOutline = new THREE.Mesh(geometry, outlineMaterial(OUTLINE * 1.5, INK));
  const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.039, 0.008, 10, 32), material);
  const cuffOutline = new THREE.Mesh(cuff.geometry, outlineMaterial(OUTLINE, INK));
  for (const part of [tube, tubeOutline]) {
    part.rotation.x = -Math.PI / 2; // cylinder axis along +Z, wrist end towards the hand
    part.position.z = 0.19;
  }
  for (const part of [cuff, cuffOutline]) part.position.z = 0.02;
  sleeve.add(tube, tubeOutline, cuff, cuffOutline);
  return sleeve;
}
