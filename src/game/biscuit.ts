import RAPIER from '@dimforge/rapier3d-compat';
import { SplatMesh } from '@sparkjsdev/spark';
import * as THREE from 'three';
import { DogGait, type RigSpec } from './dog-gait';
import { Dog, type DogAction } from './dog/dog';
import type { Mood } from './lighting';
import type { Prop } from './props';

// Biscuit: the game-side behaviour around Larry's animated splat dog (src/dog, from larry/dogmodels).
// The Dog plays its clips in place; this moves him through the world (following the player, fetching
// thrown props, coming over to be petted, barking) and DogGait walks his legs. Asset: the Huawei
// challenge dog (50,000 skinned Gaussians).

const MODEL = '/models/dog-animated.glb'; // the Dog only uses the captured splat appearance at this exact path
const RIG = '/models/huawei-dog-rig.json';
const LENGTH = 0.85; // metres, nose to tail
const FOLLOW_DISTANCE = 1.5; // where he settles, from the player
const START_FOLLOWING = 2.4; // how far the player can drift before he trots after them
const RUN_DISTANCE = 4.5;
const ARRIVED = 0.05; // slack around a stopping distance, so he doesn't creep forever at the edge of it
const SPEED = { walk: 1.0, run: 2.6 }; // metres per second
const TURN_RATE = 5; // radians per second
const PICKUP_SECONDS = 1.2;
const GRAB_AT = 0.85; // into the pick-up sniff, when the mouth closes on it
const MOUTH_REACH = 0.14; // metres: where his feet stop short of the prop so the lowered mouth is over it
const GIVE_UP_SECONDS = 12;
/** Clips that keep all four paws on the ground; the others (sit, jump…) move the legs themselves. */
const PLANTED: DogAction[] = ['idle', 'wag', 'sniff', 'bark', 'walk', 'run'];

const UP = new THREE.Vector3(0, 1, 0);
/** His splats are lit as captured (bright daylight); this tints them to sit in each world's light. */
const MOOD_TINT: Record<Mood | 'studio', THREE.Color> = {
  dusk: new THREE.Color(0.8, 0.83, 0.93),
  indoor: new THREE.Color(1.0, 0.87, 0.74),
  studio: new THREE.Color(1, 1, 1), // the menu: as captured
};
const DIG_SECONDS = 3.2;

type Mode = 'follow' | 'chase' | 'pickup' | 'return' | 'petted' | 'dig' | 'stage';

export class Biscuit {
  readonly group = new THREE.Group();
  readonly ready: Promise<void>;
  /** Kept current every frame: the middle of his back, where the "Pet" prompt aims. */
  readonly back = new THREE.Vector3();
  /** Kept current every frame: the back of his neck, where the petting hand goes. */
  readonly petPoint = new THREE.Vector3();
  mode: Mode = 'follow';

  private readonly dog: Dog;
  private gait?: DogGait;
  private neck?: THREE.Object3D;
  private loaded = false;
  private placed = false;
  private moving = false;
  private fetching?: Prop;
  private carrying?: Prop;
  private timer = 0;
  private idleTime = 0;
  private wagTime = 0;
  private readonly groundedAt = new THREE.Vector3(); // where the fetched prop lay when he grabbed it
  private readonly petSpot = new THREE.Vector3();
  private petHeading = 0;
  private petArrived = false;
  private barks: number[] = [];
  private readonly bark = new Audio('/audio/dog-bark.ogg');
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  private tint = MOOD_TINT.dusk;
  private readonly lastPosition = new THREE.Vector3();
  private lastHeading = 0;

  constructor(
    renderer: THREE.WebGLRenderer,
    private readonly physics: RAPIER.World,
  ) {
    this.dog = new Dog(renderer);
    this.group.add(this.dog.group);
    this.group.visible = false; // until he's loaded and standing in a world
    this.ready = this.load();
  }

