import * as THREE from "three"
import { describe, expect, it } from "vitest"
import {
  combineInfluences,
  deformPoint,
  sampleSurface,
  seededRandom,
  textureColorAt,
} from "../../src/sampling"

function fixture(): THREE.SkinnedMesh {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
  )
  geometry.setAttribute(
    "skinIndex",
    new THREE.Uint16BufferAttribute([0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0], 4),
  )
  geometry.setAttribute(
    "skinWeight",
    new THREE.Float32BufferAttribute(
      [0.5, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0.5, 0.5, 0, 0],
      4,
    ),
  )
  const root = new THREE.Bone(),
    tip = new THREE.Bone()
  tip.position.set(0, 1, 0)
  root.add(tip)
  const mesh = new THREE.SkinnedMesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: "orange" }),
  )
  mesh.position.set(3, 2, -1)
  mesh.add(root)
  mesh.updateMatrixWorld(true)
  mesh.bind(new THREE.Skeleton([root, tip]))
  return mesh
}

describe("rigged surface conversion", () => {
  it("bilinearly samples texture colors at texel boundaries", () => {
    const pixels = {
      width: 2,
      height: 2,
      data: new Uint8ClampedArray([
        255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
      ]),
    }
    const texture = new THREE.Texture()
    texture.flipY = false
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    const middle = textureColorAt(pixels, texture, new THREE.Vector2(0.5, 0.5))
    expect(middle.color.r).toBeCloseTo(0.5)
    expect(middle.color.g).toBeCloseTo(0.5)
    expect(middle.color.b).toBeCloseTo(0.5)
    expect(middle.opacity).toBe(1)
    const corner = textureColorAt(pixels, texture, new THREE.Vector2(0, 0))
    expect(corner.color.r).toBe(1)
    expect(corner.color.g).toBe(0)
    expect(corner.color.b).toBe(0)
  })

  it("allocates more samples to dark saturated details at fixed density", () => {
    const mesh = fixture()
    const geometry = mesh.geometry
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0, 3, 0, 0, 2, 1, 0],
        3,
      ),
    )
    geometry.setAttribute(
      "skinIndex",
      new THREE.Uint16BufferAttribute(Array(6).fill([0, 0, 0, 0]).flat(), 4),
    )
    geometry.setAttribute(
      "skinWeight",
      new THREE.Float32BufferAttribute(Array(6).fill([1, 0, 0, 0]).flat(), 4),
    )
    geometry.addGroup(0, 3, 0)
    geometry.addGroup(3, 3, 1)
    mesh.material = [
      new THREE.MeshStandardMaterial({ color: "white" }),
      new THREE.MeshStandardMaterial({ color: "#143375" }),
    ]
    const { samples } = sampleSurface(mesh, 2000, seededRandom(9))
    const detailed = samples.filter((sample) => sample.triangle[0] === 3)
    expect(samples).toHaveLength(2000)
    expect(detailed.length).toBeGreaterThan(1100)
    expect(detailed[0].densityScale).toBeLessThan(1)
  })

  it("keeps a restrained fur shell attached to pale lower-body samples", () => {
    const mesh = fixture()
    mesh.material = new THREE.MeshStandardMaterial({ color: "white" })
    const { samples } = sampleSurface(mesh, 1000, seededRandom(4), {
      furFraction: 0.1,
    })
    expect(samples).toHaveLength(1000)
    expect(samples.filter((sample) => sample.fur)).toHaveLength(100)
    for (const sample of samples.filter((entry) => entry.fur)) {
      expect(sample.position.z).toBeGreaterThan(0)
      expect(
        sample.influences.reduce((sum, entry) => sum + entry.weight, 0),
      ).toBeCloseTo(1)
    }
  })

  it("measures surface area without creating samples", () => {
    const result = sampleSurface(fixture(), 0)
    expect(result.area).toBeCloseTo(0.5)
    expect(result.samples).toEqual([])
  })
  it("merges shared bones and normalizes the strongest four influences", () => {
    const values = combineInfluences(
      [
        [
          { bone: 0, weight: 0.5 },
          { bone: 1, weight: 0.5 },
        ],
        [
          { bone: 0, weight: 0.4 },
          { bone: 2, weight: 0.6 },
        ],
        [
          { bone: 3, weight: 0.4 },
          { bone: 4, weight: 0.4 },
          { bone: 5, weight: 0.2 },
        ],
      ],
      [0.2, 0.3, 0.5],
    )
    expect(values).toHaveLength(4)
    expect(values.reduce((sum, value) => sum + value.weight, 0)).toBeCloseTo(1)
    expect(new Set(values.map((value) => value.bone)).size).toBe(4)
    expect(values[0].bone).toBe(0)
  })
  it("preserves the sampled triangle, barycentrics, and bind-pose coordinates", () => {
    const mesh = fixture()
    const { samples, area } = sampleSurface(mesh, 100, seededRandom(11))
    expect(area).toBeCloseTo(0.5)
    for (const sample of samples) {
      expect(sample.triangle).toEqual([0, 1, 2])
      expect(sample.barycentric.reduce((a, b) => a + b)).toBeCloseTo(1)
      expect(sample.position.x).toBeCloseTo(sample.barycentric[1])
      expect(sample.position.y).toBeCloseTo(sample.barycentric[2])
      expect(
        deformPoint(mesh, sample.position, sample.influences).distanceTo(
          sample.position,
        ),
      ).toBeLessThan(1e-6)
    }
  })
  it("matches Three.js skinning under bone motion and an external scene transform", () => {
    const mesh = fixture()
    const parent = new THREE.Group()
    parent.scale.setScalar(0.4)
    parent.rotation.y = 0.8
    parent.position.set(-2, 4, 1)
    parent.add(mesh)
    mesh.skeleton.bones[1].rotation.z = 0.7
    parent.updateMatrixWorld(true)
    const point = new THREE.Vector3().fromBufferAttribute(
      mesh.geometry.getAttribute("position"),
      1,
    )
    const expected = mesh.applyBoneTransform(1, point.clone())
    const actual = deformPoint(mesh, point, [
      { bone: 0, weight: 0.5 },
      { bone: 1, weight: 0.5 },
    ])
    expect(actual.distanceTo(expected)).toBeLessThan(1e-6)
  })
  it("rejects an unrigged model", () => {
    const mesh = fixture()
    mesh.geometry.deleteAttribute("skinWeight")
    expect(() => sampleSurface(mesh, 10)).toThrow("skin weights")
  })
})
