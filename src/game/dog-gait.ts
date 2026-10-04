import * as THREE from 'three';

// Procedural legs for Biscuit. The authored walk/run clips skate (planted paws move at different speeds),
// leave paws floating or below the ground, bob the body ~7 cm and fold the legs to extremes, so while he
// stands or moves this replaces the clip's legs: each paw is planted on the ground and steps in a proper
// gait (a four-beat walk, a trot when running) matched to how fast he actually travels, and each leg is
// solved with two-bone IK that bends the way the rig's rest pose bends. Body, head and tail stay with
// the clip. Leg names come from the rig description that ships with the dog (huawei-dog-rig.json).
// scripts/dog-clips.mjs uses the same gait to rebuild the walk/run clips inside the dog's GLB.

export interface RigSpec {
  legs: { name: string; upper: string; lower: string; foot: string; contact: string }[];
}

type LegName = 'front_positive_x' | 'front_negative_x' | 'back_positive_x' | 'back_negative_x';

// Fractions of a stride cycle. +x is his right (he faces -Z). Walk: lateral sequence, left hind, left
// fore, right hind, right fore. Trot: diagonal pairs.
const PHASE: Record<LegName, { walk: number; trot: number }> = {
  back_negative_x: { walk: 0, trot: 0 },
  front_negative_x: { walk: 0.25, trot: 0.5 },
  back_positive_x: { walk: 0.5, trot: 0.5 },
  front_positive_x: { walk: 0.75, trot: 0 },
};
const WALK = { duty: 0.62, stride: 0.22, lift: 0.045, minHz: 1.6, bob: 0.006 };
const TROT = { duty: 0.42, stride: 0.3, lift: 0.075, minHz: 2.4, bob: 0.014 };
const TROT_ABOVE = 1.5; // m/s
const FADE_SECONDS = 0.2;

interface Leg {
  name: string;
  front: boolean;
  phase: { walk: number; trot: number };
  upper: THREE.Bone;
  lower: THREE.Bone;
  foot: THREE.Bone;
  contact: THREE.Object3D;
  upperLength: number;
  lowerLength: number;
  /** Rest pose, in the frame (metres): where the paw stands, the paw's offset up to the foot joint, the knee's bend direction. */
  restContact: THREE.Vector3;
  footFromContact: THREE.Vector3;
  bend: THREE.Vector3;
  ground: number;
}

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();
const q1 = new THREE.Quaternion();
const q2 = new THREE.Quaternion();
const swing = new THREE.Quaternion();

export class DogGait {
  /** 1 while legs should be planted (standing, walking, sniffing); 0 hands the legs back to the clip (sit, jump…). */
  active = true;
  /** Speed along his heading (m/s) and turn rate (rad/s), from the controller each frame. */
  speed = 0;
  turnRate = 0;
  /** Lifts the paws off the collider a little: the ground splats are puffier than the collider. */
  lift = 0.015;

  private readonly legs: Leg[];
  private phase = 0;
  private weight = 0;
  private trot = 0;
  private stepping = 0;

  constructor(
    rig: RigSpec,
    private readonly skeletonRoot: THREE.Object3D, // the Dog's group (scaled model space)
    private readonly frame: THREE.Object3D, // Biscuit's group: metres, ground at y = 0, facing -Z
    private readonly groundAt: (x: number, z: number, near: number) => number | undefined,
  ) {
    let mesh: THREE.SkinnedMesh | undefined;
    skeletonRoot.traverse((object) => {
      if (object instanceof THREE.SkinnedMesh && !mesh) mesh = object;
    });
    if (!mesh) throw new Error('The dog has no skeleton');
    const skinned = mesh;
    skeletonRoot.updateWorldMatrix(true, true);
    frame.updateWorldMatrix(true, false);

    // Bind-pose joint positions, in the frame. (Attached skinning: rest bone world = mesh · bind⁻¹ · boneInverse⁻¹.)
    const toWorld = skinned.matrixWorld.clone().multiply(skinned.bindMatrix.clone().invert());
    const rest = (bone: THREE.Bone) => {
      const index = skinned.skeleton.bones.indexOf(bone);
      const world = new THREE.Vector3().applyMatrix4(
        toWorld.clone().multiply(skinned.skeleton.boneInverses[index].clone().invert()),
      );
      return frame.worldToLocal(world);
    };
    const find = (name: string) => {
      const bone = skeletonRoot.getObjectByName(name);
      if (!(bone instanceof THREE.Bone)) throw new Error(`The dog rig has no ${name}`);
      return bone;
    };

    this.legs = rig.legs.map((spec) => {
      const upper = find(spec.upper);
      const lower = find(spec.lower);
      const foot = find(spec.foot);
      const contact = find(spec.contact);
      const [u, l, f, c] = [upper, lower, foot, contact].map(rest);
      const reach = f.clone().sub(u).normalize();
      const knee = l.clone().sub(u);
      const bend = knee.sub(reach.clone().multiplyScalar(knee.dot(reach))).normalize();
      return {
        name: spec.name,
        front: spec.name.startsWith('front'),
        phase: PHASE[spec.name as LegName] ?? { walk: 0, trot: 0 },
        upper,
        lower,
        foot,
        contact,
        upperLength: u.distanceTo(l),
        lowerLength: l.distanceTo(f),
        restContact: c,
        footFromContact: f.clone().sub(c),
        bend,
        ground: 0,
      };
    });
  }

