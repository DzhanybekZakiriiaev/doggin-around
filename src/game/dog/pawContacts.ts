import * as THREE from "three"

type Leg = {
  upper: THREE.Object3D
  lower: THREE.Object3D
  wrist: THREE.Object3D
  toe: THREE.Object3D
  target: THREE.Vector3
  previous: THREE.Vector3
  floor: number
  planted: boolean
  canPlant: boolean
  weight: number
}

export class PawContacts {
  private readonly legs: Leg[] = []
  private readonly poses = new Map<THREE.Object3D, THREE.Quaternion>()
  private previousPosition = new THREE.Vector3()
  private previousYaw = 0
  private initialized = false

  constructor(private readonly group: THREE.Group) {
    for (const names of [
      ["joint_5", "joint_7", "joint_8", "joint_6"],
      ["joint_31", "joint_35", "joint_36", "joint_34"],
      ["joint_10", "joint_11", "joint_4", "joint_3"],
      ["joint_30", "joint_32", "joint_33", "joint_38"],
    ]) {
      const [upper, lower, wrist, toe] = names.map((name) =>
        group.getObjectByName(name),
      )
      if (!upper || !lower || !wrist || !toe) continue
      const position = toe.getWorldPosition(new THREE.Vector3())
      this.legs.push({
        upper,
        lower,
        wrist,
        toe,
        target: position.clone(),
        previous: group.worldToLocal(position.clone()),
        floor: position.y,
        planted: false,
        canPlant: true,
        weight: 0,
      })
    }
  }

  restore(): void {
    for (const [bone, rotation] of this.poses) bone.quaternion.copy(rotation)
    this.poses.clear()
  }

  update(delta: number, walking: boolean): void {
    if (delta === 0) {
      if (walking)
        for (const leg of this.legs) if (leg.weight > 0.001) this.solve(leg)
      return
    }
    const distance = this.group.position.distanceTo(this.previousPosition)
    const turning = Math.abs(this.group.rotation.y - this.previousYaw)
    const moving = this.initialized && (distance > 0.00001 || turning > 0.00001)
    this.previousPosition.copy(this.group.position)
    this.previousYaw = this.group.rotation.y
    this.initialized = true
    for (const leg of this.legs) {
      const current = leg.toe.getWorldPosition(new THREE.Vector3())
      const local = this.group.worldToLocal(current.clone())
      const backwards = local.z >= leg.previous.z - 0.001
      if (!walking || !moving) {
        leg.planted = false
        leg.weight = 0
        leg.canPlant = true
      } else if (current.y > leg.floor + 0.07) {
        leg.planted = false
        leg.canPlant = true
      } else if (leg.planted && current.distanceTo(leg.target) > 0.28) {
        leg.planted = false
        leg.canPlant = false
      } else if (
        !leg.planted &&
        leg.canPlant &&
        current.y < leg.floor + 0.035 &&
        backwards
      ) {
        leg.planted = true
        leg.target.copy(current)
        leg.target.y = leg.floor
      }
      leg.previous.copy(local)
      leg.weight = THREE.MathUtils.damp(
        leg.weight,
        leg.planted ? 1 : 0,
        24,
        delta,
      )
      if (leg.weight > 0.001) this.solve(leg)
    }
  }

  private rotateToward(
    bone: THREE.Object3D,
    from: THREE.Vector3,
    to: THREE.Vector3,
  ): void {
    const rotation = new THREE.Quaternion().setFromUnitVectors(
      from.normalize(),
      to.normalize(),
    )
    const world = bone.getWorldQuaternion(new THREE.Quaternion())
    const parent =
      bone.parent?.getWorldQuaternion(new THREE.Quaternion()) ??
      new THREE.Quaternion()
    bone.quaternion.copy(parent.invert().multiply(rotation).multiply(world))
    bone.updateWorldMatrix(false, true)
  }

  private solve(leg: Leg): void {
    for (const bone of [leg.upper, leg.lower, leg.wrist])
      this.poses.set(bone, bone.quaternion.clone())
    const shoulder = leg.upper.getWorldPosition(new THREE.Vector3())
    const elbow = leg.lower.getWorldPosition(new THREE.Vector3())
    const wrist = leg.wrist.getWorldPosition(new THREE.Vector3())
    const toe = leg.toe.getWorldPosition(new THREE.Vector3())
    const wristRotation = leg.wrist.getWorldQuaternion(new THREE.Quaternion())
    const target = leg.target.clone().sub(toe.sub(wrist))
    const firstLength = shoulder.distanceTo(elbow)
    const secondLength = elbow.distanceTo(wrist)
    const direction = target.clone().sub(shoulder)
    if (direction.length() > firstLength + secondLength - 0.001) {
      leg.planted = false
      leg.canPlant = false
    }
    const distance = THREE.MathUtils.clamp(
      direction.length(),
      Math.abs(firstLength - secondLength) + 0.001,
      firstLength + secondLength - 0.001,
    )
    direction.normalize()
    target.copy(shoulder).addScaledVector(direction, distance)
    const pole = elbow.clone().sub(shoulder)
    pole.addScaledVector(direction, -pole.dot(direction))
    if (pole.lengthSq() < 1e-8) return
    pole.normalize()
    const along =
      (firstLength ** 2 - secondLength ** 2 + distance ** 2) / (2 * distance)
    const height = Math.sqrt(Math.max(0, firstLength ** 2 - along ** 2))
    const desiredElbow = shoulder
      .clone()
      .addScaledVector(direction, along)
      .addScaledVector(pole, height)
    this.rotateToward(
      leg.upper,
      elbow.clone().sub(shoulder),
      desiredElbow.sub(shoulder),
    )
    leg.lower.getWorldPosition(elbow)
    leg.wrist.getWorldPosition(wrist)
    this.rotateToward(leg.lower, wrist.sub(elbow), target.sub(elbow))
    const parentRotation =
      leg.wrist.parent?.getWorldQuaternion(new THREE.Quaternion()) ??
      new THREE.Quaternion()
    leg.wrist.quaternion.copy(parentRotation.invert().multiply(wristRotation))
    for (const bone of [leg.upper, leg.lower, leg.wrist]) {
      const base = this.poses.get(bone)
      if (base)
        bone.quaternion.slerpQuaternions(
          base,
          bone.quaternion.clone(),
          leg.weight,
        )
    }
    leg.upper.updateWorldMatrix(false, true)
  }
}