  private async load() {
    const [rig] = await Promise.all([
      fetch(RIG).then((response) => response.json() as Promise<RigSpec & { neck: string }>),
      this.dog.loadDog(MODEL),
    ]);
    // The Dog normalises the model to 2.6 units on its longest side (nose to tail), feet on y = 0, facing -Z.
    this.dog.group.scale.setScalar(LENGTH / 2.6);
    this.dog.group.updateMatrixWorld(true);
    this.neck = this.dog.group.getObjectByName(rig.neck);
    this.gait = new DogGait(rig, this.dog.group, this.group, (x, z, near) => this.groundAt(x, z, near));
    this.dog.onPose = (step) => this.gait?.apply(step);
    this.loaded = true;
    this.group.visible = this.placed;
    this.applyTint();
  }

  get busy() {
    return this.mode !== 'follow';
  }

  /** True once he's come over for petting and is facing the player. */
  get readyForPets() {
    return this.mode === 'petted' && this.petArrived;
  }

  setMood(mood: Mood | 'studio') {
    this.tint = MOOD_TINT[mood];
    this.applyTint();
  }

  private applyTint() {
    this.dog.group.traverse((object) => {
      if (!(object instanceof SplatMesh)) return;
      object.recolor.copy(this.tint);
      object.editable = false; // world edits (the erased painted door) are for the world's splats, not his
    });
  }

  /** Puts him next to the player (on arrival in a world), facing them. */
  placeBeside(feet: THREE.Vector3, playerYaw: number) {
    this.dug?.();
    this.dug = undefined;
    const forward = new THREE.Vector3(-Math.sin(playerYaw), 0, -Math.cos(playerYaw));
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    this.group.position.copy(feet).addScaledVector(forward, 1.3).addScaledVector(right, 0.5);
    this.group.rotation.y = playerYaw + Math.PI; // face back towards the player
    this.fetching = undefined;
    this.mode = 'follow';
    this.idleTime = 0;
    this.moving = false;
    this.play('wag');
    this.snapToGround(true);
    this.lastPosition.copy(this.group.position);
    this.lastHeading = this.group.rotation.y;
    this.placed = true;
    this.group.visible = this.loaded;
  }

  /**
   * The menu's companion: standing at the origin on nothing (no world), turned by `heading`, idling and now
   * and then wagging. `update` keeps him there until he's placed in a world again.
   */
  stage(heading: number) {
    this.dropFetch();
    this.mode = 'stage';
    this.group.position.set(0, 0, 0);
    this.group.rotation.y = heading;
    this.lastPosition.copy(this.group.position);
    this.lastHeading = heading;
    this.idleTime = 0;
    this.placed = true;
    this.group.visible = this.loaded;
    this.play('idle');
  }

  /** Turns him on the menu stand (drag to spin). */
  spin(radians: number) {
    if (this.mode !== 'stage') return;
    this.group.rotation.y += radians;
    this.lastHeading = this.group.rotation.y;
  }

  /** A happy reaction (the menu's "tap to pet"). */
  wag() {
    if (!this.loaded) return;
    this.idleTime = 0;
    this.dog.playAction('wag');
    this.wagTime = 0;
  }

  /** The jump clip (crouch, take-off at ~0.57 s, airborne until ~1.95 s at rate 1), at `rate`. */
  jump(rate = 1) {
    if (!this.loaded) return;
    this.dog.setActionRate(rate);
    this.dog.playAction('jump');
  }

  /** Sits down (and stays sat). */
  sit() {
    if (!this.loaded) return;
    this.dog.setActionRate(1);
    this.dog.playAction('sit');
  }

  /** Runs over to `spot` and digs there (pawing at the soil); resolves once he's done. */
  dig(spot: THREE.Vector3): Promise<void> {
    if (!this.loaded) return Promise.resolve();
    this.dropFetch(true);
    this.mode = 'dig';
    this.digSpot.copy(spot);
    this.timer = -1; // counting starts when he gets there
    return new Promise((resolve) => (this.dug = resolve));
  }

  /** True while he's pawing at the ground (for the dirt effect). */
  get digging() {
    return this.mode === 'dig' && this.timer >= 0;
  }

  private readonly digSpot = new THREE.Vector3();
  private dug?: () => void;

  /** Sits at `at` facing `player`, and stays put until they come or go, or a few seconds pass. */
  sitAt(at: THREE.Vector3, player: THREE.Vector3) {
    this.group.position.copy(at);
    this.snapToGround(true);
    this.group.rotation.y = this.headingTo(player);
    this.lastPosition.copy(this.group.position);
    this.lastHeading = this.group.rotation.y;
    this.mode = 'follow';
    this.waitTime = 5;
    this.waitFrom.copy(player);
    this.play('sit');
  }