  /** A leg's paw height in the rest pose, in the frame (by its rig name). */
  restContactY(name: string) {
    return this.legs.find((leg) => leg.name === name)?.restContact.y ?? 0;
  }

  /**
   * Poses the legs at one moment of a steady gait on flat ground, with no easing: for baking clips.
   * `phase` is 0..1 through the stride cycle (see `gaitCycle` for its length at `speed`).
   */
  poseAt(phase: number, trot: boolean, speed: number) {
    this.weight = 1;
    this.stepping = 1;
    this.trot = trot ? 1 : 0;
    this.phase = phase % 1;
    this.speed = speed;
    this.turnRate = 0;
    for (const leg of this.legs) leg.ground = 0;
    this.apply(0);
  }

  /** Hands the legs straight back to the clip, without the fade (a trick that has to start now). */
  letGo() {
    this.active = false;
    this.weight = 0;
  }

  /** Called by the Dog after the clip pose and before skinning. */
  apply(dt: number) {
    this.weight = THREE.MathUtils.clamp(this.weight + (this.active ? dt : -dt) / FADE_SECONDS, 0, 1);
    this.frame.updateMatrixWorld(true);
    if (this.weight === 0) {
      this.skeletonRoot.position.y = 0;
      return;
    }

    // Stepping: forward speed, or stepping round on the spot while turning.
    const pace = Math.max(Math.abs(this.speed), Math.abs(this.turnRate) * 0.18);
    this.stepping = THREE.MathUtils.damp(this.stepping, pace > 0.08 ? 1 : 0, 10, dt);
    this.trot = THREE.MathUtils.damp(this.trot, pace > TROT_ABOVE ? 1 : 0, 6, dt);
    const { gait, hz, stride } = gaitCycle(pace, this.trot);
    this.phase = (this.phase + hz * dt * this.stepping) % 1;

    // Ground under each paw's resting spot, so paws follow steps and slopes.
    let groundSum = 0;
    for (const leg of this.legs) {
      v1.copy(leg.restContact).setY(0);
      this.frame.localToWorld(v1);
      const hit = this.groundAt(v1.x, v1.z, v1.y);
      const ground = hit === undefined ? 0 : THREE.MathUtils.clamp(hit - v1.y, -0.15, 0.15);
      leg.ground = THREE.MathUtils.damp(leg.ground, ground, 18, dt);
      groundSum += leg.ground;
    }
    // Body follows the paws' mean ground, and bobs twice a stride.
    const bob = gait.bob * this.stepping * Math.cos(this.phase * Math.PI * 4);
    this.skeletonRoot.position.y = (groundSum / this.legs.length + bob) * this.weight;
    this.skeletonRoot.updateMatrixWorld(true);

    for (const leg of this.legs) this.solve(leg, gait, stride);
  }

