import { readFileSync } from "node:fs"
import * as THREE from "three"
import { describe, expect, it } from "vitest"
import {
  deformFaceGaussian,
  FACE_STRIDE,
  FaceDeformation,
  sampleBakedClip,
} from "../../src/faceDeformation"

const triangle = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
const faces = new Uint32Array([0, 1, 2])
const ids = new Uint16Array(10)
const weights = new Float32Array(10).fill(0.1)
const position = new THREE.Vector3(0.2, 0.4, 0.3)
const orientation = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(0.3, 0.4, 0.1),
)
const scales = new THREE.Vector3(0.03, 0.05, 0.08)

function transformed(
  vertices: Float32Array,
  rotation: THREE.Quaternion,
  translation: THREE.Vector3,
  scale = 1,
): Float32Array {
  const result = new Float32Array(vertices.length)
  const vertex = new THREE.Vector3()
  for (let offset = 0; offset < vertices.length; offset += 3)
    vertex
      .fromArray(vertices, offset)
      .multiplyScalar(scale)
      .applyQuaternion(rotation)
      .add(translation)
      .toArray(result, offset)
  return result
}

describe("SMAL-pets face deformation", () => {
  it("matches the independent NumPy paper-equation reference for all synthetic poses", () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL("../fixtures/smal-pets-parity.json", import.meta.url),
        "utf8",
      ),
    ) as {
      count: number
      restPositions: number[]
      faces: number[]
      faceIds: number[]
      weights: number[]
      positions: number[]
      quaternions: number[]
      scales: number[]
      cases: {
        name: string
        posedPositions: number[]
        positions: number[]
        quaternions: number[]
        scales: number[]
      }[]
    }
    const frame = new FaceDeformation(
      new Float32Array(fixture.restPositions),
      new Uint32Array(fixture.faces),
    )
    const ids = new Uint16Array(fixture.faceIds)
    const weights = new Float32Array(fixture.weights)
    for (const pose of fixture.cases) {
      frame.updatePositions(new Float32Array(pose.posedPositions))
      for (let index = 0; index < fixture.count; index++) {
        const actual = deformFaceGaussian(
          frame.data,
          ids,
          weights,
          new THREE.Vector3().fromArray(fixture.positions, index * 3),
          new THREE.Quaternion().fromArray(fixture.quaternions, index * 4),
          new THREE.Vector3().fromArray(fixture.scales, index * 3),
          index * 10,
        )
        expect(
          actual.position.distanceTo(
            new THREE.Vector3().fromArray(pose.positions, index * 3),
          ),
          `${pose.name} position ${index}`,
        ).toBeLessThan(2e-6)
        expect(
          actual.quaternion.angleTo(
            new THREE.Quaternion().fromArray(pose.quaternions, index * 4),
          ),
          `${pose.name} quaternion ${index}`,
        ).toBeLessThan(2e-6)
        expect(
          actual.scales.distanceTo(
            new THREE.Vector3().fromArray(pose.scales, index * 3),
          ),
          `${pose.name} scale ${index}`,
        ).toBeLessThan(2e-6)
      }
    }
  })
  it("preserves a Gaussian in the rest pose", () => {
    const frame = new FaceDeformation(triangle, faces)
    const actual = deformFaceGaussian(
      frame.data,
      ids,
      weights,
      position,
      orientation,
      scales,
    )
    expect(actual.position.distanceTo(position)).toBeLessThan(1e-7)
    expect(actual.quaternion.angleTo(orientation)).toBeLessThan(1e-7)
    expect(actual.scales.distanceTo(scales)).toBeLessThan(1e-7)
  })

  it("applies a complete rigid pose to center and orientation", () => {
    const frame = new FaceDeformation(triangle, faces)
    const rotation = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 2, 3).normalize(),
      2.1,
    )
    const translation = new THREE.Vector3(-3, 2, 4)
    frame.updatePositions(transformed(triangle, rotation, translation))
    const actual = deformFaceGaussian(
      frame.data,
      ids,
      weights,
      position,
      orientation,
      scales,
    )
    expect(
      actual.position.distanceTo(
        position.clone().applyQuaternion(rotation).add(translation),
      ),
    ).toBeLessThan(1e-6)
    expect(
      actual.quaternion.angleTo(rotation.clone().multiply(orientation)),
    ).toBeLessThan(1e-6)
    expect(actual.scales.distanceTo(scales)).toBeLessThan(1e-7)
  })

  it("uses rigid center offsets and square-root perimeter scaling", () => {
    const frame = new FaceDeformation(triangle, faces)
    frame.updatePositions(
      transformed(triangle, new THREE.Quaternion(), new THREE.Vector3(), 4),
    )
    const actual = deformFaceGaussian(
      frame.data,
      ids,
      weights,
      position,
      orientation,
      scales,
    )
    expect(
      actual.position.distanceTo(
        position.clone().add(new THREE.Vector3(1, 1, 0)),
      ),
    ).toBeLessThan(1e-6)
    expect(actual.quaternion.angleTo(orientation)).toBeLessThan(1e-7)
    expect(
      actual.scales.distanceTo(scales.clone().multiplyScalar(2)),
    ).toBeLessThan(1e-7)
  })

  it("blends independently articulated faces with the fixed rest weights", () => {
    const rest = new Float32Array([...triangle, ...triangle])
    const frame = new FaceDeformation(rest, new Uint32Array([0, 1, 2, 3, 4, 5]))
    const secondRotation = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      Math.PI / 2,
    )
    const posed = new Float32Array([
      ...triangle,
      ...transformed(triangle, secondRotation, new THREE.Vector3(0, 0, 2)),
    ])
    frame.updatePositions(posed)
    const bindings = new Uint16Array([0, 1, 0, 1, 0, 1, 0, 1, 0, 1])
    const actual = deformFaceGaussian(
      frame.data,
      bindings,
      weights,
      position,
      new THREE.Quaternion(),
      scales,
    )
    const expected = position
      .clone()
      .multiplyScalar(0.5)
      .addScaledVector(
        position
          .clone()
          .applyQuaternion(secondRotation)
          .add(new THREE.Vector3(0, 0, 2)),
        0.5,
      )
    expect(actual.position.distanceTo(expected)).toBeLessThan(1e-6)
    expect(
      actual.quaternion.angleTo(
        new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 0, 1),
          Math.PI / 4,
        ),
      ),
    ).toBeLessThan(1e-6)
  })

  it("aligns opposite quaternion hemispheres before blending", () => {
    const frame = new FaceDeformation(
      new Float32Array([...triangle, ...triangle]),
      new Uint32Array([0, 1, 2, 3, 4, 5]),
    )
    frame.data[FACE_STRIDE + 11] = -1
    const bindings = new Uint16Array([0, 1, 0, 1, 0, 1, 0, 1, 0, 1])
    const actual = deformFaceGaussian(
      frame.data,
      bindings,
      weights,
      position,
      orientation,
      scales,
    )
    expect(actual.quaternion.angleTo(orientation)).toBeLessThan(1e-7)
    expect(actual.quaternion.length()).toBeCloseTo(1)
  })

  it.each([false, true])(
    "keeps degenerate faces finite with only centroid translation, collapsed rest=%s",
    (collapsedRest) => {
      const collapsed = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0])
      const rest = collapsedRest ? collapsed : triangle
      const frame = new FaceDeformation(rest, faces)
      const posed = transformed(
        collapsedRest ? triangle : collapsed,
        new THREE.Quaternion(),
        new THREE.Vector3(2, 3, 4),
      )
      frame.updatePositions(posed)
      const actual = deformFaceGaussian(
        frame.data,
        ids,
        weights,
        position,
        orientation,
        scales,
      )
      const restCenter = new THREE.Vector3().fromArray(frame.data, 0)
      const posedCenter = new THREE.Vector3().fromArray(frame.data, 4)
      expect(
        actual.position.distanceTo(
          position.clone().sub(restCenter).add(posedCenter),
        ),
      ).toBeLessThan(1e-6)
      expect(actual.quaternion.angleTo(orientation)).toBeLessThan(1e-7)
      expect(actual.scales.distanceTo(scales)).toBeLessThan(1e-7)
      expect(Array.from(frame.data).every(Number.isFinite)).toBe(true)
    },
  )

  it("rejects invalid updates before changing the active frame", () => {
    const frame = new FaceDeformation(triangle, faces)
    const before = frame.data.slice()
    expect(() =>
      frame.updatePositions(
        new Float32Array([Number.NaN, ...triangle.slice(1)]),
      ),
    ).toThrow("Invalid baked mesh positions")
    expect(frame.data).toEqual(before)
    expect(
      () => new FaceDeformation(triangle, new Uint32Array([0, 1, 8])),
    ).toThrow("unknown vertex")
  })
})

describe("baked mesh sampling", () => {
  const clip = {
    name: "idle",
    duration: 2,
    times: new Float32Array([0, 0.5, 2]),
    positions: new Float32Array([0, 1, 2, 10, 11, 12, 40, 41, 42]),
  }
  it("interpolates irregular timestamps and clamps one-shot endpoints", () => {
    const target = new Float32Array(3)
    expect(sampleBakedClip(clip, 0.25, target)).toBe(target)
    expect(Array.from(target)).toEqual([5, 6, 7])
    expect(Array.from(sampleBakedClip(clip, 1.25, target))).toEqual([
      25, 26, 27,
    ])
    expect(Array.from(sampleBakedClip(clip, -2, target))).toEqual([0, 1, 2])
    expect(Array.from(sampleBakedClip(clip, 3, target))).toEqual([40, 41, 42])
  })
  it("rejects malformed time and target arrays", () => {
    expect(() =>
      sampleBakedClip(clip, Number.NaN, new Float32Array(3)),
    ).toThrow("Invalid animation time")
    expect(() => sampleBakedClip(clip, 0, new Float32Array(2))).toThrow(
      "wrong size",
    )
  })
})