  private waitTime = 0;
  private readonly waitFrom = new THREE.Vector3();

  /** Throws are fetched: he runs to it, picks it up and brings it back. */
  fetch(prop: Prop) {
    if (!this.loaded || this.mode === 'petted') return;
    this.dropFetch();
    this.fetching = prop;
    this.mode = 'chase';
    this.timer = 0;
  }

  /** Drop what he's doing (and carrying) and come back to the player. */
  come() {
    this.dropFetch(true);
    this.mode = 'follow';
    this.idleTime = 0;
  }

  /** Before a world change: anything in his mouth is dropped where he stands, in the world it belongs to. */
  letGo() {
    this.dropFetch(true);
    this.mode = 'follow';
  }

  /** The bark clip, with two woofs. */
  barkTwice() {
    if (!this.loaded) return;
    this.play('bark');
    this.barks = [0.05, 0.85];
  }

  /** Trots to `spot` (just in front of the player), turns side-on to `heading` and waits there, wagging. */
  comeForPets(spot: THREE.Vector3, heading: number) {
    if (!this.loaded) return;
    this.dropFetch(true);
    this.mode = 'petted';
    this.petArrived = false;
    this.petSpot.copy(spot);
    this.petHeading = heading;
  }

  petEnd() {
    if (this.mode === 'petted') this.mode = 'follow';
    this.idleTime = 0;
  }

  update(dt: number, player: THREE.Vector3) {
    if (!this.loaded || !this.placed) return;
    this.updateBarks(dt);
    this.moving = false;

    switch (this.mode) {
      case 'stage':
        // Idle, with a wag now and then; sitting after a long wait looks like he's bored of the menu.
        this.idleTime += dt;
        if (this.dog.action === 'idle' && this.idleTime > 7) {
          this.wag();
        } else if (this.dog.action === 'wag' && (this.wagTime += dt) > 2.5) {
          this.play('idle');
          this.idleTime = 0;
        }
        this.lastPosition.copy(this.group.position);
        if (this.gait) {
          this.gait.speed = 0;
          this.gait.turnRate = 0;
          this.gait.active = PLANTED.includes(this.dog.action);
        }
        this.dog.update(dt);
        this.back.copy(this.group.position).y += 0.35;
        return;
      case 'dig':
        if (this.timer < 0) {
          // Front paws over the spot: stop a little short of it, then face it.
          if (this.moveToward(this.digSpot, this.gaitFor(this.flatDistance(this.digSpot)), dt, 0.3)) {
            this.faceToward(this.digSpot, dt);
            if (Math.abs(this.headingError(this.headingTo(this.digSpot))) < 0.2) {
              this.timer = 0;
              this.dog.playAction('paw');
            }
          }
        } else {
          this.timer += dt;
          // The paw clip is one scrape; keep scraping until done.
          if (this.dog.action !== 'paw' && this.timer < DIG_SECONDS - 0.6) this.dog.playAction('paw');
          if (this.timer >= DIG_SECONDS) {
            this.mode = 'follow';
            this.play('wag');
            this.idleTime = 0;
            this.dug?.();
            this.dug = undefined;
          }
        }
        break;
      case 'follow':
        this.follow(dt, player);
        break;
      case 'chase': {
        const prop = this.fetching;
        this.timer += dt;
        if (!prop || prop.isCarried || this.timer > GIVE_UP_SECONDS) {
          this.come();
          break;
        }
        // Run to just short of it, so his mouth is over it, then wait for it to settle.
        if (this.moveToward(prop.position, 'run', dt, MOUTH_REACH)) {
          this.faceToward(prop.position, dt);
          if (prop.resting) {
            this.mode = 'pickup';
            this.timer = 0;
            this.play('sniff');
          } else {
            this.play('idle');
          }
        }
        break;
      }
      case 'pickup': {
        const prop = this.fetching;
        this.timer += dt;
        if (!prop || (prop.isCarried && prop !== this.carrying)) {
          this.come();
          break;
        }
        if (this.timer >= GRAB_AT && !this.carrying) {
          this.carrying = prop;
          this.groundedAt.copy(prop.position);
          prop.lift();
        }
        if (this.timer >= PICKUP_SECONDS) this.mode = 'return';
        break;
      }
      case 'return':
        if (this.moveToward(player, this.gaitFor(this.flatDistance(player)), dt, FOLLOW_DISTANCE * 0.8)) {
          this.dropFetch(true);
          this.mode = 'follow';
          this.play('wag');
          this.idleTime = 0;
        }
        break;
      case 'petted':
        if (!this.petArrived && this.moveToward(this.petSpot, 'walk', dt, 0)) {
          this.turnTo(this.petHeading, dt);
          if (Math.abs(this.headingError(this.petHeading)) < 0.15) this.petArrived = true;
        }
        if (this.petArrived || !this.moving) this.play('wag');
        break;
    }

    // Tell the legs how he's actually moving, then pose and skin him.
    const moved = this.group.position.clone().sub(this.lastPosition);
    const heading = this.group.rotation.y;
    if (this.gait && dt > 0) {
      const forward = new THREE.Vector3(-Math.sin(heading), 0, -Math.cos(heading));
      this.gait.speed = moved.setY(0).dot(forward) / dt;
      this.gait.turnRate = Math.atan2(Math.sin(heading - this.lastHeading), Math.cos(heading - this.lastHeading)) / dt;
      this.gait.active = PLANTED.includes(this.dog.action);
    }
    this.lastPosition.copy(this.group.position);
    this.lastHeading = heading;

    this.snapToGround(false);
    this.dog.update(dt);
    if (this.carrying) this.holdInMouth(this.carrying);
    // The scruff, just behind the head: a little up from the neck joint and back along his body.
    this.neck?.getWorldPosition(this.petPoint);
    this.petPoint.x += Math.sin(this.group.rotation.y) * 0.05;
    this.petPoint.z += Math.cos(this.group.rotation.y) * 0.05;
    this.petPoint.y += 0.08;
    this.back.copy(this.group.position).y += 0.35;
  }

