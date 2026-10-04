import * as THREE from "three"

export const NEAREST_FACES = 10
export const FACE_STRIDE = 12
const EPSILON = 1e-8

export type BakedClip = {
  name: string
  duration: number
  times: Float32Array
  positions: Float32Array
}

export function finitePositions(positions: Float32Array, length: number): void {
  if (
    positions.length !== length ||
    positions.some((value) => !Number.isFinite(value))
  )
    throw new Error("Invalid baked mesh positions")
}

export function sampleBakedClip(
  clip: BakedClip,
  time: number,
  target: Float32Array,
): Float32Array {
  if (!Number.isFinite(time)) throw new Error("Invalid animation time")
  const stride = clip.positions.length / clip.times.length
  if (target.length !== stride)
    throw new Error("Animation target has the wrong size")
  const clock = Math.min(Math.max(time, 0), clip.duration)
  let first = 0
  let last = clip.times.length - 1
  while (last - first > 1) {
    const middle = (first + last) >>> 1
    if (clip.times[middle] <= clock) first = middle
    else last = middle
  }
  const blend =
    (clock - clip.times[first]) / (clip.times[last] - clip.times[first])
  const smooth = (clip.name === "walk" || clip.name === "run") && clip.times.length > 3
  const end = clip.times.length - 1
  const previous = first === 0 ? end - 1 : first - 1
  const next = last === end ? 1 : last + 1
  const interval = clip.times[last] - clip.times[first]
  const before = first === 0 ? clip.times[end] - clip.times[end - 1] : clip.times[first] - clip.times[previous]
  const after = last === end ? clip.times[1] - clip.times[0] : clip.times[next] - clip.times[last]
  const t2 = blend * blend
  const t3 = t2 * blend
  for (let index = 0; index < stride; index++) {
    const start = clip.positions[first * stride + index]
    const finish = clip.positions[last * stride + index]
    if (!smooth) {
      target[index] = start + (finish - start) * blend
      continue
    }
    const slope = (finish - start) / interval
    const looping = Math.abs(clip.positions[index] - clip.positions[end * stride + index]) < 1e-5
    const incoming = first === 0 && !looping ? slope : (start - clip.positions[previous * stride + index]) / before
    const outgoing = last === end && !looping ? slope : (clip.positions[next * stride + index] - finish) / after
    const startTangent = monotoneTangent(incoming, slope, before, interval)
    const endTangent = monotoneTangent(slope, outgoing, interval, after)
    target[index] = (2 * t3 - 3 * t2 + 1) * start + (t3 - 2 * t2 + blend) * interval * startTangent
      + (-2 * t3 + 3 * t2) * finish + (t3 - t2) * interval * endTangent
  }
  return target
}

// Match velocity between frames without overshooting planted paws.
function monotoneTangent(left: number, right: number, before: number, after: number): number {
  if (left * right <= 0) return 0
  const w1 = 2 * after + before
  const w2 = after + 2 * before
  return (w1 + w2) / (w1 / left + w2 / right)
}

export class FaceDeformation {
  readonly data: Float32Array
  private readonly inverseRotations: THREE.Quaternion[] = []
  private readonly perimeters: Float64Array
  private readonly validRest: boolean[] = []
  private readonly a = new THREE.Vector3()
  private readonly b = new THREE.Vector3()
  private readonly c = new THREE.Vector3()
  private readonly x = new THREE.Vector3()
  private readonly y = new THREE.Vector3()
  private readonly z = new THREE.Vector3()
  private readonly edge = new THREE.Vector3()
  private readonly center = new THREE.Vector3()
  private readonly basis = new THREE.Matrix4()
  private readonly rotation = new THREE.Quaternion()

  constructor(
    readonly restPositions: Float32Array,
    readonly faces: Uint32Array,
  ) {
    finitePositions(restPositions, restPositions.length)
    if (restPositions.length % 3 || faces.length % 3 || !faces.length)
      throw new Error("Invalid face topology")
    if (faces.some((index) => index >= restPositions.length / 3))
      throw new Error("Face topology references an unknown vertex")
    this.data = new Float32Array((faces.length / 3) * FACE_STRIDE)
    this.perimeters = new Float64Array(faces.length / 3)
    for (let face = 0; face < faces.length / 3; face++) {
      const valid = this.frame(restPositions, face)
      this.validRest.push(valid)
      this.perimeters[face] = this.perimeter()
      this.inverseRotations.push(this.rotation.clone().invert())
      this.center.toArray(this.data, face * FACE_STRIDE)
    }
    this.updatePositions(restPositions)
  }

