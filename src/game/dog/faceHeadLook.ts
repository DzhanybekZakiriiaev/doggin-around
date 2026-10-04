import * as THREE from "three"

export type FaceHeadLookMetadata = {
  version: 1
  vertexCount: number
  topologyHash: string
  jointNames: string[]
  parents: number[]
  neck: number
  head: number
  neckWeight: number
  neutralYaw: number
  neutralRotations: number[][]
  yawAxes: number[][]
  pitchAxes: number[][]
  files: {
    weights: string
    bindMatrices: string
  }
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

export function parseHeadLookMetadata(value: unknown): FaceHeadLookMetadata {
  const data = value as FaceHeadLookMetadata
  if (
    data?.version !== 1 ||
    !Number.isSafeInteger(data.vertexCount) ||
    data.vertexCount <= 0 ||
    !/^[a-f0-9]{64}$/i.test(data.topologyHash) ||
    !Array.isArray(data.jointNames) ||
    data.jointNames.length < 3 ||
    new Set(data.jointNames).size !== data.jointNames.length ||
    data.jointNames.some((name) => typeof name !== "string" || !name) ||
    !Array.isArray(data.parents) ||
    data.parents.length !== data.jointNames.length ||
    data.parents.some(
      (parent, joint) =>
        !Number.isInteger(parent) ||
        (joint === 0 ? parent !== -1 : parent < 0 || parent >= joint),
    ) ||
    !Number.isInteger(data.neck) ||
    !Number.isInteger(data.head) ||
    data.neck <= 0 ||
    data.head <= data.neck ||
    data.head >= data.jointNames.length ||
    data.parents[data.head] !== data.neck ||
    !finite(data.neckWeight) ||
    data.neckWeight < 0 ||
    data.neckWeight > 1 ||
    !finite(data.neutralYaw) ||
    Math.abs(data.neutralYaw) > Math.PI ||
    !data.files ||
    typeof data.files.weights !== "string" ||
    !data.files.weights ||
    typeof data.files.bindMatrices !== "string" ||
    !data.files.bindMatrices
  )
    throw new Error("Invalid head look metadata")
  for (const axes of [data.yawAxes, data.pitchAxes]) {
    if (
      !Array.isArray(axes) ||
      axes.length !== 2 ||
      axes.some(
        (axis) =>
          !Array.isArray(axis) ||
          axis.length !== 3 ||
          axis.some((component) => !finite(component)) ||
          Math.abs(Math.hypot(...axis) - 1) > 1e-5,
      )
    )
      throw new Error("Invalid head look axes")
  }
  if (
    !Array.isArray(data.neutralRotations) ||
    data.neutralRotations.length !== 2 ||
    data.neutralRotations.some(
      (rotation) =>
        !Array.isArray(rotation) ||
        rotation.length !== 4 ||
        rotation.some((component) => !finite(component)) ||
        Math.abs(Math.hypot(...rotation) - 1) > 1e-5,
    )
  )
    throw new Error("Invalid neutral head rotations")
  return data
}

export class FaceHeadLook {
  readonly neutralYaw: number
  private readonly joints: THREE.Bone[]
  private readonly controlled: THREE.Bone[]
  private readonly bases = [new THREE.Quaternion(), new THREE.Quaternion()]
  private readonly yawAxes: THREE.Vector3[]
  private readonly pitchAxes: THREE.Vector3[]
  private readonly neutralRotations: THREE.Quaternion[]
  private readonly bind: THREE.Matrix4[]
  private readonly before: THREE.Matrix4[]
  private readonly after: THREE.Matrix4[]
  private readonly affected: {
    vertex: number
    influences: {
      joint: number
      weight: number
    }[]
  }[] = []
  private readonly inverseFrame = new THREE.Matrix4()
  private readonly oldBlend = new THREE.Matrix4()
  private readonly newBlend = new THREE.Matrix4()
  private readonly point = new THREE.Vector3()
  private readonly rotation = new THREE.Quaternion()
  private applied = false

  constructor(
    private readonly data: FaceHeadLookMetadata,
    private readonly weights: Float32Array,
    private readonly bindMatrices: Float32Array,
    private readonly frame: THREE.Object3D,
    bones: THREE.Bone[],
  ) {
    parseHeadLookMetadata(data)
    const count = data.jointNames.length
    if (
      weights.length !== data.vertexCount * count ||
      bindMatrices.length !== count * 16 ||
      !weights.every((weight) => Number.isFinite(weight) && weight >= 0) ||
      !bindMatrices.every(Number.isFinite)
    )
      throw new Error("Invalid full SMAL head look buffers")
    this.joints = data.jointNames.map((name) => {
      const bone = bones.find((candidate) => candidate.name === name)
      if (!bone) throw new Error(`Missing SMAL bone ${name}`)
      return bone
    })
    for (const [joint] of this.joints.entries()) {
      if (joint === 0) continue
      if (this.joints[joint].parent !== this.joints[data.parents[joint]])
        throw new Error("Head look skeleton hierarchy differs")
    }
    this.controlled = [this.joints[data.neck], this.joints[data.head]]
    this.yawAxes = data.yawAxes.map((axis) =>
      new THREE.Vector3().fromArray(axis),
    )
    this.pitchAxes = data.pitchAxes.map((axis) =>
      new THREE.Vector3().fromArray(axis),
    )
    this.neutralRotations = data.neutralRotations.map((rotation) =>
      new THREE.Quaternion().fromArray(rotation),
    )
    this.bind = Array.from({ length: count }, (_, joint) =>
      new THREE.Matrix4().fromArray(bindMatrices, joint * 16),
    )
    this.before = Array.from({ length: count }, () => new THREE.Matrix4())
    this.after = Array.from({ length: count }, () => new THREE.Matrix4())
    this.neutralYaw = data.neutralYaw
    const moving = new Set([data.neck])
    for (const [joint] of this.joints.entries()) {
      if (joint <= data.neck) continue
      if (moving.has(data.parents[joint])) moving.add(joint)
    }
    let vertex = 0
    while (vertex < data.vertexCount) {
      const influences = []
      let sum = 0
      let headWeight = 0
      for (const [joint] of this.joints.entries()) {
        const weight = weights[vertex * count + joint]
        sum += weight
        if (weight > 0) influences.push({ joint, weight })
        if (moving.has(joint)) headWeight += weight
      }
      if (Math.abs(sum - 1) > 1e-5)
        throw new Error("SMAL skin weights must sum to one")
      if (headWeight > 0) this.affected.push({ vertex, influences })
      vertex++
    }
  }

  restore(): void {
    if (!this.applied) return
    for (const [index, bone] of this.controlled.entries())
      bone.quaternion.copy(this.bases[index])
    this.applied = false
  }

  private capture(target: THREE.Matrix4[]): void {
    this.frame.updateWorldMatrix(true, false)
    this.joints[0].updateWorldMatrix(true, true)
    this.inverseFrame.copy(this.frame.matrixWorld).invert()
    for (const [joint] of this.joints.entries()) {
      target[joint]
        .multiplyMatrices(this.inverseFrame, this.joints[joint].matrixWorld)
        .multiply(this.bind[joint])
    }
  }

  apply(
    positions: Float32Array,
    yaw: number,
    pitch: number,
    target = positions,
  ): Float32Array {
    if (
      positions.length !== this.data.vertexCount * 3 ||
      target.length !== positions.length ||
      !Number.isFinite(yaw) ||
      !Number.isFinite(pitch)
    )
      throw new Error("Invalid head look pose")
    this.restore()
    if (target !== positions) target.set(positions)
    if (this.neutralYaw === 0 && yaw === 0 && pitch === 0) return target
    this.capture(this.before)
    const fractions = [this.data.neckWeight, 1 - this.data.neckWeight]
    for (const [index, bone] of this.controlled.entries()) {
      this.bases[index].copy(bone.quaternion)
      bone.quaternion.premultiply(this.neutralRotations[index])
      bone.quaternion.multiply(
        this.rotation.setFromAxisAngle(
          this.yawAxes[index],
          yaw * fractions[index],
        ),
      )
      bone.quaternion.multiply(
        this.rotation.setFromAxisAngle(
          this.pitchAxes[index],
          pitch * fractions[index],
        ),
      )
    }
    this.applied = true
    this.capture(this.after)
    for (const { vertex, influences } of this.affected) {
      const old = this.oldBlend.elements
      const next = this.newBlend.elements
      old.fill(0)
      next.fill(0)
      for (const { joint, weight } of influences) {
        const before = this.before[joint].elements
        const after = this.after[joint].elements
        let element = 0
        while (element < 16) {
          old[element] += before[element] * weight
          next[element] += after[element] * weight
          element++
        }
      }
      if (Math.abs(this.oldBlend.determinant()) < 1e-12)
        throw new Error("Singular SMAL skin transform")
      // Transfer the baked point through its existing full-weight skin transform.
      this.point
        .fromArray(positions, vertex * 3)
        .applyMatrix4(this.oldBlend.invert())
        .applyMatrix4(this.newBlend)
        .toArray(target, vertex * 3)
    }
    return target
  }

  sampleClip(
    clip: THREE.AnimationClip,
    time: number,
    positions: Float32Array,
  ): Float32Array {
    if (!Number.isFinite(time)) throw new Error("Invalid head look sample time")
    const root = new THREE.Group()
    const parent = new THREE.Group()
    this.frame.updateWorldMatrix(true, false)
    this.joints[0].updateWorldMatrix(true, false)
    parent.matrix.copy(this.frame.matrixWorld).invert()
    if (this.joints[0].parent)
      parent.matrix.multiply(this.joints[0].parent.matrixWorld)
    parent.matrixAutoUpdate = false
    root.add(parent)
    const clonedBone = this.joints[0].clone(true)
    parent.add(clonedBone)
    const bones: THREE.Bone[] = []
    clonedBone.traverse((object) => {
      if (object instanceof THREE.Bone) bones.push(object)
    })
    const mixer = new THREE.AnimationMixer(root)
    const action = mixer.clipAction(clip)
    action.setLoop(THREE.LoopOnce, 1)
    action.clampWhenFinished = true
    action.play()
    mixer.setTime(THREE.MathUtils.clamp(time, 0, clip.duration))
    const sample = new FaceHeadLook(
      this.data,
      this.weights,
      this.bindMatrices,
      root,
      bones,
    )
    const result = sample.apply(positions, 0, 0)
    mixer.stopAllAction()
    mixer.uncacheRoot(root)
    return result
  }
}

export async function loadFaceHeadLook(
  url: string,
  source: THREE.SkinnedMesh,
  expectedTopologyHash?: string,
): Promise<FaceHeadLook> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Head look metadata load failed ${url}`)
  const data = parseHeadLookMetadata(await response.json())
  const position = source.geometry.getAttribute("position")
  if (position.count !== data.vertexCount)
    throw new Error("Head look vertex count differs")
  let hash = expectedTopologyHash
  if (!hash) {
    const indices = source.geometry.index
    if (!indices) throw new Error("Missing head look topology")
    const topology = new ArrayBuffer(indices.count * 4)
    const topologyView = new DataView(topology)
    let index = 0
    while (index < indices.count) {
      topologyView.setUint32(index * 4, indices.getX(index), true)
      index++
    }
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", topology),
    )
    hash = Array.from(digest, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("")
  }
  if (hash !== data.topologyHash) throw new Error("Head look topology differs")
  const base = new URL(url, window.location.href)
  const buffers = await Promise.all(
    [data.files.weights, data.files.bindMatrices].map(async (path) => {
      const response = await fetch(new URL(path, base))
      if (!response.ok) throw new Error(`Head look buffer load failed ${path}`)
      const buffer = await response.arrayBuffer()
      if (buffer.byteLength % 4 !== 0)
        throw new Error("Invalid head look float buffer")
      const view = new DataView(buffer)
      return Float32Array.from({ length: buffer.byteLength / 4 }, (_, index) =>
        view.getFloat32(index * 4, true),
      )
    }),
  )
  return new FaceHeadLook(
    data,
    buffers[0],
    buffers[1],
    source,
    source.skeleton.bones,
  )
}