  // ---------- Behaviour ----------

  private follow(dt: number, player: THREE.Vector3) {
    const distance = this.flatDistance(player);
    if (this.waitTime > 0) {
      // Still sitting where he was found: up once the player moves off or the moment passes.
      this.waitTime -= dt;
      const moved = Math.hypot(player.x - this.waitFrom.x, player.z - this.waitFrom.z);
      if (moved < 0.6 && this.waitTime > 0) return;
      this.waitTime = 0;
    }
    const wasMoving = this.isWalking();
    if (distance > START_FOLLOWING || (distance > FOLLOW_DISTANCE + ARRIVED && wasMoving)) {
      this.idleTime = 0;
      this.moveToward(player, this.gaitFor(distance), dt, FOLLOW_DISTANCE);
      return;
    }
    // Settled near the player: watch them, wag now and then, sit if nothing happens for a while.
    this.idleTime += dt;
    this.faceToward(player, dt);
    this.wagTime = this.dog.action === 'wag' ? this.wagTime + dt : 0;
    if (this.wagTime > 3) this.play('idle');
    if (this.idleTime > 8 && this.dog.action === 'idle') this.play('sit');
  }

  private walkingGait: 'walk' | 'run' | undefined;

  private isWalking() {
    return this.walkingGait !== undefined;
  }

  /** Runs to catch up, and keeps running until he's nearly there rather than dropping to a walk. */
  private gaitFor(distance: number): 'walk' | 'run' {
    if (distance > RUN_DISTANCE) return 'run';
    return this.walkingGait === 'run' && distance > FOLLOW_DISTANCE + 1 ? 'run' : 'walk';
  }

  /**
   * Steps towards `target` (turning first); true once within `stopAt`. His legs are walked by DogGait,
   * so the clip underneath is the happy wagging one (the authored walk clip bobs and skates).
   */
  private moveToward(target: THREE.Vector3, gait: 'walk' | 'run', dt: number, stopAt: number): boolean {
    const direction = new THREE.Vector3(target.x - this.group.position.x, 0, target.z - this.group.position.z);
    const distance = direction.length();
    if (distance <= stopAt + ARRIVED) {
      this.walkingGait = undefined;
      return true;
    }
    const heading = Math.atan2(-direction.x, -direction.z);
    this.turnTo(heading, dt);
    const facing = Math.max(0, Math.cos(this.headingError(heading)));
    const travel = Math.min(distance - stopAt, SPEED[gait] * dt * facing);
    this.group.position.addScaledVector(direction, travel / distance);
    this.walkingGait = gait;
    this.moving = true;
    if (this.dog.action !== 'wag' && this.dog.action !== 'idle') this.play('wag');
    return false;
  }