  private solve(leg: Leg, gait: typeof WALK, stride: number) {
    const t = (this.phase + THREE.MathUtils.lerp(leg.phase.walk, leg.phase.trot, this.trot)) % 1;
    let along: number; // -0.5 (reaching forward) … +0.5 (pushed back)
    let lift = 0;
    let curl = 0;
    if (t < gait.duty) {
      along = t / gait.duty - 0.5;
    } else {
      const s = (t - gait.duty) / (1 - gait.duty);
      along = 0.5 - s * s * (3 - 2 * s);
      lift = Math.sin(Math.PI * s);
      curl = lift;
    }
    lift *= gait.lift * this.stepping;

    // Paw target in the frame, then in the world. (Forward is -Z, so "pushed back" is +Z.)
    const contact = v1.copy(leg.restContact);
    contact.z += along * stride * this.stepping;
    contact.y += leg.ground + lift + this.lift;
    // Mid-swing the paw folds under (wrist back on the forelegs, hock up behind).
    const fold = curl * this.stepping * (leg.front ? 0.9 : 0.45);
    const footTarget = v2.copy(leg.footFromContact).applyAxisAngle(X_AXIS, leg.front ? -fold : fold).add(contact);
    this.frame.localToWorld(footTarget);
    const toe = this.frame.localToWorld(contact.clone());

    const { upper, lower, foot } = leg;
    const clip = [upper.quaternion.clone(), lower.quaternion.clone(), foot.quaternion.clone()];
    const hip = upper.getWorldPosition(new THREE.Vector3());
    const a = leg.upperLength * this.worldScale;
    const b = leg.lowerLength * this.worldScale;

    // Heel-off: these legs are nearly straight at rest, so at the ends of a stride they can't reach the
    // wrist/hock where the rest pose puts it. Roll the paw over its planted toe towards the hip until they can.
    const reachable = (a + b) * 0.97;
    if (footTarget.distanceTo(hip) > reachable) {
      const pastern = footTarget.clone().sub(toe);
      const roll = new THREE.Quaternion().setFromUnitVectors(pastern.clone().normalize(), hip.clone().sub(toe).normalize());
      const partial = new THREE.Quaternion();
      for (let t = 0.1; t < 1.05; t += 0.1) {
        footTarget.copy(pastern).applyQuaternion(partial.identity().slerp(roll, t)).add(toe);
        if (footTarget.distanceTo(hip) <= reachable) break;
      }
    }

    // Two-bone IK: upper → lower → foot reaching footTarget, knee bent towards the rest bend direction.
    const toFoot = footTarget.clone().sub(hip);
    const distance = THREE.MathUtils.clamp(toFoot.length(), Math.abs(a - b) + 1e-4, (a + b) * 0.999);
    const reach = toFoot.normalize();
    const pole = v3.copy(leg.bend).transformDirection(this.frame.matrixWorld);
    pole.sub(reach.clone().multiplyScalar(pole.dot(reach))).normalize();
    const cos = THREE.MathUtils.clamp((a * a + distance * distance - b * b) / (2 * a * distance), -1, 1);
    const knee = hip.clone().addScaledVector(reach, a * cos).addScaledVector(pole, a * Math.sqrt(1 - cos * cos));
    const ankle = hip.clone().addScaledVector(reach, distance);

    aim(upper, lower, knee.clone().sub(hip));
    aim(lower, foot, ankle.clone().sub(knee));
    // The paw points from the wrist/hock to its toe target: its rest angle, folded mid-swing, rolled at heel-off.
    aim(foot, leg.contact, toe.sub(footTarget));

    if (this.weight < 1) {
      [upper, lower, foot].forEach((bone, i) => bone.quaternion.copy(clip[i].slerp(bone.quaternion.clone(), this.weight)));
      upper.updateMatrixWorld(true);
    }
  }

  /** Metres in the world per metre in the frame (Biscuit's group is unscaled, but keep it honest). */
  private get worldScale() {
    return this.frame.getWorldScale(this.scaleProbe).x;
  }
  private readonly scaleProbe = new THREE.Vector3();
}

const X_AXIS = new THREE.Vector3(1, 0, 0);

/**
 * The stride at `speed` (m/s along his heading; `trot` 0 walk … 1 trot): strides per second, and how far a
 * planted paw travels back during its stance.
 */
export function gaitCycle(speed: number, trot: number) {
  const gait = blendGait(trot);
  const hz = Math.max(gait.minHz, (speed * gait.duty) / gait.stride);
  return { gait, hz, stride: (speed * gait.duty) / hz };
}

function blendGait(trot: number): typeof WALK {
  const mix = (key: keyof typeof WALK) => THREE.MathUtils.lerp(WALK[key], TROT[key], trot);
  return { duty: mix('duty'), stride: mix('stride'), lift: mix('lift'), minHz: mix('minHz'), bob: mix('bob') };
}

/** Rotates `bone` (in world space, minimally) so its child `toward` lies along `direction`. */
function aim(bone: THREE.Object3D, toward: THREE.Object3D, direction: THREE.Vector3) {
  const from = bone.getWorldPosition(new THREE.Vector3());
  const current = toward.getWorldPosition(new THREE.Vector3()).sub(from).normalize();
  const turn = q1.setFromUnitVectors(current, direction.clone().normalize());
  const world = bone.getWorldQuaternion(new THREE.Quaternion());
  const parent = bone.parent ? bone.parent.getWorldQuaternion(q2) : q2.identity();
  bone.quaternion.copy(parent.invert().multiply(swing.copy(turn).multiply(world)));
  bone.updateMatrixWorld(true);
}