  updatePositions(positions: Float32Array): void {
    finitePositions(positions, this.restPositions.length)
    for (let face = 0; face < this.faces.length / 3; face++) {
      const valid = this.frame(positions, face) && this.validRest[face]
      const offset = face * FACE_STRIDE
      this.center.toArray(this.data, offset + 4)
      if (valid) {
        this.data[offset + 3] = Math.sqrt(
          this.perimeter() / this.perimeters[face],
        )
        this.rotation.multiply(this.inverseRotations[face]).normalize()
      } else {
        // A collapsed face keeps translation without an unstable frame.
        this.data[offset + 3] = 1
        this.rotation.identity()
      }
      this.rotation.toArray(this.data, offset + 8)
    }
  }

  private frame(positions: Float32Array, face: number): boolean {
    this.a.fromArray(positions, this.faces[face * 3] * 3)
    this.b.fromArray(positions, this.faces[face * 3 + 1] * 3)
    this.c.fromArray(positions, this.faces[face * 3 + 2] * 3)
    this.center
      .copy(this.a)
      .add(this.b)
      .add(this.c)
      .multiplyScalar(1 / 3)
    this.x.subVectors(this.b, this.a)
    this.edge.subVectors(this.c, this.a)
    this.z.crossVectors(this.x, this.edge)
    if (this.x.length() <= EPSILON || this.z.length() <= EPSILON) {
      this.rotation.identity()
      return false
    }
    this.x.normalize()
    this.z.normalize()
    this.y.crossVectors(this.z, this.x)
    this.basis.makeBasis(this.x, this.y, this.z)
    this.rotation.setFromRotationMatrix(this.basis).normalize()
    return true
  }

  private perimeter(): number {
    return (
      this.a.distanceTo(this.b) +
      this.b.distanceTo(this.c) +
      this.c.distanceTo(this.a)
    )
  }
}

export function deformFaceGaussian(
  data: Float32Array,
  faceIds: Uint16Array,
  weights: Float32Array,
  position: THREE.Vector3,
  quaternion: THREE.Quaternion,
  scales: THREE.Vector3,
  bindingOffset = 0,
): {
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  scales: THREE.Vector3
} {
  const center = new THREE.Vector3()
  const rotation = new THREE.Quaternion(0, 0, 0, 0)
  const reference = new THREE.Quaternion()
  const delta = new THREE.Quaternion()
  const candidate = new THREE.Quaternion()
  const point = new THREE.Vector3()
  const restCenter = new THREE.Vector3()
  const posedCenter = new THREE.Vector3()
  let scale = 0
  for (let neighbor = 0; neighbor < NEAREST_FACES; neighbor++) {
    const face = faceIds[bindingOffset + neighbor] * FACE_STRIDE
    const weight = weights[bindingOffset + neighbor]
    delta.fromArray(data, face + 8)
    restCenter.fromArray(data, face)
    posedCenter.fromArray(data, face + 4)
    point.copy(position).sub(restCenter).applyQuaternion(delta).add(posedCenter)
    center.addScaledVector(point, weight)
    candidate.multiplyQuaternions(delta, quaternion)
    if (neighbor === 0) reference.copy(candidate)
    const sign = candidate.dot(reference) < 0 ? -1 : 1
    rotation.x += candidate.x * weight * sign
    rotation.y += candidate.y * weight * sign
    rotation.z += candidate.z * weight * sign
    rotation.w += candidate.w * weight * sign
    scale += data[face + 3] * weight
  }
  if (rotation.lengthSq() <= 1e-16) rotation.copy(reference)
  return {
    position: center,
    quaternion: rotation.normalize(),
    scales: scales.clone().multiplyScalar(scale),
  }
}