  private faceToward(target: THREE.Vector3, dt: number) {
    const dx = target.x - this.group.position.x;
    const dz = target.z - this.group.position.z;
    if (dx * dx + dz * dz > 0.01) this.turnTo(Math.atan2(-dx, -dz), dt);
  }

  private turnTo(heading: number, dt: number) {
    const error = this.headingError(heading);
    const turned = this.group.rotation.y + Math.sign(error) * Math.min(Math.abs(error), TURN_RATE * dt);
    this.group.rotation.y = Math.atan2(Math.sin(turned), Math.cos(turned));
  }

  private headingTo(target: THREE.Vector3) {
    return Math.atan2(-(target.x - this.group.position.x), -(target.z - this.group.position.z));
  }

  private headingError(heading: number) {
    const current = this.group.rotation.y;
    return Math.atan2(Math.sin(heading - current), Math.cos(heading - current));
  }

  private flatDistance(target: THREE.Vector3) {
    return Math.hypot(target.x - this.group.position.x, target.z - this.group.position.z);
  }

  private play(action: DogAction) {
    if (this.dog.actionRate !== 1) this.dog.setActionRate(1);
    if (this.dog.action !== action) this.dog.playAction(action);
  }

  private dropFetch(drop = false) {
    const prop = this.carrying;
    if (prop && drop) {
      // Lay it on the ground just in front of his nose.
      const ahead = new THREE.Vector3(-Math.sin(this.group.rotation.y), 0, -Math.cos(this.group.rotation.y));
      const at = this.group.position.clone().addScaledVector(ahead, 0.35);
      at.y += 0.15;
      prop.putDown(at);
    } else if (prop) {
      prop.putDown(prop.position.clone());
    }
    this.carrying = undefined;
    this.fetching = undefined;
  }

  private readonly mouth = new THREE.Vector3();
  private readonly mouthTurn = new THREE.Quaternion();
  private holdInMouth(prop: Prop) {
    this.dog.getMouthWorldPosition(this.mouth);
    if (this.mode === 'pickup') {
      // Ease it up off the ground into the mouth over the end of the sniff.
      const t = THREE.MathUtils.clamp((this.timer - GRAB_AT) / (PICKUP_SECONDS - GRAB_AT), 0, 1);
      this.mouth.lerpVectors(this.groundedAt, this.mouth, t * t * (3 - 2 * t));
    }
    // Carried across the jaws: the stick's long axis (X) square to his heading.
    this.mouthTurn.setFromAxisAngle(UP, this.group.rotation.y);
    prop.carryTo(this.mouth, this.mouthTurn);
  }

  private updateBarks(dt: number) {
    if (!this.barks.length) return;
    this.barks = this.barks.map((at) => at - dt);
    while (this.barks.length && this.barks[0] <= 0) {
      this.barks.shift();
      this.bark.currentTime = 0;
      void this.bark.play().catch(() => undefined); // needs a user gesture first; silent otherwise
    }
  }

  /** World height of the static ground under (x, z), searching around `near`. */
  private groundAt(x: number, z: number, near: number): number | undefined {
    this.ray.origin = { x, y: near + 0.6, z };
    const hit = this.physics.castRay(
      this.ray,
      1.4,
      true,
      RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC | RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC,
    );
    return hit ? near + 0.6 - hit.timeOfImpact : undefined;
  }

  /** Keeps his body on the world: a ray down onto the collider under his middle. */
  private snapToGround(immediate: boolean) {
    const p = this.group.position;
    const ground = this.groundAt(p.x, p.z, p.y + 0.6);
    if (ground === undefined) return;
    p.y = immediate ? ground : THREE.MathUtils.lerp(p.y, ground, 0.35);
  }
}
