import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { EYE_HEIGHT } from './world';

const RADIUS = 0.3;
const HALF_HEIGHT = 0.55; // capsule is 1.7 m tall, its centre 0.85 m above the feet
const CENTER_HEIGHT = HALF_HEIGHT + RADIUS;
export const WALK_SPEED = 2.5;
const RUN_SPEED = 5;
const FLY_SPEED = 4;
const GRAVITY = 20;
const JUMP_SPEED = 5.5;
const BASE_LOOK_SENSITIVITY = 0.0018; // radians per pixel at look speed 1
const KEY_TURN_SPEED = 2; // radians per second with the arrow keys
const MAX_PITCH = THREE.MathUtils.degToRad(80);

/** First-person walker: a Rapier kinematic capsule that climbs steps and follows the ground. */
export class FirstPersonPlayer {
  fly = false;
  /** Multiplies mouse sensitivity (HUD "Look speed"). */
  lookSpeed = 1;
  /** False while a cutscene or transition owns the camera. */
  inputEnabled = true;

  /** Read by the first-person hands for bob and sway. */
  readonly motion = { speed: 0, grounded: true, yawVelocity: 0, pitchVelocity: 0 };

  private yaw = 0;
  private pitch = 0;
  private lookDelta = new THREE.Vector2();
  private verticalSpeed = 0;
  private readonly keys = new Set<string>();
  private readonly body: RAPIER.RigidBody;
  private readonly collider: RAPIER.Collider;
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly spawn = { position: new THREE.Vector3(0, 0, 0), yaw: 0 };

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly physics: RAPIER.World,
    private readonly canvas: HTMLCanvasElement,
  ) {
    this.body = physics.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, CENTER_HEIGHT, 0),
    );
    this.collider = physics.createCollider(RAPIER.ColliderDesc.capsule(HALF_HEIGHT, RADIUS), this.body);

    this.controller = physics.createCharacterController(0.02);
    this.controller.enableAutostep(0.35, 0.15, false);
    this.controller.enableSnapToGround(0.4);
    this.controller.setMaxSlopeClimbAngle(THREE.MathUtils.degToRad(50));
    this.controller.setSlideEnabled(true);

    window.addEventListener('keydown', (event) => this.keys.add(event.code));
    window.addEventListener('keyup', (event) => this.keys.delete(event.code));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('pointermove', (event) => this.onPointerMove(event));
  }

  /** Mouse look: with the pointer locked, or while dragging on the canvas (drag-to-look mode). */
  private onPointerMove(event: PointerEvent) {
    const locked = document.pointerLockElement === this.canvas;
    const dragging = (event.buttons & 1) === 1 && event.target === this.canvas;
    if (!this.inputEnabled || (!locked && !dragging)) return;

    // Pointer lock over Remote Desktop and in VMs sometimes reports the cursor being re-centred as one
    // huge jump. No real hand movement covers a third of the window in a single event, so drop those.
    const limit = Math.min(window.innerWidth, window.innerHeight) / 3;
    if (Math.abs(event.movementX) > limit || Math.abs(event.movementY) > limit) return;
    this.lookDelta.x += event.movementX;
    this.lookDelta.y += event.movementY;
  }

  /** Sets where respawn (R) puts the player, and puts them there now. */
  placeAt(feet: THREE.Vector3, yaw: number) {
    this.spawn.position.copy(feet);
    this.spawn.yaw = yaw;
    this.respawn();
  }

  respawn() {
    const center = { x: this.spawn.position.x, y: this.spawn.position.y + CENTER_HEIGHT + 0.05, z: this.spawn.position.z };
    this.body.setTranslation(center, true);
    this.body.setNextKinematicTranslation(center);
    this.verticalSpeed = 0;
    this.yaw = this.spawn.yaw;
    this.pitch = 0;
    this.lookDelta.set(0, 0);
  }

  /** Feet position, for distance checks. */
  get feet(): THREE.Vector3 {
    const t = this.body.translation();
    return new THREE.Vector3(t.x, t.y - CENTER_HEIGHT, t.z);
  }

  update(dt: number) {
    const input = this.inputEnabled;
    const key = (code: string) => input && this.keys.has(code);
    const forward = Number(key('KeyW')) - Number(key('KeyS'));
    const strafe = Number(key('KeyD')) - Number(key('KeyA'));
    const running = key('ShiftLeft') || key('ShiftRight');

    // Look: mouse deltas gathered since the last frame, plus arrow keys.
    const sensitivity = BASE_LOOK_SENSITIVITY * this.lookSpeed;
    const turn = Number(key('ArrowLeft')) - Number(key('ArrowRight'));
    const tilt = Number(key('ArrowUp')) - Number(key('ArrowDown'));
    const yawStep = -this.lookDelta.x * sensitivity + turn * KEY_TURN_SPEED * dt;
    const pitchStep = -this.lookDelta.y * sensitivity + tilt * KEY_TURN_SPEED * dt;
    this.lookDelta.set(0, 0);
    this.yaw += yawStep;
    this.pitch = THREE.MathUtils.clamp(this.pitch + pitchStep, -MAX_PITCH, MAX_PITCH);
    this.motion.yawVelocity = dt > 0 ? yawStep / dt : 0;
    this.motion.pitchVelocity = dt > 0 ? pitchStep / dt : 0;

    // Fly mode looks where you move; walking stays level.
    const look = new THREE.Euler(this.fly ? this.pitch : 0, this.yaw, 0, 'YXZ');
    const move = new THREE.Vector3(strafe, 0, -forward).applyEuler(look);
    if (move.lengthSq() > 1) move.normalize();

    const position = this.body.translation();
    if (this.fly) {
      const rise = Number(key('KeyE') || key('Space')) - Number(key('KeyQ'));
      move.y += rise;
      move.multiplyScalar((running ? FLY_SPEED * 2.5 : FLY_SPEED) * dt);
      this.body.setNextKinematicTranslation({ x: position.x + move.x, y: position.y + move.y, z: position.z + move.z });
      this.verticalSpeed = 0;
      this.motion.speed = 0;
      this.motion.grounded = false;
    } else {
      const grounded = this.controller.computedGrounded();
      if (grounded && this.verticalSpeed < 0) this.verticalSpeed = 0;
      if (grounded && key('Space')) this.verticalSpeed = JUMP_SPEED;
      this.verticalSpeed -= GRAVITY * dt;

      move.multiplyScalar((running ? RUN_SPEED : WALK_SPEED) * dt);
      move.y = this.verticalSpeed * dt;
      // Small loose props (sticks, the key) shouldn't trip the player up: only static geometry blocks.
      this.controller.computeColliderMovement(this.collider, move, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC);
      const corrected = this.controller.computedMovement();
      this.body.setNextKinematicTranslation({
        x: position.x + corrected.x,
        y: position.y + corrected.y,
        z: position.z + corrected.z,
      });
      this.motion.speed = dt > 0 ? Math.hypot(corrected.x, corrected.z) / dt : 0;
      this.motion.grounded = grounded;
      if (position.y < -30) this.respawn();
    }

    const next = this.body.nextTranslation();
    this.camera.position.set(next.x, next.y - CENTER_HEIGHT + EYE_HEIGHT, next.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}
