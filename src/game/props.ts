import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { inked, toonMaterial } from './toon';

// Small things the player can pick up, carry, throw and put down: physics bodies in the world, and a
// copy in the first-person hand while carried. Placeholder art in the toon style; the quest items
// (fetch sticks, the spare key) will use the final models.

export type PropKind = 'stick' | 'key';

interface PropSpec {
  label: string;
  /** Builds the model with its long axis along X (how it lies across the palm). */
  build(outline: number): THREE.Object3D;
  collider(): RAPIER.ColliderDesc;
  /**
   * How it sits in the first-person hand. Held items are drawn a little smaller than life (as first-person
   * games do) so they don't fill the screen; `lean` turns the far end away from the camera (radians).
   */
  held: { scale: number; lean: number };
}

const ACROSS_X = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);

const SPECS: Record<PropKind, PropSpec> = {
  stick: {
    label: 'stick',
    build: (outline) => {
      const stick = new THREE.Group();
      const bark = toonMaterial(0x6b4428, { dotSize: 6, shadowLevel: 0.6 });
      const wood = inked(new THREE.CylinderGeometry(0.022, 0.028, 0.5, 9), bark, outline);
      wood.rotation.z = Math.PI / 2;
      const twig = inked(new THREE.CylinderGeometry(0.007, 0.01, 0.12, 6), bark, outline * 0.7);
      twig.position.set(0.08, 0.035, 0);
      twig.rotation.z = -0.6;
      stick.add(wood, twig);
      return stick;
    },
    collider: () => RAPIER.ColliderDesc.capsule(0.22, 0.026).setRotation(ACROSS_X).setFriction(0.9).setRestitution(0.2),
    held: { scale: 0.6, lean: -0.65 },
  },
  key: {
    label: 'key',
    build: (outline) => {
      const key = new THREE.Group();
      const brass = toonMaterial(0xd9a441, { dotSize: 4, shadowLevel: 0.55 });
      const ring = inked(new THREE.TorusGeometry(0.018, 0.006, 8, 18), brass, outline);
      ring.position.x = -0.04;
      const shaft = inked(new THREE.BoxGeometry(0.06, 0.008, 0.008), brass, outline);
      shaft.position.x = 0.005;
      const teeth = inked(new THREE.BoxGeometry(0.018, 0.014, 0.008), brass, outline);
      teeth.position.set(0.026, -0.009, 0);
      key.add(ring, shaft, teeth);
      return key;
    },
    collider: () => RAPIER.ColliderDesc.cuboid(0.05, 0.012, 0.006).setFriction(0.8).setRestitution(0.1),
    held: { scale: 1, lean: -0.3 },
  },
};

const WORLD_OUTLINE = 0.006;
const HELD_OUTLINE = 0.0018;

export class Prop {
  readonly object: THREE.Object3D;
  /** Kept current every frame; interactions aim at it. */
  readonly position = new THREE.Vector3();
  readonly label: string;
  private readonly body: RAPIER.RigidBody;
  private carried = false;

  constructor(
    readonly kind: PropKind,
    physics: RAPIER.World,
    at: THREE.Vector3,
  ) {
    const spec = SPECS[kind];
    this.label = spec.label;
    this.object = spec.build(WORLD_OUTLINE);
    this.body = physics.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(at.x, at.y, at.z).setCcdEnabled(true).setAngularDamping(0.6),
    );
    physics.createCollider(spec.collider(), this.body);
    this.sync();
  }

  get isCarried() {
    return this.carried;
  }

  /** Copies the physics body onto the model. */
  sync() {
    if (this.carried) return;
    const t = this.body.translation();
    const r = this.body.rotation();
    this.object.position.set(t.x, t.y, t.z);
    this.object.quaternion.set(r.x, r.y, r.z, r.w);
    this.position.copy(this.object.position);
  }

  /** Lifts it out of the world; returns the copy to put in the hand. */
  pickUp(): THREE.Object3D {
    this.carried = true;
    this.body.setEnabled(false);
    this.object.visible = false;
    const { build, held } = SPECS[this.kind];
    const inHand = build(HELD_OUTLINE / held.scale); // keep the ink line the same width after scaling
    inHand.scale.setScalar(held.scale);
    // Across the palm the far end would stand straight up in a thumb-up grip; lean it away from the eye.
    inHand.rotation.y = held.lean;
    return inHand;
  }

  /** Settled after a throw or drop (nearly still). */
  get resting(): boolean {
    if (this.carried) return false;
    const { x, y, z } = this.body.linvel();
    return x * x + y * y + z * z < 0.04;
  }

  /** Taken by something other than the player's hand (Biscuit's mouth): out of the physics, still visible. */
  lift() {
    this.carried = true;
    this.body.setEnabled(false);
    this.object.visible = true;
  }

  /** While lifted, whoever carries it places it every frame. */
  carryTo(position: THREE.Vector3, quaternion: THREE.Quaternion) {
    this.object.position.copy(position);
    this.object.quaternion.copy(quaternion);
    this.position.copy(position);
  }

  /** Back into the world at `at`, moving at `velocity` (a throw) or at rest (put down). */
  putDown(at: THREE.Vector3, velocity = new THREE.Vector3(), spin = new THREE.Vector3()) {
    this.carried = false;
    this.body.setTranslation(at, true);
    this.body.setLinvel(velocity, true);
    this.body.setAngvel(spin, true);
    this.body.setEnabled(true);
    this.object.visible = true;
    this.sync();
  }

  /** Follows its world in and out of the scene; carried props stay out of the physics either way. */
  setActive(active: boolean) {
    this.body.setEnabled(active && !this.carried);
  }

  dispose(physics: RAPIER.World) {
    physics.removeRigidBody(this.body);
    this.object.removeFromParent();
  }
}
